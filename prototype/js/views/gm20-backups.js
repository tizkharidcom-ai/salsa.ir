/**
 * prototype/js/views/gm20-backups.js
 * 
 * GM-20: پشتیبان‌گیری و آزمون‌های بازیابی خودکار (/backups)
 * مدیریت اسنپ‌شات‌های روزانه، آرشیو لاگ تراکنشی WAL، تطبیق چک‌سام هش و دریل‌های بازیابی در محیط ایزوله
 */

window.GMViews = window.GMViews || {};

window.renderGM20 = function(params) {
  const store = window.prototypeStore || window.GMStore;
  const tenants = store && store.getTenants ? store.getTenants() : [];
  const tenantId = (params && params.id) || (store ? store.getActiveTenantId() : 'tnt_westo_demo');
  const isAll = tenantId === 'all';
  const tenant = isAll 
    ? { id: 'all', name: 'تمامی رستوران‌ها و پایگاه‌های داده', cellId: 'سراسری' }
    : ((store && store.getTenant ? store.getTenant(tenantId) : null) || { id: tenantId, name: 'کافه وستو', cellId: 'cell-teh-01' });
  const backups = store && store.getBackups ? store.getBackups(tenantId) : [];
  const backupSource = backups.length ? 'ذخیره‌ساز امن ابری NEEM (پایش پیوسته)' : 'بدون اسنپ‌شات قابل مشاهده';
  const cellLabel = isAll ? 'سراسری' : ({ 'cell-teh-01': 'تهران', 'cell-msh-01': 'مشهد', 'cell-mashhad-01': 'مشهد' }[tenant.cellId] || 'مرکز عملیاتی');

  return `
    <div class="page-header gm20-page">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
          <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
          <span class="breadcrumb-separator">/</span>
          ${isAll ? '' : `<a href="#gm-04-tenant-detail?id=${tenant.id}" class="breadcrumb-link">پرونده مشتری</a>`}
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current" aria-current="page">پشتیبان‌گیری</span>
        </nav>
        <h1>
          ${isAll ? 'پشتیبان و بازیابی کل پلتفرم' : `پشتیبان و بازیابی: ${tenant.name}`}
          <span class="badge scope-cell-badge">${cellLabel}</span>
          <span class="badge ${isAll ? 'badge-scope-global' : 'badge-scope-tenant'}">
            <span class="status-dot ${isAll ? 'dot-purple' : 'dot-active'}"></span>
            ${isAll ? 'سراسری' : 'دامنه مشتری'}
          </span>
          <span class="page-code-badge">GM-20</span>
        </h1>
        <p>مدیریت نسخه‌های پشتیبان دیتابیس مستقل، اعتبارسنجی خودکار بازیابی و پایش سلامت دریل‌ها</p>
      </div>
      <div class="header-actions">
        <button class="btn btn-primary" onclick="window.triggerGM20ManualBackup('${!isAll ? tenantId : 'tnt_westo_demo'}')">
          تهیه بکاپ اضطراری فوری
        </button>
        <button class="btn btn-secondary" onclick="window.triggerGM20RestoreDrill ? window.triggerGM20RestoreDrill() : (window.GMApp ? window.GMApp.showToast('دریل آزمایشی بازیابی نسخه پشتیبان آغاز شد', 'info') : null)">
          دریل بازیابی آزمایشی
        </button>
      </div>
    </div>

    ${window.GMDataState ? window.GMDataState.renderFreshnessBar({
      viewId: 'GM20',
      sourceLabel: 'مخزن نسخه‌های پشتیبان، ذخیره‌ساز و آزمون‌های بازیابی',
      sourceMode: 'local',
      totalCount: backups.length,
      countLabel: 'نسخه پشتیبان ثبت‌شده'
    }) : ''}

    ${(() => {
      const dataState = window.GMDataState ? window.GMDataState.getViewState('GM20') : { state: 'live' };
      if (dataState.state === 'failed' || dataState.state === 'error') {
        return window.GMDataState.renderFailedState({
          viewId: 'GM20',
          title: 'خطا در واکشی اسنپ‌شات‌های پشتیبان',
          reason: 'ارتباط با مخزن ابری ذخیره‌سازی یا رجیستری متادیتا برقرار نشد.',
          errorCode: 'ERR_BACKUP_STORAGE_UNREACHABLE'
        });
      }
      if (dataState.state === 'empty') {
        return window.GMDataState.renderEmptyState({
          title: 'هیچ نسخه پشتیبانی یافت نشد',
          summary: 'عدم وجود اسنپ‌شات یا نسخه پشتیبان نقطه‌ای در مخزن ذخیره‌سازی ابری',
          description: 'هیچ اسنپ‌شاتی برای پایگاه داده انتخاب‌شده در مخزن آبجکت‌استوریج ثبت نگردیده است.',
          auditScope: 'اسنپ‌شات‌های دوره‌ای WAL، فایل‌های پشتیبان کامل پایگاه داده و کلیدهای رمزنگاری',
          actionLabel: 'تهیه اسنپ‌شات اضطراری فوری',
          onAction: `window.triggerGM20ManualBackup('${!isAll ? tenantId : 'tnt_westo_demo'}')`
        });
      }
      if (dataState.state === 'loading') {
        return window.GMDataState.renderSkeleton('table', 4);
      }
      if (dataState.state === 'stale') {
        return window.GMDataState.renderStaleBanner('GM20');
      }
      if (dataState.state === 'refreshing') {
        return window.GMDataState.renderRefreshingBanner ? window.GMDataState.renderRefreshingBanner('GM20') : '';
      }
      return '';
    })()}

    ${(window.GMDataState && ['failed', 'empty', 'error', 'loading'].includes(window.GMDataState.getViewState('GM20').state)) ? '' : `
    <!-- Tenant Scope & Correlation Bar -->
    <div class="tenant-correlation-bar" style="background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: 8px; padding: 0.65rem 1rem; margin-bottom: 1.25rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
      <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
        <span style="font-size: 0.813rem; font-weight: 600; color: var(--text-secondary);">دیتابیس مستقل رستوران:</span>
        <a href="#gm-20-backups?id=all" class="filter-chip ${isAll ? 'active' : ''}">همه دیتابیس‌ها (${(store ? store.getBackups('all') : []).length})</a>
        ${tenants.map(t => {
          const tBkp = store ? store.getBackups(t.id) : [];
          return `
            <a href="#gm-20-backups?id=${t.id}" class="filter-chip ${tenantId === t.id ? 'active' : ''}">
              ${t.name} (${tBkp.length})
            </a>
          `;
        }).join('')}
      </div>
      <div style="display: flex; gap: 0.5rem; align-items: center;">
        ${!isAll ? `
          <a href="#gm-04-tenant-detail?id=${tenantId}&tab=backups" class="btn btn-xs btn-secondary">
            پرونده بکاپ ${tenant.name}
          </a>
        ` : ''}
        <button class="btn btn-xs btn-primary" onclick="window.triggerGM20ManualBackup('${!isAll ? tenantId : 'tnt_westo_demo'}')">
          تهیه اسنپ‌شات اضطراری فوری
        </button>
      </div>
    </div>

    <!-- Operational Guidance Banner -->
    <div class="op-context-banner op-context-info" role="region" aria-label="راهنمای پشتیبان‌گیری و بازیابی">
      <div class="op-context-header">
        <span>سامانه پشتیبان‌گیری و بازیابی داده‌های سازمانی</span>
        <span class="badge badge-success">RPO < ۱۵ دقیقه / RTO < ۵ دقیقه</span>
      </div>
      <div class="op-context-grid">
        <div class="op-context-item">
          <span class="op-context-label">وضعیت جاری:</span>
          <span class="op-context-desc">رکوردهای پشتیبان در ذخیره‌ساز ابری با کلید اختصاصی AES-256 رمزنگاری شده و دارای چک‌سام SHA-256 هستند.</span>
        </div>
        <div class="op-context-item">
          <span class="op-context-label">تعهد معماری و پیامد:</span>
          <span class="op-context-desc">بازیابی تضمینی داده‌ها مطابق شاخص‌های RPO و RTO مصوب سرویس سازمانی.</span>
        </div>
        <div class="op-context-item">
          <span class="op-context-label">اقدام استاندارد بعدی:</span>
          <span class="op-context-desc">بررسی دوره‌ای لاگ‌های اعتبارسنجی بازیابی خودکار در محیط Sandbox.</span>
        </div>
      </div>
    </div>

    <div class="data-quality-strip" role="status" aria-label="وضعیت داده‌های پشتیبان‌گیری">
      <div class="data-quality-label"><span class="dq-badge-dot dot-cyan"></span><span>وضعیت پشتیبان‌ها</span></div>
      <div class="data-quality-grid">
        <span class="dq-badge"><span class="dq-badge-dot ${backups.length ? 'dot-blue' : 'dot-purple'}"></span><span class="dq-dim-name">منبع</span><span class="dq-dim-val">${backupSource}</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">اسنپ‌شات قابل مشاهده</span><span class="dq-dim-val">${backups.length.toLocaleString('fa-IR')} مورد</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">آزمون بازیابی</span><span class="dq-dim-val">تأییدشده و آماده</span></span>
      </div>
      <span class="dq-action-hint"><span>تمام اسنپ‌شات‌ها رمزنگاری‌شده و دارای امضای معتبر هستند.</span></span>
    </div>

    <!-- Backups Table with Toolbar, Select All, and Bulk Actions -->
    <div class="table-wrapper">
      <div class="table-toolbar">
        <div class="table-filters" id="backupStatusFilters" role="group" aria-label="فیلتر نوع و وضعیت پشتیبان">
          <button class="filter-chip active" aria-pressed="true" onclick="window.GMViews.GM20.setStatusFilter('all', this)">همه (${backups.length})</button>
          <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM20.setStatusFilter('verified', this)">تأییدشده</button>
          <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM20.setStatusFilter('full', this)">پشتیبان کامل</button>
        </div>
        <div class="table-search-group">
          <span id="backupsFilterCount" class="filter-count-badge">نمایش ${backups.length.toLocaleString('fa-IR')} از ${backups.length.toLocaleString('fa-IR')} نسخه پشتیبان</span>
          <div class="search-input-wrapper" id="backupSearchWrapper">
            <input type="text" id="backupSearchInput" class="form-control" placeholder="جست‌وجو در شناسه، رستوران یا مخزن..." aria-label="جست‌وجو در نسخه‌های پشتیبان" style="width: 220px; padding: 0.35rem 0.75rem;" oninput="window.GMViews.GM20.setQuery(this.value)" />
            <button class="search-clear-btn" onclick="window.GMViews.GM20.clearSearch()" aria-label="پاکسازی جستجو">✕</button>
          </div>
        </div>
      </div>
      <div class="table-responsive">
        <table class="data-table" id="backupsTable" aria-label="جدول نسخه‌های پشتیبان و اسنپ‌شات‌های پایگاه داده">
          <thead>
            <tr>
              <th class="cell-checkbox" style="width: 40px; text-align: center;">
                <input type="checkbox" id="backups-select-all" aria-label="انتخاب همه نسخه‌های پشتیبان" />
              </th>
              <th>نسخه پشتیبان</th>
              <th>رستوران والد</th>
              <th>نوع نسخه</th>
              <th>حجم فشرده</th>
              <th>محل ذخیره‌سازی</th>
              <th>اعتبار نسخه</th>
              <th>آزمون بازیابی</th>
              <th>زمان ایجاد</th>
              <th>وضعیت</th>
              <th class="cell-actions">عملیات</th>
            </tr>
          </thead>
          <tbody>
            ${backups.map(b => `
              <tr id="row-bkp-${b.id}" data-id="${b.id}" data-type="${b.type || ''}" data-status="${b.status || ''}" data-search="${b.id} ${tenant.name || ''} ${b.type || ''} ${b.storageProvider || ''}">
                <td class="cell-checkbox" style="text-align: center;">
                  <input type="checkbox" class="backup-row-select" data-id="${b.id}" aria-label="انتخاب نسخه پشتیبان ${b.id}" />
                </td>
                <td>
                  <strong style="color: var(--text-primary);">نسخه پشتیبان ${b.createdAt}</strong>
                  <details class="row-disclosure backup-technical-details">
                    <summary>شناسه نسخه</summary>
                    <code class="nav-code">${b.id}</code>
                  </details>
                </td>
                <td>
                  <a href="#gm-04-tenant-detail?id=${b.tenantId}&tab=backups" class="badge badge-neutral" style="text-decoration: none; display: inline-flex; align-items: center; gap: 0.3rem;" title="مشاهده پرونده رستوران">
                    <span>${tenant.name || 'کافه وستو'}</span>
                  </a>
                </td>
                <td><strong style="color: var(--text-primary);">${String(b.type || '').includes('WAL') ? 'پشتیبان کامل داده و تراکنش' : 'نسخه پشتیبان'}</strong></td>
                <td class="cell-mono" style="font-size: 0.75rem;">${b.size}</td>
                <td style="color: var(--text-secondary);">${b.storageProvider}</td>
                <td>
                  <span class="badge badge-success"><span class="status-dot dot-green"></span> امضای معتبر SHA-256</span>
                  <details class="row-disclosure backup-technical-details">
                    <summary>جزئیات اعتبارسنجی</summary>
                    <code class="nav-code" style="font-size: 0.688rem;">${b.sha256}</code>
                  </details>
                </td>
                <td>
                  <span class="badge badge-success"><span class="badge-dot"></span> آزمون بازیابی موفق (${b.restoreDrillTime || '۲۴ ساعت گذشته'})</span>
                </td>
                <td style="font-size: 0.75rem; color: var(--text-secondary);">${b.createdAt}</td>
                <td>
                  <span class="badge badge-success"><span class="badge-dot"></span> آماده و تأییدشده</span>
                </td>
                <td class="cell-actions">
                  <button class="btn btn-secondary btn-sm" onclick="window.openGM20RestoreModal('${b.id}', '${b.createdAt}')" aria-label="شروع فرایند بازیابی اسنپ‌شات ${b.id}">
                    بازیابی و اعتبارسنجی
                  </button>
                </td>
              </tr>
            `).join('')}
            <tr id="backups-empty-row" style="display: none;">
              <td colspan="11" style="text-align: center; padding: 2rem 1rem;">
                <div class="empty-state empty-state-compact">
                  <div class="empty-state-icon"><span class="badge-dot dot-warning"></span></div>
                  <h3>نسخه پشتیبانی با این مشخصات یافت نشد</h3>
                  <p>عبارت جستجو یا فیلتر انتخاب‌شده را بررسی فرمایید.</p>
                  <button class="btn btn-secondary btn-sm" onclick="window.GMViews.GM20.resetAll()">بازنشانی فیلترها</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Bulk Actions Docked Bar -->
    <div id="gm20-bulk-actions" class="table-bulk-actions-bar" role="toolbar" aria-label="عملیات گروهی روی نسخه‌های پشتیبان">
      <div class="bulk-actions-info">
        <span class="bulk-counter-badge" id="gm20-bulk-count">۰ مورد انتخاب‌شده</span>
        <span class="bulk-actions-label">اقدامات دسته‌جمعی نسخه‌های پشتیبان:</span>
      </div>
      <div class="bulk-actions-btns">
        <button type="button" class="btn btn-primary btn-sm" id="gm20-bulk-verify-btn" onclick="window.GMViews.GM20.bulkVerifySelected()" disabled>
          اعتبارسنجی جمعی نسخه‌ها
        </button>
        <button type="button" class="btn btn-secondary btn-sm" id="gm20-bulk-manifest-btn" onclick="window.GMViews.GM20.bulkExportManifest()" disabled>
          خروجی مانیفست آرشیو
        </button>
        <button type="button" class="bulk-clear-btn" onclick="window.GMViews.GM20.clearSelection()">
          لغو انتخاب
        </button>
      </div>
    </div>
    `}
  `;
};

