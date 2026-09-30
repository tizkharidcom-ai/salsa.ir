'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { canSettleOrder } = require('../server/command-center');
const { paymentAttemptTransition } = require('../server/payment-attempt-transitions');
const { resolveSettlementAmounts } = require('../server/settlement-amounts');
const loyaltyEngine = require('../server/finance/loyalty-engine');

const serverSource = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
const settlementLockKeySource = fs.readFileSync(path.join(__dirname, '../server/settlement-in-flight-key.js'), 'utf8');

function sourceBetween(startMarker, endMarker, label) {
  const start = serverSource.indexOf(startMarker);
  const end = serverSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${label} route/source boundaries exist`);
  return serverSource.slice(start, end);
}

function expectSource(source, pattern, message) {
  assert.ok(pattern.test(source), message);
}

function rejectSource(source, pattern, message) {
  assert.ok(!pattern.test(source), message);
}

const settlementHandler = sourceBetween(
  'const handleSettleOrder = async',
  "app.get('/api/cashier/printer'",
  'shared settlement handler',
);
const walletSettlementHandler = sourceBetween(
  "app.post('/api/orders/:id/pay-wallet'",
  "app.get('/api/admin/wallet/summary'",
  'wallet settlement handler',
);
const settlementRoutes = sourceBetween(
  "app.post('/api/cashier/orders/:id/settle'",
  "app.get('/api/cashier/printer'",
  'cashier and staff settlement routes',
);
const checkoutOrderCreator = sourceBetween(
  'async function createCheckoutOrder(',
  'async function createAndPersistCheckoutOrder(',
  'checkout order/payment-attempt creator',
);
const paymentAttemptSettlement = sourceBetween(
  'function settlePaymentAttempt(',
  'function publishPaymentCommitEffects(',
  'payment-attempt settlement helper',
);
const webhookRoute = sourceBetween(
  "app.post('/api/payments/webhook/:provider'",
  'function getOrderStatusFaLabel(',
  'payment webhook route',
);
const receiptRoute = sourceBetween(
  "app.post('/api/cashier/orders/:id/receipt'",
  "app.patch('/api/cashier/orders/:id/status'",
  'cashier receipt route',
);
const providerReadiness = sourceBetween(
  'function productionPaymentProviderReady()',
  'function guardPublicOrderMutation',
  'checkout payment provider readiness',
);
const sandboxConfirmRoute = sourceBetween(
  "app.post('/api/checkout/payments/:id/sandbox-confirm'",
  "app.post('/api/payments/webhook/:provider'",
  'sandbox confirmation route',
);
const deliveryAcceptanceRoute = sourceBetween(
  "app.post('/api/delivery/orders/:id/accept'",
  "app.patch('/api/admin/orders/:id'",
  'restaurant delivery acceptance route',
);
const kitchenQueueRoute = sourceBetween(
  "app.get('/api/kitchen/orders'",
  "app.patch('/api/kitchen/orders/:id'",
  'KDS queue route',
);

test('cashier and staff settle routes share capability-gated order settlement', () => {
  expectSource(settlementRoutes, /app\.post\('\/api\/cashier\/orders\/:id\/settle',\s*requireCapability\('payments\.manage'\)/,
    'cashier settlement requires payments.manage');
  expectSource(settlementRoutes, /app\.post\('\/api\/staff\/orders\/:id\/settle',\s*requireCapability\('payments\.collect'\)/,
    'staff settlement requires payments.collect');
  assert.equal((settlementRoutes.match(/handleSettleOrder\(req, res, targetId\)/g) || []).length, 2);
  assert.equal((settlementRoutes.match(/withCashDrawerSettlementLock\(req, targetId/g) || []).length, 2,
    'both cashier and staff cash settlements share the drawer closeout serialization boundary');
  expectSource(settlementHandler, /tender === 'cash' && !userCan\(req\.user, 'cash\.manage'\)/,
    'cash tender requires a server-side cash-management capability even on the staff collection route');
});

test('order branch authorization runs before idempotent settlement replay or paid response', () => {
  const branchGuard = settlementHandler.indexOf('assertUserBranchAccess(req.user, branchId)');
  const replayLookup = settlementHandler.indexOf("find((payment) => payment.idempotencyKey === idempotencyKey)");
  const paidResponse = settlementHandler.indexOf("if (order.paymentStatus === 'paid')");
  const unresolvedBranchGuard = settlementHandler.indexOf('persistedOrderBranchId(order)');
  assert.ok(unresolvedBranchGuard >= 0 && branchGuard > unresolvedBranchGuard && replayLookup > branchGuard && paidResponse > branchGuard,
    'the order’s persisted branch must resolve and be authorized before either replay response');
});

test('settlement idempotency binds the order, branch, tender, amounts, reference, and actor', () => {
  expectSource(settlementHandler, /process\.env\.NODE_ENV === 'production' && !idempotencyKey/, 'production settlement requires an idempotency key');
  expectSource(settlementHandler, /\^\[A-Za-z0-9\]\[A-Za-z0-9\._:-\]\{7,159\}\$/, 'settlement idempotency key is bounded and validated');
  expectSource(settlementHandler, /orderId:\s*order\.id,[\s\S]*?branchId,[\s\S]*?tender,[\s\S]*?paymentAmount:\s*rawPaymentAmount,[\s\S]*?amountTendered:\s*rawAmountTendered,[\s\S]*?paymentReference/,
    'settlement fingerprint includes order, branch, tender, cash amounts, and reference; helper also receives req.user');
  expectSource(settlementHandler, /existingPayment\.requestFingerprint && existingPayment\.requestFingerprint !== requestFingerprint/,
    'reuse of a key with a different fingerprint is rejected');
  expectSource(settlementHandler, /\.\.\.\(idempotencyKey \? \{ idempotencyKey, requestFingerprint \} : \{\}\)/,
    'settlement persists the idempotency key with its fingerprint');
});

test('manual card settlement requires the terminal receipt reference before any new tender is recorded', () => {
  const replayLookup = settlementHandler.indexOf("find((payment) => payment.idempotencyKey === idempotencyKey)");
  const referenceGuard = settlementHandler.indexOf("if (tender === 'manual_card' && !paymentReference)");
  const amountMutation = settlementHandler.indexOf('order.partialPayments.push(payment)');
  assert.ok(replayLookup >= 0 && referenceGuard > replayLookup && amountMutation > referenceGuard,
    'manual card reference is checked after exact idempotent replay and before recording new tender');
  expectSource(settlementHandler.slice(referenceGuard, amountMutation), /settlement_reference_required/,
    'manual card receipt reference has a stable API error');
  expectSource(settlementHandler.slice(referenceGuard, amountMutation), /کد پیگیری درج‌شده روی رسید کارت‌خوان/,
    'the server explains the missing terminal evidence in Persian');
  expectSource(settlementHandler.slice(referenceGuard, amountMutation),
    /settlementReferenceIdentity\(payment\?\.reference\)[\s\S]*?settlement_reference_duplicate/,
    'a normalized terminal receipt reference cannot be recorded twice on one order');
});

test('in-flight settlement coordination is isolated by tenant, branch, order, and idempotency key', () => {
  const keys = `${settlementHandler}\n${walletSettlementHandler}`;
  expectSource(serverSource, /function settlementLockKey\(req, order, idempotencyKey, branchId = order\?\.branchId\)[\s\S]*?tenantId:\s*req\?\.tenantId\s*\|\|\s*req\?\.tenantContext\?\.tenantId/,
    'the lock identity uses authenticated request tenant context');
  expectSource(keys, /settlementLockKey\(req, order, idempotencyKey, branchId\)/,
    'both cashier and wallet settlement use the resolved tenant-scoped branch identity');
  expectSource(settlementLockKeySource, /JSON\.stringify\(\[\s*normalizedTenantId,[\s\S]*?normalizedBranchId,[\s\S]*?normalizedOrderId,[\s\S]*?idempotencyKey/,
    'the lock key is an unambiguous tuple including tenant, branch, order, and retry key');
  rejectSource(keys, /settlementInFlight\.(?:get|set|delete)\(`\$\{order\.id\}:/,
    'raw order-only keys cannot cross tenant boundaries');
});

