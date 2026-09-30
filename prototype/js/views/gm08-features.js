/**
 * prototype/js/views/gm08-features.js
 * 
 * GM-08: کاتالوگ قابلیت‌ها (/features)
 * فهرست ۴۸ قابلیت قابل فروش طبق بخش ۷.۲ سند GODMODE.MD با دراور مشخصات فنی
 */

window.renderGM08 = function() {
  const view = window.GMViews?.GM08;
  if (!view?.catalogSnapshot) {
    if (view && !view.loading && !view.loadError) view.loadServerSnapshot();
    if (view?.loadError) return `
      <div class="empty-state" role="alert">
        <h2>وضعیت سرور بارگذاری نشد</h2>
        <p>${view.escapeHtml(view.loadError)}</p>
        <button type="button" class="btn btn-secondary" onclick="window.GMViews.GM08.loadServerSnapshot({ force: true })">تلاش دوباره</button>
      </div>`;
    return '<div class="empty-state" role="status"><h2>در حال دریافت کاتالوگ و وضعیت از کنترل‌پلن…</h2></div>';
  }
  const { features, killSwitches } = view.catalogSnapshot;
  const globalMutationsAvailable = view.catalogSnapshot.globalMutationsAvailable === true;
  const activeSwitchFor = key => killSwitches.find(record => record.status === 'active' &&
    (record.featureKey === key || record.featureKeys?.includes(key)));
  const decoratedFeatures = features.map(feature => {
    const killSwitch = activeSwitchFor(feature.key);
    return {
      ...feature,
      globallyDisabled: Boolean(killSwitch),
      maintenanceReason: killSwitch?.reason || '',
      distributionStatus: killSwitch?.distributionStatus || null,
      distributionStatusLabel: !killSwitch ? '' : killSwitch.distributionStatus === 'failed'
        ? 'آخرین تلاش ناموفق'
        : killSwitch.distributionStatus === 'pending'
          ? 'در انتظار ارسال'
          : 'ACK سراسری همهٔ cellها موجود نیست'
    };
  });
  const suspendedFeatures = decoratedFeatures.filter(f => f.globallyDisabled);

  // Category counts
  const categoryCounts = {};
  decoratedFeatures.forEach(f => {
    categoryCounts[f.category] = (categoryCounts[f.category] || 0) + 1;
  });
  const categoryNames = {
    core: 'هسته', catalog: 'کاتالوگ', orders: 'سفارش‌ها', floor: 'سالن', kitchen: 'آشپزخانه',
    booking: 'رزرو', delivery: 'تحویل', payments: 'پرداخت', finance: 'مالی', stock: 'انبار',
    crm: 'CRM', marketing: 'بازاریابی', content: 'محتوا', brand: 'برند', insights: 'گزارش‌ها',
    staff: 'پرسنل', platform: 'پلتفرم'
  };

  if (features.length === 0) return `
    <div class="empty-state" role="status">
      <h2>کاتالوگ سرور خالی است</h2>
      <p>هیچ قابلیتی از کاتالوگ کنترل‌پلن دریافت نشد؛ دادهٔ محلی یا نمونه جایگزین نمایش داده نمی‌شود.</p>
    </div>`;

  return `
    ${!globalMutationsAvailable ? `
      <div class="card" role="status" style="margin-bottom:1rem; border-color:var(--state-warning, #b54708);">
        <strong>توقف سراسری در دسترس نیست</strong>
        <div style="margin-top:.35rem; color:var(--text-secondary); line-height:1.6;">
          کنترل‌پلن هنوز fan-out پایدار به همهٔ cellها و تأیید دریافت آن‌ها را ندارد؛ دکمه‌های توقف و بازگردانی غیرفعال‌اند و هیچ تغییر نیمه‌سراسری ثبت نمی‌شود.
        </div>
      </div>
    ` : ''}
    ${window.GMViews?.GM08?.mutationError ? `
      <div class="card" role="alert" aria-live="assertive" style="margin-bottom: 1rem; border-color: var(--state-danger, #b42318);">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:.75rem; flex-wrap:wrap;">
          <span>${window.GMViews.GM08.escapeHtml(window.GMViews.GM08.mutationError)}</span>
          <button type="button" class="btn btn-danger btn-sm" onclick="window.GMViews.GM08.retryLastMutation()">تلاش دوباره</button>
        </div>
      </div>
    ` : ''}
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
              <span class="status-dot dot-red pulse"></span> ${suspendedFeatures.length.toLocaleString('fa-IR')} توقف ثبت‌شده در کنترل‌پلن
            </span>
          ` : `
            <span class="badge badge-success" style="font-weight: 600;">
              <span class="status-dot dot-green"></span> هیچ توقف اضطراری در سرور ثبت نشده
            </span>
          `}
        </div>
        <p>${features.length.toLocaleString('fa-IR')} قابلیت در کاتالوگ سرور؛ وضعیت عملیاتی هر سرویس جداگانه سنجیده می‌شود.</p>
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
              هشدار پلتفرم: ${suspendedFeatures.length.toLocaleString('fa-IR')} توقف در کنترل‌پلن ثبت شده است؛ اثر سراسری تأیید نشده است.
            </div>
            <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 0.25rem; line-height: 1.5;">
              سیاست توقف برای این قابلیت‌ها در کنترل‌پلن ثبت شده است. وضعیت انتشار به سرویس مشتری در هر ردیف جداگانه نمایش داده می‌شود.
            </div>
          </div>
        </div>
        <button type="button" class="btn btn-outline-danger btn-sm" onclick="window.GMViews.GM08.setCategory('suspended', null)" style="font-weight: 600;">
          مشاهده ماژول‌های در حال تعمیر (${suspendedFeatures.length.toLocaleString('fa-IR')})
        </button>
      </div>
    </div>
    ` : ''}

    <!-- Server-backed platform catalog summary -->
    <div class="card" style="margin-bottom: 1.25rem; border-color: rgba(2, 132, 199, 0.22); background: linear-gradient(135deg, rgba(2, 132, 199, 0.05) 0%, rgba(99, 102, 241, 0.04) 100%); border-radius: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.85rem;">
        <div style="display: flex; align-items: center; gap: 0.85rem;">
          <div style="width: 44px; height: 44px; border-radius: 10px; background: rgba(2, 132, 199, 0.12); display: flex; align-items: center; justify-content: center; font-size: 1.35rem; flex-shrink: 0;">
            🧩
          </div>
          <div>
            <div style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary);">مدیریت جامع ${features.length.toLocaleString('fa-IR')} قابلیت و ماژول پلتفرم SALSA</div>
            <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 0.25rem; line-height: 1.45;">
              وضعیت‌های زیر از کاتالوگ و کلیدهای توقف ذخیره‌شده در کنترل‌پلن خوانده شده‌اند؛ این صفحه سلامت اجرای ماژول‌ها را ادعا نمی‌کند.
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
        <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">منبع</span><span class="dq-dim-val">کنترل‌پلن</span></span>
        <span class="dq-badge"><span class="dq-badge-dot ${suspendedFeatures.length > 0 ? 'dot-red' : 'dot-blue'}"></span><span class="dq-dim-name">توقف ثبت‌شده</span><span class="dq-dim-val">${suspendedFeatures.length.toLocaleString('fa-IR')} قابلیت</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">تعرفه</span><span class="dq-dim-val">از منبع تأییدشده دریافت نشده</span></span>
      </div>
      <span class="dq-action-hint"><span>قیمت و سلامت اجرایی از این کاتالوگ استنتاج نمی‌شود.</span></span>
    </div>

    <div class="table-wrapper">
      <div class="table-toolbar">
        <div class="table-filters" id="featureCategoryFilters" role="group" aria-label="دسته‌بندی قابلیت‌های تجاری">
          <button class="filter-chip active" aria-pressed="true" onclick="filterFeatures('all', this)">همه (${features.length})</button>
          ${Object.entries(categoryCounts).map(([category, count]) => `<button class="filter-chip" aria-pressed="false" onclick="filterFeatures('${category}', this)">${categoryNames[category] || category} (${count})</button>`).join('')}
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
              <th>قیمت‌گذاری</th>
              <th>وضعیت سراسری پلتفرم</th>
              <th class="cell-actions">اقدامات</th>
            </tr>
          </thead>
          <tbody>
            ${decoratedFeatures.map(f => {
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
                <td class="cell-mono" style="font-size: 0.8rem;"><span class="text-secondary">تعرفه مصوب دریافت نشده</span></td>
                <td>
                  ${f.globallyDisabled ? `
                    <div style="display: inline-flex; flex-direction: column; gap: 0.25rem;">
                      <span class="badge badge-danger" style="display: inline-flex; align-items: center; gap: 0.35rem; width: fit-content; background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 0.75rem;">
                        <span class="status-dot dot-red pulse"></span> توقف در کنترل‌پلن ثبت شده
                      </span>
                      <span style="font-size: 0.7rem; color: var(--text-tertiary); max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${view.escapeHtml(f.maintenanceReason || 'ثبت نشده')}">
                        ارسال: ${f.distributionStatusLabel} · علت: ${view.escapeHtml(f.maintenanceReason || 'ثبت نشده')}
                      </span>
                    </div>
                  ` : `
                    <span class="badge badge-neutral" style="display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.75rem;">
                      <span class="badge-dot"></span> توقف اضطراری ثبت نشده
                    </span>
                  `}
                </td>
                <td class="cell-actions">
                  <div style="display: flex; gap: 0.35rem; justify-content: flex-end; align-items: center;">
                    <button class="btn btn-sm btn-secondary" aria-label="مشاهده جزئیات فنی قابلیت ${f.nameFa} (${f.key})" onclick="openFeatureDrawer('${f.key}')">
                      جزئیات فنی
                    </button>
                    ${f.globallyDisabled ? `
                      <button type="button" class="btn btn-sm btn-success" ${globalMutationsAvailable ? '' : 'disabled'} onclick="window.GMViews.GM08.restoreGlobalFeature('${f.key}')" title="${globalMutationsAvailable ? 'پایان به‌روزرسانی و فعال‌سازی سراسری' : 'لغو سراسری تا پشتیبانی fan-out و ACK همهٔ cellها غیرفعال است'}">
                        ✓ فعال‌سازی
                      </button>
                    ` : `
                      <button type="button" class="btn btn-sm btn-outline-danger" ${globalMutationsAvailable ? '' : 'disabled'} onclick="window.GMViews.GM08.openKillSwitchModal('${f.key}')" title="${globalMutationsAvailable ? 'قطع اضطراری و تعلیق موقت در سطح کل پلتفرم' : 'تا fan-out و ACK سراسری موجود نشود غیرفعال است'}">
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
        <button type="button" class="btn btn-outline-danger btn-sm" id="gm08-bulk-disable-btn" onclick="window.GMViews.GM08.bulkDisableSelected()" disabled title="${globalMutationsAvailable ? 'ابتدا قابلیت‌ها را انتخاب کنید' : 'توزیع سراسری هنوز در دسترس نیست'}">
          ⚡ تعلیق موقت گروهی
        </button>
        <button type="button" class="btn btn-success btn-sm" id="gm08-bulk-enable-btn" onclick="window.GMViews.GM08.bulkEnableSelected()" disabled title="${globalMutationsAvailable ? 'ابتدا قابلیت‌ها را انتخاب کنید' : 'توزیع سراسری هنوز در دسترس نیست'}">
          ✓ فعال‌سازی گروهی
        </button>
        <button type="button" class="bulk-clear-btn" onclick="window.GMViews.GM08.clearSelection()">
          لغو انتخاب
        </button>
      </div>
    </div>
  `;
};

window.GMViews = window.GMViews || {};
window.GMViews.GM08 = {
  render: window.renderGM08,
  category: 'all',
  query: '',
  mutationError: '',
  lastMutation: null,
  catalogSnapshot: null,
  loading: false,
  loadError: '',
  loadRequest: null,

  escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  },

  async loadServerSnapshot({ force = false } = {}) {
    if (this.loadRequest) return this.loadRequest;
    if (this.catalogSnapshot && !force) return this.catalogSnapshot;
    this.loading = true;
    this.loadError = '';
    this.catalogSnapshot = null;
    const request = (async () => {
      try {
        const client = this.getSameOriginControlPlaneClient();
        const [catalogResponse, switchesResponse] = await Promise.all([
          client.get('/api/control/policy/catalog'),
          client.get('/api/control/policy/killswitch')
        ]);
        if (catalogResponse?.ok !== true || !Array.isArray(catalogResponse.data?.features) ||
            switchesResponse?.ok !== true || !Array.isArray(switchesResponse.data)) {
          throw new Error('کاتالوگ یا وضعیت ذخیره‌شدهٔ توقف از کنترل‌پلن پاسخ معتبر ندارد.');
        }
        this.catalogSnapshot = {
          features: catalogResponse.data.features,
          killSwitches: switchesResponse.data,
          globalMutationsAvailable: switchesResponse.capabilities?.globalMutationsAvailable === true,
          observedAt: switchesResponse.meta?.observedAt || catalogResponse.meta?.observedAt || null
        };
        return this.catalogSnapshot;
      } catch (error) {
        this.loadError = error?.message || 'دریافت وضعیت از کنترل‌پلن ناموفق بود.';
        return null;
      } finally {
        this.loading = false;
        this.loadRequest = null;
        if (window.GMRouter?.refresh) window.GMRouter.refresh();
      }
    })();
    this.loadRequest = request;
    return request;
  },

  getSameOriginControlPlaneClient() {
    const client = window.ControlPlaneClient;
    if (!client || typeof client.get !== 'function' || typeof client.post !== 'function' || typeof client.delete !== 'function') {
      throw new Error('اتصال کنترل‌پلن برای خواندن یا ثبت وضعیت سراسری در دسترس نیست.');
    }
    if (!window.location || typeof client.getBaseUrl !== 'function' ||
        client.getBaseUrl().replace(/\/$/, '') !== window.location.origin) {
      throw new Error('نشانی کنترل‌پلن با مبدأ همین صفحه یکسان نیست؛ تغییری ثبت نشد.');
    }
    return client;
  },

  async requestAndVerifyGlobalState(featureKey, enabled, reason = '') {
    const client = this.getSameOriginControlPlaneClient();
    if (this.catalogSnapshot?.globalMutationsAvailable !== true) {
      throw new Error('GLOBAL_KILLSWITCH_FANOUT_NOT_IMPLEMENTED: ارسال پایدار به همهٔ cellها و تأیید ACK آن‌ها در دسترس نیست؛ هیچ تغییری ارسال نشد.');
    }
    const endpoint = '/api/control/policy/killswitch';
    let mutation;
    if (enabled) {
      mutation = await client.delete(`${endpoint}/${encodeURIComponent(featureKey)}`);
      if (!mutation || mutation.ok !== true || mutation.data?.revoked !== true) {
        throw new Error('سرور پاسخ معتبر برای رفع کلید قطع سراسری نداد.');
      }
    } else {
      mutation = await client.post(endpoint, { featureKey, reason: String(reason || '').trim() });
      const record = mutation?.data;
      if (!mutation || mutation.ok !== true || record?.status !== 'active' || record?.featureKey !== featureKey) {
        throw new Error('سرور فعال‌سازی کلید قطع را تأیید نکرد.');
      }
    }

    const readback = await client.get(endpoint);
    if (!readback || readback.ok !== true || !Array.isArray(readback.data)) {
      throw new Error('خواندن دوباره وضعیت برای تأیید تغییر از سرور موفق نشد.');
    }
    const found = readback.data.some(record => record?.status === 'active' &&
      (record.featureKey === featureKey || record.moduleKey === featureKey || record.featureKeys?.includes(featureKey)));
    if (found === enabled) {
      throw new Error('وضعیت بازخوانی‌شده از سرور با درخواست هم‌خوانی ندارد؛ تغییر تأیید نشد.');
    }

    const feature = this.catalogSnapshot?.features.find(item => item.key === featureKey);
    this.catalogSnapshot = { ...this.catalogSnapshot, killSwitches: readback.data };
    return { success: true, feature: feature || { key: featureKey, nameFa: featureKey }, serverConfirmed: true };
  },

  async runGlobalMutation(mutation, { refresh = true } = {}) {
    this.lastMutation = mutation;
    this.mutationError = '';
    try {
      const result = await this.requestAndVerifyGlobalState(mutation.featureKey, mutation.enabled, mutation.reason);
      this.lastMutation = null;
      if (refresh) {
        if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
          window.GMRouter.refresh();
        } else {
          window.location.hash = `#gm-08-features?t=${Date.now()}`;
        }
      }
      return result;
    } catch (error) {
      this.mutationError = error?.message || 'ثبت تغییر در کنترل‌پلن تأیید نشد.';
      if (error?.status === 502) {
        await this.loadServerSnapshot({ force: true });
        const committed = this.catalogSnapshot?.killSwitches.find(record => record.status === 'active' &&
          (record.featureKey === mutation.featureKey || record.featureKeys?.includes(mutation.featureKey)));
        if (committed && !mutation.enabled) {
          this.mutationError = `توقف در کنترل‌پلن ذخیره شد، اما انتشار به سرویس مشتری ناموفق است (${committed.distributionStatus || 'وضعیت نامشخص'}).`;
        }
      }
      if (window.GMApp?.showToast) window.GMApp.showToast(this.mutationError, 'danger');
      if (refresh) {
        if (window.GMRouter && typeof window.GMRouter.refresh === 'function') window.GMRouter.refresh();
        else window.location.hash = `#gm-08-features?error=${Date.now()}`;
      }
      return null;
    }
  },

  retryLastMutation() {
    if (!this.lastMutation) return Promise.resolve(null);
    return this.runGlobalMutation({ ...this.lastMutation });
  },

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
      window.GMApp.showToast(`وابستگی‌های ${ids.length} قابلیت در کاتالوگ سرور بررسی شد؛ تخصیص نهایی همچنان سمت سرور اعتبارسنجی می‌شود.`, 'info');
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
      window.GMApp.showToast(`${ids.length} شناسه انتخاب شد؛ فایل خروجی در این نسخه ساخته نمی‌شود.`, 'info');
    }
  },

  openKillSwitchModal(featureKey) {
    if (this.catalogSnapshot?.globalMutationsAvailable !== true) {
      this.mutationError = 'توقف سراسری تا زمان فراهم‌شدن fan-out پایدار و ACK همهٔ cellها غیرفعال است.';
      if (window.GMApp?.showToast) window.GMApp.showToast(this.mutationError, 'warning');
      return;
    }
    const features = this.catalogSnapshot?.features || [];
    const feature = features.find(f => f.key === featureKey);
    if (!feature) return;

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
          <div class="kv-item"><span class="kv-label">دامنه:</span><span>سراسری؛ تعداد مستأثرین در API ارائه نشده است</span></div>
        </div>

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

  async confirmGlobalKillSwitch(featureKey, reason) {
    if (String(reason || '').trim().length < 5) {
      this.lastMutation = null;
      this.mutationError = 'دلیل توقف سراسری باید دست‌کم ۵ نویسه داشته باشد.';
      if (window.GMApp?.showToast) window.GMApp.showToast(this.mutationError, 'danger');
      if (window.GMRouter?.refresh) window.GMRouter.refresh();
      else window.location.hash = `#gm-08-features?error=${Date.now()}`;
      return null;
    }
    const res = await this.runGlobalMutation({ featureKey, enabled: false, reason: String(reason).trim() });
    if (res?.success && window.GMApp?.showToast) {
      window.GMApp.showToast(`سرور وضعیت توقف سراسری «${res.feature.nameFa}» را تأیید کرد.`, 'warning');
    }
    return res;
  },

  async restoreGlobalFeature(featureKey) {
    const res = await this.runGlobalMutation({ featureKey, enabled: true, reason: '' });
    if (res?.success && window.GMApp?.showToast) {
      window.GMApp.showToast(`سرور وضعیت فعال‌سازی مجدد «${res.feature.nameFa}» را تأیید کرد.`, 'success');
    }
    return res;
  },

  bulkDisableSelected() {
    const ids = this.tableSelect ? this.tableSelect.getSelectedIds() : [];
    if (ids.length === 0) {
      if (window.GMApp && window.GMApp.showToast) window.GMApp.showToast('لطفاً حداقل یک قابلیت را انتخاب نمایید.', 'warning');
      return;
    }
    this.runBulkGlobalMutation(ids, false, 'تعلیق گروهی موقت توسط مدیر ارشد');
  },

  bulkEnableSelected() {
    const ids = this.tableSelect ? this.tableSelect.getSelectedIds() : [];
    if (ids.length === 0) {
      if (window.GMApp && window.GMApp.showToast) window.GMApp.showToast('لطفاً حداقل یک قابلیت را انتخاب نمایید.', 'warning');
      return;
    }
    this.runBulkGlobalMutation(ids, true, '');
  },

  async runBulkGlobalMutation(featureKeys, enabled, reason) {
    let confirmed = 0;
    for (const featureKey of featureKeys) {
      const result = await this.runGlobalMutation({ featureKey, enabled, reason }, { refresh: false });
      if (!result) {
        this.mutationError = `${confirmed} مورد از ${featureKeys.length} مورد در سرور تأیید شد. مورد ناموفق را با «تلاش دوباره» پیگیری کنید. ${this.mutationError}`;
        if (window.GMRouter?.refresh) window.GMRouter.refresh();
        return { confirmed, failedFeatureKey: featureKey };
      }
      confirmed++;
    }
    if (window.GMApp?.showToast) {
      window.GMApp.showToast(`وضعیت ${confirmed} قابلیت در سرور تأیید شد.`, enabled ? 'success' : 'warning');
    }
    return { confirmed };
  },

  verifyFeatureChain(key) {
    const features = this.catalogSnapshot?.features || [];
    const feature = features.find(f => f.key === key);
    if (!feature) return;
    const deps = feature.dependencies || [];
    if (deps.length === 0) {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast(`در کاتالوگ سرور برای «${feature.nameFa}» پیش‌نیازی ثبت نشده است؛ اجرای عملیاتی بررسی نشده.`, 'info');
      }
    } else {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast(`پیش‌نیازهای «${feature.nameFa}» از کاتالوگ سرور خوانده شد؛ اعتبارسنجی تخصیص هنگام ثبت سمت سرور انجام می‌شود.`, 'info');
      }
    }
  },

  openDependencyGraphDrawer() {
    const features = this.catalogSnapshot?.features || [];
    if (features.length === 0) return;

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
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">تعداد دریافتی از کنترل‌پلن</div>
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
            <div class="drawer-kpi-value" style="color: var(--text-secondary); font-size: 1.05rem;">بررسی‌نشده</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">اعتبار DAG از API دریافت نشده است</div>
          </div>
        </div>

        <!-- 4D Data Quality Audit Strip -->
        <div class="data-quality-strip" role="status" aria-label="وضعیت کیفیت داده‌های گراف">
          <div class="data-quality-label"><span class="dq-badge-dot dot-cyan"></span><span>ممیزی ساختار درختی</span></div>
          <div class="data-quality-grid">
            <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">منبع ساختار</span><span class="dq-dim-val">کاتالوگ سرور</span></span>
            <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">اعتبارسنجی DAG</span><span class="dq-dim-val">از API دریافت نشده</span></span>
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
      window.GMApp.openDrawer('وابستگی قابلیت‌ها', content, { subtitle: 'داده از کاتالوگ کنترل‌پلن؛ سلامت DAG جداگانه تأیید نشده است' });
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
  const view = window.GMViews?.GM08;
  const features = view?.catalogSnapshot?.features || [];
  const sourceFeature = features.find(f => f.key === featureKey);
  if (!sourceFeature) return;
  const switchRecord = view.catalogSnapshot.killSwitches.find(record => record.status === 'active' &&
    (record.featureKey === featureKey || record.featureKeys?.includes(featureKey)));
  const feature = {
    ...sourceFeature,
    dependencies: Array.isArray(sourceFeature.dependencies) ? sourceFeature.dependencies : [],
    globallyDisabled: Boolean(switchRecord),
    maintenanceReason: switchRecord?.reason || '',
    distributionStatus: switchRecord?.distributionStatus || null,
    distributionStatusLabel: !switchRecord ? '' : switchRecord.distributionStatus === 'failed'
      ? 'آخرین تلاش ناموفق'
      : switchRecord.distributionStatus === 'pending'
        ? 'در انتظار ارسال'
        : 'ACK سراسری همهٔ cellها موجود نیست'
  };

  // Features depending on this feature
  const dependents = features.filter(f => Array.isArray(f.dependencies) && f.dependencies.includes(feature.key));

  const content = `
    <div style="display: flex; flex-direction: column; gap: 1.25rem;">
      <!-- KPI Metric Cards -->
      <div class="drawer-kpi-grid">
        <div class="drawer-kpi-card">
          <div class="drawer-kpi-title">تعرفه مصوب</div>
          <div class="drawer-kpi-value" style="font-size: 1.05rem; color: var(--accent-cyan);">
            از منبع قیمت‌گذاری دریافت نشده
          </div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">
            این کاتالوگ، قیمت قابل فروش را تأیید نمی‌کند.
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
          <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">منبع</span><span class="dq-dim-val">کاتالوگ کنترل‌پلن</span></span>
          <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">قیمت مصوب</span><span class="dq-dim-val">دریافت نشده</span></span>
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
            <span class="badge badge-neutral">جزئیات تجاری معتبر دریافت نشده</span>
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
              <span class="badge badge-warning"><span class="status-dot dot-yellow"></span> توقف ثبت‌شده؛ توزیع سراسری تأیید نشده</span>
            ` : `
              <span class="badge badge-neutral"><span class="badge-dot"></span> توقف اضطراری ثبت نشده</span>
            `}
          </div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); line-height: 1.5; margin-bottom: 0.75rem;">
            ${feature.globallyDisabled ? `
              فقط ثبت سیاست در کنترل‌پلن تأیید شده است؛ اثر آن بر همهٔ مستأجران و cellها تأیید نشده.<br>
              <strong>علت ثبت:</strong> ${view.escapeHtml(feature.maintenanceReason || 'ثبت نشده')}<br>
              <strong>وضعیت توزیع:</strong> ${feature.distributionStatusLabel}<br>
              <strong>زمان تعلیق:</strong> ${feature.disabledAt ? new Date(feature.disabledAt).toLocaleString('fa-IR') : 'نامشخص'}
            ` : `
              در فهرست کلیدهای توقف کنترل‌پلن، توقف فعالی برای این قابلیت ثبت نشده است؛ سلامت اجرای سرویس‌ها از این صفحه قابل تأیید نیست.
            `}
          </div>
          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            ${feature.globallyDisabled ? `
              <button type="button" class="btn btn-success btn-sm" ${view.catalogSnapshot.globalMutationsAvailable === true ? '' : 'disabled'} onclick="if (window.GMApp && window.GMApp.closeDrawer) window.GMApp.closeDrawer(); window.GMViews.GM08.restoreGlobalFeature('${feature.key}');">
                ✓ فعال‌سازی مجدد در سراسر پلتفرم
              </button>
            ` : `
              <button type="button" class="btn btn-outline-danger btn-sm" ${view.catalogSnapshot.globalMutationsAvailable === true ? '' : 'disabled'} onclick="if (window.GMApp && window.GMApp.closeDrawer) window.GMApp.closeDrawer(); window.GMViews.GM08.openKillSwitchModal('${feature.key}');">
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
