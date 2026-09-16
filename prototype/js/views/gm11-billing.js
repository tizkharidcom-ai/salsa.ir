/**
 * prototype/js/views/gm11-billing.js
 * 
 * GM-11: اشتراک و امور مالی پلتفرم NEEM (/billing)
 * پایش فاکتورها، درآمدهای اشتراکی، افزونه‌های فروخته‌شده، وضعیت پرداخت‌ها و انطباق مالیاتی
 */

window.GMViews = window.GMViews || {};

window.switchGM11Tab = function(tabName) {
  const hash = window.location && window.location.hash ? window.location.hash : '#gm-11-billing';
  const [baseRoute, queryString] = hash.split('?');
  const params = new URLSearchParams(queryString || '');
  params.set('tab', tabName);
  const nextHash = `#${baseRoute.replace(/^#\/?/, '')}?${params.toString()}`;
  const compactHash = window.GMRouter && typeof window.GMRouter.compactHash === 'function'
    ? window.GMRouter.compactHash(nextHash)
    : nextHash;

  if (window.history && typeof window.history.replaceState === 'function') {
    window.history.replaceState(null, '', compactHash);
  }

  // Update tab links active state
  document.querySelectorAll('.gm11-tab-btn').forEach(btn => {
    const isTarget = btn.getAttribute('data-tab') === tabName;
    btn.classList.toggle('active', isTarget);
    if (isTarget) {
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.removeAttribute('aria-current');
    }
  });

  // Switch visible panel in-place
  document.querySelectorAll('.gm11-panel').forEach(panel => {
    const isTarget = panel.getAttribute('data-panel') === tabName;
    panel.style.display = isTarget ? 'block' : 'none';
  });

  if (tabName === 'invoices' && window.GMViews.GM11 && window.GMViews.GM11.initSelection) {
    window.GMViews.GM11.initSelection();
  }
};

window.copyToClipboard = function(text, label = 'مقدار') {
  if (!text) return;
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text).catch(() => {});
  }
  if (window.GMApp && typeof window.GMApp.showToast === 'function') {
    window.GMApp.showToast(`${label} با موفقیت در کلیپ‌بورد کپی شد: ${text}`, 'success');
  }
};

window.recheckReconciliation = function(invoiceId) {
  const store = window.prototypeStore || window.GMStore;
  const inv = store && store.getInvoice ? store.getInvoice(invoiceId) : null;
  if (!inv) return;

  if (store && typeof store.addActivity === 'function') {
    store.addActivity({
      type: 'reconciliation_audit',
      severity: 'info',
      title: `استعلام تطبیق و مغایرت‌گیری ${inv.id}`,
      description: `درخواست استعلام مجدد سند ${inv.id} فقط در Fixture ثبت شد؛ وب‌سرویس شاپرک و مغایرت واقعی بررسی نشد.`,
      subsystem: 'Billing',
      tenantId: inv.tenantId || 'tnt_westo_demo'
    });
  }

  if (window.GMApp && typeof window.GMApp.showToast === 'function') {
    window.GMApp.showToast(`استعلام تطبیق سند ${inv.id} فقط در Mock ثبت شد؛ مغایرت بانکی محاسبه نشده است.`, 'info');
  }
};

window.createActivationTicket = function(invoiceId) {
  const store = window.prototypeStore || window.GMStore;
  const inv = store && store.getInvoice ? store.getInvoice(invoiceId) : null;
  if (!inv) return;

  let ticketId = 'TCK-AUTO-881';
  if (store && typeof store.createTicket === 'function') {
    const t = store.createTicket({
      tenantId: inv.tenantId || 'tnt_westo_demo',
      title: `پیگیری استقرار خودکار ماژول برای فاکتور ${inv.id}`,
      category: 'امور مالی و استقرار ماژول',
      priority: 'high',
      creator: 'سامانه خودکار NEEM Billing Engine',
      assignedTo: 'پشتیبان ارشد زیرساخت Edge'
    });
    if (t && t.id) ticketId = t.id;
  }

  if (window.GMApp && typeof window.GMApp.showToast === 'function') {
    window.GMApp.showToast(`تیکت پشتیبانی خودکار (${ticketId}) برای فاکتور ${inv.id} ثبت شد. خرید دوباره پیشنهاد نمی‌شود.`, 'info');
  }

  if (typeof window.trackActivation === 'function') {
    window.trackActivation(invoiceId);
  }
};

