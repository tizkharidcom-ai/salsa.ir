/**
 * prototype/js/views/gm17-customers.js
 * 
 * GM-17: داده و دفترچه مشتریان رستوران‌ها (/data/customers)
 * حفاظت از PII، ماسک‌سازی شماره تلفن، رمزنگاری AES-256 و حالت نمایش موقت شماره با لاگ حسابرسی
 */

window.renderGM17 = function(params) {
  const store = window.prototypeStore || window.GMStore;
  const tenants = store && store.getTenants ? store.getTenants() : [];
  const selectedTenantId = params?.id || (store ? store.getActiveTenantId() : 'tnt_westo_demo');
  const tenant = (store && store.getTenant ? store.getTenant(selectedTenantId) : null) || tenants[0] || { id: 'tnt_westo_demo', name: 'کافه وستو', cellId: 'cell-teh-01' };
  const cellLabel = { 'cell-teh-01': 'تهران', 'cell-msh-01': 'مشهد', 'cell-mashhad-01': 'مشهد' }[tenant.cellId] || 'مرکز عملیاتی';
  const storeCustomers = store && store.getCustomerDirectory ? store.getCustomerDirectory(tenant.id) : null;
  const customerSource = (storeCustomers && storeCustomers.length > 0) ? 'مخزن مشتریان Store' : 'داده نمونه پروتوتایپ';
  const customers = (storeCustomers && storeCustomers.length > 0) ? storeCustomers : [
    { id: 'cst_9011', name: 'مشتری نمونه ۱', phoneMasked: '۰۹۱۲***۰۰۰۱', phoneFull: '۰۹۱۲۰۰۰۰۰۰۱', loyaltyTier: 'طلایی (VIP)', ordersCount: 42, totalSpend: '۲۸,۴۵۰,۰۰۰ تومان', lastOrder: 'دیروز ۱۸:۳۰ (سالن نمونه)' },
    { id: 'cst_9012', name: 'مشتری نمونه ۲', phoneMasked: '۰۹۱۲***۰۰۰۲', phoneFull: '۰۹۱۲۰۰۰۰۰۰۲', loyaltyTier: 'نقره‌ای', ordersCount: 18, totalSpend: '۹,۷۰۰,۰۰۰ تومان', lastOrder: '۳ روز قبل (کافه نمونه)' },
    { id: 'cst_9013', name: 'مشتری نمونه ۳', phoneMasked: '۰۹۱۲***۰۰۰۳', phoneFull: '۰۹۱۲۰۰۰۰۰۰۳', loyaltyTier: 'برنزی', ordersCount: 6, totalSpend: '۳,۲۰۰,۰۰۰ تومان', lastOrder: 'هفته گذشته (سفارش نمونه)' }
  ];

  return `
    <div class="page-header gm17-page">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
          <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
          <span class="breadcrumb-separator">/</span>
          <a href="#gm-04-tenant-detail?id=${tenant.id}" class="breadcrumb-link">پرونده مشتری</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current" aria-current="page">داده و مشتریان</span>
        </nav>
        <h1>
          مشتریان نهایی رستوران: ${tenant.name}
          <span class="badge scope-cell-badge">${cellLabel}</span>
          <span class="badge badge-scope-tenant"><span class="status-dot dot-active"></span> دامنه مشتری</span>
          <span class="page-code-badge">GM-17</span>
        </h1>
        <p>نمایش امن اطلاعات مشتریان رستوران با حفاظت رمزنگاری، ماسک خودکار شماره موبایل و تفکیک ایزوله</p>
      </div>
      <div class="header-actions">
        <button class="btn btn-primary" onclick="window.openGM17ExportModal('${tenant.id}')">
          پیش‌نمایش خروجی ایمن
        </button>
        <a href="#gm-04-tenant-detail?id=${tenant.id}" class="btn btn-secondary">
          پرونده ۳۶۰ مشتری
        </a>
      </div>
    </div>

    <!-- Security Scope Banner -->
    <div style="background: var(--state-warning-subtle); border: 1px solid var(--border-warning); border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 1.25rem;">
      <div style="font-weight: 600; color: var(--state-warning); font-size: 0.813rem; margin-bottom: 0.2rem;">حریم خصوصی و اصل حداقل افشا:</div>
      <div style="font-size: 0.75rem; color: var(--text-secondary); line-height: 1.5;">
        اپراتورهای پلتفرم تنها در صورت داشتن مجوز صریح و ثبت دلیل در لاگ ممیزی، می‌توانند ارقام میانی شماره تماس مهمانان را به صورت موقت مشاهده کنند.
      </div>
    </div>

    <div class="data-quality-strip" role="status" aria-label="وضعیت داده‌های دفترچه مشتریان">
      <div class="data-quality-label"><span class="dq-badge-dot dot-cyan"></span><span>وضعیت دادهٔ حساس</span></div>
      <div class="data-quality-grid">
        <span class="dq-badge"><span class="dq-badge-dot ${customerSource === 'مخزن مشتریان Store' ? 'dot-blue' : 'dot-purple'}"></span><span class="dq-dim-name">منبع</span><span class="dq-dim-val">${customerSource}</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">رکورد قابل مشاهده</span><span class="dq-dim-val">${customers.length.toLocaleString('fa-IR')} مشتری</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">پیش‌فرض نمایش</span><span class="dq-dim-val">شماره ماسک‌شده</span></span>
      </div>
      <span class="dq-action-hint"><span>نمایش کامل فقط با دلیل، ثبت ممیزی و بازگشت خودکار به ماسک پس از ۶۰ ثانیه انجام می‌شود</span></span>
    </div>

    ${window.GMDataState ? window.GMDataState.renderFreshnessBar({
      viewId: 'GM17',
      sourceLabel: `دفترچه امن مشتریان ${tenant.name}`,
      sourceMode: 'local',
      totalCount: customers.length,
      countLabel: 'مشتری'
    }) : ''}

    ${(() => {
      const dataState = window.GMDataState ? window.GMDataState.getViewState('GM17') : { state: 'live' };
      if (dataState.state === 'failed' || dataState.state === 'error') {
        return window.GMDataState.renderFailedState({
          viewId: 'GM17',
          title: 'خطا در برقراری ارتباط با مخزن امن مشتریان',
          reason: 'پاسخی از پایگاه داده ایزوله مشتریان در مهلت مقرر دریافت نشد.',
          errorCode: 'ERR_CUSTOMER_PII_TIMEOUT'
        });
      }
      if (dataState.state === 'empty') {
        return window.GMDataState.renderEmptyState({
          title: 'دفترچه مشتریان خالی است',
          summary: 'عدم ثبت پروفایل مشتری یا مهمان در پایگاه داده محلی',
          description: 'هنوز هیچ مشتری در باشگاه مشتریان و تاریخچه سفارش‌های این مجموعه ثبت نشده است.',
          auditScope: 'پایگاه داده ایزوله اعضای وفاداری، اطلاعات تماس و لاگ ثبت‌نام مهمانان وستو',
          actionLabel: 'به‌روزرسانی فهرست',
          onAction: "window.GMDataState.refreshView('GM17')"
        });
      }
      if (dataState.state === 'loading') {
        return window.GMDataState.renderSkeleton('table', 4);
      }
      if (dataState.state === 'refreshing') {
        return window.GMDataState.renderRefreshingBanner('GM17');
      }
      if (dataState.state === 'stale') {
        return window.GMDataState.renderStaleBanner('GM17');
      }
      return '';
    })()}

    ${(window.GMDataState && ['failed', 'empty', 'error', 'loading'].includes(window.GMDataState.getViewState('GM17').state)) ? '' : `
    <!-- Tenant & Filter Toolbar -->
    <div class="card" style="margin-bottom: 1.25rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.85rem;">
        <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
          <label class="form-label" for="customerTenantSelect" style="margin: 0; font-size: 0.813rem; font-weight: 600; color: var(--text-primary);">مجموعه هدف:</label>
          <select id="customerTenantSelect" class="form-control" style="width: 240px;" onchange="window.location.hash = '#gm-17-customers?id=' + this.value" aria-label="انتخاب مستأجر">
            ${tenants.map(t => `
              <option value="${t.id}" ${t.id === tenant.id ? 'selected' : ''}>${t.name}</option>
            `).join('')}
          </select>
        </div>

        <div class="table-filters" id="customersTierChips" role="group" aria-label="فیلتر سطح وفاداری مشتریان">
          <button class="filter-chip active" data-tier="all" aria-pressed="true" onclick="window.GMViews.GM17.setTierFilter('all')">
            همه مشتریان (${customers.length})
          </button>
          <button class="filter-chip" data-tier="طلایی" aria-pressed="false" onclick="window.GMViews.GM17.setTierFilter('طلایی')">
            طلایی VIP (${customers.filter(c => c.loyaltyTier.includes('طلایی')).length})
          </button>
          <button class="filter-chip" data-tier="نقره‌ای" aria-pressed="false" onclick="window.GMViews.GM17.setTierFilter('نقره‌ای')">
            نقره‌ای (${customers.filter(c => c.loyaltyTier.includes('نقره‌ای')).length})
          </button>
          <button class="filter-chip" data-tier="برنزی" aria-pressed="false" onclick="window.GMViews.GM17.setTierFilter('برنزی')">
            برنزی (${customers.filter(c => c.loyaltyTier.includes('برنزی')).length})
          </button>
        </div>

        <div class="table-search-group">
          <span id="customersFilterCount" class="filter-count-badge">نمایش ${customers.length.toLocaleString('fa-IR')} از ${customers.length.toLocaleString('fa-IR')} مشتری</span>
          <div class="search-input-wrapper" id="customerSearchWrapper">
            <input type="text" id="customerSearchInput" class="form-control" placeholder="جست‌وجو بر اساس نام یا کد..." style="width: 220px; padding: 0.35rem 0.75rem;" aria-label="جست‌وجو در دفترچه مشتریان" oninput="window.GMViews.GM17.search(this.value)" />
            <button class="search-clear-btn" onclick="window.GMViews.GM17.clearSearch()" aria-label="پاکسازی جستجو">✕</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Customers Directory Table -->
    <div class="table-wrapper">
      <div class="table-toolbar">
        <div>
          <div style="font-weight: 600; font-size: 0.875rem; color: var(--text-primary);">مشتریان باشگاه و سوابق سفارشات</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.15rem;">داده‌های ایزوله دیتابیس اختصاصی ${tenant.name}</div>
        </div>
      </div>
      <div class="table-responsive">
        <table class="data-table" id="customersTable" aria-label="جدول اطلاعات مشتریان و سوابق سفارشات">
          <thead>
            <tr>
              <th class="col-checkbox"><input type="checkbox" id="customers-select-all" aria-label="انتخاب همه مشتریان جدول" /></th>
              <th>نام و نام خانوادگی</th>
              <th>شماره موبایل (محافظت‌شده)</th>
              <th>سطح وفاداری</th>
              <th>تعداد سفارشات</th>
              <th>مجموع خرید</th>
              <th>آخرین سفارش</th>
              <th class="cell-actions">عملیات امنیتی</th>
            </tr>
          </thead>
          <tbody>
            ${customers.map(c => `
              <tr id="row-cst-${c.id}" data-id="${c.id}" data-search="${c.name} ${c.id} ${c.phoneMasked} ${c.loyaltyTier}">
                <td class="col-checkbox">
                  <input type="checkbox" class="customer-row-select" data-id="${c.id}" data-name="${c.name}" aria-label="انتخاب مشتری ${c.name}" />
                </td>
                <td>
                  <strong style="color: var(--text-primary);">${c.name}</strong>
                  <details class="row-disclosure customer-technical-details">
                    <summary>شناسه مشتری</summary>
                    <code class="cell-mono">${c.id}</code>
                  </details>
                </td>
                <td>
                  <span class="cell-mono phone-val" data-masked-phone="${c.phoneMasked}" data-revealed="false" aria-label="شماره ماسک‌شده ${c.name}" style="font-weight: 600; color: var(--accent-cyan); font-size: 0.813rem;">${c.phoneMasked}</span>
                  <details class="row-disclosure customer-technical-details">
                    <summary>حفاظت داده</summary>
                    <span>رمزگذاری محلی</span>
                  </details>
                </td>
                <td><span class="badge badge-neutral">${c.loyaltyTier}</span></td>
                <td class="cell-mono" style="font-size: 0.75rem;">${c.ordersCount} سفارش</td>
                <td class="cell-mono" style="font-weight: 600; font-size: 0.813rem;">${c.totalSpend}</td>
                <td style="font-size: 0.75rem; color: var(--text-secondary);">${c.lastOrder}</td>
                <td class="cell-actions" style="text-align: left;">
                  <div style="display: inline-flex; gap: 0.35rem; justify-content: flex-end;">
                    <button class="btn btn-secondary btn-sm" onclick="window.revealGM17Phone('${c.id}', '${c.name}')" aria-label="نمایش موقت شماره موبایل ${c.name}">
                      نمایش کامل
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="window.GMViews.GM17.viewCustomerProfile('${c.id}', '${c.name}')" aria-label="مشاهده پرونده وفاداری ${c.name}">
                      پرونده وفاداری
                    </button>
                  </div>
                </td>
              </tr>
            `).join('')}
            <tr id="customers-empty-row" style="display: none;">
              <td colspan="8" class="table-empty-cell" style="text-align: center; padding: 2.5rem 1rem; color: var(--text-secondary);">
                <div style="font-size: 0.875rem; font-weight: 600; color: var(--text-primary); margin-bottom: 0.35rem;">هیچ مشتری با مشخصات جستجویافته پیدا نشد</div>
                <div style="font-size: 0.75rem; color: var(--text-tertiary, #64748b); margin-bottom: 0.85rem;">می‌توانید عبارت جستجو را ویرایش نموده یا پاک کنید.</div>
                <button class="btn btn-secondary btn-sm" onclick="window.GMViews.GM17.resetAll()">پاکسازی فیلتر و جست‌وجو</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Bulk Actions Docked Bar -->
    <div id="gm17-bulk-actions" class="table-bulk-actions-bar" role="toolbar" aria-label="عملیات گروهی روی مشتریان انتخاب‌شده">
      <div class="bulk-actions-info">
        <span class="bulk-counter-badge" id="gm17-bulk-count">۰ مورد انتخاب‌شده</span>
        <span class="bulk-actions-label">اقدامات دسته‌جمعی:</span>
      </div>
      <div class="bulk-actions-btns">
        <button type="button" class="btn btn-primary btn-sm" id="gm17-bulk-export-btn" onclick="window.GMViews.GM17.exportSelected()" disabled>
          خروجی اکسل امن و پوشیده‌سازی‌شده
        </button>
        <button type="button" class="btn btn-secondary btn-sm" id="gm17-bulk-tier-btn" onclick="window.GMViews.GM17.bulkPromoteTier()" disabled>
          ارتقای سطح وفاداری
        </button>
        <button type="button" class="bulk-clear-btn" onclick="window.GMViews.GM17.clearSelection()">
          لغو انتخاب
        </button>
      </div>
    </div>
    `}
  `;
  setTimeout(() => {
    if (window.GMViews && window.GMViews.GM17 && typeof window.GMViews.GM17.initSelection === 'function') {
      window.GMViews.GM17.initSelection();
    }
  }, 0);
};

