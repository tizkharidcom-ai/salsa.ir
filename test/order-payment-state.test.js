'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createOrderPaymentState,
  transitionOrderPaymentState,
  getOrderPaymentAmounts,
  deriveOrderPaymentWorkflow,
  getSettlementIdempotencyKey,
  clearSettlementIdempotencyKey,
  settlementIntentFingerprint,
} = require('../js/order-payment-state');
const { normalizeSettlementReference } = require('../server/settlement-reference');

function memorySessionStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function makeState(overrides = {}) {
  const input = {
    orderStatus: 'pay_at_cashier',
    paymentStatus: 'unpaid',
    fulfillment: 'dine_in',
    ...overrides,
    provenance: {
      order: { source: 'staff', reference: 'order-event-1' },
      payment: { source: 'cashier', reference: 'payment-event-1' },
      ...(overrides.deliveryAcceptance && overrides.deliveryAcceptance !== 'unrecorded'
        ? { deliveryAcceptance: {
          source: 'restaurant', reference: 'acceptance-event-1', actorId: 'restaurant-user-17',
          acceptedAt: '2026-09-23T00:00:00.000Z',
        } }
        : {}),
      ...(overrides.provenance || {}),
    },
  };
  const result = createOrderPaymentState(input);
  assert.equal(result.ok, true, result.error);
  return result.state;
}

function provenance(source, reference) {
  return { source, reference };
}

function acceptanceProvenance(reference, actorId = 'restaurant-user-17') {
  return { source: 'restaurant', reference, actorId, acceptedAt: '2026-09-23T00:00:00.000Z' };
}

test('canonical state requires known statuses, matching fulfillment and explicit initial provenance', () => {
  const base = {
    orderStatus: 'ready',
    paymentStatus: 'unknown',
    fulfillment: 'delivery',
    provenance: {
      order: provenance('legacy_import', 'order-10'),
      payment: provenance('payment_provider', 'attempt-10'),
    },
  };
  assert.equal(createOrderPaymentState(base).ok, true);
  assert.equal(createOrderPaymentState({ ...base, orderStatus: 'mystery' }).error, 'order_status_invalid');
  assert.equal(createOrderPaymentState({ ...base, fulfillment: 'pickup', orderStatus: 'delivered' }).error,
    'fulfillment_order_state_mismatch');
  assert.equal(createOrderPaymentState({ ...base, provenance: { order: base.provenance.order } }).error,
    'payment_provenance_required');
  assert.equal(createOrderPaymentState({
    ...base,
    provenance: {
      ...base.provenance,
      deliveryAcceptance: provenance('restaurant', 'stale-acceptance'),
    },
  }).error, 'delivery_acceptance_provenance_invalid');
  assert.equal(createOrderPaymentState({
    ...base,
    paymentStatus: 'partial',
    provenance: {
      ...base.provenance,
      reconciliation: provenance('reconciliation', 'reconcile-10'),
      reconciles: 'attempt-10',
    },
  }).error, 'payment_reconciliation_provenance_invalid');
  assert.equal(createOrderPaymentState({
    ...base,
    provenance: {
      ...base.provenance,
      reconciliation: provenance('reconciliation', 'reconcile-10'),
      reconciles: 'different-attempt',
    },
  }).error, 'payment_reconciliation_provenance_invalid');
});

test('fulfillment handoffs follow the selected delivery, pickup or dine-in path', () => {
  const transition = (state, status) => transitionOrderPaymentState(state, {
    type: 'order.transition', status, provenance: provenance('staff', `order-${status}`),
  });

  const delivery = transition(makeState({
    orderStatus: 'ready', fulfillment: 'delivery', deliveryAcceptance: 'accepted',
  }), 'dispatched');
  assert.equal(delivery.ok, true);
  assert.equal(delivery.state.orderStatus, 'dispatched');
  assert.equal(transition(delivery.state, 'delivered').state.orderStatus, 'delivered');
  assert.equal(transition(makeState({ orderStatus: 'ready', fulfillment: 'delivery' }), 'done').error,
    'order_transition_invalid');
  assert.equal(transition(makeState({ orderStatus: 'ready', fulfillment: 'pickup' }), 'picked_up').state.orderStatus,
    'picked_up');
  assert.equal(transition(makeState({ orderStatus: 'ready', fulfillment: 'dine_in' }), 'done').state.orderStatus,
    'done');
});

