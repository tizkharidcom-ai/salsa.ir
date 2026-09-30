'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');

const adminSource = fs.readFileSync(path.join(__dirname, '..', 'js/admin.js'), 'utf8');

function loadHelper(name, dependencies = {}) {
  const match = adminSource.match(new RegExp(`  function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n  \\}`));
  assert.ok(match, `expected ${name} helper in js/admin.js`);
  const names = Object.keys(dependencies);
  return new Function(...names, `${match[0]}\nreturn ${name};`)(...names.map((key) => dependencies[key]));
}

function ordersSource() {
  const start = adminSource.indexOf('    async orders() {');
  const end = adminSource.indexOf('\n    async delivery()', start);
  assert.ok(start >= 0 && end > start, 'orders UI source is present');
  return adminSource.slice(start, end);
}

test('delivery rejection requires a trimmed, non-empty reason within the UI limit', () => {
  const buildPayload = loadHelper('adminDeliveryRejectionPayload');
  const validationMessage = loadHelper('adminDeliveryRejectionValidationMessage');
  assert.deepEqual(buildPayload('  محدوده ارسال پوشش داده نمی‌شود  '), { reason: 'محدوده ارسال پوشش داده نمی‌شود' });
  assert.equal(buildPayload(' \n\t '), null);
  assert.equal(buildPayload('x'.repeat(501)), null);
  assert.equal(buildPayload('علت\u0000نامعتبر'), null);
  assert.equal(validationMessage(' \n'), 'علت رد سفارش را بنویسید.');
  assert.match(validationMessage('x'.repeat(501)), /حداکثر ۵۰۰/);
  assert.match(validationMessage('علت\u0000نامعتبر'), /نویسهٔ نامعتبر/);
});

test('rejection retries reuse a persisted idempotency key and never silently change the decision payload', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const dependencies = { currentBranchId: 7, deliveryRejectionKeys: new Map(), sessionStorage: storage };
  const getIntent = loadHelper('adminDeliveryRejectionIntent', dependencies);
  const first = getIntent('42', 'محدوده پوشش داده نمی‌شود');
  assert.equal(first.ok, true);
  assert.match(first.key, /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/);
  assert.equal(values.get(first.storageKey), first.key);
  assert.deepEqual(getIntent('42', 'محدوده پوشش داده نمی‌شود'), first);
  assert.equal(getIntent('42', 'ظرفیت تکمیل است').reasonConflict, true);

  const afterReload = loadHelper('adminDeliveryRejectionIntent', {
    currentBranchId: 7, deliveryRejectionKeys: new Map(), sessionStorage: storage,
  });
  assert.equal(afterReload('42', 'محدوده پوشش داده نمی‌شود').needsStatusCheck, true,
    'a persisted key without its in-memory reason must be reconciled before another POST');

  loadHelper('clearAdminDeliveryRejectionIntent', dependencies)(first.storageKey);
  const next = getIntent('42', 'ظرفیت تکمیل است');
  assert.equal(next.ok, true);
  assert.notEqual(next.key, first.key);
});

test('rejection fails closed when the browser cannot durably persist its idempotency key', () => {
  const getIntent = loadHelper('adminDeliveryRejectionIntent', {
    currentBranchId: 1,
    deliveryRejectionKeys: new Map(),
    sessionStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } },
  });
  assert.equal(getIntent('42', 'محدوده پوشش داده نمی‌شود').storageUnavailable, true);
});

test('rejection is confirmed only by an explicit response for the same order', () => {
  const isConfirmed = loadHelper('adminDeliveryRejectionConfirmed');
  const response = { ok: true, order: { id: '42', deliveryAcceptance: { status: 'rejected' } } };
  assert.equal(isConfirmed(response, 42), true);
  assert.equal(isConfirmed({ ...response, ok: false }, 42), false);
  assert.equal(isConfirmed(response, 43), false);
  assert.equal(isConfirmed({ ok: true, order: { id: '42', deliveryAcceptance: { status: 'accepted' } } }, 42), false);
  assert.equal(isConfirmed({ ok: true, order: { id: '42' } }, 42), false);
});

