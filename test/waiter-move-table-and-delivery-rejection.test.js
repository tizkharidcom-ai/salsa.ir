'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const waitlist = require('../server/waitlist');

const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

function routeHandler(startMarker, endMarker, dependencies) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `route exists: ${startMarker}`);
  const route = source.slice(start, end);
  const signature = 'async (req, res) => {';
  const bodyStart = route.indexOf(signature);
  const bodyEnd = route.lastIndexOf('\n});');
  assert.ok(bodyStart >= 0 && bodyEnd > bodyStart, `async handler can be isolated: ${startMarker}`);
  const body = route.slice(bodyStart + signature.length, bodyEnd);
  return new Function(
    ...Object.keys(dependencies),
    `return async (req, res) => {${body}\n};`,
  )(...Object.values(dependencies));
}

function response(effects) {
  return {
    statusCode: 200,
    body: null,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.headersSent = true; effects.push('response'); return this; },
  };
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function harness(initial = {}, options = {}) {
  const db = {
    branches: [{ id: 1, active: true }, { id: 2, active: true }],
    tables: [
      { id: 7, label: 'میز ۷', branchId: 1, active: true },
      { id: 8, label: 'میز ۸', branchId: 1, active: true },
      { id: 9, label: 'میز ۹', branchId: 2, active: true },
      { id: 10, label: 'میز ۱۰', branchId: 1, active: false },
    ],
    reservations: [],
    reservationSettings: { slotMinutes: 30 },
    orders: [{
      id: 101, branchId: 1, fulfillment: 'dine_in', tableNo: null, checkNo: null,
      status: 'pay_at_cashier', paymentStatus: 'unpaid', total: 250_000,
      paymentAttempts: [{ id: 501, status: 'pending', amount: 250_000 }],
    }],
    paymentAttempts: [{ id: 501, orderId: 101, status: 'pending', amount: 250_000 }],
    auditLog: [],
    ...initial,
  };
  const effects = [];
  let persistCalls = 0;
  const routeDeps = {
    db,
    crypto,
    ORDER_IDEMPOTENCY_KEY_RE: /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/,
    normalizeDigits(value) {
      return String(value ?? '').replace(/[۰-۹]/gu, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
        .replace(/[٠-٩]/gu, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
    },
    normalizeFulfillment(value, { tableNo = '' } = {}) { return value || (tableNo ? 'dine_in' : 'pickup'); },
    paymentStatusFor(order) {
      if (order.paymentStatus) return order.paymentStatus;
      if (['done', 'completed', 'picked_up', 'delivered'].includes(order.status)) return 'unknown';
      return 'unpaid';
    },
    persistedOrderBranchId(order) {
      const id = Number(routeDeps.normalizeDigits(order?.branchId));
      return Number.isSafeInteger(id) && id > 0 ? id : null;
    },
    assertUserBranchAccess(_user, branchId) {
      if (options.denyBranch === Number(branchId)) throw Object.assign(new Error('denied'), { status: 403, code: 'branch_access_denied' });
    },
    defaultBranch: () => db.branches.find((branch) => branch.active !== false),
    tableBranchId: (table) => Number(table.branchId || 1),
    tableForBranch(tableNo, branchId) {
      const normalized = routeDeps.normalizeDigits(String(tableNo)).replace(/^میز\s*/u, '').replace(/\s/gu, '');
      return db.tables.find((table) => Number(table.branchId || 1) === Number(branchId)
        && [String(table.id), String(table.label).replace(/^میز\s*/u, '')].some((value) =>
          routeDeps.normalizeDigits(value).replace(/\s/gu, '') === normalized)) || null;
    },
    tableNoBelongsToTable(tableNo, tableId) {
      const canonical = (value) => routeDeps.normalizeDigits(String(value || '')).trim()
        .replace(/^میز\s*/u, '').replace(/\s/gu, '');
      const actual = canonical(tableNo);
      const target = canonical(tableId);
      return Boolean(actual && target && (actual === target || actual.startsWith(`${target}-`)));
    },
    waitlist: {
      ...waitlist,
      tableIdsOverlap: (left, right) => {
        const canonical = (value) => routeDeps.normalizeDigits(String(value || '')).trim()
          .replace(/^میز\s*/u, '').replace(/\s/gu, '');
        const a = canonical(left);
        const b = canonical(right);
        return Boolean(a && b && (a === b || a.startsWith(`${b}-`) || b.startsWith(`${a}-`)));
      },
    },
    activeDineInOrderOnTable(order, tableNo, branchId) {
      if (!order || Number(order.branchId) !== Number(branchId)
          || routeDeps.normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo }) !== 'dine_in'
          || !routeDeps.waitlist.tableIdsOverlap(order.tableNo, tableNo)
          || String(order.status || '').toLowerCase() === 'cancelled') return false;
      const completed = ['done', 'completed', 'picked_up', 'delivered'].includes(String(order.status || '').toLowerCase());
      return !completed || ['unpaid', 'partial', 'pending', 'failed', 'unknown'].includes(routeDeps.paymentStatusFor(order));
    },
    nextDineInCheckNo(_branchId, tableNo) { return String(tableNo); },
    serializeBranchOrderMutation: async (_initial, operation) => {
      effects.push('lock');
      if (typeof options.beforeLockedOperation === 'function') await options.beforeLockedOperation(db);
      return operation();
    },
    snapshotFinanceMutationState() {
      return { orders: clone(db.orders), auditLog: clone(db.auditLog), paymentAttempts: clone(db.paymentAttempts) };
    },
    restoreFinanceMutationState(snapshot) {
      db.orders = clone(snapshot.orders);
      db.auditLog = clone(snapshot.auditLog);
      db.paymentAttempts = clone(snapshot.paymentAttempts);
    },
    async persistFinanceMutation(snapshot) {
      persistCalls += 1;
      effects.push(`persist:${persistCalls}:start`);
      if (options.failPersistCall === persistCalls) {
        routeDeps.restoreFinanceMutationState(snapshot);
        effects.push(`persist:${persistCalls}:fail`);
        throw Object.assign(new Error('durable write failed'), { status: 503, code: 'durable_write_failed' });
      }
      effects.push(`persist:${persistCalls}:done`);
    },
    recordAudit(_req, action, targetType, targetId, meta, branchId) {
      effects.push('record-audit');
      const entry = { action, targetType, targetId, meta: clone(meta), branchId };
      db.auditLog.unshift(entry);
      return entry;
    },
    appendAuditAfterCommit: () => effects.push('append-audit'),
    publishOperationalEvent: () => effects.push('event'),
    effectiveRole: (user) => user?.role || 'manager',
    operationalOrderResponse: (order) => clone(order),
    save: async () => {},
  };
  const user = { phone: '09123456789', role: 'manager' };
  const req = (overrides = {}) => ({
    params: { id: '101' }, body: {}, user, requestId: 'request-test-0001',
    get: (name) => overrides.headers?.[name.toLowerCase()] || '',
    ...overrides,
  });
  return { db, effects, deps: routeDeps, req, response: () => response(effects) };
}

