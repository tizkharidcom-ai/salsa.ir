/**
 * prototype/js/views/gm20-backups.js
 * 
 * GM-20: رکوردهای پشتیبان و شواهد بازیابی (/backups)
 */

window.GMViews = window.GMViews || {};

const gm20EscapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

window.renderGM20 = function(params) {
  const store = window.prototypeStore || window.GMStore;
  const tenants = store && store.getTenants ? store.getTenants() : [];
  const tenantId = (params && params.id) || (store ? store.getActiveTenantId() : 'tnt_westo_demo');
  const isAll = tenantId === 'all';
  const tenant = isAll 
    ? { id: 'all', name: 'تمامی رستوران‌ها و پایگاه‌های داده', cellId: 'سراسری' }
    : ((store && store.getTenant ? store.getTenant(tenantId) : null) || { id: tenantId, name: 'کافه وستو', cellId: 'cell-teh-01' });
  const backups = store && store.getBackups ? store.getBackups(tenantId) : [];
  const backupSource = 'مخزن محلی نمونه؛ فاقد اتصال تأییدشده به بکاپ پروداکشن';
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
        <p>مشاهده رکوردهای پشتیبان و وضعیت شواهد؛ مقادیر تأییدنشده به‌عنوان آمادگی عملیاتی گزارش نمی‌شوند.</p>
      </div>
      <div class="header-actions">
        <button class="btn btn-primary" onclick="window.triggerGM20ManualBackup('${!isAll ? tenantId : 'tnt_westo_demo'}')">
          تهیه بکاپ اضطراری فوری
        </button>
        <button class="btn btn-secondary" onclick="window.triggerGM20RestoreDrill ? window.triggerGM20RestoreDrill() : (window.GMApp ? window.GMApp.showToast('اتصال به اجراکنندهٔ واقعی دریل بازیابی موجود نیست؛ هیچ عملیاتی شروع نشد.', 'warning') : null)">
          دریل بازیابی آزمایشی
        </button>
      </div>
    </div>

    ${window.GMDataState ? window.GMDataState.renderFreshnessBar({
      viewId: 'GM20',
      sourceLabel: backupSource,
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
          reason: 'منبع فعلی داده‌های پشتیبان در دسترس نیست؛ وضعیت بکاپ و بازیابی نامشخص است.',
          errorCode: 'ERR_BACKUP_STORAGE_UNREACHABLE'
        });
      }
      if (dataState.state === 'empty') {
        return window.GMDataState.renderEmptyState({
          title: 'هیچ نسخه پشتیبانی یافت نشد',
          summary: 'در منبع محلی فعلی رکوردی برای نمایش وجود ندارد.',
          description: 'این وضعیت به‌تنهایی وجود یا نبود بکاپ در زیرساخت پروداکشن را اثبات نمی‌کند.',
          auditScope: 'مانیفست بکاپ، ذخیره‌ساز artifact، WAL و شواهد restore باید از منبع عملیاتی دریافت شوند.',
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
        <a href="#gm-20-backups?id=all" class="filter-chip ${isAll ? 'active' : ''}">همه رکوردها (${(store ? store.getBackups('all') : []).length})</a>
        ${tenants.map(t => {
          const tBkp = store ? store.getBackups(t.id) : [];
          return `
            <a href="#gm-20-backups?id=${t.id}" class="filter-chip ${tenantId === t.id ? 'active' : ''}">
              ${gm20EscapeHtml(t.name)} (${tBkp.length})
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

    <!-- DR evidence is unknown until this view receives verified operational evidence. -->
    <div class="op-context-banner op-context-info" role="region" aria-label="وضعیت شواهد پشتیبان‌گیری و بازیابی">
      <div class="op-context-header">
        <span>آمادگی بازیابی بحران</span>
        <span class="badge badge-warning">مسدود — شواهد عملیاتی متصل نیست</span>
      </div>
      <div class="op-context-grid">
        <div class="op-context-item">
          <span class="op-context-label">RPO / RTO</span>
          <span class="op-context-desc">نامشخص — نتیجهٔ دریل معتبر و قابل انتساب در این نما موجود نیست.</span>
        </div>
        <div class="op-context-item">
          <span class="op-context-label">WAL / PITR</span>
          <span class="op-context-desc">نامشخص — وضعیت جاری replication، WAL و قابلیت PITR گزارش نشده است.</span>
        </div>
        <div class="op-context-item">
          <span class="op-context-label">ذخیره‌سازی خارج از سایت</span>
          <span class="op-context-desc">نامشخص — مقصد و تأیید همگام‌سازی شواهد ندارند.</span>
        </div>
        <div class="op-context-item">
          <span class="op-context-label">امتیاز آمادگی</span>
          <span class="op-context-desc">مسدود — تا اتصال telemetry و شواهد restore، امتیاز محاسبه نمی‌شود.</span>
        </div>
      </div>
    </div>

    <div class="data-quality-strip" role="status" aria-label="وضعیت داده‌های پشتیبان‌گیری">
      <div class="data-quality-label"><span class="dq-badge-dot dot-warning"></span><span>منبع و اعتبار داده</span></div>
      <div class="data-quality-grid">
        <span class="dq-badge"><span class="dq-badge-dot dot-warning"></span><span class="dq-dim-name">منبع</span><span class="dq-dim-val">${backupSource}</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">ردیف محلی</span><span class="dq-dim-val">${backups.length.toLocaleString('fa-IR')} مورد (نه شمارش پروداکشن)</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-warning"></span><span class="dq-dim-name">اعتبارسنجی / restore</span><span class="dq-dim-val">نامشخص؛ مدرک عملیاتی متصل نیست</span></span>
      </div>
      <span class="dq-action-hint"><span>داده‌های محلی، provenance یا سلامت artifactهای پروداکشن را اثبات نمی‌کنند.</span></span>
    </div>

    <!-- Backups Table with Toolbar, Select All, and Bulk Actions -->
    <div class="table-wrapper">
      <div class="table-toolbar">
        <div class="table-filters" id="backupStatusFilters" role="group" aria-label="فیلتر نوع و وضعیت پشتیبان">
          <button class="filter-chip active" aria-pressed="true" onclick="window.GMViews.GM20.setStatusFilter('all', this)">همه (${backups.length})</button>
          <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM20.setStatusFilter('verified', this)">دارای مدرک تأیید واقعی</button>
          <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM20.setStatusFilter('full', this)">پشتیبان کامل</button>
        </div>
        <div class="table-search-group">
          <span id="backupsFilterCount" class="filter-count-badge">نمایش ${backups.length.toLocaleString('fa-IR')} از ${backups.length.toLocaleString('fa-IR')} رکورد محلی</span>
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
          <th>رکورد محلی</th>
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
              <tr id="row-bkp-${gm20EscapeHtml(b.id)}" data-id="${gm20EscapeHtml(b.id)}" data-type="" data-status="unverified" data-search="${gm20EscapeHtml(`${b.id || ''} ${tenant.name || ''}`)}">
                <td class="cell-checkbox" style="text-align: center;">
                  <input type="checkbox" class="backup-row-select" data-id="${gm20EscapeHtml(b.id)}" aria-label="انتخاب رکورد محلی ${gm20EscapeHtml(b.id)}" />
                </td>
                <td>
                  <strong style="color: var(--text-primary);">رکورد محلی ${gm20EscapeHtml(b.createdAt || 'با زمان نامشخص')}</strong>
                  <details class="row-disclosure backup-technical-details">
                    <summary>شناسه و منبع</summary>
                    <code class="nav-code">${gm20EscapeHtml(b.id)} — prototypeStore / داده محلی؛ بدون provenance پروداکشن</code>
                  </details>
                </td>
                <td>
                  <a href="#gm-04-tenant-detail?id=${gm20EscapeHtml(b.tenantId)}&tab=backups" class="badge badge-neutral" style="text-decoration: none; display: inline-flex; align-items: center; gap: 0.3rem;" title="مشاهده پرونده رستوران">
                    <span>${gm20EscapeHtml(tenant.name || 'نامشخص')}</span>
                  </a>
                </td>
                <td><span class="badge badge-warning">نامشخص — نوع رکورد تأیید نشده</span></td>
                <td class="cell-mono" style="font-size: 0.75rem;">نامشخص</td>
                <td style="color: var(--text-secondary);">نامشخص — مقصد ذخیره‌سازی تأیید نشده</td>
                <td>
                  <span class="badge badge-warning">نامشخص — هش با artifact واقعی تطبیق نشده</span>
                  <details class="row-disclosure backup-technical-details">
                    <summary>منبع شواهد</summary>
                    <code class="nav-code" style="font-size: 0.688rem;">مانیفست و artifact عملیاتی به این نما متصل نیست.</code>
                  </details>
                </td>
                <td>
                  <span class="badge badge-warning">مسدود — شواهد دریل بازیابی موجود نیست</span>
                </td>
                <td style="font-size: 0.75rem; color: var(--text-secondary);">${gm20EscapeHtml(b.createdAt || 'نامشخص')} — مقدار محلی</td>
                <td>
                  <span class="badge badge-warning">مسدود — وضعیت تولیدی نامشخص</span>
                </td>
                <td class="cell-actions">
                  <button class="btn btn-secondary btn-sm" onclick="window.openGM20RestoreModal('${gm20EscapeHtml(b.id)}', '${gm20EscapeHtml(b.createdAt || '')}')" aria-label="بررسی امکان بازیابی رکورد ${gm20EscapeHtml(b.id)}">
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
      <div class="alert alert-warning">
        <strong>وضعیت بازیابی: مسدود / نامشخص</strong>
        این نما به اجراکنندهٔ واقعی بازیابی متصل نیست؛ ایزوله‌بودن مقصد و صحت مانیفست هنوز اثبات نشده است.
      </div>

      <div style="background: var(--bg-surface-elevated, #f8fafc); padding: 0.75rem; border-radius: 6px; font-size: 0.75rem; color: var(--text-secondary); border: 1px solid var(--border-default);" class="cell-mono">
        <div>شناسه رکورد محلی: ${gm20EscapeHtml(backupId)} (${gm20EscapeHtml(backupTime || 'زمان نامشخص')})</div>
        <div style="margin-top: 0.2rem;">مانیفست، checksum و نتیجهٔ restore باید از سرویس واقعی دریافت و بررسی شوند.</div>
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal(`بررسی بازیابی رکورد: ${gm20EscapeHtml(backupId)}`, content, () => {
      window.GMApp.showToast('پروتوتایپ به اجراکنندهٔ بازیابی متصل نیست؛ هیچ بازیابی آغاز نشد.', 'warning');
      return false;
    }, {
      confirmText: 'درخواست دریل بازیابی',
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
      countBadge.textContent = `نمایش ${visibleCount.toLocaleString('fa-IR')} از ${totalCount.toLocaleString('fa-IR')} رکورد محلی`;
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
      window.GMApp.showToast(`این نما به مانیفست عملیاتی متصل نیست؛ برای ${ids.length} رکورد فایلی دانلود نشد.`, 'warning');
    }
  }
};
