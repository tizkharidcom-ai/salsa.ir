'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/role-panel.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/role-panel.css'), 'utf8');
const apiV2Source = fs.readFileSync(path.join(root, 'server/admin-v2.js'), 'utf8');

function sourceFunction(name) {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`, 'm'));
  assert.ok(match, `missing function: ${name}`);
  return match[0];
}

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing source range: ${startMarker}`);
  return source.slice(start, end);
}

const queueOrders = vm.runInNewContext(`(() => {
  ${sourceFunction('orderPaymentStatus')}
  ${sourceFunction('cashierIntegerAmount')}
  ${sourceFunction('cashierSettlementAmounts')}
  ${sourceFunction('cashierSettlementStageCanSettle')}
  ${sourceFunction('cashierSettlementQueueOrders')}
  return cashierSettlementQueueOrders;
})()`);

test('cashier queue keeps unknown and pending visible, while delivered balances follow operational eligibility', () => {
  const orders = [
    { id: 1, status: 'sent_to_kitchen', paymentStatus: 'unknown', total: 2_000 },
    { id: 2, status: 'pending_online', paymentStatus: 'pending', total: 2_000 },
    { id: 3, status: 'delivered', fulfillment: 'delivery', paymentStatus: 'partial', total: 2_000, amountPaid: 500, partialPayments: [{ amount: 500 }] },
    { id: 4, status: 'delivered', fulfillment: 'pickup', paymentStatus: 'partial', total: 2_000, amountPaid: 500, partialPayments: [{ amount: 500 }] },
    { id: 5, status: 'delivered', fulfillment: 'delivery', paymentStatus: 'paid', total: 2_000, amountPaid: 500 },
    { id: 6, status: 'ready', paymentStatus: 'paid', total: 2_000 },
  ];
  assert.deepEqual(Array.from(queueOrders(orders), (order) => order.id), [1, 2, 3, 4, 5]);

  const stage = sourceFunction('cashierSettlementStageCanSettle');
  const canSettleStage = vm.runInNewContext(`(() => { ${stage}; return cashierSettlementStageCanSettle; })()`);
  assert.equal(canSettleStage(orders[2]), true);
  assert.equal(canSettleStage(orders[3]), false);
  assert.equal(canSettleStage(orders[4]), true);
});

test('cashier Orders navigation opens the register queue and history remains a separate read path', () => {
  const render = sourceBetween('  async function render() {', '  let waiterAudioElement');
  const register = sourceBetween('  function cashierRegister() {', '  async function refreshCashierQueue(');
  const history = sourceBetween('  function cashierOrders() {', '  function cashierTransactionRows(');
  const fetch = sourceBetween('  async function fetchCashier() {', '  function menuModifierGroupsForItem(');
  const ordersRouteStart = apiV2Source.indexOf("app.get('/api/admin/v2/orders'");
  const ordersRouteEnd = apiV2Source.indexOf("app.get('/api/admin/v2/staff'", ordersRouteStart);
  const ordersRoute = apiV2Source.slice(ordersRouteStart, ordersRouteEnd);

  assert.match(render, /state\.activeView === 'orders'\) cashierRegister\(\)/);
  assert.match(register, /نیازمند تطبیق و اقدام امن/);
  assert.match(register, /قابل دریافت طبق مرحلهٔ عملیاتی/);
  assert.match(register, /cashier-history[\s\S]*?cashierOrders/);
  assert.match(register, /cashier-handoff[\s\S]*?cashierHandoff/);
  assert.match(history, /بازگشت به صف صندوق/);
  assert.match(fetch, /api\(`\/api\/admin\/v2\/orders\$\{qs\(\)\}`\)/);
  assert.match(ordersRoute, /branchFilter\(asArray\(db\.orders\), parseBranchId\(req\)\)/);
  assert.match(ordersRoute, /operationalOrderDto\(order, \{ includePii, includePaymentReferences, includeDeliveryReason \}\)/);
  assert.doesNotMatch(ordersRoute, /paymentStatus\s*===|filter\([^\n]*paymentStatus/);
  assert.match(sourceFunction('refreshCashierQueue'), /await fetchCashier\(\)/);
  assert.doesNotMatch(sourceFunction('refreshCashierQueue'), /api\(/);
});

test('unknown and pending are collection-blocked; a locally ambiguous write can only replay the identical intent', () => {
  const register = sourceBetween('  function cashierRegister() {', '  async function refreshCashierQueue(');
  const submit = sourceBetween('  async function submitCashierSettlement(', '  function openCashierSettlementDialog(');
  const posSettle = sourceBetween('  async function settlePosOrder(', '  function openReceipt(');
  const posCheck = sourceBetween('  function posCheckMarkup() {', '  function posInvoiceRows(');
  const openPayment = sourceBetween('  function openPayment(', '  async function settlePosOrder(');

  assert.match(register, /\['pending', 'unknown'\]\.includes\(paymentStatus\)[\s\S]*?تا دریافت وضعیت معتبر، دریافت دوباره مجاز نیست/);
  assert.match(register, /استعلام خودکار درگاه در این نسخه فعال نیست/);
  assert.match(register, /مشاهدهٔ پرداخت‌های نامشخص/);
  assert.match(register, /\['failed', 'cancelled', 'refunded'\]\.includes\(paymentStatus\)[\s\S]*?صندوق دریافت تازه را ثبت نمی‌کند/);
  assert.match(register, /data-cashier-retry-pending/);
  assert.match(register, /submitCashierSettlement\(order, pendingIntent\.intent, button, pendingIntent\)/);
  assert.match(submit, /!\['unpaid', 'partial'\]\.includes\(orderPaymentStatus\(order\)\)/);
  assert.ok(submit.indexOf('persistCashierPendingSettlement(order, pending)') < submit.indexOf('await api('));
  assert.match(submit, /retryPending\?\.idempotencyKey \|\| settlementIdempotencyKey/);
  assert.match(submit, /'Idempotency-Key': idempotencyKey/);
  assert.match(submit, /options\.showQueueOnUnknown[\s\S]*?state\.activeView = 'orders'/);
  assert.match(posSettle, /return submitCashierSettlement\(order, intent, button, null/);
  assert.doesNotMatch(posSettle, /await api\(/);
  assert.match(posCheck, /const paymentNeedsReview = !\['unpaid', 'partial'\]\.includes\(paymentStatus\)/);
  assert.match(posCheck, /lines\.length && !paymentNeedsReview \? '' : 'disabled'/);
  assert.match(openPayment, /!\['unpaid', 'partial'\]\.includes\(orderPaymentStatus\(order\)\)/);
});

test('cashier queue cards and controls remain readable and touch-safe on narrow screens', () => {
  assert.match(css, /\.order-actions button \{ min-height: 44px; \}/);
  assert.match(css, /\.cashier-register-head-actions button \{[^}]*min-height: 48px/);
  assert.match(css, /\.order-actions button \{ width: 100%; min-height: 48px; \}/);
  assert.match(css, /\.order-card__items \{ font-size: 15px; line-height: 1\.75; \}/);
  assert.match(css, /\.order-card__items \{ color: var\(--rp-ink\); \}/);
  assert.match(css, /html\[data-theme='dark'\] \.is-cashier-workspace \.role-inline-warning/);
});
