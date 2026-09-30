'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { TextEncoder } = require('node:util');
const {
  createCheckoutQuoteToken,
  verifyCheckoutQuoteToken,
  validateCheckoutQuoteIntent,
} = require('../server/checkout-quote');
const { calculateModifierLinePrice } = require('../server/menu-modifiers');
const { quoteFulfillment } = require('../server/command-center');
const loyaltyEngine = require('../server/finance/loyalty-engine');
const taxEngine = require('../server/finance/tax-engine');

const checkoutSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'checkout.js'), 'utf8');
const checkoutCss = fs.readFileSync(path.join(__dirname, '..', 'css', 'checkout.css'), 'utf8');
const orderHtml = fs.readFileSync(path.join(__dirname, '..', 'order.html'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

function createCheckoutRuntime({ fetchImpl, initialFulfillment = 'dine_in' } = {}) {
  const elements = new Map();
  const storage = new Map();
  const timers = new Map();
  let timerId = 0;
  let fulfillment = initialFulfillment;
  const makeElement = (id = '') => ({
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    style: {},
    hidden: false,
    disabled: false,
    checked: false,
    dataset: {},
    attributes: new Map(),
    listeners: new Map(),
    isConnected: true,
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    },
    querySelector() { return null; },
    querySelectorAll() { return this.controls || []; },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) || null; },
    removeAttribute(name) { this.attributes.delete(name); },
    focus() { this.focused = true; document.activeElement = this; },
    scrollIntoView(options) { this.scrollOptions = options; },
    appendChild(child) { this.children ||= []; this.children.push(child); },
    replaceChildren(...children) {
      this.children = children;
      this.innerHTML = '';
      children.forEach((child) => { child.parentElement = this; });
    },
  });
  const getElement = (id) => {
    if (!elements.has(id)) {
      elements.set(id, makeElement(id));
    }
    return elements.get(id);
  };
  const body = makeElement('body');
  body.appendChild = (child) => {
    body.children ||= [];
    body.children.push(child);
    if (child.id) elements.set(child.id, child);
  };
  const document = {
      title: '',
    activeElement: null,
    body,
    getElementById: (id) => {
      if (String(id).startsWith('#')) return null;
      return id === 'checkout-mobile-cart' ? elements.get(id) || null : getElement(id);
    },
    querySelector(selector) {
      if (selector === 'input[name="fulfillment"]:checked') return { value: fulfillment };
      if (selector === '.checkout-side') return getElement('checkout-side');
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener() {},
    createElement(tagName) { const element = makeElement(); element.tagName = tagName; return element; },
  };
  const window = {
    westoI18n: {
      lang: 'fa',
      t: (key) => key,
      itemName: (item) => item?.name || '',
      itemDesc: (item) => item?.desc || '',
      catTitle: (category) => category?.title || '',
      pickLocalized: (value) => value?.name || '',
    },
    setTimeout: (callback) => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
    addEventListener() {},
    matchMedia: () => ({ matches: false }),
  };
  const rawFetch = fetchImpl || (async () => { throw new Error('network disabled in checkout unit tests'); });
  const fetchForRuntime = (...args) => rawFetch(...args);
  const context = {
    document,
    window,
    location: { search: '', href: 'https://westo.test/order', origin: 'https://westo.test' },
    URL,
    URLSearchParams,
    requestAnimationFrame: (callback) => callback(),
    AbortController,
    DOMException,
    console,
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
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    crypto: webcrypto,
    TextEncoder,
    Uint8Array,
    fetch: fetchForRuntime,
  };
  context.globalThis = context;
  window.document = document;

  const testSource = checkoutSource.replace(
    /\n  boot\(\);\n\}\)\(\);\s*$/,
    `
  window.__checkoutTestApi = {
    state, modifierGroupsForItem, requiredModifierGroups, validateModifiers,
    modifierDialogMarkup, addToCart, restoreReorderItems, submitModifierDialog, lineItems, cartLines, estimateVisiblePrices,
    quotePriceSnapshot, quotePriceChanges, applyQuote, acceptQuoteChange,
    renderTotals, currentQuoteSignature, openModifierDialog, validateGuestCheckout, adjust,
    validateCheckoutQuote, renderCheckoutRecoveryNotice,
    reportGuestCheckoutError, ensureMobileCartShortcut, syncMobileCartShortcut,
    getOrCreateCheckoutIdempotencyKey, checkoutIntentStorageKey, markCheckoutIntentSubmitted,
    prepareCheckoutReceiptCode,
    checkoutOnlineAvailable, loadCheckoutMeta,
    initCheckoutAddressModal, renderCheckoutAddresses, submit, refreshQuote, boot, bindListeners,
    currentQuoteSignature, showCheckoutStage, advanceCheckoutStage, goToPreviousCheckoutStage,
    validateCheckoutStage, renderCheckoutReview, checkoutStageForField, showSuccess
  };
})();`,
  );
  assert.notEqual(testSource, checkoutSource, 'test harness must suppress automatic boot');
  vm.runInNewContext(testSource, context, { filename: 'js/checkout.js' });
  return {
    api: window.__checkoutTestApi,
    getElement,
    storage,
    setFulfillment: (value) => { fulfillment = value; },
    async runNextTimer() {
      const entry = timers.entries().next().value;
      if (!entry) return false;
      const [id, callback] = entry;
      timers.delete(id);
      await callback();
      return true;
    },
  };
}

function sampleItem() {
  return {
    id: 41,
    name: 'غذای آزمایشی',
    price: 250000,
    modifierGroups: [
      {
        id: 'size', title: 'اندازه', selection: 'single', required: true,
        options: [
          { id: 'regular', name: 'معمولی', price: 0 },
          { id: 'large', name: 'بزرگ', price: 50000 },
        ],
      },
      {
        id: 'toppings', title: 'افزودنی‌ها', selection: 'multiple', required: true,
        options: [
          { id: 'cheese', name: 'پنیر اضافه', price: 30000 },
          { id: 'pepper', name: 'فلفل', price: 0, available: false },
        ],
      },
      {
        id: 'request', title: 'درخواست', selection: 'multiple', required: false,
        options: [{ id: 'no-onion', name: 'بدون پیاز', price: 0 }],
      },
    ],
  };
}

function samplePricedQuoteIntent() {
  const intent = {
    tenantId: 'westo',
    branchId: 4,
    fulfillment: 'delivery',
    tableNo: '',
    zoneId: 9,
    phone: '09123456789',
    paymentMethod: 'cashier',
    items: [{ menuItemId: 41, qty: 2, modifiers: [{ groupId: 'size', id: 'large', price: 11001 }] }],
    subtotal: 222004,
    deliveryFee: 31001,
    discount: 11100,
    total: 241905,
  };
  const lineGrossIrr = intent.subtotal * 10;
  const lineDiscountIrr = intent.discount * 10;
  const deliveryGrossIrr = intent.deliveryFee * 10;
  const ruleSnapshot = {
    id: 'test-branch-4-vat-v1', code: 'VAT_TEST_BRANCH_4', rate: 0,
    inclusive: true, version: 1, locationId: intent.branchId,
    legalSource: 'test fixture only',
  };
  intent.taxSnapshot = {
    schemaVersion: 1, currency: 'IRR', branchId: intent.branchId,
    fulfillment: intent.fulfillment, inclusive: true, effectiveDate: '2026-09-24',
    totalTaxIrr: 0, grossIrr: (intent.subtotal + intent.deliveryFee) * 10,
    discountIrr: lineDiscountIrr, totalPayableIrr: intent.total * 10,
    lines: [{
      type: 'menu', menuItemId: intent.items[0].menuItemId, taxCategory: 'standard_1405',
      grossIrr: lineGrossIrr, discountIrr: lineDiscountIrr,
      taxableBaseIrr: lineGrossIrr - lineDiscountIrr, taxAmountIrr: 0, ruleSnapshot,
    }],
    deliveryFee: {
      taxCategory: 'standard_1405', grossIrr: deliveryGrossIrr,
      taxableBaseIrr: deliveryGrossIrr, taxAmountIrr: 0, ruleSnapshot,
    },
  };
  return intent;
}

test('required single and multiple modifier groups must be selected before adding a dish', () => {
  const { api } = createCheckoutRuntime();
  const item = sampleItem();
  const incomplete = api.validateModifiers(item, []);
  assert.equal(incomplete.valid, false);
  assert.deepEqual(Array.from(incomplete.missing, (group) => group.id), ['size', 'toppings']);

  const complete = api.validateModifiers(item, [
    { groupId: 'size', id: 'large' },
    { groupId: 'toppings', id: 'cheese' },
  ]);
  assert.equal(complete.valid, true);
  assert.equal(api.validateModifiers(item, [
    { groupId: 'size', id: 'large' },
    { groupId: 'size', id: 'regular' },
    { groupId: 'toppings', id: 'cheese' },
  ]).valid, false, 'single-select group cannot contain two choices');
  assert.equal(api.validateModifiers(item, [
    { groupId: 'size', id: 'large' },
    { groupId: 'toppings', id: 'pepper' },
  ]).valid, false, 'unavailable option is rejected');

  api.state.itemById.set(item.id, item);
  assert.equal(api.addToCart(item.id, []), false);
  assert.equal(api.addToCart(item.id, complete.valid ? [
    { groupId: 'size', id: 'large' },
    { groupId: 'toppings', id: 'cheese' },
  ] : []), true);
});

test('cart keeps distinct modifier configurations as distinct quote/order lines', () => {
  const { api } = createCheckoutRuntime();
  const item = sampleItem();
  api.state.itemById.set(item.id, item);
  const regular = [
    { groupId: 'size', id: 'regular' },
    { groupId: 'toppings', id: 'cheese' },
  ];
  const large = [
    { groupId: 'size', id: 'large' },
    { groupId: 'toppings', id: 'cheese' },
  ];

  assert.equal(api.addToCart(item.id, regular), true);
  assert.equal(api.addToCart(item.id, regular), true);
  assert.equal(api.addToCart(item.id, large), true);
  const lines = api.lineItems();
  assert.equal(lines.length, 2);
  assert.deepEqual(Array.from(lines, (line) => line.qty).sort(), [1, 2]);
  assert.deepEqual(Array.from(lines, (line) => line.modifiers.find((modifier) => modifier.id === 'large') ? 'large' : 'regular').sort(), ['large', 'regular']);
  assert.deepEqual(
    Array.from(lines, (line) => line.modifiers.map(({ groupId, id }) => ({ groupId, id }))),
    [
      [{ groupId: 'size', id: 'regular' }, { groupId: 'toppings', id: 'cheese' }],
      [{ groupId: 'size', id: 'large' }, { groupId: 'toppings', id: 'cheese' }],
    ],
    'checkout sends the group and option identities required for server-side validation',
  );
});

