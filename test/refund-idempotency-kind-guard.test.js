'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const financeV2 = require('../server/finance-v2');

const REFUND_REQUEST_PATH = '/api/admin/v2/finance/orders/:orderId/refund-requests';
const REFUND_KEY = 'refund-idempotency-kind-guard-0001';

function fixture() {
  return {
    branches: [{ id: 4, active: true }],
    orders: [{
      id: 'refund-idempotency-order', branchId: 4, total: 1000,
      paymentStatus: 'paid', paidAt: '2026-09-20T10:00:00.000Z', paymentMethod: 'online',
    }],
    financeV2: {
      journalEntries: [{
        id: 'refund-idempotency-sale-entry', orderId: 'refund-idempotency-order',
        source: 'order.paid', sourceId: 'refund-idempotency-order', branchId: 4,
        status: 'posted', lines: [{ accountCode: '4110' }],
      }],
      payments: [{
        id: 'refund-idempotency-payment', orderId: 'refund-idempotency-order', branchId: 4,
        tender: 'online', amountIrr: 10000, status: 'succeeded', refundedIrr: 0,
      }],
      refunds: [], approvals: [], idempotency: {}, idempotencyRequests: {},
    },
  };
}

function createHarness(db = fixture()) {
  const routes = new Map();
  const app = {};
  for (const method of ['get', 'post', 'patch', 'put', 'delete']) {
    app[method] = (path, ...handlers) => routes.set(`${method.toUpperCase()} ${path}`, handlers);
  }
  let saveCalls = 0;
  financeV2.registerFinanceV2Routes({
    app,
    getDb: () => db,
    save: async () => { saveCalls += 1; },
    requireCapability: () => (_req, _res, next) => next(),
    effectiveRole: (user) => user.role,
    getStorageStatus: () => ({ available: true }),
  });

  async function call(idempotencyKey = REFUND_KEY) {
    const handlers = routes.get(`POST ${REFUND_REQUEST_PATH}`);
    assert.ok(handlers, 'refund request route is registered');
    const req = {
      method: 'POST', route: { path: REFUND_REQUEST_PATH }, path: REFUND_REQUEST_PATH,
      originalUrl: REFUND_REQUEST_PATH, params: { orderId: 'refund-idempotency-order' },
      body: {
        branchId: 4, paymentId: 'refund-idempotency-payment', amountIrr: 2000,
        reason: 'customer refund request', refundDate: '2026-09-20T10:00:00.000Z',
      },
      query: {}, user: { role: 'owner', phone: 'refund-test-owner' },
      get(name) { return name.toLowerCase() === 'idempotency-key' ? idempotencyKey : ''; },
    };
    const res = {
      statusCode: 200, headersSent: false, body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; this.headersSent = true; return this; },
    };
    let index = 0;
    const next = () => {
      const handler = handlers[index++];
      return handler ? handler(req, res, next) : undefined;
    };
    await next();
    return res;
  }

  return { db, call, get saveCalls() { return saveCalls; } };
}

test('a persisted key owned by another operation cannot be reported as a refund replay', async () => {
  const harness = createHarness();
  const first = await harness.call();
  assert.equal(first.statusCode, 201, JSON.stringify(first.body?.error));
  assert.equal(first.body.data.refund.idempotencyKey, REFUND_KEY);
  assert.equal(harness.db.financeV2.refunds.length, 1);

  // Simulate an inconsistent persisted replay index while leaving the request
  // fingerprint for this exact refund unchanged. The refund route itself must
  // still fail closed instead of trusting a record for another operation.
  harness.db.financeV2.idempotency[REFUND_KEY] = {
    kind: 'purchase_order', id: 'unrelated-purchase-order', at: '2026-09-20T10:01:00.000Z',
  };
  const savesBeforeReplay = harness.saveCalls;
  const replay = await harness.call();

  assert.equal(replay.statusCode, 409);
  assert.equal(replay.body.error.code, 'idempotency_key_payload_mismatch');
  assert.equal(replay.body.data, null);
  assert.equal(harness.db.financeV2.refunds.length, 1, 'replay conflict must not create another refund');
  assert.equal(harness.saveCalls, savesBeforeReplay, 'replay conflict must not persist or disburse anything');
});

test('a legacy cross-operation key without a matching request fingerprint fails closed', async () => {
  const harness = createHarness();
  harness.db.financeV2.idempotency[REFUND_KEY] = {
    kind: 'purchase_order', id: 'unrelated-purchase-order', at: '2026-09-20T10:01:00.000Z',
  };

  const response = await harness.call();

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.error.code, 'idempotency_key_legacy_unverifiable');
  assert.equal(response.body.data, null);
  assert.equal(harness.db.financeV2.refunds.length, 0);
  assert.equal(harness.saveCalls, 0);
});