window.revealGM17Phone = function(customerId, customerName) {
  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <p style="font-size: 0.813rem; color: var(--text-primary); line-height: 1.5;">
        طبق سیاست‌های امنیتی و حفاظت از حریم خصوصی مشتریان، برای مشاهده شماره کامل باید دلیل دسترسی را جهت ثبت در لاگ حسابرسی ثبت نمایید.
      </p>
      <div>
        <label class="form-label" for="reveal-reason-input">علت مشاهده (الزامی):</label>
        <textarea id="reveal-reason-input" class="form-control" rows="2" placeholder="مثال: پیگیری سفارش مفقودی یا تماس ضروری به درخواست مالک" aria-label="علت ممیزی برای مشاهده شماره تلفن مشتری"></textarea>
      </div>
      <div style="background: var(--state-warning-subtle); border: 1px solid var(--border-warning); border-radius: 6px; padding: 0.6rem 0.75rem; font-size: 0.75rem; color: var(--state-warning);">
        این اقدام به همراه شناسه SuperAdmin و زمان دقیق در لاگ ممیزی ثبت خواهد شد.
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal(`درخواست نمایش شماره تماس: ${customerName}`, content, () => {
      const reasonEl = document.getElementById('reveal-reason-input');
      const reason = reasonEl ? reasonEl.value.trim() : '';
      if (!reason) {
        window.GMApp.showToast('ثبت دلیل برای نمایش شماره الزامی است.', 'error');
        return false;
      }

      const store = window.prototypeStore || window.GMStore;
      const customersList = store && store.getCustomerDirectory ? store.getCustomerDirectory() : [];
      const cst = customersList.find(c => c.id === customerId);
      const fullPhone = (cst && cst.phoneFull) ? cst.phoneFull : '۰۹۱۲۰۰۰۰۰۰۰';

      const row = document.getElementById(`row-cst-${customerId}`);
      if (row) {
        const phoneEl = row.querySelector('.phone-val');
        if (phoneEl) {
          phoneEl.innerText = fullPhone;
          phoneEl.dataset.revealed = 'true';
          phoneEl.classList.add('phone-revealed');
          phoneEl.setAttribute('aria-label', `شماره کامل و موقت ${customerName}`);
          window.setTimeout(() => {
            if (!phoneEl.isConnected || phoneEl.dataset.revealed !== 'true') return;
            phoneEl.innerText = phoneEl.dataset.maskedPhone || '***';
            phoneEl.dataset.revealed = 'false';
            phoneEl.classList.remove('phone-revealed');
            phoneEl.setAttribute('aria-label', `شماره ماسک‌شده ${customerName}`);
          }, 60000);
        }
      }

      if (store && store.addAuditLog) {
        store.addAuditLog({
          action: 'pii.reveal_phone',
          description: `افشای موقت شماره تلفن مشتری ${customerName} (${customerId}) با دلیل: "${reason}"`,
          scope: customerId
        });
      }

      window.GMApp.showToast('شماره کامل مشتری به مدت ۶۰ ثانیه آشکار شد و لاگ گردید.', 'success');
      return true;
    });
  }
};