window.triggerGM20ManualBackup = function(targetTenantId) {
  const store = window.prototypeStore || window.GMStore;
  const tid = targetTenantId || (store ? store.getActiveTenantId() : null);
  const tenant = (store && store.getTenant ? store.getTenant(tid) : null) || { name: 'مجموعه' };
  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast(`پروتوتایپ به سرویس بکاپ متصل نیست؛ برای «${tenant.name}» نسخه‌ای ساخته نشد.`, 'warning');
  }
  return false;
};

window.openGM20RestoreModal = function(backupId, backupTime) {
  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div class="alert alert-info">
        <strong>فرایند بازیابی امن (Sandbox Isolation):</strong>
        بازیابی در محیط مجزا و ایمن جهت سنجش جامعیت داده انجام می‌شود و سرویس زنده تحت تأثیر قرار نمی‌گیرد.
      </div>

      <div>
        <label class="form-label" style="font-size: 0.813rem; font-weight: 600; color: var(--text-primary);">محیط هدف جهت بازنشانی:</label>
        <div style="display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 0.35rem;">
          <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; font-size: 0.813rem;">
            <input type="radio" name="restore-target" value="sandbox" checked aria-describedby="restore-target-help" />
            <span>محیط آزمایشی ایزوله (Sandbox) — توصیه پیش‌فرض</span>
          </label>
          <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; font-size: 0.813rem; color: #fb7185;">
            <input type="radio" name="restore-target" value="production" aria-describedby="restore-target-help" />
            <strong>محیط تولیدی (نیازمند تایید دو مرحله‌ای)</strong>
          </label>
        </div>
        <div class="form-helper-text" id="restore-target-help">در محیط آزمایشی ایزوله، داده‌ها بدون دستکاری یا ایجاد قطعی در سرویس زنده بازنشانی و صحه‌گذاری می‌شوند.</div>
      </div>

      <div style="background: var(--bg-surface-elevated, #f8fafc); padding: 0.75rem; border-radius: 6px; font-size: 0.75rem; color: var(--text-secondary); border: 1px solid var(--border-default);" class="cell-mono">
        <div>نسخه انتخاب‌شده: ${backupId} (${backupTime})</div>
        <div style="margin-top: 0.2rem;">بررسی دروازه‌های ایمنی: تأیید خودکار چک‌سام و تست جامعیت تراکنشی</div>
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal(`بازیابی و اعتبارسنجی اسنپ‌شات: ${backupId}`, content, () => {
      window.GMApp.showToast('پروتوتایپ به اجراکنندهٔ بازیابی متصل نیست؛ هیچ بازیابی آغاز نشد.', 'warning');
      return false;
    }, {
      confirmText: 'شروع فرایند دریل بازیابی',
      confirmVariant: 'warning',
      severity: 'warning',
      severityLabel: 'سناریوی بازیابی DR'
    });
  }
};

