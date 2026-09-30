'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { CANONICAL_FEATURES } = require('../server/salsa/canonical-features');
const manifest = require('../server/salsa/module-manifest');
const { dependencyClosure, planModuleChange } = require('../server/salsa/module-control');

function stubTenantTransactionDatabase(calls = []) {
  const database = require('../server/salsa/control-plane/db/database');
  const originals = { getDatabase: database.getDatabase, getDatabaseClient: database.getDatabaseClient };
  const client = {
    async query(sql, params = []) {
      calls.push(`DB:${sql.trim()}`);
      if (/SELECT tenant_id FROM neem_tenants/i.test(sql)) return { rows: [{ tenant_id: params[0] }] };
      return { rows: [] };
    },
    release() { calls.push('RELEASE'); }
  };
  database.getDatabase = () => ({ type: 'policy-transaction-test' });
  database.getDatabaseClient = async () => client;
  return {
    client,
    restore() {
      database.getDatabase = originals.getDatabase;
      database.getDatabaseClient = originals.getDatabaseClient;
    }
  };
}

test('module manifest validation covers canonical ownership and dependency graphs', () => {
  const valid = manifest.validateManifest(CANONICAL_FEATURES);
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.missingFromModules, []);
  assert.deepEqual(valid.unknownModuleFeatures, []);
  assert.deepEqual(valid.unknownFeatureDependencies, []);
  assert.deepEqual(valid.featureDependencyCycles, []);

  const unknownDependency = CANONICAL_FEATURES.map(feature => ({
    ...feature,
    dependencies: feature.key === 'core.workspace' ? ['missing.capability'] : [...feature.dependencies]
  }));
  const unknownValidation = manifest.validateManifest(unknownDependency);
  assert.equal(unknownValidation.valid, false);
  assert.deepEqual(unknownValidation.unknownFeatureDependencies, ['missing.capability']);

  const duplicateValidation = manifest.validateManifest([
    ...CANONICAL_FEATURES,
    { ...CANONICAL_FEATURES[0], dependencies: [...CANONICAL_FEATURES[0].dependencies] }
  ]);
  assert.equal(duplicateValidation.valid, false);
  assert.deepEqual(duplicateValidation.duplicateCanonicalFeatures, ['core.workspace']);

  const cyclicFeatures = CANONICAL_FEATURES.map(feature => ({
    ...feature,
    dependencies: feature.key === 'core.workspace'
      ? ['core.multi_branch']
      : feature.key === 'core.multi_branch'
        ? ['core.workspace']
        : [...feature.dependencies]
  }));
  assert.equal(manifest.validateManifest(cyclicFeatures).valid, false);
  assert.ok(manifest.validateManifest(cyclicFeatures).featureDependencyCycles.length > 0);
});

test('manifest exports and returned records cannot mutate canonical licensing data', () => {
  const original = manifest.getModule('menu_qr');
  const returned = manifest.getModule('menu_qr');
  returned.priceMonthlyIrr = 1;
  returned.technicalFeatures.push('orders.pos');
  returned.catalogProvenance.priceMeaning = 'live_plan_price';

  assert.deepEqual(manifest.getModule('menu_qr'), original);
  assert.equal(manifest.getModule('injected-module'), null);
  assert.equal(Object.isFrozen(manifest.MODULES[0].technicalFeatures), true);
  assert.equal(manifest.MODULE_MAP.has('menu_qr'), true);
  assert.equal(manifest.MODULE_CATALOG_PROVENANCE.priceSource, 'static_module_manifest');
  assert.equal(original.catalogProvenance.priceMeaning, 'module_list_price_not_subscription_plan_price');
  assert.equal(original.catalogProvenance.tenantEntitlement, 'not_included');
  assert.equal(Object.hasOwn(original, 'enabled'), false);
  assert.equal(Object.hasOwn(original, 'tenantId'), false);

  manifest.MODULE_MAP.set('injected-module', original);
  assert.equal(manifest.getModule('injected-module'), null, 'mutating an exported map snapshot must not alter lookups');
  manifest.MODULE_MAP.delete('injected-module');

  const originalOwner = manifest.FEATURE_MODULE_MAP.get('catalog.menu');
  manifest.FEATURE_MODULE_MAP.set('catalog.menu', 'multi_branch');
  assert.equal(manifest.getModuleForFeature('catalog.menu').key, 'menu_qr');
  manifest.FEATURE_MODULE_MAP.set('catalog.menu', originalOwner);
});

