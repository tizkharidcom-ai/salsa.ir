/**
 * prototype/js/views/gm19-devices.js
 * 
 * GM-19: دستگاه‌ها، صندوق‌های فروش و همگام‌سازی آفلاین (/devices)
 * مدیریت ناوگان پایانه‌های لمسی POS، نمایشگرهای آشپزخانه KDS، صف رخدادهای آفلاین و لایسنس اعتباری (Lease)
 */

window.renderGM19 = function(params) {
  const store = window.prototypeStore || window.GMStore;
  const tenants = store && store.getTenants ? store.getTenants() : [];
  const tenantId = (params && params.id) || (store ? store.getActiveTenantId() : 'tnt_westo_demo');
  const isAll = tenantId === 'all';
  const tenant = isAll 
    ? { id: 'all', name: 'تمامی رستوران‌ها و شعب', cellId: 'سراسری' }
    : ((store && store.getTenant ? store.getTenant(tenantId) : null) || { id: tenantId, name: 'کافه وستو', cellId: 'cell-teh-01' });
  const devices = store && store.getDevices ? store.getDevices(tenantId) : [];
  const cellLabel = isAll ? 'سراسری' : ({ 'cell-teh-01': 'تهران', 'cell-msh-01': 'مشهد', 'cell-mashhad-01': 'مشهد' }[tenant.cellId] || 'مرکز عملیاتی');

  return `
    <div class="page-header gm19-page">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
          <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
          <span class="breadcrumb-separator">/</span>
          ${isAll ? '' : `<a href="#gm-04-tenant-detail?id=${tenant.id}" class="breadcrumb-link">پرونده مشتری</a>`}
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current" aria-current="page">سخت‌افزار و پایانه‌ها</span>
        </nav>
        <h1>
          ${isAll ? 'مدیریت ناوگان پایانه‌های پوز (کلان پلتفرم)' : `مدیریت ناوگان دستگاه‌ها: ${tenant.name}`}
          <span class="badge scope-cell-badge">${cellLabel}</span>
          <span class="badge ${isAll ? 'badge-scope-global' : 'badge-scope-tenant'}">
            <span class="status-dot ${isAll ? 'dot-purple' : 'dot-active'}"></span>
            ${isAll ? 'سراسری' : 'دامنه مشتری'}
          </span>
          <span class="page-code-badge">GM-19</span>
        </h1>
        <p>پایش وضعیت لحظه‌ای صندوق‌ها، تبلت‌های آشپزخانه، صف بسته‌های آفلاین و اعتبار مجوز پایانه</p>
      </div>
      <div class="header-actions">
        <button class="btn btn-primary" onclick="window.promptAddDevice('${!isAll ? tenantId : 'tnt_westo_demo'}')">
          ثبت پایانه جدید
        </button>
        <button class="btn btn-secondary" onclick="window.GMDataState ? window.GMDataState.refreshView('GM19') : (window.GMApp ? window.GMApp.showToast('فرمان پایش سلامت سخت‌افزاری به ناوگان ارسال شد', 'info') : null)">
          پایش ناوگان
        </button>
      </div>
    </div>

    <!-- Tenant Scope & Management Correlation Bar -->
    <div class="tenant-correlation-bar" style="background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: 8px; padding: 0.65rem 1rem; margin-bottom: 1.25rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
      <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
        <span style="font-size: 0.813rem; font-weight: 600; color: var(--text-secondary);">همبستگی ناوگان با رستوران:</span>
        <a href="#gm-19-devices?id=all" class="filter-chip ${isAll ? 'active' : ''}">همه رستوران‌ها (${(store ? store.getDevices('all') : []).length})</a>
        ${tenants.map(t => {
          const tDevs = store ? store.getDevices(t.id) : [];
          return `
            <a href="#gm-19-devices?id=${t.id}" class="filter-chip ${tenantId === t.id ? 'active' : ''}">
              ☕ ${t.name} (${tDevs.length})
            </a>
          `;
        }).join('')}
      </div>
      <div style="display: flex; gap: 0.5rem; align-items: center;">
        ${!isAll ? `
          <a href="#gm-04-tenant-detail?id=${tenantId}&tab=devices" class="btn btn-xs btn-secondary" title="مشاهده پرونده کامل">
            پرونده ۳۶۰ درجه ${tenant.name}
          </a>
        ` : ''}
      </div>
    </div>

    ${window.GMDataState ? window.GMDataState.renderFreshnessBar({
      viewId: 'GM19',
      sourceLabel: `ناوگان سخت‌افزاری ${tenant.name}`,
      sourceMode: 'local',
      totalCount: devices.length,
      countLabel: 'دستگاه'
    }) : ''}

    ${(() => {
      const dataState = window.GMDataState ? window.GMDataState.getViewState('GM19') : { state: 'live' };
      if (dataState.state === 'failed' || dataState.state === 'error') {
        return window.GMDataState.renderFailedState({
          viewId: 'GM19',
          title: 'عدم پاسخگویی ارتباط با عامل‌های اجرایی محلی',
          reason: 'ارتباط سوکت امن با تجهیزات سخت‌افزاری مستقر در شعب برقرار نشد.',
          errorCode: 'ERR_EDGE_AGENT_TIMEOUT'
        });
      }
      if (dataState.state === 'empty') {
        return window.GMDataState.renderEmptyState({
          icon: '<span class="status-dot dot-warning"></span>',
          title: 'هیچ پایانه‌ای برای این مجموعه ثبت نشده است',
          description: 'هیچ صندوق فروش یا نمایشگر KDS فعالی یافت نشد.',
          actionLabel: 'پایش مجدد سخت‌افزار',
          onAction: "window.GMDataState.refreshView('GM19')"
        });
      }
      if (dataState.state === 'loading') {
        return window.GMDataState.renderSkeleton('table', 4);
      }
      if (dataState.state === 'stale') {
        return window.GMDataState.renderStaleBanner('GM19');
      }
      if (dataState.state === 'refreshing') {
        return window.GMDataState.renderRefreshingBanner ? window.GMDataState.renderRefreshingBanner('GM19') : '';
      }
      return '';
    })()}

    ${(window.GMDataState && ['failed', 'empty', 'error', 'loading'].includes(window.GMDataState.getViewState('GM19').state)) ? '' : `
    <!-- Offline Architecture Banner -->
    <div style="background: var(--state-info-subtle); border: 1px solid var(--status-loading-border); border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 1.25rem;">
      <div style="font-weight: 600; color: var(--accent-cyan); font-size: 0.813rem; margin-bottom: 0.2rem;">تاب‌آوری در قطعی ارتباط و معماری آفلاین (Offline-First Architecture):</div>
      <div style="font-size: 0.75rem; color: var(--text-secondary); line-height: 1.5;">
        پایگاه‌داده مرکزی PostgreSQL به عنوان منبع واحد حقیقت (Cloud Source of Truth)؛ ذخیره‌سازی محلی کلاینت (Edge Local Store) مجهز به صف برون‌داد (Outbox Queue)، مکانیسم تلاش مجدد (Retry)، مدیریت تعارض و ثبت کرسر آخرین همگام‌سازی (Last Sync Cursor) برای تداوم ۱۰۰٪ عملیات صندوق و فروش.
      </div>
    </div>

    <!-- Fleet Overview Cards -->
    <div class="grid-cols-4" style="margin-bottom: 1.25rem;">
      <div class="card stat-card">
        <div class="stat-header"><span>کل پایانه‌های فعال</span></div>
        <div class="stat-value">${devices.length}</div>
        <div class="stat-footer"><span class="badge badge-neutral">ناوگان ${tenant.name}</span></div>
      </div>

      <div class="card stat-card">
        <div class="stat-header"><span>پایانه‌های برخط</span></div>
        <div class="stat-value" style="color: #10b981;">${devices.filter(d => d.status === 'online').length}</div>
        <div class="stat-footer"><span class="badge badge-success"><span class="status-dot dot-green"></span> ناوگان برخط و متصل</span></div>
      </div>

      <div class="card stat-card">
        <div class="stat-header"><span>دستگاه‌های آفلاین محلی</span></div>
        <div class="stat-value" style="color: #64748b;">${devices.filter(d => d.status === 'offline').length}</div>
        <div class="stat-footer"><span class="badge badge-neutral">ارتباط پایدار بدون قطعی</span></div>
      </div>

      <div class="card stat-card">
        <div class="stat-header"><span>صف در انتظار همگام‌سازی</span></div>
        <div class="stat-value">${devices.reduce((sum, d) => sum + (d.pendingQueue || 0), 0)}</div>
        <div class="stat-footer"><span class="badge badge-success"><span class="status-dot dot-green"></span> تمام فاکتورها همگام‌شده</span></div>
      </div>
    </div>

    <!-- Devices Table -->
    <div class="table-wrapper">
      <div class="table-toolbar" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
        <div class="table-filters" id="devicesStatusChips" role="group" aria-label="فیلتر وضعیت اتصال پایانه‌ها">
          <button class="filter-chip active" data-status="all" aria-pressed="true" onclick="window.GMViews.GM19.setStatusFilter('all')">
            همه پایانه‌ها (${devices.length})
          </button>
          <button class="filter-chip" data-status="online" aria-pressed="false" onclick="window.GMViews.GM19.setStatusFilter('online')">
            برخط (${devices.filter(d => d.status === 'online').length})
          </button>
          <button class="filter-chip" data-status="offline" aria-pressed="false" onclick="window.GMViews.GM19.setStatusFilter('offline')">
            آفلاین (${devices.filter(d => d.status === 'offline').length})
          </button>
          <button class="filter-chip" data-status="queued" aria-pressed="false" onclick="window.GMViews.GM19.setStatusFilter('queued')">
            دارای صف (${devices.filter(d => (d.pendingQueue || 0) > 0).length})
          </button>
        </div>

        <div class="table-search-group">
          <span id="devicesFilterCount" class="filter-count-badge">نمایش ${devices.length.toLocaleString('fa-IR')} از ${devices.length.toLocaleString('fa-IR')} پایانه</span>
          <div class="search-input-wrapper" id="devicesSearchWrapper">
            <input type="text" id="deviceSearchInput" class="form-control" placeholder="جست‌وجو در عنوان، شعبه یا IP..." style="width: 220px; padding: 0.35rem 0.75rem;" aria-label="جست‌وجو در پایانه‌ها" oninput="window.GMViews.GM19.search(this.value)" />
            <button class="search-clear-btn" onclick="window.GMViews.GM19.clearSearch()" aria-label="پاکسازی جستجو">✕</button>
          </div>
        </div>
      </div>
      <div class="table-responsive">
        <table class="data-table" id="devicesTable" aria-label="جدول پایانه‌ها و دستگاه‌های متصل به پلتفرم">
          <thead>
            <tr>
              <th class="col-checkbox"><input type="checkbox" id="devices-select-all" aria-label="انتخاب همه پایانه‌های جدول" /></th>
              <th>پایانه</th>
              <th>رستوران والد</th>
              <th>شعبه استقرار</th>
              <th>پلتفرم سخت‌افزار</th>
              <th>جزئیات اتصال</th>
              <th>نسخه کلاینت</th>
              <th>وضعیت اتصال</th>
              <th>اعتبار Lease محلی</th>
              <th>بسته‌های صف</th>
              <th>آخرین Sync</th>
              <th class="cell-actions">عملیات</th>
            </tr>
          </thead>
          <tbody>
            ${devices.map(dev => `
              <tr id="row-device-${dev.id}" data-id="${dev.id}" data-status="${dev.status}" data-queue="${dev.pendingQueue || 0}" data-search="${dev.name} ${dev.id} ${dev.branch} ${dev.ipAddress} ${dev.type} ${dev.status}">
                <td class="col-checkbox">
                  <input type="checkbox" class="device-row-select" data-id="${dev.id}" data-name="${dev.name}" aria-label="انتخاب پایانه ${dev.name}" />
                </td>
                <td>
                  <strong style="color: var(--text-primary);">${dev.name}</strong>
                  <details class="row-disclosure devices-technical-details">
                    <summary>شناسه پایانه</summary>
                    <code class="cell-mono">${dev.id}</code>
                  </details>
                </td>
                <td>
                  <a href="#gm-04-tenant-detail?id=${dev.tenantId}&tab=devices" class="badge badge-neutral" style="text-decoration: none; display: inline-flex; align-items: center; gap: 0.3rem;" title="مشاهده پرونده رستوران">
                    <span>☕ کافه وستو</span>
                  </a>
                </td>
                <td style="color: var(--text-secondary);">${dev.branch}</td>
                <td><span class="badge badge-neutral">${dev.type}</span></td>
                <td>
                  <span class="badge badge-neutral">${dev.status === 'online' ? 'اتصال برقرار' : 'اتصال قطع'}</span>
                  <details class="row-disclosure devices-technical-details">
                    <summary>نمایش تنظیمات اتصال</summary>
                    <code class="nav-code">${dev.ipAddress}</code>
                  </details>
                </td>
                <td><span class="cell-mono" style="font-size: 0.75rem;">${dev.appVersion}</span></td>
                <td>
                  ${dev.status === 'online'
                    ? '<span class="badge badge-success"><span class="badge-dot"></span> برخط</span>'
                    : '<span class="badge badge-danger"><span class="badge-dot"></span> آفلاین</span>'
                  }
                </td>
                <td style="font-size: 0.75rem; color: var(--text-secondary);">
                  <span>${String(dev.leaseStatus || '').includes('active') ? 'معتبر' : 'نیازمند بررسی'}</span>
                  <details class="row-disclosure devices-technical-details"><summary>جزئیات مجوز</summary><span>${dev.leaseStatus}</span></details>
                </td>
                <td>
                  ${dev.pendingQueue > 0
                    ? `<span class="badge badge-warning">${dev.pendingQueue} سفارش</span>`
                    : '<span class="badge badge-success">همگام‌سازی کامل</span>'
                  }
                </td>
                <td style="font-size: 0.75rem; color: var(--text-tertiary, #64748b);">${dev.lastSync}</td>
                <td class="cell-actions">
                  <div style="display: inline-flex; gap: 0.35rem; justify-content: flex-end;">
                    ${(dev.type && (dev.type.includes('صندوق') || dev.type.includes('POS'))) ? `
                      <a href="${(typeof GMPageContracts !== 'undefined' && GMPageContracts.westoClientOrigin) ? GMPageContracts.westoClientOrigin.page('/pos.html') : 'http://localhost:4180/pos.html'}" target="_blank" rel="noopener" class="btn btn-outline-cyan btn-sm" title="ورود به پایانه صندوق وستو">ورود به POS ↗</a>
                    ` : (dev.type && (dev.type.includes('KDS') || dev.type.includes('آشپزخانه'))) ? `
                      <a href="${(typeof GMPageContracts !== 'undefined' && GMPageContracts.westoClientOrigin) ? GMPageContracts.westoClientOrigin.page('/kitchen.html') : 'http://localhost:4180/kitchen.html'}" target="_blank" rel="noopener" class="btn btn-outline-cyan btn-sm" title="نمایشگر آشپزخانه وستو">نمایشگر KDS ↗</a>
                    ` : (dev.type && (dev.type.includes('گارسون') || dev.type.includes('سالن') || dev.type.includes('تبلت'))) ? `
                      <a href="${(typeof GMPageContracts !== 'undefined' && GMPageContracts.westoClientOrigin) ? GMPageContracts.westoClientOrigin.page('/waiter.html') : 'http://localhost:4180/waiter.html'}" target="_blank" rel="noopener" class="btn btn-outline-cyan btn-sm" title="پایانه سالن و گارسون وستو">پایانه سالن ↗</a>
                    ` : ''}
                    <button class="btn btn-secondary btn-sm" onclick="window.GMViews.GM19.pingSingleDevice('${dev.id}', '${dev.name}')" title="پایش سلامت اتصال پایانه">
                      پایش
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="window.openGM19DeviceDrawer('${dev.id}', '${dev.name}')" aria-label="مشاهده لاگ تشخیصی پایانه ${dev.name}">
                      عیب‌یابی
                    </button>
                  </div>
                </td>
              </tr>
            `).join('')}
            <tr id="devices-empty-row" style="display: none;">
              <td colspan="12" class="table-empty-cell" style="text-align: center; padding: 2.5rem 1rem; color: var(--text-secondary);">
                <div style="font-size: 0.875rem; font-weight: 600; color: var(--text-primary); margin-bottom: 0.35rem;">هیچ پایانه‌ای با این مشخصات پیدا نشد</div>
                <div style="font-size: 0.75rem; color: var(--text-tertiary, #64748b); margin-bottom: 0.85rem;">می‌توانید فیلتر وضعیت را به «همه پایانه‌ها» بازگردانید یا جست‌وجو را پاک کنید.</div>
                <button class="btn btn-secondary btn-sm" onclick="window.GMViews.GM19.resetAll()">پاکسازی فیلتر و جست‌وجو</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Bulk Actions Docked Bar -->
    <div id="gm19-bulk-actions" class="table-bulk-actions-bar" role="toolbar" aria-label="عملیات گروهی روی پایانه‌های انتخاب‌شده">
      <div class="bulk-actions-info">
        <span class="bulk-counter-badge" id="gm19-bulk-count">۰ مورد انتخاب‌شده</span>
        <span class="bulk-actions-label">اقدامات دسته‌جمعی:</span>
      </div>
      <div class="bulk-actions-btns">
        <button type="button" class="btn btn-primary btn-sm" id="gm19-bulk-ping-btn" onclick="window.GMViews.GM19.pingSelectedDevices()" disabled>
          پینگ هم‌زمان پایانه‌ها
        </button>
        <button type="button" class="btn btn-secondary btn-sm" id="gm19-bulk-lease-btn" onclick="window.GMViews.GM19.renewSelectedLease()" disabled>
          تمدید مجوز آفلاین (Lease)
        </button>
        <button type="button" class="bulk-clear-btn" onclick="window.GMViews.GM19.clearSelection()">
          لغو انتخاب
        </button>
      </div>
    </div>
    `}
  `;
  setTimeout(() => {
    if (window.GMViews.GM19 && typeof window.GMViews.GM19.initSelection === 'function') {
      window.GMViews.GM19.initSelection();
    }
  }, 0);
};

