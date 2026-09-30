'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  highestAssignedSeat,
  invoiceIsClosed,
  isKitchenOrderPaymentEligible,
  validateCoversForItems,
  validateWaiterKitchenSend,
  validateWaiterOrderAdd,
  validateWaiterOrderEdit,
  validateWaiterOrderLines,
} = require('../server/waiter-order-invariants');

const serverSource = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');

const basicLine = (overrides = {}) => ({ menuItemId: 7, qty: 1, ...overrides });
const pricedLine = (overrides = {}) => ({
  menuItemId: 7,
  qty: 2,
  price: 100,
  modifiers: [{ groupId: 'size', id: 'large', price: 25 }],
  complements: [{ id: 4, qty: 2, price: 30, lineTotal: 60 }],
  unitTotal: 125,
  lineTotal: 310,
  course: 'entrees',
  courseStatus: 'fired',
  ...overrides,
});
const openOrder = (overrides = {}) => ({
  id: 10,
  status: 'pay_at_cashier',
  paymentStatus: 'unpaid',
  paymentMethod: 'cashier',
  ...overrides,
});

test('covers require a valid guest count and include every assigned seat', () => {
  const items = [{ seat: 0 }, { seat: 2 }, { seat: 4 }];
  assert.equal(highestAssignedSeat(items), 4);
  assert.deepEqual(validateCoversForItems(3, items), { ok: false, error: 'seat_exceeds_covers' });
  assert.deepEqual(validateCoversForItems(4, items), { ok: true, covers: 4 });
  assert.deepEqual(validateCoversForItems(3, [{ seat: 1.5 }]), { ok: false, error: 'seat_invalid' });
});

test('cover validation fails closed when the item collection or a seat row is malformed', () => {
  assert.deepEqual(validateCoversForItems(2, null), { ok: false, error: 'items_invalid' });
  assert.deepEqual(validateCoversForItems(2, {}), { ok: false, error: 'items_invalid' });
  assert.deepEqual(validateCoversForItems(2, [null]), { ok: false, error: 'items_invalid', index: 0 });
  assert.deepEqual(validateCoversForItems(2, [[{ seat: 1 }]]), { ok: false, error: 'items_invalid', index: 0 });
});

test('guest count rejects empty, fractional, and out-of-range values', () => {
  for (const covers of [0, -1, 1.5, 100, Number.NaN, '۴']) {
    assert.deepEqual(validateCoversForItems(covers, []), { ok: false, error: 'covers_invalid' });
  }
});

test('waiter line quantities are explicit bounded integers and aliases cannot conflict', () => {
  assert.deepEqual(validateWaiterOrderLines([basicLine({ qty: 2, count: 2 })]), {
    ok: true, lineCount: 1, quantity: 2,
  });
  for (const qty of [0, -1, 1.5, 100, Number.NaN, '2x', true]) {
    assert.equal(validateWaiterOrderLines([basicLine({ qty })]).error, 'quantity_invalid', String(qty));
  }
  assert.equal(validateWaiterOrderLines([basicLine({ qty: undefined })]).error, 'quantity_required');
  assert.equal(validateWaiterOrderLines([basicLine({ qty: 1, count: 2 })]).error, 'quantity_conflict');
  assert.equal(validateWaiterOrderLines([basicLine({ qty: 99 }), basicLine({ menuItemId: 8, qty: 99 })]).quantity, 198);
});

test('each line needs a valid menu identity and an order cannot be empty', () => {
  assert.equal(validateWaiterOrderLines([]).error, 'order_items_required');
  assert.equal(validateWaiterOrderLines([basicLine({ menuItemId: 0 })]).error, 'menu_item_invalid');
  assert.equal(validateWaiterOrderLines([null]).error, 'line_invalid');
});

test('duplicate configured lines are rejected while distinct options or seats remain separate', () => {
  const line = basicLine({ modifiers: [{ groupId: 'size', id: 'regular' }] });
  assert.equal(validateWaiterOrderLines([line, { ...line }], { canonicalLines: [line, { ...line }] }).error, 'duplicate_line');
  assert.equal(validateWaiterOrderLines([
    line,
    basicLine({ modifiers: [{ groupId: 'size', id: 'large' }] }),
  ], { canonicalLines: [line, basicLine({ modifiers: [{ groupId: 'size', id: 'large' }] })] }).ok, true);
  assert.equal(validateWaiterOrderLines([line, { ...line, seat: 2 }], { canonicalLines: [line, { ...line, seat: 2 }] }).ok, true);
});

