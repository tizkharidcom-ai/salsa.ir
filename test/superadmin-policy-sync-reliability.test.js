'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const router = require('../server/salsa/control-plane/routes/policy-routes');
const database = require('../server/salsa/control-plane/db/database');
const grantService = require('../server/salsa/control-plane/policy/grant-service');
const overrideService = require('../server/salsa/control-plane/policy/override-service');

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function createHarness() {
  const state = { calls: [], snapshots: new Map(), outbox: new Map(), grants: [], failOutboxInsert: false };
  let transactionSnapshot = null;
  const client = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      state.calls.push({ sql: normalized, params: [...params] });
      if (normalized === 'BEGIN') {
        transactionSnapshot = {
          snapshots: new Map(state.snapshots),
          outbox: new Map(state.outbox),
          grants: state.grants.map(grant => ({ ...grant }))
        };
        state.calls.push({ event: normalized });
        return { rows: [], rowCount: 0 };
      }
      if (normalized === 'COMMIT') {
        transactionSnapshot = null;
        state.calls.push({ event: normalized });
        return { rows: [], rowCount: 0 };
      }
      if (normalized === 'ROLLBACK') {
        if (transactionSnapshot) {
          state.snapshots = transactionSnapshot.snapshots;
          state.outbox = transactionSnapshot.outbox;
          state.grants = transactionSnapshot.grants;
        }
        transactionSnapshot = null;
        state.calls.push({ event: normalized });
        return { rows: [], rowCount: 0 };
      }
      if (/SELECT tenant_id FROM neem_tenants/i.test(normalized)) {
        return { rows: [{ tenant_id: params[0] }], rowCount: 1 };
      }
      if (/SELECT cell_id FROM neem_tenants/i.test(normalized)) {
        return { rows: [{ cell_id: 'cell-teh-02' }], rowCount: 1 };
      }
      if (/INSERT INTO neem_published_policies/i.test(normalized)) {
        const [version, tenantId, policyPayload, policyHash, publishedBy] = params;
        state.snapshots.set(version, { version, tenantId, policyPayload, policyHash, publishedBy });
        return { rows: [{ version }], rowCount: 1 };
      }
      if (/INSERT INTO neem_policy_outbox/i.test(normalized)) {
        if (state.failOutboxInsert) throw new Error('injected durable outbox insert failure');
        const [id, tenantId, policyVersion, targetCell] = params;
        const item = { id, tenant_id: tenantId, policy_version: policyVersion, target_cell: targetCell, status: 'pending', attempts: 0 };
        state.outbox.set(id, item);
        return { rows: [item], rowCount: 1 };
      }
      if (/UPDATE neem_policy_outbox AS candidate/i.test(normalized)) {
        const item = state.outbox.get(params[0]);
        if (!item || !['pending', 'failed'].includes(item.status)) return { rows: [], rowCount: 0 };
        item.status = 'delivering';
        item.attempts += 1;
        item.last_attempt_at = new Date();
        return { rows: [{ ...item, claimed: true }], rowCount: 1 };
      }
      if (/UPDATE neem_policy_outbox\s+SET status = \$3/i.test(normalized)) {
        const [id, attempt, status] = params;
        const item = state.outbox.get(id);
        if (!item || item.status !== 'delivering' || item.attempts !== attempt) return { rows: [], rowCount: 0 };
        item.status = status;
        return { rows: [{ id, status }], rowCount: 1 };
      }
      if (/FROM neem_policy_outbox AS o JOIN neem_published_policies/i.test(normalized)) {
        const item = state.outbox.get(params[0]);
        const snapshot = item && state.snapshots.get(item.policy_version);
        return item && snapshot
          ? { rows: [{ ...item, policy_payload: snapshot.policyPayload }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
  const route = (path, method) => {
    const layer = router.stack.find(entry => entry.route?.path === path && entry.route.methods[method]);
    assert.ok(layer, `route ${method.toUpperCase()} ${path} exists`);
    return layer.route.stack.at(-1).handle;
  };
  return { state, client, route };
}

async function withInstalledHarness(run, { syncBehavior } = {}) {
  const harness = createHarness();
  const originals = {
    getDatabase: database.getDatabase,
    getDatabaseClient: database.getDatabaseClient,
    listGrants: grantService.listGrants,
    issueGrant: grantService.issueGrant,
    listOverrides: overrideService.listOverrides,
    fetch: global.fetch,
    nodeEnv: process.env.NODE_ENV,
    controlSecret: process.env.SALSA_CONTROL_SECRET,
    cellUrl: process.env.WESTO_CELL_URL,
    cellId: process.env.WESTO_CELL_ID
  };
  database.getDatabase = () => ({ type: 'policy-sync-reliability-test' });
  database.getDatabaseClient = async () => harness.client;
  grantService.listGrants = async () => harness.state.grants.map(grant => ({ ...grant }));
  grantService.issueGrant = async ({ tenantId, featureKey, grantKind }) => {
    const grant = { id: `grant-${featureKey}`, tenantId, featureKey, grantKind, isActive: true, expiresAt: null };
    harness.state.grants = harness.state.grants.filter(item => item.featureKey !== featureKey).concat(grant);
    return grant;
  };
  overrideService.listOverrides = async () => [];
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    harness.state.calls.push({ event: 'WESTO_SYNC', body });
    if (syncBehavior) return syncBehavior(body, harness.state.calls.filter(item => item.event === 'WESTO_SYNC').length);
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true, tenantId: body.tenantId, featureKeys: body.featureKeys, enabled: body.enabled };
      }
    };
  };
  process.env.NODE_ENV = 'test';
  process.env.SALSA_CONTROL_SECRET = 'policy-sync-reliability-test-secret-32-bytes';
  delete process.env.WESTO_CELL_URL;
  delete process.env.WESTO_CELL_ID;
  try {
    return await run(harness);
  } finally {
    database.getDatabase = originals.getDatabase;
    database.getDatabaseClient = originals.getDatabaseClient;
    grantService.listGrants = originals.listGrants;
    grantService.issueGrant = originals.issueGrant;
    overrideService.listOverrides = originals.listOverrides;
    global.fetch = originals.fetch;
    if (originals.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originals.nodeEnv;
    if (originals.controlSecret === undefined) delete process.env.SALSA_CONTROL_SECRET;
    else process.env.SALSA_CONTROL_SECRET = originals.controlSecret;
    if (originals.cellUrl === undefined) delete process.env.WESTO_CELL_URL;
    else process.env.WESTO_CELL_URL = originals.cellUrl;
    if (originals.cellId === undefined) delete process.env.WESTO_CELL_ID;
    else process.env.WESTO_CELL_ID = originals.cellId;
  }
}

