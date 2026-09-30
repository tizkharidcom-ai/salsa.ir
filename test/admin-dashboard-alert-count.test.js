'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadDashboardView({ failStorage = false } = {}) {
  const handlers = new Map();
  const storage = new Map();
  const alertCount = { dataset: { count: '1' }, textContent: '۱' };
  const emptyState = { hidden: true };
  const card = {
    style: {},
    removed: false,
    remove() { this.removed = true; },
  };
  const button = {
    dataset: { snoozeAlert: 'order-delayed-42' },
    addEventListener(type, handler) { handlers.set(type, handler); },
    closest(selector) { return selector === '.vital-alert-card' ? card : null; },
  };
  const container = {
    querySelectorAll(selector) { return selector === '[data-snooze-alert]' ? [button] : []; },
    querySelector(selector) {
      if (selector === '[data-vital-alert-count]') return alertCount;
      if (selector === '[data-vital-alert-empty]') return emptyState;
      return null;
    },
  };
  const window = { addEventListener() {} };
  const document = { getElementById() { return null; } };
  const context = {
    window,
    document,
    localStorage: { getItem() { return null; }, setItem() {} },
    sessionStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) {
        if (failStorage) throw new Error('storage unavailable');
        storage.set(key, value);
      },
    },
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout(callback) { callback(); },
    console,
  };

  const source = fs.readFileSync(path.join(__dirname, '../js/admin/modules/insights/dashboard-view.js'), 'utf8');
  vm.runInNewContext(source, context, { filename: 'dashboard-view.js' });
  const toasts = [];
  window.WestoDashboardView.bindEvents(container, {}, { showToast(message, type) { toasts.push({ message, type }); } });
  return { handlers, storage, alertCount, emptyState, card, toasts };
}

test('snoozing the final visible dashboard alert updates the total and empty state', () => {
  const { handlers, storage, alertCount, emptyState, card } = loadDashboardView();
  let propagationStopped = false;

  handlers.get('click')({ stopPropagation() { propagationStopped = true; } });

  assert.equal(propagationStopped, true);
  assert.equal(storage.has('westo_snoozed_alerts'), true);
  assert.equal(alertCount.dataset.count, '0');
  assert.equal(alertCount.textContent, '۰');
  assert.equal(emptyState.hidden, false);
  assert.equal(card.removed, true);
});

test('failed snooze persistence keeps the alert visible and reports that it was not saved', () => {
  const { handlers, storage, alertCount, emptyState, card, toasts } = loadDashboardView({ failStorage: true });

  handlers.get('click')({ stopPropagation() {} });

  assert.equal(storage.has('westo_snoozed_alerts'), false);
  assert.equal(alertCount.dataset.count, '1');
  assert.equal(alertCount.textContent, '۱');
  assert.equal(emptyState.hidden, true);
  assert.equal(card.removed, false);
  assert.deepEqual(toasts, [{ message: 'تعویق هشدار ذخیره نشد؛ هشدار در فهرست باقی ماند.', type: 'error' }]);
});
