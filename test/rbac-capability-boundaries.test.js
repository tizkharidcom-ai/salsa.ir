'use strict';

const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');
const test = require('node:test');

const { lookupCapability, lookupPolicyCapability } = require('../server/salsa/route-capability-map');
const { createTenantContext, runWithTenantContext } = require('../server/salsa/tenant-context');
const { TenantConnectionManager } = require('../server/salsa/data-access');

const originalPolicyMode = process.env.SALSA_POLICY_MODE;
process.env.SALSA_POLICY_MODE = 'enforce';
const overrideService = require('../server/salsa/control-plane/policy/override-service');
const originalListOverrides = overrideService.listOverrides;
overrideService.listOverrides = async () => [];
const {
  assertTenantBoundary,
  buildPrincipal,
  neemRouteAwarePolicyMiddleware,
} = require('../server/salsa/westo-policy-enforcement');
const enforceRoutePolicy = neemRouteAwarePolicyMiddleware();

test.after(() => {
  overrideService.listOverrides = originalListOverrides;
  if (originalPolicyMode === undefined) delete process.env.SALSA_POLICY_MODE;
  else process.env.SALSA_POLICY_MODE = originalPolicyMode;
});

const serverSource = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
const adminV2Source = fs.readFileSync(path.join(__dirname, '../server/admin-v2.js'), 'utf8');
const accountingSource = fs.readFileSync(path.join(__dirname, '../server/accounting-routes.js'), 'utf8');
const financeV2Source = fs.readFileSync(path.join(__dirname, '../server/finance-v2.js'), 'utf8');

