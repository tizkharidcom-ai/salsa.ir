'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');
const {
  allowedOrderTransitions,
  branchScopeForUser,
  can,
} = require('../server/command-center');
const { exposeOperationalOrderActions } = require('../server/operational-order-actions');
const {
  validateDeliveryAcceptance,
  validateWaiterKitchenSend,
} = require('../server/waiter-order-invariants');

const serverSource = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');

function acceptedByRestaurant(at = new Date(Date.now() - 60_000).toISOString()) {
  return {
    status: 'accepted',
    source: 'restaurant',
    acceptedAt: at,
    acceptedBy: { phone: '09123456789', role: 'manager' },
    reference: 'accept-transition-001',
  };
}

test('fulfillment transitions remain distinct for delivery, dine-in, and pickup', () => {
  assert.deepEqual(allowedOrderTransitions({ status: 'ready', fulfillment: 'dine_in', paymentStatus: 'unpaid' }), ['done', 'cancelled']);
  assert.deepEqual(allowedOrderTransitions({ status: 'ready', fulfillment: 'pickup', paymentStatus: 'unpaid' }), ['picked_up', 'cancelled']);
  assert.deepEqual(allowedOrderTransitions({ status: 'ready', fulfillment: 'delivery', paymentStatus: 'unpaid' }), ['cancelled']);

  const acceptedDelivery = {
    status: 'ready', fulfillment: 'delivery', paymentStatus: 'unpaid',
    statusHistory: [
      { status: 'sent_to_kitchen', at: new Date(Date.now() - 30_000).toISOString() },
      { status: 'ready', at: new Date(Date.now() - 15_000).toISOString() },
    ],
    deliveryAcceptance: acceptedByRestaurant(),
  };
  assert.deepEqual(allowedOrderTransitions(acceptedDelivery), ['dispatched', 'cancelled']);
});

test('delivery acceptance is independent from payment but mandatory before waiter kitchen handoff', () => {
  const line = { menuItemId: 7, qty: 1, course: 'entrees', courseStatus: 'fired' };
  const order = {
    id: 12, status: 'awaiting_confirmation', fulfillment: 'delivery', paymentStatus: 'unpaid',
    deliveryAcceptance: acceptedByRestaurant(),
  };
  assert.deepEqual(validateDeliveryAcceptance(order), {
    ok: true, applicable: true, reference: 'accept-transition-001',
    actorId: '09123456789', acceptedAt: order.deliveryAcceptance.acceptedAt,
  });
  assert.equal(validateWaiterKitchenSend(order, [line], { canonicalLines: [line] }).ok, true);
  assert.equal(validateWaiterKitchenSend({ ...order, deliveryAcceptance: undefined }, [line], {
    canonicalLines: [line],
  }).error, 'delivery_acceptance_required');
  assert.deepEqual(allowedOrderTransitions({ ...order, paymentStatus: 'unpaid' }), ['sent_to_kitchen', 'cancelled']);
});

test('case and whitespace variants cannot turn delivery into pickup in waiter guards or action projections', () => {
  const malformedDelivery = {
    id: 13, status: 'awaiting_confirmation', fulfillment: ' DELIVERY ', paymentStatus: 'unpaid',
  };
  assert.equal(validateDeliveryAcceptance(malformedDelivery).error, 'delivery_acceptance_required');

  const line = { menuItemId: 7, qty: 1, courseStatus: 'fired' };
  assert.equal(validateWaiterKitchenSend(malformedDelivery, [line], { canonicalLines: [line] }).error,
    'delivery_acceptance_required');

  const ready = { ...malformedDelivery, status: 'ready' };
  const actions = exposeOperationalOrderActions(ready);
  assert.equal(actions.allowedStatusTransitions.includes('picked_up'), false);
  assert.equal(actions.allowedStatusTransitions.includes('dispatched'), false);
  assert.deepEqual(actions.allowedStatusTransitions, ['cancelled']);

  const acceptedReady = {
    ...ready,
    statusHistory: [
      { status: 'sent_to_kitchen', at: new Date(Date.now() - 30_000).toISOString() },
      { status: 'ready', at: new Date(Date.now() - 15_000).toISOString() },
    ],
    deliveryAcceptance: acceptedByRestaurant(),
  };
  assert.ok(exposeOperationalOrderActions(acceptedReady).allowedStatusTransitions.includes('dispatched'));
});

test('delivery and waiter capabilities are branch-scoped before acceptance/status mutations', () => {
  assert.equal(can({ role: 'waiter', branchId: 7 }, 'service.manage'), true);
  assert.equal(can({ role: 'waiter', branchId: 7 }, 'delivery.manage'), false);
  assert.equal(can({ role: 'manager', branchId: 7 }, 'delivery.manage'), true);
  assert.deepEqual(branchScopeForUser({ role: 'manager', branchId: 7 }), [7]);
  assert.deepEqual(branchScopeForUser({ role: 'waiter' }), []);

  const acceptanceStart = serverSource.indexOf("app.post('/api/delivery/orders/:id/accept'");
  const acceptanceEnd = serverSource.indexOf("app.patch('/api/admin/orders/:id'", acceptanceStart);
  const acceptanceRoute = serverSource.slice(acceptanceStart, acceptanceEnd);
  assert.match(acceptanceRoute, /requireCapability\('delivery\.manage'\)/);
  assert.match(acceptanceRoute, /assertUserBranchAccess\(req\.user, initialBranchId\)/);
  assert.match(acceptanceRoute, /assertUserBranchAccess\(req\.user, order\.branchId\)/);
  assert.ok(acceptanceRoute.indexOf('assertUserBranchAccess(req.user, order.branchId)')
    < acceptanceRoute.indexOf('order.deliveryAcceptance = deliveryAcceptance'));

  const waiterStart = serverSource.indexOf("app.patch('/api/waiter/orders/:id/status'");
  const waiterEnd = serverSource.indexOf('\n});', waiterStart);
  const waiterRoute = serverSource.slice(waiterStart, waiterEnd);
  assert.match(waiterRoute, /requireCapability\('service\.manage'\)/);
  assert.match(waiterRoute, /assertUserBranchAccess\(req\.user, order\.branchId\)/);
  assert.ok(waiterRoute.indexOf('assertUserBranchAccess(req.user, order.branchId)')
    < waiterRoute.indexOf('appendOrderStatus(order, next'));
});
