'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveSettlementAmounts } = require('../server/settlement-amounts');
const {
  normalizeSettlementReference,
  settlementReferenceIdentity,
  resolvePaymentAttemptReference,
  normalizeRefundReference,
  refundRequestIdentity,
  resolveRefundRequestRetry,
  buildRefundReconciliationMatch,
} = require('../server/settlement-reference');

const source = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
const { receivedAmount } = require('../server/order-cancellation-guard');
const { orderSplitLifecycleGuard } = require('../server/order-split-policy');
const splitStart = source.indexOf("app.post('/api/waiter/orders/:id/split'");
const splitEnd = source.indexOf("app.patch('/api/waiter/orders/:id/move-table'", splitStart);
assert.ok(splitStart >= 0 && splitEnd > splitStart, 'waiter split route boundaries exist');
const splitRoute = source.slice(splitStart, splitEnd);
const discountAllocationSource = source.match(/function allocateOrderSplitDiscount\([\s\S]*?\n\}/)?.[0];
assert.ok(discountAllocationSource, 'split discount allocator exists');
const allocateOrderSplitDiscount = Function(`${discountAllocationSource}; return allocateOrderSplitDiscount;`)();

test('order split blocks partial receipts and unresolved payment attempts before changing order lines', () => {
  const guardIndex = splitRoute.indexOf("['paid', 'partial', 'pending', 'unknown']");
  const receivedAmountIndex = splitRoute.indexOf('receivedAmount(order) > 0');
  const mutationIndex = splitRoute.indexOf('order.items = remainingItems');
  assert.ok(guardIndex >= 0 && receivedAmountIndex >= 0 && mutationIndex > guardIndex);
  assert.ok(mutationIndex > receivedAmountIndex);
  assert.match(splitRoute, /order_split_locked/);
});

test('split guard runs before either order mutation and locks paid, partial, pending, unknown, or received orders', () => {
  const guardStart = splitRoute.indexOf("if (['paid', 'partial', 'pending', 'unknown']");
  const primaryMutation = splitRoute.indexOf('order.items = remainingItems');
  const splitMutation = splitRoute.indexOf('db.orders.unshift(subOrder)');
  assert.ok(guardStart >= 0 && primaryMutation > guardStart && splitMutation > guardStart);
  assert.match(splitRoute, /\['paid', 'partial', 'pending', 'unknown'\]\.includes\(String\(order\.paymentStatus \|\| ''\)\.toLowerCase\(\)\)/);
  assert.match(splitRoute, /\|\| receivedAmount\(order\) > 0/);
  assert.match(source, /const \{ orderCancellationGuard, receivedAmount, shouldReleaseOrderInventory \} = require\('\.\/order-cancellation-guard'\)/);
  assert.ok(receivedAmount({
    status: 'pay_at_cashier', paymentStatus: 'unpaid', amountPaid: 0,
    partialPayments: [{ id: 'refunded-payment', amount: 100, refundedAmount: 100 }],
  }) > 0, 'refund reverses net balance but does not erase historical receipt lock for splitting');
});

test('split lifecycle guard blocks active kitchen tickets before mutating either invoice', () => {
  const replayAt = splitRoute.indexOf('if (priorSplit)');
  const lifecycleAt = splitRoute.indexOf('orderSplitLifecycleGuard(order)');
  const primaryMutation = splitRoute.indexOf('order.items = remainingItems');
  const splitMutation = splitRoute.indexOf('db.orders.unshift(subOrder)');
  assert.ok(replayAt >= 0 && lifecycleAt > replayAt && primaryMutation > lifecycleAt && splitMutation > lifecycleAt,
    'safe idempotent replays remain readable but a fresh split is blocked before changing source or target order');
  assert.match(source, /const \{ orderSplitLifecycleGuard \} = require\('\.\/order-split-policy'\)/);
  assert.match(splitRoute, /orderSplitLifecycleGuard\(order\)/);
  assert.match(splitRoute, /error: splitLifecycle\.code, message: splitLifecycle\.message/);

  for (const status of ['sent_to_kitchen', 'preparing', 'ready']) {
    assert.equal(orderSplitLifecycleGuard({ status, paymentStatus: 'unpaid' }).code,
      'order_split_kitchen_active', status);
  }
  assert.equal(orderSplitLifecycleGuard({ status: 'pay_at_cashier' }).ok, true);
  assert.equal(orderSplitLifecycleGuard({ status: 'done', startedAt: '2026-09-24T10:00:00Z' }).ok, true,
    'after table service completes, splitting the bill remains available');
  assert.equal(orderSplitLifecycleGuard({ status: 'cancelled' }).code, 'order_split_status_locked');
  assert.equal(orderSplitLifecycleGuard({ status: 'pay_at_cashier', startedAt: '2026-09-24T10:00:00Z' }).code,
    'order_split_kitchen_active', 'a started ticket remains locked even if its status projection is stale');
});

