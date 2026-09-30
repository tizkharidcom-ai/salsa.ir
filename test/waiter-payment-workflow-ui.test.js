'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../js/role-panel.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '../css/waiter-floor-plan.css'), 'utf8');
const roleHtml = fs.readFileSync(path.join(__dirname, '../role-panel.html'), 'utf8');
const markup = source.slice(source.indexOf('function waiterWorkflowMarkup(wt)'), source.indexOf('function waiterCallsForTable'));
const paintCheck = source.slice(source.indexOf('function paintTerminalCheck(container)'), source.indexOf('function paintTerminalActions(container)'));
const paymentHandler = source.slice(source.indexOf('function payWaiterCheck()'), source.indexOf('function ' , source.indexOf('function payWaiterCheck()') + 10));

test('waiter order progress uses the canonical staged payment workflow and flags reconciliation', () => {
  assert.match(roleHtml, /js\/order-payment-state\.js\?v=payment-state4-order-journey/);
  assert.match(markup, /deriveOrderPaymentWorkflow\(order\)/);
  assert.match(markup, /paymentWorkflow\?\.settled === true/);
  assert.match(markup, /paymentWorkflow\?\.requiresReconciliation === true/);
  assert.match(markup, /blocked: needsReconciliation \|\| paymentNeedsRefresh \|\| paymentIntentConflict/);
  assert.match(markup, /برای جلوگیری از دریافت تکراری، ثبت وجه متوقف است/);
  assert.match(markup, /role="alert"[^>]*>تسویه تا بررسی و تطبیق اطلاعات مالی غیرفعال است/);
});

test('waiter terminal only enables collection for a consistent order with a payable balance', () => {
  assert.match(paintCheck, /paymentWorkflow\?\.isConsistent === true/);
  assert.match(paintCheck, /settlementStage\?\.state === 'current'/);
  assert.match(paintCheck, /Number\.isFinite\(amountDue\) && amountDue > 0/);
  assert.match(paintCheck, /canCollectPayment && !wt\.paymentNeedsRefresh/);
  assert.match(paintCheck, /id="wt-refresh-payment-status"/);
});

test('waiter uncertain order writes are visibly locked and expose exact create replay versus manager review', () => {
  assert.match(paintCheck, /wt\.orderSubmissionConflict[\s\S]*?role="alert"[^>]*>نتیجهٔ ثبت سفارش با وضعیت فعلی قابل تطبیق نیست/);
  assert.match(paintCheck, /wt\.pendingOrderSubmission && wt\.orderSaveNeedsRefresh[\s\S]*?id="wt-retry-order-submission"/);
  assert.match(paintCheck, /فقط همان اقلام و همان کلید یکتا ارسال می‌شود/);
  assert.match(source, /getElementById\('wt-retry-order-submission'\)\?\.addEventListener\('click', \(\) => saveAndSendTerminalOrder\(false\)\)/);
  assert.match(source, /const orderSubmissionLocked = waiterTerminalMutationLocked\(wt\)/);
  assert.match(source, /setAttribute\('aria-busy', 'true'\)/);
});

test('waiter invoice explains item subtotal and discounts, and the sticky action shows only the remaining balance', () => {
  assert.match(paintCheck, /class="wt-invoice-breakdown" aria-label="جزئیات مبلغ فاکتور"/);
  assert.match(paintCheck, /جمع اقلام/);
  assert.match(paintCheck, /class="is-discount"/);
  assert.match(paintCheck, /مبلغ نهایی/);
  assert.match(paintCheck, /amountPaid > 0 && amountDue > 0 \? amountDue : total/);
  assert.match(styles, /\.wt-invoice-breakdown\s*\{[^}]*font-size:\s*14px/s);
  assert.match(styles, /\.wt-invoice-breakdown \.is-total\s*\{[^}]*font-size:\s*16px/s);
});

test('waiter collection revalidates payment evidence before opening and after settlement', () => {
  assert.match(paymentHandler, /paymentWorkflow\.requiresReconciliation/);
  assert.match(paymentHandler, /paymentWorkflow\.settled/);
  assert.match(paymentHandler, /updatedWorkflow\.settled/);
  assert.match(paymentHandler, /updatedWorkflow\.requiresReconciliation/);
});

