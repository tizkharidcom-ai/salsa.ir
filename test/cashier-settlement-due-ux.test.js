'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');
const vm = require('node:vm');
const { resolveSettlementAmounts } = require('../server/settlement-amounts');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'role-panel.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function sourceFunction(name) {
  const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, 'm'));
  assert.ok(match, `missing function: ${name}`);
  return match[0];
}

const cashierAmounts = vm.runInNewContext(`(() => {
  ${sourceFunction('cashierIntegerAmount')}
  ${sourceFunction('cashierSettlementAmounts')}
  return cashierSettlementAmounts;
})()`);

const cashierQueueOrders = vm.runInNewContext(`(() => {
  ${sourceFunction('orderPaymentStatus')}
  ${sourceFunction('cashierIntegerAmount')}
  ${sourceFunction('cashierSettlementAmounts')}
  ${sourceFunction('cashierSettlementStageCanSettle')}
  ${sourceFunction('cashierSettlementQueueOrders')}
  return cashierSettlementQueueOrders;
})()`);

const cashierWalletSettlementAllowed = vm.runInNewContext(`(() => {
  ${sourceFunction('cashierWalletSettlementAllowed')}
  return cashierWalletSettlementAllowed;
})()`);

test('cashier queue uses the canonical net-paid amount and blocks inconsistent payment projections', () => {
  const register = sourceBetween('  function cashierRegister() {', '  function cashierHandoff() {');
  assert.match(register, /ensureCashierSettlementStyles\(\)/);
  assert.match(register, /const amounts = cashierSettlementAmounts\(order\)/);
  assert.match(register, /دریافت نقدی · مانده \$\{money\(amounts\.due\)\}/);
  assert.match(register, /دریافت کارت · مانده \$\{money\(amounts\.due\)\}/);
  assert.match(register, /openCashierSettlementDialog\(order, button\.dataset\.settle, amounts\.due\)/);
  assert.match(register, /سوابق پرداخت با مبلغ فاکتور هم‌خوان نیست/);

  const partial = cashierAmounts({
    id: 71,
    total: 10_000,
    amountPaid: 3_500,
    partialPayments: [{ amount: 4_000, refundedAmount: 500 }],
  });
  assert.equal(partial.ok, true);
  assert.equal(partial.paid, 3_500);
  assert.equal(partial.due, 6_500);

  const inconsistent = cashierAmounts({
    total: 10_000,
    amountPaid: 4_000,
    partialPayments: [{ amount: 4_000, refundedAmount: 500 }],
  });
  assert.equal(inconsistent.ok, false);
  assert.equal(inconsistent.error, 'payment_history_inconsistent');
});

