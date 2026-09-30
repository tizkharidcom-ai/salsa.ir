'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const checkoutSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'checkout.js'), 'utf8');
const checkoutCss = fs.readFileSync(path.join(__dirname, '..', 'css', 'checkout.css'), 'utf8');
const orderHtml = fs.readFileSync(path.join(__dirname, '..', 'order.html'), 'utf8');

function createCheckoutA11yRuntime(fulfillment = 'delivery') {
  const elements = new Map();
  class Element {
    constructor(id = '', tagName = 'div') {
      this.id = id;
      this.tagName = tagName.toLowerCase();
      this.value = '';
      this.textContent = '';
      this.className = '';
      this.hidden = false;
      this.attributes = new Map();
      this.children = [];
      this.focused = false;
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) || null; }
    removeAttribute(name) { this.attributes.delete(name); }
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      if (child.id) elements.set(child.id, child);
      return child;
    }
    closest(selector) {
      let current = this;
      while (current) {
        if (selector === 'label' && current.tagName === 'label') return current;
        current = current.parentElement;
      }
      return null;
    }
    focus() { this.focused = true; }
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      elements.delete(this.id);
    }
  }
  const make = (id, tagName) => {
    const element = new Element(id, tagName);
    elements.set(id, element);
    return element;
  };
  const addField = (id, tagName = 'input', describedBy = '') => {
    const label = make(`${id}-label`, 'label');
    const field = make(id, tagName);
    label.appendChild(field);
    if (describedBy) field.setAttribute('aria-describedby', describedBy);
    return { label, field };
  };

  const ids = [
    'checkout-form', 'checkout-cart', 'checkout-message', 'checkout-live',
    'checkout-note-text', 'checkout-payment-note', 'cart-count', 'checkout-success',
    'checkout-success-title', 'checkout-success-body',
  ];
  ids.forEach((id) => make(id));
  const fields = new Map();
  for (const [id, tag, describedBy] of [
    ['checkout-branch', 'select', ''],
    ['checkout-table', 'input', 'checkout-qr-hint'],
    ['checkout-zone', 'select', ''],
    ['checkout-address', 'textarea', ''],
    ['checkout-name', 'input', ''],
    ['checkout-phone', 'input', ''],
    ['checkout-payment', 'select', 'checkout-payment-note'],
    ['checkout-note', 'textarea', ''],
    ['checkout-instructions', 'input', ''],
  ]) fields.set(id, addField(id, tag, describedBy).field);
  const side = make('checkout-side', 'aside');
  const document = {
    body: make('body', 'body'),
    getElementById: (id) => elements.get(id) || null,
    createElement: (tag) => new Element('', tag),
    querySelector(selector) {
      if (selector === 'input[name="fulfillment"]:checked') return { value: fulfillment };
      if (selector === '.checkout-side') return side;
      return null;
    },
  };
  const window = {
    westoI18n: { lang: 'fa', t: (key) => key },
    addEventListener() {},
    setTimeout,
    clearTimeout,
    matchMedia: () => ({ matches: true }),
  };
  const context = {
    document,
    window,
    location: { search: '' },
    URLSearchParams,
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
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async () => { throw new Error('network access must not be used by accessibility helpers'); },
  };
  context.globalThis = context;
  window.document = document;

  const testSource = checkoutSource.replace(
    /\n  boot\(\);\n\}\)\(\);\s*$/,
    `
  window.__checkoutA11yTestApi = {
    state, ensureCheckoutAccessibility, checkoutValidationStage,
    reportGuestCheckoutError, clearCheckoutFieldError, setMessage
  };
})();`,
  );
  assert.notEqual(testSource, checkoutSource, 'test harness must suppress automatic boot');
  vm.runInNewContext(testSource, context, { filename: 'js/checkout.js' });
  return { api: window.__checkoutA11yTestApi, elements, fields, side };
}

test('checkout fields receive persistent hints without replacing existing descriptions', () => {
  const { api, elements, fields, side } = createCheckoutA11yRuntime('delivery');
  api.ensureCheckoutAccessibility();

  assert.equal(elements.get('checkout-form').getAttribute('aria-label'), 'اطلاعات دریافت و ثبت سفارش');
  assert.equal(fields.get('checkout-address').getAttribute('aria-required'), 'true');
  assert.equal(fields.get('checkout-table').getAttribute('aria-required'), 'false');
  assert.equal(fields.get('checkout-phone').getAttribute('aria-describedby'), 'checkout-phone-hint');
  assert.equal(fields.get('checkout-table').getAttribute('aria-describedby'), 'checkout-qr-hint checkout-table-hint');
  assert.equal(elements.get('checkout-phone-hint').textContent, 'شماره همراه باید ۱۱ رقم و با ۰۹ شروع شود.');
  assert.equal(side.getAttribute('tabindex'), '-1');
  assert.equal(elements.get('checkout-message').getAttribute('aria-atomic'), 'true');
});

test('an unlabeled field gets a fallback name while an existing accessible name is preserved', () => {
  const { api, fields } = createCheckoutA11yRuntime();
  fields.get('checkout-name').parentElement = null;
  fields.get('checkout-note').setAttribute('aria-label', 'یادداشت برای آشپزخانه');
  api.ensureCheckoutAccessibility();

  assert.equal(fields.get('checkout-name').getAttribute('aria-label'), 'نام سفارش‌گیرنده');
  assert.equal(fields.get('checkout-note').getAttribute('aria-label'), 'یادداشت برای آشپزخانه');
});