window.renderGM11 = function(params) {
  const store = window.prototypeStore || window.GMStore;
  const isFiltered = !!params?.id && params.id !== 'all';
  const targetTenant = isFiltered && store && store.getTenant ? store.getTenant(params.id) : null;
  if (isFiltered && !targetTenant) {
    return `
      <div class="empty-state" role="alert">
        <h2>مشتری در رجیستری Mock یافت نشد</h2>
        <p>شناسهٔ ${params.id} معتبر نیست؛ دادهٔ مالی مشتری دیگری نمایش داده نمی‌شود.</p>
        <a class="btn btn-secondary" href="#gm-11-billing">بازگشت به مالی پلتفرم</a>
      </div>
    `;
  }
  const invoices = (store && typeof store.getInvoices === 'function') ? (isFiltered ? store.getInvoices(params.id) : store.getInvoices()) : [];
  const subscriptions = (store && typeof store.getSubscriptions === 'function') ? (isFiltered ? store.getSubscriptions(params.id) : store.getSubscriptions()) : [];
  const payments = (store && typeof store.getPayments === 'function') ? (isFiltered ? store.getPayments(params.id) : store.getPayments()) : [];
  const debts = (store && typeof store.getDebts === 'function') ? (isFiltered ? store.getDebts(params.id) : store.getDebts()) : [];
  const credits = (store && typeof store.getCredits === 'function') ? (isFiltered ? store.getCredits(params.id) : store.getCredits()) : [];
  const discounts = (store && typeof store.getDiscounts === 'function') ? (isFiltered ? store.getDiscounts(params.id) : store.getDiscounts()) : [];
  const activeTab = params?.tab || 'invoices';

  const cellLabel = targetTenant ? ({ 'cell-teh-01': 'تهران', 'cell-msh-01': 'مشهد', 'cell-mashhad-01': 'مشهد' }[targetTenant.cellId] || 'مرکز عملیاتی') : '';

  const totalRevenue = invoices.filter(i => i.status === 'paid').reduce((sum, i) => sum + (i.totalAmount || 0), 0);
  const pendingRevenue = invoices.filter(i => i.status === 'pending').reduce((sum, i) => sum + (i.totalAmount || 0), 0);
  const pendingInvoiceCount = invoices.filter(i => i.status === 'pending').length;
  const pendingActivationCount = invoices.filter(i => i.status === 'paid' && i.activationStatus === 'pending_activation').length;
  const totalWalletCredit = credits.reduce((sum, c) => sum + (c.balance || 0), 0);
  const latestInvoice = invoices.find(i => i.paymentRef) || invoices[0];

  return `
    <div class="page-header gm11-page">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
          <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
          <span class="breadcrumb-separator">/</span>
          ${targetTenant ? `<a href="#gm-04-tenant-detail?id=${targetTenant.id}" class="breadcrumb-link">پرونده مشتری</a><span class="breadcrumb-separator">/</span>` : ''}
          <span class="breadcrumb-current" aria-current="page">امور مالی و اشتراک‌ها</span>
        </nav>
        <h1>
          اشتراک، صورتحساب و پرداخت: ${targetTenant ? targetTenant.name : 'پلتفرم'}
          ${targetTenant ? `<span class="badge scope-cell-badge">${cellLabel}</span><span class="badge badge-scope-tenant"><span class="status-dot dot-active"></span> دامنه مشتری</span>` : `<span class="badge badge-scope-global"><span class="status-dot" style="background:#818cf8;"></span> کلان پلتفرم</span>`}
          <span class="page-code-badge">GM-11</span>
        </h1>
        <p>صدور فاکتورهای دوره‌ای، پیگیری پرداخت‌های شاپرک، تمدید اشتراک‌ها، اعتبار کیف‌پول و انطباق مالیاتی</p>
      </div>
      <div class="header-actions" style="display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap;">
        <span class="badge badge-success" style="display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.775rem; padding: 0.4rem 0.75rem;" title="حسابداری و تطبیق تراکنش‌ها فعال و پایدار است">
          <span class="status-dot dot-active"></span> دفتر مالی رسمی و معتبر
        </span>
        <button class="btn btn-secondary btn-sm" onclick="window.exportAccountingLedger('${isFiltered ? params.id : 'all'}')" aria-label="چاپ و خروجی رسمی حسابداری NEEM">
          چاپ/خروجی حسابداری NEEM
        </button>
        <button class="btn btn-primary btn-sm" onclick="window.promptIssueManualInvoice('${isFiltered ? params.id : 'tnt_westo_demo'}')">
          صدور فاکتور دوره‌ای
        </button>
      </div>
    </div>

    ${window.GMDataState ? window.GMDataState.renderFreshnessBar({
      viewId: 'GM11',
      sourceLabel: 'دفتر کل فاکتورها، حسابداری دوبل و تسویه‌های شاپرک',
      sourceMode: 'local',
      totalCount: invoices.length,
      countLabel: 'صورتحساب ثبت‌شده'
    }) : ''}

    <!-- Financial & Transaction Summary Strip (GODMODE GM-11) -->
    <div class="summary-strip billing-summary-strip" role="region" aria-label="خلاصه شاخص‌های مالی، تازگی داده و آخرین مرجع پرداخت">
      <div class="summary-strip-group">
        <div class="summary-strip-item freshness-indicator">
          <span class="status-dot dot-green"></span>
          <span style="font-weight: 600; color: var(--text-primary);">تازگی داده‌ها:</span>
          <span class="badge badge-success" style="font-size: 0.75rem;"><span class="status-dot dot-green"></span> برخط و متصل به شاپرک</span>
          <span style="font-size: 0.75rem; color: var(--text-tertiary);">• تسویه حسابداری دوبل V2</span>
        </div>
        ${latestInvoice ? `
          <div class="summary-strip-item">
            <span style="color: var(--text-secondary);">شناسه صورتحساب شاخص:</span>
            <code class="cell-mono invoice-id-code">${latestInvoice.id}</code>
            <button type="button" class="copy-btn-inline" onclick="window.copyToClipboard('${latestInvoice.id}', 'شناسه صورتحساب')" title="کپی شناسه صورتحساب ${latestInvoice.id}">
              کپی شناسه
            </button>
          </div>
          ${latestInvoice.paymentRef ? `
            <div class="summary-strip-item">
              <span style="color: var(--text-secondary);">مرجع پرداخت شاپرک:</span>
              <code class="cell-mono payment-ref-code">${latestInvoice.paymentRef}</code>
              <button type="button" class="copy-btn-inline" onclick="window.copyToClipboard('${latestInvoice.paymentRef}', 'مرجع پرداخت شاپرک')" title="کپی مرجع شاپرک ${latestInvoice.paymentRef}">
                کپی مرجع
              </button>
            </div>
          ` : ''}
        ` : ''}
      </div>
      <div class="summary-strip-actions">
        <span class="badge badge-emerald" style="font-size: 0.725rem;">دفتر کل V2 • اسناد و ترازهای مالی عملیاتی</span>
      </div>
    </div>

    <div class="data-quality-strip" role="status" aria-label="وضعیت داده‌های مالی">
      <div class="data-quality-label"><span class="dq-badge-dot dot-cyan"></span><span>وضعیت داده مالی</span></div>
      <div class="data-quality-grid">
        <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">منبع</span><span class="dq-dim-val">${invoices.length.toLocaleString('fa-IR')} فاکتور</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">اسناد ثبت‌شده</span><span class="dq-dim-val">${invoices.length.toLocaleString('fa-IR')} سند</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">دوره مالی</span><span class="dq-dim-val">دوره جاری فعال و متوازن</span></span>
      </div>
      <span class="dq-action-hint"><span>صورتحساب‌ها و اسناد مالی ثبت‌شده در دفتر حسابداری دوبل کلاینت وستو</span></span>
    </div>

    ${(() => {
      const dataState = window.GMDataState ? window.GMDataState.getViewState('GM11') : { state: 'live' };
      if (dataState.state === 'failed' || dataState.state === 'error') {
        return window.GMDataState.renderErrorState({
          viewId: 'GM11',
          title: 'خطا در واکشی صورتحساب‌ها',
          reason: 'ارتباط با سامانه مالی و دفتر کل V2 برقرار نشد.',
          errorCode: 'ERR_BILLING_LEDGER_UNREACHABLE'
        });
      }
      if (dataState.state === 'empty') {
        return window.GMDataState.renderEmptyState({
          title: 'هیچ صورتحسابی یافت نشد',
          summary: 'عدم وجود رکورد تراکنش مالی یا فاکتور دوره‌ای در سامانه حسابداری',
          description: 'هیچ صورتحسابی در دوره مالی جاری برای این مجموعه صادر نشده است.',
          auditScope: 'کلیه فاکتورهای دوره‌ای، تعرفه‌های افزونه و رکوردهای پایانه پرداخت وستو',
          actionLabel: 'صدور فاکتور جدید',
          onAction: "window.promptIssueManualInvoice('tnt_westo_demo')"
        });
      }
      if (dataState.state === 'loading') {
        return window.GMDataState.renderSkeleton('table', 5);
      }
      if (dataState.state === 'refreshing') {
        return window.GMDataState.renderRefreshingBanner('GM11');
      }
      if (dataState.state === 'stale') {
        return window.GMDataState.renderStaleBanner('GM11');
      }
      return '';
    })()}

    ${(window.GMDataState && ['failed', 'empty', 'error', 'loading'].includes(window.GMDataState.getViewState('GM11').state)) ? '' : `
    <!-- Tenant Correlation Bar -->
    <div class="tenant-correlation-bar" style="background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: 8px; padding: 0.65rem 1rem; margin-bottom: 1.25rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
      <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
        <span style="font-size: 0.813rem; font-weight: 600; color: var(--text-secondary);">تفکیک صورتحساب مشتری:</span>
        <a href="#gm-11-billing?id=all" class="filter-chip ${!isFiltered ? 'active' : ''}">همه مشتریان (${(store ? store.getInvoices('all') : []).length})</a>
        ${(store ? store.getTenants() : []).map(t => {
          const tInvs = store ? store.getInvoices(t.id) : [];
          return `
            <a href="#gm-11-billing?id=${t.id}" class="filter-chip ${params?.id === t.id ? 'active' : ''}">
              ${t.name} (${tInvs.length})
            </a>
          `;
        }).join('')}
      </div>
      <div style="display: flex; gap: 0.5rem; align-items: center;">
        ${isFiltered && targetTenant ? `
          <a href="#gm-04-tenant-detail?id=${params.id}&tab=billing" class="btn btn-xs btn-secondary">
            پرونده مالی ${targetTenant.name}
          </a>
        ` : ''}
        <button class="btn btn-xs btn-primary" onclick="window.promptIssueManualInvoice('${isFiltered ? params.id : 'tnt_westo_demo'}')">
          صدور فاکتور دوره‌ای جدید
        </button>
      </div>
    </div>

    <!-- Executive Financial KPIs (All Amounts with Explicit Toman Units) -->
    <div class="grid-cols-4" style="margin-bottom: 1.25rem;">
      <div class="card stat-card">
        <div class="stat-header">
          <span>درآمد وصول‌شده دوره</span>
        </div>
        <div class="stat-value">${totalRevenue ? totalRevenue.toLocaleString('fa-IR') : '۲۴,۵۰۰,۰۰۰'} <span class="stat-unit">تومان</span></div>
        <div class="stat-footer">
          <span class="badge badge-success"><span class="status-dot dot-green"></span> تسویه‌شده و واریز شاپرک</span>
        </div>
      </div>

      <div class="card stat-card">
        <div class="stat-header">
          <span>مطالبات در انتظار پرداخت</span>
        </div>
        <div class="stat-value">${pendingRevenue ? pendingRevenue.toLocaleString('fa-IR') : (pendingInvoiceCount ? '۱,۸۵۰,۰۰۰' : '۰')} <span class="stat-unit">تومان</span></div>
        <div class="stat-footer">
          <span class="badge badge-neutral">${pendingInvoiceCount ? `${pendingInvoiceCount.toLocaleString('fa-IR')} صورتحساب در سررسید جاری` : 'حساب تسویه'}</span>
        </div>
      </div>

      <div class="card stat-card">
        <div class="stat-header">
          <span>اشتراک‌های فعال</span>
        </div>
        <div class="stat-value">${subscriptions.length ? subscriptions.length.toLocaleString('fa-IR') : '۱'} <span class="stat-unit">قرارداد</span></div>
        <div class="stat-footer">
          <span class="badge badge-success"><span class="status-dot dot-green"></span> تمدید خودکار فعال</span>
        </div>
      </div>

      <div class="card stat-card">
        <div class="stat-header">
          <span>اعتبار کیف‌پول و بستانکاری</span>
        </div>
        <div class="stat-value" style="font-size: 1.15rem; color: #10b981;">
          ${totalWalletCredit ? totalWalletCredit.toLocaleString('fa-IR') : '۰'} <span class="stat-unit">تومان</span>
        </div>
        <div class="stat-footer">
          <span class="badge badge-neutral">حساب تسویه و متوازن</span>
        </div>
      </div>
    </div>

    <!-- 6 Sub-Tabs for Billing Domain (GODMODE GM-11) -->
    <nav class="nav-tabs gm11-tabs-nav" aria-label="بخش‌های مالی و اشتراک" style="margin-bottom: 1.25rem;">
      <button type="button" class="tab-link gm11-tab-btn ${activeTab === 'invoices' ? 'active' : ''}" data-tab="invoices" onclick="window.switchGM11Tab('invoices')">
        صورتحساب‌ها و فاکتورها (${invoices.length})
      </button>
      <button type="button" class="tab-link gm11-tab-btn ${activeTab === 'subscriptions' ? 'active' : ''}" data-tab="subscriptions" onclick="window.switchGM11Tab('subscriptions')">
        اشتراک‌ها و دوره‌ها (${subscriptions.length})
      </button>
      <button type="button" class="tab-link gm11-tab-btn ${activeTab === 'payments' ? 'active' : ''}" data-tab="payments" onclick="window.switchGM11Tab('payments')">
        پرداخت‌ها و تراکنش‌ها (${payments.length})
      </button>
      <button type="button" class="tab-link gm11-tab-btn ${activeTab === 'debts' ? 'active' : ''}" data-tab="debts" onclick="window.switchGM11Tab('debts')">
        بدهی و مطالبات معوق (${debts.length})
      </button>
      <button type="button" class="tab-link gm11-tab-btn ${activeTab === 'credits' ? 'active' : ''}" data-tab="credits" onclick="window.switchGM11Tab('credits')">
        اعتبار و کیف‌پول (${credits.length})
      </button>
      <button type="button" class="tab-link gm11-tab-btn ${activeTab === 'discounts' ? 'active' : ''}" data-tab="discounts" onclick="window.switchGM11Tab('discounts')">
        تخفیف و پروموشن‌ها (${discounts.length})
      </button>
    </nav>

    <!-- PANEL 1: INVOICES (Default / Batch Operations) -->
    <div class="gm11-panel" data-panel="invoices" style="display: ${activeTab === 'invoices' ? 'block' : 'none'};">
      <div class="card card-flush">
        <div class="card-header">
          <div class="card-title-group">
            <h3 class="card-title">فهرست صورتحساب‌ها و اسناد مالی پلتفرم</h3>
            <p class="card-subtitle">صورتحساب‌های دوره‌ای، پیگیری فعال‌سازی ماژول‌ها و ثبت مبالغ به تومان</p>
          </div>
          ${pendingActivationCount ? `
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span class="badge badge-warning" style="font-weight: 600;">
                ${pendingActivationCount.toLocaleString('fa-IR')} مورد خرید نیازمند پیگیری فعال‌سازی
              </span>
            </div>
          ` : ''}
        </div>
        <div class="table-wrapper">
          <div class="table-toolbar">
            <div class="table-filters" id="invoiceStatusFilters" role="group" aria-label="فیلتر وضعیت صورتحساب">
              <button class="filter-chip active" aria-pressed="true" onclick="window.GMViews.GM11.setStatusFilter('all', this)">همه (${invoices.length})</button>
              <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM11.setStatusFilter('paid', this)">پرداخت‌شده</button>
              <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM11.setStatusFilter('pending', this)">در انتظار پرداخت</button>
              <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM11.setStatusFilter('pending_activation', this)">در انتظار فعال‌سازی (${pendingActivationCount})</button>
            </div>
            <div class="table-search-group">
              <span id="invoicesFilterCount" class="filter-count-badge">نمایش ${invoices.length.toLocaleString('fa-IR')} از ${invoices.length.toLocaleString('fa-IR')} صورتحساب</span>
              <div class="search-input-wrapper" id="invoiceSearchWrapper">
                <input type="text" id="invoiceSearchInput" class="form-control" placeholder="جست‌وجو در شماره سند یا مشتری..." aria-label="جست‌وجو در صورتحساب‌ها" style="width: 220px; padding: 0.35rem 0.75rem;" oninput="window.GMViews.GM11.setQuery(this.value)" />
                <button class="search-clear-btn" onclick="window.GMViews.GM11.clearSearch()" aria-label="پاکسازی جستجو">✕</button>
              </div>
            </div>
          </div>

          <div class="table-responsive">
            <table class="data-table" id="invoicesTable" aria-label="جدول صورتحساب‌ها و فاکتورهای رسمی">
              <thead>
                <tr>
                  <th class="cell-checkbox" style="width: 40px; text-align: center;">
                    <input type="checkbox" id="invoices-select-all" aria-label="انتخاب همه فاکتورها" />
                  </th>
                  <th>مدرک مالی</th>
                  <th>مشتری طرف قرارداد</th>
                  <th>دوره صورتحساب</th>
                  <th>مبلغ خالص (تومان)</th>
                  <th>مالیات بر ارزش افزوده (۹٪)</th>
                  <th>مبلغ نهایی (تومان)</th>
                  <th>وضعیت پرداخت و استقرار</th>
                  <th>کد رهگیری بانکی</th>
                  <th class="cell-actions">عملیات</th>
                </tr>
              </thead>
              <tbody>
                ${invoices.map(inv => `
                  <tr id="row-inv-${inv.id}" data-status="${inv.status}" data-activation="${inv.activationStatus || ''}" data-search="${inv.id} ${inv.tenantName} ${inv.period}">
                    <td class="cell-checkbox" style="text-align: center;">
                      <input type="checkbox" class="invoice-row-select" data-id="${inv.id}" aria-label="انتخاب صورتحساب ${inv.id}" />
                    </td>
                    <td>
                      <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
                        <strong style="color: var(--text-primary);">صورتحساب ${inv.period}</strong>
                        <button type="button" class="copy-btn-inline" onclick="window.copyToClipboard('${inv.id}', 'شناسه فاکتور')" title="کپی شناسه ${inv.id}">
                          کپی ${inv.id}
                        </button>
                      </div>
                      <details class="row-disclosure billing-technical-details">
                        <summary>شناسه سند</summary>
                        <code class="nav-code">${inv.id}</code>
                      </details>
                    </td>
                    <td>
                      <strong style="color: var(--text-primary);">${inv.tenantName}</strong>
                    </td>
                    <td style="color: var(--text-secondary);">${inv.period}</td>
                    <td class="cell-mono" style="font-size: 0.75rem;">— تومان <span class="text-warning">(Fixture)</span></td>
                    <td class="cell-mono" style="font-size: 0.75rem; color: var(--text-secondary);">— تومان <span class="text-warning">(Fixture)</span></td>
                    <td class="cell-mono" style="font-weight: 700; color: var(--accent-cyan); font-size: 0.813rem;">
                      — تومان <span class="text-warning">(Fixture)</span>
                    </td>
                    <td>
                      ${inv.status === 'paid'
                        ? (inv.activationStatus === 'pending_activation'
                            ? '<span class="badge badge-warning" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);"><span class="badge-dot dot-warning"></span> Fixture؛ پرداخت تأییدنشده و فعال‌سازی نامشخص</span>'
                            : '<span class="badge badge-warning"><span class="badge-dot"></span> Fixture؛ پرداخت و فعال‌سازی تأییدنشده</span>')
                        : '<span class="badge badge-warning"><span class="badge-dot"></span> Fixture؛ وضعیت پرداخت نامشخص</span>'
                      }
                    </td>
                    <td class="cell-mono" style="font-size: 0.75rem; color: var(--text-tertiary);">
                      ${inv.paymentRef ? `
                        <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
                          <code class="cell-mono">${inv.paymentRef}</code>
                          <button type="button" class="copy-btn-inline" onclick="window.copyToClipboard('${inv.paymentRef}', 'مرجع پرداخت شاپرک')" title="کپی مرجع شاپرک ${inv.paymentRef}">
                            کپی
                          </button>
                        </div>
                      ` : `
                        <span class="badge badge-neutral" style="font-size: 0.7rem;">فاقد مرجع بانکی</span>
                      `}
                      <details class="row-disclosure billing-technical-details">
                        <summary>${inv.paymentRef ? 'نمایش کد رهگیری' : 'بدون کد رهگیری'}</summary>
                        ${inv.paymentRef ? `<code>${inv.paymentRef}</code>` : ''}
                      </details>
                    </td>
                    <td class="cell-actions">
                      <div style="display: flex; gap: 0.35rem; justify-content: flex-end; flex-wrap: wrap;">
                        <button class="btn btn-secondary btn-sm" onclick="window.renderGM11Details('${inv.id}')" aria-label="مشاهده اقلام و تطبیق فاکتور ${inv.id}">
                          اقلام و تطبیق
                        </button>
                        ${(inv.status === 'paid' && inv.activationStatus === 'pending_activation') ? `
                          <button class="btn btn-warning btn-sm" onclick="window.trackActivation('${inv.id}')" aria-label="پیگیری فعال‌سازی فاکتور ${inv.id}" style="font-weight: 700;">
                            پیگیری فعال‌سازی
                          </button>
                        ` : ''}
                        ${(inv.status === 'paid' && inv.activationStatus !== 'pending_activation') ? `
                          <button class="btn btn-secondary btn-sm" onclick="window.openGM11RefundDrawer('${inv.id}')" aria-label="درخواست استرداد وجه فاکتور ${inv.id}">
                            درخواست استرداد
                          </button>
                        ` : ''}
                        ${inv.status === 'pending' ? `
                          <button class="btn btn-primary btn-sm" onclick="window.payGM11Invoice('${inv.id}')" aria-label="ثبت پرداخت دستی فاکتور ${inv.id}">
                            ثبت پرداخت
                          </button>
                        ` : ''}
                      </div>
                    </td>
                  </tr>
                `).join('')}
                <tr id="invoices-empty-row" style="display: none;">
                  <td colspan="10" style="text-align: center; padding: 2rem 1rem;">
                    <div class="empty-state empty-state-compact">
                      <div class="empty-state-icon"><span class="badge-dot dot-warning"></span></div>
                      <h3>صورتحسابی با این مشخصات یافت نشد</h3>
                      <p>عبارت جستجو یا وضعیت انتخاب‌شده را بررسی نمایید.</p>
                      <button class="btn btn-secondary btn-sm" onclick="window.GMViews.GM11.resetAll()">بازنشانی فیلترها</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Bulk Actions Docked Bar -->
        <div id="gm11-bulk-actions" class="table-bulk-actions-bar" role="toolbar" aria-label="عملیات گروهی روی فاکتورهای انتخاب‌شده">
          <div class="bulk-actions-info">
            <span class="bulk-counter-badge" id="gm11-bulk-count">۰ مورد انتخاب‌شده</span>
            <span class="bulk-actions-label">اقدامات دسته‌جمعی صورتحساب‌ها:</span>
          </div>
          <div class="bulk-actions-btns">
            <button type="button" class="btn btn-primary btn-sm" id="gm11-bulk-pay-btn" onclick="window.GMViews.GM11.bulkPaySelected()" disabled>
              ثبت پرداخت گروهی
            </button>
            <button type="button" class="btn btn-secondary btn-sm" id="gm11-bulk-export-btn" onclick="window.GMViews.GM11.bulkExportSelected()" disabled>
              دریافت PDF گروهی
            </button>
            <button type="button" class="bulk-clear-btn" onclick="window.GMViews.GM11.clearSelection()">
              لغو انتخاب
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- PANEL 2: SUBSCRIPTIONS -->
    <div class="gm11-panel" data-panel="subscriptions" style="display: ${activeTab === 'subscriptions' ? 'block' : 'none'};">
      <div class="card card-flush">
        <div class="card-header">
          <div class="card-title-group">
            <h3 class="card-title">قراردادها و اشتراک‌های دوره‌ای فعال</h3>
            <p class="card-subtitle">دوره صورتحساب مشخص (ماهانه/سالانه)، مبلغ هر دوره و امکان پیش‌نمایش تمدید</p>
          </div>
        </div>
        <div class="table-container">
          <table class="data-table" aria-label="جدول اشتراک‌های دوره‌ای">
            <thead>
              <tr>
                <th>نام مشتری / مجموعه</th>
                <th>پلن پایه</th>
                <th>دوره صورتحساب</th>
                <th>تمدید خودکار</th>
                <th>تاریخ سررسید بعدی</th>
                <th>مبلغ دوره (تومان)</th>
                <th class="cell-actions">عملیات</th>
              </tr>
            </thead>
            <tbody>
              ${subscriptions.map(s => {
                const tenant = store && store.getTenant ? store.getTenant(s.tenantId) : null;
                return `
                  <tr>
                    <td>
                      <div style="font-weight: 600; color: var(--text-primary);">${tenant ? tenant.name : s.tenantId}</div>
                      <details class="row-disclosure billing-technical-details">
                        <summary>شناسه اشتراک</summary>
                        <code class="cell-mono">${s.id}</code>
                      </details>
                    </td>
                    <td><span class="badge badge-cyan">${s.planName}</span></td>
                    <td>
                      <span class="badge badge-primary">${s.billingCycle || 'ماهانه'}</span>
                    </td>
                    <td>
                      ${s.autoRenew ? '<span class="badge badge-success"><span class="badge-dot"></span> فعال</span>' : '<span class="badge badge-neutral">غیرفعال</span>'}
                    </td>
                    <td class="cell-mono" style="font-size: 0.813rem;">${s.nextRenewal}</td>
                    <td class="cell-mono" style="font-weight: 700; color: var(--accent-cyan); font-size: 0.85rem;">
                      ${s.monthlyTotal.toLocaleString('fa-IR')} تومان (${s.billingCycle || 'ماهانه'})
                    </td>
                    <td class="cell-actions">
                      <div style="display: flex; gap: 0.35rem; justify-content: flex-end;">
                        <button class="btn btn-primary btn-sm" onclick="window.openGM11RenewalPreview('${s.id}')" aria-label="پیش‌نمایش تمدید ${s.id}">
                          پیش‌نمایش تمدید
                        </button>
                        <a href="#gm-04-tenant-detail?id=${s.tenantId}&tab=features" class="btn btn-secondary btn-sm" aria-label="افزونه‌های ${tenant ? tenant.name : s.tenantId}">
                          افزونه‌ها
                        </a>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- PANEL 3: PAYMENTS -->
    <div class="gm11-panel" data-panel="payments" style="display: ${activeTab === 'payments' ? 'block' : 'none'};">
      <div class="card card-flush">
        <div class="card-header">
          <div class="card-title-group">
            <h3 class="card-title">تراکنش‌ها و رسیدهای پرداخت شاپرک</h3>
            <p class="card-subtitle">سابقه پرداخت‌های بانکی، شماره مرجع شاپرک (RRN)، کارت پرداخت و استرداد وجه</p>
          </div>
        </div>
        <div class="table-container">
          <table class="data-table" aria-label="جدول تراکنش‌های پرداخت بانکی">
            <thead>
              <tr>
                <th>شناسه تراکنش</th>
                <th>فاکتور متناظر</th>
                <th>مشتری</th>
                <th>درگاه بانکی</th>
                <th>کد رهگیری / RRN</th>
                <th>کارت پرداخت‌کننده</th>
                <th>زمان تراکنش</th>
                <th>مبلغ تراکنش (تومان)</th>
                <th>وضعیت</th>
                <th class="cell-actions">عملیات</th>
              </tr>
            </thead>
            <tbody>
              ${payments.map(p => `
                <tr>
                  <td><code class="nav-code">${p.id}</code></td>
                  <td>
                    <div style="display: flex; align-items: center; gap: 0.35rem;">
                      <button class="btn btn-link btn-xs" onclick="window.renderGM11Details('${p.invoiceId}')">
                        ${p.invoiceId}
                      </button>
                      <button type="button" class="copy-btn-inline" onclick="window.copyToClipboard('${p.invoiceId}', 'شناسه صورتحساب')" title="کپی شناسه صورتحساب">
                        📋
                      </button>
                    </div>
                  </td>
                  <td><strong>${p.tenantName}</strong></td>
                  <td><span class="badge badge-neutral">${p.gateway}</span></td>
                  <td class="cell-mono" style="font-size: 0.775rem;">
                    <div style="display: flex; align-items: center; gap: 0.35rem;">
                      <code>${p.paymentRef}</code>
                      <button type="button" class="copy-btn-inline" onclick="window.copyToClipboard('${p.paymentRef}', 'شماره مرجع شاپرک')" title="کپی شماره مرجع شاپرک">
                        📋
                      </button>
                    </div>
                  </td>
                  <td class="cell-mono" style="font-size: 0.775rem; direction: ltr; text-align: right;">${p.cardMask}</td>
                  <td class="cell-mono" style="font-size: 0.75rem;">${p.paidAt}</td>
                  <td class="cell-mono" style="font-weight: 700; color: var(--text-secondary); font-size: 0.813rem;">
                    — تومان <span class="text-warning">(Fixture)</span>
                  </td>
                  <td>
                    <span class="badge badge-warning"><span class="badge-dot"></span> Fixture؛ وضعیت بانکی تأیید نشده</span>
                  </td>
                  <td class="cell-actions">
                    <div style="display: flex; gap: 0.35rem; justify-content: flex-end;">
                      <button class="btn btn-secondary btn-sm" onclick="window.renderGM11Details('${p.invoiceId}')">
                        سند فاکتور
                      </button>
                      <button class="btn btn-secondary btn-sm" onclick="window.openGM11RefundDrawer('${p.invoiceId}')">
                        استرداد (Refund)
                      </button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- PANEL 4: DEBTS & RECEIVABLES -->
    <div class="gm11-panel" data-panel="debts" style="display: ${activeTab === 'debts' ? 'block' : 'none'};">
      <div class="card card-flush">
        <div class="card-header">
          <div class="card-title-group">
            <h3 class="card-title">بدهی‌ها و مطالبات معوق سررسیدشده</h3>
            <p class="card-subtitle">پایش فاکتورهای پرداخت‌نشده، شمارش روزهای مانده تا سررسید و ارسال اخطار</p>
          </div>
        </div>
        <div class="table-container">
          <table class="data-table" aria-label="جدول مطالبات معوق و بدهی‌ها">
            <thead>
              <tr>
                <th>شناسه مطالبه</th>
                <th>صورتحساب مرجع</th>
                <th>مشتری طرف حساب</th>
                <th>دوره صورتحساب</th>
                <th>مبلغ بدهی (تومان)</th>
                <th>تاریخ سررسید</th>
                <th>وضعیت مهلت</th>
                <th>تعداد یادآوری</th>
                <th class="cell-actions">عملیات</th>
              </tr>
            </thead>
            <tbody>
              ${debts.length ? debts.map(d => `
                <tr>
                  <td><code class="nav-code">${d.id}</code></td>
                  <td>
                    <button class="btn btn-link btn-xs" onclick="window.renderGM11Details('${d.invoiceId}')">
                      ${d.invoiceId}
                    </button>
                  </td>
                  <td><strong>${d.tenantName}</strong></td>
                  <td style="color: var(--text-secondary);">${d.period}</td>
                  <td class="cell-mono" style="font-weight: 700; color: #f59e0b; font-size: 0.85rem;">
                    ${d.amount.toLocaleString('fa-IR')} تومان
                  </td>
                  <td class="cell-mono" style="font-size: 0.775rem;">${d.dueDate}</td>
                  <td>
                    <span class="badge badge-warning">
                      ${d.daysLeft > 0 ? `${d.daysLeft} روز باقیمانده` : 'سررسید منقضی'}
                    </span>
                  </td>
                  <td class="cell-mono">${(d.reminderCount || 0).toLocaleString('fa-IR')} بار</td>
                  <td class="cell-actions">
                    <div style="display: flex; gap: 0.35rem; justify-content: flex-end;">
                      <button class="btn btn-primary btn-sm" onclick="window.payGM11Invoice('${d.invoiceId}')">
                        تسویه مستقیم
                      </button>
                      <button class="btn btn-secondary btn-sm" onclick="window.sendDebtReminder('${d.id}')">
                        ارسال یادآوری
                      </button>
                    </div>
                  </td>
                </tr>
              `).join('') : `
                <tr>
                  <td colspan="9" style="text-align: center; padding: 2rem;">
                    <span class="badge badge-warning">اطلاعات بدهی عملیاتی در Fixture موجود نیست؛ نبود بدهی تأیید نشده است.</span>
                  </td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- PANEL 5: CREDITS & WALLET -->
    <div class="gm11-panel" data-panel="credits" style="display: ${activeTab === 'credits' ? 'block' : 'none'};">
      <div class="card card-flush">
        <div class="card-header">
          <div class="card-title-group">
            <h3 class="card-title">کیف‌پول اعتباری و بستانکاری مشتریان</h3>
            <p class="card-subtitle">موجودی پیش‌پرداخت، اعتبارهای تشویقی، پاداش تمدید زودهنگام و امکان کسر در فاکتور</p>
          </div>
        </div>
        <div class="table-container">
          <table class="data-table" aria-label="جدول اعتبارات و کیف‌پول">
            <thead>
              <tr>
                <th>شناسه سند اعتبار</th>
                <th>مشتری ذی‌نفع</th>
                <th>عنوان و ریشه اعتبار</th>
                <th>موجودی فعال (تومان)</th>
                <th>تاریخ صدور</th>
                <th>مهلت استفاده (انقضا)</th>
                <th>وضعیت</th>
                <th class="cell-actions">عملیات</th>
              </tr>
            </thead>
            <tbody>
              ${credits.map(c => `
                <tr>
                  <td><code class="nav-code">${c.id}</code></td>
                  <td><strong>${c.tenantName}</strong></td>
                  <td>
                    <span style="color: var(--text-primary); font-weight: 500;">${c.typeFa}</span>
                  </td>
                  <td class="cell-mono" style="font-weight: 700; color: #10b981; font-size: 0.85rem;">
                    ${c.balance.toLocaleString('fa-IR')} تومان
                  </td>
                  <td class="cell-mono" style="font-size: 0.775rem;">${c.issuedAt}</td>
                  <td class="cell-mono" style="font-size: 0.775rem;">${c.expiresAt}</td>
                  <td>
                    <span class="badge badge-warning"><span class="badge-dot"></span> Fixture؛ اعتبار عملیاتی تأیید نشده</span>
                  </td>
                  <td class="cell-actions">
                    <div style="display: flex; gap: 0.35rem; justify-content: flex-end;">
                      <button class="btn btn-secondary btn-sm" onclick="window.openGM11RenewalPreview('sub_westo')">
                        استفاده در تمدید
                      </button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- PANEL 6: DISCOUNTS & PROMOTIONS -->
    <div class="gm11-panel" data-panel="discounts" style="display: ${activeTab === 'discounts' ? 'block' : 'none'};">
      <div class="card card-flush">
        <div class="card-header">
          <div class="card-title-group">
            <h3 class="card-title">تخفیف‌های قراردادی و کدهای پروموشن فعال</h3>
            <p class="card-subtitle">قواعد تخفیف پیش‌خرید سالانه، تخفیف توسعه شعب و اعمال خودکار روی صورتحساب</p>
          </div>
        </div>
        <div class="table-container">
          <table class="data-table" aria-label="جدول تخفیف‌ها و پروموشن‌ها">
            <thead>
              <tr>
                <th>کد تخفیف اختصاصی</th>
                <th>عنوان تخفیف و پروموشن</th>
                <th>مشتری مشمول</th>
                <th>میزان تخفیف</th>
                <th>دوره مشمول</th>
                <th>مهلت اعتبار</th>
                <th>وضعیت</th>
                <th class="cell-actions">عملیات</th>
              </tr>
            </thead>
            <tbody>
              ${discounts.map(d => `
                <tr>
                  <td><code class="cell-mono font-bold" style="color: var(--accent-cyan);">${d.code}</code></td>
                  <td><strong>${d.title}</strong></td>
                  <td>
                    <span class="badge badge-neutral">${d.tenantId === 'tnt_westo_demo' ? 'کافه وستو' : 'سراسری'}</span>
                  </td>
                  <td class="cell-mono font-bold">
                    ${d.discountPercent ? `${d.discountPercent}٪` : ''} 
                    ${d.fixedAmount ? `(${d.fixedAmount.toLocaleString('fa-IR')} تومان)` : ''}
                  </td>
                  <td>
                    <span class="badge badge-primary">${d.billingCycle}</span>
                  </td>
                  <td class="cell-mono" style="font-size: 0.775rem;">${d.validUntil}</td>
                  <td>
                    <span class="badge badge-warning"><span class="badge-dot"></span> Fixture؛ وضعیت تخفیف تأیید نشده</span>
                  </td>
                  <td class="cell-actions">
                    <button class="btn btn-secondary btn-sm" onclick="window.openGM11RenewalPreview('sub_westo')">
                      بررسی اثر در تمدید
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    `}
  `;
};

window.renderGM11Details = function(invoiceId) {
  const store = window.prototypeStore || window.GMStore;
  const inv = store && store.getInvoice ? store.getInvoice(invoiceId) : null;
  if (!inv) return;

  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <!-- Invoice Summary Strip: Freshness, Invoice ID & Payment Reference -->
      <div class="summary-strip invoice-summary-strip" role="region" aria-label="خلاصه سند، تازگی داده و کد رهگیری" style="margin-bottom: 0.25rem;">
        <div class="summary-strip-group">
          <div class="summary-strip-item">
            <span class="status-dot dot-active" style="background:${inv.status === 'paid' ? '#10b981' : '#f59e0b'};"></span>
            <span>تازگی و وضعیت:</span>
            <strong style="color: #f59e0b;">
              Fixture؛ وضعیت پرداخت و زمان دریافت تأیید نشده
            </strong>
          </div>
          <div class="summary-strip-item">
            <span>شناسه سند (Invoice ID):</span>
            <code class="cell-mono invoice-id-code">${inv.id}</code>
            <button type="button" class="copy-btn-inline" onclick="window.copyToClipboard('${inv.id}', 'شناسه فاکتور')" title="کپی شناسه فاکتور">
              کپی شناسه
            </button>
          </div>
          <div class="summary-strip-item">
            <span>مرجع تأیید:</span>
            <code class="cell-mono payment-ref-code">${inv.paymentRef || 'ثبت‌نشده'}</code>
            ${inv.paymentRef ? `
              <button type="button" class="copy-btn-inline" onclick="window.copyToClipboard('${inv.paymentRef}', 'مرجع پرداخت شاپرک')" title="کپی مرجع شاپرک">
                کپی مرجع
              </button>
            ` : ''}
          </div>
        </div>
      </div>

      <div class="surface-subtle" style="padding: 0.75rem; border-radius: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <span class="text-secondary" style="font-size: 0.75rem;">شناسه فاکتور:</span>
          <div style="display: flex; align-items: center; gap: 0.35rem;">
            <code class="nav-code">${inv.id}</code>
            <button type="button" class="copy-btn-inline" onclick="window.copyToClipboard('${inv.id}', 'شناسه فاکتور')" title="کپی شناسه فاکتور">کپی</button>
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <span class="text-secondary" style="font-size: 0.75rem;">مشتری طرف قرارداد:</span>
          <strong class="text-primary">${inv.tenantName}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <span class="text-secondary" style="font-size: 0.75rem;">دوره محاسباتی:</span>
          <span class="text-primary">${inv.period} (دوره ماهانه)</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <span class="text-secondary" style="font-size: 0.75rem;">وضعیت پرداخت:</span>
            <span class="badge badge-warning">
            Fixture؛ پرداخت شاپرک تأیید نشده
          </span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="text-secondary" style="font-size: 0.75rem;">مرجع تأیید شاپرک / کد رهگیری:</span>
          <div style="display: flex; align-items: center; gap: 0.35rem;">
            <code class="cell-mono">${inv.paymentRef || 'ثبت‌نشده (پیش‌فاکتور)'}</code>
            ${inv.paymentRef ? `<button type="button" class="copy-btn-inline" onclick="window.copyToClipboard('${inv.paymentRef}', 'کد رهگیری شاپرک')" title="کپی کد رهگیری">کپی</button>` : ''}
          </div>
        </div>
      </div>

      <div>
        <h4 style="font-size: 0.813rem; font-weight: 600; color: var(--text-primary); margin-bottom: 0.5rem;">اقلام و Snapshot ردیف‌های صورتحساب</h4>
        <div class="table-responsive" style="border: 1px solid var(--border-default); border-radius: 6px;">
          <table class="data-table" style="margin: 0; font-size: 0.775rem;" aria-label="جدول اقلام تفکیکی صورتحساب">
            <thead>
              <tr>
                <th>شرح خدمت / ماژول</th>
                <th>تعداد</th>
                <th>فی (تومان)</th>
                <th>مبلغ کل (تومان)</th>
              </tr>
            </thead>
            <tbody>
              ${(inv.items || []).map(item => `
                <tr>
                  <td>${item.desc}</td>
                  <td class="cell-mono">${item.count || 1}</td>
                  <td class="cell-mono">${(item.unitPrice || item.amount || 0).toLocaleString('fa-IR')} تومان</td>
                  <td class="cell-mono font-bold">${(item.total || item.amount || 0).toLocaleString('fa-IR')} تومان</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="surface-subtle" style="padding: 0.75rem; border-radius: 8px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 0.35rem; font-size: 0.813rem;">
          <span class="text-secondary">مبلغ خالص (پیش از مالیات):</span>
          <span class="cell-mono">${(inv.amount || 0).toLocaleString('fa-IR')} تومان</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 0.35rem; font-size: 0.813rem;">
          <span class="text-secondary">مالیات بر ارزش افزوده قانونی (۹٪):</span>
          <span class="cell-mono">${(inv.vatAmount || 0).toLocaleString('fa-IR')} تومان</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 0.95rem; border-top: 1px solid var(--border-subtle); padding-top: 0.4rem;">
          <span class="text-primary">مبلغ نهایی وصولی دوره:</span>
          <span class="cell-mono text-cyan">${(inv.totalAmount || 0).toLocaleString('fa-IR')} تومان</span>
        </div>
      </div>

      ${(inv.status === 'paid' && inv.activationStatus === 'pending_activation') ? `
        <div class="card" style="border: 1px solid #f59e0b; background: rgba(245, 158, 11, 0.08); border-radius: 8px; padding: 0.75rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.35rem; flex-wrap: wrap; gap: 0.5rem;">
            <strong style="color: #f59e0b; font-size: 0.813rem;">وضعیت Fixture: پرداخت و فعال‌سازی تأیید نشده</strong>
            <span class="badge badge-warning">نیازمند منبع مالی معتبر</span>
          </div>
          <p style="font-size: 0.75rem; color: var(--text-secondary); margin: 0 0 0.5rem 0;">
            این رکورد فقط Fixture است؛ ثبت در شاپرک، جلوگیری از خرید مجدد و فعال‌سازی باید با callback امضاشده و outbox واقعی ثابت شود.
          </p>
          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <button type="button" class="btn btn-warning btn-xs" onclick="window.trackActivation('${inv.id}')" style="font-weight: 700;">
              پیگیری فعال‌سازی (Retry)
            </button>
            <button type="button" class="btn btn-secondary btn-xs" onclick="window.createActivationTicket('${inv.id}')">
              ثبت تیکت خودکار پشتیبانی
            </button>
          </div>
        </div>
      ` : ''}

      <!-- Reconciliation & Settlement Audit (GODMODE GM-11 / Reconciliation Drawer Details) -->
      <div class="card reconciliation-details-card" style="border: 1px solid var(--border-default); border-radius: 8px; padding: 0.85rem; background: var(--bg-surface);">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.65rem; flex-wrap: wrap; gap: 0.5rem;">
          <div style="display: flex; align-items: center; gap: 0.4rem;">
            <span class="status-dot dot-active" style="background: ${inv.status === 'paid' ? '#10b981' : '#f59e0b'};"></span>
            <strong style="font-size: 0.813rem; color: var(--text-primary);">تطبیق و مغایرت‌گیری بانکی (Reconciliation):</strong>
          </div>
          <span class="badge ${inv.status === 'paid' ? 'badge-success' : 'badge-warning'}" style="font-size: 0.725rem;">
            وضعیت تطبیق ثبت نشده (Fixture)
          </span>
        </div>

        <div class="surface-subtle" style="padding: 0.65rem; border-radius: 6px; font-size: 0.75rem; display: flex; flex-direction: column; gap: 0.4rem;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="text-secondary">وضعیت تطبیق ۳طرفه:</span>
            <span class="cell-mono font-bold" style="color: ${inv.status === 'paid' ? '#10b981' : 'var(--text-secondary)'};">
              دادهٔ تطبیق سه‌طرفه موجود نیست
            </span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="text-secondary">مرجع تراکنش شاپرک (RRN):</span>
            <div style="display: flex; align-items: center; gap: 0.35rem;">
              <code class="cell-mono">${inv.paymentRef || 'ثبت‌نشده'}</code>
              ${inv.paymentRef ? `<button type="button" class="copy-btn-inline" onclick="window.copyToClipboard('${inv.paymentRef}', 'مرجع شاپرک')">کپی</button>` : ''}
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="text-secondary">سیکل تسویه پایا شاپرک:</span>
            <span class="cell-mono">${inv.status === 'paid' ? 'سیکل ۰۳:۴۵ بامداد شاپرک (پایا شماره ۹۴۸۱۲)' : 'در انتظار ارسال به شاپرک'}</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="text-secondary">سند حسابداری متناظر در دفتر کل:</span>
            <span class="cell-mono font-bold">سند حسابداری تأییدنشده</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="text-secondary">اختلاف ریالی (Discrepancy):</span>
            <strong style="color: #f59e0b;">نامشخص؛ مغایرت محاسبه نشده</strong>
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; margin-top: 0.5rem;">
          <button type="button" class="btn btn-secondary btn-xs" onclick="window.recheckReconciliation('${inv.id}')" title="استعلام مجدد وب‌سرویس تطبیق شاپرک">
            استعلام مجدد مغایرت‌گیری (Re-check)
          </button>
        </div>
      </div>

      <!-- Activation Events Timeline (GODMODE GM-11) -->
      <div>
        <h4 style="font-size: 0.813rem; font-weight: 600; color: var(--text-primary); margin-bottom: 0.5rem; display: flex; align-items: center; justify-content: space-between;">
          <span>رخدادهای فعال‌سازی و پروویژنینگ لایسنس</span>
          ${inv.activationStatus === 'pending_activation' 
            ? '<span class="badge badge-warning">در انتظار تکمیل استقرار</span>' 
            : '<span class="badge badge-warning">Fixture؛ لایسنس عملیاتی تأیید نشده</span>'}
        </h4>
        <div style="border: 1px solid var(--border-default); border-radius: 6px; padding: 0.75rem; background: var(--bg-surface);">
          <ul style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.65rem;">
            ${((inv.activationEvents && inv.activationEvents.length) ? inv.activationEvents : [
              { time: inv.paidAt || 'ثبت نشده', event: 'پرداخت شاپرک و ثبت در دفتر معین (سناریوی Fixture)', status: 'pending' },
              { time: 'ثبت نشده', event: 'تخصیص مجوزهای ماژول روی کلاستر (سناریوی Fixture)', status: 'pending' }
            ]).map((ev) => `
              <li style="display: flex; align-items: flex-start; gap: 0.65rem; font-size: 0.775rem;">
                <span class="status-dot dot-warning" style="margin-top: 4px;"></span>
                <div style="flex: 1;">
                  <div style="display: flex; justify-content: space-between; gap: 0.5rem;">
                    <strong style="color: var(--text-primary);">Fixture: ${ev.event}</strong>
                    <span class="cell-mono text-secondary" style="font-size: 0.725rem;">${ev.time}</span>
                  </div>
                  ${ev.note ? `<div style="font-size: 0.725rem; color: #f59e0b; margin-top: 0.15rem;">${ev.note}</div>` : ''}
                </div>
              </li>
            `).join('')}
          </ul>
        </div>
      </div>

      <!-- Drawer Actions -->
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; margin-top: 0.5rem; flex-wrap: wrap;">
        <div style="display: flex; gap: 0.5rem;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="window.printInvoice('${inv.id}')">
            چاپ سند رسمی
          </button>
          ${inv.status === 'paid' ? `
            <button type="button" class="btn btn-secondary btn-sm" onclick="window.openGM11RefundDrawer('${inv.id}')">
              محاسبه و استرداد (Refund)
            </button>
          ` : ''}
        </div>
        ${(inv.status === 'paid' && inv.activationStatus === 'pending_activation') ? `
          <button type="button" class="btn btn-warning btn-sm" onclick="window.trackActivation('${inv.id}')" style="font-weight: 700;">
            پیگیری و تکمیل فعال‌سازی
          </button>
        ` : ''}
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openDrawer) {
    window.GMApp.openDrawer(`شناسنامه و وضعیت فاکتور: ${inv.id}`, content);
  }
};

window.trackActivation = function(invoiceId) {
  const store = window.prototypeStore || window.GMStore;
  const inv = store && store.getInvoice ? store.getInvoice(invoiceId) : null;
  if (!inv) return;

  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <!-- Invoice Summary Strip -->
      <div class="summary-strip invoice-summary-strip" role="region" aria-label="خلاصه فعال‌سازی، تازگی و مرجع پرداخت" style="margin-bottom: 0.25rem;">
        <div class="summary-strip-group">
          <div class="summary-strip-item">
            <span class="status-dot dot-warning"></span>
            <span>وضعیت استقرار: <strong>در انتظار هارت‌بیت</strong></span>
            <span style="font-size:0.75rem; color:var(--text-tertiary);">• تازگی داده: ثبت نشده؛ Fixture</span>
          </div>
          <div class="summary-strip-item">
            <span>شناسه سند:</span>
            <code class="cell-mono invoice-id-code">${inv.id}</code>
            <button type="button" class="copy-btn-inline" onclick="window.copyToClipboard('${inv.id}', 'شناسه فاکتور')" title="کپی شناسه فاکتور">
              کپی شناسه
            </button>
          </div>
          <div class="summary-strip-item">
            <span>مرجع پرداخت:</span>
            <code class="cell-mono payment-ref-code">${inv.paymentRef}</code>
            <button type="button" class="copy-btn-inline" onclick="window.copyToClipboard('${inv.paymentRef}', 'مرجع پرداخت شاپرک')" title="کپی مرجع شاپرک">
              کپی مرجع
            </button>
          </div>
        </div>
      </div>

      <div class="card" style="border: 1px solid #f59e0b; background: rgba(245, 158, 11, 0.05); padding: 0.85rem; border-radius: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span class="status-dot dot-warning"></span>
            <strong style="color: #f59e0b; font-size: 0.85rem;">وضعیت Fixture: پرداخت و فعال‌سازی تأیید نشده</strong>
          </div>
          <span class="badge badge-warning">نیازمند دادهٔ معتبر</span>
        </div>
        <p style="font-size: 0.775rem; color: var(--text-secondary); margin: 0 0 0.5rem 0;">
          این رکورد مالی فقط Fixture است؛ تسویه، کد رهگیری و هارت‌بیت مقصد در محیط عملیاتی تأیید نشده‌اند.
        </p>
        <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 6px; padding: 0.5rem 0.75rem; font-size: 0.75rem; color: #065f46;">
          <strong>هشدار:</strong> برای جلوگیری از پرداخت تکراری، ابتدا callback امضاشده و idempotency واقعی بررسی شود؛ این صفحه مجوز خرید یا استرداد صادر نمی‌کند.
        </div>
      </div>

      <div class="surface-subtle" style="padding: 0.75rem; border-radius: 8px; font-size: 0.8rem;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
          <span class="text-secondary">مشتری ذی‌نفع:</span>
          <strong>${inv.tenantName}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
          <span class="text-secondary">سرور زیرساخت:</span>
          <span class="cell-mono">vps.neem.ir (سرور متمرکز VPS)</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
          <span class="text-secondary">اتصال عملیاتی:</span>
          <span class="cell-mono text-success">عملیاتی (فعال روی VPS)</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span class="text-secondary">ماژول خریداری‌شده:</span>
          <span class="badge badge-cyan">${(inv.items && inv.items[0]) ? inv.items[0].desc : 'افزونه هوش مصنوعی'}</span>
        </div>
      </div>

      <div>
        <h4 style="font-size: 0.813rem; font-weight: 600; margin-bottom: 0.5rem;">گام‌های اجرای پروویژنینگ</h4>
        <div style="border: 1px solid var(--border-default); border-radius: 6px; padding: 0.75rem; background: var(--bg-surface);">
          <ul style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.775rem;">
            <li style="display: flex; gap: 0.5rem; align-items: center;">
              <span class="badge-dot dot-success"></span>
              <span>تسویه ریالی و ثبت سند درگاه بانکی شاپرک</span>
            </li>
            <li style="display: flex; gap: 0.5rem; align-items: center;">
              <span class="badge-dot dot-success"></span>
              <span>تولید جاب پروویژنینگ در صف کارهای زیرساختی (Job Tracer)</span>
            </li>
            <li style="display: flex; gap: 0.5rem; align-items: center;">
              <span class="badge-dot dot-warning"></span>
              <span>اعمال توکن لایسنس روی کانتینر سرویس در سرور متمرکز VPS</span>
            </li>
          </ul>
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; margin-top: 0.5rem; flex-wrap: wrap;">
        <button type="button" class="btn btn-secondary btn-sm" onclick="window.createActivationTicket('${inv.id}')" title="صدور تیکت سیستمی برای تیم پشتیبانی">
          🎫 ثبت تیکت خودکار پشتیبانی
        </button>
        <div style="display: flex; gap: 0.5rem;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="window.GMApp && window.GMApp.closeDrawer ? window.GMApp.closeDrawer() : (window.GMApp && window.GMApp.closeModal ? window.GMApp.closeModal() : null)">
            بستن
          </button>
          <button type="button" class="btn btn-primary btn-sm" onclick="window.confirmCompleteActivation('${inv.id}')">
            تلاش مجدد استقرار (Retry) و تکمیل فعال‌سازی
          </button>
        </div>
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openDrawer) {
    window.GMApp.openDrawer(`پیگیری فعال‌سازی: ${inv.id}`, content);
  } else if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal(`پیگیری فعال‌سازی: ${inv.id}`, content);
  }
};

window.confirmCompleteActivation = function(invoiceId) {
  const store = window.prototypeStore || window.GMStore;
  if (store && store.activatePendingInvoice) {
    store.activatePendingInvoice(invoiceId);
  }
  if (window.GMApp && window.GMApp.closeDrawer) window.GMApp.closeDrawer();
  if (window.GMApp && window.GMApp.closeModal) window.GMApp.closeModal();
  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast(`درخواست فعال‌سازی ماژول ${invoiceId} فقط در Mock ثبت شد؛ سرویس مقصد تغییر نکرد.`, 'info');
  }
  if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
    window.GMRouter.refresh();
  }
};

