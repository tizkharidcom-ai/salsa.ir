'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'role-panel.js'), 'utf8');

function sourceFunction(name) {
  const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, 'm'));
  assert.ok(match, `missing source function: ${name}`);
  return match[0];
}

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing source range: ${startMarker}`);
  return source.slice(start, end);
}

const parseAmount = vm.runInNewContext(`(() => {
  ${sourceFunction('cashierIntegerAmount')}
  ${sourceFunction('waiterPaymentAmount')}
  return waiterPaymentAmount;
})()`, {
  normalizeDigits(value) {
    return String(value).replace(/[۰-۹٠-٩]/gu, (digit) => String('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'.indexOf(digit) % 10));
  },
});

const canRecoverPayment = vm.runInNewContext(`(() => {
  ${sourceFunction('waiterPendingPaymentCanRecover')}
  return waiterPendingPaymentCanRecover;
})()`);

test('waiter allocation accepts only positive whole-Toman amounts within the current due', () => {
  assert.equal(parseAmount('۱٬۲۵۰', 5_000), 1_250);
  assert.equal(parseAmount('5,000', 5_000), 5_000);
  for (const value of ['', '0', '-1', '5000.5', '5,00', '۵۰۰۱']) {
    assert.equal(parseAmount(value, 5_000), null, `reject ${JSON.stringify(value)}`);
  }
  assert.equal(parseAmount('1', 0), null);
  assert.equal(parseAmount('1', Number.MAX_SAFE_INTEGER + 1), null);
});

test('waiter can allocate a mixed tender in separate cash and manual-card legs without exceeding the shrinking balance', () => {
  let due = 10_000;
  const cash = parseAmount('۲۵۰۰', due);
  assert.equal(cash, 2_500);
  due -= cash;
  const card = parseAmount('3,000', due);
  assert.equal(card, 3_000);
  due -= card;
  assert.equal(due, 4_500);
  assert.equal(parseAmount('4,501', due), null);
  assert.equal(parseAmount(String(due), due), due);
});

test('waiter payment uses the selected allocation for cash, manual card, and server-response verification', () => {
  const payment = sourceBetween('    const completePayment = async (method, requestedAmount, amountTendered, confirmButton)', '    const renderPaymentChoices = () =>');
  assert.match(payment, /paymentAmount: requestedAmount/);
  assert.match(payment, /amountTendered: method === 'cash' \? amountTendered : requestedAmount/);
  assert.match(payment, /paymentAmount: intent\.paymentAmount/);
  assert.match(payment, /amountTendered: intent\.amountTendered/);
  assert.match(payment, /paymentAmount === Number\(intent\.paymentAmount\)/);
  assert.match(payment, /Number\(retry\.baselinePaid\) !== Number\(amountPaid\)/);
});

test('waiter collection exposes bounded partial amounts and keeps cash change and manual-card guidance allocation-aware', () => {
  const paymentUi = sourceBetween('    const renderPaymentConfirmation = (method, retrying = false) =>', '    renderPaymentChoices();');
  assert.match(paymentUi, /id="wt-payment-amount"/);
  assert.match(paymentUi, /waiterPaymentAmount\(paymentAmountInput\?\.value, amountDue\)/);
  assert.match(paymentUi, /parsedTendered >= paymentAmount/);
  assert.match(paymentUi, /money\(tendered - paymentAmount\)/);
  assert.match(paymentUi, /completePayment\(method, paymentAmount, tendered/);
  assert.match(paymentUi, /برای ترکیب نقد و کارت، هر دریافت را جدا ثبت کنید/);
  assert.match(paymentUi, /ابتدا مبلغ انتخابی را روی کارت‌خوان مستقل دریافت کنید/);
});

test('uncertain waiter payment retry retains its original amount and cannot be replayed against a changed paid baseline', () => {
  const payment = sourceBetween('    const completePayment = async (method, requestedAmount, amountTendered, confirmButton)', '    const renderPaymentChoices = () =>');
  const recovery = sourceFunction('waiterPendingPaymentCanRecover');
  assert.match(payment, /const retry = wt\.pendingPayment/);
  assert.match(payment, /const retry = wt\.pendingPayment;[\s\S]*?paymentAmount: requestedAmount/);
  assert.match(payment, /const retry = wt\.pendingPayment;[\s\S]*?Number\(retry\.baselinePaid\) !== Number\(amountPaid\)/);
  assert.match(recovery, /paymentAmount <= Number\(order\.total\) - baselinePaid/);
  assert.match(recovery, /tender === 'cash' \? amountTendered >= paymentAmount : amountTendered === paymentAmount/);
});

test('pending recovery accepts the original bounded split leg and rejects an allocation above its original balance', () => {
  const order = { id: 9, branchId: 3, total: 10_000 };
  const pending = {
    idempotencyKey: 'waiter-pay-123',
    baselinePaid: 4_000,
    intent: {
      orderId: 9,
      branchId: 3,
      tender: 'cash',
      paymentAmount: 3_000,
      amountTendered: 3_500,
    },
  };
  assert.equal(canRecoverPayment(pending, order, 3), true);
  assert.equal(canRecoverPayment({
    ...pending,
    intent: { ...pending.intent, paymentAmount: 6_001, amountTendered: 6_001 },
  }, order, 3), false);
  assert.equal(canRecoverPayment({
    ...pending,
    intent: { ...pending.intent, branchId: 4 },
  }, order, 3), false);
});
