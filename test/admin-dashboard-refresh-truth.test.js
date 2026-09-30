'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadDashboard({
  refresh = async () => {},
  initialNow = 1_000,
  currentNow = initialNow,
  audioInitiallyEnabled = false,
  storageWriteFails = false,
} = {}) {
  let now = initialNow;
  let nowCalls = 0;
  class TestDate extends Date {
    static now() { nowCalls += 1; return now; }
  }
  const window = { addEventListener() {} };
  const preferences = new Map([['westo_admin_audio_enabled', audioInitiallyEnabled ? 'true' : 'false']]);
  const sandbox = {
    window,
    Date: TestDate,
    document: { getElementById(id) { return buttons[id] || null; } },
    localStorage: {
      getItem(key) { return preferences.get(key) || null; },
      setItem(key, value) {
        if (storageWriteFails) throw new Error('storage unavailable');
        preferences.set(key, value);
      },
    },
    sessionStorage: { getItem() { return null; }, setItem() {} },
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout() {},
    console,
  };
  const source = fs.readFileSync(path.join(__dirname, '../js/admin/modules/insights/dashboard-view.js'), 'utf8');
  vm.runInNewContext(source, sandbox, { filename: 'dashboard-view.js' });

  const buttons = {};
  function makeButton(id) {
    const classes = new Set();
    const handlers = {};
    return {
      id,
      disabled: false,
      attributes: {},
      handlers,
      innerHTML: '',
      classList: {
        add(value) { classes.add(value); },
        remove(value) { classes.delete(value); },
        toggle(value, force = !classes.has(value)) { force ? classes.add(value) : classes.delete(value); return force; },
        contains(value) { return classes.has(value); },
      },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(type, handler) { handlers[type] = handler; },
    };
  }
  const refreshButton = buttons['vital-refresh-btn'] = makeButton('vital-refresh-btn');
  const pauseButton = buttons['vital-pause-toggle'] = makeButton('vital-pause-toggle');
  const audioButton = buttons['vital-audio-toggle'] = makeButton('vital-audio-toggle');
  const container = {
    querySelector(selector) { return buttons[selector.slice(1)] || null; },
    querySelectorAll() { return []; },
  };
  const toasts = [];
  window.WestoDashboardView.bindEvents(container, {}, {
    tabs: { dashboard: refresh },
    showToast(message, type) { toasts.push({ message, type }); },
  });

  return {
    view: window.WestoDashboardView,
    refreshButton,
    pauseButton,
    audioButton,
    refreshHandler: refreshButton.handlers.click,
    pauseHandler: pauseButton.handlers.click,
    audioHandler: audioButton.handlers.click,
    toasts,
    nowCalls: () => nowCalls,
    setNow(value) { now = value; },
    currentNow,
  };
}

function renderPayload() {
  return {
    d: { summary: {}, queue: [], reservations: [], handoffAttention: [], lowStock: [] },
    live: { metrics: {} },
    stats: { topItems: [] },
    financeResult: {},
    beResult: null,
    currentBranch: null,
    currentUser: null,
    hasCapability: () => false,
    esc: String,
    fmtMoney: () => '۰',
    fmtNum: (value) => String(value),
    sparkBars: () => '',
    fulfillmentLabel: () => '',
    statusLabel: () => '',
    renderDashboardBreakEvenShell: () => '',
  };
}

test('dashboard snapshot time advances when a fresh dashboard render succeeds', () => {
  const harness = loadDashboard({ initialNow: 1_000, currentNow: 100_000 });
  harness.setNow(100_000);

  const html = harness.view.render(renderPayload(), {});

  assert.match(html, /هم‌اکنون بروز شد/);
});

test('admin shell cache-busts the dashboard refresh behavior', () => {
  const adminHtml = fs.readFileSync(path.join(__dirname, '../admin.html'), 'utf8');
  assert.match(adminHtml, /dashboard-view\.js\?v=dashboardV4-toggle-accessibility/);
});