test('module change plans fail closed on unknown modules, malformed state, and mock-shaped grants', () => {
  assert.throws(
    () => planModuleChange({ moduleKey: 'unknown-module', enabled: true }),
    /UNKNOWN_MODULE/
  );
  assert.throws(
    () => planModuleChange({ moduleKey: 'platform_core', enabled: false }),
    /MODULE_NOT_CONTROLLABLE/
  );
  assert.throws(
    () => planModuleChange({ moduleKey: 'menu_qr', enabled: 'false' }),
    /INVALID_MODULE_STATE/
  );
  assert.throws(
    () => planModuleChange({ moduleKey: 'menu_qr', enabled: true, cascade: 'false' }),
    /INVALID_CASCADE/
  );
  assert.throws(
    () => planModuleChange({ moduleKey: 'menu_qr', enabled: false, activeFeatureKeys: ['not.a.feature'] }),
    /UNKNOWN_FEATURE/
  );

  const prototypeFixture = {
    featureKey: 'orders.pos',
    isActive: true,
    sourceKind: 'mock_fixture',
    status: 'mock'
  };
  assert.throws(
    () => planModuleChange({ moduleKey: 'menu_qr', enabled: false, activeFeatureKeys: [prototypeFixture] }),
    /INVALID_ACTIVE_FEATURE_KEYS/
  );
});

test('module planning distinguishes a proposed change from a live grant or resolved plan price', () => {
  const plan = planModuleChange({ moduleKey: 'menu_qr', enabled: true });
  assert.deepEqual(plan.provenance, {
    type: 'module_change_plan',
    applied: false,
    tenantEntitlement: 'not_applied',
    pricing: 'not_evaluated'
  });
  assert.equal(plan.provenance.applied, false);
  assert.ok(Object.isFrozen(plan.provenance));
});

