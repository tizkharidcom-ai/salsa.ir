'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { TextEncoder } = require('node:util');

const checkoutSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'checkout.js'), 'utf8');
const orderHtml = fs.readFileSync(path.join(__dirname, '..', 'order.html'), 'utf8');

test('order page cache-busts the staged checkout and idempotent recovery runtime', () => {
  assert.match(orderHtml, /js\/checkout\.js\?v=guest-receipt-rejected-status-v1-20260924/);
  for (const id of ['checkout-receipt-code-box', 'checkout-receipt-code-copy', 'checkout-success-receipt-code', 'checkout-recovery-form']) {
    assert.match(orderHtml, new RegExp(`id="${id}"`), `receipt recovery UI must include ${id}`);
  }
});

function createCheckoutRuntime({ fetchImpl, sessionStorage, cryptoImpl = webcrypto, navigatorImpl = {} } = {}) {
  const elements = new Map();
  const memory = new Map();
  const storage = sessionStorage || {
    getItem(key) { return memory.get(key) || null; },
    setItem(key, value) { memory.set(key, String(value)); },
    removeItem(key) { memory.delete(key); },
  };
  const makeElement = (id = '') => ({
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    hidden: false,
    disabled: false,
    checked: false,
    dataset: {},
    attributes: new Map(),
    controls: [],
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) || null; },
    hasAttribute(name) { return this.attributes.has(name); },
    removeAttribute(name) { this.attributes.delete(name); },
    querySelectorAll() { return this.controls; },
    querySelector() { return null; },
    closest(selector) { return selector === 'label' ? this.label || null : null; },
    focus() { this.focused = true; },
    scrollIntoView() {},
    appendChild(child) { this.children ||= []; this.children.push(child); child.parentElement = this; },
    remove() { this.removed = true; },
  });
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };
  const fulfillment = { value: 'dine_in' };
  const document = {
    title: '',
    activeElement: null,
    body: makeElement('body'),
    getElementById: getElement,
    querySelector(selector) {
      if (selector === 'input[name="fulfillment"]:checked') return fulfillment;
      if (selector === '.checkout-side') return getElement('checkout-side');
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener() {},
    createElement(tagName) { const element = makeElement(); element.tagName = tagName; return element; },
  };
  const window = {
    document,
    westoI18n: { lang: 'fa', t: (key) => key, itemName: (item) => item?.name || '' },
    setTimeout: () => 1,
    clearTimeout() {},
    addEventListener() {},
    matchMedia: () => ({ matches: true }),
  };
  const context = {
    document,
    window,
    location: { search: '', href: 'https://westo.test/order', origin: 'https://westo.test' },
    URL,
    URLSearchParams,
    requestAnimationFrame: (callback) => callback(),
    AbortController,
    DOMException,
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
    localStorage: storage,
    sessionStorage: storage,
    crypto: cryptoImpl,
    TextEncoder,
    Uint8Array,
    navigator: navigatorImpl,
    fetch: fetchImpl || (async () => { throw new Error('unexpected network request'); }),
  };
  context.globalThis = context;
  const testSource = checkoutSource.replace(
    /\n  boot\(\);\n\}\)\(\);\s*$/,
    `
  window.__checkoutStageRecoveryTestApi = {
    state, addToCart, advanceCheckoutStage, showCheckoutStage, submit,
    currentQuoteSignature, checkoutIntentStorageKey,
    getOrCreateCheckoutIdempotencyKey, storedCheckoutIntents,
    checkoutErrorMessage, checkoutOutcomeMayBeUnknown,
    prepareCheckoutReceiptCode, markCheckoutIntentSubmitted,
    recoverCheckoutByReceiptCode, copyCheckoutReceiptCode,
    showSuccess, recoveryOrderProjection,
  };
})();`,
  );
  assert.notEqual(testSource, checkoutSource, 'test harness must suppress automatic checkout boot');
  vm.runInNewContext(testSource, context, { filename: 'js/checkout.js' });
  return { api: window.__checkoutStageRecoveryTestApi, getElement, memory, fulfillment };
}

function prepareReviewCheckout(runtime) {
  const { api, getElement, fulfillment } = runtime;
  api.state.currentStage = 'review';
  api.state.branchId = 4;
  api.state.itemById.set(41, { id: 41, name: 'غذای مهمان', price: 1200, modifierGroups: [] });
  api.state.cart.set('41::[]', { menuItemId: 41, qty: 1, modifiers: [] });
  api.state.quote = {
    ok: true,
    quoteToken: 'quote-token-one',
    fulfillment: 'dine_in',
    subtotal: 1200,
    deliveryFee: 0,
    discount: 0,
    tierDiscountToman: 0,
    pointsDiscountToman: 0,
    total: 1200,
  };
  getElement('checkout-branch').value = '4';
  getElement('checkout-table').value = '12';
  getElement('checkout-name').value = 'مهمان آزمایشی';
  getElement('checkout-phone').value = '09123456789';
  getElement('checkout-payment').value = 'cashier';
  fulfillment.value = 'dine_in';
  api.state.quoteSignature = api.currentQuoteSignature();
  const controls = [
    getElement('checkout-name'),
    getElement('checkout-phone'),
    getElement('checkout-branch'),
    getElement('checkout-submit'),
  ];
  getElement('checkout-form').controls = controls;
  return controls;
}

