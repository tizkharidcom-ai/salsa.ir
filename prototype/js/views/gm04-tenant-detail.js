/**
 * prototype/js/views/gm04-tenant-detail.js
 * 
 * GM-04: پرونده جامع و ۳۶۰ درجه مشتری (/tenants/:tenantId)
 * با ناوبری درجا (In-Place Tabs) بدون پرش به روت‌های دیگر
 */

const DOSSIER_TAB_LABELS = Object.freeze({
  summary: 'خلاصه و شناسنامه',
  features: 'امکانات و لایسنس‌ها',
  users: 'کاربران و پرسنل',
  identities: 'حساب‌ها و نشست‌ها',
  access: 'نقش‌ها و دسترسی‌ها',
  simulator: 'آزمایش دسترسی',
  customers: 'مشتریان نهایی',
  billing: 'مالی و صورتحساب‌ها',
  usage: 'سهمیه و مصرف',
  devices: 'دستگاه‌ها و پوز',
  backups: 'پشتیبان‌گیری ایزوله',
  portal: 'قرارداد و پورتال',
  provisioning: 'راه‌اندازی و تحویل',
  domains: 'تنظیمات مشتری',
  support: 'تیکت‌های پشتیبانی',
  audit: 'لاگ ممیزی'
});

function normalizeDossierTab(tabName) {
  return Object.prototype.hasOwnProperty.call(DOSSIER_TAB_LABELS, tabName) ? tabName : 'summary';
}

function renderDossierPortalPanel(tenant, store, activeTab) {
  const content = typeof window.renderGM28Panel === 'function'
    ? window.renderGM28Panel({ tenant, store, id: tenant.id })
    : `<div class="empty-state" role="status"><h3>بخش قرارداد و پورتال آماده نیست</h3><p>ماژول پرونده مشتری دوباره بارگذاری شود.</p></div>`;
  return `
    <div class="dossier-panel" data-panel="portal" style="display: ${activeTab === 'portal' ? 'block' : 'none'};">
      <div class="dossier-section-intro">
        <strong>قرارداد و پورتال همین مشتری</strong>
        <span>اشتراک، فاکتورها، سهمیه و درخواست‌های پشتیبانی در همین کارتابل مدیریت می‌شوند.</span>
      </div>
      ${content}
    </div>`;
}

function renderEmbeddedDossierPanel(panel, activeTab, renderer, params) {
  let content = '<div class="empty-state"><h3>این بخش در دسترس نیست</h3><p>ماژول مربوطه بارگذاری نشده است.</p></div>';
  try {
    if (typeof renderer === 'function') content = renderer({ ...params, embedded: true });
  } catch (_error) {
    content = '<div class="alert alert-danger" role="alert">نمایش این بخش با خطا روبه‌رو شد.</div>';
  }
  return `<div class="dossier-panel dossier-embedded-view" data-panel="${panel}" style="display:${activeTab === panel ? 'block' : 'none'}">${content}</div>`;
}

window.switchDossierTab = function(tabName) {
  const normalizedTab = normalizeDossierTab(tabName);
  const hash = window.location.hash || '#gm-04-tenant-detail';
  const [baseRoute, queryString] = hash.split('?');
  const params = new URLSearchParams(queryString || '');
  params.set('tab', normalizedTab);
  const nextHash = `#${baseRoute.replace(/^#\/?/, '')}?${params.toString()}`;
  const compactHash = window.GMRouter && typeof window.GMRouter.compactHash === 'function'
    ? window.GMRouter.compactHash(nextHash)
    : nextHash;
  
  // Replace hash smoothly without triggering a full route re-render
  if (window.history && typeof window.history.replaceState === 'function') {
    window.history.replaceState(null, '', compactHash);
  }

  // Update tab links active state
  document.querySelectorAll('.dossier-tab-btn').forEach(btn => {
    const isTarget = btn.getAttribute('data-tab') === normalizedTab;
    btn.classList.toggle('active', isTarget);
    if (isTarget) {
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.removeAttribute('aria-current');
    }
  });

  // Switch visible panel in-place
  document.querySelectorAll('.dossier-panel').forEach(panel => {
    const isTarget = panel.getAttribute('data-panel') === normalizedTab;
    panel.style.display = isTarget ? 'block' : 'none';
  });

  const breadcrumbCurrent = document.querySelector('[data-breadcrumb-context="customer-dossier"] .breadcrumb-current');
  if (breadcrumbCurrent) {
    breadcrumbCurrent.textContent = DOSSIER_TAB_LABELS[normalizedTab];
    breadcrumbCurrent.title = DOSSIER_TAB_LABELS[normalizedTab];
  }
};

function getDossierProvisioningJob(store, tenant) {
  const jobs = store && typeof store.getJobs === 'function' ? store.getJobs() : [];
  return jobs.find(job => job.tenantId === tenant.id) || {
    id: `job_provision_${tenant.id}`,
    tenantId: tenant.id,
    tenantName: tenant.name,
    status: 'pending',
    step: 'در انتظار شروع راه‌اندازی',
    progressPercent: 0,
    retryCount: 0,
    maxRetries: 3,
    errorMessage: null,
    steps: []
  };
}