test('unknown payment stays unknown until reconciliation cites its original attempt', () => {
  const initial = makeState({ orderStatus: 'pending_online', paymentStatus: 'pending', fulfillment: 'delivery' });
  const uncertain = transitionOrderPaymentState(initial, {
    type: 'payment.outcome',
    status: 'unknown',
    provenance: provenance('payment_provider', 'attempt-22'),
  });
  assert.equal(uncertain.state.paymentStatus, 'unknown');
  assert.deepEqual(uncertain.state.provenance.payment, provenance('payment_provider', 'attempt-22'));
  assert.equal(transitionOrderPaymentState(uncertain.state, {
    type: 'payment.outcome', status: 'paid', provenance: provenance('payment_provider', 'attempt-22'),
  }).error, 'payment_reconciliation_required');
  assert.equal(transitionOrderPaymentState(uncertain.state, {
    type: 'payment.reconciled', status: 'paid', reconciles: 'other-attempt',
    provenance: provenance('reconciliation', 'reconcile-22'),
  }).error, 'payment_reconciliation_provenance_invalid');
  assert.equal(transitionOrderPaymentState(uncertain.state, {
    type: 'payment.reconciled', status: 'paid', reconciles: 'attempt-22',
    provenance: provenance('reconciliation', 'attempt-22'),
  }).error, 'payment_reconciliation_provenance_invalid');
  const resolved = transitionOrderPaymentState(uncertain.state, {
    type: 'payment.reconciled', status: 'paid', reconciles: 'attempt-22',
    provenance: provenance('reconciliation', 'reconcile-22'),
  });
  assert.equal(resolved.state.paymentStatus, 'paid');
  assert.deepEqual(resolved.state.provenance.payment, provenance('payment_provider', 'attempt-22'));
  assert.deepEqual(resolved.state.provenance.reconciliation, provenance('reconciliation', 'reconcile-22'));
  assert.equal(resolved.state.provenance.reconciles, 'attempt-22');
  assert.equal(transitionOrderPaymentState(resolved.state, {
    type: 'payment.reconciled', status: 'paid', reconciles: 'attempt-22',
    provenance: provenance('reconciliation', 'reconcile-22'),
  }).idempotent, true);
  assert.equal(transitionOrderPaymentState(resolved.state, {
    type: 'payment.reconciled', status: 'paid', reconciles: 'attempt-22',
    provenance: provenance('reconciliation', 'another-resolution'),
  }).error, 'payment_reconciliation_invalid');
});

test('order cannot be marked paid or prepared on unconfirmed payment evidence', () => {
  const unpaid = makeState({ orderStatus: 'pay_at_cashier', paymentStatus: 'unpaid' });
  assert.equal(transitionOrderPaymentState(unpaid, {
    type: 'order.transition', status: 'paid', provenance: provenance('cashier', 'order-paid-1'),
  }).error, 'payment_not_confirmed');
  const paidResult = transitionOrderPaymentState(unpaid, {
    type: 'payment.outcome', status: 'paid', provenance: provenance('cashier', 'receipt-1'),
  });
  const markedPaid = transitionOrderPaymentState(paidResult.state, {
    type: 'order.transition', status: 'paid', provenance: provenance('cashier', 'order-paid-1'),
  });
  assert.equal(markedPaid.state.orderStatus, 'paid');
  const ambiguous = makeState({ orderStatus: 'paid', paymentStatus: 'unknown' });
  assert.equal(transitionOrderPaymentState(ambiguous, {
    type: 'order.transition', status: 'preparing', provenance: provenance('kitchen', 'kitchen-start-1'),
  }).error, 'payment_not_confirmed');
});

test('cashier orders can be queued to the kitchen without pretending they are paid', () => {
  const cashierOrder = makeState({ orderStatus: 'pay_at_cashier', paymentStatus: 'unpaid' });
  const queued = transitionOrderPaymentState(cashierOrder, {
    type: 'order.transition', status: 'sent_to_kitchen', provenance: provenance('waiter', 'send-1'),
  });
  assert.equal(queued.ok, true);
  assert.equal(queued.state.orderStatus, 'sent_to_kitchen');
  assert.equal(queued.state.paymentStatus, 'unpaid');

  const preparing = transitionOrderPaymentState(queued.state, {
    type: 'order.transition', status: 'preparing', provenance: provenance('kitchen', 'start-1'),
  });
  assert.equal(preparing.ok, true);
  assert.equal(preparing.state.paymentStatus, 'unpaid');

  const unresolved = makeState({ orderStatus: 'pay_at_cashier', paymentStatus: 'pending' });
  assert.equal(transitionOrderPaymentState(unresolved, {
    type: 'order.transition', status: 'sent_to_kitchen', provenance: provenance('waiter', 'send-2'),
  }).error, 'payment_not_confirmed');
});

