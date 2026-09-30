'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const grantService = require('../server/salsa/control-plane/policy/grant-service');
const database = require('../server/salsa/control-plane/db/database');
const overrideService = require('../server/salsa/control-plane/policy/override-service');
const killSwitchService = require('../server/salsa/control-plane/policy/kill-switch-service');
const policyEvaluator = require('../server/salsa/control-plane/policy/evaluator-service');
const auditService = require('../server/salsa/control-plane/audit/audit-service');

function responseHarness() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function effectiveHandler() {
  const router = require('../server/salsa/control-plane/routes/policy-routes');
  const layer = router.stack.find(entry => Array.isArray(entry.route?.path)
    ? entry.route.path.includes('/effective/:tenantId')
    : entry.route?.path === '/effective/:tenantId');
  assert.ok(layer, 'tenant-scoped effective-entitlements route is registered');
  return layer.route.stack.at(-1).handle;
}

test('commercial grant mapping follows migration 003 and normalizes active status and expiration', () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const expired = new Date(Date.now() - 60_000).toISOString();
  const base = { id: 'g1', tenant_id: 'tenant-a', feature_key: 'kitchen.kds', grant_kind: 'addon' };

  const schemaGrant = grantService.mapGrant({ ...base, is_active: true, expires_at: future });
  assert.equal(schemaGrant.status, 'active');
  assert.equal(schemaGrant.isActive, true);

  const uppercaseGrant = grantService.mapGrant({ ...base, status: 'ACTIVE', expires_at: future });
  assert.equal(uppercaseGrant.status, 'active');
  assert.equal(uppercaseGrant.isActive, true);

  const expiredGrant = grantService.mapGrant({ ...base, expires_at: expired });
  assert.equal(expiredGrant.status, 'inactive');
  assert.equal(expiredGrant.isActive, false);

  const revokedGrant = grantService.mapGrant({ ...base, is_active: false });
  assert.equal(revokedGrant.isActive, false);

  const ambiguousLegacyGrant = grantService.mapGrant({ ...base });
  assert.equal(ambiguousLegacyGrant.isActive, false, 'a row without explicit active state must not grant access');
});

test('platform principals cannot enter tenant-owner authorization and unknown modules fail closed', async () => {
  const originals = {
    listGrants: grantService.listGrants,
    listOverrides: overrideService.listOverrides
  };
  let overrideLookups = 0;
  grantService.listGrants = async () => [];
  overrideService.listOverrides = async () => { overrideLookups += 1; return [{ permissionKey: 'orders.read', state: 'allow' }]; };

  try {
    const tenant = { id: 'tenant-a', status: 'active' };
    const platformAsOwner = await policyEvaluator.evaluateAccess({
      identity: { id: 'principal-1', role: 'owner', status: 'active', principalType: 'platform' },
      tenant,
      permissionKey: 'orders.read'
    });
    assert.equal(platformAsOwner.decision, 'DENY');
    assert.match(platformAsOwner.reason, /Platform SuperAdmin/);
    assert.equal(platformAsOwner.steps[0].passed, false);
    assert.equal(overrideLookups, 0, 'platform identity is never loaded from the tenant override namespace');

    const platformRole = await policyEvaluator.evaluateAccess({
      identity: { id: 'principal-2', role: 'Platform SuperAdmin', status: 'active' },
      tenant,
      permissionKey: 'orders.read'
    });
    assert.equal(platformRole.decision, 'DENY');

    overrideService.listOverrides = async () => [];
    const restaurantOwner = await policyEvaluator.evaluateAccess({
      identity: { id: 'owner-1', role: 'owner', status: 'active', principalType: 'tenant' },
      tenant,
      permissionKey: 'orders.read'
    });
    assert.equal(restaurantOwner.decision, 'ALLOW');

    const unknownFeature = await policyEvaluator.evaluateAccess({
      identity: { id: 'owner-1', role: 'owner', status: 'active', principalType: 'tenant' },
      tenant,
      permissionKey: 'orders.read',
      featureKey: 'unknown.production.module'
    });
    assert.equal(unknownFeature.decision, 'DENY');
    assert.equal(unknownFeature.steps[2].passed, false);
  } finally {
    grantService.listGrants = originals.listGrants;
    overrideService.listOverrides = originals.listOverrides;
  }
});