const move = (deps) => routeHandler(
  "app.patch('/api/waiter/orders/:id/move-table'",
  'function cleanDeliveryZone',
  deps,
);
const reject = (deps) => routeHandler(
  "app.post('/api/delivery/orders/:id/reject'",
  "app.patch('/api/admin/orders/:id'",
  deps,
);

test('move-table re-reads inside branch serialization and keeps the unmapped dine-in assignment flow', async () => {
  const h = harness();
  const handler = move(h.deps);
  const res = h.response();
  await handler(h.req({ body: { tableNo: '۸' } }), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.order.tableNo, '8');
  assert.equal(res.body.order.checkNo, '8');
  assert.equal(res.body.idempotent, false);
  assert.deepEqual(h.effects, [
    'lock', 'persist:1:start', 'persist:1:done', 'record-audit',
    'persist:2:start', 'persist:2:done', 'append-audit', 'event', 'response',
  ]);

  const stale = harness({ orders: [{ ...h.db.orders[0], id: 101, branchId: 1, status: 'cancelled', tableNo: null }] });
  stale.deps.serializeBranchOrderMutation = async (_initial, operation) => {
    stale.effects.push('lock');
    stale.db.orders[0].status = 'done';
    stale.db.orders[0].paymentStatus = 'paid';
    return operation();
  };
  const staleRes = stale.response();
  await move(stale.deps)(stale.req({ body: { tableNo: '8' } }), staleRes);
  assert.equal(staleRes.statusCode, 409, 'the serialized re-read must reject an order closed while waiting for the lock');
  assert.equal(stale.db.orders[0].tableNo, null);
  assert.deepEqual(stale.effects, ['lock', 'response']);
});