test('pending, unknown, cancelled, and refunded payment states cannot advance kitchen or fulfillment stages', () => {
  for (const paymentStatus of ['pending', 'unknown', 'cancelled', 'refunded']) {
    const preparing = makeState({ orderStatus: 'preparing', paymentStatus });
    const ready = transitionOrderPaymentState(preparing, {
      type: 'order.transition', status: 'ready', provenance: provenance('kitchen', `ready-${paymentStatus}`),
    });
    assert.equal(ready.ok, false, `preparing/${paymentStatus} must not become ready`);
    assert.equal(ready.error, 'payment_not_confirmed');

    for (const [fulfillment, target] of [
      ['delivery', 'dispatched'],
      ['pickup', 'picked_up'],
      ['dine_in', 'done'],
    ]) {
      const result = transitionOrderPaymentState(makeState({
        orderStatus: 'ready', paymentStatus, fulfillment,
        ...(fulfillment === 'delivery' ? { deliveryAcceptance: 'accepted' } : {}),
      }), {
        type: 'order.transition', status: target,
        provenance: provenance('staff', `handoff-${paymentStatus}-${fulfillment}`),
      });
      assert.equal(result.ok, false, `ready/${paymentStatus}/${fulfillment} must not complete`);
      assert.equal(result.error, 'payment_not_confirmed');
    }
  }
});

test('partial and explicitly unpaid cash orders retain fulfillment progress without implying settlement', () => {
  for (const paymentStatus of ['unpaid', 'partial', 'failed', 'paid']) {
    const preparing = makeState({ orderStatus: 'preparing', paymentStatus });
    const ready = transitionOrderPaymentState(preparing, {
      type: 'order.transition', status: 'ready', provenance: provenance('kitchen', `ready-safe-${paymentStatus}`),
    });
    assert.equal(ready.ok, true, paymentStatus);
    assert.equal(ready.state.paymentStatus, paymentStatus, 'fulfillment must not rewrite payment evidence');
  }
});

