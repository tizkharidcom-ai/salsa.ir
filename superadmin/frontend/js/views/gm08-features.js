/**
 * prototype/js/views/gm08-features.js
 * 
 * GM-08: کاتالوگ قابلیت‌ها (/features)
 * فهرست ۴۸ قابلیت قابل فروش طبق بخش ۷.۲ سند GODMODE.MD با دراور مشخصات فنی
 */

window.renderGM08 = function() {
  const store = window.prototypeStore || window.GMStore;
  const features = store ? store.getFeatures() : [];
  const suspendedFeatures = features.filter(f => f.globallyDisabled);
  const activeFeatures = features.filter(f => !f.globallyDisabled);

  // Category counts
  const categoryCounts = {};
  features.forEach(f => {
    categoryCounts[f.category] = (categoryCounts[f.category] || 0) + 1;
  });

  return `
    <div class="page-header gm08-page">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
          <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current" aria-current="page">کاتالوگ قابلیت‌ها</span>
        </nav>
        <div style="display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap;">
          <h1 style="display: flex; align-items: center; gap: 0.5rem; margin: 0;">
            کاتالوگ سرویس‌های پلتفرم
            <span class="page-code-badge">GM-08</span>
          </h1>
          <span class="badge badge-scope-global"><span class="status-dot dot-purple"></span> کلان پلتفرم</span>
          ${suspendedFeatures.length > 0 ? `
            <span class="badge badge-danger" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); font-weight: 600;">
              <span class="status-dot dot-red pulse"></span> ${suspendedFeatures.length.toLocaleString('fa-IR')} ماژول در تعلیق موقت
            </span>
          ` : `
            <span class="badge badge-success" style="font-weight: 600;">
              <span class="status-dot dot-green"></span> کلیه ۴۸ ماژول عملیاتی
            </span>
          `}
        </div>
        <p>فهرست مرجع ${features.length.toLocaleString('fa-IR')} قابلیت قابل واگذاری با کلید قطع اضطراری سراسری (Kill-Switch) و تحلیل وابستگی‌ها</p>
      </div>
      <div class="header-actions">
        <a href="#gm-15-simulator" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 0.4rem;">
          <span>🎯</span>
          <span>شبیه‌ساز فروش افزونه</span>
        </a>
        <button class="btn btn-secondary" onclick="window.GMViews.GM08.openDependencyGraphDrawer()" style="display: inline-flex; align-items: center; gap: 0.4rem;">
          <span>🌲</span>
          <span>بررسی گراف وابستگی</span>
        </button>
      </div>
    </div>

    ${suspendedFeatures.length > 0 ? `
    <div class="card" style="margin-bottom: 1.25rem; border-color: rgba(239, 68, 68, 0.4); background: linear-gradient(135deg, rgba(239, 68, 68, 0.09) 0%, rgba(245, 158, 11, 0.05) 100%); border-radius: 12px; box-shadow: 0 4px 14px rgba(239, 68, 68, 0.08);">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.85rem; padding: 0.35rem 0.25rem;">
        <div style="display: flex; align-items: center; gap: 0.85rem;">
          <div style="width: 44px; height: 44px; border-radius: 10px; background: rgba(239, 68, 68, 0.15); display: flex; align-items: center; justify-content: center; font-size: 1.35rem; flex-shrink: 0;">
            ⚠️
          </div>
          <div>
            <div style="font-size: 0.95rem; font-weight: 700; color: var(--state-danger);">
              هشدار پلتفرم: ${suspendedFeatures.length.toLocaleString('fa-IR')} قابلیت در وضعیت تعلیق موقت جهت به‌روزرسانی (Global Kill-Switch) قرار دارند.
            </div>
            <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 0.25rem; line-height: 1.5;">
              دسترسی به این ماژول‌ها برای تمامی مشتریان مسدود گردیده، اما سایر ماژول‌ها و کلیه پایگاه‌های داده بدون اختلال فعال هستند.
            </div>
          </div>
        </div>
        <button type="button" class="btn btn-outline-danger btn-sm" onclick="window.GMViews.GM08.setCategory('suspended', null)" style="font-weight: 600;">
          مشاهده ماژول‌های در حال تعمیر (${suspendedFeatures.length.toLocaleString('fa-IR')})
        </button>
      </div>
    </div>
    ` : ''}

    <!-- Platform Capability Overview Metric Strip -->
    <div class="card" style="margin-bottom: 1.25rem; border-color: rgba(2, 132, 199, 0.22); background: linear-gradient(135deg, rgba(2, 132, 199, 0.05) 0%, rgba(99, 102, 241, 0.04) 100%); border-radius: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.85rem;">
        <div style="display: flex; align-items: center; gap: 0.85rem;">
          <div style="width: 44px; height: 44px; border-radius: 10px; background: rgba(2, 132, 199, 0.12); display: flex; align-items: center; justify-content: center; font-size: 1.35rem; flex-shrink: 0;">
            🧩
          </div>
          <div>
            <div style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary);">مدیریت جامع ${features.length.toLocaleString('fa-IR')} قابلیت و ماژول پلتفرم SALSA</div>
            <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 0.25rem; line-height: 1.45;">
              کلید قطع اضطراری سراسری (Kill-Switch) دسترسی به هر ماژول را در کلیه مشتریان جهت نگهداری متوقف می‌سازد بدون اینکه در سایر بخش‌ها اختلال ایجاد کند.
            </div>
          </div>
        </div>
        <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="window.GMViews.GM08.openDependencyGraphDrawer()">
            نمایش ساختار درختی (DAG)
          </button>
          <a href="#gm-03-tenants" class="btn btn-outline-cyan btn-sm">
            انتخاب مشتری برای تخصیص ↗
          </a>
        </div>
      </div>
    </div>

    <div class="data-quality-strip" role="status" aria-label="وضعیت منبع کاتالوگ قابلیت‌ها">
      <div class="data-quality-label"><span class="dq-badge-dot dot-cyan"></span><span>وضعیت کاتالوگ</span></div>
      <div class="data-quality-grid">
        <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">منبع</span><span class="dq-dim-val">${features.length.toLocaleString('fa-IR')} ماژول</span></span>
        <span class="dq-badge"><span class="dq-badge-dot ${suspendedFeatures.length > 0 ? 'dot-red' : 'dot-emerald'}"></span><span class="dq-dim-name">سرویس‌دهی سراسری</span><span class="dq-dim-val">${suspendedFeatures.length > 0 ? `${suspendedFeatures.length} در تعلیق موقت` : '۱۰۰٪ برخط'}</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">اعتبار</span><span class="dq-dim-val">عملیاتی و آماده فعال‌سازی</span></span>
      </div>
      <span class="dq-action-hint"><span>کاتالوگ قابلیت‌های فعال و افزونه‌های تجاری پلتفرم SALSA</span></span>
    </div>

    ${window.GMDataState ? window.GMDataState.renderFreshnessBar({
      viewId: 'GM08',
      sourceLabel: `کاتالوگ مرجع ${features.length.toLocaleString('fa-IR')} قابلیت تجاری و فنی پلتفرم`,
      sourceMode: 'local',
      totalCount: features.length,
      countLabel: 'قابلیت تجاری'
    }) : ''}

    ${(() => {
      const dataState = window.GMDataState ? window.GMDataState.getViewState('GM08') : { state: 'live' };
      if (dataState.state === 'failed' || dataState.state === 'error') {
        return window.GMDataState.renderFailedState({
          viewId: 'GM08',
          title: 'خطا در بارگذاری کاتالوگ قابلیت‌ها',
          reason: 'ارتباط با رجیستری مرکزی لایسنس‌ها برقرار نشد.',
          errorCode: 'ERR_FEATURES_FETCH_FAILED'
        });
      }
      if (dataState.state === 'empty') {
        return window.GMDataState.renderEmptyState({
          title: 'هیچ قابلیتی یافت نشد',
          description: 'کاتالوگ قابلیت‌های تجاری خالی است.',
          actionLabel: 'بارگذاری مجدد',
          actionHash: '#gm-08-features'
        });
      }
      if (dataState.state === 'loading') {
        return window.GMDataState.renderSkeleton('table', 6);
      }
      if (dataState.state === 'stale') {
        return window.GMDataState.renderStaleBanner('GM08');
      }
      if (dataState.state === 'refreshing') {
        return window.GMDataState.renderRefreshingBanner ? window.GMDataState.renderRefreshingBanner('GM08') : '';
      }
      return '';
    })()}

    ${(window.GMDataState && ['failed', 'empty', 'error', 'loading'].includes(window.GMDataState.getViewState('GM08').state)) ? '' : `
    <div class="table-wrapper">
      <div class="table-toolbar">
        <div class="table-filters" id="featureCategoryFilters" role="group" aria-label="دسته‌بندی قابلیت‌های تجاری">
          <button class="filter-chip active" aria-pressed="true" onclick="filterFeatures('all', this)">🌐 همه (${features.length})</button>
          <button class="filter-chip" aria-pressed="false" onclick="filterFeatures('کاتالوگ', this)">📦 کاتالوگ (${categoryCounts['کاتالوگ'] || 0})</button>
          <button class="filter-chip" aria-pressed="false" onclick="filterFeatures('سفارشات', this)">🛒 سفارشات (${categoryCounts['سفارشات'] || 0})</button>
          <button class="filter-chip" aria-pressed="false" onclick="filterFeatures('مالی', this)">💳 مالی و حسابداری (${categoryCounts['مالی'] || 0})</button>
          <button class="filter-chip" aria-pressed="false" onclick="filterFeatures('انبار', this)">🥫 انبار و دستور تهیه (${categoryCounts['انبار'] || 0})</button>
          <button class="filter-chip" aria-pressed="false" onclick="filterFeatures('CRM', this)">👥 CRM و وفاداری (${categoryCounts['CRM'] || 0})</button>
          <button class="filter-chip" aria-pressed="false" onclick="filterFeatures('پلتفرم', this)">⚙️ پلتفرم و زیرساخت (${categoryCounts['پلتفرم'] || 0})</button>
          <button class="filter-chip ${suspendedFeatures.length > 0 ? 'filter-chip-warning' : ''}" aria-pressed="false" onclick="filterFeatures('suspended', this)" style="${suspendedFeatures.length > 0 ? 'border-color: rgba(239, 68, 68, 0.4); color: #f87171;' : ''}">
            ⚡ تعلیق موقت (${suspendedFeatures.length.toLocaleString('fa-IR')})
          </button>
        </div>
        <div class="table-search-group">
          <span id="featuresFilterCount" class="filter-count-badge">نمایش ${features.length.toLocaleString('fa-IR')} از ${features.length.toLocaleString('fa-IR')} قابلیت</span>
          <div class="search-input-wrapper" id="featureSearchWrapper">
            <input type="text" id="featureSearchInput" class="form-control" placeholder="جست‌وجو در کلید یا عنوان..." aria-label="جست‌وجو در کلید یا عنوان قابلیت‌ها" style="width: 240px; padding: 0.35rem 0.75rem;" oninput="window.GMViews.GM08.setQuery(this.value)" />
            <button class="search-clear-btn" onclick="window.GMViews.GM08.clearSearch()" aria-label="پاکسازی جستجو">✕</button>
          </div>
        </div>
      </div>

      <div class="table-responsive">
        <table class="data-table" id="featuresTable" aria-label="جدول کاتالوگ قابلیت‌های تجاری و افزونه‌ها">
          <thead>
            <tr>
              <th class="cell-checkbox" style="width: 40px; text-align: center;">
                <input type="checkbox" id="features-select-all" aria-label="انتخاب همه قابلیت‌ها" />
              </th>
              <th>قابلیت و پیش‌نیازها</th>
              <th>دسته‌بندی</th>
              <th>تعرفه افزونه (ماهانه)</th>
              <th>وضعیت سراسری پلتفرم</th>
              <th class="cell-actions">اقدامات</th>
            </tr>
          </thead>
          <tbody>
            ${features.map(f => {
              const catIcon = {
                'کاتالوگ': '📦',
                'سفارشات': '🛒',
                'مالی': '💳',
                'انبار': '🥫',
                'CRM': '👥',
                'پلتفرم': '⚙️',
                'پایه': '⚡'
              }[f.category] || '🧩';

              return `
              <tr id="row-feat-${f.key.replace(/\./g, '-')}" data-category="${f.category}" data-status="${f.globallyDisabled ? 'suspended' : 'active'}" data-search="${f.key} ${f.nameFa} ${f.category} ${f.globallyDisabled ? 'معلق تعمیرات قطع موقت' : 'فعال'}">
                <td class="cell-checkbox" style="text-align: center;">
                  <input type="checkbox" class="feature-row-select" data-id="${f.key}" aria-label="انتخاب قابلیت ${f.nameFa}" />
                </td>
                <td class="cell-primary" style="font-weight: 500;">
                  <div class="feature-title-cell" style="display: flex; flex-direction: column; gap: 0.25rem;">
                    <div style="display: flex; align-items: center; gap: 0.45rem;">
                      <span style="font-size: 1rem;">${catIcon}</span>
                      <strong style="color: var(--text-primary); font-size: 0.875rem;">${f.nameFa}</strong>
                      ${f.key === 'finance.workspace' ? '<span class="badge badge-emerald" style="font-size: 0.65rem;">هسته مالی</span>' : ''}
                    </div>
                    <details class="row-disclosure feature-row-disclosure" style="margin-top: 0.15rem;">
                      <summary style="font-size: 0.72rem; color: var(--text-secondary); cursor: pointer;">شناسه و پیش‌نیازها</summary>
                      <div class="feature-technical-details" style="margin-top: 0.35rem; padding: 0.4rem 0.5rem; background: var(--bg-surface-subtle); border-radius: 6px; font-size: 0.72rem;">
                        <span class="cell-mono feature-key-detail" style="color: var(--accent-cyan); font-weight: 600;">${f.key}</span>
                        <div class="feature-dependency-detail" style="margin-top: 0.25rem;">
                          ${f.dependencies.length === 0
                            ? '<span class="text-secondary">قابلیت پایه و مستقل</span>'
                            : `پیش‌نیاز: ${f.dependencies.map(d => `<span class="badge badge-warning cell-mono" style="margin: 0 2px; font-size: 0.65rem;">${d}</span>`).join('')}`}
                        </div>
                      </div>
                    </details>
                  </div>
                </td>
                <td>
                  <span class="badge badge-neutral" style="font-size: 0.75rem;">${catIcon} ${f.category}</span>
                </td>
                <td class="cell-mono" style="font-size: 0.8rem;">
                  ${f.pricePerMonth === 0 
                    ? '<span class="badge badge-success" style="font-size: 0.72rem;">رایگان در پلن</span>' 
                    : `<strong style="color: var(--text-primary);">${f.pricePerMonth.toLocaleString('fa-IR')}</strong> <span style="font-size: 0.7rem; color: var(--text-secondary);">تومان</span>`
                  }
                </td>
                <td>
                  ${f.globallyDisabled ? `
                    <div style="display: inline-flex; flex-direction: column; gap: 0.25rem;">
                      <span class="badge badge-danger" style="display: inline-flex; align-items: center; gap: 0.35rem; width: fit-content; background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 0.75rem;">
                        <span class="status-dot dot-red pulse"></span> تعلیق موقت سراسری
                      </span>
                      <span style="font-size: 0.7rem; color: var(--text-tertiary); max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${f.maintenanceReason || 'تعمیرات سراسری پلتفرم'}">
                        علت: ${f.maintenanceReason || 'به‌روزرسانی زیرساخت'}
                      </span>
                    </div>
                  ` : `
                    <span class="badge badge-success" style="display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.75rem;">
                      <span class="badge-dot dot-green"></span> فعال در سراسر پلتفرم
                    </span>
                  `}
                </td>
                <td class="cell-actions">
                  <div style="display: flex; gap: 0.35rem; justify-content: flex-end; align-items: center;">
                    <button class="btn btn-sm btn-secondary" aria-label="مشاهده جزئیات فنی قابلیت ${f.nameFa} (${f.key})" onclick="openFeatureDrawer('${f.key}')">
                      جزئیات فنی
                    </button>
                    ${f.globallyDisabled ? `
                      <button type="button" class="btn btn-sm btn-success" onclick="window.GMViews.GM08.restoreGlobalFeature('${f.key}')" title="پایان به‌روزرسانی و فعال‌سازی سراسری">
                        ✓ فعال‌سازی
                      </button>
                    ` : `
                      <button type="button" class="btn btn-sm btn-outline-danger" onclick="window.GMViews.GM08.openKillSwitchModal('${f.key}')" title="قطع اضطراری و تعلیق موقت در سطح کل پلتفرم">
                        ⚡ قطع موقت
                      </button>
                    `}
                  </div>
                </td>
              </tr>
              `;
            }).join('')}
            <tr id="features-empty-row" style="display: none;">
              <td colspan="6" style="text-align: center; padding: 2.5rem 1rem;">
                <div class="empty-state empty-state-compact">
                  <div class="empty-state-icon" style="font-size: 2rem;">🔍</div>
                  <h3 style="margin: 0.5rem 0 0.25rem;">قابلیتی با این مشخصات یافت نشد</h3>
                  <p style="color: var(--text-secondary); font-size: 0.8rem;">عبارت جستجو یا دسته‌بندی انتخاب‌شده را بررسی نمایید.</p>
                  <button class="btn btn-secondary btn-sm" onclick="window.GMViews.GM08.resetAll()" style="margin-top: 0.75rem;">بازنشانی فیلترها</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Bulk Actions Docked Bar -->
    <div id="gm08-bulk-actions" class="table-bulk-actions-bar" role="toolbar" aria-label="عملیات گروهی روی قابلیت‌های انتخاب‌شده">
      <div class="bulk-actions-info">
        <span class="bulk-counter-badge" id="gm08-bulk-count">۰ مورد انتخاب‌شده</span>
        <span class="bulk-actions-label">اقدامات دسته‌جمعی قابلیت‌ها:</span>
      </div>
      <div class="bulk-actions-btns">
        <button type="button" class="btn btn-primary btn-sm" id="gm08-bulk-check-btn" onclick="window.GMViews.GM08.checkSelectedDeps()" disabled>
          بررسی وابستگی گروهی
        </button>
        <button type="button" class="btn btn-secondary btn-sm" id="gm08-bulk-export-btn" onclick="window.GMViews.GM08.exportSelected()" disabled>
          خروجی شناسه قابلیت‌ها
        </button>
        <button type="button" class="btn btn-outline-danger btn-sm" id="gm08-bulk-disable-btn" onclick="window.GMViews.GM08.bulkDisableSelected()" disabled>
          ⚡ تعلیق موقت گروهی
        </button>
        <button type="button" class="btn btn-success btn-sm" id="gm08-bulk-enable-btn" onclick="window.GMViews.GM08.bulkEnableSelected()" disabled>
          ✓ فعال‌سازی گروهی
        </button>
        <button type="button" class="bulk-clear-btn" onclick="window.GMViews.GM08.clearSelection()">
          لغو انتخاب
        </button>
      </div>
    </div>
    `}
  `;
};

