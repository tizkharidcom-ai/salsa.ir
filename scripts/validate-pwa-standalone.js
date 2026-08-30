'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const failures = [];
let passed = 0;
const check = (name, ok) => {
  if (ok) passed += 1;
  else failures.push(name);
};

const index = read('index.html');
const htmlFiles = fs.readdirSync(ROOT).filter((name) => name.endsWith('.html'));
const manifest = JSON.parse(read('manifest.webmanifest'));
const bootstrap = read('js/pwa-bootstrap.js');
const css = read('css/westo-pwa.css');
const critical = read('css/westo-critical.smart.css');
const design = read('js/design-logic-v13.js');
const three = read('js/three-scene.js');
const table = read('js/table-cart.js');
const sw = read('sw.js');
const loader = read('js/westo-smart-loader.js');
const server = read('server/server.js');
const build = read('scripts/build-smart-bundles.js');

check('viewport-fit cover', index.includes('viewport-fit=cover'));
check('Apple standalone metadata', index.includes('apple-mobile-web-app-capable') && index.includes('black-translucent'));
check('manifest linked', index.includes('rel="manifest"'));
check('manifest standalone scope', manifest.display === 'standalone' && manifest.scope === '/' && manifest.start_url.startsWith('/'));
check('manifest Persian direction', manifest.lang === 'fa' && manifest.dir === 'rtl');
check('install icons exist', manifest.icons.every((icon) => exists(icon.src.replace(/^\//, ''))));
check('no page unregisters worker', htmlFiles.every((file) => !read(file).includes('disable-service-worker.js')));
check('bootstrap detects iOS standalone', bootstrap.includes('window.navigator.standalone === true'));
check('manifest launch URL activates standalone fallback', manifest.start_url.includes('source=pwa') && bootstrap.includes("get('source') === 'pwa'"));
check('bootstrap settles orientation and pageshow', bootstrap.includes("'orientationchange'") && bootstrap.includes("'pageshow'"));
check('bootstrap registers root worker', bootstrap.includes("register('/sw.js', { scope: '/'"));
check('standalone uses layout viewport', design.includes('standalone && !keyboard ? layoutH : visualH'));
check('WebGL standalone uses innerHeight', three.includes('standaloneViewport') && three.includes('? Number(window.innerHeight)'));
check('safe area included in header total', css.includes('--westo-nav-total-h: calc(var(--v12-nav-h) + var(--westo-safe-top))'));
check('category bar uses safe header total', css.includes('top: calc(var(--westo-nav-total-h) + 4px)'));
check('standalone uses 100vh', css.includes('--westo-app-height: 100vh') && css.includes('height: 100vh !important'));
check('skip link is keyboard-only', css.includes("html[data-input-modality='keyboard'] .dl-skip-link:focus-visible"));
check('mobile dish page owns horizontal category swipe', table.includes('horizontal finger swipe on the') && table.includes("stepDishCategory(dx < 0 ? 1 : -1)") && !table.includes("matchMedia('(pointer: coarse)').matches) return"));
check('PWA CSS is final source', build.indexOf("'css/westo-pwa.css'") > build.indexOf("'css/westo-ultra-fine-v1.2.css'"));
check('PWA CSS reached critical bundle', critical.includes('WESTO installed web app geometry'));
check('worker navigation network-first', sw.includes('networkFirstNavigation') && sw.includes("request.mode === 'navigate'"));
check('authenticated pages are network-only and bypass stale HTTP cache', sw.includes('privateNavigation') && sw.includes("fetch(request, { cache: 'no-store' })") && sw.includes("url.pathname.startsWith('/admin/')"));
check('worker keeps one canonical offline shell', sw.includes("cache.put('/index.html'") && sw.includes("cache.match('/index.html')"));
check('worker bypasses API', sw.includes("url.pathname.startsWith('/api/')"));
check('worker cache release matches active loader', (() => {
  const match = loader.match(/const VERSION = ['\"]([^'\"]+)['\"]/);
  return Boolean(match && sw.includes(`const RELEASE = '${match[1]}'`));
})());
check('worker and manifest revalidate', server.includes("app.get('/sw.js'") && server.includes("app.get('/manifest.webmanifest'"));
check('worker scope header', server.includes("res.setHeader('Service-Worker-Allowed', '/')"));

const result = { passed, failed: failures.length, failures };
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exit(1);
