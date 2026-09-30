'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const financeV2 = require('../server/finance-v2');

const serverSource = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
const rolePanelSource = fs.readFileSync(path.join(__dirname, '../js/role-panel.js'), 'utf8');
const helperStart = serverSource.indexOf('// Cash drawer inputs are whole Toman amounts.');
const helperEnd = serverSource.indexOf("app.get('/api/cashier/drawer'", helperStart);
assert.notEqual(helperStart, -1, 'cash drawer helper block exists');
assert.notEqual(helperEnd, -1, 'cash drawer route follows helper block');

const helperContext = {
  module: { exports: {} },
  db: { orders: [] },
  crypto: require('node:crypto'),
  normalizeDigits: (value) => String(value ?? '')
    .replace(/[۰-۹]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))
    .replace(/[٠-٩]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit)),
  persistedOrderBranchId: (order) => Number.isSafeInteger(Number(order?.branchId)) && Number(order.branchId) > 0
    ? Number(order.branchId) : null,
};
vm.runInNewContext(`${serverSource.slice(helperStart, helperEnd)}
module.exports = {
  parseCashDrawerAmount,
  normalizeCashDrawerIdempotencyKey,
  cashDrawerMovementFingerprint,
  cashDrawerOpenRetry,
  findCashDrawerMovementRetry,
  cashDrawerPayOutExceedsAvailable,
  cashDrawerMutationQueueKey,
  withCashDrawerMutationLock,
  withCashDrawerSettlementLock,
};`, helperContext, { filename: 'server/server.js cash drawer helpers' });
const helpers = helperContext.module.exports;
function loadCashSessionTotals() {
  const helper = serverSource.match(/function cashSessionTotals\(session\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper, 'safe cash session total calculator exists');
  const context = {
    module: { exports: {} },
    normalizeDigits: helperContext.normalizeDigits,
    parseCashDrawerAmount: helpers.parseCashDrawerAmount,
  };
  vm.runInNewContext(`${helper}\nmodule.exports = cashSessionTotals;`, context, { filename: 'server/server.js cashSessionTotals' });
  return context.module.exports;
}
const roleHelperStart = rolePanelSource.indexOf('  function parseCashDrawerInput(');
const roleHelperEnd = rolePanelSource.indexOf('  async function action(', roleHelperStart);
assert.notEqual(roleHelperStart, -1, 'waiter/cashier cash input helper exists');
assert.notEqual(roleHelperEnd, -1, 'cashier action helper follows cash input helpers');
let browserKeyCounter = 0;
const browserSessionStorage = new Map();
const roleHelperContext = {
  module: { exports: {} },
  normalizeDigits: helperContext.normalizeDigits,
  crypto: { randomUUID: () => `test-key-${++browserKeyCounter}` },
  sessionStorage: {
    getItem: (key) => browserSessionStorage.get(key) ?? null,
    setItem: (key, value) => browserSessionStorage.set(key, String(value)),
    removeItem: (key) => browserSessionStorage.delete(key),
  },
};
vm.runInNewContext(`${rolePanelSource.slice(roleHelperStart, roleHelperEnd)}
module.exports = { parseCashDrawerInput, cashDrawerMovementFingerprint, cashDrawerMovementIdempotencyKey, clearCashDrawerMovementIntent };`, roleHelperContext, { filename: 'js/role-panel.js drawer helpers' });
const roleHelpers = roleHelperContext.module.exports;

test('cash amounts accept whole Persian/Arabic digits and grouped Toman, but reject invalid counts', () => {
  assert.equal(helpers.parseCashDrawerAmount('۱۲۳۴'), 1234);
  assert.equal(helpers.parseCashDrawerAmount('١٬٢٣٤'), 1234);
  assert.equal(helpers.parseCashDrawerAmount('1,234'), 1234);
  assert.equal(helpers.parseCashDrawerAmount(0, { allowZero: true }), 0);

  for (const invalid of [undefined, null, '', '   ', '-1', '1.5', '1,23', '1,,000', '۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳']) {
    assert.equal(helpers.parseCashDrawerAmount(invalid, { allowZero: true }), null, `reject ${String(invalid)}`);
  }
  assert.equal(helpers.parseCashDrawerAmount(0), null);
});

test('opening an existing drawer is idempotent only when the opening amount matches', () => {
  const session = { id: 7, openingAmount: 250000 };
  assert.equal(helpers.cashDrawerOpenRetry(null, 250000).kind, 'new');
  assert.equal(helpers.cashDrawerOpenRetry(session, 250000).kind, 'duplicate');
  assert.equal(helpers.cashDrawerOpenRetry(session, 300000).kind, 'conflict');
  assert.equal(helpers.cashDrawerOpenRetry({ id: 8 }, 0).kind, 'conflict');
});

test('cash drawer queue identity is fail-closed for tenant, branch, or cashier gaps', () => {
  const valid = { tenantId: 'tenant-test', user: { phone: 'cashier-test' } };
  assert.equal(helpers.cashDrawerMutationQueueKey(valid, 7), 'tenant-test:7:cashier-test');
  for (const [req, branchId] of [
    [{ user: { phone: 'cashier-test' } }, 7],
    [{ tenantId: 'tenant-test', user: {} }, 7],
    [valid, 0],
    [valid, Number.NaN],
  ]) {
    assert.throws(() => helpers.cashDrawerMutationQueueKey(req, branchId), (error) =>
      error.code === 'cash_drawer_lock_identity_invalid' && error.status === 409);
  }
});

test('cashier UI persists a movement key across reload-equivalent retries and clears it only after success', () => {
  const button = { dataset: {} };
  const payload = { branchId: 1, type: 'pay_in', amount: 500, note: 'خرد' };
  const first = roleHelpers.cashDrawerMovementIdempotencyKey(button, payload, 77);
  assert.equal(roleHelpers.cashDrawerMovementIdempotencyKey(button, payload, 77), first);
  assert.equal(roleHelpers.cashDrawerMovementIdempotencyKey({ dataset: {} }, payload, 77), first);
  const changedPayload = { ...payload, amount: 600 };
  const changed = roleHelpers.cashDrawerMovementIdempotencyKey(button, changedPayload, 77);
  assert.notEqual(changed, first);
  assert.equal(roleHelpers.cashDrawerMovementIdempotencyKey({ dataset: {} }, changedPayload, 77), changed);
  roleHelpers.clearCashDrawerMovementIntent(payload, 77);
  assert.notEqual(roleHelpers.cashDrawerMovementIdempotencyKey({ dataset: {} }, payload, 77), first);
  assert.notEqual(roleHelpers.cashDrawerMovementIdempotencyKey({ dataset: {} }, payload, 78), first);
  assert.equal(roleHelpers.parseCashDrawerInput({ value: '۱٬۲۳۴' }), 1234);
  assert.equal(roleHelpers.parseCashDrawerInput({ value: '' }, { allowZero: true }), null);
  assert.equal(roleHelpers.parseCashDrawerInput({ value: '۰' }, { allowZero: true }), 0);
});

test('drawer movement idempotency keys are mandatory, bounded, and consistent across header/body', () => {
  assert.equal(helpers.normalizeCashDrawerIdempotencyKey('', '').error, 'cash_movement_idempotency_required');
  assert.equal(helpers.normalizeCashDrawerIdempotencyKey('drawer-move-123456', 'drawer-move-other').error, 'cash_movement_idempotency_invalid');
  assert.equal(helpers.normalizeCashDrawerIdempotencyKey('bad key', '').error, 'cash_movement_idempotency_invalid');
  assert.equal(helpers.normalizeCashDrawerIdempotencyKey('drawer-move-123456', '').key, 'drawer-move-123456');
});

test('a drawer movement retry matches its original request and key reuse with changed details conflicts', () => {
  const session = { movements: [{ id: 3, idempotencyKey: 'drawer-move-123456', requestFingerprint: 'fingerprint-a' }] };
  const duplicate = helpers.findCashDrawerMovementRetry(session, 'drawer-move-123456', 'fingerprint-a');
  assert.equal(duplicate.kind, 'duplicate');
  assert.equal(duplicate.movement, session.movements[0]);
  const conflict = helpers.findCashDrawerMovementRetry(session, 'drawer-move-123456', 'fingerprint-b');
  assert.equal(conflict.kind, 'conflict');
  assert.equal(conflict.movement, session.movements[0]);
  assert.equal(helpers.findCashDrawerMovementRetry(session, 'drawer-move-other', 'fingerprint-a').kind, 'new');
  const fingerprint = helpers.cashDrawerMovementFingerprint({ branchId: 1, sessionId: 7, phone: 'a', type: 'pay_in', amount: 100, note: 'x' });
  assert.match(fingerprint, /^[a-f\d]{64}$/);
  assert.notEqual(fingerprint, helpers.cashDrawerMovementFingerprint({ branchId: 1, sessionId: 7, phone: 'a', type: 'pay_in', amount: 101, note: 'x' }));
});

test('drawer movement writes for a session serialize, so concurrent retries see the committed movement', async () => {
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = helpers.withCashDrawerMutationLock('tenant:1:cashier', async () => {
    events.push('first:start');
    await firstGate;
    events.push('first:end');
  });
  const second = helpers.withCashDrawerMutationLock('tenant:1:cashier', async () => {
    events.push('second:start');
    events.push('second:end');
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['first:start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
});

test('cash settlement and drawer close share one cashier-session lock through durable settlement completion', async () => {
  const cashSessionTotals = loadCashSessionTotals();
  helperContext.db.orders = [{ id: 801, branchId: 7 }];
  const req = { tenantId: 'tenant-test', user: { phone: 'cashier-test' }, body: { tender: 'cash' } };
  const session = { id: 17, openingAmount: 100, movements: [] };
  const events = [];
  let releaseSettlement;
  const settlementGate = new Promise((resolve) => { releaseSettlement = resolve; });
  const settlement = helpers.withCashDrawerSettlementLock(req, 801, async () => {
    events.push('settlement:start');
    await settlementGate;
    session.movements.unshift({ type: 'sale', amount: 50 });
    events.push('settlement:durable');
  });
  const close = helpers.withCashDrawerMutationLock(
    helpers.cashDrawerMutationQueueKey(req, 7),
    async () => {
      events.push('close:start');
      return cashSessionTotals(session).expected;
    },
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['settlement:start']);
  releaseSettlement();
  const closedExpected = await close;
  await settlement;
  assert.deepEqual(events, ['settlement:start', 'settlement:durable', 'close:start']);
  assert.equal(closedExpected, 150, 'the closeout sees the committed cash receipt exactly once');
});

test('drawer routes validate counted cash and require the idempotency path before any mutation', () => {
  const routes = serverSource.slice(helperEnd, serverSource.indexOf('registerAdminV2Routes({', helperEnd));
  assert.match(routes, /const idempotency = normalizeCashDrawerIdempotencyKey\(req\.get\('Idempotency-Key'\), req\.body\?\.idempotencyKey\)/);
  assert.match(routes, /findCashDrawerMovementRetry\(session, idempotency\.key, requestFingerprint\)/);
  assert.match(routes, /const countedAmount = parseCashDrawerAmount\(req\.body\?\.countedAmount, \{ allowZero: true \}\)/);
  assert.match(routes, /if \(countedAmount == null\) return res\.status\(400\)\.json\(\{ error: 'cash_counted_amount_invalid' \}\)/);
  assert.match(routes, /const requestedSessionId = String\(req\.body\?\.sessionId \|\| ''\)\.trim\(\)/);
  assert.match(routes, /closedSession\.closeRequestFingerprint/);
  assert.match(rolePanelSource, /sessionId: session\.id, countedAmount/);
  assert.match(routes, /app\.post\('\/api\/cashier\/drawer\/open'[\s\S]*?return withCashDrawerMutationLock\(queueKey/);
  assert.match(routes, /app\.get\('\/api\/cashier\/drawer'[\s\S]*?return withCashDrawerMutationLock\(cashDrawerMutationQueueKey\(req, branchId\)/);
  assert.match(routes, /app\.post\('\/api\/cashier\/drawer\/open'[\s\S]*?if \(!activeStaffShift\(req\.user, branchId\)\)[\s\S]*?staff_shift_not_open/);
  assert.match(routes, /cashDrawerOpenRetry\(existing, openingAmount\)/);
  assert.match(routes, /cash_drawer_opening_conflict/);
  const movementStart = routes.indexOf("app.post('/api/cashier/drawer/movements'");
  const movementEnd = routes.indexOf("app.post('/api/cashier/drawer/close'", movementStart);
  const movementRoute = routes.slice(movementStart, movementEnd);
  const retryCheck = movementRoute.indexOf('findCashDrawerMovementRetry(session, idempotency.key, requestFingerprint)');
  const duplicateReturn = movementRoute.indexOf("if (retry.kind === 'duplicate')");
  const mutationLock = movementRoute.indexOf('return withCashDrawerMutationLock(queueKey, async () => {');
  const availableGuard = movementRoute.indexOf("if (type === 'pay_out' && cashDrawerPayOutExceedsAvailable(currentTotals, rawAmount))");
  const snapshot = movementRoute.indexOf('const snapshot = snapshotFinanceMutationState()');
  const movementWrite = movementRoute.indexOf('session.movements.unshift(movement)');
  const auditWrite = movementRoute.indexOf('recordAudit(req, `cash_drawer.${type}`');
  const financeEventWrite = movementRoute.indexOf('financeV2.captureCashMovement(db, session, movement');
  assert.ok(mutationLock >= 0 && retryCheck > mutationLock && duplicateReturn > retryCheck && availableGuard > duplicateReturn);
  assert.ok(snapshot > availableGuard && movementWrite > availableGuard && auditWrite > availableGuard && financeEventWrite > availableGuard,
    'insufficient-funds guard runs before snapshot, movement, audit, and finance event writes');
  assert.match(routes, /app\.post\('\/api\/cashier\/drawer\/close'[\s\S]*?return withCashDrawerMutationLock\(queueKey/);
  const shiftCloseStart = serverSource.indexOf("app.post('/api/staff/shifts/close'");
  const shiftCloseEnd = serverSource.indexOf("// Cash drawer inputs are whole Toman amounts.", shiftCloseStart);
  const shiftCloseRoute = serverSource.slice(shiftCloseStart, shiftCloseEnd);
  assert.match(shiftCloseRoute, /return withCashDrawerMutationLock\(cashDrawerMutationQueueKey\(req, branchId\)/);
  const settlementRoutes = serverSource.slice(serverSource.indexOf("app.post('/api/cashier/orders/:id/settle'"), serverSource.indexOf("app.get('/api/cashier/printer'"));
  const cashierSettle = settlementRoutes.slice(0, settlementRoutes.indexOf("app.post('/api/staff/orders/:id/settle'"));
  const waiterSettle = settlementRoutes.slice(settlementRoutes.indexOf("app.post('/api/staff/orders/:id/settle'"));
  assert.match(cashierSettle, /withCashDrawerSettlementLock\(req, targetId/);
  assert.match(waiterSettle, /withCashDrawerSettlementLock\(req, targetId/);
  assert.match(rolePanelSource, /headers: \{ 'Idempotency-Key': idempotencyKey \}/);
  assert.match(rolePanelSource, /parseCashDrawerInput\(document\.getElementById\('drawer-counted'\), \{ allowZero: true \}\)/);
});

test('cash pay-out accepts the exact available balance and rejects one Toman more without side effects', async () => {
  const cashSessionTotals = loadCashSessionTotals();
  const session = { id: 17, openingAmount: 100, movements: [] };
  const events = [];
  const audits = [];
  const payOut = (amount, idempotencyKey) => helpers.withCashDrawerMutationLock('tenant:1:cashier', async () => {
    const totals = cashSessionTotals(session);
    if (helpers.cashDrawerPayOutExceedsAvailable(totals, amount)) {
      return { status: 409, error: 'cash_drawer_insufficient_funds', available: Math.max(0, totals.expected) };
    }
    const movement = { type: 'pay_out', amount: -amount, idempotencyKey };
    session.movements.unshift(movement);
    audits.push(movement);
    events.push(movement);
    return { status: 201, movement };
  });

  assert.equal((await payOut(100, 'drawer-out-exact-001')).status, 201);
  const rejected = await payOut(1, 'drawer-out-over-0001');
  assert.equal(rejected.status, 409);
  assert.equal(rejected.error, 'cash_drawer_insufficient_funds');
  assert.equal(rejected.available, 0);
  assert.equal(session.movements.length, 1);
  assert.equal(events.length, 1);
  assert.equal(audits.length, 1);
  assert.equal(cashSessionTotals(session).expected, 0);
});

test('concurrent pay-outs serialize the balance check and only one over-budget request commits', async () => {
  const cashSessionTotals = loadCashSessionTotals();
  const session = { id: 18, openingAmount: 100, movements: [] };
  const events = [];
  const audits = [];
  const payOut = (amount, idempotencyKey) => helpers.withCashDrawerMutationLock('tenant:1:cashier', async () => {
    const totals = cashSessionTotals(session);
    if (helpers.cashDrawerPayOutExceedsAvailable(totals, amount)) {
      return { status: 409, error: 'cash_drawer_insufficient_funds' };
    }
    const movement = { type: 'pay_out', amount: -amount, idempotencyKey };
    session.movements.unshift(movement);
    audits.push(movement);
    events.push(movement);
    return { status: 201, movement };
  });

  const results = await Promise.all([
    payOut(60, 'drawer-out-concurrent-1'),
    payOut(50, 'drawer-out-concurrent-2'),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  assert.equal(session.movements.length, 1);
  assert.equal(events.length, 1);
  assert.equal(audits.length, 1);
  assert.equal(cashSessionTotals(session).expected, Math.abs(session.movements[0].amount) === 60 ? 40 : 50);
});

test('cash closeout balance includes opening cash and every signed drawer movement', () => {
  const totalsStart = serverSource.indexOf('function cashSessionTotals(session)');
  const totalsEnd = serverSource.indexOf("app.get('/api/admin/role-preview'", totalsStart);
  assert.ok(totalsStart >= 0 && totalsEnd > totalsStart);
  const totals = serverSource.slice(totalsStart, totalsEnd);
  assert.match(totals, /Number\.isSafeInteger\(Number\(normalized\)\)/);
  assert.match(totals, /const expected = addSafe\(opening, signed\)/);
  assert.match(totals, /if \(expected == null\) return null/);
  assert.match(totals, /type === 'pay_in'/);
  assert.match(totals, /type === 'pay_out'/);
  assert.match(totals, /type === 'refund'/);
});

test('cash drawer totals preserve signed movements and fail closed on corrupt or unsafe history', () => {
  const cashSessionTotals = loadCashSessionTotals();
  assert.deepEqual(JSON.parse(JSON.stringify(cashSessionTotals({
    openingAmount: 1_000,
    movements: [
      { type: 'sale', amount: 500 },
      { type: 'pay_in', amount: 200 },
      { type: 'pay_out', amount: -100 },
      { type: 'refund', amount: -50 },
    ],
  }))), { opening: 1_000, sales: 500, payIn: 200, payOut: 100, refunds: 50, expected: 1_550 });

  for (const invalid of [
    { openingAmount: Number.MAX_SAFE_INTEGER + 1, movements: [] },
    { openingAmount: 0, movements: [{ type: 'sale', amount: 1.5 }] },
    { openingAmount: 0, movements: [{ type: 'pay_out', amount: 1 }] },
    { openingAmount: 0, movements: [{ type: 'sale', amount: Number.MAX_SAFE_INTEGER }, { type: 'pay_in', amount: 1 }] },
    { openingAmount: 0, movements: null },
    { openingAmount: 0, movements: 'corrupt' },
  ]) {
    assert.equal(cashSessionTotals(invalid), null);
  }
});

test('cash movement preserves the blocked accounting state and the cashier UI does not claim it posted', () => {
  const db = {};
  const session = { id: 'cash-session-accounting-state', branchId: 12 };
  const movement = { id: 1, type: 'pay_in', amount: 500, note: 'خرد', at: '2026-09-24T00:00:00.000Z' };
  const financeResult = financeV2.captureCashMovement(db, session, movement, { actor: 'cashier-audit' });
  assert.equal(financeResult.event.status, 'blocked');
  assert.equal(financeResult.event.error.code, 'cash_counteraccount_required');

  const routeStart = serverSource.indexOf("app.post('/api/cashier/drawer/movements'");
  const routeEnd = serverSource.indexOf("app.post('/api/cashier/drawer/close'", routeStart);
  const route = serverSource.slice(routeStart, routeEnd);
  assert.match(route, /movement\.financeStatus = financeResult\.event\.status/);
  assert.match(route, /movement\.financeEventId = financeResult\.event\.id/);
  assert.match(rolePanelSource, /در انتظار تعیین حساب مقابل؛ هنوز در دفتر کل ثبت نشده است/);
  assert.match(rolePanelSource, /در صندوق ثبت شد؛ اما تا تعیین حساب مقابل، در دفتر کل ثبت نمی‌شود/);
  assert.match(rolePanelSource, /movementResult\?\.finance\?\.event\?\.status \|\| movementResult\?\.movement\?\.financeStatus/);
});

test('cash closeout only commits after Finance V2 capture and restores state when durable save fails', () => {
  const routeStart = serverSource.indexOf("app.post('/api/cashier/drawer/close'");
  const routeEnd = serverSource.indexOf('registerAdminV2Routes({', routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  const route = serverSource.slice(routeStart, routeEnd);
  const capture = route.indexOf('financeV2.captureCashClose(db, session');
  const persist = route.indexOf('await persistFinanceMutation(snapshot)', capture);
  const rollback = route.indexOf('restoreFinanceMutationState(snapshot)', persist);
  assert.ok(capture >= 0 && persist > capture && rollback > persist);
  assert.match(route, /closeRequestFingerprint = requestFingerprint/);
  assert.match(route, /cash_drawer_close_idempotency_conflict/);
});

test('order cash collection and drawer-sale capture share the accepted settlement amount', () => {
  const handlerStart = serverSource.indexOf('const handleSettleOrder = async');
  const handlerEnd = serverSource.indexOf("app.post('/api/cashier/orders/:id/settle'", handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  const handler = serverSource.slice(handlerStart, handlerEnd);
  assert.match(handler, /const amounts = resolveSettlementAmounts\(/);
  assert.match(handler, /if \(!amounts\.ok\)/);
  assert.match(handler, /amount: requestedAmount/);
  assert.match(handler, /amount: requestedAmount,[\s\S]*?type: 'sale'/);
  assert.match(handler, /tender === 'cash' \? activeCashSession/);
  assert.match(handler, /if \(tender === 'cash' && !drawer\) return res\.status\(409\)/);
  assert.match(handler, /restoreFinanceMutationState\(snapshot\)/);
});
