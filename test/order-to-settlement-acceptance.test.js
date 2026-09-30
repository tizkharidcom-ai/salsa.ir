'use strict';

// Acceptance contract for the guest/staff order lifecycle. These tests use
// pure helpers and read route/UI source only; they deliberately do not boot
// the server or create persisted orders.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');
const {
  FULFILLMENTS,
  initialOrderStatus,
  hasAcceptedDelivery,
  nextOrderStatusAfterPayment,
  nextOrderStatusAfterDeliveryAcceptance,
  canTransitionOrder,
  canSettleOrder,
  quoteFulfillment,
  paymentStatusFor,
} = require('../server/command-center');
const {
  validateWaiterKitchenSend,
  validateWaiterCourseFire,
  validateDeliveryAcceptance,
  isKitchenOrderPaymentEligible,
} = require('../server/waiter-order-invariants');
const { createCheckoutQuoteToken, verifyCheckoutQuoteToken } = require('../server/checkout-quote');

const projectRoot = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(projectRoot, 'server/server.js'), 'utf8');
const checkoutSource = fs.readFileSync(path.join(projectRoot, 'js/checkout.js'), 'utf8');
const rolePanelSource = fs.readFileSync(path.join(projectRoot, 'js/role-panel.js'), 'utf8');

function routeBetween(startMarker, endMarker) {
  const start = serverSource.indexOf(startMarker);
  const end = serverSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing route marker: ${startMarker}`);
  assert.ok(end > start, `missing route end marker: ${endMarker}`);
  return serverSource.slice(start, end);
}

const guestCheckoutRoute = routeBetween(
  "app.post('/api/checkout/orders'",
  "app.post('/api/checkout/payments/:id/sandbox-confirm'",
);
const createOrderSource = serverSource.slice(
  serverSource.indexOf('async function createCheckoutOrder('),
  serverSource.indexOf('\nasync function createAndPersistCheckoutOrder(', serverSource.indexOf('async function createCheckoutOrder(')),
);
const settleOrderSource = serverSource.slice(
  serverSource.indexOf('const handleSettleOrder = async'),
  serverSource.indexOf("app.post('/api/cashier/orders/:id/settle'", serverSource.indexOf('const handleSettleOrder = async')),
);
const staffOrderRoute = routeBetween(
  "app.post('/api/staff/orders'",
  'const handleEditOrder =',
);
const cashierSettlementRoute = routeBetween(
  "app.post('/api/cashier/orders/:id/settle'",
  "app.post('/api/staff/orders/:id/settle'",
);
const staffSettlementRoute = routeBetween(
  "app.post('/api/staff/orders/:id/settle'",
  "app.post('/api/cashier/orders/:id/print'",
);
const waiterHandoffRoute = routeBetween(
  "app.patch('/api/waiter/orders/:id/status'",
  '// Walk-in reception is deliberately separate',
);
const cashierHandoffRoute = routeBetween(
  "app.patch('/api/cashier/orders/:id/status'",
  "app.get('/api/waiter/calls'",
);
const kitchenQueueRoute = routeBetween(
  "app.get('/api/kitchen/orders'",
  "app.patch('/api/kitchen/orders/:id'",
);
const kitchenMutationRoute = routeBetween(
  "app.patch('/api/kitchen/orders/:id'",
  "app.patch('/api/kitchen/items/:id/availability'",
);
const queuePaymentGuardSource = kitchenQueueRoute.match(/const queuePaymentEligible = \(order\) => \{[\s\S]*?\n  \};/);
assert.ok(queuePaymentGuardSource, 'KDS queue payment guard can be isolated without booting the server');
const queuePaymentEligible = new Function(
  'normalizeFulfillment', 'hasAcceptedDelivery', 'isKdsPaymentEligible',
  `${queuePaymentGuardSource[0]}\nreturn queuePaymentEligible;`,
)(
  (fulfillment) => String(fulfillment || '').trim().toLowerCase(),
  (order) => validateDeliveryAcceptance(order).ok,
  (order) => isKitchenOrderPaymentEligible(order, paymentStatusFor(order)),
);

function transition(order, nextStatus) {
  assert.equal(
    canTransitionOrder(order, nextStatus),
    true,
    `expected ${order.fulfillment}/${order.status}/${order.paymentStatus} -> ${nextStatus}`,
  );
  const at = new Date().toISOString();
  order.statusHistory = [...(Array.isArray(order.statusHistory) ? order.statusHistory : []), { status: nextStatus, at }];
  order.statusAt = at;
  order.status = nextStatus;
  return order;
}

function settle(order) {
  assert.equal(canSettleOrder(order), true, `expected payable order: ${JSON.stringify(order)}`);
  order.paymentStatus = 'paid';
  if (order.fulfillment !== 'delivery' && ['pay_at_cashier', 'awaiting_confirmation'].includes(order.status)) {
    transition(order, 'paid');
  }
  return order;
}

function finishKitchenAndHandoff(order) {
  if (order.fulfillment === 'delivery'
      && ['pending_online', 'awaiting_confirmation', 'pay_at_cashier'].includes(order.status)) {
    transition(order, 'sent_to_kitchen');
  }
  transition(order, 'preparing');
  transition(order, 'ready');
  if (order.fulfillment === 'delivery') {
    transition(order, 'dispatched');
    transition(order, 'delivered');
  } else if (order.fulfillment === 'pickup') {
    transition(order, 'picked_up');
  } else {
    transition(order, 'done');
  }
  return order;
}

test('checkout quote and initial state contracts cover dine-in, pickup, and delivery', () => {
  assert.deepEqual(FULFILLMENTS, ['dine_in', 'pickup', 'delivery']);
  for (const fulfillment of ['dine_in', 'pickup']) {
    assert.equal(initialOrderStatus({ paymentMethod: 'cashier', fulfillment }), 'pay_at_cashier');
    assert.deepEqual(quoteFulfillment({ fulfillment, subtotal: 100_000 }), {
      ok: true,
      fulfillment,
      deliveryFee: 0,
      total: 100_000,
      zone: null,
      etaMinutes: fulfillment === 'pickup' ? 20 : 0,
    });
  }
  assert.equal(initialOrderStatus({ paymentMethod: 'cashier', fulfillment: 'delivery' }), 'awaiting_confirmation');
  assert.equal(initialOrderStatus({ paymentMethod: 'online', fulfillment: 'delivery' }), 'pending_online');
  assert.equal(quoteFulfillment({ fulfillment: 'delivery', subtotal: 100_000, branchId: 3 }).code, 'delivery_zone_unavailable');
  assert.equal(quoteFulfillment({
    fulfillment: 'delivery', subtotal: 50_000, branchId: 3,
    zone: { id: 8, branchId: 3, active: true, minOrder: 60_000, fee: 7_000 },
  }).code, 'delivery_minimum_not_met');
  assert.deepEqual(quoteFulfillment({
    fulfillment: 'delivery', subtotal: 100_000, branchId: 3,
    zone: { id: 8, branchId: 3, active: true, minOrder: 60_000, fee: 7_000, etaMinutes: 35 },
    }), {
    ok: true,
    fulfillment: 'delivery',
    deliveryFee: 7_000,
    total: 107_000,
    zone: { id: 8, name: undefined, minimum: 60_000, fee: 7_000, etaMinutes: 35 },
    etaMinutes: 35,
  });

  assert.equal(quoteFulfillment({
    fulfillment: 'delivery', subtotal: 100_000, branchId: 3,
    zone: { id: 8, branchId: 3, active: true, minOrder: 0, fee: 'not-a-fee' },
  }).code, 'delivery_fee_invalid', 'a malformed configured fee cannot silently become free delivery');
  assert.equal(quoteFulfillment({
    fulfillment: 'delivery', subtotal: 100_000, branchId: 3,
    zone: { id: 8, branchId: 3, active: true, minOrder: 1.5, fee: 7_000 },
  }).code, 'delivery_zone_invalid', 'fractional delivery minimums fail closed');
  assert.equal(quoteFulfillment({
    fulfillment: 'delivery', subtotal: Number.MAX_SAFE_INTEGER, branchId: 3,
    zone: { id: 8, branchId: 3, active: true, minOrder: 0, fee: 1 },
  }).code, 'order_amount_unsafe', 'fee addition cannot overflow safe integer money');

  const secret = 'acceptance-test-only';
  const now = 1_800_000_000_000;
  const intent = { branchId: 3, fulfillment: 'delivery', zoneId: 8, total: 107_000 };
  const token = createCheckoutQuoteToken(secret, intent, now);
  assert.equal(verifyCheckoutQuoteToken(token, secret, intent, now + 1000).valid, true);
  assert.equal(verifyCheckoutQuoteToken(token, secret, { ...intent, total: 108_000 }, now + 1000).valid, false);
});

test('cash-at-checkout journey can reach the correct kitchen and fulfillment terminal for every path', () => {
  for (const fulfillment of FULFILLMENTS) {
    const order = {
      fulfillment,
      status: initialOrderStatus({ paymentMethod: 'cashier', fulfillment }),
      paymentStatus: 'unpaid',
    };
    settle(order);
    if (fulfillment === 'delivery') {
      assert.equal(order.status, 'awaiting_confirmation', 'settlement must not accept or advance a delivery order');
      assert.equal(order.paymentStatus, 'paid');
      order.deliveryAcceptance = {
        status: 'accepted', source: 'restaurant', reference: 'cash-journey-acceptance',
        acceptedAt: '2026-09-23T00:00:00.000Z',
        acceptedBy: { phone: 'restaurant-user-17', role: 'owner' },
      };
    }
    finishKitchenAndHandoff(order);
    assert.equal(order.status, ({ dine_in: 'done', pickup: 'picked_up', delivery: 'delivered' })[fulfillment]);
    assert.equal(order.paymentStatus, 'paid');
  }
});

test('staff send-to-kitchen flow can collect after fulfillment without crossing handoff paths', () => {
  for (const fulfillment of FULFILLMENTS) {
    const order = {
      fulfillment, status: 'sent_to_kitchen', paymentStatus: 'unpaid',
      ...(fulfillment === 'delivery' ? {
        deliveryAcceptance: {
          status: 'accepted', source: 'restaurant', reference: 'staff-journey-acceptance',
          acceptedAt: '2026-09-23T00:00:00.000Z',
          acceptedBy: { phone: 'restaurant-user-17', role: 'owner' },
        },
        statusAt: '2026-09-23T00:01:00.000Z',
      } : {}),
    };
    finishKitchenAndHandoff(order);
    assert.equal(canSettleOrder(order), true, `${fulfillment} should remain payable at its matching handoff`);
    settle(order);
    assert.equal(order.paymentStatus, 'paid');
  }
  assert.equal(canSettleOrder({ fulfillment: 'delivery', status: 'done', paymentStatus: 'unpaid' }), false);
  assert.equal(canSettleOrder({ fulfillment: 'pickup', status: 'delivered', paymentStatus: 'unpaid' }), false);
  assert.equal(canSettleOrder({ fulfillment: 'dine_in', status: 'picked_up', paymentStatus: 'unpaid' }), false);
});

test('invalid payment and fulfillment transitions fail closed', () => {
  for (const paymentStatus of ['unpaid', 'partial', 'pending', 'failed', 'unknown', 'refunded']) {
    const order = { fulfillment: 'delivery', status: 'awaiting_confirmation', paymentStatus };
    assert.equal(canTransitionOrder(order, 'paid'), false, `unsettled state ${paymentStatus}`);
  }
  for (const paymentStatus of ['paid', 'pending', 'unknown', 'refunded']) {
    assert.equal(canSettleOrder({ fulfillment: 'dine_in', status: 'ready', paymentStatus }), false, paymentStatus);
  }
  assert.equal(canTransitionOrder({ fulfillment: 'delivery', status: 'ready', paymentStatus: 'unpaid' }, 'done'), false);
  assert.equal(canTransitionOrder({ fulfillment: 'pickup', status: 'ready', paymentStatus: 'unpaid' }, 'delivered'), false);
  assert.equal(canTransitionOrder({ fulfillment: 'dine_in', status: 'ready', paymentStatus: 'unpaid' }, 'picked_up'), false);
  assert.equal(canTransitionOrder({ fulfillment: 'pickup', status: 'dispatched', paymentStatus: 'unpaid' }, 'delivered'), false);
  assert.equal(canTransitionOrder({ fulfillment: 'dine_in', status: 'pay_at_cashier', paymentStatus: 'unpaid' }, 'preparing'), false);
});

test('delivery payment is independent from restaurant acceptance and all kitchen entry guards', () => {
  const item = { menuItemId: 12, qty: 1, course: 'entrees', courseStatus: 'hold' };
  const order = {
    fulfillment: 'delivery', status: 'awaiting_confirmation', paymentStatus: 'unpaid', items: [item],
  };
  settle(order);
  assert.equal(order.status, 'awaiting_confirmation', 'payment must not advance delivery order status');
  assert.equal(order.paymentStatus, 'paid');
  assert.equal(validateDeliveryAcceptance(order).error, 'delivery_acceptance_required');
  assert.equal(validateWaiterKitchenSend(order, [item]).error, 'delivery_acceptance_required');
  assert.equal(validateWaiterCourseFire({ ...order, status: 'preparing' }, 'entrees').error,
    'delivery_acceptance_required');
  assert.equal(isKitchenOrderPaymentEligible({ ...order, status: 'sent_to_kitchen' }, 'paid'), false);
  assert.equal(canTransitionOrder(order, 'paid'), false,
    'delivery payment evidence is not an order-status transition');

  const unattributedAcceptance = {
    ...order,
    deliveryAcceptance: { status: 'accepted' },
  };
  assert.equal(hasAcceptedDelivery(unattributedAcceptance), false,
    'a status flag without restaurant source, reference, and actor is not recorded acceptance');
  assert.equal(canTransitionOrder(unattributedAcceptance, 'sent_to_kitchen'), false,
    'order transitions must reject an unattributed acceptance record');
  const attributableAcceptance = {
    ...order,
    deliveryAcceptance: {
      status: 'accepted', source: 'restaurant', reference: 'accept-route-1',
      acceptedAt: '2026-09-23T00:00:00.000Z', acceptedBy: { phone: 'restaurant-user-17', role: 'owner' },
    },
  };
  assert.equal(hasAcceptedDelivery(attributableAcceptance), true);
  assert.equal(canTransitionOrder(attributableAcceptance, 'sent_to_kitchen'), true);

  assert.match(staffOrderRoute, /sendToKitchen === true[\s\S]*?order\.status === 'pay_at_cashier'/,
    'staff creation must not release a delivery order from awaiting acceptance');
  assert.match(serverSource, /const waiterValidation = sendToKitchen[\s\S]*?validateWaiterKitchenSend\(order,/,
    'waiter send-to-kitchen uses the shared delivery-acceptance guard');
  assert.match(serverSource, /const courseValidation = validateWaiterCourseFire\(order, course\)/,
    'course fire uses the shared delivery-acceptance guard');
  assert.match(kitchenMutationRoute, /isKitchenOrderPaymentEligible\(order, paymentStatusFor\(order\)\)/,
    'KDS mutations use the shared delivery-acceptance guard');
  assert.match(settleOrderSource, /canSettleOrder\(order\)/,
    'payment settlement keeps its separate payment eligibility check');
});

test('delivery kitchen release requires both valid restaurant acceptance and KDS-eligible payment', () => {
  const unacceptedPaid = {
    fulfillment: 'delivery', status: 'awaiting_confirmation', paymentStatus: 'paid',
  };
  assert.equal(nextOrderStatusAfterPayment(unacceptedPaid), null,
    'payment without recorded restaurant acceptance does not release the order');

  const accepted = {
    ...unacceptedPaid,
    paymentStatus: 'pending',
    deliveryAcceptance: {
      status: 'accepted', source: 'restaurant', reference: 'accepted-before-payment',
      acceptedAt: '2026-09-23T00:00:00.000Z', acceptedBy: { phone: 'restaurant-user-17', role: 'owner' },
    },
  };
  assert.equal(nextOrderStatusAfterDeliveryAcceptance(accepted), null,
    'an acceptance event cannot release a ticket while payment remains KDS-ineligible');

  const paymentResolved = { ...accepted, paymentStatus: 'paid' };
  assert.equal(nextOrderStatusAfterPayment(paymentResolved), 'sent_to_kitchen',
    'once acceptance is already recorded, resolving payment can satisfy the second gate');
  assert.equal(nextOrderStatusAfterDeliveryAcceptance(paymentResolved), 'sent_to_kitchen',
    'an acceptance event can release the order if payment is already KDS-eligible');

  for (const deliveryAcceptance of [
    { status: 'accepted' },
    { status: 'accepted', source: 'waiter', reference: 'wrong-source', acceptedAt: '2026-09-23T00:00:00.000Z', acceptedBy: { phone: 'waiter-4' } },
    { status: 'accepted', source: 'restaurant', reference: 'no-actor', acceptedAt: '2026-09-23T00:00:00.000Z' },
    { status: 'accepted', source: 'restaurant', acceptedAt: '2026-09-23T00:00:00.000Z', acceptedBy: { phone: 'restaurant-user-17' } },
    { status: 'accepted', source: 'restaurant', reference: 'no-time', acceptedBy: { phone: 'restaurant-user-17' } },
    { status: 'accepted', source: 'restaurant', reference: 'invalid-time', acceptedAt: '2026-02-30T10:00:00.000Z', acceptedBy: { phone: 'restaurant-user-17' } },
  ]) {
    assert.equal(nextOrderStatusAfterPayment({ ...paymentResolved, deliveryAcceptance }), null,
      'incomplete or unattributed acceptance must not combine with payment to release the kitchen ticket');
  }
});

test('legacy paid orders with unknown payment state must not enter the kitchen', () => {
  const legacyOrder = { fulfillment: 'dine_in', status: 'paid', paymentStatus: 'unknown' };
  assert.equal(canTransitionOrder(legacyOrder, 'preparing'), false);
  assert.equal(canTransitionOrder({ fulfillment: 'dine_in', status: 'paid' }, 'preparing'), false);
  assert.equal(canTransitionOrder({ fulfillment: 'dine_in', status: 'paid', paymentStatus: 'paid' }, 'preparing'), true);
  assert.equal(isKitchenOrderPaymentEligible(legacyOrder, 'unknown'), false);
  assert.equal(isKitchenOrderPaymentEligible({ ...legacyOrder, paymentStatus: 'paid' }, 'paid'), true);
  assert.match(kitchenMutationRoute, /isKitchenOrderPaymentEligible\(order, paymentStatusFor\(order\)\)/,
    'KDS mutations must use the payment eligibility guard for every active ticket state');
  assert.match(kitchenQueueRoute, /const queuePaymentEligible = \(order\) => \{/,
    'KDS defines a payment eligibility rule for active tickets');
  assert.match(kitchenQueueRoute, /filter\(\(o\) => active\.includes\(o\.status\) && queuePaymentEligible\(o\)\)/,
    'KDS applies payment eligibility before rendering tickets');
  assert.match(kitchenQueueRoute, /return isKdsPaymentEligible\(order\)/,
    'KDS queue uses the shared fail-closed payment eligibility invariant');
  assert.equal(queuePaymentEligible({ status: 'paid', paymentStatus: 'unknown' }), false);
  assert.equal(queuePaymentEligible({ status: 'paid', paymentStatus: 'unpaid' }), false);
  assert.equal(queuePaymentEligible({ status: 'paid', paymentStatus: 'paid' }), true);
  assert.equal(queuePaymentEligible({
    fulfillment: 'delivery', status: 'sent_to_kitchen', paymentStatus: 'paid',
  }), false, 'unaccepted delivery must not appear in the queue even when paid');
  assert.equal(queuePaymentEligible({
    fulfillment: 'delivery', status: 'sent_to_kitchen', paymentStatus: 'paid',
    deliveryAcceptance: {
      status: 'accepted', source: 'restaurant', reference: 'queue-accepted-1',
      acceptedAt: '2026-09-23T00:00:00.000Z',
      acceptedBy: { phone: 'restaurant-user-17', role: 'owner' },
    },
    statusAt: '2026-09-23T00:01:00.000Z',
  }), true, 'the queue accepts an attributable restaurant decision');
  assert.match(kitchenQueueRoute, /hasAcceptedDelivery\(order\)/,
    'KDS queue read checks persisted delivery acceptance before enqueuing a ticket');
  const reconciliationGuard = kitchenMutationRoute.indexOf('payment_reconciliation_required');
  const stateMutation = kitchenMutationRoute.indexOf('ensureKdsState(order)');
  assert.ok(reconciliationGuard >= 0 && stateMutation > reconciliationGuard,
    'KDS must stop unreconciled records before changing ticket state');
});

test('KDS queue and ticket mutations fail closed for unresolved payment states', () => {
  for (const paymentStatus of ['pending', 'unknown', 'refunded', 'cancelled', 'invalid']) {
    assert.equal(queuePaymentEligible({ status: 'sent_to_kitchen', paymentStatus }), false, `queue/${paymentStatus}`);
  }
  assert.equal(queuePaymentEligible({ status: 'sent_to_kitchen', paymentStatus: 'unpaid' }), true);
  assert.equal(queuePaymentEligible({ status: 'preparing' }), false,
    'a legacy ticket with missing payment state must stay out of KDS until resolved');
  for (const paymentStatus of ['pending', 'unknown', 'refunded', 'cancelled', 'invalid']) {
    for (const status of ['sent_to_kitchen', 'preparing', 'ready', 'paid']) {
      assert.equal(isKitchenOrderPaymentEligible({ status }, paymentStatus), false, `${status}/${paymentStatus}`);
    }
  }
  for (const paymentStatus of ['unpaid', 'partial', 'failed']) {
    for (const status of ['sent_to_kitchen', 'preparing', 'ready']) {
      assert.equal(isKitchenOrderPaymentEligible({ status }, paymentStatus), true, `${status}/${paymentStatus}`);
    }
    assert.equal(isKitchenOrderPaymentEligible({ status: 'paid' }, paymentStatus), false, `paid/${paymentStatus}`);
  }
  assert.equal(isKitchenOrderPaymentEligible({ status: 'paid' }, 'paid'), true);
  assert.match(kitchenMutationRoute, /isKitchenOrderPaymentEligible\(order, paymentStatusFor\(order\)\)/,
    'unresolved tickets must be rejected before ticket rendering and counts can be advanced through an action');
});

test('route and UI contracts connect checkout, send, kitchen, handoff, and settlement', () => {
  assert.match(guestCheckoutRoute, /createAndPersistCheckoutOrder\(req\.body \|\| \{\}, \{\s*requireQuote:\s*true/s);
  assert.match(createOrderSource, /fulfillment === 'dine_in'\) && !tableNo/);
  assert.match(createOrderSource, /fulfillment === 'delivery' && !deliveryAddress/);
  assert.match(checkoutSource, /api\('\/api\/checkout\/orders'/);
  assert.match(checkoutSource, /awaiting_confirmation: \[/);

  assert.match(staffOrderRoute, /if \(req\.body\?\.sendToKitchen[\s\S]*appendOrderStatus\(order, 'sent_to_kitchen'/);
  assert.match(rolePanelSource, /api\('\/api\/staff\/orders'/);
  assert.match(rolePanelSource, /api\(`\/api\/waiter\/orders\/\$\{wt\.order\.id\}`,[\s\S]*sendToKitchen:\s*true/);

  assert.match(kitchenQueueRoute, /\['sent_to_kitchen', 'paid', 'preparing', 'ready'\]/);
  assert.match(kitchenMutationRoute, /canTransitionOrder\(order, 'preparing'\)/);
  assert.match(kitchenMutationRoute, /kds_ticket_incomplete/);
  assert.match(kitchenMutationRoute, /heldKeys\.length/);

  assert.match(settleOrderSource, /canSettleOrder\(order\)/);
  assert.match(cashierSettlementRoute, /handleSettleOrder\(req, res, targetId\)/);
  assert.match(staffSettlementRoute, /handleSettleOrder\(req, res, targetId\)/);
  assert.match(rolePanelSource, /\/api\/cashier\/orders\/\$\{order\.id\}\/settle/);
  assert.match(rolePanelSource, /\/api\/staff\/orders\/\$\{wt\.order\.id\}\/settle/);
  assert.match(cashierHandoffRoute, /ready:\s*order\.fulfillment === 'delivery' \? \['dispatched'\] : order\.fulfillment === 'pickup' \? \['picked_up'\] : \['done'\]/);
  assert.match(waiterHandoffRoute, /order\.fulfillment === 'dine_in' && order\.status === 'ready' \? \['done'\]/);
});

test('online checkout remains explicitly unavailable without a production payment provider', () => {
  const providerGate = serverSource.slice(
    serverSource.indexOf('function productionPaymentProviderReady()'),
    serverSource.indexOf('\n}', serverSource.indexOf('function productionPaymentProviderReady()')) + 2,
  );
  assert.ok(providerGate.includes("process.env.NODE_ENV !== 'production'"));
  assert.ok(providerGate.includes('return false'));
  assert.match(createOrderSource, /payment_provider_not_ready/);
});