window.openGM19DeviceDrawer = function(deviceId, deviceName) {
  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div>
        <div style="font-size: 0.75rem; color: var(--text-secondary);">شناسه دستگاه:</div>
        <div class="cell-mono" style="font-weight: 700; font-size: 0.95rem; color: var(--accent-cyan); margin-top: 0.15rem;">${deviceId}</div>
      </div>

      <div style="display: flex; gap: 0.5rem;">
        <button class="btn btn-secondary btn-sm" onclick="window.GMApp ? window.GMApp.showToast('پایش سلامت برای پایانه با موفقیت ارسال شد.', 'success') : null">
          ارسال پایش سلامت
        </button>
        <button class="btn btn-secondary btn-sm" onclick="window.GMApp ? window.GMApp.showToast('مجوز آفلاین پایانه با موفقیت تمدید شد.', 'success') : null">
          تمدید اعتبار آفلاین
        </button>
      </div>

      <div style="border-top: 1px solid var(--border-default); padding-top: 0.85rem;">
        <label class="form-label" style="font-size: 0.813rem; font-weight: 600; color: var(--text-primary);">تاریخچه رویدادهای اخیر پایانه:</label>
        <div class="kv-list" style="margin-top: 0.5rem; font-size: 0.75rem;">
          <div class="surface-subtle" style="padding: 0.6rem 0.75rem;">
            <div class="text-strong text-success">همگام‌سازی موفق فاکتورها و صف سفارشات</div>
            <div class="text-tertiary" style="font-size: 0.688rem; margin-top: 0.15rem;">سوابق به‌روزرسانی شده است</div>
          </div>
          <div class="surface-subtle" style="padding: 0.6rem 0.75rem;">
            <div class="text-strong text-success">اتصال چاپگر فیش و پوز بانکی تأیید شد</div>
            <div class="text-tertiary" style="font-size: 0.688rem; margin-top: 0.15rem;">وضعیت چاپگر پایدار است</div>
          </div>
          <div class="surface-subtle" style="padding: 0.6rem 0.75rem;">
            <div class="text-strong text-success">ماتریس دسترسی محلی به‌روزرسانی شد</div>
            <div class="text-tertiary" style="font-size: 0.688rem; margin-top: 0.15rem;">سرویس برخط است</div>
          </div>
        </div>
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openDrawer) {
    window.GMApp.openDrawer(`لاگ تشخیصی و کنترل پایانه: ${deviceName}`, content);
  }
};