test('production pricing fails closed when the durable plan repository is unavailable', async () => {
  const { PricingService } = require('../server/salsa/control-plane/billing/pricing-service');
  const unavailable = new PricingService({ db: null });
  const input = { planCode: 'production-draft', nameFa: 'پلن آزمایشی', basePriceMonthlyRials: 1, actorId: 'platform-principal-1', actorRole: 'platform_owner' };
  await assert.rejects(() => unavailable.createDraftPlan(input), error => error.code === 'BILLING_DATABASE_UNAVAILABLE');
  await assert.rejects(() => unavailable.publishPlan('starter', { actorId: 'platform-principal-1', actorRole: 'platform_owner' }), error => error.code === 'BILLING_DATABASE_UNAVAILABLE');
  await assert.rejects(() => unavailable.createCustomPlan({ tenantId: 'tenant-a', nameFa: 'قرارداد', basePriceMonthlyRials: 1, actorId: 'platform-principal-1', actorRole: 'platform_owner' }), error => error.code === 'BILLING_DATABASE_UNAVAILABLE');
  await assert.rejects(() => unavailable.calculateQuote({ planCode: 'starter', billingCycle: 'weekly' }), error => error.code === 'PRICING_VALIDATION_FAILED');
  await assert.rejects(() => unavailable.calculateQuote({ planCode: 'starter', extraBranches: 1 }), error => error.code === 'PRICING_UNSUPPORTED_QUANTITY');
  await assert.rejects(() => unavailable.calculateQuote({ planCode: 'starter' }), error => error.code === 'BILLING_DATABASE_UNAVAILABLE');
});

test('commercial grant and audit writes share one durable transaction', async () => {
  const originalAudit = auditService.recordEvent;
  const calls = [];
  const persisted = { id: 'grant-durable-id', tenant_id: 'tenant-a', feature_key: 'kitchen.kds', grant_kind: 'addon' };
  const client = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      calls.push({ sql: normalized, params });
      if (['begin', 'commit', 'rollback'].includes(normalized)) return { rows: [] };
      if (normalized.startsWith('select pg_advisory_xact_lock')) return { rows: [] };
      if (normalized.startsWith('select * from neem_commercial_grants')) {
        return { rows: [{ id: 'base-orders', tenant_id: 'tenant-a', feature_key: 'orders.pos', is_active: true }] };
      }
      if (normalized.startsWith('insert into neem_commercial_grants')) return { rows: [persisted] };
      throw new Error(`unexpected grant query: ${normalized}`);
    },
    release() { calls.push({ sql: 'release', params: [] }); }
  };
  const pool = { async connect() { return client; } };
  let auditEvent;
  auditService.recordEvent = async event => { auditEvent = event; };

  try {
    const result = await grantService.issueGrant({
      tenantId: 'tenant-a', featureKey: 'kitchen.kds', actorId: 'platform-principal-1', database: pool
    });
    assert.equal(result.id, 'grant-durable-id');
    assert.equal(auditEvent.targetId, 'grant-durable-id', 'audit points at the persisted id after conflict resolution');
    assert.equal(auditEvent.actorId, 'platform-principal-1');
    assert.equal(auditEvent.database, client);
    assert.equal(calls[0].sql, 'begin');
    assert.equal(calls.at(-2).sql, 'commit');
  } finally {
    auditService.recordEvent = originalAudit;
  }
});