test('waiter order-list handoff opens the guarded invoice flow instead of bypassing reconciliation', () => {
  const ordersPage = source.slice(source.indexOf('function waiterOrders()'), source.indexOf('function openUnmappedOrderTableAssignment'));
  assert.match(ordersPage, /data-serve\b[^>]*>[\s\S]*?بررسی و تحویل/);
  assert.match(ordersPage, /main\.querySelectorAll\('\[data-serve\]'\)[\s\S]*?openWaiterTerminal\(order\.tableNo, \{ selectedOrderId: orderId \}\)/);
  assert.doesNotMatch(ordersPage, /data-serve[\s\S]*?api\(`\/api\/waiter\/orders/);
});

test('waiter split blocks stale local line indices and persists the idempotent intent before POST', () => {
  const splitFlow = source.slice(source.indexOf('async function submitWaiterSplit'), source.indexOf('function splitOrderCheck'));
  const splitActions = source.slice(source.indexOf('function paintTerminalActions'), source.indexOf('async function submitWaiterSplit'));
  assert.match(splitActions, /splitBlockedByDraft = Boolean\(wt\.dirty \|\| wt\.remoteUpdatePending \|\| wt\.lines\.some\(\(line\) => !line\.localSaved\)\)/);
  assert.match(splitActions, /const canSplitOrder = waiterHasCapability\('orders\.split'\) && Boolean\(wt\.order\?\.id\)[\s\S]*?!orderSubmissionLocked && !splitBlockedByDraft/);
  assert.match(splitActions, /id="act-split-check" \$\{canSplitOrder \? '' : 'disabled aria-disabled="true"'\}/);
  const persist = splitFlow.indexOf('if (!persistWaiterTerminalDraft(wt))');
  const post = splitFlow.indexOf("api(`/api/waiter/orders/${pending.orderId}/split`");
  assert.ok(persist >= 0 && post > persist, 'persist exact split intent before the server can mutate the invoice');
  assert.match(splitFlow, /idempotencyKey: `waiter-split-\$\{splitNonce\}`/);
  assert.match(splitFlow, /headers: \{ 'Idempotency-Key': pending\.idempotencyKey \}/);
  assert.match(splitFlow, /if \(error\.outcomeUnknown\) \{[\s\S]*?wt\.splitNeedsRefresh = true/);
  assert.match(splitFlow, /نتیجهٔ تفکیک نامشخص است؛ درخواست دوباره ارسال نمی‌شود/);
  assert.match(splitFlow, /wt\.pendingSplit = null;\s*wt\.splitNeedsRefresh = false;/);
  assert.match(source, /pendingSplit: wt\.pendingSplit \? JSON\.parse\(JSON\.stringify\(wt\.pendingSplit\)\) : null/);
  assert.match(source, /hasProtectedOrderSubmission = Boolean\(draft\.pendingOrderSubmission \|\| draft\.pendingSplit/);
  assert.match(source, /if \(wt\.pendingSplit \|\| wt\.splitNeedsRefresh\) \{[\s\S]*?بارگذاری نسخهٔ تازه، نتیجهٔ تفکیک را تطبیق نمی‌دهد/);
});

test('waiter settlement requires server payment evidence and locks uncertain outcomes for refresh', () => {
  assert.match(paymentHandler, /Number\(responseOrder\.id\) === Number\(wt\.order\.id\)/);
  assert.match(paymentHandler, /result\.payment && Number\.isFinite\(paymentAmount\)/);
  assert.match(paymentHandler, /String\(result\.payment\.idempotencyKey \|\| ''\) === String\(idempotencyKey\)/);
  assert.match(paymentHandler, /settlement_response_unverified/);
  assert.match(paymentHandler, /wt\.paymentNeedsRefresh = true/);
  assert.match(paymentHandler, /wt\.pendingPayment = null/);
  assert.doesNotMatch(paymentHandler, /confirmsAlreadySettled/);
  assert.match(paymentHandler, /clearSettlementIdempotencyKey\(idempotencyKey, intent\);\s*wt\.pendingPayment = null;\s*wt\.paymentNeedsRefresh = false;\s*clearWaiterTerminalDraft\(wt\.table\.id\)/);
});

test('manual card cashier dialog requires a receipt reference before enabling settlement', () => {
  assert.match(roleHtml, /role-panel\.js\?v=ops-role-v4-waiter-cashier-recovery/);
  const dialog = source.slice(source.indexOf('function openManualCardReference'), source.indexOf('function openDialog', source.indexOf('function openManualCardReference')));
  assert.match(dialog, /aria-required="true" required/);
  assert.match(dialog, /id="settlement-card-confirm" disabled/);
  assert.match(dialog, /updateReferenceValidity = \(\) => \{[\s\S]*?confirmButton\.disabled = !String\(referenceInput\?\.value \|\| ''\)\.trim\(\)/);
  assert.match(dialog, /if \(!reference\)[\s\S]*?کد پیگیری رسید کارت‌خوان را وارد کنید/);
});

test('waiter uncertain settlement refresh retains the original idempotent intent when no receipt is visible', () => {
  const refreshHandler = source.slice(source.indexOf('async function refreshWaiterPaymentState'), source.indexOf('async function fireCourse'));
  assert.match(refreshHandler, /await fetchWaiter\(\)/);
  assert.match(refreshHandler, /workflow\.amounts\.paid > previousPaid/);
  assert.match(refreshHandler, /matchingReceipt/);
  assert.match(refreshHandler, /clearWaiterTerminalDraft\(wt\.table\.id\)/);
  assert.match(refreshHandler, /Retain the original idempotency key and/);
  assert.match(refreshHandler, / همان درخواست یکتا/);
});
