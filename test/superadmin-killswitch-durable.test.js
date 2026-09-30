'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { KillSwitchService } = require('../server/salsa/control-plane/policy/kill-switch-service');

function createPersistentFakeDb() {
  const rows = new Map();
  const db = {
    rows,
    async connect() {
      return { query: db.query.bind(db), release() {} };
    },
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (['begin', 'commit', 'rollback'].includes(normalized) || normalized.startsWith('select pg_advisory_xact_lock')) {
        return { rows: [] };
      }
      if (normalized.startsWith('insert into neem_platform_kill_switches')) {
        const [id, requestedKey, featureKey, moduleKey, featureKeys, scope, reason, severity, createdBy, createdAt, expiresAt, tenantCount, approvalState] = params;
        const old = rows.get(requestedKey);
        const row = {
          id: old?.id || id,
          requested_key: requestedKey,
          feature_key: featureKey,
          module_key: moduleKey,
          feature_keys: JSON.parse(featureKeys),
          scope,
          reason,
          severity,
          created_by: createdBy,
          created_at: old?.created_at || createdAt,
          expires_at: expiresAt,
          status: 'active',
          affected_tenant_count: tenantCount,
          approval_state: approvalState,
          distribution_status: 'pending',
          distribution_error: null,
          distributed_at: null
        };
        rows.set(requestedKey, row);
        return { rows: [row] };
      }
      if (normalized.includes('set distribution_status')) {
        const [status, error, requestedKey] = params;
        const row = rows.get(requestedKey);
        if (row && ['active', 'revoked'].includes(row.status)) Object.assign(row, {
          distribution_status: status,
          distribution_error: error,
          distributed_at: status === 'synced' ? new Date().toISOString() : null
        });
        return { rows: row && ['active', 'revoked'].includes(row.status) ? [row] : [] };
      }
      if (normalized.includes('set status = \'revoked\'')) {
        const row = rows.get(params[0]);
        if (row?.status === 'active') Object.assign(row, { status: 'revoked', distribution_status: 'pending', distributed_at: null });
        return { rows: row?.status === 'revoked' ? [row] : [] };
      }
      if (normalized.includes('where requested_key = $1')) {
        const row = rows.get(params[0]);
        const unexpired = !normalized.includes('expires_at > now()') || Date.parse(row?.expires_at) > Date.now();
        return { rows: row?.status === 'active' && unexpired ? [row] : [] };
      }
      if (normalized.includes("where status = 'active'")) {
        return { rows: [...rows.values()].filter(row => row.status === 'active' &&
          (!normalized.includes('expires_at > now()') || Date.parse(row.expires_at) > Date.now())) };
      }
      throw new Error(`Unhandled fake DB query: ${normalized}`);
    }
  };
  return db;
}

test('expired active kill switches are excluded from enforcement and active lookup', async () => {
  const now = Date.now();
  const rows = new Map([
    ['old', { id: 'old', requested_key: 'old', feature_keys: ['orders.pos'], status: 'active', expires_at: new Date(now - 1000).toISOString() }],
    ['current', { id: 'current', requested_key: 'current', feature_keys: ['orders.pos'], status: 'active', expires_at: new Date(now + 60_000).toISOString() }]
  ]);
  const queries = [];
  const service = new KillSwitchService({ dbProvider: () => ({
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      queries.push(normalized);
      if (normalized.includes('where requested_key = $1')) {
        const row = rows.get(params[0]);
        return { rows: row && row.status === 'active' && Date.parse(row.expires_at) > Date.now() ? [row] : [] };
      }
      if (normalized.includes("where status = 'active'")) {
        return { rows: [...rows.values()].filter(row => row.status === 'active' && Date.parse(row.expires_at) > Date.now()) };
      }
      throw new Error(`Unhandled query: ${normalized}`);
    }
  }) });

  assert.deepEqual((await service.listActive()).map(row => row.id), ['current']);
  assert.equal((await service.findActive('old')), null);
  assert.equal((await service.findActive('current')).id, 'current');
  assert.equal(queries.length, 3);
  assert.ok(queries.every(sql => /expires_at > now\(\)/.test(sql)));
});

