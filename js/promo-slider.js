/* WESTO Promo / Story Slider — data-driven campaign rail under the navbar. */
(function () {
  'use strict';

  const root = document.documentElement;
  const source = Array.isArray(window.__WESTO_CONTENT__?.promoSlides)
    ? window.__WESTO_CONTENT__.promoSlides
    : [];
  const branchId = Number(window.__WESTO_CONTENT__?.restaurantPayload?.branch?.id || 0) || null;

  const slides = source
    .filter((slide) => slide && ['menu','both'].includes(String(slide.placement || 'menu')))
    .filter((slide) => slide.branchId == null || (branchId != null && Number(slide.branchId) === branchId))
    .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) || Number(a.id) - Number(b.id));

  if (!slides.length) {
    root.classList.remove('has-westo-promo');
    root.style.removeProperty('--menu-promo-h');
    root.style.removeProperty('--menu-promo-gap');
    root.style.removeProperty('--menu-nav-live-h');
    return;
  }

  const nav = document.querySelector('.navbar');
  if (!nav) return;

  const aside = document.createElement('aside');
  aside.id = 'westo-promo-slider';
  aside.className = 'westo-promo-slider';
  aside.setAttribute('aria-label', 'پیشنهادها و رویدادها');

  const track = document.createElement('div');
  track.className = 'westo-promo-slider__track';
  track.setAttribute('role', 'list');
  track.setAttribute('data-lenis-prevent', '');
  track.setAttribute('data-lenis-prevent-touch', '');
  track.setAttribute('data-lenis-prevent-wheel', '');
  aside.appendChild(track);

  const scheduler = window.WestoResources || null;
  const P = scheduler?.priorities || { VISIBLE: 92, NEAR: 76, PREDICT: 54 };
  const impressionSent = new Set();
  const elements = [];

  function report(id, kind) {
    if (!id) return;
    try {
      const url = `/api/promo-slides/${encodeURIComponent(id)}/${kind}`;
      if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([], { type: 'application/octet-stream' }));
      else fetch(url, { method: 'POST', keepalive: true, credentials: 'same-origin' }).catch(() => {});
    } catch (_) {}
  }

  function actionLabel(slide) {
    if (slide.ctaLabel) return slide.ctaLabel;
    if (slide.actionType === 'instagram') return 'مشاهده در اینستاگرام';
    if (slide.actionType === 'category') return 'مشاهده دسته';
    if (slide.actionType === 'dish') return 'مشاهده غذا';
    if (slide.actionType === 'url' || slide.actionType === 'internal') return 'مشاهده';
    return '';
  }

  function runAction(slide) {
    const type = String(slide.actionType || 'none');
    const value = String(slide.actionValue || '').trim();
    if (type === 'none') return;
    report(slide.id, 'click');

    if (type === 'category') {
      const categoryId = Number(value);
      if (Number.isFinite(categoryId)) window.westoOpenMenuTarget?.({ categoryId });
      return;
    }
    if (type === 'dish') {
      const dishId = Number(value);
      if (Number.isFinite(dishId)) window.westoOpenMenuTarget?.({ dishId });
      return;
    }
    if (type === 'internal') {
      if (value.startsWith('/')) location.href = value;
      return;
    }
    if (type === 'instagram' || type === 'url') {
      if (/^https?:\/\//i.test(value)) window.open(value, '_blank', 'noopener,noreferrer');
    }
  }

  slides.forEach((slide, index) => {
    const card = document.createElement('article');
    card.className = 'westo-promo-card';
    card.dataset.promoId = String(slide.id || '');
    card.setAttribute('role', 'listitem');

    if (slide.image) {
      const img = document.createElement('img');
      img.className = 'westo-promo-card__media';
      img.alt = '';
      img.decoding = 'async';
      img.loading = index === 0 ? 'eager' : 'lazy';
      card.appendChild(img);
      const priority = index === 0 ? P.VISIBLE : index === 1 ? P.NEAR : P.PREDICT;
      if (scheduler?.bindImage) {
        scheduler.bindImage(img, slide.image, {
          priority,
          group: 'promo-slider',
          loading: index === 0 ? 'eager' : 'lazy',
          decode: true,
        }).catch(() => { img.src = slide.image; });
      } else {
        img.src = slide.image;
      }
    }

    const shade = document.createElement('span');
    shade.className = 'westo-promo-card__shade';
    shade.setAttribute('aria-hidden', 'true');
    card.appendChild(shade);

    const copy = document.createElement('div');
    copy.className = 'westo-promo-card__copy';
    if (slide.badge) {
      const badge = document.createElement('span');
      badge.className = 'westo-promo-card__badge';
      badge.textContent = slide.badge;
      copy.appendChild(badge);
    }
    if (slide.title) {
      const title = document.createElement('strong');
      title.className = 'westo-promo-card__title';
      title.textContent = slide.title;
      copy.appendChild(title);
    }
    if (slide.subtitle) {
      const subtitle = document.createElement('span');
      subtitle.className = 'westo-promo-card__subtitle';
      subtitle.textContent = slide.subtitle;
      copy.appendChild(subtitle);
    }
    card.appendChild(copy);

    const ctaText = actionLabel(slide);
    if (ctaText && slide.actionType !== 'none') {
      const cta = document.createElement('button');
      cta.type = 'button';
      cta.className = 'westo-promo-card__cta';
      cta.innerHTML = `<span>${ctaText}</span><span aria-hidden="true">←</span>`;
      cta.addEventListener('pointerdown', () => {
        if (slide.image) scheduler?.requestImage?.(slide.image, { priority: P.VISIBLE, group: 'promo-intent' }).catch(() => {});
      }, { passive: true });
      cta.addEventListener('click', (event) => {
        event.preventDefault();
        runAction(slide);
      });
      card.appendChild(cta);
    }

    track.appendChild(card);
    elements.push({ slide, card });
  });

  // Mount beside the category chrome when it exists. The old implementation
  // only inserted after `.navbar` and relied on a hard-coded nav-height token;
  // on real mobile browser chrome / resized windows that could place the rail
  // above or behind the category bar. Keep the DOM relationship explicit and
  // continuously measure the real navbar bottom instead.
  function placeBeforeCatbar() {
    const catbar = document.getElementById('westo-dish-catbar');
    if (catbar?.parentNode) {
      if (aside.parentNode !== catbar.parentNode || aside.nextSibling !== catbar) {
        catbar.parentNode.insertBefore(aside, catbar);
      }
      return true;
    }
    if (!aside.isConnected) nav.insertAdjacentElement('afterend', aside);
    return false;
  }

  let metricsRaf = 0;
  function syncChromeMetrics() {
    if (metricsRaf) cancelAnimationFrame(metricsRaf);
    metricsRaf = requestAnimationFrame(() => {
      metricsRaf = 0;
      const navRect = nav.getBoundingClientRect();
      const navBottom = Math.max(0, Math.round(navRect.bottom * 100) / 100);
      const promoRect = aside.getBoundingClientRect();
      const promoH = Math.max(0, Math.round(promoRect.height * 100) / 100);
      // One live value becomes the source of truth for Hero/Dish/Catbar chrome.
      // It intentionally overrides breakpoint guesses only while a promo exists.
      if (navBottom > 0) {
        root.style.setProperty('--menu-nav-h', `${navBottom}px`);
        root.style.setProperty('--menu-nav-live-h', `${navBottom}px`);
      }
      if (promoH > 0) root.style.setProperty('--menu-promo-h', `${promoH}px`);
      document.dispatchEvent(new CustomEvent('westo:promo-layout', {
        detail: { navBottom, promoHeight: promoH },
      }));
    });
  }

  const placedAtBoot = placeBeforeCatbar();
  root.classList.add('has-westo-promo');
  syncChromeMetrics();

  const placementObserver = new MutationObserver(() => {
    if (placeBeforeCatbar()) placementObserver.disconnect();
    syncChromeMetrics();
  });
  if (!placedAtBoot) placementObserver.observe(document.body, { childList: true, subtree: true });

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(syncChromeMetrics)
    : null;
  resizeObserver?.observe(nav);
  resizeObserver?.observe(aside);
  window.addEventListener('resize', syncChromeMetrics, { passive: true });
  window.visualViewport?.addEventListener?.('resize', syncChromeMetrics, { passive: true });
  document.addEventListener('westo:responsive-settle', syncChromeMetrics);


  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.55) continue;
        const id = entry.target.dataset.promoId;
        if (!id || impressionSent.has(id)) continue;
        impressionSent.add(id);
        report(id, 'impression');
      }
    }, { threshold: [0.55] });
    elements.forEach(({ card }) => io.observe(card));
  } else if (elements[0]?.slide?.id) {
    report(elements[0].slide.id, 'impression');
  }

  // Intent-aware next-slide warmup on horizontal interaction.
  track.addEventListener('pointerdown', () => {
    const center = track.scrollLeft + track.clientWidth * 0.5;
    const ordered = elements
      .map(({ slide, card }) => ({ slide, d: Math.abs(card.offsetLeft + card.offsetWidth * 0.5 - center) }))
      .sort((a, b) => a.d - b.d);
    const next = ordered[1]?.slide;
    if (next?.image) scheduler?.requestImage?.(next.image, { priority: P.NEAR, group: 'promo-intent' }).catch(() => {});
  }, { passive: true });

  // Optional autoplay is opt-in per slide. Any manual interaction pauses it.
  let autoplayTimer = 0;
  let manualUntil = 0;
  const autoplayMs = Math.max(0, ...slides.map((slide) => Number(slide.autoplayMs) || 0));
  function scheduleAutoplay() {
    clearTimeout(autoplayTimer);
    if (!autoplayMs || slides.length < 2 || document.hidden) return;
    autoplayTimer = setTimeout(() => {
      if (Date.now() < manualUntil) return scheduleAutoplay();
      const width = track.firstElementChild?.getBoundingClientRect().width || track.clientWidth;
      const gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap || '0') || 0;
      const max = Math.max(0, track.scrollWidth - track.clientWidth);
      const next = track.scrollLeft + width + gap >= max - 4 ? 0 : track.scrollLeft + width + gap;
      track.scrollTo({ left: next, behavior: 'smooth' });
      scheduleAutoplay();
    }, autoplayMs);
  }
  ['pointerdown', 'touchstart', 'wheel'].forEach((type) => track.addEventListener(type, () => {
    manualUntil = Date.now() + Math.max(5000, autoplayMs * 2);
  }, { passive: true }));
  document.addEventListener('visibilitychange', scheduleAutoplay);
  scheduleAutoplay();

  window.addEventListener('pagehide', () => {
    clearTimeout(autoplayTimer);
    if (metricsRaf) cancelAnimationFrame(metricsRaf);
    resizeObserver?.disconnect();
    placementObserver.disconnect();
  }, { once: true });
})();