window.openGM11RenewalPreview = function(subId) {
  const store = window.prototypeStore || window.GMStore;
  const preview = store && store.previewRenewal ? store.previewRenewal(subId) : null;
  if (!preview) return;

  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div class="surface-subtle" style="padding: 0.75rem; border-radius: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
          <span class="text-secondary" style="font-size: 0.75rem;">پلن اشتراک:</span>
          <strong>${preview.planName}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
          <span class="text-secondary" style="font-size: 0.75rem;">دوره تمدید:</span>
          <span class="badge badge-primary">${preview.cycle} (۳۰ روزه)</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
          <span class="text-secondary" style="font-size: 0.75rem;">سررسید فعلی:</span>
          <span class="cell-mono">${preview.currentRenewal}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="text-secondary" style="font-size: 0.75rem;">موعد سررسید پس از تمدید:</span>
          <strong class="cell-mono text-cyan">${preview.projectedRenewal}</strong>
        </div>
      </div>

      <div style="border: 1px solid var(--border-default); border-radius: 8px; padding: 0.75rem; background: var(--bg-surface);">
        <h4 style="font-size: 0.813rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">
          پیش‌نمایش دوره و کسر اعتبار کیف‌پول
        </h4>
        <div style="display: flex; flex-direction: column; gap: 0.4rem; font-size: 0.8rem;">
          <div style="display: flex; justify-content: space-between;">
            <span class="text-secondary">مبلغ ناخالص تمدید دوره (پلن + ۴ افزونه):</span>
            <span class="cell-mono">${preview.grossAmount.toLocaleString('fa-IR')} تومان</span>
          </div>
          <div style="display: flex; justify-content: space-between; color: #10b981;">
            <span>کسر اعتبار از کیف‌پول مشتری:</span>
            <span class="cell-mono">-${preview.creditDeduction.toLocaleString('fa-IR')} تومان</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span class="text-secondary">مبلغ مشمول مالیات:</span>
            <span class="cell-mono">${preview.netBeforeTax.toLocaleString('fa-IR')} تومان</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span class="text-secondary">مالیات بر ارزش افزوده (۹٪):</span>
            <span class="cell-mono">${preview.vatAmount.toLocaleString('fa-IR')} تومان</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 0.95rem; border-top: 1px solid var(--border-subtle); padding-top: 0.4rem; margin-top: 0.2rem;">
            <span class="text-primary">مبلغ نهایی قابل پرداخت:</span>
            <span class="cell-mono text-cyan">${preview.finalAmount.toLocaleString('fa-IR')} تومان</span>
          </div>
        </div>
      </div>

      <div class="card" style="background: var(--bg-surface-subtle); padding: 0.65rem; border-radius: 6px; font-size: 0.775rem;">
        <span class="text-secondary">اعتبار باقی‌مانده در کیف‌پول مشتری پس از این عملیات:</span>
        <strong class="cell-mono" style="color: var(--accent-cyan); margin-right: 0.35rem;">
          ${preview.remainingCredit.toLocaleString('fa-IR')} تومان
        </strong>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.5rem;">
        <button type="button" class="btn btn-secondary btn-sm" onclick="window.GMApp && window.GMApp.closeModal ? window.GMApp.closeModal() : (window.GMApp && window.GMApp.closeDrawer ? window.GMApp.closeDrawer() : null)">
          انصراف
        </button>
        <button type="button" class="btn btn-primary btn-sm" onclick="window.confirmRenewal('${preview.subscriptionId}')">
          تایید و صدور فاکتور تمدید دوره
        </button>
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal('پیش‌نمایش تمدید دوره اشتراک', content);
  } else if (window.GMApp && window.GMApp.openDrawer) {
    window.GMApp.openDrawer('پیش‌نمایش تمدید دوره اشتراک', content);
  }
};

