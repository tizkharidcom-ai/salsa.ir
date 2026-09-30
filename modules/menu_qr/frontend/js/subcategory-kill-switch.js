/* Keeps the retired dish-subcategory strip out of legacy cached builds.
   Current table-cart.js already suppresses this UI internally; this file is
   intentionally a narrow compatibility guard only. It must never observe the
   whole document because menu/board rebuilds generate many unrelated DOM mutations. */
(() => {
  'use strict';

  const ROOT_VAR = '--menu-subbar-h';
  const BAR_ID = 'westo-dish-catbar';
  const SUBBAR_CLASS = 'westo-dish-subbar';
  const ACTIVE_CLASS = 'has-subcategories';

  let observedBar = null;
  let barObserver = null;
  let retryTimer = 0;
  let retryCount = 0;
  const MAX_RETRIES = 8;

  function lockSubbarHeight() {
    const root = document.documentElement;
    if (!root) return;
    if (root.style.getPropertyValue(ROOT_VAR) === '0px') return;
    root.style.setProperty(ROOT_VAR, '0px', 'important');
  }

  function removeDirectSubbars(bar) {
    if (!bar) return false;
    let changed = false;

    // Only direct children belong to the retired secondary strip. Avoid a
    // document-wide selector because dish cards and rails rebuild frequently.
    Array.from(bar.children || []).forEach((child) => {
      if (!child.classList?.contains(SUBBAR_CLASS)) return;
      child.remove();
      changed = true;
    });

    if (bar.classList.contains(ACTIVE_CLASS)) {
      bar.classList.remove(ACTIVE_CLASS);
      changed = true;
    }

    return changed;
  }

  function cleanup(bar = document.getElementById(BAR_ID)) {
    lockSubbarHeight();
    if (bar) removeDirectSubbars(bar);
    return bar;
  }

  function disconnectBarObserver() {
    if (barObserver) {
      try {
        barObserver.disconnect();
      } catch (_) {}
    }
    barObserver = null;
    observedBar = null;
  }

  function observeBar(bar) {
    if (!bar || typeof MutationObserver === 'undefined') return;
    if (observedBar === bar && barObserver) return;

    disconnectBarObserver();
    observedBar = bar;

    barObserver = new MutationObserver((records) => {
      let needsCleanup = false;

      for (const record of records) {
        if (record.type === 'attributes') {
          if (bar.classList.contains(ACTIVE_CLASS)) needsCleanup = true;
          continue;
        }

        if (record.type !== 'childList' || !record.addedNodes?.length) continue;
        for (const node of record.addedNodes) {
          if (node?.nodeType !== 1) continue;
          if (node.classList?.contains(SUBBAR_CLASS)) {
            needsCleanup = true;
            break;
          }
        }
        if (needsCleanup) break;
      }

      if (needsCleanup) cleanup(bar);
    });

    // The compatibility guard watches only the actual Catbar. This preserves
    // protection against an old cached table-cart.js without paying for every
    // child mutation elsewhere on the page.
    barObserver.observe(bar, {
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  function bindCurrentBar() {
    const bar = cleanup();
    if (!bar) return false;
    observeBar(bar);
    retryCount = MAX_RETRIES;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = 0;
    }
    return true;
  }

  function scheduleRetry() {
    if (retryTimer || retryCount >= MAX_RETRIES) return;
    retryTimer = window.setTimeout(() => {
      retryTimer = 0;
      retryCount += 1;
      if (!bindCurrentBar()) scheduleRetry();
    }, retryCount < 3 ? 120 : 300);
  }

  function sync() {
    if (!bindCurrentBar()) scheduleRetry();
  }

  function start() {
    lockSubbarHeight();
    sync();

    // These are low-frequency lifecycle points where table/cart state can be
    // rebuilt. They replace the previous document-wide MutationObserver.
    window.addEventListener('westo:menu-ready', sync);
    window.addEventListener('carousel:ready', sync, { once: true });
    window.addEventListener('pageshow', sync);
    document.addEventListener('westo:langchange', sync);
  }

  function stop() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = 0;
    }
    disconnectBarObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  window.addEventListener('pagehide', stop);
})();
