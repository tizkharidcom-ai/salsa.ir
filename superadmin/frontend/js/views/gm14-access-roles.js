// prototype/js/views/gm14-access-roles.js
// GM-14: ماتریس نقش‌ها و سطوح دسترسی (Roles & Access Matrix: inherit / allow / deny)

window.GMViews = window.GMViews || {};

window.GMViews.GM14 = {
  selectedUserId: null,
  activeFilter: 'all', // 'all' | 'diff' | 'deny' | 'finance'
  searchQuery: '',

  // Comprehensive Module-Grouped Permission Catalog (GODMODE § GM-14)
  groups: [
    {
      id: 'finance',
      name: 'ماژول مالی، صندوق و حسابداری',
      icon: '💳',
      permissions: [
        { key: 'finance.view', name: 'مشاهده اسناد و دفاتر مالی', cat: 'مالی', defRoles: ['owner', 'manager', 'accountant'], sensitive: false, scope: 'کل سازمان' },
        { key: 'finance.export', name: 'استخراج اکسل و اسناد مالی', cat: 'مالی', defRoles: ['owner', 'accountant'], sensitive: true, scope: 'کل سازمان' },
        { key: 'finance.journal.create', name: 'صدور اسناد معین و روزنامه دستی', cat: 'مالی', defRoles: ['owner', 'accountant'], sensitive: true, scope: 'شعبه و دفتر' },
        { key: 'finance.tax.report', name: 'گزارش رسمی ارزش افزوده و مودیان', cat: 'مالی', defRoles: ['owner'], sensitive: true, scope: 'حاکمیتی/مودیان' },
        { key: 'cash.manage', name: 'تسویه و بستن شیفت صندوق', cat: 'مالی', defRoles: ['owner', 'manager', 'cashier'], sensitive: true, scope: 'پایانه صندوق' }
      ]
    },
    {
      id: 'orders',
      name: 'ماژول سفارشات، فروش و سالن',
      icon: '🧾',
      permissions: [
        { key: 'orders.view', name: 'مشاهده سفارشات سالن و آنلاین', cat: 'سفارشات', defRoles: ['owner', 'manager', 'accountant', 'cashier'], sensitive: false, scope: 'سالن و دلیوری' },
        { key: 'orders.create', name: 'ثبت سفارش جدید در صندوق/پوز', cat: 'سفارشات', defRoles: ['owner', 'manager', 'cashier'], sensitive: false, scope: 'صندوق و سالن' },
        { key: 'orders.void', name: 'ابطال سفارش و برگشت وجه', cat: 'سفارشات', defRoles: ['owner'], sensitive: true, scope: 'صندوق و شاپرک' },
        { key: 'discounts.apply', name: 'اعمال تخفیف آزاد بالای ۲۰٪', cat: 'سفارشات', defRoles: ['owner', 'manager'], sensitive: true, scope: 'فاکتور مشتری' }
      ]
    },
    {
      id: 'menu',
      name: 'ماژول منو، انبارداری و قیمت‌گذاری',
      icon: '📋',
      permissions: [
        { key: 'menu.view', name: 'مشاهده کاتالوگ و قیمت اقلام', cat: 'منو', defRoles: ['owner', 'manager', 'cashier'], sensitive: false, scope: 'منوی دیجیتال' },
        { key: 'menu.pricing.update', name: 'تغییر قیمت اقلام منو', cat: 'منو', defRoles: ['owner', 'manager'], sensitive: true, scope: 'کاتالوگ مرکزی' },
        { key: 'inventory.count', name: 'ثبت انبارگردانی و کسری کالا', cat: 'منو', defRoles: ['owner', 'manager'], sensitive: true, scope: 'انبار مرکزی' }
      ]
    },
    {
      id: 'tables',
      name: 'ماژول سالن، میزها و نقشه پذیرایی',
      icon: '🪑',
      permissions: [
        { key: 'tables.view', name: 'مشاهده نقشه میزها و وضعیت سالن', cat: 'سالن', defRoles: ['owner', 'manager', 'cashier', 'waiter'], sensitive: false, scope: 'سالن پذیرایی' },
        { key: 'tables.service.manage', name: 'باز کردن میز و ثبت سفارش سر میز', cat: 'سالن', defRoles: ['owner', 'manager', 'cashier', 'waiter'], sensitive: false, scope: 'میزهای سالن' },
        { key: 'tables.call.respond', name: 'پاسخ‌گویی به احضار گارسون و پیجر', cat: 'سالن', defRoles: ['owner', 'manager', 'waiter'], sensitive: false, scope: 'تبلت گارسون' }
      ]
    },
    {
      id: 'kitchen',
      name: 'ماژول صف آشپزخانه (KDS) و پخت',
      icon: '🍳',
      permissions: [
        { key: 'kitchen.view', name: 'مشاهده نمایشگر سفارشات آشپزخانه (KDS)', cat: 'آشپزخانه', defRoles: ['owner', 'manager', 'kitchen'], sensitive: false, scope: 'صف پخت KDS' },
        { key: 'kitchen.status.update', name: 'تغییر وضعیت پخت و اعلام آماده‌باش', cat: 'آشپزخانه', defRoles: ['owner', 'manager', 'kitchen'], sensitive: false, scope: 'خط آماده‌سازی' },
        { key: 'kitchen.recipes.view', name: 'مشاهده دستورهای تهیه و شیوه پخت', cat: 'آشپزخانه', defRoles: ['owner', 'manager', 'kitchen'], sensitive: false, scope: 'دستورالعمل‌های تولید' }
      ]
    },
    {
      id: 'club',
      name: 'ماژول باشگاه مشتریان، وفاداری و پیامک',
      icon: '🌟',
      permissions: [
        { key: 'club.members.view', name: 'مشاهده پرونده و امتیاز مشتریان وفادار', cat: 'باشگاه', defRoles: ['owner', 'manager', 'cashier'], sensitive: false, scope: 'پایگاه مشتریان' },
        { key: 'club.points.redeem', name: 'اعمال تخفیف و خرج امتیاز در فاکتور', cat: 'باشگاه', defRoles: ['owner', 'manager', 'cashier'], sensitive: true, scope: 'صندوق و فاکتور' },
        { key: 'club.campaign.send', name: 'ارسال پیامک انبوه و کمپین‌های تبلیغاتی', cat: 'باشگاه', defRoles: ['owner', 'manager'], sensitive: true, scope: 'درگاه پیامک' }
      ]
    },
    {
      id: 'staff',
      name: 'ماژول پرسنل، امنیت و دسترسی',
      icon: '👥',
      permissions: [
        { key: 'staff.manage', name: 'مدیریت اعضا و دسترسی‌ها', cat: 'پرسنل', defRoles: ['owner'], sensitive: true, scope: 'کنترل‌پلن' },
        { key: 'staff.invite', name: 'افزودن و عزل پرسنل', cat: 'پرسنل', defRoles: ['owner'], sensitive: true, scope: 'کل سازمان' },
        { key: 'staff.password.reset', name: 'بازنشانی گذرواژه کاربر', cat: 'پرسنل', defRoles: ['owner', 'manager'], sensitive: true, scope: 'هویت کاربر' }
      ]
    },
    {
      id: 'system',
      name: 'ماژول شعبه، زیرساخت و تنظیمات',
      icon: '⚙️',
      permissions: [
        { key: 'branch.settings.write', name: 'ویرایش مشخصات حقوقی شعبه', cat: 'سیستم', defRoles: ['owner'], sensitive: true, scope: 'شعبه و پروانه' },
        { key: 'admin.access', name: 'ورود به کنسول مدیریت کلان', cat: 'سیستم', defRoles: ['owner'], sensitive: true, scope: 'سامانه ابری' },
        { key: 'reports.export', name: 'دانلود گزارشات تحلیلی جامع', cat: 'سیستم', defRoles: ['owner', 'manager', 'accountant'], sensitive: true, scope: 'هوش تجاری' }
      ]
    }
  ],

  // Helper: Get all permissions flattened
  getAllPermissions() {
    const list = [];
    this.groups.forEach(g => {
      g.permissions.forEach(p => {
        list.push({ ...p, groupId: g.id, groupName: g.name });
      });
    });
    return list;
  },

  // Calculate live summary telemetry (GODMODE GM-14: X اجازه اضافه، Y منع جدید، Z کاربر مشمول)
  calculateSummaryStats(store) {
    const overrides = (store && store.getPersonalOverrides) ? store.getPersonalOverrides() : {};
    let allowCount = 0;
    let denyCount = 0;
    const affectedUserSet = new Set();

    Object.keys(overrides).forEach(userId => {
      const userPerms = overrides[userId] || {};
      let userHasActiveOverride = false;
      Object.values(userPerms).forEach(item => {
        if (item && item.state === 'allow') {
          allowCount++;
          userHasActiveOverride = true;
        } else if (item && item.state === 'deny') {
          denyCount++;
          userHasActiveOverride = true;
        }
      });
      if (userHasActiveOverride) {
        affectedUserSet.add(userId);
      }
    });

    return {
      allowCount,
      denyCount,
      affectedUsersCount: affectedUserSet.size
    };
  },

  setFilter(filterName) {
    this.activeFilter = filterName;
    if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
      window.GMRouter.refresh();
    } else if (window.GMRouter && typeof window.GMRouter.handleRoute === 'function') {
      window.GMRouter.handleRoute();
    }
  },

  setSearch(q) {
    this.searchQuery = (q || '').trim().toLowerCase();
    const query = this.searchQuery;

    // Direct DOM filtering for instant search without flickering
    document.querySelectorAll('.matrix-perm-row').forEach(row => {
      const text = row.getAttribute('data-search-text') || '';
      const matches = !query || text.includes(query);
      row.style.display = matches ? '' : 'none';
    });
    document.querySelectorAll('.mobile-permission-card').forEach(card => {
      const text = card.getAttribute('data-search-text') || '';
      const matches = !query || text.includes(query);
      card.style.display = matches ? '' : 'none';
    });
  },

  changeUser(userId) {
    this.selectedUserId = userId;
    if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
      window.GMRouter.refresh();
    } else if (window.GMRouter && typeof window.GMRouter.handleRoute === 'function') {
      window.GMRouter.handleRoute();
    }
  },

  render(params) {
    const store = window.GMStore || window.prototypeStore;
    const activeTenantId = (params && params.id) || (store && store.getActiveTenantId ? store.getActiveTenantId() : null) || null;
    const tenant = (activeTenantId && store && store.getTenant ? store.getTenant(activeTenantId) : null)
      || { id: activeTenantId || '', name: 'مجموعه انتخاب نشده', cellId: null };
    const identities = activeTenantId && store && store.getIdentities ? store.getIdentities(activeTenantId) : [];
    if (!identities.some(u => u.id === this.selectedUserId)) this.selectedUserId = identities[0]?.id || null;
    const currentUser = identities.find(u => u.id === this.selectedUserId) || identities[0]
      || { id: null, displayName: 'کاربری انتخاب نشده', role: 'guest', tenantId: activeTenantId };
    const overrides = (store && store.getPersonalOverrides) ? store.getPersonalOverrides() : {};
    const userOverrides = overrides[currentUser.id] || {};
    const roleLabels = { owner: 'مالک مجموعه', manager: 'مدیر عملیاتی', accountant: 'حسابدار ارشد', cashier: 'صندوق‌دار', waiter: 'گارسون / سالن‌کار', kitchen: 'سرآشپز / آشپزخانه', guest: 'مشتری / مهمان' };
    const currentRoleLabel = roleLabels[currentUser.role] || 'نقش سازمانی';
    const cellLabel = { 'cell-teh-01': 'تهران', 'cell-msh-01': 'مشهد', 'cell-mashhad-01': 'مشهد' }[tenant.cellId] || 'مرکز عملیاتی مشهد';

    // Calculate Summary Stats
    const stats = this.calculateSummaryStats(store);
    const allPerms = this.getAllPermissions();

    // Filter permissions based on activeFilter
    const filterFn = (p) => {
      const ov = userOverrides[p.key] || { state: 'inherit' };
      const isRoleAllowed = p.defRoles.includes(currentUser.role);
      
      // Filter 1: diff (تفاوت‌ها)
      if (this.activeFilter === 'diff') {
        const hasCustomOverride = ov.state !== 'inherit';
        const roleDiffers = p.defRoles.length > 0 && p.defRoles.length < 4;
        return hasCustomOverride || roleDiffers;
      }
      // Filter 2: deny (فقط منع‌ها)
      if (this.activeFilter === 'deny') {
        return ov.state === 'deny';
      }
      // Filter 3: finance (فقط عملیات مالی)
      if (this.activeFilter === 'finance') {
        return p.groupId === 'finance' || p.cat === 'مالی';
      }
      // Filter 4: all
      return true;
    };

    // Filter permissions based on searchQuery
    const searchFn = (p) => {
      if (!this.searchQuery) return true;
      const q = this.searchQuery.toLowerCase();
      return p.name.toLowerCase().includes(q) || 
             p.key.toLowerCase().includes(q) || 
             p.desc.toLowerCase().includes(q);
    };

    const displayedPerms = allPerms.filter(p => filterFn(p) && searchFn(p));

    return `
      <!-- Header -->
      <div class="page-header gm14-page">
        <div class="page-title-group">
          <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
            <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
            <span class="breadcrumb-separator">/</span>
            <a href="#gm-04-tenant-detail?id=${tenant.id}" class="breadcrumb-link">پرونده مشتری</a>
            <span class="breadcrumb-separator">/</span>
            <span class="breadcrumb-current" aria-current="page">ماتریس دسترسی و نقش‌ها</span>
          </nav>
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <h1>
              ماتریس دسترسی و نقش‌ها (RBAC)
              <span class="page-code-badge">GM-14</span>
            </h1>
            <span class="badge badge-scope-tenant"><span class="status-dot dot-active"></span> ${tenant.name}</span>
            <span class="badge scope-cell-badge">${cellLabel}</span>
          </div>
          <p>مدیریت جامع نقش‌ها، ارث‌بری دسترسی‌ها و بازتعریف‌های شخصی (Personal Overrides) در سطح رستوران</p>
        </div>
        <div class="header-actions">
          <a href="#gm-15-simulator" class="btn btn-primary" aria-label="انتقال به ارزیابی دسترسی">
            ارزیابی دسترسی‌ها
          </a>
        </div>
      </div>

      ${window.GMDataState ? window.GMDataState.renderFreshnessBar({
        viewId: 'GM14',
        sourceLabel: 'ماتریس سیاست‌های دسترسی و نقش‌ها',
        sourceMode: 'local',
        totalCount: allPerms.length,
        countLabel: 'مجوز سیستمی'
      }) : ''}

      <div class="op-context-banner op-context-info" role="region" aria-label="راهنمای ماتریس دسترسی">
        <div class="op-context-header">
          <span>ماتریس دسترسی و نقش‌های امنیتی سازمانی</span>
          <span class="badge badge-warning">پیش‌نمایش محلی · بدون اتصال به runtime</span>
        </div>
        <div class="op-context-grid">
          <div class="op-context-item"><span class="op-context-label">منبع:</span><span class="op-context-desc">دادهٔ نمایشی از Store محلی پروتوتایپ است.</span></div>
          <div class="op-context-item"><span class="op-context-label">پیامد:</span><span class="op-context-desc">تغییر این ماتریس نقش یا نشست واقعی را عوض نمی‌کند.</span></div>
          <div class="op-context-item"><span class="op-context-label">امنیت:</span><span class="op-context-desc">اتصال tenant، membership و شعبه در runtime هنوز تأیید نشده است.</span></div>
        </div>
      </div>
      <div class="card" role="status" style="margin-bottom: 1rem; border-color: var(--state-warning);">
        <strong>وضعیت امنیتی این نما قابل ارزیابی نیست</strong>
        <p class="text-secondary" style="margin: 0.4rem 0 0;">امتیاز امنیت، MFA، HSTS و ایزولاسیون زنده از این ماتریس محلی اندازه‌گیری نمی‌شوند؛ برای تصمیم دسترسی به آن‌ها تکیه نکنید.</p>
      </div>

      <!-- Dynamic Summary Strip (GODMODE § GM-14: «X اجازه اضافه، Y منع جدید، Z کاربر مشمول» و دکمه ارزیابی دسترسی) -->
      <section class="matrix-summary-strip" role="region" aria-label="خلاصه ماتریس دسترسی و تنظیمات شخصی">
        <div class="matrix-summary-stats">
          <div class="matrix-stat-item">
            <span>تنظیمات اعمال‌شده:</span>
            <strong class="stat-badge-allow">${stats.allowCount.toLocaleString('fa-IR')} اجازه اضافه</strong>
          </div>
          <div class="matrix-stat-item">
            <strong class="stat-badge-deny">${stats.denyCount.toLocaleString('fa-IR')} منع جدید</strong>
          </div>
          <div class="matrix-stat-item">
            <strong class="stat-badge-users">${stats.affectedUsersCount.toLocaleString('fa-IR')} کاربر مشمول</strong>
          </div>
          <div class="matrix-stat-item text-secondary" style="font-size: 0.75rem;">
            <span>(اجرای زندهٔ تقدم منع از این پیش‌نمایش قابل تأیید نیست)</span>
          </div>
        </div>
        <div style="display: flex; gap: 0.5rem; align-items: center;">
          <a href="#gm-15-simulator" class="btn btn-outline-cyan btn-sm" aria-label="ارزیابی اثر دسترسی‌ها">
            <span>ارزیابی و تطبیق دسترسی‌ها</span>
          </a>
        </div>
      </section>

      <!-- Matrix Filters Toolbar (GODMODE § GM-14: ۴ فیلتر اختصاصی) -->
      <section class="matrix-filters-bar" role="search" aria-label="فیلترهای ماتریس دسترسی">
        <div class="matrix-filter-chips">
          <span class="text-secondary" style="font-size: 0.775rem; margin-left: 0.35rem;">فیلتر نمایش:</span>
          <button type="button" class="filter-chip ${this.activeFilter === 'all' ? 'active' : ''}" onclick="window.GMViews.GM14.setFilter('all')">
            همه مجوزها (${allPerms.length})
          </button>
          <button type="button" class="filter-chip ${this.activeFilter === 'diff' ? 'active' : ''}" onclick="window.GMViews.GM14.setFilter('diff')">
            فقط تفاوت‌ها
          </button>
          <button type="button" class="filter-chip ${this.activeFilter === 'deny' ? 'active' : ''}" onclick="window.GMViews.GM14.setFilter('deny')">
            فقط منع‌ها
          </button>
          <button type="button" class="filter-chip ${this.activeFilter === 'finance' ? 'active' : ''}" onclick="window.GMViews.GM14.setFilter('finance')">
            فقط عملیات مالی
          </button>
        </div>

        <div class="matrix-search-box">
          <input 
            type="search" 
            class="form-control" 
            placeholder="جست‌وجوی Permission (نام یا کلید فنی)..." 
            value="${this.searchQuery}"
            aria-label="جست‌وجوی Permission"
            oninput="window.GMViews.GM14.setSearch(this.value)"
          />
        </div>
      </section>

      <!-- User Selector and Role Context Card -->
      <div class="card" style="margin-bottom: 1.25rem;">
        <div style="display: flex; gap: 1.25rem; align-items: center; justify-content: space-between; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 280px;">
            <label class="form-label" for="user-override-select">شخص منتخب جهت پایش و تغییر اختصاصی (Personal Overrides):</label>
            <select class="form-control" id="user-override-select" aria-label="انتخاب کاربر مورد نظر برای تنظیم سیاست شخصی" onchange="window.GMViews.GM14.changeUser(this.value)">
              ${identities.map(u => `
                <option value="${u.id}" ${u.id === currentUser.id ? 'selected' : ''}>
                  ${u.displayName} — ${roleLabels[u.role] || 'نقش سازمانی'} (${u.id})
                </option>
              `).join('')}
            </select>
          </div>
          <div style="display: flex; gap: 0.75rem; align-items: center;">
            <div class="surface-subtle" style="padding: 0.5rem 0.85rem; border-radius: 8px;">
              <div style="font-size: 0.688rem; color: var(--text-secondary);">نقش سازمانی کاربر</div>
              <div style="font-weight: 700; color: var(--accent-cyan); font-size: 0.813rem; margin-top: 0.15rem;">${currentRoleLabel}</div>
            </div>
            <div class="surface-subtle" style="padding: 0.5rem 0.85rem; border-radius: 8px;">
              <div style="font-size: 0.688rem; color: var(--text-secondary);">دامنه سازمانی</div>
              <div style="font-weight: 600; color: var(--text-primary); font-size: 0.813rem; margin-top: 0.15rem;">${tenant.name}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 3-State Legend Bar (GODMODE § GM-14: ارث‌بری / اجازه صریح / منع صریح) -->
      <div class="matrix-legend-bar" style="display: flex; gap: 1rem; align-items: center; justify-content: flex-start; flex-wrap: wrap; margin-bottom: 1rem; padding: 0.6rem 0.85rem; background: var(--bg-surface-subtle, rgba(255,255,255,0.03)); border-radius: 8px; border: 1px solid var(--border-subtle, rgba(255,255,255,0.08)); font-size: 0.813rem;">
        <span style="font-weight: 600; color: var(--text-secondary);">وضعیت‌های سه‌گانه هر سلول:</span>
        <div style="display: flex; align-items: center; gap: 0.35rem;">
          <span class="matrix-state-btn state-inherit" style="cursor: default; padding: 0.2rem 0.55rem; font-size: 0.75rem;">⤾ ارث‌بری</span>
          <span class="text-secondary" style="font-size: 0.75rem;">(پیروی از مجوز نقش پیش‌فرض)</span>
        </div>
        <div style="display: flex; align-items: center; gap: 0.35rem;">
          <span class="matrix-state-btn state-allow" style="cursor: default; padding: 0.2rem 0.55rem; font-size: 0.75rem;">✓ اجازه صریح</span>
          <span class="text-secondary" style="font-size: 0.75rem;">(اعطای صریح به کاربر)</span>
        </div>
        <div style="display: flex; align-items: center; gap: 0.35rem;">
          <span class="matrix-state-btn state-deny" style="cursor: default; padding: 0.2rem 0.55rem; font-size: 0.75rem;">⛔ منع صریح</span>
          <span class="text-secondary" style="font-size: 0.75rem;">(ابطال قطعی اختیارات حتی برای مالک)</span>
        </div>
      </div>

      <!-- Access Matrix Table Container (Sticky Header & Sticky Columns) -->
      <div class="access-matrix-wrapper" role="region" aria-label="ماتریس دسترسی‌ها و نقش‌ها">
        <table class="access-matrix-table" aria-label="جدول ماتریس دسترسی‌ها و نقش‌ها">
          <thead>
            <tr>
              <th class="sticky-col" style="min-width: 260px;">عملیات و مجوز سیستم</th>
              <th style="min-width: 130px; text-align: center;">مالک (Owner)</th>
              <th style="min-width: 130px; text-align: center;">مدیر عملیاتی (Manager)</th>
              <th style="min-width: 130px; text-align: center;">حسابدار (Accountant)</th>
              <th style="min-width: 130px; text-align: center;">صندوق‌دار (Cashier)</th>
              <th style="min-width: 130px; text-align: center;">گارسون (Waiter)</th>
              <th style="min-width: 130px; text-align: center;">آشپزخانه (Kitchen)</th>
              <th style="min-width: 180px; text-align: center; background: rgba(99, 102, 241, 0.08); border-right: 2px solid rgba(99, 102, 241, 0.3);">
                شخص منتخب: <strong style="color: var(--accent-cyan);">${currentUser.displayName.split(' ')[0]}</strong>
              </th>
            </tr>
          </thead>
          <tbody>
            ${this.groups.map(g => {
              const groupPerms = g.permissions.filter(filterFn);
              if (groupPerms.length === 0) return '';

              return `
                <!-- Group Header Row with Safe Bulk Group Action -->
                <tr class="matrix-module-header">
                  <td colspan="8">
                    <div class="matrix-module-title-group">
                      <div class="matrix-module-name">
                        <span>${g.icon}</span>
                        <span>${g.name}</span>
                        <span class="badge badge-neutral" style="font-size: 0.725rem;">${groupPerms.length} مجوز</span>
                      </div>
                      <button type="button" class="btn btn-secondary btn-xs" onclick="window.GMViews.GM14.openBulkGroupModal('${g.id}')" title="ویرایش گروهی امن برای تمام مجوزهای این ماژول">
                        ویرایش گروهی امن ⚙
                      </button>
                    </div>
                  </td>
                </tr>

                <!-- Permission Rows -->
                ${groupPerms.map(p => {
                  const ov = userOverrides[p.key] || { state: 'inherit', reason: 'پیش‌فرض نقش', updatedAt: '-' };
                  const isRoleAllowed = p.defRoles.includes(currentUser.role);
                  const isOwner = currentUser.role === 'owner';

                  // Formula: Decision = IdentityActive && TenantActive && FeatureEntitled && (RoleAllow || PersonalAllow) && !PersonalDeny
                  let finalResult = 'مجاز';
                  let finalStateClass = 'state-allow';
                  let explanation = `مجوز از طریق نقش ${currentRoleLabel} برقرار است.`;

                  if (ov.state === 'deny') {
                    finalResult = '⛔ منع صریح';
                    finalStateClass = 'state-deny';
                    explanation = `منع صریح شخصی: لغو کلیه اختیارات نقش (حتی برای مالک).`;
                  } else if (ov.state === 'allow') {
                    finalResult = '✓ اجازه صریح';
                    finalStateClass = 'state-allow';
                    explanation = `اجازه صریح شخصی به کاربر اعطا شده است.`;
                  } else {
                    // inherit
                    finalResult = '⤾ ارث‌بری';
                    finalStateClass = 'state-inherit';
                    if (!isRoleAllowed) {
                      explanation = `ارث‌بری از نقش ${currentRoleLabel}: نقش فاقد این مجوز است (غیرمجاز).`;
                    } else {
                      explanation = `ارث‌بری از نقش ${currentRoleLabel}: نقش دارای این مجوز است (مجاز).`;
                    }
                  }

                  const searchText = `${p.name} ${p.key} ${g.name}`.toLowerCase();

                  return `
                    <tr class="matrix-perm-row" data-search-text="${searchText}">
                      <!-- Sticky Right Column: Permission Name & Meta -->
                      <td class="sticky-col">
                        <div style="font-weight: 600; color: var(--text-primary);">${p.name}</div>
                        <div style="display: flex; align-items: center; gap: 0.4rem; margin-top: 0.25rem; flex-wrap: wrap;">
                          <code class="cell-mono" style="font-size: 0.7rem;">${p.key}</code>
                          ${p.sensitive ? '<span class="badge badge-warning" style="font-size: 0.675rem;">عملیات حساس</span>' : ''}
                        </div>
                      </td>

                      <!-- Role 1: Owner -->
                      <td class="matrix-cell">
                        <div class="matrix-tooltip">
                          <span class="matrix-state-btn ${p.defRoles.includes('owner') ? 'state-allow' : 'state-inherit'}">
                            ${p.defRoles.includes('owner') ? '✓ مجاز' : '✕ غیرمجاز'}
                          </span>
                          <span class="tooltip-content">منبع: نقش سازمانی مالک • دامنه: ${p.scope}</span>
                        </div>
                      </td>

                      <!-- Role 2: Manager -->
                      <td class="matrix-cell">
                        <div class="matrix-tooltip">
                          <span class="matrix-state-btn ${p.defRoles.includes('manager') ? 'state-allow' : 'state-inherit'}">
                            ${p.defRoles.includes('manager') ? '✓ مجاز' : '✕ غیرمجاز'}
                          </span>
                          <span class="tooltip-content">منبع: نقش مدیر عملیاتی • دامنه: ${p.scope}</span>
                        </div>
                      </td>

                      <!-- Role 3: Accountant -->
                      <td class="matrix-cell">
                        <div class="matrix-tooltip">
                          <span class="matrix-state-btn ${p.defRoles.includes('accountant') ? 'state-allow' : 'state-inherit'}">
                            ${p.defRoles.includes('accountant') ? '✓ مجاز' : '✕ غیرمجاز'}
                          </span>
                          <span class="tooltip-content">منبع: نقش حسابدار ارشد • دامنه: ${p.scope}</span>
                        </div>
                      </td>

                      <!-- Role 4: Cashier -->
                      <td class="matrix-cell">
                        <div class="matrix-tooltip">
                          <span class="matrix-state-btn ${p.defRoles.includes('cashier') ? 'state-allow' : 'state-inherit'}">
                            ${p.defRoles.includes('cashier') ? '✓ مجاز' : '✕ غیرمجاز'}
                          </span>
                          <span class="tooltip-content">منبع: نقش صندوق‌دار • دامنه: ${p.scope}</span>
                        </div>
                      </td>

                      <!-- Role 5: Waiter -->
                      <td class="matrix-cell">
                        <div class="matrix-tooltip">
                          <span class="matrix-state-btn ${p.defRoles.includes('waiter') ? 'state-allow' : 'state-inherit'}">
                            ${p.defRoles.includes('waiter') ? '✓ مجاز' : '✕ غیرمجاز'}
                          </span>
                          <span class="tooltip-content">منبع: نقش گارسون / سالن‌کار • دامنه: ${p.scope}</span>
                        </div>
                      </td>

                      <!-- Role 6: Kitchen -->
                      <td class="matrix-cell">
                        <div class="matrix-tooltip">
                          <span class="matrix-state-btn ${p.defRoles.includes('kitchen') ? 'state-allow' : 'state-inherit'}">
                            ${p.defRoles.includes('kitchen') ? '✓ مجاز' : '✕ غیرمجاز'}
                          </span>
                          <span class="tooltip-content">منبع: نقش آشپزخانه / سرآشپز • دامنه: ${p.scope}</span>
                        </div>
                      </td>

                      <!-- Selected User Interactive Cell -->
                      <td class="matrix-cell" style="background: rgba(99, 102, 241, 0.04); border-right: 2px solid rgba(99, 102, 241, 0.2);">
                        <div class="matrix-tooltip">
                          <button 
                            type="button" 
                            class="matrix-state-btn ${finalStateClass}"
                            ${currentUser.id ? '' : 'disabled'}
                            onclick="window.GMViews.GM14.openOverrideModal('${currentUser.id}', '${p.key}', '${p.name}', '${ov.state}', '${(ov.reason || '').replace(/'/g, "\\'")}')"
                            aria-label="تغییر وضعیت مجوز ${p.name} برای ${currentUser.displayName}"
                          >
                            ${finalResult}
                          </button>
                          <span class="tooltip-content">
                            منبع: ${ov.state === 'inherit' ? 'ارث‌بری از نقش ' + currentRoleLabel : ov.state === 'deny' ? 'منع صریح شخصی: لغو کلیه اختیارات نقش (حتی برای مالک)' : 'اجازه صریح شخصی'}
                            <br />دلیل: ${ov.reason || 'پیش‌فرض'}
                            <br />دامنه: ${p.scope}
                          </span>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              `;
            }).join('')}
          </tbody>
        </table>
      </div>

      <!-- Mobile Permission Cards Layout (GODMODE § GM-14: روی موبایل هر Permission یک Card) -->
      <div class="matrix-mobile-cards" role="region" aria-label="کارت‌های دسترسی موبایل">
        ${allPerms.filter(filterFn).map(p => {
          const ov = userOverrides[p.key] || { state: 'inherit', reason: 'پیش‌فرض نقش' };
          const searchText = `${p.name} ${p.key}`.toLowerCase();

          return `
            <div class="mobile-permission-card" data-search-text="${searchText}">
              <div class="mobile-card-header">
                <div>
                  <strong style="color: var(--text-primary); font-size: 0.875rem;">${p.name}</strong>
                  <div style="display: flex; gap: 0.35rem; margin-top: 0.25rem;">
                    <code class="cell-mono" style="font-size: 0.7rem;">${p.key}</code>
                    ${p.sensitive ? '<span class="badge badge-warning" style="font-size: 0.65rem;">حساس</span>' : ''}
                  </div>
                </div>
                <button 
                  type="button" 
                  class="btn btn-secondary btn-sm"
                  ${currentUser.id ? '' : 'disabled'}
                  onclick="window.GMViews.GM14.openOverrideModal('${currentUser.id}', '${p.key}', '${p.name}', '${ov.state}', '${(ov.reason || '').replace(/'/g, "\\'")}')"
                >
                  ویرایش
                </button>
              </div>

              <div class="mobile-card-roles-grid">
                <div>مالک: <strong>${p.defRoles.includes('owner') ? '✓ مجاز' : '✕'}</strong></div>
                <div>مدیر: <strong>${p.defRoles.includes('manager') ? '✓ مجاز' : '✕'}</strong></div>
                <div>حسابدار: <strong>${p.defRoles.includes('accountant') ? '✓ مجاز' : '✕'}</strong></div>
                <div>صندوق‌دار: <strong>${p.defRoles.includes('cashier') ? '✓ مجاز' : '✕'}</strong></div>
                <div>گارسون: <strong>${p.defRoles.includes('waiter') ? '✓ مجاز' : '✕'}</strong></div>
                <div>آشپزخانه: <strong>${p.defRoles.includes('kitchen') ? '✓ مجاز' : '✕'}</strong></div>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.775rem; border-top: 1px solid var(--border-subtle); padding-top: 0.4rem;">
                <span class="text-secondary">وضعیت برای ${currentUser.displayName.split(' ')[0]}:</span>
                <span class="badge ${ov.state === 'deny' ? 'badge-danger' : ov.state === 'allow' ? 'badge-success' : 'badge-neutral'}">
                  ${ov.state === 'deny' ? '⛔ منع صریح' : ov.state === 'allow' ? '✓ اجازه صریح' : '⤾ ارث‌بری'}
                </span>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <!-- Concrete Showcase for Owner Effect (Flow 3) -->
      <details class="card progressive-disclosure" style="margin-top: 1.25rem;">
        <summary>
          <span>تحلیل موردی: اثر بر اختیارات مالک (${currentUser.displayName})</span>
          <span class="badge badge-neutral">جزئیات تصمیم</span>
        </summary>
        <div class="card-body">
          <p class="card-subtitle" style="margin: 0 0 0.85rem;">بررسی سلسله‌مراتبی تصمیم‌گیری برای مجوز finance.export در صورت تنظیم منع صریح</p>
          <div class="grid-cols-3">
            <div class="surface-subtle">
              <div style="font-size: 0.688rem; color: var(--text-secondary);">گام ۱: لایسنس مجموعه</div>
              <div style="font-weight: 600; color: var(--state-success); margin-top: 0.35rem; font-size: 0.813rem;">فعال</div>
              <div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.2rem;">ماژول مالی در پلن فعال است</div>
            </div>
            <div class="surface-subtle">
              <div style="font-size: 0.688rem; color: var(--text-secondary);">گام ۲: نقش سازمانی</div>
              <div style="font-weight: 600; color: var(--state-success); margin-top: 0.35rem; font-size: 0.813rem;">مالک مجاز است</div>
              <div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.2rem;">نقش مالک مجاز به خروجی است</div>
            </div>
            <div class="surface-subtle surface-danger">
              <div style="font-size: 0.688rem; color: var(--state-danger);">گام ۳: تنظیم شخصی</div>
              <div style="font-weight: 700; color: var(--state-danger); margin-top: 0.35rem; font-size: 0.813rem;">منع صریح</div>
              <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.2rem;">حکم نهایی: <strong>قطع دسترسی</strong></div>
            </div>
          </div>
        </div>
      </details>
    `;
  },

  // Modal: 3-State Personal Override Modal (with mandatory reason)
  openOverrideModal(userId, permKey, permName, currentState, currentReason) {
    if (!userId) return;
    const store = window.GMStore || window.prototypeStore;
    const identities = (store && store.getIdentities) ? store.getIdentities() : [];
    const user = identities.find(u => u.id === userId);
    if (!user) return;
    
    const content = `
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <div>
          <label class="form-label">کاربر و نقش هدف:</label>
          <div style="font-weight: 600; color: var(--accent-cyan); font-size: 0.875rem;">
            ${user.displayName} — ${user.role === 'owner' ? 'مالک' : user.role === 'admin' ? 'مدیر' : user.role === 'manager' ? 'سرپرست' : 'کاربر'}
          </div>
        </div>

        <div>
          <label class="form-label">تنظیم دسترسی ۳حالته (GODMODE):</label>
          <div style="display: flex; gap: 0.85rem; flex-wrap: wrap;">
            <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; font-size: 0.813rem;">
              <input type="radio" name="override-state" value="inherit" ${currentState === 'inherit' ? 'checked' : ''}>
              <span>ارث‌بری (Inherit)</span>
            </label>
            <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; font-size: 0.813rem; color: #10b981;">
              <input type="radio" name="override-state" value="allow" ${currentState === 'allow' ? 'checked' : ''}>
              <strong>اجازه صریح (Allow)</strong>
            </label>
            <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; font-size: 0.813rem; color: #ef4444;">
              <input type="radio" name="override-state" value="deny" ${currentState === 'deny' ? 'checked' : ''}>
              <strong>منع صریح (Deny)</strong>
            </label>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="modal-override-reason">دلیل تصمیم (الزامی برای ثبت در لاگ ممیزی):</label>
          <textarea id="modal-override-reason" aria-label="دلیل تصمیم برای اعمال وضعیت ارث‌بری، اجازه یا منع صریح" class="form-control" rows="3" placeholder="مثال: دستور حراست به علت بازرسی فصلی یا تعلیق موقت اختیارات...">${currentReason || ''}</textarea>
        </div>

        <div style="background: rgba(245, 158, 11, 0.05); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 6px; padding: 0.6rem 0.75rem; font-size: 0.75rem; color: #fbbf24;">
          <strong>تعهد معماری:</strong> در صورت انتخاب «منع صریح»، این منع بر تمام سطوح لایسنس و نقش مالک برتری داشته و فوراً نشست‌های فعال را باطل می‌کند.
        </div>
      </div>
    `;

    if (window.GMApp && window.GMApp.openModal) {
      window.GMApp.openModal(`تنظیم دسترسی شخصی: ${permName}`, content, () => {
        const checkedEl = document.querySelector('input[name="override-state"]:checked');
        const selectedState = checkedEl ? checkedEl.value : 'inherit';
        const reasonEl = document.getElementById('modal-override-reason');
        const reason = (reasonEl ? reasonEl.value : '').trim();

        if (selectedState !== 'inherit' && !reason) {
          if (window.GMApp && typeof window.GMApp.setFieldError === 'function') {
            window.GMApp.setFieldError(reasonEl, 'ثبت دلیل تصمیم برای حالت‌های allow یا deny اجباری است.');
          }
          if (window.GMApp && typeof window.GMApp.showToast === 'function') {
            window.GMApp.showToast('لطفاً دلیل تصمیم امنیتی را ثبت فرمایید.', 'error');
          }
          return false;
        }

        if (store && store.setPersonalOverride) {
          store.setPersonalOverride(userId, permKey, selectedState, reason || 'بازگشت به ارث‌بری پیش‌فرض');
        }
        const selectedStateLabel = selectedState === 'deny' ? 'منع صریح' : selectedState === 'allow' ? 'اجازه صریح' : 'ارث‌بری';
        window.GMApp.showToast(`وضعیت مجوز ${permName} با موفقیت به «${selectedStateLabel}» تغییر یافت و ثبت شد.`, 'success');
        if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
          window.GMRouter.refresh();
        } else if (window.GMRouter && typeof window.GMRouter.handleRoute === 'function') {
          window.GMRouter.handleRoute();
        }
        return true;
      });
    }
  },

  // Safe Bulk Group Editing (GODMODE § GM-14: «ویرایش گروهی یک گروه، همه زیرعملیات حساس تازه را بی‌صدا Allow نکند»)
  openBulkGroupModal(groupId) {
    if (!this.selectedUserId) return;
    const group = this.groups.find(g => g.id === groupId);
    if (!group) return;

    const sensitivePerms = group.permissions.filter(p => p.sensitive);
    const store = window.GMStore || window.prototypeStore;

    const content = `
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <p style="font-size: 0.813rem; color: var(--text-secondary); margin: 0;">
          تعیین سیاست دسته‌جمعی برای تمام مجوزهای ماژول <strong>«${group.name}»</strong> جهت اعمال بر روی کاربر جاری.
        </p>

        <div>
          <label class="form-label">عملیات گروهی:</label>
          <select id="bulk-group-action" class="form-control" onchange="window.GMViews.GM14.toggleBulkSensitiveWarning(this.value)">
            <option value="inherit">بازنشانی تمام مجوزهای گروه به ارث‌بری نقش (Inherit All)</option>
            <option value="allow_all">اجازه دسته‌جمعی به تمام مجوزهای گروه (Allow All)</option>
            <option value="deny_all">منع دسته‌جمعی تمام مجوزهای گروه (Deny All)</option>
          </select>
        </div>

        <!-- Sensitive Protection Warning Box -->
        <div id="bulk-sensitive-warning" style="display: none; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 8px; padding: 0.75rem;">
          <div style="display: flex; align-items: center; gap: 0.4rem; color: #dc2626; font-weight: 700; font-size: 0.813rem; margin-bottom: 0.4rem;">
            <span>⚠️ هشدار امنیتی GODMODE (بند GM-14):</span>
          </div>
          <p style="font-size: 0.75rem; color: var(--text-secondary); margin: 0 0 0.5rem 0;">
            زیرعملیات حساس تازه نباید به صورت بی‌صدا مجاز شوند. این گروه شامل <strong>${sensitivePerms.length} عملیات حساس</strong> است:
          </p>
          <ul style="font-size: 0.75rem; margin: 0 1rem 0.5rem 0; padding: 0; color: #b91c1c;">
            ${sensitivePerms.map(sp => `<li><strong>${sp.name}</strong> (<code class="cell-mono">${sp.key}</code>)</li>`).join('')}
          </ul>
          <label style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.775rem; color: var(--text-primary); cursor: pointer;">
            <input type="checkbox" id="confirm-sensitive-bulk" />
            <span>مسئولیت امنیتی اعطای دسترسی به این زیرعملیات حساس را می‌پذیرم.</span>
          </label>
        </div>

        <div class="form-group">
          <label class="form-label" for="bulk-reason">دلیل تصمیم برای ثبت در دفتر ممیزی:</label>
          <textarea id="bulk-reason" class="form-control" rows="2" placeholder="دلیل ویرایش دسته‌جمعی گروه..."></textarea>
        </div>
      </div>
    `;

    if (window.GMApp && window.GMApp.openModal) {
      window.GMApp.openModal(`ویرایش گروهی امن: ${group.name}`, content, () => {
        const actionEl = document.getElementById('bulk-group-action');
        const action = actionEl ? actionEl.value : 'inherit';
        const reasonEl = document.getElementById('bulk-reason');
        const reason = (reasonEl ? reasonEl.value : '').trim();
        const confirmCheck = document.getElementById('confirm-sensitive-bulk');

        if (action === 'allow_all') {
          if (!confirmCheck || !confirmCheck.checked) {
            if (window.GMApp && window.GMApp.showToast) {
              window.GMApp.showToast('خطای امنیتی: تایید صریح برای عملیات‌های حساس الزامی است و نباید بی‌صدا Allow شوند.', 'error');
            }
            return false;
          }
        }

        if (action !== 'inherit' && !reason) {
          if (window.GMApp && window.GMApp.showToast) {
            window.GMApp.showToast('لطفاً دلیل تصمیم ممیزی را ثبت فرمایید.', 'error');
          }
          return false;
        }

        const stateMap = { inherit: 'inherit', allow_all: 'allow', deny_all: 'deny' };
        const targetState = stateMap[action] || 'inherit';

        group.permissions.forEach(p => {
          if (store && store.setPersonalOverride) {
            store.setPersonalOverride(this.selectedUserId, p.key, targetState, reason || 'ویرایش دسته‌جمعی گروه');
          }
        });

        if (store && store.addActivity) {
          store.addActivity({
            type: 'bulk_access_override',
            severity: action === 'allow_all' ? 'warning' : 'info',
            title: `ویرایش گروهی امن ماژول ${group.name}`,
            description: `تمام مجوزهای گروه ${group.id} برای کاربر ${this.selectedUserId} به وضعیت ${targetState} تغییر یافت.`,
            subsystem: 'Security',
            actor: 'SuperAdmin'
          });
        }

        if (window.GMApp && window.GMApp.showToast) {
          window.GMApp.showToast(`مجوزهای ماژول ${group.name} با موفقیت به‌روزرسانی شد.`, 'success');
        }

        if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
          window.GMRouter.refresh();
        } else if (window.GMRouter && typeof window.GMRouter.handleRoute === 'function') {
          window.GMRouter.handleRoute();
        }
        return true;
      });
    }
  },

  toggleBulkSensitiveWarning(action) {
    const box = document.getElementById('bulk-sensitive-warning');
    if (box) {
      box.style.display = action === 'allow_all' ? 'block' : 'none';
    }
  }
};

window.renderGM14 = function(params) {
  return window.GMViews.GM14.render(params);
};
