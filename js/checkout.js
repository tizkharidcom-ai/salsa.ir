(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]));
  const i18n = () => window.westoI18n || null;
  const lang = () => i18n()?.lang || 'fa';
  const tr = (key, vars) => i18n()?.t?.(key, vars) || key;
  const localeTag = () => (lang() === 'fa' ? 'fa-IR' : lang() === 'ar' ? 'ar-SA' : 'en-US');
  const fmtNumber = (value, options = {}) => window.WestoPersianFormat?.number(value, { ...options, locale: localeTag() }) ?? Number(value || 0).toLocaleString(localeTag(), options);
  const fmtMoney = (value) => `${fmtNumber(value)} ${tr('currency.toman')}`;
  const fmtNum = (value) => fmtNumber(value);
  const itemName = (item) => i18n()?.itemName?.(item) || String(item?.name || '');
  const itemDesc = (item) => i18n()?.itemDesc?.(item) || String(item?.desc || '');
  const categoryTitle = (category) => i18n()?.catTitle?.(category) || String(category?.title || category?.name || '');
  const localizedName = (obj) =>
    i18n()?.pickLocalized?.(obj, 'name', 'nameEn', 'nameAr') || String(obj?.name || '');
  const imageSrc = (value) =>
    /^https?:\/\//i.test(String(value || ''))
      ? String(value)
      : `/${String(value || '').replace(/^\//, '')}`;
  const normalizeDigits = (value) =>
    String(value || '')
      .replace(/[۰-۹]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))
      .replace(/[٠-٩]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit));
  const qrContext = () => {
    const params = new URLSearchParams(location.search);
    const tableNo = normalizeDigits(params.get('table') || '').replace(/\D/g, '').slice(0, 20);
    const rawBranch = normalizeDigits(params.get('branch') || params.get('branchId') || '').replace(/\D/g, '');
    const branchId = rawBranch ? Number(rawBranch) : null;
    return { tableNo, branchId };
  };

  const state = {
    categories: [],
    items: [],
    itemById: new Map(),
    itemsByCategory: new Map(),
    cart: new Map(),
    branchId: null,
    branchLoading: false,
    zones: [],
    payment: { onlineEnabled: false },
    quote: null,
    quoteSignature: '',
    quoteChange: null,
    quoteRetryable: false,
    pendingModifierItem: null,
    pendingModifierQuantity: 1,
    modifierTrigger: null,
    reorderModifierQueue: [],
    restoringReorder: false,
    submitting: false,
    idempotencyKey: '',
    idempotencySignature: '',
    receiptCode: '',
    receiptSignature: '',
    receiptStorageKey: '',
    receiptPreparationSignature: '',
    receiptPreparationPromise: null,
    uncertainIntent: null,
    currentStage: 'basket',
    checkoutComplete: false,
    booted: false,
    booting: false,
    addressSaveOutcomeUnknown: false,
  };

  let quoteTimer = 0;
  let quoteController = null;
  let quoteGeneration = 0;
  let metaController = null;
  let metaGeneration = 0;
  let bootController = null;
  let bootGeneration = 0;
  let branchChangeGeneration = 0;
  let listenersBound = false;

  function abortController(controller) {
    try {
      controller?.abort();
    } catch (_) { }
  }

  function isAbortError(error) {
    return error?.name === 'AbortError';
  }

  async function api(url, options = {}) {
    const {
      signal: outerSignal,
      timeoutMs = 12000,
      headers: providedHeaders,
      ...fetchOptions
    } = options;

    const controller = new AbortController();
    let timeout = 0;
    let detachOuterAbort = null;

    if (outerSignal) {
      if (outerSignal.aborted) {
        controller.abort();
      } else {
        const onAbort = () => controller.abort();
        outerSignal.addEventListener('abort', onAbort, { once: true });
        detachOuterAbort = () => outerSignal.removeEventListener('abort', onAbort);
      }
    }

    if (timeoutMs > 0) {
      timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    }

    const headers = fetchOptions.body
      ? { 'Content-Type': 'application/json', ...(providedHeaders || {}) }
      : providedHeaders;

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        credentials: 'same-origin',
        headers,
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(body.message || body.error || tr('checkout.serverError'));
        error.code = body.code || body.error || '';
        error.status = response.status;
        throw error;
      }
      return body;
    } finally {
      if (timeout) window.clearTimeout(timeout);
      detachOuterAbort?.();
    }
  }

  function activeFulfillment() {
    return document.querySelector('input[name="fulfillment"]:checked')?.value || 'dine_in';
  }

  function lineItems() {
    return [...state.cart.values()].map((line) => ({
      menuItemId: line.menuItemId,
      qty: line.qty,
      modifiers: line.modifiers.map(({ id, groupId }) => ({ id, groupId })),
    }));
  }

  function checkoutOrderPayload({ includeQuoteToken = true } = {}) {
    const payload = {
      items: lineItems(),
      branchId: state.branchId,
      fulfillment: activeFulfillment(),
      tableNo: $('checkout-table')?.value.trim() || '',
      deliveryZoneId: $('checkout-zone')?.value || '',
      deliveryAddress: $('checkout-address')?.value.trim() || '',
      deliveryInstructions: $('checkout-instructions')?.value.trim() || '',
      name: $('checkout-name')?.value.trim() || '',
      phone: $('checkout-phone')?.value.trim() || '',
      paymentMethod: $('checkout-payment')?.value || 'cashier',
      redeemPoints: state.redeemPoints || 0,
      note: $('checkout-note')?.value.trim() || '',
    };
    if (includeQuoteToken) payload.quoteToken = state.quote?.quoteToken || '';
    return payload;
  }

  function checkoutIntentSignature(payload) {
    const intentPayload = { ...payload };
    delete intentPayload.quoteToken;
    return JSON.stringify(intentPayload);
  }

  function formatReceiptCode(code) {
    return String(code || '').match(/.{1,8}/g)?.join('-') || '';
  }

  function setReceiptCodeView(code, message = '') {
    const codeBox = $('checkout-receipt-code-box');
    const receipt = $('checkout-success-receipt-code');
    const display = formatReceiptCode(code);
    setHidden(codeBox, !(state.currentStage === 'review' && state.cart.size));
    setText($('checkout-receipt-code'), display);
    setText($('checkout-success-receipt-code-value'), display);
    setHidden(receipt, !display);
    setText($('checkout-receipt-code-status'), message);
    setText($('checkout-success-receipt-code-status'), '');
  }

  function prepareCheckoutReceiptCode(payload = checkoutOrderPayload({ includeQuoteToken: false })) {
    const signature = checkoutIntentSignature(payload);
    if (!payload.items?.length || state.currentStage !== 'review') return Promise.resolve(null);
    if (state.receiptSignature === signature && state.receiptCode) return Promise.resolve(state.receiptCode);
    if (state.receiptPreparationSignature === signature && state.receiptPreparationPromise) return state.receiptPreparationPromise;

    state.receiptCode = '';
    state.receiptSignature = '';
    state.receiptStorageKey = '';
    state.receiptPreparationSignature = signature;
    state.receiptPreparationError = '';
    setReceiptCodeView('', 'کد امن در حال آماده‌سازی است…');
    const submitButton = $('checkout-submit');
    if (submitButton) submitButton.disabled = true;

    const preparation = (async () => {
      const storageKey = await checkoutIntentStorageKey(signature);
      const code = await getOrCreateCheckoutIdempotencyKey(storageKey);
      if (state.currentStage !== 'review' || checkoutIntentSignature(checkoutOrderPayload({ includeQuoteToken: false })) !== signature) return null;
      state.receiptCode = code;
      state.receiptSignature = signature;
      state.receiptStorageKey = storageKey;
      setReceiptCodeView(code, 'این کد را پیش از ثبت یادداشت یا کپی کنید؛ برای پیگیری سفارش به آن نیاز دارید.');
      renderTotals();
      return code;
    })().catch((error) => {
      if (state.receiptPreparationSignature !== signature) return null;
      state.receiptPreparationError = error?.code || 'checkout_secure_random_unavailable';
      setReceiptCodeView('', error?.code === 'checkout_pending_intent_unresolved'
        ? 'یک سفارش قبلی هنوز نتیجهٔ قطعی ندارد. برای جلوگیری از ثبت تکراری، ابتدا با کد قبلی پیگیری کنید.'
        : 'ساخت یا نگه‌داری کد امن ممکن نشد؛ سفارش ارسال نشده است. ذخیره‌سازی مرورگر را بررسی و دوباره تلاش کنید.');
      const button = $('checkout-submit');
      if (button) button.disabled = true;
      setMessage(checkoutErrorMessage(error), 'error');
      return null;
    }).finally(() => {
      if (state.receiptPreparationSignature === signature) state.receiptPreparationPromise = null;
    });
    state.receiptPreparationPromise = preparation;
    return preparation;
  }

  function cartLines() {
    const lines = [];
    for (const [key, line] of state.cart.entries()) {
      const item = state.itemById.get(Number(line.menuItemId));
      if (item) lines.push({ key, ...line, item });
    }
    return lines;
  }

  function modifierGroupsForItem(item) {
    return (Array.isArray(item?.modifierGroups) ? item.modifierGroups : []).map((group) => ({
      ...group,
      options: (Array.isArray(group.options) ? group.options : []).filter((option) => option?.available !== false),
    }));
  }

  function modifierMinimum(group) {
    const min = Number(group?.minSelections);
    return Number.isInteger(min) && min >= 0 && min <= 16 ? min : (group?.required === true ? 1 : 0);
  }

  function modifierMaximum(group) {
    const activeOptions = (Array.isArray(group?.options) ? group.options : []).filter((option) => option?.available !== false).length;
    if (group?.selection === 'single') return Math.min(1, activeOptions);
    const max = Number(group?.maxSelections);
    return Math.min(Number.isInteger(max) && max >= 1 && max <= 16 ? max : 16, activeOptions);
  }

  function requiredModifierGroups(item) {
    return modifierGroupsForItem(item).filter((group) => modifierMinimum(group) > 0);
  }

  function validateModifiers(item, modifiers = []) {
    if (!Array.isArray(modifiers) || modifiers.length > 12) return { valid: false, missing: [] };
    const groups = modifierGroupsForItem(item);
    const counts = new Map();
    const seen = new Set();

    for (const modifier of modifiers) {
      const group = groups.find((candidate) => String(candidate.id) === String(modifier?.groupId));
      const option = group?.options.find((candidate) => String(candidate.id) === String(modifier?.id));
      if (!group || !option || seen.has(`${group.id}:${option.id}`)) return { valid: false, missing: [] };
      seen.add(`${group.id}:${option.id}`);
      counts.set(String(group.id), (counts.get(String(group.id)) || 0) + 1);
    }

    const missing = groups.filter((group) => (counts.get(String(group.id)) || 0) < modifierMinimum(group));
    const exceeded = groups.filter((group) => (counts.get(String(group.id)) || 0) > modifierMaximum(group));
    return { valid: missing.length === 0 && exceeded.length === 0, missing, exceeded };
  }

  function cartLineKey(menuItemId, modifiers = []) {
    const signature = modifiers
      .map((modifier) => `${String(modifier.groupId)}:${String(modifier.id)}`)
      .sort();
    return `${Number(menuItemId)}::${JSON.stringify(signature)}`;
  }

  function addToCart(menuItemId, modifiers = [], quantity = 1) {
    // A pending request owns an immutable snapshot of the cart. Do not let a
    // late menu/dialog interaction change that snapshot while we are waiting
    // for the server to confirm it.
    if (state.submitting || state.uncertainIntent) return false;
    const id = Number(menuItemId);
    const item = state.itemById.get(id);
    if (!item) return false;
    const validation = validateModifiers(item, modifiers);
    if (!validation.valid) {
      const missing = validation.missing.map((group) => `${group.title} (${fmtNum(modifierMinimum(group))})`).filter(Boolean).join('، ');
      setMessage(
        missing
          ? `برای افزودن این کالا، حداقل تعداد گزینهٔ لازم را انتخاب کنید: ${missing}.`
          : validation.exceeded.length
            ? `تعداد انتخاب‌های «${validation.exceeded[0].title}» از حد مجاز بیشتر است.`
          : 'گزینه‌های این کالا معتبر نیستند؛ دوباره از منو انتخاب کنید.',
        'error',
      );
      return false;
    }

    const canonicalModifiers = modifiers.map((modifier) => {
      const group = modifierGroupsForItem(item).find((candidate) => String(candidate.id) === String(modifier.groupId));
      const option = group.options.find((candidate) => String(candidate.id) === String(modifier.id));
      return {
        id: option.id,
        groupId: group.id,
        groupTitle: group.title,
        name: option.name,
        price: Math.max(0, Number(option.price) || 0),
      };
    });
    const key = cartLineKey(id, canonicalModifiers);
    const existing = state.cart.get(key);
    const nextQty = Math.min(99, (Number(existing?.qty) || 0) + Math.max(1, Math.round(Number(quantity) || 1)));
    state.cart.set(key, { menuItemId: id, qty: nextQty, modifiers: canonicalModifiers });
    setMessage('');
    renderCart();
    if (!state.restoringReorder) refreshQuote();
    return true;
  }

  function rebuildIndexes() {
    state.itemById.clear();
    state.itemsByCategory.clear();

    for (const item of state.items) {
      const itemId = Number(item.id);
      const categoryId = Number(item.categoryId);
      state.itemById.set(itemId, item);
      if (!state.itemsByCategory.has(categoryId)) {
        state.itemsByCategory.set(categoryId, []);
      }
      state.itemsByCategory.get(categoryId).push(item);
    }
  }

  function setMessage(text = '', kind = '') {
    const message = $('checkout-message');
    if (!message) return;
    const nextClass = `msg${text ? ` ${kind}` : ''}`;
    if (message.className !== nextClass) message.className = nextClass;
    message.setAttribute?.('role', kind === 'error' ? 'alert' : 'status');
    message.setAttribute?.('aria-live', kind === 'error' ? 'assertive' : 'polite');
    message.setAttribute?.('aria-atomic', 'true');
    if (!text || kind !== 'error') message.removeAttribute?.('data-validation-field');
    if (message.textContent !== text) message.textContent = text;
  }

  function focusCheckoutMessage() {
    const message = $('checkout-message');
    if (!message) return;
    if (!message.hasAttribute?.('tabindex')) message.setAttribute?.('tabindex', '-1');
    message.focus?.({ preventScroll: true });
  }

  function appendDescribedBy(element, id) {
    if (!element || !id) return;
    const ids = new Set(String(element.getAttribute?.('aria-describedby') || '').split(/\s+/).filter(Boolean));
    ids.add(id);
    element.setAttribute?.('aria-describedby', [...ids].join(' '));
  }

  function removeDescribedBy(element, id) {
    if (!element || !id) return;
    const ids = String(element.getAttribute?.('aria-describedby') || '').split(/\s+/).filter((value) => value && value !== id);
    if (ids.length) element.setAttribute?.('aria-describedby', ids.join(' '));
    else element.removeAttribute?.('aria-describedby');
  }

  function ensureCheckoutAccessibility() {
    const form = $('checkout-form');
    if (form && !form.getAttribute?.('aria-label') && !form.getAttribute?.('aria-labelledby')) {
      form.setAttribute('aria-label', 'اطلاعات دریافت و ثبت سفارش');
    }

    const cart = $('checkout-cart');
    if (cart) {
      if (!cart.getAttribute?.('role')) cart.setAttribute('role', 'region');
      if (!cart.getAttribute?.('aria-label')) cart.setAttribute('aria-label', 'اقلام انتخاب‌شده در سبد سفارش');
      if (!cart.getAttribute?.('tabindex')) cart.setAttribute('tabindex', '-1');
    }
    const side = document.querySelector('.checkout-side');
    if (side && !side.getAttribute?.('tabindex')) side.setAttribute('tabindex', '-1');

    const statuses = [
      $('checkout-message'),
      $('checkout-live'),
      $('checkout-note-text'),
      $('checkout-payment-note'),
      $('cart-count'),
    ];
    statuses.forEach((element) => {
      if (!element) return;
      if (!element.getAttribute?.('role')) element.setAttribute('role', 'status');
      if (!element.getAttribute?.('aria-live')) element.setAttribute('aria-live', 'polite');
      element.setAttribute('aria-atomic', 'true');
    });

    const success = $('checkout-success');
    if (success) {
      success.setAttribute('role', 'region');
      success.setAttribute('aria-labelledby', 'checkout-success-title');
      success.setAttribute('aria-describedby', 'checkout-success-body');
      success.setAttribute('aria-live', 'polite');
      success.setAttribute('aria-atomic', 'true');
      success.setAttribute('tabindex', '-1');
    }

    const descriptions = {
      'checkout-table': 'برای سفارش داخل مجموعه، شماره میز را وارد کنید.',
      'checkout-zone': 'محدوده ارسال باید با شعبه انتخاب‌شده مطابقت داشته باشد.',
      'checkout-address': 'نشانی دقیق، شامل خیابان و پلاک را وارد کنید.',
      'checkout-phone': 'شماره همراه باید ۱۱ رقم و با ۰۹ شروع شود.',
    };
    for (const [id, text] of Object.entries(descriptions)) {
      const field = $(id);
      if (!field) continue;
      const hintId = `${id}-hint`;
      let hint = document.getElementById(hintId);
      if (!hint) {
        const wrapper = field.closest?.('label');
        if (!wrapper || !document.createElement) continue;
        hint = document.createElement('small');
        hint.id = hintId;
        hint.className = 'checkout-field-hint';
        hint.textContent = text;
        wrapper.appendChild(hint);
      }
      appendDescribedBy(field, hintId);
    }

    const fallbackLabels = {
      'checkout-branch': 'شعبه',
      'checkout-table': 'شماره میز',
      'checkout-zone': 'محدوده ارسال',
      'checkout-address': 'آدرس دقیق تحویل',
      'checkout-name': 'نام سفارش‌گیرنده',
      'checkout-phone': 'شماره موبایل',
      'checkout-payment': 'روش پرداخت',
      'checkout-note': 'یادداشت سفارش',
      'checkout-instructions': 'توضیح برای پیک',
    };
    for (const [id, label] of Object.entries(fallbackLabels)) {
      const field = $(id);
      if (field && !field.getAttribute?.('aria-label') && !field.closest?.('label') && !field.labels?.length) {
        field.setAttribute('aria-label', label);
      }
    }

    const fulfillment = activeFulfillment();
    $('checkout-branch')?.setAttribute?.('aria-required', 'true');
    $('checkout-table')?.setAttribute?.('aria-required', String(fulfillment === 'dine_in'));
    $('checkout-zone')?.setAttribute?.('aria-required', String(fulfillment === 'delivery'));
    $('checkout-address')?.setAttribute?.('aria-required', String(fulfillment === 'delivery'));
    $('checkout-name')?.setAttribute?.('aria-required', 'true');
    $('checkout-phone')?.setAttribute?.('aria-required', 'true');
    $('checkout-payment')?.setAttribute?.('aria-required', 'true');
  }

  function checkoutValidationStage(fieldId) {
    if (fieldId === 'checkout-cart') return 'سبد سفارش';
    if (['checkout-branch', 'checkout-table', 'checkout-zone', 'checkout-address'].includes(fieldId)) return 'اطلاعات دریافت';
    if (['checkout-name', 'checkout-phone'].includes(fieldId)) return 'اطلاعات گیرنده';
    if (fieldId === 'checkout-payment') return 'روش پرداخت';
    return 'ثبت سفارش';
  }

  function clearCheckoutFieldError(field) {
    if (!field?.id) return;
    const errorId = `${field.id}-error`;
    field.removeAttribute?.('aria-invalid');
    removeDescribedBy(field, errorId);
    const error = document.getElementById(errorId);
    error?.remove?.();
    const message = $('checkout-message');
    if (message?.getAttribute?.('data-validation-field') === field.id) setMessage('');
  }

  function setHidden(element, hidden) {
    if (element && element.hidden !== hidden) element.hidden = hidden;
  }

  function setText(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  const CHECKOUT_STAGES = ['basket', 'fulfillment', 'customer', 'review'];
  const CHECKOUT_STAGE_TITLES = {
    basket: 'انتخاب غذا و بررسی سبد',
    fulfillment: 'نحوه دریافت سفارش',
    customer: 'اطلاعات مشتری و پرداخت',
    review: 'بازبینی نهایی سفارش',
  };

  function checkoutStageForField(fieldId) {
    if (fieldId === 'checkout-cart') return 'basket';
    if (['checkout-branch', 'checkout-table', 'checkout-zone', 'checkout-address'].includes(fieldId)) return 'fulfillment';
    if (['checkout-name', 'checkout-phone', 'checkout-payment'].includes(fieldId)) return 'customer';
    return 'review';
  }

  function showCheckoutStage(stageId, { focus = true, announce = true } = {}) {
    if (state.checkoutComplete || !CHECKOUT_STAGES.includes(stageId)) return false;
    if ((state.submitting || state.uncertainIntent) && stageId !== state.currentStage) return false;
    const stageIndex = CHECKOUT_STAGES.indexOf(stageId);
    state.currentStage = stageId;

    setHidden($('checkout-stage-basket'), stageId !== 'basket');
    setHidden($('checkout-form'), stageId === 'basket');
    for (const panelId of ['fulfillment', 'customer', 'review']) {
      setHidden($(`checkout-panel-${panelId}`), stageId !== panelId);
    }
    setHidden($('checkout-stepper'), false);

    CHECKOUT_STAGES.forEach((id, index) => {
      const item = $(`checkout-step-${id}`);
      const label = $(`checkout-step-label-${id}`);
      if (item?.dataset) item.dataset.state = index === stageIndex ? 'current' : index < stageIndex ? 'complete' : 'upcoming';
      if (index === stageIndex) label?.setAttribute?.('aria-current', 'step');
      else label?.removeAttribute?.('aria-current');
    });

    if (announce) {
      setText($('checkout-stage-announcement'), `مرحله ${fmtNum(stageIndex + 1)} از ${fmtNum(CHECKOUT_STAGES.length)}: ${CHECKOUT_STAGE_TITLES[stageId]}`);
    }
    if (stageId === 'review') renderCheckoutReview();
    syncMobileCartShortcut();

    if (focus) {
      const heading = $(`checkout-stage-heading-${stageId}`);
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      requestAnimationFrame(() => {
        heading?.focus?.({ preventScroll: true });
        heading?.scrollIntoView?.({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
      });
    }
    return true;
  }

  function validateFulfillmentFields() {
    const fulfillment = activeFulfillment();
    const branch = $('checkout-branch');
    const table = $('checkout-table');
    const zone = $('checkout-zone');
    const address = $('checkout-address');

    if (state.branchLoading) return { field: 'checkout-branch', message: 'در حال دریافت اطلاعات این شعبه هستیم؛ چند لحظه دیگر دوباره ادامه دهید.' };
    if (!state.branchId || (branch && !branch.value)) return { field: 'checkout-branch', message: 'لطفاً شعبهٔ موردنظر را انتخاب کنید.' };
    if (branch && Number(branch.value) !== Number(state.branchId)) {
      return { field: 'checkout-branch', message: 'انتخاب شعبه هنوز با اطلاعات بارگذاری‌شده هماهنگ نیست؛ دوباره شعبه را انتخاب کنید.' };
    }
    if (fulfillment === 'dine_in' && !normalizeDigits(table?.value || '').trim()) {
      return { field: 'checkout-table', message: 'برای سفارش داخل مجموعه، شماره میز را وارد کنید.' };
    }
    if (fulfillment === 'delivery') {
      const selectedZone = String(zone?.value || '');
      const zoneExists = state.zones.some((item) => String(item.id) === selectedZone && Number(item.branchId) === Number(state.branchId));
      if (!selectedZone || !zoneExists) return { field: 'checkout-zone', message: 'محدودهٔ ارسال را برای همین شعبه انتخاب کنید.' };
      if (!String(address?.value || '').trim()) return { field: 'checkout-address', message: 'برای ارسال با پیک، نشانی دقیق تحویل را وارد کنید.' };
    }
    return null;
  }

  function validateCustomerFields() {
    const name = $('checkout-name');
    const phone = $('checkout-phone');
    const payment = $('checkout-payment');
    if (!String(name?.value || '').trim()) return { field: 'checkout-name', message: 'نام سفارش‌گیرنده را وارد کنید.' };
    const normalizedPhone = normalizeDigits(phone?.value || '').trim();
    if (!/^09\d{9}$/.test(normalizedPhone)) {
      return { field: 'checkout-phone', message: 'شماره موبایل باید ۱۱ رقم و با ۰۹ شروع شود.' };
    }
    const paymentMethod = String(payment?.value || '').trim();
    if (!['cashier', 'online'].includes(paymentMethod)) {
      return { field: 'checkout-payment', message: 'روش پرداخت معتبر نیست؛ یکی از روش‌های موجود را انتخاب کنید.' };
    }
    if (paymentMethod === 'online' && !checkoutOnlineAvailable()) {
      return { field: 'checkout-payment', message: 'پرداخت آنلاین در این محیط فعال نیست؛ پرداخت در صندوق یا هنگام تحویل را انتخاب کنید.' };
    }
    return null;
  }

  function validateCheckoutStage(stageId) {
    if (stageId === 'basket') {
      return state.cart.size ? null : { field: 'checkout-cart', message: 'سبد سفارش خالی است؛ ابتدا یک غذا انتخاب کنید.' };
    }
    if (stageId === 'fulfillment') return validateFulfillmentFields();
    if (stageId === 'customer') return validateCustomerFields();
    return null;
  }

  function advanceCheckoutStage() {
    const currentIndex = CHECKOUT_STAGES.indexOf(state.currentStage);
    const nextStage = CHECKOUT_STAGES[currentIndex + 1];
    if (!nextStage) return false;
    const validation = validateCheckoutStage(state.currentStage);
    if (validation) {
      reportGuestCheckoutError(validation);
      return false;
    }
    setMessage('');
    return showCheckoutStage(nextStage);
  }

  function goToPreviousCheckoutStage() {
    const previousStage = CHECKOUT_STAGES[CHECKOUT_STAGES.indexOf(state.currentStage) - 1];
    if (!previousStage) return false;
    setMessage('');
    return showCheckoutStage(previousStage);
  }

  function paymentRedirectUrl(payment) {
    if (!payment || payment.provider === 'sandbox' || payment.status !== 'pending') return '';
    const raw = String(payment.redirectUrl || payment.checkoutUrl || '').trim();
    if (!raw || raw.startsWith('//')) return '';
    try {
      const current = new URL(globalThis.location?.href || window.location?.href);
      const target = new URL(raw, current);
      if (target.username || target.password || target.protocol !== 'https:') return '';
      return target.href;
    } catch (_) {
      return '';
    }
  }

  function checkoutErrorMessage(error) {
    const messages = {
      checkout_intent_storage_unavailable: 'مرورگر نتوانست شناسهٔ امن درخواست را ذخیره یا بازیابی کند. سفارش ارسال نشد تا از ثبت تکراری جلوگیری شود؛ تنظیمات حریم خصوصی یا ذخیره‌سازی مرورگر را بررسی کنید و دوباره تلاش کنید.',
      checkout_secure_random_unavailable: 'مرورگر امکان ساخت کد امن را ندارد. برای جلوگیری از ثبت سفارش بدون کد پیگیری، سفارش ارسال نشد؛ مرورگر امن‌تری را امتحان کنید.',
      checkout_pending_intent_unresolved: 'یک سفارش قبلی هنوز نتیجهٔ قطعی ندارد. با کد رسید قبلی آن را پیگیری کنید و سفارش تازه نسازید.',
      receipt_code_invalid: 'کد رسید معتبر نیست؛ آن را دوباره بررسی کنید.',
      receipt_not_found: 'سفارشی با این کد پیدا نشد؛ کد را بررسی کنید یا با شعبه تماس بگیرید.',
      public_order_rate_limited: 'تعداد تلاش‌ها زیاد است؛ کمی بعد دوباره امتحان کنید.',
      name_required: 'نام گیرنده را وارد کنید.',
      payment_provider_not_ready: 'پرداخت آنلاین در حال حاضر در دسترس نیست؛ پرداخت در صندوق یا هنگام تحویل را انتخاب کنید.',
      checkout_quote_required: 'پیش‌فاکتور معتبر نیست؛ مبلغ سفارش را دوباره محاسبه کنید.',
      checkout_quote_stale: 'قیمت یا اطلاعات سفارش تغییر کرده است؛ مبلغ جدید را بررسی کنید.',
      checkout_quote_invalid: 'پیش‌فاکتور پاسخ معتبر نداد؛ مبلغ سفارش را دوباره محاسبه کنید.',
      checkout_tax_snapshot_unavailable: 'این شعبه فعلاً امکان ثبت سفارش ندارد؛ لطفاً با شعبه تماس بگیرید.',
      checkout_tax_delivery_rule_missing: 'ارسال آنلاین این شعبه فعلاً در دسترس نیست؛ لطفاً با شعبه تماس بگیرید.',
      checkout_tax_payable_mismatch: 'مبلغ سفارش برای این شعبه قابل تأیید نشد؛ لطفاً با شعبه تماس بگیرید.',
      idempotency_key_conflict: 'این کلید به درخواست دیگری وصل است و ممکن است سفارش قبلی ثبت شده باشد؛ برای جلوگیری از سفارش تکراری، اول وضعیت سفارش را از مسیر پیگیری یا شعبه بررسی کنید.',
      idempotency_replay_unavailable: 'وضعیت سفارش قبلی با اطمینان بازیابی نشد؛ برای جلوگیری از ثبت تکراری، سفارش را دوباره ثبت نکنید و با شعبه یا پشتیبانی پیگیری کنید.',
      checkout_order_confirmation_unknown: 'پاسخ کامل ثبت سفارش دریافت نشد؛ ممکن است سفارش ثبت شده باشد. برای بررسی امن، همین درخواست را دوباره بفرستید تا همان کلید استفاده شود.',
      table_or_branch_invalid: 'شعبه یا شماره میز معتبر نیست؛ آن‌ها را دوباره بررسی کنید.',
      payment_provider_unavailable: 'درگاه پرداخت فعلاً پاسخ نمی‌دهد؛ روش پرداخت دیگری انتخاب کنید یا بعداً دوباره تلاش کنید.',
      delivery_zone_unavailable: 'این محدوده برای شعبهٔ انتخاب‌شده فعال نیست؛ محدودهٔ دیگری انتخاب کنید.',
      delivery_minimum_not_met: 'مبلغ سفارش به حداقل این محدودهٔ ارسال نمی‌رسد؛ مبلغ را افزایش دهید یا محدودهٔ دیگری انتخاب کنید.',
      phone_invalid: 'شماره موبایل معتبر نیست؛ شماره‌ای ۱۱ رقمی و با ۰۹ وارد کنید.',
      phone_required: 'برای پیگیری سفارش، شماره موبایل را وارد کنید.',
      delivery_address_required: 'برای ارسال با پیک، نشانی دقیق تحویل را وارد کنید.',
      branch_not_found: 'شعبه پیدا نشد؛ شعبهٔ دیگری انتخاب و دوباره تلاش کنید.',
    };
    const code = String(error?.code || error?.message || '');
    if (messages[code]) return messages[code];
    if (error?.name === 'TypeError') return 'ارتباط با سرور برقرار نشد؛ اتصال را بررسی کنید و دوباره تلاش کنید.';
    if (Number(error?.status) >= 500) return 'سرور نتوانست نتیجهٔ ثبت سفارش را تأیید کند.';
    if (/^[a-z][a-z0-9_]{2,}$/.test(code)) return 'در بررسی سفارش مشکلی پیش آمد. اطلاعات را دوباره بررسی کنید؛ اگر نتیجهٔ ثبت نامشخص است، سفارش تازه‌ای ثبت نکنید و وضعیت را پیگیری کنید.';
    return String(error?.message || tr('checkout.serverError'));
  }

  function checkoutErrorField(error) {
    const code = String(error?.code || '');
    const codeFields = {
      delivery_zone_unavailable: 'checkout-zone',
      delivery_minimum_not_met: 'checkout-zone',
      payment_provider_not_ready: 'checkout-payment',
      payment_provider_unavailable: 'checkout-payment',
      phone_invalid: 'checkout-phone',
      phone_required: 'checkout-phone',
      delivery_address_required: 'checkout-address',
      branch_not_found: 'checkout-branch',
    };
    if (codeFields[code]) return codeFields[code];
    if (code === 'table_or_branch_invalid') {
      return activeFulfillment() === 'dine_in' ? 'checkout-table' : 'checkout-branch';
    }

    // Some legacy validation paths return Persian copy without a stable code.
    const message = String(error?.message || error?.error || '');
    if (/شماره\s*میز/.test(message)) return 'checkout-table';
    if (/شماره\s*موبایل|شماره\s*همراه/.test(message)) return 'checkout-phone';
    if (/آدرس\s*تحویل|نشانی/.test(message)) return 'checkout-address';
    if (/شعبه/.test(message)) return 'checkout-branch';
    return '';
  }

  function checkoutOutcomeMayBeUnknown(error) {
    if (error?.outcomeUnknown || isAbortError(error) || error?.name === 'TypeError') return true;
    const status = Number(error?.status) || 0;
    const code = String(error?.code || '');
    if (status === 408 || code === 'postgres_state_write_conflict') return true;
    if (['idempotency_key_conflict', 'idempotency_replay_unavailable'].includes(code)) return true;
    // These failures are returned before an order/payment is created.
    if (['payment_provider_not_ready', 'feature_entitlement_unavailable', 'public_order_rate_limited'].includes(code)) return false;
    return status >= 500;
  }

  function setCheckoutSubmitting(submitting) {
    state.submitting = !!submitting;
    const form = $('checkout-form');
    if (!form) return;
    if (state.submitting) form.setAttribute?.('aria-busy', 'true');
    else form.removeAttribute?.('aria-busy');

    const controls = form.querySelectorAll?.('input, select, textarea, button') || [];
    controls.forEach((control) => {
      if (state.submitting) {
        if (!Object.prototype.hasOwnProperty.call(control, '__checkoutDisabledBeforeSubmit')) {
          control.__checkoutDisabledBeforeSubmit = !!control.disabled;
        }
        control.disabled = true;
      } else if (Object.prototype.hasOwnProperty.call(control, '__checkoutDisabledBeforeSubmit')) {
        control.disabled = control.__checkoutDisabledBeforeSubmit;
        delete control.__checkoutDisabledBeforeSubmit;
      }
    });
  }

  function lockUncertainCheckout(intent) {
    const wasLocked = !!state.uncertainIntent;
    state.uncertainIntent = intent;
    $('checkout-form')?.setAttribute?.('data-checkout-outcome', intent.manualFollowup ? 'followup' : 'unknown');
    if (wasLocked) return;

    const form = $('checkout-form');
    const controls = form?.querySelectorAll?.('input, select, textarea, button') || [];
    controls.forEach((control) => {
      if (control.id === 'checkout-submit') return;
      if (!Object.prototype.hasOwnProperty.call(control, '__checkoutDisabledBeforeUncertain')) {
        control.__checkoutDisabledBeforeUncertain = !!control.disabled;
      }
      control.disabled = true;
    });
    const reviewButton = $('checkout-price-review-accept');
    if (reviewButton) {
      reviewButton.__checkoutDisabledBeforeUncertain = !!reviewButton.disabled;
      reviewButton.disabled = true;
    }
    renderCart();
    const categories = $('checkout-categories');
    renderItems(Number(categories?.dataset?.selected) || null);
  }

  function clearUncertainCheckout() {
    if (!state.uncertainIntent) return;
    const form = $('checkout-form');
    const controls = form?.querySelectorAll?.('input, select, textarea, button') || [];
    controls.forEach((control) => {
      if (!Object.prototype.hasOwnProperty.call(control, '__checkoutDisabledBeforeUncertain')) return;
      control.disabled = control.__checkoutDisabledBeforeUncertain;
      delete control.__checkoutDisabledBeforeUncertain;
    });
    const reviewButton = $('checkout-price-review-accept');
    if (reviewButton && Object.prototype.hasOwnProperty.call(reviewButton, '__checkoutDisabledBeforeUncertain')) {
      reviewButton.disabled = reviewButton.__checkoutDisabledBeforeUncertain;
      delete reviewButton.__checkoutDisabledBeforeUncertain;
    }
    form?.removeAttribute?.('data-checkout-outcome');
    state.uncertainIntent = null;
    renderCart();
    const categories = $('checkout-categories');
    renderItems(Number(categories?.dataset?.selected) || null);
  }

  function checkoutOnlineAvailable() {
    const payment = state.payment || {};
    const mode = String(payment.mode || '').trim().toLowerCase();
    const provider = String(payment.provider || '').trim().toLowerCase();
    return payment.onlineEnabled === true
      && payment.gatewayReady === true
      && ['live', 'production'].includes(mode)
      && !!provider
      && !['sandbox', 'test', 'mock', 'demo', 'unavailable'].includes(provider);
  }

  function validateGuestCheckout() {
    if (!state.cart.size) return { field: 'checkout-cart', message: 'سبد سفارش خالی است؛ ابتدا یک غذا انتخاب کنید.' };
    return validateFulfillmentFields() || validateCustomerFields();
  }

  function reportGuestCheckoutError(validation) {
    const fieldIds = ['checkout-branch', 'checkout-table', 'checkout-zone', 'checkout-address', 'checkout-name', 'checkout-phone', 'checkout-payment'];
    fieldIds.forEach((id) => clearCheckoutFieldError($(id)));
    const fieldId = validation?.field || '';
    const field = fieldId === 'checkout-cart' ? $('checkout-cart') : fieldId && $(fieldId);
    const messageText = validation?.message || '';
    const stage = checkoutValidationStage(fieldId);
    if (fieldId && !state.checkoutComplete) showCheckoutStage(checkoutStageForField(fieldId), { focus: false, announce: true });
    setMessage(messageText ? `${stage}: ${messageText}` : '', 'error');
    const message = $('checkout-message');
    if (message && fieldId) message.setAttribute?.('data-validation-field', fieldId);
    if (field && fieldId !== 'checkout-cart') {
      field.setAttribute?.('aria-invalid', 'true');
      const errorId = `${field.id}-error`;
      let error = document.getElementById(errorId);
      if (!error && document.createElement) {
        error = document.createElement('small');
        error.id = errorId;
        error.className = 'checkout-field-error';
        field.closest?.('label')?.appendChild(error);
      }
      if (error) {
        error.textContent = messageText;
        appendDescribedBy(field, errorId);
      }
    } else if (fieldId === 'checkout-cart') {
      field.setAttribute?.('aria-invalid', 'true');
    }
    field?.focus?.();
  }

  function ensureMobileCartShortcut() {
    if (!$('checkout-mobile-cart') && document.body?.appendChild && document.createElement) {
      const shortcut = document.createElement('button');
      shortcut.id = 'checkout-mobile-cart';
      shortcut.type = 'button';
      shortcut.className = 'checkout-mobile-cart';
      shortcut.hidden = true;
      shortcut.setAttribute('aria-controls', 'checkout-cart checkout-form');
      shortcut.addEventListener('click', () => {
        if (!showCheckoutStage('basket', { focus: false })) return;
        const target = document.querySelector('.checkout-side');
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        target?.focus?.({ preventScroll: true });
        target?.scrollIntoView?.({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
      });
      document.body.appendChild(shortcut);
    }
  }

  function syncMobileCartShortcut() {
    const shortcut = $('checkout-mobile-cart');
    if (!shortcut) return;
    const lines = cartLines();
    const count = lines.reduce((sum, line) => sum + line.qty, 0);
    if (!count || state.checkoutComplete || state.submitting || state.uncertainIntent) {
      shortcut.hidden = true;
      return;
    }
    const quote = state.quote?.ok && state.quoteSignature === currentQuoteSignature() ? state.quote : null;
    const amount = quote ? quotePriceSnapshot(quote).total : estimateVisiblePrices(lines).total;
    shortcut.textContent = `رفتن به سبد · ${fmtNum(count)} قلم · ${fmtMoney(amount)}`;
    shortcut.setAttribute('aria-label', `رفتن به سبد سفارش، ${fmtNum(count)} قلم، ${fmtMoney(amount)}`);
    shortcut.hidden = false;
  }

  function renderCategories(selected = null) {
    const nav = $('checkout-categories');
    if (!nav) return;

    const categories = state.categories.filter((category) => {
      const items = state.itemsByCategory.get(Number(category.id));
      return Array.isArray(items) && items.length > 0;
    });

    if (!categories.some((category) => Number(category.id) === Number(selected))) {
      selected = categories[0]?.id || null;
    }

    nav.dataset.selected = selected || '';
    nav.innerHTML = categories
      .map(
        (category) =>
          `<button type="button" class="checkout-category ${Number(category.id) === Number(selected) ? 'is-active' : ''}" data-category="${category.id}" aria-pressed="${Number(category.id) === Number(selected)}">${esc(categoryTitle(category))}</button>`,
      )
      .join('');

    renderItems(selected);
  }

  function renderItems(categoryId) {
    const nav = $('checkout-categories');
    const itemsRoot = $('checkout-items');
    if (!nav || !itemsRoot) return;

    const selected = Number(categoryId || nav.dataset.selected);
    nav.dataset.selected = String(selected || '');

    nav.querySelectorAll('[data-category]').forEach((button) => {
      button.classList.toggle(
        'is-active',
        Number(button.dataset.category) === selected,
      );
      button.setAttribute('aria-pressed', String(Number(button.dataset.category) === selected));
    });

    const items = state.itemsByCategory.get(selected) || [];
    itemsRoot.innerHTML =
      items
        .map((item) => {
          const requiredGroups = requiredModifierGroups(item);
          const unavailableRequiredGroup = requiredGroups.some((group) => group.options.length < modifierMinimum(group));
          const addDisabled = unavailableRequiredGroup || state.submitting || !!state.uncertainIntent;
          return `
      <article class="checkout-item">
        <div class="checkout-item__image">${item.img ? `<img src="${esc(imageSrc(item.img))}" alt="${esc(itemName(item))}" loading="lazy" decoding="async" />` : ''}</div>
        <div class="checkout-item__body"><h2>${esc(itemName(item))}</h2><p>${esc(itemDesc(item))}</p>${requiredGroups.length ? `<small class="checkout-item__required">انتخاب در ${fmtNum(requiredGroups.length)} بخش الزامی</small>` : ''}<div class="checkout-item__bottom"><b>${fmtMoney(item.price)}</b><button class="checkout-add" type="button" data-add="${item.id}" ${addDisabled ? 'disabled aria-disabled="true"' : ''} aria-label="${esc(unavailableRequiredGroup ? `گزینهٔ لازم برای ${itemName(item)} موجود نیست` : requiredGroups.length ? `انتخاب گزینه‌های لازم و افزودن ${itemName(item)}` : tr('checkout.addItem', { name: itemName(item) }))}">+</button></div></div>
      </article>`;
        })
        .join('') || `<p class="checkout-cart-empty">${esc(tr('checkout.emptyCategory'))}</p>`;
  }

  function modifierDialogMarkup(item) {
    const groups = modifierGroupsForItem(item);
    return groups.map((group, groupIndex) => {
      const minimum = modifierMinimum(group);
      const maximum = modifierMaximum(group);
      const required = minimum > 0;
      const type = group.selection === 'single' ? 'radio' : 'checkbox';
      const choices = group.options.map((option, optionIndex) => `
        <label class="checkout-modifier-option" for="checkout-modifier-${groupIndex}-${optionIndex}">
          <input id="checkout-modifier-${groupIndex}-${optionIndex}" type="${type}" name="checkout-modifier-${groupIndex}" data-modifier-choice data-group-index="${groupIndex}" data-option-index="${optionIndex}" ${required && type === 'radio' ? 'required' : ''} />
          <span>${esc(option.name)}</span>
          ${Number(option.price) > 0 ? `<b>+ ${fmtMoney(option.price)}</b>` : ''}
        </label>`).join('');
      const guidance = required || maximum < (group.options || []).length
        ? `<small>${required ? `حداقل ${fmtNum(minimum)} مورد` : ''}${required && maximum < 16 ? ' · ' : ''}${maximum < 16 ? `حداکثر ${fmtNum(maximum)} مورد` : ''} را انتخاب کنید.</small>`
        : '';
      return `<fieldset class="checkout-modifier-group" data-modifier-group="${groupIndex}"><legend>${esc(group.title || 'انتخاب گزینه')}${required ? '<span class="checkout-modifier-required">الزامی</span>' : '<span class="checkout-modifier-optional">اختیاری</span>'}</legend>${guidance}<div class="checkout-modifier-options">${choices || '<p class="checkout-note">برای این انتخاب گزینهٔ فعالی وجود ندارد.</p>'}</div></fieldset>`;
    }).join('');
  }

  function closeModifierDialog(restoreFocus = true) {
    const dialog = $('checkout-modifier-dialog');
    if (dialog?.open && typeof dialog.close === 'function') dialog.close();
    else dialog?.removeAttribute?.('open');
    state.pendingModifierItem = null;
    state.pendingModifierQuantity = 1;
    const trigger = state.modifierTrigger;
    state.modifierTrigger = null;
    if (restoreFocus && trigger?.isConnected) trigger.focus();
  }

  function openModifierDialog(menuItemId, trigger = null, quantity = 1) {
    const item = state.itemById.get(Number(menuItemId));
    if (!item) return false;
    if (!modifierGroupsForItem(item).length) return addToCart(item.id, [], quantity);

    const dialog = $('checkout-modifier-dialog');
    const groupsRoot = $('checkout-modifier-groups');
    if (!dialog || !groupsRoot) {
      setMessage('امکان نمایش انتخاب‌های لازم وجود ندارد؛ این کالا فعلاً به سبد افزوده نشد.', 'error');
      return false;
    }
    state.pendingModifierItem = item;
    state.pendingModifierQuantity = Math.min(99, Math.max(1, Math.round(Number(quantity) || 1)));
    state.modifierTrigger = trigger;
    setText($('checkout-modifier-title'), itemName(item));
    setText($('checkout-modifier-price-note'), `قیمت گزینه‌های انتخاب‌شده در پیش‌فاکتور نهایی دوباره بررسی می‌شود. قیمت پایه: ${fmtMoney(item.price)}.`);
    groupsRoot.innerHTML = modifierDialogMarkup(item);
    if (typeof dialog.showModal === 'function') {
      try { dialog.showModal(); } catch (_) { dialog.setAttribute('open', ''); }
    } else {
      dialog.setAttribute('open', '');
    }
    $('checkout-modifier-groups')?.querySelector('input')?.focus();
    return true;
  }

  function selectedDialogModifiers() {
    const item = state.pendingModifierItem;
    if (!item) return [];
    const groups = modifierGroupsForItem(item);
    return [...($('checkout-modifier-groups')?.querySelectorAll('input[data-modifier-choice]:checked') || [])]
      .map((input) => {
        const group = groups[Number(input.dataset.groupIndex)];
        const option = group?.options[Number(input.dataset.optionIndex)];
        return group && option ? { id: option.id, groupId: group.id } : null;
      })
      .filter(Boolean);
  }

  function submitModifierDialog(event) {
    event.preventDefault();
    if (state.submitting || state.uncertainIntent) return;
    const item = state.pendingModifierItem;
    if (!item) return;
    const modifiers = selectedDialogModifiers();
    const validation = validateModifiers(item, modifiers);
    if (!validation.valid) {
      const missing = validation.missing.map((group) => `${group.title} (${fmtNum(modifierMinimum(group))})`).filter(Boolean).join('، ');
      const errorText = missing
        ? `برای ادامه، حداقل تعداد گزینهٔ لازم را انتخاب کنید: ${missing}.`
        : validation.exceeded.length
          ? `تعداد انتخاب‌های «${validation.exceeded[0].title}» از حد مجاز بیشتر است.`
        : 'انتخاب‌ها معتبر نیستند؛ لطفاً دوباره بررسی کنید.';
      setText($('checkout-modifier-error'), errorText);

      const groups = modifierGroupsForItem(item);
      const invalidGroup = validation.missing[0] || validation.exceeded[0];
      const invalidGroupIndex = groups.indexOf(invalidGroup);
      const choices = [...($('checkout-modifier-groups')?.querySelectorAll?.('[data-modifier-choice]') || [])];
      const invalidChoice = choices.find((choice) => Number(choice.dataset?.groupIndex) === invalidGroupIndex
        && (validation.missing.length ? !choice.checked : choice.checked))
        || choices[0];
      if (invalidChoice) {
        invalidChoice.setAttribute?.('aria-invalid', 'true');
        appendDescribedBy(invalidChoice, 'checkout-modifier-error');
        invalidChoice.focus?.();
      }
      return;
    }
    const quantity = state.pendingModifierQuantity;
    if (addToCart(item.id, modifiers, quantity)) {
      const advancingReorder = Number(state.reorderModifierQueue[0]?.menuItemId) === Number(item.id);
      if (advancingReorder) state.reorderModifierQueue.shift();
      closeModifierDialog();
      if (advancingReorder) openNextReorderModifier();
    }
  }

  function openNextReorderModifier() {
    while (state.reorderModifierQueue.length) {
      const next = state.reorderModifierQueue[0];
      const item = state.itemById.get(Number(next.menuItemId));
      if (!item) {
        state.reorderModifierQueue.shift();
        continue;
      }
      if (requiredModifierGroups(item).some((group) => group.options.length === 0)) {
        state.reorderModifierQueue.shift();
        setMessage(`گزینهٔ اجباری «${itemName(item)}» در حال حاضر موجود نیست و به سبد اضافه نشد.`, 'error');
        continue;
      }
      openModifierDialog(item.id, null, next.quantity);
      return;
    }
    state.restoringReorder = false;
    refreshQuote();
  }

  function cancelModifierDialog() {
    const currentIsReorder = Number(state.reorderModifierQueue[0]?.menuItemId) === Number(state.pendingModifierItem?.id);
    if (currentIsReorder) {
      const skipped = state.reorderModifierQueue.length;
      state.reorderModifierQueue = [];
      state.restoringReorder = false;
      setMessage(`انتخاب‌های لازم برای ${fmtNum(skipped)} قلم باقی‌مانده انجام نشد؛ آن اقلام به سبد اضافه نشدند.`, 'error');
    }
    closeModifierDialog();
    if (currentIsReorder) refreshQuote();
  }

  function clearModifierValidationError() {
    const groups = $('checkout-modifier-groups');
    groups?.querySelectorAll?.('[data-modifier-choice][aria-invalid="true"]')?.forEach?.((choice) => {
      choice.removeAttribute?.('aria-invalid');
      removeDescribedBy(choice, 'checkout-modifier-error');
    });
    setText($('checkout-modifier-error'), '');
  }

  function restoreReorderItems(items) {
    const pending = [];
    state.restoringReorder = true;
    for (const entry of Array.isArray(items) ? items : []) {
      const menuItemId = Number(entry?.menuItemId || entry?.id);
      const quantity = Math.min(99, Math.max(1, Math.round(Number(entry?.qty || entry?.quantity) || 1)));
      const item = state.itemById.get(menuItemId);
      if (!item) continue;
      const modifiers = Array.isArray(entry.modifiers) ? entry.modifiers : [];
      const hasRequiredGroups = requiredModifierGroups(item).length > 0;
      if (hasRequiredGroups && !validateModifiers(item, modifiers).valid) {
        pending.push({ menuItemId, quantity });
      } else if (!addToCart(menuItemId, modifiers, quantity)) {
        setMessage(`گزینه‌های لازم برای «${itemName(item)}» دوباره انتخاب شوند.`, 'error');
      }
    }
    state.reorderModifierQueue = pending;
    openNextReorderModifier();
  }

  function adjust(key, delta) {
    if (state.submitting || state.uncertainIntent) return;
    const lineKey = String(key || '');
    const line = state.cart.get(lineKey);
    if (!line) return;

    const next = Math.max(0, Math.min(99, Number(line.qty || 0) + Number(delta || 0)));
    if (next) state.cart.set(lineKey, { ...line, qty: next });
    else state.cart.delete(lineKey);

    renderCart();
    refreshQuote();
  }

  function estimateVisiblePrices(lines = cartLines()) {
    const subtotal = lines.reduce((sum, line) => {
      const optionsTotal = (line.modifiers || []).reduce((value, modifier) => value + Math.max(0, Number(modifier.price) || 0), 0);
      return sum + (Math.max(0, Number(line.item.price) || 0) + optionsTotal) * line.qty;
    }, 0);
    const selectedZone = state.zones.find((zone) => String(zone.id) === String($('checkout-zone')?.value || ''));
    const deliveryFee = activeFulfillment() === 'delivery' ? Math.max(0, Number(selectedZone?.fee) || 0) : 0;
    return { subtotal, tierDiscountToman: 0, pointsDiscountToman: 0, deliveryFee, total: Math.max(0, subtotal + deliveryFee) };
  }

  function quotePriceSnapshot(quote) {
    const pointsDiscountToman = Math.max(0, Number(quote?.pointsDiscountToman) || 0);
    const totalDiscount = Math.max(0, Number(quote?.discount) || 0);
    const tierDiscountToman = Math.max(0, Number(quote?.tierDiscountToman ?? Math.max(0, totalDiscount - pointsDiscountToman)) || 0);
    const deliveryFee = Math.max(0, Number(quote?.deliveryFee) || 0);
    const subtotal = Math.max(0, Number(quote?.subtotal) || 0);
    const total = Math.max(0, Number(quote?.total) || 0);
    return { subtotal, tierDiscountToman, pointsDiscountToman, deliveryFee, total };
  }

  function validateCheckoutQuote(quote) {
    const validFulfillments = ['dine_in', 'pickup', 'delivery'];
    const validAmount = (value) => Number.isSafeInteger(value) && value >= 0;
    const amountsValid = quote
      && ['subtotal', 'deliveryFee', 'total'].every((key) => validAmount(quote[key]))
      && quote.tax?.inclusive === true && validAmount(quote.tax.totalTaxIrr)
      && ['discount', 'tierDiscountToman', 'pointsDiscountToman'].every((key) => quote[key] === undefined || validAmount(quote[key]));
    const pointsDiscount = Number(quote?.pointsDiscountToman || 0);
    const totalDiscount = quote?.discount === undefined
      ? Number(quote?.tierDiscountToman || 0) + pointsDiscount
      : Number(quote.discount);
    const tierDiscount = quote?.tierDiscountToman === undefined
      ? Math.max(0, totalDiscount - pointsDiscount)
      : Number(quote.tierDiscountToman);
    const grossTotal = Number(quote?.subtotal) + Number(quote?.deliveryFee);
    const amountsConsistent = amountsValid
      && Number.isSafeInteger(grossTotal)
      && Number.isSafeInteger(totalDiscount)
      && tierDiscount + pointsDiscount === totalDiscount
      && totalDiscount <= grossTotal
      && Number(quote.total) === grossTotal - totalDiscount;
    if (quote?.ok !== true
      || typeof quote.quoteToken !== 'string'
      || !quote.quoteToken.trim()
      || quote.quoteToken.length > 2048
      || !validFulfillments.includes(quote.fulfillment)
      || quote.fulfillment !== activeFulfillment()
      || !amountsConsistent) {
      throw Object.assign(new Error('پیش‌فاکتور پاسخ کامل و قابل‌اعتماد نداد.'), {
        code: 'checkout_quote_invalid',
        status: 502,
      });
    }
    return quote;
  }

  function quotePriceChanges(before, after) {
    const labels = {
      subtotal: 'مبلغ اقلام سفارش',
      tierDiscountToman: 'تخفیف باشگاه',
      pointsDiscountToman: 'تخفیف امتیاز',
      deliveryFee: 'هزینهٔ ارسال',
      total: 'مبلغ نهایی',
    };
    return Object.keys(labels)
      .filter((key) => Number(before?.[key] || 0) !== Number(after?.[key] || 0))
      .map((key) => ({ key, label: labels[key], before: Number(before?.[key] || 0), after: Number(after?.[key] || 0) }));
  }

  function applyQuote(quote, signature, before = estimateVisiblePrices()) {
    const after = quotePriceSnapshot(quote);
    const changes = quotePriceChanges(before, after);
    state.quote = quote;
    state.quoteSignature = signature;
    state.quoteChange = changes.length ? { before, after, changes, signature } : null;
  }

  function renderQuoteChange() {
    const panel = $('checkout-price-review');
    const rows = $('checkout-price-review-rows');
    if (!panel || !rows) return;
    const change = state.quoteChange;
    setHidden(panel, !change);
    if (!change) {
      rows.innerHTML = '';
      return;
    }
    rows.innerHTML = change.changes
      .map((entry) => `<li><span>${esc(entry.label)}</span><span><del>${fmtMoney(entry.before)}</del><b>${fmtMoney(entry.after)}</b></span></li>`)
      .join('');
  }

  function acceptQuoteChange() {
    if (state.uncertainIntent) return false;
    if (!state.quoteChange || state.quoteChange.signature !== currentQuoteSignature() || state.quoteSignature !== currentQuoteSignature()) {
      setMessage('پیش‌فاکتور تغییر کرده است؛ برای دیدن مبلغ قطعی دوباره محاسبه می‌کنیم.', 'error');
      refreshQuote();
      return false;
    }
    state.quoteChange = null;
    renderTotals();
    setText($('checkout-stage-announcement'), `مبلغ نهایی ${fmtMoney(quotePriceSnapshot(state.quote).total)} تأیید شد.`);
    $('checkout-next-fulfillment')?.focus?.({ preventScroll: true });
    return true;
  }

  function renderCart() {
    const cartRoot = $('checkout-cart');
    const count = $('cart-count');
    if (!cartRoot || !count) return;

    const lines = cartLines();
    if (lines.length) clearCheckoutFieldError(cartRoot);
    setText(
      count,
      tr('cart.itemsCount', { n: fmtNum(lines.reduce((sum, line) => sum + line.qty, 0)) }),
    );
    count.setAttribute?.('aria-label', `سبد سفارش، ${fmtNum(lines.reduce((sum, line) => sum + line.qty, 0))} قلم`);

    cartRoot.innerHTML =
      lines
        .map(
          (line) => {
            const modifierTotal = line.modifiers.reduce((sum, modifier) => sum + Number(modifier.price || 0), 0);
            const locked = state.submitting || !!state.uncertainIntent;
            const modifiers = line.modifiers.length
              ? `<small class="checkout-cart-line__modifiers">انتخاب‌ها: ${esc(line.modifiers.map((modifier) => `${modifier.name}${Number(modifier.price) > 0 ? ` (+${fmtMoney(modifier.price)})` : ''}`).join('، '))}</small>`
              : '';
            return `<div class="checkout-cart-line"><div><b>${esc(itemName(line.item))}</b><small>${fmtMoney(Number(line.item.price || 0) + modifierTotal)} · ${fmtNum(line.qty)} ${esc(tr('checkout.qtyUnit'))}</small>${modifiers}</div><div class="checkout-cart-line__actions"><button type="button" data-cart-subtract="${esc(line.key)}" ${locked ? 'disabled aria-disabled="true"' : ''} aria-label="${esc(`کم‌کردن یک ${itemName(line.item)} از سبد`)}">−</button><b aria-label="تعداد ${esc(itemName(line.item))}">${fmtNum(line.qty)}</b><button type="button" data-cart-add="${esc(line.key)}" ${locked ? 'disabled aria-disabled="true"' : ''} aria-label="${esc(`افزودن یک ${itemName(line.item)} به سبد`)}">+</button></div></div>`;
          },
        )
        .join('') || `<p class="checkout-cart-empty">${esc(tr('checkout.emptyCart'))}</p>`;

    renderTotals(lines);
  }

  function renderTotals(lines = cartLines()) {
    const totals = $('checkout-totals');
    const submitButton = $('checkout-submit');
    if (!totals || !submitButton) return;

    const quote = state.quote?.ok ? state.quote : null;
    const estimate = estimateVisiblePrices(lines);
    const amounts = quote ? quotePriceSnapshot(quote) : estimate;
    const subtotal = amounts.subtotal;
    const deliveryFee = amounts.deliveryFee;
    const tierDiscount = amounts.tierDiscountToman || 0;
    const pointsDiscount = amounts.pointsDiscountToman || 0;
    const total = quote ? amounts.total : Math.max(0, subtotal + deliveryFee - (tierDiscount + pointsDiscount));

    let html = `<div><span>${esc(tr('checkout.subtotal'))}</span><b>${fmtMoney(subtotal)}</b></div>`;
    if (tierDiscount) {
      html += `<div style="color:#a855f7;"><span>تخفیف باشگاه (${esc(quote?.tier?.name || 'وفاداری')}):</span><b>-${fmtMoney(tierDiscount)}</b></div>`;
    }
    if (pointsDiscount) {
      html += `<div style="color:#f59e0b;"><span>کسر امتیاز باشگاه (${fmtNum(quote?.pointsRedeemed || 0)} امتیاز):</span><b>-${fmtMoney(pointsDiscount)}</b></div>`;
    }
    if (quote?.tax?.inclusive === true && Number.isSafeInteger(quote.tax.totalTaxIrr) && quote.tax.totalTaxIrr >= 0) {
      html += `<div class="checkout-tax-included"><span>سهم مالیات (داخل قیمت‌ها)</span><b>${fmtNum(quote.tax.totalTaxIrr)} ریال</b></div>`;
    }
    if (deliveryFee) {
      html += `<div><span>${esc(tr('checkout.deliveryFee'))}</span><b>${fmtMoney(deliveryFee)}</b></div>`;
    }
    html += `<div class="is-total"><span>${esc(tr('checkout.payable'))}</span><b>${fmtMoney(total)}</b></div>`;

    totals.innerHTML = html;
    const quoteIsCurrent = !!state.quote?.quoteToken && state.quoteSignature === currentQuoteSignature();
    const receiptSignature = checkoutIntentSignature(checkoutOrderPayload({ includeQuoteToken: false }));
    const receiptReady = state.currentStage !== 'review' || state.quoteRetryable
      || (!!state.receiptCode && state.receiptSignature === receiptSignature);
    submitButton.disabled = !state.cart.size || state.submitting || state.branchLoading || (state.uncertainIntent
      ? !!state.uncertainIntent.manualFollowup
      : !!state.quoteChange || (!quoteIsCurrent && !state.quoteRetryable)) || !receiptReady;
    setText(
      submitButton,
      state.submitting
        ? 'در حال ثبت سفارش…'
        : state.branchLoading
          ? 'در حال دریافت اطلاعات شعبه…'
          : state.uncertainIntent?.manualFollowup
            ? 'نیاز به پیگیری سفارش'
            : state.uncertainIntent
              ? 'تلاش امن مجدد همان سفارش'
              : state.quoteRetryable
                ? 'تلاش دوباره برای محاسبه مبلغ'
                : $('checkout-payment')?.value === 'online' ? tr('checkout.continuePayment') : tr('cart.submit'),
    );
    if (state.submitting) submitButton.setAttribute('aria-busy', 'true');
    else submitButton.removeAttribute('aria-busy');
    renderQuoteChange();
    renderCheckoutReview(lines);
    syncMobileCartShortcut();
  }

  function renderCheckoutReview(lines = cartLines()) {
    const itemsRoot = $('checkout-review-items');
    if (!itemsRoot) return;
    itemsRoot.innerHTML = lines.map((line) => {
      const modifiers = line.modifiers || [];
      const unitPrice = Math.max(0, Number(line.item.price) || 0)
        + modifiers.reduce((sum, modifier) => sum + Math.max(0, Number(modifier.price) || 0), 0);
      const modifierText = modifiers.length
        ? `<small>${esc(modifiers.map((modifier) => modifier.name).join('، '))}</small>`
        : '';
      return `<li><span><b>${esc(itemName(line.item))}</b><small>${fmtNum(line.qty)} عدد · ${fmtMoney(unitPrice)} هر عدد</small>${modifierText}</span><strong>${fmtMoney(unitPrice * line.qty)}</strong></li>`;
    }).join('') || '<li class="checkout-cart-empty">سبد سفارش خالی است.</li>';

    const fulfillment = activeFulfillment();
    const fulfillmentText = {
      dine_in: 'داخل مجموعه',
      pickup: 'تحویل حضوری',
      delivery: 'ارسال با پیک',
    }[fulfillment] || fulfillment;
    const branch = $('checkout-branch');
    const zone = $('checkout-zone');
    const selectedText = (select, fallback) => select?.selectedOptions?.[0]?.textContent?.trim() || select?.value || fallback;
    const payment = $('checkout-payment');
    const paymentText = selectedText(payment, payment?.value === 'online' ? 'پرداخت آنلاین' : 'پرداخت در صندوق / هنگام تحویل');

    setText($('checkout-review-fulfillment'), fulfillmentText);
    setText($('checkout-review-branch'), selectedText(branch, state.branchId ? `شعبه ${fmtNum(state.branchId)}` : '—'));
    setHidden($('checkout-review-table-row'), fulfillment !== 'dine_in');
    setText($('checkout-review-table'), normalizeDigits($('checkout-table')?.value || '').trim() || '—');
    setHidden($('checkout-review-zone-row'), fulfillment !== 'delivery');
    setHidden($('checkout-review-address-row'), fulfillment !== 'delivery');
    setText($('checkout-review-zone'), selectedText(zone, '—'));
    setText($('checkout-review-address'), $('checkout-address')?.value?.trim() || '—');
    setText($('checkout-review-name'), $('checkout-name')?.value?.trim() || '—');
    setText($('checkout-review-phone'), normalizeDigits($('checkout-phone')?.value || '').trim() || '—');
    setText($('checkout-review-payment'), paymentText);

    const note = $('checkout-note')?.value?.trim() || '';
    const instructions = $('checkout-instructions')?.value?.trim() || '';
    setHidden($('checkout-review-note-row'), !note);
    setHidden($('checkout-review-instructions-row'), fulfillment !== 'delivery' || !instructions);
    setText($('checkout-review-note'), note);
    setText($('checkout-review-instructions'), instructions);

    const signature = currentQuoteSignature();
    const quoteIsCurrent = state.quote?.ok === true && !!state.quote.quoteToken && state.quoteSignature === signature;
    const amounts = quoteIsCurrent ? quotePriceSnapshot(state.quote) : estimateVisiblePrices(lines);
    const discount = (Number(amounts.tierDiscountToman) || 0) + (Number(amounts.pointsDiscountToman) || 0);
    setText($('checkout-review-subtotal'), fmtMoney(amounts.subtotal));
    setHidden($('checkout-review-delivery-row'), !amounts.deliveryFee);
    setText($('checkout-review-delivery'), fmtMoney(amounts.deliveryFee));
    setHidden($('checkout-review-discount-row'), !discount);
    setText($('checkout-review-discount'), `−${fmtMoney(discount)}`);
    const taxIrr = quoteIsCurrent ? state.quote.tax?.totalTaxIrr : null;
    setHidden($('checkout-review-tax-row'), !Number.isSafeInteger(taxIrr) || taxIrr < 0);
    if (Number.isSafeInteger(taxIrr) && taxIrr >= 0) setText($('checkout-review-tax'), `${fmtNum(taxIrr)} ریال · داخل قیمت منو`);
    setText($('checkout-review-total'), fmtMoney(amounts.total));
    setText($('checkout-review-total-label'), quoteIsCurrent ? 'مبلغ نهایی پیش‌فاکتور' : 'برآورد موقت');
    setText($('checkout-review-quote-status'), state.quoteChange
      ? 'مبلغ پیش‌فاکتور تغییر کرده است؛ برای دیدن و تأیید مبلغ تازه به مرحلهٔ سبد برگردید.'
      : quoteIsCurrent
        ? `مبلغ نهایی از پیش‌فاکتور معتبر سرور است؛ مالیات به‌صورت شامل در قیمت منو محاسبه شده است${Number.isSafeInteger(taxIrr) ? ` (سهم مالیات ${fmtNum(taxIrr)} ریال)` : ''}.`
        : 'هنوز پیش‌فاکتور معتبر سرور آماده نیست؛ مبلغ بالا برآورد موقت است و ثبت تا آماده‌شدن پیش‌فاکتور انجام نمی‌شود.');
    setHidden($('checkout-review-delivery-dependency'), fulfillment !== 'delivery');
    setHidden($('checkout-review-price-return'), !state.quoteChange);
    if (state.currentStage === 'review') prepareCheckoutReceiptCode(checkoutOrderPayload({ includeQuoteToken: false }));
  }

  function syncFulfillmentFields() {
    const fulfillment = activeFulfillment();
    setHidden($('checkout-table-wrap'), fulfillment !== 'dine_in');
    setHidden($('checkout-zone-wrap'), fulfillment !== 'delivery');
    setHidden($('checkout-address-wrap'), fulfillment !== 'delivery');
    setHidden($('checkout-instructions-wrap'), fulfillment !== 'delivery');
    setHidden($('checkout-saved-addresses-wrap'), fulfillment !== 'delivery' || !(state.userAddresses?.length));

    $('checkout-table')?.setAttribute?.('aria-required', String(fulfillment === 'dine_in'));
    $('checkout-zone')?.setAttribute?.('aria-required', String(fulfillment === 'delivery'));
    $('checkout-address')?.setAttribute?.('aria-required', String(fulfillment === 'delivery'));
    for (const id of ['checkout-table', 'checkout-zone', 'checkout-address']) {
      const field = $(id);
      if (field?.closest?.('label')?.hidden) clearCheckoutFieldError(field);
    }

    if (fulfillment === 'delivery' && state.userAddresses?.length) {
      renderCheckoutAddresses();
    }

    const submit = $('checkout-submit');
    const payment = $('checkout-payment');
    if (submit && payment) {
      setText(
        submit,
        payment.value === 'online' ? tr('checkout.continuePayment') : tr('cart.submit'),
      );
    }

    refreshQuote();
  }

  function renderCheckoutAddresses() {
    const wrap = $('checkout-saved-addresses-wrap');
    const list = $('checkout-addresses-list');
    if (!wrap || !list) return;

    const fulfillment = activeFulfillment();
    const addresses = state.userAddresses || [];

    if (fulfillment !== 'delivery' || !addresses.length) {
      setHidden(wrap, true);
      return;
    }

    setHidden(wrap, false);
    list.innerHTML = addresses.map((addr, idx) => {
      const isDef = !!addr.isDefault || idx === 0;
      const fullAddr = [
        addr.city,
        addr.district,
        addr.address,
        addr.plaque ? `پلاک ${addr.plaque}` : '',
        addr.unit ? `واحد ${addr.unit}` : '',
      ].filter(Boolean).join('، ');

      return `
        <label class="checkout-addr-option ${isDef ? 'is-default' : ''}">
          <input type="radio" name="selected_checkout_addr" value="${esc(addr.id)}" ${isDef ? 'checked' : ''} style="margin-top:0.2rem;" />
          <div style="flex:1; font-size:0.78rem;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <b class="checkout-addr-title">${esc(addr.title || '📍 نشانی')}</b>
              ${addr.isDefault ? '<span class="pill" style="font-size:0.65rem; background:#10b981; color:#fff; padding:0 0.35rem;">پیش‌فرض</span>' : ''}
            </div>
            <div class="checkout-addr-full" style="margin-top:0.15rem; line-height:1.35;">${esc(fullAddr)}</div>
          </div>
        </label>
      `;
    }).join('') + `
      <label class="checkout-addr-option is-custom">
        <input type="radio" name="selected_checkout_addr" value="custom" style="margin-top:0;" />
        <span class="checkout-addr-custom-text" style="font-size:0.75rem;">✍️ آدرس جدید یا دستی (وارد کردن در کادر زیر)</span>
      </label>
    `;

    // Automatically fill the default address if empty
    const addrField = $('checkout-address');
    if (!addrField?.value) {
      const defaultAddr = addresses.find((a) => a.isDefault) || addresses[0];
      if (defaultAddr) applyAddressToFields(defaultAddr);
    }

    list.querySelectorAll('input[name="selected_checkout_addr"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        list.querySelectorAll('.checkout-addr-option').forEach(o => {
          o.style.borderColor = 'rgba(255,255,255,0.1)';
        });
        radio.closest('.checkout-addr-option').style.borderColor = '#10b981';

        if (radio.value === 'custom') {
          if (addrField) {
            addrField.value = '';
            addrField.focus();
          }
        } else {
          const chosen = addresses.find((a) => String(a.id) === String(radio.value));
          if (chosen) applyAddressToFields(chosen);
        }
      });
    });
  }

  function applyAddressToFields(addr) {
    const fullAddr = [
      addr.city,
      addr.district,
      addr.address,
      addr.plaque ? `پلاک ${addr.plaque}` : '',
      addr.floor ? `طبقه ${addr.floor}` : '',
      addr.unit ? `واحد ${addr.unit}` : '',
    ].filter(Boolean).join('، ');

    const addrField = $('checkout-address');
    const noteField = $('checkout-instructions');
    if (addrField) addrField.value = fullAddr;
    if (noteField) noteField.value = String(addr.note || '');

    const nameField = $('checkout-name');
    const phoneField = $('checkout-phone');
    const receiverName = String(addr.receiverName || '').trim();
    const receiverPhone = String(addr.receiverPhone || '').trim();
    if (nameField && receiverName) nameField.value = receiverName;
    const phoneChanged = !!phoneField && !!receiverPhone && phoneField.value !== receiverPhone;
    if (phoneChanged) phoneField.value = receiverPhone;
    if (phoneChanged) refreshQuote();
  }

  function initCheckoutAddressModal() {
    const modal = $('address-modal');
    if (!modal) return;
    const addAddressButton = $('checkout-add-addr-btn');
    const closeModal = () => {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
      addAddressButton?.focus?.();
    };

    addAddressButton?.addEventListener('click', () => {
      $('modal-addr-id').value = '';
      $('modal-addr-title').value = '🏠 منزل';
      document.querySelectorAll('.addr-title-pill').forEach(pill => {
        pill.classList.toggle('is-active', pill.dataset.title === '🏠 منزل');
      });
      $('modal-addr-city').value = '';
      $('modal-addr-district').value = '';
      $('modal-addr-street').value = '';
      $('modal-addr-plaque').value = '';
      $('modal-addr-floor').value = '';
      $('modal-addr-unit').value = '';
      $('modal-addr-receiver-name').value = $('checkout-name')?.value || state.user?.name || '';
      $('modal-addr-receiver-phone').value = $('checkout-phone')?.value || state.user?.phone || '';
      $('modal-addr-note').value = '';
      $('modal-addr-default').checked = !(state.userAddresses?.length > 0);

      const msgEl = $('modal-addr-msg');
      if (msgEl) {
        msgEl.textContent = state.addressSaveOutcomeUnknown
          ? 'نتیجهٔ ذخیرهٔ قبلی مشخص نیست. برای جلوگیری از ثبت تکراری، اینجا دوباره ذخیره نکنید؛ نشانی را در حساب بررسی کنید یا آن را دستی در سفارش وارد کنید.'
          : '';
        msgEl.className = state.addressSaveOutcomeUnknown ? 'msg error' : 'msg';
        msgEl.setAttribute('role', state.addressSaveOutcomeUnknown ? 'alert' : 'status');
        msgEl.setAttribute('aria-live', state.addressSaveOutcomeUnknown ? 'assertive' : 'polite');
      }
      const saveButton = $('save-address-modal-btn');
      if (saveButton) {
        saveButton.disabled = state.addressSaveOutcomeUnknown;
        saveButton.textContent = state.addressSaveOutcomeUnknown ? 'وضعیت ذخیره نامشخص' : '💾 ذخیره نشانی';
      }

      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(() => $('modal-addr-city')?.focus?.({ preventScroll: true }));
    });

    $('close-address-modal-btn')?.addEventListener('click', () => {
      closeModal();
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    modal.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]):not([type="hidden"]), [href], [tabindex]:not([tabindex="-1"])')]
        .filter((element) => element.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    document.querySelectorAll('.addr-title-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.addr-title-pill').forEach(p => {
          p.style.color = 'var(--text-muted)';
          p.classList.remove('is-active');
          p.setAttribute('aria-pressed', 'false');
        });
        pill.classList.add('is-active');
        pill.style.color = '#10b981';
        pill.setAttribute('aria-pressed', 'true');
        $('modal-addr-title').value = pill.dataset.title;
      });
    });

    $('save-address-modal-btn')?.addEventListener('click', async () => {
      if (state.addressSaveOutcomeUnknown) return;
      const street = $('modal-addr-street').value.trim();
      const msgEl = $('modal-addr-msg');
      if (!street) {
        if (msgEl) {
          msgEl.className = 'msg error';
          msgEl.setAttribute('role', 'alert');
          msgEl.setAttribute('aria-live', 'assertive');
          msgEl.textContent = 'لطفاً نشانی پستی دقیق (خیابان، کوچه) را وارد کنید.';
        }
        return;
      }

      const btn = $('save-address-modal-btn');
      const payload = {
        title: $('modal-addr-title').value.trim(),
        city: $('modal-addr-city').value.trim(),
        district: $('modal-addr-district').value.trim(),
        address: street,
        plaque: $('modal-addr-plaque').value.trim(),
        floor: $('modal-addr-floor').value.trim(),
        unit: $('modal-addr-unit').value.trim(),
        receiverName: $('modal-addr-receiver-name').value.trim(),
        receiverPhone: $('modal-addr-receiver-phone').value.trim(),
        note: $('modal-addr-note').value.trim(),
        isDefault: $('modal-addr-default').checked,
      };
      const knownAddressIds = new Set((state.userAddresses || []).map((address) => String(address?.id || '')));
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      btn.textContent = 'در حال ذخیره…';

      try {
        const data = await api('/api/user/addresses', {
          method: 'POST',
          body: JSON.stringify(payload),
          timeoutMs: 15000,
        });

        if (data?.ok && data.address) {
          state.userAddresses = data.addresses || [];
          renderCheckoutAddresses();
          if (data.address) applyAddressToFields(data.address);
          closeModal();
        } else {
          const error = new Error(data?.error || 'ذخیرهٔ نشانی انجام نشد. اطلاعات را بررسی کنید.');
          error.status = 400;
          throw error;
        }
      } catch (error) {
        const status = Number(error?.status) || 0;
        const outcomeMayBeUnknown = isAbortError(error)
          || error?.name === 'TypeError'
          || !status
          || status === 408
          || status >= 500;

        if (outcomeMayBeUnknown) {
          // Address creation has no server idempotency contract. Reconcile by
          // reading the saved list before allowing any second POST.
          state.addressSaveOutcomeUnknown = true;
          try {
            const latest = await api('/api/user/addresses', { timeoutMs: 8000 });
            const addresses = Array.isArray(latest?.addresses) ? latest.addresses : [];
            const expected = {
              ...payload,
              receiverName: payload.receiverName || state.user?.name || '',
              receiverPhone: payload.receiverPhone || state.user?.phone || '',
            };
            const fieldLimits = {
              title: 50,
              city: 100,
              district: 100,
              address: 300,
              plaque: 20,
              floor: 20,
              unit: 20,
              receiverName: 100,
              receiverPhone: 30,
              note: 300,
            };
            const savedAddress = addresses.find((address) =>
              !knownAddressIds.has(String(address?.id || ''))
              && Object.entries(fieldLimits).every(([field, limit]) =>
                String(address?.[field] || '').trim().slice(0, limit)
                  === String(expected[field] || '').trim().slice(0, limit)));

            if (savedAddress) {
              state.addressSaveOutcomeUnknown = false;
              state.userAddresses = addresses;
              renderCheckoutAddresses();
              applyAddressToFields(savedAddress);
              closeModal();
              setMessage('نشانی ذخیره شد و به اطلاعات سفارش افزوده شد.');
              return;
            }
          } catch (_) {
            // Keep the save action locked if the read-after-write check also fails.
          }

          if (msgEl) {
            msgEl.className = 'msg error';
            msgEl.setAttribute('role', 'alert');
            msgEl.setAttribute('aria-live', 'assertive');
            msgEl.textContent = 'پاسخ ذخیرهٔ نشانی نرسید و نتیجه قطعی نیست. برای جلوگیری از نشانی تکراری، دوباره ذخیره نکنید؛ وضعیت را در حساب بررسی کنید یا نشانی را دستی در سفارش وارد کنید.';
          }
          return;
        }

        if (msgEl) {
          msgEl.className = 'msg error';
          msgEl.setAttribute('role', 'alert');
          msgEl.setAttribute('aria-live', 'assertive');
          msgEl.textContent = error?.message || 'خطا در ذخیره نشانی';
        }
      } finally {
        btn.removeAttribute('aria-busy');
        if (!state.addressSaveOutcomeUnknown) {
          btn.disabled = false;
          btn.textContent = '💾 ذخیره نشانی';
        } else {
          btn.disabled = true;
          btn.textContent = 'وضعیت ذخیره نامشخص';
        }
      }
    });
  }

  async function loadUserAddresses() {
    try {
      const res = await api('/api/auth/me');
      if (res && res.user) {
        state.user = res.user;
        const nameInput = $('checkout-name');
        const phoneInput = $('checkout-phone');
        if (nameInput && !nameInput.value) nameInput.value = res.user.name || '';
        if (phoneInput && !phoneInput.value) phoneInput.value = res.user.phone || '';

        const addresses = Array.isArray(res.user.addresses) ? res.user.addresses : [];
        state.userAddresses = addresses;
        if (activeFulfillment() === 'delivery') {
          renderCheckoutAddresses();
        }
      }
    } catch (_) {}
    initCheckoutAddressModal();
  }

  function replaceCheckoutItemsContent(root, content) {
    if (typeof root.replaceChildren === 'function') root.replaceChildren(content);
    else {
      root.innerHTML = '';
      root.appendChild(content);
    }
  }

  function renderCheckoutLoadingState() {
    const itemsRoot = $('checkout-items');
    if (!itemsRoot) return;
    itemsRoot.setAttribute('aria-busy', 'true');
    const status = document.createElement('p');
    status.className = 'checkout-load-state';
    status.setAttribute('role', 'status');
    status.textContent = 'در حال بارگذاری منو و اطلاعات سفارش…';
    replaceCheckoutItemsContent(itemsRoot, status);
  }

  function renderCheckoutLoadError() {
    const itemsRoot = $('checkout-items');
    if (!itemsRoot) return;
    itemsRoot.setAttribute('aria-busy', 'false');

    const panel = document.createElement('div');
    panel.className = 'checkout-load-error';
    panel.setAttribute('role', 'alert');

    const message = document.createElement('p');
    message.className = 'checkout-load-error__message';
    message.textContent = 'بارگذاری منو و اطلاعات سفارش انجام نشد. اتصال را بررسی کنید و دوباره تلاش کنید.';

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'checkout-load-retry';
    retry.textContent = 'تلاش دوباره';
    retry.addEventListener('click', async () => {
      if (state.booting) return;
      retry.disabled = true;
      renderCheckoutLoadingState();
      await boot();
    });

    panel.appendChild(message);
    panel.appendChild(retry);
    replaceCheckoutItemsContent(itemsRoot, panel);
  }

  async function loadCheckoutMeta(requestedBranchId = state.branchId) {
    const generation = ++metaGeneration;
    abortController(metaController);
    metaController = new AbortController();

    const query = requestedBranchId ? `?branchId=${Number(requestedBranchId)}` : '';
    const meta = await api(`/api/checkout/meta${query}`, {
      signal: metaController.signal,
      timeoutMs: 10000,
    });

    if (generation !== metaGeneration || metaController.signal.aborted) {
      throw new DOMException('Stale checkout meta response', 'AbortError');
    }

    const paymentMeta = meta.payment || {};
    const paymentMode = String(paymentMeta.mode || '').trim().toLowerCase();
    const paymentProvider = String(paymentMeta.provider || '').trim().toLowerCase();
    state.payment = {
      ...paymentMeta,
      onlineEnabled: paymentMeta.onlineEnabled === true
        && paymentMeta.gatewayReady === true
        && ['live', 'production'].includes(paymentMode)
        && !!paymentProvider
        && !['sandbox', 'test', 'mock', 'demo', 'unavailable'].includes(paymentProvider),
    };
    const paymentSelect = $('checkout-payment');
    const onlineOption = paymentSelect?.querySelector('option[value="online"]');
    const paymentNote = $('checkout-payment-note');
    if (onlineOption) onlineOption.disabled = !state.payment.onlineEnabled;
    if (!state.payment.onlineEnabled && paymentSelect?.value === 'online') paymentSelect.value = 'cashier';
    if (paymentNote) {
      paymentNote.hidden = state.payment.onlineEnabled;
      paymentNote.textContent = state.payment.onlineEnabled
        ? ''
        : paymentMeta.onlineEnabled === true
          ? 'آمادگی و واقعی‌بودن درگاه از سرور تأیید نشد؛ پرداخت آنلاین غیرفعال است.'
          : 'پرداخت آنلاین در این محیط فعال نیست؛ پرداخت در صندوق یا هنگام تحویل را انتخاب کنید.';
    }

    const branch = $('checkout-branch');
    const zone = $('checkout-zone');
    if (!branch || !zone) return meta;

    const branches = Array.isArray(meta.branches) ? meta.branches : [];
    const requested = Number(requestedBranchId || 0);
    const selectedBranch =
      branches.find((item) => Number(item.id) === requested) || branches[0] || null;

    branch.innerHTML = branches
      .map(
        (item) =>
          `<option value="${item.id}" ${Number(item.id) === Number(selectedBranch?.id) ? 'selected' : ''}>${esc(localizedName(item))}</option>`,
      )
      .join('');

    state.branchId = Number(branch.value) || Number(selectedBranch?.id) || null;
    state.zones = Array.isArray(meta.deliveryZones) ? meta.deliveryZones : [];

    zone.innerHTML =
      state.zones
        .map(
          (item) =>
            `<option value="${item.id}">${esc(localizedName(item))} · ${fmtMoney(item.fee)} · ${esc(tr('checkout.minimum'))} ${fmtMoney(item.minOrder)}</option>`,
        )
        .join('') || `<option value="">${esc(tr('checkout.noZone'))}</option>`;

    return meta;
  }

  function currentQuoteSignature() {
    return JSON.stringify({
      items: lineItems(),
      fulfillment: activeFulfillment(),
      branchId: state.branchId,
      selectedBranchId: Number($('checkout-branch')?.value) || null,
      tableNo: $('checkout-table')?.value || '',
      deliveryZoneId: $('checkout-zone')?.value || '',
      phone: $('checkout-phone')?.value.trim() || '',
      paymentMethod: $('checkout-payment')?.value || 'cashier',
    });
  }

  function cancelQuoteWork({ cancelTimer = true } = {}) {
    if (cancelTimer && quoteTimer) {
      window.clearTimeout(quoteTimer);
      quoteTimer = 0;
    }
    abortController(quoteController);
    quoteController = null;
    quoteGeneration += 1;
  }

  function refreshQuote() {
    if (quoteTimer) {
      window.clearTimeout(quoteTimer);
      quoteTimer = 0;
    }
    abortController(quoteController);
    quoteController = null;

    state.quote = null;
    state.quoteSignature = '';
    state.quoteChange = null;
    state.quoteRetryable = false;
    renderTotals();

    const generation = ++quoteGeneration;
    if (state.branchLoading) return;

    quoteTimer = window.setTimeout(async () => {
      quoteTimer = 0;

      if (!state.cart.size) {
        state.quote = null;
        state.quoteSignature = '';
        state.quoteChange = null;
        state.quoteRetryable = false;
        renderTotals();
        return;
      }

      const signature = currentQuoteSignature();
      const visibleBeforeQuote = estimateVisiblePrices();
      const controller = new AbortController();
      quoteController = controller;
      setText($('checkout-live'), tr('checkout.calculating'));

      try {
        const quoteResponse = await api('/api/checkout/quote', {
          method: 'POST',
          body: JSON.stringify({
      items: lineItems(),
            fulfillment: activeFulfillment(),
            branchId: state.branchId,
            tableNo: $('checkout-table')?.value || '',
            deliveryZoneId: $('checkout-zone')?.value || '',
            phone: $('checkout-phone')?.value.trim() || '',
            paymentMethod: $('checkout-payment')?.value || 'cashier',
            redeemPoints: state.redeemPoints || 0,
          }),
          signal: controller.signal,
          timeoutMs: 10000,
        });

        if (
          generation !== quoteGeneration ||
          controller.signal.aborted ||
          signature !== currentQuoteSignature()
        ) {
          return;
        }

        const quote = validateCheckoutQuote(quoteResponse);
        applyQuote(quote, signature, visibleBeforeQuote);
        state.quoteRetryable = false;
        setText(
          $('checkout-live'),
          quote.etaMinutes ? tr('checkout.eta', { n: fmtNum(quote.etaMinutes) }) : tr('checkout.ready'),
        );
        setText(
          $('checkout-note-text'),
          quote.fulfillment === 'delivery'
            ? tr('checkout.deliverySummary', { zone: localizedName(quote.zone) || tr('checkout.selectedZone'), n: fmtNum(quote.etaMinutes) })
            : quote.fulfillment === 'pickup'
              ? tr('checkout.pickupSummary')
              : tr('checkout.dineSummary'),
        );
      } catch (error) {
        if (generation !== quoteGeneration || controller.signal.aborted) {
          return;
        }
        state.quote = null;
        state.quoteSignature = '';
        state.quoteChange = null;
        const nonRetryableProviderErrors = ['payment_provider_not_ready', 'payment_provider_unavailable'];
        state.quoteRetryable = isAbortError(error) || error?.name === 'TypeError' || Number(error?.status) === 429 || (Number(error?.status) >= 500 && !nonRetryableProviderErrors.includes(error?.code));
        setText($('checkout-live'), state.quoteRetryable ? 'ارتباط با پیش‌فاکتور برقرار نشد' : tr('checkout.needsReview'));
        setText($('checkout-note-text'), checkoutErrorMessage(error));
      } finally {
        if (quoteController === controller) quoteController = null;
      }

      renderTotals();
    }, 220);
  }

  const CHECKOUT_RECEIPT_STORAGE_KEY = 'westo_guest_checkout_receipt_v1';

  function checkoutIntentStorageError(code = 'checkout_intent_storage_unavailable') {
    const error = new Error(code);
    error.code = code;
    error.preflight = true;
    return error;
  }

  function makeReceiptCode() {
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.getRandomValues || typeof globalThis.Uint8Array !== 'function') {
      throw checkoutIntentStorageError('checkout_secure_random_unavailable');
    }
    const bytes = new globalThis.Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function checkoutIntentStorageKey(signature) {
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.subtle?.digest || typeof globalThis.TextEncoder !== 'function') {
      throw checkoutIntentStorageError('checkout_secure_random_unavailable');
    }
    const digest = await cryptoApi.subtle.digest('SHA-256', new globalThis.TextEncoder().encode(signature));
    const hex = Array.from(new globalThis.Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `intent-${hex}`;
  }

  function storedCheckoutIntents({ strict = false } = {}) {
    try {
      const saved = JSON.parse(globalThis.localStorage.getItem(CHECKOUT_RECEIPT_STORAGE_KEY) || 'null');
      if (saved?.version === 1 && saved.intents && typeof saved.intents === 'object' && !Array.isArray(saved.intents)) return saved.intents;
      if (saved === null) return {};
      throw checkoutIntentStorageError();
    } catch (_) {
      if (strict) throw checkoutIntentStorageError();
      return {};
    }
  }

  function persistCheckoutIntents(intents) {
    try {
      const value = Object.keys(intents).length
        ? JSON.stringify({ version: 1, intents })
        : '';
      if (value) globalThis.localStorage.setItem(CHECKOUT_RECEIPT_STORAGE_KEY, value);
      else globalThis.localStorage.removeItem(CHECKOUT_RECEIPT_STORAGE_KEY);
      const saved = storedCheckoutIntents({ strict: true });
      if (JSON.stringify(saved) !== JSON.stringify(intents)) throw checkoutIntentStorageError();
    } catch (_) {
      throw checkoutIntentStorageError();
    }
  }

  async function getOrCreateCheckoutIdempotencyKey(storageKey) {
    const intents = storedCheckoutIntents({ strict: true });
    for (const [savedKey, intent] of Object.entries(intents)) {
      if (savedKey !== storageKey && intent?.submitted === true) {
        throw checkoutIntentStorageError('checkout_pending_intent_unresolved');
      }
    }
    const existing = intents[storageKey];
    if (existing?.code && /^[a-f0-9]{32}$/.test(existing.code)) return existing.code;

    const code = makeReceiptCode();
    const prepared = { [storageKey]: { code, submitted: false, at: Date.now() } };
    persistCheckoutIntents(prepared);
    if (storedCheckoutIntents({ strict: true })[storageKey]?.code !== code) throw checkoutIntentStorageError();
    return code;
  }

  function markCheckoutIntentSubmitted(storageKey, code) {
    const intents = storedCheckoutIntents({ strict: true });
    const saved = intents[storageKey];
    if (!saved || saved.code !== code) throw checkoutIntentStorageError();
    persistCheckoutIntents({ [storageKey]: { ...saved, submitted: true, submittedAt: Date.now() } });
  }

  function storedCheckoutIntent(storageKey) {
    const intent = storedCheckoutIntents()[storageKey];
    return intent?.code ? { key: String(intent.code), code: String(intent.code), at: Number(intent.at) || 0, submitted: intent.submitted === true } : null;
  }

  function forgetCheckoutIntent(storageKey) {
    const intents = storedCheckoutIntents();
    delete intents[storageKey];
    try { persistCheckoutIntents(intents); } catch (_) {}
    renderCheckoutRecoveryNotice();
  }

  function renderCheckoutRecoveryNotice() {
    const notice = $('checkout-recovery-notice');
    if (!notice) return false;
    const hasPendingIntent = Object.values(storedCheckoutIntents()).some((intent) => intent?.submitted === true);
    setHidden(notice, !hasPendingIntent);
    return hasPendingIntent;
  }

  function confirmedCheckoutPaymentStatus(order, payment) {
    const known = new Set(['unpaid', 'partial', 'pending', 'paid', 'failed', 'refunded', 'unknown']);
    const orderStatus = String(order?.paymentStatus || '').trim().toLowerCase();
    const attemptStatus = String(payment?.status || '').trim().toLowerCase();
    const orderValue = known.has(orderStatus) ? orderStatus : '';
    const attemptValue = known.has(attemptStatus) ? attemptStatus : '';
    if ((orderStatus && !orderValue) || (attemptStatus && !attemptValue)) return 'unknown';
    if (orderValue && attemptValue && orderValue !== attemptValue) return 'unknown';
    return attemptValue || orderValue || 'unknown';
  }

  function checkoutPaymentStatusLabel(status) {
    return ({
      unpaid: 'پرداخت‌نشده',
      partial: 'بخشی از مبلغ پرداخت شده',
      pending: 'در انتظار تأیید پرداخت',
      paid: 'پرداخت تأیید شده',
      failed: 'پرداخت ناموفق',
      refunded: 'بازپرداخت شده',
      unknown: 'نامشخص؛ برای اطمینان با شعبه پیگیری کنید',
    })[status] || 'نامشخص؛ برای اطمینان با شعبه پیگیری کنید';
  }

  function checkoutOrderStage(order, paymentStatus) {
    const status = String(order?.status || '').trim().toLowerCase();
    const delivery = order?.fulfillment === 'delivery';
    if (delivery) {
      const acceptanceStatus = String(order?.deliveryAcceptance?.status || '').trim().toLowerCase();
      const acceptanceSource = String(order?.deliveryAcceptance?.source || '').trim().toLowerCase();
      const kitchenProgressStatuses = ['sent_to_kitchen', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done'];
      if (status === 'cancelled') {
        return ['سفارش لغو شده است', 'وضعیت پرداخت در بخش جداگانه مشخص شده است؛ در صورت نیاز با رستوران پیگیری کنید.'];
      }
      if (acceptanceStatus === 'rejected') {
        return ['رستوران سفارش را نپذیرفت', 'این سفارش وارد صف آشپزخانه نمی‌شود. وضعیت پرداخت جداگانه پیگیری می‌شود؛ برای تعیین تکلیف مبلغ با شعبه تماس بگیرید.'];
      }

      if (acceptanceStatus === 'accepted') {
        if (acceptanceSource !== 'restaurant') {
          return ['پذیرش رستوران قابل تأیید نیست', 'اطلاعات پذیرش سفارش کامل نیست؛ برای جلوگیری از برداشت اشتباه، مرحلهٔ سفارش را با رستوران پیگیری کنید.'];
        }
        if (status === 'preparing') {
          return ['پذیرش ثبت شد · آماده‌سازی شروع شده است', 'رستوران سفارش را پذیرفته و شروع آماده‌سازی ثبت شده است.'];
        }
        if (status === 'sent_to_kitchen') {
          return ['پذیرش رستوران ثبت شد · سفارش در صف آشپزخانه است', 'ورود به صف ثبت شده؛ شروع آماده‌سازی پس از اقدام آشپزخانه اعلام می‌شود.'];
        }
        if (status === 'ready') {
          return ['پذیرش ثبت شد · سفارش آمادهٔ تحویل است', 'آماده‌سازی تکمیل شده است؛ برای دریافت سفارش با رستوران هماهنگ کنید.'];
        }
        if (['dispatched', 'picked_up', 'delivered', 'done'].includes(status)) {
          return ({
            dispatched: ['پذیرش ثبت شد · سفارش در مسیر ارسال است', 'وضعیت تحویل پس از به‌روزرسانی رستوران تغییر می‌کند.'],
            picked_up: ['پذیرش ثبت شد · سفارش تحویل گرفته شد', 'وضعیت سفارش از مسیر پیگیری قابل مشاهده است.'],
            delivered: ['پذیرش ثبت شد · سفارش تحویل شد', 'وضعیت سفارش از مسیر پیگیری قابل مشاهده است.'],
            done: ['پذیرش ثبت شد · سفارش تکمیل شد', 'وضعیت سفارش از مسیر پیگیری قابل مشاهده است.'],
          })[status];
        }
        if (['unpaid', 'partial', 'pending'].includes(paymentStatus)) {
          const paymentWaitCopy = {
            unpaid: 'در انتظار پرداخت',
            partial: 'در انتظار تکمیل پرداخت',
            pending: 'در انتظار تأیید پرداخت',
          }[paymentStatus];
          return [`رستوران سفارش را پذیرفت · ${paymentWaitCopy}`, 'پذیرش ثبت شده است؛ وضعیت پرداخت جداگانه پیگیری می‌شود و هنوز ورود به صف آشپزخانه ثبت نشده است.'];
        }
        return ['پذیرش رستوران ثبت شد', 'سفارش هنوز در صف آشپزخانه ثبت نشده است؛ مرحلهٔ بعدی پس از به‌روزرسانی رستوران نمایش داده می‌شود.'];
      }

      if (acceptanceStatus && !['pending', 'awaiting_acceptance'].includes(acceptanceStatus)) {
        return ['وضعیت پذیرش رستوران نامشخص است', 'پاسخ پذیرش با قرارداد سفارش هم‌خوان نیست؛ مرحلهٔ بعد را با رستوران پیگیری کنید.'];
      }
      if (kitchenProgressStatuses.includes(status)) {
        return ['وضعیت سفارش نیازمند بررسی است', 'مرحلهٔ سفارش از صف آشپزخانه جلوتر است اما پذیرش صریح رستوران تأیید نشده؛ وضعیت را با رستوران پیگیری کنید.'];
      }
      return [
        paymentStatus === 'paid' ? 'پرداخت ثبت شد · در انتظار پذیرش رستوران' : 'در انتظار پذیرش رستوران',
        'پذیرش رستوران هنوز تأیید نشده؛ آماده‌سازی شروع نشده و سفارش در صف آشپزخانه نیست.',
      ];
    }

    const stages = {
      pending_online: ['سفارش ثبت اولیه شد', 'نتیجهٔ پرداخت جدا از پیشرفت سفارش پیگیری می‌شود.'],
      awaiting_confirmation: [
        'در انتظار تأیید مجموعه',
        'پس از تأیید مجموعه، مرحلهٔ بعدی سفارش اعلام می‌شود.',
      ],
      pay_at_cashier: ['در انتظار ادامهٔ فرایند در صندوق', 'وضعیت پرداخت در بخش جداگانه مشخص شده است.'],
      sent_to_kitchen: ['سفارش به صف آشپزخانه رفت', 'ورود به صف ثبت شده است؛ شروع آماده‌سازی پس از اقدام آشپزخانه اعلام می‌شود.'],
      preparing: ['سفارش در حال آماده‌سازی است', 'وضعیت بعدی پس از آماده‌شدن به‌روزرسانی می‌شود.'],
      ready: ['سفارش آمادهٔ تحویل است', 'برای دریافت سفارش به مجموعه مراجعه کنید.'],
      dispatched: ['سفارش در مسیر ارسال است', 'وضعیت تحویل پس از به‌روزرسانی شعبه تغییر می‌کند.'],
      picked_up: ['سفارش تحویل گرفته شد', 'وضعیت سفارش از طریق حساب کاربری قابل پیگیری است.'],
      delivered: ['سفارش تحویل شد', 'وضعیت سفارش از طریق حساب کاربری قابل پیگیری است.'],
      done: ['سفارش تکمیل شد', 'وضعیت سفارش از طریق حساب کاربری قابل پیگیری است.'],
      cancelled: ['سفارش لغو شده است', 'وضعیت پرداخت در بخش جداگانه مشخص شده است؛ در صورت نیاز با شعبه پیگیری کنید.'],
      // Legacy `paid` is overloaded as a financial state and order state.
      // Do not infer kitchen progress from payment-like order statuses.
      paid: ['سفارش ثبت شد', 'مرحلهٔ بعدی سفارش از سوی مجموعه به‌روزرسانی می‌شود؛ پرداخت جداگانه نمایش داده شده است.'],
    };
    return stages[status] || ['وضعیت سفارش نامشخص است', 'برای تأیید مرحلهٔ سفارش با شعبه پیگیری کنید.'];
  }

  function showSuccess(order, payment = null, receiptCode = '', { recovered = false } = {}) {
    const form = $('checkout-form');
    const success = $('checkout-success');
    const sandbox = $('sandbox-confirm');
    const paymentHandoff = $('checkout-payment-handoff');
    const badge = $('checkout-order-badge');
    const kicker = success?.querySelector?.('.eyebrow');
    const icon = $('checkout-success-icon');
    const newOrderButton = $('checkout-new-order-btn');
    const historyButton = $('checkout-view-history-btn');

    state.checkoutComplete = true;
    setHidden($('checkout-stage-basket'), true);
    setHidden($('checkout-stepper'), true);
    setCheckoutSubmitting(false);
    state.cart.clear();
    state.quote = null;
    state.quoteSignature = '';
    state.quoteChange = null;
    state.quoteRetryable = false;
    renderCart();
    renderTotals();

    setHidden(form, true);
    setHidden(success, false);
    success?.setAttribute?.('role', 'region');
    success?.setAttribute?.('aria-live', 'polite');
    success?.removeAttribute?.('data-checkout-outcome');
    setText(kicker, 'سفارش شما ثبت شد');
    if (kicker?.style) kicker.style.color = '#10b981';
    setText(icon, '✅');
    setReceiptCodeView(receiptCode, 'این کد را برای پیگیری سفارش نگه دارید.');

    const paymentStatus = confirmedCheckoutPaymentStatus(order, payment);
    const paymentNeedsFollowup = paymentStatus === 'pending' || paymentStatus === 'unknown';
    setHidden(newOrderButton, paymentNeedsFollowup);
    setHidden(historyButton, false);
    if (historyButton) {
      setText(historyButton, paymentNeedsFollowup ? '📦 پیگیری همین سفارش' : '📦 ورود به حساب و پیگیری سفارش‌های من');
      if (paymentNeedsFollowup) {
        historyButton.setAttribute?.('aria-label', `پیگیری وضعیت همین سفارش ${order.orderNo || `W-${order.id}`}`);
      } else {
        historyButton.removeAttribute?.('aria-label');
      }
    }

    if (badge) {
      badge.textContent = order.orderNo || `W-${order.id}`;
    }

    const isOnlinePending = paymentStatus === 'pending';
    const handoffUrl = paymentRedirectUrl(payment);
    setHidden(paymentHandoff, true);
    if (paymentHandoff) paymentHandoff.removeAttribute?.('href');
    if (isOnlinePending && handoffUrl && paymentHandoff) {
      paymentHandoff.href = handoffUrl;
      paymentHandoff.setAttribute?.('aria-label', 'ادامهٔ پرداخت امن در درگاه بانکی');
      setHidden(paymentHandoff, false);
    }
    const orderStageCopy = checkoutOrderStage(order, paymentStatus);
    setText(
      $('checkout-success-title'),
      orderStageCopy[0],
    );

    const sandboxCanConfirm = payment?.provider === 'sandbox' && payment?.status === 'pending' && payment.sandboxToken;
    let onlinePendingCopy = 'پرداخت هنوز تأیید نشده است.';
    if (isOnlinePending && handoffUrl) {
      onlinePendingCopy = 'برای تکمیل سفارش، ادامهٔ پرداخت امن را انتخاب کنید. سفارش تا تأیید درگاه نهایی نیست.';
    } else if (isOnlinePending && !sandboxCanConfirm) {
      onlinePendingCopy = 'پیوند درگاه از سرور دریافت نشد؛ برای جلوگیری از ثبت تکراری دوباره سفارش ندهید و با شعبه پیگیری کنید.';
    } else if (paymentStatus === 'unknown') {
      onlinePendingCopy = 'وضعیت پرداخت نامشخص است؛ سفارش تازه ثبت نکنید و همین سفارش را از مسیر پیگیری بررسی کنید.';
    }
    let summaryText = `سفارش شما به مبلغ ${fmtMoney(order.total)} ثبت شد. وضعیت سفارش: ${orderStageCopy[0]}. ${orderStageCopy[1]} وضعیت پرداخت: ${checkoutPaymentStatusLabel(paymentStatus)}.`;
    if (order.tax?.inclusive === true && Number.isSafeInteger(Number(order.tax.totalTaxIrr)) && Number(order.tax.totalTaxIrr) >= 0) {
      summaryText += ` سهم مالیات ${fmtNum(order.tax.totalTaxIrr)} ریال است و داخل قیمت منو محاسبه شده است.`;
    }
    if (paymentNeedsFollowup) summaryText += ` ${onlinePendingCopy}`;
    if (order.fulfillment === 'delivery') {
      const etaMinutes = Number(order.delivery?.etaMinutes);
      summaryText += Number.isSafeInteger(etaMinutes) && etaMinutes > 0
        ? ` زمان تقریبی ارسال پیک: حدود ${fmtNum(etaMinutes)} دقیقه.`
        : ' زمان تقریبی ارسال هنوز از سوی شعبه اعلام نشده است؛ وضعیت را پس از تأیید پیگیری کنید.';
    } else if (order.fulfillment === 'dine_in') {
      summaryText += ` شماره میز: ${esc(order.tableNo)}.`;
    }
    summaryText += recovered
      ? ' برای دیدن وضعیت دوبارهٔ سفارش، همین کد را در بخش پیگیری وارد کنید.'
      : ' برای پیگیری به‌روزرسانی‌های بعدی، با همان شماره موبایل ثبت‌شده در سفارش وارد حساب کاربری شوید.';
    setText($('checkout-success-body'), summaryText);
    success?.focus?.({ preventScroll: true });

    if (!sandbox) return;
    sandbox.onclick = null;
    sandbox.disabled = false;
    sandbox.hidden = !sandboxCanConfirm;

    if (!sandbox.hidden) {
      sandbox.onclick = async () => {
        if (sandbox.disabled) return;
        sandbox.disabled = true;
        sandbox.textContent = 'در حال اعتبارسنجی پرداخت…';

        try {
          const result = await api(
            `/api/checkout/payments/${payment.id}/sandbox-confirm`,
            {
              method: 'POST',
              body: JSON.stringify({ token: payment.sandboxToken }),
              timeoutMs: 15000,
            },
          );
          setText($('checkout-success-title'), 'پرداخت آنلاین با موفقیت تأیید شد');
          setText(
            $('checkout-success-body'),
            `سفارش شماره ${result.order?.orderNo || result.order?.id} با موفقیت تسویه و امتیاز باشگاه برای شما منظور گردید.`,
          );
          sandbox.hidden = true;
        } catch (error) {
          sandbox.disabled = false;
          sandbox.textContent = '✓ تأیید پرداخت آنلاین';
          setText($('checkout-success-body'), error.message);
        }
      };
    }
  }

  function showOrderQuoteMismatch(order, payment, quotedTotal, receiptCode = '') {
    const form = $('checkout-form');
    const success = $('checkout-success');
    const sandbox = $('sandbox-confirm');
    const paymentHandoff = $('checkout-payment-handoff');
    const newOrderButton = $('checkout-new-order-btn');

    state.checkoutComplete = true;
    setHidden($('checkout-stage-basket'), true);
    setHidden($('checkout-stepper'), true);
    setCheckoutSubmitting(false);
    clearUncertainCheckout();
    setHidden(form, true);
    setHidden(success, false);
    success?.setAttribute?.('role', 'alert');
    success?.setAttribute?.('aria-live', 'assertive');
    success?.setAttribute?.('aria-atomic', 'true');
    success?.setAttribute?.('data-checkout-outcome', 'quote-mismatch');
    setMessage('');

    setText($('checkout-success-title'), 'مبلغ سفارش با پیش‌فاکتور تأییدشده یکسان نیست');
    const kicker = success?.querySelector?.('.eyebrow');
    setText(kicker, 'سفارش ثبت شده؛ مبلغ نیازمند پیگیری است');
    if (kicker?.style) kicker.style.color = '#f59e0b';
    setText($('checkout-success-icon'), '⚠️');
    setText($('checkout-order-badge'), order?.orderNo || `W-${order?.id}`);
    setReceiptCodeView(receiptCode, 'سفارش ثبت شده است؛ کد را برای پیگیری نگه دارید.');
    const actualTotal = Number(order?.total);
    const paymentStatus = confirmedCheckoutPaymentStatus(order, payment);
    const quotedAmountCopy = Number.isSafeInteger(quotedTotal) && quotedTotal >= 0
      ? fmtMoney(quotedTotal)
      : 'قابل تأیید نیست';
    const lines = [
      `مبلغی که پیش از ثبت تأیید شد: ${quotedAmountCopy}.`,
      `مبلغ ثبت‌شده در پاسخ سرور: ${fmtMoney(actualTotal)}.`,
      `وضعیت پرداخت: ${checkoutPaymentStatusLabel(paymentStatus)}.`,
      'برای جلوگیری از پرداخت مبلغ نادرست، لینک پرداخت نمایش داده نمی‌شود. پیش از پرداخت یا ثبت سفارش تازه، وضعیت را با رستوران یا شعبه پیگیری کنید.',
    ];
    setText($('checkout-success-body'), lines.join(' '));
    setHidden(sandbox, true);
    if (sandbox) {
      sandbox.onclick = null;
      sandbox.disabled = true;
    }
    setHidden(paymentHandoff, true);
    paymentHandoff?.removeAttribute?.('href');
    setHidden(newOrderButton, true);
    success?.focus?.({ preventScroll: true });
    renderCheckoutRecoveryNotice();
  }

  async function copyCheckoutReceiptCode(code, statusId) {
    const normalized = String(code || '').replace(/[\s-]/g, '').toLowerCase();
    const status = $(statusId);
    if (!/^[a-f0-9]{32}$/.test(normalized)) {
      setText(status, 'کد رسید در دسترس نیست.');
      return false;
    }
    try {
      if (!globalThis.navigator?.clipboard?.writeText) throw new Error('clipboard_unavailable');
      await globalThis.navigator.clipboard.writeText(formatReceiptCode(normalized));
      setText(status, 'کد رسید کپی شد.');
      return true;
    } catch (_) {
      setText(status, 'کپی خودکار ممکن نشد؛ کد را از روی صفحه یادداشت کنید.');
      return false;
    }
  }

  function recoveryOrderProjection(order) {
    if (!order || typeof order !== 'object' || Array.isArray(order)) return null;
    const id = Number(order.id);
    const total = Number(order.total);
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(total) || total < 0) return null;
    const result = { id, total };
    if (order.tax?.inclusive === true && Number.isSafeInteger(Number(order.tax.totalTaxIrr)) && Number(order.tax.totalTaxIrr) >= 0) {
      result.tax = { inclusive: true, totalTaxIrr: Number(order.tax.totalTaxIrr) };
    }
    if (typeof order.orderNo === 'string' && order.orderNo.length <= 80) result.orderNo = order.orderNo;
    if (typeof order.status === 'string') result.status = order.status;
    if (typeof order.paymentStatus === 'string') result.paymentStatus = order.paymentStatus;
    if (['dine_in', 'pickup', 'delivery'].includes(order.fulfillment)) result.fulfillment = order.fulfillment;
    if (result.fulfillment === 'dine_in' && typeof order.tableNo === 'string' && order.tableNo.length <= 20) result.tableNo = order.tableNo;
    const acceptanceStatus = order.deliveryAcceptance?.status;
    if (result.fulfillment === 'delivery' && ['pending', 'awaiting_acceptance', 'accepted', 'rejected'].includes(acceptanceStatus)) {
      result.deliveryAcceptance = { status: acceptanceStatus };
      if (acceptanceStatus === 'accepted' && order.deliveryAcceptance.source === 'restaurant') result.deliveryAcceptance.source = 'restaurant';
    }
    const etaMinutes = Number(order.delivery?.etaMinutes);
    if (result.fulfillment === 'delivery' && Number.isSafeInteger(etaMinutes) && etaMinutes > 0 && etaMinutes <= 1440) {
      result.delivery = { etaMinutes };
    }
    return result;
  }

  async function recoverCheckoutByReceiptCode(event) {
    event?.preventDefault?.();
    const field = $('checkout-recovery-code-input');
    const button = $('checkout-recovery-submit');
    const code = String(field?.value || '').trim().replace(/[\s-]/g, '').toLowerCase();
    const status = $('checkout-recovery-result');
    if (!/^[a-f0-9]{32}$/.test(code)) {
      setText(status, 'کد باید شامل ۳۲ رقم یا حرف لاتین باشد.');
      field?.setAttribute?.('aria-invalid', 'true');
      field?.focus?.({ preventScroll: true });
      return false;
    }
    field?.removeAttribute?.('aria-invalid');
    if (button) {
      button.disabled = true;
      button.setAttribute?.('aria-busy', 'true');
    }
    setText(status, 'در حال جست‌وجوی سفارش…');
    try {
      const result = await api('/api/checkout/recovery', {
        method: 'POST',
        body: JSON.stringify({ receiptCode: code }),
      });
      const order = recoveryOrderProjection(result?.order);
      if (result?.ok !== true || !order) throw Object.assign(new Error('receipt_not_found'), { code: 'receipt_not_found', status: 404 });
      state.receiptCode = code;
      state.receiptSignature = '';
      state.checkoutComplete = false;
      for (const [storageKey, intent] of Object.entries(storedCheckoutIntents())) {
        if (intent?.code === code) forgetCheckoutIntent(storageKey);
      }
      showSuccess(order, null, code, { recovered: true });
      setText(status, 'سفارش پیدا شد.');
      return true;
    } catch (error) {
      setText(status, checkoutErrorMessage(error));
      return false;
    } finally {
      if (button) {
        button.disabled = false;
        button.removeAttribute?.('aria-busy');
      }
    }
  }

  async function sendCheckoutIntent(intent, { retrying = false } = {}) {
    setCheckoutSubmitting(true);
    cancelQuoteWork();
    renderTotals();
    setMessage(retrying ? 'در حال بررسی امن همان درخواست قبلی…' : tr('checkout.submitting'));
    focusCheckoutMessage();

    try {
      const result = await api('/api/checkout/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': intent.key },
        body: JSON.stringify(intent.payload),
        timeoutMs: 30000,
      });

      const order = result?.order;
      const hasConfirmedOrder = result?.ok === true
        && order
        && order.id !== undefined
        && order.id !== null
        && String(order.id).trim() !== ''
        && Number.isSafeInteger(Number(order.total))
        && Number(order.total) >= 0;
      const payment = result?.payment;
      const hasOnlinePayment = intent.payload.paymentMethod !== 'online'
        || (payment
          && payment.id !== undefined
          && payment.id !== null
          && String(payment.orderId) === String(order?.id)
          && Number.isSafeInteger(Number(payment.amount))
          && Number(payment.amount) === Number(order?.total)
          && ['pending', 'paid'].includes(String(payment.status || '').toLowerCase())
          && !['sandbox', 'test', 'mock', 'demo'].includes(String(payment.provider || '').toLowerCase()));
      if (!hasConfirmedOrder || !hasOnlinePayment) {
        const error = new Error('checkout_order_confirmation_unknown');
        error.code = 'checkout_order_confirmation_unknown';
        error.outcomeUnknown = true;
        throw error;
      }

      const quotedTotal = Number(intent.quoteTotal);
      if (!Number.isSafeInteger(quotedTotal) || quotedTotal < 0 || Number(order.total) !== quotedTotal) {
        setCheckoutSubmitting(false);
        // The server has confirmed the order, so this is no longer an
        // unresolved intent that should be replayed after refresh. Keep the
        // pricing incident visible, but remove the stale recovery warning/key.
        forgetCheckoutIntent(intent.storageKey);
        if (state.idempotencySignature === intent.signature) {
          state.idempotencyKey = '';
          state.idempotencySignature = '';
        }
        showOrderQuoteMismatch(order, payment, quotedTotal, intent.key);
        return;
      }

      setCheckoutSubmitting(false);
      clearUncertainCheckout();
      setMessage('');
      forgetCheckoutIntent(intent.storageKey);
      state.idempotencyKey = '';
      state.idempotencySignature = '';
      showSuccess(order, payment, intent.key);
    } catch (error) {
      const code = String(error?.code || '');
      const manualFollowup = ['idempotency_key_conflict', 'idempotency_replay_unavailable'].includes(code);
      const outcomeUnknown = checkoutOutcomeMayBeUnknown(error);
      const fieldId = checkoutErrorField(error);
      setCheckoutSubmitting(false);

      if (outcomeUnknown) {
        const pending = state.uncertainIntent || {
          payload: JSON.parse(JSON.stringify(intent.payload)),
          key: intent.key,
          signature: intent.signature,
          storageKey: intent.storageKey,
          quoteTotal: intent.quoteTotal,
          manualFollowup: false,
        };
        pending.manualFollowup = pending.manualFollowup || manualFollowup;
        lockUncertainCheckout(pending);
        renderCheckoutRecoveryNotice();
        renderTotals();
        setMessage(
          manualFollowup
            ? checkoutErrorMessage(error)
            : 'نتیجهٔ ثبت سفارش از سرور تأیید نشد و ممکن است سفارش ثبت شده باشد. ورودی‌ها قفل شده‌اند؛ فقط همان درخواست را دوباره بفرستید تا سفارش تکراری ساخته نشود.',
          'error',
        );
        if (manualFollowup) focusCheckoutMessage();
        else $('checkout-submit')?.focus?.({ preventScroll: true });
        return;
      }

      const wasUncertain = !!state.uncertainIntent;
      if (wasUncertain) {
        clearUncertainCheckout();
      }
      forgetCheckoutIntent(intent.storageKey);
      state.receiptCode = '';
      state.receiptSignature = '';
      state.receiptStorageKey = '';
      state.receiptPreparationSignature = '';
      state.receiptPreparationError = '';
      setReceiptCodeView('', '');
      if (state.idempotencySignature === intent.signature) {
        state.idempotencyKey = '';
        state.idempotencySignature = '';
      }
      if (fieldId) reportGuestCheckoutError({ field: fieldId, message: checkoutErrorMessage(error) });
      else {
        setMessage(checkoutErrorMessage(error), 'error');
        focusCheckoutMessage();
      }
      renderTotals();
      refreshQuote();
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (state.submitting) return;

    if (state.uncertainIntent) {
      if (state.uncertainIntent.manualFollowup || !state.uncertainIntent.payload) return;
      return sendCheckoutIntent(state.uncertainIntent, { retrying: true });
    }
    // Native Enter-key submission can fire the form handler from any visible
    // step. Keep those implicit submits inside the staged flow; only the final
    // review step is allowed to create an order.
    if (state.currentStage !== 'review') {
      advanceCheckoutStage();
      return;
    }
    if (state.branchLoading) {
      setMessage('در حال دریافت اطلاعات این شعبه؛ ثبت سفارش تا پایان بررسی انجام نمی‌شود.', 'error');
      return;
    }
    if (!state.cart.size) return;

    const validation = validateGuestCheckout();
    if (validation) {
      reportGuestCheckoutError(validation);
      return;
    }

    if (state.quoteChange) {
      setMessage('مبلغ پیش‌فاکتور تغییر کرده است؛ ابتدا مبلغ جدید را بررسی و تأیید کنید.', 'error');
      return;
    }

    if (!state.quote?.quoteToken || state.quoteSignature !== currentQuoteSignature()) {
      setMessage('پیش‌فاکتور هنوز به‌روز نیست؛ مبلغ را دوباره بررسی کنید.', 'error');
      refreshQuote();
      return;
    }

    const payload = checkoutOrderPayload();
    const signature = checkoutIntentSignature(payload);
    let storageKey;
    let priorIntent;
    let key;
    setCheckoutSubmitting(true);
    try {
      key = await prepareCheckoutReceiptCode(payload);
      if (!key) throw checkoutIntentStorageError(state.receiptPreparationError || 'checkout_secure_random_unavailable');
      storageKey = await checkoutIntentStorageKey(signature);
      priorIntent = storedCheckoutIntent(storageKey);
      markCheckoutIntentSubmitted(storageKey, key);
    } catch (error) {
      setCheckoutSubmitting(false);
      state.receiptPreparationError = error?.code || 'checkout_intent_storage_unavailable';
      renderCheckoutRecoveryNotice();
      const submitButton = $('checkout-submit');
      if (submitButton) submitButton.disabled = true;
      setMessage(checkoutErrorMessage(error), 'error');
      focusCheckoutMessage();
      return;
    }
    const intent = {
      payload,
      signature,
      storageKey,
      key,
      quoteTotal: quotePriceSnapshot(state.quote).total,
      manualFollowup: false,
    };

    state.idempotencyKey = key;
    state.idempotencySignature = signature;
    if (priorIntent?.submitted) lockUncertainCheckout(intent);
    return sendCheckoutIntent(intent, { retrying: !!priorIntent?.submitted });
  }

  function bindListeners() {
    if (listenersBound) return;
    listenersBound = true;
    ensureCheckoutAccessibility();
    ensureMobileCartShortcut();
    showCheckoutStage(state.currentStage, { focus: false, announce: false });
    $('checkout-live')?.setAttribute('role', 'status');
    $('checkout-live')?.setAttribute('aria-live', 'polite');
    $('checkout-note-text')?.setAttribute('aria-live', 'polite');

    $('checkout-categories')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-category]');
      if (!button) return;
      renderItems(Number(button.dataset.category));
    });

    $('checkout-items')?.addEventListener('click', (event) => {
      if (state.submitting) return;
      const button = event.target.closest('[data-add]');
      if (!button || button.disabled) return;
      const item = state.itemById.get(Number(button.dataset.add));
      if (!item) return;
      if (modifierGroupsForItem(item).length) openModifierDialog(item.id, button);
      else addToCart(item.id, []);
    });

    $('checkout-cart')?.addEventListener('click', (event) => {
      if (state.submitting) return;
      const add = event.target.closest('[data-cart-add]');
      if (add) {
        adjust(add.dataset.cartAdd, 1);
        return;
      }
      const subtract = event.target.closest('[data-cart-subtract]');
      if (subtract) adjust(subtract.dataset.cartSubtract, -1);
    });

    $('checkout-modifier-form')?.addEventListener('submit', submitModifierDialog);
    $('checkout-modifier-cancel')?.addEventListener('click', cancelModifierDialog);
    $('checkout-modifier-close')?.addEventListener('click', cancelModifierDialog);
    $('checkout-modifier-groups')?.addEventListener('change', clearModifierValidationError);
    $('checkout-modifier-dialog')?.addEventListener('cancel', (event) => {
      event.preventDefault();
      cancelModifierDialog();
    });
    $('checkout-price-review-accept')?.addEventListener('click', acceptQuoteChange);
    $('checkout-next-fulfillment')?.addEventListener('click', advanceCheckoutStage);
    $('checkout-next-customer')?.addEventListener('click', advanceCheckoutStage);
    $('checkout-next-review')?.addEventListener('click', advanceCheckoutStage);
    $('checkout-back-basket')?.addEventListener('click', goToPreviousCheckoutStage);
    $('checkout-back-fulfillment')?.addEventListener('click', goToPreviousCheckoutStage);
    $('checkout-back-customer')?.addEventListener('click', goToPreviousCheckoutStage);
    $('checkout-review-price-return')?.addEventListener('click', () => showCheckoutStage('basket'));

    document.querySelectorAll('input[name="fulfillment"]').forEach((input) => {
      input.addEventListener('change', syncFulfillmentFields);
    });

    $('checkout-branch')?.addEventListener('change', async () => {
      const branch = $('checkout-branch');
      const previousBranchId = state.branchId;
      const requestedBranchId = Number(branch?.value) || null;
      if (!requestedBranchId) return;
      const generation = ++branchChangeGeneration;

      state.branchLoading = true;
      branch?.setAttribute?.('aria-busy', 'true');
      setText($('checkout-live'), 'در حال دریافت اطلاعات شعبه…');
      setMessage('در حال بررسی شعبه و محدوده‌های فعال…');
      refreshQuote();

      try {
        await loadCheckoutMeta(requestedBranchId);
        if (generation === branchChangeGeneration) setMessage('');
      } catch (error) {
        if (generation !== branchChangeGeneration) return;
        if (branch) branch.value = previousBranchId ? String(previousBranchId) : '';
        state.branchId = previousBranchId || null;
        if (!isAbortError(error)) setMessage(error.message, 'error');
      } finally {
        if (generation === branchChangeGeneration) {
          state.branchLoading = false;
          branch?.removeAttribute?.('aria-busy');
          syncFulfillmentFields();
        }
      }
    });

    $('checkout-zone')?.addEventListener('change', refreshQuote);
    $('checkout-table')?.addEventListener('input', refreshQuote);
    $('checkout-phone')?.addEventListener('input', refreshQuote);
    $('checkout-payment')?.addEventListener('change', syncFulfillmentFields);
    $('checkout-form')?.addEventListener('submit', submit);
    $('checkout-form')?.addEventListener('input', (event) => {
      if (state.currentStage === 'review' && !state.submitting && !state.uncertainIntent) renderCheckoutReview();
      if (event.target?.getAttribute?.('aria-invalid') !== 'true') return;
      clearCheckoutFieldError(event.target);
    }, true);
    $('checkout-form')?.addEventListener('change', (event) => {
      if (state.currentStage === 'review' && !state.submitting && !state.uncertainIntent) renderCheckoutReview();
      if (event.target?.getAttribute?.('aria-invalid') !== 'true') return;
      clearCheckoutFieldError(event.target);
    }, true);
    $('checkout-recovery-form')?.addEventListener('submit', recoverCheckoutByReceiptCode);
    $('checkout-receipt-code-copy')?.addEventListener('click', () => copyCheckoutReceiptCode(state.receiptCode, 'checkout-receipt-code-status'));
    $('checkout-success-receipt-code-copy')?.addEventListener('click', () => copyCheckoutReceiptCode(state.receiptCode, 'checkout-success-receipt-code-status'));

    document.addEventListener('westo:langchange', () => {
      document.title = tr('checkout.documentTitle');
      renderCategories(Number($('checkout-categories')?.dataset.selected) || null);
      renderCart();
      syncFulfillmentFields();
      if (state.branchId) loadCheckoutMeta(state.branchId).catch(() => {});
    });
  }

  async function boot() {
    if (state.booted || state.booting) return;
    state.booting = true;
    document.title = tr('checkout.documentTitle');
    renderCheckoutRecoveryNotice();
    renderCheckoutLoadingState();

    const generation = ++bootGeneration;
    abortController(bootController);
    bootController = new AbortController();
    const context = qrContext();

    try {
      const [content] = await Promise.all([
        api('/api/content', {
          signal: bootController.signal,
          timeoutMs: 12000,
        }),
        loadCheckoutMeta(context.branchId || undefined),
      ]);

      if (generation !== bootGeneration || bootController.signal.aborted) return;

      state.categories = Array.isArray(content.menuCategories)
        ? content.menuCategories
        : [];
      state.items = (Array.isArray(content.menuItems) ? content.menuItems : []).filter(
        (item) => item.available !== false,
      );
      rebuildIndexes();

      bindListeners();
      loadUserAddresses();
      if (context.tableNo) {
        const dineIn = document.querySelector('input[name="fulfillment"][value="dine_in"]');
        if (dineIn) dineIn.checked = true;
        const table = $('checkout-table');
        if (table) {
          table.value = context.tableNo;
          table.dataset.qrPrefilled = '1';
        }
        const tableWrap = $('checkout-table-wrap');
        if (tableWrap && !document.getElementById('checkout-qr-hint')) {
          const hint = document.createElement('small');
          hint.id = 'checkout-qr-hint';
          hint.className = 'checkout-qr-hint';
          hint.textContent = tr('cart.qrPrefilled');
          tableWrap.appendChild(hint);
        }
        appendDescribedBy(table, 'checkout-qr-hint');
      }
      renderCategories();
      try {
        const reorderRaw = sessionStorage.getItem('westo_reorder_items');
        if (reorderRaw) {
          sessionStorage.removeItem('westo_reorder_items');
          const items = JSON.parse(reorderRaw);
          if (Array.isArray(items)) {
            restoreReorderItems(items);
          }
        }
      } catch (_) {}
      renderCart();
      syncFulfillmentFields();
      $('checkout-items')?.setAttribute?.('aria-busy', 'false');

      state.booted = true;
      state.booting = false;
    } catch (error) {
      state.booting = false;
      if (isAbortError(error)) return;
      renderCheckoutLoadError();
    }
  }

  window.addEventListener('pagehide', () => {
    if (quoteTimer) {
      window.clearTimeout(quoteTimer);
      quoteTimer = 0;
    }
    abortController(quoteController);
    quoteController = null;
    abortController(metaController);
    metaController = null;

    if (!state.booted) {
      abortController(bootController);
      bootController = null;
      state.booting = false;
      bootGeneration += 1;
    }
  });

  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;

    if (!state.booted) {
      boot();
      return;
    }

    // Preserve the current UI immediately after bfcache restore, then refresh
    // the derived quote in the background so totals cannot remain stale.
    if (state.cart.size && !$('checkout-form')?.hidden) refreshQuote();
  });

  boot();
})();