test('failed delivery stays non-successful and its transactional snapshot reconciles on retry', async () => {
  await withInstalledHarness(async harness => {
    const grantHandler = harness.route('/grants', 'post');
    const retryHandler = harness.route('/outbox/:id/retry', 'post');
    const failed = createResponse();
    await grantHandler({
      body: { tenantId: 'tenant-a', featureKey: 'orders.pos', grantKind: 'addon' },
      platformPrincipal: { id: 'platform-owner-1' }
    }, failed);

    assert.equal(failed.statusCode, 502);
    assert.equal(failed.body.ok, false);
    assert.equal(failed.body.error, 'POLICY_SYNC_FAILED');
    assert.equal(failed.body.data.policyApplied, true);
    assert.equal(failed.body.data.syncedToWesto, false);
    const outboxId = failed.body.data.outboxId;
    assert.ok(outboxId);
    const queued = harness.state.outbox.get(outboxId);
    assert.equal(queued.status, 'failed');
    assert.equal(queued.attempts, 1);
    const savedSnapshot = harness.state.snapshots.get(queued.policy_version);
    assert.ok(savedSnapshot.policyPayload.grants.some(grant => grant.key === 'orders.pos' && grant.active));
    const commitIndex = harness.state.calls.findIndex(call => call.event === 'COMMIT');
    const firstSyncIndex = harness.state.calls.findIndex(call => call.event === 'WESTO_SYNC');
    assert.ok(commitIndex >= 0 && commitIndex < firstSyncIndex, 'policy and outbox commit before the external request');

    queued.status = 'delivering';
    queued.last_attempt_at = new Date();
    const inProgress = createResponse();
    await retryHandler({ params: { id: outboxId } }, inProgress);
    assert.equal(inProgress.statusCode, 409);
    assert.equal(harness.state.calls.filter(call => call.event === 'WESTO_SYNC').length, 1, 'a live delivery claim prevents a concurrent retry');
    queued.status = 'failed';

    const retried = createResponse();
    await retryHandler({ params: { id: outboxId } }, retried);
    assert.equal(retried.statusCode, 200);
    assert.equal(retried.body.ok, true);
    assert.equal(retried.body.data.status, 'acknowledged');
    assert.equal(queued.status, 'acknowledged');
    assert.equal(queued.attempts, 2);
    const retryCalls = harness.state.calls.filter(call => call.event === 'WESTO_SYNC').slice(1);
    assert.ok(retryCalls.some(call => call.body.enabled && call.body.featureKeys.includes('orders.pos')));
    assert.ok(retryCalls.some(call => !call.body.enabled), 'reconciliation also clears stale entitlements absent from the snapshot');
  }, {
    syncBehavior: async (body, callNumber) => callNumber === 1
      ? { ok: false, status: 503, async json() { return { ok: false, tenantId: body.tenantId }; } }
      : {
        ok: true,
        status: 200,
        async json() { return { ok: true, tenantId: body.tenantId, featureKeys: body.featureKeys, enabled: body.enabled }; }
      }
  });
});

