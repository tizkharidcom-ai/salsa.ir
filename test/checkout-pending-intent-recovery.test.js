'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { TextEncoder } = require('node:util');

const checkoutSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'checkout.js'), 'utf8');
const tableCartSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'table-cart.js'), 'utf8');

function createTableCheckoutSafetyRuntime(controls = []) {
  const helpers = tableCartSource.match(/\/\/ #region table checkout safety helpers\n([\s\S]*?)\n  \/\/ #endregion/);
  assert.ok(helpers, 'table checkout safety helpers must remain an explicit, testable unit');
  const context = {
    Math,
    URL,
    WeakMap,
    toast() {},
    modifierCopy: (persian) => persian,
    window: { location: { href: 'https://westo.test/menu' } },
    location: { href: 'https://westo.test/menu' },
    document: { querySelectorAll: () => controls },
    renderCart() {},
  };
  vm.runInNewContext(`let tableOrderSubmitting = false;\nlet cartRecoveryPending = false;\nconst tableSubmitControlStates = new WeakMap();\n${helpers[1]}\nwindow.__tableCheckoutSafety = {
    tableCheckoutIntentFingerprint,
    normalizeTableCheckoutIntent,
    tableCheckoutIntentDisposition,
    tableCheckoutQuoteNeedsReview,
    tableCheckoutOrderMatchesQuote,
    validateTableOnlinePayment,
    tableCartMutationAllowed,
    setSubmitting: setTableOrderSubmitting,
    setRecoveryPending: (pending) => { cartRecoveryPending = !!pending; },
  };`, context, { filename: 'js/table-cart.js#checkout-safety' });
  return context.window.__tableCheckoutSafety;
}

function createCheckoutIntentRuntime(storage) {
  const document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const window = { document, addEventListener() {} };
  const context = {
    document,
    window,
    location: { search: '' },
    URLSearchParams,
    AbortController,
    Date,
    Math,
    JSON,
    Number,
    String,
    Map,
    Set,
    Array,
    Object,
    RegExp,
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    crypto: webcrypto,
    TextEncoder,
    Uint8Array,
  };
  context.globalThis = context;

  const testSource = checkoutSource.replace(
    /\n  boot\(\);\n\}\)\(\);\s*$/,
    `
  window.__checkoutIntentTestApi = {
    checkoutIntentStorageKey,
    getOrCreateCheckoutIdempotencyKey,
    markCheckoutIntentSubmitted,
    forgetCheckoutIntent,
  };
})();`,
  );
  assert.notEqual(testSource, checkoutSource, 'test harness must suppress automatic checkout boot');
  vm.runInNewContext(testSource, context, { filename: 'js/checkout.js' });
  return window.__checkoutIntentTestApi;
}

test('guest receipt code is secure, reused across browser sessions, and stores only an opaque intent fingerprint', async () => {
  const browserLocalStorage = new Map();
  const firstPage = createCheckoutIntentRuntime(browserLocalStorage);
  const intent = JSON.stringify({
    items: [{ menuItemId: 54, qty: 1, modifiers: [] }],
    branchId: 1,
    fulfillment: 'delivery',
    deliveryAddress: 'خیابان نمونه، پلاک ۱۲',
    deliveryInstructions: 'زنگ واحد ۲',
    name: 'مهمان نمونه',
    phone: '09123456789',
    paymentMethod: 'cashier',
    note: '',
  });
  const storageKey = await firstPage.checkoutIntentStorageKey(intent);
  const originalIdempotencyKey = await firstPage.getOrCreateCheckoutIdempotencyKey(storageKey);
  assert.match(originalIdempotencyKey, /^[a-f0-9]{32}$/);
  assert.equal(firstPage.markCheckoutIntentSubmitted(storageKey, originalIdempotencyKey), undefined);

  // A fresh browser runtime shares only browser-local storage, not the prior JS session.
  const reloadedPage = createCheckoutIntentRuntime(browserLocalStorage);
  assert.equal(
    await reloadedPage.getOrCreateCheckoutIdempotencyKey(await reloadedPage.checkoutIntentStorageKey(intent)),
    originalIdempotencyKey,
    'reconstructing the exact intent after restart must reuse its original receipt code',
  );

  const persistedIntent = browserLocalStorage.get('westo_guest_checkout_receipt_v1');
  assert.ok(persistedIntent);
  for (const sensitiveValue of ['09123456789', 'مهمان نمونه', 'خیابان نمونه', 'واحد ۲']) {
    assert.equal(persistedIntent.includes(sensitiveValue), false, `local storage must not contain ${sensitiveValue}`);
  }
  assert.equal(persistedIntent.includes(originalIdempotencyKey), true, 'the bearer receipt code is retained for recovery');
  assert.equal(JSON.parse(persistedIntent).intents[storageKey].submitted, true, 'ambiguous intent is durably marked submitted before network dispatch');
});

