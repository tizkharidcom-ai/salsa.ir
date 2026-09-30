'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildCheckoutTaxSnapshot, checkoutSnapshotAmountsForLegacyToman } = require('../server/checkout-tax');

function makeSnapshot(lineTotalToman) {
  return buildCheckoutTaxSnapshot({
    taxSettings: {
      defaultCategory: 'standard_1405',
      categories: [{ code: 'standard_1405', exempt: false }],
      rules: [{
        id: 'branch-4-vat-v1', code: 'VAT_BRANCH_4', version: 1,
        taxCategory: 'standard_1405', rate: 0.1, inclusive: true,
        locationId: 4, status: 'active', effectiveFrom: '2026-01-01',
        legalSource: 'test fixture only',
      }],
    },
    branchId: 4,
    fulfillment: 'dine_in',
    lines: [{ menuItemId: 7, lineTotal: lineTotalToman, taxCategory: 'standard_1405' }],
    date: new Date('2026-09-24T09:00:00Z'),
  });
}

test('legacy Toman sales journal consumes a valid inclusive checkout snapshot without recalculating tax', () => {
  const snapshot = makeSnapshot(110);
  const amounts = checkoutSnapshotAmountsForLegacyToman({
    total: 110,
    branchId: 4,
    fulfillment: 'dine_in',
    taxSnapshot: snapshot,
  });
  assert.deepEqual(amounts, {
    orderTotalToman: 110,
    totalTaxToman: 10,
    discountToman: 0,
    netSalesToman: 100,
  });
});

test('legacy Toman journal refuses fractional-toman tax or a tampered checkout snapshot', () => {
  const fractional = makeSnapshot(111);
  assert.equal(checkoutSnapshotAmountsForLegacyToman({
    total: 111, branchId: 4, fulfillment: 'dine_in', taxSnapshot: fractional,
  }), null);

  const snapshot = makeSnapshot(110);
  assert.equal(checkoutSnapshotAmountsForLegacyToman({
    total: 110, branchId: 9, fulfillment: 'dine_in', taxSnapshot: snapshot,
  }), null);
  assert.equal(checkoutSnapshotAmountsForLegacyToman({
    total: 111, branchId: 4, fulfillment: 'dine_in', taxSnapshot: snapshot,
  }), null);
});

test('automatic legacy journal no longer guesses a 10-percent tax to force reconciliation', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'accounting-engine.js'), 'utf8');
  const start = source.indexOf('function syncOrderSalesJournal(');
  const end = source.indexOf('function rebuildLedgerFromOrders(', start);
  assert.ok(start >= 0 && end > start);
  const journal = source.slice(start, end);
  assert.doesNotMatch(journal, /orderTotal\s*\/\s*1\.10/);
  assert.match(journal, /checkoutSnapshotAmountsForLegacyToman\(order\)/);
  assert.match(journal, /tax calculation does not reconcile to the paid total/);
});