function renderDossierProvisioningPanel(tenant, store, activeTab) {
  const job = getDossierProvisioningJob(store, tenant);
  const progress = Math.max(0, Math.min(100, Number(job.progressPercent || job.progress || 0)));
  const status = job.status === 'failed' ? 'failed' : job.status === 'completed' ? 'completed' : job.status === 'running' ? 'running' : 'pending';
  const statusLabel = status === 'failed' ? 'نیازمند اقدام' : status === 'completed' ? 'تکمیل‌شده' : status === 'running' ? 'در حال پردازش' : 'در انتظار شروع';
  const steps = (job.steps && job.steps.length) ? job.steps : [
    { name: 'اعتبارسنجی دامنه و یکتایی نام تجاری', status: 'completed' },
    { name: 'ایجاد ساختار اولیه حساب خام از قالب پایه', status: 'completed' },
    { name: 'تخصیص سهمیه دیتابیس ایزوله', status: status === 'failed' ? 'failed' : status === 'running' ? 'running' : 'completed' },
    { name: 'ارسال دعوت مالک و تحویل دسترسی', status: status === 'completed' ? 'completed' : 'pending' }
  ];
  const completedSteps = steps.filter(step => step.status === 'completed').length;
  const jobId = esc(job.id);
  return `
    <!-- TAB 2: PROVISIONING PANEL — CUSTOMER DOSSIER -->
    <div class="dossier-panel" data-panel="provisioning" style="display: ${activeTab === 'provisioning' ? 'block' : 'none'};">
      <section class="op-context-banner ${status === 'failed' ? 'op-context-danger' : status === 'completed' ? 'op-context-success' : 'op-context-info'}" aria-labelledby="dossier-provisioning-title">
        <div class="op-context-header">
          <div>
            <h2 id="dossier-provisioning-title" style="margin: 0; font-size: 1.05rem;">راه‌اندازی و تحویل همین مشتری</h2>
            <p style="margin: .25rem 0 0; color: var(--text-secondary);">تمام وضعیت آماده‌سازی، خطاها و تحویل دسترسی در پرونده ${esc(tenant.name)} نگهداری می‌شود.</p>
          </div>
          <span class="badge ${status === 'failed' ? 'badge-danger' : status === 'completed' ? 'badge-success' : 'badge-cyan'}"><span class="badge-dot"></span>${statusLabel}</span>
        </div>
      </section>

      <div class="card" style="margin-top: 1rem;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap;">
          <div>
            <div class="text-secondary" style="font-size: .78rem;">گام فعلی</div>
            <strong style="font-size: 1rem;">${esc(job.step || 'در انتظار شروع راه‌اندازی')}</strong>
          </div>
          <div style="text-align: left;">
            <div class="cell-mono" style="font-size: 1.35rem; font-weight: 700;">${progress}٪</div>
            <span class="badge badge-neutral">کار ${jobId}</span>
          </div>
        </div>
        <div class="metric-meter" role="progressbar" aria-label="پیشرفت راه‌اندازی مشتری" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100" style="margin-top: 1rem;">
          <div class="metric-meter-track"><div class="metric-meter-fill ${status === 'failed' ? 'danger' : status === 'completed' ? 'meter-success' : 'meter-cyan'}" style="width: ${progress}%;"></div></div>
        </div>
        ${job.errorMessage ? `<div class="provisioning-error" role="alert" style="margin-top: 1rem; display: flex; justify-content: space-between; align-items: center; gap: .75rem; flex-wrap: wrap;">
          <span><strong class="text-danger">علت توقف:</strong> ${esc(job.errorMessage)}</span>
          <button type="button" class="btn btn-xs btn-danger" onclick="window.retryDossierProvisioning('${jobId}')">تلاش مجدد</button>
        </div>` : ''}
      </div>

      <div class="grid-cols-2" style="margin-top: 1rem;">
        <div class="card">
          <div class="card-header">
            <div class="card-title-group"><h3 class="card-title">مراحل راه‌اندازی</h3><p class="card-subtitle">${completedSteps} از ${steps.length} مرحله تکمیل شده</p></div>
          </div>
          <div class="card-body">
            <div class="timeline" aria-label="توالی مراحل راه‌اندازی مشتری">
              ${steps.map((step, index) => {
                const stepStatus = ['completed', 'failed', 'running', 'pending'].includes(step.status) ? step.status : 'pending';
                const label = stepStatus === 'completed' ? 'تکمیل‌شده' : stepStatus === 'failed' ? 'خطا در گام' : stepStatus === 'running' ? 'در حال اجرا' : 'در صف';
                return `<div class="timeline-step ${stepStatus}">
                  <div class="timeline-node"></div>
                  <div class="timeline-content" style="display: flex; justify-content: space-between; align-items: center; gap: .75rem; flex-wrap: wrap; width: 100%;">
                    <span><strong>${index + 1}. ${esc(step.name)}</strong><small style="display: block; color: var(--text-secondary); margin-top: .15rem;">${stepStatus === 'failed' ? esc(job.errorMessage || 'خطای ارتباطی') : stepStatus === 'completed' ? 'تکمیل موفقیت‌آمیز' : stepStatus === 'running' ? 'در حال اجرا روی سرور متمرکز VPS' : 'در صف پردازش'}</small></span>
                    <span class="badge ${stepStatus === 'completed' ? 'badge-success' : stepStatus === 'failed' ? 'badge-danger' : stepStatus === 'running' ? 'badge-cyan' : 'badge-neutral'}">${label}</span>
                  </div>
                </div>`;
              }).join('')}
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title-group"><h3 class="card-title">خروجی تحویل</h3><p class="card-subtitle">اطلاعاتی که پس از تکمیل در اختیار مشتری قرار می‌گیرد</p></div></div>
          <div class="card-body">
            <div class="kv-list">
              <div class="kv-item"><span class="kv-label">آدرس ورود اختصاصی:</span><span class="cell-mono text-cyan">https://${esc(tenant.slug || tenant.id.replace('tnt_', ''))}.demo.neem.ir</span></div>
              <div class="kv-item"><span class="kv-label">دعوت مالک:</span><span class="badge ${status === 'completed' ? 'badge-success' : 'badge-warning'}">${status === 'completed' ? 'ارسال‌شده' : 'در انتظار تکمیل'}</span></div>
              <div class="kv-item"><span class="kv-label">داده اولیه:</span><span class="badge badge-success">صفر و تأییدشده</span></div>
            </div>
            <div style="display: flex; gap: .5rem; flex-wrap: wrap; margin-top: 1rem;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="window.openGM06JobLogsDrawer && window.openGM06JobLogsDrawer('${jobId}')">مشاهده لاگ اجرا</button>
              ${status === 'failed' ? `<button type="button" class="btn btn-primary btn-sm" onclick="window.retryDossierProvisioning('${jobId}')">تلاش مجدد راه‌اندازی</button>` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

window.retryDossierProvisioning = function(jobId) {
  const store = window.prototypeStore || window.GMStore;
  if (store && typeof store.retryJob === 'function') store.retryJob(jobId);
  if (window.GMApp && typeof window.GMApp.showToast === 'function') window.GMApp.showToast('درخواست تلاش مجدد برای همین مشتری ثبت شد.', 'info');
  if (window.GMRouter && typeof window.GMRouter.refresh === 'function') window.GMRouter.refresh();
};

var esc = (typeof window !== 'undefined' && window.GMPageContracts && typeof window.GMPageContracts.escapeHtml === 'function')
  ? window.GMPageContracts.escapeHtml
  : function esc(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };

window._activeGM04FeatureCat = 'all';

window.filterGM04FeatureCategory = function(catId) {
  window._activeGM04FeatureCat = catId;
  const pills = document.querySelectorAll('.gm04-cat-pill');
  pills.forEach(p => p.classList.toggle('active', p.getAttribute('data-cat') === catId));
  const cards = document.querySelectorAll('.gm04-feature-card');
  const query = (document.getElementById('gm04FeatureSearchInput')?.value || '').trim().toLowerCase();
  cards.forEach(card => {
    const cardCat = card.getAttribute('data-category');
    const matchesCat = catId === 'all' || cardCat === catId;
    const text = card.textContent.toLowerCase();
    const matchesSearch = !query || text.includes(query);
    card.style.display = matchesCat && matchesSearch ? 'flex' : 'none';
  });
};

window.filterGM04FeatureSearch = function(query) {
  const q = (query || '').trim().toLowerCase();
  const catId = window._activeGM04FeatureCat || 'all';
  const cards = document.querySelectorAll('.gm04-feature-card');
  cards.forEach(card => {
    const cardCat = card.getAttribute('data-category');
    const matchesCat = catId === 'all' || cardCat === catId;
    const text = card.textContent.toLowerCase();
    const matchesSearch = !q || text.includes(q);
    card.style.display = matchesCat && matchesSearch ? 'flex' : 'none';
  });
};

window.renderGM04 = function(params) {
  const store = window.prototypeStore || window.GMStore;
  const tenantId = params?.id || null;
  const tenant = store && store.getTenant ? store.getTenant(tenantId) : null;
  if (!tenant) {
    return `
      <div class="empty-state" role="alert" style="margin: 2rem;">
        <div class="empty-state-icon" aria-hidden="true">⌁</div>
        <h2>پرونده مشتری در دسترس نیست</h2>
        <p>مشتری را از فهرست مشتریان انتخاب کنید. هیچ زمینهٔ پیش‌فرضی جایگزین شناسهٔ نامعتبر نمی‌شود.</p>
        <a class="btn btn-primary" href="#gm-03-tenants">بازگشت به فهرست مشتریان</a>
      </div>`;
  }

  const users = store && store.getUsers ? store.getUsers(tenant.id) : [
    { id: 'usr_01', name: 'مالک نمونه', role: 'owner', roleFa: 'مالک و مدیر نمونه', phone: '۰۹۱۲۰۰۰۰۰۰۰', branch: 'شعبه نمونه', status: 'active', twoFactor: true },
    { id: 'usr_02', name: 'اپراتور نمونه', role: 'manager', roleFa: 'مدیر نمونهٔ سیستم', phone: '۰۹۱۲۰۰۰۰۰۰۱', branch: 'شعبه نمونه', status: 'active', twoFactor: true },
    { id: 'usr_03', name: 'کاربر نمونهٔ آشپزخانه', role: 'kitchen', roleFa: 'ایستگاه KDS نمونه', phone: '۰۹۱۲۰۰۰۰۰۰۲', branch: 'آشپزخانه نمونه', status: 'active', twoFactor: false },
    { id: 'usr_04', name: 'کاربر نمونهٔ صندوق', role: 'cashier', roleFa: 'صندوق‌دار نمونه', phone: '۰۹۱۲۰۰۰۰۰۰۳', branch: 'کانتر نمونه', status: 'active', twoFactor: false }
  ];

  const allFeatures = (store && typeof store.getFeatures === 'function') ? store.getFeatures() : [];
  const categories = store && typeof store.getFeaturesByCategory === 'function' ? store.getFeaturesByCategory() : [];
  const grants = store && store.getTenantGrants ? store.getTenantGrants(tenant.id) : {};
  const grantedCount = Object.keys(grants).length;
  const activeCatId = window._activeGM04FeatureCat || 'all';
  const isWesto = tenant.id === 'tnt_westo_demo';
  const tenantTickets = (store && typeof store.getTickets === 'function') ? store.getTickets(tenant.id) : [];
  const tenantSessions = (store && typeof store.getSupportSessions === 'function') ? store.getSupportSessions().filter(s => s.tenantId === tenant.id) : [];
  const tenantDevices = (store && typeof store.getDevices === 'function') ? store.getDevices(tenant.id) : [];
  const tenantBackups = (store && typeof store.getBackups === 'function') ? store.getBackups(tenant.id) : [];
  const tenantAuditLogs = (store && typeof store.getAuditLogs === 'function') ? store.getAuditLogs(tenant.id) : [];

  // Active initial tab from query param or default to summary
  const activeTab = normalizeDossierTab(params?.tab);

  return `
    <div class="page-header gm04-page">
      <div class="page-title-group">
        <nav class="breadcrumb-nav customer-dossier-breadcrumb" data-breadcrumb-context="customer-dossier" aria-label="مسیر پرونده مشتری">
          <a href="#gm-03-tenants" class="breadcrumb-link">مشتریان</a>
          <span class="breadcrumb-separator">/</span>
          <a href="#gm-04-tenant-detail?id=${tenant.id}&tab=summary" class="breadcrumb-link breadcrumb-tenant" data-breadcrumb-tenant="true">${esc(tenant.name)}</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current" aria-current="page">${DOSSIER_TAB_LABELS[activeTab]}</span>
        </nav>
        <h1>
          ${esc(tenant.name)}
          ${(tenant.status === 'archived' || tenant.status === 'banned')
            ? '<span class="badge badge-danger"><span class="status-dot dot-danger"></span> حساب بایگانی و مسدودشده (Banned)</span>'
            : '<span class="badge badge-scope-tenant"><span class="status-dot dot-active"></span> دامنه مشتری</span>'}
        </h1>
        <p>${esc(tenant.organization)} · <span class="cell-mono">${esc(tenant.domain)}</span></p>
      </div>
      <div class="header-actions">
        <a href="#gm-03-tenants" class="btn btn-secondary">
          بازگشت به فهرست مشتریان
        </a>
      </div>
    </div>

    <!-- Dossier Tabs Navigation (In-Place switching, no jumping) -->
    <nav class="nav-tabs" aria-label="تب‌های پرونده مشتری" style="margin-bottom: 1.25rem;">
      <button type="button" class="tab-link dossier-tab-btn ${activeTab === 'summary' ? 'active' : ''}" data-tab="summary" onclick="switchDossierTab('summary')">خلاصه و شناسنامه</button>
      <button type="button" class="tab-link dossier-tab-btn ${activeTab === 'portal' ? 'active' : ''}" data-tab="portal" onclick="switchDossierTab('portal')">قرارداد و پورتال</button>
      <button type="button" class="tab-link dossier-tab-btn ${activeTab === 'provisioning' ? 'active' : ''}" data-tab="provisioning" onclick="switchDossierTab('provisioning')">راه‌اندازی و تحویل</button>
      <button type="button" class="tab-link dossier-tab-btn ${activeTab === 'features' ? 'active' : ''}" data-tab="features" onclick="switchDossierTab('features')">امکانات و لایسنس‌ها (${grantedCount})</button>
      <button type="button" class="tab-link dossier-tab-btn ${activeTab === 'users' ? 'active' : ''}" data-tab="users" onclick="switchDossierTab('users')">کاربران و پرسنل (${users.length})</button>
      <button type="button" class="tab-link dossier-tab-btn ${activeTab === 'identities' ? 'active' : ''}" data-tab="identities" onclick="switchDossierTab('identities')">حساب‌ها و نشست‌ها</button>
      <button type="button" class="tab-link dossier-tab-btn ${activeTab === 'access' ? 'active' : ''}" data-tab="access" onclick="switchDossierTab('access')">نقش‌ها و دسترسی‌ها</button>
      <button type="button" class="tab-link dossier-tab-btn ${activeTab === 'simulator' ? 'active' : ''}" data-tab="simulator" onclick="switchDossierTab('simulator')">آزمایش دسترسی</button>
      <button type="button" class="tab-link dossier-tab-btn ${activeTab === 'customers' ? 'active' : ''}" data-tab="customers" onclick="switchDossierTab('customers')">مشتریان نهایی</button>
      <button type="button" class="tab-link dossier-tab-btn ${activeTab === 'billing' ? 'active' : ''}" data-tab="billing" onclick="switchDossierTab('billing')">مالی و صورتحساب‌ها</button>
      <button type="button" class="tab-link dossier-tab-btn ${activeTab === 'usage' ? 'active' : ''}" data-tab="usage" onclick="switchDossierTab('usage')">سهمیه و مصرف</button>
      <button type="button" class="tab-link dossier-tab-btn ${activeTab === 'devices' ? 'active' : ''}" data-tab="devices" onclick="switchDossierTab('devices')">دستگاه‌ها و پوز (${tenant.devicesCount})</button>
      <button type="button" class="tab-link dossier-tab-btn ${activeTab === 'backups' ? 'active' : ''}" data-tab="backups" onclick="switchDossierTab('backups')">پشتیبان‌گیری ایزوله</button>
      <button type="button" class="tab-link dossier-tab-btn ${activeTab === 'domains' ? 'active' : ''}" data-tab="domains" onclick="switchDossierTab('domains')">تنظیمات مشتری</button>
      <button type="button" class="tab-link dossier-tab-btn ${activeTab === 'support' ? 'active' : ''}" data-tab="support" onclick="switchDossierTab('support')">تیکت‌های پشتیبانی</button>
      <button type="button" class="tab-link dossier-tab-btn ${activeTab === 'audit' ? 'active' : ''}" data-tab="audit" onclick="switchDossierTab('audit')">لاگ ممیزی</button>
    </nav>

    ${(() => {
      const dataState = window.GMDataState ? window.GMDataState.getViewState('GM04') : { state: 'live' };
      if (dataState.state === 'failed' || dataState.state === 'error') {
        return window.GMDataState.renderErrorState({
          viewId: 'GM04',
          title: 'خطا در بارگذاری پرونده ۳۶۰ درجه مشتری',
          reason: 'پاسخی از پایگاه متادیتای مشتریان دریافت نشد.',
          errorCode: 'ERR_DOSSIER_LOAD_TIMEOUT'
        });
      }
      if (dataState.state === 'empty') {
        return window.GMDataState.renderEmptyState({
          title: 'پرونده اطلاعاتی یافت نشد',
          description: 'هیچ سابقه‌ای برای این شناسه مشتری ثبت نگردیده است.',
          actionLabel: 'بازگشت به فهرست مشتریان',
          actionHash: '#gm-03-tenants'
        });
      }
      if (dataState.state === 'loading') {
        return window.GMDataState.renderSkeleton('cards', 3) + window.GMDataState.renderSkeleton('table', 4);
      }
      if (dataState.state === 'refreshing') {
        return window.GMDataState.renderRefreshingBanner('GM04');
      }
      if (dataState.state === 'stale') {
        return window.GMDataState.renderStaleBanner('GM04');
      }
      return '';
    })()}

    ${(window.GMDataState && ['failed', 'empty', 'error', 'loading'].includes(window.GMDataState.getViewState('GM04').state)) ? '' : `

    <!-- TAB 1: SUMMARY PANEL -->
    <!-- TAB 1: SUMMARY PANEL — TENANT CONTROL CENTER -->
    <div class="dossier-panel" data-panel="summary" style="display: ${activeTab === 'summary' ? 'block' : 'none'};">
      
      <!-- Executive KPI Strip -->
      <div class="grid-cols-4" style="margin-bottom: 1.25rem;">
        <div class="card" style="padding: 1rem;">
          <div style="font-size: 0.75rem; color: var(--text-secondary); font-weight: 600;">وضعیت چرخه حیات</div>
          <div style="font-size: 1.15rem; font-weight: 700; margin-top: 0.25rem; color: var(--text-primary); display: flex; align-items: center; gap: 0.4rem;">
            <span class="status-dot dot-green"></span>
            ${tenant.status === 'active' ? 'فعال (Active)' : (tenant.status === 'trial' ? 'آزمایشی (Trial)' : esc(tenant.status))}
          </div>
          <div style="font-size: 0.72rem; color: var(--text-tertiary); margin-top: 0.25rem;">انطباق کامل با SLA</div>
        </div>

        <div class="card" style="padding: 1rem;">
          <div style="font-size: 0.75rem; color: var(--text-secondary); font-weight: 600;">پلن تجاری و نسخه</div>
          <div style="font-size: 1.15rem; font-weight: 700; margin-top: 0.25rem; color: var(--accent-cyan); font-family: var(--font-mono);">
            ${esc(tenant.plan || 'سازمانی')} (v1)
          </div>
          <div style="font-size: 0.72rem; color: var(--text-tertiary); margin-top: 0.25rem;">تخصیص نسخه‌بندی‌شده</div>
        </div>

        <div class="card" style="padding: 1rem;">
          <div style="font-size: 0.75rem; color: var(--text-secondary); font-weight: 600;">درآمد تکرارشونده (MRR)</div>
          <div style="font-size: 1.15rem; font-weight: 700; margin-top: 0.25rem; color: var(--color-success, #10b981); font-family: var(--font-mono);">
            ۴,۹۰۰,۰۰۰ تومان
          </div>
          <div style="font-size: 0.72rem; color: var(--text-tertiary); margin-top: 0.25rem;">تسویه‌شده ماهانه</div>
        </div>

        <div class="card" style="padding: 1rem;">
          <div style="font-size: 0.75rem; color: var(--text-secondary); font-weight: 600;">شعب و پایانه‌ها</div>
          <div style="font-size: 1.15rem; font-weight: 700; margin-top: 0.25rem; color: var(--text-primary); font-family: var(--font-mono);">
            ۱ شعبه · ۲ پایانه
          </div>
          <div style="font-size: 0.72rem; color: var(--text-tertiary); margin-top: 0.25rem;">۱۰۰٪ پایانه‌ها متصل</div>
        </div>
      </div>

      <!-- Control Center Functional Domain Summary Cards -->
      <div class="grid-cols-2" style="gap: 1rem; margin-bottom: 1.5rem;">
        
        <!-- Section 1: Features & Entitlements -->
        <div class="card">
          <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
            <h4 class="card-title" style="font-size: 0.875rem;">🎛️ امکانات و مجوزها (Entitlements)</h4>
            <div style="display: flex; gap: 0.4rem;">
              <button type="button" class="btn btn-secondary btn-xs" onclick="switchDossierTab('features')">مدیریت در پرونده</button>
            </div>
          </div>
          <div class="card-body">
            <div class="kv-list">
              <div class="kv-item"><span class="kv-label">امکانات فعال:</span><span class="text-cyan font-bold">${grantedCount} قابلیت مجاز</span></div>
              <div class="kv-item"><span class="kv-label">سقف پایانه‌های POS:</span><span class="font-mono">۴ دستگاه مجاز (۲ فعال)</span></div>
              <div class="kv-item"><span class="kv-label">محاسبه دسترسی:</span><span class="badge badge-success">پلن v1 + اوررایدهای معتبر</span></div>
            </div>
          </div>
        </div>

        <!-- Section 2: Subscription & Billing -->
        <div class="card">
          <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
            <h4 class="card-title" style="font-size: 0.875rem;">💳 وضعیت اشتراک و مالی (Billing)</h4>
            <div style="display: flex; gap: 0.4rem;">
              <button type="button" class="btn btn-secondary btn-xs" onclick="switchDossierTab('billing')">مشاهده فاکتورها</button>
              <button type="button" class="btn btn-outline-cyan btn-xs" onclick="window.GMApp ? window.GMApp.showToast('صدور صورتحساب اضطراری فعال شد', 'info') : null">صدور صورتحساب</button>
            </div>
          </div>
          <div class="card-body">
            <div class="kv-list">
              <div class="kv-item"><span class="kv-label">وضعیت صورتحساب:</span><span class="badge badge-success">تسویه‌شده و فعال</span></div>
              <div class="kv-item"><span class="kv-label">سررسید فاکتور بعدی:</span><span class="font-mono text-primary">۱۴۰۳/۱۱/۰۱</span></div>
              <div class="kv-item"><span class="kv-label">اعتبار پیامک و کیف‌پول:</span><span class="font-mono text-success">۲۵۰,۰۰۰ تومان (۲,۴۵۰ پیامک)</span></div>
            </div>
          </div>
        </div>

        <!-- Section 3: Branches & Device Fleet -->
        <div class="card">
          <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
            <h4 class="card-title" style="font-size: 0.875rem;">💻 ناوگان پایانه‌ها و شعب (Devices & Fleet)</h4>
            <div style="display: flex; gap: 0.4rem;">
              <button type="button" class="btn btn-secondary btn-xs" onclick="switchDossierTab('devices')">پایانه‌ها</button>
              <button type="button" class="btn btn-outline-cyan btn-xs" onclick="window.GMApp ? window.GMApp.showToast('فرمان پایش به کلیه پایانه‌ها ارسال شد', 'success') : null">پایش ناوگان</button>
            </div>
          </div>
          <div class="card-body">
            <div class="kv-list">
              <div class="kv-item"><span class="kv-label">شعبه مستقر:</span><span>شعبه مرکزی (brn_westo_main)</span></div>
              <div class="kv-item"><span class="kv-label">پایانه‌های فعال:</span><span class="font-mono text-success">${Number(tenant.devicesCount || 2).toLocaleString('fa-IR')} پایانه (برخط)</span></div>
              <div class="kv-item"><span class="kv-label">وضعیت همگام‌سازی:</span><span class="badge badge-success">همگام با صف محلی Edge</span></div>
            </div>
          </div>
        </div>

        <!-- Section 4: Support & Health -->
        <div class="card">
          <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
            <h4 class="card-title" style="font-size: 0.875rem;">🎫 عملیات پشتیبانی و رخدادها (Support)</h4>
            <div style="display: flex; gap: 0.4rem;">
              <button type="button" class="btn btn-secondary btn-xs" onclick="switchDossierTab('support')">تیکت‌ها</button>
              <button type="button" class="btn btn-outline-cyan btn-xs" onclick="window.location.hash='#gm-21-support'">کنسول پشتیبانی ↗</button>
            </div>
          </div>
          <div class="card-body">
            <div class="kv-list">
              <div class="kv-item"><span class="kv-label">تیکت‌های باز:</span><span class="font-mono text-success">${tenantTickets.length.toLocaleString('fa-IR')} تیکت فعال</span></div>
              <div class="kv-item"><span class="kv-label">دسترسی اضطراری (Delegation):</span><span class="badge badge-neutral">غیرفعال (نیاز به تایید)</span></div>
              <div class="kv-item"><span class="kv-label">شاخص پایداری:</span><span class="text-success font-bold">۱۰۰٪ برخط</span></div>
            </div>
          </div>
        </div>

        <!-- Section 5: Backup & Disaster Recovery -->
        <div class="card">
          <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
            <h4 class="card-title" style="font-size: 0.875rem;">💾 پشتیبان‌گیری و بازیابی (Backups)</h4>
            <div style="display: flex; gap: 0.4rem;">
              <button type="button" class="btn btn-secondary btn-xs" onclick="switchDossierTab('backups')">اسنپ‌شات‌ها</button>
              <button type="button" class="btn btn-outline-cyan btn-xs" onclick="window.triggerGM20ManualBackup ? window.triggerGM20ManualBackup('${tenant.id}') : (window.GMApp ? window.GMApp.showToast('پشتیبان اضطراری با موفقیت ایجاد شد', 'success') : null)">بکاپ اضطراری</button>
            </div>
          </div>
          <div class="card-body">
            <div class="kv-list">
              <div class="kv-item"><span class="kv-label">آخرین پشتیبان موفق:</span><span class="font-mono text-primary">امروز ۰۳:۰۰ بامداد (کامل)</span></div>
              <div class="kv-item"><span class="kv-label">تست یکپارچگی بازیابی:</span><span class="badge badge-success">موفقیت‌آمیز (Valid)</span></div>
              <div class="kv-item"><span class="kv-label">دوره ماندگاری (Retention):</span><span>۳۰ روز ذخیره‌سازی ایزوله</span></div>
            </div>
          </div>
        </div>

        <!-- Section 6: Domain & Audit -->
        <div class="card">
          <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
            <h4 class="card-title" style="font-size: 0.875rem;">🛡️ ساب‌دامین و دامنه‌ها (Domain & White-label)</h4>
            <div style="display: flex; gap: 0.4rem;">
              <button type="button" class="btn btn-secondary btn-xs" onclick="switchDossierTab('audit')">لاگ ممیزی</button>
              <button type="button" class="btn btn-outline-cyan btn-xs" onclick="location.hash='#gm-18-domains?id=${tenant.id}'">مدیریت دامنه‌ها ↗</button>
            </div>
          </div>
          <div class="card-body">
            <div class="kv-list">
              <div class="kv-item"><span class="kv-label">ساب‌دامین پلتفرم:</span><span class="cell-mono text-cyan">${esc(tenant.slug || 'westo')}.neem.ir</span></div>
              <div class="kv-item"><span class="kv-label">دامنه رسمی / اختصاصی:</span><span class="cell-mono" style="color: #A855F7;">${esc(tenant.domain)}</span></div>
              <div class="kv-item"><span class="kv-label">گواهی امنیتی SSL:</span><span class="badge badge-success">On-Demand TLS فعال</span></div>
              <div class="kv-item"><span class="kv-label">میزبانی وایت‌لیبل:</span><span class="font-mono text-secondary">پروکسی معکوس VPS (بدون ذکر نام نیم)</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    ${renderDossierPortalPanel(tenant, store, activeTab)}

    ${renderDossierProvisioningPanel(tenant, store, activeTab)}

    ${renderEmbeddedDossierPanel('identities', activeTab, window.GMViews?.GM13?.render?.bind(window.GMViews.GM13), { id: tenant.id })}
    ${renderEmbeddedDossierPanel('access', activeTab, window.GMViews?.GM14?.render?.bind(window.GMViews.GM14), { id: tenant.id })}
    ${renderEmbeddedDossierPanel('simulator', activeTab, window.GMViews?.GM15?.render?.bind(window.GMViews.GM15), { id: tenant.id })}
    ${renderEmbeddedDossierPanel('customers', activeTab, window.renderGM17, { id: tenant.id })}

    <!-- TAB 8: CUSTOMER PROFILE, DOMAIN AND SECURITY SETTINGS -->
    <div class="dossier-panel" data-panel="domains" style="display: ${activeTab === 'domains' ? 'block' : 'none'};">
      <input type="hidden" id="tenant-record-version" value="${Number(tenant.version || 1)}" />
      <section class="settings-section">
        <div class="settings-section-header">
          <h3 class="settings-section-title">مشخصات و مالکیت مجموعه</h3>
          <p class="settings-section-desc">اطلاعات رسمی، نام تجاری در فاکتورها، مالک حساب و هماهنگ‌کننده اجرایی.</p>
        </div>
          <div class="settings-section-body">
            <div class="grid-cols-2">
              <div class="form-group" id="group-tenant-name">
                <label class="form-label" for="tenant-input-name">
                  نام تجاری کسب‌وکار
                  <span class="field-badge field-required" aria-hidden="true">الزامی</span>
                </label>
                <input type="text" id="tenant-input-name" class="form-control" value="${esc(tenant.name)}" aria-required="true" oninput="window.clearGM04InputError(this)" />
                <div class="form-hint" id="tenant-input-name-hint">نام تجاری که روی رسیدها، منوی دیجیتال و گزارش‌ها نمایش داده می‌شود.</div>
              </div>
              <div class="form-group" id="group-tenant-org">
                <label class="form-label" for="tenant-input-org">
                  نام هلدینگ / سازمان مادر
                  <span class="field-badge field-optional" aria-hidden="true">اختیاری</span>
                </label>
                <input type="text" id="tenant-input-org" class="form-control" value="${esc(tenant.organization)}" oninput="window.clearGM04InputError(this)" />
                <div class="form-hint" id="tenant-input-org-hint">نام شرکت حقوقی ثبت‌شده یا مالکیت حقوقی مجموعه.</div>
              </div>
            </div>
            <div class="grid-cols-2">
              <div class="form-group" id="group-tenant-owner">
                <label class="form-label" for="tenant-input-owner">
                  نام و نام خانوادگی مالک
                  <span class="field-badge field-required" aria-hidden="true">الزامی</span>
                </label>
                <input type="text" id="tenant-input-owner" class="form-control" value="${esc(tenant.ownerName)}" aria-required="true" oninput="window.clearGM04InputError(this)" />
                <div class="form-hint" id="tenant-input-owner-hint">نام مدیرعامل یا صاحب امتیاز رستوران جهت ارسال اطلاعیه‌ها.</div>
              </div>
              <div class="form-group" id="group-tenant-phone">
                <label class="form-label" for="tenant-input-phone">
                  شماره تماس اضطراری
                  <span class="field-badge field-required" aria-hidden="true">الزامی</span>
                </label>
                <input type="text" id="tenant-input-phone" class="form-control cell-mono" value="${esc(tenant.ownerPhone)}" aria-required="true" style="direction: ltr; text-align: left;" oninput="window.clearGM04InputError(this)" />
                <div class="form-hint" id="tenant-input-phone-hint">شماره همراه مالک (۱۱ رقم با ۰۹) جهت ارسال پیامک احراز هویت.</div>
              </div>
            </div>
          </div>
        </section>

        <div class="settings-divider"></div>

        <section class="settings-section">
          <div class="settings-section-header">
            <h3 class="settings-section-title">دامنه و سرور میزبان VPS</h3>
            <p class="settings-section-desc">پیکربندی آدرس اینترنتی اختصاصی مشتری و تنظیمات استقرار بر روی سرور متمرکز VPS.</p>
          </div>
          <div class="settings-section-body">
            <div class="grid-cols-2">
              <div class="form-group" id="group-tenant-domain">
                <label class="form-label" for="tenant-input-domain">
                  دامنه اختصاصی مشتری یا ساب‌دامین
                  <span class="field-badge field-required" aria-hidden="true">الزامی</span>
                </label>
                <input type="text" id="tenant-input-domain" class="form-control cell-mono" value="${esc(tenant.domain)}" aria-required="true" style="direction: ltr; text-align: left;" oninput="window.clearGM04InputError(this)" />
                <div class="form-hint" id="tenant-input-domain-hint">ساب‌دامین پلتفرمی پیش‌فرض: ${esc(tenant.slug || 'westo')}.neem.ir · گواهی امنیتی On-Demand TLS خودکار تمدید می‌شود.</div>
              </div>
              <div class="form-group" id="group-tenant-cell">
                <label class="form-label" for="tenant-select-cell">
                  سرور میزبان (VPS اختصاصی)
                  <span class="field-badge field-required" aria-hidden="true">الزامی</span>
                </label>
                <select id="tenant-select-cell" class="form-control" aria-label="سرور میزبان (VPS اختصاصی)">
                  <option value="cell-teh-01" ${tenant.cellId === 'cell-teh-01' ? 'selected' : ''}>سرور اصلی VPS (میزبانی متمرکز وستو - Production)</option>
                  <option value="cell-teh-02" ${tenant.cellId === 'cell-teh-02' ? 'selected' : ''}>محیط پیش‌نمایش و تست (Staging VPS)</option>
                  <option value="cell-msh-01" ${tenant.cellId === 'cell-msh-01' ? 'selected' : ''}>سرور پشتیبان آف‌سایت (Disaster Recovery)</option>
                </select>
                <div class="form-hint">سرور میزبان داده‌های ایزوله در پایگاه‌داده متمرکز با شِمای اختصاصی.</div>
              </div>
            </div>
          </div>
        </section>

        <div class="settings-divider"></div>

        <section class="settings-section">
          <div class="settings-section-header">
            <h3 class="settings-section-title">خط‌مشی‌های امنیتی و همگام‌سازی</h3>
            <p class="settings-section-desc">کنترل‌های حفاظتی سطح سازمانی، انطباق با مقررات و شیوه ثبت وقایع.</p>
          </div>
          <div class="settings-section-body">
            <div class="settings-row">
              <div class="settings-row-info">
                <span class="settings-row-label">احراز هویت دومرحله‌ای اجباری</span>
                <span class="settings-row-desc">ورود تمام مدیران و صندوق‌داران این مشتری مستلزم رمز یکبار مصرف پیامکی خواهد بود.</span>
              </div>
              <div class="settings-row-control">
                <label class="toggle-switch">
                  <input type="checkbox" id="tenant-toggle-2fa" checked>
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-info">
                <span class="settings-row-label">همگام‌سازی لحظه‌ای تراکنش‌های صندوق</span>
                <span class="settings-row-desc">انتقال فوری هر فاکتور و پرداخت به سرور ابری؛ در صورت قطعی در صف محلی می‌ماند.</span>
              </div>
              <div class="settings-row-control">
                <label class="toggle-switch">
                  <input type="checkbox" id="tenant-toggle-sync" checked>
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
          </div>
        </section>

        <div class="settings-action-bar">
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <button type="button" class="btn btn-secondary" onclick="window.location.hash = '#gm-03-tenants'">
              انصراف و بازگشت
            </button>
            <button type="button" class="btn btn-outline-danger" id="btnRollbackGM04" onclick="window.confirmRollbackGM04Settings('${tenant.id}')" title="بازنشانی تمام مقادیر فرم به داده‌های ذخیره‌شده اولیه">
              واگردانی به مقادیر اولیه
            </button>
          </div>
          <button type="button" class="btn btn-primary" id="btnSaveGM04" onclick="window.saveGM04Settings('${tenant.id}')">
            ذخیره تغییرات پرونده
          </button>
        </div>
    </div>

    <!-- TAB 2: FEATURES PANEL (GM-09 embedded in-place) -->
    <div class="dossier-panel" data-panel="features" style="display: ${activeTab === 'features' ? 'block' : 'none'};">
      <div class="card" style="margin-bottom: 1.25rem; border-radius: 12px; border: 1px solid #e2e8f0; padding: 1.25rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <h3 style="font-weight: 700; color: var(--text-primary); font-size: 1.05rem; margin: 0;">🎛️ ماتریس جامع کنترل امکانات و لایسنس‌های ${esc(tenant.name)}</h3>
              ${isWesto ? '<span class="badge badge-emerald" style="font-size: 11px;">متصل به پورت ۴۱۸۰</span>' : ''}
              <span class="badge badge-purple" style="font-size: 11px;">${grantedCount} از ${allFeatures.length} قابلیت فعال</span>
            </div>
            <p style="font-size: 0.8rem; color: var(--text-secondary); margin: 0.35rem 0 0;">
              کنترل کامل تک‌تک قابلیت‌های سامانه به صورت طبقه‌بندی‌شده و بخش‌بندی — با امکان خاموش و روشن کردن ماژول حسابداری و کلیه امکانات با بازتاب آنی روی پورت ۴۱۸۰
            </p>
          </div>
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <input type="text" 
                   id="gm04FeatureSearchInput" 
                   class="quick-input" 
                   style="width: 200px; height: 34px; font-size: 0.82rem;" 
                   placeholder="🔍 جستجوی ماژول..." 
                   oninput="window.filterGM04FeatureSearch(this.value)" />
            <button class="btn btn-primary btn-sm" onclick="if (typeof openSellAddonDrawer === 'function') openSellAddonDrawer('${esc(tenant.id)}'); else if (window.GMApp && window.GMApp.showToast) window.GMApp.showToast('مدیریت افزونه‌ها در همین پرونده انجام می‌شود.', 'info');">
              فعال‌سازی ماژول و افزونه جدید
            </button>
          </div>
        </div>

        <!-- Category Filter Pills -->
        <div class="feature-cat-nav" role="tablist" aria-label="دسته‌بندی امکانات" style="margin-bottom: 1.25rem;">
          <button type="button" class="feature-cat-pill gm04-cat-pill ${activeCatId === 'all' ? 'active' : ''}" data-cat="all" onclick="window.filterGM04FeatureCategory('all')">
            <span>همه امکانات</span>
            <span class="badge">${allFeatures.length}</span>
          </button>
          ${categories.map(cat => {
            const catActiveCount = cat.features.filter(f => store.isFeatureEnabled(tenant.id, f.key)).length;
            return `
              <button type="button" class="feature-cat-pill gm04-cat-pill ${activeCatId === cat.id ? 'active' : ''}" data-cat="${esc(cat.id)}" onclick="window.filterGM04FeatureCategory('${esc(cat.id)}')">
                <span>${esc(cat.icon)}</span>
                <span>${esc(cat.nameFa)}</span>
                <span class="badge">${catActiveCount}/${cat.features.length}</span>
              </button>
            `;
          }).join('')}
        </div>

        <!-- Grid of 48 Features with iOS Switches -->
        <div class="feature-grid" id="gm04FeaturesGridContainer" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.85rem;">
          ${categories.map(cat => {
            return cat.features.map(f => {
              const isEnabled = store.isFeatureEnabled(tenant.id, f.key);
              const isHighlight = f.key === 'finance.workspace';
              const matchesCat = activeCatId === 'all' || activeCatId === cat.id;
              return `
                <div class="feature-item-card gm04-feature-card ${isEnabled ? 'is-active' : 'is-disabled'} ${isHighlight ? 'is-highlighted' : ''}" 
                     data-feature-key="${esc(f.key)}" 
                     data-category="${esc(cat.id)}"
                     style="display: ${matchesCat ? 'flex' : 'none'};">
                  <div class="feature-item-header">
                    <div>
                      <div class="feature-item-title">
                        <span>${esc(cat.icon)}</span>
                        <span style="margin-right: 4px;">${esc(f.nameFa)}</span>
                        ${isHighlight ? '<span class="badge badge-emerald" style="font-size: 10px; margin-right: 6px;">ماژول کلیدی مالی</span>' : ''}
                      </div>
                      <div style="font-size: 0.72rem; color: #64748b; margin-top: 3px;">
                        <span class="cell-mono">${esc(f.key)}</span>
                        <span style="margin: 0 4px;">•</span>
                        <span>${esc(cat.nameFa)}</span>
                      </div>
                    </div>
                    <button type="button" 
                            class="toggle-switch-btn ${isEnabled ? 'on' : ''}" 
                            role="switch" 
                            aria-checked="${isEnabled ? 'true' : 'false'}"
                            aria-label="تغییر وضعیت ${esc(f.nameFa)}"
                            title="${isEnabled ? 'برای خاموش‌کردن کلیک کنید' : 'برای روشن‌کردن کلیک کنید'}"
                            onclick="window.GMApp ? window.GMApp.quickToggleFeature('${esc(f.key)}', '${esc(tenant.id)}') : null">
                      <span class="toggle-switch-knob"></span>
                    </button>
                  </div>

                  <div class="feature-item-desc">
                    ${f.key === 'finance.workspace' 
                      ? 'مدیریت و کنترل کامل اسناد دوبل، دفتر کل، تراز آزمایشی، ترازنامه، صورت سود و زیان و بستن دوره‌های مالی بر روی سرور پورت ۴۱۸۰.'
                      : (esc(f.nameFa) + ' — قابلیت تحت مدیریت و نظارت لایسنس پلتفرم NEEM')}
                    ${f.dependencies && f.dependencies.length > 0 ? `
                      <div style="margin-top: 4px; font-size: 0.7rem; color: #d97706;">
                        پیش‌نیاز: <span class="cell-mono">${esc(f.dependencies.join(', '))}</span>
                      </div>
                    ` : ''}
                  </div>

                  <div class="feature-item-footer">
                    <span class="badge ${isEnabled ? 'badge-emerald' : 'badge-neutral'}">
                      ${isEnabled ? '🟢 روشن (فعال)' : '⚪ خاموش (غیرفعال)'}
                    </span>
                    <div style="font-size: 0.75rem; color: #64748b;">
                      ${(f.pricePerMonth || 0) === 0 ? '<span class="badge badge-purple" style="font-size: 10px;">پلن پایه (رایگان)</span>' : `<span class="cell-mono">${(f.pricePerMonth || 0).toLocaleString('fa-IR')}</span> تومان/ماه`}
                    </div>
                  </div>
                </div>
              `;
            }).join('');
          }).join('')}
        </div>
      </div>

      <!-- Collapsible Technical Grants Table -->
      <details class="progressive-disclosure" style="margin-top: 1rem; border-radius: 10px; border: 1px solid #e2e8f0; background: #fff;">
        <summary style="padding: 0.75rem 1rem; font-weight: 600; font-size: 0.85rem; cursor: pointer; color: #334155;">
          <span>📋 جدول متادیتای تفصیلی لایسنس‌ها و تخصیص پلن‌ها (دید فنی)</span>
          <span class="badge badge-neutral">${allFeatures.length} ردیف</span>
        </summary>
        <div class="table-wrapper" style="border: none; border-top: 1px solid #e2e8f0;">
          <table class="data-table" aria-label="جدول قابلیت‌های تجاری و مجوزهای مشتری">
            <thead>
              <tr>
                <th>قابلیت تجاری و کلید</th>
                <th>نوع مجوز (Grant)</th>
                <th>وضعیت</th>
                <th>نتیجه مؤثر</th>
                <th>اعتبار</th>
                <th>پیش‌نیازها</th>
                <th style="text-align: left;">اقدامات</th>
              </tr>
            </thead>
            <tbody>
              ${allFeatures.map(f => {
                const grant = grants[f.key];
                const isGranted = !!grant;
                return `
                  <tr id="row-feature-${f.key}">
                    <td>
                      <div class="cell-primary" style="font-weight: 500;">${esc(f.nameFa)}</div>
                      <div class="cell-mono" style="font-size: 0.72rem; color: #64748b;">${esc(f.key)}</div>
                    </td>
                    <td>
                      ${isGranted 
                        ? (grant.type === 'plan' 
                            ? '<span class="badge badge-neutral">تخصیص پلن</span>' 
                            : '<span class="badge badge-success">افزونه مستقل</span>')
                        : '<span class="badge badge-neutral" style="opacity: 0.6;">فاقد خرید</span>'
                      }
                    </td>
                    <td>
                      ${isGranted 
                        ? '<span style="color: #34d399; font-weight: 600; font-size: 0.75rem;">روشن (ON)</span>'
                        : '<span style="color: #64748b; font-size: 0.75rem;">خاموش (OFF)</span>'
                      }
                    </td>
                    <td>
                      ${isGranted
                        ? '<span class="badge badge-success"><span class="badge-dot"></span> فعال</span>'
                        : '<span style="font-size: 0.75rem; color: var(--text-tertiary);">نیازمند فعال‌سازی</span>'
                      }
                    </td>
                    <td class="cell-mono" style="font-size: 0.75rem;">
                      ${isGranted && grant.expiresAt ? esc(grant.expiresAt) : isGranted ? 'پایدار در اشتراک' : '—'}
                    </td>
                    <td>
                      ${f.dependencies.length === 0 
                        ? '<span style="color: #64748b; font-size: 0.75rem;">مستقل</span>' 
                        : f.dependencies.map(d => `<span class="badge badge-warning cell-mono" style="margin-left: 0.2rem; font-size: 0.68rem;">${esc(d)}</span>`).join('')
                      }
                    </td>
                    <td style="text-align: left;">
                      <button class="btn btn-sm ${isGranted ? 'btn-secondary' : 'btn-primary'}" onclick="window.GMApp ? window.GMApp.quickToggleFeature('${esc(f.key)}', '${esc(tenant.id)}') : null">
                        ${isGranted ? 'خاموش‌کردن' : 'فعال‌سازی'}
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </details>
    </div>

    <!-- TAB 3: USERS PANEL -->
    <div class="dossier-panel" data-panel="users" style="display: ${activeTab === 'users' ? 'block' : 'none'};">
      <div class="card" style="margin-bottom: 1rem;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 600; color: var(--text-primary); font-size: 0.875rem;">کاربران و پرسنل دارای دسترسی در ${esc(tenant.name)}</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.2rem;">کنترل نقش‌ها، مجوزهای شعبه‌ای و بررسی ورود دومرحله‌ای.</div>
          </div>
          <button class="btn btn-primary btn-sm" aria-label="دعوت پرسنل جدید به مجموعه" onclick="window.GMApp ? window.GMApp.openModal('دعوت کاربر جدید', '<div class=\\'form-group\\'><label class=\\'form-label\\'>شماره موبایل کاربر</label><input type=\\'text\\' class=\\'form-control cell-mono\\' placeholder=\\'۰۹۱۲...\\' aria-label=\\'شماره موبایل کاربر\\'></div>') : null">
            دعوت پرسنل جدید
          </button>
        </div>
      </div>

      <div class="table-wrapper">
        <table class="data-table" aria-label="جدول کاربران و پرسنل دارای دسترسی">
          <thead>
            <tr>
              <th>نام کاربر</th>
              <th>نقش سازمانی</th>
              <th>شعبه منتسب</th>
              <th>شماره تماس</th>
              <th>ورود دومرحله‌ای</th>
              <th>وضعیت</th>
              <th style="text-align: left;">اقدامات</th>
            </tr>
          </thead>
          <tbody>
            ${users.map(u => `
              <tr>
                <td>
                  <div style="font-weight: 600; color: var(--text-primary);">${u.name}</div>
                  <div class="cell-mono" style="font-size: 0.72rem; color: #64748b;">${u.id}</div>
                </td>
                <td><span class="badge badge-primary">${u.roleFa || u.role}</span></td>
                <td style="color: var(--text-secondary); font-size: 0.813rem;">${u.branch || 'تمام شعب'}</td>
                <td class="cell-mono" style="font-size: 0.78rem;">${u.phone}</td>
                <td>
                  ${u.twoFactor ? '<span class="badge badge-success">فعال</span>' : '<span class="badge badge-warning">غیرفعال</span>'}
                </td>
                <td><span class="badge badge-success"><span class="badge-dot"></span> فعال</span></td>
                <td style="text-align: left;">
                  <button class="btn btn-sm btn-secondary" onclick="window.GMApp ? window.GMApp.showToast('مجوزهای کاربر ویرایش شد', 'info') : null">ویرایش نقش</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 4: BILLING PANEL -->
    <div class="dossier-panel" data-panel="billing" style="display: ${activeTab === 'billing' ? 'block' : 'none'};">
      <div class="grid-cols-2" style="margin-bottom: 1.25rem;">
        <div class="card">
          <div class="card-header"><h4 class="card-title">وضعیت اشتراک فعلی</h4></div>
          <div class="card-body">
            <div class="kv-list">
              <div class="kv-item"><span class="kv-label">پلن فعال:</span><span class="badge badge-primary">${esc(tenant.plan)}</span></div>
              <div class="kv-item"><span class="kv-label">شهریه ماهانه:</span><span class="text-success font-mono">۴,۹۰۰,۰۰۰ تومان</span></div>
              <div class="kv-item"><span class="kv-label">سررسید تمدید بعدی:</span><span class="text-success font-mono">۱۴۰۳/۱۱/۰۱</span></div>
              <div class="kv-item"><span class="kv-label">وضعیت حسابداری:</span><span class="badge badge-success">تسویه‌شده و بدون بدهی</span></div>
            </div>
            <div style="margin-top: 1rem;">
              <button class="btn btn-primary btn-sm" onclick="window.GMApp ? window.GMApp.showToast('درخواست ارتقای پلن ثبت شد', 'success') : null">ارتقا به پلن Enterprise پلاس</button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h4 class="card-title">کیف‌پول اعتباری و پیامک</h4></div>
          <div class="card-body">
            <div class="kv-list">
              <div class="kv-item"><span class="kv-label">موجودی اعتبار پیامک:</span><span class="text-success font-mono">۲۵۰,۰۰۰ تومان</span></div>
              <div class="kv-item"><span class="kv-label">تعداد پیامک باقی‌مانده:</span><span class="text-success font-mono">۲,۴۵۰ پیامک</span></div>
              <div class="kv-item"><span class="kv-label">شارژ خودکار:</span><span class="badge badge-success">فعال</span></div>
            </div>
            <div style="margin-top: 1rem;">
              <button class="btn btn-secondary btn-sm" onclick="window.GMApp ? window.GMApp.showToast('درگاه شارژ کیف‌پول باز شد', 'info') : null">شارژ حساب اعتباری</button>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h4 class="card-title">تاریخچه صورتحساب‌ها و فاکتورهای صادره</h4></div>
        <div class="table-responsive">
          <table class="data-table" aria-label="جدول تاریخچه صورتحساب‌ها و فاکتورهای صادره مشتری">
            <thead>
              <tr>
                <th>شماره فاکتور</th>
                <th>شرح صورتحساب</th>
                <th>دوره</th>
                <th>مبلغ (تومان)</th>
                <th>وضعیت پرداخت</th>
                <th style="text-align: left;">فایل فاکتور</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="cell-mono">INV-1403-1002</td>
                <td>تمدید اشتراک ماهانه پلن ${esc(tenant.plan)}</td>
                <td class="cell-mono">دی ۱۴۰۳</td>
                <td class="cell-mono text-success">۴,۹۰۰,۰۰۰ تومان</td>
                <td><span class="badge badge-success">پرداخت‌شده (شاپرک)</span></td>
                <td style="text-align: left;"><button class="btn btn-sm btn-secondary" onclick="window.GMApp ? window.GMApp.showToast('فاکتور PDF دانلود شد', 'info') : null">دریافت PDF</button></td>
              </tr>
              <tr>
                <td class="cell-mono">INV-1403-0941</td>
                <td>افزونه هوش مصنوعی پیشنهاد قیمت</td>
                <td class="cell-mono">آذر ۱۴۰۳</td>
                <td class="cell-mono text-success">۸۵۰,۰۰۰ تومان</td>
                <td><span class="badge badge-success">تسویه‌شده</span></td>
                <td style="text-align: left;"><button class="btn btn-sm btn-secondary" onclick="window.GMApp ? window.GMApp.showToast('فاکتور PDF دانلود شد', 'info') : null">دریافت PDF</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- TAB 5: USAGE PANEL -->
    <div class="dossier-panel" data-panel="usage" style="display: ${activeTab === 'usage' ? 'block' : 'none'};">
      <div class="grid-cols-3" style="margin-bottom: 1.5rem;">
        <div class="card">
          <div class="card-header"><h4 class="card-title">سهمیه شعب متصل</h4></div>
          <div class="card-body">
            <div style="font-size: 1.5rem; font-weight: 700; color: var(--color-teal-400, #2dd4bf);" class="font-mono">
              ${Number(tenant.branchesCount || 1).toLocaleString('fa-IR')} <span style="font-size: 0.9rem; color: var(--text-secondary); font-weight: 400;">از ۳ مجاز</span>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.35rem;">استفاده ۳۳٪ · آماده اتصال شعبه دوم</div>
            <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.08); border-radius: 999px; margin-top: 0.6rem; overflow: hidden;">
              <div style="width: 33%; height: 100%; background: var(--accent-teal, #0d9488); border-radius: 999px;"></div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h4 class="card-title">سهمیه دستگاه‌های پوز</h4></div>
          <div class="card-body">
            <div style="font-size: 1.5rem; font-weight: 700; color: var(--color-teal-400, #2dd4bf);" class="font-mono">
              ${Number(tenant.devicesCount || 2).toLocaleString('fa-IR')} <span style="font-size: 0.9rem; color: var(--text-secondary); font-weight: 400;">از ۴ پایانه مجاز</span>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.35rem;">استفاده ۵۰٪ · ۲ مجوز آزاد در پلن فعال</div>
            <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.08); border-radius: 999px; margin-top: 0.6rem; overflow: hidden;">
              <div style="width: 50%; height: 100%; background: var(--color-primary, #3b82f6); border-radius: 999px;"></div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h4 class="card-title">فضای ابری و اسناد مالی</h4></div>
          <div class="card-body">
            <div style="font-size: 1.5rem; font-weight: 700; color: var(--color-teal-400, #2dd4bf);" class="font-mono">
              ۴.۲ <span style="font-size: 0.9rem; color: var(--text-secondary); font-weight: 400;">از ۱۰ گیگابایت</span>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.35rem;">استفاده ۴۲٪ · وضعیت ذخیره‌سازی ابری پایدار</div>
            <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.08); border-radius: 999px; margin-top: 0.6rem; overflow: hidden;">
              <div style="width: 42%; height: 100%; background: var(--color-emerald-500, #10b981); border-radius: 999px;"></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 6: DEVICES PANEL -->
    <div class="dossier-panel" data-panel="devices" style="display: ${activeTab === 'devices' ? 'block' : 'none'};">
      <div class="card" style="margin-bottom: 1rem;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 600; color: var(--text-primary); font-size: 0.875rem;">ناوگان صندوق‌ها و پایانه‌های فروش ${esc(tenant.name)}</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.2rem;">پایش پوزها، پرینترهای حرارتی و کلاینت‌های آفلاین مستقر در شعب.</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="window.GMApp ? window.GMApp.showToast('فرمان همگام‌سازی با موفقیت به کلیه پایانه‌ها ارسال شد.', 'success') : null">
            همگام‌سازی پایانه‌ها (Sync)
          </button>
        </div>
      </div>

      <div class="table-wrapper">
        <table class="data-table" aria-label="جدول پایانه‌های فروش و دستگاه‌های Edge مشتری">
          <thead>
            <tr>
              <th>نام پایانه و شناسه</th>
              <th>شعبه مستقر</th>
              <th>آدرس IP محلی</th>
              <th>وضعیت اتصال</th>
              <th>آخرین ضربان (Heartbeat)</th>
              <th>نسخه Edge</th>
              <th style="text-align: left;">اقدامات</th>
            </tr>
          </thead>
          <tbody>
            ${(tenantDevices.length > 0 ? tenantDevices : [
              { id: 'dev_pos_main_01', name: 'صندوق اصلی ۱ (Touch POS)', branch: 'شعبه مرکزی', ipAddress: '۱۹۲.۱۶۸.۱.۱۰۱', status: 'online', lastSync: 'هم‌اکنون (۵ ثانیه قبل)', appVersion: 'v2.4.1 (Stable)' },
              { id: 'dev_pad_salon_02', name: 'تبلت سالن ۲ (Waiter Pad)', branch: 'شعبه مرکزی', ipAddress: '۱۹۲.۱۶۸.۱.۱۰۵', status: 'online', lastSync: 'هم‌اکنون (۸ ثانیه قبل)', appVersion: 'v2.4.1 (Stable)' }
            ]).map(d => `
              <tr>
                <td>
                  <div style="font-weight: 600; color: var(--text-primary);">${esc(d.name)}</div>
                  <div class="cell-mono" style="font-size: 0.72rem; color: #64748b;">${esc(d.id)}</div>
                </td>
                <td>${esc(d.branch || 'شعبه مرکزی')}</td>
                <td class="cell-mono text-success">${esc(d.ipAddress || '۱۹۲.۱۶۸.۱.۱۰۱')}</td>
                <td><span class="badge ${d.status === 'online' ? 'badge-success' : 'badge-warning'}"><span class="badge-dot"></span> ${d.status === 'online' ? 'متصل و برخط' : 'آفلاین'}</span></td>
                <td class="cell-mono" style="font-size: 0.75rem;">${esc(d.lastSync || 'هم‌اکنون')}</td>
                <td class="cell-mono text-success">${esc(d.appVersion || 'v2.4.1 (Stable)')}</td>
                <td style="text-align: left;">
                  <button class="btn btn-sm btn-secondary" onclick="window.GMApp ? window.GMApp.showToast('دستور راه‌اندازی مجدد سرویس پوز ارسال شد', 'info') : null">راه‌اندازی مجدد</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 7: BACKUPS PANEL -->
    <div class="dossier-panel" data-panel="backups" style="display: ${activeTab === 'backups' ? 'block' : 'none'};">
      <div class="card" style="margin-bottom: 1rem;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 600; color: var(--text-primary); font-size: 0.875rem;">پشتیبان‌های ایزوله پایگاه‌داده ${esc(tenant.name)}</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.2rem;">ذخیره‌سازی رمزنگاری‌شده در دو دیتاسنتر داخلی مجزا (تهران و اصفهان).</div>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <button class="btn btn-secondary btn-sm" onclick="window.GMApp ? window.GMApp.showToast('فرایند دریل بازیابی در محیط ایزوله آغاز شد.', 'info') : null">
              اجرای دریل بازیابی اطلاعات
            </button>
            <button class="btn btn-primary btn-sm" onclick="window.triggerGM20ManualBackup('${tenant.id}')">
              تهیه بکاپ اضطراری
            </button>
          </div>
        </div>
      </div>

      <div class="table-wrapper">
        <table class="data-table" aria-label="جدول نسخه‌های پشتیبان و اسنپ‌شات‌های مشتری">
          <thead>
            <tr>
              <th>شناسه اسنپ‌شات</th>
              <th>زمان ایجاد</th>
              <th>نوع نسخه</th>
              <th>حجم فایل</th>
              <th>چک‌سام SHA-256</th>
              <th>تست یکپارچگی</th>
              <th style="text-align: left;">اقدام</th>
            </tr>
          </thead>
          <tbody>
            ${(tenantBackups.length > 0 ? tenantBackups : [
              { id: 'snp_westo_14031020_0300', createdAt: 'امروز ۰۳:۰۰ بامداد', type: 'پشتیبان کامل شبانه', size: '۲۸۴ مگابایت', sha256: 'e3b0c44298fc1c149afbf4c8...', restoreTestStatus: 'passed' }
            ]).map(b => `
              <tr>
                <td class="cell-mono">${esc(b.id)}</td>
                <td>${esc(b.createdAt || 'امروز ۰۳:۰۰')}</td>
                <td><span class="badge badge-neutral">${esc(b.type || 'پشتیبان ایزوله')}</span></td>
                <td class="cell-mono">${esc(b.size || '۲۸۴ مگابایت')}</td>
                <td class="cell-mono text-success" style="font-size: 0.72rem;">${esc((b.sha256 || 'e3b0c44298fc1c149afbf4c8...').slice(0, 24))}...</td>
                <td><span class="badge badge-success">${esc(b.restoreTestStatus === 'passed' ? 'تطبیق کامل و تایید دریل' : 'صحت‌سنجی‌شده')}</span></td>
                <td style="text-align: left;">
                  <button class="btn btn-sm btn-secondary" onclick="window.GMApp ? window.GMApp.showToast('لینک دانلود امن پشتیبان صادر شد', 'info') : null">دریافت فایل</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 9: SUPPORT PANEL -->
    <div class="dossier-panel" data-panel="support" style="display: ${activeTab === 'support' ? 'block' : 'none'};">
      <div class="card" style="margin-bottom: 1rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
          <div>
            <div style="font-weight: 600; color: var(--text-primary); font-size: 0.875rem;">تیکت‌ها و نشست‌های پشتیبانی ${esc(tenant.name)}</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.2rem;">صف تیکت‌های پشتیبانی زنده و درخواست‌های بررسی فنی کلاینت NEEM.</div>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <a href="#gm-21-support" class="btn btn-secondary btn-sm">مرکز سراسری تیکت‌ها ↗</a>
            <button class="btn btn-primary btn-sm" onclick="window.GMApp ? window.GMApp.showToast('درخواست نشست امن پشتیبانی با کلاینت برقرار شد.', 'success') : null">
              ورود اضطراری پشتیبان (Support Session)
            </button>
          </div>
        </div>
      </div>
      <div class="table-wrapper">
        <table class="data-table" aria-label="جدول تیکت‌ها و تاریخچه پشتیبانی فنی مشتری">
          <thead>
            <tr>
              <th>شناسه تیکت</th>
              <th>موضوع و رده</th>
              <th>اولویت</th>
              <th>وضعیت</th>
              <th>ثبت‌کننده / ارجاع</th>
              <th>مهلت SLA</th>
              <th style="text-align: left;">اقدام</th>
            </tr>
          </thead>
          <tbody>
            ${tenantTickets.length === 0 ? `
              <tr>
                <td colspan="7" style="text-align: center; color: var(--text-secondary); padding: 2rem 1rem;">
                  هیچ تیکت فعالی برای این مشتری وجود ندارد. تمام سرویس‌های پشتیبانی در وضعیت پایدار هستند.
                </td>
              </tr>
            ` : tenantTickets.map(t => {
              const pBadge = t.priority === 'high' 
                ? '<span class="badge badge-danger">بالا</span>' 
                : (t.priority === 'medium' ? '<span class="badge badge-warning">متوسط</span>' : '<span class="badge badge-neutral">عادی</span>');
              const sBadge = t.status === 'open'
                ? '<span class="badge badge-primary"><span class="badge-dot"></span> در انتظار بررسی</span>'
                : (t.status === 'investigating' ? '<span class="badge badge-warning"><span class="badge-dot"></span> در حال بررسی</span>' : '<span class="badge badge-success"><span class="badge-dot"></span> برطرف‌شده</span>');
              return `
                <tr>
                  <td class="cell-mono" style="font-weight: 600;">${esc(t.id)}</td>
                  <td>
                    <div style="font-weight: 600; color: var(--text-primary); font-size: 0.82rem;">${esc(t.title)}</div>
                    <div style="font-size: 0.72rem; color: #64748b; margin-top: 2px;">${esc(t.category || 'پشتیبانی عمومی')}</div>
                  </td>
                  <td>${pBadge}</td>
                  <td>${sBadge}</td>
                  <td>
                    <div style="font-size: 0.8rem; color: var(--text-primary);">${esc(t.creator || 'کاربر کلاینت')}</div>
                    <div style="font-size: 0.7rem; color: #64748b;">${esc(t.assignedTo || 'ارجاع‌نشده')}</div>
                  </td>
                  <td>
                    <span class="cell-mono" style="font-size: 0.78rem; font-weight: 600; color: ${t.slaMinutesRemaining && t.slaMinutesRemaining <= 45 ? '#dc2626' : '#0284c7'};">
                      ${t.slaMinutesRemaining ? `${t.slaMinutesRemaining} دقیقه` : 'نامشخص'}
                    </span>
                  </td>
                  <td style="text-align: left;">
                    <button type="button" class="btn btn-secondary btn-sm" style="padding: 0.25rem 0.6rem; font-size: 0.75rem;" onclick="window.GMApp ? window.GMApp.openModal('رسیدگی به تیکت ' + '${esc(t.id)}', '<div class=\\'kv-list\\'><div class=\\'kv-item\\'><span class=\\'kv-label\\'>موضوع:</span><strong class=\\'text-primary\\'>${esc(t.title)}</strong></div><div class=\\'kv-item\\'><span class=\\'kv-label\\'>اولویت:</span><span>${esc(t.priority)}</span></div><div class=\\'kv-item\\'><span class=\\'kv-label\\'>وضعیت:</span><span>${esc(t.status)}</span></div></div><div style=\\'margin-top:1rem;\\'><label class=\\'form-label\\'>متن پاسخ پشتیبان</label><textarea class=\\'form-control\\' rows=\\'3\\' placeholder=\\'پاسخ فنی را وارد کنید...\\'></textarea><div style=\\'display:flex; justify-content:flex-end; gap:0.5rem; margin-top:0.75rem;\\'><button type=\\'button\\' class=\\'btn btn-secondary btn-sm\\' onclick=\\'window.GMApp.closeModal()\\'>انصراف</button><button type=\\'button\\' class=\\'btn btn-primary btn-sm\\' onclick=\\'window.GMApp.showToast(\\'پاسخ تیکت با موفقیت ثبت و ارسال شد\\', \\'success\\'); window.GMApp.closeModal();\\'>ارسال پاسخ</button></div></div>') : null">
                      پاسخ و مدیریت
                    </button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 10: AUDIT PANEL -->
    <div class="dossier-panel" data-panel="audit" style="display: ${activeTab === 'audit' ? 'block' : 'none'};">
      <div class="card" style="margin-bottom: 1rem;">
        <h4 class="card-title">تاریخچه اقدامات و رویدادهای ممیزی مختص ${esc(tenant.name)}</h4>
      </div>
      <div class="table-wrapper">
        <table class="data-table" aria-label="جدول تاریخچه رویدادهای ممیزی و امنیتی مشتری">
          <thead>
            <tr>
              <th>زمان رویداد</th>
              <th>عامل اقدام‌کننده</th>
              <th>عملیات</th>
              <th>دامنه اثر</th>
              <th>نتیجه</th>
            </tr>
          </thead>
          <tbody>
            ${(tenantAuditLogs.length > 0 ? tenantAuditLogs : [
              { timestamp: 'امروز ۱۱:۱۵', actor: 'سامان فلاح (مالک)', description: 'تغییر تعرفه منوی نوشیدنی‌ها', scope: 'menu.item.update', result: 'success' },
              { timestamp: 'دیروز ۰۳:۰۰', actor: 'سیستم خودکار نیم', description: 'ایجاد بکاپ کامل شبانه', scope: 'backup.snapshot.wal', result: 'success' }
            ]).map(a => `
              <tr>
                <td class="cell-mono" style="font-size: 0.75rem;">${esc(a.timestamp || 'هم‌اکنون')}</td>
                <td>${esc(a.actor || 'اپراتور')}</td>
                <td>${esc(a.description || a.action || 'عملیات سیستمی')}</td>
                <td class="cell-mono">${esc(a.scope || a.action || '-')}</td>
                <td><span class="badge ${a.result === 'success' ? 'badge-success' : 'badge-danger'}">${a.result === 'success' ? 'موفقیت‌آمیز' : 'ناموفق'}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- DANGER ZONE: TENANT ARCHIVE, BAN & DEACTIVATION -->
      <section class="card danger-zone-card" id="danger-zone-section" style="margin-top: 1.75rem; border: 1px solid rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.03); border-radius: 10px; padding: 1.25rem;" aria-label="ناحیه بحرانی و مسدودسازی حساب مشتری">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 280px;">
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem;">
              <span style="font-size: 1.25rem;" aria-hidden="true">⛔</span>
              <h4 style="margin: 0; font-size: 0.95rem; font-weight: 700; color: #ef4444;">
                ناحیه بحرانی: غیرفعال‌سازی، مسدودسازی کامل (Ban) و انتقال به آرشیو مشتریان
              </h4>
              ${(tenant.status === 'archived' || tenant.status === 'banned') ? '<span class="badge badge-danger" style="font-size: 0.725rem;">مسدود و بایگانی‌شده</span>' : ''}
            </div>
            <p style="font-size: 0.813rem; color: var(--text-secondary); margin: 0 0 0.5rem 0; line-height: 1.6;">
              با اجرای این عملیات تحت تمهیدات امنیتی، دسترسی مالک و کلیه پرسنل لغو، تمامی نشست‌های فعال ابطال، پایانه‌های فروش و Edge قطع اتصال شده و این حساب به صورت کامل <strong>مسدود (Ban)</strong> و به <strong>بخش آرشیو مشتریان</strong> منتقل می‌گردد.
            </p>
            ${tenant.bannedReason ? `
              <div style="font-size: 0.775rem; color: #b91c1c; background: rgba(239, 68, 68, 0.08); padding: 0.5rem 0.75rem; border-radius: 6px; margin-top: 0.5rem; border: 1px solid rgba(239, 68, 68, 0.2);">
                <strong>علت مسدودسازی و بایگانی:</strong> ${esc(tenant.bannedReason)} (${esc(tenant.bannedAt || tenant.updatedAt || 'هم‌اکنون')})
              </div>
            ` : ''}
          </div>

          <div style="display: flex; gap: 0.5rem; align-items: center;">
            ${(tenant.status === 'archived' || tenant.status === 'banned') ? `
              <button 
                type="button" 
                class="btn btn-outline-cyan btn-sm"
                onclick="window.openUnarchiveModal('${esc(tenant.id)}', '${esc(tenant.name)}')"
                id="btn-unarchive-tenant"
              >
                ✓ خروج از آرشیو و رفع مسدودی (Unban)
              </button>
            ` : `
              <button 
                type="button" 
                class="btn btn-danger btn-sm" 
                style="background: #dc2626; border-color: #b91c1c; color: #fff; font-weight: 600; padding: 0.5rem 1rem;"
                onclick="window.openArchiveAndBanModal('${esc(tenant.id)}', '${esc(tenant.name)}', '${esc(tenant.slug || tenant.id)}')"
                id="btn-archive-ban-tenant"
              >
                ⛔ غیرفعال‌سازی، بن و انتقال به آرشیو
              </button>
            `}
          </div>
        </div>
      </section>
    </div>
    `}
  `;
};

// --- Settings-01 Validation & Actions for GM-04 ---
window.clearGM04InputError = function(inputEl) {
  if (window.GMApp && typeof window.GMApp.clearFieldError === 'function') {
    window.GMApp.clearFieldError(inputEl);
  }
};

window.validateGM04Settings = function() {
  const errors = [];
  const nameEl = document.getElementById('tenant-input-name');
  const ownerEl = document.getElementById('tenant-input-owner');
  const phoneEl = document.getElementById('tenant-input-phone');
  const domainEl = document.getElementById('tenant-input-domain');

  if (nameEl) {
    const nameVal = (nameEl.value || '').trim();
    if (!nameVal || nameVal.length < 3) {
      errors.push({ element: nameEl, message: 'نام تجاری کسب‌وکار الزامی است و باید حداقل ۳ نویسه باشد.' });
    }
  }

  if (ownerEl) {
    const ownerVal = (ownerEl.value || '').trim();
    if (!ownerVal || ownerVal.length < 3) {
      errors.push({ element: ownerEl, message: 'نام و نام خانوادگی مالک الزامی است و باید حداقل ۳ نویسه باشد.' });
    }
  }

  if (phoneEl) {
    const rawPhone = (phoneEl.value || '').trim();
    const fa = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
    const ar = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
    let phoneDigits = rawPhone;
    for (let i = 0; i < 10; i++) {
      phoneDigits = phoneDigits.split(fa[i]).join(String(i)).split(ar[i]).join(String(i));
    }
    if (!phoneDigits || !/^09\d{9}$/.test(phoneDigits)) {
      errors.push({ element: phoneEl, message: 'شماره تماس باید ۱۱ رقم با پیش‌شماره ۰۹ باشد (مانند ۰۹۱۲۰۰۰۰۰۰۰).' });
    }
  }

  if (domainEl) {
    const domVal = (domainEl.value || '').trim();
    if (!domVal || domVal.length < 3) {
      errors.push({ element: domainEl, message: 'دامنه اختصاصی الزامی است و باید معتبر باشد.' });
    }
  }

  return errors;
};

window.saveGM04Settings = function(tenantId) {
  const errors = window.validateGM04Settings();
  if (errors.length > 0) {
    errors.forEach(err => {
      if (window.GMApp && typeof window.GMApp.setFieldError === 'function') {
        window.GMApp.setFieldError(err.element, err.message);
      }
    });
    if (errors[0].element && typeof errors[0].element.focus === 'function') {
      errors[0].element.focus();
    }
    if (window.GMApp && typeof window.GMApp.showToast === 'function') {
      window.GMApp.showToast('لطفاً خطاهای مشخص‌شده در فرم را برطرف نمایید.', 'warning');
    }
    return false;
  }

  // Persist only in the isolated prototype store. The returned storage marker
  // prevents this UI from claiming a database or control-plane write.
  const store = window.prototypeStore || window.GMStore;
  if (!store || typeof store.updateTenant !== 'function') {
    window.GMApp?.showToast?.('ذخیره‌سازی در این محیط در دسترس نیست.', 'error');
    return false;
  }

  const nameEl = document.getElementById('tenant-input-name');
  const orgEl = document.getElementById('tenant-input-org');
  const ownerEl = document.getElementById('tenant-input-owner');
  const phoneEl = document.getElementById('tenant-input-phone');
  const domainEl = document.getElementById('tenant-input-domain');
  const cellEl = document.getElementById('tenant-select-cell');
  const versionEl = document.getElementById('tenant-record-version');
  const result = store.updateTenant(tenantId, {
    name: nameEl?.value,
    organization: orgEl?.value,
    ownerName: ownerEl?.value,
    ownerPhone: phoneEl?.value,
    domain: domainEl?.value,
    cellId: cellEl?.value
  }, { expectedVersion: Number(versionEl?.value || 1) });

  if (!result?.success) {
    window.GMApp?.showToast?.(result?.error || 'ذخیره تغییرات انجام نشد.', result?.code === 'VERSION_CONFLICT' ? 'warning' : 'error');
    return false;
  }
  if (versionEl) versionEl.value = String(result.tenant.version);

  window.GMApp?.showToast?.('تغییرات فقط در دادهٔ نمونهٔ همین مرورگر ذخیره شد.', 'info');
  return true;
};

window.confirmRollbackGM04Settings = function(tenantId) {
  const modalHtml = `
    <div style="padding: 0.5rem 0;">
      <p style="color: var(--text-secondary); margin-bottom: 1.25rem; line-height: 1.6; font-size: 0.875rem;">
        آیا از واگردانی تغییرات فرم به مقادیر اولیه اطمینان دارید؟ تمام فیلدهای تغییریافته به مقادیر ثبت‌شده در سامانه بازنشانی خواهند شد.
      </p>
      <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
        <button type="button" class="btn btn-secondary btn-sm" onclick="window.GMApp && window.GMApp.closeModal ? window.GMApp.closeModal() : null">
          انصراف
        </button>
        <button type="button" class="btn btn-danger btn-sm" id="btnConfirmExecuteRollback" onclick="window.executeRollbackGM04('${tenantId}'); window.GMApp && window.GMApp.closeModal ? window.GMApp.closeModal() : null;">
          تأیید و واگردانی
        </button>
      </div>
    </div>
  `;

  if (window.GMApp && typeof window.GMApp.openModal === 'function') {
    window.GMApp.openModal('تأیید بازنشانی و واگردانی تنظیمات', modalHtml);
  } else {
    if (confirm('آیا از بازنشانی تنظیمات پرونده به مقادیر اولیه اطمینان دارید؟')) {
      window.executeRollbackGM04(tenantId);
    }
  }
};

window.executeRollbackGM04 = function(tenantId) {
  const store = window.prototypeStore || window.GMStore;
  const tenant = store && store.getTenant ? store.getTenant(tenantId) : null;
  if (!tenant) {
    window.GMApp?.showToast?.('پرونده مشتری پیدا نشد؛ بازنشانی انجام نشد.', 'error');
    return false;
  }

  const nameEl = document.getElementById('tenant-input-name');
  const orgEl = document.getElementById('tenant-input-org');
  const ownerEl = document.getElementById('tenant-input-owner');
  const phoneEl = document.getElementById('tenant-input-phone');
  const domainEl = document.getElementById('tenant-input-domain');
  const cellEl = document.getElementById('tenant-select-cell');

  if (nameEl) nameEl.value = tenant.name || '';
  if (orgEl) orgEl.value = tenant.organization || '';
  if (ownerEl) ownerEl.value = tenant.ownerName || '';
  if (phoneEl) phoneEl.value = tenant.ownerPhone || '';
  if (domainEl) domainEl.value = tenant.domain || '';
  if (cellEl) cellEl.value = tenant.cellId || 'cell-teh-01';
  const versionEl = document.getElementById('tenant-record-version');
  if (versionEl) versionEl.value = String(tenant.version || 1);

  // Clear errors
  [nameEl, orgEl, ownerEl, phoneEl, domainEl].forEach(el => {
    if (el && window.GMApp && typeof window.GMApp.clearFieldError === 'function') {
      window.GMApp.clearFieldError(el);
    }
  });

  if (window.GMApp && typeof window.GMApp.showToast === 'function') {
    window.GMApp.showToast('تنظیمات به مقادیر اولیه واگردانی شد.', 'info');
  }
  return true;
};

// --- Security Safeguards: Archive & Ban Modal for Customer Account ---
window.openArchiveAndBanModal = function(tenantId, tenantName, tenantSlug) {
  const store = window.prototypeStore || window.GMStore;
  const targetSlug = tenantSlug || tenantId;

  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 0.85rem;">
        <div style="color: #dc2626; font-weight: 700; font-size: 0.875rem; margin-bottom: 0.35rem;">
          ⚠️ تمهیدات و هشدار امنیتی (Security Safeguards):
        </div>
        <div style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.6;">
          شما در حال غیرفعال‌سازی و بن کامل حساب <strong>«${tenantName}»</strong> هستید. این اقدام بلافاصله اثرات زیر را اعمال می‌کند:
        </div>
        <ul style="margin: 0.5rem 1.25rem 0 0; padding: 0; font-size: 0.775rem; color: #b91c1c; line-height: 1.6;">
          <li>ابطال فوری تمامی نشست‌های احراز هویت و توکن‌های فعال مالک و کلیه کاربران</li>
          <li>مسدودسازی قطعی حساب و کاربران (Banned & Inactive)</li>
          <li>قطع ارتباط پایگاه‌داده و پایانه‌های محلی فروش (POS / KDS)</li>
          <li>انتقال خودکار پرونده به بخش آرشیو مشتریان سامانه</li>
        </ul>
      </div>

      <div class="form-group">
        <label class="form-label" for="modal-ban-reason">
          علت تصمیم امنیتی و مسدودسازی (الزامی جهت ثبت در دفتر کل ممیزی):
        </label>
        <textarea 
          id="modal-ban-reason" 
          class="form-control" 
          rows="2" 
          placeholder="علت مسدودی را وارد کنید (مثال: عدم رعایت مفاد قرارداد، تخلف مالی یا دستور مراجع قضایی)..."
          aria-label="دلیل مسدودسازی و بن مشتری"
        ></textarea>
      </div>

      <div class="form-group">
        <label class="form-label" for="modal-ban-confirm-input">
          جهت تایید قطعی، شناسه مشتری (<strong style="color: #dc2626;">${targetSlug}</strong>) یا کلمه <strong style="color: #dc2626;">تایید</strong> را تایپ کنید:
        </label>
        <input 
          type="text" 
          id="modal-ban-confirm-input" 
          class="form-control cell-mono" 
          placeholder="${targetSlug}"
          aria-label="تایید متنی شناسه جهت مسدودسازی"
        />
      </div>

      <div style="border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.08)); padding-top: 0.75rem;">
        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; font-size: 0.8rem; color: var(--text-primary);">
          <input type="checkbox" id="modal-ban-ack" />
          <span>مسئولیت امنیتی ابطال کامل نشست‌ها، بن حساب و بایگانی این مشتری را می‌پذیرم.</span>
        </label>
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal(`⛔ تمهیدات امنیتی: مسدودسازی و بایگانی ${tenantName}`, content, () => {
      const reasonEl = document.getElementById('modal-ban-reason');
      const reason = (reasonEl ? reasonEl.value : '').trim();
      const confirmInput = document.getElementById('modal-ban-confirm-input');
      const confirmVal = (confirmInput ? confirmInput.value : '').trim();
      const ackCheck = document.getElementById('modal-ban-ack');

      // Validation 1: Reason required
      if (!reason || reason.length < 3) {
        if (window.GMApp && typeof window.GMApp.setFieldError === 'function') {
          window.GMApp.setFieldError(reasonEl, 'ثبت دلیل تصمیم امنیتی الزامی است و باید حداقل ۳ نویسه باشد.');
        }
        if (window.GMApp && window.GMApp.showToast) {
          window.GMApp.showToast('لطفاً دلیل مستند مسدودسازی و بایگانی را وارد نمایید.', 'error');
        }
        return false;
      }

      // Validation 2: Typed confirmation required
      const normalizedConfirm = confirmVal.toLowerCase();
      const validConfirmations = [targetSlug.toLowerCase(), 'تایید', 'حذف', 'بن', tenantName.toLowerCase()];
      if (!validConfirmations.includes(normalizedConfirm)) {
        if (window.GMApp && typeof window.GMApp.setFieldError === 'function') {
          window.GMApp.setFieldError(confirmInput, `لطفاً عبارت «${targetSlug}» یا «تایید» را به درستی تایپ کنید.`);
        }
        if (window.GMApp && window.GMApp.showToast) {
          window.GMApp.showToast(`تایید متنی نادرست است. عبارت «${targetSlug}» یا «تایید» را وارد نمایید.`, 'error');
        }
        return false;
      }

      // Validation 3: Acknowledgement checkbox
      if (!ackCheck || !ackCheck.checked) {
        if (window.GMApp && window.GMApp.showToast) {
          window.GMApp.showToast('تایید چک‌باکس پذیرش مسئولیت امنیتی الزامی است.', 'error');
        }
        return false;
      }

      // Execute ban and archival in store
      if (store && typeof store.archiveAndBanTenant === 'function') {
        store.archiveAndBanTenant(tenantId, reason);
      } else if (store && typeof store.transitionTenantState === 'function') {
        store.transitionTenantState(tenantId, 'archived', reason);
      }

      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast(`حساب مشتری «${tenantName}» با موفقیت مسدود (Ban) و به بخش آرشیو مشتریان منتقل شد.`, 'success');
      }

      if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
        window.GMRouter.refresh();
      } else if (window.GMRouter && typeof window.GMRouter.handleRoute === 'function') {
        window.GMRouter.handleRoute();
      }
      return true;
    });
  }
};

window.openUnarchiveModal = function(tenantId, tenantName) {
  const store = window.prototypeStore || window.GMStore;

  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <p style="font-size: 0.813rem; color: var(--text-secondary); margin: 0; line-height: 1.6;">
        آیا از فعال‌سازی مجدد و خروج حساب مشتری <strong>«${tenantName}»</strong> از وضعیت بایگانی و مسدودی اطمینان دارید؟
      </p>
      <div class="form-group">
        <label class="form-label" for="modal-unarchive-reason">علت رفع مسدودی (الزامی):</label>
        <textarea id="modal-unarchive-reason" class="form-control" rows="2" placeholder="علت فعال‌سازی مجدد را وارد نمایید..."></textarea>
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal(`رفع مسدودی و خروج از آرشیو: ${tenantName}`, content, () => {
      const reasonEl = document.getElementById('modal-unarchive-reason');
      const reason = (reasonEl ? reasonEl.value : '').trim();

      if (!reason) {
        if (window.GMApp && window.GMApp.showToast) {
          window.GMApp.showToast('لطفاً دلیل رفع مسدودی را ثبت نمایید.', 'error');
        }
        return false;
      }

      if (store && typeof store.unarchiveTenant === 'function') {
        store.unarchiveTenant(tenantId, reason);
      } else if (store && typeof store.transitionTenantState === 'function') {
        store.transitionTenantState(tenantId, 'active', reason);
      }

      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast(`حساب مشتری «${tenantName}» فعال و از وضعیت آرشیو خارج شد.`, 'success');
      }

      if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
        window.GMRouter.refresh();
      } else if (window.GMRouter && typeof window.GMRouter.handleRoute === 'function') {
        window.GMRouter.handleRoute();
      }
      return true;
    });
  }
};