test('table checkout persists only an opaque fingerprint and migrates earlier PII-bearing signatures', () => {
  const api = createTableCheckoutSafetyRuntime();
  const rawSignature = JSON.stringify({ name: 'مهمان حساس', phone: '09123456789', tableNo: '۱۲' });
  const fingerprint = api.tableCheckoutIntentFingerprint(rawSignature);
  assert.match(fingerprint, /^intent-[0-9a-f]{16}$/);
  assert.equal(api.tableCheckoutIntentFingerprint(rawSignature), fingerprint, 'fingerprints are stable across page reloads');
  assert.equal(fingerprint.includes('09123456789'), false);

  const migrated = api.normalizeTableCheckoutIntent({ key: 'table-replay-key', signature: rawSignature });
  assert.deepEqual(JSON.parse(JSON.stringify(migrated)), { key: 'table-replay-key', submitted: true, signature: fingerprint });
  const persisted = JSON.stringify(migrated);
  for (const privateValue of ['مهمان حساس', '09123456789', '۱۲']) assert.equal(persisted.includes(privateValue), false);
});

test('table checkout retries only the same fingerprint and blocks a changed payload after an uncertain attempt', () => {
  const api = createTableCheckoutSafetyRuntime();
  const original = api.tableCheckoutIntentFingerprint(JSON.stringify({ item: 41, qty: 1, phone: '09123456789' }));
  const changed = api.tableCheckoutIntentFingerprint(JSON.stringify({ item: 41, qty: 2, phone: '09123456789' }));
  const pending = { key: 'table-idempotency-key', signature: original };

  assert.equal(api.tableCheckoutIntentDisposition(null, original), 'new');
  assert.equal(api.tableCheckoutIntentDisposition(pending, original), 'retry');
  assert.equal(api.tableCheckoutIntentDisposition(pending, changed), 'unresolved');

  const addItem = tableCartSource.slice(tableCartSource.indexOf('function addItem('), tableCartSource.indexOf('function setQty('));
  const setQty = tableCartSource.slice(tableCartSource.indexOf('function setQty('), tableCartSource.indexOf('function lineDisplayName('));
  assert.match(addItem, /if \(!tableCartMutationAllowed\(\)\) return false;/);
  assert.match(setQty, /if \(!tableCartMutationAllowed\(\)\) return;/);
  assert.match(tableCartSource, /tableOrderSubmitting \? ' disabled aria-disabled="true"'/);
  const submitFlow = tableCartSource.slice(tableCartSource.indexOf("const submitBtn = $('#table-submit-btn')"), tableCartSource.indexOf('function goToCategories()'));
  assert.match(submitFlow, /tableCheckoutIntentFingerprint\(JSON\.stringify\(orderPayload\)\)/);
  assert.match(submitFlow, /tableCheckoutIntentDisposition\(intent, checkoutSignature\) === 'unresolved'/);
  assert.match(submitFlow, /writeTableCheckoutIntent\(checkoutIntentStorageKey, checkoutIntent\)/);
  assert.match(tableCartSource, /JSON\.stringify\(\{ signature: intent\.signature, key: intent\.key, submitted: intent\.submitted !== false \}\)/);
  assert.match(submitFlow, /westo_table_checkout_intent_v2:\$\{encodeURIComponent\(cartBranch \|\| 'unscoped'\)\}:\$\{encodeURIComponent\(cartTable \|\| 'no-table'\)\}/);
  assert.doesNotMatch(submitFlow, /JSON\.stringify\(checkoutIntent\)/, 'persisted recovery state must not contain guest or quote data');
  assert.ok(submitFlow.indexOf('setTableOrderSubmitting(true)') < submitFlow.indexOf("fetch('/api/checkout/quote'"), 'basket lock must be active before the quote await');

  api.setSubmitting(true);
  assert.equal(api.tableCartMutationAllowed(), false);
  api.setSubmitting(false);
  assert.equal(api.tableCartMutationAllowed(), true);

  api.setRecoveryPending(true);
  assert.equal(api.tableCartMutationAllowed(), false, 'unreadable cart recovery must block mutations until a verified backup exists');
});

