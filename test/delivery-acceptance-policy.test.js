'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');
const {
  hasAcceptedDelivery,
  nextOrderStatusAfterPayment,
  nextOrderStatusAfterDeliveryAcceptance,
  allowedOrderTransitions,
  canTransitionOrder,
} = require('../server/command-center');
const { exposeOperationalOrderActions } = require('../server/operational-order-actions');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');
const acceptedByRestaurant = (reference = 'accept-policy-0001') => ({
  status: 'accepted',
  source: 'restaurant',
  acceptedAt: new Date().toISOString(),
  acceptedBy: { phone: '09123456789', role: 'manager' },
  reference,
});

test('delivery payment and restaurant acceptance remain independent state axes', () => {
  const paidUnaccepted = {
    fulfillment: 'delivery',
    status: 'awaiting_confirmation',
    paymentStatus: 'paid',
  };
  assert.equal(hasAcceptedDelivery(paidUnaccepted), false);
  assert.equal(nextOrderStatusAfterPayment(paidUnaccepted), null);
  assert.equal(canTransitionOrder(paidUnaccepted, 'paid'), false);
  assert.equal(canTransitionOrder(paidUnaccepted, 'sent_to_kitchen'), false);
  assert.deepEqual(allowedOrderTransitions(paidUnaccepted), ['cancelled']);

  const acceptedCash = {
    fulfillment: 'delivery',
    status: 'awaiting_confirmation',
    paymentStatus: 'unpaid',
    deliveryAcceptance: acceptedByRestaurant(),
  };
  assert.equal(nextOrderStatusAfterDeliveryAcceptance(acceptedCash), 'sent_to_kitchen');
  assert.equal(canTransitionOrder(acceptedCash, 'sent_to_kitchen'), true);
  assert.equal(canTransitionOrder(acceptedCash, 'paid'), false);

  const acceptedPendingOnline = {
    fulfillment: 'delivery',
    status: 'pending_online',
    paymentStatus: 'pending',
    deliveryAcceptance: acceptedByRestaurant('accept-policy-0002'),
  };
  assert.equal(nextOrderStatusAfterDeliveryAcceptance(acceptedPendingOnline), null);
  assert.equal(canTransitionOrder(acceptedPendingOnline, 'sent_to_kitchen'), false);
  acceptedPendingOnline.paymentStatus = 'paid';
  assert.equal(nextOrderStatusAfterPayment(acceptedPendingOnline), 'sent_to_kitchen');
  assert.equal(canTransitionOrder(acceptedPendingOnline, 'sent_to_kitchen'), true);

  const paidOnlineAwaitingAcceptance = {
    fulfillment: 'delivery',
    status: 'pending_online',
    paymentStatus: 'paid',
  };
  assert.equal(nextOrderStatusAfterPayment(paidOnlineAwaitingAcceptance), 'awaiting_confirmation');
  assert.equal(canTransitionOrder(paidOnlineAwaitingAcceptance, 'awaiting_confirmation'), true);
});

test('every delivery kitchen and courier transition fails closed without acceptance', () => {
  const guarded = [
    [{ fulfillment: 'delivery', status: 'awaiting_confirmation', paymentStatus: 'unpaid' }, 'sent_to_kitchen'],
    [{ fulfillment: 'delivery', status: 'sent_to_kitchen', paymentStatus: 'unpaid' }, 'preparing'],
    [{ fulfillment: 'delivery', status: 'preparing', paymentStatus: 'paid' }, 'ready'],
    [{ fulfillment: 'delivery', status: 'ready', paymentStatus: 'paid' }, 'dispatched'],
    [{ fulfillment: 'delivery', status: 'dispatched', paymentStatus: 'paid' }, 'delivered'],
  ];
  for (const [order, next] of guarded) assert.equal(canTransitionOrder(order, next), false, `${order.status} -> ${next}`);

  const acceptedReady = {
    fulfillment: 'delivery',
    status: 'ready',
    paymentStatus: 'paid',
    deliveryAcceptance: acceptedByRestaurant('accept-policy-0003'),
  };
  acceptedReady.deliveryAcceptance.acceptedAt = new Date(Date.now() - 2_000).toISOString();
  acceptedReady.startedAt = new Date(Date.parse(acceptedReady.deliveryAcceptance.acceptedAt) + 1).toISOString();
  assert.equal(canTransitionOrder(acceptedReady, 'dispatched'), true);
});

test('a status-only or platform-originated acceptance has no restaurant authority', () => {
  const base = { fulfillment: 'delivery', status: 'sent_to_kitchen', paymentStatus: 'unpaid' };
  assert.equal(hasAcceptedDelivery({ ...base, deliveryAcceptance: { status: 'accepted' } }), false);
  assert.equal(hasAcceptedDelivery({
    ...base,
    deliveryAcceptance: { ...acceptedByRestaurant(), acceptedAt: new Date(Date.now() + 60_000).toISOString() },
  }), false);
  assert.equal(hasAcceptedDelivery({
    ...base,
    deliveryAcceptance: { ...acceptedByRestaurant(), source: 'platform' },
  }), false);
  assert.equal(hasAcceptedDelivery({
    ...base,
    deliveryAcceptance: { ...acceptedByRestaurant(), acceptedBy: { phone: '09123456789', role: 'kitchen' } },
  }), false);
});