test('delivery card exposes separate accept/reject actions with branch, order, and required reason context', () => {
  const orders = ordersSource();
  const markupStart = orders.indexOf('const acceptanceMarkup=');
  const markupEnd = orders.indexOf('\n            return `<article', markupStart);
  assert.ok(markupStart >= 0 && markupEnd > markupStart, 'delivery decision markup is present');
  const markup = orders.slice(markupStart, markupEnd);

  assert.match(markup, /شعبه: \$\{esc\(deliveryBranchContext\)\}/);
  assert.match(markup, /سفارش: \$\{esc\(deliveryOrderContext\)\}/);
  assert.match(markup, /data-delivery-accept="\$\{esc\(order\.id\)\}"/);
  assert.match(markup, /data-delivery-reject-open="\$\{esc\(order\.id\)\}"/);
  assert.match(markup, /data-delivery-reject-form="\$\{esc\(order\.id\)\}"/);
  assert.match(markup, /data-delivery-reject-reason rows="3" maxlength="500" required aria-required="true"/);
  assert.match(markup, /وضعیت پرداخت بدون تغییر می‌ماند/);
  assert.doesNotMatch(markup, /بازپرداخت|refund|paymentStatus\s*=/i);
  assert.match(orders, /data-delivery-step="\$\{esc\(deliveryStep\.key\)\}"/);
  assert.match(orders, /گام جاری ارسال/);
});

test('delivery workflow labels distinguish restaurant decision, kitchen, courier handoff, and blocked progression', () => {
  const stepFor = loadHelper('adminDeliveryNextStep');
  assert.equal(stepFor({ fulfillment: 'delivery', status: 'awaiting_confirmation' }).key, 'restaurant-decision');
  assert.equal(stepFor({ fulfillment: 'delivery', status: 'preparing' }).key, 'kitchen');
  assert.equal(stepFor({ fulfillment: 'delivery', status: 'ready', allowedStatusTransitions: ['dispatched'] }).key, 'courier-handoff');
  assert.equal(stepFor({ fulfillment: 'delivery', status: 'ready', allowedStatusTransitions: [] }).key, 'courier-handoff-blocked');
  assert.equal(stepFor({ fulfillment: 'delivery', status: 'dispatched', allowedStatusTransitions: ['delivered'] }).key, 'customer-delivery');
  assert.equal(stepFor({ fulfillment: 'pickup', status: 'ready' }), null);
  const confirmation = loadHelper('adminDeliveryStatusConfirmation');
  assert.match(confirmation(42, 'dispatched'), /تحویل فیزیکی.*به پیک/);
  assert.match(confirmation(42, 'delivered'), /مشتری.*تحویل گرفته/);
  assert.equal(confirmation(42, 'preparing'), '');
});

test('cancelling courier confirmation restores the manual status selector to the current server status', () => {
  const restoreSelection = loadHelper('adminRestoreDeliveryStatusSelection');
  const select = { value: 'dispatched' };
  assert.equal(restoreSelection(select, 'ready'), true);
  assert.equal(select.value, 'ready');
  assert.equal(restoreSelection({}, 'ready'), false);

  const orders = ordersSource();
  const start = orders.indexOf('const runDeliveryCourierStep=async(button,targetStatus)=>');
  const end = orders.indexOf("main.querySelectorAll('[data-onext]')", start);
  const courierStep = orders.slice(start, end);
  assert.match(courierStep, /if\(confirmation&&!window\.confirm\(confirmation\)\)\{\s*if\(button\.matches\('\[data-ostatus\]'\)\)adminRestoreDeliveryStatusSelection\(button,previousStatus\);\s*return;\s*\}/,
    'the cancel path repairs only a manually changed select and does not send a status mutation');
});

test('rejected delivery cards show the server reason as escaped text and never offer acceptance again', () => {
  const acceptanceView = loadHelper('adminDeliveryAcceptanceView');
  const reason = '<img src=x onerror=alert(1)>';
  const rejected = acceptanceView({
    fulfillment: 'delivery',
    status: 'awaiting_confirmation',
    deliveryAcceptance: { status: 'rejected', reason },
  }, true);
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.badge, 'پذیرش رد شده');
  assert.equal(rejected.detail, `علت ثبت‌شده: ${reason} · این سفارش وارد صف آشپزخانه نمی‌شود.`);
  assert.equal(rejected.canAccept, false);

  const orders = ordersSource();
  assert.match(orders, /<p>\$\{esc\(acceptanceView\.detail\)\}<\/p>/,
    'the server-provided reason is HTML-escaped at the render boundary');
  assert.match(orders, /if\(status==='rejected'\)\{[\s\S]*?clearAdminDeliveryRejectionIntent/,
    'confirmed rejection clears the retry intent and leaves the rejection state authoritative');
});

