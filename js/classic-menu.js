/* Shared guest-menu rules. Prices and option identities are always resolved
   from the current API menu; the browser only submits group/option IDs. */
(function (global) {
  'use strict';

  function safePrice(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
    if (typeof value !== 'string' || !value.trim()) return null;
    const normalized = value.trim()
      .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
      .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
    if (!/^\d+$/.test(normalized)) return null;
    const amount = Number(normalized);
    return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
  }

  function safeSelectionCount(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
    if (typeof value !== 'string' || !value.trim()) return null;
    const normalized = value.trim()
      .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
      .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
    if (!/^\d+$/.test(normalized)) return null;
    const count = Number(normalized);
    return Number.isSafeInteger(count) ? count : null;
  }

  function normalizeSearchText(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .replace(/[يى]/g, 'ی')
      .replace(/ك/g, 'ک')
      .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g, '')
      .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
      .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
      .replace(/\u200c/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function normalizeGroups(rawGroups) {
    if (rawGroups == null) return { ok: true, groups: [] };
    if (!Array.isArray(rawGroups) || rawGroups.length > 8) return { ok: false, groups: [] };
    const groupIds = new Set();
    const groups = [];
    for (const raw of rawGroups) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, groups: [] };
      const id = String(raw.id ?? '').trim();
      const title = String(raw.title ?? raw.name ?? '').trim();
      const selection = raw.selection == null || raw.selection === '' ? 'multiple' : raw.selection;
      if (!id || !title || groupIds.has(id) || !['single', 'multiple'].includes(selection) || !Array.isArray(raw.options) || raw.options.length > 16) {
        return { ok: false, groups: [] };
      }
      groupIds.add(id);
      const optionIds = new Set();
      const options = [];
      for (const option of raw.options) {
        if (!option || typeof option !== 'object' || Array.isArray(option)) return { ok: false, groups: [] };
        const optionId = String(option.id ?? '').trim();
        const name = String(option.name ?? option.title ?? '').trim();
        if (!optionId || !name || optionIds.has(optionId)) return { ok: false, groups: [] };
        optionIds.add(optionId);
        const price = safePrice(option.price);
        if (option.available != null && typeof option.available !== 'boolean') return { ok: false, groups: [] };
        options.push({ id: optionId, name, price, available: option.available !== false && price != null });
      }
      if (!options.length) return { ok: false, groups: [] };
      const minSelections = raw.minSelections == null || raw.minSelections === ''
        ? (raw.required === true ? 1 : 0)
        : safeSelectionCount(raw.minSelections);
      const maxSelections = raw.maxSelections == null || raw.maxSelections === ''
        ? (selection === 'single' ? 1 : 16)
        : safeSelectionCount(raw.maxSelections);
      if (!Number.isSafeInteger(minSelections) || minSelections < 0 || minSelections > 16 ||
          !Number.isSafeInteger(maxSelections) || maxSelections < 1 || maxSelections > 16 ||
          minSelections > maxSelections || (selection === 'single' && maxSelections > 1) ||
          options.filter((option) => option.available).length < minSelections) {
        return { ok: false, groups: [] };
      }
      groups.push({ id, title, selection, minSelections, maxSelections, options });
    }
    return { ok: true, groups };
  }

  function resolveSelection(groupsResult, requested, basePrice) {
    const price = safePrice(basePrice);
    if (!groupsResult?.ok || price == null || !Array.isArray(requested)) return { ok: false, error: 'invalid_configuration' };
    const groups = groupsResult.groups || [];
    if (requested.length > 128) return { ok: false, error: 'too_many_selections' };
    const selectedByGroup = new Map();
    const canonical = [];
    const seen = new Set();
    for (const entry of requested) {
      const groupId = String(entry?.groupId ?? '').trim();
      const optionId = String(entry?.id ?? '').trim();
      const group = groups.find((candidate) => candidate.id === groupId);
      const option = group?.options.find((candidate) => candidate.id === optionId);
      const identity = `${groupId}\u0000${optionId}`;
      if (!group || !option || !option.available || seen.has(identity)) return { ok: false, error: 'invalid_selection' };
      seen.add(identity);
      if (!selectedByGroup.has(groupId)) selectedByGroup.set(groupId, []);
      selectedByGroup.get(groupId).push(option);
      canonical.push({ groupId, id: optionId, groupTitle: group.title, name: option.name, price: option.price });
    }
    for (const group of groups) {
      const count = (selectedByGroup.get(group.id) || []).length;
      if (count < group.minSelections || count > group.maxSelections || (group.selection === 'single' && count > 1)) {
        return { ok: false, error: 'selection_count' };
      }
    }
    const unitPrice = price + canonical.reduce((sum, entry) => sum + entry.price, 0);
    if (!Number.isSafeInteger(unitPrice)) return { ok: false, error: 'unsafe_total' };
    return { ok: true, modifiers: canonical, unitPrice };
  }

  global.WestoMenuUiRules = Object.freeze({ safePrice, safeSelectionCount, normalizeSearchText, normalizeGroups, resolveSelection });
})(typeof window !== 'undefined' ? window : globalThis);

