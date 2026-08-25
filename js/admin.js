/* Westo Command Center — professional cafe/restaurant admin SPA */
(() => {
  const main = document.getElementById('main');
  const toast = document.getElementById('toast');
  const topbarTitle = document.getElementById('topbar-title');
  const topbarMeta = document.getElementById('topbar-meta');
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
    inventory: 'موجودی انبار',
    costControl: 'کنترل هزینه',
    complements: 'مکمل‌ها و مهندسی منو',
    prices: 'مدیریت قیمت',
    products: 'دسته‌های کاروسل',
    promotions: 'تخفیف و پرومو',
    promoSlides: 'اسلایدر تبلیغاتی',
    restaurant: 'اطلاعات مجموعه',
    branches: 'شعبه‌ها',
    theme: 'تم و برندینگ',
    hours: 'ساعت کاری',
    tables: 'میزها',
    content: 'محتوای سایت',
    media: 'لوگو و رسانه',
    faq: 'سؤالات متداول',
    users: 'کاربران',
    loyalty: 'باشگاه مشتریان',
    club: 'باشگاه مشتریان',
    feedback: 'بازخورد و NPS',
    newsletter: 'خبرنامه',
    settings: 'تنظیمات',
    delivery: 'تحویل، پیک و پرداخت',
    accounting: 'مالی و حسابداری',
  };


  const TAB_DESCRIPTIONS = {
    dashboard: 'وضعیت امروز، هشدارها و کارهای فوری', kitchen: 'صف آماده‌سازی و وضعیت آشپزخانه', orders: 'پیگیری و تغییر وضعیت سفارش‌ها', reservations: 'رزروهای میز و ظرفیت زمانی',
    analytics: 'رفتار بازدیدکنندگان و مسیرهای پرتردد', reports: 'فروش، درآمد و آیتم‌های پرفروش', printmenu: 'پیش‌نمایش و چاپ منوی فعلی', translate: 'ترجمه نام و توضیح آیتم‌های منو',
    menu: 'ویرایش غذاها، قیمت، تصویر و دسترس‌پذیری', inventory: 'موجودی و هشدار کمبود آیتم‌ها', costControl: 'بهای تمام‌شده، حاشیه سود و اقلام کم‌موجود', complements: 'مدیریت مکمل‌های فروش‌محور و اتصال هوشمند آن‌ها به محصول یا دسته', prices: 'ویرایش سریع و گروهی قیمت‌ها', products: 'دسته‌بندی‌ها و ترتیب نمایش منو',
    promotions: 'مدیریت تخفیف‌های موجود', promoSlides: 'مدیریت اسلایدهای تبلیغاتی موجود', restaurant: 'اطلاعات عمومی و مشخصات مجموعه', branches: 'مشخصات و وضعیت شعبه‌ها',
    theme: 'رنگ‌ها و ظاهر برند', hours: 'ساعت فعالیت هر روز', tables: 'میزها، ظرفیت و QR', content: 'متن‌های فعلی سایت', media: 'لوگو و فایل‌های رسانه‌ای', faq: 'پرسش‌های متداول سایت',
    users: 'نقش و سطح دسترسی کاربران', loyalty: 'تنظیم و مانده باشگاه مشتریان', club: 'مشتریان، وفاداری، بازاریابی، بازخورد و خبرنامه', feedback: 'بازخوردها و NPS', newsletter: 'عضویت‌های خبرنامه', settings: 'تنظیمات شفاف و بخش‌بندی‌شده مجموعه', delivery: 'محدوده ارسال، پیک و وضعیت پرداخت', finance: 'مسیر قدیمی مالی؛ به فضای یکپارچه هدایت می‌شود',
    accounting: 'کارتابل حسابدار، فروش و صندوق، خرید، بهای تمام‌شده، دفاتر و پایان دوره'
  };

  const TAB_CAPABILITIES = {
    dashboard: 'command.view', kitchen: 'kitchen.view', orders: 'orders.view', reservations: 'reservations.view', delivery: 'delivery.view',
    menu: 'menu.view', prices: 'menu.manage', inventory: 'inventory.view', costControl: 'inventory.view', complements: 'menu.manage', products: 'menu.manage', translate: 'menu.manage', promotions: 'promotions.manage', promoSlides: 'content.manage', printmenu: 'menu.view',
    tables: 'tables.view', loyalty: 'admin.access', club: 'admin.access', feedback: 'admin.access', newsletter: 'admin.access',
    analytics: 'analytics.view', reports: 'reports.view', finance: 'finance.view', content: 'content.manage', media: 'content.manage', faq: 'content.manage',
    restaurant: 'admin.access', branches: 'admin.access', hours: 'admin.access', theme: 'admin.access', users: 'owner', settings: 'owner',
    accounting: 'finance.view',
  };

  let kitchenPoll = null;
  let kitchenSeenIds = new Set();
  let currentUserRole = 'guest';
  let currentUser = null;
  let activeTab = 'dashboard';
  let commandCenterStream = null;
  let commandCenterStreamKey = '';
  let liveRefreshTimer = null;
  let liveRefreshPending = false;
  let toastTimer = null;
  let kitchenPaint = null;
  let currentBranchId = Number(localStorage.getItem('westo_admin_branch') || 0) || null;
  let branchesCache = [];
  let networkInFlight = 0;
  let workspaceEnhanceTimer = null;

  function hasCapability(capability) {
    if (capability === 'owner') return currentUserRole === 'owner';
    const caps = currentUser?.capabilities || [];
    return caps.includes('*') || caps.includes(capability);
  }

  function statusLabel(status) {
    return {
      pending_online: 'در انتظار پرداخت آنلاین',
      awaiting_confirmation: 'نیازمند تأیید',
      pay_at_cashier: 'پرداخت در صندوق',
      paid: 'پرداخت‌شده',
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

  function nextStatusesForOrder(order) {
    const fulfillment = order.fulfillment || (order.tableNo ? 'dine_in' : 'pickup');
    const map = {
      pending_online: ['cancelled'],
      awaiting_confirmation: ['paid', 'cancelled'],
      pay_at_cashier: ['paid', 'cancelled'],
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
    const at = new Date(order?.createdAt || 0).getTime();
    return at ? Math.max(0, Math.floor((Date.now() - at) / 60000)) : 0;
  }

  function orderUrgency(order) {
    if (TERMINAL_ORDER_STATUSES.has(String(order?.status || ''))) return { key: 'closed', label: 'بسته', className: '' };
    const age = orderAgeMinutes(order);
    if (age >= 20) return { key: 'late', label: `${fmtNum(age)} دقیقه · دیرکرد`, className: ' is-late' };
    if (age >= 10) return { key: 'warn', label: `${fmtNum(age)} دقیقه`, className: ' is-warn' };
    return { key: 'normal', label: `${fmtNum(age)} دقیقه`, className: '' };
  }

  function primaryNextStatus(order) {
    return nextStatusesForOrder(order).find((status) => status !== order.status && status !== 'cancelled') || '';
  }

  function primaryActionLabel(status) {
    return {
      paid: 'تأیید پرداخت', preparing: 'شروع آماده‌سازی', ready: 'آماده شد', dispatched: 'تحویل به پیک',
      picked_up: 'تحویل حضوری شد', delivered: 'تحویل داده شد', done: 'تکمیل سفارش'
    }[status] || (status ? `مرحله بعد: ${statusLabel(status)}` : '');
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

  function currentBranch() {
    return branchesCache.find((b) => b.id === currentBranchId) || branchesCache[0] || null;
  }

  async function loadBranches(session = null) {
    try {
      const d = session || await api('/api/admin/session');
      branchesCache = d.branches || [];
      if (!currentBranchId || !branchesCache.some((b) => b.id === currentBranchId)) {
        currentBranchId = branchesCache[0]?.id || null;
        if (currentBranchId) localStorage.setItem('westo_admin_branch', String(currentBranchId));
      }
      paintBranchSelect();
    } catch {
      branchesCache = [];
    }
  }

  function paintBranchSelect() {
    const sel = document.getElementById('branch-select');
    if (!sel) return;
    sel.innerHTML = branchesCache
      .map(
        (b) =>
          `<option value="${b.id}" ${b.id === currentBranchId ? 'selected' : ''}>${esc(b.name)}${b.active === false ? ' (غیرفعال)' : ''}</option>`
      )
      .join('');
    sel.onchange = () => {
      currentBranchId = Number(sel.value) || null;
      if (currentBranchId) localStorage.setItem('westo_admin_branch', String(currentBranchId));
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

  const fmtMoney = (n) => `${Number(n || 0).toLocaleString('fa-IR')} تومان`;
  const fmtNum = (n) => Number(n || 0).toLocaleString('fa-IR');
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
      button.hidden = !!capability && !hasCapability(capability);
    });
    document.querySelectorAll('.nav-workspace').forEach((group) => {
      const visible = [...group.querySelectorAll('.admin-nav-item[data-tab]')].some((button) => !button.hidden);
      group.hidden = !visible;
    });
    const chip = document.getElementById('admin-user-chip');
    if (chip && currentUser) {
      chip.innerHTML = `<span>${esc(currentUser.name || currentUser.phone || 'کاربر')}</span><b>${esc(currentUser.roleLabel || currentUserRole)}</b>`;
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
      kitchen: { icon: '≋', description: 'KDS مستقل، تایمر تیکت، شروع آماده‌سازی و اعلام آماده‌شدن', tone: 'orange' },
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
      if (topbarMeta) topbarMeta.textContent = `زنده · ${new Date().toLocaleTimeString('fa-IR')}`;
      refreshLiveWorkspace();
    };
    ['order.created', 'order.updated', 'payment.updated', 'reservation.created', 'reservation.updated', 'delivery_zone.updated'].forEach((type) => {
      stream.addEventListener(type, onOperationalUpdate);
    });
    stream.onopen = () => {
      if (commandCenterStream !== stream) return;
      if (topbarMeta) topbarMeta.textContent = `زنده · ${new Date().toLocaleTimeString('fa-IR')}`;
    };
    stream.onerror = () => {
      if (commandCenterStream !== stream) return;
      if (topbarMeta) topbarMeta.textContent = 'اتصال زنده در حال اتصال مجدد…';
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
      radius: Number(document.getElementById('th_radius')?.value) || 14,
      fontDisplay: document.getElementById('th_font')?.value || 'Vazirmatn',
    };
  }

  function showToast(text, type = 'info', timeout = 2800) {
    if (!toast) return;
    toast.textContent = String(text || '');
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

  function friendlyHttpError(status, payload = {}) {
    if (status === 403) return 'برای انجام این کار دسترسی کافی ندارید.';
    if (status === 404) return 'اطلاعات موردنظر پیدا نشد.';
    if (status === 409) return payload.error || 'این تغییر با وضعیت فعلی سازگار نیست. صفحه را تازه کنید.';
    if (status === 413) return 'حجم اطلاعات ارسالی بیشتر از حد مجاز است.';
    if (status === 429) return 'تعداد درخواست‌ها زیاد است؛ چند لحظه دیگر دوباره تلاش کنید.';
    if (status >= 500) return 'سرور موقتاً پاسخ‌گو نیست؛ تغییرات شما ارسال نشد.';
    return payload.error || 'خطا در ارتباط با سرور';
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
    state.faq = d.faq;
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
    if (!hasValidCover(c)) return '<span class="pill blocked">بدون کاور</span>';
    if (!(n > 0)) return '<span class="pill ok">روی کاروسل</span><span class="hint"> · بدون غذا</span>';
    return '<span class="pill ok">روی کاروسل</span>';
  };

  let syncState = 'idle'; // idle | saving | error
  function setSyncStatus(next, detail = '') {
    syncState = next;
    const el = document.getElementById('topbar-meta');
    if (!el) return;
    if (next === 'saving') el.textContent = detail || 'در حال ذخیره…';
    else if (next === 'error') el.textContent = detail || 'خطا در ذخیره';
    else el.textContent = detail || 'همگام';
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
    }
    activeTab = name;
    if (location.hash !== `#${name}`) history.replaceState(null, '', `${location.pathname}${location.search}#${name}`);
    if (name !== 'kitchen') stopKitchenPoll();
    document.querySelectorAll('.admin-nav-item[data-tab]').forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    document.querySelector(`.admin-nav-item[data-tab="${name}"]`)?.closest('details')?.setAttribute('open', '');
    if (topbarTitle) topbarTitle.textContent = TAB_TITLES[name] || name;
    if (topbarContext) topbarContext.textContent = TAB_DESCRIPTIONS[name] || 'مرکز فرمان WESTO';
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

  // ---------- tabs ----------
  const tabs = {
    async dashboard() {
      setActiveTab('dashboard');
      const [d, live, stats] = await Promise.all([
        api(`/api/admin/command-center${branchQs()}`),
        api(`/api/admin/v2/overview${branchQs()}`),
        api(`/api/admin/stats${branchQs()}`).catch(() => ({ revenueWeek: 0, topItems: [] })),
      ]);
      const br = currentBranch();
      const salesToday = Number(live.metrics?.salesToday || 0);
      const activeOrders = Number(live.metrics?.activeOrders || 0);
      const busyTables = Number(live.metrics?.busyTables || 0);
      const reservationsToday = Number(d.summary?.reservationsToday || 0);
      const openCalls = Number(live.metrics?.openWaiterCalls || 0);
      const delayed = Number(d.summary?.delayed || 0);
      const queue = Number(d.summary?.queue || 0);
      const weeklyDailyAverage = Number(stats.revenueWeek || 0) / 7;
      const salesHealth = salesToday > 0
        ? Math.max(1, Math.min(100, Math.round((salesToday / Math.max(1, weeklyDailyAverage || salesToday)) * 100)))
        : 0;
      const kitchenHealth = Math.max(0, Math.min(100, 100 - delayed * 14 - Math.max(0, queue - 3) * 4));
      const overviewSegments = [
        { label: 'سفارش فعال', value: activeOrders, color: '#66c346' },
        { label: 'میز درگیر', value: busyTables, color: '#4d97ed' },
        { label: 'رزرو امروز', value: reservationsToday, color: '#9b7eea' },
        { label: 'فراخوان باز', value: openCalls, color: '#ffad45' },
      ];
      const overviewTotal = overviewSegments.reduce((sum, item) => sum + item.value, 0) || 1;
      let overviewCursor = 0;
      const overviewGradient = overviewSegments.map((item) => {
        const start = overviewCursor;
        overviewCursor += (item.value / overviewTotal) * 100;
        return `${item.color} ${start.toFixed(2)}% ${overviewCursor.toFixed(2)}%`;
      }).join(', ');
      const displayName = currentUser?.name || currentUser?.phone || 'مدیر وستو';
      main.innerHTML = `
        <div class="vital-dashboard">
          <header class="vital-welcome">
            <div>
              <p class="eyebrow">مرکز فرمان زنده${br ? ` · ${esc(br.name)}` : ''}</p>
              <h1>وقت بخیر، ${esc(displayName)} <span aria-hidden="true">👋</span></h1>
              <p class="lead">امروز در مجموعه چه می‌گذرد؛ فروش، سفارش، آشپزخانه و هشدارها در یک نگاه.</p>
            </div>
            <div class="vital-page-actions">
              <span class="vital-date-pill">${window.ShamsiCore ? window.ShamsiCore.formatShamsiDateFull(new Date()) : new Date().toLocaleDateString('fa-IR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
              <button class="btn btn-sm btn-ghost" data-quick-tab="orders">+ سفارش جدید</button>
            </div>
          </header>

          <section class="vital-kpi-grid" aria-label="شاخص‌های اصلی امروز">
            <article class="vital-kpi is-green"><span class="vital-kpi__icon" aria-hidden="true">⌁</span><small>فروش امروز</small><strong>${fmtMoney(salesToday)}</strong><em>${salesHealth >= 100 ? 'بالاتر از میانگین هفتگی' : `${fmtNum(salesHealth)}٪ میانگین روزانه هفته`}</em></article>
            <article class="vital-kpi is-purple"><span class="vital-kpi__icon" aria-hidden="true">▣</span><small>سفارش‌های فعال</small><strong>${fmtNum(activeOrders)}</strong><em>${queue ? `${fmtNum(queue)} سفارش نیازمند اقدام` : 'صف عملیات تحت کنترل است'}</em></article>
            <article class="vital-kpi is-blue"><span class="vital-kpi__icon" aria-hidden="true">▤</span><small>میزهای درگیر</small><strong>${fmtNum(busyTables)} <i>از ${fmtNum(live.metrics?.totalTables || 0)}</i></strong><em>وضعیت زنده سالن</em></article>
            <article class="vital-kpi is-orange"><span class="vital-kpi__icon" aria-hidden="true">◌</span><small>رزروهای امروز</small><strong>${fmtNum(reservationsToday)}</strong><em>${openCalls ? `${fmtNum(openCalls)} فراخوان گارسون باز` : 'فراخوان بازی وجود ندارد'}</em></article>
          </section>

          <div class="vital-dashboard-layout">
            <div class="vital-dashboard-main">
              <section class="vital-health-grid" aria-label="سلامت عملیات">
                <article class="vital-health-card vital-health-card--sales">
                  <header><span>سلامت فروش</span><button type="button" class="vital-more" aria-label="جزئیات فروش" data-quick-tab="reports">•••</button></header>
                  <div class="vital-dot-score" aria-label="امتیاز ${fmtNum(salesHealth)} از ۱۰۰">${fmtNum(salesHealth)}</div>
                  <strong>${salesHealth >= 90 ? 'عالی' : salesHealth >= 65 ? 'رو به رشد' : 'نیازمند توجه'}</strong>
                  <p>${fmtMoney(salesToday)} فروش ثبت‌شده امروز</p>
                  <div class="vital-dot-wave" aria-hidden="true"></div>
                </article>
                <article class="vital-health-card vital-health-card--kitchen">
                  <header><span>عملکرد آشپزخانه</span><button type="button" class="vital-more" aria-label="جزئیات آشپزخانه" data-quick-tab="kitchen">•••</button></header>
                  <div class="vital-dot-score" aria-label="امتیاز ${fmtNum(kitchenHealth)} از ۱۰۰">${fmtNum(kitchenHealth)}</div>
                  <strong>${delayed ? 'نیازمند اقدام' : 'خوب'}</strong>
                  <p>${delayed ? `${fmtNum(delayed)} سفارش دارای تأخیر` : 'سفارش دیرکرده‌ای ثبت نشده است'}</p>
                  <div class="vital-dot-wave" aria-hidden="true"></div>
                </article>
                <article class="vital-overview-card">
                  <header><div><p class="eyebrow">نمای امروز</p><h2>ترکیب عملیات</h2></div></header>
                  <div class="vital-overview-content">
                    <div class="vital-donut" style="--vital-donut:${overviewGradient}" role="img" aria-label="ترکیب عملیات امروز"><span><strong>${fmtNum(overviewSegments.reduce((sum, item) => sum + item.value, 0))}</strong><small>رویداد</small></span></div>
                    <div class="vital-donut-legend">
                      ${overviewSegments.map((item) => `<div><i style="--legend:${item.color}"></i><span>${esc(item.label)}</span><strong>${fmtNum(item.value)} <small>(${Math.round((item.value / overviewTotal) * 100)}٪)</small></strong></div>`).join('')}
                    </div>
                  </div>
                </article>
              </section>

              <section class="vital-detail-grid">
                <article class="section-box vital-chart-card">
                  <div class="ops-panel__head"><div><p class="eyebrow">روند درآمد</p><h2>${fmtMoney(stats.revenueWeek || 0)}</h2><span class="hint">فروش هفته جاری</span></div><button class="text-btn" data-quick-tab="reports">مشاهده گزارش</button></div>
                  ${sparkBars([Math.max(0, weeklyDailyAverage * .58), weeklyDailyAverage * .72, weeklyDailyAverage * .68, weeklyDailyAverage * .86, weeklyDailyAverage, weeklyDailyAverage * .92, salesToday], 76)}
                </article>
                <article class="section-box vital-selling-card">
                  <div class="ops-panel__head"><div><p class="eyebrow">محبوب‌ترین‌ها</p><h2>آیتم‌های پرفروش</h2></div><button class="text-btn" data-quick-tab="reports">همه</button></div>
                  <div class="vital-selling-list">
                    ${(stats.topItems || []).slice(0, 5).map((item, index) => `<div><span class="vital-selling-rank">${fmtNum(index + 1)}</span><div><b>${esc(item.name)}</b><small>${fmtNum(item.qty)} فروش</small></div><strong>${fmtMoney(item.revenue)}</strong></div>`).join('') || '<p class="ops-empty">هنوز فروش ثبت نشده است.</p>'}
                  </div>
                </article>
              </section>

              <nav class="vital-action-dock" aria-label="اقدام‌های سریع">
                <button data-quick-tab="orders"><i>＋</i><span>سفارش‌ها</span></button>
                <button data-quick-tab="reservations"><i>□</i><span>رزرو میز</span></button>
                <button data-quick-tab="menu"><i>＋</i><span>افزودن آیتم</span></button>
                <button data-quick-tab="club"><i>⌁</i><span>ارسال کمپین</span></button>
                <button data-quick-tab="reports"><i>▥</i><span>گزارش‌ها</span></button>
              </nav>
            </div>

            <aside class="vital-side-column" aria-label="جریان زنده و هشدارها">
              <section class="section-box vital-live-panel">
                <div class="ops-panel__head"><h2>سفارش‌های زنده</h2><button class="text-btn" data-quick-tab="orders">همه</button></div>
                <div class="vital-live-list">
                  ${(d.queue || []).slice(0, 5).map((order, index) => `<button data-order-jump="${order.id}"><i class="vital-status-dot is-${index % 4}"></i><span><b>#${order.id}</b><small>${esc(order.tableNo ? `میز ${order.tableNo}` : fulfillmentLabel(order.fulfillment))}</small></span><em>${esc(statusLabel(order.status))}</em><time>${fmtNum(order.ageMinutes)}د</time></button>`).join('') || '<p class="ops-empty">سفارشی در صف نیست.</p>'}
                </div>
              </section>
              <section class="section-box vital-alert-panel">
                <div class="ops-panel__head"><h2>هشدارها</h2><button class="text-btn" data-quick-tab="inventory">همه</button></div>
                <div class="vital-alert-list">
                  ${(d.delayed || []).slice(0, 3).map((order) => `<div><i class="is-red">!</i><span><b>تأخیر سفارش #${order.id}</b><small>${fmtNum(order.ageMinutes)} دقیقه در ${esc(statusLabel(order.status))}</small></span></div>`).join('')}
                  ${(d.lowStock || []).slice(0, 3).map((item) => `<div><i class="is-orange">▣</i><span><b>موجودی کم: ${esc(item.name)}</b><small>${fmtNum(item.stock)} عدد باقی مانده</small></span></div>`).join('')}
                  ${!(d.delayed || []).length && !(d.lowStock || []).length ? '<p class="ops-empty">هشدار فوری وجود ندارد.</p>' : ''}
                </div>
              </section>
              <section class="section-box vital-task-panel">
                <div class="ops-panel__head"><h2>پیگیری امروز</h2><button class="text-btn" data-quick-tab="reservations">همه</button></div>
                <div class="vital-task-list">
                  ${(d.reservations || []).slice(0, 4).map((reservation) => `<div class="vital-task-row"><i aria-hidden="true"></i><span>${esc(reservation.time)} · ${esc(reservation.name)}</span></div>`).join('') || '<p class="ops-empty">کاری برای پیگیری ثبت نشده است.</p>'}
                </div>
              </section>
            </aside>
          </div>
        </div>`;
      main.querySelectorAll('[data-quick-tab]').forEach((button) => {
        button.addEventListener('click', () => tabs[button.dataset.quickTab]?.().catch((error) => showToast(error.message)));
      });
      main.querySelectorAll('[data-order-jump]').forEach((button) => {
        button.addEventListener('click', () => {
          sessionStorage.setItem('westo_admin_focus_order', button.dataset.orderJump);
          tabs.orders().catch((error) => showToast(error.message));
        });
      });
    },

    async analytics() {
      setActiveTab('analytics');
      const a = await api('/api/admin/analytics?days=7');
      const dayVals = Object.keys(a.byDay || {})
        .sort()
        .map((k) => a.byDay[k]);
      main.innerHTML = `
        <h1>بازدید و آمار مهمانان</h1>
        <p class="lead">رهگیری بازدید صفحات منو — مشابه آمار بازدید در سامانه‌های منوی دیجیتال.</p>
        <div class="cards">
          <div class="card"><div class="num">${fmtNum(a.total)}</div><div class="lbl">بازدید ${a.days} روز</div></div>
          <div class="card"><div class="num">${fmtNum(a.sessions)}</div><div class="lbl">نشست یکتا</div></div>
          <div class="card"><div class="num">${fmtNum((a.topPaths || [])[0]?.count || 0)}</div><div class="lbl">بیشترین مسیر</div></div>
        </div>
        <div class="section-box">
          <h2>روند روزانه</h2>
          ${sparkBars(dayVals.length ? dayVals : [0], 64)}
        </div>
        <div class="grid-2-main">
          <div class="section-box">
            <h2>توزیع ساعتی</h2>
            ${sparkBars(a.byHour || Array(24).fill(0), 48)}
          </div>
          <div class="section-box">
            <h2>مسیرهای پربازدید</h2>
            <table class="tbl"><thead><tr><th>مسیر</th><th>بازدید</th></tr></thead><tbody>
              ${(a.topPaths || []).map((p) => `<tr><td class="ltr">${esc(p.path)}</td><td>${fmtNum(p.count)}</td></tr>`).join('') || '<tr><td colspan="2">هنوز بازدیدی ثبت نشده — سایت را باز کنید</td></tr>'}
            </tbody></table>
          </div>
        </div>
        <div class="section-box">
          <h2>آخرین بازدیدها</h2>
          <table class="tbl"><thead><tr><th>زمان</th><th>مسیر</th><th>نشست</th></tr></thead><tbody>
            ${(a.recent || []).map((v) => `<tr><td>${fmtDateTime(v.at)}</td><td class="ltr">${esc(v.path)}</td><td class="ltr">${esc(String(v.sessionId || '').slice(0, 10))}</td></tr>`).join('') || '<tr><td colspan="3">—</td></tr>'}
          </tbody></table>
        </div>`;
    },

    async reports() {
      setActiveTab('reports');
      const s = await api(`/api/admin/stats${branchQs()}`);
      main.innerHTML = `
        <h1>گزارش فروش</h1>
        <p class="lead">صورت‌حساب ساده مالی${currentBranch() ? ` شعبه ${esc(currentBranch().name)}` : ''}.</p>
        <div class="cards">
          <div class="card accent"><div class="num">${fmtMoney(s.revenue)}</div><div class="lbl">جمع کل فروش</div></div>
          <div class="card"><div class="num">${fmtMoney(s.revenueWeek)}</div><div class="lbl">هفته جاری</div></div>
          <div class="card"><div class="num">${fmtNum(s.orders)}</div><div class="lbl">تعداد سفارش</div></div>
        </div>
        <div class="section-box">
          <h2>رتبه‌بندی آیتم‌ها</h2>
          <table class="tbl"><thead><tr><th>#</th><th>نام</th><th>تعداد</th><th>درآمد</th><th>سهم</th></tr></thead><tbody>
            ${(s.topItems || [])
              .map((i, idx) => {
                const share = s.revenue ? Math.round((i.revenue / s.revenue) * 100) : 0;
                return `<tr><td>${idx + 1}</td><td>${esc(i.name)}</td><td>${fmtNum(i.qty)}</td><td>${fmtMoney(i.revenue)}</td><td>${share}٪</td></tr>`;
              })
              .join('') || '<tr><td colspan="5">داده‌ای نیست</td></tr>'}
          </tbody></table>
        </div>`;
    },

    async printmenu() {
      setActiveTab('printmenu');
      const d = await api('/api/admin/restaurant');
      const r = d.restaurant || {};
      main.innerHTML = `
        <h1>منوی چاپی / PDF</h1>
        <p class="lead">خروجی کاغذی از منوی زنده — مشابه ترکیب منوی دیجیتال و کاغذی در سامانه‌هایی مثل پرومنو. برای چاپ یا ذخیره PDF از دیالوگ چاپ مرورگر استفاده کنید.</p>
        <div class="section-box">
          <h2>${esc(r.name || 'وستو')}</h2>
          <p class="hint">${esc(r.tagline || '')}</p>
          <div class="row-actions" style="margin-top:1rem;">
            <a class="btn btn-sm" href="/menu-print" target="_blank" rel="noopener">باز کردن پیش‌نمایش چاپ</a>
            <button class="btn btn-sm btn-ghost" id="pm-window">باز کردن و چاپ فوری</button>
          </div>
          <ul class="hint" style="margin-top:1.25rem; line-height:1.7;">
            <li>می‌توانید ناموجودها، آلرژن‌ها و توضیحات را در صفحه چاپ روشن/خاموش کنید.</li>
            <li>در دیالوگ چاپ، مقصد را «Save as PDF» بگذارید تا فایل بگیرید.</li>
            <li>قیمت‌ها و دسته‌ها همان لحظه از دیتابیس خوانده می‌شوند.</li>
          </ul>
        </div>
        <div class="section-box">
          <h2>میانبرها</h2>
          <div class="row-actions">
            <button class="btn btn-sm btn-ghost" data-tabjump="menu">ویرایش منو</button>
            <button class="btn btn-sm btn-ghost" data-tabjump="prices">مدیریت قیمت</button>
            <button class="btn btn-sm btn-ghost" data-tabjump="restaurant">اطلاعات مجموعه</button>
          </div>
        </div>`;
      document.getElementById('pm-window').addEventListener('click', () => {
        const w = window.open('/menu-print', '_blank');
        if (!w) return showToast('پاپ‌آپ مسدود شد');
        const t = setInterval(() => {
          try {
            if (w.document && w.document.getElementById('sheet')?.querySelector('.print-head')) {
              clearInterval(t);
              setTimeout(() => w.print(), 400);
            }
          } catch (_) {
            /* cross-check while loading */
          }
        }, 200);
        setTimeout(() => clearInterval(t), 8000);
      });
      main.querySelectorAll('[data-tabjump]').forEach((b) =>
        b.addEventListener('click', () => {
          const tab = b.dataset.tabjump;
          document.querySelector(`.admin-nav-item[data-tab="${tab}"]`)?.click();
        })
      );
    },

    async restaurant() {
      setActiveTab('restaurant');
      const d = await api('/api/admin/restaurant');
      const r = d.restaurant || {};
      main.innerHTML = `
        <h1>اطلاعات مجموعه</h1>
        <p class="lead">پروفایل کافه‌رستوران — نام، آدرس، تماس و معرفی (مشابه «اطلاعات مجموعه» در تاپ منو).</p>
        <div class="section-box">
          <div class="grid-2">
            ${field('نام مجموعه', 'r_name', r.name || '')}
            ${field('برند نمایشی', 'r_brand', r.brandName || '')}
            ${field('شعار', 'r_tag', r.tagline || '')}
            ${field('واحد پول', 'r_cur', r.currency || 'تومان')}
            ${field('آدرس', 'r_addr', r.address || '')}
            ${field('تلفن', 'r_phone', r.phone || '', { ltr: true })}
            ${field('اینستاگرام', 'r_ig', r.instagram || '', { ltr: true })}
            ${field('وب‌سایت', 'r_web', r.website || '', { ltr: true })}
            ${field('مالیات ٪', 'r_tax', String(r.taxPercent ?? 0), { ltr: true, type: 'number' })}
            ${field('سرویس ٪', 'r_svc', String(r.servicePercent ?? 0), { ltr: true, type: 'number' })}
          </div>
          ${field('درباره مجموعه', 'r_about', r.about || '', { textarea: true })}
          <p class="hint" style="margin-top:0.75rem">ذخیره خودکار</p>
        </div>`;
      const saveRestaurant = async () => {
        await api('/api/admin/restaurant', {
          method: 'PUT',
          body: JSON.stringify({
            restaurant: {
              name: document.getElementById('r_name').value,
              brandName: document.getElementById('r_brand').value,
              tagline: document.getElementById('r_tag').value,
              address: document.getElementById('r_addr').value,
              phone: document.getElementById('r_phone').value,
              instagram: document.getElementById('r_ig').value,
              website: document.getElementById('r_web').value,
              currency: document.getElementById('r_cur').value,
              about: document.getElementById('r_about').value,
              taxPercent: Number(document.getElementById('r_tax').value) || 0,
              servicePercent: Number(document.getElementById('r_svc').value) || 0,
            },
          }),
        });
      };
      bindAutosave(main, saveRestaurant);
    },

    async theme() {
      setActiveTab('theme');
      const d = await api('/api/admin/theme');
      const t = d.theme || {};
      const defaults = {
        accent: '#78d0d8',
        accentInk: '#0a1a1c',
        surface: '#111318',
        bg: '#08090b',
        fog: '#ece8e2',
        printPaper: '#f7f3ec',
        printInk: '#1a1714',
        printAccent: '#2a7a86',
        radius: 14,
        fontDisplay: 'Vazirmatn',
      };
      const v = { ...defaults, ...t };
      main.innerHTML = `
        <h1>تم و برندینگ</h1>
        <p class="lead">تم‌ساز مجموعه — رنگ پنل، منوی چاپی و هویت بصری. مشابه تم‌های سفارشی منوهای دیجیتال حرفه‌ای.</p>
        <div class="section-box">
          <h2>پیش‌نمایش زنده</h2>
          <div class="theme-preview" id="theme-preview">
            <div class="theme-preview__bar">مرکز فرمان</div>
            <div class="theme-preview__card">
              <strong>نمونه کارت</strong>
              <button type="button" class="btn btn-sm" style="width:auto;margin-top:0.6rem;">دکمه نمونه</button>
            </div>
          </div>
        </div>
        <div class="section-box">
          <h2>رنگ‌های پنل</h2>
          <div class="grid-2">
            ${colorField('اکسنت', 'th_accent', v.accent)}
            ${colorField('متن روی اکسنت', 'th_accentInk', v.accentInk)}
            ${colorField('سطح', 'th_surface', v.surface)}
            ${colorField('پس‌زمینه', 'th_bg', v.bg)}
            ${colorField('متن اصلی', 'th_fog', v.fog)}
            ${field('شعاع گوشه (px)', 'th_radius', String(v.radius), { ltr: true, type: 'number' })}
            ${field('فونت نمایشی', 'th_font', v.fontDisplay)}
          </div>
        </div>
        <div class="section-box">
          <h2>منوی چاپی</h2>
          <div class="grid-2">
            ${colorField('کاغذ', 'th_printPaper', v.printPaper)}
            ${colorField('مرکب', 'th_printInk', v.printInk)}
            ${colorField('اکسنت چاپ', 'th_printAccent', v.printAccent)}
          </div>
        </div>
        <div class="row-actions">
          <span class="hint">ذخیره خودکار</span>
          <button class="btn btn-sm btn-ghost" id="th-reset">بازگشت به پیش‌فرض</button>
          <a class="btn btn-sm btn-ghost" href="/menu-print" target="_blank" rel="noopener" style="text-decoration:none;width:auto;">پیش‌نمایش چاپ</a>
        </div>`;

      const saveTheme = async () => {
        const theme = readThemeForm();
        await api('/api/admin/theme', { method: 'PUT', body: JSON.stringify({ theme }) });
        applyTheme(theme);
      };
      const themeAutosave = autosave(saveTheme, { debounceMs: 400, silent: true });

      ['th_accent', 'th_accentInk', 'th_surface', 'th_bg', 'th_fog', 'th_printPaper', 'th_printInk', 'th_printAccent'].forEach((id) => {
        wireColorPair(id);
        document.getElementById(id)?.addEventListener('input', themeAutosave);
        document.getElementById(`${id}_hex`)?.addEventListener('change', themeAutosave);
        document.getElementById(`${id}_hex`)?.addEventListener('input', themeAutosave);
      });
      document.getElementById('th_radius')?.addEventListener('input', () => {
        applyTheme(readThemeForm());
        themeAutosave();
      });
      document.getElementById('th_font')?.addEventListener('input', themeAutosave);
      applyTheme(v);

      document.getElementById('th-reset').addEventListener('click', async () => {
        await api('/api/admin/theme', { method: 'PUT', body: JSON.stringify({ theme: defaults }) });
        showToast('تم پیش‌فرض اعمال شد');
        tabs.theme();
      });
    },

    async hours() {
      setActiveTab('hours');
      const d = await api(`/api/admin/restaurant${branchQs()}`);
      const hours = d.hours || {};
      const br = d.branch || currentBranch();
      main.innerHTML = `
        <h1>ساعت کاری</h1>
        <p class="lead">زمان‌بندی هفتگی${br ? ` — <strong>${esc(br.name)}</strong>` : ''}.</p>
        <div class="section-box">
          <table class="tbl hours-tbl"><thead><tr><th>روز</th><th>باز</th><th>بسته</th><th>تعطیل</th></tr></thead><tbody>
            ${Object.keys(DAY_LABELS)
              .map((k) => {
                const h = hours[k] || { open: '10:00', close: '23:00', closed: false };
                return `<tr data-day="${k}">
                  <td>${DAY_LABELS[k]}</td>
                  <td><input class="h-open" type="time" value="${esc(h.open)}" ${h.closed ? 'disabled' : ''} /></td>
                  <td><input class="h-close" type="time" value="${esc(h.close)}" ${h.closed ? 'disabled' : ''} /></td>
                  <td><label class="chk"><input class="h-closed" type="checkbox" ${h.closed ? 'checked' : ''} /> تعطیل</label></td>
                </tr>`;
              })
              .join('')}
          </tbody></table>
          <p class="hint" style="margin-top:0.75rem">ذخیره خودکار</p>
        </div>`;
      const saveHours = async () => {
        const payload = {};
        main.querySelectorAll('tr[data-day]').forEach((tr) => {
          payload[tr.dataset.day] = {
            open: tr.querySelector('.h-open').value,
            close: tr.querySelector('.h-close').value,
            closed: tr.querySelector('.h-closed').checked,
          };
        });
        await api('/api/admin/hours', {
          method: 'PUT',
          body: JSON.stringify({ hours: payload, branchId: currentBranchId }),
        });
      };
      const hoursAutosave = autosave(saveHours, { debounceMs: 400, silent: true });
      main.querySelectorAll('.h-closed').forEach((cb) => {
        cb.addEventListener('change', () => {
          const tr = cb.closest('tr');
          tr.querySelectorAll('.h-open, .h-close').forEach((inp) => {
            inp.disabled = cb.checked;
          });
          hoursAutosave();
        });
      });
      main.querySelectorAll('.h-open, .h-close').forEach((inp) => {
        inp.addEventListener('change', hoursAutosave);
        inp.addEventListener('input', hoursAutosave);
      });
    },

    async tables() {
      setActiveTab('tables');
      const [d, floorData] = await Promise.all([
        api(`/api/admin/tables${branchQs()}`),
        api(`/api/admin/v2/floor${branchQs()}`),
      ]);
      const br = currentBranch();
      const origin = location.origin;
      const QR_PREFS_KEY = 'westo_admin_qr_studio_v1';
      const defaultQrPrefs = {
        baseUrl: origin,
        dark: '#11181b',
        light: '#ffffff',
        ecl: 'M',
        width: 768,
        margin: 5,
      };
      let qrPrefs = (() => {
        try {
          const saved = JSON.parse(localStorage.getItem(QR_PREFS_KEY) || '{}');
          return { ...defaultQrPrefs, ...saved };
        } catch (_) {
          return { ...defaultQrPrefs };
        }
      })();
      let tables = Array.isArray(d.tables) ? d.tables : [];
      let currentTableId = Number(tables[0]?.id) || null;
      const selectedTableIds = new Set();

      const validHex = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
      const validBaseUrl = (value) => {
        try {
          const url = new URL(String(value || '').trim());
          if (!['http:', 'https:'].includes(url.protocol)) return '';
          url.hash = '';
          url.search = '';
          return url.href.replace(/\/$/, '');
        } catch (_) {
          return '';
        }
      };
      const normalizeQrPrefs = () => {
        qrPrefs = {
          ...defaultQrPrefs,
          ...qrPrefs,
          baseUrl: validBaseUrl(qrPrefs.baseUrl) || origin,
          dark: validHex(qrPrefs.dark, defaultQrPrefs.dark),
          light: validHex(qrPrefs.light, defaultQrPrefs.light),
          ecl: ['L', 'M', 'Q', 'H'].includes(String(qrPrefs.ecl).toUpperCase()) ? String(qrPrefs.ecl).toUpperCase() : 'M',
          width: [512, 768, 1024].includes(Number(qrPrefs.width)) ? Number(qrPrefs.width) : 768,
          margin: [3, 5, 8].includes(Number(qrPrefs.margin)) ? Number(qrPrefs.margin) : 5,
        };
      };
      const saveQrPrefs = () => {
        try { localStorage.setItem(QR_PREFS_KEY, JSON.stringify(qrPrefs)); } catch (_) {}
      };
      normalizeQrPrefs();

      const tableById = (id) => tables.find((table) => Number(table.id) === Number(id)) || null;
      const tableTitle = (table) => String(table?.label || `میز ${table?.id || ''}`).trim();
      const activeTables = () => tables.filter((table) => table.active !== false);
      const selectedTables = () => tables.filter((table) => selectedTableIds.has(Number(table.id)));
      const baseQrUrl = () => validBaseUrl(qrPrefs.baseUrl) || origin;
      const qrEclHint = () => ({ L: 'فایل سبک', M: 'استاندارد', Q: 'مقاوم‌تر برای محیط شلوغ', H: 'بیشترین تحمل خطا' }[qrPrefs.ecl] || 'استاندارد');
      const tableDestination = (table) => {
        const url = new URL('/menu', `${baseQrUrl()}/`);
        url.searchParams.set('table', String(table?.id || ''));
        url.searchParams.set('branch', String(table?.branchId || currentBranchId || 1));
        return url.href;
      };
      const qrAssetUrl = (table, { download = false } = {}) => {
        const url = new URL('/api/admin/qr-code', origin);
        url.searchParams.set('data', tableDestination(table));
        url.searchParams.set('dark', qrPrefs.dark);
        url.searchParams.set('light', qrPrefs.light);
        url.searchParams.set('ecl', qrPrefs.ecl);
        url.searchParams.set('width', String(qrPrefs.width));
        url.searchParams.set('margin', String(qrPrefs.margin));
        url.searchParams.set('filename', `westo-table-${table?.id || 'qr'}`);
        if (download) url.searchParams.set('download', '1');
        return url.href;
      };
      const selectedLabel = () => `${fmtNum(selectedTableIds.size)} میز انتخاب شده`;

      const copyText = async (value) => {
        const text = String(value || '');
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            const area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            document.execCommand('copy');
            area.remove();
          }
          showToast('لینک QR کپی شد.', 'success');
        } catch (_) {
          showToast('کپی لینک انجام نشد؛ لینک را از کادر مقصد انتخاب کنید.', 'error');
        }
      };

      const printQrTables = (list) => {
        const printable = Array.isArray(list) ? list.filter(Boolean) : [];
        if (!printable.length) {
          showToast('حداقل یک میز را برای چاپ انتخاب کنید.', 'error');
          return;
        }
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
          showToast('پنجره چاپ توسط مرورگر مسدود شد.', 'error');
          return;
        }
        const branchName = br?.name || 'وستو';
        const cards = printable.map((table) => `
          <article class="qr-print-card">
            <div class="qr-print-card__brand">WESTO <span>کافه‌رستوران</span></div>
            <img src="${esc(qrAssetUrl(table))}" alt="QR ${esc(tableTitle(table))}" />
            <h1>${esc(tableTitle(table))}</h1>
            <p>منوی دیجیتال و ثبت سفارش روی میز</p>
            <small>${esc(branchName)} · ${esc(table.zone || 'سالن')}</small>
          </article>`).join('');
        printWindow.document.write(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>QR میزها · ${esc(branchName)}</title><style>
          @page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;background:#fff;color:#11181b;font-family:Arial,"Vazirmatn",sans-serif}.qr-print-sheet{display:grid;grid-template-columns:repeat(2,1fr);gap:10mm}.qr-print-card{display:flex;min-height:118mm;align-items:center;justify-content:center;flex-direction:column;padding:10mm 7mm;border:1px solid #d9e0df;border-radius:6mm;text-align:center;break-inside:avoid}.qr-print-card__brand{margin-bottom:4mm;color:#14282b;font-size:18px;font-weight:900;letter-spacing:.12em}.qr-print-card__brand span{display:block;margin-top:1.5mm;color:#6f7a78;font-size:9px;font-weight:500;letter-spacing:0}.qr-print-card img{display:block;width:62mm;height:62mm;object-fit:contain;image-rendering:pixelated}.qr-print-card h1{margin:5mm 0 1mm;font-size:22px}.qr-print-card p{margin:0;color:#56625f;font-size:11px}.qr-print-card small{margin-top:3mm;color:#74807d;font-size:9px}@media print{.qr-print-card{border-color:#c9d2d0}}
        </style></head><body><main class="qr-print-sheet">${cards}</main><script>window.addEventListener('load',function(){var imgs=[].slice.call(document.images);Promise.all(imgs.map(function(img){return img.complete?Promise.resolve():new Promise(function(resolve){img.onload=img.onerror=resolve})})).then(function(){setTimeout(function(){window.focus();window.print()},180)})});<\/script></body></html>`);
        printWindow.document.close();
      };

      const render = () => {
        const current = tableById(currentTableId) || tables[0] || null;
        currentTableId = current ? Number(current.id) : null;
        const tableOptions = tables.map((table) => `<option value="${table.id}" ${Number(table.id) === Number(currentTableId) ? 'selected' : ''}>${esc(tableTitle(table))} · ${esc(table.zone || 'سالن')}</option>`).join('');
        const currentPreview = current
          ? `<div class="admin-qr-preview">
              <div class="admin-qr-preview__stage"><img id="qr-live-preview" data-qr-img="${current.id}" src="${esc(qrAssetUrl(current))}" alt="پیش‌نمایش QR ${esc(tableTitle(current))}" /></div>
              <div class="admin-qr-preview__details">
                <div class="admin-qr-preview__table"><strong id="qr-current-name">${esc(tableTitle(current))}</strong><span id="qr-current-seats">${fmtNum(current.seats || 0)} نفر</span></div>
                <p class="hint" id="qr-current-zone">${esc(current.zone || 'سالن')} · مقصد امن و اختصاصی همین میز</p>
                <div class="admin-qr-destination"><small>مقصدی که داخل QR ذخیره شده</small><code id="qr-current-destination" dir="ltr">${esc(tableDestination(current))}</code></div>
                <div class="admin-qr-preview__actions">
                  <a class="btn btn-sm" id="qr-download-current" href="${esc(qrAssetUrl(current, { download: true }))}" download="westo-table-${current.id}.png">دانلود PNG</a>
                  <button type="button" class="btn btn-sm btn-ghost" id="qr-copy-current">کپی لینک</button>
                  <button type="button" class="btn btn-sm btn-ghost" id="qr-print-current">چاپ همین QR</button>
                </div>
              </div>
            </div>`
          : `<div class="admin-qr-preview__stage is-empty" role="status"></div>`;

        main.innerHTML = `
          <div class="admin-qr-page">
            <header class="admin-qr-page__head">
              <div><p class="admin-qr-kicker">QR STUDIO · TABLE ORDERS</p><h1>سازنده حرفه‌ای QR میزها</h1><p class="lead">برای هر میز یک QR اختصاصی بسازید؛ مشتری با اسکن آن وارد منوی دیجیتال می‌شود و شماره میز در سفارش از قبل ثبت است.</p></div>
              <div class="admin-qr-page__actions"><button class="btn btn-sm btn-ghost" id="neem-tables-open" type="button">نمای عملیاتی میزها</button><button class="btn btn-sm btn-ghost" id="qr-print-all" type="button" ${tables.length ? '' : 'disabled'}>چاپ همه میزها</button><button class="btn btn-sm" id="t-add" type="button">افزودن میز</button></div>
            </header>
            <div class="admin-qr-notice"><span class="admin-qr-notice__icon" aria-hidden="true">⌁</span><div><strong>جریان سفارش بدون تغییر در بخش‌های دیگر</strong>لینک هر QR شامل شناسه میز و شعبه است؛ مقصد را قبل از چاپ با دکمه «مشاهده» یا اسکن آزمایشی بررسی کنید.</div></div>
            <div class="ops-metrics" aria-label="وضعیت زنده سالن">
              <article class="ops-metric"><strong>${fmtNum(floorData.summary?.total || 0)}</strong><span>کل میزها</span></article>
              <article class="ops-metric is-accent"><strong>${fmtNum(floorData.summary?.busy || 0)}</strong><span>در حال سرویس</span></article>
              <article class="ops-metric"><strong>${fmtNum(floorData.summary?.reservations || 0)}</strong><span>رزرو امروز</span></article>
              <article class="ops-metric ${floorData.summary?.waiterCalls ? 'is-warn' : ''}"><strong>${fmtNum(floorData.summary?.waiterCalls || 0)}</strong><span>فراخوان گارسون</span></article>
            </div>
            <div class="admin-qr-metrics" aria-label="خلاصه میزها">
              <div class="admin-qr-metric"><span class="admin-qr-metric__label">کل میزها</span><strong class="admin-qr-metric__value">${fmtNum(tables.length)}</strong><span class="admin-qr-metric__hint">این شعبه</span></div>
              <div class="admin-qr-metric"><span class="admin-qr-metric__label">میزهای فعال</span><strong class="admin-qr-metric__value">${fmtNum(activeTables().length)}</strong><span class="admin-qr-metric__hint">قابل استفاده برای مهمان</span></div>
              <div class="admin-qr-metric"><span class="admin-qr-metric__label">انتخاب چاپ</span><strong class="admin-qr-metric__value" id="qr-selected-metric">${fmtNum(selectedTableIds.size)}</strong><span class="admin-qr-metric__hint">برای چاپ گروهی</span></div>
              <div class="admin-qr-metric"><span class="admin-qr-metric__label">سطح خوانایی</span><strong class="admin-qr-metric__value" id="qr-ecl-metric">${esc(qrPrefs.ecl)}</strong><span class="admin-qr-metric__hint" id="qr-ecl-hint">اصلاح خطا · ${esc(qrEclHint())}</span></div>
            </div>
            <div class="admin-qr-studio">
              <section class="admin-qr-card"><div class="admin-qr-card__head"><div><h2>پیش‌نمایش زنده</h2><p>ظاهر، لینک و فایل چاپی میز انتخاب‌شده را همین‌جا بررسی کنید.</p></div><span class="admin-qr-safe-badge">آماده چاپ</span></div><div class="admin-qr-card__body">${currentPreview}</div></section>
              <section class="admin-qr-card"><div class="admin-qr-card__head"><div><h2>تنظیمات خروجی</h2><p>تنظیمات در همین مرورگر ذخیره می‌شود و روی سفارش‌ها اثری ندارد.</p></div></div><div class="admin-qr-card__body"><div class="admin-qr-controls">
                <label class="admin-qr-controls__wide"><span>میز برای پیش‌نمایش</span><select id="qr-current-table" ${tables.length ? '' : 'disabled'}>${tableOptions || '<option>میزی وجود ندارد</option>'}</select></label>
                <label class="admin-qr-controls__wide"><span>آدرس عمومی منو</span><input id="qr-base-url" type="url" dir="ltr" value="${esc(qrPrefs.baseUrl)}" placeholder="https://example.com" autocomplete="url" /><small class="admin-qr-base-note">اگر پنل روی localhost است، آدرس قابل‌دسترسی برای موبایل را وارد کنید.</small></label>
                <div class="admin-qr-controls__group"><label><span>رنگ کد</span><input id="qr-dark" type="color" value="${esc(qrPrefs.dark)}" aria-label="رنگ کد QR" /></label><label><span>رنگ پس‌زمینه</span><input id="qr-light" type="color" value="${esc(qrPrefs.light)}" aria-label="رنگ پس‌زمینه QR" /></label></div>
                <div class="admin-qr-controls__group"><label><span>اصلاح خطا</span><select id="qr-ecl"><option value="M" ${qrPrefs.ecl === 'M' ? 'selected' : ''}>M · پیشنهاد وستو</option><option value="Q" ${qrPrefs.ecl === 'Q' ? 'selected' : ''}>Q · مقاوم‌تر برای محیط شلوغ</option><option value="H" ${qrPrefs.ecl === 'H' ? 'selected' : ''}>H · بیشترین تحمل خطا</option><option value="L" ${qrPrefs.ecl === 'L' ? 'selected' : ''}>L · فایل سبک</option></select></label><label><span>ابعاد فایل</span><select id="qr-width"><option value="512" ${qrPrefs.width === 512 ? 'selected' : ''}>۵۱۲ px</option><option value="768" ${qrPrefs.width === 768 ? 'selected' : ''}>۷۶۸ px</option><option value="1024" ${qrPrefs.width === 1024 ? 'selected' : ''}>۱۰۲۴ px</option></select></label></div>
                <label><span>حاشیه سفید استاندارد</span><select id="qr-margin"><option value="3" ${qrPrefs.margin === 3 ? 'selected' : ''}>کم · ۳ ماژول</option><option value="5" ${qrPrefs.margin === 5 ? 'selected' : ''}>استاندارد · ۵ ماژول</option><option value="8" ${qrPrefs.margin === 8 ? 'selected' : ''}>زیاد · چاپ حرفه‌ای</option></select></label>
                <p class="admin-qr-control-note">برای چاپ روی میز، پس‌زمینه روشن، کنتراست بالا و حاشیه استاندارد را نگه دارید.</p>
                <div class="admin-qr-controls__footer"><button type="button" class="btn btn-sm btn-ghost" id="qr-reset-prefs">بازنشانی تنظیمات</button><span class="hint">PNG با QR استاندارد تولید می‌شود</span></div>
              </div></div></section>
            </div>
            <section class="admin-qr-card admin-qr-tables"><div class="admin-qr-card__head"><div><h2>میزهای ${br ? esc(br.name) : ''}</h2><p>هر کارت یک QR مستقل دارد؛ انتخاب چند کارت، چاپ گروهی را فعال می‌کند.</p></div></div>
              <div class="admin-qr-tables__toolbar"><div class="admin-qr-tables__toolbar-left"><label class="admin-qr-select-all"><input id="qr-select-all" type="checkbox" /> انتخاب همه</label><span class="admin-qr-selection-count" id="qr-selection-count">${selectedLabel()}</span></div><div class="admin-qr-tables__toolbar-right"><button class="btn btn-sm btn-ghost" id="qr-print-selected" type="button" disabled>چاپ انتخاب‌شده</button></div></div>
              <div class="admin-qr-table-grid">${tables.map((table) => {
                const id = Number(table.id);
                const selected = selectedTableIds.has(id);
                const currentClass = id === Number(currentTableId) ? ' is-current' : '';
                const selectedClass = selected ? ' is-selected' : '';
                return `<article class="admin-qr-table-card${currentClass}${selectedClass}" data-qr-card="${id}"><div class="admin-qr-table-card__top"><label class="admin-qr-table-card__select"><input type="checkbox" data-qr-select="${id}" ${selected ? 'checked' : ''} /><span>${esc(tableTitle(table))}</span></label><span class="admin-qr-table-card__badge">${table.active !== false ? 'فعال' : 'غیرفعال'}</span></div><div class="admin-qr-table-card__body"><div class="admin-qr-table-card__qr"><img data-qr-img="${id}" loading="lazy" src="${esc(qrAssetUrl(table))}" alt="QR ${esc(tableTitle(table))}" /></div><div class="admin-qr-table-card__fields"><label><span>برچسب</span><input class="t-label" value="${esc(table.label)}" /></label><label><span>ظرفیت</span><input class="t-seats ltr-input" dir="ltr" type="number" min="1" max="20" value="${Number(table.seats) || 4}" /></label><label><span>زون</span><input class="t-zone" value="${esc(table.zone || '')}" /></label><label class="admin-qr-table-card__toggle"><span>قابل سفارش</span><input class="t-active" type="checkbox" ${table.active !== false ? 'checked' : ''} /></label></div></div><div class="admin-qr-table-card__meta"><span>شناسه QR: <b dir="ltr">${esc(table.id)}</b></span><span>میز: <b>${esc(table.zone || 'سالن')}</b></span></div><div class="admin-qr-table-card__actions"><button type="button" class="btn btn-sm btn-ghost" data-qr-open="${id}">انتخاب</button><a class="btn btn-sm btn-ghost" data-qr-download="${id}" href="${esc(qrAssetUrl(table, { download: true }))}" download="westo-table-${id}.png">دانلود</a><button type="button" class="btn btn-sm btn-danger" data-tdel="${id}">حذف</button></div></article>`;
              }).join('') || '<div class="admin-qr-table-empty"><strong>هنوز میزی برای این شعبه ساخته نشده است.</strong>با دکمه «افزودن میز» اولین QR اختصاصی را بسازید.</div>'}</div>
            </section>
          </div>`;

        const refreshSelectionUi = () => {
          const allSelected = tables.length > 0 && tables.every((table) => selectedTableIds.has(Number(table.id)));
          const selectAll = document.getElementById('qr-select-all');
          if (selectAll) {
            selectAll.checked = allSelected;
            selectAll.indeterminate = !allSelected && selectedTableIds.size > 0;
          }
          const count = document.getElementById('qr-selection-count');
          if (count) count.textContent = selectedLabel();
          const metric = document.getElementById('qr-selected-metric');
          if (metric) metric.textContent = fmtNum(selectedTableIds.size);
          const printSelected = document.getElementById('qr-print-selected');
          if (printSelected) printSelected.disabled = selectedTableIds.size === 0;
          main.querySelectorAll('[data-qr-card]').forEach((card) => card.classList.toggle('is-selected', selectedTableIds.has(Number(card.dataset.qrCard))));
        };
        const refreshQrSources = () => {
          main.querySelectorAll('[data-qr-img]').forEach((img) => {
            const table = tableById(img.dataset.qrImg);
            if (table) {
              img.src = qrAssetUrl(table);
              img.alt = `QR ${tableTitle(table)}`;
            }
          });
          const selected = tableById(currentTableId);
          if (!selected) return;
          const preview = document.getElementById('qr-live-preview');
          if (preview) preview.src = qrAssetUrl(selected);
          const destination = document.getElementById('qr-current-destination');
          if (destination) destination.textContent = tableDestination(selected);
          const download = document.getElementById('qr-download-current');
          if (download) {
            download.href = qrAssetUrl(selected, { download: true });
            download.download = `westo-table-${selected.id}.png`;
          }
          const name = document.getElementById('qr-current-name');
          if (name) name.textContent = tableTitle(selected);
          const seats = document.getElementById('qr-current-seats');
          if (seats) seats.textContent = `${fmtNum(selected.seats || 0)} نفر`;
          const zone = document.getElementById('qr-current-zone');
          if (zone) zone.textContent = `${selected.zone || 'سالن'} · مقصد امن و اختصاصی همین میز`;
        };
        const bindQrPrefs = () => {
          const setPref = (key, value) => {
            qrPrefs[key] = value;
            normalizeQrPrefs();
            saveQrPrefs();
            refreshQrSources();
            const eclMetric = document.getElementById('qr-ecl-metric');
            if (eclMetric) eclMetric.textContent = qrPrefs.ecl;
            const eclHint = document.getElementById('qr-ecl-hint');
            if (eclHint) eclHint.textContent = `اصلاح خطا · ${qrEclHint()}`;
          };
          document.getElementById('qr-dark')?.addEventListener('input', (event) => setPref('dark', validHex(event.target.value, defaultQrPrefs.dark)));
          document.getElementById('qr-light')?.addEventListener('input', (event) => setPref('light', validHex(event.target.value, defaultQrPrefs.light)));
          document.getElementById('qr-ecl')?.addEventListener('change', (event) => setPref('ecl', event.target.value));
          document.getElementById('qr-width')?.addEventListener('change', (event) => setPref('width', Number(event.target.value)));
          document.getElementById('qr-margin')?.addEventListener('change', (event) => setPref('margin', Number(event.target.value)));
          document.getElementById('qr-base-url')?.addEventListener('change', (event) => {
            const input = event.target;
            const value = validBaseUrl(input.value);
            if (!value) {
              input.setCustomValidity('یک آدرس عمومی معتبر با http یا https وارد کنید.');
              input.reportValidity();
              return;
            }
            input.setCustomValidity('');
            input.value = value;
            setPref('baseUrl', value);
          });
          document.getElementById('qr-current-table')?.addEventListener('change', (event) => {
            currentTableId = Number(event.target.value) || null;
            render();
          });
          document.getElementById('qr-reset-prefs')?.addEventListener('click', () => {
            qrPrefs = { ...defaultQrPrefs };
            saveQrPrefs();
            render();
            showToast('تنظیمات QR به حالت پیشنهادی بازگشت.', 'success');
          });
        };
        const saveTables = async () => {
          const next = [...main.querySelectorAll('[data-qr-card]')].map((card) => ({
            id: Number(card.dataset.qrCard),
            label: card.querySelector('.t-label')?.value || '',
            seats: Number(card.querySelector('.t-seats')?.value) || 4,
            zone: card.querySelector('.t-zone')?.value || '',
            active: card.querySelector('.t-active')?.checked !== false,
            branchId: currentBranchId,
          }));
          await api('/api/admin/tables', { method: 'PUT', body: JSON.stringify({ tables: next, branchId: currentBranchId }) });
        };
        const tablesAutosave = autosave(saveTables, { debounceMs: 400, silent: true });
        main.querySelectorAll('.t-label, .t-seats, .t-zone, .t-active').forEach((input) => {
          input.addEventListener('input', () => {
            const table = tableById(input.closest('[data-qr-card]')?.dataset.qrCard);
            if (!table) return;
            if (input.classList.contains('t-label')) table.label = input.value;
            if (input.classList.contains('t-seats')) table.seats = Number(input.value) || 4;
            if (input.classList.contains('t-zone')) table.zone = input.value;
            if (input.classList.contains('t-active')) table.active = input.checked;
            if (Number(table.id) === Number(currentTableId)) refreshQrSources();
            tablesAutosave();
          });
          input.addEventListener('change', tablesAutosave);
        });
        main.querySelectorAll('[data-qr-select]').forEach((input) => input.addEventListener('change', () => {
          const id = Number(input.dataset.qrSelect);
          if (input.checked) selectedTableIds.add(id); else selectedTableIds.delete(id);
          refreshSelectionUi();
        }));
        document.getElementById('qr-select-all')?.addEventListener('change', (event) => {
          tables.forEach((table) => event.target.checked ? selectedTableIds.add(Number(table.id)) : selectedTableIds.delete(Number(table.id)));
          main.querySelectorAll('[data-qr-select]').forEach((input) => { input.checked = event.target.checked; });
          refreshSelectionUi();
        });
        main.querySelectorAll('[data-qr-open]').forEach((button) => button.addEventListener('click', () => {
          currentTableId = Number(button.dataset.qrOpen) || null;
          render();
        }));
        document.getElementById('qr-copy-current')?.addEventListener('click', () => {
          const table = tableById(currentTableId);
          if (table) copyText(tableDestination(table));
        });
        document.getElementById('qr-print-current')?.addEventListener('click', () => {
          const table = tableById(currentTableId);
          if (table) printQrTables([table]);
        });
        document.getElementById('qr-print-selected')?.addEventListener('click', () => printQrTables(selectedTables()));
        document.getElementById('qr-print-all')?.addEventListener('click', () => printQrTables(tables));
        document.getElementById('neem-tables-open')?.addEventListener('click', () => openNeemView('tables'));
        document.getElementById('t-add')?.addEventListener('click', async (event) => {
          await runBusy(event.currentTarget, async () => {
            await api('/api/admin/tables', { method: 'POST', body: JSON.stringify({ label: `میز ${(tables.length || 0) + 1}`, seats: 4, zone: 'سالن', branchId: currentBranchId }) });
            await tabs.tables();
          }, 'در حال ساخت…');
        });
        main.querySelectorAll('[data-tdel]').forEach((button) => button.addEventListener('click', async () => {
          if (!confirm('این میز و QR اختصاصی آن حذف شود؟')) return;
          await api(`/api/admin/tables/${button.dataset.tdel}`, { method: 'DELETE' });
          await tabs.tables();
        }));
        bindQrPrefs();
        refreshSelectionUi();
      };
      render();
    },

    async branches() {
      setActiveTab('branches');
      await loadBranches();
      const list = branchesCache;
      main.innerHTML = `
        <h1>شعبه‌ها</h1>
        <p class="lead">مدیریت چندشعبه — هر شعبه آدرس، تلفن، ساعت کاری و میزهای جدا دارد (مشابه سامانه‌های چندفروشگاهی منوی دیجیتال).</p>
        <div class="section-box">
          <h2>افزودن شعبه</h2>
          <div class="grid-2">
            ${field('نام شعبه', 'nb_name', '')}
            ${field('اسلاگ لاتین', 'nb_slug', '', { ltr: true })}
            ${field('آدرس', 'nb_address', '')}
            ${field('تلفن', 'nb_phone', '', { ltr: true })}
          </div>
          <button class="btn btn-sm" id="nb-add">ایجاد شعبه</button>
        </div>
        ${list
          .map(
            (b) => `
          <div class="section-box" data-bid="${b.id}">
            <h2>${esc(b.name)} <span class="hint ltr">#${b.id} · ${esc(b.slug)}</span></h2>
            <div class="grid-2">
              ${field('نام', `b${b.id}_name`, b.name)}
              ${field('اسلاگ', `b${b.id}_slug`, b.slug, { ltr: true })}
              ${field('آدرس', `b${b.id}_address`, b.address || '')}
              ${field('تلفن', `b${b.id}_phone`, b.phone || '', { ltr: true })}
            </div>
            <label class="chk" style="margin:0.75rem 0;display:inline-flex;"><input type="checkbox" id="b${b.id}_active" ${b.active !== false ? 'checked' : ''} /> فعال</label>
            <div class="row-actions">
              <span class="hint">ذخیره خودکار</span>
              <button class="btn btn-sm btn-ghost" data-bswitch="${b.id}">انتخاب در تاپ‌بار</button>
              <button class="btn btn-sm btn-danger" data-bdel="${b.id}" ${list.length <= 1 ? 'disabled' : ''}>حذف</button>
            </div>
          </div>`
          )
          .join('')}`;

      document.getElementById('nb-add').addEventListener('click', async () => {
        const name = document.getElementById('nb_name').value.trim();
        if (!name) return showToast('نام شعبه لازم است');
        await api('/api/admin/branches', {
          method: 'POST',
          body: JSON.stringify({
            name,
            slug: document.getElementById('nb_slug').value.trim() || undefined,
            address: document.getElementById('nb_address').value.trim(),
            phone: document.getElementById('nb_phone').value.trim(),
          }),
        });
        showToast('شعبه ایجاد شد');
        tabs.branches();
      });
      list.forEach((b) => {
        const saveBranch = async () => {
          await api(`/api/admin/branches/${b.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              name: document.getElementById(`b${b.id}_name`).value,
              slug: document.getElementById(`b${b.id}_slug`).value,
              address: document.getElementById(`b${b.id}_address`).value,
              phone: document.getElementById(`b${b.id}_phone`).value,
              active: document.getElementById(`b${b.id}_active`).checked,
            }),
          });
          await loadBranches();
        };
        bindAutosave(main.querySelector(`[data-bid="${b.id}"]`), saveBranch);
      });
      main.querySelectorAll('[data-bswitch]').forEach((btn) =>
        btn.addEventListener('click', () => {
          currentBranchId = Number(btn.dataset.bswitch);
          localStorage.setItem('westo_admin_branch', String(currentBranchId));
          paintBranchSelect();
          showToast('شعبه فعال شد');
        })
      );
      main.querySelectorAll('[data-bdel]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!confirm('حذف شعبه؟ میزها به شعبه دیگر منتقل می‌شوند.')) return;
          await api(`/api/admin/branches/${btn.dataset.bdel}`, { method: 'DELETE' });
          showToast('حذف شد');
          await loadBranches();
          tabs.branches();
        })
      );
    },

    async complements() {
      setActiveTab('complements');
      const data = await api('/api/admin/menu-engineering');
      const categories = data.menuCategories || [];
      const items = data.menuItems || [];
      const complements = data.menuComplements || [];
      const rules = data.menuComplementRules || [];
      const imageSrc = (value) => !value ? '' : (/^https?:\/\//i.test(value) ? value : `/${String(value).replace(/^\//, '')}`);
      const checks = (list, attr, selected = [], label = (entry) => entry.name || entry.title) => {
        const active = new Set((selected || []).map(Number));
        return list.map((entry) => `<label class="me-chip"><input type="checkbox" ${attr}="${entry.id}" ${active.has(Number(entry.id)) ? 'checked' : ''}><span>${esc(label(entry))}</span></label>`).join('');
      };
      const itemChecks = (ruleId, selected = []) => `<label class="me-search"><span>محصول خاص</span><input type="search" data-me-item-search="${ruleId}" placeholder="جست‌وجوی محصول…"></label><div class="me-item-list" data-me-item-list="${ruleId}">${checks(items, 'data-me-item', selected)}</div>`;
      const scopeBlock = (ruleId, rule = {}) => `<div class="me-rule-scope"><section><h4>دسته‌های پایه</h4><div class="me-chip-grid">${checks(categories, 'data-me-category', rule.sourceCategoryIds)}</div></section><details><summary>هدف‌گیری محصول خاص <small>${fmtNum((rule.sourceItemIds || []).length)} انتخاب</small></summary>${itemChecks(ruleId, rule.sourceItemIds)}</details><section><h4>مکمل‌های پیشنهادی</h4><div class="me-chip-grid">${checks(complements, 'data-me-complement', rule.complementIds)}</div></section></div>`;
      const complementCard = (entry) => `<article class="me-complement-card" data-me-complement-card="${entry.id}"><div class="me-complement-preview">${entry.img ? `<img src="${esc(imageSrc(entry.img))}" alt="">` : '<span>بدون تصویر</span>'}<i>${entry.available !== false ? 'فعال در صندوق' : 'غیرفعال'}</i></div><div class="me-complement-fields"><label><span>نام مکمل</span><input data-me-name value="${esc(entry.name)}"></label><label><span>قیمت</span><input data-me-price type="number" min="0" value="${Number(entry.price || 0)}"></label><label><span>موجودی</span><input data-me-stock type="number" min="0" placeholder="نامحدود" value="${entry.stock == null ? '' : Number(entry.stock)}"></label><label><span>تصویر</span><input data-me-image type="text" value="${esc(entry.img || '')}"></label><label class="me-upload"><span>جایگزینی تصویر</span><input data-me-file type="file" accept="image/*"></label><label class="me-switch"><input data-me-available type="checkbox" ${entry.available !== false ? 'checked' : ''}><span>قابل فروش</span></label></div><footer><button class="btn btn-sm" type="button" data-me-save-complement="${entry.id}">ذخیره</button><button class="btn btn-sm btn-ghost" type="button" data-me-delete-complement="${entry.id}">حذف</button></footer></article>`;
      const ruleCard = (rule) => `<article class="me-rule-card" data-me-rule-card="${rule.id}"><header><div><span>قانون ${fmtNum(rule.id)}</span><input data-me-rule-name value="${esc(rule.name)}"></div><label class="me-switch"><input data-me-rule-active type="checkbox" ${rule.active !== false ? 'checked' : ''}><span>فعال</span></label></header><label class="me-prompt"><span>متن پیشنهاد صندوق</span><input data-me-rule-prompt value="${esc(rule.prompt || '')}"></label>${scopeBlock(rule.id, rule)}<footer><button class="btn btn-sm" type="button" data-me-save-rule="${rule.id}">ذخیره قانون</button><button class="btn btn-sm btn-ghost" type="button" data-me-delete-rule="${rule.id}">حذف</button></footer></article>`;

      main.innerHTML = `<div class="ops-page-head"><div><p class="eyebrow">MENU ENGINEERING · POS</p><h1>مکمل‌ها و فروش هوشمند</h1><p class="lead">مکمل‌ها در منوی عمومی دیده نمی‌شوند. بعد از لمس محصول پایه، صندوق آن‌ها را در یک لایه سریع پیشنهاد می‌دهد و انتخاب زیر همان آیتم فاکتور ثبت می‌شود.</p></div><button class="btn btn-sm" id="me-preview-pos">پیش‌نمایش صندوق</button></div><div class="cards cards-dense"><div class="card accent"><div class="num">${fmtNum(complements.filter((entry) => entry.available !== false).length)}</div><div class="lbl">مکمل فعال</div></div><div class="card"><div class="num">${fmtNum(rules.filter((entry) => entry.active !== false).length)}</div><div class="lbl">قانون فعال</div></div><div class="card"><div class="num">${fmtNum(rules.reduce((sum, rule) => sum + (rule.sourceCategoryIds || []).length, 0))}</div><div class="lbl">اتصال دسته‌ای</div></div><div class="card"><div class="num">${fmtNum(rules.reduce((sum, rule) => sum + (rule.sourceItemIds || []).length, 0))}</div><div class="lbl">اتصال محصولی</div></div></div><div class="me-layout"><section class="section-box me-library"><div class="me-section-head"><div><h2>کتابخانه مکمل‌ها</h2><p>اقلام فروش‌محور مثل کوکی یا نوشابه که لازم نیست در منوی مهمان باشند.</p></div><button class="btn btn-sm" id="me-new-toggle">+ مکمل جدید</button></div><form class="me-new-form" id="me-new-complement" hidden><label><span>نام</span><input id="me-new-name" required></label><label><span>قیمت</span><input id="me-new-price" type="number" min="0" required></label><label><span>تصویر</span><input id="me-new-file" type="file" accept="image/*"></label><button class="btn" type="submit">ساخت مکمل</button></form><div class="me-complement-list">${complements.map(complementCard).join('') || '<div class="empty">هنوز مکملی ساخته نشده است.</div>'}</div></section><section class="section-box me-rules"><div class="me-section-head"><div><h2>قوانین پیشنهاد</h2><p>برای هر قانون دسته‌ها یا محصولات پایه و مکمل‌های مرتبط را انتخاب کنید.</p></div><button class="btn btn-sm" id="me-new-rule-toggle">+ قانون جدید</button></div><form class="me-rule-card is-new" id="me-new-rule" hidden><header><div><span>قانون جدید</span><input id="me-new-rule-name" placeholder="مثلاً کنار قهوه"></div><label class="me-switch"><input id="me-new-rule-active" type="checkbox" checked><span>فعال</span></label></header><label class="me-prompt"><span>متن پیشنهاد صندوق</span><input id="me-new-rule-prompt" placeholder="کنار نوشیدنی چه چیزی میل دارید؟"></label>${scopeBlock('new', {})}<footer><button class="btn" type="submit">ساخت قانون</button></footer></form><div class="me-rule-list">${rules.map(ruleCard).join('') || '<div class="empty">قانون پیشنهادی وجود ندارد.</div>'}</div></section></div>`;

      const selectedIds = (root, attr) => [...root.querySelectorAll(`[${attr}]:checked`)].map((input) => Number(input.getAttribute(attr)));
      const uploadFrom = async (input, fallback = '') => {
        const file = input?.files?.[0];
        if (!file) return fallback;
        const body = new FormData(); body.append('file', file);
        const uploaded = await api('/api/admin/upload', { method: 'POST', body });
        return uploaded.path || fallback;
      };
      const bindItemSearches = () => main.querySelectorAll('[data-me-item-search]').forEach((input) => input.addEventListener('input', () => {
        const list = main.querySelector(`[data-me-item-list="${input.dataset.meItemSearch}"]`);
        const query = input.value.trim().toLowerCase();
        list?.querySelectorAll('label').forEach((label) => { label.hidden = !!query && !label.textContent.toLowerCase().includes(query); });
      }));
      bindItemSearches();
      document.getElementById('me-preview-pos').onclick = () => { location.href = '/admin/cashier'; };
      document.getElementById('me-new-toggle').onclick = () => { const form = document.getElementById('me-new-complement'); form.hidden = !form.hidden; if (!form.hidden) document.getElementById('me-new-name').focus(); };
      document.getElementById('me-new-rule-toggle').onclick = () => { const form = document.getElementById('me-new-rule'); form.hidden = !form.hidden; if (!form.hidden) document.getElementById('me-new-rule-name').focus(); };
      document.getElementById('me-new-complement').onsubmit = async (event) => {
        event.preventDefault();
        try {
          const img = await uploadFrom(document.getElementById('me-new-file'));
          await api('/api/admin/menu-complements', { method: 'POST', body: JSON.stringify({ name: document.getElementById('me-new-name').value, price: Number(document.getElementById('me-new-price').value), img, available: true }) });
          showToast('مکمل ساخته شد'); tabs.complements();
        } catch (error) { showToast(error.message); }
      };
      main.querySelectorAll('[data-me-save-complement]').forEach((button) => button.onclick = async () => {
        const card = button.closest('[data-me-complement-card]');
        try {
          await runBusy(button, async () => {
            const img = await uploadFrom(card.querySelector('[data-me-file]'), card.querySelector('[data-me-image]').value.trim());
            await api(`/api/admin/menu-complements/${button.dataset.meSaveComplement}`, { method: 'PUT', body: JSON.stringify({ name: card.querySelector('[data-me-name]').value, price: Number(card.querySelector('[data-me-price]').value), stock: card.querySelector('[data-me-stock]').value, img, available: card.querySelector('[data-me-available]').checked }) });
          });
          showToast('مکمل ذخیره شد'); tabs.complements();
        } catch (error) { showToast(error.message); }
      });
      main.querySelectorAll('[data-me-delete-complement]').forEach((button) => button.onclick = async () => {
        if (!confirm('این مکمل و اتصال‌هایش حذف شود؟')) return;
        try { await api(`/api/admin/menu-complements/${button.dataset.meDeleteComplement}`, { method: 'DELETE' }); showToast('مکمل حذف شد'); tabs.complements(); } catch (error) { showToast(error.message); }
      });
      const rulePayload = (root) => ({ name: root.querySelector('[data-me-rule-name]')?.value || document.getElementById('me-new-rule-name')?.value, prompt: root.querySelector('[data-me-rule-prompt]')?.value || document.getElementById('me-new-rule-prompt')?.value, active: root.querySelector('[data-me-rule-active]')?.checked ?? document.getElementById('me-new-rule-active')?.checked, sourceCategoryIds: selectedIds(root, 'data-me-category'), sourceItemIds: selectedIds(root, 'data-me-item'), complementIds: selectedIds(root, 'data-me-complement') });
      document.getElementById('me-new-rule').onsubmit = async (event) => {
        event.preventDefault();
        try { await api('/api/admin/menu-complement-rules', { method: 'POST', body: JSON.stringify(rulePayload(event.currentTarget)) }); showToast('قانون ساخته شد'); tabs.complements(); } catch (error) { showToast(error.message); }
      };
      main.querySelectorAll('[data-me-save-rule]').forEach((button) => button.onclick = async () => {
        try { await runBusy(button, () => api(`/api/admin/menu-complement-rules/${button.dataset.meSaveRule}`, { method: 'PUT', body: JSON.stringify(rulePayload(button.closest('[data-me-rule-card]'))) })); showToast('قانون ذخیره شد'); tabs.complements(); } catch (error) { showToast(error.message); }
      });
      main.querySelectorAll('[data-me-delete-rule]').forEach((button) => button.onclick = async () => {
        if (!confirm('این قانون پیشنهاد حذف شود؟')) return;
        try { await api(`/api/admin/menu-complement-rules/${button.dataset.meDeleteRule}`, { method: 'DELETE' }); showToast('قانون حذف شد'); tabs.complements(); } catch (error) { showToast(error.message); }
      });
    },

    async costControl() {
      setActiveTab('costControl');
      const d = await api(`/api/admin/v2/catalog${branchQs()}`);
      const cost = d.cost || {};
      const inventory = d.inventory || {};
      main.innerHTML = `
        <div class="ops-page-head">
          <div><p class="eyebrow">COST CONTROL · WESTO</p><h1>کنترل هزینه و سودآوری</h1><p class="lead">فروش، بهای تمام‌شده و وضعیت انبار از داده‌های واقعی WESTO محاسبه می‌شوند؛ داده نمایشی NEEM وارد این صفحه نشده است.</p></div>
          <button class="btn btn-sm" id="cc-open-inventory">مدیریت موجودی</button>
        </div>
        <div class="cards">
          <div class="card accent"><div class="num">${fmtMoney(cost.sales || 0)}</div><div class="lbl">فروش دوره</div></div>
          <div class="card warn"><div class="num">${fmtMoney(cost.estimatedCogs || 0)}</div><div class="lbl">بهای تمام‌شده ثبت‌شده</div></div>
          <div class="card"><div class="num">${fmtMoney(cost.estimatedProfit || 0)}</div><div class="lbl">سود ناخالص</div></div>
          <div class="card"><div class="num">${fmtNum(cost.grossMarginPct || 0)}٪</div><div class="lbl">حاشیه سود</div></div>
          <div class="card ${inventory.low ? 'warn' : ''}"><div class="num">${fmtNum(inventory.low || 0)}</div><div class="lbl">آیتم کم یا تمام‌شده</div></div>
        </div>
        <div class="grid-2-main">
          <section class="section-box">
            <h2>اقلام نیازمند اقدام</h2>
            <table class="tbl"><thead><tr><th>آیتم</th><th>موجودی</th><th>وضعیت</th></tr></thead><tbody>
              ${(inventory.items || []).filter((item) => item.low || item.empty).slice(0, 30).map((item) => `<tr><td>${esc(item.name)}</td><td>${item.tracked ? fmtNum(item.stock) : 'نامحدود'}</td><td>${item.empty ? '<span class="pill blocked">تمام</span>' : '<span class="pill admin-pill-warn">کم</span>'}</td></tr>`).join('') || '<tr><td colspan="3">کمبود موجودی ثبت نشده است.</td></tr>'}
            </tbody></table>
          </section>
          <section class="section-box">
            <h2>دقت محاسبه هزینه</h2>
            <p class="hint">هزینه فقط برای آیتم‌هایی محاسبه می‌شود که دستور تهیه یا هزینه واحد آن‌ها ثبت شده باشد. تا قبل از ثبت مواد اولیه، رقم ساختگی جایگزین نمی‌شود.</p>
            <div class="ops-alert ${cost.estimatedCogs ? '' : 'is-warn'}"><b>${cost.estimatedCogs ? 'محاسبه فعال است' : 'دستور تهیه نیاز است'}</b><span>${cost.estimatedCogs ? 'COGS بر پایه هزینه‌های ثبت‌شده محاسبه شده است.' : 'برای محاسبه دقیق، مواد اولیه و هزینه واحد آیتم‌ها را ثبت کنید.'}</span></div>
          </section>
        </div>`;
      document.getElementById('cc-open-inventory').onclick = () => tabs.inventory().catch((error) => showToast(error.message));
    },

    async inventory() {
      setActiveTab('inventory');
      const d = await api('/api/admin/inventory');
      const rank = (m) => m.empty ? 0 : m.low ? 1 : m.tracked ? 2 : 3;
      const all = (d.items || []).slice().sort((a, b) => rank(a) - rank(b) || String(a.category || '').localeCompare(String(b.category || ''), 'fa') || String(a.name || '').localeCompare(String(b.name || ''), 'fa'));
      main.innerHTML = `
        <div class="ops-page-head">
          <div><p class="eyebrow">کنترل موجودی</p><h1>موجودی انبار</h1><p class="lead">آیتم‌های تمام‌شده و کم‌موجودی اول نمایش داده می‌شوند. تغییر عدد پس از خروج از فیلد ذخیره می‌شود.</p></div>
          <span class="ops-provider-pill">${fmtNum(d.summary?.low || 0)} هشدار کمبود</span>
        </div>
        <div class="cards cards-dense">
          <button class="card admin-stat-button" data-inv-filter="tracked"><div class="num">${fmtNum(d.summary?.tracked || 0)}</div><div class="lbl">تحت ردیابی</div></button>
          <button class="card warn admin-stat-button" data-inv-filter="low"><div class="num">${fmtNum(d.summary?.low || 0)}</div><div class="lbl">موجودی کم</div></button>
          <button class="card admin-stat-button is-danger" data-inv-filter="empty"><div class="num">${fmtNum(d.summary?.empty || 0)}</div><div class="lbl">تمام‌شده</div></button>
          <button class="card admin-stat-button" data-inv-filter="unlimited"><div class="num">${fmtNum(d.summary?.unlimited || 0)}</div><div class="lbl">نامحدود</div></button>
        </div>
        <section class="section-box admin-help-strip" aria-label="راهنمای موجودی"><strong>روال پیشنهادی:</strong><span>اول «تمام‌شده» و «کم» را بررسی کنید؛ سپس شمارش واقعی را وارد کنید. +۱ و +۱۰ برای دریافت سریع کالا هستند.</span></section>
        <div class="section-box">
          <div class="ops-filters admin-filter-row">
            <label><span>جست‌وجو</span><input id="inv-search" type="search" placeholder="نام یا دسته…" /></label>
            <label><span>وضعیت</span><select id="inv-status"><option value="">همه</option><option value="empty">تمام‌شده</option><option value="low">کم</option><option value="tracked">تحت ردیابی</option><option value="unlimited">نامحدود</option></select></label>
            <span class="ops-filter-count" id="inv-count"></span>
          </div>
          <table class="tbl admin-dense-table"><thead><tr><th>نام</th><th>دسته</th><th>موجودی</th><th>آستانه</th><th>وضعیت</th><th>اقدام سریع</th></tr></thead>
          <tbody id="inv-body"></tbody></table>
        </div>`;

      const body = document.getElementById('inv-body');
      const statusKey = (m) => m.empty ? 'empty' : m.low ? 'low' : m.tracked ? 'tracked' : 'unlimited';
      const paint = () => {
        const q = String(document.getElementById('inv-search')?.value || '').trim().toLowerCase();
        const filter = document.getElementById('inv-status')?.value || '';
        const list = all.filter((m) => (!q || `${m.name} ${m.category}`.toLowerCase().includes(q)) && (!filter || statusKey(m) === filter));
        const count = document.getElementById('inv-count');
        if (count) count.textContent = `${fmtNum(list.length)} آیتم`;
        body.innerHTML = list.map((m) => {
          const status = m.empty
            ? '<span class="pill blocked">تمام</span>'
            : m.low
              ? '<span class="pill admin-pill-warn">کم</span>'
              : m.tracked
                ? '<span class="pill ok">موجود</span>'
                : '<span class="pill">نامحدود</span>';
          return `<tr data-iid="${m.id}" data-istatus="${statusKey(m)}">
            <td><strong>${esc(m.name)}</strong></td><td>${esc(m.category)}</td>
            <td><input class="ltr-input inv-stock" aria-label="موجودی ${esc(m.name)}" dir="ltr" type="number" min="0" placeholder="∞" value="${m.tracked ? m.stock : ''}" /></td>
            <td><input class="ltr-input inv-low" aria-label="آستانه ${esc(m.name)}" dir="ltr" type="number" min="0" value="${m.lowStockAt}" /></td>
            <td>${status}${m.available ? '' : ' <span class="pill blocked">ناموجود در منو</span>'}</td>
            <td class="row-actions admin-inline-actions">
              <button class="btn btn-sm btn-ghost" data-idelta="${m.id}" data-delta="1">+۱</button>
              <button class="btn btn-sm btn-ghost" data-idelta="${m.id}" data-delta="10">+۱۰</button>
              <button class="btn btn-sm btn-ghost" data-iunlim="${m.id}">نامحدود</button>
            </td>
          </tr>`;
        }).join('') || '<tr><td colspan="6">آیتمی با این فیلتر پیدا نشد.</td></tr>';

        body.querySelectorAll('tr[data-iid]').forEach((tr) => {
          const id = Number(tr.dataset.iid);
          const saveInv = async () => {
            const raw = tr.querySelector('.inv-stock').value;
            await api('/api/admin/inventory/adjust', {
              method: 'POST', body: JSON.stringify({ id, mode: 'set', stock: raw === '' ? null : Number(raw), lowStockAt: Number(tr.querySelector('.inv-low').value) || 0, restock: raw !== '' && Number(raw) > 0 })
            });
            showToast('موجودی ذخیره شد', 'success', 1400);
          };
          const run = autosave(saveInv, { debounceMs: 350, silent: true });
          tr.querySelector('.inv-stock')?.addEventListener('change', run);
          tr.querySelector('.inv-stock')?.addEventListener('blur', run);
          tr.querySelector('.inv-low')?.addEventListener('change', run);
          tr.querySelector('.inv-low')?.addEventListener('blur', run);
        });
        body.querySelectorAll('[data-idelta]').forEach((b) => b.addEventListener('click', () => runBusy(b, async () => {
          await api('/api/admin/inventory/adjust', { method:'POST', body:JSON.stringify({ id:Number(b.dataset.idelta), delta:Number(b.dataset.delta), restock:true }) });
          await tabs.inventory();
        }, '…').catch((e) => showToast(e.message, 'error'))));
        body.querySelectorAll('[data-iunlim]').forEach((b) => b.addEventListener('click', () => runBusy(b, async () => {
          await api('/api/admin/inventory/adjust', { method:'POST', body:JSON.stringify({ id:Number(b.dataset.iunlim), mode:'unlimited', restock:true }) });
          await tabs.inventory();
        }, '…').catch((e) => showToast(e.message, 'error'))));
      };
      paint();
      document.getElementById('inv-search')?.addEventListener('input', paint);
      document.getElementById('inv-status')?.addEventListener('change', paint);
      main.querySelectorAll('[data-inv-filter]').forEach((b) => b.addEventListener('click', () => { document.getElementById('inv-status').value = b.dataset.invFilter; paint(); }));
    },

    async prices() {
      setActiveTab('prices');
      const d = await api('/api/menu?all=1');
      const cats = d.menuCategories || [];
      const items = d.menuItems || [];
      main.innerHTML = `
        <h1>مدیریت قیمت</h1>
        <p class="lead">ویرایش سریع و انبوه قیمت‌ها — به‌روزرسانی لحظه‌ای مثل پنل‌های منوی دیجیتال حرفه‌ای.</p>
        <div class="section-box">
          <h2>تغییر انبوه</h2>
          <div class="grid-2">
            <div class="field"><label>دسته</label>
              <select id="bp-cat"><option value="">همه دسته‌ها</option>${cats.map((c) => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>نوع تغییر</label>
              <select id="bp-mode">
                <option value="percent">درصد (مثلاً ۱۰ = افزایش ۱۰٪)</option>
                <option value="delta">مقدار ثابت (+/− تومان)</option>
                <option value="set">تنظیم همه به یک قیمت</option>
              </select>
            </div>
            ${field('مقدار', 'bp-val', '10', { ltr: true, type: 'number' })}
          </div>
          <button class="btn btn-sm" id="bp-run">اعمال روی منو</button>
        </div>
        <div class="section-box">
          <h2>ویرایش تکی (${fmtNum(items.length)} آیتم)</h2>
          <div class="field"><input id="price-search" placeholder="جستجوی نام…" /></div>
          <table class="tbl" id="price-tbl"><thead><tr><th>نام</th><th>دسته</th><th>قیمت</th><th>موجود</th></tr></thead>
          <tbody></tbody></table>
        </div>`;

      const catMap = Object.fromEntries(cats.map((c) => [c.id, c.title]));
      const tbody = main.querySelector('#price-tbl tbody');
      const paint = (list) => {
        tbody.innerHTML = list
          .map(
            (m) => `<tr>
              <td>${esc(m.name)}</td>
              <td>${esc(catMap[m.categoryId] || m.categoryId)}</td>
              <td><input class="ltr-input" dir="ltr" data-price="${m.id}" type="number" value="${m.price}" /></td>
              <td>${m.available === false ? '<span class="pill blocked">ناموجود</span>' : '<span class="pill ok">موجود</span>'}</td>
            </tr>`
          )
          .join('') || '<tr><td colspan="4">آیتمی نیست</td></tr>';
        tbody.querySelectorAll('[data-price]').forEach((inp) => {
          const savePrice = async () => {
            await api(`/api/menu/${inp.dataset.price}`, {
              method: 'PUT',
              body: JSON.stringify({ price: Number(inp.value) || 0 }),
            });
          };
          const run = autosave(savePrice, { debounceMs: 400, silent: true });
          inp.addEventListener('change', run);
          inp.addEventListener('blur', run);
        });
      };
      paint(items);
      document.getElementById('price-search').addEventListener('input', (e) => {
        const q = e.target.value.trim();
        paint(items.filter((m) => !q || m.name.includes(q)));
      });
      document.getElementById('bp-run').addEventListener('click', async () => {
        if (!confirm('قیمت‌ها به‌صورت انبوه تغییر کنند؟')) return;
        const cat = document.getElementById('bp-cat').value;
        const d2 = await api('/api/admin/prices/bulk', {
          method: 'POST',
          body: JSON.stringify({
            mode: document.getElementById('bp-mode').value,
            value: Number(document.getElementById('bp-val').value),
            categoryId: cat === '' ? null : Number(cat),
          }),
        });
        showToast(`${d2.updated} آیتم به‌روز شد`);
        tabs.prices();
      });
    },

    async promotions() {
      setActiveTab('promotions');
      const d = await api('/api/admin/promotions');
      main.innerHTML = `
        <h1>تخفیف و پرومو</h1>
        <p class="lead">کد تخفیف و کمپین درصدی برای باشگاه مشتریان و کمپین‌های فروش.</p>
        <div class="section-box">
          <h2>پروموی جدید</h2>
          <div class="grid-2">
            ${field('عنوان', 'pr_title', '')}
            ${field('درصد تخفیف', 'pr_pct', '10', { ltr: true, type: 'number' })}
            ${field('کد (اختیاری)', 'pr_code', '', { ltr: true })}
          </div>
          <button class="btn btn-sm" id="pr-add">ایجاد</button>
        </div>
        <div class="section-box">
          <table class="tbl"><thead><tr><th>عنوان</th><th>٪</th><th>کد</th><th>وضعیت</th><th></th></tr></thead><tbody>
            ${(d.promotions || [])
              .map(
                (p) => `<tr>
                  <td>${esc(p.title)}</td>
                  <td>${p.percent}٪</td>
                  <td class="ltr">${esc(p.code || '—')}</td>
                  <td>${p.active ? '<span class="pill ok">فعال</span>' : '<span class="pill">غیرفعال</span>'}</td>
                  <td class="row-actions">
                    <button class="btn btn-sm btn-ghost" data-ptoggle="${p.id}" data-val="${!p.active}">${p.active ? 'غیرفعال' : 'فعال'}</button>
                    <button class="btn btn-sm btn-danger" data-pdel="${p.id}">حذف</button>
                  </td>
                </tr>`
              )
              .join('') || '<tr><td colspan="5">پرومویی نیست</td></tr>'}
          </tbody></table>
        </div>`;
      document.getElementById('pr-add').addEventListener('click', async () => {
        const title = document.getElementById('pr_title').value.trim();
        if (!title) return showToast('عنوان را وارد کنید');
        await api('/api/admin/promotions', {
          method: 'POST',
          body: JSON.stringify({
            title,
            percent: Number(document.getElementById('pr_pct').value) || 0,
            code: document.getElementById('pr_code').value,
          }),
        });
        showToast('پرومو ایجاد شد');
        tabs.promotions();
      });
      main.querySelectorAll('[data-ptoggle]').forEach((b) =>
        b.addEventListener('click', async () => {
          await api(`/api/admin/promotions/${b.dataset.ptoggle}`, {
            method: 'PATCH',
            body: JSON.stringify({ active: b.dataset.val === 'true' }),
          });
          tabs.promotions();
        })
      );
      main.querySelectorAll('[data-pdel]').forEach((b) =>
        b.addEventListener('click', async () => {
          if (!confirm('حذف شود؟')) return;
          await api(`/api/admin/promotions/${b.dataset.pdel}`, { method: 'DELETE' });
          tabs.promotions();
        })
      );
    },

    async promoSlides() {
      setActiveTab('promoSlides');
      const d = await api('/api/admin/promo-slides');
      const slides = (d.slides || []).slice().sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
      const branches = (d.branches || []).filter((b) => b && b.active !== false);
      const dtLocal = (value) => value ? String(value).slice(0, 16) : '';
      const option = (value, label, selected) => `<option value="${esc(value)}" ${String(selected) === String(value) ? 'selected' : ''}>${esc(label)}</option>`;
      const kindOptions = [
        ['general', 'عمومی'], ['instagram', 'اینستاگرام'], ['chef-special', 'ویژه سرآشپز'],
        ['event', 'رویداد'], ['offer', 'پیشنهاد ویژه'], ['announcement', 'اطلاعیه'],
      ];
      const actionOptions = [
        ['none', 'بدون اکشن'], ['url', 'لینک خارجی'], ['instagram', 'اینستاگرام'],
        ['internal', 'صفحه داخلی'], ['category', 'دسته منو'], ['dish', 'غذا'],
      ];
      const placementOptions = [
        ['entrance', 'صفحه ورود — داخل بخش تجربه'],
      ];
      const slideCard = (slide) => {
        const ctr = Number(slide.impressions) > 0 ? ((Number(slide.clicks) || 0) * 100 / Number(slide.impressions)).toFixed(1) : '0.0';
        const live = slide.enabled !== false && slide.status !== 'draft';
        const stateLabel = live ? 'روی سایت' : (slide.status === 'draft' ? 'پیش‌نویس' : 'غیرفعال');
        return `<article class="section-box promo-slide-admin" draggable="true" data-promo-card="${slide.id}" data-promo-live="${live ? 'true' : 'false'}">
          <div class="row-actions" style="justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap">
            <div class="row-actions" style="margin:0"><strong>اسلاید #${slide.id}</strong><span class="promo-slide-admin__state ${live ? 'is-live' : 'is-draft'}">${stateLabel}</span></div>
            <span class="hint">نمایش ${Number(slide.impressions)||0} · کلیک ${Number(slide.clicks)||0} · CTR ${ctr}٪</span>
          </div>
          <div class="promo-placement-note"><b>جایگاه نمایش:</b><span>صفحه ورود — داخل بخش تجربه</span><span>·</span><span>با مدل Free-Throw Card Deck داخل کارت ورودی و قبل از دسترسی‌های سریع نمایش داده می‌شود.</span></div>
          <div class="grid-2">
            ${field('عنوان', `ps_title_${slide.id}`, slide.title || '')}
            ${field('زیرعنوان', `ps_subtitle_${slide.id}`, slide.subtitle || '')}
            ${field('Badge', `ps_badge_${slide.id}`, slide.badge || '')}
            ${field('متن دکمه CTA', `ps_cta_${slide.id}`, slide.ctaLabel || '')}
            <div class="field"><label>نوع اسلاید</label><select id="ps_kind_${slide.id}">${kindOptions.map(([v,l]) => option(v,l,slide.kind)).join('')}</select></div>
            <div class="field"><label>جایگاه نمایش</label><select id="ps_placement_${slide.id}">${placementOptions.map(([v,l]) => option(v,l,'entrance')).join('')}</select></div>
            <div class="field"><label>نوع اکشن</label><select id="ps_action_${slide.id}">${actionOptions.map(([v,l]) => option(v,l,slide.actionType)).join('')}</select></div>
            ${field('مقدار اکشن (URL یا ID)', `ps_value_${slide.id}`, slide.actionValue || '', { ltr: true })}
            ${field('تصویر', `ps_image_${slide.id}`, slide.image || '', { ltr: true })}
            <div class="field"><label>آپلود تصویر</label><input type="file" id="ps_file_${slide.id}" accept=".png,.jpg,.jpeg,.webp,.avif" /></div>
            <div class="field"><label>شعبه</label><select id="ps_branch_${slide.id}"><option value="">همه شعب</option>${branches.map((b)=>option(b.id,b.name,slide.branchId)).join('')}</select></div>
            ${field('شروع نمایش', `ps_start_${slide.id}`, dtLocal(slide.startAt), { type: 'datetime-local', ltr: true })}
            ${field('پایان نمایش', `ps_end_${slide.id}`, dtLocal(slide.endAt), { type: 'datetime-local', ltr: true })}
            ${field('اتوپلی (ms، صفر=خاموش)', `ps_auto_${slide.id}`, Number(slide.autoplayMs)||0, { type: 'number', ltr: true })}
            <div class="field"><label>وضعیت انتشار</label><select id="ps_status_${slide.id}">${option('published','منتشرشده',slide.status)}${option('draft','پیش‌نویس',slide.status)}</select></div>
          </div>
          ${slide.image ? `<div class="logo-preview" style="margin:.65rem 0"><img src="${esc(adminImgSrc(slide.image))}" alt="" style="max-height:150px;object-fit:cover;border-radius:14px" /></div>` : ''}
          <div class="row-actions" style="margin-top:.55rem;gap:1rem;flex-wrap:wrap"><label class="check-row"><input type="checkbox" id="ps_enabled_${slide.id}" ${slide.enabled !== false ? 'checked' : ''} /> فعال</label><label class="check-row"><input type="checkbox" id="ps_share_${slide.id}" ${slide.shareEnabled !== false ? 'checked' : ''} /> دکمه اشتراک‌گذاری</label></div>
          <div class="row-actions" style="margin-top:.75rem">
            <button class="btn btn-sm" data-promo-save="${slide.id}">ذخیره تغییرات</button>
            <button class="btn btn-sm ${live ? 'btn-ghost' : ''}" data-promo-visibility="${slide.id}" data-live="${live ? 'true' : 'false'}">${live ? 'برداشتن از سایت' : 'انتشار روی سایت'}</button>
            <button class="btn btn-sm btn-ghost" data-promo-upload="${slide.id}">آپلود تصویر</button>
            <button class="btn btn-sm btn-ghost" data-promo-copy="${slide.id}">کپی</button>
            <button class="btn btn-sm btn-danger" data-promo-delete="${slide.id}">حذف</button>
            <span class="hint">برای تغییر ترتیب کارت را بکشید.</span>
          </div>
        </article>`;
      };

      main.innerHTML = `
        <div class="ops-page-head"><div><p class="eyebrow">محتوای تبلیغاتی WESTO</p><h1>اسلایدر تبلیغاتی</h1><p class="lead">اسلایدر Free-Throw صفحه ورود؛ داخل بخش تجربه. تصویر، اکشن، Share، زمان‌بندی، شعبه و ترتیب را از همین‌جا مدیریت کنید.</p></div></div>
        <div class="cards cards-dense"><div class="card accent"><div class="num">${fmtNum(slides.filter((slide) => slide.enabled !== false && slide.status !== 'draft').length)}</div><div class="lbl">در حال نمایش</div></div><div class="card"><div class="num">${fmtNum(slides.filter((slide) => slide.status === 'draft').length)}</div><div class="lbl">پیش‌نویس</div></div><div class="card"><div class="num">${fmtNum(slides.length)}</div><div class="lbl">کل اسلایدها</div></div></div>
        <div class="section-box">
          <div class="row-actions"><button class="btn" id="promo-slide-add">+ اسلاید جدید</button><a class="btn btn-ghost" href="/" target="_blank" rel="noopener">پیش‌نمایش صفحه ورود</a></div>
          <p class="hint">برای نمایش روی سایت، اسلاید باید هم «منتشرشده» و هم «فعال» باشد. تصویر یا عنوان را وارد کنید؛ اکشن «دسته» و «غذا» از ID منوی فعلی استفاده می‌کند.</p>
        </div>
        <div id="promo-slides-list">${slides.map(slideCard).join('') || '<div class="section-box"><p class="hint">هنوز اسلایدی ساخته نشده است.</p></div>'}</div>`;

      const readSlide = (id) => ({
        title: document.getElementById(`ps_title_${id}`)?.value.trim() || '',
        subtitle: document.getElementById(`ps_subtitle_${id}`)?.value.trim() || '',
        badge: document.getElementById(`ps_badge_${id}`)?.value.trim() || '',
        ctaLabel: document.getElementById(`ps_cta_${id}`)?.value.trim() || '',
        kind: document.getElementById(`ps_kind_${id}`)?.value || 'general',
        placement: 'entrance',
        shareEnabled: Boolean(document.getElementById(`ps_share_${id}`)?.checked),
        actionType: document.getElementById(`ps_action_${id}`)?.value || 'none',
        actionValue: document.getElementById(`ps_value_${id}`)?.value.trim() || '',
        image: document.getElementById(`ps_image_${id}`)?.value.trim() || '',
        branchId: document.getElementById(`ps_branch_${id}`)?.value || null,
        startAt: window.ShamsiDatePicker?.getISOValue(document.getElementById(`ps_start_${id}`)) || document.getElementById(`ps_start_${id}`)?.dataset.isoDateTime || document.getElementById(`ps_start_${id}`)?.value || null,
        endAt: window.ShamsiDatePicker?.getISOValue(document.getElementById(`ps_end_${id}`)) || document.getElementById(`ps_end_${id}`)?.dataset.isoDateTime || document.getElementById(`ps_end_${id}`)?.value || null,
        autoplayMs: Math.max(0, Number(document.getElementById(`ps_auto_${id}`)?.value) || 0),
        status: document.getElementById(`ps_status_${id}`)?.value || 'published',
        enabled: Boolean(document.getElementById(`ps_enabled_${id}`)?.checked),
      });

      const validateSlide = (payload, { forPublish = false } = {}) => {
        if (payload.startAt && payload.endAt && new Date(payload.startAt).getTime() >= new Date(payload.endAt).getTime()) return 'زمان پایان باید بعد از زمان شروع باشد.';
        if ((forPublish || (payload.enabled && payload.status === 'published')) && !payload.title && !payload.image) return 'برای انتشار، حداقل عنوان یا تصویر وارد کنید.';
        if ((forPublish || (payload.enabled && payload.status === 'published')) && payload.placement === 'entrance' && !payload.image) return 'اسلاید صفحه ورود باید تصویر داشته باشد.';
        if (['url','instagram'].includes(payload.actionType) && payload.actionValue && !/^https?:\/\//i.test(payload.actionValue)) return 'برای لینک خارجی/اینستاگرام، آدرس کامل با http یا https وارد کنید.';
        if (['category','dish'].includes(payload.actionType) && payload.actionValue && !/^\d+$/.test(payload.actionValue)) return 'برای اکشن دسته یا غذا، ID عددی معتبر وارد کنید.';
        return '';
      };

      document.getElementById('promo-slide-add')?.addEventListener('click', async () => {
        await api('/api/admin/promo-slides', { method: 'POST', body: JSON.stringify({ title: 'اسلاید جدید', placement: 'entrance', shareEnabled: true, status: 'draft', enabled: false }) });
        tabs.promoSlides();
      });
      main.querySelectorAll('[data-promo-save]').forEach((btn) => btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.promoSave);
        const payload = readSlide(id); const invalid = validateSlide(payload);
        if (invalid) return showToast(invalid, 'error', 3600);
        await api(`/api/admin/promo-slides/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        showToast('اسلاید ذخیره شد', 'success');
        tabs.promoSlides();
      }));
      main.querySelectorAll('[data-promo-visibility]').forEach((btn) => btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.promoVisibility); const currentlyLive = btn.dataset.live === 'true';
        const payload = readSlide(id);
        if (!currentlyLive) {
          payload.status = 'published'; payload.enabled = true;
          const invalid = validateSlide(payload, { forPublish: true });
          if (invalid) return showToast(invalid, 'error', 3600);
        } else { payload.enabled = false; }
        await api(`/api/admin/promo-slides/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        showToast(currentlyLive ? 'اسلاید از سایت برداشته شد' : 'اسلاید منتشر شد', 'success');
        tabs.promoSlides();
      }));
      main.querySelectorAll('[data-promo-upload]').forEach((btn) => btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.promoUpload);
        const file = document.getElementById(`ps_file_${id}`)?.files?.[0];
        if (!file) return showToast('اول یک تصویر انتخاب کنید');
        const fd = new FormData(); fd.append('file', file);
        const up = await api('/api/admin/upload', { method: 'POST', body: fd });
        document.getElementById(`ps_image_${id}`).value = up.path || '';
        await api(`/api/admin/promo-slides/${id}`, { method: 'PATCH', body: JSON.stringify(readSlide(id)) });
        showToast('تصویر آپلود و ذخیره شد');
        tabs.promoSlides();
      }));
      main.querySelectorAll('[data-promo-delete]').forEach((btn) => btn.addEventListener('click', async () => {
        if (!confirm('این اسلاید حذف شود؟')) return;
        await api(`/api/admin/promo-slides/${btn.dataset.promoDelete}`, { method: 'DELETE' });
        tabs.promoSlides();
      }));
      main.querySelectorAll('[data-promo-copy]').forEach((btn) => btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.promoCopy); const payload = readSlide(id);
        payload.title = `${payload.title || 'اسلاید'} — کپی`; payload.status = 'draft'; payload.enabled = false;
        await api('/api/admin/promo-slides', { method: 'POST', body: JSON.stringify(payload) });
        tabs.promoSlides();
      }));

      const list = document.getElementById('promo-slides-list');
      let dragging = null;
      list?.querySelectorAll('[data-promo-card]').forEach((card) => {
        card.addEventListener('dragstart', () => { dragging = card; card.style.opacity = '.55'; });
        card.addEventListener('dragend', async () => {
          card.style.opacity = ''; dragging = null;
          const ids = [...list.querySelectorAll('[data-promo-card]')].map((el) => Number(el.dataset.promoCard));
          if (ids.length) {
            await api('/api/admin/promo-slides/reorder', { method: 'POST', body: JSON.stringify({ ids }) });
            showToast('ترتیب ذخیره شد');
          }
        });
        card.addEventListener('dragover', (event) => {
          event.preventDefault();
          if (!dragging || dragging === card) return;
          const rect = card.getBoundingClientRect();
          list.insertBefore(dragging, event.clientY < rect.top + rect.height / 2 ? card : card.nextSibling);
        });
      });
    },

    async content() {
      setActiveTab('content');
      const groups = [
        { title: 'نوبار و منو', keys: ['nav.login', 'nav.menu', 'nav.contact', 'nav.sound_on', 'nav.sound_off', 'nav.link.gamme', 'nav.link.benefits', 'nav.link.faq', 'nav.link.newsletter', 'nav.copyright'] },
        { title: 'صفحه ورود — متن‌ها', keys: ['entrance.tagline', 'entrance.subtitle', 'entrance.storyLead', 'entrance.quote', 'entrance.cta', 'entrance.step.digitalMenu', 'entrance.step.onlineOrder', 'entrance.step.reserveTable', 'entrance.step.quickEntry'] },
        { title: 'هیرو', keys: ['hero.scroll_hint'] },
        { title: 'سکشن مواد — شکر', keys: ['ingredients.sugar.badge', 'ingredients.sugar.title1', 'ingredients.sugar.title2', 'ingredients.sugar.desc'] },
        { title: 'سکشن مواد — طعم‌دهنده', keys: ['ingredients.aroma.badge', 'ingredients.aroma.title1', 'ingredients.aroma.title2', 'ingredients.aroma.desc'] },
        { title: 'سکشن مواد — کافئین', keys: ['ingredients.caffeine.badge', 'ingredients.caffeine.title', 'ingredients.caffeine.desc'] },
        { title: 'سکشن مواد — استویا', keys: ['ingredients.stevia.badge', 'ingredients.stevia.title', 'ingredients.stevia.desc'] },
        { title: 'سؤالات متداول (عنوان)', keys: ['faq.title1', 'faq.title2'] },
        { title: 'خبرنامه', keys: ['newsletter.title', 'newsletter.desc', 'newsletter.email_label', 'newsletter.submit', 'newsletter.consent', 'newsletter.privacy_link', 'newsletter.success', 'newsletter.error'] },
        { title: 'فوتر', keys: ['footer.copyright', 'footer.legal', 'footer.cgu', 'footer.privacy', 'footer.tiktok', 'footer.instagram'] },
      ];
      const labels = {
        'nav.login': 'دکمه ورود', 'nav.menu': 'دکمه منو', 'nav.contact': 'دکمه تماس', 'nav.sound_on': 'صدا: روشن', 'nav.sound_off': 'صدا: خاموش',
        'nav.link.gamme': 'لینک محصولات', 'nav.link.benefits': 'لینک مزایا', 'nav.link.faq': 'لینک سؤالات', 'nav.link.newsletter': 'لینک خبرنامه', 'nav.copyright': 'کپی‌رایت منو',
        'hero.scroll_hint': 'راهنمای اسکرول',
        'entrance.tagline': 'تگ‌لاین زیر لوگو', 'entrance.subtitle': 'زیرعنوان انگلیسی', 'entrance.storyLead': 'متن آماده‌سازی', 'entrance.quote': 'جمله کوتاه', 'entrance.cta': 'متن دکمه ورود',
        'entrance.step.digitalMenu': 'مرحله ۱', 'entrance.step.onlineOrder': 'مرحله ۲', 'entrance.step.reserveTable': 'مرحله ۳', 'entrance.step.quickEntry': 'مرحله ۴',
      };
      main.innerHTML = `
        <h1>محتوای سایت</h1>
        ${groups
          .map(
            (g) => `
          <div class="section-box">
            <h2>${esc(g.title)}</h2>
            <div class="grid-2">
              ${g.keys.map((k) => field(labels[k] || k, `c__${k}`, state.content[k] || '', { textarea: (state.content[k] || '').length > 60 })).join('')}
            </div>
          </div>`
          )
          .join('')}
        <p class="hint" style="margin:0.5rem 0 1rem">ذخیره خودکار هر فیلد</p>`;

      const saveContentField = async (el) => {
        const key = el.id.slice(3);
        const updates = { [key]: el.value };
        await api('/api/content', { method: 'PUT', body: JSON.stringify({ content: updates }) });
        Object.assign(state.content, updates);
      };
      main.querySelectorAll('[id^="c__"]').forEach((el) => {
        const run = autosave(() => saveContentField(el), { debounceMs: 400, silent: true });
        el.addEventListener('input', run);
        el.addEventListener('change', run);
      });
    },

    async media() {
      setActiveTab('media');
      const up = await api('/api/admin/uploads');
      main.innerHTML = `
        <h1>لوگو و رسانه</h1>
        <div class="section-box">
          <h2>لوگوی سفید <small>(نوبار و فوتر)</small></h2>
          <div class="grid-2">
            <div class="logo-preview"><img src="${esc(state.content['logo.white'])}" /></div>
            <div>
              <div class="field"><label>آپلود فایل جدید (SVG/PNG)</label><input type="file" id="file-white" accept=".svg,.png,.jpg,.webp,.avif" /></div>
              <button class="btn btn-sm" data-logo="logo.white" data-file="file-white">آپلود و جایگزینی</button>
            </div>
          </div>
        </div>
        <div class="section-box">
          <h2>لوگوی مشکی</h2>
          <div class="grid-2">
            <div class="logo-preview" style="background: repeating-conic-gradient(#ddd 0% 25%, #bbb 0% 50%) 0 / 24px 24px;"><img src="${esc(state.content['logo.black'])}" /></div>
            <div>
              <div class="field"><label>آپلود فایل جدید (SVG/PNG)</label><input type="file" id="file-black" accept=".svg,.png,.jpg,.webp,.avif" /></div>
              <button class="btn btn-sm" data-logo="logo.black" data-file="file-black">آپلود و جایگزینی</button>
            </div>
          </div>
        </div>
        <div class="section-box">
          <h2>لوگوی نشانه صفحه ورود</h2>
          <div class="grid-2">
            <div class="logo-preview" style="background:#061014"><img src="${esc(adminImgSrc(state.content['entrance.logo'] || 'assets/images/brand/westo-mark.png?v=brandCyan2'))}" /></div>
            <div><div class="field"><label>PNG / SVG / WebP</label><input type="file" id="file-entrance-logo" accept=".svg,.png,.jpg,.webp,.avif" /></div><button class="btn btn-sm" data-logo="entrance.logo" data-file="file-entrance-logo">آپلود لوگوی ورود</button></div>
          </div>
        </div>
        <div class="section-box">
          <h2>لوگوتایپ صفحه ورود — تم تیره</h2>
          <div class="grid-2">
            <div class="logo-preview" style="background:#061014"><img src="${esc(adminImgSrc(state.content['entrance.wordmark.dark'] || 'assets/images/brand/westo-fa-wordmark.png?v=brandLight1'))}" /></div>
            <div><div class="field"><label>لوگوتایپ روشن روی تم تیره</label><input type="file" id="file-entrance-wordmark-dark" accept=".svg,.png,.jpg,.webp,.avif" /></div><button class="btn btn-sm" data-logo="entrance.wordmark.dark" data-file="file-entrance-wordmark-dark">آپلود لوگوتایپ تیره</button></div>
          </div>
        </div>
        <div class="section-box">
          <h2>لوگوتایپ صفحه ورود — تم روشن</h2>
          <div class="grid-2">
            <div class="logo-preview" style="background:#f6f4ef"><img src="${esc(adminImgSrc(state.content['entrance.wordmark.light'] || 'assets/images/brand/westo-fa-wordmark-dark.png?v=brandDark1'))}" /></div>
            <div><div class="field"><label>لوگوتایپ تیره روی تم روشن</label><input type="file" id="file-entrance-wordmark-light" accept=".svg,.png,.jpg,.webp,.avif" /></div><button class="btn btn-sm" data-logo="entrance.wordmark.light" data-file="file-entrance-wordmark-light">آپلود لوگوتایپ روشن</button></div>
          </div>
        </div>
        <div class="section-box">
          <h2>پترن صفحه ورود</h2>
          <p class="hint">این تصویر فقط در صفحه ورود WESTO استفاده می‌شود و ساختار لوگو را تغییر نمی‌دهد. PNG/WebP با پس‌زمینه شفاف بهترین نتیجه را می‌دهد.</p>
          <div class="grid-2">
            <div class="logo-preview" style="background:#061014;min-height:180px;overflow:hidden;"><img src="${esc(adminImgSrc(state.content['entrance.pattern'] || 'assets/images/entrance/westo-pattern.webp'))}" style="width:100%;height:180px;object-fit:contain;" alt="پیش‌نمایش پترن صفحه ورود" /></div>
            <div>
              <div class="field"><label>آپلود پترن جدید</label><input type="file" id="file-entrance-pattern" accept=".png,.jpg,.jpeg,.webp,.avif,.gif" /></div>
              <div class="row-actions"><button class="btn btn-sm" data-pattern="entrance.pattern" data-file="file-entrance-pattern">آپلود و جایگزینی پترن ورود</button><button class="btn btn-sm btn-ghost" type="button" data-pattern-reset>بازگشت به پترن پیش‌فرض</button></div>
              <p class="hint">پس از ذخیره، در بارگذاری بعدی صفحه اول اعمال می‌شود.</p>
            </div>
          </div>
        </div>
        <div class="section-box">
          <h2>فایل‌های آپلودشده</h2>
          <table class="tbl"><thead><tr><th>مسیر</th><th>حجم</th></tr></thead><tbody>
            ${up.files.map((f) => `<tr><td class="ltr"><a href="/${esc(f.path)}" target="_blank">${esc(f.path)}</a></td><td>${(f.size / 1024).toFixed(1)} KB</td></tr>`).join('') || '<tr><td colspan="2">فایلی آپلود نشده است</td></tr>'}
          </tbody></table>
        </div>`;

      main.querySelectorAll('button[data-logo]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const input = document.getElementById(btn.dataset.file);
          if (!input.files[0]) return showToast('اول یک فایل انتخاب کنید');
          const fd = new FormData();
          fd.append('file', input.files[0]);
          const d = await api('/api/admin/upload', { method: 'POST', body: fd });
          await api('/api/content', { method: 'PUT', body: JSON.stringify({ content: { [btn.dataset.logo]: d.path } }) });
          state.content[btn.dataset.logo] = d.path;
          showToast('رسانه جایگزین شد');
          tabs.media();
        });
      });

      main.querySelectorAll('button[data-pattern]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const input = document.getElementById(btn.dataset.file);
          if (!input?.files?.[0]) return showToast('اول یک فایل پترن انتخاب کنید');
          const fd = new FormData();
          fd.append('file', input.files[0]);
          const d = await api('/api/admin/upload', { method: 'POST', body: fd });
          const key = btn.dataset.pattern;
          await api('/api/content', { method: 'PUT', body: JSON.stringify({ content: { [key]: d.path } }) });
          state.content[key] = d.path;
          showToast('پترن صفحه ورود جایگزین شد');
          tabs.media();
        });
      });

      main.querySelector('[data-pattern-reset]')?.addEventListener('click', async () => {
        const path = 'assets/images/entrance/westo-pattern.webp';
        await api('/api/content', { method: 'PUT', body: JSON.stringify({ content: { 'entrance.pattern': path } }) });
        state.content['entrance.pattern'] = path;
        showToast('پترن پیش‌فرض صفحه ورود بازیابی شد');
        tabs.media();
      });
    },

    async products() {
      setActiveTab('products');
      const d = await api('/api/menu?all=1');
      let catList = (d.menuCategories || []).slice();
      const allItems = d.menuItems || [];
      let counts = itemCountsByCat(allItems);
      let totals = itemTotalByCat(allItems);

      const siteCats = () => catList.filter((c) => isOnCarousel(c, counts[c.id] || 0));

      const persistOrder = async (list) => {
        const r = await api('/api/menu/categories/order', {
          method: 'PUT',
          body: JSON.stringify({ order: list.map((c) => c.id) }),
        });
        catList = r.menuCategories || list;
        if (r.products) state.products = r.products;
        return r;
      };

      const paint = () => {
        counts = itemCountsByCat(allItems);
        totals = itemTotalByCat(allItems);
        const onSite = siteCats();
        const listEl = document.getElementById('cat-studio-list');
        const summaryEl = document.getElementById('cat-studio-summary');
        if (summaryEl) {
          summaryEl.textContent = `${fmtNum(onSite.length)} دسته روی کاروسل صفحه اصلی`;
        }
        if (!listEl) return;

        listEl.innerHTML =
          catList
            .map((c, idx) => {
              const n = counts[c.id] || 0;
              const total = totals[c.id] || 0;
              const covered = hasValidCover(c);
              const onCarousel = isOnCarousel(c, n);
              const slot = onCarousel ? onSite.findIndex((x) => x.id === c.id) + 1 : null;
              const countHint =
                total > n
                  ? `${fmtNum(n)} موجود از ${fmtNum(total)}`
                  : `${fmtNum(n)} غذای موجود`;
              return `
          <div class="menu-studio__cat-card" data-cid="${c.id}">
            <div class="menu-studio__cat-row">
              <span class="hint" style="min-width:2.5rem">${slot != null ? `#${fmtNum(slot)}` : '—'}</span>
              <input type="text" value="${esc(c.title)}" data-cat-title="${c.id}" aria-label="عنوان دسته" />
              <button type="button" class="btn btn-sm btn-ghost" data-cat-up="${c.id}" ${idx === 0 ? 'disabled' : ''} title="بالا">↑</button>
              <button type="button" class="btn btn-sm btn-ghost" data-cat-down="${c.id}" ${idx === catList.length - 1 ? 'disabled' : ''} title="پایین">↓</button>
              <button type="button" class="btn btn-sm btn-ghost" data-cat-menu="${c.id}" title="غذاهای این دسته">غذاها</button>
              <button type="button" class="btn btn-sm btn-danger" data-cat-del="${c.id}">حذف</button>
            </div>
            <div class="menu-studio__cat-cover" style="margin-top:0.55rem;display:flex;gap:0.75rem;align-items:flex-start">
              <div class="menu-studio__drop${covered ? ' has-img' : ''}" data-cat-drop="${c.id}" style="width:7.5rem;height:7.5rem;flex-shrink:0;cursor:pointer">
                ${
                  covered
                    ? `<img src="${esc(adminImgSrc(c.coverImg))}" alt="" />`
                    : `<div class="menu-studio__drop-hint">کاور هیرو<br/><small>الزامی برای کاروسل</small></div>`
                }
              </div>
              <div style="flex:1;min-width:0">
                <input type="file" accept=".jpg,.jpeg,.png,.webp,.avif" hidden data-cat-file="${c.id}" />
                <div class="row-actions" style="flex-wrap:wrap;gap:0.35rem">
                  <button type="button" class="btn btn-sm" data-cat-cover-pick="${c.id}">آپلود کاور</button>
                  <button type="button" class="btn btn-sm btn-ghost" data-cat-cover-clear="${c.id}" ${covered ? '' : 'disabled'}>پاک کردن</button>
                </div>
                <p class="hint" style="margin:0.4rem 0 0">${siteStatusPill(c, n)} · ${countHint}</p>
                <p class="hint" style="margin:0.35rem 0 0">کاور باید عکس غذا/نوشیدنی روی پس‌زمینه مشکی باشد — نه پکیج یا محصول تصادفی.</p>
              </div>
            </div>
            <div class="field" style="margin:0.45rem 0 0"><label>توضیح کوتاه کاروسل</label>
              <textarea rows="2" data-cat-short="${c.id}">${esc(c.shortDesc || '')}</textarea></div>
            <div class="field" style="margin:0.45rem 0 0"><label>توضیح بلند</label>
              <textarea rows="2" data-cat-long="${c.id}">${esc(c.longDesc || '')}</textarea></div>
            <div class="menu-studio__cat-row" style="margin-top:0.45rem;justify-content:space-between">
              <label class="chip" style="cursor:pointer">
                <input type="checkbox" data-cat-hide="${c.id}" ${c.hiddenOnSite ? 'checked' : ''} />
                مخفی از صفحه اصلی
              </label>
              <span class="hint">ذخیره خودکار</span>
            </div>
          </div>`;
            })
            .join('') || '<p class="hint">دسته‌ای نیست — یکی اضافه کنید.</p>';

        const moveCat = async (id, dir) => {
          const i = catList.findIndex((c) => c.id === id);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= catList.length) return;
          const next = catList.slice();
          const tmp = next[i];
          next[i] = next[j];
          next[j] = tmp;
          try {
            await persistOrder(next);
            showToast('ترتیب ذخیره شد');
            paint();
          } catch (err) {
            showToast(err.message);
          }
        };

        const uploadCover = async (id, file) => {
          if (!file) return;
          const fd = new FormData();
          fd.append('file', file);
          const up = await api('/api/admin/upload', { method: 'POST', body: fd });
          const path = up.path || '';
          if (!path) throw new Error('آپلود ناموفق');
          const r = await api(`/api/menu/categories/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ coverImg: path }),
          });
          catList = r.menuCategories || catList;
          if (r.products) state.products = r.products;
          showToast('کاور ذخیره شد');
          paint();
        };

        listEl.querySelectorAll('[data-cat-up]').forEach((b) =>
          b.addEventListener('click', () => moveCat(Number(b.dataset.catUp), -1))
        );
        listEl.querySelectorAll('[data-cat-down]').forEach((b) =>
          b.addEventListener('click', () => moveCat(Number(b.dataset.catDown), 1))
        );
        listEl.querySelectorAll('[data-cat-menu]').forEach((b) =>
          b.addEventListener('click', () => tabs.menu(Number(b.dataset.catMenu)).catch((e) => showToast(e.message)))
        );
        listEl.querySelectorAll('[data-cat-cover-pick]').forEach((b) => {
          b.addEventListener('click', () => {
            listEl.querySelector(`[data-cat-file="${b.dataset.catCoverPick}"]`)?.click();
          });
        });
        listEl.querySelectorAll('[data-cat-drop]').forEach((drop) => {
          drop.addEventListener('click', () => {
            listEl.querySelector(`[data-cat-file="${drop.dataset.catDrop}"]`)?.click();
          });
        });
        listEl.querySelectorAll('[data-cat-file]').forEach((inp) => {
          inp.addEventListener('change', async () => {
            try {
              await uploadCover(Number(inp.dataset.catFile), inp.files?.[0]);
            } catch (err) {
              showToast(err.message);
            }
            inp.value = '';
          });
        });
        listEl.querySelectorAll('[data-cat-cover-clear]').forEach((b) => {
          b.addEventListener('click', async () => {
            const id = Number(b.dataset.catCoverClear);
            const cat = catList.find((c) => c.id === id);
            if (!cat) return;
            if (!cat.hiddenOnSite) {
              return showToast('اول دسته را مخفی کنید، بعد کاور را پاک کنید');
            }
            try {
              const r = await api(`/api/menu/categories/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ coverImg: '' }),
              });
              catList = r.menuCategories || catList;
              if (r.products) state.products = r.products;
              setSyncStatus('idle');
              showToast('کاور پاک شد');
              paint();
            } catch (err) {
              showToast(err.message);
            }
          });
        });

        const persistCatFields = async (id, { repaint = false } = {}) => {
          const title = listEl.querySelector(`[data-cat-title="${id}"]`)?.value.trim();
          if (!title) throw new Error('عنوان لازم است');
          const cat = catList.find((c) => c.id === id);
          const hiddenOnSite = !!listEl.querySelector(`[data-cat-hide="${id}"]`)?.checked;
          if (!hiddenOnSite && cat && !hasValidCover(cat)) {
            throw new Error('برای نمایش روی صفحه اصلی باید کاور آپلود شود');
          }
          const r = await api(`/api/menu/categories/${id}`, {
            method: 'PUT',
            body: JSON.stringify({
              title,
              shortDesc: listEl.querySelector(`[data-cat-short="${id}"]`)?.value || '',
              longDesc: listEl.querySelector(`[data-cat-long="${id}"]`)?.value || '',
              hiddenOnSite,
              coverImg: cat?.coverImg || '',
            }),
          });
          catList = r.menuCategories || catList;
          if (r.products) state.products = r.products;
          if (repaint) paint();
        };

        catList.forEach((c) => {
          const id = c.id;
          const saveDebounced = autosave(() => persistCatFields(id), { debounceMs: 400, silent: true });
          const saveNow = autosave(() => persistCatFields(id, { repaint: true }), { debounceMs: 0, silent: true });
          listEl.querySelector(`[data-cat-title="${id}"]`)?.addEventListener('input', saveDebounced);
          listEl.querySelector(`[data-cat-short="${id}"]`)?.addEventListener('input', saveDebounced);
          listEl.querySelector(`[data-cat-long="${id}"]`)?.addEventListener('input', saveDebounced);
          listEl.querySelector(`[data-cat-hide="${id}"]`)?.addEventListener('change', saveNow);
        });

        listEl.querySelectorAll('[data-cat-del]').forEach((b) => {
          b.addEventListener('click', async () => {
            if (!confirm('این دسته حذف شود؟')) return;
            try {
              const r = await api(`/api/menu/categories/${b.dataset.catDel}`, { method: 'DELETE' });
              catList = r.menuCategories || [];
              if (r.products) state.products = r.products;
              showToast('دسته حذف شد');
              paint();
            } catch (err) {
              showToast(err.message);
            }
          });
        });
      };

      main.innerHTML = `
        <h1>دسته‌های کاروسل</h1>
        <p class="lead">ترتیب، کاور هیرو، متن بازاریابی و نمایش روی صفحه اصلی — فقط از اینجا مدیریت می‌شود.</p>
        <div class="section-box">
          <div class="row-actions" style="margin-bottom:0.85rem;flex-wrap:wrap;gap:0.5rem;align-items:flex-end">
            <div class="field" style="margin:0;flex:1;min-width:12rem">
              <label for="cat-studio-new">دسته جدید</label>
              <input id="cat-studio-new" type="text" placeholder="مثلاً دسر" />
            </div>
            <button type="button" class="btn btn-sm" id="cat-studio-add">افزودن دسته</button>
            <button type="button" class="btn btn-sm btn-ghost" id="go-menu-studio">منوی غذا</button>
          </div>
          <p class="hint" id="cat-studio-summary" style="margin:0 0 0.75rem"></p>
          <div class="menu-studio__cat-mgr" id="cat-studio-list"></div>
        </div>`;

      document.getElementById('go-menu-studio').onclick = () => tabs.menu().catch((e) => showToast(e.message));
      document.getElementById('cat-studio-add').onclick = async () => {
        const title = document.getElementById('cat-studio-new')?.value.trim();
        if (!title) return showToast('عنوان دسته را وارد کنید');
        try {
          const r = await api('/api/menu/categories', {
            method: 'POST',
            body: JSON.stringify({ title, hiddenOnSite: true }),
          });
          catList = r.menuCategories || catList;
          if (r.products) state.products = r.products;
          document.getElementById('cat-studio-new').value = '';
          showToast('دسته اضافه شد — کاور هیرو را آپلود کنید');
          paint();
        } catch (err) {
          showToast(err.message);
        }
      };

      paint();
    },

    async menu(catId, opts = {}) {
      setActiveTab('menu');
      const d = await api('/api/menu?all=1');
      const cats = d.menuCategories || [];
      const allergens = d.allergens || [];
      const dayparts = d.dayparts || [];
      const allItems = d.menuItems || [];
      if (!catId) catId = cats.length ? cats[0].id : 0;
      catId = Number(catId);
      const searchQ = (opts.q != null ? opts.q : state._menuSearch || '').trim();
      state._menuSearch = searchQ;
      state._menuCats = cats;
      state._menuAllergens = allergens;
      state._menuDayparts = dayparts;
      state._menuAllItems = allItems;
      state.menuItems = allItems.filter((m) => m.categoryId === catId);

      const imgSrc = (img) => {
        if (!img) return '';
        if (/^https?:\/\//i.test(img)) return img;
        return `/${String(img).replace(/^\//, '')}`;
      };

      const filtered = state.menuItems.filter(
        (m) =>
          !searchQ ||
          String(m.name || '').includes(searchQ) ||
          String(m.en || '').toLowerCase().includes(searchQ.toLowerCase()) ||
          String(m.desc || '').includes(searchQ)
      );

      const allergenBoxes = (m, key = m.id) =>
        `<div class="chip-grid" data-allergens-for="${key}">
          ${allergens
            .map(
              (a) =>
                `<label class="chip"><input type="checkbox" value="${esc(a.id)}" ${(m.allergens || []).includes(a.id) ? 'checked' : ''} /> ${esc(a.label)}</label>`
            )
            .join('')}
        </div>`;
      const daypartBoxes = (m, key = m.id) =>
        `<div class="chip-grid" data-dayparts-for="${key}">
          ${dayparts
            .map(
              (p) =>
                `<label class="chip"><input type="checkbox" value="${esc(p.id)}" ${(m.dayparts || ['all']).includes(p.id) ? 'checked' : ''} /> ${esc(p.label)}</label>`
            )
            .join('')}
        </div>`;

      const rowHtml = (m) => {
        const avail = m.available !== false;
        const thumb = m.img
          ? `<img src="${esc(imgSrc(m.img))}" alt="" loading="lazy" />`
          : `<span class="menu-studio__thumb-ph">بدون تصویر</span>`;
        return `
          <div class="menu-studio__row" data-mid="${m.id}" role="button" tabindex="0">
            <div class="menu-studio__thumb">${thumb}</div>
            <div class="menu-studio__meta">
              <strong>${esc(m.name)}</strong>
              <span>${fmtMoney(m.price)}</span>
            </div>
            <div class="menu-studio__row-actions" onclick="event.stopPropagation()">
              <button type="button" class="btn btn-sm btn-ghost" data-mavail="${m.id}" data-val="${avail ? 'false' : 'true'}">${avail ? 'ناموجود' : 'موجود'}</button>
              <button type="button" class="btn btn-sm" data-medit="${m.id}">ویرایش</button>
            </div>
          </div>`;
      };

      const emptyDraft = () => ({
        id: null,
        categoryId: catId,
        name: '',
        en: '',
        ar: '',
        desc: '',
        descEn: '',
        descAr: '',
        price: 0,
        img: '',
        available: true,
        allergens: [],
        dayparts: ['all'],
        stock: null,
        lowStockAt: 5,
      });

      main.innerHTML = `
        <div class="menu-studio">
          <h1>منوی غذا</h1>
          <p class="lead">افزودن و ویرایش غذا، تصویر، آلرژن و وعده — بدون فرم‌های طولانی پشت‌سرهم.</p>
          <div class="section-box">
            <div class="menu-studio__toolbar">
              <div class="field"><label for="menu-search">جستجو</label>
                <input id="menu-search" type="search" placeholder="نام یا توضیح…" value="${esc(searchQ)}" />
              </div>
              <div class="menu-studio__toolbar-actions">
                <button type="button" class="btn btn-sm btn-ghost" id="go-carousel-cats">دسته‌های کاروسل</button>
                <button type="button" class="btn btn-sm" id="menu-add">افزودن غذا</button>
              </div>
            </div>
            <div class="menu-studio__cats" id="menu-cats" role="tablist" aria-label="دسته‌ها">
              ${cats
                .map(
                  (c) =>
                    `<button type="button" class="menu-studio__cat${Number(catId) === c.id ? ' is-on' : ''}" data-cat="${c.id}" role="tab" aria-selected="${Number(catId) === c.id}">${esc(c.title)}</button>`
                )
                .join('') || '<span class="hint">دسته‌ای نیست</span>'}
            </div>
          </div>
          <div class="section-box">
            <div class="menu-studio__list" id="menu-list">
              ${filtered.map(rowHtml).join('') || '<div class="menu-studio__empty">آیتمی در این دسته نیست — «افزودن غذا» را بزنید.</div>'}
            </div>
          </div>
        </div>
        <div class="menu-studio__drawer-scrim" id="menu-drawer-scrim" hidden></div>
        <aside class="menu-studio__drawer" id="menu-drawer" hidden aria-hidden="true"></aside>`;

      const drawerEl = document.getElementById('menu-drawer');
      const scrimEl = document.getElementById('menu-drawer-scrim');
      const listEl = document.getElementById('menu-list');
      let draftImg = '';
      let editingId = null;

      const readChips = (sel) =>
        [...main.querySelectorAll(`${sel} input:checked`)].map((inp) => inp.value);

      const closeDrawer = () => {
        drawerEl.hidden = true;
        drawerEl.setAttribute('aria-hidden', 'true');
        scrimEl.hidden = true;
        editingId = null;
        listEl.querySelectorAll('.menu-studio__row.is-active').forEach((r) => r.classList.remove('is-active'));
      };

      const wireDaypartExclusive = (root) => {
        const grid = root.querySelector('[data-dayparts-for]');
        if (!grid) return;
        grid.addEventListener('change', (e) => {
          const inp = e.target;
          if (!(inp instanceof HTMLInputElement) || inp.type !== 'checkbox') return;
          if (inp.value === 'all' && inp.checked) {
            grid.querySelectorAll('input').forEach((i) => {
              if (i !== inp) i.checked = false;
            });
          } else if (inp.value !== 'all' && inp.checked) {
            const all = grid.querySelector('input[value="all"]');
            if (all) all.checked = false;
          }
        });
      };

      const patchRow = (item) => {
        const row = listEl.querySelector(`[data-mid="${item.id}"]`);
        if (!row) {
          if (item.categoryId === catId) {
            const empty = listEl.querySelector('.menu-studio__empty');
            if (empty) empty.remove();
            listEl.insertAdjacentHTML('afterbegin', rowHtml(item));
            wireListRow(listEl.querySelector(`[data-mid="${item.id}"]`));
          }
          return;
        }
        if (item.categoryId !== catId) {
          row.remove();
          if (!listEl.querySelector('.menu-studio__row')) {
            listEl.innerHTML = '<div class="menu-studio__empty">آیتمی در این دسته نیست — «افزودن غذا» را بزنید.</div>';
          }
          return;
        }
        const tmp = document.createElement('div');
        tmp.innerHTML = rowHtml(item);
        const next = tmp.firstElementChild;
        row.replaceWith(next);
        wireListRow(next);
        if (editingId === item.id) next.classList.add('is-active');
      };

      const collectDrawerPayload = () => {
        const stockVal = document.getElementById('md_stock')?.value;
        return {
          categoryId: Number(document.getElementById('md_cat')?.value) || catId,
          name: document.getElementById('md_name')?.value.trim() || '',
          en: document.getElementById('md_en')?.value || '',
          ar: document.getElementById('md_ar')?.value || '',
          desc: document.getElementById('md_desc')?.value || '',
          descEn: document.getElementById('md_descEn')?.value || '',
          descAr: document.getElementById('md_descAr')?.value || '',
          price: Number(document.getElementById('md_price')?.value) || 0,
          img: draftImg || '',
          stock: stockVal === '' || stockVal == null ? null : Number(stockVal),
          lowStockAt: Number(document.getElementById('md_low')?.value) || 0,
          allergens: readChips('[data-allergens-for="draft"]'),
          dayparts: readChips('[data-dayparts-for="draft"]'),
        };
      };

      const openDrawer = (item) => {
        const isNew = !item || item.id == null;
        editingId = isNew ? null : item.id;
        draftImg = item.img || '';
        listEl.querySelectorAll('.menu-studio__row.is-active').forEach((r) => r.classList.remove('is-active'));
        if (!isNew) {
          const row = listEl.querySelector(`[data-mid="${item.id}"]`);
          if (row) row.classList.add('is-active');
        }
        const hasImg = !!draftImg;
        drawerEl.innerHTML = `
          <div class="menu-studio__drawer-head">
            <h2>${isNew ? 'افزودن غذا' : `ویرایش · ${esc(item.name)}`}</h2>
            <button type="button" class="menu-studio__drawer-close" id="md-close" aria-label="بستن">×</button>
          </div>
          <div class="menu-studio__drop${hasImg ? ' has-img' : ''}" id="md-drop">
            ${hasImg ? `<img id="md-preview" src="${esc(imgSrc(draftImg))}" alt="" />` : `<div class="menu-studio__drop-hint">تصویر غذا را انتخاب کنید<br/><small>JPG / PNG / WebP</small></div>`}
            <div class="menu-studio__drop-actions">
              <label class="btn btn-sm" style="cursor:pointer">
                ${hasImg ? 'تغییر تصویر' : 'انتخاب تصویر'}
                <input type="file" id="md-file" accept=".jpg,.jpeg,.png,.webp,.avif,.svg" hidden />
              </label>
              ${hasImg ? '<button type="button" class="btn btn-sm btn-ghost" id="md-img-clear">حذف تصویر</button>' : ''}
            </div>
          </div>
          ${field('نام', 'md_name', item.name || '')}
          ${field('توضیح', 'md_desc', item.desc || '', { textarea: true })}
          <div class="grid-2">
            ${field('قیمت (تومان)', 'md_price', String(item.price ?? 0), { ltr: true, type: 'number' })}
            <div class="field"><label for="md_cat">دسته</label>
              <select id="md_cat">${cats.map((c) => `<option value="${c.id}" ${Number(item.categoryId) === c.id ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select>
            </div>
          </div>
          <div class="field"><label>آلرژن‌ها</label>${allergenBoxes(item, 'draft')}</div>
          <div class="field"><label>وعده‌های نمایش</label>${daypartBoxes(item, 'draft')}</div>
          <details class="menu-studio__advanced">
            <summary>پیشرفته · ترجمه و موجودی</summary>
            <div class="menu-studio__links">
              <button type="button" data-goto="translate">ترجمه منو</button>
              <button type="button" data-goto="inventory">موجودی انبار</button>
            </div>
            ${field('نام انگلیسی', 'md_en', item.en || '', { ltr: true })}
            ${field('نام عربی', 'md_ar', item.ar || '', { ltr: true })}
            ${field('توضیح انگلیسی', 'md_descEn', item.descEn || '', { textarea: true, ltr: true })}
            ${field('توضیح عربی', 'md_descAr', item.descAr || '', { textarea: true, ltr: true })}
            ${field('موجودی (خالی = نامحدود)', 'md_stock', item.stock === null || item.stock === undefined ? '' : String(item.stock), { ltr: true, type: 'number' })}
            ${field('آستانه هشدار موجودی کم', 'md_low', String(item.lowStockAt ?? 5), { ltr: true, type: 'number' })}
          </details>
          <div class="row-actions">
            ${
              isNew
                ? `<button type="button" class="btn btn-sm" id="md-create">ایجاد غذا</button>
                   <span class="hint">پس از ایجاد، بقیه فیلدها خودکار ذخیره می‌شوند</span>`
                : `<span class="hint" id="md-sync-hint">ذخیره خودکار</span>
                   <button type="button" class="btn btn-sm btn-ghost" id="md-avail" data-val="${item.available === false}">${item.available === false ? 'موجود کن' : 'ناموجود کن'}</button>
                   <button type="button" class="btn btn-sm btn-danger" id="md-del">حذف</button>`
            }
          </div>`;

        drawerEl.hidden = false;
        drawerEl.setAttribute('aria-hidden', 'false');
        scrimEl.hidden = false;
        wireDaypartExclusive(drawerEl);

        document.getElementById('md-close').onclick = closeDrawer;
        scrimEl.onclick = closeDrawer;

        drawerEl.querySelectorAll('[data-goto]').forEach((b) => {
          b.addEventListener('click', () => {
            closeDrawer();
            tabs[b.dataset.goto]().catch((e) => showToast(e.message));
          });
        });

        const applySavedItem = (updated) => {
          state._menuAllItems = (state._menuAllItems || []).map((x) => (x.id === updated.id ? updated : x));
          if (!(state._menuAllItems || []).some((x) => x.id === updated.id)) {
            state._menuAllItems = [...(state._menuAllItems || []), updated];
          }
          state.menuItems = (state._menuAllItems || []).filter((x) => x.categoryId === catId);
          patchRow(updated);
          return updated;
        };

        const persistDrawer = async ({ create = false } = {}) => {
          const payload = collectDrawerPayload();
          if (!payload.name) throw new Error('نام را وارد کنید');
          if (create || editingId == null) {
            const r = await api('/api/menu', { method: 'POST', body: JSON.stringify(payload) });
            const created = r.item;
            applySavedItem(created);
            openDrawer(created);
            return created;
          }
          const r = await api(`/api/menu/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
          const updated = r.item;
          applySavedItem(updated);
          if (updated.categoryId !== catId) closeDrawer();
          else {
            editingId = updated.id;
            draftImg = updated.img || '';
            const head = drawerEl.querySelector('.menu-studio__drawer-head h2');
            if (head) head.textContent = `ویرایش · ${updated.name}`;
          }
          return updated;
        };

        const saveDebounced = autosave(() => persistDrawer(), { debounceMs: 400, silent: true });
        const saveNow = autosave(() => persistDrawer(), { debounceMs: 0, silent: true });

        const paintDrop = () => {
          const drop = document.getElementById('md-drop');
          if (!drop) return;
          const has = !!draftImg;
          drop.classList.toggle('has-img', has);
          drop.innerHTML = has
            ? `<img id="md-preview" src="${esc(imgSrc(draftImg))}" alt="" />
               <div class="menu-studio__drop-actions">
                 <label class="btn btn-sm" style="cursor:pointer">تغییر تصویر
                   <input type="file" id="md-file" accept=".jpg,.jpeg,.png,.webp,.avif,.svg" hidden />
                 </label>
                 <button type="button" class="btn btn-sm btn-ghost" id="md-img-clear">حذف تصویر</button>
               </div>`
            : `<div class="menu-studio__drop-hint">تصویر غذا را انتخاب کنید<br/><small>JPG / PNG / WebP</small></div>
               <div class="menu-studio__drop-actions">
                 <label class="btn btn-sm" style="cursor:pointer">انتخاب تصویر
                   <input type="file" id="md-file" accept=".jpg,.jpeg,.png,.webp,.avif,.svg" hidden />
                 </label>
               </div>`;
          document.getElementById('md-file')?.addEventListener('change', async (ev) => {
            const file = ev.target.files?.[0];
            if (!file) return;
            try {
              setSyncStatus('saving');
              const fd = new FormData();
              fd.append('file', file);
              const up = await api('/api/admin/upload', { method: 'POST', body: fd });
              draftImg = up.path || '';
              if (!draftImg) throw new Error('آپلود ناموفق');
              paintDrop();
              if (editingId != null) await saveNow();
              else setSyncStatus('idle');
              showToast('تصویر ذخیره شد');
            } catch (err) {
              setSyncStatus('error', err.message);
              showToast(err.message || 'خطای آپلود');
            }
          });
          document.getElementById('md-img-clear')?.addEventListener('click', async () => {
            draftImg = '';
            paintDrop();
            if (editingId != null) {
              try {
                await saveNow();
              } catch (_) {}
            }
          });
        };
        paintDrop();

        if (isNew) {
          document.getElementById('md-create').onclick = async () => {
            try {
              await autosave(() => persistDrawer({ create: true }), { debounceMs: 0, silent: false })();
            } catch (_) {}
          };
        } else {
          bindAutosave(drawerEl, () => persistDrawer(), { debounceMs: 400, silent: true });
          drawerEl.querySelectorAll('[data-allergens-for] input, [data-dayparts-for] input').forEach((inp) => {
            inp.addEventListener('change', () => saveNow());
          });
        }

        document.getElementById('md-avail')?.addEventListener('click', async () => {
          const nextAvail = document.getElementById('md-avail').dataset.val === 'true';
          try {
            const r = await api(`/api/menu/${editingId}`, {
              method: 'PUT',
              body: JSON.stringify({ available: nextAvail }),
            });
            showToast(nextAvail ? 'موجود شد' : 'ناموجود شد');
            patchRow(r.item);
            openDrawer(r.item);
          } catch (err) {
            showToast(err.message);
          }
        });

        document.getElementById('md-del')?.addEventListener('click', async () => {
          if (!confirm('این آیتم حذف شود؟')) return;
          try {
            await api(`/api/menu/${editingId}`, { method: 'DELETE' });
            showToast('حذف شد');
            const id = editingId;
            state.menuItems = state.menuItems.filter((x) => x.id !== id);
            state._menuAllItems = (state._menuAllItems || []).filter((x) => x.id !== id);
            listEl.querySelector(`[data-mid="${id}"]`)?.remove();
            if (!listEl.querySelector('.menu-studio__row')) {
              listEl.innerHTML = '<div class="menu-studio__empty">آیتمی در این دسته نیست — «افزودن غذا» را بزنید.</div>';
            }
            closeDrawer();
          } catch (err) {
            showToast(err.message);
          }
        });
      };

      function wireListRow(row) {
        if (!row) return;
        const id = Number(row.dataset.mid);
        const open = () => {
          const item = (state._menuAllItems || state.menuItems).find((m) => m.id === id);
          if (item) openDrawer(item);
        };
        row.addEventListener('click', open);
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        });
        row.querySelector('[data-medit]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          open();
        });
        row.querySelector('[data-mavail]')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          const btn = e.currentTarget;
          try {
            const r = await api(`/api/menu/${btn.dataset.mavail}`, {
              method: 'PUT',
              body: JSON.stringify({ available: btn.dataset.val === 'true' }),
            });
            const updated = r.item;
            state._menuAllItems = (state._menuAllItems || []).map((x) => (x.id === updated.id ? updated : x));
            state.menuItems = state.menuItems.map((x) => (x.id === updated.id ? updated : x));
            patchRow(updated);
            showToast(updated.available === false ? 'ناموجود شد' : 'موجود شد');
          } catch (err) {
            showToast(err.message);
          }
        });
      }

      listEl.querySelectorAll('.menu-studio__row').forEach(wireListRow);

      document.getElementById('menu-cats').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-cat]');
        if (!btn) return;
        tabs.menu(Number(btn.dataset.cat), { q: searchQ }).catch((err) => showToast(err.message));
      });

      let searchTimer = null;
      document.getElementById('menu-search').addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        const q = e.target.value;
        searchTimer = setTimeout(() => {
          tabs.menu(catId, { q }).catch((err) => showToast(err.message));
        }, 220);
      });

      document.getElementById('menu-add').onclick = () => openDrawer(emptyDraft());
      document.getElementById('go-carousel-cats').onclick = () =>
        tabs.products().catch((e) => showToast(e.message));

      if (opts.openId) {
        const item = allItems.find((m) => m.id === Number(opts.openId));
        if (item) openDrawer(item);
      } else if (opts.openNew) {
        openDrawer(emptyDraft());
      }
    },

    async translate() {
      setActiveTab('translate');
      const d = await api('/api/admin/i18n');
      const st = d.stats || {};
      const i18n = d.i18n || {};
      const menu = await api('/api/menu?all=1');
      const items = menu.menuItems || [];
      const missing = items.filter((m) => !String(m.en || '').trim() || (m.desc && !String(m.descEn || '').trim()));
      main.innerHTML = `
        <h1>ترجمه منو (FA → EN / AR)</h1>
        <p class="lead">ترجمه نام و توضیح آیتم‌ها برای مهمانان انگلیسی و عربی — موتور فعلی EN را با ${st.engine === 'openai' ? 'OpenAI' : 'واژه‌نامه'} پر می‌کند؛ عربی را دستی وارد کنید.</p>
        <div class="cards">
          <div class="card"><div class="num">${fmtNum(st.total || 0)}</div><div class="lbl">کل آیتم</div></div>
          <div class="card accent"><div class="num">${fmtNum(st.withEn || 0)}</div><div class="lbl">دارای نام EN</div></div>
          <div class="card warn"><div class="num">${fmtNum(st.missingEn || 0)}</div><div class="lbl">بدون نام EN</div></div>
          <div class="card accent"><div class="num">${fmtNum(st.withAr || 0)}</div><div class="lbl">دارای نام AR</div></div>
          <div class="card warn"><div class="num">${fmtNum(st.missingAr || 0)}</div><div class="lbl">بدون نام AR</div></div>
        </div>
        <div class="section-box">
          <h2>تنظیمات مهمان</h2>
          <label class="chk" style="display:inline-flex;margin-bottom:0.75rem;"><input type="checkbox" id="i18n_enabled" ${i18n.guestLangEnabled !== false ? 'checked' : ''} /> نمایش سوییچ زبان در منوی عمومی</label>
          <div class="field" style="max-width:220px;">
            <label>زبان پیش‌فرض</label>
            <select id="i18n_default">
              <option value="fa" ${i18n.defaultLang === 'fa' || !i18n.defaultLang ? 'selected' : ''}>فارسی</option>
              <option value="en" ${i18n.defaultLang === 'en' ? 'selected' : ''}>English</option>
              <option value="ar" ${i18n.defaultLang === 'ar' ? 'selected' : ''}>العربية</option>
            </select>
          </div>
          <div class="row-actions">
            <span class="hint">ذخیره خودکار تنظیمات</span>
            <button class="btn btn-sm" id="tr-missing">ترجمه EN ناقص (${fmtNum(missing.length)})</button>
            <button class="btn btn-sm btn-ghost" id="tr-force">بازنویسی همه EN</button>
          </div>
        </div>
        <div class="section-box">
          <h2>بازبینی سریع</h2>
          <p class="hint">تغییر ردیف‌ها خودکار ذخیره می‌شود</p>
          <table class="tbl"><thead><tr><th>فارسی</th><th>English</th><th>العربية</th><th>توضیح EN</th><th>توضیح AR</th><th></th></tr></thead><tbody>
            ${items
              .slice(0, 40)
              .map(
                (m) => `<tr data-tid="${m.id}">
                  <td>${esc(m.name)}</td>
                  <td><input class="ltr-input tr-en" dir="ltr" value="${esc(m.en || '')}" /></td>
                  <td><input class="ltr-input tr-ar" dir="rtl" value="${esc(m.ar || '')}" /></td>
                  <td><input class="ltr-input tr-desc" dir="ltr" value="${esc(m.descEn || '')}" /></td>
                  <td><input class="ltr-input tr-desc-ar" dir="rtl" value="${esc(m.descAr || '')}" /></td>
                  <td><button class="btn btn-sm btn-ghost" data-trai="${m.id}">AI EN</button></td>
                </tr>`
              )
              .join('') || '<tr><td colspan="6">آیتمی نیست</td></tr>'}
          </tbody></table>
        </div>`;

      const saveI18nSettings = async () => {
        await api('/api/admin/i18n', {
          method: 'PUT',
          body: JSON.stringify({
            guestLangEnabled: document.getElementById('i18n_enabled').checked,
            defaultLang: document.getElementById('i18n_default').value,
          }),
        });
      };
      document.getElementById('i18n_enabled')?.addEventListener('change', autosave(saveI18nSettings, { debounceMs: 0, silent: true }));
      document.getElementById('i18n_default')?.addEventListener('change', autosave(saveI18nSettings, { debounceMs: 0, silent: true }));
      document.getElementById('tr-missing').addEventListener('click', async () => {
        showToast('در حال ترجمه…');
        const r = await api('/api/admin/translate/menu', {
          method: 'POST',
          body: JSON.stringify({ onlyMissing: true }),
        });
        showToast(`${r.count} آیتم ترجمه شد (${r.engine})`);
        tabs.translate();
      });
      document.getElementById('tr-force').addEventListener('click', async () => {
        if (!confirm('همه ترجمه‌های انگلیسی بازنویسی شوند؟')) return;
        showToast('در حال بازنویسی…');
        const r = await api('/api/admin/translate/menu', {
          method: 'POST',
          body: JSON.stringify({ force: true, onlyMissing: false }),
        });
        showToast(`${r.count} آیتم به‌روز شد`);
        tabs.translate();
      });
      main.querySelectorAll('[data-trai]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const r = await api(`/api/admin/translate/menu/${btn.dataset.trai}`, {
            method: 'POST',
            body: JSON.stringify({ force: true }),
          });
          const tr = btn.closest('tr');
          tr.querySelector('.tr-en').value = r.item.en || '';
          tr.querySelector('.tr-desc').value = r.item.descEn || '';
          showToast('ترجمه شد');
        })
      );
      main.querySelectorAll('tr[data-tid]').forEach((tr) => {
        const saveRow = async () => {
          await api(`/api/menu/${tr.dataset.tid}`, {
            method: 'PUT',
            body: JSON.stringify({
              en: tr.querySelector('.tr-en').value,
              ar: tr.querySelector('.tr-ar')?.value || '',
              descEn: tr.querySelector('.tr-desc').value,
              descAr: tr.querySelector('.tr-desc-ar')?.value || '',
            }),
          });
        };
        const run = autosave(saveRow, { debounceMs: 400, silent: true });
        tr.querySelectorAll('input').forEach((inp) => {
          inp.addEventListener('input', run);
          inp.addEventListener('change', run);
        });
      });
    },

    async kitchen() {
      setActiveTab('kitchen');
      const paint = async () => {
        const [queue, callsRes] = await Promise.all([api(`/api/kitchen/orders${branchQs()}`), api(`/api/kitchen/calls${branchQs()}`)]);
        const tickets = (queue.tickets || []).slice().sort((a, b) => Number(b.ageSec || 0) - Number(a.ageSec || 0));
        const ids = new Set(tickets.map((t) => t.id));
        for (const id of ids) if (!kitchenSeenIds.has(id) && kitchenSeenIds.size > 0) beepNewOrder();
        kitchenSeenIds = ids;
        const col = (name) => tickets.filter((t) => t.column === name);
        const card = (t) => {
          const hot = t.ageSec >= 1200 ? ' is-critical' : t.ageSec >= 600 ? ' is-late' : t.ageSec >= 300 ? ' is-warn' : '';
          const fulfillment = fulfillmentLabel(t.fulfillment || (t.tableNo ? 'dine_in' : 'pickup'));
          const unitCount = (t.items || []).reduce((sum, i) => sum + Math.max(1, Number(i.qty) || 1), 0);
          return `<article class="kds-card${hot}" data-oid="${t.id}" aria-label="سفارش ${t.id}">
            <header><div><strong>${t.tableNo ? `میز ${esc(t.tableNo)}` : esc(fulfillment)}</strong><small>${esc(fulfillment)} · ${fmtNum(unitCount)} آیتم</small></div><span class="kds-age">${fmtAge(t.ageSec)}</span></header>
            <div class="kds-id">#${t.id}${t.orderNo ? ` · ${esc(t.orderNo)}` : ''}</div>
            ${t.note ? `<div class="kds-note"><strong>یادداشت</strong><span>${esc(t.note)}</span></div>` : ''}
            <ul class="kds-items">${(t.items || []).map((i) => `<li><b>${fmtNum(i.qty)}×</b> <span>${esc(i.name)}</span></li>`).join('')}</ul>
            <div class="kds-actions">
              ${t.column === 'new' ? `<button class="btn btn-sm admin-primary-action" data-kstatus="${t.id}" data-val="preparing">شروع آماده‌سازی</button>` : ''}
              ${t.column === 'preparing' ? `<button class="btn btn-sm admin-primary-action" data-kstatus="${t.id}" data-val="ready">آماده شد</button>` : ''}
              ${t.column === 'ready' ? `<span class="kds-ready-note">✓ آماده تحویل به مهمان / صندوق</span>` : ''}
            </div>
          </article>`;
        };
        const calls = (callsRes.calls || []).slice().sort((a,b) => new Date(a.createdAt||0)-new Date(b.createdAt||0));
        const prepLoad = new Map();
        tickets.filter((t) => t.column !== 'ready').forEach((t) => (t.items || []).forEach((item) => {
          const key = String(item.name || 'آیتم');
          prepLoad.set(key, (prepLoad.get(key) || 0) + Math.max(1, Number(item.qty) || 1));
        }));
        const topPrep = [...prepLoad.entries()].sort((a,b) => b[1]-a[1]).slice(0,6);
        main.innerHTML = `
          <div class="ops-page-head"><div><p class="eyebrow">Kitchen Display</p><h1>آشپزخانه</h1><p class="lead">قدیمی‌ترین تیکت در هر ستون بالاتر است. هدف شیفت: «جدید» را شروع کنید، «در حال آماده‌سازی» را فقط وقتی کامل شد آماده بزنید.</p></div><span class="ops-provider-pill">قدیمی‌ترین: ${fmtAge(queue.summary?.oldestAgeSec || 0)}</span></div>
          <div class="cards cards-dense">
            <div class="card"><div class="num">${fmtNum(queue.counts?.new || 0)}</div><div class="lbl">جدید</div></div>
            <div class="card warn"><div class="num">${fmtNum(queue.counts?.preparing || 0)}</div><div class="lbl">در حال آماده‌سازی</div></div>
            <div class="card accent"><div class="num">${fmtNum(queue.counts?.ready || 0)}</div><div class="lbl">آماده تحویل</div></div>
            <div class="card ${queue.summary?.delayed ? 'is-danger' : ''}"><div class="num">${fmtNum(queue.summary?.delayed || 0)}</div><div class="lbl">بیش از ۲۰ دقیقه</div></div>
            <div class="card"><div class="num">${fmtNum(queue.summary?.itemUnits || 0)}</div><div class="lbl">واحد غذا در صف</div></div>
            <div class="card"><div class="num">${fmtNum(calls.length)}</div><div class="lbl">فراخوان گارسون</div></div>
          </div>
          ${calls.length ? `<section class="section-box kds-calls"><div class="ops-panel__head"><div><p class="eyebrow">سالن</p><h2>فراخوان‌های باز</h2></div><span class="hint">قدیمی‌ترین ابتدا</span></div><div class="kds-call-list">${calls.map((c) => `<button class="btn btn-sm btn-ghost kds-call-btn" data-calldone="${c.id}"><b>میز ${esc(c.tableNo)}</b><span>${c.note ? esc(c.note) : 'بدون توضیح'}</span><small>${c.createdAt ? new Date(c.createdAt).toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'}) : ''}</small><em>انجام شد ✓</em></button>`).join('')}</div></section>` : ''}
          ${topPrep.length ? `<section class="section-box kds-prep-load"><div class="ops-panel__head"><div><p class="eyebrow">فشار آماده‌سازی</p><h2>تعداد تجمیعی غذاهای در انتظار</h2></div><span class="hint">برای هماهنگی سریع تیم</span></div><div class="kds-prep-chips">${topPrep.map(([name,qty])=>`<span><b>${fmtNum(qty)}×</b>${esc(name)}</span>`).join('')}</div></section>` : ''}
          <section class="admin-help-strip section-box"><strong>راهنمای رنگ:</strong><span>۵ دقیقه = توجه · ۱۰ دقیقه = هشدار · ۲۰ دقیقه = بحرانی. رنگ فقط هشدار است و ترتیب اصلی بر اساس سن سفارش می‌ماند.</span></section>
          <div class="kds-board" role="region" aria-label="صف آشپزخانه">
            <section class="kds-col"><h2>جدید <small>${fmtNum(col('new').length)}</small></h2>${col('new').map(card).join('') || '<p class="hint">فعلاً خالی است</p>'}</section>
            <section class="kds-col"><h2>در حال آماده‌سازی <small>${fmtNum(col('preparing').length)}</small></h2>${col('preparing').map(card).join('') || '<p class="hint">فعلاً خالی است</p>'}</section>
            <section class="kds-col"><h2>آماده <small>${fmtNum(col('ready').length)}</small></h2>${col('ready').map(card).join('') || '<p class="hint">فعلاً خالی است</p>'}</section>
          </div>
          <p class="hint">اتصال زنده فعال است؛ تغییر سفارش‌ها بدون polling همگام می‌شود.</p>`;

        main.querySelectorAll('[data-kstatus]').forEach((b) => b.addEventListener('click', () => runBusy(b, async () => {
          await api(`/api/kitchen/orders/${b.dataset.kstatus}`, { method:'PATCH', body:JSON.stringify({ status:b.dataset.val }) });
          showToast('وضعیت آشپزخانه به‌روز شد', 'success', 1400); await paint();
        }).catch((e) => showToast(e.message, 'error'))));
        main.querySelectorAll('[data-calldone]').forEach((b) => b.addEventListener('click', () => runBusy(b, async () => {
          await api(`/api/kitchen/calls/${b.dataset.calldone}`, { method:'PATCH', body:JSON.stringify({ status:'done' }) }); await paint();
        }, 'ثبت…').catch((e) => showToast(e.message, 'error'))));
        if (topbarMeta) topbarMeta.textContent = `زنده · ${new Date(queue.serverTime || Date.now()).toLocaleTimeString('fa-IR')}`;
      };
      kitchenPaint = paint;
      await paint();
      stopKitchenPoll();
    },

    async reservations() {
      setActiveTab('reservations');
      const d = await api(`/api/admin/reservations${branchQs()}`);
      const settings = d.settings || {};
      const labels = { pending:'در انتظار', confirmed:'تأیید شده', seated:'نشسته‌اند', cancelled:'لغو', no_show:'نیامدند' };
      const branchName = (id) => branchesCache.find((b) => b.id === id)?.name || `#${id}`;
      const canConfigure = hasCapability('admin.access');
      const today = new Date().toISOString().slice(0,10);
      const slotsToday = (d.slotLoad || []).filter((row) => row.date === today);
      const peak = slotsToday.reduce((best,row) => !best || row.percent > best.percent ? row : best, null);
      main.innerHTML = `
        <div class="ops-page-head"><div><p class="eyebrow">Front of House</p><h1>رزرو میز</h1><p class="lead">رزروهای نزدیک اول نمایش داده می‌شوند. وضعیت، تعداد نفر و یادداشت مهمان را از همین صفحه مدیریت کنید.</p></div><a class="btn btn-sm btn-ghost" href="/reserve" target="_blank" rel="noopener">مشاهده صفحه رزرو</a></div>
        <div class="cards cards-dense">
          <div class="card"><div class="num">${fmtNum(d.summary?.today || 0)}</div><div class="lbl">رزرو فعال امروز</div></div>
          <div class="card"><div class="num">${fmtNum(d.summary?.todayCovers || 0)}</div><div class="lbl">نفر امروز</div></div>
          <div class="card warn"><div class="num">${fmtNum(d.summary?.pending || 0)}</div><div class="lbl">منتظر تأیید</div></div>
          <div class="card accent"><div class="num">${fmtNum(d.summary?.confirmed || 0)}</div><div class="lbl">تأیید شده</div></div>
          <div class="card"><div class="num">${fmtNum(d.summary?.seated || 0)}</div><div class="lbl">نشسته‌اند</div></div>
          <div class="card ${d.summary?.noShowToday ? 'is-danger' : ''}"><div class="num">${fmtNum(d.summary?.noShowToday || 0)}</div><div class="lbl">No-show امروز</div></div>
        </div>
        ${slotsToday.length ? `<section class="section-box"><div class="ops-panel__head"><div><p class="eyebrow">بار شیفت امروز</p><h2>ظرفیت اسلات‌های رزرو</h2></div>${peak ? `<span class="hint">شلوغ‌ترین: ${esc(peak.time)} · ${fmtNum(peak.percent)}٪</span>` : ''}</div><div class="reservation-slot-load">${slotsToday.map((row)=>`<div class="reservation-slot"><header><b>${esc(row.time)}</b><span>${fmtNum(row.covers)}/${fmtNum(row.maxCovers)} نفر</span></header><div class="reservation-slot__bar"><i style="width:${Math.min(100,row.percent)}%"></i></div><small>${fmtNum(row.parties)} رزرو · ${fmtNum(row.percent)}٪ ظرفیت</small></div>`).join('')}</div></section>` : ''}
        ${canConfigure ? `<details class="section-box admin-config-panel"><summary><strong>تنظیمات ظرفیت رزرو</strong><span>برای مدیر سیستم</span></summary><div class="grid-2 admin-config-grid"><label class="chk"><input type="checkbox" id="rs_en" ${settings.enabled !== false ? 'checked' : ''} /> رزرو آنلاین فعال</label>${field('فاصله اسلات (دقیقه)','rs_slot',String(settings.slotMinutes ?? 30),{ltr:true,type:'number'})}${field('حداکثر نفرات هر رزرو','rs_party',String(settings.maxParty ?? 12),{ltr:true,type:'number'})}${field('ظرفیت هر اسلات (نفر)','rs_covers',String(settings.maxCoversPerSlot ?? 24),{ltr:true,type:'number'})}${field('روزهای پیشِ‌رو','rs_adv',String(settings.advanceDays ?? 21),{ltr:true,type:'number'})}${field('حداقل ساعت تا رزرو','rs_min',String(settings.minHoursAhead ?? 1),{ltr:true,type:'number'})}</div><p class="hint">تغییرات این بخش ذخیره خودکار دارند.</p></details>` : ''}
        <section class="section-box">
          <div class="ops-filters admin-filter-row">
            <label><span>جست‌وجو</span><input id="res-search" type="search" placeholder="نام، تلفن یا یادداشت…" /></label>
            <label><span>تاریخ</span><input id="res-date" type="text" class="shamsi-date-picker" data-shamsi-picker placeholder="فیلتر تاریخ شمسی..." /></label>
            <label><span>وضعیت</span><select id="res-status"><option value="">همه</option>${Object.entries(labels).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>
            <span class="ops-filter-count" id="res-count"></span>
          </div>
          <table class="tbl admin-dense-table"><thead><tr><th>زمان</th><th>مهمان</th><th>نفر</th><th>شعبه</th><th>وضعیت</th><th>یادداشت</th></tr></thead><tbody id="reservation-body">
          ${(d.reservations || []).map((r)=>`<tr data-reservation-row="${r.id}" data-status="${esc(r.status)}" data-date="${esc(r.date)}" data-search="${esc(`${r.name} ${r.phone} ${r.note||''}`.toLowerCase())}">
            <td><strong>${window.ShamsiCore ? window.ShamsiCore.formatShamsiDateLong(r.date) : esc(r.date)}</strong><small class="admin-cell-sub">${esc(r.time)}</small></td>
            <td><strong>${esc(r.name)}</strong><small class="admin-cell-sub ltr">${esc(r.phone)}</small></td>
            <td><input class="admin-compact-number" type="number" min="1" max="${Number(settings.maxParty)||12}" value="${Number(r.partySize)||1}" data-rparty="${r.id}" aria-label="تعداد نفر ${esc(r.name)}" /></td>
            <td>${esc(branchName(r.branchId))}</td>
            <td><select data-rstatus="${r.id}">${Object.keys(labels).map((k)=>`<option value="${k}" ${r.status===k?'selected':''}>${labels[k]}</option>`).join('')}</select></td>
            <td><input class="admin-note-input" data-rnote="${r.id}" value="${esc(r.note||'')}" placeholder="یادداشت مهمان…" /></td>
          </tr>`).join('') || '<tr><td colspan="6">رزروی ثبت نشده است.</td></tr>'}</tbody></table>
        </section>`;

      const saveSettings = async () => api('/api/admin/reservation-settings',{method:'PUT',body:JSON.stringify({settings:{enabled:document.getElementById('rs_en').checked,slotMinutes:Number(document.getElementById('rs_slot').value)||30,maxParty:Number(document.getElementById('rs_party').value)||12,maxCoversPerSlot:Number(document.getElementById('rs_covers').value)||24,advanceDays:Number(document.getElementById('rs_adv').value)||21,minHoursAhead:Number(document.getElementById('rs_min').value)||0}})});
      if (canConfigure) bindAutosave(main.querySelector('.admin-config-panel'), saveSettings);

      const applyResFilter = () => {
        const q=String(document.getElementById('res-search')?.value||'').trim().toLowerCase(), date=document.getElementById('res-date')?.dataset?.isoDate || document.getElementById('res-date')?.value||'', status=document.getElementById('res-status')?.value||'';
        let n=0; main.querySelectorAll('[data-reservation-row]').forEach((row)=>{ const ok=(!q||row.dataset.search.includes(q))&&(!date||row.dataset.date===date)&&(!status||row.dataset.status===status); row.hidden=!ok; if(ok)n++; });
        const el=document.getElementById('res-count'); if(el)el.textContent=`${fmtNum(n)} رزرو`;
      };
      ['res-search','res-date','res-status'].forEach((id)=>document.getElementById(id)?.addEventListener(id==='res-search'?'input':'change',applyResFilter)); applyResFilter();
      if (window.ShamsiDatePicker) window.ShamsiDatePicker.autoInit(main);

      main.querySelectorAll('[data-rstatus]').forEach((sel)=>sel.addEventListener('change', async()=>{
        const next=sel.value; if ((next==='cancelled'||next==='no_show') && !window.confirm(next==='cancelled'?'این رزرو لغو شود؟':'مهمان به‌عنوان «نیامد» ثبت شود؟')) { await tabs.reservations(); return; }
        try { await api(`/api/admin/reservations/${sel.dataset.rstatus}`,{method:'PATCH',body:JSON.stringify({status:next})}); showToast('وضعیت رزرو به‌روز شد','success',1400); }
        catch(e){ showToast(e.message,'error'); await tabs.reservations(); }
      }));
      main.querySelectorAll('[data-rparty]').forEach((input)=>input.addEventListener('change', async()=>{ try { await api(`/api/admin/reservations/${input.dataset.rparty}`,{method:'PATCH',body:JSON.stringify({partySize:Number(input.value)||1})}); showToast('تعداد نفر ذخیره شد','success',1300); } catch(e){showToast(e.message,'error');} }));
      main.querySelectorAll('[data-rnote]').forEach((input)=>{ const save=autosave(()=>api(`/api/admin/reservations/${input.dataset.rnote}`,{method:'PATCH',body:JSON.stringify({note:input.value})}),{debounceMs:500,silent:true}); input.addEventListener('change',save); input.addEventListener('blur',save); });
    },

    async orders() {
      setActiveTab('orders');
      const d = await api(`/api/admin/orders${branchQs()}`);
      const orders = (d.orders || []).slice();
      const active = orders.filter((o)=>!TERMINAL_ORDER_STATUSES.has(String(o.status)));
      const lateCount = active.filter((o)=>orderAgeMinutes(o)>=20 && !['ready','dispatched'].includes(o.status)).length;
      const readyCount = active.filter((o)=>o.status==='ready').length;
      const paymentPending = active.filter((o)=>['pending','unpaid'].includes(String(o.paymentStatus||'')) || ['pending_online','pay_at_cashier'].includes(o.status)).length;
      main.innerHTML = `
        <div class="ops-page-head"><div><p class="eyebrow">Order Control</p><h1>سفارش‌ها</h1><p class="lead">سفارش‌های باز قبل از آرشیو و قدیمی‌ترین موارد باز زودتر نمایش داده می‌شوند. دکمه اصلی فقط مرحله مجاز بعدی را اجرا می‌کند.</p></div><a class="btn btn-sm btn-ghost" href="/order" target="_blank" rel="noopener">باز کردن checkout</a></div>
        <div class="cards cards-dense">
          <div class="card"><div class="num">${fmtNum(active.length)}</div><div class="lbl">باز / نیازمند پیگیری</div></div>
          <div class="card ${lateCount?'is-danger':''}"><div class="num">${fmtNum(lateCount)}</div><div class="lbl">بیش از ۲۰ دقیقه</div></div>
          <div class="card accent"><div class="num">${fmtNum(readyCount)}</div><div class="lbl">آماده تحویل</div></div>
          <div class="card ${paymentPending?'warn':''}"><div class="num">${fmtNum(paymentPending)}</div><div class="lbl">پرداخت نیازمند توجه</div></div>
        </div>
        <section class="admin-help-strip section-box"><strong>برای کاربر تازه‌کار:</strong><span>روی دکمه پررنگ هر کارت بزنید تا سفارش فقط یک مرحله مجاز جلو برود. منوی کشویی برای حالت‌های خاص و لغو است.</span></section>
        <section class="section-box ops-filters admin-filter-row">
          <label><span>جست‌وجو</span><input id="order-search" type="search" autocomplete="off" placeholder="شماره، نام، تلفن یا غذا…" /></label>
          <label><span>وضعیت</span><select id="order-status-filter"><option value="">همه</option>${['pending_online','awaiting_confirmation','pay_at_cashier','paid','preparing','ready','dispatched','picked_up','delivered','done','cancelled'].map((status)=>`<option value="${status}">${statusLabel(status)}</option>`).join('')}</select></label>
          <label><span>نوع تحویل</span><select id="order-fulfillment-filter"><option value="">همه</option><option value="dine_in">داخل مجموعه</option><option value="pickup">تحویل حضوری</option><option value="delivery">پیک</option></select></label>
          <label><span>پرداخت</span><select id="order-payment-filter"><option value="">همه</option><option value="paid">پرداخت‌شده</option><option value="pending">در انتظار</option><option value="unpaid">صندوق</option><option value="failed">ناموفق</option></select></label>
          <span class="ops-filter-count" id="order-filter-count">${fmtNum(orders.length)} سفارش</span>
        </section>
        <section class="ops-order-grid" id="ops-order-grid">
          ${orders.map((order)=>{
            const search=[order.id,order.orderNo,order.name,order.phone,order.tableNo,...(order.items||[]).map((i)=>i.name)].join(' ').toLowerCase();
            const history=(order.statusHistory||[]).slice().reverse();
            const payment=String(order.paymentStatus||({paid:'paid',preparing:'paid',ready:'paid',dispatched:'paid',picked_up:'paid',delivered:'paid',done:'paid'}[order.status]||'unpaid'));
            const paymentLabel={paid:'پرداخت‌شده',pending:'در انتظار پرداخت',unpaid:'پرداخت در صندوق',failed:'ناموفق',cancelled:'لغو شده',refunded:'بازپرداخت'}[payment]||'—';
            const fulfillment=order.fulfillment||(order.tableNo?'dine_in':'pickup');
            const urgency=orderUrgency(order); const next=primaryNextStatus(order);
            return `<article class="ops-order-card${urgency.className}" data-order-card="${order.id}" data-search="${esc(search)}" data-status="${esc(order.status)}" data-fulfillment="${esc(fulfillment)}" data-payment="${esc(payment)}">
              <header class="ops-order-card__head"><div><p>#${order.id}${order.orderNo?` · ${esc(order.orderNo)}`:''}</p><h2>${esc(order.name||'مهمان')}</h2><span>${esc(fulfillmentLabel(fulfillment))}${order.tableNo?` · میز ${esc(order.tableNo)}`:''}</span></div><div class="admin-order-state"><span class="ops-status ops-status--${esc(order.status)}">${esc(statusLabel(order.status))}</span><small class="admin-age-badge">${esc(urgency.label)}</small></div></header>
              <div class="ops-order-card__meta"><span>${fmtMoney(order.total)}</span><span>${esc(paymentLabel)}</span><span>${window.ShamsiCore ? window.ShamsiCore.formatShamsiDateTime(order.createdAt) : new Date(order.createdAt).toLocaleString('fa-IR')}</span></div>
              ${order.note?`<div class="admin-order-note"><b>یادداشت:</b> ${esc(order.note)}</div>`:''}
              <ul class="ops-order-items">${(order.items||[]).map((item)=>`<li><b>${fmtNum(item.qty)}×</b><span>${esc(item.name)}</span><em>${fmtMoney(item.lineTotal)}</em></li>`).join('')}</ul>
              <details class="ops-order-detail"><summary>جزئیات و تاریخچه</summary><div class="ops-order-detail__content"><p><b>تماس:</b> <span dir="ltr">${esc(order.phone||'—')}</span></p>${order.delivery?`<p><b>ارسال:</b> ${esc(order.delivery.zoneName||'')} · ${esc(order.delivery.address||'')}</p>`:''}<ol>${history.map((e)=>`<li>${esc(statusLabel(e.status))}<time>${e.at?(window.ShamsiCore ? window.ShamsiCore.formatShamsiDateTime(e.at) : new Date(e.at).toLocaleString('fa-IR')):''}</time></li>`).join('')||'<li>تاریخچه‌ای ثبت نشده است</li>'}</ol></div></details>
              <footer class="ops-order-card__actions">${next?`<button class="btn admin-primary-action" data-onext="${order.id}" data-next-status="${next}">${esc(primaryActionLabel(next))}</button>`:''}<label class="admin-secondary-select"><span>تغییر دستی وضعیت</span><select data-ostatus="${order.id}" ${nextStatusesForOrder(order).length<=1?'disabled':''}>${nextStatusesForOrder(order).map((status)=>`<option value="${status}" ${order.status===status?'selected':''}>${statusLabel(status)}</option>`).join('')}</select></label></footer>
            </article>`;
          }).join('')||'<p class="ops-empty">سفارشی ثبت نشده است.</p>'}
        </section>`;

      const filterOrders=()=>{ const q=String(document.getElementById('order-search')?.value||'').trim().toLowerCase(), status=document.getElementById('order-status-filter')?.value||'', fulfillment=document.getElementById('order-fulfillment-filter')?.value||'', payment=document.getElementById('order-payment-filter')?.value||''; let count=0; main.querySelectorAll('[data-order-card]').forEach((card)=>{const ok=(!q||card.dataset.search.includes(q))&&(!status||card.dataset.status===status)&&(!fulfillment||card.dataset.fulfillment===fulfillment)&&(!payment||card.dataset.payment===payment);card.hidden=!ok;if(ok)count++;}); const el=document.getElementById('order-filter-count');if(el)el.textContent=`${fmtNum(count)} سفارش`; };
      ['order-search','order-status-filter','order-fulfillment-filter','order-payment-filter'].forEach((id)=>document.getElementById(id)?.addEventListener(id==='order-search'?'input':'change',filterOrders));
      const changeStatus=async(id,status)=>api(`/api/v2/orders/${id}/status`,{method:'PATCH',body:JSON.stringify({status})});
      main.querySelectorAll('[data-onext]').forEach((b)=>b.addEventListener('click',()=>runBusy(b,async()=>{await changeStatus(b.dataset.onext,b.dataset.nextStatus);showToast('سفارش به مرحله بعد رفت','success',1400);await tabs.orders();}).catch((e)=>showToast(e.message,'error'))));
      main.querySelectorAll('[data-ostatus]').forEach((sel)=>sel.addEventListener('change',async()=>{ const status=sel.value;if(status==='cancelled'&&!window.confirm('این سفارش لغو شود؟ این اقدام در تاریخچه ثبت می‌شود.')){await tabs.orders();return;} sel.disabled=true;try{await changeStatus(sel.dataset.ostatus,status);showToast('وضعیت سفارش به‌روز شد','success',1400);await tabs.orders();}catch(e){showToast(e.message,'error');sel.disabled=false;} }));
      const focused=sessionStorage.getItem('westo_admin_focus_order');if(focused){sessionStorage.removeItem('westo_admin_focus_order');const card=main.querySelector(`[data-order-card="${CSS.escape(focused)}"]`);if(card){card.classList.add('is-focused');card.scrollIntoView({behavior:'smooth',block:'center'});card.querySelector('button,select')?.focus({preventScroll:true});}}
    },

    async delivery() {
      setActiveTab('delivery');
      const [zoneData, paymentData] = await Promise.all([
        api(`/api/admin/delivery-zones${branchQs()}`),
        api(`/api/admin/payments${branchQs()}`),
      ]);
      const zones = zoneData.zones || [];
      const payments = paymentData.payments || [];
      main.innerHTML = `
        <div class="ops-page-head">
          <div><p class="eyebrow">عملیات تحویل</p><h1>پیک، تحویل و پرداخت</h1><p class="lead">هزینه و حداقل سفارش هر محدوده در همین شعبه کنترل می‌شود. پرداخت آنلاین فعلاً در حالت ${esc(paymentData.provider?.mode || 'sandbox')} است.</p></div>
          <a class="btn btn-sm btn-ghost" href="/order" target="_blank" rel="noopener">پیش‌نمایش checkout</a>
        </div>
        <section class="section-box">
          <div class="ops-panel__head"><div><p class="eyebrow">محدوده‌های ارسال</p><h2>قیمت‌گذاری پیک بر اساس محدوده</h2></div><span class="hint">شعبهٔ فعال: ${esc(currentBranch()?.name || '—')}</span></div>
          <div class="delivery-zone-grid">
            ${zones.map((zone) => `<article class="delivery-zone-card" data-zone="${zone.id}">
              <header><strong>${esc(zone.name)}</strong><label class="switch"><input type="checkbox" data-zone-active ${zone.active !== false ? 'checked' : ''} /><span>فعال</span></label></header>
              <div class="grid-3">
                ${field('نام محدوده', `zone-${zone.id}-name`, zone.name)}
                ${field('حداقل سفارش (تومان)', `zone-${zone.id}-minimum`, String(zone.minOrder || 0), { ltr: true, type: 'number' })}
                ${field('هزینه ارسال (تومان)', `zone-${zone.id}-fee`, String(zone.fee || 0), { ltr: true, type: 'number' })}
                ${field('ETA (دقیقه)', `zone-${zone.id}-eta`, String(zone.etaMinutes || 0), { ltr: true, type: 'number' })}
              </div>
              <div class="row-actions"><button class="btn btn-sm" data-zone-save="${zone.id}">ذخیره محدوده</button><button class="btn btn-sm btn-danger" data-zone-delete="${zone.id}">حذف</button></div>
            </article>`).join('') || '<p class="ops-empty">برای این شعبه هنوز محدوده‌ای تعریف نشده است.</p>'}
          </div>
          <details class="delivery-zone-new"><summary>افزودن محدوده جدید</summary>
            <div class="grid-3">
              ${field('نام محدوده', 'new-zone-name', '')}
              ${field('حداقل سفارش (تومان)', 'new-zone-minimum', '0', { ltr: true, type: 'number' })}
              ${field('هزینه ارسال (تومان)', 'new-zone-fee', '0', { ltr: true, type: 'number' })}
              ${field('ETA (دقیقه)', 'new-zone-eta', '30', { ltr: true, type: 'number' })}
            </div>
            <button class="btn btn-sm" id="new-zone-save">افزودن محدوده</button>
          </details>
        </section>
        <section class="section-box">
          <div class="ops-panel__head"><div><p class="eyebrow">پرداخت</p><h2>آخرین تلاش‌های پرداخت</h2></div><span class="ops-provider-pill">${esc(paymentData.provider?.provider || 'sandbox')} · ${esc(paymentData.provider?.mode || 'sandbox')}</span></div>
          <div class="payment-list">
            ${payments.map((payment) => `<div class="payment-row"><div><b>#${payment.id} · سفارش #${payment.orderId}</b><span>${fmtDateTime(payment.createdAt)}</span></div><strong>${fmtMoney(payment.amount)}</strong><em class="ops-status ops-status--${esc(payment.status)}">${esc({ pending: 'در انتظار', paid: 'موفق', failed: 'ناموفق', cancelled: 'لغو', refunded: 'بازپرداخت' }[payment.status] || payment.status)}</em></div>`).join('') || '<p class="ops-empty">تلاش پرداختی وجود ندارد.</p>'}
          </div>
        </section>`;

      const updateZone = async (id, patch) => {
        await api(`/api/admin/delivery-zones/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
        showToast('محدوده ارسال ذخیره شد');
        tabs.delivery().catch((error) => showToast(error.message));
      };
      main.querySelectorAll('[data-zone-save]').forEach((button) => {
        button.addEventListener('click', () => {
          const id = button.dataset.zoneSave;
          updateZone(id, {
            name: document.getElementById(`zone-${id}-name`).value,
            minOrder: Number(document.getElementById(`zone-${id}-minimum`).value) || 0,
            fee: Number(document.getElementById(`zone-${id}-fee`).value) || 0,
            etaMinutes: Number(document.getElementById(`zone-${id}-eta`).value) || 0,
            active: main.querySelector(`[data-zone="${id}"] [data-zone-active]`).checked,
          }).catch((error) => showToast(error.message));
        });
      });
      main.querySelectorAll('[data-zone-active]').forEach((input) => {
        input.addEventListener('change', () => {
          const id = input.closest('[data-zone]')?.dataset.zone;
          if (id) updateZone(id, { active: input.checked }).catch((error) => showToast(error.message));
        });
      });
      main.querySelectorAll('[data-zone-delete]').forEach((button) => {
        button.addEventListener('click', async () => {
          if (!window.confirm('این محدوده حذف شود؟')) return;
          await api(`/api/admin/delivery-zones/${button.dataset.zoneDelete}`, { method: 'DELETE' });
          showToast('محدوده حذف شد');
          tabs.delivery().catch((error) => showToast(error.message));
        });
      });
      document.getElementById('new-zone-save')?.addEventListener('click', async () => {
        await api('/api/admin/delivery-zones', {
          method: 'POST',
          body: JSON.stringify({
            branchId: currentBranchId,
            name: document.getElementById('new-zone-name').value,
            minOrder: Number(document.getElementById('new-zone-minimum').value) || 0,
            fee: Number(document.getElementById('new-zone-fee').value) || 0,
            etaMinutes: Number(document.getElementById('new-zone-eta').value) || 0,
          }),
        });
        showToast('محدوده جدید اضافه شد');
        tabs.delivery().catch((error) => showToast(error.message));
      });
    },

    async faq() {
      setActiveTab('faq');
      main.innerHTML = `
        <h1>سؤالات متداول</h1>
        ${state.faq
          .map(
            (f, i) => `
          <div class="section-box" data-fid="${f.id}">
            <h2>سؤال ${i + 1}</h2>
            ${field('سؤال', `f${f.id}_q`, f.q)}
            ${field('پاسخ', `f${f.id}_a`, f.a, { textarea: true })}
            <div class="row-actions">
              <span class="hint">ذخیره خودکار</span>
              <button class="btn btn-sm btn-ghost" data-fup="${f.id}" ${i === 0 ? 'disabled' : ''}>بالا</button>
              <button class="btn btn-sm btn-ghost" data-fdown="${f.id}" ${i === state.faq.length - 1 ? 'disabled' : ''}>پایین</button>
              <button class="btn btn-sm btn-danger" data-fdel="${f.id}">حذف</button>
            </div>
          </div>`
          )
          .join('')}
        <div class="section-box">
          <h2>افزودن سؤال جدید</h2>
          ${field('سؤال', 'new_q', '')}
          ${field('پاسخ', 'new_a', '', { textarea: true })}
          <button class="btn btn-sm" id="f-add">افزودن</button>
        </div>`;

      state.faq.forEach((f) => {
        const saveFaq = async () => {
          const d = await api(`/api/faq/${f.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              q: document.getElementById(`f${f.id}_q`).value,
              a: document.getElementById(`f${f.id}_a`).value,
            }),
          });
          const item = state.faq.find((x) => x.id === f.id);
          if (item) Object.assign(item, d.item);
        };
        bindAutosave(main.querySelector(`[data-fid="${f.id}"]`), saveFaq);
      });
      main.querySelectorAll('[data-fdel]').forEach((b) =>
        b.addEventListener('click', async () => {
          if (!confirm('این سؤال حذف شود؟')) return;
          await api(`/api/faq/${b.dataset.fdel}`, { method: 'DELETE' });
          state.faq = state.faq.filter((f) => f.id !== Number(b.dataset.fdel));
          showToast('حذف شد');
          tabs.faq();
        })
      );
      const move = async (id, dir) => {
        const ids = state.faq.map((f) => f.id);
        const i = ids.indexOf(Number(id));
        const j = i + dir;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        const d = await api('/api/faq-order', { method: 'PUT', body: JSON.stringify({ order: ids }) });
        state.faq = d.faq;
        tabs.faq();
      };
      main.querySelectorAll('[data-fup]').forEach((b) => b.addEventListener('click', () => move(b.dataset.fup, -1)));
      main.querySelectorAll('[data-fdown]').forEach((b) => b.addEventListener('click', () => move(b.dataset.fdown, 1)));
      document.getElementById('f-add').addEventListener('click', async () => {
        const q = document.getElementById('new_q').value.trim();
        const a = document.getElementById('new_a').value.trim();
        if (!q) return showToast('متن سؤال را وارد کنید');
        const d = await api('/api/faq', { method: 'POST', body: JSON.stringify({ q, a }) });
        state.faq.push(d.item);
        showToast('اضافه شد');
        tabs.faq();
      });
    },

    async users() {
      setActiveTab('users');
      const d = await api('/api/admin/users');
      const roles = { owner: 'مالک', manager: 'مدیر', cashier: 'صندوق', waiter: 'گارسون', kitchen: 'آشپزخانه', guest: 'مهمان' };
      main.innerHTML = `
        <h1>کاربران و باشگاه مشتریان</h1>
        <div class="section-box">
          <div class="field"><input id="user-search" placeholder="جستجوی شماره یا نام…" /></div>
          <table class="tbl"><thead><tr><th>شماره</th><th>نام</th><th>امتیاز</th><th>نقش</th><th>آخرین ورود</th><th></th></tr></thead>
          <tbody id="users-body"></tbody></table>
        </div>`;

      const body = document.getElementById('users-body');
      const render = (list) => {
        body.innerHTML =
          list
            .map(
              (u) => `
          <tr>
            <td class="ltr">${esc(u.phone)}</td>
            <td>${esc(u.name) || '—'}</td>
            <td>${fmtNum(u.points || 0)}</td>
            <td><select data-role="${esc(u.phone)}">${Object.entries(roles).map(([role, label]) => `<option value="${role}" ${u.role === role ? 'selected' : ''}>${label}</option>`).join('')}</select> ${u.blocked ? '<span class="pill blocked">مسدود</span>' : ''}</td>
            <td>${fmtDateTime(u.lastLoginAt)}</td>
            <td><div class="row-actions">
              <button class="btn btn-sm btn-ghost" data-block="${esc(u.phone)}" data-val="${!u.blocked}">${u.blocked ? 'رفع مسدودی' : 'مسدود'}</button>
              <button class="btn btn-sm btn-danger" data-del="${esc(u.phone)}">حذف</button>
            </div></td>
          </tr>`
            )
            .join('') || '<tr><td colspan="6">کاربری یافت نشد</td></tr>';

        body.querySelectorAll('[data-block]').forEach((b) =>
          b.addEventListener('click', async () => {
            await api(`/api/admin/users/${b.dataset.block}`, { method: 'PATCH', body: JSON.stringify({ blocked: b.dataset.val === 'true' }) });
            tabs.users();
          })
        );
        body.querySelectorAll('[data-role]').forEach((b) =>
          b.addEventListener('change', async () => {
            await api(`/api/admin/users/${b.dataset.role}`, { method: 'PATCH', body: JSON.stringify({ role: b.value }) });
            tabs.users();
          })
        );
        body.querySelectorAll('[data-del]').forEach((b) =>
          b.addEventListener('click', async () => {
            if (!confirm(`کاربر ${b.dataset.del} حذف شود؟`)) return;
            await api(`/api/admin/users/${b.dataset.del}`, { method: 'DELETE' });
            tabs.users();
          })
        );
      };
      render(d.users);
      document.getElementById('user-search').addEventListener('input', (e) => {
        const q = e.target.value.trim();
        render(d.users.filter((u) => u.phone.includes(q) || (u.name || '').includes(q)));
      });
    },

    async club() {
      setActiveTab('club');
      const d = await api(`/api/admin/v2/crm${branchQs()}`);
      const customers = d.customers || [];
      const segment = (customer) => customer.total >= 5000000 || customer.orders >= 8 ? 'VIP' : customer.orders >= 3 ? 'وفادار' : customer.orders === 1 ? 'جدید' : 'عادی';
      main.innerHTML = `
        <div class="ops-page-head">
          <div><p class="eyebrow">CRM · LOYALTY · MARKETING</p><h1>باشگاه مشتریان</h1><p class="lead">مشتریان، وفاداری، بازاریابی، بازخورد و خبرنامه در یک زبانه و با ظاهر WESTO مدیریت می‌شوند.</p></div>
        </div>
        <div class="cards">
          <div class="card accent"><div class="num">${fmtNum(d.summary?.customers || 0)}</div><div class="lbl">مشتری شناسایی‌شده</div></div>
          <div class="card"><div class="num">${fmtNum(d.summary?.points || 0)}</div><div class="lbl">امتیاز در گردش</div></div>
          <div class="card ${d.summary?.newFeedback ? 'warn' : ''}"><div class="num">${fmtNum(d.summary?.newFeedback || 0)}</div><div class="lbl">بازخورد جدید</div></div>
          <div class="card"><div class="num">${fmtNum(d.summary?.newsletter || 0)}</div><div class="lbl">عضو خبرنامه</div></div>
        </div>
        <div class="section-box">
          <div class="row-actions">
            <button class="btn btn-sm" data-club-section="loyalty">تنظیمات وفاداری</button>
            <button class="btn btn-sm btn-ghost" data-club-section="feedback">بازخورد و NPS</button>
            <button class="btn btn-sm btn-ghost" data-club-section="newsletter">خبرنامه و خروجی</button>
          </div>
        </div>
        <div class="grid-2-main">
          <section class="section-box">
            <h2>پرونده مشتریان</h2>
            <table class="tbl"><thead><tr><th>مشتری</th><th>بخش</th><th>سفارش</th><th>خرید</th><th>امتیاز</th></tr></thead><tbody>
              ${customers.slice(0, 40).map((customer) => `<tr><td>${esc(customer.name || customer.phone)}<div class="hint ltr">${esc(customer.phone)}</div></td><td><span class="pill">${segment(customer)}</span></td><td>${fmtNum(customer.orders)}</td><td>${fmtMoney(customer.total)}</td><td>${fmtNum(customer.points)}</td></tr>`).join('') || '<tr><td colspan="5">هنوز مشتری قابل شناسایی ثبت نشده است.</td></tr>'}
            </tbody></table>
          </section>
          <section class="section-box">
            <h2>بازاریابی و ارتباط</h2>
            <p class="hint">بخش‌بندی بر پایه تعداد سفارش و ارزش خرید واقعی WESTO انجام می‌شود.</p>
            ${['VIP', 'وفادار', 'جدید', 'عادی'].map((name) => `<div class="ops-alert"><b>${name}</b><span>${fmtNum(customers.filter((customer) => segment(customer) === name).length)} مشتری</span></div>`).join('')}
            <h3 style="margin-top:1rem">آخرین بازخوردها</h3>
            ${(d.feedback || []).slice(0, 5).map((item) => `<div class="ops-alert ${item.score <= 6 ? 'is-warn' : ''}"><b>${esc(item.name || item.phone || 'مهمان')} · ${fmtNum(item.score)}/۱۰</b><span>${esc(item.comment || 'بدون توضیح')}</span></div>`).join('') || '<p class="hint">بازخوردی ثبت نشده است.</p>'}
          </section>
        </div>`;
      main.querySelectorAll('[data-club-section]').forEach((button) => button.addEventListener('click', async () => {
        const target = button.dataset.clubSection;
        await tabs[target]();
        setActiveTab('club');
      }));
    },

    async loyalty() {
      setActiveTab('loyalty');
      const d = await api('/api/admin/loyalty');
      const L = d.loyalty || {};
      main.innerHTML = `
        <h1>باشگاه مشتریان</h1>
        <p class="lead">امتیاز وفاداری — مشابه باشگاه مشتریان تاپ منو مارکت. با تکمیل سفارش امتیاز می‌گیرند.</p>
        <div class="cards">
          <div class="card accent"><div class="num">${fmtNum(d.totals?.pointsIssued || 0)}</div><div class="lbl">امتیاز در گردش</div></div>
          <div class="card"><div class="num">${fmtNum(d.totals?.members || 0)}</div><div class="lbl">عضو با امتیاز</div></div>
          <div class="card"><div class="num">${L.enabled ? 'فعال' : 'خاموش'}</div><div class="lbl">وضعیت باشگاه</div></div>
        </div>
        <div class="section-box">
          <h2>تنظیمات امتیاز</h2>
          <div class="grid-2">
            <div class="field"><label class="chk"><input type="checkbox" id="ly_en" ${L.enabled ? 'checked' : ''} /> باشگاه فعال باشد</label></div>
            ${field('امتیاز به ازای هر تومان (مثلاً ۰٫۰۱ = ۱ امتیاز / ۱۰۰ تومان)', 'ly_rate', String(L.pointsPerToman ?? 0.01), { ltr: true, type: 'number' })}
            ${field('ارزش هر امتیاز (تومان — نمایشی)', 'ly_val', String(L.redeemValue ?? 1000), { ltr: true, type: 'number' })}
            ${field('امتیاز خوش‌آمدگویی', 'ly_welcome', String(L.welcomePoints ?? 50), { ltr: true, type: 'number' })}
          </div>
          <p class="hint" style="margin-top:0.75rem">ذخیره خودکار</p>
        </div>
        <div class="section-box">
          <h2>تعدیل دستی امتیاز</h2>
          <div class="grid-2">
            ${field('شماره موبایل', 'ly_phone', '', { ltr: true })}
            ${field('مقدار (+/−)', 'ly_delta', '10', { ltr: true, type: 'number' })}
            ${field('دلیل', 'ly_reason', 'جایزه دستی')}
          </div>
          <button class="btn btn-sm" id="ly-adj">اعمال</button>
        </div>
        <div class="grid-2-main">
          <div class="section-box">
            <h2>رتبه‌بندی اعضا</h2>
            <table class="tbl"><thead><tr><th>#</th><th>شماره</th><th>نام</th><th>امتیاز</th></tr></thead><tbody>
              ${(d.members || [])
                .slice(0, 30)
                .map(
                  (m, i) =>
                    `<tr><td>${i + 1}</td><td class="ltr">${esc(m.phone)}</td><td>${esc(m.name) || '—'}</td><td>${fmtNum(m.points)}</td></tr>`
                )
                .join('') || '<tr><td colspan="4">عضوی نیست</td></tr>'}
            </tbody></table>
          </div>
          <div class="section-box">
            <h2>آخرین تراکنش‌ها</h2>
            <table class="tbl"><thead><tr><th>زمان</th><th>شماره</th><th>Δ</th><th>دلیل</th></tr></thead><tbody>
              ${(d.ledger || [])
                .map(
                  (e) =>
                    `<tr><td>${fmtDateTime(e.at)}</td><td class="ltr">${esc(e.phone)}</td><td>${e.delta > 0 ? '+' : ''}${fmtNum(e.delta)}</td><td>${esc(e.reason)}</td></tr>`
                )
                .join('') || '<tr><td colspan="4">—</td></tr>'}
            </tbody></table>
          </div>
        </div>`;

      const saveLoyalty = async () => {
        await api('/api/admin/settings', {
          method: 'PUT',
          body: JSON.stringify({
            loyalty: {
              enabled: document.getElementById('ly_en').checked,
              pointsPerToman: Number(document.getElementById('ly_rate').value) || 0,
              redeemValue: Number(document.getElementById('ly_val').value) || 0,
              welcomePoints: Number(document.getElementById('ly_welcome').value) || 0,
            },
          }),
        });
      };
      bindAutosave(main.querySelector('.section-box'), saveLoyalty);
      document.getElementById('ly-adj').addEventListener('click', async () => {
        await api('/api/admin/loyalty/adjust', {
          method: 'POST',
          body: JSON.stringify({
            phone: document.getElementById('ly_phone').value,
            delta: Number(document.getElementById('ly_delta').value) || 0,
            reason: document.getElementById('ly_reason').value,
          }),
        });
        showToast('امتیاز به‌روز شد');
        tabs.loyalty();
      });
    },

    async finance() {
      return tabs.accounting();
    },

    async accounting() {
      setActiveTab('accounting');
      if (typeof window.renderAccountingWorkspace === 'function') {
        await window.renderAccountingWorkspace(main, branchQs());
      } else {
        main.innerHTML = '<h1>حسابداری</h1><p class="lead">ماژول حسابداری در حال بارگذاری…</p>';
      }
    },
    async neem() {
      setActiveTab('neem');
      const d = await api('/api/admin/neem-integration');
      const sync = d.integration || {};
      const hasError = !!sync.lastError || (sync.recentFailures || []).length > 0;
      main.innerHTML = `
        <h1>اتصال NEEM</h1>
        <p class="lead">منوی عمومی، checkout و تجربهٔ سه‌بعدی WESTO جدا می‌مانند. سفارش، پرداخت، مشتری و امتیاز وفاداری در پس‌زمینه با NEEM همگام می‌شوند تا مالی، CRM و باشگاه مشتریان کامل در دسترس باشد.</p>
        <div class="cards">
          <div class="card ${sync.enabled ? 'accent' : 'warn'}"><div class="num">${sync.enabled ? 'فعال' : 'متوقف'}</div><div class="lbl">وضعیت اتصال</div></div>
          <div class="card ${Number(sync.queued || 0) ? 'warn' : ''}"><div class="num">${fmtNum(sync.queued || 0)}</div><div class="lbl">رویداد در صف</div></div>
          <div class="card"><div class="num">${fmtNum(sync.deliveredRetained || 0)}</div><div class="lbl">ارسال‌های ثبت‌شده</div></div>
          <div class="card ${hasError ? 'danger' : ''}"><div class="num">${hasError ? 'نیازمند پیگیری' : 'سالم'}</div><div class="lbl">آخرین وضعیت</div></div>
        </div>
        <div class="section-box">
          <h2>عملیات</h2>
          <p class="hint">سفارش‌های جدید خودکار همگام می‌شوند و ثبت سفارش مشتری را معطل نمی‌کنند. همگام‌سازی اولیه فقط برای وارد کردن سفارش‌های قبلی WESTO است.</p>
          <div class="row-actions" style="margin-top:0.9rem">
            <button class="btn btn-sm" id="neem-open">باز کردن پنل مالی و CRM</button>
            <button class="btn btn-sm btn-ghost" id="neem-retry">ارسال دوبارهٔ صف</button>
            <button class="btn btn-sm btn-ghost" id="neem-backfill">همگام‌سازی سفارش‌های قبلی</button>
          </div>
        </div>
        <div class="section-box">
          <h2>گزارش اتصال</h2>
          <div class="grid-2">
            <div><b>آخرین ارسال موفق</b><p class="hint">${sync.lastSuccessAt ? fmtDateTime(sync.lastSuccessAt) : 'هنوز ارسالی ثبت نشده است'}</p></div>
            <div><b>وضعیت سرویس</b><p class="hint ltr">${esc(sync.endpoint || '—')}</p></div>
          </div>
          ${hasError ? `<div class="ops-alert is-warn"><b>پیام اتصال</b><span>${esc(sync.lastError || sync.recentFailures?.[0]?.error || 'خطای نامشخص')}</span></div>` : '<p class="hint">همگام‌سازی بدون خطای ثبت‌شده است.</p>'}
        </div>`;

      document.getElementById('neem-open').addEventListener('click', () => { window.open('/ops', '_blank', 'noopener'); });
      document.getElementById('neem-retry').addEventListener('click', async () => {
        await api('/api/admin/neem-integration/retry', { method: 'POST' });
        showToast('ارسال دوبارهٔ صف شروع شد', 'success');
        setTimeout(() => tabs.neem().catch((error) => showToast(error.message)), 350);
      });
      document.getElementById('neem-backfill').addEventListener('click', async () => {
        if (!confirm('سفارش‌های قبلی WESTO برای ساخت گزارش و حسابداری به NEEM فرستاده شوند؟ این کار در پس‌زمینه انجام می‌شود.')) return;
        const result = await api('/api/admin/neem-integration/backfill', { method: 'POST' });
        showToast(`${fmtNum(result.queued || 0)} سفارش به صف همگام‌سازی اضافه شد`, 'success', 4200);
        tabs.neem();
      });
    },

    async feedback() {
      setActiveTab('feedback');
      const d = await api(`/api/admin/feedback${branchQs('days=30')}`);
      const st = d.stats || {};
      const s = d.settings || {};
      const bucketLabel = { promoter: 'مروج', passive: 'خنثی', detractor: 'منتقد' };
      const statusLabel = { new: 'جدید', reviewed: 'بررسی‌شده', archived: 'بایگانی' };
      const branchName = (id) => branchesCache.find((b) => b.id === id)?.name || (id ? `#${id}` : '—');
      main.innerHTML = `
        <h1>بازخورد و NPS</h1>
        <p class="lead">امتیاز پیشنهاد به دوستان (۰–۱۰) — صفحه عمومی <a href="/feedback" target="_blank" rel="noopener">/feedback</a></p>
        <div class="cards">
          <div class="card accent"><div class="num">${st.nps == null ? '—' : fmtNum(st.nps)}</div><div class="lbl">NPS ${d.days || 30} روز</div></div>
          <div class="card"><div class="num">${fmtNum(st.count || 0)}</div><div class="lbl">پاسخ</div></div>
          <div class="card"><div class="num">${fmtNum(st.promoters || 0)}</div><div class="lbl">مروج (۹–۱۰)</div></div>
          <div class="card warn"><div class="num">${fmtNum(st.detractors || 0)}</div><div class="lbl">منتقد (۰–۶)</div></div>
          <div class="card"><div class="num">${st.avg == null ? '—' : st.avg.toFixed(1)}</div><div class="lbl">میانگین امتیاز</div></div>
        </div>
        <div class="section-box">
          <h2>تنظیمات</h2>
          <div class="grid-2">
            <label class="chk" style="display:flex;align-items:center;gap:0.4rem;"><input type="checkbox" id="fb_en" ${s.enabled !== false ? 'checked' : ''} /> بازخورد فعال</label>
            <label class="chk" style="display:flex;align-items:center;gap:0.4rem;"><input type="checkbox" id="fb_ord" ${s.askAfterOrder !== false ? 'checked' : ''} /> پیشنهاد پس از سفارش</label>
            ${field('عنوان صفحه', 'fb_title', s.title || '')}
            ${field('توضیح', 'fb_sub', s.subtitle || '', { textarea: true })}
            ${field('پیام تشکر', 'fb_ty', s.thankYou || '')}
          </div>
          <p class="hint" style="margin-top:0.75rem">ذخیره خودکار</p>
        </div>
        <div class="section-box">
          <h2>آخرین بازخوردها</h2>
          <table class="tbl"><thead><tr><th>#</th><th>امتیاز</th><th>دسته</th><th>نظر</th><th>شعبه</th><th>زمان</th><th>وضعیت</th></tr></thead>
          <tbody>
            ${(d.feedback || [])
              .map(
                (f) => `<tr>
                  <td>${f.id}</td>
                  <td class="ltr"><strong>${f.score}</strong></td>
                  <td>${bucketLabel[f.bucket] || f.bucket}</td>
                  <td>${esc(f.comment) || '—'} ${f.name ? `<div class="hint">${esc(f.name)} · <span class="ltr">${esc(f.phone || '')}</span></div>` : ''}</td>
                  <td>${esc(branchName(f.branchId))}</td>
                  <td>${fmtDateTime(f.createdAt)}</td>
                  <td>
                    <select data-fbstatus="${f.id}">
                      ${Object.keys(statusLabel)
                        .map((k) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${statusLabel[k]}</option>`)
                        .join('')}
                    </select>
                  </td>
                </tr>`
              )
              .join('') || '<tr><td colspan="7">هنوز بازخوردی ثبت نشده</td></tr>'}
          </tbody></table>
        </div>`;

      const saveFb = async () => {
        await api('/api/admin/feedback/settings', {
          method: 'PUT',
          body: JSON.stringify({
            settings: {
              enabled: document.getElementById('fb_en').checked,
              askAfterOrder: document.getElementById('fb_ord').checked,
              title: document.getElementById('fb_title').value,
              subtitle: document.getElementById('fb_sub').value,
              thankYou: document.getElementById('fb_ty').value,
            },
          }),
        });
      };
      bindAutosave(main.querySelector('.section-box'), saveFb);
      main.querySelectorAll('[data-fbstatus]').forEach((sel) => {
        sel.addEventListener('change', async () => {
          await api(`/api/admin/feedback/${sel.dataset.fbstatus}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: sel.value }),
          });
          showToast('وضعیت به‌روز شد');
        });
      });
    },

    async newsletter() {
      setActiveTab('newsletter');
      const d = await api('/api/admin/newsletter');
      main.innerHTML = `
        <h1>خبرنامه</h1>
        <div class="section-box">
          <h2>${d.newsletter.length} ایمیل ثبت‌شده <small><a href="#" id="csv-link">خروجی CSV</a></small></h2>
          <table class="tbl"><thead><tr><th>ایمیل</th><th>تاریخ ثبت</th></tr></thead><tbody>
            ${d.newsletter.map((n) => `<tr><td class="ltr">${esc(n.email)}</td><td>${fmtDateTime(n.at)}</td></tr>`).join('') || '<tr><td colspan="2">هنوز ایمیلی ثبت نشده است</td></tr>'}
          </tbody></table>
        </div>`;
      document.getElementById('csv-link').addEventListener('click', (e) => {
        e.preventDefault();
        const csv = 'email,date\n' + d.newsletter.map((n) => `${n.email},${n.at}`).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = 'newsletter.csv';
        a.click();
      });
    },

    async settings() {
      setActiveTab('settings');
      let d = await api('/api/admin/v2/settings');
      let activeCategory = 'restaurant';
      const relatedTab = { restaurant: 'restaurant', branches: 'branches', users: 'users', orders: 'orders', tables: 'tables', kitchen: 'kitchen', menu: 'menu', appearance: 'theme', logs: 'dashboard' };

      const render = () => {
        const current = (d.categories || []).find((item) => item.id === activeCategory) || d.categories?.[0];
        if (!current) return;
        main.innerHTML = `
          <div class="ops-page-head"><div><p class="eyebrow">SETTINGS · WESTO</p><h1>تنظیمات مجموعه</h1><p class="lead">تنظیمات عملیاتی در یک فضای شفاف و بخش‌بندی‌شده، با همان UI پنل WESTO.</p></div></div>
          <div class="grid-2-main admin-settings-layout">
            <aside class="section-box admin-settings-nav" aria-label="دسته‌های تنظیمات">
              ${(d.categories || []).map((item) => `<button type="button" class="admin-nav-item ${item.id === current.id ? 'active' : ''}" data-setting-category="${esc(item.id)}"><b>${esc(item.label)}</b><small>${esc(item.description)}</small></button>`).join('')}
            </aside>
            <section class="section-box">
              <p class="eyebrow">${esc(current.label)}</p><h2>${esc(current.label)}</h2><p class="hint">${esc(current.description)}</p>
              <form id="settings-v2-form">
                ${(current.fields || []).map((item) => field(item.label, `sv2_${item.key}`, item.value ?? '', { ltr: item.dir === 'ltr', type: item.type || 'text' })).join('')}
                <div class="row-actions" style="margin-top:1rem">
                  <button class="btn btn-sm" type="submit">ذخیره تغییرات</button>
                  ${relatedTab[current.id] ? `<button class="btn btn-sm btn-ghost" type="button" id="settings-open-related">باز کردن مدیریت کامل</button>` : ''}
                </div>
              </form>
            </section>
          </div>`;

        main.querySelectorAll('[data-setting-category]').forEach((button) => button.addEventListener('click', () => { activeCategory = button.dataset.settingCategory; render(); }));
        document.getElementById('settings-open-related')?.addEventListener('click', () => tabs[relatedTab[current.id]]?.().catch((error) => showToast(error.message)));
        document.getElementById('settings-v2-form').addEventListener('submit', async (event) => {
          event.preventDefault();
          const values = Object.fromEntries((current.fields || []).map((item) => [item.key, document.getElementById(`sv2_${item.key}`).value]));
          const result = await api('/api/admin/v2/settings', { method: 'PATCH', body: JSON.stringify({ category: current.id, values }) });
          d = result.settings;
          showToast('تنظیمات ذخیره شد', 'success');
          render();
        });
      };
      render();
    },
  };

  function openCommandPalette() {
    const dialog = document.getElementById('admin-command-palette');
    const search = document.getElementById('admin-command-search');
    if (!dialog?.showModal) return;
    dialog.showModal();
    search.value = '';
    search.dispatchEvent(new Event('input'));
    setTimeout(() => search.focus(), 0);
  }

  function initCommandPalette() {
    const dialog = document.getElementById('admin-command-palette');
    const search = document.getElementById('admin-command-search');
    const results = document.getElementById('admin-command-results');
    const trigger = document.getElementById('admin-command-trigger');
    if (!dialog || !search || !results) return;
    const actions = [
      ...Object.keys(TAB_TITLES).map((tab) => ({ id: `tab:${tab}`, label: TAB_TITLES[tab], hint: 'باز کردن بخش', tab, capability: TAB_CAPABILITIES[tab] })),
      { id: 'checkout', label: 'باز کردن سفارش بیرون‌بر', hint: '/order', href: '/order', capability: 'orders.view' },
    ].map((action) => ({ ...action, searchText: `${action.label} ${action.hint}`.toLowerCase() }));
    const actionById = new Map(actions.map((action) => [action.id, action]));
    const paint = () => {
      const q = String(search.value || '').trim().toLowerCase();
      const visible = actions.filter((action) => (!action.capability || hasCapability(action.capability)) && (!q || action.searchText.includes(q)));
      results.innerHTML = visible.map((action) => `<button type="button" class="admin-command-result" data-command="${esc(action.id)}"><b>${esc(action.label)}</b><span>${esc(action.hint)}</span></button>`).join('') || '<p class="ops-empty">نتیجه‌ای پیدا نشد.</p>';
    };
    trigger?.addEventListener('click', openCommandPalette);
    search.addEventListener('input', paint);
    results.addEventListener('click', (event) => {
      const button = event.target.closest('[data-command]');
      if (!button || !results.contains(button)) return;
      const action = actionById.get(button.dataset.command);
      if (!action) return;
      dialog.close();
      if (action.href) window.open(action.href, '_blank', 'noopener');
      else if (action.tab) tabs[action.tab]?.().catch((error) => showToast(error.message));
    });
    dialog.addEventListener('close', () => { search.value = ''; });
    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (dialog.open) dialog.close();
        else openCommandPalette();
      }
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
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && document.body.classList.contains('sidebar-open')) closeSidebar(); });
    const workspaceObserver = new MutationObserver(scheduleWorkspaceEnhance);
    workspaceObserver.observe(main, { childList: true, subtree: true });
    scheduleWorkspaceEnhance();
    document.querySelectorAll('.admin-nav-item[data-tab]').forEach((button) => {
      button.addEventListener('click', () => tabs[button.dataset.tab]?.().catch((error) => showToast(error.message)));
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
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      location.href = '/';
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
    initCommandPalette();
  }

  async function boot() {
    let session;
    try {
      session = await api('/api/admin/session');
      currentUser = session.user;
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
    initShell();
    initRolePreview();
    window.addEventListener('westo:theme-change', () => {
      if (lastBrandTheme) applyTheme(lastBrandTheme);
    });
    startCommandCenterStream();
    const requestedTab = String(location.hash || '').replace(/^#/, '') === 'finance' ? 'accounting' : String(location.hash || '').replace(/^#/, '');
    const initialTab = currentUserRole === 'kitchen'
      ? 'kitchen'
      : (tabs[requestedTab] && hasCapability(TAB_CAPABILITIES[requestedTab])) ? requestedTab : 'dashboard';
    tabs[initialTab]().catch((error) => {
      showToast(error.message);
      renderWorkspaceError(error, initialTab);
    });
  }

  boot();
})();