test('platform kill switches survive service recreation and retain data-plane delivery state', async t => {
  const auditService = require('../server/salsa/control-plane/audit/audit-service');
  const originalAudit = auditService.recordEvent;
  const auditEvents = [];
  auditService.recordEvent = async event => { auditEvents.push(event); };
  t.after(() => { auditService.recordEvent = originalAudit; });
  const db = createPersistentFakeDb();
  const firstProcess = new KillSwitchService({ dbProvider: () => db });
  const created = await firstProcess.activate({
    id: 'ks-one', requestedKey: 'orders.pos', featureKey: 'orders.pos', moduleKey: null,
    featureKeys: ['orders.pos'], scope: 'global', reason: 'پرداخت دچار اختلال شده', severity: 'high',
    createdBy: 'operator-1', createdAt: '2026-09-23T10:00:00.000Z',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), affectedTenantCount: 2, approvalState: 'auto_approved'
  });
  assert.equal(created.distributionStatus, 'pending');
  await firstProcess.recordDistribution('orders.pos', { ok: false, status: 503, error: 'CELL_UNAVAILABLE' });

  const restartedProcess = new KillSwitchService({ dbProvider: () => db });
  const recovered = await restartedProcess.listActive();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].id, 'ks-one');
  assert.equal(recovered[0].distributionStatus, 'failed');
  assert.deepEqual(recovered[0].distributionError, { code: 'CELL_UNAVAILABLE', httpStatus: 503 });

  const revoked = await restartedProcess.revoke('orders.pos', { actorId: 'platform-principal-1', reason: 'incident resolved' });
  assert.equal(revoked.distributionStatus, 'pending', 'revocation is not reported as delivered before data-plane confirmation');
  const revokedAndSynced = await restartedProcess.recordDistribution('orders.pos', { ok: true });
  assert.equal(revokedAndSynced.status, 'revoked');
  assert.equal(revokedAndSynced.distributionStatus, 'synced');
  assert.deepEqual(await new KillSwitchService({ dbProvider: () => db }).listActive(), []);
  assert.deepEqual(auditEvents.map(event => event.action), [
    'PLATFORM_KILLSWITCH_ACTIVATED',
    'PLATFORM_KILLSWITCH_DISTRIBUTION_UPDATED',
    'PLATFORM_KILLSWITCH_REVOKED',
    'PLATFORM_KILLSWITCH_DISTRIBUTION_UPDATED'
  ]);
  assert.ok(auditEvents.every(event => event.database), 'each audit event is written through the same transaction client');
  assert.equal(auditEvents[2].actorId, 'platform-principal-1');
});

test('kill-switch service stores feature-key arrays as JSON and maps PostgreSQL rows to API fields', async t => {
  const auditService = require('../server/salsa/control-plane/audit/audit-service');
  const originalAudit = auditService.recordEvent;
  auditService.recordEvent = async () => {};
  t.after(() => { auditService.recordEvent = originalAudit; });
  let capturedParams;
  const service = new KillSwitchService({ dbProvider: () => ({
    async connect() {
      return { query: async (sql, params) => {
        const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
        if (normalized.startsWith('insert into neem_platform_kill_switches')) {
          capturedParams = params;
          return { rows: [{
            id: 'ks-json', feature_key: null, module_key: 'pos', feature_keys: '["orders.pos","kitchen.kds"]',
            scope: 'global', reason: 'incident', severity: 'critical', created_by: 'platform-principal-1',
            created_at: new Date('2026-09-23T10:00:00.000Z'), expires_at: new Date('2026-09-24T10:00:00.000Z'),
            status: 'active', affected_tenant_count: '3', approval_state: 'approved', distribution_status: 'synced'
          }] };
        }
        return { rows: [] };
      }, release() {} };
    }
  }) });

  const result = await service.activate({
    id: 'ks-json', requestedKey: 'pos', featureKey: null, moduleKey: 'pos',
    featureKeys: ['orders.pos', 'kitchen.kds'], scope: 'global', reason: 'incident', severity: 'critical',
    createdBy: 'platform-principal-1', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    affectedTenantCount: 3, approvalState: 'approved'
  });

  assert.equal(capturedParams[4], '["orders.pos","kitchen.kds"]');
  assert.deepEqual(result.featureKeys, ['orders.pos', 'kitchen.kds']);
  assert.equal(result.affectedTenantCount, 3);
  assert.equal(result.distributionStatus, 'synced');
});