test('grant audit failure rolls back durable entitlement mutation', async () => {
  const originalAudit = auditService.recordEvent;
  const statements = [];
  const client = {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      statements.push(normalized);
      if (['begin', 'commit', 'rollback'].includes(normalized) || normalized.startsWith('select pg_advisory_xact_lock')) return { rows: [] };
      if (normalized.startsWith('select * from neem_commercial_grants')) {
        return { rows: [{ id: 'base-orders', tenant_id: 'tenant-a', feature_key: 'orders.pos', is_active: true }] };
      }
      if (normalized.startsWith('insert into neem_commercial_grants')) return { rows: [{ id: 'grant-rollback-id' }] };
      throw new Error(`unexpected grant query: ${normalized}`);
    },
    release() {}
  };
  auditService.recordEvent = async () => { throw new Error('audit offline'); };
  try {
    await assert.rejects(() => grantService.issueGrant({
      tenantId: 'tenant-a', featureKey: 'kitchen.kds', actorId: 'platform-principal-1', database: { connect: async () => client }
    }), /audit offline/);
    assert.ok(statements.includes('rollback'));
    assert.equal(statements.includes('commit'), false);
  } finally {
    auditService.recordEvent = originalAudit;
  }
});

test('grant replay with the same idempotency key returns the stored row without a second write or audit', async t => {
  const originalAudit = auditService.recordEvent;
  const auditEvents = [];
  let grantRow = null;
  let insertCount = 0;
  const client = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (['begin', 'commit', 'rollback'].includes(normalized) || normalized.startsWith('select pg_advisory_xact_lock')) return { rows: [] };
      if (normalized.includes('for update')) return { rows: grantRow ? [grantRow] : [] };
      if (normalized.startsWith('select * from neem_commercial_grants')) {
        return { rows: [{ id: 'base-orders', tenant_id: 'tenant-a', feature_key: 'orders.pos', is_active: true }] };
      }
      if (normalized.startsWith('insert into neem_commercial_grants')) {
        insertCount += 1;
        grantRow = {
          id: 'grant-idempotent', tenant_id: params[1], feature_key: params[2],
          grant_kind: params[3], expires_at: params[4], granted_by: params[5], metadata: params[6]
        };
        return { rows: [grantRow] };
      }
      throw new Error(`unexpected grant query: ${normalized}`);
    },
    release() {}
  };
  const pool = { async connect() { return client; } };
  auditService.recordEvent = async event => { auditEvents.push(event); };
  t.after(() => { auditService.recordEvent = originalAudit; });

  const command = {
    tenantId: 'tenant-a', featureKey: 'kitchen.kds', actorId: 'platform-principal-9',
    idempotencyKey: 'request-123', database: pool
  };
  const first = await grantService.issueGrant(command);
  const replay = await grantService.issueGrant(command);
  assert.equal(first.id, 'grant-idempotent');
  assert.equal(replay.id, first.id);
  assert.equal(insertCount, 1);
  assert.equal(auditEvents.length, 1);
});

test('effective-entitlements resolves the canonical tenant_id and accepts active grants', async () => {
  const handler = effectiveHandler();
  const originals = {
    getDatabase: database.getDatabase,
    listGrants: grantService.listGrants,
    listOverrides: overrideService.listOverrides,
    listKillSwitches: killSwitchService.listActive
  };
  const queries = [];
  database.getDatabase = () => ({
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [{ tenant_id: 'tenant-a', status: 'active', display_name: 'Tenant A' }] };
    }
  });
  grantService.listGrants = async tenantId => {
    assert.equal(tenantId, 'tenant-a');
    return [{ featureKey: 'kitchen.kds', status: 'active', isActive: true, grantKind: 'addon' }];
  };
  overrideService.listOverrides = async () => [];
  killSwitchService.listActive = async () => [];

  try {
    const response = responseHarness();
    await handler({ params: { tenantId: 'tenant-a' }, query: {} }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.tenantStatus, 'active');
    assert.equal(response.body.data.features['kitchen.kds'].enabled, true);
    assert.match(queries[0].sql, /WHERE tenant_id = \$1/i);
    assert.deepEqual(queries[0].params, ['tenant-a']);
  } finally {
    database.getDatabase = originals.getDatabase;
    grantService.listGrants = originals.listGrants;
    overrideService.listOverrides = originals.listOverrides;
    killSwitchService.listActive = originals.listKillSwitches;
  }
});