window.confirmRenewal = function(subId) {
  if (window.GMApp && window.GMApp.closeModal) window.GMApp.closeModal();
  if (window.GMApp && window.GMApp.closeDrawer) window.GMApp.closeDrawer();
  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast('سناریوی تمدید اشتراک فقط در Mock ثبت شد؛ قرارداد یا فاکتور رسمی تغییر نکرد.', 'info');
  }
  if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
    window.GMRouter.refresh();
  }
};

window.openGM11RefundDrawer = function(invoiceId) {
  const store = window.prototypeStore || window.GMStore;
  const preview = store && store.previewRefund ? store.previewRefund(invoiceId) : null;
  if (!preview) return;

  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div class="surface-subtle" style="padding: 0.75rem; border-radius: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
          <span class="text-secondary" style="font-size: 0.75rem;">شناسه فاکتور مبدأ:</span>
          <code class="nav-code">${preview.invoiceId}</code>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
          <span class="text-secondary" style="font-size: 0.75rem;">دوره محاسباتی فاکتور:</span>
          <strong class="text-primary">${preview.period}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="text-secondary" style="font-size: 0.75rem;">کل مبلغ پرداختی مشتری:</span>
          <span class="cell-mono font-bold">${preview.totalPaid.toLocaleString('fa-IR')} تومان</span>
        </div>
      </div>

      <div style="border: 1px solid var(--border-default); border-radius: 8px; padding: 0.75rem; background: var(--bg-surface);">
        <h4 style="font-size: 0.813rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">
          محاسبه اثر حق استفاده و مبلغ قابل استرداد (Refund Policy)
        </h4>
        <div style="display: flex; flex-direction: column; gap: 0.4rem; font-size: 0.8rem;">
          <div style="display: flex; justify-content: space-between;">
            <span class="text-secondary">کل دوره لایسنس:</span>
            <span>${preview.totalDays} روز</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span class="text-secondary">روزهای سپری‌شده و مصرف‌شده:</span>
            <span>${preview.usedDays} روز (${preview.usageRatioPercent}٪ مصرف دوره)</span>
          </div>
          <div style="display: flex; justify-content: space-between; color: #ef4444;">
            <span>کسر حق استفاده بابت روزهای مصرف:</span>
            <span class="cell-mono">-${preview.usageCost.toLocaleString('fa-IR')} تومان</span>
          </div>
          <div style="display: flex; justify-content: space-between; color: #ef4444;">
            <span>کارمزد تراکنش بانکی و ابطال پایا:</span>
            <span class="cell-mono">-${preview.gatewayFee.toLocaleString('fa-IR')} تومان</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 0.95rem; border-top: 1px solid var(--border-subtle); padding-top: 0.4rem; margin-top: 0.2rem;">
            <span class="text-primary">مبلغ خالص قابل استرداد به مشتری:</span>
            <strong class="cell-mono text-cyan">${preview.refundableAmount.toLocaleString('fa-IR')} تومان</strong>
          </div>
        </div>
      </div>

      <div class="surface-subtle" style="padding: 0.75rem; border-radius: 8px; font-size: 0.775rem;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 0.35rem;">
          <span class="text-secondary">کارت مرجع شاپرک جهت واریز:</span>
          <span class="cell-mono">${preview.targetCard}</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 0.35rem;">
          <span class="text-secondary">شماره شبا مقصد:</span>
          <span class="cell-mono">${preview.targetSheba}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span class="text-secondary">شناسه پیگیری استرداد:</span>
          <code class="cell-mono">${preview.refundRef}</code>
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.5rem;">
        <button type="button" class="btn btn-secondary btn-sm" onclick="window.GMApp && window.GMApp.closeDrawer ? window.GMApp.closeDrawer() : (window.GMApp && window.GMApp.closeModal ? window.GMApp.closeModal() : null)">
          انصراف
        </button>
        <button type="button" class="btn btn-primary btn-sm" onclick="window.confirmRefund('${preview.invoiceId}', ${preview.refundableAmount})">
          تایید و اجرای استرداد بانکی (Refund)
        </button>
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openDrawer) {
    window.GMApp.openDrawer(`استرداد وجه و لغو لایسنس: ${preview.invoiceId}`, content);
  } else if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal(`استرداد وجه: ${preview.invoiceId}`, content);
  }
};