test('wallet settlement uses a resolved branch and the same refund-aware safe amount contract', () => {
  const branchResolution = walletSettlementHandler.indexOf('persistedOrderBranchId(order)');
  const lock = walletSettlementHandler.indexOf('settlementLockKey(req, order, idempotencyKey, branchId)');
  const amountResolution = walletSettlementHandler.indexOf('resolveSettlementAmounts({');
  const debit = walletSettlementHandler.indexOf('walletEngine.payFromWallet(db,');
  assert.ok(branchResolution >= 0 && lock > branchResolution && amountResolution > lock && debit > amountResolution,
    'wallet branch and validated net balance must be bound before money is debited');
  expectSource(walletSettlementHandler, /payments:\s*existingPayments,[\s\S]*?tender:\s*'wallet'/,
    'wallet payment balance comes from validated payment history including refunds');
  rejectSource(walletSettlementHandler, /existingPayments\.reduce\(\(sum, payment\) => sum \+ Math\.max\(0, Math\.round/,
    'wallet balance must not round or sum gross payment legs directly');
  expectSource(walletSettlementHandler, /order:\$\{branchId\}:\$\{order\.id\}:wallet-payment/,
    'wallet finance idempotency identity includes the resolved branch');
  expectSource(walletSettlementHandler, /if \(!isSettlementRequestFingerprint\(existingWalletPayment\.requestFingerprint\)\)[\s\S]*?idempotency_replay_unavailable/,
    'legacy wallet legs without a durable request fingerprint cannot be replayed as proven success');
  expectSource(walletSettlementHandler, /existingWalletPayment\.requestFingerprint !== requestFingerprint/,
    'wallet retries must match the original actor, order, and branch-bound intent');
});

test('order pricing and terminal status mutations share the order serialization boundary with payment settlement', () => {
  for (const route of [
    "app.post('/api/cashier/orders/:id/apply-loyalty'",
    "app.patch('/api/admin/orders/:id'",
    "app.patch('/api/v2/orders/:id/status'",
  ]) {
    const start = serverSource.indexOf(route);
    const end = serverSource.indexOf('\n});', start);
    const source = serverSource.slice(start, end > start ? end : start + 9000);
    assert.ok(start >= 0, `${route} exists`);
    assert.match(source.slice(0, 240), /serializeOrderMutationRoute\(async/,
      `${route} must queue against settlement and other order mutations`);
  }
});

test('order branch identity fails closed instead of borrowing the default branch', () => {
  const helper = serverSource.match(/function persistedOrderBranchId\(order\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper, 'persisted order branch validator exists');
  const persistedOrderBranchId = require('node:vm').runInNewContext(`${helper}; persistedOrderBranchId;`, {
    normalizeDigits: (value) => String(value ?? '').replace(/[۰-۹]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)),
  });
  assert.equal(persistedOrderBranchId({ branchId: 7 }), 7);
  assert.equal(persistedOrderBranchId({ branchId: '۰۷' }), 7);
  for (const order of [{}, { branchId: null }, { branchId: 0 }, { branchId: '1x' }, { branchId: '9007199254740992' }]) {
    assert.equal(persistedOrderBranchId(order), null);
  }
  expectSource(settlementHandler, /order_branch_unresolved/,
    'cashier settlement rejects orders without a canonical persisted branch');
  expectSource(walletSettlementHandler, /order_branch_unresolved/,
    'wallet settlement rejects orders without a canonical persisted branch');
});

test('production checkout order creation requires an idempotency key before any order-side effects', () => {
  const normalizedKey = checkoutOrderCreator.indexOf('const normalizedKey = String(idempotencyKey || \'\').trim()');
  const requiredGuard = checkoutOrderCreator.indexOf("process.env.NODE_ENV === 'production' && !normalizedKey");
  const formatGuard = checkoutOrderCreator.indexOf('normalizedKey && !ORDER_IDEMPOTENCY_KEY_RE.test(normalizedKey)');
  const branchLookup = checkoutOrderCreator.indexOf('const branch = findOrderBranch(');
  const stockWrite = checkoutOrderCreator.indexOf('menuItem.stock = Math.max(0, menuItem.stock - line.qty)');
  const orderWrite = checkoutOrderCreator.indexOf('db.orders.unshift(order)');

  assert.ok(normalizedKey >= 0 && requiredGuard > normalizedKey && formatGuard > requiredGuard,
    'missing or malformed idempotency identity is rejected at the creator boundary');
  assert.ok(branchLookup > requiredGuard && stockWrite > requiredGuard && orderWrite > requiredGuard,
    'required-key rejection happens before branch work, stock reservation, or order creation');
  assert.match(checkoutOrderCreator.slice(requiredGuard, formatGuard), /idempotency_key_required/);
});

test('partial and failed orders can collect only the outstanding amount; pending and unknown attempts cannot', () => {
  const readyOrder = { status: 'ready', fulfillment: 'dine_in' };
  for (const paymentStatus of ['partial', 'failed', 'unpaid']) {
    assert.equal(canSettleOrder({ ...readyOrder, paymentStatus }), true, paymentStatus);
  }
  for (const paymentStatus of ['pending', 'unknown', 'refunded', 'paid']) {
    assert.equal(canSettleOrder({ ...readyOrder, paymentStatus }), false, paymentStatus);
  }

  const balance = settlementHandler.indexOf('resolveSettlementAmounts({');
  const cap = settlementHandler.indexOf('const { alreadyPaid, outstanding, requestedAmount, amountTendered } = amounts');
  const statusWrite = settlementHandler.indexOf("order.paymentStatus = fullyPaid ? 'paid' : 'partial'");
  assert.ok(balance >= 0 && cap > balance && statusWrite > cap,
    'validated settlement amounts must be resolved before payment status is mutated');
  expectSource(settlementHandler, /order\.partialPayments\.push\(payment\)/, 'accepted tender is appended to the payment history');
});

test('settlement amount validation matches the UI balance and rejects silent full-balance fallbacks', () => {
  const partialPayments = [{ amount: 200 }, { amount: 100 }];
  assert.deepEqual(resolveSettlementAmounts({ total: 1000, amountPaid: 250, payments: partialPayments }), {
    ok: false, error: 'payment_history_inconsistent',
  });
  assert.deepEqual(resolveSettlementAmounts({ total: 1000, amountPaid: 300, payments: partialPayments }), {
    ok: true, orderTotal: 1000, alreadyPaid: 300, outstanding: 700, requestedAmount: 700, amountTendered: 700,
  });
  assert.equal(resolveSettlementAmounts({ total: 1000, amountPaid: 450 }).outstanding, 550);
  assert.equal(resolveSettlementAmounts({ total: 1000, amountPaid: 300, payments: partialPayments, paymentAmount: 0 }).error,
    'payment_amount_invalid');
  for (const paymentAmount of [-1, 'not-a-number', 1.5]) {
    assert.equal(resolveSettlementAmounts({ total: 1000, amountPaid: 0, payments: [], paymentAmount }).error,
      'payment_amount_invalid');
  }
  assert.equal(resolveSettlementAmounts({ total: 1000, amountPaid: 0, payments: [], paymentAmount: 1001 }).error,
    'payment_amount_exceeds_due');
  assert.equal(resolveSettlementAmounts({ total: 1000, amountPaid: 0, payments: [], tender: 'cash', paymentAmount: 100, amountTendered: 0 }).error,
    'cash_received_invalid');
  assert.equal(resolveSettlementAmounts({ total: 1000, amountPaid: 0, payments: [], tender: 'cash', paymentAmount: 100, amountTendered: 99 }).error,
    'cash_received_insufficient');
  assert.deepEqual(resolveSettlementAmounts({ total: 1000, amountPaid: 0, payments: [], tender: 'cash', paymentAmount: 100, amountTendered: 150 }), {
    ok: true, orderTotal: 1000, alreadyPaid: 0, outstanding: 1000, requestedAmount: 100, amountTendered: 150,
  });
});

test('online checkout replay returns its original attempt only for the same request fingerprint', () => {
  expectSource(checkoutOrderCreator, /checkoutIdempotencyFingerprint\(fingerprintInput, actor\)/, 'checkout replay fingerprint includes submitted intent and actor');
  expectSource(checkoutOrderCreator, /saved\.requestFingerprint !== requestFingerprint/, 'changed checkout payload conflicts on replay');
  expectSource(checkoutOrderCreator, /typeof saved\.requestFingerprint !== 'string'[\s\S]*?idempotency_replay_unavailable/,
    'legacy replay records without a payload fingerprint fail closed');
  expectSource(checkoutOrderCreator, /idempotency_key_conflict/, 'checkout returns a conflict for idempotency-key misuse');
  expectSource(checkoutOrderCreator, /payment = \{[\s\S]*?orderId:\s*order\.id,[\s\S]*?branchId:\s*branch\.id,[\s\S]*?amount:\s*order\.total,[\s\S]*?status:\s*'pending'/,
    'new attempt is linked to its order and branch for the quoted total');
  expectSource(checkoutOrderCreator, /db\.checkoutIdempotency\[normalizedKey\] = \{ orderId: order\.id, paymentAttemptId: payment\?\.id \|\| null, createdAt, requestFingerprint \}/,
    'checkout replay record refers to the original order and payment attempt');
  assert.doesNotMatch(checkoutOrderCreator, /const keys = Object\.keys\(db\.checkoutIdempotency\)[\s\S]{0,200}delete db\.checkoutIdempotency\[key\]/,
    'checkout replay keys are not evicted by an arbitrary count cap that could permit a late duplicate');
  const replayResponse = checkoutOrderCreator.indexOf('return { order, payment, idempotent: true, whatsapp: null }');
  const replayBranchGuard = checkoutOrderCreator.indexOf('assertUserBranchAccess(actor, order.branchId)');
  assert.ok(replayBranchGuard >= 0 && replayResponse > replayBranchGuard,
    'staff branch access is rechecked against the saved order before idempotent replay returns it');
  expectSource(checkoutOrderCreator, /Object\.hasOwn\(db\.checkoutIdempotency \|\| \{\}, normalizedKey\)/,
    'an existing replay record remains authoritative when its order row is missing');
  expectSource(checkoutOrderCreator, /if \(!order\)\s*\{\s*return \{ error: 'idempotency_replay_unavailable'[\s\S]*?status: 409/,
    'a stale idempotency record fails closed instead of creating a second order');
  expectSource(checkoutOrderCreator, /const paymentMatchesOrder = payment[\s\S]*?Number\(payment\.amount\) === Number\(order\.total\)[\s\S]*?order\.paymentMethod === 'online' && !paymentMatchesOrder/,
    'a replay is rejected if the linked payment attempt has a different order, branch, or amount');
});

test('checkout accepts only the implemented sandbox provider outside production', () => {
  expectSource(providerReadiness, /return configuredMode === 'sandbox' && configuredProvider === 'sandbox'/,
    'a local live-mode setting cannot make an unimplemented provider appear ready');
  expectSource(checkoutOrderCreator, /paymentMethod === 'online' && !productionPaymentProviderReady\(\)[\s\S]*?payment_provider_not_ready/,
    'online order creation independently refuses live mode without an adapter');
  expectSource(checkoutOrderCreator, /provider: 'sandbox',[\s\S]*?mode: 'sandbox'/,
    'accepted online attempts are explicitly sandbox attempts');
  expectSource(sandboxConfirmRoute, /const status = typeof req\.body\?\.status === 'string'[\s\S]*?payment_status_required[\s\S]*?payment_status_invalid[\s\S]*?settlePaymentAttempt\(payment, \{ status,/,
    'sandbox confirmation cannot infer paid from a missing or invalid result');
});

test('restaurant delivery acceptance is branch-scoped, durable, and required before kitchen exposure', () => {
  const branchGuard = deliveryAcceptanceRoute.indexOf('assertUserBranchAccess(req.user, initialBranchId)');
  const lock = deliveryAcceptanceRoute.indexOf('serializeBranchOrderMutation(initial');
  const acceptanceWrite = deliveryAcceptanceRoute.indexOf('order.deliveryAcceptance = deliveryAcceptance');
  const durableCommit = deliveryAcceptanceRoute.indexOf('await persistFinanceMutation(snapshot)');
  const postCommitEffect = deliveryAcceptanceRoute.indexOf("publishOperationalEvent('order.updated'");
  assert.ok(branchGuard >= 0 && lock > branchGuard && acceptanceWrite > lock
      && durableCommit > acceptanceWrite && postCommitEffect > durableCommit,
  'acceptance rechecks the order branch, serializes its mutation, commits durably, then publishes effects');
  assert.doesNotMatch(deliveryAcceptanceRoute.slice(0, acceptanceWrite), /paymentStatusFor\(order\)\s*!==\s*'paid'/,
    'restaurant acceptance remains available independently of payment');
  expectSource(kitchenQueueRoute, /normalizeFulfillment\(order\?\.fulfillment[\s\S]*?!hasAcceptedDelivery\(order\)\) return false/,
    'an unaccepted delivery is withheld from the kitchen ticket list');
  expectSource(serverSource, /app\.patch\('\/api\/kitchen\/orders\/:id',[\s\S]*?serializeOrderMutationRoute/,
    'KDS mutation shares the order serialization boundary with restaurant acceptance');
});

test('order creation uses only safe integer Toman discounts within the canonical subtotal', () => {
  expectSource(serverSource, /function parseOrderTomanAmount\(value\)[\s\S]*?Number\.isSafeInteger\(amount\)/,
    'order amounts accept only nonnegative safe-integer Toman values');
  expectSource(serverSource, /function calculateCheckoutPricing\([\s\S]*?const requestedManualDiscount = input\.discount === undefined \? 0 : parseOrderTomanAmount\(input\.discount\)/,
    'quote and submit reject malformed fractional staff discounts without rounding');
  expectSource(serverSource, /requestedManualDiscount > subtotal[\s\S]*?discount_exceeds_subtotal/,
    'manual discount cannot exceed the shared server-canonical subtotal');
  expectSource(checkoutOrderCreator, /const deliveryFee = parseOrderTomanAmount\(fulfillmentQuote\.deliveryFee\)/,
    'delivery fee must be integer money before the checkout quote and order total are accepted');
  expectSource(serverSource, /function calculateCheckoutPricing\([\s\S]*?Number\.isSafeInteger\(total\)/,
    'shared quote and submit total must remain a safe integer before inventory reservation');
});

test('checkout loyalty discounts require an authenticated customer and never inherit staff identity', () => {
  const pricingStart = serverSource.indexOf('function calculateCheckoutPricing(');
  const pricingEnd = serverSource.indexOf('\nasync function createCheckoutOrder(', pricingStart);
  assert.ok(pricingStart >= 0 && pricingEnd > pricingStart);
  const db = {
    users: [
      { phone: '09120000001', role: 'waiter', name: 'Staff' },
      { phone: '09120000002', role: 'user', name: 'Customer' },
    ],
    loyalty: { enabled: true },
  };
  const calculateCheckoutPricing = vm.runInNewContext(
    `${serverSource.slice(pricingStart, pricingEnd)}; calculateCheckoutPricing;`,
    {
      db,
      effectiveRole: (actor) => actor?.role || 'guest',
      normalizeDigits: (value) => String(value || ''),
      parseOrderTomanAmount: (value) => Number.isSafeInteger(Number(value)) ? Number(value) : null,
      loyaltyEngine,
      userCan: () => false,
    },
  );

  const waiter = { role: 'waiter', phone: '09120000001' };
  const waiterOrder = calculateCheckoutPricing({ input: {}, actor: waiter, subtotal: 125000, deliveryFee: 0 });
  assert.equal(waiterOrder.phone, '');
  assert.equal(waiterOrder.customerUser, null);
  assert.equal(waiterOrder.discount, 0);

  const waiterWithCustomerPhone = calculateCheckoutPricing({
    input: { phone: '09120000002' }, actor: waiter, subtotal: 125000, deliveryFee: 0,
  });
  assert.equal(waiterWithCustomerPhone.phone, '09120000002', 'an explicitly entered contact number remains on the order');
  assert.equal(waiterWithCustomerPhone.customerUser, null, 'staff must apply customer loyalty through the audited explicit flow');
  assert.equal(waiterWithCustomerPhone.discount, 0);

  const guestCheckout = calculateCheckoutPricing({
    input: { phone: '09120000002' }, actor: null, subtotal: 125000, deliveryFee: 0,
  });
  assert.equal(guestCheckout.discount, 0, 'an unverified phone number cannot claim a registered customer discount');

  const authenticatedCustomer = calculateCheckoutPricing({
    input: {}, actor: db.users[1], subtotal: 125000, deliveryFee: 0,
  });
  assert.equal(authenticatedCustomer.customerUser, db.users[1]);
  assert.equal(authenticatedCustomer.discount, 1250, 'authenticated customer tier benefits remain available');

  assert.match(checkoutOrderCreator, /input\.phone \|\| \(effectiveRole\(actor\) === 'user' \? actor\?\.phone : ''\)/);
  const quoteRoute = sourceBetween(
    "app.post('/api/checkout/quote'",
    "app.post('/api/checkout/orders'",
    'checkout quote route',
  );
  assert.doesNotMatch(quoteRoute, /req\.user\?\.phone/, 'quote must not synthesize staff phones into customer phone input');
});

test('order completion awards loyalty only to a customer account and ignores async SMS failure', async () => {
  const awardStart = serverSource.indexOf('function maybeAwardOrderLoyalty(');
  const awardEnd = serverSource.indexOf("\napp.post('/api/delivery/orders/:id/accept'", awardStart);
  assert.ok(awardStart >= 0 && awardEnd > awardStart);
  const db = {
    loyalty: { enabled: true },
    users: [
      { phone: '09120000001', role: 'waiter', points: 0 },
      { phone: '09120000002', role: 'user', name: 'Customer', points: 0 },
    ],
    loyaltyLedger: [],
  };
  const awards = [];
  let smsCalls = 0;
  const maybeAwardOrderLoyalty = vm.runInNewContext(
    `${serverSource.slice(awardStart, awardEnd)}; maybeAwardOrderLoyalty;`,
    {
      db,
      PHONE_RE: /^09\d{9}$/,
      normalizeDigits: (value) => String(value || ''),
      effectiveRole: (user) => user?.role || 'guest',
      loyaltyEngine: {
        resolveCustomerTier: () => ({ tier: { id: 'bronze', name: 'Bronze', multiplier: 1 } }),
        calculateOrderPointsEarned: () => 10,
      },
      campaignsEngine: {
        checkHappyHourStatus: () => ({ active: false, pointsMultiplier: 1 }),
        checkAndRewardReferralOnOrder() {},
      },
      awardLoyaltyPoints: (phone, points) => awards.push({ phone, points }),
      walletEngine: { getWalletBalance: () => 0 },
      smsEngine: { sendSms: () => { smsCalls += 1; return Promise.reject(new Error('SMS unavailable')); } },
      campaignWalletTopupWithFinance() {},
      console: { error() {} },
    },
  );

  const anonymousOrder = { id: 101, phone: '', total: 125000 };
  maybeAwardOrderLoyalty(anonymousOrder);
  const staffOrder = { id: 102, phone: '09120000001', total: 125000 };
  maybeAwardOrderLoyalty(staffOrder);
  assert.deepEqual(awards, [], 'anonymous orders and staff identities do not receive customer loyalty points');
  assert.equal(anonymousOrder.loyaltyAwarded, undefined);
  assert.equal(staffOrder.loyaltyAwarded, undefined);
  assert.equal(smsCalls, 0);

  const customerOrder = { id: 103, phone: '09120000002', total: 125000 };
  maybeAwardOrderLoyalty(customerOrder);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(awards, [{ phone: '09120000002', points: 10 }]);
  assert.equal(customerOrder.loyaltyAwarded, true);
  assert.equal(smsCalls, 1, 'a failed async SMS is handled without undoing customer points or crashing the request');
});

test('receipt payment state is not disclosed before the order branch is authorized', () => {
  const branchGuard = receiptRoute.indexOf('assertUserBranchAccess(req.user, branchId)');
  const paidCheck = receiptRoute.indexOf("if (order.paymentStatus !== 'paid')");
  assert.ok(branchGuard >= 0 && paidCheck > branchGuard,
    'cross-branch callers are rejected before learning whether an order is paid');
});

test('gateway payment states prevent paid downgrade and refund outside the reversal flow', () => {
  assert.deepEqual(paymentAttemptTransition('paid', 'failed'), { ok: false, error: 'payment_paid_terminal' });
  assert.deepEqual(paymentAttemptTransition('paid', 'cancelled'), { ok: false, error: 'payment_paid_terminal' });
  assert.deepEqual(paymentAttemptTransition('paid', 'refunded'), { ok: false, error: 'payment_refund_requires_reversal' });
  assert.deepEqual(paymentAttemptTransition('failed', 'paid'), { ok: false, error: 'payment_terminal_conflict' });
  assert.deepEqual(paymentAttemptTransition('failed', 'failed'), { ok: true, idempotent: true });
  expectSource(paymentAttemptSettlement, /paymentAttemptTransition\(payment\.status, status\)/, 'attempt settlement consults the transition guard');
  expectSource(paymentAttemptSettlement, /payment_reference_conflict/, 'paid replay with a changed provider reference conflicts');
});

test('tenant request context is installed before payment routes and supplies the scoped database proxy', () => {
  const tenantMiddleware = serverSource.indexOf("app.use((req, res, next) => {\n  if (!TENANT_INFRASTRUCTURE_ENABLED)");
  const tenantStoreRun = serverSource.indexOf('return tenantStorage.run({', tenantMiddleware);
  const webhookRegistration = serverSource.indexOf("app.post('/api/payments/webhook/:provider'");
  const dbProxy = serverSource.indexOf('const db = new Proxy(defaultDb, {');
  assert.ok(dbProxy >= 0 && tenantMiddleware > dbProxy && tenantStoreRun > tenantMiddleware && webhookRegistration > tenantStoreRun,
    'payment route must be registered behind tenant middleware and resolve db from request tenant context');
  expectSource(serverSource.slice(dbProxy, serverSource.indexOf('const stateStore', dbProxy)), /tenantStorage\.getStore\(\)/,
    'database proxy resolves the tenant-scoped store from async request context');
});

test('durable tenant mutations propagate snapshot write failures to the rollback wrapper', () => {
  const saveHandler = sourceBetween('function save(opts = {})', '// Critical operational routes update the order/cash snapshot');
  expectSource(saveHandler, /tenantRegistry\.saveTenantDb\(currentTenantId,\s*\{\s*requireDurable:\s*opts\.requireDurable === true\s*\}\)/,
    'tenant snapshots receive the critical-mutation durability requirement');
  expectSource(saveHandler, /if \(!opts\.requireDurable\) return Promise\.resolve\(false\);[\s\S]*?return Promise\.reject/,
    'durable tenant write failures reject instead of being acknowledged');
});

test('production payment webhook remains closed until a provider verifier is installed', () => {
  rejectSource(webhookRoute, /signature\s*!==\s*secret/,
    'a static shared-secret equality check is a bearer token, not a signed callback');
  expectSource(webhookRoute, /if\s*\(process\.env\.NODE_ENV === 'production'\)\s*\{\s*return res\.status\(503\)\.json\(\{ error: 'payment_webhook_provider_unavailable' \}\)/,
    'do not authorize production callbacks until the selected gateway raw-body verifier is integrated');
  expectSource(webhookRoute, /payment\.mode !== 'sandbox' \|\| payment\.provider !== 'sandbox'/,
    'unimplemented providers are rejected even outside production');
});

test('sandbox callback requires its exact token and is gated out before payment mutation in production', () => {
  const productionBlock = webhookRoute.indexOf("process.env.NODE_ENV === 'production'");
  const sandboxCheck = webhookRoute.indexOf("payment.mode !== 'sandbox' || payment.provider !== 'sandbox'");
  const tokenCheck = webhookRoute.indexOf('req.body.token !== payment.sandboxToken');
  const snapshot = webhookRoute.indexOf('const snapshot = snapshotFinanceMutationState()');
  assert.ok(productionBlock >= 0 && sandboxCheck > productionBlock && tokenCheck > sandboxCheck && snapshot > tokenCheck,
    'production and non-sandbox callbacks must be rejected before any mutation');
});

test('production gateway callback validates amount before capture', () => {
  expectSource(webhookRoute, /amount/,
    'verified callback amount must equal the persisted payment attempt amount');
});

test('payment-attempt settlement verifies its branch matches the linked order branch', () => {
  expectSource(paymentAttemptSettlement, /const paymentBranchId = Number\(payment\.branchId\);[\s\S]*?paymentBranchId !== orderBranchId[\s\S]{0,80}payment_order_branch_mismatch/,
    'attempt and order must be linked to the same branch before ledger capture');
});