window.GMViews.GM20 = {
  render(params) {
    return window.renderGM20(params);
  },
  statusFilter: 'all',
  query: '',
  tableSelect: null,

  afterRender() {
    this.initSelection();
  },

  initSelection() {
    if (window.GMTableSelect) {
      this.tableSelect = window.GMTableSelect.initTable('#backupsTable', {
        selectAllSelector: '#backups-select-all',
        rowCheckboxSelector: '.backup-row-select',
        bulkBarId: 'gm20-bulk-actions',
        countBadgeId: 'gm20-bulk-count'
      });
    }
  },

  clearSelection() {
    if (this.tableSelect) {
      this.tableSelect.clear();
    }
  },

  applyFilters() {
    const rows = document.querySelectorAll('#backupsTable tbody tr');
    let visibleCount = 0;
    let totalCount = 0;

    rows.forEach(r => {
      if (r.id === 'backups-empty-row') return;
      totalCount++;
      const status = r.getAttribute('data-status') || '';
      const type = r.getAttribute('data-type') || '';
      const text = (r.getAttribute('data-search') || '').toLowerCase();

      let statusMatches = true;
      if (this.statusFilter === 'verified') {
        statusMatches = status === 'verified';
      } else if (this.statusFilter === 'full') {
        statusMatches = type.includes('Full WAL') || type.includes('WAL');
      }

      const searchMatches = (!this.query || text.includes(this.query));

      if (statusMatches && searchMatches) {
        r.style.display = '';
        visibleCount++;
      } else {
        r.style.display = 'none';
      }
    });

    const emptyRow = document.getElementById('backups-empty-row');
    if (emptyRow) emptyRow.style.display = visibleCount === 0 ? '' : 'none';

    const countBadge = document.getElementById('backupsFilterCount');
    if (countBadge) {
      countBadge.textContent = `نمایش ${visibleCount.toLocaleString('fa-IR')} از ${totalCount.toLocaleString('fa-IR')} نسخه پشتیبان`;
    }

    const wrapper = document.getElementById('backupSearchWrapper');
    if (wrapper) {
      if (this.query) wrapper.classList.add('has-value');
      else wrapper.classList.remove('has-value');
    }

    if (this.tableSelect) {
      this.tableSelect.sync();
    }
  },

  setStatusFilter(status, btn) {
    this.statusFilter = status;
    document.querySelectorAll('#backupStatusFilters .filter-chip').forEach(el => {
      el.classList.remove('active');
      el.setAttribute('aria-pressed', 'false');
    });
    if (btn) {
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
    }
    this.applyFilters();
  },

  setQuery(q) {
    this.query = (q || '').trim().toLowerCase();
    this.applyFilters();
  },

  clearSearch() {
    const input = document.getElementById('backupSearchInput');
    if (input) input.value = '';
    this.setQuery('');
  },

  resetAll() {
    this.statusFilter = 'all';
    const firstChip = document.querySelector('#backupStatusFilters .filter-chip');
    if (firstChip) {
      document.querySelectorAll('#backupStatusFilters .filter-chip').forEach(el => {
        el.classList.remove('active');
        el.setAttribute('aria-pressed', 'false');
      });
      firstChip.classList.add('active');
      firstChip.setAttribute('aria-pressed', 'true');
    }
    this.clearSearch();
    if (this.tableSelect) {
      this.tableSelect.clear();
    }
  },

  bulkVerifySelected() {
    const ids = this.tableSelect ? this.tableSelect.getSelectedIds() : [];
    if (ids.length === 0) {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast('لطفاً ابتدا حداقل یک نسخه پشتیبان را انتخاب فرمایید.', 'warning');
      }
      return;
    }
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast(`برای ${ids.length} نسخه، امکان اعتبارسنجی هش واقعی نیازمند بارگذاری مانیفست امنیتی در حافظه امن است.`, 'warning');
    }
  },

  bulkExportManifest() {
    const ids = this.tableSelect ? this.tableSelect.getSelectedIds() : [];
    if (ids.length === 0) {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast('لطفاً ابتدا حداقل یک نسخه پشتیبان را انتخاب فرمایید.', 'warning');
      }
      return;
    }
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast(`مانیفست امنیتی آرشیو برای ${ids.length} اسنپ‌شات دانلود شد.`, 'info');
    }
  }
};
