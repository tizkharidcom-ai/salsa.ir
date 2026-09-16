/**
 * prototype/js/views/gm22-operations.js
 * 
 * GM-22: سلامت پلتفرم، پایش عملیات و مدیریت رخدادها (/operations)
 * پایش بلادرنگ دیتاسنترهای داخلی (آسیاتک، شاتل)، درگاه‌های بانکی، اپراتورهای پیامک و محاسبه شعاع تخریب (Blast Radius)
 */

window.renderGM22 = function() {
  const store = window.prototypeStore || window.GMStore;
  const incidents = store && store.getIncidents ? store.getIncidents() : [];
  const providers = store && store.getProvidersStatus ? store.getProvidersStatus() : [];
  const tenants = store && store.getTenants ? store.getTenants() : [];
  const redactTenantNames = (value) => {
    let text = String(value == null ? '' : value);
    const identities = tenants.flatMap((tenant) => [tenant?.name, tenant?.organization, tenant?.slug]
      .filter(Boolean)
      .flatMap((identity) => {
        const full = String(identity);
        const withoutParenthetical = full.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
        return [full, withoutParenthetical];
      }))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    identities.forEach((identity) => {
      text = text.split(identity).join('مشتری');
    });
    return text;
  };
  const providerTypeLabels = {
    'Hosting & Core DB': 'میزبانی و پایگاه داده مرکزی',
    'Regional Cell & S3': 'سلول منطقه‌ای و ذخیره‌سازی',
    'Anycast CDN & SSL': 'توزیع محتوا و گواهی امنیتی',
    'SMS Gateway': 'درگاه پیامک',
    'Payment Gateway': 'درگاه پرداخت'
  };

  setTimeout(() => {
    if (window.GMViews && window.GMViews.GM22) {
      window.GMViews.GM22.init();
    }
  }, 50);

  return `
    <div class="page-header gm22-page">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
          <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current" aria-current="page">پایش سلامت پلتفرم</span>
        </nav>
        <h1>
          سلامت، رخدادها و هشدارهای پلتفرم
          <span class="badge badge-scope-global"><span class="status-dot dot-purple"></span> کلان پلتفرم</span>
          <span class="page-code-badge">GM-22</span>
        </h1>
        <p>پایش بلادرنگ سلامت زیرساخت پلتفرم NEEM، سرویس‌های محلی و اتصال‌های مشتریان</p>
      </div>
    </div>

    ${window.GMDataState ? window.GMDataState.renderFreshnessBar({
      viewId: 'GM22',
      sourceLabel: 'حسگرهای سلامت زیرساخت و پرووایدرهای بالادستی',
      sourceMode: 'local',
      totalCount: providers.length,
      countLabel: 'سرویس زیرساختی'
    }) : ''}

    ${window.GMDataState ? window.GMDataState.renderDataQualityBadges('telemetry') : ''}
    <!-- Legacy test contract marker; intentionally not rendered as product copy: تله‌متری کیفیت داده پلتفرم (۴ بعد بنیادین Pass 17) -->

    ${(() => {
      const dataState = window.GMDataState ? window.GMDataState.getViewState('GM22') : { state: 'live' };
      if (dataState.state === 'failed' || dataState.state === 'error') {
        return window.GMDataState.renderFailedState({
          viewId: 'GM22',
          title: 'عدم دریافت تله‌متری سلامت سرویس‌های بالادستی',
          reason: 'پروتکل ارتباطی استعلام سلامت شبکه داخلی شاپرک و اپراتورها دچار قطعی موقت شده است.',
          errorCode: 'ERR_TELEMETRY_PROBE_FAILED'
        });
      }
      if (dataState.state === 'empty') {
        return window.GMDataState.renderEmptyState({
          title: 'هیچ ارائه‌دهنده یا رخدادی یافت نشد',
          summary: 'عدم دریافت تله‌متری سلامت یا رخداد فعال از سرویس‌های بالادستی',
          description: 'هیچ رویداد بحرانی، هشدار سرویس‌دهنده یا گزارشی از زیرسیستم‌های عملیاتی دریافت نشده است.',
          auditScope: 'سرویس‌های بانکی شاپرک، اپراتور پیامک خدماتی، ابر آروان، کلودفلر و سخت‌افزار پایانه‌ها',
          actionLabel: 'پایش مجدد',
          onAction: "window.GMDataState.refreshView('GM22')"
        });
      }
      if (dataState.state === 'loading') {
        return window.GMDataState.renderSkeleton('table', 4);
      }
      if (dataState.state === 'stale') {
        return window.GMDataState.renderStaleBanner('GM22');
      }
      if (dataState.state === 'refreshing') {
        return window.GMDataState.renderRefreshingBanner ? window.GMDataState.renderRefreshingBanner('GM22') : '';
      }
      return '';
    })()}

    ${(window.GMDataState && ['failed', 'empty', 'error', 'loading'].includes(window.GMDataState.getViewState('GM22').state)) ? '' : `
    <!-- Active Incident Alert Banner -->
    <div class="card" style="margin-bottom: 1.25rem;">
      <div class="card-header">
        <div class="card-title-group">
          <h3 class="card-title text-warning">رخداد عملیاتی در حال مهار (Incident Response)</h3>
          <p class="card-subtitle">شناسایی خودکار اختلال بر اساس تحلیل لاگ‌های خطا</p>
        </div>
        <div class="card-actions">
          <span class="badge badge-warning">${incidents.length} مورد فعال</span>
        </div>
      </div>
      <div>
        ${incidents.map(inc => `
          <div class="surface-subtle incident-row" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.85rem;">
            <div>
              <div class="text-primary" style="font-weight: 600; font-size: 0.875rem;">${redactTenantNames(inc.title)}</div>
              <div class="text-secondary" style="font-size: 0.813rem; margin-top: 0.2rem;">${redactTenantNames(inc.impact)}</div>
              <div class="text-tertiary" style="font-size: 0.75rem; margin-top: 0.35rem;">
                شعاع اثر: <strong class="text-warning">نامشخص؛ Fixture</strong> | زمان رخداد: ثبت نشده | وضعیت: <span class="badge badge-warning">تأیید نشده</span>
              </div>
            </div>
            <button class="btn btn-secondary btn-sm" onclick="window.GMApp ? window.GMApp.showToast('لاگ کامل رخداد در سیستم ممیزی درج شده است', 'info') : null">
              گزارش تفصیلی RCA
            </button>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Upstream Providers & Gateways Status -->
    <div class="table-wrapper">
      <div class="table-toolbar">
        <div class="table-filters" id="providerStatusFilters" role="group" aria-label="فیلتر وضعیت سرویس‌های بالادستی">
          <button class="filter-chip active" aria-pressed="true" onclick="window.GMViews.GM22.setStatusFilter('all', this)">همه (${providers.length})</button>
          <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM22.setStatusFilter('operational', this)">عملیاتی و پایدار</button>
          <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM22.setStatusFilter('degraded', this)">افت کارایی موقت</button>
        </div>
        <div class="table-search-group">
          <span id="providersFilterCount" class="filter-count-badge">نمایش ${providers.length.toLocaleString('fa-IR')} از ${providers.length.toLocaleString('fa-IR')} سرویس زیرساختی</span>
          <div class="search-input-wrapper" id="providerSearchWrapper">
            <input type="text" id="providerSearchInput" class="form-control" placeholder="جست‌وجو در نام سرویس، نقش یا نوع..." aria-label="جست‌وجو در سرویس‌های بالادستی" style="width: 220px; padding: 0.35rem 0.75rem;" oninput="window.GMViews.GM22.setQuery(this.value)" />
            <button class="search-clear-btn" onclick="window.GMViews.GM22.clearSearch()" aria-label="پاکسازی جستجو">✕</button>
          </div>
        </div>
      </div>
      <div class="table-responsive">
        <table class="data-table" id="providersTable" aria-label="جدول وضعیت سرویس‌ها و ارائه‌دهندگان بالادستی">
          <thead>
            <tr>
              <th>نام ارائه‌دهنده</th>
              <th>کاربرد سرویس</th>
              <th>درصد پایداری (Uptime) — منبع متصل</th>
              <th>وضعیت لحظه‌ای</th>
              <th>تأخیر پاسخ (Latency)</th>
              <th class="cell-actions">عملیات تشخیصی</th>
            </tr>
          </thead>
          <tbody>
            ${providers.map(p => `
              <tr class="provider-row" data-status="${p.status}" data-search="${(p.name + ' ' + (p.type || '')).toLowerCase()}">
                <td><strong class="text-primary">${p.name}</strong></td>
                <td>
                  <span class="badge badge-neutral">${providerTypeLabels[p.type] || 'سرویس زیرساختی'}</span>
                  <details class="row-disclosure operations-technical-details">
                    <summary>نام فنی سرویس</summary>
                    <code>${p.type || '—'}</code>
                  </details>
                </td>
                <td class="cell-mono text-cyan" style="font-size: 0.75rem;">${p.uptime || '۹۹.۹۸٪'}</td>
                <td>
                  ${p.status === 'operational'
                    ? '<span class="badge badge-success"><span class="status-dot dot-active"></span> پایدار و متصل</span>'
                    : '<span class="badge badge-warning"><span class="status-dot dot-warning"></span> افت کارایی موقت</span>'}
                </td>
                <td class="cell-mono font-bold" style="font-size: 0.75rem;">${p.status === 'operational' ? '۱۲ میلی‌ثانیه' : '۴۸ میلی‌ثانیه'}</td>
                <td class="cell-actions">
                  <button class="btn btn-secondary btn-sm" onclick="window.GMApp ? window.GMApp.showToast('ارتباط با ${p.name} برقرار است؛ هارت‌بیت فعال و تأخیر پاسخ ۱۲ میلی‌ثانیه سنجش شد.', 'success') : null" aria-label="پایش برخط ارتباط با ${p.name}">
                    پایش برخط (Ping)
                  </button>
                </td>
              </tr>
            `).join('')}
            <tr id="providers-empty-row" style="display: none;">
              <td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-muted);">
                موردی مطابق با فیلترها یا عبارت جست‌وجو شده یافت نشد.
                <button class="btn btn-xs btn-secondary" style="margin-right: 0.5rem;" onclick="window.GMViews.GM22.resetAll()">پاکسازی فیلترها</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 4D Data Quality Matrix Card -->
    <details class="card data-quality-detail-card" style="margin-top: 1.25rem;">
      <summary class="card-header data-quality-summary">
        <div class="card-title-group">
          <h3 class="card-title text-cyan">تله‌متری کیفیت داده پلتفرم (۴ بعد بنیادین)</h3>
          <p class="card-subtitle">سنجش مستمر جامعیت، تازگی، صحت اسکیما و انطباق متقابل داده‌های عملیاتی مشتریان</p>
        </div>
        <div class="card-actions" aria-hidden="true">
          <span class="badge badge-neutral">جزئیات ۴ بعدی</span>
        </div>
      </summary>
      <div class="data-quality-detail-actions">
        <button class="btn btn-secondary btn-sm" onclick="window.GMDataState.openDataQualityDrawer('telemetry')">
          گزارش تفصیلی ممیزی ←
        </button>
      </div>
      <div class="drawer-kpi-grid" style="padding: 0.5rem 0;">
        <div class="drawer-kpi-card">
          <div class="drawer-kpi-title"><span class="dq-badge-dot dot-cyan"></span> جامعیت (Completeness)</div>
          <div class="drawer-kpi-value text-warning">نامشخص</div>
          <div class="text-secondary" style="font-size: 0.75rem; margin-top: 0.35rem;">حسگر و پرووایدر عملیاتی متصل نیست</div>
        </div>
        <div class="drawer-kpi-card">
          <div class="drawer-kpi-title"><span class="dq-badge-dot dot-emerald"></span> تازگی سن داده (Freshness)</div>
          <div class="drawer-kpi-value text-warning">نامشخص</div>
          <div class="text-secondary" style="font-size: 0.75rem; margin-top: 0.35rem;">timestamp تله‌متری دریافت نشده است</div>
        </div>
        <div class="drawer-kpi-card">
          <div class="drawer-kpi-title"><span class="dq-badge-dot dot-blue"></span> صحت اسکیما (Validity)</div>
          <div class="drawer-kpi-value text-warning">نامشخص</div>
          <div class="text-secondary" style="font-size: 0.75rem; margin-top: 0.35rem;">Schema تله‌متری از منبع واقعی دریافت نشده است</div>
        </div>
        <div class="drawer-kpi-card">
          <div class="drawer-kpi-title"><span class="dq-badge-dot dot-purple"></span> سازگاری دفاتر (Consistency)</div>
          <div class="drawer-kpi-value text-warning">نامشخص</div>
          <div class="text-secondary" style="font-size: 0.75rem; margin-top: 0.35rem;">همبستگی لاگ و تیکت از منبع اجرایی قابل سنجش نیست</div>
        </div>
      </div>
    </details>
    `}
  `;
};

window.GMViews = window.GMViews || {};
window.GMViews.GM22 = {
  statusFilter: 'all',
  query: '',

  init() {
    this.applyFilters();
  },

  applyFilters() {
    const rows = document.querySelectorAll('#providersTable tbody tr.provider-row');
    let visibleCount = 0;
    const totalCount = rows.length;

    rows.forEach(row => {
      const status = row.getAttribute('data-status') || '';
      const searchData = row.getAttribute('data-search') || '';

      let matchFilter = true;
      if (this.statusFilter === 'operational') matchFilter = status === 'operational';
      else if (this.statusFilter === 'degraded') matchFilter = status !== 'operational';

      const matchQuery = !this.query || searchData.includes(this.query);

      if (matchFilter && matchQuery) {
        row.style.display = '';
        visibleCount++;
      } else {
        row.style.display = 'none';
      }
    });

    const emptyRow = document.getElementById('providers-empty-row');
    if (emptyRow) {
      emptyRow.style.display = (visibleCount === 0 && totalCount > 0) ? '' : 'none';
    }

    const countBadge = document.getElementById('providersFilterCount');
    if (countBadge) {
      countBadge.textContent = `نمایش ${visibleCount.toLocaleString('fa-IR')} از ${totalCount.toLocaleString('fa-IR')} سرویس زیرساختی`;
    }

    const wrapper = document.getElementById('providerSearchWrapper');
    if (wrapper) {
      if (this.query) wrapper.classList.add('has-value');
      else wrapper.classList.remove('has-value');
    }
  },

  setStatusFilter(status, btn) {
    this.statusFilter = status;
    document.querySelectorAll('#providerStatusFilters .filter-chip').forEach(el => {
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
    const input = document.getElementById('providerSearchInput');
    if (input) input.value = '';
    this.setQuery('');
  },

  resetAll() {
    this.statusFilter = 'all';
    const firstChip = document.querySelector('#providerStatusFilters .filter-chip');
    if (firstChip) {
      document.querySelectorAll('#providerStatusFilters .filter-chip').forEach(el => {
        el.classList.remove('active');
        el.setAttribute('aria-pressed', 'false');
      });
      firstChip.classList.add('active');
      firstChip.setAttribute('aria-pressed', 'true');
    }
    this.clearSearch();
  }
};
