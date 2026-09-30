'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'role-panel.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'role-panel.css'), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing source range: ${startMarker}`);
  return source.slice(start, end);
}

function sourceFunction(name) {
  const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, 'm'));
  assert.ok(match, `missing function: ${name}`);
  return match[0];
}

const cashierUi = vm.runInNewContext(`(() => {
  ${sourceFunction('cashierIntegerAmount')}
  ${sourceFunction('cashierSettlementAmounts')}
  ${sourceFunction('cashierSplitAmount')}
  ${sourceFunction('cashierPaymentHistoryMarkup')}
  return { cashierSettlementAmounts, cashierSplitAmount, cashierPaymentHistoryMarkup };
})()`, {
  esc: (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]),
  money: (value) => `${value} تومان`,
  num: (value) => String(value),
});

test('cashier POS accepts sequential partial cash then manual-card legs against each fresh due', () => {
  const order = { id: 41, total: 10_000, amountPaid: 0, paymentStatus: 'unpaid', partialPayments: [] };
  const firstDue = cashierUi.cashierSettlementAmounts(order).due;
  const cashAmount = cashierUi.cashierSplitAmount(2_500, firstDue);
  assert.equal(cashAmount, 2_500);
  order.partialPayments.push({ id: 1, tender: 'cash', amount: cashAmount, amountTendered: 3_000 });
  order.amountPaid = cashAmount;
  order.paymentStatus = 'partial';

  const secondDue = cashierUi.cashierSettlementAmounts(order).due;
  assert.equal(secondDue, 7_500);
  const cardAmount = cashierUi.cashierSplitAmount(3_000, secondDue);
  assert.equal(cardAmount, 3_000);
  order.partialPayments.push({ id: 2, tender: 'manual_card', amount: cardAmount, reference: 'POS-REF-42' });
  order.amountPaid += cardAmount;

  const latest = cashierUi.cashierSettlementAmounts(order);
  const history = cashierUi.cashierPaymentHistoryMarkup(order, latest);
  assert.equal(latest.paid, 5_500);
  assert.equal(latest.due, 4_500);
  assert.match(history, /دریافت 1 · نقدی/);
  assert.match(history, /نقد دریافتی 3000 تومان · برگشت 500 تومان/);
  assert.match(history, /دریافت 2 · کارت بانکی · ثبت دستی/);
  assert.match(history, /مرجع POS-REF-42/);
  assert.match(history, /پرداخت خالص 5500 تومان/);
  assert.match(history, /مانده 4500 تومان/);
});

test('split amount selection rejects blank, fractional, zero, malformed, and over-due custom amounts', () => {
  const pick = cashierUi.cashierSplitAmount;
  assert.equal(pick(null, 7_500), 7_500, 'no custom amount defaults to the current due');
  assert.equal(pick(2_500, 7_500), 2_500);
  assert.equal(pick(7_500, 7_500), 7_500);
  for (const invalid of [0, -1, 7_501, 2_500.5, '۲۵۰۰ تومان', '2,500']) {
    assert.equal(pick(invalid, 7_500), null, `reject ${String(invalid)}`);
  }

  const pos = sourceBetween('  function openPayment(', '  async function settlePosOrder(');
  assert.match(pos, /parseCashDrawerInput\(document\.getElementById\('split-custom'\)\)/);
  assert.match(pos, /cashierSplitAmount\(customAmount, outstanding\) === null/);
  assert.doesNotMatch(pos, /Math\.round\(Number\(splitAmount\)/);
});

test('cashier register and POS composer keep recorded tender legs and current balance visible', () => {
  const register = sourceBetween('  function cashierRegister() {', '  async function refreshCashierQueue(');
  const dialog = sourceBetween('  function openCashierSettlementDialog(', '  function cashierSettlementStageCanSettle(');
  const payment = sourceBetween('  function openPayment(', '  async function settlePosOrder(');

  assert.match(register, /cashierPaymentHistoryMarkup\(order, amounts, true\)/);
  assert.match(dialog, /cashierPaymentHistoryMarkup\(order, amounts\)/);
  assert.match(payment, /cashierPaymentHistoryMarkup\(order, amounts\)/);
  assert.match(dialog, /aria-required="true" required/);
  assert.match(dialog, /کارت‌خوان به سامانه متصل نیست/);

  const styles = sourceBetween('  function ensureCashierSettlementStyles() {', '  function cashierPendingMatchesOrder(');
  assert.match(styles, /\.cashier-payment-history__balance/);
  assert.match(styles, /max-height:112px; overflow:auto/);
  assert.match(styles, /\.cashier-settlement__actions button \{ width:100%; min-height:52px/);
  assert.match(styles, /\.cashier-settlement__fields input \{ width:100%; min-height:52px/);
});

test('ambiguous cashier retry keeps the persisted tender intent and idempotency key unchanged', () => {
  const submit = sourceBetween('  async function submitCashierSettlement(', '  function openCashierSettlementDialog(');
  const openPayment = sourceBetween('  function openPayment(', '  async function settlePosOrder(');
  const retry = sourceBetween('    main.querySelectorAll(\'[data-cashier-retry-pending]\')', '    main.querySelectorAll(\'[data-cashier-status]\')');

  assert.ok(openPayment.indexOf('cashierPendingSettlementForOrder(order)') < openPayment.indexOf('openDialog('),
    'a new POS split must not overwrite an unresolved cashier intent');
  assert.match(openPayment, /دریافت قبلی هنوز تعیین‌تکلیف نشده است/);
  assert.match(openPayment, /state\.activeView = 'orders'/);
  assert.ok(submit.indexOf('persistCashierPendingSettlement(order, pending)') < submit.indexOf('await api('),
    'persist the retryable intent before sending');
  assert.match(submit, /retryPending\?\.idempotencyKey \|\| settlementIdempotencyKey/);
  assert.match(submit, /'Idempotency-Key': idempotencyKey/);
  assert.match(submit, /paymentAmount: actorIntent\.paymentAmount/);
  assert.match(submit, /paymentReference: actorIntent\.tender === 'manual_card'/);
  assert.match(submit, /persistCashierPendingSettlement\(order, \{ \.\.\.pending, \.\.\.\(blockedReason/);
  assert.match(submit, /idempotency_replay_unavailable/);
  assert.match(submit, /دریافت را تکرار نکنید/);
  assert.match(retry, /submitCashierSettlement\(order, pendingIntent\.intent, button, pendingIntent\)/);
  assert.match(retry, /pendingIntent\.blockedReason/);
});

test('cashier treats an unavailable settlement replay as an unknown outcome and blocks retry', () => {
  const api = sourceBetween('  async function api(', '  function showToast(');
  const submit = sourceBetween('  async function submitCashierSettlement(', '  function openCashierSettlementDialog(');
  const register = sourceBetween('  function cashierRegister() {', '  async function refreshCashierQueue(');
  assert.match(api, /idempotency_key_conflict', 'idempotency_replay_unavailable', 'payment_status_reconciliation_required'/);
  assert.match(submit, /idempotency_replay_unavailable/);
  assert.match(register, /pendingIntent\.blockedReason/);
  assert.match(register, /دریافت تازه و تکرار درخواست متوقف شده است/);
});
