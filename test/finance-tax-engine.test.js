'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const taxEngine = require('../server/finance/tax-engine');

function settings(overrides = {}) {
  return {
    defaultCategory: 'prepared_food',
    categories: [{ code: 'prepared_food', exempt: false, effectiveFrom: '2026-01-01', effectiveTo: null }],
    rules: [{
      id: 'configured-food-rate-v3', code: 'FOOD_RATE_V3', taxCategory: 'prepared_food',
      rate: 0.1, inclusive: false, effectiveFrom: '2026-01-01', effectiveTo: null,
      version: 3, status: 'active', legalSource: 'explicit test configuration',
    }],
    ...overrides,
  };
}

test('tax totals reconcile to the effective rule snapshot after line and global discounts', () => {
  const result = taxEngine.calculateTax(settings(), [
    { itemId: 'meal-1', quantity: 2, unitPrice: 1000, discount: 100, taxCategory: 'prepared_food' },
  ], { date: '2026-09-20T10:00:00.000Z', globalDiscount: 100 });

  assert.equal(result.subtotalGross, 2000);
  assert.equal(result.totalDiscounts, 200);
  assert.equal(result.totalTaxableBase, 1800);
  assert.equal(result.totalTax, 180);
  assert.equal(result.grandTotal, 1980);
  assert.equal(result.items[0].ruleSnapshot.id, 'configured-food-rate-v3');
  assert.equal(result.items[0].ruleSnapshot.version, 3);
  assert.equal(result.items[0].taxAmount, result.breakdown[0].taxAmount);
});

test('a raw defaultRate cannot replace a missing effective-dated tax rule', () => {
  assert.throws(() => taxEngine.calculateTax({
    defaultCategory: 'special_service', defaultRate: 0.03, inclusive: false,
    categories: [{ code: 'special_service', exempt: false, effectiveFrom: '2026-01-01' }],
    rules: [],
  }, [{ itemId: 'service-1', unitPrice: 1000, taxCategory: 'special_service' }], {
    date: '2026-09-20T10:00:00.000Z',
  }), { code: 'tax_rule_missing' });
});

test('an unconfigured tenant receives no invented standard-rate schedule', () => {
  const tenant = {};
  const taxSettings = taxEngine.ensureTaxSettings(tenant);
  assert.deepEqual(taxSettings.rules, []);
  assert.throws(() => taxEngine.calculateTax(tenant, [
    { itemId: 'unconfigured-meal', unitPrice: 1000, taxCategory: 'standard_1405' },
  ], { date: '2026-09-20T10:00:00.000Z' }), { code: 'tax_rule_missing' });
});

test('legacy source-code default rates are not trusted as persisted tenant configuration', () => {
  const legacy = {
    defaultCategory: 'standard_1405',
    categories: [{ code: 'standard_1405', exempt: false, effectiveFrom: '2026-03-21' }],
    rules: [{
      id: 'tr-1405-std', code: 'VAT_STD_1405', taxCategory: 'standard_1405',
      rate: 0.1, inclusive: false, effectiveFrom: '2026-03-21', version: 2, status: 'active',
    }],
  };
  assert.throws(() => taxEngine.calculateTax(legacy, [{ unitPrice: 1000 }], {
    date: '2026-09-20T10:00:00.000Z',
  }), { code: 'tax_rule_missing' });
});

test('persisted tax rates without a stable code, version, and legal source are never applied', () => {
  const incompleteLegacy = {
    defaultCategory: 'standard_1405',
    categories: [{ code: 'standard_1405', exempt: false, effectiveFrom: '2026-03-21' }],
    rules: [{
      id: 'tr-1', taxCategory: 'standard_1405', rate: 0.1, inclusive: false,
      locationId: null, status: 'active',
    }],
  };
  assert.throws(() => taxEngine.calculateTax(incompleteLegacy, [{ unitPrice: 1_100 }], {
    date: '2026-09-24T10:00:00.000Z', locationId: 4,
  }), { code: 'tax_rule_missing' });
});

test('future rules are not applied early and missing historic rules fail closed', () => {
  const future = settings({ rules: [{
    id: 'future-food-rate', taxCategory: 'prepared_food', rate: 0.12,
    inclusive: false, effectiveFrom: '2027-01-01', version: 4, status: 'active',
  }] });
  assert.throws(() => taxEngine.calculateTax(future, [{ unitPrice: 1000 }], {
    date: '2026-12-31T23:59:59.000Z',
  }), { code: 'tax_rule_missing' });
});
