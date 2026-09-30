'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');
const { registerAccountingRoutes, __test } = require('../server/accounting-routes');

const accountingSource = fs.readFileSync(path.join(__dirname, '../server/accounting-routes.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
const financeV2Source = fs.readFileSync(path.join(__dirname, '../server/finance-v2.js'), 'utf8');

function registerRoutes() {
  const routes = new Map();
  const app = {};
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    app[method] = (paths, ...handlers) => {
      for (const routePath of Array.isArray(paths) ? paths : [paths]) {
        routes.set(`${method.toUpperCase()} ${routePath}`, handlers.at(-1));
      }
    };
  }
  let saveCalls = 0;
  const db = { accounting: { cashDrawers: [{ id: 'drawer-a', branchId: 1, status: 'open' }] } };
  registerAccountingRoutes({
    app,
    getDb: () => db,
    save: () => { saveCalls += 1; },
    requireAdmin: () => (_req, _res, next) => next?.(),
    requireCapability: () => (_req, _res, next) => next?.(),
    parseBranchId: (req) => Number(req.body?.branchId || req.query?.branchId || 1),
  });
  return { routes, db, get saveCalls() { return saveCalls; } };
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('cash-drawer reads filter a selected branch and hide unassigned legacy sessions', () => {
  const rows = [
    { id: 1, branchId: 1 },
    { id: 2, branchId: 2 },
    { id: 3 },
  ];
  const scoped = __test.branchScopedRows({ user: { allowedBranchIds: [1] } }, rows, 1);
  assert.deepEqual(scoped.map((row) => row.id), [1]);
  const consolidatedOwner = __test.branchScopedRows({ user: { role: 'owner' } }, rows, null);
  assert.equal(consolidatedOwner.length, 3);
  const selectedOwnerBranch = __test.branchScopedRows({ user: { role: 'owner' } }, rows, 2);
  assert.deepEqual(selectedOwnerBranch.map((row) => row.id), [2]);
});

test('legacy finance drawer mutations fail closed before loading or saving accounting state', () => {
  const harness = registerRoutes();
  const handler = harness.routes.get('POST /api/admin/finance/cash-drawers/session');
  const res = responseRecorder();
  handler({ body: { action: 'close', sessionId: 'drawer-a', closingCash: 999, branchId: 1 } }, res);

  assert.equal(res.statusCode, 410);
  assert.equal(res.body.error.code, 'cash_drawer_v2_required');
  assert.equal(res.body.meta.replacement, '/api/cashier/drawer');
  assert.equal(harness.saveCalls, 0);
  assert.equal(harness.db.accounting.cashDrawers[0].status, 'open');
  assert.doesNotMatch(accountingSource.slice(
    accountingSource.indexOf("app.post('/api/admin/finance/cash-drawers/session'"),
    accountingSource.indexOf('// ── 7. Settlements & POS Clearing'),
  ), /engine\.reconciliationEngine\.closeCashDrawer|acc\.cashDrawers\.unshift/);
});

test('cashier closeout resolves the requested authorized branch before selecting an active session', () => {
  const routeStart = serverSource.indexOf("app.post('/api/cashier/drawer/close'");
  const routeEnd = serverSource.indexOf("registerAdminV2Routes({", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  const route = serverSource.slice(routeStart, routeEnd);
  const branch = route.indexOf('const branchId = parseBranchId(req)');
  const queue = route.indexOf('withCashDrawerMutationLock(queueKey');
  const session = route.indexOf('const session = activeCashSession(req.user, branchId)');
  assert.ok(branch >= 0 && queue > branch && session > queue);
  assert.match(route, /Number\(item\.branchId\) === Number\(branchId\)/);
  assert.match(route, /restoreFinanceMutationState\(snapshot\)/);
});

test('legacy settlements are read-only; batch posting is owned by Finance V2 reconciliation', () => {
  const harness = registerRoutes();
  const handler = harness.routes.get('POST /api/admin/finance/settlements');
  const res = responseRecorder();
  handler({ body: { branchId: 1, grossAmount: 1000, feeAmount: 10 } }, res);

  assert.equal(res.statusCode, 410);
  assert.equal(res.body.error.code, 'finance_v2_required');
  assert.equal(res.body.meta.replacement, '/api/admin/v2/finance/reconciliation/settlements');
  assert.equal(harness.saveCalls, 0);
  const settlementStart = financeV2Source.indexOf("app.post('/api/admin/v2/finance/reconciliation/settlements'");
  const settlementEnd = financeV2Source.indexOf("app.post('/api/admin/v2/finance/reconciliation/bank-statement-lines'", settlementStart);
  assert.ok(settlementStart >= 0 && settlementEnd > settlementStart);
  const canonicalRoute = financeV2Source.slice(settlementStart, settlementEnd);
  assert.match(canonicalRoute, /Idempotency-Key/);
  assert.match(canonicalRoute, /recordSettlementV2\(db/);
  assert.match(canonicalRoute, /await save\(\{ requireDurable: true \}\)/);
});
