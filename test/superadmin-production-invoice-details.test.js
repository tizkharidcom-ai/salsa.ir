'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const repository = require('../superadmin/frontend/js/godmode/domain/commercial/repository.js');

function setProductionMode(enabled) {
  repository._appMode = { isProduction: () => enabled };
}

test('production billing invoices use the authenticated snapshot and normalize IRR without demo fallback', async () => {
  const requests = [];
  repository.store = { getInvoices: () => { throw new Error('demo fallback must not run'); } };
  repository.client = {
    async get(url) {
      requests.push(url);
      if (url === '/api/control/billing/invoices') {
        return { data: [{
          id: 'inv_live_1', invoiceNumber: 'INV-LIVE-1', tenantId: 'tenant-1',
          amountSubtotalRials: 1250000, discountAmountRials: 50000,
          vatAmountRials: 120000, amountTotalRials: 1320000,
          status: 'unpaid', entitlementStatus: 'pending', currency: 'IRR',
          lineItems: [{ description: 'اشتراک', quantity: 1, unitPriceRials: 1250000, totalRials: 1250000 }]
        }] };
      }
      return { data: {
        id: 'inv_live_1', invoiceNumber: 'INV-LIVE-1', tenantId: 'tenant-1',
        amountSubtotalRials: 1250000, discountAmountRials: 50000,
        vatAmountRials: 120000, amountTotalRials: 1320000,
        status: 'paid', entitlementStatus: 'activated', currency: 'IRR',
        paidAt: '2026-09-20T10:00:00.000Z', settlementReference: 'settle-live-1',
        lineItems: [{ description: 'اشتراک', quantity: 1, unitPriceRials: 1250000, totalRials: 1250000 }]
      } };
    }
  };
  setProductionMode(true);

  const [listed] = await repository.getAllInvoices();
  assert.equal(listed.status, 'pending');
  assert.equal(listed.subtotalAmount, 125000);
  assert.equal(listed.vatAmount, 12000);
  assert.equal(listed.totalAmount, 132000);
  assert.equal(listed.lineItems[0].unitPriceToman, 125000);

  const detail = await repository.getInvoiceDetailsForPlatform('inv_live_1');
  assert.equal(detail.id, 'inv_live_1');
  assert.equal(detail.paymentRef, 'settle-live-1');
  assert.equal(detail.activationStatus, 'activated');
  assert.deepEqual(requests, [
    '/api/control/billing/invoices',
    '/api/control/billing/invoices/inv_live_1'
  ]);
});

test('invalid production invoice detail is rejected instead of displaying a different record', async () => {
  repository.client = { async get() { return { data: { id: 'another-invoice' } }; } };
  repository.store = { getInvoiceDetails: () => ({ id: 'demo-invoice' }) };
  setProductionMode(true);
  await assert.rejects(
    repository.getInvoiceDetailsForPlatform('inv_live_1'),
    /BILLING_INVOICE_DETAIL_INVALID/
  );
});

test('production invoice detail UI labels payment snapshots without claiming tax authority issuance', () => {
  const pagePath = path.resolve(__dirname, '../superadmin/frontend/js/godmode/pages/commercial/commercial.js');
  const source = fs.readFileSync(pagePath, 'utf8');
  assert.match(source, /getInvoiceDetailsForPlatform\(invoiceId\)/);
  assert.match(source, /گواهی صدور یا ثبت در سامانهٔ مودیان در منبع داده موجود نیست/);
});
