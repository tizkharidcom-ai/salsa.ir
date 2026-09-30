// GM-03: مرکز مدیریت مشتریان و وضعیت سرویس (Tenants Registry)
// Precision Refactored & Enhanced for State-of-the-Art UX, Ergonomics and Architecture
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
      return global.GMDataState.renderErrorState({
        viewId: 'GM03',
        title: 'فهرست مشتریان در دسترس نیست',
        reason: 'اتصال به رجیستری کنترل‌پلن برقرار نشده است.',
        errorCode: 'TENANT_REGISTRY_UNAVAILABLE'
      });
    }
    return '';
  }

  const DEFAULT_FLEET = Object.freeze([
    {
      id: 'tnt_westo_demo',
      name: 'کافه رستوران وستو',
      slug: 'westo',
      status: 'active',
      plan: 'Enterprise (سراسری)',
      monthlyPrice: '۶,۵۰۰,۰۰۰ تومان/ماه',
      domain: 'westo.ir',
      port: 4180,
      city: 'تهران / مشهد',
      ownerName: 'مدیریت وستو',
      urgentTicketsCount: 0,
      ticketsCount: 0,
      lastBackup: 'امروز ۰۳:۰۰ (تاییدشده)',
      backupIssue: false,
      hasOverdue: false
    },
    {
      id: 'tnt_choochaq',
      name: 'رستوران گیلکی چوچاق',
      slug: 'choochaq',
      status: 'active',
      plan: 'رشد و توسعه (Pro)',
      monthlyPrice: '۴,۲۰۰,۰۰۰ تومان/ماه',
      domain: 'choochaq.ir',
      port: 4181,
      city: 'رشت / لاهیجان',
      ownerName: 'محمدرضا گیلانی',
      urgentTicketsCount: 0,
      ticketsCount: 0,
      lastBackup: 'امروز ۰۲:۳۰ (تاییدشده)',
      backupIssue: false,
      hasOverdue: false
    },
    {
      id: 'tnt_shandiz',
      name: 'رستوران سنتی شاندیز',
      slug: 'shandiz',
      status: 'active',
      plan: 'Enterprise (سراسری)',
      monthlyPrice: '۶,۵۰۰,۰۰۰ تومان/ماه',
      domain: 'order.shandiz-vip.ir',
      port: 4182,
      city: 'مشهد / شاندیز',
      ownerName: 'حسین شاندیز',
      urgentTicketsCount: 0,
      ticketsCount: 0,
      lastBackup: 'امروز ۰۲:۰۰ (تاییدشده)',
      backupIssue: false,
      hasOverdue: false
    },
    {
      id: 'tnt_barbeque',
      name: 'فست‌فود باربیکیو',
      slug: 'barbeque',
      status: 'active',
      plan: 'پایه (Starter)',
      monthlyPrice: '۲,۱۰۰,۰۰۰ تومان/ماه',
      domain: 'bbq.salsa.ir',
      port: 4183,
      city: 'تهران',
      ownerName: 'علیرضا تهرانی',
      urgentTicketsCount: 0,
      ticketsCount: 1,
      lastBackup: 'دیروز ۱۸:۰۰ (تاییدشده)',
      backupIssue: false,
      hasOverdue: false
    }
  ]);

  function getUnifiedTenants(rawTenants) {
    const map = new Map();
    DEFAULT_FLEET.forEach((item) => map.set(item.id, { ...item }));
    if (Array.isArray(rawTenants)) {
      rawTenants.forEach((t) => {
        const existing = map.get(t.id) || {};
        map.set(t.id, {
          ...existing,
          ...t,
          name: t.name || existing.name || t.id,
          status: t.status || existing.status || 'active',
          plan: t.plan || existing.plan || 'سازمانی Enterprise',
          domain: t.domain || (t.domains && t.domains[0]) || existing.domain || `${t.slug || t.id}.salsa.ir`,
          city: t.city || existing.city || 'تهران',
          lastBackup: t.lastBackup || existing.lastBackup || 'امروز ۰۴:۰۰ (تاییدشده)'
        });
      });
    }
    return Array.from(map.values());
  }

  global.RESTAURANTS_BREAKEVEN_DATA = [];

  global.renderGM03 = function renderGM03(params) {
    const store = global.prototypeStore || global.GMStore;
    const rawTenants = store && typeof store.getTenants === 'function' ? store.getTenants() : [];
    const tenants = getUnifiedTenants(rawTenants);
    const state = global.GMDataState ? global.GMDataState.getViewState('GM03').state : 'live';
    const blocked = ['loading', 'failed', 'error'].includes(state);

    // Counts for filter chips
    const activeCount = tenants.filter((t) => t.status === 'active').length;
    const provisioningCount = tenants.filter((t) => ['provisioning', 'pending_provision'].includes(t.status)).length;
    const suspendedCount = tenants.filter((t) => t.status === 'suspended').length;
    const archivedCount = tenants.filter((t) => ['archived', 'banned'].includes(t.status)).length;

    // Derived counts
    const overdueCount = tenants.filter((t) => t.hasOverdue || (t.debts && t.debts.length > 0)).length;
    const urgentTicketCount = tenants.filter((t) => t.urgentTicketsCount > 0).length;
    const backupIssueCount = tenants.filter((t) => t.backupIssue).length;
    const needsActionCount = tenants.filter((t) => 
      ['provisioning', 'pending_provision'].includes(t.status) || 
      t.urgentTicketsCount > 0 || 
      t.hasOverdue || 
      t.backupIssue
    ).length;

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
          <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
            <a href="#gm-02-overview" class="breadcrumb-link">خانه</a>
            <span class="breadcrumb-separator">/</span>
            <span class="breadcrumb-current" aria-current="page">مشتریان</span>
          </nav>
          <h1>فهرست مجموعه‌ها و وضعیت راه‌اندازی</h1>
          <p class="page-desc" style="margin: 0.25rem 0 0; font-size: 0.85rem; color: var(--text-secondary);">مرکز مدیریت مشتریان پلتفرم، کنترل وضعیت سرویس، پلن‌های فعال و دسترسی به پرونده جامع</p>
        </div>
        <div class="header-actions">
          <button type="button" id="gm03-bulk-ping-btn" onclick="window.GMViews.GM03.pingSelectedHealth()" disabled class="btn btn-secondary btn-sm" style="display:none">پایش سلامت</button>
          <button type="button" id="gm03-bulk-export-btn" onclick="window.GMViews.GM03.exportSelected()" disabled class="btn btn-secondary btn-sm" style="display:none">خروجی</button>
          <a href="#gm-05-tenant-new" class="btn btn-primary btn-sm" id="btn-create-tenant">＋ افزودن مشتری جدید</a>
        </div>
      </div>

      <!-- Quick Vitals Bar for Customers Registry -->
      <div class="gm02-kpis-grid" style="margin-bottom: 1.25rem;" aria-label="خلاصه آماری مجموعه‌ها">
        <div class="gm02-kpi-card" style="padding: 0.9rem 1.1rem;">
          <div class="gm02-kpi-top">
            <span class="gm02-kpi-label">کل مجموعه‌ها</span>
            <span class="gm02-kpi-pill pill-success">${tenants.length.toLocaleString('fa-IR')} مجموعه</span>
          </div>
          <div class="gm02-kpi-middle">
            <div class="gm02-kpi-val">${tenants.length.toLocaleString('fa-IR')}</div>
          </div>
          <div class="gm02-kpi-footer">
            <span>ثبت‌شده در پلتفرم SALSA</span>
          </div>
        </div>

        <div class="gm02-kpi-card" style="padding: 0.9rem 1.1rem;">
          <div class="gm02-kpi-top">
            <span class="gm02-kpi-label">فعال و عملیاتی</span>
            <span class="gm02-kpi-pill pill-success">${activeCount.toLocaleString('fa-IR')} فعال</span>
          </div>
          <div class="gm02-kpi-middle">
            <div class="gm02-kpi-val">${activeCount.toLocaleString('fa-IR')}</div>
          </div>
          <div class="gm02-kpi-footer">
            <span>انطباق کامل با قرارداد و SLA</span>
          </div>
        </div>

        <div class="gm02-kpi-card" style="padding: 0.9rem 1.1rem;">
          <div class="gm02-kpi-top">
            <span class="gm02-kpi-label">در حال راه‌اندازی</span>
            <span class="gm02-kpi-pill pill-warning">${provisioningCount.toLocaleString('fa-IR')} جدید</span>
          </div>
          <div class="gm02-kpi-middle">
            <div class="gm02-kpi-val">${provisioningCount.toLocaleString('fa-IR')}</div>
          </div>
          <div class="gm02-kpi-footer">
            <span>راه‌اندازی و تنظیم دامنه</span>
          </div>
        </div>

        <div class="gm02-kpi-card" style="padding: 0.9rem 1.1rem;">
          <div class="gm02-kpi-top">
            <span class="gm02-kpi-label">نیازمند اقدام فوری</span>
            <span class="gm02-kpi-pill ${needsActionCount ? 'pill-danger' : 'pill-success'}">${needsActionCount.toLocaleString('fa-IR')} مورد</span>
          </div>
          <div class="gm02-kpi-middle">
            <div class="gm02-kpi-val">${needsActionCount.toLocaleString('fa-IR')}</div>
          </div>
          <div class="gm02-kpi-footer">
            <span>تیکت، تمدید یا بکاپ</span>
          </div>
        </div>
      </div>

      ${renderState(state)}
      ${breakevenHtml}

      <div id="gm03_table_section">
      ${blocked ? '' : state === 'empty' || tenants.length === 0 ? `
        <div class="empty-state data-empty-state-card">
          <h2>هنوز مشتری ثبت نشده است</h2>
          <p>برای ساخت نخستین پرونده و تخصیص زیرساخت، مشتری جدید اضافه کنید.</p>
          <a href="#gm-05-tenant-new" class="btn btn-primary">＋ افزودن مشتری</a>
        </div>
      ` : `
        <div class="table-wrapper">
          <div class="table-toolbar" style="gap: 0.75rem; flex-wrap: wrap;">
            <div class="table-filters" role="group" aria-label="فیلتر وضعیت مشتریان" style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
              <button class="filter-chip active" aria-pressed="true" onclick="window.GMViews.GM03.setStatus('all', this)">همه (${tenants.length.toLocaleString('fa-IR')})</button>
              <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM03.setStatus('needs_action', this)">نیازمند اقدام (${needsActionCount.toLocaleString('fa-IR')})</button>
              <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM03.setStatus('active', this)">فعال (${activeCount.toLocaleString('fa-IR')})</button>
              <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM03.setStatus('provisioning', this)">در حال راه‌اندازی (${provisioningCount.toLocaleString('fa-IR')})</button>
              <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM03.setStatus('overdue', this)">بدهکار (${overdueCount.toLocaleString('fa-IR')})</button>
              <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM03.setStatus('urgent_ticket', this)">تیکت فوری (${urgentTicketCount.toLocaleString('fa-IR')})</button>
              <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM03.setStatus('backup_issue', this)">مشکل بکاپ (${backupIssueCount.toLocaleString('fa-IR')})</button>
              <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM03.setStatus('suspended', this)">تعلیق‌شده (${suspendedCount.toLocaleString('fa-IR')})</button>
              <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM03.setStatus('archived', this)">آرشیو و مسدود (${archivedCount.toLocaleString('fa-IR')})</button>
            </div>
            <div class="table-search-group" style="margin-right: auto;">
              <span id="tenantsFilterCount" class="filter-count-badge">${tenants.length.toLocaleString('fa-IR')} مشتری</span>
              <div class="search-input-wrapper" id="tenantSearchWrapper">
                <input type="search" id="tenantSearchInput" class="form-control" aria-label="جست‌وجوی مشتری" placeholder="جست‌وجو بر اساس نام، دامنه، شناسه یا شهر…" oninput="window.GMViews.GM03.setQuery(this.value)" />
                <button type="button" class="search-clear-btn" onclick="window.GMViews.GM03.clearSearch()" aria-label="پاک‌سازی جست‌وجو">✕</button>
              </div>
            </div>
          </div>

          <div class="table-responsive">
            <table class="data-table" id="tenantsTable" aria-label="فهرست مشتریان">
              <thead>
                <tr>
                  <th>مشتری</th>
                  <th>وضعیت</th>
                  <th>مرحله راه‌اندازی</th>
                  <th>پلن و مبلغ ماهانه</th>
                  <th>وضعیت پشتیبانی</th>
                  <th>آخرین بکاپ</th>
                  <th class="col-actions">اقدام</th>
                </tr>
              </thead>
              <tbody>
                ${tenants.map((t) => {
                  const normalizedStatus = ['provisioning', 'pending_provision'].includes(t.status)
                    ? 'provisioning'
                    : (['archived', 'banned'].includes(t.status) ? 'archived' : t.status);

                  const statusBadge = t.status === 'active' 
                    ? '<span class="badge badge-success"><span class="status-dot dot-green"></span> فعال</span>' 
                    : (t.status === 'archived' || t.status === 'banned')
                    ? '<span class="badge badge-danger"><span class="status-dot dot-danger"></span> بایگانی و بن‌شده</span>'
                    : (t.status === 'suspended')
                    ? '<span class="badge badge-neutral"><span class="status-dot dot-neutral"></span> تعلیق‌شده</span>'
                    : '<span class="badge badge-warning"><span class="status-dot dot-amber"></span> در حال راه‌اندازی</span>';

                  const onboardingStage = t.status === 'active'
                    ? '<span class="text-success font-medium">✓ تکمیل‌شده (بهره‌برداری کامل)</span>'
                    : ['provisioning', 'pending_provision'].includes(t.status)
                    ? '<span class="text-amber font-medium">⏳ استقرار پایگاه‌داده و اتصال POS</span>'
                    : (t.status === 'suspended')
                    ? '<span class="text-secondary">سرویس موقتاً متوقف‌شده</span>'
                    : '<span class="text-secondary">بایگانی و مسدود</span>';

                  const monthlyPrice = t.monthlyPrice || (t.plan && t.plan.includes('Enterprise') ? '۶,۵۰۰,۰۰۰ تومان/ماه' : (t.plan && t.plan.includes('Growth') ? '۱,۸۵۰,۰۰۰ تومان/ماه' : '۹۹۰,۰۰۰ تومان/ماه'));
                  const planDisplay = `<div style="font-weight: 600; color: var(--text-primary);">${esc(t.plan || 'سازمانی')}</div><div class="cell-subtext font-mono">${monthlyPrice}</div>`;

                  const supportDisplay = (t.urgentTicketsCount && t.urgentTicketsCount > 0)
                    ? `<span class="badge badge-danger">${t.urgentTicketsCount.toLocaleString('fa-IR')} تیکت فوری</span>`
                    : (t.ticketsCount && t.ticketsCount > 0)
                    ? `<span class="badge badge-warning">${t.ticketsCount.toLocaleString('fa-IR')} تیکت باز</span>`
                    : `<span class="text-secondary" style="font-size: 0.82rem;">بدون تیکت باز</span>`;

                  const backupDisplay = t.backupIssue
                    ? `<span class="badge badge-danger">خطای همگام‌سازی</span>`
                    : `<span class="text-success" style="font-size: 0.82rem; display: inline-flex; align-items: center; gap: 0.3rem;"><span class="status-dot dot-green"></span> ${esc(t.lastBackup || 'سالم · ۲ ساعت پیش')}</span>`;

                  const isNeedsAction = normalizedStatus === 'provisioning' || !!t.urgentTicketsCount || !!t.hasOverdue || !!t.backupIssue;
                  const isOverdue = !!t.hasOverdue || (t.debts && t.debts.length > 0);
                  const isUrgentTicket = !!(t.urgentTicketsCount && t.urgentTicketsCount > 0);
                  const isBackupIssue = !!t.backupIssue;

                  return `
                    <tr id="row-tenant-${esc(t.id)}" 
                        data-status="${esc(normalizedStatus)}" 
                        data-needs-action="${isNeedsAction ? 'true' : 'false'}"
                        data-overdue="${isOverdue ? 'true' : 'false'}"
                        data-urgent-ticket="${isUrgentTicket ? 'true' : 'false'}"
                        data-backup-issue="${isBackupIssue ? 'true' : 'false'}"
                        data-search="${esc(`${t.name} ${t.id} ${t.slug || ''} ${t.domain || ''} ${t.ownerName || ''} ${t.city || ''}`.toLowerCase())}">
                      <td class="cell-primary">
                        <div style="display: flex; align-items: center; gap: 0.65rem;">
                          <div class="tenant-avatar-badge" style="width: 32px; height: 32px; border-radius: 8px; background: rgba(56, 189, 248, 0.12); color: var(--accent-cyan); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.85rem; flex-shrink: 0;">
                            ${esc((t.name || 'ر').charAt(0))}
                          </div>
                          <div>
                            <a href="#gm-04-tenant-detail?id=${esc(t.id)}" style="color: var(--text-primary); font-weight: 600; text-decoration: none;">${esc(t.name)}</a>
                            <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 0.15rem;">
                              ${t.domain ? `<span class="cell-mono">${esc(t.domain)}</span>` : `<span class="cell-mono">${esc(t.slug || t.id)}.salsa.ir</span>`}
                              ${t.city ? ` · <span>${esc(t.city)}</span>` : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>${statusBadge}</td>
                      <td>${onboardingStage}</td>
                      <td>${planDisplay}</td>
                      <td>${supportDisplay}</td>
                      <td>${backupDisplay}</td>
                      <td class="cell-actions col-actions">
                        <div style="display: flex; align-items: center; gap: 0.4rem; justify-content: flex-end;">
                          <a href="#gm-04-tenant-detail?id=${esc(t.id)}" class="btn btn-sm btn-primary">
                            باز کردن پرونده
                          </a>
                          <a href="${esc(t.liveUrl || (t.port ? `http://localhost:${t.port}` : (t.domain ? `http://${t.domain}` : 'http://localhost:4180')))}" target="_blank" rel="noopener" class="btn btn-sm btn-secondary" title="ورود به سامانه ${esc(t.name)}">
                            پرش به سامانه ↗
                          </a>
                          <a href="#gm-04-tenant-detail?id=${esc(t.id)}&tab=portal" class="btn btn-sm btn-secondary btn-icon-only" title="مشاهده قرارداد و پورتال" aria-label="مشاهده قرارداد">
                            📜
                          </a>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
                <tr id="tenants-empty-row" style="display:none">
                  <td colspan="7">
                    <div class="empty-state empty-state-compact" style="text-align: center; padding: 2rem;">
                      <p style="margin: 0 0 0.5rem; color: var(--text-secondary);">هیچ مجموعه‌ای با این مشخصات یا فیلتر یافت نشد.</p>
                      <button class="btn btn-secondary btn-sm" onclick="window.GMViews.GM03.resetAll()">پاک کردن فیلترها</button>
                    </div>
                  </td>
                </tr>
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
    status: 'all',
    query: '',
    applyFilters() {
      const rows = document.querySelectorAll('#tenantsTable tbody tr');
      let visible = 0;
      rows.forEach((row) => {
        if (row.id === 'tenants-empty-row') return;
        
        let matchesStatus = true;
        if (this.status === 'all') {
          matchesStatus = true;
        } else if (this.status === 'needs_action') {
          matchesStatus = row.dataset.needsAction === 'true';
        } else if (this.status === 'overdue') {
          matchesStatus = row.dataset.overdue === 'true';
        } else if (this.status === 'urgent_ticket') {
          matchesStatus = row.dataset.urgentTicket === 'true';
        } else if (this.status === 'backup_issue') {
          matchesStatus = row.dataset.backupIssue === 'true';
        } else {
          matchesStatus = row.dataset.status === this.status;
        }

        const matchesQuery = !this.query || (row.dataset.search && row.dataset.search.includes(this.query));
        const show = matchesStatus && matchesQuery;
        row.style.display = show ? '' : 'none';
        if (show) visible++;
      });

      const emptyRow = document.getElementById('tenants-empty-row');
      if (emptyRow) {
        emptyRow.style.display = visible === 0 ? '' : 'none';
      }

      const countBadge = document.getElementById('tenantsFilterCount');
      if (countBadge) {
        countBadge.textContent = `${visible.toLocaleString('fa-IR')} مشتری`;
      }
    },

    setStatus(newStatus, btn) {
      this.status = newStatus;
      document.querySelectorAll('.table-filters .filter-chip').forEach((chip) => {
        chip.classList.remove('active');
        chip.setAttribute('aria-pressed', 'false');
      });
      if (btn) {
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
      }
      this.applyFilters();
    },

    setQuery(newQuery) {
      this.query = (newQuery || '').trim().toLowerCase();
      this.applyFilters();
    },

    clearSearch() {
      const inp = document.getElementById('tenantSearchInput');
      if (inp) inp.value = '';
      this.query = '';
      this.applyFilters();
    },

    resetAll() {
      const allBtn = document.querySelector('.table-filters .filter-chip');
      this.setStatus('all', allBtn);
      this.clearSearch();
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
    clearSelection() {
      if (this.tableSelect) {
        this.tableSelect.clear();
      }
    },

    pingSelectedHealth() {
      const showToast = (global.GMApp && global.GMApp.showToast) || global.showToast;
      const ids = this.tableSelect ? this.tableSelect.getSelectedIds() : [];
      if (ids.length === 0) {
        if (showToast) showToast('لطفاً حداقل یک مجموعه را انتخاب کنید.', 'warning');
        return;
      }
      const store = global.GMStore || global.prototypeStore;
      if (store && typeof store.addActivity === 'function') {
        store.addActivity({
          type: 'tenant_health_check',
          severity: 'info',
          title: `پایش سلامت دسته‌جمعی ${ids.length} مجموعه`,
          description: `درخواست پایش برای مجموعه‌های ${ids.join(', ')} ارسال شد.`,
          subsystem: 'Tenants',
          route: '#gm-03-tenants',
          actor: 'SuperAdmin',
          details: { tenantIds: ids }
        });
      }
      if (showToast) showToast(`پایش سلامت ${ids.length} مجموعه در Mock ثبت شد.`, 'info');
    },

    exportSelected() {
      const showToast = (global.GMApp && global.GMApp.showToast) || global.showToast;
      const ids = (this.tableSelect && typeof this.tableSelect.getSelectedIds === 'function') ? this.tableSelect.getSelectedIds() : [];
      if (ids.length === 0) {
        if (showToast) showToast('لطفاً حداقل یک مجموعه را انتخاب کنید.', 'warning');
        return;
      }
      const store = global.GMStore || global.prototypeStore;
      const tenants = (store && typeof store.getTenants === 'function') ? store.getTenants() : [];
      const selectedTenants = ids.map(id => tenants.find(t => t.id === id) || { id, name: id === 'tnt_westo_demo' ? 'کافه وستو' : id });
      const summaryText = selectedTenants.map(t => `${t.id}: ${t.name}`).join('\n');
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(summaryText);
      }
      if (showToast) showToast(`خلاصه ${ids.length} مجموعه در کلیپ‌بورد کپی شد.`, 'info');
    },

    pingSingleTenant(id) {
      const showToast = (global.GMApp && global.GMApp.showToast) || global.showToast;
      if (showToast) showToast(`پایش سلامت مجموعه ${id} فقط در Mock ثبت شد؛ سرویس پایش متصل نیست.`, 'warning');
    },

    testMenuOrder(id, name) {
      const showToast = (global.GMApp && global.GMApp.showToast) || global.showToast;
      if (showToast) showToast(`سفارش تستی منو برای «${name}» (فقط در Mock) ثبت شد.`, 'info');
    },

    testTablePrint(name) {
      const showToast = (global.GMApp && global.GMApp.showToast) || global.showToast;
      if (showToast) showToast(`چاپ تستی فاکتور برای ${name} ارسال شد.`, 'info');
    },

    openBreakevenDrawer(id) {
      const showToast = (global.GMApp && global.GMApp.showToast) || global.showToast;
      if (showToast) showToast('دریافت گزارش مالی و نقطه سر‌به‌سر نیازمند مجوز حسابداری رسمی و داده‌های تجاری تایید شده است.', 'warning');
    }
  };
  global.filterTenants = (status, button) => global.GMViews.GM03.setStatus(status, button);
  global.searchTenants = (query) => global.GMViews.GM03.setQuery(query);
})(window);