test('suspended and archived tenants fail closed even when grants exist', async () => {
  const handler = effectiveHandler();
  const originals = {
    getDatabase: database.getDatabase,
    listGrants: grantService.listGrants,
    listOverrides: overrideService.listOverrides,
    listKillSwitches: killSwitchService.listActive
  };
  let status = 'suspended';
  database.getDatabase = () => ({ query: async () => ({ rows: [{ tenant_id: 'tenant-a', status }] }) });
  grantService.listGrants = async () => [{ featureKey: 'kitchen.kds', isActive: true }];
  overrideService.listOverrides = async () => [];
  killSwitchService.listActive = async () => [];

  try {
    for (const nextStatus of ['suspended', 'archived', 'cancelled']) {
      status = nextStatus;
      const response = responseHarness();
      await handler({ params: { tenantId: 'tenant-a' }, query: {} }, response);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.data.isSuspended, true);
      assert.equal(response.body.data.features['kitchen.kds'].enabled, false);
      assert.equal(response.body.data.features['kitchen.kds'].source, 'tenant_suspension');
    }
  } finally {
    database.getDatabase = originals.getDatabase;
    grantService.listGrants = originals.listGrants;
    overrideService.listOverrides = originals.listOverrides;
    killSwitchService.listActive = originals.listKillSwitches;
  }
});

test('effective-entitlements rejects missing tenants and does not hide database failures', async () => {
  const handler = effectiveHandler();
  const originals = {
    getDatabase: database.getDatabase,
    listGrants: grantService.listGrants
  };
  let shouldFail = false;
  database.getDatabase = () => ({
    query: async () => {
      if (shouldFail) throw new Error('database offline');
      return { rows: [] };
    }
  });
  let grantLookups = 0;
  grantService.listGrants = async () => { grantLookups += 1; return []; };

  try {
    const missing = responseHarness();
    await handler({ params: { tenantId: 'missing' }, query: {} }, missing);
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.body.error, 'TENANT_NOT_FOUND');
    assert.equal(grantLookups, 0);

    shouldFail = true;
    const unavailable = responseHarness();
    await handler({ params: { tenantId: 'tenant-a' }, query: {} }, unavailable);
    assert.equal(unavailable.statusCode, 500);
    assert.equal(grantLookups, 0, 'policy evaluation must stop when tenant status cannot be verified');
  } finally {
    database.getDatabase = originals.getDatabase;
    grantService.listGrants = originals.listGrants;
  }
});

test('personal allow overrides never manufacture tenant-wide commercial entitlement', async () => {
  const handler = effectiveHandler();
  const originals = {
    getDatabase: database.getDatabase,
    listGrants: grantService.listGrants,
    listOverrides: overrideService.listOverrides,
    listKillSwitches: killSwitchService.listActive
  };
  database.getDatabase = () => ({ query: async () => ({ rows: [{ tenant_id: 'tenant-a', status: 'active' }] }) });
  grantService.listGrants = async () => [];
  overrideService.listOverrides = async () => [{
    tenantId: 'tenant-a', userId: 'operator-1', permissionKey: 'finance.workspace',
    state: 'allow', decisionReason: 'مجاز برای کاربر'
  }];
  killSwitchService.listActive = async () => [];

  try {
    const response = responseHarness();
    await handler({ params: { tenantId: 'tenant-a' }, query: {} }, response);
    const finance = response.body.data.features['finance.workspace'];
    assert.equal(finance.enabled, false);
    assert.equal(finance.source, 'catalog');
    assert.equal(finance.baseEntitlement, false);
  } finally {
    database.getDatabase = originals.getDatabase;
    grantService.listGrants = originals.listGrants;
    overrideService.listOverrides = originals.listOverrides;
    killSwitchService.listActive = originals.listKillSwitches;
  }
});
