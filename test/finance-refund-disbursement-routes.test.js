'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const financeV2 = require('../server/finance-v2');
const { verifyAuditLogChain } = require('../server/finance/audit-engine');

const REFUND_REQUEST_PATH = '/api/admin/v2/finance/orders/:orderId/refund-requests';
const APPROVAL_PATH = '/api/admin/v2/finance/approvals/:id/decision';
const DISBURSEMENT_PATH = '/api/admin/v2/finance/reconciliation/refunds/:id/match';

function fixture() {
  return {
    branches: [{ id: 4, active: true }],
    orders: [{
      id: 'refund-route-order', branchId: 4, total: 1000, paymentStatus: 'paid',
      paidAt: '2026-09-20T10:00:00.000Z', paymentMethod: 'online',
    }],
    financeV2: {
      journalEntries: [{
        id: 'refund-route-sale-journal', orderId: 'refund-route-order',
        source: 'order.paid', sourceId: 'refund-route-order', branchId: 4,
        status: 'posted', lines: [{ accountCode: '4110' }],
      }],
      payments: [{
        id: 'refund-route-payment', orderId: 'refund-route-order', branchId: 4,
        tender: 'online', amountIrr: 10000, status: 'succeeded', provider: 'unspecified-test-processor',
        providerReference: 'INCOMING-PAYMENT-REF-42', refundedIrr: 0,
      }],
      refunds: [], approvals: [],
      fiscalPeriods: [{
        id: 'refund-route-open-period', branchId: 4, name: 'Test open period',
        startDate: '2026-01-01', endDate: '2026-12-31', status: 'open',
      }],
    },
  };
}

function createHarness(db = fixture(), save = async () => undefined) {
  const routes = new Map();
  const capabilities = new Map();
  const app = {};
  for (const method of ['get', 'post', 'patch', 'put', 'delete']) {
    app[method] = (path, ...handlers) => {
      routes.set(`${method.toUpperCase()} ${path}`, handlers);
      capabilities.set(`${method.toUpperCase()} ${path}`, handlers[0]?.financeCapability ?? required.at(-1) ?? null);
    };
  }
  const required = [];
  financeV2.registerFinanceV2Routes({
    app,
    getDb: () => db,
    save,
    requireCapability: (capability) => {
      required.push(capability);
      return (_req, _res, next) => next();
    },
    effectiveRole: (user) => user.role,
    getStorageStatus: () => ({ available: true }),
  });

  async function call(path, { params = {}, body = {}, idempotencyKey, user = { role: 'owner', phone: 'finance-owner' } } = {}) {
    const handlers = routes.get(`POST ${path}`);
    assert.ok(handlers, `registered route missing: POST ${path}`);
    const req = {
      method: 'POST', route: { path }, path, originalUrl: path,
      params, body, query: {}, user,
      get(name) { return name.toLowerCase() === 'idempotency-key' ? idempotencyKey || '' : ''; },
    };
    const res = {
      statusCode: 200, headersSent: false, body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; this.headersSent = true; return this; },
    };
    let cursor = 0;
    const next = () => {
      const handler = handlers[cursor++];
      return handler ? handler(req, res, next) : undefined;
    };
    await next();
    return res;
  }
  return { db, call, required, capabilities };
}

async function createApprovedRefund(harness, amountIrr = 2000) {
  const requestInput = {
    params: { orderId: 'refund-route-order' },
    body: {
      branchId: 4, paymentId: 'refund-route-payment', amountIrr,
      reason: 'customer refund request', refundDate: '2026-09-20T10:00:00.000Z',
    },
    idempotencyKey: 'refund-request-idem-0001',
    user: { role: 'cashier', phone: 'refund-requester', allowedBranchIds: [4] },
  };
  const request = await harness.call(REFUND_REQUEST_PATH, requestInput);
  assert.equal(request.statusCode, 201, JSON.stringify(request.body?.error));
  const refund = request.body.data.refund;

  const approval = await harness.call(APPROVAL_PATH, {
    params: { id: refund.approvalId },
    body: { decision: 'approved', comment: 'independent approval' },
    idempotencyKey: 'refund-approval-idem-0001',
    user: { role: 'owner', phone: 'independent-approver' },
  });
  assert.equal(approval.statusCode, 200, JSON.stringify(approval.body?.error));
  return { refundId: refund.id, approvalId: refund.approvalId, approvalResponse: approval, requestInput };
}

