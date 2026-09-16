// GM-03: tenant registry. Customer-specific tools belong to GM-04 dossier tabs.
(function registerTenantRegistry(global) {
  'use strict';

  function esc(value) {
    const contractEscape = global.GMPageContracts && global.GMPageContracts.escapeHtml;
    if (typeof contractEscape === 'function') return contractEscape(value);
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderState(state) {
    if (!global.GMDataState) return '';
    if (state === 'loading') return global.GMDataState.renderSkeleton('table', 5);
    if (state === 'refreshing') return global.GMDataState.renderRefreshingBanner('GM03');
    if (state === 'stale') return global.GMDataState.renderStaleBanner('GM03');
    if (state === 'failed' || state === 'error') {
      return global.GMDataState.renderErrorState({ viewId: 'GM03', title: 'فهرست مشتریان در دسترس نیست', reason: 'اتصال به رجیستری کنترل‌پلن برقرار نشده است.', errorCode: 'TENANT_REGISTRY_UNAVAILABLE' });
    }
    return '';
  }

  global.RESTAURANTS_BREAKEVEN_DATA = [];

  global.renderGM03 = function renderGM03(params) {
    const store = global.prototypeStore || global.GMStore;
    const tenants = store && typeof store.getTenants === 'function' ? store.getTenants() : [];
    const state = global.GMDataState ? global.GMDataState.getViewState('GM03').state : 'live';
    const blocked = ['loading', 'failed', 'error'].includes(state);
    const activeCount = tenants.filter((tenant) => tenant.status === 'active').length;
    const provisioningCount = tenants.filter((tenant) => ['provisioning', 'pending_provision'].includes(tenant.status)).length;
    const suspendedCount = tenants.filter((tenant) => tenant.status === 'suspended').length;
    const archivedCount = tenants.filter((tenant) => ['archived', 'banned'].includes(tenant.status)).length;

    const isBreakevenView = params && params.view === 'breakeven';

    const breakevenHtml = isBreakevenView ? `
      <div id="gm03_breakeven_section" class="card" style="margin-bottom: 1.5rem;">
        <div class="empty-state data-empty-state-card">
          <h3>تحلیل سر‌به‌سر هنوز دادهٔ قابل اتکا ندارد</h3>
          <p>پیش‌نیازهای مالی و اسناد قطعی جهت استخراج نقطه سربه‌سر احراز نشده است.</p>
        </div>
      </div>
    ` : '';

    return `
      <div class="page-header gm03-page gm-quiet-page-header">
        <div class="page-title-group">
          <nav class="breadcrumb-nav" aria-label="مسیر راهبری"><a href="#gm-02-overview" class="breadcrumb-link">خانه</a><span class="breadcrumb-separator">/</span><span class="breadcrumb-current" aria-current="page">مشتریان</span></nav>
          <h1>فهرست مجموعه‌ها و وضعیت راه‌اندازی</h1>
        </div>
        <div class="header-actions">
          <button type="button" id="gm03-bulk-ping-btn" onclick="window.GMViews.GM03.pingSelectedHealth()" disabled class="btn btn-secondary btn-sm" style="display:none">پایش سلامت</button>
          <button type="button" id="gm03-bulk-export-btn" onclick="window.GMViews.GM03.exportSelected()" disabled class="btn btn-secondary btn-sm" style="display:none">خروجی</button>
          <a href="#gm-05-tenant-new" class="btn btn-primary" id="btn-create-tenant">＋ افزودن مشتری جدید</a>
        </div>
      </div>
      ${renderState(state)}
      ${breakevenHtml}
      <div id="gm03_table_section">
      ${blocked ? '' : state === 'empty' || tenants.length === 0 ? `
        <div class="empty-state data-empty-state-card"><h2>هنوز مشتری ثبت نشده است</h2><p>برای ساخت نخستین پرونده، مشتری جدید اضافه کنید.</p><a href="#gm-05-tenant-new" class="btn btn-primary">افزودن مشتری</a></div>
      ` : `
        <div class="table-wrapper">
          <div class="table-toolbar">
            <div class="table-filters" role="group" aria-label="فیلتر وضعیت مشتریان">
              <button class="filter-chip active" aria-pressed="true" onclick="filterTenants('all', this)">همه (${tenants.length.toLocaleString('fa-IR')})</button>
              <button class="filter-chip" aria-pressed="false" onclick="filterTenants('active', this)">فعال (${activeCount.toLocaleString('fa-IR')})</button>
              <button class="filter-chip" aria-pressed="false" onclick="filterTenants('provisioning', this)">در حال راه‌اندازی (${provisioningCount.toLocaleString('fa-IR')})</button>
              <button class="filter-chip" aria-pressed="false" onclick="filterTenants('suspended', this)">تعلیق‌شده (${suspendedCount.toLocaleString('fa-IR')})</button>
              <button class="filter-chip" aria-pressed="false" onclick="filterTenants('archived', this)">آرشیو و مسدود (${archivedCount.toLocaleString('fa-IR')})</button>
            </div>
            <div class="table-search-group"><span id="tenantsFilterCount" class="filter-count-badge">${tenants.length.toLocaleString('fa-IR')} مشتری</span><div class="search-input-wrapper" id="tenantSearchWrapper"><input type="search" id="tenantSearchInput" class="form-control" aria-label="جست‌وجوی مشتری" placeholder="نام، شناسه یا دامنه…" oninput="window.GMViews.GM03.setQuery(this.value)" /><button type="button" class="search-clear-btn" onclick="window.GMViews.GM03.clearSearch()" aria-label="پاک‌سازی جست‌وجو">✕</button></div></div>
          </div>
          <div class="table-responsive">
            <table class="data-table" id="tenantsTable" aria-label="فهرست مشتریان">
              <thead><tr><th>مشتری</th><th>دامنه</th><th>پلن</th><th>وضعیت</th><th>شعب و دستگاه‌ها</th><th class="col-actions">اقدام</th></tr></thead>
              <tbody>
                ${tenants.map((t) => {
                  const normalizedStatus = ['provisioning', 'pending_provision'].includes(t.status) ? 'provisioning' : (['archived', 'banned'].includes(t.status) ? 'archived' : t.status);
                  const statusBadge = t.status === 'active' 
                    ? '<span class="badge badge-success">فعال</span>' 
                    : (t.status === 'archived' || t.status === 'banned')
                    ? '<span class="badge badge-danger">بایگانی و بن‌شده</span>'
                    : '<span class="badge badge-warning">در حال راه‌اندازی</span>';
                  return `
                    <tr id="row-tenant-${esc(t.id)}" data-status="${esc(normalizedStatus)}" data-search="${esc(`${t.name} ${t.id} ${t.slug} ${t.domain || ''}`.toLowerCase())}">
                      <td class="cell-primary"><a href="#gm-04-tenant-detail?id=${esc(t.id)}" style="color: var(--text-primary); font-weight: 600; text-decoration: none;">${esc(t.name)}</a><div class="cell-mono">${esc(t.slug)}</div></td>
                      <td>${t.domain ? `<span class="cell-mono">${esc(t.domain)}</span>` : '<span class="cell-subtext">—</span>'}</td>
                      <td><span class="badge badge-neutral">${esc(t.plan)}</span></td>
                      <td>${statusBadge}</td>
                      <td><span class="cell-mono">${(t.branchCount || 1).toLocaleString('fa-IR')} شعبه / ${(t.deviceCount || 1).toLocaleString('fa-IR')} دستگاه</span></td>
                      <td class="cell-actions col-actions">
                        <a href="#gm-04-tenant-detail?id=${esc(t.id)}" class="btn btn-sm btn-secondary">پرونده ۳۶۰</a>
                      </td>
                    </tr>
                  `;
                }).join('')}
                <tr id="tenants-empty-row" style="display:none"><td colspan="6"><div class="empty-state empty-state-compact"><h3>موردی یافت نشد</h3><button class="btn btn-secondary btn-sm" onclick="window.GMViews.GM03.resetAll()">پاک کردن فیلترها</button></div></td></tr>
              </tbody>
            </table>
          </div>
          <div style="display:none" aria-hidden="true">
            <table id="gm03-menu-table"></table>
            <table id="gm03-salon-tables"></table>
          </div>
        </div>`}
      </div>
    `;
  };

  global.GMViews = global.GMViews || {};
  global.GMViews.GM03 = {
    render: global.renderGM03,
    status: 'all', query: '',
    applyFilters() {
      const rows = document.querySelectorAll('#tenantsTable tbody tr');
      let visible = 0; let total = 0;
      rows.forEach((row) => {
        if (row.id === 'tenants-empty-row') return;
        total += 1;
        const matches = (this.status === 'all' || row.dataset.status === this.status) && (!this.query || (row.dataset.search || '').includes(this.query));
        row.style.display = matches ? '' : 'none';
        if (matches) visible += 1;
      });
      const empty = document.getElementById('tenants-empty-row');
      if (empty) empty.style.display = visible === 0 ? '' : 'none';
      const count = document.getElementById('tenantsFilterCount');
      if (count) count.textContent = `${visible.toLocaleString('fa-IR')} مشتری`;
      if (this.tableSelect) this.tableSelect.sync();
    },
    setStatus(status, button) {
      this.status = status;
      document.querySelectorAll('.table-filters .filter-chip').forEach((chip) => { chip.classList.toggle('active', chip === button); chip.setAttribute('aria-pressed', chip === button ? 'true' : 'false'); });
      this.applyFilters();
    },
    setQuery(query) { this.query = String(query || '').trim().toLowerCase(); this.applyFilters(); },
    clearSearch() { const input = document.getElementById('tenantSearchInput'); if (input) input.value = ''; this.setQuery(''); },
    resetAll() {
      this.status = 'all';
      const first = document.querySelector('.table-filters .filter-chip');
      document.querySelectorAll('.table-filters .filter-chip').forEach((chip) => { chip.classList.toggle('active', chip === first); chip.setAttribute('aria-pressed', chip === first ? 'true' : 'false'); });
      this.clearSearch();
      if (this.tableSelect) this.tableSelect.clear();
    },
    tableSelect: null,
    afterRender() {
      this.initSelection();
    },
    initSelection() {
      if (global.GMTableSelect) {
        this.tableSelect = global.GMTableSelect.initTable('#tenantsTable', {
          selectAllSelector: '#tenants-select-all',
          rowCheckboxSelector: '.tenant-row-select',
          bulkBarId: 'gm03-bulk-actions',
          countBadgeId: 'gm03-bulk-count'
        });
      }
    },
    pingSelectedHealth() {
      const ids = this.tableSelect ? this.tableSelect.getSelectedIds() : [];
      if (ids.length === 0) {
        if (global.GMApp && global.GMApp.showToast) global.GMApp.showToast('لطفاً حداقل یک مجموعه را انتخاب کنید.', 'warning');
        return;
      }
      const store = global.prototypeStore || global.GMStore;
      if (store && store.addActivity) {
        store.addActivity({
          type: 'tenant_health_check',
          title: 'پایش سلامت گروهی',
          details: { tenantIds: ids }
        });
      }
      if (global.GMApp && global.GMApp.showToast) global.GMApp.showToast(`پایش سلامت ${ids.length} مجموعه در Mock ثبت شد.`, 'info');
    },
    exportSelected() {
      const ids = this.tableSelect ? this.tableSelect.getSelectedIds() : [];
      if (ids.length === 0) {
        if (global.GMApp && global.GMApp.showToast) global.GMApp.showToast('لطفاً حداقل یک مجموعه را انتخاب کنید.', 'warning');
        return;
      }
      const store = global.prototypeStore || global.GMStore;
      const tenants = store && store.getTenants ? store.getTenants().filter(t => ids.includes(t.id)) : [];
      const text = tenants.map(t => `${t.id}: ${t.name}`).join('\n');
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
      }
      if (global.GMApp && global.GMApp.showToast) global.GMApp.showToast('خروجی مجموعه‌های انتخاب‌شده در Mock ثبت شد.', 'info');
    },
    clearSelection() {
      if (this.tableSelect) {
        this.tableSelect.clear();
      }
    },
    pingSingleTenant(id) {
      if (global.GMApp && global.GMApp.showToast) global.GMApp.showToast(`پایش سلامت مجموعه ${id} فقط در Mock ثبت شد؛ سرویس پایش متصل نیست.`, 'warning');
    },
    testMenuOrder(id, name) {
      if (global.GMApp && global.GMApp.showToast) global.GMApp.showToast(`سفارش تستی منو برای «${name}» ثبت شد.`, 'info');
    },
    testTablePrint(name) {
      if (global.GMApp && global.GMApp.showToast) global.GMApp.showToast(`چاپ تستی فاکتور برای ${name} ارسال شد.`, 'info');
    },
    openBreakevenDrawer(id) {
      if (global.GMApp && global.GMApp.showToast) global.GMApp.showToast('دریافت گزارش مالی و نقطه سر‌به‌سر نیازمند مجوز حسابداری رسمی و داده‌های تجاری تایید شده است.', 'warning');
    }
  };
  global.filterTenants = (status, button) => global.GMViews.GM03.setStatus(status, button);
  global.searchTenants = (query) => global.GMViews.GM03.setQuery(query);
})(window);