test('split retries are serialized, fingerprinted, replay-safe, and durably committed', () => {
  assert.match(splitRoute, /requireCapability\('orders\.split'\), serializeOrderMutationRoute\(async/);
  assert.match(splitRoute, /order_split_idempotency_required/);
  assert.match(splitRoute, /checkoutIdempotencyFingerprint\(/);
  const replayAt = splitRoute.indexOf('if (priorSplit)');
  const paymentGuardAt = splitRoute.indexOf("if (['paid', 'partial', 'pending', 'unknown']");
  const mutationAt = splitRoute.indexOf('order.items = remainingItems');
  assert.ok(replayAt >= 0 && paymentGuardAt > replayAt && mutationAt > paymentGuardAt,
    'a valid retry replays before checking mutated state or moving items again');
  assert.match(splitRoute, /idempotent: true, primaryOrder: operationalOrderResponse\(order, req\.user\), splitOrder: operationalOrderResponse\(replayOrder, req\.user\)/);
  assert.match(splitRoute, /await persistFinanceMutation\(snapshot\)/);
  assert.doesNotMatch(splitRoute, /await save\(\)/);
});

test('split discounts preserve the original payable total with exact integer allocation', () => {
  const allocation = allocateOrderSplitDiscount(20, 90, 10);
  assert.deepEqual(allocation, { selectedDiscount: 18, remainingDiscount: 2 });
  assert.equal((90 - allocation.selectedDiscount) + (10 - allocation.remainingDiscount), 80);
  assert.deepEqual(allocateOrderSplitDiscount(99, 1, 99), {
    selectedDiscount: 0, remainingDiscount: 99,
  });
  assert.equal(allocateOrderSplitDiscount(1.5, 10, 10), null);
  assert.equal(allocateOrderSplitDiscount(1, Number.MAX_SAFE_INTEGER, 1), null);
  assert.match(splitRoute, /order_split_dine_in_only/);
});

test('split receipts preserve the exact integer balance across partial payments and reject fractional rounding', () => {
  assert.deepEqual(resolveSettlementAmounts({
    total: 1000,
    amountPaid: 300,
    payments: [{ amount: 200 }, { amount: 100 }],
    paymentAmount: 400,
  }), {
    ok: true, orderTotal: 1000, alreadyPaid: 300, outstanding: 700,
    requestedAmount: 400, amountTendered: 400,
  });
  assert.equal(resolveSettlementAmounts({
    total: 1000, amountPaid: 300, payments: [{ amount: 300 }], paymentAmount: 700.5,
  }).error, 'payment_amount_invalid');
  assert.equal(resolveSettlementAmounts({
    total: 1000, payments: [], paymentAmount: '7.5e2',
  }).error, 'payment_amount_invalid');
});

test('settlement fails closed when the paid projection disagrees with persisted receipts', () => {
  assert.equal(resolveSettlementAmounts({
    total: 1000, amountPaid: 250, payments: [{ amount: 300 }], paymentAmount: 700,
  }).error, 'payment_history_inconsistent');
  assert.equal(resolveSettlementAmounts({
    total: 1000, amountPaid: 300, payments: [{ amount: 250 }], paymentAmount: 700,
  }).error, 'payment_history_inconsistent');
  assert.equal(resolveSettlementAmounts({
    total: 1000, amountPaid: 300, payments: [], paymentAmount: 700,
  }).ok, true, 'legacy projection-only orders remain readable when no receipt history exists');
});

test('settlement history rejects duplicate payment identities, retry keys, and normalized references', () => {
  const base = { total: 1000, amountPaid: 300, paymentAmount: 100 };
  assert.equal(resolveSettlementAmounts({
    ...base, payments: [{ id: 1, amount: 100 }, { id: '1', amount: 200 }],
  }).error, 'payment_history_duplicate_id');
  assert.equal(resolveSettlementAmounts({
    ...base, payments: [
      { amount: 100, idempotencyKey: 'settlement-key-01' },
      { amount: 200, idempotencyKey: 'settlement-key-01' },
    ],
  }).error, 'payment_history_duplicate_idempotency_key');
  assert.equal(resolveSettlementAmounts({
    ...base, payments: [{ amount: 100, reference: 'PAY-123' }, { amount: 200, reference: ' ｐａｙ-123 ' }],
  }).error, 'payment_history_duplicate_reference');
});

test('settlement history accepts net receipts after exact refunds and rejects malformed stored identities', () => {
  const refunded = resolveSettlementAmounts({
    total: 1_000,
    amountPaid: 350,
    payments: [
      { id: 1, amount: 500, refundedAmount: 200, idempotencyKey: 'settlement-retry-001', reference: 'POS-1' },
      { id: 2, amount: 250, refundedAmount: 200, idempotencyKey: 'settlement-retry-002', reference: 'POS-2' },
    ],
    paymentAmount: 650,
  });
  assert.equal(refunded.ok, true);
  assert.equal(refunded.alreadyPaid, 350);
  assert.equal(refunded.outstanding, 650);
  assert.equal(refunded.requestedAmount, 650);

  for (const payment of [
    { amount: 100, refundedAmount: 101 },
    { amount: 100, refundedAmount: -1 },
    { amount: 100, id: 0 },
    { amount: 100, id: 'bad\u200Bidentity' },
    { amount: 100, idempotencyKey: 'short' },
    { amount: 100, idempotencyKey: 'bad\nkey-000' },
  ]) {
    assert.equal(resolveSettlementAmounts({ total: 1_000, payments: [payment] }).error,
      'payment_history_invalid', JSON.stringify(payment));
  }
  assert.equal(resolveSettlementAmounts(null).error, 'settlement_input_invalid');
});

test('settlement rejects malformed or unsafe payment history instead of rounding or treating it as zero', () => {
  const invalidCases = [
    { total: 1000, amountPaid: true },
    { total: 1000, amountPaid: -1 },
    { total: 1000, amountPaid: Number.MAX_SAFE_INTEGER + 1 },
    { total: 1000, payments: { amount: 100 } },
    { total: 1000, payments: [{ amount: 0 }] },
    { total: 1000, payments: [{ amount: -1 }] },
    { total: 1000, payments: [{ amount: 1.25 }] },
    { total: 1000, payments: [{ amount: Number.MAX_SAFE_INTEGER + 1 }] },
  ];
  for (const input of invalidCases) {
    assert.equal(resolveSettlementAmounts(input).error, 'payment_history_invalid', JSON.stringify(input));
  }

  assert.equal(resolveSettlementAmounts({
    total: 1000, payments: [{ amount: 800 }, { amount: 201 }],
  }).error, 'payment_history_exceeds_order_total');
  assert.equal(resolveSettlementAmounts({
    total: 1000, amountPaid: 1001,
  }).error, 'payment_history_exceeds_order_total');
});

test('safe-integer maximum is handled without aggregate overflow', () => {
  const max = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(resolveSettlementAmounts({
    total: max,
    payments: [{ amount: max - 1 }, { amount: 1 }],
  }), {
    ok: true, orderTotal: max, alreadyPaid: max, outstanding: 0,
    requestedAmount: 0, amountTendered: 0,
  });
  assert.equal(resolveSettlementAmounts({
    total: max, payments: [{ amount: max }, { amount: 1 }],
  }).error, 'payment_history_exceeds_order_total');
  assert.equal(resolveSettlementAmounts({ total: max + 1 }).error, 'order_total_invalid');
});

test('cash tender is an exact integer amount and its change remains within safe-integer range', () => {
  const exact = resolveSettlementAmounts({
    total: 5000, tender: 'cash', paymentAmount: 1200, amountTendered: 2000,
  });
  assert.equal(exact.ok, true);
  assert.equal(exact.amountTendered - exact.requestedAmount, 800);

  const boundary = resolveSettlementAmounts({
    total: Number.MAX_SAFE_INTEGER,
    tender: 'cash',
    paymentAmount: 1,
    amountTendered: Number.MAX_SAFE_INTEGER,
  });
  assert.equal(boundary.ok, true);
  assert.equal(boundary.amountTendered - boundary.requestedAmount, Number.MAX_SAFE_INTEGER - 1);
  assert.equal(resolveSettlementAmounts({
    total: 5000, tender: 'cash', paymentAmount: 100, amountTendered: Number.MAX_SAFE_INTEGER + 1,
  }).error, 'cash_received_invalid');
  assert.equal(resolveSettlementAmounts({
    total: 5000, tender: 'cash', paymentAmount: 100, amountTendered: 99.9,
  }).error, 'cash_received_invalid');
  assert.match(source, /changeDue: tender === 'cash' \? Math\.max\(0, amountTendered - requestedAmount\) : 0/);
  const tenderGate = source.indexOf("if (!['cash', 'manual_card', 'wallet'].includes(tender))");
  const amountResolver = source.indexOf('resolveSettlementAmounts({', tenderGate);
  assert.ok(tenderGate >= 0 && amountResolver > tenderGate, 'unsupported tenders are rejected before amount settlement');
});

test('mixed tender receipts consume only the authoritative remaining order balance', () => {
  const first = resolveSettlementAmounts({
    total: 10_000, amountPaid: 0, payments: [], tender: 'cash', paymentAmount: 4_000, amountTendered: 5_000,
  });
  assert.equal(first.ok, true);
  assert.equal(first.outstanding, 10_000);
  assert.equal(first.requestedAmount, 4_000);

  const second = resolveSettlementAmounts({
    total: 10_000,
    amountPaid: 4_000,
    payments: [{ amount: 4_000, tender: 'cash' }],
    tender: 'manual_card',
    paymentAmount: 6_000,
  });
  assert.equal(second.ok, true);
  assert.equal(second.alreadyPaid, 4_000);
  assert.equal(second.outstanding, 6_000);
  assert.equal(second.requestedAmount, 6_000);
  assert.equal(resolveSettlementAmounts({
    total: 10_000,
    amountPaid: 4_000,
    payments: [{ amount: 4_000 }],
    tender: 'manual_card',
    paymentAmount: 6_001,
  }).error, 'payment_amount_exceeds_due');
});

test('production permits exact cash/card split settlement and rejects online or unsupported tender mixing', () => {
  const production = { environment: () => 'production' };
  const firstCash = resolveSettlementAmounts({
    total: 10_000, amountPaid: 0, payments: [], paymentAmount: 4_000, tender: 'cash',
  }, production);
  assert.equal(firstCash.ok, true);
  assert.equal(firstCash.requestedAmount, 4_000);
  assert.equal(firstCash.alreadyPaid + firstCash.requestedAmount, 4_000);

  const finalCard = resolveSettlementAmounts({
    total: 10_000,
    amountPaid: 4_000,
    payments: [{ id: 1, tender: 'cash', amount: firstCash.requestedAmount }],
    paymentAmount: 6_000,
    tender: 'manual_card',
  }, production);
  assert.equal(finalCard.ok, true);
  assert.equal(finalCard.outstanding, 6_000);
  assert.equal(finalCard.requestedAmount, 6_000);
  assert.equal(finalCard.alreadyPaid + finalCard.requestedAmount, 10_000);

  const refundedLeg = resolveSettlementAmounts({
    total: 10_000,
    amountPaid: 3_500,
    payments: [{ id: 1, tender: 'cash', amount: 4_000, refundedAmount: 500 }],
    paymentAmount: 6_500,
    tender: 'manual_card',
  }, production);
  assert.equal(refundedLeg.ok, true);
  assert.equal(refundedLeg.alreadyPaid, 3_500);
  assert.equal(refundedLeg.requestedAmount, 6_500);

  for (const tender of ['wallet', 'online', 'gateway']) {
    assert.equal(resolveSettlementAmounts({
      total: 10_000, amountPaid: 0, payments: [], paymentAmount: 4_000, tender,
    }, production).error, 'partial_settlement_not_approved', `${tender} cannot start a cashier split`);
  }
  for (const tender of ['online', 'gateway', 'wallet', undefined]) {
    const payment = { amount: 4_000, ...(tender ? { tender } : {}) };
    assert.equal(resolveSettlementAmounts({
      total: 10_000, amountPaid: 4_000, payments: [payment], paymentAmount: 6_000, tender: 'manual_card',
    }, production).error, 'partial_settlement_not_approved', `${tender || 'missing tender'} cannot mix with cashier card`);
  }
  assert.equal(resolveSettlementAmounts({
    total: 10_000, amountPaid: 4_000, payments: [], paymentAmount: 6_000, tender: 'cash',
  }, production).error, 'partial_settlement_not_approved', 'a positive projection without tender provenance fails closed');
  assert.equal(resolveSettlementAmounts({
    total: 10_000, amountPaid: 4_000, payments: [{ amount: 4_000, tender: 'cash' }], paymentAmount: 6_001, tender: 'manual_card',
  }, production).error, 'payment_amount_exceeds_due');
  assert.equal(resolveSettlementAmounts({
    total: 10_000, amountPaid: 0, payments: [], paymentAmount: 0, tender: 'cash',
  }, production).error, 'payment_amount_invalid');

  assert.equal(resolveSettlementAmounts({
    total: 10_000, amountPaid: 0, payments: [], paymentAmount: 10_000,
  }, production).ok, true, 'full settlement remains available');
  assert.equal(resolveSettlementAmounts({
    total: 10_000, amountPaid: 0, payments: [], paymentAmount: 4_000,
  }, { environment: () => 'test' }).ok, true, 'isolated tests can exercise partial-tender mechanics');
  assert.equal(resolveSettlementAmounts({
    total: 10_000, amountPaid: 0, payments: [], paymentAmount: 4_000,
  }, { environment: () => { throw new Error('environment unavailable'); } }).error,
  'settlement_environment_unavailable');

  const handlerStart = source.indexOf('const handleSettleOrder = async');
  const callStart = source.indexOf('const amounts = resolveSettlementAmounts({', handlerStart);
  const callEnd = source.indexOf('const { alreadyPaid, outstanding, requestedAmount, amountTendered } = amounts;', callStart);
  const errorGate = source.indexOf('if (!amounts.ok)', callStart);
  assert.ok(handlerStart >= 0 && callStart > handlerStart && callEnd > callStart);
  assert.ok(errorGate > callStart && errorGate < callEnd);
  assert.match(source.slice(callStart, callEnd), /tender,\s*\}\);/,
    'the production settlement route uses the helper’s production policy, not a caller override');
  assert.match(source.slice(errorGate, callEnd), /if \(!amounts\.ok\)[\s\S]*?error: amounts\.error/,
    'unsupported tender mixes and invalid amounts are returned before order/payment mutation');
});