window.confirmRefund = function(invId, amount) {
  if (window.GMApp && window.GMApp.closeDrawer) window.GMApp.closeDrawer();
  if (window.GMApp && window.GMApp.closeModal) window.GMApp.closeModal();
  const store = window.prototypeStore || window.GMStore;
  if (store && store.addActivity) {
    store.addActivity({
      type: 'refund_issued',
      severity: 'warning',
      title: `استرداد وجه فاکتور ${invId}`,
      description: `درخواست استرداد ${amount.toLocaleString('fa-IR')} تومان فقط در Fixture ثبت شد؛ انتقال بانکی انجام نشد.`,
      subsystem: 'Billing',
      route: '#gm-11-billing?tab=invoices',
      routeLabel: 'صورتحساب و مالی',
      actor: 'SuperAdmin'
    });
  }
  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast(`درخواست استرداد فاکتور ${invId} فقط در Mock ثبت شد؛ انتقال بانکی انجام نشده است.`, 'info');
  }
  if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
    window.GMRouter.refresh();
  }
};

window.payGM11Invoice = function(invoiceId) {
  const store = window.prototypeStore || window.GMStore;
  const inv = store && store.payInvoice ? store.payInvoice(invoiceId) : null;
  if (inv) {
    const msg = `سناریوی پرداخت فاکتور ${invoiceId} فقط در Mock ثبت شد؛ کد رهگیری بانکی معتبر تولید نشده است.`;
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast(msg, 'info');
    }
    if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
      window.GMRouter.refresh();
    } else if (window.GMRouter && typeof window.GMRouter.handleRoute === 'function') {
      window.GMRouter.handleRoute();
    }
  }
};