test('a successful grant reconciles enabled and disabled feature sets before acknowledging its snapshot', async () => {
  await withInstalledHarness(async harness => {
    const handler = harness.route('/grants', 'post');
    const response = createResponse();
    await handler({
      body: { tenantId: 'tenant-a', featureKey: 'orders.pos', grantKind: 'addon' },
      platformPrincipal: { id: 'platform-owner-1' }
    }, response);

    assert.equal(response.statusCode, 201);
    const outbox = harness.state.outbox.get(response.body.delivery.outboxId);
    assert.equal(outbox.status, 'acknowledged');
    const syncCalls = harness.state.calls.filter(call => call.event === 'WESTO_SYNC');
    assert.equal(syncCalls.length, 2, 'the complete snapshot is reconciled in both directions');
    assert.ok(syncCalls.some(call => call.body.enabled && call.body.featureKeys.includes('orders.pos')));
    assert.ok(syncCalls.some(call => !call.body.enabled && call.body.featureKeys.length > 0),
      'the acknowledged snapshot also disables stale features absent from current grants');
  });
});

test('outbox persistence failure rolls back the policy write and never calls WESTO', async () => {
  await withInstalledHarness(async harness => {
    harness.state.failOutboxInsert = true;
    const handler = harness.route('/grants', 'post');
    const response = createResponse();
    await handler({
      body: { tenantId: 'tenant-a', featureKey: 'orders.pos', grantKind: 'addon' },
      platformPrincipal: { id: 'platform-owner-1' }
    }, response);

    assert.equal(response.statusCode, 500);
    assert.equal(response.body.ok, false);
    assert.deepEqual(harness.state.grants, []);
    assert.equal(harness.state.snapshots.size, 0);
    assert.equal(harness.state.outbox.size, 0);
    assert.ok(harness.state.calls.some(call => call.event === 'ROLLBACK'));
    assert.equal(harness.state.calls.some(call => call.event === 'COMMIT'), false);
    assert.equal(harness.state.calls.some(call => call.event === 'WESTO_SYNC'), false);
  });
});

test('a 2xx response for the wrong tenant cannot acknowledge a policy outbox item', async () => {
  await withInstalledHarness(async harness => {
    const handler = harness.route('/grants', 'post');
    const response = createResponse();
    await handler({
      body: { tenantId: 'tenant-a', featureKey: 'orders.pos', grantKind: 'addon' },
      platformPrincipal: { id: 'platform-owner-1' }
    }, response);
    assert.equal(response.statusCode, 502);
    const outbox = harness.state.outbox.get(response.body.data.outboxId);
    assert.equal(outbox.status, 'failed');
    assert.equal(response.body.data.syncedToWesto, false);
  }, {
    syncBehavior: async body => ({
      ok: true,
      status: 200,
      async json() { return { ok: true, tenantId: 'another-tenant', featureKeys: body.featureKeys, enabled: body.enabled }; }
    })
  });
});

test('a production cell mismatch fails closed before any request is sent', async () => {
  await withInstalledHarness(async harness => {
    process.env.NODE_ENV = 'production';
    process.env.WESTO_CELL_URL = 'https://cell.example.test';
    process.env.WESTO_CELL_ID = 'cell-teh-01';
    const handler = harness.route('/grants', 'post');
    const response = createResponse();
    await handler({
      body: { tenantId: 'tenant-a', featureKey: 'orders.pos', grantKind: 'addon' },
      platformPrincipal: { id: 'platform-owner-1' }
    }, response);

    assert.equal(response.statusCode, 502);
    assert.equal(response.body.data.syncedToWesto, false);
    assert.equal(harness.state.calls.some(call => call.event === 'WESTO_SYNC'), false);
    assert.equal(harness.state.outbox.get(response.body.data.outboxId).status, 'failed');
  });
});

test('a non-test 2xx response without an exact tenant and feature acknowledgement is not success', async () => {
  await withInstalledHarness(async harness => {
    process.env.NODE_ENV = 'development';
    const handler = harness.route('/grants', 'post');
    const response = createResponse();
    await handler({
      body: { tenantId: 'tenant-a', featureKey: 'orders.pos', grantKind: 'addon' },
      platformPrincipal: { id: 'platform-owner-1' }
    }, response);
    assert.equal(response.statusCode, 502);
    assert.equal(harness.state.outbox.get(response.body.data.outboxId).status, 'failed');
  }, {
    syncBehavior: async () => ({ ok: true, status: 200, async json() { return { ok: true }; } })
  });
});

test('manual ACK cannot mark a policy as delivered without a verified WESTO response', async () => {
  const layer = router.stack.find(entry => entry.route?.path === '/outbox/:id/ack' && entry.route.methods.post);
  const handler = layer.route.stack.at(-1).handle;
  const response = createResponse();
  await handler({ params: { id: 'outbox-1' } }, response);
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error, 'POLICY_OUTBOX_ACK_REQUIRES_VERIFIED_DELIVERY');
});