test('migration defines durable, indexed platform kill switches with constrained state', () => {
  const migration = fs.readFileSync(path.resolve(__dirname, '../server/salsa/control-plane/migrations/032_durable_platform_kill_switches.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS neem_platform_kill_switches/);
  assert.match(migration, /requested_key TEXT NOT NULL UNIQUE/);
  assert.match(migration, /feature_keys JSONB NOT NULL/);
  assert.match(migration, /distribution_status TEXT NOT NULL DEFAULT 'pending'/);
  assert.match(migration, /WHERE status = 'active'/);
  assert.match(migration, /USING GIN \(feature_keys\)/);
});

test('control-plane readiness requires durable governance and billing schema', async () => {
  const { REQUIRED_MIGRATIONS, REQUIRED_TABLES, inspectControlPlaneDatabase } = require('../server/salsa/control-plane/db/readiness');
  assert.equal(REQUIRED_MIGRATIONS.at(-1), '036');
  assert.ok(REQUIRED_TABLES.includes('neem_platform_kill_switches'));
  assert.ok(REQUIRED_TABLES.includes('neem_billing_plan_versions'));
  assert.ok(REQUIRED_TABLES.includes('neem_billing_plan_operations'));

  const makeDb = missingKillSwitchTable => ({
    async query(sql) {
      if (sql.includes('to_regclass')) return { rows: [{
        database_name: 'test', schema_name: 'public', migration_table: 'neem_control_migrations',
        tenants_table: 'neem_tenants', principals_table: 'neem_platform_principals',
        mfa_challenges_table: 'neem_platform_mfa_challenges',
        kill_switches_table: missingKillSwitchTable ? null : 'neem_platform_kill_switches',
        billing_plan_versions_table: 'neem_billing_plan_versions',
        billing_plan_operations_table: 'neem_billing_plan_operations',
        audit_table: 'neem_control_audit_events', releases_table: 'neem_releases',
        rollout_waves_table: 'neem_rollout_waves', incidents_table: 'neem_incidents',
        outbox_table: 'neem_automation_outbox', siem_cursor_table: 'neem_audit_export_cursors',
        support_approval_table: 'neem_support_session_approvals',
        support_approval_rate_limit_table: 'neem_support_approval_rate_limits'
      }] };
      return { rows: REQUIRED_MIGRATIONS.map(version => ({ version })) };
    }
  });

  const ready = await inspectControlPlaneDatabase(makeDb(false));
  assert.equal(ready.ready, true);
  const missing = await inspectControlPlaneDatabase(makeDb(true));
  assert.equal(missing.ready, false);
  assert.ok(missing.missingTables.includes('neem_platform_kill_switches'));
});

function responseHarness() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('global kill-switch route refuses to persist or send a partial single-tenant mutation', async () => {
  const router = require('../server/salsa/control-plane/routes/policy-routes');
  const route = router.stack.find(layer => layer.route?.path === '/killswitch' && layer.route.methods.post);
  const handler = route.route.stack.at(-1).handle;
  const service = require('../server/salsa/control-plane/policy/kill-switch-service');
  const original = {
    activate: service.activate,
    recordDistribution: service.recordDistribution,
    fetch: global.fetch,
    secret: process.env.SALSA_CONTROL_SECRET,
    nodeEnv: process.env.NODE_ENV
  };
  const calls = [];
  service.activate = async data => {
    calls.push('persist');
    return { ...data, status: 'active', distributionStatus: 'pending' };
  };
  service.recordDistribution = async (_key, sync) => {
    calls.push('record-distribution');
    return { id: 'ks-failed', status: 'active', distributionStatus: sync.ok ? 'synced' : 'failed' };
  };
  global.fetch = async () => {
    calls.push('sync');
    return { ok: false, status: 503, json: async () => ({ error: 'unavailable' }) };
  };
  process.env.NODE_ENV = 'test';
  process.env.SALSA_CONTROL_SECRET = 'kill-switch-test-secret';

  try {
    const response = responseHarness();
    await handler({
      body: { featureKey: 'orders.pos', reason: 'اختلال در سفارش‌گیری', severity: 'high' },
      platformPrincipal: { id: 'operator-1' }
    }, response);
    assert.deepEqual(calls, []);
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.error, 'GLOBAL_KILLSWITCH_FANOUT_NOT_IMPLEMENTED');
  } finally {
    service.activate = original.activate;
    service.recordDistribution = original.recordDistribution;
    global.fetch = original.fetch;
    if (original.secret === undefined) delete process.env.SALSA_CONTROL_SECRET;
    else process.env.SALSA_CONTROL_SECRET = original.secret;
    if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original.nodeEnv;
  }
});

test('kill-switch route rejects invalid severity and past expiration before persistence', async () => {
  const router = require('../server/salsa/control-plane/routes/policy-routes');
  const route = router.stack.find(layer => layer.route?.path === '/killswitch' && layer.route.methods.post);
  const handler = route.route.stack.at(-1).handle;
  const service = require('../server/salsa/control-plane/policy/kill-switch-service');
  const originalActivate = service.activate;
  service.activate = async () => { throw new Error('must not persist invalid input'); };
  try {
    for (const body of [
      { featureKey: 'orders.pos', reason: 'incident', severity: 'unknown' },
      { featureKey: 'orders.pos', reason: 'incident', expiresAt: '2020-01-01T00:00:00.000Z' },
      { featureKey: 'orders.pos', reason: 'incident', scope: 'tenant' }
    ]) {
      const response = responseHarness();
      await handler({ body, platformPrincipal: { id: 'operator-1' } }, response);
      assert.equal(response.statusCode, 422);
      assert.equal(response.body.ok, false);
    }
  } finally {
    service.activate = originalActivate;
  }
});

test('critical kill-switch cannot bypass the missing durable second-operator approval flow', async () => {
  const router = require('../server/salsa/control-plane/routes/policy-routes');
  const route = router.stack.find(layer => layer.route?.path === '/killswitch' && layer.route.methods.post);
  const handler = route.route.stack.at(-1).handle;
  const service = require('../server/salsa/control-plane/policy/kill-switch-service');
  const original = {
    activate: service.activate,
    fetch: global.fetch,
    secret: process.env.SALSA_CONTROL_SECRET,
    nodeEnv: process.env.NODE_ENV
  };
  let persisted = false;
  let synced = false;
  service.activate = async () => { persisted = true; throw new Error('critical policy must not be persisted'); };
  global.fetch = async () => { synced = true; throw new Error('critical policy must not be distributed'); };
  process.env.NODE_ENV = 'test';
  process.env.SALSA_CONTROL_SECRET = 'critical-kill-switch-test-secret';

  try {
    const response = responseHarness();
    await handler({
      body: {
        featureKey: 'orders.pos', reason: 'اختلال بحرانی سفارش', severity: 'critical',
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      },
      platformPrincipal: { id: '11111111-1111-4111-8111-111111111111', role: 'platform_owner' }
    }, response);
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.error, 'APPROVAL_REQUIRED');
    assert.equal(persisted, false);
    assert.equal(synced, false);
  } finally {
    service.activate = original.activate;
    global.fetch = original.fetch;
    if (original.secret === undefined) delete process.env.SALSA_CONTROL_SECRET;
    else process.env.SALSA_CONTROL_SECRET = original.secret;
    if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original.nodeEnv;
  }
});