test('move-table requires branch access and an open dine-in order but permits open orders without a mapped table', async () => {
  const denied = harness({}, { denyBranch: 1 });
  const deniedRes = denied.response();
  await move(denied.deps)(denied.req({ body: { tableNo: '8' } }), deniedRes);
  assert.equal(deniedRes.statusCode, 403);
  assert.deepEqual(denied.effects, ['response']);

  for (const order of [
    { status: 'cancelled', fulfillment: 'dine_in' },
    { status: 'done', paymentStatus: 'paid', fulfillment: 'dine_in' },
    { status: 'pay_at_cashier', fulfillment: 'delivery' },
    { status: 'pay_at_cashier', fulfillment: 'dine_in', invoiceClosed: true },
  ]) {
    const h = harness({ orders: [{ id: 101, branchId: 1, tableNo: null, paymentStatus: 'unpaid', ...order }] });
    const res = h.response();
    await move(h.deps)(h.req({ body: { tableNo: '8' } }), res);
    assert.equal(res.statusCode, 409, JSON.stringify(order));
    assert.equal(h.effects.includes('persist:1:start'), false);
  }
});

test('move-table rejects inactive, cross-branch, occupied, reserved, and seated-waitlist destinations', async () => {
  const blockedCases = [
    { tableNo: '10', expected: 'table_inactive' },
    { tableNo: '9', expected: 'table_not_found' },
    {
      tableNo: '8', expected: 'table_occupied',
      orders: [{ id: 202, branchId: 1, fulfillment: 'dine_in', tableNo: '8', status: 'preparing', paymentStatus: 'unpaid' }],
    },
    {
      tableNo: '8', expected: 'table_reserved',
      reservations: [{ id: 31, branchId: 1, tableNo: '8', date: '2099-01-01', time: '12:00', status: 'confirmed' }],
    },
    {
      tableNo: '8', expected: 'table_reserved',
      reservations: [{ id: 32, branchId: 1, source: 'walk_in', tableNo: '8', status: 'seated' }],
    },
    { tableNo: '8', expected: 'table_reserved', tables: [{ id: 8, label: 'میز ۸', branchId: 1, active: true, state: 'reserved' }] },
  ];
  for (const entry of blockedCases) {
    const { orders: otherOrders, expected, ...overrides } = entry;
    const h = harness({ ...overrides, ...(otherOrders ? { orders: [hOrder(), ...otherOrders] } : {}) });
    const res = h.response();
    await move(h.deps)(h.req({ body: { tableNo: entry.tableNo } }), res);
    assert.equal(res.statusCode, expected === 'table_not_found' ? 404 : 409);
    assert.equal(res.body.error, expected);
    assert.equal(h.effects.some((effect) => effect.startsWith('persist:')), false);
  }
});

function hOrder() {
  return { id: 101, branchId: 1, fulfillment: 'dine_in', tableNo: null, status: 'pay_at_cashier', paymentStatus: 'unpaid' };
}

