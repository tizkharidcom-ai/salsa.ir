'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { publicContentPayload } = require('../server/server');

const ROOT = path.resolve(__dirname, '..');
const staticSource = fs.readFileSync(path.join(ROOT, 'js/content-bootstrap.static.js'), 'utf8');
const loaderSource = fs.readFileSync(path.join(ROOT, 'js/westo-smart-loader.js'), 'utf8');
const publicPayload = publicContentPayload();

if (!Array.isArray(publicPayload.menu?.menuItems) || publicPayload.menu.menuItems.length === 0) {
  throw new Error('static bootstrap source has no public menu items');
}
if (Object.prototype.hasOwnProperty.call(publicPayload, 'users') || Object.prototype.hasOwnProperty.call(publicPayload, 'orders')) {
  throw new Error('static bootstrap payload must not include private collections');
}

const sandbox = { window: {} };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(staticSource, sandbox, { filename: 'content-bootstrap.static.js' });

const generated = sandbox.window.__WESTO_STATIC_CONTENT__;
if (!generated || generated.menu?.menuItems?.length !== publicPayload.menu.menuItems.length) {
  throw new Error('generated static bootstrap differs from the public server payload');
}
if (!loaderSource.includes("location.protocol === 'file:'") || !loaderSource.includes('content-bootstrap.static.js')) {
  throw new Error('smart loader has no file-protocol bootstrap path');
}

async function verifyFileProtocolBoot() {
  const scriptRequests = [];
  let runtime;
  class FakeImage {
    constructor() { this.dataset = {}; this.complete = false; this.naturalWidth = 0; }
    set src(value) {
      this._src = String(value || '');
      this.complete = Boolean(value);
      this.naturalWidth = value ? 96 : 0;
      if (value) setTimeout(() => this.onload?.(), 0);
    }
    get src() { return this._src || ''; }
    decode() { return Promise.resolve(); }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
  }
  const document = {
    hidden: false,
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement(tag) {
      return tag === 'script'
        ? { dataset: {}, async: false, set src(value) { this._src = String(value); }, get src() { return this._src; } }
        : { dataset: {} };
    },
  };
  document.head = {
    appendChild(node) {
      if (!node.src) return;
      scriptRequests.push(node.src);
      setTimeout(() => {
        if (node.src.includes('content-bootstrap.static.js')) {
          vm.runInContext(staticSource, runtime, { filename: 'content-bootstrap.static.js' });
        }
        node.onload?.();
      }, 0);
    },
  };
  const window = {
    __WESTO_SMART_TEST_NO_BOOT__: true,
    matchMedia: () => ({ matches: false }),
    requestIdleCallback: () => 0,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
  };
  window.window = window;
  runtime = {
    window,
    document,
    navigator: { deviceMemory: 8, connection: { effectiveType: '4g', saveData: false, addEventListener() {} } },
    location: { href: 'file:///Users/sasan/Downloads/WESTO-v1.2/index.html', protocol: 'file:' },
    performance: require('perf_hooks').performance,
    URL, Blob, DOMException, AbortController, Image: FakeImage,
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    requestAnimationFrame: (callback) => setTimeout(() => callback(0), 0),
    requestIdleCallback: () => 0,
    setTimeout, clearTimeout, Promise, console,
    fetch: async (url) => ({ ok: true, status: 200, blob: async () => new Blob([String(url)]) }),
  };
  runtime.globalThis = runtime;
  vm.createContext(runtime);
  vm.runInContext(loaderSource, runtime, { filename: 'westo-smart-loader.js' });
  await runtime.window.WestoSmartLoad.boot();

  if (!runtime.window.__WESTO_CONTENT__?.menu?.menuItems?.length) {
    throw new Error('file-protocol boot did not adopt the static public payload');
  }
  if (!scriptRequests.some((src) => src.includes('content-bootstrap.static.js')) || scriptRequests.some((src) => src.startsWith('/api/'))) {
    throw new Error(`file-protocol boot requested the wrong bootstrap: ${JSON.stringify(scriptRequests)}`);
  }
}

verifyFileProtocolBoot().then(() => {
  console.log(JSON.stringify({
    pass: true,
    menuItems: generated.menu.menuItems.length,
    categories: generated.menu.siteCategories.length,
    privateDataExcluded: true,
    fileProtocolBoot: true,
  }, null, 2));
}).catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
