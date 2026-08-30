'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const accounting = require('../server/accounting-engine');
const reconciliation = require('../server/finance/reconciliation-engine');
const inventory = require('../server/finance/inventory-engine');
const consolidation = require('../server/finance/consolidation-engine');

function fixture() {
  const db = {
    branches: [
      { id: 1, name: 'شعبه اصلی', code: 'main' },
      { id: 2, name: 'شعبه دوم', code: 'second' },
    ],
    orders: [
      { id: 1, branchId: 1, status: 'paid', paymentStatus: 'paid', total: 1000, createdAt: '2026-08-24T10:00:00.000Z', items: [{ id: 'm1', name: 'قهوه', price: 1000, qty: 1 }] },
      { id: 2, branchId: 2, status: 'paid', paymentStatus: 'paid', total: 2000, createdAt: '2026-08-24T11:00:00.000Z', items: [{ id: 'm2', name: 'چای', price: 2000, qty: 1 }] },
    ],
    accounting: {
      fiscalPeriods: [{ id: 'branch-report-period', name: 'مرداد', startDate: '2026-08-01', endDate: '2026-08-31', status: 'open' }],
      journalEntries: [],
      vendorBills: [
        { id: 'bill-1', branchId: 1, status: 'open', dueDate: '2026-08-01', balance: 100 },
        { id: 'bill-2', branchId: 2, status: 'open', dueDate: '2026-08-01', balance: 200 },
      ],
      inventoryItems: [
        { id: 'inv-1', branchId: 1, name: 'قهوه', unit: 'kg', qtyOnHand: 10, avgCost: 100 },
        { id: 'inv-2', branchId: 2, name: 'چای', unit: 'kg', qtyOnHand: 20, avgCost: 100 },
      ],
      recipes: [
        { id: 'recipe-1', branchId: 1, menuItemId: 'm1', name: 'قهوه', totalCost: 200 },
        { id: 'recipe-2', branchId: 2, menuItemId: 'm2', name: 'چای', totalCost: 300 },
      ],
    },
  };
  accounting.ensureAccountingData(db);
  accounting.postJournalEntry(db, {
    id: 'branch-journal-1', source: 'sale', sourceId: 'order-1', date: '2026-08-24T10:00:00.000Z', description: 'فروش شعبه یک',
    lines: [
      { accountCode: '1110', debit: 1000, credit: 0, branchId: 1 },
      { accountCode: '4110', debit: 0, credit: 1000, branchId: 1 },
    ],
  });
  accounting.postJournalEntry(db, {
    id: 'branch-journal-2', source: 'sale', sourceId: 'order-2', date: '2026-08-24T11:00:00.000Z', description: 'فروش شعبه دو',
    lines: [
      { accountCode: '1110', debit: 2000, credit: 0, branchId: 2 },
      { accountCode: '4110', debit: 0, credit: 2000, branchId: 2 },
    ],
  });
  return db;
}

test('branch-scoped accounting reports never mix orders, ledger lines, AP or inventory menu data', () => {
  const db = fixture();
  const branch1 = { branchId: 1 };

  assert.equal(accounting.getSalesAnalysis(db, branch1).totalSales, 1000);
  assert.equal(accounting.getSalesAnalysis(db, branch1).orderCount, 1);
  assert.equal(accounting.getTrialBalanceReport(db, '2026-08-31', branch1).totalDebit, 1000);
  assert.equal(accounting.getIncomeStatement(db, null, '2026-08-31', branch1).netSales, 1000);
  assert.equal(accounting.getBalanceSheet(db, '2026-08-31', branch1).totalAssets, 1000);
  assert.equal(accounting.getCashFlowStatement(db, null, '2026-08-31', branch1).operating.inflows, 1000);
  assert.equal(accounting.getAPAging(db, '2026-08-31', branch1).total, 100);
  assert.equal(reconciliation.calculateControlTotals(db.accounting, 1).totalDebits, 1000);

  const valuation = inventory.getInventoryValuation(db.accounting, 1);
  assert.deepEqual(valuation.items.map((item) => item.id), ['inv-1']);
  const menu = inventory.getMenuEngineeringMatrix(db.accounting, db, 1);
  assert.deepEqual(menu.items.map((item) => item.menuItemId), ['m1']);
  assert.deepEqual(consolidation.getBranchComparison(db, { branchIds: [1] }).branches.map((row) => row.branchId), [1]);
});