test('modifier and complement identities, counts, and totals are validated', () => {
  const selectedOption = basicLine({ modifiers: [{ groupId: 'size', id: 'large' }] });
  assert.equal(validateWaiterOrderLines([selectedOption], { canonicalLines: [selectedOption] }).ok, true);
  assert.equal(validateWaiterOrderLines([selectedOption]).error, 'canonical_lines_required');
  assert.equal(validateWaiterOrderLines([basicLine({ modifiers: [{ groupId: 'size', id: 'large' }, { groupId: 'size', id: 'large' }] })]).error, 'duplicate_option');
  assert.equal(validateWaiterOrderLines([basicLine({ modifiers: [{ groupId: 'size' }] })]).error, 'option_identity_invalid');
  assert.equal(validateWaiterOrderLines([basicLine({ complements: [{ id: 4, qty: 21 }] })]).error, 'complement_invalid');
  assert.equal(validateWaiterOrderLines([pricedLine({ complements: [{ id: 4, qty: 2, price: 30, lineTotal: 59 }] })]).error, 'complement_total_mismatch');
});

test('price amounts must be safe nonnegative integers and internally consistent', () => {
  assert.equal(validateWaiterOrderLines([pricedLine()], { canonicalLines: [pricedLine()] }).ok, true);
  assert.equal(validateWaiterOrderLines([pricedLine()]).error, 'canonical_lines_required');
  assert.equal(validateWaiterOrderLines([pricedLine({ price: -1 })]).error, 'price_invalid');
  assert.equal(validateWaiterOrderLines([pricedLine({ unitTotal: 126 })]).error, 'unit_price_mismatch');
  assert.equal(validateWaiterOrderLines([pricedLine({ lineTotal: 309 })]).error, 'line_total_mismatch');
  assert.equal(validateWaiterOrderLines([pricedLine({ unitTotal: Number.MAX_SAFE_INTEGER, lineTotal: Number.MAX_SAFE_INTEGER })]).error, 'unit_price_mismatch');
});

test('client line price and selected options must match server-canonical lines', () => {
  const canonical = pricedLine();
  assert.equal(validateWaiterOrderLines([canonical], { canonicalLines: [canonical] }).ok, true);
  assert.equal(validateWaiterOrderLines([pricedLine({ price: 101, unitTotal: 126, lineTotal: 312 })], { canonicalLines: [canonical] }).error, 'price_mismatch');
  assert.equal(validateWaiterOrderLines([
    pricedLine({ modifiers: [{ groupId: 'size', id: 'regular', price: 25 }] }),
  ], { canonicalLines: [canonical] }).error, 'options_mismatch');
  assert.equal(validateWaiterOrderLines([
    pricedLine({ complements: [{ id: 5, qty: 2, price: 30, lineTotal: 60 }] }),
  ], { canonicalLines: [canonical] }).error, 'options_mismatch');
  assert.equal(validateWaiterOrderLines([basicLine({ seat: 2 })], { canonicalLines: [basicLine({ seat: 1 })] }).error, 'seat_mismatch');
  assert.equal(validateWaiterOrderLines([basicLine({ course: 'dessert' })], { canonicalLines: [basicLine({ course: 'entrees' })] }).error, 'course_mismatch');
  assert.equal(validateWaiterOrderLines([canonical], { canonicalLines: [] }).error, 'canonical_lines_mismatch');
});

test('adding an order rejects a kitchen handoff with no fired course', () => {
  const fired = [basicLine()];
  const held = [basicLine({ courseStatus: 'hold' })];
  const served = [basicLine({ courseStatus: 'served' })];
  assert.equal(validateWaiterOrderAdd(fired, { sendToKitchen: true, canonicalLines: fired }).ok, true);
  assert.equal(validateWaiterOrderAdd(held, { sendToKitchen: true, canonicalLines: held }).error, 'kitchen_course_empty');
  assert.equal(validateWaiterOrderAdd(served, { sendToKitchen: true, canonicalLines: served }).error, 'course_already_served');
  assert.equal(validateWaiterOrderAdd(held, { canonicalLines: held }).ok, true, 'held courses may remain staged on a new order');
  assert.equal(validateWaiterOrderAdd(served, { canonicalLines: served }).error, 'course_already_served');
});

