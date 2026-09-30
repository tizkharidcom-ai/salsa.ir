/* WESTO role workspaces: cashier, waiter and kitchen/inventory operations. */
(() => {
  'use strict';

  const rawRole = String(location.pathname.split('/').filter(Boolean).pop() || '').toLowerCase();
  const role = (rawRole === 'pos' || rawRole === 'pos.html') ? 'cashier'
             : (rawRole === 'kds' || rawRole === 'kds.html' || rawRole === 'kitchen.html') ? 'kitchen'
             : (rawRole === 'waiter.html') ? 'waiter'
             : rawRole;
  const allowedRoles = new Set(['cashier', 'waiter', 'kitchen']);
  const main = document.getElementById('role-main');
  const nav = document.getElementById('role-nav');
  const toast = document.getElementById('role-toast');
  const dialog = document.getElementById('role-dialog');
  const dialogBody = document.getElementById('dialog-body');
  dialog?.addEventListener('close', () => dialog.classList.remove('wt-item-dialog'));
  const readLocal = (key, fallback) => {
    try { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); }
    catch { return fallback; }
  };
  const STAFF_THEME_STORAGE_KEY = 'westo_staff_theme';
  const supportsStaffTheme = role === 'cashier' || role === 'waiter';
  const systemColorPreference = window.matchMedia?.('(prefers-color-scheme: dark)') || null;
  const normalizeStaffThemePreference = (value) => ['dark', 'system'].includes(value) ? value : 'light';
  let staffThemePreference = supportsStaffTheme
    ? normalizeStaffThemePreference(readLocal(STAFF_THEME_STORAGE_KEY, 'light'))
    : 'light';
  function applyStaffTheme(preference = staffThemePreference, persist = false) {
    if (!supportsStaffTheme) return 'light';
    staffThemePreference = normalizeStaffThemePreference(preference);
    const theme = staffThemePreference === 'system'
      ? (systemColorPreference?.matches ? 'dark' : 'light')
      : staffThemePreference;
    document.documentElement.dataset.theme = theme;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = theme === 'dark' ? '#0d1114' : '#f4f6f7';
    if (persist) {
      try { localStorage.setItem(STAFF_THEME_STORAGE_KEY, JSON.stringify(staffThemePreference)); }
      catch { /* The in-memory selection still applies when storage is unavailable. */ }
    }
    return staffThemePreference;
  }
  function syncOpenStaffThemeControl(preference) {
    const normalized = normalizeStaffThemePreference(preference);
    document.querySelectorAll('input[name="role-user-theme"]').forEach((input) => {
      input.checked = input.value === normalized;
    });
    const hint = document.getElementById('role-user-theme-hint');
    if (hint) {
      const label = normalized === 'dark' ? 'تیره' : normalized === 'system' ? 'خودکار' : 'روشن';
      hint.textContent = `تم ${label} از پنل دیگر همگام شد.`;
    }
  }
  if (supportsStaffTheme) {
    applyStaffTheme(staffThemePreference);
    window.addEventListener('storage', (event) => {
      if (event.key !== STAFF_THEME_STORAGE_KEY) return;
      let preference = 'light';
      try { preference = event.newValue === null ? 'light' : JSON.parse(event.newValue); }
      catch { preference = 'light'; }
      syncOpenStaffThemeControl(applyStaffTheme(preference));
    });
    systemColorPreference?.addEventListener?.('change', () => {
      if (staffThemePreference === 'system') applyStaffTheme('system');
    });
  }
  const normalizeDigits = (val) => String(val ?? '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const state = {
    session: null, branchId: null, activeView: '', data: {}, menuItems: [], menuCategories: [], menuComplements: [], menuComplementRules: [],
    waiterBranchGeneration: 0, waiterSnapshotRequestId: 0, waiterMenuRequestId: 0, waiterRenderRequestId: 0,
    waiterUnmappedAssignmentIntents: new Map(),
    waiterTerminalOpenings: new Set(),
    waiterCallMutations: new Set(), waiterCallNeedsRefresh: new Set(), waiterRefreshPending: false,
    features: {},
    cart: new Map(), stream: null, posCategory: null, posCheck: null, posSearch: '', pendingPosItem: null,
    floorZone: 'all', floorCountdownTimer: null,
    waiterUnmappedOnly: false,
    // The kitchen display is intentionally one queue. The API still keeps the
    // original item station for costing/reporting, but operators should never
    // have to switch between hot, cold, bar or expo panels.
    kdsStation: 'kitchen', kdsFulfillment: 'all', kdsSearch: '', kdsPage: 0, kdsSelectedTicketId: null, kdsOrderEntry: '', kdsOrderEntryTimer: null, kdsNumLock: null,
      kdsSettings: readLocal('westo_kds_settings', { layout: 'tile', columns: 6, textSize: 'normal', warnMinutes: 8, lateMinutes: 15, sound: true }),
    kdsUndo: null, kdsUndoTimer: null, kdsClockTimer: null, kdsLastOpenCount: null, kdsAudioArmed: false, kdsConnected: false, kdsHighlightItem: '', kdsAllDayOpen: false, kdsPendingTickets: new Set(),
    kdsSnapshotInFlight: null, kdsSnapshotRefreshQueued: false, kdsActionNeedsRefresh: false, kdsHeldNotices: new Map(),
    printer: null,
  };
  let toastTimer = null;

  window.addEventListener('beforeunload', (event) => {
    const waiterOrder = state.waiterTerminal;
    const hasUnsentWork = waiterTerminalHasUnsentWork(waiterOrder);
    if (role === 'waiter' && hasUnsentWork && !waiterOrder.saving) {
      persistWaiterTerminalDraft(waiterOrder);
      event.preventDefault();
      event.returnValue = '';
    }
  });

  document.body.classList.toggle('is-cashier-workspace', role === 'cashier');
  document.body.classList.toggle('is-waiter-workspace', role === 'waiter');
  document.body.classList.toggle('is-kitchen-workspace', role === 'kitchen');

  const ROLE_CONFIG = {
    cashier: {
      eyebrow: 'عملیات سالن · صندوق فروش',
      title: 'ایستگاه صندوق',
      description: 'ثبت سفارش، ارسال به آشپزخانه و تسویه',
      views: [['menu', 'منو'], ['floor', 'نقشه سالن'], ['orders', 'سفارش‌ها'], ['transactions', 'تراکنش‌ها'], ['drawer', 'صندوق پول']],
    },
    waiter: {
      eyebrow: 'خدمت‌رسانی سالن · همراه',
      title: 'سالن و گارسون',
      description: 'میزها، فراخوان مهمان و سفارش‌گیری کنار میز',
      views: [['floor', 'نقشه سالن'], ['calls', 'فراخوان‌ها'], ['orders', 'سفارش‌ها'], ['reservations', 'رزروها']],
    },
    kitchen: {
      eyebrow: 'عملیات پشت صحنه · نمایشگر آشپزخانه',
      title: 'نمایشگر آشپزخانه',
      description: 'سفارش‌های آشپزخانه، دریافت کالا، موجودی فیزیکی، ضایعات، شمارش و تولید آماده‌سازی',
      views: [['board', 'صف آشپزخانه'], ['ready', 'آماده تحویل'], ['inventory', 'انبار و دریافت']],
    },
  };

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const formatNumber = (value, options = {}) => window.WestoPersianFormat?.number(value, { ...options, locale: 'fa-IR' }) ?? Number(value || 0).toLocaleString('fa-IR', options);
  const money = (value) => `${formatNumber(value)} تومان`;
  const parseInputNumber = (value) => window.WestoPersianFormat?.parse?.(value) ?? Number(value || 0);
  const num = (value) => formatNumber(value);
  const ageMin = (date) => Math.max(0, Math.floor((Date.now() - new Date(date || 0).getTime()) / 60000));
  const time = (date) => date ? (window.ShamsiCore ? window.ShamsiCore.formatShamsiTime(date) : new Date(date).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })) : '—';
  const fmtDate = (date) => date ? (window.ShamsiCore ? window.ShamsiCore.formatShamsiDateLong(date) : esc(date)) : '—';
  const qs = () => state.branchId ? `?branchId=${encodeURIComponent(state.branchId)}` : '';

  function errorMessage(status, data) {
    const map = {
      unauthorized: 'نشست شما تمام شده است.', workspace_forbidden: 'این فضای کاری در سطح دسترسی شما نیست.',
      shift_not_open: 'شیفت بازی وجود ندارد.', cash_drawer_still_open: 'ابتدا صندوق پول را ببندید.',
      cash_drawer_not_open: 'برای دریافت نقدی ابتدا صندوق پول را باز کنید.', order_not_payable: 'این سفارش در مرحله قابل تسویه نیست.',
      cash_collection_forbidden: 'دریافت وجه نقد فقط برای کاربر دارای دسترسی صندوق مجاز است.',
      tenant_persistence_failed: 'ثبت امن اطلاعات این مجموعه انجام نشد؛ عملیات انجام‌شده تأیید نشده است. دوباره وضعیت را بررسی کنید.',
      payment_amount_invalid: 'مبلغ پرداخت باید عدد صحیح و بزرگ‌تر از صفر باشد.',
      payment_amount_exceeds_due: 'مبلغ واردشده از ماندهٔ فعلی بیشتر است؛ فاکتور را تازه کنید.',
      payment_history_inconsistent: 'جمع دریافت‌ها با مبلغ پرداخت‌شده فاکتور هم‌خوان نیست؛ پیش از دریافت دوباره، وضعیت را تطبیق دهید.',
      payment_history_invalid: 'سابقهٔ مالی فاکتور معتبر نیست؛ ثبت دریافت متوقف شد.',
      payment_history_exceeds_order_total: 'جمع دریافت خالص از مبلغ فاکتور بیشتر است؛ دریافت را متوقف و با سرپرست تطبیق دهید.',
      cash_received_invalid: 'مبلغ دریافتی نقدی باید عدد صحیح و بزرگ‌تر از صفر باشد.',
      cash_received_insufficient: 'مبلغ دریافتی نقدی از مبلغ قابل پرداخت کمتر است.',
      cash_amount_invalid: 'موجودی اولیه باید عدد صحیح و نامنفی باشد.',
      cash_counted_amount_invalid: 'مبلغ شمارش‌شده باید عدد صحیح و نامنفی باشد.',
      cash_movement_amount_invalid: 'مبلغ ورود یا خروج باید عدد صحیح و بزرگ‌تر از صفر باشد.',
      cash_movement_idempotency_required: 'برای ثبت امن گردش، پنل را تازه کنید و دوباره تلاش کنید.',
      cash_movement_idempotency_invalid: 'شناسهٔ گردش نقدی معتبر نیست.',
      cash_movement_idempotency_conflict: 'این شناسه قبلاً برای گردش دیگری استفاده شده؛ اطلاعات صندوق را تازه کنید.',
      cash_drawer_close_idempotency_conflict: 'این صندوق قبلاً با شمارش دیگری بسته شده است؛ گزارش نشست را بررسی کنید.',
      cash_drawer_session_changed: 'نشست صندوق تغییر کرده است؛ اطلاعات را تازه کنید و دوباره بررسی کنید.',
      settlement_idempotency_required: 'درخواست پرداخت معتبر نیست؛ پنل را تازه کنید و دوباره تلاش کنید.',
      settlement_idempotency_invalid: 'شناسهٔ ثبت پرداخت معتبر نیست.', idempotency_key_conflict: 'این درخواست قبلاً با مبلغ یا روش دیگری ثبت شده است؛ وضعیت فاکتور را تازه کنید.',
      payment_status_reconciliation_required: 'وضعیت پرداخت نیازمند تطبیق است؛ پیش از دریافت دوباره با مدیر تماس بگیرید.',
      settlement_reference_invalid: 'کد پیگیری کارت‌خوان معتبر نیست؛ متن کوتاه‌تری وارد کنید.',
      settlement_reference_required: 'کد پیگیری رسید کارت‌خوان برای ثبت دستی الزامی است.',
      covers_invalid: 'تعداد مهمان باید حداقل یک نفر باشد.', seat_exceeds_covers: 'تعداد مهمان را با صندلی‌های تخصیص‌یافته هماهنگ کنید.',
      kitchen_course_empty: 'برای ارسال سفارش، دست‌کم یک مرحله را به آشپزخانه بفرستید.',
      loyalty_redemption_requires_settlement: 'استفاده از امتیاز در تسویه فعلاً فعال نیست.', tender_invalid: 'این روش دریافت وجه فعال نیست.',
      discount_not_allowed: 'اعمال تخفیف دستی در دسترسی شما نیست.',
      cashier_transition_invalid: 'این تغییر وضعیت برای صندوق مجاز نیست.', waiter_transition_invalid: 'این تغییر وضعیت برای گارسون مجاز نیست.',
      kitchen_transition_invalid: 'این تغییر وضعیت در آشپزخانه مجاز نیست.',
      kds_item_invalid: 'این قلم دیگر در سفارش فعال نیست.', kds_station_invalid: 'ایستگاه انتخاب‌شده معتبر نیست.',
      kds_station_empty: 'این سفارش قلمی برای ایستگاه انتخاب‌شده ندارد.', kitchen_recall_invalid: 'این سفارش در وضعیت قابل بازگردانی نیست.',
      kds_ticket_incomplete: 'تا وقتی همهٔ اقلام تکمیل نشده‌اند، سفارش آماده نمی‌شود.',
      order_edit_locked: 'آشپزخانه آماده‌سازی را شروع کرده؛ ویرایش این سفارش قفل شده است.',
      order_edit_after_payment_requires_adjustment: 'برای جلوگیری از مغایرت مالی، پس از دریافت وجه ویرایش مستقیم فاکتور ممکن نیست؛ برای تعدیل یا بازپرداخت با مدیر هماهنگ کنید.',
      order_edit_refund_required: 'مبلغ جدید از پرداخت ثبت‌شده کمتر است؛ ابتدا بازپرداخت را ثبت کنید.',
      order_edit_branch_mismatch: 'این سفارش متعلق به شعبه فعال نیست.',
      order_split_locked: 'تا تعیین تکلیف پرداخت یا ثبت دریافت، تفکیک فاکتور ممکن نیست؛ وضعیت صندوق را بررسی کنید.',
      split_mode_invalid: 'نوع تفکیک فاکتور معتبر نیست.',
      table_persistence_failed: 'ذخیرهٔ تغییرات میز انجام نشد؛ وضعیت قبلی حفظ شد.',
      table_id_duplicate: 'شناسهٔ یک میز در این فهرست بیش از یک‌بار آمده است.',
      table_not_found: 'میز انتخاب‌شده در شعبهٔ فعال پیدا نشد یا قبلاً حذف شده است.',
      table_inactive: 'میز مقصد غیرفعال است.',
      table_occupied: 'میز مقصد در حال سرویس است؛ میز دیگری انتخاب کنید.',
      printer_not_configured: 'برای این شعبه پرینتر صندوق تنظیم نشده است.', printer_disabled: 'پرینتر صندوق غیرفعال است.',
      printer_unreachable: 'اتصال به پرینتر برقرار نشد؛ IP و روشن‌بودن دستگاه را بررسی کنید.',
      printer_timeout: 'پرینتر در زمان مشخص پاسخ نداد.', printer_write_failed: 'ارسال رسید به پرینتر ناموفق بود.',
      printer_config_invalid: 'تنظیمات پرینتر معتبر نیست.',
      purchase_order_not_found: 'سفارش خرید پیدا نشد یا دیگر قابل دریافت نیست.',
      purchase_order_not_approved: 'این سفارش خرید هنوز تأیید نشده است.',
      purchase_order_line_not_found: 'ردیف سفارش خرید معتبر نیست.',
      goods_receipt_over_quantity: 'مقدار دریافت از ماندهٔ سفارش بیشتر است.',
      goods_receipt_duplicate: 'شماره حوالهٔ تأمین‌کننده قبلاً ثبت شده است.',
      goods_receipt_branch_mismatch: 'سفارش خرید متعلق به شعبهٔ فعال نیست.',
      production_inventory_shortage: 'موجودی مواد برای این مرحله تولید کافی نیست؛ ابتدا دریافت یا شمارش موجودی را ثبت کنید.',
      production_recipe_not_executable: 'دستور تهیه یا واحد مواد برای ثبت تولید کامل نیست.',
      waitlist_phone_invalid: 'شماره موبایل ۱۱ رقمی وارد کنید.',
      waitlist_duplicate_phone: 'این شماره هم‌اکنون در صف انتظار است.',
      waitlist_idempotency_conflict: 'این ثبت با درخواست دیگری تداخل دارد؛ دوباره تلاش کنید.',
      waitlist_table_invalid: 'میز انتخاب‌شده در این شعبه فعال نیست.',
      waitlist_table_capacity: 'ظرفیت این میز برای تعداد مهمان کافی نیست.',
      waitlist_table_busy: 'این میز همین حالا در اختیار مهمان یا سفارش دیگری است.',
      waitlist_party_invalid: 'تعداد مهمان باید حداقل یک نفر باشد.',
      waitlist_transition_invalid: 'این تغییر وضعیت برای مهمان ممکن نیست.',
      waitlist_not_found: 'مهمان موردنظر در صف پیدا نشد.',
    };
    const code = typeof data?.error === 'object' ? data.error.code : data?.error;
    const message = typeof data?.error === 'object' ? data.error.message : data?.message;
    if (code === 'feature_disabled') return message || 'این بخش توسط کنترل‌پلن سالسا (SALSA) غیرفعال شده است.';
    return map[code] || message || code || `خطای ارتباط با سرور (${status})`;
  }

  async function api(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const headers = new Headers(options.headers || {});
      headers.set('Accept', 'application/json');
      if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      const response = await fetch(url, { ...options, headers, credentials: 'same-origin', signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        location.href = '/login';
        const error = new Error('نشست شما تمام شده است.');
        error.httpStatus = 401;
        error.code = 'unauthorized';
        throw error;
      }
      if (!response.ok) {
        const error = new Error(errorMessage(response.status, data));
        error.httpStatus = response.status;
        error.code = typeof data?.error === 'object' ? data.error.code : data?.error;
        error.outcomeUnknown = mutating && response.status >= 500;
        if (mutating && /\/orders\/[^/]+\/settle$/.test(url) && ['idempotency_key_conflict', 'idempotency_replay_unavailable', 'payment_status_reconciliation_required'].includes(String(error.code))) {
          error.outcomeUnknown = true;
        }
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        const timeout = new Error('پاسخ سرور طول کشید؛ اتصال را بررسی کنید.');
        timeout.code = 'request_timeout';
        timeout.outcomeUnknown = mutating;
        throw timeout;
      }
      if (mutating && error instanceof TypeError) error.outcomeUnknown = true;
      throw error;
    } finally { clearTimeout(timer); }
  }

  function showToast(message, type = '') {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.className = `role-toast show ${type}`;
    toastTimer = setTimeout(() => {
      toast.className = 'role-toast';
      toast.textContent = '';
    }, 3200);
  }

  function pageHead(kicker, title, description, action = '') {
    return `<header class="role-page-head"><div><span>${esc(kicker)}</span><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${action}</header>`;
  }

  function metric(label, value, detail = '') {
    return `<article class="role-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</article>`;
  }

  function empty(message) { return `<div class="empty-state">${esc(message)}</div>`; }

  // Keep waiter/cashier floor sections aligned with the floor studio's zone
  // normalization so the same tables always belong to the same named area.
  function normalizeRoleFloorZoneName(zone) {
    const value = String(zone ?? '').trim();
    if (!value) return 'بدون بخش';
    if (/^(?:سالن اصلی|سالن|main(?: hall)?)$/i.test(value)) return 'سالن';
    if (/^(?:تراس و فضای باز|تراس|terrace|outdoor)$/i.test(value)) return 'تراس';
    if (/^(?:سالن اختصاصی ویژه|سالن ویژه|ویژه|vip)$/i.test(value)) return 'ویژه';
    return value;
  }

  function roleFloorFixtureInsideZone(fixture, zone) {
    const centerX = Number(fixture?.x) + Number(fixture?.w || 0) / 2;
    const centerY = Number(fixture?.y) + Number(fixture?.h || 0) / 2;
    const left = Number(zone?.x);
    const top = Number(zone?.y);
    const right = left + Number(zone?.w);
    const bottom = top + Number(zone?.h);
    return [centerX, centerY, left, top, right, bottom].every(Number.isFinite)
      && centerX >= left && centerX <= right && centerY >= top && centerY <= bottom;
  }

  function statusLabel(status) {
    return ({ pending_online: 'پرداخت آنلاین', awaiting_confirmation: 'نیازمند تأیید', pay_at_cashier: 'پیش‌نویس صندوق', sent_to_kitchen: 'ارسال‌شده به آشپزخانه', paid: 'پرداخت‌شده', preparing: 'در حال آماده‌سازی', ready: 'آماده تحویل', dispatched: 'تحویل پیک', picked_up: 'تحویل شد', delivered: 'رسید', done: 'تکمیل', completed: 'تکمیل', cancelled: 'لغو' })[status] || status || '—';
  }

  function orderPaymentStatus(order) {
    const valid = new Set(['unpaid', 'partial', 'pending', 'paid', 'failed', 'cancelled', 'refunded', 'unknown']);
    const raw = String(order?.paymentStatus || '').trim().toLowerCase();
    if (valid.has(raw)) return raw;
    const orderStatus = String(order?.status || '').trim().toLowerCase();
    if (!raw && orderStatus === 'pending_online') return 'pending';
    if (!raw && ['pay_at_cashier', 'awaiting_confirmation'].includes(orderStatus)) return 'unpaid';
    return 'unknown';
  }

  function orderPaymentStatusLabel(order) {
    return ({
      unpaid: 'پرداخت‌نشده', partial: 'پرداخت بخشی', pending: 'پرداخت در انتظار',
      paid: 'پرداخت‌شده', failed: 'پرداخت ناموفق', cancelled: 'پرداخت لغوشده',
      refunded: 'بازپرداخت‌شده', unknown: 'نیازمند تطبیق پرداخت',
    })[orderPaymentStatus(order)] || 'نیازمند تطبیق پرداخت';
  }

  function orderItems(order) {
    return (order.items || []).map((item) => {
      const complements = (item.complements || []).map((entry) => `${num(entry.qty || 1)}× ${esc(entry.name)}`).join('، ');
      return `${num(item.qty || 1)}× ${esc(item.name)}${complements ? ` ← ${complements}` : ''}`;
    }).join(' · ') || 'بدون قلم';
  }

  function orderCard(order, actions = '', paymentSummary = '') {
    const age = ageMin(order.createdAt);
    return `<article class="order-card ${age >= 20 ? 'is-late' : ''}" data-order-id="${order.id}">
      <div class="order-card__top"><strong>${esc(order.orderNo || `سفارش ${order.id}`)}</strong><span>${esc(order.tableNo ? `میز ${order.tableNo}` : order.fulfillment === 'delivery' ? 'ارسال' : 'بیرون‌بر')} · ${num(age)} دقیقه</span></div>
      <div class="order-card__items">${orderItems(order)}</div>
      <div class="order-card__meta"><span>${esc(statusLabel(order.status))}</span><span class="order-card__payment">پرداخت: ${esc(orderPaymentStatusLabel(order))}</span>${order.note ? ` · یادداشت: ${esc(order.note)}` : ''}${order.kitchenNote ? ` · پیام آشپزخانه: ${esc(order.kitchenNote)}` : ''}</div>
      ${paymentSummary}
      <div class="order-card__bottom"><b>${money(order.total)}</b><div class="order-actions">${actions}</div></div>
    </article>`;
  }

  function setBusy(button, busy) {
    if (!button) return;
    if (busy) { button.dataset.label = button.textContent; button.textContent = 'در حال انجام…'; button.disabled = true; }
    else { button.textContent = button.dataset.label || button.textContent; button.disabled = false; }
  }

  function settlementActorIntent(intent) {
    return {
      ...intent,
      branchId: intent.branchId ?? state.branchId,
      actor: state.session?.user?.phone || '',
      actorRole: state.session?.user?.role || role,
    };
  }

  function settlementIdempotencyKey(button, rawIntent) {
    const intent = settlementActorIntent(rawIntent || {});
    const paymentState = globalThis.WestoOrderPaymentState;
    if (!paymentState?.getSettlementIdempotencyKey) {
      if (!button.dataset.settlementKey) button.dataset.settlementKey = `settle-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      return button.dataset.settlementKey;
    }
    const fingerprint = paymentState.settlementIntentFingerprint(intent);
    if (button.dataset.settlementFingerprint === fingerprint && button.dataset.settlementKey) return button.dataset.settlementKey;
    button.dataset.settlementFingerprint = fingerprint;
    button.dataset.settlementKey = paymentState.getSettlementIdempotencyKey(intent);
    return button.dataset.settlementKey;
  }

  function clearSettlementIdempotencyKey(key, rawIntent) {
    const paymentState = globalThis.WestoOrderPaymentState;
    if (paymentState?.clearSettlementIdempotencyKey) {
      paymentState.clearSettlementIdempotencyKey(settlementActorIntent(rawIntent || {}), key);
    }
  }

  function parseCashDrawerInput(input, { allowZero = false } = {}) {
    const normalized = normalizeDigits(String(input?.value ?? '').trim());
    if (!normalized || !/^(?:\d+|\d{1,3}(?:[,٬]\d{3})+)$/.test(normalized)) return null;
    const amount = Number(normalized.replace(/[٬,]/g, ''));
    return Number.isSafeInteger(amount) && amount >= (allowZero ? 0 : 1) ? amount : null;
  }

  function cashDrawerVarianceMessage(variance) {
    if (variance == null || String(variance).trim() === '') {
      return 'صندوق بسته شد؛ مبلغ مغایرت دریافت نشد و باید نشست را بررسی کنید.';
    }
    const amount = Number(variance);
    if (!Number.isSafeInteger(amount)) return 'صندوق بسته شد؛ مبلغ مغایرت دریافت نشد و باید نشست را بررسی کنید.';
    if (amount === 0) return 'صندوق بسته شد؛ شمارش با مبلغ مورد انتظار تطبیق دارد.';
    const kind = amount > 0 ? 'اضافه صندوق' : 'کسری صندوق';
    return `صندوق بسته شد؛ ${kind} به مبلغ ${money(Math.abs(amount))} ثبت شد و نیازمند بررسی است.`;
  }

  function cashDrawerMovementFingerprint(payload) {
    const value = JSON.stringify(payload);
    let first = 2166136261;
    let second = 3339675911;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ (code + index), 16777619);
    }
    return `${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
  }

  function cashDrawerMovementIntentStorageKey(payload, sessionId) {
    return `westo.drawer-movement.v1:${payload.branchId}:${sessionId}:${payload.type}`;
  }

  function cashDrawerMovementIdempotencyKey(button, payload, sessionId) {
    const fingerprint = cashDrawerMovementFingerprint(payload);
    if (button.dataset.cashDrawerMovementFingerprint === fingerprint && button.dataset.cashDrawerMovementKey) {
      return button.dataset.cashDrawerMovementKey;
    }

    const storageKey = cashDrawerMovementIntentStorageKey(payload, sessionId);
    let intents = {};
    try { intents = JSON.parse(sessionStorage.getItem(storageKey) || '{}') || {}; } catch (_) {}
    const existing = intents[fingerprint];
    const nonce = globalThis.crypto?.randomUUID?.()
      || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    const key = typeof existing?.key === 'string'
      ? existing.key
      : `drawer-move-${nonce}`;
    if (!existing?.key) {
      intents[fingerprint] = { key, createdAt: Date.now() };
      const entries = Object.entries(intents).sort((a, b) => Number(b[1]?.createdAt || 0) - Number(a[1]?.createdAt || 0));
      intents = Object.fromEntries(entries.slice(0, 48));
      try { sessionStorage.setItem(storageKey, JSON.stringify(intents)); } catch (_) {}
    }
    button.dataset.cashDrawerMovementFingerprint = fingerprint;
    button.dataset.cashDrawerMovementKey = key;
    return key;
  }

  function clearCashDrawerMovementIntent(payload, sessionId) {
    const storageKey = cashDrawerMovementIntentStorageKey(payload, sessionId);
    const fingerprint = cashDrawerMovementFingerprint(payload);
    try {
      const intents = JSON.parse(sessionStorage.getItem(storageKey) || '{}') || {};
      if (!Object.prototype.hasOwnProperty.call(intents, fingerprint)) return;
      delete intents[fingerprint];
      if (Object.keys(intents).length) sessionStorage.setItem(storageKey, JSON.stringify(intents));
      else sessionStorage.removeItem(storageKey);
    } catch (_) {}
  }

  async function action(button, task, success) {
    setBusy(button, true);
    try { await task(); if (success) showToast(success); await render(); return true; }
    catch (error) { showToast(error.message, 'error'); return false; }
    finally { setBusy(button, false); }
  }

  function openManualCardReference(order, amount, onConfirm) {
    openDialog(
      'مرحلهٔ پرداخت کارت',
      `دریافت ${money(amount)}`,
      `<div class="wt-payment-flow__confirm">
        <strong>پس از تأیید موفق کارت‌خوان، پرداخت را ثبت کنید.</strong>
        <p>کارت‌خوان به سامانه متصل نیست؛ این مرحله به‌تنهایی پرداخت بانکی را تأیید نمی‌کند.</p>
        <label class="field"><span>کد پیگیری روی رسید کارت‌خوان</span><input id="settlement-card-reference" type="text" maxlength="120" autocomplete="off" inputmode="text" aria-label="کد پیگیری روی رسید کارت‌خوان، الزامی" aria-required="true" required placeholder="کد پیگیری یا شماره مرجع رسید" /></label>
        <small>برای تطبیق مالی لازم است؛ این سامانه کارت‌خوان را کنترل نمی‌کند.</small>
        <div class="wt-payment-flow__actions"><button type="button" class="wt-payment-confirm" id="settlement-card-confirm" disabled>تأیید دریافت پس از بررسی کارت‌خوان</button></div>
      </div>`,
    );
    const referenceInput = dialogBody.querySelector('#settlement-card-reference');
    const confirmButton = dialogBody.querySelector('#settlement-card-confirm');
    const updateReferenceValidity = () => {
      if (confirmButton) confirmButton.disabled = !String(referenceInput?.value || '').trim();
    };
    referenceInput?.addEventListener('input', updateReferenceValidity);
    updateReferenceValidity();
    confirmButton?.addEventListener('click', async (event) => {
      const confirmButton = event.currentTarget;
      const reference = String(referenceInput?.value || '').trim();
      if (!reference) {
        showToast('کد پیگیری رسید کارت‌خوان را وارد کنید.', 'error');
        referenceInput?.focus();
        return;
      }
      await onConfirm(reference, confirmButton);
    });
  }

  function openDialog(kicker, title, body, options = {}) {
    dialog.classList.toggle('wt-item-dialog', options.variant === 'waiter-item');
    document.getElementById('dialog-kicker').textContent = kicker;
    document.getElementById('dialog-title').textContent = title;
    dialogBody.innerHTML = body;
    if (!dialog.open || options.reuse !== true) dialog.showModal();
  }

  function setActiveBranch(value) {
    const nextBranchId = Number(value) || null;
    if (!nextBranchId || Number(nextBranchId) === Number(state.branchId)) return;
    if (state.waiterTerminal) {
      const headerBranchSelect = document.getElementById('role-branch-select');
      const userBranchSelect = document.getElementById('role-user-branch-select');
      if (headerBranchSelect) headerBranchSelect.value = String(state.branchId);
      if (userBranchSelect) userBranchSelect.value = String(state.branchId);
      showToast(waiterTerminalHasUnsentWork(state.waiterTerminal)
        ? 'این سفارش هنوز پیش‌نویس یا درخواست در انتظار دارد؛ ابتدا به سالن بازگردید. شعبه تغییر نکرد.'
        : 'برای جلوگیری از جابه‌جایی فاکتور، ابتدا از سفارش باز به سالن برگردید. شعبه تغییر نکرد.', 'warning');
      return;
    }
    state.branchId = nextBranchId;
    state.waiterBranchGeneration = (state.waiterBranchGeneration || 0) + 1;
    state.waiterSnapshotRequestId = (state.waiterSnapshotRequestId || 0) + 1;
    state.waiterMenuRequestId = (state.waiterMenuRequestId || 0) + 1;
    state.waiterRenderRequestId = (state.waiterRenderRequestId || 0) + 1;
    state.lastWaiterCallsKey = '';
    state.knownCallIds = new Set();
    state.menuItems = [];
    state.menuCategories = [];
    state.menuComplements = [];
    state.menuComplementRules = [];
    if (role === 'waiter') state.data = {};
    const headerBranchSelect = document.getElementById('role-branch-select');
    if (headerBranchSelect) headerBranchSelect.value = String(nextBranchId);
    localStorage.setItem('westo_staff_branch', String(nextBranchId));
    dialog.close();
    startStream();
    render();
  }

  function clearRoleHeaderContext() {
    const context = document.getElementById('role-header-context');
    if (!context) return;
    context.hidden = true;
    context.innerHTML = '';
  }

  function paintWaiterHeaderContext() {
    const context = document.getElementById('role-header-context');
    if (!context) return;
    context.hidden = false;
    context.innerHTML = `
      <div class="floor-segmented waiter-header-mode" role="tablist" aria-label="نحوهٔ نمایش سالن">
        <button type="button" class="floor-segmented__btn ${state.waiterFloorMode === 'plan' ? 'active' : ''}" id="floor-view-plan" role="tab" aria-selected="${state.waiterFloorMode === 'plan'}">📐 پلان</button>
        <button type="button" class="floor-segmented__btn ${state.waiterFloorMode === 'grid' ? 'active' : ''}" id="floor-view-grid" role="tab" aria-selected="${state.waiterFloorMode === 'grid'}">▦ کارت</button>
      </div>
    `;
  }

  function openActiveUserDialog() {
    const user = state.session?.user || {};
    const branches = Array.isArray(state.session?.branches) ? state.session.branches : [];
    const branchOptions = branches.map((branch) => `<option value="${branch.id}" ${Number(branch.id) === Number(state.branchId) ? 'selected' : ''}>${esc(branch.name)}</option>`).join('');
    const themeOptions = [
      ['light', 'روشن', '☀️'],
      ['dark', 'تیره', '🌙'],
      ['system', 'خودکار', '◐'],
    ];
    const themeSettings = supportsStaffTheme ? `
        <fieldset class="role-user-theme">
          <legend>شخصی‌سازی ظاهر</legend>
          <div class="role-user-theme__options" role="radiogroup" aria-label="انتخاب تم پنل">
            ${themeOptions.map(([value, label, icon]) => `<label class="role-user-theme__option"><input type="radio" name="role-user-theme" value="${value}" ${staffThemePreference === value ? 'checked' : ''}><span aria-hidden="true">${icon}</span><strong>${label}</strong></label>`).join('')}
          </div>
          <p class="role-user-theme__hint" id="role-user-theme-hint" role="status">این انتخاب روی صندوق و صفحهٔ گارسون همین دستگاه ذخیره و همگام می‌شود.</p>
        </fieldset>` : '';
    openDialog('حساب کاربری', user.name || user.roleLabel || 'کاربر فعال', `
      <div class="role-user-dialog">
        <div class="role-user-dialog__identity">
          <span class="role-user-dialog__avatar">${esc((user.name || user.roleLabel || 'و').trim().slice(0, 1))}</span>
          <div><strong>${esc(user.name || user.roleLabel || 'کاربر فعال')}</strong><small>${esc(user.roleLabel || '')}</small></div>
        </div>
        <div class="role-metrics">
          ${metric('نقش واقعی', user.roleLabel || '—')}
          ${metric('شماره', user.phone || '—')}
          ${metric('شیفت', state.session?.shift ? 'باز' : 'بسته')}
        </div>
        <label class="role-user-branch-field">
          <span>شعبهٔ فعال</span>
          <select id="role-user-branch-select" aria-label="انتخاب شعبه">${branchOptions || '<option value="">شعبه‌ای ثبت نشده</option>'}</select>
        </label>
        ${themeSettings}
        <button class="role-danger" id="role-logout" type="button">خروج از حساب</button>
      </div>
    `);
    document.getElementById('role-user-branch-select')?.addEventListener('change', (event) => setActiveBranch(event.target.value));
    dialogBody.querySelectorAll('input[name="role-user-theme"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        const selected = applyStaffTheme(input.value, true);
        const hint = dialogBody.querySelector('#role-user-theme-hint');
        if (hint) hint.textContent = `تم ${selected === 'dark' ? 'تیره' : selected === 'system' ? 'خودکار' : 'روشن'} فعال شد و برای صندوق و گارسون ذخیره شد.`;
      });
    });
  }

  async function loadSession() {
    const stored = Number(localStorage.getItem('westo_staff_branch') || 0) || '';
    const data = await api(`/api/staff/session/${role}${stored ? `?branchId=${stored}` : ''}`);
    state.session = data;
    state.branchId = data.branchId || data.branches?.[0]?.id || null;
    document.title = `${data.workspace.label} — وستو`;
    document.getElementById('role-eyebrow').textContent = ROLE_CONFIG[role].eyebrow;
    document.getElementById('role-title').textContent = ROLE_CONFIG[role].title;
    document.getElementById('role-user').textContent = (data.user.name || data.user.roleLabel || 'و').trim().slice(0, 1);
    const preview = document.getElementById('role-preview-banner');
    if (preview) preview.hidden = !data.workspace.preview;
    document.getElementById('role-manager-back').hidden = !data.workspace.returnPath;
    const select = document.getElementById('role-branch-select');
    select.innerHTML = (data.branches || []).map((branch) => `<option value="${branch.id}" ${Number(branch.id) === Number(state.branchId) ? 'selected' : ''}>${esc(branch.name)}</option>`).join('');
    select.onchange = () => {
      setActiveBranch(select.value);
    };
    paintShift(data.shift);
  }

  function paintShift(shift) {
    state.session.shift = shift || null;
    const button = document.getElementById('role-shift');
    button.textContent = shift ? 'پایان شیفت' : 'شروع شیفت';
    button.classList.toggle('is-open', !!shift);
    button.setAttribute('aria-pressed', String(!!shift));
    button.setAttribute('aria-label', shift ? `پایان شیفت؛ شروع‌شده در ${time(shift.openedAt)}` : 'شروع شیفت کاری');
    button.title = shift ? `شیفت فعال از ${time(shift.openedAt)}؛ برای پایان کلیک کنید` : 'شروع شیفت کاری';
  }

  function shiftElapsedLabel(openedAt) {
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(openedAt).getTime()) / 60000));
    if (minutes < 60) return `${num(minutes)} دقیقه`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${num(hours)} ساعت و ${num(remainder)} دقیقه` : `${num(hours)} ساعت`;
  }

  function showShiftCloseDialog() {
    const current = state.session.shift;
    if (!current) return;
    const drawerOpen = role === 'cashier' && !!state.data?.drawer?.session;
    openDialog('کنترل شیفت', 'پایان شیفت', `
      <div class="shift-end-sheet">
        <div class="shift-end-summary">
          <span>شیفت فعال</span>
          <strong>شروع در ${time(current.openedAt)}</strong>
          <small>مدت فعالیت: ${shiftElapsedLabel(current.openedAt)}</small>
        </div>
        ${drawerOpen ? `
          <div class="shift-end-alert is-blocked" role="alert">
            <strong>صندوق پول هنوز باز است</strong>
            <p>برای پایان امن شیفت، ابتدا صندوق را شمارش و ببندید؛ سپس دوباره «پایان شیفت» را بزنید.</p>
          </div>
          <div class="shift-end-actions">
            <button class="role-primary" id="shift-go-drawer" type="button">رفتن به صندوق پول</button>
            <button class="role-secondary" id="cancel-shift-close" type="button">انصراف</button>
          </div>` : `
          <div class="shift-end-alert">
            <strong>آیا این شیفت پایان یابد؟</strong>
            <p>زمان پایان ثبت می‌شود و برای ادامه عملیات باید شیفت جدیدی شروع کنید.</p>
          </div>
          <div class="shift-end-actions">
            <button class="role-danger" id="confirm-shift-close" type="button">تأیید و پایان شیفت</button>
            <button class="role-secondary" id="cancel-shift-close" type="button">انصراف</button>
          </div>`}
      </div>`);
    document.getElementById('cancel-shift-close')?.addEventListener('click', () => dialog.close());
    document.getElementById('shift-go-drawer')?.addEventListener('click', () => {
      dialog.close();
      state.activeView = 'drawer';
      paintNav();
      render();
    });
    document.getElementById('confirm-shift-close')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      setBusy(button, true);
      try {
        await api('/api/staff/shifts/close', { method: 'POST', body: JSON.stringify({ branchId: state.branchId }) });
        paintShift(null);
        dialog.close();
        showToast('شیفت با موفقیت پایان یافت.');
        await render();
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        setBusy(button, false);
      }
    });
  }

  async function toggleShift() {
    const current = state.session.shift;
    if (current) {
      showShiftCloseDialog();
      return;
    }
    const button = document.getElementById('role-shift');
    setBusy(button, true);
    let openedShift = null;
    try {
      const data = await api('/api/staff/shifts/open', { method: 'POST', body: JSON.stringify({ branchId: state.branchId }) });
      openedShift = data.shift;
    } catch (error) { showToast(error.message, 'error'); }
    finally { setBusy(button, false); }
    if (!openedShift) return;
    paintShift(openedShift);
    showToast('شیفت شروع شد؛ دکمه اکنون برای پایان شیفت است.');
    await render();
  }

  function syncKitchenScrollMode() {
    document.body.classList.toggle('is-kitchen-inventory', role === 'kitchen' && state.activeView === 'inventory');
  }

  const VIEW_FEATURE_MAP = {
    menu: 'orders.pos',
    floor: 'floor.tables',
    orders: 'orders.pos',
    transactions: 'payments.gateway',
    drawer: 'cash.drawers',
    calls: 'staff.waiter',
    reservations: 'booking.reservations',
    board: 'kitchen.kds',
    ready: 'kitchen.kds',
    inventory: 'stock.inventory'
  };

  async function loadFeatures() {
    try {
      const res = await fetch(`/api/admin/features${qs()}`);
      if (res.ok) {
        const json = await res.json();
        state.features = json.features || {};
      }
    } catch (_) {}
  }

  function isViewFeatureEnabled(viewId) {
    const featureKey = VIEW_FEATURE_MAP[viewId];
    if (!featureKey) return true;
    if (!state.features || Object.keys(state.features).length === 0) return true;
    const feat = state.features[featureKey];
    if (feat === undefined) return true;
    return typeof feat === 'boolean' ? feat : (feat.active !== false && feat.status !== 'disabled');
  }

  function paintNav() {
    const config = ROLE_CONFIG[role];
    if (!state.activeView) {
      const requested = new URLSearchParams(location.search).get('view');
      const availableViews = config.views.filter(([id]) => isViewFeatureEnabled(id));
      const firstEnabled = availableViews[0] ? availableViews[0][0] : config.views[0][0];
      state.activeView = config.views.some(([id]) => id === requested) ? requested : firstEnabled;
    }
    syncKitchenScrollMode();
    nav.innerHTML = config.views.map(([id, label]) => {
      const enabled = isViewFeatureEnabled(id);
      const activeClass = state.activeView === id ? 'active' : '';
      const lockedClass = !enabled ? 'is-feature-locked' : '';
      const lockIcon = !enabled ? ' 🔒' : '';
      return `<button type="button" data-view="${id}" class="${activeClass} ${lockedClass}" ${!enabled ? 'title="این بخش توسط کنترل‌پلن سالسا (SALSA) غیرفعال است"' : ''}>${esc(label)}${lockIcon}</button>`;
    }).join('');
    nav.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
      state.activeView = button.dataset.view;
      if (role === 'waiter') state.waiterUnmappedOnly = false;
      if (role === 'kitchen') state.kdsPage = 0;
      paintNav();
      render();
    }));
  }

  async function fetchCashier() {
    const [orders, drawer, floor] = await Promise.all([
      api(`/api/admin/v2/orders${qs()}`), api(`/api/cashier/drawer${qs()}`), api(`/api/admin/v2/floor${qs()}`),
    ]);
    await loadMenu();
    state.data = { orders: orders.orders || [], drawer, floor };
    if (state.posCheck?.orderId) {
      const freshOrder = state.data.orders.find((order) => Number(order.id) === Number(state.posCheck.orderId));
      if (freshOrder && !orderCanEdit(freshOrder)) state.posCheck = posCheckFromOrder(freshOrder);
    }
  }

  function menuModifierGroupsForItem(item) {
    return Array.isArray(item?.modifierGroups) ? item.modifierGroups : [];
  }

  function modifierGroupMinimum(group) {
    const min = Number(group?.minSelections);
    return Number.isInteger(min) && min >= 0 && min <= 16 ? min : (group?.required === true ? 1 : 0);
  }

  function modifierGroupMaximum(group) {
    const activeOptions = (Array.isArray(group?.options) ? group.options : []).filter((option) => option?.available !== false).length;
    if (group?.selection === 'single') return Math.min(1, activeOptions);
    const max = Number(group?.maxSelections);
    return Math.min(Number.isInteger(max) && max >= 1 && max <= 16 ? max : 16, activeOptions);
  }

  function validateMenuModifierChoices(groups, modifiers) {
    if (!Array.isArray(modifiers)) return { ok: false, missing: [], exceeded: [] };
    const counts = new Map();
    const seen = new Set();
    for (const modifier of modifiers) {
      const groupId = String(modifier?.groupId || '');
      const optionId = String(modifier?.id || '');
      const identity = `${groupId}:${optionId}`;
      if (!groupId || !optionId || seen.has(identity)) return { ok: false, missing: [], exceeded: [] };
      seen.add(identity);
      counts.set(groupId, (counts.get(groupId) || 0) + 1);
    }
    const missing = groups.filter((group) => (counts.get(String(group.id)) || 0) < modifierGroupMinimum(group));
    const exceeded = groups.filter((group) => (counts.get(String(group.id)) || 0) > modifierGroupMaximum(group));
    return { ok: !missing.length && !exceeded.length, missing, exceeded };
  }

  function modifierOptionForInput(groups, input) {
    const id = String(input?.dataset?.modifierOption || '');
    const groupId = String(input?.dataset?.modifierGroup || '');
    const group = groups.find((entry) => String(entry.id) === groupId);
    const option = (group?.options || []).find((entry) => String(entry.id) === id);
    return option ? { ...option, groupId: group.id, groupTitle: group.title } : null;
  }

  function posUnitTotal(line) {
    return Number(line.price || 0) + (line.modifiers || []).reduce((sum, modifier) => sum + Number(modifier.price || 0), 0);
  }

  function posComplementTotal(line) {
    return (line.complements || []).reduce((sum, complement) => sum + Number(complement.price || 0) * Number(complement.qty || 1), 0);
  }

  function posBaseLineTotal(line) {
    return posUnitTotal(line) * Number(line.qty || 1);
  }

  function posLineTotal(line) {
    return posBaseLineTotal(line) + posComplementTotal(line);
  }

  function posSubtotal(check = state.posCheck) {
    return (check?.lines || []).reduce((sum, line) => sum + posLineTotal(line), 0);
  }

  function posDiscount(check = state.posCheck) {
    if (!check) return 0;
    if (check.discountAmount) return Number(check.discountAmount);
    if (check.discountRate) return Math.round(posSubtotal(check) * Number(check.discountRate) / 100);
    return Number(check.discount || 0);
  }

  function posTotal(check = state.posCheck) {
    const sub = posSubtotal(check);
    const disc = posDiscount(check);
    return Math.max(0, sub - disc);
  }

  function orderIsOpen(order) {
    const status = String(order?.status || '').trim().toLowerCase();
    if (status === 'cancelled') return false;
    const serviceComplete = ['done', 'completed', 'picked_up', 'delivered'].includes(status);
    if (!serviceComplete) return true;
    // Keep a served table occupied until the shared payment model confirms a
    // consistent settlement. Missing/new payment states must fail closed.
    const workflow = globalThis.WestoOrderPaymentState?.deriveOrderPaymentWorkflow(order);
    return !(workflow?.settled === true
      || (workflow?.isConsistent === true && workflow?.paymentStatus === 'refunded'));
  }

  function waiterWorkflowMarkup(wt) {
    const order = wt?.order || {};
    const status = String(order.status || '');
    const saved = Boolean(order.id);
    const sent = saved && !['draft', 'pay_at_cashier', 'awaiting_confirmation', 'pending_online', 'cancelled'].includes(status);
    const served = ['done', 'completed', 'picked_up', 'delivered'].includes(status);
    const preparationComplete = ['ready', 'done', 'completed', 'picked_up', 'delivered'].includes(status);
    const paymentWorkflow = saved
      ? globalThis.WestoOrderPaymentState.deriveOrderPaymentWorkflow(order)
      : null;
    const paid = paymentWorkflow?.settled === true;
    const needsReconciliation = paymentWorkflow?.requiresReconciliation === true;
    const paymentNeedsRefresh = wt?.paymentNeedsRefresh === true;
    const paymentIntentConflict = wt?.paymentIntentConflict === true;
    const orderSubmissionConflict = wt?.orderSubmissionConflict === true;
    const orderSaveNeedsRefresh = wt?.orderSaveNeedsRefresh === true;
    const paymentAmounts = paymentWorkflow?.amounts || { total: null, paid: null, due: null };
    const steps = [
      { label: 'سفارش', complete: sent },
      { label: 'آماده‌سازی', complete: preparationComplete },
      { label: 'تحویل', complete: served },
      { label: 'تسویه', complete: paid, blocked: needsReconciliation || paymentNeedsRefresh || paymentIntentConflict },
    ];
    const currentStep = steps.findIndex((step) => !step.complete);
    const hint = orderSubmissionConflict
      ? 'نتیجهٔ ثبت سفارش قابل تطبیق نیست؛ ارسال دوباره متوقف است و مدیر شیفت باید وضعیت میز را بررسی کند.'
      : orderSaveNeedsRefresh
      ? 'وضعیت سفارش تازه نیست؛ پیش از هر اقدام، اطلاعات سرور را به‌روزرسانی کنید.'
      : paymentIntentConflict
      ? 'وضعیت فاکتور با درخواست دریافت قبلی تطبیق ندارد؛ صندوق باید آن را بررسی کند.'
      : paymentNeedsRefresh
      ? 'نتیجهٔ دریافت وجه هنوز روشن نیست؛ ابتدا وضعیت را تازه کنید و دوباره وجه دریافت نکنید.'
      : needsReconciliation
      ? 'اطلاعات سفارش یا پرداخت نیاز به بررسی دارد؛ تا تطبیق اطلاعات، دریافت وجه متوقف است.'
      : currentStep === -1
      ? 'سفارش تحویل و تسویه شده است.'
      : currentStep === 0
        ? 'غذاها را انتخاب کنید و سپس سفارش را برای آشپزخانه بفرستید.'
        : currentStep === 1
          ? 'سفارش ثبت شد؛ تا آماده‌شدن غذا، وضعیت آماده‌سازی را دنبال کنید.'
          : currentStep === 2
            ? status === 'ready'
              ? 'غذا آماده است؛ تحویل به میز را ثبت کنید.'
              : paid
                ? 'پرداخت ثبت شد؛ تحویل سفارش را تکمیل کنید.'
                : 'سفارش در حال آماده‌سازی است؛ پس از آماده‌شدن، تحویل به میز را ثبت کنید.'
      : order.paymentStatus === 'partial'
              ? `پرداخت بخشی ثبت شده؛ ماندهٔ ${money(paymentAmounts.due)} را دریافت کنید.`
              : 'تحویل ثبت شد؛ مبلغ باقی‌مانده را دریافت و تسویه کنید.';
    const flowStatus = orderSubmissionConflict
      ? 'وضعیت سفارش نیازمند بررسی است'
      : orderSaveNeedsRefresh
        ? 'نتیجهٔ ثبت سفارش را بررسی کنید'
        : paymentIntentConflict
          ? 'پرداخت نیازمند بررسی صندوق است'
          : paymentNeedsRefresh
            ? 'وضعیت پرداخت را تازه کنید'
            : needsReconciliation
              ? 'تسویه نیازمند بررسی صندوق است'
              : currentStep === -1
                ? 'سفارش تکمیل شده است'
                : `مرحلهٔ ${num(currentStep + 1)} از ۴ · ${steps[currentStep].label}`;

    return `<section class="wt-flow" aria-label="مراحل سفارش">
      <div class="wt-flow__summary">
        <p class="wt-flow__current" role="status">${flowStatus}</p>
        ${saved ? '<button type="button" id="wt-refresh-flow" class="wt-flow__refresh">تازه‌سازی</button>' : ''}
      </div>
      <details class="wt-flow__details">
        <summary>نمایش مراحل سفارش</summary>
        <ol class="wt-flow__steps">${steps.map((step, index) => {
          const current = index === currentStep && !step.blocked;
          return `<li class="wt-flow__step ${step.complete ? 'is-complete' : ''} ${current ? 'is-current' : ''} ${step.blocked ? 'is-blocked' : ''}" ${current ? 'aria-current="step"' : ''} ${step.blocked ? 'aria-disabled="true"' : ''}>
            <span class="wt-flow__number" aria-hidden="true">${step.complete ? '✓' : index + 1}</span>
            <span>${step.label}</span>
          </li>`;
        }).join('')}</ol>
        <div class="wt-flow__meta"><p role="status">${hint}</p></div>
      </details>
      ${needsReconciliation ? '<p class="wt-flow__conflict role-inline-warning" role="alert">تسویه تا بررسی مالی با صندوق متوقف است؛ فعلاً وجه دریافت نکنید.</p>' : ''}
      ${paymentIntentConflict ? '<p class="wt-flow__conflict role-inline-warning" role="alert">برای جلوگیری از دریافت تکراری، ثبت وجه متوقف است؛ مسئول صندوق باید درخواست قبلی و ماندهٔ فعلی را تطبیق دهد.</p>' : ''}
      ${wt?.splitNeedsRefresh ? '<p class="wt-flow__conflict role-inline-warning" role="alert">نتیجهٔ تفکیک نامشخص است؛ دوباره تفکیک نکنید. فاکتورهای این میز را با مدیر شیفت تطبیق دهید؛ عملیات سفارش تا آن زمان قفل است.</p>' : ''}
      ${orderSubmissionConflict ? '<p class="wt-flow__conflict role-inline-warning" role="alert">ارسال و ویرایش سفارش متوقف است؛ سفارش میز را با مدیر شیفت تطبیق دهید.</p>' : ''}
      ${orderSaveNeedsRefresh && !orderSubmissionConflict ? '<p class="wt-flow__conflict role-inline-warning" role="status">نتیجهٔ ذخیره مشخص نیست؛ وضعیت تازهٔ سرور را بررسی کنید.</p>' : ''}
      ${wt?.remoteUpdatePending ? '<div class="wt-flow__conflict" role="alert"><span>این سفارش در دستگاه دیگری تغییر کرده؛ پیش‌نویس فعلی حفظ شده است.</span><button type="button" id="wt-load-latest-order">بررسی و بارگذاری نسخهٔ تازه</button></div>' : ''}
    </section>`;
  }

  function waiterCallsForTable(table) {
    const tableId = table?.id;
    const tDigits = String(tableId || '').replace(/\D/g, '');
    const tNum = tDigits ? Number(tDigits) : null;
    const tLabel = String(table?.label || '').trim();
    return (state.data.calls || []).filter((call) => {
      if (!['open', 'new'].includes(String(call.status || 'open'))) return false;
      const callNo = String(call.tableNo || '').trim();
      const callDigits = callNo.replace(/\D/g, '');
      const callNum = callDigits ? Number(callDigits) : null;
      return (tNum !== null && callNum === tNum)
        || (callDigits && callDigits === tDigits)
        || callNo === tLabel
        || callNo === `میز ${tDigits}`
        || callNo === `میز ${tNum}`
        || callNo === tDigits;
    });
  }

  function waiterTableContext(table) {
    const orders = (state.data.orders || []).filter((order) => orderIsOpen(order) && tableNoBelongsToTable(order.tableNo, table.id));
    const calls = waiterCallsForTable(table);
    const readyOrders = orders.filter((order) => order.status === 'ready');
    const stateName = calls.length ? 'attention' : orders.length ? 'busy' : (table.state || 'available');
    const stateText = calls.length
      ? `${num(calls.length)} فراخوان`
      : readyOrders.length
        ? `${num(readyOrders.length)} آماده تحویل`
        : orders.length
          ? `${num(orders.length)} فاکتور باز`
          : (table.stateLabel || ({ available: 'آزاد', reserved: 'رزرو', busy: 'در سرویس', attention: 'نیازمند رسیدگی' })[stateName] || stateName);
    return { orders, calls, readyOrders, state: stateName, stateLabel: stateText };
  }

  function waiterUnmappedOrders(orders = state.data.orders || []) {
    return orders.filter((order) => order.fulfillment === 'dine_in'
      && orderIsOpen(order)
      && !waiterOrderHasMappedTable(order));
  }

  function waiterOrderHasMappedTable(order) {
    return (state.data.floor?.tables || []).some((table) =>
      table.active !== false && tableNoBelongsToTable(order?.tableNo, table.id));
  }

  function waiterAvailableAssignmentTables() {
    return (state.data.floor?.tables || []).filter((table) => {
      if (table.active === false || ['reserved', 'busy', 'attention'].includes(String(table.state || ''))) return false;
      const context = waiterTableContext(table);
      return context.state === 'available' && context.orders.length === 0 && context.calls.length === 0;
    });
  }

  function waiterFloorModeStorageKey() {
    return window.matchMedia?.('(max-width: 768px)').matches
      ? 'westo_waiter_floor_mode_mobile_v2'
      : 'westo_waiter_floor_mode_desktop';
  }

  function orderCanEdit(order) {
    return Boolean(order && !order.startedAt && order.paymentMethod !== 'online' && ['pay_at_cashier', 'awaiting_confirmation', 'sent_to_kitchen', 'paid'].includes(String(order.status || '')));
  }

  function waiterHasCapability(capability) {
    const capabilities = state.session?.workspace?.capabilities;
    return Array.isArray(capabilities) && (capabilities.includes('*') || capabilities.includes(capability));
  }

  function tableNoBelongsToTable(tableNo, tableId) {
    const canonical = (value) => normalizeDigits(value).trim().replace(/^میز\s*/u, '').replace(/\s+/g, '');
    const actual = canonical(tableNo);
    const target = canonical(tableId);
    return Boolean(actual && target && (actual === target || actual.startsWith(`${target}-`)));
  }

  function waiterOrderResponseMatchesIntent(order, intent = {}) {
    const expectedOrderId = Number(intent.orderId);
    const expectedBranchId = Number(intent.branchId);
    const expectedTableNo = normalizeDigits(String(intent.tableId ?? '')).trim().replace(/^میز\s*/u, '').replace(/\s+/g, '');
    const actualTableNo = normalizeDigits(String(order?.tableNo ?? '')).trim().replace(/^میز\s*/u, '').replace(/\s+/g, '');
    const tableMatches = intent.exactTableNo === true
      ? Boolean(expectedTableNo && actualTableNo === expectedTableNo)
      : tableNoBelongsToTable(order?.tableNo, intent.tableId);

    return Boolean(order
      && Number.isSafeInteger(expectedOrderId) && expectedOrderId > 0
      && Number(order.id) === expectedOrderId
      && Number.isSafeInteger(expectedBranchId) && expectedBranchId > 0
      && Number(order.branchId) === expectedBranchId
      && String(order.fulfillment || '').trim().toLowerCase() === 'dine_in'
      && expectedTableNo && actualTableNo && tableMatches);
  }

  function posCheckEditable(check = state.posCheck) {
    return Boolean(check && (!check.orderId || check.editable));
  }

  function posCheckFromOrder(order) {
    const editable = orderCanEdit(order);
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      fulfillment: order.fulfillment || 'pickup',
      tableNo: order.tableNo || '',
      customerName: order.name || '',
      phone: order.phone || '',
      note: order.note || '',
      sent: ['sent_to_kitchen', 'paid', 'preparing', 'ready'].includes(order.status),
      paymentStatus: orderPaymentStatus(order),
      paymentTender: order.paymentTender || '',
      amountPaid: Number(order.amountPaid || 0),
      total: Number(order.total || 0),
      discount: Number(order.discount || 0),
      discountRate: Number(order.discountRate || 0),
      createdAt: order.createdAt || '',
      paidAt: order.paidAt || '',
      status: order.status,
      editable,
      startedAt: order.startedAt || null,
      lines: (order.items || []).map((line, index) => ({
        localId: `saved-${order.id}-${index}`,
        menuItemId: line.menuItemId,
        name: line.name,
        price: Number(line.price || 0),
        qty: Number(line.qty || 1),
        modifiers: Array.isArray(line.modifiers) ? line.modifiers : [],
        complements: Array.isArray(line.complements) ? line.complements : [],
        note: line.note || '',
        seat: Number(line.seat || 0),
        locked: !editable,
      })),
    };
  }

  function startPosCheck(fulfillment, tableNo = '') {
    state.posCheck = {
      orderId: null,
      fulfillment,
      tableNo: fulfillment === 'dine_in' ? String(tableNo) : '',
      customerName: '', phone: '', note: '', sent: false, paymentStatus: 'unpaid', status: 'draft', lines: [],
    };
    const pending = state.pendingPosItem;
    state.pendingPosItem = null;
    state.posSearch = '';
    dialog.close();
    state.activeView = 'menu';
    paintNav();
    cashierMenu();
    if (pending) {
      quickAddPosItem(pending.id);
    }
  }

  function floorCountdownLabel(endsAt) {
    const seconds = Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 1000));
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    const twoDigits = (value) => Number(value).toLocaleString('fa-IR', { minimumIntegerDigits: 2, useGrouping: false });
    return `زمان میز ${twoDigits(minutes)}:${twoDigits(remainder)}`;
  }

  const DEFAULT_TABLE_COORDINATES = [
    { id: 1, x: 18, y: 25, shape: 'circle', seats: 2, rotation: 0, zone: 'سالن' },
    { id: 2, x: 36, y: 25, shape: 'circle', seats: 2, rotation: 0, zone: 'سالن' },
    { id: 3, x: 18, y: 52, shape: 'circle', seats: 2, rotation: 0, zone: 'سالن' },
    { id: 4, x: 36, y: 52, shape: 'circle', seats: 2, rotation: 0, zone: 'سالن' },
    { id: 14, x: 18, y: 80, shape: 'rectangle', seats: 4, rotation: 0, zone: 'سالن' },
    { id: 15, x: 36, y: 80, shape: 'rectangle', seats: 4, rotation: 0, zone: 'سالن' },
    { id: 5, x: 60, y: 25, shape: 'rectangle', seats: 4, rotation: 0, zone: 'تراس' },
    { id: 6, x: 82, y: 25, shape: 'rectangle', seats: 4, rotation: 0, zone: 'تراس' },
    { id: 7, x: 60, y: 52, shape: 'rectangle', seats: 4, rotation: 0, zone: 'تراس' },
    { id: 8, x: 82, y: 52, shape: 'rectangle', seats: 4, rotation: 0, zone: 'تراس' },
    { id: 9, x: 60, y: 75, shape: 'booth', seats: 6, rotation: 0, zone: 'ویژه' },
    { id: 10, x: 82, y: 75, shape: 'booth', seats: 6, rotation: 0, zone: 'ویژه' },
    { id: 11, x: 60, y: 86, shape: 'booth', seats: 6, rotation: 0, zone: 'ویژه' },
    { id: 12, x: 82, y: 86, shape: 'booth', seats: 6, rotation: 0, zone: 'ویژه' },
  ];

  function ensureTableGeometry(table, index) {
    if (typeof table.x !== 'number' || typeof table.y !== 'number') {
      const match = DEFAULT_TABLE_COORDINATES.find((d) => String(d.id) === String(table.id));
      if (match) {
        table.x = match.x;
        table.y = match.y;
        table.shape = table.shape || match.shape;
        table.rotation = table.rotation ?? match.rotation;
      } else {
        table.x = ((index % 4) * 22) + 16;
        table.y = (Math.floor(index / 4) * 26) + 24;
        table.shape = table.shape || (Number(table.seats) <= 2 ? 'circle' : Number(table.seats) >= 6 ? 'booth' : 'rectangle');
        table.rotation = table.rotation || 0;
      }
    }
    table.shape = table.shape || (Number(table.seats) <= 2 ? 'circle' : Number(table.seats) >= 6 ? 'booth' : 'rectangle');
    table.rotation = Number(table.rotation) || 0;
    table.seats = Number(table.seats) || 4;
  }

  function getComputedTableCoords(table) {
    return { x: table.x ?? 50, y: table.y ?? 50 };
  }

  function renderPlanTable(table, options = {}) {
    const isSelected = String(state.selectedTableId) === String(table.id);
    const isInactive = table.active === false;
    const isUnavailableToWaiter = Boolean(options.disableInactive && isInactive && !options.isEditMode);
    const shape = table.shape || 'rectangle';
    const seats = Number(table.seats) || 4;
    const coords = getComputedTableCoords(table, options.zone || 'all');
    const chairModel = table.chairModel || (shape === 'bar_stool' || shape === 'wall_counter' ? 'bar_stool' : shape === 'lounge_takht' ? 'bolster' : 'standard');
    const chairClass = 'plan-chair' + (
      chairModel === 'armchair' ? ' plan-chair--armchair' :
      chairModel === 'bar_stool' ? ' plan-chair--stool' :
      chairModel === 'booth_bench' ? ' plan-chair--bench' :
      chairModel === 'bolster' ? ' plan-chair--bolster' : ''
    );
    let chairsHtml = '';

    if (shape === 'circle') {
      const count = Math.min(16, Math.max(1, seats));
      for (let i = 0; i < count; i++) {
        const angle = (2 * Math.PI / count) * i - (Math.PI / 2);
        const radius = 54;
        const left = 50 + radius * Math.cos(angle);
        const top = 50 + radius * Math.sin(angle);
        const deg = (angle * 180 / Math.PI) + 90;
        chairsHtml += `<div class="${chairClass}" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%;transform:translate(-50%,-50%) rotate(${deg.toFixed(1)}deg);width:26px;height:10px;border-radius:5px"></div>`;
      }
    } else if (shape === 'conference') {
      const hasHead = seats >= 4;
      const sideSeats = hasHead ? Math.max(2, seats - 2) : seats;
      const topCount = Math.ceil(sideSeats / 2);
      const bottomCount = sideSeats - topCount;
      for (let i = 0; i < topCount; i++) {
        const xPos = topCount === 1 ? 50 : 18 + (i * (64 / (topCount - 1)));
        chairsHtml += `<div class="${chairClass}" style="top:-14px;left:${xPos.toFixed(1)}%;transform:translateX(-50%);width:26px;height:10px;border-radius:6px 6px 3px 3px"></div>`;
      }
      for (let i = 0; i < bottomCount; i++) {
        const xPos = bottomCount === 1 ? 50 : 18 + (i * (64 / (bottomCount - 1)));
        chairsHtml += `<div class="${chairClass}" style="bottom:-14px;left:${xPos.toFixed(1)}%;transform:translateX(-50%);width:26px;height:10px;border-radius:3px 3px 6px 6px"></div>`;
      }
      if (hasHead) {
        chairsHtml += `<div class="${chairClass}" style="right:-15px;top:50%;transform:translateY(-50%) rotate(90deg);width:26px;height:10px;border-radius:6px 6px 3px 3px"></div>`;
        chairsHtml += `<div class="${chairClass}" style="left:-15px;top:50%;transform:translateY(-50%) rotate(-90deg);width:26px;height:10px;border-radius:6px 6px 3px 3px"></div>`;
      }
    } else if (shape === 'semi_circle') {
      chairsHtml += `<div class="plan-semicircle-cushion"></div>`;
      const count = Math.min(16, Math.max(1, seats));
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0.5 : i / (count - 1);
        const angle = Math.PI * (0.12 + 0.76 * t);
        const radius = 54;
        const left = 50 + radius * Math.cos(angle);
        const top = 50 + radius * Math.sin(angle);
        const deg = (angle * 180 / Math.PI) + 90;
        chairsHtml += `<div class="${chairClass}" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%;transform:translate(-50%,-50%) rotate(${deg.toFixed(1)}deg);width:26px;height:10px;border-radius:5px"></div>`;
      }
    } else if (shape === 'wall_counter') {
      for (let i = 0; i < seats; i++) {
        const offset = seats === 1 ? 50 : 12 + (i * (76 / (seats - 1)));
        chairsHtml += `<div class="${chairClass} plan-chair--stool" style="bottom:-15px;left:${offset.toFixed(1)}%;transform:translateX(-50%);width:20px;height:18px;border-radius:50%"></div>`;
      }
    } else if (shape === 'round_booth') {
      chairsHtml = `<div class="plan-roundbooth-cushion"></div>`;
      const count = Math.min(12, Math.max(1, seats));
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0.5 : i / (count - 1);
        const angle = (Math.PI * 0.25) + (t * Math.PI * 1.5);
        const radius = 56;
        const left = 50 + radius * Math.cos(angle);
        const top = 50 + radius * Math.sin(angle);
        const deg = (angle * 180 / Math.PI) + 90;
        chairsHtml += `<div class="${chairClass}" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%;transform:translate(-50%,-50%) rotate(${deg.toFixed(1)}deg);width:24px;height:10px;border-radius:5px"></div>`;
      }
    } else if (shape === 'square') {
      const perSide = Math.max(1, Math.ceil(seats / 4));
      let placed = 0;
      for (let i = 0; i < perSide && placed < seats; i++, placed++) {
        const offset = perSide === 1 ? 50 : 18 + (i * (64 / (perSide - 1)));
        chairsHtml += `<div class="${chairClass}" style="top:-13px;left:${offset}%;transform:translateX(-50%);width:22px;height:9px;border-radius:5px 5px 2px 2px"></div>`;
      }
      for (let i = 0; i < perSide && placed < seats; i++, placed++) {
        const offset = perSide === 1 ? 50 : 18 + (i * (64 / (perSide - 1)));
        chairsHtml += `<div class="${chairClass}" style="bottom:-13px;left:${offset}%;transform:translateX(-50%);width:22px;height:9px;border-radius:2px 2px 5px 5px"></div>`;
      }
      for (let i = 0; i < perSide && placed < seats; i++, placed++) {
        const offset = perSide === 1 ? 50 : 18 + (i * (64 / (perSide - 1)));
        chairsHtml += `<div class="${chairClass}" style="right:-13px;top:${offset}%;transform:translateY(-50%);width:9px;height:22px;border-radius:2px 5px 5px 2px"></div>`;
      }
      for (let i = 0; i < perSide && placed < seats; i++, placed++) {
        const offset = perSide === 1 ? 50 : 18 + (i * (64 / (perSide - 1)));
        chairsHtml += `<div class="${chairClass}" style="left:-13px;top:${offset}%;transform:translateY(-50%);width:9px;height:22px;border-radius:5px 2px 2px 5px"></div>`;
      }
    } else if (shape === 'booth') {
      chairsHtml = `
        <div class="plan-booth-cushion plan-booth-cushion--top"></div>
        <div class="plan-booth-cushion plan-booth-cushion--bottom"></div>
      `;
    } else if (shape === 'bar_stool') {
      for (let i = 0; i < seats; i++) {
        const offset = seats === 1 ? 50 : 18 + (i * (64 / (seats - 1)));
        chairsHtml += `<div class="${chairClass} plan-chair--stool" style="bottom:-16px;left:${offset}%;transform:translateX(-50%);width:18px;height:18px;border-radius:50%"></div>`;
      }
    } else if (shape === 'oval') {
      const count = Math.min(16, Math.max(1, seats));
      for (let i = 0; i < count; i++) {
        const angle = (2 * Math.PI / count) * i - (Math.PI / 2);
        const rx = 56;
        const ry = 46;
        const left = 50 + rx * Math.cos(angle);
        const top = 50 + ry * Math.sin(angle);
        const deg = (angle * 180 / Math.PI) + 90;
        chairsHtml += `<div class="${chairClass}" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%;transform:translate(-50%,-50%) rotate(${deg.toFixed(1)}deg);width:24px;height:10px;border-radius:5px"></div>`;
      }
    } else if (shape === 'lounge_takht') {
      chairsHtml = `
        <div class="plan-takht-rug"></div>
        <div class="plan-takht-cushion plan-takht-cushion--n" title="پشتی سنتی"></div>
        <div class="plan-takht-cushion plan-takht-cushion--s" title="پشتی سنتی"></div>
        <div class="plan-takht-cushion plan-takht-cushion--e" title="پشتی سنتی"></div>
        <div class="plan-takht-cushion plan-takht-cushion--w" title="پشتی سنتی"></div>
      `;
    } else {
      if (seats <= 2) {
        chairsHtml += `<div class="${chairClass}" style="top:-14px;left:50%;transform:translateX(-50%);width:34px;height:10px;border-radius:6px 6px 3px 3px"></div>`;
        if (seats === 2) {
          chairsHtml += `<div class="${chairClass}" style="bottom:-14px;left:50%;transform:translateX(-50%);width:34px;height:10px;border-radius:3px 3px 6px 6px"></div>`;
        }
      } else {
        const half = Math.ceil(seats / 2);
        const otherHalf = seats - half;
        for (let i = 0; i < half; i++) {
          const xPos = half === 1 ? 50 : 16 + (i * (68 / (half - 1)));
          chairsHtml += `<div class="${chairClass}" style="top:-14px;left:${xPos.toFixed(1)}%;transform:translateX(-50%);width:26px;height:10px;border-radius:6px 6px 3px 3px"></div>`;
        }
        for (let i = 0; i < otherHalf; i++) {
          const xPos = otherHalf === 1 ? 50 : 16 + (i * (68 / (otherHalf - 1)));
          chairsHtml += `<div class="${chairClass}" style="bottom:-14px;left:${xPos.toFixed(1)}%;transform:translateX(-50%);width:26px;height:10px;border-radius:3px 3px 6px 6px"></div>`;
        }
      }
    }

    const sharedSeatLayout = window.WestoFloorChairLayout?.layout({ shape, seats, chairModel, chairScale: table.chairScale });
    if (sharedSeatLayout) chairsHtml = sharedSeatLayout.markup;

    const timerHtml = table.serviceEndsAt && !table.autoReleased && ['busy', 'attention'].includes(table.state)
      ? `<time class="plan-table-timer" data-service-ends="${esc(table.serviceEndsAt)}">${floorCountdownLabel(table.serviceEndsAt)}</time>`
      : '';

    const elapsedMinutes = ['busy', 'attention'].includes(table.state) && !table.autoReleased
      ? Math.max(1, Math.round((Date.now() - new Date(table.occupiedAt || table.serviceStartedAt || (table.serviceEndsAt ? new Date(table.serviceEndsAt).getTime() - 45 * 60 * 1000 : Date.now() - 25 * 60 * 1000)).getTime()) / 60000))
      : 0;
    const elapsedBadgeHtml = elapsedMinutes > 0
      ? `<span class="plan-table-elapsed" title="مدت زمان حضور">⏱️ ${num(elapsedMinutes)} دقیقه</span>`
      : '';

    const isMergedParent = table.mergedWith && Array.isArray(table.mergedWith) && table.mergedWith.length > 0;
    const isMergedSub = Boolean(table.mergedInto);
    let mergeBadgeHtml = '';
    if (isMergedParent) {
      mergeBadgeHtml = `<span class="plan-table-merge-badge" title="میز ادغام‌شده">🔗 ادغام (${num(table.mergedWith.length + 1)})</span>`;
    } else if (isMergedSub) {
      mergeBadgeHtml = `<span class="plan-table-merge-badge is-sub" title="متصل به میز ${esc(table.mergedInto)}">🔗 پیوند</span>`;
    }

    const shapeLabel = {
      rectangle: '⬛ مستطیل',
      conference: '🏛️ کنفرانس',
      semi_circle: '🌙 نیم‌دایره',
      wall_counter: '🪟 پیشخوان دیواری',
      circle: '⭕ گرد',
      square: '⏹️ مربع',
      booth: '🛋️ نیمکت',
      round_booth: '🛋️ مبل گرد',
      bar_stool: '🍸 صندلی بار',
      oval: '🥚 بیضی',
      lounge_takht: '🛏️ تخت سنتی',
    }[shape] || '⬛ مستطیل';

    const paletteHtml = state.waiterFloorEditing && isSelected && options.allowEdit ? `
      <div class="table-floating-palette" data-palette-for="${table.id}">
        <button type="button" data-table-action="rotate" title="چرخش ۴۵ درجه">↻ ۴۵°</button>
        <button type="button" data-table-action="toggle-shape" title="تغییر فرم">${shapeLabel}</button>
        <div style="display:flex;align-items:center;gap:3px">
          <button type="button" data-table-action="dec-seats" title="کاهش صندلی">-</button>
          <span style="padding:0 4px;font-size:11px;font-weight:900">${num(seats)}ص</span>
          <button type="button" data-table-action="inc-seats" title="افزایش صندلی">+</button>
        </div>
        <select data-table-action="zone-select" title="بخش سالن">
          <option value="سالن" ${table.zone === 'سالن' ? 'selected' : ''}>سالن</option>
          <option value="تراس" ${table.zone === 'تراس' ? 'selected' : ''}>تراس</option>
          <option value="ویژه" ${table.zone === 'ویژه' || table.zone === 'VIP' ? 'selected' : ''}>ویژه</option>
        </select>
        <button type="button" data-table-action="rename" title="تغییر نام">✏️</button>
      </div>` : '';

    const dataAttr = typeof options.attr === 'function' ? options.attr(table) : `data-table="${esc(table.id)}"`;

    const tableState = isInactive ? 'inactive' : (table.state || 'available');
    const tableLabel = table.label || `میز ${table.id}`;

    return `
      <div class="plan-table plan-table--${esc(shape)} ${isSelected ? 'is-selected' : ''} ${isMergedParent ? 'is-merged-parent' : ''} ${isMergedSub ? 'is-merged-sub' : ''} ${isUnavailableToWaiter ? 'is-inactive' : ''}"
           ${dataAttr}
           role="button"
           tabindex="${isUnavailableToWaiter ? '-1' : '0'}"
           aria-disabled="${isUnavailableToWaiter ? 'true' : 'false'}"
           data-state="${esc(tableState)}"
           data-seats="${seats}"
           ${table.autoReleased ? 'data-auto-released="true"' : ''}
           style="left:${coords.x}%; top:${coords.y}%; transform: translate(-50%, -50%) rotate(${table.rotation || 0}deg); --table-rot: ${table.rotation || 0}deg;"
           title="${esc(tableLabel)} — ${esc(isInactive ? 'غیرفعال؛ برای سفارش از میز فعال استفاده کنید' : (table.stateLabel || 'آزاد'))}"
           aria-label="${esc(tableLabel)} — ${esc(isInactive ? 'غیرفعال؛ برای سفارش از میز فعال استفاده کنید' : (table.stateLabel || 'آزاد'))}، ${num(seats)} نفر">
        ${chairsHtml}
        <div class="plan-table-surface">
          <span class="plan-table-number">${esc(table.label || `میز ${table.id}`)}</span>
          <span class="plan-table-meta">${num(seats)} نفر · ${esc(normalizeRoleFloorZoneName(table.zone))}${isInactive ? ' · غیرفعال' : ''}</span>
          ${mergeBadgeHtml}
          ${timerHtml}
          ${elapsedBadgeHtml}
        </div>
        ${paletteHtml}
      </div>`;
  }

  function buildPlanCanvasHtml(visibleTables, activeZone = 'all', options = {}) {
    const isEditMode = Boolean(options.isEditMode);
    const dynamicZones = Array.isArray(state.data.floor?.zones) ? state.data.floor.zones : [];
    const dynamicFixtures = Array.isArray(state.data.floor?.fixtures) ? state.data.floor.fixtures : [];
    const selectedZone = activeZone === 'all' ? 'all' : normalizeRoleFloorZoneName(activeZone);
    const focusedDynamicZones = dynamicZones.filter((zone) => selectedZone === 'all'
      || normalizeRoleFloorZoneName(zone.name) === selectedZone
      || String(zone.id ?? '') === String(activeZone ?? ''));
    const visibleFixtures = selectedZone === 'all' || dynamicZones.length === 0
      ? dynamicFixtures
      : dynamicFixtures.filter((fixture) => focusedDynamicZones.some((zone) => roleFloorFixtureInsideZone(fixture, zone)));
    const bgTheme = state.data.floor?.settings?.bgTheme || 'slate-blueprint';

    // Build zones markup
    let zonesMarkup = '';
    if (dynamicZones.length > 0) {
      zonesMarkup = focusedDynamicZones.map((z) => {
        return `
          <div class="plan-zone plan-zone--dynamic plan-zone--${esc(z.color || 'blue')}"
               style="left:${z.x}%; top:${z.y}%; width:${z.w}%; height:${z.h}%;">
            <span class="plan-zone__tag">${esc(z.icon || '🏷️')} ${esc(z.name)}</span>
          </div>`;
      }).join('');
    } else {
      zonesMarkup = `
        ${(selectedZone === 'all' || selectedZone === 'سالن') ? `<div class="plan-zone plan-zone--main ${selectedZone === 'سالن' ? 'is-full-view' : ''}"><span class="plan-zone__tag">سالن اصلی</span></div>` : ''}
        ${(selectedZone === 'all' || selectedZone === 'تراس') ? `<div class="plan-zone plan-zone--terrace ${selectedZone === 'تراس' ? 'is-full-view' : ''}"><span class="plan-zone__tag">🌿 تراس و فضای باز</span></div>` : ''}
        ${(selectedZone === 'all' || selectedZone === 'ویژه') ? `<div class="plan-zone plan-zone--vip ${selectedZone === 'ویژه' ? 'is-full-view' : ''}"><span class="plan-zone__tag">👑 سالن اختصاصی ویژه</span></div>` : ''}
      `;
    }

    // Build fixtures markup
    const fixturesMarkup = dynamicFixtures.length > 0 ? `
        <div class="plan-fixtures-layer">
          ${visibleFixtures.map((f) => `
            <div class="plan-fixture plan-fixture--${esc(f.type)} plan-fixture--${esc(f.color || 'slate')}"
                 data-fixture-id="${esc(f.id)}"
                 style="left:${f.x}%; top:${f.y}%; width:${f.w}%; height:${f.h}%; transform: rotate(${f.rotation || 0}deg);"
                 title="${esc(f.name || f.type)}">
              <div class="plan-fixture-content">
                <span class="plan-fixture-icon">${esc(f.icon || '🏛️')}</span>
                <span class="plan-fixture-label">${esc(f.name || '')}</span>
              </div>
            </div>
          `).join('')}
        </div>`
      : '';

    // Build SVG connectors for merged tables
    let svgConnectors = '';
    const mergedParents = visibleTables.filter((t) => t.mergedWith && Array.isArray(t.mergedWith) && t.mergedWith.length > 0);
    if (mergedParents.length > 0) {
      const lines = [];
      mergedParents.forEach((parent) => {
        const px = Number(parent.x) || 50;
        const py = Number(parent.y) || 50;
        parent.mergedWith.forEach((subId) => {
          const sub = visibleTables.find((t) => Number(t.id) === Number(subId));
          if (sub) {
            const sx = Number(sub.x) || 50;
            const sy = Number(sub.y) || 50;
            lines.push(`<line x1="${px}%" y1="${py}%" x2="${sx}%" y2="${sy}%" stroke="#38bdf8" stroke-width="2.5" stroke-dasharray="4 3" stroke-linecap="round" opacity="0.8" class="plan-table-connector-line" />`);
          }
        });
      });
      if (lines.length > 0) {
        svgConnectors = `<svg class="floor-canvas-connectors" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2">${lines.join('')}</svg>`;
      }
    }

    const canvasId = options.id || 'floor-canvas';

    return `
      <div class="architectural-canvas-wrap ${isEditMode ? 'is-edit-mode' : ''} ${options.extraClass || ''} floor-theme--${bgTheme}" id="${canvasId}">
        ${isEditMode ? `
          <div class="floor-canvas-indicator">
            <span class="pulse-dot"></span>
            <span>حالت چیدمان فعال است — میزها را با کشیدن و رها کردن تنظیم کنید</span>
          </div>` : ''}

        <!-- Scalable Architectural Stage (preserves aspect ratio & prevents table collisions) -->
        <div class="floor-canvas-stage" id="${canvasId}-stage">
          <!-- Architectural Zones -->
          ${zonesMarkup}

          <!-- SVG Connectors -->
          ${svgConnectors}

          <!-- Architectural Fixtures -->
          ${fixturesMarkup}

          <!-- Rendered Tables -->
          <div class="plan-tables-layer" id="${options.tablesLayerId || 'plan-tables-layer'}">
            ${visibleTables.map((t) => renderPlanTable(t, { ...options, zone: activeZone })).join('')}
          </div>
        </div>

        <!-- Floating Zoom & Fit Controls -->
        <div class="floor-canvas-controls" id="${canvasId}-controls" role="toolbar" aria-label="کنترل نقشه سالن">
          <button type="button" class="floor-ctl-btn" data-canvas-action="zoom-in" title="بزرگ‌نمایی" aria-label="بزرگ‌نمایی">＋</button>
          <button type="button" class="floor-ctl-btn" data-canvas-action="zoom-out" title="کوچک‌نمایی" aria-label="کوچک‌نمایی">－</button>
          <button type="button" class="floor-ctl-btn floor-ctl-btn--fit" data-canvas-action="zoom-fit" title="نمای کامل سالن">⛶ تناسب</button>
          <button type="button" class="floor-ctl-btn" data-canvas-action="zoom-actual" title="اندازه واقعی">۱:۱</button>
        </div>

        <!-- Floating in-canvas legend -->
        <div class="floor-canvas-legend">
          <span class="leg-item"><i class="leg-dot leg-dot--avail"></i> آزاد</span>
          <span class="leg-item"><i class="leg-dot leg-dot--busy"></i> در سرویس</span>
          <span class="leg-item"><i class="leg-dot leg-dot--attn"></i> فراخوان</span>
          <span class="leg-item"><i class="leg-dot leg-dot--res"></i> رزرو</span>
        </div>
      </div>`;
  }

  function setupFloorCanvasPanZoom(canvasId, options = {}) {
    const viewport = document.getElementById(canvasId);
    if (!viewport) return null;
    const stage = document.getElementById(`${canvasId}-stage`);
    if (!stage) return null;

    const BASE_W = 880;
    const BASE_H = 640;

    let currentScale = 1;
    let panX = 0;
    let panY = 0;
    let isFitMode = false;
    let isPanning = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let initialPanX = 0;
    let initialPanY = 0;
    let hasMoved = false;

    function applyTransform(animate = false) {
      stage.style.transition = animate ? 'transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
      stage.style.transform = `translate(${Math.round(panX * 10) / 10}px, ${Math.round(panY * 10) / 10}px) scale(${Math.round(currentScale * 1000) / 1000})`;
      if (currentScale < 0.72) {
        viewport.classList.add('is-compact-overview');
      } else {
        viewport.classList.remove('is-compact-overview');
      }
    }

    function fitToScreen(animate = true) {
      isFitMode = true;
      const rect = viewport.getBoundingClientRect();
      const vw = Math.max(280, rect.width || viewport.clientWidth || 360);
      const vh = Math.max(300, rect.height || viewport.clientHeight || 560);
      const fitScale = Math.min((vw - 12) / BASE_W, (vh - 12) / BASE_H);
      currentScale = Math.max(0.25, Math.min(1.4, fitScale));
      panX = (vw - BASE_W * currentScale) / 2;
      panY = (vh - BASE_H * currentScale) / 2;
      applyTransform(animate);
    }

    function zoomTo(newScale, focalX, focalY) {
      isFitMode = false;
      const clampedScale = Math.max(0.3, Math.min(2.2, newScale));
      const rect = viewport.getBoundingClientRect();
      const fx = typeof focalX === 'number' ? focalX : (rect.width || 360) / 2;
      const fy = typeof focalY === 'number' ? focalY : (rect.height || 560) / 2;
      panX = fx - (fx - panX) * (clampedScale / currentScale);
      panY = fy - (fy - panY) * (clampedScale / currentScale);
      currentScale = clampedScale;
      applyTransform(true);
    }

    function focusZone(zoneName) {
      if (!zoneName || zoneName === 'all') {
        fitToScreen(true);
        return;
      }
      const zones = state.data?.floor?.zones || [];
      const z = zones.find((item) => item.name === zoneName || item.id === zoneName);
      const rect = viewport.getBoundingClientRect();
      const vw = Math.max(280, rect.width || 360);
      const vh = Math.max(300, rect.height || 560);
      if (z) {
        isFitMode = false;
        const zx = (z.x / 100) * BASE_W;
        const zy = (z.y / 100) * BASE_H;
        const zw = Math.max(100, (z.w / 100) * BASE_W);
        const zh = Math.max(100, (z.h / 100) * BASE_H);
        const zcx = zx + zw / 2;
        const zcy = zy + zh / 2;
        const targetScale = Math.max(0.65, Math.min(1.35, Math.min((vw * 0.88) / zw, (vh * 0.88) / zh)));
        panX = (vw / 2) - (zcx * targetScale);
        panY = (vh / 2) - (zcy * targetScale);
        currentScale = targetScale;
        applyTransform(true);
      } else {
        fitToScreen(true);
      }
    }

    let activePointerId = null;
    let pinchStartDist = 0;
    let pinchStartScale = 1;

    viewport.addEventListener('pointerdown', (e) => {
      if (state.waiterFloorEditing) return;
      if (e.target.closest('.floor-canvas-controls') || e.target.closest('.floor-canvas-legend')) return;
      // Table presses must keep their original click target so cashier and waiter
      // can open the selected table. Pan from the empty canvas instead.
      if (e.target.closest('.plan-table')) return;
      isPanning = true;
      hasMoved = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      initialPanX = panX;
      initialPanY = panY;
      activePointerId = e.pointerId;
      try { viewport.setPointerCapture(e.pointerId); } catch (_) {}
    });

    viewport.addEventListener('pointermove', (e) => {
      if (!isPanning || e.pointerId !== activePointerId) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (Math.hypot(dx, dy) > 5) {
        hasMoved = true;
        state.canvasDragging = true;
        isFitMode = false;
        panX = initialPanX + dx;
        panY = initialPanY + dy;
        applyTransform(false);
      }
    });

    const endPan = (e) => {
      if (e.pointerId === activePointerId) {
        isPanning = false;
        try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
        activePointerId = null;
        setTimeout(() => { state.canvasDragging = false; }, 80);
      }
    };
    viewport.addEventListener('pointerup', endPan);
    viewport.addEventListener('pointercancel', endPan);

    viewport.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        isPanning = false;
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        pinchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        pinchStartScale = currentScale;
      }
    }, { passive: true });

    viewport.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && pinchStartDist > 0) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const ratio = dist / pinchStartDist;
        const midX = (t1.clientX + t2.clientX) / 2;
        const midY = (t1.clientY + t2.clientY) / 2;
        const rect = viewport.getBoundingClientRect();
        zoomTo(pinchStartScale * ratio, midX - rect.left, midY - rect.top);
      }
    }, { passive: true });

    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const fx = e.clientX - rect.left;
      const fy = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        const delta = -e.deltaY;
        const factor = delta > 0 ? 1.1 : 0.9;
        zoomTo(currentScale * factor, fx, fy);
      } else {
        isFitMode = false;
        panX -= e.deltaX;
        panY -= e.deltaY;
        applyTransform(false);
      }
    }, { passive: false });

    let lastTap = 0;
    viewport.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTap < 300 && !hasMoved && e.changedTouches && e.changedTouches[0]) {
        const rect = viewport.getBoundingClientRect();
        const touch = e.changedTouches[0];
        if (currentScale < 0.85) {
          zoomTo(1.15, touch.clientX - rect.left, touch.clientY - rect.top);
        } else {
          fitToScreen(true);
        }
      }
      lastTap = now;
    });

    const controls = document.getElementById(`${canvasId}-controls`);
    if (controls) {
      controls.querySelectorAll('[data-canvas-action]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = btn.dataset.canvasAction;
          const rect = viewport.getBoundingClientRect();
          const vw = rect.width || 360;
          const vh = rect.height || 560;
          if (action === 'zoom-in') zoomTo(currentScale * 1.25, vw / 2, vh / 2);
          else if (action === 'zoom-out') zoomTo(currentScale / 1.25, vw / 2, vh / 2);
          else if (action === 'zoom-fit') fitToScreen(true);
          else if (action === 'zoom-actual') zoomTo(1.0, vw / 2, vh / 2);
        });
      });
    }

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        if (isFitMode) fitToScreen(false);
      });
      ro.observe(viewport);
    }

    if (options.activeZone && options.activeZone !== 'all') {
      focusZone(options.activeZone);
    } else {
      fitToScreen(false);
    }

    return { fitToScreen, zoomTo, focusZone };
  }

  function openNewCheck() {
    const tables = state.data.floor?.tables || [];
    tables.forEach(ensureTableGeometry);
    openDialog('صندوق فروش · سفارش جدید', 'نوع سفارش را انتخاب کنید', `
      <div class="pos-order-types">
        <button type="button" data-pos-type="dine_in"><span>داخل مجموعه</span><small>انتخاب میز و ارسال به آشپزخانه</small><b>←</b></button>
        <button type="button" data-pos-type="pickup"><span>بیرون‌بر</span><small>ثبت سفارش پیشخوان یا تحویل حضوری</small><b>←</b></button>
      </div><div id="pos-table-picker" hidden></div>`);
    dialogBody.querySelectorAll('[data-pos-type]').forEach((button) => button.addEventListener('click', () => {
      if (button.dataset.posType === 'pickup') return startPosCheck('pickup');
      const picker = document.getElementById('pos-table-picker');
      picker.hidden = false;
      dialogBody.querySelector('.pos-order-types').hidden = true;
      const activeTables = tables.filter((table) => table.active !== false);
      activeTables.forEach(ensureTableGeometry);
      state.posPickerZone = state.posPickerZone || 'all';
      if (state.posPickerZone !== 'all') state.posPickerZone = normalizeRoleFloorZoneName(state.posPickerZone);
      state.posPickerMode = state.posPickerMode || 'plan';

      const zones = ['all', ...new Set(activeTables.map((table) => normalizeRoleFloorZoneName(table.zone)))];

      const paintTables = () => {
        const visibleTables = state.posPickerZone === 'all'
          ? activeTables
          : activeTables.filter((table) => normalizeRoleFloorZoneName(table.zone) === state.posPickerZone);

        const freeCount = activeTables.filter((t) => t.state === 'available' || !t.state).length;
        const busyCount = activeTables.filter((t) => t.state === 'busy').length;
        const attnCount = activeTables.filter((t) => t.state === 'attention').length;

        picker.innerHTML = `
          <div class="pos-dialog-title pos-dialog-title--plan">
            <div class="pos-dialog-title__start">
              <button type="button" id="pos-back-order-type" class="btn btn-sm btn-ghost">← نوع سفارش</button>
              <div>
                <strong style="font-size:15px;font-weight:900">پلان سالن و انتخاب میز</strong>
                <small style="display:block;color:var(--rp-muted);font-size:11px">برای باز کردن فاکتور یا شروع سفارش، روی میز لمس کنید</small>
              </div>
            </div>
            <div class="pos-dialog-title__actions">
              <div class="floor-segmented" role="tablist">
                <button type="button" class="floor-segmented__btn ${state.posPickerMode === 'plan' ? 'active' : ''}" id="picker-view-plan">
                  📐 پلان ۲D
                </button>
                <button type="button" class="floor-segmented__btn ${state.posPickerMode === 'grid' ? 'active' : ''}" id="picker-view-grid">
                  ▦ کارت‌ها
                </button>
              </div>
              <div class="floor-zone-pills">
                ${zones.map((z) => `<button type="button" class="floor-zone-pill ${state.posPickerZone === z ? 'active' : ''}" data-picker-zone="${esc(z)}"><span>${esc(z === 'all' ? 'همه بخش‌ها' : z)}</span><small>${num(z === 'all' ? activeTables.length : activeTables.filter((table) => normalizeRoleFloorZoneName(table.zone) === z).length)}</small></button>`).join('')}
              </div>
              <div class="pos-picker-stats">
                <span class="leg-item"><i class="leg-dot leg-dot--avail"></i> ${num(freeCount)} آزاد</span>
                <span class="leg-item"><i class="leg-dot leg-dot--busy"></i> ${num(busyCount)} در سرویس</span>
                ${attnCount ? `<span class="leg-item" style="color:#e11d48"><i class="leg-dot leg-dot--attn"></i> ${num(attnCount)} فراخوان</span>` : ''}
              </div>
            </div>
          </div>

          <div class="pos-plan-viewport">
            ${state.posPickerMode === 'plan' ? buildPlanCanvasHtml(visibleTables, state.posPickerZone, {
              extraClass: 'is-picker-canvas',
              id: 'picker-floor-canvas',
              tablesLayerId: 'picker-tables-layer',
              allowEdit: false,
              attr: (t) => `data-pos-table="${esc(t.id)}"`
            }) : `
              <div class="floor-grid" style="overflow-y:auto;flex:1;min-height:0;padding:8px">
                ${visibleTables.map((table) => `
                  <button type="button" class="floor-table" data-pos-table="${esc(table.id)}" data-state="${esc(table.state)}" ${table.autoReleased ? 'data-auto-released="true"' : ''}>
                    <strong>${esc(table.label || `میز ${table.id}`)}</strong>
                    <small>${num(table.seats)} نفر · ${esc(normalizeRoleFloorZoneName(table.zone))}</small>
                    <span>${esc(table.stateLabel || 'آزاد')}</span>
                    ${table.serviceEndsAt && !table.autoReleased && ['busy', 'attention'].includes(table.state) ? `<time class="plan-table-timer" data-service-ends="${esc(table.serviceEndsAt)}" style="margin-top:6px;display:inline-block">${floorCountdownLabel(table.serviceEndsAt)}</time>` : ''}
                  </button>`).join('') || empty('میزی در این بخش یافت نشد.')}
              </div>
            `}
          </div>
        `;

        picker.querySelector('#pos-back-order-type').addEventListener('click', () => {
          picker.hidden = true;
          dialogBody.querySelector('.pos-order-types').hidden = false;
        });

        picker.querySelector('#picker-view-plan')?.addEventListener('click', () => {
          state.posPickerMode = 'plan';
          paintTables();
        });
        picker.querySelector('#picker-view-grid')?.addEventListener('click', () => {
          state.posPickerMode = 'grid';
          paintTables();
        });

        picker.querySelectorAll('[data-picker-zone]').forEach((btn) => btn.addEventListener('click', () => {
          state.posPickerZone = btn.dataset.pickerZone;
          paintTables();
        }));

        picker.querySelectorAll('[data-pos-table]').forEach((tableButton) => tableButton.addEventListener('click', () => {
          if (state.canvasDragging) return;
          const tableId = tableButton.dataset.posTable;
          const table = tables.find((item) => String(item.id) === String(tableId));
          const openOrder = !table?.autoReleased && (state.data.orders || []).find((order) => orderIsOpen(order) && String(order.tableNo) === String(tableId) && (!table?.serviceOrderId || Number(order.id) === Number(table.serviceOrderId)));
          if (openOrder) {
            state.pendingPosItem = null;
            state.posCheck = posCheckFromOrder(openOrder);
            dialog.close();
            state.activeView = 'menu';
            paintNav();
            cashierMenu();
            showToast(`فاکتور فعال ${table?.label || `میز ${tableId}`} باز شد.`);
          } else {
            startPosCheck('dine_in', tableId);
          }
        }));

        if (state.posPickerMode === 'plan') {
          setupFloorCanvasPanZoom('picker-floor-canvas', { activeZone: state.posPickerZone });
        }
      };
      paintTables();
    }));
  }


  function posLocationLabel(check) {
    if (!check) return 'سفارش جدید';
    if (check.fulfillment === 'dine_in') return `میز ${check.tableNo}`;
    return 'بیرون‌بر';
  }

  function isItemOutOfStock(item) {
    if (!item) return false;
    if (item.available === false) return true;
    if (item.inventoryAvailable === false) return true;
    if (item.capacity !== null && item.capacity !== undefined && Number(item.capacity) <= 0) return true;
    return false;
  }

  function resolveUnifiedCategories(knownCategories = [], items = []) {
    const validCategoryIds = new Set((knownCategories || []).map((c) => Number(c.id)));
    const categories = (knownCategories || []).map((cat) => {
      const catItems = (items || []).filter((item) => Number(item.categoryId) === Number(cat.id));
      const availableItems = catItems.filter((item) => !isItemOutOfStock(item));
      return {
        ...cat,
        id: cat.id,
        title: cat.title || cat.name1 || cat.name || 'دسته',
        name1: cat.name1 || cat.title || 'دسته',
        coverImg: cat.coverImg || '',
        totalCount: catItems.length,
        availableCount: availableItems.length,
      };
    });
    const orphanItems = (items || []).filter((item) => !validCategoryIds.has(Number(item.categoryId)));
    if (orphanItems.length && !categories.some((c) => String(c.id) === 'other')) {
      const orphanAvailable = orphanItems.filter((item) => !isItemOutOfStock(item));
      categories.push({
        id: 'other',
        title: 'سایر اقلام',
        name1: 'سایر اقلام',
        coverImg: '',
        totalCount: orphanItems.length,
        availableCount: orphanAvailable.length,
      });
    }
    return { categories, validCategoryIds, orphanItems };
  }

  function posCategoryMarkup() {
    const { categories, validCategoryIds, orphanItems } = resolveUnifiedCategories(state.menuCategories, state.menuItems);

    const query = state.posSearch.trim();
    const normalizedQuery = query.toLowerCase();
    if (!query && !state.posCategory) {
      const catCards = categories.map((category, index) => {
        const count = category.totalCount;
        return `<button type="button" class="pos-category-card" data-pos-category="${category.id}" style="--pos-category-index:${index}">${category.coverImg ? `<img src="${esc(category.coverImg)}" alt="" onerror="this.style.display='none'" />` : '<span class="pos-category-card__placeholder" aria-hidden="true">و</span>'}<span class="pos-category-card__content"><b>${esc(category.title || category.name1 || 'دسته')}</b><small>${num(count)} محصول</small></span><i aria-hidden="true">←</i></button>`;
      }).join('');
      return `<div class="pos-category-deck">${catCards}</div>`;
    }

    const isAll = state.posCategory === 'all';
    const isOther = state.posCategory === 'other';
    const category = categories.find((entry) => String(entry.id) === String(state.posCategory));
    const matchedItems = state.menuItems.filter((item) => {
      const matchesQuery = !query || `${item.name} ${item.en || ''}`.toLowerCase().includes(normalizedQuery);
      if (!matchesQuery) return false;
      if (query || isAll) return true;
      if (isOther) return !validCategoryIds.has(Number(item.categoryId));
      return Number(item.categoryId) === Number(state.posCategory);
    });

    const items = matchedItems;
    const columns = items.length > 15 ? 5 : items.length > 8 ? 3 : 2;
    const rows = Math.max(1, Math.ceil(items.length / columns));
    const mobileColumns = items.length > 15 ? 5 : columns;
    const mobileRows = Math.max(1, Math.ceil(items.length / mobileColumns));
    const density = items.length > 15 ? 'dense' : items.length > 8 ? 'medium' : 'relaxed';
    const searchHint = query && matchedItems.length > 0 ? `<div class="pos-search-hint">${num(matchedItems.length)} نتیجه جست‌وجو</div>` : '';
    const catTitle = isAll ? 'کل منو' : (category?.title || category?.name1 || 'منو');
    const path = query
      ? `<div class="pos-menu-path"><button type="button" id="pos-clear-search">→ پاک‌کردن جست‌وجو</button><div><b>نتایج جست‌وجو</b><span>${num(matchedItems.length)} نتیجه</span></div></div>`
      : `<div class="pos-menu-path"><button type="button" id="pos-back-categories">→ همه دسته‌ها</button><div><b>${esc(catTitle)}</b><span>${num(matchedItems.length)} محصول</span></div></div>`;

    return `${path}${searchHint}<div class="pos-product-grid" data-density="${density}" style="--pos-cols:${columns};--pos-rows:${rows};--pos-grid-max:${rows * 118}px;--pos-mobile-cols:${mobileColumns};--pos-mobile-rows:${mobileRows};--pos-mobile-grid-max:${mobileRows * 82}px">${items.map((item) => {
      const outOfStock = isItemOutOfStock(item);
      const stockBadge = outOfStock
        ? `<small class="pos-stock-badge is-out">ناموجود</small>`
        : (item.capacity !== null && item.capacity !== undefined && item.capacity < 15)
          ? `<small class="pos-stock-badge is-low">${num(item.capacity)} عدد</small>`
          : '';
      const cardClass = outOfStock ? 'pos-product-card is-out-of-stock' : 'pos-product-card';
      const addText = outOfStock ? 'ناموجود' : '+ افزودن';
      return `<article class="${cardClass}"><button type="button" class="pos-product-card__add" data-pos-quick-add="${item.id}" ${outOfStock ? 'data-out-of-stock="true"' : ''}>${item.img ? `<img src="${esc(item.img)}" alt="" onerror="this.style.display='none'" />` : '<span class="pos-product-card__placeholder" aria-hidden="true">و</span>'}<span class="pos-product-card__info"><b>${esc(item.name)}</b>${stockBadge}<small>${money(item.price)}</small><span>${addText}</span></span></button></article>`;
    }).join('') || empty('محصولی در این دسته پیدا نشد.')}</div>`;
  }

  function posCheckMarkup() {
    const check = state.posCheck;
    if (!check) return `<aside class="pos-check pos-check--empty"><div class="pos-check__head"><b>فاکتور</b></div>${empty('برای شروع، یک سفارش جدید باز کنید.')}<button class="pos-pay" id="pos-empty-new">+ سفارش جدید</button></aside>`;
    const lines = check.lines || [];
    const editable = posCheckEditable(check);
    const paymentStatus = orderPaymentStatus(check);
    const statusText = paymentStatus === 'partial' ? 'نیازمند تکمیل پرداخت' : (check.sent ? statusLabel(check.status) : 'ثبت‌نشده');
    const paymentNeedsReview = !['unpaid', 'partial'].includes(paymentStatus);
    const submitLabel = !check.orderId ? 'ارسال به آشپزخانه' : editable ? 'ذخیره تغییرات سفارش' : 'ویرایش پس از شروع آشپزخانه قفل است';
    const subtotal = posSubtotal(check);
    const discountAmount = posDiscount(check);
    const finalTotal = posTotal(check);
    const discountRate = Number(check.discountRate || 0);

    return `<aside class="pos-check">
      <div class="pos-check__title"><div><strong>${esc(posLocationLabel(check))}</strong><small>${check.orderNo ? `${esc(check.orderNo)}${editable && check.orderId ? ' · قابل ویرایش تا شروع آشپزخانه' : ''}` : 'فاکتور جدید'}</small></div><span class="pos-status ${check.sent ? 'is-sent' : ''}">${esc(statusText)}</span></div>
      <div class="pos-check__tabs"><button class="active" type="button">فاکتور</button><button type="button" id="pos-actions-tab">عملیات</button><button type="button" id="pos-guest-tab">مهمان</button></div>
      <div class="pos-lines">${lines.map((line) => posInvoiceRows(line)).join('') || empty('هنوز محصولی به فاکتور اضافه نشده است.')}</div>
      <div class="pos-discount-strip">
        <span style="color:var(--rp-muted);font-weight:700;">تخفیف:</span>
        <button type="button" class="pos-discount-chip ${discountRate === 0 && !discountAmount ? 'is-active' : ''}" data-discount-rate="0">۰٪</button>
        <button type="button" class="pos-discount-chip ${discountRate === 5 ? 'is-active' : ''}" data-discount-rate="5">۵٪</button>
        <button type="button" class="pos-discount-chip ${discountRate === 10 ? 'is-active' : ''}" data-discount-rate="10">۱۰٪</button>
        <button type="button" class="pos-discount-chip ${discountRate === 15 ? 'is-active' : ''}" data-discount-rate="15">۱۵٪</button>
      </div>
      <div class="pos-totals">
        <div><span>جمع جزء</span><b>${money(subtotal)}</b></div>
        ${discountAmount > 0 ? `<div class="is-discount" style="color:#f43f5e"><span>تخفیف${discountRate ? ` (${num(discountRate)}٪)` : ''}</span><b>- ${money(discountAmount)}</b></div>` : ''}
        <div class="is-total"><span>مبلغ نهایی</span><strong>${money(finalTotal)}</strong></div>
      </div>
      ${paymentNeedsReview ? `<div class="role-inline-warning" role="alert"><b>وضعیت پرداخت: ${esc(orderPaymentStatusLabel(check))}</b><span>برای جلوگیری از دریافت دوباره، پرداخت تازه غیرفعال است؛ سفارش را در صف صندوق تطبیق کنید.</span></div>` : ''}
      <div class="pos-check__buttons">
        <button type="button" class="pos-ghost" id="pos-print" ${check.orderId ? '' : 'disabled'}>چاپ</button>
        <button type="button" class="pos-ghost" id="pos-preview-btn" ${check.orderId || lines.length ? '' : 'disabled'}>پیش‌نمایش</button>
        <button type="button" class="pos-pay" id="pos-pay" ${lines.length && !paymentNeedsReview ? '' : 'disabled'}>${paymentNeedsReview ? 'نیازمند تطبیق' : 'پرداخت'}</button>
      </div>
      <button type="button" class="pos-send ${check.orderId && editable ? 'is-edit-save' : ''}" id="pos-send" ${!lines.length || (check.orderId && !editable) ? 'disabled' : ''}>${submitLabel}</button>
    </aside>`;
  }

  function posInvoiceRows(line) {
    const locked = Boolean(line.locked);
    const product = `<article class="pos-line pos-line--product"><button type="button" class="pos-line__edit" data-pos-line="${esc(line.localId)}" ${locked ? 'disabled' : ''}><div><b>${esc(line.name)}</b>${(line.modifiers || []).length ? `<small>${line.modifiers.map((modifier) => esc(modifier.name)).join('، ')}</small>` : ''}${line.note ? `<small>یادداشت: ${esc(line.note)}</small>` : ''}</div><span>${money(posBaseLineTotal(line))}</span></button><div class="pos-line__qty" aria-label="تعداد ${esc(line.name)}"><button type="button" data-pos-line-delta="-1" data-pos-line-id="${esc(line.localId)}" ${locked ? 'disabled' : ''}>−</button><b>${num(line.qty)}</b><button type="button" data-pos-line-delta="1" data-pos-line-id="${esc(line.localId)}" ${locked ? 'disabled' : ''}>+</button></div></article>`;
    const complements = (line.complements || []).map((complement, index) => {
      const qty = Math.max(1, Number(complement.qty || 1));
      return `<article class="pos-line pos-line--complement" data-complement-row="${esc(line.localId)}-${index}"><div class="pos-line__complement"><div><span class="pos-line__complement-tag">مکمل</span><b>${esc(complement.name)}</b><small>همراه ${esc(line.name)}</small></div><span>${money(Number(complement.price || 0) * Number(complement.qty || 1))}</span></div><div class="pos-line__qty" aria-label="تعداد ${esc(complement.name)}"><button type="button" data-pos-complement-delta="-1" data-pos-line-id="${esc(line.localId)}" data-pos-complement-index="${index}" ${locked ? 'disabled' : ''}>−</button><b>${num(qty)}</b><button type="button" data-pos-complement-delta="1" data-pos-line-id="${esc(line.localId)}" data-pos-complement-index="${index}" ${locked ? 'disabled' : ''}>+</button></div></article>`;
    }).join('');
    return product + complements;
  }

  function wirePos() {
    main.querySelector('#pos-new-check')?.addEventListener('click', openNewCheck);
    main.querySelector('#pos-empty-new')?.addEventListener('click', openNewCheck);
    main.querySelector('#pos-search')?.addEventListener('input', (event) => {
      const value = event.target.value;
      state.posSearch = value;
      cashierMenu();
      const input = main.querySelector('#pos-search');
      input?.focus();
      input?.setSelectionRange(value.length, value.length);
    });
    main.querySelector('#pos-back-categories')?.addEventListener('click', () => { state.posCategory = null; state.posSearch = ''; cashierMenu(); });
    main.querySelector('#pos-clear-search')?.addEventListener('click', () => { state.posSearch = ''; cashierMenu(); });
    main.querySelectorAll('[data-pos-category]').forEach((button) => button.addEventListener('click', () => {
      const cat = button.dataset.posCategory;
      state.posCategory = (cat === 'all' || cat === 'other') ? cat : Number(cat);
      state.posSearch = '';
      cashierMenu();
    }));
    main.querySelectorAll('[data-pos-quick-add]').forEach((button) => button.addEventListener('click', () => requestPosItem(Number(button.dataset.posQuickAdd))));
    main.querySelectorAll('[data-pos-line]').forEach((button) => button.addEventListener('click', () => openModifierEditor(null, button.dataset.posLine)));
    main.querySelectorAll('[data-pos-line-delta]').forEach((button) => button.addEventListener('click', () => {
      if (!posCheckEditable()) return;
      const line = state.posCheck.lines.find((entry) => String(entry.localId) === String(button.dataset.posLineId));
      if (!line) return;
      line.qty = Number(line.qty || 1) + Number(button.dataset.posLineDelta);
      if (line.qty <= 0) state.posCheck.lines = state.posCheck.lines.filter((entry) => entry.localId !== line.localId);
      cashierMenu();
    }));
    main.querySelectorAll('[data-pos-complement-delta]').forEach((button) => button.addEventListener('click', () => {
      if (!posCheckEditable()) return;
      const line = state.posCheck.lines.find((entry) => String(entry.localId) === String(button.dataset.posLineId));
      const index = Number(button.dataset.posComplementIndex);
      const complement = line?.complements?.[index];
      if (!complement) return;
      const next = Number(complement.qty || 1) + Number(button.dataset.posComplementDelta);
      if (next <= 0) line.complements.splice(index, 1);
      else complement.qty = Math.min(20, next);
      cashierMenu();
    }));
    main.querySelector('#pos-actions-tab')?.addEventListener('click', openPosActions);
    main.querySelector('#pos-guest-tab')?.addEventListener('click', openPosGuest);
    main.querySelector('#pos-printer-settings')?.addEventListener('click', openPrinterSettings);
    main.querySelectorAll('[data-discount-rate]').forEach((button) => button.addEventListener('click', () => {
      if (!state.posCheck || !posCheckEditable()) return;
      const rate = Number(button.dataset.discountRate) || 0;
      state.posCheck.discountRate = rate;
      state.posCheck.discount = Math.round(posSubtotal(state.posCheck) * rate / 100);
      cashierMenu();
    }));
    main.querySelector('#pos-preview-btn')?.addEventListener('click', () => {
      if (state.posCheck) openThermalReceiptPreview(state.posCheck);
    });
    main.querySelector('#pos-send')?.addEventListener('click', (event) => {
      if (state.posCheck?.orderId) return action(event.currentTarget, () => saveEditedPosOrder(), 'تغییرات سفارش ذخیره و برای آشپزخانه به‌روزرسانی شد.');
      return action(event.currentTarget, async () => { await createPosOrder(true); state.posCheck = null; state.activeView = 'floor'; paintNav(); }, 'سفارش با جزئیات کامل به آشپزخانه ارسال شد.');
    });
    main.querySelector('#pos-pay')?.addEventListener('click', async () => { try { const order = await createPosOrder(false); openPayment(order); } catch (error) { showToast(error.message, 'error'); } });
    main.querySelector('#pos-print')?.addEventListener('click', (event) => action(event.currentTarget, () => printOrder(state.posCheck), 'رسید مستقیماً به پرینتر صندوق ارسال شد.'));
  }

  function cashierMenu() {
    document.body.classList.add('is-pos-station');
    main.innerHTML = `<section class="pos-shell"><div class="pos-catalog"><header class="pos-toolbar"><div><span>منوی وستو</span><strong>منوی سریع</strong></div><label><span aria-hidden="true">⌕</span><input id="pos-search" value="${esc(state.posSearch)}" placeholder="جست‌وجوی منو" /></label><div class="pos-toolbar__actions"><button type="button" class="pos-ghost" id="pos-printer-settings">پرینتر</button><button type="button" id="pos-new-check">+ سفارش جدید</button></div></header><div class="pos-catalog__body">${posCategoryMarkup()}</div></div>${posCheckMarkup()}</section>`;
    wirePos();
  }

  function requestPosItem(menuItemId) {
    const item = state.menuItems.find((entry) => Number(entry.id) === Number(menuItemId));
    if (item && isItemOutOfStock(item)) return showToast(`«${item.name}» در حال حاضر ناموجود است.`, 'warning');
    if (!state.posCheck) {
      state.pendingPosItem = { id: menuItemId };
      openNewCheck();
      return;
    }
    if (!posCheckEditable()) return showToast('آشپزخانه آماده‌سازی را شروع کرده؛ ویرایش قفل است.', 'error');
    quickAddPosItem(menuItemId);
  }

  function quickAddPosItem(menuItemId) {
    const item = state.menuItems.find((entry) => Number(entry.id) === Number(menuItemId));
    if (!item || !posCheckEditable()) return;
    if (isItemOutOfStock(item)) return showToast(`«${item.name}» در حال حاضر ناموجود است.`, 'warning');
    const existing = state.posCheck.lines.find((line) => Number(line.menuItemId) === Number(menuItemId) && !(line.modifiers || []).length && !line.note && !line.seat);
    if (existing) existing.qty = Math.min(99, Number(existing.qty || 1) + 1);
    else state.posCheck.lines.push({ localId: `line-${Date.now()}-${Math.random().toString(16).slice(2)}`, menuItemId: Number(item.id), name: item.name, price: Number(item.price || 0), qty: 1, modifiers: [], complements: [], note: '', seat: 0 });
    const line = existing || state.posCheck.lines[state.posCheck.lines.length - 1];
    cashierMenu();
    const rules = state.menuComplementRules.filter((rule) => rule.active !== false && ((rule.sourceItemIds || []).map(Number).includes(Number(item.id)) || (rule.sourceCategoryIds || []).map(Number).includes(Number(item.categoryId))));
    const allowedIds = new Set(rules.flatMap((rule) => rule.complementIds || []).map(Number));
    const options = state.menuComplements.filter((entry) => allowedIds.has(Number(entry.id)) && entry.available !== false);
    if (options.length) openComplementLayer(item, line, rules, options);
  }

  function openComplementLayer(item, line, rules, options) {
    const prompt = rules.map((rule) => rule.prompt).find(Boolean) || 'مکملی برای این سفارش اضافه شود؟';
    const selected = new Map();
    openDialog('پیشنهاد هوشمند', `مکمل ${item.name}`, `<div class="pos-complement-layer"><div class="pos-complement-intro"><span>محصول به فاکتور اضافه شد</span><strong>${esc(prompt)}</strong><small>انتخاب اختیاری است و مکمل زیر همین محصول ثبت می‌شود.</small></div><div class="pos-complement-grid">${options.map((entry) => `<article class="pos-complement-card" data-complement-card="${entry.id}">${entry.img ? `<img src="${esc(entry.img)}" alt="" />` : '<span class="pos-complement-card__placeholder">و</span>'}<div><b>${esc(entry.name)}</b><small>${money(entry.price)}</small></div><button type="button" data-complement-add="${entry.id}" aria-label="افزودن ${esc(entry.name)}">+</button><div class="pos-complement-qty" hidden><button type="button" data-complement-delta="-1" data-complement-id="${entry.id}">−</button><b data-complement-count="${entry.id}">۰</b><button type="button" data-complement-delta="1" data-complement-id="${entry.id}">+</button></div></article>`).join('')}</div><footer><button type="button" class="pos-complement-skip" id="pos-complement-skip">ادامه بدون مکمل</button><button type="button" class="pos-pay" id="pos-complement-save" disabled>یک مکمل انتخاب کنید</button></footer></div>`);
    const paint = () => {
      let count = 0;
      for (const option of options) {
        const qty = selected.get(Number(option.id)) || 0;
        count += qty;
        const card = dialogBody.querySelector(`[data-complement-card="${option.id}"]`);
        card?.classList.toggle('is-selected', qty > 0);
        const add = card?.querySelector('[data-complement-add]');
        const controls = card?.querySelector('.pos-complement-qty');
        if (add) add.hidden = qty > 0;
        if (controls) controls.hidden = qty === 0;
        const counter = card?.querySelector(`[data-complement-count="${option.id}"]`);
        if (counter) counter.textContent = num(qty);
      }
      const saveButton = document.getElementById('pos-complement-save');
      saveButton.disabled = count === 0;
      saveButton.textContent = count ? `افزودن ${num(count)} مکمل و ادامه` : 'یک مکمل انتخاب کنید';
    };
    dialogBody.querySelectorAll('[data-complement-add]').forEach((button) => button.addEventListener('click', () => { selected.set(Number(button.dataset.complementAdd), 1); paint(); }));
    dialogBody.querySelectorAll('[data-complement-delta]').forEach((button) => button.addEventListener('click', () => {
      const id = Number(button.dataset.complementId);
      const next = Math.max(0, Math.min(20, (selected.get(id) || 0) + Number(button.dataset.complementDelta)));
      if (next) selected.set(id, next); else selected.delete(id);
      paint();
    }));
    document.getElementById('pos-complement-skip').addEventListener('click', () => dialog.close());
    document.getElementById('pos-complement-save').addEventListener('click', () => {
      const current = new Map((line.complements || []).map((entry) => [Number(entry.id || entry.complementId), { ...entry }]));
      for (const [id, qty] of selected) {
        const option = options.find((entry) => Number(entry.id) === id);
        if (!option) continue;
        const previous = current.get(id);
        current.set(id, { id, complementId: id, name: option.name, price: Number(option.price || 0), img: option.img || '', qty: Math.min(20, Number(previous?.qty || 0) + qty) });
      }
      line.complements = [...current.values()];
      dialog.close();
      cashierMenu();
    });
    paint();
  }

  function openModifierEditor(menuItemId, localId = '') {
    if (!state.posCheck) return openNewCheck();
    if (!posCheckEditable()) return showToast('آشپزخانه آماده‌سازی را شروع کرده؛ ویرایش قفل است.', 'error');
    const existing = localId ? state.posCheck.lines.find((line) => String(line.localId) === String(localId)) : null;
    const item = state.menuItems.find((entry) => Number(entry.id) === Number(existing?.menuItemId || menuItemId)) || existing;
    if (!item) return;
    const modifierGroups = menuModifierGroupsForItem(item);
    const selected = new Set((existing?.modifiers || []).flatMap((modifier) => {
      const groupId = String(modifier.groupId || '');
      const values = [];
      if (groupId && modifier.id != null) values.push(`${groupId}:${modifier.id}`);
      if (groupId && modifier.name) values.push(`${groupId}:name:${modifier.name}`);
      if (!groupId && modifier.name) values.push(`legacy-name:${modifier.name}`);
      return values;
    }));
    const groupsHtml = modifierGroups.length
      ? modifierGroups.map((group) => {
        const minimum = modifierGroupMinimum(group);
        const maximum = modifierGroupMaximum(group);
        return `<div class="modifier-group" data-modifier-group-card="${esc(group.id)}"><h3>${esc(group.title)} <small>${group.selection === 'single' ? 'یک انتخاب' : 'چند انتخاب'}${minimum ? ' · الزامی' : ''}</small></h3><p>${minimum ? `حداقل ${num(minimum)} مورد · ` : ''}حداکثر ${num(maximum)} مورد</p><div>${(group.options || []).filter((option) => option.available !== false).map((option) => `<label><input type="${group.selection === 'single' ? 'radio' : 'checkbox'}" name="modifier-group-${esc(group.id)}" data-modifier-group="${esc(group.id)}" data-modifier-option="${esc(option.id)}" ${selected.has(`${group.id}:${option.id}`) || selected.has(`${group.id}:name:${option.name}`) || selected.has(`legacy-name:${option.name}`) ? 'checked' : ''}/><span>${esc(option.name)}</span><small>${option.price ? `+ ${money(option.price)}` : 'بدون هزینه'}</small></label>`).join('')}</div></div>`;
      }).join('')
      : '<div class="modifier-empty">برای این غذا ترجیحی تعریف نشده است.</div>';
    openDialog('ویرایش محصول', item.name, `<div class="modifier-layout"><section><div class="modifier-base"><span>قیمت پایه</span><b>${money(item.price)}</b></div><p class="modifier-context-note">ترجیحات مخصوص همین غذا</p>${groupsHtml}</section><aside><label class="field"><span>یادداشت محصول</span><textarea id="modifier-note" rows="3" maxlength="180">${esc(existing?.note || '')}</textarea></label><div class="quick-prep-tags"><button type="button" class="quick-prep-tag" data-prep-tag="کم‌شکر">کم‌شکر</button><button type="button" class="quick-prep-tag" data-prep-tag="داغ">داغ</button><button type="button" class="quick-prep-tag" data-prep-tag="بدون یخ">بدون یخ</button><button type="button" class="quick-prep-tag" data-prep-tag="بدون پیاز">بدون پیاز</button><button type="button" class="quick-prep-tag" data-prep-tag="تند">تند</button><button type="button" class="quick-prep-tag" data-prep-tag="جداگانه">جداگانه</button><button type="button" class="quick-prep-tag" data-prep-tag="بسته‌بندی بیرون‌بر">بسته‌بندی بیرون‌بر</button></div><label class="field"><span>شماره صندلی (اختیاری)</span><input id="modifier-seat" type="number" min="0" max="99" value="${Number(existing?.seat || 0)}" /></label><div class="modifier-qty"><button type="button" data-mod-qty="-1">−</button><b id="modifier-qty">${num(existing?.qty || 1)}</b><button type="button" data-mod-qty="1">+</button></div><button type="button" class="pos-pay" id="modifier-save">${existing ? 'ذخیره تغییرات' : 'افزودن به فاکتور'}</button>${existing ? '<button type="button" class="role-danger" id="modifier-remove">حذف از سفارش</button>' : ''}</aside></div>`);
    let qty = Number(existing?.qty || 1);
    dialogBody.querySelectorAll('[data-mod-qty]').forEach((button) => button.addEventListener('click', () => { qty = Math.max(1, Math.min(99, qty + Number(button.dataset.modQty))); document.getElementById('modifier-qty').textContent = num(qty); }));
    dialogBody.querySelectorAll('[data-prep-tag]').forEach((tagBtn) => {
      const tag = tagBtn.dataset.prepTag;
      const noteEl = document.getElementById('modifier-note');
      if (noteEl && noteEl.value.includes(tag)) tagBtn.classList.add('is-active');
      tagBtn.addEventListener('click', () => {
        if (!noteEl) return;
        let current = noteEl.value.trim();
        if (current.includes(tag)) {
          current = current.replace(new RegExp('(?:،\\s*)?' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '').trim();
          tagBtn.classList.remove('is-active');
        } else {
          current = current ? `${current}، ${tag}` : tag;
          tagBtn.classList.add('is-active');
        }
        noteEl.value = current;
      });
    });
    document.getElementById('modifier-save').addEventListener('click', () => {
      const modifiers = [...dialogBody.querySelectorAll('[data-modifier-option]:checked')]
        .map((input) => modifierOptionForInput(modifierGroups, input))
        .filter(Boolean)
        .map((option) => ({ ...option }));
      const selection = validateMenuModifierChoices(modifierGroups, modifiers);
      if (!selection.ok) {
        const missing = selection.missing[0];
        if (missing) return showToast(`حداقل ${num(modifierGroupMinimum(missing))} گزینه از «${missing.title}» انتخاب کنید`, 'error');
        const exceeded = selection.exceeded[0];
        if (exceeded) return showToast(`حداکثر ${num(modifierGroupMaximum(exceeded))} گزینه از «${exceeded.title}» مجاز است`, 'error');
        return showToast('انتخاب گزینه‌ها معتبر نیست؛ دوباره بررسی کنید.', 'error');
      }
      const line = { localId: existing?.localId || `line-${Date.now()}-${Math.random().toString(16).slice(2)}`, menuItemId: Number(item.menuItemId || item.id), name: item.name, price: Number(item.price || 0), qty, modifiers, complements: existing?.complements || [], note: document.getElementById('modifier-note').value.trim(), seat: Number(document.getElementById('modifier-seat').value) || 0 };
      if (existing) Object.assign(existing, line); else state.posCheck.lines.push(line);
      dialog.close(); cashierMenu();
    });
    document.getElementById('modifier-remove')?.addEventListener('click', () => { state.posCheck.lines = state.posCheck.lines.filter((line) => line.localId !== existing.localId); dialog.close(); cashierMenu(); });
  }

  function openPosActions() {
    const locked = !posCheckEditable();
    openDialog('فاکتور · عملیات', posLocationLabel(state.posCheck), `<div class="pos-action-list"><label class="field"><span>یادداشت کل سفارش</span><textarea id="pos-order-note" rows="4" maxlength="240" ${locked ? 'disabled' : ''}>${esc(state.posCheck?.note || '')}</textarea></label><button type="button" id="pos-save-note" ${locked ? 'disabled' : ''}>ذخیره یادداشت</button><button type="button" id="pos-clear-check" ${state.posCheck?.orderId ? 'disabled' : ''}>پاک‌کردن فاکتور جدید</button>${locked ? '<p class="pos-edit-lock-note">آشپزخانه آماده‌سازی را شروع کرده و ویرایش سفارش متوقف شده است.</p>' : ''}</div>`);
    document.getElementById('pos-save-note').addEventListener('click', () => { state.posCheck.note = document.getElementById('pos-order-note').value.trim(); dialog.close(); cashierMenu(); });
    document.getElementById('pos-clear-check').addEventListener('click', () => { state.posCheck = null; dialog.close(); cashierMenu(); });
  }

  function openPosGuest() {
    const locked = !posCheckEditable();
    openDialog('فاکتور · مهمان', 'مشخصات مهمان', `<div class="field-grid"><label class="field"><span>نام مهمان</span><input id="pos-guest-name" maxlength="100" value="${esc(state.posCheck?.customerName || '')}" ${locked ? 'disabled' : ''}/></label><label class="field"><span>موبایل (اختیاری)</span><input id="pos-guest-phone" inputmode="tel" value="${esc(state.posCheck?.phone || '')}" ${locked ? 'disabled' : ''}/></label></div><button type="button" class="pos-pay" id="pos-save-guest" style="margin-top:16px" ${locked ? 'disabled' : ''}>ذخیره مشخصات</button>`);
    document.getElementById('pos-save-guest').addEventListener('click', () => { state.posCheck.customerName = document.getElementById('pos-guest-name').value.trim(); state.posCheck.phone = normalizeDigits(document.getElementById('pos-guest-phone')?.value || '').trim(); dialog.close(); cashierMenu(); });
  }

  async function createPosOrder(sendToKitchen) {
    if (!state.posCheck?.lines?.length) throw new Error('حداقل یک محصول انتخاب کنید.');
    if (state.posCheck.orderId) return state.posCheck.editable ? saveEditedPosOrder() : ((state.data.orders || []).find((order) => Number(order.id) === Number(state.posCheck.orderId)) || state.posCheck);
    const payload = { branchId: state.branchId, fulfillment: state.posCheck.fulfillment, tableNo: state.posCheck.tableNo, name: state.posCheck.customerName, phone: state.posCheck.phone, note: state.posCheck.note, paymentMethod: 'cashier', sendToKitchen, discount: state.posCheck.discount || 0, items: state.posCheck.lines.map((line) => ({ menuItemId: line.menuItemId, qty: line.qty, modifiers: line.modifiers, complements: (line.complements || []).map((entry) => ({ complementId: Number(entry.id || entry.complementId), qty: Number(entry.qty || 1) })), note: line.note, seat: line.seat })) };
    const requestBody = JSON.stringify(payload);
    if (state.posCheck.createIntent?.body !== requestBody) {
      const nonce = globalThis.crypto?.randomUUID?.()
        || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      state.posCheck.createIntent = { body: requestBody, key: `pos-${nonce}` };
    }
    const data = await api('/api/staff/orders', {
      method: 'POST', headers: { 'Idempotency-Key': state.posCheck.createIntent.key },
      body: requestBody,
    });
    state.posCheck = posCheckFromOrder(data.order);
    state.data.orders.unshift(data.order);
    return data.order;
  }

  function posOrderItemsPayload(check = state.posCheck) {
    return (check?.lines || []).map((line) => ({ menuItemId: line.menuItemId, qty: line.qty, modifiers: line.modifiers, complements: (line.complements || []).map((entry) => ({ complementId: Number(entry.id || entry.complementId), qty: Number(entry.qty || 1) })), note: line.note, seat: line.seat }));
  }

  async function saveEditedPosOrder() {
    const check = state.posCheck;
    if (!check?.orderId || !check.editable) throw new Error('آشپزخانه آماده‌سازی را شروع کرده؛ ویرایش قفل است.');
    if (!check.lines?.length) throw new Error('سفارش باید حداقل یک محصول داشته باشد.');
    const data = await api(`/api/cashier/orders/${check.orderId}`, {
      method: 'PATCH',
      body: JSON.stringify({ branchId: state.branchId, name: check.customerName, phone: check.phone, note: check.note, discount: check.discount || 0, items: posOrderItemsPayload(check) }),
    });
    const index = (state.data.orders || []).findIndex((order) => Number(order.id) === Number(data.order.id));
    if (index >= 0) state.data.orders[index] = data.order;
    state.posCheck = posCheckFromOrder(data.order);
    cashierMenu();
    return data.order;
  }

  function openPayment(order, splitAmount = null) {
    // A previous split may have reached the server even when its response was
    // lost. Never let the POS composer create a different intent until the
    // saved one is replayed or a refreshed order proves it was recorded.
    if (cashierPendingSettlementForOrder(order)) {
      showToast('یک دریافت قبلی هنوز تعیین‌تکلیف نشده است؛ ابتدا همان درخواست را تکرار یا وضعیت را در صف صندوق تازه کنید.', 'warning');
      state.activeView = 'orders';
      paintNav();
      cashierRegister();
      return;
    }
    if (!['unpaid', 'partial'].includes(orderPaymentStatus(order)) || !cashierSettlementStageCanSettle(order)) {
      showToast('این سفارش برای دریافت تازه مجاز نیست؛ وضعیت را در صف تطبیق صندوق بررسی کنید.', 'warning');
      state.activeView = 'orders';
      paintNav();
      cashierRegister();
      return;
    }
    const amounts = cashierSettlementAmounts(order);
    if (!amounts.ok) {
      showToast('سوابق دریافت این فاکتور نیازمند تطبیق است؛ دریافت تازه متوقف شد.', 'error');
      state.activeView = 'orders';
      paintNav();
      cashierRegister();
      return;
    }
    const { total, paid, due: outstanding } = amounts;
    const charge = cashierSplitAmount(splitAmount, outstanding);
    if (charge === null) {
      showToast(`مبلغ انتخابی باید عدد صحیحی بین ۱ و ${money(outstanding)} تومان باشد.`, 'error');
      return;
    }
    ensureCashierSettlementStyles();
    const rounded = Math.ceil(charge / 500000) * 500000 || charge;
    const walletAllowed = cashierWalletSettlementAllowed(paid, charge, outstanding);
    openDialog('پرداخت', `مبلغ ${money(charge)}`, `<div class="payment-sheet">
      <button type="button" class="split-payment" id="split-payment">تقسیم مبلغ</button>
      <div class="payment-total">
        <span>${charge < outstanding ? 'سهم انتخاب‌شده' : 'مبلغ قابل پرداخت'}</span>
        <strong>${money(charge)}</strong>
        <small>${esc(posLocationLabel(state.posCheck))}${paid ? ` · پرداخت‌شده ${money(paid)} · مانده ${money(outstanding)}` : ''}</small>
      </div>
      ${cashierPaymentHistoryMarkup(order, amounts)}

      <!-- Customer loyalty preview; point redemption is kept out of settlement until it can be reserved atomically. -->
      <div class="loyalty-pos-box" style="margin-bottom:0.75rem; background:rgba(255,255,255,0.04); border:1px solid rgba(168,85,247,0.3); border-radius:0.5rem; padding:0.55rem; text-align:right;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.35rem;">
          <span style="font-size:0.8rem; font-weight:700; color:#a855f7;">💎 باشگاه مشتریان</span>
          <span id="pos-loyalty-status" style="font-size:0.72rem; color:var(--text-muted);"></span>
        </div>
        <div style="display:flex; gap:0.4rem; align-items:center;">
          <input id="pos-loyalty-phone" class="input ltr" placeholder="شماره همراه مشتری" value="${esc(order.phone || state.posCheck?.phone || '')}" style="font-size:0.8rem; padding:0.25rem 0.5rem; flex:1;" />
          <button type="button" class="btn btn-sm" id="pos-loyalty-check-btn" style="font-size:0.75rem; padding:0.25rem 0.6rem;">استعلام</button>
        </div>
        <div id="pos-loyalty-details" style="display:none; margin-top:0.45rem; border-top:1px dashed rgba(255,255,255,0.1); padding-top:0.4rem;">
          <div id="pos-loyalty-info" style="font-size:0.75rem; margin-bottom:0.4rem; line-height:1.4;"></div>
          <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
            <button type="button" class="btn btn-sm btn-accent" id="pos-apply-tier-btn" style="font-size:0.72rem; padding:0.2rem 0.5rem;">اعمال تخفیف سطح</button>
          </div>
          <small style="display:block;margin-top:7px;color:var(--text-muted);font-size:12px;line-height:1.6">استفاده از امتیاز تا زمان رزرو امن آن در تسویه فعال نیست.</small>
        </div>
      </div>

      <div class="split-options" id="split-options" hidden>
        <button type="button" data-split="${Math.ceil(outstanding / 2)}">نصف مانده</button>
        <button type="button" data-split="${Math.ceil(outstanding / 3)}">یک‌سوم مانده</button>
        <button type="button" data-split="${Math.ceil(outstanding / 4)}">یک‌چهارم مانده</button>
        <label><span>مبلغ دلخواه</span><input id="split-custom" inputmode="numeric" value="${charge}" /></label>
        <button type="button" id="split-custom-apply">اعمال</button>
      </div>
      <section>
        <h3>نقدی</h3>
        <div class="cash-presets">
          <button type="button" data-pay="cash" data-amount="${charge}">مبلغ دقیق</button>
          <button type="button" data-pay="cash" data-amount="${rounded}">${money(rounded)}</button>
          <button type="button" id="custom-cash">مبلغ دلخواه</button>
        </div>
        <div class="banknote-presets">
          <button type="button" class="banknote-chip" data-banknote="50000">+۵۰k</button>
          <button type="button" class="banknote-chip" data-banknote="100000">+۱۰۰k</button>
          <button type="button" class="banknote-chip" data-banknote="200000">+۲۰۰k</button>
          <button type="button" class="banknote-chip" data-banknote="500000">+۵۰۰k</button>
          <button type="button" class="banknote-chip" data-banknote="1000000">+۱m</button>
        </div>
      </section>
      <div class="payment-methods">
        <button type="button" data-pay="manual_card"><span>کارت بانکی · ثبت دستی</span><small>پس از تأیید موفق کارت‌خوان ثبت کنید؛ دستگاه به سامانه متصل نیست.</small><b>←</b></button>
        ${walletAllowed
          ? '<button type="button" data-pay="wallet"><span>کیف پول مشتری</span><small>کسر مستقیم از مانده کیف پول</small><b>←</b></button>'
          : '<p class="payment-methods__note" role="status">کیف پول فقط برای تسویهٔ کامل در یک مرحله فعال است. برای دریافت ترکیبی، مانده را با نقدی یا کارت بانکیِ ثبت دستی بگیرید.</p>'}
      </div>
      <div id="custom-cash-row" hidden>
        <label class="field"><span>وجه دریافتی</span><input id="cash-received" inputmode="numeric" value="${charge}" /></label>
        <div id="cash-change-calculator" style="margin:8px 0;padding:8px 12px;border-radius:8px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.25);display:flex;justify-content:space-between;align-items:center;">
          <div>
            <span style="font-size:11px;color:var(--text-muted);display:block">باقی‌مانده قابل برگشت</span>
            <strong id="pos-change-display" style="font-size:14px;color:#10b981;">۰ تومان</strong>
          </div>
          <span id="pos-change-badge" style="font-size:11px;padding:2px 8px;border-radius:4px;background:#10b981;color:#fff;font-weight:700;">تسویه کامل</span>
        </div>
        <button type="button" class="pos-pay" id="cash-confirm">ثبت دریافت</button>
      </div>
    </div>`);

    const checkLoyalty = async () => {
      const p = normalizeDigits(document.getElementById('pos-loyalty-phone')?.value || '').trim();
      if (!p) return;
      try {
        const res = await api(`/api/cashier/orders/${order.id}/apply-loyalty`, {
          method: 'POST',
          body: JSON.stringify({ phone: p, redeemPoints: 0, apply: false }),
        });
        const detailsWrap = document.getElementById('pos-loyalty-details');
        const infoEl = document.getElementById('pos-loyalty-info');
        if (detailsWrap && infoEl && res.customer) {
          detailsWrap.style.display = 'block';
          infoEl.innerHTML = `<b>${esc(res.customer.name || 'مشتری')}</b> (سطح ${esc(res.discounts?.tier?.name || 'برنزی')}) | امتیاز: <b>${(res.customer.points || 0).toLocaleString('fa-IR')}</b> | کیف پول: <b>${(res.customer.walletBalance || 0).toLocaleString('fa-IR')} تومان</b>`;
        } else if (detailsWrap) {
          detailsWrap.style.display = 'none';
          document.getElementById('pos-loyalty-status').textContent = 'مشتری یافت نشد';
        }
      } catch (_) {}
    };

    document.getElementById('pos-loyalty-check-btn')?.addEventListener('click', checkLoyalty);
    if (order.phone || state.posCheck?.phone) setTimeout(checkLoyalty, 50);

    document.getElementById('pos-apply-tier-btn')?.addEventListener('click', async () => {
      const p = normalizeDigits(document.getElementById('pos-loyalty-phone')?.value || '').trim();
      const res = await api(`/api/cashier/orders/${order.id}/apply-loyalty`, {
        method: 'POST',
        body: JSON.stringify({ phone: p, apply: true, redeemPoints: 0 }),
      });
      showToast('تخفیف سطح باشگاه روی فاکتور اعمال شد');
      openPayment(res.order);
    });

    dialogBody.querySelectorAll('[data-pay]').forEach((button) => button.addEventListener('click', () => {
      const amountTendered = Number(button.dataset.amount || charge);
      if (button.dataset.pay === 'manual_card') {
        return openManualCardReference(order, charge, (reference, confirmButton) => settlePosOrder(order, 'manual_card', amountTendered, charge, confirmButton, reference));
      }
      settlePosOrder(order, button.dataset.pay, amountTendered, charge, button);
    }));
    document.getElementById('split-payment').addEventListener('click', () => { document.getElementById('split-options').hidden = !document.getElementById('split-options').hidden; });
    dialogBody.querySelectorAll('[data-split]').forEach((button) => button.addEventListener('click', () => openPayment(order, Number(button.dataset.split))));
    document.getElementById('split-custom-apply').addEventListener('click', () => {
      const customAmount = parseCashDrawerInput(document.getElementById('split-custom'));
      if (cashierSplitAmount(customAmount, outstanding) === null) {
        showToast(`مبلغ دلخواه باید عدد صحیحی بین ۱ و ${money(outstanding)} تومان باشد.`, 'error');
        document.getElementById('split-custom')?.focus();
        return;
      }
      openPayment(order, customAmount);
    });
    const cashInput = document.getElementById('cash-received');
    const changeDisplay = document.getElementById('pos-change-display');
    const changeBadge = document.getElementById('pos-change-badge');
    const cashConfirmBtn = document.getElementById('cash-confirm');
    const updateChangeCalc = () => {
      if (!cashInput || !changeDisplay) return;
      const received = parseInputNumber(cashInput.value);
      const diff = received - charge;
      if (diff >= 0) {
        changeDisplay.textContent = money(diff);
        changeDisplay.style.color = '#10b981';
        if (changeBadge) {
          changeBadge.textContent = diff === 0 ? 'مبلغ دقیق' : 'قابل برگشت';
          changeBadge.style.background = '#10b981';
        }
        if (cashConfirmBtn) cashConfirmBtn.disabled = false;
      } else {
        changeDisplay.textContent = `${money(Math.abs(diff))} کسری`;
        changeDisplay.style.color = '#ef4444';
        if (changeBadge) {
          changeBadge.textContent = 'کسری وجه';
          changeBadge.style.background = '#ef4444';
        }
        if (cashConfirmBtn) cashConfirmBtn.disabled = true;
      }
    };
    cashInput?.addEventListener('input', updateChangeCalc);
    dialogBody.querySelectorAll('[data-banknote]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('custom-cash-row').hidden = false;
        const addAmount = Number(btn.dataset.banknote) || 0;
        const current = parseInputNumber(cashInput.value) || 0;
        cashInput.value = (current >= charge ? current : 0) + addAmount;
        updateChangeCalc();
        cashInput.focus();
      });
    });
    document.getElementById('custom-cash').addEventListener('click', () => { document.getElementById('custom-cash-row').hidden = false; document.getElementById('cash-received').focus(); updateChangeCalc(); });
    document.getElementById('cash-confirm').addEventListener('click', (event) => settlePosOrder(order, 'cash', parseInputNumber(document.getElementById('cash-received').value), charge, event.currentTarget));
  }

  async function settlePosOrder(order, tender, amountTendered, paymentAmount, button, paymentReference = '') {
    if (!['unpaid', 'partial'].includes(orderPaymentStatus(order)) || !cashierSettlementStageCanSettle(order)) {
      showToast('وضعیت سفارش اجازهٔ دریافت تازه نمی‌دهد؛ برای تطبیق به صف صندوق بروید.', 'warning');
      state.activeView = 'orders';
      paintNav();
      cashierRegister();
      return false;
    }
    const amounts = cashierSettlementAmounts(order);
    if (!amounts.ok || !Number.isSafeInteger(paymentAmount) || paymentAmount <= 0 || paymentAmount > amounts.due) {
      showToast('مبلغ دریافت با ماندهٔ معتبر فاکتور تطبیق ندارد؛ پرداخت ارسال نشد.', 'error');
      setBusy(button, false);
      return false;
    }
    const normalizedReference = typeof paymentReference === 'string' ? paymentReference.trim() : '';
    if (tender === 'manual_card' && !normalizedReference) {
      showToast('کد پیگیری رسید کارت‌خوان را وارد کنید.', 'error');
      setBusy(button, false);
      return false;
    }
    if (tender === 'cash' && (!Number.isSafeInteger(amountTendered) || amountTendered < paymentAmount)) {
      showToast('وجه دریافتی کمتر از مبلغ این بخش است.', 'error');
      setBusy(button, false);
      return false;
    }
    const intent = {
      orderId: order.id,
      branchId: order.branchId ?? state.branchId,
      tender,
      amountTendered,
      paymentAmount,
      paymentReference: normalizedReference,
      actor: state.session?.user?.phone || '',
      actorRole: state.session?.user?.role || role,
    };
    return submitCashierSettlement(order, intent, button, null, {
      showQueueOnUnknown: true,
      onSuccess: (updatedOrder) => {
        const index = (state.data.orders || []).findIndex((item) => Number(item.id) === Number(updatedOrder.id));
        if (index >= 0) state.data.orders[index] = updatedOrder;
        state.posCheck = posCheckFromOrder(updatedOrder);
        const remaining = Math.max(0, Number(updatedOrder.total || 0) - Number(updatedOrder.amountPaid || 0));
        dialogBody.innerHTML = `<div class="payment-processing"><span class="payment-spinner"></span><h2>${updatedOrder.changeDue ? `باقی‌مانده وجه: ${money(updatedOrder.changeDue)}` : 'پرداخت ثبت شد'}</h2><p>${remaining ? `مانده فاکتور: ${money(remaining)}` : 'فاکتور به‌طور کامل تسویه شد.'}</p></div>`;
        setTimeout(() => remaining ? openPayment(updatedOrder) : openReceipt(updatedOrder), 650);
      },
    });
  }

  function openReceipt(order) {
    document.getElementById('dialog-kicker').textContent = 'پرداخت ثبت شد';
    document.getElementById('dialog-title').textContent = order.changeDue ? `باقی‌مانده ${money(order.changeDue)}` : 'بدون باقی‌مانده';
    dialogBody.innerHTML = `<div class="receipt-sheet"><h2>رسید چگونه تحویل شود؟</h2><div><button type="button" data-receipt="print">چاپ رسید</button><button type="button" data-receipt="preview">پیش‌نمایش فیش</button><button type="button" data-receipt="email">ایمیل</button><button type="button" data-receipt="sms">پیامک</button><button type="button" data-receipt="none">بدون رسید</button></div><div id="receipt-destination" hidden><label class="field"><span id="receipt-label">مقصد</span><input id="receipt-value" /></label><button type="button" class="pos-pay" id="receipt-send">ثبت انتخاب</button></div></div>`;
    let selectedMethod = 'none';
    dialogBody.querySelectorAll('[data-receipt]').forEach((button) => button.addEventListener('click', async () => {
      selectedMethod = button.dataset.receipt;
      if (selectedMethod === 'preview') {
        openThermalReceiptPreview(order);
        return;
      }
      if (selectedMethod === 'email' || selectedMethod === 'sms') {
        document.getElementById('receipt-destination').hidden = false;
        document.getElementById('receipt-label').textContent = selectedMethod === 'email' ? 'ایمیل مهمان' : 'شماره موبایل مهمان';
        document.getElementById('receipt-value').value = selectedMethod === 'email' ? '' : (order.phone || '');
        return;
      }
      await finishReceipt(order, selectedMethod, '');
    }));
    document.getElementById('receipt-send').addEventListener('click', () => finishReceipt(order, selectedMethod, document.getElementById('receipt-value').value));
  }

  function openThermalReceiptPreview(order = state.posCheck) {
    if (!order) return showToast('سفارشی برای نمایش فیش انتخاب نشده است.', 'error');
    const lines = order.lines || order.items || [];
    const total = receiptTotal(order);
    const dateStr = receiptDate(order);
    const locStr = receiptLocation(order);
    const payStr = receiptPayment(order);
    const paymentRows = receiptPaymentRows(order);
    const discount = Number(order.discount || 0);
    const subtotal = lines.reduce((sum, line) => sum + receiptLineTotal(line), 0);
    const orderNumber = esc(order.orderNo || `#${order.id || order.orderId || 'پیش‌فاکتور'}`);

    const linesHtml = lines.map((line) => {
      const lineSum = receiptLineTotal(line);
      const mods = (line.modifiers || []).map((m) => `<div style="font-size:10px;color:#555;padding-right:8px">↳ ${esc(m.name)}</div>`).join('');
      const comps = (line.complements || []).map((c) => `<div style="font-size:10px;color:#555;padding-right:8px">+ ${esc(c.name)} (${num(c.qty || 1)})</div>`).join('');
      return `<tr style="border-bottom:1px dashed #eee;">
        <td style="padding:4px 0;text-align:right;">
          <div style="font-weight:700;">${esc(line.name)}</div>
          ${mods}${comps}
        </td>
        <td style="padding:4px 0;text-align:center;">${num(line.qty || 1)}</td>
        <td style="padding:4px 0;text-align:left;">${money(lineSum)}</td>
      </tr>`;
    }).join('');

    const previewBody = `
      <div class="thermal-receipt-container" style="display:flex;flex-direction:column;align-items:center;">
        <div class="thermal-receipt-sheet" style="width:280px;background:#ffffff;color:#111827;padding:18px 14px;border-radius:4px;box-shadow:0 6px 20px rgba(0,0,0,0.15);font-family:system-ui,monospace;font-size:12px;line-height:1.4;text-align:center;direction:rtl;border:1px solid #e5e7eb;">
          <div style="font-size:18px;font-weight:900;letter-spacing:-0.5px;margin-bottom:2px;">رستوران و کافه وستو</div>
          <div style="font-size:10px;color:#6b7280;margin-bottom:10px;">فیش رسمی صندوق فروش</div>
          <div style="border-top:1px dashed #9ca3af;border-bottom:1px dashed #9ca3af;padding:6px 0;margin-bottom:8px;font-size:11px;text-align:right;display:grid;grid-template-columns:1fr 1fr;gap:2px;">
            <div>شماره: <b>${orderNumber}</b></div>
            <div style="text-align:left;">${locStr}</div>
            <div>تاریخ: <span>${esc(dateStr)}</span></div>
            <div style="text-align:left;">روش پرداخت: <b>${esc(payStr)}</b></div>
          </div>
          <table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:11px;">
            <thead>
              <tr style="border-bottom:1px solid #374151;font-size:10px;color:#4b5563;">
                <th style="text-align:right;padding-bottom:3px;">قلم</th>
                <th style="text-align:center;padding-bottom:3px;width:30px;">تعداد</th>
                <th style="text-align:left;padding-bottom:3px;width:65px;">مبلغ</th>
              </tr>
            </thead>
            <tbody>
              ${linesHtml}
            </tbody>
          </table>
          <div style="border-top:1px dashed #9ca3af;padding-top:6px;font-size:11px;text-align:right;">
            <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
              <span>جمع اقلام:</span>
              <span>${money(subtotal)}</span>
            </div>
            ${discount > 0 ? `<div style="display:flex;justify-content:space-between;color:#dc2626;margin-bottom:2px;"><span>تخفیف:</span><span>- ${money(discount)}</span></div>` : ''}
            <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:900;border-top:1px solid #111827;padding-top:4px;margin-top:4px;">
              <span>مبلغ قابل پرداخت:</span>
              <span>${money(total)}</span>
            </div>
            ${paymentRows.length ? `<div style="border-top:1px dashed #9ca3af;margin-top:6px;padding-top:5px;"><b>ریز دریافت‌ها</b>${paymentRows.map((payment) => `<div style="display:flex;justify-content:space-between;"><span>${esc(payment.label)}</span><span>${money(payment.amount)}</span></div>`).join('')}</div>` : ''}
          </div>
          <div style="margin-top:14px;border-top:1px dashed #d1d5db;padding-top:8px;">
            <div style="letter-spacing:3px;font-family:monospace;font-size:12px;opacity:0.65;">|||| | ||||| || ||||| | |||</div>
            <small style="font-size:9px;color:#6b7280;display:block;margin-top:4px;">از حضور و همراهی شما سپاسگزاریم</small>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:14px;width:100%;max-width:280px;">
          <button type="button" class="role-primary" id="thermal-direct-print" style="flex:1;">چاپ مستقیم فیش</button>
          <button type="button" class="role-secondary" id="thermal-close" style="width:70px;">بستن</button>
        </div>
      </div>
    `;

    openDialog('پیش‌نمایش فیش حرارتی', `عرض ۸۰ میلی‌متر · ${orderNumber}`, previewBody);
    document.getElementById('thermal-close')?.addEventListener('click', () => dialog.close());
    document.getElementById('thermal-direct-print')?.addEventListener('click', async (e) => {
      setBusy(e.currentTarget, true);
      try {
        await printOrder(order);
        showToast('فیش با موفقیت به پرینتر ارسال شد');
        dialog.close();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        setBusy(e.currentTarget, false);
      }
    });
  }

  function receiptLineTotal(line) {
    if (Number.isFinite(Number(line?.lineTotal))) return Number(line.lineTotal);
    const qty = Math.max(1, Number(line?.qty || 1));
    const modifiers = (line?.modifiers || []).reduce((sum, entry) => sum + Number(entry?.price || 0), 0);
    const complements = (line?.complements || []).reduce((sum, entry) => sum + Number(entry?.price || 0) * Math.max(1, Number(entry?.qty || 1)), 0);
    return (Number(line?.price || 0) + modifiers) * qty + complements;
  }

  function receiptTotal(order) {
    const explicit = Number(order?.total);
    if (Number.isFinite(explicit) && explicit >= 0) return explicit;
    return (order?.lines || order?.items || []).reduce((sum, line) => sum + receiptLineTotal(line), 0);
  }

  function receiptLocation(order) {
    if (order?.tableNo) return `میز ${order.tableNo}`;
    if (order?.fulfillment === 'delivery') return 'ارسال با پیک';
    if (order?.fulfillment === 'dine_in') return 'سرو داخل مجموعه';
    return 'بیرون‌بر';
  }

  function receiptPayment(order) {
    const labels = { cash: 'نقدی', card: 'کارت‌خوان', manual_card: 'کارت بانکی · ثبت دستی', gift_card: 'کارت هدیه',
      card_on_file: 'کارت ذخیره‌شده', online: 'پرداخت اینترنتی', wallet: 'کیف پول', cashier: 'صندوق' };
    const tenders = [...new Set((Array.isArray(order?.partialPayments) ? order.partialPayments : [])
      .map((payment) => labels[String(payment?.tender || '')]).filter(Boolean))];
    if (tenders.length) return tenders.join(' + ');
    const label = labels[String(order?.paymentTender || order?.tender || '')];
    return label || (order?.paymentStatus === 'paid' ? 'تسویه‌شده' : 'پیش‌فاکتور');
  }

  function receiptPaymentRows(order) {
    const labels = { cash: 'نقدی', card: 'کارت‌خوان', manual_card: 'کارت بانکی · ثبت دستی', gift_card: 'کارت هدیه',
      card_on_file: 'کارت ذخیره‌شده', online: 'پرداخت اینترنتی', wallet: 'کیف پول' };
    return (Array.isArray(order?.partialPayments) ? order.partialPayments : []).flatMap((payment) => {
      const tender = String(payment?.tender || '');
      const amount = cashierIntegerAmount(payment?.amount);
      return labels[tender] && Number.isSafeInteger(amount) && amount > 0
        ? [{ label: labels[tender], tender, amount }]
        : [];
    });
  }

  function receiptDate(order) {
    const value = order?.paidAt || order?.createdAt;
    if (!value || !Number.isFinite(new Date(value).getTime())) return new Date().toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' });
    return new Date(value).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function bytesToBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  let receiptLogoPromise = null;
  function loadReceiptLogo() {
    if (receiptLogoPromise) return receiptLogoPromise;
    receiptLogoPromise = new Promise((resolve) => {
      const image = new Image();
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), 2500);
      image.onload = () => { clearTimeout(timer); finish(image); };
      image.onerror = () => { clearTimeout(timer); finish(null); };
      image.src = '/assets/images/brand/westo-fa-wordmark-dark.png';
    });
    return receiptLogoPromise;
  }

  function waiterTestReceiptOrder(createdAt = new Date().toISOString()) {
    return {
      orderNo: '', tableNo: '', fulfillment: 'pickup', customerName: '', phone: '',
      paymentStatus: 'unpaid', paymentTender: '', createdAt,
      note: 'برگهٔ آزمایشی است؛ سفارش یا پرداختی ثبت نشده است.',
      total: 2350000,
      lines: [
        { name: 'قلم آزمایشی ۱', qty: 1, price: 940000, lineTotal: 940000, modifiers: [{ name: 'گزینه آزمایشی' }], complements: [] },
        { name: 'قلم آزمایشی ۲', qty: 2, price: 520000, lineTotal: 1040000, modifiers: [], complements: [{ name: 'مکمل آزمایشی', qty: 1, price: 180000 }] },
        { name: 'قلم آزمایشی ۳', qty: 1, price: 190000, lineTotal: 190000, modifiers: [], complements: [] },
      ],
    };
  }

  async function buildReceiptRasterPayload(source, { printer = {}, test = false } = {}) {
    if (document.fonts?.ready) await document.fonts.ready;
    const [logo, restaurantData] = await Promise.all([
      loadReceiptLogo(),
      api(`/api/restaurant${qs()}`),
    ]);
    const restaurantPhone = String(restaurantData?.restaurant?.phone || '').trim();
    const order = test ? waiterTestReceiptOrder() : source;
    if (!order) throw new Error('اطلاعات فیش برای چاپ در دسترس نیست.');

    const width = Number(printer.paperWidth) === 58 ? 384 : 576;
    const maxHeight = 4095;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = maxHeight;
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!ctx) throw new Error('امکان ساخت تصویر فیش در مرورگر وجود ندارد.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, maxHeight);
    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#000';
    ctx.direction = 'rtl';
    ctx.textBaseline = 'top';

    const compact = width === 384;
    const padding = compact ? 22 : 32;
    const left = padding;
    const right = width - padding;
    const contentWidth = width - padding * 2;
    let y = padding;
    const font = (size, weight = 500) => { ctx.font = `${weight} ${size}px Vazirmatn, Tahoma, sans-serif`; };
    const wrap = (value, maxWidth, size = 25, weight = 500) => {
      font(size, weight);
      const words = String(value ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
      if (!words.length) return [];
      const rows = [];
      let row = '';
      for (const word of words) {
        const candidate = row ? `${row} ${word}` : word;
        if (ctx.measureText(candidate).width <= maxWidth) { row = candidate; continue; }
        if (row) rows.push(row);
        if (ctx.measureText(word).width <= maxWidth) { row = word; continue; }
        let fragment = '';
        for (const char of Array.from(word)) {
          const next = fragment + char;
          if (fragment && ctx.measureText(next).width > maxWidth) { rows.push(fragment); fragment = char; }
          else fragment = next;
        }
        row = fragment;
      }
      if (row) rows.push(row);
      return rows;
    };
    const drawCenter = (value, size = 27, weight = 650, gap = 9) => {
      font(size, weight); ctx.textAlign = 'center'; ctx.direction = 'rtl';
      const rows = wrap(value, contentWidth, size, weight);
      for (const row of rows) { ctx.fillText(row, width / 2, y); y += size + gap; }
    };
    const drawRight = (value, size = 25, weight = 500, indent = 0, gap = 9) => {
      font(size, weight); ctx.textAlign = 'right'; ctx.direction = 'rtl';
      const rows = wrap(value, contentWidth - indent, size, weight);
      for (const row of rows) { ctx.fillText(row, right - indent, y); y += size + gap; }
    };
    const divider = (gap = 20) => {
      y += gap / 2; ctx.save(); ctx.setLineDash([9, 7]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); ctx.restore(); y += gap;
    };
    const metaRow = (label, value) => {
      font(compact ? 21 : 24, 650); ctx.direction = 'rtl';
      ctx.textAlign = 'right'; ctx.fillText(label, right, y);
      ctx.textAlign = 'left'; ctx.fillText(String(value || '—'), left, y);
      y += compact ? 33 : 38;
    };
    const band = (rightText, leftText, { height = compact ? 62 : 76, size = compact ? 23 : 28 } = {}) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(left, y, contentWidth, height);
      ctx.fillStyle = '#fff';
      font(size, 800); ctx.direction = 'rtl'; ctx.textBaseline = 'middle';
      ctx.textAlign = 'right'; ctx.fillText(rightText, right - 15, y + height / 2);
      ctx.textAlign = 'left'; ctx.fillText(String(leftText), left + 15, y + height / 2);
      ctx.textBaseline = 'top'; ctx.fillStyle = '#000';
      y += height + (compact ? 14 : 18);
    };
    const sectionTitle = (value) => {
      y += 3;
      font(compact ? 23 : 27, 800); ctx.direction = 'rtl'; ctx.textAlign = 'center';
      ctx.fillText(value, width / 2, y);
      y += compact ? 38 : 44;
    };

    if (logo) {
      const logoWidth = compact ? 250 : 350;
      const logoHeight = Math.round(logoWidth * logo.naturalHeight / logo.naturalWidth);
      ctx.drawImage(logo, Math.round((width - logoWidth) / 2), y, logoWidth, logoHeight);
      y += logoHeight + (compact ? 18 : 22);
    } else {
      drawCenter('وستو', compact ? 38 : 46, 900, 14);
    }
    drawCenter(test ? 'برگه آزمایشی چاپگر · فاقد اعتبار مالی' : 'فیش فروش', compact ? 24 : 30, 800, 12);
    divider(22);
    band(test ? 'شناسه آزمایشی' : 'شماره سفارش', test ? 'سفارش ثبت نشده' : (order.orderNo || order.orderId || order.id || '—'));
    sectionTitle('جزئیات سفارش');
    metaRow('نوع سفارش', test ? 'آزمایشی' : receiptLocation(order));
    metaRow('تاریخ و ساعت', receiptDate(order));
    metaRow('روش پرداخت', test ? 'انجام نشده' : receiptPayment(order));
    if (!test) receiptPaymentRows(order).forEach((payment) => metaRow(payment.label, money(payment.amount)));
    const customerName = order.customerName || order.name;
    if (!test && customerName) metaRow('نام مهمان', customerName);
    if (!test && restaurantPhone) metaRow('شماره تماس مجموعه', restaurantPhone);
    if (order.note) { y += 5; drawRight(`یادداشت سفارش: ${order.note}`, compact ? 20 : 23, 600); }
    divider(24);
    band('شرح سفارش', 'مبلغ', { height: compact ? 50 : 60, size: compact ? 21 : 25 });

    const lines = order.lines || order.items || [];
    if (!lines.length) drawCenter('قلمی در این فیش ثبت نشده است', compact ? 21 : 25, 600, 10);
    for (const line of lines) {
      const qty = Math.max(1, Number(line.qty || 1));
      const name = `${qty.toLocaleString('fa-IR')} × ${line.name || 'محصول'}`;
      const nameWidth = contentWidth - (compact ? 135 : 190);
      const nameRows = wrap(name, nameWidth, compact ? 23 : 27, 750);
      const rowStart = y;
      font(compact ? 23 : 27, 750); ctx.direction = 'rtl'; ctx.textAlign = 'right';
      for (const row of nameRows) { ctx.fillText(row, right, y); y += compact ? 33 : 39; }
      font(compact ? 21 : 24, 800); ctx.textAlign = 'left';
      ctx.fillText(money(receiptLineTotal(line)), left, rowStart + 1);
      for (const modifier of line.modifiers || []) drawRight(`• ${modifier.name || modifier}`, compact ? 19 : 22, 550, 18, 7);
      for (const complement of line.complements || []) {
        const complementQty = Math.max(1, Number(complement.qty || 1));
        drawRight(`+ ${complementQty.toLocaleString('fa-IR')} × ${complement.name || 'مکمل'} — ${money(Number(complement.price || 0) * complementQty)}`, compact ? 19 : 22, 550, 18, 7);
      }
      if (line.note) drawRight(`یادداشت: ${line.note}`, compact ? 19 : 22, 550, 18, 7);
      y += 12;
      ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); y += 16;
      if (y > maxHeight - 300) throw new Error('فیش از حداکثر طول قابل چاپ بیشتر است.');
    }

    y += 6;
    band(test ? 'مبالغ نمایشی' : 'جمع کل', money(receiptTotal(order)), { height: compact ? 70 : 86, size: compact ? 27 : 34 });
    ctx.lineWidth = 3;
    ctx.strokeRect(left, y, contentWidth, compact ? 56 : 68);
    font(compact ? 21 : 25, 800); ctx.textAlign = 'center'; ctx.direction = 'rtl'; ctx.textBaseline = 'middle';
    ctx.fillText(test ? 'آزمایشی · فاقد اعتبار مالی' : (order.paymentStatus === 'paid' ? 'پرداخت‌شده' : 'پیش‌فاکتور — تسویه نشده'), width / 2, y + (compact ? 28 : 34));
    ctx.textBaseline = 'top';
    y += compact ? 66 : 80;
    if (test) drawCenter('سفارش و پرداختی ثبت نشده است', compact ? 20 : 23, 750, 8);

    const height = Math.min(maxHeight, Math.ceil(y + Math.round(padding * 0.8)));
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const rowBytes = width / 8;
    const packed = new Uint8Array(rowBytes * height);
    for (let py = 0; py < height; py += 1) {
      for (let px = 0; px < width; px += 1) {
        const offset = (py * width + px) * 4;
        const luminance = (pixels[offset] * 299 + pixels[offset + 1] * 587 + pixels[offset + 2] * 114) / 1000;
        if (luminance < 190) packed[py * rowBytes + (px >> 3)] |= 0x80 >> (px & 7);
      }
    }
    return { format: 'escpos-raster-v1', width, height, data: bytesToBase64(packed) };
  }

  async function activePrinter() {
    if (state.printer) return state.printer;
    const data = await api(`/api/cashier/printer${qs()}`);
    state.printer = data.printer;
    if (!state.printer) throw new Error('پرینتر صندوق تنظیم نشده است.');
    return state.printer;
  }

  async function finishReceipt(order, method, destination) {
    try {
      const body = { method, destination, branchId: state.branchId };
      const result = await api(`/api/cashier/orders/${order.id}/receipt`, { method: 'POST', body: JSON.stringify(body) });
      if ((method === 'email' || method === 'sms') && !result.deliveryConfigured) showToast('انتخاب ثبت شد؛ سرویس ارسال بیرونی هنوز پیکربندی نشده است.');
      state.posCheck = null; dialog.close(); await render();
    } catch (error) { showToast(error.message, 'error'); }
  }

  async function printOrder(check) {
    if (!check?.orderId) throw new Error('برای چاپ، ابتدا سفارش را ثبت کنید.');
    return api(`/api/cashier/orders/${check.orderId}/print`, {
      method: 'POST',
      body: JSON.stringify({ branchId: state.branchId }),
    });
  }

  async function openPrinterSettings() {
    let data;
    let systemInfo = { supported: true, platform: '', printers: [] };
    let systemInfoError = '';
    try {
      data = await api(`/api/cashier/printer${qs()}`);
    } catch (error) {
      showToast(error.message, 'error');
      return;
    }
    try {
      systemInfo = await api('/api/cashier/printers/system');
    } catch (error) {
      systemInfoError = error.message;
    }
    const printer = data.printer || {
      id: 'cashier-main', name: 'پرینتر صندوق', host: '192.168.254.4', port: 9100,
      model: 'bixolon-srp-350iii', transport: 'network', systemPrinterName: '', enabled: true,
      paperWidth: 80, charsPerLine: 48, renderMode: 'raster', encoding: 'windows-1256', codePage: 40, cut: true, timeoutMs: 5000,
    };
    const initialTransport = printer.transport === 'system' ? 'system' : 'network';
    const targetLabel = (value) => value.transport === 'system'
      ? `USB / سیستم · ${value.systemPrinterName || 'انتخاب‌نشده'}`
      : `شبکه · ${value.host}:${value.port}`;
    const queueLabel = (entry) => `${entry.label || entry.name}${entry.connection === 'usb' ? ' · USB' : entry.connection === 'network' ? ' · شبکه' : ' · سیستم'}`;
    const knownSystemPrinters = [...(systemInfo.printers || [])];
    if (printer.systemPrinterName && !knownSystemPrinters.some((entry) => entry.name === printer.systemPrinterName)) {
      knownSystemPrinters.unshift({ name: printer.systemPrinterName, label: printer.systemPrinterName, connection: 'system' });
    }
    const queueOptions = knownSystemPrinters.length
      ? knownSystemPrinters.map((entry) => `<option value="${esc(entry.name)}" ${entry.name === printer.systemPrinterName ? 'selected' : ''}>${esc(queueLabel(entry))}</option>`).join('')
      : '<option value="">پرینتری شناسایی نشده است</option>';
    state.printer = printer;
    openDialog('تنظیمات صندوق', 'پرینتر صندوق', `
      <div class="printer-settings">
        <div class="printer-settings__intro"><strong>BIXOLON SRP-350III · رول ۸۰ میلی‌متر</strong><span>نوع اتصال را انتخاب کنید؛ چاپ فیش بدون بازشدن پنجرهٔ چاپ انجام می‌شود.</span></div>
        <div class="printer-settings__status" id="printer-settings-status" role="status">${esc(targetLabel(printer))}</div>
        <div id="printer-settings-form" class="field-grid">
          <div class="printer-settings__transport field--full" role="radiogroup" aria-label="نوع اتصال پرینتر">
            <label><input type="radio" name="transport" value="network" ${initialTransport === 'network' ? 'checked' : ''} /><span><b>شبکه</b><small>اتصال مستقیم با IP</small></span></label>
            <label class="${systemInfo.supported === false ? 'is-disabled' : ''}"><input type="radio" name="transport" value="system" ${initialTransport === 'system' ? 'checked' : ''} ${systemInfo.supported === false ? 'disabled' : ''} /><span><b>USB / سیستم</b><small>صف چاپ نصب‌شده روی مک</small></span></label>
          </div>
          <div class="printer-settings__panel field--full" id="printer-network-fields">
            <label class="field"><span>IP پرینتر</span><input name="host" dir="ltr" inputmode="decimal" maxlength="15" value="${esc(printer.host || '192.168.254.4')}" /></label>
            <label class="field"><span>پورت</span><input name="port" dir="ltr" type="number" min="1" max="65535" value="${Number(printer.port) || 9100}" /></label>
          </div>
          <div class="printer-settings__system field--full" id="printer-system-fields">
            <label class="field"><span>پرینتر نصب‌شده</span><select name="systemPrinterName">${queueOptions}</select></label>
            <button type="button" class="role-secondary" id="printer-system-refresh">شناسایی دوباره</button>
            <small id="printer-system-hint">${esc(systemInfoError || (knownSystemPrinters.length ? `${knownSystemPrinters.length.toLocaleString('fa-IR')} صف چاپ پیدا شد.` : 'پرینتر USB را وصل و در تنظیمات Printers & Scanners مک اضافه کنید.'))}</small>
          </div>
      <div class="printer-settings__actions field--full"><button type="button" class="role-secondary" id="printer-save">ذخیره تنظیمات</button><button type="button" class="role-primary" id="printer-test">چاپ برگهٔ تست · فاقد اعتبار مالی</button></div>
        </div>
        <small class="printer-settings__hint">فیش همیشه با عرض کامل ۸۰ میلی‌متر، برش خودکار و ارتفاع متناسب با محتوای سفارش چاپ می‌شود.</small>
      </div>`);

    // The dialog sheet is already a form (`method="dialog"`). A nested form is
    // invalid HTML and browsers discard its opening tag, which previously left
    // this reference null and made both printer buttons fail at runtime.
    const form = dialog.querySelector('form.role-dialog__sheet');
    const status = document.getElementById('printer-settings-status');
    const networkFields = document.getElementById('printer-network-fields');
    const systemFields = document.getElementById('printer-system-fields');
    const systemSelect = form.elements.systemPrinterName;
    const systemHint = document.getElementById('printer-system-hint');
    const transportInputs = [...dialogBody.querySelectorAll('input[name="transport"]')];
    const paintTransport = () => {
      const isSystem = form.elements.transport.value === 'system';
      networkFields.hidden = isSystem;
      systemFields.hidden = !isSystem;
      form.elements.host.required = !isSystem;
      form.elements.port.required = !isSystem;
      systemSelect.required = isSystem;
    };
    transportInputs.forEach((input) => input.addEventListener('change', paintTransport));
    paintTransport();

    const renderSystemPrinters = (rows) => {
      const selected = systemSelect.value || printer.systemPrinterName;
      systemSelect.innerHTML = rows.length
        ? rows.map((entry) => `<option value="${esc(entry.name)}">${esc(queueLabel(entry))}</option>`).join('')
        : '<option value="">پرینتری شناسایی نشده است</option>';
      if (rows.some((entry) => entry.name === selected)) systemSelect.value = selected;
      systemHint.textContent = rows.length
        ? `${rows.length.toLocaleString('fa-IR')} صف چاپ پیدا شد؛ پرینتر USB موردنظر را انتخاب کنید.`
        : 'پرینتر USB را وصل و در تنظیمات Printers & Scanners مک اضافه کنید.';
    };
    document.getElementById('printer-system-refresh').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      setBusy(button, true);
      try {
        const refreshed = await api('/api/cashier/printers/system');
        renderSystemPrinters(refreshed.printers || []);
        status.textContent = 'فهرست پرینترهای سیستم به‌روزرسانی شد.';
      } catch (error) {
        systemHint.textContent = error.message;
        showToast(error.message, 'error');
      } finally { setBusy(button, false); }
    });
    const readForm = () => ({
      id: printer.id,
      name: 'پرینتر صندوق',
      model: 'bixolon-srp-350iii',
      transport: form.elements.transport.value,
      systemPrinterName: systemSelect.value,
      host: form.elements.host.value,
      port: Number(form.elements.port.value),
      paperWidth: 80,
      renderMode: 'raster',
      timeoutMs: 5000,
      enabled: true,
      cut: true,
      branchId: state.branchId,
    });
    const saveConfig = async () => {
      if (!form.reportValidity()) throw new Error(form.elements.transport.value === 'system' ? 'یک پرینتر USB/سیستم انتخاب کنید.' : 'IP و پورت پرینتر را درست وارد کنید.');
      const result = await api('/api/cashier/printer', { method: 'PUT', body: JSON.stringify(readForm()) });
      state.printer = result.printer;
      status.textContent = `ذخیره شد · ${targetLabel(result.printer)}`;
      return result;
    };
    document.getElementById('printer-save').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      setBusy(button, true);
      try { await saveConfig(); showToast('تنظیمات پرینتر ذخیره شد.'); }
      catch (error) { status.textContent = error.message; showToast(error.message, 'error'); }
      finally { setBusy(button, false); }
    });
    document.getElementById('printer-test').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      setBusy(button, true);
      try {
        const saved = await saveConfig();
        const raster = await buildReceiptRasterPayload(null, { printer: saved.printer, test: true });
        const result = await api('/api/cashier/printer/test', { method: 'POST', body: JSON.stringify({ branchId: state.branchId, raster }) });
        status.textContent = `فیش نمونه ارسال شد · ${targetLabel(saved.printer)} · ${raster.width}×${raster.height}`;
        showToast(`برگهٔ آزمایشی چاپ شد (${num(result.result?.bytes || 0)} بایت).`);
      } catch (error) { status.textContent = error.message; showToast(error.message, 'error'); }
      finally { setBusy(button, false); }
    });
  }

  function cashierFloor() {
    document.body.classList.remove('is-pos-station');
    document.body.classList.add('is-cashier-floor-app');
    const tables = state.data.floor?.tables || [];
    tables.forEach(ensureTableGeometry);
    state.cashierFloorMode = state.cashierFloorMode || 'plan';
    state.cashierFloorZone = state.cashierFloorZone || (typeof window !== 'undefined' && window.innerWidth <= 768 ? 'سالن' : 'all');
    if (state.cashierFloorZone !== 'all') state.cashierFloorZone = normalizeRoleFloorZoneName(state.cashierFloorZone);

    const zones = [...new Set(tables.map((table) => normalizeRoleFloorZoneName(table.zone)))];
    const visibleTables = state.cashierFloorZone === 'all'
      ? tables
      : tables.filter((table) => normalizeRoleFloorZoneName(table.zone) === state.cashierFloorZone);

    const zoneButton = (id, label, count) => `<button type="button" data-floor-zone="${esc(id)}" data-cashier-zone="${esc(id)}" class="floor-zone-pill ${state.cashierFloorZone === id ? 'active' : ''}"><span>${esc(label)}</span><small>${num(count)}</small></button>`;

    const activeOrders = (state.data.orders || []).filter((item) => item.fulfillment === 'dine_in' && orderIsOpen(item));
    const busyTables = tables.filter((t) => t.state === 'busy');
    const attentionTables = tables.filter((t) => t.state === 'attention');

    const toolbarHtml = `
      <div class="floor-toolbar">
        <div class="floor-toolbar__group">
          <div class="floor-segmented" role="tablist">
            <button type="button" class="floor-segmented__btn ${state.cashierFloorMode === 'plan' ? 'active' : ''}" id="cashier-floor-plan-btn">
              📐 پلان ۲D
            </button>
            <button type="button" class="floor-segmented__btn ${state.cashierFloorMode === 'grid' ? 'active' : ''}" id="cashier-floor-grid-btn">
              ▦ کارت‌ها
            </button>
          </div>
          <div class="floor-zone-pills">
            ${zoneButton('all', 'همه', tables.length)}
            ${zones.map((z) => zoneButton(z, z, tables.filter((table) => normalizeRoleFloorZoneName(table.zone) === z).length)).join('')}
          </div>
        </div>

        <div class="floor-toolbar__group">
          <div class="floor-toolbar__metrics">
            <span class="floor-metric-chip ${attentionTables.length ? 'has-calls' : ''}" title="میزهای نیازمند رسیدگی">
              <span>${attentionTables.length ? '🔔' : '🛎️'}</span>
              <strong>${num(attentionTables.length)}</strong>
              <small>فراخوان</small>
            </span>
            <span class="floor-metric-chip" title="سفارش‌های فعال سالن">
              <span>🍽️</span>
              <strong>${num(activeOrders.length)}</strong>
              <small>سفارش فعال</small>
            </span>
            <span class="floor-metric-chip is-stat" title="میزهای در حال سرویس">
              <span>🪑</span>
              <strong>${num(busyTables.length)}</strong>
              <small>مشغول</small>
            </span>
          </div>
          <button class="role-primary" id="floor-new">+ سفارش جدید</button>
        </div>
      </div>`;


    const planCanvasHtml = buildPlanCanvasHtml(visibleTables, state.cashierFloorZone, {
      extraClass: 'is-cashier-canvas',
      id: 'cashier-floor-canvas',
      tablesLayerId: 'cashier-plan-tables-layer',
      allowEdit: false,
      attr: (t) => `data-cashier-table="${esc(t.id)}"`
    });

    const classicGridHtml = `
      <div class="floor-grid" style="overflow-y:auto;flex:1;min-height:0;padding:8px">
        ${visibleTables.map((table) => `
          <button type="button" class="floor-table" data-cashier-table="${esc(table.id)}" data-state="${esc(table.state)}" ${table.autoReleased ? 'data-auto-released="true"' : ''}>
            <strong>${esc(table.label || `میز ${table.id}`)}</strong>
          <small>${num(table.seats)} نفر · ${esc(normalizeRoleFloorZoneName(table.zone))}</small>
            <span>${esc(table.stateLabel || 'آزاد')}</span>
            ${table.serviceEndsAt && !table.autoReleased && ['busy', 'attention'].includes(table.state) ? `<time class="plan-table-timer" data-service-ends="${esc(table.serviceEndsAt)}" style="margin-top:6px;display:inline-block">${floorCountdownLabel(table.serviceEndsAt)}</time>` : ''}
          </button>`).join('') || empty('میزی در این بخش یافت نشد.')}
      </div>`;

    main.innerHTML = `
      <div class="waiter-floor-screen">
        ${toolbarHtml}
        ${state.cashierFloorMode === 'plan' ? planCanvasHtml : classicGridHtml}
      </div>`;

    document.getElementById('floor-new')?.addEventListener('click', openNewCheck);
    document.getElementById('cashier-floor-plan-btn')?.addEventListener('click', () => { state.cashierFloorMode = 'plan'; cashierFloor(); });
    document.getElementById('cashier-floor-grid-btn')?.addEventListener('click', () => { state.cashierFloorMode = 'grid'; cashierFloor(); });
    main.querySelectorAll('[data-cashier-zone], [data-floor-zone]').forEach((btn) => btn.addEventListener('click', () => {
      state.cashierFloorZone = btn.dataset.cashierZone || btn.dataset.floorZone;
      cashierFloor();
    }));

    main.querySelectorAll('[data-cashier-table]').forEach((button) => button.addEventListener('click', () => {
      if (state.canvasDragging) return;
      const tableId = button.dataset.cashierTable;
      const table = tables.find((item) => String(item.id) === String(tableId));
      const order = !table?.autoReleased && (state.data.orders || []).find((item) => orderIsOpen(item) && String(item.tableNo) === String(tableId) && (!table?.serviceOrderId || Number(item.id) === Number(table.serviceOrderId)));
      if (order) {
        state.posCheck = posCheckFromOrder(order);
        state.activeView = 'menu';
        paintNav();
        cashierMenu();
      } else {
        startPosCheck('dine_in', tableId);
      }
    }));
    if (state.cashierFloorMode === 'plan') {
      setupFloorCanvasPanZoom('cashier-floor-canvas', { activeZone: state.cashierFloorZone });
    }
    startFloorCountdown();
  }


  function clearFloorCountdown() {
    if (state.floorCountdownTimer) clearInterval(state.floorCountdownTimer);
    state.floorCountdownTimer = null;
  }

  function startFloorCountdown() {
    clearFloorCountdown();
    const tick = () => {
      let expired = false;
      main.querySelectorAll('[data-service-ends]').forEach((timer) => {
        const remaining = new Date(timer.dataset.serviceEnds).getTime() - Date.now();
        timer.textContent = floorCountdownLabel(timer.dataset.serviceEnds);
        timer.classList.toggle('is-ending', remaining > 0 && remaining <= 10 * 60 * 1000);
        if (remaining <= 0) expired = true;
      });
      if (expired) {
        clearFloorCountdown();
        render();
      }
    };
    tick();
    if (main.querySelector('[data-service-ends]')) state.floorCountdownTimer = setInterval(tick, 1000);
  }
  const armFloorCountdown = startFloorCountdown;

  function cashierOrders() {
    document.body.classList.remove('is-pos-station');
    const orders = state.data.orders || [];
    const open = orders.filter(orderIsOpen);
    const closed = orders.filter((order) => !orderIsOpen(order)).slice(0, 30);
    const row = (order) => {
      const editable = orderCanEdit(order);
      const paymentStatus = orderPaymentStatus(order);
      const displayStatus = paymentStatus === 'partial' ? 'نیازمند تکمیل پرداخت' : statusLabel(order.status);
      return `<article class="pos-order-row ${editable ? 'is-editable' : ''}" data-order-id="${order.id}"><div><b>${esc(order.orderNo || `#${order.id}`)}</b><span>${esc(order.tableNo ? `میز ${order.tableNo}` : 'بیرون‌بر')} · ${time(order.createdAt)}</span></div><p>${orderItems(order)}</p><span class="pos-status">${esc(displayStatus)} · ${esc(orderPaymentStatusLabel(order))}</span><strong>${money(order.total)}</strong><button type="button" class="pos-order-row__action ${editable ? 'is-edit' : ''}" data-open-order="${order.id}" ${orderIsOpen(order) ? '' : 'disabled'}>${editable ? 'ویرایش سفارش' : 'مشاهده'}</button></article>`;
    };
    main.innerHTML = `${pageHead('کنترل سفارش', 'تاریخچهٔ سفارش‌ها', 'فاکتورهای باز و بستهٔ ایستگاه؛ دریافت از این فهرست انجام نمی‌شود.', '<div class="cashier-register-head-actions"><button type="button" class="role-secondary" id="cashier-queue-return">بازگشت به صف صندوق</button><button type="button" class="role-primary" id="orders-new">+ سفارش جدید</button></div>')}<section class="role-section"><div class="role-section__head"><h2>باز</h2><span>${num(open.length)} فاکتور</span></div><div class="pos-order-list">${open.map(row).join('') || empty('فاکتور بازی وجود ندارد.')}</div></section><section class="role-section" style="margin-top:14px"><div class="role-section__head"><h2>بسته‌شده‌های اخیر</h2><span>${num(closed.length)} فاکتور</span></div><div class="pos-order-list">${closed.map(row).join('') || empty('هنوز سفارشی بسته نشده است.')}</div></section>`;
    document.getElementById('orders-new')?.addEventListener('click', openNewCheck);
    document.getElementById('cashier-queue-return')?.addEventListener('click', cashierRegister);
    main.querySelectorAll('[data-open-order]').forEach((button) => button.addEventListener('click', () => { const order = orders.find((item) => Number(item.id) === Number(button.dataset.openOrder)); state.posCheck = posCheckFromOrder(order); state.activeView = 'menu'; paintNav(); cashierMenu(); }));
    const focusOrderId = new URLSearchParams(location.search).get('focusOrder');
    if (focusOrderId) {
      const row = main.querySelector(`[data-order-id="${CSS.escape(focusOrderId)}"]`);
      row?.classList.add('is-focused');
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row?.querySelector('[data-open-order]')?.focus({ preventScroll: true });
    }
  }

  function cashierTransactionRows(orders = []) {
    const transactions = [];
    (Array.isArray(orders) ? orders : []).forEach((order) => {
      const payments = (Array.isArray(order?.partialPayments) ? order.partialPayments : [])
        .map((payment) => ({ payment, amount: Number(payment?.amount) }))
        .filter((entry) => Number.isSafeInteger(entry.amount) && entry.amount > 0);
      const recordedAmount = payments.reduce((sum, entry) => sum + entry.amount, 0);
      const paidProjection = Number.isSafeInteger(Number(order?.amountPaid)) && Number(order?.amountPaid) >= 0
        ? Number(order.amountPaid)
        : String(order?.paymentStatus || '').toLowerCase() === 'paid' && Number.isSafeInteger(Number(order?.total))
          ? Number(order.total)
          : null;
      const projectionMismatch = paidProjection !== null && paidProjection !== recordedAmount && payments.length > 0;

      payments.forEach(({ payment, amount }) => transactions.push({
        order,
        payment,
        amount,
        tender: String(payment?.tender || '').trim(),
        at: payment?.at || order?.paidAt || order?.createdAt || '',
        projectionMismatch,
        legacy: false,
      }));

      if (payments.length) {
        if (paidProjection !== null && paidProjection > recordedAmount) {
          transactions.push({
            order,
            payment: null,
            amount: paidProjection - recordedAmount,
            tender: '',
            at: order?.paidAt || order?.createdAt || '',
            projectionMismatch: true,
            legacy: false,
          });
        }
        return;
      }

      const paymentStatus = String(order?.paymentStatus || '').toLowerCase();
      const legacyPaidAmount = paymentStatus === 'paid' ? Number(order?.total) : Number(order?.amountPaid);
      if (!Number.isSafeInteger(legacyPaidAmount) || legacyPaidAmount <= 0) return;
      transactions.push({
        order,
        payment: null,
        amount: legacyPaidAmount,
        tender: paymentStatus === 'paid' ? String(order?.paymentTender || '').trim() : '',
        at: order?.paidAt || order?.createdAt || '',
        projectionMismatch: false,
        legacy: true,
      });
    });

    return transactions.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  }

  function cashierTransactions() {
    document.body.classList.remove('is-pos-station');
    const transactions = cashierTransactionRows(state.data.orders || []);
    const tenderLabel = { cash: 'نقدی', card: 'کارت‌خوان', manual_card: 'کارت‌خوان دستی', gift_card: 'کارت هدیه', card_on_file: 'کارت ذخیره‌شده', online: 'پرداخت اینترنتی', wallet: 'کیف پول' };
    const hasTender = (transaction) => Object.prototype.hasOwnProperty.call(tenderLabel, transaction.tender);
    const cash = transactions.filter((transaction) => transaction.tender === 'cash');
    const nonCash = transactions.filter((transaction) => hasTender(transaction) && transaction.tender !== 'cash');
    const missingTender = transactions.filter((transaction) => !hasTender(transaction));
    const projectionMismatchOrders = new Set(transactions.filter((transaction) => transaction.projectionMismatch).map((transaction) => String(transaction.order?.id))).size;
    const totalOf = (rows) => rows.reduce((sum, transaction) => sum + transaction.amount, 0);
    main.innerHTML = `${pageHead('دریافت و پرداخت', 'تراکنش‌ها', 'پرداخت‌های ثبت‌شده و روش دریافت')}
      <section class="role-metrics">
        ${metric('جمع پرداخت', money(totalOf(transactions)), `${num(transactions.length)} دریافت`)}
        ${metric('نقدی', money(totalOf(cash)), `${num(cash.length)} دریافت`)}
        ${metric('غیرنقدی معتبر', money(totalOf(nonCash)), `${num(nonCash.length)} دریافت`)}
        ${metric('روش ثبت‌نشده', money(totalOf(missingTender)), `${num(missingTender.length)} مورد برای بازبینی`)}
      </section>
      ${missingTender.length || projectionMismatchOrders ? `<div class="role-inline-warning" role="status"><b>${missingTender.length ? `${num(missingTender.length)} دریافت روش ثبت‌شده ندارد.` : ''}${missingTender.length && projectionMismatchOrders ? ' · ' : ''}${projectionMismatchOrders ? `${num(projectionMismatchOrders)} فاکتور با جمع ردیف‌های دریافت نیاز به تطبیق دارد.` : ''}</b><span>مبلغ‌های بدون روش یا ناسازگار جدا نمایش داده شده‌اند؛ آن‌ها را به روش نقدی یا کارت نسبت ندهید.</span></div>` : ''}
      <section class="role-section"><div class="pos-transaction-list">${transactions.map((transaction) => {
        const { order, payment } = transaction;
        const missing = !hasTender(transaction);
        const warning = missing || transaction.projectionMismatch;
        const detail = [posLocationLabel(posCheckFromOrder(order)), time(transaction.at), transaction.legacy ? 'ثبت قدیمی فاکتور' : '', payment?.reference ? `مرجع ${payment.reference}` : ''].filter(Boolean).join(' · ');
        const method = missing ? 'روش ثبت‌نشده' : tenderLabel[transaction.tender];
        return `<article class="${warning ? 'is-warning' : ''}" data-payment-order="${esc(order.id)}"${payment?.id != null ? ` data-payment-id="${esc(payment.id)}"` : ''}><div><b>${esc(order.orderNo || `#${order.id}`)}</b><span>${esc(detail)}</span></div><span>${esc(method)}${transaction.projectionMismatch ? ' · نیازمند تطبیق' : ''}</span><strong>${money(transaction.amount)}</strong></article>`;
      }).join('') || empty('تراکنشی ثبت نشده است.')}</div></section>`;
  }

  function cashierIntegerAmount(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !/^[+-]?\d+$/u.test(value.trim())) return null;
    const amount = Number(typeof value === 'string' ? value.trim() : value);
    return Number.isSafeInteger(amount) ? amount : null;
  }

  function cashierSettlementAmounts(order) {
    const total = cashierIntegerAmount(order?.total);
    if (total === null || total < 0) return { ok: false, error: 'order_total_invalid' };
    const payments = Array.isArray(order?.partialPayments) ? order.partialPayments : [];
    let recordedNet = 0;
    for (const payment of payments) {
      const amount = cashierIntegerAmount(payment?.amount);
      const refunded = payment?.refundedAmount == null ? 0 : cashierIntegerAmount(payment.refundedAmount);
      if (amount === null || amount <= 0 || refunded === null || refunded < 0 || refunded > amount) {
        return { ok: false, error: 'payment_history_invalid' };
      }
      const netAmount = amount - refunded;
      if (netAmount > total - recordedNet) return { ok: false, error: 'payment_history_exceeds_order_total' };
      recordedNet += netAmount;
    }

    const projection = order?.amountPaid == null ? null : cashierIntegerAmount(order.amountPaid);
    if (projection !== null && (projection < 0 || projection > total)) {
      return { ok: false, error: 'payment_history_invalid' };
    }
    if (order?.amountPaid != null && projection === null) return { ok: false, error: 'payment_history_invalid' };
    if (payments.length && projection !== null && projection !== recordedNet) {
      return { ok: false, error: 'payment_history_inconsistent' };
    }

    const paid = payments.length
      ? recordedNet
      : projection ?? (String(order?.paymentStatus || '').toLowerCase() === 'paid' ? total : 0);
    return { ok: true, total, paid, due: Math.max(0, total - paid) };
  }

  function cashierSplitAmount(value, outstanding) {
    const due = cashierIntegerAmount(outstanding);
    if (due === null || due <= 0) return null;
    if (value == null) return due;
    const amount = cashierIntegerAmount(value);
    return amount !== null && amount > 0 && amount <= due ? amount : null;
  }

  function cashierPaymentHistoryMarkup(order, amounts, compact = false) {
    const payments = Array.isArray(order?.partialPayments) ? order.partialPayments : [];
    const labels = { cash: 'نقدی', manual_card: 'کارت بانکی · ثبت دستی', card: 'کارت‌خوان', wallet: 'کیف پول', online: 'پرداخت اینترنتی' };
    if (!payments.length && !(Number.isSafeInteger(amounts?.paid) && amounts.paid > 0)) return '';
    const rows = payments.map((payment, index) => {
      const amount = cashierIntegerAmount(payment?.amount);
      if (amount === null || amount <= 0) {
        return `<li class="cashier-payment-history__row is-warning"><span>دریافت ${num(index + 1)} · مبلغ نیازمند تطبیق</span></li>`;
      }
      const refunded = payment?.refundedAmount == null ? 0 : cashierIntegerAmount(payment.refundedAmount);
      const validRefund = refunded !== null && refunded > 0 && refunded <= amount;
      const tender = String(payment?.tender || '').trim();
      const label = labels[tender] || 'روش ثبت‌نشده';
      const reference = String(payment?.reference || '').trim();
      const cashReceived = cashierIntegerAmount(payment?.amountTendered);
      const detail = [
        tender === 'cash' && cashReceived !== null && cashReceived > amount
          ? `نقد دریافتی ${money(cashReceived)} · برگشت ${money(cashReceived - amount)}` : '',
        validRefund ? `بازپرداخت ${money(refunded)} · خالص ${money(amount - refunded)}` : '',
        reference ? `مرجع ${esc(reference)}` : '',
      ].filter(Boolean).join(' · ');
      return `<li class="cashier-payment-history__row"><span><b>دریافت ${num(index + 1)} · ${label}</b>${detail ? `<small>${detail}</small>` : ''}</span><strong>${money(amount)}</strong></li>`;
    }).join('');
    const legacy = payments.length ? '' : '<li class="cashier-payment-history__row"><span><b>پرداخت قدیمی</b><small>ریز روش دریافت در دسترس نیست.</small></span></li>';
    const paid = Number.isSafeInteger(amounts?.paid) ? amounts.paid : null;
    const due = amounts?.ok && Number.isSafeInteger(amounts.due) ? amounts.due : null;
    return `<section class="cashier-payment-history${compact ? ' is-compact' : ''}" role="group" aria-label="دریافت‌های ثبت‌شده و مانده فاکتور">
      <div class="cashier-payment-history__head"><b>دریافت‌های ثبت‌شده</b><span>${num(payments.length || (paid ? 1 : 0))} مورد</span></div>
      <ol class="cashier-payment-history__rows">${rows || legacy}</ol>
      <div class="cashier-payment-history__balance"><span>پرداخت خالص ${paid === null ? 'نیازمند تطبیق' : money(paid)}</span><strong>مانده ${due === null ? 'نیازمند تطبیق' : money(due)}</strong></div>
    </section>`;
  }

  function cashierPendingSettlementStorageKey(order) {
    const branchId = order?.branchId ?? state.branchId ?? '_';
    return `westo:cashier-pending-settlement:v1:${encodeURIComponent(branchId)}:${encodeURIComponent(order?.id ?? '_')}`;
  }

  function readCashierPendingSettlement(order) {
    try {
      const key = cashierPendingSettlementStorageKey(order);
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const pending = JSON.parse(raw);
      if (!pending || typeof pending !== 'object' || typeof pending.idempotencyKey !== 'string'
        || !pending.idempotencyKey || !pending.intent || !Number.isSafeInteger(pending.baselinePaid)
        || !Number.isSafeInteger(pending.baselineTotal)) return { invalid: true };
      return pending;
    } catch (_) { return { invalid: true }; }
  }

  function persistCashierPendingSettlement(order, pending) {
    try {
      sessionStorage.setItem(cashierPendingSettlementStorageKey(order), JSON.stringify(pending));
      return true;
    } catch (_) { return false; }
  }

  function clearCashierPendingSettlement(order) {
    try { sessionStorage.removeItem(cashierPendingSettlementStorageKey(order)); } catch (_) {}
  }

  function ensureCashierSettlementStyles() {
    if (document.getElementById('cashier-settlement-styles')) return;
    const style = document.createElement('style');
    style.id = 'cashier-settlement-styles';
    style.textContent = `
      .cashier-settlement { display:grid; gap:14px; max-height:min(72dvh,680px); overflow:auto; padding:2px; }
      .cashier-settlement__balance { display:grid; gap:5px; padding:14px; border:1px solid var(--rp-line); border-radius:14px; background:var(--rp-surface-2); }
      .cashier-settlement__balance span,.cashier-settlement__hint { color:var(--rp-muted); font-size:14px; line-height:1.8; }
      .cashier-settlement__balance strong { font-size:22px; }
      .cashier-settlement__fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
      .cashier-settlement__fields .field { min-width:0; }
      .cashier-settlement__fields input { width:100%; min-height:52px; padding:10px 12px; font:inherit; font-size:18px; }
      .cashier-settlement__change { min-height:26px; color:var(--rp-muted); font-size:14px; }
      .cashier-settlement__actions { display:grid; gap:8px; }
      .cashier-settlement__actions button { width:100%; min-height:52px; font-size:16px; }
      .cashier-settlement-action { min-height:46px !important; padding-inline:12px !important; font-size:14px; white-space:normal; }
      .cashier-payment-history { display:grid; gap:7px; padding:10px 12px; border:1px solid var(--rp-line); border-radius:12px; background:var(--rp-surface-2); }
      .cashier-payment-history__head,.cashier-payment-history__balance { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:13px; line-height:1.6; }
      .cashier-payment-history__head span,.cashier-payment-history__balance span { color:var(--rp-muted); }
      .cashier-payment-history__balance { padding-top:6px; border-top:1px solid var(--rp-line); }
      .cashier-payment-history__balance strong { font-size:15px; }
      .cashier-payment-history__rows { display:grid; gap:5px; max-height:112px; overflow:auto; margin:0; padding:0; list-style:none; }
      .cashier-payment-history__row { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; font-size:13px; line-height:1.55; }
      .cashier-payment-history__row > span { min-width:0; }
      .cashier-payment-history__row small { display:block; color:var(--rp-muted); font-size:12px; overflow-wrap:anywhere; }
      .cashier-payment-history__row > strong { white-space:nowrap; }
      .cashier-payment-history__row.is-warning { color:var(--rp-danger); }
      .cashier-payment-history.is-compact { margin-top:8px; }
      @media (max-width:620px) {
        .is-cashier-workspace .payment-sheet { height:auto; max-height:calc(100dvh - 118px); overflow-y:auto; grid-template-columns:minmax(0,1fr); grid-template-rows:auto; gap:12px; padding:2px; }
        .is-cashier-workspace .payment-sheet > section { grid-column:auto; }
        .is-cashier-workspace .payment-methods { grid-column:auto; grid-row:auto; grid-template-columns:minmax(0,1fr); }
        .is-cashier-workspace .payment-methods > button { min-height:64px; padding:10px 12px; font-size:14px; }
        .is-cashier-workspace .payment-methods__note { margin:0; color:var(--rp-muted); font-size:14px; line-height:1.7; }
        .is-cashier-workspace .cash-presets { grid-template-columns:repeat(2,minmax(0,1fr)); }
        .is-cashier-workspace .cash-presets button { min-height:48px; padding:8px; font-size:14px; }
        .is-cashier-workspace .banknote-chip { min-height:44px; padding:7px 10px; font-size:13px; }
        .cashier-settlement { max-height:calc(100dvh - 130px); gap:12px; }
        .cashier-settlement__fields { grid-template-columns:1fr; gap:10px; }
        .cashier-settlement__fields input { min-height:56px; font-size:20px; }
        .cashier-settlement__actions button,.cashier-settlement-action { min-height:52px !important; font-size:16px; }
        .cashier-payment-history { padding:10px; }
        .cashier-payment-history__rows { max-height:96px; }
        .cashier-payment-history__row,.cashier-payment-history__head,.cashier-payment-history__balance { font-size:13px; }
      }
    `;
    document.head.append(style);
  }

  function cashierPendingMatchesOrder(order, pending, amounts) {
    if (!pending || pending.invalid) return false;
    return Number(amounts?.paid) === Number(pending.baselinePaid)
      && Number(amounts?.total) === Number(pending.baselineTotal)
      && Number(order?.branchId ?? state.branchId) === Number(pending.intent?.branchId ?? state.branchId)
      && String(pending.intent?.actor || '') === String(state.session?.user?.phone || '')
      && String(pending.intent?.actorRole || role) === String(state.session?.user?.role || role);
  }

  async function submitCashierSettlement(order, intent, button, retryPending = null, options = {}) {
    if (!['unpaid', 'partial'].includes(orderPaymentStatus(order)) || !cashierSettlementStageCanSettle(order)) {
      showToast('این سفارش برای دریافت تازه مجاز نیست؛ وضعیت را در صف تطبیق صندوق بررسی کنید.', 'warning');
      return false;
    }
    const amounts = cashierSettlementAmounts(order);
    const paymentReference = typeof intent?.paymentReference === 'string' ? intent.paymentReference.trim() : '';
    if (!amounts.ok || !Number.isSafeInteger(intent?.paymentAmount) || intent.paymentAmount <= 0
      || intent.paymentAmount > amounts.due
      || (intent?.tender === 'manual_card'
        && (!paymentReference || !Number.isSafeInteger(intent?.amountTendered) || intent.amountTendered !== intent.paymentAmount))
      || (intent?.tender === 'cash'
        && (!Number.isSafeInteger(intent?.amountTendered) || intent.amountTendered < intent.paymentAmount))) {
      showToast('ماندهٔ فاکتور معتبر نیست یا تغییر کرده؛ ابتدا صف صندوق را تازه کنید.', 'error');
      return false;
    }
    const actorIntent = settlementActorIntent(intent);
    const idempotencyKey = retryPending?.idempotencyKey || settlementIdempotencyKey(button, actorIntent);
    const pending = retryPending || {
      idempotencyKey,
      intent: actorIntent,
      baselinePaid: amounts.paid,
      baselineTotal: amounts.total,
      createdAt: Date.now(),
    };
    if (!persistCashierPendingSettlement(order, pending)) {
      showToast('ثبت امن درخواست روی این دستگاه ممکن نیست؛ پرداخت ارسال نشد.', 'error');
      clearSettlementIdempotencyKey(idempotencyKey, actorIntent);
      return false;
    }

    const form = dialogBody.querySelector('.cashier-settlement');
    form?.setAttribute('aria-busy', 'true');
    form?.querySelectorAll('input').forEach((input) => { input.disabled = true; });
    setBusy(button, true);
    try {
      const data = await api(`/api/cashier/orders/${order.id}/settle`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          tender: actorIntent.tender,
          paymentAmount: actorIntent.paymentAmount,
          amountTendered: actorIntent.amountTendered,
          paymentReference: actorIntent.tender === 'manual_card' ? String(actorIntent.paymentReference || '').trim() : actorIntent.paymentReference,
        }),
      });
      const committed = data?.payment?.idempotencyKey === idempotencyKey
        || (Array.isArray(data?.order?.partialPayments)
          && data.order.partialPayments.some((payment) => payment?.idempotencyKey === idempotencyKey));
      if (!data?.order?.id || Number(data.order.id) !== Number(order.id) || !committed) {
        throw Object.assign(new Error('پاسخ ثبت دریافت قابل تأیید نیست؛ دوباره‌دریافت نکنید و وضعیت را تطبیق دهید.'), {
          code: 'settlement_response_unverified', outcomeUnknown: true,
        });
      }
      clearCashierPendingSettlement(order);
      clearSettlementIdempotencyKey(idempotencyKey, actorIntent);
      if (typeof options.onSuccess === 'function') {
        try { options.onSuccess(data.order); }
        catch (_) { showToast('دریافت ثبت شد؛ اما نمایش رسید کامل نشد. از تراکنش‌ها رسید را بازبینی کنید.', 'warning'); }
      } else {
        dialog.close();
        showToast('دریافت ثبت شد؛ ماندهٔ فاکتور به‌روزرسانی شد.');
        await render();
      }
      return true;
    } catch (error) {
      if (error.outcomeUnknown) {
        const blockedReason = ['idempotency_key_conflict', 'idempotency_replay_unavailable', 'payment_status_reconciliation_required'].includes(String(error.code || ''))
          ? error.code : null;
        persistCashierPendingSettlement(order, { ...pending, ...(blockedReason ? { blockedReason } : {}) });
        dialog.close();
        showToast(blockedReason === 'idempotency_replay_unavailable'
          ? 'رسید این دریافت به‌طور خودکار قابل بازیابی نیست؛ دریافت را تکرار نکنید و سوابق صندوق را با سرپرست تطبیق دهید.'
          : 'نتیجهٔ دریافت نامشخص است؛ فقط همان درخواست یکتا را تکرار کنید یا با سرپرست تطبیق دهید.', 'warning');
        if (options.showQueueOnUnknown) {
          state.activeView = 'orders';
          paintNav();
        }
        await render();
      } else {
        clearCashierPendingSettlement(order);
        clearSettlementIdempotencyKey(idempotencyKey, actorIntent);
        const refreshCodes = ['payment_amount_exceeds_due', 'payment_history_inconsistent', 'payment_history_invalid', 'payment_history_exceeds_order_total'];
        if (refreshCodes.includes(String(error.code || ''))) {
          dialog.close();
          showToast(error.message, 'warning');
          await render();
        } else showToast(error.message, 'error');
      }
      return false;
    } finally {
      form?.setAttribute('aria-busy', 'false');
      form?.querySelectorAll('input').forEach((input) => { input.disabled = false; });
      setBusy(button, false);
    }
  }

  function openCashierSettlementDialog(order, tender, due) {
    ensureCashierSettlementStyles();
    const isCash = tender === 'cash';
    const amounts = cashierSettlementAmounts(order);
    openDialog(
      'ثبت دریافت در صندوق',
      isCash ? 'دریافت نقدی' : 'دریافت کارت‌خوان',
      `<div class="cashier-settlement" aria-describedby="cashier-settlement-hint">
        <div class="cashier-settlement__balance"><span>ماندهٔ فعلی فاکتور</span><strong>${money(due)}</strong><small>مبلغ این دریافت را وارد کنید؛ می‌توانید بخشی از مانده را بگیرید.</small></div>
        ${cashierPaymentHistoryMarkup(order, amounts)}
        <div class="cashier-settlement__fields">
          <label class="field"><span>مبلغ این دریافت · تومان</span><input id="cashier-settlement-amount" type="text" inputmode="numeric" autocomplete="off" value="${due}" aria-label="مبلغ این دریافت به تومان" /></label>
          ${isCash
            ? '<label class="field"><span>وجه نقد دریافتی · تومان</span><input id="cashier-settlement-tendered" type="text" inputmode="numeric" autocomplete="off" aria-label="وجه نقد دریافتی به تومان" /></label>'
            : '<label class="field"><span>کد پیگیری رسید کارت‌خوان</span><input id="cashier-settlement-reference" type="text" maxlength="120" autocomplete="off" inputmode="text" aria-label="کد پیگیری رسید کارت‌خوان، الزامی" aria-required="true" required placeholder="کد پیگیری یا شماره مرجع رسید" /></label>'}
        </div>
        ${isCash ? '<div class="cashier-settlement__change" id="cashier-settlement-change" role="status"></div>' : '<p class="cashier-settlement__hint">کارت‌خوان به سامانه متصل نیست؛ فقط پس از بررسی موفق دستگاه و درج کد رسید ثبت کنید.</p>'}
        <p class="cashier-settlement__hint" id="cashier-settlement-hint">مبلغ نباید از ماندهٔ فعلی بیشتر باشد. ثبت دریافت، مبلغ فاکتور را تغییر نمی‌دهد.</p>
        <div class="cashier-settlement__actions"><button type="button" class="role-primary" id="cashier-settlement-submit" disabled>${isCash ? 'ثبت دریافت نقدی' : 'ثبت دریافت پس از بررسی کارت‌خوان'}</button></div>
      </div>`,
    );
    const amountInput = dialogBody.querySelector('#cashier-settlement-amount');
    const tenderedInput = dialogBody.querySelector('#cashier-settlement-tendered');
    const referenceInput = dialogBody.querySelector('#cashier-settlement-reference');
    const changeDisplay = dialogBody.querySelector('#cashier-settlement-change');
    const confirmButton = dialogBody.querySelector('#cashier-settlement-submit');
    if (isCash && tenderedInput) tenderedInput.value = String(due);
    const readAmount = (input) => parseCashDrawerInput(input);
    const validate = () => {
      const amount = readAmount(amountInput);
      const tendered = isCash ? readAmount(tenderedInput) : amount;
      const reference = String(referenceInput?.value || '').trim();
      const amountValid = Number.isSafeInteger(amount) && amount > 0 && amount <= due;
      const tenderedValid = !isCash || (Number.isSafeInteger(tendered) && tendered >= amount);
      if (changeDisplay) {
        changeDisplay.textContent = tenderedValid && amountValid
          ? `باقی‌ماندهٔ قابل برگشت: ${money(Math.max(0, tendered - amount))}`
          : amountValid ? 'وجه نقد دریافتی باید حداقل برابر مبلغ این دریافت باشد.' : `مبلغ باید بین ۱ و ${money(due)} باشد.`;
      }
      if (confirmButton) confirmButton.disabled = !(amountValid && tenderedValid && (isCash || reference.length > 0));
      return { amount, tendered, reference };
    };
    let cashTenderedEdited = false;
    amountInput?.addEventListener('input', () => {
      if (isCash && tenderedInput && !cashTenderedEdited) tenderedInput.value = amountInput.value;
      validate();
    });
    tenderedInput?.addEventListener('input', () => { cashTenderedEdited = true; validate(); });
    referenceInput?.addEventListener('input', validate);
    validate();
    confirmButton?.addEventListener('click', (event) => {
      const values = validate();
      if (confirmButton.disabled) return;
      const intent = {
        orderId: order.id,
        branchId: order.branchId ?? state.branchId,
        tender,
        paymentAmount: values.amount,
        amountTendered: values.tendered,
        paymentReference: isCash ? '' : values.reference,
        actor: state.session?.user?.phone || '',
        actorRole: state.session?.user?.role || role,
      };
      submitCashierSettlement(order, intent, event.currentTarget);
    });
  }

  function cashierSettlementStageCanSettle(order) {
    const status = String(order?.status || '').toLowerCase();
    const fulfillment = String(order?.fulfillment || '').toLowerCase();
    if (['pay_at_cashier', 'awaiting_confirmation', 'sent_to_kitchen', 'preparing', 'ready'].includes(status)) return true;
    if (status === 'done') return fulfillment === 'dine_in';
    if (status === 'picked_up') return fulfillment === 'pickup';
    if (status === 'delivered') return fulfillment === 'delivery';
    return false;
  }

  function cashierWalletSettlementAllowed(paid, paymentAmount, due) {
    return Number.isSafeInteger(paid) && paid === 0
      && Number.isSafeInteger(paymentAmount) && paymentAmount > 0
      && paymentAmount === due;
  }

  function cashierSettlementQueueOrders(orders) {
    const reconciliationStates = new Set(['pending', 'unknown', 'failed', 'cancelled', 'refunded']);
    return (Array.isArray(orders) ? orders : []).filter((order) => {
      const paymentStatus = orderPaymentStatus(order);
      const amounts = cashierSettlementAmounts(order);
      // Keep payment-state exceptions visible even when they must not be collected again.
      if (reconciliationStates.has(paymentStatus)) return true;
      if (paymentStatus === 'paid') return !amounts.ok || amounts.due > 0;
      if (paymentStatus === 'partial') return true;
      return paymentStatus === 'unpaid' && cashierSettlementStageCanSettle(order);
    });
  }

  function cashierPendingSettlementForOrder(order) {
    let pendingIntent = readCashierPendingSettlement(order);
    if (pendingIntent && !pendingIntent.invalid
      && (Array.isArray(order?.partialPayments) ? order.partialPayments : []).some((payment) => payment?.idempotencyKey === pendingIntent.idempotencyKey)) {
      clearCashierPendingSettlement(order);
      clearSettlementIdempotencyKey(pendingIntent.idempotencyKey, pendingIntent.intent);
      pendingIntent = null;
    }
    return pendingIntent;
  }

  function cashierRegister() {
    ensureCashierSettlementStyles();
    const orders = state.data.orders || [];
    const pending = cashierSettlementQueueOrders(orders);
    const paidToday = orders.filter((item) => item.paymentStatus === 'paid' && new Date(item.paidAt || item.statusAt || item.createdAt).toDateString() === new Date().toDateString());
    const drawer = state.data.drawer;
    const needsReview = (order) => {
      const amounts = cashierSettlementAmounts(order);
      const paymentStatus = orderPaymentStatus(order);
      return Boolean(cashierPendingSettlementForOrder(order)) || !amounts.ok || !cashierSettlementStageCanSettle(order)
        || amounts.due <= 0 || ['pending', 'unknown', 'failed', 'cancelled', 'refunded', 'paid'].includes(paymentStatus);
    };
    const reviewOrders = pending.filter(needsReview);
    const receivableOrders = pending.filter((order) => !needsReview(order));
    const cardFor = (order) => {
      const amounts = cashierSettlementAmounts(order);
      const paymentStatus = orderPaymentStatus(order);
      const stageCanSettle = cashierSettlementStageCanSettle(order);
      const pendingIntent = cashierPendingSettlementForOrder(order);
      const retryReady = pendingIntent && !pendingIntent.invalid && !pendingIntent.blockedReason
        && ['unpaid', 'partial'].includes(paymentStatus) && stageCanSettle
        && cashierPendingMatchesOrder(order, pendingIntent, amounts)
        && ['cash', 'manual_card'].includes(String(pendingIntent.intent?.tender || ''))
        && Number.isSafeInteger(pendingIntent.intent?.paymentAmount) && pendingIntent.intent.paymentAmount > 0
        && pendingIntent.intent.paymentAmount <= amounts.due
        && (pendingIntent.intent.tender !== 'manual_card' || String(pendingIntent.intent.paymentReference || '').trim())
        && (pendingIntent.intent.tender !== 'cash'
          || (Number.isSafeInteger(pendingIntent.intent.amountTendered)
            && pendingIntent.intent.amountTendered >= pendingIntent.intent.paymentAmount));
      const actions = pendingIntent
        ? retryReady
          ? `<div class="role-inline-warning" role="alert"><span>دریافت قبلی نتیجهٔ قطعی نداشت. فقط همان مبلغ و روش را دوباره بفرستید.</span></div>
            <button class="role-primary cashier-settlement-action" data-cashier-retry-pending>تکرار امن همان درخواست · ${money(pendingIntent.intent.paymentAmount)}</button>`
          : '<div class="role-inline-warning" role="alert"><span>دریافت قبلی نیازمند تطبیق است؛ دریافت تازه و تکرار درخواست متوقف شده است. وضعیت تراکنش ثبت‌شده را بررسی و سپس صف را تازه کنید.</span></div><button type="button" class="role-secondary" data-cashier-refresh>تازه‌سازی وضعیت</button>'
        : ['pending', 'unknown'].includes(paymentStatus)
          ? `<div class="role-inline-warning" role="alert"><b>پرداخت: ${esc(orderPaymentStatusLabel(order))}</b><span>استعلام خودکار درگاه در این نسخه فعال نیست. رسید و سوابق صندوق/بانک را با سرپرست بررسی کنید؛ تا دریافت وضعیت معتبر، دریافت دوباره مجاز نیست.</span></div><button type="button" class="role-secondary" data-cashier-refresh>تازه‌سازی وضعیت</button>`
        : ['failed', 'cancelled', 'refunded'].includes(paymentStatus)
          ? `<div class="role-inline-warning" role="alert"><b>پرداخت: ${esc(orderPaymentStatusLabel(order))}</b><span>این وضعیت به تطبیق نیاز دارد؛ صندوق دریافت تازه را ثبت نمی‌کند.</span></div><button type="button" class="role-secondary" data-cashier-refresh>تازه‌سازی وضعیت</button>`
        : !amounts.ok
          ? '<div class="role-inline-warning" role="alert"><span>سوابق پرداخت با مبلغ فاکتور هم‌خوان نیست؛ دریافت را متوقف کنید و برای تطبیق به سرپرست اطلاع دهید.</span></div><button type="button" class="role-secondary" data-cashier-refresh>تازه‌سازی وضعیت</button>'
        : paymentStatus === 'paid'
          ? '<div class="role-inline-warning" role="alert"><span>وضعیت تسویه و مانده با هم سازگار نیست؛ دریافت دوباره غیرفعال است و باید تطبیق شود.</span></div><button type="button" class="role-secondary" data-cashier-refresh>تازه‌سازی وضعیت</button>'
        : !stageCanSettle
          ? '<div class="role-inline-warning" role="alert"><span>مدل عملیاتی این مرحله اجازهٔ دریافت نمی‌دهد؛ سفارش برای تطبیق نمایش داده شده است.</span></div><button type="button" class="role-secondary" data-cashier-refresh>تازه‌سازی وضعیت</button>'
        : !Number.isSafeInteger(amounts.due) || amounts.due <= 0
          ? '<div class="role-inline-warning" role="alert"><span>ماندهٔ قابل دریافت معتبر نیست؛ فاکتور را برای تطبیق به مدیر صندوق بسپارید.</span></div><button type="button" class="role-secondary" data-cashier-refresh>تازه‌سازی وضعیت</button>'
          : `<button class="role-primary cashier-settlement-action" data-settle="cash">دریافت نقدی · مانده ${money(amounts.due)}</button>
            <button class="role-secondary cashier-settlement-action" data-settle="manual_card">دریافت کارت · مانده ${money(amounts.due)}</button>
            ${amounts.paid > 0 || (Array.isArray(order.partialPayments) && order.partialPayments.length)
              ? '<div class="role-inline-warning" role="status"><span>برای این سفارش دریافت ثبت شده؛ لغو فقط پس از بازپرداخت مجاز است.</span></div>'
              : '<button class="role-danger" data-cashier-status="cancelled">لغو سفارش</button>'}`;
      return orderCard(order, actions, cashierPaymentHistoryMarkup(order, amounts, true));
    };
    const reviewCards = reviewOrders.map(cardFor).join('');
    const receivableCards = receivableOrders.map(cardFor).join('');
    const headerActions = '<div class="cashier-register-head-actions"><button type="button" class="role-secondary" id="cashier-handoff">صف تحویل</button><button type="button" class="role-secondary" id="cashier-history">تاریخچه</button><button type="button" class="role-secondary" data-cashier-refresh>تازه‌سازی صف</button><button type="button" class="role-primary" id="new-order">سفارش جدید</button></div>';
    main.innerHTML = `${pageHead('صندوق فروش', 'صف تسویه', 'دریافت امن، مشاهدهٔ پرداخت‌های نامشخص و کنترل ماندهٔ سفارش', headerActions)}
      <section class="role-metrics">
        ${metric('منتظر تسویه', num(pending.length), pending.length ? 'نیازمند اقدام' : 'صف خالی')}
        ${metric('نیازمند تطبیق', num(reviewOrders.length), reviewOrders.length ? 'دریافت تازه متوقف است' : 'موردی نیست')}
        ${metric('فروش امروز', money(paidToday.reduce((sum, item) => sum + Number(item.total || 0), 0)), `${num(paidToday.length)} سفارش`)}
        ${metric('صندوق پول', drawer.session ? money(drawer.totals.expected) : 'بسته', drawer.session ? 'موجودی مورد انتظار' : 'برای نقدی باز شود')}
      </section>
      <section class="role-section"><div class="role-section__head"><h2>نیازمند تطبیق و اقدام امن</h2><span>${num(reviewOrders.length)} سفارش</span></div><div class="order-list">${reviewCards || empty('وضعیت نامعلوم یا ماندهٔ ناسازگار نداریم.')}</div></section>
      <section class="role-section" style="margin-top:14px"><div class="role-section__head"><h2>قابل دریافت طبق مرحلهٔ عملیاتی</h2><span>${num(receivableOrders.length)} سفارش</span></div><div class="order-list">${receivableCards || empty('سفارشی در این مرحله قابل دریافت نیست.')}</div></section>
      <section class="role-section" style="margin-top:14px"><div class="role-section__head"><h2>کنترل شیفت</h2><span>ایستگاه صندوق · ${drawer.session ? 'باز' : 'بسته'}</span></div>
        ${state.session.shift ? '<p>شیفت شما فعال است. دریافت نقدی فقط با صندوق پول باز ثبت می‌شود.</p>' : '<p>برای ثبت عملیات روز، ابتدا شیفت را شروع کنید.</p>'}
        <button class="role-secondary" data-go-view="drawer">مشاهده صندوق پول</button>
      </section>`;
    main.querySelector('#new-order')?.addEventListener('click', () => showOrderComposer('cashier'));
    main.querySelector('#cashier-history')?.addEventListener('click', cashierOrders);
    main.querySelector('#cashier-handoff')?.addEventListener('click', cashierHandoff);
    main.querySelectorAll('[data-cashier-refresh]').forEach((button) => button.addEventListener('click', () => refreshCashierQueue(button)));
    main.querySelectorAll('[data-settle]').forEach((button) => button.addEventListener('click', () => {
      const orderId = button.closest('[data-order-id]').dataset.orderId;
      const order = orders.find((item) => Number(item.id) === Number(orderId));
      const amounts = cashierSettlementAmounts(order);
      if (!order || !['unpaid', 'partial'].includes(orderPaymentStatus(order)) || !cashierSettlementStageCanSettle(order)
        || !amounts.ok || amounts.due <= 0 || cashierPendingSettlementForOrder(order)) {
        showToast('این فاکتور نیازمند تازه‌سازی یا تطبیق پرداخت است.', 'error');
        return;
      }
      openCashierSettlementDialog(order, button.dataset.settle, amounts.due);
    }));
    main.querySelectorAll('[data-cashier-retry-pending]').forEach((button) => button.addEventListener('click', () => {
      const orderId = button.closest('[data-order-id]').dataset.orderId;
      const order = orders.find((item) => Number(item.id) === Number(orderId));
      const pendingIntent = order && cashierPendingSettlementForOrder(order);
      const amounts = cashierSettlementAmounts(order);
      if (!order || !pendingIntent || pendingIntent.invalid || !cashierPendingMatchesOrder(order, pendingIntent, amounts)
        || pendingIntent.blockedReason || !['unpaid', 'partial'].includes(orderPaymentStatus(order))
        || !cashierSettlementStageCanSettle(order)) {
        showToast('درخواست قبلی با وضعیت فعلی قابل تکرار نیست؛ با سرپرست تطبیق دهید.', 'error');
        return;
      }
      submitCashierSettlement(order, pendingIntent.intent, button, pendingIntent);
    }));
    main.querySelectorAll('[data-cashier-status]').forEach((button) => button.addEventListener('click', () => {
      const orderId = button.closest('[data-order-id]').dataset.orderId;
      action(button, () => api(`/api/cashier/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.cashierStatus }) }), 'وضعیت سفارش تغییر کرد.');
    }));
    main.querySelector('[data-go-view]')?.addEventListener('click', () => { state.activeView = 'drawer'; paintNav(); render(); });
  }

  async function refreshCashierQueue(button) {
    setBusy(button, true);
    try {
      await fetchCashier();
      cashierRegister();
      showToast('وضعیت صف صندوق از سرور تازه شد.');
    } catch (error) {
      showToast(`صف تازه نشد: ${error.message}`, 'error');
    } finally {
      if (button?.isConnected) setBusy(button, false);
    }
  }

  function cashierHandoff() {
    const ready = (state.data.orders || []).filter((item) => item.status === 'ready' || item.status === 'dispatched');
    const cards = ready.map((order) => {
      const next = order.status === 'dispatched' ? 'delivered' : order.fulfillment === 'delivery' ? 'dispatched' : order.fulfillment === 'pickup' ? 'picked_up' : 'done';
      const label = ({ dispatched: 'تحویل به پیک', picked_up: 'تحویل شد', done: 'تحویل میز', delivered: 'رسید به مهمان' })[next];
      return orderCard(order, `<button class="role-primary" data-cashier-status="${next}">${label}</button>`);
    }).join('');
    main.innerHTML = `${pageHead('هماهنگی تحویل', 'تحویل سفارش', 'سفارش‌های آماده از آشپزخانه تا تحویل نهایی', '<button type="button" class="role-secondary" id="cashier-handoff-return">بازگشت به صف صندوق</button>')}
      <section class="role-metrics">${metric('آماده', num(ready.filter((item) => item.status === 'ready').length))}${metric('در مسیر', num(ready.filter((item) => item.status === 'dispatched').length))}${metric('میانگین انتظار', `${num(ready.length ? Math.round(ready.reduce((s,o)=>s+ageMin(o.readyAt || o.createdAt),0)/ready.length) : 0)} دقیقه`)}${metric('کل صف', num(ready.length))}</section>
      <section class="role-section"><div class="role-section__head"><h2>صف تحویل</h2><span>قدیمی‌ترها در اولویت</span></div><div class="order-list">${cards || empty('سفارش آماده‌ای وجود ندارد.')}</div></section>`;
    main.querySelector('#cashier-handoff-return')?.addEventListener('click', cashierRegister);
    main.querySelectorAll('[data-cashier-status]').forEach((button) => button.addEventListener('click', () => {
      const orderId = button.closest('[data-order-id]').dataset.orderId;
      action(button, () => api(`/api/cashier/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.cashierStatus }) }), 'تحویل ثبت شد.');
    }));
  }

  function cashierDrawer() {
    document.body.classList.remove('is-pos-station');
    const { session, totals } = state.data.drawer || {};
    if (!session) {
      main.innerHTML = `${pageHead('مدیریت وجه نقد', 'صندوق پول', 'شروع موجودی، ورود/خروج نقدی و تطبیق پایان شیفت')}
        <section class="role-section role-section--8"><div class="role-section__head"><h2>باز کردن صندوق</h2><span>موجودی اول شیفت</span></div>
        <div class="field-grid"><label class="field"><span>مبلغ اولیه (تومان)</span><input id="drawer-opening" inputmode="numeric" value="0" /></label></div>
        <p>پس از باز شدن، فروش‌های نقدی به‌صورت خودکار در همین نشست ثبت می‌شوند.</p><button class="role-primary" id="drawer-open">باز کردن صندوق</button></section>`;
      document.getElementById('drawer-open').addEventListener('click', (event) => {
        const openingAmount = parseCashDrawerInput(document.getElementById('drawer-opening'), { allowZero: true });
        if (openingAmount == null) return showToast('موجودی اولیه باید عدد صحیح و نامنفی باشد.', 'error');
        action(event.currentTarget, () => api('/api/cashier/drawer/open', {
          method: 'POST', body: JSON.stringify({ branchId: state.branchId, openingAmount }),
        }), 'صندوق پول باز شد.');
      });
      return;
    }
    main.innerHTML = `${pageHead('مدیریت وجه نقد', 'صندوق پول', 'تمام جابه‌جایی‌های نقدی این نشست قابل تطبیق است')}
      <div class="role-grid"><section class="role-section role-section--8"><div class="drawer-card"><span>نشست باز از ${time(session.openedAt)}</span><div class="drawer-card__amount"><span>موجودی مورد انتظار</span><strong>${money(totals.expected)}</strong></div>
      <div class="drawer-breakdown"><div><span>اول شیفت</span><b>${money(totals.opening)}</b></div><div><span>فروش نقدی</span><b>${money(totals.sales)}</b></div><div><span>ورود نقدی</span><b>${money(totals.payIn)}</b></div><div><span>خروج/بازپرداخت</span><b>${money(totals.payOut + totals.refunds)}</b></div></div></div></section>
      <section class="role-section role-section--4"><div class="role-section__head"><h2>عملیات صندوق</h2><span>ثبت ممیزی‌شده</span></div><div class="field-grid">
        <label class="field field--full"><span>مبلغ</span><input id="movement-amount" inputmode="numeric" /></label><label class="field field--full"><span>شرح</span><input id="movement-note" maxlength="160" /></label>
      </div><div class="order-actions" style="margin-top:12px"><button class="role-secondary" data-movement="pay_in">ورود نقدی</button><button class="role-secondary" data-movement="pay_out">خروج نقدی</button><button class="role-danger" id="drawer-close">بستن و شمارش</button></div></section>
      <section class="role-section"><div class="role-section__head"><h2>گردش‌های نشست</h2><span>${num(session.movements?.length || 0)} رکورد</span></div><div class="order-list">${(session.movements || []).map((item) => `<div class="order-card"><div class="order-card__top"><strong>${esc(({ sale:'فروش نقدی', pay_in:'ورود نقدی', pay_out:'خروج نقدی', refund:'بازپرداخت' })[item.type] || item.type)}</strong><span>${time(item.at)}</span></div><div class="order-card__bottom"><span>${esc(item.note || '—')}</span><b>${money(item.amount)}</b></div>${item.financeStatus === 'blocked' ? '<small class="cash-movement-finance-state" role="status">در انتظار تعیین حساب مقابل؛ هنوز در دفتر کل ثبت نشده است.</small>' : item.financeStatus === 'posted' ? '<small class="cash-movement-finance-state is-posted" role="status">ثبت در دفتر مالی تأیید شده است.</small>' : item.financeStatus ? '<small class="cash-movement-finance-state" role="status">وضعیت ثبت دفتر مالی نیازمند بررسی است.</small>' : ''}</div>`).join('') || empty('هنوز گردشی ثبت نشده است.')}</div></section></div>`;
    main.querySelectorAll('[data-movement]').forEach((button) => button.addEventListener('click', async () => {
      const amount = parseCashDrawerInput(document.getElementById('movement-amount'));
      if (amount == null) return showToast('مبلغ ورود یا خروج باید عدد صحیح و بزرگ‌تر از صفر باشد.', 'error');
      const payload = {
        branchId: state.branchId, type: button.dataset.movement, amount,
        note: document.getElementById('movement-note').value,
      };
      const sessionId = session.id;
      const idempotencyKey = cashDrawerMovementIdempotencyKey(button, payload, sessionId);
      let movementResult = null;
      const completed = await action(button, async () => {
        movementResult = await api('/api/cashier/drawer/movements', {
          method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(payload),
        });
      });
      if (completed) {
        const financeStatus = movementResult?.finance?.event?.status || movementResult?.movement?.financeStatus;
        if (financeStatus === 'posted') showToast('گردش صندوق و ثبت دفتر مالی تأیید شد.');
        else if (financeStatus === 'blocked') showToast('در صندوق ثبت شد؛ اما تا تعیین حساب مقابل، در دفتر کل ثبت نمی‌شود.', 'warning');
        else showToast('گردش صندوق ثبت شد؛ وضعیت دفتر مالی را در صف تطبیق بررسی کنید.', 'warning');
        clearCashDrawerMovementIntent(payload, sessionId);
      }
    }));
    document.getElementById('drawer-close').addEventListener('click', () => {
      openDialog('پایان نشست', 'شمارش صندوق', `<div class="field-grid"><label class="field field--full"><span>مبلغ شمارش‌شده</span><input id="drawer-counted" inputmode="numeric" value="${Math.round(totals.expected)}" /></label></div><p>انتظار سیستم: <b>${money(totals.expected)}</b></p><button class="role-danger" id="confirm-drawer-close">تأیید و بستن صندوق</button>`);
      document.getElementById('confirm-drawer-close').addEventListener('click', async (event) => {
        const countedAmount = parseCashDrawerInput(document.getElementById('drawer-counted'), { allowZero: true });
        if (countedAmount == null) return showToast('مبلغ شمارش‌شده باید عدد صحیح و نامنفی باشد.', 'error');
        let closeResult = null;
        const completed = await action(event.currentTarget, async () => {
          closeResult = await api('/api/cashier/drawer/close', {
            method: 'POST', body: JSON.stringify({ branchId: state.branchId, sessionId: session.id, countedAmount }),
          });
          dialog.close();
        });
        if (completed) showToast(cashDrawerVarianceMessage(closeResult?.totals?.variance));
      });
    });
  }

  async function fetchWaiter() {
    const requestedBranchId = state.branchId;
    const requestedBranchGeneration = state.waiterBranchGeneration || 0;
    const requestId = state.waiterSnapshotRequestId = (state.waiterSnapshotRequestId || 0) + 1;
    const branchParam = requestedBranchId ? `?branchId=${encodeURIComponent(requestedBranchId)}` : '';
    const isCurrentRequest = () => requestId === state.waiterSnapshotRequestId
      && requestedBranchGeneration === (state.waiterBranchGeneration || 0)
      && String(requestedBranchId ?? '') === String(state.branchId ?? '');
    let snapshot;
    try {
      snapshot = await Promise.all([
        Promise.all([
          api(`/api/admin/v2/floor${branchParam}`), api(`/api/waiter/calls${branchParam}`), api(`/api/admin/orders${branchParam}`),
        ]),
        Promise.allSettled([
          api(`/api/admin/reservations${branchParam}`), api(`/api/waiter/waitlist${branchParam}`),
        ]),
      ]);
    } catch (error) {
      if (!isCurrentRequest()) return false;
      throw error;
    }
    if (!isCurrentRequest()) return false;
    const [[floor, calls, orders], [reservationsResult, waitlistResult]] = snapshot;
    const reservationsAvailable = reservationsResult.status === 'fulfilled';
    const waitlistAvailable = waitlistResult.status === 'fulfilled';
    state.data = {
      floor,
      calls: calls.calls || [],
      orders: orders.orders || [],
      reservations: reservationsAvailable ? reservationsResult.value : null,
      waitlist: waitlistAvailable ? (waitlistResult.value.waitlist || []) : [],
      waitlistSummary: waitlistAvailable ? (waitlistResult.value.summary || {}) : {},
      waiterDataIssues: { reservations: !reservationsAvailable, waitlist: !waitlistAvailable },
    };
    return true;
  }

  async function refreshWaiterAfterMutation() {
    try {
      return await fetchWaiter();
    } catch (error) {
      showToast(`عملیات ثبت شد، اما تازه‌سازی اطلاعات سالن انجام نشد: ${error.message}`, 'error');
      return false;
    }
  }

  function waiterMetrics() {
    const activeOrders = (state.data.orders || []).filter((item) => item.fulfillment === 'dine_in' && orderIsOpen(item));
    const openCalls = (state.data.calls || []).filter((call) => ['open', 'new'].includes(String(call.status || 'open')));
    const reservationsUnavailable = Boolean(state.data.waiterDataIssues?.reservations);
    const activeTables = (state.data.floor?.tables || []).filter((table) => {
      const context = waiterTableContext(table);
      return context.orders.length || context.calls.length || ['busy', 'attention'].includes(table.state);
    });
    return `<section class="role-metrics">${metric('فراخوان باز', num(openCalls.length), openCalls.length ? 'نیازمند رسیدگی' : 'همه پاسخ داده شده')}${metric('میز در سرویس', num(activeTables.length))}${metric('سفارش فعال', num(activeOrders.length))}${metric('رزرو امروز', reservationsUnavailable ? '—' : num(state.data.reservations?.summary?.today || 0), reservationsUnavailable ? 'اطلاعات در دسترس نیست' : `${num(state.data.reservations?.summary?.todayCovers || 0)} نفر`)}</section>`;
  }

  function waiterFloor() {
    document.body.classList.add('is-waiter-floor-app');
    document.body.classList.remove('is-waiter-terminal');
    const tables = state.data.floor.tables || [];
    tables.forEach(ensureTableGeometry);
    const workspaceCapabilities = state.session?.workspace?.capabilities || [];
    const canEditFloor = workspaceCapabilities.includes('*') || workspaceCapabilities.includes('tables.manage');
    if (!canEditFloor) state.waiterFloorEditing = false;
    if (!state.waiterFloorMode) {
      const isMobile = window.matchMedia?.('(max-width: 768px)').matches;
      const preferredMode = readLocal(waiterFloorModeStorageKey(), '');
      state.waiterFloorMode = ['plan', 'grid'].includes(preferredMode)
        ? preferredMode
        : (isMobile ? 'grid' : 'plan');
    }
    state.waiterFloorZone = state.waiterFloorZone || readLocal('westo_waiter_floor_zone', 'all') || 'all';
    if (state.waiterFloorZone !== 'all') state.waiterFloorZone = normalizeRoleFloorZoneName(state.waiterFloorZone);
    paintWaiterHeaderContext();

    const definedZones = (state.data.floor?.zones || []).map((zone) => normalizeRoleFloorZoneName(zone.name)).filter(Boolean);
    const tableZones = tables.map((table) => normalizeRoleFloorZoneName(table.zone)).filter(Boolean);
    const zones = ['all', ...new Set([...definedZones, ...tableZones, 'سالن'])];
    const visibleTables = state.waiterFloorZone === 'all'
      ? tables
      : tables.filter((table) => normalizeRoleFloorZoneName(table.zone) === state.waiterFloorZone);
    const floorContexts = new Map(tables.map((table) => [String(table.id), waiterTableContext(table)]));
    const displayTables = visibleTables.map((table) => ({ ...table, ...floorContexts.get(String(table.id)) }));
    const priorityForTable = (table) => {
      const context = floorContexts.get(String(table.id));
      if (context?.calls.length) return 0;
      if (context?.readyOrders.length) return 1;
      if (context?.orders.length) return 2;
      if (context?.state === 'reserved') return 3;
      return 4;
    };
    const gridTables = [...displayTables].sort((a, b) => priorityForTable(a) - priorityForTable(b) || Number(a.id) - Number(b.id));
    const activeOrders = (state.data.orders || []).filter((order) => order.fulfillment === 'dine_in' && orderIsOpen(order));
    const readyOrders = activeOrders.filter((order) => order.status === 'ready');
    const openCalls = (state.data.calls || []).filter((call) => ['open', 'new'].includes(String(call.status || 'open')));
    const unmappedOrders = waiterUnmappedOrders(activeOrders);

    const toolbarHtml = `
      <div class="floor-toolbar">
        <div class="floor-toolbar__group">
          <div class="floor-zone-pills">
            ${zones.map((z) => {
              const icon = z === 'سالن' ? '🛋️ ' : z === 'تراس' ? '🌿 ' : z === 'ویژه' ? '👑 ' : z === 'فضای باز' ? '🏷️ ' : '';
              const label = z === 'all' ? 'همه بخش‌ها' : z;
              const count = z === 'all' ? tables.length : tables.filter((table) => normalizeRoleFloorZoneName(table.zone) === z).length;
              return `<button type="button" class="floor-zone-pill ${state.waiterFloorZone === z ? 'active' : ''}" data-zone-filter="${esc(z)}" aria-pressed="${state.waiterFloorZone === z ? 'true' : 'false'}"><span>${icon}${esc(label)}</span><small>${num(count)}</small></button>`;
            }).join('')}
          </div>
        </div>

        <div class="floor-toolbar__group floor-toolbar__group--waiter-status" aria-label="خلاصه عملیات سالن">
          <button type="button" class="floor-metric-chip ${openCalls.length ? 'has-calls' : ''}" data-waiter-quick-view="calls">
            <span>🔔</span><small>${num(openCalls.length)} فراخوان</small>
          </button>
          <button type="button" class="floor-metric-chip ${readyOrders.length ? 'has-ready' : ''}" data-waiter-quick-view="orders">
            <span>🍽️</span><small>${num(readyOrders.length)} آماده</small>
          </button>
          <button type="button" class="floor-metric-chip is-stat ${unmappedOrders.length ? 'has-unmapped' : ''}" data-waiter-quick-view="${unmappedOrders.length ? 'unmapped-orders' : 'orders'}" aria-label="${unmappedOrders.length ? `${num(unmappedOrders.length)} سفارش فعال بدون میز؛ برای بررسی و تخصیص میز باز کنید` : `${num(activeOrders.length)} سفارش فعال؛ مشاهده سفارش‌ها`}"><span>${unmappedOrders.length ? '⚠️' : '🧾'}</span><small>${num(activeOrders.length)} فعال${unmappedOrders.length ? ` · ${num(unmappedOrders.length)} بی‌میز · بررسی` : ''}</small></button>
          <span class="floor-toolbar__hint" role="status">${waiterHasCapability('orders.create') ? 'برای سفارش‌گیری، میز را لمس کنید' : 'نمایش سالن مجاز است؛ برای ساخت سفارش از مدیر شیفت دسترسی بخواهید.'}</span>
          ${canEditFloor ? '' : '<span class="floor-toolbar__hint" role="status" style="display:block;grid-column:1/-1;margin:0;color:#475569;font-size:12px;line-height:1.5;white-space:normal">چیدمان فقط‌خواندنی است؛ تغییر آن از این فضای کاری مجاز نیست.</span>'}
        </div>

        ${state.waiterFloorEditing && canEditFloor ? `
          <div class="floor-toolbar__group floor-toolbar__group--edit">
            <button type="button" class="btn btn-sm btn-ghost" id="floor-add-table">+ افزودن میز</button>
            <button type="button" class="btn btn-sm btn-ghost" id="floor-reset-layout">↺ پیش‌فرض</button>
            <button type="button" class="btn btn-sm btn-ghost" id="floor-cancel-edit">✕</button>
            <button type="button" class="role-primary" id="floor-save-layout" style="background:#10b981;border-color:#059669">✓ ذخیره چیدمان</button>
          </div>
        ` : canEditFloor ? `
          <div class="floor-toolbar__group floor-toolbar__group--tools">
            <button type="button" class="floor-edit-toggle" id="floor-toggle-edit">📐 چیدمان</button>
          </div>
        ` : ''}
      </div>`;

    const planCanvasHtml = buildPlanCanvasHtml(displayTables, state.waiterFloorZone, {
      isEditMode: state.waiterFloorEditing,
      id: 'floor-canvas',
      tablesLayerId: 'plan-tables-layer',
      allowEdit: canEditFloor,
      disableInactive: true,
      attr: (t) => `data-table="${esc(t.id)}"`
    });


    const classicGridHtml = `
      <div class="floor-grid" style="overflow-y:auto;flex:1;min-height:0;padding:8px">
        ${gridTables.map((table) => `
          <button class="floor-table waiter-table-card ${table.calls.length ? 'has-call' : ''} ${table.readyOrders.length ? 'has-ready' : ''}" data-table="${esc(table.id)}" data-state="${esc(table.active === false ? 'inactive' : table.state)}" ${table.autoReleased ? 'data-auto-released="true"' : ''} ${table.active === false && !state.waiterFloorEditing ? 'disabled aria-disabled="true" title="این میز غیرفعال است؛ برای سفارش از میز فعال استفاده کنید"' : ''} aria-label="${esc([
            table.label || `میز ${table.id}`,
            table.stateLabel,
            `${num(table.seats)} نفر`,
            normalizeRoleFloorZoneName(table.zone),
            table.calls.length ? `${num(table.calls.length)} فراخوان باز` : '',
            table.readyOrders.length ? `${num(table.readyOrders.length)} سفارش آماده تحویل` : '',
            table.orders.length ? `${num(table.orders.length)} فاکتور باز` : '',
          ].filter(Boolean).join('، '))}">
            <span class="waiter-table-card__top"><strong>${esc(table.label || `میز ${table.id}`)}</strong><b>${esc(table.stateLabel)}</b></span>
            <small>${num(table.seats)} نفر · ${esc(normalizeRoleFloorZoneName(table.zone))}</small>
            ${table.orders.length ? `<em>${num(table.orders.reduce((sum, order) => sum + (order.items || []).length, 0))} قلم در ${num(table.orders.length)} فاکتور</em>` : '<em>آماده پذیرش مهمان</em>'}
            ${table.serviceEndsAt && !table.autoReleased && ['busy', 'attention'].includes(table.state) ? `<time class="plan-table-timer" data-service-ends="${esc(table.serviceEndsAt)}" style="margin-top:6px;display:inline-block">${floorCountdownLabel(table.serviceEndsAt)}</time>` : ''}
          </button>`).join('') || empty('میزی تعریف نشده است.')}
      </div>`;

    main.innerHTML = `
      <div class="waiter-floor-screen">
        ${toolbarHtml}
        ${state.waiterFloorMode === 'plan' ? planCanvasHtml : classicGridHtml}
      </div>`;

    wireWaiterFloorEvents();
    startFloorCountdown();
  }

  function wireWaiterFloorEvents() {
    // Mode toggles
    const planBtn = document.getElementById('floor-view-plan');
    const gridBtn = document.getElementById('floor-view-grid');
    if (planBtn) planBtn.addEventListener('click', () => { state.waiterFloorMode = 'plan'; localStorage.setItem(waiterFloorModeStorageKey(), JSON.stringify('plan')); waiterFloor(); });
    if (gridBtn) gridBtn.addEventListener('click', () => { state.waiterFloorMode = 'grid'; localStorage.setItem(waiterFloorModeStorageKey(), JSON.stringify('grid')); waiterFloor(); });

    // Zone filters
    main.querySelectorAll('[data-zone-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.waiterFloorZone = btn.dataset.zoneFilter;
        localStorage.setItem('westo_waiter_floor_zone', JSON.stringify(state.waiterFloorZone));
        waiterFloor();
      });
    });

    main.querySelectorAll('[data-waiter-quick-view]').forEach((button) => button.addEventListener('click', () => {
      const target = button.dataset.waiterQuickView;
      state.waiterUnmappedOnly = target === 'unmapped-orders';
      state.activeView = state.waiterUnmappedOnly ? 'orders' : target;
      paintNav();
      render();
    }));

    // Edit mode controls
    const toggleEditBtn = document.getElementById('floor-toggle-edit');
    if (toggleEditBtn) toggleEditBtn.addEventListener('click', () => {
      state.waiterFloorEditing = true;
      state.waiterFloorMode = 'plan';
      waiterFloor();
    });

    const cancelEditBtn = document.getElementById('floor-cancel-edit');
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', () => {
      state.waiterFloorEditing = false;
      state.selectedTableId = null;
      waiterFloor();
    });

    const resetLayoutBtn = document.getElementById('floor-reset-layout');
    if (resetLayoutBtn) resetLayoutBtn.addEventListener('click', () => {
      if (confirm('آیا مایل به بازنشانی چیدمان میزها به حالت استاندارد مهندسی هستید؟')) {
        const tables = state.data.floor.tables || [];
        tables.forEach((t, i) => {
          delete t.x;
          delete t.y;
          delete t.shape;
          delete t.rotation;
          ensureTableGeometry(t, i);
        });
        waiterFloor();
      }
    });

    const addTableBtn = document.getElementById('floor-add-table');
    if (addTableBtn) addTableBtn.addEventListener('click', () => {
      const tables = state.data.floor.tables || [];
      const nextId = Math.max(0, ...tables.map((t) => Number(t.id) || 0)) + 1;
      const newTable = {
        id: nextId,
        label: `میز ${nextId}`,
        seats: 4,
        zone: state.waiterFloorZone === 'all' ? 'سالن' : state.waiterFloorZone,
        state: 'available',
        stateLabel: 'آزاد',
        shape: 'rectangle',
        rotation: 0,
        x: 50,
        y: 50,
        active: true,
      };
      tables.push(newTable);
      state.selectedTableId = nextId;
      waiterFloor();
    });

    const saveLayoutBtn = document.getElementById('floor-save-layout');
    if (saveLayoutBtn) saveLayoutBtn.addEventListener('click', async (event) => {
      const tables = state.data.floor.tables || [];
      const payload = {
        tables: tables.map((t) => ({
          id: t.id,
          label: t.label,
          seats: Number(t.seats) || 4,
          zone: t.zone || 'سالن',
          x: Math.round(Number(t.x) * 10) / 10,
          y: Math.round(Number(t.y) * 10) / 10,
          shape: t.shape || 'rectangle',
          rotation: Number(t.rotation) || 0,
        })),
      };
      await action(event.currentTarget, async () => {
        const res = await api(`/api/admin/v2/floor/layout${qs()}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        if (res.floor) state.data.floor = res.floor;
        state.waiterFloorEditing = false;
        state.selectedTableId = null;
        waiterFloor();
      }, 'چیدمان سالن با موفقیت ذخیره شد.');
    });

    const newOrderBtn = document.getElementById('new-order');
    if (newOrderBtn) newOrderBtn.addEventListener('click', () => showOrderComposer('waiter'));

    // Canvas Drag & Drop and Table Selection
    const canvas = document.getElementById('floor-canvas');
    if (!canvas) {
      // Classic grid click handlers
      main.querySelectorAll('.floor-table').forEach((button) => {
        button.addEventListener('click', () => showTableDetail(button.dataset.table));
      });
      return;
    }

    if (state.waiterFloorMode === 'plan') {
      setupFloorCanvasPanZoom('floor-canvas', { activeZone: state.waiterFloorZone });
    }

    let activeDrag = null;

    canvas.querySelectorAll('.plan-table').forEach((el) => {
      const tableId = el.dataset.table;
      const table = (state.data.floor.tables || []).find((t) => String(t.id) === String(tableId));
      if (!table) return;

      // Click in normal mode opens detail (ignored if canvas was just panned)
      el.addEventListener('click', (e) => {
        if (state.canvasDragging) return;
        if (table.active === false && !state.waiterFloorEditing) return;
        if (state.waiterFloorEditing) {
          if (e.target.closest('.table-floating-palette')) return;
          state.selectedTableId = table.id;
          waiterFloor();
        } else {
          showTableDetail(table.id);
        }
      });

      // Keep the visual floor plan usable without a mouse or touch screen.
      el.addEventListener('keydown', (e) => {
        if (!['Enter', ' '].includes(e.key) || e.target.closest('.table-floating-palette')) return;
        if (table.active === false && !state.waiterFloorEditing) return;
        e.preventDefault();
        if (state.waiterFloorEditing) {
          state.selectedTableId = table.id;
          waiterFloor();
        } else {
          showTableDetail(table.id);
        }
      });

      // Pointer drag in edit mode
      if (state.waiterFloorEditing) {
        el.addEventListener('pointerdown', (e) => {
          if (e.target.closest('.table-floating-palette')) return;
          e.preventDefault();
          const stageEl = canvas.querySelector('.floor-canvas-stage') || canvas;
          const rect = stageEl.getBoundingClientRect();
          activeDrag = {
            table,
            el,
            startX: e.clientX,
            startY: e.clientY,
            originX: table.x,
            originY: table.y,
            rect,
          };
          el.classList.add('is-dragging');
          state.selectedTableId = table.id;
          el.setPointerCapture(e.pointerId);
        });

        el.addEventListener('pointermove', (e) => {
          if (!activeDrag || activeDrag.table.id !== table.id) return;
          const dx = ((e.clientX - activeDrag.startX) / activeDrag.rect.width) * 100;
          const dy = ((e.clientY - activeDrag.startY) / activeDrag.rect.height) * 100;
          let newX = Math.round((activeDrag.originX + dx) * 2) / 2; // snap to 0.5%
          let newY = Math.round((activeDrag.originY + dy) * 2) / 2;
          newX = Math.max(6, Math.min(94, newX));
          newY = Math.max(6, Math.min(94, newY));
          table.x = newX;
          table.y = newY;
          el.style.left = `${newX}%`;
          el.style.top = `${newY}%`;
        });

        const endDrag = (e) => {
          if (!activeDrag || activeDrag.table.id !== table.id) return;
          el.classList.remove('is-dragging');
          try { el.releasePointerCapture(e.pointerId); } catch (_) {}
          activeDrag = null;
        };
        el.addEventListener('pointerup', endDrag);
        el.addEventListener('pointercancel', endDrag);

        // Palette action handlers inside this table
        const palette = el.querySelector('.table-floating-palette');
        if (palette) {
          palette.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-table-action]');
            if (!btn) return;
            e.stopPropagation();
            const actionType = btn.dataset.tableAction;
            if (actionType === 'rotate') {
              table.rotation = ((Number(table.rotation) || 0) + 45) % 360;
              waiterFloor();
            } else if (actionType === 'toggle-shape') {
              const shapeCycle = ['rectangle', 'conference', 'semi_circle', 'wall_counter', 'circle', 'square', 'oval', 'booth', 'round_booth', 'bar_stool', 'lounge_takht'];
              const currIdx = shapeCycle.indexOf(table.shape || 'rectangle');
              table.shape = shapeCycle[(currIdx + 1) % shapeCycle.length];
              waiterFloor();
            } else if (actionType === 'inc-seats') {
              table.seats = Math.min(24, (Number(table.seats) || 2) + 1);
              waiterFloor();
            } else if (actionType === 'dec-seats') {
              table.seats = Math.max(1, (Number(table.seats) || 4) - 1);
              waiterFloor();
            } else if (actionType === 'rename') {
              const newLabel = prompt(`نام یا برچسب میز ${table.id} را وارد کنید:`, table.label || `میز ${table.id}`);
              if (newLabel && newLabel.trim()) {
                table.label = newLabel.trim();
                waiterFloor();
              }
            }
          });

          const zoneSelect = palette.querySelector('select[data-table-action="zone-select"]');
          if (zoneSelect) {
            zoneSelect.addEventListener('change', (e) => {
              table.zone = e.target.value;
              waiterFloor();
            });
          }
        }
      }
    });
  }

  function callsHtml() {
    const calls = [...(state.data.calls || [])]
      .filter((call) => ['open', 'new'].includes(String(call.status || 'open')))
      .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    const canResolveCalls = waiterHasCapability('service.manage');
    return `<div class="call-list">${calls.map((call) => {
      const key = waiterCallStateKey(call.id);
      const needsRefresh = state.waiterCallNeedsRefresh.has(key);
      const inFlight = state.waiterCallMutations.has(key);
      const blocked = !canResolveCalls || needsRefresh || inFlight;
      const label = !canResolveCalls ? 'نیازمند مجوز رسیدگی' : needsRefresh ? 'ابتدا وضعیت را بررسی کنید' : inFlight ? 'در حال ثبت…' : 'رسیدگی شد';
      return `<article class="call-row" data-call-id="${esc(call.id)}" aria-label="فراخوان ${esc(call.tableNo || 'میز نامشخص')}"><b>${esc(call.tableNo || 'میز نامشخص')}</b><div><p>${esc(call.note || 'درخواست گارسون')}</p><small>${num(ageMin(call.createdAt))} دقیقه قبل</small>${!canResolveCalls ? '<small role="status">برای رسیدگی به فراخوان، مجوز لازم است.</small>' : ''}</div>${needsRefresh ? `<button type="button" class="role-secondary" data-refresh-call-status aria-label="بررسی وضعیت فراخوان ${esc(call.tableNo || '')}">بررسی وضعیت</button>` : ''}<button type="button" class="role-primary" data-resolve-call aria-label="رسیدگی به فراخوان ${esc(call.tableNo || '')}" title="${!canResolveCalls ? 'از مدیر شیفت دسترسی رسیدگی به فراخوان را درخواست کنید.' : ''}" ${blocked ? 'disabled aria-disabled="true"' : ''}>${label}</button></article>`;
    }).join('') || empty('فراخوان بازی وجود ندارد.')}</div>`;
  }

  function waiterCallStateKey(callId, branchId = state.branchId) {
    return `${String(branchId ?? '')}:${String(callId ?? '')}`;
  }

  function paintWaiterCallView() {
    if (dialog.open) {
      if (!(state.data.calls || []).length) {
        dialog.close();
        return;
      }
      openDialog('فراخوان‌های مهمان', `${num((state.data.calls || []).length)} درخواست`, callsHtml());
      wireCalls(dialog);
      return;
    }
    if (state.activeView === 'floor') waiterFloor();
    else if (state.activeView === 'calls') waiterCalls();
  }

  async function refreshWaiterCallSnapshot(button = null) {
    const requestedBranchId = state.branchId;
    const requestedBranchGeneration = state.waiterBranchGeneration || 0;
    const isCurrentBranch = () => String(state.branchId ?? '') === String(requestedBranchId ?? '')
      && (state.waiterBranchGeneration || 0) === requestedBranchGeneration;
    setBusy(button, true);
    try {
      const loaded = await fetchWaiter();
      if (!loaded || !isCurrentBranch()) return false;
      const branchPrefix = `${String(requestedBranchId ?? '')}:`;
      for (const key of state.waiterCallNeedsRefresh) {
        if (key.startsWith(branchPrefix)) state.waiterCallNeedsRefresh.delete(key);
      }
      paintWaiterCallView();
      showToast('وضعیت فراخوان‌ها به‌روز شد.');
      return true;
    } catch (error) {
      showToast(`وضعیت فراخوان تازه نشد؛ درخواست را دوباره نفرستید. ${error.message}`, 'warning');
      return false;
    } finally {
      setBusy(button, false);
    }
  }

  async function resolveWaiterCall(button) {
    if (typeof waiterHasCapability === 'function' && !waiterHasCapability('service.manage')) {
      showToast('رسیدگی به فراخوان در دسترسی شما نیست؛ از مدیر شیفت مجوز این کار را درخواست کنید.', 'error');
      return false;
    }
    const row = button?.closest('[data-call-id]');
    const callId = String(row?.dataset.callId || '');
    if (!callId) return false;
    const requestedBranchId = state.branchId;
    const requestedBranchGeneration = state.waiterBranchGeneration || 0;
    const key = waiterCallStateKey(callId, requestedBranchId);
    if (state.waiterCallNeedsRefresh.has(key)) {
      showToast('نتیجهٔ رسیدگی قبلی روشن نیست؛ ابتدا وضعیت فراخوان را بررسی کنید.', 'warning');
      return false;
    }
    if (state.waiterCallMutations.has(key)) return false;
    state.waiterCallMutations.add(key);
    setBusy(button, true);
    try {
      await api(`/api/waiter/calls/${encodeURIComponent(callId)}`, {
        method: 'PATCH', body: JSON.stringify({ status: 'done' }),
      });
    } catch (error) {
      if (!error.outcomeUnknown) {
        showToast(error.message, 'error');
        return false;
      }
      state.waiterCallNeedsRefresh.add(key);
      showToast('پاسخ رسیدگی نامشخص است؛ تا تازه‌شدن وضعیت، این فراخوان دوباره ارسال نمی‌شود.', 'warning');
      state.waiterCallMutations.delete(key);
      const loaded = await refreshWaiterCallSnapshot();
      if (!loaded && String(state.branchId ?? '') === String(requestedBranchId ?? '')
        && (state.waiterBranchGeneration || 0) === requestedBranchGeneration) paintWaiterCallView();
      if (loaded && String(state.branchId ?? '') === String(requestedBranchId ?? '')
        && (state.waiterBranchGeneration || 0) === requestedBranchGeneration) {
        const stillOpen = (state.data.calls || []).some((call) => String(call.id) === callId);
        showToast(stillOpen ? 'فراخوان هنوز باز است؛ پس از بررسی می‌توانید دوباره رسیدگی کنید.' : 'رسیدگی به فراخوان در سرور تأیید شد.');
      }
      return false;
    } finally {
      state.waiterCallMutations.delete(key);
      setBusy(button, false);
    }

    if (String(state.branchId ?? '') !== String(requestedBranchId ?? '')
      || (state.waiterBranchGeneration || 0) !== requestedBranchGeneration) {
      showToast('رسیدگی ثبت شد؛ شعبه هنگام پاسخ تغییر کرده است. فهرست شعبهٔ فعلی تازه شد.', 'warning');
      return true;
    }

    state.data.calls = (state.data.calls || []).filter((call) => String(call.id) !== callId);
    paintWaiterCallView();
    showToast('رسیدگی به فراخوان ثبت شد.');
    try {
      const loaded = await fetchWaiter();
      if (loaded && String(state.branchId ?? '') === String(requestedBranchId ?? '')
        && (state.waiterBranchGeneration || 0) === requestedBranchGeneration) {
        if (dialog.open) state.waiterRefreshPending = true;
        else refreshWaiterViewAfterSync();
      }
    } catch (error) {
      showToast(`رسیدگی ثبت شد، اما تازه‌سازی فهرست ناموفق بود؛ فهرست را دستی تازه کنید. ${error.message}`, 'warning');
    }
    return true;
  }

  function wireCalls(root = document) {
    root.querySelectorAll('[data-resolve-call]').forEach((button) => button.addEventListener('click', () => resolveWaiterCall(button)));
    root.querySelectorAll('[data-refresh-call-status]').forEach((button) => button.addEventListener('click', () => refreshWaiterCallSnapshot(button)));
    root.querySelectorAll('[data-refresh-waiter-calls]').forEach((button) => button.addEventListener('click', () => refreshWaiterCallSnapshot(button)));
  }

  function showTableDetail(tableId) {
    const table = (state.data.floor?.tables || []).find((item) => String(item.id) === String(tableId));
    const tableCalls = waiterCallsForTable(table || { id: tableId, label: `میز ${tableId}` });

    if (!tableCalls.length) {
      openWaiterTerminal(tableId);
      return;
    }

    const canResolveCalls = waiterHasCapability('service.manage');
    const canCreateOrders = waiterHasCapability('orders.create');
    const hasOpenOrder = (state.data.orders || []).some((order) => tableNoBelongsToTable(order.tableNo, tableId) && orderIsOpen(order));
    let callsSectionHtml = `
      <div class="table-calls-alert-box" style="margin-bottom:14px;padding:12px 14px;background:rgba(244,63,94,0.12);border:1.5px solid #f43f5e;border-radius:14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <strong style="color:#f43f5e;display:flex;align-items:center;gap:6px;font-size:14px;">
            <span>🔔</span> <span>فراخوان مهمان (${num(tableCalls.length)})</span>
          </strong>
          <span style="font-size:11px;color:#fca5a5;background:rgba(244,63,94,0.2);padding:2px 8px;border-radius:10px;">نیازمند رسیدگی فوری</span>
        </div>
        ${tableCalls.map((c) => {
          const callKey = waiterCallStateKey(c.id);
          const needsRefresh = state.waiterCallNeedsRefresh.has(callKey);
          const inFlight = state.waiterCallMutations.has(callKey);
          return `
          <div class="call-row call-row--table-detail" data-call-id="${c.id}" style="padding:8px 10px;background:rgba(0,0,0,0.3);border-radius:10px;margin-bottom:6px;">
            <div>
              <p style="margin:0;font-size:13px;font-weight:700;color:#fff;">${esc(c.note || 'درخواست حضور گارسون')}</p>
              <small style="color:#94a3b8;font-size:11px;">${time(c.createdAt)} (${num(ageMin(c.createdAt))} دقیقه قبل)</small>
              ${!canResolveCalls ? '<small role="status">برای رسیدگی، مجوز لازم است.</small>' : ''}
            </div>
            ${needsRefresh ? '<button type="button" class="role-secondary" data-refresh-call-status>بررسی وضعیت</button>' : ''}
            <button type="button" class="role-primary" data-resolve-call aria-label="رسیدگی به فراخوان ${esc(c.tableNo || table?.label || tableId)}" title="${!canResolveCalls ? 'از مدیر شیفت دسترسی رسیدگی به فراخوان را درخواست کنید.' : ''}" ${!canResolveCalls || needsRefresh || inFlight ? 'disabled aria-disabled="true"' : ''} style="background:#10b981;border:none;">
              ${!canResolveCalls ? 'نیازمند مجوز' : needsRefresh ? 'ابتدا وضعیت را بررسی کنید' : inFlight ? 'در حال ثبت…' : 'رسیدگی شد ✓'}
            </button>
          </div>
        `;
        }).join('')}
      </div>
    `;

    openDialog(
      'فراخوان و سرویس میز',
      table?.label || `میز ${tableId}`,
      `${callsSectionHtml}
       <div style="display:flex;gap:8px;margin-top:12px">
         <button type="button" class="role-primary" id="table-open-terminal" ${!canCreateOrders && !hasOpenOrder ? 'disabled aria-disabled="true" title="برای ساخت سفارش از مدیر شیفت دسترسی بخواهید."' : ''} style="flex:1">${canCreateOrders ? '📱 سفارش‌گیری / مشاهدهٔ فاکتور' : hasOpenOrder ? 'مشاهدهٔ فاکتور میز' : 'ساخت سفارش در دسترس نیست'}</button>
       </div>`
    );

    wireCalls(dialog);
    document.getElementById('table-open-terminal')?.addEventListener('click', async (event) => {
      if (!canCreateOrders && !hasOpenOrder) return;
      const button = event.currentTarget;
      setBusy(button, true);
      dialog.close();
      try { await openWaiterTerminal(tableId); }
      finally { setBusy(button, false); }
    });
  }

  function highestWaiterAssignedSeat(items = []) {
    return (Array.isArray(items) ? items : []).reduce((highest, line) => {
      const seat = Number(line?.seat);
      return Number.isInteger(seat) && seat > highest ? seat : highest;
    }, 0);
  }

  function validateWaiterCovers(covers, items = []) {
    const count = Number(covers);
    if (!Number.isInteger(count) || count < 1 || count > 99) return { ok: false, error: 'covers_invalid' };
    if ((Array.isArray(items) ? items : []).some((line) => {
      const seat = Number(line?.seat || 0);
      return !Number.isInteger(seat) || seat < 0;
    })) return { ok: false, error: 'seat_exceeds_covers' };
    if (highestWaiterAssignedSeat(items) > count) return { ok: false, error: 'seat_exceeds_covers' };
    return { ok: true, covers: count };
  }

  function waiterCanIncrementItemQuantity(qty) {
    const count = Number(qty);
    return Number.isSafeInteger(count) && count >= 1 && count < 99;
  }

  function waiterDraftLineMergeKey(line) {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return '';
    const menuItemId = Number(line.menuItemId ?? line.id);
    const seat = line.seat === undefined ? 0 : Number(line.seat);
    if (!Number.isSafeInteger(menuItemId) || menuItemId < 1
        || !Number.isSafeInteger(seat) || seat < 0 || seat > 99) return '';

    const modifiers = line.modifiers === undefined ? [] : line.modifiers;
    const complements = line.complements === undefined ? [] : line.complements;
    if (!Array.isArray(modifiers) || !Array.isArray(complements)) return '';
    const modifierIdentities = [];
    const seenModifiers = new Set();
    for (const modifier of modifiers) {
      if (!modifier || typeof modifier !== 'object' || Array.isArray(modifier)) return '';
      const groupId = String(modifier.groupId ?? '').trim();
      const optionId = String(modifier.id ?? modifier.optionId ?? '').trim();
      if (!groupId || !optionId) return '';
      const identity = `${groupId}\u0000${optionId}`;
      if (seenModifiers.has(identity)) return '';
      seenModifiers.add(identity);
      modifierIdentities.push(identity);
    }
    modifierIdentities.sort((left, right) => left.localeCompare(right));

    const complementQuantities = new Map();
    for (const complement of complements) {
      if (!complement || typeof complement !== 'object' || Array.isArray(complement)) return '';
      const id = Number(complement.complementId ?? complement.id);
      const qty = Number(complement.qty);
      if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(qty) || qty < 1 || qty > 20) return '';
      const totalQty = (complementQuantities.get(id) || 0) + qty;
      if (totalQty > 20) return '';
      complementQuantities.set(id, totalQty);
    }
    const complementIdentities = [...complementQuantities.entries()]
      .sort(([left], [right]) => left - right);

    const course = String(line.course || 'starters').trim().toLowerCase();
    const courseStatus = String(line.courseStatus || 'fired').trim().toLowerCase();
    if (!['straight_fire', 'starters', 'entrees', 'dessert'].includes(course)
        || !['fired', 'hold', 'served'].includes(courseStatus)) return '';

    return JSON.stringify({
      menuItemId,
      seat,
      modifiers: modifierIdentities,
      complements: complementIdentities,
      course,
      courseStatus,
      note: String(line.note || '').trim(),
    });
  }

  function mergeWaiterDraftLine(lines, incoming) {
    if (!Array.isArray(lines)) return { ok: false, error: 'lines_invalid' };
    const incomingKey = waiterDraftLineMergeKey(incoming);
    if (!incomingKey) return { ok: false, error: 'line_identity_invalid' };
    const existing = lines.find((line) => waiterDraftLineMergeKey(line) === incomingKey);
    if (!existing) {
      lines.push(incoming);
      return { ok: true, merged: false, line: incoming };
    }

    const currentQty = Number(existing.qty);
    const addedQty = Number(incoming.qty);
    if (!Number.isSafeInteger(currentQty) || currentQty < 1 || currentQty > 99
        || !Number.isSafeInteger(addedQty) || addedQty < 1 || addedQty > 99) {
      return { ok: false, error: 'quantity_invalid', line: existing };
    }
    if (currentQty + addedQty > 99) return { ok: false, error: 'quantity_limit', line: existing };

    existing.qty = currentQty + addedQty;
    delete existing.lineTotal;
    existing.localSaved = false;
    return { ok: true, merged: true, line: existing };
  }

  function waiterTerminalHasUnsentWork(wt) {
    return Boolean(wt && (wt.dirty
      || wt.lines?.some((line) => !line.localSaved)
      || wt.pendingPayment
      || wt.paymentNeedsRefresh
      || wt.paymentIntentConflict
      || wt.pendingOrderSubmission
      || wt.pendingSplit
      || wt.splitNeedsRefresh
      || wt.orderSaveNeedsRefresh
      || wt.orderSubmissionConflict));
  }

  function waiterTerminalMutationLocked(wt) {
    return Boolean(wt?.orderSaveNeedsRefresh || wt?.orderSubmissionConflict || wt?.saving
      || wt?.pendingSplit || wt?.splitNeedsRefresh || wt?.splitSaving
      || wt?.pendingPayment || wt?.paymentNeedsRefresh || wt?.paymentIntentConflict);
  }

  function waiterPendingPaymentCanRecover(pending, order, branchId) {
    const intent = pending?.intent;
    const paymentAmount = Number(intent?.paymentAmount);
    const amountTendered = Number(intent?.amountTendered);
    const baselinePaid = Number(pending?.baselinePaid);
    const tender = String(intent?.tender || '');
    const paymentReference = typeof intent?.paymentReference === 'string' ? intent.paymentReference.trim() : '';
    return Boolean(order?.id
      && Number(intent?.orderId) === Number(order.id)
      && String(intent?.branchId ?? branchId) === String(branchId)
      && ['cash', 'manual_card'].includes(tender)
      && Number.isSafeInteger(paymentAmount) && paymentAmount > 0
      && Number.isSafeInteger(amountTendered)
      && (tender === 'cash' ? amountTendered >= paymentAmount : amountTendered === paymentAmount)
      && Number.isSafeInteger(baselinePaid) && baselinePaid >= 0
      && Number.isSafeInteger(Number(order?.total)) && baselinePaid <= Number(order.total)
      && paymentAmount <= Number(order.total) - baselinePaid
      && typeof pending?.idempotencyKey === 'string'
      && pending.idempotencyKey.length >= 8
      && pending.idempotencyKey.length <= 160
      && paymentReference.length <= 120
      && (tender !== 'manual_card' || paymentReference.length > 0));
  }

  function waiterPaymentAmount(value, outstanding) {
    const due = cashierIntegerAmount(outstanding);
    if (due === null || due <= 0) return null;
    const normalized = normalizeDigits(String(value ?? '').trim());
    if (!normalized || !/^(?:\d+|\d{1,3}(?:[,٬]\d{3})+)$/.test(normalized)) return null;
    const amount = Number(normalized.replace(/[,٬]/g, ''));
    return Number.isSafeInteger(amount) && amount > 0 && amount <= due ? amount : null;
  }

  function waiterPaymentActionState(wt, capabilities, branchId, paymentState = globalThis.WestoOrderPaymentState) {
    const allowedCapabilities = Array.isArray(capabilities) ? capabilities : [];
    if (!allowedCapabilities.includes('*') && !allowedCapabilities.includes('payments.collect')) {
      return { ready: false, reason: 'permission' };
    }
    if (!wt?.order?.id) return { ready: false, reason: 'order' };

    const orderStatus = String(wt.order.status || '');
    const orderSent = !['draft', 'pay_at_cashier', 'awaiting_confirmation', 'pending_online', 'cancelled'].includes(orderStatus);
    const serviceComplete = ['done', 'completed', 'picked_up', 'delivered'].includes(orderStatus);
    if (!orderSent || !serviceComplete) return { ready: false, reason: 'service' };
    if (wt.paymentNeedsRefresh || wt.paymentPending) return { ready: false, reason: 'refresh' };
    if (wt.paymentIntentConflict) return { ready: false, reason: 'reconciliation' };
    if (wt.orderSaveNeedsRefresh || wt.orderSubmissionConflict || wt.saving
        || wt.pendingSplit || wt.splitNeedsRefresh || wt.splitSaving) {
      return { ready: false, reason: 'refresh' };
    }

    const workflow = paymentState?.deriveOrderPaymentWorkflow(wt.order);
    if (workflow?.settled) return { ready: false, reason: 'settled' };
    if (workflow?.requiresReconciliation || workflow?.isConsistent !== true) {
      return { ready: false, reason: 'reconciliation' };
    }
    if (wt.pendingPayment && !waiterPendingPaymentCanRecover(wt.pendingPayment, wt.order, branchId)) {
      return { ready: false, reason: 'reconciliation' };
    }
    const settlementStage = workflow.stages?.find((stage) => stage.id === 'settlement');
    const amountDue = Number(workflow.amounts?.due);
    if (settlementStage?.state !== 'current' || !Number.isFinite(amountDue) || amountDue <= 0) {
      return { ready: false, reason: 'balance' };
    }
    return { ready: true, reason: 'ready' };
  }

  function waiterDraftHasRecordedPayment(draft, orders = []) {
    const orderId = Number(draft?.orderId);
    const key = String(draft?.pendingPayment?.idempotencyKey || '');
    if (!orderId || !key) return false;
    const order = (Array.isArray(orders) ? orders : []).find((entry) => Number(entry?.id) === orderId);
    return Boolean(order && Array.isArray(order.partialPayments)
      && order.partialPayments.some((payment) => String(payment?.idempotencyKey || '') === key));
  }

  function waiterOrderSubmissionCanRecover(pending, tableId, branchId) {
    const payload = pending?.payload;
    const covers = Number(payload?.covers);
    return Boolean(typeof pending?.idempotencyKey === 'string'
      && pending.idempotencyKey.length >= 8 && pending.idempotencyKey.length <= 160
      && Number(payload?.branchId) === Number(branchId)
      && String(payload?.tableNo || '') === String(tableId)
      && payload?.fulfillment === 'dine_in'
      && payload?.sendToKitchen === true
      && Number.isSafeInteger(covers) && covers >= 1 && covers <= 99
      && Array.isArray(payload.items) && payload.items.length > 0
      && payload.items.every((line) => Number.isSafeInteger(Number(line?.menuItemId)) && Number(line.menuItemId) > 0
        && Number.isSafeInteger(Number(line?.qty)) && Number(line.qty) > 0
        && Number.isSafeInteger(Number(line?.seat ?? 0)) && Number(line?.seat ?? 0) >= 0 && Number(line?.seat ?? 0) <= covers));
  }

  function splitWaiterCourseLines(lines, course) {
    const heldLines = (Array.isArray(lines) ? lines : []).filter((line) =>
      (line.course || 'starters') === course && line.courseStatus === 'hold');
    return {
      heldLines,
      savedLines: heldLines.filter((line) => Boolean(line.localSaved)),
      unsavedLines: heldLines.filter((line) => !line.localSaved),
    };
  }

  function waiterOrderDraftSignature(order) {
    if (!order?.id) return '';
    return JSON.stringify({
      id: Number(order.id),
      editRevision: Number(order.editRevision) || 0,
      editedAt: String(order.editedAt || ''),
      updatedAt: String(order.updatedAt || order.updated_at || ''),
      status: String(order.status || ''),
      paymentStatus: String(order.paymentStatus || ''),
      amountPaid: Number(order.amountPaid) || 0,
      covers: Number(order.covers) || 0,
      total: Number(order.total) || 0,
      name: String(order.name || ''),
      phone: String(order.phone || ''),
      note: String(order.note || ''),
      items: (Array.isArray(order.items) ? order.items : []).map((line) => ({
        menuItemId: Number(line.menuItemId) || 0,
        qty: Number(line.qty) || 0,
        seat: Number(line.seat) || 0,
        course: String(line.course || ''),
        courseStatus: String(line.courseStatus || ''),
        firedAt: String(line.firedAt || ''),
        note: String(line.note || ''),
        modifiers: (Array.isArray(line.modifiers) ? line.modifiers : []).map((modifier) => ({
          id: Number(modifier.id) || 0,
          groupId: String(modifier.groupId || ''),
          name: String(modifier.name || ''),
          price: Number(modifier.price) || 0,
        })),
      })),
    });
  }

  function waiterDraftStorageKey(tableId) {
    if (!state.branchId || tableId === undefined || tableId === null) return '';
    return `westo_waiter_draft_v1:${state.branchId}:${encodeURIComponent(String(tableId))}`;
  }

  function persistWaiterTerminalDraft(wt) {
    const key = waiterDraftStorageKey(wt?.table?.id);
    if (!key) return false;
    try {
      const storage = window.sessionStorage;
      if (!storage) return false;
      if (!waiterTerminalHasUnsentWork(wt)) {
        storage.removeItem(key);
        return true;
      }
      const payload = {
        version: 1,
        branchId: state.branchId,
        tableId: String(wt.table.id),
        orderId: wt.order?.id ? Number(wt.order.id) : null,
        baseOrderSignature: waiterOrderDraftSignature(wt.order),
        savedAt: Date.now(),
        covers: Number(wt.covers),
        seatsCount: Number(wt.seatsCount),
        checkNo: String(wt.checkNo || ''),
        idempotencyKey: String(wt.idempotencyKey || ''),
        pendingPayment: wt.pendingPayment ? {
          intent: {
            orderId: Number(wt.pendingPayment.intent?.orderId),
            branchId: wt.pendingPayment.intent?.branchId ?? state.branchId,
            tender: String(wt.pendingPayment.intent?.tender || ''),
            paymentAmount: Number(wt.pendingPayment.intent?.paymentAmount),
            amountTendered: Number(wt.pendingPayment.intent?.amountTendered),
            paymentReference: String(wt.pendingPayment.intent?.paymentReference || ''),
          },
          idempotencyKey: String(wt.pendingPayment.idempotencyKey || ''),
          baselinePaid: Number(wt.pendingPayment.baselinePaid),
        } : null,
        paymentIntentConflict: Boolean(wt.paymentIntentConflict),
        pendingOrderSubmission: wt.pendingOrderSubmission ? JSON.parse(JSON.stringify(wt.pendingOrderSubmission)) : null,
        pendingSplit: wt.pendingSplit ? JSON.parse(JSON.stringify(wt.pendingSplit)) : null,
        splitNeedsRefresh: Boolean(wt.splitNeedsRefresh),
        orderSaveNeedsRefresh: Boolean(wt.orderSaveNeedsRefresh),
        orderSubmissionConflict: Boolean(wt.orderSubmissionConflict),
        dirty: Boolean(wt.dirty),
        activeTab: wt.activeTab === 'guest' ? 'guest' : 'check',
        guestName: String(wt.guestName || ''),
        guestPhone: String(wt.guestPhone || ''),
        note: String(wt.note || ''),
        lines: (wt.lines || []).map((line) => ({
          ...line,
          modifiers: Array.isArray(line.modifiers) ? line.modifiers : [],
          complements: Array.isArray(line.complements) ? line.complements : [],
        })),
      };
      storage.setItem(key, JSON.stringify(payload));
      return true;
    } catch {
      // Callers that are about to mutate the server must treat a failed save as a hard stop.
      return false;
    }
  }

  function clearWaiterTerminalDraft(tableId) {
    const key = waiterDraftStorageKey(tableId);
    if (!key) return;
    try { window.sessionStorage?.removeItem(key); } catch { /* best-effort cleanup */ }
  }

  function readWaiterTerminalDraft(tableId) {
    const key = waiterDraftStorageKey(tableId);
    if (!key) return null;
    try { return JSON.parse(window.sessionStorage?.getItem(key) || 'null'); }
    catch { clearWaiterTerminalDraft(tableId); return null; }
  }

  function waiterDraftCanRecover(draft, context) {
    if (!draft || draft.version !== 1
      || String(draft.branchId) !== String(context.branchId)
      || String(draft.tableId) !== String(context.tableId)
      || !Array.isArray(draft.lines)) return false;
    if (!draft.orderId) return true;
    const currentOrder = context.order;
    const savedSignature = String(draft.baseOrderSignature || '');
    return Boolean(currentOrder?.id
      && Number(currentOrder.id) === Number(draft.orderId)
      && savedSignature
      && waiterOrderDraftSignature(currentOrder) === savedSignature);
  }

  function offerWaiterDraftRecovery(table, existingOrder) {
    const draft = readWaiterTerminalDraft(table.id);
    if (!draft) return false;

    const structurallyValid = draft.version === 1
      && Array.isArray(draft.lines)
      && Number.isInteger(Number(draft.covers))
      && Number(draft.covers) >= 1
      && Number(draft.covers) <= 99
      && draft.lines.every((line) => line && typeof line === 'object'
        && Number.isFinite(Number(line.menuItemId))
        && Number(line.menuItemId) > 0
        && Number.isInteger(Number(line.seat || 0))
        && Number(line.seat || 0) >= 0);
    const pendingPaymentValid = !draft.pendingPayment
      || waiterPendingPaymentCanRecover(draft.pendingPayment, existingOrder, state.branchId);
    const legacyUnverifiedOrderSubmission = Boolean(!draft.orderId && draft.idempotencyKey && !draft.pendingOrderSubmission);
    const hasProtectedOrderSubmission = Boolean(draft.pendingOrderSubmission || draft.pendingSplit || draft.splitNeedsRefresh || draft.orderSaveNeedsRefresh || draft.orderSubmissionConflict || legacyUnverifiedOrderSubmission);
    const pendingOrderSubmissionValid = !draft.pendingOrderSubmission
      || waiterOrderSubmissionCanRecover(draft.pendingOrderSubmission, table.id, state.branchId);
    const canRecover = structurallyValid && waiterDraftCanRecover(draft, {
      branchId: state.branchId,
      tableId: table.id,
      order: existingOrder,
      }) && validateWaiterCovers(draft.covers, draft.lines).ok && pendingPaymentValid && pendingOrderSubmissionValid && !draft.pendingSplit && !draft.splitNeedsRefresh && !legacyUnverifiedOrderSubmission;
    const savedTime = Number(draft.savedAt);
    const timeLabel = Number.isFinite(savedTime)
      ? new Date(savedTime).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
      : '—';
    const missingCardReference = draft.pendingPayment?.intent?.tender === 'manual_card'
      && !String(draft.pendingPayment.intent.paymentReference || '').trim();
    const description = canRecover
      ? `یک پیش‌نویس از ${timeLabel} با ${num(draft.lines.length)} قلم و ${num(draft.covers)} مهمان در همین نشست مرورگر پیدا شد.${draft.orderId ? ' تغییرات سفارش با نسخهٔ فعلی سرور تطبیق دارد.' : ' این پیش‌نویس به‌صورت فاکتور جدید بازیابی می‌شود.'}${draft.pendingPayment ? ' یک دریافت در انتظار بررسی است؛ پیش از هر تلاش دوباره، وضعیت وجه تازه می‌شود و همان کلید یکتا حفظ خواهد شد.' : ''}${draft.pendingOrderSubmission ? ' ثبت سفارش پاسخ نهایی نداده است؛ فقط همان payload و کلید یکتا برای بازیابی استفاده می‌شود.' : ''}`
      : draft.pendingPayment
        ? missingCardReference
          ? 'درخواست قدیمی کارت بانکی کد پیگیری رسید ندارد؛ با این اطلاعات تکرار امن همان درخواست ممکن نیست. دریافت تازه یا درخواست جدید نسازید، پیش‌نویس را حذف نکنید و فاکتور را برای تطبیق به صندوق‌دار بسپارید.'
          : 'درخواست دریافت قبلی با وضعیت فعلی سفارش تطبیق ندارد. برای جلوگیری از ثبت یا دریافت دوباره، این درخواست را حذف نکنید و فاکتور را برای تطبیق به صندوق‌دار بسپارید.'
      : draft.pendingSplit || draft.splitNeedsRefresh
        ? 'تفکیک فاکتور پاسخ نهایی نداده است. تفکیک را دوباره اجرا نکنید؛ فاکتور اصلی و فاکتورهای جداشده را با مدیر شیفت تطبیق دهید.'
      : hasProtectedOrderSubmission
          ? 'درخواست ثبت سفارش با اطلاعات فعلی قابل بازیابی نیست. آن را حذف یا دوباره ارسال نکنید؛ ابتدا سفارش‌های همین میز را با مدیر شیفت تطبیق دهید.'
        : 'پیش‌نویس ذخیره‌شده با سفارش یا تعداد صندلی‌های فعلی هماهنگ نیست؛ برای جلوگیری از بازنویسی اطلاعات تازه، بازیابی آن انجام نمی‌شود.';
    openDialog('پیش‌نویس سفارش', canRecover ? 'ادامهٔ سفارش نیمه‌تمام؟' : 'پیش‌نویس قدیمی است', `
      <div class="wt-draft-recovery">
        <p role="${canRecover ? 'status' : 'alert'}">${esc(description)}</p>
        <div class="wt-draft-recovery__actions">
          ${canRecover ? '<button type="button" class="role-primary" id="wt-draft-resume">بازیابی پیش‌نویس</button>' : ''}
          ${draft.pendingPayment || hasProtectedOrderSubmission
          ? `<button type="button" class="role-secondary" id="wt-draft-close-protected">${draft.pendingPayment ? 'بستن و ارجاع فاکتور به صندوق' : draft.pendingSplit || draft.splitNeedsRefresh ? 'بستن و ارجاع تفکیک به مدیر شیفت' : 'بستن و ارجاع سفارش به مدیر شیفت'}</button>`
            : `<button type="button" class="role-danger" id="wt-draft-discard">${canRecover ? 'حذف پیش‌نویس و ادامه' : 'حذف پیش‌نویس قدیمی و ادامه'}</button>`}
        </div>
      </div>
    `);
    dialogBody.querySelector('#wt-draft-resume')?.addEventListener('click', () => {
      const wt = state.waiterTerminal;
      if (!wt) return;
      wt.order = draft.orderId ? wt.order : null;
      wt.lines = draft.lines.map((line, index) => ({
        ...line,
        localId: String(line.localId || `recovered-${draft.orderId || 'new'}-${index}`),
        localSaved: Boolean(line.localSaved && draft.orderId),
      }));
      const covers = validateWaiterCovers(draft.covers, wt.lines);
      if (!covers.ok) {
        showToast('پیش‌نویس با تعداد صندلی‌های سفارش هماهنگ نیست.', 'error');
        return;
      }
      wt.covers = covers.covers;
      wt.seatsCount = Math.max(covers.covers, highestWaiterAssignedSeat(wt.lines), 1);
      wt.checkNo = draft.orderId ? (wt.order?.checkNo || draft.checkNo || wt.checkNo) : (draft.checkNo || wt.checkNo);
      wt.idempotencyKey = String(draft.idempotencyKey || '') || null;
      wt.pendingPayment = draft.pendingPayment
        ? JSON.parse(JSON.stringify(draft.pendingPayment))
        : null;
      wt.paymentNeedsRefresh = Boolean(wt.pendingPayment);
      wt.paymentIntentConflict = Boolean(draft.paymentIntentConflict);
      wt.pendingOrderSubmission = draft.pendingOrderSubmission
        ? JSON.parse(JSON.stringify(draft.pendingOrderSubmission))
        : null;
      wt.orderSaveNeedsRefresh = Boolean(draft.orderSaveNeedsRefresh || wt.pendingOrderSubmission);
      wt.orderSubmissionConflict = Boolean(draft.orderSubmissionConflict || (draft.orderSaveNeedsRefresh && !draft.pendingOrderSubmission));
      wt.dirty = Boolean(draft.dirty || wt.lines.some((line) => !line.localSaved));
      wt.guestName = String(draft.guestName || '');
      wt.guestPhone = String(draft.guestPhone || '');
      wt.note = String(draft.note || '');
      wt.activeTab = draft.activeTab === 'guest' ? 'guest' : 'check';
      dialog.close();
      renderWaiterTerminal();
      showToast('پیش‌نویس این نشست بازیابی شد.');
    });
    dialogBody.querySelector('#wt-draft-discard')?.addEventListener('click', () => {
      clearWaiterTerminalDraft(table.id);
      dialog.close();
      renderWaiterTerminal();
      showToast(canRecover ? 'پیش‌نویس حذف شد.' : 'پیش‌نویس قدیمی حذف شد.');
    });
    dialogBody.querySelector('#wt-draft-close-protected')?.addEventListener('click', () => {
      dialog.close();
      showToast(wt.pendingPayment
        ? 'درخواست دریافت حفظ شد؛ فاکتور برای تطبیق به صندوق‌دار ارجاع شود.'
        : wt.pendingSplit || wt.splitNeedsRefresh
          ? 'وضعیت تفکیک حفظ شد؛ فاکتورهای میز را با مدیر شیفت تطبیق دهید.'
          : 'درخواست ثبت سفارش حفظ شد؛ سفارش‌های میز را با مدیر شیفت تطبیق دهید.', 'warning');
    });
    return true;
  }

  function openWaiterCoversPicker(table, onSelect, minimumCovers = 1, selectedCovers = 2) {
    const tableSeats = Number(table?.seats) || 4;
    const minimum = Math.max(1, Math.min(99, Number(minimumCovers) || 1));
    const maximum = Math.min(99, Math.max(minimum, tableSeats, Number(selectedCovers) || 1));
    const selected = Math.max(minimum, Math.min(maximum, Number(selectedCovers) || 2));
    openDialog(
      'تعداد مهمان',
      table?.label || `میز ${table?.id}`,
      `
      <div class="wt-covers-modal">
        <p style="margin:0 0 8px;font-size:13px;color:var(--rp-muted)">تعداد مهمانان حاضر بر سر میز را مشخص کنید:</p>
        <div class="wt-covers-grid">
          ${Array.from({ length: maximum - minimum + 1 }, (_, index) => index + minimum).map((n) => `
            <button type="button" class="wt-cover-btn ${n === selected ? 'active' : ''}" data-covers="${n}" aria-pressed="${n === selected ? 'true' : 'false'}">
              ${num(n)}
            </button>
          `).join('')}
        </div>
      </div>
      `
    );

    dialogBody.querySelectorAll('[data-covers]').forEach((btn) => btn.addEventListener('click', () => {
      const covers = Number(btn.dataset.covers);
      dialog.close();
      if (typeof onSelect === 'function') onSelect(covers);
    }));

  }

  async function openWaiterTerminal(tableId, options = {}) {
    const openingBranchId = state.branchId;
    const openingBranchGeneration = state.waiterBranchGeneration || 0;
    const openingKey = [openingBranchId ?? '', tableId, options.selectedOrderId ?? '', options.forceNew ? 'new' : 'existing', options.covers ?? ''].join(':');
    if (state.waiterTerminalOpenings.has(openingKey)) {
      showToast('ترمینال این میز در حال آماده‌سازی است؛ چند لحظه صبر کنید.', 'warning');
      return;
    }
    state.waiterTerminalOpenings.add(openingKey);
    try { await loadMenu(); } catch (e) {
      openDialog('منو بارگذاری نشد', 'تا دریافت منوی معتبر، سفارش‌گیری موقتاً متوقف است.', `
        <p class="wt-stage-message is-warning" role="alert">${esc(e.message || 'اتصال به منوی این شعبه برقرار نشد.')}</p>
        <button type="button" class="role-primary" id="wt-menu-retry" style="width:100%;min-height:48px">تلاش دوباره</button>
      `);
      dialogBody.querySelector('#wt-menu-retry')?.addEventListener('click', async (event) => {
        setBusy(event.currentTarget, true);
        try { await loadMenu(true); dialog.close(); await openWaiterTerminal(tableId, options); }
        catch (retryError) { showToast(retryError.message, 'error'); setBusy(event.currentTarget, false); }
      });
      return;
    } finally {
      state.waiterTerminalOpenings.delete(openingKey);
    }
    if (String(state.branchId ?? '') !== String(openingBranchId ?? '')
      || (state.waiterBranchGeneration || 0) !== openingBranchGeneration) {
      showToast('شعبه هنگام بارگذاری تغییر کرد؛ میز را از سالنِ شعبهٔ فعال دوباره انتخاب کنید.', 'warning');
      return;
    }
    const tables = state.data.floor?.tables || [];
    const table = tables.find((t) => String(t.id) === String(tableId)) || { id: tableId, label: `میز ${tableId}` };
    const savedDraft = readWaiterTerminalDraft(table.id);
    if (waiterDraftHasRecordedPayment(savedDraft, state.data.orders)) {
      clearWaiterTerminalDraft(table.id);
    }
    const activeOrders = (state.data.orders || []).filter((o) => tableNoBelongsToTable(o.tableNo, tableId) && orderIsOpen(o));

    if (activeOrders.length > 1 && !options.selectedOrderId) {
      openDialog(
        'انتخاب فاکتور',
        table.label || `میز ${tableId}`,
        `
        <div style="display:flex;flex-direction:column;gap:8px;padding:6px 0">
          <p style="margin:0 0 6px;font-size:13px;color:var(--rp-muted)">چندین فاکتور باز برای این میز وجود دارد:</p>
          ${activeOrders.map((o) => `
            <button type="button" class="btn btn-block" data-select-check="${o.id}" style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border:1.5px solid var(--rp-line);border-radius:12px;background:var(--rp-surface)">
              <div style="text-align:right">
                <strong>${esc(o.checkNo || o.tableNo || `چک #${o.id}`)}</strong>
                <small style="display:block;color:var(--rp-muted)">${num((o.items || []).length)} قلم · ${time(o.createdAt)}</small>
              </div>
              <b style="color:#0284c7;font-size:14px">${money(o.total)}</b>
            </button>
          `).join('')}
          <button type="button" class="role-secondary" id="create-sub-check" ${waiterHasCapability('orders.create') ? '' : 'disabled aria-disabled="true" title="برای ساخت فاکتور جدید از مدیر شیفت مجوز بخواهید."'} style="margin-top:6px">${waiterHasCapability('orders.create') ? '+ باز کردن فاکتور جدید برای این میز' : 'ساخت فاکتور جدید نیازمند مجوز'}</button>
        </div>
        `
      );
      dialogBody.querySelectorAll('[data-select-check]').forEach((btn) => btn.addEventListener('click', () => {
        dialog.close();
        openWaiterTerminal(tableId, { selectedOrderId: Number(btn.dataset.selectCheck) });
      }));
      dialogBody.querySelector('#create-sub-check')?.addEventListener('click', () => {
        dialog.close();
        openWaiterCoversPicker(table, (covers) => openWaiterTerminal(tableId, { covers, forceNew: true }));
      });
      return;
    }

    const existingOrder = options.selectedOrderId
      ? activeOrders.find((o) => Number(o.id) === Number(options.selectedOrderId))
      : (!options.forceNew && activeOrders.length === 1 ? activeOrders[0] : null);

    if (options.selectedOrderId && !existingOrder) {
      showToast('این فاکتور دیگر در سفارش‌های باز این میز نیست؛ برای جلوگیری از سفارش تکراری، فاکتور تازه باز نشد. سالن را به‌روزرسانی کنید.', 'warning');
      return;
    }

    if (!waiterHasCapability('orders.create') && !existingOrder) {
      showToast('ساخت سفارش در دسترسی شما نیست؛ از مدیر شیفت دسترسی لازم را درخواست کنید.', 'error');
      return false;
    }

    if (!existingOrder && typeof options.covers === 'undefined' && !options.forceNew) {
      const draft = readWaiterTerminalDraft(table.id);
      const canRestoreNewDraft = draft?.version === 1
        && !draft.orderId
        && String(draft.branchId) === String(state.branchId)
        && String(draft.tableId) === String(table.id)
        && Number.isInteger(Number(draft.covers))
        && Number(draft.covers) >= 1
        && Number(draft.covers) <= 99;
      if (canRestoreNewDraft) {
        options = { ...options, covers: Number(draft.covers), forceNew: true };
      } else {
        openWaiterCoversPicker(table, (covers) => openWaiterTerminal(tableId, { covers, forceNew: true }));
        return;
      }
    }

    const assignedSeatCount = highestWaiterAssignedSeat(existingOrder?.items || []);
    const requestedCovers = Number(options.covers ?? existingOrder?.covers ?? 2);
    const numCovers = Math.max(1, Math.ceil(Number.isFinite(requestedCovers) && requestedCovers > 0 ? requestedCovers : 2), assignedSeatCount);
    const initialSeats = Math.max(numCovers, assignedSeatCount, 1);

    state.waiterTerminal = {
      table,
      covers: numCovers,
      seatsCount: initialSeats,
      activeTab: existingOrder ? 'check' : 'menu',
      activeCategory: null,
      order: existingOrder ? JSON.parse(JSON.stringify(existingOrder)) : null,
      lines: existingOrder ? (existingOrder.items || []).map((line, index) => ({
        ...JSON.parse(JSON.stringify(line)),
        localId: line.localId || `saved-${existingOrder.id}-${index}`,
        localSaved: true,
      })) : [],
      checkNo: existingOrder?.checkNo || existingOrder?.tableNo || String(table.id),
      idempotencyKey: null,
      pendingPayment: null,
      paymentNeedsRefresh: false,
      paymentRefreshPending: false,
      paymentIntentConflict: false,
      pendingOrderSubmission: null,
      pendingSplit: savedDraft?.pendingSplit ? JSON.parse(JSON.stringify(savedDraft.pendingSplit)) : null,
      splitNeedsRefresh: Boolean(savedDraft?.splitNeedsRefresh || savedDraft?.pendingSplit),
      splitSaving: false,
      orderSaveNeedsRefresh: false,
      orderSubmissionConflict: false,
      serveNeedsRefresh: false,
      dirty: false,
      searchQuery: '',
      guestName: existingOrder?.name || '',
      guestPhone: existingOrder?.phone || '',
      note: existingOrder?.note || '',
    };

    if (offerWaiterDraftRecovery(table, existingOrder)) return;
    renderWaiterTerminal();
  }

  function renderWaiterTerminal() {
    document.body.classList.add('is-waiter-floor-app');
    document.body.classList.add('is-waiter-terminal');
    clearRoleHeaderContext();
    const wt = state.waiterTerminal;
    if (!wt) {
      waiterFloor();
      return;
    }
    const waiterDraftPersisted = persistWaiterTerminalDraft(wt);
    wt.draftStorageUnavailable = Boolean(waiterTerminalHasUnsentWork(wt) && !waiterDraftPersisted);

    const headerHtml = `
      <header class="wt-header">
        <div class="wt-header__start">
          <button type="button" class="wt-back-btn" id="wt-back-floor">← سالن</button>
          <div class="wt-header__title">
            <strong>${esc(wt.table.label || `میز ${wt.table.id}`)}${wt.order?.checkNo && wt.order.checkNo !== String(wt.table.id) ? ` (${esc(wt.order.checkNo)})` : ''}</strong>
            <small>${num(wt.covers || wt.seatsCount)} مهمان · ${num(wt.lines.length)} قلم</small>
          </div>
        </div>
      </header>
      ${wt.draftStorageUnavailable ? '<p class="wt-stage-message is-warning" role="alert" aria-live="assertive">پیش‌نویس این سفارش در حافظهٔ نشست ذخیره نشد؛ تا ذخیرهٔ موفق، صفحه را نبندید یا بازخوانی نکنید.</p>' : ''}
      ${waiterWorkflowMarkup(wt)}
      <nav class="wt-tabs" aria-label="بخش‌های سفارش">
        <button type="button" class="wt-tab ${wt.activeTab === 'menu' ? 'active' : ''}" data-wt-tab="menu" ${wt.activeTab === 'menu' ? 'aria-current="page"' : ''}>
          <span>📋</span>
          <span>منو</span>
        </button>
        <button type="button" class="wt-tab ${wt.activeTab === 'check' ? 'active' : ''}" data-wt-tab="check" ${wt.activeTab === 'check' ? 'aria-current="page"' : ''}>
          <span>🧾</span>
          <span>فاکتور</span>
          ${wt.lines.length ? `<span class="wt-tab-badge">${num(wt.lines.length)}</span>` : ''}
        </button>
        <button type="button" class="wt-tab ${wt.activeTab === 'actions' ? 'active' : ''}" data-wt-tab="actions" ${wt.activeTab === 'actions' ? 'aria-current="page"' : ''}>
          <span>⚙️</span>
          <span>عملیات</span>
        </button>
        <button type="button" class="wt-tab ${wt.activeTab === 'guest' ? 'active' : ''}" data-wt-tab="guest" ${wt.activeTab === 'guest' ? 'aria-current="page"' : ''}>
          <span>👤</span>
          <span>مهمان</span>
        </button>
      </nav>
    `;

    main.innerHTML = `
      <div class="waiter-terminal-screen">
        ${headerHtml}
        <div class="wt-viewport" id="wt-viewport" aria-label="محتوای ${esc(({ menu: 'منو', check: 'فاکتور', actions: 'عملیات', guest: 'مهمان' })[wt.activeTab] || 'سفارش')}"></div>
      </div>
    `;

    document.getElementById('wt-back-floor')?.addEventListener('click', () => {
      if (wt.serveNeedsRefresh) {
        showToast('نتیجهٔ تحویل هنوز روشن نیست؛ ابتدا وضعیت سفارش را از مرحله‌ها تازه کنید.', 'warning');
        return;
      }
      if (!waiterTerminalHasUnsentWork(wt)) {
        clearWaiterTerminalDraft(wt.table.id);
        state.waiterTerminal = null;
        waiterFloor();
        return;
      }
      const hasPendingPayment = Boolean(wt.pendingPayment || wt.paymentNeedsRefresh || wt.paymentIntentConflict);
      const hasPendingSplit = Boolean(wt.pendingSplit || wt.splitNeedsRefresh);
      const hasPendingOrderSubmission = Boolean(wt.pendingOrderSubmission || wt.orderSaveNeedsRefresh || wt.orderSubmissionConflict || (!wt.order?.id && wt.idempotencyKey));
      const hasProtectedIntent = hasPendingPayment || hasPendingSplit || hasPendingOrderSubmission;
      openDialog('پیش‌نویس سفارش', hasPendingPayment ? 'دریافت وجه نیازمند بررسی است' : hasPendingSplit ? 'تفکیک فاکتور نیازمند بررسی است' : hasPendingOrderSubmission ? 'ثبت سفارش نیازمند بررسی است' : 'با سفارش نیمه‌تمام چه کنیم؟', `
        <div class="wt-draft-recovery">
          <p id="wt-draft-return-status" tabindex="-1" role="${hasProtectedIntent || wt.draftStorageUnavailable ? 'alert' : 'status'}">${hasPendingPayment
            ? 'یک درخواست دریافت وجه هنوز با وضعیت سفارش تطبیق داده نشده است. درخواست را حفظ کنید و پیش از هر تکراری، آن را از همان فاکتور تازه‌سازی کنید یا به صندوق‌دار بسپارید.'
            : hasPendingSplit
              ? 'نتیجهٔ تفکیک فاکتور روشن نیست. درخواست را حفظ کنید؛ تا تطبیق فاکتورهای میز با مدیر شیفت، تفکیک یا ویرایش را تکرار نکنید.'
            : hasPendingOrderSubmission
              ? wt.pendingOrderSubmission
                ? 'ثبت سفارش پاسخ نهایی نداده است. درخواست را حفظ کنید و فقط همان سفارش با همان کلید یکتا را بازیابی کنید؛ سفارش تازه نسازید.'
                : 'نتیجهٔ ثبت یا به‌روزرسانی قابل تطبیق نیست. پیش از هر تغییر یا ارسال دوباره، سفارش میز را با مدیر شیفت بررسی کنید.'
            : `${num(wt.lines.length)} قلم یا تغییر ثبت‌نشده دارید. می‌توانید آن را برای همین نشست نگه دارید و بعداً ادامه دهید، یا کامل حذف کنید.`}${wt.draftStorageUnavailable ? ' پیش‌نویس در حافظهٔ نشست ذخیره نشده است؛ بازگشت امن نیست.' : ''}</p>
          <div class="wt-draft-recovery__actions">
            <button type="button" class="role-primary" id="wt-draft-save-return">${hasPendingPayment ? 'حفظ درخواست دریافت و بازگشت به سالن' : hasPendingSplit ? 'حفظ وضعیت تفکیک و بازگشت به سالن' : hasPendingOrderSubmission ? 'حفظ وضعیت سفارش و بازگشت به سالن' : 'نگه‌داشتن و بازگشت به سالن'}</button>
            ${hasProtectedIntent ? '' : '<button type="button" class="role-danger" id="wt-draft-discard-return">حذف پیش‌نویس و بازگشت</button>'}
            <button type="button" class="role-secondary" id="wt-draft-stay">ادامهٔ سفارش</button>
          </div>
        </div>
      `);
      dialogBody.querySelector('#wt-draft-save-return')?.addEventListener('click', () => {
        if (!persistWaiterTerminalDraft(wt)) {
          wt.draftStorageUnavailable = true;
          const status = dialogBody.querySelector('#wt-draft-return-status');
          if (status) {
            status.setAttribute('role', 'alert');
            status.textContent = 'ذخیرهٔ پیش‌نویس در این نشست انجام نشد؛ سفارش باز می‌ماند. فضای مرورگر را بررسی کنید و تا ذخیرهٔ موفق از این صفحه خارج نشوید.';
            status.focus();
          }
          showToast('پیش‌نویس ذخیره نشد؛ برای جلوگیری از گم‌شدن تغییرها، در صفحه بمانید.', 'error');
          return;
        }
        wt.draftStorageUnavailable = false;
        dialog.close();
        state.waiterTerminal = null;
        waiterFloor();
        showToast('پیش‌نویس در همین نشست مرورگر نگه داشته شد.');
      });
      dialogBody.querySelector('#wt-draft-discard-return')?.addEventListener('click', () => {
        clearWaiterTerminalDraft(wt.table.id);
        dialog.close();
        state.waiterTerminal = null;
        waiterFloor();
        showToast('پیش‌نویس حذف شد.');
      });
      dialogBody.querySelector('#wt-draft-stay')?.addEventListener('click', () => dialog.close());
    });

    main.querySelectorAll('[data-wt-tab]').forEach((btn) => btn.addEventListener('click', () => {
      wt.activeTab = btn.dataset.wtTab;
      renderWaiterTerminal();
    }));

    main.querySelector('#wt-refresh-flow')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      setBusy(button, true);
      try {
        await fetchWaiter();
        refreshWaiterViewAfterSync();
        if (state.waiterTerminal === wt) setBusy(button, false);
      } catch (error) {
        showToast(error.message, 'error');
        setBusy(button, false);
      }
    });

    main.querySelector('#wt-load-latest-order')?.addEventListener('click', () => {
      if (wt.pendingSplit || wt.splitNeedsRefresh) {
        showToast('بارگذاری نسخهٔ تازه، نتیجهٔ تفکیک را تطبیق نمی‌دهد؛ ابتدا فاکتورهای میز را با مدیر شیفت بررسی کنید.', 'warning');
        return;
      }
      openDialog('جایگزینی پیش‌نویس محلی', 'بارگذاری نسخهٔ تازهٔ سفارش', `
        <div class="wt-draft-recovery">
          <p>این سفارش در دستگاه دیگری تغییر کرده است. با بارگذاری نسخهٔ تازه، همهٔ تغییرهای ثبت‌نشدهٔ این دستگاه جایگزین می‌شوند.</p>
          <div class="wt-draft-recovery__actions">
            <button type="button" class="role-primary" id="wt-confirm-load-latest">بارگذاری نسخهٔ تازه و جایگزینی پیش‌نویس</button>
            <button type="button" class="role-secondary" id="wt-cancel-load-latest">ادامه با پیش‌نویس فعلی</button>
          </div>
        </div>
      `);
      dialogBody.querySelector('#wt-cancel-load-latest')?.addEventListener('click', () => dialog.close());
      dialogBody.querySelector('#wt-confirm-load-latest')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        setBusy(button, true);
        try {
          await fetchWaiter();
          const latest = state.data.orders.find((order) => Number(order.id) === Number(wt.order?.id));
          if (!latest) {
            showToast('نسخهٔ تازهٔ سفارش پیدا نشد؛ پیش‌نویس فعلی حفظ شد.', 'error');
            setBusy(button, false);
            return;
          }
          applyLatestWaiterOrder(wt, latest);
          wt.serveNeedsRefresh = false;
          clearWaiterTerminalDraft(wt.table.id);
          dialog.close();
          renderWaiterTerminal();
          showToast('نسخهٔ تازهٔ سفارش بارگذاری شد.');
        } catch (error) {
          showToast(error.message, 'error');
          setBusy(button, false);
        }
      });
    });

    const viewport = document.getElementById('wt-viewport');
    if (wt.activeTab === 'menu') paintTerminalMenu(viewport);
    else if (wt.activeTab === 'check') paintTerminalCheck(viewport);
    else if (wt.activeTab === 'actions') paintTerminalActions(viewport);
    else if (wt.activeTab === 'guest') paintTerminalGuest(viewport);
  }

  function paintTerminalMenu(container) {
    const wt = state.waiterTerminal;
    const orderSubmissionLocked = waiterTerminalMutationLocked(wt);
    const canCreateOrders = waiterHasCapability('orders.create');
    const compact = window.innerWidth <= 640;
    const { categories, validCategoryIds, orphanItems } = resolveUnifiedCategories(state.menuCategories, state.menuItems);
    const query = String(wt.searchQuery || '').trim();
    const normalizedQuery = query.toLocaleLowerCase('fa-IR');
    const isOther = wt.activeCategory === 'other';
    const activeCategory = isOther ? { id: 'other', title: 'سایر اقلام' } : categories.find((category) => Number(category.id) === Number(wt.activeCategory));
    const showingItems = Boolean(query || activeCategory);
    const matchedItems = state.menuItems.filter((item) => {
      if (query) return String(item.name || '').toLocaleLowerCase('fa-IR').includes(normalizedQuery);
      if (isOther) return !validCategoryIds.has(Number(item.categoryId));
      return activeCategory && Number(item.categoryId) === Number(activeCategory.id);
    });
    const itemColumns = compact ? 1 : 5;
    const itemDensity = matchedItems.length > 22 ? 'tight' : matchedItems.length > 15 ? 'compact' : matchedItems.length > 8 ? 'medium' : 'relaxed';

    function menuVisualForName(value) {
      const name = String(value || '').toLocaleLowerCase('fa-IR');
      if (name.includes('سالاد')) return '🥗';
      if (name.includes('پیتزا')) return '🍕';
      if (name.includes('برگر')) return '🍔';
      if (name.includes('پاستا') || name.includes('ماکارونی')) return '🍝';
      if (name.includes('دسر') || name.includes('کیک') || name.includes('شیرینی')) return '🍰';
      if (name.includes('قهوه') || name.includes('کافه') || name.includes('نوشیدنی') || name.includes('بار')) return '☕';
      if (name.includes('پیش')) return '🥣';
      return '🍽️';
    }

    function menuAssetUrl(value) {
      const raw = String(value || '').trim();
      if (!raw) return '';
      return /^(?:https?:|data:|blob:|\/)/i.test(raw) ? raw : `/${raw}`;
    }

    function menuMediaMarkup(value, alt, fallback, modifier) {
      const src = menuAssetUrl(value);
      const modifierClass = modifier ? ` ${modifier}` : '';
      return `<span class="wt-menu-media${modifierClass}">${src ? `<img src="${esc(src)}" alt="${esc(alt || '')}" loading="lazy" decoding="async" />` : ''}<span class="wt-menu-media__fallback"${src ? ' hidden' : ''} aria-hidden="true">${fallback}</span></span>`;
    }

    const searchHtml = `
      <label class="wt-menu-search">
        <span aria-hidden="true">⌕</span>
        <input type="search" id="wt-item-search" placeholder="جست‌وجوی غذا در همهٔ منو" value="${esc(query)}" aria-label="جست‌وجوی غذا در همهٔ منو" autocomplete="off" />
      </label>
    `;

    const categoriesHtml = !showingItems ? `
      <section class="wt-menu-category-section wt-menu-stage" aria-label="انتخاب دستهٔ غذا">
        <div class="wt-menu-stage-head">
          <div><strong>دسته‌های غذا</strong></div>
          ${searchHtml}
        </div>
        <div class="wt-cat-grid">
          ${categories.map((cat, index) => {
            const count = cat.totalCount;
            const categoryName = cat.title || cat.name || 'دسته';
            return `<button type="button" class="wt-cat-card wt-cat-card--tone-${index % 8}" data-wt-cat="${cat.id}" aria-label="انتخاب دستهٔ ${esc(categoryName)}"><span class="wt-cat-card__visual">${menuMediaMarkup(cat.coverImg || cat.img || cat.image || cat.imageUrl, categoryName, menuVisualForName(categoryName))}</span><span class="wt-cat-card__body"><strong>${esc(categoryName)}</strong><small>${num(count)} غذا</small></span></button>`;
          }).join('') || empty('دسته‌ای برای نمایش وجود ندارد.')}
        </div>
      </section>
    ` : '';

    const itemsHtml = showingItems ? `
      <section class="wt-menu-items-section wt-menu-stage" aria-label="انتخاب غذا">
        <div class="wt-menu-stage-head wt-menu-stage-head--items">
          <button type="button" class="wt-menu-back" id="wt-menu-back-categories">← دسته‌ها</button>
          <div><span>مرحلهٔ دوم</span><strong>${query ? 'نتیجهٔ جست‌وجو' : esc(activeCategory?.title || 'غذاها')}</strong><small>${num(matchedItems.length)} غذا · برای افزودن، کارت را لمس کنید.</small></div>
          ${searchHtml}
        </div>
        <div class="wt-items-list" data-item-density="${itemDensity}" style="--wt-item-cols:${itemColumns}">
          ${matchedItems.map((item) => {
            const outOfStock = isItemOutOfStock(item);
            const actionLabel = orderSubmissionLocked
              ? 'ابتدا ثبت سفارش قبلی را بازیابی کنید'
              : !canCreateOrders
                ? `برای افزودن ${item.name} به سفارش، مجوز ساخت سفارش لازم است`
              : outOfStock
                ? `${item.name} ناموجود است`
                : `افزودن ${item.name} به فاکتور`;
            const stockBadge = outOfStock
              ? `<span class="wt-stock-badge is-out">ناموجود</span>`
              : (item.capacity !== null && item.capacity !== undefined && item.capacity < 15)
                ? `<span class="wt-stock-badge is-low">${num(item.capacity)} عدد</span>`
                : '';
            return `
            <button type="button" class="wt-item-row wt-item-card ${outOfStock ? 'is-out-of-stock' : ''}" data-open-item="${item.id}" ${outOfStock ? 'data-out-of-stock="true"' : ''} ${outOfStock || orderSubmissionLocked || !canCreateOrders ? 'disabled' : ''} aria-label="${esc(actionLabel)}" title="${!canCreateOrders ? 'از مدیر شیفت دسترسی ساخت سفارش را درخواست کنید.' : ''}">
              ${menuMediaMarkup(item.img || item.image || item.imageUrl, item.name, menuVisualForName(item.name || activeCategory?.title), 'wt-item-card__visual')}
              <span class="wt-item-row__info wt-item-card__info">
                <strong>${esc(item.name)}</strong>
                ${stockBadge}
                <span>${money(item.price)}</span>
              </span>
              <span class="wt-item-row__add-btn" aria-hidden="true">${outOfStock ? '✕' : '+'}</span>
            </button>
          `;
          }).join('') || empty(query ? 'غذایی با این نام پیدا نشد.' : 'در این دسته غذایی ثبت نشده است.')}
        </div>
      </section>
    ` : '';

    const cartUnits = wt.lines.reduce((sum, line) => sum + Math.max(1, Number(line.qty) || 1), 0);
    const cartTotal = wt.lines.reduce((sum, line) => sum + receiptLineTotal(line), 0);
    const cartDock = wt.lines.length
      ? `<button type="button" class="wt-menu-cart-dock" id="wt-menu-open-check" aria-label="مشاهدهٔ فاکتور، ${num(cartUnits)} قلم، جمع ${money(cartTotal)}">
          <span class="wt-menu-cart-dock__count">فاکتور · ${num(cartUnits)} قلم</span>
          <strong>${money(cartTotal)}</strong>
          <span class="wt-menu-cart-dock__action">مشاهده ←</span>
        </button>`
      : '';
    const permissionNotice = canCreateOrders ? '' : '<p class="wt-stage-message is-warning" role="status">منو فقط برای مشاهده است؛ افزودن یا ثبت سفارش نیازمند مجوز ساخت سفارش است. فاکتور باز را از بخش «فاکتور» ببینید یا به صندوق‌دار بسپارید.</p>';
    container.innerHTML = `<div class="wt-menu-screen">${permissionNotice}${categoriesHtml}${itemsHtml}${cartDock}</div>`;

    document.getElementById('wt-menu-open-check')?.addEventListener('click', () => {
      wt.activeTab = 'check';
      renderWaiterTerminal();
    });

    container.querySelectorAll('.wt-menu-media img').forEach((image) => image.addEventListener('error', () => {
      image.hidden = true;
      const fallback = image.parentElement?.querySelector('.wt-menu-media__fallback');
      if (fallback) fallback.hidden = false;
    }, { once: true }));

    container.querySelectorAll('[data-wt-cat]').forEach((btn) => btn.addEventListener('click', () => {
      const rawCat = btn.dataset.wtCat;
      wt.activeCategory = rawCat === 'other' ? 'other' : Number(rawCat);
      wt.searchQuery = '';
      paintTerminalMenu(container);
    }));

    document.getElementById('wt-menu-back-categories')?.addEventListener('click', () => {
      wt.activeCategory = null;
      wt.searchQuery = '';
      paintTerminalMenu(container);
    });

    document.getElementById('wt-item-search')?.addEventListener('input', (e) => {
      wt.searchQuery = e.target.value.trim();
      paintTerminalMenu(container);
      const input = document.getElementById('wt-item-search');
      input?.focus();
      input?.setSelectionRange(String(e.target.value || '').length, String(e.target.value || '').length);
    });

    container.querySelectorAll('[data-open-item]').forEach((row) => row.addEventListener('click', () => {
      if (orderSubmissionLocked) return;
      const id = Number(row.dataset.openItem);
      const item = state.menuItems.find((i) => Number(i.id) === id);
      if (!item) return;
      if (isItemOutOfStock(item)) return showToast(`«${item.name}» در حال حاضر ناموجود است.`, 'warning');
      openItemCustomization(item);
    }));
  }

  function openItemCustomization(item) {
    const wt = state.waiterTerminal;
    if (waiterTerminalMutationLocked(wt)) {
      showToast(wt?.pendingOrderSubmission
        ? 'ابتدا ثبت سفارش قبلی را با همان کلید یکتا بازیابی کنید.'
        : wt?.pendingSplit || wt?.splitNeedsRefresh
          ? 'نتیجهٔ تفکیک قبلی نامشخص است؛ تا تطبیق با مدیر شیفت تغییری در سفارش ندهید.'
          : 'ابتدا وضعیت سفارش را با مدیر شیفت تطبیق دهید.', 'warning');
      return;
    }
    // Never silently assign every new item to guest 1. Seat attribution is an explicit choice.
    let selectedSeat = 0;
    const itemName = String(item.name || '');
    const inferredCourse = item.course || (itemName.includes('سالاد') || itemName.includes('سوپ') || itemName.includes('پیش‌غذا') ? 'starters' : itemName.includes('دسر') || itemName.includes('قهوه') || itemName.includes('نوشیدنی') || itemName.includes('بار') ? 'dessert' : 'entrees');
    let selectedCourse = inferredCourse;
    let selectedCourseStatus = 'fired';
    const canManageCourses = waiterHasCapability('orders.course.manage');
    let qty = 1;
    let note = '';
    const selectedMods = new Map();
    const modifierGroups = menuModifierGroupsForItem(item);

    const renderDrawer = () => {
      openDialog(
        item.name,
        money(item.price),
        `
        <div class="wt-item-drawer">
          <div class="wt-drawer-section">
            <label>تخصیص صندلی:</label>
            <div class="wt-seat-chips">
              <button type="button" class="wt-seat-chip ${selectedSeat === 0 ? 'active' : ''}" data-seat="0">کل میز</button>
              ${Array.from({ length: wt.seatsCount }, (_, i) => i + 1).map((s) => `
                <button type="button" class="wt-seat-chip ${selectedSeat === s ? 'active' : ''}" data-seat="${s}">صندلی ${num(s)}</button>
              `).join('')}
              <button type="button" class="btn btn-sm btn-ghost" id="drawer-add-seat">+ صندلی جدید</button>
            </div>
          </div>

          <div class="wt-drawer-section wt-preferences-section">
            <div class="wt-preferences-heading">
              <label>ترجیحات مخصوص این غذا</label>
              <small>فقط گزینه‌های مناسب «${esc(itemName)}» نمایش داده می‌شود</small>
            </div>
            ${modifierGroups.length ? modifierGroups.map((group) => `
              <div class="wt-preference-group" data-preference-group="${esc(group.id)}">
                <div class="wt-preference-group__head"><strong>${esc(group.title)}</strong><small>${modifierGroupMinimum(group) ? `حداقل ${num(modifierGroupMinimum(group))} انتخاب` : 'اختیاری'} · حداکثر ${num(modifierGroupMaximum(group))}</small></div>
                <div class="wt-modifier-chips">
                  ${(group.options || []).filter((option) => option.available !== false).map((option) => `
                    <button type="button" class="wt-seat-chip ${selectedMods.has(`${group.id}:${option.id}`) ? 'active' : ''}" data-modifier-group="${esc(group.id)}" data-modifier-option="${esc(option.id)}" aria-pressed="${selectedMods.has(`${group.id}:${option.id}`) ? 'true' : 'false'}">
                      <span>${esc(option.name)}</span>${Number(option.price || 0) > 0 ? `<small>+ ${money(option.price)}</small>` : ''}
                    </button>
                  `).join('')}
                </div>
              </div>
            `).join('') : '<div class="wt-preferences-empty">برای این غذا ترجیحی تعریف نشده است.</div>'}
          </div>

          <div class="wt-drawer-section wt-course-picker">
            <label for="drawer-course">مرحلهٔ سرو</label>
            <select id="drawer-course" class="role-search" ${canManageCourses ? '' : 'disabled title="تغییر مرحلهٔ سرو به مجوز مدیر نیاز دارد."'}>
              <option value="straight_fire" ${selectedCourse === 'straight_fire' ? 'selected' : ''}>پخت فوری</option>
              <option value="starters" ${selectedCourse === 'starters' ? 'selected' : ''}>پیش‌غذا</option>
              <option value="entrees" ${selectedCourse === 'entrees' ? 'selected' : ''}>غذای اصلی</option>
              <option value="dessert" ${selectedCourse === 'dessert' ? 'selected' : ''}>دسر و بار</option>
            </select>
            <div class="wt-course-picker__timing" role="group" aria-label="زمان ارسال به آشپزخانه">
              <button type="button" class="${selectedCourseStatus === 'fired' ? 'active' : ''}" data-course-status="fired" aria-pressed="${selectedCourseStatus === 'fired'}">ارسال همراه سفارش</button>
              ${canManageCourses ? `<button type="button" class="${selectedCourseStatus === 'hold' ? 'active' : ''}" data-course-status="hold" aria-pressed="${selectedCourseStatus === 'hold'}">نگه‌داشتن برای نوبت بعد</button>` : '<small role="status">نگه‌داشتن مرحله برای بعد در دسترسی شما نیست.</small>'}
            </div>
          </div>

          <div class="wt-drawer-section">
            <label>یادداشت به آشپزخانه:</label>
            <input type="text" id="drawer-item-note" class="role-search" placeholder="توضیحات خاص مهمان..." value="${esc(note)}" style="width:100%" />
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
            <div style="display:flex;align-items:center;gap:8px">
              <button type="button" class="btn btn-sm" id="drawer-dec-qty" aria-label="کاهش تعداد" ${qty <= 1 ? 'disabled' : ''} style="width:36px;height:36px;font-size:18px">−</button>
              <b aria-live="polite" style="font-size:16px;min-width:24px;text-align:center">${num(qty)}</b>
              <button type="button" class="btn btn-sm" id="drawer-inc-qty" aria-label="افزایش تعداد" ${!waiterCanIncrementItemQuantity(qty) ? 'disabled' : ''} style="width:36px;height:36px;font-size:18px">+</button>
            </div>
            <button type="button" class="role-primary" id="drawer-add-to-check" style="flex:1;margin-right:12px;padding:12px">
              افزودن به فاکتور
            </button>
          </div>
        </div>
        `,
        { variant: 'waiter-item', reuse: true }
      );

      dialogBody.querySelectorAll('[data-seat]').forEach((btn) => btn.addEventListener('click', () => {
        selectedSeat = Number(btn.dataset.seat);
        renderDrawer();
      }));

      dialogBody.querySelector('#drawer-add-seat')?.addEventListener('click', () => {
        if (wt.seatsCount >= 24) return showToast('حداکثر ۲۴ صندلی برای هر میز قابل ثبت است.', 'warning');
        wt.seatsCount++;
        wt.covers = Math.max(Number(wt.covers) || 1, wt.seatsCount);
        selectedSeat = wt.seatsCount;
        renderDrawer();
      });

      dialogBody.querySelector('#drawer-course')?.addEventListener('change', (event) => {
        selectedCourse = event.target.value;
      });
      dialogBody.querySelectorAll('[data-course-status]').forEach((button) => button.addEventListener('click', () => {
        selectedCourseStatus = button.dataset.courseStatus;
        renderDrawer();
      }));

      dialogBody.querySelectorAll('[data-modifier-option]').forEach((btn) => btn.addEventListener('click', () => {
        const group = modifierGroups.find((entry) => String(entry.id) === String(btn.dataset.modifierGroup));
        const option = (group?.options || []).find((entry) => String(entry.id) === String(btn.dataset.modifierOption));
        if (!group || !option) return;
        const optionId = String(option.id);
        const selectionId = `${group.id}:${optionId}`;
        if (selectedMods.has(selectionId)) selectedMods.delete(selectionId);
        else {
          if (group.selection === 'single') {
            for (const [selectedId, selected] of selectedMods) {
              if (String(selected.groupId || '') === String(group.id)) selectedMods.delete(selectedId);
            }
          }
          selectedMods.set(selectionId, { ...option, groupId: group.id, groupTitle: group.title });
        }
        renderDrawer();
      }));

      dialogBody.querySelector('#drawer-item-note')?.addEventListener('input', (event) => { note = event.target.value; });

      dialogBody.querySelector('#drawer-dec-qty')?.addEventListener('click', () => {
        if (qty > 1) { qty = Math.max(1, qty - 1); renderDrawer(); }
      });
      dialogBody.querySelector('#drawer-inc-qty')?.addEventListener('click', () => {
        if (!waiterCanIncrementItemQuantity(qty)) return showToast('حداکثر تعداد هر قلم ۹۹ است.', 'warning');
        qty++; renderDrawer();
      });

      dialogBody.querySelector('#drawer-add-to-check')?.addEventListener('click', () => {
        const lineNote = (document.getElementById('drawer-item-note')?.value || '').trim();
        const modifiers = Array.from(selectedMods.values()).map((option) => ({ ...option }));
        const selection = validateMenuModifierChoices(modifierGroups, modifiers);
        if (!selection.ok) {
          const missing = selection.missing[0];
          if (missing) return showToast(`حداقل ${num(modifierGroupMinimum(missing))} گزینه از «${missing.title}» انتخاب کنید`, 'error');
          const exceeded = selection.exceeded[0];
          if (exceeded) return showToast(`حداکثر ${num(modifierGroupMaximum(exceeded))} گزینه از «${exceeded.title}» مجاز است`, 'error');
          return showToast('انتخاب گزینه‌ها معتبر نیست؛ دوباره بررسی کنید.', 'error');
        }
        const addResult = mergeWaiterDraftLine(wt.lines, {
          localId: `line-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          menuItemId: item.id,
          name: item.name,
          price: Number(item.price || 0),
          qty,
          modifiers,
          complements: [],
          note: lineNote,
          seat: selectedSeat,
          course: selectedCourse,
          courseStatus: selectedCourseStatus,
          firedAt: selectedCourseStatus === 'fired' ? new Date().toISOString() : null,
          localSaved: false,
        });
        if (!addResult.ok) {
          return showToast(addResult.error === 'quantity_limit'
            ? 'حداکثر تعداد یک ترکیب یکسان ۹۹ است؛ تعداد فاکتور را بازبینی کنید.'
            : 'این قلم به دلیل اطلاعات نامعتبر به فاکتور افزوده نشد.', 'warning');
        }
        wt.dirty = true;
        dialog.close();
        showToast(`«${item.name}» به فاکتور افزوده شد.`);
        renderWaiterTerminal();
      });
    };

    renderDrawer();
  }

  function paintTerminalCheck(container) {
    const wt = state.waiterTerminal;
    const orderSubmissionLocked = waiterTerminalMutationLocked(wt);
    const orderLocked = Boolean(wt.order?.id && !orderCanEdit(wt.order));
    const canCreateOrders = waiterHasCapability('orders.create');
    const canManageCourses = waiterHasCapability('orders.course.manage');
    const canEdit = canCreateOrders && !orderLocked && !orderSubmissionLocked;
    const coursesMeta = [
      { id: 'straight_fire', name: '⚡ پخت فوری' },
      { id: 'starters', name: '🥗 پیش‌غذا' },
      { id: 'entrees', name: '🥩 غذای اصلی' },
      { id: 'dessert', name: '🍰 دسر و بار' },
    ];
    const orderStatus = String(wt.order?.status || '');
    const orderSent = Boolean(wt.order?.id) && !['draft', 'pay_at_cashier', 'awaiting_confirmation', 'pending_online'].includes(orderStatus);

    const coursesWithItems = coursesMeta.map((c) => {
      const items = wt.lines.filter((l) => (l.course || 'starters') === c.id);
      const hasFired = items.some((l) => l.courseStatus === 'fired');
      const isFired = items.length > 0 && items.every((l) => l.courseStatus === 'fired');
      const hasHold = items.some((l) => l.courseStatus === 'hold');
      const hasUnsentLines = items.some((line) => !line.localSaved);
      const hasSavedLines = items.some((line) => line.localSaved);
      return { ...c, items, isFired, hasFired, hasHold, hasUnsentLines, hasSavedLines };
    }).filter((c) => c.items.length > 0);

    const calculatedTotal = wt.lines.reduce((sum, line) => sum + receiptLineTotal(line), 0);
    const total = wt.order?.id && Number.isFinite(Number(wt.order.total)) ? Number(wt.order.total) : calculatedTotal;
    const subtotal = wt.order?.id && Number.isSafeInteger(Number(wt.order.subtotal)) && Number(wt.order.subtotal) >= 0
      ? Number(wt.order.subtotal)
      : calculatedTotal;
    const discount = wt.order?.id && Number.isSafeInteger(Number(wt.order.discount)) && Number(wt.order.discount) >= 0
      ? Number(wt.order.discount)
      : 0;
    const deliveryFee = wt.order?.id && Number.isSafeInteger(Number(wt.order.deliveryFee)) && Number(wt.order.deliveryFee) >= 0
      ? Number(wt.order.deliveryFee)
      : 0;
    const otherAdjustment = total - subtotal - deliveryFee + discount;
    const paymentWorkflow = wt.order?.id
      ? globalThis.WestoOrderPaymentState.deriveOrderPaymentWorkflow(wt.order)
      : null;
    const paymentAmounts = paymentWorkflow
      ? paymentWorkflow.amounts
      : globalThis.WestoOrderPaymentState.getOrderPaymentAmounts({}, total);
    const amountPaid = paymentAmounts.paid;
    const amountDue = paymentAmounts.due;
    const paymentUnknown = paymentWorkflow?.requiresReconciliation === true;
    const paymentIntentConflict = wt.paymentIntentConflict === true;
    const pendingPaymentCanRetry = !wt.pendingPayment
      || waiterPendingPaymentCanRecover(wt.pendingPayment, wt.order, state.branchId);
    const serviceComplete = ['done', 'completed', 'picked_up', 'delivered'].includes(orderStatus);
    const hasUnsentChanges = wt.dirty || wt.lines.some((line) => !line.localSaved);
    const hasFiredCourse = wt.lines.some((line) => line.courseStatus === 'fired');
    const canSend = canEdit && !orderSubmissionLocked && !wt.remoteUpdatePending
      && wt.lines.length > 0 && hasFiredCourse && (!orderSent || hasUnsentChanges);
    const canServe = waiterHasCapability('service.manage') && Boolean(wt.order?.id) && orderStatus === 'ready' && !serviceComplete && !wt.serveNeedsRefresh && !orderSubmissionLocked;
    const settlementStage = paymentWorkflow?.stages.find((stage) => stage.id === 'settlement');
    const capabilities = state.session?.workspace?.capabilities || [];
    const canCollectPayment = capabilities.includes('*') || capabilities.includes('payments.collect');
    const canPay = Boolean(wt.order?.id) && orderSent && serviceComplete
      && canCollectPayment && !wt.paymentNeedsRefresh && !wt.paymentPending
      && !wt.orderSaveNeedsRefresh && !wt.orderSubmissionConflict && !wt.saving
      && !wt.pendingSplit && !wt.splitNeedsRefresh && !wt.splitSaving
      && !paymentIntentConflict && pendingPaymentCanRetry
      && paymentWorkflow?.isConsistent === true
      && settlementStage?.state === 'current'
      && Number.isFinite(amountDue) && amountDue > 0;

    const sectionsHtml = coursesWithItems.map((c) => `
      <div class="wt-course-section" data-section-course="${c.id}">
        <div class="wt-course-head">
          <div class="wt-course-title">
            <span>${c.name}</span>
            <span class="wt-course-badge ${c.isFired ? 'is-fired' : 'is-hold'}">
              ${c.isFired
                ? (wt.order?.id && orderSent && !c.hasUnsentLines
                  ? '🔥 ارسال‌شده برای پخت'
                  : wt.order?.id && orderSent && c.hasSavedLines && c.hasUnsentLines
                    ? '◐ بخشی ارسال شد؛ اقلام تازه پس از ثبت'
                    : '📤 پس از ثبت به آشپزخانه می‌رود')
                : c.hasFired ? '◐ بخشی آمادهٔ ارسال' : '⏳ در انتظار ارسال'}
            </span>
          </div>
          ${c.hasHold ? `
            <button type="button" class="wt-fire-btn" data-fire-course="${c.id}" ${orderSubmissionLocked || !canManageCourses ? 'disabled aria-disabled="true"' : ''} title="${!canManageCourses ? 'برای ارسال یا تغییر مرحلهٔ پخت از مدیر شیفت دسترسی بخواهید.' : ''}">
              <span>🔥</span>
              <span>${!canManageCourses ? 'نیازمند مجوز ارسال پخت' : wt.order?.id && c.items.some((line) => line.localSaved && line.courseStatus === 'hold') ? 'ارسال پخت' : 'آماده‌سازی برای ثبت'}</span>
            </button>
          ` : ''}
        </div>
        <div>
          ${c.items.map((line) => `
            <div class="wt-line-item">
              <div class="wt-line-item__left">
                <span class="wt-line-item__name">
                  ${num(line.qty)}× ${esc(line.name)}
                  <span class="wt-seat-tag">${line.seat === 0 ? 'کل میز' : `صندلی ${num(line.seat)}`}</span>
                </span>
                ${(line.modifiers || []).length ? `<span class="wt-line-item__mods">${(line.modifiers || []).map((m) => esc(m.name)).join('، ')}</span>` : ''}
                ${line.note ? `<small style="color:#d97706">یادداشت: ${esc(line.note)}</small>` : ''}
              </div>
              <div style="display:flex;align-items:center;gap:10px">
                <strong class="wt-line-item__price">${money(receiptLineTotal(line))}</strong>
                <button type="button" class="btn btn-sm btn-ghost wt-line-remove" data-remove-line="${line.localId}" ${canEdit ? '' : 'disabled'} title="${esc(!canCreateOrders ? 'برای ویرایش سفارش از مدیر شیفت دسترسی بخواهید.' : canEdit ? 'حذف قلم' : 'این سفارش قفل شده است')}" aria-label="${esc(canEdit ? 'حذف قلم' : !canCreateOrders ? 'حذف قلم؛ نیازمند مجوز ویرایش سفارش' : 'سفارش قفل شده')}" style="color:#ef4444;font-size:14px">${canEdit ? '✕' : '🔒'}</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');

    const emptyHtml = !wt.lines.length ? empty('هنوز محصولی به فاکتور افزوده نشده است.') : '';

    const nextActionHtml = wt.splitNeedsRefresh
      ? '<p class="wt-stage-message is-warning" role="alert">نتیجهٔ تفکیک نامشخص است؛ تفکیک را دوباره اجرا نکنید و فاکتورهای میز را با مدیر شیفت تطبیق دهید.</p>'
      : wt.orderSubmissionConflict
      ? '<p class="wt-stage-message is-warning" role="alert">نتیجهٔ ثبت سفارش با وضعیت فعلی قابل تطبیق نیست؛ ارسال دوباره متوقف شد. سفارش‌های همین میز را با مدیر شیفت بررسی کنید.</p>'
      : wt.saving
        ? '<button type="button" class="wt-send-btn" disabled aria-disabled="true">در حال ثبت سفارش…</button><p class="wt-stage-message" role="status" aria-live="polite">لطفاً تا دریافت نتیجه، این صفحه را نبندید.</p>'
      : wt.pendingOrderSubmission && wt.orderSaveNeedsRefresh
        ? '<button type="button" class="wt-send-btn" id="wt-retry-order-submission"><span>↻</span><span>بازیابی همان سفارش ثبت‌شده</span></button><p class="wt-stage-message is-warning" role="status">فقط همان اقلام و همان کلید یکتا ارسال می‌شود؛ سفارش تازه‌ای ساخته نمی‌شود.</p>'
      : wt.orderSaveNeedsRefresh
        ? '<p class="wt-stage-message is-warning" role="alert">نتیجهٔ ذخیرهٔ سفارش روشن نیست؛ ابتدا «به‌روزرسانی وضعیت» را بزنید و نسخهٔ سرور را با مدیر شیفت تطبیق دهید.</p>'
      : canSend
      ? `<button type="button" class="wt-send-btn" id="wt-send-check"><span>📤</span><span>${wt.order?.id ? 'ذخیره و ارسال سفارش به آشپزخانه' : 'ثبت سفارش و ارسال به آشپزخانه'}</span></button>`
      : canEdit && wt.lines.length > 0 && !hasFiredCourse
        ? '<p class="wt-stage-message is-warning" role="status">برای ثبت سفارش، دست‌کم یک دوره را با «ارسال هنگام ثبت» به آشپزخانه بفرستید.</p>'
      : orderStatus === 'ready' && !waiterHasCapability('service.manage')
        ? '<p class="wt-stage-message" role="status">سفارش آماده است؛ ثبت تحویل به مجوز مسئول شیفت نیاز دارد. آن را به مسئول مجاز بسپارید.</p>'
      : canServe
        ? '<button type="button" class="wt-serve-btn" id="wt-serve-order"><span>🍽️</span><span>تحویل سفارش به میز</span></button>'
      : wt.serveNeedsRefresh && orderStatus === 'ready'
        ? '<p class="wt-stage-message is-warning" role="alert">نتیجهٔ ثبت تحویل روشن نیست؛ پیش از تکرار، وضعیت سفارش را از سرور به‌روزرسانی کنید.</p>'
      : wt.paymentNeedsRefresh
        ? '<button type="button" class="wt-pay-btn" id="wt-refresh-payment-status"><span>↻</span><span>بررسی دوبارهٔ وضعیت دریافت وجه</span></button><p class="wt-stage-message is-warning" role="alert">نتیجهٔ دریافت وجه نامشخص است؛ پیش از هر تکراری وضعیت سفارش را تازه کنید.</p>'
      : paymentIntentConflict
        ? '<p class="wt-stage-message is-warning" role="alert">مبلغ فاکتور پس از درخواست دریافت تغییر کرده است؛ از تکرار یا دریافت دوباره خودداری کنید و فاکتور را برای تطبیق به صندوق‌دار بسپارید.</p>'
      : wt.pendingPayment && !pendingPaymentCanRetry
        ? '<p class="wt-stage-message is-warning" role="alert">درخواست قبلی کارت بانکی کد پیگیری رسید ندارد یا با فاکتور فعلی سازگار نیست؛ درخواست تازه نسازید و وجه را دوباره دریافت نکنید. فاکتور را برای تطبیق به صندوق‌دار بسپارید.</p>'
      : wt.pendingPayment && canPay
        ? `<button type="button" class="wt-pay-btn" id="wt-pay-btn"><span>↻</span><span>تکرار امن همان ثبت دریافت · ${money(amountDue)}</span></button><p class="wt-stage-message is-warning" role="status">این تلاش با همان کلید یکتا تکرار می‌شود و دریافت جدیدی ایجاد نمی‌کند.</p>`
      : canPay
          ? `<button type="button" class="wt-pay-btn" id="wt-pay-btn"><span>💳</span><span>تسویه ماندهٔ ${money(amountDue)}</span></button>`
          : wt.order?.id && !canCreateOrders && hasUnsentChanges
            ? '<p class="wt-stage-message" role="status">ویرایش یا ثبت اقلام این سفارش به مجوز ساخت یا ویرایش نیاز دارد؛ نسخهٔ فعلی فقط‌خواندنی است.</p>'
          : wt.order?.id && serviceComplete && !canCollectPayment
            ? '<p class="wt-stage-message" role="status">برای ثبت دریافت وجه، فاکتور را به صندوق‌دار بسپارید.</p>'
          : paymentUnknown
            ? '<p class="wt-stage-message is-warning" role="alert">اطلاعات سفارش یا پرداخت با هم سازگار نیست؛ تسویه تا بررسی صندوق غیرفعال است.</p>'
          : paymentWorkflow?.settled && serviceComplete
            ? '<p class="wt-stage-message is-complete" role="status">سفارش تحویل و تسویه شده است.</p>'
              : paymentWorkflow?.settled
              ? `<p class="wt-stage-message" role="status">پرداخت ثبت شد؛ ${orderStatus === 'ready' ? 'تحویل سفارش به میز را ثبت کنید.' : 'پس از آماده‌شدن، سفارش را تحویل دهید.'}</p>`
              : wt.order?.id && !serviceComplete
                ? `<p class="wt-stage-message" role="status">${orderStatus === 'ready' ? 'سفارش آمادهٔ تحویل است.' : 'سفارش در حال آماده‌سازی است؛ تسویه پس از ثبت تحویل فعال می‌شود.'}</p>`
                : '';

    const summaryHtml = `
      <div class="wt-summary-bar">
        <div class="wt-summary-bar__total">
          <span>${amountPaid > 0 && amountDue > 0 ? 'ماندهٔ قابل پرداخت' : 'جمع کل صورت‌حساب'}</span>
          <strong>${money(amountPaid > 0 && amountDue > 0 ? amountDue : total)}</strong>
        </div>
        ${amountPaid > 0 && amountDue > 0 ? `<div class="wt-summary-bar__paid">پرداخت‌شده: ${money(amountPaid)} · مانده: ${money(amountDue)}</div>` : ''}
        <div class="wt-summary-bar__buttons">${nextActionHtml}</div>
      </div>
    `;

    const invoiceBreakdown = wt.lines.length ? `
      <section class="wt-invoice-breakdown" aria-label="جزئیات مبلغ فاکتور">
        <div><span>جمع اقلام</span><strong>${money(subtotal)}</strong></div>
        ${deliveryFee > 0 ? `<div><span>هزینهٔ ارسال</span><strong>${money(deliveryFee)}</strong></div>` : ''}
        ${discount > 0 ? `<div class="is-discount"><span>تخفیف</span><strong>− ${money(discount)}</strong></div>` : ''}
        ${otherAdjustment !== 0 ? `<div><span>تعدیل دیگر</span><strong>${otherAdjustment < 0 ? '− ' : '+ '}${money(Math.abs(otherAdjustment))}</strong></div>` : ''}
        <div class="is-total"><span>مبلغ نهایی</span><strong>${money(total)}</strong></div>
      </section>
    ` : '';
    container.innerHTML = `<div class="wt-check-view">${sectionsHtml || emptyHtml}${invoiceBreakdown}</div>` + (wt.lines.length ? summaryHtml : '');

    container.querySelectorAll('[data-fire-course]').forEach((btn) => btn.addEventListener('click', async () => {
      const course = btn.dataset.fireCourse;
      await fireCourse(course, btn);
    }));

    container.querySelectorAll('[data-remove-line]').forEach((btn) => btn.addEventListener('click', () => {
      const localId = btn.dataset.removeLine;
      if (!canEdit) return;
      if (wt.lines.some((line) => line.localId === localId && line.localSaved)) wt.dirty = true;
      wt.lines = wt.lines.filter((l) => l.localId !== localId);
      renderWaiterTerminal();
    }));

    document.getElementById('wt-pay-btn')?.addEventListener('click', () => payWaiterCheck());
    document.getElementById('wt-refresh-payment-status')?.addEventListener('click', (event) => refreshWaiterPaymentState(event.currentTarget));
    document.getElementById('wt-send-check')?.addEventListener('click', () => saveAndSendTerminalOrder(false));
    document.getElementById('wt-retry-order-submission')?.addEventListener('click', () => saveAndSendTerminalOrder(false));
    document.getElementById('wt-serve-order')?.addEventListener('click', (event) => serveWaiterOrder(event.currentTarget));
  }

  async function refreshWaiterPaymentState(button) {
    const wt = state.waiterTerminal;
    if (!wt?.order?.id || wt.paymentRefreshPending) return;
    const orderId = Number(wt.order.id);
    const previousPaid = Number(wt.pendingPayment?.baselinePaid ?? globalThis.WestoOrderPaymentState.deriveOrderPaymentWorkflow(wt.order).amounts.paid) || 0;
    wt.paymentRefreshPending = true;
    setBusy(button, true);
    try {
      await fetchWaiter();
      const latest = (state.data.orders || []).find((order) => Number(order.id) === orderId);
      if (!latest) {
        wt.paymentNeedsRefresh = true;
        wt.paymentRefreshPending = false;
        renderWaiterTerminal();
        showToast('سفارش در تازه‌سازی پیدا نشد؛ دریافت وجه را تکرار نکنید و دسترسی شعبه را بررسی کنید.', 'error');
        return;
      }
      const refreshed = JSON.parse(JSON.stringify(latest));
      const workflow = globalThis.WestoOrderPaymentState.deriveOrderPaymentWorkflow(refreshed);
      if (workflow.isConsistent !== true || workflow.requiresReconciliation) {
        wt.order = refreshed;
        wt.paymentNeedsRefresh = true;
        wt.paymentRefreshPending = false;
        wt.activeTab = 'check';
        renderWaiterTerminal();
        showToast('وضعیت سفارش تازه شد اما مغایرت مالی دارد؛ دریافت دوباره متوقف است.', 'error');
        return;
      }
      wt.order = refreshed;
      wt.paymentNeedsRefresh = false;
      wt.paymentRefreshPending = false;
      wt.paymentIntentConflict = false;
      if (workflow.settled || workflow.amounts.paid > previousPaid) {
        const pending = wt.pendingPayment;
        const matchingReceipt = !pending || (Array.isArray(refreshed.partialPayments)
          && refreshed.partialPayments.some((payment) => String(payment?.idempotencyKey || '') === String(pending.idempotencyKey || '')));
        if (!matchingReceipt) {
          wt.paymentIntentConflict = true;
          wt.activeTab = 'check';
          renderWaiterTerminal();
          showToast('فاکتور هم‌زمان تغییر کرده اما رسیدی با شناسهٔ همین درخواست پیدا نشد؛ صندوق باید دو وضعیت را تطبیق دهد.', 'error');
          return;
        }
        if (pending?.idempotencyKey && pending.intent) clearSettlementIdempotencyKey(pending.idempotencyKey, pending.intent);
        wt.pendingPayment = null;
        clearWaiterTerminalDraft(wt.table.id);
        if (workflow.settled) {
          state.waiterTerminal = null;
          waiterFloor();
          showToast('وضعیت تازه شد؛ فاکتور تسویه شده و میز آزاد است.');
        } else {
          wt.activeTab = 'check';
          renderWaiterTerminal();
          showToast(`دریافت وجه ثبت شده؛ ماندهٔ ${money(workflow.amounts.due)} را بررسی کنید.`, 'warning');
        }
        return;
      }
      if (wt.pendingPayment
        && Number(wt.pendingPayment.intent?.paymentAmount) !== Number(workflow.amounts.due)) {
        wt.paymentIntentConflict = true;
        wt.activeTab = 'check';
        renderWaiterTerminal();
        showToast('ماندهٔ فاکتور پس از درخواست دریافت تغییر کرده است؛ تکرار خودکار متوقف شد و صندوق باید مبلغ را تطبیق دهد.', 'error');
        return;
      }
      // No payment evidence appeared. Retain the original idempotency key and
      // intent so a later retry cannot create a second collection.
      wt.activeTab = 'check';
      renderWaiterTerminal();
      showToast('در وضعیت تازه، پرداختی ثبت نشده است؛ در صورت تکرار، همان درخواست یکتا استفاده می‌شود.', 'warning');
    } catch (error) {
      wt.paymentNeedsRefresh = true;
      wt.paymentRefreshPending = false;
      wt.activeTab = 'check';
      renderWaiterTerminal();
      showToast(`تازه‌سازی وضعیت وجه انجام نشد: ${error.message} دریافت را تکرار نکنید.`, 'error');
    }
  }

  async function fireCourse(course, button) {
    const wt = state.waiterTerminal;
    if (!wt) return;
    if (!waiterHasCapability('orders.course.manage')) {
      showToast('ارسال مرحلهٔ پخت در دسترسی شما نیست؛ از مدیر شیفت دسترسی لازم را درخواست کنید.', 'error');
      return;
    }
    if (waiterTerminalMutationLocked(wt)) {
      if (wt.pendingSplit || wt.splitNeedsRefresh) {
        showToast('نتیجهٔ تفکیک قبلی نامشخص است؛ تا تطبیق با مدیر شیفت، ارسال جدید متوقف است.', 'warning');
        return;
      }
      showToast('ابتدا ثبت سفارش قبلی را تعیین تکلیف کنید.', 'warning');
      return;
    }
    wt.firingCourses ||= new Set();
    if (wt.firingCourses.has(course)) return;
    const courseLabels = { starters: 'پیش‌غذا', entrees: 'غذای اصلی', dessert: 'دسر', straight_fire: 'پخت فوری' };
    const label = courseLabels[course] || course;
    const { heldLines: courseLines, savedLines, unsavedLines: localLines } = splitWaiterCourseLines(wt.lines, course);
    if (!courseLines.length) return;
    wt.firingCourses.add(course);
    setBusy(button, true);
    try {
      if (wt.order?.id && savedLines.length) {
        const result = await api(`/api/waiter/orders/${wt.order.id}/fire-course`, {
          method: 'PATCH',
          body: JSON.stringify({ course }),
        });
        const responseOrder = result?.order;
        const responseCourse = String(result?.course || '').trim().toLowerCase();
        const confirmedCourseItems = Array.isArray(responseOrder?.items)
          ? responseOrder.items.filter((line) => String(line?.course || 'starters').trim().toLowerCase() === course)
          : [];
        const courseConfirmed = confirmedCourseItems.length > 0
          && confirmedCourseItems.every((line) => String(line?.courseStatus || 'fired').trim().toLowerCase() === 'fired');
        if (result?.ok !== true
          || !waiterOrderResponseMatchesIntent(responseOrder, {
            orderId: wt.order.id,
            branchId: state.branchId,
            tableId: wt.table.id,
          })
          || responseCourse !== course
          || !courseConfirmed) {
          throw Object.assign(new Error('پاسخ ارسال دوره با شناسه، شعبه یا میز جاری تطبیق ندارد؛ پیش از اقدام دوباره، وضعیت سفارش را تازه کنید.'), {
            code: 'waiter_course_response_unverified',
            outcomeUnknown: true,
          });
        }
        // Firing the first saved course may also advance pay_at_cashier to
        // sent_to_kitchen. Keep the stepper and next action on that server state.
        wt.order = JSON.parse(JSON.stringify(responseOrder));
        wt.checkNo = wt.order.checkNo || wt.checkNo;
      }
      const firedAt = new Date().toISOString();
      courseLines.forEach((line) => {
        line.courseStatus = 'fired';
        line.firedAt = firedAt;
      });
      if (localLines.length) wt.dirty = true;
      if (savedLines.length && localLines.length) {
        showToast(`مرحلهٔ «${label}» ارسال شد؛ اقلام ثبت‌نشده پس از ذخیره به آشپزخانه می‌روند.`);
      } else if (savedLines.length) {
        showToast(`دستور پخت «${label}» به آشپزخانه ارسال شد.`);
      } else {
        showToast(`مرحلهٔ «${label}» آماده شد و هنگام ثبت سفارش ارسال می‌شود.`);
      }
    } catch (err) {
      if (err.outcomeUnknown && savedLines.length) {
        wt.orderSaveNeedsRefresh = true;
        wt.activeTab = 'check';
        persistWaiterTerminalDraft(wt);
        showToast('نتیجهٔ ارسال دوره روشن نیست؛ وضعیت سفارش را تازه کنید و تا آن زمان دوباره ارسال نکنید.', 'warning');
      } else {
        showToast(err.message, 'error');
      }
    } finally {
      wt.firingCourses.delete(course);
      renderWaiterTerminal();
    }
  }

  async function saveAndSendTerminalOrder(shouldReturn = true) {
    const wt = state.waiterTerminal;
    if (!wt) return;
    if (wt.saving) return;
    if (wt.pendingPayment || wt.paymentNeedsRefresh || wt.paymentIntentConflict) {
      showToast('درخواست دریافت وجه هنوز تعیین تکلیف نشده است؛ تا تطبیق با صندوق، سفارش را ویرایش یا دوباره ارسال نکنید.', 'warning');
      return false;
    }
    if (wt.pendingSplit || wt.splitNeedsRefresh || wt.splitSaving) {
      showToast('نتیجهٔ تفکیک قبلی روشن نیست؛ پیش از ارسال یا ویرایش، فاکتور را با مدیر شیفت تطبیق دهید.', 'warning');
      return false;
    }
    const isCreate = !wt.order?.id;
    const replayingCreate = isCreate && Boolean(wt.pendingOrderSubmission);
    if (wt.orderSubmissionConflict) {
      showToast('نتیجهٔ قبلی با وضعیت فعلی قابل تطبیق نیست؛ سفارش را با مدیر شیفت بررسی کنید.', 'warning');
      return false;
    }
    if (wt.orderSaveNeedsRefresh && !replayingCreate) {
      showToast('ابتدا وضعیت سفارش را تازه کنید و با مدیر شیفت تطبیق دهید؛ ارسال دوباره متوقف است.', 'warning');
      return false;
    }
    if (isCreate && wt.idempotencyKey && !wt.pendingOrderSubmission) {
      wt.orderSaveNeedsRefresh = true;
      wt.orderSubmissionConflict = true;
      persistWaiterTerminalDraft(wt);
      renderWaiterTerminal();
      showToast('کلید قدیمی بدون payload قابل بازیابی پیدا شد؛ سفارش را با مدیر شیفت تطبیق دهید.', 'warning');
      return false;
    }
    if (replayingCreate && !waiterOrderSubmissionCanRecover(wt.pendingOrderSubmission, wt.table.id, state.branchId)) {
      wt.orderSaveNeedsRefresh = true;
      wt.orderSubmissionConflict = true;
      persistWaiterTerminalDraft(wt);
      renderWaiterTerminal();
      showToast('درخواست ذخیره‌شده با این میز یا شعبه تطبیق ندارد؛ ارسال متوقف شد.', 'error');
      return false;
    }
    if (!replayingCreate && !wt.lines.length) {
      showToast('حداقل یک غذا را به فاکتور اضافه کنید.', 'error');
      return;
    }
    if (!replayingCreate && !wt.lines.some((line) => line.courseStatus === 'fired')) {
      showToast('همهٔ غذاها برای نوبت بعد نگه داشته شده‌اند؛ یک مرحله را برای ارسال به آشپزخانه انتخاب کنید.', 'error');
      return;
    }
    if (!replayingCreate) {
      const coversState = validateWaiterCovers(wt.covers, wt.lines);
      if (!coversState.ok) {
        showToast(coversState.error === 'covers_invalid' ? 'تعداد مهمان باید عددی بین ۱ تا ۹۹ باشد.' : 'تعداد مهمان را با صندلی‌های تخصیص‌یافته هماهنگ کنید.', 'error');
        return;
      }
      wt.covers = coversState.covers;
    }
    wt.saving = true;

    const payloadItems = wt.lines.map((line) => ({
      menuItemId: line.menuItemId,
      qty: line.qty,
      modifiers: line.modifiers || [],
      complements: line.complements || [],
      note: line.note || '',
      seat: line.seat || 0,
      course: line.course || 'starters',
      courseStatus: line.courseStatus || 'fired',
      firedAt: line.firedAt || null,
    }));

    const disableTerminalControls = () => {
      const screen = main.querySelector('.waiter-terminal-screen');
      if (!screen) return;
      screen.setAttribute('aria-busy', 'true');
      screen.querySelectorAll('button, input, select, textarea').forEach((control) => { control.disabled = true; });
    };

    let createdPendingOrderSubmission = false;
    try {
      if (!isCreate) {
        // The edit route is not idempotent. Persist a reconciliation lock before sending
        // so a hard page close cannot make an uncertain kitchen update look retryable.
        wt.orderSaveNeedsRefresh = true;
        wt.orderSubmissionConflict = true;
        if (!persistWaiterTerminalDraft(wt)) {
          wt.orderSaveNeedsRefresh = false;
          wt.orderSubmissionConflict = false;
          wt.saving = false;
          renderWaiterTerminal();
          showToast('پیش‌نویس امن ذخیره نشد؛ برای جلوگیری از گم‌شدن تغییرات، سفارش هنوز ارسال نشده است.', 'error');
          return false;
        }
        disableTerminalControls();
        const res = await api(`/api/waiter/orders/${wt.order.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            branchId: state.branchId,
            items: payloadItems,
            covers: wt.covers,
            note: wt.note || '',
            name: wt.guestName || '',
            phone: wt.guestPhone || '',
            sendToKitchen: true,
          }),
        });
        if (res?.ok !== true || !waiterOrderResponseMatchesIntent(res.order, {
          orderId: wt.order.id,
          branchId: state.branchId,
          tableId: wt.table.id,
        })) {
          throw Object.assign(new Error('پاسخ ذخیرهٔ سفارش با شناسه، شعبه یا میز جاری تطبیق ندارد؛ وضعیت فاکتور را با مدیر شیفت بررسی کنید.'), { code: 'waiter_order_response_unverified', outcomeUnknown: true });
        }
        wt.order = res.order || wt.order;
        wt.checkNo = wt.order?.checkNo || wt.checkNo;
        wt.lines.forEach((l) => { l.localSaved = true; });
        wt.dirty = false;
        wt.orderSaveNeedsRefresh = false;
        wt.orderSubmissionConflict = false;
        clearWaiterTerminalDraft(wt.table.id);
        showToast('سفارش به‌روزرسانی و برای آشپزخانه ارسال شد.');
      } else {
        if (!wt.pendingOrderSubmission) {
          const idempotencyKey = `waiter-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          const payload = {
            branchId: state.branchId,
            fulfillment: 'dine_in',
            tableNo: String(wt.table.id),
            covers: wt.covers,
            checkNo: wt.checkNo || String(wt.table.id),
            name: wt.guestName || '',
            phone: wt.guestPhone || '',
            note: wt.note || '',
            paymentMethod: 'cashier',
            sendToKitchen: true,
            items: payloadItems,
          };
          wt.idempotencyKey = idempotencyKey;
          wt.pendingOrderSubmission = { idempotencyKey, payload: JSON.parse(JSON.stringify(payload)) };
          createdPendingOrderSubmission = true;
        }
        const pending = wt.pendingOrderSubmission;
        wt.idempotencyKey = pending.idempotencyKey;
        wt.orderSaveNeedsRefresh = true;
        if (!persistWaiterTerminalDraft(wt)) {
          if (createdPendingOrderSubmission) {
            wt.pendingOrderSubmission = null;
            wt.idempotencyKey = null;
            wt.orderSaveNeedsRefresh = false;
          }
          wt.saving = false;
          renderWaiterTerminal();
          showToast(createdPendingOrderSubmission
            ? 'پیش‌نویس در حافظهٔ این نشست ذخیره نشد؛ برای جلوگیری از گم‌شدن سفارش، هنوز چیزی به سرور ارسال نشده است.'
            : 'درخواست قبلی حفظ شده اما ذخیرهٔ امن نشست در دسترس نیست؛ فعلاً تکرار ارسال نشد.', 'error');
          return false;
        }
        disableTerminalControls();
        const res = await api('/api/staff/orders', {
          method: 'POST',
          headers: { 'Idempotency-Key': pending.idempotencyKey },
          body: JSON.stringify(pending.payload),
        });
        if (res?.ok !== true || !waiterOrderResponseMatchesIntent(res.order, {
          orderId: res.order?.id,
          branchId: state.branchId,
          tableId: wt.table.id,
          exactTableNo: true,
        })) {
          throw Object.assign(new Error('پاسخ ثبت سفارش با شناسه، شعبه یا میز جاری تطبیق ندارد؛ آن را با مدیر شیفت بررسی کنید.'), { code: 'waiter_order_response_unverified', outcomeUnknown: true });
        }
        wt.order = res.order;
        wt.checkNo = wt.order?.checkNo || wt.checkNo;
        wt.lines.forEach((l) => { l.localSaved = true; });
        wt.dirty = false;
        wt.pendingOrderSubmission = null;
        wt.idempotencyKey = null;
        wt.orderSaveNeedsRefresh = false;
        wt.orderSubmissionConflict = false;
        clearWaiterTerminalDraft(wt.table.id);
        showToast('سفارش ثبت و برای آشپزخانه ارسال شد.');
      }
      const refreshed = await refreshWaiterAfterMutation();
      wt.saving = false;
      if (shouldReturn) {
        if (refreshed) {
          state.waiterTerminal = null;
          waiterFloor();
        } else {
          renderWaiterTerminal();
        }
      } else {
        renderWaiterTerminal();
      }
      return true;
    } catch (err) {
      const unsafeCreateReplay = isCreate && ['idempotency_key_conflict', 'idempotency_replay_unavailable', 'waiter_order_response_unverified'].includes(String(err.code || ''));
      if (isCreate) {
        if (unsafeCreateReplay) {
          wt.orderSubmissionConflict = true;
          wt.orderSaveNeedsRefresh = true;
        } else if (err.outcomeUnknown) {
          wt.orderSaveNeedsRefresh = true;
        } else {
          wt.pendingOrderSubmission = null;
          wt.idempotencyKey = null;
          wt.orderSaveNeedsRefresh = false;
          wt.orderSubmissionConflict = false;
        }
      } else if (err.outcomeUnknown) {
        // The edit route has no idempotency contract. Never replay an uncertain kitchen update blindly.
        wt.orderSaveNeedsRefresh = true;
        wt.orderSubmissionConflict = true;
      } else if (!isCreate) {
        wt.orderSaveNeedsRefresh = false;
        wt.orderSubmissionConflict = false;
      }
      wt.saving = false;
      persistWaiterTerminalDraft(wt);
      renderWaiterTerminal();
      showToast(err.message, 'error');
      return false;
    } finally {
      wt.saving = false;
    }
  }

  function paintTerminalActions(container) {
    const wt = state.waiterTerminal;
    const orderSubmissionLocked = waiterTerminalMutationLocked(wt);
    const splitBlockedByDraft = Boolean(wt.dirty || wt.remoteUpdatePending || wt.lines.some((line) => !line.localSaved));
    const splitOrderStatus = String(wt.order?.status || '').trim().toLowerCase();
    const splitBlockedByKitchen = ['sent_to_kitchen', 'preparing', 'ready'].includes(splitOrderStatus)
      || (Boolean(wt.order?.startedAt) && !['done', 'completed'].includes(splitOrderStatus));
    const splitBlockedByCancelled = splitOrderStatus === 'cancelled';
    const canEditOrder = waiterHasCapability('orders.create') && !orderSubmissionLocked
      && (!wt.order?.id || orderCanEdit(wt.order));
    const canSplitOrder = waiterHasCapability('orders.split') && Boolean(wt.order?.id)
      && !orderSubmissionLocked && !splitBlockedByDraft && !splitBlockedByKitchen && !splitBlockedByCancelled;
    const hasAvailableMoveTarget = waiterAvailableAssignmentTables()
      .some((table) => String(table.id) !== String(wt.table?.id));
    const canMoveOrder = waiterHasCapability('orders.move_table') && Boolean(wt.order?.id)
      && canEditOrder && hasAvailableMoveTarget;
    const actionCapabilities = state.session?.workspace?.capabilities || [];
    const paymentAction = waiterPaymentActionState(
      wt,
      actionCapabilities,
      state.branchId,
    );
    const canCollectCash = actionCapabilities.includes('*') || actionCapabilities.includes('cash.manage');
    const paymentActionHints = {
      permission: 'دسترسی دریافت وجه ندارید؛ فاکتور را به صندوق‌دار بسپارید.',
      order: 'پس از ثبت سفارش و ارسال به آشپزخانه فعال می‌شود.',
      service: 'پس از ثبت تحویل سفارش به میز فعال می‌شود.',
      refresh: 'ابتدا وضعیت سفارش یا دریافت قبلی را تازه کنید.',
      reconciliation: 'دریافت متوقف است؛ فاکتور باید با صندوق تطبیق داده شود.',
      settled: 'این فاکتور قبلاً تسویه شده است.',
      balance: 'ماندهٔ قابل پرداختی وجود ندارد.',
      ready: canCollectCash
        ? 'ثبت نقدی یا ثبت دستی کارت پس از تحویل سفارش.'
        : 'ثبت دستی کارت پس از تحویل؛ دریافت نقدی از صندوق انجام می‌شود.',
    };
    container.innerHTML = `
      <div class="wt-actions-grid">
        <button type="button" class="wt-action-btn" id="act-split-check" ${canSplitOrder ? '' : 'disabled aria-disabled="true"'} title="${!waiterHasCapability('orders.split') ? 'برای تفکیک فاکتور از مدیر شیفت مجوز بخواهید.' : !wt.order?.id ? 'ابتدا سفارش را ثبت کنید.' : splitBlockedByDraft ? 'ابتدا تغییرهای سفارش را ثبت یا تطبیق کنید.' : splitBlockedByKitchen ? 'تفکیک پس از ارسال به آشپزخانه، تا پایان سرو متوقف است.' : splitBlockedByCancelled ? 'سفارش لغوشده قابل تفکیک نیست.' : ''}">
          <span>✂️</span>
          <strong>تفکیک فاکتور</strong>
          <small style="font-size:11px;color:var(--rp-muted)">${!waiterHasCapability('orders.split') ? 'نیازمند مجوز تفکیک فاکتور' : !wt.order?.id ? 'پس از ثبت سفارش فعال می‌شود' : splitBlockedByDraft ? wt.remoteUpdatePending ? 'ابتدا نسخهٔ تازهٔ سفارش را بارگذاری کنید' : 'ابتدا تغییرهای سفارش را ثبت کنید' : splitBlockedByKitchen ? 'پس از تحویل سفارش به میز دوباره فعال می‌شود' : splitBlockedByCancelled ? 'سفارش لغوشده قابل تفکیک نیست' : 'تفکیک بر اساس صندلی یا اقلام'}</small>
        </button>
        <button type="button" class="wt-action-btn" id="act-move-table" ${canMoveOrder ? '' : 'disabled aria-disabled="true"'} title="${!waiterHasCapability('orders.move_table') ? 'برای انتقال سفارش از مدیر شیفت مجوز بخواهید.' : !wt.order?.id ? 'ابتدا سفارش را ثبت کنید.' : !canEditOrder ? 'این سفارش در مرحلهٔ فعلی قابل انتقال نیست.' : ''}">
          <span>🔄</span>
          <strong>انتقال میز</strong>
          <small style="font-size:11px;color:var(--rp-muted)">${!waiterHasCapability('orders.move_table') ? 'نیازمند مجوز انتقال میز' : !wt.order?.id ? 'پس از ثبت سفارش فعال می‌شود' : !canEditOrder ? 'این سفارش قفل است' : !hasAvailableMoveTarget ? 'میز آزاد دیگری وجود ندارد' : 'فقط به میز آزاد منتقل می‌شود'}</small>
        </button>
        <button type="button" class="wt-action-btn" id="act-cover-count" ${canEditOrder ? '' : 'disabled aria-disabled="true"'} title="${!waiterHasCapability('orders.create') ? 'برای ویرایش سفارش از مدیر شیفت مجوز بخواهید.' : !canEditOrder ? 'این سفارش در مرحلهٔ فعلی قابل ویرایش نیست.' : ''}">
          <span>👥</span>
          <strong>تعداد مهمان (${num(wt.covers || wt.seatsCount)})</strong>
          <small style="font-size:11px;color:var(--rp-muted)">تغییر نفرات و صندلی‌ها</small>
        </button>
        <button type="button" class="wt-action-btn" id="act-table-note" ${canEditOrder ? '' : 'disabled aria-disabled="true"'} title="${!waiterHasCapability('orders.create') ? 'برای ویرایش سفارش از مدیر شیفت مجوز بخواهید.' : !canEditOrder ? 'این سفارش در مرحلهٔ فعلی قابل ویرایش نیست.' : ''}>
          <span>📝</span>
          <strong>یادداشت سفارش</strong>
          <small style="font-size:11px;color:var(--rp-muted)">پیام اختصاصی میز</small>
        </button>
        <button type="button" class="wt-action-btn" id="act-clear-order" ${canEditOrder ? '' : 'disabled aria-disabled="true"'} title="${!waiterHasCapability('orders.create') ? 'برای ویرایش سفارش از مدیر شیفت مجوز بخواهید.' : !canEditOrder ? 'این سفارش در مرحلهٔ فعلی قابل ویرایش نیست.' : ''}" style="border-color:#fecdd3">
          <span>🗑️</span>
          <strong style="color:#e11d48">پاک کردن اقلام</strong>
          <small style="font-size:11px;color:#f43f5e">شروع مجدد سفارش</small>
        </button>
        <button type="button" class="wt-action-btn" id="act-pay-side" ${paymentAction.ready ? '' : 'disabled'} style="border-color:#bae6fd">
          <span>💳</span>
          <strong style="color:#0284c7">تسویه و پرداخت</strong>
          <small id="wt-payment-action-hint" style="font-size:11px;color:#0284c7">${paymentActionHints[paymentAction.reason]}</small>
        </button>
      </div>
    `;

    document.getElementById('act-split-check')?.addEventListener('click', () => splitOrderCheck());
    document.getElementById('act-move-table')?.addEventListener('click', () => moveOrderTable());
    document.getElementById('act-cover-count')?.addEventListener('click', () => {
      if (!canEditOrder) return;
      const minimumSeat = Math.max(1, ...wt.lines.map((line) => Number(line.seat) || 0));
      openWaiterCoversPicker(wt.table, (covers) => {
        wt.covers = covers;
        wt.seatsCount = covers;
        wt.dirty = true;
        showToast(`تعداد مهمانان در پیش‌نویس به ${num(covers)} نفر تغییر کرد؛ همراه سفارش ذخیره می‌شود.`);
        renderWaiterTerminal();
      }, minimumSeat, wt.covers);
    });
    document.getElementById('act-table-note')?.addEventListener('click', () => {
      if (!canEditOrder) return;
      openDialog('یادداشت سفارش', wt.table.label, `
        <div style="padding:6px 0">
          <label class="field">
            <span>متن یادداشت:</span>
            <textarea id="wt-note-input" rows="3" style="width:100%">${esc(wt.note || '')}</textarea>
          </label>
          <button type="button" class="role-primary" id="btn-save-note" style="width:100%;margin-top:10px">ذخیره یادداشت</button>
        </div>
      `);
      dialogBody.querySelector('#btn-save-note')?.addEventListener('click', () => {
        wt.note = document.getElementById('wt-note-input')?.value.trim() || '';
        wt.dirty = true;
        dialog.close();
        showToast('یادداشت در پیش‌نویس ثبت شد؛ با ارسال سفارش به سرور ذخیره می‌شود.');
        renderWaiterTerminal();
      });
    });
    document.getElementById('act-clear-order')?.addEventListener('click', () => {
      if (!canEditOrder) return;
      if (confirm('آیا از پاک کردن اقلام ثبت‌نشده مطمئن هستید؟')) {
        wt.lines = wt.lines.filter((l) => l.localSaved);
        renderWaiterTerminal();
      }
    });
    document.getElementById('act-pay-side')?.addEventListener('click', () => payWaiterCheck());
  }

  async function submitWaiterSplit(payload, successMessage) {
    const wt = state.waiterTerminal;
    if (!waiterHasCapability('orders.split')) {
      showToast('تفکیک فاکتور در دسترسی شما نیست؛ از مدیر شیفت مجوز لازم را درخواست کنید.', 'error');
      return false;
    }
    if (!wt?.order?.id || waiterTerminalMutationLocked(wt)) return false;
    if (wt.dirty || wt.remoteUpdatePending || wt.lines.some((line) => !line.localSaved)) {
      showToast('ابتدا تغییرهای سفارش را ثبت کنید؛ تفکیک پیش‌نویس ذخیره‌نشده را انجام نمی‌دهد.', 'warning');
      return false;
    }
    const splitNonce = globalThis.crypto?.randomUUID?.()
      || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    const pending = {
      orderId: Number(wt.order.id),
      branchId: Number(state.branchId),
      tableId: String(wt.table.id),
      payload: JSON.parse(JSON.stringify(payload)),
      idempotencyKey: `waiter-split-${splitNonce}`,
      baseOrderSignature: waiterOrderDraftSignature(wt.order),
      startedAt: Date.now(),
    };
    wt.pendingSplit = pending;
    wt.splitSaving = true;
    if (!persistWaiterTerminalDraft(wt)) {
      wt.pendingSplit = null;
      wt.splitSaving = false;
      showToast('ثبت امن وضعیت تفکیک در این نشست انجام نشد؛ هیچ درخواستی ارسال نشد.', 'error');
      return false;
    }
    dialogBody.querySelectorAll('button, input').forEach((control) => { control.disabled = true; });
    try {
      const result = await api(`/api/waiter/orders/${pending.orderId}/split`, {
        method: 'POST',
        headers: { 'Idempotency-Key': pending.idempotencyKey },
        body: JSON.stringify(pending.payload),
      });
      const primary = result?.primaryOrder;
      const split = result?.splitOrder;
      const modeMatches = split?.splitMode === pending.payload.mode;
      const seatMatches = pending.payload.mode !== 'seat' || Number(split?.splitSeat) === Number(pending.payload.seat);
      const indicesMatch = pending.payload.mode !== 'items'
        || JSON.stringify(split?.splitItemIndices || []) === JSON.stringify(pending.payload.itemIndices || []);
      if (result?.ok !== true
        || !waiterOrderResponseMatchesIntent(primary, {
          orderId: pending.orderId,
          branchId: pending.branchId,
          tableId: pending.tableId,
        })
        || !waiterOrderResponseMatchesIntent(split, {
          orderId: split?.id,
          branchId: pending.branchId,
          tableId: pending.tableId,
        })
        || Number(split?.splitFromOrderId) !== pending.orderId || !modeMatches || !seatMatches || !indicesMatch) {
        throw Object.assign(new Error('پاسخ تفکیک با فاکتور، شعبه یا میز انتخاب‌شده تطبیق ندارد؛ نتیجه را با مدیر شیفت بررسی کنید.'), { outcomeUnknown: true });
      }
      wt.pendingSplit = null;
      wt.splitNeedsRefresh = false;
      wt.splitSaving = false;
      wt.order = JSON.parse(JSON.stringify(primary));
      wt.lines = (primary.items || []).map((line, index) => ({
        ...JSON.parse(JSON.stringify(line)),
        localId: line.localId || `split-primary-${primary.id}-${index}`,
        localSaved: true,
      }));
      wt.dirty = false;
      state.data.orders = [
        ...(state.data.orders || []).filter((order) => Number(order.id) !== Number(primary.id) && Number(order.id) !== Number(split.id)),
        primary,
        split,
      ];
      persistWaiterTerminalDraft(wt);
      dialog.close();
      showToast(successMessage(split));
      await refreshWaiterAfterMutation();
      state.waiterTerminal = null;
      waiterFloor();
      return true;
    } catch (error) {
      wt.splitSaving = false;
      if (error.outcomeUnknown) {
        wt.splitNeedsRefresh = true;
        persistWaiterTerminalDraft(wt);
        dialog.close();
        wt.activeTab = 'check';
        renderWaiterTerminal();
        showToast('نتیجهٔ تفکیک نامشخص است؛ درخواست دوباره ارسال نمی‌شود. فاکتورهای میز را با مدیر شیفت تطبیق دهید.', 'error');
      } else {
        wt.pendingSplit = null;
        wt.splitNeedsRefresh = false;
        persistWaiterTerminalDraft(wt);
        dialogBody.querySelectorAll('button, input').forEach((control) => { control.disabled = false; });
        showToast(error.message, 'error');
      }
      return false;
    }
  }

  function splitOrderCheck() {
    const wt = state.waiterTerminal;
    if (!waiterHasCapability('orders.split')) {
      showToast('تفکیک فاکتور در دسترسی شما نیست؛ از مدیر شیفت مجوز لازم را درخواست کنید.', 'error');
      return;
    }
    if (waiterTerminalMutationLocked(wt)) {
      showToast('نتیجهٔ تفکیک قبلی روشن نیست؛ تا تطبیق فاکتورهای میز با مدیر شیفت، دوباره اقدام نکنید.', 'warning');
      return;
    }
    if (wt.dirty || wt.remoteUpdatePending || wt.lines.some((line) => !line.localSaved)) {
      showToast('ابتدا تغییرهای سفارش را ثبت کنید؛ تفکیک پیش‌نویس ذخیره‌نشده را انجام نمی‌دهد.', 'warning');
      return;
    }
    if (!wt.order?.id) {
      showToast('برای تفکیک فاکتور ابتدا سفارش را به سیستم ارسال کنید.', 'error');
      return;
    }
    if (wt.lines.length <= 1) {
      showToast('حداقل دو قلم در فاکتور برای تفکیک لازم است.', 'error');
      return;
    }

    const distinctSeats = Array.from(new Set(wt.lines.map((l) => Number(l.seat || 0)))).filter((s) => s > 0);

    openDialog(
      'تفکیک فاکتور',
      wt.table.label || `میز ${wt.table.id}`,
      `
      <div style="display:flex;flex-direction:column;gap:14px;padding:6px 0">
        <p style="margin:0;font-size:13px;color:var(--rp-muted)">نوع تفکیک فاکتور سر میز را انتخاب کنید:</p>

        <div style="background:var(--rp-surface-2);border-radius:14px;padding:12px;border:1px solid var(--rp-line)">
          <strong style="display:block;margin-bottom:6px;font-size:13.5px">۱. تفکیک بر اساس صندلی</strong>
          <small style="display:block;margin-bottom:10px;color:var(--rp-muted)">اقلام اختصاص‌یافته به یک صندلی در فاکتور مجزا (مانند چک دوم) قرار می‌گیرند.</small>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${distinctSeats.map((s) => `
              <button type="button" class="btn btn-sm" data-split-seat="${s}" style="padding:8px 14px;border-radius:10px;background:#0284c7;color:#fff;border:none">
                تفکیک صندلی ${num(s)} ➔
              </button>
            `).join('') || '<small style="color:var(--rp-muted)">صندلی مشخصی تعریف نشده است.</small>'}
          </div>
        </div>

        <div style="background:var(--rp-surface-2);border-radius:14px;padding:12px;border:1px solid var(--rp-line)">
          <strong style="display:block;margin-bottom:6px;font-size:13.5px">۲. تفکیک بر اساس انتخاب اقلام</strong>
          <small style="display:block;margin-bottom:10px;color:var(--rp-muted)">اقلامی که مشتری مایل است جداگانه حساب کند را انتخاب کنید:</small>
          <div style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto">
            ${wt.lines.map((l, idx) => `
              <label style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--rp-surface);border:1px solid var(--rp-line);border-radius:10px;cursor:pointer">
                <span style="display:flex;align-items:center;gap:8px">
                  <input type="checkbox" data-split-item-idx="${idx}" />
                  <span>${esc(l.name)} (${l.seat === 0 ? 'کل میز' : `صندلی ${num(l.seat)}`})</span>
                </span>
                <b>${money(receiptLineTotal(l))}</b>
              </label>
            `).join('')}
          </div>
          <button type="button" class="role-primary" id="btn-split-by-items" style="width:100%;margin-top:10px">
            ایجاد فاکتور مجزا برای اقلام انتخابی
          </button>
        </div>
      </div>
      `
    );

    dialogBody.querySelectorAll('[data-split-seat]').forEach((btn) => btn.addEventListener('click', async () => {
      const seat = Number(btn.dataset.splitSeat);
      await submitWaiterSplit({ mode: 'seat', seat }, (split) => `فاکتور صندلی ${num(seat)} با موفقیت تفکیک و به شماره ${split.tableNo} ایجاد شد.`);
    }));

    dialogBody.querySelector('#btn-split-by-items')?.addEventListener('click', async () => {
      const checkedBoxes = Array.from(dialogBody.querySelectorAll('input[data-split-item-idx]:checked'));
      const itemIndices = checkedBoxes.map((cb) => Number(cb.dataset.splitItemIdx));
      if (!itemIndices.length) {
        showToast('حداقل یک غذا را برای انتقال به فاکتور جدید انتخاب کنید.', 'error');
        return;
      }
      if (itemIndices.length === wt.lines.length) {
        showToast('نمی‌توانید همه اقلام را منتقل کنید؛ باید حداقل یک قلم در فاکتور قبلی باقی بماند.', 'error');
        return;
      }
      await submitWaiterSplit({ mode: 'items', itemIndices }, (split) => `فاکتور مجزا (${split.tableNo}) با موفقیت ایجاد شد.`);
    });
  }

  function moveOrderTable() {
    const wt = state.waiterTerminal;
    if (!waiterHasCapability('orders.move_table')) {
      showToast('انتقال میز در دسترسی شما نیست؛ از مدیر شیفت مجوز لازم را درخواست کنید.', 'error');
      return;
    }
    if (waiterTerminalMutationLocked(wt)) {
      showToast('تا تعیین تکلیف وضعیت سفارش یا دریافت وجه، انتقال میز متوقف است.', 'warning');
      return;
    }
    if (!wt.order?.id) {
      showToast('ابتدا سفارش را ثبت کنید.', 'error');
      return;
    }
    const branchId = state.branchId;
    const branchGeneration = state.waiterBranchGeneration || 0;
    const isCurrentBranch = () => String(state.branchId ?? '') === String(branchId ?? '')
      && (state.waiterBranchGeneration || 0) === branchGeneration;
    if (!waiterOrderResponseMatchesIntent(wt.order, {
      orderId: wt.order.id,
      branchId,
      tableId: wt.table.id,
    })) {
      showToast('فاکتور با شعبه یا میز فعال تطبیق ندارد؛ انتقال متوقف شد. ابتدا وضعیت سالن را تازه کنید.', 'error');
      return;
    }
    const otherTables = waiterAvailableAssignmentTables()
      .filter((table) => String(table.id) !== String(wt.table.id));
    if (!otherTables.length) {
      showToast('میز آزاد دیگری برای انتقال وجود ندارد؛ وضعیت سالن را تازه کنید.', 'warning');
      return;
    }

    openDialog(
      'انتقال میز',
      `از ${wt.table.label || `میز ${wt.table.id}`}`,
      `
      <div style="display:flex;flex-direction:column;gap:12px;padding:6px 0">
        <label class="field">
          <span>میز مقصد را انتخاب کنید:</span>
          <select id="move-table-select" style="width:100%">
            ${otherTables.map((t) => `<option value="${t.id}">${esc(t.label || `میز ${t.id}`)} (${esc(t.zone || 'سالن')})</option>`).join('')}
          </select>
        </label>
        <button type="button" class="role-primary" id="btn-confirm-move" style="margin-top:8px">
          تأیید و انتقال میز
        </button>
      </div>
      `
    );

    let uncertainTargetNo = null;
    dialogBody.querySelector('#btn-confirm-move')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      if (button.disabled) return;
      const select = document.getElementById('move-table-select');
      const nextTableNo = uncertainTargetNo || select?.value;
      if (!nextTableNo) return;
      if (!isCurrentBranch()) {
        showToast('شعبه هنگام بازبودن فرم تغییر کرده است؛ انتقال از شعبهٔ فعال انجام نمی‌شود.', 'warning');
        return;
      }
      setBusy(button, true);
      if (select) select.disabled = true;
      try {
        const result = await api(`/api/waiter/orders/${wt.order.id}/move-table`, {
          method: 'PATCH',
          body: JSON.stringify({ tableNo: nextTableNo }),
        });
        if (result?.ok !== true || !waiterOrderResponseMatchesIntent(result.order, {
          orderId: wt.order.id,
          branchId,
          tableId: nextTableNo,
          exactTableNo: true,
        })) {
          throw Object.assign(new Error('پاسخ انتقال با شناسه، شعبه یا میز مقصد تطبیق ندارد؛ نتیجه نامشخص است و فقط همین مقصد را دوباره بررسی کنید.'), {
            code: 'waiter_move_response_unverified', outcomeUnknown: true,
          });
        }
        dialog.close();
        if (!isCurrentBranch()) {
          if (state.waiterTerminal === wt) state.waiterTerminal = null;
          showToast(`انتقال به میز ${nextTableNo} در شعبهٔ قبلی تأیید شد؛ فهرست شعبهٔ فعال را تازه کنید.`, 'warning');
          return;
        }
        showToast(`سفارش با موفقیت به میز ${nextTableNo} منتقل شد.`);
        if (await refreshWaiterAfterMutation()) openWaiterTerminal(nextTableNo);
      } catch (err) {
        setBusy(button, false);
        if (err.outcomeUnknown) {
          uncertainTargetNo = nextTableNo;
          if (select?.isConnected) {
            select.value = nextTableNo;
            select.disabled = true;
          }
          button.textContent = `تلاش دوبارهٔ انتقال به میز ${nextTableNo}`;
          button.title = 'برای جلوگیری از انتقال تکراری، فقط همین مقصد را دوباره امتحان کنید.';
          showToast(`نتیجهٔ انتقال نامشخص است؛ وضعیت را بررسی کنید یا فقط انتقال به میز ${nextTableNo} را دوباره امتحان کنید.`, 'warning');
        } else if (uncertainTargetNo) {
          if (select?.isConnected) select.disabled = true;
          button.textContent = `تلاش دوبارهٔ انتقال به میز ${nextTableNo}`;
          button.title = 'مقصد تا روشن شدن نتیجهٔ درخواست قبلی قابل تغییر نیست.';
          showToast(err.message, 'error');
        } else if (select?.isConnected) {
          select.disabled = false;
          showToast(err.message, 'error');
        }
      }
    });
  }

  function paintTerminalGuest(container) {
    const wt = state.waiterTerminal;
    const orderSubmissionLocked = waiterTerminalMutationLocked(wt);
    const canEditOrder = waiterHasCapability('orders.create');
    const orderEditLocked = Boolean(wt.order?.id && !orderCanEdit(wt.order));
    const guestLocked = orderSubmissionLocked || orderEditLocked || !canEditOrder;
    container.innerHTML = `
      <div style="padding:14px 12px;display:flex;flex-direction:column;gap:12px;max-width:480px;margin:0 auto">
        <p class="wt-stage-message ${guestLocked ? 'is-warning' : ''}" role="${guestLocked ? 'status' : 'note'}">
          ${orderSubmissionLocked
            ? 'ثبت سفارش نیازمند تعیین تکلیف است؛ اطلاعات مهمان فعلاً قفل شده است.'
            : !canEditOrder
              ? 'ویرایش اطلاعات مهمان در دسترسی شما نیست؛ فاکتور را فقط می‌توانید مشاهده کنید.'
            : orderEditLocked
              ? 'این سفارش وارد مرحله‌ای شده که اطلاعات مهمان از این صفحه قابل ویرایش نیست.'
              : 'اطلاعات این بخش ابتدا در پیش‌نویس می‌ماند و هنگام ذخیره و ارسال سفارش ثبت می‌شود.'}
        </p>
        <label class="field">
          <span>نام مهمان (اختیاری):</span>
          <input type="text" id="wt-guest-name" class="role-search" value="${esc(wt.guestName || '')}" placeholder="مثال: آقای رضایی" ${guestLocked ? 'disabled' : ''} />
        </label>
        <label class="field">
          <span>موبایل مهمان (جهت ارسال پیامک فاکتور و امتیاز وفاداری):</span>
          <input type="tel" id="wt-guest-phone" class="role-search" value="${esc(wt.guestPhone || '')}" placeholder="0912..." ${guestLocked ? 'disabled' : ''} />
        </label>
        <button type="button" class="role-primary" id="wt-save-guest" ${guestLocked ? 'disabled' : ''} style="margin-top:8px">
          ${guestLocked ? 'ویرایش اطلاعات در این مرحله بسته است' : 'اعمال اطلاعات در پیش‌نویس فاکتور'}
        </button>
      </div>
    `;
    document.getElementById('wt-save-guest')?.addEventListener('click', () => {
      if (guestLocked) return;
      wt.guestName = document.getElementById('wt-guest-name')?.value.trim() || '';
      wt.guestPhone = document.getElementById('wt-guest-phone')?.value.trim() || '';
      wt.dirty = true;
      if (!persistWaiterTerminalDraft(wt)) {
        showToast('ذخیرهٔ پیش‌نویس در این نشست انجام نشد؛ اطلاعات را کپی کنید و تا رفع مشکل از سفارش خارج نشوید.', 'error');
        return;
      }
      showToast('اطلاعات مهمان به پیش‌نویس فاکتور اعمال شد؛ برای ثبت نهایی، سفارش را ذخیره و ارسال کنید.');
      wt.activeTab = 'check';
      renderWaiterTerminal();
    });
    document.getElementById('wt-guest-name')?.addEventListener('input', (event) => {
      if (guestLocked) return;
      wt.guestName = event.target.value;
      wt.dirty = true;
      persistWaiterTerminalDraft(wt);
    });
    document.getElementById('wt-guest-phone')?.addEventListener('input', (event) => {
      if (guestLocked) return;
      wt.guestPhone = event.target.value;
      wt.dirty = true;
      persistWaiterTerminalDraft(wt);
    });
  }

  async function serveWaiterOrder(button) {
    const wt = state.waiterTerminal;
    if (!wt?.order?.id || wt.serving) return;
    if (!waiterHasCapability('service.manage')) {
      showToast('ثبت تحویل سفارش در دسترسی شما نیست؛ سفارش را به مسئول مجاز بسپارید.', 'error');
      return;
    }
    const orderId = Number(wt.order.id);
    const branchId = state.branchId;
    const branchGeneration = state.waiterBranchGeneration || 0;
    const isCurrentBranch = () => String(state.branchId ?? '') === String(branchId ?? '')
      && (state.waiterBranchGeneration || 0) === branchGeneration;
    if (!waiterOrderResponseMatchesIntent(wt.order, { orderId, branchId, tableId: wt.table.id })) {
      showToast('فاکتور با شعبه یا میز فعال تطبیق ندارد؛ ثبت تحویل متوقف شد. ابتدا وضعیت سالن را تازه کنید.', 'error');
      return;
    }
    wt.serving = true;
    setBusy(button, true);
    try {
      const result = await api(`/api/waiter/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'done' }),
      });
      if (result?.ok !== true || !waiterOrderResponseMatchesIntent(result.order, {
        orderId, branchId, tableId: wt.table.id,
      })) {
        throw Object.assign(new Error('پاسخ ثبت تحویل با شناسه، شعبه یا میز فعال تطبیق ندارد؛ نتیجه نامشخص است.'), {
          code: 'waiter_serve_response_unverified', outcomeUnknown: true,
        });
      }
      wt.order = JSON.parse(JSON.stringify(result.order));
      if (!isCurrentBranch()) {
        if (state.waiterTerminal === wt) state.waiterTerminal = null;
        showToast('تحویل در شعبهٔ قبلی تأیید شد؛ وضعیت را در همان شعبه بررسی کنید.', 'warning');
        return;
      }
      let refreshError = null;
      try { await fetchWaiter(); } catch (error) { refreshError = error; }
      const latest = refreshError || !isCurrentBranch() ? null : (state.data.orders || []).find((order) =>
        waiterOrderResponseMatchesIntent(order, { orderId, branchId, tableId: wt.table.id }));
      if (latest) wt.order = JSON.parse(JSON.stringify(latest));
      else if (!responseOrder) {
        wt.serveNeedsRefresh = true;
        wt.activeTab = 'check';
        renderWaiterTerminal();
        showToast('پاسخ تحویل ثبت شد اما سفارش تازه پیدا نشد؛ پیش از تکرار وضعیت را بررسی کنید.', 'warning');
        return;
      }
      wt.serveNeedsRefresh = false;
      const serviceComplete = ['done', 'completed', 'picked_up', 'delivered'].includes(String(wt.order.status || ''));
      if (!serviceComplete) {
        wt.activeTab = 'check';
        renderWaiterTerminal();
        showToast('سرور هنوز تحویل سفارش را تأیید نکرده است؛ وضعیت را بررسی و سپس دوباره اقدام کنید.', 'warning');
        return;
      }
      if (globalThis.WestoOrderPaymentState.deriveOrderPaymentWorkflow(wt.order).settled) {
        state.waiterTerminal = null;
        waiterFloor();
        showToast('تحویل و پرداخت ثبت شد؛ میز آزاد است.');
      } else {
        wt.activeTab = 'check';
        renderWaiterTerminal();
        showToast(refreshError
          ? `تحویل ثبت شد؛ فاکتور برای تسویه باز است. تازه‌سازی سالن ناموفق بود: ${refreshError.message}`
          : 'تحویل ثبت شد؛ فاکتور برای تسویه باز است.');
      }
    } catch (error) {
      if (error.outcomeUnknown) {
        try {
          await fetchWaiter();
          const latest = isCurrentBranch() ? (state.data.orders || []).find((order) =>
            waiterOrderResponseMatchesIntent(order, { orderId, branchId, tableId: wt.table.id })) : null;
          if (latest) {
            wt.order = JSON.parse(JSON.stringify(latest));
            wt.serveNeedsRefresh = false;
            wt.activeTab = 'check';
            renderWaiterTerminal();
            const alreadyServed = ['done', 'completed', 'picked_up', 'delivered'].includes(String(latest.status || ''));
            showToast(alreadyServed
              ? 'تحویل در سرور ثبت شده و وضعیت تازه تأیید شد.'
              : 'سرور وضعیت آماده را تأیید کرد؛ تحویل ثبت نشده و می‌توانید پس از بررسی دوباره اقدام کنید.', alreadyServed ? '' : 'warning');
            return;
          }
        } catch { /* keep the retry locked until the operator refreshes successfully */ }
        wt.serveNeedsRefresh = true;
        wt.activeTab = 'check';
        renderWaiterTerminal();
        showToast(`${error.message} نتیجهٔ تحویل نامشخص است؛ پیش از تکرار وضعیت را از سرور تازه کنید.`, 'error');
      } else {
        showToast(error.message, 'error');
        setBusy(button, false);
      }
    } finally {
      wt.serving = false;
    }
  }

  function payWaiterCheck() {
    const wt = state.waiterTerminal;
    if (wt?.paymentIntentConflict) {
      showToast('مبلغ فاکتور با درخواست دریافت قبلی تطبیق ندارد؛ فاکتور را به صندوق‌دار بسپارید.', 'error');
      return;
    }
    if (wt?.paymentNeedsRefresh) {
      showToast('ابتدا وضعیت دریافت وجه را تازه کنید؛ پرداخت را دوباره ثبت نکنید.', 'error');
      return;
    }
    if (!wt?.order?.id) {
      showToast('ابتدا سفارش را ثبت و برای آشپزخانه ارسال کنید.', 'error');
      return;
    }
    if (!['done', 'completed', 'picked_up', 'delivered'].includes(String(wt.order.status || ''))) {
      showToast('ابتدا تحویل سفارش به میز را ثبت کنید؛ سپس فاکتور قابل تسویه است.', 'error');
      return;
    }
    const paymentWorkflow = globalThis.WestoOrderPaymentState.deriveOrderPaymentWorkflow(wt.order);
    if (paymentWorkflow.requiresReconciliation) {
      wt.activeTab = 'check';
      renderWaiterTerminal();
      showToast('اطلاعات مالی این فاکتور نیاز به بررسی دارد؛ تا رفع مغایرت امکان ثبت دریافت وجه نیست.', 'error');
      return;
    }
    if (paymentWorkflow.settled) {
      showToast('این فاکتور قبلاً تسویه شده است.', 'error');
      return;
    }
    const capabilities = state.session?.workspace?.capabilities || [];
    const canCollectPayment = capabilities.includes('*') || capabilities.includes('payments.collect');
    const canCollectCash = capabilities.includes('*') || capabilities.includes('cash.manage');
    if (!canCollectPayment) {
      showToast('ثبت پرداخت در دسترسی شما نیست؛ فاکتور را به صندوق بسپارید.', 'error');
      return;
    }

    const settlementStage = paymentWorkflow.stages.find((stage) => stage.id === 'settlement');
    const { total: orderTotal, paid: amountPaid, due: amountDue } = paymentWorkflow.amounts;
    if (settlementStage?.state !== 'current' || !Number.isFinite(amountDue) || !amountDue) {
      showToast('مانده‌ای برای پرداخت وجود ندارد.', 'error');
      return;
    }

    openDialog(
      'مرحلهٔ چهارم · تسویه',
      `${wt.table.label || `میز ${wt.table.id}`} · ${money(amountDue)}`,
      '<div class="wt-payment-flow" id="wt-payment-flow" role="region" aria-label="ثبت دریافت وجه"></div>'
    );

    const completePayment = async (method, requestedAmount, amountTendered, confirmButton) => {
      if (wt.paymentPending) return;
      wt.paymentPending = true;
      setBusy(confirmButton, true);
      let intent = null;
      let idempotencyKey = '';
      const alreadyPending = Boolean(wt.pendingPayment);
      try {
        const retry = wt.pendingPayment;
        const paymentReference = retry
          ? String(retry.intent.paymentReference || '')
          : method === 'cash' ? '' : String(dialogBody.querySelector('#wt-card-reference')?.value || '').trim();
        intent = retry ? retry.intent : {
          orderId: wt.order.id,
          branchId: wt.order.branchId || state.branchId,
          tender: method === 'cash' ? 'cash' : 'manual_card',
          paymentAmount: requestedAmount,
          amountTendered: method === 'cash' ? amountTendered : requestedAmount,
          paymentReference,
        };
        if (Number(intent.orderId) !== Number(wt.order.id)
          || !Number.isSafeInteger(Number(intent.paymentAmount))
          || Number(intent.paymentAmount) <= 0
          || Number(intent.paymentAmount) > amountDue
          || (retry && Number(retry.baselinePaid) !== Number(amountPaid))) {
          throw Object.assign(new Error('ماندهٔ سفارش تغییر کرده است؛ ابتدا وضعیت تازهٔ فاکتور را بررسی کنید.'), { outcomeUnknown: true });
        }
        idempotencyKey = retry?.idempotencyKey || settlementIdempotencyKey(confirmButton, intent);
        wt.pendingPayment ||= { intent, idempotencyKey, baselinePaid: amountPaid };
        if (!persistWaiterTerminalDraft(wt)) {
          if (!alreadyPending) {
            wt.pendingPayment = null;
            clearSettlementIdempotencyKey(idempotencyKey, intent);
          }
          throw Object.assign(new Error('پیش‌نویس امن درخواست دریافت ذخیره نشد؛ هیچ درخواستی به سرور ارسال نشد.'), { notSent: true });
        }
        const result = await api(`/api/staff/orders/${wt.order.id}/settle`, {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({
            tender: method === 'cash' ? 'cash' : 'manual_card',
            paymentAmount: intent.paymentAmount,
            amountTendered: intent.amountTendered,
            paymentReference,
          }),
        });
        const responseOrder = result?.order;
        const responseWorkflow = responseOrder && Number(responseOrder.id) === Number(wt.order.id)
          ? globalThis.WestoOrderPaymentState.deriveOrderPaymentWorkflow(responseOrder)
          : null;
        const paymentAmount = Number(result?.payment?.amount);
        const hasRecordedPayment = result?.ok === true
          && responseWorkflow?.isConsistent === true
          && result.payment && Number.isFinite(paymentAmount) && paymentAmount > 0
          && paymentAmount === Number(intent.paymentAmount)
          && String(result.payment.idempotencyKey || '') === String(idempotencyKey)
          && responseWorkflow.amounts.paid > amountPaid
          && responseWorkflow.amounts.paid >= amountPaid + paymentAmount;
        if (!hasRecordedPayment) {
          throw Object.assign(new Error('پاسخ ثبت وجه، تأیید قابل‌اعتماد ندارد؛ برای جلوگیری از دریافت دوباره، وضعیت را تازه کنید.'), {
            code: 'settlement_response_unverified',
            outcomeUnknown: true,
          });
        }
        clearSettlementIdempotencyKey(idempotencyKey, intent);
        wt.pendingPayment = null;
        wt.paymentNeedsRefresh = false;
        clearWaiterTerminalDraft(wt.table.id);
        wt.order = JSON.parse(JSON.stringify(responseOrder));
        dialog.close();
        const localOrderIndex = (state.data.orders || []).findIndex((order) => Number(order.id) === Number(wt.order.id));
        if (localOrderIndex >= 0) state.data.orders[localOrderIndex] = wt.order;
        else state.data.orders = [...(state.data.orders || []), wt.order];
        try {
          await fetchWaiter();
          const latest = state.data.orders.find((order) => Number(order.id) === Number(wt.order.id));
          if (latest) {
            const latestWorkflow = globalThis.WestoOrderPaymentState.deriveOrderPaymentWorkflow(latest);
            if (latestWorkflow.isConsistent === true && latestWorkflow.amounts.paid >= responseWorkflow.amounts.paid) {
              wt.order = JSON.parse(JSON.stringify(latest));
            }
          }
        } catch (refreshError) {
          // The settlement endpoint has already committed. Keep its response as
          // the source of truth instead of presenting a successful payment as
          // failed just because the follow-up refresh was unavailable.
          console.warn('[waiter-payment] post-settlement refresh failed:', refreshError?.message || refreshError);
        }
        const updatedWorkflow = globalThis.WestoOrderPaymentState.deriveOrderPaymentWorkflow(wt.order);
        if (updatedWorkflow.settled) {
          state.waiterTerminal = null;
          waiterFloor();
          showToast('پرداخت ثبت شد؛ فاکتور تسویه و میز آزاد شد.');
        } else if (updatedWorkflow.requiresReconciliation) {
          wt.activeTab = 'check';
          renderWaiterTerminal();
          showToast('پرداخت ثبت شد؛ اما وضعیت مالی پاسخ نیاز به تطبیق دارد. تا بررسی، فاکتور تسویه‌شده نمایش داده نمی‌شود.', 'warning');
        } else {
          wt.activeTab = 'check';
          renderWaiterTerminal();
          showToast(`پرداخت ثبت شد؛ ماندهٔ ${money(updatedWorkflow.amounts.due)} باقی مانده است.`, 'warning');
        }
      } catch (error) {
        if (error.notSent) {
          setBusy(confirmButton, false);
          showToast(error.message, 'error');
          return false;
        }
        if (intent && idempotencyKey) {
          wt.pendingPayment ||= { intent, idempotencyKey, baselinePaid: amountPaid };
        }
        wt.paymentNeedsRefresh = true;
        wt.activeTab = 'check';
        dialog.close();
        renderWaiterTerminal();
        const explanation = error.outcomeUnknown
          ? 'نتیجهٔ درخواست روشن نیست.'
          : 'سامانه ثبت را نپذیرفت؛ چون دریافت ممکن است بیرون از سامانه انجام شده باشد، وضعیت فاکتور باید بررسی شود.';
        showToast(`${error.message} ${explanation} درخواست و کلید یکتا حفظ شد؛ ابتدا وضعیت را تازه کنید.`, 'error');
      } finally {
        wt.paymentPending = false;
      }
    };

    const renderPaymentChoices = () => {
      const flow = dialogBody.querySelector('#wt-payment-flow');
      if (!flow) return;
      if (wt.pendingPayment) {
        const tender = wt.pendingPayment.intent.tender;
        flow.innerHTML = `
          <section class="wt-payment-flow__amount"><span>درخواست قبلی · ${tender === 'cash' ? 'نقدی' : 'کارت بانکی'}</span><strong>${money(wt.pendingPayment.intent.paymentAmount)}</strong></section>
          <p class="wt-payment-flow__instruction" role="status">همان درخواست با همان کلید یکتا تکرار می‌شود؛ دریافت تازه‌ای ثبت نمی‌شود.</p>
          <div class="wt-payment-flow__methods"><button type="button" class="wt-payment-method" id="btn-pay-pending"><span aria-hidden="true">↻</span><span><strong>ادامهٔ ثبت امن همان دریافت</strong><small>دریافت فیزیکی را دوباره انجام ندهید.</small></span></button></div>
        `;
        flow.querySelector('#btn-pay-pending')?.addEventListener('click', () => renderPaymentConfirmation(tender === 'cash' ? 'cash' : 'card', true));
        return;
      }
      flow.innerHTML = `
        <section class="wt-payment-flow__amount"><span>ماندهٔ قابل پرداخت</span><strong>${money(amountDue)}</strong><small>جمع کل ${money(orderTotal)} · پرداخت‌شده ${money(amountPaid)}</small></section>
        <p class="wt-payment-flow__instruction">روش دریافت وجه را انتخاب کنید. پرداخت فقط پس از ثبت تحویل سفارش فعال می‌شود.</p>
        <div class="wt-payment-flow__methods">
          <button type="button" class="wt-payment-method" id="btn-pay-pos"><span aria-hidden="true">💳</span><span><strong>کارت بانکی · ثبت دستی</strong><small>پس از تأیید دستگاه دریافت وجه؛ کارت‌خوان به سامانه متصل نیست.</small></span></button>
          ${canCollectCash ? '<button type="button" class="wt-payment-method" id="btn-pay-cash"><span aria-hidden="true">💵</span><span><strong>وجه نقد</strong><small>دریافت نقدی از صندوق باز</small></span></button>' : ''}
        </div>
        ${!canCollectCash ? '<p class="wt-payment-flow__note">برای دریافت نقدی، تسویه از صندوق انجام می‌شود.</p>' : ''}
      `;
      flow.querySelector('#btn-pay-pos')?.addEventListener('click', () => renderPaymentConfirmation('card'));
      flow.querySelector('#btn-pay-cash')?.addEventListener('click', () => renderPaymentConfirmation('cash'));
    };

    const renderPaymentConfirmation = (method, retrying = false) => {
      const flow = dialogBody.querySelector('#wt-payment-flow');
      if (!flow) return;
      const retryIntent = retrying ? wt.pendingPayment?.intent : null;
      const isCash = method === 'cash';
      const retryAmount = retryIntent?.paymentAmount ?? amountDue;
      flow.innerHTML = `
        <section class="wt-payment-flow__amount"><span>ماندهٔ کل فاکتور</span><strong>${money(amountDue)}</strong><small>مبلغ هر دریافت می‌تواند بخشی از مانده باشد؛ برای روش بعدی، همین فاکتور را دوباره باز کنید.</small></section>
        <div class="wt-payment-flow__confirm">
          <strong>${isCash ? 'دریافت وجه نقد را تأیید کنید' : 'ثبت دستی پرداخت کارت را تأیید کنید'}</strong>
          <p>${isCash ? 'پس از دریافت وجه و اطمینان از بازبودن صندوق، پرداخت را ثبت کنید.' : `ابتدا مبلغ انتخابی را روی کارت‌خوان مستقل دریافت کنید و نتیجهٔ موفق را ببینید؛ این سامانه دستگاه را کنترل نمی‌کند.`}</p>
          <label class="field"><span>مبلغ این دریافت (تومان)</span><input id="wt-payment-amount" inputmode="numeric" autocomplete="off" aria-label="مبلغ این دریافت به تومان" aria-describedby="wt-payment-amount-hint" value="${num(retryAmount)}" ${retrying ? 'disabled' : ''} /></label>
          <small id="wt-payment-amount-hint">بین ۱ تا ${money(amountDue)} تومان؛ برای ترکیب نقد و کارت، هر دریافت را جدا ثبت کنید.</small>
          ${isCash ? `<label class="field"><span>وجه نقد دریافتی (تومان)</span><input id="wt-cash-tendered" inputmode="numeric" autocomplete="off" aria-describedby="wt-payment-change" value="${num(retryIntent?.amountTendered ?? retryAmount)}" ${retrying ? 'disabled' : ''} /></label><p class="wt-payment-flow__change" id="wt-payment-change" role="status" aria-live="polite"></p>` : ''}
          ${!isCash ? `<label class="field"><span>کد پیگیری روی رسید کارت‌خوان</span><input id="wt-card-reference" type="text" maxlength="120" autocomplete="off" aria-label="کد پیگیری روی رسید کارت‌خوان، الزامی" aria-required="true" required placeholder="کد پیگیری یا شماره مرجع رسید" value="${esc(retryIntent?.paymentReference || '')}" ${retrying ? 'disabled' : ''} /></label><small>برای تطبیق مالی لازم است؛ کارت‌خوان به سامانه متصل نیست.</small>${retrying && !String(retryIntent?.paymentReference || '').trim() ? '<p class="role-inline-warning" role="alert">درخواست قبلی کد پیگیری ندارد؛ فقط همان درخواست یکتا تکرار می‌شود. اگر دریافت روی دستگاه موفق بوده، دریافت تازه انجام ندهید و رسید را با سرپرست تطبیق دهید.</p>' : ''}` : ''}
        </div>
        <div class="wt-payment-flow__actions"><button type="button" class="wt-payment-back" id="wt-payment-back">بازگشت</button><button type="button" class="wt-payment-confirm" id="wt-payment-confirm">${retrying ? 'تکرار امن همان درخواست' : isCash ? 'ثبت دریافت نقدی' : 'ثبت دستی کارت پس از تأیید دستگاه'}</button></div>
      `;
      const cashInput = flow.querySelector('#wt-cash-tendered');
      const changeNote = flow.querySelector('#wt-payment-change');
      const confirmButton = flow.querySelector('#wt-payment-confirm');
      const cardReferenceInput = flow.querySelector('#wt-card-reference');
      const paymentAmountInput = flow.querySelector('#wt-payment-amount');
      const readPaymentAmount = () => waiterPaymentAmount(paymentAmountInput?.value, amountDue);
      const updateChange = () => {
        const paymentAmount = readPaymentAmount();
        if (paymentAmountInput) {
          paymentAmountInput.setAttribute('aria-invalid', String(paymentAmount === null));
        }
        if (!cashInput || !changeNote) {
          if (confirmButton && !retrying) {
            const hasReference = Boolean(String(cardReferenceInput?.value || '').trim());
            confirmButton.disabled = paymentAmount === null || (!isCash && !hasReference);
          }
          return;
        }
        const parsedTendered = parseInputNumber(cashInput.value);
        const validTender = paymentAmount !== null && Number.isSafeInteger(parsedTendered) && parsedTendered >= paymentAmount;
        const tendered = Number.isFinite(parsedTendered) ? parsedTendered : 0;
        changeNote.textContent = paymentAmount === null
          ? `مبلغ دریافت باید عدد صحیحی بین ۱ و ${money(amountDue)} باشد.`
          : !validTender && tendered >= paymentAmount
          ? 'مبلغ دریافتی باید عدد صحیح و معتبر باشد.'
          : tendered >= paymentAmount
          ? `باقی‌مانده برای بازگرداندن: ${money(tendered - paymentAmount)}`
          : `مبلغ دریافتی باید دست‌کم ${money(paymentAmount)} باشد.`;
        changeNote.classList.toggle('is-error', !validTender);
        cashInput.setAttribute('aria-invalid', String(!validTender));
        if (confirmButton && !retrying) confirmButton.disabled = !validTender;
      };
      const updateCardReferenceValidity = () => {
        if (!cardReferenceInput || retrying || !confirmButton) return;
        confirmButton.disabled = readPaymentAmount() === null || !String(cardReferenceInput.value || '').trim();
      };
      paymentAmountInput?.addEventListener('input', updateChange);
      cashInput?.addEventListener('input', updateChange);
      cardReferenceInput?.addEventListener('input', updateCardReferenceValidity);
      updateChange();
      updateCardReferenceValidity();
      flow.querySelector('#wt-payment-back')?.addEventListener('click', renderPaymentChoices);
      confirmButton?.addEventListener('click', (event) => {
        const paymentAmount = retrying ? Number(retryIntent?.paymentAmount) : readPaymentAmount();
        const parsedTendered = isCash ? parseInputNumber(cashInput?.value || '') : paymentAmount;
        const tendered = Number.isSafeInteger(parsedTendered) ? parsedTendered : 0;
        if (!Number.isSafeInteger(paymentAmount) || paymentAmount <= 0 || paymentAmount > amountDue) {
          showToast(`مبلغ این دریافت باید عدد صحیحی بین ۱ و ${money(amountDue)} باشد.`, 'error');
          paymentAmountInput?.focus();
          return;
        }
        if (isCash && tendered < paymentAmount) {
          showToast(`مبلغ نقد دریافتی باید دست‌کم ${money(paymentAmount)} باشد.`, 'error');
          return;
        }
        if (!isCash && !retrying && !String(cardReferenceInput?.value || '').trim()) {
          showToast('کد پیگیری رسید کارت‌خوان را وارد کنید.', 'error');
          cardReferenceInput?.focus();
          return;
        }
        completePayment(method, paymentAmount, tendered, event.currentTarget);
      });
    };

    renderPaymentChoices();
  }



  function waiterCalls() {
    clearRoleHeaderContext();
    document.body.classList.remove('is-waiter-floor-app');
    main.innerHTML = `${pageHead('رسیدگی به مهمان', 'فراخوان‌های مهمان', 'درخواست‌ها بر اساس زمان انتظار مرتب شده‌اند')}${waiterMetrics()}<section class="role-section"><div class="role-section__head"><h2>صف رسیدگی</h2><div class="order-actions"><span>${num(state.data.calls.length)} فراخوان باز</span><button type="button" class="role-secondary" data-refresh-waiter-calls>تازه‌سازی وضعیت</button></div></div>${callsHtml()}</section>`;
    wireCalls();
  }

  function waiterOrders() {
    clearRoleHeaderContext();
    document.body.classList.remove('is-waiter-floor-app');
    const canCreateOrders = waiterHasCapability('orders.create');
    const canMoveOrders = waiterHasCapability('orders.move_table');
    const canServeOrders = waiterHasCapability('service.manage');
    const canCollectPayments = waiterHasCapability('payments.collect');
    const statusPriority = { ready: 0, preparing: 1, sent_to_kitchen: 2, paid: 3, pay_at_cashier: 4, awaiting_confirmation: 5, pending_online: 6 };
    const activeOrders = (state.data.orders || [])
      .filter((item) => item.fulfillment === 'dine_in' && orderIsOpen(item));
    const unmappedIds = new Set(waiterUnmappedOrders(activeOrders).map((order) => String(order.id)));
    const orders = activeOrders
      .filter((item) => !state.waiterUnmappedOnly || unmappedIds.has(String(item.id)))
      .sort((a, b) => (statusPriority[a.status] ?? 9) - (statusPriority[b.status] ?? 9) || new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    const cards = orders.map((order) => {
      const served = ['done', 'completed', 'picked_up', 'delivered'].includes(String(order.status || ''));
      const canAssignTable = !waiterOrderHasMappedTable(order);
      const actions = canAssignTable
        ? `<button type="button" class="role-secondary" data-assign-waiter-table="${esc(order.id)}" ${canMoveOrders ? '' : 'disabled aria-disabled="true" title="برای تخصیص میز از مدیر شیفت دسترسی بخواهید."'}>${canMoveOrders ? 'تخصیص میز' : 'تخصیص میز · نیازمند مجوز'}</button>`
        : orderCanEdit(order)
        ? `<button type="button" class="role-secondary" data-edit-waiter-order="${esc(order.id)}" ${canCreateOrders ? '' : 'disabled aria-disabled="true" title="برای ویرایش سفارش از مدیر شیفت دسترسی بخواهید."'}>${canCreateOrders ? 'ویرایش و ارسال سفارش' : 'ویرایش · نیازمند مجوز'}</button>`
        : order.status === 'ready' && !served
        ? `<button type="button" class="role-primary" data-serve ${canServeOrders ? '' : 'disabled aria-disabled="true" title="برای ثبت تحویل از مدیر شیفت دسترسی بخواهید."'}>${canServeOrders ? 'بررسی و تحویل' : 'تحویل · نیازمند مجوز'}</button>`
        : served && order.paymentStatus !== 'paid'
          ? `<button type="button" class="role-primary" data-collect>${canCollectPayments ? 'تسویه فاکتور' : 'مشاهده و سپردن فاکتور به صندوق'}</button>`
          : '';
      return orderCard(order, actions);
    }).join('');
    const filterActions = state.waiterUnmappedOnly
      ? '<button type="button" class="role-secondary" id="waiter-show-all-orders">نمایش همهٔ سفارش‌ها</button>'
      : '';
    const emptyMessage = state.waiterUnmappedOnly
      ? 'سفارش فعالِ بدون میز برای رسیدگی وجود ندارد.'
      : 'سفارش فعالی در سالن نیست.';
    const createOrderAction = canCreateOrders
      ? '<button type="button" class="role-primary" id="new-order">سفارش جدید</button>'
      : '<button type="button" class="role-primary" id="new-order" disabled aria-disabled="true" title="برای ساخت سفارش از مدیر شیفت دسترسی بخواهید.">سفارش جدید · بدون مجوز</button>';
    const createPermissionNote = canCreateOrders ? '' : '<p class="wt-stage-message" role="status">نمایش سفارش‌ها مجاز است؛ برای ایجاد یا ویرایش، از مدیر شیفت دسترسی لازم را درخواست کنید.</p>';
    main.innerHTML = `${pageHead('خدمت‌رسانی میز', 'سفارش‌های سالن', 'پیگیری سفارش از ثبت تا آماده‌شدن و تحویل به میز', createOrderAction)}${waiterMetrics()}<section class="role-section">${createPermissionNote}<div class="role-section__head"><h2>${state.waiterUnmappedOnly ? 'سفارش‌های نیازمند تعیین میز' : 'سفارش‌های فعال'}</h2><div class="order-actions">${filterActions}<span>${num(orders.length)} سفارش</span></div></div><div class="order-list">${cards || empty(emptyMessage)}</div></section>`;
    if (canCreateOrders) document.getElementById('new-order')?.addEventListener('click', () => showOrderComposer('waiter'));
    document.getElementById('waiter-show-all-orders')?.addEventListener('click', () => {
      state.waiterUnmappedOnly = false;
      waiterOrders();
    });
    main.querySelectorAll('[data-edit-waiter-order]').forEach((button) => button.addEventListener('click', () => {
      openWaiterOrderEditor(button.dataset.editWaiterOrder, button);
    }));
    main.querySelectorAll('[data-serve]').forEach((button) => button.addEventListener('click', () => {
      const orderId = Number(button.closest('[data-order-id]')?.dataset.orderId);
      const order = orders.find((item) => Number(item.id) === orderId);
      if (!order?.tableNo) return showToast('شمارهٔ میز سفارش مشخص نیست؛ آن را از صف سفارش‌ها به یک میز فعال تخصیص دهید.', 'error');
      openWaiterTerminal(order.tableNo, { selectedOrderId: orderId });
    }));
    main.querySelectorAll('[data-collect]').forEach((button) => button.addEventListener('click', () => {
      const order = orders.find((item) => Number(item.id) === Number(button.closest('[data-order-id]').dataset.orderId));
      if (order) openWaiterTerminal(order.tableNo, { selectedOrderId: Number(order.id) });
    }));
    main.querySelectorAll('[data-assign-waiter-table]').forEach((button) => button.addEventListener('click', () => {
      const order = orders.find((item) => String(item.id) === String(button.dataset.assignWaiterTable));
      if (order) openUnmappedOrderTableAssignment(order);
    }));
  }

  async function openWaiterOrderEditor(orderId, button) {
    if (typeof waiterHasCapability === 'function' && !waiterHasCapability('orders.create')) {
      showToast('ویرایش سفارش در دسترسی شما نیست؛ از مدیر شیفت دسترسی لازم را درخواست کنید.', 'error');
      return false;
    }
    const requestedBranchId = state.branchId;
    const requestedBranchGeneration = state.waiterBranchGeneration || 0;
    const isCurrentBranch = () => String(state.branchId ?? '') === String(requestedBranchId ?? '')
      && (state.waiterBranchGeneration || 0) === requestedBranchGeneration;
    setBusy(button, true);
    try {
      const loaded = await fetchWaiter();
      if (!loaded || !isCurrentBranch()) {
        showToast('فهرست سفارش‌ها در حال تازه‌شدن است؛ دوباره تلاش کنید.', 'warning');
        return false;
      }
      const latest = (state.data.orders || []).find((order) => String(order.id) === String(orderId));
      if (!latest || latest.fulfillment !== 'dine_in' || !orderIsOpen(latest) || !orderCanEdit(latest)) {
        refreshWaiterViewAfterSync();
        showToast('این سفارش دیگر قابل ویرایش نیست؛ مرحلهٔ تازهٔ سفارش نمایش داده شد.', 'warning');
        return false;
      }
      if (!waiterOrderHasMappedTable(latest)) {
        openUnmappedOrderTableAssignment(latest);
        return true;
      }
      await openWaiterTerminal(latest.tableNo, { selectedOrderId: Number(latest.id) });
      return true;
    } catch (error) {
      showToast(`بازکردن سفارش ناموفق بود: ${error.message}`, 'error');
      return false;
    } finally {
      setBusy(button, false);
    }
  }

  function openUnmappedOrderTableAssignment(order) {
    const canMoveOrders = waiterHasCapability('orders.move_table');
    const requestedBranchId = state.branchId;
    const requestedBranchGeneration = state.waiterBranchGeneration || 0;
    const isCurrentBranch = () => String(state.branchId ?? '') === String(requestedBranchId ?? '')
      && (state.waiterBranchGeneration || 0) === requestedBranchGeneration;
    const assignmentIntents = state.waiterUnmappedAssignmentIntents
      || (state.waiterUnmappedAssignmentIntents = new Map());
    const intentKey = `${String(requestedBranchId ?? '')}:${String(order.id)}`;
    let uncertainTargetNo = String(assignmentIntents.get(intentKey)?.tableNo || '');
    const candidates = waiterAvailableAssignmentTables();
    const uncertainTable = uncertainTargetNo
      ? (state.data.floor?.tables || []).find((table) => String(table.id) === uncertainTargetNo)
      : null;
    const uncertainTableLabel = uncertainTable?.label || `میز ${uncertainTargetNo}`;
    const tableOptions = uncertainTargetNo
      ? `<option value="${esc(uncertainTargetNo)}" selected>${esc(uncertainTableLabel)} · مقصد قفل‌شده برای بررسی نتیجه</option>`
      : candidates.map((table) => `<option value="${esc(table.id)}">${esc(table.label || `میز ${table.id}`)} · ${esc(table.zone || 'سالن')} · ${num(table.seats || 0)} نفر</option>`).join('');
    openDialog('رفع هشدار', 'اتصال سفارش به میز', `
      <div class="wt-table-assignment">
        <p>سفارش <strong>${esc(order.orderNo || `شمارهٔ ${order.id}`)}</strong> به هیچ میز فعالی روی نقشه وصل نیست.</p>
        ${!canMoveOrders
          ? '<div class="empty-state" role="status">تخصیص میز در دسترسی شما نیست؛ از مدیر شیفت دسترسی لازم را درخواست کنید.</div>'
          : uncertainTargetNo || candidates.length
          ? `<label class="field"><span>${uncertainTargetNo ? 'مقصد همان درخواست قبلی' : 'میز آزاد مقصد'}</span><select id="waiter-order-table-target" ${uncertainTargetNo ? 'disabled' : ''}>${tableOptions}</select></label>
            <p id="waiter-order-table-outcome" class="wt-stage-message ${uncertainTargetNo ? 'is-warning' : ''}" role="status" ${uncertainTargetNo ? '' : 'hidden'}>${uncertainTargetNo ? `نتیجهٔ انتقال قبلی روشن نیست؛ فقط همان مقصد (${esc(uncertainTableLabel)}) را دوباره بررسی کنید. انتخاب مقصد دیگر تا تطبیق وضعیت مجاز نیست.` : ''}</p>
            <button type="button" class="role-primary" id="waiter-order-table-confirm" data-order-id="${esc(order.id)}">${uncertainTargetNo ? `تلاش امن دوباره برای ${esc(uncertainTableLabel)}` : 'اتصال به میز انتخاب‌شده'}</button>`
          : '<div class="empty-state">در این شعبه میز آزادی برای اتصال وجود ندارد؛ ابتدا وضعیت یا چیدمان میزها را بررسی کنید.</div>'}
        <button type="button" class="role-secondary" id="waiter-order-table-cancel">بازگشت</button>
      </div>
    `);
    dialogBody.querySelector('#waiter-order-table-cancel')?.addEventListener('click', () => dialog.close());
    dialogBody.querySelector('#waiter-order-table-confirm')?.addEventListener('click', async (event) => {
      const confirmButton = event.currentTarget;
      if (confirmButton.disabled) return;
      if (!waiterHasCapability('orders.move_table')) {
        showToast('تخصیص میز در دسترسی شما نیست؛ از مدیر شیفت دسترسی لازم را درخواست کنید.', 'error');
        return;
      }
      const selection = dialogBody.querySelector('#waiter-order-table-target');
      const isUncertainRetry = Boolean(uncertainTargetNo);
      const tableNo = isUncertainRetry ? uncertainTargetNo : String(selection?.value || '');
      if (!tableNo) return showToast('یک میز آزاد انتخاب کنید.', 'error');
      if (!isCurrentBranch()) {
        return showToast('شعبهٔ فعال تغییر کرده است؛ فهرست سفارش‌ها را تازه کنید و دوباره اقدام کنید.', 'warning');
      }
      if (isUncertainRetry && String(selection?.value || '') !== uncertainTargetNo) {
        return showToast('نتیجهٔ درخواست قبلی روشن نیست؛ فقط همان مقصد را دوباره امتحان کنید.', 'warning');
      }
      let availableTable = null;
      if (!isUncertainRetry) {
        const latestOrder = (state.data.orders || []).find((item) => String(item.id) === String(order.id));
        if (!latestOrder || latestOrder.fulfillment !== 'dine_in' || !orderIsOpen(latestOrder) || waiterOrderHasMappedTable(latestOrder)) {
          return showToast('این سفارش دیگر نیازمند تعیین میز نیست؛ فهرست را تازه کنید.', 'error');
        }
        availableTable = waiterAvailableAssignmentTables().find((table) => String(table.id) === String(tableNo));
        if (!availableTable) return showToast('این میز دیگر آزاد نیست؛ یک میز آزاد دیگر انتخاب کنید.', 'error');
      } else {
        availableTable = (state.data.floor?.tables || []).find((table) => String(table.id) === String(tableNo));
      }
      setBusy(confirmButton, true);
      if (selection && !isUncertainRetry) selection.disabled = true;
      try {
        const result = await api(`/api/waiter/orders/${encodeURIComponent(order.id)}/move-table`, {
          method: 'PATCH',
          body: JSON.stringify({ tableNo }),
        });
        const confirmedOrder = result?.order;
        if (result?.ok !== true || !waiterOrderResponseMatchesIntent(confirmedOrder, {
          orderId: order.id,
          branchId: requestedBranchId,
          tableId: tableNo,
          exactTableNo: true,
        })) {
          throw Object.assign(new Error('پاسخ اتصال سفارش با شناسه، شعبه یا میز مقصد تطبیق ندارد؛ برای جلوگیری از انتقال دوباره، مقصد قفل شد.'), {
            code: 'waiter_assignment_response_unverified', outcomeUnknown: true,
          });
        }
        assignmentIntents.delete(intentKey);
        if (isCurrentBranch()) {
          const savedOrder = JSON.parse(JSON.stringify(confirmedOrder));
          const orderIndex = (state.data.orders || []).findIndex((item) => String(item.id) === String(order.id));
          if (orderIndex >= 0) state.data.orders[orderIndex] = savedOrder;
          else state.data.orders = [...(state.data.orders || []), savedOrder];
          state.activeView = 'orders';
          state.waiterUnmappedOnly = true;
        }
        dialog.close();
        let refreshed = false;
        let refreshError = null;
        if (isCurrentBranch()) {
          try { refreshed = await fetchWaiter(); } catch (error) { refreshError = error; }
        }
        if (isCurrentBranch()) {
          if (refreshed) {
            const refreshedOrder = (state.data.orders || []).find((item) => String(item.id) === String(order.id));
            if (!refreshedOrder || !refreshedOrder.tableNo) {
              const savedOrder = JSON.parse(JSON.stringify(confirmedOrder));
              const orderIndex = (state.data.orders || []).findIndex((item) => String(item.id) === String(order.id));
              if (orderIndex >= 0) state.data.orders[orderIndex] = savedOrder;
              else state.data.orders = [...(state.data.orders || []), savedOrder];
              refreshError = new Error('فهرست تازه با نتیجهٔ ثبت‌شده هم‌خوان نیست.');
              refreshed = false;
            } else if (String(refreshedOrder.tableNo) !== String(tableNo)) {
              refreshError = new Error(`فهرست تازه سفارش را روی میز ${refreshedOrder.tableNo} نشان می‌دهد.`);
              refreshed = false;
            }
          }
          render();
          if (refreshed) {
            showToast(`سفارش به ${availableTable?.label || `میز ${tableNo}`} متصل شد.`);
          } else {
            showToast(`اتصال سفارش به ${availableTable?.label || `میز ${tableNo}`} تأیید شد، اما فهرست تازه ناموفق یا ناسازگار بود${refreshError?.message ? `: ${refreshError.message}` : '؛ وضعیت را دوباره تازه کنید'}. تا تطبیق، انتقال دیگری انجام ندهید.`, 'warning');
          }
        } else {
          showToast(`اتصال سفارش به میز ${tableNo} از سرور تأیید شد؛ شعبهٔ فعال تغییر کرده، پس وضعیت همان سفارش را در شعبهٔ قبلی تازه کنید.`, 'warning');
        }
      } catch (error) {
        if (error.outcomeUnknown) {
          uncertainTargetNo = String(tableNo);
          assignmentIntents.set(intentKey, { orderId: String(order.id), branchId: String(requestedBranchId ?? ''), tableNo: uncertainTargetNo });
          if (selection?.isConnected) {
            selection.value = uncertainTargetNo;
            selection.disabled = true;
          }
          const outcomeNote = dialogBody.querySelector('#waiter-order-table-outcome');
          const lockedTable = (state.data.floor?.tables || []).find((table) => String(table.id) === uncertainTargetNo);
          const lockedLabel = lockedTable?.label || `میز ${uncertainTargetNo}`;
          if (outcomeNote) {
            outcomeNote.hidden = false;
            outcomeNote.classList.add('is-warning');
            outcomeNote.textContent = `نتیجهٔ درخواست روشن نیست؛ مقصد ${lockedLabel} قفل شد. برای جلوگیری از انتقال دوباره، فقط همین مقصد را دوباره امتحان کنید.`;
          }
          confirmButton.dataset.label = `تلاش امن دوباره برای ${lockedLabel}`;
          confirmButton.title = 'مقصد تا روشن شدن نتیجهٔ درخواست قبلی قابل تغییر نیست.';
          showToast(`نتیجهٔ اتصال به ${lockedLabel} روشن نیست؛ مقصد قفل شد و فقط همان درخواست را دوباره امتحان کنید.`, 'warning');
        } else if (isUncertainRetry) {
          let refreshed = false;
          let refreshError = null;
          try { refreshed = await fetchWaiter(); } catch (error) { refreshError = error; }
          if (refreshed) {
            const latestOrder = (state.data.orders || []).find((item) => String(item.id) === String(order.id));
            assignmentIntents.delete(intentKey);
            dialog.close();
            state.activeView = 'orders';
            state.waiterUnmappedOnly = true;
            render();
            if (latestOrder?.tableNo) {
              showToast(`وضعیت تازه تأیید کرد سفارش اکنون به میز ${latestOrder.tableNo} وصل است؛ انتقال دیگری انجام ندادیم.`, 'warning');
            } else if (latestOrder && latestOrder.fulfillment === 'dine_in' && orderIsOpen(latestOrder)) {
              showToast(`درخواست اتصال به میز ${tableNo} ثبت نشد؛ فهرست تازه است و می‌توانید پس از بررسی میز آزاد دوباره انتخاب کنید.`, 'error');
            } else {
              showToast('وضعیت تازهٔ سفارش نمایش داده شد؛ این سفارش دیگر در صف تخصیص میز نیست.', 'warning');
            }
            return;
          }
          showToast(`${error.message} وضعیت انتقال قبلی هم تازه نشد${refreshError?.message ? `: ${refreshError.message}` : ''}؛ مقصد قفل می‌ماند و فقط همان را دوباره امتحان کنید.`, 'warning');
        } else {
          showToast(error.message, 'error');
        }
        setBusy(confirmButton, false);
        if (selection?.isConnected && !uncertainTargetNo) selection.disabled = false;
      }
    });
  }

  function waiterReservations() {
    clearRoleHeaderContext();
    document.body.classList.remove('is-waiter-floor-app');
    const waitlistUnavailable = Boolean(state.data.waiterDataIssues?.waitlist);
    const reservationsUnavailable = Boolean(state.data.waiterDataIssues?.reservations);
    const active = waitlistUnavailable ? [] : (state.data.waitlist || []).filter((entry) => ['waiting', 'called', 'seated'].includes(entry.status));
    const history = waitlistUnavailable ? [] : (state.data.waitlist || []).filter((entry) => ['left', 'cancelled'].includes(entry.status)).slice(0, 8);
    const todayKey = String(state.data.reservations?.serverTime || new Date().toISOString()).slice(0, 10);
    const timedToday = reservationsUnavailable ? [] : (state.data.reservations?.reservations || []).filter((item) => item.date === todayKey && !['cancelled', 'no_show'].includes(item.status)).slice(0, 8);
    const summary = state.data.waitlistSummary || {};
    const unavailablePanel = (title, message) => `<div class="empty-state" role="status"><strong>${title}</strong><p>${message}</p><button type="button" class="role-secondary" data-waiter-data-retry>تلاش دوباره</button></div>`;
    const card = (entry) => {
      const label = entry.name || 'مهمان حضوری';
      const party = entry.partySize ? `${num(entry.partySize)} نفر` : 'تعداد نفرات مشخص نشده';
      const status = entry.status === 'seated' ? `نشسته · میز ${esc(entry.tableNo || '—')}` : entry.status === 'called' ? 'منتظر آمدن مهمان' : 'در صف انتظار';
      const actions = entry.status === 'waiting'
        ? `<button class="role-primary" data-waitlist-action="called" data-waitlist-id="${entry.id}">فراخوانی</button>`
        : entry.status === 'called'
          ? `<button class="role-primary" data-waitlist-seat="${entry.id}">نشاندن مهمان</button>`
          : `<button class="role-secondary" data-waitlist-action="left" data-waitlist-id="${entry.id}">مهمان خارج شد</button>`;
      return `<article class="waitlist-card waitlist-card--${esc(entry.status)}" data-waitlist-id="${entry.id}">
        <div class="waitlist-card__number">${entry.position ? num(entry.position) : '•'}<small>${entry.position ? 'نفر در صف' : 'فعال'}</small></div>
        <div class="waitlist-card__content"><div class="waitlist-card__top"><strong>${esc(label)}</strong><a href="tel:${esc(entry.phone)}" dir="ltr">${esc(entry.phone)}</a></div><div class="waitlist-card__meta"><span>${esc(party)}</span><span>${esc(time(entry.createdAt))}</span><b>${esc(status)}</b></div>${entry.note ? `<p>${esc(entry.note)}</p>` : ''}<div class="waitlist-card__actions">${actions}<button class="role-danger" data-waitlist-action="cancelled" data-waitlist-id="${entry.id}">لغو</button></div></div>
      </article>`;
    };
    const timedCards = timedToday.map((item) => `<article class="reservation-mini-card"><div><strong>${esc(item.name || item.phone)}</strong><span>${esc(item.time || '—')} · ${num(item.partySize || 0)} نفر</span></div><b>${esc(({ pending: 'در انتظار تأیید', confirmed: 'تأییدشده', seated: 'نشسته' })[item.status] || item.status)}</b></article>`).join('');
    const waitlistAction = waitlistUnavailable
      ? '<button class="role-secondary" id="waitlist-add" type="button" disabled title="ابتدا اطلاعات صف را تازه کنید">پذیرش موقتاً در دسترس نیست</button>'
      : '<button class="role-primary" id="waitlist-add">+ پذیرش مهمان حضوری</button>';
    const waitlistContent = waitlistUnavailable
      ? unavailablePanel('صف انتظار بارگیری نشد', 'فهرست خالی بودن تأیید نشده؛ تا بارگیری موفق، ثبت و تغییر مهمانان متوقف است.')
      : active.map(card).join('') || empty('صف انتظار خالی است؛ مهمان حضوری بعدی را همین‌جا ثبت کنید.');
    const reservationContent = reservationsUnavailable
      ? unavailablePanel('رزروهای امروز بارگیری نشد', 'برای جلوگیری از نمایش اطلاعات ناقص، این بخش خالی فرض نمی‌شود.')
      : timedCards || empty('برای امروز رزرو زمان‌داری ثبت نشده است.');
    const summaryCount = (key) => waitlistUnavailable ? '—' : num(summary[key] || 0);
    main.innerHTML = `${pageHead('پذیرش مهمان', 'صف انتظار', 'شماره تماس کافی است؛ میز را فقط وقتی مهمان آمادهٔ نشستن است انتخاب کنید.', waitlistAction)}
      <section class="waitlist-summary" aria-label="خلاصه صف"><article><strong>${summaryCount('waiting')}</strong><span>در انتظار</span></article><article class="is-called"><strong>${summaryCount('called')}</strong><span>منتظر آمدن</span></article><article class="is-seated"><strong>${summaryCount('seated')}</strong><span>نشسته</span></article></section>
      <section class="role-section waitlist-panel"><div class="role-section__head"><h2>مهمان‌های منتظر</h2><span>${waitlistUnavailable ? 'وضعیت نامشخص' : `${num(active.length)} نفر فعال`}</span></div><div class="waitlist-list">${waitlistContent}</div></section>
      <section class="role-section reservation-panel"><div class="role-section__head"><h2>رزروهای زمان‌دار امروز</h2><span>${reservationsUnavailable ? 'وضعیت نامشخص' : `${num(timedToday.length)} رزرو`}</span></div><div class="reservation-mini-list">${reservationContent}</div></section>
      ${history.length ? `<section class="role-section waitlist-history"><div class="role-section__head"><h2>پایان‌یافته‌های اخیر</h2><span>فقط برای پیگیری</span></div><div class="reservation-mini-list">${history.map((entry) => `<article class="reservation-mini-card"><div><strong>${esc(entry.name || 'مهمان حضوری')}</strong><span dir="ltr">${esc(entry.phone)}</span></div><b>${entry.status === 'left' ? 'خارج شد' : 'لغو شد'}</b></article>`).join('')}</div></section>` : ''}`;
    if (!waitlistUnavailable) document.getElementById('waitlist-add')?.addEventListener('click', openWaitlistDialog);
    main.querySelectorAll('[data-waiter-data-retry]').forEach((button) => button.addEventListener('click', async () => {
      setBusy(button, true);
      try {
        await fetchWaiter();
        waiterReservations();
        const remainingIssues = Object.values(state.data.waiterDataIssues || {}).some(Boolean);
        showToast(remainingIssues ? 'بعضی اطلاعات هنوز در دسترس نیست؛ وضعیت نامشخص نمایش داده شد.' : 'اطلاعات پذیرش مهمان تازه شد.', remainingIssues ? 'warning' : '');
      } catch (error) {
        showToast(`اطلاعات سالن تازه نشد: ${error.message}`, 'error');
        if (button.isConnected) setBusy(button, false);
      }
    }));
    main.querySelectorAll('[data-waitlist-action]').forEach((button) => button.addEventListener('click', () => {
      const status = button.dataset.waitlistAction;
      if (status === 'cancelled' && !window.confirm('این مهمان از صف خارج شود؟')) return;
      action(button, () => api(`/api/waiter/waitlist/${button.dataset.waitlistId}`, { method: 'PATCH', body: JSON.stringify({ status }) }), status === 'called' ? 'مهمان برای فراخوانی آماده شد.' : status === 'left' ? 'خروج مهمان ثبت شد.' : 'مهمان از صف خارج شد.');
    }));
    main.querySelectorAll('[data-waitlist-seat]').forEach((button) => button.addEventListener('click', () => openWaitlistSeatDialog(button.dataset.waitlistSeat)));
  }

  async function openWaitlistDialog() {
    openDialog('پذیرش سریع', 'مهمان حضوری جدید', `<div class="waitlist-dialog"><div class="waitlist-dialog__intro"><strong>شماره تماس، مهمان را وارد صف می‌کند</strong><span>انتخاب میز لازم نیست؛ هنگام آماده‌شدن، میز مناسب را انتخاب می‌کنید.</span></div><div class="waitlist-form"><label class="field field--primary"><span>شماره موبایل *</span><input id="waitlist-phone" inputmode="tel" autocomplete="tel" dir="ltr" placeholder="۰۹۱۲۱۲۳۴۵۶۷۸" maxlength="11" required /></label><div class="field-grid"><label class="field"><span>نام (اختیاری)</span><input id="waitlist-name" maxlength="80" placeholder="مثلاً سارا" /></label><label class="field"><span>تعداد نفرات (اختیاری)</span><input id="waitlist-party" inputmode="numeric" maxlength="2" placeholder="بعداً هم می‌شود" /></label></div><label class="field"><span>یادداشت کوتاه (اختیاری)</span><input id="waitlist-note" maxlength="200" placeholder="مثلاً کنار پنجره" /></label><button class="role-primary" id="waitlist-submit" type="button">افزودن به صف</button></div></div>`, { variant: 'waitlist' });
    document.getElementById('waitlist-phone')?.focus();
    let retryFingerprint = '';
    let retryIdempotencyKey = '';
    document.getElementById('waitlist-submit')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const phone = normalizeDigits(document.getElementById('waitlist-phone')?.value || '').replace(/\D/g, '');
      if (!/^09\d{9}$/.test(phone)) return showToast('شماره موبایل ۱۱ رقمی وارد کنید.', 'error');
      const payload = {
        branchId: state.branchId,
        phone,
        name: document.getElementById('waitlist-name')?.value || '',
        partySize: normalizeDigits(document.getElementById('waitlist-party')?.value || ''),
        note: document.getElementById('waitlist-note')?.value || '',
      };
      const fingerprint = JSON.stringify(payload);
      if (fingerprint !== retryFingerprint) {
        retryFingerprint = fingerprint;
        retryIdempotencyKey = `waitlist-${state.branchId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }
      setBusy(button, true);
      try {
        await api('/api/waiter/waitlist', { method: 'POST', headers: { 'Idempotency-Key': retryIdempotencyKey }, body: JSON.stringify(payload) });
        dialog.close();
        showToast('مهمان به صف انتظار اضافه شد.');
        await render();
      } catch (error) { showToast(error.message, 'error'); }
      finally { setBusy(button, false); }
    });
  }

  function openWaitlistSeatDialog(id) {
    const entry = (state.data.waitlist || []).find((item) => String(item.id) === String(id));
    if (!entry) return;
    const tables = (state.data.floor?.tables || []).filter((table) => table.active !== false && ['available'].includes(table.state));
    openDialog('انتقال از صف', 'مهمان را بنشانید', `<div class="waitlist-dialog"><div class="waitlist-dialog__intro"><strong>${esc(entry.name || 'مهمان حضوری')}</strong><span dir="ltr">${esc(entry.phone)} · ${entry.partySize ? `${num(entry.partySize)} نفر` : 'تعداد نفرات نامشخص'}</span></div><div class="waitlist-form"><label class="field"><span>میز آزاد *</span><select id="waitlist-table"><option value="">انتخاب میز</option>${tables.map((table) => `<option value="${esc(table.id)}">${esc(table.label || `میز ${table.id}`)} · ${num(table.seats || 0)} نفر</option>`).join('')}</select></label><label class="field"><span>تعداد نفرات (در صورت مشخص‌شدن)</span><input id="seat-party" inputmode="numeric" value="${entry.partySize ? esc(entry.partySize) : ''}" placeholder="اختیاری" /></label>${tables.length ? '' : '<div class="waitlist-dialog__warning">در حال حاضر میز آزادی در نقشهٔ سالن ثبت نشده است.</div>'}<button class="role-primary" id="waitlist-seat-submit" type="button" ${tables.length ? '' : 'disabled'}>نشاندن و آزادکردن جای صف</button></div></div>`, { variant: 'waitlist' });
    document.getElementById('waitlist-seat-submit')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const tableNo = document.getElementById('waitlist-table')?.value;
      if (!tableNo) return showToast('یک میز آزاد انتخاب کنید.', 'error');
      setBusy(button, true);
      try {
        const rawParty = normalizeDigits(document.getElementById('seat-party')?.value || '').trim();
        const payload = { status: 'seated', tableNo };
        if (rawParty) payload.partySize = rawParty;
        await api(`/api/waiter/waitlist/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        dialog.close();
        showToast('مهمان در میز انتخاب‌شده نشانده شد.');
        await render();
      } catch (error) { showToast(error.message, 'error'); }
      finally { setBusy(button, false); }
    });
  }

  async function loadMenu(force = false) {
    if (!force && state.menuItems.length) return;
    const requestedBranchId = state.branchId;
    const requestedBranchGeneration = state.waiterBranchGeneration || 0;
    const requestId = state.waiterMenuRequestId = (state.waiterMenuRequestId || 0) + 1;
    const branchParam = requestedBranchId ? `&branchId=${encodeURIComponent(requestedBranchId)}` : '';
    const data = await api(`/api/staff/menu?lang=fa${branchParam}`);
    if (String(state.branchId ?? '') !== String(requestedBranchId ?? '')
      || (state.waiterBranchGeneration || 0) !== requestedBranchGeneration
      || state.waiterMenuRequestId !== requestId) return;
    state.menuItems = data.menuItems || data.items || [];
    state.menuCategories = data.menuCategories || [];
    state.menuComplements = data.menuComplements || [];
    state.menuComplementRules = data.menuComplementRules || [];
  }

  async function showOrderComposer(source, presetTable = '') {
    if (source === 'waiter') {
      if (presetTable) {
        openWaiterTerminal(presetTable);
        return;
      }
      waiterFloor();
      return;
    }
    try { await loadMenu(); } catch (error) { return showToast(error.message, 'error'); }
    state.cart.clear();

    const tables = state.data.floor?.tables || [];
    const fulfillmentOptions = source === 'cashier' ? '<option value="dine_in">داخل مجموعه</option><option value="pickup">بیرون‌بر</option>' : '<option value="dine_in">داخل مجموعه</option>';
    openDialog('صندوق فروش', 'سفارش جدید', `<div class="field-grid" style="margin-bottom:12px"><label class="field"><span>نوع سفارش</span><select id="composer-fulfillment">${fulfillmentOptions}</select></label><label class="field"><span>میز</span><select id="composer-table"><option value="">انتخاب میز</option>${tables.map((table) => `<option value="${table.id}" ${String(table.id) === String(presetTable) ? 'selected' : ''}>${esc(table.label)}</option>`).join('')}</select></label><label class="field"><span>موبایل مهمان (اختیاری)</span><input id="composer-phone" inputmode="tel" /></label><label class="field"><span>یادداشت</span><input id="composer-note" maxlength="240" /></label></div>
      <div class="composer"><section class="composer-menu"><input class="composer-search" id="composer-search" placeholder="جست‌وجوی محصول…" /><div class="composer-items" id="composer-items"></div></section><aside class="composer-cart"><strong>سبد سفارش</strong><div class="cart-lines" id="cart-lines">${empty('محصولی انتخاب نشده است.')}</div><div class="cart-total"><span>جمع</span><b id="cart-total">۰ تومان</b></div><button class="role-primary" id="composer-submit" style="width:100%">ثبت و ارسال سفارش</button></aside></div>`);
    const paintItems = (query = '') => {
      const normalized = query.trim();
      document.getElementById('composer-items').innerHTML = state.menuItems.filter((item) => !normalized || String(item.name || '').includes(normalized)).slice(0, 120).map((item) => {
        const outOfStock = isItemOutOfStock(item);
        const stockBadge = outOfStock ? '<small class="is-out-of-stock-badge" style="color:var(--danger,#e53e3e);margin-inline-start:6px">ناموجود</small>' : '';
        return `<button class="composer-item ${outOfStock ? 'is-out-of-stock' : ''}" data-menu-id="${item.id}" ${outOfStock ? 'data-out-of-stock="true"' : ''}>${item.img ? `<img src="${esc(item.img)}" alt="" loading="lazy" />` : '<span></span>'}<span><strong>${esc(item.name)}</strong>${stockBadge}<span>${money(item.price)}</span></span><b>${outOfStock ? '✕' : '+'}</b></button>`;
      }).join('') || empty('محصولی پیدا نشد.');
      document.querySelectorAll('[data-menu-id]').forEach((button) => button.addEventListener('click', () => {
        const id = Number(button.dataset.menuId);
        const item = state.menuItems.find((entry) => Number(entry.id) === id);
        if (item && isItemOutOfStock(item)) return showToast(`«${item.name}» در حال حاضر ناموجود است.`, 'warning');
        state.cart.set(id, (state.cart.get(id) || 0) + 1);
        paintCart();
      }));
    };
    const paintCart = () => {
      const lines = [...state.cart.entries()].map(([id, qty]) => ({ item: state.menuItems.find((entry) => Number(entry.id) === id), qty })).filter((line) => line.item);
      document.getElementById('cart-lines').innerHTML = lines.map(({ item, qty }) => `<div class="cart-line"><div><strong>${esc(item.name)}</strong><small>${money(item.price * qty)}</small></div><div class="cart-line__qty"><button data-cart-delta="-1" data-cart-id="${item.id}">−</button><b>${num(qty)}</b><button data-cart-delta="1" data-cart-id="${item.id}">+</button></div></div>`).join('') || empty('محصولی انتخاب نشده است.');
      document.getElementById('cart-total').textContent = money(lines.reduce((sum, line) => sum + Number(line.item.price || 0) * line.qty, 0));
      document.querySelectorAll('[data-cart-delta]').forEach((button) => button.addEventListener('click', () => { const id = Number(button.dataset.cartId); const next = (state.cart.get(id) || 0) + Number(button.dataset.cartDelta); if (next <= 0) state.cart.delete(id); else state.cart.set(id, next); paintCart(); }));
    };
    paintItems();
    document.getElementById('composer-search').addEventListener('input', (event) => paintItems(event.target.value));
    document.getElementById('composer-fulfillment').addEventListener('change', (event) => { document.getElementById('composer-table').disabled = event.target.value !== 'dine_in'; });
    document.getElementById('composer-submit').addEventListener('click', (event) => action(event.currentTarget, async () => {
      const fulfillment = document.getElementById('composer-fulfillment').value;
      const tableNo = document.getElementById('composer-table').value;
      if (fulfillment === 'dine_in' && !tableNo) throw new Error('میز را انتخاب کنید.');
      if (!state.cart.size) throw new Error('حداقل یک محصول انتخاب کنید.');
      for (const [menuItemId] of state.cart.entries()) {
        const item = state.menuItems.find((entry) => Number(entry.id) === menuItemId);
        if (item && isItemOutOfStock(item)) throw new Error(`«${item.name}» ناموجود است و قابل سفارش نیست.`);
      }
      await api('/api/staff/orders', { method: 'POST', headers: { 'Idempotency-Key': `staff-${Date.now()}-${Math.random().toString(16).slice(2)}` }, body: JSON.stringify({ branchId: state.branchId, fulfillment, tableNo, phone: document.getElementById('composer-phone').value, note: document.getElementById('composer-note').value, paymentMethod: 'cashier', items: [...state.cart.entries()].map(([menuItemId, qty]) => ({ menuItemId, qty })) }) });
      dialog.close();
    }, 'سفارش ثبت و به جریان عملیات ارسال شد.'));
  }

  async function fetchKitchen() {
    if (state.kdsSnapshotInFlight) {
      const inFlight = state.kdsSnapshotInFlight;
      state.kdsSnapshotRefreshQueued = true;
      return inFlight.then(() => {
        if (state.kdsSnapshotInFlight && state.kdsSnapshotInFlight !== inFlight) return state.kdsSnapshotInFlight;
        if (state.kdsSnapshotRefreshQueued) {
          state.kdsSnapshotRefreshQueued = false;
          return fetchKitchen();
        }
        return state.data.kitchen;
      });
    }

    const request = (async () => {
      let data;
      do {
        state.kdsSnapshotRefreshQueued = false;
        data = await api(`/api/kitchen/orders${qs()}`);
      } while (state.kdsSnapshotRefreshQueued);

      const visibleTicketItems = new Map((data.tickets || []).map((ticket) => [
        String(ticket.id), new Set([...(ticket.items || []), ...kdsHeldCourseItems(ticket)].map((item) => String(item.key))),
      ]));
      for (const [ticketId, hiddenKeys] of state.kdsHeldNotices) {
        const currentKeys = visibleTicketItems.get(String(ticketId));
        if (!currentKeys) {
          state.kdsHeldNotices.delete(ticketId);
          continue;
        }
        for (const key of [...hiddenKeys]) if (currentKeys.has(key)) hiddenKeys.delete(key);
        if (!hiddenKeys.size) state.kdsHeldNotices.delete(ticketId);
      }

      const openCount = (data.tickets || []).filter((ticket) => ticket.column !== 'ready').length;
      if (state.kdsLastOpenCount !== null && openCount > state.kdsLastOpenCount) kdsBeep();
      state.kdsLastOpenCount = openCount;
      state.kdsActionNeedsRefresh = false;
      state.data = { kitchen: data };
      return data;
    })();

    state.kdsSnapshotInFlight = request;
    try { return await request; }
    finally {
      if (state.kdsSnapshotInFlight === request) state.kdsSnapshotInFlight = null;
    }
  }

  async function fetchKitchenInventory() {
    const response = await api(`/api/kitchen/inventory${qs()}`);
    state.data = { inventory: response.data || {} };
  }

  function inventoryStatusLabel(status) {
    return ({ available: 'عادی', reorder: 'نیازمند سفارش', negative: 'موجودی منفی', insufficient_data: 'داده ناکافی', posted: 'ثبت مالی شد', blocked: 'نیازمند حسابدار', pending: 'منتظر ثبت', pending_approval: 'منتظر تأیید مالک', approved: 'تأییدشده', retired: 'نسخه قبلی', rejected: 'ردشده' })[status] || status || '—';
  }

  function kitchenInventoryPage() {
    const data = state.data.inventory || {};
    const items = data.items || [];
    const menuItems = data.menuItems || [];
    const recipeVersions = data.recipeVersions || [];
    const recipes = data.productionRecipes || [];
    const receivablePurchaseOrders = data.receivablePurchaseOrders || [];
    const capacities = data.recipeCapacity || [];
    const operations = data.recentOperations || [];
    const summary = data.summary || {};
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const itemOptions = items.map((item) => `<option value="${esc(item.id)}" data-unit="${esc(item.unit || '')}">${esc(item.name)} · ${num(item.availableQuantity)} ${esc(item.unit || '')}</option>`).join('');
    const recipeIngredientOptions = items.map((item) => `<option value="${esc(item.id)}" data-unit="${esc(item.unit || '')}">${esc(item.name)} · واحد پایه ${esc(item.unit || 'تعریف نشده')}</option>`).join('');
    const menuItemOptions = menuItems.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}${item.category ? ` · ${esc(item.category)}` : ''}</option>`).join('');
    const recipeOptions = recipes.map((recipe) => `<option value="${esc(recipe.id)}" data-yield="${esc(recipe.defaultPlannedYield)}">${esc(recipe.name)}${recipe.version ? ` · نسخه ${esc(recipe.version)}` : ''}</option>`).join('');
    const receiptOptions = receivablePurchaseOrders.flatMap((po) => (po.lines || []).map((line) => `<option value="${esc(po.id)}|${esc(line.id)}" data-max="${esc(line.remainingQuantity)}">${esc(po.number)} · ${esc(po.vendorName)} · ${esc(line.description)} · مانده ${num(line.remainingQuantity)} ${esc(line.unit || '')}</option>`)).join('');

    const activeTab = state.kitchenInvTab || (receivablePurchaseOrders.length ? 'receiving' : 'stock');

    main.innerHTML = `${pageHead('عملیات انبار و تحویل', 'تحویل بار، موجودی فیزیکی، ضایعات و آماده‌سازی', 'شما فقط واقعیت فیزیکی را ثبت می‌کنید؛ قیمت خرید، حساب‌ها و مبلغ سند در این پنل نمایش داده نمی‌شوند.')}
      <div class="role-metrics">${metric('منتظر تحویل', num(summary.receivablePurchaseOrderLines), 'سفارش‌های خرید تأییدشده')}${metric('اقلام انبار', num(summary.items))}${metric('هشدار کسری', num(summary.lowStock), 'به نقطه سفارش رسیده')}${metric('استثناهای باز', num(summary.exceptions), 'جهت بررسی حسابدار')}</div>

      <nav class="kitchen-inv-tabs" aria-label="بخش‌های عملیات انبار">
        <button type="button" class="kitchen-inv-tab ${activeTab === 'receiving' ? 'is-active' : ''}" data-kinv-tab="receiving">
          📦 تحویل و رسید بار
          ${summary.receivablePurchaseOrderLines ? `<span class="badge badge--warn">${num(summary.receivablePurchaseOrderLines)}</span>` : ''}
        </button>
        <button type="button" class="kitchen-inv-tab ${activeTab === 'stock' ? 'is-active' : ''}" data-kinv-tab="stock">
          📊 موجودی و مواد اولیه
          <span class="badge">${num(items.length)}</span>
        </button>
        <button type="button" class="kitchen-inv-tab ${activeTab === 'waste' ? 'is-active' : ''}" data-kinv-tab="waste">
          🗑️ ثبت ضایعات
        </button>
        <button type="button" class="kitchen-inv-tab ${activeTab === 'count' ? 'is-active' : ''}" data-kinv-tab="count">
          ⚖️ شمارش قفسه
        </button>
        <button type="button" class="kitchen-inv-tab ${activeTab === 'production' ? 'is-active' : ''}" data-kinv-tab="production">
          🍳 آماده‌سازی پایه
          <span class="badge">${num(recipes.length)}</span>
        </button>
        <button type="button" class="kitchen-inv-tab ${activeTab === 'capacity' ? 'is-active' : ''}" data-kinv-tab="capacity">
          📈 ظرفیت و تاریخچه
        </button>
        <button type="button" class="kitchen-inv-tab ${activeTab === 'recipe' ? 'is-active' : ''}" data-kinv-tab="recipe">
          ⚙️ دستور تهیه جدید
          ${summary.pendingRecipeVersions ? `<span class="badge badge--warn">${num(summary.pendingRecipeVersions)}</span>` : ''}
        </button>
      </nav>

      <!-- زبانه ۱: تحویل بار و فاکتور ورودی -->
      <section class="kitchen-panel-view ${activeTab === 'receiving' ? 'is-active' : ''}" data-kinv-view="receiving">
        <div class="role-section__head">
          <h2>سفارش‌های خرید آماده تحویل</h2>
          <span>بار رسیده از تأمین‌کننده را با یک کلیک تحویل بگیرید یا مقدار کسری را ثبت کنید.</span>
        </div>
        ${receivablePurchaseOrders.length ? `
          <div class="kitchen-rcv-grid">
            ${receivablePurchaseOrders.map((po) => `
              <article class="kitchen-rcv-card">
                <header class="kitchen-rcv-head">
                  <div>
                    <strong>سفارش خرید ${esc(po.number)}</strong>
                    <span>تأمین‌کننده: ${esc(po.vendorName)}</span>
                  </div>
                  ${po.expectedDate ? `<span>تحویل: ${fmtDate(po.expectedDate)}</span>` : ''}
                </header>
                <div class="kitchen-rcv-body">
                  ${(po.lines || []).map((line) => `
                    <div class="kitchen-rcv-item">
                      <div class="kitchen-rcv-item-title">
                        <b>${esc(line.description || line.itemId)}</b>
                        <small>سفارش: ${num(line.orderedQuantity)} ${esc(line.unit || '')} · تحویل قبلی: ${num(line.receivedQuantity || 0)}</small>
                      </div>
                      <div class="kitchen-rcv-item-qty">
                        <strong>مانده: ${num(line.remainingQuantity)} ${esc(line.unit || '')}</strong>
                        <span>قابل تحویل</span>
                      </div>
                      <button type="button" class="kitchen-rcv-btn" data-pick-receipt="${esc(po.id)}|${esc(line.id)}" data-pick-qty="${esc(line.remainingQuantity)}">
                        تحویل کامل این کالا (${num(line.remainingQuantity)} ${esc(line.unit || '')})
                      </button>
                    </div>
                  `).join('')}
                </div>
              </article>
            `).join('')}
          </div>
        ` : `
          <div class="inventory-action__empty" style="padding: 24px; text-align: center; background: #fff; border: 1px solid var(--rp-line); border-radius: 16px; margin-bottom: 20px;">
            سفارش خرید تأییدشده‌ای در انتظار تحویل برای این شعبه وجود ندارد. سفارش‌های ایجادشده توسط حسابدار پس از تأیید مدیر به‌طور خودکار در این کارت‌ها نمایش داده می‌شوند.
          </div>
        `}

        <div class="inventory-action" style="margin-top: 14px;">
          <summary style="cursor: default;"><b>فرم ثبت رسید تحویل کالا</b><span>مقدار تحویل‌گرفته و شماره فاکتور یا بارنامه را تکمیل فرمایید.</span></summary>
          ${receiptOptions ? `
            <form id="inventory-receipt-form" class="field-grid">
              <label class="field field--full"><span>سفارش و ردیف کالا</span><select name="poLine" required><option value="">انتخاب ردیف قابل دریافت (یا کلیک روی کارت‌های بالا)</option>${receiptOptions}</select></label>
              <label class="field"><span>مقدار تحویل‌شده</span><input name="receivedQuantity" type="number" min="0.000001" step="any" placeholder="مثلاً ۲۵" required></label>
              <label class="field"><span>شماره حواله یا بارنامه تأمین‌کننده</span><input name="deliveryNoteNumber" maxlength="120" placeholder="شماره فاکتور یا قبض باربر"></label>
              <label class="field"><span>تاریخ دریافت</span><input name="receivedDate" type="date" value="${today}" required></label>
              <label class="field field--full"><span>یادداشت کنترل کیفی</span><input name="notes" maxlength="300" placeholder="مثلاً بسته‌بندی سالم، بار بدون آسیب تحویل شد"></label>
              <button class="role-primary field--full" type="submit">ثبت رسید و افزایش موجودی</button>
            </form>
          ` : `
            <div class="inventory-action__empty">حسابدار باید سفارش خرید را ایجاد کند و مالک/مدیر آن را تأیید کند؛ انباردار قیمت یا حساب را تعیین نمی‌کند.</div>
          `}
        </div>
      </section>

      <!-- زبانه ۲: موجودی و اقلام زنده -->
      <section class="kitchen-panel-view ${activeTab === 'stock' ? 'is-active' : ''}" data-kinv-view="stock">
        <div class="kitchen-stock-bar">
          <div class="kitchen-search-wrap">
            <span class="kitchen-search-icon">🔍</span>
            <input type="search" id="kitchen-stock-search" class="kitchen-search-input" placeholder="جستجوی سریع نام یا کد کالا..." autocomplete="off">
          </div>
          <div class="kitchen-filter-pills" id="kitchen-category-filters">
            <button type="button" class="kitchen-filter-pill is-active" data-cat-filter="all">همه مواد (${num(items.length)})</button>
            <button type="button" class="kitchen-filter-pill" data-status-filter="reorder">نیازمند سفارش (${num(summary.lowStock)})</button>
            <button type="button" class="kitchen-filter-pill" data-cat-filter="پروتئین">گوشت و پروتئین</button>
            <button type="button" class="kitchen-filter-pill" data-cat-filter="سبزی">سبزیجات و تره‌بار</button>
            <button type="button" class="kitchen-filter-pill" data-cat-filter="لبنی">لبنیات</button>
            <button type="button" class="kitchen-filter-pill" data-cat-filter="سس">سس و ادویه</button>
            <button type="button" class="kitchen-filter-pill" data-cat-filter="نان">نان و غلات</button>
            <button type="button" class="kitchen-filter-pill" data-cat-filter="نوشیدنی">نوشیدنی</button>
          </div>
        </div>

        <div class="kitchen-stock-cards" id="kitchen-stock-cards-container">
          ${items.map((item) => `
            <article class="kitchen-stock-card" data-stock-name="${esc(item.name).toLowerCase()}" data-stock-sku="${esc(item.sku || item.id).toLowerCase()}" data-stock-status="${esc(item.status)}">
              <div class="kitchen-stock-card-top">
                <div class="kitchen-stock-card-title">
                  <b>${esc(item.name)}</b>
                  <small>${esc(item.sku || item.id)}</small>
                </div>
                <i data-status="${esc(item.status)}">${esc(inventoryStatusLabel(item.status))}</i>
              </div>
              <div class="kitchen-stock-card-main">
                <div class="kitchen-stock-card-qty">${item.availableQuantity == null ? '—' : `${num(item.availableQuantity)} ${esc(item.unit || '')}`}</div>
                <div class="kitchen-stock-card-reorder">${item.reorderPoint == null ? 'نقطه سفارش ندارد' : `حداقل: ${num(item.reorderPoint)} ${esc(item.unit || '')}`}</div>
              </div>
              <div class="kitchen-stock-card-actions">
                <button type="button" class="kitchen-quick-btn kitchen-quick-btn--danger" data-quick-waste="${esc(item.id)}" data-unit="${esc(item.unit || '')}">
                  🗑️ ثبت ضایعات
                </button>
                <button type="button" class="kitchen-quick-btn" data-quick-count="${esc(item.id)}" data-unit="${esc(item.unit || '')}">
                  ⚖️ شمارش
                </button>
              </div>
            </article>
          `).join('') || empty('کالای انباری برای این شعبه تعریف نشده است.')}
        </div>

        <details class="inventory-action" style="margin-top: 20px;">
          <summary><b>مشاهده جدول تفصیلی انبار</b><span>افتتاحیه + گردش‌های قطعی</span></summary>
          <div class="inventory-table" role="table">
            <div class="inventory-row inventory-row--head" role="row"><span>کالا</span><span>مانده</span><span>نقطه سفارش</span><span>وضعیت</span></div>
            ${items.map((item) => `<div class="inventory-row" role="row"><span><b>${esc(item.name)}</b><small>${esc(item.sku || item.id)}</small></span><strong>${item.availableQuantity == null ? '—' : `${num(item.availableQuantity)} ${esc(item.unit || '')}`}</strong><span>${item.reorderPoint == null ? 'تعریف نشده' : `${num(item.reorderPoint)} ${esc(item.unit || '')}`}</span><i data-status="${esc(item.status)}">${esc(inventoryStatusLabel(item.status))}</i></div>`).join('') || empty('کالای انباری برای این شعبه تعریف نشده است.')}
          </div>
        </details>
      </section>

      <!-- زبانه ۳: ثبت ضایعات -->
      <section class="kitchen-panel-view ${activeTab === 'waste' ? 'is-active' : ''}" data-kinv-view="waste">
        <div class="role-section__head">
          <h2>ثبت ضایعات مواد و غذا</h2>
          <span>کالا، مقدار ضایعات و علت فیزیکی آن را ثبت فرمایید.</span>
        </div>
        <div class="inventory-action">
          <form id="inventory-waste-form" class="field-grid">
            <label class="field field--full"><span>کالا / ماده اولیه</span><select name="itemId" required><option value="">انتخاب کالا</option>${itemOptions}</select></label>
            <label class="field"><span>مقدار ضایعات</span><input name="quantity" type="number" min="0.000001" step="any" placeholder="مثلاً ۲" required></label>
            <label class="field field--full">
              <span>علت ضایعات (یک مورد را لمس کنید یا بنویسید)</span>
              <input name="reason" maxlength="300" minlength="3" required placeholder="مثلاً سوختگی در حین پخت">
              <div class="kitchen-reason-chips">
                <button type="button" class="kitchen-reason-chip" data-reason="سوختگی در حین پخت">سوختگی در پخت</button>
                <button type="button" class="kitchen-reason-chip" data-reason="خرابی و فساد اولیه بار">خرابی اولیه</button>
                <button type="button" class="kitchen-reason-chip" data-reason="انقضای تاریخ مصرف در انبار">انقضای مصرف</button>
                <button type="button" class="kitchen-reason-chip" data-reason="افت کیفی و تغییر طعم">افت کیفیت</button>
                <button type="button" class="kitchen-reason-chip" data-reason="آسیب فیزیکی حین جابجایی">آسیب جابجایی</button>
              </div>
            </label>
            <button class="role-primary field--full" type="submit">ثبت واقعیت فیزیکی ضایعات</button>
          </form>
        </div>
      </section>

      <!-- زبانه ۴: شمارش موجودی -->
      <section class="kitchen-panel-view ${activeTab === 'count' ? 'is-active' : ''}" data-kinv-view="count">
        <div class="role-section__head">
          <h2>شمارش فیزیکی قفسه</h2>
          <span>مانده واقعی موجود در سردخانه یا قفسه را وارد کنید؛ اختلاف به‌صورت خودکار محاسبه می‌شود.</span>
        </div>
        <div class="inventory-action">
          <form id="inventory-count-form" class="field-grid">
            <label class="field field--full"><span>کالا / ماده اولیه</span><select name="itemId" required><option value="">انتخاب کالا</option>${itemOptions}</select></label>
            <label class="field"><span>مقدار واقعی شمارش‌شده</span><input name="countedQuantity" type="number" min="0" step="any" placeholder="مثلاً ۱۰" required></label>
            <label class="field field--full"><span>یادداشت شمارش</span><input name="reason" maxlength="300" value="شمارش فیزیکی شیفت"></label>
            <button class="role-primary field--full" type="submit">ثبت شمارش و اختلاف</button>
          </form>
        </div>
      </section>

      <!-- زبانه ۵: آماده‌سازی پایه -->
      <section class="kitchen-panel-view ${activeTab === 'production' ? 'is-active' : ''}" data-kinv-view="production">
        <div class="role-section__head">
          <h2>آماده‌سازی روزانه و ساب‌فرمول‌ها</h2>
          <span>مصرف مواد اولیه و ثبت محصول نیمه‌آماده (سس‌ها، خمیرها، مرینیت‌ها)</span>
        </div>
        <div class="inventory-action">
          ${recipes.length ? `
            <form id="inventory-production-form" class="field-grid">
              <label class="field field--full"><span>دستور تهیه تولید</span><select name="recipeId" required><option value="">انتخاب دستور تهیه</option>${recipeOptions}</select></label>
              <label class="field"><span>بازده برنامه‌ریزی‌شده</span><input name="plannedYield" type="number" min="0.000001" step="any" required></label>
              <label class="field"><span>خروجی واقعی</span><input name="actualYield" type="number" min="0" step="any" required></label>
              <button class="role-primary field--full" type="submit">ثبت مصرف و محصول خروجی</button>
            </form>
          ` : `
            <div class="inventory-action__empty">مدیر باید کالای خروجی دستور آماده‌سازی را تعریف کند؛ سامانه آن را حدس نمی‌زند.</div>
          `}
        </div>
      </section>

      <!-- زبانه ۶: ظرفیت و تاریخچه -->
      <section class="kitchen-panel-view ${activeTab === 'capacity' ? 'is-active' : ''}" data-kinv-view="capacity">
        <div class="role-grid inventory-layout">
          <section class="role-section role-section--6">
            <div class="role-section__head"><h2>ظرفیت قابل پخت غذاها</h2><span>بر پایهٔ دستور تهیه و موجودی فعلی</span></div>
            <div class="inventory-capacity-list">
              ${capacities.slice(0, 16).map((row) => `
                <article>
                  <div>
                    <b>${esc(row.name)}</b>
                    <small>${row.version ? `نسخه ${esc(row.version)}` : 'نسخه جاری'}</small>
                  </div>
                  <strong>${row.capacity == null ? '—' : num(row.capacity)}</strong>
                  <span>${row.status === 'available' ? `ماده محدودکننده: ${esc(row.limitingIngredient?.name || '—')}` : 'دستور تهیه یا واحد ناقص'}</span>
                </article>
              `).join('') || empty('برای محاسبه ظرفیت، دستور تهیه معتبر لازم است.')}
            </div>
          </section>
          <section class="role-section role-section--6">
            <div class="role-section__head"><h2>آخرین گردش‌های ثبت‌شده</h2><span>اصلاح فقط با سند معکوس مدیر انجام می‌شود.</span></div>
            <div class="inventory-operation-list">
              ${operations.map((row) => `
                <article>
                  <div>
                    <b>${esc(inventoryStatusLabel(row.source === 'inventory.waste' ? 'ضایعات' : row.source === 'inventory.stock_count' ? 'شمارش' : row.source === 'inventory.production_batch' ? 'مرحله تولید' : row.source === 'purchase.goods_received' ? 'دریافت کالا' : 'معکوس'))}</b>
                    <small>${fmtDate(row.occurredAt)} · ${time(row.occurredAt)}</small>
                  </div>
                  <span data-status="${esc(row.status)}">${esc(inventoryStatusLabel(row.status))}</span>
                  ${row.reason ? `<p>${esc(row.reason)}</p>` : ''}
                  ${row.issues?.length ? `<p class="is-warning">${num(row.issues.length)} هشدار برای بازبینی ثبت شد.</p>` : ''}
                </article>
              `).join('') || empty('هنوز عملیاتی ثبت نشده است.')}
            </div>
          </section>
        </div>
      </section>

      <!-- زبانه ۷: دستور تهیه جدید -->
      <section class="kitchen-panel-view ${activeTab === 'recipe' ? 'is-active' : ''}" data-kinv-view="recipe">
        <div class="role-section__head">
          <h2>پیشنهاد نسخهٔ جدید دستور تهیه</h2>
          <span>مختص سرآشپز و مدیر؛ پس از ثبت نیازمند تأیید مستقل مالک است.</span>
        </div>
        <div class="inventory-action inventory-action--wide">
          ${menuItemOptions && recipeIngredientOptions ? `
            <form id="inventory-recipe-form" class="field-grid">
              <label class="field"><span>محصول واقعی منو</span><select name="menuItemId" required><option value="">انتخاب محصول فروش</option>${menuItemOptions}</select></label>
              <label class="field"><span>نام نسخه</span><input name="name" maxlength="180" placeholder="اگر خالی باشد، نام محصول استفاده می‌شود"></label>
              <label class="field"><span>تاریخ شروع اثر</span><input name="effectiveFrom" type="date" value="${today}" required></label>
              <label class="field"><span>تعداد خروجی / پرس</span><input name="yieldQuantity" type="number" min="0.000001" step="any" value="1" required></label>
              <div class="recipe-builder field--full" data-recipe-lines data-item-options="${esc(recipeIngredientOptions)}">
                <div class="recipe-builder__head"><div><b>مواد دستور تهیه</b><span>مقدار مصرفی، واحد پایه، مبنا و درصد بازده</span></div><button class="role-secondary" type="button" data-add-recipe-line>افزودن ماده</button></div>
                <div class="recipe-builder__lines"></div>
              </div>
              <div class="inventory-action__notice field--full">آشپز/انباردار فقط واقعیت فیزیکی را پیشنهاد می‌کند؛ این نسخه تا تأیید مالک وارد بهای تمام‌شده فروش نمی‌شود و قیمت یا حساب مالی در این پنل نمایش داده نمی‌شود.</div>
              <button class="role-primary field--full" type="submit">ارسال نسخه برای تأیید مالک</button>
            </form>
          ` : `
            <div class="inventory-action__empty">تا محصول واقعی منو و کالای انبار در همین شعبه وجود نداشته باشد، دستور تهیه ساخته نمی‌شود.</div>
          `}
        </div>
        <div class="role-section" style="margin-top: 20px;">
          <div class="role-section__head"><h2>نسخه‌های ثبت‌شده قبلی</h2><span>${num(summary.pendingRecipeVersions || 0)} منتظر تأیید · ${num(summary.approvedRecipeVersions || 0)} تأییدشده</span></div>
          <div class="inventory-operation-list">
            ${recipeVersions.map((row) => `
              <article>
                <div>
                  <b>${esc(row.menuItemName || row.name)}</b>
                  <small>نسخه ${num(row.version)} · شروع ${fmtDate(row.effectiveFrom)} · ${num(row.ingredients?.length || 0)} ماده</small>
                </div>
                <span data-status="${esc(row.status)}">${esc(inventoryStatusLabel(row.status))}</span>
                <p>${num(row.yieldQuantity)} پرس خروجی · ثبت‌کننده ${esc(row.createdBy || '—')}</p>
              </article>
            `).join('') || empty('هنوز نسخهٔ دستور تهیه جدیدی ثبت نشده است.')}
          </div>
        </div>
      </section>
    `;
    wireKitchenInventory();
  }

  function inventoryIdempotency(kind) {
    return `kitchen-inventory-${kind}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  const standardUnits = [
    { value: 'گرم', label: 'گرم (g)' },
    { value: 'کیلوگرم', label: 'کیلوگرم (kg)' },
    { value: 'میلی‌لیتر', label: 'میلی‌لیتر (ml)' },
    { value: 'لیتر', label: 'لیتر (l)' },
    { value: 'عدد', label: 'عدد (count)' },
    { value: 'بسته', label: 'بسته' },
    { value: 'بطری', label: 'بطری' },
    { value: 'برگ', label: 'برگ' },
    { value: 'قاشق', label: 'قاشق' },
    { value: 'قالب', label: 'قالب' },
  ];

  function rolePanelUnitOptions(selectedUnit = '') {
    return standardUnits.map((u) => {
      const isSel = u.value === selectedUnit;
      return `<option value="${esc(u.value)}"${isSel ? ' selected' : ''}>${esc(u.label)}</option>`;
    }).join('');
  }

  function wireKitchenInventory() {
    // Workflow Tabs switching
    main.querySelectorAll('.kitchen-inv-tab').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        const tabName = tabBtn.dataset.kinvTab;
        state.kitchenInvTab = tabName;
        main.querySelectorAll('.kitchen-inv-tab').forEach((b) => b.classList.toggle('is-active', b === tabBtn));
        main.querySelectorAll('.kitchen-panel-view').forEach((view) => view.classList.toggle('is-active', view.dataset.kinvView === tabName));
      });
    });

    // One-tap fill receiving line from visual cards
    main.querySelectorAll('[data-pick-receipt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const poLineVal = btn.dataset.pickReceipt;
        const qtyVal = btn.dataset.pickQty;
        const receiptForm = main.querySelector('#inventory-receipt-form');
        if (!receiptForm) return;
        receiptForm.elements.poLine.value = poLineVal;
        receiptForm.elements.receivedQuantity.value = qtyVal;
        receiptForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
        receiptForm.elements.receivedQuantity.focus();
      });
    });

    // Stock Search & Filtering
    const stockSearch = main.querySelector('#kitchen-stock-search');
    const stockCards = [...main.querySelectorAll('.kitchen-stock-card')];
    let activeCategoryFilter = 'all';
    let activeStatusFilter = 'all';

    const filterStockCards = () => {
      const query = String(stockSearch?.value || '').trim().toLowerCase();
      for (const card of stockCards) {
        const name = card.dataset.stockName || '';
        const sku = card.dataset.stockSku || '';
        const status = card.dataset.stockStatus || '';
        const matchesQuery = !query || name.includes(query) || sku.includes(query);
        const matchesCategory = activeCategoryFilter === 'all' || name.includes(activeCategoryFilter);
        const matchesStatus = activeStatusFilter === 'all' || status === activeStatusFilter;
        card.style.display = matchesQuery && matchesCategory && matchesStatus ? '' : 'none';
      }
    };

    stockSearch?.addEventListener('input', filterStockCards);
    main.querySelectorAll('#kitchen-category-filters .kitchen-filter-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        main.querySelectorAll('#kitchen-category-filters .kitchen-filter-pill').forEach((p) => p.classList.remove('is-active'));
        pill.classList.add('is-active');
        if (pill.dataset.catFilter) {
          activeCategoryFilter = pill.dataset.catFilter;
          activeStatusFilter = 'all';
        } else if (pill.dataset.statusFilter) {
          activeStatusFilter = pill.dataset.statusFilter;
          activeCategoryFilter = 'all';
        }
        filterStockCards();
      });
    });

    // Direct Action from Stock card to Waste tab
    main.querySelectorAll('[data-quick-waste]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = btn.dataset.quickWaste;
        main.querySelector('[data-kinv-tab="waste"]')?.click();
        const wasteForm = main.querySelector('#inventory-waste-form');
        if (wasteForm) {
          wasteForm.elements.itemId.value = itemId;
          wasteForm.elements.quantity.focus();
        }
      });
    });

    // Direct Action from Stock card to Count tab
    main.querySelectorAll('[data-quick-count]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = btn.dataset.quickCount;
        main.querySelector('[data-kinv-tab="count"]')?.click();
        const countForm = main.querySelector('#inventory-count-form');
        if (countForm) {
          countForm.elements.itemId.value = itemId;
          countForm.elements.countedQuantity.focus();
        }
      });
    });

    // Reason chips in waste form
    main.querySelectorAll('.kitchen-reason-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const wasteForm = main.querySelector('#inventory-waste-form');
        if (wasteForm && chip.dataset.reason) {
          wasteForm.elements.reason.value = chip.dataset.reason;
        }
      });
    });

    const recipeLines = main.querySelector('[data-recipe-lines] .recipe-builder__lines');
    const recipeItemOptions = main.querySelector('[data-recipe-lines]')?.dataset.itemOptions || '';
    const addRecipeLine = (initialData = {}) => {
      if (!recipeLines) return;
      const row = document.createElement('div');
      row.className = 'recipe-builder__line';
      const initialUnit = initialData.unit || 'کیلوگرم';
      row.innerHTML = `<label class="field"><span>کالای انبار</span><select name="ingredientItemId" required><option value="">انتخاب ماده</option>${recipeItemOptions}</select></label><label class="field"><span>مقدار</span><input name="ingredientQuantity" type="number" min="0.000001" step="any" value="${initialData.quantity || ''}" required></label><label class="field"><span>واحد</span><select name="ingredientUnit">${rolePanelUnitOptions(initialUnit)}</select></label><label class="field"><span>مبنای مقدار</span><select name="ingredientBasis"><option value="raw"${initialData.quantityBasis === 'raw' ? ' selected' : ''}>خام قبل از پاک‌کردن</option><option value="usable"${initialData.quantityBasis === 'usable' ? ' selected' : ''}>قابل مصرف</option></select></label><label class="field"><span>بازده ماده (درصد)</span><input name="ingredientYield" type="number" min="0.01" max="100" step="0.01" value="${initialData.yieldPercent || 100}" required></label><button class="recipe-builder__remove" type="button" data-remove-recipe-line aria-label="حذف ماده">×</button>`;
      recipeLines.appendChild(row);
      const itemSelect = row.querySelector('select[name="ingredientItemId"]');
      if (initialData.itemId) itemSelect.value = initialData.itemId;
      itemSelect.addEventListener('change', (event) => {
        const itemUnit = event.currentTarget.selectedOptions[0]?.dataset.unit;
        const unitSelect = row.querySelector('select[name="ingredientUnit"]');
        if (unitSelect && itemUnit) {
          const match = [...unitSelect.options].find((opt) => opt.value === itemUnit || opt.value.includes(itemUnit) || itemUnit.includes(opt.value));
          if (match) unitSelect.value = match.value;
        }
      });
      row.querySelector('[data-remove-recipe-line]').addEventListener('click', () => { if (recipeLines.children.length > 1) row.remove(); });
    };
    main.querySelector('[data-add-recipe-line]')?.addEventListener('click', () => addRecipeLine());
    if (recipeLines && recipeLines.children.length === 0) addRecipeLine();

    // When menu item is changed: pre-fill existing recipe if already present
    const recipeForm = main.querySelector('#inventory-recipe-form');
    recipeForm?.querySelector('select[name="menuItemId"]')?.addEventListener('change', (event) => {
      const selectedMenuItemId = event.currentTarget.value;
      const allRecipes = [...(state.recipeVersions || []), ...(state.recipes || [])];
      const existing = allRecipes.find((r) => String(r.menuItemId) === String(selectedMenuItemId));
      if (existing) {
        recipeForm.elements.name.value = existing.name || '';
        recipeForm.elements.yieldQuantity.value = existing.yieldQuantity || existing.servings || 1;
        if (recipeLines) {
          recipeLines.innerHTML = '';
          const ingList = Array.isArray(existing.ingredients) ? existing.ingredients : [];
          if (ingList.length) {
            ingList.forEach((ing) => addRecipeLine(ing));
          } else {
            addRecipeLine();
          }
        }
      }
    });

    const bind = (selector, endpoint, buildBody, success) => main.querySelector(selector)?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const values = Object.fromEntries(new FormData(form));
      const selected = form.elements.itemId?.selectedOptions?.[0];
      const body = { branchId: state.branchId, ...buildBody(values, selected) };
      await action(button, async () => {
        await api(endpoint, { method: 'POST', headers: { 'Idempotency-Key': inventoryIdempotency(endpoint.split('/').pop()) }, body: JSON.stringify(body) });
      }, success);
    });
    main.querySelector('#inventory-receipt-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const values = Object.fromEntries(new FormData(form));
      const [purchaseOrderId, purchaseOrderLineId] = String(values.poLine || '').split('|');
      const receivedQuantity = Number(values.receivedQuantity);
      const max = Number(form.elements.poLine.selectedOptions[0]?.dataset.max);
      if (!purchaseOrderId || !purchaseOrderLineId || !Number.isFinite(receivedQuantity) || receivedQuantity <= 0) return showToast('سفارش، ردیف و مقدار دریافت را کامل کنید.', 'error');
      if (Number.isFinite(max) && receivedQuantity > max) return showToast('مقدار دریافت از ماندهٔ سفارش بیشتر است.', 'error');
      const receivedDate = window.ShamsiDatePicker?.getISOValue(form.elements.receivedDate) || form.elements.receivedDate.dataset.isoDate || values.receivedDate;
      await action(button, async () => {
        await api('/api/kitchen/inventory/goods-receipts', {
          method: 'POST',
          headers: { 'Idempotency-Key': inventoryIdempotency('goods-receipt') },
          body: JSON.stringify({
            branchId: state.branchId,
            purchaseOrderId,
            deliveryNoteNumber: values.deliveryNoteNumber,
            receivedAt: `${receivedDate}T12:00:00.000Z`,
            notes: values.notes,
            lines: [{ purchaseOrderLineId, receivedQuantity }],
          }),
        });
      }, 'دریافت کالا ثبت شد؛ موجودی فیزیکی و اثر خودکار حسابداری به‌روزرسانی شدند.');
    });
    bind('#inventory-waste-form', '/api/kitchen/inventory/waste', (values, selected) => ({ itemId: values.itemId, quantity: Number(values.quantity), unit: selected?.dataset.unit, reason: values.reason }), 'ضایعات ثبت شد؛ اثر مالی یا مانع ارزش‌گذاری به حسابداری ارسال شد.');
    bind('#inventory-count-form', '/api/kitchen/inventory/stock-counts', (values, selected) => ({ itemId: values.itemId, countedQuantity: Number(values.countedQuantity), unit: selected?.dataset.unit, reason: values.reason }), 'شمارش فیزیکی و اختلاف آن ثبت شد.');
    bind('#inventory-production-form', '/api/kitchen/inventory/production-batches', (values) => ({ recipeId: values.recipeId, plannedYield: Number(values.plannedYield), actualYield: Number(values.actualYield) }), 'مرحله تولید و گردش مواد آن ثبت شد.');
    main.querySelector('#inventory-recipe-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const rows = [...form.querySelectorAll('.recipe-builder__line')];
      const ingredients = rows.map((row) => {
        const select = row.querySelector('[name="ingredientItemId"]');
        const unitSelect = row.querySelector('[name="ingredientUnit"]');
        return {
          itemId: select.value,
          quantity: Number(row.querySelector('[name="ingredientQuantity"]').value),
          unit: unitSelect ? unitSelect.value : (select.selectedOptions[0]?.dataset.unit || 'کیلوگرم'),
          quantityBasis: row.querySelector('[name="ingredientBasis"]').value,
          yieldPercent: Number(row.querySelector('[name="ingredientYield"]').value),
        };
      });
      if (new Set(ingredients.map((row) => row.itemId)).size !== ingredients.length) return showToast('هر کالای انبار فقط یک‌بار می‌تواند در دستور تهیه باشد.', 'error');
      const effectiveFrom = window.ShamsiDatePicker?.getISOValue(form.elements.effectiveFrom) || form.elements.effectiveFrom.dataset.isoDate || form.elements.effectiveFrom.value;
      await action(button, async () => {
        await api('/api/kitchen/inventory/recipe-versions', {
          method: 'POST', headers: { 'Idempotency-Key': inventoryIdempotency('recipe-version') },
          body: JSON.stringify({ branchId: state.branchId, menuItemId: form.elements.menuItemId.value, name: form.elements.name.value, effectiveFrom, yieldQuantity: Number(form.elements.yieldQuantity.value), ingredients }),
        });
      }, 'نسخهٔ دستور تهیه ثبت و برای تأیید مستقل مالک ارسال شد.');
    });
    main.querySelector('#inventory-production-form select[name="recipeId"]')?.addEventListener('change', (event) => {
      const planned = event.currentTarget.selectedOptions[0]?.dataset.yield;
      if (planned) event.currentTarget.form.elements.plannedYield.value = planned;
    });
  }

  const KDS_ALLERGENS = { gluten: 'گلوتن', dairy: 'لبنیات', egg: 'تخم‌مرغ', nuts: 'آجیل', peanut: 'بادام‌زمینی', soy: 'سویا', fish: 'ماهی', shellfish: 'صدف', sesame: 'کنجد' };
  const kdsStationLabel = () => 'آشپزخانه یکپارچه';

  function saveKdsLocal() {
    localStorage.setItem('westo_kds_station', JSON.stringify('kitchen'));
    localStorage.setItem('westo_kds_settings', JSON.stringify(state.kdsSettings));
  }

  function normalizeKdsSettings() {
    const current = state.kdsSettings || {};
    state.kdsSettings = {
      layout: current.layout === 'rail' ? 'rail' : 'tile',
      columns: Math.max(3, Math.min(6, Number(current.columns) || 6)),
      textSize: current.textSize === 'large' ? 'large' : 'normal',
      warnMinutes: Math.max(1, Math.min(60, Number(current.warnMinutes) || 8)),
      lateMinutes: Math.max(2, Math.min(120, Number(current.lateMinutes) || 15)),
      sound: current.sound !== false,
    };
    if (state.kdsSettings.lateMinutes <= state.kdsSettings.warnMinutes) state.kdsSettings.lateMinutes = state.kdsSettings.warnMinutes + 1;
    return state.kdsSettings;
  }

  function kdsBeep() {
    const settings = normalizeKdsSettings();
    if (!settings.sound || !state.kdsAudioArmed) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.setValueAtTime(740, context.currentTime);
      gain.gain.setValueAtTime(.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(.16, context.currentTime + .02);
      gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .2);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + .22);
      oscillator.onended = () => context.close();
    } catch { /* The visual new-ticket signal remains available. */ }
  }

  function kdsAgeLabel(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    if (value >= 24 * 60 * 60) return '+۲۴ ساعت';
    if (value >= 60 * 60) return `${num(Math.floor(value / 3600))}س ${num(Math.floor((value % 3600) / 60))}د`;
    if (value < 60) return `${num(Math.floor(value))} ثانیه`;
    const minutes = Math.floor(value / 60);
    const remainder = Math.floor(value % 60);
    return `${num(minutes)}:${String(remainder).padStart(2, '0')}`;
  }

  function kdsColumns() {
    const requested = normalizeKdsSettings().columns;
    if (innerWidth < 560) return 2;
    if (innerWidth < 900) return Math.min(3, requested);
    if (innerWidth < 1280) return Math.min(4, requested);
    return requested;
  }

  function kdsPageSize() {
    const settings = normalizeKdsSettings();
    const rows = settings.layout === 'rail' ? 1 : innerHeight >= 840 ? 3 : 2;
    return kdsColumns() * rows;
  }

  function kdsFilteredTickets(readyOnly = false) {
    const query = state.kdsSearch.trim().toLocaleLowerCase('fa');
    return (state.data.kitchen?.tickets || []).filter((ticket) => {
      if (readyOnly ? ticket.column !== 'ready' : ticket.column === 'ready') return false;
      if (state.kdsFulfillment !== 'all' && ticket.fulfillment !== state.kdsFulfillment) return false;
      if (state.kdsHighlightItem && !(ticket.items || []).some((item) => item.name === state.kdsHighlightItem && !item.completedAt)) return false;
      if (!query) return true;
      const haystack = [ticket.orderNo, ticket.tableNo, ticket.name, ticket.phone, ticket.note, ticket.kitchenNote, ...(ticket.items || []).map((item) => `${item.name} ${(item.modifiers || []).map((entry) => entry.name).join(' ')}`)].join(' ').toLocaleLowerCase('fa');
      return haystack.includes(query);
    }).sort((a, b) => Number(b.kds?.priority) - Number(a.kds?.priority) || Number(b.ageSec) - Number(a.ageSec));
  }

  function kdsHeldCourseItems(ticket) {
    const candidates = [ticket?.heldCourseItems, ticket?.heldItems, ticket?.kds?.heldCourseItems, ticket?.kds?.heldItems];
    return candidates.find((items) => Array.isArray(items) && items.length)
      || (ticket?.items || []).filter((item) => String(item.courseStatus || '').toLowerCase() === 'hold');
  }

  function kdsHeldCourseItemMarkup(item) {
    const courseLabels = { starters: 'پیش‌غذا', entrees: 'غذای اصلی', dessert: 'دسر', straight_fire: 'پخت فوری' };
    const course = courseLabels[item.course] || 'مرحلهٔ بعد';
    const modifiers = (item.modifiers || []).map((entry) => esc(entry.name)).join('، ');
    return `<div class="kds-item is-held" aria-label="${esc(item.name)}؛ در انتظار ارسال از سالن">
      <span class="kds-item__qty">${num(item.qty)}×</span><span class="kds-item__body"><b>${esc(item.name)} <span class="kds-course-tag is-hold">⏳ ${esc(course)} · منتظر اعلام سالن</span></b>${modifiers ? `<small class="kds-item__mods">${modifiers}</small>` : ''}${item.note ? `<small class="kds-item__note">${esc(item.note)}</small>` : ''}</span><span class="kds-item__check" aria-hidden="true">⏳</span>
    </div>`;
  }

  function kdsItemMarkup(item, ticket) {
    const completed = !!item.completedAt;
    const modifiers = (item.modifiers || []).map((entry) => `<span>${esc(entry.name)}</span>`).join('');
    const allergens = (item.allergens || []).map((entry) => KDS_ALLERGENS[entry] || entry).join('، ');
    const courseLabels = { starters: 'پیش‌غذا', entrees: 'غذای اصلی', dessert: 'دسر', straight_fire: 'پخت فوری' };
    const courseLabel = courseLabels[item.course] || '';
    const isHold = item.courseStatus === 'hold';
    if (isHold) return kdsHeldCourseItemMarkup(item);
    const courseTag = isHold
      ? `<span class="kds-course-tag is-hold" style="background:#fef3c7;color:#b45309;padding:1px 6px;border-radius:6px;font-size:10px;font-weight:900">⏳ ${courseLabel || 'در انتظار فراخوان'} (Hold)</span>`
      : courseLabel ? `<span class="kds-course-tag" style="background:#e0f2fe;color:#0369a1;padding:1px 6px;border-radius:6px;font-size:10px;font-weight:900">🔥 ${courseLabel}</span>` : '';
    const seatTag = Number(item.seat) > 0 ? `<span style="background:#f1f5f9;color:#475569;padding:1px 5px;border-radius:6px;font-size:9.5px;font-weight:800">ص${num(item.seat)}</span>` : '';

    return `<button class="kds-item ${completed ? 'is-complete' : ''} ${Number(item.qty) > 1 ? 'is-multi' : ''}" type="button" data-kds-item="${esc(item.key)}" data-ticket-id="${ticket.id}" data-completed="${completed}" aria-label="${completed ? 'بازگردانی' : 'تکمیل'} ${esc(item.name)}" ${state.kdsActionNeedsRefresh ? 'disabled' : ''}>
      <span class="kds-item__qty">${num(item.qty)}×</span><span class="kds-item__body"><b>${esc(item.name)} ${seatTag} ${courseTag}</b>${item.kind === 'complement' ? `<small>مکمل ${esc(item.parentName || '')}</small>` : ''}${modifiers ? `<small class="kds-item__mods">${modifiers}</small>` : ''}${item.note ? `<small class="kds-item__note">${esc(item.note)}</small>` : ''}${allergens ? `<strong class="kds-item__allergen">⚠ ${esc(allergens)}</strong>` : ''}</span><span class="kds-item__check">${completed ? '✓' : ''}</span>
    </button>`;
  }


  function kdsActionOutcome(ticket, payload) {
    if (!ticket || !payload) return false;
    const items = (ticket.items || []).filter((item) => String(item.courseStatus || '').toLowerCase() !== 'hold');
    const item = items.find((entry) => String(entry.key) === String(payload.lineKey));
    if (payload.action === 'start_ticket') return ticket.column !== 'new';
    if (payload.action === 'complete_item') return !!item?.completedAt;
    if (payload.action === 'undo_item') return !!item && !item.completedAt;
    if (payload.action === 'complete_station') {
      const stationItems = items.filter((entry) => entry.station === payload.station);
      return stationItems.length > 0 && stationItems.every((entry) => !!entry.completedAt);
    }
    if (payload.action === 'complete_ticket') return ticket.column === 'ready';
    if (payload.action === 'recall_ticket') return ticket.column === 'preparing';
    if (payload.action === 'prioritize') return !!ticket.kds?.priority === (payload.priority !== false);
    if (payload.action === 'note') return String(ticket.kitchenNote || '').trim() === String(payload.note || '').trim();
    return false;
  }

  function kdsActionRecovery(error, payload, ticket) {
    const responseError = error?.data?.error;
    const code = error?.code || (typeof responseError === 'object' ? responseError.code : responseError);
    const incomplete = Array.isArray(error?.data?.incomplete) ? error.data.incomplete.map(String) : [];
    const visibleKeys = new Set((ticket?.items || [])
      .map((item) => String(item.key)));
    kdsHeldCourseItems(ticket).forEach((item) => { if (item.key != null) visibleKeys.add(String(item.key)); });
    const hiddenIncompleteKeys = code === 'kds_ticket_incomplete' && payload?.action === 'complete_ticket' && ticket
      ? [...new Set(incomplete.filter((key) => !visibleKeys.has(key)))]
      : [];
    return {
      applied: kdsActionOutcome(ticket, payload),
      conflict: Number(error?.status) === 409,
      code,
      hiddenIncompleteKeys,
    };
  }

  function kdsShouldRefreshAfterReconnect(currentRole, reconnected, activeView) {
    return currentRole === 'kitchen' && !!reconnected && activeView !== 'inventory';
  }

  function kdsTicketMarkup(ticket, shortcut) {
    const heldItems = kdsHeldCourseItems(ticket);
    const visibleItems = (ticket.items || []).filter((item) => String(item.courseStatus || '').toLowerCase() !== 'hold');
    const hiddenHeldKeys = state.kdsHeldNotices.get(String(ticket.id)) || new Set();
    const actionBlocked = state.kdsActionNeedsRefresh;
    const allDone = visibleItems.length > 0 && visibleItems.every((item) => item.completedAt) && heldItems.length === 0;
    const stationItems = visibleItems;
    const selected = String(state.kdsSelectedTicketId || '') === String(ticket.id);
    const fulfillment = ticket.fulfillment === 'delivery' ? 'ارسال' : ticket.fulfillment === 'pickup' ? 'بیرون‌بر' : 'داخل مجموعه';
    const location = ticket.tableNo ? `میز ${ticket.tableNo}` : ticket.fulfillment === 'delivery' ? 'ارسال با پیک' : 'تحویل پیشخوان';
    const primary = ticket.column === 'ready'
      ? `<button class="kds-ticket__primary is-recall" type="button" data-kds-action="recall_ticket" data-ticket-id="${ticket.id}" ${actionBlocked ? 'disabled' : ''}>بازگردانی به صف</button>`
      : ticket.column === 'new'
        ? `<button class="kds-ticket__primary" type="button" data-kds-action="start_ticket" data-ticket-id="${ticket.id}" ${actionBlocked || visibleItems.length === 0 ? 'disabled' : ''}>${visibleItems.length ? 'شروع آماده‌سازی' : 'منتظر اعلام سالن'}</button>`
        : `<button class="kds-ticket__primary" type="button" data-kds-action="complete_ticket" data-ticket-id="${ticket.id}" ${allDone && !actionBlocked ? '' : 'disabled'}>${allDone ? 'آماده تحویل' : `منتظر ${num(stationItems.filter((item) => !item.completedAt).length + heldItems.length)} قلم`}</button>`;
    const heldNotice = hiddenHeldKeys.size
      ? `<p class="kds-note is-held-course"><b>⏳ ${num(hiddenHeldKeys.size)} قلم خارج از صف جاری</b>مرحله‌ای هنوز وارد صف پخت نشده است؛ نوبت نگه‌داشته یا تغییر هم‌زمان سفارش را با سالن بررسی کنید.</p>`
      : '';
    return `<article class="kds-ticket kds-ticket--${esc(ticket.fulfillment || 'pickup')} ${ticket.kds?.priority ? 'is-priority' : ''} ${ticket.kitchenNote ? 'needs-attention' : ''} ${selected ? 'is-selected' : ''}" data-ticket-id="${ticket.id}" data-age-sec="${Number(ticket.ageSec) || 0}" data-rendered-at="${Date.now()}" tabindex="${selected ? '0' : '-1'}" aria-selected="${selected}">
      <header class="kds-ticket__head"><div><span class="kds-shortcut">${num(shortcut)}</span><div><b>${esc(location)}</b><small>${esc(ticket.orderNo || `#${ticket.id}`)}</small></div></div><div><span>${esc(fulfillment)}</span><time data-kds-age>${kdsAgeLabel(ticket.ageSec)}</time></div></header>
      <div class="kds-ticket__meta"><span>${ticket.column === 'new' ? 'جدید' : ticket.column === 'preparing' ? 'در حال آماده‌سازی' : 'آماده'}</span>${ticket.name ? `<b>${esc(ticket.name)}</b>` : ''}${ticket.kds?.priority ? '<strong>اولویت</strong>' : ''}</div>
      <div class="kds-ticket__items">${visibleItems.map((item) => kdsItemMarkup(item, ticket)).join('')}${heldItems.map(kdsHeldCourseItemMarkup).join('')}${visibleItems.length || heldItems.length ? '' : empty('غذایی برای این ایستگاه نیست.')}</div>
      ${ticket.note ? `<p class="kds-note"><b>یادداشت سفارش</b>${esc(ticket.note)}</p>` : ''}${ticket.kitchenNote ? `<p class="kds-note is-kitchen"><b>پیام آشپزخانه</b>${esc(ticket.kitchenNote)}</p>` : ''}
      ${heldNotice}<footer class="kds-ticket__footer"><button type="button" data-kds-priority data-ticket-id="${ticket.id}" aria-label="${ticket.kds?.priority ? 'برداشتن اولویت' : 'اولویت دادن'}" ${actionBlocked ? 'disabled' : ''}>${ticket.kds?.priority ? '★' : '↑'}</button><button type="button" data-kds-note data-ticket-id="${ticket.id}" aria-label="یادداشت آشپزخانه" ${actionBlocked ? 'disabled' : ''}>✎</button>${primary}</footer>
    </article>`;
  }

  function kdsUndoMarkup() {
    if (!state.kdsUndo || Date.now() >= state.kdsUndo.expiresAt) return '';
    return `<div class="kds-undo" role="status"><span>${esc(state.kdsUndo.label)}</span><button type="button" id="kds-undo-action" ${state.kdsActionNeedsRefresh ? 'disabled' : ''}>بازگردانی</button><i style="--undo-duration:${state.kdsUndo.expiresAt - Date.now()}ms"></i></div>`;
  }

  function kdsCancellationTimeLabel(ticket) {
    if (!ticket?.cancelledAt) return 'زمان ثبت نامشخص';
    const timestamp = new Date(ticket.cancelledAt);
    if (!Number.isFinite(timestamp.getTime())) return 'زمان ثبت نامشخص';
    return timestamp.toLocaleString('fa-IR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function kdsCancelledTicketMarkup(ticket) {
    const items = [...(ticket.items || []), ...(ticket.heldCourseItems || [])];
    const location = ticket.tableNo ? `میز ${ticket.tableNo}` : ticket.fulfillment === 'delivery' ? 'ارسال با پیک' : 'تحویل پیشخوان';
    return `<article class="kds-cancelled-ticket" aria-label="سفارش لغوشده ${esc(ticket.orderNo || `شماره ${ticket.id}`)}">
      <header><strong>${esc(location)}</strong><span>${esc(ticket.orderNo || `#${ticket.id}`)}</span></header>
      <p class="kds-cancelled-ticket__time">لغو شد · ${esc(kdsCancellationTimeLabel(ticket))}</p>
      <ul>${items.map((item) => `<li><b>${num(item.qty)}×</b> ${esc(item.name)}</li>`).join('') || '<li>اقلام سفارش ثبت نشده است</li>'}</ul>
      ${ticket.note ? `<p class="kds-cancelled-ticket__note"><b>یادداشت سفارش</b>${esc(ticket.note)}</p>` : ''}
    </article>`;
  }

  function kitchenBoard(readyOnly = false) {
    const data = state.data.kitchen;
    const settings = normalizeKdsSettings();
    const filtered = kdsFilteredTickets(readyOnly);
    const cancelledTickets = data.cancelledTickets || [];
    const pageSize = kdsPageSize();
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    state.kdsPage = Math.min(state.kdsPage, pages - 1);
    const visible = filtered.slice(state.kdsPage * pageSize, (state.kdsPage + 1) * pageSize);
    const average = Number(data.performance?.averagePrepSec || 0);
    const paymentReviewCount = Math.max(0, Number(data.paymentReview?.blockedCount) || 0);
    const queueSummary = state.kdsActionNeedsRefresh
      ? 'وضعیت عملیات تأیید نشده؛ به‌روزرسانی کنید.'
      : paymentReviewCount
        ? `⚠ تطبیق پرداخت: ${num(paymentReviewCount)} · صندوق`
        : `${num(filtered.length)} سفارش · میانگین ${average ? kdsAgeLabel(average) : 'بدون سابقه'}`;
    const queueSummaryLabel = paymentReviewCount
      ? `${num(paymentReviewCount)} سفارش به دلیل وضعیت پرداخت وارد صف پخت نشده‌اند؛ برای تطبیق با صندوق پیگیری کنید.`
      : queueSummary;
    const openUnits = (data.tickets || []).filter((ticket) => ticket.column !== 'ready').reduce((sum, ticket) => sum + (ticket.items || []).filter((item) => !item.completedAt).reduce((count, item) => count + Math.max(1, Number(item.qty) || 1), 0), 0);
    main.innerHTML = `<section class="kds-shell is-${settings.layout} is-text-${settings.textSize}" style="--kds-columns:${kdsColumns()};--kds-rows:${settings.layout === 'rail' ? 1 : innerHeight >= 840 ? 3 : 2}">
      <header class="kds-command"><div class="kds-command__summary"><span class="kds-live ${state.kdsConnected ? 'is-online' : ''} ${state.kdsActionNeedsRefresh ? 'is-stale' : ''}"><i></i>${state.kdsActionNeedsRefresh ? 'صف قدیمی' : state.kdsConnected ? 'زنده' : 'در حال اتصال'}</span><strong>${readyOnly ? 'آماده تحویل' : 'صف آشپزخانه'}</strong><small class="${state.kdsActionNeedsRefresh ? 'is-stale' : paymentReviewCount ? 'is-payment-review' : ''}" aria-label="${esc(queueSummaryLabel)}" title="${esc(queueSummaryLabel)}" ${state.kdsActionNeedsRefresh ? 'role="alert"' : paymentReviewCount ? 'role="status"' : ''}>${esc(queueSummary)}</small></div>
        <div class="kds-unified-station" role="status" aria-label="صف یکپارچه آشپزخانه"><span class="kds-unified-station__icon">⌘</span><span><b>${kdsStationLabel()}</b><small>غذا · قهوه · نوشیدنی</small></span><strong>${num(openUnits)} قلم</strong></div>
        <div class="kds-command__actions"><label><span>⌕</span><input id="kds-search" value="${esc(state.kdsSearch)}" placeholder="سفارش، میز یا غذا" /></label><button type="button" id="kds-all-day">شمارش کل</button><button type="button" id="kds-availability">موجودی</button><button type="button" id="kds-settings">تنظیمات</button></div>
      </header>
      <div class="kds-subbar"><div class="kds-fulfillment">${[['all','همه'],['dine_in','سالن'],['pickup','بیرون‌بر'],['delivery','ارسال']].map(([id,label]) => `<button type="button" data-kds-fulfillment="${id}" class="${state.kdsFulfillment === id ? 'active' : ''}">${label}</button>`).join('')}</div><div class="kds-pressure"><span>جدید <b>${num(data.counts?.new || 0)}</b></span><span>در تولید <b>${num(data.counts?.preparing || 0)}</b></span><span>آماده <b>${num(data.counts?.ready || 0)}</b></span>${state.kdsHighlightItem ? `<button type="button" id="kds-clear-highlight">نمایش: ${esc(state.kdsHighlightItem)} ×</button>` : ''}</div><div class="kds-subbar__end"><button type="button" class="kds-cancelled-jump ${cancelledTickets.length ? 'has-cancellations' : ''}" id="kds-cancelled-jump" aria-controls="kds-cancelled-lane">لغوها <b>${num(cancelledTickets.length)}</b></button><div class="kds-pager"><button type="button" data-kds-page="-1" ${state.kdsPage <= 0 ? 'disabled' : ''}>→</button><span>${num(state.kdsPage + 1)} / ${num(pages)}</span><button type="button" data-kds-page="1" ${state.kdsPage >= pages - 1 ? 'disabled' : ''}>←</button></div></div></div>
      <section class="kds-ticket-grid">${visible.map((ticket, index) => kdsTicketMarkup(ticket, index + 1)).join('') || `<div class="kds-empty"><b>${readyOnly ? 'سفارش آماده‌ای نیست' : 'صف آشپزخانه خالی است'}</b><span>سفارش جدید به‌صورت زنده اینجا ظاهر می‌شود.</span></div>`}</section>
      <section class="kds-cancelled-lane" id="kds-cancelled-lane" role="region" aria-labelledby="kds-cancelled-title" tabindex="-1"><header><div><h2 id="kds-cancelled-title">لغوهای ۲۴ ساعت اخیر</h2><p>این سفارش‌ها از صف فعال خارج شده‌اند؛ اقلام لغوشده را پیش از دورریختن یا ادامهٔ آماده‌سازی بررسی کنید.</p></div><span>${num(cancelledTickets.length)} سفارش</span></header><div class="kds-cancelled-lane__list">${cancelledTickets.map(kdsCancelledTicketMarkup).join('') || '<p class="kds-cancelled-lane__empty">در ۲۴ ساعت اخیر سفارش لغوشده‌ای که به آشپزخانه رسیده باشد ثبت نشده است.</p>'}</div></section>
      <footer class="kds-shortcuts"><span id="kds-order-entry" class="kds-order-entry" aria-live="polite" hidden></span><span><kbd>شماره + ۰</kbd> انتخاب سفارش</span><span><kbd>Enter / ۰ خالی</kbd> گام بعدی</span><span><kbd>↑↓</kbd> جابه‌جایی</span><span><kbd>Ins</kbd> اولویت</span><span><kbd>*</kbd> شمارش کل</span><button type="button" id="kds-keyboard-help">راهنمای نام‌پد</button></footer>${kdsUndoMarkup()}${state.kdsAllDayOpen ? kdsAllDayDrawerMarkup(data) : ''}
    </section>`;
    wireKitchen(readyOnly, visible);
    startKdsClock();
    if (state.kdsAllDayOpen) wireKdsAllDayDrawer();
  }

  function startKdsClock() {
    clearInterval(state.kdsClockTimer);
    const update = () => {
      const settings = normalizeKdsSettings();
      main.querySelectorAll('.kds-ticket[data-age-sec]').forEach((ticket) => {
        const age = Number(ticket.dataset.ageSec || 0) + Math.floor((Date.now() - Number(ticket.dataset.renderedAt || Date.now())) / 1000);
        ticket.querySelector('[data-kds-age]').textContent = kdsAgeLabel(age);
        ticket.classList.toggle('is-fresh', age < settings.warnMinutes * 60);
        ticket.classList.toggle('is-warn', age >= settings.warnMinutes * 60 && age < settings.lateMinutes * 60);
        ticket.classList.toggle('is-late', age >= settings.lateMinutes * 60);
      });
    };
    update();
    state.kdsClockTimer = setInterval(update, 1000);
  }

  function setKdsUndo(label, orderId, payload) {
    clearTimeout(state.kdsUndoTimer);
    state.kdsUndo = { label, orderId, payload, expiresAt: Date.now() + 10000 };
    state.kdsUndoTimer = setTimeout(() => { state.kdsUndo = null; document.querySelector('.kds-undo')?.remove(); }, 10050);
  }

  async function requestKdsAction(orderId, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`/api/kitchen/orders/${orderId}`, {
        method: 'PATCH',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        signal: controller.signal,
        body: JSON.stringify({ ...payload, branchId: state.branchId }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        location.href = '/login';
        throw new Error('نشست شما تمام شده است.');
      }
      if (!response.ok) {
        const error = new Error(errorMessage(response.status, data));
        const responseError = data?.error;
        error.status = response.status;
        error.code = typeof responseError === 'object' ? responseError.code : responseError;
        error.data = data;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('پاسخ سرور طول کشید؛ نتیجه را با تازه‌سازی صف بررسی کنید.');
      throw error;
    } finally { clearTimeout(timer); }
  }

  async function runKdsAction(button, orderId, payload, success, undo = null) {
    const ticketKey = String(orderId);
    if (state.kdsActionNeedsRefresh) {
      showToast('وضعیت آخرین عملیات هنوز از سرور تأیید نشده؛ ابتدا پنل را تازه‌سازی کنید.', 'error');
      return;
    }
    if (state.kdsPendingTickets.has(ticketKey)) return;
    state.kdsPendingTickets.add(ticketKey);
    const ticket = button?.closest?.('.kds-ticket');
    ticket?.setAttribute('aria-busy', 'true');
    ticket?.querySelectorAll('button').forEach((control) => { control.disabled = true; });
    setBusy(button, true);
    try {
      await requestKdsAction(orderId, payload);
      if (undo) setKdsUndo(undo.label, orderId, undo.payload);
      showToast(success);
      try {
        await fetchKitchen();
        kitchenBoard(state.activeView === 'ready');
      } catch (refreshError) {
        state.kdsActionNeedsRefresh = true;
        kitchenBoard(state.activeView === 'ready');
        showToast('عملیات ثبت شد، اما صف تازه نشد؛ برای جلوگیری از اقدام تکراری، تا تازه‌سازی بعدی هیچ تغییری ارسال نمی‌شود.', 'error');
      }
    } catch (error) {
      let refreshed = false;
      try {
        await fetchKitchen();
        refreshed = true;
      } catch (refreshError) {
        state.kdsActionNeedsRefresh = true;
      }
      const currentTicket = (state.data.kitchen?.tickets || []).find((entry) => String(entry.id) === ticketKey);
      const recovery = kdsActionRecovery(error, payload, currentTicket);
      if (recovery.hiddenIncompleteKeys.length) {
        state.kdsHeldNotices.set(ticketKey, new Set(recovery.hiddenIncompleteKeys));
      }
      if (refreshed) kitchenBoard(state.activeView === 'ready');
      if (recovery.applied && refreshed) {
        showToast(`${success} · وضعیت از سرور تأیید شد.`);
      } else if (recovery.conflict && refreshed) {
        const heldHint = recovery.hiddenIncompleteKeys.length
          ? `؛ ${num(recovery.hiddenIncompleteKeys.length)} قلمِ خارج از صف آشکار شد، نوبت نگه‌داشته را با سالن بررسی کنید`
          : '';
        showToast(`${error.message} · صف تازه شد${heldHint}؛ پس از بررسی، در صورت نیاز دوباره اقدام کنید.`, 'error');
      } else if (refreshed) {
        showToast(`${error.message} · صف از سرور تازه شد؛ اگر وضعیت تغییر نکرده، پس از بررسی دوباره تلاش کنید.`, 'error');
      } else {
        kitchenBoard(state.activeView === 'ready');
        showToast('پاسخ عملیات و صف از سرور دریافت نشد؛ تا تازه‌سازی موفق، اقدام دیگری روی سفارش ارسال نمی‌شود.', 'error');
      }
    }
    finally {
      state.kdsPendingTickets.delete(ticketKey);
      if (button?.isConnected) setBusy(button, false);
      if (ticket?.isConnected) ticket.removeAttribute('aria-busy');
    }
  }

  function kdsAllDaySources(item, data) {
    const tickets = new Map((data?.tickets || []).map((ticket) => [String(ticket.id), ticket]));
    const sourceMap = new Map();
    (item.tickets || []).forEach((ticketId) => {
      const ticket = tickets.get(String(ticketId));
      if (!ticket) return;
      const sourceItems = (ticket.items || []).filter((line) => line.name === item.name && line.station === item.station && !line.completedAt);
      const qty = sourceItems.reduce((sum, line) => sum + Math.max(1, Number(line.qty) || 1), 0) || 1;
      const key = String(ticket.id);
      const current = sourceMap.get(key) || { ticket, qty: 0 };
      current.qty += qty;
      sourceMap.set(key, current);
    });
    return [...sourceMap.values()].sort((a, b) => String(a.ticket.orderNo || a.ticket.id).localeCompare(String(b.ticket.orderNo || b.ticket.id), 'fa'));
  }

  function kdsAllDayDrawerMarkup(data) {
    const rows = data?.allDay || [];
    const rowMarkup = rows.map((item) => {
      const sources = kdsAllDaySources(item, data);
      const sourceLabels = sources.map(({ ticket, qty }) => `${ticket.orderNo || `#${ticket.id}`}${ticket.tableNo ? ` · میز ${ticket.tableNo}` : ticket.fulfillment === 'delivery' ? ' · ارسال' : ''} · ${num(qty)} قلم`).join('، ');
      return `<button class="kds-all-day-row" type="button" data-kds-highlight="${esc(item.name)}"><span class="kds-all-day-row__mark" aria-hidden="true"></span><span class="kds-all-day-row__body"><b>${esc(item.name)} <small>· ${num(item.qty)} قلم · ${num(sources.length || item.tickets?.length || 0)} سفارش</small></b><em>${sources.length ? `از سفارش‌ها: ${esc(sourceLabels)}` : 'منبع سفارش در صف جاری قابل مشاهده نیست.'}</em></span><strong>${num(item.qty)}</strong></button>`;
    }).join('');
    return `<div class="kds-all-day-drawer__scrim" data-kds-all-day-close="true"></div><aside class="kds-all-day-drawer" role="complementary" aria-label="شمارش کل آشپزخانه"><header class="kds-all-day-drawer__head"><div><span class="kds-all-day-drawer__icon">▦</span><span><b>شمارش کل</b><small>همهٔ غذا، قهوه و نوشیدنی</small></span></div><button type="button" data-kds-all-day-close="true" aria-label="بستن شمارش کل">×</button></header><div class="kds-all-day-drawer__section"><div class="kds-all-day-drawer__section-head"><b>اقلام موجود در سفارش‌ها</b></div><div class="kds-all-day-list">${rowMarkup || empty('در صف جاری قلم بازی وجود ندارد.')}</div></div></aside>`;
  }

  function wireKdsAllDayDrawer() {
    main.querySelectorAll('[data-kds-all-day-close]').forEach((control) => control.addEventListener('click', closeKdsAllDay));
    main.querySelectorAll('[data-kds-highlight]').forEach((button) => button.addEventListener('click', () => { state.kdsHighlightItem = button.dataset.kdsHighlight; state.kdsPage = 0; closeKdsAllDay(); kitchenBoard(false); }));
  }

  function openKdsAllDay() {
    state.kdsAllDayOpen = true;
    kitchenBoard(state.activeView === 'ready');
  }

  function closeKdsAllDay() {
    state.kdsAllDayOpen = false;
    main.querySelector('.kds-all-day-drawer__scrim')?.remove();
    main.querySelector('.kds-all-day-drawer')?.remove();
  }

  function toggleKdsAllDay() {
    if (state.kdsAllDayOpen) closeKdsAllDay();
    else openKdsAllDay();
  }

  function openKdsAvailability() {
    const rows = state.data.kitchen?.availability || [];
    openDialog('دسترسی منو', 'وضعیت فروش این شعبه', `<label class="kds-dialog-search"><span>⌕</span><input id="kds-availability-search" placeholder="جست‌وجوی غذا" /></label><div class="kds-availability-list">${rows.map((item) => {
      const status = item.inventoryBlocked ? 'کمبود موجودی' : item.globallyAvailable === false ? 'غیرفعال در منوی اصلی' : item.available ? 'موجود' : 'ناموجود در این شعبه';
      const locked = item.inventoryBlocked || item.globallyAvailable === false;
      return `<button type="button" data-kds-availability-id="${item.id}" data-available="${item.manualAvailable}" aria-label="${esc(`${item.name}؛ ${status}${locked ? '؛ تغییر از این صفحه ممکن نیست' : ''}`)}" ${locked ? 'disabled title="برای تغییر، موجودی یا تنظیم منوی اصلی را بررسی کنید."' : ''}><span><b>${esc(item.name)}</b><small>${esc(item.categoryName)}</small></span><strong>${status}</strong></button>`;
    }).join('')}</div>`);
    const filter = () => { const q = document.getElementById('kds-availability-search').value.trim(); dialogBody.querySelectorAll('[data-kds-availability-id]').forEach((button) => { button.hidden = q && !button.innerText.includes(q); }); };
    document.getElementById('kds-availability-search').addEventListener('input', filter);
    dialogBody.querySelectorAll('[data-kds-availability-id]').forEach((button) => button.addEventListener('click', async () => {
      setBusy(button, true);
      try {
        await api(`/api/kitchen/items/${button.dataset.kdsAvailabilityId}/availability`, { method: 'PATCH', body: JSON.stringify({ branchId: state.branchId, available: button.dataset.available !== 'true' }) });
        await fetchKitchen();
        dialog.close();
        openKdsAvailability();
        showToast('وضعیت موجودی به‌روزرسانی شد.');
      } catch (error) { showToast(error.message, 'error'); setBusy(button, false); }
    }));
  }

  function openKdsSettings() {
    const settings = normalizeKdsSettings();
    openDialog('تنظیمات نمایشگر', 'تنظیمات این نمایشگر', `<div class="kds-settings-grid"><label><span>چیدمان</span><select id="kds-setting-layout"><option value="tile" ${settings.layout === 'tile' ? 'selected' : ''}>چیدمان فشرده · بیشترین سفارش</option><option value="rail" ${settings.layout === 'rail' ? 'selected' : ''}>چیدمان نواری · سفارش بلند</option></select></label><label><span>تعداد ستون</span><select id="kds-setting-columns">${[3,4,5,6].map((value) => `<option value="${value}" ${settings.columns === value ? 'selected' : ''}>${num(value)} ستون</option>`).join('')}</select></label><label><span>اندازه متن</span><select id="kds-setting-text"><option value="normal" ${settings.textSize === 'normal' ? 'selected' : ''}>استاندارد</option><option value="large" ${settings.textSize === 'large' ? 'selected' : ''}>درشت</option></select></label><label><span>هشدار زرد (دقیقه)</span><input id="kds-setting-warn" type="number" min="1" max="60" value="${settings.warnMinutes}" /></label><label><span>هشدار قرمز (دقیقه)</span><input id="kds-setting-late" type="number" min="2" max="120" value="${settings.lateMinutes}" /></label><label class="kds-setting-toggle"><span>صدای سفارش جدید</span><input id="kds-setting-sound" type="checkbox" ${settings.sound ? 'checked' : ''} /></label></div><button class="role-primary" id="kds-settings-save" type="button" style="width:100%;margin-top:14px">ذخیره برای این نمایشگر</button>`);
    document.getElementById('kds-settings-save').addEventListener('click', () => {
      state.kdsSettings = { layout: document.getElementById('kds-setting-layout').value, columns: Number(document.getElementById('kds-setting-columns').value), textSize: document.getElementById('kds-setting-text').value, warnMinutes: Number(document.getElementById('kds-setting-warn').value), lateMinutes: Number(document.getElementById('kds-setting-late').value), sound: document.getElementById('kds-setting-sound').checked };
      normalizeKdsSettings(); saveKdsLocal(); state.kdsPage = 0; dialog.close(); kitchenBoard(state.activeView === 'ready'); showToast('پروفایل این نمایشگر ذخیره شد.');
    });
  }

  function openKdsNote(ticket) {
    openDialog('هماهنگی آشپزخانه', 'یادداشت و درخواست هماهنگی', `<label class="field field--full"><span>پیامی که صندوق و سالن در سفارش می‌بینند</span><textarea id="kds-note-input" maxlength="240" rows="5" placeholder="مثلاً: آلرژی نیازمند تأیید، شماره پیجر اشتباه، جایگزینی دورچین…">${esc(ticket.kitchenNote || '')}</textarea></label><button class="role-primary" type="button" id="kds-note-save" style="width:100%;margin-top:12px">ثبت پیام روی سفارش</button>`);
    document.getElementById('kds-note-save').addEventListener('click', (event) => runKdsAction(event.currentTarget, ticket.id, { action: 'note', note: document.getElementById('kds-note-input').value }, 'پیام آشپزخانه ثبت شد.').then(() => dialog.close()));
  }

  function kdsTicketElements() {
    return [...main.querySelectorAll('.kds-ticket')];
  }

  function setKdsSelection(ticketOrId, focus = true) {
    const id = typeof ticketOrId === 'object' ? ticketOrId?.dataset?.ticketId : ticketOrId;
    state.kdsSelectedTicketId = id == null ? null : String(id);
    const tickets = kdsTicketElements();
    tickets.forEach((ticket) => {
      const selected = String(ticket.dataset.ticketId) === String(state.kdsSelectedTicketId || '');
      ticket.classList.toggle('is-selected', selected);
      ticket.setAttribute('aria-selected', String(selected));
      ticket.tabIndex = selected ? 0 : -1;
    });
    const selected = tickets.find((ticket) => String(ticket.dataset.ticketId) === String(state.kdsSelectedTicketId || ''));
    if (selected && focus) {
      selected.focus({ preventScroll: true });
      selected.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    return selected;
  }

  function selectKdsTicket(number) {
    const ticket = kdsTicketElements()[Number(number) - 1];
    if (!ticket) { showToast(`سفارش شمارهٔ ${num(number)} در این صفحه وجود ندارد.`); return null; }
    return setKdsSelection(ticket);
  }

  function paintKdsOrderEntry() {
    const target = document.getElementById('kds-order-entry');
    if (!target) return;
    const value = String(state.kdsOrderEntry || '');
    target.hidden = !value;
    target.textContent = value ? `ورودی سفارش: ${num(value)} · صفر برای تأیید` : '';
  }

  function clearKdsOrderEntry() {
    clearTimeout(state.kdsOrderEntryTimer);
    state.kdsOrderEntryTimer = null;
    state.kdsOrderEntry = '';
    paintKdsOrderEntry();
  }

  function commitKdsOrderEntry(value) {
    const number = Number(value);
    clearKdsOrderEntry();
    if (!Number.isSafeInteger(number) || number < 1) {
      showToast('شمارهٔ سفارش معتبر نیست.');
      return null;
    }
    return selectKdsTicket(number);
  }

  function acceptKdsOrderDigit(digit) {
    const current = String(state.kdsOrderEntry || '');
    if (digit === '0' && !current) { runSelectedKdsPrimary(); return; }
    if (digit !== '0') {
      clearTimeout(state.kdsOrderEntryTimer);
      state.kdsOrderEntryTimer = null;
      if (current.length >= 3) { showToast('شمارهٔ سفارش بیش از سه رقم نمی‌تواند باشد.'); return; }
      state.kdsOrderEntry = `${current}${digit}`;
      paintKdsOrderEntry();
      return;
    }
    const candidate = Number(`${current}0`);
    if (Number.isSafeInteger(candidate) && candidate <= kdsTicketElements().length && !current.endsWith('0')) {
      state.kdsOrderEntry = `${current}0`;
      clearTimeout(state.kdsOrderEntryTimer);
      state.kdsOrderEntryTimer = setTimeout(() => commitKdsOrderEntry(current), 900);
      paintKdsOrderEntry();
      return;
    }
    commitKdsOrderEntry(current);
  }

  function moveKdsSelection(step) {
    const tickets = kdsTicketElements();
    if (!tickets.length) return null;
    const currentIndex = tickets.findIndex((ticket) => String(ticket.dataset.ticketId) === String(state.kdsSelectedTicketId || ''));
    const nextIndex = currentIndex < 0 ? (step < 0 ? tickets.length - 1 : 0) : Math.max(0, Math.min(tickets.length - 1, currentIndex + step));
    return setKdsSelection(tickets[nextIndex]);
  }

  function changeKdsPage(step) {
    const button = main.querySelector(`[data-kds-page="${step}"]:not(:disabled)`);
    if (!button) return false;
    state.kdsSelectedTicketId = null;
    button.click();
    requestAnimationFrame(() => selectKdsTicket(1));
    return true;
  }

  function selectedKdsAction(selector) {
    const ticket = kdsTicketElements().find((entry) => String(entry.dataset.ticketId) === String(state.kdsSelectedTicketId || '')) || kdsTicketElements()[0];
    const control = ticket?.querySelector(selector);
    if (!control) { showToast('ابتدا یک سفارش را انتخاب کنید.'); return null; }
    return control;
  }

  function runSelectedKdsPrimary() {
    const ticket = kdsTicketElements().find((entry) => String(entry.dataset.ticketId) === String(state.kdsSelectedTicketId || '')) || kdsTicketElements()[0];
    const ticketAction = ticket?.querySelector('[data-kds-action]');
    // In a unified kitchen queue, Enter/0 is a repeatable hands-free workflow:
    // start the order, complete its next unfinished line, then release it.
    // This means the operator never needs a mouse just to mark each line.
    if (ticketAction?.dataset.kdsAction === 'complete_ticket') {
      const nextItem = ticket.querySelector('[data-kds-item][data-completed="false"]');
      if (nextItem) { nextItem.click(); return; }
    }
    const action = selectedKdsAction('[data-kds-action]:not(:disabled)');
    if (!action) {
      if (ticket?.querySelector('[data-kds-action]:disabled')) showToast('برای آماده‌تحویل شدن، همهٔ اقلام سفارش را تکمیل کنید.');
      return;
    }
    action.click();
  }

  function clearKdsSearchAndHighlight() {
    state.kdsSearch = '';
    state.kdsHighlightItem = '';
    state.kdsPage = 0;
    kitchenBoard(state.activeView === 'ready');
  }

  function openKdsKeyboardHelp() {
    const rows = [
      ['Num Lock', 'حالت عددی نام‌پد'], ['۱–۹', 'شروع ورود شمارهٔ سفارش'], ['شماره + ۰', 'تأیید شماره؛ مثال ۱،۲،۰ یعنی سفارش ۱۲'],
      ['۰ خالی / Enter', 'گام بعدی سفارش انتخاب‌شده'], ['Tab / ↑↓', 'سفارش قبلی یا بعدی'], ['Home / End', 'اولین یا آخرین سفارش صفحه'],
      ['PageUp / PageDown', 'صفحهٔ قبل یا بعد'], ['Backspace / Delete', 'پاک‌کردن جست‌وجو و انتخاب'], ['Ins', 'اولویت سفارش'],
      ['. / Delete', 'بازگردانی آخرین عملیات / پاک‌کردن جست‌وجو'], ['/', 'به‌روزرسانی صف'], ['*', 'شمارش کل سفارش‌ها'], ['− / +', 'آماده‌تحویل / صف اصلی'],
    ];
    openDialog('کار با نمایشگر آشپزخانه', 'راهنمای کامل نام‌پد Genius', `<p class="kds-keyboard-intro">برای سفارش‌های دو رقمی، رقم‌ها را پشت‌سرهم بزنید و در پایان صفر را بزنید؛ مثلاً ۱،۲،۰ سفارش ۱۲ را انتخاب می‌کند.</p><div class="kds-keyboard-help">${rows.map(([key, action]) => `<div><kbd>${esc(key)}</kbd><span>${esc(action)}</span></div>`).join('')}</div>`);
  }

  function wireKitchen(readyOnly, visible) {
    main.querySelector('#kds-cancelled-jump')?.addEventListener('click', () => {
      const lane = document.getElementById('kds-cancelled-lane');
      lane?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      lane?.focus({ preventScroll: true });
    });
    main.querySelectorAll('[data-kds-fulfillment]').forEach((button) => button.addEventListener('click', () => { state.kdsFulfillment = button.dataset.kdsFulfillment; state.kdsPage = 0; kitchenBoard(readyOnly); }));
    main.querySelectorAll('[data-kds-page]').forEach((button) => button.addEventListener('click', () => { state.kdsPage += Number(button.dataset.kdsPage); kitchenBoard(readyOnly); }));
    document.getElementById('kds-all-day')?.addEventListener('click', openKdsAllDay);
    document.getElementById('kds-availability')?.addEventListener('click', openKdsAvailability);
    document.getElementById('kds-settings')?.addEventListener('click', openKdsSettings);
    document.getElementById('kds-keyboard-help')?.addEventListener('click', openKdsKeyboardHelp);
    document.getElementById('kds-clear-highlight')?.addEventListener('click', () => { state.kdsHighlightItem = ''; kitchenBoard(readyOnly); });
    const search = document.getElementById('kds-search');
    let searchTimer = null;
    search?.addEventListener('input', () => { state.kdsSearch = search.value; clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.kdsPage = 0; kitchenBoard(readyOnly); document.getElementById('kds-search')?.focus(); }, 180); });
    main.querySelectorAll('[data-kds-item]').forEach((button) => button.addEventListener('click', () => {
      setKdsSelection(button.closest('.kds-ticket'), false);
      const completed = button.dataset.completed === 'true';
      runKdsAction(button, button.dataset.ticketId, { action: completed ? 'undo_item' : 'complete_item', lineKey: button.dataset.kdsItem }, completed ? 'غذا به صف برگشت.' : 'غذا تکمیل شد.', completed ? null : { label: 'غذا تکمیل شد؛ اشتباه بود؟', payload: { action: 'undo_item', lineKey: button.dataset.kdsItem } });
    }));
    main.querySelectorAll('[data-kds-action]').forEach((button) => button.addEventListener('click', () => {
      setKdsSelection(button.closest('.kds-ticket'), false);
      const actionName = button.dataset.kdsAction;
      const payload = { action: actionName };
      if (actionName === 'complete_station') payload.station = button.dataset.station;
      runKdsAction(button, button.dataset.ticketId, payload, actionName === 'start_ticket' ? 'آماده‌سازی شروع شد.' : actionName === 'recall_ticket' ? 'سفارش به صف برگشت.' : actionName === 'complete_station' ? 'کار این ایستگاه تکمیل شد.' : 'سفارش آماده تحویل است.', actionName === 'complete_ticket' ? { label: 'سفارش آماده شد؛ اشتباه بود؟', payload: { action: 'recall_ticket' } } : null);
    }));
    main.querySelectorAll('[data-kds-priority]').forEach((button) => button.addEventListener('click', () => { const ticket = visible.find((entry) => String(entry.id) === String(button.dataset.ticketId)); setKdsSelection(button.closest('.kds-ticket'), false); runKdsAction(button, button.dataset.ticketId, { action: 'prioritize', priority: !ticket?.kds?.priority }, ticket?.kds?.priority ? 'اولویت برداشته شد.' : 'سفارش به ابتدای صف منتقل شد.', ticket?.kds?.priority ? null : { label: 'سفارش اولویت گرفت.', payload: { action: 'prioritize', priority: false } }); }));
    main.querySelectorAll('[data-kds-note]').forEach((button) => button.addEventListener('click', () => { const ticket = visible.find((entry) => String(entry.id) === String(button.dataset.ticketId)); if (ticket) openKdsNote(ticket); }));
    document.getElementById('kds-undo-action')?.addEventListener('click', async (event) => { const undo = state.kdsUndo; if (!undo || state.kdsActionNeedsRefresh) return; clearTimeout(state.kdsUndoTimer); state.kdsUndo = null; await runKdsAction(event.currentTarget, undo.orderId, undo.payload, 'عملیات بازگردانده شد.'); });
  }

  function handleKdsShortcut(event) {
    if (role !== 'kitchen' || state.activeView === 'inventory') return;
    if (event.key === 'Escape' && dialog.open) { event.preventDefault(); dialog.close(); return; }
    if (dialog.open || /INPUT|TEXTAREA|SELECT/.test(event.target?.tagName || '') || event.target?.isContentEditable) return;
    const code = String(event.code || '');
    const key = String(event.key || '');
    if (code === 'NumpadMultiply' || key === '*') { event.preventDefault(); toggleKdsAllDay(); return; }
    if (event.target?.closest?.('button, a') && event.key !== 'Escape') return;
    const latinKey = key.replace(/[۰-۹]/g, (char) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(char)));
    const digit = /^Numpad([0-9])$/.exec(code) || /^Digit([0-9])$/.exec(code);
    const physicalDigit = digit && /^[0-9]$/.test(latinKey);
    const actionKey = ['Enter', 'NumpadEnter', 'Numpad0', 'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide', 'NumpadDecimal', 'Insert', 'Delete'].includes(code);
    if (event.repeat && actionKey) return;
    if (physicalDigit) { event.preventDefault(); acceptKdsOrderDigit(digit[1]); return; }
    if ((code === 'Numpad0' && key === '0') || code === 'NumpadEnter' || (key === 'Enter' && !event.shiftKey)) { event.preventDefault(); runSelectedKdsPrimary(); return; }
    if (code === 'NumpadDecimal' && key !== 'Delete') { event.preventDefault(); const undoButton = document.getElementById('kds-undo-action'); if (undoButton) undoButton.click(); else showToast('عملیات قابل بازگردانی وجود ندارد.'); return; }
    if ((code === 'Numpad0' && key === 'Insert') || key === 'Insert') { event.preventDefault(); selectedKdsAction('[data-kds-priority]')?.click(); return; }
    if (code === 'NumpadDecimal' && key === 'Delete') { event.preventDefault(); clearKdsSearchAndHighlight(); return; }
    if (code === 'Numpad7' && key === 'Home' || key === 'Home') { event.preventDefault(); selectKdsTicket(1); return; }
    if (code === 'Numpad1' && key === 'End' || key === 'End') { event.preventDefault(); const tickets = kdsTicketElements(); if (tickets.length) setKdsSelection(tickets[tickets.length - 1]); return; }
    if (key === 'ArrowUp' || key === 'ArrowLeft') { event.preventDefault(); key === 'ArrowLeft' ? changeKdsPage(-1) : moveKdsSelection(-1); return; }
    if (key === 'ArrowDown' || key === 'ArrowRight') { event.preventDefault(); key === 'ArrowRight' ? changeKdsPage(1) : moveKdsSelection(1); return; }
    if (key === 'PageUp') { event.preventDefault(); changeKdsPage(-1); return; }
    if (key === 'PageDown') { event.preventDefault(); changeKdsPage(1); return; }
    if (key === 'Tab') { event.preventDefault(); moveKdsSelection(event.shiftKey ? -1 : 1); return; }
    if (key === 'Backspace' || key === 'Delete' || key === 'Clear') { event.preventDefault(); clearKdsSearchAndHighlight(); return; }
    if (code === 'NumpadDivide' || key === 'r' || key === 'R') { event.preventDefault(); render(); return; }
    if (key === 'a' || key === 'A' || code === 'Calculator') { event.preventDefault(); toggleKdsAllDay(); return; }
    if (code === 'NumpadSubtract' || key === '-') { event.preventDefault(); state.activeView = 'ready'; paintNav(); render(); return; }
    if (code === 'NumpadAdd' || key === '+') { event.preventDefault(); state.activeView = 'board'; paintNav(); render(); return; }
    if (code === 'NumLock') { state.kdsNumLock = key === 'NumLock' ? !state.kdsNumLock : null; showToast(state.kdsNumLock === false ? 'حالت حرکتی نام‌پد فعال شد.' : 'حالت عددی نام‌پد فعال شد.'); }
  }

  async function render() {
    const waiterRenderRequestId = role === 'waiter'
      ? state.waiterRenderRequestId = (state.waiterRenderRequestId || 0) + 1
      : null;
    const waiterBranchId = role === 'waiter' ? state.branchId : null;
    const waiterBranchGeneration = role === 'waiter' ? (state.waiterBranchGeneration || 0) : null;
    const isCurrentWaiterRender = () => role !== 'waiter'
      || (waiterRenderRequestId === state.waiterRenderRequestId
        && waiterBranchGeneration === (state.waiterBranchGeneration || 0)
        && String(waiterBranchId ?? '') === String(state.branchId ?? ''));
    clearFloorCountdown();
    if (role === 'waiter') clearRoleHeaderContext();
    document.getElementById('role-app').setAttribute('aria-busy', 'true');
    try {
      if (!isViewFeatureEnabled(state.activeView)) {
        main.innerHTML = `${pageHead('قابلیت غیرفعال', 'دسترسی محدود شده است', 'این بخش توسط کنترل‌پلن سالسا (SALSA) برای این مجموعه غیرفعال شده است.')}
          <section class="role-section">
            <div class="empty-state" style="padding:48px 24px; text-align:center;">
              <div style="font-size:48px; margin-bottom:16px;">🔒</div>
              <h2 style="font-size:18px; font-weight:700; margin-bottom:8px; color:var(--text, #f8fafc);">این بخش توسط کنترل‌پلن سالسا (SALSA) غیرفعال شده است</h2>
              <p style="color:var(--muted, #94a3b8); max-width:440px; margin:0 auto 20px; font-size:13px; line-height:1.7;">
                برای دسترسی و فعال‌سازی این بخش، قابلیت مربوطه را در مرکز کنترل سالسا (پورت ۳۰۵۰) فعال نمایید.
              </p>
            </div>
          </section>`;
        return;
      }
      if (role === 'cashier') {
        await fetchCashier();
        if (state.activeView === 'floor') cashierFloor();
        else if (state.activeView === 'orders') cashierRegister();
        else if (state.activeView === 'transactions') cashierTransactions();
        else if (state.activeView === 'drawer') cashierDrawer();
        else cashierMenu();
      }
      if (role === 'waiter') {
        const snapshotLoaded = await fetchWaiter();
        if (!snapshotLoaded || !isCurrentWaiterRender()) return;
        if (state.activeView === 'calls') waiterCalls();
        else if (state.activeView === 'orders') waiterOrders();
        else if (state.activeView === 'reservations') waiterReservations();
        else waiterFloor();
      }
      if (role === 'kitchen') {
        if (state.activeView === 'inventory') { await fetchKitchenInventory(); kitchenInventoryPage(); }
        else { await fetchKitchen(); kitchenBoard(state.activeView === 'ready'); }
      }
    } catch (error) {
      if (!isCurrentWaiterRender()) return;
      main.innerHTML = `${pageHead('خطا', 'فضای کاری بارگذاری نشد', error.message)}<section class="role-section">${empty(error.message)}<button class="role-primary" id="retry" style="margin-top:12px">تلاش دوباره</button></section>`;
      document.getElementById('retry')?.addEventListener('click', render);
    } finally {
      if (isCurrentWaiterRender()) document.getElementById('role-app').setAttribute('aria-busy', 'false');
    }
  }

  let waiterAudioElement = null;

  function initWaiterAudio() {
    if (!waiterAudioElement && typeof Audio !== 'undefined') {
      try {
        waiterAudioElement = new Audio('/assets/audio/waiter-chime.wav');
        waiterAudioElement.preload = 'auto';
      } catch (e) {}
    }
  }

  function armWaiterAudio() {
    state.waiterAudioArmed = true;
    initWaiterAudio();
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx && !state.audioCtx) {
        state.audioCtx = new AudioCtx();
      }
      if (state.audioCtx && state.audioCtx.state === 'suspended') {
        state.audioCtx.resume();
      }
    } catch (e) {}
    const soundChip = document.getElementById('floor-chip-sound');
    if (soundChip) {
      soundChip.className = 'floor-metric-chip floor-chip--sound is-sound-active';
      soundChip.title = 'صدای اعلان زنگ فعال است (لمس برای تست صدا)';
      soundChip.innerHTML = '<span>🔊</span><small>صدای فعال</small>';
    }
  }

  function playWaiterCallChime() {
    armWaiterAudio();

    // 1. Try HTML5 Audio element first
    if (waiterAudioElement) {
      try {
        waiterAudioElement.currentTime = 0;
        const playPromise = waiterAudioElement.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {});
        }
      } catch (e) {}
    }

    // 2. Synthesize crystal-clear chime with Web Audio API
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = state.audioCtx || (state.audioCtx = new AudioCtx());
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const now = ctx.currentTime;

      // Note 1: A5 (880Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now);
      gain1.gain.setValueAtTime(0.22, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.35);

      // Note 2: D5 (587.33Hz)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(587.33, now + 0.28);
      gain2.gain.setValueAtTime(0.28, now + 0.28);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.28);
      osc2.stop(now + 0.9);
    } catch (e) {}
  }

  function startWaiterLiveSync() {
    if (state.waiterLiveSyncTimer) clearInterval(state.waiterLiveSyncTimer);
    state.waiterLiveSyncTimer = setInterval(async () => {
      if (role !== 'waiter' || state.waiterFloorEditing) return;
      const requestedBranchId = state.branchId;
      const requestedBranchGeneration = state.waiterBranchGeneration || 0;
      const isCurrentBranch = () => String(state.branchId ?? '') === String(requestedBranchId ?? '')
        && (state.waiterBranchGeneration || 0) === requestedBranchGeneration;
      try {
        const branchParam = requestedBranchId ? `?branchId=${encodeURIComponent(requestedBranchId)}` : '';
        const callsData = await api(`/api/waiter/calls${branchParam}`);
        if (!isCurrentBranch()) return;
        const currentCalls = callsData?.calls || [];
        const currentKeys = currentCalls.map((c) => `${c.id}:${c.status}:${c.tableNo}:${ageMin(c.createdAt)}`).join('|');

        if (!state.lastWaiterCallsKey) {
          state.lastWaiterCallsKey = currentKeys;
          state.knownCallIds = new Set(currentCalls.map((c) => c.id));
          return;
        }

        if (currentKeys !== state.lastWaiterCallsKey) {
          const hasNewCall = currentCalls.some((c) => !state.knownCallIds?.has(c.id));
          state.lastWaiterCallsKey = currentKeys;
          state.knownCallIds = new Set(currentCalls.map((c) => c.id));

          if (hasNewCall) {
            playWaiterCallChime();
          }

          const snapshotLoaded = await fetchWaiter();
          if (snapshotLoaded && isCurrentBranch()) {
            if (dialog.open) state.waiterRefreshPending = true;
            else refreshWaiterViewAfterSync();
          }
        }
      } catch (e) {}
    }, 1500);
  }

  function applyLatestWaiterOrder(wt, latest) {
    wt.order = JSON.parse(JSON.stringify(latest));
    wt.checkNo = wt.order?.checkNo || wt.order?.tableNo || wt.checkNo;
    wt.covers = Math.max(1, Number(wt.order?.covers) || Number(wt.covers) || 1);
    wt.seatsCount = Math.max(wt.covers, highestWaiterAssignedSeat(wt.order?.items || []), 1);
    wt.lines = (wt.order?.items || []).map((line, index) => ({
      ...JSON.parse(JSON.stringify(line)),
      localId: line.localId || `saved-${wt.order.id}-${index}`,
      localSaved: true,
    }));
    wt.guestName = wt.order?.name || '';
    wt.guestPhone = wt.order?.phone || '';
    wt.note = wt.order?.note || '';
    wt.dirty = false;
    wt.remoteUpdatePending = false;
  }

  function refreshWaiterViewAfterSync() {
    const wt = state.waiterTerminal;
    if (wt) {
      const latest = wt.order?.id
        ? state.data.orders.find((order) => Number(order.id) === Number(wt.order.id))
        : null;
      if (!latest) return;
      const clearedUncertainEdit = Boolean(wt.orderSaveNeedsRefresh && !wt.pendingOrderSubmission);
      if (clearedUncertainEdit) {
        // A read confirms the current snapshot, but an ambiguous PATCH has no safe replay contract.
        // Keep the reconciliation lock and only clear the "needs refresh" indicator.
        wt.orderSaveNeedsRefresh = false;
        persistWaiterTerminalDraft(wt);
      }
      const unchanged = waiterOrderDraftSignature(latest) === waiterOrderDraftSignature(wt.order);
      if (unchanged) {
        if (wt.serveNeedsRefresh || clearedUncertainEdit) {
          if (wt.serveNeedsRefresh) wt.serveNeedsRefresh = false;
          renderWaiterTerminal();
        }
        return;
      }
      if (waiterTerminalHasUnsentWork(wt)) {
        if (!wt.remoteUpdatePending) {
          wt.remoteUpdatePending = true;
          renderWaiterTerminal();
          showToast('سفارش در دستگاه دیگری تغییر کرده؛ پیش‌نویس شما حفظ شد.', 'warning');
        }
        return;
      }
      if (wt.serveNeedsRefresh) wt.serveNeedsRefresh = false;
      applyLatestWaiterOrder(wt, latest);
      renderWaiterTerminal();
      return;
    }
    if (state.activeView === 'floor') waiterFloor();
    else if (state.activeView === 'calls') waiterCalls();
    else if (state.activeView === 'orders') waiterOrders();
    else if (state.activeView === 'reservations') waiterReservations();
  }

  function startStream() {
    state.stream?.close();
    if (!window.EventSource) return;
    if (role === 'kitchen') state.kdsConnected = false;
    state.stream = new EventSource(`/api/admin/events${qs()}`);
    let timer = null;
    const schedule = (immediate = false) => {
      clearTimeout(timer);
      const delay = immediate ? 0 : 150;
      timer = setTimeout(async () => {
        if (role === 'waiter' && dialog.open) {
          state.waiterRefreshPending = true;
          return;
        }
        if (!dialog.open && !state.waiterFloorEditing) {
          if (role === 'waiter') {
            const branchId = state.branchId;
            const branchGeneration = state.waiterBranchGeneration || 0;
            const snapshotLoaded = await fetchWaiter();
            if (snapshotLoaded && String(state.branchId ?? '') === String(branchId ?? '')
              && (state.waiterBranchGeneration || 0) === branchGeneration) refreshWaiterViewAfterSync();
          } else {
            render();
          }
        }
      }, delay);
    };

    if (role === 'waiter') {
      if (state.waiterDialogRefreshListener) dialog.removeEventListener('close', state.waiterDialogRefreshListener);
      state.waiterDialogRefreshListener = () => {
        if (!state.waiterRefreshPending) return;
        state.waiterRefreshPending = false;
        const branchId = state.branchId;
        const branchGeneration = state.waiterBranchGeneration || 0;
        fetchWaiter().then((snapshotLoaded) => {
          if (snapshotLoaded && String(state.branchId ?? '') === String(branchId ?? '')
            && (state.waiterBranchGeneration || 0) === branchGeneration) refreshWaiterViewAfterSync();
        }).catch((error) => showToast(`پنجره بسته شد، اما تازه‌سازی وضعیت انجام نشد: ${error.message}`, 'warning'));
      };
      dialog.addEventListener('close', state.waiterDialogRefreshListener);
    }

    if (role === 'kitchen') {
      if (state.kdsDialogRefreshListener) dialog.removeEventListener('close', state.kdsDialogRefreshListener);
      state.kdsDialogRefreshListener = () => {
        if (!state.kdsRefreshPending) return;
        state.kdsRefreshPending = false;
        if (state.activeView !== 'inventory') schedule(true);
      };
      dialog.addEventListener('close', state.kdsDialogRefreshListener);
    }

    state.stream.addEventListener('open', () => {
      const reconnected = !state.kdsConnected;
      state.kdsConnected = true;
      document.querySelector('.kds-live')?.classList.add('is-online');
      const label = document.querySelector('.kds-live');
      if (label) label.lastChild.textContent = 'زنده';
      if (kdsShouldRefreshAfterReconnect(role, reconnected, state.activeView)) {
        if (dialog.open) state.kdsRefreshPending = true;
        else schedule(true);
      }
    });

    state.stream.addEventListener('error', () => {
      state.kdsConnected = false;
      document.querySelector('.kds-live')?.classList.remove('is-online');
      const label = document.querySelector('.kds-live');
      if (label) label.lastChild.textContent = 'اتصال مجدد';
    });

    ['order.created', 'order.updated', 'waiter_call.created', 'waiter_call.updated', 'waitlist.created', 'waitlist.updated', 'menu.availability_updated', 'inventory.updated'].forEach((eventName) => {
      state.stream.addEventListener(eventName, () => {
        if (eventName === 'waiter_call.created' && role === 'waiter') {
          playWaiterCallChime();
          schedule(true);
        } else if ((eventName === 'waiter_call.updated' || eventName === 'waitlist.created' || eventName === 'waitlist.updated') && role === 'waiter') {
          schedule(true);
        } else {
          schedule(false);
        }
      });
    });
  }


  function handlePosShortcut(event) {
    if (role !== 'cashier') return;
    const activeEl = document.activeElement;
    const isEditingText = activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA';

    if (event.key === 'F2') {
      event.preventDefault();
      const search = document.getElementById('pos-search');
      if (search) {
        search.focus();
        search.select();
      } else {
        openNewCheck();
      }
      return;
    }
    if (event.key === 'F4') {
      event.preventDefault();
      document.getElementById('pos-pay')?.click();
      return;
    }
    if (event.key === 'F8') {
      event.preventDefault();
      const printBtn = document.getElementById('pos-print');
      if (printBtn && !printBtn.disabled) {
        printBtn.click();
      } else if (state.posCheck) {
        openThermalReceiptPreview(state.posCheck);
      }
      return;
    }
    if (event.key === ' ' && !isEditingText && !dialog.open) {
      const sendBtn = document.getElementById('pos-send');
      if (sendBtn && !sendBtn.disabled) {
        event.preventDefault();
        sendBtn.click();
        return;
      }
    }
    if (event.key === '/' && !isEditingText) {
      event.preventDefault();
      const search = document.getElementById('pos-search');
      if (search) {
        search.focus();
        search.select();
      }
      return;
    }
    if (event.key === 'Escape') {
      if (dialog.open) { dialog.close(); return; }
      if (state.posSearch) { state.posSearch = ''; cashierMenu(); return; }
      if (state.posCategory) { state.posCategory = null; cashierMenu(); return; }
    }
  }

  async function boot() {
    if (!allowedRoles.has(role)) { location.replace('/admin'); return; }
    try {
      await loadSession();
      await loadFeatures();
      paintNav();
      document.getElementById('role-shift').addEventListener('click', toggleShift);
      document.getElementById('role-refresh').addEventListener('click', render);
      document.getElementById('role-user').addEventListener('click', openActiveUserDialog);
      dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
      dialog.addEventListener('close', () => { state.cart.clear(); if (!state.posCheck) state.pendingPosItem = null; });
      dialog.addEventListener('click', async (event) => { if (event.target.id === 'role-logout') { await api('/api/auth/logout', { method: 'POST' }); location.href = '/login'; } });
      if (role === 'cashier') {
        document.addEventListener('keydown', handlePosShortcut);
      }
      if (role === 'kitchen') {
        document.addEventListener('keydown', handleKdsShortcut);
        document.addEventListener('pointerdown', () => { state.kdsAudioArmed = true; }, { once: true });
      }
      if (role === 'waiter') {
        initWaiterAudio();
        ['pointerdown', 'touchstart', 'click', 'keydown'].forEach((evt) => {
          document.addEventListener(evt, armWaiterAudio, { passive: true });
        });
        startWaiterLiveSync();
      }
      startStream();
      await render();
      let resizeTimer = null;
      window.addEventListener('resize', () => {
        if (role === 'kitchen' && state.activeView !== 'inventory' && !dialog.open) {
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => kitchenBoard(state.activeView === 'ready'), 120);
          return;
        }
        if (role !== 'cashier' || state.activeView !== 'menu' || dialog.open) return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (state.activeView !== 'menu' || dialog.open) return;
          cashierMenu();
        }, 120);
      });
      window.addEventListener('pagehide', () => {
        state.stream?.close();
        clearInterval(state.kdsClockTimer);
        clearInterval(state.waiterLiveSyncTimer);
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          if (!state.stream || state.stream.readyState === 2) {
            startStream();
          }
          if (role === 'waiter') {
            const branchId = state.branchId;
            const branchGeneration = state.waiterBranchGeneration || 0;
            fetchWaiter().then((snapshotLoaded) => {
              if (snapshotLoaded && String(state.branchId ?? '') === String(branchId ?? '')
                && (state.waiterBranchGeneration || 0) === branchGeneration) {
                if (dialog.open) state.waiterRefreshPending = true;
                else if (!state.waiterFloorEditing) refreshWaiterViewAfterSync();
              }
            });
          } else {
            render();
          }
        }
      });

    } catch (error) {
      main.innerHTML = `${pageHead('دسترسی', 'امکان ورود به این پنل نیست', error.message)}<section class="role-section">${empty(error.message)}<a class="role-secondary" href="/admin">بازگشت به مدیریت</a></section>`;
    }
  }

  boot();
})();
