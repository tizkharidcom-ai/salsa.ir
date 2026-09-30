/* Sitewide theme preference: dark | light | system.
   Resolved appearance lives on html[data-theme]; preference on html[data-theme-pref]
   and localStorage westo_theme. Manual picks stick; "system" tracks OS.

   Performance/lifecycle notes:
   - the inline <head> bootstrap already paints the initial theme before CSS;
   - this runtime layer therefore avoids rewriting identical attributes/styles;
   - theme controls/meta nodes are cached after first discovery;
   - semantic westo:theme-change events are still emitted on every apply(),
     matching the stable public contract even when the resolved value is unchanged. */
(function () {
  'use strict';

  const IS_ADMIN = /^\/admin\/?$/.test(window.location.pathname);
  const KEY = IS_ADMIN ? 'westo_admin_theme' : 'westo_theme';
  const DEFAULT_PREF = IS_ADMIN ? 'light' : 'system';
  const PREFS = new Set(['dark', 'light', 'system']);
  const THEME_COLOR = Object.freeze({
    dark: '#121416',
    light: IS_ADMIN ? '#f4f5f7' : '#e8e0d4',
  });

  const root = document.documentElement;
  const mq =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: light)')
      : null;

  let themeButtons = null;
  let themeColorMeta = null;
  let buttonsBound = false;
  let destroyed = false;

  function normalizePref(mode) {
    const value = String(mode || '').toLowerCase();
    return PREFS.has(value) ? value : 'system';
  }

  function systemResolved() {
    try {
      return mq && mq.matches ? 'light' : 'dark';
    } catch (_) {
      return 'dark';
    }
  }

  function resolve(pref) {
    const normalized = normalizePref(pref);
    return normalized === 'system' ? systemResolved() : normalized;
  }

  function readStored() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw == null || raw === '') return DEFAULT_PREF;
      return PREFS.has(String(raw).toLowerCase()) ? normalizePref(raw) : DEFAULT_PREF;
    } catch (_) {
      return DEFAULT_PREF;
    }
  }

  function writeStored(pref) {
    try {
      // localStorage is synchronous. Avoid an unnecessary write when a caller
      // reapplies the currently persisted preference.
      if (localStorage.getItem(KEY) !== pref) {
        localStorage.setItem(KEY, pref);
      }
    } catch (_) {}
  }

  function setAttributeIfChanged(node, name, value) {
    if (!node) return false;
    if (node.getAttribute(name) === value) return false;
    node.setAttribute(name, value);
    return true;
  }

  function getThemeButtons() {
    if (
      themeButtons &&
      themeButtons.length &&
      themeButtons.every((button) => button && button.isConnected !== false)
    ) {
      return themeButtons;
    }

    themeButtons = Array.from(document.querySelectorAll('[data-theme-set]'));
    return themeButtons;
  }

  function getThemeColorMeta() {
    if (themeColorMeta && themeColorMeta.isConnected !== false) {
      return themeColorMeta;
    }
    themeColorMeta = document.querySelector('meta[name="theme-color"]');
    return themeColorMeta;
  }

  function syncButtons(pref) {
    const normalized = normalizePref(pref);
    const buttons = getThemeButtons();

    for (const button of buttons) {
      const active = button.getAttribute('data-theme-set') === normalized;
      const pressed = active ? 'true' : 'false';

      setAttributeIfChanged(button, 'aria-pressed', pressed);
      if (button.classList.contains('is-active') !== active) {
        button.classList.toggle('is-active', active);
      }
    }
  }

  function syncThemeColor(resolved) {
    const meta = getThemeColorMeta();
    if (!meta) return;
    setAttributeIfChanged(
      meta,
      'content',
      THEME_COLOR[resolved] || THEME_COLOR.dark,
    );
  }

  function dispatchThemeChange(resolved, pref) {
    window.dispatchEvent(
      new CustomEvent('westo:theme-change', {
        detail: { theme: resolved, pref },
      }),
    );
  }

  function apply(pref, { persist = true } = {}) {
    const nextPref = normalizePref(pref);
    const resolved = resolve(nextPref);

    // The early inline bootstrap normally set both of these already. Keeping
    // identical values out of setAttribute prevents needless style invalidation.
    setAttributeIfChanged(root, 'data-theme-pref', nextPref);
    setAttributeIfChanged(root, 'data-theme', resolved);

    if (persist) writeStored(nextPref);

    syncButtons(nextPref);
    syncThemeColor(resolved);

    // Preserve stable semantics: consumers may use this as an explicit
    // "reapply theme-dependent chrome" signal, not merely as a value change.
    dispatchThemeChange(resolved, nextPref);
    return resolved;
  }

  const api = {
    get() {
      return resolve(root.getAttribute('data-theme-pref') || readStored());
    },

    getPref() {
      return normalizePref(
        root.getAttribute('data-theme-pref') || readStored(),
      );
    },

    set(mode) {
      return apply(mode, { persist: true });
    },

    toggle() {
      const current = api.get();
      return api.set(current === 'light' ? 'dark' : 'light');
    },

    sync() {
      syncButtons(api.getPref());
      syncThemeColor(api.get());
    },
  };

  window.westoTheme = api;

  function onThemeButtonClick(event) {
    const button = event.currentTarget;
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    api.set(button.getAttribute('data-theme-set'));
  }

  function bindButtons() {
    if (destroyed) return;

    const buttons = getThemeButtons();
    for (const button of buttons) {
      if (button.dataset.themeBound === '1') continue;
      button.dataset.themeBound = '1';
      button.addEventListener('click', onThemeButtonClick);
    }

    buttonsBound = buttonsBound || buttons.length > 0;
    syncButtons(api.getPref());
    syncThemeColor(api.get());
  }

  function onSystemChange() {
    if (destroyed || api.getPref() !== 'system') return;
    apply('system', { persist: false });
  }

  function onPageShow(event) {
    if (destroyed || !event || !event.persisted) return;

    // bfcache can restore DOM attributes/classes exactly as they were frozen.
    // If the OS appearance changed while a system-pref page was frozen, use
    // apply() so brand/category consumers receive the same semantic event they
    // would receive from a live matchMedia change. Otherwise a cheap sync is
    // sufficient and avoids redundant downstream work.
    if (api.getPref() === 'system') {
      const resolved = resolve('system');
      if (root.getAttribute('data-theme') !== resolved) {
        apply('system', { persist: false });
        return;
      }
    }

    api.sync();
  }

  // The inline head bootstrap has already resolved first paint. This call
  // establishes the runtime API, controls/meta state and the historical
  // westo:theme-change notification for downstream modules.
  apply(readStored(), { persist: false });

  if (mq) {
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onSystemChange);
    } else if (typeof mq.addListener === 'function') {
      mq.addListener(onSystemChange);
    }
  }

  // On index.html this file is defer-loaded, so the DOM is already parsed.
  // On admin.html it is a normal script at the end of <body>. The fallback
  // keeps the module safe if its placement changes in a future build.
  if (document.readyState === 'loading') {
    const existingButtons = document.querySelectorAll('[data-theme-set]');
    if (existingButtons.length) {
      themeButtons = Array.from(existingButtons);
      bindButtons();
    } else {
      document.addEventListener('DOMContentLoaded', bindButtons, { once: true });
    }
  } else {
    bindButtons();
  }

  window.addEventListener('pageshow', onPageShow);

  // Expose no extra public behavior; this is only a lifecycle safety path for
  // real navigations. bfcache pages are preserved and resume through pageshow.
  window.addEventListener('pagehide', (event) => {
    if (event && event.persisted) return;
    destroyed = true;
  });
})();