test('waiter edits are limited to open, unpaid invoices before kitchen work starts', () => {
  const lines = [basicLine()];
  const edit = (order) => validateWaiterOrderEdit(order, lines, { canonicalLines: lines });
  assert.equal(edit(openOrder()).ok, true);
  assert.equal(edit(openOrder({ status: 'sent_to_kitchen' })).ok, true, 'a queued ticket may be amended until kitchen work starts');
  for (const order of [
    openOrder({ closed: true }),
    openOrder({ invoiceClosedAt: '2026-09-23T00:00:00.000Z' }),
    openOrder({ invoiceStatus: 'settled' }),
    openOrder({ status: 'cancelled' }),
  ]) {
    assert.equal(invoiceIsClosed(order), true);
    assert.equal(edit(order).error, 'invoice_closed');
  }
  assert.equal(edit(openOrder({ status: 'preparing' })).error, 'order_edit_locked');
  assert.equal(edit(openOrder({ startedAt: 'now' })).error, 'order_edit_locked');
  assert.equal(edit(openOrder({ paymentMethod: 'online' })).error, 'order_edit_locked');
  assert.equal(edit(openOrder({ paymentStatus: 'paid' })).error, 'order_edit_payment_locked');
  assert.equal(edit(openOrder({ partialPayments: [{ amount: 1 }] })).error, 'order_edit_payment_locked');
  assert.equal(edit(openOrder({ amountPaid: 1 })).error, 'order_edit_payment_locked');
  assert.equal(edit(openOrder({ amountPaid: 'unknown' })).error, 'order_payment_state_invalid');
  assert.equal(edit(openOrder({ partialPayments: [{ amount: 0 }] })).error, 'order_payment_state_invalid');
  assert.equal(edit(openOrder({ paymentStatus: 'settle-ish' })).error, 'order_payment_state_invalid');
  assert.equal(edit(openOrder({ paymentStatus: 'cancelled' })).error, 'order_edit_payment_locked');
  assert.equal(edit(openOrder({ paymentStatus: undefined })).ok, true, 'legacy cashier orders infer unpaid before collection');
  assert.equal(edit(openOrder({ status: 'sent_to_kitchen', paymentStatus: undefined })).error, 'order_edit_payment_locked',
    'missing payment state after kitchen handoff must resolve to unknown');
  assert.equal(validateWaiterOrderEdit(null, lines, { canonicalLines: lines }).error, 'order_not_found');
  assert.equal(validateWaiterOrderEdit(openOrder(), lines).error, 'canonical_lines_required');
});

test('kitchen handoff requires an open ticket and at least one fired line', () => {
  const firedLines = [basicLine({ courseStatus: 'fired' })];
  const fire = (order, lines = firedLines) => validateWaiterKitchenSend(order, lines, { canonicalLines: lines });
  assert.deepEqual(fire(openOrder()), {
    ok: true, lineCount: 1, quantity: 1, idempotent: false,
  });
  assert.equal(fire(openOrder(), [basicLine({ courseStatus: 'hold' })]).error, 'kitchen_course_empty');
  assert.equal(fire(openOrder({ status: 'sent_to_kitchen' }), [basicLine()]).idempotent, true);
  assert.equal(fire(openOrder({ status: 'preparing' })).error, 'kitchen_send_locked');
  assert.equal(fire(openOrder({ status: 'pending_online', paymentStatus: 'pending' })).error, 'payment_not_confirmed');
  assert.equal(fire(openOrder({ status: 'pending_online', paymentStatus: 'paid' })).error, 'payment_not_confirmed');
  for (const paymentStatus of ['settle-ish', 'cancelled', 'refunded', 'pending', 'unknown']) {
    assert.equal(fire(openOrder({ paymentStatus })).error, 'payment_not_confirmed', paymentStatus);
  }
  assert.equal(fire(openOrder({ status: 'sent_to_kitchen', paymentStatus: undefined })).error, 'payment_not_confirmed');
  assert.equal(fire(openOrder({ closed: true })).error, 'invoice_closed');
  assert.equal(fire(openOrder({ status: 'cancelled' })).error, 'invoice_closed');
  const duplicate = [basicLine(), basicLine()];
  assert.equal(fire(openOrder(), duplicate).error, 'duplicate_line');
  assert.equal(validateWaiterKitchenSend(openOrder(), firedLines).error, 'canonical_lines_required');
});