test('modifier UI enforces minimum and maximum selections before quote', () => {
  const { api } = createCheckoutRuntime();
  const item = {
    id: 45,
    name: 'ترکیب انتخابی',
    price: 100000,
    modifierGroups: [{
      id: 'mix', title: 'ترکیب', selection: 'multiple', required: true,
      minSelections: 2, maxSelections: 2,
      options: [
        { id: 'a', name: 'اول', price: 0 },
        { id: 'b', name: 'دوم', price: 0 },
        { id: 'c', name: 'سوم', price: 0 },
      ],
    }],
  };
  assert.equal(api.validateModifiers(item, []).valid, false);
  assert.equal(api.validateModifiers(item, [
    { groupId: 'mix', id: 'a' },
  ]).valid, false);
  assert.equal(api.validateModifiers(item, [
    { groupId: 'mix', id: 'a' },
    { groupId: 'mix', id: 'b' },
  ]).valid, true);
  const tooMany = api.validateModifiers(item, [
    { groupId: 'mix', id: 'a' },
    { groupId: 'mix', id: 'b' },
    { groupId: 'mix', id: 'c' },
  ]);
  assert.equal(tooMany.valid, false);
  assert.equal(tooMany.exceeded[0].id, 'mix');
  assert.match(api.modifierDialogMarkup(item), /حداقل ۲ مورد/);
  assert.match(api.modifierDialogMarkup(item), /حداکثر ۲ مورد/);
});

test('reordering an item with newly required choices pauses and asks for fresh selections', () => {
  const { api, getElement } = createCheckoutRuntime();
  const item = sampleItem();
  api.state.itemById.set(item.id, item);
  api.restoreReorderItems([{ menuItemId: item.id, qty: 2 }]);

  assert.equal(api.state.cart.size, 0, 'reorder cannot bypass mandatory choices');
  assert.equal(api.state.pendingModifierItem.id, item.id);
  assert.equal(api.state.pendingModifierQuantity, 2);

  getElement('checkout-modifier-groups').querySelectorAll = () => [
    { dataset: { groupIndex: '0', optionIndex: '1' } },
    { dataset: { groupIndex: '1', optionIndex: '0' } },
  ];
  api.submitModifierDialog({ preventDefault() {} });
  assert.equal(api.state.cart.size, 1);
  assert.equal(api.lineItems()[0].qty, 2);
  assert.equal(api.lineItems()[0].modifiers.length, 2);
  assert.equal(api.state.restoringReorder, false);
});

test('modifier chooser marks mandatory groups and excludes unavailable choices', () => {
  const { api } = createCheckoutRuntime();
  const html = api.modifierDialogMarkup(sampleItem());
  assert.match(html, /name="checkout-modifier-0"[^>]*required/);
  assert.match(html, /حداقل ۱ مورد/);
  assert.match(html, /پنیر اضافه/);
  assert.doesNotMatch(html, /فلفل/);
  assert.match(html, /\+ ۳۰/);
});

test('optional modifier groups are still shown to guests and remain optional', () => {
  const { api } = createCheckoutRuntime();
  const item = sampleItem();
  api.state.itemById.set(item.id, item);

  api.ensureMobileCartShortcut();
  assert.equal(api.openModifierDialog(item.id), true);
  assert.equal(api.state.pendingModifierItem.id, item.id);
  assert.match(api.modifierDialogMarkup(item), /بدون پیاز/);
  assert.match(api.modifierDialogMarkup(item), /checkout-modifier-optional/);
});

test('guest validation matches dine-in, pickup and delivery requirements and focuses the missing field', () => {
  const { api, getElement, setFulfillment } = createCheckoutRuntime();
  const item = { id: 52, name: 'سوپ', price: 80000, modifierGroups: [] };
  api.state.itemById.set(item.id, item);
  api.addToCart(item.id, []);
  api.state.branchId = 4;
  api.state.payment = { onlineEnabled: false };
  getElement('checkout-branch').value = '4';
  getElement('checkout-table').value = '۸';
  getElement('checkout-name').value = 'مهمان';
  getElement('checkout-phone').value = '۰۹۱۲۳۴۵۶۷۸۹';
  getElement('checkout-payment').value = 'cashier';

  assert.equal(api.validateGuestCheckout(), null, 'Persian digits normalize to the server’s expected phone/table format');
  getElement('checkout-branch').value = '5';
  assert.equal(api.validateGuestCheckout().field, 'checkout-branch', 'a visible branch selection must match the branch whose quote is loaded');
  getElement('checkout-branch').value = '4';
  api.state.branchLoading = true;
  assert.equal(api.validateGuestCheckout().field, 'checkout-branch', 'checkout is blocked while branch-specific zones and payment policy are loading');
  api.state.branchLoading = false;
  getElement('checkout-phone').value = '0912345';
  const invalidPhone = api.validateGuestCheckout();
  assert.equal(invalidPhone.field, 'checkout-phone');
  api.reportGuestCheckoutError(invalidPhone);
  assert.equal(getElement('checkout-phone').focused, true);
  assert.equal(getElement('checkout-phone').getAttribute('aria-invalid'), 'true');
  assert.match(getElement('checkout-message').textContent, /۱۱ رقم/);

  setFulfillment('pickup');
  getElement('checkout-phone').value = '۰۹۱۲۳۴۵۶۷۸۹';
  getElement('checkout-table').value = '';
  getElement('checkout-zone').value = '';
  getElement('checkout-address').value = '';
  assert.equal(api.validateGuestCheckout(), null, 'pickup does not require a dine-in table or delivery address');

  setFulfillment('delivery');
  getElement('checkout-zone').value = '9';
  getElement('checkout-address').value = '';
  api.state.zones = [{ id: 9, branchId: 5 }];
  assert.equal(api.validateGuestCheckout().field, 'checkout-zone', 'delivery zone must belong to the selected branch');
  api.state.zones = [{ id: 9, branchId: 4 }];
  assert.equal(api.validateGuestCheckout().field, 'checkout-address');
  getElement('checkout-address').value = 'خیابان نمونه، پلاک ۱';
  getElement('checkout-table').value = '';
  getElement('checkout-phone').value = '۰۹۱۲۳۴۵۶۷۸۹';
  assert.equal(api.validateGuestCheckout(), null, 'delivery does not require a dine-in table');

  getElement('checkout-payment').value = 'online';
  assert.equal(api.validateGuestCheckout().field, 'checkout-payment', 'unavailable online payment is rejected before POST');
});

test('selecting a saved address updates recipient details and clears a note absent from the selected address', () => {
  const { api, getElement } = createCheckoutRuntime({ initialFulfillment: 'delivery' });
  const addresses = [
    {
      id: 1, city: 'تهران', district: 'مرکزی', address: 'خیابان اول', isDefault: true,
      note: 'زنگ واحد قبلی', receiverName: 'گیرندهٔ اول', receiverPhone: '09121111111',
    },
    {
      id: 2, city: 'تهران', district: 'شمال', address: 'خیابان دوم',
      receiverName: 'گیرندهٔ دوم', receiverPhone: '09122222222',
    },
  ];
  getElement('checkout-instructions').value = 'یادداشت قبلی فرم';
  getElement('checkout-name').value = 'مهمان قبلی';
  getElement('checkout-phone').value = '09120000000';
  api.state.userAddresses = addresses;

  const list = getElement('checkout-addresses-list');
  const radios = addresses.map((address) => ({
    value: String(address.id),
    listeners: new Map(),
    style: {},
    addEventListener(type, handler) { this.listeners.set(type, handler); },
    closest() { return { style: {} }; },
  }));
  list.controls = radios;

  api.renderCheckoutAddresses();
  assert.equal(getElement('checkout-address').value, 'تهران، مرکزی، خیابان اول');
  assert.equal(getElement('checkout-instructions').value, 'زنگ واحد قبلی');
  assert.equal(getElement('checkout-name').value, 'گیرندهٔ اول');
  assert.equal(getElement('checkout-phone').value, '09121111111');

  api.state.quote = { ok: true, quoteToken: 'old-phone-quote', total: 65000 };
  api.state.quoteSignature = api.currentQuoteSignature();
  radios[1].listeners.get('change')();
  assert.equal(getElement('checkout-address').value, 'تهران، شمال، خیابان دوم');
  assert.equal(getElement('checkout-instructions').value, '', 'an address without a note must clear the previous address note');
  assert.equal(getElement('checkout-name').value, 'گیرندهٔ دوم');
  assert.equal(getElement('checkout-phone').value, '09122222222');
  assert.equal(api.state.quote, null, 'a saved recipient phone change invalidates the quote');
  assert.equal(api.state.quoteSignature, '');
});

test('changing branch invalidates the quote and blocks submit until that branch metadata resolves', async () => {
  let resolveMeta;
  const requests = [];
  const { api, getElement } = createCheckoutRuntime({
    fetchImpl: (url, options) => {
      requests.push({ url, options });
      if (url === '/api/checkout/meta?branchId=2') {
        return new Promise((resolve) => { resolveMeta = resolve; });
      }
      if (url === '/api/checkout/quote') {
        return { ok: true, status: 200, json: async () => ({
          ok: true, quoteToken: 'branch-two-quote', fulfillment: 'dine_in',
          subtotal: 65000, deliveryFee: 0, discount: 0, total: 65000,
          tax: { inclusive: true, totalTaxIrr: 0 },
        }) };
      }
      throw new Error(`unexpected checkout request: ${url}`);
    },
  });
  prepareCheckoutSubmission(api, getElement);
  api.bindListeners();

  const branch = getElement('checkout-branch');
  branch.value = '2';
  const changing = branch.listeners.get('change')();

  assert.equal(api.state.branchLoading, true);
  assert.equal(api.state.quote, null, 'the quote for the previous branch is invalidated immediately');
  assert.equal(branch.getAttribute('aria-busy'), 'true');
  assert.equal(getElement('checkout-submit').disabled, true);
  await api.submit({ preventDefault() {} });
  assert.equal(requests.length, 1, 'no order request can race the branch metadata request');
  assert.equal(requests[0].url, '/api/checkout/meta?branchId=2');
  assert.match(getElement('checkout-message').textContent, /در حال دریافت اطلاعات این شعبه/);

  resolveMeta({
    ok: true,
    status: 200,
    json: async () => ({
      branches: [{ id: 1, name: 'شعبه یک' }, { id: 2, name: 'شعبه دو' }],
      deliveryZones: [{ id: 20, branchId: 2, name: 'محدوده دو' }],
      payment: { onlineEnabled: false },
    }),
  });
  await changing;

  assert.equal(api.state.branchLoading, false);
  assert.equal(api.state.branchId, 2);
  assert.equal(branch.getAttribute('aria-busy'), null);
  assert.equal(api.state.zones[0].branchId, 2);
  assert.equal(getElement('checkout-submit').disabled, true, 'a fresh server quote is still required after switching branches');
  assert.equal(await runNextTimer(), true, 'metadata completion schedules a quote for the newly selected branch');
  assert.equal(requests.at(-1).url, '/api/checkout/quote');
  assert.equal(JSON.parse(requests.at(-1).options.body).branchId, 2);
  assert.equal(api.state.quote.quoteToken, 'branch-two-quote');
});

