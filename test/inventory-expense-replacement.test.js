'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const finance = require('../server/finance-v2');

function dbFixture() {
  return {
    branches: [{ id: 1, name: 'اصلی', active: true }],
    menuItems: [{ id: 10, name: 'لاته', price: 100000, available: true, active: true }],
    accounting: {
      inventoryItems: [{ id: 'milk', name: 'شیر', unit: 'لیتر', qtyOnHand: 2, avgCostIrr: 100000, minStock: 1, branchId: 1 }],
      accounts: [
        { code: '1110', name: 'Cash', type: 'asset', isPostingAccount: true },
        { code: '1210', name: 'Bank', type: 'asset', isPostingAccount: true },
        { code: '6200', name: 'Rent', nameFa: 'اجاره', type: 'expense', isPostingAccount: true },
      ],
      fiscalPeriods: [{ id: 'period', name: 'دوره آزمون', startDate: '2026-08-01', endDate: '2026-08-31', status: 'open' }],
    },
  };
}

test('approved recipe capacity becomes the menu availability source', () => {
  const db = dbFixture();
  const state = finance.ensureFinanceV2(db);
  state.recipeVersions.push({
    id: 'recipe-latte', menuItemId: '10', branchId: 1, status: 'approved', effectiveFrom: '2026-08-01T00:00:00.000Z',
    yieldQuantity: 1, ingredients: [{ itemId: 'milk', quantity: 250, unit: 'میلی‌لیتر', quantityBasis: 'raw', yieldPercent: 100 }],
  });
  const available = finance.menuItemAvailability(db, 10, 1, 4);
  assert.equal(available.tracked, true);
  assert.equal(available.available, true);
  assert.equal(available.capacity, 8);
  const shortage = finance.menuItemAvailability(db, 10, 1, 9);
  assert.equal(shortage.available, false);
  assert.equal(shortage.reason, 'inventory_shortage');
});

test('new inventory items are branch-scoped and duplicate-safe', () => {
  const db = dbFixture();
  const result = finance.createInventoryItemV2(db, { branchId: 1, name: 'قهوه', sku: 'COFFEE-01', unit: 'کیلوگرم', qtyOnHand: 3, avgCostIrr: 500000 }, 'manager');
  assert.equal(result.item.branchId, 1);
  assert.equal(result.item.avgCostIrr, 500000);
  assert.throws(() => finance.createInventoryItemV2(db, { branchId: 1, name: 'قهوه', unit: 'کیلوگرم' }, 'manager'), (error) => error.code === 'inventory_name_duplicate');
});

test('operating expense creates a pending approval and posts through the same journal', () => {
  const db = dbFixture();
  const result = finance.createOperatingExpenseV2(db, {
    branchId: 1, category: 'rent', amountToman: 2500000, date: '2026-08-29', paymentMethod: 'bank', subject: 'اجاره ماهانه',
  }, 'accountant');
  assert.equal(result.expense.status, 'pending_approval');
  assert.equal(result.journalEntry.status, 'pending_approval');
  assert.equal(result.journalEntry.debitIrr, 25000000);
  const approved = finance.decideApproval(db, result.approval.id, 'approved', 'manager', 'تأیید هزینه');
  assert.equal(approved.entry.status, 'posted');
  assert.equal(db.financeV2.operatingExpenses[0].status, 'posted');
  assert.equal(approved.entry.debitIrr, approved.entry.creditIrr);
});