test('move-table rolls back a failed durable commit, delays audit/event, and repairs audit on a safe retry', async () => {
  const h = harness({}, { failPersistCall: 1 });
  const handler = move(h.deps);
  const failed = h.response();
  await handler(h.req({ body: { tableNo: '8' } }), failed);
  assert.equal(failed.statusCode, 503);
  assert.equal(h.db.orders[0].tableNo, null);
  assert.deepEqual(h.effects, ['lock', 'persist:1:start', 'persist:1:fail', 'response']);

  const uncertain = harness({}, { failPersistCall: 2 });
  const first = uncertain.response();
  await move(uncertain.deps)(uncertain.req({ body: { tableNo: '8' } }), first);
  assert.equal(first.statusCode, 503);
  assert.equal(uncertain.db.orders[0].tableNo, '8', 'the primary movement commit remains durable if only audit persistence fails');
  assert.deepEqual(uncertain.effects, [
    'lock', 'persist:1:start', 'persist:1:done', 'record-audit', 'persist:2:start', 'persist:2:fail', 'response',
  ]);

  uncertain.deps.persistFinanceMutation = async (snapshot) => {
    uncertain.effects.push(`persist:3:start`);
    if (!Array.isArray(uncertain.db.auditLog) || !uncertain.db.auditLog.length) uncertain.deps.restoreFinanceMutationState(snapshot);
    uncertain.effects.push('persist:3:done');
  };
  const replay = uncertain.response();
  await move(uncertain.deps)(uncertain.req({ body: { tableNo: '8' } }), replay);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.idempotent, true);
  assert.deepEqual(uncertain.effects.slice(6), ['response', 'lock', 'record-audit', 'persist:3:start', 'persist:3:done', 'append-audit', 'response']);
});

test('move-table is idempotent on retry and records persistence before audit, events, and success', async () => {
  const h = harness();
  const handler = move(h.deps);
  const first = h.response();
  await handler(h.req({ body: { tableNo: '8' } }), first);
  assert.equal(first.body.idempotent, false);
  const effectsAfterCommit = h.effects.length;
  const retry = h.response();
  await handler(h.req({ body: { tableNo: '۸' } }), retry);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.idempotent, true);
  assert.deepEqual(h.effects.slice(effectsAfterCommit), ['lock', 'response']);
});

test('delivery rejection requires a reason, branch authorization, delivery fulfillment, and a pre-kitchen eligible state', async () => {
  for (const reason of ['', '  ', 'r'.repeat(501), 'bad\u0000reason']) {
    const h = harness();
    const res = h.response();
    await reject(h.deps)(h.req({ body: { reason } }), res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(h.effects, ['response']);
  }

  const denied = harness({ orders: [{ ...hOrder(), fulfillment: 'delivery' }] }, { denyBranch: 1 });
  const deniedRes = denied.response();
  await reject(denied.deps)(denied.req({ body: { reason: 'محدوده پوشش داده نمی‌شود' } }), deniedRes);
  assert.equal(deniedRes.statusCode, 403);

  for (const order of [
    { ...hOrder(), fulfillment: 'dine_in' },
    { ...hOrder(), fulfillment: 'delivery', status: 'preparing' },
    { ...hOrder(), fulfillment: 'delivery', status: 'cancelled' },
    { ...hOrder(), fulfillment: 'delivery', status: 'awaiting_confirmation', deliveryAcceptance: { status: 'accepted' } },
  ]) {
    const h = harness({ orders: [order] });
    const res = h.response();
    await reject(h.deps)(h.req({ body: { reason: 'امکان ارسال وجود ندارد' } }), res);
    assert.equal(res.statusCode, 409, JSON.stringify(order));
    assert.equal(h.effects.some((effect) => effect.startsWith('persist:')), false);
  }
});

test('delivery rejection persists attributable provenance before audit/event/response without touching payment or order status', async () => {
  const order = { ...hOrder(), fulfillment: 'delivery', status: 'awaiting_confirmation', paymentStatus: 'pending' };
  const h = harness({ orders: [order] });
  const beforePayment = clone(h.db.paymentAttempts);
  const beforeStatus = h.db.orders[0].status;
  const beforePaymentStatus = h.db.orders[0].paymentStatus;
  const res = h.response();
  await reject(h.deps)(h.req({ body: { reason: 'نشانی خارج از محدوده' }, headers: { 'idempotency-key': 'delivery-reject-001' } }), res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.idempotent, false);
  assert.deepEqual(h.db.orders[0].deliveryAcceptance, {
    status: 'rejected', source: 'restaurant', rejectedAt: h.db.orders[0].deliveryAcceptance.rejectedAt,
    rejectedBy: { phone: '09123456789', role: 'manager' }, reason: 'نشانی خارج از محدوده', reference: 'delivery-reject-001',
  });
  assert.ok(Number.isFinite(Date.parse(h.db.orders[0].deliveryAcceptance.rejectedAt)));
  assert.equal(h.db.orders[0].status, beforeStatus);
  assert.equal(h.db.orders[0].paymentStatus, beforePaymentStatus);
  assert.deepEqual(h.db.paymentAttempts, beforePayment);
  assert.deepEqual(h.effects, [
    'lock', 'persist:1:start', 'persist:1:done', 'record-audit',
    'persist:2:start', 'persist:2:done', 'append-audit', 'event', 'response',
  ]);
});

test('delivery rejection replays safely by reason, rejects conflicting reason/key, and detects cross-order key reuse', async () => {
  const h = harness({ orders: [
    { ...hOrder(), fulfillment: 'delivery', status: 'awaiting_confirmation' },
    { ...hOrder(), id: 102, fulfillment: 'delivery', status: 'awaiting_confirmation' },
  ] });
  const handler = reject(h.deps);
  const headers = { 'idempotency-key': 'delivery-reject-002' };
  const first = h.response();
  await handler(h.req({ body: { reason: 'خارج از محدوده' }, headers }), first);
  assert.equal(first.statusCode, 200);

  const replay = h.response();
  await handler(h.req({ body: { reason: 'خارج از محدوده' } }), replay);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.idempotent, true);
  assert.deepEqual(h.effects.slice(9), ['lock', 'response']);

  const conflict = h.response();
  await handler(h.req({ body: { reason: 'علت دیگری' } }), conflict);
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.body.error, 'delivery_rejection_idempotency_conflict');

  const reuse = h.response();
  await handler(h.req({ params: { id: '102' }, body: { reason: 'خارج از محدوده' }, headers }), reuse);
  assert.equal(reuse.statusCode, 409);
  assert.equal(reuse.body.error, 'delivery_rejection_idempotency_conflict');
});

