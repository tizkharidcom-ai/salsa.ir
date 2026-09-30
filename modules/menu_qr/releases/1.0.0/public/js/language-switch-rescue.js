/* Restores the full three-language gate switch in legacy cached builds.
   Scoped to the entrance language control so unrelated DOM mutations never
   wake this compatibility guard. */
(() => {
  'use strict';

  const SWITCH_ID = 'eg-lang-switch';
  const ARABIC_ID = 'eg-lang-ar';

  let switcher = null;
  let arabic = null;
  let arabicObserver = null;
  let started = false;

  const getNodes = () => {
    const nextSwitcher = document.getElementById(SWITCH_ID);
    const nextArabic = document.getElementById(ARABIC_ID);

    if (nextSwitcher !== switcher || nextArabic !== arabic) {
      arabicObserver?.disconnect();
      arabicObserver = null;
      switcher = nextSwitcher;
      arabic = nextArabic;
    }

    return { switcher, arabic };
  };

  const restore = () => {
    const nodes = getNodes();

    if (nodes.switcher) {
      if (nodes.switcher.style.minWidth !== '7.6rem') {
        nodes.switcher.style.minWidth = '7.6rem';
      }
      if (nodes.switcher.style.justifyContent !== 'center') {
        nodes.switcher.style.justifyContent = 'center';
      }
      if (nodes.switcher.style.whiteSpace !== 'nowrap') {
        nodes.switcher.style.whiteSpace = 'nowrap';
      }
    }

    if (nodes.arabic) {
      if (nodes.arabic.hidden) nodes.arabic.hidden = false;
      if (nodes.arabic.hasAttribute('hidden')) {
        nodes.arabic.removeAttribute('hidden');
      }

      if (nodes.arabic.style.getPropertyValue('display') !== 'flex' ||
          nodes.arabic.style.getPropertyPriority('display') !== 'important') {
        nodes.arabic.style.setProperty('display', 'flex', 'important');
      }
      nodes.arabic.style.setProperty('align-items', 'center', 'important');
      nodes.arabic.style.setProperty('justify-content', 'center', 'important');
      nodes.arabic.style.setProperty('line-height', '1', 'important');
      nodes.arabic.style.setProperty('padding-block', '0', 'important');
      nodes.arabic.style.setProperty('transform', 'none', 'important');

      if (nodes.arabic.style.getPropertyValue('visibility') !== 'visible' ||
          nodes.arabic.style.getPropertyPriority('visibility') !== 'important') {
        nodes.arabic.style.setProperty('visibility', 'visible', 'important');
      }
    }

    return Boolean(nodes.switcher || nodes.arabic);
  };

  const observeArabic = () => {
    getNodes();
    if (!arabic || arabicObserver) return;

    arabicObserver = new MutationObserver((records) => {
      for (const record of records) {
        if (
          record.type === 'attributes' &&
          record.attributeName === 'hidden' &&
          arabic?.hasAttribute('hidden')
        ) {
          restore();
          break;
        }
      }
    });

    arabicObserver.observe(arabic, {
      attributes: true,
      attributeFilter: ['hidden'],
    });
  };

  const sync = () => {
    restore();
    observeArabic();
  };

  const start = () => {
    if (started) {
      sync();
      return;
    }
    started = true;

    sync();

    // Current animations/i18n code already keeps the AR option visible.
    // These narrow lifecycle hooks only protect bfcache and language rewrites.
    window.addEventListener('pageshow', sync);
    window.addEventListener('westo:langchange', sync);
  };

  const stop = () => {
    arabicObserver?.disconnect();
    arabicObserver = null;
  };

  window.addEventListener('pagehide', stop);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
