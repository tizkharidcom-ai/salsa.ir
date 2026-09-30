'use strict';

// Cross-boundary journey acceptance. Domain rules below are executed against
// disposable in-memory objects; route wiring is checked from source because
// importing the production Express app would bind this test to its process DB,
// tenant registry and environment. This is not HTTP, browser, gateway, or DB
// runtime proof.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(projectRoot, 'server/server.js'), 'utf8');
const financeSource = fs.readFileSync(path.join(projectRoot, 'server/finance-v2.js'), 'utf8');

const {
  branchScopeForUser,
  can,
  canSettleOrder,
  canTransitionOrder,
  nextOrderStatusAfterDeliveryAcceptance,
  quoteFulfillment,
} = require('../server/command-center');
const {
  validateOrderLineInput,
  validateWaiterOrderAdd,
  validateWaiterKitchenSend,
  validateWaiterCourseFire,
  validateDeliveryAcceptance,
  isKitchenOrderPaymentEligible,
} = require('../server/waiter-order-invariants');
const { createCheckoutQuoteToken, verifyCheckoutQuoteToken } = require('../server/checkout-quote');
const { resolveSettlementAmounts } = require('../server/settlement-amounts');
const { paymentAttemptTransition } = require('../server/payment-attempt-transitions');
const { orderCancellationGuard, shouldReleaseOrderInventory } = require('../server/order-cancellation-guard');
const financeV2 = require('../server/finance-v2');
const { createOrderPaymentState, transitionOrderPaymentState } = require('../js/order-payment-state');

function sourceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${label}: source boundaries must exist`);
  return source.slice(start, end);
}

function expectSource(source, pattern, message) {
  assert.match(source, pattern, message);
}

const guestMenuRoute = sourceBetween(serverSource,
  "app.get('/api/menu'", "function complementRulesForMenuItem", 'public menu route');
const checkoutQuoteRoute = sourceBetween(serverSource,
  "app.post('/api/checkout/quote'", "app.post('/api/checkout/orders'", 'checkout quote route');
const checkoutOrderRoute = sourceBetween(serverSource,
  "app.post('/api/checkout/orders'", "app.post('/api/checkout/payments/:id/sandbox-confirm'", 'checkout order route');
const deliveryAcceptanceRoute = sourceBetween(serverSource,
  "app.post('/api/delivery/orders/:id/accept'", "app.patch('/api/admin/orders/:id'", 'restaurant delivery acceptance route');
const orderCreator = sourceBetween(serverSource,
  'async function createCheckoutOrder(', 'async function createAndPersistCheckoutOrder(', 'canonical order creator');
const quoteIntentBuilder = sourceBetween(serverSource,
  'function checkoutQuoteIntent(', 'async function createCheckoutOrder(', 'checkout quote intent builder');
const staffOrderRoute = sourceBetween(serverSource,
  "app.post('/api/staff/orders'", 'const handleEditOrder =', 'staff order route');
const waiterStatusRoute = sourceBetween(serverSource,
  "app.patch('/api/waiter/orders/:id/status'", '// Walk-in reception is deliberately separate', 'waiter status route');
const kitchenReadRoute = sourceBetween(serverSource,
  "app.get('/api/kitchen/orders'", "app.patch('/api/kitchen/orders/:id'", 'KDS queue route');
const kitchenMutationRoute = sourceBetween(serverSource,
  "app.patch('/api/kitchen/orders/:id'", "app.patch('/api/kitchen/items/:id/availability'", 'KDS mutation route');
const settlementHandler = sourceBetween(serverSource,
  'const handleSettleOrder = async', "app.get('/api/cashier/printer'", 'shared cashier settlement handler');
const cancellationRoute = sourceBetween(serverSource,
  "app.patch('/api/cashier/orders/:id/status'", "app.get('/api/waiter/calls'", 'cashier cancellation route');
const paymentWebhookRoute = sourceBetween(serverSource,
  "app.post('/api/payments/webhook/:provider'", 'function getOrderStatusFaLabel', 'payment webhook route');
const refundRoute = sourceBetween(financeSource,
  "app.post('/api/admin/v2/finance/orders/:orderId/refund-requests'", "app.get('/api/admin/v2/finance/purchases-payables'", 'Finance V2 refund route');

const canonicalLine = Object.freeze({
  menuItemId: 17,
  qty: 2,
  seat: 1,
  modifiers: [],
  complements: [],
  price: 12_000,
  unitTotal: 12_000,
  lineTotal: 24_000,
  course: 'entrees',
  courseStatus: 'fired',
  note: 'بدون فلفل',
});

function refundDb() {
  return {
    orders: [{ id: 'journey-order-1', branchId: 4, total: 1_000, paymentStatus: 'paid', paidAt: '2026-09-20T10:00:00.000Z' }],
    financeV2: {
      payments: [{
        id: 'journey-finance-payment-1', orderId: 'journey-order-1', branchId: 4,
        tender: 'online', amountIrr: 10_000, status: 'succeeded', provider: 'gateway-a',
        providerReference: 'journey-reference-1', idempotencyKey: 'order:journey-order-1:payment:attempt-1',
      }],
      journalEntries: [{ id: 'journey-sale-journal-1', source: 'order.paid', sourceId: 'journey-order-1', branchId: 4, status: 'posted' }],
      refunds: [],
      approvals: [],
    },
  };
}

test('public menu/cart/quote/submit contract uses server catalog pricing and a branch-bound quote', () => {
  expectSource(guestMenuRoute, /publicGuestMenuPayload\(req\.query \|\| \{\}\)/,
    'the public menu route delegates to the canonical guest menu payload');
  expectSource(checkoutQuoteRoute, /findOrderBranch\(input,[\s\S]*?orderLinesFromRequest\(input\.items,\s*\{\s*branchId:\s*branch\.id\s*\}\)/,
    'the quote resolves a branch and prices cart lines from the server catalog');
  expectSource(checkoutQuoteRoute, /quoteFulfillment\(/,
    'fulfillment fees and minimums are calculated by the server contract');
  expectSource(checkoutQuoteRoute, /calculateCheckoutPricing\(/,
    'quote uses the same discount, phone, and total calculator as submission');
  expectSource(orderCreator, /calculateCheckoutPricing\(/,
    'submission uses the canonical quote pricing calculator');
  expectSource(checkoutQuoteRoute, /input\.tableNo \|\| input\.table/,
    'quote resolves the same table alias that submission uses');
  expectSource(quoteIntentBuilder, /tenantStorage\.getStore\(\)\?\.tenantId[\s\S]*?tenantId,/,
    'signed checkout quotes are bound to the authenticated host-resolved tenant');
  expectSource(checkoutOrderRoute, /publicOrderMutationGuard\('orders\.online'\)/,
    'public checkout mutations are entitlement-gated');
  expectSource(checkoutOrderRoute, /normalizeCheckoutReceiptCode\(rawReceiptCode\)[\s\S]*?requireQuote:\s*true[\s\S]*?idempotencyKey:\s*checkoutReceiptIndexKey\(receiptCode\)/,
    'checkout submission requires a quote and indexes the stable guest receipt code');
  expectSource(checkoutOrderRoute, /actor:\s*req\.user \|\| null/,
    'submission uses the same authenticated phone and loyalty context as the quote');

  const validatedLine = validateOrderLineInput(canonicalLine);
  assert.equal(validatedLine.ok, true);
  const delivery = quoteFulfillment({
    fulfillment: 'delivery', subtotal: canonicalLine.lineTotal, branchId: 4,
    zone: { id: 9, branchId: 4, active: true, minOrder: 20_000, fee: 3_000, etaMinutes: 35 },
  });
  assert.equal(delivery.ok, true);
  assert.equal(delivery.total, 27_000);
  assert.equal(quoteFulfillment({
    fulfillment: 'delivery', subtotal: 24_000, branchId: 4,
    zone: { id: 10, branchId: 5, active: true, minOrder: 0, fee: 0 },
  }).code, 'delivery_zone_unavailable');

  const secret = 'journey-acceptance-only';
  const issuedAt = 1_800_000_000_000;
  const quoteIntent = {
    tenantId: 'tenant-a',
    branchId: 4, fulfillment: 'delivery', zoneId: 9,
    subtotal: 24_000, deliveryFee: 3_000, discount: 0, total: 27_000,
  };
  const token = createCheckoutQuoteToken(secret, quoteIntent, issuedAt);
  assert.equal(verifyCheckoutQuoteToken(token, secret, quoteIntent, issuedAt + 1_000).valid, true);
  assert.equal(verifyCheckoutQuoteToken(token, secret, { ...quoteIntent, branchId: 5 }, issuedAt + 1_000).valid, false,
    'a quote cannot be replayed for another branch');
  assert.equal(verifyCheckoutQuoteToken(token, secret, { ...quoteIntent, tenantId: 'tenant-b' }, issuedAt + 1_000).valid, false,
    'a quote cannot be replayed across restaurant tenants that reuse branch and menu ids');
  assert.equal(verifyCheckoutQuoteToken(token, secret, { ...quoteIntent, total: 26_999 }, issuedAt + 1_000).valid, false,
    'a changed amount invalidates the checkout quote');

  const verifyBeforeInventory = orderCreator.indexOf('verifyCheckoutQuoteToken(');
  const inventoryMutation = orderCreator.indexOf('// Deduct stock only after validating the current server-side quote.');
  assert.ok(verifyBeforeInventory >= 0 && inventoryMutation > verifyBeforeInventory,
    'the actual creator verifies quote intent before reserving inventory');

  const replayLookup = orderCreator.indexOf("Object.hasOwn(db.checkoutIdempotency || {}, normalizedKey)");
  const freshBranchGuard = orderCreator.indexOf('assertUserBranchAccess(actor, branch.id)');
  const replayBranchGuard = orderCreator.indexOf('assertUserBranchAccess(actor, order.branchId)');
  assert.ok(replayLookup >= 0 && replayBranchGuard > replayLookup,
    'an idempotent replay is re-authorized against the persisted order branch');
  assert.ok(freshBranchGuard >= 0 && freshBranchGuard < inventoryMutation,
    'a new staff order is branch-authorized before inventory reservation');
  expectSource(orderCreator, /saved\.requestFingerprint !== requestFingerprint[\s\S]*?idempotency_key_conflict/,
    'reusing an order key for a different request fails closed');
});

test('canonical order stages preserve handoff boundaries and same-event retries are idempotent', () => {
  const provenance = (source, reference) => ({ source, reference });
  let state = createOrderPaymentState({
    orderStatus: 'pay_at_cashier',
    paymentStatus: 'unpaid',
    fulfillment: 'dine_in',
    provenance: {
      order: provenance('waiter-pos', 'order-81-created'),
      payment: provenance('cashier', 'payment-81-initial'),
    },
  });
  assert.equal(state.ok, true);
  state = state.state;

  const advanceOrder = (status, reference) => {
    const result = transitionOrderPaymentState(state, {
      type: 'order.transition', status,
      provenance: provenance('westo-journey', reference),
    });
    assert.equal(result.ok, true, `${state.orderStatus} -> ${status}`);
    state = result.state;
    return result;
  };

  advanceOrder('sent_to_kitchen', 'order-81-kitchen-send');
  advanceOrder('preparing', 'order-81-preparing');
  advanceOrder('ready', 'order-81-ready');
  advanceOrder('done', 'order-81-served');
  assert.equal(state.orderStatus, 'done');

  const duplicate = transitionOrderPaymentState(state, {
    type: 'order.transition', status: 'done',
    provenance: provenance('westo-journey', 'order-81-served'),
  });
  assert.deepEqual({ ok: duplicate.ok, idempotent: duplicate.idempotent }, { ok: true, idempotent: true });
  assert.equal(transitionOrderPaymentState(state, {
    type: 'order.transition', status: 'done',
    provenance: provenance('westo-journey', 'different-event'),
  }).error, 'order_event_reference_conflict');

  const transitionOrder = (status) => ({
    type: 'order.transition', status, provenance: provenance('westo-journey', `blocked-${status}`),
  });
  assert.equal(transitionOrderPaymentState(createOrderPaymentState({
    orderStatus: 'pay_at_cashier', paymentStatus: 'unpaid', fulfillment: 'dine_in',
    provenance: {
      order: provenance('waiter-pos', 'order-82-created'),
      payment: provenance('cashier', 'payment-82-initial'),
    },
  }).state, transitionOrder('paid')).error, 'payment_not_confirmed',
  'payment cannot be declared paid by an order-stage transition');
});

test('waiter handoff -> KDS -> cashier settlement accepts only the canonical, branch-scoped journey', () => {
  const waiter = { role: 'waiter', allowedBranchIds: [4] };
  const kitchen = { role: 'kitchen', allowedBranchIds: [4] };
  const cashier = { role: 'cashier', allowedBranchIds: [4] };
  assert.equal(can(waiter, 'orders.create'), true);
  assert.equal(can(waiter, 'service.manage'), true);
  assert.equal(can(waiter, 'payments.manage'), false);
  assert.equal(can(kitchen, 'kitchen.manage'), true);
  assert.equal(can(kitchen, 'payments.collect'), false);
  assert.equal(can(cashier, 'payments.manage'), true);
  assert.deepEqual(branchScopeForUser(waiter), [4]);

  const line = { ...canonicalLine };
  assert.equal(validateWaiterOrderAdd([line], { canonicalLines: [line], sendToKitchen: true }).ok, true);
  const order = {
    id: 81, branchId: 4, fulfillment: 'dine_in', total: 24_000,
    status: 'pay_at_cashier', paymentStatus: 'unpaid', items: [line],
  };
  assert.equal(validateWaiterKitchenSend(order, [line], { canonicalLines: [line] }).ok, true);
  // The staff route has a specific send-to-kitchen action; the domain helper
  // validates its preconditions while KDS owns subsequent ticket transitions.
  order.status = 'sent_to_kitchen';
  assert.equal(isKitchenOrderPaymentEligible(order, order.paymentStatus), true);
  assert.equal(can(kitchen, 'cash.manage'), false);
  assert.equal(canTransitionOrder(order, 'preparing'), true);
  order.status = 'preparing';
  assert.equal(canTransitionOrder(order, 'ready'), true);
  order.status = 'ready';
  assert.equal(canSettleOrder(order), true);

  const firstTender = resolveSettlementAmounts({
    total: order.total, amountPaid: 0, payments: [],
    paymentAmount: 9_000, amountTendered: 10_000, tender: 'cash',
  });
  assert.equal(firstTender.ok, true);
  assert.equal(firstTender.outstanding, 24_000);
  assert.equal(firstTender.requestedAmount, 9_000);
  order.partialPayments = [{ amount: firstTender.requestedAmount, idempotencyKey: 'journey-cash-0001' }];
  order.amountPaid = firstTender.requestedAmount;
  order.paymentStatus = 'partial';
  assert.equal(canSettleOrder(order), true);
  assert.equal(canSettleOrder({ ...order, paymentStatus: 'unknown' }), false,
    'an uncertain online/payment state cannot be settled again');
  assert.equal(orderCancellationGuard(order).code, 'order_refund_required',
    'a partially paid order cannot be cancelled as if no money was received');

  const finalTender = resolveSettlementAmounts({
    total: order.total, amountPaid: order.amountPaid, payments: order.partialPayments,
    paymentAmount: 15_000, amountTendered: 15_000, tender: 'cash',
  });
  assert.equal(finalTender.ok, true);
  assert.equal(finalTender.outstanding, 15_000);
  assert.equal(resolveSettlementAmounts({
    total: order.total, amountPaid: order.amountPaid, payments: order.partialPayments,
    paymentAmount: 15_001, tender: 'manual_card',
  }).error, 'payment_amount_exceeds_due');

  expectSource(orderCreator, /validateWaiterOrderAdd\(input\.items/,
    'the shared order creator invokes canonical waiter-line validation for staff orders');
  expectSource(staffOrderRoute, /sendToKitchen === true[\s\S]*?appendOrderStatus\(order, 'sent_to_kitchen'/,
    'the accepted waiter action connects order creation to the kitchen handoff');
  expectSource(kitchenReadRoute, /filter\(\(order\) => Number\(order\.branchId\) === Number\(bid\)\)/,
    'KDS queue is filtered to the selected branch');
  expectSource(kitchenMutationRoute, /isKitchenOrderPaymentEligible\(order, paymentStatusFor\(order\)\)/,
    'KDS mutations re-check payment/order eligibility');
  const branchResolution = settlementHandler.indexOf('persistedOrderBranchId(order)');
  const branchGuard = settlementHandler.indexOf('assertUserBranchAccess(req.user, branchId)');
  const settlementMutation = settlementHandler.indexOf('order.partialPayments.push(payment)');
  assert.ok(branchResolution >= 0 && branchGuard > branchResolution && settlementMutation > branchGuard,
    'cashier settlement resolves and scopes the persisted order branch before recording a tender');
  expectSource(settlementHandler, /resolveSettlementAmounts\(/,
    'settlement validates positive integer amount and outstanding balance');
  expectSource(settlementHandler, /existingPayment\.requestFingerprint && existingPayment\.requestFingerprint !== requestFingerprint[\s\S]*?idempotency_key_conflict/,
    'a reused cashier key with a changed tender or amount is rejected');
  expectSource(settlementHandler, /order: operationalOrderResponse\(order, req\.user\),\s*payment: operationalPaymentResponse\(existingPayment, req\.user\)/,
    'a matching cashier retry returns the recorded tender instead of appending another');
  expectSource(settlementHandler, /financeV2\.capturePaidOrder\(db, order/,
    'fully paid checkout settlement is handed to the finance posting path');
});

test('delivery cannot bypass recorded restaurant acceptance through waiter, fire-course, or KDS guards', () => {
  const line = { ...canonicalLine, courseStatus: 'hold' };
  const unaccepted = {
    id: 82, branchId: 4, fulfillment: 'delivery', status: 'awaiting_confirmation',
    paymentStatus: 'paid', items: [line],
  };
  assert.equal(validateDeliveryAcceptance(unaccepted).error, 'delivery_acceptance_required');
  assert.equal(validateWaiterKitchenSend(unaccepted, [line], { canonicalLines: [line] }).error,
    'delivery_acceptance_required', 'waiter send-to-kitchen must not bypass restaurant acceptance');
  assert.equal(validateWaiterCourseFire({ ...unaccepted, status: 'preparing' }, 'entrees').error,
    'delivery_acceptance_required', 'fire-course must not bypass restaurant acceptance');
  assert.equal(isKitchenOrderPaymentEligible({ ...unaccepted, status: 'sent_to_kitchen' }, 'paid'), false,
    'KDS queue and mutation guards must reject an unaccepted delivery ticket');

  for (const provenance of [
    { source: 'waiter', reference: 'waiter-accepted', actorId: 'waiter-4' },
    { source: 'restaurant', reference: 'missing-actor' },
    { source: 'restaurant', reference: 'blank-actor', actorId: ' ' },
    { source: 'restaurant', reference: 'missing-time', actorId: 'restaurant-user-17' },
    { source: 'restaurant', reference: 'invalid-time', actorId: 'restaurant-user-17', acceptedAt: 'not-a-timestamp' },
    { source: 'restaurant', reference: 'invalid-calendar', actorId: 'restaurant-user-17', acceptedAt: '2026-02-30T10:00:00.000Z' },
  ]) {
    const invalid = {
      ...unaccepted,
      deliveryAcceptance: {
        status: 'accepted',
        source: provenance.source,
        reference: provenance.reference,
        acceptedAt: provenance.acceptedAt,
        acceptedBy: provenance.actorId ? { phone: provenance.actorId } : undefined,
      },
    };
    assert.equal(validateDeliveryAcceptance(invalid).error, 'delivery_acceptance_provenance_invalid');
    assert.equal(isKitchenOrderPaymentEligible({ ...invalid, status: 'preparing' }, 'paid'), false);
  }
  const rejected = { ...unaccepted, deliveryAcceptance: 'rejected' };
  assert.equal(validateWaiterKitchenSend(rejected, [line], { canonicalLines: [line] }).error,
    'delivery_acceptance_rejected');
  assert.equal(validateWaiterCourseFire({ ...rejected, status: 'preparing' }, 'entrees').error,
    'delivery_acceptance_rejected');

  const accepted = {
    ...unaccepted,
    status: 'awaiting_confirmation',
    deliveryAcceptance: {
      status: 'accepted', source: 'restaurant', reference: 'accept-82',
      acceptedAt: '2026-09-23T00:00:00.000Z',
      acceptedBy: { phone: 'restaurant-user-17', role: 'owner' },
    },
  };
  assert.equal(validateDeliveryAcceptance(accepted).ok, true);
  assert.equal(nextOrderStatusAfterDeliveryAcceptance({ ...accepted, paymentStatus: 'unpaid' }), 'sent_to_kitchen',
    'restaurant acceptance can release a cashier-pay delivery without collecting payment first');
  assert.equal(nextOrderStatusAfterDeliveryAcceptance({ ...accepted, paymentStatus: 'pending' }), null,
    'a pending online tender records acceptance but remains outside KDS until reconciled');
  const sendLine = { ...line, courseStatus: 'fired' };
  assert.equal(validateWaiterKitchenSend(accepted, [sendLine], { canonicalLines: [sendLine] }).ok, true);
  const preparingOrder = {
    ...accepted,
    status: 'preparing',
    statusHistory: [{ status: 'preparing', at: '2026-09-23T00:00:02.000Z' }],
  };
  const sentOrder = {
    ...accepted,
    status: 'sent_to_kitchen',
    statusHistory: [{ status: 'sent_to_kitchen', at: '2026-09-23T00:00:01.000Z' }],
  };
  assert.equal(validateWaiterCourseFire(preparingOrder, 'entrees').ok, true);
  assert.equal(isKitchenOrderPaymentEligible(sentOrder, 'paid'), true);

  const acceptedAfterKitchen = {
    ...accepted,
    status: 'sent_to_kitchen',
    statusHistory: [{ status: 'sent_to_kitchen', at: '2026-09-22T23:59:59.000Z' }],
  };
  assert.equal(validateDeliveryAcceptance(acceptedAfterKitchen).error, 'delivery_acceptance_provenance_invalid');
  assert.equal(isKitchenOrderPaymentEligible(acceptedAfterKitchen, 'paid'), false,
    'a delivery acceptance recorded after kitchen handoff never releases the order');
  for (const at of ['2026-02-30T00:00:01.000Z', new Date(Date.now() + 60_000).toISOString()]) {
    const corruptHandoff = {
      ...accepted,
      status: 'sent_to_kitchen',
      statusHistory: [{ status: 'sent_to_kitchen', at }],
    };
    assert.equal(validateDeliveryAcceptance(corruptHandoff).error, 'delivery_acceptance_provenance_invalid',
      `invalid or future kitchen timestamp ${at} cannot prove acceptance order`);
    assert.equal(isKitchenOrderPaymentEligible(corruptHandoff, 'paid'), false);
  }

  expectSource(staffOrderRoute, /sendToKitchen === true[\s\S]*?order\.status === 'pay_at_cashier'/,
    'staff order creation must not auto-release delivery orders from their awaiting-acceptance status');
  expectSource(serverSource, /const waiterValidation = sendToKitchen[\s\S]*?validateWaiterKitchenSend\(order,/,
    'waiter edits use the shared delivery-acceptance guard before kitchen handoff');
  expectSource(serverSource, /const courseValidation = validateWaiterCourseFire\(order, course\)/,
    'fire-course uses the shared delivery-acceptance guard');
  expectSource(kitchenMutationRoute, /isKitchenOrderPaymentEligible\(order, paymentStatusFor\(order\)\)/,
    'KDS mutations re-check the shared delivery-acceptance and payment guards');
  const acceptanceWrite = deliveryAcceptanceRoute.indexOf('order.deliveryAcceptance = deliveryAcceptance');
  const paymentGuard = deliveryAcceptanceRoute.slice(0, acceptanceWrite).indexOf("paymentStatusFor(order) !== 'paid'");
  assert.ok(acceptanceWrite > 0 && paymentGuard < 0,
    'restaurant acceptance records independently of payment status');
  expectSource(deliveryAcceptanceRoute, /await persistFinanceMutation\(snapshot\)[\s\S]*?publishOperationalEvent\('order\.updated'/,
    'acceptance is durable before its event and KDS projection can observe it');
});

test('online payment uncertainty is reconciled; production callback and sandbox paths remain distinct', () => {
  assert.deepEqual(paymentAttemptTransition('pending', 'unknown'), { ok: true, idempotent: false });
  assert.deepEqual(paymentAttemptTransition('unknown', 'paid'), {
    ok: false, error: 'payment_status_reconciliation_required',
  });
  assert.deepEqual(paymentAttemptTransition('unknown', 'reconciliation_required'), { ok: true, idempotent: false });
  assert.deepEqual(paymentAttemptTransition('reconciliation_required', 'paid'), { ok: true, idempotent: false });
  assert.deepEqual(paymentAttemptTransition('paid', 'refunded'), {
    ok: false, error: 'payment_refund_requires_reversal',
  });
  assert.deepEqual(paymentAttemptTransition('paid', 'paid'), { ok: true, idempotent: true },
    'provider replay of an already-confirmed result is idempotent');
  const settledState = createOrderPaymentState({
    orderStatus: 'paid', paymentStatus: 'paid', fulfillment: 'dine_in',
    provenance: {
      order: { source: 'waiter-pos', reference: 'order-paid-1' },
      payment: { source: 'cashier', reference: 'receipt-paid-1' },
    },
  });
  assert.equal(settledState.ok, true);
  assert.equal(transitionOrderPaymentState(settledState.state, {
    type: 'payment.outcome', status: 'refunded',
    provenance: { source: 'cashier', reference: 'refund-1' },
  }).error, 'payment_refund_requires_reversal',
  'refund cannot be represented as a payment-attempt status rewrite');
  expectSource(checkoutQuoteRoute, /paymentMethod === 'online' && !productionPaymentProviderReady\(\)[\s\S]*?payment_provider_not_ready/,
    'quote does not offer an online tender without a ready provider');
  expectSource(orderCreator, /paymentMethod === 'online' && !productionPaymentProviderReady\(\)[\s\S]*?payment_provider_not_ready/,
    'online order creation repeats the provider readiness check after quote acquisition');
  expectSource(paymentWebhookRoute, /process\.env\.NODE_ENV === 'production'[\s\S]*?payment_webhook_provider_unavailable/,
    'the current webhook is explicitly closed in production until a provider verifier is installed');
  expectSource(paymentWebhookRoute, /!Number\.isSafeInteger\(callbackAmount\) \|\| !Number\.isSafeInteger\(expectedAmount\) \|\| callbackAmount !== expectedAmount/,
    'sandbox callback rejects unsafe or non-integer amounts and requires an exact match to the attempt');
  expectSource(paymentWebhookRoute, /payment_status_required[\s\S]*?payment_status_invalid[\s\S]*?status,\s*reference:/,
    'sandbox callbacks cannot silently map an omitted status to paid');
});

test('cancellation preserves inventory only before kitchen and never bypasses captured or uncertain funds', () => {
  const safe = { status: 'pay_at_cashier', paymentStatus: 'unpaid', paymentMethod: 'cashier' };
  assert.equal(orderCancellationGuard(safe).ok, true);
  assert.equal(shouldReleaseOrderInventory(safe), true);

  const kitchenStarted = { ...safe, status: 'preparing' };
  assert.equal(orderCancellationGuard(kitchenStarted).cancellationStage, 'kitchen_started');
  assert.equal(shouldReleaseOrderInventory(kitchenStarted), false);

  for (const order of [
    { ...safe, paymentStatus: 'paid', amountPaid: 24_000 },
    { ...safe, paymentStatus: 'partial', partialPayments: [{ amount: 1 }] },
    { ...safe, paymentStatus: 'unknown' },
    { ...safe, paymentStatus: 'failed', paymentMethod: 'online' },
  ]) {
    assert.equal(orderCancellationGuard(order).ok, false, JSON.stringify(order));
    assert.equal(shouldReleaseOrderInventory(order), false, JSON.stringify(order));
  }

  const guardIndex = cancellationRoute.indexOf('orderCancellationGuard(order)');
  const cancelWriteIndex = cancellationRoute.indexOf('appendOrderStatus(order, next');
  assert.ok(guardIndex >= 0 && cancelWriteIndex > guardIndex,
    'cashier cancellation consults the fail-closed guard before status mutation');
});

test('refund request is branch-bound, tied to a real finance payment, and idempotent on isolated memory state', () => {
  const db = refundDb();
  const request = {
    branchId: 4, paymentId: 'journey-finance-payment-1', amountIrr: 2_000, reason: 'customer requested return',
    refundDate: '2026-09-22T12:00:00.000Z',
  };
  const first = financeV2.requestOrderRefund(db, 'journey-order-1', request, 'cashier-test', 'journey-refund-key-0001');
  const replay = financeV2.requestOrderRefund(db, 'journey-order-1', request, 'cashier-test', 'journey-refund-key-0001');
  assert.equal(first.refund.status, 'pending_approval');
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.refund.id, first.refund.id);
  assert.equal(db.financeV2.refunds.length, 1);

  assert.throws(() => financeV2.requestOrderRefund(db, 'journey-order-1', {
    ...request, branchId: 5,
  }, 'cashier-test', 'journey-refund-key-branch-0002'), {
    code: 'refund_order_branch_mismatch', status: 409,
  });
  assert.throws(() => financeV2.requestOrderRefund(db, 'journey-order-1', {
    ...request, amountIrr: 9_000, refundDate: '2026-09-22T12:01:00.000Z',
  }, 'cashier-test', 'journey-refund-key-too-large'), {
    code: 'refund_total_exceeds_payment', status: 409,
  });
  assert.equal(db.financeV2.refunds.length, 1, 'rejected attempts do not append refunds');

  expectSource(refundRoute, /requireCapability\(\['payments\.refund\.request', 'finance\.events\.manage'\]\)/,
    'refund request accepts its dedicated requester capability or finance manager capability');
  expectSource(refundRoute, /Idempotency-Key[\s\S]*?requestOrderRefund\(db, req\.params\.orderId/,
    'refund route requires a stable request key before invoking the domain operation');
  expectSource(refundRoute, /await save\(\{ requireDurable: true \}\)/,
    'refund request is not acknowledged before durable save is awaited');
});

test('tenant and branch access matrix is fail-closed for staff and explicitly scoped across order journeys', () => {
  assert.equal(branchScopeForUser({ role: 'owner' }), null, 'only owner scope is global');
  assert.deepEqual(branchScopeForUser({ role: 'waiter', allowedBranchIds: [4, '4', 5, 'invalid'] }), [4, 5]);
  assert.deepEqual(branchScopeForUser({ role: 'cashier' }), [], 'missing staff branch assignment is not global');
  assert.equal(branchScopeForUser({ role: 'cashier', allowedBranchIds: [4] }).includes(5), false,
    'a cashier assigned to branch 4 has no implicit access to branch 5');
  assert.equal(can({ role: 'waiter', allowedBranchIds: [4] }, 'payments.manage'), false);
  assert.equal(can({ role: 'kitchen', allowedBranchIds: [4] }, 'payments.collect'), false);

  const tenantMiddleware = serverSource.indexOf("app.use((req, res, next) => {\n  if (!TENANT_INFRASTRUCTURE_ENABLED)");
  const tenantContextInstall = serverSource.indexOf('return tenantStorage.run({', tenantMiddleware);
  const firstJourneyRoute = serverSource.indexOf("app.get('/api/menu'");
  assert.ok(tenantMiddleware >= 0 && tenantContextInstall > tenantMiddleware && firstJourneyRoute > tenantContextInstall,
    'the tenant request-context middleware is registered before the public menu journey');
  expectSource(serverSource.slice(tenantMiddleware, firstJourneyRoute), /tenant_control_database_unavailable/,
    'tenant-infrastructure mode fails closed if its control database is unavailable');
  expectSource(serverSource.slice(tenantMiddleware, firstJourneyRoute), /tenantStorage\.run\(/,
    'request work is executed inside tenant-scoped async context');
  expectSource(settlementHandler, /persistedOrderBranchId\(order\)[\s\S]*?assertUserBranchAccess\(req\.user, branchId\)/,
    'settlement resolves and uses the persisted order branch, not a caller-selected or default branch');
  expectSource(kitchenReadRoute, /requestedKdsBranch\(req\)/,
    'KDS resolves an allowed branch before reading its queue');
  expectSource(waiterStatusRoute, /assertUserBranchAccess\(req\.user, order\.branchId\)/,
    'waiter status actions authorize against the target order branch');
});

test.todo('BLOCKED: browser RTL and isolated PostgreSQL/staging journey with provider-signature evidence remain unverified; local HTTP plus temporary JSON persistence is not production proof');
