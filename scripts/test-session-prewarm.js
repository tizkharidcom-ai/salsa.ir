'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { performance } = require('perf_hooks');

const ROOT = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(ROOT, 'js/westo-smart-loader.js'), 'utf8');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createRuntime({ saveData = false } = {}) {
  const calls = [];
  class FakeImage {
    constructor() {
      this.dataset = {};
      this.complete = false;
      this.naturalWidth = 0;
      this._src = '';
      this.classList = { contains: () => false };
    }
    set src(value) {
      this._src = String(value || '');
      this.complete = Boolean(value);
      this.naturalWidth = value ? 96 : 0;
      if (value) setTimeout(() => this.onload?.(), 0);
    }
    get src() { return this._src; }
    decode() { return Promise.resolve(); }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
  }
  const document = {
    hidden: false, readyState: 'loading', head: { appendChild() {} },
    addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    getElementById() { return null; }, createElement() { return { dataset: {} }; },
  };
  const window = {
    __WESTO_SMART_TEST_NO_BOOT__: true,
    __WESTO_TEST_AVIF_SUPPORT__: false,
    matchMedia: () => ({ matches: false }), addEventListener() {}, dispatchEvent() {},
    requestIdleCallback(callback) { setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 0); },
  };
  window.window = window;
  const context = {
    window, document,
    navigator: { deviceMemory: 2, connection: { saveData, effectiveType: '2g', addEventListener() {} } },
    location: { href: 'http://westo.test/' }, performance, URL, Blob, DOMException, AbortController,
    Image: FakeImage, CustomEvent: class {}, IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    requestAnimationFrame: (callback) => setTimeout(() => callback(performance.now()), 0), setTimeout, clearTimeout, Promise, console,
    fetch(url, init = {}) {
      const source = String(url);
      calls.push(source);
      const delay = source.includes('/previews/') ? 2 : 18;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ ok: true, status: 200, blob: async () => new Blob([source]) }), delay);
        init.signal?.addEventListener?.('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'westo-smart-loader.js' });
  return { resources: context.window.WestoResources, calls, FakeImage };
}

(async () => {
  const { resources, calls, FakeImage } = createRuntime({ saveData: true });
  const items = Array.from({ length: 6 }, (_, index) => ({ id: index + 1, categoryId: index < 3 ? 1 : 2, img: `/menu/${index + 1}.webp` }));
  resources.registerMenu({
    siteCategories: [{ id: 1, coverImg: '/category-1.webp' }, { id: 2, coverImg: '/category-2.webp' }],
    menuItems: items,
  });
  resources.primeInitial();
  await resources.startBackgroundFill('test-full-session');

  for (const item of items) {
    const full = `http://westo.test${item.img}`;
    const preview = `http://westo.test/menu/previews/${item.id}.webp`;
    if (!calls.includes(full)) throw new Error(`full image was not session-warmed: ${full}`);
    if (!calls.includes(preview)) throw new Error(`preview was not session-warmed: ${preview}`);
  }
  if (!resources.metrics.backgroundFillComplete || resources.metrics.budget.background !== true) {
    throw new Error('full session warm must continue even with Data Saver enabled');
  }

  const image = new FakeImage();
  image.src = '/old.webp';
  const before = calls.length;
  const progressive = resources.bindProgressiveImage(image, '/special.webp', { priority: resources.priorities.NEAR, decode: true });
  await wait(8);
  if (!/\/previews\/special\.webp$/.test(image.src) || image.dataset.westoPreview !== '1') {
    throw new Error('progressive binding did not paint the compact preview first');
  }
  const duplicate = resources.bindProgressiveImage(image, '/special.webp', { priority: resources.priorities.NEAR, decode: true });
  await Promise.all([progressive, duplicate]);
  const specialCalls = calls.slice(before).filter((url) => /\/special\.webp$|\/previews\/special\.webp$/.test(url));
  const previewCalls = specialCalls.filter((url) => /\/previews\/special\.webp$/.test(url));
  const fullCalls = specialCalls.filter((url) => /\/special\.webp$/.test(url) && !url.includes('/previews/'));
  if (previewCalls.length !== 1 || fullCalls.length !== 1) {
    throw new Error(`progressive binding duplicated network work: ${JSON.stringify(specialCalls)}`);
  }
  if (!/\/special\.webp$/.test(image.src) || image.dataset.appliedSource !== '/special.webp' || image.dataset.westoPreview) {
    throw new Error('full image did not replace the preview after decode');
  }
  if (resources.metrics.previewed !== 1 || resources.metrics.promoted !== 1) {
    throw new Error('a repeated progressive bind repainted or promoted the image more than once');
  }

  console.log(JSON.stringify({ pass: true, calls: calls.length, previewed: resources.metrics.previewed, promoted: resources.metrics.promoted, budget: resources.metrics.budget }, null, 2));
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