test('grant issuance validates commercial scope and duration while allowing included dependencies', async () => {
  const grantService = require('../server/salsa/control-plane/policy/grant-service');
  const auditService = require('../server/salsa/control-plane/audit/audit-service');
  const originals = { listGrants: grantService.listGrants, recordEvent: auditService.recordEvent };
  let inserted = false;
  grantService.listGrants = async () => [];
  auditService.recordEvent = async () => ({ id: 'audit-1' });
  const transactionClient = {
    async query(sql, params) {
      if (/INSERT INTO neem_commercial_grants/i.test(sql)) {
        inserted = true;
        return { rows: [{ id: params[0], tenant_id: params[1], feature_key: params[2] }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const database = {
    async connect() { return transactionClient; }
  };

  try {
    await assert.rejects(
      () => grantService.issueGrant({ tenantId: 'tenant-a', featureKey: 'core.multi_branch', database }),
      /PLATFORM_ACTOR_REQUIRED/
    );
    await assert.rejects(
      () => grantService.issueGrant({ tenantId: 'tenant-a', featureKey: 'core.multi_branch', actorId: 'platform-admin-1', database }),
      /MODULE_COMMERCIAL_STATE_BLOCKED/
    );
    await assert.rejects(
      () => grantService.issueGrant({ tenantId: 'tenant-a', featureKey: 'orders.pos', durationMonths: 0, actorId: 'platform-admin-1', database }),
      /INVALID_GRANT_DURATION/
    );
    const grant = await grantService.issueGrant({ tenantId: 'tenant-a', featureKey: 'catalog.menu', durationMonths: 1, actorId: 'platform-admin-1', database });
    assert.equal(grant.feature_key, 'catalog.menu');
    assert.equal(inserted, true, 'the included core.workspace dependency is satisfied by base policy');
  } finally {
    grantService.listGrants = originals.listGrants;
    auditService.recordEvent = originals.recordEvent;
  }
});

test('Control Plane module and feature catalogs omit unapproved prices and name pricing provenance', () => {
  const router = require('../server/salsa/control-plane/routes/policy-routes');
  const getRoute = path => router.stack.find(layer => layer.route?.path === path && layer.route.methods.get);
  const invoke = path => {
    const response = { body: null, json(body) { this.body = body; return this; } };
    getRoute(path).route.stack.at(-1).handle({}, response);
    return response.body.data;
  };
  const catalog = invoke('/catalog');
  const modules = invoke('/modules');
  const unapprovedPriceFields = ['priceMonthly', 'priceMonthlyIrr', 'pricePerMonth', 'basePriceMonthlyRials'];

  assert.equal(catalog.pricing.available, false);
  assert.equal(catalog.pricing.meaning, 'tenant_plan_tariff_not_configured');
  assert.equal(modules.pricing.available, false);
  assert.equal(modules.pricing.meaning, 'tenant_plan_tariff_not_configured');
  assert.ok(catalog.features.every(feature => unapprovedPriceFields.every(field => !(field in feature))));
  for (const module of [...catalog.modules, ...modules.modules]) {
    assert.ok(unapprovedPriceFields.every(field => !(field in module)), `unapproved price leaked for ${module.key}`);
    assert.equal(module.pricing.available, false);
    assert.equal(module.pricing.source, null);
  }
  assert.ok(catalog.features.some(feature => feature.baseEntitlement === true));
});

test('quote-only modules cannot be enabled through the add-on grant planner but can be revoked', () => {
  assert.throws(
    () => planModuleChange({ moduleKey: 'multi_branch', enabled: true }),
    /MODULE_COMMERCIAL_STATE_BLOCKED: multi_branch:QUOTE_REQUIRED/
  );

  const revokePlan = planModuleChange({
    moduleKey: 'multi_branch',
    enabled: false,
    activeFeatureKeys: ['core.multi_branch']
  });
  assert.deepEqual(revokePlan.featureKeys, ['finance.consolidation', 'core.multi_branch']);
  assert.equal(revokePlan.enabled, false);
});

test('dependency planning stays ordered and cascade requires explicit consent', () => {
  const enablePlan = planModuleChange({ moduleKey: 'kds', enabled: true });
  assert.ok(enablePlan.featureKeys.indexOf('orders.pos') < enablePlan.featureKeys.indexOf('kitchen.kds'));
  assert.ok(dependencyClosure(['kitchen.kds']).includes('catalog.menu'));

  assert.throws(
    () => planModuleChange({
      moduleKey: 'pos',
      enabled: false,
      activeFeatureKeys: ['orders.pos', 'kitchen.kds']
    }),
    /ACTIVE_DEPENDENTS/
  );

  const cascadePlan = planModuleChange({
    moduleKey: 'pos',
    enabled: false,
    activeFeatureKeys: ['orders.pos', 'kitchen.kds'],
    cascade: true
  });
  assert.ok(cascadePlan.featureKeys.includes('kitchen.kds'));
  assert.ok(cascadePlan.implicitFeatureKeys.includes('kitchen.kds'));
});

test('module-state route keeps one tenant scope across lookup, grants, overrides, and sync', async () => {
  const path = require('node:path');
  const routePath = path.resolve(__dirname, '../server/salsa/control-plane/routes/policy-routes.js');
  const router = require(routePath);
  const routeLayer = router.stack.find(entry => entry.route?.path === '/modules/:moduleKey/state');
  assert.ok(routeLayer, 'module-state route is registered');
  const handler = routeLayer.route.stack.at(-1).handle;

  const grantService = require('../server/salsa/control-plane/policy/grant-service');
  const overrideService = require('../server/salsa/control-plane/policy/override-service');
  const originals = {
    listGrants: grantService.listGrants,
    issueGrant: grantService.issueGrant,
    revokeGrant: grantService.revokeGrant,
    setOverride: overrideService.setOverride,
    fetch: global.fetch,
    nodeEnv: process.env.NODE_ENV,
    controlSecret: process.env.SALSA_CONTROL_SECRET
  };
  const scopeCalls = [];
  const transactionDb = stubTenantTransactionDatabase([]);
  grantService.listGrants = async tenantId => {
    scopeCalls.push(['lookup', tenantId]);
    return [];
  };
  grantService.issueGrant = async ({ tenantId, featureKey }) => {
    scopeCalls.push(['grant', tenantId, featureKey]);
    return { id: `grant-${featureKey}` };
  };
  grantService.revokeGrant = async ({ tenantId, featureKey }) => {
    scopeCalls.push(['revoke', tenantId, featureKey]);
    return { revoked: true };
  };
  overrideService.setOverride = async ({ tenantId, permissionKey }) => {
    scopeCalls.push(['override', tenantId, permissionKey]);
    return {};
  };
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    scopeCalls.push(['sync', body.tenantId]);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  process.env.NODE_ENV = 'test';
  process.env.SALSA_CONTROL_SECRET = 'module-control-test-secret-32-bytes-long';

  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };

  try {
    await handler({
      params: { moduleKey: 'menu_qr' },
      body: { tenantId: 'tenant-a', enabled: true, reason: 'Tenant scoped module test' },
      platformPrincipal: { id: 'platform-operator' }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.ok(scopeCalls.length > 1);
    assert.ok(scopeCalls.every(([, tenantId]) => tenantId === 'tenant-a'), 'all tenant-sensitive calls must use the requested tenant');
    assert.equal(scopeCalls[0][0], 'lookup');
    assert.equal(scopeCalls.at(-1)[0], 'sync');
  } finally {
    grantService.listGrants = originals.listGrants;
    grantService.issueGrant = originals.issueGrant;
    grantService.revokeGrant = originals.revokeGrant;
    overrideService.setOverride = originals.setOverride;
    transactionDb.restore();
    global.fetch = originals.fetch;
    if (originals.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originals.nodeEnv;
    if (originals.controlSecret === undefined) delete process.env.SALSA_CONTROL_SECRET;
    else process.env.SALSA_CONTROL_SECRET = originals.controlSecret;
  }
});

test('module-state route rejects string cascade values before any tenant mutation', async () => {
  const routePath = require('node:path').resolve(__dirname, '../server/salsa/control-plane/routes/policy-routes.js');
  const router = require(routePath);
  const routeLayer = router.stack.find(entry => entry.route?.path === '/modules/:moduleKey/state');
  const handler = routeLayer.route.stack.at(-1).handle;
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };

  await handler({
    params: { moduleKey: 'pos' },
    body: { tenantId: 'tenant-a', enabled: false, reason: 'Disable POS module', cascade: 'false' },
    platformPrincipal: { id: 'platform-operator' }
  }, response);

  assert.equal(response.statusCode, 422);
  assert.equal(response.body.ok, false);
  assert.match(response.body.error, /boolean cascade/);
});

test('module-state applies every grant and reset-override in one transaction and rolls back partial failures', async () => {
  const router = require('../server/salsa/control-plane/routes/policy-routes');
  const route = router.stack.find(entry => entry.route?.path === '/modules/:moduleKey/state');
  const handler = route.route.stack.at(-1).handle;
  const database = require('../server/salsa/control-plane/db/database');
  const grantService = require('../server/salsa/control-plane/policy/grant-service');
  const overrideService = require('../server/salsa/control-plane/policy/override-service');
  const originals = {
    getDatabase: database.getDatabase,
    getDatabaseClient: database.getDatabaseClient,
    listGrants: grantService.listGrants,
    issueGrant: grantService.issueGrant,
    setOverride: overrideService.setOverride,
    fetch: global.fetch
  };
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push(sql);
      return /SELECT tenant_id FROM neem_tenants/i.test(sql) ? { rows: [{ tenant_id: params[0] }] } : { rows: [] };
    },
    release() { calls.push('RELEASE'); }
  };
  let issueCount = 0;
  database.getDatabase = () => ({ type: 'transaction-test' });
  database.getDatabaseClient = async () => client;
  grantService.listGrants = async (_tenantId, options) => {
    assert.equal(options.database, client);
    return [];
  };
  grantService.issueGrant = async ({ database: transactionClient }) => {
    assert.equal(transactionClient, client);
    issueCount += 1;
    calls.push(`GRANT_${issueCount}`);
    if (issueCount === 2) throw new Error('injected second grant failure');
    return { id: `grant-${issueCount}` };
  };
  overrideService.setOverride = async ({ database: transactionClient }) => {
    assert.equal(transactionClient, client);
    calls.push('OVERRIDE');
    return {};
  };
  global.fetch = async () => { calls.push('SYNC'); return { ok: true, status: 200, json: async () => ({}) }; };

  try {
    const response = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };
    await handler({
      params: { moduleKey: 'menu_qr' },
      body: { tenantId: 'tenant-atomic', enabled: true, reason: 'Atomic module test' },
      platformPrincipal: { id: 'platform-operator' }
    }, response);

    assert.equal(response.statusCode, 500);
    assert.equal(calls[0], 'BEGIN');
    assert.ok(calls.includes('ROLLBACK'));
    assert.equal(calls.includes('COMMIT'), false);
    assert.equal(calls.includes('SYNC'), false, 'uncommitted policy must never be sent to WESTO');
    assert.equal(calls.at(-1), 'RELEASE');
  } finally {
    database.getDatabase = originals.getDatabase;
    database.getDatabaseClient = originals.getDatabaseClient;
    grantService.listGrants = originals.listGrants;
    grantService.issueGrant = originals.issueGrant;
    overrideService.setOverride = originals.setOverride;
    global.fetch = originals.fetch;
  }
});

test('grant and 1-click toggle routes report WESTO sync failures instead of false success', async () => {
  const routePath = require('node:path').resolve(__dirname, '../server/salsa/control-plane/routes/policy-routes.js');
  const router = require(routePath);
  const grantRoute = router.stack.find(entry => entry.route?.path === '/grants' && entry.route.methods.post);
  const toggleRoute = router.stack.find(entry => entry.route?.path === '/toggle' && entry.route.methods.post);
  const grantHandler = grantRoute.route.stack.at(-1).handle;
  const toggleHandler = toggleRoute.route.stack.at(-1).handle;
  const grantService = require('../server/salsa/control-plane/policy/grant-service');
  const overrideService = require('../server/salsa/control-plane/policy/override-service');
  const database = require('../server/salsa/control-plane/db/database');
  const originals = {
    getDatabase: database.getDatabase,
    getDatabaseClient: database.getDatabaseClient,
    listGrants: grantService.listGrants,
    issueGrant: grantService.issueGrant,
    revokeGrant: grantService.revokeGrant,
    setOverride: overrideService.setOverride,
    fetch: global.fetch,
    nodeEnv: process.env.NODE_ENV,
    controlSecret: process.env.SALSA_CONTROL_SECRET
  };
  const effects = [];
  const transactionClient = {
    async query(sql, params = []) {
      effects.push(`db:${sql.trim()}`);
      return /SELECT tenant_id FROM neem_tenants/i.test(sql) ? { rows: [{ tenant_id: params[0] }] } : { rows: [] };
    },
    release() { effects.push('release'); }
  };
  database.getDatabase = () => ({ type: 'policy-transaction-test' });
  database.getDatabaseClient = async () => transactionClient;
  grantService.issueGrant = async ({ database: client, featureKey }) => {
    assert.equal(client, transactionClient);
    effects.push(`grant:${featureKey}`);
    return { id: `grant-${featureKey}` };
  };
  grantService.revokeGrant = async ({ database: client, featureKey }) => {
    assert.equal(client, transactionClient);
    effects.push(`revoke:${featureKey}`);
    return { revoked: true };
  };
  grantService.listGrants = async (_tenantId, { database: client } = {}) => {
    assert.equal(client, transactionClient);
    return [];
  };
  overrideService.setOverride = async () => { effects.push('override'); return {}; };
  global.fetch = async (_url, options) => {
    effects.push(`sync:${JSON.parse(options.body).featureKeys.join(',')}`);
    return { ok: false, status: 503, json: async () => ({ error: 'unavailable' }) };
  };
  process.env.NODE_ENV = 'test';
  process.env.SALSA_CONTROL_SECRET = 'policy-route-test-secret-32-bytes-long';

  const makeResponse = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });

  try {
    const grantResponse = makeResponse();
    await grantHandler({
      body: { tenantId: 'tenant-prod', featureKey: 'orders.pos', grantKind: 'addon' },
      platformPrincipal: { id: 'operator-1' }
    }, grantResponse);
    assert.equal(grantResponse.statusCode, 502);
    assert.equal(grantResponse.body.ok, false);
    assert.equal(grantResponse.body.error, 'POLICY_SYNC_FAILED');
    assert.equal(grantResponse.body.data.policyApplied, true);

    effects.length = 0;
    const toggleResponse = makeResponse();
    await toggleHandler({
      body: { tenantId: 'tenant-prod', featureKey: 'orders.pos', enabled: true },
      platformPrincipal: { id: 'operator-1' }
    }, toggleResponse);
    assert.equal(toggleResponse.statusCode, 502);
    assert.equal(toggleResponse.body.ok, false);
    assert.equal(toggleResponse.body.data.policyApplied, true);
    assert.ok(toggleResponse.body.data.results.every(result => result.policyApplied && !result.syncedToWesto));
    assert.equal(effects.filter(effect => effect.startsWith('sync:')).length, 1, 'the entire feature set is dispatched once after commit');
    assert.equal(effects.some(effect => effect === 'override'), false, 'commercial entitlement is not represented by a personal override');
    assert.ok(effects.findIndex(effect => effect === 'db:COMMIT') < effects.findIndex(effect => effect.startsWith('sync:')));

    effects.length = 0;
    const malformedResponse = makeResponse();
    await toggleHandler({
      body: { tenantId: 'tenant-prod', featureKey: 'orders.pos', enabled: 'false' },
      platformPrincipal: { id: 'operator-1' }
    }, malformedResponse);
    assert.equal(malformedResponse.statusCode, 422);
    assert.deepEqual(effects, [], 'Malformed boolean state must be rejected before any policy mutation');
  } finally {
    grantService.listGrants = originals.listGrants;
    grantService.issueGrant = originals.issueGrant;
    grantService.revokeGrant = originals.revokeGrant;
    overrideService.setOverride = originals.setOverride;
    database.getDatabase = originals.getDatabase;
    database.getDatabaseClient = originals.getDatabaseClient;
    global.fetch = originals.fetch;
    if (originals.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originals.nodeEnv;
    if (originals.controlSecret === undefined) delete process.env.SALSA_CONTROL_SECRET;
    else process.env.SALSA_CONTROL_SECRET = originals.controlSecret;
  }
});