window.openGM17ExportModal = function(tenantId) {
  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <p style="font-size: 0.813rem; color: var(--text-primary); line-height: 1.5;">
        فایل اکسل خروجی با رعایت پروتکل امنیتی بدون ارقام میانی شماره تماس تولید می‌شود:
      </p>
      <div class="surface-subtle cell-mono text-xs text-secondary">
        <div>ستون ۱: شناسه یکتای مشتری</div>
        <div>ستون ۲: نام و نام خانوادگی</div>
        <div>ستون ۳: شماره تماس پوشیده‌سازی‌شده (۰۹۱۲***۸۸۲۱)</div>
        <div>ستون ۴: سابقه سفارشات و مانده کیف پول</div>
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal('پیش‌نمایش خروجی ایمن اطلاعات مشتریان', content, () => {
      window.GMApp.showToast('خروجی ماسک‌شده فقط برای Fixture محلی آماده شد؛ منبع مشتری عملیاتی نیست.', 'info');
      return true;
    });
  }
};

window.GMViews = window.GMViews || {};
window.GMViews.GM17 = {
  tierFilter: 'all',
  searchQuery: '',
  tableSelect: null,

  afterRender() {
    this.initSelection();
  },

  initSelection() {
    if (window.GMTableSelect) {
      this.tableSelect = window.GMTableSelect.initTable('#customersTable', {
        selectAllSelector: '#customers-select-all',
        rowCheckboxSelector: '.customer-row-select',
        bulkBarId: 'gm17-bulk-actions',
        countBadgeId: 'gm17-bulk-count'
      });
    }
  },

  clearSelection() {
    if (this.tableSelect) {
      this.tableSelect.clear();
    }
  },

  setTierFilter(tier) {
    this.tierFilter = tier;
    const chips = document.querySelectorAll('#customersTierChips .filter-chip');
    chips.forEach(c => {
      const match = c.getAttribute('data-tier') === tier;
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
    const input = document.getElementById('customerSearchInput');
    if (input) {
      input.value = '';
      input.focus();
    }
    this.applyFilters();
  },

  resetAll() {
    this.searchQuery = '';
    const input = document.getElementById('customerSearchInput');
    if (input) input.value = '';
    this.setTierFilter('all');
    if (this.tableSelect) {
      this.tableSelect.clear();
    }
  },

  applyFilters() {
    const q = (this.searchQuery || '').trim().toLowerCase();
    const tier = this.tierFilter;
    const rows = document.querySelectorAll('table.data-table tbody tr[id^="row-cst-"]');
    const emptyRow = document.getElementById('customers-empty-row');
    const countBadge = document.getElementById('customersFilterCount');
    const searchWrapper = document.getElementById('customerSearchWrapper');

    if (searchWrapper) {
      if (q) searchWrapper.classList.add('has-value');
      else searchWrapper.classList.remove('has-value');
    }

    let visibleCount = 0;
    const totalCount = rows.length;

    rows.forEach(r => {
      const rowText = (r.getAttribute('data-search') || r.innerText).toLowerCase();
      const tierMatch = tier === 'all' || rowText.includes(tier);
      const searchMatch = !q || rowText.includes(q);
      const isVisible = tierMatch && searchMatch;

      r.style.display = isVisible ? '' : 'none';
      if (isVisible) visibleCount++;
    });

    if (emptyRow) {
      emptyRow.style.display = (visibleCount === 0 && totalCount > 0) ? '' : 'none';
    }

    if (countBadge) {
      countBadge.innerText = `نمایش ${visibleCount.toLocaleString('fa-IR')} از ${totalCount.toLocaleString('fa-IR')} مشتری`;
    }

    if (this.tableSelect) {
      this.tableSelect.sync();
    }
  },

  exportSelected() {
    if (!this.tableSelect) return;
    const ids = this.tableSelect.getSelectedIds();
    if (ids.length === 0) {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast('لطفاً حداقل یک مشتری را برای خروجی انتخاب فرمایید.', 'warning');
      }
      return;
    }
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast(`خروجی ماسک‌شده برای ${ids.length.toLocaleString('fa-IR')} مشتری فقط در Mock آماده شد؛ منبع عملیاتی نیست.`, 'info');
    }
  },

  bulkPromoteTier() {
    if (!this.tableSelect) return;
    const ids = this.tableSelect.getSelectedIds();
    if (ids.length === 0) {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast('لطفاً حداقل یک مشتری را برای ارتقا انتخاب فرمایید.', 'warning');
      }
      return;
    }
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast(`سطح وفاداری ${ids.length.toLocaleString('fa-IR')} مشتری به طلایی VIP ارتقا یافت.`, 'success');
    }
  },

  viewCustomerProfile(customerId, customerName) {
    const store = window.prototypeStore || window.GMStore;
    const customersList = store && store.getCustomerDirectory ? store.getCustomerDirectory() : [];
    const cst = customersList.find(c => c.id === customerId) || {
      id: customerId,
      name: customerName,
      loyaltyTier: 'طلایی (VIP)',
      ordersCount: 42,
      totalSpend: '۲۸,۴۵۰,۰۰۰ تومان',
      lastOrder: 'دیروز ۱۸:۳۰'
    };

    const content = `
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <div class="surface-subtle" style="padding: 1rem; border-radius: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong style="color: var(--text-primary); font-size: 1.05rem;">${cst.name}</strong>
            <span class="badge badge-success">${cst.loyaltyTier}</span>
          </div>
          <div class="cell-mono" style="font-size: 0.78rem; color: #38bdf8; margin-top: 0.25rem;">شناسه: ${cst.id}</div>
        </div>

        <div class="kv-list" style="font-size: 0.813rem;">
          <div class="kv-item"><span class="kv-label">مجموع خرید:</span><span class="cell-mono text-strong text-success">${cst.totalSpend}</span></div>
          <div class="kv-item"><span class="kv-label">تعداد سفارشات ثبت‌شده:</span><span class="cell-mono text-primary">${cst.ordersCount} فاکتور</span></div>
          <div class="kv-item"><span class="kv-label">آخرین حضور در کافه:</span><span class="text-secondary">${cst.lastOrder}</span></div>
          <div class="kv-item"><span class="kv-label">وضعیت حساب:</span><span class="badge badge-warning">Fixture؛ تأیید تولیدی نامشخص</span></div>
        </div>

        <div style="border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 0.75rem;">
          <button class="btn btn-secondary btn-block" onclick="window.revealGM17Phone('${cst.id}', '${cst.name}'); if (window.GMApp && window.GMApp.closeDrawer) window.GMApp.closeDrawer();">
            درخواست مشاهده شماره کامل
          </button>
        </div>
      </div>
    `;

    if (window.GMApp && window.GMApp.openDrawer) {
      window.GMApp.openDrawer(`پروفایل و باشگاه وفاداری: ${customerName}`, content);
    }
  }
};

window.searchGM17Customers = function(query) {
  window.GMViews.GM17.search(query);
};

window.clearGM17Search = function() {
  window.GMViews.GM17.clearSearch();
};
