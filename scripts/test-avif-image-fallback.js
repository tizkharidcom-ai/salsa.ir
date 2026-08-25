'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { performance } = require('perf_hooks');

const ROOT = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(ROOT, 'js/westo-smart-loader.js'), 'utf8');

function runScenario({ avifSupported, avifFails }) {
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
    __WESTO_TEST_AVIF_SUPPORT__: avifSupported,
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
      const ok = !(avifFails && source.endsWith('.avif'));
      return Promise.resolve({ ok, status: ok ? 200 : 404, blob: async () => new Blob([source]) });
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'westo-smart-loader.js' });
  return context.window.WestoResources.requestImage('/assets/menu/dish.webp', { priority: 100 }).then((result) => ({ calls, result }));
}

(async () => {
  const avif = await runScenario({ avifSupported: true, avifFails: false });
  if (!avif.calls[0].endsWith('/assets/menu/dish.avif') || avif.result.format !== 'avif') throw new Error('AVIF-capable clients must fetch AVIF first');

  const fallback = await runScenario({ avifSupported: true, avifFails: true });
  if (!fallback.calls[0].endsWith('.avif') || !fallback.calls[1].endsWith('.webp') || !fallback.result.fallback) throw new Error('AVIF HTTP/decode failures must fall back to WebP');

  const legacy = await runScenario({ avifSupported: false, avifFails: false });
  if (legacy.calls.length !== 1 || !legacy.calls[0].endsWith('.webp') || legacy.result.format !== 'webp') throw new Error('legacy clients must request only WebP');

  console.log(JSON.stringify({ pass: true, avifCalls: avif.calls, fallbackCalls: fallback.calls, legacyCalls: legacy.calls }, null, 2));
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
