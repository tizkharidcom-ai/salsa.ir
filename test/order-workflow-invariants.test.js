'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  allowedOrderTransitions,
  branchScopeForUser,
  canEditOrderBeforeKitchen,
  canSettleOrder,
  canTransitionOrder,
  paymentStatusFor,
} = require('../server/command-center');
const { QUOTE_TTL_MS, createCheckoutQuoteToken, verifyCheckoutQuoteToken } = require('../server/checkout-quote');
const { orderCancellationGuard, receivedAmount, netReceivedAmount, shouldReleaseOrderInventory } = require('../server/order-cancellation-guard');
const { paymentAttemptTransition } = require('../server/payment-attempt-transitions');
const { createOrderPaymentState, transitionOrderPaymentState } = require('../js/order-payment-state');

test('only an owner receives an unscoped branch grant', () => {
  assert.equal(branchScopeForUser({ role: 'admin' }), null);
  assert.deepEqual(branchScopeForUser({ role: 'manager' }), []);
  assert.deepEqual(branchScopeForUser({ role: 'cashier', branchId: 4 }), [4]);
});

test('an order cannot be edited after any payment is received', () => {
  assert.equal(canEditOrderBeforeKitchen({ status: 'sent_to_kitchen', paymentStatus: 'unpaid' }), true);
  assert.equal(canEditOrderBeforeKitchen({ status: 'sent_to_kitchen', paymentStatus: 'unpaid', amountPaid: 1 }), false);
  assert.equal(canEditOrderBeforeKitchen({ status: 'sent_to_kitchen', paymentStatus: 'unpaid', partialPayments: [{ amount: 1 }] }), false);
  assert.equal(canEditOrderBeforeKitchen({ status: 'pay_at_cashier', paymentStatus: 'paid' }), false);
});

test('order editing fails closed for partial, pending, refunded, or unknown payment state', () => {
  for (const paymentStatus of ['partial', 'pending', 'refunded', 'unknown']) {
    assert.equal(
      canEditOrderBeforeKitchen({ status: 'sent_to_kitchen', paymentStatus }),
      false,
      paymentStatus,
    );
  }
  assert.equal(canEditOrderBeforeKitchen({ status: 'sent_to_kitchen', paymentStatus: 'failed' }), true);
});

test('cash settlement accepts completed pickup and delivery handoffs only for matching fulfillment', () => {
  assert.equal(canSettleOrder({ status: 'delivered', fulfillment: 'delivery', paymentStatus: 'unpaid' }), true);
  assert.equal(canSettleOrder({ status: 'delivered', fulfillment: 'pickup', paymentStatus: 'unpaid' }), false);
  assert.equal(canSettleOrder({ status: 'delivered', paymentStatus: 'unpaid' }), false);
  assert.equal(canSettleOrder({ status: 'picked_up', fulfillment: 'pickup', paymentStatus: 'unpaid' }), true);
  assert.equal(canSettleOrder({ status: 'picked_up', fulfillment: 'delivery', paymentStatus: 'unpaid' }), false);
  assert.equal(canSettleOrder({ status: 'done', fulfillment: 'dine_in', paymentStatus: 'unpaid' }), true);
  assert.equal(canSettleOrder({ status: 'done', fulfillment: 'pickup', paymentStatus: 'unpaid' }), false);
  assert.equal(canSettleOrder({ status: 'cancelled', fulfillment: 'delivery' }), false);
});

test('cash settlement fails closed for pending, unknown, refunded, and already-paid states', () => {
  for (const paymentStatus of ['pending', 'unknown', 'refunded', 'paid']) {
    assert.equal(
      canSettleOrder({ status: 'ready', fulfillment: 'dine_in', paymentStatus }),
      false,
      paymentStatus,
    );
  }
  for (const paymentStatus of ['unpaid', 'partial', 'failed', 'cancelled']) {
    assert.equal(
      canSettleOrder({ status: 'ready', fulfillment: 'dine_in', paymentStatus }),
      true,
      paymentStatus,
    );
  }
});