test('kitchen payment eligibility accepts only active ticket states and known reconciled payment states', () => {
  assert.equal(isKitchenOrderPaymentEligible({ status: 'sent_to_kitchen' }, 'unpaid'), true);
  assert.equal(isKitchenOrderPaymentEligible({ status: 'preparing' }, 'failed'), true);
  assert.equal(isKitchenOrderPaymentEligible({ status: 'paid' }, 'paid'), true);
  for (const status of [undefined, 'pay_at_cashier', 'awaiting_confirmation', 'pending_online', 'done', 'cancelled']) {
    assert.equal(isKitchenOrderPaymentEligible({ status }, 'unpaid'), false, String(status));
  }
  for (const paymentStatus of [undefined, '', 'pending', 'cancelled', 'refunded', 'unknown', 'settle-ish']) {
    assert.equal(isKitchenOrderPaymentEligible({ status: 'sent_to_kitchen' }, paymentStatus), false, String(paymentStatus));
  }
  assert.equal(isKitchenOrderPaymentEligible({ status: 'paid' }, 'unpaid'), false);
});

test('waiter and KDS order mutations retain fail-closed branch scoping', () => {
  const editStart = serverSource.indexOf('const handleEditOrder = async');
  const editEnd = serverSource.indexOf("app.patch('/api/cashier/orders/:id'", editStart);
  const editRoute = serverSource.slice(editStart, editEnd);
  const editLookup = editRoute.indexOf(".find((item) => Number(item.id) === targetId)");
  const editScope = editRoute.indexOf('assertUserBranchAccess(req.user, order.branchId)');
  const editMutation = editRoute.indexOf('adjustOrderInventory(normalized.lines, -1');
  assert.ok(editLookup >= 0 && editScope > editLookup && editMutation > editScope);

  const waiterStatusStart = serverSource.indexOf("app.patch('/api/waiter/orders/:id/status'");
  const waiterStatusEnd = serverSource.indexOf('\n});', waiterStatusStart);
  const waiterStatusRoute = serverSource.slice(waiterStatusStart, waiterStatusEnd);
  const statusLookup = waiterStatusRoute.indexOf(".find((item) => Number(item.id) === targetId)");
  const statusScope = waiterStatusRoute.indexOf('assertUserBranchAccess(req.user, order.branchId)');
  const statusMutation = waiterStatusRoute.indexOf("appendOrderStatus(order, next");
  assert.ok(statusLookup >= 0 && statusScope > statusLookup && statusMutation > statusScope);

  const kdsMutationStart = serverSource.indexOf("app.patch('/api/kitchen/orders/:id'");
  const kdsMutationEnd = serverSource.indexOf('\n});', kdsMutationStart);
  const kdsMutationRoute = serverSource.slice(kdsMutationStart, kdsMutationEnd);
  assert.ok(kdsMutationRoute.indexOf('requestedKdsBranch(req)') >= 0);
  assert.match(kdsMutationRoute, /\.find\(\(o\) => Number\(o\.id\) === targetId && Number\(o\.branchId\) === Number\(branchId\)\)/);

  const branchResolverStart = serverSource.indexOf('function requestedKdsBranch(req)');
  const branchResolverEnd = serverSource.indexOf('\nfunction kdsIdempotent', branchResolverStart);
  const branchResolver = serverSource.slice(branchResolverStart, branchResolverEnd);
  assert.match(branchResolver, /if \(!branch \|\| \(allowedBranchIds !== null && !allowedBranchIds\.includes\(Number\(branch\.id\)\)\)\) return null/);
});