test('delivery payment, restaurant acceptance, and kitchen progress are independent, attributed events', () => {
  const paidDelivery = makeState({
    orderStatus: 'awaiting_confirmation', paymentStatus: 'unpaid', fulfillment: 'delivery', deliveryAcceptance: 'unrecorded',
  });
  const paid = transitionOrderPaymentState(paidDelivery, {
    type: 'payment.outcome', status: 'paid', provenance: provenance('cashier', 'receipt-delivery-1'),
  });
  assert.equal(paid.ok, true);
  assert.equal(paid.state.paymentStatus, 'paid');
  assert.equal(paid.state.orderStatus, 'awaiting_confirmation', 'payment must not advance delivery order status');
  assert.equal(paid.state.deliveryAcceptance, 'unrecorded', 'payment must not imply restaurant acceptance');

  for (const event of [
    { source: 'waiter', reference: 'not-a-restaurant-decision', actorId: 'waiter-4' },
    { source: 'restaurant', reference: 'missing-actor' },
    { source: 'restaurant', reference: 'empty-actor', actorId: ' ' },
    { source: 'restaurant', reference: 'missing-time', actorId: 'restaurant-user-17' },
    { ...acceptanceProvenance('invalid-time'), acceptedAt: 'not-a-timestamp' },
    { ...acceptanceProvenance('invalid-calendar'), acceptedAt: '2026-02-30T10:00:00.000Z' },
  ]) {
    assert.equal(transitionOrderPaymentState(paid.state, {
      type: 'delivery.acceptance', status: 'accepted', provenance: event,
    }).error, 'delivery_acceptance_provenance_invalid');
  }
  assert.equal(transitionOrderPaymentState(paid.state, {
    type: 'order.transition', status: 'paid', provenance: provenance('cashier', 'order-paid-delivery-1'),
  }).error, 'delivery_order_status_independent');
  assert.equal(transitionOrderPaymentState(paidDelivery, {
    type: 'order.transition', status: 'sent_to_kitchen', provenance: provenance('waiter', 'send-unaccepted'),
  }).error, 'delivery_acceptance_required');

  const accepted = transitionOrderPaymentState(paid.state, {
    type: 'delivery.acceptance', status: 'accepted',
    provenance: acceptanceProvenance('accept-1'),
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.state.orderStatus, 'awaiting_confirmation', 'acceptance alone does not fabricate a kitchen transition');
  assert.equal(accepted.state.paymentStatus, 'paid');
  assert.equal(transitionOrderPaymentState(accepted.state, {
    type: 'delivery.acceptance', status: 'accepted',
    provenance: acceptanceProvenance('accept-1'),
  }).idempotent, true);
  assert.equal(transitionOrderPaymentState(accepted.state, {
    type: 'delivery.acceptance', status: 'accepted',
    provenance: acceptanceProvenance('accept-1', 'restaurant-user-99'),
  }).error, 'delivery_acceptance_event_conflict');
  const queued = transitionOrderPaymentState(accepted.state, {
    type: 'order.transition', status: 'sent_to_kitchen', provenance: provenance('waiter', 'send-accepted'),
  });
  assert.equal(queued.ok, true);
  const preparing = transitionOrderPaymentState(queued.state, {
    type: 'order.transition', status: 'preparing', provenance: provenance('kitchen', 'start-accepted'),
  });
  assert.equal(preparing.ok, true);
  assert.equal(preparing.state.paymentStatus, 'paid');

  const unpaidAccepted = transitionOrderPaymentState(paidDelivery, {
    type: 'delivery.acceptance', status: 'accepted',
    provenance: acceptanceProvenance('accept-unpaid'),
  });
  const unpaidQueued = transitionOrderPaymentState(unpaidAccepted.state, {
    type: 'order.transition', status: 'sent_to_kitchen', provenance: provenance('waiter', 'send-unpaid-accepted'),
  });
  assert.equal(unpaidQueued.ok, true, 'restaurant acceptance is not conditional on payment success');
  assert.equal(unpaidQueued.state.paymentStatus, 'unpaid');

  const rejected = transitionOrderPaymentState(paidDelivery, {
    type: 'delivery.acceptance', status: 'rejected',
    provenance: acceptanceProvenance('reject-1'),
  });
  assert.equal(rejected.ok, true);
  assert.equal(rejected.state.orderStatus, 'awaiting_confirmation');
  assert.equal(rejected.state.paymentStatus, 'unpaid');
  assert.equal(transitionOrderPaymentState(rejected.state, {
    type: 'order.transition', status: 'sent_to_kitchen', provenance: provenance('waiter', 'send-rejected'),
  }).error, 'delivery_acceptance_rejected');

  const sentBeforeAcceptance = makeState({
    orderStatus: 'sent_to_kitchen', paymentStatus: 'paid', fulfillment: 'delivery', deliveryAcceptance: 'unrecorded',
  });
  assert.equal(transitionOrderPaymentState(sentBeforeAcceptance, {
    type: 'delivery.acceptance', status: 'accepted',
    provenance: acceptanceProvenance('late-acceptance'),
  }).error, 'delivery_acceptance_window_closed');
  assert.equal(transitionOrderPaymentState(makeState({
    orderStatus: 'ready', paymentStatus: 'paid', fulfillment: 'delivery', deliveryAcceptance: 'unrecorded',
  }), {
    type: 'order.transition', status: 'dispatched', provenance: provenance('courier', 'dispatch-unaccepted'),
  }).error, 'delivery_acceptance_required', 'handoff cannot repair or bypass a missing pre-kitchen acceptance');

  const refund = transitionOrderPaymentState(paid.state, {
    type: 'payment.refund', provenance: provenance('cashier', 'refund-1'),
  });
  assert.equal(refund.state.paymentStatus, 'refunded');
  assert.equal(refund.state.orderStatus, 'awaiting_confirmation');
  assert.equal(transitionOrderPaymentState(refund.state, {
    type: 'payment.refund', provenance: provenance('cashier', 'refund-1'),
  }).idempotent, true);
  assert.equal(transitionOrderPaymentState(refund.state, {
    type: 'payment.refund', provenance: provenance('provider', 'refund-1'),
  }).error, 'payment_refund_terminal');
  assert.equal(transitionOrderPaymentState(refund.state, {
    type: 'payment.outcome', status: 'paid', provenance: provenance('cashier', 'receipt-2'),
  }).error, 'payment_terminal_conflict');
});

test('same-status payment notifications require matching event identity', () => {
  const cashierOrder = makeState();
  assert.equal(transitionOrderPaymentState(cashierOrder, {
    type: 'order.transition', status: 'pay_at_cashier', provenance: provenance('staff', 'order-event-1'),
  }).idempotent, true);
  assert.equal(transitionOrderPaymentState(cashierOrder, {
    type: 'order.transition', status: 'pay_at_cashier', provenance: provenance('staff', 'new-order-event'),
  }).error, 'order_event_reference_conflict');

  const paid = makeState({ paymentStatus: 'paid' });
  assert.equal(transitionOrderPaymentState(paid, {
    type: 'payment.outcome', status: 'paid', provenance: provenance('cashier', 'payment-event-1'),
  }).idempotent, true);
  assert.equal(transitionOrderPaymentState(paid, {
    type: 'payment.outcome', status: 'paid', provenance: provenance('gateway', 'second-charge'),
  }).error, 'payment_duplicate_conflict');

  const pending = makeState({ orderStatus: 'pending_online', paymentStatus: 'pending', fulfillment: 'delivery' });
  assert.equal(transitionOrderPaymentState(pending, {
    type: 'payment.outcome', status: 'pending', provenance: provenance('gateway', 'new-attempt'),
  }).error, 'payment_attempt_conflict');

  const partial = makeState({ paymentStatus: 'partial' });
  assert.equal(transitionOrderPaymentState(partial, {
    type: 'payment.outcome', status: 'partial', provenance: provenance('cashier', 'payment-event-1'),
  }).idempotent, true);
  assert.equal(transitionOrderPaymentState(partial, {
    type: 'payment.outcome', status: 'partial', provenance: provenance('cashier', 'another-receipt'),
  }).error, 'payment_partial_history_required');
});

test('a late capture is reconciled and refunded without reopening a cancelled order', () => {
  const cancelledUnknown = makeState({ orderStatus: 'cancelled', paymentStatus: 'unknown' });
  const lateCapture = transitionOrderPaymentState(cancelledUnknown, {
    type: 'payment.reconciled', status: 'paid', reconciles: 'payment-event-1',
    provenance: provenance('reconciliation', 'reconcile-cancelled'),
  });
  assert.equal(lateCapture.ok, true);
  assert.equal(lateCapture.state.orderStatus, 'cancelled');
  assert.equal(lateCapture.state.paymentStatus, 'paid');

  const reversed = transitionOrderPaymentState(lateCapture.state, {
    type: 'payment.refund', provenance: provenance('cashier', 'refund-late-capture'),
  });
  assert.equal(reversed.ok, true);
  assert.equal(reversed.state.orderStatus, 'cancelled');
  assert.equal(reversed.state.paymentStatus, 'refunded');
});

test('retry and completion after a failed or partial attempt require a new payment reference', () => {
  const failed = makeState({
    orderStatus: 'pending_online',
    paymentStatus: 'failed',
    fulfillment: 'delivery',
    provenance: { payment: provenance('gateway', 'attempt-failed') },
  });
  for (const status of ['pending', 'paid', 'partial']) {
    assert.equal(transitionOrderPaymentState(failed, {
      type: 'payment.outcome', status,
      provenance: provenance('gateway', 'attempt-failed'),
    }).error, 'payment_attempt_reference_reused', status);
  }
  const retried = transitionOrderPaymentState(failed, {
    type: 'payment.outcome', status: 'pending',
    provenance: provenance('gateway', 'attempt-retry'),
  });
  assert.equal(retried.ok, true);
  assert.equal(retried.state.paymentStatus, 'pending');
  assert.equal(retried.state.orderStatus, 'pending_online');

  const partial = makeState({
    paymentStatus: 'partial',
    provenance: { payment: provenance('cashier', 'partial-receipt') },
  });
  assert.equal(transitionOrderPaymentState(partial, {
    type: 'payment.outcome', status: 'paid',
    provenance: provenance('cashier', 'partial-receipt'),
  }).error, 'payment_attempt_reference_reused');
  assert.equal(transitionOrderPaymentState(partial, {
    type: 'payment.outcome', status: 'paid',
    provenance: provenance('cashier', 'final-receipt'),
  }).ok, true);

  const cancelledAttempt = makeState({
    orderStatus: 'pending_online',
    paymentStatus: 'pending',
    fulfillment: 'delivery',
    provenance: { payment: provenance('gateway', 'attempt-cancelled') },
  });
  const cancelled = transitionOrderPaymentState(cancelledAttempt, {
    type: 'payment.outcome', status: 'cancelled',
    provenance: provenance('gateway', 'attempt-cancelled'),
  });
  assert.equal(cancelled.ok, true);
  assert.equal(transitionOrderPaymentState(cancelled.state, {
    type: 'payment.outcome', status: 'pending',
    provenance: provenance('gateway', 'attempt-cancelled'),
  }).error, 'payment_attempt_reference_reused');
  const cancelledRetry = transitionOrderPaymentState(cancelled.state, {
    type: 'payment.outcome', status: 'pending',
    provenance: provenance('gateway', 'attempt-after-cancel'),
  });
  assert.equal(cancelledRetry.ok, true);
  assert.equal(cancelledRetry.state.orderStatus, 'pending_online');

  const cancelledOrder = makeState({
    orderStatus: 'cancelled',
    paymentStatus: 'unknown',
    fulfillment: 'delivery',
  });
  const reconciledCancelledOrder = transitionOrderPaymentState(cancelledOrder, {
    type: 'payment.reconciled', status: 'cancelled', reconciles: 'payment-event-1',
    provenance: provenance('reconciliation', 'cancelled-attempt-final'),
  });
  assert.equal(reconciledCancelledOrder.ok, true);
  assert.equal(transitionOrderPaymentState(reconciledCancelledOrder.state, {
    type: 'payment.outcome', status: 'pending',
    provenance: provenance('gateway', 'late-retry'),
  }).error, 'cancelled_order_payment_conflict');
});

test('payment progress derives the remaining balance from recorded payments, not a stale balanceDue field', () => {
  assert.deepEqual(getOrderPaymentAmounts({
    total: 1_000,
    amountPaid: 250,
    balanceDue: 0,
    partialPayments: [{ amount: 250 }],
  }), { total: 1_000, paid: 250, due: 750 });
});

test('payment progress handles missing, invalid and overpaid values safely', () => {
  assert.deepEqual(getOrderPaymentAmounts({ partialPayments: [{ amount: 20 }, { amount: -4 }, null] }, 100), {
    total: 100, paid: null, due: null,
  });
  assert.deepEqual(getOrderPaymentAmounts({ total: 100, amountPaid: 140 }), {
    total: 100, paid: null, due: null,
  });
  assert.deepEqual(getOrderPaymentAmounts({ total: 'invalid' }, 'invalid'), {
    total: null, paid: null, due: null,
  });
});

test('payment amount helpers use exact net receipts after refunds and reconcile every stored representation', () => {
  const order = {
    total: 1_000,
    amountPaid: 350,
    partialPayments: [
      { id: 1, amount: 500, refundedAmount: 200, idempotencyKey: 'settlement-retry-001', reference: 'POS-1' },
      { id: 2, amount: 250, refundedAmount: 200, idempotencyKey: 'settlement-retry-002', reference: 'POS-2' },
    ],
  };
  assert.deepEqual(getOrderPaymentAmounts(order), { total: 1_000, paid: 350, due: 650 });
  assert.equal(deriveOrderPaymentWorkflow({
    status: 'ready', paymentStatus: 'partial', ...order,
  }).amounts.due, 650);
  assert.deepEqual(getOrderPaymentAmounts({ ...order, amountPaid: 351 }), {
    total: 1_000, paid: null, due: null,
  });
  assert.deepEqual(getOrderPaymentAmounts({
    total: 1_000,
    amountPaid: 1_000,
    partialPayments: [
      { id: 1, amount: 500, idempotencyKey: 'settlement-retry-001' },
      { id: '1', amount: 500, idempotencyKey: 'settlement-retry-002' },
    ],
  }), { total: 1_000, paid: null, due: null });
  assert.deepEqual(getOrderPaymentAmounts({
    total: 1_000,
    amountPaid: 1_000,
    partialPayments: [
      { amount: 500, reference: 'POS-1' },
      { amount: 500, reference: ' ｐｏｓ-1 ' },
    ],
  }), { total: 1_000, paid: null, due: null });
  assert.deepEqual(getOrderPaymentAmounts({
    total: 1_000,
    amountPaid: 1_000,
    partialPayments: [
      { amount: 500, idempotencyKey: 'settlement-retry-001' },
      { amount: 500, idempotencyKey: 'settlement-retry-001' },
    ],
  }), { total: 1_000, paid: null, due: null });
});

test('fractional, exponent-string and unsafe integer amounts require reconciliation', () => {
  for (const value of [1.5, '1.5', '1e3', Number.MAX_SAFE_INTEGER + 1]) {
    const workflow = deriveOrderPaymentWorkflow({
      status: 'ready', paymentStatus: 'paid', total: 1_000, amountPaid: value,
    });
    assert.equal(workflow.requiresReconciliation, true, String(value));
    assert.equal(workflow.settled, false, String(value));
  }
  assert.deepEqual(getOrderPaymentAmounts({ total: 1_000, amountPaid: 1.5 }), {
    total: 1_000, paid: null, due: null,
  });
});

test('order and payment workflow exposes every production-facing stage with fail-closed payment states', () => {
  const cases = [
    {
      name: 'cash order registered and awaiting acceptance',
      order: { status: 'pay_at_cashier', paymentStatus: 'unpaid', total: 100 },
      current: 'acceptance_preparation', settlement: 'current', settled: false,
    },
    {
      name: 'online order is awaiting provider confirmation',
      order: { status: 'pending_online', paymentStatus: 'pending', total: 100 },
      current: 'online_payment', settlement: 'blocked', settled: false,
    },
    {
      name: 'failed online attempt keeps the order retryable',
      order: { status: 'pending_online', paymentStatus: 'failed', total: 100, amountPaid: 0 },
      current: 'online_payment', settlement: 'blocked', settled: false,
    },
    {
      name: 'cancelled online attempt keeps the order retryable',
      order: { status: 'pending_online', paymentStatus: 'cancelled', total: 100, amountPaid: 0 },
      current: 'online_payment', settlement: 'blocked', settled: false,
    },
    {
      name: 'order is being prepared with a partial payment',
      order: { status: 'preparing', paymentStatus: 'partial', total: 100, amountPaid: 40, partialPayments: [{ amount: 40 }] },
      current: 'acceptance_preparation', partial: 'current', settlement: 'current', settled: false,
    },
    {
      name: 'ready order can proceed to handoff and settlement',
      order: { status: 'ready', paymentStatus: 'unpaid', total: 100 },
      current: 'ready_delivery', settlement: 'current', settled: false,
    },
    {
      name: 'completed order with matching payment evidence is settled',
      order: { status: 'done', paymentStatus: 'paid', total: 100, amountPaid: 100, fulfillment: 'dine_in' },
      current: 'settlement', settlement: 'completed', settled: true,
    },
    {
      name: 'ambiguous payment requires reconciliation and never appears paid',
      order: { status: 'preparing', paymentStatus: 'unknown', total: 100, amountPaid: 0 },
      current: 'reconciliation', reconciliation: 'current', settlement: 'blocked', settled: false,
    },
    {
      name: 'cancelled unpaid order ends on cancellation',
      order: { status: 'cancelled', paymentStatus: 'unpaid', total: 100 },
      current: 'cancellation', cancellation: 'completed', settlement: 'not_applicable', settled: false,
    },
  ];

  const stageState = (workflow, id) => workflow.stages.find((stage) => stage.id === id)?.state;
  for (const item of cases) {
    const workflow = deriveOrderPaymentWorkflow(item.order);
    assert.equal(workflow.currentStageId, item.current, item.name);
    assert.equal(stageState(workflow, 'settlement'), item.settlement, item.name);
    assert.equal(workflow.settled, item.settled, item.name);
    if (item.partial) assert.equal(stageState(workflow, 'partial_payment'), item.partial, item.name);
    if (item.reconciliation) assert.equal(stageState(workflow, 'reconciliation'), item.reconciliation, item.name);
    if (item.cancellation) assert.equal(stageState(workflow, 'cancellation'), item.cancellation, item.name);
  }

  assert.deepEqual(deriveOrderPaymentWorkflow(cases[0].order).stages.map(({ id }) => id), [
    'registration', 'online_payment', 'acceptance_preparation', 'ready_delivery', 'partial_payment',
    'reconciliation', 'settlement', 'cancellation',
  ]);
});

test('contradictory payment status and amount evidence fail closed', () => {
  const cases = [
    { status: 'paid', paymentStatus: 'paid', total: 100, amountPaid: 60 },
    { status: 'preparing', paymentStatus: 'unpaid', total: 100, amountPaid: 1 },
    { status: 'pending_online', paymentStatus: 'paid', total: 100, amountPaid: 100 },
    { status: 'cancelled', paymentStatus: 'paid', total: 100, amountPaid: 100 },
    { status: 'done', paymentStatus: 'paid', total: 100, amountPaid: 100, partialPayments: [{ amount: 90 }] },
    { status: 'ready', paymentStatus: 'partial', total: 100, amountPaid: 120 },
    { status: 'ready', paymentStatus: 'partial', total: 100, amountPaid: -1 },
    { status: 'delivered', paymentStatus: 'paid', total: 100, amountPaid: 100, fulfillment: 'pickup' },
    { status: 'delivered', paymentStatus: 'paid', total: 100, amountPaid: 100 },
    { status: 'done', paymentStatus: 'paid', total: 100, amountPaid: 100 },
    { status: 'picked_up', paymentStatus: 'paid', total: 100, amountPaid: 100 },
    { status: 'preparing', paymentStatus: 'unpaid', total: 100, amountPaid: '' },
    { status: 'preparing', paymentStatus: 'unpaid', total: 100, amountPaid: true },
    { status: 'preparing', paymentStatus: 'unpaid', total: 100, partialPayments: [{ amount: 0 }] },
    { status: 'preparing', paymentStatus: 'unpaid', total: 100, partialPayments: [{ amount: false }] },
    { status: 'future_order_state', paymentStatus: 'paid', total: 100, amountPaid: 100 },
  ];

  for (const order of cases) {
    const workflow = deriveOrderPaymentWorkflow(order);
    assert.equal(workflow.status, 'reconciliation_required', JSON.stringify(order));
    assert.equal(workflow.requiresReconciliation, true, JSON.stringify(order));
    assert.equal(workflow.settled, false, JSON.stringify(order));
    assert.equal(workflow.currentStageId, 'reconciliation', JSON.stringify(order));
    assert.equal(workflow.stages.find((stage) => stage.id === 'settlement').state, 'blocked', JSON.stringify(order));
    if (order.paymentStatus === 'partial') {
      assert.equal(workflow.stages.find((stage) => stage.id === 'partial_payment').state, 'blocked', JSON.stringify(order));
    }
  }
});

test('missing financial evidence and unknown status never imply successful settlement', () => {
  const missingAmounts = deriveOrderPaymentWorkflow({ status: 'paid', paymentStatus: 'paid' });
  const missingPaymentState = deriveOrderPaymentWorkflow({ status: 'preparing', total: 100, amountPaid: 0 });

  assert.equal(missingAmounts.settled, false);
  assert.equal(missingAmounts.requiresReconciliation, true);
  assert.equal(missingPaymentState.paymentStatus, 'unknown');
  assert.equal(missingPaymentState.settled, false);
  assert.equal(missingPaymentState.currentStageId, 'reconciliation');
});

test('recognized payment outcomes map to safe settlement-stage states', () => {
  const cases = [
    { paymentStatus: 'unpaid', amountPaid: 0, settlement: 'current', settled: false },
    { paymentStatus: 'partial', amountPaid: 25, settlement: 'current', settled: false },
    { paymentStatus: 'pending', amountPaid: 0, settlement: 'blocked', settled: false },
    { paymentStatus: 'paid', amountPaid: 100, settlement: 'completed', settled: true },
    { paymentStatus: 'failed', amountPaid: 0, settlement: 'current', settled: false },
    { paymentStatus: 'cancelled', amountPaid: 0, settlement: 'not_applicable', settled: false },
    { paymentStatus: 'refunded', amountPaid: 100, settlement: 'reversed', settled: false },
    { paymentStatus: 'unknown', amountPaid: 0, settlement: 'blocked', settled: false },
  ];

  for (const item of cases) {
    const orderStatus = item.paymentStatus === 'pending' ? 'pending_online'
      : item.paymentStatus === 'refunded' ? 'cancelled' : 'ready';
    const workflow = deriveOrderPaymentWorkflow({
      status: orderStatus,
      paymentStatus: item.paymentStatus,
      total: 100,
      amountPaid: item.amountPaid,
    });
    assert.equal(workflow.stages.find((stage) => stage.id === 'settlement').state, item.settlement, item.paymentStatus);
    assert.equal(workflow.settled, item.settled, item.paymentStatus);
    if (item.paymentStatus === 'unknown') assert.equal(workflow.currentStageId, 'reconciliation');
  }
});

test('card settlement references are trimmed and bounded before being stored', () => {
  assert.equal(normalizeSettlementReference('  ۱۲۳۴۵۶  '), '۱۲۳۴۵۶');
  assert.equal(normalizeSettlementReference('   '), null);
  assert.throws(() => normalizeSettlementReference('ref\u0000bad'), { code: 'settlement_reference_invalid' });
  assert.throws(() => normalizeSettlementReference('x'.repeat(121)), { code: 'settlement_reference_invalid' });
});

test('settlement idempotency identity survives a reload and rotates only after success or intent change', () => {
  const storage = memorySessionStorage();
  const intent = {
    orderId: 44, branchId: 7, actor: '09120000000', actorRole: 'cashier',
    tender: 'cash', paymentAmount: 1_000, amountTendered: 1_200, paymentReference: '',
  };
  const firstRequestKey = getSettlementIdempotencyKey(intent, storage);
  const afterReloadKey = getSettlementIdempotencyKey({ ...intent }, storage);
  assert.equal(afterReloadKey, firstRequestKey);
  assert.notEqual(getSettlementIdempotencyKey({ ...intent, paymentAmount: 800 }, storage), firstRequestKey);
  assert.notEqual(settlementIntentFingerprint({ ...intent, paymentReference: 'receipt-1' }), settlementIntentFingerprint(intent));
  assert.equal(clearSettlementIdempotencyKey(intent, 'settle-wrong-key', storage), false);
  assert.equal(clearSettlementIdempotencyKey(intent, firstRequestKey, storage), true);
  assert.notEqual(getSettlementIdempotencyKey(intent, storage), firstRequestKey);
});

test('settlement idempotency refuses to create a retry key when browser storage is unavailable or corrupt', () => {
  const intent = {
    orderId: 44, branchId: 7, actor: '09120000000', actorRole: 'cashier',
    tender: 'cash', paymentAmount: 1_000, amountTendered: 1_000,
  };
  assert.throws(() => getSettlementIdempotencyKey(intent, null), {
    code: 'settlement_idempotency_storage_unavailable', notSent: true,
  });
  assert.throws(() => getSettlementIdempotencyKey(intent, {
    getItem() { throw new Error('storage denied'); },
    setItem() {},
  }), { code: 'settlement_idempotency_storage_unavailable', notSent: true });
  assert.throws(() => getSettlementIdempotencyKey(intent, {
    getItem() { return '{broken'; },
    setItem() { throw new Error('must not replace a corrupt key registry'); },
  }), { code: 'settlement_idempotency_storage_unavailable', notSent: true });
  assert.throws(() => getSettlementIdempotencyKey(intent, {
    getItem() { return null; },
    setItem() {},
  }), { code: 'settlement_idempotency_storage_unavailable', notSent: true });
});