test('checkout advances only after the active stage is valid and exposes focused accessible errors', () => {
  const runtime = createCheckoutRuntime();
  const { api, getElement } = runtime;
  api.state.branchId = 4;
  api.state.cart.set('empty-line', { menuItemId: 41, qty: 1, modifiers: [] });
  api.state.itemById.set(41, { id: 41, name: 'غذا', price: 1000 });
  getElement('checkout-branch').value = '4';

  assert.equal(api.advanceCheckoutStage(), true, 'valid basket advances to fulfillment');
  assert.equal(api.state.currentStage, 'fulfillment');
  assert.equal(getElement('checkout-panel-fulfillment').hidden, false);
  assert.equal(getElement('checkout-step-label-fulfillment').getAttribute('aria-current'), 'step');

  assert.equal(api.advanceCheckoutStage(), false, 'missing table blocks progression');
  assert.equal(api.state.currentStage, 'fulfillment');
  assert.equal(getElement('checkout-table').getAttribute('aria-invalid'), 'true');
  assert.match(getElement('checkout-message').textContent, /شماره میز را وارد کنید/);
  assert.equal(getElement('checkout-message').getAttribute('role'), 'alert');
  assert.equal(getElement('checkout-table').focused, true);

  getElement('checkout-table').value = '12';
  assert.equal(api.advanceCheckoutStage(), true);
  assert.equal(api.state.currentStage, 'customer');
});

test('adding the first item clears the stale empty-cart validation state', () => {
  const runtime = createCheckoutRuntime();
  const { api, getElement } = runtime;
  const cart = getElement('checkout-cart');
  api.state.itemById.set(41, { id: 41, name: 'غذای مهمان', price: 1200, modifierGroups: [] });

  assert.equal(api.advanceCheckoutStage(), false, 'an empty basket must block the next stage');
  assert.equal(cart.getAttribute('aria-invalid'), 'true');
  assert.equal(getElement('checkout-message').getAttribute('data-validation-field'), 'checkout-cart');

  assert.equal(api.addToCart(41, []), true, 'the guest can recover by adding an item');
  assert.equal(cart.getAttribute('aria-invalid'), null, 'the now-valid basket must not remain marked invalid');
  assert.equal(getElement('checkout-message').getAttribute('data-validation-field'), null);
  assert.equal(api.state.cart.size, 1);
});

test('ambiguous checkout retry preserves saved key and exact request, and does not unlock a second order', async () => {
  const requests = [];
  const copied = [];
  let runtime;
  const fetchImpl = async (url, options) => {
    const persisted = runtime.memory.get('westo_guest_checkout_receipt_v1');
    assert.ok(persisted, 'the receipt code and intent digest must be saved before the request leaves the browser');
    const record = Object.values(JSON.parse(persisted).intents)[0];
    assert.equal(record.submitted, true, 'mark the exact intent submitted before dispatch');
    requests.push({ url, key: options.headers['Idempotency-Key'], body: options.body });
    if (requests.length === 1) throw new TypeError('network connection lost after dispatch');
    return {
      ok: true,
      json: async () => ({ ok: true, order: { id: 77, total: 1200, status: 'pending', paymentStatus: 'unpaid', fulfillment: 'dine_in', tableNo: '12' } }),
    };
  };
  runtime = createCheckoutRuntime({ fetchImpl, navigatorImpl: { clipboard: { writeText: async (value) => copied.push(value) } } });
  const controls = prepareReviewCheckout(runtime);
  const { api, getElement, memory } = runtime;
  const submitEvent = { preventDefault() {} };

  const displayedCode = await api.prepareCheckoutReceiptCode();
  assert.match(displayedCode, /^[a-f0-9]{32}$/);
  assert.equal(getElement('checkout-receipt-code-box').hidden, false, 'receipt code is visible on the review stage before submit');
  assert.equal(getElement('checkout-receipt-code').textContent, displayedCode.match(/.{1,8}/g).join('-'));
  assert.equal(JSON.parse(memory.get('westo_guest_checkout_receipt_v1')).intents[api.state.receiptStorageKey].submitted, false);
  assert.equal(await api.copyCheckoutReceiptCode(displayedCode, 'checkout-receipt-code-status'), true);
  assert.equal(copied[0], displayedCode.match(/.{1,8}/g).join('-'), 'review code can be copied before submission');

  await api.submit(submitEvent);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].key, displayedCode, 'the actual submit path sends the code displayed before submit');
  assert.ok(api.state.uncertainIntent, 'the outcome-unknown state remains locked for recovery');
  assert.equal(getElement('checkout-form').getAttribute('data-checkout-outcome'), 'unknown');
  assert.equal(getElement('checkout-message').getAttribute('role'), 'alert');
  assert.equal(controls[0].disabled, true, 'guest details stay frozen while the result is uncertain');
  assert.equal(controls[3].disabled, false, 'the same-intent retry remains actionable');

  const persisted = JSON.parse(memory.get('westo_guest_checkout_receipt_v1'));
  const persistedIntent = Object.values(persisted.intents)[0];
  assert.equal(persistedIntent.code, requests[0].key);
  assert.equal(persistedIntent.submitted, true);
  assert.equal(memory.get('westo_guest_checkout_receipt_v1').includes('09123456789'), false, 'recovery storage must not persist phone data');
  assert.equal(memory.get('westo_guest_checkout_receipt_v1').includes('مهمان آزمایشی'), false, 'recovery storage must not persist guest identity');
  assert.equal(memory.get('westo_guest_checkout_receipt_v1').includes('quote-token-one'), false, 'recovery storage must not persist quote tokens');

  await api.submit(submitEvent);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].key, requests[0].key, 'a retry must reuse the original idempotency key');
  assert.equal(requests[1].body, requests[0].body, 'a retry must replay the exact original payload');
  assert.equal(api.state.checkoutComplete, true);
  assert.equal(api.state.uncertainIntent, null);
  assert.equal(getElement('checkout-success-receipt-code').hidden, false);
  assert.equal(getElement('checkout-success-receipt-code-value').textContent, displayedCode.match(/.{1,8}/g).join('-'));
  assert.equal(memory.has('westo_guest_checkout_receipt_v1'), false, 'the pending marker is cleared only after confirmed success');
});

