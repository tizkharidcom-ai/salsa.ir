'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const Module = require('node:module');

const root = path.resolve(__dirname, '..');
const routePath = path.join(root, 'server/salsa/control-plane/routes/backup-routes.js');
const viewPath = path.join(root, 'prototype/js/views/gm20-backups.js');

function loadBackupRouterWithDb(db) {
  const routes = new Map();
  const router = {
    use() {},
    get(route, ...handlers) { routes.set(`GET ${route}`, handlers); },
    post(route, ...handlers) { routes.set(`POST ${route}`, handlers); }
  };
  const roleMiddleware = () => (_req, _res, next) => next();
  const originalLoad = Module._load;
  delete require.cache[routePath];
  Module._load = function(request, parent, isMain) {
    if (parent && parent.filename === routePath) {
      if (request === 'express') return { Router: () => router };
      if (request === '../backup/backup-manifest-service') return { BackupManifestService: class {} };
      if (request === '../backup/restore-reconciliation-service') return { RestoreReconciliationService: class {} };
      if (request === '../db/database') return { getDatabase: () => db };
      if (request === '../auth/auth-middleware') {
        return { authenticatePlatform: (_req, _res, next) => next(), requirePlatformRole: roleMiddleware };
      }
      if (request === '../backup/backup-artifact-store') return { createArtifactStoreFromEnvironment: () => null };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    require(routePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];
  }
  return routes;
}

async function requestDrStatus({ manifests = [], total = 0, query = {} } = {}) {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/COUNT\(\*\)/i.test(sql)) return { rows: [{ total_count: String(total) }] };
      return { rows: manifests };
    }
  };
  const routes = loadBackupRouterWithDb(db);
  const handlers = routes.get('GET /dr-status');
  assert.ok(handlers, 'DR status route is registered');
  let response;
  let statusCode;
  const res = {
    status(code) { statusCode = code; return this; },
    json(payload) { response = payload; return this; }
  };
  await handlers.at(-1)({ query }, res, error => { throw error; });
  return { response, statusCode, calls, routes };
}

test('DR API reports unsupported metrics as unknown/blocked and preserves actual manifest provenance', async () => {
  const manifest = {
    id: 'bck_actual_123', tenant_id: 'tenant-a', scope: 'tenant', epoch: 7,
    status: 'verified', created_at: '2026-09-20T10:00:00.000Z',
    expires_at: '2026-10-20T10:00:00.000Z', retention_tier: 'daily',
    size_bytes: '2048', encryption_key_id: 'key-7', db_dump_ref: 'artifact://db/123',
    db_checksum_sha256: 'a'.repeat(64), files_ref: 'artifact://files/123',
    files_checksum_sha256: 'b'.repeat(64)
  };
  const { response, statusCode, calls, routes } = await requestDrStatus({
    manifests: [manifest], total: 4, query: { tenant_id: 'tenant-a' }
  });
  const data = response.data;

  assert.equal(statusCode, 200);
  assert.equal(data.status, 'blocked');
  for (const key of ['rpoMinutes', 'rtoMinutes', 'pitrCapable', 'primaryStorageProvider',
    'offsiteStorageProvider', 'offsiteSynced', 'lastWalFlushAt', 'encryptionStandard',
    'retentionPolicyDays', 'drReadinessScore']) {
    assert.equal(data[key], null, `${key} must not be fabricated`);
  }
  assert.equal(data.walStreamingStatus, 'unknown');
  assert.equal(data.hashVerification, 'unknown');
  assert.equal(data.totalSnapshotsCount, 4);
  assert.equal(data.latestSnapshotTime, manifest.created_at);
  assert.equal(data.evidence.source, 'neem_backup_manifests');
  assert.equal(data.evidence.latest_manifest.id, manifest.id);
  assert.equal(data.evidence.latest_manifest.db_dump_ref, manifest.db_dump_ref);
  assert.equal(data.evidence.latest_manifest.db_checksum_sha256, manifest.db_checksum_sha256);
  assert.ok(calls.every(call => call.params[0] === 'tenant-a'), 'all evidence queries must keep tenant scope');
  for (const actionRoute of ['POST /manifests', 'POST /verify', 'POST /restore-drill', 'GET /manifests']) {
    assert.ok(routes.has(actionRoute), `${actionRoute} remains available`);
  }
});

test('DR API keeps absent evidence unknown and does not infer readiness from an empty manifest list', async () => {
  const { response } = await requestDrStatus();
  const data = response.data;
  assert.equal(data.status, 'blocked');
  assert.equal(data.totalSnapshotsCount, 0);
  assert.equal(data.latestSnapshotTime, null);
  assert.equal(data.evidence.latest_manifest, null);
  assert.equal(data.drReadinessScore, null);
  assert.equal(data.walStreamingStatus, 'unknown');
  assert.equal(data.offsiteSynced, null);
});

test('DR API reports an unavailable manifest count as unknown instead of zero', async () => {
  const { response } = await requestDrStatus({ total: null });
  assert.equal(response.data.totalSnapshotsCount, null);
  assert.equal(response.data.evidence.snapshot_count_status, 'unknown');
  assert.equal(response.data.status, 'blocked');
});

test('GM-20 view marks local fixture rows unverified and renders unsupported DR metrics as unknown', () => {
  const source = fs.readFileSync(viewPath, 'utf8');
  const sample = {
    id: 'bkp_fixture_1', tenantId: 'tenant-a', type: 'Full WAL + Data Snapshot',
    size: '1.8 GB', sha256: 'f'.repeat(64), storageProvider: 'Asiatech S3 + offsite',
    restoreTestStatus: 'passed', restoreDrillTime: 'recent', status: 'verified',
    createdAt: 'fixture time'
  };
  const store = {
    getTenants: () => [],
    getActiveTenantId: () => 'tenant-a',
    getTenant: () => ({ id: 'tenant-a', name: 'Tenant A', cellId: 'cell-teh-01' }),
    getBackups: () => [sample]
  };
  const window = {
    prototypeStore: store,
    GMDataState: {
      renderFreshnessBar: () => '',
      getViewState: () => ({ state: 'live' }),
      renderFailedState: () => '', renderEmptyState: () => '', renderSkeleton: () => '',
      renderStaleBanner: () => '', renderRefreshingBanner: () => ''
    }
  };
  vm.runInNewContext(source, { window });
  const html = window.renderGM20({ id: 'tenant-a' });

  assert.match(html, /مخزن محلی نمونه/);
  assert.match(html, /مسدود — شواهد عملیاتی متصل نیست/);
  assert.match(html, /نامشخص — نتیجهٔ دریل معتبر/);
  assert.match(html, /بدون provenance پروداکشن/);
  assert.match(html, /بازیابی و اعتبارسنجی/);
  assert.match(html, /تهیه بکاپ اضطراری فوری/);
  assert.doesNotMatch(html, /RPO\s*<\s*\d|RTO\s*<\s*\d/);
  assert.doesNotMatch(html, /Asiatech S3|Full WAL \+ Data Snapshot|امضای معتبر SHA-256|آزمون بازیابی موفق|آماده و تأییدشده/);
  assert.doesNotMatch(html, new RegExp('f'.repeat(64)));
});
