'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { performance } = require('perf_hooks');

const ROOT = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(ROOT, 'js/westo-smart-loader.js'), 'utf8');

function runScenario(source) {
  const calls = [];
  class FakeImage {
    constructor() { this.dataset = {}; this.naturalWidth = 0; this.complete = false; }
    set src(value) {
      this._src = String(value || '');
      this.complete = Boolean(value);
      this.naturalWidth = value ? 1 : 0;
      if (value) setTimeout(() => this.onload?.(), 0);
    }
    get src() { return this._src || ''; }
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
    matchMedia: () => ({ matches: false }), addEventListener() {}, dispatchEvent() {},
    requestIdleCallback(callback) { setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 0); },
  };
  window.window = window;
  const context = {
    window, document, navigator: { deviceMemory: 8, connection: { effectiveType: '4g', addEventListener() {} } },
    location: { href: 'http://westo.test/' }, performance, URL, Blob, DOMException, AbortController,
    Image: FakeImage, CustomEvent: class {}, IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    requestAnimationFrame: (callback) => setTimeout(() => callback(performance.now()), 0), setTimeout, clearTimeout, Promise, console,
    fetch(url) {
      const source = String(url); calls.push(source);
      return Promise.resolve({ ok: true, status: 200, blob: async () => new Blob([source]) });
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'westo-smart-loader.js' });
  return context.window.WestoResources.requestImage(source, { priority: 100 }).then((result) => ({ calls, result }));
}

(async () => {
  const webp = await runScenario('/assets/menu/dish.webp');
  if (webp.calls.length !== 1 || !webp.calls[0].endsWith('/assets/menu/dish.webp') || webp.result.format !== 'webp') {
    throw new Error('menu media must request its WebP source directly');
  }

  const legacy = await runScenario('/assets/menu/legacy.avif');
  if (legacy.calls.length !== 1 || !legacy.calls[0].endsWith('/assets/menu/legacy.webp') || legacy.result.format !== 'webp') {
    throw new Error('legacy local image paths must be translated to WebP before fetching');
  }

  if ([...webp.calls, ...legacy.calls].some((url) => /\.avif(?:$|[?#])/i.test(url))) {
    throw new Error('the image scheduler must never request AVIF media');
  }

  console.log(JSON.stringify({ pass: true, webpCalls: webp.calls, legacyMappedCalls: legacy.calls }, null, 2));
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