test('status-only paid transition requires an explicitly settled payment', () => {
  for (const status of ['pay_at_cashier', 'awaiting_confirmation']) {
    for (const paymentStatus of ['unpaid', 'partial', 'pending', 'failed', 'unknown']) {
      const order = { status, paymentStatus };
      assert.equal(canTransitionOrder(order, 'paid'), false, `${status}/${paymentStatus} must not transition to paid`);
      assert.equal(allowedOrderTransitions(order).includes('paid'), false);
    }

    assert.equal(canTransitionOrder({ status, paymentStatus: 'paid' }, 'paid'), true);
  }

  // Some POS flows intentionally send an unpaid order to the kitchen. Keep
  // that handoff separate from marking the order as financially settled.
  assert.equal(canTransitionOrder({ status: 'sent_to_kitchen', paymentStatus: 'unpaid' }, 'preparing'), true);
});

test('fulfillment handoff transitions do not cross delivery, pickup and dine-in paths', () => {
  const acceptedAt = new Date(Date.now() - 60_000).toISOString();
  const kitchenStartedAt = new Date(Date.now() - 30_000).toISOString();
  const readyAt = new Date(Date.now() - 15_000).toISOString();
  const dispatchedAt = new Date(Date.now() - 5_000).toISOString();
  const acceptedDelivery = {
    statusHistory: [
      { status: 'sent_to_kitchen', at: kitchenStartedAt },
      { status: 'ready', at: readyAt },
      { status: 'dispatched', at: dispatchedAt },
    ],
    deliveryAcceptance: {
      status: 'accepted',
      source: 'restaurant',
      acceptedAt,
      acceptedBy: { phone: '09123456789', role: 'manager' },
      reference: 'accept-handoff-0001',
    },
  };
  assert.deepEqual(allowedOrderTransitions({ status: 'ready', fulfillment: 'delivery', ...acceptedDelivery }), ['dispatched', 'cancelled']);
  assert.deepEqual(allowedOrderTransitions({ status: 'ready', fulfillment: 'delivery' }), ['cancelled']);
  assert.deepEqual(allowedOrderTransitions({ status: 'ready', fulfillment: 'pickup' }), ['picked_up', 'cancelled']);
  assert.deepEqual(allowedOrderTransitions({ status: 'ready', fulfillment: 'dine_in' }), ['done', 'cancelled']);

  assert.equal(canTransitionOrder({ status: 'ready', fulfillment: 'delivery' }, 'dispatched'), false);
  assert.equal(canTransitionOrder({ status: 'ready', fulfillment: 'delivery', ...acceptedDelivery }, 'dispatched'), true);
  assert.equal(canTransitionOrder({ status: 'dispatched', fulfillment: 'delivery', ...acceptedDelivery }, 'delivered'), true);
  assert.equal(canTransitionOrder({ status: 'dispatched', fulfillment: 'delivery' }, 'delivered'), false);
  assert.equal(canTransitionOrder({ status: 'dispatched', fulfillment: 'pickup' }, 'delivered'), false);
  assert.equal(canTransitionOrder({ status: 'dispatched', fulfillment: 'dine_in' }, 'delivered'), false);
  assert.equal(canTransitionOrder({ status: 'dispatched', fulfillment: 'pickup' }, 'cancelled'), true);
});

test('legacy fulfillment and payment state are conservative when the record is incomplete', () => {
  assert.equal(paymentStatusFor({ status: 'pending_online' }), 'pending');
  assert.equal(paymentStatusFor({ status: 'paid' }), 'unknown');
  assert.equal(paymentStatusFor({ status: 'preparing' }), 'unknown');
  assert.equal(canTransitionOrder({ status: 'dispatched' }, 'delivered'), false);
  assert.deepEqual(allowedOrderTransitions({ status: 'completed' }), []);
});

test('cancellation retries surface payment reconciliation before duplicate-cancel status', () => {
  for (const paymentStatus of ['pending', 'unknown', 'cancelled', 'refunded']) {
    const result = orderCancellationGuard({ status: 'cancelled', paymentStatus, paymentMethod: 'online' });
    assert.equal(result.ok, false, paymentStatus);
    assert.equal(result.code, 'payment_status_reconciliation_required', paymentStatus);
  }

  assert.equal(orderCancellationGuard({
    status: 'cancelled', paymentStatus: 'unpaid', paymentMethod: 'cashier',
  }).code, 'order_already_cancelled');
  assert.equal(orderCancellationGuard({
    status: 'cancelled', paymentStatus: 'failed', paymentMethod: 'online',
  }).code, 'payment_status_reconciliation_required');
});