function outgoingEvidence(overrides = {}) {
  return {
    id: 'verified-outgoing-bank-row-42', kind: 'bank_statement_line', direction: 'outgoing',
    sourceRecordId: 'trusted-bank-import-7/line-12', sourcePaymentId: 'refund-route-payment',
    branchId: 4, amountIrr: 2000, bankReference: 'OUTGOING-BANK-REF-99', status: 'unmatched',
    verifiedAt: '2026-09-20T11:00:00.000Z', ...overrides,
  };
}

function insertEvidence(db, evidence) {
  db.financeV2.reconciliationItems.push(evidence);
  return evidence;
}

test('refund request and independent approval do not imply a sent, succeeded, or reconciled refund', async () => {
  const harness = createHarness();
  assert.deepEqual(
    harness.capabilities.get(`POST ${REFUND_REQUEST_PATH}`),
    ['payments.refund.request', 'finance.events.manage'],
    'refund request must accept the requester capability without granting approval or disbursement authority',
  );
  const { refundId, approvalResponse, requestInput } = await createApprovedRefund(harness);
  const state = harness.db.financeV2;
  const refund = state.refunds.find((row) => row.id === refundId);

  const requestReplay = await harness.call(REFUND_REQUEST_PATH, requestInput);
  assert.equal(requestReplay.statusCode, 200);
  assert.equal(requestReplay.body.data.idempotentReplay, true);
  assert.equal(requestReplay.body.data.refund.id, refundId);
  assert.equal(requestReplay.body.data.approval.id, refund.approvalId);

  assert.equal(approvalResponse.body.data.financeRefund.status, 'approved');
  assert.equal(approvalResponse.body.data.refundEntry, null);
  assert.equal(refund.status, 'approved');
  assert.equal(refund.journalEntryId, null);
  assert.equal(state.journalEntries.length, 1, 'existing sale entry is retained; no refund entry is posted without evidence');
  assert.equal(state.reconciliationItems.some((row) => row.kind === 'refund'), false);
  assert.equal(state.payments[0].refundedIrr, 0);
  assert.throws(() => financeV2.postApprovedRefund(harness.db, refund, 'independent-approver'), {
    code: 'refund_match_evidence_required', status: 409,
  });
  assert.equal(refund.status, 'approved');
  assert.equal(state.journalEntries.length, 1, 'existing sale entry is retained; no refund entry is posted without evidence');
});

