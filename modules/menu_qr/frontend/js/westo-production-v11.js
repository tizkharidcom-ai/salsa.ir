/* WESTO Production UI enhancer v11
   Presentation-only bridge. Existing state machines remain authoritative. */
(function () {
  'use strict';

  if (window.__WESTO_PRODUCTION_V11__) return;
  window.__WESTO_PRODUCTION_V11__ = true;

  const root = document.documentElement;
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  const EN = {
    7560: 'SALADS',
    7561: 'APPETIZERS',
    17007: 'TACOS',
    7562: 'PASTA',
    7563: 'BURGERS',
    7564: 'MAINS',
    7566: 'PIZZA',
    7567: 'VEGETARIAN',
    7599: 'COLD BAR',
    14477: 'MATCHA BAR',
    7675: 'CAFFEINE',
    7701: 'NON CAFFEINE',
    7676: 'HERBAL TEA',
    7697: 'PASTRY',
    9478: 'SPECIAL SERVICE',
    13581: 'SUSHI',
  };
  const AR = {
    7560: 'سلطة',
    7561: 'مقبلات',
    17007: 'تاكو',
    7562: 'باستا',
    7563: 'برغر',
    7564: 'أطباق رئيسية',
    7566: 'بيتزا',
    7567: 'نباتي',
    7599: 'بار بارد',
    14477: 'ماتشا',
    7675: 'كافيين',
    7701: 'بدون كافيين',
    7676: 'شاي أعشاب',
    7697: 'معجنات',
    9478: 'خدمة خاصة',
    13581: 'سوشي',
  };

  let meta = null;
  let heroCats = null;
  let lastCategoryId = null;
  let carouselBound = false;
  let menuReadyBound = false;
  let pendingRender = 0;

  function store() {
    return window.westoMenuStore || null;
  }

  function categories() {
    const s = store();
    const list = Array.isArray(s?.categories) ? s.categories : [];
    if (list.length) return list;
    const boot = window.__WESTO_CONTENT__?.menu;
    const fallback = Array.isArray(boot?.siteCategories) && boot.siteCategories.length
      ? boot.siteCategories
      : Array.isArray(boot?.menuCategories)
        ? boot.menuCategories.filter((c) => !c?.hiddenOnSite)
        : [];
    return fallback.filter((c) => c && c.coverImg);
  }

  function order() {
    const ids = window.__westoCategoryOrder;
    if (Array.isArray(ids) && ids.length) return ids.map(Number);
    return categories().map((c) => Number(c.id));
  }

  function currentCategoryId() {
    const attr = Number(root.getAttribute('data-cat-id'));
    if (Number.isFinite(attr)) return attr;
    const ids = order();
    if (window.carousel && typeof window.carousel.getIndex === 'function') {
      const i = Number(window.carousel.getIndex(true));
      if (Number.isFinite(i) && ids.length) return ids[(i % ids.length + ids.length) % ids.length];
    }
    if (window.carousel && Number.isFinite(Number(window.carousel.index)) && ids.length) {
      const i = Number(window.carousel.index);
      return ids[(i % ids.length + ids.length) % ids.length];
    }
    return ids[0] || null;
  }

  function findCategory(id) {
    return categories().find((c) => Number(c.id) === Number(id)) || null;
  }

  function lang() {
    return document.documentElement.lang || document.body?.getAttribute('lang') || 'fa';
  }

  function categoryLabel(cat) {
    const l = lang();
    if (l === 'en') return EN[Number(cat.id)] || cat.title || cat.name1 || '';
    if (l === 'ar') return AR[Number(cat.id)] || cat.title || cat.name1 || '';
    return cat.title || cat.name1 || '';
  }

  function categoryDesc(cat) {
    const l = lang();
    if (l === 'en') {
      // Server currently does not publish translated category descriptions.
      // Keep the source category title in English and preserve source description
      // rather than fabricating a translation.
      return String(cat.shortDesc || cat.longDesc || '');
    }
    if (l === 'ar') return String(cat.shortDesc || cat.longDesc || '');
    return String(cat.shortDesc || cat.longDesc || '');
  }

  function categoryCover(cat) {
    const raw = String(cat?.coverImg || '').trim();
    if (!raw) return '';
    if (/^(?:data:|blob:|https?:|\/)/i.test(raw)) return raw;
    return raw;
  }

  function applyProductionTheme(id) {
    if (!Number.isFinite(Number(id))) return;
    const t = window.westoCategoryTheme?.get?.(Number(id));
    if (!t) return;

    // category-theme.js intentionally clears light-only vars in dark mode.
    // Production visuals need the same atmosphere in both themes, so re-expose
    // its *existing* source values under the same CSS tokens after its semantic event.
    const vars = {
      '--cat-wash': t.wash,
      '--cat-surface': t.surface,
      '--cat-accent': t.accent,
      '--cat-accent-soft': t.accentSoft,
      '--cat-glow': t.glow,
    };
    for (const [name, value] of Object.entries(vars)) {
      if (value && root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
    }
  }

  function mountHeroEditorial() {
    const gamme = $('#gamme');
    if (!gamme) return false;
    const host = $('.gamme_container .max-width-medium', gamme) || $('.gamme_container', gamme);
    if (!host) return false;

    if (!meta) {
      meta = document.createElement('div');
      meta.className = 'westo-prod-hero-meta';
      meta.setAttribute('aria-live', 'polite');
      meta.innerHTML = '<div class="westo-prod-hero-kicker"></div><p class="westo-prod-hero-desc"></p>';
      host.appendChild(meta);
    }

    if (!heroCats) {
      heroCats = document.createElement('nav');
      heroCats.className = 'westo-prod-hero-cats';
      heroCats.setAttribute('aria-label', 'دسته‌بندی‌ها');
      host.appendChild(heroCats);
      heroCats.addEventListener('click', onHeroCategoryClick);
    }
    return true;
  }

  function renderHeroCategories() {
    if (!mountHeroEditorial()) return;
    const cats = categories();
    const ids = order();
    if (!cats.length || !ids.length) return;

    const signature = cats
      .map((c) => `${c.id}:${c.coverImg || ''}:${c.title || c.name1 || ''}`)
      .join('|');
    if (heroCats.dataset.signature !== signature) {
      heroCats.dataset.signature = signature;
      heroCats.innerHTML = ids
        .map((id, index) => {
          const cat = cats.find((c) => Number(c.id) === Number(id));
          if (!cat) return '';
          const cover = categoryCover(cat);
          const label = categoryLabel(cat);
          return `<button class="westo-prod-hero-cat" type="button" data-category-id="${Number(id)}" data-index="${index}" aria-label="${escapeHtml(label)}">
            <img src="${escapeAttr(cover)}" alt="" width="48" height="48" loading="${index < 3 ? 'eager' : 'lazy'}" decoding="async">
            <span>${escapeHtml(label)}</span>
          </button>`;
        })
        .join('');
    }
  }

  function renderActiveCategory(id = currentCategoryId()) {
    if (!Number.isFinite(Number(id))) return;
    lastCategoryId = Number(id);
    applyProductionTheme(lastCategoryId);
    renderHeroCategories();

    const cats = categories();
    const ids = order();
    const cat = cats.find((c) => Number(c.id) === lastCategoryId);
    if (!cat || !meta) return;
    const idx = Math.max(0, ids.findIndex((x) => Number(x) === lastCategoryId));
    const total = Math.max(1, ids.length);
    const kicker = $('.westo-prod-hero-kicker', meta);
    const desc = $('.westo-prod-hero-desc', meta);
    if (kicker) {
      kicker.textContent = `${String(idx + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')} · ${EN[lastCategoryId] || ''}`;
    }
    if (desc) desc.textContent = categoryDesc(cat);

    if (heroCats) {
      heroCats.querySelectorAll('.westo-prod-hero-cat').forEach((button) => {
        const on = Number(button.dataset.categoryId) === lastCategoryId;
        button.classList.toggle('is-active', on);
        button.setAttribute('aria-current', on ? 'true' : 'false');
      });
      const active = heroCats.querySelector('.westo-prod-hero-cat.is-active');
      if (active && !root.classList.contains('is-cat-flying')) {
        requestAnimationFrame(() => {
          try {
            active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          } catch (_) {}
        });
      }
    }
  }

  function onHeroCategoryClick(event) {
    const button = event.target.closest('.westo-prod-hero-cat[data-index]');
    if (!button) return;
    const index = Number(button.dataset.index);
    const categoryId = Number(button.dataset.categoryId);
    if (!Number.isFinite(index) || !Number.isFinite(categoryId)) return;

    // Hero chips are a category index, not a link into dishes. The existing
    // carousel remains authoritative so Three.js, board data and sound stay synced.
    if (window.carousel && typeof window.carousel.goTo === 'function') {
      try {
        window.carousel.goTo(index);
        renderActiveCategory(categoryId);
        return;
      } catch (_) {}
    }

    // Only fallback if the carousel owner has not mounted yet.
    window.westoCategoryTheme?.apply?.(categoryId);
    renderActiveCategory(categoryId);
  }

  function bindCarousel() {
    if (carouselBound || !window.carousel?.changed?.connect) return false;
    carouselBound = true;
    try {
      window.carousel.changed.connect(({ index }) => {
        const ids = order();
        if (!ids.length) return;
        const safe = ((Number(index) || 0) % ids.length + ids.length) % ids.length;
        scheduleRender(ids[safe]);
      });
      return true;
    } catch (_) {
      carouselBound = false;
      return false;
    }
  }

  function scheduleRender(id) {
    if (pendingRender) cancelAnimationFrame(pendingRender);
    pendingRender = requestAnimationFrame(() => {
      pendingRender = 0;
      renderActiveCategory(Number.isFinite(Number(id)) ? Number(id) : currentCategoryId());
    });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[ch]);
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  /* ---- admin-replaceable pattern refinement ----
     Default uses the approved curated v8 crop. If Admin supplies a custom entrance
     pattern, use it for CTA and derive a tiny edge motif client-side for the micro
     background without changing the content contract. */
  function syncAdminPattern() {
    const configured = String(window.__WESTO_CONTENT__?.content?.['entrance.pattern'] || '').trim();
    if (!configured) return;
    const src = configured;
    root.style.setProperty('--prod-cta-pattern', `url("${src.replace(/"/g, '\\"')}")`);
    deriveMicroPattern(src).then((dataUrl) => {
      if (dataUrl) root.style.setProperty('--prod-pattern-micro', `url("${dataUrl}")`);
    }).catch(() => {});
  }

  function deriveMicroPattern(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        try {
          const sample = document.createElement('canvas');
          sample.width = sample.height = 64;
          const sctx = sample.getContext('2d', { willReadFrequently: true });
          if (!sctx) return resolve('');
          const sw = img.naturalWidth || img.width;
          const sh = img.naturalHeight || img.height;
          const side = Math.max(1, Math.min(sw, sh) * .33);
          const sx = Math.max(0, sw * .50 - side * .5);
          const sy = Math.max(0, sh * .24 - side * .5);
          sctx.clearRect(0, 0, 64, 64);
          sctx.drawImage(img, sx, sy, side, side, 0, 0, 64, 64);
          const data = sctx.getImageData(0, 0, 64, 64);
          const out = document.createElement('canvas');
          out.width = out.height = 10;
          const octx = out.getContext('2d');
          if (!octx) return resolve('');
          const tiny = octx.createImageData(10, 10);
          // Approximate local edge energy in each 6×6 cell. This yields the same
          // micro-motif character without shipping an image-processing dependency.
          for (let ty = 0; ty < 10; ty += 1) {
            for (let tx = 0; tx < 10; tx += 1) {
              let energy = 0;
              let count = 0;
              const x0 = Math.floor((tx / 10) * 63);
              const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) / 10) * 63));
              const y0 = Math.floor((ty / 10) * 63);
              const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) / 10) * 63));
              for (let y = y0; y < y1; y += 2) {
                for (let x = x0; x < x1; x += 2) {
                  const i = (y * 64 + x) * 4;
                  const j = (y * 64 + Math.min(63, x + 1)) * 4;
                  const k = (Math.min(63, y + 1) * 64 + x) * 4;
                  const l = (data.data[i] + data.data[i + 1] + data.data[i + 2]) / 3;
                  const r = (data.data[j] + data.data[j + 1] + data.data[j + 2]) / 3;
                  const d = (data.data[k] + data.data[k + 1] + data.data[k + 2]) / 3;
                  energy += Math.abs(l - r) + Math.abs(l - d);
                  count += 2;
                }
              }
              const alpha = Math.max(0, Math.min(255, Math.round((energy / Math.max(1, count) - 7) * 5.4)));
              const oi = (ty * 10 + tx) * 4;
              tiny.data[oi] = 48;
              tiny.data[oi + 1] = 220;
              tiny.data[oi + 2] = 228;
              tiny.data[oi + 3] = alpha;
            }
          }
          octx.putImageData(tiny, 0, 0);
          resolve(out.toDataURL('image/png'));
        } catch (_) {
          resolve('');
        }
      };
      img.onerror = () => resolve('');
      img.src = src;
    });
  }

  function enhanceClassicMenu() {
    if (!document.body?.classList.contains('classic-menu')) return;
    // classic-menu.js already applies category-theme on active category. We only
    // re-expose the same theme in dark mode for the production atmosphere.
    const observer = new MutationObserver(() => scheduleRender());
    observer.observe(root, { attributes: true, attributeFilter: ['data-cat-id', 'data-theme'] });
  }

  function onReady() {
    mountHeroEditorial();
    renderHeroCategories();
    scheduleRender();
    bindCarousel();
    syncAdminPattern();
    enhanceClassicMenu();

    // Load-order resilience: smart loader mounts the carousel and store later.
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      bindCarousel();
      renderHeroCategories();
      if (categories().length) scheduleRender();
      if ((carouselBound && categories().length) || tries > 80) clearInterval(timer);
    }, 125);
  }

  // Semantic events emitted by the original runtime.
  window.addEventListener('westo:category-theme', (event) => {
    const id = Number(event?.detail?.id);
    if (Number.isFinite(id)) scheduleRender(id);
  });
  document.addEventListener('westo:menu-ready', () => {
    menuReadyBound = true;
    renderHeroCategories();
    scheduleRender();
  });
  document.addEventListener('westo:langchange', () => {
    if (heroCats) heroCats.dataset.signature = '';
    renderHeroCategories();
    scheduleRender();
  });
  window.addEventListener('westo:theme-change', () => {
    if (lastCategoryId != null) requestAnimationFrame(() => applyProductionTheme(lastCategoryId));
  });

  // Root category mutation catches both carousel and deep-link changes without
  // adding another event path to the source state machine.
  new MutationObserver(() => {
    const id = currentCategoryId();
    if (id != null && Number(id) !== Number(lastCategoryId)) scheduleRender(id);
  }).observe(root, { attributes: true, attributeFilter: ['data-cat-id', 'data-theme', 'lang'] });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once: true });
  else onReady();
})();
