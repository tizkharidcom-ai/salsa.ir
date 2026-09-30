'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');
const vm = require('node:vm');

const checkoutSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'checkout.js'), 'utf8');
const checkoutCss = fs.readFileSync(path.join(__dirname, '..', 'css', 'checkout.css'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

function createPaymentValidationRuntime() {
  const elements = new Map();
  class Element {
    constructor(id = '') {
      this.id = id;
      this.value = '';
      this.textContent = '';
      this.className = '';
      this.hidden = false;
      this.attributes = new Map();
      this.focused = false;
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) || null; }
    removeAttribute(name) { this.attributes.delete(name); }
    focus() { this.focused = true; }
    closest(selector) { return selector === 'label' ? this.label || null : null; }
    appendChild(child) {
      child.parentElement = this;
      this.children ||= [];
      this.children.push(child);
      if (child.id) elements.set(child.id, child);
    }
    remove() { elements.delete(this.id); }
  }
  const field = (id, value = '') => {
    const element = new Element(id);
    element.value = value;
    elements.set(id, element);
    return element;
  };
  for (const [id, value] of [
    ['checkout-name', 'مهمان'],
    ['checkout-phone', '09123456789'],
    ['checkout-payment', 'cashier'],
  ]) {
    const input = field(id, value);
    input.label = new Element(`${id}-label`);
  }
  field('checkout-message');

  const document = {
    getElementById: (id) => elements.get(id) || null,
    createElement: () => new Element(),
    querySelector: () => null,
    addEventListener() {},
  };
  const window = {
    document,
    westoI18n: { lang: 'fa', t: (key) => key },
    addEventListener() {},
  };
  const context = {
    document,
    window,
    location: { search: '' },
    URLSearchParams,
    AbortController,
    DOMException,
    Math,
    JSON,
    Number,
    String,
    Map,
    Set,
    Array,
    Object,
    RegExp,
  };
  context.globalThis = context;

  const testSource = checkoutSource.replace(
    /\n  boot\(\);\n\}\)\(\);\s*$/,
    `
  window.__checkoutPaymentTestApi = { state, validateCustomerFields, checkoutStageForField, reportGuestCheckoutError };
})();`,
  );
  assert.notEqual(testSource, checkoutSource, 'test harness must suppress automatic checkout boot');
  vm.runInNewContext(testSource, context, { filename: 'js/checkout.js' });
  return { api: window.__checkoutPaymentTestApi, elements };
}

test('guest payment validation accepts only the selected supported tender and keeps online fail-closed', () => {
  const { api, elements } = createPaymentValidationRuntime();
  const payment = elements.get('checkout-payment');

  assert.equal(api.validateCustomerFields(), null, 'cashier is an available guest payment method');

  payment.value = '';
  const missing = api.validateCustomerFields();
  assert.equal(missing.field, 'checkout-payment');
  assert.match(missing.message, /روش‌های موجود را انتخاب کنید/);

  payment.value = 'manual_card';
  const unsupported = api.validateCustomerFields();
  assert.equal(unsupported.field, 'checkout-payment');
  assert.equal(api.checkoutStageForField(unsupported.field), 'customer');
  api.reportGuestCheckoutError(unsupported);
  assert.equal(api.state.currentStage, 'customer');
  assert.equal(payment.getAttribute('aria-invalid'), 'true');
  assert.equal(payment.getAttribute('aria-describedby'), 'checkout-payment-error');
  assert.equal(elements.get('checkout-payment-error').textContent, unsupported.message);
  assert.equal(payment.focused, true);

  payment.value = 'online';
  api.state.payment = { onlineEnabled: false };
  assert.equal(api.validateCustomerFields().field, 'checkout-payment', 'online payment must remain unavailable unless live metadata is verified');

  api.state.payment = { onlineEnabled: true, gatewayReady: true, mode: 'production', provider: 'verified-gateway' };
  assert.equal(api.validateCustomerFields(), null, 'online is accepted only when the server reports a ready production gateway');
});

test('mobile payment selection stays readable and touch-accessible', () => {
  assert.match(checkoutCss, /@media\s*\(max-width:\s*560px\)[\s\S]*?\.checkout-fields input:not\(\[type='radio'\]\),\s*\.checkout-fields select,\s*\.checkout-fields textarea\s*\{[^}]*min-height:\s*48px/s);
  assert.match(checkoutCss, /\.checkout-fields input:not\(\[type='radio'\]\),\s*\.checkout-fields select,\s*\.checkout-fields textarea\s*\{[^}]*font-size:\s*1rem/s);
});

test('guest checkout replays an unknown outcome with the same key and payload and rejects incomplete success', () => {
  const sendStart = checkoutSource.indexOf('async function sendCheckoutIntent(');
  const submitStart = checkoutSource.indexOf('async function submit(event)', sendStart);
  assert.ok(sendStart >= 0 && submitStart > sendStart, 'checkout submit handlers exist');
  const sendHandler = checkoutSource.slice(sendStart, submitStart);
  const submitEnd = checkoutSource.indexOf('function bindListeners()', submitStart);
  const submitHandler = checkoutSource.slice(submitStart, submitEnd);

  assert.match(sendHandler, /headers:\s*\{\s*'Idempotency-Key':\s*intent\.key\s*\}/);
  assert.match(sendHandler, /body:\s*JSON\.stringify\(intent\.payload\)/);
  assert.match(sendHandler, /result\?\.ok\s*===\s*true/);
  assert.match(sendHandler, /checkout_order_confirmation_unknown/);
  assert.match(sendHandler, /lockUncertainCheckout\(pending\)/);
  assert.match(submitHandler, /sendCheckoutIntent\(state\.uncertainIntent,\s*\{\s*retrying:\s*true\s*\}\)/);
  assert.match(submitHandler, /state\.uncertainIntent\.manualFollowup\s*\|\|\s*!state\.uncertainIntent\.payload/);

  const routeStart = serverSource.indexOf("app.post('/api/checkout/orders'");
  const routeEnd = serverSource.indexOf("app.post('/api/checkout/payments/:id/sandbox-confirm'", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, 'public checkout order route exists');
  const orderRoute = serverSource.slice(routeStart, routeEnd);
  assert.match(orderRoute, /rawReceiptCode\s*=\s*req\.get\('Idempotency-Key'\)\s*\|\|\s*req\.body\?\.idempotencyKey[\s\S]*?normalizeCheckoutReceiptCode\(rawReceiptCode\)[\s\S]*?idempotencyKey:\s*checkoutReceiptIndexKey\(receiptCode\)/);
});
