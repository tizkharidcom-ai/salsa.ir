'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCheckoutTaxSnapshot } = require('../server/checkout-tax');

function branchTaxSettings(overrides = {}) {
  return {
    defaultCategory: 'restaurant-standard',
    deliveryFeeTaxCategory: 'restaurant-standard',
    categories: [{ code: 'restaurant-standard', name: 'Fixture', exempt: false }],
    rules: [{
      id: 'fixture-branch-44-v1', code: 'fixture-standard', name: 'Test-only branch rule',
      taxCategory: 'restaurant-standard', rate: 0.09, status: 'active', version: 1,
      inclusive: true, locationId: 44, fulfillmentType: null,
      effectiveFrom: '2026-01-01', effectiveTo: null, legalSource: 'test fixture only',
    }],
    ...overrides,
  };
}

test('checkout tax snapshot is branch-scoped, inclusive, stable, and reconciles exactly to payable gross', () => {
  const snapshot = buildCheckoutTaxSnapshot({
    taxSettings: branchTaxSettings(),
    branchId: 44,
    fulfillment: 'dine_in',
    lines: [
      { menuItemId: 1, taxCategory: 'restaurant-standard', lineTotal: 110_010 },
      { menuItemId: 2, taxCategory: 'restaurant-standard', lineTotal: 55_000 },
    ],
    discountToman: 1_010,
    date: new Date('2026-09-24T12:00:00Z'),
  });

  assert.equal(snapshot.branchId, 44);
  assert.equal(snapshot.currency, 'IRR');
  assert.equal(snapshot.inclusive, true);
  assert.equal(snapshot.grossIrr, 1_650_100);
  assert.equal(snapshot.discountIrr, 10_100);
  assert.equal(snapshot.totalPayableIrr, 1_640_000);
  assert.ok(snapshot.totalTaxIrr > 0);
  assert.equal(snapshot.lines.length, 2);
  assert.ok(snapshot.lines.every((line) => line.ruleSnapshot.inclusive === true));
});

test('checkout tax snapshot fails closed for missing or unscoped branch rules', () => {
  const cases = [
    { settings: branchTaxSettings({ rules: [] }), fulfillment: 'dine_in' },
    { settings: branchTaxSettings({ rules: [{ ...branchTaxSettings().rules[0], locationId: null }] }), fulfillment: 'dine_in' },
    { settings: branchTaxSettings({ rules: [{ ...branchTaxSettings().rules[0], inclusive: false }] }), fulfillment: 'dine_in' },
  ];
  for (const entry of cases) {
    assert.throws(() => buildCheckoutTaxSnapshot({
      taxSettings: entry.settings, branchId: 44, fulfillment: entry.fulfillment,
      lines: [{ menuItemId: 1, lineTotal: 100_000 }], date: new Date('2026-09-24T12:00:00Z'),
    }), { code: 'checkout_tax_snapshot_unavailable', status: 409 });
  }
});

test('delivery checkout requires a configured inclusive branch rule for the delivery fee', () => {
  assert.throws(() => buildCheckoutTaxSnapshot({
    taxSettings: branchTaxSettings({ deliveryFeeTaxCategory: '' }),
    branchId: 44,
    fulfillment: 'delivery',
    lines: [{ menuItemId: 1, lineTotal: 100_000 }],
    deliveryFeeToman: 5_000,
    date: new Date('2026-09-24T12:00:00Z'),
  }), { code: 'checkout_tax_delivery_rule_missing', status: 409 });

  const snapshot = buildCheckoutTaxSnapshot({
    taxSettings: branchTaxSettings(), branchId: 44, fulfillment: 'delivery',
    lines: [{ menuItemId: 1, lineTotal: 100_000 }], deliveryFeeToman: 5_000,
    date: new Date('2026-09-24T12:00:00Z'),
  });
  assert.equal(snapshot.deliveryFee.grossIrr, 50_000);
  assert.equal(snapshot.totalPayableIrr, 1_050_000);
  assert.equal(snapshot.totalTaxIrr, snapshot.lines.reduce((sum, line) => sum + line.taxAmountIrr, 0) + snapshot.deliveryFee.taxAmountIrr);
});
