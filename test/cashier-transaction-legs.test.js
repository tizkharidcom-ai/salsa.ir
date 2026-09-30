'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/role-panel.js'), 'utf8');

function loadCashierTransactionRows() {
  const helper = source.match(/function cashierTransactionRows\(orders = \[\]\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(helper, 'cashier transaction row builder exists');
  return vm.runInNewContext(`${helper}; cashierTransactionRows;`);
}

test('transaction rows preserve each cash and manual-card payment leg for a partially paid order', () => {
  const rows = loadCashierTransactionRows()([{
    id: 41,
    orderNo: 'ORD-41',
    total: 10_000,
    amountPaid: 5_000,
    paymentStatus: 'partial',
    paymentTender: 'manual_card',
    partialPayments: [
      { id: 1, tender: 'cash', amount: 3_000, at: '2026-09-23T10:00:00.000Z' },
      { id: 2, tender: 'manual_card', amount: 2_000, reference: 'R-42', at: '2026-09-23T10:01:00.000Z' },
    ],
  }]);

  assert.equal(rows.length, 2);
  assert.deepEqual(Array.from(rows, (row) => [row.tender, row.amount]), [['manual_card', 2_000], ['cash', 3_000]]);
  assert.equal(rows[0].payment.reference, 'R-42');
  assert.equal(rows.reduce((sum, row) => sum + row.amount, 0), 5_000);
});

test('payment projection shortfall is surfaced as an unclassified reconciliation row', () => {
  const rows = loadCashierTransactionRows()([{
    id: 42,
    total: 10_000,
    amountPaid: 4_000,
    paymentStatus: 'partial',
    partialPayments: [{ id: 1, tender: 'cash', amount: 3_000, at: '2026-09-23T10:00:00.000Z' }],
  }]);

  assert.equal(rows.length, 2);
  assert.equal(rows.some((row) => row.tender === '' && row.amount === 1_000 && row.projectionMismatch), true);
  assert.equal(rows.every((row) => row.projectionMismatch), true);
});

test('legacy paid orders without payment legs remain visible without inventing a missing method', () => {
  const rows = loadCashierTransactionRows()([{
    id: 43,
    total: 8_000,
    paymentStatus: 'paid',
    paymentTender: 'cash',
    paidAt: '2026-09-23T10:02:00.000Z',
  }]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 8_000);
  assert.equal(rows[0].tender, 'cash');
  assert.equal(rows[0].legacy, true);
});

test('cashier transaction history and totals use all loaded payment legs, not a first-80 order slice', () => {
  const orders = Array.from({ length: 90 }, (_, index) => ({
    id: index + 1,
    total: 1_000,
    amountPaid: 1_000,
    paymentStatus: 'paid',
    partialPayments: [{ id: 1, tender: index % 2 ? 'cash' : 'manual_card', amount: 1_000, at: `2026-09-23T10:${String(index % 60).padStart(2, '0')}:00.000Z` }],
  }));
  const rows = loadCashierTransactionRows()(orders);
  const viewStart = source.indexOf('function cashierTransactions()');
  const viewEnd = source.indexOf('\n  function cashierRegister()', viewStart);
  const view = source.slice(viewStart, viewEnd);

  assert.equal(rows.length, 90);
  assert.equal(rows.reduce((sum, row) => sum + row.amount, 0), 90_000);
  assert.match(view, /cashierTransactionRows\(state\.data\.orders \|\| \[\]\)/);
  assert.match(view, /totalOf\(transactions\)/);
  assert.doesNotMatch(view, /\.slice\(0,\s*80\)/);
});
