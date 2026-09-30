'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { publicCheckoutOrderView } = require('../server/public-checkout-order');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

test('guest order acknowledgement is an allowlist and keeps only the dine-in receipt fields', () => {
  const source = {
    id: 41,
    orderNo: 'W-123-41',
    total: 420000,
    status: 'pay_at_cashier',
    paymentStatus: 'unpaid',
    fulfillment: 'dine_in',
    tableNo: '۷',
    phone: '09123456789',
    name: 'مهمان خصوصی',
    branchId: 701,
    paymentMethod: 'cashier',
    items: [{ name: 'مورد محرمانه', price: 420000 }],
    note: 'یادداشت خصوصی',
    statusHistory: [{ by: { phone: '09120000000' } }],
    partialPayments: [{ reference: 'private-reference' }],
  };

  assert.deepEqual(publicCheckoutOrderView(source), {
    id: 41,
    orderNo: 'W-123-41',
    total: 420000,
    status: 'pay_at_cashier',
    paymentStatus: 'unpaid',
    fulfillment: 'dine_in',
    tableNo: '۷',
  });
  assert.deepEqual(publicCheckoutOrderView({
    id: 44,
    total: 420000,
    branchId: 701,
    taxSnapshot: { schemaVersion: 1, currency: 'IRR', inclusive: true, branchId: 701, totalTaxIrr: 120000 },
  }).tax, { inclusive: true, totalTaxIrr: 120000 });
  assert.equal(publicCheckoutOrderView({
    total: 420000,
    branchId: 701,
    taxSnapshot: { schemaVersion: 1, currency: 'IRR', inclusive: true, branchId: 701, totalTaxIrr: 4200001 },
  }).tax, undefined, 'a corrupt tax amount cannot exceed the paid gross');
  assert.equal(source.phone, '09123456789', 'projection does not mutate stored order data');
});

test('delivery acknowledgement exposes only customer-facing acceptance and ETA, never address or rejection evidence', () => {
  const view = publicCheckoutOrderView({
    id: 42,
    orderNo: 'W-123-42',
    total: 990000,
    status: 'sent_to_kitchen',
    paymentStatus: 'unpaid',
    fulfillment: 'delivery',
    phone: '09123456789',
    delivery: { address: 'نشانی خصوصی', instructions: 'یادداشت خصوصی', etaMinutes: 35, zoneName: 'محدوده داخلی' },
    deliveryAcceptance: {
      status: 'accepted',
      source: 'restaurant',
      acceptedBy: { phone: '09120000000' },
      acceptedAt: '2026-09-24T10:00:00.000Z',
      reference: 'internal-reference',
      reason: 'متن عملیاتی محرمانه',
    },
  });

  assert.deepEqual(view, {
    id: 42,
    orderNo: 'W-123-42',
    total: 990000,
    status: 'sent_to_kitchen',
    paymentStatus: 'unpaid',
    fulfillment: 'delivery',
    deliveryAcceptance: { status: 'accepted', source: 'restaurant' },
    delivery: { etaMinutes: 35 },
  });
});

test('malformed receipt fields fail closed and unrelated fulfillment fields are omitted', () => {
  assert.deepEqual(publicCheckoutOrderView({
    id: Number.MAX_SAFE_INTEGER + 1,
    total: -1,
    fulfillment: 'unknown',
    tableNo: 'private',
    delivery: { etaMinutes: 0, address: 'private' },
  }), {});
  assert.equal(publicCheckoutOrderView(null), null);
  assert.equal(publicCheckoutOrderView([]), null);
});

test('public acknowledgement normalizes unsupported lifecycle and payment values', () => {
  assert.deepEqual(publicCheckoutOrderView({
    id: 43,
    orderNo: 'W-123-43',
    total: 125000,
    status: 'internal_address=private',
    paymentStatus: 'provider secret=private-reference',
    fulfillment: 'pickup',
  }), {
    id: 43,
    orderNo: 'W-123-43',
    total: 125000,
    status: 'unknown',
    fulfillment: 'pickup',
  });

  assert.equal(publicCheckoutOrderView({ paymentStatus: 'reconciliation_required' }).paymentStatus, 'unknown');
  assert.equal(publicCheckoutOrderView({ paymentStatus: 'PARTIAL' }).paymentStatus, 'partial');
});

test('public order creation and payment acknowledgements use the restricted order view', () => {
  assert.match(serverSource, /app\.post\('\/api\/checkout\/orders'[\s\S]*?order: publicCheckoutOrderView\(result\.order\)/);
  assert.match(serverSource, /app\.post\('\/api\/orders'[\s\S]*?order: publicCheckoutOrderView\(result\.order\), whatsapp: null/);
  assert.match(serverSource, /app\.post\('\/api\/checkout\/payments\/:id\/sandbox-confirm'[\s\S]*?order: publicCheckoutOrderView\(result\.order\)/);
  assert.match(serverSource, /app\.post\('\/api\/payments\/webhook\/:provider'[\s\S]*?order: publicCheckoutOrderView\(result\.order\)/);
});
