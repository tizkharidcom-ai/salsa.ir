/* Restaurant table cart + sushi menu boards on scroll sections. */
(function () {
  const STORAGE_KEY = 'westo_table';
  const DISH_FAVORITES_KEY = 'westo_dish_favorites_v1';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];

  function perfTier() {
    return window.westoPerformance?.tier || 'balanced';
  }

  function perfQuality() {
    return window.westoPerformance?.quality || { eagerBoards: 3, normalizeSize: 512 };
  }


  // WESTO Smart Resource Scheduler bridge. The scheduler owns menu-image bytes,
  // dedupes Board/Rail/Three requests, and keeps low-priority work out of the
  // interaction lane. Native src is only the fallback when the scheduler is absent.
  function resourceScheduler() {
    return window.WestoResources || null;
  }

  function resourcePriority(name, fallback = 76) {
    return Number(resourceScheduler()?.priorities?.[name] ?? fallback);
  }

  function readyManagedSrc(src) {
    const source = String(src || '').trim();
    return resourceScheduler()?.getReadyUrl?.(source) || source;
  }

  function bindManagedImage(img, src, options = {}) {
    if (!img) return Promise.resolve(false);
    const source = String(src || '').trim();
    if (!source) {
      img.removeAttribute('src');
      delete img.dataset.source;
      delete img.dataset.expectedSource;
      delete img.dataset.appliedSource;
      return Promise.resolve(false);
    }
    const scheduler = resourceScheduler();
    if (options.progressive && scheduler?.bindProgressiveImage) {
      return scheduler.bindProgressiveImage(img, source, options);
    }
    if (scheduler?.bindImage) {
      return scheduler.bindImage(img, source, options);
    }
    img.dataset.expectedSource = source;
    img.dataset.appliedSource = source;
    img.dataset.source = source;
    img.src = source;
    return Promise.resolve(true);
  }

  function observeManagedImage(img, src, options = {}) {
    if (!img) return;
    const source = String(src || '').trim();
    if (!source) return;
    const scheduler = resourceScheduler();
    if (scheduler?.observeImage) {
      scheduler.observeImage(img, source, options);
      return;
    }
    img.dataset.expectedSource = source;
    img.dataset.appliedSource = source;
    img.dataset.source = source;
    img.src = source;
  }

  function warmManagedImage(src, options = {}) {
    const source = String(src || '').trim();
    if (!source) return Promise.resolve(null);
    const scheduler = resourceScheduler();
    if (scheduler?.requestImage) return scheduler.requestImage(source, options).catch(() => null);
    const probe = new Image();
    probe.decoding = 'async';
    probe.src = source;
    return Promise.resolve(null);
  }

  function normalizeDigits(str) {
    return String(str)
      .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
      .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  }

  function tr(key, vars) {
    return window.westoI18n?.t ? window.westoI18n.t(key, vars) : key;
  }

  function localeTag() {
    const l = window.westoI18n?.lang || 'fa';
    return l === 'en' ? 'en-US' : l === 'ar' ? 'ar' : 'fa-IR';
  }

  function formatPrice(n) {
    const unit = window.westoI18n?.t ? window.westoI18n.t('currency.toman') : 'تومان';
    return `${Number(n || 0).toLocaleString(localeTag())} ${unit}`;
  }

  const ALLERGEN_META = {
    gluten: { fa: 'گلوتن', en: 'Gluten', ar: 'غلوتين', terms: /گلوتن|نان|خمیر|آرد|پاستا|bread|dough|flour|pasta/i },
    dairy: { fa: 'لبنیات', en: 'Dairy', ar: 'ألبان', terms: /شیر|پنیر|خامه|کره|ماست|بستنی|milk|cheese|cream|butter|yog(?:h)?urt|ice\s*cream/i },
    egg: { fa: 'تخم‌مرغ', en: 'Egg', ar: 'بيض', terms: /تخم[‌\s-]*مرغ|مایونز|egg|mayonnaise/i },
    nuts: { fa: 'آجیل درختی', en: 'Tree nuts', ar: 'مكسرات', terms: /بادام(?![‌\s-]*زمینی)|گردو|فندق|پسته|کاجو|بادام هندی|cashew|almond|walnut|hazelnut|pistachio/i },
    peanut: { fa: 'بادام‌زمینی', en: 'Peanut', ar: 'فول سوداني', terms: /بادام[‌\s-]*زمینی|کره[‌\s-]*بادام[‌\s-]*زمینی|peanut/i },
    soy: { fa: 'سویا', en: 'Soy', ar: 'صويا', terms: /سویا|سویا[‌\s-]*سس|soy/i },
    seafood: { fa: 'دریایی / صدف', en: 'Seafood / shellfish', ar: 'مأكولات بحرية', terms: /میگو|ماهی|سالمون|تن ماهی|صدف|خرچنگ|کرب|crab|shrimp|fish|salmon|tuna|shellfish/i },
    sesame: { fa: 'کنجد', en: 'Sesame', ar: 'سمسم', terms: /کنجد|ارده|تاهینی|sesame|tahini/i },
    mustard: { fa: 'خردل', en: 'Mustard', ar: 'خردل', terms: /خردل|mustard/i },
  };

  const ALLERGEN_COPY = {
    fa: {
      title: 'آلرژن‌ها',
      contains: 'حاوی',
    },
    en: {
      title: 'Allergens',
      contains: 'Contains',
    },
    ar: {
      title: 'مسببات الحساسية',
      contains: 'يحتوي على',
    },
  };

  function activeLang() {
    const lang = window.westoI18n?.lang || document.documentElement.lang || 'fa';
    return ALLERGEN_COPY[lang] ? lang : 'fa';
  }

  function allergenIdsFor(item) {
    const found = new Set(Array.isArray(item?.allergens) ? item.allergens : []);
    const ingredients = [
      item?.name,
      item?.en,
      item?.ar,
      item?.desc,
      item?.description,
      item?.descEn,
      item?.descriptionEn,
      item?.descAr,
      item?.descriptionAr,
    ]
      .filter(Boolean)
      .join(' ');
    Object.entries(ALLERGEN_META).forEach(([id, meta]) => {
      if (meta.terms.test(ingredients)) found.add(id);
    });
    return [...found].filter((id) => ALLERGEN_META[id]);
  }

  function allergenIcon(id) {
    const common = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
    const paths = {
      gluten: '<path d="M12 3v18M12 7c-3 0-5-1.5-6-4M12 11c-3 0-5-1.5-6-4M12 15c3 0 5-1.5 6-4M12 19c3 0 5-1.5 6-4"/>',
      dairy: '<path d="M12 3s5.5 6.4 5.5 11A5.5 5.5 0 0 1 6.5 14C6.5 9.4 12 3 12 3Z"/><path d="M9.5 15.5c.8.8 1.8 1.2 3 1.2"/>',
      egg: '<path d="M12 3c3.5 4.5 5.4 7.4 5.4 11a5.4 5.4 0 0 1-10.8 0c0-3.6 1.9-6.5 5.4-11Z"/><path d="M9.5 15c.5 1.1 1.3 1.6 2.5 1.6"/>',
      nuts: '<path d="M9 5c-2.2 1.1-3.6 3.4-3.2 6.1.3 2.1 1.8 3.8 3.8 4.4.5 2.1 2.4 3.6 4.6 3.6 2.6 0 4.8-2.1 4.8-4.8 0-1.6-.8-3-2-3.9.1-2.5-1.9-4.6-4.4-4.6-1.3 0-2.5.5-3.4 1.4"/><path d="M10 10c1 .1 1.8.5 2.5 1.3"/>',
      peanut: '<path d="M10 4.5c-2.7 0-4.5 2.1-4.5 4.6 0 1.5.6 2.8 1.8 3.6A4.5 4.5 0 0 0 12 19.5c2.7 0 4.5-2.1 4.5-4.6 0-1.5-.6-2.8-1.8-3.6A4.5 4.5 0 0 0 10 4.5Z"/><path d="M8 8.2h8M7.4 12h9.2M8 15.8h8"/>',
      soy: '<path d="M8 5.5c3.8-1 7.7 1.3 8.7 5.1 1 3.8-1.3 7.7-5.1 8.7-3.8 1-7.7-1.3-8.7-5.1-1-3.8 1.3-7.7 5.1-8.7Z"/><path d="M7.5 8.5c1.1.4 1.9 1.2 2.4 2.4M12.6 13.1c1.1.4 1.9 1.2 2.4 2.4"/>',
      seafood: '<path d="M4 12c3.3-3.4 7.3-4.5 12-3.2L20 5v14l-4-3.8c-4.7 1.3-8.7.2-12-3.2Z"/><circle cx="10" cy="11" r=".9" fill="currentColor" stroke="none"/>',
      sesame: '<path d="M8 4.5c2 0 3 1.8 3 3.8S10 12 8 12 5 10.2 5 8.3s1-3.8 3-3.8ZM16 12c2 0 3 1.8 3 3.8s-1 3.7-3 3.7-3-1.7-3-3.7 1-3.8 3-3.8ZM8 14c1.6 0 2.5 1.4 2.5 3S9.6 20 8 20s-2.5-1.4-2.5-3S6.4 14 8 14Z"/>',
      mustard: '<path d="M12 20V4M12 8c-2.8 0-4.5-1.4-5.5-3M12 12c2.8 0 4.5-1.4 5.5-3M12 16c-2.8 0-4.5-1.4-5.5-3"/><circle cx="17.5" cy="5" r="1.5"/><circle cx="6.5" cy="13" r="1.5"/>',
      info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 10.5v5.2M12 7.7h.01"/>',
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true" ${common}>${paths[id] || ''}</svg>`;
  }

  function renderAllergenPanel(item, { compact = false } = {}) {
    const lang = activeLang();
    const copy = ALLERGEN_COPY[lang];
    const ids = allergenIdsFor(item);
    if (!ids.length) return '';
    const chips = ids
      .map((id) => {
        const label = ALLERGEN_META[id][lang] || ALLERGEN_META[id].fa;
        return `<span class="menu-allergen__chip" aria-label="${escapeHtml(`${copy.contains} ${label}`)}">${allergenIcon(id)}<span>${escapeHtml(label)}</span></span>`;
      })
      .join('');
    return `<aside class="menu-allergen${compact ? ' menu-allergen--compact' : ''}" aria-label="${escapeHtml(copy.title)}">
      <div class="menu-allergen__head"><span class="menu-allergen__marker" aria-hidden="true"></span><strong>${escapeHtml(copy.title)}</strong></div>
      <div class="menu-allergen__chips">${chips}</div>
    </aside>`;
  }

  function paintBoardAllergens(sec, item) {
    if (!sec) return;
    let slot = sec.querySelector('.menu-allergen-slot');
    const addButton = sec.querySelector('[data-menu-add]');
    const action =
      addButton?.closest('.max-width-xsmall') || addButton?.closest('.menu-add-wrap');
    if (!item) {
      slot?.remove();
      return;
    }
    const markup = renderAllergenPanel(item);
    if (!markup) {
      slot?.remove();
      return;
    }
    if (!slot) {
      slot = document.createElement('div');
      slot.className = 'menu-allergen-slot';
      if (action?.parentNode) action.parentNode.insertBefore(slot, action);
    }
    if (slot && slot.__westoAllergenMarkup !== markup) {
      slot.innerHTML = markup;
      slot.__westoAllergenMarkup = markup;
    }
  }  // #endregion

  function loadCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      // Migrate classic-menu `{ lines: [...] }` shape → flat array
      if (raw && !Array.isArray(raw) && Array.isArray(raw.lines)) return raw.lines;
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }
  function saveCart(cart) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    updateBadge();
    renderCart();
    document.dispatchEvent(new CustomEvent('westo:cartchange', { detail: { cart } }));
  }

  let menuByCategory = {};
  let categoryOrder = []; // ordered category ids that actually have items
  let cart = loadCart();

  const badge = $('#table-badge');
  const drawer = $('#table-drawer');
  const linesEl = $('#table-lines');
  const emptyEl = $('#table-empty');
  const totalEl = $('#table-total');
  const checkoutBtn = $('#table-checkout-btn');
  const viewCart = $('#table-view-cart');
  const viewCheckout = $('#table-view-checkout');
  const viewDone = $('#table-view-done');

  function cartCount() {
    return cart.reduce((s, l) => s + l.qty, 0);
  }
  function cartTotal() {
    return cart.reduce((s, l) => s + l.price * l.qty, 0);
  }

  function updateBadge() {
    if (!badge) return;
    const n = cartCount();
    const prev = Number(badge.dataset.count || 0);
    const shown = n ? n.toLocaleString(localeTag()) : '0';
    badge.textContent = shown;
    badge.dataset.count = String(n);
    badge.hidden = n === 0;
    badge.setAttribute('aria-hidden', n === 0 ? 'true' : 'false');
    badge.setAttribute('aria-live', 'polite');
    const navBtn = $('#nav-table-btn');
    if (navBtn) {
      const label = tr('cart.title');
      navBtn.classList.toggle('has-items', n > 0);
      navBtn.setAttribute(
        'aria-label',
        n ? `${label}, ${shown}` : label,
      );
      const labelEl =
        navBtn.querySelector('[data-i18n="cart.title"]') ||
        navBtn.querySelector('.cm-table-btn__label') ||
        navBtn.querySelector('.navbar_table__label') ||
        navBtn.querySelector('div:not(.table-badge):not(.icon-embed-xsmall)');
      if (labelEl && !labelEl.classList.contains('table-badge')) {
        labelEl.textContent = label;
      }
    }
    if (n > 0 && n !== prev) {
      badge.classList.remove('is-pop');
      // restart CSS animation
      void badge.offsetWidth;
      badge.classList.add('is-pop');
    }
  }

  function toast(text) {
    let el = $('.toast-add');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast-add';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 1400);
  }

  // Exposed so classic menu / overlay can add to the same table.
  window.westoTable = {
    add: (item, qty) => (qty > 1 ? addItem(item, qty) : openQtyModal(item)),
    addDirect: (item, qty) => addItem(item, qty),
    open: () => openDrawer(),
    refresh: () => {
      cart = loadCart();
      updateBadge();
      renderCart();
    },
  };

  let addFlyBusy = false;
  let pendingFlyFromEl = null;

  function resolveDishFlySource(item) {
    const active =
      document.querySelector('section.is-benefits.is-dish-active:not([hidden])') ||
      document.querySelector('section.is-benefits:not([hidden])');
    const img = active?.querySelector?.('.dish-board-media img');
    if (img) {
      const r = img.getBoundingClientRect();
      if (r.width > 12 && r.height > 12) return img;
    }
    const src = String(item?.img || item?.image || '').trim();
    if (!src) return null;
    const ghost = document.createElement('img');
    ghost.src = readyManagedSrc(src);
    ghost.alt = '';
    ghost.decoding = 'async';
    return ghost;
  }

  function ensureTableHitRing(basket) {
    if (!basket) return null;
    let ring = basket.querySelector(':scope > .westo-table-hit-ring');
    if (!ring) {
      ring = document.createElement('span');
      ring.className = 'westo-table-hit-ring';
      ring.setAttribute('aria-hidden', 'true');
      basket.appendChild(ring);
    }
    return ring;
  }

  /**
   * Motion-style add-to-basket: dish photo arcs into #nav-table-btn (GSAP).
   * Clone flies — the real plate stays put.
   */
  function playFlyToTable(item, fromEl) {
    const gsap = window.gsap;
    const basket = document.getElementById('nav-table-btn');
    if (!basket || !gsap) return Promise.resolve();
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      return Promise.resolve();
    }
    if (addFlyBusy) return Promise.resolve();

    const source = fromEl || resolveDishFlySource(item);
    const srcUrl = String(
      source?.currentSrc || source?.src || item?.img || item?.image || '',
    ).trim();
    if (!srcUrl) return Promise.resolve();

    let fromRect = source?.getBoundingClientRect?.();
    if (!fromRect || fromRect.width < 8) {
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      fromRect = {
        left: vw * 0.5 - 80,
        top: vh * 0.38 - 80,
        width: 160,
        height: 160,
        right: vw * 0.5 + 80,
        bottom: vh * 0.38 + 80,
      };
    }
    const toRect = basket.getBoundingClientRect();
    if (!toRect.width) return Promise.resolve();

    addFlyBusy = true;

    const fly = document.createElement('div');
    fly.className = 'westo-add-fly';
    fly.setAttribute('aria-hidden', 'true');
    const img = document.createElement('img');
    img.src = readyManagedSrc(srcUrl);
    img.alt = '';
    img.draggable = false;
    fly.appendChild(img);
    document.body.appendChild(fly);

    const startW = Math.min(200, Math.max(72, fromRect.width));
    const startH = Math.min(200, Math.max(72, fromRect.height));
    const fromCx = fromRect.left + fromRect.width / 2;
    const fromCy = fromRect.top + fromRect.height / 2;
    const toCx = toRect.left + toRect.width / 2;
    const toCy = toRect.top + toRect.height / 2;
    const basketBox = Math.max(28, Math.min(toRect.width, toRect.height) * 0.72);
    const flyScale = basketBox / Math.max(startW, startH);

    gsap.set(fly, {
      position: 'fixed',
      left: fromCx,
      top: fromCy,
      width: startW,
      height: startH,
      xPercent: -50,
      yPercent: -50,
      x: 0,
      y: 0,
      scale: 1,
      opacity: 1,
      rotate: 0,
      transformOrigin: '50% 50%',
      zIndex: 12050,
    });

    const dx = toCx - fromCx;
    const dy = toCy - fromCy;
    const dist = Math.hypot(dx, dy) || 1;
    const strength = 0.5;
    const peak = 0.15;
    const bulge = dist * strength;
    const peakX = fromCx + dx * peak;
    const peakY = fromCy + dy * peak;
    // Prefer an upward arc into the navbar table button.
    let side = 1;
    const nX = dy / dist;
    const nY = -dx / dist;
    if (peakY + nY * bulge > Math.min(fromCy, toCy) - 8) side = -1;
    const c1x = peakX + nX * bulge * side;
    const c1y = peakY + nY * bulge * side;

    const proxy = { t: 0 };
    const duration = 0.48;
    const ease = 'power3.inOut';

    const ring = ensureTableHitRing(basket);
    if (ring) gsap.set(ring, { scale: 1, opacity: 0 });

    return new Promise((resolve) => {
      let prevX = fromCx;
      let prevY = fromCy;
      let velX = 0;
      let velY = 0;

      gsap.to(proxy, {
        t: 1,
        duration,
        ease,
        overwrite: true,
        onUpdate: () => {
          const t = proxy.t;
          const u = 1 - t;
          const x = u * u * fromCx + 2 * u * t * c1x + t * t * toCx;
          const y = u * u * fromCy + 2 * u * t * c1y + t * t * toCy;
          velX = (x - prevX) / (1 / 60);
          velY = (y - prevY) / (1 / 60);
          prevX = x;
          prevY = y;
          // Tangent rotate (Motion rotate≈0.9)
          const tx = 2 * u * (c1x - fromCx) + 2 * t * (toCx - c1x);
          const ty = 2 * u * (c1y - fromCy) + 2 * t * (toCy - c1y);
          const ang = (Math.atan2(ty, tx) * 180) / Math.PI;
          const scale = gsap.utils.interpolate(1, flyScale, t);
          const opacity = t < 0.92 ? 1 : gsap.utils.interpolate(1, 0, (t - 0.92) / 0.08);
          gsap.set(fly, {
            left: x,
            top: y,
            scale,
            opacity,
            rotate: ang * 0.9,
          });
        },
        onComplete: () => {
          fly.remove();
          const knock = 0.05;
          gsap.fromTo(
            basket,
            { x: velX * knock, y: velY * knock },
            {
              x: 0,
              y: 0,
              duration: 0.55,
              ease: 'elastic.out(1, 0.45)',
              overwrite: true,
            },
          );
          if (ring) {
            gsap.fromTo(
              ring,
              { scale: 1, opacity: 0.85 },
              {
                scale: 2.15,
                opacity: 0,
                duration: 0.5,
                ease: 'power2.out',
                overwrite: true,
              },
            );
          }
          try {
            window.westoSound?.play?.('click', { volume: 0.7 });
          } catch (_) {}
          addFlyBusy = false;
          resolve();
        },
      });
    });
  }

  function addItem(item, qty, opts = {}) {
    const q = Math.max(1, Math.min(99, Math.round(Number(qty) || 1)));
    const existing = cart.find((l) => l.menuItemId === item.id);
    if (existing) {
      existing.qty += q;
      if (!existing.img && (item.img || item.image)) existing.img = item.img || item.image || '';
      if (!existing.desc && (item.desc || item.description)) {
        existing.desc = item.desc || item.description || '';
      }
      if (
        (!Array.isArray(existing.allergens) || !existing.allergens.length) &&
        Array.isArray(item.allergens)
      ) {
        existing.allergens = item.allergens;
      }
      if (!existing.categoryId && item.categoryId != null) existing.categoryId = item.categoryId;
    } else
      cart.push({
        menuItemId: item.id,
        name: item.name,
        price: item.price,
        qty: q,
        en: item.en,
        ar: item.ar,
        img: item.img || item.image || '',
        desc: item.desc || item.description || '',
        descEn: item.descEn || item.descriptionEn || '',
        descAr: item.descAr || item.descriptionAr || '',
        allergens: Array.isArray(item.allergens) ? item.allergens : [],
        categoryId: item.categoryId ?? null,
      });
    saveCart(cart);
    const displayName = window.westoI18n?.itemName ? window.westoI18n.itemName(item) : item.name;
    toast((q > 1 ? `${q.toLocaleString(localeTag())}× ` : '') + displayName);
    if (!opts.skipFly) {
      playFlyToTable(item, opts.fromEl || pendingFlyFromEl || resolveDishFlySource(item));
    }
    pendingFlyFromEl = null;
  }

  function setQty(id, qty) {
    const line = cart.find((l) => l.menuItemId === id);
    if (!line) return;
    if (qty <= 0) cart = cart.filter((l) => l.menuItemId !== id);
    else line.qty = qty;
    saveCart(cart);
  }

  function lineDisplayName(l) {
    return window.westoI18n?.itemName
      ? window.westoI18n.itemName({ name: l.name, en: l.en, ar: l.ar })
      : l.name;
  }

  function findMenuItem(id) {
    const nid = Number(id);
    for (const list of Object.values(menuByCategory || {})) {
      const hit = (list || []).find((m) => Number(m.id) === nid);
      if (hit) return hit;
    }
    try {
      const store = window.westoMenuStore;
      const items = store?.data?.menuItems || store?.items || [];
      return (items || []).find((m) => Number(m.id) === nid) || null;
    } catch (_) {
      return null;
    }
  }

  function enrichCartLine(l) {
    const item = findMenuItem(l.menuItemId);
    const img = l.img || item?.img || item?.image || '';
    const desc =
      l.desc ||
      item?.desc ||
      item?.description ||
      '';
    const descEn = l.descEn || item?.descEn || item?.descriptionEn || '';
    const descAr = l.descAr || item?.descAr || item?.descriptionAr || '';
    const allergens = Array.isArray(l.allergens)
      ? l.allergens
      : Array.isArray(item?.allergens)
        ? item.allergens
        : [];
    const categoryId = l.categoryId ?? item?.categoryId ?? null;
    // Persist enrichments so offline redraws keep photos
    if (img && !l.img) l.img = img;
    if (desc && !l.desc) l.desc = desc;
    if (descEn && !l.descEn) l.descEn = descEn;
    if (descAr && !l.descAr) l.descAr = descAr;
    if (allergens.length && !Array.isArray(l.allergens)) l.allergens = allergens;
    if (categoryId != null && l.categoryId == null) l.categoryId = categoryId;
    return { ...l, img, desc, descEn, descAr, allergens, categoryId, item };
  }

  function lineDisplayDesc(l) {
    if (window.westoI18n?.itemDesc) {
      return (
        window.westoI18n.itemDesc({
          desc: l.desc,
          descEn: l.descEn,
          descAr: l.descAr,
        }) || ''
      );
    }
    const lang = window.westoI18n?.lang || document.documentElement.lang || 'fa';
    if (lang === 'en' && l.descEn) return l.descEn;
    if (lang === 'ar' && l.descAr) return l.descAr;
    return l.desc || '';
  }

  function categoryLabelForLine(l) {
    const id = l.categoryId;
    if (id == null) return '';
    try {
      if (typeof categoryLabelFor === 'function') return categoryLabelFor(id) || '';
    } catch (_) {}
    return '';
  }

  function renderCart() {
    if (!linesEl) return;
    let enriched = false;
    cart.forEach((l) => {
      const before = `${l.img || ''}|${l.desc || ''}|${l.categoryId ?? ''}`;
      enrichCartLine(l);
      const after = `${l.img || ''}|${l.desc || ''}|${l.categoryId ?? ''}`;
      if (before !== after) enriched = true;
    });
    if (enriched) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
      } catch (_) {}
    }
    const removeLabel = tr('cart.remove');
    const decLabel = tr('cart.dec');
    const incLabel = tr('cart.inc');
    linesEl.innerHTML = cart
      .map((raw) => {
        const l = enrichCartLine(raw);
        const name = lineDisplayName(l);
        const desc = lineDisplayDesc(l);
        const cat = categoryLabelForLine(l);
        const img = l.img || '';
        const unit = formatPrice(l.price);
        const lineTotal = formatPrice(l.price * l.qty);
        const qtyStr = l.qty.toLocaleString(localeTag());
        const allergenSummary = allergenIdsFor(l.item || l).length
          ? renderAllergenPanel(l.item || l, { compact: true })
          : '';
        const media = img
          ? `<img class="table-line__thumb" src="${escapeHtml(img)}" alt="" loading="lazy" decoding="async" />`
          : `<span class="table-line__thumb table-line__thumb--empty" aria-hidden="true"></span>`;
        return `
      <article class="table-line" data-id="${l.menuItemId}">
        <div class="table-line__media">${media}</div>
        <div class="table-line__body">
          <div class="table-line__top">
            <div class="table-line__titles">
              ${cat ? `<span class="table-line__cat">${escapeHtml(cat)}</span>` : ''}
              <h3 class="table-line__name">${escapeHtml(name)}</h3>
            </div>
            <button type="button" class="table-line__remove" data-rm="${l.menuItemId}" aria-label="${escapeHtml(removeLabel)}" title="${escapeHtml(removeLabel)}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2m-6 3v8m4-8v8M7 7l1 12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
          ${desc ? `<p class="table-line__desc">${escapeHtml(desc)}</p>` : ''}
          ${allergenSummary}
          <div class="table-line__foot">
            <div class="table-line__prices">
              <span class="table-line__unit">${escapeHtml(unit)} × ${qtyStr}</span>
              <strong class="table-line__price">${escapeHtml(lineTotal)}</strong>
            </div>
            <div class="table-line__qty" role="group" aria-label="${escapeHtml(tr('cart.qty'))}">
              <button type="button" data-dec="${l.menuItemId}" aria-label="${escapeHtml(decLabel)}">−</button>
              <span aria-live="polite">${qtyStr}</span>
              <button type="button" data-inc="${l.menuItemId}" aria-label="${escapeHtml(incLabel)}">+</button>
            </div>
          </div>
        </div>
      </article>`;
      })
      .join('');
    if (emptyEl) {
      emptyEl.hidden = cart.length > 0;
      const parts = String(tr('cart.empty')).split('\n');
      emptyEl.innerHTML = `${escapeHtml(parts[0] || '')}${
        parts[1] ? `<br/><span class="table-empty__hint">${escapeHtml(parts[1])}</span>` : ''
      }`;
    }
    if (totalEl) totalEl.textContent = formatPrice(cartTotal());
    if (checkoutBtn) checkoutBtn.disabled = cart.length === 0;
    paintTableChrome();
    const foot = $('.table-cart-foot');
    if (foot) foot.hidden = cart.length === 0;
    const countEl = $('#table-cart-count');
    if (countEl) {
      const n = cartCount();
      countEl.hidden = n === 0;
      countEl.textContent = n
        ? tr('cart.itemsCount', { n: n.toLocaleString(localeTag()) })
        : '';
    }

    linesEl.querySelectorAll('[data-inc]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = Number(b.dataset.inc);
        const line = cart.find((l) => l.menuItemId === id);
        if (line) setQty(id, line.qty + 1);
      }),
    );
    linesEl.querySelectorAll('[data-dec]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = Number(b.dataset.dec);
        const line = cart.find((l) => l.menuItemId === id);
        if (line) setQty(id, line.qty - 1);
      }),
    );
    linesEl.querySelectorAll('[data-rm]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = Number(b.dataset.rm);
        setQty(id, 0);
      }),
    );
  }

  function paintTableChrome() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      if (el.closest('#westo-entrance')) return;
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = tr(key);
    });
    const back = $('#westo-back-categories');
    if (back) {
      back.setAttribute('aria-label', tr('nav.categories'));
      const lab = back.querySelector('.westo-back-categories__label');
      if (lab) lab.textContent = tr('nav.categories');
    }
    const menuLabel = document.querySelector('.navbar_menu-button .text-block');
    if (menuLabel) menuLabel.textContent = tr('nav.menu');
    const auth = $('#nav-auth-btn div');
    if (auth) auth.textContent = tr('nav.login');
    const scrollHint = document.querySelector('.scroll_discover');
    if (scrollHint) {
      scrollHint.textContent = tr('hero.scroll');
      const spread = Math.max(28, (scrollHint.textContent || '').trim().length * 2);
      scrollHint.style.setProperty('--shimmer-spread', `${spread}px`);
    }
    const linkCats = document.querySelector('.navbar_link[href="#gamme"] .navbar_link-label');
    if (linkCats) linkCats.textContent = tr('nav.categories');
    const drawerTitle = $('.table-drawer__head h2');
    if (drawerTitle) drawerTitle.textContent = tr('cart.title');
    const drawerPanel = $('#table-drawer')?.querySelector('.table-drawer__panel');
    if (drawerPanel) drawerPanel.setAttribute('aria-label', tr('cart.title'));
    updateBadge();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let scrollLockDepth = 0;
  let bodyOverflowBeforeLock = '';
  function lockScroll() {
    if (scrollLockDepth === 0) {
      bodyOverflowBeforeLock = document.body.style.overflow || '';
      document.body.style.overflow = 'hidden';
      if (window.lenis && typeof window.lenis.stop === 'function') window.lenis.stop();
    }
    scrollLockDepth += 1;
  }
  function unlockScroll() {
    scrollLockDepth = Math.max(0, scrollLockDepth - 1);
    const qtyOpen = document.getElementById('qty-modal') && !document.getElementById('qty-modal').hidden;
    const drawerOpen = drawer && !drawer.hidden;
    if (qtyOpen || drawerOpen || scrollLockDepth > 0) return;
    document.body.style.overflow = bodyOverflowBeforeLock;
    bodyOverflowBeforeLock = '';
    if (window.lenis && typeof window.lenis.start === 'function') window.lenis.start();
  }

  function focusablesIn(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter((el) => !el.hidden && el.getClientRects().length);
  }
  function trapFocus(event, container) {
    if (event.key !== 'Tab' || !container) return false;
    const list = focusablesIn(container);
    if (!list.length) { event.preventDefault(); return true; }
    const first=list[0], last=list[list.length-1];
    if (event.shiftKey && document.activeElement===first) { event.preventDefault(); last.focus({preventScroll:true}); return true; }
    if (!event.shiftKey && document.activeElement===last) { event.preventDefault(); first.focus({preventScroll:true}); return true; }
    return false;
  }

  function syncDrawerViewport() {
    if (!drawer || drawer.hidden) return;
    const vv = window.visualViewport;
    if (!vv) {
      drawer.style.removeProperty('--vv-height');
      drawer.classList.remove('is-keyboard-open');
      return;
    }
    const full = window.innerHeight || 0;
    const keyboardOpen = vv.height < full - 80;
    drawer.classList.toggle('is-keyboard-open', keyboardOpen);
    if (keyboardOpen) {
      drawer.style.setProperty('--vv-height', `${Math.round(vv.height)}px`);
    } else {
      drawer.style.removeProperty('--vv-height');
    }
  }

  function bindDrawerViewport() {
    if (!drawer || bindDrawerViewport._done) return;
    bindDrawerViewport._done = true;
    const sync = () => syncDrawerViewport();
    window.visualViewport?.addEventListener('resize', sync, { passive: true });
    window.visualViewport?.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync, { passive: true });
    drawer.addEventListener('focusin', sync);
    drawer.addEventListener('focusout', () => setTimeout(sync, 80));
  }

  function syncQtyViewport() {
    if (!qtyModal || qtyModal.hidden) return;
    const vv = window.visualViewport;
    if (!vv) { qtyModal.style.removeProperty('--vv-height'); qtyModal.classList.remove('is-keyboard-open'); return; }
    const full = window.innerHeight || 0;
    const keyboardOpen = vv.height < full - 80;
    qtyModal.classList.toggle('is-keyboard-open', keyboardOpen);
    if (keyboardOpen) qtyModal.style.setProperty('--vv-height', `${Math.round(vv.height)}px`);
    else qtyModal.style.removeProperty('--vv-height');
  }
  function bindQtyViewport() {
    if (!qtyModal || bindQtyViewport._done) return;
    bindQtyViewport._done = true;
    const sync = () => syncQtyViewport();
    window.visualViewport?.addEventListener('resize', sync, { passive: true });
    window.visualViewport?.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync, { passive: true });
  }

  let drawerFocusBeforeOpen = null;

  function openDrawer() {
    if (!drawer) return;
    const wasHidden = drawer.hidden;
    if (wasHidden) drawerFocusBeforeOpen = document.activeElement;
    showView('cart');
    drawer.hidden = false;
    const panel = drawer.querySelector('.table-drawer__panel');
    if (panel) panel.setAttribute('aria-modal', 'true');
    if (wasHidden) lockScroll();
    bindDrawerViewport();
    syncDrawerViewport();
    if (wasHidden) {
      const closeBtn = drawer.querySelector('.table-drawer__close');
      if (closeBtn) closeBtn.focus({ preventScroll: true });
    }
  }
  function closeDrawer() {
    if (!drawer) return;
    drawer.hidden = true;
    drawer.querySelector('.table-drawer__panel')?.removeAttribute('aria-modal');
    drawer.classList.remove('is-keyboard-open');
    drawer.style.removeProperty('--vv-height');
    unlockScroll();
    const back = drawerFocusBeforeOpen;
    drawerFocusBeforeOpen = null;
    if (back?.isConnected && typeof back.focus === 'function') {
      try {
        back.focus({ preventScroll: true });
      } catch (_) {}
    }
  }
  function showView(name) {
    if (viewCart) viewCart.hidden = name !== 'cart';
    if (viewCheckout) viewCheckout.hidden = name !== 'checkout';
    if (viewDone) viewDone.hidden = name !== 'done';
    const head = drawer?.querySelector('.table-drawer__head h2');
    if (head) {
      head.textContent =
        name === 'checkout' ? tr('cart.paymentTitle') : name === 'done' ? tr('cart.doneTitle') : tr('cart.title');
    }
    if (name === 'checkout') {
      const first = $('#order-table');
      if (first) first.focus({ preventScroll: true });
    } else if (name === 'cart') {
      const foot = $('#table-checkout-btn');
      if (foot && !foot.disabled) foot.focus({ preventScroll: true });
    } else if (name === 'done') {
      const close = viewDone?.querySelector('[data-table-close]');
      if (close) close.focus({ preventScroll: true });
    }
  }

  // --- fill scroll boards from menu ---
  // Hero cans = categories; each benefits section = one dish of active category.
  // Live TopMenu categories can grow beyond the old 15-item snapshot (cold
  // bar currently has 25). Keep a corruption guard, not a product-data cap;
  // media beyond the eager budget stays deferred by the performance profile.
  const MAX_DISH_BOARDS = 250;
  let lastVisibleCount = -1;
  let lastFilledCategoryId = null;
  let boardsBuiltFor = null;
  let allDishBoardsCache = null;
  let dishLayoutRefreshRaf = 0;

  const allDishBoards = () => {
    if (!allDishBoardsCache || allDishBoardsCache.some((board) => !board.isConnected)) {
      allDishBoardsCache = $$('section.is-benefits');
    }
    return allDishBoardsCache;
  };

  function setBoardVisibility(sec, visible) {
    if (!sec) return;
    if (visible) {
      if (sec.hasAttribute('hidden')) sec.removeAttribute('hidden');
      if (sec.style.display === 'none') sec.style.display = '';
    } else {
      if (!sec.hasAttribute('hidden')) sec.setAttribute('hidden', '');
      if (sec.style.display !== 'none') sec.style.display = 'none';
    }
  }

  function setTextIfChanged(el, value) {
    if (!el) return;
    const next = value == null ? '' : String(value);
    if (el.textContent !== next) el.textContent = next;
  }

  function setAttrIfChanged(el, name, value) {
    if (!el) return;
    const next = value == null ? '' : String(value);
    if (el.getAttribute(name) !== next) el.setAttribute(name, next);
  }

  function setStyleIfChanged(el, name, value) {
    if (!el) return;
    const next = value == null ? '' : String(value);
    if (el.style[name] !== next) el.style[name] = next;
  }

  function scheduleDishLayoutRefresh() {
    if (dishLayoutRefreshRaf) return;
    dishLayoutRefreshRaf = requestAnimationFrame(() => {
      dishLayoutRefreshRaf = 0;
      dishBoardsCache = null;
      dishBoardMetrics = null;
      if (window.westoRelayout) window.westoRelayout();
      else if (window.ScrollTrigger) window.ScrollTrigger.refresh();
      if (window.westoRefreshBenefits) window.westoRefreshBenefits();
      // Measure once after all writes/ScrollTrigger work has committed. Scroll
      // ticks then use cached absolute geometry instead of N rect reads/frame.
      requestAnimationFrame(() => {
        refreshDishBoardsCache();
        scheduleDishViewportState();
      });
    });
  }

  function ensureDishBoards(count) {
    const n = Math.max(1, Math.min(MAX_DISH_BOARDS, count || 1));
    const main = document.querySelector('main.main-wrapper') || document.querySelector('main');
    const anchor = document.querySelector('.section.is-argument');
    if (!main || !anchor) return;

    // Promote legacy extra divs to sections
    const legacyExtras = $$('.is-benefits-extra');
    legacyExtras.forEach((el) => {
      if (el.tagName === 'DIV') {
        const sec = document.createElement('section');
        sec.className = 'section is-benefits';
        sec.id = el.id || '';
        if (el.dataset.menuSlot != null) sec.dataset.menuSlot = el.dataset.menuSlot;
        sec.innerHTML = el.innerHTML;
        el.replaceWith(sec);
      } else {
        el.classList.add('section', 'is-benefits');
        el.classList.remove('is-benefits-extra');
      }
    });
    if (legacyExtras.length) allDishBoardsCache = null;

    const boards = allDishBoards();
    const template = boards[0];
    if (!template) return;

    if (boards.length < n) {
      const fragment = document.createDocumentFragment();
      const start = boards.length;
      for (let i = start; i < n; i += 1) {
      const clone = template.cloneNode(true);
        clone.id = `benefits-${i + 1}`;
        clone.dataset.menuSlot = String(i);
      // strip w--current from cloned nav links
      clone.querySelectorAll('.w--current, .is-active').forEach((a) => {
        a.classList.remove('w--current', 'is-active');
      });
        fragment.appendChild(clone);
        boards.push(clone);
      }
      main.insertBefore(fragment, anchor);
    }

    boards.forEach((sec, i) => {
      const slot = String(i);
      const id = `benefits-${i + 1}`;
      if (sec.dataset.menuSlot !== slot) sec.dataset.menuSlot = slot;
      if (sec.id !== id) sec.id = id;
      setBoardVisibility(sec, i < n);
    });

    // Sync side nav icons on the shared dish rail
    const rail = hoistDishRail() || dishRailNav();
    if (rail) {
      const icons = $$('.benefits_icon-wrapper', rail);
      const iconTpl = icons[0];
      if (iconTpl) {
        if (icons.length < n) {
          const fragment = document.createDocumentFragment();
          const separatorTemplate = rail.querySelector('.benefits_icon-separator');
          for (let i = icons.length; i < n; i += 1) {
          const a = iconTpl.cloneNode(true);
          a.classList.remove('is-active', 'w--current');
            if (separatorTemplate) fragment.appendChild(separatorTemplate.cloneNode(true));
            fragment.appendChild(a);
            icons.push(a);
          }
          rail.appendChild(fragment);
        }
        icons.forEach((a, i) => {
          const href = `#benefits-${i + 1}`;
          if (a.getAttribute('href') !== href) a.setAttribute('href', href);
          const nextDisplay = i < n ? '' : 'none';
          if (a.style.display !== nextDisplay) a.style.display = nextDisplay;
          a.classList.toggle('is-active', i === 0);
          a.classList.toggle('w--current', i === 0);
          ensureRailAnimatedBorder(a);
        });
      }
    }

    if (boardsBuiltFor !== n) {
      boardsBuiltFor = n;
      scheduleDishLayoutRefresh();
    }
  }

  function reanchorDishScroll() {
    if (!window.lenis) return;
    const vis = dishBoardsCache?.length ? dishBoardsCache : refreshDishBoardsCache();
    if (!vis.length) return;
    const y = window.lenis.scroll;
    const firstTop = dishBoardMetrics?.[0]?.top ?? vis[0].offsetTop;
    if (y < firstTop - window.innerHeight * 0.3) return; // still in hero / profile

    const last = vis[vis.length - 1];
    const lastMetric = dishBoardMetrics?.[dishBoardMetrics.length - 1];
    const lastEnd = lastMetric ? lastMetric.top + lastMetric.height * 0.55 : last.offsetTop + last.offsetHeight * 0.55;
    const active = document.querySelector('section.is-benefits.is-dish-active');
    const activeBad = active && (active.hasAttribute('hidden') || active.style.display === 'none');

    if (y > lastEnd || activeBad) {
      let idx = vis.length - 1;
      if (active && !activeBad) {
        idx = Math.min(Number(active.dataset.menuSlot) || 0, vis.length - 1);
      } else if (activeBad) {
        idx = Math.min(Number(active.dataset.menuSlot) || 0, vis.length - 1);
      }
      window.lenis.scrollTo(vis[idx], { immediate: true, offset: 0 });
    }
  }

  function categoryLabelFor(categoryId) {
    const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
    const idx = order.indexOf(categoryId);
    const hero = document.querySelectorAll('.carousel_list.is-hero .carousel_slide')[idx];
    if (!hero) return '';
    const fa = hero.getAttribute('data-cat-fa');
    if (fa && window.westoI18n?.catTitleFromFa) return window.westoI18n.catTitleFromFa(fa);
    const title = hero.querySelector('.heading-style-h2')?.textContent;
    return title ? title.replace(/\s+/g, ' ').trim() : '';
  }

  function clearMediaInlineFx(media) {
    if (!media) return;
    const style = media.style;
    if (!style.opacity && !style.visibility && !style.transform) return;
    style.removeProperty('opacity');
    style.removeProperty('visibility');
    style.removeProperty('transform');
    // GSAP caches transform components. Mark the cache stale without invoking
    // gsap.set(), which was a large self-time/style-recalc source in the trace.
    try {
      const cache = window.gsap?.core?.getCache?.(media);
      if (cache) cache.uncache = 1;
    } catch (_) {}
  }

  function setBoardMedia(sec, imageSrc, options = {}) {
    if (!sec) return;
    const mediaHost = sec.querySelector('.benefits_container');
    let media = sec.querySelector('.dish-board-media');
    if (!imageSrc) {
      delete sec.dataset.boardImageSrc;
      delete sec.dataset.mediaDeferred;
      if (!media) return;
      media.classList.add('is-empty-media');
      media.hidden = true;
      media.setAttribute('hidden', '');
      const image = media.querySelector('img');
      if (image) {
        delete image.dataset.source;
        delete image.dataset.expectedSource;
        delete image.dataset.appliedSource;
        delete image.dataset.imageMode;
        delete image.dataset.decodeWarm;
        image.removeAttribute('src');
        image.classList.remove('is-image-frame', 'is-image-cutout');
      }
      return;
    }
    sec.dataset.boardImageSrc = imageSrc;
    if (options.defer) {
      sec.dataset.mediaDeferred = '1';
      const current = media?.querySelector('img');
      if (media) {
        media.hidden = true;
        media.setAttribute('hidden', '');
        media.classList.add('is-empty-media');
      }
      // Keep the existing decoded <img> parked while off-screen. Clearing and
      // recreating it on every category switch caused avoidable DOM/image churn;
      // the generation token will replace it safely when this slot becomes hot.
      if (current?.dataset.appliedSource === imageSrc || current?.dataset.expectedSource === imageSrc) return;
      return;
    }
    delete sec.dataset.mediaDeferred;
    if (!media && mediaHost) {
      media = document.createElement('figure');
      media.className = 'dish-board-media';
      media.setAttribute('aria-hidden', 'true');
      mediaHost.insertBefore(media, mediaHost.firstChild);
    }
    if (!media) return;
    // Stamp identity before paint so late async applies can reject mismatches.
    const catId = sec.dataset.categoryId || '';
    const itemId = sec.dataset.itemId || '';
    media.classList.remove('is-empty-media');
    media.hidden = false;
    media.removeAttribute('hidden');
    clearMediaInlineFx(media);
    let image = media.querySelector('img');
    if (!image) {
      image = document.createElement('img');
      image.decoding = 'async';
      image.alt = '';
      media.appendChild(image);
    }
    const stillMine = () =>
      (sec.dataset.categoryId || '') === catId && (sec.dataset.itemId || '') === itemId;
    const alreadyApplied = image.dataset.appliedSource === imageSrc && Boolean(image.getAttribute('src'));
    const alreadyPending = image.dataset.expectedSource === imageSrc && image.dataset.appliedSource !== imageSrc;
    if (!alreadyApplied && !alreadyPending) {
      image.dataset.expectedSource = imageSrc;
      image.dataset.imageMode = 'cutout';
      image.classList.remove('is-image-frame');
      image.classList.add('is-image-cutout');
      const slot = Math.max(0, Number(sec.dataset.menuSlot) || 0);
      const priority = slot === activeViewportSlot
        ? resourcePriority('CURRENT', 115)
        : slot === activeViewportSlot + 1
          ? resourcePriority('NEXT', 108)
          : resourcePriority('VISIBLE', 92);
      void bindManagedImage(image, imageSrc, {
        priority,
        group: `cat:${catId || lastFilledCategoryId || 'unknown'}:board`,
        loading: slot <= activeViewportSlot + 1 ? 'eager' : 'lazy',
        decode: true,
        progressive: true,
      }).then((ok) => {
        // Aborts/preemption are allowed, but they must not leave an eternal
        // "pending" stamp that prevents the active media healer from retrying.
        if (!ok && stillMine() && image.dataset.appliedSource !== imageSrc && image.dataset.expectedSource === imageSrc) {
          delete image.dataset.expectedSource;
        }
      }).catch(() => {
        if (stillMine() && image.dataset.appliedSource !== imageSrc && image.dataset.expectedSource === imageSrc) {
          delete image.dataset.expectedSource;
        }
      });
    }
    if (!image.dataset.decodeWarm) {
      image.dataset.decodeWarm = '1';
      image.addEventListener('load', () => {
        if (!stillMine()) return;
        // warmDishImage owns decode scheduling. Do not decode here and then
        // create a second off-DOM probe for the same resource.
        warmDishImage(sec);
      });
    }
  }

  function killDishSwitchTl() {
    if (!dishSwitchTl) return;
    dishSwitchTl.kill();
    dishSwitchTl = null;
    document
      .querySelectorAll('section.is-benefits.is-dish-leaving, section.is-benefits.is-dish-switching, section.is-benefits.is-dish-prewarm')
      .forEach(clearDishFx);
  }

  /** If stamp/src was lost but the board still has an item, repaint the plate. */
  function healActiveBoardMedia(sec, { force = false } = {}) {
    // During photo-fly, orbs own food pixels — never flash dish media underneath.
    if (
      !force &&
      document.documentElement.classList.contains('is-cat-flying')
    ) {
      return;
    }
    if (!sec || sec.dataset.emptyCat === '1') return;
    const itemId = sec.dataset.itemId;
    const catId = sec.dataset.categoryId;
    if (!itemId || catId == null || catId === '') return;
    const items = menuByCategory[catId] || menuByCategory[Number(catId)] || [];
    const item = items.find((m) => String(m.id) === String(itemId)) || items[Number(sec.dataset.menuSlot)];
    const src = item?.img || item?.image || '';
    if (!src) return;
    const media = sec.querySelector('.dish-board-media');
    const img = media?.querySelector('img');
    const missing =
      !media ||
      media.hidden ||
      media.classList.contains('is-empty-media') ||
      !img ||
      (!img.getAttribute('src') && !img.dataset.appliedSource);
    const mismatched = Boolean(img) && img.dataset.appliedSource !== src;
    const pendingCorrectSource = Boolean(img) && img.dataset.expectedSource === src && img.dataset.appliedSource !== src;
    if (missing || (mismatched && !pendingCorrectSource)) setBoardMedia(sec, src);
    else if (!pendingCorrectSource) clearMediaInlineFx(media);
  }

  function fillBoards(categoryId) {
    if (!document.querySelector('section.is-benefits')) return;
    if (window.westoCategoryTheme?.apply && categoryId != null) {
      window.westoCategoryTheme.apply(categoryId);
    }
    try {
      window.dispatchEvent(
        new CustomEvent('westo:category-focus', { detail: { categoryId: Number(categoryId) } }),
      );
    } catch (_) {}
    const items = menuByCategory[categoryId] || [];
    const emptyCat = !items.length;
    ensureDishBoards(emptyCat ? 1 : items.length || 1);
    const catName = categoryLabelFor(categoryId);
    const emptyLabel =
      (window.westoI18n?.t && window.westoI18n.t('dish.empty')) ||
      tr('dish.empty') ||
      'هنوز غذایی نیست';

    const categoryChanged = categoryId != null && categoryId !== lastFilledCategoryId;
    if (categoryChanged && Number(resourceScheduler()?.currentCategory) !== Number(categoryId)) {
      resourceScheduler()?.focusCategory?.(categoryId, { reason: 'fill-boards', slot: 0 });
    }
    if (categoryChanged) {
      const onDishesNow = document.documentElement.classList.contains('is-dish-boards');
      // Cancel at most one active switch timeline. The old path then cleared
      // every board a second time with gsap.set(), even though most boards had
      // no inline FX. Keep existing decoded media until each slot is reassigned.
      if (dishSwitchTl) killDishSwitchTl();
      else {
        document
          .querySelectorAll('section.is-benefits.is-dish-leaving, section.is-benefits.is-dish-switching, section.is-benefits.is-dish-prewarm')
          .forEach(clearDishFx);
      }
      if (onDishesNow) {
        activeViewportSlot = 0;
        syncDishRailActive(0);
      }
    }

    let visible = 0;
    allDishBoards().forEach((sec) => {
      const slot = Number(sec.dataset.menuSlot);
      const item = emptyCat && slot === 0 ? null : items[slot];
      const nameEl = sec.querySelector('[data-menu-name]');
      const descEl = sec.querySelector('[data-menu-desc]');
      const priceEl = sec.querySelector('[data-menu-price]');
      const addBtn = sec.querySelector('[data-menu-add]');

      if (emptyCat && slot === 0) {
        setBoardVisibility(sec, true);
        sec.dataset.emptyCat = '1';
        sec.dataset.categoryId = String(categoryId ?? '');
        delete sec.dataset.itemId;
        visible += 1;
        setTextIfChanged(nameEl, emptyLabel);
        setTextIfChanged(descEl, catName || '');
        setTextIfChanged(priceEl, '');
        if (addBtn) {
          ensureGlassButtonChrome(addBtn.closest('.glass-button-wrap') || addBtn);
          addBtn.disabled = true;
          delete addBtn.dataset.itemId;
          setGlassButtonLabel(addBtn, emptyLabel);
        }
        setBoardMedia(sec, null);
        paintBoardAllergens(sec, null);
        let catEl = sec.querySelector('[data-menu-category]');
        if (!catEl) {
          const host = sec.querySelector('.subhead_wrapper') || sec.querySelector('.benefits_text');
          if (host) {
            catEl = document.createElement('div');
            catEl.className = 'menu-cat-label';
            catEl.setAttribute('data-menu-category', '');
            host.parentNode.insertBefore(catEl, host);
          }
        }
        setTextIfChanged(catEl, catName);
        hoistDishRail();
        const nav = dishRailNav();
        if (nav) {
          nav.setAttribute('aria-label', catName ? `${tr('cart.dishesOf')} ${catName}` : tr('cart.dishesHere'));
          $$('.benefits_icon-wrapper', nav).forEach((a) => {
            a.style.display = 'none';
          });
          $$('.benefits_icon-separator', nav).forEach((sep) => {
            sep.style.display = 'none';
          });
        }
        return;
      }

      if (!item || slot >= MAX_DISH_BOARDS) {
        setBoardVisibility(sec, false);
        delete sec.dataset.emptyCat;
        delete sec.dataset.categoryId;
        delete sec.dataset.itemId;
        setBoardMedia(sec, null);
        paintBoardAllergens(sec, null);
        return;
      }

      setBoardVisibility(sec, true);
      delete sec.dataset.emptyCat;
      sec.dataset.categoryId = String(categoryId ?? '');
      sec.dataset.itemId = String(item.id);
      visible += 1;
      const displayName = window.westoI18n?.itemName ? window.westoI18n.itemName(item) : item.name || '';
      const displayDesc = window.westoI18n?.itemDesc ? window.westoI18n.itemDesc(item) : item.desc || '';
      // Replace SplitText wrappers only when copy actually changed.
      setTextIfChanged(nameEl, displayName);
      setTextIfChanged(descEl, displayDesc);
      paintBoardAllergens(sec, item);
      setTextIfChanged(priceEl, formatPrice(item.price));
      if (addBtn) {
        ensureGlassButtonChrome(addBtn.closest('.glass-button-wrap') || addBtn);
        addBtn.disabled = false;
        addBtn.dataset.itemId = String(item.id);
        const addLabel = tr('cart.add');
        setGlassButtonLabel(addBtn, addLabel);
        setAttrIfChanged(
          addBtn,
          'aria-label',
          `${addLabel} ${window.westoI18n?.itemName ? window.westoI18n.itemName(item) : item.name || ''}`.trim(),
        );
      }

      const imageSrc = item.img || item.image || '';
      const eagerBoards = Math.max(1, Number(perfQuality().eagerBoards) || 3);
      setBoardMedia(sec, imageSrc || null, { defer: slot >= eagerBoards });

      let catEl = sec.querySelector('[data-menu-category]');
      if (!catEl) {
        const host = sec.querySelector('.subhead_wrapper') || sec.querySelector('.benefits_text');
        if (host) {
          catEl = document.createElement('div');
          catEl.className = 'menu-cat-label';
          catEl.setAttribute('data-menu-category', '');
          host.parentNode.insertBefore(catEl, host);
        }
      }
      setTextIfChanged(catEl, catName);

      // Shared dish rail (may be hoisted to body)
      if (slot === 0) {
        hoistDishRail();
        const nav = dishRailNav();
        if (!nav) return;
        setAttrIfChanged(
          nav,
          'aria-label',
          catName ? `${tr('cart.dishesOf')} ${catName}` : tr('cart.dishesHere'),
        );
        const icons = $$('.benefits_icon-wrapper', nav);
        const n = Math.min(items.length, MAX_DISH_BOARDS);
        items.slice(0, MAX_DISH_BOARDS).forEach((dish, i) => {
          const a = icons[i];
          if (!a) return;
          setAttrIfChanged(a, 'href', `#benefits-${i + 1}`);
          const dishLabel = window.westoI18n?.itemName ? window.westoI18n.itemName(dish) : dish.name || '';
          if (a.title !== dishLabel) a.title = dishLabel;
          setAttrIfChanged(a, 'aria-label', dishLabel || `Dish ${i + 1}`);
          setStyleIfChanged(a, 'display', '');
          ensureRailAnimatedBorder(a);
          let img = a.querySelector('img.benefits_dish-thumb');
          const srcImg = dish.img || dish.image || '';
          if (srcImg) {
            if (!img) {
              img = document.createElement('img');
              img.className = 'benefits_dish-thumb';
              img.alt = '';
              img.decoding = 'async';
              img.loading = 'lazy';
              const iconBox = a.querySelector('.benefits_icon') || a;
              iconBox.innerHTML = '';
              iconBox.appendChild(img);
            }
            if (img.dataset.appliedSource !== srcImg) {
              img.dataset.expectedSource = srcImg;
              img.dataset.imageMode = 'cutout';
              img.classList.remove('is-image-frame');
              img.classList.add('is-image-cutout');
              // Rail thumbnails are never allowed to block the active board.
              // Request only when near the rail viewport; the shared scheduler
              // dedupes against the board image if it is already in flight/ready.
              observeManagedImage(img, srcImg, {
                root: nav,
                rootMargin: '240px',
                priority: i <= activeViewportSlot + 2
                  ? resourcePriority('NEAR', 76)
                  : resourcePriority('PREDICT', 54),
                group: `cat:${categoryId}:rail`,
                loading: 'lazy',
                decode: true,
              });
            }
          } else if (img) {
            delete img.dataset.source;
            img.removeAttribute('src');
          }
          // Keep the rail scannable; the card and accessible name retain the full name.
          let label = a.querySelector('.benefits_rail-label');
          if (!label) {
            label = document.createElement('span');
            label.className = 'benefits_rail-label';
            a.appendChild(label);
          }
          const words = String(dishLabel || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean);
          setTextIfChanged(label, words.slice(0, 2).join(' '));
        });
        icons.forEach((a, i) => {
          setStyleIfChanged(a, 'display', i < n ? '' : 'none');
        });
        $$('.benefits_icon-separator', nav).forEach((sep, i) => {
          setStyleIfChanged(sep, 'display', i < n - 1 ? '' : 'none');
        });
        // Single-dish categories don't need a thumb rail
        nav.classList.toggle('is-rail-solo', n <= 1);
        setStyleIfChanged(nav, 'opacity', n <= 1 ? '0' : '');
        setStyleIfChanged(nav, 'visibility', n <= 1 ? 'hidden' : '');
        setStyleIfChanged(nav, 'pointerEvents', n <= 1 ? 'none' : '');
      }
    });

    if (typeof window.westoBoot?.markBoards === 'function') {
      window.westoBoot.markBoards(visible > 0 ? 1 : 0.4);
    }

    if (visible !== lastVisibleCount) {
      lastVisibleCount = visible;
      scheduleDishLayoutRefresh();
    }

    const rail = dishRailNav();
    lastFilledCategoryId = categoryId;
    if (rail && categoryChanged) {
      rail.scrollTop = 0;
    }

    const onDishes = document.documentElement.classList.contains('is-dish-boards');
    if (onDishes && categoryChanged) {
      // New category while reading dishes → start at first dish (clearer than clamping a deep slot)
      const first = document.querySelector(
        'section.is-benefits[data-menu-slot="0"]:not([hidden])',
      );
      if (first && window.lenis) {
        window.lenis.scrollTo(first, { immediate: true, offset: 0 });
      } else if (first) {
        window.scrollTo(0, first.offsetTop);
      }
    } else {
      reanchorDishScroll();
    }

    // Keep the fixed shared card in sync with whatever board is (or will be) active.
    ensureSharedDishCard();
    const live =
      document.querySelector('section.is-benefits.is-dish-active:not([hidden])') ||
      document.querySelector('section.is-benefits[data-menu-slot="0"]:not([hidden])');
    if (live) syncSharedDishCard(live, { animate: false });
    syncDishCatBar();
  }

  function dishRailNav() {
    return (
      document.querySelector('.benefits_nav.is-menu-rail') ||
      document.querySelector('section.is-benefits[data-menu-slot="0"] .benefits_nav') ||
      document.querySelector('.benefits_nav')
    );
  }

  function hoistDishRail() {
    const nav = dishRailNav();
    if (!nav) return null;
    if (!nav.classList.contains('is-menu-rail')) {
      nav.classList.add('is-menu-rail');
      document.body.appendChild(nav);
    }
    prepareDishRailScroll(nav);
    return nav;
  }

  function prepareDishRailScroll(nav) {
    if (!nav) return;
    // Same contract as catbar: Lenis must not steal vertical pan/wheel.
    nav.setAttribute('data-lenis-prevent', '');
    nav.setAttribute('data-lenis-prevent-touch', '');
    nav.setAttribute('data-lenis-prevent-wheel', '');
    nav.setAttribute('data-lenis-prevent-vertical', '');
    if (nav.style.touchAction !== 'pan-y') nav.style.touchAction = 'pan-y';

    const armRailBrowse = () => {
      window.__westoRailBrowsing = true;
      window.clearTimeout(window.__westoRailBrowseTimer);
      const pinned = window.lenis?.scroll ?? window.scrollY ?? 0;
      window.__westoRailPinnedScroll = pinned;
      window.lenis?.stop?.();
    };
    const releaseRailBrowse = () => {
      window.clearTimeout(window.__westoRailBrowseTimer);
      window.__westoRailBrowseTimer = window.setTimeout(() => {
        window.__westoRailBrowsing = false;
        window.__westoRailPinnedScroll = null;
        if (document.documentElement.classList.contains('is-dish-boards')) {
          window.lenis?.start?.();
        }
      }, 100);
    };

    if (nav.dataset.westoRailScrollBound) return;
    nav.dataset.westoRailScrollBound = '1';

    nav.addEventListener(
      'touchstart',
      () => {
        armRailBrowse();
      },
      { passive: true, capture: true },
    );
    nav.addEventListener(
      'touchmove',
      (e) => {
        armRailBrowse();
        // Keep page scroll frozen while the rail is being scrubbed.
        e.stopPropagation();
        const pinned = window.__westoRailPinnedScroll;
        if (pinned != null && window.lenis && Math.abs((window.lenis.scroll || 0) - pinned) > 0.5) {
          window.lenis.scrollTo(pinned, { immediate: true });
        }
      },
      { passive: true, capture: true },
    );
    nav.addEventListener('touchend', releaseRailBrowse, { passive: true, capture: true });
    nav.addEventListener('touchcancel', releaseRailBrowse, { passive: true, capture: true });

    nav.addEventListener(
      'wheel',
      (e) => {
        const ax = Math.abs(e.deltaX);
        const ay = Math.abs(e.deltaY);
        if (ay < 0.35 && ax < 0.35) return;
        // Always claim vertical wheel over the rail — never advance page dishes,
        // even when the rail is already at its scroll edge.
        if (ay >= ax * 0.75) {
          armRailBrowse();
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          if (nav.scrollHeight > nav.clientHeight + 2) {
            const max = nav.scrollHeight - nav.clientHeight;
            nav.scrollTop = Math.max(0, Math.min(max, nav.scrollTop + e.deltaY));
          }
          releaseRailBrowse();
        }
      },
      { passive: false },
    );
  }

  function ensureRailAnimatedBorder(anchor) {
    if (!anchor) return;
    const icon = anchor.querySelector('.benefits_icon') || anchor;
    // v13.4: dish thumbnails deliberately have no cyan/liquid contour. Remove
    // legacy/static hosts too so a cached shader module cannot resurrect it.
    icon.querySelectorAll(':scope > .benefits_rail-border, :scope > .benefits_rail-border--liquid')
      .forEach((node) => node.remove());
    delete icon.dataset.westoRailHost;
    icon.classList.remove('is-liquid-active');
  }

  function syncLiquidRailBorder() {
    // Keep compatibility with a module that may already exist in a long-lived
    // tab, but only clear it. Active identity is owned by the rail card surface.
    try { window.WestoLiquidRail?.clear?.(); } catch (_) {}
  }

  // ---- Dish switch: one fixed card + light plate crossfade -----------------
  // The glass card is a single body-level host so it never resizes or swaps.
  // Only its inner copy changes. Plates do a short opacity fade (no rotate /
  // scale / glow) so the compositor stays cheap.
  let dishSwitchTl = null;
  const dishReducedMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  // Silent dish warm. Keep ownership on the real <img>; creating an extra
  // Image() probe duplicated request/decode work in the performance trace.
  // Only the current dish and its immediate successor are eligible to warm.
  const prewarmWarmed = new Set();
  let prewarmDishBoardsKey = '';

  function warmDishImage(sec) {
    if (!sec || sec.dataset.emptyCat === '1' || sec.hasAttribute('hidden')) return;
    const img = sec.querySelector('.dish-board-media img');
    if (!img) return;
    const src = String(img.currentSrc || img.getAttribute('src') || img.dataset?.source || '').trim();
    if (!src || prewarmWarmed.has(src)) return;
    prewarmWarmed.add(src);
    // Decode only the actual board image. Browser image-cache ownership stays
    // with this element, so there is no duplicate off-DOM fetch/probe.
    if (typeof img.decode === 'function') {
      img.decode().catch(() => {
        // A source change can invalidate an in-flight decode; allow retry.
        prewarmWarmed.delete(src);
      });
    }
  }

  function prewarmDishBoards() {
    const categoryKey = String(lastFilledCategoryId ?? activeCategoryId() ?? '');
    const active =
      document.querySelector('section.is-benefits.is-dish-active:not([hidden])') ||
      document.querySelector('section.is-benefits:not([hidden])');
    if (!active) return;

    const activeSlot = Math.max(0, Number(active.dataset.menuSlot) || 0);
    resourceScheduler()?.focusDish?.(Number(categoryKey), activeSlot, 'dish-viewport');
    const key = `${categoryKey}|${activeSlot}`;
    if (key === prewarmDishBoardsKey) return;

    const boards = $$('section.is-benefits').filter(
      (sec) => !sec.hasAttribute('hidden') && sec.dataset.emptyCat !== '1',
    );
    if (!boards.length) return;

    const current =
      boards.find((sec) => Number(sec.dataset.menuSlot) === activeSlot) || active;
    const next = boards.find((sec) => Number(sec.dataset.menuSlot) === activeSlot + 1) || null;

    warmDishImage(current);
    if (next && next !== current) warmDishImage(next);
    prewarmDishBoardsKey = key;
  }

  function ensureGlassButtonChrome(wrapOrBtn) {
    const wrap =
      wrapOrBtn?.classList?.contains('glass-button-wrap')
        ? wrapOrBtn
        : wrapOrBtn?.closest?.('.glass-button-wrap');
    if (!wrap) return null;
    const cached = wrap.__westoGlassChrome;
    if (cached?.btn?.isConnected && cached?.label?.isConnected) return cached;
    const btn = wrap.querySelector('.glass-button') || wrap.querySelector('button');
    if (!btn) return null;
    let text = btn.querySelector('.glass-button-text');
    if (!text) {
      text = document.createElement('span');
      text.className = 'glass-button-text';
      while (btn.firstChild) text.appendChild(btn.firstChild);
      btn.appendChild(text);
    }
    if (!text.querySelector('.glass-button-label')) {
      const label = document.createElement('span');
      label.className = 'glass-button-label';
      // Move existing text nodes / leftover copy into the label slot.
      const leftovers = [...text.childNodes].filter(
        (n) => !(n.nodeType === 1 && n.classList?.contains('glass-button-icon')),
      );
      leftovers.forEach((n) => label.appendChild(n));
      if (!label.textContent.trim()) label.textContent = 'افزودن';
      text.appendChild(label);
    }
    if (!text.querySelector('.glass-button-icon')) {
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('class', 'glass-button-icon');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', 'currentColor');
      icon.setAttribute('stroke-width', '2.25');
      icon.setAttribute('stroke-linecap', 'round');
      icon.setAttribute('stroke-linejoin', 'round');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = '<path d="M12 5v14"/><path d="M5 12h14"/>';
      text.appendChild(icon);
    }
    if (wrap.classList.contains('menu-add-wrap')) {
      wrap.querySelectorAll('.glass-button-shadow').forEach((el) => el.remove());
    } else if (!wrap.querySelector('.glass-button-shadow')) {
      const shadow = document.createElement('div');
      shadow.className = 'glass-button-shadow';
      shadow.setAttribute('aria-hidden', 'true');
      wrap.appendChild(shadow);
    }
    const chrome = { wrap, btn, text, label: text.querySelector('.glass-button-label') };
    wrap.__westoGlassChrome = chrome;
    return chrome;
  }

  function setGlassButtonLabel(btn, labelText) {
    const chrome = ensureGlassButtonChrome(btn);
    if (!chrome) return;
    const next = labelText || '';
    if (chrome.label.textContent !== next) chrome.label.textContent = next;
  }

  function loadDishFavorites() {
    try {
      const value = JSON.parse(localStorage.getItem(DISH_FAVORITES_KEY) || '[]');
      return new Set(Array.isArray(value) ? value.map(String) : []);
    } catch (_) {
      return new Set();
    }
  }

  const dishFavorites = loadDishFavorites();

  function saveDishFavorites() {
    try {
      localStorage.setItem(DISH_FAVORITES_KEY, JSON.stringify([...dishFavorites]));
    } catch (_) {}
  }

  function favoriteCopy(itemName, isFavorite) {
    const lang = activeLang();
    const name = String(itemName || '').trim();
    if (lang === 'en') return `${isFavorite ? 'Remove' : 'Add'} ${name || 'dish'} ${isFavorite ? 'from' : 'to'} favorites`;
    if (lang === 'ar') return `${isFavorite ? 'إزالة' : 'إضافة'} ${name || 'الطبق'} ${isFavorite ? 'من' : 'إلى'} المفضلة`;
    return `${isFavorite ? 'حذف' : 'افزودن'} ${name || 'غذا'} ${isFavorite ? 'از' : 'به'} علاقه‌مندی‌ها`;
  }

  function ensureDishCardPremiumChrome(card) {
    if (!card) return null;
    const title = card.querySelector('[data-menu-name]');
    const titleWrap = title?.closest('.margin-bottom') || title?.parentElement;
    let favorite = card.querySelector('[data-dish-favorite]');
    if (title && titleWrap && !favorite) {
      favorite = document.createElement('button');
      favorite.type = 'button';
      favorite.className = 'dish-favorite-button';
      favorite.dataset.dishFavorite = '';
      favorite.setAttribute('aria-pressed', 'false');
      favorite.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"/></svg>';
      titleWrap.insertBefore(favorite, title);
    }

    const price = card.querySelector('[data-menu-price]');
    const priceWrap = price?.closest('.subhead_text') || price?.parentElement;
    if (price && priceWrap && !priceWrap.querySelector('.dish-price-tag')) {
      const tag = document.createElement('span');
      tag.className = 'dish-price-tag';
      tag.setAttribute('aria-hidden', 'true');
      tag.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M20.59 13.41 11 3.83V3H4v7h.83l9.58 9.59a2 2 0 0 0 2.82 0l3.36-3.36a2 2 0 0 0 0-2.82Z"/><circle cx="7.5" cy="6.5" r="1"/></svg>';
      priceWrap.insertBefore(tag, price);
    }
    card.dataset.dishCardPremium = 'true';
    return card;
  }

  function syncDishFavoriteButton(card, itemId, itemName) {
    const favorite = ensureDishCardPremiumChrome(card)?.querySelector('[data-dish-favorite]');
    if (!favorite) return;
    const key = itemId == null ? '' : String(itemId);
    const isFavorite = Boolean(key) && dishFavorites.has(key);
    favorite.dataset.itemId = key;
    favorite.dataset.itemName = itemName || '';
    favorite.classList.toggle('is-favorite', isFavorite);
    favorite.setAttribute('aria-pressed', String(isFavorite));
    favorite.setAttribute('aria-label', favoriteCopy(itemName, isFavorite));
    favorite.disabled = !key;
  }

  function toggleDishFavorite(button) {
    const key = String(button?.dataset.itemId || '');
    if (!key) return;
    if (dishFavorites.has(key)) dishFavorites.delete(key);
    else dishFavorites.add(key);
    saveDishFavorites();
    syncDishFavoriteButton(button.closest('#westo-dish-card'), key, button.dataset.itemName);
  }

  function ensureSharedDishCard() {
    let card = document.getElementById('westo-dish-card');
    if (card) return ensureDishCardPremiumChrome(card);
    const source = document.querySelector('section.is-benefits .benefits_text');
    if (!source) return null;
    card = source.cloneNode(true);
    card.id = 'westo-dish-card';
    card.classList.add('is-shared-dish-card');
    card.removeAttribute('style');
    card.querySelectorAll('[data-anim]').forEach((el) => el.removeAttribute('data-anim'));
    const addWrap = card.querySelector('.glass-button-wrap.menu-add-wrap, .menu-add-wrap');
    if (addWrap) ensureGlassButtonChrome(addWrap);
    document.body.appendChild(card);
    return ensureDishCardPremiumChrome(card);
  }

  function syncSharedDishAllergens(card, fromSec) {
    if (!card || !fromSec) return;
    const fromSlot = fromSec.querySelector('.menu-allergen-slot');
    let toSlot = card.querySelector('.menu-allergen-slot');
    if (!fromSlot) {
      toSlot?.remove();
      return;
    }
    if (!toSlot) {
      toSlot = document.createElement('div');
      toSlot.className = 'menu-allergen-slot';
      const addButton = card.querySelector('[data-menu-add]');
      const action =
        addButton?.closest('.max-width-xsmall') || addButton?.closest('.menu-add-wrap');
      if (action?.parentNode) action.parentNode.insertBefore(toSlot, action);
    }
    if (toSlot) toSlot.innerHTML = fromSlot.innerHTML;
  }

  function applySharedDishCardFrom(fromSec) {
    const card = ensureSharedDishCard();
    if (!card || !fromSec) return null;
    const copyText = (sel) => {
      const from = fromSec.querySelector(sel);
      const to = card.querySelector(sel);
      if (from && to) to.textContent = from.textContent;
    };
    copyText('[data-menu-category]');
    copyText('[data-menu-price]');
    copyText('[data-menu-name]');
    copyText('[data-menu-desc]');
    syncSharedDishAllergens(card, fromSec);
    const itemId = fromSec.dataset.itemId || fromSec.querySelector('[data-menu-add]')?.dataset.itemId;
    const itemName = card.querySelector('[data-menu-name]')?.textContent || '';
    syncDishFavoriteButton(card, itemId, itemName);
    const fromBtn = fromSec.querySelector('[data-menu-add]');
    const toBtn = card.querySelector('[data-menu-add]');
    if (fromBtn && toBtn) {
      ensureGlassButtonChrome(toBtn);
      toBtn.disabled = fromBtn.disabled;
      if (fromBtn.dataset.itemId) toBtn.dataset.itemId = fromBtn.dataset.itemId;
      else delete toBtn.dataset.itemId;
      const fromLabel =
        fromBtn.querySelector('.glass-button-label') ||
        fromBtn.querySelector('.glass-button-text') ||
        fromBtn;
      setGlassButtonLabel(toBtn, fromLabel.textContent);
      const aria = fromBtn.getAttribute('aria-label');
      if (aria) toBtn.setAttribute('aria-label', aria);
      else toBtn.removeAttribute('aria-label');
    }
    return card;
  }

  function syncSharedDishCard(fromSec, { animate } = {}) {
    const card = ensureSharedDishCard();
    if (!card || !fromSec) return;
    const body = card.querySelector('.benefits_max-width') || card;
    if (!animate || !window.gsap || (dishReducedMotion && dishReducedMotion.matches)) {
      applySharedDishCardFrom(fromSec);
      body.style.opacity = '1';
      body.style.removeProperty('transform');
      try {
        const cache = window.gsap?.core?.getCache?.(body);
        if (cache) cache.uncache = 1;
      } catch (_) {}
      return;
    }
    const gsap = window.gsap;
    gsap.killTweensOf(body);
    gsap.to(body, {
      opacity: 0,
      duration: 0.1,
      ease: 'power1.in',
      overwrite: true,
      onComplete: () => {
        applySharedDishCardFrom(fromSec);
        gsap.to(body, { opacity: 1, duration: 0.16, ease: 'power1.out', overwrite: true });
      },
    });
  }

  function clearDishFx(sec) {
    if (!sec) return;
    sec.classList.remove('is-dish-leaving');
    sec.classList.remove('is-dish-switching');
    sec.classList.remove('is-dish-prewarm');
    const media = sec.querySelector('.dish-board-media');
    clearMediaInlineFx(media);
  }

  function playDishSwitch(fromSec, toSec) {
    if (!toSec) return;
    const gsap = window.gsap;

    killDishSwitchTl();

    document.querySelectorAll('section.is-benefits.is-dish-leaving').forEach((s) => {
      if (s !== toSec) clearDishFx(s);
    });

    const hasFrom = Boolean(fromSec) && fromSec !== toSec;
    syncSharedDishCard(toSec, { animate: hasFrom });

    const inMedia = toSec.querySelector('.dish-board-media');
    if (!gsap) {
      if (hasFrom) clearDishFx(fromSec);
      return;
    }

    const reduced = Boolean(dishReducedMotion && dishReducedMotion.matches);
    if (reduced) {
      if (hasFrom) clearDishFx(fromSec);
      if (inMedia) {
        clearMediaInlineFx(inMedia);
        inMedia.style.opacity = '1';
        inMedia.style.visibility = 'visible';
      }
      return;
    }

    toSec.classList.add('is-dish-switching');
    const restoreVisible = () => {
      if (hasFrom) clearDishFx(fromSec);
      toSec.classList.remove('is-dish-switching');
      if (inMedia) clearMediaInlineFx(inMedia);
      healActiveBoardMedia(toSec);
      dishSwitchTl = null;
    };
    const tl = gsap.timeline({
      defaults: { overwrite: true },
      onComplete: restoreVisible,
      onInterrupt: restoreVisible,
    });
    dishSwitchTl = tl;

    const fromSlot = hasFrom ? Number(fromSec.dataset.menuSlot) : Number(toSec.dataset.menuSlot);
    const toSlot = Number(toSec.dataset.menuSlot);
    const forward = !hasFrom || !Number.isFinite(fromSlot) || !Number.isFinite(toSlot) ? true : toSlot >= fromSlot;
    const outY = forward ? -11 : 11;
    const inY = forward ? 11 : -11;

    if (hasFrom) {
      fromSec.classList.add('is-dish-leaving');
      const outMedia = fromSec.querySelector('.dish-board-media');
      if (outMedia) {
        tl.to(outMedia, { autoAlpha: 0, yPercent: outY, duration: 0.24, ease: 'power2.in' }, 0);
      }
    }

    if (inMedia) {
      tl.fromTo(
        inMedia,
        { autoAlpha: 0, yPercent: inY },
        { autoAlpha: 1, yPercent: 0, duration: 0.34, ease: 'power2.out' },
        hasFrom ? 0.055 : 0,
      );
    } else {
      const gsap = getGsap();
      if (gsap) gsap.delayedCall(0.016, () => healActiveBoardMedia(toSec));
      else requestAnimationFrame(() => healActiveBoardMedia(toSec));
    }
  }

  function syncDishRailActive(slot) {
    syncDishSubBar(
      lastFilledCategoryId != null ? lastFilledCategoryId : activeCategoryId(),
      slot,
      {
        forceHide:
          !document.documentElement.classList.contains('is-dish-boards') ||
          document.documentElement.classList.contains('is-cat-flying'),
      },
    );
    const nav = dishRailNav();
    if (!nav) return null;
    let activeIcon = null;
    const prevActive = document.querySelector('section.is-benefits.is-dish-active');
    let newActive = null;
    $$('.benefits_icon-wrapper', nav).forEach((a) => {
      const href = a.getAttribute('href') || '';
      const m = href.match(/benefits-(\d+)/);
      const i = m ? Number(m[1]) - 1 : -1;
      const on = i === slot;
      a.classList.toggle('is-active', on);
      a.classList.toggle('w--current', on);
      if (on) activeIcon = a;
    });
    document.querySelectorAll('section.is-benefits').forEach((sec) => {
      const s = Number(sec.dataset.menuSlot);
      const on = s === slot;
      sec.classList.toggle('is-dish-active', on);
      // Write aria only on real changes: each setAttribute invalidates styles,
      // and six of them land in the same frame as the switch.
      const aria = on ? 'false' : 'true';
      if (sec.getAttribute('aria-hidden') !== aria) sec.setAttribute('aria-hidden', aria);
      if (on) newActive = sec;
    });
    if (
      newActive &&
      newActive !== prevActive &&
      document.documentElement.classList.contains('is-dish-boards')
    ) {
      playDishSwitch(prevActive, newActive);
      try {
        const img =
          newActive.querySelector('.dish-board-media img')?.currentSrc ||
          newActive.querySelector('.dish-board-media img')?.src ||
          '';
        window.dispatchEvent(
          new CustomEvent('westo:dish-focus', {
            detail: {
              itemId: newActive.dataset.itemId,
              categoryId: newActive.dataset.categoryId,
              img,
            },
          }),
        );
      } catch (_) {}
    } else if (newActive && document.documentElement.classList.contains('is-dish-boards')) {
      syncSharedDishCard(newActive, { animate: false });
    }
    if (activeIcon) {
      // Measure + scroll the rail next frame: reading offsetTop/scrollHeight
      // right after the class writes above forces a synchronous layout inside
      // the switch frame (this was the visible transition hitch).
      requestAnimationFrame(() => {
        if (!activeIcon.isConnected) return;
        syncLiquidRailBorder(activeIcon);
        window.WestoLiquidRail?.bump?.(1.35, 260);
        if (nav.scrollHeight <= nav.clientHeight + 4) return;
        const top =
          activeIcon.offsetTop - nav.clientHeight * 0.45 + activeIcon.offsetHeight * 0.5;
        nav.scrollTo({
          top: Math.max(0, Math.min(top, nav.scrollHeight - nav.clientHeight)),
          behavior: 'auto',
        });
      });
    } else {
      syncLiquidRailBorder(null);
    }
    return activeIcon;
  }

  function scrollToDishSlot(slot) {
    const el = document.querySelector(`section.is-benefits[data-menu-slot="${slot}"]`);
    if (!el) return;
    window.westoSound?.play?.('benefits');
    window.westoSound?.lockNav?.(1100);
    // Lock scroll-driven rail sync so intermediate dishes don't flash active mid-jump
    window.__westoRailNavLock = { slot };
    syncDishRailActive(slot);
    const duration = 1.05;
    const clearLock = () => {
      if (window.__westoRailNavLock?.slot === slot) window.__westoRailNavLock = null;
    };
    if (window.lenis) {
      window.lenis.scrollTo(el, {
        offset: 0,
        duration,
        lock: true,
        onComplete: clearLock,
      });
      // Safety if onComplete is skipped (interrupt / remount)
      window.clearTimeout(window.__westoRailNavLockTimer);
      window.__westoRailNavLockTimer = window.setTimeout(clearLock, duration * 1000 + 200);
    } else {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.clearTimeout(window.__westoRailNavLockTimer);
      window.__westoRailNavLockTimer = window.setTimeout(clearLock, 1200);
    }
  }

  function dishSubcategoryGroups(categoryId) {
    const items = menuByCategory[categoryId] || menuByCategory[Number(categoryId)] || [];
    const seen = new Set();
    const groups = [];
    items.forEach((item, slot) => {
      const id = item?.subcategoryId;
      const title = String(item?.subcategoryTitle || '').trim();
      if (id == null || id === '' || !title || seen.has(String(id))) return;
      seen.add(String(id));
      groups.push({ id: String(id), title, slot });
    });
    return groups;
  }

  function bindDishSubBar(subbar) {
    if (!subbar || subbar.dataset.bound === '1') return;
    subbar.dataset.bound = '1';
    subbar.setAttribute('data-lenis-prevent', '');
    subbar.setAttribute('data-lenis-prevent-touch', '');
    subbar.setAttribute('data-lenis-prevent-wheel', '');

    subbar.addEventListener('click', (event) => {
      const tab = event.target.closest('.westo-dish-subbar__tab');
      if (!tab || !subbar.contains(tab) || tab.disabled) return;
      const slot = Number(tab.dataset.menuSlot);
      if (!Number.isFinite(slot)) return;
      event.preventDefault();
      scrollToDishSlot(slot);
    });

    subbar.addEventListener('keydown', (event) => {
      const tab = event.target.closest('.westo-dish-subbar__tab');
      if (!tab || !subbar.contains(tab)) return;
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      const tabs = [...subbar.querySelectorAll('.westo-dish-subbar__tab')];
      if (!tabs.length) return;
      const current = Math.max(0, tabs.indexOf(tab));
      let next = current;
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
      else next = (current - 1 + tabs.length) % tabs.length;
      event.preventDefault();
      tabs[next].focus({ preventScroll: true });
      tabs[next].click();
    });

    // Mouse wheels over the secondary tabs browse that row instead of leaking
    // a category/dish step into the page-level animation state machine.
    subbar.addEventListener(
      'wheel',
      (event) => {
        const ax = Math.abs(event.deltaX);
        const ay = Math.abs(event.deltaY);
        if (ax < 0.35 && ay < 0.35) return;
        const delta = ax >= ay ? event.deltaX : event.deltaY;
        if (subbar.scrollWidth <= subbar.clientWidth + 2) return;
        event.preventDefault();
        event.stopPropagation();
        subbar.scrollLeft += delta;
      },
      { passive: false },
    );
  }

  function ensureDishSubBar(bar) {
    if (!bar) return null;
    let subbar = bar.querySelector(':scope > .westo-dish-subbar');
    if (!subbar) {
      subbar = document.createElement('div');
      subbar.className = 'westo-dish-subbar';
      subbar.hidden = true;
      subbar.setAttribute('role', 'tablist');
      subbar.setAttribute('aria-hidden', 'true');
      bar.appendChild(subbar);
    }
    subbar.setAttribute('aria-label', tr('dish.subcategories') || 'زیردسته‌های منو');
    bindDishSubBar(subbar);
    return subbar;
  }

  function centerDishSubTab(subbar, tab) {
    if (!subbar || !tab || subbar.scrollWidth <= subbar.clientWidth + 2) return;
    requestAnimationFrame(() => {
      if (!tab.isConnected || subbar.hidden) return;
      const host = subbar.getBoundingClientRect();
      const rect = tab.getBoundingClientRect();
      const target = Math.max(
        0,
        Math.min(
          subbar.scrollWidth - subbar.clientWidth,
          subbar.scrollLeft + rect.left + rect.width / 2 - (host.left + host.width / 2),
        ),
      );
      subbar.scrollTo({
        left: target,
        behavior: dishReducedMotion?.matches ? 'auto' : 'smooth',
      });
    });
  }

  function syncDishSubBar(categoryId, slot = 0, { forceHide = false } = {}) {
    const bar = ensureDishCatBar();
    // Subcategory navigation was deliberately removed from the experience.
    // Keep this guard inside the sync path so it cannot reappear after a
    // category change, wheel gesture, or a rail remount.
    const existingSubbar = bar?.querySelector(':scope > .westo-dish-subbar');
    if (existingSubbar) existingSubbar.remove();
    bar?.classList.remove('has-subcategories');
    return;

    const subbar = ensureDishSubBar(bar);
    if (!subbar) return;
    const groups = dishSubcategoryGroups(categoryId);
    // A lone subgroup is not a useful navigation choice. Its row remains
    // geometrically reserved by CSS, so changing categories never jumps food.
    const shouldShow = !forceHide && groups.length > 1;
    const lang = document.documentElement.getAttribute('lang') || 'fa';
    const signature = `${String(categoryId ?? '')}|${lang}|${groups
      .map((group) => `${group.id}:${group.title}:${group.slot}`)
      .join(',')}`;

    if (subbar.dataset.builtSig !== signature) {
      subbar.replaceChildren();
      groups.forEach((group) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'westo-dish-subbar__tab';
        tab.dataset.subcategoryId = group.id;
        tab.dataset.menuSlot = String(group.slot);
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', `benefits-${group.slot + 1}`);
        tab.setAttribute('dir', 'auto');
        tab.textContent = group.title;
        subbar.appendChild(tab);
      });
      subbar.dataset.builtSig = signature;
      subbar.scrollLeft = 0;
    }

    const items = menuByCategory[categoryId] || menuByCategory[Number(categoryId)] || [];
    const safeSlot = Math.max(0, Math.min(items.length - 1, Number(slot) || 0));
    const activeSubcategory = String(items[safeSlot]?.subcategoryId ?? '');
    let activeTab = null;
    subbar.querySelectorAll('.westo-dish-subbar__tab').forEach((tab, index) => {
      const on = tab.dataset.subcategoryId === activeSubcategory;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on || (!activeSubcategory && index === 0) ? 0 : -1;
      if (on) activeTab = tab;
    });
    subbar.hidden = !shouldShow;
    subbar.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
    bar.classList.toggle('has-subcategories', shouldShow);
    if (shouldShow && activeTab) centerDishSubTab(subbar, activeTab);
  }

  function bindDishRailClicks() {
    const nav = hoistDishRail();
    if (!nav || nav.dataset.westoRailBound) return;
    nav.dataset.westoRailBound = '1';
    const warmRailIntent = (e, reason) => {
      const a = e.target.closest('a.benefits_icon-wrapper');
      if (!a || !nav.contains(a)) return;
      const href = a.getAttribute('href') || '';
      const m = href.match(/benefits-(\d+)/);
      if (!m) return;
      const slot = Math.max(0, Number(m[1]) - 1);
      const categoryId = Number(lastFilledCategoryId ?? activeCategoryId());
      resourceScheduler()?.focusDish?.(categoryId, slot, reason);
    };
    nav.addEventListener('pointerover', (e) => warmRailIntent(e, 'rail-hover'), { passive: true });
    nav.addEventListener('pointerdown', (e) => warmRailIntent(e, 'rail-pointerdown'), { passive: true });
    nav.addEventListener('touchstart', (e) => warmRailIntent(e, 'rail-touchstart'), { passive: true });
    nav.addEventListener('click', (e) => {
      const a = e.target.closest('a.benefits_icon-wrapper');
      if (!a || !nav.contains(a)) return;
      const href = a.getAttribute('href') || '';
      const m = href.match(/benefits-(\d+)/);
      if (!m) return;
      e.preventDefault();
      e.stopPropagation();
      scrollToDishSlot(Number(m[1]) - 1);
    });
  }

  let dishViewportStateBound = false;
  let dishViewportRaf = 0;
  let activeViewportSlot = -1;
  let dishBoardsCache = null;
  let dishBoardMetrics = null;
  let dishHeroHeight = 0;
  let lastViewportUiKey = '';

  // getComputedStyle per board per scroll frame showed up in CPU profiles —
  // resolve visibility once and reuse until layout actually changes.
  function refreshDishBoardsCache() {
    dishBoardsCache = allDishBoards().filter(
      (section) => section.isConnected && !section.hasAttribute('hidden') && section.style.display !== 'none',
    );
    // Read geometry as one batch, only after a relayout/resize/category commit.
    // Scroll frames consume these absolute coordinates without layout reads.
    const scrollY = window.lenis?.animatedScroll ?? window.lenis?.scroll ?? window.scrollY ?? 0;
    dishBoardMetrics = dishBoardsCache.map((section) => {
      const rect = section.getBoundingClientRect();
      return {
        section,
        top: rect.top + scrollY,
        bottom: rect.bottom + scrollY,
        height: rect.height,
        center: rect.top + scrollY + rect.height * 0.5,
      };
    });
    const heroEl = document.querySelector('section.is-gamme');
    if (heroEl) dishHeroHeight = heroEl.getBoundingClientRect().height || window.innerHeight || 1;
    return dishBoardsCache;
  }

  function updateDishViewportState() {
    dishViewportRaf = 0;
    // Finger is scrubbing the side rail — freeze dish board sync.
    if (window.__westoRailBrowsing) return;
    const root = document.documentElement;

    // The Hero→Dish landing owns the state machine for its final paint.
    // Ignore observer churn during this short atomic handoff; otherwise a
    // resize/scroll tick can re-toggle `is-dish-boards` between the two paints.
    if (root.classList.contains('is-cat-fly-handoff')) {
      syncBackCategoriesBtn();
      return;
    }

    // Reverse Dish→Hero is also an atomic transaction.  `onDishes` is computed
    // later from geometry captured at the start of this callback; without this
    // grace window the same scroll tick can re-add `is-dish-boards` immediately
    // after reverse completion, which is the visible one-frame "tick" seen on
    // return to the category Hero.  Do not pin scroll here — simply let Hero
    // own the visual state until the reverse handoff has settled.
    if (Date.now() < catFlyReverseGraceUntil) {
      root.classList.remove(
        'is-dish-boards',
        'is-cat-flying',
        'is-cat-scroll-fly',
        'is-cat-fly-covered',
        'is-cat-fly-media-under',
        'is-cat-fly-handoff',
        'is-cat-fly-dish-in',
      );
      syncBackCategoriesBtn();
      syncDishCatBar({ skipReveal: true });
      return;
    }

    /* The entrance gate owns scroll until its hand-off timeline completes.
       A very fast wheel/touch gesture used to let this observer activate dish
       mode underneath the fading gate, leaving hero, fly and dish state alive
       at the same time. Keep the state machine at its hero origin and discard
       any native scroll leaked by browser chrome while the gate is locked. */
    if (root.classList.contains('is-entrance-gate')) {
      if (scrollCatFly) cancelScrollCatFly();
      scrollFlyLanded = false;
      catFlyBusy = false;
      pendingDishRevealEl = null;
      root.classList.remove(
        'is-dish-boards',
        'is-cat-flying',
        'is-cat-scroll-fly',
        'is-cat-fly-covered',
        'is-cat-fly-media-under',
        'is-cat-fly-handoff',
        'is-cat-fly-dish-in',
      );
      if ((window.scrollY || window.lenis?.scroll || 0) > 1) {
        window.lenis?.scrollTo?.(0, { immediate: true, force: true });
        window.scrollTo(0, 0);
      }
      syncBackCategoriesBtn();
      syncDishCatBar({ skipReveal: true });
      return;
    }

    const viewportHeight = window.innerHeight || 1;
    let boards = dishBoardsCache;
    if (!boards || !boards.length || !boards[0].isConnected) {
      boards = refreshDishBoardsCache();
    }
    boards = boards.filter((section) => section.isConnected && !section.hasAttribute('hidden'));
    if (!dishBoardMetrics || dishBoardMetrics.length !== boards.length) refreshDishBoardsCache();

    let active = null;
    let bestDistance = Infinity;
    const currentScrollY = window.lenis?.animatedScroll ?? window.lenis?.scroll ?? window.scrollY ?? 0;
    (dishBoardMetrics || []).forEach((metric) => {
      const section = metric.section;
      const rectTop = metric.top - currentScrollY;
      const rectBottom = metric.bottom - currentScrollY;
      const ownsViewport = rectTop <= viewportHeight * 0.58 && rectBottom >= viewportHeight * 0.42;
      if (!ownsViewport) return;
      const distance = Math.abs(metric.center - currentScrollY - viewportHeight * 0.5);
      if (distance < bestDistance) {
        bestDistance = distance;
        active = section;
      }
    });

    const lockedSlot = Number(window.__westoRailNavLock?.slot);
    if (Number.isFinite(lockedSlot)) {
      const locked = boards.find(
        (section) => Number(section.dataset.menuSlot) === lockedSlot,
      );
      if (locked) active = locked;
    }

    const wasOnDishes = root.classList.contains('is-dish-boards');
    // Keep dish mode until the user is clearly back in the hero zone.
    // Otherwise: dish DOM hides (CSS) while WebGL cans are still scaled to ~0
    // → empty black page, then a sudden category jump when plates return.
    const scrollY = currentScrollY;
    const heroH = dishHeroHeight || viewportHeight;
    const inHeroZone = scrollY < heroH * 0.28;
    const firstBoardTop = dishBoardMetrics?.[0]?.top ?? heroH;
    const flyProgress = computeScrollFlyProgress(scrollY, heroH, firstBoardTop);
    const flyEndScroll = Math.min(
      heroH * SCROLL_FLY_END,
      (firstBoardTop || heroH) * 0.82,
    );
    const flyStartScroll = heroH * SCROLL_FLY_START;
    const pastFlyZone = scrollY >= flyEndScroll;
    const inHeroFlyBand = scrollY >= flyStartScroll && scrollY < flyEndScroll;
    const crossingIntoDishes = scrollY >= Math.min(heroH * 0.55, firstBoardTop * 0.85);

    // Back button / programmatic hero return — never re-enter dish mode or fly mid-scroll.
    if (isForcingHeroReturn()) {
      if (scrollCatFly) cancelScrollCatFly();
      scrollFlyLanded = false;
      catFlyBusy = false;
      root.classList.remove(
        'is-dish-boards',
        'is-cat-flying',
        'is-cat-scroll-fly',
        'is-cat-fly-covered',
        'is-cat-fly-media-under',
        'is-cat-fly-handoff',
      );
      if (inHeroZone) {
        forceHeroReturn = false;
        forceHeroReturnUntil = Date.now() + 180;
      } else {
        // Keep pinning until Lenis actually settles in the hero — otherwise
        // the next scroll tick re-adds is-dish-boards and "دسته‌ها" looks dead.
        try {
          if (window.lenis?.scrollTo) {
            window.lenis.scrollTo(0, { immediate: true, force: true, lock: true });
          }
          window.scrollTo(0, 0);
        } catch (_) {}
      }
      syncBackCategoriesBtn();
      syncDishCatBar({ skipReveal: true });
      return;
    }

    const inDishFlow =
      wasOnDishes ||
      catFlyBusy ||
      root.classList.contains('is-cat-flying') ||
      scrollFlyLanded;
    const onDishes =
      Boolean(active) ||
      (scrollFlyLanded && !inHeroZone) ||
      (pastFlyZone && boards.length > 0) ||
      (crossingIntoDishes && !inHeroZone) ||
      (!inHeroZone && boards.length > 0 && inDishFlow) ||
      (inDishFlow && (catFlyBusy || Date.now() < catFlyLandGraceUntil));

    const leavingDishes =
      inDishFlow &&
      !onDishes &&
      !catFlyBusy &&
      !scrollCatFly &&
      Date.now() >= catFlyLandGraceUntil &&
      !isCatStepGuarded();
    if (!onDishes && !scrollCatFly) refreshHeroCatSeatCache();

    // ── Bidirectional scroll fly: hero band ↔ catbar (same path, both directions) ──
    const inReverseMode = scrollFlyLanded || Boolean(scrollCatFly?.reverse);

    // Horizontal category step: keep user pinned in dish boards — never reverse-fly / eject.
    if (isCatStepGuarded() && scrollFlyLanded) {
      const minDishY = Math.max(0, (firstBoardTop || heroH) + 4);
      if (scrollY < minDishY) {
        if (window.lenis?.scrollTo) {
          window.lenis.scrollTo(minDishY, { immediate: true });
        } else {
          window.scrollTo(0, minDishY);
        }
      }
      root.classList.add('is-dish-boards');
      // Skip reverse fly + leave for this frame.
    } else if (inHeroFlyBand) {
      if (inReverseMode) {
        if (catFlyTween?.kill) {
          catFlyTween.kill();
          catFlyTween = null;
        }
        updateScrollCatFly(flyProgress, { reverse: true });
        if (flyProgress <= 0.03) {
          completeScrollReverseFly();
          pendingDishRevealEl = null;
        }
      } else if (!wasOnDishes) {
        if (!lastHeroCatSeats.length) {
          const live = (
            typeof window.__westoCaptureHeroPlates === 'function'
              ? window.__westoCaptureHeroPlates()
              : []
          ).filter(
            (s) => s && s.categoryId && s.cover && Number(s.size) > 90 && Number(s.opacity) >= 0.5,
          );
          if (live.length >= 2 && live.length <= 5) {
            lastHeroCatSeats = live.map((s) => ({ ...s }));
          }
        }
        if (!pendingDishRevealEl) {
          pendingDishRevealEl = active || boards[0] || null;
        }
        boards.forEach(clearDishFx);
        preloadCatFlyCovers(lastHeroCatSeats.length ? lastHeroCatSeats : buildAllCatFlySources());
        updateScrollCatFly(flyProgress, { reverse: false });
        if (flyProgress >= 0.97 && !scrollFlyLanded) {
          completeScrollCatFly(pendingDishRevealEl);
          pendingDishRevealEl = null;
        }
      }
      if (inReverseMode ? flyProgress > 0.08 : flyProgress > 0.15) {
        prewarmDishBoards();
      }
    } else if (flyProgress <= 0.03 && scrollCatFly?.reverse) {
      completeScrollReverseFly();
      pendingDishRevealEl = null;
    } else if (flyProgress <= 0 && scrollCatFly && !scrollCatFly.reverse && !scrollFlyLanded) {
      cancelScrollCatFly();
      root.classList.remove('is-cat-flying');
      pendingDishRevealEl = null;
    } else if (pastFlyZone && scrollCatFly?.reverse) {
      cancelScrollCatFly({ keepLanded: true });
      root.classList.add('is-dish-boards');
    } else if (
      !scrollFlyLanded &&
      !scrollCatFly?.reverse &&
      (pastFlyZone || flyProgress >= 0.97) &&
      (scrollCatFly || catFlyBusy || root.classList.contains('is-cat-flying'))
    ) {
      if (scrollCatFly) {
        completeScrollCatFly(pendingDishRevealEl || active || boards[0] || null);
        pendingDishRevealEl = null;
      } else {
        scrollFlyLanded = true;
        catFlyBusy = false;
        root.classList.remove(
          'is-cat-flying',
          'is-cat-scroll-fly',
          'is-cat-fly-covered',
          'is-cat-fly-media-under',
          'is-cat-fly-handoff',
        );
        root.classList.add('is-dish-boards');
        revealPendingDishBoard();
        syncDishCatBar({ skipReveal: true });
      }
    }

    if (leavingDishes) {
      killDishSwitchTl();
      boards.forEach(clearDishFx);
      if (scrollCatFly?.reverse && flyProgress <= 0.05) {
        completeScrollReverseFly();
      } else if (!inHeroFlyBand && scrollFlyLanded && inHeroZone && !scrollCatFly) {
        scrollFlyLanded = false;
        killCatFly();
        root.classList.remove(
          'is-dish-boards',
          'is-cat-flying',
          'is-cat-scroll-fly',
          'is-cat-fly-covered',
        );
        if (typeof window.__westoHideHeroPlatesForFly === 'function') {
          window.__westoHideHeroPlatesForFly(false);
        }
        if (window.westoRestoreHeroScene) {
          window.westoRestoreHeroScene({ hidden: false });
        }
        if (window.westoRestoreHeroChrome) {
          window.westoRestoreHeroChrome({ force: true });
        }
      }
      fillBoards(activeCategoryId());
    }

    if (!catFlyBusy && !root.classList.contains('is-cat-flying') && !scrollCatFly?.reverse) {
      if (isCatStepGuarded()) {
        root.classList.add('is-dish-boards');
      } else {
        root.classList.toggle('is-dish-boards', onDishes || scrollFlyLanded);
      }
    }

    if (root.classList.contains('is-dish-boards') && !root.classList.contains('is-cat-flying')) {
      if (window.lenis?.isStopped && typeof window.lenis.start === 'function') {
        window.lenis.start();
      }
      document.body.style.overflow = '';
    }

    if (active) {
      const slot = Number(active.dataset.menuSlot) || 0;
      if (slot !== activeViewportSlot || !active.classList.contains('is-dish-active')) {
        activeViewportSlot = slot;
        syncDishRailActive(slot);
      }
    } else if (!onDishes) {
      activeViewportSlot = -1;
      boards.forEach((section) => {
        section.classList.remove('is-dish-active');
        section.setAttribute('aria-hidden', 'true');
      });
    }

    const viewportUiKey = `${onDishes ? 1 : 0}|${activeViewportSlot}|${lastFilledCategoryId ?? ''}|${catFlyBusy ? 1 : 0}`;
    if (viewportUiKey !== lastViewportUiKey) {
      lastViewportUiKey = viewportUiKey;
      syncBackCategoriesBtn();
      if (!scrollCatFly && !root.classList.contains('is-cat-flying')) syncDishCatBar();
    }
  }

  function scheduleDishViewportState() {
    if (dishViewportRaf) return;
    dishViewportRaf = window.requestAnimationFrame(updateDishViewportState);
  }

  function bindDishViewportState() {
    if (dishViewportStateBound) {
      scheduleDishViewportState();
      return;
    }
    dishViewportStateBound = true;
    const invalidateBoardsAndSync = () => {
      dishBoardsCache = null;
      dishBoardMetrics = null;
      dishHeroHeight = 0;
      scheduleDishViewportState();
    };

    // Exactly one canonical scroll producer. Native scroll is the bootstrap
    // fallback; as soon as Lenis exists we unbind native and let Lenis own the
    // viewport-state scheduler. This removes duplicate state commits during
    // transitions and resize settling.
    let nativeBound = false;
    const onNativeScroll = () => scheduleDishViewportState();
    const bindNative = () => {
      if (nativeBound) return;
      nativeBound = true;
      window.addEventListener('scroll', onNativeScroll, { passive: true });
    };
    const unbindNative = () => {
      if (!nativeBound) return;
      nativeBound = false;
      window.removeEventListener('scroll', onNativeScroll);
    };
    const bindLenisScroll = () => {
      if (!window.lenis?.on || window.lenis.__westoDishViewportBound) return false;
      window.lenis.__westoDishViewportBound = true;
      window.lenis.on('scroll', scheduleDishViewportState);
      unbindNative();
      return true;
    };

    if (!bindLenisScroll()) {
      bindNative();
      const wait = () => {
        if (!bindLenisScroll()) window.setTimeout(wait, 80);
      };
      wait();
    }

    // Expensive geometry invalidation is driven by the settled responsive
    // coordinator instead of every intermediate browser resize event.
    document.addEventListener('westo:responsive-settle', invalidateBoardsAndSync);
    document.addEventListener('westo:relayout', invalidateBoardsAndSync);
    scheduleDishViewportState();
  }

  function activeCategoryId() {
    const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
    if (!order.length) return null;
    const idx =
      window.carousel && typeof window.carousel.getIndex === 'function'
        ? window.carousel.getIndex(true)
        : window.carousel && typeof window.carousel.index === 'number'
          ? window.carousel.index
          : 0;
    return order[((idx % order.length) + order.length) % order.length];
  }

  function hideStorySection(el) {
    if (!el || el.dataset.westoTailSkipped) return;
    el.dataset.westoTailSkipped = '1';
    el.setAttribute('hidden', '');
    el.style.display = 'none';
    if (window.ScrollTrigger) {
      window.ScrollTrigger.getAll().forEach((st) => {
        if (st.trigger === el) st.kill();
      });
    }
  }

  function skipProfileForMenuStory() {
    const profile = document.querySelector('section.is-profile');
    if (!profile || profile.dataset.westoSkipped) {
      // still trim tail even if profile already skipped
    } else {
      profile.dataset.westoSkipped = '1';
      profile.setAttribute('hidden', '');
      profile.style.display = 'none';
      // Profile long-desc carousels are ciao leftovers — hide fixed overlays
      document.querySelectorAll('.carousel_title-bis-wrapper, .carousel_title-bis-collection').forEach((el) => {
        el.style.display = 'none';
      });
      // Profile ScrollTrigger used to hide .gamme_container on the way to dishes
      // and never restore it (profile height is now 0, so onEnterBack never fires).
      if (window.ScrollTrigger) {
        window.ScrollTrigger.getAll().forEach((st) => {
          if (st.trigger === profile) st.kill();
        });
      }
      if (window.westoRestoreHeroChrome) window.westoRestoreHeroChrome({ force: true });
      else if (window.gsap) {
        window.gsap.set('.gamme_container', { autoAlpha: 1 });
      }
    }
    trimMenuStoryTail();
  }

  /** Drop everything after the last dish board — FAQ, newsletter, full list, etc. */
  function trimMenuStoryTail() {
    if (document.documentElement.dataset.westoTailTrimmed === '1') {
      if (window.westoRelayout) window.westoRelayout();
      else if (window.ScrollTrigger) window.ScrollTrigger.refresh();
      return;
    }
    document.documentElement.dataset.westoTailTrimmed = '1';

    [
      'section.is-argument',
      'section.is-full-gamme',
      'section.is-faq',
      'section.is-last-copy',
      'section.is-last',
      '#newsletter',
      '.newsletter_container',
      '.footer_container',
    ].forEach((sel) => {
      document.querySelectorAll(sel).forEach(hideStorySection);
    });

    // Keep argument in DOM (hidden) as insertBefore anchor for dish clones
    const arg = document.querySelector('section.is-argument');
    if (arg) {
      arg.setAttribute('hidden', '');
      arg.style.display = 'none';
      arg.dataset.westoTailSkipped = '1';
    }

    // Nav links that pointed at removed story tail
    document
      .querySelectorAll(
        'a.navbar_link[href="#FAQ"], a.navbar_link[href="#newsletter"]',
      )
      .forEach((a) => {
        a.setAttribute('hidden', '');
        a.style.display = 'none';
      });

    if (window.westoRelayout) window.westoRelayout();
    else if (window.ScrollTrigger) window.ScrollTrigger.refresh();
  }

  async function loadMenu() {
    const hasBoards = !!document.querySelector('section.is-benefits');
    try {
      const store = window.westoMenuStore
        ? await window.westoMenuStore.ready
        : await fetch('/api/menu')
            .then((r) => {
              if (!r.ok) throw new Error(`menu request failed (${r.status})`);
              return r.json();
            })
            .then((d) => {
              const byCategory = {};
              (d.menuItems || []).forEach((m) => {
                if (m.available === false) return;
                if (!byCategory[m.categoryId]) byCategory[m.categoryId] = [];
                byCategory[m.categoryId].push(m);
              });
              return {
                byCategory,
                categoryOrder: (d.menuCategories || [])
                  .map((c) => Number(c.id))
                  .filter((id) => (byCategory[id] || []).length),
              };
            });
      menuByCategory = store.byCategory || {};
      categoryOrder = (store.categoryOrder || []).slice();
      resourceScheduler()?.registerMenu?.(store.data || store);
      if (!hasBoards) return;
      skipProfileForMenuStory();
      fillBoards(activeCategoryId());
      bindDishRailClicks();
      bindDishViewportState();
      rebuildDishCatBar(true);
      syncDishCatBar({ instantCenter: true });
      // Boards often fill before three-scene exposes westoBoot — keep trying briefly.
      const tryMarkBoards = () => {
        if (!window.westoBoot?.markBoards) return false;
        window.westoBoot.markBoards(1);
        return true;
      };
      if (!tryMarkBoards()) {
        const timer = window.setInterval(() => {
          if (tryMarkBoards()) window.clearInterval(timer);
        }, 200);
        window.setTimeout(() => window.clearInterval(timer), 20000);
      }
    } catch (e) {
      console.warn('menu load failed', e);
    }
  }

  function bindCarousel() {
    if (!document.querySelector('.carousel_list.is-hero') && !window.carousel) return;
    const tryBind = () => {
      if (!window.carousel || !window.carousel.changed) {
        setTimeout(tryBind, 200);
        return;
      }
      window.carousel.changed.connect(({ index }) => {
        // While reading dishes, do not remap boards from leftover carousel drift.
        if (document.documentElement.classList.contains('is-dish-boards')) return;
        const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
        if (!order.length) return;
        fillBoards(order[index % order.length]);
        refreshHeroCatSeatCache();
      });
      fillBoards(activeCategoryId());
      bindDishRailClicks();
      refreshHeroCatSeatCache();
      window.setTimeout(refreshHeroCatSeatCache, 400);
      window.setTimeout(refreshHeroCatSeatCache, 1200);    };
    tryBind();
  }

  // --- quantity modal ---
  let pendingItem = null;
  let pendingQty = 1;
  let qtyFocusBeforeOpen = null;
  const qtyModal = $('#qty-modal');
  const qtyName = $('#qty-modal-name');
  const qtyPrice = $('#qty-modal-price');
  const qtyValue = $('#qty-value');

  function openQtyModal(item) {
    qtyFocusBeforeOpen = document.activeElement;
    pendingItem = item;
    pendingQty = 1;
    pendingFlyFromEl = resolveDishFlySource(item);
    if (qtyName) {
      qtyName.textContent = window.westoI18n?.itemName ? window.westoI18n.itemName(item) : item.name;
    }
    if (qtyPrice) qtyPrice.textContent = formatPrice(item.price);
    if (qtyValue) qtyValue.textContent = pendingQty.toLocaleString(localeTag());
    if (qtyModal) {
      const wasHidden = qtyModal.hidden;
      qtyModal.hidden = false;
      qtyModal.setAttribute('aria-modal', 'true');
      qtyModal.setAttribute('role', 'dialog');
      if (wasHidden) lockScroll();
      bindQtyViewport();
      syncQtyViewport();
      if (wasHidden) {
        const closeX = qtyModal.querySelector('.qty-modal__x');
        if (closeX) closeX.focus({ preventScroll: true });
      }
    }
  }
  function closeQtyModal() {
    pendingItem = null;
    pendingFlyFromEl = null;
    if (qtyModal) {
      qtyModal.hidden = true;
      qtyModal.removeAttribute('aria-modal');
      qtyModal.classList.remove('is-keyboard-open');
      qtyModal.style.removeProperty('--vv-height');
    }
    unlockScroll();
    const back = qtyFocusBeforeOpen;
    qtyFocusBeforeOpen = null;
    if (back?.isConnected && typeof back.focus === 'function') {
      try {
        back.focus({ preventScroll: true });
      } catch (_) {}
    }
  }
  function setPendingQty(n) {
    pendingQty = Math.max(1, Math.min(99, n));
    if (qtyValue) qtyValue.textContent = pendingQty.toLocaleString(localeTag());
  }

  document.addEventListener('click', (e) => {
    const favorite = e.target.closest('[data-dish-favorite]');
    if (favorite && !favorite.disabled) {
      e.preventDefault();
      e.stopPropagation();
      toggleDishFavorite(favorite);
      return;
    }

    const add = e.target.closest('[data-menu-add]');
    if (add && !add.disabled && add.dataset.itemId) {
      e.preventDefault();
      e.stopPropagation();
      const id = Number(add.dataset.itemId);
      const items = Object.values(menuByCategory).flat();
      const item = items.find((m) => m.id === id);
      if (item) {
        // Motion-style: photo arcs into #nav-table-btn on the Add press.
        // Qty can still be adjusted from the table drawer.
        const fromEl = resolveDishFlySource(item);
        addItem(item, 1, { fromEl });
      }
      return;
    }

    if (e.target.closest('#qty-inc')) {
      e.preventDefault();
      setPendingQty(pendingQty + 1);
      return;
    }
    if (e.target.closest('#qty-dec')) {
      e.preventDefault();
      setPendingQty(pendingQty - 1);
      return;
    }
    if (e.target.closest('#qty-confirm')) {
      e.preventDefault();
      if (pendingItem) {
        const item = pendingItem;
        const qty = pendingQty;
        const fromEl = pendingFlyFromEl;
        closeQtyModal();
        addItem(item, qty, { fromEl });
      }
      return;
    }
    if (e.target.matches('.qty-modal__backdrop') || e.target.matches('[data-qty-close]')) {
      if (e.target.closest('.qty-modal__card') && !e.target.matches('[data-qty-close]')) return;
      e.preventDefault();
      closeQtyModal();
      return;
    }

    if (e.target.closest('#nav-table-btn')) {
      e.preventDefault();
      openDrawer();
      return;
    }
    if (e.target.matches('.table-drawer__backdrop') || e.target.matches('[data-table-close]')) {
      // Backdrop or explicit close — ignore clicks that bubbled from the panel body
      if (e.target.closest('.table-drawer__panel') && !e.target.matches('[data-table-close]')) return;
      closeDrawer();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (qtyModal && !qtyModal.hidden && trapFocus(e, qtyModal.querySelector('.qty-modal__card'))) return;
    if (drawer && !drawer.hidden && trapFocus(e, drawer.querySelector('.table-drawer__panel'))) return;
    if (e.key !== 'Escape') return;
    if (qtyModal && !qtyModal.hidden) {
      e.preventDefault();
      closeQtyModal();
      return;
    }
    if (drawer && !drawer.hidden) {
      e.preventDefault();
      closeDrawer();
    }
  });

  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', () => showView('checkout'));
  }
  const backBtn = $('#table-back-btn');
  if (backBtn) backBtn.addEventListener('click', () => showView('cart'));

  const callWaiterBtn = $('#table-call-waiter-btn');
  if (callWaiterBtn) {
    callWaiterBtn.addEventListener('click', async () => {
      const msg = $('#order-msg');
      const params = new URLSearchParams(location.search);
      const tableNo = (($('#order-table') || {}).value || '').trim() || params.get('table') || '';
      const branchId = Number(params.get('branch') || params.get('branchId') || 0) || undefined;
      if (!tableNo) {
        if (msg) {
          msg.textContent = tr('cart.needTable');
          msg.className = 'msg error';
        }
        return;
      }
      try {
        callWaiterBtn.disabled = true;
        const r = await fetch('/api/call-waiter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableNo, note: tr('cart.waiterNote'), branchId }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'خطا');
        if (msg) {
          msg.textContent = tr('cart.waiterOk');
          msg.className = 'msg ok';
        }
      } catch (e) {
        if (msg) {
          msg.textContent = e.message || tr('cart.waiterFail');
          msg.className = 'msg error';
        }
      } finally {
        callWaiterBtn.disabled = false;
      }
    });
  }

  // Prefill table from QR link ?table=
  const tableFromQr = new URLSearchParams(location.search).get('table');
  if (tableFromQr && $('#order-table') && !$('#order-table').value) {
    $('#order-table').value = tableFromQr;
  }

  const phoneInput = $('#order-phone');
  if (phoneInput) {
    phoneInput.addEventListener('input', () => {
      phoneInput.value = normalizeDigits(phoneInput.value).replace(/\D/g, '').slice(0, 11);
    });
  }

  const submitBtn = $('#table-submit-btn');
  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      const msg = $('#order-msg');
      const tableNo = ($('#order-table') || {}).value || '';
      const name = ($('#order-name') || {}).value || '';
      const phone = normalizeDigits(($('#order-phone') || {}).value || '');
      const payEl = document.querySelector('input[name="pay"]:checked');
      const paymentMethod = payEl ? payEl.value : 'cashier';

      if (msg) {
        msg.textContent = '';
        msg.className = 'msg';
      }
      if (!tableNo.trim()) {
        if (msg) {
          msg.textContent = tr('cart.needTable');
          msg.className = 'msg error';
        }
        return;
      }
      if (!/^09\d{9}$/.test(phone)) {
        if (msg) {
          msg.textContent = 'شماره موبایل معتبر نیست';
          msg.className = 'msg error';
        }
        return;
      }

      submitBtn.disabled = true;
      submitBtn.classList.add('is-busy');
      submitBtn.setAttribute('aria-busy', 'true');
      const prevLabel = submitBtn.textContent;
      submitBtn.textContent = tr('cart.submitting');
      try {
        const params = new URLSearchParams(location.search);
        const branchId = Number(params.get('branch') || params.get('branchId') || 0) || undefined;
        const r = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tableNo: tableNo.trim(),
            name: name.trim(),
            phone,
            paymentMethod,
            branchId,
            items: cart.map((l) => ({ menuItemId: l.menuItemId, qty: l.qty })),
          }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || tr('cart.submitFail'));

        cart = [];
        saveCart(cart);
        const done = $('#table-done-msg');
        if (done) {
          const payLabel =
            paymentMethod === 'online'
              ? tr('cart.onlineDone')
              : tr('cart.counterDone');
          done.innerHTML = `
            <span class="table-done-kicker">${escapeHtml(tr('cart.doneKicker'))}</span>
            <span class="table-done-id" dir="ltr">#${escapeHtml(String(d.order.id))}</span>
            <span class="table-done-meta">${escapeHtml(tr('cart.tableLabel'))} ${escapeHtml(d.order.tableNo)}</span>
            <span class="table-done-pay">${payLabel}</span>
            <span class="table-done-total">${formatPrice(d.order.total)}</span>
            <a class="table-done-feedback" href="/feedback?order=${encodeURIComponent(d.order.id)}${branchId ? `&branch=${branchId}` : ''}&src=order">${escapeHtml(tr('cart.feedback'))}</a>`;
        }
        showView('done');
      } catch (err) {
        if (msg) {
          msg.textContent = err.message;
          msg.className = 'msg error';
        }
      } finally {
        submitBtn.disabled = false;
        submitBtn.classList.remove('is-busy');
        submitBtn.removeAttribute('aria-busy');
        submitBtn.textContent = prevLabel || tr('cart.submit');
      }
    });
  }

  function goToCategories() {
    window.__westoRailNavLock = null;
    window.clearTimeout(window.__westoRailNavLockTimer);
    catStepGuardUntil = 0;
    // Hold dish-mode off until scroll is actually in the hero. Releasing too
    // early lets the scroll sync re-add is-dish-boards while Lenis is mid-page.
    forceHeroReturn = true;
    forceHeroReturnUntil = Date.now() + 2800;
    try {
      killCatFly();
    } catch (_) {}
    try {
      if (typeof cancelScrollCatFly === 'function') cancelScrollCatFly();
    } catch (_) {}
    scrollFlyLanded = false;
    catFlyBusy = false;
    pendingDishRevealEl = null;

    const root = document.documentElement;
    root.classList.remove(
      'is-dish-boards',
      'is-cat-flying',
      'is-cat-scroll-fly',
      'is-cat-fly-covered',
      'is-cat-fly-chrome-in',
      'is-cat-fly-dish-in',
      'is-cat-fly-media-under',
      'is-cat-fly-handoff',
    );

    const hardPinHero = () => {
      try {
        if (window.lenis) {
          if (window.lenis.isStopped && typeof window.lenis.start === 'function') {
            window.lenis.start();
          }
          window.lenis.scrollTo(0, {
            offset: 0,
            immediate: true,
            force: true,
            lock: true,
          });
        }
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      } catch (_) {}
    };

    const releaseIfInHero = () => {
      const scrollY = window.lenis?.animatedScroll ?? window.lenis?.scroll ?? window.scrollY ?? 0;
      const heroEl = document.querySelector('section.is-gamme');
      const heroH = heroEl?.offsetHeight || window.innerHeight || 800;
      if (scrollY < heroH * 0.28) {
        forceHeroReturn = false;
        forceHeroReturnUntil = Date.now() + 180;
        return true;
      }
      return false;
    };

    const finish = () => {
      hardPinHero();
      scrollFlyLanded = false;
      catFlyBusy = false;
      root.classList.remove(
        'is-dish-boards',
        'is-cat-flying',
        'is-cat-scroll-fly',
        'is-cat-fly-covered',
        'is-cat-fly-chrome-in',
        'is-cat-fly-dish-in',
        'is-cat-fly-media-under',
        'is-cat-fly-handoff',
      );
      if (window.westoRestoreHeroChrome) window.westoRestoreHeroChrome({ force: true });
      if (window.westoRestoreHeroScene) window.westoRestoreHeroScene({ hidden: false });
      syncBackCategoriesBtn();
      syncDishCatBar({ skipReveal: true });
      releaseIfInHero();
    };

    hardPinHero();
    if (window.westoRestoreHeroChrome) window.westoRestoreHeroChrome({ force: true });
    if (window.westoRestoreHeroScene) window.westoRestoreHeroScene({ hidden: false });
    syncBackCategoriesBtn();
    syncDishCatBar({ skipReveal: true });

    requestAnimationFrame(() => {
      requestAnimationFrame(finish);
    });
    window.setTimeout(finish, 60);
    window.setTimeout(finish, 220);
    window.setTimeout(() => {
      hardPinHero();
      if (!releaseIfInHero()) {
        // Absolute failsafe so horizontal dish steps cannot stay blocked forever.
        forceHeroReturn = false;
        forceHeroReturnUntil = Date.now() + 120;
      }
      syncBackCategoriesBtn();
    }, 2600);
  }

  function syncBackCategoriesBtn() {
    const btn = $('#westo-back-categories');
    if (!btn) return;
    const onDishes = document.documentElement.classList.contains('is-dish-boards');
    btn.hidden = !onDishes;
    btn.setAttribute('aria-hidden', onDishes ? 'false' : 'true');
  }

  function recoverStableDishInteractionState() {
    const root = document.documentElement;
    const stable = root.classList.contains('is-dish-boards') && !root.classList.contains('is-cat-flying');
    if (!stable) return false;
    // State flags are implementation details of the hero→dish fly. They must
    // never leave a visible, settled category bar non-interactive.
    if (catFlyBusy) catFlyBusy = false;
    if (scrollCatFly) scrollCatFly = null;
    return true;
  }

  function selectDishCatChip(chip) {
    const stable = recoverStableDishInteractionState();
    if (!chip || chip.disabled) return;
    if (!stable && (catFlyBusy || scrollCatFly || document.documentElement.classList.contains('is-cat-flying'))) return;
    const idx = Number(chip.dataset.catIndex);
    const id = chip.dataset.categoryId;
    if (!id || !Number.isFinite(idx)) return;    // #endregion
    selectDishCategory(id, idx);
  }

  let catBarChipTap = null;
  let catBarChipTapHandled = false;
  /** Brief guard against ghost click right after track drag-scroll. */
  let catBarIgnoreClickUntil = 0;

  function armCatBarGhostClickGuard(ms = 60) {
    catBarIgnoreClickUntil = Date.now() + ms;
  }

  function bindCatBarChipTap(bar) {
    if (!bar || bar.dataset.chipTapBound === '1') return;
    bar.dataset.chipTapBound = '1';

    bar.addEventListener(
      'pointerover',
      (e) => {
        // Touch browsers synthesize pointerover before a tap. Prefetching here
        // duplicated work with pointerdown intent and could wake the scheduler
        // while the user was simply panning the strip. Hover preview is desktop-only.
        if (e.pointerType === 'touch') return;
        const chip = e.target.closest('.westo-dish-catbar__chip');
        if (!chip || chip.disabled || chip.contains(e.relatedTarget)) return;
        resourceScheduler()?.previewCategory?.(chip.dataset.categoryId, {
          reason: 'catbar-hover',
        });
      },
      { passive: true },
    );

    bar.addEventListener(
      'pointerdown',
      (e) => {
        const chip = e.target.closest('.westo-dish-catbar__chip');
        recoverStableDishInteractionState();
        if (!chip || chip.disabled || catFlyBusy || scrollCatFly || document.documentElement.classList.contains('is-cat-flying')) {
          catBarChipTap = null;
          return;
        }
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        catBarChipTapHandled = false;
        resourceScheduler()?.intentCategory?.(chip.dataset.categoryId, {
          reason: 'catbar-pointerdown',
          slot: 0,
        });
        catBarChipTap = {
          chip,
          pointerId: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          moved: false,
        };
      },
      true,
    );

    bar.addEventListener(
      'pointermove',
      (e) => {
        if (!catBarChipTap || catBarChipTap.pointerId !== e.pointerId) return;
        const dx = e.clientX - catBarChipTap.x;
        const dy = e.clientY - catBarChipTap.y;
        if (Math.hypot(dx, dy) > 8) catBarChipTap.moved = true;
      },
      true,
    );

    const finishChipTap = (e) => {
      if (!catBarChipTap || catBarChipTap.pointerId !== e.pointerId) return;
      const tap = catBarChipTap;
      catBarChipTap = null;
      if (tap.moved || Date.now() < catBarIgnoreClickUntil) return;
      catBarChipTapHandled = true;
      selectDishCatChip(tap.chip);
    };

    bar.addEventListener('pointerup', finishChipTap, true);
    bar.addEventListener('pointercancel', () => {
      catBarChipTap = null;
    }, true);

    // Fallback when pointerup path is skipped (older WebViews).
    bar.addEventListener('click', (e) => {
      if (catBarChipTapHandled) {
        catBarChipTapHandled = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (Date.now() < catBarIgnoreClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const chip = e.target.closest('.westo-dish-catbar__chip');
      if (!chip || chip.disabled) return;
      selectDishCatChip(chip);
    });

    // Roving keyboard focus for the one canonical (middle) loop copy. The two
    // visual clones stay clickable by pointer but never become duplicate tab
    // stops or duplicate announcements for assistive technology.
    bar.addEventListener('keydown', (e) => {
      const chip = e.target.closest('.westo-dish-catbar__chip');
      if (!chip || chip.dataset.loopCopy !== '1') return;
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!keys.includes(e.key)) return;
      const canonical = [
        ...bar.querySelectorAll('.westo-dish-catbar__chip[data-loop-copy="1"]'),
      ];
      if (!canonical.length) return;
      const current = Math.max(0, canonical.indexOf(chip));
      let next = current;
      if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = canonical.length - 1;
      else if (e.key === 'ArrowRight') next = (current + 1) % canonical.length;
      else next = (current - 1 + canonical.length) % canonical.length;
      e.preventDefault();
      canonical[next].focus({ preventScroll: true });
      selectDishCatChip(canonical[next]);
    });
  }

  // Capture-phase safety net: a visible category button must always win over
  // WebGL/page swipe arbitration. Pointer-up is the primary mobile activation
  // path because a horizontal scroller/browser may suppress the synthetic click.
  // The click listener remains only as a keyboard/legacy fallback.
  if (!document.documentElement.dataset.westoDishCatCaptureBound) {
    document.documentElement.dataset.westoDishCatCaptureBound = '1';
    let directPointer = null;
    const directChip = (e, { fromPointer = false } = {}) => {
      const chip = e.target?.closest?.('#westo-dish-catbar .westo-dish-catbar__chip[data-category-id]');
      if (!chip || chip.disabled) return false;
      const root = document.documentElement;
      const bar = chip.closest('#westo-dish-catbar');
      const stable = root.classList.contains('is-dish-boards') &&
        !root.classList.contains('is-cat-flying') && bar && !bar.hidden;
      if (!stable) return false;
      recoverStableDishInteractionState();
      const idx = Number(chip.dataset.catIndex);
      const id = chip.dataset.categoryId;
      if (!id || !Number.isFinite(idx)) return false;
      if (fromPointer && directPointer) {
        const dx = Number(e.clientX || 0) - directPointer.x;
        const dy = Number(e.clientY || 0) - directPointer.y;
        if (Math.hypot(dx, dy) > 10) return false;
      }
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      catBarChipTap = null;
      catBarChipTapHandled = true;
      selectDishCategory(id, idx, { mode: 'click' });
      return true;
    };
    document.addEventListener('pointerdown', (e) => {
      const chip = e.target?.closest?.('#westo-dish-catbar .westo-dish-catbar__chip[data-category-id]');
      if (!chip || (e.pointerType === 'mouse' && e.button !== 0)) { directPointer = null; return; }
      directPointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }, true);
    document.addEventListener('pointerup', (e) => {
      if (!directPointer || directPointer.id !== e.pointerId) return;
      const start = directPointer;
      directPointer = start;
      directChip(e, { fromPointer: true });
      directPointer = null;
    }, true);
    document.addEventListener('pointercancel', () => { directPointer = null; }, true);
    document.addEventListener('click', (e) => {
      // Pointer activation was already committed on pointerup. Prevent the
      // follow-up synthetic click from selecting twice.
      if (catBarChipTapHandled) {
        const chip = e.target?.closest?.('#westo-dish-catbar .westo-dish-catbar__chip[data-category-id]');
        if (chip) {
          catBarChipTapHandled = false;
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          return;
        }
      }
      directChip(e);
    }, true);
  }

  function ensureDishCatBar() {
    let bar = $('#westo-dish-catbar');
    if (bar) {
      // Legacy: was nested under .navbar and stole hero swipe/scroll via isUiChromeClick.
      if (bar.parentElement?.classList?.contains('navbar') || bar.tagName === 'NAV') {
        const next = document.createElement('div');
        next.id = bar.id;
        next.className = bar.className;
        next.hidden = bar.hidden;
        next.setAttribute('aria-label', bar.getAttribute('aria-label') || '');
        next.setAttribute('aria-hidden', bar.getAttribute('aria-hidden') || 'true');
        next.innerHTML = bar.innerHTML;
        bar.replaceWith(next);
        bar = next;
      }
      if (bar.parentElement !== document.body) {
        document.body.appendChild(bar);
      }
      bar.setAttribute('role', 'navigation');
      ensureDishSubBar(bar);
      bindCatBarChipTap(bar);
      return bar;
    }
    bar = document.createElement('div');
    bar.id = 'westo-dish-catbar';
    bar.className = 'westo-dish-catbar';
    bar.hidden = true;
    bar.setAttribute('aria-label', tr('nav.categories') || 'دسته‌ها');
    bar.setAttribute('aria-hidden', 'true');
    bar.setAttribute('role', 'navigation');
    bar.innerHTML = '<div class="westo-dish-catbar__track" role="toolbar"></div>';
    ensureDishSubBar(bar);
    // Must NOT live under .navbar — hero swipe treats .navbar hits as chrome.
    document.body.appendChild(bar);
    bindCatBarChipTap(bar);
    return bar;
  }

  /** Prefer middle loop copy so active always has L/R neighbors (infinite strip). */
  function findCatBarChip(bar, categoryId, { preferMiddle = true } = {}) {
    if (!bar || categoryId == null) return null;
    const chips = [
      ...bar.querySelectorAll(`.westo-dish-catbar__chip[data-category-id="${categoryId}"]`),
    ];
    if (!chips.length) return null;
    if (!preferMiddle || chips.length === 1) return chips[0];
    return chips.find((c) => c.dataset.loopCopy === '1') || chips[Math.floor(chips.length / 2)];
  }

  function syncCatBarA11y(bar, categoryId) {
    if (!bar) return;
    const track = bar.querySelector('.westo-dish-catbar__track');
    if (!track) return;
    track.setAttribute('role', 'toolbar');
    track.setAttribute('aria-label', tr('nav.categories') || 'دسته‌ها');
    const activeId = String(categoryId ?? '');
    const infinite = Number(track.dataset.loopLen) >= 2;
    bar.querySelectorAll('.westo-dish-catbar__chip').forEach((chip) => {
      const canonical = !infinite || chip.dataset.loopCopy === '1';
      const on = chip.dataset.categoryId === activeId;
      chip.setAttribute('aria-current', on ? 'true' : 'false');
      chip.tabIndex = canonical && on ? 0 : -1;
      if (canonical) chip.removeAttribute('aria-hidden');
      else chip.setAttribute('aria-hidden', 'true');
    });
  }

  /** Closest on-screen copy — used for navigation (never cross the whole strip). */
  function findNearestCatBarChip(bar, categoryId) {
    if (!bar || categoryId == null) return null;
    const track = bar.querySelector('.westo-dish-catbar__track') || bar;
    const trackRect = track.getBoundingClientRect();
    const midX = trackRect.left + trackRect.width / 2;
    const scroll = track.scrollLeft || 0;
    const chips = [
      ...bar.querySelectorAll(`.westo-dish-catbar__chip[data-category-id="${categoryId}"]`),
    ];
    let best = null;
    let bestDist = Infinity;
    chips.forEach((chip) => {
      const r = chip.getBoundingClientRect();
      if (r.width < 2) return;
      // Prefer screen distance; fall back to scroll-space distance for offscreen copies.
      const screenDist = Math.abs(r.left + r.width / 2 - midX);
      const scrollDist = Math.abs(chip.offsetLeft + r.width / 2 - (scroll + track.clientWidth / 2));
      const dist = Math.min(screenDist, scrollDist);
      if (dist < bestDist) {
        bestDist = dist;
        best = chip;
      }
    });
    return best || findCatBarChip(bar, categoryId, { preferMiddle: false });
  }

  /**
   * Pick a loop copy whose centered scrollLeft is in-range and closest to current.
   * Plain "nearest on screen" fails at scrollLeft≈0: the edge copy wants a negative
   * scroll that clamps, so the strip never moves (tick/theme change, catbar stuck).
   */
  function pickCatBarCenterPlan(bar, categoryId, track) {
    if (!bar || !track || categoryId == null) return null;
    const chips = [
      ...bar.querySelectorAll(`.westo-dish-catbar__chip[data-category-id="${categoryId}"]`),
    ];
    if (!chips.length) return null;
    const setW = measureCatBarLoopSet(track) || Number(track.dataset.loopSetWidth) || 0;
    const cur = track.scrollLeft || 0;
    const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    const trackRect = track.getBoundingClientRect();
    if (!trackRect.width) return null;
    const midX = trackRect.left + trackRect.width / 2;

    let best = null;
    let bestScore = Infinity;
    chips.forEach((chip) => {
      const r = chip.getBoundingClientRect();
      if (r.width < 2) return;
      const delta = r.left + r.width / 2 - midX;
      const raw = cur + delta;
      const candidates = [raw];
      if (setW > 16) {
        for (let k = -2; k <= 2; k += 1) candidates.push(raw + k * setW);
      }
      candidates.forEach((t) => {
        if (t < -0.5 || t > maxScroll + 0.5) return;
        const score = Math.abs(t - cur);
        if (score < bestScore) {
          bestScore = score;
          best = { chip, target: t };
        }
      });
    });

    if (best) return best;

    const fallback =
      chips.find((c) => c.dataset.loopCopy === '1') ||
      findNearestCatBarChip(bar, categoryId) ||
      chips[0];
    const r = fallback.getBoundingClientRect();
    let t = cur + (r.left + r.width / 2 - midX);
    if (setW > 16) {
      while (t < 0) t += setW;
      while (t > maxScroll) t -= setW;
    }
    t = Math.max(0, Math.min(maxScroll, t));
    return { chip: fallback, target: t };
  }

  /** While user scrubs the catbar, sync must not yank scroll back to active. */
  let catBarUserScrubUntil = 0;
  /** User manually offset the strip — keep selection until explicit chip click/step. */
  let catBarBrowsing = false;
  /** Ignore scroll events caused by centering / infinite-loop rebalance. */
  let catBarProgrammaticScroll = false;
  /** Absolute deadline so programmatic flag can never stick forever after a killed tween. */
  let catBarProgrammaticUntil = 0;
  let catBarPageWheelBound = false;
  let catBarScrollTween = null;
  let catBarNativeCenterTimer = 0;
  /**
   * After a page-level horizontal category step, keep the user pinned in dish
   * mode so trackpad residual deltaY cannot eject them into the hero/main menu.
   */
  let catStepGuardUntil = 0;

  function markCatBarUserScrub(ms = 900) {
    catBarUserScrubUntil = Date.now() + ms;
  }

  function markCatBarBrowsing() {
    catBarBrowsing = true;
    markCatBarUserScrub(1800);
  }

  function clearCatBarBrowsing() {
    catBarBrowsing = false;
    catBarUserScrubUntil = 0;
  }

  function beginCatBarProgrammatic(ms = 900) {
    catBarProgrammaticScroll = true;
    catBarProgrammaticUntil = Date.now() + Math.max(120, ms);
  }

  function endCatBarProgrammatic() {
    catBarProgrammaticScroll = false;
    catBarProgrammaticUntil = 0;
  }

  /** True only while a live programmatic scroll is in progress (auto-heals if stuck). */
  function isCatBarProgrammatic() {
    if (!catBarProgrammaticScroll) return false;
    if (Date.now() > catBarProgrammaticUntil) {
      endCatBarProgrammatic();
      return false;
    }
    return true;
  }

  /** Kill centering tween AND clear the programmatic lock (GSAP kill skips onComplete). */
  function killCatBarScrollTween() {
    if (catBarScrollTween?.kill) {
      try {
        catBarScrollTween.kill();
      } catch (_) {}
    }
    catBarScrollTween = null;
    if (catBarNativeCenterTimer) {
      window.clearTimeout(catBarNativeCenterTimer);
      catBarNativeCenterTimer = 0;
    }
    endCatBarProgrammatic();
  }

  function isCatBarUserScrubbing() {
    return catBarBrowsing || Date.now() < catBarUserScrubUntil || catFlyBusy;
  }

  function isCatStepGuarded() {
    return Date.now() < catStepGuardUntil;
  }

  /** Ensure track can scroll whenever we are not mid-fly. */
  function ensureCatBarTrackInteractive(bar) {
    if (!bar) return;
    // If the settled dish UI is visible, transitional flags are stale by
    // definition and must never disable its native controls.
    recoverStableDishInteractionState();
    if (catFlyBusy || scrollCatFly || document.documentElement.classList.contains('is-cat-flying')) {
      return;
    }
    const track = bar.querySelector?.('.westo-dish-catbar__track');
    if (!track) return;
    if (track.style.overflowX === 'hidden') {
      lockCatBarTrack(bar, false);
    }
    if (track.style.touchAction === 'none') {
      track.style.touchAction = 'pan-x';
    }
  }

  function pinScrollToDishBoards({ immediate = true } = {}) {
    if (isForcingHeroReturn()) return null;
    const boards = dishBoardsCache?.length ? dishBoardsCache : refreshDishBoardsCache();
    const first = boards[0];
    if (!first) return null;
    const top = Math.max(0, (dishBoardMetrics?.[0]?.top ?? first.offsetTop ?? 0) + 4);
    document.documentElement.classList.add('is-dish-boards');
    scrollFlyLanded = true;
    if (window.lenis?.scrollTo) {
      window.lenis.scrollTo(top, { immediate: Boolean(immediate), lock: true });
    } else {
      window.scrollTo(0, top);
    }
    return first;
  }  /** Wipe prior catbar scroll handlers (clone) so upgrades aren't stacked. */
  function remountCatBarTrack(track, engine) {
    if (!track?.parentNode) return track;
    if (track.dataset.scrollEngine === engine) return track;
    const sl = track.scrollLeft;
    const fresh = track.cloneNode(true);
    fresh.dataset.scrollEngine = engine;
    delete fresh.dataset.userScrollBound;
    delete fresh.dataset.loopBound;
    track.parentNode.replaceChild(fresh, track);
    fresh.scrollLeft = sl;
    return fresh;
  }

  /**
   * Native-first catbar scroll:
   * - Trackpad horizontal swipe → browser momentum (no preventDefault)
   * - Touch pan → native overflow scrolling
   * - Vertical wheel over strip → mapped to scrollLeft
   * - No snap / settle (those killed soft trackpad feel)
   */
  function bindCatBarUserScroll(track) {
    if (!track || track.dataset.userScrollBound === 'native3') return track;
    track.dataset.userScrollBound = 'native3';

    if (track._catScrollAbort) {
      try {
        track._catScrollAbort.abort();
      } catch (_) {}
    }
    const ac = new AbortController();
    track._catScrollAbort = ac;
    const { signal } = ac;

    track.setAttribute('data-lenis-prevent', '');
    track.setAttribute('data-lenis-prevent-touch', '');
    track.setAttribute('data-lenis-prevent-wheel', '');
    track.style.scrollSnapType = 'none';
    track.style.scrollBehavior = 'auto';
    track.style.webkitOverflowScrolling = 'touch';
    track.style.touchAction = 'pan-x';

    track.addEventListener(
      'wheel',
      (e) => {
        if (catFlyBusy || scrollCatFly || isForcingHeroReturn()) return;
        const ax = Math.abs(e.deltaX);
        const ay = Math.abs(e.deltaY);
        if (ax < 0.5 && ay < 0.5) return;

        // Horizontal trackpad/mouse: native overflow keeps OS inertia.
        if (ax >= ay) {
          killCatBarScrollTween();
          markCatBarBrowsing();
          e.stopPropagation();
          return;
        }

        // Vertical wheel over the strip → horizontal scrub.
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        else if (e.deltaMode === 2) dy *= Math.max(120, track.clientWidth * 0.35);
        e.preventDefault();
        e.stopPropagation();
        killCatBarScrollTween();
        markCatBarBrowsing();
        track.scrollLeft += dy;
      },
      { passive: false, signal },
    );

    // Mouse/pen drag — 1:1 scrub, light coast, no snap.
    let drag = null;
    track.addEventListener(
      'pointerdown',
      (e) => {
        if (catFlyBusy || scrollCatFly || isForcingHeroReturn()) return;
        if (e.pointerType === 'touch') return;
        if (e.button != null && e.button !== 0) return;
        drag = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startScroll: track.scrollLeft,
          lastX: e.clientX,
          lastT: performance.now(),
          vx: 0,
          moved: false,
        };
        track.classList.add('is-dragging');
        try {
          track.setPointerCapture(e.pointerId);
        } catch (_) {}
      },
      { signal },
    );
    track.addEventListener(
      'pointermove',
      (e) => {
        if (!drag || drag.pointerId !== e.pointerId) return;
        const now = performance.now();
        const delta = e.clientX - drag.startX;
        const dt = Math.max(8, now - drag.lastT);
        const frameDx = e.clientX - drag.lastX;
        drag.vx = drag.vx * 0.55 + (-frameDx / dt) * 16;
        drag.lastX = e.clientX;
        drag.lastT = now;
        if (Math.abs(delta) > 4) drag.moved = true;
        if (!drag.moved) return;
        e.preventDefault();
        markCatBarBrowsing();
        if (catBarChipTap) catBarChipTap.moved = true;
        killCatBarScrollTween();
        track.scrollLeft = drag.startScroll - delta;
      },
      { signal },
    );
    const endDrag = (e) => {
      if (!drag || (e && drag.pointerId !== e.pointerId)) return;
      const moved = drag.moved;
      let vx = drag.vx;
      drag = null;
      track.classList.remove('is-dragging');
      if (!moved) return;
      armCatBarGhostClickGuard();
      markCatBarBrowsing();
      vx = Math.max(-55, Math.min(55, vx * 14));
      if (Math.abs(vx) < 1.2) return;
      let frames = 0;
      const coast = () => {
        if (catFlyBusy || scrollCatFly || Math.abs(vx) < 0.35 || frames > 45) return;
        track.scrollLeft += vx;
        vx *= 0.92;
        frames += 1;
        requestAnimationFrame(coast);
      };
      requestAnimationFrame(coast);
    };
    track.addEventListener('pointerup', endDrag, { signal });
    track.addEventListener('pointercancel', endDrag, { signal });
    track.addEventListener('lostpointercapture', endDrag, { signal });

    let touchMoved = false;
    track.addEventListener(
      'touchstart',
      () => {
        touchMoved = false;
      },
      { passive: true, signal },
    );
    track.addEventListener(
      'touchmove',
      () => {
        touchMoved = true;
        markCatBarBrowsing();
      },
      { passive: true, signal },
    );
    track.addEventListener(
      'touchend',
      () => {
        if (touchMoved) armCatBarGhostClickGuard(80);
      },
      { passive: true, signal },
    );

    track.addEventListener(
      'scroll',
      () => {
        if (catFlyBusy || scrollCatFly || isCatBarProgrammatic()) return;
        markCatBarBrowsing();
      },
      { passive: true, signal },
    );

    return track;
  }

  function bindCatBarPageWheel() {
    if (catBarPageWheelBound) return;
    catBarPageWheelBound = true;

    let stepLockUntil = 0;
    let stepArmAfter = 0;
    let axisAccum = 0;
    let gestureAxis = null; // 'x' | 'y' | null
    let gestureHasStepped = false;
    let quietSince = 0;
    let gestureIdleTimer = 0;
    // One intentional flick → one category. Trackpad inertia must NOT chain
    // a second step — but must ALWAYS re-arm (hard deadline, not quiet-only).
    const STEP_COOLDOWN_MS = 560;
    const STEP_REARM_MS = 920;
    const STEP_THRESHOLD = 42;
    const GUARD_MS = 640;
    const GESTURE_IDLE_MS = 280;
    const QUIET_DELTA = 1.6;
    const QUIET_MS = 110;

    function categoryOrderList() {
      return window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
    }

    function resetGestureState() {
      gestureAxis = null;
      axisAccum = 0;
      gestureHasStepped = false;
      quietSince = 0;
    }

    function clearGestureSoon() {
      window.clearTimeout(gestureIdleTimer);
      gestureIdleTimer = window.setTimeout(() => {
        const now = Date.now();
        // Never drop the post-step swallow early — that re-armed mid-inertia
        // and made the 2nd/3rd trackpad flick feel broken or double-skip.
        if (gestureHasStepped && now < stepArmAfter) {
          clearGestureSoon();
          return;
        }
        resetGestureState();
      }, GESTURE_IDLE_MS);
    }

    function stepDishCategory(dir) {
      if (isForcingHeroReturn()) return false;
      if (catFlyBusy || scrollCatFly || document.documentElement.classList.contains('is-cat-flying')) {
        return false;
      }
      const order = categoryOrderList();
      if (!order.length) return false;
      const now = Date.now();
      if (now < stepLockUntil) return false;
      const activeId =
        lastFilledCategoryId != null ? String(lastFilledCategoryId) : String(activeCategoryId() ?? '');
      let idx = order.findIndex((id) => String(id) === String(activeId));
      if (idx < 0) idx = 0;
      const next = (idx + dir + order.length) % order.length;
      stepLockUntil = now + STEP_COOLDOWN_MS;
      stepArmAfter = now + STEP_REARM_MS;
      catStepGuardUntil = now + GUARD_MS;
      axisAccum = 0;
      quietSince = 0;
      if (window.lenis?.scrollTo) {
        const y = window.lenis.animatedScroll ?? window.lenis.scroll ?? 0;
        window.lenis.scrollTo(y, { immediate: true });
      }
      resourceScheduler()?.intentCategory?.(order[next], { reason: 'category-step', slot: 0 });
      selectDishCategory(order[next], next, { mode: 'step' });
      return true;
    }

    function consumeHorizontalStep(dx) {
      if (!dx) return false;
      const now = Date.now();

      // Hard re-arm: never stay dead after trackpad inertia refuses to go quiet.
      if (gestureHasStepped && now >= stepArmAfter) {
        gestureHasStepped = false;
        quietSince = 0;
        axisAccum = 0;
      }

      if (now < stepLockUntil) {
        axisAccum = 0;
        return true;
      }

      // After a step, swallow inertia until quiet — or until hard re-arm above.
      if (gestureHasStepped) {
        if (Math.abs(dx) < QUIET_DELTA) {
          if (!quietSince) quietSince = now;
          if (now - quietSince >= QUIET_MS) {
            gestureHasStepped = false;
            quietSince = 0;
            axisAccum = 0;
          }
        } else {
          quietSince = 0;
          axisAccum = 0;
        }
        if (gestureHasStepped) return true;
      }

      quietSince = 0;
      axisAccum += dx;
      if (Math.abs(axisAccum) < STEP_THRESHOLD) return true;
      const dir = axisAccum > 0 ? 1 : -1;
      axisAccum = 0;
      const ok = stepDishCategory(dir);
      if (ok) gestureHasStepped = true;
      return ok;
    }

    window.addEventListener(
      'wheel',
      (e) => {
        if (isForcingHeroReturn()) return;
        if (!document.documentElement.classList.contains('is-dish-boards')) return;
        if (catFlyBusy || scrollCatFly || document.documentElement.classList.contains('is-cat-flying')) {
          return;
        }
        const bar = document.getElementById('westo-dish-catbar');
        if (!bar || bar.hidden) return;
        ensureCatBarTrackInteractive(bar);
        if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
        // Catbar owns its own horizontal scrub; dish rail owns vertical scrub.
        if (e.target?.closest?.('#westo-dish-catbar, .benefits_nav.is-menu-rail')) return;

        const ax = Math.abs(e.deltaX);
        const ay = Math.abs(e.deltaY);
        if (ax < 0.35 && ay < 0.35) return;

        // Lock axis, but allow upgrading to X if horizontal becomes dominant
        // (fixes "sometimes dead" when the first ticks were slightly vertical).
        if (!gestureAxis) {
          gestureAxis = ax >= ay * 0.55 ? 'x' : 'y';
        } else if (gestureAxis === 'y' && ax > ay * 1.15 && ax >= 1.2) {
          gestureAxis = 'x';
          axisAccum = 0;
          gestureHasStepped = false;
          quietSince = 0;
        }
        clearGestureSoon();

        if (gestureAxis === 'x') {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          if (ax >= 0.35) consumeHorizontalStep(e.deltaX);
          return;
        }

        if (isCatStepGuarded() && e.deltaY < 0) {
          e.preventDefault();
          e.stopPropagation();
          pinScrollToDishBoards({ immediate: true });
        }
      },
      { passive: false, capture: true },
    );

    // The strip itself keeps native pan-x, but a horizontal finger swipe on the
    // dish media/card must also switch category. Axis-lock below leaves vertical
    // gestures to dish paging and commits at most one category per touch sequence.

    let touch = null;
    window.addEventListener(
      'touchstart',
      (e) => {
        if (!document.documentElement.classList.contains('is-dish-boards')) return;
        if (catFlyBusy || scrollCatFly) return;
        if (e.touches?.length !== 1) {
          touch = null;
          return;
        }
        // Only ignore catbar / form fields — do NOT ignore dish add-buttons
        // (that made swipes starting on the card randomly fail).
        if (e.target?.closest?.('#westo-dish-catbar, .benefits_nav.is-menu-rail, input, textarea, select, [contenteditable="true"]')) {
          touch = null;
          return;
        }
        const t = e.changedTouches?.[0];
        if (!t) return;
        touch = {
          x: t.clientX,
          y: t.clientY,
          locked: null,
          stepped: false,
        };
        axisAccum = 0;
        resetGestureState();
      },
      { passive: true, capture: true },
    );
    window.addEventListener(
      'touchmove',
      (e) => {
        if (!touch || touch.stepped) return;
        if (e.touches?.length !== 1) {
          touch = null;
          return;
        }
        const t = e.changedTouches?.[0];
        if (!t) return;
        const dx = t.clientX - touch.x;
        const dy = t.clientY - touch.y;
        if (!touch.locked) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          touch.locked = Math.abs(dx) >= Math.abs(dy) * 0.75 ? 'x' : 'y';
        } else if (touch.locked === 'y' && Math.abs(dx) > Math.abs(dy) * 1.2 && Math.abs(dx) > 18) {
          touch.locked = 'x';
        }
        if (touch.locked !== 'x') return;
        if (e.cancelable) e.preventDefault();
        // Exactly one category per finger swipe.
        if (Math.abs(dx) >= 40 && Math.abs(dx) >= Math.abs(dy) * 1.05) {
          const ok = stepDishCategory(dx < 0 ? 1 : -1);
          if (ok) touch.stepped = true;
        }
      },
      { passive: false, capture: true },
    );
    window.addEventListener(
      'touchend',
      (e) => {
        if (!touch) return;
        const start = touch;
        const t = e.changedTouches?.[0];
        touch = null;
        if (start.stepped) return;
        if (!t || !document.documentElement.classList.contains('is-dish-boards')) return;
        if (catFlyBusy || scrollCatFly) return;
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (start.locked === 'y') return;
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.05) return;
        stepDishCategory(dx < 0 ? 1 : -1);
      },
      { passive: true, capture: true },
    );
    window.addEventListener(
      'touchcancel',
      () => {
        touch = null;
      },
      { passive: true, capture: true },
    );
  }

  function bindCatBarInfiniteScroll(track) {
    if (!track) return track;
    // v13.7: the production strip is a single canonical DOM set. Native overflow
    // scrolling provides momentum on iOS/Android without a per-scroll RAF
    // rebalance loop or duplicated layout measurements. Keep the historical
    // function name so the surrounding state machine contract stays unchanged.
    bindCatBarUserScroll(track);
    bindCatBarPageWheel();
    return track;
  }

  function measureCatBarLoopSet(track) {
    if (!track) return 0;
    const n = Number(track.dataset.loopLen) || 0;
    if (n < 2) return 0;
    const chips = track.querySelectorAll('.westo-dish-catbar__chip');
    if (chips.length < n * 2) return 0;
    // Prefer average of copy0→1 and copy1→2 periods (more stable under subpixel).
    const a = Math.max(0, chips[n].offsetLeft - chips[0].offsetLeft);
    const b =
      chips.length >= n * 3
        ? Math.max(0, chips[n * 2].offsetLeft - chips[n].offsetLeft)
        : 0;
    let setW = a;
    if (a > 8 && b > 8) setW = Math.round((a + b) / 2);
    else if (a > 8) setW = Math.round(a);
    if (setW > 8) track.dataset.loopSetWidth = String(setW);
    return setW;
  }

  function categoryCoverFor(categoryId, index) {
    const labels = window.__westoCanLabels;
    if (Array.isArray(labels) && labels[index]) return String(labels[index]);
    const cats = window.westoMenuStore?.categories || [];
    const cat = cats.find((c) => Number(c.id) === Number(categoryId));
    const cover = String(cat?.coverImg || '').trim();
    if (cover) return cover;
    const items = menuByCategory[categoryId] || menuByCategory[Number(categoryId)] || [];
    const first = items[0];
    return String(first?.img || first?.image || '').trim();
  }

  const CATBAR_LOCAL_THUMB_IDS = new Set([
    7560, 7561, 7562, 7563, 7564, 7566, 7567, 7599,
    7675, 7676, 7697, 7701, 9478, 13581, 14477, 17007,
  ]);

  function categoryThumbFor(categoryId, index) {
    const id = Number(categoryId);
    if (Number.isFinite(id) && CATBAR_LOCAL_THUMB_IDS.has(id)) {
      return `assets/menu/category-thumbs/category-${id}.webp`;
    }
    return categoryCoverFor(categoryId, index);
  }

  function dishCatBarSignature() {
    const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
    const lang = document.documentElement.getAttribute('lang') || 'fa';
    return `${lang}|lite1|${order
      .map((id, i) => `${id}:${categoryLabelFor(id)}:${categoryThumbFor(id, i)}`)
      .join(',')}`;
  }

  function rebuildDishCatBar(force) {
    const bar = ensureDishCatBar();
    const track = bar.querySelector('.westo-dish-catbar__track');
    if (!track) return bar;
    track.setAttribute('role', 'toolbar');
    const sig = dishCatBarSignature();
    if (!force && track.dataset.builtSig === sig) return bar;
    const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
    track.replaceChildren();
    track.classList.remove('is-infinite');
    track.dataset.loopLen = String(order.length);
    track.dataset.loopCopies = '1';
    const activeId = Number(lastFilledCategoryId ?? activeCategoryId());

    const appendChip = (id, index, copy) => {
      const label = categoryLabelFor(id) || String(id);
      const cover = categoryCoverFor(id, index);
      const thumb = categoryThumbFor(id, index);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'westo-dish-catbar__chip';
      chip.dataset.categoryId = String(id);
      chip.dataset.catIndex = String(index);
      chip.dataset.loopCopy = String(copy);
      chip.title = label;
      chip.setAttribute('aria-label', label);

      const icon = document.createElement('span');
      icon.className = 'westo-dish-catbar__icon';
      icon.setAttribute('aria-hidden', 'true');
      const img = document.createElement('img');
      img.className = 'westo-dish-catbar__thumb';
      img.alt = '';
      img.width = 128;
      img.height = 128;
      img.decoding = 'async';
      const activeIndex = Math.max(0, order.findIndex((catId) => Number(catId) === activeId));
      const loopDistance = Math.min(
        Math.abs(index - activeIndex),
        Math.max(0, order.length - Math.abs(index - activeIndex)),
      );
      img.loading = loopDistance <= 2 ? 'eager' : 'lazy';
      img.fetchPriority = loopDistance === 0 ? 'high' : 'low';
      // Catbar thumbs are dedicated 128px local assets. Browser-native caching
      // avoids Blob/object-URL bookkeeping and decodes ~1 MB total instead of
      // dozens of 640px surfaces across three cloned strip copies.
      if (thumb) img.src = thumb;
      if (cover && thumb && thumb !== cover) {
        img.addEventListener('error', () => {
          if (img.src.endsWith(thumb)) img.src = cover;
        }, { once: true });
      }
      icon.appendChild(img);

      const lab = document.createElement('span');
      lab.className = 'westo-dish-catbar__label';
      lab.setAttribute('dir', 'auto');
      const words = String(label).trim().split(/\s+/).filter(Boolean);
      lab.textContent = words.slice(0, 2).join(' ');

      chip.appendChild(icon);
      chip.appendChild(lab);
      track.appendChild(chip);
    };

    order.forEach((id, index) => appendChip(id, index, 1));

    syncCatBarA11y(bar, activeId);

    track.dataset.builtSig = sig;
    bindCatBarInfiniteScroll(track);
    return bar;
  }

  let catFlyBusy = false;
  let catFlyTween = null;
  /** Last good hero plate seats (same covers as WebGL) — captured before dish collapse. */
  let lastHeroCatSeats = [];
  /** Exact seats/covers from the last hero→catbar fly — used for symmetric reverse. */
  let lastFlyManifest = [];
  /** Dish board to paint only after forward fly lands (avoids double-image). */
  let pendingDishRevealEl = null;
  /** Defer removing is-dish-boards until reverse orbs own center pixels. */
  let pendingLeaveDishUi = false;
  let pendingLeaveRaf = 0;
  /** Ignore leave-dishes briefly after forward land (prevents f_015 empty). */
  let catFlyLandGraceUntil = 0;
  /** Short ownership window after reverse Dish→Hero commit. Prevents the same
      scroll frame (or elastic scroll bounce) from re-entering dish mode. */
  let catFlyReverseGraceUntil = 0;
  /** Scroll-driven hero→catbar (5 covers, no timed tween). */
  let scrollCatFly = null;
  let scrollFlyLanded = false;
  /** Back-btn / programmatic return to hero — blocks viewport from re-forcing dish mode mid-scroll. */
  let forceHeroReturnUntil = 0;
  let forceHeroReturn = false;

  function isForcingHeroReturn() {
    return forceHeroReturn || Date.now() < forceHeroReturnUntil;
  }

  function computeScrollFlyProgress(scrollY, heroH, firstBoardTop) {
    const h = Math.max(heroH, 1);
    const start = h * SCROLL_FLY_START;
    const end = Math.min(h * SCROLL_FLY_END, (firstBoardTop || h) * 0.82);
    if (scrollY <= start) return 0;
    if (scrollY >= end) return 1;
    return (scrollY - start) / Math.max(1, end - start);
  }

  /** Narrow hero shows one plate — never invent a 3/5 cinema flock. */
  function prefersSinglePlateFly() {
    return window.innerWidth < 992;
  }

  function singleActiveFlySeat(seats) {
    const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
    if (!order.length) return [];
    const activeId =
      lastFilledCategoryId != null ? String(lastFilledCategoryId) : String(activeCategoryId() ?? '');
    const activeIdx = Math.max(0, order.findIndex((id) => String(id) === activeId));
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const byId = new Map((seats || []).map((s) => [String(s.categoryId), { ...s }]));
    const existing =
      byId.get(activeId) ||
      (seats || []).slice().sort((a, b) => Number(b.size) - Number(a.size))[0] ||
      null;
    const id = String(existing?.categoryId || activeId || order[activeIdx] || order[0] || '');
    const oi = Math.max(0, order.findIndex((x) => String(x) === id));
    if (!id) return [];
    if (existing && Number(existing.size) > 48) {
      return [{ ...existing, categoryId: id, opacity: 1, synthetic: false }];
    }
    return [
      {
        categoryId: id,
        cover: categoryCoverFor(id, oi),
        cx: vw * 0.5,
        cy: vh * 0.42,
        size: Math.min(vh * 0.42, 320),
        opacity: 1,
        synthetic: true,
      },
    ].filter((s) => s.categoryId && s.cover);
  }

  /** Exactly 5 categories on wide stage: active ±2. On narrow: active only. */
  function ensureFlockFive(seats) {
    if (prefersSinglePlateFly()) return singleActiveFlySeat(seats);
    const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
    if (!order.length) return seats || [];
    const activeId =
      lastFilledCategoryId != null ? String(lastFilledCategoryId) : String(activeCategoryId() ?? '');
    const activeIdx = Math.max(0, order.findIndex((id) => String(id) === activeId));
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const centerCx = vw * 0.5;
    const centerCy = vh * 0.42;
    const baseSize = Math.min(vh * 0.38, 300);
    const byId = new Map((seats || []).map((s) => [String(s.categoryId), { ...s }]));

    const offsets = [-2, -1, 0, 1, 2];
    const out = offsets.map((off) => {
      const oi = (activeIdx + off + order.length) % order.length;
      const id = String(order[oi]);
      const existing = byId.get(id);
      const spread = baseSize * 1.12;
      const cx = centerCx + off * spread;
      const size =
        off === 0 ? baseSize : Math.max(64, baseSize * (off === -2 || off === 2 ? 0.62 : 0.78));
      if (existing && Number(existing.size) > 48) {
        return { ...existing, opacity: 1 };
      }
      return {
        categoryId: id,
        cover: categoryCoverFor(id, oi),
        cx,
        cy: centerCy + Math.abs(off) * 6,
        size,
        opacity: 1,
        synthetic: !existing,
      };
    });
    return out.filter((s) => s.categoryId && s.cover).sort((a, b) => a.cx - b.cx);
  }

  /**
   * Scroll the catbar track so `chip` sits in the horizontal center.
   * Track is forced LTR so scrollLeft math is stable (chrome pattern).
   * Neighbors soft-settle via is-near / is-far classes.
   */
  function settleDishCatNeighbors() {
    // Visual distance transforms were decorative but forced extra style/composite
    // work across every chip. Active state alone carries hierarchy in v13.7.
  }


  /**
   * Scroll the catbar track so `chip` sits in the horizontal center.
   * Always prefers the nearest DOM copy so we never animate across the whole strip.
   * Track is forced LTR so scrollLeft math is stable (chrome pattern).
   */
  function centerDishCatChip(chip, { instant = false, duration = 0.55, ease = 'power2.out', preferNearest = true } = {}) {
    const track =
      chip?.closest?.('.westo-dish-catbar__track') ||
      document.querySelector('#westo-dish-catbar .westo-dish-catbar__track');
    if (!track || !chip) return;

    const bar = track.closest('#westo-dish-catbar') || track.parentElement;
    const categoryId = chip.dataset.categoryId;

    track.style.direction = 'ltr';

    if (track.dataset.loopCopies === '1' || !track.classList.contains('is-infinite')) {
      const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
      const target = Math.max(0, Math.min(
        maxScroll,
        chip.offsetLeft + chip.offsetWidth / 2 - track.clientWidth / 2,
      ));
      if (Math.abs(target - track.scrollLeft) < 0.75) return;
      killCatBarScrollTween();
      beginCatBarProgrammatic(instant ? 140 : 520);
      track.style.scrollBehavior = 'auto';
      if (typeof track.scrollTo === 'function') {
        track.scrollTo({ left: target, top: 0, behavior: instant ? 'auto' : 'smooth' });
      } else {
        track.scrollLeft = target;
      }
      catBarNativeCenterTimer = window.setTimeout(() => {
        catBarNativeCenterTimer = 0;
        endCatBarProgrammatic();
      }, instant ? 80 : 460);
      return;
    }

    measureCatBarLoopSet(track);

    const applyInstant = (value) => {
      beginCatBarProgrammatic(500);
      track.style.scrollBehavior = 'auto';
      if (typeof track.scrollTo === 'function') {
        track.scrollTo({ left: value, top: 0, behavior: 'instant' });
      } else {
        track.scrollLeft = value;
      }
      window.requestAnimationFrame(() => {
        endCatBarProgrammatic();
      });
    };

    const measureAndScroll = () => {
      measureCatBarLoopSet(track);
      let target = null;
      // Prefer an in-range loop copy so we never clamp to a no-op scrollLeft.
      if (preferNearest !== false && categoryId != null) {
        const plan = pickCatBarCenterPlan(bar, categoryId, track);
        if (plan?.chip) {
          chip = plan.chip;
          target = plan.target;
        }
      }
      settleDishCatNeighbors(chip);
      if (target == null) {
        const trackRect = track.getBoundingClientRect();
        const chipRect = chip.getBoundingClientRect();
        if (!trackRect.width || !chipRect.width) return;
        const delta =
          chipRect.left + chipRect.width / 2 - (trackRect.left + trackRect.width / 2);
        const setW = Number(track.dataset.loopSetWidth) || measureCatBarLoopSet(track) || 0;
        const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
        let raw = track.scrollLeft + delta;
        if (setW > 16) {
          let best = raw;
          let bestDist = Infinity;
          for (let k = -2; k <= 2; k += 1) {
            const t = raw + k * setW;
            if (t < -0.5 || t > maxScroll + 0.5) continue;
            const d = Math.abs(t - track.scrollLeft);
            if (d < bestDist) {
              bestDist = d;
              best = t;
            }
          }
          raw = best;
        }
        target = Math.max(0, Math.min(maxScroll, raw));
      }
      const chipRect = chip.getBoundingClientRect();
      const travel = Math.abs(target - track.scrollLeft);
      const chipSpan = Math.max((chipRect.width || 56) + 8, 56);      // #endregion

      // Already centered.
      if (travel < 0.75) {
        applyInstant(target);
        return;
      }

      // Long path = wrong copy / wrap — jump, never animate the flyby.
      const useInstant = instant || travel > chipSpan * 1.65;
      killCatBarScrollTween();

      if (useInstant || typeof window.gsap === 'undefined') {
        applyInstant(target);
        return;
      }

      const dur = Math.min(0.42, Math.max(0.2, Number(duration) || 0.32));
      beginCatBarProgrammatic(Math.ceil(dur * 1000) + 200);
      catBarScrollTween = window.gsap.to(track, {
        scrollLeft: target,
        duration: dur,
        ease: ease || 'power3.out',
        overwrite: true,
        onInterrupt: () => {
          catBarScrollTween = null;
          endCatBarProgrammatic();
        },
        onComplete: () => {
          catBarScrollTween = null;
          endCatBarProgrammatic();
        },
      });
    };

    measureAndScroll();
    requestAnimationFrame(measureAndScroll);
  }

  function captureHeroCatSources() {
    // Prefer strict visible plates (what the user actually sees).
    if (typeof window.__westoCaptureHeroPlates === 'function') {
      const strict = window.__westoCaptureHeroPlates();
      if (strict?.length) return strict;
    }
    if (typeof window.__westoSnapshotAllHeroPlates === 'function') {
      const snap = window.__westoSnapshotAllHeroPlates();
      if (snap?.length) return snap;
    }
    // Fallback if three-scene is not ready: approximate seats.
    const cans = typeof window.__westoStageDebug === 'function' ? window.__westoStageDebug() : [];
    const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
    const labels = window.__westoCanLabels || [];
    if (!cans.length || !order.length) return [];
    const fov = 34;
    const camZ = 15.5;
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    return cans
      .filter((c) => c && c.visible && c.opacity > 0.2 && c.scale > 0.28)
      .map((c) => {
        const dist = Math.max(0.35, camZ - (Number(c.z) || 0));
        const halfH = Math.tan((fov * Math.PI) / 360) * dist;
        const halfW = halfH * (vw / vh);
        const cx = (((Number(c.x) || 0) / Math.max(0.001, halfW)) * 0.5 + 0.5) * vw;
        const cy = (-((Number(c.y) || 0) / Math.max(0.001, halfH)) * 0.5 + 0.5) * vh;
        const size = ((3.2 * Math.max(0.2, Number(c.scale) || 1)) / (2 * halfH)) * vh;
        return {
          i: c.i,
          categoryId: String(order[c.i] ?? ''),
          cover: String(labels[c.i] || categoryCoverFor(order[c.i], c.i) || '').trim(),
          opacity: Math.max(0.2, Math.min(1, Number(c.opacity) || 1)),
          cx,
          cy,
          size,
        };
      })
      .filter((s) => s.categoryId && s.cover)
      .sort((a, b) => a.cx - b.cx);
  }

  function refreshHeroCatSeatCache() {
    if (document.documentElement.classList.contains('is-dish-boards')) return;
    if (document.documentElement.classList.contains('is-cat-flying')) return;
    // Don't refresh once we've left the deep hero — collapsing cans would
    // overwrite a good multi-plate snapshot with a single shrunk center.
    const scrollY = window.lenis?.animatedScroll ?? window.lenis?.scroll ?? window.scrollY ?? 0;
    const heroH = document.querySelector('section.is-gamme')?.offsetHeight || window.innerHeight || 1;
    if (scrollY > heroH * 0.32 && lastHeroCatSeats.length) return;

    const seats = (
      typeof window.__westoCaptureHeroPlates === 'function'
        ? window.__westoCaptureHeroPlates()
        : captureHeroCatSources()
    ).filter(
      (s) =>
        s &&
        s.categoryId &&
        s.cover &&
        Number(s.size) > 90 &&
        Number(s.opacity) >= 0.5,
    );
    if (!seats.length) return;

    // Narrow: cache the single clearest plate only (no multi flock).
    if (prefersSinglePlateFly()) {
      const best = seats
        .slice()
        .sort((a, b) => Number(b.size) - Number(a.size) || Number(b.opacity) - Number(a.opacity))
        .slice(0, 1)
        .map((s) => ({ ...s }));
      lastHeroCatSeats = best;
      preloadCatFlyCovers(lastHeroCatSeats);
      return;
    }

    // Ignore pre-stage frames that still show a crowd of full-size cans.
    if (seats.length > 5) return;
    const avgSize = (arr) =>
      arr.reduce((n, s) => n + Math.max(0, Number(s.size) || 0), 0) / Math.max(1, arr.length);
    const maxOp = Math.max(...seats.map((s) => Number(s.opacity) || 0));
    if (maxOp < 0.9 && seats.length > 3) return;

    if (!lastHeroCatSeats.length) {
      lastHeroCatSeats = seats.map((s) => ({ ...s }));
      preloadCatFlyCovers(lastHeroCatSeats);
      return;
    }

    const prevAvg = avgSize(lastHeroCatSeats);
    const nextAvg = avgSize(seats);
    const fewer = seats.length < lastHeroCatSeats.length;
    const fewerOrSame = seats.length <= lastHeroCatSeats.length;
    const sharper = nextAvg >= prevAvg * 0.95;
    // Prefer the settled stage view (fewer clear plates) over an early crowd.
    // Never collapse a good 3+ seat cache down to a lone plate.
    if (fewer && nextAvg >= 100) {
      if (seats.length >= 3 || lastHeroCatSeats.length < 3) {
        lastHeroCatSeats = seats.map((s) => ({ ...s }));
        preloadCatFlyCovers(lastHeroCatSeats);
      }
    } else if ((fewerOrSame && sharper) || nextAvg > prevAvg * 1.08) {
      if (!(seats.length < 3 && lastHeroCatSeats.length >= 3)) {
        lastHeroCatSeats = seats.map((s) => ({ ...s }));
        preloadCatFlyCovers(lastHeroCatSeats);
      }
    }
  }
  /**
   * Fly sources = plates the user is looking at.
   * Wide: pad to cinema flock (±2). Narrow: active plate only.
   */
  function buildAllCatFlySources() {
    // Prefer cache from while cans were still at hero size.
    const raw = lastHeroCatSeats.length
      ? lastHeroCatSeats
      : captureHeroCatSources().filter(
          (s) => s && s.categoryId && s.cover && Number(s.size) > 40,
        );
    if (!raw.length) return ensureFlockFive([]);
    // Keep the clearest plates only (usually center + near neighbors).
    const maxKeep = prefersSinglePlateFly() ? 1 : 5;
    const clearest = raw
      .slice()
      .sort((a, b) => Number(b.size) - Number(a.size) || Number(b.opacity) - Number(a.opacity))
      .slice(0, maxKeep)
      .filter((s) => Number(s.size) > 80 && Number(s.opacity) >= 0.45);
    let seats = (clearest.length ? clearest : raw.slice(0, maxKeep)).map((s) => ({
      ...s,
      synthetic: false,
      opacity: 1,
    }));
    seats = ensureFlockFive(seats);
    if (!lastHeroCatSeats.length && seats.length) {
      lastHeroCatSeats = seats.map((s) => ({ ...s }));
    }
    const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
    const orderIndex = new Map(order.map((id, i) => [String(id), i]));
    return seats.sort((a, b) => {
      const ia = orderIndex.has(String(a.categoryId)) ? orderIndex.get(String(a.categoryId)) : 999;
      const ib = orderIndex.has(String(b.categoryId)) ? orderIndex.get(String(b.categoryId)) : 999;
      if (ia !== ib) return ia - ib;
      return a.cx - b.cx;
    });
  }

  function preloadCatFlyCovers(list) {
    (list || []).forEach((src) => {
      const url = String(src?.cover || '').trim();
      if (!url) return;
      void warmManagedImage(url, {
        priority: resourcePriority('VISIBLE', 92),
        group: 'category-fly',
        kind: 'image',
      });
    });
  }

  function ensureCatFlyLayer() {
    let layer = document.getElementById('westo-cat-fly');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'westo-cat-fly';
      layer.className = 'westo-cat-fly';
      layer.style.direction = 'ltr';
      layer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(layer);
    }
    return layer;
  }

  function lockCatBarTrack(bar, locked) {
    const track = bar?.querySelector('.westo-dish-catbar__track');
    if (!track) return;
    if (locked) {
      track.dataset.prevOverflow = track.style.overflowX || '';
      track.style.overflowX = 'hidden';
      track.style.touchAction = 'none';
    } else {
      track.style.overflowX = track.dataset.prevOverflow || 'auto';
      track.style.touchAction = '';
      delete track.dataset.prevOverflow;
    }
  }

  function killCatFly() {
    cancelScrollCatFly();
    scrollFlyLanded = false;
    if (catFlyTween?.kill) catFlyTween.kill();
    catFlyTween = null;
    killCatBarScrollTween();
    const gsap = getGsap();
    if (typeof gsap?.killDelayedCallsTo === 'function') {
      try {
        gsap.killDelayedCallsTo(commitLeaveDishUiAfterOrbs);
      } catch (_) {}
    }
    if (pendingLeaveRaf) {
      cancelAnimationFrame(pendingLeaveRaf);
      pendingLeaveRaf = 0;
    }
    pendingLeaveDishUi = false;
    pendingDishRevealEl = null;
    document.documentElement.classList.remove(
      'is-cat-flying',
      'is-cat-scroll-fly',
      'is-cat-fly-covered',
      'is-cat-fly-chrome-in',
      'is-cat-fly-dish-in',
      'is-cat-fly-media-under',
      'is-cat-fly-handoff',
    );
    if (typeof window.__westoHideHeroPlatesForFly === 'function') {
      window.__westoHideHeroPlatesForFly(false);
    }
    const layer = document.getElementById('westo-cat-fly');
    if (layer) {
      layer.classList.remove('is-active');
      if (gsap) {
        gsap.killTweensOf(layer);
        gsap.set(layer, { clearProps: 'opacity' });
      } else {
        layer.style.opacity = '';
      }
      layer.replaceChildren();
    }
    const bar = $('#westo-dish-catbar');
    if (bar) {
      lockCatBarTrack(bar, false);
      bar.classList.remove('is-flying-in', 'is-flying-out', 'is-cinema-flock');
      if (gsap) {
        gsap.killTweensOf(bar);
        gsap.set(bar.querySelectorAll('.westo-dish-catbar__icon, .westo-dish-catbar__label'), {
          clearProps: 'opacity,visibility',
        });
      }
      bar.querySelectorAll('.westo-dish-catbar__chip').forEach((chip) => {
        chip.classList.remove('is-fly-seat', 'is-fly-landed');
      });
      if (!gsap) {
        bar.querySelectorAll('.westo-dish-catbar__icon, .westo-dish-catbar__label').forEach((el) => {
          el.style.opacity = '';
          el.style.visibility = '';
        });
      }
    }
    catFlyBusy = false;
  }

  function doubleRaf(fn) {
    const gsap = typeof window.gsap !== 'undefined' ? window.gsap : null;
    if (gsap) {
      gsap.delayedCall(0.032, fn);
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(fn));
  }

  function getGsap() {
    return typeof window.gsap !== 'undefined' ? window.gsap : null;
  }

  function setCatFlyOrb(el, seat, { opacity = 1 } = {}) {
    if (!el || !seat) return;
    // Transform-only flight path. The previous implementation rewrote
    // left/top/width/height through gsap.set() on every scroll frame, forcing
    // style/layout/paint for each orb. Keep a fixed raster box and animate only
    // compositor-friendly translate3d + scale + opacity.
    let baseSize = Number(el.__westoFlyBaseSize) || 0;
    if (!baseSize) {
      baseSize = Math.max(1, Number(seat.size) || 1);
      el.__westoFlyBaseSize = baseSize;
      el.style.position = 'fixed';
      el.style.left = '0px';
      el.style.top = '0px';
      el.style.width = `${baseSize}px`;
      el.style.height = `${baseSize}px`;
      el.style.transformOrigin = '0 0';
      el.style.setProperty('--orb-size', String(baseSize));
    }
    const size = Math.max(1, Number(seat.size) || baseSize);
    const scale = size / baseSize;
    const tx = (Number(seat.cx) || 0) - size * 0.5;
    const ty = (Number(seat.cy) || 0) - size * 0.5;
    const transform = `translate3d(${tx.toFixed(2)}px,${ty.toFixed(2)}px,0) scale(${scale.toFixed(5)})`;
    if (el.__westoFlyTransform !== transform) {
      el.__westoFlyTransform = transform;
      el.style.transform = transform;
    }
    const nextOpacity = String(opacity);
    if (el.style.opacity !== nextOpacity) el.style.opacity = nextOpacity;
  }

  function setCatFlyBarOpacity(bar, opacity) {
    if (!bar) return;
    const next = String(opacity);
    if (bar.style.opacity !== next) bar.style.opacity = next;
  }

  function setCatFlyElementsOpacity(els, opacity, { visibility } = {}) {
    if (!els?.length) return;
    const nextOpacity = String(opacity);
    els.forEach((el) => {
      if (el.style.opacity !== nextOpacity) el.style.opacity = nextOpacity;
      if (visibility != null && el.style.visibility !== visibility) el.style.visibility = visibility;
    });
  }

  function killScrollFlyGsap(fly) {
    if (!fly) return;
    const gsap = getGsap();
    if (!gsap) return;
    if (fly.scrubTween?.kill) fly.scrubTween.kill();
    fly.scrubTween = null;
    if (fly.scrubState) gsap.killTweensOf(fly.scrubState);
    fly.flights?.forEach((f) => {
      if (f.el) gsap.killTweensOf(f.el);
    });
    if (fly.bar) {
      gsap.killTweensOf(fly.bar);
      gsap.killTweensOf(fly.bar.querySelectorAll('.westo-dish-catbar__icon, .westo-dish-catbar__label'));
    }
    if (fly.landTween?.kill) fly.landTween.kill();
    fly.landTween = null;
  }

  function mountScrollFlyGsap(fly, initialProgress = 0) {
    const gsap = getGsap();
    if (!gsap || !fly) return;
    killScrollFlyGsap(fly);
    fly.scrubState = { progress: initialProgress };
    fly.scrubTween = gsap.to(fly.scrubState, {
      progress: 1,
      duration: 1,
      ease: 'none',
      paused: true,
    });
  }

  function driveScrollFlyGsap(fly, rawT) {
    if (!fly) return;
    const t = Math.max(0, Math.min(1, rawT));
    if (fly.scrubState) fly.scrubState.progress = t;
    if (fly.scrubTween) fly.scrubTween.progress(t);
  }

  const SCROLL_FLY_START = 0.30;
  const SCROLL_FLY_END = 0.76;
  const FLOCK_STAGES = 5;  /** Pitch between the 5 flock seats when docked on the catbar row. */
  const FLOCK_CHIP_PITCH = 56;

  function softstep(u) {
    const x = Math.max(0, Math.min(1, u));
    return x * x * (3 - 2 * x);
  }

  /** 5 visible resize steps along the scroll band.
   *  IMPORTANT: the denominator is FLOCK_STAGES, not FLOCK_STAGES - 1.
   *  The old math reached visual progress=1 at raw progress≈0.8, so the DOM
   *  photos finished their flight while the state machine was still waiting
   *  for the 0.97 landing threshold. That created the reproducible black-gap
   *  / double-commit seen when entering a dish category.
   */
  function stagedProgress(t) {
    const x = Math.max(0, Math.min(1, t));
    if (x >= 1) return 1;
    const scaled = x * FLOCK_STAGES;
    const bucket = Math.min(FLOCK_STAGES - 1, Math.floor(scaled));
    const local = scaled - bucket;
    return (bucket + softstep(local)) / FLOCK_STAGES;
  }

  function lerpSeat(a, b, u) {
    const t = Math.max(0, Math.min(1, u));
    return {
      cx: a.cx + (b.cx - a.cx) * t,
      cy: a.cy + (b.cy - a.cy) * t,
      size: a.size + (b.size - a.size) * t,
      opacity: 1,
    };
  }
  function flockSlotOffset(srcIdx, activeOrderIdx, orderLen) {
    let off = srcIdx - activeOrderIdx;
    if (orderLen > 1) {
      if (off > orderLen / 2) off -= orderLen;
      if (off < -orderLen / 2) off += orderLen;
    }
    return Math.max(-2, Math.min(2, off));
  }
  /** Hero landing seats — always symmetric around viewport center (never stale capture). */
  function buildFlightHeroTarget(_categoryId, slotOffset) {
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const screenCx = vw * 0.5;
    const screenCy = vh * 0.42;
    const baseSize = Math.min(vh * 0.38, 300);
    const spread = Math.min(baseSize * 0.56, 190);
    return {
      cx: screenCx + slotOffset * spread,
      cy: screenCy + Math.abs(slotOffset) * 5,
      size:
        slotOffset === 0
          ? baseSize
          : Math.max(58, baseSize * (Math.abs(slotOffset) === 2 ? 0.64 : 0.8)),
      opacity: 1,
    };
  }

  /**
   * Forward (t 0→1): hero stage → catbar row.
   * Reverse (t 1→0): catbar row → hero stage (drop from top strip into center).
   * Never B→side-cluster — that looked like photos sliding in from the right.
   */
  function sampleStagedFlockPath(flight, rawT, reverse) {
    const x = Math.max(0, Math.min(1, rawT));
    const A =
      flight.A ||
      buildFlightHeroTarget(flight.categoryId, flight.slotOffset ?? 0);
    const B = flight.B;
    if (reverse) {
      const u = stagedProgress(1 - x);
      return lerpSeat(B, A, u);
    }
    const u = stagedProgress(x);
    return lerpSeat(A, B, u);
  } /** Pitch between catbar chips when seating the 5-orb flock. */
  /**
   * Catbar fly B-row always hangs from the TOP-CENTER of the viewport.
   * Never use the live chip's screen X — if the strip is scrolled, that X sits
   * on the right/left edge and reverse orbs slide in from the side (see screenshot).
   * Only Y + size come from the nearest on-screen chip icon.
   */
  function catBarFlyAnchorSeat(bar, activeId, navH = 74, fallbackSize = 46) {
    const vw = window.innerWidth || 1;
    const chip =
      findNearestCatBarChip(bar, activeId) || findCatBarChip(bar, activeId, { preferMiddle: true });
    const icon = chip?.querySelector('.westo-dish-catbar__icon');
    const rect = icon?.getBoundingClientRect();
    const size = rect?.width > 2 ? Math.max(32, rect.width) : fallbackSize;
    const rootStyle = getComputedStyle(document.documentElement);
    const navTop = Number.parseFloat(rootStyle.getPropertyValue('--menu-nav-h')) || navH;
    const promoH = Number.parseFloat(rootStyle.getPropertyValue('--menu-promo-h')) || 0;
    const promoGap = Number.parseFloat(rootStyle.getPropertyValue('--menu-promo-gap')) || 0;
    const catTop = navTop + promoH + promoGap;
    const catGap =
      Number.parseFloat(rootStyle.getPropertyValue('--menu-catbar-gap')) || 0;
    const catH =
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--menu-catbar-h'),
      ) || 80;
    // Horizontal: always viewport center (active chip is conceptually centered).
    const cx = vw * 0.5;
    // Vertical: icon center if on-screen, else midline of the catbar band.
    let cy =
      rect?.width > 2 && rect.top > 0 && rect.top < window.innerHeight
        ? rect.top + rect.height / 2
        : catTop + catGap + catH * 0.42;
    const minCy = catTop + catGap + size * 0.35;
    const maxCy = catTop + catGap + catH - size * 0.15;
    cy = Math.max(minCy, Math.min(maxCy, cy));
    return { cx, cy, size, opacity: 1, chip };
  }

  /**
   * Place all B seats as a rigid row around the *visible* active chip center.
   * Never mix live rects from different infinite-strip copies — that was
   * splitting the flock into 3+2 groups drifting left (seen in recording).
   */
  function retargetScrollFlyBSeats(bar, flights, activeId, orderIndex) {
    if (!flights?.length) return;
    const navH =
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--menu-nav-h')) ||
      74;
    const anchor = catBarFlyAnchorSeat(bar, activeId, navH, 46);
    const vw = window.innerWidth || 1;

    flights.forEach((f) => {
      const off = Number.isFinite(f.slotOffset) ? f.slotOffset : 0;
      let cx = anchor.cx + off * FLOCK_CHIP_PITCH;
      const pad = Math.max(anchor.size * 0.55, 24);
      cx = Math.max(pad, Math.min(vw - pad, cx));
      f.B.cx = cx;
      f.B.cy = anchor.cy;
      f.B.size = anchor.size;
      f.B.opacity = 1;
    });
  }

  function applyScrollCatFlyFrame(t) {
    if (!scrollCatFly?.flights?.length) return;
    const raw = Math.max(0, Math.min(1, t));
    const isReverse = Boolean(scrollCatFly.reverse);
    const pathT = stagedProgress(isReverse ? 1 - raw : raw);
    driveScrollFlyGsap(scrollCatFly, raw);
    scrollCatFly.flights.forEach((f) => {
      const p = sampleStagedFlockPath(f, raw, isReverse);
      // Forward: keep orbs invisible until plates are covered (no pop over WebGL).
      // Reverse: always opaque — start on catbar chips, never flash dish/hero under them.
      const orbOpacity = !isReverse && raw < 0.03 ? 0 : 1;
      setCatFlyOrb(f.el, p, { opacity: orbOpacity });
    });
    const root = document.documentElement;
    const bar = scrollCatFly.bar;

    // Cover/uncover must follow scroll rawT — NOT inverted pathT.
    // Reverse bug: pathT≈0 at dishes start → premature uncover → normal menu flash,
    // then pathT rises into expand. Keep covered until nearly landed on hero.
    if (isReverse) {
      // Keep WebGL hidden until orbs have dropped into the hero center —
      // uncovering early showed side plates sliding in from the right edge.
      if (raw > 0.02) {
        root.classList.add('is-cat-fly-covered');
        if (typeof window.__westoHideHeroPlatesForFly === 'function') {
          window.__westoHideHeroPlatesForFly(true);
        }
      } else {
        root.classList.remove('is-cat-fly-covered');
        if (typeof window.__westoHideHeroPlatesForFly === 'function') {
          window.__westoHideHeroPlatesForFly(false);
        }
      }
      // Dish UI off for the entire reverse — orbs own the pixels.
      root.classList.remove('is-dish-boards');
    } else if (pathT > 0.04) {
      root.classList.add('is-cat-fly-covered');
      if (typeof window.__westoHideHeroPlatesForFly === 'function') {
        window.__westoHideHeroPlatesForFly(true);
      }
    } else if (pathT <= 0.02) {
      root.classList.remove('is-cat-fly-covered');
      if (typeof window.__westoHideHeroPlatesForFly === 'function') {
        window.__westoHideHeroPlatesForFly(false);
      }
    }

    if (bar) {
      if (isReverse) {
        // raw=1 (dishes) → bar visible; raw=0 (hero) → bar gone
        setCatFlyBarOpacity(bar, Math.max(0, 0.12 + raw * 0.88));
        bar.classList.toggle('is-revealed', raw > 0.35);
      } else {
        setCatFlyBarOpacity(bar, Math.min(1, 0.15 + pathT * 0.85));
        bar.classList.toggle('is-revealed', pathT > 0.55);
      }
    }
  }

  function readChipFlySeat(bar, _categoryId, slotOffset, navH, chipSize) {
    const activeId =
      lastFilledCategoryId != null ? String(lastFilledCategoryId) : String(activeCategoryId() ?? '');
    const anchor = catBarFlyAnchorSeat(bar, activeId, navH, chipSize);
    const vw = window.innerWidth || 1;
    let cx = anchor.cx + slotOffset * FLOCK_CHIP_PITCH;
    const pad = Math.max(anchor.size * 0.55, 24);
    cx = Math.max(pad, Math.min(vw - pad, cx));
    return {
      cx,
      cy: anchor.cy,
      size: anchor.size,
      opacity: 1,
    };
  }

  function beginScrollCatFly({ reverse = false, progress = 0 } = {}) {
    if (scrollCatFly) {
      if (Boolean(scrollCatFly.reverse) === Boolean(reverse)) return scrollCatFly;
      cancelScrollCatFly({ keepLanded: reverse });
    }
    if (catFlyBusy && !reverse) return null;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduce || typeof window.gsap === 'undefined') return null;

    const list = ensureFlockFive(
      lastFlyManifest.length
        ? lastFlyManifest.map((m) => ({
            categoryId: m.categoryId,
            cover: m.cover,
            cx: m.hero?.cx,
            cy: m.hero?.cy,
            size: m.hero?.size,
            opacity: 1,
          }))
        : buildAllCatFlySources(),
    ).slice(0, prefersSinglePlateFly() ? 1 : 5);
    if (!list.length) return null;

    if (!reverse) scrollFlyLanded = false;
    catFlyBusy = true;
    const root = document.documentElement;
    root.classList.add('is-cat-flying', 'is-cat-scroll-fly');
    if (reverse) {
      // Lock reverse immediately: no dish flash, no WebGL flash before orbs paint.
      root.classList.add('is-cat-fly-covered');
      root.classList.remove('is-dish-boards');
      if (typeof window.__westoHideHeroPlatesForFly === 'function') {
        window.__westoHideHeroPlatesForFly(true);
      }
    }
    if (window.lenis?.isStopped && typeof window.lenis.start === 'function') {
      window.lenis.start();
    }
    document.body.style.overflow = '';

    const bar = rebuildDishCatBar(false);
    bar.hidden = false;
    bar.setAttribute('aria-hidden', 'false');
    if (reverse) {
      bar.classList.add('is-flying-out', 'is-cinema-flock', 'is-revealed');
      bar.classList.remove('is-flying-in');
      setCatFlyBarOpacity(bar, Math.max(0.12, Math.min(1, progress)));
    } else {
      bar.classList.add('is-flying-in', 'is-cinema-flock');
      bar.classList.remove('is-revealed', 'is-flying-out');
      setCatFlyBarOpacity(bar, 0);
    }

    const activeId =
      lastFilledCategoryId != null ? String(lastFilledCategoryId) : String(activeCategoryId() ?? '');
    bar.querySelectorAll('.westo-dish-catbar__chip').forEach((chip) => {
      const on = chip.dataset.categoryId === activeId;
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-current', on ? 'true' : 'false');
    });
    const activeChip = findNearestCatBarChip(bar, activeId) || findCatBarChip(bar, activeId);
    if (activeChip) {
      centerDishCatChip(activeChip, { instant: true, preferNearest: true });
    }
    lockCatBarTrack(bar, true);

    const flyIds = new Set(list.map((s) => String(s.categoryId)));
    bar.querySelectorAll('.westo-dish-catbar__chip').forEach((chip) => {
      const id = String(chip.dataset.categoryId || '');
      const flying = flyIds.has(id);
      chip.classList.toggle('is-fly-seat', flying);
      const icon = chip.querySelector('.westo-dish-catbar__icon');
      const lab = chip.querySelector('.westo-dish-catbar__label');
      if (icon) setCatFlyElementsOpacity([icon], flying ? 0 : 1, { visibility: 'visible' });
      if (lab) setCatFlyElementsOpacity([lab], 0, { visibility: 'hidden' });
    });

    const layer = ensureCatFlyLayer();
    layer.replaceChildren();
    const gsap = getGsap();
    if (gsap) gsap.set(layer, { opacity: 1 });
    else layer.style.opacity = '1';
    layer.classList.add('is-active');

    const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
    const orderIndex = new Map(order.map((id, i) => [String(id), i]));
    const activeOrderIdx = orderIndex.has(activeId) ? orderIndex.get(activeId) : 0;
    const navH =
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--menu-nav-h')) ||
      74;

    const flights = [];
    const manifest = [];
    list.forEach((src) => {
      const coverUrl = String(src.cover || '').trim();
      if (!coverUrl) return;
      const isActive = String(src.categoryId) === activeId;
      const srcIdx = orderIndex.has(String(src.categoryId))
        ? orderIndex.get(String(src.categoryId))
        : 0;
      const slotOffset = flockSlotOffset(srcIdx, activeOrderIdx, order.length);
      const chipSize = 46;

      const el = document.createElement('div');
      el.className = 'westo-cat-fly__orb is-flock';
      el.dataset.categoryId = src.categoryId;
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.decoding = 'sync';
      img.src = readyManagedSrc(coverUrl);
      el.appendChild(img);
      el.classList.toggle('is-active-fly', isActive);
      el.classList.toggle('is-neighbor-fly', !isActive);

      const A = buildFlightHeroTarget(String(src.categoryId), slotOffset);
      // Always provisional rigid seats; retarget locks them to active chip row.
      const B = readChipFlySeat(bar, src.categoryId, slotOffset, navH, chipSize);
      const clampedProgress = Math.max(0, Math.min(1, progress));
      const spawn = sampleStagedFlockPath({ A, B, slotOffset }, clampedProgress, reverse);
      setCatFlyOrb(el, spawn, { opacity: reverse || clampedProgress >= 0.03 ? 1 : 0 });
      el.style.zIndex = String(isActive ? 460 : 430 + srcIdx);
      layer.appendChild(el);
      flights.push({
        el,
        A,
        B,
        isActive,
        categoryId: String(src.categoryId),
        srcIdx,
        slotOffset,
      });
      manifest.push({
        categoryId: String(src.categoryId),
        cover: coverUrl,
        hero: { ...A },
        chip: { cx: B.cx, cy: B.cy, size: B.size },
        isActive,
      });
    });

    if (!flights.length) {
      cancelScrollCatFly();
      return null;
    }

    lastFlyManifest = manifest;
    // Lock B seats to a rigid centered row BEFORE first paint (kills 3+2 split).
    retargetScrollFlyBSeats(bar, flights, activeId, orderIndex);
    flights.forEach((f) => {
      const m = manifest.find((x) => x.categoryId === f.categoryId);
      if (m) m.chip = { cx: f.B.cx, cy: f.B.cy, size: f.B.size };
    });
    scrollCatFly = {
      bar,
      flights,
      activeId,
      layer,
      orderIndex,
      reverse,
      seatsLocked: Boolean(reverse),
    };
    mountScrollFlyGsap(scrollCatFly, reverse ? progress : 0);
    const frameProgress = Math.max(0, Math.min(1, progress));
    applyScrollCatFlyFrame(frameProgress);
    doubleRaf(() => {
      if (!scrollCatFly) return;
      const chip =
        findNearestCatBarChip(bar, activeId) || findCatBarChip(bar, activeId) || activeChip;
      if (chip) centerDishCatChip(chip, { instant: true, preferNearest: true });
      // One refine after layout settle, then lock forever for this fly.
      retargetScrollFlyBSeats(bar, flights, activeId, orderIndex);
      scrollCatFly.seatsLocked = true;
      applyScrollCatFlyFrame(frameProgress);
    });
    return scrollCatFly;
  }

  function updateScrollCatFly(rawT, { reverse = false } = {}) {
    if (scrollCatFly && Boolean(scrollCatFly.reverse) !== Boolean(reverse)) {
      cancelScrollCatFly({ keepLanded: reverse });
    }
    if (!scrollCatFly) beginScrollCatFly({ reverse, progress: rawT });
    if (!scrollCatFly) return;
    scrollCatFly.reverse = Boolean(reverse);
    const pathT = softstep(Math.max(0, Math.min(1, rawT)));
    // Never retarget every frame — that was jittering B seats and splitting the flock.
    if (!scrollCatFly.seatsLocked) {
      retargetScrollFlyBSeats(
        scrollCatFly.bar,
        scrollCatFly.flights,
        scrollCatFly.activeId,
        scrollCatFly.orderIndex,
      );
      scrollCatFly.seatsLocked = true;
    }
    applyScrollCatFlyFrame(rawT);
    const bar = scrollCatFly.bar;
    if (bar && !scrollCatFly.reverse && pathT > 0.5) {
      setCatFlyElementsOpacity(
        [...bar.querySelectorAll('.westo-dish-catbar__label')],
        Math.min(1, (pathT - 0.5) * 2),
        { visibility: 'visible' },
      );
    }
    if (bar && scrollCatFly.reverse && rawT < 0.45) {
      setCatFlyElementsOpacity(
        [...bar.querySelectorAll('.westo-dish-catbar__label')],
        0,
        { visibility: 'hidden' },
      );
    }
  }

  function completeScrollReverseFly() {
    if (!scrollCatFly?.reverse) return false;
    const { bar, layer, activeId } = scrollCatFly;
    // Keep reverse as the sole state owner until Hero has painted underneath
    // the last orb frame.  Previously this flipped catFlyBusy=false here, while
    // updateDishViewportState() was still executing with stale `onDishes=true`,
    // so the same callback could immediately re-add is-dish-boards.
    catFlyBusy = true;
    catFlyReverseGraceUntil = Math.max(catFlyReverseGraceUntil, Date.now() + 260);
    killScrollFlyGsap(scrollCatFly);
    // Final frame at cluster (raw=0) — then hand off to WebGL under orbs.
    applyScrollCatFlyFrame(0);
    scrollFlyLanded = false;
    scrollCatFly = null;
    const root = document.documentElement;
    root.classList.remove(
      'is-dish-boards',
      'is-cat-flying',
      'is-cat-scroll-fly',
      'is-cat-fly-covered',
      'is-cat-fly-media-under',
      'is-cat-fly-handoff',
    );
    // Restore WebGL FIRST (under last orb paint), then clear orbs next tick.
    if (typeof window.__westoHideHeroPlatesForFly === 'function') {
      window.__westoHideHeroPlatesForFly(false);
    }
    if (window.westoRestoreHeroScene) {
      window.westoRestoreHeroScene({ hidden: false });
    }
    try {
      const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
      const idx = order.findIndex((id) => String(id) === String(activeId));
      if (idx >= 0 && window.carousel?.goTo) {
        window.carousel.goTo(idx, { immediate: true });
      }
    } catch (_) {}

    const finish = () => {
      if (window.westoRestoreHeroChrome) {
        window.westoRestoreHeroChrome({ force: true });
      }
      if (layer) {
        layer.classList.remove('is-active');
        layer.replaceChildren();
        const gsap = getGsap();
        if (gsap) gsap.set(layer, { clearProps: 'opacity' });
        else layer.style.opacity = '';
      }
      if (bar) {
        lockCatBarTrack(bar, false);
        bar.classList.remove('is-flying-out', 'is-cinema-flock', 'is-revealed');
        const gsap = getGsap();
        if (gsap) {
          gsap.set(bar, { clearProps: 'opacity' });
          gsap.set(bar.querySelectorAll('.westo-dish-catbar__icon, .westo-dish-catbar__label'), {
            clearProps: 'opacity,visibility',
          });
        } else {
          bar.style.opacity = '';
        }
        bar.hidden = true;
        bar.setAttribute('aria-hidden', 'true');
        bar.querySelectorAll('.westo-dish-catbar__chip').forEach((chip) => {
          chip.classList.remove('is-fly-seat', 'is-fly-landed');
        });
        if (!gsap) {
          bar.querySelectorAll('.westo-dish-catbar__icon, .westo-dish-catbar__label').forEach((el) => {
            el.style.opacity = '';
            el.style.visibility = '';
          });
        }
      }
      if (window.lenis?.isStopped && typeof window.lenis.start === 'function') {
        window.lenis.start();
      }
      document.body.style.overflow = '';
      // Release ownership only after two paints: WebGL/hero chrome is now the
      // stable visual source. Keep a short non-pinning grace for trackpad/touch
      // elastic scroll so a tiny rebound cannot immediately start a forward fly.
      catFlyBusy = false;
      catFlyReverseGraceUntil = Math.max(catFlyReverseGraceUntil, Date.now() + 180);
    };

    doubleRaf(finish);
    return true;
  }

  function completeScrollCatFly(pendingReveal) {
    if (!scrollCatFly || scrollFlyLanded || scrollCatFly.reverse) return;
    scrollFlyLanded = true;
    const { bar, flights, activeId, layer } = scrollCatFly;
    const flyIdSet = new Set(flights.map((f) => f.categoryId));
    retargetScrollFlyBSeats(bar, flights, activeId, scrollCatFly.orderIndex);
    lastFlyManifest = flights.map((f) => ({
      categoryId: f.categoryId,
      cover: f.el?.querySelector('img')?.src || '',
      hero: { ...f.A },
      chip: { cx: f.B.cx, cy: f.B.cy, size: f.B.size },
      isActive: f.isActive,
    }));
    applyScrollCatFlyFrame(1);

    const root = document.documentElement;
    lockCatBarTrack(bar, false);
    bar.classList.remove('is-flying-in');
    bar.classList.add('is-revealed', 'is-cinema-flock');
    setCatFlyBarOpacity(bar, 1);
    // Atomic handoff: keep `is-cat-flying` alive while the dish media is
    // painted underneath the landed orbs.  CSS already has the exact
    // `.is-cat-flying.is-cat-fly-media-under` contract for this; the previous
    // implementation removed `is-cat-flying` immediately, bypassing that
    // handoff and exposing a black frame / full-card flash.
    root.classList.add('is-dish-boards', 'is-cat-flying', 'is-cat-fly-media-under', 'is-cat-fly-handoff');
    root.classList.remove('is-cat-scroll-fly', 'is-cat-fly-covered');

    // Keep transition ownership locked until finishLand() commits the final
    // state.  Scroll/viewport observers must not toggle dish mode mid-handoff.
    catFlyBusy = true;

    if (pendingReveal) revealPendingDishBoard(pendingReveal);

    bar.querySelectorAll('.westo-dish-catbar__chip').forEach((chip) => {
      const id = String(chip.dataset.categoryId || '');
      chip.classList.toggle('is-fly-landed', flyIdSet.has(id));
      chip.classList.remove('is-fly-seat');
    });
    setCatFlyElementsOpacity(
      [...bar.querySelectorAll('.westo-dish-catbar__icon')],
      1,
      { visibility: 'visible' },
    );

    const gsap = getGsap();
    const allLabels = [...bar.querySelectorAll('.westo-dish-catbar__label')];
    const allIcons = [...bar.querySelectorAll('.westo-dish-catbar__icon')];
    const finishLand = () => {
      // Arm the dish chrome fade before releasing the flying lock, then switch
      // all state classes in one synchronous commit. Dish media has already
      // painted under the orbs for at least one frame, so there is no empty
      // visual state between Hero and Dish.
      root.classList.add('is-dish-boards', 'is-cat-fly-dish-in');
      root.classList.remove(
        'is-cat-flying',
        'is-cat-scroll-fly',
        'is-cat-fly-covered',
        'is-cat-fly-media-under',
        'is-cat-fly-handoff',
      );
      scrollCatFly = null;
      scrollFlyLanded = true;
      catFlyBusy = false;
      catFlyLandGraceUntil = Date.now() + 320;
      if (window.lenis?.isStopped && typeof window.lenis.start === 'function') {
        window.lenis.start();
      }
      document.body.style.overflow = '';

      // Keep the covering orbs for one additional paint after the class commit.
      // The underlying media is now guaranteed visible; removing the layer in
      // the following frame prevents both a one-frame hole and double-image pop.
      if (layer) {
        requestAnimationFrame(() => {
          layer.classList.remove('is-active');
          layer.replaceChildren();
          if (gsap) gsap.set(layer, { clearProps: 'opacity' });
          else layer.style.opacity = '';
        });
      }
      bar.classList.remove('is-cinema-flock');
      bar.querySelectorAll('.westo-dish-catbar__chip.is-fly-landed').forEach((c) =>
        c.classList.remove('is-fly-landed'),
      );
      if (gsap) {
        gsap.set([...allIcons, ...allLabels], { clearProps: 'opacity,visibility' });
      } else {
        allIcons.forEach((el) => {
          el.style.opacity = '';
          el.style.visibility = '';
        });
        allLabels.forEach((el) => {
          el.style.opacity = '';
          el.style.visibility = '';
        });
      }
      const settled = findCatBarChip(bar, activeId);
      if (settled) centerDishCatChip(settled, { instant: false });
      syncDishCatBar({ skipReveal: true });
    };

    if (gsap) {
      killScrollFlyGsap(scrollCatFly);
      scrollCatFly.landTween = gsap
        .timeline({
          delay: 0.032,
          onComplete: () => root.classList.remove('is-cat-fly-dish-in'),
        })
        .add(finishLand, 0)
        .to(allLabels, {
          opacity: 1,
          visibility: 'visible',
          duration: 0.32,
          stagger: 0.008,
          ease: 'power2.out',
        }, 0)
        .add(() => root.classList.remove('is-cat-fly-dish-in'), 0.42);
    } else {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          finishLand();
          window.setTimeout(() => root.classList.remove('is-cat-fly-dish-in'), 420);
        });
      });
    }
  }

  function cancelScrollCatFly({ keepLanded = false } = {}) {
    if (!scrollCatFly) return;
    const { bar, layer } = scrollCatFly;
    killScrollFlyGsap(scrollCatFly);
    scrollCatFly = null;
    if (!keepLanded) scrollFlyLanded = false;
    catFlyBusy = false;
    document.documentElement.classList.remove(
      'is-cat-flying',
      'is-cat-scroll-fly',
      'is-cat-fly-covered',
      'is-cat-fly-media-under',
      'is-cat-fly-handoff',
    );
    if (typeof window.__westoHideHeroPlatesForFly === 'function') {
      window.__westoHideHeroPlatesForFly(false);
    }
    if (layer) {
      layer.classList.remove('is-active');
      layer.replaceChildren();
      const gsap = getGsap();
      if (gsap) gsap.set(layer, { clearProps: 'opacity' });
      else layer.style.opacity = '';
    }
    if (bar) {
      lockCatBarTrack(bar, false);
      bar.classList.remove('is-flying-in', 'is-cinema-flock', 'is-revealed');
      const gsap = getGsap();
      if (gsap) {
        gsap.set(bar, { clearProps: 'opacity' });
        gsap.set(bar.querySelectorAll('.westo-dish-catbar__icon, .westo-dish-catbar__label'), {
          clearProps: 'opacity,visibility',
        });
      } else {
        bar.style.opacity = '';
      }
      bar.querySelectorAll('.westo-dish-catbar__chip').forEach((chip) => {
        chip.classList.remove('is-fly-seat', 'is-fly-landed');
      });
      if (!gsap) {
        bar.querySelectorAll('.westo-dish-catbar__icon, .westo-dish-catbar__label').forEach((el) => {
          el.style.opacity = '';
          el.style.visibility = '';
        });
      }
    }
  }

  function revealPendingDishBoard(explicitEl = pendingDishRevealEl) {
    const el = explicitEl;
    if (!explicitEl || explicitEl === pendingDishRevealEl) pendingDishRevealEl = null;
    if (!el || !el.isConnected) return;
    // Force heal while fly lock may still be on — preload src before unlock paint.
    healActiveBoardMedia(el, { force: true });
    const img = el.querySelector('.dish-board-media img');
    const sync = () => syncSharedDishCard(el, { animate: false });
    sync();
    if (img?.decode && img.src && !img.complete) {
      img.decode().then(sync).catch(() => {});
    }
  }

  function commitLeaveDishUiAfterOrbs() {
    if (!pendingLeaveDishUi) return;
    pendingLeaveDishUi = false;
    if (pendingLeaveRaf) {
      cancelAnimationFrame(pendingLeaveRaf);
      pendingLeaveRaf = 0;
    }
    document.documentElement.classList.remove('is-dish-boards');
    if (window.westoRestoreHeroScene) {
      window.westoRestoreHeroScene({ hidden: true });
    }
  }

  // v13.7: active underline is local to the active chip. No floating marker
  // needs per-scroll geometry reads, so indicator scheduling is intentionally
  // zero-work. This removes duplicate getBoundingClientRect loops from scroll.
  function updateDishCatBarIndicator() {}
  function scheduleDishCatBarIndicator() {}

  function syncDishCatBar(opts = {}) {
    const bar = rebuildDishCatBar(false);
    if (!bar) return;
    ensureCatBarTrackInteractive(bar);
    const onDishes = document.documentElement.classList.contains('is-dish-boards');
    const activeId =
      lastFilledCategoryId != null ? String(lastFilledCategoryId) : String(activeCategoryId() ?? '');
    const wasHidden = bar.hidden;
    if (opts.forceHide != null) {
      bar.hidden = Boolean(opts.forceHide);
    } else if (catFlyBusy) {
      // Keep the strip mounted while orbs fly (especially reverse after leave).
      bar.hidden = false;
    } else {
      bar.hidden = !onDishes;
    }
    bar.setAttribute('aria-hidden', bar.hidden ? 'true' : 'false');
    bar.setAttribute('aria-label', tr('nav.categories') || 'دسته‌ها');
    syncDishSubBar(activeId, activeViewportSlot < 0 ? 0 : activeViewportSlot, {
      forceHide: bar.hidden || catFlyBusy || document.documentElement.classList.contains('is-cat-flying'),
    });
    if (!onDishes && !catFlyBusy) {
      bar.classList.remove('is-flying-in', 'is-revealed', 'is-flying-out');
      return;
    }
    if (catFlyBusy || opts.skipReveal || bar.classList.contains('is-flying-in')) {
      // Active state only — fly tween owns reveal.
      bar.querySelectorAll('.westo-dish-catbar__chip').forEach((chip) => {
        const on = chip.dataset.categoryId === activeId;
        chip.classList.toggle('is-active', on);
        chip.setAttribute('aria-current', on ? 'true' : 'false');
      });
      syncCatBarA11y(bar, activeId);
      const activeChip = findNearestCatBarChip(bar, activeId) || findCatBarChip(bar, activeId);
      if (activeChip && !opts.skipCenter && !isCatBarUserScrubbing()) {
        centerDishCatChip(activeChip, { instant: true, preferNearest: true });
      } else if (activeChip) {
        settleDishCatNeighbors(activeChip);
      }
      scheduleDishCatBarIndicator(bar, activeId);
      return;
    }

    // Re-play entrance when the strip first appears on dish boards.
    if (wasHidden && onDishes) {
      bar.classList.remove('is-revealed');
      // Do not force style/layout with offsetWidth to restart CSS animations.
      // A frame boundary is enough to create a new transition state.
      requestAnimationFrame(() => bar.isConnected && bar.classList.add('is-revealed'));
    }

    bar.querySelectorAll('.westo-dish-catbar__chip').forEach((chip) => {
      const on = chip.dataset.categoryId === activeId;
      const wasOn = chip.classList.contains('is-active');
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-current', on ? 'true' : 'false');
      // Active styling is transition-driven. The old animation restart used a
      // synchronous offsetWidth read and forced layout on every category tap.
    });
    syncCatBarA11y(bar, activeId);
    const activeChip = findNearestCatBarChip(bar, activeId) || findCatBarChip(bar, activeId);
    if (activeChip && !isCatBarUserScrubbing()) {
      centerDishCatChip(activeChip, {
        instant: Boolean(wasHidden || opts.instantCenter),
        preferNearest: true,
      });
    } else if (activeChip) {
      settleDishCatNeighbors(activeChip);
    }
    scheduleDishCatBarIndicator(bar, activeId);
  }

  function selectDishCategory(categoryId, index, opts = {}) {
    const root = document.documentElement;
    const stableDishMode = root.classList.contains('is-dish-boards') && !root.classList.contains('is-cat-flying');
    if (categoryId == null || (!stableDishMode && isForcingHeroReturn())) return;
    if (stableDishMode) recoverStableDishInteractionState();
    const mode = opts.mode || 'click';
    const wasOnDishes = root.classList.contains('is-dish-boards') || scrollFlyLanded;    // #endregion
    clearCatBarBrowsing();
    resourceScheduler()?.focusCategory?.(categoryId, { reason: mode, slot: 0 });
    if (window.carousel && typeof window.carousel.goTo === 'function') {
      // The Three carousel is hidden in dish mode. Snap its logical index so a
      // long category jump cannot emit intermediate indexes while layout is
      // rebuilding (that race previously remapped boards and returned to hero).
      window.carousel.goTo(index, { immediate: wasOnDishes });
    }
    fillBoards(categoryId);
    // Every category control inside dish mode owns a logical menu change, not a
    // page navigation. Keep the scroll anchor hard-pinned across the refresh
    // frame; the dish crossfade supplies the visual transition.
    if (wasOnDishes || mode === 'step') {
      pinScrollToDishBoards({ immediate: true });
      catStepGuardUntil = Math.max(catStepGuardUntil, Date.now() + 1100);
      requestAnimationFrame(() => {
        refreshDishBoardsCache();
        pinScrollToDishBoards({ immediate: true });
      });
    } else {
      const boards = dishBoardsCache?.length ? dishBoardsCache : refreshDishBoardsCache();
      const first = boards[0];
      if (first) {
        if (window.lenis) {
          window.lenis.scrollTo(first, { offset: 0, duration: 0.55 });
        } else {
          first.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }
    syncDishCatBar({ skipReveal: mode === 'step', skipCenter: true });
    requestAnimationFrame(() => {
      const bar = $('#westo-dish-catbar');
      if (!bar) return;
      const chip = findNearestCatBarChip(bar, categoryId);
      if (!chip) return;
      centerDishCatChip(chip, {
        instant: false,
        duration: mode === 'step' ? 0.28 : 0.32,
        ease: 'power3.out',
        preferNearest: true,
      });
    });
  }

  // Public bridge for promo/story cards and other internal deep links. It reuses
  // the authoritative category state machine instead of creating a second menu
  // navigation path. Dish targeting resolves category + logical slot first, then
  // scrolls only after the category DOM has committed.
  window.westoOpenMenuTarget = (target = {}) => {
    let categoryId = Number(target.categoryId);
    let slot = Number.isFinite(Number(target.slot)) ? Math.max(0, Number(target.slot)) : 0;
    const dishId = Number(target.dishId);

    if (Number.isFinite(dishId)) {
      let found = null;
      for (const [rawCategoryId, items] of Object.entries(menuByCategory || {})) {
        const index = (items || []).findIndex((item) => Number(item?.id) === dishId);
        if (index >= 0) {
          found = { categoryId: Number(rawCategoryId), slot: index };
          break;
        }
      }
      if (!found) return false;
      categoryId = found.categoryId;
      slot = found.slot;
    }

    if (!Number.isFinite(categoryId)) return false;
    const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
    const categoryIndex = (order || []).findIndex((id) => Number(id) === categoryId);
    if (categoryIndex < 0) return false;

    selectDishCategory(categoryId, categoryIndex, { mode: 'promo' });
    if (Number.isFinite(dishId) || slot > 0) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollToDishSlot(slot));
      });
    }
    return true;
  };

  // Document capture: survives navbar remounts and beats competing chip handlers.
  {
    let lastBackAt = 0;
    document.addEventListener(
      'click',
      (e) => {
        const btn = e.target?.closest?.('#westo-back-categories');
        if (!btn) return;
        const now = Date.now();
        if (now - lastBackAt < 350) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        lastBackAt = now;
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        try {
          goToCategories();
        } catch (err) {
          console.error('[westo] goToCategories failed', err);
        }
      },
      true,
    );
    try {
      window.westoGoToCategories = goToCategories;
    } catch (_) {}
  }
  // Keep back-btn + category strip in sync with dish-board state
  {
    let classSyncRaf = 0;
    const mo = new MutationObserver(() => {
      if (classSyncRaf) return;
      classSyncRaf = requestAnimationFrame(() => {
        classSyncRaf = 0;
        syncBackCategoriesBtn();
        syncDishCatBar();
      });
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    syncBackCategoriesBtn();
    syncDishCatBar();
  }

  // Prefer sushi boards on first paint (category 3) until carousel reports.
  updateBadge();
  renderCart();
  paintTableChrome();
  loadMenu();
  bindCarousel();
  skipProfileForMenuStory();

  document.addEventListener('westo:langchange', () => {
    paintTableChrome();
    renderCart();
    try {
      fillBoards(activeCategoryId());
    } catch (_) {}
    rebuildDishCatBar(true);
    syncDishCatBar();
  });

  document.addEventListener('westo:menu-ready', () => {
    try {
      const store = window.westoMenuStore;
      if (store?.byCategory) menuByCategory = store.byCategory;
      if (store?.categoryOrder?.length) categoryOrder = store.categoryOrder.slice();
    } catch (_) {}
    rebuildDishCatBar(true);
    syncDishCatBar({ instantCenter: true });
  });

  document.addEventListener('westo:cartchange', () => {
    cart = loadCart();
    updateBadge();
    renderCart();
  });

  window.westoCatbarDiagnostics = () => {
    const bar = document.getElementById('westo-dish-catbar');
    const track = bar?.querySelector('.westo-dish-catbar__track');
    const style = bar ? getComputedStyle(bar) : null;
    return {
      chips: bar?.querySelectorAll('.westo-dish-catbar__chip').length || 0,
      images: bar?.querySelectorAll('.westo-dish-catbar__thumb').length || 0,
      loopCopies: Number(track?.dataset.loopCopies || 0),
      infinite: Boolean(track?.classList.contains('is-infinite')),
      backdropFilter: style?.backdropFilter || style?.webkitBackdropFilter || 'none',
      width: bar?.getBoundingClientRect().width || 0,
    };
  };
})();
