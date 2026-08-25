/* WESTO Production UI v12 — presentation bridge only.
   Existing menu/cart/WebGL/scroll state machines remain authoritative. */
(function () {
  'use strict';
  if (window.__WESTO_PRODUCTION_V12__) return;
  window.__WESTO_PRODUCTION_V12__ = true;

  const root = document.documentElement;
  root.classList.add('westo-production-v12');
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const EN = {
    7560:'SALADS',7561:'APPETIZERS',17007:'TACOS',7562:'PASTA',7563:'BURGERS',7564:'MAINS',
    7566:'PIZZA',7567:'VEGETARIAN',7599:'COLD BAR',14477:'MATCHA BAR',7675:'CAFFEINE',
    7701:'NON CAFFEINE',7676:'HERBAL TEA',7697:'PASTRY',9478:'SPECIAL SERVICE',13581:'SUSHI'
  };
  const AR = {
    7560:'سلطة',7561:'مقبلات',17007:'تاكو',7562:'باستا',7563:'برغر',7564:'أطباق رئيسية',
    7566:'بيتزا',7567:'نباتي',7599:'بار بارد',14477:'ماتشا',7675:'كافيين',7701:'بدون كافيين',
    7676:'شاي أعشاب',7697:'معجنات',9478:'خدمة خاصة',13581:'سوشي'
  };
  const DESC_EN = {
    7560:'Fresh, bright and balanced.',7561:'Small plates made for sharing.',17007:'Bold fillings, soft tortillas and fresh finishes.',7562:'Comforting pasta with WESTO character.',7563:'Juicy burgers built with generous layers.',7564:'Signature mains for a complete meal.',7566:'Crisp-edged pizza with balanced toppings.',7567:'Plant-forward dishes with full flavor.',7599:'Cold, refreshing drinks and house blends.',14477:'Matcha prepared smooth, clean and vivid.',7675:'Coffee and caffeine-led favorites.',7701:'Calm, caffeine-free drinks for any hour.',7676:'Aromatic herbal infusions served with care.',7697:'Pastries and sweet bites for the table.',9478:'Limited WESTO specials and seasonal service.',13581:'Fresh sushi with clean, precise flavors.'
  };
  const DESC_AR = {
    7560:'طازجة ومشرقة ومتوازنة.',7561:'أطباق صغيرة مثالية للمشاركة.',17007:'حشوات غنية وتورتيلا طرية ولمسات منعشة.',7562:'باستا مريحة بروح WESTO.',7563:'برغر غني بطبقات سخية.',7564:'أطباق رئيسية مميزة لوجبة متكاملة.',7566:'بيتزا بحواف مقرمشة وإضافات متوازنة.',7567:'أطباق نباتية بنكهة كاملة.',7599:'مشروبات باردة ومنعشة وخلطات خاصة.',14477:'ماتشا ناعمة ونقية وحيوية.',7675:'قهوة ومشروبات مفضلة بالكافيين.',7701:'مشروبات هادئة بلا كافيين لأي وقت.',7676:'منقوعات عشبية عطرية محضّرة بعناية.',7697:'معجنات ولقيمات حلوة للمشاركة.',9478:'اختيارات WESTO المحدودة والموسمية.',13581:'سوشي طازج بنكهات نظيفة ودقيقة.'
  };

  let heroCopy = null;
  let heroTitle = null;
  let heroKicker = null;
  let heroDesc = null;
  let heroScrollCopy = null;
  let heroRail = null;
  let heroCats = null;
  let carouselBound = false;
  let pending = 0;
  let lastId = null;

  function store() { return window.westoMenuStore || null; }
  function categories() {
    const s = store();
    if (Array.isArray(s?.categories) && s.categories.length) return s.categories.filter(Boolean);
    const boot = window.__WESTO_CONTENT__?.menu;
    const fallback = Array.isArray(boot?.siteCategories) && boot.siteCategories.length
      ? boot.siteCategories
      : Array.isArray(boot?.menuCategories) ? boot.menuCategories.filter(c => !c?.hiddenOnSite) : [];
    return fallback.filter(Boolean);
  }
  function order() {
    const ids = window.__westoCategoryOrder;
    return Array.isArray(ids) && ids.length ? ids.map(Number) : categories().map(c => Number(c.id));
  }
  function currentId() {
    const attr = Number(root.dataset.catId);
    if (Number.isFinite(attr)) return attr;
    const ids = order();
    if (!ids.length) return null;
    try {
      const i = Number(window.carousel?.getIndex?.(true));
      if (Number.isFinite(i)) return ids[(i % ids.length + ids.length) % ids.length];
    } catch (_) {}
    const i = Number(window.carousel?.index);
    if (Number.isFinite(i)) return ids[(i % ids.length + ids.length) % ids.length];
    return ids[0];
  }
  function lang() { return String(root.lang || 'fa').toLowerCase(); }
  function catLabel(c) {
    if (!c) return '';
    if (lang() === 'en') return EN[Number(c.id)] || c.title || c.name1 || '';
    if (lang() === 'ar') return AR[Number(c.id)] || c.title || c.name1 || '';
    return c.title || c.name1 || '';
  }
  function catDesc(c) {
    if (!c) return '';
    if (lang() === 'en') return DESC_EN[Number(c.id)] || String(c?.shortDesc || c?.longDesc || '');
    if (lang() === 'ar') return DESC_AR[Number(c.id)] || String(c?.shortDesc || c?.longDesc || '');
    return String(c?.shortDesc || c?.longDesc || '');
  }
  function categoryCover(c) { return String(c?.coverImg || '').trim(); }
  function escapeHtml(v) { return String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }

  function mountHeroCopy() {
    if (heroCopy?.isConnected) return true;
    const host = $('#gamme .gamme_container .max-width-medium') || $('#gamme .gamme_container');
    if (!host) return false;
    heroCopy = document.createElement('div');
    heroCopy.className = 'westo-v12-hero-copy';
    heroCopy.setAttribute('aria-live', 'polite');
    heroCopy.innerHTML = `
      <div class="westo-v12-hero-kicker"></div>
      <h2 class="westo-v12-hero-title"></h2>
      <p class="westo-v12-hero-desc"></p>
      <div class="westo-v12-hero-rail" role="toolbar" aria-label="دسترسی سریع به دسته‌ها"></div>`;
    host.appendChild(heroCopy);
    heroKicker = $('.westo-v12-hero-kicker', heroCopy);
    heroTitle = $('.westo-v12-hero-title', heroCopy);
    heroDesc = $('.westo-v12-hero-desc', heroCopy);
    // Keep a single canonical scroll instruction. The legacy .scroll_discover
    // is the original WESTO copy; adopt that exact node into the v12 hero copy
    // instead of rendering a second duplicate hint below the category content.
    heroScrollCopy = $('.scroll_discover');
    if (heroScrollCopy && heroDesc) {
      heroScrollCopy.classList.add('westo-v12-hero-scroll-copy');
      heroDesc.insertAdjacentElement('afterend', heroScrollCopy);
    }
    heroRail = $('.westo-v12-hero-rail', heroCopy);
    if (heroRail && heroRail.dataset.bound !== '1') {
      heroRail.dataset.bound = '1';
      heroRail.addEventListener('click', onRailClick);
      heroRail.addEventListener('keydown', onRailKeydown);
    }
    if (!heroCats || !heroCats.isConnected) {
      heroCats = document.createElement('nav');
      heroCats.className = 'westo-prod-hero-cats';
      heroCats.setAttribute('aria-label', 'دسته‌بندی‌ها');
      heroCats.setAttribute('role', 'toolbar');
      host.appendChild(heroCats);
      heroCats.addEventListener('click', onHeroCategoryClick);
      heroCats.addEventListener('keydown', onHeroCategoryKeydown);
    }
    return true;
  }

  function escapeAttr(v) { return escapeHtml(v).replace(/`/g,'&#96;'); }

  function buildHeroCategories() {
    if (!mountHeroCopy() || !heroCats) return;
    const cats = categories();
    const ids = order();
    if (!cats.length || !ids.length) return;
    const signature = `${lang()}|` + ids.map(id => {
      const c = cats.find(x => Number(x.id) === Number(id));
      return c ? `${c.id}:${c.coverImg || ''}:${c.title || c.name1 || ''}` : String(id);
    }).join('|');
    if (heroCats.dataset.signature === signature) return;
    heroCats.dataset.signature = signature;
    heroCats.innerHTML = ids.map((id,index) => {
      const c = cats.find(x => Number(x.id) === Number(id));
      if (!c) return '';
      return `<button class="westo-prod-hero-cat" type="button" data-category-id="${Number(id)}" data-index="${index}" aria-label="${escapeAttr(catLabel(c))}" tabindex="${Number(id) === Number(currentId()) ? 0 : -1}"><img src="${escapeAttr(categoryCover(c))}" alt="" width="48" height="48" loading="${index < 3 ? 'eager' : 'lazy'}" decoding="async"><span>${escapeHtml(catLabel(c))}</span></button>`;
    }).join('');
  }

  function activateHeroCategory(index, id, { focusSource = null } = {}) {
    if (!Number.isFinite(Number(index)) || !Number.isFinite(Number(id))) return false;
    try {
      if (window.carousel?.goTo) {
        window.carousel.goTo(Number(index));
        // Programmatic category navigation must wake an idle WebGL render loop.
        window.westoRenderWake?.();
      } else {
        window.westoCategoryTheme?.apply?.(Number(id));
      }
    } catch (_) {}
    schedule(Number(id), true);
    if (focusSource?.focus) {
      try { focusSource.focus({ preventScroll: true }); } catch (_) {}
    }
    return true;
  }

  function onHeroCategoryClick(e) {
    const b = e.target.closest('.westo-prod-hero-cat[data-index]');
    if (!b) return;
    const index = Number(b.dataset.index);
    const id = Number(b.dataset.categoryId);
    if (!Number.isFinite(index) || !Number.isFinite(id)) return;
    e.preventDefault();
    e.stopPropagation();
    activateHeroCategory(index, id);
  }

  // Direct category chrome must remain interactive even if a horizontal
  // scroller suppresses the synthetic click or the Three gesture listener is
  // running on window. Pointer-up is the authoritative touch path; movement
  // over 10px stays a native pan instead of becoming an accidental selection.
  if (!root.dataset.westoHeroDirectNavBound) {
    root.dataset.westoHeroDirectNavBound = '1';
    let navPointer = null;
    let suppressClickUntil = 0;
    const isHeroInteractive = () =>
      !root.classList.contains('is-dish-boards') && !root.classList.contains('is-cat-flying');
    const activateFromEvent = (e, fromPointer = false) => {
      if (!isHeroInteractive()) return false;
      const cat = e.target?.closest?.('.westo-prod-hero-cat[data-index]');
      const rail = e.target?.closest?.('.westo-v12-hero-rail');
      if (!cat && (!rail || !heroRail)) return false;
      if (fromPointer && navPointer) {
        const dx = Number(e.clientX || 0) - navPointer.x;
        const dy = Number(e.clientY || 0) - navPointer.y;
        if (Math.hypot(dx, dy) > 10) return false;
      }
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      if (cat) {
        const index = Number(cat.dataset.index);
        const id = Number(cat.dataset.categoryId);
        if (!Number.isFinite(index) || !Number.isFinite(id)) return false;
        activateHeroCategory(index, id);
      } else {
        onRailClick(e);
      }
      suppressClickUntil = Date.now() + 450;
      return true;
    };
    document.addEventListener('pointerdown', (e) => {
      if (!isHeroInteractive()) { navPointer = null; return; }
      const target = e.target?.closest?.('.westo-prod-hero-cat[data-index], .westo-v12-hero-rail');
      if (!target || (e.pointerType === 'mouse' && e.button !== 0)) { navPointer = null; return; }
      navPointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }, true);
    document.addEventListener('pointerup', (e) => {
      if (!navPointer || navPointer.id !== e.pointerId) return;
      activateFromEvent(e, true);
      navPointer = null;
    }, true);
    document.addEventListener('pointercancel', () => { navPointer = null; }, true);
    document.addEventListener('click', (e) => {
      const target = e.target?.closest?.('.westo-prod-hero-cat[data-index], .westo-v12-hero-rail');
      if (!target) return;
      if (Date.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        return;
      }
      activateFromEvent(e, false);
    }, true);
  }

  function onHeroCategoryKeydown(e) {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
    const buttons = $$('.westo-prod-hero-cat', heroCats);
    if (!buttons.length) return;
    const currentButton = e.target.closest('.westo-prod-hero-cat');
    let index = Math.max(0, buttons.indexOf(currentButton));
    if (e.key === 'Home') index = 0;
    else if (e.key === 'End') index = buttons.length - 1;
    else if (e.key === 'ArrowRight') index = (index + 1) % buttons.length;
    else index = (index - 1 + buttons.length) % buttons.length;
    e.preventDefault();
    const next = buttons[index];
    next?.focus({ preventScroll: true });
    next?.click();
  }

  function buildRail() {
    if (!mountHeroCopy()) return;
    buildHeroCategories();
    const ids = order();
    const sig = `${lang()}|${ids.join(',')}`;
    if (heroRail.dataset.signature === sig) return;
    heroRail.dataset.signature = sig;
    heroRail.style.gridTemplateColumns = `repeat(${Math.max(1, ids.length)},1fr)`;
    const cats = categories();
    const activeId = Number(currentId());
    heroRail.innerHTML = ids.map((id, i) => {
      const c = cats.find(x => Number(x.id) === Number(id));
      const label = catLabel(c) || `Category ${i + 1}`;
      const on = Number(id) === activeId;
      return `<button class="westo-v12-hero-dot${on ? ' is-active' : ''}" type="button" data-v12-cat-index="${i}" data-v12-cat-id="${Number(id)}" aria-label="${escapeAttr(label)}" aria-current="${on ? 'true' : 'false'}" tabindex="${on ? '0' : '-1'}"></button>`;
    }).join('');
  }

  function onRailClick(e) {
    let b = e.target.closest('.westo-v12-hero-dot[data-v12-cat-index]');
    let index = b ? Number(b.dataset.v12CatIndex) : NaN;
    let id = b ? Number(b.dataset.v12CatId) : NaN;
    if (!b && heroRail) {
      // The whole progress line is a scrub target, not only the 5px visual dots.
      const ids = order();
      const rect = heroRail.getBoundingClientRect();
      if (ids.length && rect.width > 0) {
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        index = Math.round(ratio * (ids.length - 1));
        id = Number(ids[index]);
      }
    }
    if (!Number.isFinite(index) || !Number.isFinite(id)) return;
    e.preventDefault();
    e.stopPropagation();
    activateHeroCategory(index, id);
  }

  function onRailKeydown(e) {
    if (!['ArrowLeft','ArrowRight','Home','End','Enter',' '].includes(e.key)) return;
    const dots = $$('.westo-v12-hero-dot', heroRail);
    if (!dots.length) return;
    const current = e.target.closest('.westo-v12-hero-dot');
    let index = Math.max(0, dots.indexOf(current));
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      current?.click();
      return;
    }
    if (e.key === 'Home') index = 0;
    else if (e.key === 'End') index = dots.length - 1;
    else if (e.key === 'ArrowRight') index = (index + 1) % dots.length;
    else index = (index - 1 + dots.length) % dots.length;
    e.preventDefault();
    dots[index]?.focus({ preventScroll: true });
    dots[index]?.click();
  }

  function render(id = currentId(), { animate = false } = {}) {
    if (!Number.isFinite(Number(id))) return;
    if (!mountHeroCopy()) return;
    buildRail();
    const cats = categories();
    const ids = order();
    const c = cats.find(x => Number(x.id) === Number(id));
    if (!c) return;
    const idx = Math.max(0, ids.findIndex(x => Number(x) === Number(id)));
    lastId = Number(id);
    applyAtmosphereTheme(lastId);
    if (animate && heroCopy) heroCopy.classList.add('is-changing');
    const doPaint = () => {
      if (heroKicker) heroKicker.textContent = `${String(idx + 1).padStart(2,'0')} / ${String(ids.length).padStart(2,'0')} · ${EN[Number(id)] || ''}`;
      if (heroTitle) heroTitle.textContent = catLabel(c);
      if (heroDesc) heroDesc.textContent = catDesc(c);
      if (heroRail) $$('.westo-v12-hero-dot', heroRail).forEach((d, i) => {
        const on = i === idx;
        d.classList.toggle('is-active', on);
        d.setAttribute('aria-current', on ? 'true' : 'false');
        d.tabIndex = on ? 0 : -1;
      });
      if (heroScrollCopy) heroScrollCopy.textContent = lang() === 'en' ? 'Scroll to explore dishes' : lang() === 'ar' ? 'مرّر لرؤية الأطباق' : 'برای دیدن غذاها اسکرول کنید';
      syncHeroStrip(id);
      requestAnimationFrame(() => heroCopy?.classList.remove('is-changing'));
    };
    if (animate) setTimeout(doPaint, 90); else doPaint();
  }

  function syncHeroStrip(id) {
    buildHeroCategories();
    const strip = heroCats || $('.westo-prod-hero-cats');
    if (!strip) return;
    strip.setAttribute('aria-label', lang() === 'en' ? 'Categories' : lang() === 'ar' ? 'الفئات' : 'دسته‌بندی‌ها');
    if (heroRail) heroRail.setAttribute('aria-label', lang() === 'en' ? 'Quick category navigation' : lang() === 'ar' ? 'تنقل سريع بين الفئات' : 'دسترسی سریع به دسته‌ها');
    const buttons = $$('.westo-prod-hero-cat', strip);
    buttons.forEach(b => {
      const on = Number(b.dataset.categoryId) === Number(id);
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-current', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    const active = buttons.find(b => Number(b.dataset.categoryId) === Number(id));
    if (active && !root.classList.contains('is-dish-boards') && !root.classList.contains('is-cat-flying')) {
      requestAnimationFrame(() => {
        try {
          const sr = strip.getBoundingClientRect();
          const ar = active.getBoundingClientRect();
          const outside = ar.left < sr.left + 8 || ar.right > sr.right - 8;
          if (outside) active.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', inline:'center', block:'nearest' });
        } catch (_) {}
      });
    }
  }


  function applyAtmosphereTheme(id) {
    const t = window.westoCategoryTheme?.get?.(Number(id));
    if (!t) return;
    const vars = {
      '--cat-wash':t.wash,'--cat-surface':t.surface,'--cat-accent':t.accent,
      '--cat-accent-soft':t.accentSoft,'--cat-glow':t.glow,
    };
    Object.entries(vars).forEach(([name,value]) => {
      if (value && root.style.getPropertyValue(name) !== value) root.style.setProperty(name,value);
    });
  }

  function syncAdminPattern() {
    const configured = String(window.__WESTO_CONTENT__?.content?.['entrance.pattern'] || '').trim();
    if (!configured) return;
    root.style.setProperty('--prod-cta-pattern', `url("${configured.replace(/"/g,'\\"')}")`);
    deriveMicroPattern(configured).then(dataUrl => {
      if (dataUrl) root.style.setProperty('--prod-pattern-micro', `url("${dataUrl}")`);
    }).catch(() => {});
  }

  function deriveMicroPattern(src) {
    return new Promise(resolve => {
      const img = new Image();
      img.decoding='async';
      img.onload=() => {
        try {
          const sample=document.createElement('canvas'); sample.width=sample.height=64;
          const sctx=sample.getContext('2d',{willReadFrequently:true}); if(!sctx) return resolve('');
          const sw=img.naturalWidth||img.width, sh=img.naturalHeight||img.height;
          const side=Math.max(1,Math.min(sw,sh)*.33), sx=Math.max(0,sw*.50-side*.5), sy=Math.max(0,sh*.24-side*.5);
          sctx.drawImage(img,sx,sy,side,side,0,0,64,64);
          const data=sctx.getImageData(0,0,64,64);
          const out=document.createElement('canvas');out.width=out.height=10;
          const octx=out.getContext('2d');if(!octx)return resolve('');
          const tiny=octx.createImageData(10,10);
          for(let ty=0;ty<10;ty+=1){for(let tx=0;tx<10;tx+=1){
            let energy=0,count=0;const x0=Math.floor(tx/10*63),x1=Math.max(x0+1,Math.floor((tx+1)/10*63));const y0=Math.floor(ty/10*63),y1=Math.max(y0+1,Math.floor((ty+1)/10*63));
            for(let y=y0;y<y1;y+=2){for(let x=x0;x<x1;x+=2){const i=(y*64+x)*4,j=(y*64+Math.min(63,x+1))*4,k=(Math.min(63,y+1)*64+x)*4;const l=(data.data[i]+data.data[i+1]+data.data[i+2])/3,r=(data.data[j]+data.data[j+1]+data.data[j+2])/3,d=(data.data[k]+data.data[k+1]+data.data[k+2])/3;energy+=Math.abs(l-r)+Math.abs(l-d);count+=2;}}
            const a=Math.max(0,Math.min(255,Math.round((energy/Math.max(1,count)-7)*5.4))),oi=(ty*10+tx)*4;tiny.data[oi]=48;tiny.data[oi+1]=220;tiny.data[oi+2]=228;tiny.data[oi+3]=a;
          }}
          octx.putImageData(tiny,0,0);resolve(out.toDataURL('image/png'));
        } catch(_) { resolve(''); }
      };
      img.onerror=()=>resolve(''); img.src=src;
    });
  }

  function bindCarousel() {
    if (carouselBound || !window.carousel?.changed?.connect) return false;
    try {
      window.carousel.changed.connect(({ index }) => {
        const ids = order(); if (!ids.length) return;
        const i = ((Number(index) || 0) % ids.length + ids.length) % ids.length;
        schedule(ids[i], true);
      });
      carouselBound = true;
      return true;
    } catch (_) { return false; }
  }

  function schedule(id, animate = false) {
    if (pending) cancelAnimationFrame(pending);
    const requested = Number(id);
    const nextId = Number.isFinite(requested) ? requested : currentId();
    pending = requestAnimationFrame(() => { pending = 0; render(nextId, { animate }); });
  }

  /* Geometry auditor exposed for QA. It never mutates layout. */
  function rect(sel) {
    const el = $(sel); if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1), right:+r.right.toFixed(1), bottom:+r.bottom.toFixed(1) };
  }
  function intersects(a,b,tolerance=0) {
    if (!a || !b) return false;
    return !(a.right <= b.x + tolerance || b.right <= a.x + tolerance || a.bottom <= b.y + tolerance || b.bottom <= a.y + tolerance);
  }
  function audit() {
    const issues = [];
    const vw = innerWidth, vh = innerHeight;
    const sw = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
    if (sw > vw + 2) issues.push({ code:'horizontal-overflow', value:sw-vw });
    if (!$('#westo-entrance')?.hidden) {
      const status=rect('.eg-status'), exp=rect('.eg-experience'), cta=rect('.eg-cta-wrap'), foot=rect('.eg-foot'), card=rect('.eg-card');
      if (intersects(status, exp, -2)) issues.push({ code:'entrance-status-experience-overlap', status, exp });
      if (intersects(exp, cta, -2)) issues.push({ code:'entrance-experience-cta-overlap', exp, cta });
      if (intersects(cta, foot, -2)) issues.push({ code:'entrance-cta-footer-overlap', cta, foot });
      if (card && card.bottom > vh + 1) issues.push({ code:'entrance-card-outside-viewport', card, vh });
    }
    if (!root.classList.contains('is-dish-boards') && $('#westo-entrance')?.hidden) {
      const copy=rect('.westo-v12-hero-copy'), dock=rect('.westo-prod-hero-cats');
      if (intersects(copy,dock,-2)) issues.push({code:'hero-copy-dock-overlap',copy,dock});
      if (dock && (dock.x < -1 || dock.right > vw + 1)) issues.push({code:'hero-dock-overflow',dock,vw});
      if (copy && copy.bottom > vh - 2) issues.push({code:'hero-copy-outside-viewport',copy,vh});
    }
    if (root.classList.contains('is-dish-boards')) {
      const card=rect('#westo-dish-card'), rail=rect('.benefits_nav.is-menu-rail'), bar=rect('.westo-dish-catbar'), media=rect('section.is-benefits .dish-board-media');
      if (intersects(card, rail, -2)) issues.push({ code:'dish-card-rail-overlap', card, rail });
      if (intersects(card, media, -2) && vw < 992) issues.push({ code:'dish-card-media-overlap', card, media });
      if (bar && (bar.x < -1 || bar.right > vw + 1)) issues.push({ code:'catbar-overflow', bar, vw });
      if (card && (card.x < -1 || card.right > vw + 1 || card.bottom > vh + 1)) issues.push({code:'dish-card-outside-viewport',card,vw,vh});
    }
    return { ok:!issues.length, viewport:{w:vw,h:vh}, issues };
  }

  function onReady() {
    mountHeroCopy();
    buildRail();
    buildHeroCategories();
    syncAdminPattern();
    schedule();
    bindCarousel();
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1; bindCarousel(); mountHeroCopy(); buildRail(); buildHeroCategories(); schedule();
      if ((carouselBound && categories().length) || tries > 80) clearInterval(timer);
    }, 125);
  }

  window.addEventListener('westo:category-theme', e => { const id=Number(e?.detail?.id); if(Number.isFinite(id)){ applyAtmosphereTheme(id); schedule(id,true); } });
  window.addEventListener('westo:dish-focus', e => { const id=Number(e?.detail?.categoryId); if(Number.isFinite(id)) lastId=id; });
  window.addEventListener('westo:theme-change', () => schedule(lastId || currentId()));
  document.addEventListener('westo:menu-ready', () => { buildRail(); schedule(); });
  document.addEventListener('westo:langchange', () => { if (heroCats) delete heroCats.dataset.signature; if (heroRail) delete heroRail.dataset.signature; buildRail(); buildHeroCategories(); schedule(lastId || currentId()); });
  const classObserver = new MutationObserver(() => {
    if (!root.classList.contains('is-dish-boards')) schedule(currentId());
  });
  classObserver.observe(root, { attributes:true, attributeFilter:['class','lang','dir','data-cat-id'] });

  window.westoV12QA = { audit, render:() => render(currentId()), version:'12.8.0' };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once:true }); else onReady();
})();