test('mixed cash and manually recorded card legs conserve every safe integer unit exactly once', () => {
  const production = { environment: () => 'production' };
  const totals = [2, 3, 10_000, Number.MAX_SAFE_INTEGER];

  for (const total of totals) {
    const firstLegAmounts = [...new Set([1, Math.floor(total / 2), total - 1])];
    for (const cashAmount of firstLegAmounts) {
      const cash = resolveSettlementAmounts({
        total,
        amountPaid: 0,
        payments: [],
        tender: 'cash',
        paymentAmount: cashAmount,
        amountTendered: cashAmount + 1,
      }, production);
      assert.equal(cash.ok, true, `cash leg ${cashAmount} of ${total}`);
      assert.equal(cash.requestedAmount, cashAmount);
      assert.equal(cash.amountTendered - cash.requestedAmount, 1, 'cash overpay is change, not extra tender allocation');

      const cardAmount = total - cashAmount;
      const card = resolveSettlementAmounts({
        total,
        amountPaid: cash.requestedAmount,
        payments: [{ id: 'cash-leg', tender: 'cash', amount: cash.requestedAmount }],
        tender: 'manual_card',
        paymentAmount: cardAmount,
      }, production);
      assert.equal(card.ok, true, `manual card leg ${cardAmount} of ${total}`);
      assert.equal(cash.requestedAmount + card.requestedAmount, total);
      assert.equal(card.outstanding, cardAmount);
    }
  }
});