test('a fresh checkout runtime recovers a minimal order using only the receipt code', async () => {
  const code = '0123456789abcdef0123456789abcdef';
  const requests = [];
  const runtime = createCheckoutRuntime({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({ ok: true, order: {
          id: 91, orderNo: 'W-91', total: 2400, status: 'awaiting_confirmation',
          paymentStatus: 'unpaid', fulfillment: 'pickup',
          name: 'PII must not render', phone: '09123456789', address: 'PRIVATE',
          notes: 'PRIVATE', paymentReference: 'PRIVATE',
        } }),
      };
    },
  });
  runtime.getElement('checkout-recovery-code-input').value = code.match(/.{1,8}/g).join('-');
  assert.equal(await runtime.api.recoverCheckoutByReceiptCode({ preventDefault() {} }), true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/checkout/recovery');
  assert.deepEqual(JSON.parse(requests[0].options.body), { receiptCode: code });
  assert.equal(runtime.getElement('checkout-success-receipt-code-value').textContent, code.match(/.{1,8}/g).join('-'));
  assert.equal(runtime.getElement('checkout-success-receipt-code').hidden, false);
  assert.doesNotMatch(runtime.getElement('checkout-success-body').textContent, /PII must not render|09123456789|PRIVATE/);
});

test('checkout does not send when the browser cannot durably read or save its idempotency key', async (t) => {
  for (const failure of ['read', 'write']) {
    await t.test(failure, async () => {
      let requestCount = 0;
      const storage = {
        getItem() {
          if (failure === 'read') throw new Error('storage denied');
          return null;
        },
        setItem() { throw new Error('storage quota denied'); },
        removeItem() {},
      };
      const runtime = createCheckoutRuntime({
        sessionStorage: storage,
        fetchImpl: async () => { requestCount += 1; throw new Error('must not submit'); },
      });
      prepareReviewCheckout(runtime);
      await runtime.api.submit({ preventDefault() {} });

      assert.equal(requestCount, 0, 'fail closed before posting the order');
      assert.equal(runtime.api.state.idempotencyKey, '');
      assert.equal(runtime.api.state.submitting, false);
      assert.match(runtime.getElement('checkout-message').textContent, /سفارش ارسال نشد/);
      assert.equal(runtime.getElement('checkout-message').getAttribute('role'), 'alert');
    });
  }
});

test('checkout fails closed without cryptographic randomness', async () => {
  let requestCount = 0;
  const runtime = createCheckoutRuntime({
    cryptoImpl: { subtle: webcrypto.subtle },
    fetchImpl: async () => { requestCount += 1; throw new Error('must not submit'); },
  });
  prepareReviewCheckout(runtime);
  await runtime.api.submit({ preventDefault() {} });
  assert.equal(requestCount, 0);
  assert.match(runtime.getElement('checkout-message').textContent, /کد امن/);
});

test('machine-readable server errors are translated into actionable guest copy', () => {
  const { api } = createCheckoutRuntime();
  const message = api.checkoutErrorMessage(Object.assign(new Error('unknown_checkout_guard'), { code: 'unknown_checkout_guard', status: 400 }));
  assert.match(message, /اطلاعات را دوباره بررسی کنید/);
  assert.doesNotMatch(message, /unknown_checkout_guard/);

  const storageFailure = api.checkoutErrorMessage(Object.assign(new Error('checkout_intent_storage_unavailable'), { code: 'checkout_intent_storage_unavailable' }));
  assert.match(storageFailure, /سفارش ارسال نشد/);
  assert.equal(api.checkoutOutcomeMayBeUnknown(Object.assign(new Error('checkout_intent_storage_unavailable'), { code: 'checkout_intent_storage_unavailable' })), false);
});
