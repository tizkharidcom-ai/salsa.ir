'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  hasAcceptedDelivery,
  nextOrderStatusAfterDeliveryAcceptance,
  nextOrderStatusAfterPayment,
  paymentStatusFor,
} = require('../server/command-center');
const {
  isKitchenOrderPaymentEligible,
  validateDeliveryAcceptance,
} = require('../server/waiter-order-invariants');

const serverSource = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
const financeSource = fs.readFileSync(path.join(__dirname, '../server/finance-v2.js'), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = serverSource.indexOf(startMarker);
  const end = serverSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing source boundary: ${startMarker}`);
  return serverSource.slice(start, end);
}

const ageHelperSource = sourceBetween('function elapsedSecondsSince(', '\nfunction isKdsPaymentStatusEligible(');
const paymentStatusEligibilitySource = sourceBetween('function isKdsPaymentStatusEligible(', '\nfunction isKdsPaymentEligible(');
const paymentSummarySource = sourceBetween('function summarizeKdsPaymentReview(', '\nfunction kitchenTicket(');
const elapsedSecondsSince = new Function(`${ageHelperSource}\nreturn elapsedSecondsSince;`)();
const kitchenTicketSource = sourceBetween('function kitchenTicket(', '\nfunction kdsPerformance(');
const kitchenTicket = new Function(
  'ensureKdsState', 'kitchenLines', 'kitchenColumn', 'elapsedSecondsSince',
  `${kitchenTicketSource}\nreturn kitchenTicket;`,
)(
  () => ({ priority: false }),
  () => [],
  () => 'new',
  elapsedSecondsSince,
);
const isKdsPaymentStatusEligible = new Function(
  'paymentStatusFor',
  `${paymentStatusEligibilitySource}\nreturn isKdsPaymentStatusEligible;`,
)(paymentStatusFor);
const summarizeKdsPaymentReview = new Function(
  'isKdsPaymentStatusEligible', 'paymentStatusFor',
  `${paymentSummarySource}\nreturn summarizeKdsPaymentReview;`,
)(isKdsPaymentStatusEligible, paymentStatusFor);

function acceptedDeliveryOrder(overrides = {}) {
  const acceptedAt = new Date(Date.now() - 60_000).toISOString();
  return {
    id: 81,
    branchId: 4,
    fulfillment: 'delivery',
    status: 'awaiting_confirmation',
    paymentStatus: 'pending',
    statusAt: new Date(Date.now() - 30_000).toISOString(),
    deliveryAcceptance: {
      status: 'accepted',
      source: 'restaurant',
      reference: 'restaurant-acceptance-81',
      acceptedAt,
      acceptedBy: { phone: '+989121234567', role: 'manager' },
    },
    ...overrides,
  };
}

test('delivery acceptance is an explicit restaurant decision independent from payment', () => {
  const unpaidOrder = {
    fulfillment: 'delivery', status: 'awaiting_confirmation', paymentStatus: 'unpaid',
  };
  assert.equal(hasAcceptedDelivery(unpaidOrder), false);
  assert.equal(nextOrderStatusAfterDeliveryAcceptance(unpaidOrder), null);
  assert.equal(nextOrderStatusAfterPayment({
    fulfillment: 'delivery', status: 'pending_online', paymentStatus: 'paid',
  }), 'awaiting_confirmation', 'payment alone never sends a delivery order to the kitchen');

  const acceptedPending = acceptedDeliveryOrder();
  assert.equal(validateDeliveryAcceptance(acceptedPending).ok, true);
  assert.equal(nextOrderStatusAfterDeliveryAcceptance(acceptedPending), null,
    'restaurant acceptance can persist while an online payment remains pending');
  assert.equal(isKitchenOrderPaymentEligible(acceptedPending, paymentStatusFor(acceptedPending)), false,
    'pre-kitchen status and pending payment do not create KDS eligibility');

  const paidAfterAcceptance = { ...acceptedPending, paymentStatus: 'paid' };
  assert.equal(nextOrderStatusAfterPayment(paidAfterAcceptance), 'sent_to_kitchen',
    'payment resolution advances only an already accepted delivery');
  assert.equal(isKitchenOrderPaymentEligible({ ...paidAfterAcceptance, status: 'sent_to_kitchen' }, 'paid'), true);

  const acceptedCashierOrder = { ...acceptedPending, paymentStatus: 'unpaid' };
  assert.equal(nextOrderStatusAfterDeliveryAcceptance(acceptedCashierOrder), 'sent_to_kitchen',
    'cashier collection remains a separate step after restaurant acceptance');
  assert.equal(isKitchenOrderPaymentEligible({ ...acceptedCashierOrder, status: 'sent_to_kitchen' }, 'unpaid'), true);
  for (const paymentStatus of ['pending', 'unknown']) {
    assert.equal(isKitchenOrderPaymentEligible({ ...acceptedCashierOrder, status: 'sent_to_kitchen' }, paymentStatus), false);
  }
});

test('delivery acceptance route is branch-authorized, idempotent, and records acceptance before kitchen handoff', () => {
  const acceptanceRoute = sourceBetween("app.post('/api/delivery/orders/:id/accept'", "app.get('/api/kitchen/orders'");
  assert.match(acceptanceRoute, /requireCapability\('delivery\.manage'\)/);
  assert.match(acceptanceRoute, /assertUserBranchAccess\(req\.user, initialBranchId\)/);
  assert.match(acceptanceRoute, /Number\(order\.branchId\) !== initialBranchId/);
  assert.match(acceptanceRoute, /serializeBranchOrderMutation\(initial, async \(\) =>/);
  assert.match(acceptanceRoute, /Idempotency-Key/);
  assert.match(acceptanceRoute, /return res\.json\(\{ ok: true, idempotent: true, order: operationalOrderResponse\(order, req\.user\) \}\)/);

  const acceptanceWrite = acceptanceRoute.indexOf('order.deliveryAcceptance = deliveryAcceptance');
  const handoffDecision = acceptanceRoute.indexOf('nextOrderStatusAfterDeliveryAcceptance(order)');
  assert.ok(acceptanceWrite >= 0 && handoffDecision > acceptanceWrite,
    'an explicit, persisted acceptance record precedes any kitchen status handoff');
  assert.doesNotMatch(acceptanceRoute, /paymentStatusFor\(order\)\s*!==\s*'paid'/,
    'restaurant acceptance does not require payment to be settled');
});

test('KDS age fields stay finite and explicitly unknown for invalid timestamps', () => {
  assert.equal(elapsedSecondsSince('not-a-date', 10_000), null);
  assert.equal(elapsedSecondsSince('', 10_000), null);
  assert.equal(elapsedSecondsSince('1970-01-01T00:00:01.000Z', 5_000), 4);
  assert.equal(elapsedSecondsSince('1970-01-01T00:00:10.000Z', 5_000), 0);
  const ticket = kitchenTicket({ status: 'preparing', createdAt: 'not-a-date', startedAt: 'also-invalid' }, 10_000);
  assert.equal(ticket.ageSec, null);
  assert.equal(ticket.ageKnown, false);
  assert.equal(Number.isNaN(ticket.ageSec), false);
  assert.equal(ticket.prepAgeSec, null);
  assert.equal(ticket.prepAgeKnown, false);
});

test('KDS queue rejects unknown or pending payment and the blocker summary is branch-only', () => {
  for (const paymentStatus of ['unknown', 'pending', 'refunded', 'cancelled', 'invalid']) {
    assert.equal(isKdsPaymentStatusEligible({ status: 'preparing', paymentStatus }), false, paymentStatus);
  }
  assert.equal(isKdsPaymentStatusEligible({ status: 'preparing' }), false, 'missing active-order payment state resolves to unknown');
  assert.equal(isKdsPaymentStatusEligible({ status: 'sent_to_kitchen', paymentStatus: 'unpaid' }), true);
  assert.equal(isKdsPaymentStatusEligible({ status: 'paid', paymentStatus: 'unpaid' }), false);
  assert.equal(isKdsPaymentStatusEligible({ status: 'paid', paymentStatus: 'paid' }), true);

  const summary = summarizeKdsPaymentReview([
    { id: 1, branchId: 1, status: 'sent_to_kitchen', paymentStatus: 'pending', customerPhone: 'private' },
    { id: 2, branchId: 1, status: 'preparing', paymentStatus: 'unknown', customerName: 'private' },
    { id: 3, branchId: 1, status: 'ready' },
    { id: 4, branchId: 1, status: 'paid', paymentStatus: 'unpaid' },
    { id: 5, branchId: 1, status: 'paid', paymentStatus: 'paid' },
    { id: 6, branchId: 2, status: 'preparing', paymentStatus: 'unknown' },
    { id: 7, branchId: 1, status: 'cancelled', paymentStatus: 'unknown' },
  ], 1);
  assert.deepEqual(summary, {
    blockedCount: 4,
    pendingCount: 1,
    unknownCount: 2,
    incompatibleCount: 1,
  });
  assert.deepEqual(Object.keys(summary).sort(), ['blockedCount', 'incompatibleCount', 'pendingCount', 'unknownCount'].sort());
});

test('existing order API provides rows; KDS adds only a branch-scoped operational blocker count', () => {
  const adminOrdersRoute = sourceBetween("app.get('/api/admin/orders'", "app.post('/api/staff/orders'");
  assert.match(adminOrdersRoute, /requireCapability\('orders\.view'\)/);
  assert.match(adminOrdersRoute, /if \(branchId != null\) orders = orders\.filter\(\(o\) => Number\(o\.branchId\) === Number\(branchId\)\)/);
  assert.match(adminOrdersRoute, /orders\.map\(\(order\) => operationalOrderResponse\(order, req\.user\)\)/,
    'authorized order viewers receive branch-filtered, PII-allowlisted rows with canonical server-authorized actions');
  assert.doesNotMatch(adminOrdersRoute, /paymentStatusFor\(o\).*filter|filter\(.*paymentStatus/,
    'pending/unknown rows are not removed from the order API');

  const kdsRoute = sourceBetween("app.get('/api/kitchen/orders'", "app.patch('/api/kitchen/orders/:id'");
  assert.match(kdsRoute, /requireKitchen/);
  assert.match(kdsRoute, /const bid = requestedKdsBranch\(req\)/);
  assert.match(kdsRoute, /filter\(\(o\) => active\.includes\(o\.status\) && queuePaymentEligible\(o\)\)/);
  assert.match(kdsRoute, /return isKdsPaymentEligible\(order\)/);
  assert.match(kdsRoute, /paymentReview: summarizeKdsPaymentReview\(branchOrders, bid\)/);
  assert.match(kdsRoute, /const branchOrders = \(db\.orders \|\| \[\]\)\.filter\(\(order\) => Number\(order\.branchId\) === Number\(bid\)\)/);
  assert.doesNotMatch(paymentSummarySource, /\b(?:id|orderNo|customerName|customerPhone|amount)\b/i,
    'payment-review aggregate contains counts only, with no row identifiers or PII fields');
  assert.equal(serverSource.includes("app.get('/api/cashier/orders/payment-review-summary'"), false,
    'do not add a redundant cashier endpoint when the authorized order API already exposes rows');
  assert.match(financeSource, /app\.get\('\/api\/admin\/v2\/finance\/reconciliation', requireCapability\('finance\.reconcile'\)/,
    'financial reconciliation remains separately capability-gated');
});