window.exportAccountingLedger = function(tenantId) {
  const store = window.prototypeStore || window.GMStore;
  const perm = store && store.checkAccountingPermission ? store.checkAccountingPermission() : { allowed: true };
  if (!perm.allowed) {
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast('خطای دسترسی: خروجی اسناد حسابداری نیازمند مجوز FIN_ACCOUNTING_EXPORT می‌باشد.', 'error');
    }
    return;
  }

  const invoices = store ? store.getInvoices(tenantId) : [];
  const totalAmount = invoices.reduce((s, i) => s + (i.totalAmount || 0), 0);
  const totalVat = invoices.reduce((s, i) => s + (i.vatAmount || 0), 0);
  const netAmount = invoices.reduce((s, i) => s + (i.amount || 0), 0);

  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div style="border: 2px solid var(--border-default); border-radius: 8px; padding: 1rem; background: var(--bg-surface);">
        <div style="text-align: center; border-bottom: 2px solid var(--border-subtle); padding-bottom: 0.75rem; margin-bottom: 0.75rem;">
          <h3 style="margin: 0 0 0.25rem 0; font-size: 1rem; color: var(--text-primary);">دفتر کل و خلاصه تراز مالیاتی پلتفرم ابری NEEM</h3>
          <p style="margin: 0; font-size: 0.75rem; color: var(--text-secondary);">پیش‌نمایش محلی؛ گزارش رسمی مودیان و ارزش افزوده صادر نشده است.</p>
          <div style="display: flex; justify-content: center; gap: 1rem; margin-top: 0.5rem; font-size: 0.75rem; flex-wrap: wrap;">
            <span>کد مجوز ممیزی: <code>${perm.permissionCode || 'FIN_ACCOUNTING_EXPORT'}</code></span>
            <span>ممیز صادرکننده: <strong>${perm.operator || 'SuperAdmin'}</strong></span>
            <span>کد حوزه مالیاتی: <code>${perm.taxOfficeCode || '1403-MHD-09'}</code></span>
          </div>
        </div>

        <div class="table-responsive" style="margin-bottom: 1rem;">
          <table class="data-table" style="font-size: 0.775rem;">
            <thead>
              <tr>
                <th>کد معین</th>
                <th>شرح سرفصل حسابداری</th>
                <th>بدهکار (تومان)</th>
                <th>بستانکار (تومان)</th>
                <th>وضعیت تطبیق</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="cell-mono">1101-01</td>
                <td>موجودی نقد و بانک‌ها (تسویه شاپرک)</td>
                <td class="cell-mono">${totalAmount.toLocaleString('fa-IR')}</td>
                <td class="cell-mono">۰</td>
                <td><span class="badge badge-warning">Fixture؛ تطبیق نشده</span></td>
              </tr>
              <tr>
                <td class="cell-mono">4102-04</td>
                <td>درآمد فروش اشتراک نرم‌افزار و افزونه‌ها</td>
                <td class="cell-mono">۰</td>
                <td class="cell-mono">${netAmount.toLocaleString('fa-IR')}</td>
                <td><span class="badge badge-warning">Fixture؛ تسویه نشده</span></td>
              </tr>
              <tr>
                <td class="cell-mono">2105-09</td>
                <td>مالیات بر ارزش افزوده وصولی (سازمان امور مالیاتی)</td>
                <td class="cell-mono">۰</td>
                <td class="cell-mono">${totalVat.toLocaleString('fa-IR')}</td>
                <td><span class="badge badge-warning">Fixture؛ آماده ارسال نیست</span></td>
              </tr>
            </tbody>
            <tfoot>
              <tr style="font-weight: 700; background: var(--bg-surface-subtle);">
                <td colspan="2">جمع تراز دفاتر:</td>
                <td class="cell-mono text-cyan">${totalAmount.toLocaleString('fa-IR')} تومان</td>
                <td class="cell-mono text-cyan">${totalAmount.toLocaleString('fa-IR')} تومان</td>
                <td><span class="badge badge-warning">Fixture؛ تراز تأیید نشده</span></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: var(--text-secondary); border-top: 1px dashed var(--border-subtle); padding-top: 0.5rem;">
          <span>ممهور به امضای دیجیتال گواهی NEEM Cloud PKI</span>
          <span>تعداد اسناد مشمول: ${invoices.length} سند فاکتور</span>
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
        <button type="button" class="btn btn-secondary btn-sm" onclick="window.GMApp && window.GMApp.closeModal ? window.GMApp.closeModal() : null">
          بستن
        </button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="window.print();">
          چاپ سند حسابداری (Print)
        </button>
        <button type="button" class="btn btn-primary btn-sm" onclick="window.GMApp && window.GMApp.showToast ? window.GMApp.showToast('فایل استاندارد صورتحساب الکترونیکی سامانه مودیان تولید و به کارپوشه مالیاتی ارسال شد.', 'success') : null;">
          ارسال به سامانه مودیان (تطبیق کارپوشه)
        </button>
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal('خروجی و چاپ حسابداری رسمی NEEM (مجوز مستقل)', content);
  }
};

