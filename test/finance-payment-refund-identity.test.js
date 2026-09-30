'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const financeV2 = require('../server/finance-v2');
const {
  normalizeIdempotencyKey,
  normalizeRefundReference,
  resolveRefundRequestRetry,
  buildRefundReconciliationMatch,
} = require('../server/settlement-reference');

function orderFixture(overrides = {}) {
  return {
    id: 'order-identity-1',
    branchId: 4,
    total: 1000,
    paymentStatus: 'paid',
    paidAt: '2026-09-20T10:00:00.000Z',
    ...overrides,
  };
}

function tenderFixture(overrides = {}) {
  return {
    tender: 'online',
    amountIrr: 10000,
    paymentId: 'attempt-identity-1',
    occurredAt: '2026-09-20T10:00:00.000Z',
    provider: 'gateway-a',
    providerReference: 'ref-identity-1',
    ...overrides,
  };
}

test('order payment projection replay is idempotent only for the same canonical identity', () => {
  const db = {};
  const order = orderFixture();
  const [first] = financeV2.__test.materializeOrderPayments(db, order, [tenderFixture()]);
  const [replay] = financeV2.__test.materializeOrderPayments(db, order, [tenderFixture()]);

  assert.equal(replay.id, first.id);
  assert.equal(db.financeV2.payments.length, 1);
  assert.throws(() => financeV2.__test.materializeOrderPayments(db, order, [tenderFixture({ amountIrr: 9000 })]), {
    code: 'order_payment_identity_conflict', status: 409,
  });
  assert.equal(db.financeV2.payments[0].amountIrr, 10000);
});

test('later processor metadata fills missing fields without duplicating the payment projection', () => {
  const db = {};
  const order = orderFixture();
  const [first] = financeV2.__test.materializeOrderPayments(db, order, [tenderFixture({ provider: null, providerReference: null })]);
  const [replay] = financeV2.__test.materializeOrderPayments(db, order, [tenderFixture()]);

  assert.equal(replay.id, first.id);
  assert.equal(replay.provider, 'gateway-a');
  assert.equal(replay.providerReference, 'ref-identity-1');
  assert.equal(db.financeV2.payments.length, 1);
  assert.equal(db.financeV2.reconciliationItems.length, 1);
  assert.equal(db.financeV2.reconciliationItems[0].psp, 'gateway-a');
  assert.equal(db.financeV2.reconciliationItems[0].bankReference, 'ref-identity-1');
});

test('payment identity cannot be reused across branches or duplicated within a tender snapshot', () => {
  const db = {};
  financeV2.__test.materializeOrderPayments(db, orderFixture(), [tenderFixture()]);

  assert.throws(() => financeV2.__test.materializeOrderPayments(db, orderFixture({ branchId: 5 }), [tenderFixture()]), {
    code: 'order_payment_source_identity_conflict', status: 409,
  });
  assert.throws(() => financeV2.__test.materializeOrderPayments(db, orderFixture({ id: 'other-order' }), [tenderFixture()]), {
    code: 'order_payment_source_identity_conflict', status: 409,
  });
  assert.throws(() => financeV2.__test.materializeOrderPayments(db, orderFixture(), [tenderFixture(), tenderFixture()]), {
    code: 'order_payment_identity_duplicate', status: 409,
  });
  assert.equal(db.financeV2.payments.length, 1);
});

test('cashier leg identifiers are scoped to their order while provider identifiers remain globally protected', () => {
  const db = {};
  const cashLeg = {
    tender: 'cash', amountIrr: 5_000, paymentId: '1', occurredAt: '2026-09-20T10:00:00.000Z',
  };
  financeV2.__test.materializeOrderPayments(db, orderFixture({ id: 'cash-order-a' }), [cashLeg]);
  financeV2.__test.materializeOrderPayments(db, orderFixture({ id: 'cash-order-b' }), [cashLeg]);
  assert.equal(db.financeV2.payments.length, 2,
    'per-order cash sequence values must not collide with another invoice');

  const providerLeg = tenderFixture({ paymentId: 'provider-global-1' });
  financeV2.__test.materializeOrderPayments(db, orderFixture({ id: 'online-order-a' }), [providerLeg]);
  assert.throws(() => financeV2.__test.materializeOrderPayments(
    db, orderFixture({ id: 'online-order-b' }), [providerLeg],
  ), { code: 'order_payment_source_identity_conflict', status: 409 });
  assert.equal(db.financeV2.payments.length, 3,
    'the same external provider attempt cannot settle two different orders');
});