test('incoming payment references and unverified evidence cannot complete a refund disbursement', async () => {
  const harness = createHarness();
  const { refundId } = await createApprovedRefund(harness);
  const state = harness.db.financeV2;
  const missingEvidence = await harness.call(DISBURSEMENT_PATH, {
    params: { id: refundId }, body: {},
    idempotencyKey: 'refund-disbursement-no-evidence-0001',
  });
  assert.equal(missingEvidence.statusCode, 409);
  assert.equal(missingEvidence.body.error.code, 'refund_match_evidence_required');

  const incomingEvidence = insertEvidence(harness.db, outgoingEvidence({
    id: 'incoming-provider-reference-row', kind: 'provider_refund', direction: 'incoming',
    refundReference: 'INCOMING-PAYMENT-REF-42',
  }));

  const incomingResult = await harness.call(DISBURSEMENT_PATH, {
    params: { id: refundId }, body: { evidenceId: incomingEvidence.id },
    idempotencyKey: 'refund-disbursement-incoming-0001',
    user: { role: 'accountant', phone: 'refund-accountant', allowedBranchIds: [4] },
  });
  assert.equal(incomingResult.statusCode, 409);
  assert.equal(incomingResult.body.error.code, 'refund_match_evidence_not_outgoing');

  const copiedIncomingReference = insertEvidence(harness.db, outgoingEvidence({
    id: 'outgoing-claim-copying-incoming-reference', bankReference: 'INCOMING-PAYMENT-REF-42',
  }));
  const copiedReferenceResult = await harness.call(DISBURSEMENT_PATH, {
    params: { id: refundId }, body: { evidenceId: copiedIncomingReference.id },
    idempotencyKey: 'refund-disbursement-copied-ref-0001',
  });
  assert.equal(copiedReferenceResult.statusCode, 409);
  assert.equal(copiedReferenceResult.body.error.code, 'refund_reference_is_payment_reference');

  const unverified = insertEvidence(harness.db, outgoingEvidence({
    id: 'outgoing-row-without-verification', verifiedAt: null,
  }));
  const unverifiedResult = await harness.call(DISBURSEMENT_PATH, {
    params: { id: refundId }, body: { evidenceId: unverified.id },
    idempotencyKey: 'refund-disbursement-unverified-0001',
  });
  assert.equal(unverifiedResult.statusCode, 409);
  assert.equal(unverifiedResult.body.error.code, 'refund_match_evidence_unverified');

  const refund = state.refunds.find((row) => row.id === refundId);
  assert.equal(refund.status, 'approved');
  assert.equal(refund.journalEntryId, null);
  assert.equal(state.journalEntries.length, 1, 'invalid incoming evidence must not add a refund entry');
  assert.equal(state.reconciliationItems.some((row) => row.kind === 'refund'), false);
  assert.equal(state.payments[0].refundedIrr, 0);
});

test('verified outgoing evidence finalizes once and retries preserve exact route identity', async () => {
  const harness = createHarness();
  const { refundId } = await createApprovedRefund(harness);
  const evidence = insertEvidence(harness.db, {
    id: 'verified-outgoing-bank-row-42', kind: 'bank_statement_line', branchId: 4,
    amountIrr: 2000, bankReference: 'OUTGOING-BANK-REF-99', status: 'unmatched',
    details: {
      direction: 'outflow', sourceRecordId: 'trusted-bank-import-7/line-12',
      sourcePaymentId: 'refund-route-payment', verifiedAt: '2026-09-20T11:00:00.000Z',
    },
  });
  const input = {
    params: { id: refundId }, body: { evidenceId: evidence.id },
    idempotencyKey: 'refund-disbursement-idem-0001',
    user: { role: 'accountant', phone: 'refund-accountant', allowedBranchIds: [4] },
  };

  const first = await harness.call(DISBURSEMENT_PATH, input);
  assert.equal(first.statusCode, 201, JSON.stringify(first.body?.error));
  assert.equal(first.body.data.refund.status, 'succeeded');
  assert.equal(first.body.data.reconciliation.status, 'matched');
  assert.equal(first.body.data.reconciliation.evidenceId, evidence.id);
  assert.equal(first.body.data.reconciliation.outgoingReference, evidence.bankReference);
  assert.notEqual(first.body.data.reconciliation.outgoingReference, 'INCOMING-PAYMENT-REF-42');
  assert.equal(first.body.data.journalEntry.source, 'order.refund');
  assert.equal(harness.db.financeV2.payments[0].refundedIrr, 2000);
  assert.equal(evidence.refundId, refundId);
  assert.equal(evidence.status, 'matched');
  const audit = verifyAuditLogChain(harness.db.accounting);
  assert.equal(audit.valid, true);
  assert.equal(audit.isTamperEvident, true);
  assert.deepEqual(harness.db.accounting.auditLogs.map((row) => row.action), [
    'finance_refund_requested', 'finance_refund_approved', 'finance_refund_disbursed_reconciled',
  ]);
  assert.equal(harness.db.accounting.auditLogs[2].metadata.evidenceId, evidence.id);
  assert.equal(harness.db.accounting.auditLogs[2].metadata.journalEntryId, first.body.data.journalEntry.id);

  const replay = await harness.call(DISBURSEMENT_PATH, input);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.data.idempotentReplay, true);
  assert.equal(replay.body.data.reconciliation.id, first.body.data.reconciliation.id);
  assert.equal(harness.db.financeV2.journalEntries.length, 2);
  assert.equal(harness.db.financeV2.reconciliationItems.filter((row) => row.kind === 'refund').length, 1);

  const changedEvidence = insertEvidence(harness.db, outgoingEvidence({
    id: 'second-verified-outgoing-row', bankReference: 'OUTGOING-BANK-REF-100',
  }));
  const conflictingReplay = await harness.call(DISBURSEMENT_PATH, {
    ...input, body: { evidenceId: changedEvidence.id },
  });
  assert.equal(conflictingReplay.statusCode, 409);
  assert.equal(conflictingReplay.body.error.code, 'idempotency_key_payload_mismatch');
  assert.equal(harness.db.financeV2.journalEntries.length, 2);
  assert.equal(harness.db.financeV2.reconciliationItems.filter((row) => row.kind === 'refund').length, 1);
});