window.GMViews = window.GMViews || {};
window.GMViews.GM08 = {
  render: window.renderGM08,
  category: 'all',
  query: '',

  applyFilters() {
    const rows = document.querySelectorAll('#featuresTable tbody tr');
    let visibleCount = 0;
    let totalCount = 0;

    rows.forEach(r => {
      if (r.id === 'features-empty-row') return;
      totalCount++;
      const cat = r.getAttribute('data-category');
      const status = r.getAttribute('data-status');
      const text = (r.getAttribute('data-search') || '').toLowerCase();

      const catMatches = (this.category === 'all')
        || (this.category === 'suspended' && status === 'suspended')
        || (cat === this.category);
      const searchMatches = (!this.query || text.includes(this.query));

      if (catMatches && searchMatches) {
        r.style.display = '';
        visibleCount++;
      } else {
        r.style.display = 'none';
      }
    });

    const emptyRow = document.getElementById('features-empty-row');
    if (emptyRow) emptyRow.style.display = visibleCount === 0 ? '' : 'none';

    const countBadge = document.getElementById('featuresFilterCount');
    if (countBadge) {
      countBadge.textContent = `نمایش ${visibleCount.toLocaleString('fa-IR')} از ${totalCount.toLocaleString('fa-IR')} قابلیت`;
    }

    const wrapper = document.getElementById('featureSearchWrapper');
    if (wrapper) {
      if (this.query) wrapper.classList.add('has-value');
      else wrapper.classList.remove('has-value');
    }

    if (this.tableSelect) {
      this.tableSelect.sync();
    }
  },

  setCategory(cat, btn) {
    this.category = cat;
    document.querySelectorAll('#featureCategoryFilters .filter-chip').forEach(el => {
      el.classList.remove('active');
      el.setAttribute('aria-pressed', 'false');
    });
    if (btn) {
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
    } else {
      const matchChip = Array.from(document.querySelectorAll('#featureCategoryFilters .filter-chip')).find(el => el.textContent.includes(cat === 'suspended' ? 'تعلیق' : cat));
      if (matchChip) {
        matchChip.classList.add('active');
        matchChip.setAttribute('aria-pressed', 'true');
      }
    }
    this.applyFilters();
  },

  setQuery(q) {
    this.query = (q || '').trim().toLowerCase();
    this.applyFilters();
  },

  clearSearch() {
    const input = document.getElementById('featureSearchInput');
    if (input) input.value = '';
    this.setQuery('');
  },

  resetAll() {
    this.category = 'all';
    const firstChip = document.querySelector('#featureCategoryFilters .filter-chip');
    if (firstChip) {
      document.querySelectorAll('#featureCategoryFilters .filter-chip').forEach(el => {
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

  tableSelect: null,

  afterRender() {
    this.initSelection();
  },

  initSelection() {
    if (window.GMTableSelect) {
      this.tableSelect = window.GMTableSelect.initTable('#featuresTable', {
        selectAllSelector: '#features-select-all',
        rowCheckboxSelector: '.feature-row-select',
        bulkBarId: 'gm08-bulk-actions',
        countBadgeId: 'gm08-bulk-count'
      });
    }
  },

  clearSelection() {
    if (this.tableSelect) {
      this.tableSelect.clear();
    }
  },

  checkSelectedDeps() {
    const ids = this.tableSelect ? this.tableSelect.getSelectedIds() : [];
    if (ids.length === 0) {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast('لطفاً ابتدا حداقل یک قابلیت را انتخاب نمایید.', 'warning');
      }
      return;
    }
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast(`گراف پیش‌نیازهای ${ids.length} قابلیت با موفقیت بررسی شد؛ اعتبارسنجی وابستگی بر اساس Fixture پلتفرم انجام گردید.`, 'info');
    }
  },

  exportSelected() {
    const ids = this.tableSelect ? this.tableSelect.getSelectedIds() : [];
    if (ids.length === 0) {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast('لطفاً ابتدا حداقل یک قابلیت را انتخاب نمایید.', 'warning');
      }
      return;
    }
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast(`فهرست شناسه ${ids.length} قابلیت در خروجی محلی Mock پلتفرم ذخیره شد.`, 'info');
    }
  },

  openKillSwitchModal(featureKey) {
    const store = window.prototypeStore || window.GMStore;
    const features = store ? store.getFeatures() : [];
    const feature = features.find(f => f.key === featureKey);
    if (!feature) return;

    const affectedTenants = store && store.getFeatureAffectedTenants ? store.getFeatureAffectedTenants(featureKey) : [];

    const content = `
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 8px; padding: 0.85rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem; font-weight: 700; color: var(--state-danger); font-size: 0.875rem;">
            <span>⚡</span>
            <span>توقف موقت ماژول در سطح کلان پلتفرم SALSA (Global Kill-Switch)</span>
          </div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.35rem; line-height: 1.55;">
            با تایید این عملیات، این قابلیت به صورت مرکزی برای <strong>تمامی مشتریان و کاربران پلتفرم</strong> مسدود می‌شود تا بتوانید عملیات ارتقا یا نگهداری را انجام دهید. سایر امکانات و مشتریان بدون کوچکترین اختلال به سرویس‌دهی ادامه می‌دهند.
          </div>
        </div>

        <div class="kv-list">
          <div class="kv-item">
            <span class="kv-label">قابلیت هدف:</span>
            <strong class="text-primary">${feature.nameFa}</strong>
          </div>
          <div class="kv-item">
            <span class="kv-label">شناسه سیستمی:</span>
            <code class="cell-mono text-cyan">${feature.key}</code>
          </div>
          <div class="kv-item">
            <span class="kv-label">دسته‌بندی:</span>
            <span class="badge badge-neutral">${feature.category}</span>
          </div>
          <div class="kv-item">
            <span class="kv-label">شعاع تأثیر (Blast Radius):</span>
            <span class="badge ${affectedTenants.length > 0 ? 'badge-warning' : 'badge-neutral'}">
              ${affectedTenants.length.toLocaleString('fa-IR')} مجموعه فعال دارای این ماژول
            </span>
          </div>
        </div>

        ${affectedTenants.length > 0 ? `
          <div class="surface-subtle" style="padding: 0.6rem; border-radius: 6px; font-size: 0.75rem;">
            <div style="color: var(--text-secondary); margin-bottom: 0.25rem;">مشتریان تحت تأثیر مستقیم:</div>
            <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
              ${affectedTenants.map(t => `<span class="badge badge-neutral">${t.name}</span>`).join('')}
            </div>
          </div>
        ` : ''}

        <div class="form-group" style="margin-bottom: 0;">
          <label class="form-label" for="killswitch-reason">
            دلیل قطع موقت و پیام اطلاع‌رسانی به کاربران (الزامی) *
          </label>
          <input type="text" id="killswitch-reason" class="form-control" 
                 placeholder="مثلاً: به‌روزرسانی نسخه جدید، ارتقای دیتابیس، رفع باگ امنیتی..." 
                 value="به‌روزرسانی زیرساخت پلتفرم و ارتقای ماژول" />
        </div>
      </div>
    `;

    if (window.GMApp && typeof window.GMApp.openModal === 'function') {
      window.GMApp.openModal(
        `قطع موقت سراسری: ${feature.nameFa}`,
        content,
        () => {
          const reasonInput = document.getElementById('killswitch-reason');
          const reason = reasonInput ? reasonInput.value.trim() : '';
          this.confirmGlobalKillSwitch(featureKey, reason);
        },
        {
          confirmText: 'قطع سراسری و شروع نگهداری',
          confirmClass: 'btn-danger',
          severity: 'danger',
          severityLabel: 'توقف سرویس'
        }
      );
    } else {
      const reason = prompt(`دلیل قطع موقت ماژول ${feature.nameFa} را وارد کنید:`, 'به‌روزرسانی زیرساخت پلتفرم و ارتقای ماژول');
      if (reason !== null) {
        this.confirmGlobalKillSwitch(featureKey, reason);
      }
    }
  },

  confirmGlobalKillSwitch(featureKey, reason) {
    const store = window.prototypeStore || window.GMStore;
    if (!store) return;
    const res = store.toggleFeatureGlobal(featureKey, false, reason);
    if (res.success) {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast(`ماژول «${res.feature.nameFa}» در سراسر پلتفرم موقتاً متوقف شد.`, 'warning');
      }
      if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
        window.GMRouter.refresh();
      } else {
        window.location.hash = `#gm-08-features?t=${Date.now()}`;
      }
    }
  },

  restoreGlobalFeature(featureKey) {
    const store = window.prototypeStore || window.GMStore;
    if (!store) return;
    const res = store.toggleFeatureGlobal(featureKey, true);
    if (res.success) {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast(`ماژول «${res.feature.nameFa}» با موفقیت در سراسر پلتفرم مجدداً فعال شد.`, 'success');
      }
      if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
        window.GMRouter.refresh();
      } else {
        window.location.hash = `#gm-08-features?t=${Date.now()}`;
      }
    }
  },

  bulkDisableSelected() {
    const ids = this.tableSelect ? this.tableSelect.getSelectedIds() : [];
    if (ids.length === 0) {
      if (window.GMApp && window.GMApp.showToast) window.GMApp.showToast('لطفاً حداقل یک قابلیت را انتخاب نمایید.', 'warning');
      return;
    }
    const store = window.prototypeStore || window.GMStore;
    if (store && store.bulkToggleFeaturesGlobal) {
      store.bulkToggleFeaturesGlobal(ids, false, 'تعلیق گروهی موقت توسط مدیر ارشد');
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast(`تعداد ${ids.length} قابلیت به صورت گروهی متوقف شدند.`, 'warning');
      }
      if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
        window.GMRouter.refresh();
      } else {
        window.location.hash = `#gm-08-features?t=${Date.now()}`;
      }
    }
  },

  bulkEnableSelected() {
    const ids = this.tableSelect ? this.tableSelect.getSelectedIds() : [];
    if (ids.length === 0) {
      if (window.GMApp && window.GMApp.showToast) window.GMApp.showToast('لطفاً حداقل یک قابلیت را انتخاب نمایید.', 'warning');
      return;
    }
    const store = window.prototypeStore || window.GMStore;
    if (store && store.bulkToggleFeaturesGlobal) {
      store.bulkToggleFeaturesGlobal(ids, true);
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast(`تعداد ${ids.length} قابلیت به صورت گروهی مجدداً فعال شدند.`, 'success');
      }
      if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
        window.GMRouter.refresh();
      } else {
        window.location.hash = `#gm-08-features?t=${Date.now()}`;
      }
    }
  },

  verifyFeatureChain(key) {
    const store = window.prototypeStore || window.GMStore;
    const features = store ? store.getFeatures() : [];
    const feature = features.find(f => f.key === key);
    if (!feature) return;
    const deps = feature.dependencies || [];
    if (deps.length === 0) {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast(`قابلیت «${feature.nameFa}» (${feature.key}) در Fixture بدون وابستگی ثبت شده؛ کاتالوگ عملیاتی تأیید نشده است.`, 'info');
      }
    } else {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast(`زنجیره وابستگی «${feature.nameFa}» در Fixture نمایش داده شد؛ DAG عملیاتی و policy معتبر تأیید نشده است.`, 'info');
      }
    }
  },

  openDependencyGraphDrawer() {
    const store = window.prototypeStore || window.GMStore;
    const features = store && store.getFeatures ? store.getFeatures() : [];

    const totalCount = features.length;
    const rootFeatures = features.filter(f => !f.dependencies || f.dependencies.length === 0);
    const dependentFeatures = features.filter(f => f.dependencies && f.dependencies.length > 0);

    // Group by category
    const categories = {};
    features.forEach(f => {
      categories[f.category] = categories[f.category] || [];
      categories[f.category].push(f);
    });

    const content = `
      <div style="display: flex; flex-direction: column; gap: 1.25rem;">
        <!-- KPI Metric Cards -->
        <div class="drawer-kpi-grid">
          <div class="drawer-kpi-card">
            <div class="drawer-kpi-title">کل قابلیت‌های پلتفرم</div>
            <div class="drawer-kpi-value" style="color: var(--text-primary);">${totalCount.toLocaleString('fa-IR')}</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">تعداد مصوب سند GODMODE</div>
          </div>

          <div class="drawer-kpi-card">
            <div class="drawer-kpi-title">قابلیت‌های ریشه (پایه)</div>
            <div class="drawer-kpi-value" style="color: var(--state-success);">${rootFeatures.length.toLocaleString('fa-IR')}</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">مستقل و بدون وابستگی</div>
          </div>

          <div class="drawer-kpi-card">
            <div class="drawer-kpi-title">افزونه‌های وابسته</div>
            <div class="drawer-kpi-value" style="color: var(--accent-cyan);">${dependentFeatures.length.toLocaleString('fa-IR')}</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">مشروط به احراز پیش‌نیاز</div>
          </div>

          <div class="drawer-kpi-card">
            <div class="drawer-kpi-title">وضعیت سلامت گراف</div>
            <div class="drawer-kpi-value" style="color: var(--state-success); font-size: 1.05rem;">فاقد دور (DAG)</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">تضمین عدم بن‌بست لایسنس</div>
          </div>
        </div>

        <!-- 4D Data Quality Audit Strip -->
        <div class="data-quality-strip" role="status" aria-label="وضعیت کیفیت داده‌های گراف">
          <div class="data-quality-label"><span class="dq-badge-dot dot-cyan"></span><span>ممیزی ساختار درختی</span></div>
          <div class="data-quality-grid">
            <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">پوشش</span><span class="dq-dim-val">۱۰۰٪ (کامل)</span></span>
            <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">اعتبار DAG</span><span class="dq-dim-val">تأییدشده و بدون حلقه</span></span>
            <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">حداکثر عمق</span><span class="dq-dim-val">۳ لایه</span></span>
            <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">اتصال API</span><span class="dq-dim-val">فعال و متصل</span></span>
          </div>
        </div>

        <!-- Key Architectural Chains -->
        <div class="drawer-section">
          <h4 class="drawer-section-title">زنجیره‌های کلیدی وابستگی در پلتفرم</h4>
          <div style="display: flex; flex-direction: column; gap: 0.6rem;">
            <div class="surface-subtle" style="padding: 0.75rem; border-radius: 6px;">
              <div style="font-weight: 600; font-size: 0.813rem; color: var(--text-primary); margin-bottom: 0.35rem;">
                باشگاه مشتریان و وفاداری:
              </div>
              <div style="font-size: 0.75rem; color: var(--text-secondary); line-height: 1.5;">
                <code class="cell-mono text-cyan">crm.loyalty</code>
                <span style="color: var(--text-tertiary); margin: 0 0.35rem;">← وابسته به</span>
                <code class="cell-mono">crm.directory</code>
                <span class="badge badge-neutral" style="margin-right: 0.5rem; font-size: 0.688rem;">الزام ثبت پرونده جهت تخصیص امتیاز</span>
              </div>
            </div>

            <div class="surface-subtle" style="padding: 0.75rem; border-radius: 6px;">
              <div style="font-weight: 600; font-size: 0.813rem; color: var(--text-primary); margin-bottom: 0.35rem;">
                سفارش‌گیری سر میز با QR Code:
              </div>
              <div style="font-size: 0.75rem; color: var(--text-secondary); line-height: 1.5;">
                <code class="cell-mono text-cyan">floor.qr</code>
                <span style="color: var(--text-tertiary); margin: 0 0.35rem;">← وابسته به</span>
                <code class="cell-mono">floor.tables</code> + <code class="cell-mono">orders.online</code>
                <span class="badge badge-neutral" style="margin-right: 0.5rem; font-size: 0.688rem;">الزام نقشه سالن و موتور آنلاین</span>
              </div>
            </div>

            <div class="surface-subtle" style="padding: 0.75rem; border-radius: 6px;">
              <div style="font-weight: 600; font-size: 0.813rem; color: var(--text-primary); margin-bottom: 0.35rem;">
                آنالیز قیمت تمام‌شده و دستور تهیه:
              </div>
              <div style="font-size: 0.75rem; color: var(--text-secondary); line-height: 1.5;">
                <code class="cell-mono text-cyan">inventory.recipes</code>
                <span style="color: var(--text-tertiary); margin: 0 0.35rem;">← وابسته به</span>
                <code class="cell-mono">catalog.menu</code> + <code class="cell-mono">inventory.warehouse</code>
                <span class="badge badge-neutral" style="margin-right: 0.5rem; font-size: 0.688rem;">فرمول‌بندی مصرف کالا و انبار</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Categories & Tree Breakdown -->
        <div class="drawer-section">
          <h4 class="drawer-section-title">پراکندگی قابلیت‌ها در دسته‌بندی‌های ۶ گانه</h4>
          <div style="display: flex; flex-direction: column; gap: 0.75rem;">
            ${Object.entries(categories).map(([catName, catFeatures]) => `
              <div style="border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.65rem 0.75rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
                  <strong style="font-size: 0.813rem; color: var(--text-primary);">${catName}</strong>
                  <span class="badge badge-neutral" style="font-size: 0.7rem;">${catFeatures.length.toLocaleString('fa-IR')} قابلیت</span>
                </div>
                <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
                  ${catFeatures.map(f => `
                    <button type="button" class="badge ${f.dependencies.length === 0 ? 'badge-success' : 'badge-warning'} cell-mono" 
                            style="cursor: pointer; font-size: 0.688rem; border: none;"
                            onclick="window.openFeatureDrawer('${f.key}')"
                            title="${f.nameFa}: ${f.dependencies.length === 0 ? 'پایه' : f.dependencies.join(', ')}">
                      ${f.key}
                    </button>
                  `).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- CTA Toolbar -->
        <div class="drawer-cta-toolbar">
          <a href="#gm-15-simulator" class="btn btn-primary drawer-cta-btn" onclick="window.GMApp && window.GMApp.closeDrawer ? window.GMApp.closeDrawer() : null">
            <span>ورود به شبیه‌ساز فروش افزونه</span>
            <span>←</span>
          </a>
          <button type="button" class="btn btn-secondary drawer-cta-btn" onclick="window.GMApp && window.GMApp.closeDrawer ? window.GMApp.closeDrawer() : null">
            <span>بستن و بازگشت به کاتالوگ</span>
          </button>
        </div>
      </div>
    `;

    if (window.GMApp && window.GMApp.openDrawer) {
      window.GMApp.openDrawer('تحلیل گراف وابستگی قابلیت‌ها (Feature Dependency Graph)', content, { subtitle: 'ساختار مستقیم بی دور (DAG) و زنجیره پیش‌نیازهای فعال‌سازی' });
    } else if (typeof openDrawer === 'function') {
      openDrawer('تحلیل گراف وابستگی قابلیت‌ها (Feature Dependency Graph)', content);
    }
  },

  openFeatureDrawer(featureKey) {
    return window.openFeatureDrawer(featureKey);
  }
};

window.filterFeatures = function(category, btn) {
  window.GMViews.GM08.setCategory(category, btn);
};

window.searchFeatures = function(q) {
  window.GMViews.GM08.setQuery(q);
};

window.openFeatureDrawer = function(featureKey) {
  const store = window.prototypeStore || window.GMStore;
  const features = store && store.getFeatures ? store.getFeatures() : [];
  const feature = features.find(f => f.key === featureKey);
  if (!feature) return;

  // Features depending on this feature
  const dependents = features.filter(f => f.dependencies && f.dependencies.includes(feature.key));

  const content = `
    <div style="display: flex; flex-direction: column; gap: 1.25rem;">
      <!-- KPI Metric Cards -->
      <div class="drawer-kpi-grid">
        <div class="drawer-kpi-card">
          <div class="drawer-kpi-title">تعرفه اشتراک ماهانه</div>
          <div class="drawer-kpi-value" style="font-size: 1.05rem; color: var(--accent-cyan);">
            ${feature.pricePerMonth === 0 ? 'رایگان در پلن' : `${feature.pricePerMonth.toLocaleString('fa-IR')} تومان`}
          </div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">
            ${feature.pricePerMonth === 0 ? 'شامل در کلیه سطوح' : 'تعرفه مستقل لایسنس'}
          </div>
        </div>

        <div class="drawer-kpi-card">
          <div class="drawer-kpi-title">دسته‌بندی کارکردی</div>
          <div class="drawer-kpi-value" style="font-size: 1.05rem; color: var(--text-primary);">
            ${feature.category}
          </div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">
            حوزه ماژولار پلتفرم
          </div>
        </div>

        <div class="drawer-kpi-card">
          <div class="drawer-kpi-title">تعداد پیش‌نیازها</div>
          <div class="drawer-kpi-value" style="font-size: 1.05rem; color: ${feature.dependencies.length > 0 ? 'var(--state-warning)' : 'var(--state-success)'};">
            ${feature.dependencies.length === 0 ? 'مستقل (۰)' : `${feature.dependencies.length.toLocaleString('fa-IR')} مورد`}
          </div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">
            ${feature.dependencies.length === 0 ? 'قابلیت ریشه (Root)' : 'وابستگی به سایر امکانات'}
          </div>
        </div>

        <div class="drawer-kpi-card">
          <div class="drawer-kpi-title">دامنه تخصیص</div>
          <div class="drawer-kpi-value" style="font-size: 1.05rem; color: var(--accent-cyan);">
            مشتری‌محور
          </div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">
            وضعیت نهایی در پرونده مشتری مشخص می‌شود
          </div>
        </div>
      </div>

      <!-- 4D Operational Telemetry Audit Strip -->
      <div class="data-quality-strip" role="status" aria-label="پایش چهاربعدی کیفیت قابلیت">
        <div class="data-quality-label"><span class="dq-badge-dot dot-cyan"></span><span>ارزیابی چهاربعدی</span></div>
        <div class="data-quality-grid">
          <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">جامعیت</span><span class="dq-dim-val">۱۰۰٪ سازمانی</span></span>
          <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">تازگی</span><span class="dq-dim-val">همگام با پورت ۴۱۸۰</span></span>
          <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">اعتبارسنجی</span><span class="dq-dim-val">تأییدشده</span></span>
          <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">سازگاری</span><span class="dq-dim-val">متوازن و پایدار</span></span>
        </div>
      </div>

      <!-- Technical Identification -->
      <div class="drawer-section">
        <h4 class="drawer-section-title">مشخصات هویتی و فنی</h4>
        <div style="display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.813rem;">
          <div style="display: flex; justify-content: space-between; padding: 0.4rem 0; border-bottom: 1px solid var(--border-subtle);">
            <span style="color: var(--text-secondary);">شناسه سیستمی (Feature Key):</span>
            <span class="cell-mono text-cyan" style="font-weight: 600;">${feature.key}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 0.4rem 0; border-bottom: 1px solid var(--border-subtle);">
            <span style="color: var(--text-secondary);">عنوان استاندارد فارسی:</span>
            <span style="font-weight: 600; color: var(--text-primary);">${feature.nameFa}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 0.4rem 0; border-bottom: 1px solid var(--border-subtle);">
            <span style="color: var(--text-secondary);">نوع واگذاری:</span>
            <span>${feature.pricePerMonth === 0 ? '<span class="badge badge-success">پایه (Core Platform)</span>' : '<span class="badge badge-neutral">افزونه تجاری (Commercial Addon)</span>'}</span>
          </div>
        </div>
      </div>

      <!-- Prerequisites and Chains -->
      <div class="drawer-section">
        <h4 class="drawer-section-title">پیش‌نیازها و زنجیره وابستگی (Dependencies)</h4>
        <div class="surface-subtle" style="padding: 0.75rem; border-radius: 6px;">
          ${feature.dependencies.length === 0 
            ? '<div style="font-size: 0.813rem; color: var(--text-secondary);">این قابلیت مستقل است و بدون نیاز به فعال‌سازی ابزار دیگری در پلتفرم کار می‌کند.</div>'
            : `<div style="font-size: 0.813rem; color: var(--text-primary); margin-bottom: 0.5rem; font-weight: 500;">پیش‌نیازهای مستقیم موردنیاز:</div>
               <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
                 ${feature.dependencies.map(d => `<span class="badge badge-warning cell-mono" style="font-size: 0.72rem;">${d}</span>`).join('')}
               </div>`
          }
          ${dependents.length > 0 ? `
            <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--border-subtle);">
              <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.35rem;">قابلیت‌هایی که به این ویژگی وابسته‌اند (${dependents.length} مورد):</div>
              <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
                ${dependents.map(dp => `<span class="badge badge-neutral cell-mono" style="font-size: 0.7rem;">${dp.nameFa} (${dp.key})</span>`).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      </div>

      <!-- Policy & Fallback Behavior -->
      <div class="drawer-section">
        <h4 class="drawer-section-title">رفتار امنیتی در صورت عدم تخصیص (Policy: OFF)</h4>
        <div class="surface-subtle surface-danger" style="padding: 0.75rem; border-radius: 6px;">
          <div style="font-weight: 600; font-size: 0.813rem; color: var(--state-danger); margin-bottom: 0.35rem;">محدودیت دسترسی و ایزولاسیون:</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); line-height: 1.55;">
            در صورت عدم تخصیص مجوز در کانتینر مشتری، کلیه درخواست‌های API به اندپوینت‌های ماژول با خطای <code class="cell-mono">403 Forbidden</code> مسدود می‌گردند. بخش‌های مربوطه در رابط کاربری پوز و پنل مدیریت رستوران مخفی می‌مانند. داده‌های تاریخی به صورت فقط‌خواندنی جهت ممیزی مالی محفوظ خواهند بود.
          </div>
        </div>
      </div>

      <!-- Global Kill-Switch & Platform Service Status -->
      <div class="drawer-section">
        <h4 class="drawer-section-title">وضعیت سرویس‌دهی سراسری پلتفرم (Platform Kill-Switch)</h4>
        <div class="surface-subtle" style="padding: 0.85rem; border-radius: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <span style="font-weight: 600; font-size: 0.813rem; color: var(--text-primary);">وضعیت برخط ماژول در پلتفرم SALSA:</span>
            ${feature.globallyDisabled ? `
              <span class="badge badge-danger"><span class="status-dot dot-red pulse"></span> تعلیق موقت سراسری</span>
            ` : `
              <span class="badge badge-success"><span class="badge-dot dot-green"></span> فعال در سراسر پلتفرم</span>
            `}
          </div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); line-height: 1.5; margin-bottom: 0.75rem;">
            ${feature.globallyDisabled ? `
              این ماژول در حال حاضر به صورت متمرکز برای تمامی مشترکین غیرفعال شده است تا عملیات نگهداری و به‌روزرسانی انجام گیرد.<br>
              <strong>علت تعلیق:</strong> ${feature.maintenanceReason || 'به‌روزرسانی پلتفرم'}<br>
              <strong>زمان تعلیق:</strong> ${feature.disabledAt ? new Date(feature.disabledAt).toLocaleString('fa-IR') : 'نامشخص'}
            ` : `
              این قابلیت به طور عادی در حال سرویس‌دهی به کلیه مشتریان دارای مجوز است. با کلید زیر می‌توانید آن را موقتاً از تمام برنامه خارج کنید.
            `}
          </div>
          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            ${feature.globallyDisabled ? `
              <button type="button" class="btn btn-success btn-sm" onclick="if (window.GMApp && window.GMApp.closeDrawer) window.GMApp.closeDrawer(); window.GMViews.GM08.restoreGlobalFeature('${feature.key}');">
                ✓ فعال‌سازی مجدد در سراسر پلتفرم
              </button>
            ` : `
              <button type="button" class="btn btn-outline-danger btn-sm" onclick="if (window.GMApp && window.GMApp.closeDrawer) window.GMApp.closeDrawer(); window.GMViews.GM08.openKillSwitchModal('${feature.key}');">
                ⚡ قطع و توقف موقت در سراسر پلتفرم (Kill-Switch)
              </button>
            `}
          </div>
        </div>
      </div>

      <!-- High-contrast Drawer CTA Toolbar -->
      <div class="drawer-cta-toolbar">
        <a href="#gm-15-simulator" class="btn btn-primary drawer-cta-btn" onclick="window.GMApp && window.GMApp.closeDrawer ? window.GMApp.closeDrawer() : null">
          <span>شبیه‌ساز فروش افزونه</span>
          <span>←</span>
        </a>
        <a href="#gm-03-tenants" class="btn btn-secondary drawer-cta-btn" onclick="window.GMApp && window.GMApp.closeDrawer ? window.GMApp.closeDrawer() : null">
          <span>انتخاب مشتری برای تخصیص</span>
          <span>←</span>
        </a>
        <button type="button" class="btn btn-secondary drawer-cta-btn" onclick="window.GMViews.GM08.verifyFeatureChain('${feature.key}')">
          <span>صحت‌سنجی زنجیره وابستگی</span>
          <span>✓</span>
        </button>
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openDrawer) {
    window.GMApp.openDrawer(`شناسنامه قابلیت: ${feature.nameFa}`, content, { subtitle: `شناسه فنی: ${feature.key}` });
  } else if (typeof openDrawer === 'function') {
    openDrawer(`شناسنامه قابلیت: ${feature.nameFa}`, content);
  }
};
