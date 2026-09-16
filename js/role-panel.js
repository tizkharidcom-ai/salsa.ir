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
  const normalizeDigits = (val) => String(val ?? '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const state = {
    session: null, branchId: null, activeView: '', data: {}, menuItems: [], menuCategories: [], menuComplements: [], menuComplementRules: [],
    features: {},
    cart: new Map(), stream: null, posCategory: null, posCheck: null, posSearch: '', pendingPosItem: null,
    floorZone: 'all', floorCountdownTimer: null,
    // The kitchen display is intentionally one queue. The API still keeps the
    // original item station for costing/reporting, but operators should never
    // have to switch between hot, cold, bar or expo panels.
    kdsStation: 'kitchen', kdsFulfillment: 'all', kdsSearch: '', kdsPage: 0, kdsSelectedTicketId: null, kdsOrderEntry: '', kdsOrderEntryTimer: null, kdsNumLock: null,
      kdsSettings: readLocal('westo_kds_settings', { layout: 'tile', columns: 6, textSize: 'normal', warnMinutes: 8, lateMinutes: 15, sound: true }),
    kdsUndo: null, kdsUndoTimer: null, kdsClockTimer: null, kdsLastOpenCount: null, kdsAudioArmed: false, kdsConnected: false, kdsHighlightItem: '', kdsAllDayOpen: false, kdsPendingTickets: new Set(),
    printer: null,
  };
  let toastTimer = null;

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
      cashier_transition_invalid: 'این تغییر وضعیت برای صندوق مجاز نیست.', waiter_transition_invalid: 'این تغییر وضعیت برای گارسون مجاز نیست.',
      kitchen_transition_invalid: 'این تغییر وضعیت در آشپزخانه مجاز نیست.',
      kds_item_invalid: 'این قلم دیگر در سفارش فعال نیست.', kds_station_invalid: 'ایستگاه انتخاب‌شده معتبر نیست.',
      kds_station_empty: 'این سفارش قلمی برای ایستگاه انتخاب‌شده ندارد.', kitchen_recall_invalid: 'این سفارش در وضعیت قابل بازگردانی نیست.',
      kds_ticket_incomplete: 'تا وقتی همهٔ اقلام تکمیل نشده‌اند، سفارش آماده نمی‌شود.',
      order_edit_locked: 'آشپزخانه آماده‌سازی را شروع کرده؛ ویرایش این سفارش قفل شده است.',
      order_edit_refund_required: 'مبلغ جدید از پرداخت ثبت‌شده کمتر است؛ ابتدا بازپرداخت را ثبت کنید.',
      order_edit_branch_mismatch: 'این سفارش متعلق به شعبه فعال نیست.',
      order_split_locked: 'این فاکتور پرداخت شده و دیگر قابل تفکیک نیست.',
      split_mode_invalid: 'نوع تفکیک فاکتور معتبر نیست.',
      table_not_found: 'میز مقصد در شعبه فعال پیدا نشد.',
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
    if (code === 'feature_disabled') return message || 'این بخش توسط کنترل‌پلن NEEM غیرفعال شده است.';
    return map[code] || message || code || `خطای ارتباط با سرور (${status})`;
  }

  async function api(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const headers = new Headers(options.headers || {});
      headers.set('Accept', 'application/json');
      if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      const response = await fetch(url, { ...options, headers, credentials: 'same-origin', signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { location.href = '/login'; throw new Error('نشست شما تمام شده است.'); }
      if (!response.ok) throw new Error(errorMessage(response.status, data));
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('پاسخ سرور طول کشید؛ اتصال را بررسی کنید.');
      throw error;
    } finally { clearTimeout(timer); }
  }

  function showToast(message, type = '') {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.className = `role-toast show ${type}`;
    toastTimer = setTimeout(() => { toast.className = 'role-toast'; }, 3200);
  }

  function pageHead(kicker, title, description, action = '') {
    return `<header class="role-page-head"><div><span>${esc(kicker)}</span><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${action}</header>`;
  }

  function metric(label, value, detail = '') {
    return `<article class="role-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</article>`;
  }

  function empty(message) { return `<div class="empty-state">${esc(message)}</div>`; }

  function statusLabel(status) {
    return ({ pending_online: 'پرداخت آنلاین', awaiting_confirmation: 'نیازمند تأیید', pay_at_cashier: 'پیش‌نویس صندوق', sent_to_kitchen: 'ارسال‌شده به آشپزخانه', paid: 'پرداخت‌شده', preparing: 'در حال آماده‌سازی', ready: 'آماده تحویل', dispatched: 'تحویل پیک', picked_up: 'تحویل شد', delivered: 'رسید', done: 'تکمیل', cancelled: 'لغو' })[status] || status || '—';
  }

  function orderItems(order) {
    return (order.items || []).map((item) => {
      const complements = (item.complements || []).map((entry) => `${num(entry.qty || 1)}× ${esc(entry.name)}`).join('، ');
      return `${num(item.qty || 1)}× ${esc(item.name)}${complements ? ` ← ${complements}` : ''}`;
    }).join(' · ') || 'بدون قلم';
  }

  function orderCard(order, actions = '') {
    const age = ageMin(order.createdAt);
    return `<article class="order-card ${age >= 20 ? 'is-late' : ''}" data-order-id="${order.id}">
      <div class="order-card__top"><strong>${esc(order.orderNo || `سفارش ${order.id}`)}</strong><span>${esc(order.tableNo ? `میز ${order.tableNo}` : order.fulfillment === 'delivery' ? 'ارسال' : 'بیرون‌بر')} · ${num(age)} دقیقه</span></div>
      <div class="order-card__items">${orderItems(order)}</div>
      <div class="order-card__meta">${esc(statusLabel(order.status))}${order.note ? ` · یادداشت: ${esc(order.note)}` : ''}${order.kitchenNote ? ` · پیام آشپزخانه: ${esc(order.kitchenNote)}` : ''}</div>
      <div class="order-card__bottom"><b>${money(order.total)}</b><div class="order-actions">${actions}</div></div>
    </article>`;
  }

  function setBusy(button, busy) {
    if (!button) return;
    if (busy) { button.dataset.label = button.textContent; button.textContent = 'در حال انجام…'; button.disabled = true; }
    else { button.textContent = button.dataset.label || button.textContent; button.disabled = false; }
  }

  async function action(button, task, success) {
    setBusy(button, true);
    try { await task(); if (success) showToast(success); await render(); }
    catch (error) { showToast(error.message, 'error'); }
    finally { setBusy(button, false); }
  }

  function openDialog(kicker, title, body, options = {}) {
    dialog.classList.toggle('wt-item-dialog', options.variant === 'waiter-item');
    document.getElementById('dialog-kicker').textContent = kicker;
    document.getElementById('dialog-title').textContent = title;
    dialogBody.innerHTML = body;
    dialog.showModal();
  }

  function setActiveBranch(value) {
    const nextBranchId = Number(value) || null;
    if (!nextBranchId || Number(nextBranchId) === Number(state.branchId)) return;
    state.branchId = nextBranchId;
    state.menuItems = [];
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
        <button class="role-danger" id="role-logout" type="button">خروج از حساب</button>
      </div>
    `);
    document.getElementById('role-user-branch-select')?.addEventListener('change', (event) => setActiveBranch(event.target.value));
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
      return `<button type="button" data-view="${id}" class="${activeClass} ${lockedClass}" ${!enabled ? 'title="این بخش توسط کنترل‌پلن NEEM غیرفعال است"' : ''}>${esc(label)}${lockIcon}</button>`;
    }).join('');
    nav.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
      state.activeView = button.dataset.view;
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

  const POS_MODIFIERS = [
    { group: 'روش سرو', items: [{ name: 'تند', price: 0 }, { name: 'بدون پیاز', price: 0 }, { name: 'بدون سس', price: 0 }, { name: 'بدون پنیر', price: 0 }] },
    { group: 'افزودنی‌ها', items: [{ name: 'پنیر اضافه', price: 120000 }, { name: 'آووکادو', price: 180000 }, { name: 'بیکن', price: 220000 }, { name: 'سس اضافه', price: 60000 }] },
  ];

  function menuModifierGroupsForItem(item) {
    if (Array.isArray(item?.modifierGroups)) return item.modifierGroups;
    // Compatibility for an older staff endpoint. New responses always carry
    // the server-side contextual groups, including an intentional empty list.
    return POS_MODIFIERS.map((legacy, groupIndex) => ({
      id: `legacy-group-${groupIndex + 1}`,
      title: legacy.group,
      selection: 'multiple',
      required: false,
      options: legacy.items.map((option, optionIndex) => ({
        id: `legacy-option-${groupIndex + 1}-${optionIndex + 1}`,
        name: option.name,
        price: option.price,
        available: true,
      })),
    }));
  }

  function modifierOptionForInput(groups, input) {
    const id = String(input?.dataset?.modifierOption || '');
    const groupId = String(input?.dataset?.modifierGroup || '');
    const group = groups.find((entry) => String(entry.id) === groupId);
    return (group?.options || []).find((option) => String(option.id) === id) || null;
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

  function posTotal(check = state.posCheck) {
    return (check?.lines || []).reduce((sum, line) => sum + posLineTotal(line), 0);
  }

  function orderIsOpen(order) {
    return !['done', 'picked_up', 'delivered', 'cancelled'].includes(String(order.status || ''));
  }

  function orderCanEdit(order) {
    return Boolean(order && !order.startedAt && order.paymentMethod !== 'online' && ['pay_at_cashier', 'awaiting_confirmation', 'sent_to_kitchen', 'paid'].includes(String(order.status || '')));
  }

  function tableNoBelongsToTable(tableNo, tableId) {
    const canonical = (value) => normalizeDigits(value).trim().replace(/^میز\s*/u, '').replace(/\s+/g, '');
    const actual = canonical(tableNo);
    const target = canonical(tableId);
    return Boolean(actual && target && (actual === target || actual.startsWith(`${target}-`)));
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
      paymentStatus: order.paymentStatus || 'unpaid',
      paymentTender: order.paymentTender || '',
      amountPaid: Number(order.amountPaid || 0),
      total: Number(order.total || 0),
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

    const timerHtml = table.serviceEndsAt && !table.autoReleased && ['busy', 'attention'].includes(table.state)
      ? `<time class="plan-table-timer" data-service-ends="${esc(table.serviceEndsAt)}">${floorCountdownLabel(table.serviceEndsAt)}</time>`
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

    return `
      <div class="plan-table plan-table--${esc(shape)} ${isSelected ? 'is-selected' : ''} ${isMergedParent ? 'is-merged-parent' : ''} ${isMergedSub ? 'is-merged-sub' : ''}"
           ${dataAttr}
           role="button"
           tabindex="0"
           data-state="${esc(table.state || (table.active === false ? 'inactive' : 'available'))}"
           data-seats="${seats}"
           ${table.autoReleased ? 'data-auto-released="true"' : ''}
           style="left:${coords.x}%; top:${coords.y}%; transform: translate(-50%, -50%) rotate(${table.rotation || 0}deg); --table-rot: ${table.rotation || 0}deg;"
           title="${esc(table.label || `میز ${table.id}`)} — ${esc(table.stateLabel || 'آزاد')}"
           aria-label="${esc(table.label || `میز ${table.id}`)} — ${esc(table.stateLabel || 'آزاد')}، ${num(seats)} نفر">
        ${chairsHtml}
        <div class="plan-table-surface">
          <span class="plan-table-number">${esc(table.label || `میز ${table.id}`)}</span>
          <span class="plan-table-meta">${num(seats)} نفر · ${esc(table.zone || 'سالن')}</span>
          ${mergeBadgeHtml}
          ${timerHtml}
        </div>
        ${paletteHtml}
      </div>`;
  }

  function buildPlanCanvasHtml(visibleTables, activeZone = 'all', options = {}) {
    const isEditMode = Boolean(options.isEditMode);
    const dynamicZones = Array.isArray(state.data.floor?.zones) ? state.data.floor.zones : [];
    const dynamicFixtures = Array.isArray(state.data.floor?.fixtures) ? state.data.floor.fixtures : [];
    const bgTheme = state.data.floor?.settings?.bgTheme || 'slate-blueprint';

    // Build zones markup
    let zonesMarkup = '';
    if (dynamicZones.length > 0) {
      zonesMarkup = dynamicZones.map((z) => {
        const isMatch = activeZone === 'all' || z.name === activeZone || z.id === activeZone;
        return `
          <div class="plan-zone plan-zone--dynamic plan-zone--${esc(z.color || 'blue')} ${isMatch && activeZone !== 'all' ? 'is-full-view' : ''}"
               style="left:${z.x}%; top:${z.y}%; width:${z.w}%; height:${z.h}%;">
            <span class="plan-zone__tag">${esc(z.icon || '🏷️')} ${esc(z.name)}</span>
          </div>`;
      }).join('');
    } else {
      zonesMarkup = `
        ${(activeZone === 'all' || activeZone === 'سالن') ? `<div class="plan-zone plan-zone--main ${activeZone === 'سالن' ? 'is-full-view' : ''}"><span class="plan-zone__tag">سالن اصلی</span></div>` : ''}
        ${(activeZone === 'all' || activeZone === 'تراس') ? `<div class="plan-zone plan-zone--terrace ${activeZone === 'تراس' ? 'is-full-view' : ''}"><span class="plan-zone__tag">🌿 تراس و فضای باز</span></div>` : ''}
        ${(activeZone === 'all' || activeZone === 'VIP' || activeZone === 'ویژه') ? `<div class="plan-zone plan-zone--vip ${(activeZone === 'VIP' || activeZone === 'ویژه') ? 'is-full-view' : ''}"><span class="plan-zone__tag">👑 سالن اختصاصی ویژه</span></div>` : ''}
      `;
    }

    // Build fixtures markup
    let fixturesMarkup = '';
    if (dynamicFixtures.length > 0) {
      fixturesMarkup = `
        <div class="plan-fixtures-layer">
          ${dynamicFixtures.map((f) => `
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
        </div>`;
    } else {
      fixturesMarkup = `
        <div class="plan-fixtures-layer">
          <div class="plan-fixture plan-fixture--entrance" title="ورودی"></div>
          <div class="plan-fixture plan-fixture--bar">☕ بار گرم و سرد</div>
          <div class="plan-fixture plan-fixture--kitchen">🍳 تحویل غذا</div>
          <div class="plan-fixture plan-fixture--cashier">💳 صندوق</div>
        </div>`;
    }

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
      state.posPickerMode = state.posPickerMode || 'plan';

      const zones = ['all', ...new Set(activeTables.map((t) => t.zone || 'سالن'))];

      const paintTables = () => {
        const visibleTables = state.posPickerZone === 'all'
          ? activeTables
          : activeTables.filter((t) => (t.zone || 'سالن') === state.posPickerZone);

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
                ${zones.map((z) => `<button type="button" class="floor-zone-pill ${state.posPickerZone === z ? 'active' : ''}" data-picker-zone="${esc(z)}"><span>${esc(z === 'all' ? 'همه بخش‌ها' : z)}</span><small>${num(z === 'all' ? activeTables.length : activeTables.filter((t) => (t.zone || 'سالن') === z).length)}</small></button>`).join('')}
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
                    <small>${num(table.seats)} نفر · ${esc(table.zone || 'سالن')}</small>
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
    const statusText = check.paymentStatus === 'partial' ? 'نیازمند تکمیل پرداخت' : (check.sent ? statusLabel(check.status) : 'ثبت‌نشده');
    const submitLabel = !check.orderId ? 'ارسال به آشپزخانه' : editable ? 'ذخیره تغییرات سفارش' : 'ویرایش پس از شروع آشپزخانه قفل است';
    return `<aside class="pos-check">
      <div class="pos-check__title"><div><strong>${esc(posLocationLabel(check))}</strong><small>${check.orderNo ? `${esc(check.orderNo)}${editable && check.orderId ? ' · قابل ویرایش تا شروع آشپزخانه' : ''}` : 'فاکتور جدید'}</small></div><span class="pos-status ${check.sent ? 'is-sent' : ''}">${esc(statusText)}</span></div>
      <div class="pos-check__tabs"><button class="active" type="button">فاکتور</button><button type="button" id="pos-actions-tab">عملیات</button><button type="button" id="pos-guest-tab">مهمان</button></div>
      <div class="pos-lines">${lines.map((line) => posInvoiceRows(line)).join('') || empty('هنوز محصولی به فاکتور اضافه نشده است.')}</div>
      <div class="pos-totals"><div><span>جمع جزء</span><b>${money(posTotal())}</b></div><div class="is-total"><span>مبلغ نهایی</span><strong>${money(posTotal())}</strong></div></div>
      <div class="pos-check__buttons"><button type="button" class="pos-ghost" id="pos-print" ${check.orderId ? '' : 'disabled'}>چاپ</button><button type="button" class="pos-pay" id="pos-pay" ${lines.length && check.paymentStatus !== 'paid' ? '' : 'disabled'}>${check.paymentStatus === 'paid' ? 'پرداخت‌شده' : 'پرداخت'}</button></div>
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
    const selected = new Set((existing?.modifiers || []).map((modifier) => String(modifier.id || modifier.name)));
    const groupsHtml = modifierGroups.length
      ? modifierGroups.map((group) => `<div class="modifier-group" data-modifier-group-card="${esc(group.id)}"><h3>${esc(group.title)} <small>${group.selection === 'single' ? 'یک انتخاب' : 'چند انتخاب'}${group.required ? ' · الزامی' : ''}</small></h3><div>${(group.options || []).filter((option) => option.available !== false).map((option) => `<label><input type="${group.selection === 'single' ? 'radio' : 'checkbox'}" name="modifier-group-${esc(group.id)}" data-modifier-group="${esc(group.id)}" data-modifier-option="${esc(option.id)}" ${selected.has(String(option.id)) || selected.has(String(option.name)) ? 'checked' : ''}/><span>${esc(option.name)}</span><small>${option.price ? `+ ${money(option.price)}` : 'بدون هزینه'}</small></label>`).join('')}</div></div>`).join('')
      : '<div class="modifier-empty">برای این غذا ترجیحی تعریف نشده است.</div>';
    openDialog('ویرایش محصول', item.name, `<div class="modifier-layout"><section><div class="modifier-base"><span>قیمت پایه</span><b>${money(item.price)}</b></div><p class="modifier-context-note">ترجیحات مخصوص همین غذا</p>${groupsHtml}</section><aside><label class="field"><span>یادداشت محصول</span><textarea id="modifier-note" rows="4" maxlength="180">${esc(existing?.note || '')}</textarea></label><label class="field"><span>شماره صندلی (اختیاری)</span><input id="modifier-seat" type="number" min="0" max="99" value="${Number(existing?.seat || 0)}" /></label><div class="modifier-qty"><button type="button" data-mod-qty="-1">−</button><b id="modifier-qty">${num(existing?.qty || 1)}</b><button type="button" data-mod-qty="1">+</button></div><button type="button" class="pos-pay" id="modifier-save">${existing ? 'ذخیره تغییرات' : 'افزودن به فاکتور'}</button>${existing ? '<button type="button" class="role-danger" id="modifier-remove">حذف از سفارش</button>' : ''}</aside></div>`);
    let qty = Number(existing?.qty || 1);
    dialogBody.querySelectorAll('[data-mod-qty]').forEach((button) => button.addEventListener('click', () => { qty = Math.max(1, Math.min(99, qty + Number(button.dataset.modQty))); document.getElementById('modifier-qty').textContent = num(qty); }));
    document.getElementById('modifier-save').addEventListener('click', () => {
      const modifiers = [...dialogBody.querySelectorAll('[data-modifier-option]:checked')]
        .map((input) => modifierOptionForInput(modifierGroups, input))
        .filter(Boolean)
        .map((option) => ({ ...option }));
      const missingRequired = modifierGroups.find((group) => group.required && !modifiers.some((modifier) => String(modifier.groupId) === String(group.id)));
      if (missingRequired) return showToast(`یک گزینه از «${missingRequired.title}» انتخاب کنید`, 'error');
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
    const data = await api('/api/staff/orders', {
      method: 'POST', headers: { 'Idempotency-Key': `pos-${Date.now()}-${Math.random().toString(16).slice(2)}` },
      body: JSON.stringify({ branchId: state.branchId, fulfillment: state.posCheck.fulfillment, tableNo: state.posCheck.tableNo, name: state.posCheck.customerName, phone: state.posCheck.phone, note: state.posCheck.note, paymentMethod: 'cashier', sendToKitchen, items: state.posCheck.lines.map((line) => ({ menuItemId: line.menuItemId, qty: line.qty, modifiers: line.modifiers, complements: (line.complements || []).map((entry) => ({ complementId: Number(entry.id || entry.complementId), qty: Number(entry.qty || 1) })), note: line.note, seat: line.seat })) }),
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
      body: JSON.stringify({ branchId: state.branchId, name: check.customerName, phone: check.phone, note: check.note, items: posOrderItemsPayload(check) }),
    });
    const index = (state.data.orders || []).findIndex((order) => Number(order.id) === Number(data.order.id));
    if (index >= 0) state.data.orders[index] = data.order;
    state.posCheck = posCheckFromOrder(data.order);
    cashierMenu();
    return data.order;
  }

  function openPayment(order, splitAmount = 0) {
    const total = Number(order.total || posTotal());
    const paid = Number(order.amountPaid || 0);
    const outstanding = Math.max(0, total - paid);
    const charge = Math.min(outstanding, Math.max(1, Math.round(Number(splitAmount) || outstanding)));
    const rounded = Math.ceil(charge / 500000) * 500000 || charge;
    openDialog('پرداخت', `مبلغ ${money(charge)}`, `<div class="payment-sheet">
      <button type="button" class="split-payment" id="split-payment">تقسیم مبلغ</button>
      <div class="payment-total">
        <span>${charge < outstanding ? 'سهم انتخاب‌شده' : 'مبلغ قابل پرداخت'}</span>
        <strong>${money(charge)}</strong>
        <small>${esc(posLocationLabel(state.posCheck))}${paid ? ` · پرداخت‌شده ${money(paid)} · مانده ${money(outstanding)}` : ''}</small>
      </div>

      <!-- Customer Club & Points Redemption -->
      <div class="loyalty-pos-box" style="margin-bottom:0.75rem; background:rgba(255,255,255,0.04); border:1px solid rgba(168,85,247,0.3); border-radius:0.5rem; padding:0.55rem; text-align:right;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.35rem;">
          <span style="font-size:0.8rem; font-weight:700; color:#a855f7;">💎 باشگاه مشتریان و کسر مستقیم امتیاز</span>
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
            <button type="button" class="btn btn-sm" id="pos-apply-points-btn" style="font-size:0.72rem; padding:0.2rem 0.5rem; background:#f59e0b; border-color:#f59e0b; color:#fff;">کسر امتیاز باشگاه</button>
          </div>
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
      </section>
      <div class="payment-methods">
        <button type="button" data-pay="card"><span>کارت‌خوان</span><small>ثبت پرداخت کارت حضوری</small><b>←</b></button>
        <button type="button" data-pay="wallet"><span>کیف پول مشتری</span><small>کسر مستقیم از مانده کیف پول</small><b>←</b></button>
        <button type="button" data-pay="manual_card"><span>ورود دستی کارت</span><small>ثبت ممیزی‌شده تراکنش</small><b>←</b></button>
        <button type="button" data-pay="gift_card"><span>کارت هدیه</span><small>اعتبار هدیه مجموعه</small><b>←</b></button>
        <button type="button" data-pay="card_on_file"><span>کارت ذخیره‌شده</span><small>مشتری باشگاه</small><b>←</b></button>
      </div>
      <div id="custom-cash-row" hidden>
        <label class="field"><span>وجه دریافتی</span><input id="cash-received" inputmode="numeric" value="${charge}" /></label>
        <button type="button" class="pos-pay" id="cash-confirm">ثبت دریافت</button>
      </div>
    </div>`);

    let currentDiscounts = null;
    const checkLoyalty = async () => {
      const p = normalizeDigits(document.getElementById('pos-loyalty-phone')?.value || '').trim();
      if (!p) return;
      try {
        const res = await api(`/api/cashier/orders/${order.id}/apply-loyalty`, {
          method: 'POST',
          body: JSON.stringify({ phone: p, redeemPoints: 0, apply: false }),
        });
        currentDiscounts = res.discounts;
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

    document.getElementById('pos-apply-points-btn')?.addEventListener('click', async () => {
      const p = normalizeDigits(document.getElementById('pos-loyalty-phone')?.value || '').trim();
      const maxPts = currentDiscounts?.maxRedeemablePoints || 0;
      const res = await api(`/api/cashier/orders/${order.id}/apply-loyalty`, {
        method: 'POST',
        body: JSON.stringify({ phone: p, apply: true, redeemPoints: maxPts }),
      });
      showToast(`${maxPts} امتیاز کسر و تخفیف روی فاکتور اعمال شد`);
      openPayment(res.order);
    });
    dialogBody.querySelectorAll('[data-pay]').forEach((button) => button.addEventListener('click', () => settlePosOrder(order, button.dataset.pay, Number(button.dataset.amount || charge), charge, button)));
    document.getElementById('split-payment').addEventListener('click', () => { document.getElementById('split-options').hidden = !document.getElementById('split-options').hidden; });
    dialogBody.querySelectorAll('[data-split]').forEach((button) => button.addEventListener('click', () => openPayment(order, Number(button.dataset.split))));
    document.getElementById('split-custom-apply').addEventListener('click', () => openPayment(order, parseInputNumber(document.getElementById('split-custom').value)));
    document.getElementById('custom-cash').addEventListener('click', () => { document.getElementById('custom-cash-row').hidden = false; document.getElementById('cash-received').focus(); });
    document.getElementById('cash-confirm').addEventListener('click', (event) => settlePosOrder(order, 'cash', parseInputNumber(document.getElementById('cash-received').value), charge, event.currentTarget));
  }

  async function settlePosOrder(order, tender, amountTendered, paymentAmount, button) {
    setBusy(button, true);
    try {
      if (tender === 'cash' && amountTendered < paymentAmount) throw new Error('وجه دریافتی کمتر از مبلغ این بخش است.');
      const data = await api(`/api/cashier/orders/${order.id}/settle`, { method: 'POST', body: JSON.stringify({ tender, amountTendered, paymentAmount }) });
      state.posCheck = posCheckFromOrder(data.order);
      const remaining = Math.max(0, Number(data.order.total || 0) - Number(data.order.amountPaid || 0));
      dialogBody.innerHTML = `<div class="payment-processing"><span class="payment-spinner"></span><h2>${data.order.changeDue ? `باقی‌مانده وجه: ${money(data.order.changeDue)}` : 'پرداخت ثبت شد'}</h2><p>${remaining ? `مانده فاکتور: ${money(remaining)}` : 'فاکتور به‌طور کامل تسویه شد.'}</p></div>`;
      setTimeout(() => remaining ? openPayment(data.order) : openReceipt(data.order), 650);
    } catch (error) { showToast(error.message, 'error'); setBusy(button, false); }
  }

  function openReceipt(order) {
    document.getElementById('dialog-kicker').textContent = 'پرداخت ثبت شد';
    document.getElementById('dialog-title').textContent = order.changeDue ? `باقی‌مانده ${money(order.changeDue)}` : 'بدون باقی‌مانده';
    dialogBody.innerHTML = `<div class="receipt-sheet"><h2>رسید چگونه تحویل شود؟</h2><div><button type="button" data-receipt="print">چاپ رسید</button><button type="button" data-receipt="email">ایمیل</button><button type="button" data-receipt="sms">پیامک</button><button type="button" data-receipt="none">بدون رسید</button></div><div id="receipt-destination" hidden><label class="field"><span id="receipt-label">مقصد</span><input id="receipt-value" /></label><button type="button" class="pos-pay" id="receipt-send">ثبت انتخاب</button></div></div>`;
    let selectedMethod = 'none';
    dialogBody.querySelectorAll('[data-receipt]').forEach((button) => button.addEventListener('click', async () => {
      selectedMethod = button.dataset.receipt;
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
    const label = {
      cash: 'نقدی', card: 'کارت‌خوان', manual_card: 'کارت دستی', gift_card: 'کارت هدیه',
      card_on_file: 'کارت ذخیره‌شده', online: 'پرداخت اینترنتی', wallet: 'کیف پول', cashier: 'صندوق',
    }[String(order?.paymentTender || order?.tender || '')];
    return label || (order?.paymentStatus === 'paid' ? 'تسویه‌شده' : 'پیش‌فاکتور');
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

  async function buildReceiptRasterPayload(source, { printer = {}, test = false } = {}) {
    if (document.fonts?.ready) await document.fonts.ready;
    const [logo, restaurantData] = await Promise.all([
      loadReceiptLogo(),
      api(`/api/restaurant${qs()}`),
    ]);
    const restaurantPhone = String(restaurantData?.restaurant?.phone || '').trim();
    const order = test ? {
      orderNo: 'نمونه-۳۵۰', tableNo: '۷', fulfillment: 'dine_in', customerName: 'مهمان آزمایشی',
      phone: '09120000000', paymentStatus: 'paid', paymentTender: 'card', createdAt: new Date().toISOString(),
      note: 'نمونهٔ کامل فیش فروش صندوق', total: 2350000,
      lines: [
        { name: 'چیکن پارمسان', qty: 1, price: 940000, lineTotal: 940000, modifiers: [{ name: 'بدون پیاز' }], complements: [] },
        { name: 'چای زعفرانی مخصوص وستو', qty: 2, price: 520000, lineTotal: 1040000, modifiers: [], complements: [{ name: 'کوکی شکلاتی', qty: 1, price: 180000 }] },
        { name: 'آب معدنی', qty: 1, price: 190000, lineTotal: 190000, modifiers: [], complements: [] },
      ],
    } : source;
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
    drawCenter(test ? 'نمونه فیش فروش' : 'فیش فروش', compact ? 24 : 30, 800, 12);
    divider(22);
    band('شماره سفارش', order.orderNo || order.orderId || order.id || '—');
    sectionTitle('جزئیات سفارش');
    metaRow('نوع سفارش', receiptLocation(order));
    metaRow('تاریخ و ساعت', receiptDate(order));
    metaRow('روش پرداخت', receiptPayment(order));
    const customerName = order.customerName || order.name;
    if (customerName) metaRow('نام مهمان', customerName);
    if (restaurantPhone) metaRow('شماره تماس مجموعه', restaurantPhone);
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
    band('جمع کل', money(receiptTotal(order)), { height: compact ? 70 : 86, size: compact ? 27 : 34 });
    ctx.lineWidth = 3;
    ctx.strokeRect(left, y, contentWidth, compact ? 56 : 68);
    font(compact ? 21 : 25, 800); ctx.textAlign = 'center'; ctx.direction = 'rtl'; ctx.textBaseline = 'middle';
    ctx.fillText(order.paymentStatus === 'paid' ? 'پرداخت‌شده' : 'پیش‌فاکتور — تسویه نشده', width / 2, y + (compact ? 28 : 34));
    ctx.textBaseline = 'top';
    y += compact ? 66 : 80;

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
      if (method === 'print') body.raster = await buildReceiptRasterPayload(order, { printer: await activePrinter() });
      const result = await api(`/api/cashier/orders/${order.id}/receipt`, { method: 'POST', body: JSON.stringify(body) });
      if ((method === 'email' || method === 'sms') && !result.deliveryConfigured) showToast('انتخاب ثبت شد؛ سرویس ارسال بیرونی هنوز پیکربندی نشده است.');
      state.posCheck = null; dialog.close(); await render();
    } catch (error) { showToast(error.message, 'error'); }
  }

  async function printOrder(check) {
    if (!check?.orderId) throw new Error('برای چاپ، ابتدا سفارش را ثبت کنید.');
    const printer = await activePrinter();
    const raster = await buildReceiptRasterPayload(check, { printer });
    return api(`/api/cashier/orders/${check.orderId}/print`, {
      method: 'POST',
      body: JSON.stringify({ branchId: state.branchId, raster }),
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
          <div class="printer-settings__actions field--full"><button type="button" class="role-secondary" id="printer-save">ذخیره تنظیمات</button><button type="button" class="role-primary" id="printer-test">ذخیره و چاپ فیش نمونه</button></div>
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

    const zones = [...new Set(tables.map((table) => table.zone || 'سالن'))];
    const visibleTables = state.cashierFloorZone === 'all'
      ? tables
      : tables.filter((table) => (table.zone || 'سالن') === state.cashierFloorZone);

    const zoneButton = (id, label, count) => `<button type="button" data-floor-zone="${esc(id)}" data-cashier-zone="${esc(id)}" class="floor-zone-pill ${state.cashierFloorZone === id ? 'active' : ''}"><span>${esc(label)}</span><small>${num(count)}</small></button>`;

    const activeOrders = (state.data.orders || []).filter((item) => item.fulfillment === 'dine_in' && !['done', 'cancelled'].includes(item.status));
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
            ${zones.map((z) => zoneButton(z, z, tables.filter((t) => (t.zone || 'سالن') === z).length)).join('')}
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
            <small>${num(table.seats)} نفر · ${esc(table.zone || 'سالن')}</small>
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
      const paymentNeedsAttention = order.paymentStatus === 'partial';
      const displayStatus = paymentNeedsAttention ? 'نیازمند تکمیل پرداخت' : statusLabel(order.status);
      return `<article class="pos-order-row ${editable ? 'is-editable' : ''}"><div><b>${esc(order.orderNo || `#${order.id}`)}</b><span>${esc(order.tableNo ? `میز ${order.tableNo}` : 'بیرون‌بر')} · ${time(order.createdAt)}</span></div><p>${orderItems(order)}</p><span class="pos-status">${esc(displayStatus)}</span><strong>${money(order.total)}</strong><button type="button" class="pos-order-row__action ${editable ? 'is-edit' : ''}" data-open-order="${order.id}" ${orderIsOpen(order) ? '' : 'disabled'}>${editable ? 'ویرایش سفارش' : 'مشاهده'}</button></article>`;
    };
    main.innerHTML = `${pageHead('کنترل سفارش', 'سفارش‌ها', 'فاکتورهای باز و بسته ایستگاه', '<button class="role-primary" id="orders-new">+ سفارش جدید</button>')}<section class="role-section"><div class="role-section__head"><h2>باز</h2><span>${num(open.length)} فاکتور</span></div><div class="pos-order-list">${open.map(row).join('') || empty('فاکتور بازی وجود ندارد.')}</div></section><section class="role-section" style="margin-top:14px"><div class="role-section__head"><h2>بسته‌شده‌های اخیر</h2><span>${num(closed.length)} فاکتور</span></div><div class="pos-order-list">${closed.map(row).join('') || empty('هنوز سفارشی بسته نشده است.')}</div></section>`;
    document.getElementById('orders-new').addEventListener('click', openNewCheck);
    main.querySelectorAll('[data-open-order]').forEach((button) => button.addEventListener('click', () => { const order = orders.find((item) => Number(item.id) === Number(button.dataset.openOrder)); state.posCheck = posCheckFromOrder(order); state.activeView = 'menu'; paintNav(); cashierMenu(); }));
  }

  function cashierTransactions() {
    document.body.classList.remove('is-pos-station');
    const paid = (state.data.orders || []).filter((order) => order.paymentStatus === 'paid').slice(0, 80);
    const tenderLabel = { cash: 'نقدی', card: 'کارت‌خوان', manual_card: 'کارت دستی', gift_card: 'کارت هدیه', card_on_file: 'کارت ذخیره‌شده', online: 'پرداخت اینترنتی' };
    const hasTender = (order) => Object.prototype.hasOwnProperty.call(tenderLabel, order.paymentTender);
    const cash = paid.filter((order) => order.paymentTender === 'cash');
    const nonCash = paid.filter((order) => hasTender(order) && order.paymentTender !== 'cash');
    const missingTender = paid.filter((order) => !hasTender(order));
    const totalOf = (orders) => orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    main.innerHTML = `${pageHead('دریافت و پرداخت', 'تراکنش‌ها', 'پرداخت‌های ثبت‌شده و روش دریافت')}
      <section class="role-metrics">
        ${metric('جمع پرداخت', money(totalOf(paid)), `${num(paid.length)} تراکنش`)}
        ${metric('نقدی', money(totalOf(cash)), `${num(cash.length)} تراکنش`)}
        ${metric('غیرنقدی معتبر', money(totalOf(nonCash)), `${num(nonCash.length)} تراکنش`)}
        ${metric('روش ثبت‌نشده', money(totalOf(missingTender)), `${num(missingTender.length)} مورد برای بازبینی`)}
      </section>
      ${missingTender.length ? `<div class="role-inline-warning" role="status"><b>${num(missingTender.length)} پرداخت قدیمی روش دریافت ندارد.</b><span>این مبلغ نقدی یا غیرنقدی فرض نشده و برای تصمیم حسابدار جدا نگه داشته شده است.</span></div>` : ''}
      <section class="role-section"><div class="pos-transaction-list">${paid.map((order) => {
        const missing = !hasTender(order);
        return `<article class="${missing ? 'is-warning' : ''}"><div><b>${esc(order.orderNo || `#${order.id}`)}</b><span>${esc(posLocationLabel(posCheckFromOrder(order)))} · ${time(order.paidAt)}</span></div><span>${esc(missing ? 'روش ثبت‌نشده' : tenderLabel[order.paymentTender])}</span><strong>${money(order.total)}</strong></article>`;
      }).join('') || empty('تراکنشی ثبت نشده است.')}</div></section>`;
  }

  function cashierRegister() {
    const orders = state.data.orders || [];
    const pending = orders.filter((item) => ['pay_at_cashier', 'awaiting_confirmation'].includes(item.status));
    const ready = orders.filter((item) => item.status === 'ready');
    const paidToday = orders.filter((item) => item.paymentStatus === 'paid' && new Date(item.paidAt || item.statusAt || item.createdAt).toDateString() === new Date().toDateString());
    const drawer = state.data.drawer;
    const cards = pending.map((order) => orderCard(order, `
      <button class="role-primary" data-settle="cash">نقدی</button>
      <button class="role-secondary" data-settle="card">کارت</button>
      <button class="role-danger" data-cashier-status="cancelled">لغو</button>`)).join('');
    main.innerHTML = `${pageHead('صندوق فروش', 'صف تسویه', 'سفارش‌های پرداخت در محل، دریافت وجه و ثبت روش پرداخت', '<button class="role-primary" id="new-order">سفارش جدید</button>')}
      <section class="role-metrics">
        ${metric('منتظر تسویه', num(pending.length), pending.length ? 'نیازمند اقدام' : 'صف خالی')}
        ${metric('آماده تحویل', num(ready.length), 'هماهنگ با آشپزخانه')}
        ${metric('فروش امروز', money(paidToday.reduce((sum, item) => sum + Number(item.total || 0), 0)), `${num(paidToday.length)} سفارش`)}
        ${metric('صندوق پول', drawer.session ? money(drawer.totals.expected) : 'بسته', drawer.session ? 'موجودی مورد انتظار' : 'برای نقدی باز شود')}
      </section>
      <div class="role-grid"><section class="role-section role-section--8"><div class="role-section__head"><h2>سفارش‌های قابل تسویه</h2><span>${num(pending.length)} سفارش</span></div><div class="order-list">${cards || empty('سفارشی در انتظار تسویه نیست.')}</div></section>
      <section class="role-section role-section--4"><div class="role-section__head"><h2>کنترل شیفت</h2><span>ایستگاه صندوق</span></div>
        ${state.session.shift ? '<p>شیفت شما فعال است. دریافت نقدی فقط با صندوق پول باز ثبت می‌شود.</p>' : '<p>برای ثبت عملیات روز، ابتدا شیفت را شروع کنید.</p>'}
        <button class="role-secondary" data-go-view="drawer">مشاهده صندوق پول</button>
      </section></div>`;
    main.querySelector('#new-order')?.addEventListener('click', () => showOrderComposer('cashier'));
    main.querySelectorAll('[data-settle]').forEach((button) => button.addEventListener('click', () => {
      const orderId = button.closest('[data-order-id]').dataset.orderId;
      action(button, () => api(`/api/cashier/orders/${orderId}/settle`, { method: 'POST', body: JSON.stringify({ tender: button.dataset.settle }) }), 'پرداخت ثبت شد.');
    }));
    main.querySelectorAll('[data-cashier-status]').forEach((button) => button.addEventListener('click', () => {
      const orderId = button.closest('[data-order-id]').dataset.orderId;
      action(button, () => api(`/api/cashier/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.cashierStatus }) }), 'وضعیت سفارش تغییر کرد.');
    }));
    main.querySelector('[data-go-view]')?.addEventListener('click', () => { state.activeView = 'drawer'; paintNav(); render(); });
  }

  function cashierHandoff() {
    const ready = (state.data.orders || []).filter((item) => item.status === 'ready' || item.status === 'dispatched');
    const cards = ready.map((order) => {
      const next = order.status === 'dispatched' ? 'delivered' : order.fulfillment === 'delivery' ? 'dispatched' : order.fulfillment === 'pickup' ? 'picked_up' : 'done';
      const label = ({ dispatched: 'تحویل به پیک', picked_up: 'تحویل شد', done: 'تحویل میز', delivered: 'رسید به مهمان' })[next];
      return orderCard(order, `<button class="role-primary" data-cashier-status="${next}">${label}</button>`);
    }).join('');
    main.innerHTML = `${pageHead('هماهنگی تحویل', 'تحویل سفارش', 'سفارش‌های آماده از آشپزخانه تا تحویل نهایی')}
      <section class="role-metrics">${metric('آماده', num(ready.filter((item) => item.status === 'ready').length))}${metric('در مسیر', num(ready.filter((item) => item.status === 'dispatched').length))}${metric('میانگین انتظار', `${num(ready.length ? Math.round(ready.reduce((s,o)=>s+ageMin(o.readyAt || o.createdAt),0)/ready.length) : 0)} دقیقه`)}${metric('کل صف', num(ready.length))}</section>
      <section class="role-section"><div class="role-section__head"><h2>صف تحویل</h2><span>قدیمی‌ترها در اولویت</span></div><div class="order-list">${cards || empty('سفارش آماده‌ای وجود ندارد.')}</div></section>`;
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
      document.getElementById('drawer-open').addEventListener('click', (event) => action(event.currentTarget, () => api('/api/cashier/drawer/open', { method: 'POST', body: JSON.stringify({ branchId: state.branchId, openingAmount: parseInputNumber(document.getElementById('drawer-opening').value) || 0 }) }), 'صندوق پول باز شد.'));
      return;
    }
    main.innerHTML = `${pageHead('مدیریت وجه نقد', 'صندوق پول', 'تمام جابه‌جایی‌های نقدی این نشست قابل تطبیق است')}
      <div class="role-grid"><section class="role-section role-section--8"><div class="drawer-card"><span>نشست باز از ${time(session.openedAt)}</span><div class="drawer-card__amount"><span>موجودی مورد انتظار</span><strong>${money(totals.expected)}</strong></div>
      <div class="drawer-breakdown"><div><span>اول شیفت</span><b>${money(totals.opening)}</b></div><div><span>فروش نقدی</span><b>${money(totals.sales)}</b></div><div><span>ورود نقدی</span><b>${money(totals.payIn)}</b></div><div><span>خروج/بازپرداخت</span><b>${money(totals.payOut + totals.refunds)}</b></div></div></div></section>
      <section class="role-section role-section--4"><div class="role-section__head"><h2>عملیات صندوق</h2><span>ثبت ممیزی‌شده</span></div><div class="field-grid">
        <label class="field field--full"><span>مبلغ</span><input id="movement-amount" inputmode="numeric" /></label><label class="field field--full"><span>شرح</span><input id="movement-note" maxlength="160" /></label>
      </div><div class="order-actions" style="margin-top:12px"><button class="role-secondary" data-movement="pay_in">ورود نقدی</button><button class="role-secondary" data-movement="pay_out">خروج نقدی</button><button class="role-danger" id="drawer-close">بستن و شمارش</button></div></section>
      <section class="role-section"><div class="role-section__head"><h2>گردش‌های نشست</h2><span>${num(session.movements?.length || 0)} رکورد</span></div><div class="order-list">${(session.movements || []).map((item) => `<div class="order-card"><div class="order-card__top"><strong>${esc(({ sale:'فروش نقدی', pay_in:'ورود نقدی', pay_out:'خروج نقدی', refund:'بازپرداخت' })[item.type] || item.type)}</strong><span>${time(item.at)}</span></div><div class="order-card__bottom"><span>${esc(item.note || '—')}</span><b>${money(item.amount)}</b></div></div>`).join('') || empty('هنوز گردشی ثبت نشده است.')}</div></section></div>`;
    main.querySelectorAll('[data-movement]').forEach((button) => button.addEventListener('click', () => action(button, () => api('/api/cashier/drawer/movements', { method: 'POST', body: JSON.stringify({ branchId: state.branchId, type: button.dataset.movement, amount: parseInputNumber(document.getElementById('movement-amount').value) || 0, note: document.getElementById('movement-note').value }) }), 'گردش نقدی ثبت شد.')));
    document.getElementById('drawer-close').addEventListener('click', () => {
      openDialog('پایان نشست', 'شمارش صندوق', `<div class="field-grid"><label class="field field--full"><span>مبلغ شمارش‌شده</span><input id="drawer-counted" inputmode="numeric" value="${Math.round(totals.expected)}" /></label></div><p>انتظار سیستم: <b>${money(totals.expected)}</b></p><button class="role-danger" id="confirm-drawer-close">تأیید و بستن صندوق</button>`);
      document.getElementById('confirm-drawer-close').addEventListener('click', (event) => action(event.currentTarget, async () => { await api('/api/cashier/drawer/close', { method: 'POST', body: JSON.stringify({ branchId: state.branchId, countedAmount: parseInputNumber(document.getElementById('drawer-counted').value) || 0 }) }); dialog.close(); }, 'صندوق بسته و تطبیق ثبت شد.'));
    });
  }

  async function fetchWaiter() {
    const [floor, calls, orders, reservations, waitlist] = await Promise.all([
      api(`/api/admin/v2/floor${qs()}`), api(`/api/waiter/calls${qs()}`), api(`/api/admin/orders${qs()}`), api(`/api/admin/reservations${qs()}`), api(`/api/waiter/waitlist${qs()}`),
    ]);
    state.data = { floor, calls: calls.calls || [], orders: orders.orders || [], reservations, waitlist: waitlist.waitlist || [], waitlistSummary: waitlist.summary || {} };
  }

  function waiterMetrics() {
    const activeOrders = (state.data.orders || []).filter((item) => item.fulfillment === 'dine_in' && !['done', 'cancelled'].includes(item.status));
    return `<section class="role-metrics">${metric('فراخوان باز', num(state.data.calls.length), state.data.calls.length ? 'نیازمند رسیدگی' : 'همه پاسخ داده شده')}${metric('میز در سرویس', num(state.data.floor.summary?.busy || 0))}${metric('سفارش فعال', num(activeOrders.length))}${metric('رزرو امروز', num(state.data.reservations.summary?.today || 0), `${num(state.data.reservations.summary?.todayCovers || 0)} نفر`)}</section>`;
  }

  function waiterFloor() {
    document.body.classList.add('is-waiter-floor-app');
    document.body.classList.remove('is-waiter-terminal');
    paintWaiterHeaderContext();
    const tables = state.data.floor.tables || [];
    tables.forEach(ensureTableGeometry);
    const workspaceCapabilities = state.session?.workspace?.capabilities || [];
    const canEditFloor = workspaceCapabilities.includes('*') || workspaceCapabilities.includes('tables.manage');
    if (!canEditFloor) state.waiterFloorEditing = false;
    state.waiterFloorMode = state.waiterFloorMode || 'plan';
    state.waiterFloorZone = state.waiterFloorZone || 'all';

    const definedZones = (state.data.floor?.zones || []).map((z) => z.name).filter(Boolean);
    const tableZones = tables.map((t) => t.zone).filter(Boolean);
    const zones = ['all', ...new Set([...definedZones, ...tableZones, 'سالن'])];
    const visibleTables = state.waiterFloorZone === 'all'
      ? tables
      : tables.filter((t) => (t.zone || 'سالن') === state.waiterFloorZone);

    const toolbarHtml = `
      <div class="floor-toolbar">
        <div class="floor-toolbar__group">
          <div class="floor-zone-pills">
            ${zones.map((z) => {
              const icon = z === 'سالن' ? '🛋️ ' : z === 'تراس' ? '🌿 ' : (z === 'VIP' || z === 'ویژه') ? '👑 ' : z === 'فضای باز' ? '🏷️ ' : '';
              const label = z === 'all' ? 'همه بخش‌ها' : z === 'VIP' ? 'ویژه' : z;
              const count = z === 'all' ? tables.length : tables.filter((t) => (t.zone || 'سالن') === z).length;
              return `<button type="button" class="floor-zone-pill ${state.waiterFloorZone === z ? 'active' : ''}" data-zone-filter="${esc(z)}"><span>${icon}${esc(label)}</span><small>${num(count)}</small></button>`;
            }).join('')}
          </div>
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

    const planCanvasHtml = buildPlanCanvasHtml(visibleTables, state.waiterFloorZone, {
      isEditMode: state.waiterFloorEditing,
      id: 'floor-canvas',
      tablesLayerId: 'plan-tables-layer',
      allowEdit: canEditFloor,
      attr: (t) => `data-table="${esc(t.id)}"`
    });


    const classicGridHtml = `
      <div class="floor-grid" style="overflow-y:auto;flex:1;min-height:0;padding:8px">
        ${visibleTables.map((table) => `
          <button class="floor-table" data-table="${esc(table.id)}" data-state="${esc(table.state)}" ${table.autoReleased ? 'data-auto-released="true"' : ''}>
            <strong>${esc(table.label || `میز ${table.id}`)}</strong>
            <small>${num(table.seats)} نفر · ${esc(table.zone || 'سالن')}</small>
            <span>${esc(table.stateLabel)}</span>
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
    if (planBtn) planBtn.addEventListener('click', () => { state.waiterFloorMode = 'plan'; waiterFloor(); });
    if (gridBtn) gridBtn.addEventListener('click', () => { state.waiterFloorMode = 'grid'; waiterFloor(); });

    // Zone filters
    main.querySelectorAll('[data-zone-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.waiterFloorZone = btn.dataset.zoneFilter;
        waiterFloor();
      });
    });

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
    return `<div class="call-list">${state.data.calls.map((call) => `<article class="call-row" data-call-id="${call.id}"><b>${esc(call.tableNo)}</b><div><p>${esc(call.note || 'درخواست گارسون')}</p><small>${num(ageMin(call.createdAt))} دقیقه قبل</small></div><button class="role-primary" data-resolve-call>رسیدگی شد</button></article>`).join('') || empty('فراخوان بازی وجود ندارد.')}</div>`;
  }

  function wireCalls(root = document) {
    root.querySelectorAll('[data-resolve-call]').forEach((button) => button.addEventListener('click', () => {
      const id = button.closest('[data-call-id]').dataset.callId;
      action(button, async () => {
        await api(`/api/waiter/calls/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) });
        await fetchWaiter();
        if (dialog.open) {
          if (state.data.calls.length) {
            openDialog('فراخوان‌های مهمان', `${num(state.data.calls.length)} درخواست`, callsHtml());
            wireCalls(dialog);
          } else {
            dialog.close();
          }
        }
        if (state.activeView === 'floor') waiterFloor();
        else if (state.activeView === 'calls') waiterCalls();
      }, 'رسیدگی ثبت شد.');
    }));
  }

  function showTableDetail(tableId) {
    const table = (state.data.floor?.tables || []).find((item) => String(item.id) === String(tableId));
    const orders = (state.data.orders || []).filter((item) => tableNoBelongsToTable(item.tableNo, tableId) && !['done', 'cancelled'].includes(item.status));
    const tDigits = String(tableId || '').replace(/\D/g, '');
    const tNum = tDigits ? Number(tDigits) : null;
    const tLabel = String(table?.label || '').trim();
    const tableCalls = (state.data.calls || []).filter((c) => {
      if (c.status !== 'open' && c.status !== 'new') return false;
      const cNo = String(c.tableNo || '').trim();
      const cDigits = cNo.replace(/\D/g, '');
      const cNum = cDigits ? Number(cDigits) : null;
      return (tNum !== null && cNum === tNum) || (cDigits && cDigits === tDigits) || cNo === tLabel || cNo === `میز ${tDigits}` || cNo === `میز ${tNum}` || cNo === tDigits;
    });

    if (!tableCalls.length) {
      openWaiterTerminal(tableId);
      return;
    }

    let callsSectionHtml = `
      <div class="table-calls-alert-box" style="margin-bottom:14px;padding:12px 14px;background:rgba(244,63,94,0.12);border:1.5px solid #f43f5e;border-radius:14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <strong style="color:#f43f5e;display:flex;align-items:center;gap:6px;font-size:14px;">
            <span>🔔</span> <span>فراخوان مهمان (${num(tableCalls.length)})</span>
          </strong>
          <span style="font-size:11px;color:#fca5a5;background:rgba(244,63,94,0.2);padding:2px 8px;border-radius:10px;">نیازمند رسیدگی فوری</span>
        </div>
        ${tableCalls.map((c) => `
          <div class="call-row" data-call-id="${c.id}" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:rgba(0,0,0,0.3);border-radius:10px;margin-bottom:6px;">
            <div>
              <p style="margin:0;font-size:13px;font-weight:700;color:#fff;">${esc(c.note || 'درخواست حضور گارسون')}</p>
              <small style="color:#94a3b8;font-size:11px;">${time(c.createdAt)} (${num(ageMin(c.createdAt))} دقیقه قبل)</small>
            </div>
            <button class="role-primary" data-resolve-call style="padding:6px 12px;font-size:12px;background:#10b981;border:none;white-space:nowrap;">
              رسیدگی شد ✓
            </button>
          </div>
        `).join('')}
      </div>
    `;

    openDialog(
      'فراخوان و سرویس میز',
      table?.label || `میز ${tableId}`,
      `${callsSectionHtml}
       <div style="display:flex;gap:8px;margin-top:12px">
         <button class="role-primary" id="table-open-terminal" style="flex:1">📱 ورود به سفارش‌گیری سر میز</button>
       </div>`
    );

    wireCalls(dialog);
    document.getElementById('table-open-terminal')?.addEventListener('click', () => {
      dialog.close();
      openWaiterTerminal(tableId);
    });
  }

  function openWaiterCoversPicker(table, onSelect) {
    const tableSeats = Number(table?.seats) || 4;
    openDialog(
      'تعداد مهمان',
      table?.label || `میز ${table?.id}`,
      `
      <div class="wt-covers-modal">
        <p style="margin:0 0 8px;font-size:13px;color:var(--rp-muted)">تعداد مهمانان حاضر بر سر میز را مشخص کنید:</p>
        <div class="wt-covers-grid">
          ${Array.from({ length: Math.min(20, Math.max(1, tableSeats)) }, (_, index) => index + 1).map((n) => `
            <button type="button" class="wt-cover-btn ${n === Math.min(tableSeats, 2) ? 'active' : ''}" data-covers="${n}">
              ${num(n)}
            </button>
          `).join('')}
        </div>
        <button type="button" class="btn btn-ghost" id="covers-skip-btn" style="margin-top:10px;font-size:13px;padding:8px">
          بدون تعداد (ادامه)
        </button>
      </div>
      `
    );

    dialogBody.querySelectorAll('[data-covers]').forEach((btn) => btn.addEventListener('click', () => {
      const covers = Number(btn.dataset.covers);
      dialog.close();
      if (typeof onSelect === 'function') onSelect(covers);
    }));

    dialogBody.querySelector('#covers-skip-btn')?.addEventListener('click', () => {
      dialog.close();
      if (typeof onSelect === 'function') onSelect(0);
    });
  }

  async function openWaiterTerminal(tableId, options = {}) {
    try { await loadMenu(); } catch (e) { showToast(e.message, 'error'); }
    const tables = state.data.floor?.tables || [];
    const table = tables.find((t) => String(t.id) === String(tableId)) || { id: tableId, label: `میز ${tableId}` };
    const activeOrders = (state.data.orders || []).filter((o) => tableNoBelongsToTable(o.tableNo, tableId) && !['done', 'cancelled'].includes(o.status));

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
          <button type="button" class="role-secondary" id="create-sub-check" style="margin-top:6px">+ باز کردن فاکتور جدید برای این میز</button>
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

    if (!existingOrder && typeof options.covers === 'undefined' && !options.forceNew) {
      openWaiterCoversPicker(table, (covers) => openWaiterTerminal(tableId, { covers, forceNew: true }));
      return;
    }

    const numCovers = options.covers ?? existingOrder?.covers ?? 2;
    const initialSeats = Math.max(numCovers || 1, 1);

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
      dirty: false,
      searchQuery: '',
      guestName: existingOrder?.name || '',
      guestPhone: existingOrder?.phone || '',
      note: existingOrder?.note || '',
    };

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
      <nav class="wt-tabs">
        <button type="button" class="wt-tab ${wt.activeTab === 'menu' ? 'active' : ''}" data-wt-tab="menu">
          <span>📋</span>
          <span>منو</span>
        </button>
        <button type="button" class="wt-tab ${wt.activeTab === 'check' ? 'active' : ''}" data-wt-tab="check">
          <span>🧾</span>
          <span>فاکتور</span>
          ${wt.lines.length ? `<span class="wt-tab-badge">${num(wt.lines.length)}</span>` : ''}
        </button>
        <button type="button" class="wt-tab ${wt.activeTab === 'actions' ? 'active' : ''}" data-wt-tab="actions">
          <span>⚙️</span>
          <span>عملیات</span>
        </button>
        <button type="button" class="wt-tab ${wt.activeTab === 'guest' ? 'active' : ''}" data-wt-tab="guest">
          <span>👤</span>
          <span>مهمان</span>
        </button>
      </nav>
    `;

    main.innerHTML = `
      <div class="waiter-terminal-screen">
        ${headerHtml}
        <div class="wt-viewport" id="wt-viewport"></div>
      </div>
    `;

    document.getElementById('wt-back-floor')?.addEventListener('click', () => {
      state.waiterTerminal = null;
      waiterFloor();
    });

    main.querySelectorAll('[data-wt-tab]').forEach((btn) => btn.addEventListener('click', () => {
      wt.activeTab = btn.dataset.wtTab;
      renderWaiterTerminal();
    }));

    const viewport = document.getElementById('wt-viewport');
    if (wt.activeTab === 'menu') paintTerminalMenu(viewport);
    else if (wt.activeTab === 'check') paintTerminalCheck(viewport);
    else if (wt.activeTab === 'actions') paintTerminalActions(viewport);
    else if (wt.activeTab === 'guest') paintTerminalGuest(viewport);
  }

  function paintTerminalMenu(container) {
    const wt = state.waiterTerminal;
    const compact = window.innerWidth <= 520;
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
    const itemColumns = compact ? 3 : 5;
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
          <div><span>مرحلهٔ اول</span><strong>دستهٔ غذا را انتخاب کنید</strong><small>برای شروع سفارش، یکی از دسته‌ها را لمس کنید.</small></div>
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
            const stockBadge = outOfStock
              ? `<span class="wt-stock-badge is-out">ناموجود</span>`
              : (item.capacity !== null && item.capacity !== undefined && item.capacity < 15)
                ? `<span class="wt-stock-badge is-low">${num(item.capacity)} عدد</span>`
                : '';
            return `
            <button type="button" class="wt-item-row wt-item-card ${outOfStock ? 'is-out-of-stock' : ''}" data-open-item="${item.id}" ${outOfStock ? 'data-out-of-stock="true"' : ''} aria-label="افزودن ${esc(item.name)} به فاکتور">
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

    container.innerHTML = `<div class="wt-menu-screen">${categoriesHtml}${itemsHtml}</div>`;

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
      const id = Number(row.dataset.openItem);
      const item = state.menuItems.find((i) => Number(i.id) === id);
      if (!item) return;
      if (isItemOutOfStock(item)) return showToast(`«${item.name}» در حال حاضر ناموجود است.`, 'warning');
      openItemCustomization(item);
    }));
  }

  function openItemCustomization(item) {
    const wt = state.waiterTerminal;
    let selectedSeat = 1;
    const itemName = String(item.name || '');
    const inferredCourse = item.course || (itemName.includes('سالاد') || itemName.includes('سوپ') || itemName.includes('پیش‌غذا') ? 'starters' : itemName.includes('دسر') || itemName.includes('قهوه') || itemName.includes('نوشیدنی') || itemName.includes('بار') ? 'dessert' : 'entrees');
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
                <div class="wt-preference-group__head"><strong>${esc(group.title)}</strong><small>${group.selection === 'single' ? 'یک انتخاب' : 'چند انتخاب'}${group.required ? ' · الزامی' : ''}</small></div>
                <div class="wt-modifier-chips">
                  ${(group.options || []).filter((option) => option.available !== false).map((option) => `
                    <button type="button" class="wt-seat-chip ${selectedMods.has(String(option.id)) ? 'active' : ''}" data-modifier-group="${esc(group.id)}" data-modifier-option="${esc(option.id)}" aria-pressed="${selectedMods.has(String(option.id)) ? 'true' : 'false'}">
                      <span>${esc(option.name)}</span>${Number(option.price || 0) > 0 ? `<small>+ ${money(option.price)}</small>` : ''}
                    </button>
                  `).join('')}
                </div>
              </div>
            `).join('') : '<div class="wt-preferences-empty">برای این غذا ترجیحی تعریف نشده است.</div>'}
          </div>

          <div class="wt-drawer-section">
            <label>یادداشت به آشپزخانه:</label>
            <input type="text" id="drawer-item-note" class="role-search" placeholder="توضیحات خاص مهمان..." value="${esc(note)}" style="width:100%" />
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
            <div style="display:flex;align-items:center;gap:8px">
              <button type="button" class="btn btn-sm" id="drawer-dec-qty" style="width:36px;height:36px;font-size:18px">−</button>
              <b style="font-size:16px;min-width:24px;text-align:center">${num(qty)}</b>
              <button type="button" class="btn btn-sm" id="drawer-inc-qty" style="width:36px;height:36px;font-size:18px">+</button>
            </div>
            <button type="button" class="role-primary" id="drawer-add-to-check" style="flex:1;margin-right:12px;padding:12px">
              افزودن به فاکتور
            </button>
          </div>
        </div>
        `,
        { variant: 'waiter-item' }
      );

      dialogBody.querySelectorAll('[data-seat]').forEach((btn) => btn.addEventListener('click', () => {
        selectedSeat = Number(btn.dataset.seat);
        renderDrawer();
      }));

      dialogBody.querySelector('#drawer-add-seat')?.addEventListener('click', () => {
        wt.seatsCount++;
        selectedSeat = wt.seatsCount;
        renderDrawer();
      });

      dialogBody.querySelectorAll('[data-modifier-option]').forEach((btn) => btn.addEventListener('click', () => {
        const group = modifierGroups.find((entry) => String(entry.id) === String(btn.dataset.modifierGroup));
        const option = (group?.options || []).find((entry) => String(entry.id) === String(btn.dataset.modifierOption));
        if (!group || !option) return;
        const optionId = String(option.id);
        if (selectedMods.has(optionId)) selectedMods.delete(optionId);
        else {
          if (group.selection === 'single') {
            for (const [selectedId, selected] of selectedMods) {
              if (String(selected.groupId || '') === String(group.id)) selectedMods.delete(selectedId);
            }
          }
          selectedMods.set(optionId, { ...option, groupId: group.id, groupTitle: group.title });
        }
        renderDrawer();
      }));

      dialogBody.querySelector('#drawer-item-note')?.addEventListener('input', (event) => { note = event.target.value; });

      dialogBody.querySelector('#drawer-dec-qty')?.addEventListener('click', () => {
        if (qty > 1) { qty--; renderDrawer(); }
      });
      dialogBody.querySelector('#drawer-inc-qty')?.addEventListener('click', () => {
        qty++; renderDrawer();
      });

      dialogBody.querySelector('#drawer-add-to-check')?.addEventListener('click', () => {
        const lineNote = (document.getElementById('drawer-item-note')?.value || '').trim();
        const modifiers = Array.from(selectedMods.values()).map((option) => ({ ...option }));
        const missingRequired = modifierGroups.find((group) => group.required && !modifiers.some((modifier) => String(modifier.groupId) === String(group.id)));
        if (missingRequired) return showToast(`یک گزینه از «${missingRequired.title}» انتخاب کنید`, 'error');
        wt.lines.push({
          localId: `line-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          menuItemId: item.id,
          name: item.name,
          price: Number(item.price || 0),
          qty,
          modifiers,
          complements: [],
          note: lineNote,
          seat: selectedSeat,
          course: inferredCourse,
          courseStatus: 'fired',
          firedAt: new Date().toISOString(),
          localSaved: false,
        });
        dialog.close();
        showToast(`«${item.name}» به فاکتور افزوده شد.`);
        renderWaiterTerminal();
      });
    };

    renderDrawer();
  }

  function paintTerminalCheck(container) {
    const wt = state.waiterTerminal;
    const orderLocked = Boolean(wt.order?.id && !orderCanEdit(wt.order));
    const canEdit = !orderLocked;
    const coursesMeta = [
      { id: 'straight_fire', name: '⚡ پخت فوری' },
      { id: 'starters', name: '🥗 پیش‌غذا' },
      { id: 'entrees', name: '🥩 غذای اصلی' },
      { id: 'dessert', name: '🍰 دسر و بار' },
    ];

    const coursesWithItems = coursesMeta.map((c) => {
      const items = wt.lines.filter((l) => (l.course || 'starters') === c.id);
      const isFired = items.length > 0 && items.every((l) => l.courseStatus === 'fired');
      const hasHold = items.some((l) => l.courseStatus === 'hold');
      return { ...c, items, isFired, hasHold };
    }).filter((c) => c.items.length > 0);

    const total = wt.lines.reduce((sum, line) => sum + receiptLineTotal(line), 0);

    const sectionsHtml = coursesWithItems.map((c) => `
      <div class="wt-course-section" data-section-course="${c.id}">
        <div class="wt-course-head">
          <div class="wt-course-title">
            <span>${c.name}</span>
            <span class="wt-course-badge ${c.isFired ? 'is-fired' : 'is-hold'}">
              ${c.isFired ? '🔥 ارسال‌شده برای پخت' : '⏳ در انتظار ارسال'}
            </span>
          </div>
          ${c.hasHold ? `
            <button type="button" class="wt-fire-btn" data-fire-course="${c.id}">
              <span>🔥</span>
              <span>ارسال پخت</span>
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
                <button type="button" class="btn btn-sm btn-ghost wt-line-remove" data-remove-line="${line.localId}" ${canEdit ? '' : 'disabled'} title="${esc(canEdit ? 'حذف قلم' : 'این سفارش قفل شده است')}" aria-label="${esc(canEdit ? 'حذف قلم' : 'سفارش قفل شده')}" style="color:#ef4444;font-size:14px">${canEdit ? '✕' : '🔒'}</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');

    const emptyHtml = !wt.lines.length ? empty('هنوز محصولی به فاکتور افزوده نشده است.') : '';

    const summaryHtml = `
      <div class="wt-summary-bar">
        <div class="wt-summary-bar__total">
          <span>جمع کل صورت‌حساب</span>
          <strong>${money(total)}</strong>
        </div>
        <div class="wt-summary-bar__buttons">
          <button type="button" class="wt-pay-btn" id="wt-pay-btn" ${orderLocked ? 'disabled' : ''}>
            <span>💳</span>
            <span>تسویه و پرداخت</span>
          </button>
          <button type="button" class="wt-send-btn" id="wt-send-check" ${orderLocked ? 'disabled' : ''}>
            <span>📤</span>
            <span>ثبت و ارسال سفارش</span>
          </button>
        </div>
      </div>
    `;

    container.innerHTML = `<div class="wt-check-view">${sectionsHtml || emptyHtml}</div>` + (wt.lines.length ? summaryHtml : '');

    container.querySelectorAll('[data-fire-course]').forEach((btn) => btn.addEventListener('click', async () => {
      const course = btn.dataset.fireCourse;
      await fireCourse(course);
    }));

    container.querySelectorAll('[data-remove-line]').forEach((btn) => btn.addEventListener('click', () => {
      const localId = btn.dataset.removeLine;
      if (!canEdit) return;
      wt.lines = wt.lines.filter((l) => l.localId !== localId);
      renderWaiterTerminal();
    }));

    document.getElementById('wt-pay-btn')?.addEventListener('click', () => payWaiterCheck());
    document.getElementById('wt-send-check')?.addEventListener('click', () => saveAndSendTerminalOrder());
  }

  async function fireCourse(course) {
    const wt = state.waiterTerminal;
    if (!wt) return;
    const courseLabels = { starters: 'پیش‌غذا', entrees: 'غذای اصلی', dessert: 'دسر', straight_fire: 'پخت فوری' };
    const label = courseLabels[course] || course;

    wt.lines.forEach((line) => {
      if ((line.course || 'starters') === course && line.courseStatus === 'hold') {
        line.courseStatus = 'fired';
        line.firedAt = new Date().toISOString();
      }
    });

    if (wt.order?.id) {
      try {
        await api(`/api/waiter/orders/${wt.order.id}/fire-course`, {
          method: 'PATCH',
          body: JSON.stringify({ course }),
        });
        showToast(`دستور پخت «${label}» به آشپزخانه ارسال شد.`);
      } catch (err) {
        showToast(err.message, 'error');
      }
    } else {
      showToast(`وضعیت «${label}» به آماده پخت تغییر یافت.`);
    }

    renderWaiterTerminal();
  }

  async function saveAndSendTerminalOrder(shouldReturn = true) {
    const wt = state.waiterTerminal;
    if (!wt) return;
    if (wt.saving) return;
    if (!wt.lines.length) {
      showToast('حداقل یک غذا را به فاکتور اضافه کنید.', 'error');
      return;
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

    try {
      if (wt.order?.id) {
        const res = await api(`/api/cashier/orders/${wt.order.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            branchId: state.branchId,
            items: payloadItems,
            note: wt.note || '',
            name: wt.guestName || '',
            phone: wt.guestPhone || '',
            sendToKitchen: true,
          }),
        });
        wt.order = res.order || wt.order;
        wt.checkNo = wt.order?.checkNo || wt.checkNo;
        wt.lines.forEach((l) => { l.localSaved = true; });
        wt.dirty = false;
        showToast('سفارش به‌روزرسانی و برای آشپزخانه ارسال شد.');
      } else {
        wt.idempotencyKey = wt.idempotencyKey || `waiter-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const res = await api('/api/staff/orders', {
          method: 'POST',
          headers: { 'Idempotency-Key': wt.idempotencyKey },
          body: JSON.stringify({
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
          }),
        });
        wt.order = res.order;
        wt.checkNo = wt.order?.checkNo || wt.checkNo;
        wt.lines.forEach((l) => { l.localSaved = true; });
        wt.dirty = false;
        showToast('سفارش ثبت و برای آشپزخانه ارسال شد.');
      }
      await fetchFloor();
      if (shouldReturn) {
        state.waiterTerminal = null;
        waiterFloor();
      } else {
        renderWaiterTerminal();
      }
      return true;
    } catch (err) {
      showToast(err.message, 'error');
      return false;
    } finally {
      wt.saving = false;
    }
  }

  function paintTerminalActions(container) {
    const wt = state.waiterTerminal;
    container.innerHTML = `
      <div class="wt-actions-grid">
        <button type="button" class="wt-action-btn" id="act-split-check">
          <span>✂️</span>
          <strong>تفکیک فاکتور</strong>
          <small style="font-size:11px;color:var(--rp-muted)">تفکیک بر اساس صندلی یا اقلام</small>
        </button>
        <button type="button" class="wt-action-btn" id="act-move-table">
          <span>🔄</span>
          <strong>انتقال میز</strong>
          <small style="font-size:11px;color:var(--rp-muted)">جابه‌جایی کل میز به شماره دیگر</small>
        </button>
        <button type="button" class="wt-action-btn" id="act-cover-count">
          <span>👥</span>
          <strong>تعداد مهمان (${num(wt.covers || wt.seatsCount)})</strong>
          <small style="font-size:11px;color:var(--rp-muted)">تغییر نفرات و صندلی‌ها</small>
        </button>
        <button type="button" class="wt-action-btn" id="act-table-note">
          <span>📝</span>
          <strong>یادداشت سفارش</strong>
          <small style="font-size:11px;color:var(--rp-muted)">پیام اختصاصی میز</small>
        </button>
        <button type="button" class="wt-action-btn" id="act-clear-order" style="border-color:#fecdd3">
          <span>🗑️</span>
          <strong style="color:#e11d48">پاک کردن اقلام</strong>
          <small style="font-size:11px;color:#f43f5e">شروع مجدد سفارش</small>
        </button>
        <button type="button" class="wt-action-btn" id="act-pay-side" style="border-color:#bae6fd">
          <span>💳</span>
          <strong style="color:#0284c7">تسویه و پرداخت</strong>
          <small style="font-size:11px;color:#0284c7">پرداخت کارت/نقدی سر میز</small>
        </button>
      </div>
    `;

    document.getElementById('act-split-check')?.addEventListener('click', () => splitOrderCheck());
    document.getElementById('act-move-table')?.addEventListener('click', () => moveOrderTable());
    document.getElementById('act-cover-count')?.addEventListener('click', () => {
      openWaiterCoversPicker(wt.table, (covers) => {
        wt.covers = covers;
        wt.seatsCount = Math.max(covers || 1, 1);
        showToast(`تعداد مهمانان به ${num(covers)} نفر تغییر یافت.`);
        renderWaiterTerminal();
      });
    });
    document.getElementById('act-table-note')?.addEventListener('click', () => {
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
        showToast('یادداشت ذخیره شد.');
        renderWaiterTerminal();
      });
    });
    document.getElementById('act-clear-order')?.addEventListener('click', () => {
      if (confirm('آیا از پاک کردن اقلام ثبت‌نشده مطمئن هستید؟')) {
        wt.lines = wt.lines.filter((l) => l.localSaved);
        renderWaiterTerminal();
      }
    });
    document.getElementById('act-pay-side')?.addEventListener('click', () => payWaiterCheck());
  }

  function splitOrderCheck() {
    const wt = state.waiterTerminal;
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
      try {
        const res = await api(`/api/waiter/orders/${wt.order.id}/split`, {
          method: 'POST',
          body: JSON.stringify({ mode: 'seat', seat }),
        });
        dialog.close();
        showToast(`فاکتور صندلی ${num(seat)} با موفقیت تفکیک و به شماره ${res.splitOrder.tableNo} ایجاد شد.`);
        await fetchFloor();
        openWaiterTerminal(wt.table.id);
      } catch (err) {
        showToast(err.message, 'error');
      }
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
      try {
        const res = await api(`/api/waiter/orders/${wt.order.id}/split`, {
          method: 'POST',
          body: JSON.stringify({ mode: 'items', itemIndices }),
        });
        dialog.close();
        showToast(`فاکتور مجزا (${res.splitOrder.tableNo}) با موفقیت ایجاد شد.`);
        await fetchFloor();
        openWaiterTerminal(wt.table.id);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  function moveOrderTable() {
    const wt = state.waiterTerminal;
    if (!wt.order?.id) {
      showToast('ابتدا سفارش را ثبت کنید.', 'error');
      return;
    }
    const allTables = state.data.floor?.tables || [];
    const otherTables = allTables.filter((t) => String(t.id) !== String(wt.table.id));

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

    dialogBody.querySelector('#btn-confirm-move')?.addEventListener('click', async () => {
      const nextTableNo = document.getElementById('move-table-select').value;
      try {
        await api(`/api/waiter/orders/${wt.order.id}/move-table`, {
          method: 'PATCH',
          body: JSON.stringify({ tableNo: nextTableNo }),
        });
        dialog.close();
        showToast(`سفارش با موفقیت به میز ${nextTableNo} منتقل شد.`);
        await fetchFloor();
        openWaiterTerminal(nextTableNo);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  function paintTerminalGuest(container) {
    const wt = state.waiterTerminal;
    container.innerHTML = `
      <div style="padding:14px 12px;display:flex;flex-direction:column;gap:12px;max-width:480px;margin:0 auto">
        <label class="field">
          <span>نام مهمان (اختیاری):</span>
          <input type="text" id="wt-guest-name" class="role-search" value="${esc(wt.guestName || '')}" placeholder="مثال: آقای رضایی" />
        </label>
        <label class="field">
          <span>موبایل مهمان (جهت ارسال پیامک فاکتور و امتیاز وفاداری):</span>
          <input type="tel" id="wt-guest-phone" class="role-search" value="${esc(wt.guestPhone || '')}" placeholder="0912..." />
        </label>
        <button type="button" class="role-primary" id="wt-save-guest" style="margin-top:8px">
          ذخیره اطلاعات مهمان
        </button>
      </div>
    `;
    document.getElementById('wt-save-guest')?.addEventListener('click', () => {
      wt.guestName = document.getElementById('wt-guest-name')?.value.trim() || '';
      wt.guestPhone = document.getElementById('wt-guest-phone')?.value.trim() || '';
      wt.dirty = true;
      showToast('اطلاعات مهمان ثبت شد.');
      wt.activeTab = 'check';
      renderWaiterTerminal();
    });
  }

  function payWaiterCheck() {
    const wt = state.waiterTerminal;
    if (!wt?.lines?.length) {
      showToast('برای تسویه ابتدا حداقل یک غذا به فاکتور اضافه کنید.', 'error');
      return;
    }
    if (wt.order?.paymentStatus === 'paid') {
      showToast('این فاکتور قبلاً پرداخت شده است.', 'error');
      return;
    }
    const calculatedTotal = wt.lines.reduce((sum, line) => sum + receiptLineTotal(line), 0);
    const total = wt.order?.id && Number.isFinite(Number(wt.order.total)) ? Number(wt.order.total) : calculatedTotal;
    const canCollectCash = (state.session?.workspace?.capabilities || []).includes('cash.manage');

    openDialog(
      'تسویه و پرداخت سر میز',
      `${wt.table.label || `میز ${wt.table.id}`} · ${money(total)}`,
      `
      <div style="display:flex;flex-direction:column;gap:14px;padding:6px 0">
        <div style="background:var(--rp-surface-2);border-radius:14px;padding:14px;text-align:center">
          <small style="color:var(--rp-muted);font-size:12px;display:block">مبلغ کل قابل پرداخت</small>
          <strong style="font-size:24px;color:#0284c7;display:block;margin-top:4px">${money(total)}</strong>
          <span style="font-size:12px;color:var(--rp-muted);margin-top:6px;display:block">${num(wt.lines.length)} قلم برای ${num(wt.covers || wt.seatsCount)} مهمان</span>
        </div>

        <div style="display:grid;grid-template-columns:${canCollectCash ? '1fr 1fr' : '1fr'};gap:10px">
          <button type="button" class="btn" id="btn-pay-pos" style="display:flex;flex-direction:column;align-items:center;padding:16px 10px;border-radius:14px;background:#0284c7;color:#fff;border:none;gap:6px">
            <span style="font-size:24px">💳</span>
            <strong style="font-size:13px">کارتخوان / پوز</strong>
            <small style="font-size:10.5px;opacity:0.9">تراکنش کارت سر میز</small>
          </button>
          ${canCollectCash ? `<button type="button" class="btn" id="btn-pay-cash" style="display:flex;flex-direction:column;align-items:center;padding:16px 10px;border-radius:14px;background:#10b981;color:#fff;border:none;gap:6px">
            <span style="font-size:24px">💵</span>
            <strong style="font-size:13px">وجه نقد</strong>
            <small style="font-size:10.5px;opacity:0.9">دریافت نقدی</small>
          </button>` : ''}
        </div>

        <p class="wt-payment-note">پرداخت کارت از همین دستگاه ثبت می‌شود. چاپ یا ارسال پیامک رسید از صندوق انجام خواهد شد.</p>
      </div>
      `
    );

    const completePayment = async (method) => {
      try {
        const needsSave = !wt.order?.id || wt.dirty || wt.lines.some((line) => !line.localSaved);
        if (needsSave) {
          const saved = await saveAndSendTerminalOrder(false);
          if (!saved) return;
        }
        if (!wt.order?.id) return;
        if (method === 'cash' && !canCollectCash) {
          showToast('ثبت وجه نقد از این دستگاه مجاز نیست؛ از صندوق استفاده کنید.', 'error');
          return;
        }
        const paymentAmount = Number.isFinite(Number(wt.order.total)) ? Number(wt.order.total) : total;
        await api(`/api/cashier/orders/${wt.order.id}/settle`, {
          method: 'POST',
          body: JSON.stringify({ tender: method === 'pos' ? 'card' : 'cash', paymentAmount, amountTendered: paymentAmount }),
        });
        dialog.close();
        showToast(`تسویه سفارش با موفقیت ثبت و میز ${wt.table.id} آزاد شد.`);
        state.waiterTerminal = null;
        await fetchFloor();
        waiterFloor();
      } catch (err) {
        showToast(err.message, 'error');
      }
    };

    dialogBody.querySelector('#btn-pay-pos')?.addEventListener('click', () => completePayment('pos'));
    dialogBody.querySelector('#btn-pay-cash')?.addEventListener('click', () => completePayment('cash'));
  }



  function waiterCalls() {
    clearRoleHeaderContext();
    document.body.classList.remove('is-waiter-floor-app');
    main.innerHTML = `${pageHead('رسیدگی به مهمان', 'فراخوان‌های مهمان', 'درخواست‌ها بر اساس زمان انتظار مرتب شده‌اند')}${waiterMetrics()}<section class="role-section"><div class="role-section__head"><h2>صف رسیدگی</h2><span>${num(state.data.calls.length)} فراخوان باز</span></div>${callsHtml()}</section>`;
    wireCalls();
  }

  function waiterOrders() {
    clearRoleHeaderContext();
    document.body.classList.remove('is-waiter-floor-app');
    const orders = (state.data.orders || []).filter((item) => item.fulfillment === 'dine_in' && !['done', 'cancelled'].includes(item.status));
    const cards = orders.map((order) => orderCard(order, order.status === 'ready' ? '<button class="role-primary" data-serve>تحویل به میز</button>' : '')).join('');
    main.innerHTML = `${pageHead('خدمت‌رسانی میز', 'سفارش‌های سالن', 'پیگیری سفارش از ثبت تا آماده‌شدن و تحویل به میز', '<button class="role-primary" id="new-order">سفارش جدید</button>')}${waiterMetrics()}<section class="role-section"><div class="role-section__head"><h2>سفارش‌های فعال</h2><span>میزهای من</span></div><div class="order-list">${cards || empty('سفارش فعالی در سالن نیست.')}</div></section>`;
    document.getElementById('new-order').addEventListener('click', () => showOrderComposer('waiter'));
    main.querySelectorAll('[data-serve]').forEach((button) => button.addEventListener('click', () => {
      const id = button.closest('[data-order-id]').dataset.orderId;
      action(button, () => api(`/api/waiter/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) }), 'تحویل به میز ثبت شد.');
    }));
  }

  function waiterReservations() {
    clearRoleHeaderContext();
    document.body.classList.remove('is-waiter-floor-app');
    const active = (state.data.waitlist || []).filter((entry) => ['waiting', 'called', 'seated'].includes(entry.status));
    const history = (state.data.waitlist || []).filter((entry) => ['left', 'cancelled'].includes(entry.status)).slice(0, 8);
    const todayKey = String(state.data.reservations?.serverTime || new Date().toISOString()).slice(0, 10);
    const timedToday = (state.data.reservations?.reservations || []).filter((item) => item.date === todayKey && !['cancelled', 'no_show'].includes(item.status)).slice(0, 8);
    const summary = state.data.waitlistSummary || {};
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
    main.innerHTML = `${pageHead('پذیرش مهمان', 'صف انتظار', 'شماره تماس کافی است؛ میز را فقط وقتی مهمان آمادهٔ نشستن است انتخاب کنید.', '<button class="role-primary" id="waitlist-add">+ پذیرش مهمان حضوری</button>')}
      <section class="waitlist-summary" aria-label="خلاصه صف"><article><strong>${num(summary.waiting || 0)}</strong><span>در انتظار</span></article><article class="is-called"><strong>${num(summary.called || 0)}</strong><span>منتظر آمدن</span></article><article class="is-seated"><strong>${num(summary.seated || 0)}</strong><span>نشسته</span></article></section>
      <section class="role-section waitlist-panel"><div class="role-section__head"><h2>مهمان‌های منتظر</h2><span>${num(active.length)} نفر فعال</span></div><div class="waitlist-list">${active.map(card).join('') || empty('صف انتظار خالی است؛ مهمان حضوری بعدی را همین‌جا ثبت کنید.')}</div></section>
      <section class="role-section reservation-panel"><div class="role-section__head"><h2>رزروهای زمان‌دار امروز</h2><span>${num(timedToday.length)} رزرو</span></div><div class="reservation-mini-list">${timedCards || empty('برای امروز رزرو زمان‌داری ثبت نشده است.')}</div></section>
      ${history.length ? `<section class="role-section waitlist-history"><div class="role-section__head"><h2>پایان‌یافته‌های اخیر</h2><span>فقط برای پیگیری</span></div><div class="reservation-mini-list">${history.map((entry) => `<article class="reservation-mini-card"><div><strong>${esc(entry.name || 'مهمان حضوری')}</strong><span dir="ltr">${esc(entry.phone)}</span></div><b>${entry.status === 'left' ? 'خارج شد' : 'لغو شد'}</b></article>`).join('')}</div></section>` : ''}`;
    document.getElementById('waitlist-add')?.addEventListener('click', openWaitlistDialog);
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
    document.getElementById('waitlist-submit')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const phone = normalizeDigits(document.getElementById('waitlist-phone')?.value || '').replace(/\D/g, '');
      if (!/^09\d{9}$/.test(phone)) return showToast('شماره موبایل ۱۱ رقمی وارد کنید.', 'error');
      setBusy(button, true);
      try {
        await api('/api/waiter/waitlist', { method: 'POST', headers: { 'Idempotency-Key': `waitlist-${state.branchId}-${Date.now()}-${Math.random().toString(16).slice(2)}` }, body: JSON.stringify({ branchId: state.branchId, phone, name: document.getElementById('waitlist-name')?.value || '', partySize: normalizeDigits(document.getElementById('waitlist-party')?.value || ''), note: document.getElementById('waitlist-note')?.value || '' }) });
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
    const branchParam = state.branchId ? `&branchId=${encodeURIComponent(state.branchId)}` : '';
    const data = await api(`/api/staff/menu?lang=fa${branchParam}`);
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
    const data = await api(`/api/kitchen/orders${qs()}`);
    const openCount = (data.tickets || []).filter((ticket) => ticket.column !== 'ready').length;
    if (state.kdsLastOpenCount !== null && openCount > state.kdsLastOpenCount) kdsBeep();
    state.kdsLastOpenCount = openCount;
    state.data = { kitchen: data };
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

  function kdsItemMarkup(item, ticket) {
    const completed = !!item.completedAt;
    const modifiers = (item.modifiers || []).map((entry) => `<span>${esc(entry.name)}</span>`).join('');
    const allergens = (item.allergens || []).map((entry) => KDS_ALLERGENS[entry] || entry).join('، ');
    const courseLabels = { starters: 'پیش‌غذا', entrees: 'غذای اصلی', dessert: 'دسر', straight_fire: 'پخت فوری' };
    const courseLabel = courseLabels[item.course] || '';
    const isHold = item.courseStatus === 'hold';
    const courseTag = isHold
      ? `<span class="kds-course-tag is-hold" style="background:#fef3c7;color:#b45309;padding:1px 6px;border-radius:6px;font-size:10px;font-weight:900">⏳ ${courseLabel || 'در انتظار فراخوان'} (Hold)</span>`
      : courseLabel ? `<span class="kds-course-tag" style="background:#e0f2fe;color:#0369a1;padding:1px 6px;border-radius:6px;font-size:10px;font-weight:900">🔥 ${courseLabel}</span>` : '';
    const seatTag = Number(item.seat) > 0 ? `<span style="background:#f1f5f9;color:#475569;padding:1px 5px;border-radius:6px;font-size:9.5px;font-weight:800">ص${num(item.seat)}</span>` : '';

    return `<button class="kds-item ${completed ? 'is-complete' : ''} ${isHold ? 'is-held' : ''} ${Number(item.qty) > 1 ? 'is-multi' : ''}" type="button" data-kds-item="${esc(item.key)}" data-ticket-id="${ticket.id}" data-completed="${completed}" aria-label="${completed ? 'بازگردانی' : 'تکمیل'} ${esc(item.name)}">
      <span class="kds-item__qty">${num(item.qty)}×</span><span class="kds-item__body"><b>${esc(item.name)} ${seatTag} ${courseTag}</b>${item.kind === 'complement' ? `<small>مکمل ${esc(item.parentName || '')}</small>` : ''}${modifiers ? `<small class="kds-item__mods">${modifiers}</small>` : ''}${item.note ? `<small class="kds-item__note">${esc(item.note)}</small>` : ''}${allergens ? `<strong class="kds-item__allergen">⚠ ${esc(allergens)}</strong>` : ''}</span><span class="kds-item__check">${completed ? '✓' : ''}</span>
    </button>`;
  }


  function kdsTicketMarkup(ticket, shortcut) {
    const settings = normalizeKdsSettings();
    const allDone = (ticket.items || []).length > 0 && (ticket.items || []).every((item) => item.completedAt);
    const stationItems = ticket.items || [];
    const selected = String(state.kdsSelectedTicketId || '') === String(ticket.id);
    const fulfillment = ticket.fulfillment === 'delivery' ? 'ارسال' : ticket.fulfillment === 'pickup' ? 'بیرون‌بر' : 'داخل مجموعه';
    const location = ticket.tableNo ? `میز ${ticket.tableNo}` : ticket.fulfillment === 'delivery' ? 'ارسال با پیک' : 'تحویل پیشخوان';
    const primary = ticket.column === 'ready'
      ? `<button class="kds-ticket__primary is-recall" type="button" data-kds-action="recall_ticket" data-ticket-id="${ticket.id}">بازگردانی به صف</button>`
      : ticket.column === 'new'
        ? `<button class="kds-ticket__primary" type="button" data-kds-action="start_ticket" data-ticket-id="${ticket.id}">شروع آماده‌سازی</button>`
        : `<button class="kds-ticket__primary" type="button" data-kds-action="complete_ticket" data-ticket-id="${ticket.id}" ${allDone ? '' : 'disabled'}>${allDone ? 'آماده تحویل' : `منتظر ${num(stationItems.filter((item) => !item.completedAt).length)} قلم`}</button>`;
    return `<article class="kds-ticket kds-ticket--${esc(ticket.fulfillment || 'pickup')} ${ticket.kds?.priority ? 'is-priority' : ''} ${ticket.kitchenNote ? 'needs-attention' : ''} ${selected ? 'is-selected' : ''}" data-ticket-id="${ticket.id}" data-age-sec="${Number(ticket.ageSec) || 0}" data-rendered-at="${Date.now()}" tabindex="${selected ? '0' : '-1'}" aria-selected="${selected}">
      <header class="kds-ticket__head"><div><span class="kds-shortcut">${num(shortcut)}</span><div><b>${esc(location)}</b><small>${esc(ticket.orderNo || `#${ticket.id}`)}</small></div></div><div><span>${esc(fulfillment)}</span><time data-kds-age>${kdsAgeLabel(ticket.ageSec)}</time></div></header>
      <div class="kds-ticket__meta"><span>${ticket.column === 'new' ? 'جدید' : ticket.column === 'preparing' ? 'در حال آماده‌سازی' : 'آماده'}</span>${ticket.name ? `<b>${esc(ticket.name)}</b>` : ''}${ticket.kds?.priority ? '<strong>اولویت</strong>' : ''}</div>
      <div class="kds-ticket__items">${(ticket.items || []).map((item) => kdsItemMarkup(item, ticket)).join('') || empty('غذایی برای این ایستگاه نیست.')}</div>
      ${ticket.note ? `<p class="kds-note"><b>یادداشت سفارش</b>${esc(ticket.note)}</p>` : ''}${ticket.kitchenNote ? `<p class="kds-note is-kitchen"><b>پیام آشپزخانه</b>${esc(ticket.kitchenNote)}</p>` : ''}
      <footer class="kds-ticket__footer"><button type="button" data-kds-priority data-ticket-id="${ticket.id}" aria-label="${ticket.kds?.priority ? 'برداشتن اولویت' : 'اولویت دادن'}">${ticket.kds?.priority ? '★' : '↑'}</button><button type="button" data-kds-note data-ticket-id="${ticket.id}" aria-label="یادداشت آشپزخانه">✎</button>${primary}</footer>
    </article>`;
  }

  function kdsUndoMarkup() {
    if (!state.kdsUndo || Date.now() >= state.kdsUndo.expiresAt) return '';
    return `<div class="kds-undo" role="status"><span>${esc(state.kdsUndo.label)}</span><button type="button" id="kds-undo-action">بازگردانی</button><i style="--undo-duration:${state.kdsUndo.expiresAt - Date.now()}ms"></i></div>`;
  }

  function kitchenBoard(readyOnly = false) {
    const data = state.data.kitchen;
    const settings = normalizeKdsSettings();
    const filtered = kdsFilteredTickets(readyOnly);
    const pageSize = kdsPageSize();
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    state.kdsPage = Math.min(state.kdsPage, pages - 1);
    const visible = filtered.slice(state.kdsPage * pageSize, (state.kdsPage + 1) * pageSize);
    const average = Number(data.performance?.averagePrepSec || 0);
    const openUnits = (data.tickets || []).filter((ticket) => ticket.column !== 'ready').reduce((sum, ticket) => sum + (ticket.items || []).filter((item) => !item.completedAt).reduce((count, item) => count + Math.max(1, Number(item.qty) || 1), 0), 0);
    main.innerHTML = `<section class="kds-shell is-${settings.layout} is-text-${settings.textSize}" style="--kds-columns:${kdsColumns()};--kds-rows:${settings.layout === 'rail' ? 1 : innerHeight >= 840 ? 3 : 2}">
      <header class="kds-command"><div class="kds-command__summary"><span class="kds-live ${state.kdsConnected ? 'is-online' : ''}"><i></i>${state.kdsConnected ? 'زنده' : 'در حال اتصال'}</span><strong>${readyOnly ? 'آماده تحویل' : 'صف آشپزخانه'}</strong><small>${num(filtered.length)} سفارش · میانگین ${average ? kdsAgeLabel(average) : 'بدون سابقه'}</small></div>
        <div class="kds-unified-station" role="status" aria-label="صف یکپارچه آشپزخانه"><span class="kds-unified-station__icon">⌘</span><span><b>${kdsStationLabel()}</b><small>غذا · قهوه · نوشیدنی</small></span><strong>${num(openUnits)} قلم</strong></div>
        <div class="kds-command__actions"><label><span>⌕</span><input id="kds-search" value="${esc(state.kdsSearch)}" placeholder="سفارش، میز یا غذا" /></label><button type="button" id="kds-all-day">شمارش کل</button><button type="button" id="kds-availability">موجودی</button><button type="button" id="kds-settings">تنظیمات</button></div>
      </header>
      <div class="kds-subbar"><div class="kds-fulfillment">${[['all','همه'],['dine_in','سالن'],['pickup','بیرون‌بر'],['delivery','ارسال']].map(([id,label]) => `<button type="button" data-kds-fulfillment="${id}" class="${state.kdsFulfillment === id ? 'active' : ''}">${label}</button>`).join('')}</div><div class="kds-pressure"><span>جدید <b>${num(data.counts?.new || 0)}</b></span><span>در تولید <b>${num(data.counts?.preparing || 0)}</b></span><span>آماده <b>${num(data.counts?.ready || 0)}</b></span>${state.kdsHighlightItem ? `<button type="button" id="kds-clear-highlight">نمایش: ${esc(state.kdsHighlightItem)} ×</button>` : ''}</div><div class="kds-pager"><button type="button" data-kds-page="-1" ${state.kdsPage <= 0 ? 'disabled' : ''}>→</button><span>${num(state.kdsPage + 1)} / ${num(pages)}</span><button type="button" data-kds-page="1" ${state.kdsPage >= pages - 1 ? 'disabled' : ''}>←</button></div></div>
      <section class="kds-ticket-grid">${visible.map((ticket, index) => kdsTicketMarkup(ticket, index + 1)).join('') || `<div class="kds-empty"><b>${readyOnly ? 'سفارش آماده‌ای نیست' : 'صف آشپزخانه خالی است'}</b><span>سفارش جدید به‌صورت زنده اینجا ظاهر می‌شود.</span></div>`}</section>
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
        ticket.classList.toggle('is-warn', age >= settings.warnMinutes * 60 && age < settings.lateMinutes * 60);
        ticket.classList.toggle('is-late', age >= settings.lateMinutes * 60);
      });
    };
    update();
    state.kdsClockTimer = setInterval(update, 1000);
  }

  function setKdsUndo(label, orderId, payload) {
    clearTimeout(state.kdsUndoTimer);
    state.kdsUndo = { label, orderId, payload, expiresAt: Date.now() + 5000 };
    state.kdsUndoTimer = setTimeout(() => { state.kdsUndo = null; document.querySelector('.kds-undo')?.remove(); }, 5050);
  }

  async function runKdsAction(button, orderId, payload, success, undo = null) {
    const ticketKey = String(orderId);
    if (state.kdsPendingTickets.has(ticketKey)) return;
    state.kdsPendingTickets.add(ticketKey);
    const ticket = button?.closest?.('.kds-ticket');
    ticket?.setAttribute('aria-busy', 'true');
    ticket?.querySelectorAll('button').forEach((control) => { control.disabled = true; });
    setBusy(button, true);
    try {
      await api(`/api/kitchen/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify({ ...payload, branchId: state.branchId }) });
      if (undo) setKdsUndo(undo.label, orderId, undo.payload);
      showToast(success);
      await fetchKitchen();
      kitchenBoard(state.activeView === 'ready');
    } catch (error) { showToast(error.message, 'error'); }
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
    openDialog('دسترسی منو', 'موجودی فوری منو', `<label class="kds-dialog-search"><span>⌕</span><input id="kds-availability-search" placeholder="جست‌وجوی غذا" /></label><div class="kds-availability-list">${rows.map((item) => `<button type="button" data-kds-availability-id="${item.id}" data-available="${item.available}"><span><b>${esc(item.name)}</b><small>${esc(item.categoryName)}</small></span><strong>${item.available ? 'موجود' : 'ناموجود'}</strong></button>`).join('')}</div>`);
    const filter = () => { const q = document.getElementById('kds-availability-search').value.trim(); dialogBody.querySelectorAll('[data-kds-availability-id]').forEach((button) => { button.hidden = q && !button.innerText.includes(q); }); };
    document.getElementById('kds-availability-search').addEventListener('input', filter);
    dialogBody.querySelectorAll('[data-kds-availability-id]').forEach((button) => button.addEventListener('click', async () => {
      setBusy(button, true);
      try {
        await api(`/api/kitchen/items/${button.dataset.kdsAvailabilityId}/availability`, { method: 'PATCH', body: JSON.stringify({ available: button.dataset.available !== 'true' }) });
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
    document.getElementById('kds-undo-action')?.addEventListener('click', async (event) => { const undo = state.kdsUndo; if (!undo) return; clearTimeout(state.kdsUndoTimer); state.kdsUndo = null; await runKdsAction(event.currentTarget, undo.orderId, undo.payload, 'عملیات بازگردانده شد.'); });
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
    clearFloorCountdown();
    if (role === 'waiter') clearRoleHeaderContext();
    document.getElementById('role-app').setAttribute('aria-busy', 'true');
    try {
      if (!isViewFeatureEnabled(state.activeView)) {
        main.innerHTML = `${pageHead('قابلیت غیرفعال', 'دسترسی محدود شده است', 'این بخش توسط کنترل‌پلن NEEM برای این مجموعه غیرفعال شده است.')}
          <section class="role-section">
            <div class="empty-state" style="padding:48px 24px; text-align:center;">
              <div style="font-size:48px; margin-bottom:16px;">🔒</div>
              <h2 style="font-size:18px; font-weight:700; margin-bottom:8px; color:var(--text, #f8fafc);">این بخش توسط کنترل‌پلن NEEM غیرفعال شده است</h2>
              <p style="color:var(--muted, #94a3b8); max-width:440px; margin:0 auto 20px; font-size:13px; line-height:1.7;">
                برای دسترسی و فعال‌سازی این بخش، قابلیت مربوطه را در مرکز کنترل NEEM (پورت ۳۰۵۰) فعال نمایید.
              </p>
            </div>
          </section>`;
        return;
      }
      if (role === 'cashier') {
        await fetchCashier();
        if (state.activeView === 'floor') cashierFloor();
        else if (state.activeView === 'orders') cashierOrders();
        else if (state.activeView === 'transactions') cashierTransactions();
        else if (state.activeView === 'drawer') cashierDrawer();
        else cashierMenu();
      }
      if (role === 'waiter') { await fetchWaiter(); if (state.activeView === 'calls') waiterCalls(); else if (state.activeView === 'orders') waiterOrders(); else if (state.activeView === 'reservations') waiterReservations(); else waiterFloor(); }
      if (role === 'kitchen') {
        if (state.activeView === 'inventory') { await fetchKitchenInventory(); kitchenInventoryPage(); }
        else { await fetchKitchen(); kitchenBoard(state.activeView === 'ready'); }
      }
    } catch (error) {
      main.innerHTML = `${pageHead('خطا', 'فضای کاری بارگذاری نشد', error.message)}<section class="role-section">${empty(error.message)}<button class="role-primary" id="retry" style="margin-top:12px">تلاش دوباره</button></section>`;
      document.getElementById('retry')?.addEventListener('click', render);
    } finally { document.getElementById('role-app').setAttribute('aria-busy', 'false'); }
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
      try {
        const callsData = await api(`/api/waiter/calls${qs()}`);
        const currentCalls = callsData?.calls || [];
        const currentKeys = currentCalls.map((c) => `${c.id}:${c.status}:${c.tableNo}`).join('|');

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

          await fetchWaiter();
          if (!dialog.open) {
            if (state.activeView === 'floor') waiterFloor();
            else if (state.activeView === 'calls') waiterCalls();
            else if (state.activeView === 'reservations') waiterReservations();
          }
        }
      } catch (e) {}
    }, 1500);
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
        if (!dialog.open && !state.waiterFloorEditing) {
          if (role === 'waiter') {
            await fetchWaiter();
            if (state.activeView === 'floor') waiterFloor();
            else if (state.activeView === 'calls') waiterCalls();
            else if (state.activeView === 'reservations') waiterReservations();
          } else {
            render();
          }
        }
      }, delay);
    };

    state.stream.addEventListener('open', () => {
      state.kdsConnected = true;
      document.querySelector('.kds-live')?.classList.add('is-online');
      const label = document.querySelector('.kds-live');
      if (label) label.lastChild.textContent = 'زنده';
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
    if (event.key === 'F2') {
      event.preventDefault();
      openNewCheck();
      return;
    }
    if (event.key === 'F4') {
      event.preventDefault();
      document.getElementById('pos-pay')?.click();
      return;
    }
    if (event.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
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
            fetchWaiter().then(() => {
              if (!dialog.open && !state.waiterFloorEditing) {
                if (state.activeView === 'floor') waiterFloor();
                else if (state.activeView === 'calls') waiterCalls();
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