test('address modal starts city blank, preserves an existing default and returns focus on close', () => {
  const { api, getElement } = createCheckoutRuntime();
  const addButton = getElement('checkout-add-addr-btn');
  const modal = getElement('address-modal');
  const city = getElement('modal-addr-city');
  const makeDefault = getElement('modal-addr-default');

  api.state.userAddresses = [{ id: 'saved-address', isDefault: true }];
  api.initCheckoutAddressModal();
  addButton.listeners.get('click')();
  assert.equal(city.value, '');
  assert.equal(makeDefault.checked, false, 'adding another address must not silently replace the saved default');
  assert.equal(modal.getAttribute('aria-hidden'), 'false');
  modal.listeners.get('click')({ target: modal });
  assert.equal(modal.style.display, 'none');
  assert.equal(modal.getAttribute('aria-hidden'), 'true');
  assert.equal(addButton.focused, true);

});

test('address creation has a bounded wait and blocks blind retries after an unknown result', () => {
  assert.match(checkoutSource, /api\('\/api\/user\/addresses',\s*\{[\s\S]*?timeoutMs:\s*15000/);
  assert.match(checkoutSource, /api\('\/api\/user\/addresses',\s*\{\s*timeoutMs:\s*8000\s*\}\)/,
    'an ambiguous create is reconciled with a read-only addresses request');
  assert.match(checkoutSource, /state\.addressSaveOutcomeUnknown\s*=\s*true/);
  assert.match(checkoutSource, /if\s*\(state\.addressSaveOutcomeUnknown\)\s*return/,
    'a second create is blocked when reconciliation cannot prove the result');
});

test('address save button submits the fields entered in the mobile address dialog', async () => {
  const requests = [];
  const { api, getElement } = createCheckoutRuntime({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          address: { id: 'new-address', city: 'تهران', address: 'خیابان نمونه', receiverPhone: '09120000000' },
          addresses: [{ id: 'new-address', city: 'تهران', address: 'خیابان نمونه', receiverPhone: '09120000000' }],
        }),
      };
    },
  });
  api.initCheckoutAddressModal();

  const saveButton = getElement('save-address-modal-btn');
  assert.equal(saveButton.listeners.has('click'), true, 'the real button ID receives a click handler');
  getElement('checkout-add-addr-btn').listeners.get('click')();
  getElement('modal-addr-city').value = 'تهران';
  getElement('modal-addr-street').value = 'خیابان نمونه';
  getElement('modal-addr-receiver-phone').value = '09120000000';
  await saveButton.listeners.get('click')();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/user/addresses');
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    title: '🏠 منزل',
    city: 'تهران',
    district: '',
    address: 'خیابان نمونه',
    plaque: '',
    floor: '',
    unit: '',
    receiverName: '',
    receiverPhone: '09120000000',
    note: '',
    isDefault: true,
  });
});

test('timed-out address creation reconciles a committed address before allowing another save', async () => {
  const existing = { id: 'saved-address', title: 'منزل', address: 'نشانی قبلی' };
  const created = {
    id: 'created-address', title: '🏠 منزل', city: 'تهران', district: 'مرکزی',
    address: 'خیابان نمونه', plaque: '۱۲', floor: '۲', unit: '۳',
    receiverName: 'مهمان', receiverPhone: '09123456789', note: 'زنگ بزنید', isDefault: false,
  };
  const requests = [];
  const runtime = createCheckoutRuntime({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (options.method === 'POST') {
        return new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new DOMException('request timed out', 'AbortError')), { once: true });
        });
      }
      if (url === '/api/user/addresses') {
        return { ok: true, status: 200, json: async () => ({ ok: true, addresses: [created, existing] }) };
      }
      throw new Error(`unexpected request: ${url}`);
    },
  });
  const { api, getElement, runNextTimer } = runtime;
  api.state.user = { name: 'مهمان', phone: '09123456789' };
  api.state.userAddresses = [existing];
  getElement('checkout-phone').value = '09123456789';
  api.initCheckoutAddressModal();
  const saveButton = getElement('save-address-modal-btn');
  assert.equal(saveButton.listeners.has('click'), true);
  getElement('checkout-add-addr-btn').listeners.get('click')();
  for (const [id, value] of Object.entries({
    'modal-addr-city': 'تهران', 'modal-addr-district': 'مرکزی', 'modal-addr-street': 'خیابان نمونه',
    'modal-addr-plaque': '۱۲', 'modal-addr-floor': '۲', 'modal-addr-unit': '۳',
    'modal-addr-receiver-name': 'مهمان', 'modal-addr-receiver-phone': '09123456789', 'modal-addr-note': 'زنگ بزنید',
  })) getElement(id).value = value;

  const saving = saveButton.listeners.get('click')();
  assert.equal(await runNextTimer(), true);
  await saving;

  assert.equal(requests.filter(({ options }) => options.method === 'POST').length, 1);
  assert.equal(requests.length, 2, 'only one read follows the ambiguous create');
  assert.equal(requests[0].options.signal.aborted, true);
  assert.deepEqual(api.state.userAddresses.map(({ id }) => id), ['created-address', 'saved-address']);
  assert.equal(getElement('checkout-address').value, 'تهران، مرکزی، خیابان نمونه، پلاک ۱۲، طبقه ۲، واحد ۳');
  assert.equal(getElement('address-modal').style.display, 'none');
  assert.equal(api.state.addressSaveOutcomeUnknown, false);
});

test('unreconciled address save remains locked against a duplicate POST', async () => {
  let postCount = 0;
  const existing = { id: 'saved-address', title: 'منزل', address: 'نشانی قبلی' };
  const { api, getElement } = createCheckoutRuntime({
    fetchImpl: async (url, options) => {
      if (options.method === 'POST') {
        postCount += 1;
        throw new TypeError('connection lost');
      }
      if (url === '/api/user/addresses') return { ok: true, status: 200, json: async () => ({ ok: true, addresses: [existing] }) };
      throw new Error(`unexpected request: ${url}`);
    },
  });
  api.state.userAddresses = [existing];
  api.initCheckoutAddressModal();
  getElement('checkout-add-addr-btn').listeners.get('click')();
  getElement('modal-addr-street').value = 'خیابان تازه';
  const saveButton = getElement('save-address-modal-btn');
  await saveButton.listeners.get('click')();

  assert.equal(api.state.addressSaveOutcomeUnknown, true);
  assert.equal(saveButton.disabled, true);
  assert.equal(saveButton.textContent, 'وضعیت ذخیره نامشخص');
  assert.match(getElement('modal-addr-msg').textContent, /دوباره ذخیره نکنید/);
  await saveButton.listeners.get('click')();
  assert.equal(postCount, 1);
});

test('mobile cart shortcut follows the live basket and scrolls to checkout', () => {
  const { api, getElement } = createCheckoutRuntime();
  const item = { id: 53, name: 'چای', price: 75000, modifierGroups: [] };
  api.state.itemById.set(item.id, item);
  api.ensureMobileCartShortcut();
  const shortcut = getElement('checkout-mobile-cart');
  assert.equal(shortcut.hidden, true);

  api.addToCart(item.id, []);
  assert.equal(shortcut.hidden, false);
  assert.match(shortcut.textContent, /۱ قلم/);
  assert.match(shortcut.textContent, /۷۵٬۰۰۰/);
  shortcut.listeners.get('click')();
  assert.equal(getElement('checkout-side').scrollOptions.behavior, 'smooth');
  assert.equal(getElement('checkout-side').scrollOptions.block, 'start');

  api.state.cart.clear();
  api.renderTotals();
  assert.equal(shortcut.hidden, true);
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'checkout.css'), 'utf8');
  assert.match(css, /\.checkout-mobile-cart:not\(\[hidden\]\)[\s\S]*?position:\s*fixed/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test('checkout stage and mobile shortcut stay on the active stage during submit recovery', () => {
  const { api, getElement } = createCheckoutRuntime();
  const item = { id: 55, name: 'نان', price: 30000, modifierGroups: [] };
  api.state.itemById.set(item.id, item);
  api.addToCart(item.id, []);
  api.ensureMobileCartShortcut();
  api.showCheckoutStage('review', { focus: false, announce: false });

  api.state.submitting = true;
  assert.equal(api.showCheckoutStage('basket', { focus: false }), false);
  getElement('checkout-mobile-cart').listeners.get('click')();
  assert.equal(getElement('checkout-side').scrollOptions, undefined, 'the floating shortcut cannot move focus into the hidden basket during submit');
  api.syncMobileCartShortcut();
  assert.equal(getElement('checkout-mobile-cart').hidden, true);

  api.state.submitting = false;
  api.state.uncertainIntent = { manualFollowup: false };
  assert.equal(api.showCheckoutStage('basket', { focus: false }), false);
  getElement('checkout-mobile-cart').listeners.get('click')();
  assert.equal(getElement('checkout-side').scrollOptions, undefined, 'the floating shortcut cannot hide the only retry action');
  api.syncMobileCartShortcut();
  assert.equal(getElement('checkout-mobile-cart').hidden, true);
  assert.equal(api.state.currentStage, 'review');
});

function prepareCheckoutSubmission(api, getElement, { fulfillment = 'dine_in' } = {}) {
  getElement('checkout-success').hidden = true;
  const item = { id: 54, name: 'قهوه', price: 65000, modifierGroups: [] };
  api.state.itemById.set(item.id, item);
  api.state.branchId = 1;
  api.state.payment = { onlineEnabled: false };
  if (fulfillment === 'delivery') {
    api.state.zones = [{ id: 9, branchId: 1, name: 'محدوده آزمایشی' }];
    getElement('checkout-zone').value = '9';
    getElement('checkout-address').value = 'خیابان نمونه، پلاک ۱';
    getElement('checkout-instructions').value = 'زنگ واحد ۲';
  }
  api.addToCart(item.id, []);
  getElement('checkout-branch').value = '1';
  getElement('checkout-table').value = fulfillment === 'dine_in' ? '۳' : '';
  getElement('checkout-name').value = 'مهمان';
  getElement('checkout-phone').value = '09123456789';
  getElement('checkout-payment').value = 'cashier';
  api.state.quote = {
    ok: true,
    quoteToken: 'current-quote',
    subtotal: 65000,
    deliveryFee: 0,
    tierDiscountToman: 0,
    pointsDiscountToman: 0,
    total: 65000,
  };
  api.state.quoteSignature = api.currentQuoteSignature();
  api.renderTotals();
  api.showCheckoutStage('review', { focus: false, announce: false });
}

function successfulOrderResponse({ fulfillment = 'dine_in', total = 65000, payment = null } = {}) {
  return {
    ok: true,
    status: 201,
    json: async () => ({
      ok: true,
      order: { id: 701, orderNo: 'W-701', total, status: 'awaiting_confirmation', fulfillment, tableNo: fulfillment === 'dine_in' ? '3' : '' },
      payment,
    }),
  };
}

test('implicit form submit advances checkout one stage at a time and only places an order from final review', async () => {
  const requests = [];
  const { api, getElement } = createCheckoutRuntime({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return successfulOrderResponse();
    },
  });
  prepareCheckoutSubmission(api, getElement);
  api.showCheckoutStage('fulfillment', { focus: false, announce: false });
  let prevented = 0;
  const enterSubmit = { preventDefault() { prevented += 1; } };

  await api.submit(enterSubmit);
  assert.equal(requests.length, 0, 'submitting from fulfillment must not bypass customer details and review');
  assert.equal(api.state.currentStage, 'customer');
  assert.equal(getElement('checkout-stage-heading-customer').focused, true);

  await api.submit(enterSubmit);
  assert.equal(requests.length, 0, 'submitting from customer details must advance to review instead of placing the order');
  assert.equal(api.state.currentStage, 'review');
  assert.equal(getElement('checkout-stage-heading-review').focused, true);

  await api.submit(enterSubmit);
  assert.equal(requests.length, 1, 'the reviewed order is submitted only from the final stage');
  assert.equal(requests[0].url, '/api/checkout/orders');
  assert.equal(prevented, 3);
});

