/* WESTO Design Logic v13
   Human-factor runtime only: accessibility semantics, input modality,
   visualViewport resilience, and defensive link/state hygiene.
   It intentionally owns no menu/cart/carousel/business state. */
(function () {
  'use strict';
  const root = document.documentElement;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

  function ensureThemeColor() {
    let meta = $('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    const sync = () => {
      const light = root.getAttribute('data-theme') === 'light';
      meta.content = light ? '#f2f3ef' : '#071012';
    };
    sync();
    window.addEventListener('westo:theme-change', sync);
  }

  function ensureMainSemantics() {
    const main = $('main, [role="main"]');
    if (!main) return;
    if (!main.id) main.id = 'main-content';
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
    if (!$('.dl-skip-link')) {
      const skip = document.createElement('a');
      skip.className = 'dl-skip-link';
      skip.href = `#${main.id}`;
      skip.textContent = root.lang === 'en' ? 'Skip to content' : root.lang === 'ar' ? 'تخطي إلى المحتوى' : 'رفتن به محتوای اصلی';
      document.body.prepend(skip);
    }
  }

  function syncLanguageUi() {
    const skip = $('.dl-skip-link');
    if (skip) skip.textContent = root.lang === 'en' ? 'Skip to content' : root.lang === 'ar' ? 'تخطي إلى المحتوى' : 'رفتن به محتوای اصلی';
  }

  function hardenLinks() {
    $$('a[target="_blank"]').forEach((a) => {
      const parts = new Set(String(a.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
      parts.add('noopener');
      a.setAttribute('rel', Array.from(parts).join(' '));
    });
    const here = new URL(location.href);
    $$('a[href]').forEach((a) => {
      if (a.hasAttribute('aria-current') || a.closest('[data-no-auto-current]')) return;
      try {
        const url = new URL(a.getAttribute('href'), here);
        if (url.origin === here.origin && url.pathname === here.pathname && !url.hash) a.setAttribute('aria-current', 'page');
      } catch (_) {}
    });
  }

  function hardenLiveRegions() {
    $$('.msg, [data-dynamic-message]').forEach((el) => {
      if (!el.hasAttribute('role')) el.setAttribute('role', 'status');
      if (!el.hasAttribute('aria-live')) el.setAttribute('aria-live', 'polite');
      if (!el.hasAttribute('aria-atomic')) el.setAttribute('aria-atomic', 'true');
    });
  }

  function syncViewport() {
    const vv = window.visualViewport;
    const layoutH = Math.max(1, Number(window.innerHeight) || 1);
    const layoutW = Math.max(1, Number(window.innerWidth) || 1);
    const visualH = Math.max(1, Number(vv?.height) || layoutH);
    const visualW = Math.max(1, Number(vv?.width) || layoutW);
    const keyboard = !!vv && visualH < layoutH - 80;
    const standalone = root.classList.contains('is-standalone')
      || window.navigator.standalone === true
      || window.matchMedia?.('(display-mode: standalone)').matches === true;
    // Installed iOS apps can report a visual viewport with safe areas already
    // removed. Keep 100vh/innerHeight authoritative unless the keyboard is open.
    const h = standalone && !keyboard ? layoutH : visualH;
    const w = standalone && !keyboard ? layoutW : visualW;
    root.style.setProperty('--dl-vv-height', `${Math.max(1, Math.round(h || 1))}px`);
    root.style.setProperty('--dl-vv-width', `${Math.max(1, Math.round(w || 1))}px`);
    root.classList.toggle('dl-keyboard-open', keyboard);
  }

  function syncDisplayMode() {
    const standalone = window.navigator.standalone === true
      || window.matchMedia?.('(display-mode: standalone)').matches === true;
    root.classList.toggle('is-standalone', standalone);
    root.dataset.displayMode = standalone ? 'standalone' : 'browser';
  }

  function bindInputModality() {
    let keyboard = false;
    const set = (value) => {
      if (root.dataset.inputModality === value) return;
      root.dataset.inputModality = value;
    };
    if (window.matchMedia?.('(pointer: coarse)').matches) set('pointer');
    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      keyboard = true;
      set('keyboard');
    }, true);
    document.addEventListener('pointerdown', () => {
      keyboard = false;
      set('pointer');
    }, true);
    window.addEventListener('blur', () => { if (!keyboard) set('pointer'); });
  }

  function init() {
    ensureThemeColor();
    ensureMainSemantics();
    syncLanguageUi();
    hardenLinks();
    hardenLiveRegions();
    syncDisplayMode();
    bindInputModality();
    syncViewport();
    const vv = window.visualViewport;
    const displayMode = window.matchMedia?.('(display-mode: standalone)');
    let settleFrame = 0;
    let settleTimer = 0;
    const scheduleViewportSync = () => {
      cancelAnimationFrame(settleFrame);
      clearTimeout(settleTimer);
      settleFrame = requestAnimationFrame(() => requestAnimationFrame(syncViewport));
      settleTimer = window.setTimeout(syncViewport, 420);
    };
    vv?.addEventListener('resize', scheduleViewportSync, { passive: true });
    vv?.addEventListener('scroll', scheduleViewportSync, { passive: true });
    if (displayMode?.addEventListener) displayMode.addEventListener('change', syncDisplayMode);
    else displayMode?.addListener?.(syncDisplayMode);
    window.addEventListener('resize', scheduleViewportSync, { passive: true });
    window.addEventListener('orientationchange', scheduleViewportSync, { passive: true });
    window.addEventListener('pageshow', () => {
      syncDisplayMode();
      if (window.matchMedia?.('(pointer: coarse)').matches
          && document.activeElement?.classList?.contains('dl-skip-link')) {
        document.activeElement.blur();
      }
      scheduleViewportSync();
    }, { passive: true });
    document.addEventListener('westo:langchange', syncLanguageUi);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