test('step validation announces the stage and associates a focused field with its inline error', () => {
  const { api, elements, fields } = createCheckoutA11yRuntime('delivery');
  api.ensureCheckoutAccessibility();
  api.reportGuestCheckoutError({ field: 'checkout-phone', message: 'شماره موبایل معتبر نیست.' });

  const phone = fields.get('checkout-phone');
  const message = elements.get('checkout-message');
  assert.equal(api.checkoutValidationStage('checkout-phone'), 'اطلاعات گیرنده');
  assert.equal(phone.getAttribute('aria-invalid'), 'true');
  assert.equal(phone.getAttribute('aria-describedby'), 'checkout-phone-hint checkout-phone-error');
  assert.equal(elements.get('checkout-phone-error').textContent, 'شماره موبایل معتبر نیست.');
  assert.match(message.textContent, /^اطلاعات گیرنده:/);
  assert.equal(message.getAttribute('role'), 'alert');
  assert.equal(message.getAttribute('aria-live'), 'assertive');
  assert.equal(message.getAttribute('data-validation-field'), 'checkout-phone');
  assert.equal(phone.focused, true);
});

test('correcting the invalid field removes only its error and preserves its hint', () => {
  const { api, elements, fields } = createCheckoutA11yRuntime();
  api.ensureCheckoutAccessibility();
  const phone = fields.get('checkout-phone');
  api.reportGuestCheckoutError({ field: 'checkout-phone', message: 'شماره موبایل معتبر نیست.' });
  api.clearCheckoutFieldError(phone);

  assert.equal(phone.getAttribute('aria-invalid'), null);
  assert.equal(phone.getAttribute('aria-describedby'), 'checkout-phone-hint');
  assert.equal(elements.get('checkout-phone-error'), undefined);
  assert.equal(elements.get('checkout-message').textContent, '');
});

test('checkout mobile controls keep readable text, visible focus and 48px touch targets', () => {
  assert.match(checkoutCss, /\.checkout-field-error\s*\{[^}]*font-weight:\s*700/s);
  assert.match(checkoutCss, /\.checkout-load-retry\s*\{[^}]*min-height:\s*48px/s);
  assert.match(checkoutCss, /@media\s*\(max-width:\s*560px\)[\s\S]*?\.checkout-category,[\s\S]*?#checkout-submit[^}]*min-height:\s*48px/s);
  assert.match(checkoutCss, /#checkout-payment-handoff\s*\{[^}]*min-height:\s*48px/s);
  assert.match(checkoutCss, /\.checkout-price-review button,[\s\S]*?#close-address-modal-btn\s*\{[^}]*min-height:\s*48px/s);
  assert.match(checkoutCss, /#checkout-payment-handoff,\s*#close-address-modal-btn\s*\{\s*min-height:\s*48px\s*!important;/);
  assert.match(checkoutCss, /#close-address-modal-btn\s*\{\s*min-width:\s*48px\s*!important;/);
  assert.match(checkoutCss, /\.checkout-price-review p,[\s\S]*?\.checkout-price-review li\s*\{[^}]*font-size:\s*\.9rem/s);
  assert.match(checkoutCss, /\.checkout-fields \[aria-invalid='true'\][^{]*\{[^}]*scroll-margin-block/s);
  assert.match(checkoutCss, /\.checkout-category:focus-visible[\s\S]*?#checkout-submit:focus-visible/);
  assert.match(orderHtml, /name="viewport"[^>]*width=device-width[^>]*initial-scale=1/);
  assert.match(orderHtml, /class="checkout-brand"[^>]*min-height:44px/);
  assert.match(orderHtml, /id="close-address-modal-btn"[^>]*min-width:44px; min-height:44px/);
  assert.match(orderHtml, /id="checkout-view-history-btn"[^>]*min-height:44px/);
  assert.match(orderHtml, /id="checkout-new-order-btn"[^>]*min-height:44px/);
  assert.match(orderHtml, /id="checkout-payment-handoff"[^>]*min-height:44px/);
});

test('external payment handoff suppresses the checkout referrer', () => {
  assert.match(orderHtml, /id="checkout-payment-handoff"[^>]*rel="noopener noreferrer"[^>]*referrerpolicy="no-referrer"/);
});

test('address entry does not assume a city or silently replace a saved default', () => {
  assert.match(orderHtml, /id="modal-addr-city"[^>]*placeholder="نام شهر"/);
  assert.doesNotMatch(orderHtml, /id="modal-addr-city"[^>]*value=/);
  assert.match(checkoutSource, /\$\('modal-addr-city'\)\.value = ''/);
  assert.match(checkoutSource, /\$\('modal-addr-default'\)\.checked = !\(state\.userAddresses\?\.length > 0\)/);
  assert.doesNotMatch(checkoutSource, /\$\('#(?:modal-addr|save-address|close-address)-/,
    'getElementById receives plain IDs, never CSS selectors');
});

test('address modal is announced, keyboard-dismissible and scrollable with mobile-sized fields', () => {
  assert.match(orderHtml, /id="address-modal"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-hidden="true"/);
  assert.match(checkoutSource, /requestAnimationFrame\(\(\) => \$\('modal-addr-city'\)\?\.focus/);
  assert.match(checkoutSource, /modal\.addEventListener\('keydown',[\s\S]*?event\.key === 'Escape'[\s\S]*?event\.key !== 'Tab'/);
  assert.match(checkoutSource, /\$\('close-address-modal-btn'\)\?\.addEventListener\('click',[\s\S]*?closeModal\(\)/);
  assert.match(checkoutCss, /\.address-modal-box\s*\{[^}]*max-height:[^}]*overflow-y:\s*auto/s);
  assert.match(checkoutCss, /@media\s*\(max-width:\s*560px\)[\s\S]*?\.address-modal-row--details[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s*!important/);
  assert.match(checkoutCss, /\.address-modal-box input,[\s\S]*?min-height:\s*48px;[\s\S]*?font-size:\s*1rem\s*!important/);
});
