'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  orderCancellationGuard,
  receivedAmount,
  netReceivedAmount,
  shouldReleaseOrderInventory,
} = require('../server/order-cancellation-guard');
const { canTransitionOrder } = require('../server/command-center');

const serverSource = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
const unpaidPreKitchenOrder = (overrides = {}) => ({
  status: 'pay_at_cashier',
  paymentStatus: 'unpaid',
  ...overrides,
});

test('known pre-kitchen states with an explicitly safe payment state may be cancelled and release stock', () => {
  for (const status of [
    'pending_online',
    'awaiting_confirmation',
    'pay_at_cashier',
  ]) {
    const cancellation = orderCancellationGuard({ status, paymentStatus: 'unpaid' });
    assert.equal(cancellation.ok, true, status);
    assert.equal(cancellation.cancellationStage, 'pre_kitchen', status);
    assert.equal(cancellation.inventoryReleaseAllowed, true, status);
    assert.equal(orderCancellationGuard({ status, paymentStatus: 'failed' }).ok, true, `${status}:failed`);
    assert.equal(canTransitionOrder({ status, paymentStatus: 'unpaid' }, 'cancelled'), true, status);
  }

  // The existing order contract derives unpaid only for the cashier handoff state.
  assert.equal(orderCancellationGuard({ status: 'pay_at_cashier' }).ok, true);
});

test('missing, malformed, and future order states fail closed', () => {
  for (const order of [
    undefined,
    null,
    {},
    { paymentStatus: 'unpaid' },
    { status: 'pending', paymentStatus: 'unpaid' },
    { status: 'pending_cashier', paymentStatus: 'unpaid' },
    { status: 'future_order_state', paymentStatus: 'unpaid' },
  ]) {
    assert.equal(orderCancellationGuard(order).ok, false, String(order?.status || 'missing order'));
  }

  assert.equal(
    orderCancellationGuard({ status: 'pay_at_cashier', paymentStatus: 'future_payment_state' }).code,
    'payment_status_reconciliation_required',
  );
});

test('paid, partially paid, or otherwise received orders remain blocked without an explicit refund path', () => {
  for (const order of [
    { status: 'pay_at_cashier', paymentStatus: 'paid' },
    { status: 'pay_at_cashier', paymentStatus: 'partial' },
    { status: 'pay_at_cashier', paymentStatus: 'unpaid', amountPaid: 25 },
    { status: 'pay_at_cashier', paymentStatus: 'failed', partialPayments: [{ amount: 25 }] },
    { status: 'paid', paymentStatus: 'failed' },
    { status: 'preparing', paymentStatus: 'unpaid', amountPaid: 1 },
    { status: 'cancelled', paymentStatus: 'paid' },
  ]) {
    assert.equal(orderCancellationGuard(order).code, 'order_refund_required', JSON.stringify(order));
  }
});

test('duplicate cancellation is rejected by the guard without mutating the order', () => {
  for (const status of ['cancelled', 'CANCELLED']) {
    const order = { status, paymentStatus: 'unpaid', amountPaid: 0, items: [{ qty: 2, stock: 7 }] };
    const before = structuredClone(order);
    assert.equal(orderCancellationGuard(order).code, 'order_already_cancelled');
    assert.deepEqual(order, before);
  }
});

test('cancelled payment attempts, pending attempts, and unknown states require reconciliation', () => {
  for (const order of [
    { status: 'pay_at_cashier', paymentStatus: 'pending' },
    { status: 'pay_at_cashier', paymentStatus: 'unknown' },
    { status: 'pay_at_cashier', paymentStatus: 'cancelled' },
    { status: 'pay_at_cashier', paymentStatus: 'refunded' },
    { status: 'awaiting_confirmation' },
    { status: 'preparing' },
  ]) {
    assert.equal(orderCancellationGuard(order).code, 'payment_status_reconciliation_required', JSON.stringify(order));
  }
});