test('a confirmed server order with a different total is shown as a pricing incident, never normal success', async (t) => {
  for (const paymentMethod of ['cashier', 'online']) {
    await t.test(paymentMethod, async () => {
      const { api, getElement, storage } = createCheckoutRuntime({
        fetchImpl: async () => successfulOrderResponse({
          total: 70000,
          payment: paymentMethod === 'online'
            ? { id: 903, orderId: 701, amount: 70000, status: 'pending', provider: 'gateway', redirectUrl: 'https://pay.example/session/903' }
            : null,
        }),
      });
      prepareCheckoutSubmission(api, getElement);
      if (paymentMethod === 'online') {
        api.state.payment = { onlineEnabled: true, gatewayReady: true, mode: 'production', provider: 'gateway' };
        getElement('checkout-payment').value = 'online';
        api.state.quoteSignature = api.currentQuoteSignature();
      }
      getElement('checkout-recovery-notice').hidden = true;

      await api.submit({ preventDefault() {} });

      assert.equal(getElement('checkout-success').hidden, false);
      assert.equal(getElement('checkout-form').hidden, true);
      assert.match(getElement('checkout-success-title').textContent, /با پیش‌فاکتور تأییدشده یکسان نیست/);
      assert.match(getElement('checkout-success-body').textContent, /۶۵٬۰۰۰/);
      assert.match(getElement('checkout-success-body').textContent, /۷۰٬۰۰۰/);
      assert.match(getElement('checkout-success-body').textContent, /پیش از پرداخت یا ثبت سفارش تازه/);
      assert.equal(getElement('checkout-payment-handoff').hidden, true, 'never expose a payment link for a mismatched amount');
      assert.equal(getElement('checkout-payment-handoff').getAttribute('href'), null);
      assert.equal(getElement('sandbox-confirm').hidden, true);
      assert.equal(getElement('checkout-new-order-btn').hidden, true);
      assert.equal(getElement('checkout-recovery-notice').hidden, true, 'a confirmed order is no longer an unresolved retry');
      assert.equal(storage.has('westo_guest_checkout_receipt_v1'), false, 'do not keep a replay code after the server confirms an order');
      assert.equal(api.state.idempotencyKey, '');
    });
  }
});

test('checkout rejects a quote whose displayed discount components do not reconcile to its total', () => {
  const { api } = createCheckoutRuntime();
  const valid = {
    ok: true, quoteToken: 'signed-quote', fulfillment: 'dine_in',
    subtotal: 100000, deliveryFee: 20000, discount: 10000,
    tierDiscountToman: 7000, pointsDiscountToman: 3000, total: 110000,
    tax: { inclusive: true, totalTaxIrr: 10000 },
  };
  assert.equal(api.validateCheckoutQuote(valid), valid);
  assert.throws(
    () => api.validateCheckoutQuote({ ...valid, total: 109999 }),
    (error) => error.code === 'checkout_quote_invalid',
  );
  assert.throws(
    () => api.validateCheckoutQuote({ ...valid, pointsDiscountToman: 3000.5 }),
    (error) => error.code === 'checkout_quote_invalid',
  );
  for (const tax of [undefined, { inclusive: false, totalTaxIrr: 10000 }, { inclusive: true, totalTaxIrr: -1 }, { inclusive: true, totalTaxIrr: 1.5 }]) {
    const invalidQuote = { ...valid };
    if (tax === undefined) delete invalidQuote.tax;
    else invalidQuote.tax = tax;
    assert.throws(
      () => api.validateCheckoutQuote(invalidQuote),
      (error) => error.code === 'checkout_quote_invalid',
      'checkout must reject an absent or malformed inclusive tax snapshot instead of estimating tax',
    );
  }
});

test('modifier validation associates its message with and focuses the first invalid choice', () => {
  const { api, getElement } = createCheckoutRuntime();
  const item = {
    id: 61,
    name: 'غذای سفارشی',
    price: 50000,
    modifierGroups: [{
      id: 'size', title: 'اندازه', selection: 'single', required: true,
      options: [{ id: 'large', name: 'بزرگ', price: 10000 }],
    }],
  };
  api.state.itemById.set(item.id, item);
  api.openModifierDialog(item.id);

  const choice = {
    checked: false,
    dataset: { groupIndex: '0' },
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) || null; },
    removeAttribute(name) { this.attributes.delete(name); },
    focus() { this.focused = true; },
  };
  getElement('checkout-modifier-groups').querySelectorAll = () => [choice];
  api.submitModifierDialog({ preventDefault() {} });

  assert.match(getElement('checkout-modifier-error').textContent, /حداقل تعداد گزینهٔ لازم/);
  assert.equal(choice.focused, true);
  assert.equal(choice.getAttribute('aria-invalid'), 'true');
  assert.equal(choice.getAttribute('aria-describedby'), 'checkout-modifier-error');
});

test('refresh recovery warning is explicit and appears only while an unresolved same-tab intent exists', () => {
  const { api, getElement, storage } = createCheckoutRuntime();
  const notice = getElement('checkout-recovery-notice');
  notice.hidden = false;

  assert.equal(api.renderCheckoutRecoveryNotice(), false);
  assert.equal(notice.hidden, true);
  storage.set('westo_guest_checkout_receipt_v1', JSON.stringify({
    version: 1,
    intents: { 'intent-opaque': { code: '0123456789abcdef0123456789abcdef', submitted: true, at: Date.now() } },
  }));
  assert.equal(api.renderCheckoutRecoveryNotice(), true);
  assert.equal(notice.hidden, false);
  assert.match(orderHtml, /با کد رسید قبلی وضعیت را بررسی کنید/);
});