test('refund disbursement reconciliation enforces the refund branch scope', async () => {
  const harness = createHarness();
  const { refundId } = await createApprovedRefund(harness);
  const evidence = insertEvidence(harness.db, outgoingEvidence());
  const denied = await harness.call(DISBURSEMENT_PATH, {
    params: { id: refundId }, body: { evidenceId: evidence.id },
    idempotencyKey: 'refund-disbursement-wrong-branch-0001',
    user: { role: 'accountant', phone: 'other-branch-accountant', allowedBranchIds: [5] },
  });

  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.error.code, 'finance_branch_access_denied');
  assert.equal(harness.db.financeV2.refunds.find((row) => row.id === refundId).status, 'approved');
  assert.equal(harness.db.financeV2.journalEntries.length, 1);
  assert.equal(evidence.status, 'unmatched');
});

test('refund posting uses the order tax snapshot in IRR and rejects malformed legacy tax', async () => {
  const harness = createHarness();
  harness.db.orders[0].taxSnapshot = { totalTax: 1000, calculatedAt: '2026-09-20T09:00:00.000Z' };
  const { refundId } = await createApprovedRefund(harness);
  const evidence = insertEvidence(harness.db, outgoingEvidence());
  const result = await harness.call(DISBURSEMENT_PATH, {
    params: { id: refundId }, body: { evidenceId: evidence.id },
    idempotencyKey: 'refund-tax-snapshot-match-0001',
  });

  assert.equal(result.statusCode, 201, JSON.stringify(result.body?.error));
  const lines = result.body.data.journalEntry.lines;
  assert.equal(lines.find((line) => line.accountCode === '2210')?.debitIrr, 200);
  assert.equal(lines.find((line) => line.accountType === 'contra_revenue' || line.accountCode === '4110')?.debitIrr, 1800);
  assert.equal(lines.find((line) => line.accountCode === '1310')?.creditIrr, 2000);
  assert.equal(result.body.data.refund.taxRefundIrr, 200);
  assert.equal(result.body.data.refund.revenueRefundIrr, 1800);

  const invalid = createHarness();
  invalid.db.orders[0].taxAmount = 100.5;
  const invalidRequest = await createApprovedRefund(invalid);
  const invalidEvidence = insertEvidence(invalid.db, outgoingEvidence());
  const invalidResult = await invalid.call(DISBURSEMENT_PATH, {
    params: { id: invalidRequest.refundId }, body: { evidenceId: invalidEvidence.id },
    idempotencyKey: 'refund-tax-invalid-source-0001',
  });
  assert.equal(invalidResult.statusCode, 409);
  assert.equal(invalidResult.body.error.code, 'tax_total_invalid');
  assert.equal(invalid.db.financeV2.refunds.find((row) => row.id === invalidRequest.refundId).status, 'approved');
  assert.equal(invalid.db.financeV2.journalEntries.length, 1);
});

