/* WESTO PWA service worker — shell only, API-safe, navigation network-first. */
'use strict';

// Keep this in lockstep with the critical entrypoint cache key. A new release
// creates a fresh shell cache and activation removes every older WESTO cache.
const RELEASE = 'release14uf1d28-webp-only';
const CACHE = `westo-pwa-${RELEASE}`;
const CORE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  `/css/westo-critical.smart.css?v=${RELEASE}`,
  `/js/westo-smart-loader.js?v=${RELEASE}`,
  `/js/westo-app.smart.js?v=${RELEASE}`,
  '/assets/fonts/Vazirmatn-Variable.woff2',
  '/assets/icons/apple-touch-icon.png',
  '/assets/icons/pwa-192.png',
  '/assets/icons/pwa-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('westo-pwa-') && key !== CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    // Keep one canonical offline shell. Query-specific documents can contain
    // table/order state and must not accumulate as stale HTML snapshots.
    if (response && response.ok) cache.put('/index.html', response.clone()).catch(() => {});
    return response;
  } catch (_) {
    return (await cache.match('/index.html'))
      || (await cache.match('/'))
      || Response.error();
  }
}

async function privateNavigation(request) {
  try {
    // Never reuse an HTTP-cache entry for authenticated pages. This keeps the
    // HTML fingerprint in lockstep with the current admin assets and prevents
    // an old panel shell from surviving a release.
    return await fetch(request, { cache: 'no-store' });
  } catch (_) {
    return new Response(`<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>مرکز فرمان وستو</title><body><main><h1>اتصال به مرکز فرمان برقرار نیست</h1><p>برای حفظ امنیت و تازگی اطلاعات، نسخهٔ قدیمی پنل نمایش داده نمی‌شود.</p><button type="button" onclick="location.reload()">تلاش دوباره</button></main></body></html>`, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const fresh = fetch(request).then((response) => {
    if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  }).catch(() => null);
  return cached || (await fresh) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    const privatePage = url.pathname === '/login'
      || url.pathname === '/admin'
      || url.pathname === '/admin.html'
      || url.pathname.startsWith('/admin/');
    event.respondWith(privatePage ? privateNavigation(request) : networkFirstNavigation(request));
    return;
  }

  if (
    request.destination === 'style'
    || request.destination === 'script'
    || request.destination === 'font'
    || url.pathname === '/manifest.webmanifest'
    || url.pathname.startsWith('/assets/icons/')
  ) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