test('rapid repeated submits issue only one checkout request while the first is pending', async () => {
  let resolveRequest;
  const calls = [];
  const { api, getElement } = createCheckoutRuntime({
    fetchImpl: (url, options) => {
      calls.push({ url, options });
      return new Promise((resolve) => { resolveRequest = resolve; });
    },
  });
  prepareCheckoutSubmission(api, getElement);
  const event = { preventDefault() {} };

  const first = api.submit(event);
  const duplicate = api.submit(event);
  for (let attempt = 0; attempt < 20 && !calls.length; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(calls.length, 1);
  assert.equal(getElement('checkout-submit').disabled, true);
  assert.equal(getElement('checkout-submit').getAttribute('aria-busy'), 'true');
  resolveRequest(successfulOrderResponse());
  await Promise.all([first, duplicate]);
  assert.equal(calls.length, 1);
  assert.equal(getElement('checkout-success').hidden, false);
});

test('guest order receipt explains the authenticated phone-based path for later order tracking', async () => {
  const { api, getElement } = createCheckoutRuntime({ fetchImpl: async () => successfulOrderResponse({ fulfillment: 'pickup' }) });
  api.showSuccess({ id: 701, orderNo: 'W-701', total: 65000, status: 'awaiting_confirmation', fulfillment: 'pickup' });

  assert.match(getElement('checkout-success-body').textContent, /برای پیگیری به‌روزرسانی‌های بعدی، با همان شماره موبایل ثبت‌شده در سفارش وارد حساب کاربری شوید/);
  assert.match(orderHtml, /id="checkout-view-history-btn" href="\/profile#orders"[^>]*>📦 ورود به حساب و پیگیری سفارش‌های من</);
  assert.match(serverSource, /app\.get\('\/api\/orders\/my-orders',\s*requireAuth/);
});

test('guest delivery receipt shows only a valid server ETA and never invents a default', () => {
  const { api, getElement } = createCheckoutRuntime();
  const order = { id: 701, orderNo: 'W-701', total: 65000, status: 'awaiting_confirmation', fulfillment: 'delivery' };

  api.showSuccess(order);
  assert.match(getElement('checkout-success-body').textContent, /زمان تقریبی ارسال هنوز از سوی شعبه اعلام نشده است/);
  assert.doesNotMatch(getElement('checkout-success-body').textContent, /۳۵ دقیقه|35 دقیقه/);

  order.delivery = { etaMinutes: 27 };
  api.showSuccess(order);
  assert.match(getElement('checkout-success-body').textContent, /حدود ۲۷ دقیقه/);

  order.delivery.etaMinutes = 0;
  api.showSuccess(order);
  assert.match(getElement('checkout-success-body').textContent, /زمان تقریبی ارسال هنوز از سوی شعبه اعلام نشده است/);
});

test('delivery acceptance and payment remain separate on the guest receipt', () => {
  const { api, getElement } = createCheckoutRuntime();
  const order = {
    id: 701, orderNo: 'W-701', total: 65000, fulfillment: 'delivery',
    status: 'awaiting_confirmation', deliveryAcceptance: null,
  };
  const paymentLabels = {
    unpaid: 'پرداخت‌نشده',
    partial: 'بخشی از مبلغ پرداخت شده',
    pending: 'در انتظار تأیید پرداخت',
    paid: 'پرداخت تأیید شده',
    failed: 'پرداخت ناموفق',
    refunded: 'بازپرداخت شده',
    unknown: 'نامشخص',
  };

  for (const [paymentStatus, paymentLabel] of Object.entries(paymentLabels)) {
    order.paymentStatus = paymentStatus;
    api.showSuccess(order);
    assert.match(getElement('checkout-success-title').textContent, /در انتظار پذیرش رستوران/, paymentStatus);
    assert.match(getElement('checkout-success-body').textContent, /پذیرش رستوران هنوز تأیید نشده؛ آماده‌سازی شروع نشده/, paymentStatus);
    assert.match(getElement('checkout-success-body').textContent, /سفارش در صف آشپزخانه نیست/, paymentStatus);
    assert.ok(getElement('checkout-success-body').textContent.includes(`وضعیت پرداخت: ${paymentLabel}`), paymentStatus);
  }

  order.status = 'sent_to_kitchen';
  order.deliveryAcceptance = {
    status: 'accepted',
    acceptedAt: '2026-09-23T09:00:00.000Z',
    acceptedBy: { phone: '09120000000', role: 'manager', name: 'مدیر شعبه' },
    source: 'restaurant',
  };
  order.paymentStatus = 'unpaid';
  api.showSuccess(order);
  assert.match(getElement('checkout-success-title').textContent, /پذیرش رستوران ثبت شد · سفارش در صف آشپزخانه است/);
  assert.match(getElement('checkout-success-body').textContent, /شروع آماده‌سازی پس از اقدام آشپزخانه اعلام می‌شود/);
  assert.match(getElement('checkout-success-body').textContent, /وضعیت پرداخت: پرداخت‌نشده/);

  order.status = 'preparing';
  api.showSuccess(order);
  assert.match(getElement('checkout-success-title').textContent, /آماده‌سازی شروع شده است/);

  order.status = 'awaiting_confirmation';
  order.deliveryAcceptance = null;
  order.paymentStatus = 'paid';
  api.showSuccess(order);
  assert.doesNotMatch(getElement('checkout-success-title').textContent, /پرداخت تأیید شد/);
  assert.match(getElement('checkout-success-title').textContent, /پرداخت ثبت شد · در انتظار پذیرش رستوران/);
  assert.match(getElement('checkout-success-body').textContent, /آماده‌سازی شروع نشده/);
  assert.match(getElement('checkout-success-body').textContent, /وضعیت پرداخت: پرداخت تأیید شده/);

  order.deliveryAcceptance = { status: 'rejected' };
  api.showSuccess(order);
  assert.match(getElement('checkout-success-title').textContent, /رستوران سفارش را نپذیرفت/);
  assert.match(getElement('checkout-success-body').textContent, /سفارش وارد صف آشپزخانه نمی‌شود/);
  assert.match(getElement('checkout-success-body').textContent, /وضعیت پرداخت جداگانه پیگیری می‌شود/);
  assert.ok(getElement('checkout-success-body').textContent.includes('وضعیت پرداخت: پرداخت تأیید شده'));
});

test('accepted delivery with pending payment remains visibly accepted and waits for payment', () => {
  const { api, getElement } = createCheckoutRuntime();
  api.showSuccess({
    id: 701, orderNo: 'W-701', total: 65000, fulfillment: 'delivery',
    status: 'pending_online', paymentStatus: 'pending',
    deliveryAcceptance: {
      status: 'accepted',
      acceptedAt: '2026-09-23T09:00:00.000Z',
      acceptedBy: { phone: '09120000000', role: 'manager', name: 'مدیر شعبه' },
      source: 'restaurant',
    },
  });

  assert.match(getElement('checkout-success-title').textContent, /رستوران سفارش را پذیرفت · در انتظار تأیید پرداخت/);
  assert.match(getElement('checkout-success-body').textContent, /وضعیت پرداخت: در انتظار تأیید پرداخت/);
  assert.match(getElement('checkout-success-body').textContent, /هنوز ورود به صف آشپزخانه ثبت نشده است/);
});

test('delivery cannot be shown as accepted from order status alone when the acceptance contract is missing', () => {
  const { api, getElement } = createCheckoutRuntime();
  api.showSuccess({
    id: 701, orderNo: 'W-701', total: 65000, fulfillment: 'delivery',
    status: 'sent_to_kitchen', paymentStatus: 'paid',
  });

  assert.match(getElement('checkout-success-title').textContent, /وضعیت سفارش نیازمند بررسی است/);
  assert.match(getElement('checkout-success-body').textContent, /پذیرش صریح رستوران تأیید نشده/);

  api.showSuccess({
    id: 702, orderNo: 'W-702', total: 65000, fulfillment: 'delivery',
    status: 'awaiting_confirmation', paymentStatus: 'paid',
    deliveryAcceptance: { status: 'accepted', source: 'cashier' },
  });
  assert.match(getElement('checkout-success-title').textContent, /پذیرش رستوران قابل تأیید نیست/);
});

test('conflicting order and payment statuses render payment as unknown, not successful', () => {
  const { api, getElement } = createCheckoutRuntime();
  api.showSuccess({
    id: 701, orderNo: 'W-701', total: 65000, fulfillment: 'delivery',
    status: 'awaiting_confirmation', paymentStatus: 'unpaid',
  }, { id: 902, status: 'paid', provider: 'gateway' });

  assert.match(getElement('checkout-success-body').textContent, /وضعیت پرداخت: نامشخص/);
  assert.doesNotMatch(getElement('checkout-success-body').textContent, /وضعیت پرداخت: پرداخت تأیید شده/);
  assert.equal(getElement('checkout-payment-handoff').hidden, true);
});

test('pending or unknown payment keeps same-order tracking available and hides the new-order CTA', async (t) => {
  const cases = [
    {
      name: 'pending',
      order: { paymentStatus: 'pending' },
      payment: null,
    },
    {
      name: 'unknown due to conflicting order/payment evidence',
      order: { paymentStatus: 'unpaid' },
      payment: { id: 902, status: 'paid', provider: 'gateway' },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const { api, getElement } = createCheckoutRuntime();
      api.showSuccess({
        id: 701, orderNo: 'W-701', total: 65000, fulfillment: 'delivery',
        status: 'awaiting_confirmation', ...scenario.order,
      }, scenario.payment);

      assert.equal(getElement('checkout-new-order-btn').hidden, true);
      assert.equal(getElement('checkout-view-history-btn').hidden, false);
      assert.equal(getElement('checkout-view-history-btn').textContent, '📦 پیگیری همین سفارش');
      assert.match(getElement('checkout-view-history-btn').getAttribute('aria-label'), /W-701/);
      if (scenario.name === 'unknown due to conflicting order/payment evidence') {
        assert.match(getElement('checkout-success-body').textContent, /سفارش تازه ثبت نکنید/);
      }
    });
  }
});

test('pending checkout freezes editable fields and prevents late cart changes', async () => {
  let resolveRequest;
  const { api, getElement } = createCheckoutRuntime({
    fetchImpl: () => new Promise((resolve) => { resolveRequest = resolve; }),
  });
  prepareCheckoutSubmission(api, getElement);
  const form = getElement('checkout-form');
  const editableField = { disabled: false };
  const unavailableOnlineOption = { disabled: true };
  form.controls = [editableField, unavailableOnlineOption];
  const initialLines = api.cartLines();

  const pending = api.submit({ preventDefault() {} });
  for (let attempt = 0; attempt < 20 && !resolveRequest; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(form.getAttribute('aria-busy'), 'true');
  assert.equal(editableField.disabled, true);
  assert.equal(unavailableOnlineOption.disabled, true);
  assert.equal(api.addToCart(54, []), false);
  api.adjust(initialLines[0].key, 1);
  assert.equal(api.cartLines()[0].qty, initialLines[0].qty);

  resolveRequest(successfulOrderResponse());
  await pending;
  assert.equal(form.getAttribute('aria-busy'), null);
  assert.equal(editableField.disabled, false);
  assert.equal(unavailableOnlineOption.disabled, true, 'pre-existing disabled state is restored');
});

test('a network-failed submit reuses its idempotency key on an explicit retry', async () => {
  const calls = [];
  const { api, getElement, storage } = createCheckoutRuntime({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) throw new TypeError('Failed to fetch');
      return successfulOrderResponse();
    },
  });
  prepareCheckoutSubmission(api, getElement);
  const phone = { id: 'checkout-phone', disabled: false };
  getElement('checkout-form').controls = [phone];
  const event = { preventDefault() {} };

  await api.submit(event);
  assert.equal(getElement('checkout-success').hidden, true);
  assert.match(getElement('checkout-message').textContent, /ممکن است سفارش ثبت شده باشد/);
  assert.match(getElement('checkout-message').textContent, /ورودی‌ها قفل شده‌اند/);
  assert.equal(getElement('checkout-submit').focused, true, 'the same-order retry remains the keyboard focus after an uncertain result');
  assert.equal(phone.disabled, true, 'an unresolved checkout freezes its customer fields');
  const persisted = JSON.parse(storage.get('westo_guest_checkout_receipt_v1'));
  const firstKey = Object.values(persisted.intents)[0].code;
  assert.ok(firstKey, 'the uncertain request key remains available for a safe retry');
  assert.equal(storage.get('westo_guest_checkout_receipt_v1').includes('09123456789'), false, 'retry storage must not retain the customer phone');
  assert.equal(storage.get('westo_guest_checkout_receipt_v1').includes('مهمان'), false, 'retry storage must not retain the customer name');

  getElement('checkout-phone').value = '09120000000';
  await api.submit(event);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers['Idempotency-Key'], calls[1].options.headers['Idempotency-Key']);
  assert.equal(calls[0].options.body, calls[1].options.body, 'a retry replays the captured payload rather than edited DOM values');
  assert.equal(storage.has('westo_guest_checkout_receipt_v1'), false, 'successful confirmation clears the matching retry intent');
  assert.equal(getElement('checkout-success').hidden, false);
  assert.equal(phone.disabled, false, 'the form lock is released after the server confirms the order');
});

test('a server 5xx is treated as an uncertain order and retry reuses the same key', async () => {
  const calls = [];
  const { api, getElement, storage } = createCheckoutRuntime({
    fetchImpl: async (_url, options) => {
      calls.push(options);
      if (calls.length === 1) {
        return { ok: false, status: 500, json: async () => ({ error: 'internal_error' }) };
      }
      return successfulOrderResponse();
    },
  });
  prepareCheckoutSubmission(api, getElement);

  await api.submit({ preventDefault() {} });
  assert.match(getElement('checkout-message').textContent, /ممکن است سفارش ثبت شده باشد/);
  assert.match(getElement('checkout-message').textContent, /ورودی‌ها قفل شده‌اند/);
  const saved = JSON.parse(storage.get('westo_guest_checkout_receipt_v1'));
  const originalKey = Object.values(saved.intents)[0].code;

  await api.submit({ preventDefault() {} });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers['Idempotency-Key'], originalKey);
  assert.equal(calls[1].headers['Idempotency-Key'], originalKey);
});