window.printInvoice = function(invoiceId) {
  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast(`دستور صدور نسخه چاپی و دریافت PDF فاکتور ${invoiceId} با مهر دیجیتال صادر شد.`, 'success');
  }
};

window.sendDebtReminder = function(debtId) {
  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast(`پیامک یادآوری پرداخت و لینک تسویه بدهی (${debtId}) با موفقیت برای مشتری ارسال شد.`, 'success');
  }
};

window.promptIssueManualInvoice = function(tenantId) {
  const store = window.prototypeStore || window.GMStore;
  const tid = tenantId || (store ? store.getActiveTenantId() : 'tnt_westo_demo');
  const tenant = (store && store.getTenant ? store.getTenant(tid) : null) || { name: 'مشتری' };

  const modalHtml = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div class="form-group">
        <label class="form-label" for="manual-inv-tenant">مشتری طرف قرارداد:</label>
        <input type="text" id="manual-inv-tenant" class="form-control" value="${tenant.name}" readonly style="background: var(--bg-surface-subtle);" />
      </div>
      <div class="form-group">
        <label class="form-label" for="manual-inv-desc">شرح فاکتور و خدمات:</label>
        <input type="text" id="manual-inv-desc" class="form-control" value="تمدید اشتراک دوره جاری و خدمات ابری" />
        <div class="form-hint">شرحی که روی فاکتور رسمی درج می‌گردد.</div>
      </div>
      <div class="form-group">
        <label class="form-label" for="manual-inv-amount">مبلغ خالص (تومان):</label>
        <input type="number" id="manual-inv-amount" class="form-control cell-mono" value="4500000" />
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.5rem;">
        <button type="button" class="btn btn-secondary btn-sm" onclick="window.GMApp && window.GMApp.closeModal ? window.GMApp.closeModal() : null">
          انصراف
        </button>
        <button type="button" class="btn btn-primary btn-sm" id="btnSubmitManualInvoice" onclick="window.submitManualInvoice('${tid}')">
          صدور و ثبت فاکتور
        </button>
      </div>
    </div>
  `;

  if (window.GMApp && typeof window.GMApp.openModal === 'function') {
    window.GMApp.openModal('صدور فاکتور دوره‌ای جدید', modalHtml);
  } else {
    window.submitManualInvoice(tid, 'تمدید اشتراک دوره جاری و خدمات ابری', 4500000);
  }
};

window.submitManualInvoice = function(tenantId, descArg, amountArg) {
  const store = window.prototypeStore || window.GMStore;
  const tid = tenantId || (store ? store.getActiveTenantId() : 'tnt_westo_demo');
  const tenant = (store && store.getTenant ? store.getTenant(tid) : null) || { name: 'مشتری' };

  const descEl = document.getElementById('manual-inv-desc');
  const amountEl = document.getElementById('manual-inv-amount');
  const desc = descArg || (descEl ? descEl.value : '') || 'تمدید اشتراک دوره جاری و خدمات ابری';
  const amount = amountArg || (amountEl ? Number(amountEl.value) : 4500000) || 4500000;
  const vat = Math.round(amount * 0.09);

  const newInv = {
    id: 'INV-' + Date.now().toString().slice(-5),
    tenantId: tid,
    tenantName: tenant.name,
    period: 'شهریور ۱۴۰۳ (دستی)',
    amount: amount,
    vatAmount: vat,
    totalAmount: amount + vat,
    status: 'paid',
    activationStatus: 'activated',
    paidAt: 'هم‌اکنون (تسویه مستقیم)',
    paymentRef: 'SHP-' + Math.floor(100000000 + Math.random() * 900000000),
    items: [
      { desc: desc, count: 1, unitPrice: amount, total: amount }
    ],
    activationEvents: [
      { time: 'هم‌اکنون', event: 'صدور فاکتور دستی و ثبت در دفتر معین', status: 'done' }
    ]
  };

  if (store && store.state && Array.isArray(store.state.invoices)) {
    store.state.invoices.unshift(newInv);
    store.save();
    store.addActivity({
      type: 'invoice_issued',
      severity: 'info',
      title: `صدور فاکتور دستی برای ${tenant.name}`,
      description: `صورتحساب رسمی ${newInv.id} به مبلغ ${(amount + vat).toLocaleString('fa-IR')} تومان ثبت شد.`,
      subsystem: 'Billing',
      route: '#gm-11-billing?tab=invoices',
      routeLabel: 'صورتحساب و مالی',
      actor: 'SuperAdmin'
    });
  }

  if (window.GMApp && window.GMApp.closeModal) {
    window.GMApp.closeModal();
  }
  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast(`صورتحساب «${newInv.id}» برای ${tenant.name} فقط در Fixture محلی ثبت شد؛ سند رسمی صادر نشده است.`, 'info');
  }
  if (window.location && window.GMRouter && typeof window.GMRouter.handleRoute === 'function') {
    window.GMRouter.handleRoute();
  }
};

window.GMViews.GM11 = {
  render(params) {
    return window.renderGM11(params);
  },
  statusFilter: 'all',
  query: '',
  tableSelect: null,

  afterRender() {
    this.initSelection();
  },

  initSelection() {
    if (window.GMTableSelect) {
      this.tableSelect = window.GMTableSelect.initTable('#invoicesTable', {
        selectAllSelector: '#invoices-select-all',
        rowCheckboxSelector: '.invoice-row-select',
        bulkBarId: 'gm11-bulk-actions',
        countBadgeId: 'gm11-bulk-count'
      });
    }
  },

  clearSelection() {
    if (this.tableSelect) {
      this.tableSelect.clear();
    }
  },

  applyFilters() {
    const rows = document.querySelectorAll('#invoicesTable tbody tr');
    let visibleCount = 0;
    let totalCount = 0;

    rows.forEach(r => {
      if (r.id === 'invoices-empty-row') return;
      totalCount++;
      const status = r.getAttribute('data-status');
      const activation = r.getAttribute('data-activation') || '';
      const text = (r.getAttribute('data-search') || '').toLowerCase();

      let statusMatches = (this.statusFilter === 'all');
      if (this.statusFilter === 'paid') {
        statusMatches = (status === 'paid');
      } else if (this.statusFilter === 'pending') {
        statusMatches = (status === 'pending');
      } else if (this.statusFilter === 'pending_activation') {
        statusMatches = (activation === 'pending_activation');
      } else if (this.statusFilter !== 'all') {
        statusMatches = (status === this.statusFilter);
      }

      const searchMatches = (!this.query || text.includes(this.query));

      if (statusMatches && searchMatches) {
        r.style.display = '';
        visibleCount++;
      } else {
        r.style.display = 'none';
      }
    });

    const emptyRow = document.getElementById('invoices-empty-row');
    if (emptyRow) emptyRow.style.display = visibleCount === 0 ? '' : 'none';

    const countBadge = document.getElementById('invoicesFilterCount');
    if (countBadge) {
      countBadge.textContent = `نمایش ${visibleCount.toLocaleString('fa-IR')} از ${totalCount.toLocaleString('fa-IR')} صورتحساب`;
    }

    const wrapper = document.getElementById('invoiceSearchWrapper');
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
    document.querySelectorAll('#invoiceStatusFilters .filter-chip').forEach(el => {
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
    const input = document.getElementById('invoiceSearchInput');
    if (input) input.value = '';
    this.setQuery('');
  },

  resetAll() {
    this.statusFilter = 'all';
    const firstChip = document.querySelector('#invoiceStatusFilters .filter-chip');
    if (firstChip) {
      document.querySelectorAll('#invoiceStatusFilters .filter-chip').forEach(el => {
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

  bulkPaySelected() {
    const ids = this.tableSelect ? this.tableSelect.getSelectedIds() : [];
    if (ids.length === 0) {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast('لطفاً ابتدا حداقل یک صورتحساب را انتخاب فرمایید.', 'warning');
      }
      return;
    }
    const store = window.prototypeStore || window.GMStore;
    let paidCount = 0;
    ids.forEach(id => {
      if (store && store.payInvoice) {
        store.payInvoice(id);
        paidCount++;
      }
    });
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast(`تسویه ${paidCount} صورتحساب فقط در Mock پلتفرم ثبت شد.`, 'info');
    }
    if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
      window.GMRouter.refresh();
    }
  },

  bulkExportSelected() {
    const ids = this.tableSelect ? this.tableSelect.getSelectedIds() : [];
    if (ids.length === 0) {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast('لطفاً ابتدا حداقل یک صورتحساب را انتخاب فرمایید.', 'warning');
      }
      return;
    }
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast(`فهرست صورتحساب‌ها در پیش‌نمایش Mock پلتفرم آماده شد.`, 'info');
    }
  }
};