test('operational action projection normalizes delivery and only exposes courier transitions after valid acceptance', () => {
  const acceptedAt = new Date(Date.now() - 2_000).toISOString();
  const kitchenAt = new Date(Date.now() - 1_000).toISOString();
  const ready = {
    fulfillment: ' DELIVERY ',
    status: 'ready',
    paymentStatus: 'paid',
    startedAt: kitchenAt,
    statusHistory: [{ status: 'sent_to_kitchen', at: kitchenAt }],
    deliveryAcceptance: {
      ...acceptedByRestaurant('accept-projection-0001'),
      acceptedAt,
    },
  };

  const allowed = exposeOperationalOrderActions(ready);
  assert.deepEqual(allowed.allowedStatusTransitions, ['dispatched']);

  const unaccepted = exposeOperationalOrderActions({
    ...ready,
    deliveryAcceptance: { status: 'accepted', source: 'restaurant', acceptedAt },
  });
  assert.equal(unaccepted.allowedStatusTransitions.includes('dispatched'), false,
    'status text alone cannot enable courier handoff');
});

test('restaurant acceptance API is branch-scoped, idempotent, audited and durably persisted', () => {
  const start = server.indexOf("app.post('/api/delivery/orders/:id/accept'");
  const end = server.indexOf("app.patch('/api/admin/orders/:id'", start);
  assert.ok(start >= 0 && end > start, 'delivery acceptance route is registered before the general order-status routes');
  const route = server.slice(start, end);
  assert.match(route, /requireCapability\('delivery\.manage'\)/);
  assert.match(route, /assertUserBranchAccess\(req\.user, initialBranchId\)/);
  assert.match(route, /deliveryAcceptance\?\.status === 'accepted'[\s\S]*idempotent: true/);
  assert.match(route, /delivery_acceptance_idempotency_conflict/);
  assert.match(route, /const deliveryAcceptance = \{\s*status: 'accepted'/);
  assert.match(route, /acceptedBy: \{ phone: String\(req\.user\.phone \|\| ''\), role: effectiveRole\(req\.user\) \}/);
  assert.match(route, /validateDeliveryAcceptance\(\{ fulfillment: 'delivery', deliveryAcceptance \}\)/);
  assert.match(route, /validateDeliveryAcceptance\(order\)/);
  assert.match(route, /recordAudit\(req, 'delivery\.order_accepted'/);
  assert.match(route, /persistFinanceMutation\(snapshot\)/);
  assert.match(route, /delivery_acceptance_idempotency_required/);
  assert.match(route, /delivery_acceptance_after_kitchen_start/);
});

test('online, cashier and wallet payment handlers use the shared post-payment transition policy', () => {
  assert.match(server, /const nextStatus = nextOrderStatusAfterPayment\(order\);[\s\S]{0,180}canTransitionOrder\(order, nextStatus\)/);
  assert.match(server, /const activeTickets = branchOrders[\s\S]{0,1500}queuePaymentEligible\(o\)/);
  const queueStart = server.indexOf("app.get('/api/kitchen/orders'");
  const queueEnd = server.indexOf("app.patch('/api/kitchen/orders/:id'", queueStart);
  const queueRoute = server.slice(queueStart, queueEnd);
  assert.match(queueRoute, /!hasAcceptedDelivery\(order\)\) return false/);
  const mutationStart = queueEnd;
  const mutationEnd = server.indexOf("app.patch('/api/kitchen/items/:id/availability'", mutationStart);
  assert.match(server.slice(mutationStart, mutationEnd), /delivery_acceptance_required/);
});

test('KDS reports branch-scoped aggregate acceptance blockers without exposing blocked order details', () => {
  const start = server.indexOf("app.get('/api/kitchen/orders'");
  const end = server.indexOf("app.patch('/api/kitchen/orders/:id'", start);
  const route = server.slice(start, end);
  assert.match(route, /const acceptanceReviewTickets = branchOrders/);
  assert.match(route, /!hasAcceptedDelivery\(order\)/);
  assert.match(route, /id: order\.id,[\s\S]{0,160}branchId: order\.branchId,[\s\S]{0,260}deliveryAcceptance: \{\s*status: String\(order\.deliveryAcceptance\?\.status \|\| 'pending'\)/);
  assert.match(route, /prepareKitchenQueue\(\[\.\.\.activeTickets, \.\.\.acceptanceReviewTickets, \.\.\.cancelledTicketsForQueue\], \{ branchId: bid \}\)/);
  assert.doesNotMatch(route.slice(route.indexOf('const acceptanceReviewTickets'), route.indexOf('const queue = prepareKitchenQueue')), /phone|address|name/);
});