test('refund tax apportionment stays exact when the intermediate product exceeds safe Number precision', async () => {
  const orderTotalIrr = 9007199254740970;
  const refundAmountIrr = 5233182767004503;
  const taxAmountIrr = 1017813515785729;
  const expectedTaxRefundIrr = 591349652671508;
  const harness = createHarness();
  harness.db.orders[0].total = orderTotalIrr / 10;
  harness.db.orders[0].taxSnapshot = { totalTaxIrr: taxAmountIrr };
  harness.db.financeV2.payments[0].amountIrr = orderTotalIrr;
  const { refundId } = await createApprovedRefund(harness, refundAmountIrr);
  const evidence = insertEvidence(harness.db, outgoingEvidence({ amountIrr: refundAmountIrr }));

  const result = await harness.call(DISBURSEMENT_PATH, {
    params: { id: refundId }, body: { evidenceId: evidence.id },
    idempotencyKey: 'refund-large-exact-tax-match-0001',
  });

  assert.equal(result.statusCode, 201, JSON.stringify(result.body?.error));
  assert.equal(result.body.data.refund.taxRefundIrr, expectedTaxRefundIrr);
  assert.equal(result.body.data.refund.revenueRefundIrr, refundAmountIrr - expectedTaxRefundIrr);
  assert.equal(result.body.data.journalEntry.debitIrr, refundAmountIrr);
  assert.equal(result.body.data.journalEntry.creditIrr, refundAmountIrr);
});

test('failed durable persistence rolls back refund finalization and permits an exact retry', async () => {
  let saveCalls = 0;
  let failDisbursementSave = false;
  const harness = createHarness(fixture(), async () => {
    saveCalls += 1;
    if (failDisbursementSave && saveCalls === 3) {
      throw Object.assign(new Error('durable write failed'), { code: 'finance_persistence_failed', status: 503 });
    }
    return true;
  });
  const { refundId } = await createApprovedRefund(harness);
  const evidence = insertEvidence(harness.db, outgoingEvidence());
  const input = {
    params: { id: refundId }, body: { evidenceId: evidence.id },
    idempotencyKey: 'refund-durable-write-retry-0001',
    user: { role: 'accountant', phone: 'refund-accountant', allowedBranchIds: [4] },
  };
  failDisbursementSave = true;

  const failed = await harness.call(DISBURSEMENT_PATH, input);
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.body.error.code, 'finance_persistence_failed');
  assert.equal(harness.db.financeV2.refunds.find((row) => row.id === refundId).status, 'approved');
  assert.equal(harness.db.financeV2.payments[0].refundedIrr, 0);
  assert.equal(harness.db.financeV2.journalEntries.length, 1);
  assert.equal(harness.db.financeV2.reconciliationItems.some((row) => row.kind === 'refund'), false);
  assert.equal(harness.db.financeV2.reconciliationItems.find((row) => row.id === evidence.id).status, 'unmatched');
  assert.equal(harness.db.financeV2.idempotency[input.idempotencyKey], undefined);
  assert.equal(verifyAuditLogChain(harness.db.accounting).length, 2);

  failDisbursementSave = false;
  const retried = await harness.call(DISBURSEMENT_PATH, input);
  assert.equal(retried.statusCode, 201, JSON.stringify(retried.body?.error));
  assert.equal(retried.body.data.refund.status, 'succeeded');
  assert.equal(harness.db.financeV2.journalEntries.length, 2);
  assert.equal(harness.db.financeV2.reconciliationItems.filter((row) => row.kind === 'refund').length, 1);
  assert.equal(verifyAuditLogChain(harness.db.accounting).length, 3);
});