test('cashier routes unresolved payment states to review and only exposes model-eligible balances', () => {
  const orders = [
    { id: 1, status: 'ready', paymentStatus: 'partial', total: 1_000, amountPaid: 250, partialPayments: [{ amount: 250 }] },
    { id: 2, status: 'preparing', paymentStatus: 'unpaid', total: 1_000 },
    { id: 3, status: 'sent_to_kitchen', paymentStatus: 'partial', total: 1_000, amountPaid: 250, partialPayments: [{ amount: 250 }] },
    { id: 4, status: 'ready', paymentStatus: 'paid', total: 1_000 },
    { id: 5, status: 'ready', paymentStatus: 'pending', total: 1_000 },
    { id: 6, status: 'preparing', paymentStatus: 'unknown', total: 1_000 },
    { id: 7, status: 'cancelled', paymentStatus: 'partial', total: 1_000, amountPaid: 250, partialPayments: [{ amount: 250 }] },
    { id: 8, status: 'done', fulfillment: 'dine_in', paymentStatus: 'partial', total: 1_000, amountPaid: 250, partialPayments: [{ amount: 250 }] },
    { id: 9, status: 'picked_up', fulfillment: 'pickup', paymentStatus: 'unpaid', total: 1_000 },
    { id: 10, status: 'delivered', fulfillment: 'delivery', paymentStatus: 'partial', total: 1_000, amountPaid: 250, partialPayments: [{ amount: 250 }] },
    { id: 11, status: 'pay_at_cashier', paymentStatus: 'unpaid', total: 1_000 },
    { id: 12, status: 'pay_at_cashier', paymentStatus: 'pending', total: 1_000 },
    { id: 13, status: 'awaiting_confirmation', paymentStatus: 'unknown', total: 1_000 },
    { id: 14, status: 'pay_at_cashier', total: 1_000 },
    { id: 15, status: 'delivered', fulfillment: 'pickup', paymentStatus: 'partial', total: 1_000, amountPaid: 250, partialPayments: [{ amount: 250 }] },
    { id: 16, status: 'delivered', fulfillment: 'delivery', paymentStatus: 'paid', total: 1_000, amountPaid: 250 },
  ];
  assert.deepEqual(Array.from(cashierQueueOrders(orders), (order) => order.id), [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

  const register = sourceBetween('  function cashierRegister() {', '  function cashierHandoff() {');
  assert.match(register, /cashierSettlementQueueOrders\(orders\)/);
  const fetchCashier = sourceBetween('  async function fetchCashier() {', '  function menuModifierGroupsForItem(');
  assert.match(fetchCashier, /api\(`\/api\/admin\/v2\/orders\$\{qs\(\)\}`\)/);
  assert.match(serverSource, /assertUserBranchAccess\(req\.user, order\.branchId\)/);
});

test('cashier dialog allows a safe partial tender up to the current remaining due', () => {
  const dialog = sourceBetween('  function openCashierSettlementDialog(', '  function cashierRegister() {');
  assert.match(dialog, /value="\$\{due\}"/);
  assert.match(dialog, /مبلغ این دریافت/);
  assert.match(dialog, /amount <= due/);
  assert.match(dialog, /paymentAmount: values\.amount/);
  assert.match(dialog, /amountTendered: values\.tendered/);
  assert.match(dialog, /کد پیگیری رسید کارت‌خوان/);
  assert.match(dialog, /reference\.length > 0/);
  assert.match(dialog, /وجه نقد دریافتی باید حداقل برابر مبلغ این دریافت باشد/);

  const styles = sourceBetween('  function ensureCashierSettlementStyles() {', '  function cashierPendingMatchesOrder(');
  assert.match(styles, /min-height:56px/);
  assert.match(styles, /font-size:20px/);
  assert.match(styles, /@media \(max-width:620px\)/);
  assert.match(styles, /grid-template-columns:1fr/);
});

test('cashier wallet is hidden for partial or mixed-tender settlement, with readable mobile payment controls', () => {
  assert.equal(cashierWalletSettlementAllowed(0, 10_000, 10_000), true);
  assert.equal(cashierWalletSettlementAllowed(0, 4_000, 10_000), false);
  assert.equal(cashierWalletSettlementAllowed(4_000, 6_000, 6_000), false);

  const payment = sourceBetween('  function openPayment(', '  async function settlePosOrder(');
  assert.match(payment, /const walletAllowed = cashierWalletSettlementAllowed\(paid, charge, outstanding\)/);
  assert.match(payment, /\$\{walletAllowed[\s\S]*?data-pay="wallet"/);
  assert.match(payment, /کیف پول فقط برای تسویهٔ کامل در یک مرحله فعال است/);

  const styles = sourceBetween('  function ensureCashierSettlementStyles() {', '  function cashierPendingMatchesOrder(');
  assert.match(styles, /\.is-cashier-workspace \.payment-sheet[^}]*max-height:calc\(100dvh - 118px\)/);
  assert.match(styles, /\.is-cashier-workspace \.payment-methods > button[^}]*min-height:64px[^}]*font-size:14px/);
  assert.match(styles, /\.is-cashier-workspace \.cash-presets button[^}]*min-height:48px[^}]*font-size:14px/);
  assert.match(styles, /\.is-cashier-workspace \.banknote-chip[^}]*min-height:44px/);
});

test('server amount contract supports sequential partial cash and card tenders without exceeding due', () => {
  const payments = [];
  const production = { environment: () => 'production' };
  let amountPaid = 0;
  const collect = ({ tender, paymentAmount, amountTendered }) => {
    const result = resolveSettlementAmounts({
      total: 10_000,
      amountPaid,
      payments,
      tender,
      paymentAmount,
      amountTendered,
    }, production);
    if (result.ok && result.requestedAmount > 0) {
      payments.push({
        id: `leg-${payments.length + 1}`,
        tender,
        amount: result.requestedAmount,
        ...(tender === 'cash' ? { amountTendered: result.amountTendered } : {}),
      });
      amountPaid += result.requestedAmount;
    }
    return result;
  };

  const cash = collect({ tender: 'cash', paymentAmount: 2_500, amountTendered: 3_000 });
  assert.equal(cash.outstanding, 10_000);
  assert.equal(cash.requestedAmount, 2_500);
  assert.equal(cash.amountTendered - cash.requestedAmount, 500);

  const firstCard = collect({ tender: 'manual_card', paymentAmount: 2_000 });
  assert.equal(firstCard.outstanding, 7_500);
  const finalCard = collect({ tender: 'manual_card', paymentAmount: 5_500 });
  assert.equal(finalCard.outstanding, 5_500);
  assert.equal(amountPaid, 10_000);

  assert.equal(resolveSettlementAmounts({
    total: 10_000,
    amountPaid,
    payments,
    tender: 'cash',
    paymentAmount: 1,
  }, production).requestedAmount, 0);
  assert.equal(resolveSettlementAmounts({
    total: 10_000,
    amountPaid: 9_999,
    payments: [{ tender: 'cash', amount: 9_999 }],
    tender: 'manual_card',
    paymentAmount: 2,
  }, production).error, 'payment_amount_exceeds_due');

  assert.equal(resolveSettlementAmounts({
    total: 10_000, tender: 'cash', paymentAmount: 0,
  }, production).error, 'payment_amount_invalid');
  assert.equal(resolveSettlementAmounts({
    total: 10_000, tender: 'manual_card', paymentAmount: 10_001,
  }, production).error, 'payment_amount_exceeds_due');
  assert.equal(resolveSettlementAmounts({
    total: 10_000, tender: 'cash', paymentAmount: 2_500,
  }, production).requestedAmount, 2_500);

  for (const tender of ['wallet', 'online', 'gateway']) {
    assert.equal(resolveSettlementAmounts({
      total: 10_000, tender, paymentAmount: 2_500,
    }, production).error, 'partial_settlement_not_approved', `${tender} cannot start a cashier split`);
  }
  for (const tender of ['online', 'gateway', 'wallet', undefined]) {
    const payment = { amount: 2_500, ...(tender ? { tender } : {}) };
    assert.equal(resolveSettlementAmounts({
      total: 10_000,
      amountPaid: 2_500,
      payments: [payment],
      tender: 'manual_card',
      paymentAmount: 7_500,
    }, production).error, 'partial_settlement_not_approved', `${tender || 'missing tender'} cannot mix with cashier card`);
  }

  assert.equal(resolveSettlementAmounts({
    total: 10_000, tender: 'wallet',
  }, production).requestedAmount, 10_000, 'a single full wallet payment remains outside the split contract');
});