test('cash underpayment and card over-collection are rejected while duplicate retries cannot double-count', () => {
  const production = { environment: () => 'production' };
  assert.equal(resolveSettlementAmounts({
    total: 1_000, tender: 'cash', paymentAmount: 600, amountTendered: 599,
  }, production).error, 'cash_received_insufficient');

  assert.equal(resolveSettlementAmounts({
    total: 1_000,
    amountPaid: 400,
    payments: [{ id: 'cash-1', tender: 'cash', amount: 400 }],
    tender: 'manual_card',
    paymentAmount: 601,
  }, production).error, 'payment_amount_exceeds_due');

  assert.equal(resolveSettlementAmounts({
    total: 1_000,
    amountPaid: 800,
    payments: [
      { id: 'cash-1', tender: 'cash', amount: 400, idempotencyKey: 'cash-attempt-0001' },
      { id: 'cash-2', tender: 'cash', amount: 400, idempotencyKey: 'cash-attempt-0001' },
    ],
    tender: 'manual_card',
    paymentAmount: 200,
  }, production).error, 'payment_history_duplicate_idempotency_key');
});

test('unknown payment outcome blocks another collection and card tender remains explicitly manual', () => {
  const handlerStart = source.indexOf('const handleSettleOrder = async');
  const handlerEnd = source.indexOf("app.post('/api/cashier/orders/:id/settle'", handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);
  const unknownGuard = handler.indexOf("if (order.paymentStatus === 'unknown')");
  const tenderAllowlist = handler.indexOf("if (!['cash', 'manual_card', 'wallet'].includes(tender))");
  const amountMutation = handler.indexOf('order.partialPayments.push(payment)');
  assert.ok(unknownGuard >= 0 && tenderAllowlist > unknownGuard && amountMutation > tenderAllowlist);
  assert.match(handler.slice(unknownGuard, tenderAllowlist), /payment_status_reconciliation_required/);
  assert.match(handler, /tender, amount: requestedAmount/);
  assert.doesNotMatch(handler, /tender === 'card'|tender === 'gateway'|tender === 'online'/);
});