test('online orders require gateway reconciliation even when the order summary says unpaid or failed', () => {
  for (const paymentStatus of ['unpaid', 'failed']) {
    const order = {
      status: 'pay_at_cashier',
      paymentStatus,
      paymentMethod: 'online',
      amountPaid: 0,
    };
    const cancellation = orderCancellationGuard(order);
    assert.equal(cancellation.ok, false, paymentStatus);
    assert.equal(cancellation.code, 'payment_status_reconciliation_required', paymentStatus);
    assert.equal(shouldReleaseOrderInventory(order), false, paymentStatus);
  }

  assert.equal(orderCancellationGuard({
    status: 'awaiting_confirmation',
    paymentStatus: 'failed',
    paymentMethod: '  ONLINE  ',
  }).code, 'payment_status_reconciliation_required');
  assert.equal(orderCancellationGuard({
    status: 'pay_at_cashier',
    paymentStatus: 'paid',
    paymentMethod: 'online',
    amountPaid: 25,
  }).code, 'order_refund_required', 'received funds still require the explicit refund flow');

  // Cashier orders keep their existing explicit no-funds cancellation path.
  assert.equal(orderCancellationGuard({
    status: 'pay_at_cashier', paymentStatus: 'failed', paymentMethod: 'cashier',
  }).ok, true);
});

test('malformed payment amounts and payment histories require reconciliation, never a free cancellation', () => {
  for (const order of [
    { ...unpaidPreKitchenOrder(), amountPaid: 'not-a-number' },
    { ...unpaidPreKitchenOrder(), amountPaid: -1 },
    { ...unpaidPreKitchenOrder(), amountPaid: '' },
    { ...unpaidPreKitchenOrder(), amountPaid: false },
    { ...unpaidPreKitchenOrder(), partialPayments: {} },
    { ...unpaidPreKitchenOrder(), partialPayments: [{ amount: 'unknown' }] },
    { ...unpaidPreKitchenOrder(), partialPayments: [{ amount: 0 }] },
    { ...unpaidPreKitchenOrder(), partialPayments: [null] },
  ]) {
    assert.equal(orderCancellationGuard(order).code, 'payment_status_reconciliation_required', JSON.stringify(order));
  }
});

test('kitchen-stage cancellation follows the existing state machine and never releases stock', () => {
  for (const status of ['sent_to_kitchen', 'preparing', 'ready', 'dispatched']) {
    const cancellation = orderCancellationGuard({ status, paymentStatus: 'unpaid' });
    assert.equal(cancellation.ok, true, status);
    assert.equal(cancellation.cancellationStage, 'kitchen_started', status);
    assert.equal(cancellation.inventoryReleaseAllowed, false, status);
    assert.equal(canTransitionOrder({ status, paymentStatus: 'unpaid' }, 'cancelled'), true, status);
  }

  const started = orderCancellationGuard({
    status: 'pay_at_cashier',
    paymentStatus: 'failed',
    startedAt: '2026-09-01T10:00:00Z',
  });
  assert.equal(started.ok, true);
  assert.equal(started.cancellationStage, 'kitchen_started');
  assert.equal(started.inventoryReleaseAllowed, false);

  for (const status of ['kitchen', 'prep', 'picked_up', 'delivered', 'done']) {
    assert.equal(orderCancellationGuard({ status, paymentStatus: 'unpaid' }).ok, false, status);
    assert.equal(canTransitionOrder({ status, paymentStatus: 'unpaid' }, 'cancelled'), false, status);
  }
});

test('received amount uses the larger recorded basis without counting mirrored totals twice', () => {
  assert.equal(receivedAmount({
    amountPaid: '30',
    partialPayments: [{ amount: '10' }, { amount: 20 }],
  }), 30);
  assert.equal(receivedAmount({ partialPayments: [{ amount: 10 }, { amount: 20 }] }), 30);
  assert.equal(receivedAmount({ amountPaid: Number.MAX_VALUE, partialPayments: [{ amount: Number.MAX_VALUE }] }), Number.POSITIVE_INFINITY,
    'unsafe integer projections fail closed instead of counting as valid payment evidence');
  assert.equal(receivedAmount({ amountPaid: 0, partialPayments: [{ amount: 100, refundedAmount: 100 }] }), 100,
    'historical receipt guards continue locking edit and split after refund');
  assert.equal(receivedAmount({ amountPaid: 0, partialPayments: [{ amount: 'bad' }] }), Number.POSITIVE_INFINITY,
    'malformed rows must block callers that use the projection as a receipt-presence guard');
});

