'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const routeModules = [
  'server/salsa/control-plane/routes/billing-routes.js',
  'superadmin/backend/routes/billing-routes.js'
];

function getRefundHandler(router) {
  const layer = router.stack.find((entry) => entry.route &&
    (Array.isArray(entry.route.path)
      ? entry.route.path.includes('/invoices/:id/refund')
      : entry.route.path === '/invoices/:id/refund'));
  assert.ok(layer, 'invoice refund route is registered');
  return layer.route.stack.at(-1).handle;
}

async function invoke(handler, { invoiceId = 'invoice-a', transactionId } = {}) {
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  await handler({
    params: { id: invoiceId },
    body: { reason: 'Customer refund review', ...(transactionId ? { transactionId } : {}) },
    platformPrincipal: { id: 'finance-test-actor' }
  }, response);
  return response;
}

for (const routeModule of routeModules) {
  test(`${routeModule}: invoice refund only targets its own successful transaction`, async (t) => {
    const absoluteRoutePath = path.resolve(__dirname, '..', routeModule);
    const router = require(absoluteRoutePath);
    const paymentService = require(path.resolve(path.dirname(absoluteRoutePath), '../billing/payment-service'));
    const handler = getRefundHandler(router);
    const original = {
      getInvoice: paymentService.getInvoice,
      listTransactions: paymentService.listTransactions,
      refund: paymentService.refund
    };
    const invoice = { id: 'invoice-a', tenantId: 'tenant-a', status: 'open' };
    let transactions = [];
    const refundCalls = [];
    paymentService.getInvoice = async (id) => id === invoice.id ? invoice : null;
    paymentService.listTransactions = async () => transactions;
    paymentService.refund = async ({ transactionId }) => {
      refundCalls.push(transactionId);
      return { success: true, status: 'refunded', transactionId };
    };

    try {
      await t.test('uses the service canonical successful status and invokes provider refund', async () => {
        transactions = [{ id: 'tx-success', invoiceId: invoice.id, tenantId: invoice.tenantId, status: 'successful' }];
        const response = await invoke(handler);
        assert.equal(response.statusCode, 200);
        assert.deepEqual(refundCalls, ['tx-success']);
        assert.equal(response.body.data.status, 'refunded');
      });

      await t.test('rejects a transaction belonging to a different invoice', async () => {
        refundCalls.length = 0;
        transactions = [{ id: 'tx-foreign', invoiceId: 'invoice-b', tenantId: invoice.tenantId, status: 'successful' }];
        const response = await invoke(handler, { transactionId: 'tx-foreign' });
        assert.equal(response.statusCode, 409);
        assert.equal(response.body.error, 'TRANSACTION_INVOICE_MISMATCH');
        assert.deepEqual(refundCalls, []);
      });

      await t.test('refuses to mark an invoice refunded when no successful payment exists', async () => {
        refundCalls.length = 0;
        invoice.status = 'open';
        transactions = [{ id: 'tx-pending', invoiceId: invoice.id, tenantId: invoice.tenantId, status: 'pending' }];
        const response = await invoke(handler);
        assert.equal(response.statusCode, 409);
        assert.equal(response.body.error, 'REFUND_REQUIRES_SUCCESSFUL_TRANSACTION');
        assert.equal(invoice.status, 'open');
        assert.deepEqual(refundCalls, []);
      });

      await t.test('returns not-found instead of reporting a refund for an unknown invoice', async () => {
        const before = paymentService.getInvoice;
        paymentService.getInvoice = async () => null;
        const response = await invoke(handler, { invoiceId: 'missing-invoice' });
        assert.equal(response.statusCode, 404);
        assert.equal(response.body.error, 'INVOICE_NOT_FOUND');
        assert.deepEqual(refundCalls, []);
        paymentService.getInvoice = before;
      });
    } finally {
      paymentService.getInvoice = original.getInvoice;
      paymentService.listTransactions = original.listTransactions;
      paymentService.refund = original.refund;
    }
  });
}