test('HTTP 408 and postgres state write conflicts retry as unknown with the original key and payload', async (t) => {
  const cases = [
    {
      name: 'HTTP 408',
      failure: { ok: false, status: 408, json: async () => ({ error: 'request_timeout' }) },
    },
    {
      name: 'postgres_state_write_conflict',
      failure: {
        ok: false,
        status: 409,
        json: async () => ({ error: 'postgres_state_write_conflict', code: 'postgres_state_write_conflict' }),
      },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const calls = [];
      const { api, getElement, storage } = createCheckoutRuntime({
        fetchImpl: async (_url, options) => {
          calls.push(options);
          return calls.length === 1 ? scenario.failure : successfulOrderResponse();
        },
      });
      prepareCheckoutSubmission(api, getElement);

      await api.submit({ preventDefault() {} });
      const originalPayload = calls[0].body;
      const originalKey = calls[0].headers['Idempotency-Key'];
      assert.ok(originalKey);
      assert.equal(api.state.uncertainIntent.key, originalKey);
      assert.deepEqual(JSON.parse(JSON.stringify(api.state.uncertainIntent.payload)), JSON.parse(originalPayload));
      assert.match(getElement('checkout-message').textContent, /ممکن است سفارش ثبت شده باشد/);
      assert.ok(storage.has('westo_guest_checkout_receipt_v1'));

      getElement('checkout-name').value = 'مقدار تغییریافته پس از timeout';
      getElement('checkout-phone').value = '09129999999';
      await api.submit({ preventDefault() {} });

      assert.equal(calls.length, 2);
      assert.equal(calls[1].headers['Idempotency-Key'], originalKey);
      assert.equal(calls[1].body, originalPayload, 'retry must keep the exact payload captured before the unknown outcome');
      assert.equal(getElement('checkout-success').hidden, false);
    });
  }
});

test('a server validation error is attached to and focuses the relevant checkout field', async () => {
  const { api, getElement } = createCheckoutRuntime({
    initialFulfillment: 'delivery',
    fetchImpl: async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: 'delivery_zone_unavailable', code: 'delivery_zone_unavailable' }),
    }),
  });
  prepareCheckoutSubmission(api, getElement, { fulfillment: 'delivery' });

  await api.submit({ preventDefault() {} });
  const zone = getElement('checkout-zone');
  assert.equal(zone.getAttribute('aria-invalid'), 'true');
  assert.equal(zone.focused, true);
  assert.match(getElement('checkout-message').textContent, /^اطلاعات دریافت:/);
  assert.match(getElement('checkout-message').textContent, /محدوده برای شعبهٔ انتخاب‌شده فعال نیست/);
});

test('dine-in, pickup and delivery submit only the server quote token and matching fulfillment data', async (t) => {
  for (const fulfillment of ['dine_in', 'pickup', 'delivery']) {
    await t.test(fulfillment, async () => {
      let request;
      const { api, getElement } = createCheckoutRuntime({
        initialFulfillment: fulfillment,
        fetchImpl: async (url, options) => {
          request = { url, options, body: JSON.parse(options.body) };
          return successfulOrderResponse({ fulfillment });
        },
      });
      prepareCheckoutSubmission(api, getElement, { fulfillment });

      await api.submit({ preventDefault() {} });

      assert.equal(request.url, '/api/checkout/orders');
      assert.equal(request.body.fulfillment, fulfillment);
      assert.equal(request.body.quoteToken, 'current-quote');
      assert.equal(request.body.branchId, 1);
      assert.equal(Object.hasOwn(request.body, 'total'), false, 'the browser must not submit an amount as authoritative');
      assert.equal(Object.hasOwn(request.body, 'subtotal'), false, 'the browser must not submit a subtotal as authoritative');
      if (fulfillment === 'dine_in') assert.equal(request.body.tableNo, '۳');
      if (fulfillment === 'pickup') assert.equal(request.body.tableNo, '');
      if (fulfillment === 'delivery') {
        assert.equal(request.body.deliveryZoneId, '9');
        assert.equal(request.body.deliveryAddress, 'خیابان نمونه، پلاک ۱');
        assert.equal(request.body.deliveryInstructions, 'زنگ واحد ۲');
      }
      assert.equal(getElement('checkout-success').hidden, false);
    });
  }
});

test('an incomplete successful response keeps the idempotency key for safe confirmation retry', async () => {
  const calls = [];
  const { api, getElement, storage } = createCheckoutRuntime({
    fetchImpl: async (url, options) => {
      calls.push(options);
      if (calls.length === 1) {
        return { ok: true, status: 201, json: async () => { throw new SyntaxError('invalid JSON'); } };
      }
      return successfulOrderResponse();
    },
  });
  prepareCheckoutSubmission(api, getElement);
  const event = { preventDefault() {} };

  await api.submit(event);
  const saved = JSON.parse(storage.get('westo_guest_checkout_receipt_v1'));
  const firstKey = Object.values(saved.intents)[0].code;
  assert.ok(firstKey);
  assert.equal(getElement('checkout-success').hidden, true);
  assert.match(getElement('checkout-message').textContent, /ممکن است سفارش ثبت شده باشد/);

  api.state.quote = { ok: true, quoteToken: 'refreshed-quote', total: 65000, subtotal: 65000, deliveryFee: 0 };
  api.state.quoteSignature = api.currentQuoteSignature();
  await api.submit(event);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers['Idempotency-Key'], firstKey);
  assert.equal(calls[1].headers['Idempotency-Key'], firstKey);
  assert.equal(storage.has('westo_guest_checkout_receipt_v1'), false);
  assert.equal(getElement('checkout-success').hidden, false);
});

test('online checkout is not confirmed without a payment attempt and retries with the same key', async () => {
  const calls = [];
  const { api, getElement, storage } = createCheckoutRuntime({
    fetchImpl: async (_url, options) => {
      calls.push(options);
      if (calls.length === 1) return successfulOrderResponse({ payment: null });
      return successfulOrderResponse({
        payment: { id: 992, orderId: 701, amount: 65000, status: 'pending', provider: 'gateway' },
      });
    },
  });
  prepareCheckoutSubmission(api, getElement);
  api.state.payment = { onlineEnabled: true, gatewayReady: true, mode: 'production', provider: 'gateway' };
  getElement('checkout-payment').value = 'online';
  api.state.quote = { ok: true, quoteToken: 'online-quote', total: 65000, subtotal: 65000, deliveryFee: 0 };
  api.state.quoteSignature = api.currentQuoteSignature();

  await api.submit({ preventDefault() {} });
  assert.equal(getElement('checkout-success').hidden, true);
  assert.match(getElement('checkout-message').textContent, /ممکن است سفارش ثبت شده باشد/);
  const saved = JSON.parse(storage.get('westo_guest_checkout_receipt_v1'));
  const firstKey = Object.values(saved.intents)[0].code;

  api.state.quote = { ok: true, quoteToken: 'online-retry-quote', total: 65000, subtotal: 65000, deliveryFee: 0 };
  api.state.quoteSignature = api.currentQuoteSignature();
  await api.submit({ preventDefault() {} });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers['Idempotency-Key'], firstKey);
  assert.equal(calls[1].headers['Idempotency-Key'], firstKey);
  assert.equal(getElement('checkout-success').hidden, false);
  assert.equal(storage.has('westo_guest_checkout_receipt_v1'), false);
});

test('online payment confirmation must match the order and exact quoted amount', async () => {
  const calls = [];
  const { api, getElement } = createCheckoutRuntime({
    fetchImpl: async (_url, options) => {
      calls.push(options);
      if (calls.length === 1) {
        return successfulOrderResponse({ payment: { id: 993, orderId: 700, amount: 64000, status: 'pending', provider: 'gateway' } });
      }
      return successfulOrderResponse({ payment: { id: 994, orderId: 701, amount: 65000, status: 'pending', provider: 'gateway' } });
    },
  });
  prepareCheckoutSubmission(api, getElement);
  api.state.payment = { onlineEnabled: true, gatewayReady: true, mode: 'production', provider: 'gateway' };
  getElement('checkout-payment').value = 'online';
  api.state.quote = { ok: true, quoteToken: 'online-matching-quote', subtotal: 65000, deliveryFee: 0, total: 65000 };
  api.state.quoteSignature = api.currentQuoteSignature();

  await api.submit({ preventDefault() {} });
  assert.equal(getElement('checkout-success').hidden, true);
  assert.equal(api.state.uncertainIntent !== null, true);
  const firstKey = calls[0].headers['Idempotency-Key'];

  await api.submit({ preventDefault() {} });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers['Idempotency-Key'], firstKey);
  assert.equal(getElement('checkout-success').hidden, false);
});

test('sandbox or unverified payment metadata never enables online tender', async () => {
  const { api, getElement } = createCheckoutRuntime({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        payment: { onlineEnabled: true, mode: 'sandbox', provider: 'sandbox' },
        branches: [{ id: 1, name: 'شعبه' }],
        deliveryZones: [],
      }),
    }),
  });
  await api.loadCheckoutMeta();
  assert.equal(api.state.payment.onlineEnabled, false);
  assert.equal(api.checkoutOnlineAvailable(), false);
  api.state.payment = { onlineEnabled: true, mode: 'live', provider: 'gateway' };
  assert.equal(api.checkoutOnlineAvailable(), false, 'a live-looking label alone is not proof that an adapter is ready');
  api.state.payment.gatewayReady = true;
  assert.equal(api.checkoutOnlineAvailable(), true, 'online is enabled only after an explicit gateway readiness signal');

  prepareCheckoutSubmission(api, getElement);
  api.state.payment = { onlineEnabled: true, mode: 'sandbox', provider: 'sandbox' };
  getElement('checkout-payment').value = 'online';
  assert.equal(api.validateGuestCheckout().field, 'checkout-payment');
  assert.equal(api.checkoutOnlineAvailable(), false);
});

test('a different checkout stays blocked while another receipt-code intent is unresolved', async () => {
  let calls = 0;
  const { api, getElement, storage } = createCheckoutRuntime({ fetchImpl: async () => { calls += 1; return successfulOrderResponse(); } });
  prepareCheckoutSubmission(api, getElement);
  storage.set('westo_guest_checkout_receipt_v1', JSON.stringify({
    version: 1,
    intents: { 'intent-from-previous-payload': { code: '0123456789abcdef0123456789abcdef', submitted: true, at: Date.now() } },
  }));

  await api.submit({ preventDefault() {} });

  assert.equal(calls, 0, 'a new key must not create a second order while the prior outcome is unresolved');
  assert.equal(api.state.uncertainIntent, null, 'the previous intent has no reconstructable payload in this fresh checkout');
  assert.equal(getElement('checkout-submit').disabled, true);
  assert.match(getElement('checkout-message').textContent, /کد رسید قبلی/);
  assert.equal(api.renderCheckoutRecoveryNotice(), true);
});

