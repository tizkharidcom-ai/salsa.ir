/* WESTO v14.3 Ultra Fine — low-overhead interaction polish / thermal governor. */
(() => {
  'use strict';
  const root = document.documentElement;

  // Give each dish board a different static ambient-light destination. The
  // existing dish active/leaving state machine owns the transition; no scroll RAF.
  document.querySelectorAll('section.is-benefits').forEach((section, index) => {
    section.dataset.westoLightSlot = String(index % 4);
  });

  // Keep active category readable and centered without competing with the
  // category state owner. Native touch/trackpad scrolling remains authoritative.
  document.querySelectorAll('.westo-prod-hero-cats').forEach((rail) => {
    rail.setAttribute('data-lenis-prevent', '');
    rail.setAttribute('data-lenis-prevent-touch', '');
    const center = (target, behavior = 'smooth') => {
      if (!target?.matches?.('.westo-prod-hero-cat')) return;
      const left = target.offsetLeft - (rail.clientWidth - target.offsetWidth) / 2;
      rail.scrollTo({ left: Math.max(0, left), behavior });
    };
    rail.addEventListener('click', (event) => center(event.target.closest('.westo-prod-hero-cat')));
    rail.addEventListener('focusin', (event) => center(event.target.closest('.westo-prod-hero-cat')));
    rail.addEventListener('wheel', (event) => {
      const horizontalIntent = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) * 0.45;
      if (!horizontalIntent || rail.scrollWidth <= rail.clientWidth + 2) return;
      event.preventDefault();
      rail.scrollLeft += event.deltaX || event.deltaY;
    }, { passive:false });
  });

  // Thermal governor only pauses decorative CSS animation after real idle.
  // It never changes menu/cart/category state and does not add a frame loop.
  let idleTimer = 0;
  const setIdle = (idle) => {
    root.dataset.thermalIdle = idle ? 'true' : 'false';
    try { window.dispatchEvent(new CustomEvent(idle ? 'westo:thermal-idle' : 'westo:thermal-wake')); } catch (_) {}
  };
  const armIdle = (delay = 4200) => {
    clearTimeout(idleTimer);
    setIdle(false);
    if (document.hidden) return;
    idleTimer = window.setTimeout(() => setIdle(true), delay);
  };
  const wakeEvents = ['pointerdown','wheel','touchstart','keydown'];
  wakeEvents.forEach((name) => window.addEventListener(name, () => armIdle(3600), { passive:true, capture:true }));
  document.addEventListener('visibilitychange', () => {
    clearTimeout(idleTimer);
    if (document.hidden) setIdle(true);
    else armIdle(2400);
  });
  window.addEventListener('eg-entered', () => armIdle(3200), { once:true });
  armIdle(5200);
})();