test('refunds are subtracted once from gross receipts when calculating cashier due', () => {
  const payment = { id: 'deposit-1', tender: 'cash', amount: 500, refundedAmount: 100 };
  const due = resolveSettlementAmounts({
    total: 1_000,
    amountPaid: 400,
    payments: [payment],
    tender: 'manual_card',
  }, { environment: () => 'production' });
  assert.equal(due.alreadyPaid, 400);
  assert.equal(due.outstanding, 600);
  assert.equal(cashierAmounts({ total: 1_000, amountPaid: 400, partialPayments: [payment] }).due, 600);

  const missingProjection = cashierAmounts({ total: 1_000, partialPayments: [payment] });
  assert.equal(missingProjection.paid, 400);
  assert.equal(missingProjection.due, 600);
  const fullRefund = cashierAmounts({
    total: 1_000,
    amountPaid: 0,
    partialPayments: [{ amount: 500, refundedAmount: 500 }],
  });
  assert.equal(fullRefund.paid, 0);
  assert.equal(fullRefund.due, 1_000);
  assert.equal(cashierAmounts({
    total: 1_000,
    partialPayments: [{ amount: 500, refundedAmount: 501 }],
  }).ok, false);
  assert.equal(cashierAmounts({
    total: 1_000,
    amountPaid: 1_000,
    partialPayments: [payment],
  }).ok, false);
});

test('uncertain cashier retries persist and replay the exact same intent and idempotency key', () => {
  const submit = sourceBetween('  async function submitCashierSettlement(', '  function openCashierSettlementDialog(');
  assert.ok(submit.indexOf('persistCashierPendingSettlement(order, pending)') < submit.indexOf('await api('));
  assert.match(submit, /retryPending\?\.idempotencyKey \|\| settlementIdempotencyKey/);
  assert.match(submit, /intent: actorIntent/);
  assert.match(submit, /'Idempotency-Key': idempotencyKey/);
  assert.match(submit, /paymentReference: actorIntent\.tender === 'manual_card' \? String\(actorIntent\.paymentReference \|\| ''\)\.trim\(\) : actorIntent\.paymentReference/);
  assert.match(submit, /if \(error\.outcomeUnknown\)/);
  assert.match(submit, /settlement_response_unverified/);

  const register = sourceBetween('  function cashierRegister() {', '  function cashierHandoff() {');
  assert.match(register, /cashierPendingMatchesOrder\(order, pendingIntent, amounts\)/);
  assert.match(register, /تکرار امن همان درخواست/);
  assert.match(register, /submitCashierSettlement\(order, pendingIntent\.intent, button, pendingIntent\)/);
});

test('manual-card receipts require a reference and cashier never claims the terminal is connected', () => {
  const dialog = sourceBetween('  function openCashierSettlementDialog(', '  function cashierRegister() {');
  assert.match(dialog, /aria-required="true" required/);
  assert.match(dialog, /paymentReference: isCash \? '' : values\.reference/);
  assert.match(dialog, /پس از بررسی موفق دستگاه/);
  assert.match(dialog, /کد پیگیری رسید کارت‌خوان/);
  assert.match(dialog, /confirmButton\.disabled = !\(amountValid && tenderedValid && \(isCash \|\| reference\.length > 0\)\)/);
});

test('partial cash collection defaults cash received to this installment without overwriting an explicit change amount', () => {
  const dialog = sourceBetween('  function openCashierSettlementDialog(', '  function cashierSettlementStageCanSettle(');
  assert.match(dialog, /let cashTenderedEdited = false/);
  assert.match(dialog, /if \(isCash && tenderedInput && !cashTenderedEdited\) tenderedInput\.value = amountInput\.value/);
  assert.match(dialog, /tenderedInput\?\.addEventListener\('input', \(\) => \{ cashTenderedEdited = true; validate\(\); \}\)/);
});