test('production global kill-switch activation and revocation fail closed before persistence or partial single-tenant sync', async () => {
  const router = require('../server/salsa/control-plane/routes/policy-routes');
  const postRoute = router.stack.find(layer => layer.route?.path === '/killswitch' && layer.route.methods.post);
  const deleteRoute = router.stack.find(layer => layer.route?.path === '/killswitch/:featureKey' && layer.route.methods.delete);
  const postHandler = postRoute.route.stack.at(-1).handle;
  const deleteHandler = deleteRoute.route.stack.at(-1).handle;
  const service = require('../server/salsa/control-plane/policy/kill-switch-service');
  const original = {
    activate: service.activate,
    findActive: service.findActive,
    revoke: service.revoke,
    fetch: global.fetch,
    nodeEnv: process.env.NODE_ENV
  };
  let touchedPersistence = false;
  let attemptedSync = false;
  service.activate = async () => { touchedPersistence = true; throw new Error('must not persist a partially delivered global policy'); };
  service.findActive = async () => { touchedPersistence = true; throw new Error('must not mutate a policy before global delivery is available'); };
  service.revoke = async () => { touchedPersistence = true; throw new Error('must not revoke before global restore is available'); };
  global.fetch = async () => { attemptedSync = true; throw new Error('must not perform a partial single-tenant sync'); };
  process.env.NODE_ENV = 'production';

  try {
    const activationResponse = responseHarness();
    await postHandler({
      body: { featureKey: 'orders.pos', reason: 'اختلال در سفارش‌گیری', severity: 'high' },
      platformPrincipal: { id: 'operator-1' }
    }, activationResponse);
    assert.equal(activationResponse.statusCode, 503);
    assert.equal(activationResponse.body.error, 'GLOBAL_KILLSWITCH_FANOUT_NOT_IMPLEMENTED');

    const revocationResponse = responseHarness();
    await deleteHandler({ params: { featureKey: 'orders.pos' }, platformPrincipal: { id: 'operator-1' } }, revocationResponse);
    assert.equal(revocationResponse.statusCode, 503);
    assert.equal(revocationResponse.body.error, 'GLOBAL_KILLSWITCH_FANOUT_NOT_IMPLEMENTED');
    assert.equal(touchedPersistence, false);
    assert.equal(attemptedSync, false);
  } finally {
    service.activate = original.activate;
    service.findActive = original.findActive;
    service.revoke = original.revoke;
    global.fetch = original.fetch;
    if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original.nodeEnv;
  }
});