test('posted sale payment repair refuses a matching amount with a different operational payment identity', () => {
  const order = orderFixture();
  const event = {
    id: 'posted-sale-payment-repair-1', source: 'order.paid', sourceId: order.id,
    sourceVersion: 1, branchId: order.branchId, occurredAt: order.paidAt,
    amountIrr: 10000, status: 'posted', journalEntryId: 'sale-journal-1',
    payload: { tenderSnapshot: [{
      tender: 'online', amountIrr: 10000, paymentId: 'operational-payment-current',
      provider: 'gateway-a', providerReference: 'ref-identity-1',
    }] },
  };
  const db = {
    orders: [order],
    financeV2: {
      events: [event], journalEntries: [{ id: 'sale-journal-1', status: 'posted', branchId: order.branchId }],
      payments: [{
        id: 'finance-payment-old-identity', orderId: order.id, branchId: order.branchId,
        tender: 'online', amountIrr: 10000, status: 'succeeded', provider: 'gateway-a',
        providerReference: 'ref-identity-1',
        idempotencyKey: `order:${order.id}:payment:operational-payment-previous`,
        payload: { operationalPaymentId: 'operational-payment-previous' },
      }],
      reconciliationItems: [],
    },
  };

  const replay = financeV2.resolveEvent(db, event.id, {}, 'finance-repair-test');

  assert.equal(replay.idempotentReplay, true);
  assert.deepEqual(replay.payments, []);
  assert.equal(db.financeV2.payments.length, 1);
  assert.equal(db.financeV2.payments[0].payload.operationalPaymentId, 'operational-payment-previous');
});