test('settlement references accept bounded identifiers but reject object coercion and invisible controls', () => {
  assert.equal(normalizeSettlementReference('  ۱۲۳۴۵۶  '), '۱۲۳۴۵۶');
  assert.equal(normalizeSettlementReference(123456), '123456');
  assert.equal(normalizeSettlementReference('   '), null);
  for (const value of [true, {}, Number.MAX_SAFE_INTEGER + 1, `x${'a'.repeat(120)}`, 'ref\u202Ehidden']) {
    assert.throws(() => normalizeSettlementReference(value), { code: 'settlement_reference_invalid' });
  }
  assert.throws(() => normalizeRefundReference('PAY-IN-123', 'ＰＡＹ-ＩＮ-１２３'), {
    code: 'refund_reference_is_payment_reference',
  });
});

test('payment attempt references are stable across retries and required on verified success', () => {
  assert.equal(settlementReferenceIdentity(' PAY-123 '), settlementReferenceIdentity('ｐａｙ-123'));
  assert.deepEqual(resolvePaymentAttemptReference('PAY-123', ' pay-123 '), {
    reference: 'PAY-123', reusedExistingReference: true,
  });
  assert.deepEqual(resolvePaymentAttemptReference(null, 'PAY-123', { required: true }), {
    reference: 'PAY-123', reusedExistingReference: false,
  });
  assert.throws(() => resolvePaymentAttemptReference('PAY-123', 'PAY-456'), {
    code: 'payment_reference_conflict', status: 409,
  });
  assert.throws(() => resolvePaymentAttemptReference(null, null, { required: true }), {
    code: 'payment_attempt_reference_required', status: 409,
  });
});

