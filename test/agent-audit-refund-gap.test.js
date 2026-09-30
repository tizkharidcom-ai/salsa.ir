'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const financeV2 = require('../server/finance-v2');

const REFUND_REQUEST_PATH = '/api/admin/v2/finance/orders/:orderId/refund-requests';
const APPROVAL_PATH = '/api/admin/v2/finance/approvals/:id/decision';
const BANK_LINE_PATH = '/api/admin/v2/finance/reconciliation/bank-statement-lines';
const REFUND_MATCH_PATH = '/api/admin/v2/finance/reconciliation/refunds/:id/match';

function fixture() {
  return {
    branches: [{ id: 4, active: true }],
    orders: [{
      id: 'refund-audit-order', branchId: 4, total: 1000,
      paymentStatus: 'paid', paymentMethod: 'online',
    }],
    financeV2: {
      payments: [{
        id: 'refund-audit-payment', orderId: 'refund-audit-order', branchId: 4,
        tender: 'online', amountIrr: 10000, status: 'succeeded',
        providerReference: 'INCOMING-REFUND-AUDIT', refundedIrr: 0,
      }],
      journalEntries: [{ id: 'refund-audit-sale-journal', source: 'order.paid', sourceId: 'refund-audit-order', branchId: 4, status: 'posted' }],
      refunds: [], approvals: [],
      fiscalPeriods: [{
        id: 'refund-audit-period', branchId: 4, name: 'Audit period',
        startDate: '2026-01-01', endDate: '2026-12-31', status: 'open',
      }],
    },
  };
}

function createHarness(db = fixture()) {
  const routes = new Map();
  const app = {};
  for (const method of ['get', 'post', 'patch', 'put', 'delete']) {
    app[method] = (path, ...handlers) => routes.set(`${method.toUpperCase()} ${path}`, handlers);
  }
  financeV2.registerFinanceV2Routes({
    app,
    getDb: () => db,
    save: async () => undefined,
    requireCapability: () => (_req, _res, next) => next(),
    effectiveRole: (user) => user.role,
    getStorageStatus: () => ({ available: true }),
  });

  async function call(path, { params = {}, body = {}, idempotencyKey, user } = {}) {
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
  return { db, call };
}

test('manual bank statement rows cannot complete refund without trusted source provenance', async () => {
  const harness = createHarness();
  const request = await harness.call(REFUND_REQUEST_PATH, {
    params: { orderId: 'refund-audit-order' },
    body: {
      branchId: 4, paymentId: 'refund-audit-payment', amountIrr: 2000,
      reason: 'customer refund request', refundDate: '2026-09-20T10:00:00.000Z',
    },
    idempotencyKey: 'refund-audit-request-key-01',
    user: { role: 'cashier', phone: 'refund-requester', allowedBranchIds: [4] },
  });
  assert.equal(request.statusCode, 201, JSON.stringify(request.body?.error));
  const refund = request.body.data.refund;

  const approval = await harness.call(APPROVAL_PATH, {
    params: { id: refund.approvalId },
    body: { decision: 'approved', comment: 'independent approval' },
    idempotencyKey: 'refund-audit-approval-key-01',
    user: { role: 'owner', phone: 'independent-approver' },
  });
  assert.equal(approval.statusCode, 200, JSON.stringify(approval.body?.error));

  const bankLine = await harness.call(BANK_LINE_PATH, {
    body: {
      branchId: 4, bankReference: 'OUTGOING-AUDIT-REF-01',
      amountIrr: 2000, direction: 'outflow', occurredAt: '2026-09-20T11:00:00.000Z',
    },
    idempotencyKey: 'refund-audit-bank-line-key-01',
    user: { role: 'accountant', phone: 'bank-operator', allowedBranchIds: [4] },
  });
  assert.equal(bankLine.statusCode, 201, JSON.stringify(bankLine.body?.error));
  const statementLine = bankLine.body.data.statementLine;
  assert.equal(statementLine.details.evidenceSource, 'manual_bank_statement_line');
  assert.equal(statementLine.details.verifiedAt, undefined);
  assert.equal(statementLine.details.sourceRecordId, undefined);

  const finalization = await harness.call(REFUND_MATCH_PATH, {
    params: { id: refund.id }, body: { evidenceId: statementLine.id },
    idempotencyKey: 'refund-audit-finalize-key-01',
    user: { role: 'accountant', phone: 'refund-accountant', allowedBranchIds: [4] },
  });

  assert.equal(finalization.statusCode, 409);
  assert.equal(finalization.body.error.code, 'refund_match_evidence_unverified');
  assert.equal(harness.db.financeV2.refunds.find((row) => row.id === refund.id).status, 'approved');
  assert.equal(harness.db.financeV2.payments[0].refundedIrr, 0);
  assert.equal(harness.db.financeV2.journalEntries.length, 1, 'the recognized sale stays intact and no refund journal is posted');
  assert.equal(harness.db.financeV2.journalEntries.some((entry) => entry.source === 'order.payment_refund'), false);
  assert.equal(statementLine.status, 'unmatched');
  assert.equal(harness.db.financeV2.reconciliationItems.some((row) => row.kind === 'refund'), false);
});

test('partial online receipt is journaled as a customer deposit without recognizing the sale', () => {
  const order = {
    id: 'partial-receipt-audit-order', branchId: 4, total: 1000,
    paymentMethod: 'online',
    paymentStatus: 'unpaid', amountPaid: 0, partialPayments: [],
    createdAt: '2026-09-20T10:00:00.000Z',
  };
  const payment = {
    id: 'partial-receipt-audit-attempt', orderId: order.id, branchId: 4,
    status: 'paid', tender: 'online', amount: 400, provider: 'test-processor',
    reference: 'PARTIAL-RECEIPT-REFERENCE', createdAt: '2026-09-20T10:05:00.000Z',
  };
  const db = {
    branches: [{ id: 4, active: true }], orders: [order],
    financeV2: {
      rollout: { captureEnabled: true, enabledBranchIds: [] },
      fiscalPeriods: [{ id: 'open-4', branchId: 4, startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' }],
    },
  };

  const result = financeV2.captureOnlinePaidOrder(db, order, payment, { actor: 'payment-gateway' });

  assert.deepEqual(result, { skipped: true, reason: 'order_not_paid' });
  assert.equal(order.paymentStatus, 'partial');
  assert.equal(order.amountPaid, 400);
  assert.equal(order.partialPayments.length, 1);
  assert.equal(order.partialPayments[0].amount, 400);
  assert.equal(db.financeV2.payments.length, 1);
  assert.equal(db.financeV2.events.filter((event) => event.source === 'order.payment_received').length, 1);
  assert.equal(db.financeV2.journalEntries.filter((entry) => entry.source === 'order.payment_received').length, 1);
  assert.equal(db.financeV2.journalEntries.some((entry) => entry.source === 'order.paid'), false);
  assert.equal(db.financeV2.reconciliationItems.length, 1);
});