test('refund finalization revalidates the approved amount and current payment state', async () => {
  const harness = createHarness();
  const { refundId } = await createApprovedRefund(harness);
  const evidence = insertEvidence(harness.db, outgoingEvidence());
  const refund = harness.db.financeV2.refunds.find((row) => row.id === refundId);
  const approval = harness.db.financeV2.approvals.find((row) => row.id === refund.approvalId);
  approval.amountIrr += 1;
  const approvalMismatch = await harness.call(DISBURSEMENT_PATH, {
    params: { id: refundId }, body: { evidenceId: evidence.id },
    idempotencyKey: 'refund-approval-amount-check-0001',
  });
  assert.equal(approvalMismatch.statusCode, 409);
  assert.equal(approvalMismatch.body.error.code, 'refund_independent_approval_required');
  assert.equal(refund.status, 'approved');
  assert.equal(harness.db.financeV2.journalEntries.length, 1);

  harness.db.financeV2.approvals.find((row) => row.id === refund.approvalId).amountIrr = refund.amountIrr;
  harness.db.financeV2.payments[0].status = 'failed';
  const paymentMismatch = await harness.call(DISBURSEMENT_PATH, {
    params: { id: refundId }, body: { evidenceId: evidence.id },
    idempotencyKey: 'refund-payment-state-check-0001',
  });
  assert.equal(paymentMismatch.statusCode, 409);
  assert.equal(paymentMismatch.body.error.code, 'refund_payment_not_succeeded');
  assert.equal(refund.status, 'approved');
  assert.equal(harness.db.financeV2.journalEntries.length, 1);
  assert.equal(evidence.status, 'unmatched');

  const invalidTotal = createHarness();
  const invalidRequest = await createApprovedRefund(invalidTotal);
  const invalidEvidence = insertEvidence(invalidTotal.db, outgoingEvidence());
  invalidTotal.db.orders[0].total = 1000.5;
  const invalidTotalResult = await invalidTotal.call(DISBURSEMENT_PATH, {
    params: { id: invalidRequest.refundId }, body: { evidenceId: invalidEvidence.id },
    idempotencyKey: 'refund-order-total-check-0001',
  });
  assert.equal(invalidTotalResult.statusCode, 409);
  assert.equal(invalidTotalResult.body.error.code, 'refund_order_total_invalid');
  assert.equal(invalidTotal.db.financeV2.journalEntries.length, 1);
});

test('refund request and disbursement endpoints reject malformed idempotency keys', async () => {
  const harness = createHarness();
  const request = await harness.call(REFUND_REQUEST_PATH, {
    params: { orderId: 'refund-route-order' },
    body: { branchId: 4, paymentId: 'refund-route-payment', amountIrr: 1000, reason: 'requested refund' },
    idempotencyKey: 'short', user: { role: 'cashier', phone: 'refund-requester', allowedBranchIds: [4] },
  });
  assert.equal(request.statusCode, 400);
  assert.equal(request.body.error.code, 'refund_idempotency_key_invalid');
  assert.equal(harness.db.financeV2.refunds.length, 0);

  const { refundId } = await createApprovedRefund(harness);
  const evidence = insertEvidence(harness.db, outgoingEvidence());
  const disbursement = await harness.call(DISBURSEMENT_PATH, {
    params: { id: refundId }, body: { evidenceId: evidence.id }, idempotencyKey: 'short',
  });
  assert.equal(disbursement.statusCode, 400);
  assert.equal(disbursement.body.error.code, 'refund_idempotency_key_invalid');
  assert.equal(harness.db.financeV2.refunds.find((row) => row.id === refundId).status, 'approved');
});