test('delivery rejection rolls back an uncommitted decision on durable write failure and repairs audit-only failure on retry', async () => {
  const failed = harness({ orders: [{ ...hOrder(), fulfillment: 'delivery', status: 'awaiting_confirmation' }] }, { failPersistCall: 1 });
  const failedRes = failed.response();
  await reject(failed.deps)(failed.req({ body: { reason: 'محدوده پوشش داده نمی‌شود' } }), failedRes);
  assert.equal(failedRes.statusCode, 503);
  assert.equal(failed.db.orders[0].deliveryAcceptance, undefined);
  assert.deepEqual(failed.effects, ['lock', 'persist:1:start', 'persist:1:fail', 'response']);

  const uncertain = harness({ orders: [{ ...hOrder(), fulfillment: 'delivery', status: 'awaiting_confirmation' }] }, { failPersistCall: 2 });
  const first = uncertain.response();
  await reject(uncertain.deps)(uncertain.req({ body: { reason: 'محدوده پوشش داده نمی‌شود' } }), first);
  assert.equal(first.statusCode, 503);
  assert.equal(uncertain.db.orders[0].deliveryAcceptance.status, 'rejected');
  assert.equal(uncertain.db.auditLog.length, 0);
  assert.deepEqual(uncertain.effects, [
    'lock', 'persist:1:start', 'persist:1:done', 'record-audit', 'persist:2:start', 'persist:2:fail', 'response',
  ]);

  uncertain.deps.persistFinanceMutation = async () => uncertain.effects.push('persist:3:done');
  const retry = uncertain.response();
  await reject(uncertain.deps)(uncertain.req({ body: { reason: 'محدوده پوشش داده نمی‌شود' } }), retry);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.idempotent, true);
  assert.deepEqual(uncertain.effects.slice(7), ['lock', 'record-audit', 'persist:3:done', 'append-audit', 'response']);
});