test('online payment handoff only exposes a pending HTTPS URL supplied by the server', async () => {
  const payment = { id: 902, orderId: 701, amount: 65000, status: 'pending', provider: 'gateway', checkoutUrl: 'https://pay.example/secure/session' };
  const { api, getElement } = createCheckoutRuntime({ fetchImpl: async () => successfulOrderResponse({ payment }) });
  prepareCheckoutSubmission(api, getElement);
  api.state.payment = { onlineEnabled: true, gatewayReady: true, mode: 'production', provider: 'gateway' };
  getElement('checkout-payment').value = 'online';
  api.state.quote = { ok: true, quoteToken: 'online-handoff-quote', subtotal: 65000, deliveryFee: 0, total: 65000 };
  api.state.quoteSignature = api.currentQuoteSignature();

  await api.submit({ preventDefault() {} });

  assert.equal(getElement('checkout-payment-handoff').hidden, false);
  assert.equal(getElement('checkout-payment-handoff').href, 'https://pay.example/secure/session');
  assert.match(getElement('checkout-success-body').textContent, /ادامهٔ پرداخت امن/);
});

test('online pending state never offers an insecure or credential-bearing payment URL', async () => {
  for (const checkoutUrl of ['http://pay.example/session', 'https://user:secret@pay.example/session', '//pay.example/session']) {
    const { api, getElement } = createCheckoutRuntime({
      fetchImpl: async () => successfulOrderResponse({
        payment: { id: 903, orderId: 701, amount: 65000, status: 'pending', provider: 'gateway', checkoutUrl },
      }),
    });
    prepareCheckoutSubmission(api, getElement);
    api.state.payment = { onlineEnabled: true, gatewayReady: true, mode: 'production', provider: 'gateway' };
    getElement('checkout-payment').value = 'online';
    api.state.quote = { ok: true, quoteToken: 'unsafe-handoff-quote', subtotal: 65000, deliveryFee: 0, total: 65000 };
    api.state.quoteSignature = api.currentQuoteSignature();

    await api.submit({ preventDefault() {} });

    assert.equal(getElement('checkout-payment-handoff').hidden, true, checkoutUrl);
    assert.match(getElement('checkout-success-body').textContent, /پیوند درگاه از سرور دریافت نشد/);
  }
});

test('an old uncertain guest intent is retained and reused without storing its payload', async () => {
  const { api, storage } = createCheckoutRuntime();
  const signature = JSON.stringify({ items: [{ menuItemId: 1, qty: 1 }], phone: '09123456789' });
  const storageKey = await api.checkoutIntentStorageKey(signature);
  const code = await api.getOrCreateCheckoutIdempotencyKey(storageKey);
  api.markCheckoutIntentSubmitted(storageKey, code);
  const savedBefore = JSON.parse(storage.get('westo_guest_checkout_receipt_v1'));
  savedBefore.intents[storageKey].at = 1;
  storage.set('westo_guest_checkout_receipt_v1', JSON.stringify(savedBefore));

  assert.equal(await api.getOrCreateCheckoutIdempotencyKey(storageKey), code, 'an old submitted code is never rotated away');
  const saved = JSON.parse(storage.get('westo_guest_checkout_receipt_v1'));
  assert.equal(saved.intents[storageKey].code, code);
  assert.equal(saved.intents[storageKey].submitted, true);
  assert.equal(storage.get('westo_guest_checkout_receipt_v1').includes('09123456789'), false);
});

test('an idempotency conflict preserves the key and requires manual order follow-up', async () => {
  const calls = [];
  const { api, getElement, storage } = createCheckoutRuntime({
    fetchImpl: async (_url, options) => {
      calls.push(options);
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'idempotency_key_conflict', code: 'idempotency_key_conflict' }),
      };
    },
  });
  prepareCheckoutSubmission(api, getElement);

  await api.submit({ preventDefault() {} });

  const saved = JSON.parse(storage.get('westo_guest_checkout_receipt_v1'));
  const firstKey = Object.values(saved.intents)[0].code;
  assert.ok(firstKey);
  assert.match(getElement('checkout-message').textContent, /ممکن است سفارش قبلی ثبت شده باشد/);
  assert.equal(getElement('checkout-success').hidden, true);
  assert.equal(api.state.uncertainIntent.manualFollowup, true);
  assert.equal(getElement('checkout-submit').disabled, true, 'a conflicting key must not be retried as though it were the same intent');
  assert.equal(getElement('checkout-message').focused, true, 'manual follow-up keeps focus on its visible explanation');
  await api.submit({ preventDefault() {} });
  assert.equal(calls.length, 1);
  assert.equal(Object.values(JSON.parse(storage.get('westo_guest_checkout_receipt_v1')).intents)[0].code, firstKey);
  assert.equal(storage.has('westo_guest_checkout_receipt_v1'), true);
});

test('a failed price quote leaves an explicit retry action instead of a dead disabled submit', async () => {
  let quoteCalls = 0;
  const { api, getElement, runNextTimer } = createCheckoutRuntime({
    fetchImpl: async (url) => {
      assert.equal(url, '/api/checkout/quote');
      quoteCalls += 1;
      if (quoteCalls === 1) throw new TypeError('Failed to fetch');
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, quoteToken: 'retried-quote', fulfillment: 'dine_in', subtotal: 65000, deliveryFee: 0, discount: 0, total: 65000, etaMinutes: 5 }),
      };
    },
  });
  prepareCheckoutSubmission(api, getElement);

  api.refreshQuote();
  assert.equal(await runNextTimer(), true);
  assert.equal(api.state.quoteRetryable, true);
  assert.equal(getElement('checkout-submit').disabled, false);
  assert.match(getElement('checkout-submit').textContent, /تلاش دوباره/);
  assert.match(getElement('checkout-note-text').textContent, /ارتباط با سرور برقرار نشد/);

  await api.submit({ preventDefault() {} });
  assert.equal(await runNextTimer(), true);
  assert.equal(quoteCalls, 2);
  assert.equal(api.state.quote.quoteToken, 'retried-quote');
  assert.equal(api.state.quoteRetryable, false);
  await api.prepareCheckoutReceiptCode();
  assert.equal(getElement('checkout-submit').disabled, false);
});

test('an incomplete HTTP 200 quote is rejected and the customer can retry for a complete server quote', async () => {
  let quoteCalls = 0;
  const { api, getElement, runNextTimer } = createCheckoutRuntime({
    fetchImpl: async (url) => {
      assert.equal(url, '/api/checkout/quote');
      quoteCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => quoteCalls === 1
          ? { ok: true }
          : { ok: true, quoteToken: 'complete-quote', fulfillment: 'dine_in', subtotal: 65000, deliveryFee: 0, discount: 0, total: 65000 },
      };
    },
  });
  prepareCheckoutSubmission(api, getElement);
  api.refreshQuote();
  assert.equal(await runNextTimer(), true);
  assert.equal(api.state.quote, null);
  assert.equal(api.state.quoteRetryable, true);
  assert.equal(getElement('checkout-submit').disabled, false);
  assert.match(getElement('checkout-submit').textContent, /تلاش دوباره/);
  assert.match(getElement('checkout-note-text').textContent, /پیش‌فاکتور پاسخ معتبر نداد/);

  await api.submit({ preventDefault() {} });
  assert.equal(await runNextTimer(), true);
  assert.equal(quoteCalls, 2);
  assert.equal(api.state.quote.quoteToken, 'complete-quote');
  assert.equal(api.state.quoteRetryable, false);
});

