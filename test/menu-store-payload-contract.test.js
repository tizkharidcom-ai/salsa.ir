'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const STORE_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'menu-store.js'), 'utf8');

function validMenu(itemId = 41, categoryId = 7) {
  return {
    menuItems: [{ id: itemId, categoryId, name: `Item ${itemId}`, available: true }],
    menuCategories: [{ id: categoryId, title: `Category ${categoryId}` }],
    siteCategories: [{ id: categoryId, title: `Category ${categoryId}`, coverImg: 'food.webp' }],
    menuRevision: itemId,
  };
}

function bootStore({ search = '', stored = {}, bootstrap, fetchResponse } = {}) {
  class TestCustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  const storage = new Map(Object.entries(stored));
  const events = [];
  const requests = [];
  const idleCallbacks = new Map();
  let nextIdleId = 1;
  const window = {
    dispatchEvent(event) { events.push(event); },
    addEventListener() {},
    requestIdleCallback(callback) {
      const id = nextIdleId++;
      idleCallbacks.set(id, callback);
      return id;
    },
    cancelIdleCallback(id) { idleCallbacks.delete(id); },
    setTimeout() { return 1; },
    clearTimeout() {},
  };
  if (bootstrap !== undefined) window.__WESTO_CONTENT__ = { menu: bootstrap };

  const context = {
    window,
    CustomEvent: TestCustomEvent,
    URLSearchParams,
    location: { search },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    async fetch(url) {
      requests.push(String(url));
      if (typeof fetchResponse === 'function') return fetchResponse(String(url));
      return fetchResponse;
    },
    console: { warn() {} },
    Date,
    Promise,
    Object,
    Array,
    Number,
    String,
    Boolean,
  };

  vm.runInNewContext(STORE_SOURCE, context, { filename: 'menu-store.js' });
  return {
    store: window.westoMenuStore,
    events,
    requests,
    storage,
    flushIdle() {
      const callbacks = [...idleCallbacks.values()];
      idleCallbacks.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}

function json(value) {
  return JSON.parse(JSON.stringify(value));
}

function response(data) {
  return { ok: true, json: async () => data };
}

test('HTTP 200 payload must have canonical collections and structurally valid entries', async (t) => {
  const malformedPayloads = [
    ['missing menuItems', { menuCategories: [] }],
    ['non-array menuItems', { menuItems: {}, menuCategories: [] }],
    ['missing menuCategories', { menuItems: [], siteCategories: [] }],
    ['non-array siteCategories', { menuItems: [], menuCategories: [], siteCategories: null }],
    ['malformed menu item', { menuItems: [{}], menuCategories: [] }],
    ['null menu item', { menuItems: [null], menuCategories: [] }],
    ['malformed menu category', { menuItems: [], menuCategories: [{}] }],
    ['primitive menu category', { menuItems: [], menuCategories: ['7'] }],
    ['malformed site category entry', { menuItems: [], menuCategories: [], siteCategories: [{}] }],
  ];

  for (const [name, payload] of malformedPayloads) {
    await t.test(name, async () => {
      const lastKnownGood = validMenu(99, 12);
      const serializedSnapshot = JSON.stringify({ savedAt: 123, data: lastKnownGood });
      const harness = bootStore({
        stored: { westo_menu_cache: serializedSnapshot },
        fetchResponse: response(payload),
      });

      await harness.store.ready;

      assert.deepEqual(json(harness.store.data), lastKnownGood);
      assert.equal(harness.store.fromCache, true);
      assert.ok(harness.store.lastError, 'invalid HTTP 200 payload is surfaced as a refresh error');
      assert.equal(harness.events.length, 1, 'the invalid response does not emit a replacement menu event');
      assert.equal(harness.storage.get('westo_menu_cache'), serializedSnapshot);
    });
  }
});

test('malformed HTTP 200 without a cached snapshot resolves to an empty offline fallback, not bad data', async () => {
  const harness = bootStore({
    fetchResponse: response({ menuItems: [{ id: 1, categoryId: 2 }], menuCategories: {} }),
  });

  await harness.store.ready;

  assert.deepEqual(json(harness.store.data), {
    menuCategories: [],
    menuItems: [],
    siteCategories: [],
  });
  assert.ok(harness.store.lastError);
  assert.equal(harness.events.length, 0);
  assert.equal(harness.storage.has('westo_menu_cache'), false, 'invalid payload is never persisted');
});

test('valid empty collections remain canonical and optional siteCategories may be omitted', async () => {
  const emptyMenu = { menuItems: [], menuCategories: [] };
  const harness = bootStore({ fetchResponse: response(emptyMenu) });

  await harness.store.ready;
  harness.flushIdle();

  assert.deepEqual(json(harness.store.data), emptyMenu);
  assert.equal(harness.store.lastError, null);
  assert.deepEqual(json(harness.store.categories), []);
  assert.equal(JSON.parse(harness.storage.get('westo_menu_cache')).data.menuItems.length, 0);
});

test('branch cache identity and offline fallback remain isolated from the global snapshot', async () => {
  const globalMenu = validMenu(1, 2);
  const branchMenu = validMenu(22, 8);
  const stored = {
    westo_menu_cache: JSON.stringify({ savedAt: 100, data: globalMenu }),
    'westo_menu_cache:v2:branch:2': JSON.stringify({ savedAt: 200, data: branchMenu }),
  };
  const harness = bootStore({
    search: '?branchId=%DB%B2',
    stored,
    fetchResponse: async () => { throw new Error('offline'); },
  });

  await harness.store.ready;

  assert.deepEqual(harness.requests, ['/api/menu?branch=2']);
  assert.deepEqual(json(harness.store.data), branchMenu);
  assert.equal(harness.store.fromCache, true);
  assert.ok(harness.store.lastError);
  assert.equal(harness.storage.get('westo_menu_cache'), stored.westo_menu_cache);
});

test('a valid branch response is applied and persisted under only its branch-specific key', async () => {
  const branchMenu = validMenu(222, 18);
  const harness = bootStore({
    search: '?branch=18',
    stored: { westo_menu_cache: JSON.stringify({ savedAt: 1, data: validMenu(1, 2) }) },
    fetchResponse: response(branchMenu),
  });

  await harness.store.ready;
  harness.flushIdle();

  assert.deepEqual(harness.requests, ['/api/menu?branch=18']);
  assert.deepEqual(json(harness.store.data), branchMenu);
  assert.equal(harness.store.fromCache, false);
  assert.equal(harness.storage.has('westo_menu_cache:v2:branch:18'), true);
  assert.deepEqual(
    JSON.parse(harness.storage.get('westo_menu_cache:v2:branch:18')).data,
    branchMenu,
  );
  assert.equal(
    JSON.parse(harness.storage.get('westo_menu_cache')).data.menuItems[0].id,
    1,
    'branch refresh does not overwrite the unscoped cache',
  );
});