window.GMViews = window.GMViews || {};
window.GMViews.GM19 = {
  render: window.renderGM19,
  statusFilter: 'all',
  searchQuery: '',
  tableSelect: null,

  afterRender() {
    this.initSelection();
  },

  initSelection() {
    if (window.GMTableSelect) {
      this.tableSelect = window.GMTableSelect.initTable('#devicesTable', {
        selectAllSelector: '#devices-select-all',
        rowCheckboxSelector: '.device-row-select',
        bulkBarId: 'gm19-bulk-actions',
        countBadgeId: 'gm19-bulk-count'
      });
    }
  },

  clearSelection() {
    if (this.tableSelect) {
      this.tableSelect.clear();
    }
  },

  setStatusFilter(status) {
    this.statusFilter = status;
    const chips = document.querySelectorAll('#devicesStatusChips .filter-chip');
    chips.forEach(c => {
      const match = c.getAttribute('data-status') === status;
      if (match) {
        c.classList.add('active');
        c.setAttribute('aria-pressed', 'true');
      } else {
        c.classList.remove('active');
        c.setAttribute('aria-pressed', 'false');
      }
    });
    this.applyFilters();
  },

  search(q) {
    this.searchQuery = q || '';
    this.applyFilters();
  },

  clearSearch() {
    this.searchQuery = '';
    const input = document.getElementById('deviceSearchInput');
    if (input) {
      input.value = '';
      input.focus();
    }
    this.applyFilters();
  },

  resetAll() {
    this.searchQuery = '';
    const input = document.getElementById('deviceSearchInput');
    if (input) input.value = '';
    this.setStatusFilter('all');
    if (this.tableSelect) {
      this.tableSelect.clear();
    }
  },

  applyFilters() {
    const q = (this.searchQuery || '').trim().toLowerCase();
    const status = this.statusFilter;
    const rows = document.querySelectorAll('table.data-table tbody tr[id^="row-device-"]');
    const emptyRow = document.getElementById('devices-empty-row');
    const countBadge = document.getElementById('devicesFilterCount');
    const searchWrapper = document.getElementById('devicesSearchWrapper');

    if (searchWrapper) {
      if (q) searchWrapper.classList.add('has-value');
      else searchWrapper.classList.remove('has-value');
    }

    let visibleCount = 0;
    const totalCount = rows.length;

    rows.forEach(r => {
      const rowStatus = r.getAttribute('data-status');
      const queueCount = parseInt(r.getAttribute('data-queue') || '0', 10);
      const rowText = (r.getAttribute('data-search') || r.innerText).toLowerCase();

      let statusMatch = status === 'all';
      if (status === 'online') statusMatch = rowStatus === 'online';
      else if (status === 'offline') statusMatch = rowStatus === 'offline';
      else if (status === 'queued') statusMatch = queueCount > 0;

      const searchMatch = !q || rowText.includes(q);
      const isVisible = statusMatch && searchMatch;

      r.style.display = isVisible ? '' : 'none';
      if (isVisible) visibleCount++;
    });

    if (emptyRow) {
      emptyRow.style.display = (visibleCount === 0 && totalCount > 0) ? '' : 'none';
    }

    if (countBadge) {
      countBadge.innerText = `نمایش ${visibleCount.toLocaleString('fa-IR')} از ${totalCount.toLocaleString('fa-IR')} پایانه`;
    }

    if (this.tableSelect) {
      this.tableSelect.sync();
    }
  },

  pingSingleDevice(deviceId, deviceName) {
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast(`دستور پایش پایانه «${deviceName}» ارسال شد؛ ارتباط اولیه با سرور پایانه برقرار و در انتظار تأیید اتصال است.`, 'warning');
    }
  },

  pingSelectedDevices() {
    if (!this.tableSelect) return;
    const ids = this.tableSelect.getSelectedIds();
    if (ids.length === 0) {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast('لطفاً حداقل یک پایانه را برای پایش انتخاب فرمایید.', 'warning');
      }
      return;
    }
    const store = window.GMStore || window.prototypeStore;
    if (store && store.addActivity) {
      store.addActivity({
        type: 'device_bulk_ping',
        severity: 'info',
        title: `پینگ هم‌زمان ${ids.length} پایانه فروش`,
        description: `درخواست پایش پایانه‌های ${ids.join(', ')} با موفقیت اجرا شد.`,
        subsystem: 'Devices',
        route: '#gm-19-devices',
        routeLabel: 'GM-19 پایانه‌ها و POS',
        actor: 'SuperAdmin (ناظر)',
        details: { deviceIds: ids }
      });
    }
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast(`دستور پایش ${ids.length.toLocaleString('fa-IR')} پایانه در Mock ثبت شد؛ تا دریافت پاسخ گره‌ها در جریان است.`, 'info');
    }
  },

  renewSelectedLease() {
    if (!this.tableSelect) return;
    const ids = this.tableSelect.getSelectedIds();
    if (ids.length === 0) {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast('لطفاً حداقل یک پایانه را برای تمدید لایسنس انتخاب فرمایید.', 'warning');
      }
      return;
    }
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast(`درخواست تمدید مجوز ${ids.length.toLocaleString('fa-IR')} پایانه ثبت شد؛ تا دریافت ACK، مجوز واقعی تغییر نکرد.`, 'info');
    }
  }
};