test('table checkout lock disables add/remove/quantity controls and restores their previous state', () => {
  const makeControl = ({ tagName = 'BUTTON', disabled = false, attrs = {} } = {}) => {
    const attributes = new Map(Object.entries(attrs));
    return {
      tagName,
      disabled,
      getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
      setAttribute(name, value) { attributes.set(name, String(value)); },
      removeAttribute(name) { attributes.delete(name); },
      matches(selector) { return selector === '[data-menu-add]'; },
      attributes,
    };
  };
  const quickAdd = makeControl({ tagName: 'A' });
  const unavailable = makeControl({ disabled: true, attrs: { 'aria-disabled': 'true' } });
  const api = createTableCheckoutSafetyRuntime([quickAdd, unavailable]);

  api.setSubmitting(true);
  assert.equal(quickAdd.disabled, true);
  assert.equal(quickAdd.getAttribute('aria-disabled'), 'true');
  assert.equal(quickAdd.getAttribute('tabindex'), '-1');
  assert.equal(unavailable.disabled, true);
  assert.equal(api.tableCartMutationAllowed(), false);

  api.setSubmitting(false);
  assert.equal(quickAdd.disabled, false);
  assert.equal(quickAdd.getAttribute('aria-disabled'), null);
  assert.equal(quickAdd.getAttribute('tabindex'), null);
  assert.equal(unavailable.disabled, true, 'a control disabled before submit must remain unavailable');
  assert.equal(unavailable.getAttribute('aria-disabled'), 'true');
  assert.equal(api.tableCartMutationAllowed(), true);
});

test('table checkout asks for explicit server-total confirmation and validates online payment evidence', () => {
  const api = createTableCheckoutSafetyRuntime();
  const signature = 'intent-1111222233334444';
  assert.equal(api.tableCheckoutQuoteNeedsReview(null, signature, 1000, 900), true);
  assert.equal(api.tableCheckoutQuoteNeedsReview({ signature, total: 900 }, signature, 1000, 900), false);
  assert.equal(api.tableCheckoutQuoteNeedsReview({ signature, total: 800 }, signature, 1000, 900), true);
  assert.equal(api.tableCheckoutQuoteNeedsReview({ signature: 'intent-other', total: 900 }, signature, 1000, 900), true);

  assert.equal(api.tableCheckoutOrderMatchesQuote(900, 900), true);
  assert.equal(api.tableCheckoutOrderMatchesQuote(901, 900), false);
  assert.equal(api.tableCheckoutOrderMatchesQuote('900', 900), false, 'totals must be exact safe integers, not coerced strings');
  assert.equal(api.tableCheckoutOrderMatchesQuote(Number.MAX_SAFE_INTEGER + 1, 900), false);

  const order = { id: 72, total: 900, paymentStatus: 'pending' };
  const payment = { id: 8, orderId: 72, amount: 900, status: 'pending', provider: 'bank', redirectUrl: 'https://pay.example/session/abc' };
  assert.deepEqual(JSON.parse(JSON.stringify(api.validateTableOnlinePayment(order, payment))), {
    status: 'pending', redirectUrl: 'https://pay.example/session/abc',
  });
  assert.equal(api.validateTableOnlinePayment(order, { ...payment, orderId: 73 }), null);
  assert.equal(api.validateTableOnlinePayment(order, { ...payment, amount: 901 }), null);
  assert.equal(api.validateTableOnlinePayment(order, { ...payment, provider: 'sandbox' }), null);
  assert.equal(api.validateTableOnlinePayment(order, { ...payment, redirectUrl: 'http://pay.example/session/abc' }), null);
  assert.equal(api.validateTableOnlinePayment(order, { ...payment, redirectUrl: 'https://user:pass@pay.example/session/abc' }), null);
  assert.equal(api.validateTableOnlinePayment(order, { ...payment, status: 'paid', redirectUrl: '' }), null, 'order and payment statuses must agree');
  assert.deepEqual(JSON.parse(JSON.stringify(api.validateTableOnlinePayment(
    { id: 72, total: 900, paymentStatus: 'paid' },
    { id: 8, orderId: '72', amount: 900, status: 'paid', provider: 'bank' },
  ))), { status: 'paid', redirectUrl: '' });

  const submitFlow = tableCartSource.slice(tableCartSource.indexOf("const submitBtn = $('#table-submit-btn')"), tableCartSource.indexOf('function goToCategories()'));
  assert.match(submitFlow, /quote\.fulfillment !== 'dine_in'/);
  assert.match(submitFlow, /tableCheckoutQuoteNeedsReview/);
  assert.match(submitFlow, /tableCheckoutOrderMatchesQuote\(acceptedTotal, quote\.total\)/);
  assert.match(submitFlow, /validateTableOnlinePayment\(acceptedOrder, d\.payment\)/);
  assert.ok(submitFlow.indexOf('tableCheckoutOrderMatchesQuote(acceptedTotal, quote.total)') < submitFlow.indexOf('cart = [];'), 'a mismatched accepted amount must preserve the basket and replay key');
  assert.ok(submitFlow.indexOf('validateTableOnlinePayment(acceptedOrder, d.payment)') < submitFlow.indexOf('cart = [];'), 'do not clear an online order basket before payment evidence is checked');
  assert.match(submitFlow, /ادامهٔ پرداخت امن/);
});