test('an expired quote is rejected safely, refreshed, and only then submitted with a new intent key', async () => {
  const calls = [];
  let orderCalls = 0;
  const { api, getElement, runNextTimer } = createCheckoutRuntime({
    fetchImpl: async (url, options) => {
      if (url === '/api/checkout/orders') {
        calls.push(options);
        orderCalls += 1;
        if (orderCalls === 1) return { ok: false, status: 409, json: async () => ({ error: 'checkout_quote_stale', code: 'checkout_quote_stale' }) };
        return successfulOrderResponse();
      }
      if (url === '/api/checkout/quote') {
        return { ok: true, status: 200, json: async () => ({ ok: true, quoteToken: 'fresh-quote', fulfillment: 'dine_in', subtotal: 65000, deliveryFee: 0, discount: 0, total: 65000 }) };
      }
      throw new Error(`unexpected request: ${url}`);
    },
  });
  prepareCheckoutSubmission(api, getElement);

  await api.submit({ preventDefault() {} });
  assert.equal(api.state.uncertainIntent, null, 'the server explicitly rejected the stale quote before creating an order');
  assert.match(getElement('checkout-message').textContent, /مبلغ جدید را بررسی کنید/);
  assert.equal(await runNextTimer(), true);
  assert.equal(api.state.quote.quoteToken, 'fresh-quote');
  await api.prepareCheckoutReceiptCode();
  assert.equal(getElement('checkout-submit').disabled, false);

  await api.submit({ preventDefault() {} });
  assert.equal(orderCalls, 2);
  assert.notEqual(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
  assert.equal(getElement('checkout-success').hidden, false);
});

test('server quote price differences are shown and block submit until explicitly accepted', () => {
  const { api, getElement } = createCheckoutRuntime();
  const item = { id: 9, name: 'چای', price: 100000, modifierGroups: [] };
  api.state.itemById.set(item.id, item);
  assert.equal(api.addToCart(item.id, []), true);
  const before = api.estimateVisiblePrices();
  const signature = api.currentQuoteSignature();
  api.applyQuote({
    ok: true,
    quoteToken: 'test-quote',
    subtotal: 120000,
    deliveryFee: 0,
    tierDiscountToman: 0,
    pointsDiscountToman: 0,
    total: 120000,
  }, signature, before);
  api.renderTotals();

  assert.equal(api.state.quoteChange.changes.some((change) => change.key === 'total'), true);
  assert.equal(getElement('checkout-price-review').hidden, false);
  assert.match(getElement('checkout-price-review-rows').innerHTML, /مبلغ نهایی/);
  assert.equal(getElement('checkout-submit').disabled, true);

  assert.equal(api.acceptQuoteChange(), true);
  assert.equal(api.state.quoteChange, null);
  assert.equal(getElement('checkout-price-review').hidden, true);
  assert.equal(getElement('checkout-submit').disabled, false);
  assert.equal(getElement('checkout-next-fulfillment').focused, true, 'focus moves to the next available action after the confirmation control hides');
  assert.match(getElement('checkout-stage-announcement').textContent, /مبلغ نهایی .* تأیید شد/);
});

test('matching server prices do not add an unnecessary confirmation step', () => {
  const { api, getElement } = createCheckoutRuntime();
  const item = { id: 10, name: 'قهوه', price: 90000, modifierGroups: [] };
  api.state.itemById.set(item.id, item);
  api.addToCart(item.id, []);
  const before = api.estimateVisiblePrices();
  const signature = api.currentQuoteSignature();
  api.applyQuote({ ok: true, quoteToken: 'same-price', ...before }, signature, before);
  api.renderTotals();
  assert.equal(api.state.quoteChange, null);
  assert.equal(getElement('checkout-price-review').hidden, true);
  assert.equal(getElement('checkout-submit').disabled, false);
});

test('a price confirmation cannot approve a quote after checkout inputs change', () => {
  const { api, getElement } = createCheckoutRuntime();
  const item = { id: 11, name: 'نوشیدنی', price: 50000, modifierGroups: [] };
  api.state.itemById.set(item.id, item);
  api.addToCart(item.id, []);
  const before = api.estimateVisiblePrices();
  const signature = api.currentQuoteSignature();
  api.applyQuote({ ok: true, quoteToken: 'stale-check', ...before, total: before.total + 1000 }, signature, before);
  getElement('checkout-table').value = '۱۴';

  assert.equal(api.acceptQuoteChange(), false);
  assert.equal(api.state.quote, null);
  assert.equal(api.state.quoteChange, null);
  assert.equal(getElement('checkout-submit').disabled, true);
});

test('checkout quote contract binds server-priced amounts and rejects customer/server price drift', () => {
  const secret = 'checkout-quote-test-secret';
  const now = 1_800_000_000_000;
  const intent = samplePricedQuoteIntent();
  const token = createCheckoutQuoteToken(secret, intent, now);

  assert.equal(verifyCheckoutQuoteToken(token, secret, intent, now + 1000).valid, true);
  assert.equal(verifyCheckoutQuoteToken(token, secret, intent, now + 15 * 60 * 1000 - 1).valid, true);
  assert.equal(verifyCheckoutQuoteToken(token, secret, intent, now + 15 * 60 * 1000).reason, 'expired');
  const changedIntents = [
    { ...intent, tenantId: 'another-tenant' },
    { ...intent, branchId: 5 },
    { ...intent, fulfillment: 'pickup' },
    { ...intent, phone: '09111111111' },
    { ...intent, items: [{ ...intent.items[0], modifiers: [{ groupId: 'size', id: 'regular', price: 0 }] }] },
    { ...intent, subtotal: intent.subtotal + 1, total: intent.total + 1 },
    { ...intent, deliveryFee: intent.deliveryFee + 1, total: intent.total + 1 },
    { ...intent, discount: intent.discount + 1, total: intent.total - 1 },
  ];
  for (const changed of changedIntents) {
    assert.equal(verifyCheckoutQuoteToken(token, secret, changed, now + 1000).valid, false);
  }

  const internallyInconsistent = { ...intent, total: intent.total + 1 };
  assert.deepEqual(validateCheckoutQuoteIntent(internallyInconsistent), { valid: false, reason: 'invalid_intent' });
  assert.equal(verifyCheckoutQuoteToken(token, secret, internallyInconsistent, now + 1000).reason, 'invalid_intent');
});

test('checkout quote amount contract fails closed for partial, fractional, negative and unsafe money', () => {
  const intent = samplePricedQuoteIntent();
  const invalidIntents = [
    { ...intent, deliveryFee: undefined },
    { ...intent, tenantId: 'invalid tenant' },
    { ...intent, tenantId: undefined },
    { ...intent, subtotal: 1.5 },
    { ...intent, discount: -1 },
    { ...intent, total: Number.MAX_SAFE_INTEGER + 1 },
    { ...intent, discount: intent.subtotal + 1, total: intent.deliveryFee - 1 },
    { ...intent, subtotal: Number.MAX_SAFE_INTEGER, deliveryFee: 1, total: Number.MAX_SAFE_INTEGER + 1, discount: 0 },
  ];
  for (const invalid of invalidIntents) {
    assert.equal(validateCheckoutQuoteIntent(invalid).valid, false);
    assert.throws(
      () => createCheckoutQuoteToken('checkout-quote-test-secret', invalid, 1_800_000_000_000),
      (error) => error.code === 'checkout_quote_intent_invalid',
    );
    assert.equal(
      verifyCheckoutQuoteToken('1800000000000.' + 'a'.repeat(64) + '.' + 'A'.repeat(43), 'secret', invalid, 1_800_000_000_001).valid,
      false,
    );
  }
});

test('quote math carries an inclusive finance snapshot without changing the menu-priced payable total', () => {
  const line = calculateModifierLinePrice(100001, 2, [{
    id: 'size', title: 'اندازه', selection: 'single', required: true,
    options: [{ id: 'large', name: 'بزرگ', price: 11001 }],
  }], [{ groupId: 'size', id: 'large' }]);
  assert.equal(line.ok, true);
  assert.equal(line.unitPrice, 111002);
  assert.equal(line.lineTotal, 222004);

  const discount = loyaltyEngine.calculateOrderDiscounts({
    loyalty: { tiers: [{ id: 'configured', name: 'تنظیم‌شده', minPoints: 0, minSpendToman: 0, discountPct: 5 }], redeemValue: 1000 },
  }, { subtotalToman: line.lineTotal });
  assert.equal(discount.tierDiscountToman, 11100, 'loyalty uses the current Math.round percentage calculation');
  assert.equal(discount.totalDiscountToman, 11100);

  const zone = { id: 9, branchId: 4, active: true, minOrder: 222004, fee: 31001, etaMinutes: 35 };
  const delivery = quoteFulfillment({ fulfillment: 'delivery', subtotal: line.lineTotal, zone, branchId: 4 });
  assert.equal(delivery.ok, true);
  assert.equal(delivery.total, 253005);
  assert.equal(quoteFulfillment({
    fulfillment: 'delivery', subtotal: line.lineTotal, zone: { ...zone, minOrder: line.lineTotal + 1 }, branchId: 4,
  }).code, 'delivery_minimum_not_met', 'the active zone minimum is enforced at equality boundaries');

  const intent = {
    ...samplePricedQuoteIntent(),
    subtotal: line.lineTotal,
    deliveryFee: delivery.deliveryFee,
    discount: discount.totalDiscountToman,
    total: delivery.total - discount.totalDiscountToman,
  };
  const lineGrossIrr = intent.subtotal * 10;
  const lineDiscountIrr = intent.discount * 10;
  const deliveryGrossIrr = intent.deliveryFee * 10;
  intent.taxSnapshot = {
    ...intent.taxSnapshot,
    grossIrr: (intent.subtotal + intent.deliveryFee) * 10,
    discountIrr: lineDiscountIrr,
    totalPayableIrr: intent.total * 10,
    lines: [{
      ...intent.taxSnapshot.lines[0],
      grossIrr: lineGrossIrr,
      discountIrr: lineDiscountIrr,
      taxableBaseIrr: lineGrossIrr - lineDiscountIrr,
      taxAmountIrr: 0,
    }],
    deliveryFee: {
      ...intent.taxSnapshot.deliveryFee,
      grossIrr: deliveryGrossIrr,
      taxableBaseIrr: deliveryGrossIrr,
      taxAmountIrr: 0,
    },
  };
  assert.equal(intent.total, 241905, 'checkout quote remains whole Toman and uses subtotal + delivery - loyalty discount');
  assert.equal(validateCheckoutQuoteIntent(intent).valid, true);

  const taxSettings = {
    defaultCategory: 'standard_1405',
    categories: [{ code: 'standard_1405', exempt: false, effectiveFrom: '2026-03-21' }],
    rules: [{
      id: 'current-rule', code: 'CURRENT_STANDARD', taxCategory: 'standard_1405', rate: 0.1,
      inclusive: false, effectiveFrom: '2026-03-21', status: 'active', version: 1,
      legalSource: 'test fixture only',
    }],
  };
  const tax = taxEngine.calculateTax(taxSettings, [{ unitPrice: 115, quantity: 1 }], {
    date: new Date('2026-09-23T12:00:00.000Z'), fulfillmentType: 'DELIVERY', locationId: 4,
  });
  assert.equal(tax.items[0].taxRate, 0.1, 'tax follows the effective tax-rule source rather than a quote-local rate');
  assert.equal(tax.items[0].taxAmount, 12, 'finance tax uses half-even rounding in integer Rials');
  assert.equal(intent.total, 241905, 'downstream tax in Rials is not silently mixed into the checkout Toman quote');
});

test('initial menu/meta failure has a safe retry path and successful retry restores ordering', async () => {
  let contentCalls = 0;
  let resolveFirstContent;
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  const failure = (status, body) => ({ ok: false, status, json: async () => body });
  const { api, getElement } = createCheckoutRuntime({
    fetchImpl: async (url) => {
      if (url === '/api/content') {
        contentCalls += 1;
        if (contentCalls === 1) {
          return new Promise((resolve) => { resolveFirstContent = resolve; });
        }
        return ok({
          menuCategories: [{ id: 1, title: 'غذاهای اصلی' }],
          menuItems: [{ id: 41, categoryId: 1, name: 'غذای آماده', price: 250000, available: true }],
        });
      }
      if (url.startsWith('/api/checkout/meta')) {
        return ok({ branches: [{ id: 7, name: 'شعبه مرکزی' }], deliveryZones: [], payment: { onlineEnabled: false } });
      }
      if (url === '/api/auth/me') return failure(401, { error: 'unauthenticated' });
      throw new Error(`unexpected checkout request: ${url}`);
    },
  });

  const loading = api.boot();
  const itemsRoot = getElement('checkout-items');
  assert.equal(itemsRoot.getAttribute('aria-busy'), 'true');
  assert.equal(itemsRoot.children[0].getAttribute('role'), 'status');
  assert.match(itemsRoot.children[0].textContent, /در حال بارگذاری/);

  resolveFirstContent(failure(503, { error: 'upstream_unavailable' }));
  await loading;
  assert.equal(itemsRoot.getAttribute('aria-busy'), 'false');
  const errorPanel = itemsRoot.children[0];
  assert.equal(errorPanel.getAttribute('role'), 'alert');
  assert.match(errorPanel.children[0].textContent, /اتصال را بررسی کنید/);
  assert.doesNotMatch(errorPanel.children[0].textContent, /upstream_unavailable/);

  const retry = errorPanel.children[1];
  assert.equal(retry.textContent, 'تلاش دوباره');
  await retry.listeners.get('click')();
  assert.equal(contentCalls, 2);
  assert.equal(api.state.booted, true);
  assert.equal(itemsRoot.getAttribute('aria-busy'), 'false');
  assert.match(itemsRoot.innerHTML, /غذای آماده/);
});
