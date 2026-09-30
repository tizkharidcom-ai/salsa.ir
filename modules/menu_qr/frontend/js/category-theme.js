/**
 * Per-category atmosphere themes for the guest site.
 * Keys by stable menu categoryId (not carousel index).
 * Light: wash / surface / accent tokens. Dark: taste colors for WebGL only.
 *
 * Performance note:
 * category-theme is intentionally tiny and synchronous because it is consumed by
 * the hero carousel, dish boards, classic menu, and menu overlay. The important
 * optimization here is not to change its public contract, but to avoid writing
 * identical attributes/CSS custom properties repeatedly when multiple consumers
 * focus the same category in the same interaction window.
 */
(function () {
  'use strict';

  const DEFAULT_ID = 7560;

  /** @type {Record<string, {
   *   slug: string,
   *   tastePrimary: string,
   *   tasteSecondary: string,
   *   wash: string,
   *   surface: string,
   *   accent: string,
   *   accentSoft: string,
   *   glow: string
   * }>} */
  const THEMES = {
    // Fresh / leaf — Salad
    7560: {
      slug: 'salad',
      tastePrimary: '#1C2A1A',
      tasteSecondary: '#B8D48A',
      wash: '#eef3e8',
      surface: '#f6f9f2',
      accent: '#5a7a3e',
      accentSoft: 'rgba(90, 122, 62, 0.16)',
      glow: 'rgba(120, 160, 80, 0.18)',
    },
    // Invite / saffron — Appetizers
    7561: {
      slug: 'appetizers',
      tastePrimary: '#3A2414',
      tasteSecondary: '#F0B46A',
      wash: '#f6eee4',
      surface: '#fbf5ec',
      accent: '#b8893e',
      accentSoft: 'rgba(184, 137, 62, 0.18)',
      glow: 'rgba(240, 180, 106, 0.22)',
    },
    // Corn / lime / chilli — Tacos
    17007: {
      slug: 'tacos',
      tastePrimary: '#2A2010',
      tasteSecondary: '#C9D86A',
      wash: '#f2f2df',
      surface: '#faf8ea',
      accent: '#788d35',
      accentSoft: 'rgba(120, 141, 53, 0.16)',
      glow: 'rgba(201, 216, 106, 0.2)',
    },
    // Comfort carbs — Pasta
    7562: {
      slug: 'pasta',
      tastePrimary: '#4A1E14',
      tasteSecondary: '#F2A070',
      wash: '#f5ebe4',
      surface: '#fbf3ed',
      accent: '#c46a45',
      accentSoft: 'rgba(196, 106, 69, 0.16)',
      glow: 'rgba(242, 160, 112, 0.2)',
    },
    // Fire / grill — Burgers
    7563: {
      slug: 'burgers',
      tastePrimary: '#2A1410',
      tasteSecondary: '#E89058',
      wash: '#f4ebe4',
      surface: '#faf3ec',
      accent: '#c46e3c',
      accentSoft: 'rgba(200, 110, 60, 0.16)',
      glow: 'rgba(232, 144, 88, 0.2)',
    },
    // Fire / roast — Mains
    7564: {
      slug: 'mains',
      tastePrimary: '#2C1C12',
      tasteSecondary: '#D4A86A',
      wash: '#f3ebe3',
      surface: '#f9f2e9',
      accent: '#a67a3c',
      accentSoft: 'rgba(166, 122, 60, 0.16)',
      glow: 'rgba(212, 168, 106, 0.2)',
    },
    // Brick oven — Pizza
    7566: {
      slug: 'pizza',
      tastePrimary: '#4A1C16',
      tasteSecondary: '#E8A888',
      wash: '#f5e9e4',
      surface: '#fbf1ec',
      accent: '#b85a42',
      accentSoft: 'rgba(184, 90, 66, 0.16)',
      glow: 'rgba(232, 168, 136, 0.2)',
    },
    // Garden — Vegan
    7567: {
      slug: 'vegan',
      tastePrimary: '#1A2818',
      tasteSecondary: '#A8D478',
      wash: '#eef4ea',
      surface: '#f5faf1',
      accent: '#4f7a3a',
      accentSoft: 'rgba(79, 122, 58, 0.16)',
      glow: 'rgba(140, 190, 100, 0.18)',
    },
    // Cold bar (hidden) — ocean-lite
    7599: {
      slug: 'cold-bar',
      tastePrimary: '#102028',
      tasteSecondary: '#8EC8D0',
      wash: '#eaf2f4',
      surface: '#f2f8f9',
      accent: '#3d7a82',
      accentSoft: 'rgba(61, 122, 130, 0.16)',
      glow: 'rgba(126, 200, 208, 0.18)',
    },
    // Caffeine — espresso
    7675: {
      slug: 'caffeine',
      tastePrimary: '#1A1410',
      tasteSecondary: '#C4A078',
      wash: '#f0ebe5',
      surface: '#f7f2ec',
      accent: '#6b4a2e',
      accentSoft: 'rgba(107, 74, 46, 0.16)',
      glow: 'rgba(160, 120, 80, 0.18)',
    },
    // Herbal tea — sage
    7676: {
      slug: 'herbal',
      tastePrimary: '#18241C',
      tasteSecondary: '#9EC8A0',
      wash: '#eef3ee',
      surface: '#f5f9f5',
      accent: '#4d7a58',
      accentSoft: 'rgba(77, 122, 88, 0.16)',
      glow: 'rgba(140, 180, 140, 0.18)',
    },
    // Pastry — berry caramel
    7697: {
      slug: 'pastry',
      tastePrimary: '#3A1824',
      tasteSecondary: '#F0B0A0',
      wash: '#f5e9ec',
      surface: '#fbf1f3',
      accent: '#a85a6a',
      accentSoft: 'rgba(168, 90, 106, 0.16)',
      glow: 'rgba(240, 176, 160, 0.2)',
    },
    // Non-caffeine — latte / soft cocoa
    7701: {
      slug: 'non-caffeine',
      tastePrimary: '#2A1C14',
      tasteSecondary: '#D4B090',
      wash: '#f2ebe4',
      surface: '#f8f3ec',
      accent: '#8a6a48',
      accentSoft: 'rgba(138, 106, 72, 0.16)',
      glow: 'rgba(212, 176, 144, 0.18)',
    },
    // Special service — plum
    9478: {
      slug: 'special',
      tastePrimary: '#221828',
      tasteSecondary: '#C8B0E0',
      wash: '#f0eaf2',
      surface: '#f7f2f8',
      accent: '#7a5a8e',
      accentSoft: 'rgba(122, 90, 142, 0.16)',
      glow: 'rgba(180, 150, 200, 0.18)',
    },
    // Ocean / wasabi — Sushi
    13581: {
      slug: 'sushi',
      tastePrimary: '#102428',
      tasteSecondary: '#7EC8B0',
      wash: '#e8f2f0',
      surface: '#f0f8f5',
      accent: '#2f7a6a',
      accentSoft: 'rgba(47, 122, 106, 0.16)',
      glow: 'rgba(126, 200, 176, 0.2)',
    },
    // Matcha bar
    14477: {
      slug: 'matcha',
      tastePrimary: '#1A3220',
      tasteSecondary: '#8FCB7A',
      wash: '#eaf2e6',
      surface: '#f3f8ef',
      accent: '#4a7a3a',
      accentSoft: 'rgba(74, 122, 58, 0.16)',
      glow: 'rgba(143, 203, 122, 0.2)',
    },
  };

  // Keep the exact public theme table and category fallback used by the stable
  // build. CSS property names are stored once so clear/apply never rebuild the
  // mapping on every focus change.
  const LIGHT_VARS = [
    ['--cat-wash', 'wash'],
    ['--cat-surface', 'surface'],
    ['--cat-accent', 'accent'],
    ['--cat-accent-soft', 'accentSoft'],
    ['--cat-glow', 'glow'],
  ];

  const TASTE_PRIMARY_VAR = '--color-scheme-1--taste-primary';
  const TASTE_SECONDARY_VAR = '--color-scheme-1--taste-secondary';

  function get(categoryId) {
    const key = String(categoryId == null ? '' : categoryId);
    return THEMES[key] || THEMES[String(DEFAULT_ID)];
  }

  function isLight() {
    return document.documentElement.getAttribute('data-theme') === 'light';
  }

  function setAttributeIfChanged(root, name, value) {
    const next = String(value);
    if (root.getAttribute(name) !== next) root.setAttribute(name, next);
  }

  function removeAttributeIfPresent(root, name) {
    if (root.hasAttribute(name)) root.removeAttribute(name);
  }

  function setStyleIfChanged(root, name, value) {
    if (root.style.getPropertyValue(name) !== value) {
      root.style.setProperty(name, value);
    }
  }

  function removeStyleIfPresent(root, name) {
    if (root.style.getPropertyValue(name)) root.style.removeProperty(name);
  }

  function clearLightVars(root) {
    for (const [name] of LIGHT_VARS) removeStyleIfPresent(root, name);
    // Chrome --wg-accent / --wg-gold stay brand cyan (never cleared or overridden).
  }

  function applyLightVars(root, theme) {
    for (const [name, key] of LIGHT_VARS) {
      setStyleIfChanged(root, name, theme[key]);
    }
    // Atmosphere only — do not override --wg-gold / --wg-accent.
  }

  function normalizeCategoryId(categoryId) {
    if (categoryId == null || categoryId === '' || categoryId === 'all') return null;
    const id = Number(categoryId);
    return Number.isNaN(id) ? null : id;
  }

  function dispatchThemeEvent(id, theme, light) {
    // Preserve the existing event contract even when the effective DOM values
    // were already correct. External consumers may use apply() as a semantic
    // category-focus signal, so only the redundant style/attribute writes are
    // deduplicated here — not the event itself.
    window.dispatchEvent(
      new CustomEvent('westo:category-theme', {
        detail: { id, slug: theme.slug, theme, light },
      }),
    );
  }

  /**
   * Stamp active category on <html> and apply CSS vars / taste props.
   * @param {string|number|null|undefined} categoryId
   * @param {{ skipTaste?: boolean }} [opts]
   */
  function apply(categoryId, opts) {
    const root = document.documentElement;
    const id = normalizeCategoryId(categoryId);

    // Preserve stable semantics for null / "all" / invalid categories:
    // category attributes and light-atmosphere overrides are removed, while
    // the last taste pair is intentionally left untouched.
    if (id == null) {
      removeAttributeIfPresent(root, 'data-cat-id');
      removeAttributeIfPresent(root, 'data-cat-slug');
      clearLightVars(root);
      return null;
    }

    const theme = get(id);
    const light = isLight();

    setAttributeIfChanged(root, 'data-cat-id', id);
    setAttributeIfChanged(root, 'data-cat-slug', theme.slug);

    if (light) applyLightVars(root, theme);
    else clearLightVars(root);

    if (!opts || !opts.skipTaste) {
      setStyleIfChanged(root, TASTE_PRIMARY_VAR, theme.tastePrimary);
      setStyleIfChanged(root, TASTE_SECONDARY_VAR, theme.tasteSecondary);
    }

    dispatchThemeEvent(id, theme, light);
    return theme;
  }

  function tasteFor(categoryId) {
    const theme = get(categoryId);
    return {
      primary: theme.tastePrimary,
      secondary: theme.tasteSecondary,
      slug: theme.slug,
    };
  }

  function reapply() {
    const root = document.documentElement;
    const id = root.getAttribute('data-cat-id');
    if (id) apply(id, { skipTaste: false });
    else clearLightVars(root);
  }

  // theme.js is loaded later on both the cinematic home page and classic menu.
  // Reapply after its event so a light/dark/system change updates atmosphere
  // without either module needing to know about the other's load order.
  window.addEventListener('westo:theme-change', reapply);

  window.westoCategoryTheme = {
    THEMES,
    get,
    apply,
    tasteFor,
    reapply,
  };
})();