test('cancellation balance is net of verified refund rows and remains conservative when projections disagree', () => {
  assert.equal(netReceivedAmount({
    amountPaid: 0,
    partialPayments: [{ amount: 100, refundedAmount: 100 }],
  }), 0, 'a fully reversed receipt is no longer an outstanding customer receipt');
  assert.equal(netReceivedAmount({
    amountPaid: 40,
    partialPayments: [{ amount: 100, refundedAmount: 60 }],
  }), 40, 'the paid projection and net receipt rows are mirrored, not added');
  assert.equal(netReceivedAmount({
    amountPaid: 100,
    partialPayments: [{ amount: 100, refundedAmount: 100 }],
  }), 100, 'a stale gross projection is not silently erased by a refund row');

  const fullyRefunded = {
    status: 'awaiting_confirmation',
    paymentStatus: 'unpaid',
    paymentMethod: 'cashier',
    amountPaid: 0,
    partialPayments: [{ amount: 100, refundedAmount: 100 }],
  };
  assert.equal(orderCancellationGuard(fullyRefunded).ok, true);
  assert.equal(shouldReleaseOrderInventory(fullyRefunded), true);
  const repeatedCancellation = { ...fullyRefunded, status: 'cancelled' };
  assert.equal(orderCancellationGuard(repeatedCancellation).code, 'order_already_cancelled');
  assert.equal(shouldReleaseOrderInventory(repeatedCancellation), false);

  const partiallyRefunded = {
    ...fullyRefunded,
    amountPaid: 40,
    partialPayments: [{ amount: 100, refundedAmount: 60 }],
  };
  assert.equal(orderCancellationGuard(partiallyRefunded).code, 'order_refund_required');
  assert.equal(shouldReleaseOrderInventory(partiallyRefunded), false);
});

test('malformed refund evidence blocks cancellation and inventory release', () => {
  for (const refundedAmount of [-1, 101, 'not-a-number', '1e2', 1.5, '', false]) {
    const order = {
      status: 'awaiting_confirmation',
      paymentStatus: 'unpaid',
      paymentMethod: 'cashier',
      amountPaid: 0,
      partialPayments: [{ amount: 100, refundedAmount }],
    };
    assert.equal(orderCancellationGuard(order).code, 'payment_status_reconciliation_required', String(refundedAmount));
    assert.equal(shouldReleaseOrderInventory(order), false, String(refundedAmount));
    assert.equal(receivedAmount(order), Number.POSITIVE_INFINITY, String(refundedAmount));
    assert.equal(netReceivedAmount(order), Number.POSITIVE_INFINITY, String(refundedAmount));
  }
});

test('fractional, unsafe, and exponent-form payment amounts never masquerade as exact Toman evidence', () => {
  const invalidOrders = [
    { amountPaid: 1.5, partialPayments: [] },
    { amountPaid: Number.MAX_SAFE_INTEGER + 1, partialPayments: [] },
    { amountPaid: '1e2', partialPayments: [] },
    { amountPaid: 0, partialPayments: [{ amount: 1.5 }] },
    { amountPaid: 0, partialPayments: [{ amount: '1e2' }] },
  ];
  for (const paymentEvidence of invalidOrders) {
    const order = {
      status: 'awaiting_confirmation', paymentStatus: 'unpaid', paymentMethod: 'cashier',
      ...paymentEvidence,
    };
    assert.equal(orderCancellationGuard(order).code, 'payment_status_reconciliation_required');
    assert.equal(shouldReleaseOrderInventory(order), false);
  }
});