test('refund matching requires exact safe-integer amount and branch evidence without coercion', () => {
  const refund = {
    id: 'refund-1', orderId: 'order-1', paymentId: 'payment-1', branchId: '04',
    amountIrr: '2000', paymentReference: 'PAY-IN-1',
  };
  const evidence = {
    id: 'evidence-1', kind: 'provider_refund', direction: 'outgoing',
    sourceRecordId: 'provider-refund-record-1', sourcePaymentId: 'payment-1',
    branchId: 4, amountIrr: 2000, refundReference: 'PAY-OUT-1',
    status: 'unmatched', verifiedAt: '2026-09-22T10:00:00.000Z',
  };
  const base = {
    refund, evidenceId: evidence.id, loadEvidence: () => evidence,
    actor: 'finance-operator', matchedAt: '2026-09-22T11:00:00.000Z',
  };

  const matched = buildRefundReconciliationMatch(base);
  assert.equal(matched.branchId, 4);
  assert.equal(matched.amountIrr, 2000);

  assert.throws(() => buildRefundReconciliationMatch({
    ...base, refund: { ...refund, branchId: true },
  }), { code: 'refund_match_identity_missing' });
  assert.throws(() => buildRefundReconciliationMatch({
    ...base, refund: { ...refund, amountIrr: '2e3' },
  }), { code: 'refund_match_amount_invalid' });
  assert.throws(() => buildRefundReconciliationMatch({
    ...base, loadEvidence: () => ({ ...evidence, branchId: true }),
  }), { code: 'refund_match_evidence_mismatch' });
  assert.throws(() => buildRefundReconciliationMatch({
    ...base, loadEvidence: () => ({ ...evidence, amountIrr: '2e3' }),
  }), { code: 'refund_match_evidence_mismatch' });
});

