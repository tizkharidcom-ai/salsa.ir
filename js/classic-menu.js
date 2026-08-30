/* Classic menu — Majnoon-inspired UI, Westo data & cart. fa | en | ar */
(function () {
  const STORAGE_KEY = 'westo_table';
  const $ = (s, r) => (r || document).querySelector(s);
  const i18n = () => window.westoI18n;

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
    );
  }

  function lang() {
    return i18n()?.lang || 'fa';
  }

  function t3(fa, en, ar) {
    const l = lang();
    if (l === 'en') return en;
    if (l === 'ar') return ar || en || fa;
    return fa;
  }

  function t(keyOrFa, en, ar) {
    if (i18n()?.t && STRING_KEYS[keyOrFa]) return i18n().t(keyOrFa);
    return t3(keyOrFa, en, ar);
  }

  const STRING_KEYS = {
    'cm.language': 1,
    'cm.filter': 1,
    'cm.filterExclude': 1,
    'cm.search': 1,
    'cm.searchPh': 1,
    'cm.all': 1,
    'cm.experience': 1,
    'cm.add': 1,
    'cm.added': 1,
    'cm.back': 1,
    'cm.empty': 1,
    'cm.drawerTitle': 1,
    'cm.loading': 1,
    'cm.loadFail': 1,
    'cm.title': 1,
    'currency.toman': 1,
  };

  let categories = [];
  let items = [];
  let allergens = [];
  let activeDayparts = [];
  let activeCat = 'all';
  let excludeAllergens = new Set();
  let query = '';
  let detailItem = null;
  let detailQty = 1;
  let catThumbs = {};

  // Hot-path indexes. They are rebuilt only when menu data changes, so search,
  // detail open and category thumbnail selection never scan the full arrays
  // repeatedly during user interaction.
  let categoryById = new Map();
  let itemById = new Map();
  let allergenById = new Map();
  let searchIndex = new Map();

  // Lifecycle owners for work that can outlive a single input/navigation event.
  let searchFrame = 0;
  let bootController = null;
  let bootTimeout = 0;
  let bootGeneration = 0;
  let bootComplete = false;
  let lastSyncedUrl = '';

  const els = {
    root: document.body,
    search: $('#cm-search'),
    searchPanel: $('#cm-search-panel'),
    searchToggle: $('#cm-search-toggle'),
    menuToggle: $('#cm-menu-toggle'),
    drawer: $('#cm-drawer'),
    drawerTitle: $('#cm-drawer-title'),
    langLabel: $('#cm-lang-label'),
    filterLabel: $('#cm-filter-label'),
    experienceLink: $('#cm-experience-link'),
    back: $('#cm-back'),
    tabs: $('#cm-tabs'),
    filters: $('#cm-filters'),
    meta: $('#cm-meta'),
    grid: $('#cm-grid'),
    sectionKicker: $('#cm-section-kicker'),
    sectionTitle: $('#cm-section-title'),
    sectionDesc: $('#cm-section-desc'),
    lang: $('#cm-lang'),
    detail: $('#cm-detail'),
    detailMedia: $('#cm-detail-media'),
    detailName: $('#cm-detail-name'),
    detailSub: $('#cm-detail-sub'),
    detailDesc: $('#cm-detail-desc'),
    detailAllergens: $('#cm-detail-allergens'),
    detailPrice: $('#cm-detail-price'),
    detailScroll: $('#cm-detail-scroll'),
    detailMore: $('#cm-detail-more'),
    detailQty: $('#cm-detail-qty'),
    detailAdd: $('#cm-detail-add'),
    toast: $('#cm-toast'),
  };

  // These controls are static in menu.html; cache them once instead of running
  // the same selector on every category/filter refresh.
  const langButtons = Array.from(
    document.querySelectorAll('#cm-lang [data-lang], #cm-lang-pop [data-lang]'),
  );

  function catTitle(c) {
    return i18n()?.catTitle ? i18n().catTitle(c) : c.title;
  }

  function allergenLabel(a) {
    return i18n()?.allergenLabel ? i18n().allergenLabel(a) : a.label;
  }

  function itemName(m) {
    return i18n()?.itemName ? i18n().itemName(m) : m.name;
  }

  function itemSub(m) {
    return i18n()?.itemSub ? i18n().itemSub(m) : m.en || '';
  }

  function itemDesc(m) {
    return i18n()?.itemDesc ? i18n().itemDesc(m) : m.desc || '';
  }

  function categoryDesc(category) {
    if (!category) return '';
    if (lang() === 'en') return category.shortDescEn || category.longDescEn || category.shortDesc || '';
    if (lang() === 'ar') return category.shortDescAr || category.longDescAr || category.shortDesc || '';
    return category.shortDesc || category.longDesc || '';
  }

  function itemInDaypart(m) {
    const parts = Array.isArray(m.dayparts) && m.dayparts.length ? m.dayparts : ['all'];
    if (parts.includes('all')) return true;
    return parts.some((p) => activeDayparts.includes(p));
  }

  function rebuildIndexes() {
    categoryById = new Map(categories.map((c) => [Number(c.id), c]));
    itemById = new Map(items.map((m) => [Number(m.id), m]));
    allergenById = new Map(allergens.map((a) => [String(a.id), a]));
    searchIndex = new Map();
  }

  function buildCatThumbs() {
    catThumbs = {};

    const availableFallback = new Map();
    const anyFallback = new Map();

    // One pass over items instead of two Array.find() scans per category.
    for (const item of items) {
      if (!item?.img) continue;
      const id = Number(item.categoryId);
      if (!anyFallback.has(id)) anyFallback.set(id, item.img);
      if (item.available !== false && !availableFallback.has(id)) {
        availableFallback.set(id, item.img);
      }
    }

    categories.forEach((c) => {
      const id = Number(c.id);
      const cover = String(c.coverImg || '').trim();
      if (cover && !/assets\/textures\/westo_texture_/i.test(cover)) {
        catThumbs[c.id] = cover;
        return;
      }
      const fallback = availableFallback.get(id) || anyFallback.get(id);
      if (fallback) catThumbs[c.id] = fallback;
    });
  }

  function indexedSearchText(item) {
    if (!item) return '';
    const key = `${lang()}:${item.id}`;
    const cached = searchIndex.get(key);
    if (cached != null) return cached;

    const cat = categoryById.get(Number(item.categoryId));
    const value = [
      item.name,
      item.en,
      item.ar,
      item.desc,
      item.descEn,
      item.descAr,
      cat ? catTitle(cat) : '',
    ]
      .join(' ')
      .toLowerCase();
    searchIndex.set(key, value);
    return value;
  }

  function loadCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (raw && !Array.isArray(raw) && Array.isArray(raw.lines)) return raw.lines;
      return Array.isArray(raw) ? raw : [];
    } catch (_) {
      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    document.dispatchEvent(new CustomEvent('westo:cartchange', { detail: { cart } }));
  }

  function toast(text) {
    if (!els.toast) return;
    els.toast.textContent = text;
    els.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.remove('show'), 1600);
  }

  function addToCart(item, qty) {
    const q = Math.max(1, Math.min(99, Math.round(Number(qty) || 1)));
    if (window.westoTable?.addDirect) {
      // table-cart owns badge/drawer + its own toast
      window.westoTable.addDirect(item, q);
      return;
    }
    const cart = loadCart();
    const found = cart.find((l) => l.menuItemId === item.id);
    if (found) found.qty += q;
    else {
      cart.push({
        menuItemId: item.id,
        name: item.name,
        en: item.en,
        ar: item.ar,
        price: item.price,
        qty: q,
        img: item.img || '',
      });
    }
    saveCart(cart);
    toast(
      (q > 1 ? `${q.toLocaleString(localeTag())}× ` : '') +
        itemName(item) +
        ' — ' +
        (i18n()?.t ? i18n().t('cm.added') : t3('به سبد اضافه شد', 'added to cart', 'أضيف إلى السلة')),
    );
  }

  function syncUrl() {
    const url = new URL(location.href);
    url.searchParams.set('lang', lang());
    if (activeCat && activeCat !== 'all') url.searchParams.set('cat', String(activeCat));
    else url.searchParams.delete('cat');
    if (detailItem) url.searchParams.set('item', String(detailItem.id));
    else url.searchParams.delete('item');
    if (query.trim()) url.searchParams.set('q', query.trim());
    else url.searchParams.delete('q');
    if (excludeAllergens.size) url.searchParams.set('exclude', [...excludeAllergens].join(','));
    else url.searchParams.delete('exclude');

    const next = `${url.pathname}?${url.searchParams}`;
    if (next === lastSyncedUrl) return;
    lastSyncedUrl = next;
    history.replaceState(null, '', next);
  }

  function paintChrome() {
    if (i18n()?.applyDocumentLang) i18n().applyDocumentLang(lang());
    else {
      document.documentElement.lang = lang();
    }
    const textDir = lang() === 'en' ? 'ltr' : 'rtl';
    // The classic menu is a text-first page: Persian and Arabic use a genuine
    // RTL document direction while English remains LTR.
    document.documentElement.dir = textDir;
    document.body.dir = textDir;
    els.root.lang = lang();
    if (els.grid) els.grid.dir = textDir;
    if (els.tabs) els.tabs.dir = textDir;
    if (els.search) {
      els.search.placeholder = i18n()?.t ? i18n().t('cm.searchPh') : t3(
        'جستجوی غذا، مواد یا دسته…',
        'Search dishes, ingredients, categories…',
        'ابحث عن أطباق أو مكونات أو فئات…',
      );
      els.search.dir = textDir;
    }
    if (i18n()?.paintStaticI18n) i18n().paintStaticI18n(document);
    if (els.drawerTitle) {
      els.drawerTitle.textContent = i18n()?.t ? i18n().t('cm.drawerTitle') : t3('منو و فیلترها', 'Menu & filters', 'القائمة والفلاتر');
    }
    if (els.langLabel) els.langLabel.textContent = i18n()?.t ? i18n().t('cm.language') : t3('زبان', 'Language', 'اللغة');
    if (els.filterLabel) {
      els.filterLabel.textContent = i18n()?.t
        ? i18n().t('cm.filterExclude')
        : t3('بدون آلرژن', 'Exclude allergens', 'استبعاد مسببات الحساسية');
    }
    if (els.experienceLink) {
      els.experienceLink.textContent = i18n()?.t ? i18n().t('cm.experience') : t3('منوی اصلی', 'Main menu', 'القائمة الرئيسية');
    }
    if (els.detailAdd) els.detailAdd.textContent = i18n()?.t ? i18n().t('cm.add') : t3('افزودن به سبد', 'Add to cart', 'أضف إلى السلة');
    const code = $('#cm-lang-code');
    if (code) code.textContent = (lang() || 'fa').toUpperCase();
    langButtons.forEach((b) => {
      b.classList.toggle('is-active', b.dataset.lang === lang());
    });
    document.title = i18n()?.t ? i18n().t('cm.title') : t3('منوی کلاسیک — وستو', 'Classic menu — Westo', 'القائمة الكلاسيكية — وستو');
  }

  function filteredList() {
    const categoryId = activeCat === 'all' ? null : Number(activeCat);
    const q = query.trim().toLowerCase();
    const hasExclusions = excludeAllergens.size > 0;
    const list = [];

    // One pass combines category, allergen and text filters. The expensive
    // localized search string is memoized per item + language.
    for (const item of items) {
      if (categoryId != null && Number(item.categoryId) !== categoryId) continue;
      if (
        hasExclusions &&
        (item.allergens || []).some((allergen) => excludeAllergens.has(allergen))
      ) {
        continue;
      }
      if (q && !indexedSearchText(item).includes(q)) continue;
      list.push(item);
    }

    return list;
  }

  function renderTabs() {
    const allThumb = items.find((m) => m.img)?.img;
    const allLabel = i18n()?.t ? i18n().t('cm.all') : t3('همه', 'All', 'الكل');
    const allBtn = `<button type="button" class="cm-cat${activeCat === 'all' ? ' is-active' : ''}" data-cat="all">
      ${allThumb ? `<img class="cm-cat__thumb" src="${esc(allThumb)}" alt="" loading="lazy" />` : `<span class="cm-cat__thumb--empty" aria-hidden="true"></span>`}
      <span class="cm-cat__label">${esc(allLabel)}</span>
    </button>`;
    els.tabs.innerHTML =
      allBtn +
      categories
        .map((c) => {
          const thumb = catThumbs[c.id];
          return `<button type="button" class="cm-cat${String(c.id) === String(activeCat) ? ' is-active' : ''}" data-cat="${c.id}">
            ${thumb ? `<img class="cm-cat__thumb" src="${esc(thumb)}" alt="" loading="lazy" />` : `<span class="cm-cat__thumb--empty" aria-hidden="true"></span>`}
            <span class="cm-cat__label">${esc(catTitle(c))}</span>
          </button>`;
        })
        .join('');
  }

  function renderFilters() {
    if (!allergens.length) {
      els.filters.innerHTML = '';
      return;
    }
    els.filters.innerHTML = allergens
      .map(
        (a) =>
          `<button type="button" class="cm-chip${excludeAllergens.has(a.id) ? ' is-on' : ''}" data-allergen="${esc(a.id)}">${esc(
            allergenLabel(a),
          )}</button>`,
      )
      .join('');
  }

  function localeTag() {
    return lang() === 'en' ? 'en-US' : lang() === 'ar' ? 'ar' : 'fa-IR';
  }

  function formatUiNumber(value, options = {}) {
    return window.WestoPersianFormat?.number(value, { ...options, locale: localeTag() }) ?? Number(value || 0).toLocaleString(localeTag(), options);
  }

  function renderMeta(list) {
    const selected = activeCat === 'all' ? null : categoryById.get(Number(activeCat));
    if (els.sectionKicker) {
      els.sectionKicker.textContent = t3('منـــــوی وستو', 'WESTO MENU', 'قائمة وستو');
    }
    if (els.sectionTitle) {
      els.sectionTitle.textContent = selected
        ? catTitle(selected)
        : t3('همه طعم‌های وستو', 'All Westo flavours', 'جميع نكهات وستو');
    }
    if (els.sectionDesc) {
      els.sectionDesc.textContent = selected
        ? categoryDesc(selected)
        : t3(
            'محصول دلخواهتان را انتخاب کنید؛ جزئیات، آلرژن‌ها و افزودن به سفارش در همان پنجره در دسترس است.',
            'Choose a product to see details, allergens and add it to your order.',
            'اختر منتجاً لعرض التفاصيل ومسببات الحساسية وإضافته إلى الطلب.',
          );
    }
    els.meta.textContent = `${list.length.toLocaleString(localeTag())} ${t3('آیتم', 'items', 'عنصر')}`;
  }

  function cardPriceMarkup(price) {
    const amount = Math.max(0, Number(price || 0));
    const value = formatUiNumber(amount);
    const unit = i18n()?.t ? i18n().t('currency.toman') : t3('تومان', 'Toman', 'تومان');
    const unitMarkup = unit === 'تومان' ? '<small>تومان</small>' : `<small>${esc(unit)}</small>`;
    return `<strong>${esc(value)}</strong>${unitMarkup}`;
  }

  function renderGrid() {
    const list = filteredList();
    renderMeta(list);
    if (!list.length) {
      const catEmpty =
        activeCat !== 'all' &&
        !query &&
        !excludeAllergens.size &&
        !(items || []).some((m) => String(m.categoryId) === String(activeCat));
      const msg = catEmpty
        ? i18n()?.t
          ? i18n().t('cm.emptyCat')
          : t3('هنوز غذایی در این دسته نیست', 'No dishes in this category yet', 'لا أطباق في هذه الفئة بعد')
        : i18n()?.t
          ? i18n().t('cm.empty')
          : t3('موردی با این فیلتر پیدا نشد', 'No dishes match these filters', 'لا توجد أطباق مطابقة');
      els.grid.innerHTML = `<p class="cm-empty">${esc(msg)}</p>`;
      return;
    }

    let featuredUsed = false;
    els.grid.innerHTML = list
      .map((m) => {
        const out = m.available === false;
        const off = !itemInDaypart(m);
        const name = itemName(m);
        const sub = itemSub(m);
        const summary = itemDesc(m);
        const featured = !featuredUsed && m.featured && !out;
        if (featured) featuredUsed = true;
        const spokenPrice = `${formatUiNumber(m.price)} ${i18n()?.t ? i18n().t('currency.toman') : t3('تومان', 'Toman', 'تومان')}`;
        return `<article class="cm-item${featured ? ' is-featured' : ''}${out || off ? ' is-unavailable' : ''}" data-id="${m.id}" role="button" tabindex="0" aria-label="${esc(`${name}، ${spokenPrice}`)}">
          <div class="cm-item__media">${m.img ? `<img src="${esc(m.img)}" alt="${esc(name)}" loading="lazy" />` : ''}</div>
          <div class="cm-item__body">
            <h3 class="cm-item__name">${esc(name)}</h3>
            ${sub ? `<p class="cm-item__en" dir="auto">${esc(sub)}</p>` : ''}
            ${summary ? `<p class="cm-item__summary">${esc(summary)}</p>` : ''}
            <p class="cm-item__price">${cardPriceMarkup(m.price)}</p>
            ${out ? `<span class="cm-item__badge">${t3('ناموجود', 'Sold out', 'غير متوفر')}</span>` : ''}
          </div>
        </article>`;
      })
      .join('');
  }

  let overlayFocusBeforeOpen = null;
  let classicBodyOverflowBeforeLock = '';
  let classicScrollLocked = false;
  function classicFocusable(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter((el) => !el.hidden && el.getClientRects().length);
  }
  function classicTrapFocus(event, container) {
    if (event.key !== 'Tab' || !container) return false;
    const list=classicFocusable(container); if(!list.length){event.preventDefault();return true;}
    const first=list[0],last=list[list.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus({preventScroll:true});return true;}
    if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus({preventScroll:true});return true;}
    return false;
  }
  function classicLockScroll(){
    if (classicScrollLocked) return;
    classicBodyOverflowBeforeLock=document.body.style.overflow||'';
    document.body.style.overflow='hidden';
    classicScrollLocked=true;
  }
  function classicUnlockScroll(){
    if((els.detail&&!els.detail.hidden)||(els.drawer&&!els.drawer.hidden)) return;
    if(!classicScrollLocked) return;
    document.body.style.overflow=classicBodyOverflowBeforeLock;
    classicBodyOverflowBeforeLock='';
    classicScrollLocked=false;
  }
  function classicRestoreFocus(){ const back=overlayFocusBeforeOpen; overlayFocusBeforeOpen=null; if(back?.isConnected&&typeof back.focus==='function'){try{back.focus({preventScroll:true});}catch(_){}} }

  function openDetail(item) {
    const wasHidden = els.detail.hidden;
    detailItem = item;
    detailQty = 1;
    if (els.detailQty) els.detailQty.textContent = detailQty.toLocaleString(localeTag());
    if (els.detailName) els.detailName.textContent = itemName(item);
    if (els.detailSub) els.detailSub.textContent = itemSub(item);
    if (els.detailDesc) els.detailDesc.textContent = itemDesc(item);
    if (els.detailPrice) {
      els.detailPrice.textContent = `${formatUiNumber(item.price)} ${i18n()?.t ? i18n().t('currency.toman') : t3('تومان', 'Toman', 'تومان')}`;
    }
    if (els.detailMedia) {
      els.detailMedia.innerHTML = `${item.img ? `<img src="${esc(item.img)}" alt="${esc(itemName(item))}" />` : ''}<button type="button" class="cm-detail__media-expand" id="cm-detail-media-expand" aria-label="${esc(t3('نمایش جزئیات بیشتر', 'Show more details', 'عرض تفاصيل أكثر'))}" aria-expanded="false">↗</button>`;
    }
    if (els.detailAllergens) {
      const tags = (item.allergens || [])
        .map((id) => allergenById.get(String(id)))
        .filter(Boolean)
        .map((a) => `<span class="cm-tag">${esc(allergenLabel(a))}</span>`)
        .join('');
      els.detailAllergens.innerHTML = tags;
    }
    if (els.detailAdd) els.detailAdd.disabled = item.available === false;
    setDetailExpanded(false);
    if (wasHidden) overlayFocusBeforeOpen = document.activeElement;
    els.detail.hidden = false;
    els.detail.setAttribute('aria-hidden','false');
    els.detail.querySelector('.cm-detail__card')?.setAttribute('aria-modal','true');
    classicLockScroll();
    if (wasHidden) requestAnimationFrame(() => els.detail.querySelector('.cm-detail__x')?.focus({preventScroll:true}));
    syncUrl();
  }

  function closeDetail() {
    detailItem = null;
    setDetailExpanded(false);
    els.detail.hidden = true;
    els.detail.setAttribute('aria-hidden','true');
    els.detail.querySelector('.cm-detail__card')?.removeAttribute('aria-modal');
    classicUnlockScroll();
    classicRestoreFocus();
    syncUrl();
  }

  function setDetailExpanded(expanded) {
    if (!els.detail) return;
    const next = !!expanded;
    els.detail.classList.toggle('is-expanded', next);
    if (els.detailMore) {
      els.detailMore.setAttribute('aria-expanded', next ? 'true' : 'false');
      els.detailMore.textContent = next
        ? t3('کمتر ↓', 'Less ↓', 'أقل ↓')
        : t3('بیشتر ↑', 'More ↑', 'المزيد ↑');
    }
    const mediaExpand = $('#cm-detail-media-expand');
    mediaExpand?.setAttribute('aria-expanded', next ? 'true' : 'false');
    const close = els.detail.querySelector('.cm-detail__x');
    if (close) {
      close.textContent = next ? t3('بازگشت ←', 'Back ←', 'رجوع ←') : '×';
      close.setAttribute('aria-label', next ? t3('بازگشت', 'Back', 'رجوع') : t3('بستن', 'Close', 'إغلاق'));
    }
    if (els.detailScroll) els.detailScroll.scrollTop = 0;
  }

  async function shareDetail() {
    if (!detailItem) return;
    const shareUrl = location.href;
    const shareData = { title: itemName(detailItem), text: itemDesc(detailItem), url: shareUrl };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      toast(t3('لینک محصول کپی شد', 'Product link copied', 'تم نسخ رابط المنتج'));
    } catch (error) {
      if (error?.name !== 'AbortError') toast(t3('اشتراک‌گذاری در دسترس نیست', 'Sharing is unavailable', 'المشاركة غير متاحة'));
    }
  }

  function openDrawer(force) {
    const next = typeof force === 'boolean' ? force : els.drawer.hidden;
    const wasHidden = els.drawer.hidden;
    if (next && wasHidden) overlayFocusBeforeOpen = document.activeElement;
    els.drawer.hidden = !next;
    els.drawer.setAttribute('aria-hidden', next ? 'false' : 'true');
    els.menuToggle?.setAttribute('aria-expanded', next ? 'true' : 'false');
    if(next){
      classicLockScroll();
      if (wasHidden) requestAnimationFrame(()=>els.drawer.querySelector('[data-drawer-close]')?.focus({preventScroll:true}));
    } else {
      classicUnlockScroll();
      classicRestoreFocus();
    }
  }

  function toggleSearch(force) {
    if (!els.searchPanel) return;
    const next = typeof force === 'boolean' ? force : els.searchPanel.hidden;
    els.searchPanel.hidden = !next;
    els.searchToggle?.setAttribute('aria-expanded', next ? 'true' : 'false');
    if (next) els.search?.focus();
  }

  function setLang(next) {
    if (i18n()?.setLang) {
      // westoI18n synchronously emits westo:langchange when the language
      // actually changes. Let that single event own the repaint so we do not
      // render the whole classic menu twice for one click.
      i18n().setLang(next, { userInitiated: true });
      return;
    }

    try {
      localStorage.setItem('westo_menu_lang', next);
      localStorage.setItem('westo_menu_lang_explicit_v1', '1');
    } catch (_) {}
    refresh();
    if (detailItem) openDetail(detailItem);
  }

  function applyCategoryTheme() {
    if (window.westoCategoryTheme?.apply) {
      window.westoCategoryTheme.apply(activeCat === 'all' ? null : activeCat);
    }
    const selected = activeCat === 'all' ? null : categoryById.get(Number(activeCat));
    const cover = String(selected?.coverImg || categories[0]?.coverImg || '').trim();
    if (cover) {
      const safeCover = cover.replace(/["\\\n\r]/g, (char) => `\\${char}`);
      document.body.style.setProperty('--cm-hero-image', `url("${safeCover}")`);
    } else {
      document.body.style.removeProperty('--cm-hero-image');
    }
  }

  function refresh() {
    paintChrome();
    renderTabs();
    renderFilters();
    renderGrid();
    syncUrl();
    applyCategoryTheme();
  }

  function refreshCategoryOnly() {
    renderTabs();
    renderGrid();
    syncUrl();
    applyCategoryTheme();
  }

  function refreshAllergenOnly() {
    renderFilters();
    renderGrid();
    syncUrl();
  }

  function scheduleSearchRefresh() {
    if (searchFrame) return;
    searchFrame = requestAnimationFrame(() => {
      searchFrame = 0;
      renderGrid();
      syncUrl();
    });
  }

  async function boot() {
    const generation = ++bootGeneration;
    bootComplete = false;

    if (bootController) {
      try {
        bootController.abort();
      } catch (_) {}
    }
    if (bootTimeout) clearTimeout(bootTimeout);

    bootController = typeof AbortController === 'function' ? new AbortController() : null;
    if (bootController) {
      bootTimeout = setTimeout(() => {
        try {
          bootController?.abort();
        } catch (_) {}
      }, 12000);
    }

    paintChrome();
    els.grid.innerHTML = `<p class="cm-empty">${esc(i18n()?.t ? i18n().t('cm.loading') : t3('در حال بارگذاری…', 'Loading…', 'جاري التحميل…'))}</p>`;

    try {
      const r = await fetch('/api/menu?all=1', {
        credentials: 'same-origin',
        cache: 'no-cache',
        signal: bootController?.signal,
      });
      if (!r.ok) throw new Error(`menu request failed (${r.status})`);
      const d = await r.json();
      if (generation !== bootGeneration) return;

      if (d.i18n && i18n()?.syncFromConfig) i18n().syncFromConfig(d.i18n);
      items = d.menuItems || [];
      allergens = d.allergens || [];
      activeDayparts = d.activeDayparts || [];
      const hasCover = (c) => {
        const cover = String(c?.coverImg || '').trim();
        return !!cover && !/assets\/textures\/westo_texture_/i.test(cover);
      };
      if (Array.isArray(d.siteCategories) && d.siteCategories.length) {
        categories = d.siteCategories.filter((c) => c && hasCover(c));
      } else {
        categories = (d.menuCategories || []).filter((c) => c && !c.hiddenOnSite && hasCover(c));
      }

      rebuildIndexes();
      buildCatThumbs();

      const params = new URLSearchParams(location.search);
      query = '';
      if (params.get('exclude')) {
        params
          .get('exclude')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((id) => excludeAllergens.add(id));
      }
      const cat = params.get('cat');
      if (cat && (cat === 'all' || categories.some((c) => String(c.id) === cat))) activeCat = cat;
      else if (categories[0]) activeCat = String(categories[0].id);

      refresh();
      if (window.westoTable?.refresh) window.westoTable.refresh();
      const itemId = Number(params.get('item'));
      if (itemId) {
        const found = itemById.get(itemId);
        if (found) openDetail(found);
      }
      bootComplete = true;
    } catch (error) {
      if (generation !== bootGeneration) return;
      if (error?.name === 'AbortError' && document.visibilityState === 'hidden') return;
      els.grid.innerHTML = `<p class="cm-empty">${esc(i18n()?.t ? i18n().t('cm.loadFail') : t3('بارگذاری ناموفق بود', 'Failed to load menu', 'فشل التحميل'))}</p>`;
    } finally {
      if (generation === bootGeneration) {
        if (bootTimeout) clearTimeout(bootTimeout);
        bootTimeout = 0;
        bootController = null;
      }
    }
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('#cm-search-toggle')) {
      toggleSearch();
      return;
    }
    if (e.target.closest('#cm-menu-toggle')) {
      openDrawer(true);
      return;
    }
    if (e.target.closest('[data-drawer-close]') || e.target.matches('.cm-drawer__backdrop')) {
      openDrawer(false);
      return;
    }
    const langBtn = e.target.closest('[data-lang]');
    if (langBtn && (langBtn.closest('#cm-lang') || langBtn.closest('#cm-lang-pop'))) {
      setLang(langBtn.dataset.lang);
      const pop = $('#cm-lang-pop');
      if (pop) pop.hidden = true;
      $('#cm-lang-btn')?.setAttribute('aria-expanded', 'false');
      return;
    }
    if (e.target.closest('#cm-lang-btn')) {
      const pop = $('#cm-lang-pop');
      if (pop) {
        pop.hidden = !pop.hidden;
        $('#cm-lang-btn')?.setAttribute('aria-expanded', pop.hidden ? 'false' : 'true');
      }
      return;
    }
    if (!e.target.closest('#cm-lang-chip')) {
      const pop = $('#cm-lang-pop');
      if (pop && !pop.hidden) {
        pop.hidden = true;
        $('#cm-lang-btn')?.setAttribute('aria-expanded', 'false');
      }
    }
    const catBtn = e.target.closest('[data-cat]');
    if (catBtn) {
      activeCat = catBtn.dataset.cat;
      try {
        if (activeCat !== 'all') {
          window.dispatchEvent(
            new CustomEvent('westo:category-focus', { detail: { categoryId: Number(activeCat) } }),
          );
        }
      } catch (_) {}
      refreshCategoryOnly();
      return;
    }
    const allergenBtn = e.target.closest('[data-allergen]');
    if (allergenBtn) {
      const id = allergenBtn.dataset.allergen;
      if (excludeAllergens.has(id)) excludeAllergens.delete(id);
      else excludeAllergens.add(id);
      refreshAllergenOnly();
      return;
    }
    const card = e.target.closest('.cm-item[data-id]');
    if (card) {
      const item = itemById.get(Number(card.dataset.id));
      if (item) openDetail(item);
      return;
    }
    if (e.target.closest('[data-detail-close]') || e.target.matches('.cm-detail__backdrop')) {
      if (e.target.closest('.cm-detail__x') && els.detail.classList.contains('is-expanded')) {
        setDetailExpanded(false);
        return;
      }
      closeDetail();
      return;
    }
    if (e.target.closest('#cm-detail-more') || e.target.closest('#cm-detail-media-expand')) {
      setDetailExpanded(!els.detail.classList.contains('is-expanded'));
      return;
    }
    if (e.target.closest('#cm-detail-share')) {
      void shareDetail();
      return;
    }
    if (e.target.closest('#cm-detail-inc')) {
      detailQty = Math.min(99, detailQty + 1);
      if (els.detailQty) els.detailQty.textContent = detailQty.toLocaleString(localeTag());
      return;
    }
    if (e.target.closest('#cm-detail-dec')) {
      detailQty = Math.max(1, detailQty - 1);
      if (els.detailQty) els.detailQty.textContent = detailQty.toLocaleString(localeTag());
      return;
    }
    if (e.target.closest('#cm-detail-add') && detailItem) {
      addToCart(detailItem, detailQty);
      closeDetail();
    }
  });

  els.search?.addEventListener('input', () => {
    query = els.search.value || '';
    scheduleSearchRefresh();
  });

  document.addEventListener('keydown', (event) => {
    const detailOpen = els.detail && !els.detail.hidden;
    const drawerOpen = els.drawer && !els.drawer.hidden;
    if (event.key === 'Escape') {
      if (detailOpen) {
        event.preventDefault();
        if (els.detail.classList.contains('is-expanded')) setDetailExpanded(false);
        else closeDetail();
        return;
      }
      if (drawerOpen) {
        event.preventDefault();
        openDrawer(false);
        return;
      }
    }
    if (detailOpen && classicTrapFocus(event, els.detail.querySelector('.cm-detail__card'))) return;
    if (drawerOpen && classicTrapFocus(event, els.drawer.querySelector('.cm-drawer__panel'))) return;
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.cm-item[data-id]')) {
      event.preventDefault();
      const item = itemById.get(Number(event.target.dataset.id));
      if (item) openDetail(item);
    }
  });

  document.addEventListener('westo:langchange', () => {
    // Localized search haystacks include category titles, so invalidate only
    // that memoized layer; menu data/indexes themselves stay valid.
    searchIndex.clear();
    refresh();
    if (detailItem) openDetail(detailItem);
  });

  window.addEventListener('pagehide', () => {
    if (searchFrame) cancelAnimationFrame(searchFrame);
    searchFrame = 0;
    if (bootTimeout) clearTimeout(bootTimeout);
    bootTimeout = 0;
    try {
      bootController?.abort();
    } catch (_) {}
  });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted && !bootComplete) boot();
  });

  boot();
})();
