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
    users: 'تفکیک پرسنل، مشتریان باشگاه و مدیریت ماتریس دسترسی‌ها', loyalty: 'تنظیم و مانده باشگاه مشتریان', club: 'مشتریان، وفاداری، بازاریابی، بازخورد و خبرنامه', feedback: 'بازخوردها و رضایت مهمان', newsletter: 'عضویت‌های خبرنامه', settings: 'تنظیمات شفاف و بخش‌بندی‌شده مجموعه', delivery: 'محدوده ارسال، پیک و وضعیت پرداخت', finance: 'مسیر قدیمی مالی؛ به فضای یکپارچه هدایت می‌شود',
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
  let workspaceEnhanceTimer = null;
  // ── Floor Studio refactored module instance ──────────────────────────
  // هنگام navigate بین tabها، cleanup شود
  let _floorStudioInstance = null;

  function hasCapability(capability) {
    if (capability === 'owner') return currentUserRole === 'owner';
    const caps = currentUser?.capabilities || [];
    return caps.includes('*') || caps.includes(capability);
  }

  const financeWorkspaceHref = (workspace = 'workbench') => `/admin?financeWorkspace=${encodeURIComponent(workspace)}&branchId=${encodeURIComponent(currentBranchId || 1)}#accounting`;
  const paymentModeLabel = (value) => ({ sandbox: 'آزمایشی', test: 'آزمایشی', live: 'عملیاتی', production: 'عملیاتی', disabled: 'غیرفعال' }[String(value || '').toLowerCase()] || String(value || 'آزمایشی'));
  const paymentProviderLabel = (value) => String(value || '').toLowerCase() === 'sandbox' ? 'پرداخت آزمایشی' : String(value || 'پرداخت آزمایشی');

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
      button.hidden = !!capability && !hasCapability(capability);
    });
    document.querySelectorAll('.nav-workspace').forEach((group) => {
      const visible = [...group.querySelectorAll('.admin-nav-item[data-tab]')].some((button) => !button.hidden);
      group.hidden = !visible;
    });
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
      refreshLiveWorkspace();
    };
    ['order.created', 'order.updated', 'payment.updated', 'reservation.created', 'reservation.updated', 'delivery_zone.updated'].forEach((type) => {
      stream.addEventListener(type, onOperationalUpdate);
    });
    stream.onopen = () => {
      if (commandCenterStream !== stream) return;
    };
    stream.onerror = () => {
      if (commandCenterStream !== stream) return;
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
    if (location.hash !== `#${name}`) history.replaceState(null, '', `${location.pathname}${location.search}#${name}`);
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

  // ---------- tabs ----------
  const tabs = {
    async dashboard() {
      setActiveTab('dashboard');
      const [d, live, stats, financeResult, beResult] = await Promise.all([
        api(`/api/admin/command-center${branchQs()}`),
        api(`/api/admin/v2/overview${branchQs()}`),
        api(`/api/admin/stats${branchQs()}`).catch(() => ({ revenueWeek: 0, topItems: [] })),
        hasCapability('finance.view')
          ? api(`/api/admin/v2/finance/workbench${branchQs()}`).catch((error) => ({ data: null, loadError: error?.message || 'داده مالی در دسترس نیست' }))
          : Promise.resolve({ data: null, loadError: null }),
        hasCapability('finance.view')
          ? api(`/api/admin/v2/finance/planning/break-even/dashboard${branchQs()}`).catch((error) => ({ data: {
              status: 'load_error',
              chart: { status: 'insufficient_data', title: 'نقطهٔ سربه‌سر و مسیر سوددهی' },
              message: error?.message || 'دادهٔ تحلیل سودآوری دریافت نشد.',
            } }))
          : Promise.resolve(null),
      ]);
      const br = currentBranch();
      const salesToday = Number(live.metrics?.salesToday || 0);
      const activeOrders = Number(live.metrics?.activeOrders || 0);
      const busyTables = Number(live.metrics?.busyTables || 0);
      const reservationsToday = Number(d.summary?.reservationsToday || 0);
      const openCalls = Number(live.metrics?.openWaiterCalls || 0);
      const delayed = Number(d.summary?.delayed || 0);
      const queue = Number(d.summary?.queue || 0);
      const financeData = financeResult?.data || null;
      const breakEvenDashboard = beResult?.data || beResult || null;
      const financeCriticalIssues = Array.isArray(financeData?.issues)
        ? financeData.issues.filter((issue) => issue.severity === 'critical')
        : [];
      const financeDifferenceIrr = Number(financeData?.metrics?.unexplainedDifferenceIrr || 0);
      const financeNeedsAttention = financeCriticalIssues.length > 0 || financeDifferenceIrr !== 0;
      const financeLoadError = hasCapability('finance.view') ? financeResult?.loadError : null;
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

          ${financeNeedsAttention ? `<button type="button" class="vital-finance-strip" data-quick-tab="accounting"><i aria-hidden="true">﷼</i><span><b>فروش و دفتر مالی نیازمند تطبیق‌اند</b><small>${fmtNum(financeCriticalIssues.length)} نوع هشدار فوری${financeDifferenceIrr ? ` · ${fmtMoney(Math.round(Math.abs(financeDifferenceIrr) / 10))} اختلاف توضیح‌نشده` : ''}</small></span><strong>باز کردن کارتابل حسابدار ←</strong></button>` : ''}
          ${financeLoadError ? '<button type="button" class="vital-finance-strip" data-quick-tab="accounting"><i aria-hidden="true">!</i><span><b>وضعیت مالی دریافت نشد</b><small>خطا پنهان نشده است؛ جزئیات و تلاش دوباره در کارتابل حسابدار قرار دارد.</small></span><strong>بررسی وضعیت ←</strong></button>' : ''}

          <section class="vital-kpi-grid" aria-label="شاخص‌های اصلی امروز">
            <article class="vital-kpi is-green"><span class="vital-kpi__icon" aria-hidden="true">⌁</span><small>فروش امروز</small><strong>${fmtMoney(salesToday)}</strong><em>${salesHealth >= 100 ? 'بالاتر از میانگین هفتگی' : `${fmtNum(salesHealth)}٪ میانگین روزانه هفته`}</em></article>
            <article class="vital-kpi is-purple"><span class="vital-kpi__icon" aria-hidden="true">▣</span><small>سفارش‌های فعال</small><strong>${fmtNum(activeOrders)}</strong><em>${queue ? `${fmtNum(queue)} سفارش نیازمند اقدام` : 'صف عملیات تحت کنترل است'}</em></article>
            <article class="vital-kpi is-blue"><span class="vital-kpi__icon" aria-hidden="true">▤</span><small>میزهای درگیر</small><strong>${fmtNum(busyTables)} <i>از ${fmtNum(live.metrics?.totalTables || 0)}</i></strong><em>وضعیت زنده سالن</em></article>
            <article class="vital-kpi is-orange"><span class="vital-kpi__icon" aria-hidden="true">◌</span><small>رزروهای امروز</small><strong>${fmtNum(reservationsToday)}</strong><em>${openCalls ? `${fmtNum(openCalls)} فراخوان گارسون باز` : 'فراخوان بازی وجود ندارد'}</em></article>
          </section>

          ${renderDashboardBreakEvenShell(breakEvenDashboard, stats, financeData, hasCapability('finance.view'))}

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
                  <div class="ops-panel__head"><div><p class="eyebrow">محبوب‌ترین‌ها</p><h2>محصولات پرفروش</h2></div><button class="text-btn" data-quick-tab="reports">همه</button></div>
                  <div class="vital-selling-list">
                    ${(stats.topItems || []).slice(0, 5).map((item, index) => `<div><span class="vital-selling-rank">${fmtNum(index + 1)}</span><div><b>${esc(item.name)}</b><small>${fmtNum(item.qty)} فروش</small></div><strong>${fmtMoney(item.revenue)}</strong></div>`).join('') || '<p class="ops-empty">هنوز فروش ثبت نشده است.</p>'}
                  </div>
                </article>
              </section>

              <nav class="vital-action-dock" aria-label="اقدام‌های سریع">
                <button data-quick-tab="orders"><i>＋</i><span>سفارش‌ها</span></button>
                <button data-quick-tab="reservations"><i>□</i><span>رزرو میز</span></button>
                <button data-quick-tab="menu"><i>＋</i><span>افزودن محصول</span></button>
                <button data-quick-tab="club"><i>⌁</i><span>پیام به مشتریان</span></button>
                ${hasCapability('finance.view')
                  ? '<button data-quick-tab="accounting"><i>✓</i><span>کارتابل حسابدار</span></button>'
                  : '<button data-quick-tab="reports"><i>▥</i><span>گزارش‌ها</span></button>'}
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
      mountDashboardBreakEven(breakEvenDashboard);
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

    async printmenu() {
      setActiveTab('printmenu');
      const d = await api('/api/admin/restaurant');
      const r = d.restaurant || {};
      main.innerHTML = `
        <h1>منوی چاپی و فایل پی‌دی‌اف</h1>
        <p class="lead">خروجی کاغذی از منوی زنده — مشابه ترکیب منوی دیجیتال و کاغذی در سامانه‌هایی مثل پرومنو. برای چاپ یا ذخیره فایل از پنجره چاپ مرورگر استفاده کنید.</p>
        <div class="section-box">
          <h2>${esc(r.name || 'وستو')}</h2>
          <p class="hint">${esc(r.tagline || '')}</p>
          <div class="row-actions" style="margin-top:1rem;">
            <a class="btn btn-sm" href="/menu-print" target="_blank" rel="noopener">باز کردن پیش‌نمایش چاپ</a>
            <button class="btn btn-sm btn-ghost" id="pm-window">باز کردن و چاپ فوری</button>
          </div>
          <ul class="hint" style="margin-top:1.25rem; line-height:1.7;">
            <li>می‌توانید ناموجودها، آلرژن‌ها و توضیحات را در صفحه چاپ روشن/خاموش کنید.</li>
            <li>در پنجره چاپ، مقصد را روی «ذخیره به‌صورت پی‌دی‌اف» بگذارید تا فایل بگیرید.</li>
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
        try {
          await api('/api/admin/restaurant', {
            method: 'PUT',
            body: JSON.stringify({
              restaurant: {
                name: document.getElementById('r_name')?.value || '',
                brandName: document.getElementById('r_brand')?.value || '',
                tagline: document.getElementById('r_tag')?.value || '',
                address: document.getElementById('r_addr')?.value || '',
                phone: document.getElementById('r_phone')?.value || '',
                instagram: document.getElementById('r_ig')?.value || '',
                website: document.getElementById('r_web')?.value || '',
                currency: document.getElementById('r_cur')?.value || '',
                about: document.getElementById('r_about')?.value || '',
                taxPercent: parseInputNumber(document.getElementById('r_tax')?.value) || 0,
                servicePercent: parseInputNumber(document.getElementById('r_svc')?.value) || 0,
              },
            }),
          });
        } catch (e) {
          showToast(e.message || 'خطا در ذخیره اطلاعات مجموعه', 'error');
        }
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
        <h1>ظاهر و هویت برند</h1>
        <p class="lead">رنگ پنل، منوی چاپی و هویت بصری مجموعه را یک‌جا تنظیم کنید.</p>
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
            ${colorField('رنگ تأکیدی', 'th_accent', v.accent)}
            ${colorField('متن روی رنگ تأکیدی', 'th_accentInk', v.accentInk)}
            ${colorField('سطح', 'th_surface', v.surface)}
            ${colorField('پس‌زمینه', 'th_bg', v.bg)}
            ${colorField('متن اصلی', 'th_fog', v.fog)}
            ${field('شعاع گوشه (پیکسل)', 'th_radius', String(v.radius), { ltr: true, type: 'number' })}
            ${field('قلم نمایشی', 'th_font', v.fontDisplay)}
          </div>
        </div>
        <div class="section-box">
          <h2>منوی چاپی</h2>
          <div class="grid-2">
            ${colorField('کاغذ', 'th_printPaper', v.printPaper)}
            ${colorField('مرکب', 'th_printInk', v.printInk)}
            ${colorField('رنگ تأکیدی چاپ', 'th_printAccent', v.printAccent)}
          </div>
        </div>
        <div class="row-actions">
          <span class="hint">ذخیره خودکار</span>
          <button class="btn btn-sm btn-ghost" id="th-reset">بازگشت به پیش‌فرض</button>
          <a class="btn btn-sm btn-ghost" href="/menu-print" target="_blank" rel="noopener" style="text-decoration:none;width:auto;">پیش‌نمایش چاپ</a>
        </div>`;

      const saveTheme = async () => {
        try {
          const theme = readThemeForm();
          await api('/api/admin/theme', { method: 'PUT', body: JSON.stringify({ theme }) });
          applyTheme(theme);
        } catch (e) {
          showToast(e.message || 'خطا در ذخیره تنظیمات ظاهر', 'error');
        }
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
        showToast('ظاهر پیش‌فرض اعمال شد');
        tabs.theme();
      });
    },

    async hours() {
      setActiveTab('hours');
      const d = await api(`/api/admin/restaurant${branchQs()}`);
      const hours = d.hours || {};
      const br = d.branch || currentBranch();
      
      const JS_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const todayKey = JS_DAYS[new Date().getDay()];
      const todayLabel = DAY_LABELS[todayKey] || 'امروز';
      const todayHours = hours[todayKey] || { open: '10:00', close: '23:30', closed: false };
      const isTodayClosed = Boolean(todayHours.closed);

      main.innerHTML = `
        <h1>ساعت کاری</h1>
        <p class="lead">زمان‌بندی هفتگی و وضعیت فعالیت مجموعه${br ? ` — <strong>${esc(br.name)}</strong>` : ''}.</p>
        
        <!-- Emergency & Quick Closure Control Card -->
        <div id="today-closure-box" class="card" style="margin-bottom: 1.25rem; padding: 1.15rem 1.25rem; border-radius: 14px; border: 1px solid var(--p-border, rgba(255,255,255,0.1)); background: ${isTodayClosed ? 'rgba(239, 68, 68, 0.08)' : 'rgba(16, 185, 129, 0.06)'}; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
          <div style="flex: 1; min-width: 260px;">
            <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.35rem;">
              <span id="today-status-icon" style="font-size:1.3rem;">${isTodayClosed ? '⛔' : '🟢'}</span>
              <strong style="font-size:1.05rem;">وضعیت امروز (${todayLabel}): <span id="today-status-text" style="color: ${isTodayClosed ? '#f87171' : '#4ade80'};">${isTodayClosed ? 'تعطیل (عدم سرویس‌دهی)' : `باز است (${esc(todayHours.open)} تا ${esc(todayHours.close)})`}</span></strong>
            </div>
            <p class="hint" style="margin:0; font-size:0.85rem; color:var(--p-text-dim);">در صورت تعمیرات، تغییرات دکوراسیون، رویداد خصوصی یا تعطیلی اضطراری، با دکمه روبرو وضعیت امروز را تغییر دهید.</p>
          </div>
          <div>
            <button id="btn-toggle-today" class="btn ${isTodayClosed ? 'btn-primary' : 'btn-ghost'}" style="${isTodayClosed ? 'background:#10b981; color:#fff;' : 'border-color:#ef4444; color:#f87171;'} font-weight:800; padding:0.65rem 1.25rem; min-width:200px;" type="button">
              ${isTodayClosed ? '✅ بازگشایی امروز (برگشت به ساعت عادی)' : '⛔ تعطیل کردن مجموعه برای امروز'}
            </button>
          </div>
        </div>

        <div class="section-box">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.85rem;">
            <strong>جدول ساعات کاری هفتگی</strong>
            <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
              <button id="btn-close-all" class="btn btn-sm btn-ghost" type="button" style="font-size:0.78rem;">تعطیل کردن تمام هفته</button>
              <button id="btn-open-all" class="btn btn-sm btn-ghost" type="button" style="font-size:0.78rem;">بازگشایی تمام روزها</button>
              <button id="btn-reset-standard" class="btn btn-sm btn-ghost" type="button" style="font-size:0.78rem;">ساعت استاندارد (۱۰ تا ۲۳:۳۰)</button>
            </div>
          </div>

          <table class="tbl hours-tbl"><thead><tr><th>روز</th><th>باز</th><th>بسته</th><th>تعطیل</th></tr></thead><tbody>
            ${Object.keys(DAY_LABELS)
              .map((k) => {
                const h = hours[k] || { open: '10:00', close: '23:00', closed: false };
                const isCurrentDay = (k === todayKey);
                return `<tr data-day="${k}" style="${isCurrentDay ? 'background: rgba(120,208,216,0.08); font-weight: 600;' : ''}">
                  <td>
                    ${DAY_LABELS[k]}
                    ${isCurrentDay ? '<span class="pill sm" style="margin-right:0.4rem; background:rgba(120,208,216,0.2); color:var(--p-accent, #78d0d8); font-size:0.75rem; padding:0.15rem 0.5rem; border-radius:6px;">امروز</span>' : ''}
                  </td>
                  <td><input class="h-open" type="time" value="${esc(h.open)}" ${h.closed ? 'disabled' : ''} /></td>
                  <td><input class="h-close" type="time" value="${esc(h.close)}" ${h.closed ? 'disabled' : ''} /></td>
                  <td><label class="chk"><input class="h-closed" type="checkbox" ${h.closed ? 'checked' : ''} /> تعطیل</label></td>
                </tr>`;
              })
              .join('')}
          </tbody></table>
          <p class="hint" style="margin-top:0.75rem">ذخیره خودکار با هر تغییر</p>
        </div>`;

      const updateTodayBanner = (closed) => {
        const box = document.getElementById('today-closure-box');
        const icon = document.getElementById('today-status-icon');
        const text = document.getElementById('today-status-text');
        const btn = document.getElementById('btn-toggle-today');
        const todayTr = main.querySelector(`tr[data-day="${todayKey}"]`);
        const openTime = todayTr?.querySelector('.h-open')?.value || '10:00';
        const closeTime = todayTr?.querySelector('.h-close')?.value || '23:30';

        if (box) box.style.background = closed ? 'rgba(239, 68, 68, 0.08)' : 'rgba(16, 185, 129, 0.06)';
        if (icon) icon.textContent = closed ? '⛔' : '🟢';
        if (text) {
          text.textContent = closed ? 'تعطیل (عدم سرویس‌دهی)' : `باز است (${openTime} تا ${closeTime})`;
          text.style.color = closed ? '#f87171' : '#4ade80';
        }
        if (btn) {
          btn.textContent = closed ? '✅ بازگشایی امروز (برگشت به ساعت عادی)' : '⛔ تعطیل کردن مجموعه برای امروز';
          btn.style.background = closed ? '#10b981' : '';
          btn.style.color = closed ? '#fff' : '#f87171';
          btn.style.borderColor = closed ? '' : '#ef4444';
          btn.className = `btn ${closed ? 'btn-primary' : 'btn-ghost'}`;
        }
      };

      const saveHours = async (showSuccessToast = false) => {
        const payload = {};
        main.querySelectorAll('tr[data-day]').forEach((tr) => {
          payload[tr.dataset.day] = {
            open: tr.querySelector('.h-open').value,
            close: tr.querySelector('.h-close').value,
            closed: tr.querySelector('.h-closed').checked,
          };
        });
        try {
          await api('/api/admin/hours', {
            method: 'PUT',
            body: JSON.stringify({ hours: payload, branchId: currentBranchId }),
          });
          if (showSuccessToast) {
            showToast('وضعیت ساعات کاری با موفقیت ذخیره شد.', 'success');
          }
        } catch (err) {
          showToast(err.message || 'خطا در ذخیره ساعات کاری', 'error');
        }
      };

      const hoursAutosave = autosave(() => saveHours(false), { debounceMs: 400, silent: true });

      // Toggle Today's status button
      const toggleTodayBtn = document.getElementById('btn-toggle-today');
      if (toggleTodayBtn) {
        toggleTodayBtn.addEventListener('click', async () => {
          const todayTr = main.querySelector(`tr[data-day="${todayKey}"]`);
          if (!todayTr) return;
          const cb = todayTr.querySelector('.h-closed');
          const isCurrentlyClosed = cb.checked;
          const nextClosed = !isCurrentlyClosed;
          
          cb.checked = nextClosed;
          todayTr.querySelectorAll('.h-open, .h-close').forEach((inp) => {
            inp.disabled = nextClosed;
          });

          updateTodayBanner(nextClosed);
          await saveHours(false);
          showToast(nextClosed ? 'وضعیت امروز به «تعطیل» تغییر یافت ⛔' : 'امروز مجدداً «باز» شد ✅', nextClosed ? 'info' : 'success');
        });
      }

      // Bulk close all days
      const btnCloseAll = document.getElementById('btn-close-all');
      if (btnCloseAll) {
        btnCloseAll.addEventListener('click', async () => {
          main.querySelectorAll('tr[data-day]').forEach((tr) => {
            const cb = tr.querySelector('.h-closed');
            cb.checked = true;
            tr.querySelectorAll('.h-open, .h-close').forEach((inp) => { inp.disabled = true; });
          });
          updateTodayBanner(true);
          await saveHours(true);
        });
      }

      // Bulk open all days
      const btnOpenAll = document.getElementById('btn-open-all');
      if (btnOpenAll) {
        btnOpenAll.addEventListener('click', async () => {
          main.querySelectorAll('tr[data-day]').forEach((tr) => {
            const cb = tr.querySelector('.h-closed');
            cb.checked = false;
            tr.querySelectorAll('.h-open, .h-close').forEach((inp) => { inp.disabled = false; });
          });
          updateTodayBanner(false);
          await saveHours(true);
        });
      }

      // Reset to standard hours (10:00 to 23:30)
      const btnResetStd = document.getElementById('btn-reset-standard');
      if (btnResetStd) {
        btnResetStd.addEventListener('click', async () => {
          main.querySelectorAll('tr[data-day]').forEach((tr) => {
            const cb = tr.querySelector('.h-closed');
            cb.checked = false;
            tr.querySelector('.h-open').value = '10:00';
            tr.querySelector('.h-close').value = '23:30';
            tr.querySelectorAll('.h-open, .h-close').forEach((inp) => { inp.disabled = false; });
          });
          updateTodayBanner(false);
          await saveHours(true);
        });
      }

      main.querySelectorAll('.h-closed').forEach((cb) => {
        cb.addEventListener('change', () => {
          const tr = cb.closest('tr');
          tr.querySelectorAll('.h-open, .h-close').forEach((inp) => {
            inp.disabled = cb.checked;
          });
          if (tr.dataset.day === todayKey) {
            updateTodayBanner(cb.checked);
          }
          hoursAutosave();
        });
      });

      main.querySelectorAll('.h-open, .h-close').forEach((inp) => {
        inp.addEventListener('change', () => {
          const tr = inp.closest('tr');
          if (tr && tr.dataset.day === todayKey) {
            const cb = tr.querySelector('.h-closed');
            updateTodayBanner(cb.checked);
          }
          hoursAutosave();
        });
        inp.addEventListener('input', hoursAutosave);
      });
    },

    async tables() {
      setActiveTab('tables');

      // ── استفاده از ماژول ریفکتورشده floor-studio.js اگر در دسترس است ──
      if (typeof window.createFloorStudio === 'function') {
        if (_floorStudioInstance) { _floorStudioInstance.unmount(); _floorStudioInstance = null; }
        _floorStudioInstance = window.createFloorStudio({
          main,
          api,
          branchQs,
          getCurrentBranchId: () => currentBranchId,
          showToast,
          fmtNum,
          esc,
          debounce,
          currentBranch,
          // توابعی که هنوز در admin.js هستند
          legacyActions: {
            promptTableFurnitureModal: null, // از floor-studio.js استفاده می‌شود
            promptAddFixture: null,
            promptFloorSettings: null,
            exportLayoutJson: null,
            importLayoutJson: null,
            showTemplateModal: null,
          },
        });
        await _floorStudioInstance.mount();
        return; // ← از کد قدیمی استفاده نمی‌شود
      }

      // ── Fallback: کد قدیمی (در صورت عدم بارگذاری ماژول) ──
      let [d, floorData] = await Promise.all([
        api(`/api/admin/tables${branchQs()}`),
        api(`/api/admin/v2/floor${branchQs()}`),
      ]);
      const br = currentBranch();

      const origin = location.origin;
      const QR_PREFS_KEY = 'westo_admin_qr_studio_v1';
      const VIEW_PREFS_KEY = 'westo_admin_tables_view_mode';
      let currentView = localStorage.getItem(VIEW_PREFS_KEY) || 'map';
      let activeZone = 'all';
      let isEditMode = true;
      let studioMode = 'furniture';
      let selectedTableId = null;
      let activeDrag = null;
      let justDragged = false;
      let canvasZoom = 1;
      let canvasPanX = 0;
      let canvasPanY = 0;
      let snapGridStep = 0.5;
      let isSavingLayout = false;
      let isDrawingZone = false;
      const layoutHistory = [];
      const layoutRedoHistory = [];

      let floorLevels = Array.isArray(floorData?.floors) && floorData.floors.length > 0
        ? floorData.floors.map((fl) => ({
            id: String(fl.id || 'floor-ground'),
            name: String(fl.name || 'سالن اصلی (همکف)'),
            level: Number(fl.level) || 0,
            icon: fl.icon || '🏛️',
            isDefault: Boolean(fl.isDefault),
          }))
        : [{ id: 'floor-ground', name: 'سالن اصلی (همکف)', level: 0, icon: '🏛️', isDefault: true }];

      let activeFloorId = floorLevels[0]?.id || 'floor-ground';

      const DEFAULT_FLOOR_FIXTURES = [
        { id: 'fix-entrance', type: 'entrance', name: 'ورودی اصلی', x: 2, y: 44, w: 3, h: 14, rotation: 0, color: 'blue', icon: '🚪', floorId: 'floor-ground' },
        { id: 'fix-bar', type: 'bar', name: 'کافه بار و پیشخوان', x: 16, y: 3, w: 16, h: 7, rotation: 0, color: 'slate', icon: '☕', floorId: 'floor-ground' },
        { id: 'fix-kitchen', type: 'kitchen', name: 'تحویل غذا و آشپزخانه', x: 2, y: 84, w: 15, h: 8, rotation: 0, color: 'orange', icon: '🍳', floorId: 'floor-ground' },
        { id: 'fix-cashier', type: 'cashier', name: 'صندوق و پذیرش', x: 7, y: 3, w: 7, h: 7, rotation: 0, color: 'emerald', icon: '💳', floorId: 'floor-ground' },
        { id: 'fix-restroom', type: 'restroom', name: 'سرویس بهداشتی', x: 89, y: 3, w: 9, h: 7, rotation: 0, color: 'sky', icon: '🚻', floorId: 'floor-ground' },
      ];

      let floorFixtures = Array.isArray(floorData?.fixtures) && floorData.fixtures.length > 0
        ? floorData.fixtures.map((f, i) => ({
            id: String(f.id || `fix-${i}`),
            type: String(f.type || 'fixture'),
            name: String(f.name || 'المان سالن'),
            x: Number(f.x) || 10,
            y: Number(f.y) || 10,
            w: Number(f.w) || 10,
            h: Number(f.h) || 8,
            rotation: Number(f.rotation) || 0,
            color: f.color || 'slate',
            icon: f.icon || '🏷️',
            floorId: f.floorId || 'floor-ground',
          }))
        : DEFAULT_FLOOR_FIXTURES;

      let floorSettings = floorData?.settings || {
        widthM: 20,
        lengthM: 25,
        gridStep: 0.5,
        bgTheme: 'blueprint',
        wallThickness: 0.4,
        showRulers: true,
        showGrid: true,
      };

      let selectedFixtureId = null;
      let selectedZoneId = null;
      let activeFixtureDrag = null;
      let activeGuides = [];

      const pushHistory = () => {
        try {
          layoutHistory.push({
            tables: JSON.parse(JSON.stringify(tables)),
            zones: JSON.parse(JSON.stringify(floorZones)),
            fixtures: JSON.parse(JSON.stringify(floorFixtures)),
            floors: JSON.parse(JSON.stringify(floorLevels)),
          });
          if (layoutHistory.length > 35) layoutHistory.shift();
          layoutRedoHistory.length = 0;
          updateUndoButtonUi();
        } catch (_) {}
      };

      const undoLayout = () => {
        if (!layoutHistory.length) return;
        const prev = layoutHistory.pop();
        if (prev && Array.isArray(prev.tables)) {
          layoutRedoHistory.push({
            tables: JSON.parse(JSON.stringify(tables)),
            zones: JSON.parse(JSON.stringify(floorZones)),
            fixtures: JSON.parse(JSON.stringify(floorFixtures)),
            floors: JSON.parse(JSON.stringify(floorLevels)),
          });
          tables = prev.tables;
          if (Array.isArray(prev.zones)) floorZones = prev.zones;
          if (Array.isArray(prev.fixtures)) floorFixtures = prev.fixtures;
          if (Array.isArray(prev.floors)) floorLevels = prev.floors;
          updateUndoButtonUi();
          debouncedSaveFloor();
          render();
          showToast('آخرین تغییرات چیدمان سالن بازگردانی شد (Undo).', 'info');
        }
      };

      const redoLayout = () => {
        if (!layoutRedoHistory.length) return;
        const next = layoutRedoHistory.pop();
        if (next && Array.isArray(next.tables)) {
          layoutHistory.push({
            tables: JSON.parse(JSON.stringify(tables)),
            zones: JSON.parse(JSON.stringify(floorZones)),
            fixtures: JSON.parse(JSON.stringify(floorFixtures)),
            floors: JSON.parse(JSON.stringify(floorLevels)),
          });
          tables = next.tables;
          if (Array.isArray(next.zones)) floorZones = next.zones;
          if (Array.isArray(next.fixtures)) floorFixtures = next.fixtures;
          if (Array.isArray(next.floors)) floorLevels = next.floors;
          updateUndoButtonUi();
          debouncedSaveFloor();
          render();
          showToast('تغییر مجدداً اعمال گردید (Redo).', 'info');
        }
      };

      const updateUndoButtonUi = () => {
        const undoBtn = document.getElementById('map-undo');
        if (undoBtn) {
          undoBtn.disabled = layoutHistory.length === 0;
          undoBtn.title = layoutHistory.length > 0 ? `بازگردانی آخرین تغییر (${fmtNum(layoutHistory.length)})` : 'تاریخچه خالی است';
        }
        const redoBtn = document.getElementById('map-redo');
        if (redoBtn) {
          redoBtn.disabled = layoutRedoHistory.length === 0;
          redoBtn.title = layoutRedoHistory.length > 0 ? `تکرار تغییر (${fmtNum(layoutRedoHistory.length)})` : 'موردی برای تکرار نیست';
        }
      };

      const detectZoneAtCoords = (x, y) => {
        return floorZones.find((z) => {
          return x >= z.x && x <= (z.x + z.w) &&
                 y >= z.y && y <= (z.y + z.h);
        }) || null;
      };

      const detectTableCollision = (targetTable) => {
        return tables.some((other) => {
          if (Number(other.id) === Number(targetTable.id)) return false;
          const dx = (Number(other.x) || 0) - (Number(targetTable.x) || 0);
          const dy = (Number(other.y) || 0) - (Number(targetTable.y) || 0);
          return Math.hypot(dx, dy) < 8.5;
        });
      };

      const normalizeZone = (z) => {
        const s = String(z || '').trim();
        if (!s) return 'سالن';
        if (/^vip$/i.test(s)) return 'ویژه';
        return s;
      };

      const DEFAULT_FLOOR_ZONES = [
        { id: 'zone-main', name: 'سالن اصلی', x: 2, y: 3, w: 47, h: 94, color: 'blue', icon: '🛋️' },
        { id: 'zone-terrace', name: 'تراس و فضای باز', x: 49, y: 3, w: 49, h: 56, color: 'emerald', icon: '🌿' },
        { id: 'zone-vip', name: 'سالن اختصاصی ویژه', x: 49, y: 59, w: 49, h: 38, color: 'purple', icon: '👑' },
      ];

      const sanitizeNonOverlappingZones = (zones) => {
        if (!Array.isArray(zones) || zones.length <= 1) return zones || [];
        const result = zones.map((z) => ({ ...z }));
        for (let i = 0; i < result.length; i++) {
          for (let j = i + 1; j < result.length; j++) {
            const a = result[i];
            const b = result[j];
            const xOverlap = Math.max(a.x, b.x) < Math.min(a.x + a.w, b.x + b.w) - 0.5;
            const yOverlap = Math.max(a.y, b.y) < Math.min(a.y + a.h, b.y + b.h) - 0.5;
            if (xOverlap && yOverlap) {
              const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
              const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
              if (overlapY <= overlapX) {
                const midY = Math.round((Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2);
                if (a.y < b.y) {
                  a.h = Math.max(8, midY - a.y);
                  b.h = Math.max(8, (b.y + b.h) - midY);
                  b.y = midY;
                } else {
                  b.h = Math.max(8, midY - b.y);
                  a.h = Math.max(8, (a.y + a.h) - midY);
                  a.y = midY;
                }
              } else {
                const midX = Math.round((Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2);
                if (a.x < b.x) {
                  a.w = Math.max(8, midX - a.x);
                  b.w = Math.max(8, (b.x + b.w) - midX);
                  b.x = midX;
                } else {
                  b.w = Math.max(8, midX - b.x);
                  a.w = Math.max(8, (a.x + a.w) - midX);
                  a.x = midX;
                }
              }
            }
          }
        }
        return result;
      };

      let floorZones = sanitizeNonOverlappingZones(
        Array.isArray(floorData?.zones) && floorData.zones.length > 0
          ? floorData.zones.map((z) => ({
              id: String(z.id || `zone-${Math.random().toString(36).slice(2, 7)}`),
              name: normalizeZone(z.name),
              x: Number(z.x) || 0,
              y: Number(z.y) || 0,
              w: Number(z.w) || 30,
              h: Number(z.h) || 30,
              color: z.color || 'blue',
              icon: z.icon || '🏷️',
            }))
          : DEFAULT_FLOOR_ZONES
      );

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
      tables.forEach((t) => { t.zone = normalizeZone(t.zone); });

      // Ensure any custom zone on tables is registered in floorZones
      const existingZoneNames = new Set(floorZones.map((z) => normalizeZone(z.name)));
      tables.forEach((t) => {
        const zn = normalizeZone(t.zone);
        if (zn && !existingZoneNames.has(zn)) {
          existingZoneNames.add(zn);
          floorZones.push({
            id: `zone-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: zn,
            x: 35,
            y: 35,
            w: 30,
            h: 30,
            color: 'amber',
            icon: '🏷️',
          });
        }
      });

      let currentTableId = Number(tables[0]?.id) || null;
      const selectedTableIds = new Set();

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

      const ensureTableGeometry = (table, index) => {
        if (typeof table.x !== 'number' || typeof table.y !== 'number') {
          const match = DEFAULT_TABLE_COORDINATES.find((item) => String(item.id) === String(table.id));
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
        table.zone = normalizeZone(table.zone);
      };

      const floorTableMap = new Map((floorData?.tables || []).map((t) => [Number(t.id), t]));
      tables.forEach((table, index) => {
        const f = floorTableMap.get(Number(table.id));
        if (f) {
          if (typeof f.x === 'number') table.x = f.x;
          if (typeof f.y === 'number') table.y = f.y;
          if (f.shape) table.shape = f.shape;
          if (typeof f.rotation === 'number') table.rotation = f.rotation;
          if (f.zone) table.zone = normalizeZone(f.zone);
          table.state = f.state || table.state;
          table.stateLabel = f.stateLabel || table.stateLabel;
          table.serviceEndsAt = f.serviceEndsAt || null;
          table.autoReleased = Boolean(f.autoReleased);
        }
        ensureTableGeometry(table, index);
      });

      const floorCountdownLabel = (endsAt) => {
        const seconds = Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 1000));
        const minutes = Math.floor(seconds / 60);
        const remainder = seconds % 60;
        const twoDigits = (value) => Number(value).toLocaleString('fa-IR', { minimumIntegerDigits: 2, useGrouping: false });
        return `${twoDigits(minutes)}:${twoDigits(remainder)}`;
      };

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
      const qrEclLabel = () => ({ L: 'سبک', M: 'استاندارد', Q: 'مقاوم', H: 'بسیار مقاوم' }[qrPrefs.ecl] || 'استاندارد');
      const qrEclHint = () => ({ L: 'فایل سبک', M: 'پیشنهاد وستو', Q: 'مناسب محیط شلوغ', H: 'بیشترین تحمل آسیب چاپ' }[qrPrefs.ecl] || 'پیشنهاد وستو');
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
          showToast('لینک رمزینه کپی شد.', 'success');
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
            <div class="qr-print-card__brand">وستو <span>کافه‌رستوران</span></div>
            <img src="${esc(qrAssetUrl(table))}" alt="رمزینه ${esc(tableTitle(table))}" />
            <h1>${esc(tableTitle(table))}</h1>
            <p>منوی دیجیتال و ثبت سفارش روی میز</p>
            <small>${esc(branchName)} · ${esc(table.zone || 'سالن')}</small>
          </article>`).join('');
        printWindow.document.write(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>رمزینه میزها · ${esc(branchName)}</title><style>
          @page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;background:#fff;color:#11181b;font-family:Arial,"Vazirmatn",sans-serif}.qr-print-sheet{display:grid;grid-template-columns:repeat(2,1fr);gap:10mm}.qr-print-card{display:flex;min-height:118mm;align-items:center;justify-content:center;flex-direction:column;padding:10mm 7mm;border:1px solid #d9e0df;border-radius:6mm;text-align:center;break-inside:avoid}.qr-print-card__brand{margin-bottom:4mm;color:#14282b;font-size:18px;font-weight:900;letter-spacing:.12em}.qr-print-card__brand span{display:block;margin-top:1.5mm;color:#6f7a78;font-size:9px;font-weight:500;letter-spacing:0}.qr-print-card img{display:block;width:62mm;height:62mm;object-fit:contain;image-rendering:pixelated}.qr-print-card h1{margin:5mm 0 1mm;font-size:22px}.qr-print-card p{margin:0;color:#56625f;font-size:11px}.qr-print-card small{margin-top:3mm;color:#74807d;font-size:9px}@media print{.qr-print-card{border-color:#c9d2d0}}
        </style></head><body><main class="qr-print-sheet">${cards}</main><script>window.addEventListener('load',function(){var imgs=[].slice.call(document.images);Promise.all(imgs.map(function(img){return img.complete?Promise.resolve():new Promise(function(resolve){img.onload=img.onerror=resolve})})).then(function(){setTimeout(function(){window.focus();window.print()},180)})});<\/script></body></html>`);
        printWindow.document.close();
      };

      const updateSaveStatus = (saving) => {
        isSavingLayout = saving;
        const pill = document.getElementById('map-save-status');
        if (pill) {
          if (saving) {
            pill.className = 'floor-save-status is-saving';
            pill.innerHTML = '<span class="pulse-dot" style="background:#f59e0b"></span><span>در حال ذخیره...</span>';
          } else {
            pill.className = 'floor-save-status';
            pill.innerHTML = '<span>✓ چیدمان ذخیره است</span>';
          }
        }
      };

      const saveFloorLayout = async (silent = false) => {
        updateSaveStatus(true);
        try {
          const layoutPayload = tables.map((t) => ({
            id: Number(t.id),
            label: String(t.label || `میز ${t.id}`).trim(),
            seats: Math.max(1, Math.min(20, Number(t.seats) || 4)),
            zone: normalizeZone(t.zone),
            active: t.active !== false,
            x: Math.max(0, Math.min(100, Math.round((Number(t.x) || 50) * 10) / 10)),
            y: Math.max(0, Math.min(100, Math.round((Number(t.y) || 50) * 10) / 10)),
            shape: t.shape || 'rectangle',
            rotation: (Number(t.rotation) || 0) % 360,
            floorId: t.floorId || 'floor-ground',
            mergedWith: Array.isArray(t.mergedWith) ? t.mergedWith : [],
            mergedInto: t.mergedInto || null,
            tags: Array.isArray(t.tags) ? t.tags : [],
          }));
          const zonesPayload = floorZones.map((z) => ({
            id: String(z.id),
            name: normalizeZone(z.name),
            x: Math.max(0, Math.min(100, Math.round(Number(z.x) * 10) / 10)),
            y: Math.max(0, Math.min(100, Math.round(Number(z.y) * 10) / 10)),
            w: Math.max(5, Math.min(100, Math.round(Number(z.w) * 10) / 10)),
            h: Math.max(5, Math.min(100, Math.round(Number(z.h) * 10) / 10)),
            color: z.color || 'blue',
            icon: z.icon || '🏷️',
            lengthM: z.lengthM,
            widthM: z.widthM,
            areaSqM: z.areaSqM,
            shape: z.shape,
            floorId: z.floorId || 'floor-ground',
          }));
          const fixturesPayload = floorFixtures.map((f) => ({
            id: String(f.id),
            type: f.type || 'fixture',
            name: f.name || 'المان',
            x: Math.max(0, Math.min(100, Math.round(Number(f.x) * 10) / 10)),
            y: Math.max(0, Math.min(100, Math.round(Number(f.y) * 10) / 10)),
            w: Math.max(2, Math.min(100, Math.round(Number(f.w) * 10) / 10)),
            h: Math.max(2, Math.min(100, Math.round(Number(f.h) * 10) / 10)),
            rotation: (Number(f.rotation) || 0) % 360,
            color: f.color || 'slate',
            icon: f.icon || '🏷️',
            floorId: f.floorId || 'floor-ground',
          }));
          const floorsPayload = floorLevels.map((fl) => ({
            id: String(fl.id),
            name: String(fl.name),
            level: Number(fl.level) || 0,
            icon: fl.icon || '🏛️',
            isDefault: Boolean(fl.isDefault),
          }));
          const res = await api('/api/admin/v2/floor/layout', {
            method: 'PUT',
            body: JSON.stringify({
              tables: layoutPayload,
              zones: zonesPayload,
              fixtures: fixturesPayload,
              floors: floorsPayload,
              settings: floorSettings,
              branchId: currentBranchId,
            }),
          });
          if (res?.floor) {
            floorData = res.floor;
            if (Array.isArray(res.floor.zones) && res.floor.zones.length > 0) {
              floorZones = res.floor.zones.map((z) => ({
                id: String(z.id),
                name: normalizeZone(z.name),
                x: Number(z.x) || 0,
                y: Number(z.y) || 0,
                w: Number(z.w) || 30,
                h: Number(z.h) || 30,
                color: z.color || 'blue',
                icon: z.icon || '🏷️',
                lengthM: z.lengthM,
                widthM: z.widthM,
                areaSqM: z.areaSqM,
                shape: z.shape,
                floorId: z.floorId || 'floor-ground',
              }));
            }
            if (Array.isArray(res.floor.fixtures)) {
              floorFixtures = res.floor.fixtures.map((f) => ({
                id: String(f.id),
                type: f.type || 'fixture',
                name: f.name || 'المان',
                x: Number(f.x) || 10,
                y: Number(f.y) || 10,
                w: Number(f.w) || 10,
                h: Number(f.h) || 8,
                rotation: Number(f.rotation) || 0,
                color: f.color || 'slate',
                icon: f.icon || '🏷️',
                floorId: f.floorId || 'floor-ground',
              }));
            }
            if (Array.isArray(res.floor.floors)) {
              floorLevels = res.floor.floors.map((fl) => ({
                id: String(fl.id),
                name: String(fl.name),
                level: Number(fl.level) || 0,
                icon: fl.icon || '🏛️',
                isDefault: Boolean(fl.isDefault),
              }));
            }
          }
          updateSaveStatus(false);
          if (!silent) showToast('چیدمان نقشه سالن با موفقیت ذخیره گردید.', 'success');
        } catch (e) {
          updateSaveStatus(false);
          if (!silent) showToast(e.message || 'خطا در ذخیره چیدمان نقشه', 'error');
        }
      };
      const debouncedSaveFloor = debounce(saveFloorLayout, 600);

      const showFloorModal = ({ title, bodyHtml, confirmText = 'تایید و ذخیره', confirmClass = 'btn-primary', cancelText = 'انصراف', modalClass = '', onConfirm }) => {
        const existing = document.getElementById('floor-modal-backdrop');
        if (existing) existing.remove();

        const backdrop = document.createElement('div');
        backdrop.id = 'floor-modal-backdrop';
        backdrop.className = 'floor-studio-backdrop';
        backdrop.innerHTML = `
          <div class="floor-studio-modal ${modalClass}" role="dialog" aria-modal="true">
            <div class="floor-studio-modal__head">
              <h3>${title}</h3>
              <button type="button" class="floor-studio-modal__close" id="floor-modal-close" aria-label="بستن">✕</button>
            </div>
            <form id="floor-modal-form">
              <div class="floor-studio-modal__body">
                ${bodyHtml}
              </div>
              <div class="floor-studio-modal__actions">
                <button type="button" class="btn btn-sm btn-ghost" id="floor-modal-cancel">${esc(cancelText)}</button>
                <button type="submit" class="btn btn-sm ${esc(confirmClass)}" id="floor-modal-confirm">${esc(confirmText)}</button>
              </div>
            </form>
          </div>
        `;

        document.body.appendChild(backdrop);

        const close = () => {
          backdrop.remove();
          document.removeEventListener('keydown', onKeyDown);
        };

        const onKeyDown = (ev) => {
          if (ev.key === 'Escape') close();
        };
        document.addEventListener('keydown', onKeyDown);

        backdrop.querySelector('#floor-modal-close')?.addEventListener('click', close);
        backdrop.querySelector('#floor-modal-cancel')?.addEventListener('click', close);
        backdrop.addEventListener('click', (ev) => {
          if (ev.target === backdrop) close();
        });

        const form = backdrop.querySelector('#floor-modal-form');
        form?.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          if (onConfirm) {
            const result = await onConfirm(form);
            if (result !== false) close();
          } else {
            close();
          }
        });

        setTimeout(() => {
          const firstInput = form?.querySelector('input, select, textarea');
          if (firstInput) {
            firstInput.focus();
            if (typeof firstInput.select === 'function') firstInput.select();
          }
        }, 50);

        return { close };
      };

      const addTableToMap = async () => {
        const nextId = (tables.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0)) + 1;
        const targetZone = activeZone === 'all' ? 'سالن' : activeZone;
        const standardZones = ['سالن', 'تراس', 'ویژه'];
        const existingZones = Array.from(new Set(tables.map((t) => normalizeZone(t.zone)).filter(Boolean)));
        const allZonesList = Array.from(new Set([...standardZones, ...existingZones]));
        const defaultLabel = `میز ${nextId}`;

        showFloorModal({
          title: '➕ افزودن میز جدید به نقشه',
          confirmText: 'ایجاد و قرار دادن روی نقشه',
          confirmClass: 'btn-primary',
          bodyHtml: `
            <div class="floor-studio-modal__field">
              <label for="fm-table-label">نام یا شماره برچسب میز:</label>
              <input id="fm-table-label" type="text" value="${esc(defaultLabel)}" required />
            </div>
            <div class="floor-studio-modal__field">
              <label for="fm-table-floor">طبقه یا فضا:</label>
              <select id="fm-table-floor">
                ${floorLevels.map((fl) => `<option value="${esc(fl.id)}" ${fl.id === activeFloorId ? 'selected' : ''}>${esc(fl.icon || '🏛️')} ${esc(fl.name)}</option>`).join('')}
              </select>
            </div>
            <div class="floor-studio-modal__field">
              <label for="fm-table-zone">بخش سالن (زون):</label>
              <select id="fm-table-zone">
                ${allZonesList.map((z) => `<option value="${esc(z)}" ${z === targetZone ? 'selected' : ''}>${esc(z)}</option>`).join('')}
              </select>
            </div>
            <div class="floor-studio-modal__field">
              <label for="fm-table-seats">تعداد صندلی (ظرفیت پذیرایی):</label>
              <input id="fm-table-seats" type="number" min="1" max="20" value="4" required />
            </div>
            <div class="floor-studio-modal__field">
              <label>فرم هندسی میز:</label>
              <div class="floor-studio-modal__shape-grid" id="fm-table-shapes">
                <button type="button" class="floor-studio-modal__shape-btn is-active" data-shape="rectangle"><span>⬛</span><span>مستطیل</span></button>
                <button type="button" class="floor-studio-modal__shape-btn" data-shape="circle"><span>⭕</span><span>گرد</span></button>
                <button type="button" class="floor-studio-modal__shape-btn" data-shape="square"><span>⏹️</span><span>مربع</span></button>
                <button type="button" class="floor-studio-modal__shape-btn" data-shape="booth"><span>🛋️</span><span>نیمکت VIP</span></button>
                <button type="button" class="floor-studio-modal__shape-btn" data-shape="bar_stool"><span>🍸</span><span>صندلی بار</span></button>
                <button type="button" class="floor-studio-modal__shape-btn" data-shape="oval"><span>🥚</span><span>بیضی</span></button>
                <button type="button" class="floor-studio-modal__shape-btn" data-shape="lounge_takht"><span>🛏️</span><span>تخت سنتی</span></button>
              </div>
            </div>
          `,
          onConfirm: async (form) => {
            const chosenLabel = form.querySelector('#fm-table-label')?.value?.trim() || defaultLabel;
            const chosenFloor = form.querySelector('#fm-table-floor')?.value || activeFloorId;
            const chosenZone = form.querySelector('#fm-table-zone')?.value?.trim() || targetZone;
            const chosenSeats = Math.max(1, Math.min(20, Number(form.querySelector('#fm-table-seats')?.value) || 4));
            const activeShapeBtn = form.querySelector('#fm-table-shapes .is-active');
            const chosenShape = activeShapeBtn?.dataset?.shape || 'rectangle';

            let initX = 30;
            let initY = 35;
            if (chosenZone === 'تراس') { initX = 70; initY = 35; }
            else if (chosenZone === 'ویژه') { initX = 70; initY = 80; }
            else if (chosenZone !== 'سالن') { initX = 50; initY = 50; }
            initX = Math.min(88, initX + ((tables.length % 4) * 4));
            initY = Math.min(88, initY + ((tables.length % 3) * 4));

            pushHistory();
            try {
              const res = await api('/api/admin/tables', {
                method: 'POST',
                body: JSON.stringify({
                  label: chosenLabel,
                  seats: chosenSeats,
                  zone: chosenZone,
                  floorId: chosenFloor,
                  branchId: currentBranchId,
                  x: initX,
                  y: initY,
                  shape: chosenShape,
                  rotation: 0,
                }),
              });
              const created = res.table || {
                id: nextId,
                label: chosenLabel,
                seats: chosenSeats,
                zone: chosenZone,
                floorId: chosenFloor,
                branchId: currentBranchId,
                x: initX,
                y: initY,
                shape: chosenShape,
                rotation: 0,
                active: true,
              };
              ensureTableGeometry(created, tables.length);
              created.floorId = chosenFloor;
              created.state = 'available';
              created.stateLabel = 'آزاد';
              tables.push(created);
              selectedTableId = created.id;
              currentTableId = created.id;
              activeFloorId = chosenFloor;
              await saveFloorLayout(true);
              render();
              showToast(`میز جدید (${created.label}) به نقشه اضافه شد.`, 'success');
              return true;
            } catch (err) {
              showToast(err.message || 'خطا در ساخت میز جدید', 'error');
              return false;
            }
          }
        });

        setTimeout(() => {
          const shapeGrid = document.getElementById('fm-table-shapes');
          shapeGrid?.querySelectorAll('.floor-studio-modal__shape-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
              shapeGrid.querySelectorAll('.floor-studio-modal__shape-btn').forEach((b) => b.classList.remove('is-active'));
              btn.classList.add('is-active');
            });
          });
        }, 60);
      };

      const autoAlignTables = async () => {
        showFloorModal({
          title: '↺ مرتب‌سازی خودکار و مهندسی چیدمان',
          confirmText: 'اجرای مرتب‌سازی',
          confirmClass: 'btn-primary',
          bodyHtml: `
            <p style="font-size:14px;color:#f8fafc;margin:0 0 8px">آیا مایل به مرتب‌سازی خودکار و معماری میزها در بخش‌های سالن هستید؟</p>
            <p style="font-size:12px;color:#94a3b8;margin:0">میزهای سالن، تراس و سالن ویژه با فاصله‌گذاری استاندارد ۲ ستونه و فرم مهندسی بازچینی خواهند شد.</p>
          `,
          onConfirm: async () => {
            const byZone = {};
            tables.forEach((t) => {
              const z = normalizeZone(t.zone) || 'سالن';
              if (!byZone[z]) byZone[z] = [];
              byZone[z].push(t);
            });

            if (byZone['سالن']) {
              const list = byZone['سالن'];
              const cols = 2;
              list.forEach((t, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const totalRows = Math.ceil(list.length / cols);
                t.x = col === 0 ? 18 : 36;
                const yStep = 64 / Math.max(1, totalRows);
                t.y = Math.round(20 + (row * yStep) + (yStep / 2));
                t.rotation = 0;
              });
            }
            if (byZone['تراس']) {
              const list = byZone['تراس'];
              const cols = 2;
              list.forEach((t, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const totalRows = Math.ceil(list.length / cols);
                t.x = col === 0 ? 62 : 82;
                const yStep = 32 / Math.max(1, totalRows);
                t.y = Math.round(18 + (row * yStep) + (yStep / 2));
                t.rotation = 0;
              });
            }
            if (byZone['ویژه']) {
              const list = byZone['ویژه'];
              const cols = 2;
              list.forEach((t, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const totalRows = Math.ceil(list.length / cols);
                t.x = col === 0 ? 62 : 82;
                const yStep = 24 / Math.max(1, totalRows);
                t.y = Math.round(72 + (row * yStep) + (yStep / 2));
                t.shape = 'booth';
                t.rotation = 0;
              });
            }
            Object.keys(byZone).forEach((z) => {
              if (['سالن', 'تراس', 'ویژه'].includes(z)) return;
              const list = byZone[z];
              list.forEach((t, i) => {
                t.x = 48 + ((i % 3) * 16);
                t.y = 45 + (Math.floor(i / 3) * 18);
              });
            });

            await saveFloorLayout(false);
            render();
            showToast('چیدمان میزها با موفقیت مرتب گردید.', 'success');
            return true;
          }
        });
      };

      const deleteTableFromMap = async (tableId) => {
        const table = tableById(tableId);
        if (!table) return;
        showFloorModal({
          title: '🗑️ تایید حذف میز از سالن',
          confirmText: 'بله، حذف شود',
          confirmClass: 'btn-danger',
          bodyHtml: `
            <p style="font-size:14px;color:#f8fafc;margin:0 0 8px">آیا از حذف «<strong>${esc(tableTitle(table))}</strong>» از نقشه سالن و لیست میزها اطمینان دارید؟</p>
            <p style="font-size:12px;color:#f43f5e;margin:0">این عملیات غیرقابل بازگشت است و رمزینه مربوطه نیز از دسترس خارج می‌شود.</p>
          `,
          onConfirm: async () => {
            try {
              await api(`/api/admin/tables/${tableId}${branchQs()}`, { method: 'DELETE' });
              tables = tables.filter((t) => Number(t.id) !== Number(tableId));
              if (Number(selectedTableId) === Number(tableId)) selectedTableId = null;
              if (Number(currentTableId) === Number(tableId)) currentTableId = Number(tables[0]?.id) || null;
              render();
              showToast('میز از نقشه حذف گردید.', 'success');
              return true;
            } catch (err) {
              showToast(err.message || 'خطا در حذف میز', 'error');
              return false;
            }
          }
        });
      };

      const promptRenameTable = (table) => {
        showFloorModal({
          title: `✏️ تغییر نام و برچسب ${tableTitle(table)}`,
          confirmText: 'ذخیره نام',
          confirmClass: 'btn-primary',
          bodyHtml: `
            <div class="floor-studio-modal__field">
              <label for="fm-rename-input">نام یا شماره میز:</label>
              <input id="fm-rename-input" type="text" value="${esc(table.label || `میز ${table.id}`)}" required />
            </div>
          `,
          onConfirm: (form) => {
            const newName = form.querySelector('#fm-rename-input')?.value?.trim();
            if (!newName) return false;
            table.label = newName;
            debouncedSaveFloor();
            render();
            showToast(`نام میز به «${table.label}» تغییر یافت.`, 'success');
            return true;
          }
        });
      };

      const promptAddFloor = () => {
        const nextLevel = floorLevels.length;
        showFloorModal({
          title: '🏢 تعریف طبقه یا فضای جدید رستوران',
          confirmText: 'ایجاد طبقه',
          confirmClass: 'btn-primary',
          bodyHtml: `
            <div class="floor-studio-modal__field">
              <label for="fm-floor-name">نام طبقه یا فضا:</label>
              <input id="fm-floor-name" type="text" placeholder="مثال: طبقه اول، روف‌گاردن، حیاط اختصاصی" required autofocus />
            </div>
            <div class="floor-studio-modal__dim-row">
              <div class="floor-studio-modal__field">
                <label for="fm-floor-level">شماره تراز / طبقه:</label>
                <input id="fm-floor-level" type="number" min="-2" max="20" value="${nextLevel}" required />
              </div>
              <div class="floor-studio-modal__field">
                <label for="fm-floor-icon">آیکون فضا:</label>
                <select id="fm-floor-icon">
                  <option value="🏛️">🏛️ سالن و عمارت</option>
                  <option value="☀️">☀️ روف‌گاردن و بام</option>
                  <option value="🌿">🌿 فضای باز و باغ</option>
                  <option value="👑">👑 سالن VIP</option>
                  <option value="☕">☕ کافه تریا</option>
                  <option value="🪜">🪜 نیم‌طبقه و بالکن</option>
                </select>
              </div>
            </div>
          `,
          onConfirm: async (form) => {
            const name = form.querySelector('#fm-floor-name')?.value?.trim();
            if (!name) return false;
            const level = parseInt(form.querySelector('#fm-floor-level')?.value, 10) || nextLevel;
            const icon = form.querySelector('#fm-floor-icon')?.value || '🏛️';
            const id = `floor-${Date.now()}`;
            pushHistory();
            floorLevels.push({ id, name, level, icon, isDefault: false });
            activeFloorId = id;
            await saveFloorLayout(true);
            render();
            showToast(`طبقه «${name}» ایجاد و نقشه آن فعال شد.`, 'success');
            return true;
          }
        });
      };

      const promptEditFloor = (floor) => {
        showFloorModal({
          title: `⚙️ ویرایش مشخصات طبقه «${esc(floor.name)}»`,
          confirmText: 'ذخیره مشخصات',
          confirmClass: 'btn-primary',
          bodyHtml: `
            <div class="floor-studio-modal__field">
              <label for="fm-floor-edit-name">نام طبقه:</label>
              <input id="fm-floor-edit-name" type="text" value="${esc(floor.name)}" required />
            </div>
            <div class="floor-studio-modal__dim-row">
              <div class="floor-studio-modal__field">
                <label for="fm-floor-edit-level">شماره تراز / طبقه:</label>
                <input id="fm-floor-edit-level" type="number" min="-2" max="20" value="${floor.level || 0}" required />
              </div>
              <div class="floor-studio-modal__field">
                <label for="fm-floor-edit-icon">آیکون فضا:</label>
                <input id="fm-floor-edit-icon" type="text" value="${esc(floor.icon || '🏛️')}" />
              </div>
            </div>
            ${floorLevels.length > 1 ? `
              <div style="margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.1);display:flex;justify-content:flex-end">
                <button type="button" class="btn btn-sm btn-danger" id="fm-floor-delete-btn">🗑️ حذف کامل این طبقه</button>
              </div>
            ` : ''}
          `,
          onConfirm: async (form) => {
            const name = form.querySelector('#fm-floor-edit-name')?.value?.trim();
            if (!name) return false;
            floor.name = name;
            floor.level = parseInt(form.querySelector('#fm-floor-edit-level')?.value, 10) || 0;
            floor.icon = form.querySelector('#fm-floor-edit-icon')?.value?.trim() || '🏛️';
            pushHistory();
            await saveFloorLayout(true);
            render();
            showToast('مشخصات طبقه ذخیره گردید.', 'success');
            return true;
          }
        });

        setTimeout(() => {
          document.getElementById('fm-floor-delete-btn')?.addEventListener('click', () => {
            deleteFloor(floor.id);
          });
        }, 60);
      };

      const deleteFloor = (floorId) => {
        if (floorLevels.length <= 1) {
          showToast('حداقل یک طبقه باید در رستوران فعال باشد.', 'warning');
          return;
        }
        const floor = floorLevels.find((fl) => fl.id === floorId);
        if (!floor) return;
        showFloorModal({
          title: `🗑️ حذف طبقه «${esc(floor.name)}»`,
          confirmText: 'بله، حذف شود',
          confirmClass: 'btn-danger',
          bodyHtml: `
            <p style="font-size:14px;color:#f8fafc;margin:0 0 8px">آیا از حذف این طبقه اطمینان دارید؟</p>
            <p style="font-size:12px;color:#94a3b8;margin:0">میزها و سازه‌های متعلق به این طبقه به طور خودکار به طبقه همکف منتقل خواهند شد.</p>
          `,
          onConfirm: async () => {
            pushHistory();
            const fallbackFloorId = floorLevels.find((fl) => fl.id !== floorId)?.id || 'floor-ground';
            tables.forEach((t) => {
              if (t.floorId === floorId) t.floorId = fallbackFloorId;
            });
            floorFixtures.forEach((f) => {
              if (f.floorId === floorId) f.floorId = fallbackFloorId;
            });
            floorZones.forEach((z) => {
              if (z.floorId === floorId) z.floorId = fallbackFloorId;
            });
            floorLevels = floorLevels.filter((fl) => fl.id !== floorId);
            if (activeFloorId === floorId) activeFloorId = fallbackFloorId;
            await saveFloorLayout(true);
            render();
            showToast(`طبقه «${floor.name}» حذف گردید.`, 'success');
            return true;
          }
        });
      };

      const promptMoveTableFloor = (table) => {
        showFloorModal({
          title: `🏢 انتقال ${tableTitle(table)} به طبقه دیگر`,
          confirmText: 'انتقال میز',
          confirmClass: 'btn-primary',
          bodyHtml: `
            <div class="floor-studio-modal__field">
              <label for="fm-target-floor">طبقه مقصد را انتخاب کنید:</label>
              <select id="fm-target-floor">
                ${floorLevels.map((fl) => `<option value="${esc(fl.id)}" ${(table.floorId || 'floor-ground') === fl.id ? 'selected' : ''}>${esc(fl.icon || '🏛️')} ${esc(fl.name)}</option>`).join('')}
              </select>
            </div>
          `,
          onConfirm: async (form) => {
            const targetFloorId = form.querySelector('#fm-target-floor')?.value;
            if (!targetFloorId || targetFloorId === (table.floorId || 'floor-ground')) return true;
            pushHistory();
            table.floorId = targetFloorId;
            activeFloorId = targetFloorId;
            await saveFloorLayout(true);
            render();
            showToast(`${tableTitle(table)} به طبقه انتخابی منتقل شد.`, 'success');
            return true;
          }
        });
      };

      const mergeTablesGroup = (tableIds) => {
        const ids = Array.from(tableIds).map(Number).filter(Boolean);
        if (ids.length < 2) {
          showToast('برای ادغام، حداقل ۲ میز را انتخاب کنید.', 'warning');
          return;
        }
        const groupTables = tables.filter((t) => ids.includes(Number(t.id)));
        if (groupTables.length < 2) return;

        pushHistory();
        const master = groupTables[0];
        const subTables = groupTables.slice(1);
        const subIds = subTables.map((t) => t.id);

        master.mergedWith = subIds;
        master.mergedInto = null;
        subTables.forEach((st) => {
          st.mergedInto = master.id;
          st.mergedWith = null;
        });

        debouncedSaveFloor();
        render();
        showToast(`میزهای [${groupTables.map((t) => tableTitle(t)).join(' + ')}] با موفقیت ادغام شدند.`, 'success');
      };

      const unmergeTable = (table) => {
        pushHistory();
        if (table.mergedWith && Array.isArray(table.mergedWith)) {
          const subIds = table.mergedWith.map(Number);
          tables.forEach((t) => {
            if (subIds.includes(Number(t.id))) {
              t.mergedInto = null;
              t.mergedWith = null;
            }
          });
          table.mergedWith = null;
        }
        if (table.mergedInto) {
          const master = tableById(table.mergedInto);
          if (master && Array.isArray(master.mergedWith)) {
            master.mergedWith = master.mergedWith.filter((id) => Number(id) !== Number(table.id));
            if (master.mergedWith.length === 0) master.mergedWith = null;
          }
          table.mergedInto = null;
        }
        debouncedSaveFloor();
        render();
        showToast(`پیوند ${tableTitle(table)} تفکیک شد.`, 'info');
      };

      const promptAddFixture = () => {
        const fixturePresets = [
          { type: 'entrance', name: 'ورودی اصلی', icon: '🚪', color: 'emerald', w: 7, h: 10 },
          { type: 'exit', name: 'درب خروج اضطراری', icon: '🚪', color: 'rose', w: 6, h: 8 },
          { type: 'bar', name: 'کافه بار و پیشخوان', icon: '☕', color: 'amber', w: 18, h: 8 },
          { type: 'kitchen', name: 'تحویل غذا و مطبخ', icon: '🍳', color: 'rose', w: 16, h: 8 },
          { type: 'cashier', name: 'صندوق و حسابداری', icon: '💳', color: 'cyan', w: 12, h: 8 },
          { type: 'restroom', name: 'سرویس بهداشتی', icon: '🚻', color: 'purple', w: 10, h: 10 },
          { type: 'wall', name: 'دیوار جداکننده', icon: '🧱', color: 'slate', w: 20, h: 3 },
          { type: 'door', name: 'درب تردد داخلی', icon: '🚪', color: 'slate', w: 6, h: 4 },
          { type: 'stairs', name: 'راه‌پله طبقات', icon: '🪜', color: 'slate', w: 12, h: 10 },
          { type: 'elevator', name: 'آسانسور سالن', icon: '🛗', color: 'blue', w: 8, h: 8 },
          { type: 'pillar', name: 'ستون معماری', icon: '🏛️', color: 'slate', w: 5, h: 5 },
          { type: 'stage', name: 'استیج موسیقی و سن', icon: '🎭', color: 'purple', w: 24, h: 12 },
          { type: 'plant', name: 'گلدان و فضای سبز', icon: '🪴', color: 'emerald', w: 6, h: 6 },
          { type: 'buffet', name: 'بوفه سلف سرویس', icon: '🥗', color: 'amber', w: 22, h: 8 },
        ];

        showFloorModal({
          title: '🏛️ افزودن سازه یا المان معماری به نقشه سالن',
          confirmText: 'افزودن سازه',
          confirmClass: 'btn-primary',
          modalClass: 'floor-studio-modal--wide',
          bodyHtml: `
            <div class="floor-studio-modal__field">
              <label>نوع سازه و المان معماری را انتخاب کنید:</label>
              <div class="floor-studio-modal__shape-grid" id="fm-fixture-types" style="grid-template-columns:repeat(auto-fill,minmax(110px,1fr));max-height:220px;overflow-y:auto">
                ${fixturePresets.map((p, idx) => `
                  <button type="button" class="floor-studio-modal__shape-btn ${idx === 0 ? 'is-active' : ''}" data-type="${p.type}" data-name="${esc(p.name)}" data-icon="${p.icon}" data-color="${p.color}" data-w="${p.w}" data-h="${p.h}">
                    <span style="font-size:20px">${p.icon}</span>
                    <span style="font-size:11px">${esc(p.name)}</span>
                  </button>
                `).join('')}
              </div>
            </div>
            <div class="floor-studio-modal__field" style="margin-top:10px">
              <label for="fm-fixture-name">عنوان روی نقشه:</label>
              <input id="fm-fixture-name" type="text" value="${fixturePresets[0].name}" required />
            </div>
            <div class="floor-studio-modal__dim-row">
              <div class="floor-studio-modal__field">
                <label for="fm-fixture-w">عرض تقریبی (درصد پلان):</label>
                <input id="fm-fixture-w" type="number" min="2" max="80" value="${fixturePresets[0].w}" required />
              </div>
              <div class="floor-studio-modal__field">
                <label for="fm-fixture-h">ارتفاع تقریبی (درصد پلان):</label>
                <input id="fm-fixture-h" type="number" min="2" max="80" value="${fixturePresets[0].h}" required />
              </div>
            </div>
          `,
          onConfirm: async (form) => {
            const activeBtn = form.querySelector('#fm-fixture-types .is-active');
            const type = activeBtn?.dataset?.type || 'wall';
            const icon = activeBtn?.dataset?.icon || '🏛️';
            const color = activeBtn?.dataset?.color || 'slate';
            const name = form.querySelector('#fm-fixture-name')?.value?.trim() || 'سازه';
            const w = Math.max(3, Math.min(80, parseFloat(form.querySelector('#fm-fixture-w')?.value) || 10));
            const h = Math.max(3, Math.min(80, parseFloat(form.querySelector('#fm-fixture-h')?.value) || 10));

            pushHistory();
            const newFixture = {
              id: `fix-${Date.now()}`,
              type,
              name,
              icon,
              color,
              w,
              h,
              x: 45,
              y: 45,
              rotation: 0,
              floorId: activeFloorId,
            };
            floorFixtures.push(newFixture);
            selectedFixtureId = newFixture.id;
            await saveFloorLayout(true);
            render();
            showToast(`سازه «${name}» به نقشه افزوده شد.`, 'success');
            return true;
          }
        });

        setTimeout(() => {
          const grid = document.getElementById('fm-fixture-types');
          grid?.querySelectorAll('.floor-studio-modal__shape-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
              grid.querySelectorAll('.floor-studio-modal__shape-btn').forEach((b) => b.classList.remove('is-active'));
              btn.classList.add('is-active');
              const nameInput = document.getElementById('fm-fixture-name');
              const wInput = document.getElementById('fm-fixture-w');
              const hInput = document.getElementById('fm-fixture-h');
              if (nameInput && btn.dataset.name) nameInput.value = btn.dataset.name;
              if (wInput && btn.dataset.w) wInput.value = btn.dataset.w;
              if (hInput && btn.dataset.h) hInput.value = btn.dataset.h;
            });
          });
        }, 60);
      };

      const deleteFixture = (fixtureId) => {
        pushHistory();
        floorFixtures = floorFixtures.filter((f) => f.id !== fixtureId);
        if (selectedFixtureId === fixtureId) selectedFixtureId = null;
        debouncedSaveFloor();
        render();
        showToast('سازه از نقشه حذف گردید.', 'info');
      };

      const alignSelectedTables = (alignment) => {
        const ids = Array.from(selectedTableIds).map(Number).filter(Boolean);
        if (ids.length < 2) return;
        const list = tables.filter((t) => ids.includes(Number(t.id)));
        if (list.length < 2) return;

        pushHistory();
        if (alignment === 'align-left') {
          const minX = Math.min(...list.map((t) => t.x));
          list.forEach((t) => { t.x = minX; });
        } else if (alignment === 'align-right') {
          const maxX = Math.max(...list.map((t) => t.x));
          list.forEach((t) => { t.x = maxX; });
        } else if (alignment === 'align-top') {
          const minY = Math.min(...list.map((t) => t.y));
          list.forEach((t) => { t.y = minY; });
        } else if (alignment === 'align-bottom') {
          const maxY = Math.max(...list.map((t) => t.y));
          list.forEach((t) => { t.y = maxY; });
        } else if (alignment === 'align-center-x') {
          const avgX = Math.round(list.reduce((sum, t) => sum + t.x, 0) / list.length);
          list.forEach((t) => { t.x = avgX; });
        } else if (alignment === 'align-center-y') {
          const avgY = Math.round(list.reduce((sum, t) => sum + t.y, 0) / list.length);
          list.forEach((t) => { t.y = avgY; });
        }
        debouncedSaveFloor();
        render();
        showToast('هم‌ترازی میزها با موفقیت انجام شد.', 'success');
      };

      const distributeSelectedTables = (axis) => {
        const ids = Array.from(selectedTableIds).map(Number).filter(Boolean);
        if (ids.length < 3) {
          showToast('برای توزیع مساوی، حداقل ۳ میز لازم است.', 'warning');
          return;
        }
        const list = tables.filter((t) => ids.includes(Number(t.id)));
        if (list.length < 3) return;

        pushHistory();
        if (axis === 'h') {
          list.sort((a, b) => a.x - b.x);
          const firstX = list[0].x;
          const lastX = list[list.length - 1].x;
          const step = (lastX - firstX) / (list.length - 1);
          list.forEach((t, i) => {
            t.x = Math.round((firstX + (i * step)) * 10) / 10;
          });
        } else {
          list.sort((a, b) => a.y - b.y);
          const firstY = list[0].y;
          const lastY = list[list.length - 1].y;
          const step = (lastY - firstY) / (list.length - 1);
          list.forEach((t, i) => {
            t.y = Math.round((firstY + (i * step)) * 10) / 10;
          });
        }
        debouncedSaveFloor();
        render();
        showToast('فاصله میزها به طور یکنواخت توزیع شد.', 'success');
      };

      const exportLayoutJson = () => {
        const data = {
          version: '1.2.0',
          exportTimestamp: new Date().toISOString(),
          branchId: currentBranchId,
          settings: floorSettings,
          floors: floorLevels,
          zones: floorZones,
          fixtures: floorFixtures,
          tables: tables.map((t) => ({
            id: t.id,
            label: t.label,
            seats: t.seats,
            zone: t.zone,
            floorId: t.floorId || 'floor-ground',
            shape: t.shape || 'rectangle',
            x: t.x,
            y: t.y,
            rotation: t.rotation || 0,
            active: t.active !== false,
            mergedWith: t.mergedWith || null,
            mergedInto: t.mergedInto || null,
            tags: t.tags || [],
          })),
        };
        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `westo-floor-plan-branch-${currentBranchId || 'default'}-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast('فایل پشتیبان چیدمان سالن با موفقیت دانلود شد.', 'success');
      };

      const importLayoutJson = () => {
        showFloorModal({
          title: '📂 بازیابی و درون‌ریزی فایل چیدمان سالن',
          confirmText: 'اعمال فایل چیدمان',
          confirmClass: 'btn-primary',
          bodyHtml: `
            <p style="font-size:13px;color:#94a3b8;margin:0 0 12px">فایل JSON خروجی گرفته‌شده از استودیو را انتخاب کنید یا محتوای آن را وارد نمایید:</p>
            <div class="floor-studio-modal__field">
              <label for="fm-import-file">انتخاب فایل چیدمان (.json):</label>
              <input id="fm-import-file" type="file" accept=".json,application/json" style="padding:6px;background:rgba(255,255,255,0.05);border-radius:6px" />
            </div>
            <div class="floor-studio-modal__field" style="margin-top:10px">
              <label for="fm-import-text">یا متن JSON را مستقیماً جای‌گذاری کنید:</label>
              <textarea id="fm-import-text" rows="5" placeholder="کدهای JSON را اینجا الصاق کنید..." style="font-family:monospace;font-size:11px"></textarea>
            </div>
          `,
          onConfirm: async (form) => {
            const fileInput = form.querySelector('#fm-import-file');
            const textInput = form.querySelector('#fm-import-text');
            let content = textInput?.value?.trim();

            if (!content && fileInput?.files?.[0]) {
              content = await fileInput.files[0].text();
            }

            if (!content) {
              showToast('لطفاً یک فایل یا متن معتبر وارد کنید.', 'warning');
              return false;
            }

            try {
              const parsed = JSON.parse(content);
              if (!parsed || (!Array.isArray(parsed.tables) && !Array.isArray(parsed.zones))) {
                throw new Error('فرمت فایل پشتیبان معتبر نیست.');
              }
              pushHistory();
              if (Array.isArray(parsed.floors) && parsed.floors.length > 0) {
                floorLevels = parsed.floors;
                activeFloorId = floorLevels[0].id;
              }
              if (Array.isArray(parsed.zones)) {
                floorZones = parsed.zones;
              }
              if (Array.isArray(parsed.fixtures)) {
                floorFixtures = parsed.fixtures;
              }
              if (parsed.settings && typeof parsed.settings === 'object') {
                floorSettings = { ...floorSettings, ...parsed.settings };
              }
              if (Array.isArray(parsed.tables)) {
                tables = parsed.tables.map((t) => {
                  const copy = { ...t };
                  ensureTableGeometry(copy, tables.length);
                  return copy;
                });
              }
              await saveFloorLayout(false);
              render();
              showToast('چیدمان نقشه با موفقیت از فایل بازیابی شد.', 'success');
              return true;
            } catch (err) {
              showToast(err.message || 'خطا در پردازش فایل JSON', 'error');
              return false;
            }
          }
        });

        setTimeout(() => {
          const fileEl = document.getElementById('fm-import-file');
          const textEl = document.getElementById('fm-import-text');
          fileEl?.addEventListener('change', async () => {
            if (fileEl.files?.[0]) {
              try {
                const t = await fileEl.files[0].text();
                if (textEl) textEl.value = t;
              } catch (_) {}
            }
          });
        }, 50);
      };

      const showTemplateModal = () => {
        const templates = [
          {
            id: 'modern-cafe',
            title: 'کافه تریا و بار مدرن',
            icon: '☕',
            desc: 'مناسب کافه‌ها و قهوه‌فروشی‌ها با پیشخوان بار مرکزی، صندلی‌های گرد و مربع، تراس پیاده‌رو و ورودی شیک.',
            zones: [
              { id: 'z-cafe-main', name: 'سالن کافه', x: 2, y: 2, w: 60, h: 96, color: 'amber', icon: '☕', shape: 'rectangle', lengthM: 12, widthM: 8 },
              { id: 'z-cafe-terrace', name: 'تراس پیاده‌رو', x: 64, y: 2, w: 34, h: 96, color: 'emerald', icon: '🌿', shape: 'open-terrace', lengthM: 8, widthM: 4 },
            ],
            fixtures: [
              { id: 'f-bar', type: 'bar', name: 'کافه بار تخصصی', x: 10, y: 6, w: 25, h: 10, rotation: 0, color: 'amber', icon: '☕', floorId: 'floor-ground' },
              { id: 'f-cash', type: 'cashier', name: 'صندوق سفارش', x: 38, y: 6, w: 12, h: 10, rotation: 0, color: 'cyan', icon: '💳', floorId: 'floor-ground' },
              { id: 'f-wc', type: 'restroom', name: 'سرویس', x: 5, y: 84, w: 10, h: 12, rotation: 0, color: 'purple', icon: '🚻', floorId: 'floor-ground' },
              { id: 'f-ent', type: 'entrance', name: 'ورودی اصلی', x: 60, y: 50, w: 4, h: 12, rotation: 90, color: 'emerald', icon: '🚪', floorId: 'floor-ground' },
              { id: 'f-plant', type: 'plant', name: 'فضای سبز', x: 92, y: 6, w: 6, h: 6, rotation: 0, color: 'emerald', icon: '🪴', floorId: 'floor-ground' },
            ],
            tables: [
              { label: 'میز ۱', seats: 2, shape: 'circle', zone: 'سالن کافه', x: 12, y: 28 },
              { label: 'میز ۲', seats: 2, shape: 'circle', zone: 'سالن کافه', x: 26, y: 28 },
              { label: 'میز ۳', seats: 4, shape: 'square', zone: 'سالن کافه', x: 40, y: 28 },
              { label: 'میز ۴', seats: 4, shape: 'square', zone: 'سالن کافه', x: 12, y: 48 },
              { label: 'میز ۵', seats: 4, shape: 'square', zone: 'سالن کافه', x: 26, y: 48 },
              { label: 'میز ۶', seats: 6, shape: 'rectangle', zone: 'سالن کافه', x: 42, y: 52 },
              { label: 'میز بار ۱', seats: 1, shape: 'bar_stool', zone: 'سالن کافه', x: 14, y: 18 },
              { label: 'میز بار ۲', seats: 1, shape: 'bar_stool', zone: 'سالن کافه', x: 22, y: 18 },
              { label: 'میز بار ۳', seats: 1, shape: 'bar_stool', zone: 'سالن کافه', x: 30, y: 18 },
              { label: 'تراس ۱', seats: 2, shape: 'circle', zone: 'تراس پیاده‌رو', x: 74, y: 22 },
              { label: 'تراس ۲', seats: 2, shape: 'circle', zone: 'تراس پیاده‌رو', x: 86, y: 22 },
              { label: 'تراس ۳', seats: 4, shape: 'rectangle', zone: 'تراس پیاده‌رو', x: 74, y: 48 },
              { label: 'تراس ۴', seats: 4, shape: 'rectangle', zone: 'تراس پیاده‌رو', x: 86, y: 48 },
              { label: 'تراس ۵', seats: 4, shape: 'rectangle', zone: 'تراس پیاده‌رو', x: 80, y: 75 },
            ]
          },
          {
            id: 'traditional-persian',
            title: 'رستوران سنتی و سفره‌خانه با تخت‌های شاه‌نشین',
            icon: '🛏️',
            desc: 'طراحی اصیل ایرانی شامل تخت‌های سنتی با قالیچه و پشتی، فضای حوض‌خانه، شاه‌نشین و میزهای خانوادگی.',
            zones: [
              { id: 'z-trad-main', name: 'سالن شاه‌نشین', x: 2, y: 2, w: 68, h: 96, color: 'purple', icon: '👑', shape: 'rectangle', lengthM: 16, widthM: 10 },
              { id: 'z-trad-garden', name: 'باغچه و حیاط سنتی', x: 72, y: 2, w: 26, h: 96, color: 'emerald', icon: '🌿', shape: 'open-terrace', lengthM: 10, widthM: 5 },
            ],
            fixtures: [
              { id: 'f-buffet', type: 'buffet', name: 'بوفه سالاد و دسر سنتی', x: 10, y: 6, w: 22, h: 8, rotation: 0, color: 'amber', icon: '🥗', floorId: 'floor-ground' },
              { id: 'f-cash', type: 'cashier', name: 'صندوق خاتم‌کاری', x: 42, y: 6, w: 12, h: 8, rotation: 0, color: 'cyan', icon: '💳', floorId: 'floor-ground' },
              { id: 'f-stage', type: 'stage', name: 'جایگاه اجرای موسیقی زنده سنتی', x: 8, y: 84, w: 26, h: 12, rotation: 0, color: 'purple', icon: '🎭', floorId: 'floor-ground' },
              { id: 'f-wc', type: 'restroom', name: 'سرویس بهداشتی', x: 58, y: 86, w: 10, h: 10, rotation: 0, color: 'purple', icon: '🚻', floorId: 'floor-ground' },
              { id: 'f-ent', type: 'entrance', name: 'ورودی طاق‌دار سنتی', x: 68, y: 50, w: 4, h: 12, rotation: 90, color: 'emerald', icon: '🚪', floorId: 'floor-ground' },
            ],
            tables: [
              { label: 'تخت ۱ شاه‌نشین', seats: 8, shape: 'lounge_takht', zone: 'سالن شاه‌نشین', x: 14, y: 26 },
              { label: 'تخت ۲ شاه‌نشین', seats: 8, shape: 'lounge_takht', zone: 'سالن شاه‌نشین', x: 34, y: 26 },
              { label: 'تخت ۳ شاه‌نشین', seats: 8, shape: 'lounge_takht', zone: 'سالن شاه‌نشین', x: 54, y: 26 },
              { label: 'تخت ۴ حوض‌خانه', seats: 8, shape: 'lounge_takht', zone: 'سالن شاه‌نشین', x: 14, y: 54 },
              { label: 'تخت ۵ حوض‌خانه', seats: 8, shape: 'lounge_takht', zone: 'سالن شاه‌نشین', x: 34, y: 54 },
              { label: 'تخت ۶ حوض‌خانه', seats: 8, shape: 'lounge_takht', zone: 'سالن شاه‌نشین', x: 54, y: 54 },
              { label: 'میز خانوادگی ۱', seats: 6, shape: 'rectangle', zone: 'سالن شاه‌نشین', x: 42, y: 78 },
              { label: 'آلاچیق ۱', seats: 6, shape: 'lounge_takht', zone: 'باغچه و حیاط سنتی', x: 84, y: 22 },
              { label: 'آلاچیق ۲', seats: 6, shape: 'lounge_takht', zone: 'باغچه و حیاط سنتی', x: 84, y: 50 },
              { label: 'آلاچیق ۳', seats: 6, shape: 'lounge_takht', zone: 'باغچه و حیاط سنتی', x: 84, y: 78 },
            ]
          },
          {
            id: 'fast-casual',
            title: 'فست‌فود و برگر زنجیره‌ای',
            icon: '🍔',
            desc: 'گردش سریع مشتری با نیمکت‌های باجه‌ای، پیشخوان تحویل سریع، دو باجه صندوق و میزهای استاندارد.',
            zones: [
              { id: 'z-ff-dining', name: 'سالن نشیمن باجه‌ای', x: 2, y: 2, w: 66, h: 96, color: 'rose', icon: '🛋️', shape: 'rectangle', lengthM: 14, widthM: 9 },
              { id: 'z-ff-order', name: 'محوطه سفارش و تحویل', x: 70, y: 2, w: 28, h: 96, color: 'cyan', icon: '⚡', shape: 'corridor', lengthM: 14, widthM: 4 },
            ],
            fixtures: [
              { id: 'f-kitchen', type: 'kitchen', name: 'تحویل سفارش و آشپزخانه', x: 74, y: 10, w: 20, h: 14, rotation: 0, color: 'rose', icon: '🍳', floorId: 'floor-ground' },
              { id: 'f-cash1', type: 'cashier', name: 'صندوق ۱ (سفارش حضوری)', x: 74, y: 32, w: 20, h: 8, rotation: 0, color: 'cyan', icon: '💳', floorId: 'floor-ground' },
              { id: 'f-cash2', type: 'cashier', name: 'صندوق ۲ (پیک و اسنپ)', x: 74, y: 46, w: 20, h: 8, rotation: 0, color: 'cyan', icon: '💳', floorId: 'floor-ground' },
              { id: 'f-wc', type: 'restroom', name: 'سرویس بهداشتی', x: 74, y: 82, w: 18, h: 12, rotation: 0, color: 'purple', icon: '🚻', floorId: 'floor-ground' },
              { id: 'f-ent', type: 'entrance', name: 'درب ورودی و خروج', x: 67, y: 68, w: 4, h: 12, rotation: 90, color: 'emerald', icon: '🚪', floorId: 'floor-ground' },
            ],
            tables: [
              { label: 'باکس ۱', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 12, y: 16 },
              { label: 'باکس ۲', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 30, y: 16 },
              { label: 'باکس ۳', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 48, y: 16 },
              { label: 'باکس ۴', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 12, y: 40 },
              { label: 'باکس ۵', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 30, y: 40 },
              { label: 'باکس ۶', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 48, y: 40 },
              { label: 'باکس ۷', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 12, y: 66 },
              { label: 'باکس ۸', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 30, y: 66 },
              { label: 'باکس ۹', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 48, y: 66 },
              { label: 'میز طولی ۱۰', seats: 6, shape: 'rectangle', zone: 'سالن نشیمن باجه‌ای', x: 24, y: 86 },
              { label: 'میز طولی ۱۱', seats: 6, shape: 'rectangle', zone: 'سالن نشیمن باجه‌ای', x: 48, y: 86 },
            ]
          },
          {
            id: 'fine-dining',
            title: 'فاین داینینگ و استیک‌هاوس مجلل',
            icon: '🍷',
            desc: 'محیط لوکس با میزهای بیضی و گرد بزرگ، اتاق خصوصی VIP، ستون‌های مرمری و بار نوشیدنی مجلل.',
            zones: [
              { id: 'z-fd-main', name: 'سالن اصلی مجلل', x: 2, y: 2, w: 68, h: 96, color: 'blue', icon: '🍷', shape: 'rectangle', lengthM: 18, widthM: 12 },
              { id: 'z-fd-vip', name: 'سالن اختصاصی VIP', x: 72, y: 2, w: 26, h: 96, color: 'purple', icon: '👑', shape: 'rectangle', lengthM: 10, widthM: 6 },
            ],
            fixtures: [
              { id: 'f-bar', type: 'bar', name: 'بار مجلل نوشیدنی و پیانو', x: 8, y: 8, w: 24, h: 10, rotation: 0, color: 'amber', icon: '🍷', floorId: 'floor-ground' },
              { id: 'f-pillar1', type: 'pillar', name: 'ستون مرمر', x: 32, y: 35, w: 4, h: 4, rotation: 0, color: 'slate', icon: '🏛️', floorId: 'floor-ground' },
              { id: 'f-pillar2', type: 'pillar', name: 'ستون مرمر', x: 32, y: 65, w: 4, h: 4, rotation: 0, color: 'slate', icon: '🏛️', floorId: 'floor-ground' },
              { id: 'f-cash', type: 'cashier', name: 'پذیرش و مهمانداری', x: 40, y: 8, w: 16, h: 8, rotation: 0, color: 'cyan', icon: '💳', floorId: 'floor-ground' },
              { id: 'f-ent', type: 'entrance', name: 'ورودی اصلی تشریفات', x: 69, y: 50, w: 4, h: 14, rotation: 90, color: 'emerald', icon: '🚪', floorId: 'floor-ground' },
            ],
            tables: [
              { label: 'میز گرد ۱', seats: 4, shape: 'circle', zone: 'سالن اصلی مجلل', x: 14, y: 32 },
              { label: 'میز گرد ۲', seats: 4, shape: 'circle', zone: 'سالن اصلی مجلل', x: 14, y: 56 },
              { label: 'میز گرد ۳', seats: 4, shape: 'circle', zone: 'سالن اصلی مجلل', x: 14, y: 80 },
              { label: 'میز سلطنتی ۴', seats: 8, shape: 'oval', zone: 'سالن اصلی مجلل', x: 50, y: 32 },
              { label: 'میز سلطنتی ۵', seats: 8, shape: 'oval', zone: 'سالن اصلی مجلل', x: 50, y: 65 },
              { label: 'شاه‌نشین VIP ۱', seats: 10, shape: 'oval', zone: 'سالن اختصاصی VIP', x: 85, y: 30 },
              { label: 'شاه‌نشین VIP ۲', seats: 8, shape: 'circle', zone: 'سالن اختصاصی VIP', x: 85, y: 68 },
            ]
          },
          {
            id: 'rooftop-lounge',
            title: 'روف‌گاردن و لانژ مرتفع',
            icon: '☀️',
            desc: 'فضای روباز طبقه بالا، چشم‌انداز شهری، مبلمان لانژ و تخت‌های آفتابگیر، بار روباز و گیاهان سرسبز.',
            zones: [
              { id: 'z-roof-deck', name: 'تراس مرتفع و لانژ', x: 2, y: 2, w: 96, h: 96, color: 'cyan', icon: '☀️', shape: 'open-terrace', lengthM: 20, widthM: 14 },
            ],
            fixtures: [
              { id: 'f-roof-bar', type: 'bar', name: 'بار روباز روف‌گاردن', x: 38, y: 6, w: 26, h: 10, rotation: 0, color: 'cyan', icon: '🍹', floorId: 'floor-ground' },
              { id: 'f-elev', type: 'elevator', name: 'ورودی آسانسور اختصاصی بام', x: 6, y: 6, w: 12, h: 12, rotation: 0, color: 'blue', icon: '🛗', floorId: 'floor-ground' },
              { id: 'f-plant1', type: 'plant', name: 'باغچه عمودی و گیاهان', x: 6, y: 84, w: 16, h: 8, rotation: 0, color: 'emerald', icon: '🪴', floorId: 'floor-ground' },
              { id: 'f-plant2', type: 'plant', name: 'باغچه عمودی و گیاهان', x: 78, y: 84, w: 16, h: 8, rotation: 0, color: 'emerald', icon: '🪴', floorId: 'floor-ground' },
            ],
            tables: [
              { label: 'لانژ آفتاب ۱', seats: 6, shape: 'lounge_takht', zone: 'تراس مرتفع و لانژ', x: 16, y: 32 },
              { label: 'لانژ آفتاب ۲', seats: 6, shape: 'lounge_takht', zone: 'تراس مرتفع و لانژ', x: 16, y: 60 },
              { label: 'میز ویو ۳', seats: 4, shape: 'circle', zone: 'تراس مرتفع و لانژ', x: 42, y: 32 },
              { label: 'میز ویو ۴', seats: 4, shape: 'circle', zone: 'تراس مرتفع و لانژ', x: 58, y: 32 },
              { label: 'میز ویو ۵', seats: 4, shape: 'circle', zone: 'تراس مرتفع و لانژ', x: 42, y: 60 },
              { label: 'میز ویو ۶', seats: 4, shape: 'circle', zone: 'تراس مرتفع و لانژ', x: 58, y: 60 },
              { label: 'لانژ افق ۷', seats: 6, shape: 'lounge_takht', zone: 'تراس مرتفع و لانژ', x: 84, y: 32 },
              { label: 'لانژ افق ۸', seats: 6, shape: 'lounge_takht', zone: 'تراس مرتفع و لانژ', x: 84, y: 60 },
            ]
          },
          {
            id: 'banquet-hall',
            title: 'تالار پذیرایی و همایش‌های تشریفاتی',
            icon: '🏛️',
            desc: 'میزهای گرد ضیافتی بزرگ (۸ و ۱۰ نفره)، استیج و سن اجرا، خطوط بوفه پذیرایی و ظرفیت بالا.',
            zones: [
              { id: 'z-bq-hall', name: 'تالار اصلی ضیافت', x: 2, y: 2, w: 96, h: 96, color: 'purple', icon: '🏛️', shape: 'rectangle', lengthM: 25, widthM: 18 },
            ],
            fixtures: [
              { id: 'f-stage', type: 'stage', name: 'سن و جایگاه ویژه مراسم', x: 30, y: 5, w: 40, h: 14, rotation: 0, color: 'purple', icon: '🎭', floorId: 'floor-ground' },
              { id: 'f-buff1', type: 'buffet', name: 'لاین بوفه شام ۱', x: 5, y: 25, w: 8, h: 48, rotation: 0, color: 'amber', icon: '🥗', floorId: 'floor-ground' },
              { id: 'f-buff2', type: 'buffet', name: 'لاین بوفه شام ۲', x: 87, y: 25, w: 8, h: 48, rotation: 0, color: 'amber', icon: '🥗', floorId: 'floor-ground' },
              { id: 'f-ent', type: 'entrance', name: 'درب‌های دوتایی ورودی تشریفات', x: 42, y: 92, w: 16, h: 6, rotation: 0, color: 'emerald', icon: '🚪', floorId: 'floor-ground' },
            ],
            tables: [
              { label: 'میز ۱۰۱', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 25, y: 30 },
              { label: 'میز ۱۰۲', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 45, y: 30 },
              { label: 'میز ۱۰۳', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 65, y: 30 },
              { label: 'میز ۱۰۴', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 25, y: 50 },
              { label: 'میز ۱۰۵', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 45, y: 50 },
              { label: 'میز ۱۰۶', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 65, y: 50 },
              { label: 'میز ۱۰۷', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 25, y: 70 },
              { label: 'میز ۱۰۸', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 45, y: 70 },
              { label: 'میز ۱۰۹', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 65, y: 70 },
            ]
          }
        ];

        showFloorModal({
          title: '📋 انتخاب قالب و الگوی معماری آماده رستوران',
          confirmText: 'اعمال این قالب روی سالن',
          confirmClass: 'btn-primary',
          modalClass: 'floor-studio-modal--wide',
          bodyHtml: `
            <p style="font-size:13px;color:#94a3b8;margin:0 0 12px">یک قالب استاندارد را برای چیدمان فوری و حرفه‌ای رستوران انتخاب کنید:</p>
            <div class="floor-template-grid" id="fm-templates-grid">
              ${templates.map((tpl, idx) => `
                <div class="floor-template-card ${idx === 0 ? 'is-selected' : ''}" data-tpl-id="${tpl.id}">
                  <div class="floor-template-card__head">
                    <span style="font-size:24px">${tpl.icon}</span>
                    <strong style="font-size:14px;color:#f8fafc">${esc(tpl.title)}</strong>
                  </div>
                  <p style="font-size:11px;color:#94a3b8;margin:6px 0 10px;line-height:1.5">${esc(tpl.desc)}</p>
                  <div style="font-size:11px;color:#38bdf8;font-weight:700">
                    <span>📐 ${fmtNum(tpl.tables.length)} میز · ${fmtNum(tpl.fixtures.length)} سازه معماری</span>
                  </div>
                </div>
              `).join('')}
            </div>
            <p style="font-size:12px;color:#fb7185;margin:12px 0 0">توجه: اعمال قالب، میزها، بخش‌ها و سازه‌های معماری فعلی این شعبه را جایگزین خواهد کرد. قبل از اعمال، تاریخچه قبلی ذخیره می‌گردد.</p>
          `,
          onConfirm: async (form) => {
            const selectedEl = form.querySelector('.floor-template-card.is-selected');
            const tplId = selectedEl?.dataset?.tplId;
            const tpl = templates.find((t) => t.id === tplId);
            if (!tpl) return false;

            pushHistory();
            floorZones = tpl.zones.map((z) => ({ ...z }));
            floorFixtures = tpl.fixtures.map((f) => ({ ...f }));
            tables = tpl.tables.map((t, idx) => {
              const item = {
                id: idx + 1,
                label: t.label,
                seats: t.seats,
                zone: t.zone,
                shape: t.shape,
                x: t.x,
                y: t.y,
                rotation: 0,
                active: true,
                floorId: 'floor-ground',
                state: 'available',
                stateLabel: 'آزاد',
              };
              ensureTableGeometry(item, idx);
              return item;
            });

            selectedTableId = null;
            activeZone = 'all';
            await saveFloorLayout(false);
            render();
            showToast(`قالب «${tpl.title}» با موفقیت روی نقشه اعمال گردید.`, 'success');
            return true;
          }
        });

        setTimeout(() => {
          const grid = document.getElementById('fm-templates-grid');
          grid?.querySelectorAll('.floor-template-card').forEach((card) => {
            card.addEventListener('click', () => {
              grid.querySelectorAll('.floor-template-card').forEach((c) => c.classList.remove('is-selected'));
              card.classList.add('is-selected');
            });
          });
        }, 50);
      };

      const promptFloorSettings = () => {
        showFloorModal({
          title: '⚙️ تنظیمات معماری و مقیاس نقشه سالن',
          confirmText: 'ذخیره تنظیمات',
          confirmClass: 'btn-primary',
          bodyHtml: `
            <div class="floor-studio-modal__dim-row">
              <div class="floor-studio-modal__field">
                <label for="fm-sett-len">طول کلی سالن (متر):</label>
                <input id="fm-sett-len" type="number" min="5" max="200" step="0.5" value="${floorSettings.lengthM || 20}" required />
              </div>
              <div class="floor-studio-modal__field">
                <label for="fm-sett-wid">عرض کلی سالن (متر):</label>
                <input id="fm-sett-wid" type="number" min="5" max="200" step="0.5" value="${floorSettings.widthM || 15}" required />
              </div>
            </div>
            <div class="floor-studio-modal__field" style="margin-top:10px">
              <label for="fm-sett-theme">تم گرافیکی و رنگ پس‌زمینه نقشه:</label>
              <select id="fm-sett-theme">
                <option value="slate-blueprint" ${floorSettings.bgTheme === 'slate-blueprint' ? 'selected' : ''}>نقشه مهندسی تیره (Blueprint Dark)</option>
                <option value="midnight-dark" ${floorSettings.bgTheme === 'midnight-dark' ? 'selected' : ''}>مشکی شبانه لوکس (Midnight Black)</option>
                <option value="warm-luxury" ${floorSettings.bgTheme === 'warm-luxury' ? 'selected' : ''}>چوب گرم و کلاسیک (Warm Luxury)</option>
                <option value="paper-white" ${floorSettings.bgTheme === 'paper-white' ? 'selected' : ''}>کاغذ سفید CAD (Clean White)</option>
              </select>
            </div>
            <div class="floor-studio-modal__field" style="margin-top:12px">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" id="fm-sett-rulers" ${floorSettings.showRulers !== false ? 'checked' : ''} />
                <span>نمایش خط‌کش متراژ مهندسی (CAD Rulers) دور نقشه</span>
              </label>
            </div>
            <div class="floor-studio-modal__field" style="margin-top:6px">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" id="fm-sett-grid" ${floorSettings.showGrid !== false ? 'checked' : ''} />
                <span>نمایش خطوط شطرنجی و شبکه هدایتگر (Grid Lines)</span>
              </label>
            </div>
          `,
          onConfirm: async (form) => {
            const lengthM = parseFloat(form.querySelector('#fm-sett-len')?.value) || 20;
            const widthM = parseFloat(form.querySelector('#fm-sett-wid')?.value) || 15;
            const bgTheme = form.querySelector('#fm-sett-theme')?.value || 'slate-blueprint';
            const showRulers = form.querySelector('#fm-sett-rulers')?.checked;
            const showGrid = form.querySelector('#fm-sett-grid')?.checked;

            floorSettings = {
              ...floorSettings,
              lengthM,
              widthM,
              bgTheme,
              showRulers,
              showGrid,
            };
            await saveFloorLayout(true);
            render();
            showToast('تنظیمات مقیاس و ظاهر نقشه سالن به‌روز شد.', 'success');
            return true;
          }
        });
      };

      const renderSvgConnectors = () => {
        let lines = '';
        tables.forEach((t) => {
          if (t.mergedWith && Array.isArray(t.mergedWith)) {
            t.mergedWith.forEach((subId) => {
              const sub = tableById(subId);
              if (sub && (t.floorId || 'floor-ground') === (sub.floorId || 'floor-ground') && (activeFloorId === (t.floorId || 'floor-ground'))) {
                lines += `<line x1="${t.x}%" y1="${t.y}%" x2="${sub.x}%" y2="${sub.y}%" class="plan-table-connector-line" stroke="#38bdf8" stroke-width="3" stroke-dasharray="6,4" opacity="0.85" />`;
              }
            });
          }
        });
        return lines;
      };

      const renderRulerTicksX = (totalMeters) => {
        const m = Math.max(10, Math.min(100, Number(totalMeters) || 20));
        let html = '';
        for (let i = 0; i <= m; i += 2) {
          const pct = (i / m) * 100;
          html += `<div class="floor-ruler-tick floor-ruler-tick--x" style="left:${pct.toFixed(1)}%"><span class="floor-ruler-tick__label">${fmtNum(i)}م</span></div>`;
        }
        return html;
      };

      const renderRulerTicksY = (totalMeters) => {
        const m = Math.max(8, Math.min(80, Number(totalMeters) || 15));
        let html = '';
        for (let i = 0; i <= m; i += 2) {
          const pct = (i / m) * 100;
          html += `<div class="floor-ruler-tick floor-ruler-tick--y" style="top:${pct.toFixed(1)}%"><span class="floor-ruler-tick__label">${fmtNum(i)}م</span></div>`;
        }
        return html;
      };

      const renderFixtureItem = (fixture) => {
        const isSelected = selectedFixtureId === fixture.id;
        const isNearTop = Number(fixture.y) < 20;
        const paletteHtml = (isSelected && isEditMode) ? `
          <div class="fixture-floating-palette" data-flip-down="${isNearTop}">
            <button type="button" data-fixture-action="rotate" title="چرخش ۴۵ درجه">↻ ۴۵°</button>
            <button type="button" data-fixture-action="delete" title="حذف سازه" style="color:#f43f5e">🗑️ حذف</button>
            <button type="button" data-fixture-action="close" title="بستن">✕</button>
          </div>` : '';

        return `
          <div class="plan-fixture plan-fixture--${esc(fixture.type)} plan-fixture--${esc(fixture.color || 'slate')} ${isSelected ? 'is-selected' : ''}"
               data-fixture-id="${esc(fixture.id)}"
               style="left:${fixture.x}%; top:${fixture.y}%; width:${fixture.w}%; height:${fixture.h}%; transform: rotate(${fixture.rotation || 0}deg); --fixture-rot: ${fixture.rotation || 0}deg;"
               title="${esc(fixture.name || fixture.type)}">
            <div class="plan-fixture-content">
              <span class="plan-fixture-icon">${esc(fixture.icon || '🏛️')}</span>
              <span class="plan-fixture-label">${esc(fixture.name || '')}</span>
            </div>
            ${paletteHtml}
            ${isEditMode ? `
              <div class="fixture-handle fixture-handle--se" data-handle="se" data-fixture-id="${esc(fixture.id)}"></div>
            ` : ''}
          </div>`;
      };

      const shapeLabel = (s) => ({
        rectangle: '⬛ مستطیل استاندارد',
        conference: '🏛️ کنفرانس و تشریفات',
        semi_circle: '🌙 نیم‌دایره و هلال',
        wall_counter: '🪟 کانتر دیواری',
        round_booth: '🛋️ مبل گرد نعل‌اسبی',
        circle: '⭕ گرد',
        square: '⏹️ مربع',
        booth: '🛋️ نیمکت VIP',
        bar_stool: '🍸 صندلی بار',
        oval: '🥚 بیضی تشریفاتی',
        lounge_takht: '🛏️ تخت سنتی',
        'open-terrace': '🌿 تراس و فضای باز',
        'l-shape': '◱ ال‌شکل',
        corridor: '▭ طولی و راهرویی',
      }[s] || '⬛ مستطیل');

      const shapeIcon = (s) => ({
        rectangle: '⬛',
        conference: '🏛️',
        semi_circle: '🌙',
        wall_counter: '🪟',
        round_booth: '🛋️',
        circle: '⭕',
        square: '⏹️',
        booth: '🛋️',
        bar_stool: '🍸',
        oval: '🥚',
        lounge_takht: '🛏️',
      }[s] || '⬛');

      const shapeTitle = (s) => ({
        rectangle: 'مستطیل',
        conference: 'کنفرانس',
        semi_circle: 'نیم‌دایره',
        wall_counter: 'کانتر دیواری',
        round_booth: 'مبل گرد',
        circle: 'گرد',
        square: 'مربع',
        booth: 'نیمکت VIP',
        bar_stool: 'صندلی بار',
        oval: 'بیضی',
        lounge_takht: 'تخت سنتی',
      }[s] || 'مستطیل');

      const chairLabel = (m) => ({
        standard: '🪑 استاندارد',
        armchair: '🛋️ مبل دسته‌دار',
        bar_stool: '🍸 صندلی بار',
        booth_bench: '🧽 نیمکت چرمی',
        bolster: '🪡 متکای سنتی',
      }[m] || '🪑 استاندارد');

      const chairIcon = (m) => ({
        standard: '🪑',
        armchair: '🛋️',
        bar_stool: '🍸',
        booth_bench: '🧽',
        bolster: '🪡',
      }[m] || '🪑');

      const promptTableFurnitureModal = (table) => {
        let curShape = table.shape || 'rectangle';
        let curChair = table.chairModel || (curShape === 'bar_stool' || curShape === 'wall_counter' ? 'bar_stool' : curShape === 'lounge_takht' ? 'bolster' : 'standard');
        let curSeats = Math.max(1, Math.min(24, Number(table.seats) || 4));

        const shapesDef = [
          { id: 'rectangle', name: 'مستطیل استاندارد', icon: '⬛', desc: 'کلاسیک رستورانی، ۲ تا ۱۲ نفر' },
          { id: 'conference', name: 'میز کنفرانس و تشریفات', icon: '🏛️', desc: 'یک‌تکه بزرگ، ۶ تا ۲۴ نفر با صندلی صدر' },
          { id: 'semi_circle', name: 'نیم‌دایره و هلال', icon: '🌙', desc: 'مبل هلالی با نشیمن شعاعی دورچین' },
          { id: 'wall_counter', name: 'کانتر کنار دیواری', icon: '🪟', desc: 'میز یک‌طرفه متصل به دیوار یا پنجره' },
          { id: 'round_booth', name: 'مبل گرد نعل‌اسبی', icon: '🛋️', desc: 'نیمکت منحنی سرتاسری با میز گرد' },
          { id: 'circle', name: 'میز گرد', icon: '⭕', desc: 'صمیمی و ارگونومیک، ۲ تا ۱۰ نفر' },
          { id: 'square', name: 'میز مربع', icon: '⏹️', desc: 'کافه و دونفره، ۲ تا ۸ نفر' },
          { id: 'booth', name: 'نیمکت و مبل VIP', icon: '🛋️', desc: 'پشتی لمسه‌کوبی روبه‌روی هم' },
          { id: 'bar_stool', name: 'صندلی بار و کانتر', icon: '🍸', desc: 'پایه بلند و کم‌جا' },
          { id: 'oval', name: 'بیضی تشریفاتی', icon: '🥚', desc: 'مهمانی و سالن اصلی' },
          { id: 'lounge_takht', name: 'تخت سنتی ایرانی', icon: '🛏️', desc: 'تخت چوبی با فرش و پشتی' },
        ];

        const chairsDef = [
          { id: 'standard', name: 'صندلی استاندارد رستورانی', icon: '🪑' },
          { id: 'armchair', name: 'مبل تک‌نفره دسته‌دار لوکس', icon: '🛋️' },
          { id: 'bar_stool', name: 'صندلی پایه بلند بار و کانتر', icon: '🍸' },
          { id: 'booth_bench', name: 'نیمکت چرمی پیوسته', icon: '🧽' },
          { id: 'bolster', name: 'پشتی و متکای سنتی', icon: '🪡' },
        ];

        const bodyHtml = `
          <div class="furniture-grid-group">
            <span class="furniture-grid-group__title">📐 انتخاب فرم هندسی میز:</span>
            <div class="furniture-shapes-grid" id="fm-shapes-grid">
              ${shapesDef.map((s) => `
                <div class="furniture-shape-card ${curShape === s.id ? 'is-active' : ''}" data-shape-choice="${s.id}">
                  <span class="furniture-shape-card__icon">${s.icon}</span>
                  <span class="furniture-shape-card__name">${s.name}</span>
                  <span class="furniture-shape-card__desc">${s.desc}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="furniture-grid-group">
            <span class="furniture-grid-group__title">🪑 مدل و استایل صندلی‌ها:</span>
            <div class="furniture-chairs-row" id="fm-chairs-row">
              ${chairsDef.map((c) => `
                <div class="furniture-chair-pill ${curChair === c.id ? 'is-active' : ''}" data-chair-choice="${c.id}">
                  <span>${c.icon}</span>
                  <span>${c.name}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="furniture-grid-group">
            <span class="furniture-grid-group__title">👥 ظرفیت صندلی‌ها:</span>
            <div class="furniture-seats-stepper">
              <button type="button" class="palette-mini-btn" id="fm-seat-dec">−</button>
              <input type="number" id="fm-seats-input" min="1" max="24" value="${curSeats}" style="width:55px;text-align:center;background:#1e293b;border:1px solid rgba(255,255,255,0.2);color:#fff;border-radius:6px;font-weight:900">
              <button type="button" class="palette-mini-btn" id="fm-seat-inc">＋</button>
              <span style="font-size:11px;color:#94a3b8">نفر</span>
            </div>
            <div class="furniture-seats-presets">
              ${[1, 2, 4, 6, 8, 10, 12, 16, 20, 24].map((cnt) => `
                <button type="button" class="furniture-seat-preset ${curSeats === cnt ? 'is-active' : ''}" data-seat-preset="${cnt}">${fmtNum(cnt)} نفره</button>
              `).join('')}
            </div>
          </div>
        `;

        showFloorModal({
          title: `🛋️ استودیوی چیدمان مبلمان و صندلی (${esc(tableTitle(table))})`,
          confirmText: 'اعمال روی میز و ذخیره',
          confirmClass: 'btn-primary',
          modalClass: 'floor-studio-modal--wide',
          bodyHtml,
          onConfirm: () => {
            pushHistory('تغییر مبلمان و صندلی');
            table.shape = curShape;
            table.chairModel = curChair;
            table.seats = curSeats;
            setUnsavedStatus();
            render();
            showToast(`فرم «${shapeTitle(curShape)}» با ${curSeats} صندلی ${chairLabel(curChair)} اعمال شد.`, 'success');
            return true;
          }
        });

        // Dynamic interactive bindings inside the modal
        const modalEl = document.getElementById('floor-modal-backdrop');
        if (modalEl) {
          modalEl.querySelectorAll('[data-shape-choice]').forEach((card) => {
            card.addEventListener('click', () => {
              curShape = card.dataset.shapeChoice;
              modalEl.querySelectorAll('[data-shape-choice]').forEach((c) => c.classList.toggle('is-active', c === card));
              if (curShape === 'bar_stool' || curShape === 'wall_counter') curChair = 'bar_stool';
              else if (curShape === 'lounge_takht') curChair = 'bolster';
              modalEl.querySelectorAll('[data-chair-choice]').forEach((c) => c.classList.toggle('is-active', c.dataset.chairChoice === curChair));
            });
          });

          modalEl.querySelectorAll('[data-chair-choice]').forEach((pill) => {
            pill.addEventListener('click', () => {
              curChair = pill.dataset.chairChoice;
              modalEl.querySelectorAll('[data-chair-choice]').forEach((p) => p.classList.toggle('is-active', p === pill));
            });
          });

          const seatInp = modalEl.querySelector('#fm-seats-input');
          const syncSeats = (val) => {
            curSeats = Math.max(1, Math.min(24, val));
            if (seatInp) seatInp.value = curSeats;
            modalEl.querySelectorAll('[data-seat-preset]').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.seatPreset) === curSeats));
          };

          modalEl.querySelector('#fm-seat-dec')?.addEventListener('click', () => syncSeats(curSeats - 1));
          modalEl.querySelector('#fm-seat-inc')?.addEventListener('click', () => syncSeats(curSeats + 1));
          seatInp?.addEventListener('input', () => syncSeats(Number(seatInp.value) || 1));

          modalEl.querySelectorAll('[data-seat-preset]').forEach((btn) => {
            btn.addEventListener('click', () => syncSeats(Number(btn.dataset.seatPreset)));
          });
        }
      };

      const promptAddZone = () => {
        showFloorModal({
          title: '🌿 تعریف بخش جدید در سالن و تعیین متراژ',
          confirmText: 'ایجاد و چیدمان بخش',
          confirmClass: 'btn-primary',
          bodyHtml: `
            <div class="floor-studio-modal__field">
              <label for="fm-zone-name">نام بخش جدید سالن:</label>
              <input id="fm-zone-name" type="text" placeholder="مثال: تراس و فضای باز، روف گاردن، سالن VIP" value="تراس و فضای باز" required autofocus />
              <div class="floor-studio-modal__presets">
                <span style="font-size:11px;color:#94a3b8;margin-left:4px">پیشنهادها:</span>
                <button type="button" class="floor-studio-modal__preset-pill" data-preset-name="تراس و فضای باز" data-preset-icon="🌿" data-preset-l="10" data-preset-w="3" data-preset-color="emerald" data-preset-shape="open-terrace">🌿 تراس (۱۰×۳م)</button>
                <button type="button" class="floor-studio-modal__preset-pill" data-preset-name="روف‌گاردن و بام" data-preset-icon="☀️" data-preset-l="12" data-preset-w="8" data-preset-color="cyan" data-preset-shape="open-terrace">☀️ روف‌گاردن (۱۲×۸م)</button>
                <button type="button" class="floor-studio-modal__preset-pill" data-preset-name="سالن اختصاصی VIP" data-preset-icon="👑" data-preset-l="8" data-preset-w="5" data-preset-color="purple" data-preset-shape="rectangle">👑 سالن VIP (۸×۵م)</button>
                <button type="button" class="floor-studio-modal__preset-pill" data-preset-name="کافه بار و پیشخوان" data-preset-icon="☕" data-preset-l="6" data-preset-w="2.5" data-preset-color="amber" data-preset-shape="corridor">☕ کافه بار (۶×۲.۵م)</button>
              </div>
            </div>

            <div class="floor-studio-modal__dim-row">
              <div class="floor-studio-modal__field">
                <label for="fm-zone-len">طول بخش (متر):</label>
                <input id="fm-zone-len" type="number" min="1" max="200" step="0.5" value="10" required />
              </div>
              <div class="floor-studio-modal__field">
                <label for="fm-zone-wid">عرض بخش (متر):</label>
                <input id="fm-zone-wid" type="number" min="1" max="200" step="0.5" value="3" required />
              </div>
            </div>

            <div class="floor-studio-modal__area-badge" id="fm-zone-area-badge">
              <span>📐 مساحت محاسبه‌شده فضا:</span>
              <strong id="fm-zone-area-val">۳۰ متر مربع</strong>
            </div>

            <div class="floor-studio-modal__field" style="margin-top:12px">
              <label>فرم هندسی و نوع معماری بخش:</label>
              <div class="floor-studio-modal__shape-grid" id="fm-zone-shapes">
                <button type="button" class="floor-studio-modal__shape-btn is-active" data-shape="open-terrace">
                  <span style="font-size:18px">🌿</span>
                  <span>تراس و فضای باز</span>
                </button>
                <button type="button" class="floor-studio-modal__shape-btn" data-shape="rectangle">
                  <span style="font-size:18px">⬛</span>
                  <span>مستطیل استاندارد</span>
                </button>
                <button type="button" class="floor-studio-modal__shape-btn" data-shape="l-shape">
                  <span style="font-size:18px">◱</span>
                  <span>ال‌شکل (L-Shape)</span>
                </button>
                <button type="button" class="floor-studio-modal__shape-btn" data-shape="corridor">
                  <span style="font-size:18px">▭</span>
                  <span>طولی و راهرویی</span>
                </button>
              </div>
            </div>

            <div class="floor-studio-modal__field" style="margin-top:12px">
              <label>پوسته رنگی بخش:</label>
              <div class="floor-studio-modal__shape-grid" id="fm-zone-colors">
                <button type="button" class="floor-studio-modal__shape-btn" data-color="blue"><span style="color:#38bdf8">🟦</span><span>آبی دریا</span></button>
                <button type="button" class="floor-studio-modal__shape-btn is-active" data-color="emerald"><span style="color:#4ade80">🟩</span><span>سبز زمردی</span></button>
                <button type="button" class="floor-studio-modal__shape-btn" data-color="purple"><span style="color:#c084fc">🟪</span><span>بنفش سلطنتی</span></button>
                <button type="button" class="floor-studio-modal__shape-btn" data-color="amber"><span style="color:#fbbf24">🟧</span><span>کهربایی گرم</span></button>
                <button type="button" class="floor-studio-modal__shape-btn" data-color="rose"><span style="color:#fb7185">🟥</span><span>سرخ رز</span></button>
                <button type="button" class="floor-studio-modal__shape-btn" data-color="cyan"><span style="color:#22d3ee">🩵</span><span>فیروزه‌ای</span></button>
              </div>
            </div>
          `,
          onConfirm: (form) => {
            const name = form.querySelector('#fm-zone-name')?.value?.trim();
            if (!name) return false;
            const lengthM = parseFloat(form.querySelector('#fm-zone-len')?.value) || 10;
            const widthM = parseFloat(form.querySelector('#fm-zone-wid')?.value) || 3;
            const areaSqM = Math.round(lengthM * widthM * 10) / 10;
            const shape = form.querySelector('#fm-zone-shapes .is-active')?.dataset.shape || 'open-terrace';
            const color = form.querySelector('#fm-zone-colors .is-active')?.dataset.color || 'emerald';
            const icon = shape === 'open-terrace' ? '🌿' : shape === 'corridor' ? '▭' : name.includes('ویژه') ? '👑' : '🏷️';

            let calcW = Math.max(14, Math.min(85, Math.round((lengthM / 20) * 80)));
            let calcH = Math.max(10, Math.min(85, Math.round((widthM / 15) * 60)));

            let freeSlot = null;
            for (let y = 3; y <= 97 - calcH && !freeSlot; y += 3) {
              for (let x = 2; x <= 98 - calcW && !freeSlot; x += 3) {
                const collides = floorZones.some((z) => {
                  return Math.max(x, z.x) < Math.min(x + calcW, z.x + z.w) - 0.5 &&
                         Math.max(y, z.y) < Math.min(y + calcH, z.y + z.h) - 0.5;
                });
                if (!collides) freeSlot = { x, y, w: calcW, h: calcH };
              }
            }

            if (!freeSlot) {
              const largest = [...floorZones].sort((a, b) => (b.w * b.h) - (a.w * a.h))[0];
              if (largest && largest.w >= 24) {
                const halfW = Math.round((largest.w / 2) * 10) / 10;
                largest.w = halfW;
                freeSlot = { x: Math.round((largest.x + halfW) * 10) / 10, y: largest.y, w: halfW, h: largest.h };
              } else if (largest && largest.h >= 24) {
                const halfH = Math.round((largest.h / 2) * 10) / 10;
                largest.h = halfH;
                freeSlot = { x: largest.x, y: Math.round((largest.y + halfH) * 10) / 10, w: largest.w, h: halfH };
              } else {
                freeSlot = { x: 50, y: 50, w: calcW, h: calcH };
              }
            }

            const newZone = {
              id: `zone-${Date.now()}`,
              name,
              x: freeSlot.x,
              y: freeSlot.y,
              w: freeSlot.w,
              h: freeSlot.h,
              color,
              icon,
              lengthM,
              widthM,
              areaSqM,
              shape,
            };
            floorZones.push(newZone);
            activeZone = name;
            debouncedSaveFloor();
            render();
            showToast(`بخش «${name}» با ابعاد ${fmtNum(lengthM)}×${fmtNum(widthM)} متر (${fmtNum(areaSqM)}م²) ایجاد شد.`, 'success');
            return true;
          }
        });

        setTimeout(() => {
          const lInput = document.getElementById('fm-zone-len');
          const wInput = document.getElementById('fm-zone-wid');
          const areaVal = document.getElementById('fm-zone-area-val');
          const updateArea = () => {
            const l = parseFloat(lInput?.value) || 0;
            const w = parseFloat(wInput?.value) || 0;
            if (areaVal) areaVal.textContent = `${fmtNum(Math.round(l * w * 10) / 10)} متر مربع`;
          };
          lInput?.addEventListener('input', updateArea);
          wInput?.addEventListener('input', updateArea);

          document.querySelectorAll('.floor-studio-modal__preset-pill').forEach((pill) => {
            pill.addEventListener('click', () => {
              const pName = pill.dataset.presetName;
              const pL = pill.dataset.presetL;
              const pW = pill.dataset.presetW;
              const pColor = pill.dataset.presetColor;
              const pShape = pill.dataset.presetShape;

              const nameEl = document.getElementById('fm-zone-name');
              if (nameEl && pName) nameEl.value = pName;
              if (lInput && pL) lInput.value = pL;
              if (wInput && pW) wInput.value = pW;
              updateArea();

              if (pShape) {
                const shapesGrid = document.getElementById('fm-zone-shapes');
                shapesGrid?.querySelectorAll('.floor-studio-modal__shape-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.shape === pShape));
              }
              if (pColor) {
                const colorsGrid = document.getElementById('fm-zone-colors');
                colorsGrid?.querySelectorAll('.floor-studio-modal__shape-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.color === pColor));
              }
            });
          });

          const bindRadioGrid = (gridId) => {
            const grid = document.getElementById(gridId);
            grid?.querySelectorAll('.floor-studio-modal__shape-btn').forEach((b) => {
              b.addEventListener('click', () => {
                grid.querySelectorAll('.floor-studio-modal__shape-btn').forEach((x) => x.classList.remove('is-active'));
                b.classList.add('is-active');
              });
            });
          };
          bindRadioGrid('fm-zone-shapes');
          bindRadioGrid('fm-zone-colors');
        }, 50);
      };

      const promptZoneDimensions = (zone) => {
        const curL = zone.lengthM || (zone.w ? Math.round(zone.w * 0.25 * 10) / 10 : 10);
        const curW = zone.widthM || (zone.h ? Math.round(zone.h * 0.25 * 10) / 10 : 6);
        const curShape = zone.shape || 'rectangle';

        showFloorModal({
          title: `📐 تنظیم متراژ و ابعاد معماری بخش «${esc(zone.name)}»`,
          confirmText: 'ذخیره ابعاد و متراژ',
          confirmClass: 'btn-primary',
          bodyHtml: `
            <p style="font-size:13px;color:#94a3b8;margin:0 0 14px">ابعاد فیزیکی واقعی بخش «${esc(zone.name)}» را به متر وارد کنید:</p>

            <div class="floor-studio-modal__dim-row">
              <div class="floor-studio-modal__field">
                <label for="fm-edit-len">طول بخش (متر):</label>
                <input id="fm-edit-len" type="number" min="1" max="300" step="0.5" value="${curL}" required />
              </div>
              <div class="floor-studio-modal__field">
                <label for="fm-edit-wid">عرض بخش (متر):</label>
                <input id="fm-edit-wid" type="number" min="1" max="300" step="0.5" value="${curW}" required />
              </div>
            </div>

            <div class="floor-studio-modal__area-badge" id="fm-edit-area-badge">
              <span>📐 مساحت محاسبه‌شده:</span>
              <strong id="fm-edit-area-val">${fmtNum(Math.round(curL * curW * 10) / 10)} متر مربع</strong>
            </div>

            <div class="floor-studio-modal__field" style="margin-top:14px">
              <label>فرم هندسی و نوع معماری:</label>
              <div class="floor-studio-modal__shape-grid" id="fm-edit-shapes">
                <button type="button" class="floor-studio-modal__shape-btn ${curShape === 'rectangle' ? 'is-active' : ''}" data-shape="rectangle">
                  <span style="font-size:18px">⬛</span>
                  <span>مستطیل استاندارد</span>
                </button>
                <button type="button" class="floor-studio-modal__shape-btn ${curShape === 'open-terrace' ? 'is-active' : ''}" data-shape="open-terrace">
                  <span style="font-size:18px">🌿</span>
                  <span>تراس و فضای باز</span>
                </button>
                <button type="button" class="floor-studio-modal__shape-btn ${curShape === 'l-shape' ? 'is-active' : ''}" data-shape="l-shape">
                  <span style="font-size:18px">◱</span>
                  <span>ال‌شکل (L-Shape)</span>
                </button>
                <button type="button" class="floor-studio-modal__shape-btn ${curShape === 'corridor' ? 'is-active' : ''}" data-shape="corridor">
                  <span style="font-size:18px">▭</span>
                  <span>طولی و راهرویی</span>
                </button>
              </div>
            </div>

            <div class="floor-studio-modal__field" style="margin-top:12px">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" id="fm-sync-aspect" checked />
                <span>تطبیق تناسب طول و عرض در نقشه سالن (Aspect Ratio Sync)</span>
              </label>
            </div>
          `,
          onConfirm: (form) => {
            const lengthM = parseFloat(form.querySelector('#fm-edit-len')?.value) || curL;
            const widthM = parseFloat(form.querySelector('#fm-edit-wid')?.value) || curW;
            const areaSqM = Math.round(lengthM * widthM * 10) / 10;
            const shape = form.querySelector('#fm-edit-shapes .is-active')?.dataset.shape || curShape;
            const syncAspect = form.querySelector('#fm-sync-aspect')?.checked;

            zone.lengthM = lengthM;
            zone.widthM = widthM;
            zone.areaSqM = areaSqM;
            zone.shape = shape;

            if (syncAspect && lengthM > 0 && widthM > 0) {
              const targetRatio = lengthM / widthM;
              let newW = Math.max(10, Math.min(95 - zone.x, Math.round(zone.h * targetRatio)));
              if (newW > 95 - zone.x) {
                newW = 95 - zone.x;
                zone.h = Math.max(8, Math.min(95 - zone.y, Math.round(newW / targetRatio)));
              }
              zone.w = newW;
            }

            debouncedSaveFloor();
            render();
            showToast(`ابعاد بخش «${zone.name}» به ${fmtNum(lengthM)}×${fmtNum(widthM)} متر (${fmtNum(areaSqM)}م²) به‌روز شد.`, 'success');
            return true;
          }
        });

        setTimeout(() => {
          const lInput = document.getElementById('fm-edit-len');
          const wInput = document.getElementById('fm-edit-wid');
          const areaVal = document.getElementById('fm-edit-area-val');
          const updateArea = () => {
            const l = parseFloat(lInput?.value) || 0;
            const w = parseFloat(wInput?.value) || 0;
            if (areaVal) areaVal.textContent = `${fmtNum(Math.round(l * w * 10) / 10)} متر مربع`;
          };
          lInput?.addEventListener('input', updateArea);
          wInput?.addEventListener('input', updateArea);

          const grid = document.getElementById('fm-edit-shapes');
          grid?.querySelectorAll('.floor-studio-modal__shape-btn').forEach((b) => {
            b.addEventListener('click', () => {
              grid.querySelectorAll('.floor-studio-modal__shape-btn').forEach((x) => x.classList.remove('is-active'));
              b.classList.add('is-active');
            });
          });
        }, 50);
      };

      const promptCreateZone = (x, y, w, h) => {
        showFloorModal({
          title: '📐 ایجاد بخش جدید ترسیم‌شده در سالن',
          confirmText: 'تایید و افزودن به نقشه',
          confirmClass: 'btn-primary',
          bodyHtml: `
            <div class="floor-studio-modal__field">
              <label for="fm-draw-zone-name">نام بخش جدید (مثال: بالکن، کافه بار، VIP ۲):</label>
              <input id="fm-draw-zone-name" type="text" placeholder="نام بخش سالن..." required autofocus />
            </div>
            <div class="floor-studio-modal__dim-row">
              <div class="floor-studio-modal__field">
                <label for="fm-draw-len">طول تقریبی (متر):</label>
                <input id="fm-draw-len" type="number" min="1" max="200" step="0.5" value="${Math.round(w * 0.25 * 10) / 10}" required />
              </div>
              <div class="floor-studio-modal__field">
                <label for="fm-draw-wid">عرض تقریبی (متر):</label>
                <input id="fm-draw-wid" type="number" min="1" max="200" step="0.5" value="${Math.round(h * 0.25 * 10) / 10}" required />
              </div>
            </div>
            <div class="floor-studio-modal__field" style="margin-top:10px">
              <label>پوسته رنگی بخش:</label>
              <div class="floor-studio-modal__shape-grid" id="fm-draw-zone-colors">
                <button type="button" class="floor-studio-modal__shape-btn is-active" data-color="blue"><span style="color:#38bdf8">🟦</span><span>آبی دریا</span></button>
                <button type="button" class="floor-studio-modal__shape-btn" data-color="emerald"><span style="color:#4ade80">🟩</span><span>سبز زمردی</span></button>
                <button type="button" class="floor-studio-modal__shape-btn" data-color="purple"><span style="color:#c084fc">🟪</span><span>بنفش سلطنتی</span></button>
                <button type="button" class="floor-studio-modal__shape-btn" data-color="amber"><span style="color:#fbbf24">🟧</span><span>کهربایی گرم</span></button>
                <button type="button" class="floor-studio-modal__shape-btn" data-color="rose"><span style="color:#fb7185">🟥</span><span>سرخ رز</span></button>
                <button type="button" class="floor-studio-modal__shape-btn" data-color="cyan"><span style="color:#22d3ee">🩵</span><span>فیروزه‌ای</span></button>
              </div>
            </div>
          `,
          onConfirm: (form) => {
            const name = form.querySelector('#fm-draw-zone-name')?.value?.trim();
            if (!name) return false;
            const color = form.querySelector('#fm-draw-zone-colors .is-active')?.dataset.color || 'blue';
            const lengthM = parseFloat(form.querySelector('#fm-draw-len')?.value) || Math.round(w * 0.25 * 10) / 10;
            const widthM = parseFloat(form.querySelector('#fm-draw-wid')?.value) || Math.round(h * 0.25 * 10) / 10;
            const areaSqM = Math.round(lengthM * widthM * 10) / 10;
            const candX = Math.max(0, Math.min(100 - w, x));
            const candY = Math.max(0, Math.min(100 - h, y));
            const candW = Math.max(8, Math.min(100, w));
            const candH = Math.max(8, Math.min(100, h));

            const collides = floorZones.some((z) => {
              return Math.max(candX, z.x) < Math.min(candX + candW, z.x + z.w) - 0.5 &&
                     Math.max(candY, z.y) < Math.min(candY + candH, z.y + z.h) - 0.5;
            });
            if (collides) {
              showToast('خطا: محدوده بخش جدید با خط‌کشی بخش‌های موجود سالن تداخل دارد.', 'error');
              return false;
            }

            const newZone = {
              id: `zone-${Date.now()}`,
              name,
              x: candX,
              y: candY,
              w: candW,
              h: candH,
              color,
              icon: '🏷️',
              lengthM,
              widthM,
              areaSqM,
              shape: 'rectangle',
            };
            floorZones.push(newZone);
            activeZone = 'all';
            debouncedSaveFloor();
            render();
            showToast(`بخش «${name}» با موفقیت روی نقشه ترسیم و ذخیره شد.`, 'success');
            return true;
          }
        });

        setTimeout(() => {
          const grid = document.getElementById('fm-draw-zone-colors');
          grid?.querySelectorAll('.floor-studio-modal__shape-btn').forEach((b) => {
            b.addEventListener('click', () => {
              grid.querySelectorAll('.floor-studio-modal__shape-btn').forEach((x) => x.classList.remove('is-active'));
              b.classList.add('is-active');
            });
          });
        }, 50);
      };

      const promptRenameZone = (zone) => {
        showFloorModal({
          title: '✏️ ویرایش نام بخش سالن',
          confirmText: 'ذخیره نام',
          bodyHtml: `
            <div class="floor-studio-modal__field">
              <label for="fm-edit-zone-name">نام بخش / زون سالن:</label>
              <input id="fm-edit-zone-name" type="text" value="${esc(zone.name)}" required />
            </div>
          `,
          onConfirm: (form) => {
            const newName = form.querySelector('#fm-edit-zone-name')?.value?.trim();
            if (newName && newName !== zone.name) {
              const oldName = zone.name;
              zone.name = newName;
              tables.forEach((t) => {
                if (normalizeZone(t.zone) === oldName) t.zone = newName;
              });
              if (activeZone === oldName) activeZone = newName;
              debouncedSaveFloor();
              render();
              showToast(`نام بخش به «${newName}» تغییر یافت.`, 'success');
              return true;
            }
          }
        });
      };

      const cycleZoneColor = (zone) => {
        const colors = ['blue', 'emerald', 'purple', 'amber', 'rose', 'cyan'];
        const idx = colors.indexOf(zone.color || 'blue');
        zone.color = colors[(idx + 1) % colors.length];
        debouncedSaveFloor();
        render();
      };

      const splitZone = (zone) => {
        showFloorModal({
          title: '⊞ تقسیم بخش سالن به دو بخش مجزا',
          confirmText: 'تقسیم فضا',
          bodyHtml: `
            <p style="font-size:13px;color:#f8fafc;margin:0 0 12px">جهت تقسیم فضای بخش «${esc(zone.name)}» را مشخص کنید:</p>
            <div class="floor-studio-modal__shape-grid" id="fm-split-dir">
              <button type="button" class="floor-studio-modal__shape-btn is-active" data-dir="v">
                <span style="font-size:18px">◫</span>
                <span>عمودی (چپ و راست)</span>
              </button>
              <button type="button" class="floor-studio-modal__shape-btn" data-dir="h">
                <span style="font-size:18px">⬒</span>
                <span>افقی (بالا و پایین)</span>
              </button>
            </div>
            <div class="floor-studio-modal__field" style="margin-top:14px">
              <label for="fm-split-name">نام بخش ثانویه:</label>
              <input id="fm-split-name" type="text" value="${esc(zone.name)} ۲" required />
            </div>
          `,
          onConfirm: (form) => {
            const dir = form.querySelector('#fm-split-dir .is-active')?.dataset.dir || 'v';
            const newName = form.querySelector('#fm-split-name')?.value?.trim() || `${zone.name} ۲`;
            const newId = `zone-${Date.now()}`;
            const curL = zone.lengthM || 10;
            const curW = zone.widthM || 6;
            if (dir === 'v') {
              const halfW = Math.round((zone.w / 2) * 10) / 10;
              const halfLM = Math.round((curL / 2) * 10) / 10;
              zone.w = halfW;
              zone.lengthM = halfLM;
              zone.areaSqM = Math.round(halfLM * curW * 10) / 10;
              floorZones.push({
                id: newId,
                name: newName,
                x: Math.round((zone.x + halfW) * 10) / 10,
                y: zone.y,
                w: halfW,
                h: zone.h,
                color: 'amber',
                icon: '🏷️',
                lengthM: halfLM,
                widthM: curW,
                areaSqM: Math.round(halfLM * curW * 10) / 10,
                shape: zone.shape || 'rectangle',
              });
            } else {
              const halfH = Math.round((zone.h / 2) * 10) / 10;
              const halfWM = Math.round((curW / 2) * 10) / 10;
              zone.h = halfH;
              zone.widthM = halfWM;
              zone.areaSqM = Math.round(curL * halfWM * 10) / 10;
              floorZones.push({
                id: newId,
                name: newName,
                x: zone.x,
                y: Math.round((zone.y + halfH) * 10) / 10,
                w: zone.w,
                h: halfH,
                color: 'amber',
                icon: '🏷️',
                lengthM: curL,
                widthM: halfWM,
                areaSqM: Math.round(curL * halfWM * 10) / 10,
                shape: zone.shape || 'rectangle',
              });
            }
            debouncedSaveFloor();
            render();
            showToast(`بخش با مرز مشترک همسایگی به دو بخش تقسیم گردید.`, 'success');
            return true;
          }
        });

        setTimeout(() => {
          const grid = document.getElementById('fm-split-dir');
          grid?.querySelectorAll('.floor-studio-modal__shape-btn').forEach((b) => {
            b.addEventListener('click', () => {
              grid.querySelectorAll('.floor-studio-modal__shape-btn').forEach((x) => x.classList.remove('is-active'));
              b.classList.add('is-active');
            });
          });
        }, 50);
      };

      const deleteZone = (zoneIdOrName) => {
        const zone = floorZones.find((z) => z.id === zoneIdOrName || z.name === zoneIdOrName || normalizeZone(z.name) === normalizeZone(zoneIdOrName));
        const zoneName = zone ? zone.name : zoneIdOrName;
        if (!zoneName) return;
        if (floorZones.length <= 1) {
          showToast('حداقل یک بخش باید در سالن باقی بماند.', 'warning');
          return;
        }
        showFloorModal({
          title: `🗑️ حذف بخش «${esc(zoneName)}»`,
          confirmText: 'حذف بخش',
          confirmClass: 'btn-danger',
          bodyHtml: `
            <p style="font-size:14px;color:#f8fafc;margin:0 0 8px">آیا از حذف این بخش از نقشه سالن اطمینان دارید؟</p>
            <p style="font-size:12px;color:#94a3b8;margin:0">میزهای متعلق به این بخش حذف نمی‌شوند و به طور خودکار به بخش «سالن اصلی» منتقل خواهند شد.</p>
          `,
          onConfirm: () => {
            const deletedName = zoneName;
            floorZones = floorZones.filter((z) => z.id !== zone?.id && z.name !== deletedName && normalizeZone(z.name) !== normalizeZone(deletedName));
            tables.forEach((t) => {
              if (normalizeZone(t.zone) === normalizeZone(deletedName)) t.zone = 'سالن';
            });
            if (activeZone === deletedName || normalizeZone(activeZone) === normalizeZone(deletedName)) activeZone = 'all';
            if (selectedZoneId === zone?.id || selectedZoneId === zoneIdOrName) selectedZoneId = null;
            debouncedSaveFloor();
            render();
            showToast(`بخش «${deletedName}» حذف شد.`, 'success');
            return true;
          }
        });
      };

      const renderPlanTableItem = (table) => {
        const isSelected = Number(selectedTableId) === Number(table.id) || selectedTableIds.has(Number(table.id));
        const shape = table.shape || 'rectangle';
        const seats = Math.max(1, Math.min(24, Number(table.seats) || 4));
        const chairModel = table.chairModel || (shape === 'bar_stool' || shape === 'wall_counter' ? 'bar_stool' : shape === 'lounge_takht' ? 'bolster' : 'standard');
        const chairClass = `plan-chair plan-chair--${chairModel}`;
        let chairsHtml = '';

        if (shape === 'conference') {
          // Large Executive Conference / Banquet Table: 2 Head Chairs (left & right) + top & bottom rows
          if (seats >= 2) {
            chairsHtml += `<div class="${chairClass} plan-chair--head" style="left:-14px;top:50%;transform:translateY(-50%);width:9px;height:26px;border-radius:5px 2px 2px 5px" title="صندلی صدر"></div>`;
            chairsHtml += `<div class="${chairClass} plan-chair--head" style="right:-14px;top:50%;transform:translateY(-50%);width:9px;height:26px;border-radius:2px 5px 5px 2px" title="صندلی ذیل"></div>`;
          }
          const sideSeats = Math.max(0, seats - 2);
          const topCount = Math.ceil(sideSeats / 2);
          const botCount = sideSeats - topCount;
          for (let i = 0; i < topCount; i++) {
            const xPos = topCount === 1 ? 50 : 14 + (i * (72 / (topCount - 1)));
            chairsHtml += `<div class="${chairClass}" style="top:-14px;left:${xPos.toFixed(1)}%;transform:translateX(-50%);width:26px;height:10px;border-radius:6px 6px 3px 3px"></div>`;
          }
          for (let i = 0; i < botCount; i++) {
            const xPos = botCount === 1 ? 50 : 14 + (i * (72 / (botCount - 1)));
            chairsHtml += `<div class="${chairClass}" style="bottom:-14px;left:${xPos.toFixed(1)}%;transform:translateX(-50%);width:26px;height:10px;border-radius:3px 3px 6px 6px"></div>`;
          }
        } else if (shape === 'semi_circle') {
          // Half-moon / semi-circular table with outer banquette arc
          chairsHtml += `<div class="plan-semicircle-cushion"></div>`;
          for (let i = 0; i < seats; i++) {
            const angle = (Math.PI / (seats + 1)) * (i + 1);
            const rx = 52;
            const ry = 44;
            const left = 50 - rx * Math.cos(angle);
            const top = 30 + ry * Math.sin(angle);
            const deg = (angle * 180 / Math.PI) - 90;
            chairsHtml += `<div class="${chairClass}" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%;transform:translate(-50%,-50%) rotate(${deg.toFixed(1)}deg);width:24px;height:10px;border-radius:5px"></div>`;
          }
        } else if (shape === 'wall_counter') {
          // Wall-mounted bar counter: single-sided seating facing counter
          for (let i = 0; i < seats; i++) {
            const xPos = seats === 1 ? 50 : 14 + (i * (72 / (seats - 1)));
            chairsHtml += `<div class="${chairClass}" style="bottom:-15px;left:${xPos.toFixed(1)}%;transform:translateX(-50%);width:20px;height:20px;border-radius:50%"></div>`;
          }
        } else if (shape === 'round_booth') {
          chairsHtml += `<div class="plan-roundbooth-cushion"></div>`;
          for (let i = 0; i < seats; i++) {
            const angle = (1.5 * Math.PI / Math.max(1, seats - 1 || 1)) * i - (1.25 * Math.PI);
            const radius = 48;
            const left = 50 + radius * Math.cos(angle);
            const top = 50 + radius * Math.sin(angle);
            const deg = (angle * 180 / Math.PI) + 90;
            chairsHtml += `<div class="${chairClass}" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%;transform:translate(-50%,-50%) rotate(${deg.toFixed(1)}deg);width:22px;height:9px;border-radius:5px"></div>`;
          }
        } else if (shape === 'circle') {
          for (let i = 0; i < seats; i++) {
            const angle = (2 * Math.PI / seats) * i - (Math.PI / 2);
            const radius = 54;
            const left = 50 + radius * Math.cos(angle);
            const top = 50 + radius * Math.sin(angle);
            const deg = (angle * 180 / Math.PI) + 90;
            chairsHtml += `<div class="${chairClass}" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%;transform:translate(-50%,-50%) rotate(${deg.toFixed(1)}deg);width:26px;height:10px;border-radius:5px"></div>`;
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
          chairsHtml += `
            <div class="plan-booth-cushion plan-booth-cushion--top"></div>
            <div class="plan-booth-cushion plan-booth-cushion--bottom"></div>
          `;
        } else if (shape === 'bar_stool') {
          for (let i = 0; i < seats; i++) {
            const offset = seats === 1 ? 50 : 18 + (i * (64 / (seats - 1)));
            chairsHtml += `<div class="${chairClass} plan-chair--stool" style="bottom:-16px;left:${offset}%;transform:translateX(-50%);width:18px;height:18px;border-radius:50%"></div>`;
          }
        } else if (shape === 'oval') {
          for (let i = 0; i < seats; i++) {
            const angle = (2 * Math.PI / seats) * i - (Math.PI / 2);
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
          mergeBadgeHtml = `<span class="plan-table-merge-badge" title="میز والد ادغام‌شده">🔗 ادغام (${fmtNum(table.mergedWith.length + 1)} میز)</span>`;
        } else if (isMergedSub) {
          mergeBadgeHtml = `<span class="plan-table-merge-badge is-sub" title="میز فرعی پیوندخورده">🔗 متصل به میز ${esc(table.mergedInto)}</span>`;
        }

        const standardZones = ['سالن', 'تراس', 'ویژه'];
        const existingZones = Array.from(new Set(tables.map((t) => normalizeZone(t.zone)).filter(Boolean)));
        const allZonesList = Array.from(new Set([...standardZones, ...existingZones]));
        const zoneOptions = allZonesList.map((z) => `<option value="${esc(z)}" ${normalizeZone(table.zone) === z ? 'selected' : ''}>${esc(z)}</option>`).join('');

        const isNearTop = Number(table.y) < 22;
        const isNearLeft = Number(table.x) < 25;
        const isNearRight = Number(table.x) > 75;
        const alignX = isNearLeft ? 'left' : isNearRight ? 'right' : 'center';

        const isMerged = isMergedParent || isMergedSub;
        const paletteHtml = (isSelected && isEditMode && Number(selectedTableId) === Number(table.id)) ? `
          <div class="table-floating-palette" data-flip-down="${isNearTop}" data-align-x="${alignX}" data-palette-for="${table.id}">
            <!-- Seating Stepper Cluster -->
            <div class="table-palette-cluster table-palette-cluster--seats">
              <button type="button" class="palette-mini-btn" data-table-action="dec-seats" title="کاهش صندلی (-)">−</button>
              <span class="palette-seats-badge" title="تعداد صندلی‌ها">${fmtNum(seats)} صندلی</span>
              <button type="button" class="palette-mini-btn" data-table-action="inc-seats" title="افزایش صندلی (+)">＋</button>
            </div>

            <!-- Engineering Scale Stepper Cluster -->
            <div class="table-palette-cluster table-palette-cluster--scale" title="تنظیم مقیاس و اندازه مهندسی میز">
              <button type="button" class="palette-mini-btn" data-table-action="dec-scale" title="کوچک‌کردن ابعاد میز (−)">−</button>
              <span class="palette-seats-badge" title="ضریب مقیاس میز">${(Number(table.scale) || 1).toFixed(1)}×</span>
              <button type="button" class="palette-mini-btn" data-table-action="inc-scale" title="بزرگ‌کردن ابعاد میز (＋)">＋</button>
            </div>

            <!-- Visual Furniture & Seating Studio Trigger -->
            <button type="button" class="palette-studio-btn" data-table-action="furniture-modal" title="استودیوی مبلمان: تغییر فرم هندسی و مدل صندلی">
              <span>${shapeIcon(shape)} ${shapeTitle(shape)}</span>
              <span class="palette-chair-tag" title="مدل صندلی: ${chairLabel(chairModel)}">${chairIcon(chairModel)}</span>
            </button>

            <!-- Quick Rotate -->
            <button type="button" class="palette-btn" data-table-action="rotate" title="چرخش ۴۵ درجه">↻ ۴۵°</button>

            <!-- Zone Selector -->
            <select data-table-action="zone-select" title="بخش سالن" style="background:#1e293b;border:1px solid rgba(255,255,255,0.15);color:#f8fafc;padding:3px 6px;border-radius:8px;font-size:11px;font-weight:700">
              ${zoneOptions}
            </select>

            <!-- Quick Shape Cycle (Keeps backward compat) -->
            <button type="button" class="palette-btn" data-table-action="toggle-shape" title="چرخش فرم هندسی">⊞ فرم</button>

            <!-- More Actions Dropdown Toggle -->
            <div class="palette-more-wrapper">
              <button type="button" class="palette-btn palette-btn--more" data-table-action="toggle-more" title="عملیات بیشتر (تغییر نام، ادغام، کپی، حذف)">⋯</button>
              <div class="palette-more-menu" id="palette-more-menu-${table.id}" style="display:none;">
                <button type="button" data-table-action="toggle-active" style="color:${table.active !== false ? '#34d399' : '#94a3b8'}">
                  ${table.active !== false ? '🟢 میز فعال است' : '⚪ میز خاموش است'}
                </button>
                <button type="button" data-table-action="rename">✏️ تغییر نام و کد میز</button>
                <button type="button" data-table-action="merge" style="color:${isMerged ? '#fbbf24' : '#38bdf8'}">
                  ${isMerged ? '🔗 تفکیک پیوند' : '🔗 ادغام میزها'}
                </button>
                <button type="button" data-table-action="move-floor">🏢 انتقال به طبقه</button>
                <button type="button" data-table-action="duplicate" style="color:#38bdf8">⧉ کپی میز</button>
                <button type="button" class="is-delete" data-table-action="delete" style="color:#f43f5e">🗑️ حذف این میز</button>
              </div>
            </div>

            <!-- Close Palette -->
            <button type="button" data-table-action="close" title="بستن پالت" style="background:transparent;border:none;color:#94a3b8;font-size:13px;padding:2px 6px;cursor:pointer">✕</button>
          </div>` : '';

        return `
          <div class="plan-table plan-table--${esc(shape)} ${isSelected ? 'is-selected' : ''} ${isMergedParent ? 'is-merged-parent' : ''} ${isMergedSub ? 'is-merged-sub' : ''}"
               data-table="${esc(table.id)}"
               role="button"
               tabindex="0"
               data-state="${esc(table.state || (table.active === false ? 'inactive' : 'available'))}"
               data-seats="${seats}"
               ${table.autoReleased ? 'data-auto-released="true"' : ''}
               style="left:${table.x}%; top:${table.y}%; transform: translate(-50%, -50%) rotate(${table.rotation || 0}deg); --table-rot: ${table.rotation || 0}deg;"
               title="${esc(tableTitle(table))} — ${esc(table.stateLabel || 'آزاد')}"
               aria-label="${esc(tableTitle(table))} — ${esc(table.stateLabel || 'آزاد')}، ${fmtNum(seats)} صندلی">
            ${chairsHtml}
            <div class="plan-table-surface">
              <span class="plan-table-number">${esc(tableTitle(table))}</span>
              <span class="plan-table-meta">${fmtNum(seats)} نفر · ${esc(normalizeZone(table.zone))}</span>
              ${mergeBadgeHtml}
              ${timerHtml}
            </div>
            ${paletteHtml}
          </div>`;
      };

      const setViewMode = (mode) => {
        currentView = mode;
        try { localStorage.setItem(VIEW_PREFS_KEY, mode); } catch (_) {}
        render();
      };

      const render = () => {
        const currentFloorTables = tables.filter((t) => (t.floorId || 'floor-ground') === activeFloorId);
        const standardZones = ['سالن', 'تراس', 'ویژه'];
        const existingZones = Array.from(new Set(currentFloorTables.map((t) => normalizeZone(t.zone)).filter(Boolean)));
        const allZonesList = Array.from(new Set([...standardZones, ...existingZones]));
        const zonesList = ['all', ...allZonesList];
        const zoneTitle = (z) => ({ all: 'همه بخش‌ها', سالن: 'سالن اصلی 🛋️', تراس: 'تراس و فضای باز 🌿', ویژه: 'سالن اختصاصی ویژه 👑' }[z] || z);

        const visibleTables = activeZone === 'all'
          ? currentFloorTables
          : currentFloorTables.filter((t) => normalizeZone(t.zone) === activeZone);

        const visibleFixtures = floorFixtures.filter((f) => (f.floorId || 'floor-ground') === activeFloorId);

        const busyCount = currentFloorTables.filter((t) => t.state === 'busy').length;
        const attnCount = currentFloorTables.filter((t) => t.state === 'attention').length;
        const freeCount = currentFloorTables.filter((t) => t.state === 'available' || !t.state).length;
        const totalSeats = currentFloorTables.reduce((acc, t) => acc + (Number(t.seats) || 0), 0);

        if (currentView === 'map') {
          const renderedZonesHtml = floorZones.map((z) => {
            if (activeZone !== 'all' && activeZone !== z.name) return '';
            const isFullView = activeZone === z.name;
            const legacyClass = z.id === 'zone-main' ? 'plan-zone--main' : z.id === 'zone-terrace' ? 'plan-zone--terrace' : z.id === 'zone-vip' ? 'plan-zone--vip' : 'plan-zone--custom';
            const themeClass = `plan-zone--${z.color || 'blue'}`;
            const zoneTables = currentFloorTables.filter((t) => normalizeZone(t.zone) === z.name);
            const lM = z.lengthM || 10;
            const wM = z.widthM || 3;
            const areaM = z.areaSqM || Math.round(lM * wM * 10) / 10;

            const isSharedE = floorZones.some((o) => o.id !== z.id && Math.abs(o.x - (z.x + z.w)) <= 3.5 && Math.max(z.y, o.y) < Math.min(z.y + z.h, o.y + o.h));
            const isSharedW = floorZones.some((o) => o.id !== z.id && Math.abs((o.x + o.w) - z.x) <= 3.5 && Math.max(z.y, o.y) < Math.min(z.y + z.h, o.y + o.h));
            const isSharedS = floorZones.some((o) => o.id !== z.id && Math.abs(o.y - (z.y + z.h)) <= 3.5 && Math.max(z.x, o.x) < Math.min(z.x + z.w, o.x + o.w));
            const isSharedN = floorZones.some((o) => o.id !== z.id && Math.abs((o.y + o.h) - z.y) <= 3.5 && Math.max(z.x, o.x) < Math.min(z.x + z.w, o.x + o.w));
            const palettePlacementClass = z.y < 7 ? (z.y + z.h > 85 ? 'is-inside-top' : 'is-flipped-down') : '';
            const styleAttr = isFullView ? '' : `left:${z.x}%; top:${z.y}%; width:${z.w}%; height:${z.h}%;`;
            return `
              <div class="plan-zone plan-zone--interactive ${legacyClass} ${themeClass} ${isFullView ? 'is-full-view' : ''} ${selectedZoneId === z.id ? 'is-selected' : ''} ${isSharedE ? 'has-shared-e' : ''} ${isSharedW ? 'has-shared-w' : ''} ${isSharedS ? 'has-shared-s' : ''} ${isSharedN ? 'has-shared-n' : ''}"
                   data-zone-id="${esc(z.id)}"
                   data-zone-name="${esc(z.name)}"
                   style="${styleAttr}">
                ${(isEditMode && studioMode === 'architecture' && !isFullView && selectedZoneId === z.id) ? `
                  <div class="zone-floating-palette ${palettePlacementClass}" data-zone-id="${esc(z.id)}">
                    <span class="zone-floating-palette__title">${esc(z.icon || '🏷️')} ${esc(z.name)} (📐 ${fmtNum(lM)}×${fmtNum(wM)}م)</span>
                    <button type="button" data-zone-action="dimensions" data-zone-id="${esc(z.id)}" title="تنظیم متراژ و ابعاد">📏 متراژ</button>
                    <button type="button" data-zone-action="rename" data-zone-id="${esc(z.id)}" title="تغییر نام فضا">✏️ نام</button>
                    <button type="button" data-zone-action="color" data-zone-id="${esc(z.id)}" title="تغییر رنگ فضا">🎨 رنگ</button>
                    <button type="button" data-zone-action="split" data-zone-id="${esc(z.id)}" title="تقسیم فضا به دو بخش">⊞ تقسیم</button>
                    <button type="button" class="is-delete" data-zone-action="delete" data-zone-id="${esc(z.id)}" title="حذف کامل این فضا از نقشه">🗑️ حذف فضا</button>
                    <button type="button" data-zone-action="close" data-zone-id="${esc(z.id)}" title="بستن">✕</button>
                  </div>
                ` : ''}

                ${(isEditMode && studioMode === 'architecture' && !isFullView) ? `
                  <button type="button" class="plan-zone__border-delete" data-zone-action="delete" data-zone-id="${esc(z.id)}" title="حذف این فضا (${esc(z.name)})">
                    <span style="font-size:12px">🗑️</span>
                    <span>حذف فضا</span>
                  </button>
                ` : ''}

                ${isFullView ? `
                  <div class="floor-fullzone-banner">
                    <div class="floor-fullzone-banner__info">
                      <span class="floor-fullzone-banner__tag">${esc(z.icon || '🏷️')} فضای اختصاصی بخش «${esc(z.name)}»</span>
                      <span class="floor-fullzone-banner__dims">
                        📐 ابعاد: <b>${fmtNum(lM)}</b> متر طول × <b>${fmtNum(wM)}</b> متر عرض · مساحت: <b>${fmtNum(areaM)}</b> مترمربع · فرم: <b>${shapeLabel(z.shape)}</b>
                      </span>
                    </div>
                    <div class="floor-fullzone-banner__actions">
                      <button type="button" class="plan-zone__act-btn" data-zone-action="dimensions" data-zone-id="${esc(z.id)}" title="تنظیم متراژ و ابعاد">📏 تنظیم ابعاد و متراژ</button>
                      <button type="button" class="plan-zone__act-btn" data-zone-action="rename" data-zone-id="${esc(z.id)}" title="تغییر نام">✏️ تغییر نام</button>
                      <button type="button" class="plan-zone__act-btn" data-zone-action="color" data-zone-id="${esc(z.id)}" title="تغییر رنگ">🎨 تغییر رنگ</button>
                      <button type="button" class="plan-zone__act-btn is-delete" data-zone-action="delete" data-zone-id="${esc(z.id)}" title="حذف این بخش">🗑️ حذف این بخش</button>
                    </div>
                  </div>
                ` : `
                  <div class="plan-zone__header">
                    <div class="plan-zone__tag-group">
                      <span class="plan-zone__tag">${esc(z.icon || '🏷️')} ${esc(z.name)}</span>
                      <span class="plan-zone__count-badge">${fmtNum(zoneTables.length)} میز</span>
                      <span class="plan-zone__count-badge" style="color:#94a3b8;background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.1)">📐 ${fmtNum(lM)}×${fmtNum(wM)}م (${fmtNum(areaM)}م²)</span>
                    </div>
                    ${(isEditMode && studioMode === 'architecture') ? `
                      <div class="plan-zone__actions">
                        <button type="button" class="plan-zone__act-btn" data-zone-action="dimensions" data-zone-id="${esc(z.id)}" title="تنظیم متراژ و ابعاد بخش">📏</button>
                        <button type="button" class="plan-zone__act-btn" data-zone-action="rename" data-zone-id="${esc(z.id)}" title="تغییر نام بخش">✏️</button>
                        <button type="button" class="plan-zone__act-btn" data-zone-action="color" data-zone-id="${esc(z.id)}" title="تغییر رنگ بخش">🎨</button>
                        <button type="button" class="plan-zone__act-btn" data-zone-action="split" data-zone-id="${esc(z.id)}" title="تقسیم بخش به دو نیمه">⊞</button>
                        <button type="button" class="plan-zone__act-btn is-delete" data-zone-action="delete" data-zone-id="${esc(z.id)}" title="حذف بخش">🗑️ حذف فضا</button>
                      </div>` : ''}
                  </div>
                `}

                ${(isEditMode && studioMode === 'architecture' && !isFullView) ? `
                  <div class="zone-handle zone-handle--n ${isSharedN ? 'is-shared' : ''}" data-handle="n" data-zone-id="${esc(z.id)}" title="لبه مشترک / بالا"></div>
                  <div class="zone-handle zone-handle--s ${isSharedS ? 'is-shared' : ''}" data-handle="s" data-zone-id="${esc(z.id)}" title="لبه مشترک / پایین"></div>
                  <div class="zone-handle zone-handle--e ${isSharedE ? 'is-shared' : ''}" data-handle="e" data-zone-id="${esc(z.id)}" title="لبه مشترک / راست"></div>
                  <div class="zone-handle zone-handle--w ${isSharedW ? 'is-shared' : ''}" data-handle="w" data-zone-id="${esc(z.id)}" title="لبه مشترک / چپ"></div>

                  <div class="zone-handle zone-handle--nw" data-handle="nw" data-zone-id="${esc(z.id)}"></div>
                  <div class="zone-handle zone-handle--ne" data-handle="ne" data-zone-id="${esc(z.id)}"></div>
                  <div class="zone-handle zone-handle--se" data-handle="se" data-zone-id="${esc(z.id)}"></div>
                  <div class="zone-handle zone-handle--sw" data-handle="sw" data-zone-id="${esc(z.id)}"></div>
                ` : ''}
              </div>`;
          }).join('');

          const inspectorTable = (!isEditMode && selectedTableId) ? tableById(selectedTableId) : null;
          let inspectorHtml = '';
          if (inspectorTable) {
            const stateClass = inspectorTable.state || 'available';
            const stateLabel = inspectorTable.stateLabel || (inspectorTable.active === false ? 'غیرفعال' : 'آزاد');
            const isBusy = stateClass === 'busy';
            const isAttn = stateClass === 'attention';
            const timerStr = inspectorTable.serviceEndsAt ? floorCountdownLabel(inspectorTable.serviceEndsAt) : null;
            inspectorHtml = `
              <div class="floor-table-inspector" id="floor-inspector-card">
                <div class="floor-table-inspector__head">
                  <h4 class="floor-table-inspector__title">
                    <span>${esc(tableTitle(inspectorTable))}</span>
                    <span class="floor-table-inspector__badge is-${esc(stateClass)}">${esc(stateLabel)}</span>
                  </h4>
                  <button type="button" class="floor-table-inspector__close" id="floor-inspector-close" title="بستن">✕</button>
                </div>
                <div class="floor-table-inspector__body">
                  <div class="floor-table-inspector__row">
                    <span>بخش سالن:</span>
                    <strong>${esc(normalizeZone(inspectorTable.zone))}</strong>
                  </div>
                  <div class="floor-table-inspector__row">
                    <span>ظرفیت پذیرایی:</span>
                    <strong>${fmtNum(inspectorTable.seats || 4)} نفر</strong>
                  </div>
                  <div class="floor-table-inspector__row">
                    <span>وضعیت سفارش:</span>
                    <strong>${isBusy ? (inspectorTable.serviceOrderId ? `سفارش #${inspectorTable.serviceOrderId}` : 'مشغول سرویس') : isAttn ? '⚠️ فراخوان گارسون' : 'آزاد برای پذیرش'}</strong>
                  </div>
                  ${timerStr ? `
                    <div class="floor-table-inspector__row">
                      <span>زمان سرویس باقیمانده:</span>
                      <strong dir="ltr" style="color:#38bdf8">${timerStr}</strong>
                    </div>` : ''}
                </div>
                <div class="floor-table-inspector__actions">
                  ${isAttn ? `
                    <button type="button" class="floor-table-inspector__btn floor-table-inspector__btn--resolve" id="floor-inspector-resolve">
                      ✓ ثبت رسیدگی و بستن فراخوان
                    </button>` : ''}
                  <a class="floor-table-inspector__btn" href="${esc(qrAssetUrl(inspectorTable, { download: true }))}" download="westo-table-${inspectorTable.id}.png">
                    🔲 دانلود رمزینه QR
                  </a>
                  <a class="floor-table-inspector__btn" href="${esc(tableDestination(inspectorTable))}" target="_blank" rel="noopener">
                    📱 مشاهده منوی دیجیتال این میز
                  </a>
                  <button type="button" class="floor-table-inspector__btn" id="floor-inspector-switch-edit">
                    📐 ویرایش و تنظیم مکان این میز
                  </button>
                </div>
              </div>`;
          }
          const currentActiveZoneObj = activeZone !== 'all'
            ? floorZones.find((z) => z.name === activeZone || normalizeZone(z.name) === normalizeZone(activeZone))
            : null;

          const batchToolbarHtml = (isEditMode && selectedTableIds.size > 1) ? `
            <div class="floor-batch-toolbar" id="admin-batch-toolbar">
              <div class="floor-batch-toolbar__info">
                <span>${fmtNum(selectedTableIds.size)} میز انتخاب شده</span>
              </div>
              <div class="floor-batch-toolbar__group">
                <span class="floor-batch-toolbar__label">تراز:</span>
                <button type="button" class="floor-batch-toolbar__btn" data-batch-act="align-left" title="تراز از لبه چپ">⇤ چپ</button>
                <button type="button" class="floor-batch-toolbar__btn" data-batch-act="align-center-x" title="تراز از مرکز افقی">⤹ وسط</button>
                <button type="button" class="floor-batch-toolbar__btn" data-batch-act="align-right" title="تراز از لبه راست">⇥ راست</button>
                <button type="button" class="floor-batch-toolbar__btn" data-batch-act="align-top" title="تراز از بالا">⤒ بالا</button>
                <button type="button" class="floor-batch-toolbar__btn" data-batch-act="align-center-y" title="تراز از مرکز عمودی">⤸ وسط</button>
                <button type="button" class="floor-batch-toolbar__btn" data-batch-act="align-bottom" title="تراز از پایین">⤓ پایین</button>
              </div>
              <div class="floor-batch-toolbar__group">
                <span class="floor-batch-toolbar__label">فاصله:</span>
                <button type="button" class="floor-batch-toolbar__btn" data-batch-act="distribute-h" title="توزیع مساوی فاصله افقی">⇔ افقی</button>
                <button type="button" class="floor-batch-toolbar__btn" data-batch-act="distribute-v" title="توزیع مساوی فاصله عمودی">⇕ عمودی</button>
              </div>
              <div class="floor-batch-toolbar__group">
                <button type="button" class="floor-batch-toolbar__btn floor-batch-toolbar__btn--primary" data-batch-act="batch-merge" title="ادغام میزهای انتخاب‌شده به میز گروهی">🔗 ادغام میزها</button>
                <button type="button" class="floor-batch-toolbar__btn floor-batch-toolbar__btn--danger" data-batch-act="batch-delete" title="حذف میزهای انتخاب‌شده">🗑️ حذف</button>
                <button type="button" class="floor-batch-toolbar__btn" data-batch-act="batch-clear" title="لغو انتخاب">✕</button>
              </div>
            </div>` : '';

          main.innerHTML = `
            <div class="admin-floor-page ${isEditMode ? 'is-edit-mode' : 'is-live-mode'} ${isEditMode ? (studioMode === 'architecture' ? 'is-architecture-mode' : 'is-furniture-mode') : 'is-live-mode'}">
              <header class="admin-qr-page__head">
                <div>
                  <p class="admin-qr-kicker">مرکز مدیریت سالن و چیدمان</p>
                  <h1>استودیوی نقشه و چیدمان سالن</h1>
                  <p class="lead">ترسیم دوبعدی پلان سالن، جانمایی میزها با Drag & Drop، تنظیم چرخش، فرم هندسی، تعداد صندلی و تفکیک زون‌های رستوران.</p>
                </div>
                <div class="admin-qr-page__actions">
                  <div class="floor-segmented" role="tablist" aria-label="انتخاب نمای کاربری">
                    <button type="button" class="floor-segmented__btn active" id="view-mode-map">📐 نقشه سالن</button>
                    <button type="button" class="floor-segmented__btn" id="view-mode-cards">🔲 رمزینه‌ها و لیست</button>
                  </div>
                  <div class="floor-head-utility-btns">
                    <button type="button" class="btn btn-sm btn-ghost" id="map-templates-btn" title="الگوها و چیدمان‌های آماده رستوران">📋 قالب‌های آماده</button>
                    <button type="button" class="btn btn-sm btn-ghost" id="map-floor-settings" title="ابعاد مهندسی، متراژ و تنظیمات نقشه">⚙️ تنظیمات پلان</button>
                    <button type="button" class="btn btn-sm btn-ghost" id="map-export-json" title="دریافت فایل پشتیبان چیدمان (JSON)">💾 پشتیبان</button>
                    <button type="button" class="btn btn-sm btn-ghost" id="map-import-json" title="درون‌ریزی فایل چیدمان (JSON)">📂 بازیابی</button>
                  </div>
                  <div class="floor-save-status" id="map-save-status"><span>✓ چیدمان ذخیره است</span></div>
                  <button class="btn btn-sm btn-primary" id="map-save-layout" type="button">✓ ذخیره چیدمان نقشه</button>
                </div>
              </header>

              <!-- ═══ 1. Integrated Floor Level Switcher ═══ -->
              <div class="floor-levels-bar" aria-label="مدیریت و انتخاب طبقات و فضاهای رستوران">
                <div class="floor-levels-bar__list">
                  ${floorLevels.map((fl) => `
                    <button type="button" class="floor-level-pill ${activeFloorId === fl.id ? 'is-active' : ''}" data-floor-pill="${esc(fl.id)}">
                      <span class="floor-level-pill__icon">${esc(fl.icon || '🏛️')}</span>
                      <span class="floor-level-pill__name">${esc(fl.name)}</span>
                      <span class="floor-level-pill__count">${fmtNum(tables.filter((t) => (t.floorId || 'floor-ground') === fl.id).length)} میز</span>
                      ${floorLevels.length > 1 ? `<span class="floor-level-pill__settings" data-edit-floor-pill="${esc(fl.id)}" title="تنظیمات طبقه">⚙️</span>` : ''}
                    </button>
                  `).join('')}
                  <button type="button" class="floor-level-pill floor-level-pill--add" id="map-add-floor" title="تعریف طبقه یا فضای جدید رستوران">
                    <span>＋ افزودن طبقه / فضا…</span>
                  </button>
                </div>
              </div>

              <!-- ═══ 2. Compact Live Ops Strip ═══ -->
              <div class="ops-metrics" aria-label="وضعیت زنده سالن">
                <span class="ops-metric-title">📊 آمار زنده این طبقه:</span>
                <article class="ops-metric"><strong>${fmtNum(currentFloorTables.length)}</strong><span>میزهای این طبقه</span></article>
                <article class="ops-metric is-accent"><strong>${fmtNum(busyCount)}</strong><span>در حال سرویس</span></article>
                <article class="ops-metric"><strong>${fmtNum(floorData?.summary?.reservations || 0)}</strong><span>رزرو امروز</span></article>
                <article class="ops-metric ${attnCount ? 'is-warn' : ''}"><strong>${fmtNum(attnCount)}</strong><span>فراخوان گارسون</span></article>
                <article class="ops-metric"><strong>${fmtNum(totalSeats)}</strong><span>ظرفیت این طبقه (نفر)</span></article>
              </div>

              <!-- ═══ 3. Professional CAD Unified Tool Ribbon (ALL TOOLS IN ONE ROW) ═══ -->
              <div class="floor-toolbar" role="toolbar" aria-label="نوار ابزار حرفه‌ای طراحی و ویرایش سالن">
                <!-- Group A: Edit Mode & Sub-mode Switcher -->
                <div class="floor-toolbar__group">
                  <button type="button" class="floor-edit-toggle ${isEditMode ? 'is-editing' : ''}" id="map-toggle-edit" title="فعال یا غیرفعال کردن حالت جابجایی میزها">
                    <span>${isEditMode ? '✏️ حالت ویرایش فعال' : '🔒 قفل (حالت نمایش)'}</span>
                  </button>
                  <div class="floor-studio-mode-switcher" id="map-studio-mode-switcher" style="${isEditMode ? '' : 'display:none;'}">
                    <button type="button" class="floor-studio-mode-btn ${studioMode === 'furniture' ? 'is-active' : ''}" id="map-mode-furniture" title="حالت چیدمان میزها و صندلی‌ها (اولویت با میزها)">
                      <span>🛋️ مبلمان</span>
                    </button>
                    <button type="button" class="floor-studio-mode-btn ${studioMode === 'architecture' ? 'is-active' : ''}" id="map-mode-architecture" title="حالت معماری فضاها (جابجایی دیوارها، متراژ و حذف فضا)">
                      <span>📐 فضاها</span>
                    </button>
                  </div>
                </div>

                <div class="floor-toolbar__divider"></div>

                <!-- Group B: Creation & Insertion Palette -->
                <div class="floor-toolbar__group">
                  <button class="floor-tool-btn floor-tool-btn--primary" id="map-add-table" type="button" title="افزودن میز به نقشه">
                    <span>＋ 🪑 میز جدید</span>
                  </button>
                  <button class="floor-tool-btn" id="map-add-fixture" type="button" title="افزودن سازه معماری، پیشخوان، دیوار یا سرویس">
                    <span>＋ 🏛️ سازه معماری</span>
                  </button>
                  <button class="floor-tool-btn ${isDrawingZone ? 'is-active' : ''}" id="map-draw-zone" type="button" title="ترسیم محدوده بخش جدید با ماوس روی نقشه">
                    <span>＋ 📐 ترسیم بخش</span>
                  </button>
                </div>

                <div class="floor-toolbar__divider"></div>

                <!-- Group C: Precision Snapping & CAD Alignment -->
                <div class="floor-toolbar__group">
                  <button class="floor-tool-btn" id="map-auto-align" type="button" title="مرتب‌سازی خودکار میزها در هر بخش">
                    <span>↺ تراز خودکار</span>
                  </button>
                  <div class="floor-snapping-ctrl" style="display:inline-flex;align-items:center;gap:3px">
                    <span class="floor-toolbar__label" title="تنظیم دقت پرش به شبکه (Grid Snapping)">🧲 شبکه:</span>
                    <button type="button" class="floor-snap-pill ${snapGridStep === 0.5 ? 'is-active' : ''}" data-snap-val="0.5">آزاد</button>
                    <button type="button" class="floor-snap-pill ${snapGridStep === 2 ? 'is-active' : ''}" data-snap-val="2">۲٪</button>
                    <button type="button" class="floor-snap-pill ${snapGridStep === 5 ? 'is-active' : ''}" data-snap-val="5">۵٪</button>
                  </div>
                </div>

                <div class="floor-toolbar__divider"></div>

                <!-- Group D: History (Undo / Redo) -->
                <div class="floor-toolbar__group floor-history-buttons">
                  <button type="button" class="floor-tool-btn" id="map-history-undo" title="بازگشت تغییر قبلی (Ctrl+Z)" ${layoutHistory.length === 0 ? 'disabled' : ''}>↩</button>
                  <button type="button" class="floor-tool-btn" id="map-history-redo" title="بازانجام تغییر (Ctrl+Y)" ${layoutRedoHistory.length === 0 ? 'disabled' : ''}>↪</button>
                </div>

                <div class="floor-toolbar__divider"></div>

                <!-- Group E: Zone Filtering & Management -->
                <div class="floor-toolbar__group floor-toolbar__group--zones">
                  <span class="floor-toolbar__label">بخش:</span>
                  <div class="floor-zone-pills">
                    ${zonesList.map((z) => `
                      <button type="button" class="floor-zone-pill ${activeZone === z ? 'active' : ''}" data-zone-pill="${esc(z)}">
                        <span>${esc(zoneTitle(z))}</span>
                        <small>${fmtNum(z === 'all' ? currentFloorTables.length : currentFloorTables.filter((t) => normalizeZone(t.zone) === z).length)}</small>
                        ${z !== 'all' ? `<span class="floor-zone-pill__del" data-delete-zone-pill="${esc(z)}" title="حذف بخش «${esc(z)}»" role="button">✕</span>` : ''}
                      </button>`).join('')}
                    <button type="button" class="floor-zone-pill floor-zone-pill--add" id="map-add-zone" title="تعریف بخش اختصاصی جدید">＋ بخش…</button>
                  </div>
                  ${currentActiveZoneObj ? `
                    <div class="floor-active-zone-strip">
                      <span class="floor-active-zone-strip__dims">📐 ${fmtNum(currentActiveZoneObj.lengthM || 10)}×${fmtNum(currentActiveZoneObj.widthM || 3)}م</span>
                      <button type="button" class="floor-active-zone-strip__btn" id="map-active-zone-dims" title="تنظیم متراژ و ابعاد معماری">📏 ابعاد</button>
                      <button type="button" class="floor-active-zone-strip__btn" id="map-active-zone-rename" title="تغییر نام این بخش">✏️ نام</button>
                      <button type="button" class="floor-active-zone-strip__btn" id="map-active-zone-color" title="تغییر رنگ این بخش">🎨 رنگ</button>
                      <button type="button" class="floor-active-zone-strip__btn floor-active-zone-strip__btn--danger" id="map-active-zone-delete" title="حذف کامل این بخش">🗑️</button>
                    </div>` : ''}
                </div>
              </div>

              <!-- ═══ 4. Quick Status Key Strip ═══ -->
              <div class="floor-canvas-legend floor-canvas-legend--top" aria-label="راهنمای وضعیت میزها">
                <strong>وضعیت میزها:</strong>
                <span class="leg-item"><i class="leg-dot leg-dot--avail"></i> آزاد (${fmtNum(freeCount)})</span>
                <span class="leg-item"><i class="leg-dot leg-dot--busy"></i> در سرویس (${fmtNum(busyCount)})</span>
                <span class="leg-item"><i class="leg-dot leg-dot--attn"></i> فراخوان (${fmtNum(attnCount)})</span>
                <span class="leg-item"><i class="leg-dot leg-dot--res"></i> رزرو</span>
                <span class="leg-item"><i class="leg-dot" style="background:#94a3b8"></i> غیرفعال</span>
              </div>

              <div class="architectural-canvas-wrap ${isEditMode ? 'is-edit-mode' : ''} ${isDrawingZone ? 'is-drawing-zone' : ''} studio-mode--${isEditMode ? studioMode : 'live'} floor-theme--${floorSettings.bgTheme || 'slate-blueprint'}" id="admin-floor-canvas">
                ${floorSettings.showRulers !== false ? `
                  <div class="floor-canvas-ruler-x" id="admin-ruler-x">${renderRulerTicksX(floorSettings.lengthM || 20)}</div>
                  <div class="floor-canvas-ruler-y" id="admin-ruler-y">${renderRulerTicksY(floorSettings.widthM || 15)}</div>
                ` : ''}

                <div class="admin-floor-canvas-scaler" id="admin-canvas-scaler" style="transform: scale(${canvasZoom})">
                  ${renderedZonesHtml}

                  <svg class="floor-canvas-connectors" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2">
                    ${renderSvgConnectors()}
                  </svg>

                  <div class="plan-fixtures-layer" id="admin-fixtures-layer">
                    ${visibleFixtures.length > 0 ? visibleFixtures.map((f) => renderFixtureItem(f)).join('') : `
                      <div class="plan-fixture plan-fixture--entrance" title="ورودی اصلی رستوران"></div>
                      <div class="plan-fixture plan-fixture--bar">☕ بار گرم و سرد</div>
                      <div class="plan-fixture plan-fixture--kitchen">🍳 تحویل غذا</div>
                      <div class="plan-fixture plan-fixture--cashier">💳 صندوق و پذیرش</div>
                      <div class="plan-fixture plan-fixture--restroom">🚻 سرویس</div>
                    `}
                  </div>

                  <div class="plan-tables-layer" id="admin-tables-layer">
                    ${visibleTables.map((t) => renderPlanTableItem(t)).join('')}
                  </div>
                </div>

                ${batchToolbarHtml}
                ${inspectorHtml}

                <div class="floor-canvas-controls">
                  <button type="button" id="map-zoom-out" title="کوچک‌نمایی">－</button>
                  <span class="zoom-indicator" id="map-zoom-label">${Math.round(canvasZoom * 100)}٪</span>
                  <button type="button" id="map-zoom-in" title="بزرگ‌نمایی">＋</button>
                  <button type="button" id="map-zoom-reset" title="اندازه پیش‌فرض (۱۰۰٪)">۱۰۰٪</button>
                </div>

              </div>

              <div class="floor-legend">
                <div>
                  <strong>راهنمای استودیوی معماری و نقشه سالن وستو:</strong>
                  با Drag & Drop میزها و سازه‌های معماری را جابجا کنید. با انتخاب هر میز می‌توانید فرم هندسی آن را به ۷ حالت (مستطیل، دایره، مربع، نیمکت، صندلی بار، بیضی، تخت سنتی ایرانی با پشتی و قالیچه) تغییر دهید، میزها را ادغام یا تفکیک کنید، تعداد صندلی را تغییر دهید، بین طبقات جابجا نمایید یا تکثیر کنید. همچنین با درگ ماوس روی پس‌زمینه نقشه، چند میز را انتخاب کرده و از نوار هم‌ترازی CAD برای تراز و فاصله‌گذاری مهندسی استفاده کنید.
                </div>
              </div>
            </div>`;

          bindMapEvents();
          return;
        }

        const current = tableById(currentTableId) || tables[0] || null;
        currentTableId = current ? Number(current.id) : null;
        const tableOptions = tables.map((table) => `<option value="${table.id}" ${Number(table.id) === Number(currentTableId) ? 'selected' : ''}>${esc(tableTitle(table))} · ${esc(table.zone || 'سالن')}</option>`).join('');
        const currentPreview = current
          ? `<div class="admin-qr-preview">
              <div class="admin-qr-preview__stage"><img id="qr-live-preview" data-qr-img="${current.id}" src="${esc(qrAssetUrl(current))}" alt="پیش‌نمایش رمزینه ${esc(tableTitle(current))}" /></div>
              <div class="admin-qr-preview__details">
                <div class="admin-qr-preview__table"><strong id="qr-current-name">${esc(tableTitle(current))}</strong><span id="qr-current-seats">${fmtNum(current.seats || 0)} نفر</span></div>
                <p class="hint" id="qr-current-zone">${esc(current.zone || 'سالن')} · مقصد امن و اختصاصی همین میز</p>
                <div class="admin-qr-destination"><small>مقصد ذخیره‌شده در رمزینه</small><code id="qr-current-destination" dir="ltr">${esc(tableDestination(current))}</code></div>
                <div class="admin-qr-preview__actions">
                  <a class="btn btn-sm" id="qr-download-current" href="${esc(qrAssetUrl(current, { download: true }))}" download="westo-table-${current.id}.png">دریافت تصویر</a>
                  <button type="button" class="btn btn-sm btn-ghost" id="qr-copy-current">کپی لینک</button>
                  <button type="button" class="btn btn-sm btn-ghost" id="qr-print-current">چاپ همین رمزینه</button>
                </div>
              </div>
            </div>`
          : `<div class="admin-qr-preview__stage is-empty" role="status"></div>`;

        main.innerHTML = `
          <div class="admin-qr-page">
            <header class="admin-qr-page__head">
              <div>
                <p class="admin-qr-kicker">مدیریت رمزینه سفارش میز</p>
                <h1>ساخت رمزینه اختصاصی میزها</h1>
                <p class="lead">برای هر میز یک رمزینه بسازید؛ مهمان با اسکن آن وارد منوی دیجیتال می‌شود و شماره میز از ابتدا روی سفارش قرار می‌گیرد.</p>
              </div>
              <div class="admin-qr-page__actions">
                <div class="floor-segmented" role="tablist" aria-label="انتخاب نمای کاربری">
                  <button type="button" class="floor-segmented__btn" id="view-mode-map">📐 نقشه سالن</button>
                  <button type="button" class="floor-segmented__btn active" id="view-mode-cards">🔲 رمزینه‌ها و لیست</button>
                </div>
                <button class="btn btn-sm btn-ghost" id="neem-tables-open" type="button">📐 نمای نقشه و چیدمان سالن</button>
                <button class="btn btn-sm btn-ghost" id="qr-print-all" type="button" ${tables.length ? '' : 'disabled'}>چاپ همه میزها</button>
                <button class="btn btn-sm" id="t-add" type="button">افزودن میز</button>
              </div>
            </header>
            <div class="admin-qr-notice"><span class="admin-qr-notice__icon" aria-hidden="true">⌁</span><div><strong>جریان سفارش بدون تغییر در بخش‌های دیگر</strong>لینک هر رمزینه شامل شناسه میز و شعبه است؛ مقصد را پیش از چاپ با دکمه «مشاهده» یا اسکن آزمایشی بررسی کنید.</div></div>
            <div class="ops-metrics" aria-label="وضعیت زنده سالن">
              <article class="ops-metric"><strong>${fmtNum(floorData.summary?.total || tables.length)}</strong><span>کل میزها</span></article>
              <article class="ops-metric is-accent"><strong>${fmtNum(busyCount)}</strong><span>در حال سرویس</span></article>
              <article class="ops-metric"><strong>${fmtNum(floorData.summary?.reservations || 0)}</strong><span>رزرو امروز</span></article>
              <article class="ops-metric ${attnCount ? 'is-warn' : ''}"><strong>${fmtNum(attnCount)}</strong><span>فراخوان گارسون</span></article>
            </div>
            <div class="admin-qr-metrics" aria-label="خلاصه میزها">
              <div class="admin-qr-metric"><span class="admin-qr-metric__label">کل میزها</span><strong class="admin-qr-metric__value">${fmtNum(tables.length)}</strong><span class="admin-qr-metric__hint">این شعبه</span></div>
              <div class="admin-qr-metric"><span class="admin-qr-metric__label">میزهای فعال</span><strong class="admin-qr-metric__value">${fmtNum(activeTables().length)}</strong><span class="admin-qr-metric__hint">قابل استفاده برای مهمان</span></div>
              <div class="admin-qr-metric"><span class="admin-qr-metric__label">انتخاب چاپ</span><strong class="admin-qr-metric__value" id="qr-selected-metric">${fmtNum(selectedTableIds.size)}</strong><span class="admin-qr-metric__hint">برای چاپ گروهی</span></div>
              <div class="admin-qr-metric"><span class="admin-qr-metric__label">مقاومت چاپ</span><strong class="admin-qr-metric__value" id="qr-ecl-metric">${esc(qrEclLabel())}</strong><span class="admin-qr-metric__hint" id="qr-ecl-hint">${esc(qrEclHint())}</span></div>
            </div>
            <div class="admin-qr-studio">
              <section class="admin-qr-card"><div class="admin-qr-card__head"><div><h2>پیش‌نمایش زنده</h2><p>ظاهر، لینک و فایل چاپی میز انتخاب‌شده را همین‌جا بررسی کنید.</p></div><span class="admin-qr-safe-badge">آماده چاپ</span></div><div class="admin-qr-card__body">${currentPreview}</div></section>
              <section class="admin-qr-card"><div class="admin-qr-card__head"><div><h2>تنظیمات خروجی</h2><p>تنظیمات در همین مرورگر ذخیره می‌شود و روی سفارش‌ها اثری ندارد.</p></div></div><div class="admin-qr-card__body"><div class="admin-qr-controls">
                <label class="admin-qr-controls__wide"><span>میز برای پیش‌نمایش</span><select id="qr-current-table" ${tables.length ? '' : 'disabled'}>${tableOptions || '<option>میزی وجود ندارد</option>'}</select></label>
                <label class="admin-qr-controls__wide"><span>آدرس عمومی منو</span><input id="qr-base-url" type="url" dir="ltr" value="${esc(qrPrefs.baseUrl)}" placeholder="https://example.com" autocomplete="url" /><small class="admin-qr-base-note">اگر پنل روی رایانه محلی است، آدرس قابل‌دسترسی برای موبایل را وارد کنید.</small></label>
                <div class="admin-qr-controls__group"><label><span>رنگ کد</span><input id="qr-dark" type="color" value="${esc(qrPrefs.dark)}" aria-label="رنگ رمزینه" /></label><label><span>رنگ پس‌زمینه</span><input id="qr-light" type="color" value="${esc(qrPrefs.light)}" aria-label="رنگ پس‌زمینه رمزینه" /></label></div>
                <div class="admin-qr-controls__group"><label><span>مقاومت در برابر آسیب چاپ</span><select id="qr-ecl"><option value="M" ${qrPrefs.ecl === 'M' ? 'selected' : ''}>پیشنهاد وستو</option><option value="Q" ${qrPrefs.ecl === 'Q' ? 'selected' : ''}>مقاوم‌تر برای محیط شلوغ</option><option value="H" ${qrPrefs.ecl === 'H' ? 'selected' : ''}>بیشترین تحمل آسیب</option><option value="L" ${qrPrefs.ecl === 'L' ? 'selected' : ''}>فایل سبک</option></select></label><label><span>ابعاد فایل</span><select id="qr-width"><option value="512" ${qrPrefs.width === 512 ? 'selected' : ''}>۵۱۲ پیکسل</option><option value="768" ${qrPrefs.width === 768 ? 'selected' : ''}>۷۶۸ پیکسل</option><option value="1024" ${qrPrefs.width === 1024 ? 'selected' : ''}>۱۰۲۴ پیکسل</option></select></label></div>
                <label><span>حاشیه سفید استاندارد</span><select id="qr-margin"><option value="3" ${qrPrefs.margin === 3 ? 'selected' : ''}>کم · ۳ ماژول</option><option value="5" ${qrPrefs.margin === 5 ? 'selected' : ''}>استاندارد · ۵ ماژول</option><option value="8" ${qrPrefs.margin === 8 ? 'selected' : ''}>زیاد · چاپ حرفه‌ای</option></select></label>
                <p class="admin-qr-control-note">برای چاپ روی میز، پس‌زمینه روشن، کنتراست بالا و حاشیه استاندارد را نگه دارید.</p>
                <div class="admin-qr-controls__footer"><button type="button" class="btn btn-sm btn-ghost" id="qr-reset-prefs">بازنشانی تنظیمات</button><span class="hint">تصویر استاندارد و آماده چاپ تولید می‌شود</span></div>
              </div></div></section>
            </div>
            <section class="admin-qr-card admin-qr-tables"><div class="admin-qr-card__head"><div><h2>میزهای ${br ? esc(br.name) : ''}</h2><p>هر کارت یک رمزینه مستقل دارد؛ انتخاب چند کارت، چاپ گروهی را فعال می‌کند.</p></div></div>
              <div class="admin-qr-tables__toolbar"><div class="admin-qr-tables__toolbar-left"><label class="admin-qr-select-all"><input id="qr-select-all" type="checkbox" /> انتخاب همه</label><span class="admin-qr-selection-count" id="qr-selection-count">${selectedLabel()}</span></div><div class="admin-qr-tables__toolbar-right"><button class="btn btn-sm btn-ghost" id="qr-print-selected" type="button" disabled>چاپ انتخاب‌شده</button></div></div>
              <div class="admin-qr-table-grid">${tables.map((table) => {
                const id = Number(table.id);
                const selected = selectedTableIds.has(id);
                const currentClass = id === Number(currentTableId) ? ' is-current' : '';
                const selectedClass = selected ? ' is-selected' : '';
                return `<article class="admin-qr-table-card${currentClass}${selectedClass}" data-qr-card="${id}"><div class="admin-qr-table-card__top"><label class="admin-qr-table-card__select"><input type="checkbox" data-qr-select="${id}" ${selected ? 'checked' : ''} /><span>${esc(tableTitle(table))}</span></label><span class="admin-qr-table-card__badge">${table.active !== false ? 'فعال' : 'غیرفعال'}</span></div><div class="admin-qr-table-card__body"><div class="admin-qr-table-card__qr"><img data-qr-img="${id}" loading="lazy" src="${esc(qrAssetUrl(table))}" alt="رمزینه ${esc(tableTitle(table))}" /></div><div class="admin-qr-table-card__fields"><label><span>برچسب</span><input class="t-label" value="${esc(table.label)}" /></label><label><span>ظرفیت</span><input class="t-seats ltr-input" dir="ltr" type="number" min="1" max="20" value="${Number(table.seats) || 4}" /></label><label><span>بخش سالن</span><input class="t-zone" value="${esc(table.zone || '')}" /></label><label class="admin-qr-table-card__toggle"><span>قابل سفارش</span><input class="t-active" type="checkbox" ${table.active !== false ? 'checked' : ''} /></label></div></div><div class="admin-qr-table-card__meta"><span>شناسه رمزینه: <b dir="ltr">${esc(table.id)}</b></span><span>میز: <b>${esc(table.zone || 'سالن')}</b></span></div><div class="admin-qr-table-card__actions"><button type="button" class="btn btn-sm btn-ghost" data-qr-open="${id}">انتخاب</button><a class="btn btn-sm btn-ghost" data-qr-download="${id}" href="${esc(qrAssetUrl(table, { download: true }))}" download="westo-table-${id}.png">دریافت</a><button type="button" class="btn btn-sm btn-danger" data-tdel="${id}">حذف</button></div></article>`;
              }).join('') || '<div class="admin-qr-table-empty"><strong>هنوز میزی برای این شعبه ساخته نشده است.</strong>با دکمه «افزودن میز» نخستین رمزینه اختصاصی را بسازید.</div>'}</div>
            </section>
          </div>`;

        bindCardsEvents();
      };

      const bindMapEvents = () => {
        const canvas = document.getElementById('admin-floor-canvas');
        if (!canvas) return;

        document.getElementById('view-mode-map')?.addEventListener('click', () => setViewMode('map'));
        document.getElementById('view-mode-cards')?.addEventListener('click', () => setViewMode('cards'));

        // Deselect when clicking background
        canvas.addEventListener('click', (e) => {
          if (!e.target.closest('.plan-table') && !e.target.closest('.table-floating-palette') && !e.target.closest('.plan-fixture') && !e.target.closest('.fixture-floating-palette') && !e.target.closest('.plan-zone') && !e.target.closest('.zone-floating-palette') && !e.target.closest('.floor-table-inspector') && !e.target.closest('.floor-canvas-controls')) {
            let needsRender = false;
            if (selectedTableId !== null) { selectedTableId = null; needsRender = true; }
            if (selectedFixtureId !== null) { selectedFixtureId = null; needsRender = true; }
            if (selectedZoneId !== null) { selectedZoneId = null; needsRender = true; }
            if (needsRender) render();
          }
        });

        // Zoom controls
        const scaler = document.getElementById('admin-canvas-scaler');
        const zoomLabel = document.getElementById('map-zoom-label');
        const updateZoomUi = () => {
          if (scaler) scaler.style.transform = `scale(${canvasZoom})`;
          if (zoomLabel) zoomLabel.textContent = `${Math.round(canvasZoom * 100)}٪`;
        };

        document.getElementById('map-zoom-in')?.addEventListener('click', () => {
          canvasZoom = Math.min(2.0, Math.round((canvasZoom + 0.1) * 10) / 10);
          updateZoomUi();
        });
        document.getElementById('map-zoom-out')?.addEventListener('click', () => {
          canvasZoom = Math.max(0.5, Math.round((canvasZoom - 0.1) * 10) / 10);
          updateZoomUi();
        });
        document.getElementById('map-zoom-reset')?.addEventListener('click', () => {
          canvasZoom = 1.0;
          updateZoomUi();
        });

        // Grid snap selector
        main.querySelectorAll('.floor-snap-pill[data-snap-val]').forEach((btn) => {
          btn.addEventListener('click', () => {
            snapGridStep = parseFloat(btn.dataset.snapVal) || 0.5;
            main.querySelectorAll('.floor-snap-pill').forEach((b) => b.classList.toggle('is-active', b === btn));
          });
        });

        // Live table inspector drawer
        const inspectorCard = document.getElementById('floor-inspector-card');
        if (inspectorCard) {
          document.getElementById('floor-inspector-close')?.addEventListener('click', () => {
            selectedTableId = null;
            render();
          });
          document.getElementById('floor-inspector-switch-edit')?.addEventListener('click', () => {
            isEditMode = true;
            render();
            showToast('حالت ویرایش چیدمان فعال گردید.', 'info');
          });
          document.getElementById('floor-inspector-resolve')?.addEventListener('click', async () => {
            const inspTable = tableById(selectedTableId);
            if (!inspTable) return;
            try {
              let callId = inspTable.waiterCallId;
              if (!callId) {
                const callsData = await api(`/api/waiter/calls${branchQs()}`);
                const openCalls = Array.isArray(callsData?.calls) ? callsData.calls : Array.isArray(callsData) ? callsData : [];
                const matching = openCalls.find((c) => (c.status === 'open' || c.status === 'new') && (String(c.tableNo).includes(String(inspTable.id)) || String(c.tableNo).includes(String(inspTable.label))));
                if (matching) callId = matching.id;
              }
              if (callId) {
                await api(`/api/waiter/calls/${callId}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) });
                showToast('رسیدگی به فراخوان میز با موفقیت ثبت شد.', 'success');
              } else {
                showToast('فراخوان بازی برای این میز یافت نشد.', 'info');
              }
              await loadFloorData();
              render();
            } catch (err) {
              showToast(err.message || 'خطا در ثبت رسیدگی به فراخوان', 'error');
            }
          });
        }

        // Live countdown timer updater
        if (window.__floorTimerInterval) clearInterval(window.__floorTimerInterval);
        window.__floorTimerInterval = setInterval(() => {
          const timers = canvas.querySelectorAll('.plan-table-timer[data-service-ends]');
          timers.forEach((tEl) => {
            const ends = tEl.getAttribute('data-service-ends');
            if (ends) tEl.textContent = floorCountdownLabel(ends);
          });
        }, 1000);

        // Plan table items
        canvas.querySelectorAll('.plan-table').forEach((el) => {
          const tableId = Number(el.dataset.table);
          const table = tableById(tableId);
          if (!table) return;

          el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (e.target.closest('.table-floating-palette')) return;
            if (justDragged) return;
            selectedZoneId = null;
            selectedFixtureId = null;
            if (Number(selectedTableId) !== Number(table.id)) {
              selectedTableId = table.id;
              currentTableId = table.id;
              render();
            }
          });

          if (isEditMode) {
            el.addEventListener('pointerdown', (e) => {
              if (e.target.closest('.table-floating-palette')) return;
              e.stopPropagation();
              e.preventDefault();
              const scaleEl = document.getElementById('admin-canvas-scaler') || canvas;
              const rect = scaleEl.getBoundingClientRect();
              activeDrag = {
                table,
                el,
                startX: e.clientX,
                startY: e.clientY,
                originX: Number(table.x) || 50,
                originY: Number(table.y) || 50,
                rect,
                hasMoved: false,
              };
              el.classList.add('is-dragging');
              try { el.setPointerCapture(e.pointerId); } catch (_) {}

              let badge = el.querySelector('.plan-table-coords-badge');
              if (!badge) {
                badge = document.createElement('span');
                badge.className = 'plan-table-coords-badge';
                el.appendChild(badge);
              }
              badge.textContent = `${Math.round(table.x)}% , ${Math.round(table.y)}%`;

              const onPointerMove = (ev) => {
                if (!activeDrag || Number(activeDrag.table.id) !== Number(table.id)) return;
                const dx = ((ev.clientX - activeDrag.startX) / activeDrag.rect.width) * 100;
                const dy = ((ev.clientY - activeDrag.startY) / activeDrag.rect.height) * 100;
                if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) {
                  activeDrag.hasMoved = true;
                }
                let newX = Math.round((activeDrag.originX + dx) / snapGridStep) * snapGridStep;
                let newY = Math.round((activeDrag.originY + dy) / snapGridStep) * snapGridStep;

                // Smart guides snapping to nearby tables
                let matchedX = null;
                let matchedY = null;
                const visibleOtherTables = tables.filter((t) => Number(t.id) !== Number(table.id) && (!activeFloorId || t.floorId === activeFloorId));
                for (const ot of visibleOtherTables) {
                  const ox = Number(ot.x) || 50;
                  const oy = Number(ot.y) || 50;
                  if (Math.abs(newX - ox) <= 1.2) {
                    newX = ox;
                    matchedX = ox;
                  }
                  if (Math.abs(newY - oy) <= 1.2) {
                    newY = oy;
                    matchedY = oy;
                  }
                }

                newX = Math.max(5, Math.min(95, newX));
                newY = Math.max(5, Math.min(95, newY));
                table.x = newX;
                table.y = newY;
                el.style.left = `${newX}%`;
                el.style.top = `${newY}%`;
                if (badge) badge.textContent = `${Math.round(newX)}% , ${Math.round(newY)}%`;

                const scaleEl = document.getElementById('admin-canvas-scaler') || canvas;
                let guideX = document.getElementById('floor-smart-guide-x');
                let guideY = document.getElementById('floor-smart-guide-y');
                if (matchedX !== null) {
                  if (!guideX && scaleEl) {
                    guideX = document.createElement('div');
                    guideX.id = 'floor-smart-guide-x';
                    guideX.className = 'floor-smart-guide floor-smart-guide--x';
                    scaleEl.appendChild(guideX);
                  }
                  if (guideX) { guideX.style.display = 'block'; guideX.style.left = `${matchedX}%`; }
                } else if (guideX) {
                  guideX.style.display = 'none';
                }

                if (matchedY !== null) {
                  if (!guideY && scaleEl) {
                    guideY = document.createElement('div');
                    guideY.id = 'floor-smart-guide-y';
                    guideY.className = 'floor-smart-guide floor-smart-guide--y';
                    scaleEl.appendChild(guideY);
                  }
                  if (guideY) { guideY.style.display = 'block'; guideY.style.top = `${matchedY}%`; }
                } else if (guideY) {
                  guideY.style.display = 'none';
                }
              };

              const onPointerUp = (ev) => {
                if (!activeDrag || Number(activeDrag.table.id) !== Number(table.id)) return;
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                window.removeEventListener('pointercancel', onPointerUp);
                el.classList.remove('is-dragging');
                badge?.remove();
                const gx = document.getElementById('floor-smart-guide-x');
                const gy = document.getElementById('floor-smart-guide-y');
                if (gx) gx.style.display = 'none';
                if (gy) gy.style.display = 'none';
                try { el.releasePointerCapture(ev.pointerId || e.pointerId); } catch (_) {}
                if (activeDrag.hasMoved) {
                  justDragged = true;
                  setTimeout(() => { justDragged = false; }, 180);
                  debouncedSaveFloor();
                }
                activeDrag = null;
              };

              window.addEventListener('pointermove', onPointerMove);
              window.addEventListener('pointerup', onPointerUp);
              window.addEventListener('pointercancel', onPointerUp);
            });

            const palette = el.querySelector('.table-floating-palette');
            if (palette) {
              palette.addEventListener('click', async (e) => {
                const btn = e.target.closest('[data-table-action]');
                if (!btn) return;
                e.stopPropagation();
                const action = btn.dataset.tableAction;
                if (action === 'furniture-modal') {
                  promptTableFurnitureModal(table);
                } else if (action === 'toggle-more') {
                  const menu = palette.querySelector('.palette-more-menu');
                  if (menu) {
                    const isHidden = menu.style.display === 'none' || !menu.style.display;
                    menu.style.display = isHidden ? 'flex' : 'none';
                  }
                } else if (action === 'rotate') {
                  table.rotation = ((Number(table.rotation) || 0) + 45) % 360;
                  el.style.transform = `translate(-50%, -50%) rotate(${table.rotation}deg)`;
                  el.style.setProperty('--table-rot', `${table.rotation}deg`);
                  debouncedSaveFloor();
                } else if (action === 'toggle-shape') {
                  const shapeCycle = ['rectangle', 'conference', 'semi_circle', 'wall_counter', 'circle', 'square', 'oval', 'booth', 'round_booth', 'bar_stool', 'lounge_takht'];
                  const currIdx = shapeCycle.indexOf(table.shape || 'rectangle');
                  table.shape = shapeCycle[(currIdx + 1) % shapeCycle.length];
                  render();
                  debouncedSaveFloor();
                } else if (action === 'inc-seats') {
                  table.seats = Math.min(24, (Number(table.seats) || 4) + 1);
                  render();
                  debouncedSaveFloor();
                } else if (action === 'dec-seats') {
                  table.seats = Math.max(1, (Number(table.seats) || 4) - 1);
                  render();
                  debouncedSaveFloor();
                } else if (action === 'inc-scale') {
                  const curScale = Number(table.scale) || 1;
                  table.scale = Math.min(3.0, Math.round((curScale + 0.1) * 10) / 10);
                  pushHistory('بزرگ‌کردن مقیاس میز');
                  render();
                  debouncedSaveFloor();
                } else if (action === 'dec-scale') {
                  const curScale = Number(table.scale) || 1;
                  table.scale = Math.max(0.5, Math.round((curScale - 0.1) * 10) / 10);
                  pushHistory('کوچک‌کردن مقیاس میز');
                  render();
                  debouncedSaveFloor();
                } else if (action === 'toggle-active') {
                  table.active = table.active === false ? true : false;
                  render();
                  debouncedSaveFloor();
                  showToast(`میز ${tableTitle(table)} ${table.active ? 'فعال' : 'غیرفعال'} شد.`, 'info');
                } else if (action === 'merge') {
                  if ((table.mergedWith && table.mergedWith.length > 0) || table.mergedInto) {
                    unmergeTable(table.id);
                  } else {
                    mergeTablesGroup(table.id);
                  }
                } else if (action === 'move-floor') {
                  promptMoveTableFloor(table.id);
                } else if (action === 'duplicate') {
                  const nextId = (tables.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0)) + 1;
                  const copy = {
                    ...table,
                    id: nextId,
                    label: `${table.label || `میز ${table.id}`} (کپی)`,
                    x: Math.min(92, (Number(table.x) || 50) + 5),
                    y: Math.min(92, (Number(table.y) || 50) + 5),
                    active: true,
                  };
                  ensureTableGeometry(copy, tables.length);
                  tables.push(copy);
                  selectedTableId = copy.id;
                  currentTableId = copy.id;
                  await saveFloorLayout(true);
                  render();
                  showToast(`میز «${copy.label}» تکثیر شد.`, 'success');
                } else if (action === 'rename') {
                  promptRenameTable(table);
                } else if (action === 'delete') {
                  await deleteTableFromMap(table.id);
                } else if (action === 'close') {
                  selectedTableId = null;
                  render();
                }
              });

              const zoneSelect = palette.querySelector('select[data-table-action="zone-select"]');
              if (zoneSelect) {
                zoneSelect.addEventListener('change', (e) => {
                  table.zone = normalizeZone(e.target.value);
                  render();
                  debouncedSaveFloor();
                });
              }
            }
          }
        });

        // Zone interactive actions
        canvas.querySelectorAll('[data-zone-action]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.zoneAction;
            const zoneId = btn.dataset.zoneId;
            const zone = floorZones.find((z) => z.id === zoneId);
            if (!zone) return;
            if (action === 'rename') promptRenameZone(zone);
            else if (action === 'dimensions') promptZoneDimensions(zone);
            else if (action === 'color') cycleZoneColor(zone);
            else if (action === 'split') splitZone(zone);
            else if (action === 'delete') deleteZone(zone.id);
            else if (action === 'close') {
              selectedZoneId = null;
              render();
            }
          });
        });

        // Click zone on canvas to select and reveal floating action palette in edit mode
        canvas.querySelectorAll('.plan-zone--interactive').forEach((zoneEl) => {
          const zoneId = zoneEl.dataset.zoneId;
          zoneEl.addEventListener('click', (e) => {
            if (e.target.closest('[data-zone-action]') || e.target.closest('.zone-handle') || e.target.closest('.plan-table') || e.target.closest('.plan-fixture')) return;
            if (isEditMode) {
              if (studioMode === 'architecture' || e.target.closest('.plan-zone__header')) {
                selectedZoneId = zoneId;
                selectedTableId = null;
                selectedFixtureId = null;
                render();
              }
            }
          });

          zoneEl.addEventListener('contextmenu', (e) => {
            if (!isEditMode) return;
            if (studioMode !== 'architecture') return;
            if (e.target.closest('.plan-table') || e.target.closest('.plan-fixture')) return;
            e.preventDefault();
            e.stopPropagation();
            selectedZoneId = zoneId;
            deleteZone(zoneId);
          });
        });

        // Zone handle resizing
        canvas.querySelectorAll('.zone-handle').forEach((handleEl) => {
          handleEl.addEventListener('contextmenu', (e) => {
            if (!isEditMode) return;
            e.preventDefault();
            e.stopPropagation();
            const zoneId = handleEl.dataset.zoneId;
            selectedZoneId = zoneId;
            deleteZone(zoneId);
          });

          handleEl.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const zoneId = handleEl.dataset.zoneId;
            const handleDir = handleEl.dataset.handle;
            const zone = floorZones.find((z) => z.id === zoneId);
            if (!zone) return;
            selectedZoneId = zoneId;
            const zoneEl = canvas.querySelector(`.plan-zone[data-zone-id="${zone.id}"]`);
            if (zoneEl) zoneEl.classList.add('is-resizing');

            const scaleEl = document.getElementById('admin-canvas-scaler') || canvas;
            const rect = scaleEl.getBoundingClientRect();
            const startX = e.clientX;
            const startY = e.clientY;
            const origX = zone.x;
            const origY = zone.y;
            const origW = zone.w;
            const origH = zone.h;

            handleEl.classList.add('is-resizing');
            try { handleEl.setPointerCapture(e.pointerId); } catch (_) {}

            const onPointerMove = (ev) => {
              const dx = ((ev.clientX - startX) / rect.width) * 100;
              const dy = ((ev.clientY - startY) / rect.height) * 100;

              let newX = origX;
              let newY = origY;
              let newW = origW;
              let newH = origH;

              if (handleDir.includes('e')) {
                newW = Math.max(10, Math.min(100 - origX, Math.round((origW + dx) / snapGridStep) * snapGridStep));
              }
              if (handleDir.includes('s')) {
                newH = Math.max(10, Math.min(100 - origY, Math.round((origH + dy) / snapGridStep) * snapGridStep));
              }
              if (handleDir.includes('w')) {
                const maxShift = origW - 10;
                const shift = Math.max(-origX, Math.min(maxShift, Math.round(dx / snapGridStep) * snapGridStep));
                newX = origX + shift;
                newW = origW - shift;
              }
              if (handleDir.includes('n')) {
                const maxShift = origH - 10;
                const shift = Math.max(-origY, Math.min(maxShift, Math.round(dy / snapGridStep) * snapGridStep));
                newY = origY + shift;
                newH = origH - shift;
              }

              // Adjacent boundary magnetic snapping: snap to nearby zone boundaries within 2%
              floorZones.forEach((other) => {
                if (other.id === zone.id) return;
                if (handleDir.includes('e') && Math.abs((newX + newW) - other.x) <= 2) {
                  newW = other.x - newX;
                }
                if (handleDir.includes('w') && Math.abs(newX - (other.x + other.w)) <= 2) {
                  const targetX = other.x + other.w;
                  newW = (newX + newW) - targetX;
                  newX = targetX;
                }
                if (handleDir.includes('s') && Math.abs((newY + newH) - other.y) <= 2) {
                  newH = other.y - newY;
                }
                if (handleDir.includes('n') && Math.abs(newY - (other.y + other.h)) <= 2) {
                  const targetY = other.y + other.h;
                  newH = (newY + newH) - targetY;
                  newY = targetY;
                }
              });

              zone.x = Math.max(0, Math.min(100, Math.round(newX * 10) / 10));
              zone.y = Math.max(0, Math.min(100, Math.round(newY * 10) / 10));
              zone.w = Math.max(8, Math.min(100, Math.round(newW * 10) / 10));
              zone.h = Math.max(8, Math.min(100, Math.round(newH * 10) / 10));

              if (zoneEl) {
                zoneEl.style.left = `${zone.x}%`;
                zoneEl.style.top = `${zone.y}%`;
                zoneEl.style.width = `${zone.w}%`;
                zoneEl.style.height = `${zone.h}%`;
              }
            };

            const onPointerUp = (ev) => {
              window.removeEventListener('pointermove', onPointerMove);
              window.removeEventListener('pointerup', onPointerUp);
              window.removeEventListener('pointercancel', onPointerUp);
              handleEl.classList.remove('is-resizing');
              if (zoneEl) zoneEl.classList.remove('is-resizing');
              try { handleEl.releasePointerCapture(ev.pointerId || e.pointerId); } catch (_) {}
              selectedZoneId = zone.id;
              debouncedSaveFloor();
              render();
            };

            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerUp);
          });
        });

        // Mouse drawing button and interactive rectangle creator
        const drawBtn = document.getElementById('map-draw-zone');
        if (drawBtn) {
          drawBtn.addEventListener('click', () => {
            isDrawingZone = !isDrawingZone;
            if (isDrawingZone) {
              isEditMode = true;
              studioMode = 'architecture';
            }
            render();
            showToast(isDrawingZone ? 'حالت ترسیم فعال شد؛ روی نقشه کلیک کنید و ماوس را بکشید.' : 'حالت ترسیم غیرفعال شد.', 'info');
          });
        }

        if (isDrawingZone) {
          let drawStart = null;
          let drawBox = null;

          const onCanvasPointerDown = (e) => {
            if (e.target.closest('.plan-table') || e.target.closest('.table-floating-palette') || e.target.closest('.plan-zone__actions') || e.target.closest('.plan-zone__border-delete') || e.target.closest('.zone-floating-palette') || e.target.closest('[data-zone-action]') || e.target.closest('.zone-handle') || e.target.closest('.floor-canvas-controls')) return;
            const scaleEl = document.getElementById('admin-canvas-scaler') || canvas;
            const rect = scaleEl.getBoundingClientRect();
            const startX = ((e.clientX - rect.left) / rect.width) * 100;
            const startY = ((e.clientY - rect.top) / rect.height) * 100;

            drawStart = { x: startX, y: startY, rect };

            drawBox = document.createElement('div');
            drawBox.className = 'zone-drawing-rect';
            drawBox.style.left = `${startX}%`;
            drawBox.style.top = `${startY}%`;
            drawBox.style.width = '0%';
            drawBox.style.height = '0%';
            scaleEl.appendChild(drawBox);

            const onCanvasPointerMove = (ev) => {
              if (!drawStart) return;
              const curX = ((ev.clientX - drawStart.rect.left) / drawStart.rect.width) * 100;
              const curY = ((ev.clientY - drawStart.rect.top) / drawStart.rect.height) * 100;

              const x = Math.max(0, Math.min(100, Math.min(drawStart.x, curX)));
              const y = Math.max(0, Math.min(100, Math.min(drawStart.y, curY)));
              const w = Math.min(100 - x, Math.abs(curX - drawStart.x));
              const h = Math.min(100 - y, Math.abs(curY - drawStart.y));

              drawBox.style.left = `${x.toFixed(1)}%`;
              drawBox.style.top = `${y.toFixed(1)}%`;
              drawBox.style.width = `${w.toFixed(1)}%`;
              drawBox.style.height = `${h.toFixed(1)}%`;
              drawBox.innerHTML = `<span>${Math.round(w)}% × ${Math.round(h)}%</span>`;
            };

            const onCanvasPointerUp = (ev) => {
              window.removeEventListener('pointermove', onCanvasPointerMove);
              window.removeEventListener('pointerup', onCanvasPointerUp);
              if (!drawStart || !drawBox) return;

              const curX = ((ev.clientX - drawStart.rect.left) / drawStart.rect.width) * 100;
              const curY = ((ev.clientY - drawStart.rect.top) / drawStart.rect.height) * 100;

              const x = Math.round(Math.max(0, Math.min(100, Math.min(drawStart.x, curX))));
              const y = Math.round(Math.max(0, Math.min(100, Math.min(drawStart.y, curY))));
              const w = Math.round(Math.min(100 - x, Math.abs(curX - drawStart.x)));
              const h = Math.round(Math.min(100 - y, Math.abs(curY - drawStart.y)));

              drawBox.remove();
              drawBox = null;
              drawStart = null;

              if (w >= 6 && h >= 6) {
                isDrawingZone = false;
                promptCreateZone(x, y, w, h);
              }
            };

            window.addEventListener('pointermove', onCanvasPointerMove);
            window.addEventListener('pointerup', onCanvasPointerUp);
          };

          canvas.addEventListener('pointerdown', onCanvasPointerDown);
        }

        main.querySelectorAll('[data-zone-pill]').forEach((pill) => {
          pill.addEventListener('click', (e) => {
            if (e.target.closest('[data-delete-zone-pill]')) {
              e.stopPropagation();
              const delName = e.target.closest('[data-delete-zone-pill]').dataset.deleteZonePill;
              deleteZone(delName);
              return;
            }
            activeZone = pill.dataset.zonePill;
            render();
          });
        });

        const curActiveZone = activeZone !== 'all'
          ? floorZones.find((z) => z.name === activeZone || normalizeZone(z.name) === normalizeZone(activeZone))
          : null;

        if (curActiveZone) {
          document.getElementById('map-active-zone-dims')?.addEventListener('click', () => {
            promptZoneDimensions(curActiveZone);
          });
          document.getElementById('map-active-zone-rename')?.addEventListener('click', () => {
            promptRenameZone(curActiveZone);
          });
          document.getElementById('map-active-zone-color')?.addEventListener('click', () => {
            cycleZoneColor(curActiveZone);
          });
          document.getElementById('map-active-zone-delete')?.addEventListener('click', () => {
            deleteZone(curActiveZone.id);
          });
        }

        document.getElementById('map-add-zone')?.addEventListener('click', () => {
          promptAddZone();
        });

        document.getElementById('map-mode-furniture')?.addEventListener('click', () => {
          studioMode = 'furniture';
          isEditMode = true;
          selectedZoneId = null;
          render();
          showToast('حالت چیدمان مبلمان و میزها فعال شد.', 'info');
        });

        document.getElementById('map-mode-architecture')?.addEventListener('click', () => {
          studioMode = 'architecture';
          isEditMode = true;
          selectedTableId = null;
          render();
          showToast('حالت معماری و تفکیک فضاها فعال شد.', 'info');
        });

        const floorToolbarEl = main.querySelector('.floor-toolbar');
        if (floorToolbarEl) {
          floorToolbarEl.addEventListener('wheel', (e) => {
            if (e.deltaY && !e.deltaX) {
              e.preventDefault();
              floorToolbarEl.scrollLeft += e.deltaY;
            }
          }, { passive: false });
        }

        document.getElementById('map-toggle-edit')?.addEventListener('click', () => {
          isEditMode = !isEditMode;
          render();
          showToast(isEditMode ? 'حالت ویرایش چیدمان فعال گردید.' : 'حالت ویرایش چیدمان ذخیره و بسته شد.', 'info');
        });

        document.getElementById('map-add-table')?.addEventListener('click', addTableToMap);
        document.getElementById('map-auto-align')?.addEventListener('click', autoAlignTables);
        document.getElementById('map-save-layout')?.addEventListener('click', () => saveFloorLayout(false));

        // Floor level switching and editing
        main.querySelectorAll('[data-floor-pill]').forEach((pill) => {
          pill.addEventListener('click', () => {
            activeFloorId = pill.dataset.floorPill;
            render();
          });
        });
        main.querySelectorAll('[data-edit-floor-pill]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const flId = btn.dataset.editFloorPill;
            const targetFloor = floorLevels.find((fl) => fl.id === flId);
            if (targetFloor) promptEditFloor(targetFloor);
          });
        });
        document.getElementById('map-add-floor')?.addEventListener('click', promptAddFloor);
        document.getElementById('map-floor-settings')?.addEventListener('click', promptFloorSettings);
        document.getElementById('map-templates-btn')?.addEventListener('click', showTemplateModal);
        document.getElementById('map-export-json')?.addEventListener('click', exportLayoutJson);
        document.getElementById('map-import-json')?.addEventListener('click', importLayoutJson);

        // History undo / redo bindings
        document.getElementById('map-history-undo')?.addEventListener('click', undoLayout);
        document.getElementById('map-history-redo')?.addEventListener('click', redoLayout);
        document.getElementById('map-undo')?.addEventListener('click', undoLayout);
        document.getElementById('map-redo')?.addEventListener('click', redoLayout);

        // Global hotkeys for studio (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z)
        if (!window.__floorKeydownBound) {
          window.__floorKeydownBound = true;
          window.addEventListener('keydown', (e) => {
            if (currentView !== 'map') return;
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
              e.preventDefault();
              undoLayout();
            } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
              e.preventDefault();
              redoLayout();
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedZoneId && !selectedTableId && !selectedFixtureId) {
              e.preventDefault();
              deleteZone(selectedZoneId);
            }
          });
        }

        // Add Architectural Fixture
        document.getElementById('map-add-fixture')?.addEventListener('click', promptAddFixture);

        // Fixtures selection, dragging, and palette actions
        canvas.querySelectorAll('.plan-fixture[data-fixture-id]').forEach((fixEl) => {
          const fId = fixEl.dataset.fixtureId;
          const fixture = floorFixtures.find((f) => f.id === fId);
          if (!fixture) return;

          fixEl.addEventListener('click', (e) => {
            if (e.target.closest('.fixture-floating-palette') || e.target.closest('.fixture-handle')) return;
            if (justDragged) return;
            selectedFixtureId = fixture.id;
            selectedTableId = null;
            render();
          });

          // Palette actions
          const fPalette = fixEl.querySelector('.fixture-floating-palette');
          if (fPalette) {
            fPalette.addEventListener('click', (e) => {
              const actBtn = e.target.closest('[data-fixture-action]');
              if (!actBtn) return;
              e.stopPropagation();
              const action = actBtn.dataset.fixtureAction;
              if (action === 'rotate') {
                fixture.rotation = ((Number(fixture.rotation) || 0) + 45) % 360;
                debouncedSaveFloor();
                render();
              } else if (action === 'delete') {
                deleteFixture(fixture.id);
              } else if (action === 'close') {
                selectedFixtureId = null;
                render();
              }
            });
          }

          // Fixture drag & drop
          if (isEditMode) {
            fixEl.addEventListener('pointerdown', (e) => {
              if (e.target.closest('.fixture-floating-palette') || e.target.closest('.fixture-handle')) return;
              e.preventDefault();
              const scaleEl = document.getElementById('admin-canvas-scaler') || canvas;
              const rect = scaleEl.getBoundingClientRect();
              const startX = e.clientX;
              const startY = e.clientY;
              const origX = Number(fixture.x) || 0;
              const origY = Number(fixture.y) || 0;
              let hasMoved = false;

              fixEl.classList.add('is-dragging');
              try { fixEl.setPointerCapture(e.pointerId); } catch (_) {}

              const onPointerMove = (ev) => {
                const dx = ((ev.clientX - startX) / rect.width) * 100;
                const dy = ((ev.clientY - startY) / rect.height) * 100;
                if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) hasMoved = true;
                let newX = Math.round((origX + dx) / snapGridStep) * snapGridStep;
                let newY = Math.round((origY + dy) / snapGridStep) * snapGridStep;
                newX = Math.max(0, Math.min(100 - (Number(fixture.w) || 10), newX));
                newY = Math.max(0, Math.min(100 - (Number(fixture.h) || 8), newY));
                fixture.x = Math.round(newX * 10) / 10;
                fixture.y = Math.round(newY * 10) / 10;
                fixEl.style.left = `${fixture.x}%`;
                fixEl.style.top = `${fixture.y}%`;
              };

              const onPointerUp = (ev) => {
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                window.removeEventListener('pointercancel', onPointerUp);
                fixEl.classList.remove('is-dragging');
                try { fixEl.releasePointerCapture(ev.pointerId || e.pointerId); } catch (_) {}
                if (hasMoved) {
                  justDragged = true;
                  setTimeout(() => { justDragged = false; }, 180);
                  debouncedSaveFloor();
                }
              };

              window.addEventListener('pointermove', onPointerMove);
              window.addEventListener('pointerup', onPointerUp);
              window.addEventListener('pointercancel', onPointerUp);
            });

            // Fixture resize handle
            const handleEl = fixEl.querySelector('.fixture-handle--se');
            if (handleEl) {
              handleEl.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const scaleEl = document.getElementById('admin-canvas-scaler') || canvas;
                const rect = scaleEl.getBoundingClientRect();
                const startX = e.clientX;
                const startY = e.clientY;
                const origW = Number(fixture.w) || 12;
                const origH = Number(fixture.h) || 8;

                handleEl.classList.add('is-resizing');
                try { handleEl.setPointerCapture(e.pointerId); } catch (_) {}

                const onPointerMove = (ev) => {
                  const dx = ((ev.clientX - startX) / rect.width) * 100;
                  const dy = ((ev.clientY - startY) / rect.height) * 100;
                  const newW = Math.max(4, Math.min(60, Math.round((origW + dx) / snapGridStep) * snapGridStep));
                  const newH = Math.max(3, Math.min(50, Math.round((origH + dy) / snapGridStep) * snapGridStep));
                  fixture.w = Math.round(newW * 10) / 10;
                  fixture.h = Math.round(newH * 10) / 10;
                  fixEl.style.width = `${fixture.w}%`;
                  fixEl.style.height = `${fixture.h}%`;
                };

                const onPointerUp = (ev) => {
                  window.removeEventListener('pointermove', onPointerMove);
                  window.removeEventListener('pointerup', onPointerUp);
                  window.removeEventListener('pointercancel', onPointerUp);
                  handleEl.classList.remove('is-resizing');
                  try { handleEl.releasePointerCapture(ev.pointerId || e.pointerId); } catch (_) {}
                  debouncedSaveFloor();
                  render();
                };

                window.addEventListener('pointermove', onPointerMove);
                window.addEventListener('pointerup', onPointerUp);
                window.addEventListener('pointercancel', onPointerUp);
              });
            }
          }
        });

        // Batch selection toolbar actions
        const batchToolbar = document.getElementById('admin-batch-toolbar');
        if (batchToolbar) {
          batchToolbar.querySelectorAll('[data-batch-act]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const act = btn.dataset.batchAct;
              if (act === 'clear') {
                selectedTableIds.clear();
                render();
              } else if (act === 'delete') {
                if (selectedTableIds.size === 0) return;
                showFloorModal({
                  title: `🗑️ حذف گروهی ${fmtNum(selectedTableIds.size)} میز انتخاب‌شده`,
                  confirmText: 'حذف تمامی میزهای انتخاب‌شده',
                  confirmClass: 'btn-danger',
                  bodyHtml: `<p style="font-size:13px;color:#f8fafc">آیا از حذف دائم ${fmtNum(selectedTableIds.size)} میز انتخاب‌شده از پلان سالن اطمینان دارید؟</p>`,
                  onConfirm: async () => {
                    const idsToDelete = Array.from(selectedTableIds);
                    selectedTableIds.clear();
                    tables = tables.filter((t) => !idsToDelete.includes(Number(t.id)));
                    selectedTableId = null;
                    await saveFloorLayout(true);
                    render();
                    showToast(`${fmtNum(idsToDelete.length)} میز با موفقیت حذف شدند.`, 'success');
                  }
                });
              } else if (act === 'merge') {
                if (selectedTableIds.size >= 2) {
                  const arr = Array.from(selectedTableIds);
                  const parentId = arr[0];
                  const subIds = arr.slice(1);
                  const parentTable = tableById(parentId);
                  if (parentTable) {
                    parentTable.mergedWith = subIds;
                    subIds.forEach((sid) => {
                      const st = tableById(sid);
                      if (st) st.mergedInto = parentId;
                    });
                    debouncedSaveFloor();
                    render();
                    showToast(`${fmtNum(arr.length)} میز با موفقیت ادغام شدند.`, 'success');
                  }
                }
              } else if (act.startsWith('align-')) {
                alignSelectedTables(act.replace('align-', ''));
              } else if (act.startsWith('distribute-')) {
                distributeSelectedTables(act.replace('distribute-', ''));
              }
            });
          });
        }

        // Marquee selection box on canvas background
        if (isEditMode && !isDrawingZone) {
          let marqueeStart = null;
          let marqueeBox = null;

          const onMarqueePointerDown = (e) => {
            if (e.target.closest('.plan-table') || e.target.closest('.plan-fixture') || e.target.closest('.table-floating-palette') || e.target.closest('.fixture-floating-palette') || e.target.closest('.plan-zone__actions') || e.target.closest('.plan-zone__border-delete') || e.target.closest('.zone-floating-palette') || e.target.closest('[data-zone-action]') || e.target.closest('.zone-handle') || e.target.closest('.floor-canvas-controls') || e.target.closest('.floor-batch-toolbar') || e.target.closest('.floor-table-inspector')) return;
            const scaleEl = document.getElementById('admin-canvas-scaler') || canvas;
            const rect = scaleEl.getBoundingClientRect();
            const startX = ((e.clientX - rect.left) / rect.width) * 100;
            const startY = ((e.clientY - rect.top) / rect.height) * 100;

            marqueeStart = { x: startX, y: startY, rect };
            marqueeBox = document.createElement('div');
            marqueeBox.className = 'floor-marquee-box';
            marqueeBox.style.left = `${startX}%`;
            marqueeBox.style.top = `${startY}%`;
            marqueeBox.style.width = '0%';
            marqueeBox.style.height = '0%';
            scaleEl.appendChild(marqueeBox);

            const onMarqueeMove = (ev) => {
              if (!marqueeStart || !marqueeBox) return;
              const curX = ((ev.clientX - marqueeStart.rect.left) / marqueeStart.rect.width) * 100;
              const curY = ((ev.clientY - marqueeStart.rect.top) / marqueeStart.rect.height) * 100;
              const x = Math.max(0, Math.min(100, Math.min(marqueeStart.x, curX)));
              const y = Math.max(0, Math.min(100, Math.min(marqueeStart.y, curY)));
              const w = Math.min(100 - x, Math.abs(curX - marqueeStart.x));
              const h = Math.min(100 - y, Math.abs(curY - marqueeStart.y));
              marqueeBox.style.left = `${x}%`;
              marqueeBox.style.top = `${y}%`;
              marqueeBox.style.width = `${w}%`;
              marqueeBox.style.height = `${h}%`;
            };

            const onMarqueeUp = (ev) => {
              window.removeEventListener('pointermove', onMarqueeMove);
              window.removeEventListener('pointerup', onMarqueeUp);
              if (!marqueeStart || !marqueeBox) return;

              const curX = ((ev.clientX - marqueeStart.rect.left) / marqueeStart.rect.width) * 100;
              const curY = ((ev.clientY - marqueeStart.rect.top) / marqueeStart.rect.height) * 100;
              const minX = Math.min(marqueeStart.x, curX);
              const maxX = Math.max(marqueeStart.x, curX);
              const minY = Math.min(marqueeStart.y, curY);
              const maxY = Math.max(marqueeStart.y, curY);

              marqueeBox.remove();
              marqueeBox = null;
              marqueeStart = null;

              if (Math.abs(maxX - minX) > 2 && Math.abs(maxY - minY) > 2) {
                if (!ev.shiftKey) selectedTableIds.clear();
                const floorTables = tables.filter((t) => !activeFloorId || t.floorId === activeFloorId);
                floorTables.forEach((t) => {
                  const tx = Number(t.x) || 50;
                  const ty = Number(t.y) || 50;
                  if (tx >= minX && tx <= maxX && ty >= minY && ty <= maxY) {
                    selectedTableIds.add(Number(t.id));
                  }
                });
                render();
              }
            };

            window.addEventListener('pointermove', onMarqueeMove);
            window.addEventListener('pointerup', onMarqueeUp);
          };

          canvas.addEventListener('pointerdown', onMarqueePointerDown);
        }
      };

      const bindCardsEvents = () => {
        document.getElementById('view-mode-map')?.addEventListener('click', () => setViewMode('map'));
        document.getElementById('view-mode-cards')?.addEventListener('click', () => setViewMode('cards'));
        document.getElementById('neem-tables-open')?.addEventListener('click', () => setViewMode('map'));

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
              img.alt = `رمزینه ${tableTitle(table)}`;
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
            if (eclMetric) eclMetric.textContent = qrEclLabel();
            const eclHint = document.getElementById('qr-ecl-hint');
            if (eclHint) eclHint.textContent = qrEclHint();
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
            showToast('تنظیمات رمزینه به حالت پیشنهادی بازگشت.', 'success');
          });
        };

        const saveTables = async () => {
          try {
            const next = [...main.querySelectorAll('[data-qr-card]')].map((card) => {
              const id = Number(card.dataset.qrCard);
              const existing = tableById(id) || {};
              return {
                id,
                label: card.querySelector('.t-label')?.value || '',
                seats: parseInputNumber(card.querySelector('.t-seats')?.value) || 4,
                zone: card.querySelector('.t-zone')?.value || '',
                active: card.querySelector('.t-active')?.checked !== false,
                branchId: currentBranchId,
                x: existing.x,
                y: existing.y,
                shape: existing.shape,
                rotation: existing.rotation,
              };
            });
            await api('/api/admin/tables', { method: 'PUT', body: JSON.stringify({ tables: next, branchId: currentBranchId }) });
          } catch (e) {
            showToast(e.message || 'خطا در ذخیره میزها', 'error');
          }
        };

        const tablesAutosave = autosave(saveTables, { debounceMs: 400, silent: true });
        main.querySelectorAll('.t-label, .t-seats, .t-zone, .t-active').forEach((input) => {
          input.addEventListener('input', () => {
            const table = tableById(input.closest('[data-qr-card]')?.dataset.qrCard);
            if (!table) return;
            if (input.classList.contains('t-label')) table.label = input.value;
            if (input.classList.contains('t-seats')) table.seats = parseInputNumber(input.value) || 4;
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

        document.getElementById('t-add')?.addEventListener('click', async (event) => {
          await runBusy(event.currentTarget, async () => {
            await addTableToMap();
          }, 'در حال ساخت…');
        });

        main.querySelectorAll('[data-tdel]').forEach((button) => button.addEventListener('click', async () => {
          await deleteTableFromMap(button.dataset.tdel);
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

      document.getElementById('nb-add')?.addEventListener('click', async () => {
        const name = document.getElementById('nb_name')?.value.trim() || '';
        if (!name) return showToast('نام شعبه لازم است', 'warn');
        try {
          await api('/api/admin/branches', {
            method: 'POST',
            body: JSON.stringify({
              name,
              slug: document.getElementById('nb_slug')?.value.trim() || undefined,
              address: document.getElementById('nb_address')?.value.trim() || '',
              phone: document.getElementById('nb_phone')?.value.trim() || '',
            }),
          });
          showToast('شعبه با موفقیت ایجاد شد', 'success');
          await loadBranches();
          tabs.branches();
        } catch (e) {
          showToast(e.message || 'خطا در ایجاد شعبه', 'error');
        }
      });
      list.forEach((b) => {
        const saveBranch = async () => {
          try {
            await api(`/api/admin/branches/${b.id}`, {
              method: 'PUT',
              body: JSON.stringify({
                name: document.getElementById(`b${b.id}_name`)?.value || '',
                slug: document.getElementById(`b${b.id}_slug`)?.value || '',
                address: document.getElementById(`b${b.id}_address`)?.value || '',
                phone: document.getElementById(`b${b.id}_phone`)?.value || '',
                active: document.getElementById(`b${b.id}_active`)?.checked !== false,
              }),
            });
            await loadBranches();
          } catch (e) {
            showToast(e.message || 'خطا در ذخیره تغییرات شعبه', 'error');
          }
        };
        bindAutosave(main.querySelector(`[data-bid="${b.id}"]`), saveBranch);
      });
      main.querySelectorAll('[data-bswitch]').forEach((btn) =>
        btn.addEventListener('click', () => {
          currentBranchId = Number(btn.dataset.bswitch);
          localStorage.setItem('westo_admin_branch', String(currentBranchId));
          paintBranchSelect();
          showToast('شعبه فعال شد', 'info');
        })
      );
      main.querySelectorAll('[data-bdel]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!confirm('حذف شعبه؟ میزها به شعبه دیگر منتقل می‌شوند.')) return;
          try {
            await api(`/api/admin/branches/${btn.dataset.bdel}`, { method: 'DELETE' });
            showToast('شعبه با موفقیت حذف شد', 'success');
            await loadBranches();
            tabs.branches();
          } catch (e) {
            showToast(e.message || 'خطا در حذف شعبه', 'error');
          }
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

      main.innerHTML = `<div class="ops-page-head"><div><p class="eyebrow">مهندسی منو · صندوق فروش</p><h1>مکمل‌ها و فروش هوشمند</h1><p class="lead">مکمل‌ها در منوی عمومی دیده نمی‌شوند. بعد از لمس محصول پایه، صندوق آن‌ها را در یک لایه سریع پیشنهاد می‌دهد و انتخاب زیر همان محصول فاکتور ثبت می‌شود.</p></div><button class="btn btn-sm" id="me-preview-pos">پیش‌نمایش صندوق</button></div><div class="cards cards-dense"><div class="card accent"><div class="num">${fmtNum(complements.filter((entry) => entry.available !== false).length)}</div><div class="lbl">مکمل فعال</div></div><div class="card"><div class="num">${fmtNum(rules.filter((entry) => entry.active !== false).length)}</div><div class="lbl">قانون فعال</div></div><div class="card"><div class="num">${fmtNum(rules.reduce((sum, rule) => sum + (rule.sourceCategoryIds || []).length, 0))}</div><div class="lbl">اتصال دسته‌ای</div></div><div class="card"><div class="num">${fmtNum(rules.reduce((sum, rule) => sum + (rule.sourceItemIds || []).length, 0))}</div><div class="lbl">اتصال محصولی</div></div></div><div class="me-layout"><section class="section-box me-library"><div class="me-section-head"><div><h2>کتابخانه مکمل‌ها</h2><p>اقلام فروش‌محور مثل کوکی یا نوشابه که لازم نیست در منوی مهمان باشند.</p></div><button class="btn btn-sm" id="me-new-toggle">+ مکمل جدید</button></div><form class="me-new-form" id="me-new-complement" hidden><label><span>نام</span><input id="me-new-name" required></label><label><span>قیمت</span><input id="me-new-price" type="number" min="0" required></label><label><span>تصویر</span><input id="me-new-file" type="file" accept="image/*"></label><button class="btn" type="submit">ساخت مکمل</button></form><div class="me-complement-list">${complements.map(complementCard).join('') || '<div class="empty">هنوز مکملی ساخته نشده است.</div>'}</div></section><section class="section-box me-rules"><div class="me-section-head"><div><h2>قوانین پیشنهاد</h2><p>برای هر قانون دسته‌ها یا محصولات پایه و مکمل‌های مرتبط را انتخاب کنید.</p></div><button class="btn btn-sm" id="me-new-rule-toggle">+ قانون جدید</button></div><form class="me-rule-card is-new" id="me-new-rule" hidden><header><div><span>قانون جدید</span><input id="me-new-rule-name" placeholder="مثلاً کنار قهوه"></div><label class="me-switch"><input id="me-new-rule-active" type="checkbox" checked><span>فعال</span></label></header><label class="me-prompt"><span>متن پیشنهاد صندوق</span><input id="me-new-rule-prompt" placeholder="کنار نوشیدنی چه چیزی میل دارید؟"></label>${scopeBlock('new', {})}<footer><button class="btn" type="submit">ساخت قانون</button></footer></form><div class="me-rule-list">${rules.map(ruleCard).join('') || '<div class="empty">قانون پیشنهادی وجود ندارد.</div>'}</div></section></div>`;

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
          await api('/api/admin/menu-complements', { method: 'POST', body: JSON.stringify({ name: document.getElementById('me-new-name').value, price: parseInputNumber(document.getElementById('me-new-price').value), img, available: true }) });
          showToast('مکمل ساخته شد'); tabs.complements();
        } catch (error) { showToast(error.message); }
      };
      main.querySelectorAll('[data-me-save-complement]').forEach((button) => button.onclick = async () => {
        const card = button.closest('[data-me-complement-card]');
        try {
          await runBusy(button, async () => {
            const img = await uploadFrom(card.querySelector('[data-me-file]'), card.querySelector('[data-me-image]').value.trim());
            await api(`/api/admin/menu-complements/${button.dataset.meSaveComplement}`, {
              method: 'PUT',
              body: JSON.stringify({
                name: card.querySelector('[data-me-name]')?.value,
                price: parseInputNumber(card.querySelector('[data-me-price]')?.value),
                stock: parseInputNumber(card.querySelector('[data-me-stock]')?.value),
                img,
                available: card.querySelector('[data-me-available]')?.checked,
              }),
            });
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
          <div><p class="eyebrow">کنترل هزینه · نمای سریع عملیاتی</p><h1>کنترل هزینه و سودآوری</h1><p class="lead">فروش، بهای تمام‌شده و وضعیت انبار فقط از داده‌های ثبت‌شده وستو محاسبه می‌شوند؛ رقم نمایشی یا جایگزین وارد این صفحه نمی‌شود.</p></div>
          <div class="row-actions"><a class="btn btn-sm btn-ghost" href="${financeWorkspaceHref('costing')}">تحلیل رسمی در حسابداری</a><button class="btn btn-sm" id="cc-open-inventory">مدیریت موجودی فروش</button></div>
        </div>
        <div class="cards">
          <div class="card accent"><div class="num">${fmtMoney(cost.sales || 0)}</div><div class="lbl">فروش دوره</div></div>
          <div class="card warn"><div class="num">${fmtMoney(cost.estimatedCogs || 0)}</div><div class="lbl">بهای تمام‌شده ثبت‌شده</div></div>
          <div class="card"><div class="num">${fmtMoney(cost.estimatedProfit || 0)}</div><div class="lbl">سود ناخالص</div></div>
          <div class="card"><div class="num">${fmtNum(cost.grossMarginPct || 0)}٪</div><div class="lbl">حاشیه سود</div></div>
          <div class="card ${inventory.low ? 'warn' : ''}"><div class="num">${fmtNum(inventory.low || 0)}</div><div class="lbl">موجودی کم یا تمام‌شده</div></div>
        </div>
        <div class="grid-2-main">
          <section class="section-box">
            <h2>اقلام نیازمند اقدام</h2>
            <table class="tbl"><thead><tr><th>محصول</th><th>موجودی</th><th>وضعیت</th></tr></thead><tbody>
              ${(inventory.items || []).filter((item) => item.low || item.empty).slice(0, 30).map((item) => `<tr><td>${esc(item.name)}</td><td>${item.tracked ? fmtNum(item.stock) : 'نامحدود'}</td><td>${item.empty ? '<span class="pill blocked">تمام</span>' : '<span class="pill admin-pill-warn">کم</span>'}</td></tr>`).join('') || '<tr><td colspan="3">کمبود موجودی ثبت نشده است.</td></tr>'}
            </tbody></table>
          </section>
          <section class="section-box">
            <h2>دقت محاسبه هزینه</h2>
            <p class="hint">هزینه فقط برای محصولاتی محاسبه می‌شود که دستور تهیه یا هزینه واحد آن‌ها ثبت شده باشد. تا قبل از ثبت مواد اولیه، رقم ساختگی جایگزین نمی‌شود.</p>
            <div class="ops-alert ${cost.estimatedCogs ? '' : 'is-warn'}"><b>${cost.estimatedCogs ? 'محاسبه فعال است' : 'دستور تهیه نیاز است'}</b><span>${cost.estimatedCogs ? 'بهای تمام‌شده بر پایه هزینه‌های ثبت‌شده محاسبه شده است.' : 'برای محاسبه دقیق، مواد اولیه و هزینه واحد محصولات را ثبت کنید.'}</span></div>
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
          <div><p class="eyebrow">موجودی قابل فروش منو</p><h1>موجودی فروش</h1><p class="lead">این صفحه دسترس‌پذیری اقلام منو را کنترل می‌کند. دریافت کالا، ضایعات، شمارش و دستور تهیه در پنل انبار ثبت می‌شوند و اثر مالی آن‌ها در حسابداری دیده می‌شود.</p></div>
          <div class="row-actions"><a class="btn btn-sm btn-ghost" href="/admin/kitchen?view=inventory&branchId=${encodeURIComponent(currentBranchId || 1)}">عملیات واقعی انبار</a><a class="btn btn-sm btn-ghost" href="${financeWorkspaceHref('costing')}">اثر مالی و بهای تمام‌شده</a><span class="ops-provider-pill">${fmtNum(d.summary?.low || 0)} هشدار کمبود</span></div>
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
        if (count) count.textContent = `${fmtNum(list.length)} محصول`;
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
        }).join('') || '<tr><td colspan="6">محصولی با این فیلتر پیدا نشد.</td></tr>';

        body.querySelectorAll('tr[data-iid]').forEach((tr) => {
          const id = Number(tr.dataset.iid);
          const saveInv = async () => {
            const raw = tr.querySelector('.inv-stock')?.value;
            const parsedStock = parseInputNumber(raw);
            const parsedLow = parseInputNumber(tr.querySelector('.inv-low')?.value);
            try {
              await api('/api/admin/inventory/adjust', {
                method: 'POST',
                body: JSON.stringify({
                  id,
                  mode: 'set',
                  stock: raw === '' ? null : (parsedStock ?? 0),
                  lowStockAt: parsedLow ?? 0,
                  restock: raw !== '' && (parsedStock ?? 0) > 0,
                }),
              });
              showToast('موجودی ذخیره شد', 'success', 1400);
            } catch (e) {
              showToast(e.message || 'خطا در ذخیره موجودی', 'error');
            }
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

    async expenses() {
      setActiveTab('expenses');
      if (typeof window.renderAccountingWorkspace === 'function') {
        await window.renderAccountingWorkspace(main, branchQs(), {
          workspace: 'purchases',
          hasCapability,
          currentUser: () => currentUser,
          branchCount: () => branchesCache.length,
        });
      }
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
          <h2>ویرایش تکی (${fmtNum(items.length)} محصول)</h2>
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
          .join('') || '<tr><td colspan="4">محصولی یافت نشد</td></tr>';
        tbody.querySelectorAll('[data-price]').forEach((inp) => {
          const savePrice = async () => {
            try {
              await api(`/api/menu/${inp.dataset.price}`, {
                method: 'PUT',
                body: JSON.stringify({ price: parseInputNumber(inp.value) || 0 }),
              });
            } catch (e) {
              showToast(e.message || 'خطا در ذخیره قیمت', 'error');
            }
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
      document.getElementById('bp-run')?.addEventListener('click', async () => {
        if (!confirm('قیمت‌ها به‌صورت انبوه تغییر کنند؟')) return;
        const cat = document.getElementById('bp-cat')?.value;
        try {
          const d2 = await api('/api/admin/prices/bulk', {
            method: 'POST',
            body: JSON.stringify({
              mode: document.getElementById('bp-mode')?.value,
              value: parseInputNumber(document.getElementById('bp-val')?.value) || 0,
              categoryId: cat === '' ? null : Number(cat),
            }),
          });
          showToast(`${d2.updated} محصول به‌روز شد`, 'success');
          tabs.prices();
        } catch (e) {
          showToast(e.message || 'خطا در اعمال تغییر انبوه قیمت', 'error');
        }
      });
    },

    async promotions() {
      setActiveTab('promotions');
      const d = await api('/api/admin/promotions');
      main.innerHTML = `
        <h1>تخفیف‌ها و پیشنهادهای فروش</h1>
        <p class="lead">کد تخفیف و پیشنهاد درصدی برای اعضای باشگاه مشتریان و فروش دوره‌ای.</p>
        <div class="section-box">
          <h2>پیشنهاد جدید</h2>
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
              .join('') || '<tr><td colspan="5">هنوز پیشنهادی ثبت نشده است</td></tr>'}
          </tbody></table>
        </div>`;
      document.getElementById('pr-add')?.addEventListener('click', async () => {
        const title = document.getElementById('pr_title')?.value.trim() || '';
        if (!title) return showToast('عنوان را وارد کنید', 'warn');
        try {
          await api('/api/admin/promotions', {
            method: 'POST',
            body: JSON.stringify({
              title,
              percent: parseInputNumber(document.getElementById('pr_pct')?.value) || 0,
              code: document.getElementById('pr_code')?.value || '',
            }),
          });
          showToast('پیشنهاد فروش ایجاد شد', 'success');
          tabs.promotions();
        } catch (e) {
          showToast(e.message || 'خطا در ایجاد پیشنهاد فروش', 'error');
        }
      });
      main.querySelectorAll('[data-ptoggle]').forEach((b) =>
        b.addEventListener('click', async () => {
          try {
            await api(`/api/admin/promotions/${b.dataset.ptoggle}`, {
              method: 'PATCH',
              body: JSON.stringify({ active: b.dataset.val === 'true' }),
            });
            tabs.promotions();
          } catch (e) {
            showToast(e.message || 'خطا در تغییر وضعیت پیشنهاد', 'error');
          }
        })
      );
      main.querySelectorAll('[data-pdel]').forEach((b) =>
        b.addEventListener('click', async () => {
          if (!confirm('حذف شود؟')) return;
          try {
            await api(`/api/admin/promotions/${b.dataset.pdel}`, { method: 'DELETE' });
            tabs.promotions();
          } catch (e) {
            showToast(e.message || 'خطا در حذف پیشنهاد', 'error');
          }
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
        ['none', 'بدون اقدام'], ['url', 'لینک خارجی'], ['instagram', 'اینستاگرام'],
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
            <span class="hint">نمایش ${Number(slide.impressions)||0} · کلیک ${Number(slide.clicks)||0} · نرخ کلیک ${ctr}٪</span>
          </div>
          <div class="promo-placement-note"><b>جایگاه نمایش:</b><span>صفحه ورود — داخل بخش تجربه</span><span>·</span><span>در چیدمان کارت‌های ورودی و پیش از دسترسی‌های سریع نمایش داده می‌شود.</span></div>
          <div class="grid-2">
            ${field('عنوان', `ps_title_${slide.id}`, slide.title || '')}
            ${field('زیرعنوان', `ps_subtitle_${slide.id}`, slide.subtitle || '')}
            ${field('برچسب کوتاه', `ps_badge_${slide.id}`, slide.badge || '')}
            ${field('متن دکمه', `ps_cta_${slide.id}`, slide.ctaLabel || '')}
            <div class="field"><label>نوع اسلاید</label><select id="ps_kind_${slide.id}">${kindOptions.map(([v,l]) => option(v,l,slide.kind)).join('')}</select></div>
            <div class="field"><label>جایگاه نمایش</label><select id="ps_placement_${slide.id}">${placementOptions.map(([v,l]) => option(v,l,'entrance')).join('')}</select></div>
            <div class="field"><label>نوع اقدام</label><select id="ps_action_${slide.id}">${actionOptions.map(([v,l]) => option(v,l,slide.actionType)).join('')}</select></div>
            ${field('نشانی یا شناسه اقدام', `ps_value_${slide.id}`, slide.actionValue || '', { ltr: true })}
            ${field('تصویر', `ps_image_${slide.id}`, slide.image || '', { ltr: true })}
            <div class="field"><label>بارگذاری تصویر</label><input type="file" id="ps_file_${slide.id}" accept=".png,.jpg,.jpeg,.webp" /></div>
            <div class="field"><label>شعبه</label><select id="ps_branch_${slide.id}"><option value="">همه شعب</option>${branches.map((b)=>option(b.id,b.name,slide.branchId)).join('')}</select></div>
            ${field('شروع نمایش', `ps_start_${slide.id}`, dtLocal(slide.startAt), { type: 'datetime-local', ltr: true })}
            ${field('پایان نمایش', `ps_end_${slide.id}`, dtLocal(slide.endAt), { type: 'datetime-local', ltr: true })}
            ${field('پخش خودکار (میلی‌ثانیه؛ صفر یعنی خاموش)', `ps_auto_${slide.id}`, Number(slide.autoplayMs)||0, { type: 'number', ltr: true })}
            <div class="field"><label>وضعیت انتشار</label><select id="ps_status_${slide.id}">${option('published','منتشرشده',slide.status)}${option('draft','پیش‌نویس',slide.status)}</select></div>
          </div>
          ${slide.image ? `<div class="logo-preview" style="margin:.65rem 0"><img src="${esc(adminImgSrc(slide.image))}" alt="" style="max-height:150px;object-fit:cover;border-radius:14px" /></div>` : ''}
          <div class="row-actions" style="margin-top:.55rem;gap:1rem;flex-wrap:wrap"><label class="check-row"><input type="checkbox" id="ps_enabled_${slide.id}" ${slide.enabled !== false ? 'checked' : ''} /> فعال</label><label class="check-row"><input type="checkbox" id="ps_share_${slide.id}" ${slide.shareEnabled !== false ? 'checked' : ''} /> دکمه اشتراک‌گذاری</label></div>
          <div class="row-actions" style="margin-top:.75rem">
            <button class="btn btn-sm" data-promo-save="${slide.id}">ذخیره تغییرات</button>
            <button class="btn btn-sm ${live ? 'btn-ghost' : ''}" data-promo-visibility="${slide.id}" data-live="${live ? 'true' : 'false'}">${live ? 'برداشتن از سایت' : 'انتشار روی سایت'}</button>
            <button class="btn btn-sm btn-ghost" data-promo-upload="${slide.id}">بارگذاری تصویر</button>
            <button class="btn btn-sm btn-ghost" data-promo-copy="${slide.id}">کپی</button>
            <button class="btn btn-sm btn-danger" data-promo-delete="${slide.id}">حذف</button>
            <span class="hint">برای تغییر ترتیب کارت را بکشید.</span>
          </div>
        </article>`;
      };

      main.innerHTML = `
        <div class="ops-page-head"><div><p class="eyebrow">محتوای تبلیغاتی وستو</p><h1>اسلایدر تبلیغاتی</h1><p class="lead">کارت‌های تبلیغاتی صفحه ورود؛ تصویر، اقدام، اشتراک‌گذاری، زمان‌بندی، شعبه و ترتیب را از همین‌جا مدیریت کنید.</p></div></div>
        <div class="cards cards-dense"><div class="card accent"><div class="num">${fmtNum(slides.filter((slide) => slide.enabled !== false && slide.status !== 'draft').length)}</div><div class="lbl">در حال نمایش</div></div><div class="card"><div class="num">${fmtNum(slides.filter((slide) => slide.status === 'draft').length)}</div><div class="lbl">پیش‌نویس</div></div><div class="card"><div class="num">${fmtNum(slides.length)}</div><div class="lbl">کل اسلایدها</div></div></div>
        <div class="section-box">
          <div class="row-actions"><button class="btn" id="promo-slide-add">+ اسلاید جدید</button><a class="btn btn-ghost" href="/" target="_blank" rel="noopener">پیش‌نمایش صفحه ورود</a></div>
          <p class="hint">برای نمایش روی سایت، اسلاید باید هم «منتشرشده» و هم «فعال» باشد. تصویر یا عنوان را وارد کنید؛ اقدام «دسته» و «غذا» از شناسه منوی فعلی استفاده می‌کند.</p>
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
        autoplayMs: Math.max(0, parseInputNumber(document.getElementById(`ps_auto_${id}`)?.value) || 0),
        status: document.getElementById(`ps_status_${id}`)?.value || 'published',
        enabled: Boolean(document.getElementById(`ps_enabled_${id}`)?.checked),
      });

      const validateSlide = (payload, { forPublish = false } = {}) => {
        if (payload.startAt && payload.endAt && new Date(payload.startAt).getTime() >= new Date(payload.endAt).getTime()) return 'زمان پایان باید بعد از زمان شروع باشد.';
        if ((forPublish || (payload.enabled && payload.status === 'published')) && !payload.title && !payload.image) return 'برای انتشار، حداقل عنوان یا تصویر وارد کنید.';
        if ((forPublish || (payload.enabled && payload.status === 'published')) && payload.placement === 'entrance' && !payload.image) return 'اسلاید صفحه ورود باید تصویر داشته باشد.';
        if (['url','instagram'].includes(payload.actionType) && payload.actionValue && !/^https?:\/\//i.test(payload.actionValue)) return 'برای لینک خارجی/اینستاگرام، آدرس کامل با http یا https وارد کنید.';
        if (['category','dish'].includes(payload.actionType) && payload.actionValue && !/^\d+$/.test(payload.actionValue)) return 'برای اقدام دسته یا غذا، شناسه عددی معتبر وارد کنید.';
        return '';
      };

      document.getElementById('promo-slide-add')?.addEventListener('click', async () => {
        try {
          await api('/api/admin/promo-slides', { method: 'POST', body: JSON.stringify({ title: 'اسلاید جدید', placement: 'entrance', shareEnabled: true, status: 'draft', enabled: false }) });
          tabs.promoSlides();
        } catch (e) {
          showToast(e.message || 'خطا در ایجاد اسلاید جدید', 'error');
        }
      });
      main.querySelectorAll('[data-promo-save]').forEach((btn) => btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.promoSave);
        const payload = readSlide(id); const invalid = validateSlide(payload);
        if (invalid) return showToast(invalid, 'error', 3600);
        try {
          await api(`/api/admin/promo-slides/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
          showToast('اسلاید ذخیره شد', 'success');
          tabs.promoSlides();
        } catch (e) {
          showToast(e.message || 'خطا در ذخیره اسلاید', 'error');
        }
      }));
      main.querySelectorAll('[data-promo-visibility]').forEach((btn) => btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.promoVisibility); const currentlyLive = btn.dataset.live === 'true';
        const payload = readSlide(id);
        if (!currentlyLive) {
          payload.status = 'published'; payload.enabled = true;
          const invalid = validateSlide(payload, { forPublish: true });
          if (invalid) return showToast(invalid, 'error', 3600);
        } else { payload.enabled = false; }
        try {
          await api(`/api/admin/promo-slides/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
          showToast(currentlyLive ? 'اسلاید از سایت برداشته شد' : 'اسلاید منتشر شد', 'success');
          tabs.promoSlides();
        } catch (e) {
          showToast(e.message || 'خطا در تغییر وضعیت انتشار اسلاید', 'error');
        }
      }));
      main.querySelectorAll('[data-promo-upload]').forEach((btn) => btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.promoUpload);
        const file = document.getElementById(`ps_file_${id}`)?.files?.[0];
        if (!file) return showToast('اول یک تصویر انتخاب کنید', 'warn');
        try {
          const fd = new FormData(); fd.append('file', file);
          const up = await api('/api/admin/upload', { method: 'POST', body: fd });
          document.getElementById(`ps_image_${id}`).value = up.path || '';
          await api(`/api/admin/promo-slides/${id}`, { method: 'PATCH', body: JSON.stringify(readSlide(id)) });
          showToast('تصویر بارگذاری و ذخیره شد', 'success');
          tabs.promoSlides();
        } catch (e) {
          showToast(e.message || 'خطا در بارگذاری تصویر اسلاید', 'error');
        }
      }));
      main.querySelectorAll('[data-promo-delete]').forEach((btn) => btn.addEventListener('click', async () => {
        if (!confirm('این اسلاید حذف شود؟')) return;
        try {
          await api(`/api/admin/promo-slides/${btn.dataset.promoDelete}`, { method: 'DELETE' });
          showToast('اسلاید حذف شد', 'success');
          tabs.promoSlides();
        } catch (e) {
          showToast(e.message || 'خطا در حذف اسلاید', 'error');
        }
      }));
      main.querySelectorAll('[data-promo-copy]').forEach((btn) => btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.promoCopy); const payload = readSlide(id);
        payload.title = `${payload.title || 'اسلاید'} — کپی`; payload.status = 'draft'; payload.enabled = false;
        try {
          await api('/api/admin/promo-slides', { method: 'POST', body: JSON.stringify(payload) });
          showToast('کپی اسلاید ایجاد شد', 'success');
          tabs.promoSlides();
        } catch (e) {
          showToast(e.message || 'خطا در ایجاد کپی اسلاید', 'error');
        }
      }));

      const list = document.getElementById('promo-slides-list');
      let dragging = null;
      list?.querySelectorAll('[data-promo-card]').forEach((card) => {
        card.addEventListener('dragstart', () => { dragging = card; card.style.opacity = '.55'; });
        card.addEventListener('dragend', async () => {
          card.style.opacity = ''; dragging = null;
          const ids = [...list.querySelectorAll('[data-promo-card]')].map((el) => Number(el.dataset.promoCard));
          if (ids.length) {
            try {
              await api('/api/admin/promo-slides/reorder', { method: 'POST', body: JSON.stringify({ ids }) });
              showToast('ترتیب ذخیره شد', 'success');
            } catch (e) {
              showToast(e.message || 'خطا در ذخیره ترتیب اسلایدها', 'error');
            }
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
        { title: 'نوار بالای سایت و منو', keys: ['nav.login', 'nav.menu', 'nav.contact', 'nav.sound_on', 'nav.sound_off', 'nav.link.gamme', 'nav.link.benefits', 'nav.link.faq', 'nav.link.newsletter', 'nav.copyright'] },
        { title: 'صفحه ورود — متن‌ها', keys: ['entrance.tagline', 'entrance.subtitle', 'entrance.storyLead', 'entrance.quote', 'entrance.cta', 'entrance.step.digitalMenu', 'entrance.step.onlineOrder', 'entrance.step.reserveTable', 'entrance.step.quickEntry'] },
        { title: 'بخش آغازین', keys: ['hero.scroll_hint'] },
        { title: 'بخش مواد — شکر', keys: ['ingredients.sugar.badge', 'ingredients.sugar.title1', 'ingredients.sugar.title2', 'ingredients.sugar.desc'] },
        { title: 'بخش مواد — طعم‌دهنده', keys: ['ingredients.aroma.badge', 'ingredients.aroma.title1', 'ingredients.aroma.title2', 'ingredients.aroma.desc'] },
        { title: 'بخش مواد — کافئین', keys: ['ingredients.caffeine.badge', 'ingredients.caffeine.title', 'ingredients.caffeine.desc'] },
        { title: 'بخش مواد — استویا', keys: ['ingredients.stevia.badge', 'ingredients.stevia.title', 'ingredients.stevia.desc'] },
        { title: 'سؤالات متداول (عنوان)', keys: ['faq.title1', 'faq.title2'] },
        { title: 'خبرنامه', keys: ['newsletter.title', 'newsletter.desc', 'newsletter.email_label', 'newsletter.submit', 'newsletter.consent', 'newsletter.privacy_link', 'newsletter.success', 'newsletter.error'] },
        { title: 'پایین صفحه', keys: ['footer.copyright', 'footer.legal', 'footer.cgu', 'footer.privacy', 'footer.tiktok', 'footer.instagram'] },
      ];
      const labels = {
        'nav.login': 'دکمه ورود', 'nav.menu': 'دکمه منو', 'nav.contact': 'دکمه تماس', 'nav.sound_on': 'صدا: روشن', 'nav.sound_off': 'صدا: خاموش',
        'nav.link.gamme': 'لینک محصولات', 'nav.link.benefits': 'لینک مزایا', 'nav.link.faq': 'لینک سؤالات', 'nav.link.newsletter': 'لینک خبرنامه', 'nav.copyright': 'حق نشر منو',
        'hero.scroll_hint': 'راهنمای پیمایش',
        'entrance.tagline': 'شعار کوتاه زیر لوگو', 'entrance.subtitle': 'زیرعنوان زبان انگلیسی', 'entrance.storyLead': 'متن آماده‌سازی', 'entrance.quote': 'جمله کوتاه', 'entrance.cta': 'متن دکمه ورود',
        'entrance.step.digitalMenu': 'مرحله ۱', 'entrance.step.onlineOrder': 'مرحله ۲', 'entrance.step.reserveTable': 'مرحله ۳', 'entrance.step.quickEntry': 'مرحله ۴',
        'ingredients.sugar.badge': 'برچسب کوتاه', 'ingredients.sugar.title1': 'عنوان اول', 'ingredients.sugar.title2': 'عنوان دوم', 'ingredients.sugar.desc': 'توضیحات',
        'ingredients.aroma.badge': 'برچسب کوتاه', 'ingredients.aroma.title1': 'عنوان اول', 'ingredients.aroma.title2': 'عنوان دوم', 'ingredients.aroma.desc': 'توضیحات',
        'ingredients.caffeine.badge': 'برچسب کوتاه', 'ingredients.caffeine.title': 'عنوان', 'ingredients.caffeine.desc': 'توضیحات',
        'ingredients.stevia.badge': 'برچسب کوتاه', 'ingredients.stevia.title': 'عنوان', 'ingredients.stevia.desc': 'توضیحات',
        'faq.title1': 'عنوان اول', 'faq.title2': 'عنوان دوم',
        'newsletter.title': 'عنوان خبرنامه', 'newsletter.desc': 'توضیح خبرنامه', 'newsletter.email_label': 'برچسب ایمیل', 'newsletter.submit': 'متن دکمه عضویت', 'newsletter.consent': 'متن رضایت', 'newsletter.privacy_link': 'متن لینک حریم خصوصی', 'newsletter.success': 'پیام موفقیت', 'newsletter.error': 'پیام خطا',
        'footer.copyright': 'حق نشر', 'footer.legal': 'اطلاعات حقوقی', 'footer.cgu': 'شرایط استفاده', 'footer.privacy': 'حریم خصوصی', 'footer.tiktok': 'عنوان تیک‌تاک', 'footer.instagram': 'عنوان اینستاگرام',
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
        try {
          const key = el.id.slice(3);
          const updates = { [key]: el.value };
          await api('/api/content', { method: 'PUT', body: JSON.stringify({ content: updates }) });
          Object.assign(state.content, updates);
        } catch (e) {
          showToast(e.message || 'خطا در ذخیره محتوا', 'error');
        }
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
          <h2>لوگوی سفید <small>(نوار بالای سایت و پایین صفحه)</small></h2>
          <div class="grid-2">
            <div class="logo-preview"><img src="${esc(state.content['logo.white'])}" /></div>
            <div>
              <div class="field"><label>بارگذاری تصویر جدید</label><input type="file" id="file-white" accept=".svg,.png,.jpg,.webp" /></div>
              <button class="btn btn-sm" data-logo="logo.white" data-file="file-white">بارگذاری و جایگزینی</button>
            </div>
          </div>
        </div>
        <div class="section-box">
          <h2>لوگوی مشکی</h2>
          <div class="grid-2">
            <div class="logo-preview" style="background: repeating-conic-gradient(#ddd 0% 25%, #bbb 0% 50%) 0 / 24px 24px;"><img src="${esc(state.content['logo.black'])}" /></div>
            <div>
              <div class="field"><label>بارگذاری تصویر جدید</label><input type="file" id="file-black" accept=".svg,.png,.jpg,.webp" /></div>
              <button class="btn btn-sm" data-logo="logo.black" data-file="file-black">بارگذاری و جایگزینی</button>
            </div>
          </div>
        </div>
        <div class="section-box">
          <h2>لوگوی نشانه صفحه ورود</h2>
          <div class="grid-2">
            <div class="logo-preview" style="background:#061014"><img src="${esc(adminImgSrc(state.content['entrance.logo'] || 'assets/images/brand/westo-mark.png?v=brandCyan2'))}" /></div>
            <div><div class="field"><label>تصویر باکیفیت و شفاف</label><input type="file" id="file-entrance-logo" accept=".svg,.png,.jpg,.webp" /></div><button class="btn btn-sm" data-logo="entrance.logo" data-file="file-entrance-logo">بارگذاری لوگوی ورود</button></div>
          </div>
        </div>
        <div class="section-box">
          <h2>نوشتار برند صفحه ورود — زمینه تیره</h2>
          <div class="grid-2">
            <div class="logo-preview" style="background:#061014"><img src="${esc(adminImgSrc(state.content['entrance.wordmark.dark'] || 'assets/images/brand/westo-fa-wordmark.png?v=brandLight1'))}" /></div>
            <div><div class="field"><label>نوشتار روشن روی زمینه تیره</label><input type="file" id="file-entrance-wordmark-dark" accept=".svg,.png,.jpg,.webp" /></div><button class="btn btn-sm" data-logo="entrance.wordmark.dark" data-file="file-entrance-wordmark-dark">بارگذاری نوشتار روشن</button></div>
          </div>
        </div>
        <div class="section-box">
          <h2>نوشتار برند صفحه ورود — زمینه روشن</h2>
          <div class="grid-2">
            <div class="logo-preview" style="background:#f6f4ef"><img src="${esc(adminImgSrc(state.content['entrance.wordmark.light'] || 'assets/images/brand/westo-fa-wordmark-dark.png?v=brandDark1'))}" /></div>
            <div><div class="field"><label>نوشتار تیره روی زمینه روشن</label><input type="file" id="file-entrance-wordmark-light" accept=".svg,.png,.jpg,.webp" /></div><button class="btn btn-sm" data-logo="entrance.wordmark.light" data-file="file-entrance-wordmark-light">بارگذاری نوشتار تیره</button></div>
          </div>
        </div>
        <div class="section-box">
          <h2>الگوی زمینه صفحه ورود</h2>
          <p class="hint">این تصویر فقط در صفحه ورود وستو استفاده می‌شود و ساختار لوگو را تغییر نمی‌دهد. تصویر با پس‌زمینه شفاف بهترین نتیجه را می‌دهد.</p>
          <div class="grid-2">
            <div class="logo-preview" style="background:#061014;min-height:180px;overflow:hidden;"><img src="${esc(adminImgSrc(state.content['entrance.pattern'] || 'assets/images/entrance/westo-pattern.webp'))}" style="width:100%;height:180px;object-fit:contain;" alt="پیش‌نمایش الگوی زمینه صفحه ورود" /></div>
            <div>
              <div class="field"><label>بارگذاری الگوی جدید</label><input type="file" id="file-entrance-pattern" accept=".png,.jpg,.jpeg,.webp,.gif" /></div>
              <div class="row-actions"><button class="btn btn-sm" data-pattern="entrance.pattern" data-file="file-entrance-pattern">بارگذاری و جایگزینی الگوی ورود</button><button class="btn btn-sm btn-ghost" type="button" data-pattern-reset>بازگشت به الگوی پیش‌فرض</button></div>
              <p class="hint">پس از ذخیره، در بارگذاری بعدی صفحه اول اعمال می‌شود.</p>
            </div>
          </div>
        </div>
        <div class="section-box">
          <h2>فایل‌های بارگذاری‌شده</h2>
          <table class="tbl"><thead><tr><th>مسیر</th><th>حجم</th></tr></thead><tbody>
            ${up.files.map((f) => `<tr><td class="ltr"><a href="/${esc(f.path)}" target="_blank">${esc(f.path)}</a></td><td>${fmtNum((f.size / 1024).toFixed(1))} کیلوبایت</td></tr>`).join('') || '<tr><td colspan="2">فایلی بارگذاری نشده است</td></tr>'}
          </tbody></table>
        </div>`;

      main.querySelectorAll('button[data-logo]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const input = document.getElementById(btn.dataset.file);
          if (!input?.files?.[0]) return showToast('اول یک فایل انتخاب کنید');
          try {
            const fd = new FormData();
            fd.append('file', input.files[0]);
            const d = await api('/api/admin/upload', { method: 'POST', body: fd });
            await api('/api/content', { method: 'PUT', body: JSON.stringify({ content: { [btn.dataset.logo]: d.path } }) });
            state.content[btn.dataset.logo] = d.path;
            showToast('رسانه جایگزین شد');
            tabs.media();
          } catch (e) {
            showToast(e.message || 'خطا در بارگذاری رسانه', 'error');
          }
        });
      });

      main.querySelectorAll('button[data-pattern]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const input = document.getElementById(btn.dataset.file);
          if (!input?.files?.[0]) return showToast('ابتدا یک فایل برای الگوی زمینه انتخاب کنید');
          try {
            const fd = new FormData();
            fd.append('file', input.files[0]);
            const d = await api('/api/admin/upload', { method: 'POST', body: fd });
            const key = btn.dataset.pattern;
            await api('/api/content', { method: 'PUT', body: JSON.stringify({ content: { [key]: d.path } }) });
            state.content[key] = d.path;
            showToast('الگوی زمینه صفحه ورود جایگزین شد');
            tabs.media();
          } catch (e) {
            showToast(e.message || 'خطا در بارگذاری الگوی زمینه', 'error');
          }
        });
      });

      main.querySelector('[data-pattern-reset]')?.addEventListener('click', async () => {
        try {
          const path = 'assets/images/entrance/westo-pattern.webp';
          await api('/api/content', { method: 'PUT', body: JSON.stringify({ content: { 'entrance.pattern': path } }) });
          state.content['entrance.pattern'] = path;
          showToast('الگوی پیش‌فرض صفحه ورود بازیابی شد');
          tabs.media();
        } catch (e) {
          showToast(e.message || 'خطا در بازیابی الگوی پیش‌فرض', 'error');
        }
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
          summaryEl.textContent = `${fmtNum(onSite.length)} دسته در صفحه اصلی`;
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
                    : `<div class="menu-studio__drop-hint">تصویر شاخص<br/><small>برای نمایش در صفحه اصلی الزامی است</small></div>`
                }
              </div>
              <div style="flex:1;min-width:0">
                <input type="file" accept=".jpg,.jpeg,.png,.webp" hidden data-cat-file="${c.id}" />
                <div class="row-actions" style="flex-wrap:wrap;gap:0.35rem">
                  <button type="button" class="btn btn-sm" data-cat-cover-pick="${c.id}">بارگذاری تصویر</button>
                  <button type="button" class="btn btn-sm btn-ghost" data-cat-cover-clear="${c.id}" ${covered ? '' : 'disabled'}>پاک کردن</button>
                </div>
                <p class="hint" style="margin:0.4rem 0 0">${siteStatusPill(c, n)} · ${countHint}</p>
                <p class="hint" style="margin:0.35rem 0 0">تصویر شاخص باید عکس غذا یا نوشیدنی روی پس‌زمینه مشکی باشد؛ نه بسته‌بندی یا محصول نامرتبط.</p>
              </div>
            </div>
            <div class="field" style="margin:0.45rem 0 0"><label>توضیح کوتاه صفحه اصلی</label>
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
          if (!path) throw new Error('بارگذاری ناموفق');
          const r = await api(`/api/menu/categories/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ coverImg: path }),
          });
          catList = r.menuCategories || catList;
          if (r.products) state.products = r.products;
          showToast('تصویر شاخص ذخیره شد');
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
              return showToast('ابتدا دسته را مخفی کنید، سپس تصویر شاخص را پاک کنید');
            }
            try {
              const r = await api(`/api/menu/categories/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ coverImg: '' }),
              });
              catList = r.menuCategories || catList;
              if (r.products) state.products = r.products;
              setSyncStatus('idle');
              showToast('تصویر شاخص پاک شد');
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
            throw new Error('برای نمایش در صفحه اصلی باید تصویر شاخص بارگذاری شود');
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
        <h1>دسته‌ها و ترتیب نمایش</h1>
        <p class="lead">ترتیب دسته‌ها، تصویر شاخص، متن معرفی و نمایش در صفحه اصلی را از همین‌جا مدیریت کنید.</p>
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
          showToast('دسته اضافه شد؛ تصویر شاخص را بارگذاری کنید');
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
                <button type="button" class="btn btn-sm btn-ghost" id="go-carousel-cats">دسته‌ها و ترتیب نمایش</button>
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
              ${filtered.map(rowHtml).join('') || '<div class="menu-studio__empty">محصولی در این دسته نیست — «افزودن غذا» را بزنید.</div>'}
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
      let draftModifierGroups = [];

      const cloneModifierGroups = (groups) => (Array.isArray(groups) ? groups : []).slice(0, 8).map((group, groupIndex) => ({
        id: String(group?.id || `group-${groupIndex + 1}`),
        title: String(group?.title || group?.name || '').trim(),
        selection: group?.selection === 'single' ? 'single' : 'multiple',
        required: Boolean(group?.required),
        options: (Array.isArray(group?.options) ? group.options : []).slice(0, 16).map((option, optionIndex) => ({
          id: String(option?.id || `option-${groupIndex + 1}-${optionIndex + 1}`),
          name: String(option?.name || option?.title || '').trim(),
          price: Math.max(0, Math.round(Number(option?.price) || 0)),
          available: option?.available !== false,
        })),
      }));

      const suggestedModifierGroups = (categoryTitle = '') => {
        const text = String(categoryTitle || '').toLocaleLowerCase('fa-IR');
        const make = (id, title, options, selection = 'multiple') => ({ id, title, selection, required: false, options: options.map((raw, index) => { const option = typeof raw === 'string' ? { name: raw, price: 0 } : (raw || {}); return { id: String(option.id || `${id}-${index + 1}`), name: option.name || '', price: Math.max(0, Math.round(Number(option.price) || 0)), available: option.available !== false }; }) });
        if (/(چای|دمنوش|هربال)/u.test(text)) return [make('tea-flavor', 'طعم چای', ['دارچین', 'هل', 'زنجبیل', 'ساده'], 'single'), make('tea-sweetener', 'شیرین‌کننده', [{ name: 'شکر', price: 0 }, { name: 'عسل', price: 60000 }, 'بدون شیرین‌کننده'], 'single')];
        if (/(قهوه|کافئین|لاته|کاپوچینو|اسپرسو|موکا)/u.test(text)) return [make('coffee-milk', 'نوع شیر', [{ name: 'شیر معمولی', price: 0 }, { name: 'شیر جو دوسر', price: 90000 }, { name: 'شیر بادام', price: 90000 }, 'بدون شیر'], 'single'), make('coffee-sweetener', 'شیرین‌کننده', ['شکر', 'شکر قهوه‌ای', 'بدون شکر'], 'single')];
        if (/(نوشیدنی|بار سرد|لیموناد|اسموتی|آبمیوه|ماچا|سرد)/u.test(text)) return [make('cold-ice', 'یخ', ['یخ معمولی', 'یخ کمتر', 'بدون یخ'], 'single'), make('cold-sweetness', 'شیرینی نوشیدنی', ['شیرینی معمولی', 'کم‌شیرین', 'بدون شکر'], 'single')];
        if (/(سالاد)/u.test(text)) return [make('salad-dressing', 'سس سالاد', ['سس جدا', 'بدون سس', { name: 'سس اضافه', price: 60000 }], 'single'), make('salad-addons', 'افزودنی سالاد', [{ name: 'پنیر اضافه', price: 120000 }, { name: 'آووکادو اضافه', price: 180000 }])];
        if (/(سوشی|ماکی)/u.test(text)) return [make('sushi-sides', 'مخلفات سوشی', ['سس سویا', 'واسابی', 'زنجبیل', 'بدون واسابی'])];
        if (/(دسر|کیک|شیرینی|بستنی)/u.test(text)) return [make('dessert-serving', 'نحوه سرو', ['سرو معمولی', 'بسته‌بندی بیرون‌بر', 'گرم‌شده'], 'single')];
        return [make('kitchen-request', 'درخواست آشپزخانه', ['تند', 'بدون پیاز', 'سس جدا']), make('main-addons', 'افزودنی غذا', [{ name: 'پنیر اضافه', price: 120000 }, { name: 'سس اضافه', price: 60000 }])];
      };

      const preferenceEditorHtml = () => draftModifierGroups.map((group, groupIndex) => `
        <article class="menu-preference-group" data-pref-group="${groupIndex}">
          <div class="menu-preference-group__head">
            <div class="menu-preference-group__identity"><span class="menu-preference-group__index">${groupIndex + 1}</span><div><span class="menu-preference-group__eyebrow">گروه گزینه‌ها</span><input class="menu-preference-group__title" data-pref-field="title" value="${esc(group.title)}" aria-label="عنوان گروه ترجیح" /></div></div>
            <div class="menu-preference-group__controls">
              <label class="menu-preference-select"><span>انتخاب</span><select data-pref-field="selection" aria-label="نوع انتخاب"><option value="multiple" ${group.selection !== 'single' ? 'selected' : ''}>چند گزینه</option><option value="single" ${group.selection === 'single' ? 'selected' : ''}>یک گزینه</option></select></label>
              <label class="menu-preference-check"><input type="checkbox" data-pref-field="required" ${group.required ? 'checked' : ''} /> انتخاب الزامی</label>
              <button type="button" class="btn btn-sm btn-ghost" data-pref-action="remove-group" data-pref-group-index="${groupIndex}">حذف گروه</button>
            </div>
          </div>
          <div class="menu-preference-options">
            ${group.options.map((option, optionIndex) => `<div class="menu-preference-option" data-pref-option="${optionIndex}"><div class="menu-preference-option__field"><label>نام گزینه</label><input data-pref-field="option-name" value="${esc(option.name)}" aria-label="نام گزینه" placeholder="مثلاً بدون پیاز" /></div><div class="menu-preference-option__field menu-preference-option__price"><label>افزایش قیمت</label><div><input data-pref-field="option-price" inputmode="numeric" value="${Number(option.price || 0)}" aria-label="هزینه گزینه" /><span>تومان</span></div></div><button type="button" class="menu-preference-option__remove" data-pref-action="remove-option" data-pref-group-index="${groupIndex}" data-pref-option-index="${optionIndex}" aria-label="حذف گزینه">×</button></div>`).join('') || '<p class="menu-preference-empty-options">هنوز گزینه‌ای اضافه نشده است.</p>'}
          </div>
          <button type="button" class="menu-preference-add-option" data-pref-action="add-option" data-pref-group-index="${groupIndex}">+ افزودن گزینه به این گروه</button>
        </article>
      `).join('');

      const readChips = (sel) =>
        [...main.querySelectorAll(`${sel} input:checked`)].map((inp) => inp.value);

      const closeDrawer = () => {
        drawerEl.hidden = true;
        drawerEl.setAttribute('aria-hidden', 'true');
        scrimEl.hidden = true;
        document.body.classList.remove('menu-editor-open');
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
            listEl.innerHTML = '<div class="menu-studio__empty">محصولی در این دسته نیست — «افزودن غذا» را بزنید.</div>';
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
        const parsedStock = parseInputNumber(stockVal);
        return {
          categoryId: parseInputNumber(document.getElementById('md_cat')?.value) || catId,
          name: document.getElementById('md_name')?.value.trim() || '',
          en: document.getElementById('md_en')?.value || '',
          ar: document.getElementById('md_ar')?.value || '',
          desc: document.getElementById('md_desc')?.value || '',
          descEn: document.getElementById('md_descEn')?.value || '',
          descAr: document.getElementById('md_descAr')?.value || '',
          price: parseInputNumber(document.getElementById('md_price')?.value) || 0,
          img: draftImg || '',
          stock: stockVal === '' || stockVal == null ? null : (parsedStock ?? 0),
          lowStockAt: parseInputNumber(document.getElementById('md_low')?.value) || 0,
          allergens: readChips('[data-allergens-for="draft"]'),
          dayparts: readChips('[data-dayparts-for="draft"]'),
          modifierGroups: cloneModifierGroups(draftModifierGroups),
        };
      };

      const openDrawer = (item) => {
        const isNew = !item || item.id == null;
        editingId = isNew ? null : item.id;
        draftImg = item.img || '';
        const categoryTitle = cats.find((category) => Number(category.id) === Number(item.categoryId))?.title || '';
        draftModifierGroups = cloneModifierGroups(Array.isArray(item.modifierGroups) ? item.modifierGroups : suggestedModifierGroups(categoryTitle));
        listEl.querySelectorAll('.menu-studio__row.is-active').forEach((r) => r.classList.remove('is-active'));
        if (!isNew) {
          const row = listEl.querySelector(`[data-mid="${item.id}"]`);
          if (row) row.classList.add('is-active');
        }
        const hasImg = !!draftImg;
        drawerEl.innerHTML = `
          <div class="menu-studio__drawer-head">
            <div class="menu-editor-title"><span class="menu-editor-kicker">استودیو مدیریت غذا</span><h2>${isNew ? 'غذای تازه' : `ویرایش · ${esc(item.name)}`}</h2><p>هویت، تصویر، قیمت و ترجیحات سفارش را در یک صفحه آماده کنید.</p></div>
            <div class="menu-editor-head-actions"><span class="menu-editor-status">${isNew ? 'پیش‌نویس جدید' : (item.available === false ? 'غیرفعال' : 'فعال')}</span><button type="button" class="menu-studio__drawer-close" id="md-close" aria-label="بستن">×</button></div>
          </div>
          <div class="menu-editor-scroll">
            <div class="menu-editor-commandbar">
              <div class="menu-editor-commandbar__copy"><strong>ویرایش مرحله‌ای</strong><span>هر چیزی که مهم است همین‌جاست؛ از بالا شروع کنید یا مستقیم به بخش موردنظر بروید.</span></div>
              <nav class="menu-editor-map" aria-label="بخش‌های ویرایش">
                <button type="button" class="is-active" data-editor-nav="identity"><span>۱</span>اطلاعات</button>
                <button type="button" data-editor-nav="preferences"><span>۲</span>ترجیحات سفارش</button>
                <button type="button" data-editor-nav="display"><span>۳</span>نمایش</button>
                <button type="button" data-editor-nav="advanced"><span>۴</span>حرفه‌ای</button>
              </nav>
              <div class="menu-editor-health" id="md-health" aria-live="polite">
                <span data-health="name"><i>✓</i> نام</span><span data-health="price"><i>✓</i> قیمت</span><span data-health="preferences"><i>✓</i> ترجیحات</span>
              </div>
            </div>
            <div class="menu-editor-grid">
              <section class="menu-editor-card menu-editor-card--identity" id="md-section-identity" data-editor-section="identity">
                <div class="menu-editor-card__head"><div><span class="menu-editor-eyebrow">۱ · اطلاعات اصلی</span><h3>غذا را واضح معرفی کنید</h3><p>نام، توضیح کوتاه، قیمت و دستهٔ منو را یک‌جا تنظیم کنید.</p></div><span class="menu-editor-card__icon">✦</span></div>
                ${field('نام غذا', 'md_name', item.name || '')}
                ${field('توضیح کوتاه برای مهمان', 'md_desc', item.desc || '', { textarea: true })}
                <div class="grid-2">
                  ${field('قیمت (تومان)', 'md_price', String(item.price ?? 0), { ltr: true, type: 'number' })}
                  <div class="field"><label for="md_cat">دسته منو</label><select id="md_cat">${cats.map((c) => `<option value="${c.id}" ${Number(item.categoryId) === c.id ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select></div>
                </div>
              </section>
              <section class="menu-editor-card menu-editor-card--media">
                <div class="menu-editor-card__head"><div><span class="menu-editor-eyebrow">پیش‌نمایش</span><h3>غذا در منو این‌طور دیده می‌شود</h3><p>تصویر و متن نهایی را قبل از انتشار همین‌جا ببینید.</p></div><span class="menu-editor-card__icon">▧</span></div>
                <div class="menu-studio__drop${hasImg ? ' has-img' : ''}" id="md-drop">
                  ${hasImg ? `<img id="md-preview" src="${esc(imgSrc(draftImg))}" alt="پیش‌نمایش ${esc(item.name || 'غذا')}" />` : `<div class="menu-studio__drop-hint"><strong>یک تصویر اشتهابرانگیز اضافه کنید</strong><br/><small>JPG / PNG / WebP · تصویر افقی یا مربعی</small></div>`}
                  <div class="menu-studio__drop-actions"><label class="btn btn-sm" style="cursor:pointer">${hasImg ? 'تغییر تصویر' : 'انتخاب تصویر'}<input type="file" id="md-file" accept=".jpg,.jpeg,.png,.webp,.svg" hidden /></label>${hasImg ? '<button type="button" class="btn btn-sm btn-ghost" id="md-img-clear">حذف تصویر</button>' : ''}</div>
                </div>
                <div class="menu-editor-live-card" aria-label="پیش‌نمایش کارت غذا"><div class="menu-editor-live-card__tag" id="md-live-category">${esc(categoryTitle || 'دسته منو')}</div><strong id="md-live-name">${esc(item.name || 'نام غذا')}</strong><p id="md-live-desc">${esc(item.desc || 'توضیح کوتاه غذا برای مهمان')}</p><div class="menu-editor-live-card__price"><b id="md-live-price">${fmtNum(item.price || 0)}</b><span>تومان</span></div></div>
              </section>
              <section class="menu-editor-card menu-editor-card--preferences" id="md-section-preferences" data-editor-section="preferences">
                <div class="menu-editor-card__head"><div><span class="menu-editor-eyebrow">۲ · تجربه سفارش</span><h3>ترجیحات مخصوص همین غذا</h3><p>مهمان فقط گزینه‌های مرتبط با این غذا را می‌بیند؛ چای و پیتزا دیگر تنظیمات مشترک ندارند.</p></div><span class="menu-editor-card__icon">◈</span></div>
                <div class="menu-preferences-toolbar"><span><b id="md-pref-count">${fmtNum(draftModifierGroups.length)}</b> گروه فعال · گزینه‌ها هنگام ثبت سفارش نمایش داده می‌شوند و هزینهٔ افزوده‌شان شفاف محاسبه می‌شود.</span><div><button type="button" class="btn btn-sm btn-ghost" id="md-pref-suggest">پیشنهادهای این دسته</button><button type="button" class="btn btn-sm" id="md-pref-add-group">+ افزودن گروه</button></div></div>
                <div id="md-modifier-groups" class="menu-preferences-groups">${preferenceEditorHtml()}</div>
                <div id="md-pref-empty" class="menu-preference-empty-state" ${draftModifierGroups.length ? 'hidden' : ''}><strong>برای این غذا ترجیحی ثبت نشده</strong><span>اگر لازم است، یک گروه مثل «نوع شیر» یا «سس» اضافه کنید.</span></div>
              </section>
              <section class="menu-editor-card menu-editor-card--display" id="md-section-display" data-editor-section="display">
                <div class="menu-editor-card__head"><div><span class="menu-editor-eyebrow">۳ · نمایش و سرو</span><h3>غذا کجا و برای چه کسی دیده شود؟</h3></div><span class="menu-editor-card__icon">◌</span></div>
                <div class="field"><label>آلرژن‌ها</label>${allergenBoxes(item, 'draft')}</div>
                <div class="field"><label>وعده‌های نمایش</label>${daypartBoxes(item, 'draft')}</div>
              </section>
              <section class="menu-editor-card menu-editor-card--advanced" id="md-section-advanced" data-editor-section="advanced">
                <details class="menu-studio__advanced"><summary><span><span class="menu-editor-eyebrow">۴ · تنظیمات حرفه‌ای</span><b>ترجمه و موجودی</b></span><small>برای کنترل دقیق‌تر</small></summary>
                  <div class="menu-studio__links"><button type="button" data-goto="translate">ترجمه منو</button><button type="button" data-goto="inventory">موجودی انبار</button></div>
                  <div class="grid-2">${field('نام انگلیسی', 'md_en', item.en || '', { ltr: true })}${field('نام عربی', 'md_ar', item.ar || '', { ltr: true })}</div>
                  <div class="grid-2">${field('توضیح انگلیسی', 'md_descEn', item.descEn || '', { textarea: true, ltr: true })}${field('توضیح عربی', 'md_descAr', item.descAr || '', { textarea: true, ltr: true })}</div>
                  <div class="grid-2">${field('موجودی (خالی = نامحدود)', 'md_stock', item.stock === null || item.stock === undefined ? '' : String(item.stock), { ltr: true, type: 'number' })}${field('آستانه هشدار موجودی کم', 'md_low', String(item.lowStockAt ?? 5), { ltr: true, type: 'number' })}</div>
                </details>
              </section>
            </div>
          </div>
          <div class="menu-studio__drawer-footer"><div class="menu-editor-save-state"><span class="menu-editor-save-dot"></span><span id="md-sync-hint">${isNew ? 'پس از ایجاد، تغییرات ذخیره می‌شوند' : 'ذخیره خودکار فعال است'}</span></div><div class="menu-editor-footer-actions">${isNew ? '<button type="button" class="btn btn-lg" id="md-create">ایجاد و ذخیره غذا</button>' : `<button type="button" class="btn btn-sm btn-ghost" id="md-avail" data-val="${item.available === false}">${item.available === false ? 'موجود کن' : 'ناموجود کن'}</button><button type="button" class="btn btn-sm btn-danger" id="md-del">حذف غذا</button>`}</div></div>`;

        drawerEl.hidden = false;
        drawerEl.setAttribute('aria-hidden', 'false');
        scrimEl.hidden = false;
        document.body.classList.add('menu-editor-open');
        wireDaypartExclusive(drawerEl);

        document.getElementById('md-close').onclick = closeDrawer;
        scrimEl.onclick = closeDrawer;

        const paintEditorOverview = () => {
          const name = document.getElementById('md_name')?.value.trim() || '';
          const price = parseInputNumber(document.getElementById('md_price')?.value) || 0;
          const category = cats.find((c) => Number(c.id) === Number(document.getElementById('md_cat')?.value));
          const setHealth = (key, ok, text) => {
            const node = drawerEl.querySelector(`[data-health="${key}"]`);
            if (!node) return;
            node.classList.toggle('is-ok', Boolean(ok));
            node.classList.toggle('is-pending', !ok);
            node.innerHTML = `<i>${ok ? '✓' : '!'}</i>${text}`;
          };
          const prefCount = drawerEl.querySelectorAll('.menu-preference-group').length;
          setHealth('name', Boolean(name), name ? 'نام آماده' : 'نام لازم است');
          setHealth('price', price > 0, price > 0 ? 'قیمت آماده' : 'قیمت لازم است');
          setHealth('preferences', prefCount > 0, prefCount > 0 ? `${fmtNum(prefCount)} گروه ترجیح` : 'بدون ترجیح');
          const liveName = drawerEl.querySelector('#md-live-name');
          const liveDesc = drawerEl.querySelector('#md-live-desc');
          const livePrice = drawerEl.querySelector('#md-live-price');
          const liveCategory = drawerEl.querySelector('#md-live-category');
          if (liveName) liveName.textContent = name || 'نام غذا';
          if (liveDesc) liveDesc.textContent = document.getElementById('md_desc')?.value.trim() || 'توضیح کوتاه غذا برای مهمان';
          if (livePrice) livePrice.textContent = fmtNum(price);
          if (liveCategory) liveCategory.textContent = category?.title || 'دسته منو';
        };

        drawerEl.querySelectorAll('[data-editor-nav]').forEach((button) => {
          button.addEventListener('click', () => {
            const target = drawerEl.querySelector(`[data-editor-section="${button.dataset.editorNav}"]`);
            if (!target) return;
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            drawerEl.querySelectorAll('[data-editor-nav]').forEach((b) => b.classList.toggle('is-active', b === button));
          });
        });
        drawerEl.addEventListener('input', (event) => {
          if (event.target.matches('#md_name, #md_desc, #md_price, #md_cat')) paintEditorOverview();
        });
        drawerEl.addEventListener('change', (event) => {
          if (event.target.matches('#md_cat')) paintEditorOverview();
        });
        paintEditorOverview();

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

        const renderPreferences = () => {
          const root = drawerEl.querySelector('#md-modifier-groups');
          if (root) root.innerHTML = preferenceEditorHtml();
          const empty = drawerEl.querySelector('#md-pref-empty');
          if (empty) empty.hidden = draftModifierGroups.length > 0;
          const count = drawerEl.querySelector('#md-pref-count');
          if (count) count.textContent = fmtNum(draftModifierGroups.length);
          paintEditorOverview();
        };
        const savePreferences = () => { if (editingId != null) saveDebounced(); };
        drawerEl.querySelector('#md-modifier-groups')?.addEventListener('input', (event) => {
          const target = event.target;
          const groupIndex = Number(target.closest('[data-pref-group]')?.dataset.prefGroup);
          const optionIndex = Number(target.closest('[data-pref-option]')?.dataset.prefOption);
          const group = draftModifierGroups[groupIndex];
          if (!group) return;
          if (target.dataset.prefField === 'title') group.title = target.value;
          if (target.dataset.prefField === 'option-name' && group.options[optionIndex]) group.options[optionIndex].name = target.value;
          if (target.dataset.prefField === 'option-price' && group.options[optionIndex]) group.options[optionIndex].price = Math.max(0, Math.round(parseInputNumber(target.value) || 0));
          savePreferences();
        });
        drawerEl.querySelector('#md-modifier-groups')?.addEventListener('change', (event) => {
          const target = event.target;
          const groupIndex = Number(target.closest('[data-pref-group]')?.dataset.prefGroup);
          const group = draftModifierGroups[groupIndex];
          if (!group) return;
          if (target.dataset.prefField === 'selection') group.selection = target.value === 'single' ? 'single' : 'multiple';
          if (target.dataset.prefField === 'required') group.required = target.checked;
          savePreferences();
        });
        drawerEl.querySelector('#md-modifier-groups')?.addEventListener('click', (event) => {
          const button = event.target.closest('[data-pref-action]');
          if (!button) return;
          event.preventDefault();
          const action = button.dataset.prefAction;
          const groupIndex = Number(button.dataset.prefGroupIndex);
          const optionIndex = Number(button.dataset.prefOptionIndex);
          if (action === 'remove-group') draftModifierGroups.splice(groupIndex, 1);
          if (action === 'remove-option' && draftModifierGroups[groupIndex]) draftModifierGroups[groupIndex].options.splice(optionIndex, 1);
          if (action === 'add-option' && draftModifierGroups[groupIndex]) draftModifierGroups[groupIndex].options.push({ id: `option-${Date.now()}`, name: 'گزینه جدید', price: 0, available: true });
          renderPreferences();
          savePreferences();
        });
        drawerEl.querySelector('#md-pref-add-group')?.addEventListener('click', () => {
          draftModifierGroups.push({ id: `group-${Date.now()}`, title: 'گروه ترجیح جدید', selection: 'multiple', required: false, options: [{ id: `option-${Date.now()}`, name: 'گزینه جدید', price: 0, available: true }] });
          renderPreferences();
          savePreferences();
        });
        drawerEl.querySelector('#md-pref-suggest')?.addEventListener('click', () => {
          const selectedCategory = cats.find((category) => Number(category.id) === Number(document.getElementById('md_cat')?.value));
          draftModifierGroups = suggestedModifierGroups(selectedCategory?.title || '');
          renderPreferences();
          savePreferences();
          showToast('پیشنهادهای متناسب با دسته ساخته شد');
        });

        const paintDrop = () => {
          const drop = document.getElementById('md-drop');
          if (!drop) return;
          const has = !!draftImg;
          drop.classList.toggle('has-img', has);
          drop.innerHTML = has
            ? `<img id="md-preview" src="${esc(imgSrc(draftImg))}" alt="" />
               <div class="menu-studio__drop-actions">
                 <label class="btn btn-sm" style="cursor:pointer">تغییر تصویر
                   <input type="file" id="md-file" accept=".jpg,.jpeg,.png,.webp,.svg" hidden />
                 </label>
                 <button type="button" class="btn btn-sm btn-ghost" id="md-img-clear">حذف تصویر</button>
               </div>`
            : `<div class="menu-studio__drop-hint">تصویر غذا را انتخاب کنید<br/><small>JPG / PNG / WebP</small></div>
               <div class="menu-studio__drop-actions">
                 <label class="btn btn-sm" style="cursor:pointer">انتخاب تصویر
                   <input type="file" id="md-file" accept=".jpg,.jpeg,.png,.webp,.svg" hidden />
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
              if (!draftImg) throw new Error('بارگذاری ناموفق');
              paintDrop();
              if (editingId != null) await saveNow();
              else setSyncStatus('idle');
              showToast('تصویر ذخیره شد');
            } catch (err) {
              setSyncStatus('error', err.message);
              showToast(err.message || 'خطای بارگذاری');
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
          if (!confirm('این محصول حذف شود؟')) return;
          try {
            await api(`/api/menu/${editingId}`, { method: 'DELETE' });
            showToast('حذف شد');
            const id = editingId;
            state.menuItems = state.menuItems.filter((x) => x.id !== id);
            state._menuAllItems = (state._menuAllItems || []).filter((x) => x.id !== id);
            listEl.querySelector(`[data-mid="${id}"]`)?.remove();
            if (!listEl.querySelector('.menu-studio__row')) {
              listEl.innerHTML = '<div class="menu-studio__empty">محصولی در این دسته نیست — «افزودن غذا» را بزنید.</div>';
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
        <h1>ترجمه منو به انگلیسی و عربی</h1>
        <p class="lead">نام و توضیح محصولات را برای مهمانان انگلیسی و عربی آماده کنید. ترجمه انگلیسی با ${st.engine === 'openai' ? 'مترجم خودکار' : 'واژه‌نامه داخلی'} پیشنهاد می‌شود و متن عربی را می‌توانید بازبینی یا دستی وارد کنید.</p>
        <div class="cards">
          <div class="card"><div class="num">${fmtNum(st.total || 0)}</div><div class="lbl">کل محصولات</div></div>
          <div class="card accent"><div class="num">${fmtNum(st.withEn || 0)}</div><div class="lbl">دارای نام انگلیسی</div></div>
          <div class="card warn"><div class="num">${fmtNum(st.missingEn || 0)}</div><div class="lbl">بدون نام انگلیسی</div></div>
          <div class="card accent"><div class="num">${fmtNum(st.withAr || 0)}</div><div class="lbl">دارای نام عربی</div></div>
          <div class="card warn"><div class="num">${fmtNum(st.missingAr || 0)}</div><div class="lbl">بدون نام عربی</div></div>
        </div>
        <div class="section-box">
          <h2>تنظیمات مهمان</h2>
          <label class="chk" style="display:inline-flex;margin-bottom:0.75rem;"><input type="checkbox" id="i18n_enabled" ${i18n.guestLangEnabled !== false ? 'checked' : ''} /> نمایش سوییچ زبان در منوی عمومی</label>
          <div class="field" style="max-width:220px;">
            <label>زبان پیش‌فرض</label>
            <select id="i18n_default">
              <option value="fa" ${i18n.defaultLang === 'fa' || !i18n.defaultLang ? 'selected' : ''}>فارسی</option>
              <option value="en" ${i18n.defaultLang === 'en' ? 'selected' : ''}>انگلیسی</option>
              <option value="ar" ${i18n.defaultLang === 'ar' ? 'selected' : ''}>عربی</option>
            </select>
          </div>
          <div class="row-actions">
            <span class="hint">ذخیره خودکار تنظیمات</span>
            <button class="btn btn-sm" id="tr-missing">ترجمه موارد ناقص انگلیسی (${fmtNum(missing.length)})</button>
            <button class="btn btn-sm btn-ghost" id="tr-force">بازنویسی همه ترجمه‌های انگلیسی</button>
          </div>
        </div>
        <div class="section-box">
          <h2>بازبینی سریع</h2>
          <p class="hint">تغییر ردیف‌ها خودکار ذخیره می‌شود</p>
          <table class="tbl"><thead><tr><th>فارسی</th><th>انگلیسی</th><th>عربی</th><th>توضیح انگلیسی</th><th>توضیح عربی</th><th></th></tr></thead><tbody>
            ${items
              .slice(0, 40)
              .map(
                (m) => `<tr data-tid="${m.id}">
                  <td>${esc(m.name)}</td>
                  <td><input class="ltr-input tr-en" dir="ltr" value="${esc(m.en || '')}" /></td>
                  <td><input class="ltr-input tr-ar" dir="rtl" value="${esc(m.ar || '')}" /></td>
                  <td><input class="ltr-input tr-desc" dir="ltr" value="${esc(m.descEn || '')}" /></td>
                  <td><input class="ltr-input tr-desc-ar" dir="rtl" value="${esc(m.descAr || '')}" /></td>
                  <td><button class="btn btn-sm btn-ghost" data-trai="${m.id}">ترجمه خودکار</button></td>
                </tr>`
              )
              .join('') || '<tr><td colspan="6">محصولی یافت نشد</td></tr>'}
          </tbody></table>
        </div>`;

      const saveI18nSettings = async () => {
        try {
          await api('/api/admin/i18n', {
            method: 'PUT',
            body: JSON.stringify({
              guestLangEnabled: document.getElementById('i18n_enabled').checked,
              defaultLang: document.getElementById('i18n_default').value,
            }),
          });
        } catch (e) {
          showToast(e.message || 'خطا در ذخیره تنظیمات زبان', 'error');
        }
      };
      document.getElementById('i18n_enabled')?.addEventListener('change', autosave(saveI18nSettings, { debounceMs: 0, silent: true }));
      document.getElementById('i18n_default')?.addEventListener('change', autosave(saveI18nSettings, { debounceMs: 0, silent: true }));
      document.getElementById('tr-missing')?.addEventListener('click', async () => {
        showToast('در حال ترجمه…');
        try {
          const r = await api('/api/admin/translate/menu', {
            method: 'POST',
            body: JSON.stringify({ onlyMissing: true }),
          });
          showToast(`${r.count} محصول ترجمه شد (${r.engine})`);
          tabs.translate();
        } catch (e) {
          showToast(e.message || 'خطا در ترجمه منو', 'error');
        }
      });
      document.getElementById('tr-force')?.addEventListener('click', async () => {
        if (!confirm('همه ترجمه‌های انگلیسی بازنویسی شوند؟')) return;
        showToast('در حال بازنویسی…');
        try {
          const r = await api('/api/admin/translate/menu', {
            method: 'POST',
            body: JSON.stringify({ force: true, onlyMissing: false }),
          });
          showToast(`${r.count} محصول به‌روز شد`);
          tabs.translate();
        } catch (e) {
          showToast(e.message || 'خطا در بازنویسی ترجمه‌ها', 'error');
        }
      });
      main.querySelectorAll('[data-trai]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          try {
            const r = await api(`/api/admin/translate/menu/${btn.dataset.trai}`, {
              method: 'POST',
              body: JSON.stringify({ force: true }),
            });
            const tr = btn.closest('tr');
            if (tr) {
              tr.querySelector('.tr-en').value = r.item.en || '';
              tr.querySelector('.tr-desc').value = r.item.descEn || '';
            }
            showToast('ترجمه شد');
          } catch (e) {
            showToast(e.message || 'خطا در ترجمه خودکار', 'error');
          }
        })
      );
      main.querySelectorAll('tr[data-tid]').forEach((tr) => {
        const saveRow = async () => {
          try {
            await api(`/api/menu/${tr.dataset.tid}`, {
              method: 'PUT',
              body: JSON.stringify({
                en: tr.querySelector('.tr-en').value,
                ar: tr.querySelector('.tr-ar')?.value || '',
                descEn: tr.querySelector('.tr-desc').value,
                descAr: tr.querySelector('.tr-desc-ar')?.value || '',
              }),
            });
          } catch (e) {
            showToast(e.message || 'خطا در ذخیره ترجمه سطر', 'error');
          }
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
            <header><div><strong>${t.tableNo ? `میز ${esc(t.tableNo)}` : esc(fulfillment)}</strong><small>${esc(fulfillment)} · ${fmtNum(unitCount)} قلم</small></div><span class="kds-age">${fmtAge(t.ageSec)}</span></header>
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
          const key = String(item.name || 'سفارش');
          prepLoad.set(key, (prepLoad.get(key) || 0) + Math.max(1, Number(item.qty) || 1));
        }));
        const topPrep = [...prepLoad.entries()].sort((a,b) => b[1]-a[1]).slice(0,6);
        main.innerHTML = `
          <div class="ops-page-head"><div><p class="eyebrow">نمایش زنده آشپزخانه</p><h1>آشپزخانه</h1><p class="lead">قدیمی‌ترین سفارش در هر ستون بالاتر است. هدف شیفت: «جدید» را شروع کنید، «در حال آماده‌سازی» را فقط وقتی کامل شد آماده بزنید.</p></div><div class="row-actions"><a class="btn btn-sm btn-ghost" href="/admin/kitchen">نمایشگر مستقل آشپزخانه</a><span class="ops-provider-pill">قدیمی‌ترین: ${fmtAge(queue.summary?.oldestAgeSec || 0)}</span></div></div>
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
          <p class="hint">اتصال زنده فعال است؛ تغییر سفارش‌ها بدون تازه‌سازی دوره‌ای همگام می‌شود.</p>`;

        main.querySelectorAll('[data-kstatus]').forEach((b) => b.addEventListener('click', () => runBusy(b, async () => {
          await api(`/api/kitchen/orders/${b.dataset.kstatus}`, { method:'PATCH', body:JSON.stringify({ status:b.dataset.val }) });
          showToast('وضعیت آشپزخانه به‌روز شد', 'success', 1400); await paint();
        }).catch((e) => showToast(e.message, 'error'))));
        main.querySelectorAll('[data-calldone]').forEach((b) => b.addEventListener('click', () => runBusy(b, async () => {
          await api(`/api/kitchen/calls/${b.dataset.calldone}`, { method:'PATCH', body:JSON.stringify({ status:'done' }) }); await paint();
        }, 'ثبت…').catch((e) => showToast(e.message, 'error'))));
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
        <div class="ops-page-head"><div><p class="eyebrow">مدیریت سالن</p><h1>رزرو میز</h1><p class="lead">رزروهای نزدیک اول نمایش داده می‌شوند. وضعیت، تعداد نفر و یادداشت مهمان را از همین صفحه مدیریت کنید.</p></div><a class="btn btn-sm btn-ghost" href="/reserve" target="_blank" rel="noopener">مشاهده صفحه رزرو</a></div>
        <div class="cards cards-dense">
          <div class="card"><div class="num">${fmtNum(d.summary?.today || 0)}</div><div class="lbl">رزرو فعال امروز</div></div>
          <div class="card"><div class="num">${fmtNum(d.summary?.todayCovers || 0)}</div><div class="lbl">نفر امروز</div></div>
          <div class="card warn"><div class="num">${fmtNum(d.summary?.pending || 0)}</div><div class="lbl">منتظر تأیید</div></div>
          <div class="card accent"><div class="num">${fmtNum(d.summary?.confirmed || 0)}</div><div class="lbl">تأیید شده</div></div>
          <div class="card"><div class="num">${fmtNum(d.summary?.seated || 0)}</div><div class="lbl">نشسته‌اند</div></div>
          <div class="card ${d.summary?.noShowToday ? 'is-danger' : ''}"><div class="num">${fmtNum(d.summary?.noShowToday || 0)}</div><div class="lbl">عدم مراجعه امروز</div></div>
        </div>
        ${slotsToday.length ? `<section class="section-box"><div class="ops-panel__head"><div><p class="eyebrow">بار شیفت امروز</p><h2>ظرفیت نوبت‌های رزرو</h2></div>${peak ? `<span class="hint">شلوغ‌ترین: ${esc(peak.time)} · ${fmtNum(peak.percent)}٪</span>` : ''}</div><div class="reservation-slot-load">${slotsToday.map((row)=>`<div class="reservation-slot"><header><b>${esc(row.time)}</b><span>${fmtNum(row.covers)}/${fmtNum(row.maxCovers)} نفر</span></header><div class="reservation-slot__bar"><i style="width:${Math.min(100,row.percent)}%"></i></div><small>${fmtNum(row.parties)} رزرو · ${fmtNum(row.percent)}٪ ظرفیت</small></div>`).join('')}</div></section>` : ''}
        ${canConfigure ? `<details class="section-box admin-config-panel"><summary><strong>تنظیمات ظرفیت رزرو</strong><span>برای مدیر سیستم</span></summary><div class="grid-2 admin-config-grid"><label class="chk"><input type="checkbox" id="rs_en" ${settings.enabled !== false ? 'checked' : ''} /> رزرو آنلاین فعال</label>${field('فاصله نوبت‌ها (دقیقه)','rs_slot',String(settings.slotMinutes ?? 30),{ltr:true,type:'number'})}${field('حداکثر نفرات هر رزرو','rs_party',String(settings.maxParty ?? 12),{ltr:true,type:'number'})}${field('ظرفیت هر نوبت (نفر)','rs_covers',String(settings.maxCoversPerSlot ?? 24),{ltr:true,type:'number'})}${field('روزهای پیشِ‌رو','rs_adv',String(settings.advanceDays ?? 21),{ltr:true,type:'number'})}${field('حداقل ساعت تا رزرو','rs_min',String(settings.minHoursAhead ?? 1),{ltr:true,type:'number'})}</div><p class="hint">تغییرات این بخش ذخیره خودکار دارند.</p></details>` : ''}
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

      const saveSettings = async () => {
        try {
          await api('/api/admin/reservation-settings', {
            method: 'PUT',
            body: JSON.stringify({
              settings: {
                enabled: document.getElementById('rs_en')?.checked !== false,
                slotMinutes: parseInputNumber(document.getElementById('rs_slot')?.value) || 30,
                maxParty: parseInputNumber(document.getElementById('rs_party')?.value) || 12,
                maxCoversPerSlot: parseInputNumber(document.getElementById('rs_covers')?.value) || 24,
                advanceDays: parseInputNumber(document.getElementById('rs_adv')?.value) || 21,
                minHoursAhead: parseInputNumber(document.getElementById('rs_min')?.value) || 0,
              },
            }),
          });
        } catch (e) {
          showToast(e.message || 'خطا در ذخیره تنظیمات رزرو', 'error');
        }
      };
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
      main.querySelectorAll('[data-rparty]').forEach((input)=>input.addEventListener('change', async()=>{
        try {
          const partySize = parseInputNumber(input.value) || 1;
          await api(`/api/admin/reservations/${input.dataset.rparty}`,{method:'PATCH',body:JSON.stringify({partySize})});
          showToast('تعداد نفر ذخیره شد','success',1300);
        } catch(e){showToast(e.message,'error');}
      }));
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
        <div class="ops-page-head"><div><p class="eyebrow">کنترل سفارش</p><h1>سفارش‌ها</h1><p class="lead">سفارش‌های باز قبل از آرشیو و قدیمی‌ترین موارد باز زودتر نمایش داده می‌شوند. دکمه اصلی فقط مرحله مجاز بعدی را اجرا می‌کند.</p></div><div class="row-actions"><a class="btn btn-sm btn-ghost" href="${financeWorkspaceHref('sales_bank')}">کنترل مالی فروش</a><a class="btn btn-sm btn-ghost" href="/order" target="_blank" rel="noopener">باز کردن ثبت سفارش</a></div></div>
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
          <div><p class="eyebrow">عملیات تحویل</p><h1>پیک، تحویل و پرداخت</h1><p class="lead">هزینه و حداقل سفارش هر محدوده در همین شعبه کنترل می‌شود. پرداخت آنلاین فعلاً در حالت ${esc(paymentModeLabel(paymentData.provider?.mode))} است.</p></div>
          <div class="row-actions"><a class="btn btn-sm btn-ghost" href="${financeWorkspaceHref('sales_bank')}">تطبیق پرداخت و بانک</a><a class="btn btn-sm btn-ghost" href="/order" target="_blank" rel="noopener">پیش‌نمایش ثبت سفارش</a></div>
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
                ${field('زمان تقریبی (دقیقه)', `zone-${zone.id}-eta`, String(zone.etaMinutes || 0), { ltr: true, type: 'number' })}
              </div>
              <div class="row-actions"><button class="btn btn-sm" data-zone-save="${zone.id}">ذخیره محدوده</button><button class="btn btn-sm btn-danger" data-zone-delete="${zone.id}">حذف</button></div>
            </article>`).join('') || '<p class="ops-empty">برای این شعبه هنوز محدوده‌ای تعریف نشده است.</p>'}
          </div>
          <details class="delivery-zone-new"><summary>افزودن محدوده جدید</summary>
            <div class="grid-3">
              ${field('نام محدوده', 'new-zone-name', '')}
              ${field('حداقل سفارش (تومان)', 'new-zone-minimum', '0', { ltr: true, type: 'number' })}
              ${field('هزینه ارسال (تومان)', 'new-zone-fee', '0', { ltr: true, type: 'number' })}
              ${field('زمان تقریبی (دقیقه)', 'new-zone-eta', '30', { ltr: true, type: 'number' })}
            </div>
            <button class="btn btn-sm" id="new-zone-save">افزودن محدوده</button>
          </details>
        </section>
        <section class="section-box">
          <div class="ops-panel__head"><div><p class="eyebrow">پرداخت</p><h2>آخرین تلاش‌های پرداخت</h2></div><span class="ops-provider-pill">${esc(paymentProviderLabel(paymentData.provider?.provider))} · ${esc(paymentModeLabel(paymentData.provider?.mode))}</span></div>
          <div class="payment-list">
            ${payments.map((payment) => `<div class="payment-row"><div><b>#${payment.id} · سفارش #${payment.orderId}</b><span>${fmtDateTime(payment.createdAt)}</span></div><strong>${fmtMoney(payment.amount)}</strong><em class="ops-status ops-status--${esc(payment.status)}">${esc({ pending: 'در انتظار', paid: 'موفق', failed: 'ناموفق', cancelled: 'لغو', refunded: 'بازپرداخت' }[payment.status] || payment.status)}</em></div>`).join('') || '<p class="ops-empty">تلاش پرداختی وجود ندارد.</p>'}
          </div>
        </section>`;

      const updateZone = async (id, patch) => {
        try {
          await api(`/api/admin/delivery-zones/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
          showToast('محدوده ارسال ذخیره شد', 'success');
          tabs.delivery().catch((error) => showToast(error.message, 'error'));
        } catch (error) {
          showToast(error.message || 'خطا در ذخیره محدوده', 'error');
        }
      };
      main.querySelectorAll('[data-zone-save]').forEach((button) => {
        button.addEventListener('click', () => {
          const id = button.dataset.zoneSave;
          const name = document.getElementById(`zone-${id}-name`)?.value?.trim() || '';
          if (!name) {
            showToast('نام محدوده لازم است', 'error');
            return;
          }
          updateZone(id, {
            name,
            minOrder: parseInputNumber(document.getElementById(`zone-${id}-minimum`)?.value) || 0,
            fee: parseInputNumber(document.getElementById(`zone-${id}-fee`)?.value) || 0,
            etaMinutes: parseInputNumber(document.getElementById(`zone-${id}-eta`)?.value) || 0,
            active: main.querySelector(`[data-zone="${id}"] [data-zone-active]`)?.checked !== false,
          }).catch((error) => showToast(error.message, 'error'));
        });
      });
      main.querySelectorAll('[data-zone-active]').forEach((input) => {
        input.addEventListener('change', () => {
          const id = input.closest('[data-zone]')?.dataset.zone;
          if (id) updateZone(id, { active: input.checked }).catch((error) => showToast(error.message, 'error'));
        });
      });
      main.querySelectorAll('[data-zone-delete]').forEach((button) => {
        button.addEventListener('click', async () => {
          if (!window.confirm('این محدوده حذف شود؟')) return;
          try {
            await api(`/api/admin/delivery-zones/${button.dataset.zoneDelete}`, { method: 'DELETE' });
            showToast('محدوده حذف شد', 'success');
            tabs.delivery().catch((error) => showToast(error.message, 'error'));
          } catch (error) {
            showToast(error.message || 'خطا در حذف محدوده', 'error');
          }
        });
      });
      document.getElementById('new-zone-save')?.addEventListener('click', async () => {
        const nameInput = document.getElementById('new-zone-name');
        const name = nameInput?.value?.trim() || '';
        if (!name) {
          showToast('نام محدوده لازم است', 'error');
          nameInput?.focus();
          return;
        }
        try {
          await api('/api/admin/delivery-zones', {
            method: 'POST',
            body: JSON.stringify({
              branchId: currentBranchId,
              name,
              minOrder: parseInputNumber(document.getElementById('new-zone-minimum')?.value) || 0,
              fee: parseInputNumber(document.getElementById('new-zone-fee')?.value) || 0,
              etaMinutes: parseInputNumber(document.getElementById('new-zone-eta')?.value) || 0,
            }),
          });
          showToast('محدوده جدید اضافه شد', 'success');
          tabs.delivery().catch((error) => showToast(error.message, 'error'));
        } catch (error) {
          showToast(error.message || 'خطا در ایجاد محدوده جدید', 'error');
        }
      });
    },

    async faq() {
      setActiveTab('faq');
      if (!Array.isArray(state.faq)) state.faq = [];
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
          try {
            const d = await api(`/api/faq/${f.id}`, {
              method: 'PUT',
              body: JSON.stringify({
                q: document.getElementById(`f${f.id}_q`)?.value || '',
                a: document.getElementById(`f${f.id}_a`)?.value || '',
              }),
            });
            const item = state.faq.find((x) => x.id === f.id);
            if (item && d.item) Object.assign(item, d.item);
          } catch (e) {
            showToast(e.message || 'خطا در ذخیره سؤال', 'error');
          }
        };
        bindAutosave(main.querySelector(`[data-fid="${f.id}"]`), saveFaq);
      });
      main.querySelectorAll('[data-fdel]').forEach((b) =>
        b.addEventListener('click', async () => {
          if (!confirm('این سؤال حذف شود؟')) return;
          try {
            await api(`/api/faq/${b.dataset.fdel}`, { method: 'DELETE' });
            state.faq = state.faq.filter((f) => f.id !== Number(b.dataset.fdel));
            showToast('سؤال با موفقیت حذف شد', 'success');
            tabs.faq();
          } catch (e) {
            showToast(e.message || 'خطا در حذف سؤال', 'error');
          }
        })
      );
      const move = async (id, dir) => {
        const ids = state.faq.map((f) => f.id);
        const i = ids.indexOf(Number(id));
        const j = i + dir;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        try {
          const d = await api('/api/faq-order', { method: 'PUT', body: JSON.stringify({ order: ids }) });
          state.faq = Array.isArray(d.faq) ? d.faq : state.faq;
          tabs.faq();
        } catch (e) {
          showToast(e.message || 'خطا در جابه‌جایی سؤال', 'error');
        }
      };
      main.querySelectorAll('[data-fup]').forEach((b) => b.addEventListener('click', () => move(b.dataset.fup, -1)));
      main.querySelectorAll('[data-fdown]').forEach((b) => b.addEventListener('click', () => move(b.dataset.fdown, 1)));
      document.getElementById('f-add')?.addEventListener('click', async () => {
        const q = document.getElementById('new_q')?.value.trim() || '';
        const a = document.getElementById('new_a')?.value.trim() || '';
        if (!q) return showToast('متن سؤال را وارد کنید', 'warn');
        try {
          const d = await api('/api/faq', { method: 'POST', body: JSON.stringify({ q, a }) });
          if (d.item) state.faq.push(d.item);
          showToast('سؤال جدید با موفقیت اضافه شد', 'success');
          tabs.faq();
        } catch (e) {
          showToast(e.message || 'خطا در ثبت سؤال جدید', 'error');
        }
      });
    },

    async users(activeSubTab = 'staff') {
      setActiveTab('users');
      const [d, matrixData, branchesData] = await Promise.all([
        api('/api/admin/users').catch(() => ({ users: [], branches: [] })),
        api('/api/admin/roles/matrix').catch(() => null),
        api('/api/branches').catch(() => ({ branches: [] })),
      ]);

      const allUsers = Array.isArray(d.users) ? d.users : [];
      const allBranches = (branchesData.branches && branchesData.branches.length) ? branchesData.branches : (d.branches || []);
      const branchMap = Object.fromEntries(allBranches.map((b) => [Number(b.id), b.name]));

      const roleDefs = {
        owner: { label: 'مالک / مدیر ارشد', icon: '👑', tagClass: 'role-tag--owner', desc: 'دسترسی نامحدود به تمامی بخش‌ها و اسناد' },
        manager: { label: 'مدیر داخلی', icon: '🧑‍💼', tagClass: 'role-tag--manager', desc: 'مدیریت سفارش‌ها، پرسنل، انبار، صندوق و گزارش‌ها' },
        accountant: { label: 'حسابدار / مدیر مالی', icon: '💰', tagClass: 'role-tag--accountant', desc: 'اسناد دوبل، ترازنامه، سودوزیان، مغایرت‌گیری و انبار' },
        cashier: { label: 'صندوقدار', icon: '💵', tagClass: 'role-tag--cashier', desc: 'ثبت سفارش، تسویه فاکتور، مدیریت پوز و نقد، تحویل' },
        waiter: { label: 'گارسون / سالن‌کار', icon: '🤵', tagClass: 'role-tag--waiter', desc: 'سفارش‌گیری سر میز، فراخوانی مهمان، وضعیت میزها' },
        kitchen: { label: 'آشپزخانه / سرآشپز', icon: '🍳', tagClass: 'role-tag--kitchen', desc: 'صف پخت KDS، شروع پخت، اعلام آماده و حواله مصرف' },
        guest: { label: 'مشتری / مهمان', icon: '🌟', tagClass: 'role-tag--guest', desc: 'مشتری عادی، سفارش، رزرو، کیف پول و باشگاه وفاداری' },
      };

      const staffRoles = new Set(['owner', 'manager', 'accountant', 'cashier', 'waiter', 'kitchen']);
      const staffUsers = allUsers.filter((u) => staffRoles.has(u.role));
      const customerUsers = allUsers.filter((u) => !staffRoles.has(u.role));
      const adminsCount = allUsers.filter((u) => u.role === 'owner' || u.role === 'manager').length;
      const walletHoldersCount = customerUsers.filter((u) => Number(u.walletBalanceToman || 0) > 0).length;

      const formatBranchScope = (user) => {
        if (user.role === 'owner') return '<span class="branch-scope-badge">همه شعب (دسترسی کل)</span>';
        if (!user.allowedBranchIds || !user.allowedBranchIds.length) return '<span class="branch-scope-badge">همه شعب مجاز</span>';
        const names = user.allowedBranchIds.map((id) => branchMap[Number(id)] || `شعبه ${id}`).join('، ');
        return `<span class="branch-scope-badge" title="${esc(names)}">${esc(names)}</span>`;
      };

      main.innerHTML = `
        <div class="users-view-root">
          <div class="page-header" style="margin-bottom:0.25rem;">
            <div>
              <span class="eyebrow">سازماندهی دسترسی و پرسنل</span>
              <h1>کاربران، پرسنل و باشگاه مشتریان</h1>
              <p class="lead">مدیریت پرسنل ایستگاه‌ها (گارسون، صندوقدار، حسابدار و...)، اعضای باشگاه مشتریان و ماتریس اختیارات بخش‌های سامانه.</p>
            </div>
            <div class="header-actions">
              <button class="btn btn-primary" id="btn-quick-new-user" type="button">➕ افزودن کاربر یا پرسنل</button>
            </div>
          </div>

          <!-- Top Header Navigation Tabs -->
          <nav class="users-nav" aria-label="بخش‌های کاربران و دسترسی">
            <button class="users-nav-item ${activeSubTab === 'staff' ? 'is-active' : ''}" data-users-tab="staff" type="button">
              <span>👨‍🍳 پرسنل و کادر رستوران</span>
              <span class="users-nav-badge">${fmtNum(staffUsers.length)}</span>
            </button>
            <button class="users-nav-item ${activeSubTab === 'customers' ? 'is-active' : ''}" data-users-tab="customers" type="button">
              <span>🌟 مشتریان و باشگاه</span>
              <span class="users-nav-badge">${fmtNum(customerUsers.length)}</span>
            </button>
            <button class="users-nav-item ${activeSubTab === 'matrix' ? 'is-active' : ''}" data-users-tab="matrix" type="button">
              <span>🛡️ ماتریس دسترسی و اختیارات</span>
            </button>
            <button class="users-nav-item ${activeSubTab === 'new' ? 'is-active' : ''}" data-users-tab="new" type="button">
              <span>➕ تعریف کاربر جدید</span>
            </button>
          </nav>

          <!-- KPI Summary Strip -->
          <div class="users-kpi-grid">
            <div class="users-kpi-card kpi--staff">
              <span class="users-kpi-lbl">کادر فعال رستوران</span>
              <div class="users-kpi-val">${fmtNum(staffUsers.length)} <small style="font-size:0.85rem; font-weight:600; color:var(--v-muted);">نفر</small></div>
              <span class="users-kpi-sub">گارسون، صندوق، حسابدار، آشپزخانه و مدیر</span>
            </div>
            <div class="users-kpi-card kpi--customers">
              <span class="users-kpi-lbl">مشتریان باشگاه وفاداری</span>
              <div class="users-kpi-val">${fmtNum(customerUsers.length)} <small style="font-size:0.85rem; font-weight:600; color:var(--v-muted);">کاربر</small></div>
              <span class="users-kpi-sub">اعضای ثبت‌نام‌شده با شماره همراه</span>
            </div>
            <div class="users-kpi-card kpi--admins">
              <span class="users-kpi-lbl">مدیران و دسترسی‌های ارشد</span>
              <div class="users-kpi-val">${fmtNum(adminsCount)} <small style="font-size:0.85rem; font-weight:600; color:var(--v-muted);">نفر</small></div>
              <span class="users-kpi-sub">مالک مجموعه و مدیران داخلی</span>
            </div>
            <div class="users-kpi-card kpi--wallet">
              <span class="users-kpi-lbl">اعضای دارای کیف پول</span>
              <div class="users-kpi-val">${fmtNum(walletHoldersCount)} <small style="font-size:0.85rem; font-weight:600; color:var(--v-muted);">نفر</small></div>
              <span class="users-kpi-sub">دارای مانده اعتبار فعال</span>
            </div>
          </div>

          <!-- Dynamic Container -->
          <div id="users-tab-content"></div>
        </div>
      `;

      // Bind Top Header Tabs
      main.querySelectorAll('[data-users-tab]').forEach((btn) => {
        btn.addEventListener('click', () => tabs.users(btn.dataset.usersTab));
      });
      document.getElementById('btn-quick-new-user')?.addEventListener('click', () => tabs.users('new'));

      const container = document.getElementById('users-tab-content');

      // ─────────────────────────────────────────────────────────────
      // 1. SUBTAB: STAFF (پرسنل و کادر رستوران)
      // ─────────────────────────────────────────────────────────────
      if (activeSubTab === 'staff') {
        container.innerHTML = `
          <div class="users-toolbar">
            <div class="users-search-box">
              <input id="staff-search-input" class="users-search-input" placeholder="🔍 جستجوی پرسنل با نام، شماره یا نقش…" />
            </div>
            <div class="users-filter-pills" id="staff-role-pills">
              <button type="button" class="users-pill-btn is-active" data-staff-filter="all">همه پرسنل (${fmtNum(staffUsers.length)})</button>
              <button type="button" class="users-pill-btn" data-staff-filter="waiter">🤵 گارسون (${fmtNum(staffUsers.filter(u=>u.role==='waiter').length)})</button>
              <button type="button" class="users-pill-btn" data-staff-filter="cashier">💵 صندوقدار (${fmtNum(staffUsers.filter(u=>u.role==='cashier').length)})</button>
              <button type="button" class="users-pill-btn" data-staff-filter="accountant">💰 حسابدار (${fmtNum(staffUsers.filter(u=>u.role==='accountant').length)})</button>
              <button type="button" class="users-pill-btn" data-staff-filter="kitchen">🍳 آشپزخانه (${fmtNum(staffUsers.filter(u=>u.role==='kitchen').length)})</button>
              <button type="button" class="users-pill-btn" data-staff-filter="manager">🧑‍💼 مدیر (${fmtNum(staffUsers.filter(u=>u.role==='manager').length)})</button>
              <button type="button" class="users-pill-btn" data-staff-filter="owner">👑 مالک (${fmtNum(staffUsers.filter(u=>u.role==='owner').length)})</button>
            </div>
          </div>

          <div class="section-box" style="padding:0; overflow:hidden;">
            <div style="overflow-x:auto;">
              <table class="tbl" style="margin:0;">
                <thead>
                  <tr>
                    <th>پرسنل</th>
                    <th>نقش انتصابی</th>
                    <th>تخصیص شعب</th>
                    <th>وضعیت حساب</th>
                    <th>آخرین ورود</th>
                    <th>عملیات</th>
                  </tr>
                </thead>
                <tbody id="staff-table-body"></tbody>
              </table>
            </div>
          </div>
        `;

        let activeFilter = 'all';
        let searchQuery = '';

        const renderStaffTable = () => {
          const tbody = document.getElementById('staff-table-body');
          if (!tbody) return;

          const filtered = staffUsers.filter((u) => {
            if (activeFilter !== 'all' && u.role !== activeFilter) return false;
            if (searchQuery) {
              const q = searchQuery.toLowerCase();
              const matchPhone = (u.phone || '').includes(q);
              const matchName = (u.name || '').toLowerCase().includes(q);
              const matchRole = (roleDefs[u.role]?.label || '').toLowerCase().includes(q);
              if (!matchPhone && !matchName && !matchRole) return false;
            }
            return true;
          });

          if (!filtered.length) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:2.5rem; color:var(--v-muted);">پرسنلی با این مشخصات یافت نشد.</td></tr>`;
            return;
          }

          tbody.innerHTML = filtered.map((u) => {
            const roleMeta = roleDefs[u.role] || roleDefs.guest;
            const isOwnerUser = u.role === 'owner';
            const workspaceMap = {
              cashier: '/admin/cashier',
              waiter: '/admin/waiter',
              kitchen: '/admin/kitchen',
              accountant: '/admin?tab=accounting',
              manager: '/admin',
              owner: '/admin',
            };
            const rolePath = workspaceMap[u.role] || '/role-panel.html';

            return `
              <tr>
                <td>
                  <div style="display:flex; align-items:center; gap:0.65rem;">
                    <div style="width:36px; height:36px; border-radius:50%; background:var(--v-panel-muted); display:flex; align-items:center; justify-content:center; font-size:1.1rem; flex-shrink:0;">
                      ${roleMeta.icon}
                    </div>
                    <div>
                      <strong style="display:block; font-size:0.88rem; color:var(--v-ink);">${esc(u.name || 'بدون نام')}</strong>
                      <span class="hint ltr" style="font-size:0.78rem;">${esc(u.phone)}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <div style="display:flex; align-items:center; gap:0.4rem;">
                    <select class="input input-sm" data-change-role="${esc(u.phone)}" style="font-weight:600; font-size:0.8rem; width:auto;">
                      ${Object.entries(roleDefs).map(([rKey, rVal]) => `
                        <option value="${rKey}" ${u.role === rKey ? 'selected' : ''}>${rVal.icon} ${rVal.label}</option>
                      `).join('')}
                    </select>
                  </div>
                </td>
                <td>
                  <div style="display:flex; align-items:center; gap:0.4rem;">
                    ${formatBranchScope(u)}
                    ${!isOwnerUser ? `<button type="button" class="btn btn-xs btn-ghost" data-assign-branch="${esc(u.phone)}" title="تغییر شعبه">✏️</button>` : ''}
                  </div>
                </td>
                <td>
                  ${u.blocked 
                    ? '<span class="pill blocked" style="font-size:0.75rem;">⛔ مسدود</span>' 
                    : '<span class="pill" style="background:rgba(16,185,129,0.12); color:#059669; font-size:0.75rem;">🟢 فعال</span>'}
                </td>
                <td>
                  <span style="font-size:0.78rem; color:var(--v-muted);">${fmtDateTime(u.lastLoginAt || u.createdAt)}</span>
                </td>
                <td>
                  <div class="row-actions" style="gap:0.35rem;">
                    ${workspaceMap[u.role] ? `
                      <a href="${rolePath}" target="_blank" class="btn btn-xs btn-ghost" title="مشاهده پنل نقش">👁️ پنل نقش</a>
                    ` : ''}
                    <button class="btn btn-xs ${u.blocked ? 'btn-ghost' : 'btn-ghost'}" data-toggle-block="${esc(u.phone)}" data-val="${!u.blocked}">
                      ${u.blocked ? 'رفع مسدودی' : 'مسدودسازی'}
                    </button>
                    ${!isOwnerUser ? `<button class="btn btn-xs btn-danger" data-delete-user="${esc(u.phone)}">حذف</button>` : ''}
                  </div>
                </td>
              </tr>
            `;
          }).join('');

          // Bind Role Switchers
          tbody.querySelectorAll('[data-change-role]').forEach((sel) => {
            sel.addEventListener('change', async () => {
              const phone = sel.dataset.changeRole;
              const newRole = sel.value;
              try {
                await api(`/api/admin/users/${phone}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ role: newRole }),
                });
                showToast(`نقش کاربر ${phone} به «${roleDefs[newRole]?.label || newRole}» تغییر یافت.`);
                tabs.users('staff');
              } catch (err) {
                showToast(err.message || 'خطا در تغییر نقش');
              }
            });
          });

          // Bind Branch Assignment
          tbody.querySelectorAll('[data-assign-branch]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const phone = btn.dataset.assignBranch;
              const user = staffUsers.find((x) => x.phone === phone);
              if (!user) return;
              renderBranchAssignModal(user, allBranches);
            });
          });

          // Bind Toggle Block
          tbody.querySelectorAll('[data-toggle-block]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const phone = btn.dataset.toggleBlock;
              const blocked = btn.dataset.val === 'true';
              try {
                await api(`/api/admin/users/${phone}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ blocked }),
                });
                showToast(blocked ? 'کاربر مسدود شد' : 'رفع مسدودی انجام شد');
                tabs.users('staff');
              } catch (err) {
                showToast(err.message || 'خطا در تغییر وضعیت کاربر');
              }
            });
          });

          // Bind Delete
          tbody.querySelectorAll('[data-delete-user]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const phone = btn.dataset.deleteUser;
              if (!confirm(`آیا از حذف حساب پرسنل ${phone} اطمینان دارید؟`)) return;
              try {
                await api(`/api/admin/users/${phone}`, { method: 'DELETE' });
                showToast('کاربر حذف شد');
                tabs.users('staff');
              } catch (err) {
                showToast(err.message || 'خطا در حذف کاربر');
              }
            });
          });
        };

        renderStaffTable();

        document.getElementById('staff-search-input')?.addEventListener('input', (e) => {
          searchQuery = e.target.value.trim();
          renderStaffTable();
        });

        document.getElementById('staff-role-pills')?.querySelectorAll('[data-staff-filter]').forEach((pill) => {
          pill.addEventListener('click', () => {
            document.getElementById('staff-role-pills').querySelectorAll('[data-staff-filter]').forEach((p) => p.classList.remove('is-active'));
            pill.classList.add('is-active');
            activeFilter = pill.dataset.staffFilter;
            renderStaffTable();
          });
        });
      }

      // ─────────────────────────────────────────────────────────────
      // 2. SUBTAB: CUSTOMERS (مشتریان و باشگاه)
      // ─────────────────────────────────────────────────────────────
      else if (activeSubTab === 'customers') {
        container.innerHTML = `
          <div class="users-toolbar">
            <div class="users-search-box">
              <input id="cust-search-input" class="users-search-input" placeholder="🔍 جستجوی مشتری با نام یا شماره همراه…" />
            </div>
            <div class="users-filter-pills" id="cust-tier-pills">
              <button type="button" class="users-pill-btn is-active" data-cust-filter="all">همه مشتریان (${fmtNum(customerUsers.length)})</button>
              <button type="button" class="users-pill-btn" data-cust-filter="wallet">💳 دارای کیف پول (${fmtNum(walletHoldersCount)})</button>
              <button type="button" class="users-pill-btn" data-cust-filter="bronze">🥉 برنزی</button>
              <button type="button" class="users-pill-btn" data-cust-filter="silver">🥈 نقره‌ای</button>
              <button type="button" class="users-pill-btn" data-cust-filter="gold">🥇 طلایی</button>
              <button type="button" class="users-pill-btn" data-cust-filter="diamond">💎 VIP</button>
            </div>
          </div>

          <div class="section-box" style="padding:0; overflow:hidden;">
            <div style="overflow-x:auto;">
              <table class="tbl" style="margin:0;">
                <thead>
                  <tr>
                    <th>مشتری</th>
                    <th>سطح وفاداری</th>
                    <th>امتیاز باشگاه</th>
                    <th>موجودی کیف پول</th>
                    <th>سفارش‌ها / خرید</th>
                    <th>آخرین فعالیت</th>
                    <th>عملیات</th>
                  </tr>
                </thead>
                <tbody id="customers-table-body"></tbody>
              </table>
            </div>
          </div>
        `;

        let activeCustFilter = 'all';
        let custSearchQuery = '';

        const renderCustTable = () => {
          const tbody = document.getElementById('customers-table-body');
          if (!tbody) return;

          const filtered = customerUsers.filter((u) => {
            const tierId = u.tier?.id || 'bronze';
            if (activeCustFilter === 'wallet' && !(Number(u.walletBalanceToman || 0) > 0)) return false;
            if (activeCustFilter !== 'all' && activeCustFilter !== 'wallet' && tierId !== activeCustFilter) return false;
            if (custSearchQuery) {
              const q = custSearchQuery.toLowerCase();
              const matchPhone = (u.phone || '').includes(q);
              const matchName = (u.name || '').toLowerCase().includes(q);
              if (!matchPhone && !matchName) return false;
            }
            return true;
          });

          if (!filtered.length) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2.5rem; color:var(--v-muted);">مشتری با این فیلتر یافت نشد.</td></tr>`;
            return;
          }

          tbody.innerHTML = filtered.map((u) => {
            const t = u.tier || { name: 'برنزی', badgeIcon: '🥉', id: 'bronze' };
            const walletToman = Number(u.walletBalanceToman || 0);

            return `
              <tr>
                <td>
                  <div style="display:flex; align-items:center; gap:0.65rem;">
                    <div style="width:36px; height:36px; border-radius:50%; background:rgba(56,189,248,0.1); color:#0284c7; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:0.88rem; flex-shrink:0;">
                      ${esc((u.name || 'م')[0])}
                    </div>
                    <div>
                      <strong style="display:block; font-size:0.88rem; color:var(--v-ink);">${esc(u.name || 'مشتری بدون نام')}</strong>
                      <span class="hint ltr" style="font-size:0.78rem;">${esc(u.phone)}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <span class="tier-badge tier-badge-${esc(t.id || 'bronze')}" style="display:inline-flex; align-items:center; gap:0.35rem; font-size:0.78rem;">
                    ${esc(t.badgeIcon || '🥉')} ${esc(t.name || 'برنزی')}
                  </span>
                </td>
                <td>
                  <div style="display:flex; align-items:center; gap:0.4rem;">
                    <strong style="font-size:0.86rem; color:#7357ce;">${fmtNum(u.points || 0)}</strong>
                    <button type="button" class="btn btn-xs btn-ghost" data-adjust-points="${esc(u.phone)}" data-curr-pts="${u.points || 0}" title="تنظیم امتیاز">✏️</button>
                  </div>
                </td>
                <td>
                  <strong style="font-size:0.86rem; color:${walletToman > 0 ? '#10b981' : 'var(--v-muted)'};">
                    ${walletToman > 0 ? fmtMoney(walletToman) : '۰ تومان'}
                  </strong>
                </td>
                <td>
                  <span style="font-size:0.8rem;">${fmtNum(u.ordersCount || 0)} سفارش</span>
                  ${u.totalSpendToman ? `<small style="display:block; color:var(--v-muted); font-size:0.72rem;">${fmtMoney(u.totalSpendToman)}</small>` : ''}
                </td>
                <td>
                  <span style="font-size:0.78rem; color:var(--v-muted);">${fmtDateTime(u.lastLoginAt || u.createdAt)}</span>
                </td>
                <td>
                  <div class="row-actions" style="gap:0.35rem;">
                    <button class="btn btn-xs btn-primary" data-open-dossier="${esc(u.phone)}">📋 پرونده</button>
                    <button class="btn btn-xs btn-ghost" data-promote-staff="${esc(u.phone)}" title="تبدیل به پرسنل">👔 پرسنل</button>
                    <button class="btn btn-xs btn-ghost" data-toggle-block="${esc(u.phone)}" data-val="${!u.blocked}">
                      ${u.blocked ? 'رفع مسدودی' : 'مسدودسازی'}
                    </button>
                    <button class="btn btn-xs btn-danger" data-delete-user="${esc(u.phone)}">حذف</button>
                  </div>
                </td>
              </tr>
            `;
          }).join('');

          // Open Dossier
          tbody.querySelectorAll('[data-open-dossier]').forEach((btn) => {
            btn.addEventListener('click', () => {
              if (typeof tabs.club === 'function') {
                tabs.club('customers');
              }
            });
          });

          // Promote to Staff
          tbody.querySelectorAll('[data-promote-staff]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const phone = btn.dataset.promoteStaff;
              const newRole = prompt(`نقش پرسنلی برای ${phone} را انتخاب کنید:\n(waiter=گارسون, cashier=صندوقدار, accountant=حسابدار, kitchen=آشپزخانه, manager=مدیر)`, 'waiter');
              if (!newRole) return;
              try {
                await api(`/api/admin/users/${phone}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ role: newRole.trim() }),
                });
                showToast(`کاربر با موفقیت به کادر پرسنلی اضافه شد.`);
                tabs.users('staff');
              } catch (err) {
                showToast(err.message || 'خطا در تبدیل نقش');
              }
            });
          });

          // Adjust Points
          tbody.querySelectorAll('[data-adjust-points]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const phone = btn.dataset.adjustPoints;
              const current = Number(btn.dataset.currPts || 0);
              const val = prompt(`امتیاز جدید برای مشتری ${phone}:`, current);
              if (val === null) return;
              const newPoints = parseInputNumber(val);
              if (newPoints == null || Number.isNaN(newPoints) || newPoints < 0) {
                showToast('امتیاز باید یک عدد معتبر باشد.');
                return;
              }
              try {
                await api(`/api/admin/users/${phone}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ points: newPoints }),
                });
                showToast('امتیاز به‌روزرسانی شد');
                tabs.users('customers');
              } catch (err) {
                showToast(err.message || 'خطا در ثبت امتیاز');
              }
            });
          });

          // Toggle Block
          tbody.querySelectorAll('[data-toggle-block]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const phone = btn.dataset.toggleBlock;
              const blocked = btn.dataset.val === 'true';
              try {
                await api(`/api/admin/users/${phone}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ blocked }),
                });
                showToast(blocked ? 'مشتری مسدود شد' : 'رفع مسدودی انجام شد');
                tabs.users('customers');
              } catch (err) {
                showToast(err.message || 'خطا در تغییر وضعیت');
              }
            });
          });

          // Delete
          tbody.querySelectorAll('[data-delete-user]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const phone = btn.dataset.deleteUser;
              if (!confirm(`آیا از حذف حساب مشتری ${phone} اطمینان دارید؟`)) return;
              try {
                await api(`/api/admin/users/${phone}`, { method: 'DELETE' });
                showToast('مشتری حذف شد');
                tabs.users('customers');
              } catch (err) {
                showToast(err.message || 'خطا در حذف');
              }
            });
          });
        };

        renderCustTable();

        document.getElementById('cust-search-input')?.addEventListener('input', (e) => {
          custSearchQuery = e.target.value.trim();
          renderCustTable();
        });

        document.getElementById('cust-tier-pills')?.querySelectorAll('[data-cust-filter]').forEach((pill) => {
          pill.addEventListener('click', () => {
            document.getElementById('cust-tier-pills').querySelectorAll('[data-cust-filter]').forEach((p) => p.classList.remove('is-active'));
            pill.classList.add('is-active');
            activeCustFilter = pill.dataset.custFilter;
            renderCustTable();
          });
        });
      }

      // ─────────────────────────────────────────────────────────────
      // 3. SUBTAB: MATRIX (ماتریس دسترسی‌ها و اختیارات نقش‌ها)
      // ─────────────────────────────────────────────────────────────
      else if (activeSubTab === 'matrix') {
        const matrixSections = matrixData?.sections || [
          { id: 'orders', title: 'سفارش‌ها و صندوق', description: 'ثبت، تسویه فاکتور و مشاهده سفارش‌ها', roles: { owner: 'full', manager: 'full', cashier: 'full', waiter: 'create_view', kitchen: 'none', accountant: 'none', guest: 'self_only' } },
          { id: 'kitchen', title: 'صف آشپزخانه (KDS)', description: 'کارت‌های پخت و اعلام وضعیت آماده', roles: { owner: 'full', manager: 'full', kitchen: 'full', cashier: 'none', waiter: 'none', accountant: 'none', guest: 'none' } },
          { id: 'tables', title: 'میزها و سالن', description: 'نقشه میزها و فراخوانی گارسون', roles: { owner: 'full', manager: 'full', waiter: 'full', cashier: 'full', kitchen: 'none', accountant: 'none', guest: 'call_only' } },
          { id: 'finance', title: 'مالی و حسابداری', description: 'اسناد دوبل، ترازنامه، سودوزیان', roles: { owner: 'full', manager: 'full', accountant: 'full', cashier: 'cash_only', waiter: 'none', kitchen: 'none', guest: 'none' } },
          { id: 'inventory', title: 'انبار و مواد اولیه', description: 'موجودی، رسید ورود کالا و حواله مصرف', roles: { owner: 'full', manager: 'full', accountant: 'view_only', kitchen: 'operations_only', cashier: 'none', waiter: 'none', guest: 'none' } },
          { id: 'menu', title: 'منو و محصولات', description: 'ویرایش غذاها و قیمت‌گذاری منو', roles: { owner: 'full', manager: 'full', accountant: 'none', cashier: 'none', waiter: 'none', kitchen: 'none', guest: 'none' } },
          { id: 'reports', title: 'گزارش‌های فروش و آمار', description: 'آمار فروش، سودآوری و ترافیک مهمان', roles: { owner: 'full', manager: 'full', accountant: 'full', cashier: 'none', waiter: 'none', kitchen: 'none', guest: 'none' } },
          { id: 'club', title: 'باشگاه مشتریان و پیامک', description: 'اعضای باشگاه، کیف پول، سطوح و SMS', roles: { owner: 'full', manager: 'full', accountant: 'none', cashier: 'none', waiter: 'none', kitchen: 'none', guest: 'profile_only' } },
          { id: 'settings', title: 'تنظیمات و دسترسی کاربران', description: 'تغییر نقش، تعریف پرسنل و شعب', roles: { owner: 'full', manager: 'view_manage', accountant: 'none', cashier: 'none', waiter: 'none', kitchen: 'none', guest: 'none' } },
        ];

        const permBadge = (status) => {
          if (status === 'full') return '<span class="perm-indicator perm-full">🟢 کامل</span>';
          if (status === 'none') return '<span class="perm-indicator perm-none">🔴 عدم دسترسی</span>';
          if (status === 'create_view') return '<span class="perm-indicator perm-partial">🟡 ثبت و مشاهده</span>';
          if (status === 'view_only') return '<span class="perm-indicator perm-partial">🟡 فقط مشاهده</span>';
          if (status === 'cash_only') return '<span class="perm-indicator perm-partial">🟡 فقط نقد و پوز</span>';
          if (status === 'operations_only') return '<span class="perm-indicator perm-partial">🟡 حواله مصرف</span>';
          if (status === 'view_manage') return '<span class="perm-indicator perm-partial">🟡 مشاهده و ویرایش</span>';
          if (status === 'call_only') return '<span class="perm-indicator perm-partial">🟡 درخواست سرویس</span>';
          if (status === 'self_only') return '<span class="perm-indicator perm-partial">🟡 سفارش شخصی</span>';
          if (status === 'profile_only') return '<span class="perm-indicator perm-partial">🟡 صفحه پروفایل</span>';
          return `<span class="perm-indicator perm-partial">🟡 ${esc(status)}</span>`;
        };

        container.innerHTML = `
          <div class="role-matrix-section">
            <div class="section-box">
              <h2>ایستگاه‌ها و فضاهای کاری پرسنل</h2>
              <p class="lead">هر نقش کاری در سامانه وستو دارای رابط کاربری ایزوله و اختصاصی است تا تداخلی میان عملیات سالن، آشپزخانه و حسابداری ایجاد نشود.</p>
              
              <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:1rem; margin-top:1rem;">
                <div class="role-matrix-card">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                    <strong>🤵 گارسون (سالن‌کار)</strong>
                    <span class="role-tag role-tag--waiter">Waiter</span>
                  </div>
                  <p style="font-size:0.8rem; color:var(--v-muted); margin-bottom:0.75rem;">سفارش‌گیری سر میز با تبلت، مشاهده وضعیت میزها و دریافت اعلان‌های فراخوانی مهمان.</p>
                  <a href="/admin/waiter" target="_blank" class="btn btn-sm btn-ghost" style="width:100%; justify-content:center;">ورود به پنل گارسون ↗</a>
                </div>

                <div class="role-matrix-card">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                    <strong>💵 صندوقدار (POS)</strong>
                    <span class="role-tag role-tag--cashier">Cashier</span>
                  </div>
                  <p style="font-size:0.8rem; color:var(--v-muted); margin-bottom:0.75rem;">تسویه سفارش‌های حضوری و آنلاین، مدیریت کارت‌خوان و صندوق نقدی، وضعیت ارسال و پیک.</p>
                  <a href="/admin/cashier" target="_blank" class="btn btn-sm btn-ghost" style="width:100%; justify-content:center;">ورود به پنل صندوقدار ↗</a>
                </div>

                <div class="role-matrix-card">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                    <strong>🍳 آشپزخانه (KDS)</strong>
                    <span class="role-tag role-tag--kitchen">Kitchen</span>
                  </div>
                  <p style="font-size:0.8rem; color:var(--v-muted); margin-bottom:0.75rem;">صف کارت‌های پخت زنده، دکمه‌های شروع آماده‌سازی و تغییر وضعیت به آماده با میانبرهای کیبورد.</p>
                  <a href="/admin/kitchen" target="_blank" class="btn btn-sm btn-ghost" style="width:100%; justify-content:center;">ورود به پنل آشپزخانه ↗</a>
                </div>

                <div class="role-matrix-card">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                    <strong>💰 حسابدار (Finance)</strong>
                    <span class="role-tag role-tag--accountant">Accountant</span>
                  </div>
                  <p style="font-size:0.8rem; color:var(--v-muted); margin-bottom:0.75rem;">اسناد حسابداری دوبل، تراز آزمایشی، صورت‌های مالی، بهای تمام‌شده و مغایرت‌گیری بانکی.</p>
                  <button type="button" class="btn btn-sm btn-ghost" id="btn-go-accounting" style="width:100%; justify-content:center;">ورود به کارتابل حسابداری ↗</button>
                </div>
              </div>
            </div>

            <!-- Full Capability Matrix Table -->
            <div class="section-box" style="padding:0; overflow:hidden;">
              <div style="padding:1.25rem 1.25rem 0.5rem 1.25rem;">
                <h2>ماتریس دسترسی به بخش‌های نرم‌افزار</h2>
                <p class="lead">سطح دسترسی هر نقش به ماژول‌های مختلف بر اساس اصل کمترین دسترسی لازم (Least Privilege) تنظیم شده است.</p>
              </div>
              <div style="overflow-x:auto;">
                <table class="role-matrix-table" style="margin:0;">
                  <thead>
                    <tr>
                      <th style="min-width:200px;">بخش نرم‌افزار</th>
                      <th>👑 مالک</th>
                      <th>🧑‍💼 مدیر</th>
                      <th>💰 حسابدار</th>
                      <th>💵 صندوقدار</th>
                      <th>🤵 گارسون</th>
                      <th>🍳 آشپزخانه</th>
                      <th>🌟 مشتری</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${matrixSections.map((sec) => `
                      <tr>
                        <td>
                          <strong style="display:block; font-size:0.88rem; color:var(--v-ink);">${esc(sec.title)}</strong>
                          <span style="font-size:0.75rem; color:var(--v-muted);">${esc(sec.description)}</span>
                        </td>
                        <td>${permBadge(sec.roles.owner)}</td>
                        <td>${permBadge(sec.roles.manager)}</td>
                        <td>${permBadge(sec.roles.accountant)}</td>
                        <td>${permBadge(sec.roles.cashier)}</td>
                        <td>${permBadge(sec.roles.waiter)}</td>
                        <td>${permBadge(sec.roles.kitchen)}</td>
                        <td>${permBadge(sec.roles.guest)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `;

        document.getElementById('btn-go-accounting')?.addEventListener('click', () => {
          if (typeof tabs.accounting === 'function') tabs.accounting();
        });
      }

      // ─────────────────────────────────────────────────────────────
      // 4. SUBTAB: NEW USER (افزودن کاربر یا پرسنل جدید)
      // ─────────────────────────────────────────────────────────────
      else if (activeSubTab === 'new') {
        container.innerHTML = `
          <div class="section-box" style="max-width:720px; margin:0 auto;">
            <h2>تعریف کاربر یا پرسنل جدید</h2>
            <p class="lead">ثبت شماره همراه، نام و تعیین سطح دسترسی (مشتری باشگاه، گارسون، صندوقدار، حسابدار، مدیر و...).</p>

            <form id="form-create-new-user" class="user-add-sheet" style="margin-top:1.25rem;">
              <div class="user-add-grid">
                <div class="field">
                  <label for="nu-phone">شماره موبایل <span style="color:#ef4444;">*</span></label>
                  <input type="tel" id="nu-phone" class="input ltr" placeholder="09123456789" required maxlength="11" />
                  <span class="hint">شماره همراه ۱۱ رقمی استاندارد</span>
                </div>

                <div class="field">
                  <label for="nu-name">نام و نام خانوادگی <span style="color:#ef4444;">*</span></label>
                  <input type="text" id="nu-name" class="input" placeholder="مثال: علی احمدی" required />
                </div>
              </div>

              <div class="user-add-grid">
                <div class="field">
                  <label for="nu-role">نقش و سطح دسترسی <span style="color:#ef4444;">*</span></label>
                  <select id="nu-role" class="input" style="font-weight:600;">
                    <optgroup label="کادر پرسنل رستوران">
                      <option value="waiter">🤵 گارسون (سالن‌کار)</option>
                      <option value="cashier">💵 صندوقدار (صندوق و تحویل)</option>
                      <option value="accountant">💰 حسابدار (مدیریت مالی)</option>
                      <option value="kitchen">🍳 آشپزخانه (KDS)</option>
                      <option value="manager">🧑‍💼 مدیر داخلی (عملیات و پرسنل)</option>
                      <option value="owner">👑 مالک (دسترسی نامحدود)</option>
                    </optgroup>
                    <optgroup label="مشتریان">
                      <option value="guest" selected>🌟 مشتری / عضو باشگاه وفاداری</option>
                    </optgroup>
                  </select>
                </div>

                <div class="field" id="nu-branch-wrap">
                  <label for="nu-branch">تخصیص شعبه</label>
                  <select id="nu-branch" class="input">
                    <option value="">همه شعب مجاز</option>
                    ${allBranches.map((b) => `<option value="${b.id}">${esc(b.name || `شعبه ${b.id}`)}</option>`).join('')}
                  </select>
                  <span class="hint">برای پرسنل محدود به یک شعبه مشخص</span>
                </div>
              </div>

              <div class="user-add-grid">
                <div class="field">
                  <label for="nu-points">امتیاز اولیه باشگاه</label>
                  <input type="number" id="nu-points" class="input ltr" placeholder="0" value="0" min="0" />
                </div>

                <div class="field">
                  <label for="nu-email">پست الکترونیک (اختیاری)</label>
                  <input type="email" id="nu-email" class="input ltr" placeholder="name@example.com" />
                </div>
              </div>

              <div class="field">
                <label for="nu-notes">یادداشت پرسنلی / توضیحات</label>
                <textarea id="nu-notes" class="input" rows="2" placeholder="توضیحات تکمیلی درباره کاربر یا پرسنل…"></textarea>
              </div>

              <div style="display:flex; justify-content:flex-end; gap:0.75rem; margin-top:0.5rem;">
                <button type="button" class="btn btn-ghost" id="nu-cancel-btn">انصراف</button>
                <button type="submit" class="btn btn-primary" id="nu-submit-btn">ثبت و ایجاد کاربر</button>
              </div>
            </form>
          </div>
        `;

        document.getElementById('nu-cancel-btn')?.addEventListener('click', () => tabs.users('staff'));

        document.getElementById('form-create-new-user')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const phone = normalizeDigits(document.getElementById('nu-phone')?.value || '').trim();
          const name = document.getElementById('nu-name')?.value.trim() || '';
          const role = document.getElementById('nu-role')?.value || 'guest';
          const branchId = document.getElementById('nu-branch')?.value || null;
          const points = parseInputNumber(document.getElementById('nu-points')?.value) || 0;
          const email = document.getElementById('nu-email')?.value.trim() || '';
          const notes = document.getElementById('nu-notes')?.value.trim() || '';

          const submitBtn = document.getElementById('nu-submit-btn');
          submitBtn.disabled = true;
          submitBtn.textContent = 'در حال ثبت…';

          try {
            await api('/api/admin/users', {
              method: 'POST',
              body: JSON.stringify({
                phone,
                name,
                role,
                branchId: branchId || null,
                points,
                email,
                notes,
              }),
            });
            showToast(`کاربر «${name}» با نقش «${roleDefs[role]?.label || role}» با موفقیت اضافه شد.`);
            tabs.users(staffRoles.has(role) ? 'staff' : 'customers');
          } catch (err) {
            showToast(err.message || 'خطا در ثبت کاربر');
            submitBtn.disabled = false;
            submitBtn.textContent = 'ثبت و ایجاد کاربر';
          }
        });
      }

      // ─────────────────────────────────────────────────────────────
      // Helper Modal: Branch Allocation
      // ─────────────────────────────────────────────────────────────
      function renderBranchAssignModal(user, branches) {
        let modal = document.getElementById('branch-assign-modal');
        if (!modal) {
          modal = document.createElement('div');
          modal.id = 'branch-assign-modal';
          modal.className = 'dossier-modal-overlay';
          document.body.appendChild(modal);
        }

        const userBranches = Array.isArray(user.allowedBranchIds) ? user.allowedBranchIds : [];
        const isAll = user.allowedBranchIds === null;

        modal.innerHTML = `
          <div class="dossier-modal-box" style="max-width:440px;" role="dialog" aria-modal="true">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--v-line); padding-bottom:0.6rem; margin-bottom:0.85rem;">
              <div>
                <h3 style="margin:0; font-size:1.05rem;">تخصیص شعب به ${esc(user.name || user.phone)}</h3>
                <span class="hint" style="font-size:0.78rem;">نقش: ${esc(roleDefs[user.role]?.label || user.role)}</span>
              </div>
              <button class="btn btn-sm btn-ghost" id="ba-close-btn" type="button">✕</button>
            </div>

            <form id="ba-form">
              <div style="margin-bottom:0.85rem;">
                <label style="display:flex; align-items:center; gap:0.5rem; font-weight:700; cursor:pointer; margin-bottom:0.65rem;">
                  <input type="radio" name="ba-scope" value="all" ${isAll ? 'checked' : ''} />
                  <span>دسترسی به همه شعب</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.5rem; font-weight:700; cursor:pointer;">
                  <input type="radio" name="ba-scope" value="specific" ${!isAll ? 'checked' : ''} />
                  <span>دسترسی فقط به شعب مشخص‌شده:</span>
                </label>
              </div>

              <div id="ba-branches-list" style="display:flex; flex-direction:column; gap:0.4rem; padding-right:1.25rem; margin-bottom:1.25rem;">
                ${branches.map((b) => `
                  <label style="display:flex; align-items:center; gap:0.45rem; font-size:0.85rem; cursor:pointer;">
                    <input type="checkbox" class="ba-branch-chk" value="${b.id}" ${userBranches.includes(Number(b.id)) ? 'checked' : ''} />
                    <span>${esc(b.name || `شعبه ${b.id}`)}</span>
                  </label>
                `).join('')}
              </div>

              <div style="display:flex; justify-content:flex-end; gap:0.5rem;">
                <button type="button" class="btn btn-sm btn-ghost" id="ba-cancel">انصراف</button>
                <button type="submit" class="btn btn-sm btn-primary">ذخیره تغییرات</button>
              </div>
            </form>
          </div>
        `;

        modal.querySelector('#ba-close-btn').addEventListener('click', () => modal.remove());
        modal.querySelector('#ba-cancel').addEventListener('click', () => modal.remove());

        modal.querySelector('#ba-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const scope = modal.querySelector('input[name="ba-scope"]:checked').value;
          let allowedBranchIds = null;
          if (scope === 'specific') {
            allowedBranchIds = Array.from(modal.querySelectorAll('.ba-branch-chk:checked')).map((c) => Number(c.value));
          }
          try {
            await api(`/api/admin/users/${user.phone}`, {
              method: 'PATCH',
              body: JSON.stringify({ allowedBranchIds }),
            });
            showToast('تخصیص شعب با موفقیت ذخیره شد');
            modal.remove();
            tabs.users('staff');
          } catch (err) {
            showToast(err.message || 'خطا در ذخیره شعب');
          }
        });
      }
    },

    async club(activeSubTab = 'customers') {
      setActiveTab('club');
      const segment = (customer) => customer.tier?.name || (customer.total >= 5000000 ? 'ویژه' : 'وفادار');
      const tierBadge = (cust) => {
        const t = cust.tier || { id: 'bronze', name: 'برنزی', badgeIcon: '🥉' };
        return `<span class="tier-badge tier-badge-${t.id || 'bronze'}">${esc(t.badgeIcon || '🥉')} ${esc(t.name || segment(cust))}</span>`;
      };

      const renderNav = (subTab) => `
        <nav class="club-nav" aria-label="باشگاه مشتریان">
          <button class="club-nav-item ${subTab === 'customers' ? 'is-active' : ''}" data-club-subtab="customers" type="button">مشتریان</button>
          <button class="club-nav-item ${subTab === 'wallet' ? 'is-active' : ''}" data-club-subtab="wallet" type="button">کیف پول</button>
          <button class="club-nav-item ${subTab === 'campaigns' ? 'is-active' : ''}" data-club-subtab="campaigns" type="button">کمپین‌ها</button>
          <button class="club-nav-item ${subTab === 'sms' ? 'is-active' : ''}" data-club-subtab="sms" type="button">پیامک</button>
          <button class="club-nav-item ${subTab === 'loyalty' ? 'is-active' : ''}" data-club-subtab="loyalty" type="button">سطوح</button>
          <button class="club-nav-item" data-club-subtab="staff" type="button" style="color:#0284c7;">👨‍🍳 پرسنل و دسترسی‌ها</button>
        </nav>
      `;

      const bindNav = () => {
        main.querySelectorAll('[data-club-subtab]').forEach((btn) => {
          btn.addEventListener('click', () => {
            if (btn.dataset.clubSubtab === 'staff') {
              tabs.users('staff');
            } else {
              tabs.club(btn.dataset.clubSubtab);
            }
          });
        });
      };

      const renderDossierModal = async (phone) => {
        try {
          const [custData, fullLoyalty, walletSummary] = await Promise.all([
            api(`/api/loyalty/customer?phone=${encodeURIComponent(phone)}`).catch(() => ({})),
            api('/api/admin/loyalty').catch(() => ({})),
            api('/api/admin/wallet/summary').catch(() => ({})),
          ]);
          const userPointsLedger = (fullLoyalty.ledger || []).filter((e) => e.phone === phone);
          const userWalletLedger = (walletSummary.recentTransactions || []).filter((e) => e.phone === phone);

          let modalEl = document.getElementById('customer-dossier-modal');
          if (!modalEl) {
            modalEl = document.createElement('div');
            modalEl.id = 'customer-dossier-modal';
            modalEl.className = 'dossier-modal-overlay';
            document.body.appendChild(modalEl);
          }

          const tier = custData.tier || { name: 'برنزی', badgeIcon: '🥉', id: 'bronze', multiplier: 1.0, discountPct: 1 };

          modalEl.innerHTML = `
            <div class="dossier-modal-box" role="dialog" aria-modal="true" aria-labelledby="dossier-title">
              <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:0.6rem; margin-bottom:0.85rem;">
                <div>
                  <h2 id="dossier-title" style="margin:0; font-size:1.05rem;">پرونده: ${esc(custData.name || 'مشتری')}</h2>
                  <div class="hint ltr" style="margin-top:0.15rem; font-size:0.8rem;">${esc(custData.phone || phone)} · ${esc(tier.badgeIcon || '🥉')} ${esc(tier.name || 'برنزی')}</div>
                </div>
                <button class="btn btn-sm btn-ghost" id="dossier-close-btn" type="button">✕ بستن</button>
              </div>

              <div class="club-kpi-strip" style="margin-bottom:0.85rem;">
                <div class="club-kpi accent"><div class="num">${fmtMoney(custData.walletBalanceToman || 0)}</div><div class="lbl">موجودی کیف پول</div></div>
                <div class="club-kpi"><div class="num">${fmtNum(custData.points || 0)}</div><div class="lbl">امتیاز باشگاه</div></div>
                <div class="club-kpi"><div class="num">${fmtNum(tier.multiplier || 1)}x</div><div class="lbl">ضریب پاداش</div></div>
                <div class="club-kpi"><div class="num">${fmtNum(tier.discountPct || 0)}٪</div><div class="lbl">تخفیف فاکتور</div></div>
              </div>

              <div class="grid-2-main" style="gap:0.75rem; margin-bottom:0.85rem;">
                <div class="section-box club-section" style="margin:0; padding:0.75rem;">
                  <h3 style="font-size:0.85rem; margin-bottom:0.4rem;">تعدیل امتیاز</h3>
                  <div class="club-form-row" style="grid-template-columns: 90px 1fr auto; gap:0.4rem;">
                    <input type="number" id="dossier-delta" class="input ltr" placeholder="مقدار" value="50" style="font-size:0.8rem;" />
                    <input type="text" id="dossier-reason" class="input" placeholder="شرح" value="پاداش وفاداری" style="font-size:0.8rem;" />
                    <button class="btn btn-sm" id="dossier-adjust-btn" type="button">ثبت</button>
                  </div>
                </div>

                <div class="section-box club-section" style="margin:0; padding:0.75rem;">
                  <h3 style="font-size:0.85rem; margin-bottom:0.4rem;">شارژ / کسر کیف پول</h3>
                  <div class="club-form-row" style="grid-template-columns: 110px 1fr auto; gap:0.4rem;">
                    <input type="number" id="dossier-wallet-delta" class="input ltr" placeholder="مبلغ (ت)" value="100000" style="font-size:0.8rem;" />
                    <input type="text" id="dossier-wallet-reason" class="input" placeholder="شرح" value="شارژ دستی" style="font-size:0.8rem;" />
                    <button class="btn btn-sm btn-accent" id="dossier-wallet-btn" type="button">اعمال</button>
                  </div>
                </div>
              </div>

              <!-- Admin Birthdate Override Section -->
              <div class="section-box club-section" style="margin:0 0 0.85rem 0; padding:0.75rem;">
                <h3 style="font-size:0.85rem; margin-bottom:0.4rem;">🎂 تاریخ تولد مشتری (ویرایش ویژه مدیر)</h3>
                <div class="club-form-row" style="grid-template-columns: 1fr auto; gap:0.4rem;">
                  <input type="text" id="dossier-bday" class="input ltr" placeholder="مثلاً: 1370/06/15" value="${esc(custData.birthdate || '')}" style="font-size:0.8rem;" />
                  <button class="btn btn-sm" id="dossier-save-bday-btn" type="button">ثبت تاریخ تولد</button>
                </div>
              </div>

              <div>
                <h3 style="font-size:0.85rem; margin-bottom:0.4rem;">آخرین تراکنش‌های کیف پول</h3>
                <div style="overflow-x:auto;">
                  <table class="tbl" style="font-size:0.78rem;">
                    <thead><tr><th>زمان</th><th>نوع</th><th>تغییر (ت)</th><th>شرح</th></tr></thead>
                    <tbody>
                      ${userWalletLedger.slice(0, 5).map((e) => `
                        <tr>
                          <td>${fmtDateTime(e.at)}</td>
                          <td><span class="pill">${esc(e.type === 'topup' ? 'شارژ' : e.type === 'pay' ? 'خرید' : e.type === 'cashback' ? 'پاداش نقدی' : e.type || 'تراکنش')}</span></td>
                          <td style="color:${e.deltaToman > 0 ? '#10b981' : '#ef4444'}; font-weight:700;">${e.deltaToman > 0 ? '+' : ''}${fmtMoney(e.deltaToman)}</td>
                          <td>${esc(e.description || '—')}</td>
                        </tr>
                      `).join('') || '<tr><td colspan="4">تراکنشی ثبت نشده است.</td></tr>'}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          `;

          modalEl.querySelector('#dossier-close-btn').addEventListener('click', () => modalEl.remove());
          modalEl.querySelector('#dossier-adjust-btn').addEventListener('click', async () => {
            const delta = Number(modalEl.querySelector('#dossier-delta').value) || 0;
            const reason = modalEl.querySelector('#dossier-reason').value || 'تعدیل دستی';
            await api('/api/admin/loyalty/adjust', { method: 'POST', body: JSON.stringify({ phone, delta, reason }) });
            showToast('امتیاز با موفقیت اعمال شد'); renderDossierModal(phone);
          });
          modalEl.querySelector('#dossier-wallet-btn').addEventListener('click', async () => {
            const deltaToman = parseInputNumber(modalEl.querySelector('#dossier-wallet-delta').value) || 0;
            const reason = modalEl.querySelector('#dossier-wallet-reason').value || 'شارژ دستی';
            const idempotencyKey = window.crypto?.randomUUID?.() || `wallet-adjust-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            try {
              await api('/api/admin/wallet/adjust', {
                method: 'POST',
                headers: { 'Idempotency-Key': idempotencyKey },
                body: JSON.stringify({ phone, deltaToman, reason, branchId: currentBranchId || 1 }),
              });
              showToast('کیف پول با موفقیت به‌روزرسانی شد');
              renderDossierModal(phone);
            } catch (error) {
              showToast(error.message || 'ثبت تعدیل کیف پول ناموفق بود', 'error');
            }
          });
          modalEl.querySelector('#dossier-save-bday-btn')?.addEventListener('click', async () => {
            const birthdate = modalEl.querySelector('#dossier-bday').value.trim();
            await api(`/api/admin/customers/${encodeURIComponent(phone)}`, { method: 'PATCH', body: JSON.stringify({ birthdate }) });
            showToast('تاریخ تولد مشتری با موفقیت توسط مدیر به‌روزرسانی شد'); renderDossierModal(phone);
          });
        } catch (err) {
          showToast(err.message || 'خطا در بارگذاری پرونده');
        }
      };

      if (activeSubTab === 'wallet') {
        const [d, pendingData] = await Promise.all([
          api('/api/admin/wallet/summary'),
          api(`/api/wallet/topup-requests/pending${branchQs()}`).catch(() => ({ requests: [] })),
        ]);
        const packages = d.packages || [];
        const pendingReqs = pendingData.requests || [];

        main.innerHTML = `
          ${renderNav('wallet')}
          <div class="club-kpi-strip">
            <div class="club-kpi accent"><div class="num">${fmtMoney(d.totalLiabilityToman || 0)}</div><div class="lbl">موجودی کل</div></div>
            <div class="club-kpi"><div class="num">${fmtNum(d.activeWalletsCount || 0)}</div><div class="lbl">کیف پول فعال</div></div>
          </div>

          <!-- Pending In-Store Topup Requests -->
          ${pendingReqs.length > 0 ? `
            <div class="section-box club-section" style="border-top:3px solid #f59e0b; margin-bottom:1rem;">
              <h2 class="club-section-title" style="color:#f59e0b;">⏳ درخواست‌های شارژ حضوری در انتظار تأیید گارسون / صندوق (${pendingReqs.length})</h2>
              <div style="overflow-x:auto;">
                <table class="tbl" style="font-size:0.8rem;">
                  <thead><tr><th>کد پیگیری</th><th>مشتری</th><th>مبلغ شارژ</th><th>اعتبار کل</th><th>عملیات تأیید</th></tr></thead>
                  <tbody>
                    ${pendingReqs.map(r => `
                      <tr>
                        <td><b class="ltr admin-tracking-code" style="font-size:1.1rem; padding:0.15rem 0.5rem; border-radius:0.35rem;">${esc(r.trackingCode)}</b></td>
                        <td>${esc(r.customerName || 'مشتری')} <small class="ltr" style="color:var(--text-muted);">(${esc(r.phone)})</small></td>
                        <td>${fmtMoney(r.amountToman)}</td>
                        <td style="color:#10b981; font-weight:700;">+${fmtMoney(r.totalCredit)}</td>
                        <td>
                          <button type="button" class="btn btn-sm btn-accent approve-topup-btn" data-req-id="${esc(r.id)}" data-phone="${esc(r.phone)}" data-amount="${r.amountToman}" style="padding:0.25rem 0.75rem; font-size:0.75rem;">
                            ✓ تأیید دریافت وجه و شارژ آنی
                          </button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          ` : ''}

          <div class="section-box club-section">
            <h2 class="club-section-title">بسته‌های شارژ</h2>
            <div class="club-form-row" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));">
              ${packages.map((p) => `
                <div class="section-box wallet-pack-card" data-pack-id="${esc(p.id)}" style="margin:0; padding:0.85rem; border-top:3px solid ${p.popular ? '#10b981' : '#7357ce'};">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.4rem;">
                    <b>${esc(p.title)}</b>
                    ${p.popular ? '<span class="pill" style="background:#10b981; color:#fff;">محبوب</span>' : ''}
                  </div>
                  <div class="club-form-row" style="grid-template-columns:1fr 1fr;">
                    <div class="field"><label style="font-size:0.75rem;">مبلغ شارژ (ت)</label><input type="number" class="input ltr pack-amount" value="${p.amountToman || 0}" /></div>
                    <div class="field"><label style="font-size:0.75rem;">اعتبار هدیه (ت)</label><input type="number" class="input ltr pack-bonus" value="${p.bonusToman || 0}" /></div>
                  </div>
                  <div class="field" style="margin-top:0.35rem;"><label style="font-size:0.75rem;">برچسب</label><input type="text" class="input pack-badge" value="${esc(p.badge || '')}" /></div>
                </div>
              `).join('')}
            </div>
            <button class="btn btn-sm" id="save-packages-btn" style="margin-top:0.75rem;" type="button">ذخیره بسته‌ها</button>
          </div>

          <div class="grid-2-main">
            <div class="section-box club-section">
              <h2 class="club-section-title">شارژ / کسر دستی</h2>
              <div class="club-form-row">
                ${field('شماره موبایل', 'wal_phone', '', { ltr: true })}
                ${field('مبلغ (ت)', 'wal_delta', '100000', { ltr: true, type: 'number' })}
                ${field('توضیحات', 'wal_reason', 'شارژ دستی')}
              </div>
              <button class="btn btn-sm btn-accent" id="wal-adj-btn" style="margin-top:0.65rem;" type="button">ثبت سند</button>
            </div>

            <div class="section-box club-section">
              <h2 class="club-section-title">آخرین تراکنش‌ها</h2>
              <div style="overflow-x:auto;">
                <table class="tbl">
                  <thead><tr><th>زمان</th><th>مشتری</th><th>نوع</th><th>مبلغ</th><th>مانده</th></tr></thead>
                  <tbody>
                    ${(d.recentTransactions || []).slice(0, 10).map((t) => `
                      <tr>
                        <td>${fmtDateTime(t.at)}</td>
                        <td class="ltr">${esc(t.phone)}</td>
                        <td><span class="pill ${t.type === 'topup' ? 'is-paid' : t.type === 'cashback' ? 'is-prep' : ''}">${esc(t.type === 'topup' ? 'شارژ' : t.type === 'pay' ? 'خرید' : t.type === 'cashback' ? 'پاداش نقدی' : t.type)}</span></td>
                        <td style="color:${t.deltaToman > 0 ? '#10b981' : '#ef4444'}; font-weight:700;">${t.deltaToman > 0 ? '+' : ''}${fmtMoney(t.deltaToman)}</td>
                        <td>${fmtMoney(t.balanceAfterToman || 0)}</td>
                      </tr>
                    `).join('') || '<tr><td colspan="5">تراکنشی ثبت نشده.</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `;
        bindNav();

        main.querySelectorAll('.approve-topup-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.textContent = 'در حال ثبت…';
            const requestId = btn.dataset.reqId;
            try {
              const res = await api('/api/wallet/topup/staff-approve', { method: 'POST', body: JSON.stringify({ requestId, paymentTender: 'POS', branchId: currentBranchId || 1 }) });
              if (res.ok) {
                showToast(`شارژ با موفقیت برای شماره ${res.phone} تأیید شد.`);
                tabs.club('wallet');
              } else {
                showToast(res.error || 'خطا در تأیید شارژ');
                btn.disabled = false;
              }
            } catch (error) {
              showToast(error.message || 'خطا در تأیید شارژ', 'error');
              btn.disabled = false;
            }
          });
        });

        main.querySelector('#save-packages-btn')?.addEventListener('click', async () => {
          const updatedPackages = Array.from(main.querySelectorAll('.wallet-pack-card')).map((card) => {
            const id = card.dataset.packId;
            const orig = packages.find((p) => p.id === id) || {};
            return {
              ...orig,
              id,
              amountToman: parseInputNumber(card.querySelector('.pack-amount').value) || 0,
              bonusToman: parseInputNumber(card.querySelector('.pack-bonus').value) || 0,
              badge: card.querySelector('.pack-badge').value.trim(),
            };
          });
          await api('/api/admin/wallet/packages', { method: 'PUT', body: JSON.stringify({ packages: updatedPackages }) });
          showToast('بسته‌های شارژ با موفقیت ذخیره شدند');
          tabs.club('wallet');
        });

        main.querySelector('#wal-adj-btn')?.addEventListener('click', async () => {
          const phone = document.getElementById('wal_phone').value.trim();
          const deltaToman = parseInputNumber(document.getElementById('wal_delta').value) || 0;
          const reason = document.getElementById('wal_reason').value.trim();
          if (!phone || !deltaToman) return showToast('شماره و مبلغ الزامی است');
          const idempotencyKey = window.crypto?.randomUUID?.() || `wallet-adjust-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          try {
            const res = await api('/api/admin/wallet/adjust', {
              method: 'POST',
              headers: { 'Idempotency-Key': idempotencyKey },
              body: JSON.stringify({ phone, deltaToman, reason, branchId: currentBranchId || 1 }),
            });
            showToast(`سند با موفقیت ثبت شد (مانده جدید: ${fmtMoney(res.newBalanceToman || 0)})`);
            tabs.club('wallet');
          } catch (error) {
            showToast(error.message || 'ثبت تعدیل کیف پول ناموفق بود', 'error');
          }
        });
        return;
      }

      if (activeSubTab === 'campaigns') {
        const d = await api('/api/admin/campaigns/summary');
        const camp = d.campaigns || {};
        const stats = d.stats || {};
        main.innerHTML = `
          ${renderNav('campaigns')}

          <div class="grid-2-main">
            <div class="section-box club-section">
              <h2 class="club-section-title">هدیه تولد</h2>
              <div class="club-form-row">
                <div class="field"><label class="chk"><input type="checkbox" id="cmp_bday_en" ${camp.birthday?.enabled ? 'checked' : ''} /> فعال</label></div>
                ${field('هدیه کیف پول (ت)', 'cmp_bday_wallet', String(camp.birthday?.rewardWalletToman ?? 100000), { ltr: true, type: 'number' })}
                ${field('امتیاز هدیه', 'cmp_bday_points', String(camp.birthday?.rewardPoints ?? 200), { ltr: true, type: 'number' })}
                ${field('مهلت (روز)', 'cmp_bday_days', String(camp.birthday?.validDaysAfter ?? 7), { ltr: true, type: 'number' })}
              </div>
              <button class="btn btn-sm btn-accent" id="save-bday-btn" style="margin-top:0.65rem;" type="button">ذخیره</button>
            </div>

            <div class="section-box club-section">
              <h2 class="club-section-title">معرفی دوستان</h2>
              <div class="club-form-row">
                <div class="field"><label class="chk"><input type="checkbox" id="cmp_ref_en" ${camp.referral?.enabled ? 'checked' : ''} /> فعال</label></div>
                ${field('پاداش معرف (ت)', 'cmp_ref_wallet', String(camp.referral?.referrerRewardWalletToman ?? 50000), { ltr: true, type: 'number' })}
                ${field('پاداش دوست (ت)', 'cmp_ref_referee_wallet', String(camp.referral?.refereeRewardWalletToman ?? 30000), { ltr: true, type: 'number' })}
                ${field('حداقل سفارش (ت)', 'cmp_ref_min_order', String(camp.referral?.minFirstOrderToman ?? 200000), { ltr: true, type: 'number' })}
              </div>
              <button class="btn btn-sm btn-accent" id="save-ref-btn" style="margin-top:0.65rem;" type="button">ذخیره</button>
            </div>
          </div>

          <div class="section-box club-section">
            <h2 class="club-section-title">ساعت شاد ${stats.isHappyHourActive ? '<span class="pill is-paid" style="font-size:0.72rem; margin-right:0.4rem;">فعال</span>' : ''}</h2>
            <div class="club-form-row">
              <div class="field"><label class="chk"><input type="checkbox" id="cmp_hh_en" ${camp.happyHour?.enabled ? 'checked' : ''} /> فعال</label></div>
              ${field('تخفیف (٪)', 'cmp_hh_disc', String(camp.happyHour?.discountPct ?? 15), { ltr: true, type: 'number' })}
              ${field('شروع', 'cmp_hh_start', String(camp.happyHour?.startHour ?? '14:00'), { ltr: true })}
              ${field('پایان', 'cmp_hh_end', String(camp.happyHour?.endHour ?? '18:00'), { ltr: true })}
            </div>
            <button class="btn btn-sm btn-accent" id="save-hh-btn" style="margin-top:0.65rem;" type="button">ذخیره</button>
          </div>
        `;
        bindNav();

        main.querySelector('#save-bday-btn')?.addEventListener('click', async () => {
          await api('/api/admin/campaigns/settings', {
            method: 'PUT',
            body: JSON.stringify({
              birthday: {
                enabled: document.getElementById('cmp_bday_en').checked,
                rewardWalletToman: Number(document.getElementById('cmp_bday_wallet').value) || 0,
                rewardPoints: Number(document.getElementById('cmp_bday_points').value) || 0,
                validDaysAfter: Number(document.getElementById('cmp_bday_days').value) || 7,
              },
            }),
          });
          showToast('تنظیمات کمپین تولد ذخیره شد');
        });

        main.querySelector('#save-ref-btn')?.addEventListener('click', async () => {
          await api('/api/admin/campaigns/settings', {
            method: 'PUT',
            body: JSON.stringify({
              referral: {
                enabled: document.getElementById('cmp_ref_en').checked,
                referrerRewardWalletToman: Number(document.getElementById('cmp_ref_wallet').value) || 0,
                refereeRewardWalletToman: Number(document.getElementById('cmp_ref_referee_wallet').value) || 0,
                minFirstOrderToman: Number(document.getElementById('cmp_ref_min_order').value) || 0,
              },
            }),
          });
          showToast('تنظیمات سیستم معرفی ذخیره شد');
        });

        main.querySelector('#save-hh-btn')?.addEventListener('click', async () => {
          await api('/api/admin/campaigns/settings', {
            method: 'PUT',
            body: JSON.stringify({
              happyHour: {
                enabled: document.getElementById('cmp_hh_en').checked,
                discountPct: Number(document.getElementById('cmp_hh_disc').value) || 0,
                startHour: document.getElementById('cmp_hh_start').value.trim(),
                endHour: document.getElementById('cmp_hh_end').value.trim(),
              },
            }),
          });
          showToast('تنظیمات ساعت شاد ذخیره شد');
        });
        return;
      }

      if (activeSubTab === 'sms') {
        const stats = await api('/api/admin/sms/stats');
        const rfm = await api('/api/admin/sms/rfm');
        const sets = stats.settings || {};

        main.innerHTML = `
          ${renderNav('sms')}

          <div class="section-box club-section">
            <h2 class="club-section-title">بازگرداندن مشتریان</h2>
            <div style="overflow-x:auto;">
              <table class="tbl" style="font-size:0.82rem;">
                <thead><tr><th>گروه</th><th>تعداد</th><th>وضعیت</th></tr></thead>
                <tbody>
                  <tr><td>قهرمانان</td><td><b>${fmtNum(rfm.championsCount || 0)}</b></td><td><span class="pill is-paid">عالی</span></td></tr>
                  <tr><td>فعال</td><td><b>${fmtNum(rfm.activeCount || 0)}</b></td><td><span class="pill is-paid">پایدار</span></td></tr>
                  <tr><td>در خطر ریزش</td><td><b>${fmtNum(rfm.atRiskCount || 0)}</b></td><td><span class="pill" style="background:#f59e0b;color:#fff;">توجه</span></td></tr>
                  <tr><td>خواب‌رفته</td><td><b>${fmtNum(rfm.dormantCount || 0)}</b></td><td><span class="pill" style="background:#ef4444;color:#fff;">ریزش</span></td></tr>
                </tbody>
              </table>
            </div>
            <div class="club-form-row" style="margin-top:0.75rem; grid-template-columns: auto 140px auto;">
              <select id="winback_segment" class="input" style="font-size:0.82rem;">
                <option value="at_risk">در خطر (${fmtNum(rfm.atRiskCount || 0)})</option>
                <option value="dormant">خواب‌رفته (${fmtNum(rfm.dormantCount || 0)})</option>
              </select>
              <input id="winback_reward" class="input ltr" placeholder="هدیه (ت)" value="50000" style="font-size:0.82rem;" />
              <button class="btn btn-sm btn-accent" id="run-winback-btn" type="button">اجرای بازگشت</button>
            </div>
          </div>

          <details class="club-collapsible" open>
            <summary>تنظیمات درگاه پیامک</summary>
            <div class="club-collapse-body">
              <div class="club-form-row">
                <div class="field"><label class="chk"><input type="checkbox" id="sms_en" ${sets.enabled ? 'checked' : ''} /> فعال</label></div>
                <div class="field">
                  <label>ارائه‌دهنده</label>
                  <select id="sms_prov" class="input">
                    <option value="simulator" ${sets.provider === 'simulator' ? 'selected' : ''}>شبیه‌ساز</option>
                    <option value="kavenegar" ${sets.provider === 'kavenegar' ? 'selected' : ''}>کاوه‌نگار</option>
                    <option value="farazsms" ${sets.provider === 'farazsms' ? 'selected' : ''}>فراز اس‌ام‌اس</option>
                    <option value="ghasedak" ${sets.provider === 'ghasedak' ? 'selected' : ''}>قاصدک</option>
                    <option value="melipayamak" ${sets.provider === 'melipayamak' ? 'selected' : ''}>ملی‌پیامک</option>
                  </select>
                </div>
                ${field('کلید API', 'sms_key', sets.apiKey || '', { ltr: true })}
                ${field('سرشماره', 'sms_sender', sets.senderLine || '', { ltr: true })}
              </div>
              <button class="btn btn-sm btn-accent" id="save-sms-settings-btn" style="margin-top:0.65rem;" type="button">ذخیره</button>
            </div>
          </details>

          <details class="club-collapsible">
            <summary>ارسال پیامک تستی</summary>
            <div class="club-collapse-body">
              <div class="club-form-row">
                ${field('شماره گیرنده', 'sms_test_phone', '', { ltr: true })}
                <div class="field">
                  <label>الگو</label>
                  <select id="sms_test_tpl" class="input">
                    <option value="birthday">تبریک تولد</option>
                    <option value="points_earned">دریافت امتیاز</option>
                    <option value="wallet_topup">شارژ کیف پول</option>
                    <option value="winback">بازگشت مشتری</option>
                  </select>
                </div>
              </div>
              <div class="field" style="margin-top:0.4rem;">
                <label>متن دلخواه</label>
                <textarea id="sms_test_msg" class="input" rows="2" placeholder="اختیاری…"></textarea>
              </div>
              <button class="btn btn-sm" id="send-sms-test-btn" style="margin-top:0.5rem;" type="button">ارسال تست</button>
            </div>
          </details>
        `;
        bindNav();

        main.querySelector('#save-sms-settings-btn')?.addEventListener('click', async () => {
          try {
            await api('/api/admin/sms/settings', {
              method: 'PUT',
              body: JSON.stringify({
                enabled: document.getElementById('sms_en')?.checked,
                provider: document.getElementById('sms_prov')?.value,
                apiKey: document.getElementById('sms_key')?.value.trim(),
                senderLine: normalizeDigits(document.getElementById('sms_sender')?.value || '').trim(),
              }),
            });
            showToast('تنظیمات سامانه پیامک ذخیره شد');
          } catch (e) {
            showToast(e.message || 'خطا در ذخیره تنظیمات سامانه پیامک', 'error');
          }
        });

        main.querySelector('#send-sms-test-btn')?.addEventListener('click', async () => {
          const phone = normalizeDigits(document.getElementById('sms_test_phone')?.value || '').trim();
          const templateKey = document.getElementById('sms_test_tpl')?.value;
          const text = document.getElementById('sms_test_msg')?.value.trim();
          if (!phone) return showToast('شماره موبایل الزامی است');
          try {
            const res = await api('/api/admin/sms/send-test', { method: 'POST', body: JSON.stringify({ phone, templateKey, text }) });
            showToast(res.ok ? 'پیامک تستی ارسال شد' : (res.error || 'خطا در ارسال'));
          } catch (e) {
            showToast(e.message || 'خطا در ارسال پیامک تستی', 'error');
          }
        });

        main.querySelector('#run-winback-btn')?.addEventListener('click', async () => {
          const segment = document.getElementById('winback_segment')?.value;
          const rewardWalletToman = parseInputNumber(document.getElementById('winback_reward')?.value) ?? 50000;
          try {
            const res = await api('/api/admin/sms/run-winback', { method: 'POST', body: JSON.stringify({ segment, rewardWalletToman, branchId: currentBranchId || 1 }) });
            showToast(`کمپین بازگشت اجرا شد (${res.sentCount} پیامک با مجموع هدیه ${fmtMoney(res.rewardDisbursedTotalToman || 0)})`);
            tabs.club('sms');
          } catch (error) {
            showToast(error.message || 'کمپین بازگشت اجرا نشد', 'error');
          }
        });
        return;
      }

      if (activeSubTab === 'loyalty') {
        const d = await api('/api/admin/loyalty');
        const L = d.loyalty || {};
        const tiers = L.tiers || [];
        main.innerHTML = `
          ${renderNav('loyalty')}

          <div class="section-box club-section">
            <h2 class="club-section-title">قوانین امتیاز ${L.enabled ? '<span class="pill is-paid" style="font-size:0.72rem; margin-right:0.4rem;">فعال</span>' : '<span class="pill" style="font-size:0.72rem; margin-right:0.4rem;">خاموش</span>'}</h2>
            <div class="club-form-row">
              <div class="field"><label class="chk"><input type="checkbox" id="ly_en" ${L.enabled ? 'checked' : ''} /> فعال</label></div>
              ${field('امتیاز هر تومان', 'ly_rate', String(L.pointsPerToman ?? 0.01), { ltr: true, type: 'number' })}
              ${field('ارزش هر امتیاز (ت)', 'ly_val', String(L.redeemValue ?? 1000), { ltr: true, type: 'number' })}
              ${field('خوش‌آمدگویی', 'ly_welcome', String(L.welcomePoints ?? 50), { ltr: true, type: 'number' })}
            </div>
            <button class="btn btn-sm btn-accent" id="save-loyalty-rules-btn" style="margin-top:0.65rem;" type="button">ذخیره</button>
          </div>

          <div class="section-box club-section">
            <h2 class="club-section-title">سطوح وفاداری</h2>
            <div class="club-form-row" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
              ${tiers.map((t) => `
                <div class="section-box tier-config-card" data-tier-id="${esc(t.id)}" style="margin:0; padding:0.85rem; border-top:3px solid ${t.id === 'gold' ? '#f59e0b' : t.id === 'vip' ? '#a855f7' : t.id === 'silver' ? '#94a3b8' : '#cd7f32'};">
                  <b style="display:block; margin-bottom:0.4rem;">${esc(t.badgeIcon || '🥉')} ${esc(t.name)}</b>
                  <div class="club-form-row" style="grid-template-columns:1fr 1fr; gap:0.4rem;">
                    <div class="field"><label style="font-size:0.72rem;">حداقل امتیاز</label><input type="number" class="input ltr tier-min-pts" value="${t.minPoints || 0}" /></div>
                    <div class="field"><label style="font-size:0.72rem;">حداقل خرید (ت)</label><input type="number" class="input ltr tier-min-spend" value="${t.minSpendToman || 0}" /></div>
                    <div class="field"><label style="font-size:0.72rem;">ضریب پاداش</label><input type="number" step="0.1" class="input ltr tier-mult" value="${t.multiplier || 1}" /></div>
                    <div class="field"><label style="font-size:0.72rem;">تخفیف (٪)</label><input type="number" class="input ltr tier-disc" value="${t.discountPct || 0}" /></div>
                  </div>
                </div>
              `).join('')}
            </div>
            <button class="btn btn-sm" id="save-tiers-btn" style="margin-top:0.75rem;" type="button">ذخیره سطوح</button>
          </div>
        `;
        bindNav();

        main.querySelector('#save-loyalty-rules-btn')?.addEventListener('click', async () => {
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
          showToast('قوانین امتیاز ذخیره شد');
        });

        main.querySelector('#save-tiers-btn')?.addEventListener('click', async () => {
          const updatedTiers = Array.from(main.querySelectorAll('.tier-config-card')).map((card) => {
            const id = card.dataset.tierId;
            const orig = tiers.find((t) => t.id === id) || {};
            return {
              ...orig,
              id,
              minPoints: Number(card.querySelector('.tier-min-pts').value) || 0,
              minSpendToman: parseInputNumber(card.querySelector('.tier-min-spend').value) || 0,
              multiplier: Number(card.querySelector('.tier-mult').value) || 1,
              discountPct: Number(card.querySelector('.tier-disc').value) || 0,
            };
          });
          await api('/api/admin/loyalty/tiers', { method: 'PUT', body: JSON.stringify({ tiers: updatedTiers }) });
          showToast('تنظیمات سطوح وفاداری ذخیره شد');
        });
        return;
      }

      // Default: 'customers' sub-tab
      let d = {};
      try {
        d = await api('/api/admin/club');
      } catch {
        d = await api('/api/admin/loyalty').catch(() => ({}));
      }
      const customers = d.customers || d.members || [];
      const summary = d.summary || {
        customers: customers.length,
        points: d.totals?.pointsIssued || customers.reduce((s, m) => s + (m.points || 0), 0),
        walletTotalToman: 0,
        newFeedback: 0,
      };

      main.innerHTML = `
        ${renderNav('customers')}

        <div class="club-kpi-strip">
          <div class="club-kpi accent"><div class="num">${fmtNum(summary.customers || 0)}</div><div class="lbl">عضو</div></div>
          <div class="club-kpi"><div class="num">${fmtNum(summary.points || 0)}</div><div class="lbl">امتیاز در گردش</div></div>
        </div>

        <section class="section-box club-section">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; margin-bottom:0.65rem;">
            <h2 class="club-section-title" style="margin:0;">مشتریان</h2>
            <input type="text" id="cust-search" class="input ltr" placeholder="جستجو…" style="max-width:200px; font-size:0.82rem;" />
          </div>
          <div style="overflow-x:auto;">
            <table class="tbl" id="customers-tbl">
              <thead>
                <tr>
                  <th>مشتری</th>
                  <th>سطح</th>
                  <th>سفارش</th>
                  <th>خرید</th>
                  <th>کیف پول</th>
                  <th>امتیاز</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${customers.slice(0, 60).map((c) => `
                  <tr data-phone="${esc(c.phone)}" data-name="${esc(c.name || '')}">
                    <td>
                      <b>${esc(c.name || 'مهمان')}</b>
                      <div class="hint ltr">${esc(c.phone)}</div>
                    </td>
                    <td>${tierBadge(c)}</td>
                    <td>${fmtNum(c.orders || 0)}</td>
                    <td>${fmtMoney(c.total || 0)}</td>
                    <td style="color:#10b981; font-weight:700;">${fmtMoney(c.walletBalanceToman || 0)}</td>
                    <td><b>${fmtNum(c.points || 0)}</b></td>
                    <td>
                      <button class="btn btn-sm btn-ghost open-dossier-btn" data-phone="${esc(c.phone)}" type="button">پرونده</button>
                    </td>
                  </tr>
                `).join('') || '<tr><td colspan="7">مشتری ثبت نشده.</td></tr>'}
              </tbody>
            </table>
          </div>
        </section>
      `;
      bindNav();

      main.querySelectorAll('.open-dossier-btn').forEach((btn) => {
        btn.addEventListener('click', () => renderDossierModal(btn.dataset.phone));
      });

      const searchInput = main.querySelector('#cust-search');
      if (searchInput) {
        searchInput.addEventListener('input', () => {
          const q = searchInput.value.trim().toLowerCase();
          main.querySelectorAll('#customers-tbl tbody tr').forEach((row) => {
            const phone = (row.dataset.phone || '').toLowerCase();
            const name = (row.dataset.name || '').toLowerCase();
            row.style.display = phone.includes(q) || name.includes(q) ? '' : 'none';
          });
        });
      }
    },

    async wallet() {
      tabs.club('wallet');
    },

    async campaigns() {
      tabs.club('campaigns');
    },

    async sms() {
      tabs.club('sms');
    },

    async loyalty() {
      tabs.club('loyalty');
    },

    async finance() {
      return tabs.accounting();
    },

    async accounting() {
      setActiveTab('accounting');
      if (typeof window.renderAccountingWorkspace === 'function') {
        await window.renderAccountingWorkspace(main, branchQs(), {
          hasCapability,
          currentUser: () => currentUser,
          // Finance renders its active scope in the header; pass the same
          // canonical branch cache used by the shell so multi-branch users
          // never lose the selected branch context in the accounting view.
          branchCount: () => branchesCache.length,
        });
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
        <h1>همگام‌سازی سامانه بیرونی</h1>
        <p class="lead">منوی عمومی، ثبت سفارش و تجربه سه‌بعدی وستو مستقل می‌مانند. سفارش، پرداخت، مشتری و امتیاز وفاداری در پس‌زمینه با سامانه مالی بیرونی همگام می‌شوند.</p>
        <div class="cards">
          <div class="card ${sync.enabled ? 'accent' : 'warn'}"><div class="num">${sync.enabled ? 'فعال' : 'متوقف'}</div><div class="lbl">وضعیت اتصال</div></div>
          <div class="card ${Number(sync.queued || 0) ? 'warn' : ''}"><div class="num">${fmtNum(sync.queued || 0)}</div><div class="lbl">رویداد در صف</div></div>
          <div class="card"><div class="num">${fmtNum(sync.deliveredRetained || 0)}</div><div class="lbl">ارسال‌های ثبت‌شده</div></div>
          <div class="card ${hasError ? 'danger' : ''}"><div class="num">${hasError ? 'نیازمند پیگیری' : 'سالم'}</div><div class="lbl">آخرین وضعیت</div></div>
        </div>
        <div class="section-box">
          <h2>عملیات</h2>
          <p class="hint">سفارش‌های جدید خودکار همگام می‌شوند و ثبت سفارش مشتری را معطل نمی‌کنند. همگام‌سازی اولیه فقط برای وارد کردن سفارش‌های قبلی وستو است.</p>
          <div class="row-actions" style="margin-top:0.9rem">
            <button class="btn btn-sm" id="neem-open">باز کردن پنل مالی و مشتریان</button>
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
        if (!confirm('سفارش‌های قبلی وستو برای ساخت گزارش و حسابداری به سامانه بیرونی فرستاده شوند؟ این کار در پس‌زمینه انجام می‌شود.')) return;
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
        <h1>بازخورد و رضایت مهمان</h1>
        <p class="lead">امتیاز احتمال پیشنهاد به دوستان از صفر تا ده — <a href="/feedback" target="_blank" rel="noopener">مشاهده صفحه عمومی بازخورد</a></p>
        <div class="cards">
          <div class="card accent"><div class="num">${st.nps == null ? '—' : fmtNum(st.nps)}</div><div class="lbl">شاخص رضایت ${fmtNum(d.days || 30)} روز</div></div>
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
        try {
          await api('/api/admin/feedback/settings', {
            method: 'PUT',
            body: JSON.stringify({
              settings: {
                enabled: document.getElementById('fb_en')?.checked !== false,
                askAfterOrder: document.getElementById('fb_ord')?.checked !== false,
                title: document.getElementById('fb_title')?.value || '',
                subtitle: document.getElementById('fb_sub')?.value || '',
                thankYou: document.getElementById('fb_ty')?.value || '',
              },
            }),
          });
        } catch (e) {
          showToast(e.message || 'خطا در ذخیره تنظیمات بازخورد', 'error');
        }
      };
      bindAutosave(main.querySelector('.section-box'), saveFb);
      main.querySelectorAll('[data-fbstatus]').forEach((sel) => {
        sel.addEventListener('change', async () => {
          try {
            await api(`/api/admin/feedback/${sel.dataset.fbstatus}`, {
              method: 'PATCH',
              body: JSON.stringify({ status: sel.value }),
            });
            showToast('وضعیت بازخورد به‌روز شد', 'success');
          } catch (e) {
            showToast(e.message || 'خطا در به‌روزرسانی وضعیت بازخورد', 'error');
            await tabs.feedback();
          }
        });
      });
    },

    async newsletter() {
      setActiveTab('newsletter');
      const d = await api('/api/admin/newsletter');
      const list = Array.isArray(d.newsletter) ? d.newsletter : [];
      main.innerHTML = `
        <h1>خبرنامه</h1>
        <div class="section-box">
          <h2>${fmtNum(list.length)} ایمیل ثبت‌شده <small><a href="#" id="csv-link">دریافت فایل خبرنامه</a></small></h2>
          <table class="tbl"><thead><tr><th>ایمیل</th><th>تاریخ ثبت</th></tr></thead><tbody>
            ${list.map((n) => `<tr><td class="ltr">${esc(n.email)}</td><td>${fmtDateTime(n.at)}</td></tr>`).join('') || '<tr><td colspan="2">هنوز ایمیلی ثبت نشده است</td></tr>'}
          </tbody></table>
        </div>`;
      document.getElementById('csv-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        if (!list.length) {
          showToast('ایمیلی برای دریافت فایل وجود ندارد', 'warn');
          return;
        }
        const csv = 'email,date\n' + list.map((n) => `${n.email},${n.at}`).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = 'newsletter.csv';
        a.click();
      });
    },

    async settings() {
      setActiveTab('settings');
      const [restaurantPayload, themePayload, usersPayload] = await Promise.all([
        api('/api/admin/restaurant'),
        api('/api/admin/theme'),
        api('/api/admin/users'),
      ]);
      const restaurant = restaurantPayload.restaurant || {};
      const theme = themePayload.theme || {};
      const branches = branchesCache || [];
      const activeBranches = branches.filter((branch) => branch.active !== false);
      const users = usersPayload.users || [];
      const contentKeys = Object.keys(state.content || {});
      const configuredContent = contentKeys.filter((key) => String(state.content[key] || '').trim()).length;
      const cards = [
        { icon: '⌂', title: 'هویت مجموعه', detail: restaurant.name || 'نام مجموعه ثبت نشده', meta: restaurant.phone ? `تلفن ${restaurant.phone}` : 'شماره تماس ثبت نشده', tab: 'restaurant', tone: 'cyan' },
        { icon: '◈', title: 'ظاهر و برند', detail: theme.accent ? `رنگ اصلی ${theme.accent}` : 'ظاهر هنوز تنظیم نشده', meta: theme.fontDisplay || 'قلم پیش‌فرض پنل', tab: 'theme', tone: 'violet' },
        { icon: '✦', title: 'محتوا و رسانه', detail: `${fmtNum(configuredContent)} مورد محتوای تنظیم‌شده`, meta: `${fmtNum(contentKeys.length)} کلید محتوایی · لوگو و الگو`, tab: 'content', secondaryTab: 'media', tone: 'orange' },
        { icon: '⌘', title: 'شعبه و ساعت کاری', detail: `${fmtNum(activeBranches.length)} شعبه فعال در سامانه`, meta: `${fmtNum(branches.length)} شعبه ثبت‌شده · بررسی ساعت کاری`, tab: 'branches', secondaryTab: 'hours', tone: 'green' },
        { icon: '◎', title: 'کاربران و دسترسی', detail: `${fmtNum(users.length)} حساب کاربری`, meta: 'نقش‌ها، مجوزها و وضعیت ورود', tab: 'users', tone: 'blue' },
        { icon: '?', title: 'سؤالات متداول', detail: 'مدیریت پاسخ‌های آمادهٔ سایت', meta: 'ویرایش و مرتب‌سازی پرسش‌ها', tab: 'faq', tone: 'slate' },
      ];
      main.innerHTML = `
        <section class="settings-dashboard" aria-labelledby="settings-dashboard-title">
          <header class="settings-dashboard__hero">
            <div>
              <p class="eyebrow">مرکز تنظیمات وستو</p>
              <h1 id="settings-dashboard-title">تنظیمات</h1>
              <p class="lead">همهٔ تنظیمات مجموعه، ظاهر سایت، محتوا و دسترسی‌ها را از یک نمای ساده مدیریت کنید.</p>
            </div>
            <div class="settings-dashboard__summary">
              <span class="settings-dashboard__status-dot" aria-hidden="true"></span>
              <div><strong>${esc(restaurant.name || 'مجموعه شما')}</strong><small>${fmtNum(activeBranches.length)} شعبه فعال · ${fmtNum(users.length)} کاربر</small></div>
            </div>
          </header>
          <div class="settings-dashboard__toolbar">
            <strong>دسترسی سریع به تنظیمات</strong>
            <span>هر کارت شما را به صفحهٔ تخصصی همان بخش می‌برد.</span>
          </div>
          <div class="settings-dashboard__grid">
            ${cards.map((card) => `<article class="settings-dashboard__card settings-dashboard__card--${esc(card.tone)}">
              <div class="settings-dashboard__card-top"><span class="settings-dashboard__icon" aria-hidden="true">${esc(card.icon)}</span><span class="settings-dashboard__arrow" aria-hidden="true">←</span></div>
              <div><h2>${esc(card.title)}</h2><p>${esc(card.detail)}</p><small>${esc(card.meta)}</small></div>
              <div class="settings-dashboard__actions"><button type="button" class="btn btn-sm" data-settings-tab="${esc(card.tab)}">باز کردن</button>${card.secondaryTab ? `<button type="button" class="btn btn-sm btn-ghost" data-settings-tab="${esc(card.secondaryTab)}">${card.secondaryTab === 'media' ? 'رسانه' : 'ساعت کاری'}</button>` : ''}</div>
            </article>`).join('')}
          </div>
          <section class="settings-dashboard__footer section-box">
            <div><h2>تنظیمات پیشنهادی</h2><p class="lead">برای شروع، هویت مجموعه و ظاهر برند را کامل کنید؛ بعد محتوای سایت و دسترسی کاربران را بررسی کنید.</p></div>
            <div class="settings-dashboard__steps"><span><b>۱</b> هویت مجموعه</span><span><b>۲</b> ظاهر برند</span><span><b>۳</b> محتوا و دسترسی</span></div>
          </section>
        </section>`;
      main.querySelectorAll('[data-settings-tab]').forEach((button) => button.addEventListener('click', () => tabs[button.dataset.settingsTab]?.().catch((error) => showToast(error.message))));
    },
  };

  function mountAdminModules() {
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
      hasCapability,
      activeTab: () => activeTab,
      branchCount: () => branchesCache.length,
      legacyTabs,
    };
    const bindings = registry.mount(context, tabs);
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
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && document.body.classList.contains('sidebar-open')) closeSidebar(); });
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
    } else if (hasFinanceWorkspace && requestedHash !== 'accounting' && !requestedHash.startsWith('fin-')) {
      history.replaceState(null, '', `${location.pathname}?${searchParams.toString()}#accounting`);
    }

    const requestedTab = (isFinanceHash || hasFinanceWorkspace) ? 'accounting' : requestedHash;
    const initialTab = (tabs[requestedTab] && hasCapability(TAB_CAPABILITIES[requestedTab])) ? requestedTab : 'dashboard';
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