test('inventory is restored only when the same cancellation guard approves a pre-kitchen unpaid order', () => {
  for (const status of ['pending_online', 'awaiting_confirmation', 'pay_at_cashier']) {
    assert.equal(shouldReleaseOrderInventory({ status, paymentStatus: 'unpaid' }), true, status);
  }
  assert.equal(shouldReleaseOrderInventory({ status: 'pay_at_cashier' }), true);

  for (const order of [
    { status: 'cancelled', paymentStatus: 'unpaid' },
    { status: 'pay_at_cashier', paymentStatus: 'paid' },
    { status: 'pay_at_cashier', paymentStatus: 'pending' },
    { status: 'sent_to_kitchen', paymentStatus: 'unpaid' },
    { status: 'preparing', paymentStatus: 'unpaid' },
    { status: 'pay_at_cashier', paymentStatus: 'unpaid', startedAt: '2026-09-01T10:00:00Z' },
    { status: 'future_order_state', paymentStatus: 'unpaid' },
  ]) {
    assert.equal(shouldReleaseOrderInventory(order), false, JSON.stringify(order));
  }
});

test('cancellation route handlers guard before snapshot, inventory, or status mutations', () => {
  const routes = [
    ["app.patch('/api/cashier/orders/:id/status'", "app.get('/api/waiter/calls'"],
    ["app.patch('/api/admin/orders/:id'", '// Versioned endpoint for new clients'],
    ["app.patch('/api/v2/orders/:id/status'", '/* ---- Kitchen Display System (KDS) ---- */'],
  ];

  for (const [startMarker, endMarker] of routes) {
    const start = serverSource.indexOf(startMarker);
    const end = serverSource.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, `route exists: ${startMarker}`);
    const route = serverSource.slice(start, end);
    const guardAt = route.indexOf('orderCancellationGuard(order)');
    assert.ok(guardAt >= 0, `cancellation guard exists: ${startMarker}`);
    for (const mutation of [
      'snapshotFinanceMutationState()',
      'shouldReleaseOrderInventory(order)',
      'appendOrderStatus(order,',
    ]) {
      const mutationAt = route.indexOf(mutation);
      assert.ok(mutationAt > guardAt, `${mutation} follows guard in ${startMarker}`);
    }
  }
});

