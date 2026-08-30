/* WESTO role workspaces: cashier, waiter and kitchen/inventory operations. */
(() => {
  'use strict';

  const role = location.pathname.split('/').filter(Boolean).pop();
  const allowedRoles = new Set(['cashier', 'waiter', 'kitchen']);
  const main = document.getElementById('role-main');
  const nav = document.getElementById('role-nav');
  const toast = document.getElementById('role-toast');
  const dialog = document.getElementById('role-dialog');
  const dialogBody = document.getElementById('dialog-body');
  const readLocal = (key, fallback) => {
    try { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); }
    catch { return fallback; }
  };
  const state = {
    session: null, branchId: null, activeView: '', data: {}, menuItems: [], menuCategories: [], menuComplements: [], menuComplementRules: [],
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
    };
    const code = typeof data?.error === 'object' ? data.error.code : data?.error;
    const message = typeof data?.error === 'object' ? data.error.message : null;
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

  function openDialog(kicker, title, body) {
    document.getElementById('dialog-kicker').textContent = kicker;
    document.getElementById('dialog-title').textContent = title;
    dialogBody.innerHTML = body;
    dialog.showModal();
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
    preview.hidden = !data.workspace.preview;
    document.getElementById('role-manager-back').hidden = !data.workspace.returnPath;
    const select = document.getElementById('role-branch-select');
    select.innerHTML = (data.branches || []).map((branch) => `<option value="${branch.id}" ${Number(branch.id) === Number(state.branchId) ? 'selected' : ''}>${esc(branch.name)}</option>`).join('');
    select.onchange = () => {
      state.branchId = Number(select.value) || null;
      localStorage.setItem('westo_staff_branch', String(state.branchId || ''));
      startStream();
      render();
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

  function paintNav() {
    const config = ROLE_CONFIG[role];
    if (!state.activeView) {
      const requested = new URLSearchParams(location.search).get('view');
      state.activeView = config.views.some(([id]) => id === requested) ? requested : config.views[0][0];
    }
    syncKitchenScrollMode();
    nav.innerHTML = config.views.map(([id, label]) => `<button type="button" data-view="${id}" class="${state.activeView === id ? 'active' : ''}">${esc(label)}</button>`).join('');
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

  function openNewCheck() {
    const tables = state.data.floor?.tables || [];
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
      const paintTables = () => {
        picker.innerHTML = `<div class="pos-dialog-title"><button type="button" id="pos-back-order-type">← نوع سفارش</button><b>میز را انتخاب کنید</b><span>${num(activeTables.length)} میز</span></div><div class="pos-table-picker">${activeTables.map((table) => `<button type="button" data-pos-table="${esc(table.id)}" data-state="${esc(table.state)}"><b>${esc(table.label || `میز ${table.id}`)}</b><small>${esc(table.zone || 'سالن')} · ${num(table.seats)} نفر</small><span>${esc(table.stateLabel || 'آزاد')}</span></button>`).join('')}</div>`;
        picker.querySelector('#pos-back-order-type').addEventListener('click', () => { picker.hidden = true; dialogBody.querySelector('.pos-order-types').hidden = false; });
        picker.querySelectorAll('[data-pos-table]').forEach((tableButton) => tableButton.addEventListener('click', () => {
          const table = tables.find((item) => String(item.id) === String(tableButton.dataset.posTable));
          const openOrder = !table?.autoReleased && (state.data.orders || []).find((order) => orderIsOpen(order) && String(order.tableNo) === String(tableButton.dataset.posTable) && (!table?.serviceOrderId || Number(order.id) === Number(table.serviceOrderId)));
          if (openOrder) state.pendingPosItem = null, state.posCheck = posCheckFromOrder(openOrder), dialog.close(), cashierMenu();
          else startPosCheck('dine_in', tableButton.dataset.posTable);
        }));
      };
      paintTables();
    }));
  }

  function posLocationLabel(check) {
    if (!check) return 'سفارش جدید';
    if (check.fulfillment === 'dine_in') return `میز ${check.tableNo}`;
    return 'بیرون‌بر';
  }

  function posCategoryMarkup() {
    const categories = state.menuCategories.filter((category) => state.menuItems.some((item) => Number(item.categoryId) === Number(category.id)));
    const query = state.posSearch.trim();
    const normalizedQuery = query.toLowerCase();
    if (!query && !state.posCategory) {
      return `<div class="pos-category-deck">${categories.map((category, index) => {
        const count = state.menuItems.filter((item) => Number(item.categoryId) === Number(category.id)).length;
        return `<button type="button" class="pos-category-card" data-pos-category="${category.id}" style="--pos-category-index:${index}">${category.coverImg ? `<img src="${esc(category.coverImg)}" alt="" />` : '<span class="pos-category-card__placeholder" aria-hidden="true">و</span>'}<span class="pos-category-card__content"><b>${esc(category.title || category.name1 || 'دسته')}</b><small>${num(count)} محصول</small></span><i aria-hidden="true">←</i></button>`;
      }).join('')}</div>`;
    }
    const category = categories.find((entry) => Number(entry.id) === Number(state.posCategory));
    const matchedItems = state.menuItems.filter((item) => (!query || `${item.name} ${item.en || ''}`.toLowerCase().includes(normalizedQuery)) && (query || Number(item.categoryId) === Number(state.posCategory)));
    const items = matchedItems.slice(0, 25);
    const columns = items.length > 15 ? 5 : items.length > 8 ? 3 : 2;
    const rows = Math.max(1, Math.ceil(items.length / columns));
    const mobileColumns = items.length > 15 ? 5 : columns;
    const mobileRows = Math.max(1, Math.ceil(items.length / mobileColumns));
    const density = items.length > 15 ? 'dense' : items.length > 8 ? 'medium' : 'relaxed';
    const searchHint = query && matchedItems.length > items.length ? `<div class="pos-search-hint">${num(matchedItems.length)} نتیجه · برای نمایش دقیق‌تر عبارت بیشتری بنویسید</div>` : '';
    const path = query ? `<div class="pos-menu-path"><button type="button" id="pos-clear-search">→ پاک‌کردن جست‌وجو</button><div><b>نتایج جست‌وجو</b><span>${num(matchedItems.length)} نتیجه</span></div></div>` : `<div class="pos-menu-path"><button type="button" id="pos-back-categories">→ همه دسته‌ها</button><div><b>${esc(category?.title || 'منو')}</b><span>${num(matchedItems.length)} محصول</span></div></div>`;
    return `${path}${searchHint}<div class="pos-product-grid" data-density="${density}" style="--pos-cols:${columns};--pos-rows:${rows};--pos-grid-max:${rows * 118}px;--pos-mobile-cols:${mobileColumns};--pos-mobile-rows:${mobileRows};--pos-mobile-grid-max:${mobileRows * 82}px">${items.map((item) => `<article class="pos-product-card"><button type="button" class="pos-product-card__add" data-pos-quick-add="${item.id}">${item.img ? `<img src="${esc(item.img)}" alt="" />` : '<span class="pos-product-card__placeholder" aria-hidden="true">و</span>'}<span class="pos-product-card__info"><b>${esc(item.name)}</b><small>${money(item.price)}</small><span>+ افزودن</span></span></button></article>`).join('') || empty('محصولی در این دسته پیدا نشد.')}</div>`;
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
    main.querySelectorAll('[data-pos-category]').forEach((button) => button.addEventListener('click', () => { state.posCategory = Number(button.dataset.posCategory); state.posSearch = ''; cashierMenu(); }));
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
    const item = existing || state.menuItems.find((entry) => Number(entry.id) === Number(menuItemId));
    if (!item) return;
    const selected = new Set((existing?.modifiers || []).map((modifier) => modifier.name));
    openDialog('ویرایش محصول', item.name, `<div class="modifier-layout"><section><div class="modifier-base"><span>قیمت پایه</span><b>${money(item.price)}</b></div>${POS_MODIFIERS.map((group) => `<div class="modifier-group"><h3>${esc(group.group)}</h3><div>${group.items.map((modifier) => `<label><input type="checkbox" value="${esc(modifier.name)}" ${selected.has(modifier.name) ? 'checked' : ''}/><span>${esc(modifier.name)}</span><small>${modifier.price ? `+ ${money(modifier.price)}` : 'بدون هزینه'}</small></label>`).join('')}</div></div>`).join('')}</section><aside><label class="field"><span>یادداشت محصول</span><textarea id="modifier-note" rows="4" maxlength="180">${esc(existing?.note || '')}</textarea></label><label class="field"><span>شماره صندلی (اختیاری)</span><input id="modifier-seat" type="number" min="0" max="99" value="${Number(existing?.seat || 0)}" /></label><div class="modifier-qty"><button type="button" data-mod-qty="-1">−</button><b id="modifier-qty">${num(existing?.qty || 1)}</b><button type="button" data-mod-qty="1">+</button></div><button type="button" class="pos-pay" id="modifier-save">${existing ? 'ذخیره تغییرات' : 'افزودن به فاکتور'}</button>${existing ? '<button type="button" class="role-danger" id="modifier-remove">حذف از سفارش</button>' : ''}</aside></div>`);
    let qty = Number(existing?.qty || 1);
    dialogBody.querySelectorAll('[data-mod-qty]').forEach((button) => button.addEventListener('click', () => { qty = Math.max(1, Math.min(99, qty + Number(button.dataset.modQty))); document.getElementById('modifier-qty').textContent = num(qty); }));
    document.getElementById('modifier-save').addEventListener('click', () => {
      const modifiers = [...dialogBody.querySelectorAll('.modifier-group input:checked')].map((input) => POS_MODIFIERS.flatMap((group) => group.items).find((modifier) => modifier.name === input.value)).filter(Boolean);
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
    document.getElementById('pos-save-guest').addEventListener('click', () => { state.posCheck.customerName = document.getElementById('pos-guest-name').value.trim(); state.posCheck.phone = document.getElementById('pos-guest-phone').value.trim(); dialog.close(); cashierMenu(); });
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
      const p = document.getElementById('pos-loyalty-phone')?.value.trim();
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
      const p = document.getElementById('pos-loyalty-phone')?.value.trim();
      const res = await api(`/api/cashier/orders/${order.id}/apply-loyalty`, {
        method: 'POST',
        body: JSON.stringify({ phone: p, apply: true, redeemPoints: 0 }),
      });
      showToast('تخفیف سطح باشگاه روی فاکتور اعمال شد');
      openPayment(res.order);
    });

    document.getElementById('pos-apply-points-btn')?.addEventListener('click', async () => {
      const p = document.getElementById('pos-loyalty-phone')?.value.trim();
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
    document.getElementById('split-custom-apply').addEventListener('click', () => openPayment(order, Number(document.getElementById('split-custom').value)));
    document.getElementById('custom-cash').addEventListener('click', () => { document.getElementById('custom-cash-row').hidden = false; document.getElementById('cash-received').focus(); });
    document.getElementById('cash-confirm').addEventListener('click', (event) => settlePosOrder(order, 'cash', Number(document.getElementById('cash-received').value), charge, event.currentTarget));
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
    const tables = state.data.floor?.tables || [];
    const zones = [...new Set(tables.map((table) => table.zone || 'سالن'))];
    if (state.floorZone !== 'all' && !zones.includes(state.floorZone)) state.floorZone = 'all';
    const visibleTables = state.floorZone === 'all' ? tables : tables.filter((table) => (table.zone || 'سالن') === state.floorZone);
    const zoneButton = (id, label, count) => `<button type="button" data-floor-zone="${esc(id)}" class="${state.floorZone === id ? 'active' : ''}" aria-pressed="${state.floorZone === id}"><span>${esc(label)}</span><small>${num(count)}</small></button>`;
    const tableCard = (table) => `<button type="button" data-cashier-table="${esc(table.id)}" data-state="${esc(table.state)}" ${table.autoReleased ? 'data-auto-released="true"' : ''}><b>${esc(table.label || table.id)}</b><small>${esc(table.zone || 'سالن')} · ${num(table.seats)} نفر</small><span>${esc(table.autoReleased ? 'آزادشده خودکار' : table.stateLabel || 'آزاد')}</span>${table.serviceEndsAt && !table.autoReleased && ['busy', 'attention'].includes(table.state) ? `<time data-service-ends="${esc(table.serviceEndsAt)}">${floorCountdownLabel(table.serviceEndsAt)}</time>` : ''}</button>`;
    main.innerHTML = `${pageHead('مدیریت سالن', 'نقشه سالن', 'میزهای باز، آزاد و نیازمند رسیدگی', '<button class="role-primary" id="floor-new">+ سفارش جدید</button>')}<section class="pos-floor"><div class="pos-floor__zones" aria-label="انتخاب بخش رستوران">${zoneButton('all', 'همه', tables.length)}${zones.map((zone) => zoneButton(zone, zone, tables.filter((table) => (table.zone || 'سالن') === zone).length)).join('')}</div><div class="pos-floor__map">${visibleTables.map(tableCard).join('') || empty('در این بخش میزی تعریف نشده است.')}</div><footer><span><i class="is-free"></i> آزاد</span><span><i class="is-busy"></i> در سرویس</span><span><i class="is-call"></i> فراخوان</span><b>آزادسازی خودکار پس از ${num(state.data.floor?.summary?.serviceMinutes || 45)} دقیقه</b></footer></section>`;
    document.getElementById('floor-new').addEventListener('click', openNewCheck);
    main.querySelectorAll('[data-floor-zone]').forEach((button) => button.addEventListener('click', () => {
      state.floorZone = button.dataset.floorZone;
      cashierFloor();
    }));
    main.querySelectorAll('[data-cashier-table]').forEach((button) => button.addEventListener('click', () => {
      const table = tables.find((item) => String(item.id) === String(button.dataset.cashierTable));
      const order = !table?.autoReleased && (state.data.orders || []).find((item) => orderIsOpen(item) && String(item.tableNo) === String(button.dataset.cashierTable) && (!table?.serviceOrderId || Number(item.id) === Number(table.serviceOrderId)));
      if (order) state.posCheck = posCheckFromOrder(order), state.activeView = 'menu', paintNav(), cashierMenu();
      else startPosCheck('dine_in', button.dataset.cashierTable);
    }));
    startFloorCountdown();
  }

  function floorCountdownLabel(endsAt) {
    const seconds = Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 1000));
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    const twoDigits = (value) => Number(value).toLocaleString('fa-IR', { minimumIntegerDigits: 2, useGrouping: false });
    return `زمان میز ${twoDigits(minutes)}:${twoDigits(remainder)}`;
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
      document.getElementById('drawer-open').addEventListener('click', (event) => action(event.currentTarget, () => api('/api/cashier/drawer/open', { method: 'POST', body: JSON.stringify({ branchId: state.branchId, openingAmount: Number(document.getElementById('drawer-opening').value) || 0 }) }), 'صندوق پول باز شد.'));
      return;
    }
    main.innerHTML = `${pageHead('مدیریت وجه نقد', 'صندوق پول', 'تمام جابه‌جایی‌های نقدی این نشست قابل تطبیق است')}
      <div class="role-grid"><section class="role-section role-section--8"><div class="drawer-card"><span>نشست باز از ${time(session.openedAt)}</span><div class="drawer-card__amount"><span>موجودی مورد انتظار</span><strong>${money(totals.expected)}</strong></div>
      <div class="drawer-breakdown"><div><span>اول شیفت</span><b>${money(totals.opening)}</b></div><div><span>فروش نقدی</span><b>${money(totals.sales)}</b></div><div><span>ورود نقدی</span><b>${money(totals.payIn)}</b></div><div><span>خروج/بازپرداخت</span><b>${money(totals.payOut + totals.refunds)}</b></div></div></div></section>
      <section class="role-section role-section--4"><div class="role-section__head"><h2>عملیات صندوق</h2><span>ثبت ممیزی‌شده</span></div><div class="field-grid">
        <label class="field field--full"><span>مبلغ</span><input id="movement-amount" inputmode="numeric" /></label><label class="field field--full"><span>شرح</span><input id="movement-note" maxlength="160" /></label>
      </div><div class="order-actions" style="margin-top:12px"><button class="role-secondary" data-movement="pay_in">ورود نقدی</button><button class="role-secondary" data-movement="pay_out">خروج نقدی</button><button class="role-danger" id="drawer-close">بستن و شمارش</button></div></section>
      <section class="role-section"><div class="role-section__head"><h2>گردش‌های نشست</h2><span>${num(session.movements?.length || 0)} رکورد</span></div><div class="order-list">${(session.movements || []).map((item) => `<div class="order-card"><div class="order-card__top"><strong>${esc(({ sale:'فروش نقدی', pay_in:'ورود نقدی', pay_out:'خروج نقدی', refund:'بازپرداخت' })[item.type] || item.type)}</strong><span>${time(item.at)}</span></div><div class="order-card__bottom"><span>${esc(item.note || '—')}</span><b>${money(item.amount)}</b></div></div>`).join('') || empty('هنوز گردشی ثبت نشده است.')}</div></section></div>`;
    main.querySelectorAll('[data-movement]').forEach((button) => button.addEventListener('click', () => action(button, () => api('/api/cashier/drawer/movements', { method: 'POST', body: JSON.stringify({ branchId: state.branchId, type: button.dataset.movement, amount: Number(document.getElementById('movement-amount').value) || 0, note: document.getElementById('movement-note').value }) }), 'گردش نقدی ثبت شد.')));
    document.getElementById('drawer-close').addEventListener('click', () => {
      openDialog('پایان نشست', 'شمارش صندوق', `<div class="field-grid"><label class="field field--full"><span>مبلغ شمارش‌شده</span><input id="drawer-counted" inputmode="numeric" value="${Math.round(totals.expected)}" /></label></div><p>انتظار سیستم: <b>${money(totals.expected)}</b></p><button class="role-danger" id="confirm-drawer-close">تأیید و بستن صندوق</button>`);
      document.getElementById('confirm-drawer-close').addEventListener('click', (event) => action(event.currentTarget, async () => { await api('/api/cashier/drawer/close', { method: 'POST', body: JSON.stringify({ branchId: state.branchId, countedAmount: Number(document.getElementById('drawer-counted').value) || 0 }) }); dialog.close(); }, 'صندوق بسته و تطبیق ثبت شد.'));
    });
  }

  async function fetchWaiter() {
    const [floor, calls, orders, reservations] = await Promise.all([
      api(`/api/admin/v2/floor${qs()}`), api(`/api/waiter/calls${qs()}`), api(`/api/admin/orders${qs()}`), api(`/api/admin/reservations${qs()}`),
    ]);
    state.data = { floor, calls: calls.calls || [], orders: orders.orders || [], reservations };
  }

  function waiterMetrics() {
    const activeOrders = (state.data.orders || []).filter((item) => item.fulfillment === 'dine_in' && !['done', 'cancelled'].includes(item.status));
    return `<section class="role-metrics">${metric('فراخوان باز', num(state.data.calls.length), state.data.calls.length ? 'نیازمند رسیدگی' : 'همه پاسخ داده شده')}${metric('میز در سرویس', num(state.data.floor.summary?.busy || 0))}${metric('سفارش فعال', num(activeOrders.length))}${metric('رزرو امروز', num(state.data.reservations.summary?.today || 0), `${num(state.data.reservations.summary?.todayCovers || 0)} نفر`)}</section>`;
  }

  function waiterFloor() {
    const tables = state.data.floor.tables || [];
    main.innerHTML = `${pageHead('مدیریت سالن', 'نقشه سالن', 'اولویت پاسخ به مهمان، وضعیت میز و ثبت سریع سفارش', '<button class="role-primary" id="new-order">سفارش کنار میز</button>')}${waiterMetrics()}
      <div class="role-grid"><section class="role-section role-section--8"><div class="role-section__head"><h2>میزها</h2><span>${num(tables.length)} میز</span></div><div class="floor-grid">${tables.map((table) => `<button class="floor-table" data-table="${esc(table.id)}" data-state="${esc(table.state)}"><strong>${esc(table.label || `میز ${table.id}`)}</strong><small>${num(table.seats)} نفر · ${esc(table.zone || 'سالن')}</small><span>${esc(table.stateLabel)}</span></button>`).join('') || empty('میزی تعریف نشده است.')}</div></section>
      <section class="role-section role-section--4"><div class="role-section__head"><h2>فراخوان‌های مهمان</h2><span>به ترتیب زمان</span></div>${callsHtml()}</section></div>`;
    document.getElementById('new-order').addEventListener('click', () => showOrderComposer('waiter'));
    main.querySelectorAll('[data-table]').forEach((button) => button.addEventListener('click', () => showTableDetail(button.dataset.table)));
    wireCalls();
  }

  function callsHtml() {
    return `<div class="call-list">${state.data.calls.map((call) => `<article class="call-row" data-call-id="${call.id}"><b>${esc(call.tableNo)}</b><div><p>${esc(call.note || 'درخواست گارسون')}</p><small>${num(ageMin(call.createdAt))} دقیقه قبل</small></div><button class="role-primary" data-resolve-call>رسیدگی شد</button></article>`).join('') || empty('فراخوان بازی وجود ندارد.')}</div>`;
  }

  function wireCalls() {
    main.querySelectorAll('[data-resolve-call]').forEach((button) => button.addEventListener('click', () => {
      const id = button.closest('[data-call-id]').dataset.callId;
      action(button, () => api(`/api/waiter/calls/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) }), 'فراخوان بسته شد.');
    }));
  }

  function showTableDetail(tableId) {
    const table = (state.data.floor.tables || []).find((item) => String(item.id) === String(tableId));
    const orders = (state.data.orders || []).filter((item) => String(item.tableNo) === String(tableId) && !['done', 'cancelled'].includes(item.status));
    openDialog('میز و سرویس', table?.label || `میز ${tableId}`, `<div class="role-metrics">${metric('وضعیت', table?.stateLabel || '—')}${metric('ظرفیت', `${num(table?.seats || 0)} نفر`)}${metric('سفارش فعال', num(orders.length))}${metric('ناحیه', table?.zone || 'سالن')}</div><div class="order-list">${orders.map((order) => orderCard(order)).join('') || empty('سفارش فعالی برای این میز نیست.')}</div><button class="role-primary" id="table-new-order" style="margin-top:12px">ثبت سفارش برای این میز</button>`);
    document.getElementById('table-new-order').addEventListener('click', () => { dialog.close(); showOrderComposer('waiter', tableId); });
  }

  function waiterCalls() {
    main.innerHTML = `${pageHead('رسیدگی به مهمان', 'فراخوان‌های مهمان', 'درخواست‌ها بر اساس زمان انتظار مرتب شده‌اند')}${waiterMetrics()}<section class="role-section"><div class="role-section__head"><h2>صف رسیدگی</h2><span>${num(state.data.calls.length)} فراخوان باز</span></div>${callsHtml()}</section>`;
    wireCalls();
  }

  function waiterOrders() {
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
    const list = (state.data.reservations.reservations || []).filter((item) => !['cancelled', 'no_show'].includes(item.status)).slice(0, 80);
    main.innerHTML = `${pageHead('برنامه مهمان‌ها', 'رزروهای سالن', 'مهمان‌های امروز، ساعت ورود و تعداد نفرات')}${waiterMetrics()}<section class="role-section"><div class="order-list">${list.map((item) => `<article class="order-card"><div class="order-card__top"><strong>${esc(item.name || item.phone)}</strong><span>${fmtDate(item.date)} · ${esc(item.time)}</span></div><div class="order-card__items">${num(item.partySize)} نفر ${item.tableNo ? `· میز ${esc(item.tableNo)}` : ''}</div><div class="order-card__bottom"><span>${esc(item.note || 'بدون یادداشت')}</span><b>${esc(({pending:'در انتظار',confirmed:'تأیید',seated:'نشسته'})[item.status] || item.status)}</b></div></article>`).join('') || empty('رزرو فعالی وجود ندارد.')}</div></section>`;
  }

  async function loadMenu() {
    if (state.menuItems.length) return;
    const data = await api('/api/staff/menu?lang=fa');
    state.menuItems = (data.menuItems || data.items || []).filter((item) => item.available !== false);
    state.menuCategories = data.menuCategories || [];
    state.menuComplements = data.menuComplements || [];
    state.menuComplementRules = data.menuComplementRules || [];
  }

  async function showOrderComposer(source, presetTable = '') {
    try { await loadMenu(); } catch (error) { return showToast(error.message, 'error'); }
    state.cart.clear();
    const tables = state.data.floor?.tables || [];
    const fulfillmentOptions = source === 'cashier' ? '<option value="dine_in">داخل مجموعه</option><option value="pickup">بیرون‌بر</option>' : '<option value="dine_in">داخل مجموعه</option>';
    openDialog('صندوق فروش', 'سفارش جدید', `<div class="field-grid" style="margin-bottom:12px"><label class="field"><span>نوع سفارش</span><select id="composer-fulfillment">${fulfillmentOptions}</select></label><label class="field"><span>میز</span><select id="composer-table"><option value="">انتخاب میز</option>${tables.map((table) => `<option value="${table.id}" ${String(table.id) === String(presetTable) ? 'selected' : ''}>${esc(table.label)}</option>`).join('')}</select></label><label class="field"><span>موبایل مهمان (اختیاری)</span><input id="composer-phone" inputmode="tel" /></label><label class="field"><span>یادداشت</span><input id="composer-note" maxlength="240" /></label></div>
      <div class="composer"><section class="composer-menu"><input class="composer-search" id="composer-search" placeholder="جست‌وجوی محصول…" /><div class="composer-items" id="composer-items"></div></section><aside class="composer-cart"><strong>سبد سفارش</strong><div class="cart-lines" id="cart-lines">${empty('محصولی انتخاب نشده است.')}</div><div class="cart-total"><span>جمع</span><b id="cart-total">۰ تومان</b></div><button class="role-primary" id="composer-submit" style="width:100%">ثبت و ارسال سفارش</button></aside></div>`);
    const paintItems = (query = '') => {
      const normalized = query.trim();
      document.getElementById('composer-items').innerHTML = state.menuItems.filter((item) => !normalized || String(item.name || '').includes(normalized)).slice(0, 120).map((item) => `<button class="composer-item" data-menu-id="${item.id}">${item.img ? `<img src="${esc(item.img)}" alt="" loading="lazy" />` : '<span></span>'}<span><strong>${esc(item.name)}</strong><span>${money(item.price)}</span></span><b>+</b></button>`).join('') || empty('محصولی پیدا نشد.');
      document.querySelectorAll('[data-menu-id]').forEach((button) => button.addEventListener('click', () => { const id = Number(button.dataset.menuId); state.cart.set(id, (state.cart.get(id) || 0) + 1); paintCart(); }));
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
    main.innerHTML = `${pageHead('عملیات انبار', 'دریافت، موجودی، ضایعات و تولید', 'شما فقط واقعیت فیزیکی را ثبت می‌کنید؛ قیمت خرید، حساب‌ها و مبلغ سند در این پنل نمایش داده نمی‌شوند.')}
      <div class="role-metrics">${metric('قابل دریافت', num(summary.receivablePurchaseOrderLines), 'فقط سفارش خرید تأییدشده')}${metric('اقلام انبار', num(summary.items))}${metric('نیازمند سفارش', num(summary.lowStock), 'بر پایه نقطه سفارش')}${metric('استثناهای باز', num(summary.exceptions), 'برای بازبینی حسابدار')}</div>
      <section class="inventory-actions" aria-label="ثبت عملیات انبار">
        <details class="inventory-action" ${receiptOptions ? 'open' : 'data-disabled="true"'}><summary><b>دریافت کالا</b><span>${receiptOptions ? 'سفارش تأییدشده، مقدار و حواله' : 'ردیف تأییدشده‌ای برای دریافت وجود ندارد'}</span></summary>${receiptOptions ? `<form id="inventory-receipt-form" class="field-grid">
          <label class="field field--full"><span>سفارش و ردیف کالا</span><select name="poLine" required><option value="">انتخاب ردیف قابل دریافت</option>${receiptOptions}</select></label>
          <label class="field"><span>مقدار تحویل‌شده</span><input name="receivedQuantity" type="number" min="0.000001" step="any" required></label>
          <label class="field"><span>شماره حواله تأمین‌کننده</span><input name="deliveryNoteNumber" maxlength="120"></label>
          <label class="field"><span>تاریخ دریافت</span><input name="receivedDate" type="date" value="${today}" required></label>
          <label class="field field--full"><span>یادداشت فیزیکی</span><input name="notes" maxlength="300" placeholder="مثلاً یک بسته آسیب‌دیده تحویل نشد"></label>
          <button class="role-primary field--full" type="submit">ثبت رسید و افزایش موجودی</button>
        </form>` : `<div class="inventory-action__empty">حسابدار باید سفارش خرید را ایجاد کند و مالک/مدیر آن را تأیید کند؛ انباردار قیمت یا حساب را تعیین نمی‌کند.</div>`}</details>
        <details class="inventory-action"><summary><b>ثبت ضایعات</b><span>کالا، مقدار و علت</span></summary><form id="inventory-waste-form" class="field-grid">
          <label class="field"><span>کالا</span><select name="itemId" required><option value="">انتخاب کالا</option>${itemOptions}</select></label>
          <label class="field"><span>مقدار</span><input name="quantity" type="number" min="0.000001" step="any" required></label>
          <label class="field field--full"><span>علت ضایعات</span><input name="reason" maxlength="300" minlength="3" required placeholder="مثلاً سوختگی در خط گرم"></label>
          <button class="role-primary field--full" type="submit">ثبت واقعیت فیزیکی ضایعات</button>
        </form></details>
        <details class="inventory-action"><summary><b>شمارش موجودی</b><span>مانده واقعی قفسه</span></summary><form id="inventory-count-form" class="field-grid">
          <label class="field"><span>کالا</span><select name="itemId" required><option value="">انتخاب کالا</option>${itemOptions}</select></label>
          <label class="field"><span>مقدار شمارش‌شده</span><input name="countedQuantity" type="number" min="0" step="any" required></label>
          <label class="field field--full"><span>یادداشت شمارش</span><input name="reason" maxlength="300" value="شمارش فیزیکی شیفت"></label>
          <button class="role-primary field--full" type="submit">ثبت شمارش و اختلاف</button>
        </form></details>
        <details class="inventory-action" ${recipes.length ? '' : 'data-disabled="true"'}><summary><b>ثبت مرحله تولید</b><span>${recipes.length ? 'مصرف مواد و ثبت محصول خروجی' : 'دستور تهیه تولید با کالای خروجی تنظیم نشده است'}</span></summary>${recipes.length ? `<form id="inventory-production-form" class="field-grid">
          <label class="field field--full"><span>دستور تهیه تولید</span><select name="recipeId" required><option value="">انتخاب دستور تهیه</option>${recipeOptions}</select></label>
          <label class="field"><span>بازده برنامه‌ریزی‌شده</span><input name="plannedYield" type="number" min="0.000001" step="any" required></label>
          <label class="field"><span>خروجی واقعی</span><input name="actualYield" type="number" min="0" step="any" required></label>
          <button class="role-primary field--full" type="submit">ثبت مصرف و محصول خروجی</button>
        </form>` : `<div class="inventory-action__empty">مدیر باید کالای خروجی دستور آماده‌سازی را تعریف کند؛ سامانه آن را حدس نمی‌زند.</div>`}</details>
        <details class="inventory-action inventory-action--wide" ${menuItemOptions && recipeIngredientOptions ? '' : 'data-disabled="true"'}><summary><b>نسخه جدید دستور تهیه فروش</b><span>${menuItemOptions && recipeIngredientOptions ? 'محصول واقعی منو، مواد و بازده؛ تأیید مستقل مالک' : 'ابتدا محصول منو و کالای انبار لازم است'}</span></summary>${menuItemOptions && recipeIngredientOptions ? `<form id="inventory-recipe-form" class="field-grid">
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
        </form>` : `<div class="inventory-action__empty">تا محصول واقعی منو و کالای انبار در همین شعبه وجود نداشته باشد، دستور تهیه ساخته نمی‌شود.</div>`}</details>
      </section>
      <div class="role-grid inventory-layout">
        <section class="role-section role-section--8"><div class="role-section__head"><h2>مانده قابل استفاده</h2><span>افتتاحیه + گردش‌های قطعی</span></div><div class="inventory-table" role="table">
          <div class="inventory-row inventory-row--head" role="row"><span>کالا</span><span>مانده</span><span>نقطه سفارش</span><span>وضعیت</span></div>
          ${items.map((item) => `<div class="inventory-row" role="row"><span><b>${esc(item.name)}</b><small>${esc(item.sku || item.id)}</small></span><strong>${item.availableQuantity == null ? '—' : `${num(item.availableQuantity)} ${esc(item.unit || '')}`}</strong><span>${item.reorderPoint == null ? 'تعریف نشده' : `${num(item.reorderPoint)} ${esc(item.unit || '')}`}</span><i data-status="${esc(item.status)}">${esc(inventoryStatusLabel(item.status))}</i></div>`).join('') || empty('کالای انباری برای این شعبه تعریف نشده است.')}
        </div></section>
        <section class="role-section role-section--4"><div class="role-section__head"><h2>ظرفیت قابل تولید</h2><span>بر اساس دستور تهیه و مانده فعلی</span></div><div class="inventory-capacity-list">${capacities.slice(0, 12).map((row) => `<article><div><b>${esc(row.name)}</b><small>${row.version ? `نسخه ${esc(row.version)}` : 'نسخه نامشخص'}</small></div><strong>${row.capacity == null ? '—' : num(row.capacity)}</strong><span>${row.status === 'available' ? `محدودکننده: ${esc(row.limitingIngredient?.name || '—')}` : 'دستور تهیه یا واحد ناقص'}</span></article>`).join('') || empty('برای محاسبه ظرفیت، دستور تهیه معتبر لازم است.')}</div></section>
        <section class="role-section"><div class="role-section__head"><h2>آخرین عملیات</h2><span>اصلاح فقط با سند معکوس مدیر انجام می‌شود.</span></div><div class="inventory-operation-list">${operations.map((row) => `<article><div><b>${esc(inventoryStatusLabel(row.source === 'inventory.waste' ? 'ضایعات' : row.source === 'inventory.stock_count' ? 'شمارش' : row.source === 'inventory.production_batch' ? 'مرحله تولید' : row.source === 'purchase.goods_received' ? 'دریافت کالا' : 'معکوس'))}</b><small>${fmtDate(row.occurredAt)} · ${time(row.occurredAt)}</small></div><span data-status="${esc(row.status)}">${esc(inventoryStatusLabel(row.status))}</span>${row.reason ? `<p>${esc(row.reason)}</p>` : ''}${row.issues?.length ? `<p class="is-warning">${num(row.issues.length)} هشدار برای بازبینی ثبت شد.</p>` : ''}</article>`).join('') || empty('هنوز عملیات جدید انبار ثبت نشده است.')}</div></section>
        <section class="role-section"><div class="role-section__head"><h2>نسخه‌های دستور تهیه فروش</h2><span>${num(summary.pendingRecipeVersions || 0)} منتظر تأیید · ${num(summary.approvedRecipeVersions || 0)} تأییدشده</span></div><div class="inventory-operation-list">${recipeVersions.map((row) => `<article><div><b>${esc(row.menuItemName || row.name)}</b><small>نسخه ${num(row.version)} · شروع ${fmtDate(row.effectiveFrom)} · ${num(row.ingredients?.length || 0)} ماده</small></div><span data-status="${esc(row.status)}">${esc(inventoryStatusLabel(row.status))}</span><p>${num(row.yieldQuantity)} پرس خروجی · ثبت‌کننده ${esc(row.createdBy || '—')}</p></article>`).join('') || empty('هنوز نسخهٔ دستور تهیه جدیدی ثبت نشده است.')}</div></section>
      </div>`;
    wireKitchenInventory();
  }

  function inventoryIdempotency(kind) {
    return `kitchen-inventory-${kind}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
    return `<button class="kds-item ${completed ? 'is-complete' : ''} ${Number(item.qty) > 1 ? 'is-multi' : ''}" type="button" data-kds-item="${esc(item.key)}" data-ticket-id="${ticket.id}" data-completed="${completed}" aria-label="${completed ? 'بازگردانی' : 'تکمیل'} ${esc(item.name)}">
      <span class="kds-item__qty">${num(item.qty)}×</span><span class="kds-item__body"><b>${esc(item.name)}</b>${item.kind === 'complement' ? `<small>مکمل ${esc(item.parentName || '')}</small>` : ''}${modifiers ? `<small class="kds-item__mods">${modifiers}</small>` : ''}${item.note ? `<small class="kds-item__note">${esc(item.note)}</small>` : ''}${allergens ? `<strong class="kds-item__allergen">⚠ ${esc(allergens)}</strong>` : ''}</span><span class="kds-item__check">${completed ? '✓' : ''}</span>
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
    document.getElementById('role-app').setAttribute('aria-busy', 'true');
    try {
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

  function startStream() {
    state.stream?.close();
    if (!window.EventSource) return;
    if (role === 'kitchen') state.kdsConnected = false;
    state.stream = new EventSource(`/api/admin/events${qs()}`);
    let timer = null;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { if (!dialog.open && document.visibilityState === 'visible') render(); }, 250); };
    state.stream.addEventListener('open', () => { state.kdsConnected = true; document.querySelector('.kds-live')?.classList.add('is-online'); const label = document.querySelector('.kds-live'); if (label) label.lastChild.textContent = 'زنده'; });
    state.stream.addEventListener('error', () => { state.kdsConnected = false; document.querySelector('.kds-live')?.classList.remove('is-online'); const label = document.querySelector('.kds-live'); if (label) label.lastChild.textContent = 'اتصال مجدد'; });
    ['order.created', 'order.updated', 'waiter_call.updated', 'menu.availability_updated', 'inventory.updated'].forEach((eventName) => state.stream.addEventListener(eventName, schedule));
  }

  async function boot() {
    if (!allowedRoles.has(role)) { location.replace('/admin'); return; }
    try {
      await loadSession();
      paintNav();
      document.getElementById('role-shift').addEventListener('click', toggleShift);
      document.getElementById('role-refresh').addEventListener('click', render);
      document.getElementById('role-user').addEventListener('click', () => openDialog('کاربر فعال', state.session.user.name || state.session.user.roleLabel, `<div class="role-metrics">${metric('نقش واقعی', state.session.user.roleLabel)}${metric('فضای کاری', state.session.workspace.label)}${metric('شماره', state.session.user.phone)}${metric('شیفت', state.session.shift ? 'باز' : 'بسته')}</div><button class="role-danger" id="role-logout">خروج از حساب</button>`));
      dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
      dialog.addEventListener('close', () => { state.cart.clear(); if (!state.posCheck) state.pendingPosItem = null; });
      dialog.addEventListener('click', async (event) => { if (event.target.id === 'role-logout') { await api('/api/auth/logout', { method: 'POST' }); location.href = '/login'; } });
      if (role === 'kitchen') {
        document.addEventListener('keydown', handleKdsShortcut);
        document.addEventListener('pointerdown', () => { state.kdsAudioArmed = true; }, { once: true });
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
      window.addEventListener('pagehide', () => { state.stream?.close(); clearInterval(state.kdsClockTimer); });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { startStream(); render(); } else state.stream?.close(); });
    } catch (error) {
      main.innerHTML = `${pageHead('دسترسی', 'امکان ورود به این پنل نیست', error.message)}<section class="role-section">${empty(error.message)}<a class="role-secondary" href="/admin">بازگشت به مدیریت</a></section>`;
    }
  }

  boot();
})();
