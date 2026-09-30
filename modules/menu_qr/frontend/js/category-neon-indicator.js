/*
 * WESTO category neon indicator.
 *
 * Keep this module deliberately small and scoped to the dish category bar.
 * table-cart.js is the primary owner of Catbar state/centering and already
 * writes the same CSS custom properties during category sync. This file is a
 * compatibility/fallback observer for resize, native Catbar scrolling and
 * state mutations — without observing the entire document or listening to
 * every page scroll.
 */
(() => {
  const BAR_ID = 'westo-dish-catbar';
  const TRACK_SELECTOR = '.westo-dish-catbar__track';
  const ACTIVE_SELECTOR =
    '.westo-dish-catbar__chip.is-active, .westo-dish-catbar__chip[aria-current="true"]';

  let bar = null;
  let track = null;
  let raf = 0;
  let barObserver = null;
  let resizeObserver = null;
  let bodyObserver = null;
  let onWindowResize = null;

  const cancelScheduled = () => {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
  };

  const hideIndicator = () => {
    if (!bar) return;
    bar.style.setProperty('--catbar-active-opacity', '0');
  };

  const sync = () => {
    raf = 0;

    if (!bar?.isConnected) {
      bindCurrentBar();
      return;
    }
    if (document.visibilityState === 'hidden') return;
    if (bar.hidden || bar.getAttribute('aria-hidden') === 'true') return;

    const currentTrack = bar.querySelector(TRACK_SELECTOR) || bar;
    if (currentTrack !== track) bindTrack(currentTrack);

    const trackRect = currentTrack.getBoundingClientRect();
    if (trackRect.width < 2 || trackRect.height < 1) {
      hideIndicator();
      return;
    }

    const midX = trackRect.left + trackRect.width / 2;
    const candidates = bar.querySelectorAll(ACTIVE_SELECTOR);
    let bestRect = null;
    let bestDistance = Infinity;

    for (let i = 0; i < candidates.length; i += 1) {
      const rect = candidates[i].getBoundingClientRect();
      if (rect.width <= 2 || rect.right <= trackRect.left || rect.left >= trackRect.right) continue;
      const distance = Math.abs(rect.left + rect.width / 2 - midX);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestRect = rect;
      }
    }

    if (!bestRect) {
      hideIndicator();
      return;
    }

    const barRect = bar.getBoundingClientRect();
    if (barRect.width < 2) {
      hideIndicator();
      return;
    }

    const inset = Math.min(10, Math.max(5, bestRect.width * 0.12));
    const left = Math.max(0, bestRect.left - barRect.left + inset);
    const width = Math.max(28, Math.min(barRect.width - left, bestRect.width - inset * 2));

    bar.style.setProperty('--catbar-active-left', `${left}px`);
    bar.style.setProperty('--catbar-active-width', `${width}px`);
    bar.style.setProperty('--catbar-active-opacity', '1');
  };

  const schedule = () => {
    if (document.visibilityState === 'hidden' || raf) return;
    raf = requestAnimationFrame(sync);
  };

  const onTrackScroll = () => schedule();

  function bindTrack(nextTrack) {
    if (track === nextTrack) return;
    if (track) {
      track.removeEventListener('scroll', onTrackScroll);
      try {
        resizeObserver?.unobserve?.(track);
      } catch (_) {}
    }
    track = nextTrack || null;
    if (track) {
      track.addEventListener('scroll', onTrackScroll, { passive: true });
      try {
        if (resizeObserver && track !== bar) resizeObserver.observe(track);
      } catch (_) {}
    }
  }

  const disconnectBar = () => {
    cancelScheduled();
    barObserver?.disconnect();
    resizeObserver?.disconnect();
    barObserver = null;
    resizeObserver = null;
    if (onWindowResize) {
      window.removeEventListener('resize', onWindowResize);
      onWindowResize = null;
    }
    bindTrack(null);
    bar = null;
  };

  function bindCurrentBar() {
    const nextBar = document.getElementById(BAR_ID);
    if (nextBar === bar) {
      if (bar) schedule();
      return;
    }

    disconnectBar();
    if (!nextBar) return;

    bar = nextBar;
    bindTrack(bar.querySelector(TRACK_SELECTOR) || bar);

    // Observe only Catbar state. The old implementation watched attributes on
    // the entire document body, which woke up for unrelated UI/GSAP changes.
    barObserver = new MutationObserver((records) => {
      for (let i = 0; i < records.length; i += 1) {
        const record = records[i];
        if (record.type === 'childList') {
          const nextTrack = bar?.querySelector(TRACK_SELECTOR) || bar;
          if (nextTrack !== track) bindTrack(nextTrack);
          schedule();
          return;
        }
        if (record.type === 'attributes') {
          schedule();
          return;
        }
      }
    });
    barObserver.observe(bar, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'aria-hidden', 'aria-current'],
    });

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(schedule);
      resizeObserver.observe(bar);
      if (track && track !== bar) resizeObserver.observe(track);
    } else {
      onWindowResize = schedule;
      window.addEventListener('resize', onWindowResize, { passive: true });
    }

    schedule();
  }

  const start = () => {
    bindCurrentBar();

    // Catbar is inserted/replaced as a direct child of <body> by table-cart.js.
    // Watching only direct body child-list changes keeps discovery reliable
    // without a document-wide subtree/attribute observer.
    if (document.body && typeof MutationObserver !== 'undefined') {
      bodyObserver = new MutationObserver(() => {
        const current = document.getElementById(BAR_ID);
        if (current !== bar) bindCurrentBar();
      });
      bodyObserver.observe(document.body, { childList: true });
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') cancelScheduled();
      else schedule();
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