test('refund reversals reduce cancellable outstanding receipts without restoring partially paid stock', () => {
  const fullyReversed = {
    status: 'pay_at_cashier',
    paymentStatus: 'unpaid',
    paymentMethod: 'cashier',
    amountPaid: 0,
    partialPayments: [{ id: 'settlement-1', amount: 1200, refundedAmount: 1200 }],
  };
  assert.equal(receivedAmount(fullyReversed), 1200, 'historical receipt still locks editing/splitting');
  assert.equal(netReceivedAmount(fullyReversed), 0, 'verified full reversal clears the cancellation balance');
  assert.equal(orderCancellationGuard(fullyReversed).ok, true);
  assert.equal(shouldReleaseOrderInventory(fullyReversed), true);

  const partialReversal = {
    ...fullyReversed,
    paymentStatus: 'partial',
    amountPaid: 500,
    partialPayments: [{ id: 'settlement-1', amount: 1200, refundedAmount: 700 }],
  };
  assert.equal(netReceivedAmount(partialReversal), 500);
  assert.equal(orderCancellationGuard(partialReversal).code, 'order_refund_required');
  assert.equal(shouldReleaseOrderInventory(partialReversal), false);
});

test('uncertain online attempts stay locked until explicit reconciliation; paid captures require reversal', () => {
  const pendingToUnknown = paymentAttemptTransition('pending', 'unknown');
  assert.deepEqual(pendingToUnknown, { ok: true, idempotent: false });
  assert.equal(paymentAttemptTransition('unknown', 'failed').error, 'payment_status_reconciliation_required');
  assert.deepEqual(paymentAttemptTransition('unknown', 'reconciliation_required'), { ok: true, idempotent: false });
  assert.deepEqual(paymentAttemptTransition('reconciliation_required', 'failed'), { ok: true, idempotent: false });

  const unresolvedOnline = {
    status: 'pending_online',
    paymentStatus: 'unknown',
    paymentMethod: 'online',
    amountPaid: 0,
    partialPayments: [],
  };
  assert.equal(orderCancellationGuard(unresolvedOnline).code, 'payment_status_reconciliation_required');
  assert.equal(shouldReleaseOrderInventory(unresolvedOnline), false);

  const lateCapture = { ...unresolvedOnline, status: 'awaiting_confirmation', paymentStatus: 'paid', amountPaid: 1200 };
  assert.equal(paymentAttemptTransition('paid', 'refunded').error, 'payment_refund_requires_reversal');
  assert.equal(orderCancellationGuard(lateCapture).code, 'order_refund_required');
  assert.equal(shouldReleaseOrderInventory(lateCapture), false);
});

test('canonical transition inputs reject invalid enums and fulfillment crossovers without mutation', () => {
  const stateInput = {
    orderStatus: 'ready',
    paymentStatus: 'unpaid',
    fulfillment: 'delivery',
    provenance: {
      order: { source: 'staff', reference: 'ready-1' },
      payment: { source: 'cashier', reference: 'payment-1' },
    },
  };
  const state = createOrderPaymentState(stateInput).state;
  const before = structuredClone(state);
  for (const status of ['complete', 'future_state', '', null]) {
    const result = transitionOrderPaymentState(state, {
      type: 'order.transition', status,
      provenance: { source: 'staff', reference: `invalid-${String(status)}` },
    });
    assert.equal(result.ok, false, String(status));
    assert.equal(result.error, 'order_status_invalid', String(status));
    assert.deepEqual(state, before, 'rejected transitions do not mutate the input');
  }
  for (const status of ['picked_up', 'done']) {
    const result = transitionOrderPaymentState(state, {
      type: 'order.transition', status,
      provenance: { source: 'staff', reference: `wrong-handoff-${status}` },
    });
    assert.equal(result.ok, false, status);
    assert.equal(result.error, 'order_transition_invalid', status);
  }
});

test('checkout quote token binds the price intent and expires', () => {
  const secret = 'test-only-secret';
  const intent = { branchId: 1, items: [{ menuItemId: 7, qty: 2 }], total: 1200 };
  const now = 1_800_000_000_000;
  const token = createCheckoutQuoteToken(secret, intent, now);
  assert.equal(verifyCheckoutQuoteToken(token, secret, intent, now + 1000).valid, true);
  assert.equal(verifyCheckoutQuoteToken(token, secret, { ...intent, total: 1300 }, now + 1000).valid, false);
  assert.equal(verifyCheckoutQuoteToken(token, secret, intent, now + QUOTE_TTL_MS + 1).reason, 'expired');
});
