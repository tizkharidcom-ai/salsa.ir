'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { exposeOperationalOrderActions } = require('../server/operational-order-actions');

test('server order actions hide cancellation while an online payment is unresolved and explain why', () => {
  const order = {
    id: 71, status: 'pending_online', fulfillment: 'delivery',
    paymentMethod: 'online', paymentStatus: 'pending', amountPaid: 0,
  };
  const view = exposeOperationalOrderActions(order);

  assert.equal(view.allowedStatusTransitions.includes('cancelled'), false);
  assert.equal(view.cancellationBlocked.code, 'payment_status_reconciliation_required');
  assert.match(view.cancellationBlocked.message, /پرداخت آنلاین/);
  assert.equal(order.status, 'pending_online', 'building the view does not mutate the persisted order');
});

test('server order actions preserve safe cancellation and other canonical transitions', () => {
  const order = {
    id: 72, status: 'pay_at_cashier', fulfillment: 'dine_in',
    paymentMethod: 'cashier', paymentStatus: 'unpaid', amountPaid: 0,
  };
  const view = exposeOperationalOrderActions(order);

  assert.deepEqual(view.allowedStatusTransitions, ['sent_to_kitchen', 'cancelled']);
  assert.equal(view.cancellationBlocked, null);
});

test('server order actions retain service progress but hide cancellation when a refund is required', () => {
  const view = exposeOperationalOrderActions({
    id: 73, status: 'preparing', fulfillment: 'dine_in',
    paymentStatus: 'partial', amountPaid: 100,
  });

  assert.deepEqual(view.allowedStatusTransitions, ['ready']);
  assert.equal(view.cancellationBlocked.code, 'order_refund_required');
  assert.match(view.cancellationBlocked.message, /بازپرداخت/);
});
