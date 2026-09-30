/* WESTO installed-web-app lifecycle and viewport owner. */
(function () {
  'use strict';

  const root = document.documentElement;
  const displayMode = window.matchMedia?.('(display-mode: standalone)');
  let settleFrame = 0;
  let settleTimer = 0;

  function isStandalone() {
    return window.navigator.standalone === true
      || displayMode?.matches === true
      || new URLSearchParams(window.location.search).get('source') === 'pwa';
  }

  function syncMode() {
    const standalone = isStandalone();
    root.classList.toggle('is-standalone', standalone);
    root.dataset.displayMode = standalone ? 'standalone' : 'browser';
    return standalone;
  }

  function syncViewport() {
    const standalone = syncMode();
    const vv = window.visualViewport;
    const layoutHeight = Math.max(1, Math.round(window.innerHeight || 1));
    const layoutWidth = Math.max(1, Math.round(window.innerWidth || 1));
    const visualHeight = Math.max(1, Math.round(vv?.height || layoutHeight));
    const visualWidth = Math.max(1, Math.round(vv?.width || layoutWidth));
    const keyboardOpen = visualHeight < layoutHeight - 80;

    root.style.setProperty('--westo-layout-height-px', `${layoutHeight}px`);
    root.style.setProperty('--westo-layout-width-px', `${layoutWidth}px`);
    root.style.setProperty('--westo-visual-height-px', `${visualHeight}px`);
    root.style.setProperty('--westo-visual-width-px', `${visualWidth}px`);
    root.style.setProperty('--westo-visual-offset-top', `${Math.max(0, Math.round(vv?.offsetTop || 0))}px`);
    root.classList.toggle('westo-keyboard-open', keyboardOpen);

    // In iOS Home Screen mode visualViewport.height can exclude safe-area
    // insets. CSS therefore owns the full standalone height with 100vh; this
    // event only asks WebGL/ScrollTrigger owners to remeasure after launch.
    window.dispatchEvent(new CustomEvent('westo:viewportchange', {
      detail: { standalone, layoutHeight, layoutWidth, visualHeight, visualWidth, keyboardOpen }
    }));
  }

  function settleViewport() {
    cancelAnimationFrame(settleFrame);
    clearTimeout(settleTimer);
    settleFrame = requestAnimationFrame(() => requestAnimationFrame(syncViewport));
    settleTimer = window.setTimeout(syncViewport, 420);
  }

  function cleanTouchFocus() {
    if (!window.matchMedia?.('(pointer: coarse)').matches) return;
    if (document.activeElement?.classList?.contains('dl-skip-link')) {
      document.activeElement.blur();
    }
  }

  syncMode();
  syncViewport();

  window.addEventListener('resize', settleViewport, { passive: true });
  window.addEventListener('orientationchange', settleViewport, { passive: true });
  window.visualViewport?.addEventListener('resize', settleViewport, { passive: true });
  window.visualViewport?.addEventListener('scroll', settleViewport, { passive: true });
  window.addEventListener('pageshow', () => {
    cleanTouchFocus();
    settleViewport();
  }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) settleViewport();
  }, { passive: true });
  if (displayMode?.addEventListener) displayMode.addEventListener('change', settleViewport);
  else displayMode?.addListener?.(settleViewport);

  if (location.protocol !== 'file:' && 'serviceWorker' in navigator && (window.isSecureContext || location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .then((registration) => registration.update().catch(() => {}))
        .catch(() => {});
    }, { once: true });
  }
})();