/* Classic menu — Majnoon-inspired UI, Westo data & cart. fa | en | ar */
(function () {
  function readMenuCartContext(params) {
    const first = (keys) => {
      for (const key of keys) {
        const value = String(params?.get?.(key) ?? '').trim();
        if (value) return value;
      }
      return '';
    };
    return {
      branch: first(['branch', 'branchId']),
      table: first(['table', 't', 'tableNo']),
    };
  }

  function publicMenuRequestUrl(context) {
    const query = new URLSearchParams();
    if (context?.branch) query.set('branch', context.branch);
    const search = query.toString();
    return `/api/menu${search ? `?${search}` : ''}`;
  }

  function initialMenuSearchQuery(params) {
    return String(params?.get?.('q') ?? '');
  }

  function canonicalCartIdentity(value, { requirePositive = false } = {}) {
    const raw = String(value ?? '').trim();
    const digits = raw
      .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
      .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
    if (!/^\d+$/.test(digits)) return digits;
    const canonical = digits.replace(/^0+(?=\d)/, '');
    if (requirePositive && canonical === '0') return '';
    return canonical;
  }

  function cartStorageKeyForContext(context) {
    const branch = canonicalCartIdentity(context?.branch, { requirePositive: true });
    const table = canonicalCartIdentity(context?.table);
    return table
      ? `westo_table:v2:${encodeURIComponent(branch || 'default')}:table:${encodeURIComponent(table)}`
      : branch
        ? `westo_table:v2:${encodeURIComponent(branch)}:menu`
        : 'westo_table';
  }

  const cartContext = readMenuCartContext(new URLSearchParams(location.search));
  const cartBranch = canonicalCartIdentity(cartContext.branch, { requirePositive: true });
  const cartTable = canonicalCartIdentity(cartContext.table);
  const STORAGE_KEY = cartStorageKeyForContext(cartContext);
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
  let detailGroups = { ok: true, groups: [] };
  let detailSelection = Object.create(null);
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
    detailModifiers: $('#cm-detail-modifiers'),
    detailModifierMessage: $('#cm-detail-modifier-message'),
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

  const menuRules = window.WestoMenuUiRules;
  const safeMenuPrice = (value) => menuRules?.safePrice(value) ?? null;

  function menuItemStockLimit(item) {
    return typeof item?.stock === 'number' && Number.isSafeInteger(item.stock) && item.stock >= 0
      ? item.stock
      : null;
  }

  function menuItemStockRemaining(item) {
    const limit = menuItemStockLimit(item);
    if (limit === null) return null;
    const id = String(item?.id ?? '');
    const inCart = loadCart().reduce((total, line) => {
      if (!line || String(line.menuItemId ?? '') !== id) return total;
      const quantity = Number(line.qty);
      return Number.isSafeInteger(quantity) && quantity > 0 ? total + quantity : total;
    }, 0);
    return Math.max(0, limit - inCart);
  }

  function detailSelectedModifiers() {
    return Object.entries(detailSelection).flatMap(([groupId, ids]) =>
      (Array.isArray(ids) ? ids : []).map((id) => ({ groupId, id })),
    );
  }

  function detailPricing() {
    if (!detailItem) return { ok: false, error: 'item_missing' };
    if (detailItem.available !== true) return { ok: false, error: 'unavailable' };
    if (!itemInDaypart(detailItem)) return { ok: false, error: 'daypart' };
    const remainingStock = menuItemStockRemaining(detailItem);
    if (remainingStock !== null && remainingStock < detailQty) return { ok: false, error: 'stock' };
    const basePrice = safeMenuPrice(detailItem.price);
    if (basePrice == null) return { ok: false, error: 'price' };
    const result = menuRules?.resolveSelection(detailGroups, detailSelectedModifiers(), basePrice);
    if (!result?.ok) return { ok: false, error: result?.error || 'configuration' };
    const lineTotal = result.unitPrice * detailQty;
    if (!Number.isSafeInteger(lineTotal)) return { ok: false, error: 'unsafe_total' };
    return { ...result, lineTotal };
  }

  function renderDetailModifiers() {
    if (!els.detailModifiers) return;
    if (!detailGroups.ok) {
      els.detailModifiers.innerHTML = '';
      return;
    }
    els.detailModifiers.innerHTML = detailGroups.groups.map((group, groupIndex) => {
      const selected = new Set(detailSelection[group.id] || []);
      const noChoice = group.selection === 'single' && group.minSelections === 0
        ? `<label class="cm-modifier__option"><input type="radio" name="cm-modifier-${esc(group.id)}" value="" data-modifier-group="${esc(group.id)}" data-modifier-option=""${selected.size ? '' : ' checked'} /><span>${esc(t3('بدون انتخاب', 'No preference', 'دون تفضيل'))}</span></label>`
        : '';
      const options = group.options.map((option) => {
        const disabled = !option.available;
        const checked = selected.has(option.id);
        const type = group.selection === 'single' ? 'radio' : 'checkbox';
        const priceText = option.price > 0
          ? `، ${formatUiNumber(option.price)} ${esc(i18n()?.t ? i18n().t('currency.toman') : 'تومان')}`
          : '';
        const stateText = disabled ? ` <small class="cm-modifier__unavailable">${esc(t3('ناموجود', 'Unavailable', 'غير متوفر'))}</small>` : '';
        return `<label class="cm-modifier__option${disabled ? ' is-unavailable' : ''}">
          <input type="${type}" name="cm-modifier-${esc(group.id)}" value="${esc(option.id)}" data-modifier-group="${esc(group.id)}" data-modifier-option="${esc(option.id)}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''} />
          <span>${esc(option.name)}${priceText}${stateText}</span>
        </label>`;
      }).join('');
      const rule = group.minSelections > 0
        ? t3(`انتخاب ${group.minSelections} مورد الزامی`, `Choose at least ${group.minSelections}`, `اختر ${group.minSelections} على الأقل`)
        : group.maxSelections < group.options.length
          ? t3(`حداکثر ${group.maxSelections} انتخاب`, `Choose up to ${group.maxSelections}`, `اختر حتى ${group.maxSelections}`)
          : t3('اختیاری', 'Optional', 'اختياري');
      const hint = group.selection === 'single' ? t3('یک گزینه', 'Choose one', 'اختر واحداً') : t3('چند گزینه', 'Choose any', 'اختر ما يناسبك');
      return `<fieldset class="cm-modifier" data-modifier-fieldset="${esc(group.id)}" role="${group.selection === 'single' ? 'radiogroup' : 'group'}"${group.selection === 'single' ? ` aria-required="${group.minSelections > 0 ? 'true' : 'false'}"` : ''} aria-describedby="cm-modifier-hint-${groupIndex}">
        <legend>${esc(group.title)} <small id="cm-modifier-hint-${groupIndex}">${esc(hint)} · ${esc(rule)}</small></legend>
        <div class="cm-modifier__options">${noChoice}${options}</div>
      </fieldset>`;
    }).join('');
  }

  function updateDetailPurchaseState() {
    if (!detailItem) return;
    const pricing = detailPricing();
    const unit = i18n()?.t ? i18n().t('currency.toman') : t3('تومان', 'Toman', 'تومان');
    if (els.detailPrice) {
      if (pricing.ok) {
        const unitPrice = `${formatUiNumber(pricing.unitPrice)} ${unit}`;
        const totalPrice = `${formatUiNumber(pricing.lineTotal)} ${unit}`;
        els.detailPrice.innerHTML = `<span class="cm-detail__unit-label">${esc(t3('هر عدد', 'Each', 'للوحدة'))}: ${esc(unitPrice)}</span>${detailQty > 1 ? `<span class="cm-detail__total-label">${esc(t3('جمع', 'Total', 'الإجمالي'))}: ${esc(totalPrice)}</span>` : ''}`;
      } else if (pricing.error === 'price' || pricing.error === 'unsafe_total') {
        els.detailPrice.textContent = t3('قیمت معتبر در دسترس نیست', 'Price unavailable', 'السعر غير متاح');
      } else {
        const basePrice = safeMenuPrice(detailItem.price);
        const hasModifierGroups = Array.isArray(detailItem.modifierGroups) && detailItem.modifierGroups.length > 0;
        const baseLabel = hasModifierGroups ? `${t3('قیمت پایه', 'Base price', 'السعر الأساسي')}: ` : '';
        els.detailPrice.textContent = basePrice == null ? t3('قیمت معتبر در دسترس نیست', 'Price unavailable', 'السعر غير متاح') : `${baseLabel}${formatUiNumber(basePrice)} ${unit}`;
      }
    }
    if (els.detailModifierMessage) {
      const messages = {
        unavailable: t3('این غذا در حال حاضر موجود نیست.', 'This item is currently unavailable.', 'هذا العنصر غير متاح حالياً.'),
        daypart: t3('این غذا در ساعت فعلی سرو نمی‌شود.', 'This item is not served at this time.', 'لا يقدم هذا العنصر في الوقت الحالي.'),
        stock: t3('موجودی کافی برای این تعداد باقی نمانده است.', 'There is not enough stock left for this quantity.', 'لا توجد كمية كافية متبقية لهذا العدد.'),
        price: t3('قیمت معتبر ثبت نشده؛ افزودن به سفارش ممکن نیست.', 'A valid price is not configured; this item cannot be ordered.', 'لم يتم إعداد سعر صالح؛ لا يمكن طلب هذا العنصر.'),
        unsafe_total: t3('مبلغ سفارش خارج از محدوده مجاز است.', 'The order amount exceeds the supported limit.', 'يتجاوز مبلغ الطلب الحد المسموح.'),
        configuration: t3('گزینه‌های این غذا نیازمند بازبینی منو هستند.', 'This item’s options need menu review.', 'تحتاج خيارات هذا العنصر إلى مراجعة القائمة.'),
        invalid_configuration: t3('گزینه‌های این غذا معتبر نیستند.', 'This item’s options are invalid.', 'خيارات هذا العنصر غير صالحة.'),
        too_many_selections: t3('تعداد گزینه‌های انتخاب‌شده معتبر نیست.', 'Too many options were selected.', 'تم اختيار عدد كبير من الخيارات.'),
        invalid_selection: t3('انتخاب نامعتبر است؛ گزینه‌ها را دوباره بررسی کنید.', 'An invalid option was selected. Review your choices.', 'تم اختيار خيار غير صالح. راجع اختياراتك.'),
        selection_count: t3('انتخاب‌های لازم را کامل کنید.', 'Complete the required choices.', 'أكمل الاختيارات المطلوبة.'),
      };
      els.detailModifierMessage.textContent = pricing.ok ? '' : (messages[pricing.error] || messages.selection_count);
      els.detailModifierMessage.hidden = pricing.ok;
    }
    if (els.detailAdd) {
      els.detailAdd.disabled = !pricing.ok;
      els.detailAdd.textContent = pricing.ok
        ? (i18n()?.t ? i18n().t('cm.add') : t3('افزودن به سبد', 'Add to cart', 'أضف إلى السلة'))
        : (pricing.error === 'selection_count'
          ? t3('انتخاب گزینه‌های لازم', 'Choose required options', 'اختر الخيارات المطلوبة')
          : t3('افزودن در دسترس نیست', 'Unavailable', 'غير متاح'));
    }
    $('#cm-detail-dec')?.toggleAttribute('disabled', detailQty <= 1);
    const remainingStock = menuItemStockRemaining(detailItem);
    $('#cm-detail-inc')?.toggleAttribute('disabled', detailQty >= 99 || (remainingStock !== null && detailQty >= remainingStock) || (pricing.ok && !Number.isSafeInteger(pricing.unitPrice * (detailQty + 1))));
    if (els.detailQty) {
      els.detailQty.textContent = detailQty.toLocaleString(localeTag());
      els.detailQty.setAttribute('aria-label', `${t3('تعداد', 'Quantity', 'الكمية')} ${detailQty.toLocaleString(localeTag())}`);
    }
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
      if (item.available !== false && menuItemStockLimit(item) !== 0 && !availableFallback.has(id)) {
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
    const value = normalizeSearchText([
      item.name,
      item.en,
      item.ar,
      item.desc,
      item.descEn,
      item.descAr,
      cat ? catTitle(cat) : '',
    ].join(' '));
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

  function addToCart(item, qty, modifiers = []) {
    const q = Math.max(1, Math.min(99, Math.round(Number(qty) || 1)));
    const remainingStock = menuItemStockRemaining(item);
    if (remainingStock !== null && q > remainingStock) {
      toast(t3('موجودی کافی برای این تعداد باقی نمانده است.', 'There is not enough stock left for this quantity.', 'لا توجد كمية كافية متبقية لهذا العدد.'));
      return false;
    }
    const basePrice = safeMenuPrice(item?.price);
    const groups = menuRules?.normalizeGroups(item?.modifierGroups);
    const resolved = basePrice == null || item?.available !== true || !itemInDaypart(item)
      ? { ok: false }
      : menuRules?.resolveSelection(groups, modifiers, basePrice);
    if (!resolved?.ok || !Number.isSafeInteger(resolved.unitPrice * q)) {
      toast(t3('قیمت یا انتخاب‌های این غذا معتبر نیست؛ سفارش ثبت نشد.', 'The price or options are invalid; item was not added.', 'السعر أو الخيارات غير صالحة؛ لم تتم الإضافة.'));
      return false;
    }
    const cartItem = { ...item, modifiers: resolved.modifiers.map(({ groupId, id }) => ({ groupId, id })) };
    if (window.westoTable?.addDirect) {
      // table-cart owns badge/drawer + its own toast
      return window.westoTable.addDirect(cartItem, q, {
        modifiers: cartItem.modifiers,
        activeDayparts,
      });
    }
    const cart = loadCart();
    const signature = JSON.stringify(cartItem.modifiers.map(({ groupId, id }) => [groupId, id]).sort((a, b) => `${a[0]}:${a[1]}`.localeCompare(`${b[0]}:${b[1]}`)));
    const found = cart.find((l) => l.menuItemId === item.id && l.modifierSignature === signature);
    if (found) found.qty += q;
    else {
      cart.push({
        menuItemId: item.id,
        name: item.name,
        en: item.en,
        ar: item.ar,
        price: item.price,
        unitTotal: resolved.unitPrice,
        modifiers: resolved.modifiers,
        modifierSignature: signature,
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
    return true;
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
    const q = menuRules?.normalizeSearchText(query) ?? query.trim().toLowerCase();
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
    const allBtn = `<button type="button" class="cm-cat${activeCat === 'all' ? ' is-active' : ''}" data-cat="all" aria-current="${activeCat === 'all' ? 'true' : 'false'}" aria-pressed="${activeCat === 'all' ? 'true' : 'false'}">
      ${allThumb ? `<img class="cm-cat__thumb" src="${esc(allThumb)}" alt="" loading="lazy" />` : `<span class="cm-cat__thumb--empty" aria-hidden="true"></span>`}
      <span class="cm-cat__label">${esc(allLabel)}</span>
    </button>`;
    els.tabs.innerHTML =
      allBtn +
      categories
        .map((c) => {
          const thumb = catThumbs[c.id];
          const selected = String(c.id) === String(activeCat);
          return `<button type="button" class="cm-cat${selected ? ' is-active' : ''}" data-cat="${esc(c.id)}" aria-current="${selected ? 'true' : 'false'}" aria-pressed="${selected ? 'true' : 'false'}">
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
          `<button type="button" class="cm-chip${excludeAllergens.has(a.id) ? ' is-on' : ''}" style="min-width:44px;min-height:44px;touch-action:manipulation" data-allergen="${esc(a.id)}" aria-pressed="${excludeAllergens.has(a.id) ? 'true' : 'false'}">${esc(
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
    els.meta.textContent = `${list.length.toLocaleString(localeTag())} ${t3('غذا', 'items', 'عنصر')}`;
  }

  function cardPriceMarkup(price) {
    const amount = safeMenuPrice(price);
    if (amount == null) return `<span class="cm-item__price-unknown">${esc(t3('قیمت اعلام نشده', 'Price unavailable', 'السعر غير معلن'))}</span>`;
    const value = formatUiNumber(amount);
    const unit = i18n()?.t ? i18n().t('currency.toman') : t3('تومان', 'Toman', 'تومان');
    const unitMarkup = unit === 'تومان' ? '<small>تومان</small>' : `<small>${esc(unit)}</small>`;
    return `<strong>${esc(value)}</strong>${unitMarkup}`;
  }

  function emptyGridMessage(itemCount, categoryEmpty) {
    if (itemCount === 0) {
      return t3(
        'منوی فعالی برای این رستوران منتشر نشده است.',
        'No menu has been published for this restaurant yet.',
        'لم تُنشر قائمة لهذا المطعم بعد.',
      );
    }
    if (categoryEmpty) {
      return t3('هنوز غذایی در این دسته نیست', 'No dishes in this category yet', 'لا أطباق في هذه الفئة بعد');
    }
    return t3('موردی با این فیلتر پیدا نشد', 'No dishes match these filters', 'لا توجد أطباق مطابقة');
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
      const msg = emptyGridMessage((items || []).length, catEmpty);
      els.grid.innerHTML = `<p class="cm-empty" role="status" aria-live="polite">${esc(msg)}</p>`;
      return;
    }

    let featuredUsed = false;
    els.grid.innerHTML = list
      .map((m) => {
        const out = m.available !== true;
        const outOfStock = menuItemStockLimit(m) === 0;
        const off = !itemInDaypart(m);
        const menuPrice = safeMenuPrice(m.price);
        const priceKnown = menuPrice != null;
        const orderBlocked = out || outOfStock || off || !priceKnown;
        const name = itemName(m);
        const sub = itemSub(m);
        const summary = itemDesc(m);
        const featured = !featuredUsed && m.featured && !out && !outOfStock;
        if (featured) featuredUsed = true;
        const spokenPrice = priceKnown
          ? `${formatUiNumber(menuPrice)} ${i18n()?.t ? i18n().t('currency.toman') : t3('تومان', 'Toman', 'تومان')}`
          : t3('قیمت اعلام نشده', 'Price unavailable', 'السعر غير معلن');
        const badge = outOfStock
          ? t3('ناموجود', 'Sold out', 'غير متوفر')
          : out
          ? (m.available === false ? t3('ناموجود', 'Sold out', 'غير متوفر') : t3('وضعیت نامشخص', 'Availability unknown', 'التوفر غير معروف'))
          : off
            ? t3('در این ساعت سرو نمی‌شود', 'Not served now', 'لا يقدم الآن')
            : !priceKnown
              ? t3('قیمت نامشخص', 'Price unavailable', 'السعر غير متاح')
              : '';
        return `<article class="cm-item${featured ? ' is-featured' : ''}${orderBlocked ? ' is-unavailable' : ''}" data-id="${esc(m.id)}" role="button" tabindex="0" aria-haspopup="dialog" aria-controls="cm-detail" aria-label="${esc(`${name}، ${spokenPrice}${badge ? `، ${badge}` : ''}`)}">
          <div class="cm-item__media">${m.img ? `<img src="${esc(m.img)}" alt="" loading="lazy" />` : ''}</div>
          <div class="cm-item__body">
            <h3 class="cm-item__name">${esc(name)}</h3>
            ${sub ? `<p class="cm-item__en" dir="auto">${esc(sub)}</p>` : ''}
            ${summary ? `<p class="cm-item__summary">${esc(summary)}</p>` : ''}
            <p class="cm-item__price">${cardPriceMarkup(m.price)}</p>
            ${badge ? `<span class="cm-item__badge">${esc(badge)}</span>` : ''}
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

  function openDetail(item, { preserve = false } = {}) {
    const wasHidden = els.detail.hidden;
    const sameItem = detailItem && Number(detailItem.id) === Number(item.id);
    detailItem = item;
    if (!preserve || !sameItem) {
      detailQty = 1;
      detailGroups = menuRules?.normalizeGroups(item?.modifierGroups) || { ok: false, groups: [] };
      detailSelection = Object.create(null);
    }
    if (els.detailQty) els.detailQty.textContent = detailQty.toLocaleString(localeTag());
    if (els.detailName) els.detailName.textContent = itemName(item);
    if (els.detailSub) els.detailSub.textContent = itemSub(item);
    if (els.detailDesc) els.detailDesc.textContent = itemDesc(item);
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
    renderDetailModifiers();
    if (els.detailModifierMessage) els.detailModifierMessage.hidden = true;
    if (els.detailAdd) els.detailAdd.disabled = true;
    updateDetailPurchaseState();
    // The option list must remain reachable on small screens; expanded mode
    // gives the detail sheet a real scroll region instead of clipping fields.
    setDetailExpanded(Boolean(detailGroups.ok && detailGroups.groups.length));
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
    if (detailItem) openDetail(detailItem, { preserve: true });
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
    els.grid.setAttribute('aria-busy', 'true');
    els.grid.innerHTML = `<p class="cm-empty" role="status">${esc(i18n()?.t ? i18n().t('cm.loading') : t3('در حال بارگذاری…', 'Loading…', 'جاري التحميل…'))}</p>`;

    try {
      // Use the guest-orderable catalogue for this QR branch. The unfiltered
      // `all=1` view can show branch-stocked-out items as purchasable.
      const r = await fetch(publicMenuRequestUrl({ branch: cartBranch }), {
        credentials: 'same-origin',
        cache: 'no-cache',
        signal: bootController?.signal,
      });
      if (!r.ok) throw new Error(`menu request failed (${r.status})`);
      const d = await r.json();
      if (generation !== bootGeneration) return;
      if (!d || !Array.isArray(d.menuItems) || (!Array.isArray(d.menuCategories) && !Array.isArray(d.siteCategories))) {
        throw new Error('menu response is missing catalogue collections');
      }

      if (d.i18n && i18n()?.syncFromConfig) i18n().syncFromConfig(d.i18n);
      items = d.menuItems;
      allergens = Array.isArray(d.allergens) ? d.allergens : [];
      activeDayparts = Array.isArray(d.activeDayparts) ? d.activeDayparts : [];
      const hasCover = (c) => {
        const cover = String(c?.coverImg || '').trim();
        return !!cover && !/assets\/textures\/westo_texture_/i.test(cover);
      };
      const siteCategories = Array.isArray(d.siteCategories) ? d.siteCategories : [];
      const menuCategories = Array.isArray(d.menuCategories) ? d.menuCategories : [];
      if (siteCategories.length) {
        categories = siteCategories.filter((c) => c && hasCover(c));
      } else {
        categories = menuCategories.filter((c) => c && !c.hiddenOnSite && hasCover(c));
      }

      rebuildIndexes();
      buildCatThumbs();

      const params = new URLSearchParams(location.search);
      query = initialMenuSearchQuery(params);
      if (els.search) els.search.value = query;
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
      els.grid.setAttribute('aria-busy', 'false');
    } catch (error) {
      if (generation !== bootGeneration) return;
      if (error?.name === 'AbortError' && document.visibilityState === 'hidden') return;
      els.grid.innerHTML = `<div class="cm-empty cm-empty--error" role="alert"><p>${esc(i18n()?.t ? i18n().t('cm.loadFail') : t3('بارگذاری منو ناموفق بود؛ هیچ کالایی به‌صورت حدسی نمایش داده نمی‌شود.', 'Menu could not be loaded; no guessed items are shown.', 'تعذر تحميل القائمة؛ لن نعرض عناصر تخمينية.'))}</p><button type="button" class="cm-retry" id="cm-retry">${esc(t3('تلاش دوباره', 'Try again', 'إعادة المحاولة'))}</button></div>`;
    } finally {
      if (generation === bootGeneration) {
        els.grid.setAttribute('aria-busy', 'false');
        if (bootTimeout) clearTimeout(bootTimeout);
        bootTimeout = 0;
        bootController = null;
      }
    }
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('#cm-retry')) {
      void boot();
      return;
    }
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
      updateDetailPurchaseState();
      return;
    }
    if (e.target.closest('#cm-detail-dec')) {
      detailQty = Math.max(1, detailQty - 1);
      updateDetailPurchaseState();
      return;
    }
    if (e.target.closest('#cm-detail-add') && detailItem) {
      const pricing = detailPricing();
      if (pricing.ok && addToCart(detailItem, detailQty, pricing.modifiers)) closeDetail();
    }
  });

  els.detailModifiers?.addEventListener('change', (event) => {
    const input = event.target.closest('input[data-modifier-group][data-modifier-option]');
    if (!input || input.disabled) return;
    const group = detailGroups.groups.find((entry) => entry.id === input.dataset.modifierGroup);
    if (!group) return;
    const chosen = new Set(detailSelection[group.id] || []);
    if (group.selection === 'single') {
      detailSelection[group.id] = input.value ? [input.value] : [];
    } else if (input.checked) {
      chosen.add(input.value);
      if (chosen.size > group.maxSelections) {
        input.checked = false;
        if (els.detailModifierMessage) {
          els.detailModifierMessage.textContent = t3(`حداکثر ${group.maxSelections} گزینه از «${group.title}» قابل انتخاب است.`, `Choose no more than ${group.maxSelections} from “${group.title}”.`, `اختر ${group.maxSelections} كحد أقصى من «${group.title}».`);
          els.detailModifierMessage.hidden = false;
        }
        return;
      }
      detailSelection[group.id] = [...chosen];
    } else {
      chosen.delete(input.value);
      detailSelection[group.id] = [...chosen];
    }
    if (els.detailModifierMessage) els.detailModifierMessage.hidden = true;
    updateDetailPurchaseState();
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
    if (detailItem) openDetail(detailItem, { preserve: true });
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
