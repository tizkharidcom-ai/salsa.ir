'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { performance } = require('perf_hooks');

const ROOT = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(ROOT, 'js/westo-smart-loader.js'), 'utf8');
const listeners = new Map();
const docListeners = new Map();
const fetchCalls = [];
let blobSeq = 0;

class FakeImage {
  constructor() { this.dataset = {}; this.decoding = ''; this.loading = ''; this.src = ''; }
  decode() { return Promise.resolve(); }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
}
class FakeCustomEvent { constructor(type, init={}) { this.type=type; this.detail=init.detail; } }
class FakeIO { constructor(cb) { this.cb=cb; } observe(){} unobserve(){} disconnect(){} }

const document = {
  hidden: false,
  readyState: 'loading',
  head: { appendChild() {} },
  addEventListener(type, cb) { docListeners.set(type, cb); },
  querySelector() { return null; },
  getElementById() { return null; },
  createElement(tag) {
    if (tag === 'script' || tag === 'link') return { dataset: {}, set src(v){this._src=v;}, get src(){return this._src;}, set href(v){this._href=v;}, get href(){return this._href;} };
    return { dataset: {} };
  },
};
const windowObj = {
  __WESTO_SMART_TEST_NO_BOOT__: true,
  matchMedia: () => ({ matches: false }),
  addEventListener(type, cb) { listeners.set(type, cb); },
  dispatchEvent() {},
  requestIdleCallback(cb) { setTimeout(() => cb({ didTimeout:false, timeRemaining:()=>50 }), 0); },
};
windowObj.window = windowObj;
windowObj.document = document;

const nativeURL = URL;
if (typeof nativeURL.createObjectURL !== 'function') nativeURL.createObjectURL = () => `blob:test-${++blobSeq}`;
if (typeof nativeURL.revokeObjectURL !== 'function') nativeURL.revokeObjectURL = () => {};

const context = {
  window: windowObj,
  document,
  navigator: {
    deviceMemory: 8,
    connection: { effectiveType: '2g', saveData: false, addEventListener() {} },
  },
  location: { href: 'http://localhost:3000/' },
  performance,
  URL: nativeURL,
  Blob,
  DOMException,
  AbortController,
  Image: FakeImage,
  CustomEvent: FakeCustomEvent,
  IntersectionObserver: FakeIO,
  requestAnimationFrame: (cb) => setTimeout(() => cb(performance.now()), 0),
  setTimeout,
  clearTimeout,
  Promise,
  console,
  fetch(url, init={}) {
    fetchCalls.push(String(url));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ ok:true, status:200, blob: async () => new Blob([String(url)]) }), 8);
      init.signal?.addEventListener?.('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once:true });
    });
  },
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(code, context, { filename:'westo-smart-loader.js' });
const r = context.window.WestoResources;
if (!r) throw new Error('WestoResources not installed');

(async () => {
  const P = r.priorities;
  // Queue sorting: current intent must start before background work queued in the same turn.
  await Promise.all([
    r.requestImage('/low-a.webp', { priority:P.NEAR, group:'test:near' }),
    r.requestImage('/current.webp', { priority:P.CURRENT, group:'test:current' }),
    r.requestImage('/low-b.webp', { priority:P.NEAR, group:'test:near' }),
  ]);
  if (!fetchCalls[0].includes('/current.webp')) throw new Error(`priority order failed: ${fetchCalls.join(', ')}`);

  // One URL, one byte owner: duplicate consumers share one fetch.
  const before = fetchCalls.length;
  await Promise.all([
    r.requestImage('/same.webp', { priority:P.VISIBLE, group:'test:a' }),
    r.requestImage('/same.webp', { priority:P.CURRENT, group:'test:b' }),
    r.requestImage('/same.webp', { priority:P.NEXT, group:'test:c' }),
  ]);
  const duplicateFetches = fetchCalls.slice(before).filter((u) => u.includes('/same.webp')).length;
  if (duplicateFetches !== 1) throw new Error(`dedupe failed: ${duplicateFetches} fetches`);

  // Menu intent API should immediately move logical focus to the chosen category.
  r.registerMenu({
    siteCategories: [
      { id:1, coverImg:'/c1.webp' },
      { id:2, coverImg:'/c2.webp' },
      { id:3, coverImg:'/c3.webp' },
    ],
    menuItems: [
      { id:11, categoryId:1, img:'/1a.webp', available:true },
      { id:12, categoryId:1, img:'/1b.webp', available:true },
      { id:21, categoryId:2, img:'/2a.webp', available:true },
      { id:22, categoryId:2, img:'/2b.webp', available:true },
      { id:31, categoryId:3, img:'/3a.webp', available:true },
    ],
  });
  r.intentCategory(2, { reason:'test-intent' });
  if (r.currentCategory !== 2) throw new Error('intent focus failed');
  await new Promise((resolve) => setTimeout(resolve, 35));

  const m = r.metrics;
  if (m.maxActive > 2) throw new Error(`2g concurrency budget exceeded: ${m.maxActive}`);
  if (m.deduped < 2) throw new Error(`dedupe metrics unexpected: ${m.deduped}`);
  console.log(JSON.stringify({ pass:true, fetchCalls:fetchCalls.length, firstFetch:fetchCalls[0], metrics:m }, null, 2));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
