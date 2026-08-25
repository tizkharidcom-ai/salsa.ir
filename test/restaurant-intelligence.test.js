'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const intelligence = require('../server/finance/restaurant-intelligence');

function milkshakeFixture({ milkLiters = 10, bananaGrams = 1000 } = {}) {
  return {
    items: [
      { id: 'milk', name: 'شیر', unit: 'لیتر', qtyOnHand: milkLiters, branchId: 1 },
      { id: 'banana', name: 'موز', unit: 'گرم', qtyOnHand: bananaGrams, branchId: 1 },
    ],
    recipes: [{
      id: 'milkshake-v1', menuItemId: 'milkshake', name: 'شیرموز', version: 1, branchId: 1,
      ingredients: [
        { itemId: 'milk', qty: 250, unit: 'میلی‌لیتر' },
        { itemId: 'banana', qty: 25, unit: 'گرم' },
      ],
    }],
  };
}

test('recipe capacity identifies the limiting ingredient with Persian unit conversion', () => {
  const before = milkshakeFixture();
  const initial = intelligence.calculateRecipeCapacity({ ...before, branchId: 1 })[0];
  assert.equal(initial.status, 'available');
  assert.equal(initial.capacity, 40);
  assert.equal(initial.limitingIngredient.itemId, 'milk');

  const afterEightSales = milkshakeFixture({ milkLiters: 8, bananaGrams: 800 });
  const remaining = intelligence.calculateRecipeCapacity({ ...afterEightSales, branchId: 1 })[0];
  assert.equal(remaining.capacity, 32);
});

test('unit conversion rejects incompatible dimensions unless an item-specific conversion exists', () => {
  assert.equal(intelligence.convertQuantity(1, 'کیلوگرم', 'گرم').value, 1000);
  assert.equal(intelligence.convertQuantity(1, 'لیتر', 'میلی‌لیتر').value, 1000);
  assert.equal(intelligence.convertQuantity(1, 'عدد', 'گرم').code, 'unit_incompatible');
  assert.equal(intelligence.canonicalUnit('بسته'), null);
  const explicit = intelligence.convertQuantity(2, 'عدد', 'گرم', [{ fromUnit: 'عدد', toUnit: 'گرم', multiplier: 120 }]);
  assert.equal(explicit.value, 240);
  assert.equal(explicit.source, 'item_conversion');
});

test('negative available stock is never hidden and capacity does not become negative', () => {
  const fixture = milkshakeFixture();
  fixture.items[0].qtyOnHand = 1;
  fixture.items[0].reservedQty = 2;
  const result = intelligence.calculateRecipeCapacity({ ...fixture, branchId: 1 })[0];
  assert.equal(result.capacity, 0);
  assert.ok(result.issues.some((issue) => issue.code === 'negative_available_quantity'));
});

test('recipe yield is applied only when ingredient quantity basis is usable', () => {
  const items = [{ id: 'fruit', name: 'میوه', unit: 'گرم', qtyOnHand: 1000, branchId: 1 }];
  const make = (quantityBasis) => intelligence.calculateRecipeCapacity({ items, branchId: 1, recipes: [{
    id: quantityBasis, name: quantityBasis, branchId: 1, yieldPercent: 50,
    ingredients: [{ itemId: 'fruit', qty: 100, unit: 'گرم', quantityBasis }],
  }] })[0].capacity;
  assert.equal(make('usable'), 5);
  assert.equal(make('raw'), 10);
});

test('break-even uses weighted contribution and returns an actionable daily gap', () => {
  const result = intelligence.calculateBreakEven({
    fixedCostsIrr: [60000000, 40000000],
    sales: [{ revenueIrr: 200000000, variableCostIrr: 120000000 }],
    realizedNetSalesIrr: 100000000,
    remainingOpenDays: 10,
  });
  assert.equal(result.status, 'available');
  assert.equal(result.contributionMarginRatio, 0.4);
  assert.equal(result.breakEvenSalesIrr, 250000000);
  assert.equal(result.gapIrr, 150000000);
  assert.equal(result.requiredDailySalesIrr, 15000000);
});