test('reject submits only the reason to the dedicated POST contract and reconciles success or ambiguous outcomes', () => {
  const orders = ordersSource();
  const start = orders.indexOf("main.querySelectorAll('[data-delivery-reject-form]')");
  const end = orders.indexOf("main.querySelectorAll('[data-onext]')", start);
  assert.ok(start >= 0 && end > start, 'rejection form handler is present');
  const handler = orders.slice(start, end);

  assert.match(handler, /adminDeliveryRejectionPayload\(reasonField\?\.value\)/);
  assert.match(handler, /`\/api\/delivery\/orders\/\$\{encodeURIComponent\(orderId\)\}\/reject\$\{branchQs\(\)\}`/);
  assert.match(handler, /method:'POST'/);
  assert.match(handler, /headers:\{'Idempotency-Key':rejectionIntent\.key\}/);
  assert.match(handler, /body:JSON\.stringify\(payload\)/);
  assert.doesNotMatch(handler, /method:'PATCH'|refund|paymentStatus|amountPaid|paymentStatus\s*:/i);

  const request = handler.indexOf('const response=await api(');
  const confirmation = handler.indexOf('if(!adminDeliveryRejectionConfirmed(response,orderId))');
  const confirmed = handler.indexOf('confirmed=true;', confirmation);
  const refresh = handler.indexOf('freshOrders=await tabs.orders()', confirmed);
  assert.ok(request >= 0 && confirmation > request && confirmed > confirmation && refresh > confirmed,
    'the success-path list refresh follows exact response confirmation');
  assert.match(handler, /catch\(error\)\{[\s\S]*?freshOrders=await tabs\.orders\(\)/,
    'an ambiguous network result is reconciled against the server before retry is enabled');
  assert.ok((handler.match(/freshOrders=await tabs\.orders\(\)/g) || []).length >= 2,
    'both explicit success and ambiguous outcomes perform a fresh status read');
});

test('decision actions expose busy state, preserve server errors, and lock ambiguous results against duplicate submission', () => {
  const orders = ordersSource();
  const start = orders.indexOf("main.querySelectorAll('[data-delivery-reject-form]')");
  const end = orders.indexOf("main.querySelectorAll('[data-onext]')", start);
  const handler = orders.slice(start, end);
  assert.match(handler, /submit\.dataset\.busy='1'/);
  assert.match(handler, /submit\.setAttribute\('aria-busy','true'\)/);
  assert.match(handler, /panel\?\.setAttribute\('aria-busy','true'\)/);
  assert.match(handler, /acceptButton\.disabled=true/);
  assert.match(handler, /rejectOpen\.disabled=true/);
  assert.match(handler, /setAcceptanceFeedback\(orderId,`\$\{error\.message\|\|'ثبت رد سفارش انجام نشد\.'\}/);
  assert.match(handler, /lock:true/);
  assert.match(handler, /در حال ثبت رد سفارش و دریافت تأیید از سرور/);
  assert.match(handler, /catch\(error\)\{[\s\S]*?freshOrders=await tabs\.orders\(\)/);
  assert.match(handler, /if\(status==='rejected'\)[\s\S]*?clearAdminDeliveryRejectionIntent/);
  assert.match(handler, /if\(status==='accepted'\)[\s\S]*?برای جلوگیری از تصمیم متناقض/);
});

test('courier handoff and final delivery require explicit confirmation and a fresh server status', () => {
  const orders = ordersSource();
  assert.match(orders, /const runDeliveryCourierStep=async\(button,targetStatus\)=>/);
  assert.match(orders, /if\(confirmation&&!window\.confirm\(confirmation\)\)\{\s*if\(button\.matches\('\[data-ostatus\]'\)\)adminRestoreDeliveryStatusSelection\(button,previousStatus\);\s*return;\s*\}/);
  assert.match(orders, /response\?\.ok!==true\|\|String\(responseOrder\?\.id\)!==String\(orderId\)\|\|String\(responseOrder\?\.status\)!==targetStatus/);
  assert.match(orders, /refreshed=await tabs\.orders\(\)/);
  assert.match(orders, /data-ostatus/);
  assert.match(orders, /dataset\.fulfillment==='delivery'&&\['dispatched','delivered'\]\.includes\(status\)/);
  assert.match(orders, /نتیجهٔ ثبت مرحلهٔ تحویل نامشخص است/);
});