window.promptAddDevice = function(tenantId) {
  const store = window.prototypeStore || window.GMStore;
  const tenant = (store && store.getTenant ? store.getTenant(tenantId) : null) || { id: tenantId, name: 'رستوران' };
  const name = prompt(`عنوان پایانه پوز یا KDS جدید برای ${tenant.name} را وارد کنید:`, 'صندوق جدید سالن');
  if (!name) return;
  const newDev = {
    id: 'dev_pos_' + Date.now().toString().slice(-4),
    tenantId: tenantId,
    branch: 'شعبه مرکزی',
    name: name,
    type: 'Desktop POS (Windows/Electron)',
    ipAddress: '۱۹۲.۱۶۸.۱.' + Math.floor(100 + Math.random() * 50),
    appVersion: 'v1.2.0-desktop',
    syncState: 'in_sync',
    pendingQueue: 0,
    leaseStatus: 'active (معتبر تا ۶ ساعت)',
    lastSync: 'هم‌اکنون',
    status: 'online'
  };
  if (store && store.state && Array.isArray(store.state.devices)) {
    store.state.devices.push(newDev);
    store.save();
    store.addActivity({
      type: 'device_registered',
      severity: 'info',
      title: `ثبت پایانه پوز جدید در ${tenant.name}`,
      description: `پایانه ${name} (${newDev.id}) با موفقیت در ناوگان فعال شد.`,
      subsystem: 'Devices',
      route: '#gm-19-devices?id=' + tenantId,
      routeLabel: 'GM-19 پایانه‌ها و POS',
      actor: 'SuperAdmin'
    });
  }
  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast(`پایانه «${name}» با موفقیت به ناوگان اضافه شد.`, 'success');
  }
  if (window.location && window.GMRouter && typeof window.GMRouter.handleRoute === 'function') {
    window.GMRouter.handleRoute();
  }
};