test('break-even and stockout do not invent results from insufficient history', () => {
  const breakEven = intelligence.calculateBreakEven({ fixedCostsIrr: null, sales: [] });
  assert.equal(breakEven.status, 'insufficient_data');
  assert.equal(breakEven.breakEvenSalesIrr, null);

  const fixture = milkshakeFixture();
  const stockout = intelligence.calculateStockoutForecast({ ...fixture, orders: [], branchId: 1 });
  assert.equal(stockout.status, 'insufficient_data');
  assert.equal(stockout.recipeCoveragePercent, null);
});

test('stockout forecast uses paid recipe consumption only after minimum history', () => {
  const fixture = milkshakeFixture({ milkLiters: 5, bananaGrams: 500 });
  const orders = Array.from({ length: 15 }, (_, index) => ({
    id: index + 1, branchId: 1, status: 'done', paymentStatus: 'paid',
    createdAt: new Date(Date.UTC(2026, 7, index + 1, 12)).toISOString(),
    items: [{ menuItemId: 'milkshake', qty: 2 }],
  }));
  const forecast = intelligence.calculateStockoutForecast({ ...fixture, orders, branchId: 1, minHistoryDays: 14 });
  assert.equal(forecast.status, 'available');
  assert.equal(forecast.historyDays, 15);
  assert.equal(forecast.recipeCoveragePercent, 100);
  const milk = forecast.items.find((row) => row.itemId === 'milk');
  assert.equal(milk.averageDailyUsage, 0.5);
  assert.equal(milk.daysRemaining, 10);
});

test('stockout forecast excludes paid orders outside the requested period', () => {
  const fixture = milkshakeFixture({ milkLiters: 5, bananaGrams: 500 });
  const orders = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1, branchId: 1, status: 'done', paymentStatus: 'paid',
    createdAt: new Date(Date.UTC(2026, 7, index + 1, 12)).toISOString(),
    items: [{ menuItemId: 'milkshake', qty: index < 5 ? 100 : 2 }],
  }));
  const forecast = intelligence.calculateStockoutForecast({
    ...fixture, orders, branchId: 1, minHistoryDays: 14,
    from: '2026-08-06T00:00:00.000Z', to: '2026-08-20T23:59:59.999Z',
  });
  const milk = forecast.items.find((row) => row.itemId === 'milk');
  assert.equal(forecast.historyDays, 15);
  assert.equal(milk.averageDailyUsage, 0.5);
});

test('stockout forecast selects the recipe version effective on each sale date', () => {
  const fixture = milkshakeFixture({ milkLiters: 10, bananaGrams: 1000 });
  const first = { ...fixture.recipes[0], id: 'milkshake-v1', effectiveFrom: '2026-08-01T00:00:00.000Z', effectiveTo: '2026-08-11T00:00:00.000Z' };
  const second = {
    ...fixture.recipes[0], id: 'milkshake-v2', effectiveFrom: '2026-08-11T00:00:00.000Z', effectiveTo: null,
    ingredients: fixture.recipes[0].ingredients.map((row) => row.itemId === 'milk' ? { ...row, qty: 500 } : row),
  };
  const orders = Array.from({ length: 15 }, (_, index) => ({
    id: index + 1, branchId: 1, status: 'done', paymentStatus: 'paid',
    createdAt: new Date(Date.UTC(2026, 7, index + 1, 12)).toISOString(),
    items: [{ menuItemId: 'milkshake', qty: 1 }],
  }));
  const forecast = intelligence.calculateStockoutForecast({ items: fixture.items, recipes: [first, second], orders, branchId: 1, minHistoryDays: 14 });
  const milk = forecast.items.find((row) => row.itemId === 'milk');
  assert.equal(Math.round(milk.averageDailyUsage * 1000) / 1000, 0.333);
});

test('restaurant PostgreSQL migration normalizes units, recipe, purchasing and break-even data', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'server', 'migrations', '003_restaurant_costing.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS finance_units/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS finance_item_unit_conversions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS finance_recipe_ingredients/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS finance_purchase_order_lines/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS finance_goods_receipt_lines/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS finance_vendor_invoice_lines/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS finance_order_item_cost_snapshots/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS finance_break_even_snapshots/);
  assert.match(sql, /quantity_basis IN \('raw','usable'\)/);
  assert.match(sql, /finance_recipe_version_effective_no_overlap/);
  assert.match(sql, /inventory_movements_are_immutable_use_reversal/);
});
