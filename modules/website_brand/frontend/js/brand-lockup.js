/* Keep the navigation logo on the approved Persian Westo lockup.
   content-overrides.js also owns the broader brand replacement path; this file
   stays as a narrow compatibility guard and avoids repeating identical image
   writes when that primary path has already run. */
(() => {
  'use strict';

  const ROOT = document.documentElement;
  const SELECTOR = '.navbar_logo, .navbar_menu-logo';
  const DARK = 'assets/images/brand/westo-fa-wordmark-dark.png?v=brandDark1';
  const LIGHT = 'assets/images/brand/westo-fa-wordmark.png?v=brandLight1';

  let logos = [];
  let started = false;

  const sourceForTheme = (theme) => (theme === 'light' ? DARK : LIGHT);

  const collectLogos = () => {
    logos = Array.from(document.querySelectorAll(SELECTOR));
    return logos;
  };

  const liveLogos = (forceRefresh = false) => {
    if (
      forceRefresh ||
      !logos.length ||
      logos.some((logo) => !logo || !logo.isConnected)
    ) {
      return collectLogos();
    }
    return logos;
  };

  const writeIfChanged = (logo, src) => {
    if (!logo) return;

    // content-overrides.js is registered earlier on the normal home-page path.
    // If it already applied this exact source, do not trigger another image
    // attribute mutation / source selection cycle.
    if ((logo.getAttribute('src') || '') !== src) {
      logo.setAttribute('src', src);
    }

    if (logo.getAttribute('alt') !== 'Westo') {
      logo.setAttribute('alt', 'Westo');
    }
  };

  const apply = (
    theme = ROOT.getAttribute('data-theme'),
    { refreshNodes = false } = {},
  ) => {
    const src = sourceForTheme(theme);
    liveLogos(refreshNodes).forEach((logo) => writeIfChanged(logo, src));
  };

  const onThemeChange = (event) => {
    apply(event?.detail?.theme);
  };

  const onPageShow = (event) => {
    if (!event.persisted) return;
    apply(ROOT.getAttribute('data-theme'), { refreshNodes: true });
  };

  const start = () => {
    if (started) {
      apply(ROOT.getAttribute('data-theme'), { refreshNodes: true });
      return;
    }
    started = true;

    // The script is defer-loaded on index.html, so the navbar normally exists
    // already. The readyState guard keeps the file safe if it is reused
    // synchronously by an older build.
    apply(ROOT.getAttribute('data-theme'), { refreshNodes: true });

    window.addEventListener('westo:theme-change', onThemeChange);
    window.addEventListener('pageshow', onPageShow);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