async function enforceRoute(role, method, route) {
  const req = {
    method,
    path: route,
    requestId: `rbac-${role}-${method}`,
    user: { id: `test-${role}`, phone: `test-${role}`, name: role, role },
    tenant: { tenantId: 'rbac-test-tenant', displayName: 'RBAC test', status: 'active' },
  };
  const res = {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let continued = false;
  await enforceRoutePolicy(req, res, () => { continued = true; });
  return { req, res, continued };
}

function assertRouteGuard(method, route, capability) {
  const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedCapability = capability.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declaration = new RegExp(
    `app\\.${method}\\('${escapedRoute}',\\s*requireCapability\\('${escapedCapability}'\\)`
  );
  assert.match(serverSource, declaration, `${method.toUpperCase()} ${route} route guard must stay ${capability}`);
}

test('accountant cannot read PII or mutate cash; cashier and manager retain cash access', async () => {
  const usersCapability = lookupPolicyCapability('GET', '/api/admin/users');
  const drawerCapability = lookupPolicyCapability('POST', '/api/admin/finance/cash-drawers/session');

  assert.equal(usersCapability, 'admin.access');
  assert.equal(lookupCapability('GET', '/api/admin/users'), 'admin.access');
  assert.equal(drawerCapability, 'cash.manage');
  assert.equal(lookupCapability('POST', '/api/admin/finance/cash-drawers/session'), 'cash.manage');
  assert.match(serverSource, /app\.get\('\/api\/admin\/users',\s*requireOwner/);
  assert.match(serverSource, /const pub = publicUser\(u\)/);
  assert.match(
    accountingSource,
    /app\.post\('\/api\/admin\/finance\/cash-drawers\/session',\s*requireCapability\('cash\.manage'\)/
  );

  const accountantPii = await enforceRoute('accountant', 'GET', '/api/admin/users');
  assert.equal(accountantPii.continued, false, 'audit-only accountant must not receive customer PII');
  assert.equal(accountantPii.res.statusCode, 403);
  assert.equal(accountantPii.res.body.capabilityKey, 'admin.access');

  const accountantCash = await enforceRoute('accountant', 'POST', '/api/admin/finance/cash-drawers/session');
  assert.equal(accountantCash.continued, false, 'finance.view must not authorize cash mutation');
  assert.equal(accountantCash.res.statusCode, 403);
  assert.equal(accountantCash.res.body.capabilityKey, 'cash.manage');

  for (const role of ['cashier', 'manager']) {
    const access = await enforceRoute(role, 'POST', '/api/admin/finance/cash-drawers/session');
    assert.equal(access.continued, true, `${role} must retain cash drawer access`);
    assert.equal(access.res.headers['X-SALSA-Shadow-Decision'], 'ALLOW');
  }
});

test('operational route policy matches its local guard and unknown private routes fail closed', async () => {
  const guardedRoutes = [
    ['GET', '/api/cashier/drawer', 'cash.manage'],
    ['GET', '/api/cashier/printer', 'payments.manage'],
    ['GET', '/api/cashier/printers/system', 'payments.manage'],
    ['PUT', '/api/cashier/printer', 'payments.manage'],
    ['POST', '/api/cashier/printer/test', 'payments.manage'],
    ['POST', '/api/cashier/orders/order-1/settle', 'payments.manage'],
    ['PATCH', '/api/cashier/orders/order-1', 'orders.manage'],
    ['POST', '/api/cashier/orders/order-1/apply-loyalty', 'orders.manage'],
    ['POST', '/api/staff/shifts/open', 'ops.view'],
    ['POST', '/api/staff/shifts/close', 'ops.view'],
    ['GET', '/api/staff/menu', 'orders.create'],
    ['POST', '/api/staff/orders/order-1/settle', 'payments.collect'],
    ['GET', '/api/admin/role-preview', 'role.preview'],
    ['GET', '/api/admin/payments', 'payments.manage'],
    ['GET', '/api/admin/qr-code', 'tables.view'],
    ['GET', '/api/admin/promo-slides', 'content.manage'],
    ['GET', '/api/admin/reservations', 'reservations.view'],
  ];
  for (const [method, route, expected] of guardedRoutes) {
    assert.equal(lookupPolicyCapability(method, route), expected, `${method} ${route}`);
    assert.equal(lookupCapability(method, route), expected, `${method} ${route} compatibility map`);
  }

  for (const [method, route] of [
    ['GET', '/api/cashier/unregistered-export'],
    ['POST', '/api/staff/unregistered-action'],
    ['PATCH', '/api/waiter/orders/order-1/refund'],
    ['POST', '/api/kitchen/unregistered-action'],
    ['GET', '/api/admin/unregistered-report'],
    ['POST', '/api/admin/v2/finance/unregistered-posting'],
  ]) {
    assert.equal(lookupPolicyCapability(method, route), 'route.unmapped', `${method} ${route}`);
    const access = await enforceRoute('waiter', method, route);
    assert.equal(access.continued, false, `${method} ${route} must deny a non-owner role`);
    assert.equal(access.res.statusCode, 403);
  }
});

test('policy principals and explicit tenant-boundary checks never fall back to a process tenant', () => {
  const missingTenant = buildPrincipal({ user: { id: 'operator-1', role: 'owner' } });
  assert.equal(missingTenant.identity.status, 'inactive');
  assert.equal(missingTenant.identity.tenantId, null);
  assert.equal(missingTenant.tenant.id, null);
  assert.deepEqual(assertTenantBoundary('tenant-a', {}), {
    ok: false,
    actual: null,
    expected: 'tenant-a',
  });

  const inconsistent = {
    tenantContext: { tenantId: 'tenant-b' },
    tenantId: 'tenant-b',
    tenant: { tenantId: 'tenant-b' },
    salsaPrincipal: { tenant: { id: 'tenant-a' } },
  };
  assert.equal(assertTenantBoundary('tenant-a', inconsistent).ok, false);
  assert.equal(assertTenantBoundary('tenant-b', inconsistent).ok, false);

  const consistent = {
    tenantContext: { tenantId: 'tenant-a', status: 'active' },
    tenantId: 'tenant-a',
    tenant: { tenantId: 'tenant-a' },
  };
  assert.equal(assertTenantBoundary('tenant-a', consistent).ok, true);
  assert.equal(buildPrincipal({
    ...consistent,
    user: { id: 'operator-1', role: ' ADMIN ' },
  }).identity.role, 'owner');
});

test('tenant pool cache refuses to silently reuse a different database binding', async () => {
  const opened = [];
  const manager = new TenantConnectionManager({
    baseUrl: 'postgres://localhost/control',
    poolFactory: (connectionString) => {
      opened.push(connectionString);
      return { on() {}, async end() {} };
    },
    logger: { error() {}, warn() {} },
  });
  const isolatedContext = createTenantContext({
    tenantId: 'tenant-a',
    tenantSlug: 'bistro-a',
    databaseName: 'tenant_tenant_a_test',
  });
  const productionContext = createTenantContext({
    tenantId: 'tenant-a',
    tenantSlug: 'bistro-a',
    databaseName: 'tenant_tenant_a',
  });

  try {
    await runWithTenantContext(isolatedContext, () => manager.getPoolForContext(isolatedContext));
    await assert.rejects(
      () => runWithTenantContext(productionContext, () => manager.getPoolForContext(productionContext)),
      /TENANT_DATABASE_BINDING_CHANGED/,
    );
    assert.equal(opened.length, 1, 'the second binding must not create or reuse a pool silently');
    assert.match(opened[0], /tenant_tenant_a_test$/);
  } finally {
    await manager.close();
  }
});

test('production tenant data access refuses a test database binding', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const manager = new TenantConnectionManager({
    baseUrl: 'postgres://localhost/control',
    poolFactory: () => { throw new Error('pool must not be opened for a test database in production'); },
    logger: { error() {}, warn() {} },
  });
  const testContext = createTenantContext({
    tenantId: 'tenant-a',
    databaseName: 'tenant_tenant_a_test',
  });
  try {
    await assert.rejects(
      () => runWithTenantContext(testContext, () => manager.getPoolForContext(testContext)),
      /TENANT_DATABASE_TEST_BINDING_FORBIDDEN/,
    );
  } finally {
    await manager.close();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test('tenant-wide customer and wallet endpoints remain owner-only until branch ownership exists', () => {
  const ownerOnlyRoutes = [
    ['get', '/api/admin/users'],
    ['get', '/api/admin/loyalty'],
    ['get', '/api/admin/club'],
    ['get', '/api/admin/loyalty/tiers'],
    ['put', '/api/admin/loyalty/tiers'],
    ['put', '/api/admin/loyalty/achievements'],
    ['post', '/api/admin/loyalty/adjust'],
    ['get', '/api/admin/wallet/summary'],
    ['post', '/api/admin/wallet/adjust'],
    ['get', '/api/admin/wallet/packages'],
    ['put', '/api/admin/wallet/packages'],
  ];

  for (const [method, route] of ownerOnlyRoutes) {
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(serverSource, new RegExp(`app\\.${method}\\('${escaped}',\\s*requireOwner`), `${method.toUpperCase()} ${route}`);
    assert.equal(lookupPolicyCapability(method, route), 'admin.access', `${method.toUpperCase()} ${route} TPEL boundary`);
  }
});

test('table management requires its own capability and every table route stays branch-scoped', async () => {
  const routes = [
    ['GET', '/api/admin/tables', 'tables.view'],
    ['PUT', '/api/admin/tables', 'tables.manage'],
    ['POST', '/api/admin/tables', 'tables.manage'],
    ['DELETE', '/api/admin/tables/sample-id', 'tables.manage'],
  ];
  for (const [method, route, capability] of routes) {
    assert.equal(lookupPolicyCapability(method, route), capability, `${method} ${route}`);
  }

  const waiterWrite = await enforceRoute('waiter', 'PUT', '/api/admin/tables');
  assert.equal(waiterWrite.continued, false, 'waiter service actions must not grant floor-plan administration');
  assert.equal(waiterWrite.res.statusCode, 403);
  const managerWrite = await enforceRoute('manager', 'PUT', '/api/admin/tables');
  assert.equal(managerWrite.continued, true, 'manager retains explicit table-management capability');

  const tableRouteStart = serverSource.indexOf("app.get('/api/admin/tables'");
  const tableRouteEnd = serverSource.indexOf('// QR artwork', tableRouteStart);
  const tableRoutes = serverSource.slice(tableRouteStart, tableRouteEnd);
  assert.match(tableRoutes, /const bid = Number\(parseBranchId\(req\)\)/);
  assert.match(tableRoutes, /filter\(\(table\) => tableBranchId\(table\) === bid\)/);
  assert.match(tableRoutes, /requestedIds\.some\(\(id\) => existingMap\.has\(id\) && tableBranchId\(existingMap\.get\(id\)\) !== bid\)/);
  const legacyDeleteStart = tableRoutes.indexOf("app.delete('/api/admin/tables/:id'");
  assert.ok(legacyDeleteStart >= 0);
  const legacyDeleteRoute = tableRoutes.slice(legacyDeleteStart);
  assert.match(legacyDeleteRoute, /return res\.status\(428\)/,
    'the unversioned delete cannot bypass the versioned layout revision guard');

  const revisionedDeleteStart = adminV2Source.indexOf("app.post('/api/admin/v2/floor/tables/delete'");
  const revisionedDeleteEnd = adminV2Source.indexOf('\n  app.', revisionedDeleteStart + 1);
  assert.ok(revisionedDeleteStart >= 0 && revisionedDeleteEnd > revisionedDeleteStart);
  const revisionedDeleteRoute = adminV2Source.slice(revisionedDeleteStart, revisionedDeleteEnd);
  assert.match(revisionedDeleteRoute, /expectedLayoutRevision/);
  assert.match(revisionedDeleteRoute, /const belongsToBranch = \(row\) => Number\(row\?\.branchId \|\| defaultBranchId\) === branchNumber/);
  assert.match(revisionedDeleteRoute, /const branchTables = asArray\(db\.tables\)\.filter\(belongsToBranch\)/);
});

test('branch CRM and feedback policies match their actual PII payloads and enforce branch scope', () => {
  assert.equal(lookupPolicyCapability('GET', '/api/admin/v2/crm'), 'pii.view');
  assert.equal(lookupCapability('GET', '/api/admin/v2/crm'), 'pii.view');
  assert.equal(lookupPolicyCapability('GET', '/api/admin/feedback'), 'pii.view');

  const feedbackStart = serverSource.indexOf("app.get('/api/admin/feedback'");
  const settingsStart = serverSource.indexOf("app.put('/api/admin/feedback/settings'", feedbackStart);
  assert.ok(feedbackStart >= 0 && settingsStart > feedbackStart);
  const listRoute = serverSource.slice(feedbackStart, settingsStart);
  assert.match(listRoute, /assertRequestBranchAccess\(req\)[\s\S]*?bid = parseBranchId\(req\)/);
  assert.match(listRoute, /Number\(f\.branchId\) === Number\(bid\)/);
  assert.match(listRoute, /branch_scope_required/);

  const updateStart = serverSource.indexOf("app.patch('/api/admin/feedback/:id'");
  const updateRoute = serverSource.slice(updateStart, serverSource.indexOf('\n});', updateStart));
  assert.match(updateRoute, /assertUserBranchAccess\(req\.user, item\.branchId\)/);
});

test('waiter policy capabilities match only the route-local waiter capability matrix', async () => {
  const waiterRoutes = [
    ['GET', '/api/waiter/calls', 'service.manage'],
    ['PATCH', '/api/waiter/calls/:id', 'service.manage'],
    ['PATCH', '/api/waiter/orders/:id', 'service.manage'],
    ['PATCH', '/api/waiter/orders/:id/status', 'service.manage'],
    ['GET', '/api/waiter/waitlist', 'reservations.receive'],
    ['POST', '/api/waiter/waitlist', 'reservations.receive'],
    ['PATCH', '/api/waiter/waitlist/:id', 'reservations.receive'],
    ['PATCH', '/api/waiter/orders/:id/fire-course', 'orders.course.manage'],
    ['POST', '/api/waiter/orders/:id/split', 'orders.split'],
    ['PATCH', '/api/waiter/orders/:id/move-table', 'orders.move_table'],
  ];
  assert.equal(
    [...serverSource.matchAll(/app\.(?:get|post|put|patch|delete)\('\/api\/waiter\//g)].length,
    waiterRoutes.length,
    'every currently registered waiter endpoint must be represented in the tested route matrix'
  );

  for (const [method, route, capability] of waiterRoutes) {
    const runtimePath = route.replace(':id', 'sample-id');
    assert.equal(lookupPolicyCapability(method, runtimePath), capability, `${method} ${route}`);
    assertRouteGuard(method.toLowerCase(), route, capability);
    const access = await enforceRoute('waiter', method, runtimePath);
    assert.equal(access.continued, true, `waiter must retain route-approved ${capability} for ${route}`);
    assert.equal(access.res.headers['X-SALSA-Shadow-Decision'], 'ALLOW');
  }

  assert.equal(
    lookupPolicyCapability('PATCH', '/api/waiter/orders/sample-id/refund'),
    'route.unmapped',
    'unregistered waiter actions must fail closed instead of inheriting a family capability'
  );
  assert.equal(
    lookupPolicyCapability('POST', '/api/waiter/admin/users'),
    'route.unmapped',
    'a new waiter path must not inherit a generic mutation permission'
  );
});

test('kitchen endpoints stay aligned with their local guards and kitchen cannot use cashier routes', async () => {
  const kitchenRoutes = [
    ['GET', '/api/kitchen/orders', 'kitchen.view'],
    ['PATCH', '/api/kitchen/orders/:id', 'kitchen.manage'],
    ['PATCH', '/api/kitchen/items/:id/availability', 'kitchen.manage'],
    ['GET', '/api/kitchen/calls', 'service.manage'],
    ['PATCH', '/api/kitchen/calls/:id', 'service.manage'],
  ];
  const kitchenInventoryRoutes = [
    ['GET', '/api/kitchen/inventory', 'inventory.view'],
    ['POST', '/api/kitchen/inventory/goods-receipts', 'inventory.receiving'],
    ['POST', '/api/kitchen/inventory/recipe-versions', 'inventory.operations'],
    ['POST', '/api/kitchen/inventory/waste', 'inventory.operations'],
    ['POST', '/api/kitchen/inventory/stock-counts', 'inventory.operations'],
    ['POST', '/api/kitchen/inventory/production-batches', 'inventory.operations'],
  ];
  assert.equal(
    [...serverSource.matchAll(/app\.(?:get|post|put|patch|delete)\('\/api\/kitchen\//g)].length
      + [...financeV2Source.matchAll(/app\.(?:get|post|put|patch|delete)\('\/api\/kitchen\//g)].length,
    kitchenRoutes.length + kitchenInventoryRoutes.length,
    'every currently registered kitchen endpoint must be represented in the tested route matrix'
  );

  for (const [method, route, capability] of kitchenRoutes) {
    const runtimePath = route.replace(':id', 'sample-id');
    assert.equal(lookupPolicyCapability(method, runtimePath), capability, `${method} ${route}`);
    const access = await enforceRoute('kitchen', method, runtimePath);
    const shouldAllow = capability !== 'service.manage';
    assert.equal(access.continued, shouldAllow, `${method} ${route} should follow the kitchen role matrix`);
    assert.equal(access.res.headers['X-SALSA-Shadow-Decision'], shouldAllow ? 'ALLOW' : 'DENY');
  }
  assert.match(serverSource, /app\.get\('\/api\/kitchen\/orders',\s*requireKitchen/);
  for (const [, route, capability] of kitchenRoutes.slice(1)) {
    const method = kitchenRoutes.find((item) => item[1] === route)[0].toLowerCase();
    assertRouteGuard(method, route, capability);
  }
  for (const [method, route, capability] of kitchenInventoryRoutes) {
    assert.equal(lookupPolicyCapability(method, route), capability, `${method} ${route}`);
    const localGuard = new RegExp(
      `app\\.${method.toLowerCase()}\\('${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}',\\s*requireCapability\\('${capability.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\)`
    );
    assert.match(financeV2Source, localGuard, `${method} ${route} must stay ${capability}`);
    const access = await enforceRoute('kitchen', method, route);
    assert.equal(access.continued, true, `kitchen must retain route-approved ${capability} for ${route}`);
  }

  const cashierRoutes = [
    ['GET', '/api/cashier/drawer'],
    ['POST', '/api/cashier/drawer/open'],
    ['POST', '/api/cashier/drawer/movements'],
    ['POST', '/api/cashier/drawer/close'],
  ];
  for (const [method, route] of cashierRoutes) {
    const capability = lookupPolicyCapability(method, route);
    assert.ok(capability, `${method} ${route} must remain policy-protected`);
    const kitchen = await enforceRoute('kitchen', method, route);
    const cashier = await enforceRoute('cashier', method, route);
    assert.equal(kitchen.continued, false, `kitchen must not use ${method} ${route}`);
    assert.equal(kitchen.res.statusCode, 403);
    assert.equal(cashier.continued, true, `cashier must retain ${method} ${route}`);
  }
});
