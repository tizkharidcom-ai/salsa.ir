/* Westo Command Center — professional cafe/restaurant admin SPA */
(() => {
  const main = document.getElementById('main');
  const toast = document.getElementById('toast');
  const topbarTitle = document.getElementById('topbar-title');
  const topbarContext = document.getElementById('topbar-context');
  let state = { content: {}, products: [], menuItems: [], faq: [], settings: {} };

  const TAB_TITLES = {
    dashboard: 'داشبورد',
    kitchen: 'آشپزخانه',
    orders: 'سفارش‌ها',
    reservations: 'رزرو میز',
    analytics: 'بازدید و آمار',
    reports: 'گزارش فروش',
    finance: 'مالی و حسابداری',
    printmenu: 'منوی چاپی',
    translate: 'ترجمه منو',
    menu: 'منوی غذا',
    inventory: 'انبار و مواد اولیه',
    costControl: 'بهای تمام‌شده',
    expenses: 'هزینه‌ها',
    complements: 'مکمل‌ها و مهندسی منو',
    prices: 'مدیریت قیمت',
    products: 'دسته‌ها و ترتیب نمایش',
    promotions: 'تخفیف‌ها و پیشنهادها',
    promoSlides: 'اسلایدر تبلیغاتی',
    restaurant: 'اطلاعات مجموعه',
    branches: 'شعبه‌ها',
    theme: 'ظاهر و هویت برند',
    hours: 'ساعت کاری',
    tables: 'میزها',
    content: 'محتوای سایت',
    media: 'لوگو و رسانه',
    faq: 'سؤالات متداول',
    users: 'کاربران و پرسنل',
    loyalty: 'باشگاه مشتریان',
    club: 'باشگاه مشتریان',
    feedback: 'بازخورد و رضایت مهمان',
    newsletter: 'خبرنامه',
    settings: 'تنظیمات',
    delivery: 'تحویل، پیک و پرداخت',
    accounting: 'حسابداری',
  };


  const TAB_DESCRIPTIONS = {
    dashboard: 'وضعیت امروز، هشدارها و کارهای فوری', kitchen: 'صف آماده‌سازی و وضعیت آشپزخانه', orders: 'پیگیری و تغییر وضعیت سفارش‌ها', reservations: 'رزروهای میز و ظرفیت زمانی',
    analytics: 'رفتار بازدیدکنندگان و مسیرهای پرتردد', reports: 'فروش، درآمد و محصولات پرفروش', printmenu: 'پیش‌نمایش و چاپ منوی فعلی', translate: 'ترجمه نام و توضیح اقلام منو',
    menu: 'ویرایش غذاها، قیمت، تصویر و دسترس‌پذیری', inventory: 'مواد اولیه، موجودی واقعی و گردش انبار', costControl: 'بهای تمام‌شده، دستور تهیه و اثر مواد بر فروش', expenses: 'ثبت، پیگیری و اثر هزینه‌ها در دفتر مالی', complements: 'مدیریت مکمل‌های فروش‌محور و اتصال هوشمند آن‌ها به محصول یا دسته', prices: 'ویرایش سریع و گروهی قیمت‌ها', products: 'دسته‌بندی‌ها و ترتیب نمایش منو',
    promotions: 'مدیریت تخفیف‌های موجود', promoSlides: 'مدیریت اسلایدهای تبلیغاتی موجود', restaurant: 'اطلاعات عمومی و مشخصات مجموعه', branches: 'مشخصات و وضعیت شعبه‌ها',
    theme: 'رنگ‌ها و ظاهر برند', hours: 'ساعت فعالیت هر روز', tables: 'میزها، ظرفیت و رمزینه سفارش', content: 'متن‌های فعلی سایت', media: 'لوگو و فایل‌های رسانه‌ای', faq: 'پرسش‌های متداول سایت',
    users: 'مدیریت کارکنان، نقش‌ها و دسترسی‌های سامانه', loyalty: 'تنظیم و مانده باشگاه مشتریان', club: 'مشتریان، وفاداری، بازاریابی، بازخورد و خبرنامه', feedback: 'بازخوردها و رضایت مهمان', newsletter: 'عضویت‌های خبرنامه', settings: 'تنظیمات شفاف و بخش‌بندی‌شده مجموعه', delivery: 'محدوده ارسال، پیک و وضعیت پرداخت', finance: 'مسیر قدیمی مالی؛ به فضای یکپارچه هدایت می‌شود',
    accounting: 'کارتابل حسابدار، فروش و صندوق، خرید، بهای تمام‌شده، دفاتر و پایان دوره'
  };

  // These legacy entry points remain addressable for bookmarks, but all new
  // navigation lands in the single Finance V2 shell and its tabbed views.
  const FINANCE_SHORTCUTS = Object.freeze({
    finance: 'workbench',
  });

  const TAB_CAPABILITIES = {
    dashboard: 'command.view', kitchen: 'kitchen.view', orders: 'orders.view', reservations: 'reservations.view', delivery: 'delivery.view',
    menu: 'menu.view', prices: 'menu.manage', inventory: 'inventory.view', costControl: 'finance.view', expenses: 'finance.view', complements: 'menu.manage', products: 'menu.manage', translate: 'menu.manage', promotions: 'promotions.manage', promoSlides: 'content.manage', printmenu: 'menu.view',
    tables: 'tables.view', loyalty: 'admin.access', club: 'admin.access', feedback: 'admin.access', newsletter: 'admin.access',
    analytics: 'analytics.view', reports: 'reports.view', finance: 'finance.view', content: 'content.manage', media: 'content.manage', faq: 'content.manage',
    restaurant: 'admin.access', branches: 'admin.access', hours: 'admin.access', theme: 'admin.access', users: 'admin.access', settings: 'owner',
    accounting: 'finance.view',
  };

  let kitchenPoll = null;
  let kitchenSeenIds = new Set();
  let currentUserRole = 'guest';
  let currentUser = null;
  let moduleAccess = null;
  let crmAllBranchesScope = false;
  let activeTab = 'dashboard';
  let commandCenterStream = null;
  let commandCenterStreamKey = '';
  let liveRefreshTimer = null;
  let liveRefreshPending = false;
  let toastTimer = null;
  let kitchenPaint = null;
  let currentBranchId = Number(localStorage.getItem('westo_admin_branch') || 0) || null;
  let branchesCache = [];
  let branchSelectionError = null;
  let networkInFlight = 0;
  const deliveryAcceptanceKeys = new Map();
  const deliveryRejectionKeys = new Map();
  let workspaceEnhanceTimer = null;
  // ── Floor Studio refactored module instance ──────────────────────────
  // هنگام navigate بین tabها، cleanup شود
  let _floorStudioInstance = null;

  function hasCapability(capability) {
    if (capability === 'owner') return currentUserRole === 'owner';
    const caps = currentUser?.capabilities || [];
    return caps.includes('*') || caps.includes(capability);
  }

  function canOpenModuleTab(tab) {
    const feature = moduleAccess?.tabFeatures?.[tab];
    return !feature || moduleAccess.features?.[feature] === true;
  }
  function hasModuleCapability(capability) {
    return hasCapability(capability) && (!String(capability).startsWith('finance.') || canOpenModuleTab('accounting'));
  }

  const financeWorkspaceHref = (workspace = 'workbench') => `/admin?financeWorkspace=${encodeURIComponent(workspace)}&branchId=${encodeURIComponent(currentBranchId || 1)}#accounting`;
  const paymentModeLabel = (value) => ({ unavailable: 'در دسترس نیست', sandbox: 'آزمایشی', test: 'آزمایشی', live: 'عملیاتی', production: 'عملیاتی', disabled: 'غیرفعال' }[String(value || '').toLowerCase()] || String(value || 'نامشخص'));
  const paymentProviderLabel = (value) => {
    const provider = String(value || '').trim();
    if (!provider) return 'بدون درگاه';
    return provider.toLowerCase() === 'sandbox' ? 'پرداخت آزمایشی' : provider;
  };

  function statusLabel(status) {
    return {
      pending_online: 'در انتظار پرداخت آنلاین',
      awaiting_confirmation: 'نیازمند بررسی',
      pay_at_cashier: 'پرداخت در صندوق',
      paid: 'پرداخت‌شده',
      sent_to_kitchen: 'ارسال به آشپزخانه',
      preparing: 'در حال آماده‌سازی',
      ready: 'آماده تحویل',
      dispatched: 'ارسال با پیک',
      picked_up: 'تحویل حضوری شد',
      delivered: 'تحویل داده شد',
      done: 'تکمیل',
      cancelled: 'لغو',
    }[status] || String(status || '—');
  }

  function fulfillmentLabel(kind) {
    return { dine_in: 'داخل مجموعه', pickup: 'تحویل حضوری', delivery: 'ارسال با پیک' }[kind] || '—';
  }

  function adminOrderStatusLabel(order) {
    const status = String(order?.status || '').trim().toLowerCase();
    const fulfillment = String(order?.fulfillment || (order?.tableNo ? 'dine_in' : 'pickup')).trim().toLowerCase();
    if (fulfillment !== 'delivery') return statusLabel(status);
    const acceptance = String(order?.deliveryAcceptance?.status || '').trim().toLowerCase();
    const payment = String(order?.paymentStatus || '').trim().toLowerCase();
    if (status === 'awaiting_confirmation') {
      if (acceptance === 'accepted') return ['pending', 'unpaid', 'partial', 'unknown'].includes(payment)
        ? 'پذیرش رستوران ثبت شد · پرداخت نیازمند پیگیری'
        : 'پذیرش رستوران ثبت شد · منتظر آشپزخانه';
      if (acceptance === 'rejected') return 'پذیرش ارسال رد شده';
      return 'نیازمند تصمیم رستوران';
    }
    if (status === 'ready') return 'آماده تحویل به پیک';
    if (status === 'dispatched') return 'نزد پیک · تحویل نهایی مانده';
    return statusLabel(status);
  }

  function nextStatusesForOrder(order) {
    const validTransitions = new Set(['pending_online', 'awaiting_confirmation', 'pay_at_cashier', 'sent_to_kitchen', 'paid', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done', 'cancelled']);
    if (Array.isArray(order?.allowedStatusTransitions)) {
      const transitions = [...new Set(order.allowedStatusTransitions.filter((status) => validTransitions.has(status)))];
      return [order.status, ...transitions];
    }
    const fulfillment = order.fulfillment || (order.tableNo ? 'dine_in' : 'pickup');
    const map = {
      pending_online: ['cancelled'],
      awaiting_confirmation: ['cancelled'],
      pay_at_cashier: ['cancelled'],
      sent_to_kitchen: ['preparing', 'cancelled'],
      paid: ['preparing', 'cancelled'],
      preparing: ['ready', 'cancelled'],
      ready: fulfillment === 'delivery' ? ['dispatched', 'cancelled'] : fulfillment === 'pickup' ? ['picked_up', 'cancelled'] : ['done', 'cancelled'],
      dispatched: ['delivered', 'cancelled'],
      picked_up: [], delivered: [], done: [], cancelled: [],
    };
    return [order.status, ...(map[order.status] || [])];
  }


  const TERMINAL_ORDER_STATUSES = new Set(['picked_up', 'delivered', 'done', 'cancelled']);

  function orderAgeMinutes(order) {
    const status = String(order?.status || '');
    const history = Array.isArray(order?.statusHistory) ? order.statusHistory : [];
    let at = null;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      if (String(history[index]?.status || '') !== status) continue;
      const parsed = new Date(history[index]?.at || '').getTime();
      if (Number.isFinite(parsed)) { at = parsed; break; }
    }
    if (at === null) {
      const statusTimeField = { paid: 'paidAt', preparing: 'startedAt', ready: 'readyAt', dispatched: 'dispatchedAt', done: 'doneAt', delivered: 'doneAt', picked_up: 'doneAt' }[status];
      const statusTime = statusTimeField ? new Date(order?.[statusTimeField] || '').getTime() : NaN;
      const fallbackTime = new Date(order?.statusAt || order?.createdAt || '').getTime();
      at = Number.isFinite(statusTime) ? statusTime : Number.isFinite(fallbackTime) ? fallbackTime : Date.now();
    }
    return Math.max(0, Math.floor((Date.now() - at) / 60000));
  }

  function orderUrgency(order) {
    if (TERMINAL_ORDER_STATUSES.has(String(order?.status || ''))) return { key: 'closed', label: 'بسته', className: '' };
    const age = orderAgeMinutes(order);
    if (['pending_online', 'awaiting_confirmation', 'pay_at_cashier'].includes(String(order?.status || ''))) {
      return age >= 20
        ? { key: 'payment-review', label: `${fmtNum(age)} دقیقه · پیگیری پرداخت`, className: ' is-warn' }
        : { key: 'payment-wait', label: `${fmtNum(age)} دقیقه · انتظار پرداخت`, className: '' };
    }
    if (['ready', 'dispatched'].includes(String(order?.status || ''))) {
      return age >= 20
        ? { key: 'handoff-wait', label: `${fmtNum(age)} دقیقه · انتظار تحویل`, className: ' is-warn' }
        : { key: 'handoff', label: `${fmtNum(age)} دقیقه`, className: '' };
    }
    if (age >= 20) return { key: 'late', label: `${fmtNum(age)} دقیقه · دیرکرد`, className: ' is-late' };
    if (age >= 10) return { key: 'warn', label: `${fmtNum(age)} دقیقه`, className: ' is-warn' };
    return { key: 'normal', label: `${fmtNum(age)} دقیقه`, className: '' };
  }

  function primaryNextStatus(order) {
    return nextStatusesForOrder(order).find((status) => status !== order.status && status !== 'cancelled') || '';
  }

  function adminDeliveryAcceptanceView(order, canManageDelivery) {
    const fulfillment = String(order?.fulfillment || (order?.tableNo ? 'dine_in' : 'pickup')).trim().toLowerCase();
    const orderStatus = String(order?.status || '').trim().toLowerCase();
    if (fulfillment !== 'delivery' || !['pending_online', 'awaiting_confirmation', 'pay_at_cashier', 'paid'].includes(orderStatus)) return null;

    const status = String(order?.deliveryAcceptance?.status || '').trim().toLowerCase();
    const paymentStatus = String(order?.paymentStatus || '').trim().toLowerCase();
    if (status === 'accepted') {
      return {
        status,
        badge: 'پذیرش انجام شده',
        detail: ['pending', 'unknown'].includes(paymentStatus)
          ? 'پذیرش رستوران ثبت شده است؛ پرداخت هنوز در انتظار یا نیازمند تطبیق است و سفارش تا روشن‌شدن وضعیت پرداخت وارد آشپزخانه نمی‌شود.'
          : 'پذیرش رستوران ثبت شده است؛ پذیرش و پرداخت دو مرحلهٔ مستقل‌اند و ورود به آشپزخانه فقط طبق وضعیت مجاز پرداخت انجام می‌شود.',
        canAccept: false,
      };
    }
    if (status === 'rejected') {
      const rejectionReason = String(order?.deliveryAcceptance?.reason || '').trim();
      return {
        status,
        badge: 'پذیرش رد شده',
        detail: rejectionReason
          ? `علت ثبت‌شده: ${rejectionReason} · این سفارش وارد صف آشپزخانه نمی‌شود.`
          : 'این سفارش وارد صف آشپزخانه نمی‌شود؛ برای بررسی با مسئول مجاز تحویل هماهنگ کنید.',
        canAccept: false,
      };
    }
    if (status && !['pending', 'unrecorded'].includes(status)) {
      return {
        status: 'unknown',
        badge: 'وضعیت پذیرش نامشخص',
        detail: 'برای جلوگیری از ارسال تکراری، وضعیت پذیرش را تازه‌سازی و بررسی کنید.',
        canAccept: false,
      };
    }
    return {
      status: status || 'unrecorded',
      badge: status === 'pending' ? 'در انتظار پذیرش رستوران' : 'پذیرش رستوران ثبت نشده',
      detail: canManageDelivery
        ? 'پذیرش مستقل از پرداخت است و اکنون قابل ثبت است؛ پس از پذیرش، سفارش فقط وقتی وضعیت پرداخت اجازه دهد وارد صف آشپزخانه می‌شود.'
        : 'این اقدام فقط برای کاربر دارای دسترسی پذیرش تحویل فعال است.',
      canAccept: canManageDelivery === true,
    };
  }

  function adminDeliveryNextStep(order) {
    const fulfillment = String(order?.fulfillment || (order?.tableNo ? 'dine_in' : 'pickup')).trim().toLowerCase();
    if (fulfillment !== 'delivery') return null;
    const status = String(order?.status || '').trim().toLowerCase();
    const acceptance = String(order?.deliveryAcceptance?.status || '').trim().toLowerCase();
    const payment = String(order?.paymentStatus || '').trim().toLowerCase();
    if (acceptance === 'rejected') return {
      key: 'rejected', label: 'پذیرش ارسال رد شده',
      detail: 'این سفارش به آشپزخانه یا مرحلهٔ تحویل به پیک نمی‌رود؛ برای اقدام بعدی با مسئول مجاز هماهنگ کنید.',
    };
    if (['pending_online', 'awaiting_confirmation', 'pay_at_cashier', 'paid'].includes(status)
      && !['accepted', 'rejected'].includes(acceptance)) {
      return {
        key: 'restaurant-decision', label: 'گام بعد: تصمیم رستوران',
        detail: ['pending_online', 'pay_at_cashier'].includes(status) || ['pending', 'unpaid', 'partial', 'unknown'].includes(payment)
          ? 'پذیرش سفارش و پرداخت دو پیگیری جدا هستند؛ وضعیت پرداخت را هم بررسی کنید.'
          : 'پیش از ورود به آشپزخانه، سفارش را بپذیرید یا با دلیل رد کنید.',
      };
    }
    if (status === 'ready') {
      const dispatchAllowed=!Array.isArray(order?.allowedStatusTransitions)||order.allowedStatusTransitions.includes('dispatched');
      return dispatchAllowed?{
        key: 'courier-handoff', label: 'گام بعد: تحویل سفارش به پیک',
        detail: 'فقط پس از تحویل فیزیکی سفارش به پیک، «تحویل به پیک» را ثبت کنید.',
      }:{
        key: 'courier-handoff-blocked', label: 'تحویل به پیک فعلاً مسدود است',
        detail: 'سامانه مرحلهٔ بعد را مجاز اعلام نکرده است؛ وضعیت پذیرش رستوران را تازه‌سازی کنید و علت را با مدیر سامانه پیگیری کنید.',
      };
    }
    if (status === 'dispatched') {
      const deliveryAllowed=!Array.isArray(order?.allowedStatusTransitions)||order.allowedStatusTransitions.includes('delivered');
      return deliveryAllowed?{
        key: 'customer-delivery', label: 'سفارش نزد پیک است',
        detail: 'پس از تأیید تحویل به مشتری، تحویل نهایی را ثبت کنید.',
      }:{
        key: 'customer-delivery-blocked', label: 'ثبت تحویل نهایی فعلاً مسدود است',
        detail: 'سامانه مرحلهٔ تحویل نهایی را مجاز اعلام نکرده است؛ وضعیت سفارش و پذیرش رستوران را تازه‌سازی کنید.',
      };
    }
    if (status === 'delivered') return { key: 'delivered', label: 'تحویل نهایی ثبت شده', detail: 'مسیر ارسال این سفارش پایان یافته است.' };
    if (status === 'sent_to_kitchen' || status === 'preparing') return {
      key: 'kitchen', label: 'سفارش در آشپزخانه است', detail: 'پس از آماده‌شدن سفارش، مرحلهٔ تحویل به پیک فعال می‌شود.',
    };
    if (status === 'cancelled') return { key: 'cancelled', label: 'سفارش لغو شده', detail: 'اقدام تحویل برای این سفارش انجام نمی‌شود.' };
    if (status === 'done') return { key: 'done', label: 'سفارش تکمیل شده', detail: 'مسیر عملیاتی این سفارش پایان یافته است.' };
    return { key: 'review', label: 'وضعیت ارسال نیازمند بررسی', detail: 'پیش از هر اقدامی وضعیت تازهٔ سفارش را بررسی کنید.' };
  }

  function adminDeliveryRejectionPayload(reason) {
    const normalized = String(reason ?? '').trim();
    return normalized && normalized.length <= 500 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)
      ? { reason: normalized }
      : null;
  }

  function adminDeliveryRejectionValidationMessage(reason) {
    const normalized = String(reason ?? '').trim();
    if (!normalized) return 'علت رد سفارش را بنویسید.';
    if (normalized.length > 500) return 'علت رد سفارش حداکثر ۵۰۰ نویسه است.';
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) return 'علت رد شامل نویسهٔ نامعتبر است؛ متن را پاک‌نویس کنید.';
    return '';
  }

  function adminDeliveryRejectionIntent(orderId, reason) {
    const normalizedReason = String(reason ?? '').trim();
    const storageKey = `westo:delivery-reject:${currentBranchId || 'branch'}:${String(orderId)}`;
    let intent = deliveryRejectionKeys.get(storageKey) || null;
    if (!intent) {
      let persistedKey = '';
      try { persistedKey = sessionStorage.getItem(storageKey) || ''; } catch (_) { /* storage will be checked before sending */ }
      if (persistedKey) {
        intent = { key: persistedKey, reason: null, needsStatusCheck: true };
        deliveryRejectionKeys.set(storageKey, intent);
      }
    }
    if (intent?.needsStatusCheck) return { ok: false, storageKey, needsStatusCheck: true };
    if (intent && intent.reason !== normalizedReason) return { ok: false, storageKey, reasonConflict: true };
    if (intent) return { ok: true, storageKey, key: intent.key };

    const key = globalThis.crypto?.randomUUID?.()
      || `delivery-reject-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const nextIntent = { key, reason: normalizedReason };
    try {
      sessionStorage.setItem(storageKey, key);
      if (sessionStorage.getItem(storageKey) !== key) return { ok: false, storageKey, storageUnavailable: true };
    } catch (_) {
      return { ok: false, storageKey, storageUnavailable: true };
    }
    deliveryRejectionKeys.set(storageKey, nextIntent);
    return { ok: true, storageKey, key };
  }

  function clearAdminDeliveryRejectionIntent(storageKey) {
    deliveryRejectionKeys.delete(storageKey);
    try { sessionStorage.removeItem(storageKey); } catch (_) { /* the server state remains authoritative */ }
  }

  function adminDeliveryRejectionConfirmed(response, orderId) {
    const order = response?.order;
    return response?.ok === true
      && String(order?.id ?? '') === String(orderId)
      && String(order?.deliveryAcceptance?.status || '').trim().toLowerCase() === 'rejected';
  }

  function adminDeliveryAcceptanceIdempotencyKey(orderId) {
    const storageKey = `westo:delivery-accept:${currentBranchId || 'branch'}:${String(orderId)}`;
    let key = deliveryAcceptanceKeys.get(storageKey) || '';
    try { key = sessionStorage.getItem(storageKey) || key; } catch (_) { /* use a tab-local fallback */ }
    if (!key) {
      key = globalThis.crypto?.randomUUID?.()
        || `delivery-accept-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      try { sessionStorage.setItem(storageKey, key); } catch (_) { /* the current request still has a stable key */ }
    }
    deliveryAcceptanceKeys.set(storageKey, key);
    return { storageKey, key };
  }

  function clearAdminDeliveryAcceptanceIdempotencyKey(storageKey) {
    deliveryAcceptanceKeys.delete(storageKey);
    try { sessionStorage.removeItem(storageKey); } catch (_) { /* persisted confirmation is already authoritative */ }
  }

  function primaryActionLabel(status) {
    return {
      paid: 'تأیید پرداخت', preparing: 'شروع آماده‌سازی', ready: 'آماده شد', dispatched: 'تحویل به پیک',
      picked_up: 'تحویل حضوری شد', delivered: 'تحویل داده شد', done: 'تکمیل سفارش'
    }[status] || (status ? `مرحله بعد: ${statusLabel(status)}` : '');
  }

  function adminDeliveryStatusConfirmation(orderId, nextStatus) {
    if (nextStatus === 'dispatched') {
      return `تحویل فیزیکی سفارش #${orderId} به پیک انجام شده است؟ فقط پس از تحویل واقعی، این مرحله را ثبت کنید.`;
    }
    if (nextStatus === 'delivered') {
      return `مشتری سفارش #${orderId} را تحویل گرفته است؟ ثبت این مرحله، ارسال را نهایی می‌کند.`;
    }
    return '';
  }

  function adminRestoreDeliveryStatusSelection(select, status) {
    if (!select || !('value' in select)) return false;
    select.value = String(status ?? '');
    return true;
  }


  async function runBusy(button, task, busyText = 'در حال انجام…') {
    if (!button || button.dataset.busy === '1') return;
    const before = button.textContent;
    button.dataset.busy = '1';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (busyText) button.textContent = busyText;
    try { return await task(); }
    finally {
      button.dataset.busy = '0';
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = before;
    }
  }

  function branchQs(extra = '') {
    const q = new URLSearchParams(extra);
    if (currentBranchId) q.set('branchId', String(currentBranchId));
    const s = q.toString();
    return s ? `?${s}` : '';
  }

  function adminKdsIsHeldLine(item) {
    return String(item?.courseStatus || '').trim().toLowerCase() === 'hold';
  }

  function adminKitchenTicketProgress(ticket) {
    const items = Array.isArray(ticket?.items) ? ticket.items : [];
    const activeItems = items.filter((item) => !adminKdsIsHeldLine(item));
    const heldItems = [
      ...(Array.isArray(ticket?.heldCourseItems) ? ticket.heldCourseItems : []),
      ...items.filter(adminKdsIsHeldLine),
    ];
    const seenHeldKeys = new Set();
    const heldCount = heldItems.filter((item) => {
      const key = String(item?.key || '');
      if (!key) return true;
      if (seenHeldKeys.has(key)) return false;
      seenHeldKeys.add(key);
      return true;
    }).length;
    const completedCount = activeItems.filter((item) => Boolean(item?.completedAt)).length;
    const remainingCount = Math.max(0, activeItems.length - completedCount);

    return {
      activeCount: activeItems.length,
      completedCount,
      remainingCount,
      heldCount,
      canCompleteTicket: activeItems.length > 0 && remainingCount === 0 && heldCount === 0,
    };
  }

  function adminKitchenPaymentGuard(ticket) {
    const status = String(ticket?.paymentStatus || '').trim().toLowerCase();
    const orderStatus = String(ticket?.status || '').trim().toLowerCase();
    if (!['unpaid', 'partial', 'failed', 'paid'].includes(status)) {
      return { eligible: false, message: 'وضعیت پرداخت ثبت یا تطبیق نشده است؛ این سفارش فقط برای بررسی نمایش داده می‌شود.' };
    }
    if (orderStatus === 'paid' && status !== 'paid') {
      return { eligible: false, message: 'وضعیت سفارش و پرداخت با هم سازگار نیست؛ پیش از آماده‌سازی با مسئول صندوق بررسی کنید.' };
    }
    return { eligible: true, message: '' };
  }

  function adminKitchenLineAction(item, ticketColumn) {
    if (!item || adminKdsIsHeldLine(item) || !String(item.key || '').trim()) return null;
    if (!['preparing', 'ready'].includes(String(ticketColumn || ''))) return null;
    const completed = Boolean(item.completedAt);
    if (ticketColumn === 'ready' && !completed) return null;
    return { action: completed ? 'undo_item' : 'complete_item', lineKey: String(item.key) };
  }

  function adminKitchenCompletionAction(ticket, progress) {
    if (ticket?.column !== 'preparing') return null;
    if (progress?.canCompleteTicket === true) {
      return { action: 'complete_ticket', enabled: true, label: 'ثبت آماده‌بودن سفارش' };
    }
    const label = progress?.heldCount && progress?.remainingCount
      ? 'منتظر تکمیل قلم‌ها و ارسال دوره از سالن'
      : progress?.heldCount
        ? 'منتظر ارسال دوره از سالن'
        : 'ابتدا همهٔ اقلام را تکمیل کنید';
    return { action: null, enabled: false, label };
  }

  function adminKitchenActionPayload(dataset = {}) {
    const action = String(dataset.kdsAction || '');
    if (!['start_ticket', 'complete_item', 'undo_item', 'complete_ticket'].includes(action)) return null;
    if (action === 'complete_ticket' && dataset.kdsCanComplete !== 'true') return null;
    if (action === 'complete_item' || action === 'undo_item') {
      const lineKey = String(dataset.lineKey || '').trim();
      return lineKey ? { action, lineKey } : null;
    }
    return { action };
  }

  function adminKitchenActionApplied(ticket, payload) {
    if (!ticket || !payload) return false;
    const column = String(ticket.column || '').trim().toLowerCase();
    if (payload.action === 'start_ticket') return ['preparing', 'ready'].includes(column);
    if (payload.action === 'complete_ticket') return column === 'ready';
    if (!['complete_item', 'undo_item'].includes(payload.action)) return false;
    const line = [...(Array.isArray(ticket.items) ? ticket.items : []), ...(Array.isArray(ticket.heldCourseItems) ? ticket.heldCourseItems : [])]
      .find((item) => String(item?.key || '') === String(payload.lineKey || ''));
    if (!line || adminKdsIsHeldLine(line)) return false;
    return payload.action === 'complete_item'
      ? Boolean(line.completedAt)
      : column === 'preparing' && !line.completedAt;
  }

  function adminKitchenActionErrorMessage(error) {
    const code = String(error?.message || '').trim();
    const messages = {
      delivery_acceptance_required: 'پذیرش رستوران برای این سفارش ارسال ثبت نشده است؛ آشپزخانه نمی‌تواند آن را شروع کند.',
      payment_reconciliation_required: 'وضعیت پرداخت سفارش روشن نیست؛ پیش از تغییر صف، آن را با مسئول صندوق یا مدیر بررسی کنید.',
      kitchen_transition_invalid: 'وضعیت سفارش تغییر کرده یا این اقدام دیگر مجاز نیست؛ صف تازه شد، وضعیت فعلی را بررسی کنید.',
      kds_ticket_incomplete: 'برای آماده‌بودن سفارش، همهٔ اقلام فعال را تکمیل کنید و دوره‌های نگه‌داشته‌شده را از سالن پیگیری کنید.',
      kds_item_invalid: 'این قلم دیگر با وضعیت سفارش هم‌خوان نیست؛ جزئیات تازهٔ سفارش را بررسی کنید.',
      kitchen_recall_invalid: 'این سفارش دیگر در وضعیت قابل‌بازگردانی نیست؛ وضعیت تازه را بررسی کنید.',
      kds_persistence_failed: 'ثبت پایدار تغییر تأیید نشد؛ وضعیت صف را تازه کنید و تا روشن‌شدن نتیجه دوباره اقدام نکنید.',
    };
    return messages[code] || code || 'ثبت تغییر تأیید نشد.';
  }

  async function sendAdminKitchenAction(orderId, payload) {
    try {
      const result = await api(`/api/kitchen/orders/${encodeURIComponent(orderId)}${branchQs()}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      if (result?.ok !== true) throw new Error('پاسخ سرور ثبت تغییر را تأیید نکرد.');
      return result;
    } catch (error) {
      throw new Error(adminKitchenActionErrorMessage(error));
    }
  }

  async function settleKitchenWorkspaceRequests(queueRequest, callsRequest, callsTimeoutMs = 8000) {
    let callsTimer = null;
    const callsOutcome = Promise.resolve(callsRequest).then(
      (value) => ({ status: 'fulfilled', value }),
      (reason) => ({ status: 'rejected', reason })
    );
    const boundedCallsOutcome = Promise.race([
      callsOutcome,
      new Promise((resolve) => {
        callsTimer = setTimeout(() => {
          const error = new Error('دریافت فراخوان‌های سالن بیش از حد طول کشید.');
          error.code = 'KITCHEN_CALLS_TIMEOUT';
          resolve({ status: 'rejected', reason: error });
        }, Math.max(1, Number(callsTimeoutMs) || 8000));
      }),
    ]);
    try {
      const queue = await queueRequest;
      const callsResult = await boundedCallsOutcome;
      return {
        queue,
        calls: callsResult.status === 'fulfilled' ? callsResult.value : { calls: [] },
        callsError: callsResult.status === 'rejected' ? callsResult.reason : null,
      };
    } finally {
      if (callsTimer) clearTimeout(callsTimer);
    }
  }

  function shouldRenderKitchenSnapshot(requestVersion, latestVersion, requestedBranchId, currentBranchId, selectedTab) {
    return Number(requestVersion) === Number(latestVersion)
      && String(requestedBranchId ?? '') === String(currentBranchId ?? '')
      && selectedTab === 'kitchen';
  }

  function orderKitchenAdminTickets(tickets = []) {
    return (Array.isArray(tickets) ? tickets : []).slice().sort((a, b) =>
      Number(b?.kds?.priority === true) - Number(a?.kds?.priority === true)
      || Number(b?.ageSec || 0) - Number(a?.ageSec || 0)
    );
  }

  function adminKitchenAmendmentLabel(ticket) {
    const revision = Number(ticket?.editRevision);
    const hasRevision = Number.isSafeInteger(revision) && revision > 0;
    const editedAtRaw = String(ticket?.editedAt || '').trim();
    const editedAt = editedAtRaw ? Date.parse(editedAtRaw) : NaN;
    const hasEditedAt = Number.isFinite(editedAt);
    if (!hasRevision && !hasEditedAt) return '';

    const parts = ['اصلاح سفارش پس از ارسال'];
    if (hasRevision) parts.push(`نسخه ${new Intl.NumberFormat('fa-IR').format(revision)}`);
    if (hasEditedAt) {
      parts.push(`ساعت ${new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' }).format(new Date(editedAt))}`);
    }
    return parts.join(' · ');
  }

  function currentBranch() {
    return branchesCache.find((b) => b.id === currentBranchId) || branchesCache[0] || null;
  }

  async function loadBranches(session = null) {
    try {
      const d = session || await api('/api/admin/session');
      branchesCache = d.branches || [];
      const requestedBranchRaw = new URLSearchParams(location.search).get('branchId');
      branchSelectionError = null;
      if (requestedBranchRaw != null && requestedBranchRaw.trim() !== '') {
        const requestedBranchId = Number(requestedBranchRaw);
        const validRequestedId = /^\d+$/.test(requestedBranchRaw.trim())
          && Number.isSafeInteger(requestedBranchId) && requestedBranchId > 0;
        const requestedBranch = validRequestedId
          ? branchesCache.find((branch) => Number(branch.id) === requestedBranchId)
          : null;
        if (!validRequestedId) {
          currentBranchId = null;
          branchSelectionError = Object.assign(new Error('شناسهٔ شعبه معتبر نیست.'), { code: 'finance_branch_id_invalid' });
        } else if (!requestedBranch) {
          currentBranchId = null;
          branchSelectionError = Object.assign(new Error('شعبهٔ انتخاب‌شده یافت نشد یا برای این کاربر مجاز نیست.'), { code: 'finance_branch_not_found' });
        } else {
          // A deep link is authoritative. Do not let a stale localStorage
          // selection silently replace the branch encoded in the URL.
          currentBranchId = requestedBranchId;
          localStorage.setItem('westo_admin_branch', String(currentBranchId));
        }
      } else if (!currentBranchId || !branchesCache.some((b) => b.id === currentBranchId)) {
        currentBranchId = branchesCache[0]?.id || null;
        if (currentBranchId) localStorage.setItem('westo_admin_branch', String(currentBranchId));
      }
      paintBranchSelect();
    } catch {
      branchesCache = [];
      branchSelectionError = null;
    }
  }

  function paintBranchSelect() {
    const sel = document.getElementById('branch-select');
    if (!sel) return;
    const wrap = sel.closest('.branch-select-wrap');
    if (wrap) {
      const hasMultipleBranches = branchesCache.length > 1;
      wrap.hidden = !hasMultipleBranches;
      wrap.setAttribute('aria-hidden', hasMultipleBranches ? 'false' : 'true');
    }
    if (branchesCache.length <= 1) return;
    sel.innerHTML = branchesCache
      .map(
        (b) =>
          `<option value="${b.id}" ${b.id === currentBranchId ? 'selected' : ''}>${esc(b.name)}${b.active === false ? ' (غیرفعال)' : ''}</option>`
      )
      .join('');
    sel.onchange = () => {
      currentBranchId = Number(sel.value) || null;
      crmAllBranchesScope = false;
      if (currentBranchId) {
        branchSelectionError = null;
        localStorage.setItem('westo_admin_branch', String(currentBranchId));
        const nextUrl = new URL(location.href);
        nextUrl.searchParams.set('branchId', String(currentBranchId));
        history.replaceState(history.state, '', nextUrl);
      }
      startCommandCenterStream();
      const active = document.querySelector('.admin-nav-item.active');
      const tab = active?.dataset?.tab;
      if (tab && tabs[tab]) tabs[tab]().catch((e) => showToast(e.message));
    };
  }

  function stopKitchenPoll() {
    if (kitchenPoll) {
      clearInterval(kitchenPoll);
      kitchenPoll = null;
    }
  }

  function fmtAge(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m <= 0) return `${s}ث`;
    return `${m}د ${s}ث`;
  }

  function beepNewOrder() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.value = 0.04;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      setTimeout(() => {
        o.stop();
        ctx.close();
      }, 180);
    } catch (_) {
      /* ignore */
    }
  }

  const DAY_LABELS = {
    sat: 'شنبه',
    sun: 'یکشنبه',
    mon: 'دوشنبه',
    tue: 'سه‌شنبه',
    wed: 'چهارشنبه',
    thu: 'پنجشنبه',
    fri: 'جمعه',
  };

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmtMoney = (n) => `${window.WestoPersianFormat?.number(n, { locale: 'fa-IR' }) ?? Number(n || 0).toLocaleString('fa-IR')} تومان`;
  const fmtNum = (n) => Number(n || 0).toLocaleString('fa-IR');
  const parseInputNumber = (value) => window.WestoPersianFormat?.parse?.(value) ?? Number(value || 0);
  const fmtDateTime = (d) => {
    if (!d) return '—';
    try {
      if (window.ShamsiCore) return window.ShamsiCore.formatShamsiDateTime(d);
      return new Date(d).toLocaleString('fa-IR');
    } catch (_) {
      return String(d);
    }
  };
  const fmtDate = (d) => {
    if (!d) return '—';
    try {
      if (window.ShamsiCore) return window.ShamsiCore.formatShamsiDateLong(d);
      return new Date(d).toLocaleDateString('fa-IR');
    } catch (_) {
      return String(d);
    }
  };

  let lastBrandTheme = null;

  function applyTheme(theme) {
    if (!theme) return;
    lastBrandTheme = theme;
    const root = document.documentElement;
    const light = root.getAttribute('data-theme') === 'light';
    if (theme.accent) root.style.setProperty('--p-accent', theme.accent);
    if (theme.accentInk) root.style.setProperty('--p-accent-ink', theme.accentInk);
    if (theme.radius != null) root.style.setProperty('--p-radius', `${theme.radius}px`);
    // Brand bg/surface/fog are dark-first; in light mode let CSS tokens win.
    if (light) {
      root.style.removeProperty('--p-surface');
      root.style.removeProperty('--p-bg');
      root.style.removeProperty('--p-text');
    } else {
      if (theme.surface) root.style.setProperty('--p-surface', theme.surface);
      if (theme.bg) root.style.setProperty('--p-bg', theme.bg);
      if (theme.fog) root.style.setProperty('--p-text', theme.fog);
    }
  }

  function colorField(label, id, value) {
    return `<div class="field"><label for="${id}">${esc(label)}</label>
      <div class="color-row">
        <input type="color" id="${id}" value="${esc(value || '#78d0d8')}" />
        <input class="ltr-input" dir="ltr" id="${id}_hex" value="${esc(value || '#78d0d8')}" />
      </div>
    </div>`;
  }

  function wireColorPair(id) {
    const c = document.getElementById(id);
    const h = document.getElementById(`${id}_hex`);
    if (!c || !h) return;
    c.addEventListener('input', () => {
      h.value = c.value;
      applyTheme(readThemeForm());
    });
    h.addEventListener('change', () => {
      if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(h.value.trim())) {
        c.value = h.value.trim();
        applyTheme(readThemeForm());
      }
      });
  }

  function applyRoleAccess() {
    document.querySelectorAll('.admin-nav-item[data-tab]').forEach((button) => {
      const capability = button.dataset.capability || TAB_CAPABILITIES[button.dataset.tab];
      button.hidden = (!!capability && !hasCapability(capability)) || !canOpenModuleTab(button.dataset.tab);
    });
    document.querySelectorAll('.nav-workspace').forEach((group) => {
      const visible = [...group.querySelectorAll('.admin-nav-item[data-tab]')].some((button) => !button.hidden);
      group.hidden = !visible;
    });
    document.querySelectorAll('a[href="/reserve"]').forEach(link => { link.hidden = !canOpenModuleTab('reservations'); });
    document.querySelectorAll('a[href="/feedback"]').forEach(link => { link.hidden = !canOpenModuleTab('feedback'); });
    const chip = document.getElementById('admin-user-chip');
    if (chip && currentUser) {
      const roleLabel = String(currentUser.roleLabel || currentUserRole || 'کاربر').trim() || 'کاربر';
      const identity = String(currentUser.name || currentUser.phone || 'کاربر').trim() || 'کاربر';
      const avatarIdentity = String(currentUser.name && currentUser.name !== currentUser.phone ? currentUser.name : roleLabel).trim() || identity;
      const initial = chip.querySelector('.admin-user-avatar__initial');
      if (initial) initial.textContent = avatarIdentity.slice(0, 1);
      const menuName = document.getElementById('admin-user-name');
      const menuRole = document.getElementById('admin-user-role');
      if (menuName) menuName.textContent = identity;
      if (menuRole) menuRole.textContent = roleLabel;
      chip.title = `${identity} · ${roleLabel}`;
      chip.setAttribute('aria-label', `${identity}، ${roleLabel}`);
    }
    const rolePreviewTrigger = document.getElementById('admin-role-preview-trigger');
    if (rolePreviewTrigger) rolePreviewTrigger.hidden = !hasCapability('role.preview');
  }

  function initRolePreview() {
    const trigger = document.getElementById('admin-role-preview-trigger');
    const dialog = document.getElementById('admin-role-preview');
    const grid = document.getElementById('admin-role-preview-grid');
    if (!trigger || !dialog || !grid || !hasCapability('role.preview')) return;
    const details = {
      cashier: { icon: '⌁', description: 'تسویه نقدی و کارت، صف تحویل، صندوق پول و تطبیق پایان شیفت', tone: 'cyan' },
      waiter: { icon: '◎', description: 'نقشه سالن، میزها، فراخوان مهمان، رزرو و سفارش‌گیری کنار میز', tone: 'green' },
      kitchen: { icon: '≋', description: 'نمایشگر مستقل آشپزخانه، زمان سفارش، شروع آماده‌سازی و اعلام آماده‌شدن', tone: 'orange' },
    };
    trigger.addEventListener('click', async () => {
      grid.innerHTML = '<div class="admin-role-preview__loading">در حال دریافت سطح‌های دسترسی…</div>';
      dialog.showModal();
      try {
        const data = await api('/api/admin/role-preview');
        grid.innerHTML = (data.workspaces || []).map((workspace) => {
          const info = details[workspace.role] || {};
          return `<a class="admin-role-card admin-role-card--${esc(info.tone || 'cyan')}" href="${esc(workspace.path)}">
            <span class="admin-role-card__icon">${esc(info.icon || '•')}</span>
            <div><strong>${esc(workspace.label)}</strong><p>${esc(info.description || '')}</p><small>${fmtNum(workspace.capabilities?.length || 0)} مجوز محدودشده</small></div>
            <b>ورود به پنل ←</b>
          </a>`;
        }).join('');
      } catch (error) {
        grid.innerHTML = `<div class="admin-role-preview__loading">${esc(error.message)}</div>`;
      }
    });
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  }

  function clearLiveRefreshTimer() {
    if (!liveRefreshTimer) return;
    clearTimeout(liveRefreshTimer);
    liveRefreshTimer = null;
  }

  function isLiveWorkspace(tab = activeTab) {
    return tab === 'kitchen' || ['dashboard', 'orders', 'reservations'].includes(tab);
  }

  function setAdminKitchenStreamStatus(connected) {
    if (activeTab !== 'kitchen') return;
    const existing = main.querySelector('[data-kds-stream-status]');
    if (connected) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const status = '<section class="section-box kds-stream-warning" role="status" data-kds-stream-status><p class="eyebrow">اتصال زنده قطع است</p><p class="lead">تغییر سفارش‌ها ممکن است فوری نمایش داده نشوند؛ صف را دستی تازه‌سازی کنید.</p></section>';
    const pageHead = main.querySelector('.ops-page-head');
    if (pageHead) pageHead.insertAdjacentHTML('afterend', status);
    else main.insertAdjacentHTML('afterbegin', status);
  }

  function refreshLiveWorkspace({ immediate = false } = {}) {
    if (!isLiveWorkspace()) {
      liveRefreshPending = false;
      clearLiveRefreshTimer();
      return;
    }
    if (document.visibilityState === 'hidden' || navigator.onLine === false) {
      liveRefreshPending = true;
      clearLiveRefreshTimer();
      return;
    }

    liveRefreshPending = false;
    clearLiveRefreshTimer();
    liveRefreshTimer = setTimeout(() => {
      liveRefreshTimer = null;
      if (document.visibilityState === 'hidden' || navigator.onLine === false) {
        liveRefreshPending = true;
        return;
      }
      if (activeTab === 'kitchen' && kitchenPaint) {
        kitchenPaint().catch(() => {});
      } else if (['dashboard', 'orders', 'reservations'].includes(activeTab) && tabs[activeTab]) {
        if (activeTab === 'dashboard' && window.westoDashboardPauseAutoRefresh) {
          return;
        }
        tabs[activeTab]().catch(() => {});
      }
    }, immediate ? 0 : 180);
  }

  function stopCommandCenterStream() {
    if (commandCenterStream) {
      commandCenterStream.close();
      commandCenterStream = null;
    }
    commandCenterStreamKey = '';
  }

  function startCommandCenterStream() {
    if (!window.EventSource || !hasCapability('ops.view')) {
      stopCommandCenterStream();
      return;
    }
    if (document.visibilityState === 'hidden' || navigator.onLine === false) {
      stopCommandCenterStream();
      liveRefreshPending = liveRefreshPending || isLiveWorkspace();
      return;
    }

    const streamKey = String(currentBranchId || 'all');
    if (commandCenterStream && commandCenterStreamKey === streamKey) return;

    stopCommandCenterStream();
    const stream = new EventSource(`/api/admin/events${branchQs()}`);
    commandCenterStream = stream;
    commandCenterStreamKey = streamKey;

    const onOperationalUpdate = () => {
      refreshLiveWorkspace();
    };
    ['order.created', 'order.updated', 'payment.updated', 'reservation.created', 'reservation.updated', 'delivery_zone.updated'].forEach((type) => {
      stream.addEventListener(type, onOperationalUpdate);
    });
    let streamHasOpened = false;
    stream.onopen = () => {
      if (commandCenterStream !== stream) return;
      setAdminKitchenStreamStatus(true);
      if (streamHasOpened) refreshLiveWorkspace({ immediate: true });
      streamHasOpened = true;
    };
    stream.onerror = () => {
      if (commandCenterStream !== stream) return;
      setAdminKitchenStreamStatus(false);
    };
  }

  function pauseLiveWorkspace() {
    if (isLiveWorkspace()) liveRefreshPending = true;
    clearLiveRefreshTimer();
    stopCommandCenterStream();
  }

  function resumeLiveWorkspace({ forceRefresh = false } = {}) {
    startCommandCenterStream();
    if (forceRefresh || liveRefreshPending) refreshLiveWorkspace({ immediate: true });
  }

  function readThemeForm() {
    return {
      accent: document.getElementById('th_accent')?.value,
      accentInk: document.getElementById('th_accentInk')?.value,
      surface: document.getElementById('th_surface')?.value,
      bg: document.getElementById('th_bg')?.value,
      fog: document.getElementById('th_fog')?.value,
      printPaper: document.getElementById('th_printPaper')?.value,
      printInk: document.getElementById('th_printInk')?.value,
      printAccent: document.getElementById('th_printAccent')?.value,
      radius: parseInputNumber(document.getElementById('th_radius')?.value) || 14,
      fontDisplay: document.getElementById('th_font')?.value || 'Vazirmatn',
    };
  }

  function showToast(text, type = 'info', timeout = 2800) {
    if (!toast) return;
    toast.textContent = typeof text === 'string' ? text : errorText(text, 'خطای نامشخص');
    toast.classList.remove('is-error', 'is-success', 'is-info');
    toast.classList.add('show', `is-${type}`);
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastTimer = null;
      toast.classList.remove('show', 'is-error', 'is-success', 'is-info');
    }, Math.max(1200, Number(timeout) || 2800));
  }

  function setNetworkBusy(delta) {
    networkInFlight = Math.max(0, networkInFlight + delta);
    document.body.classList.toggle('admin-network-busy', networkInFlight > 0);
    if (main) main.setAttribute('aria-busy', networkInFlight > 0 ? 'true' : 'false');
  }

  function errorText(value, fallback = '') {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      const messages = value.map((item) => errorText(item, '')).filter(Boolean);
      return messages.join('، ') || fallback;
    }
    if (value && typeof value === 'object') {
      const candidate = value.message || value.detail || value.error || value.code;
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
      if (Array.isArray(value.details)) {
        const messages = value.details.map((item) => errorText(item, '')).filter(Boolean);
        if (messages.length) return messages.join('، ');
      }
    }
    return fallback;
  }

  function friendlyHttpError(status, payload = {}) {
    if (status === 403) return 'برای انجام این کار دسترسی کافی ندارید.';
    if (status === 404) return 'اطلاعات موردنظر پیدا نشد.';
    if (status === 409) return errorText(payload.error, payload.message || 'این تغییر با وضعیت فعلی سازگار نیست. صفحه را تازه کنید.');
    if (status === 413) return 'حجم اطلاعات ارسالی بیشتر از حد مجاز است.';
    if (status === 429) return 'تعداد درخواست‌ها زیاد است؛ چند لحظه دیگر دوباره تلاش کنید.';
    if (status >= 500) return 'سرور موقتاً پاسخ‌گو نیست؛ تغییرات شما ارسال نشد.';
    return errorText(payload.error, payload.message || 'خطا در ارتباط با سرور');
  }

  async function api(url, opts = {}) {
    const method = String(opts.method || 'GET').toUpperCase();
    const controller = new AbortController();
    const timeoutMs = Math.max(5000, Number(opts.timeoutMs) || 20000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = new Headers(opts.headers || {});
    headers.set('Accept', 'application/json');
    if (opts.body && !(opts.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    setNetworkBusy(1);
    try {
      const r = await fetch(url, {
        ...opts,
        method,
        headers,
        credentials: 'same-origin',
        signal: opts.signal || controller.signal,
      });
      if (r.status === 401) {
        location.href = '/login';
        throw new Error('نشست شما منقضی شده است.');
      }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const requestId = String(d.requestId || r.headers.get('X-Request-Id') || '').trim();
        const error = new Error(friendlyHttpError(r.status, d));
        if (requestId) error.requestId = requestId;
        throw error;
      }
      if (method !== 'GET') {
        window.WestoAdminModules?.emit('admin:mutation', { method, url: String(url), response: d });
      }
      return d;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('پاسخ سرور طول کشید. اتصال را بررسی و دوباره تلاش کنید.');
      throw error;
    } finally {
      clearTimeout(timer);
      setNetworkBusy(-1);
    }
  }

  function renderWorkspaceError(error, retryTab = activeTab) {
    const message = String(error?.message || 'خطا در ارتباط با سرور');
    const requestId = String(error?.requestId || '').trim();
    main.innerHTML = `<section class="section-box ops-error-state" role="alert">
      <p class="eyebrow">نیاز به بررسی</p>
      <h1>فضای کاری بارگذاری نشد</h1>
      <p class="lead">${esc(message)}</p>
      <p class="hint">اگر همین حالا کد را به‌روزرسانی کرده‌اید، یک‌بار سرویس محلی را راه‌اندازی مجدد کنید؛ سپس دوباره تلاش کنید.</p>
      ${requestId ? `<p class="hint admin-request-id">کد پیگیری: <code>${esc(requestId)}</code></p>` : ''}
      <div class="row-actions"><button type="button" class="btn" data-retry-workspace>تلاش دوباره</button></div>
    </section>`;
    main.querySelector('[data-retry-workspace]')?.addEventListener('click', () => {
      tabs[retryTab]?.().catch((nextError) => renderWorkspaceError(nextError, retryTab));
    });
  }

  async function loadState() {
    const d = await api('/api/content');
    state.content = d.content;
    state.products = d.products;
    state.menuItems = d.menuItems || [];
    state.faq = Array.isArray(d.faq) ? d.faq : [];
  }

  const adminImgSrc = (img) => {
    if (!img) return '';
    if (/^https?:\/\//i.test(img)) return img;
    return `/${String(img).replace(/^\//, '')}`;
  };

  const hasValidCover = (c) => {
    const cover = String(c?.coverImg || '').trim();
    return Boolean(cover) && !/assets\/textures\/westo_texture_/i.test(cover);
  };

  const itemCountsByCat = (items) => {
    const map = Object.create(null);
    (items || []).forEach((m) => {
      if (!m || m.available === false) return;
      const id = Number(m.categoryId);
      map[id] = (map[id] || 0) + 1;
    });
    return map;
  };

  const itemTotalByCat = (items) => {
    const map = Object.create(null);
    (items || []).forEach((m) => {
      if (!m) return;
      const id = Number(m.categoryId);
      map[id] = (map[id] || 0) + 1;
    });
    return map;
  };

  const isOnCarousel = (c, n) => !c.hiddenOnSite && hasValidCover(c);

  const siteStatusPill = (c, n) => {
    if (c.hiddenOnSite) return '<span class="pill blocked">مخفی</span>';
    if (!hasValidCover(c)) return '<span class="pill blocked">بدون تصویر شاخص</span>';
    if (!(n > 0)) return '<span class="pill ok">نمایش در صفحه اصلی</span><span class="hint"> · بدون غذا</span>';
    return '<span class="pill ok">نمایش در صفحه اصلی</span>';
  };

  let syncState = 'idle'; // idle | saving | error
  function setSyncStatus(next, detail = '') {
    syncState = next;
  }

  function debounce(fn, ms = 400) {
    let t = null;
    const wrapped = (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
    wrapped.cancel = () => clearTimeout(t);
    return wrapped;
  }

  function autosave(fn, { debounceMs = 400, silent = false } = {}) {
    const run = async () => {
      setSyncStatus('saving');
      try {
        await fn();
        const savedAt = new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
        setSyncStatus('idle', `ذخیره شد · ${savedAt}`);
        if (!silent) showToast('ذخیره شد', 'success');
      } catch (err) {
        setSyncStatus('error', err.message);
        showToast(err.message || 'خطا در ذخیره');
        throw err;
      }
    };
    return debounceMs > 0 ? debounce(run, debounceMs) : run;
  }

  function field(label, id, value, { textarea = false, ltr = false, type = 'text' } = {}) {
    const dir = ltr ? ' dir="ltr"' : '';
    const input = textarea
      ? `<textarea id="${id}" rows="3"${dir}>${esc(value)}</textarea>`
      : `<input id="${id}" type="${type}" value="${esc(value)}"${dir} />`;
    return `<div class="field"><label for="${id}">${esc(label)}</label>${input}</div>`;
  }

  function sparkBars(values, maxH = 48) {
    const max = Math.max(1, ...values);
    return `<div class="spark">${values
      .map((v, i) => {
        const h = Math.max(3, Math.round((v / max) * maxH));
        return `<span class="spark-bar" title="${i}: ${v}" style="height:${h}px"></span>`;
      })
      .join('')}</div>`;
  }

  function setActiveTab(name) {
    if (activeTab !== name) {
      clearLiveRefreshTimer();
      liveRefreshPending = false;
      // ── Cleanup Floor Studio module هنگام خروج از tab ──
      if (activeTab === 'tables' && _floorStudioInstance) {
        _floorStudioInstance.unmount();
        _floorStudioInstance = null;
      }
    }
    activeTab = name;
    const activeModule = window.WestoAdminModules?.forTab(name);
    document.documentElement.dataset.adminActiveModule = activeModule?.id || 'legacy';
    const tabParams = new URLSearchParams(location.search);
    if (name !== 'accounting') {
      ['financeWorkspace', 'financeOperation', 'financeFrom', 'financeTo'].forEach((key) => tabParams.delete(key));
    }
    const tabQuery = tabParams.toString();
    const tabUrl = `${location.pathname}${tabQuery ? `?${tabQuery}` : ''}#${name}`;
    if (`${location.pathname}${location.search}${location.hash}` !== tabUrl) history.replaceState(null, '', tabUrl);
    if (name !== 'kitchen') stopKitchenPoll();
    document.querySelectorAll('.admin-nav-item[data-tab]').forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    document.querySelector(`.admin-nav-item[data-tab="${name}"]`)?.closest('details')?.setAttribute('open', '');
    if (topbarTitle) topbarTitle.textContent = TAB_TITLES[name] || name;
    if (topbarContext) topbarContext.textContent = TAB_DESCRIPTIONS[name] || 'مرکز فرمان وستو';
    document.title = `${TAB_TITLES[name] || name} — مرکز فرمان وستو`;
    if (syncState !== 'saving' && syncState !== 'error') {
      setSyncStatus('idle', new Date().toLocaleString('fa-IR'));
    }
    document.body.classList.remove('sidebar-open');
  }

  function openNeemView(view) {
    window.open(`/ops/${encodeURIComponent(view)}`, '_blank', 'noopener');
  }

  /** Bind input/change → debounced autosave; checkboxes/selects save immediately. */
  function bindAutosave(root, saveFn, { debounceMs = 400, silent = true } = {}) {
    if (!root) return;
    const run = autosave(saveFn, { debounceMs, silent });
    const runNow = autosave(saveFn, { debounceMs: 0, silent });
    root.querySelectorAll('input, textarea, select').forEach((el) => {
      if (el.type === 'file' || el.type === 'button' || el.type === 'submit') return;
      if (el.dataset.prefField) return; // The dynamic preference editor owns its own delegated save.
      if (el.type === 'checkbox' || el.type === 'radio' || el.tagName === 'SELECT') {
        el.addEventListener('change', () => runNow());
      } else {
        el.addEventListener('input', () => run());
        el.addEventListener('change', () => run());
      }
    });
  }


  function enhanceWorkspace() {
    if (!main) return;
    main.querySelectorAll('[data-quick-tab], [data-kpi-jump]').forEach((control) => {
      if (!canOpenModuleTab(control.dataset.quickTab || control.dataset.kpiJump)) control.hidden = true;
    });
    main.querySelectorAll('a[href*="#accounting"], a[href*="#finance"]').forEach((link) => {
      if (!canOpenModuleTab('accounting')) link.hidden = true;
    });
    main.querySelectorAll('table.tbl').forEach((table) => {
      table.querySelectorAll('thead th').forEach((th) => th.setAttribute('scope', 'col'));
      if (!table.parentElement?.classList.contains('table-scroll')) {
        const wrap = document.createElement('div');
        wrap.className = 'table-scroll';
        wrap.setAttribute('role', 'region');
        wrap.setAttribute('aria-label', 'جدول قابل پیمایش');
        table.parentNode.insertBefore(wrap, table);
        wrap.appendChild(table);
      }
    });
    main.querySelectorAll('input, textarea, select').forEach((el) => {
      if (!el.getAttribute('autocomplete') && el.type !== 'file') el.setAttribute('autocomplete', 'off');
      if (el.type === 'number') el.setAttribute('inputmode', 'decimal');
      if (/phone|tel/i.test(el.id || '')) { el.setAttribute('inputmode', 'tel'); el.setAttribute('autocomplete', 'tel'); }
      if (/url|web|instagram|ig_/i.test(el.id || '')) { el.setAttribute('inputmode', 'url'); el.setAttribute('autocomplete', 'url'); }
    });
  }

  function scheduleWorkspaceEnhance() {
    if (workspaceEnhanceTimer) cancelAnimationFrame(workspaceEnhanceTimer);
    workspaceEnhanceTimer = requestAnimationFrame(() => { workspaceEnhanceTimer = null; enhanceWorkspace(); });
  }

  function dashboardBreakEvenStatus(dashboard) {
    const status = String(dashboard?.status || 'insufficient_data');
    if (status === 'available') return { tone: 'success', label: 'محاسبهٔ رسمی آماده', detail: 'فروش و بهای تمام‌شده از یک منبع هم‌مبنا محاسبه شده‌اند.' };
    if (status === 'load_error') return { tone: 'danger', label: 'دریافت دادهٔ مالی ناموفق بود', detail: dashboard?.message || 'خطای دریافت پنهان نشده است؛ کارتابل حسابداری را بررسی کنید.' };
    if (status === 'needs_plan') return { tone: 'warning', label: 'نیازمند تأیید برنامه', detail: 'هزینه‌های پایه و ددلاین هنوز به‌عنوان برنامهٔ واقعی ذخیره نشده‌اند.' };
    if (status === 'needs_branch') return { tone: 'warning', label: 'شعبه مشخص نیست', detail: 'محاسبه بدون انتخاب شعبه انجام نمی‌شود.' };
    return { tone: 'danger', label: 'دادهٔ مالی ناکافی', detail: 'تا تکمیل فروش خالص و بهای مواد، خط عبور یا سود تخمین زده نمی‌شود.' };
  }

  function dashboardBreakEvenChartData(dashboard) {
    return {
      ...(dashboard?.chart || { status: 'insufficient_data', title: 'نقطهٔ سربه‌سر و مسیر سوددهی' }),
      dashboardStatus: dashboard?.status || 'insufficient_data',
      message: dashboard?.message || '',
      reason: dashboard?.projection?.reason || '',
      missing: Array.isArray(dashboard?.projection?.missing) ? dashboard.projection.missing : [],
      dataSources: dashboard?.dataSources || null,
    };
  }

  function renderOperationalSalesTrend(stats) {
    const rows = Array.isArray(stats?.dailySales30d)
      ? stats.dailySales30d.filter((row) => row && row.date).slice(-14)
      : [];
    if (!rows.length) {
      return '<div class="vital-break-even__ops-empty">روند عملیاتی سفارش‌ها در دسترس نیست؛ این کمبود با دادهٔ مالی جایگزین نمی‌شود.</div>';
    }
    const maximum = Math.max(1, ...rows.map((row) => Number(row.sales || 0)));
    const total = rows.reduce((sum, row) => sum + Number(row.sales || 0), 0);
    const orders = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
    return `
      <div class="vital-break-even__ops-summary"><strong>${fmtMoney(total)}</strong><span>${fmtNum(orders)} سفارش در ۱۴ روز اخیر</span></div>
      <ol class="vital-break-even__ops-bars" aria-label="فروش عملیاتی روزانهٔ سفارش‌های لغونشده در چهارده روز اخیر">
        ${rows.map((row) => {
          const date = new Date(`${row.date}T12:00:00`);
          const label = Number.isNaN(date.getTime()) ? String(row.date) : new Intl.DateTimeFormat('fa-IR-u-ca-persian', { month: 'short', day: 'numeric' }).format(date);
          const percent = Math.max(Number(row.sales || 0) > 0 ? 4 : 0, Math.round((Number(row.sales || 0) / maximum) * 100));
          return `<li style="--ops-bar:${percent}%" title="${esc(label)} · ${fmtMoney(Number(row.sales || 0))} · ${fmtNum(Number(row.count || 0))} سفارش"><i aria-hidden="true"></i><span class="sr-only">${esc(label)}: ${fmtMoney(Number(row.sales || 0))} از ${fmtNum(Number(row.count || 0))} سفارش</span></li>`;
        }).join('')}
      </ol>`;
  }

  function renderDashboardBreakEvenShell(dashboard, stats, financeData, canViewFinance) {
    if (!canOpenModuleTab('accounting')) return '';
    const status = dashboardBreakEvenStatus(dashboard);
    const candidates = Array.isArray(dashboard?.dataSources?.candidates) ? dashboard.dataSources.candidates : [];
    const selectedSource = dashboard?.dataSources?.selected || null;
    const selectedSummary = candidates.find((row) => row?.source?.type === selectedSource?.type) || null;
    const planReady = Boolean(dashboard?.plan?.deadline?.isConfirmed);
    const sourceReady = Boolean(selectedSummary?.usable);
    const uncapturedOrders = Number(financeData?.metrics?.uncapturedOrders || 0);
    const uncapturedCogs = Number(financeData?.metrics?.uncapturedCogs || 0);
    const branchId = currentBranchId || 1;
    const planHref = financeWorkspaceHref('costing');
    const salesHref = financeWorkspaceHref('sales_bank');
    return `
      <section class="section-box vital-break-even-panel" aria-labelledby="dashboard-break-even-title">
        <header class="vital-break-even__head">
          <div><p class="eyebrow">تحلیل مالی قابل‌ردیابی</p><h2 id="dashboard-break-even-title">نقطهٔ سربه‌سر و مسیر سوددهی</h2><p>این بخش فقط خروجی موتور Finance V2 را نمایش می‌دهد؛ فروش عملیاتی سفارش‌ها پایین‌تر و کاملاً جدا گزارش می‌شود.</p></div>
          <span class="vital-break-even__status is-${status.tone}"><b>${esc(status.label)}</b><small>${esc(status.detail)}</small></span>
        </header>
        <div class="vital-break-even__source" role="note">
          <span>منبع محاسبه</span>
          <strong>${esc(selectedSource?.label || 'هنوز منبع هم‌مبنا آماده نیست')}</strong>
          <em>${selectedSource?.official ? 'قطعی · دفتر مالی' : selectedSource ? 'عملیاتی · نیازمند پوشش کامل' : 'محاسبه متوقف است'}${selectedSummary ? ` · ${fmtNum(selectedSummary.rowCount || 0)} ردیف` : ''}</em>
        </div>
        <div id="dashboard-break-even-chart" class="vital-break-even__chart" aria-live="polite"></div>
        ${canViewFinance ? `<div class="vital-break-even__actions" aria-label="اقدام‌های لازم برای آماده‌سازی تحلیل سودآوری">
          <a class="${planReady ? 'is-success' : 'is-warning'}" href="${planHref}"><span>۱</span><b>برنامه و ددلاین</b><small>${planReady ? 'تأیید و ذخیره شده' : 'مبالغ و ددلاین را بازبینی و تأیید کنید'}</small><strong>رفتن به برنامه مالی ←</strong></a>
          <a class="${sourceReady && !uncapturedOrders ? 'is-success' : 'is-warning'}" href="${salesHref}"><span>۲</span><b>فروش و رویداد مالی</b><small>${uncapturedOrders ? `${fmtNum(uncapturedOrders)} سفارش پرداخت‌شده جاافتاده` : sourceReady ? 'منبع فروش و هزینه هم‌مبناست' : 'فروش خالص و بهای همان فروش ناقص است'}</small><strong>بررسی فروش‌ها ←</strong></a>
          <a class="${sourceReady && !uncapturedCogs ? 'is-success' : 'is-warning'}" href="/admin/kitchen?view=inventory&branchId=${encodeURIComponent(branchId)}"><span>۳</span><b>دستور تهیه و بهای مواد</b><small>${uncapturedCogs ? `${fmtNum(uncapturedCogs)} فروش بدون رویداد بهای تمام‌شده` : sourceReady ? 'پوشش هزینه متغیر قابل محاسبه است' : 'دستور تهیه و قیمت مواد را کامل کنید'}</small><strong>رفتن به انبار و دستور تهیه ←</strong></a>
        </div>` : '<p class="vital-break-even__permission">برای دیدن جزئیات منبع و اقدام‌های مالی، دسترسی مشاهدهٔ حسابداری لازم است.</p>'}
        <details class="vital-break-even__ops">
          <summary><span><b>روند عملیاتی سفارش‌ها</b><small>غیررسمی؛ شامل سفارش‌های لغونشده و مناسب پایش عملیات، نه دفتر مالی</small></span><strong>نمایش</strong></summary>
          <div>${renderOperationalSalesTrend(stats)}</div>
        </details>
      </section>`;
  }

  function mountDashboardBreakEven(dashboard) {
    const host = main.querySelector('#dashboard-break-even-chart');
    if (!host) return;
    if (!window.WestoBreakEvenChart?.mount) {
      host.innerHTML = '<div class="vital-break-even__load-error" role="alert">نمایش نمودار مالی بارگذاری نشد؛ اطلاعات ساختگی جایگزین نشده است.</div>';
      return;
    }
    try {
      window.WestoBreakEvenChart.mount(host, dashboardBreakEvenChartData(dashboard), { currency: 'تومان', className: 'is-dashboard' });
    } catch (_) {
      host.innerHTML = '<div class="vital-break-even__load-error" role="alert">نمودار قابل نمایش نیست؛ دادهٔ رسمی را در کارتابل حسابداری بررسی کنید.</div>';
    }
  }

  // Legacy renderer kept only for rollback compatibility. The dashboard no longer calls it.
  function renderLegacyLineChart9Card(beDashboard, salesToday = 0, stats = null) {
    // Dynamic cost extraction from accounting system and break-even engine
    const dynamicAssumptions = Array.isArray(stats?.costStructure?.assumptions) && stats.costStructure.assumptions.length
      ? stats.costStructure.assumptions
      : Array.isArray(beDashboard?.plan?.assumptions) && beDashboard.plan.assumptions.length
        ? beDashboard.plan.assumptions
        : Array.isArray(beDashboard?.suggestedPlan?.assumptions) && beDashboard.suggestedPlan.assumptions.length
          ? beDashboard.suggestedPlan.assumptions
          : [];

    const totalFixedCostsToman = Number(stats?.costStructure?.totalFixedCostsToman)
      || dynamicAssumptions.reduce((sum, a) => sum + Number(a.amountToman || (a.amountIrr ? a.amountIrr / 10 : 0)), 0)
      || 1_280_000_000;

    const targetBreakEvenToman = totalFixedCostsToman;
    const targetMillion = Math.max(1, Math.round(targetBreakEvenToman / 1_000_000));

    // Extract Real Daily Sales from stats or genuine calendar day aggregation
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const dailyItems = Array.isArray(stats?.dailySales30d) && stats.dailySales30d.length === 30
      ? stats.dailySales30d
      : Array.from({ length: 30 }, (_, i) => {
          const dateStr = new Date(now - (29 - i) * dayMs).toISOString().slice(0, 10);
          const isToday = i === 29;
          return {
            date: dateStr,
            sales: isToday ? Number(salesToday || 0) : 0,
            count: isToday && salesToday > 0 ? 1 : 0,
          };
        });

    const daysCount = dailyItems.length;
    const points = [];
    let runningCumSalesToman = 0;
    let maxDailyToman = 0;
    let peakDayInfo = null;

    for (let i = 0; i < dailyItems.length; i++) {
      const item = dailyItems[i];
      const dayNum = i + 1;
      const daySalesToman = Number(item.sales || 0);
      const dayOrdersCount = Number(item.count || 0);
      runningCumSalesToman += daySalesToman;

      if (daySalesToman > maxDailyToman) {
        maxDailyToman = daySalesToman;
        peakDayInfo = { day: dayNum, date: item.date, salesToman: daySalesToman, count: dayOrdersCount };
      }

      const dateObj = new Date(item.date);
      let shamsiLabel = '';
      if (window.ShamsiCore && typeof window.ShamsiCore.formatShamsiDateShort === 'function') {
        shamsiLabel = window.ShamsiCore.formatShamsiDateShort(dateObj);
      } else if (window.ShamsiCore && typeof window.ShamsiCore.formatShamsi === 'function') {
        shamsiLabel = window.ShamsiCore.formatShamsi(dateObj, 'D MMMM');
      } else {
        try {
          shamsiLabel = `${fmtNum(dateObj.getDate())} ${dateObj.toLocaleDateString('fa-IR', { month: 'short' })}`;
        } catch (e) {
          shamsiLabel = `روز ${fmtNum(dayNum)}`;
        }
      }

      const dailyMillion = daySalesToman / 1_000_000;
      const cumMillion = runningCumSalesToman / 1_000_000;
      const cumCostMillion = (dayNum / daysCount) * targetMillion;
      const profitOrLoss = cumMillion - cumCostMillion;

      points.push({
        day: dayNum,
        dateStr: item.date,
        dateLabel: shamsiLabel,
        dailyToman: daySalesToman,
        dailyMillion,
        orderCount: dayOrdersCount,
        cumSalesToman: runningCumSalesToman,
        salesMillion: cumMillion,
        fixedCostMillion: cumCostMillion,
        profitOrLoss,
        isActual: true,
        isPeak: false,
        isBreakEven: cumMillion >= targetMillion,
      });
    }

    if (peakDayInfo && peakDayInfo.salesToman > 0) {
      const peakPt = points.find((p) => p.day === peakDayInfo.day);
      if (peakPt) peakPt.isPeak = true;
    }

    const currentTotalSalesToman = runningCumSalesToman;
    const currentSalesMillion = currentTotalSalesToman / 1_000_000;
    const progressPercent = Math.min(100, Math.round((currentTotalSalesToman / targetBreakEvenToman) * 100));
    const gapToman = Math.max(0, targetBreakEvenToman - currentTotalSalesToman);

    const activeDaysCount = points.filter((p) => p.dailyToman > 0).length || 1;
    const avgDailySalesToman = runningCumSalesToman / activeDaysCount;
    const projectedDays = avgDailySalesToman > 0 ? Math.ceil(targetBreakEvenToman / avgDailySalesToman) : null;
    const crossedPoint = points.find((p) => p.isBreakEven);

    const deadlineHeadline = crossedPoint
      ? `✓ عبور از نقطه سر به سر در ${crossedPoint.dateLabel}`
      : projectedDays && projectedDays <= 30
        ? `🎯 پیش‌بینی عبور از نقطه سر به سر: روز ${fmtNum(projectedDays)} ماه`
        : `🎯 هدف نقطه سر به سر: عبور از ${fmtNum(targetMillion)} م.ت`;

    const w = 840;
    const h = 300;
    const padL = 65;
    const padR = 25;
    const padT = 30;
    const padB = 45;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const maxSalesVal = Math.max(targetMillion * 1.08, ...points.map((p) => p.salesMillion), 100);
    const maxDailyVal = Math.max(...points.map((p) => p.dailyMillion), 10) * 1.35;

    const svgPoints = points.map((p, i) => {
      const x = padL + (i / (points.length - 1)) * plotW;
      const y = padT + plotH - (p.salesMillion / maxSalesVal) * plotH;
      const barH = (p.dailyMillion / maxDailyVal) * (plotH * 0.42);
      const barY = padT + plotH - barH;
      return { ...p, x, y, barH, barY };
    });

    let pathD = `M ${svgPoints[0].x.toFixed(1)},${svgPoints[0].y.toFixed(1)}`;
    for (let i = 0; i < svgPoints.length - 1; i++) {
      const p0 = svgPoints[i === 0 ? i : i - 1];
      const p1 = svgPoints[i];
      const p2 = svgPoints[i + 1];
      const p3 = svgPoints[i + 2 < svgPoints.length ? i + 2 : i + 1];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      pathD += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }

    const areaD = `${pathD} L ${svgPoints[svgPoints.length - 1].x.toFixed(1)},${(padT + plotH).toFixed(1)} L ${svgPoints[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

    const beTargetY = padT + plotH - (targetMillion / maxSalesVal) * plotH;
    const beCrossingPt = svgPoints.find((p) => p.isBreakEven) || null;

    const ySteps = 4;
    const yGridLines = Array.from({ length: ySteps + 1 }, (_, i) => {
      const val = Math.round((maxSalesVal / ySteps) * i);
      const y = padT + plotH - (val / maxSalesVal) * plotH;
      return `<line class="line-chart-9-grid-line" x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="var(--lc9-grid-stroke)" stroke-dasharray="4 8" /><text class="line-chart-9-axis-text" x="${padL - 10}" y="${y + 4}" fill="var(--lc9-axis-text)" font-size="11" text-anchor="end">${fmtNum(val)} م</text>`;
    }).join('');

    const xStepIndices = [0, 6, 12, 18, 24, 29];
    const xLabels = xStepIndices.map((idx) => {
      const pt = svgPoints[idx];
      if (!pt) return '';
      return `<text class="line-chart-9-axis-text" x="${pt.x}" y="${h - 12}" fill="var(--lc9-axis-text)" font-size="11" text-anchor="middle">${pt.dateLabel}</text>`;
    }).join('');

    const barWidth = Math.max(7, Math.floor((plotW / points.length) * 0.65));
    const dailyBars = svgPoints.map((p) => {
      const isHigh = p.dailyToman > 15_000_000;
      const barFill = isHigh ? 'url(#highDailyBarGrad)' : 'url(#dailyBarGrad)';
      return `
        <rect
          x="${(p.x - barWidth / 2).toFixed(1)}"
          y="${p.barY.toFixed(1)}"
          width="${barWidth}"
          height="${Math.max(2, p.barH).toFixed(1)}"
          rx="3"
          fill="${barFill}"
          style="opacity: 0.85; transition: all 0.2s ease; cursor: pointer;"
        >
          <title>${p.dateLabel}: فروش روزانه ${fmtMoney(p.dailyToman)} (${fmtNum(p.orderCount)} سفارش) | تجمعی: ${fmtNum(Math.round(p.salesMillion))} م.ت</title>
        </rect>
      `;
    }).join('');

    // Dynamic cost breakdown chips from actual accounting ledger / break-even assumptions
    const costChips = dynamicAssumptions.length > 0
      ? dynamicAssumptions.map((cost) => {
          let icon = '💼';
          const name = String(cost.name || cost.categoryName || 'سرفصل هزینه');
          if (cost.categoryCode === 'rent' || name.includes('اجاره')) icon = '🏢';
          else if (cost.categoryCode === 'payroll' || name.includes('نیرو') || name.includes('حقوق') || name.includes('پرسنل')) icon = '👥';
          else if (cost.categoryCode === 'utilities' || name.includes('آب') || name.includes('برق') || name.includes('گاز') || name.includes('اشتراک')) icon = '⚡';
          else if (name.includes('تعمیر') || name.includes('نگهداری')) icon = '🔧';
          else if (name.includes('بسته') || name.includes('پک')) icon = '📦';
          else if (name.includes('تبلیغ') || name.includes('مارکتینگ')) icon = '📢';

          const amountToman = Number(cost.amountToman || (cost.amountIrr ? cost.amountIrr / 10 : 0));
          const label = cost.headcount
            ? `${name} (${fmtNum(cost.headcount)} نفر)`
            : name;

          return `
            <div class="line-chart-9-chip">
              <span class="line-chart-9-chip-title">${icon} ${esc(label)}</span>
              <strong class="line-chart-9-chip-value">${fmtNum(Math.round(amountToman / 1_000_000))} م.ت</strong>
            </div>
          `;
        }).join('')
      : `
        <div class="line-chart-9-chip">
          <span class="line-chart-9-chip-title">📊 مجموع هزینه‌های ثبت‌شده حسابداری</span>
          <strong class="line-chart-9-chip-value">${fmtNum(targetMillion)} م.ت</strong>
        </div>
      `;

    return `
      <section class="section-box line-charts-9-container">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:1.25rem; margin-bottom:1.5rem; border-bottom: 1px solid var(--lc9-border); padding-bottom: 1.25rem;">
          <div>
            <div style="display:flex; align-items:center; gap:0.5rem; color:#a855f7; font-size:0.8rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em;">
              <span style="font-size:1.1rem;">🎯</span>
              <span>تحلیل نقطه سر به سر و فراز و نشیب درآمدی</span>
            </div>
            <div style="display:flex; align-items:baseline; gap:0.85rem; margin-top:0.4rem;">
              <span style="font-size:2rem; font-weight:800; color:var(--lc9-text-main);">${fmtNum(targetMillion)} <small style="font-size:0.95rem; font-weight:400; color:var(--lc9-text-muted);">میلیون تومان ددلاین</small></span>
              <span style="display:inline-flex; align-items:center; gap:0.35rem; color:var(--lc9-crossing-stroke); font-weight:700; font-size:0.88rem; background:rgba(16,185,129,0.12); padding:0.25rem 0.65rem; border-radius:999px; border:1px solid rgba(16,185,129,0.3);">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>
                پیشرفت فروش: ${fmtNum(progressPercent)}٪
              </span>
            </div>
            <p style="font-size:0.8rem; color:var(--lc9-text-muted); margin-top:0.35rem; line-height:1.5;">
              هزینه‌های استخراج‌شده به صورت زنده از دفتر حسابداری (${fmtMoney(totalFixedCostsToman)}) جهت تعیین نقطه سر به سر و عبور به سوددهی خالص.
            </p>
          </div>

          <div style="display:flex; gap:0.75rem; flex-wrap:wrap;">
            ${costChips}
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; margin-bottom:0.75rem; font-size:0.8rem; color:var(--lc9-text-muted);">
          <div style="display:flex; align-items:center; gap:1.25rem; flex-wrap:wrap;">
            <span style="display:inline-flex; align-items:center; gap:0.4rem;">
              <i style="width:10px; height:10px; border-radius:50%; background:#a855f7; display:inline-block;"></i>
              فروش تجمعی ۳۰ روزه
            </span>
            <span style="display:inline-flex; align-items:center; gap:0.4rem;">
              <i style="width:10px; height:8px; border-radius:2px; background:#38bdf8; display:inline-block;"></i>
              فراز و نشیب فروش هر روز
            </span>
            <span style="display:inline-flex; align-items:center; gap:0.4rem;">
              <i style="width:14px; height:2px; background:var(--lc9-target-stroke); display:inline-block; border-top:1px dashed var(--lc9-target-stroke);"></i>
              خط سر به سر (${fmtNum(targetMillion)} م.ت)
            </span>
          </div>
          <div style="color:var(--lc9-crossing-stroke); font-weight:600;">
            ${deadlineHeadline}
          </div>
        </div>

        <div class="line-chart-9-canvas" data-chart-points="${esc(JSON.stringify(svgPoints.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, day: p.day, dateLabel: p.dateLabel, dailyToman: p.dailyToman, cumSalesToman: p.cumSalesToman, fixedCostMillion: p.fixedCostMillion, profitOrLoss: p.profitOrLoss, orderCount: p.orderCount }))))}">
          <div id="lc9Tooltip" class="line-chart-9-tooltip" style="opacity:0; display:none;"></div>
          <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:auto; display:block; min-height:260px;" preserveAspectRatio="none">
            <defs>
              <linearGradient id="breakEvenGradArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#a855f7" stop-opacity="0.28" />
                <stop offset="100%" stop-color="#a855f7" stop-opacity="0" />
              </linearGradient>
              <linearGradient id="dailyBarGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.85" />
                <stop offset="100%" stop-color="#0284c7" stop-opacity="0.25" />
              </linearGradient>
              <linearGradient id="highDailyBarGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.9" />
                <stop offset="100%" stop-color="#d97706" stop-opacity="0.3" />
              </linearGradient>
              <pattern id="gridPatternBE" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="10" cy="10" r="1" fill="var(--lc9-pattern-fill)" fill-opacity="0.35" />
              </pattern>
            </defs>
            <rect x="0" y="0" width="${w}" height="${h}" fill="url(#gridPatternBE)" />
            ${yGridLines}

            <!-- Daily Revenue Bars (فراز و نشیب روزانه) -->
            ${dailyBars}
            
            <!-- Horizontal Break-Even Target Line -->
            <line x1="${padL}" y1="${beTargetY}" x2="${w - padR}" y2="${beTargetY}" stroke="var(--lc9-target-stroke)" stroke-dasharray="6 6" stroke-width="2" />
            <text x="${w - padR - 5}" y="${beTargetY - 7}" fill="var(--lc9-target-stroke)" font-size="11" font-weight="700" text-anchor="end">خط نقطه سر به سر (${fmtNum(targetMillion)} م.ت)</text>

            <!-- Vertical Crossing Reference Line -->
            ${beCrossingPt ? `<line x1="${beCrossingPt.x}" y1="${padT}" x2="${beCrossingPt.x}" y2="${padT + plotH}" stroke="var(--lc9-crossing-stroke)" stroke-dasharray="4 4" stroke-width="1.5" />
            <text x="${beCrossingPt.x + 5}" y="${padT + 16}" fill="var(--lc9-crossing-stroke)" font-size="11" font-weight="700" text-anchor="start">عبور محاسبه‌شده از نقطهٔ سربه‌سر</text>` : ''}

            <!-- Area & Cumulative Line (Clean and continuous without cluttered static dots) -->
            <path d="${areaD}" fill="url(#breakEvenGradArea)" />
            <path d="${pathD}" fill="none" stroke="#a855f7" stroke-width="2.8" style="filter: drop-shadow(0 4px 12px rgba(168, 85, 247, 0.45));" />

            <!-- Dynamic Hover Vertical Cursor Line -->
            <line id="lc9CursorLine" class="chart-hover-cursor" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" stroke="var(--lc9-text-muted)" stroke-width="1.5" stroke-dasharray="3 3" style="opacity:0;" />

            <!-- Dynamic Hover Active Glowing Dot -->
            <circle id="lc9HoverDot" class="chart-hover-dot" cx="0" cy="0" r="6" fill="#a855f7" stroke="#ffffff" stroke-width="2.5" style="opacity:0; filter:drop-shadow(0 2px 8px rgba(168,85,247,0.8));" />
            
            ${xLabels}

            <!-- Transparent Interactive Overlay for mouse hover & touch -->
            <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent" style="cursor:crosshair;" onmousemove="window.lc9Hover(event, this)" onmouseleave="window.lc9Leave(this)" ontouchstart="window.lc9Hover(event.touches ? event.touches[0] : event, this)" ontouchmove="window.lc9Hover(event.touches ? event.touches[0] : event, this)" ontouchend="window.lc9Leave(this)" />
          </svg>
        </div>
      </section>
    `;
  }

  // Global hover interaction handlers for the Break-Even chart
  window.lc9Hover = function(e, el) {
    const canvas = el.closest('.line-chart-9-canvas');
    if (!canvas) return;
    const pointsData = canvas.dataset.chartPoints;
    if (!pointsData) return;
    let points = [];
    try { points = JSON.parse(pointsData); } catch (_) { return; }
    if (!points.length) return;

    const svg = canvas.querySelector('svg');
    const rect = svg.getBoundingClientRect();
    const mouseSvgX = ((e.clientX - rect.left) / rect.width) * 840;

    let closest = points[0];
    let minDiff = Math.abs(closest.x - mouseSvgX);
    for (let i = 1; i < points.length; i++) {
      const diff = Math.abs(points[i].x - mouseSvgX);
      if (diff < minDiff) {
        minDiff = diff;
        closest = points[i];
      }
    }

    const cursorLine = svg.querySelector('#lc9CursorLine');
    const hoverDot = svg.querySelector('#lc9HoverDot');
    const tooltip = canvas.querySelector('#lc9Tooltip');

    if (cursorLine) {
      cursorLine.setAttribute('x1', closest.x);
      cursorLine.setAttribute('x2', closest.x);
      cursorLine.style.opacity = '0.9';
    }
    if (hoverDot) {
      hoverDot.setAttribute('cx', closest.x);
      hoverDot.setAttribute('cy', closest.y);
      hoverDot.style.opacity = '1';
    }

    if (tooltip) {
      const posX = (closest.x / 840) * canvas.clientWidth;
      const posY = (closest.y / 300) * canvas.clientHeight;

      // Smart boundary placement: if near top, flip below the point; if near edges, align horizontally
      let transX = '-50%';
      if (posX < 120) transX = '0%';
      else if (posX > canvas.clientWidth - 120) transX = '-100%';

      let transY = '-115%';
      if (posY < 140) {
        transY = '16px';
      }

      tooltip.style.transform = `translate(${transX}, ${transY})`;
      tooltip.style.left = `${posX}px`;
      tooltip.style.top = `${posY}px`;
      tooltip.style.display = 'block';
      tooltip.style.opacity = '1';

      const isProfit = closest.profitOrLoss >= 0;
      tooltip.innerHTML = `
        <div class="line-chart-9-tooltip__header">
          <span>📅 ${closest.dateLabel}</span>
          <span style="font-size:0.7rem; color:var(--lc9-crossing-stroke);">روز ${fmtNum(closest.day || '')}</span>
        </div>
        <div class="line-chart-9-tooltip__row">
          <span class="line-chart-9-tooltip__label">فروش روزانه:</span>
          <strong class="line-chart-9-tooltip__val" style="color:#38bdf8;">${fmtMoney(closest.dailyToman)} <small style="font-weight:normal; font-size:0.65rem; color:var(--lc9-text-muted);">(${fmtNum(closest.orderCount || 0)} سفارش)</small></strong>
        </div>
        <div class="line-chart-9-tooltip__row">
          <span class="line-chart-9-tooltip__label">فروش تجمعی:</span>
          <strong class="line-chart-9-tooltip__val" style="color:#c084fc;">${fmtMoney(closest.cumSalesToman)}</strong>
        </div>
        <div class="line-chart-9-tooltip__row">
          <span class="line-chart-9-tooltip__label">هزینه ثابت سرشکن:</span>
          <strong class="line-chart-9-tooltip__val" style="color:#fbbf24;">${fmtNum(Math.round(closest.fixedCostMillion))} م.ت</strong>
        </div>
        <div class="line-chart-9-tooltip__row" style="border-top:1px solid rgba(255,255,255,0.08); margin-top:0.3rem; padding-top:0.3rem;">
          <span class="line-chart-9-tooltip__label">وضعیت:</span>
          <strong class="line-chart-9-tooltip__val" style="color:${isProfit ? 'var(--lc9-crossing-stroke)' : '#f43f5e'};">
            ${isProfit ? '✓ در سود خالص' : 'در مسیر سر به سر'}
          </strong>
        </div>
      `;
    }
  };

  window.lc9Leave = function(el) {
    const canvas = el.closest('.line-chart-9-canvas');
    if (!canvas) return;
    const cursorLine = canvas.querySelector('#lc9CursorLine');
    const hoverDot = canvas.querySelector('#lc9HoverDot');
    const tooltip = canvas.querySelector('#lc9Tooltip');
    if (cursorLine) cursorLine.style.opacity = '0';
    if (hoverDot) hoverDot.style.opacity = '0';
    if (tooltip) {
      tooltip.style.opacity = '0';
      setTimeout(() => { if (tooltip.style.opacity === '0') tooltip.style.display = 'none'; }, 150);
    }
  };

  // Lazy bindings preserve shared shell state across module views.
  const moduleViewContext = {
    get DAY_LABELS() { return DAY_LABELS; },
    get TERMINAL_ORDER_STATUSES() { return TERMINAL_ORDER_STATUSES; },
    get _floorStudioInstance() { return _floorStudioInstance; },
    set _floorStudioInstance(value) { _floorStudioInstance = value; },
    get activeTab() { return activeTab; },
    get adminDeliveryAcceptanceIdempotencyKey() { return adminDeliveryAcceptanceIdempotencyKey; },
    get adminDeliveryAcceptanceView() { return adminDeliveryAcceptanceView; },
    get adminDeliveryNextStep() { return adminDeliveryNextStep; },
    get adminDeliveryRejectionConfirmed() { return adminDeliveryRejectionConfirmed; },
    get adminDeliveryRejectionIntent() { return adminDeliveryRejectionIntent; },
    get adminDeliveryRejectionPayload() { return adminDeliveryRejectionPayload; },
    get adminDeliveryRejectionValidationMessage() { return adminDeliveryRejectionValidationMessage; },
    get adminDeliveryStatusConfirmation() { return adminDeliveryStatusConfirmation; },
    get adminImgSrc() { return adminImgSrc; },
    get adminKdsIsHeldLine() { return adminKdsIsHeldLine; },
    get adminKitchenActionApplied() { return adminKitchenActionApplied; },
    get adminKitchenActionErrorMessage() { return adminKitchenActionErrorMessage; },
    get adminKitchenActionPayload() { return adminKitchenActionPayload; },
    get adminKitchenAmendmentLabel() { return adminKitchenAmendmentLabel; },
    get adminKitchenCompletionAction() { return adminKitchenCompletionAction; },
    get adminKitchenLineAction() { return adminKitchenLineAction; },
    get adminKitchenPaymentGuard() { return adminKitchenPaymentGuard; },
    get adminKitchenTicketProgress() { return adminKitchenTicketProgress; },
    get adminOrderStatusLabel() { return adminOrderStatusLabel; },
    get adminRestoreDeliveryStatusSelection() { return adminRestoreDeliveryStatusSelection; },
    get api() { return api; },
    get applyTheme() { return applyTheme; },
    get autosave() { return autosave; },
    get beepNewOrder() { return beepNewOrder; },
    get bindAutosave() { return bindAutosave; },
    get branchQs() { return branchQs; },
    get branchesCache() { return branchesCache; },
    get canOpenModuleTab() { return canOpenModuleTab; },
    get clearAdminDeliveryAcceptanceIdempotencyKey() { return clearAdminDeliveryAcceptanceIdempotencyKey; },
    get clearAdminDeliveryRejectionIntent() { return clearAdminDeliveryRejectionIntent; },
    get colorField() { return colorField; },
    get crmAllBranchesScope() { return crmAllBranchesScope; },
    set crmAllBranchesScope(value) { crmAllBranchesScope = value; },
    get currentBranch() { return currentBranch; },
    get currentBranchId() { return currentBranchId; },
    set currentBranchId(value) { currentBranchId = value; },
    get currentUser() { return currentUser; },
    get debounce() { return debounce; },
    get esc() { return esc; },
    get field() { return field; },
    get financeWorkspaceHref() { return financeWorkspaceHref; },
    get fmtAge() { return fmtAge; },
    get fmtDateTime() { return fmtDateTime; },
    get fmtMoney() { return fmtMoney; },
    get fmtNum() { return fmtNum; },
    get fulfillmentLabel() { return fulfillmentLabel; },
    get hasCapability() { return hasModuleCapability; },
    get hasValidCover() { return hasValidCover; },
    get isOnCarousel() { return isOnCarousel; },
    get itemCountsByCat() { return itemCountsByCat; },
    get itemTotalByCat() { return itemTotalByCat; },
    get kitchenPaint() { return kitchenPaint; },
    set kitchenPaint(value) { kitchenPaint = value; },
    get kitchenSeenIds() { return kitchenSeenIds; },
    set kitchenSeenIds(value) { kitchenSeenIds = value; },
    get loadBranches() { return loadBranches; },
    get main() { return main; },
    get mountDashboardBreakEven() { return mountDashboardBreakEven; },
    get nextStatusesForOrder() { return nextStatusesForOrder; },
    get orderAgeMinutes() { return orderAgeMinutes; },
    get orderKitchenAdminTickets() { return orderKitchenAdminTickets; },
    get orderUrgency() { return orderUrgency; },
    get paintBranchSelect() { return paintBranchSelect; },
    get parseInputNumber() { return parseInputNumber; },
    get paymentModeLabel() { return paymentModeLabel; },
    get paymentProviderLabel() { return paymentProviderLabel; },
    get primaryActionLabel() { return primaryActionLabel; },
    get primaryNextStatus() { return primaryNextStatus; },
    get readThemeForm() { return readThemeForm; },
    get renderDashboardBreakEvenShell() { return renderDashboardBreakEvenShell; },
    get runBusy() { return runBusy; },
    get sendAdminKitchenAction() { return sendAdminKitchenAction; },
    get setActiveTab() { return setActiveTab; },
    get setSyncStatus() { return setSyncStatus; },
    get settleKitchenWorkspaceRequests() { return settleKitchenWorkspaceRequests; },
    get shouldRenderKitchenSnapshot() { return shouldRenderKitchenSnapshot; },
    get showToast() { return showToast; },
    get siteStatusPill() { return siteStatusPill; },
    get sparkBars() { return sparkBars; },
    get state() { return state; },
    get statusLabel() { return statusLabel; },
    get stopKitchenPoll() { return stopKitchenPoll; },
    get tabs() { return tabs; },
    get wireColorPair() { return wireColorPair; },
  };

  // ---------- tabs ----------
  const tabs = {
    async dashboard(...args) {
      return window.WestoAdminModules.invokeView('platform_core', 'dashboard', moduleViewContext, this, args);
    },

    async printmenu(...args) {
      return window.WestoAdminModules.invokeView('menu_qr', 'printmenu', moduleViewContext, this, args);
    },

    async restaurant(...args) {
      return window.WestoAdminModules.invokeView('website_brand', 'restaurant', moduleViewContext, this, args);
    },

    async theme(...args) {
      return window.WestoAdminModules.invokeView('website_brand', 'theme', moduleViewContext, this, args);
    },

    async hours(...args) {
      return window.WestoAdminModules.invokeView('website_brand', 'hours', moduleViewContext, this, args);
    },

    async tables(...args) {
      return window.WestoAdminModules.invokeView('floor', 'tables', moduleViewContext, this, args);
    },

    async branches(...args) {
      return window.WestoAdminModules.invokeView('multi_branch', 'branches', moduleViewContext, this, args);
    },

    async complements(...args) {
      return window.WestoAdminModules.invokeView('menu_qr', 'complements', moduleViewContext, this, args);
    },

    async costControl(...args) {
      return window.WestoAdminModules.invokeView('inventory', 'costControl', moduleViewContext, this, args);
    },

    async inventory(...args) {
      return window.WestoAdminModules.invokeView('inventory', 'inventory', moduleViewContext, this, args);
    },

    async expenses(...args) {
      return window.WestoAdminModules.invokeView('accounting', 'expenses', moduleViewContext, this, args);
    },

    async prices(...args) {
      return window.WestoAdminModules.invokeView('menu_qr', 'prices', moduleViewContext, this, args);
    },

    async promotions(...args) {
      return window.WestoAdminModules.invokeView('pos', 'promotions', moduleViewContext, this, args);
    },

    async promoSlides(...args) {
      return window.WestoAdminModules.invokeView('website_brand', 'promoSlides', moduleViewContext, this, args);
    },

    async content(...args) {
      return window.WestoAdminModules.invokeView('website_brand', 'content', moduleViewContext, this, args);
    },

    async media(...args) {
      return window.WestoAdminModules.invokeView('website_brand', 'media', moduleViewContext, this, args);
    },

    async products(...args) {
      return window.WestoAdminModules.invokeView('menu_qr', 'products', moduleViewContext, this, args);
    },

    async menu(...args) {
      return window.WestoAdminModules.invokeView('menu_qr', 'menu', moduleViewContext, this, args);
    },

    async translate(...args) {
      return window.WestoAdminModules.invokeView('menu_qr', 'translate', moduleViewContext, this, args);
    },

    async kitchen(...args) {
      return window.WestoAdminModules.invokeView('kds', 'kitchen', moduleViewContext, this, args);
    },

    async reservations(...args) {
      return window.WestoAdminModules.invokeView('reservations', 'reservations', moduleViewContext, this, args);
    },

    async orders(...args) {
      return window.WestoAdminModules.invokeView('pos', 'orders', moduleViewContext, this, args);
    },

    async delivery(...args) {
      return window.WestoAdminModules.invokeView('delivery', 'delivery', moduleViewContext, this, args);
    },

    async faq(...args) {
      return window.WestoAdminModules.invokeView('website_brand', 'faq', moduleViewContext, this, args);
    },

    async users(...args) {
      return window.WestoAdminModules.invokeView('platform_core', 'users', moduleViewContext, this, args);
    },

    async club(...args) {
      return window.WestoAdminModules.invokeView('crm', 'club', moduleViewContext, this, args);
    },

    async wallet(...args) {
      return window.WestoAdminModules.invokeView('crm', 'wallet', moduleViewContext, this, args);
    },

    async campaigns(...args) {
      return window.WestoAdminModules.invokeView('crm', 'campaigns', moduleViewContext, this, args);
    },

    async sms(...args) {
      return window.WestoAdminModules.invokeView('crm', 'sms', moduleViewContext, this, args);
    },

    async loyalty(...args) {
      return window.WestoAdminModules.invokeView('crm', 'loyalty', moduleViewContext, this, args);
    },

    async finance(...args) {
      return window.WestoAdminModules.invokeView('accounting', 'finance', moduleViewContext, this, args);
    },

    async accounting(...args) {
      return window.WestoAdminModules.invokeView('accounting', 'accounting', moduleViewContext, this, args);
    },
    async neem(...args) {
      return window.WestoAdminModules.invokeView('platform_core', 'neem', moduleViewContext, this, args);
    },
    async salsa(...args) {
      return window.WestoAdminModules.invokeView('platform_core', 'salsa', moduleViewContext, this, args);
    },

    async feedback(...args) {
      return window.WestoAdminModules.invokeView('crm', 'feedback', moduleViewContext, this, args);
    },

    async newsletter(...args) {
      return window.WestoAdminModules.invokeView('crm', 'newsletter', moduleViewContext, this, args);
    },

    async settings(...args) {
      return window.WestoAdminModules.invokeView('platform_core', 'settings', moduleViewContext, this, args);
    },
  };

  function mountAdminModules() {
    // Guard every entry point, including old deep links and dashboard shortcuts.
    // Access gates never stop the server's background financial capture.
    for (const [tab, handler] of Object.entries(tabs)) {
      tabs[tab] = async (...args) => {
        if (!canOpenModuleTab(tab)) throw new Error('این قابلیت در اشتراک مجموعه فعال نیست.');
        return handler.apply(tabs, args);
      };
    }
    const registry = window.WestoAdminModules;
    if (!registry?.mount) return;
    const legacyTabs = { ...tabs };
    const context = {
      api,
      branchQs,
      currentBranch,
      esc,
      fmtMoney,
      fmtNum,
      fmtDateTime,
      financeWorkspaceHref,
      main,
      setActiveTab,
      showToast,
      sparkBars,
      state,
      currentUser: () => currentUser,
      hasCapability: hasModuleCapability,
      canOpenModuleTab,
      activeTab: () => activeTab,
      branchCount: () => branchesCache.length,
      legacyTabs,
    };
    const bindings = registry.mount(context, tabs);
    for (const [tab, handler] of Object.entries(tabs)) {
      tabs[tab] = async (...args) => {
        if (!canOpenModuleTab(tab)) throw new Error('این قابلیت در اشتراک مجموعه فعال نیست.');
        return handler.apply(tabs, args);
      };
    }
    document.documentElement.dataset.adminModules = registry.list().map((module) => module.id).join(',');
    document.documentElement.dataset.adminModuleBindings = Object.keys(bindings).join(',');
    document.documentElement.dataset.adminTabOwners = JSON.stringify(registry.tabOwners());
    document.querySelectorAll('.admin-nav-item[data-tab]').forEach((button) => {
      const module = registry.forTab(button.dataset.tab);
      if (module) button.dataset.adminModule = module.id;
    });
  }

  function initShell() {
    const closeSidebar = () => document.body.classList.remove('sidebar-open');
    document.getElementById('sidebar-toggle')?.addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
    document.getElementById('sidebar-close')?.addEventListener('click', closeSidebar);
    document.getElementById('sidebar-scrim')?.addEventListener('click', closeSidebar);
    document.getElementById('sidebar-minimize')?.addEventListener('click', () => {
      const minimized = document.body.classList.toggle('sidebar-minimized');
      const button = document.getElementById('sidebar-minimize');
      if (!button) return;
      button.setAttribute('aria-pressed', String(minimized));
      button.setAttribute('aria-label', minimized ? 'باز کردن منو' : 'جمع کردن منو');
      button.setAttribute('title', minimized ? 'باز کردن منو' : 'جمع کردن منو');
      button.textContent = minimized ? '›' : '‹';
    });
    const shortcutsModal = document.getElementById('admin-shortcuts-modal');
    const openShortcutsModal = () => {
      if (!shortcutsModal) return;
      if (typeof shortcutsModal.showModal === 'function') {
        try { shortcutsModal.showModal(); } catch (_) { shortcutsModal.setAttribute('open', ''); }
      } else {
        shortcutsModal.setAttribute('open', '');
      }
      shortcutsModal.querySelector('#admin-shortcuts-close')?.focus();
    };
    const closeShortcutsModal = () => {
      if (!shortcutsModal) return;
      if (typeof shortcutsModal.close === 'function') {
        try { shortcutsModal.close(); } catch (_) { shortcutsModal.removeAttribute('open'); }
      } else {
        shortcutsModal.removeAttribute('open');
      }
    };
    document.getElementById('admin-shortcuts-btn')?.addEventListener('click', openShortcutsModal);
    document.getElementById('admin-shortcuts-close')?.addEventListener('click', closeShortcutsModal);
    shortcutsModal?.addEventListener('click', (e) => {
      if (e.target === shortcutsModal) closeShortcutsModal();
    });

    let lastAdminGTime = 0;
    const switchToAdminTab = (tabName) => {
      const workspace = FINANCE_SHORTCUTS[tabName];
      if (workspace) {
        location.href = financeWorkspaceHref(workspace);
        return;
      }
      const navItem = document.querySelector(`.admin-nav-item[data-tab="${tabName}"]`);
      if (navItem && !navItem.hidden) {
        navItem.click();
      } else if (tabs[tabName]) {
        tabs[tabName]().catch((error) => showToast(error.message));
      }
    };

    document.addEventListener('keydown', (event) => {
      const target = event.target;
      const isInput = target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);

      if (event.key === 'Escape') {
        if (document.body.classList.contains('sidebar-open')) closeSidebar();
        if (shortcutsModal?.open || shortcutsModal?.hasAttribute('open')) closeShortcutsModal();
        document.querySelectorAll('dialog[open]').forEach((d) => {
          if (d !== shortcutsModal && typeof d.close === 'function') d.close();
        });
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (window.WestoDashboardView && typeof window.WestoDashboardView.openCommandPalette === 'function') {
          window.WestoDashboardView.openCommandPalette({ tabs, showToast });
        } else {
          switchToAdminTab('dashboard');
        }
        return;
      }

      if (isInput) return;

      if (event.key === '?' || (event.shiftKey && event.key === '/')) {
        event.preventDefault();
        openShortcutsModal();
        return;
      }

      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        const key = event.key.toLowerCase();
        const altMap = {
          '1': 'dashboard', 'd': 'dashboard',
          '2': 'orders',    'o': 'orders',
          '3': 'menu',      'm': 'menu',
          '4': 'tables',    't': 'tables',
          '5': 'inventory', 'i': 'inventory',
          '6': 'accounting','f': 'accounting',
          '7': 'club',      'c': 'club',
          '8': 'reservations', 'r': 'reservations',
          '9': 'kitchen',   'k': 'kitchen',
          '0': 'settings',  's': 'settings'
        };
        if (altMap[key]) {
          event.preventDefault();
          switchToAdminTab(altMap[key]);
          return;
        }
      }

      if (!event.altKey && !event.ctrlKey && !event.metaKey) {
        const now = Date.now();
        const key = event.key.toLowerCase();
        if (key === 'g') {
          lastAdminGTime = now;
          return;
        }
        if (lastAdminGTime && (now - lastAdminGTime < 1200)) {
          lastAdminGTime = 0;
          const gMap = {
            'd': 'dashboard',
            'o': 'orders',
            'm': 'menu',
            't': 'tables',
            'i': 'inventory',
            'f': 'accounting',
            'c': 'club',
            'r': 'reservations',
            'k': 'kitchen',
            's': 'settings'
          };
          if (gMap[key]) {
            event.preventDefault();
            switchToAdminTab(gMap[key]);
            return;
          }
        }
      }
    });

    window.WestoAdminShortcuts = {
      open: openShortcutsModal,
      close: closeShortcutsModal,
      switchToTab: switchToAdminTab
    };
    const workspaceObserver = new MutationObserver(scheduleWorkspaceEnhance);
    workspaceObserver.observe(main, { childList: true, subtree: true });
    scheduleWorkspaceEnhance();
    document.querySelectorAll('.admin-nav-item[data-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        const workspace = FINANCE_SHORTCUTS[button.dataset.tab];
        if (workspace) {
          location.href = financeWorkspaceHref(workspace);
          return;
        }
        tabs[button.dataset.tab]?.().catch((error) => showToast(error.message));
      });
    });
    document.querySelectorAll('.admin-nav-item[data-tab]').forEach((button) => {
      button.title = TAB_DESCRIPTIONS[button.dataset.tab] || button.textContent.trim();
    });
    document.querySelectorAll('.nav-workspace').forEach((group) => {
      group.addEventListener('toggle', () => {
        if (!group.open) return;
        document.querySelectorAll('.nav-workspace[open]').forEach((other) => { if (other !== group && !other.contains(document.querySelector('.admin-nav-item.active'))) other.open = false; });
      });
    });
    document.addEventListener('click', (event) => {
      const anchor = event.target.closest('a[href^="#"]');
      if (anchor) {
        const hash = anchor.getAttribute('href');
        if (hash && hash !== '#' && !hash.startsWith('#!')) {
          const target = document.querySelector(hash);
          if (target) {
            event.preventDefault();
            const details = target.closest('details');
            if (details) details.open = true;
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            const firstInput = target.querySelector?.('input:not([type="hidden"]), select, textarea, button');
            if (firstInput) firstInput.focus();
            else target.focus?.();
            return;
          } else if (hash.startsWith('#fin-')) {
            event.preventDefault();
            const details = document.querySelector('details.fin-details');
            if (details) {
              details.open = true;
              details.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            return;
          }
        }
      }

      const financeLink = event.target.closest('a[href*="financeWorkspace="]');
      if (financeLink) {
        const href = financeLink.getAttribute('href') || '';
        try {
          const url = new URL(href, location.origin);
          if (url.pathname === '/admin' || url.pathname === '/admin.html') {
            const workspace = url.searchParams.get('financeWorkspace');
            if (workspace && tabs.accounting) {
              event.preventDefault();
              history.pushState(null, '', `/admin${url.search}${url.hash || '#accounting'}`);
              tabs.accounting().catch((err) => showToast(err.message));
            }
          }
        } catch (_) {}
      }
    });
    const logout = async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      location.href = '/';
    };
    document.getElementById('logout-btn')?.addEventListener('click', logout);
    document.getElementById('admin-user-menu-logout')?.addEventListener('click', logout);
    const userMenu = document.getElementById('admin-user-menu');
    const userChip = document.getElementById('admin-user-chip');
    const userDropdown = document.getElementById('admin-user-dropdown');
    const closeUserMenu = ({ restoreFocus = false } = {}) => {
      if (!userMenu || !userChip || !userDropdown) return;
      userMenu.classList.remove('is-open');
      userChip.setAttribute('aria-expanded', 'false');
      userDropdown.hidden = true;
      if (restoreFocus) userChip.focus();
    };

    /* Notification Center (Review & Approvals Bell) */
    let notifItemsCache = [];
    let notifFilter = 'all';
    let notifPollTimer = null;

    const notifMenu = document.getElementById('admin-notif-menu');
    const notifBtn = document.getElementById('admin-notif-btn');
    const notifDropdown = document.getElementById('admin-notif-dropdown');
    const notifBadge = document.getElementById('admin-notif-badge');
    const notifList = document.getElementById('admin-notif-list');
    const notifRefreshBtn = document.getElementById('admin-notif-refresh');
    const notifSubtitle = document.getElementById('admin-notif-subtitle');
    const notifGotoDashBtn = document.getElementById('admin-notif-goto-dash');

    const closeNotifMenu = ({ restoreFocus = false } = {}) => {
      if (!notifMenu || !notifBtn || !notifDropdown) return;
      notifMenu.classList.remove('is-open');
      notifBtn.setAttribute('aria-expanded', 'false');
      notifDropdown.hidden = true;
      if (restoreFocus) notifBtn.focus();
    };

    const openNotifMenu = () => {
      if (!notifMenu || !notifBtn || !notifDropdown) return;
      closeUserMenu();
      notifMenu.classList.add('is-open');
      notifBtn.setAttribute('aria-expanded', 'true');
      notifDropdown.hidden = false;
      fetchNotifications({ silent: true });
      notifDropdown.querySelector('.admin-notif-tab.active')?.focus();
    };

    const renderNotifItems = () => {
      if (!notifList) return;
      const filtered = notifItemsCache.filter((item) => {
        if (notifFilter === 'approval') return item.category === 'approval';
        if (notifFilter === 'attention') return item.category === 'attention';
        return true;
      });

      if (!filtered.length) {
        notifList.innerHTML = `
          <div class="admin-notif-empty">
            <div class="admin-notif-empty-icon" aria-hidden="true">✓</div>
            <strong>همه امور بررسی شده‌اند</strong>
            <p>مورد معوقی در این دسته‌بندی برای بررسی وجود ندارد.</p>
          </div>
        `;
        return;
      }

      notifList.innerHTML = filtered.map((item) => {
        let badgeClass = 'admin-notif-badge--attention';
        let badgeText = 'بررسی فوری';
        if (item.category === 'approval') {
          badgeClass = 'admin-notif-badge--approval';
          badgeText = 'نیازمند تأیید';
        } else if (item.priority === 'urgent' || item.priority === 'critical') {
          badgeClass = 'admin-notif-badge--critical';
          badgeText = 'بحرانی';
        }

        const priorityCardClass = `admin-notif-card--${esc(item.priority || 'medium')}`;

        return `
          <article class="admin-notif-card ${priorityCardClass}" data-id="${esc(item.id)}">
            <div class="admin-notif-card__top">
              <h4 class="admin-notif-card__title">${esc(item.title)}</h4>
              <span class="admin-notif-card__badge ${badgeClass}">${badgeText}</span>
            </div>
            <p class="admin-notif-card__desc">${esc(item.description)}</p>
            <div class="admin-notif-card__bottom">
              <span class="admin-notif-card__time">${item.createdAt ? fmtDateTime(item.createdAt) : 'امروز'}</span>
              <button type="button" class="admin-notif-action-btn" data-notif-tab="${esc(item.tab || '')}" data-notif-workspace="${esc(item.workspace || '')}" data-notif-url="${esc(item.actionUrl || '')}">
                ${esc(item.actionLabel || 'بررسی و اقدام')} ↗
              </button>
            </div>
          </article>
        `;
      }).join('');
    };

    const updateNotifUI = (data) => {
      notifItemsCache = data.items || [];
      const total = notifItemsCache.length;
      const approvalsCount = notifItemsCache.filter((i) => i.category === 'approval').length;
      const attentionCount = notifItemsCache.filter((i) => i.category === 'attention').length;

      if (notifBadge) {
        notifBadge.textContent = fmtNum(total);
      }
      if (notifMenu) {
        notifMenu.classList.toggle('has-unread', total > 0);
      }

      const countAll = document.getElementById('notif-count-all');
      const countApproval = document.getElementById('notif-count-approval');
      const countAttention = document.getElementById('notif-count-attention');
      if (countAll) countAll.textContent = fmtNum(total);
      if (countApproval) countApproval.textContent = fmtNum(approvalsCount);
      if (countAttention) countAttention.textContent = fmtNum(attentionCount);

      if (notifSubtitle) {
        notifSubtitle.textContent = total > 0
          ? `${fmtNum(total)} مورد نیازمند بررسی و تأیید مدیر`
          : 'تمام فرآیندها به‌روز و بدون تأخیر هستند';
      }

      renderNotifItems();
    };

    const fetchNotifications = async ({ silent = false } = {}) => {
      try {
        const data = await api('/api/admin/notifications' + branchQs());
        updateNotifUI(data);
      } catch (err) {
        if (!silent) showToast(err.message || 'خطا در دریافت بررسی‌های مدیر', 'error');
      }
    };

    notifBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!notifDropdown || !notifBtn) return;
      const isOpen = notifMenu?.classList.contains('is-open') && !notifDropdown?.hidden;
      if (isOpen) {
        closeNotifMenu();
      } else {
        openNotifMenu();
      }
    });

    document.getElementById('admin-notif-close')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeNotifMenu({ restoreFocus: true });
    });

    notifRefreshBtn?.addEventListener('click', (event) => {
      event.stopPropagation();
      fetchNotifications();
    });

    notifGotoDashBtn?.addEventListener('click', () => {
      closeNotifMenu();
      const dashBtn = document.querySelector('.admin-nav-item[data-tab="dashboard"]');
      dashBtn?.click();
    });

    document.querySelectorAll('.admin-notif-tab').forEach((tabBtn) => {
      tabBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        document.querySelectorAll('.admin-notif-tab').forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        tabBtn.classList.add('active');
        tabBtn.setAttribute('aria-selected', 'true');
        notifFilter = tabBtn.dataset.filter || 'all';
        renderNotifItems();
      });
    });

    notifList?.addEventListener('click', (event) => {
      const btn = event.target.closest('.admin-notif-action-btn');
      if (!btn) return;
      event.preventDefault();
      event.stopPropagation();
      closeNotifMenu();

      const actionUrl = btn.dataset.notifUrl;
      const tabName = btn.dataset.notifTab;
      const workspace = btn.dataset.notifWorkspace;

      if (actionUrl) {
        location.href = actionUrl;
        return;
      }

      if (workspace && tabName === 'accounting') {
        const targetHref = financeWorkspaceHref(workspace);
        history.pushState(null, '', targetHref);
        tabs.accounting?.().catch((err) => showToast(err.message));
        return;
      }

      if (tabName) {
        const navItem = document.querySelector(`.admin-nav-item[data-tab="${tabName}"]`);
        if (navItem) {
          navItem.click();
        } else if (tabs[tabName]) {
          tabs[tabName]().catch((e) => showToast(e.message));
        }
      }
    });

    notifDropdown?.addEventListener('click', (event) => {
      if (event.target.closest('.admin-notif-action-btn, .admin-notif-close-btn, #admin-notif-goto-dash')) {
        return;
      }
      event.stopPropagation();
    });

    document.addEventListener('click', (event) => {
      if (notifMenu && !notifMenu.contains(event.target)) closeNotifMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && notifMenu?.classList.contains('is-open')) closeNotifMenu({ restoreFocus: true });
    });

    document.getElementById('branch-select')?.addEventListener('change', () => {
      fetchNotifications({ silent: true });
    });

    fetchNotifications({ silent: true });
    if (!notifPollTimer) {
      notifPollTimer = setInterval(() => {
        if (document.visibilityState !== 'hidden') fetchNotifications({ silent: true });
      }, 30000);
    }

    window.WestoAdminModules?.on?.('admin:mutation', () => {
      fetchNotifications({ silent: true });
    });

    window.WestoNotifications = {
      refresh: () => fetchNotifications(),
      open: () => openNotifMenu(),
      close: () => closeNotifMenu(),
    };

    userChip?.addEventListener('click', (event) => {
      if (!userDropdown || !userChip) return;
      event.stopPropagation();
      const open = userDropdown.hidden;
      if (open) closeNotifMenu();
      userDropdown.hidden = !open;
      userMenu?.classList.toggle('is-open', open);
      userChip.setAttribute('aria-expanded', String(open));
      if (open) userDropdown.querySelector('[role="menuitem"]')?.focus();
    });
    userDropdown?.addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('click', (event) => {
      if (userMenu && !userMenu.contains(event.target)) closeUserMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && userMenu?.classList.contains('is-open')) closeUserMenu({ restoreFocus: true });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') pauseLiveWorkspace();
      else resumeLiveWorkspace({ forceRefresh: true });
    });
    window.addEventListener('offline', () => { pauseLiveWorkspace(); showToast('اتصال اینترنت قطع است؛ اطلاعات زنده موقتاً متوقف شد.', 'error', 4200); });
    window.addEventListener('online', () => { showToast('اتصال برقرار شد؛ اطلاعات در حال همگام‌سازی است.', 'success'); resumeLiveWorkspace({ forceRefresh: true }); });
    window.addEventListener('pagehide', () => {
      pauseLiveWorkspace();
      if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
      }
    });
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) resumeLiveWorkspace({ forceRefresh: true });
    });
    window.addEventListener('beforeunload', stopCommandCenterStream, { once: true });
  }

  async function boot() {
    let session;
    try {
      session = await api('/api/admin/session');
      currentUser = session.user;
      moduleAccess = session.moduleAccess || null;
      currentUserRole = currentUser?.role || 'guest';
      if (['cashier', 'waiter', 'kitchen'].includes(currentUserRole)) {
        location.replace(`/admin/${currentUserRole}`);
        return;
      }
      if (!currentUser || (!hasCapability('command.view') && !hasCapability('kitchen.view'))) {
        location.href = '/profile';
        return;
      }
    } catch (error) {
      renderWorkspaceError(error, 'dashboard');
      return;
    }

    await loadBranches(session);
    if (branchSelectionError) {
      renderWorkspaceError(branchSelectionError, 'accounting');
      return;
    }
    try {
      await Promise.all([
        loadState(),
        api('/api/admin/theme')
          .then((th) => applyTheme(th.theme))
          .catch(() => {
            /* theme is optional while the command center starts */
          }),
      ]);
    } catch (error) {
      renderWorkspaceError(error, 'dashboard');
      return;
    }
    const brandLogo = document.getElementById('brand-logo');
    if (brandLogo) brandLogo.src = 'assets/images/brand/westo-fa-wordmark-dark.png?v=adminVitality2';
    applyRoleAccess();
    mountAdminModules();
    initShell();
    initRolePreview();
    window.addEventListener('westo:theme-change', () => {
      if (lastBrandTheme) applyTheme(lastBrandTheme);
    });
    startCommandCenterStream();
    const searchParams = new URLSearchParams(location.search);
    const requestedHash = String(location.hash || '').replace(/^#/, '');
    const legacyFinanceWorkspace = FINANCE_SHORTCUTS[requestedHash];
    const isFinanceHash = requestedHash === 'finance' || requestedHash === 'accounting' || requestedHash.startsWith('fin-') || Boolean(legacyFinanceWorkspace);
    const hasFinanceWorkspace = searchParams.has('financeWorkspace');

    if (legacyFinanceWorkspace) {
      searchParams.set('financeWorkspace', legacyFinanceWorkspace);
      searchParams.set('branchId', String(currentBranchId || 1));
      history.replaceState(null, '', `${location.pathname}?${searchParams.toString()}#accounting`);
    } else if (hasFinanceWorkspace && !requestedHash) {
      history.replaceState(null, '', `${location.pathname}?${searchParams.toString()}#accounting`);
    }

    const requestedTab = (isFinanceHash || (hasFinanceWorkspace && !requestedHash)) ? 'accounting' : requestedHash;
    const initialTab = (tabs[requestedTab] && hasCapability(TAB_CAPABILITIES[requestedTab]) && canOpenModuleTab(requestedTab)) ? requestedTab : 'dashboard';
    tabs[initialTab]().then(() => {
      if (requestedHash.startsWith('fin-')) {
        const el = document.getElementById(requestedHash);
        if (el) {
          const details = el.closest('details');
          if (details) details.open = true;
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          el.focus?.();
        }
      }
    }).catch((error) => {
      showToast(error.message);
      renderWorkspaceError(error, initialTab);
    });
  }

  boot();
})();