test('refund idempotency intent canonicalizes human reason text and forbids rotated-key duplicates', () => {
  const intent = {
    orderId: ' order-1 ', branchId: '04', paymentId: 'payment-1', amountIrr: '2000',
    reason: '  درخواست   مشتری  ',
  };
  const canonical = refundRequestIdentity(intent);
  assert.equal(canonical.orderId, 'order-1');
  assert.equal(canonical.branchId, 4);
  assert.equal(canonical.reason, 'درخواست مشتری');

  const request = { ...intent, idempotencyKey: 'refund-intent-key-1' };
  const first = resolveRefundRequestRetry([], request);
  const saved = { id: 'refund-1', ...request, requestFingerprint: first.requestFingerprint, status: 'processing' };
  assert.equal(resolveRefundRequestRetry([saved], {
    ...request, reason: 'درخواست مشتری',
  }).idempotentReplay, true);
  assert.throws(() => resolveRefundRequestRetry([saved], {
    ...request, reason: 'علت متفاوت',
  }), { code: 'refund_idempotency_conflict', status: 409 });
  assert.throws(() => resolveRefundRequestRetry([saved], {
    ...request, idempotencyKey: 'refund-intent-key-2',
  }), { code: 'refund_idempotency_key_rotated', status: 409 });
  assert.throws(() => refundRequestIdentity({ ...intent, amountIrr: true }), {
    code: 'refund_amount_identity_invalid', status: 400,
  });
  assert.throws(() => refundRequestIdentity({ ...intent, orderId: {} }), {
    code: 'refund_order_identity_required', status: 400,
  });
});
