/* WESTO role workspaces: cashier, waiter and kitchen. */
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
    kdsStation: readLocal('westo_kds_station', 'expo'), kdsFulfillment: 'all', kdsSearch: '', kdsPage: 0,
    kdsSettings: readLocal('westo_kds_settings', { layout: 'tile', columns: 6, textSize: 'normal', warnMinutes: 8, lateMinutes: 15, sound: true }),
    kdsUndo: null, kdsUndoTimer: null, kdsClockTimer: null, kdsLastOpenCount: null, kdsAudioArmed: false, kdsConnected: false, kdsHighlightItem: '', kdsPendingTickets: new Set(),
  };
  let toastTimer = null;

  document.body.classList.toggle('is-cashier-workspace', role === 'cashier');
  document.body.classList.toggle('is-kitchen-workspace', role === 'kitchen');

  const ROLE_CONFIG = {
    cashier: {
      eyebrow: 'Front of house · POS',
      title: 'ایستگاه صندوق',
      description: 'ثبت سفارش، ارسال به آشپزخانه و تسویه',
      views: [['menu', 'منو'], ['floor', 'نقشه سالن'], ['orders', 'سفارش‌ها'], ['transactions', 'تراکنش‌ها'], ['drawer', 'صندوق پول']],
    },
    waiter: {
      eyebrow: 'Floor service · Handheld',
      title: 'سالن و گارسون',
      description: 'میزها، فراخوان مهمان و سفارش‌گیری کنار میز',
      views: [['floor', 'نقشه سالن'], ['calls', 'فراخوان‌ها'], ['orders', 'سفارش‌ها'], ['reservations', 'رزروها']],
    },
    kitchen: {
      eyebrow: 'Back of house · KDS',
      title: 'نمایشگر آشپزخانه',
      description: 'تیکت‌ها، موجودی فیزیکی، ضایعات، شمارش و تولید بچ',
      views: [['board', 'صف آشپزخانه'], ['ready', 'آماده تحویل'], ['inventory', 'انبار و ضایعات']],
    },
  };

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const money = (value) => `${Number(value || 0).toLocaleString('fa-IR')} تومان`;
  const num = (value) => Number(value || 0).toLocaleString('fa-IR');
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
      kds_item_invalid: 'این آیتم دیگر در تیکت فعال نیست.', kds_station_invalid: 'ایستگاه انتخاب‌شده معتبر نیست.',
      kds_station_empty: 'این تیکت آیتمی برای ایستگاه انتخاب‌شده ندارد.', kitchen_recall_invalid: 'این تیکت در وضعیت قابل بازگردانی نیست.',
      kds_ticket_incomplete: 'تا وقتی همهٔ اقلام تکمیل نشده‌اند، تیکت آماده نمی‌شود.',
      order_edit_locked: 'آشپزخانه آماده‌سازی را شروع کرده؛ ویرایش این سفارش قفل شده است.',
      order_edit_refund_required: 'مبلغ جدید از پرداخت ثبت‌شده کمتر است؛ ابتدا بازپرداخت را ثبت کنید.',
      order_edit_branch_mismatch: 'این سفارش متعلق به شعبه فعال نیست.',
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
    }).join(' · ') || 'بدون آیتم';
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

  function paintNav() {
    const config = ROLE_CONFIG[role];
    if (!state.activeView) state.activeView = config.views[0][0];
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
      amountPaid: Number(order.amountPaid || 0),
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
    openDialog('POS · سفارش جدید', 'نوع سفارش را انتخاب کنید', `
      <div class="pos-order-types">
        <button type="button" data-pos-type="dine_in"><span>داخل مجموعه</span><small>انتخاب میز و ارسال به آشپزخانه</small><b>←</b></button>
        <button type="button" data-pos-type="pickup"><span>بیرون‌بر</span><small>ثبت سفارش کانتر یا تحویل حضوری</small><b>←</b></button>
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
        return `<button type="button" class="pos-category-card" data-pos-category="${category.id}" style="--pos-category-index:${index}">${category.coverImg ? `<img src="${esc(category.coverImg)}" alt="" />` : '<span class="pos-category-card__placeholder" aria-hidden="true">و</span>'}<span class="pos-category-card__content"><b>${esc(category.title || category.name1 || 'دسته')}</b><small>${num(count)} آیتم</small></span><i aria-hidden="true">←</i></button>`;
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
    const path = query ? `<div class="pos-menu-path"><button type="button" id="pos-clear-search">→ پاک‌کردن جست‌وجو</button><div><b>نتایج جست‌وجو</b><span>${num(matchedItems.length)} نتیجه</span></div></div>` : `<div class="pos-menu-path"><button type="button" id="pos-back-categories">→ همه دسته‌ها</button><div><b>${esc(category?.title || 'منو')}</b><span>${num(matchedItems.length)} آیتم</span></div></div>`;
    return `${path}${searchHint}<div class="pos-product-grid" data-density="${density}" style="--pos-cols:${columns};--pos-rows:${rows};--pos-grid-max:${rows * 118}px;--pos-mobile-cols:${mobileColumns};--pos-mobile-rows:${mobileRows};--pos-mobile-grid-max:${mobileRows * 82}px">${items.map((item) => `<article class="pos-product-card"><button type="button" class="pos-product-card__add" data-pos-quick-add="${item.id}">${item.img ? `<img src="${esc(item.img)}" alt="" />` : '<span class="pos-product-card__placeholder" aria-hidden="true">و</span>'}<span class="pos-product-card__info"><b>${esc(item.name)}</b><small>${money(item.price)}</small><span>+ افزودن</span></span></button></article>`).join('') || empty('آیتمی در این دسته پیدا نشد.')}</div>`;
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
      <div class="pos-lines">${lines.map((line) => posInvoiceRows(line)).join('') || empty('هنوز آیتمی به فاکتور اضافه نشده است.')}</div>
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
      const total = Number(complement.price || 0) * qty;
      return `<article class="pos-line pos-line--complement" data-complement-row="${esc(line.localId)}-${index}"><div class="pos-line__complement"><div><span class="pos-line__complement-tag">مکمل</span><b>${esc(complement.name)}</b><small>همراه ${esc(line.name)}</small></div><span>${money(total)}</span></div><div class="pos-line__qty" aria-label="تعداد ${esc(complement.name)}"><button type="button" data-pos-complement-delta="-1" data-pos-line-id="${esc(line.localId)}" data-pos-complement-index="${index}" ${locked ? 'disabled' : ''}>−</button><b>${num(qty)}</b><button type="button" data-pos-complement-delta="1" data-pos-line-id="${esc(line.localId)}" data-pos-complement-index="${index}" ${locked ? 'disabled' : ''}>+</button></div></article>`;
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
    main.querySelector('#pos-send')?.addEventListener('click', (event) => {
      if (state.posCheck?.orderId) return action(event.currentTarget, () => saveEditedPosOrder(), 'تغییرات سفارش ذخیره و برای آشپزخانه به‌روزرسانی شد.');
      return action(event.currentTarget, async () => { await createPosOrder(true); state.posCheck = null; state.activeView = 'floor'; paintNav(); }, 'سفارش با جزئیات کامل به آشپزخانه ارسال شد.');
    });
    main.querySelector('#pos-pay')?.addEventListener('click', async () => { try { const order = await createPosOrder(false); openPayment(order); } catch (error) { showToast(error.message, 'error'); } });
    main.querySelector('#pos-print')?.addEventListener('click', () => printOrder(state.posCheck));
  }

  function cashierMenu() {
    document.body.classList.add('is-pos-station');
    main.innerHTML = `<section class="pos-shell"><div class="pos-catalog"><header class="pos-toolbar"><div><span>منوی وستو</span><strong>منوی سریع</strong></div><label><span aria-hidden="true">⌕</span><input id="pos-search" value="${esc(state.posSearch)}" placeholder="جست‌وجوی منو" /></label><button type="button" id="pos-new-check">+ سفارش جدید</button></header><div class="pos-catalog__body">${posCategoryMarkup()}</div></div>${posCheckMarkup()}</section>`;
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
    openDialog('پیشنهاد هوشمند', `مکمل ${item.name}`, `<div class="pos-complement-layer"><div class="pos-complement-intro"><span>محصول به فاکتور اضافه شد</span><strong>${esc(prompt)}</strong><small>انتخاب اختیاری است و مکمل زیر همین آیتم ثبت می‌شود.</small></div><div class="pos-complement-grid">${options.map((entry) => `<article class="pos-complement-card" data-complement-card="${entry.id}">${entry.img ? `<img src="${esc(entry.img)}" alt="" />` : '<span class="pos-complement-card__placeholder">و</span>'}<div><b>${esc(entry.name)}</b><small>${money(entry.price)}</small></div><button type="button" data-complement-add="${entry.id}" aria-label="افزودن ${esc(entry.name)}">+</button><div class="pos-complement-qty" hidden><button type="button" data-complement-delta="-1" data-complement-id="${entry.id}">−</button><b data-complement-count="${entry.id}">۰</b><button type="button" data-complement-delta="1" data-complement-id="${entry.id}">+</button></div></article>`).join('')}</div><footer><button type="button" class="pos-complement-skip" id="pos-complement-skip">ادامه بدون مکمل</button><button type="button" class="pos-pay" id="pos-complement-save" disabled>یک مکمل انتخاب کنید</button></footer></div>`);
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
    openDialog('ویرایش آیتم', item.name, `<div class="modifier-layout"><section><div class="modifier-base"><span>قیمت پایه</span><b>${money(item.price)}</b></div>${POS_MODIFIERS.map((group) => `<div class="modifier-group"><h3>${esc(group.group)}</h3><div>${group.items.map((modifier) => `<label><input type="checkbox" value="${esc(modifier.name)}" ${selected.has(modifier.name) ? 'checked' : ''}/><span>${esc(modifier.name)}</span><small>${modifier.price ? `+ ${money(modifier.price)}` : 'بدون هزینه'}</small></label>`).join('')}</div></div>`).join('')}</section><aside><label class="field"><span>یادداشت آیتم</span><textarea id="modifier-note" rows="4" maxlength="180">${esc(existing?.note || '')}</textarea></label><label class="field"><span>شماره صندلی (اختیاری)</span><input id="modifier-seat" type="number" min="0" max="99" value="${Number(existing?.seat || 0)}" /></label><div class="modifier-qty"><button type="button" data-mod-qty="-1">−</button><b id="modifier-qty">${num(existing?.qty || 1)}</b><button type="button" data-mod-qty="1">+</button></div><button type="button" class="pos-pay" id="modifier-save">${existing ? 'ذخیره تغییرات' : 'افزودن به فاکتور'}</button>${existing ? '<button type="button" class="role-danger" id="modifier-remove">حذف از سفارش</button>' : ''}</aside></div>`);
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
    if (!state.posCheck?.lines?.length) throw new Error('حداقل یک آیتم انتخاب کنید.');
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
    if (!check.lines?.length) throw new Error('سفارش باید حداقل یک آیتم داشته باشد.');
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
    openDialog('پرداخت', `مبلغ ${money(charge)}`, `<div class="payment-sheet"><button type="button" class="split-payment" id="split-payment">تقسیم مبلغ</button><div class="payment-total"><span>${charge < outstanding ? 'سهم انتخاب‌شده' : 'مبلغ قابل پرداخت'}</span><strong>${money(charge)}</strong><small>${esc(posLocationLabel(state.posCheck))}${paid ? ` · پرداخت‌شده ${money(paid)} · مانده ${money(outstanding)}` : ''}</small></div><div class="split-options" id="split-options" hidden><button type="button" data-split="${Math.ceil(outstanding / 2)}">نصف مانده</button><button type="button" data-split="${Math.ceil(outstanding / 3)}">یک‌سوم مانده</button><button type="button" data-split="${Math.ceil(outstanding / 4)}">یک‌چهارم مانده</button><label><span>مبلغ دلخواه</span><input id="split-custom" inputmode="numeric" value="${charge}" /></label><button type="button" id="split-custom-apply">اعمال</button></div><section><h3>نقدی</h3><div class="cash-presets"><button type="button" data-pay="cash" data-amount="${charge}">مبلغ دقیق</button><button type="button" data-pay="cash" data-amount="${rounded}">${money(rounded)}</button><button type="button" id="custom-cash">مبلغ دلخواه</button></div></section><div class="payment-methods"><button type="button" data-pay="card"><span>کارت‌خوان</span><small>ثبت پرداخت کارت حضوری</small><b>←</b></button><button type="button" data-pay="manual_card"><span>ورود دستی کارت</span><small>ثبت ممیزی‌شده تراکنش</small><b>←</b></button><button type="button" data-pay="gift_card"><span>کارت هدیه</span><small>اعتبار هدیه مجموعه</small><b>←</b></button><button type="button" data-pay="card_on_file"><span>کارت ذخیره‌شده</span><small>مشتری باشگاه</small><b>←</b></button></div><div id="custom-cash-row" hidden><label class="field"><span>وجه دریافتی</span><input id="cash-received" inputmode="numeric" value="${charge}" /></label><button type="button" class="pos-pay" id="cash-confirm">ثبت دریافت</button></div></div>`);
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

  async function finishReceipt(order, method, destination) {
    try {
      const result = await api(`/api/cashier/orders/${order.id}/receipt`, { method: 'POST', body: JSON.stringify({ method, destination }) });
      if ((method === 'email' || method === 'sms') && !result.deliveryConfigured) showToast('انتخاب ثبت شد؛ سرویس ارسال بیرونی هنوز پیکربندی نشده است.');
      if (method === 'print') printOrder(posCheckFromOrder(order));
      state.posCheck = null; dialog.close(); await render();
    } catch (error) { showToast(error.message, 'error'); }
  }

  function printOrder(check) {
    if (!check) return;
    const receipt = window.open('', '_blank', 'width=460,height=720');
    if (!receipt) return showToast('اجازه بازشدن پنجره چاپ داده نشده است.', 'error');
    receipt.document.write(`<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>رسید وستو</title><style>body{font-family:Tahoma;padding:24px;line-height:1.9}h1{font-size:24px}.line,.total{display:flex;justify-content:space-between;border-bottom:1px dashed #bbb;padding:8px 0}.line small{display:block;color:#666}.line.complement{padding-right:14px;background:#f5fafa}.total{font-size:20px;font-weight:bold}</style><h1>WESTO</h1><p>${esc(posLocationLabel(check))} · ${esc(check.orderNo || '')}</p>${(check.lines || []).map((line) => `<div class="line"><span>${num(line.qty)}× ${esc(line.name)}</span><b>${money(posBaseLineTotal(line))}</b></div>${(line.complements || []).map((entry) => `<div class="line complement"><span><small>مکمل ${esc(line.name)}</small>${num(entry.qty || 1)}× ${esc(entry.name)}</span><b>${money(Number(entry.price || 0) * Number(entry.qty || 1))}</b></div>`).join('')}`).join('')}<div class="total"><span>جمع</span><b>${money(posTotal(check))}</b></div><script>print();<\/script>`);
    receipt.document.close();
  }

  function cashierFloor() {
    document.body.classList.remove('is-pos-station');
    const tables = state.data.floor?.tables || [];
    const zones = [...new Set(tables.map((table) => table.zone || 'سالن'))];
    if (state.floorZone !== 'all' && !zones.includes(state.floorZone)) state.floorZone = 'all';
    const visibleTables = state.floorZone === 'all' ? tables : tables.filter((table) => (table.zone || 'سالن') === state.floorZone);
    const zoneButton = (id, label, count) => `<button type="button" data-floor-zone="${esc(id)}" class="${state.floorZone === id ? 'active' : ''}" aria-pressed="${state.floorZone === id}"><span>${esc(label)}</span><small>${num(count)}</small></button>`;
    const tableCard = (table) => `<button type="button" data-cashier-table="${esc(table.id)}" data-state="${esc(table.state)}" ${table.autoReleased ? 'data-auto-released="true"' : ''}><b>${esc(table.label || table.id)}</b><small>${esc(table.zone || 'سالن')} · ${num(table.seats)} نفر</small><span>${esc(table.autoReleased ? 'آزادشده خودکار' : table.stateLabel || 'آزاد')}</span>${table.serviceEndsAt && !table.autoReleased && ['busy', 'attention'].includes(table.state) ? `<time data-service-ends="${esc(table.serviceEndsAt)}">${floorCountdownLabel(table.serviceEndsAt)}</time>` : ''}</button>`;
    main.innerHTML = `${pageHead('Floor plan', 'نقشه سالن', 'میزهای باز، آزاد و نیازمند رسیدگی', '<button class="role-primary" id="floor-new">+ سفارش جدید</button>')}<section class="pos-floor"><div class="pos-floor__zones" aria-label="فیلتر بخش‌های رستوران">${zoneButton('all', 'همه', tables.length)}${zones.map((zone) => zoneButton(zone, zone, tables.filter((table) => (table.zone || 'سالن') === zone).length)).join('')}</div><div class="pos-floor__map">${visibleTables.map(tableCard).join('') || empty('در این بخش میزی تعریف نشده است.')}</div><footer><span><i class="is-free"></i> آزاد</span><span><i class="is-busy"></i> در سرویس</span><span><i class="is-call"></i> فراخوان</span><b>آزادسازی خودکار پس از ${num(state.data.floor?.summary?.serviceMinutes || 45)} دقیقه</b></footer></section>`;
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
    main.innerHTML = `${pageHead('Checks', 'سفارش‌ها', 'فاکتورهای باز و بسته ایستگاه', '<button class="role-primary" id="orders-new">+ سفارش جدید</button>')}<section class="role-section"><div class="role-section__head"><h2>باز</h2><span>${num(open.length)} فاکتور</span></div><div class="pos-order-list">${open.map(row).join('') || empty('فاکتور بازی وجود ندارد.')}</div></section><section class="role-section" style="margin-top:14px"><div class="role-section__head"><h2>بسته‌شده‌های اخیر</h2><span>${num(closed.length)} فاکتور</span></div><div class="pos-order-list">${closed.map(row).join('') || empty('هنوز سفارشی بسته نشده است.')}</div></section>`;
    document.getElementById('orders-new').addEventListener('click', openNewCheck);
    main.querySelectorAll('[data-open-order]').forEach((button) => button.addEventListener('click', () => { const order = orders.find((item) => Number(item.id) === Number(button.dataset.openOrder)); state.posCheck = posCheckFromOrder(order); state.activeView = 'menu'; paintNav(); cashierMenu(); }));
  }

  function cashierTransactions() {
    document.body.classList.remove('is-pos-station');
    const paid = (state.data.orders || []).filter((order) => order.paymentStatus === 'paid').slice(0, 80);
    const tenderLabel = { cash: 'نقدی', card: 'کارت‌خوان', manual_card: 'کارت دستی', gift_card: 'کارت هدیه', card_on_file: 'کارت ذخیره‌شده' };
    main.innerHTML = `${pageHead('Transactions', 'تراکنش‌ها', 'پرداخت‌های ثبت‌شده و روش دریافت')}<section class="role-metrics">${metric('تعداد', num(paid.length))}${metric('جمع پرداخت', money(paid.reduce((sum, order) => sum + Number(order.total || 0), 0)))}${metric('نقدی', money(paid.filter((order) => order.paymentTender === 'cash').reduce((sum, order) => sum + Number(order.total || 0), 0)))}${metric('غیرنقدی', money(paid.filter((order) => order.paymentTender !== 'cash').reduce((sum, order) => sum + Number(order.total || 0), 0)))}</section><section class="role-section"><div class="pos-transaction-list">${paid.map((order) => `<article><div><b>${esc(order.orderNo || `#${order.id}`)}</b><span>${esc(posLocationLabel(posCheckFromOrder(order)))} · ${time(order.paidAt)}</span></div><span>${esc(tenderLabel[order.paymentTender] || 'پرداخت')}</span><strong>${money(order.total)}</strong></article>`).join('') || empty('تراکنشی ثبت نشده است.')}</div></section>`;
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
    main.innerHTML = `${pageHead('POS', 'صف تسویه', 'سفارش‌های پرداخت در محل، دریافت وجه و ثبت روش پرداخت', '<button class="role-primary" id="new-order">سفارش جدید</button>')}
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
    main.innerHTML = `${pageHead('Handoff', 'تحویل سفارش', 'سفارش‌های آماده از آشپزخانه تا تحویل نهایی')}
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
      main.innerHTML = `${pageHead('Cash management', 'صندوق پول', 'شروع موجودی، ورود/خروج نقدی و تطبیق پایان شیفت')}
        <section class="role-section role-section--8"><div class="role-section__head"><h2>باز کردن صندوق</h2><span>موجودی اول شیفت</span></div>
        <div class="field-grid"><label class="field"><span>مبلغ اولیه (تومان)</span><input id="drawer-opening" inputmode="numeric" value="0" /></label></div>
        <p>پس از باز شدن، فروش‌های نقدی به‌صورت خودکار در همین نشست ثبت می‌شوند.</p><button class="role-primary" id="drawer-open">باز کردن صندوق</button></section>`;
      document.getElementById('drawer-open').addEventListener('click', (event) => action(event.currentTarget, () => api('/api/cashier/drawer/open', { method: 'POST', body: JSON.stringify({ branchId: state.branchId, openingAmount: Number(document.getElementById('drawer-opening').value) || 0 }) }), 'صندوق پول باز شد.'));
      return;
    }
    main.innerHTML = `${pageHead('Cash management', 'صندوق پول', 'تمام جابه‌جایی‌های نقدی این نشست قابل تطبیق است')}
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
    main.innerHTML = `${pageHead('Floor plan', 'نقشه سالن', 'اولویت پاسخ به مهمان، وضعیت میز و ثبت سریع سفارش', '<button class="role-primary" id="new-order">سفارش کنار میز</button>')}${waiterMetrics()}
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
    main.innerHTML = `${pageHead('Guest attention', 'فراخوان‌های مهمان', 'درخواست‌ها بر اساس زمان انتظار مرتب شده‌اند')}${waiterMetrics()}<section class="role-section"><div class="role-section__head"><h2>صف رسیدگی</h2><span>${num(state.data.calls.length)} فراخوان باز</span></div>${callsHtml()}</section>`;
    wireCalls();
  }

  function waiterOrders() {
    const orders = (state.data.orders || []).filter((item) => item.fulfillment === 'dine_in' && !['done', 'cancelled'].includes(item.status));
    const cards = orders.map((order) => orderCard(order, order.status === 'ready' ? '<button class="role-primary" data-serve>تحویل به میز</button>' : '')).join('');
    main.innerHTML = `${pageHead('Table service', 'سفارش‌های سالن', 'پیگیری سفارش از ثبت تا آماده‌شدن و تحویل به میز', '<button class="role-primary" id="new-order">سفارش جدید</button>')}${waiterMetrics()}<section class="role-section"><div class="role-section__head"><h2>سفارش‌های فعال</h2><span>میزهای من</span></div><div class="order-list">${cards || empty('سفارش فعالی در سالن نیست.')}</div></section>`;
    document.getElementById('new-order').addEventListener('click', () => showOrderComposer('waiter'));
    main.querySelectorAll('[data-serve]').forEach((button) => button.addEventListener('click', () => {
      const id = button.closest('[data-order-id]').dataset.orderId;
      action(button, () => api(`/api/waiter/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) }), 'تحویل به میز ثبت شد.');
    }));
  }

  function waiterReservations() {
    const list = (state.data.reservations.reservations || []).filter((item) => !['cancelled', 'no_show'].includes(item.status)).slice(0, 80);
    main.innerHTML = `${pageHead('Reservations', 'رزروهای سالن', 'مهمان‌های امروز، ساعت ورود و تعداد نفرات')}${waiterMetrics()}<section class="role-section"><div class="order-list">${list.map((item) => `<article class="order-card"><div class="order-card__top"><strong>${esc(item.name || item.phone)}</strong><span>${fmtDate(item.date)} · ${esc(item.time)}</span></div><div class="order-card__items">${num(item.partySize)} نفر ${item.tableNo ? `· میز ${esc(item.tableNo)}` : ''}</div><div class="order-card__bottom"><span>${esc(item.note || 'بدون یادداشت')}</span><b>${esc(({pending:'در انتظار',confirmed:'تأیید',seated:'نشسته'})[item.status] || item.status)}</b></div></article>`).join('') || empty('رزرو فعالی وجود ندارد.')}</div></section>`;
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
    openDialog('POS', 'سفارش جدید', `<div class="field-grid" style="margin-bottom:12px"><label class="field"><span>نوع سفارش</span><select id="composer-fulfillment">${fulfillmentOptions}</select></label><label class="field"><span>میز</span><select id="composer-table"><option value="">انتخاب میز</option>${tables.map((table) => `<option value="${table.id}" ${String(table.id) === String(presetTable) ? 'selected' : ''}>${esc(table.label)}</option>`).join('')}</select></label><label class="field"><span>موبایل مهمان (اختیاری)</span><input id="composer-phone" inputmode="tel" /></label><label class="field"><span>یادداشت</span><input id="composer-note" maxlength="240" /></label></div>
      <div class="composer"><section class="composer-menu"><input class="composer-search" id="composer-search" placeholder="جست‌وجوی آیتم…" /><div class="composer-items" id="composer-items"></div></section><aside class="composer-cart"><strong>سبد سفارش</strong><div class="cart-lines" id="cart-lines">${empty('آیتمی انتخاب نشده است.')}</div><div class="cart-total"><span>جمع</span><b id="cart-total">۰ تومان</b></div><button class="role-primary" id="composer-submit" style="width:100%">ثبت و ارسال سفارش</button></aside></div>`);
    const paintItems = (query = '') => {
      const normalized = query.trim();
      document.getElementById('composer-items').innerHTML = state.menuItems.filter((item) => !normalized || String(item.name || '').includes(normalized)).slice(0, 120).map((item) => `<button class="composer-item" data-menu-id="${item.id}">${item.img ? `<img src="${esc(item.img)}" alt="" loading="lazy" />` : '<span></span>'}<span><strong>${esc(item.name)}</strong><span>${money(item.price)}</span></span><b>+</b></button>`).join('') || empty('آیتمی پیدا نشد.');
      document.querySelectorAll('[data-menu-id]').forEach((button) => button.addEventListener('click', () => { const id = Number(button.dataset.menuId); state.cart.set(id, (state.cart.get(id) || 0) + 1); paintCart(); }));
    };
    const paintCart = () => {
      const lines = [...state.cart.entries()].map(([id, qty]) => ({ item: state.menuItems.find((entry) => Number(entry.id) === id), qty })).filter((line) => line.item);
      document.getElementById('cart-lines').innerHTML = lines.map(({ item, qty }) => `<div class="cart-line"><div><strong>${esc(item.name)}</strong><small>${money(item.price * qty)}</small></div><div class="cart-line__qty"><button data-cart-delta="-1" data-cart-id="${item.id}">−</button><b>${num(qty)}</b><button data-cart-delta="1" data-cart-id="${item.id}">+</button></div></div>`).join('') || empty('آیتمی انتخاب نشده است.');
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
      if (!state.cart.size) throw new Error('حداقل یک آیتم انتخاب کنید.');
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
    return ({ available: 'عادی', reorder: 'نیازمند سفارش', negative: 'موجودی منفی', insufficient_data: 'داده ناکافی', posted: 'ثبت مالی شد', blocked: 'نیازمند حسابدار', pending: 'منتظر ثبت' })[status] || status || '—';
  }

  function kitchenInventoryPage() {
    const data = state.data.inventory || {};
    const items = data.items || [];
    const recipes = data.productionRecipes || [];
    const capacities = data.recipeCapacity || [];
    const operations = data.recentOperations || [];
    const summary = data.summary || {};
    const itemOptions = items.map((item) => `<option value="${esc(item.id)}" data-unit="${esc(item.unit || '')}">${esc(item.name)} · ${num(item.availableQuantity)} ${esc(item.unit || '')}</option>`).join('');
    const recipeOptions = recipes.map((recipe) => `<option value="${esc(recipe.id)}" data-yield="${esc(recipe.defaultPlannedYield)}">${esc(recipe.name)}${recipe.version ? ` · نسخه ${esc(recipe.version)}` : ''}</option>`).join('');
    main.innerHTML = `${pageHead('عملیات انبار', 'موجودی، ضایعات و تولید', 'شما فقط واقعیت فیزیکی را ثبت می‌کنید؛ حساب‌ها و مبلغ سند به‌صورت خودکار در حسابداری تعیین می‌شوند.')}
      <div class="role-metrics">${metric('اقلام انبار', num(summary.items))}${metric('نیازمند سفارش', num(summary.lowStock), 'بر پایه نقطه سفارش')}${metric('منتظر ارزش‌گذاری', num(summary.unvaluedEvents), 'واقعیت فیزیکی ثبت شده')}${metric('استثناهای باز', num(summary.exceptions), 'برای بازبینی حسابدار')}</div>
      <section class="inventory-actions" aria-label="ثبت عملیات انبار">
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
        <details class="inventory-action" ${recipes.length ? '' : 'data-disabled="true"'}><summary><b>ثبت تولید بچ</b><span>${recipes.length ? 'مصرف مواد و تولید خروجی' : 'رسپی تولیدِ دارای کالای خروجی تنظیم نشده'}</span></summary>${recipes.length ? `<form id="inventory-production-form" class="field-grid">
          <label class="field field--full"><span>رسپی تولید</span><select name="recipeId" required><option value="">انتخاب رسپی</option>${recipeOptions}</select></label>
          <label class="field"><span>بازده برنامه‌ریزی‌شده</span><input name="plannedYield" type="number" min="0.000001" step="any" required></label>
          <label class="field"><span>خروجی واقعی</span><input name="actualYield" type="number" min="0" step="any" required></label>
          <button class="role-primary field--full" type="submit">ثبت مصرف و خروجی بچ</button>
        </form>` : `<div class="inventory-action__empty">مدیر باید برای رسپی آماده‌سازی، کالای خروجی انبار را تعریف کند؛ سیستم آن را حدس نمی‌زند.</div>`}</details>
      </section>
      <div class="role-grid inventory-layout">
        <section class="role-section role-section--8"><div class="role-section__head"><h2>مانده قابل استفاده</h2><span>افتتاحیه + گردش‌های قطعی</span></div><div class="inventory-table" role="table">
          <div class="inventory-row inventory-row--head" role="row"><span>کالا</span><span>مانده</span><span>نقطه سفارش</span><span>وضعیت</span></div>
          ${items.map((item) => `<div class="inventory-row" role="row"><span><b>${esc(item.name)}</b><small>${esc(item.sku || item.id)}</small></span><strong>${item.availableQuantity == null ? '—' : `${num(item.availableQuantity)} ${esc(item.unit || '')}`}</strong><span>${item.reorderPoint == null ? 'تعریف نشده' : `${num(item.reorderPoint)} ${esc(item.unit || '')}`}</span><i data-status="${esc(item.status)}">${esc(inventoryStatusLabel(item.status))}</i></div>`).join('') || empty('کالای انباری برای این شعبه تعریف نشده است.')}
        </div></section>
        <section class="role-section role-section--4"><div class="role-section__head"><h2>ظرفیت قابل تولید</h2><span>بر اساس رسپی و مانده فعلی</span></div><div class="inventory-capacity-list">${capacities.slice(0, 12).map((row) => `<article><div><b>${esc(row.name)}</b><small>${row.version ? `نسخه ${esc(row.version)}` : 'نسخه نامشخص'}</small></div><strong>${row.capacity == null ? '—' : num(row.capacity)}</strong><span>${row.status === 'available' ? `محدودکننده: ${esc(row.limitingIngredient?.name || '—')}` : 'رسپی یا واحد ناقص'}</span></article>`).join('') || empty('برای محاسبه ظرفیت، رسپی معتبر لازم است.')}</div></section>
        <section class="role-section"><div class="role-section__head"><h2>آخرین عملیات</h2><span>اصلاح فقط با سند معکوس مدیر انجام می‌شود.</span></div><div class="inventory-operation-list">${operations.map((row) => `<article><div><b>${esc(inventoryStatusLabel(row.source === 'inventory.waste' ? 'ضایعات' : row.source === 'inventory.stock_count' ? 'شمارش' : row.source === 'inventory.production_batch' ? 'تولید بچ' : 'معکوس'))}</b><small>${fmtDate(row.occurredAt)} · ${time(row.occurredAt)}</small></div><span data-status="${esc(row.status)}">${esc(inventoryStatusLabel(row.status))}</span>${row.reason ? `<p>${esc(row.reason)}</p>` : ''}${row.issues?.length ? `<p class="is-warning">${num(row.issues.length)} هشدار برای بازبینی ثبت شد.</p>` : ''}</article>`).join('') || empty('هنوز عملیات V2 انبار ثبت نشده است.')}</div></section>
      </div>`;
    wireKitchenInventory();
  }

  function inventoryIdempotency(kind) {
    return `kitchen-inventory-${kind}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function wireKitchenInventory() {
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
    bind('#inventory-waste-form', '/api/kitchen/inventory/waste', (values, selected) => ({ itemId: values.itemId, quantity: Number(values.quantity), unit: selected?.dataset.unit, reason: values.reason }), 'ضایعات ثبت شد؛ اثر مالی یا مانع ارزش‌گذاری به حسابداری ارسال شد.');
    bind('#inventory-count-form', '/api/kitchen/inventory/stock-counts', (values, selected) => ({ itemId: values.itemId, countedQuantity: Number(values.countedQuantity), unit: selected?.dataset.unit, reason: values.reason }), 'شمارش فیزیکی و اختلاف آن ثبت شد.');
    bind('#inventory-production-form', '/api/kitchen/inventory/production-batches', (values) => ({ recipeId: values.recipeId, plannedYield: Number(values.plannedYield), actualYield: Number(values.actualYield) }), 'بچ تولید و گردش مواد آن ثبت شد.');
    main.querySelector('#inventory-production-form select[name="recipeId"]')?.addEventListener('change', (event) => {
      const planned = event.currentTarget.selectedOptions[0]?.dataset.yield;
      if (planned) event.currentTarget.form.elements.plannedYield.value = planned;
    });
  }

  const KDS_ALLERGENS = { gluten: 'گلوتن', dairy: 'لبنیات', egg: 'تخم‌مرغ', nuts: 'آجیل', peanut: 'بادام‌زمینی', soy: 'سویا', fish: 'ماهی', shellfish: 'صدف', sesame: 'کنجد' };

  function saveKdsLocal() {
    localStorage.setItem('westo_kds_station', JSON.stringify(state.kdsStation));
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
      if (state.kdsStation !== 'expo' && !(ticket.items || []).some((item) => item.station === state.kdsStation)) return false;
      if (state.kdsHighlightItem && !(ticket.items || []).some((item) => item.name === state.kdsHighlightItem && !item.completedAt)) return false;
      if (!query) return true;
      const haystack = [ticket.orderNo, ticket.tableNo, ticket.name, ticket.phone, ticket.note, ticket.kitchenNote, ...(ticket.items || []).map((item) => `${item.name} ${(item.modifiers || []).map((entry) => entry.name).join(' ')}`)].join(' ').toLocaleLowerCase('fa');
      return haystack.includes(query);
    }).sort((a, b) => Number(b.kds?.priority) - Number(a.kds?.priority) || Number(b.ageSec) - Number(a.ageSec));
  }

  function kdsItemMarkup(item, ticket) {
    const completed = !!item.completedAt;
    const stationHidden = state.kdsStation !== 'expo' && item.station !== state.kdsStation;
    if (stationHidden) return '';
    const modifiers = (item.modifiers || []).map((entry) => `<span>${esc(entry.name)}</span>`).join('');
    const allergens = (item.allergens || []).map((entry) => KDS_ALLERGENS[entry] || entry).join('، ');
    return `<button class="kds-item ${completed ? 'is-complete' : ''} ${Number(item.qty) > 1 ? 'is-multi' : ''}" type="button" data-kds-item="${esc(item.key)}" data-ticket-id="${ticket.id}" data-completed="${completed}" aria-label="${completed ? 'بازگردانی' : 'تکمیل'} ${esc(item.name)}">
      <span class="kds-item__qty">${num(item.qty)}×</span><span class="kds-item__body"><b>${esc(item.name)}</b>${item.kind === 'complement' ? `<small>مکمل ${esc(item.parentName || '')}</small>` : ''}${modifiers ? `<small class="kds-item__mods">${modifiers}</small>` : ''}${item.note ? `<small class="kds-item__note">${esc(item.note)}</small>` : ''}${allergens ? `<strong class="kds-item__allergen">⚠ ${esc(allergens)}</strong>` : ''}</span><span class="kds-item__check">${completed ? '✓' : ''}</span>
    </button>`;
  }

  function kdsTicketMarkup(ticket, shortcut) {
    const settings = normalizeKdsSettings();
    const allDone = (ticket.items || []).length > 0 && (ticket.items || []).every((item) => item.completedAt);
    const stationItems = state.kdsStation === 'expo' ? (ticket.items || []) : (ticket.items || []).filter((item) => item.station === state.kdsStation);
    const stationDone = stationItems.length > 0 && stationItems.every((item) => item.completedAt);
    const fulfillment = ticket.fulfillment === 'delivery' ? 'ارسال' : ticket.fulfillment === 'pickup' ? 'بیرون‌بر' : 'داخل مجموعه';
    const location = ticket.tableNo ? `میز ${ticket.tableNo}` : ticket.fulfillment === 'delivery' ? 'ارسال با پیک' : 'تحویل کانتر';
    const primary = ticket.column === 'ready'
      ? `<button class="kds-ticket__primary is-recall" type="button" data-kds-action="recall_ticket" data-ticket-id="${ticket.id}">بازگردانی به صف</button>`
      : ticket.column === 'new'
        ? `<button class="kds-ticket__primary" type="button" data-kds-action="start_ticket" data-ticket-id="${ticket.id}">شروع آماده‌سازی</button>`
        : state.kdsStation === 'expo'
          ? `<button class="kds-ticket__primary" type="button" data-kds-action="complete_ticket" data-ticket-id="${ticket.id}" ${allDone ? '' : 'disabled'}>${allDone ? 'آماده تحویل' : `منتظر ${num((ticket.items || []).filter((item) => !item.completedAt).length)} قلم`}</button>`
          : `<button class="kds-ticket__primary" type="button" data-kds-action="complete_station" data-ticket-id="${ticket.id}" data-station="${esc(state.kdsStation)}" ${stationDone ? 'disabled' : ''}>${stationDone ? 'ایستگاه تکمیل شد' : `تکمیل ${num(stationItems.filter((item) => !item.completedAt).length)} قلم ایستگاه`}</button>`;
    return `<article class="kds-ticket kds-ticket--${esc(ticket.fulfillment || 'pickup')} ${ticket.kds?.priority ? 'is-priority' : ''} ${ticket.kitchenNote ? 'needs-attention' : ''}" data-ticket-id="${ticket.id}" data-age-sec="${Number(ticket.ageSec) || 0}" data-rendered-at="${Date.now()}">
      <header class="kds-ticket__head"><div><span class="kds-shortcut">${num(shortcut)}</span><div><b>${esc(location)}</b><small>${esc(ticket.orderNo || `#${ticket.id}`)}</small></div></div><div><span>${esc(fulfillment)}</span><time data-kds-age>${kdsAgeLabel(ticket.ageSec)}</time></div></header>
      <div class="kds-ticket__meta"><span>${ticket.column === 'new' ? 'جدید' : ticket.column === 'preparing' ? 'در حال آماده‌سازی' : 'آماده'}</span>${ticket.name ? `<b>${esc(ticket.name)}</b>` : ''}${ticket.kds?.priority ? '<strong>اولویت</strong>' : ''}</div>
      <div class="kds-ticket__items">${(ticket.items || []).map((item) => kdsItemMarkup(item, ticket)).join('') || empty('آیتمی برای این ایستگاه نیست.')}</div>
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
    const stations = data.stations || [];
    const average = Number(data.performance?.averagePrepSec || 0);
    main.innerHTML = `<section class="kds-shell is-${settings.layout} is-text-${settings.textSize}" style="--kds-columns:${kdsColumns()};--kds-rows:${settings.layout === 'rail' ? 1 : innerHeight >= 840 ? 3 : 2}">
      <header class="kds-command"><div class="kds-command__summary"><span class="kds-live ${state.kdsConnected ? 'is-online' : ''}"><i></i>${state.kdsConnected ? 'زنده' : 'در حال اتصال'}</span><strong>${readyOnly ? 'آماده تحویل' : 'ریل آشپزخانه'}</strong><small>${num(filtered.length)} تیکت · میانگین ${average ? kdsAgeLabel(average) : 'بدون سابقه'}</small></div>
        <div class="kds-stations" aria-label="فیلتر ایستگاه">${stations.map((station) => `<button type="button" data-kds-station="${esc(station.id)}" class="${state.kdsStation === station.id ? 'active' : ''}"><span>${esc(station.label)}</span><b>${num(station.count || 0)}</b></button>`).join('')}</div>
        <div class="kds-command__actions"><label><span>⌕</span><input id="kds-search" value="${esc(state.kdsSearch)}" placeholder="سفارش، میز یا آیتم" /></label><button type="button" id="kds-all-day">All‑Day</button><button type="button" id="kds-availability">موجودی</button><button type="button" id="kds-settings">تنظیمات</button></div>
      </header>
      <div class="kds-subbar"><div class="kds-fulfillment">${[['all','همه'],['dine_in','سالن'],['pickup','بیرون‌بر'],['delivery','ارسال']].map(([id,label]) => `<button type="button" data-kds-fulfillment="${id}" class="${state.kdsFulfillment === id ? 'active' : ''}">${label}</button>`).join('')}</div><div class="kds-pressure"><span>جدید <b>${num(data.counts?.new || 0)}</b></span><span>در تولید <b>${num(data.counts?.preparing || 0)}</b></span><span>آماده <b>${num(data.counts?.ready || 0)}</b></span>${state.kdsHighlightItem ? `<button type="button" id="kds-clear-highlight">فیلتر: ${esc(state.kdsHighlightItem)} ×</button>` : ''}</div><div class="kds-pager"><button type="button" data-kds-page="-1" ${state.kdsPage <= 0 ? 'disabled' : ''}>→</button><span>${num(state.kdsPage + 1)} / ${num(pages)}</span><button type="button" data-kds-page="1" ${state.kdsPage >= pages - 1 ? 'disabled' : ''}>←</button></div></div>
      <section class="kds-ticket-grid">${visible.map((ticket, index) => kdsTicketMarkup(ticket, index + 1)).join('') || `<div class="kds-empty"><b>${readyOnly ? 'تیکت آماده‌ای نیست' : 'صف آشپزخانه خالی است'}</b><span>تیکت جدید به‌صورت زنده اینجا ظاهر می‌شود.</span></div>`}</section>
      <footer class="kds-shortcuts"><span><kbd>۱–۹</kbd> اکشن اصلی تیکت</span><span><kbd>R</kbd> تازه‌سازی</span><span><kbd>A</kbd> شمارش کل</span><span><kbd>Esc</kbd> بستن پنجره</span></footer>${kdsUndoMarkup()}
    </section>`;
    wireKitchen(readyOnly, visible);
    startKdsClock();
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

  function openKdsAllDay() {
    const station = state.kdsStation;
    const rows = (state.data.kitchen?.allDay || []).filter((item) => station === 'expo' || item.station === station);
    openDialog('Kitchen production', 'شمارش کل آیتم‌ها', `<div class="kds-all-day"><div class="kds-all-day__head"><span>آیتم</span><span>تعداد باز</span></div>${rows.map((item) => `<button type="button" data-kds-highlight="${esc(item.name)}"><span><b>${esc(item.name)}</b><small>${esc(({hot:'خط گرم',cold:'خط سرد',bar:'بار'})[item.station] || item.station)} · ${num(item.tickets.length)} تیکت</small></span><strong>${num(item.qty)}</strong></button>`).join('') || empty('آیتم بازی برای این ایستگاه نیست.')}</div>`);
    dialogBody.querySelectorAll('[data-kds-highlight]').forEach((button) => button.addEventListener('click', () => { state.kdsHighlightItem = button.dataset.kdsHighlight; state.kdsPage = 0; dialog.close(); kitchenBoard(false); }));
  }

  function openKdsAvailability() {
    const station = state.kdsStation;
    const rows = (state.data.kitchen?.availability || []).filter((item) => station === 'expo' || item.station === station);
    openDialog('86 & availability', 'موجودی فوری منو', `<label class="kds-dialog-search"><span>⌕</span><input id="kds-availability-search" placeholder="جست‌وجوی آیتم" /></label><div class="kds-availability-list">${rows.map((item) => `<button type="button" data-kds-availability-id="${item.id}" data-available="${item.available}"><span><b>${esc(item.name)}</b><small>${esc(item.categoryName)}</small></span><strong>${item.available ? 'موجود' : 'ناموجود'}</strong></button>`).join('')}</div>`);
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
    openDialog('Device profile', 'تنظیمات این نمایشگر', `<div class="kds-settings-grid"><label><span>چیدمان</span><select id="kds-setting-layout"><option value="tile" ${settings.layout === 'tile' ? 'selected' : ''}>Tile Fill · بیشترین تیکت</option><option value="rail" ${settings.layout === 'rail' ? 'selected' : ''}>Flex Rail · تیکت بلند</option></select></label><label><span>تعداد ستون</span><select id="kds-setting-columns">${[3,4,5,6].map((value) => `<option value="${value}" ${settings.columns === value ? 'selected' : ''}>${num(value)} ستون</option>`).join('')}</select></label><label><span>اندازه متن</span><select id="kds-setting-text"><option value="normal" ${settings.textSize === 'normal' ? 'selected' : ''}>استاندارد</option><option value="large" ${settings.textSize === 'large' ? 'selected' : ''}>درشت</option></select></label><label><span>هشدار زرد (دقیقه)</span><input id="kds-setting-warn" type="number" min="1" max="60" value="${settings.warnMinutes}" /></label><label><span>هشدار قرمز (دقیقه)</span><input id="kds-setting-late" type="number" min="2" max="120" value="${settings.lateMinutes}" /></label><label class="kds-setting-toggle"><span>صدای تیکت جدید</span><input id="kds-setting-sound" type="checkbox" ${settings.sound ? 'checked' : ''} /></label></div><button class="role-primary" id="kds-settings-save" type="button" style="width:100%;margin-top:14px">ذخیره برای این نمایشگر</button>`);
    document.getElementById('kds-settings-save').addEventListener('click', () => {
      state.kdsSettings = { layout: document.getElementById('kds-setting-layout').value, columns: Number(document.getElementById('kds-setting-columns').value), textSize: document.getElementById('kds-setting-text').value, warnMinutes: Number(document.getElementById('kds-setting-warn').value), lateMinutes: Number(document.getElementById('kds-setting-late').value), sound: document.getElementById('kds-setting-sound').checked };
      normalizeKdsSettings(); saveKdsLocal(); state.kdsPage = 0; dialog.close(); kitchenBoard(state.activeView === 'ready'); showToast('پروفایل این نمایشگر ذخیره شد.');
    });
  }

  function openKdsNote(ticket) {
    openDialog('Kitchen communication', 'یادداشت و درخواست هماهنگی', `<label class="field field--full"><span>پیامی که صندوق و سالن در سفارش می‌بینند</span><textarea id="kds-note-input" maxlength="240" rows="5" placeholder="مثلاً: آلرژی نیازمند تأیید، شماره پیجر اشتباه، جایگزینی دورچین…">${esc(ticket.kitchenNote || '')}</textarea></label><button class="role-primary" type="button" id="kds-note-save" style="width:100%;margin-top:12px">ثبت پیام روی سفارش</button>`);
    document.getElementById('kds-note-save').addEventListener('click', (event) => runKdsAction(event.currentTarget, ticket.id, { action: 'note', note: document.getElementById('kds-note-input').value }, 'پیام آشپزخانه ثبت شد.').then(() => dialog.close()));
  }

  function wireKitchen(readyOnly, visible) {
    main.querySelectorAll('[data-kds-station]').forEach((button) => button.addEventListener('click', () => { state.kdsStation = button.dataset.kdsStation; state.kdsPage = 0; state.kdsHighlightItem = ''; saveKdsLocal(); kitchenBoard(readyOnly); }));
    main.querySelectorAll('[data-kds-fulfillment]').forEach((button) => button.addEventListener('click', () => { state.kdsFulfillment = button.dataset.kdsFulfillment; state.kdsPage = 0; kitchenBoard(readyOnly); }));
    main.querySelectorAll('[data-kds-page]').forEach((button) => button.addEventListener('click', () => { state.kdsPage += Number(button.dataset.kdsPage); kitchenBoard(readyOnly); }));
    document.getElementById('kds-all-day')?.addEventListener('click', openKdsAllDay);
    document.getElementById('kds-availability')?.addEventListener('click', openKdsAvailability);
    document.getElementById('kds-settings')?.addEventListener('click', openKdsSettings);
    document.getElementById('kds-clear-highlight')?.addEventListener('click', () => { state.kdsHighlightItem = ''; kitchenBoard(readyOnly); });
    const search = document.getElementById('kds-search');
    let searchTimer = null;
    search?.addEventListener('input', () => { state.kdsSearch = search.value; clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.kdsPage = 0; kitchenBoard(readyOnly); document.getElementById('kds-search')?.focus(); }, 180); });
    main.querySelectorAll('[data-kds-item]').forEach((button) => button.addEventListener('click', () => {
      const completed = button.dataset.completed === 'true';
      runKdsAction(button, button.dataset.ticketId, { action: completed ? 'undo_item' : 'complete_item', lineKey: button.dataset.kdsItem }, completed ? 'آیتم به صف برگشت.' : 'آیتم تکمیل شد.', completed ? null : { label: 'آیتم تکمیل شد؛ اشتباه بود؟', payload: { action: 'undo_item', lineKey: button.dataset.kdsItem } });
    }));
    main.querySelectorAll('[data-kds-action]').forEach((button) => button.addEventListener('click', () => {
      const actionName = button.dataset.kdsAction;
      const payload = { action: actionName };
      if (actionName === 'complete_station') payload.station = button.dataset.station;
      runKdsAction(button, button.dataset.ticketId, payload, actionName === 'start_ticket' ? 'آماده‌سازی شروع شد.' : actionName === 'recall_ticket' ? 'تیکت به صف برگشت.' : actionName === 'complete_station' ? 'کار این ایستگاه تکمیل شد.' : 'سفارش آماده تحویل است.', actionName === 'complete_ticket' ? { label: 'تیکت آماده شد؛ اشتباه بود؟', payload: { action: 'recall_ticket' } } : null);
    }));
    main.querySelectorAll('[data-kds-priority]').forEach((button) => button.addEventListener('click', () => { const ticket = visible.find((entry) => String(entry.id) === String(button.dataset.ticketId)); runKdsAction(button, button.dataset.ticketId, { action: 'prioritize', priority: !ticket?.kds?.priority }, ticket?.kds?.priority ? 'اولویت برداشته شد.' : 'تیکت به ابتدای صف منتقل شد.', ticket?.kds?.priority ? null : { label: 'تیکت اولویت گرفت.', payload: { action: 'prioritize', priority: false } }); }));
    main.querySelectorAll('[data-kds-note]').forEach((button) => button.addEventListener('click', () => { const ticket = visible.find((entry) => String(entry.id) === String(button.dataset.ticketId)); if (ticket) openKdsNote(ticket); }));
    document.getElementById('kds-undo-action')?.addEventListener('click', async (event) => { const undo = state.kdsUndo; if (!undo) return; clearTimeout(state.kdsUndoTimer); state.kdsUndo = null; await runKdsAction(event.currentTarget, undo.orderId, undo.payload, 'عملیات بازگردانده شد.'); });
  }

  function handleKdsShortcut(event) {
    if (role !== 'kitchen' || state.activeView === 'inventory' || dialog.open || /INPUT|TEXTAREA|SELECT/.test(event.target?.tagName || '')) return;
    if (/^[1-9]$/.test(event.key)) {
      const ticket = main.querySelectorAll('.kds-ticket')[Number(event.key) - 1];
      const actionButton = ticket?.querySelector('[data-kds-action]:not(:disabled)');
      if (actionButton && !state.kdsPendingTickets.has(String(actionButton.dataset.ticketId))) { event.preventDefault(); actionButton.click(); }
    } else if (event.key.toLowerCase() === 'r') { event.preventDefault(); render(); }
    else if (event.key.toLowerCase() === 'a') { event.preventDefault(); openKdsAllDay(); }
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
