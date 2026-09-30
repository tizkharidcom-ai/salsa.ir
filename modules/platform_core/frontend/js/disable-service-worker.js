/* WESTO no-load test migration.
 * Purpose: make this test genuinely service-worker-free even for browsers that
 * previously visited a PWA-enabled WESTO build. This file NEVER registers a
 * service worker. Once cleanup succeeds, a localStorage marker makes it inert.
 */
(function () {
  'use strict';
  var MARK = 'westo:no-sw-cleanup:v1';
  try { if (localStorage.getItem(MARK) === 'done') return; } catch (_) {}
  if (!('serviceWorker' in navigator)) {
    try { localStorage.setItem(MARK, 'done'); } catch (_) {}
    return;
  }
  var wasControlled = Boolean(navigator.serviceWorker.controller);
  Promise.all([
    navigator.serviceWorker.getRegistrations()
      .then(function (regs) { return Promise.all(regs.map(function (reg) { return reg.unregister(); })); })
      .catch(function () { return []; }),
    ('caches' in window ? caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (key) { return /^westo[-_:]/i.test(key) || /^westo/i.test(key); })
          .map(function (key) { return caches.delete(key); }));
      })
      .catch(function () { return []; }) : Promise.resolve([])),
  ]).then(function () {
    try { localStorage.setItem(MARK, 'done'); } catch (_) {}
    if (wasControlled) location.reload();
  });
})();