test('dashboard pause toggle exposes and updates its pressed state', () => {
  const harness = loadDashboard();

  harness.pauseHandler();
  assert.equal(harness.pauseButton.attributes['aria-pressed'], 'true');
  assert.equal(harness.pauseButton.attributes['aria-label'], 'بروزرسانی خودکار');
  assert.equal(harness.pauseButton.attributes.title, 'ادامه بروزرسانی خودکار');
  assert.equal(harness.pauseButton.classList.contains('is-paused'), true);

  harness.pauseHandler();
  assert.equal(harness.pauseButton.attributes['aria-pressed'], 'false');
  assert.equal(harness.pauseButton.attributes.title, 'توقف موقت بروزرسانی خودکار');
});

test('dashboard audio toggle updates its state and icon without refreshing the dashboard', () => {
  let refreshCalls = 0;
  const harness = loadDashboard({ refresh: async () => { refreshCalls += 1; } });

  harness.audioHandler();
  assert.equal(harness.audioButton.attributes['aria-pressed'], 'true');
  assert.equal(harness.audioButton.attributes['aria-label'], 'صدای اعلان‌ها');
  assert.equal(harness.audioButton.classList.contains('active'), true);
  assert.match(harness.audioButton.innerHTML, /<path d="M19\.07/);
  assert.equal(refreshCalls, 0);
});

test('dashboard audio toggle reports when the preference cannot be persisted', () => {
  const harness = loadDashboard({ storageWriteFails: true });

  harness.audioHandler();

  assert.equal(harness.audioButton.attributes['aria-pressed'], undefined);
  assert.equal(harness.audioButton.classList.contains('active'), false);
  assert.deepEqual(harness.toasts, [{ message: 'تنظیم صدای اعلان‌ها ذخیره نشد.', type: 'error' }]);
});

test('failed manual refresh preserves the prior sync time, reports failure, and unlocks the control', async () => {
  const harness = loadDashboard({
    initialNow: 1_000,
    currentNow: 100_000,
    refresh: async () => { throw new Error('network unavailable'); },
  });
  const callsBefore = harness.nowCalls();

  await harness.refreshHandler();

  assert.equal(harness.nowCalls(), callsBefore);
  assert.deepEqual(harness.toasts, [{
    message: 'به‌روزرسانی انجام نشد؛ وضعیت قبلی حفظ شد. اتصال را بررسی کنید و دوباره تلاش کنید.',
    type: 'error',
  }]);
  assert.equal(harness.refreshButton.disabled, false);
  assert.equal(harness.refreshButton.attributes['aria-busy'], 'false');
  assert.equal(harness.refreshButton.classList.contains('spinning'), false);
});

test('successful manual refresh announces completion and always restores the control', async () => {
  const harness = loadDashboard({ initialNow: 1_000, currentNow: 100_000 });
  harness.setNow(100_000);

  await harness.refreshHandler();

  assert.deepEqual(harness.toasts, [{ message: 'شاخص‌های داشبورد به‌روزرسانی شدند', type: 'success' }]);
  assert.equal(harness.refreshButton.disabled, false);
  assert.equal(harness.refreshButton.attributes['aria-busy'], 'false');
  assert.equal(harness.refreshButton.classList.contains('spinning'), false);
});

test('manual refresh shows a busy state and ignores repeat clicks until the request settles', async () => {
  let release;
  let calls = 0;
  const harness = loadDashboard({
    refresh: () => {
      calls += 1;
      return new Promise((resolve) => { release = resolve; });
    },
  });

  const firstRefresh = harness.refreshHandler();
  assert.equal(harness.refreshButton.disabled, true);
  assert.equal(harness.refreshButton.attributes['aria-busy'], 'true');
  assert.equal(harness.refreshButton.classList.contains('spinning'), true);
  await harness.refreshHandler();
  assert.equal(calls, 1);

  release();
  await firstRefresh;
  assert.equal(harness.refreshButton.disabled, false);
  assert.equal(harness.refreshButton.attributes['aria-busy'], 'false');
  assert.equal(harness.refreshButton.classList.contains('spinning'), false);
});
