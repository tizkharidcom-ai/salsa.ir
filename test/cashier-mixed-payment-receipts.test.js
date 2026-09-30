'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildReceiptBuffer, DEFAULT_PRINTER_CONFIG } = require('../server/network-printer');

const roleSource = fs.readFileSync(path.join(__dirname, '../js/role-panel.js'), 'utf8');

function sourceFunction(name) {
  const match = roleSource.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, 'm'));
  assert.ok(match, `missing ${name}`);
  return match[0];
}

const browserReceiptHelpers = vm.runInNewContext(`(() => {
  ${sourceFunction('cashierIntegerAmount')}
  ${sourceFunction('receiptPayment')}
  ${sourceFunction('receiptPaymentRows')}
  return { receiptPayment, receiptPaymentRows };
})()`);

const order = {
  id: 73,
  orderNo: 'ORD-73',
  paymentStatus: 'paid',
  paymentTender: 'manual_card',
  total: 10_000,
  partialPayments: [
    { tender: 'cash', amount: 3_000, amountTendered: 3_500 },
    { tender: 'manual_card', amount: 7_000, reference: 'PRIVATE-REF-DO-NOT-PRINT' },
  ],
  items: [{ name: 'QA dish', qty: 1, price: 10_000, lineTotal: 10_000 }],
  createdAt: '2026-09-24T10:00:00.000Z',
};

test('cashier receipt helpers preserve mixed tender labels and each valid amount', () => {
  assert.equal(browserReceiptHelpers.receiptPayment(order), 'نقدی + کارت بانکی · ثبت دستی');
  const rows = Array.from(browserReceiptHelpers.receiptPaymentRows(order));
  assert.deepEqual(rows.map((row) => [row.tender, row.amount]), [
    ['cash', 3_000], ['manual_card', 7_000],
  ]);
  assert.equal(rows.reduce((sum, row) => sum + row.amount, 0), order.total,
    'receipt tender allocation must reconcile exactly to the order total');
  assert.match(browserReceiptHelpers.receiptPayment(order), /ثبت دستی/);
  assert.doesNotMatch(browserReceiptHelpers.receiptPayment(order), /درگاه|آنلاین|تایید بانک/u,
    'manual terminal entry is not presented as a PSP-verified payment');
  assert.equal(browserReceiptHelpers.receiptPaymentRows({ partialPayments: [{ tender: 'cash', amount: '3e3' }] }).length, 0,
    'malformed amounts are not displayed as valid tender rows');
});

test('network receipt prints every split-tender leg and cash change without exposing card reference', () => {
  const receipt = buildReceiptBuffer(order, { ...DEFAULT_PRINTER_CONFIG, encoding: 'utf8' })
    .toString('utf8');
  assert.match(receipt, /ریز دریافت‌ها/);
  assert.match(receipt, /نقدی: ۳٫۰۰۰ تومان/);
  assert.match(receipt, /نقد دریافتی ۳٫۵۰۰ · برگشت ۵۰۰ تومان/);
  assert.match(receipt, /کارت بانکی · ثبت دستی: ۷٫۰۰۰ تومان/);
  assert.doesNotMatch(receipt, /PRIVATE-REF-DO-NOT-PRINT/);
});