test('admin and v2 repeated same-state requests are idempotent before cancellation side effects', () => {
  for (const [startMarker, endMarker] of [
    ["app.patch('/api/admin/orders/:id'", '// Versioned endpoint for new clients'],
    ["app.patch('/api/v2/orders/:id/status'", '/* ---- Kitchen Display System (KDS) ---- */'],
  ]) {
    const start = serverSource.indexOf(startMarker);
    const end = serverSource.indexOf(endMarker, start);
    const route = serverSource.slice(start, end);
    const idempotentAt = route.indexOf("if (status === String(order.status || ''))");
    const guardAt = route.indexOf('orderCancellationGuard(order)');
    assert.ok(idempotentAt >= 0 && guardAt > idempotentAt, `${startMarker}: duplicate state exits before guard`);
    const idempotentBlock = route.slice(idempotentAt, guardAt);
    assert.match(idempotentBlock, /return res\.json\(\{ ok: true, idempotent: true, order: operationalOrderResponse\(order, req\.user\) \}\)/);
    assert.doesNotMatch(idempotentBlock, /snapshotFinanceMutationState|shouldReleaseOrderInventory|appendOrderStatus/);
  }

  const cashierStart = serverSource.indexOf("app.patch('/api/cashier/orders/:id/status'");
  const cashierEnd = serverSource.indexOf("app.get('/api/waiter/calls'", cashierStart);
  const cashierRoute = serverSource.slice(cashierStart, cashierEnd);
  assert.match(cashierRoute, /pay_at_cashier:\s*\['cancelled'\]/);
  assert.match(cashierRoute, /awaiting_confirmation:\s*\['cancelled'\]/);
  assert.doesNotMatch(cashierRoute, /cancelled:\s*\[/);
});

test('every cancellation status route restores only guard-approved legacy stock', () => {
  for (const [startMarker, endMarker] of [
    ["app.patch('/api/cashier/orders/:id/status'", "app.get('/api/waiter/calls'"],
    ["app.patch('/api/admin/orders/:id'", '// Versioned endpoint for new clients'],
    ["app.patch('/api/v2/orders/:id/status'", '/* ---- Kitchen Display System (KDS) ---- */'],
  ]) {
    const start = serverSource.indexOf(startMarker);
    const end = serverSource.indexOf(endMarker, start);
    const route = serverSource.slice(start, end);
    assert.match(route, /shouldReleaseOrderInventory\(order\)/, startMarker);
    assert.match(route, /adjustOrderInventory\(order\.items, 1, order\.branchId\)/, startMarker);
  }
});

test('supervisor cancellation reports failure when required accounting reversal cannot complete', () => {
  const helperStart = serverSource.indexOf('function reverseCancelledOrderFinancialEffects(');
  const helperEnd = serverSource.indexOf('\nfunction checkoutIdempotencyFingerprint(', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'shared financial reversal guard exists');
  const helper = serverSource.slice(helperStart, helperEnd);
  assert.match(helper, /accountingEngine\.reverseOrderSalesJournal\(/);
  assert.match(helper, /financeV2\.reverseEntry\(/);
  assert.match(helper, /financeV2\.reverseOrderCogsAndInventory\(/);
  assert.match(helper, /order_finance_branch_mismatch/);
  assert.match(helper, /unreversedCogsJournal/);
  assert.match(helper, /order_cogs_reversal_incomplete/);
  assert.doesNotMatch(helper, /catch\s*\(/, 'reversal exceptions must reach the enclosing rollback boundary');

  for (const [startMarker, endMarker] of [
    ["app.patch('/api/admin/orders/:id'", '// Versioned endpoint for new clients'],
    ["app.patch('/api/v2/orders/:id/status'", '/* ---- Kitchen Display System (KDS) ---- */'],
  ]) {
    const start = serverSource.indexOf(startMarker);
    const route = serverSource.slice(start, serverSource.indexOf(endMarker, start));
    const statusWriteAt = route.indexOf('appendOrderStatus(order, status');
    const reversalAt = route.indexOf('reverseCancelledOrderFinancialEffects(order, req.user)');
    const persistAt = route.indexOf('await persistFinanceMutation(snapshot)');
    assert.ok(statusWriteAt >= 0 && reversalAt > statusWriteAt && persistAt > reversalAt,
      `${startMarker}: reversal must succeed before cancellation is durably acknowledged`);
  }
});

test('cashier and waiter repeated status requests are idempotent before side effects', () => {
  const cashierStart = serverSource.indexOf("app.patch('/api/cashier/orders/:id/status'");
  const cashierRoute = serverSource.slice(cashierStart, serverSource.indexOf("app.get('/api/waiter/calls'", cashierStart));
  const cashierReplay = cashierRoute.indexOf('if (next && next === String(order.status || \'\'))');
  const cashierWrite = cashierRoute.indexOf('appendOrderStatus(order, next');
  assert.ok(cashierReplay >= 0 && cashierReplay < cashierWrite);
  assert.match(cashierRoute.slice(cashierReplay, cashierWrite), /idempotent: true/);

  const waiterStart = serverSource.indexOf("app.patch('/api/waiter/orders/:id/status'");
  const waiterRoute = serverSource.slice(waiterStart, serverSource.indexOf('// Walk-in reception', waiterStart));
  const waiterReplay = waiterRoute.indexOf("if (next === 'done' && order.status === 'done')");
  const waiterWrite = waiterRoute.indexOf("appendOrderStatus(order, next");
  assert.ok(waiterReplay >= 0 && waiterReplay < waiterWrite);
  assert.match(waiterRoute.slice(waiterReplay, waiterWrite), /idempotent: true/);
});

test('KDS event delivery failure cannot turn a committed status change into a retry-inducing API failure', () => {
  const start = serverSource.indexOf("app.patch('/api/kitchen/orders/:id'");
  const end = serverSource.indexOf("app.patch('/api/kitchen/items/:id/availability'", start);
  const route = serverSource.slice(start, end);
  const persistAt = route.indexOf('await persistFinanceMutation(snapshot)');
  const publishAt = route.indexOf("publishOperationalEvent('order.updated'");
  const responseAt = route.indexOf('res.json({ ok: true, eventPublished, order: kitchenTicket(order) })');
  assert.ok(persistAt >= 0 && publishAt > persistAt && responseAt > publishAt);
  assert.match(route.slice(publishAt, responseAt), /catch \(error\)[\s\S]*?eventPublished = false/);
});