test('online partial-capture retry rejects a changed amount without mutating the accepted tender', () => {
  const db = {
    financeV2: {
      rollout: { captureEnabled: true, enabledBranchIds: [] },
      fiscalPeriods: [{ id: 'open-4', branchId: 4, startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' }],
    },
  };
  const order = orderFixture({ paymentMethod: 'online', paymentStatus: 'partial', partialPayments: [], paidAt: null });
  const payment = {
    id: 'online-attempt-1', orderId: order.id, branchId: order.branchId,
    status: 'paid', tender: 'online', amount: 300, provider: 'gateway-a', reference: 'provider-ref-1',
  };

  const first = financeV2.captureOnlinePaidOrder(db, order, payment);
  const replay = financeV2.captureOnlinePaidOrder(db, order, payment);
  const sparseRetry = { ...payment };
  delete sparseRetry.reference;
  const sparseReplay = financeV2.captureOnlinePaidOrder(db, order, sparseRetry);
  assert.equal(first.reason, 'order_not_paid');
  assert.equal(replay.reason, 'order_not_paid');
  assert.equal(sparseReplay.reason, 'order_not_paid');
  assert.equal(order.amountPaid, 300);
  assert.equal(order.partialPayments.length, 1);
  assert.equal(order.partialPayments[0].reference, 'provider-ref-1');

  assert.throws(() => financeV2.captureOnlinePaidOrder(db, order, { ...payment, amount: 350 }), {
    code: 'online_payment_identity_conflict', status: 409,
  });
  assert.equal(order.amountPaid, 300, 'failed replay must roll back the operational order mutation');
  assert.equal(order.partialPayments[0].amount, 300);
  assert.equal(db.financeV2.payments.length, 1, 'the accepted capture has one Finance V2 receipt');
  assert.equal(db.financeV2.events.filter((event) => event.source === 'order.payment_received').length, 1);
  assert.equal(db.financeV2.journalEntries.filter((entry) => entry.source === 'order.payment_received').length, 1);
  assert.equal(db.financeV2.journalEntries.some((entry) => entry.source === 'order.paid'), false);
});

function refundFixture() {
  return {
    orders: [orderFixture({ paymentStatus: 'paid', partialPayments: [{ id: 'cash-part', amount: 500 }] })],
    financeV2: {
      journalEntries: [{
        id: 'order-sale-journal-1', orderId: 'order-identity-1', source: 'order.paid',
        sourceId: 'order-identity-1', branchId: 4, status: 'posted', lines: [{ accountCode: '4110' }],
      }],
      payments: [{
        id: 'finance-payment-1', orderId: 'order-identity-1', branchId: 4,
        tender: 'online', amountIrr: 5000, status: 'succeeded', provider: 'gateway-a',
        providerReference: 'ref-identity-1', idempotencyKey: 'order:order-identity-1:payment:attempt-identity-1',
      }],
      refunds: [], approvals: [],
    },
  };
}

test('refund request idempotency includes reason and effective branch, while omitted retry date remains stable', () => {
  const db = refundFixture();
  const input = { branchId: 4, paymentId: 'finance-payment-1', amountIrr: 2000, reason: 'customer request' };
  const first = financeV2.requestOrderRefund(db, 'order-identity-1', input, 'cashier-a', 'refund-key-1');
  const replay = financeV2.requestOrderRefund(db, 'order-identity-1', input, 'cashier-a', 'refund-key-1');
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.refund.id, first.refund.id);

  assert.throws(() => financeV2.requestOrderRefund(db, 'order-identity-1', {
    ...input, reason: 'different reason',
  }, 'cashier-a', 'refund-key-1'), {
    code: 'refund_idempotency_conflict', status: 409,
  });

  first.refund.branchId = 5;
  assert.throws(() => financeV2.requestOrderRefund(db, 'order-identity-1', input, 'cashier-a', 'refund-key-1'), {
    code: 'refund_idempotency_conflict', status: 409,
  });
});

test('operational partial payment without Finance V2 payment evidence remains non-refundable', () => {
  const db = refundFixture();
  db.financeV2.payments = [];
  assert.throws(() => financeV2.requestOrderRefund(db, 'order-identity-1', {
    branchId: 4, amountIrr: 1000, reason: 'partial refund',
  }, 'cashier-a', 'partial-refund-key'), {
    code: 'finance_payment_missing', status: 409,
  });
  assert.equal(db.financeV2.refunds.length, 0);
});

test('refund request rejects a Finance V2 payment whose branch differs from its order', () => {
  const db = refundFixture();
  db.financeV2.payments[0].branchId = 5;
  assert.throws(() => financeV2.requestOrderRefund(db, 'order-identity-1', {
    branchId: 4, paymentId: 'finance-payment-1', amountIrr: 1000, reason: 'branch check',
  }, 'cashier-a', 'wrong-branch-refund'), {
    code: 'refund_payment_branch_mismatch', status: 409,
  });
  assert.equal(db.financeV2.refunds.length, 0);
});

test('refund request fails closed when an explicit branch id is malformed', () => {
  for (const branchId of [0, -1, '', ' ', false, [], {}, 'abc', '4.5', Number.MAX_SAFE_INTEGER + 1]) {
    const db = refundFixture();
    assert.throws(() => financeV2.requestOrderRefund(db, 'order-identity-1', {
      branchId, paymentId: 'finance-payment-1', amountIrr: 1000, reason: 'invalid branch',
    }, 'cashier-a', `invalid-branch-refund-${String(branchId)}`), {
      code: 'finance_branch_id_invalid', status: 400,
    });
    assert.equal(db.financeV2.refunds.length, 0, `invalid branch ${String(branchId)} must not create a refund`);
  }
});

test('refund retry keys are opaque stable values; whitespace, short and malformed keys fail closed', () => {
  assert.equal(normalizeIdempotencyKey('refund-key-1'), 'refund-key-1');
  for (const key of ['', 'short', ' refund-key-1', 'refund-key-1 ', 'refund/key-1', 'refund\nkey-1', 'x'.repeat(161)]) {
    assert.throws(() => normalizeIdempotencyKey(key), { code: 'refund_idempotency_key_invalid', status: 400 });
  }
});

test('refund retry replays only the same immutable identity and detects key rotation', () => {
  const request = {
    idempotencyKey: 'refund-key-1', orderId: 'order-identity-1', branchId: 4,
    paymentId: 'finance-payment-1', amountIrr: 2000, reason: 'customer request',
  };
  const first = resolveRefundRequestRetry([], request);
  assert.equal(first.idempotentReplay, false);
  const stored = {
    id: 'refund-1', ...request, status: 'pending_approval',
    requestFingerprint: first.requestFingerprint,
  };
  assert.deepEqual(resolveRefundRequestRetry([stored], request), {
    idempotencyKey: request.idempotencyKey,
    requestFingerprint: first.requestFingerprint,
    refund: stored,
    idempotentReplay: true,
  });
  assert.throws(() => resolveRefundRequestRetry([stored], { ...request, amountIrr: 2100 }), {
    code: 'refund_idempotency_conflict', status: 409,
  });
  assert.throws(() => resolveRefundRequestRetry([stored], { ...request, idempotencyKey: 'refund-key-2' }), {
    code: 'refund_idempotency_key_rotated', status: 409,
  });
});

test('a refund reference must identify outgoing funds, not repeat or disguise the incoming payment reference', () => {
  assert.equal(normalizeRefundReference(' bank-out-123 ', 'PAY-IN-123'), 'bank-out-123');
  for (const value of [null, '', '   ', 'PAY-IN-123', ' pay-in-123 ', 'x'.repeat(121), 'out\u0000going']) {
    assert.throws(() => normalizeRefundReference(value, 'PAY-IN-123'), (error) =>
      ['refund_outgoing_reference_required', 'refund_reference_is_payment_reference', 'settlement_reference_invalid'].includes(error.code));
  }
});

function refundMatchFixture(overrides = {}) {
  return {
    id: 'refund-match-1', paymentId: 'finance-payment-1', branchId: 4,
    amountIrr: 2000, paymentReference: 'incoming-reference-1',
    ...overrides,
  };
}

function verifiedBankEvidence(overrides = {}) {
  return {
    id: 'bank-line-out-1', kind: 'bank_statement_line', direction: 'outgoing',
    sourceRecordId: 'statement-import-9/line-4', sourcePaymentId: 'finance-payment-1',
    branchId: 4, amountIrr: 2000, bankReference: 'bank-out-reference-1',
    status: 'unmatched', verifiedAt: '2026-09-22T10:00:00.000Z',
    ...overrides,
  };
}

test('refund reconciliation cannot be marked matched without persisted verified outgoing evidence and audit identity', () => {
  const refund = refundMatchFixture();
  const evidence = verifiedBankEvidence();
  const loadEvidence = (id) => id === evidence.id ? evidence : null;
  const base = { refund, evidenceId: evidence.id, loadEvidence, actor: 'finance-a', matchedAt: '2026-09-22T11:00:00.000Z' };

  assert.throws(() => buildRefundReconciliationMatch({ refund, actor: 'finance-a', matchedAt: base.matchedAt }), {
    code: 'refund_match_evidence_required', status: 409,
  });
  assert.throws(() => buildRefundReconciliationMatch({ ...base, loadEvidence: () => null }), {
    code: 'refund_match_evidence_unverified', status: 409,
  });
  assert.throws(() => buildRefundReconciliationMatch({ ...base, actor: '', matchedAt: base.matchedAt }), {
    code: 'refund_match_audit_required', status: 400,
  });

  const match = buildRefundReconciliationMatch(base);
  assert.equal(match.status, 'matched');
  assert.equal(match.outgoingReference, evidence.bankReference);
  assert.equal(match.sourceRecordId, evidence.sourceRecordId);
  assert.equal(match.matchedBy, 'finance-a');
});

test('refund reconciliation rejects unverified, incoming, mismatched, reused and payment-reference evidence', () => {
  const refund = refundMatchFixture();
  const baseEvidence = verifiedBankEvidence();
  const base = { refund, evidenceId: baseEvidence.id, actor: 'finance-a', matchedAt: '2026-09-22T11:00:00.000Z' };
  const assertEvidenceRejected = (evidence, code) => assert.throws(() => buildRefundReconciliationMatch({
    ...base, loadEvidence: () => evidence,
  }), { code, status: 409 });

  assertEvidenceRejected(verifiedBankEvidence({ verifiedAt: null }), 'refund_match_evidence_unverified');
  assertEvidenceRejected(verifiedBankEvidence({ direction: 'incoming' }), 'refund_match_evidence_not_outgoing');
  assertEvidenceRejected(verifiedBankEvidence({ sourcePaymentId: 'another-payment' }), 'refund_match_evidence_mismatch');
  assertEvidenceRejected(verifiedBankEvidence({ amountIrr: 1999 }), 'refund_match_evidence_mismatch');
  assertEvidenceRejected(verifiedBankEvidence({ bankReference: 'INCOMING-REFERENCE-1' }), 'refund_reference_is_payment_reference');
  assertEvidenceRejected(verifiedBankEvidence({ status: 'matched', refundId: 'other-refund' }), 'refund_match_evidence_already_used');

  assert.throws(() => buildRefundReconciliationMatch({
    ...base, loadEvidence: () => baseEvidence,
    existingMatches: [{ evidenceId: baseEvidence.id, refundId: 'other-refund', outgoingReference: baseEvidence.bankReference, status: 'matched' }],
  }), { code: 'refund_match_evidence_already_used', status: 409 });

  assert.throws(() => buildRefundReconciliationMatch({
    ...base, evidenceId: 'replacement-line', loadEvidence: () => verifiedBankEvidence({
      id: 'replacement-line', bankReference: 'replacement-out-reference',
    }),
    existingMatches: [{ evidenceId: baseEvidence.id, refundId: refund.id, outgoingReference: baseEvidence.bankReference, status: 'matched' }],
  }), { code: 'refund_match_identity_conflict', status: 409 });

  const replayEvidence = verifiedBankEvidence({ status: 'matched', refundId: refund.id, matchedAt: base.matchedAt });
  const replay = buildRefundReconciliationMatch({
    ...base, loadEvidence: () => replayEvidence,
    existingMatches: [{ evidenceId: replayEvidence.id, refundId: refund.id, outgoingReference: replayEvidence.bankReference, status: 'matched' }],
  });
  assert.equal(replay.evidenceId, replayEvidence.id);
  assert.equal(replay.outgoingReference, replayEvidence.bankReference);
  assert.equal(replay.matchedAt, replayEvidence.matchedAt);
});
