/**
 * prototype/js/views/gm12-usage.js
 * 
 * GM-12: سهمیه و مصرف منابع پلتفرم (/usage)
 * پایش بلادرنگ مصرف دیسک، اتصالات دیتابیس، سقف صندوق‌های POS، ترافیک API و پیش‌بینی اتمام منابع
 */

window.renderGM12 = function(params) {
  const store = window.prototypeStore || window.GMStore;
  const tenants = store && store.getTenants ? store.getTenants() : [];
  const selectedTenantId = params?.id || (store ? store.getActiveTenantId() : 'tnt_westo_demo');
  const tenant = (store && store.getTenant ? store.getTenant(selectedTenantId) : null) || tenants[0] || { id: 'tnt_westo_demo', name: 'کافه وستو (Westo Café)', organization: 'مجموعه کافه‌رستوران وستو', cellId: 'cell-msh-01' };
  const cellLabel = {
    'cell-teh-01': 'تهران',
    'cell-msh-01': 'مشهد',
    'cell-mashhad-01': 'مشهد'
  }[tenant.cellId] || 'مرکز عملیاتی';
  const usage = (store && store.getUsage ? store.getUsage(tenant.id) : null) || {
    storageGb: { current: 4.8, limit: 25.0, percent: 19, unit: 'GB' },
    dbConnections: { current: 14, limit: 50, percent: 28, unit: 'اتصال' },
    posTerminals: { current: 4, limit: 12, percent: 33, unit: 'دستگاه' },
    activeBranches: { current: 1, limit: 5, percent: 20 },
    apiRequests24h: { current: 14250, limit: 100000, percent: 14 },
    monthlyTransactions: { current: 8940, limit: 50000, percent: 18 }
  };

  return `
    <div class="page-header gm12-page">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
          <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
          <span class="breadcrumb-separator">/</span>
          <a href="#gm-04-tenant-detail?id=${tenant.id}" class="breadcrumb-link">پرونده مشتری</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current" aria-current="page">سهمیه و مصرف منابع</span>
        </nav>
        <h1>
          سهمیه و مصرف منابع: ${tenant.name}
          <span class="badge scope-cell-badge">${cellLabel}</span>
          <span class="badge badge-scope-tenant"><span class="status-dot dot-active"></span> دامنه مشتری</span>
          <span class="page-code-badge">GM-12</span>
        </h1>
        <p>پایش بلادرنگ ذخیره‌سازی، اتصالات دیتابیس، سهمیه صندوق‌های متصل و پیش‌بینی ظرفیت</p>
      </div>
      <div class="header-actions">
        <a href="#gm-10-plans" class="btn btn-primary">
          ارتقای پلن و سهمیه
        </a>
        <button class="btn btn-secondary" onclick="window.GMApp ? window.GMApp.showToast('شاخص‌های مصرف منابع با موفقیت به‌روزرسانی شد.', 'success') : (typeof showToast === 'function' ? showToast('شاخص‌های مصرف به‌روز شد', 'success') : alert('شاخص‌های مصرف به‌روز شد'))">
          به‌روزرسانی سنجش
        </button>
      </div>
    </div>

    ${window.GMDataState ? window.GMDataState.renderFreshnessBar({
      viewId: 'GM12',
      sourceLabel: `سنجش بلادرنگ منابع سرور VPS برای ${tenant.name}`,
      sourceMode: 'local',
      totalCount: 6,
      countLabel: 'شاخص ظرفیت'
    }) : ''}

    <div class="data-quality-strip" role="status" aria-label="وضعیت داده‌های مصرف">
      <div class="data-quality-label"><span class="dq-badge-dot dot-cyan"></span><span>وضعیت سنجش</span></div>
      <div class="data-quality-grid">
        <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">منبع</span><span class="dq-dim-val">سامانه تله‌متری عملیاتی SALSA</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">دامنه</span><span class="dq-dim-val">${tenant.name}</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">اعتبار</span><span class="dq-dim-val">تأییدشده و برخط</span></span>
      </div>
      <span class="dq-action-hint"><span>شاخص‌های مصرف به‌صورت دوره‌ای از کنترل‌پلن و کلاینت وستو (۴۱۸۰) همگام می‌شوند.</span></span>
    </div>

    ${(() => {
      const dataState = window.GMDataState ? window.GMDataState.getViewState('GM12') : { state: 'live' };
      if (dataState.state === 'failed' || dataState.state === 'error') {
        return window.GMDataState.renderErrorState({
          viewId: 'GM12',
          title: 'خطا در دریافت تله‌متری مصرف منابع',
          reason: 'پاسخی از پروب‌های سنجش منابع سرور VPS دریافت نشد.',
          errorCode: 'ERR_USAGE_TELEMETRY_UNREACHABLE'
        });
      }
      if (dataState.state === 'empty') {
        return window.GMDataState.renderEmptyState({
          title: 'سنجش منبعی یافت نشد',
          description: 'هیچ حسگر یا پروبی برای مصرف منابع این مشتری فعال نیست.',
          actionLabel: 'به‌روزرسانی سنجش',
          onAction: "window.GMDataState.refreshView('GM12')"
        });
      }
      if (dataState.state === 'loading') {
        return window.GMDataState.renderSkeleton('cards', 6);
      }
      if (dataState.state === 'refreshing') {
        return window.GMDataState.renderRefreshingBanner('GM12');
      }
      if (dataState.state === 'stale') {
        return window.GMDataState.renderStaleBanner('GM12');
      }
      return '';
    })()}

    ${(window.GMDataState && ['failed', 'empty', 'error', 'loading'].includes(window.GMDataState.getViewState('GM12').state)) ? '' : `
    <details class="card progressive-disclosure operator-technical-details" style="margin-bottom: 1.15rem;">
      <summary>
        <span>راهنمای فنی سهمیه‌ها و مقیاس‌پذیری</span>
        <span class="badge badge-neutral">فرمول‌ها و سیاست‌ها</span>
      </summary>
      <div class="card-body">
        <div class="op-context-grid">
          <div class="op-context-item">
            <span class="op-context-label">سیاست مصرف بیش از حد:</span>
            <span class="op-context-desc">در صورت مصرف بیش از ۹۰٪ سهمیه، هشدار ارسال می‌شود؛ در صورت رسیدن به ۱۰۰٪، دسترسی به ایجاد رکورد جدید متوقف شده اما خواندن داده‌ها فعال می‌ماند (Stop-new, No-data-loss).</span>
          </div>
          <div class="op-context-item">
            <span class="op-context-label">رزرو اتمیک منابع:</span>
            <span class="op-context-desc">تخصیص سهمیه به صورت اتمیک و با قفل سطر انجام می‌شود تا از سرریز همزمان جلوگیری به عمل آید.</span>
          </div>
        </div>
      </div>
    </details>

    <!-- Tenant Correlation Bar -->
    <div class="tenant-correlation-bar" style="background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: 8px; padding: 0.65rem 1rem; margin-bottom: 1.25rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
      <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
        <span style="font-size: 0.813rem; font-weight: 600; color: var(--text-secondary);">سهمیه مصرفی رستوران:</span>
        ${tenants.map(t => `
          <a href="#gm-12-usage?id=${t.id}" class="filter-chip ${tenant.id === t.id ? 'active' : ''}">
            ${t.name.replace(/\s*\([^)]*\)\s*$/, '')} (${t.plan.split(' ')[0]})
          </a>
        `).join('')}
      </div>
      <div style="display: flex; gap: 0.5rem; align-items: center;">
        <a href="#gm-04-tenant-detail?id=${tenant.id}&tab=usage" class="btn btn-xs btn-secondary">
          پرونده سهمیه ${tenant.name}
        </a>
        <button class="btn btn-xs btn-primary" onclick="window.promptAdjustQuotas('${tenant.id}')">
          افزایش فوری سهمیه
        </button>
      </div>
    </div>

    <!-- Usage Metrics Grid -->
    <div class="grid-cols-3" style="margin-bottom: 1.25rem;">
      <!-- 1. Cloud Storage -->
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <h3 style="font-size: 0.875rem; font-weight: 600; color: var(--text-primary); margin: 0;">فضای ذخیره‌سازی دیتابیس و فایل</h3>
          <span class="badge ${usage.storageGb.percent >= 90 ? 'badge-danger' : usage.storageGb.percent >= 70 ? 'badge-warning' : 'badge-neutral'}">${usage.storageGb.percent}٪</span>
        </div>
        <div style="font-size: 1.4rem; font-weight: 700; color: var(--accent-cyan); font-family: var(--font-mono); margin: 0.35rem 0;">
          ${usage.storageGb.current} / ${usage.storageGb.limit} ${usage.storageGb.unit}
        </div>
        <div class="metric-meter" role="progressbar" aria-label="فضای ذخیره‌سازی دیتابیس و فایل" aria-valuenow="${usage.storageGb.percent}" aria-valuemin="0" aria-valuemax="100" style="margin: 0.5rem 0;">
          <div class="metric-meter-track">
            <div class="metric-meter-fill ${usage.storageGb.percent >= 90 ? 'danger' : usage.storageGb.percent >= 70 ? 'warning' : 'normal'}" style="width: ${usage.storageGb.percent}%;"></div>
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-tertiary);">
          <span>پیش‌بینی: محاسبه نشده</span>
          <span>منبع: متصل نیست</span>
        </div>
      </div>

      <!-- 2. DB Connections Pool -->
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <h3 style="font-size: 0.875rem; font-weight: 600; color: var(--text-primary); margin: 0;">اتصالات فعال پایگاه داده</h3>
          <span class="badge ${usage.dbConnections.percent >= 90 ? 'badge-danger' : usage.dbConnections.percent >= 70 ? 'badge-warning' : 'badge-neutral'}">${usage.dbConnections.percent}٪</span>
        </div>
        <div style="font-size: 1.4rem; font-weight: 700; color: var(--state-success); font-family: var(--font-mono); margin: 0.35rem 0;">
          ${usage.dbConnections.current} / ${usage.dbConnections.limit} ${usage.dbConnections.unit}
        </div>
        <div class="metric-meter" role="progressbar" aria-label="اتصالات استخر دیتابیس" aria-valuenow="${usage.dbConnections.percent}" aria-valuemin="0" aria-valuemax="100" style="margin: 0.5rem 0;">
          <div class="metric-meter-track">
            <div class="metric-meter-fill ${usage.dbConnections.percent >= 90 ? 'danger' : usage.dbConnections.percent >= 70 ? 'warning' : 'meter-success'}" style="width: ${usage.dbConnections.percent}%;"></div>
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-tertiary);">
          <span>اتصالات ایزوله</span>
          <span>پیک مصرف: نامشخص</span>
        </div>
      </div>

      <!-- 3. POS Devices Quota -->
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <h3 style="font-size: 0.875rem; font-weight: 600; color: var(--text-primary); margin: 0;">سهمیه صندوق‌های فروش (POS)</h3>
          <span class="badge ${usage.posTerminals.percent >= 90 ? 'badge-danger' : usage.posTerminals.percent >= 70 ? 'badge-warning' : 'badge-neutral'}">${usage.posTerminals.percent}٪</span>
        </div>
        <div style="font-size: 1.4rem; font-weight: 700; color: var(--state-warning); font-family: var(--font-mono); margin: 0.35rem 0;">
          ${usage.posTerminals.current} / ${usage.posTerminals.limit} ${usage.posTerminals.unit}
        </div>
        <div class="metric-meter" role="progressbar" aria-label="سهمیه صندوق‌های فروش" aria-valuenow="${usage.posTerminals.percent}" aria-valuemin="0" aria-valuemax="100" style="margin: 0.5rem 0;">
          <div class="metric-meter-track">
            <div class="metric-meter-fill ${usage.posTerminals.percent >= 90 ? 'danger' : usage.posTerminals.percent >= 70 ? 'warning' : 'normal'}" style="width: ${usage.posTerminals.percent}%;"></div>
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-tertiary); align-items: center;">
          <span>ظرفیت آزاد: نامشخص</span>
          <button class="btn btn-secondary btn-sm" onclick="window.GMApp ? window.GMApp.showToast('درخواست افزایش سقف صندلی به بخش فروش ثبت شد', 'info') : (typeof showToast === 'function' ? showToast('ثبت شد', 'info') : alert('ثبت شد'))" style="padding: 1px 6px; font-size: 0.688rem;">افزایش سقف</button>
        </div>
      </div>
    </div>

    <!-- Detailed Quota Table -->
    <div class="card card-flush">
      <div class="card-header">
        <div class="card-title-group">
          <h3 class="card-title">ماتریس سهمیه‌های قرارداد و ظرفیت‌های مجاز</h3>
          <p class="card-subtitle">بر اساس پلن تجاری و افزونه‌های فعال مندرج در قرارداد رسمی</p>
        </div>
      </div>
      <div class="table-container">
        <table class="data-table" aria-label="جدول ماتریس سهمیه‌های قرارداد و ظرفیت‌های مجاز">
          <thead>
            <tr>
              <th>عنوان منبع یا سهمیه</th>
              <th>مصرف جاری</th>
              <th>سقف تعیین‌شده در پلن</th>
              <th>درصد استفاده و وضعیت</th>
              <th>رفتار پس از پرشدن سقف</th>
              <th class="cell-actions">عملیات</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong style="color: var(--text-primary);">شعبه‌های فیزیکی فعال</strong></td>
              <td class="cell-mono font-bold">${usage.activeBranches.current} شعبه</td>
              <td class="cell-mono" style="color: var(--text-secondary);">${usage.activeBranches.limit} شعبه مجاز</td>
              <td>
                <div class="metric-meter metric-meter-compact" role="progressbar" aria-label="درصد استفاده از شعبه‌های مجاز" aria-valuenow="${usage.activeBranches.percent}" aria-valuemin="0" aria-valuemax="100">
                  <div class="metric-meter-track">
                    <div class="metric-meter-fill ${usage.activeBranches.percent >= 90 ? 'danger' : usage.activeBranches.percent >= 70 ? 'warning' : 'normal'}" style="width: ${usage.activeBranches.percent}%;"></div>
                  </div>
                  <span class="metric-meter-val">${usage.activeBranches.percent}٪</span>
                </div>
              </td>
              <td style="font-size: 0.75rem; color: var(--text-secondary);">توقف ایجاد شعبه جدید تا ارتقای پلن</td>
              <td class="cell-actions">
                <button class="btn btn-secondary btn-sm" onclick="window.GMApp ? window.GMApp.showToast('سهمیه شعب بر اساس لایسنس چندشعبه‌ای مدیریت می‌شود', 'info') : null" aria-label="تنظیم سهمیه شعبه">تنظیم</button>
              </td>
            </tr>
            <tr>
              <td><strong style="color: var(--text-primary);">درخواست‌های سرویس در ۲۴ ساعت</strong></td>
              <td class="cell-mono font-bold">${usage.apiRequests24h.current.toLocaleString('fa-IR')}</td>
              <td class="cell-mono" style="color: var(--text-secondary);">${usage.apiRequests24h.limit.toLocaleString('fa-IR')} فراخوانی</td>
              <td>
                <div class="metric-meter metric-meter-compact" role="progressbar" aria-label="درصد استفاده از سهمیه API" aria-valuenow="${usage.apiRequests24h.percent}" aria-valuemin="0" aria-valuemax="100">
                  <div class="metric-meter-track">
                    <div class="metric-meter-fill meter-success" style="width: ${usage.apiRequests24h.percent}%;"></div>
                  </div>
                  <span class="metric-meter-val">${usage.apiRequests24h.percent}٪</span>
                </div>
              </td>
              <td style="font-size: 0.75rem; color: var(--text-secondary);">کاهش سرعت درخواست‌ها بدون قطع پایانه محلی</td>
              <td class="cell-actions">
                <button class="btn btn-secondary btn-sm" onclick="window.GMApp ? window.GMApp.showToast('تنظیم سهمیه نرخ درخواست‌ها با موفقیت اعمال شد.', 'success') : null" aria-label="ثبت تنظیم سهمیه API">تنظیم سهمیه</button>
              </td>
            </tr>
            <tr>
              <td><strong style="color: var(--text-primary);">تراکنش‌ها و فاکتورهای ماهانه</strong></td>
              <td class="cell-mono font-bold">${usage.monthlyTransactions.current.toLocaleString('fa-IR')} سفارش</td>
              <td class="cell-mono" style="color: var(--text-secondary);">${usage.monthlyTransactions.limit.toLocaleString('fa-IR')} سفارش</td>
              <td>
                <div class="metric-meter metric-meter-compact" role="progressbar" aria-label="درصد تراکنش‌های ماهانه" aria-valuenow="${usage.monthlyTransactions.percent}" aria-valuemin="0" aria-valuemax="100">
                  <div class="metric-meter-track">
                    <div class="metric-meter-fill meter-success" style="width: ${usage.monthlyTransactions.percent}%;"></div>
                  </div>
                  <span class="metric-meter-val">${usage.monthlyTransactions.percent}٪</span>
                </div>
              </td>
              <td style="font-size: 0.75rem; color: var(--text-secondary);">نامحدود طبق قرارداد (فقط پایش مصرف غیرعادی)</td>
              <td class="cell-actions">
                <button class="btn btn-secondary btn-sm" onclick="window.GMApp ? window.GMApp.showToast('آستانه تراکنش‌های مشکوک فعال است', 'info') : null" aria-label="تنظیم سهمیه تراکنش">تنظیم</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    `}
  `;
};

window.promptAdjustQuotas = function(tenantId) {
  const store = window.prototypeStore || window.GMStore;
  const tid = tenantId || (store ? store.getActiveTenantId() : 'tnt_westo_demo');
  const tenant = (store && store.getTenant ? store.getTenant(tid) : null) || { name: 'مجموعه' };
  const newQuota = prompt(`سقف سهمیه فضای ابری برای «${tenant.name}» (گیگابایت):`, '100');
  if (!newQuota) return;

  if (store && store.addActivity) {
    store.addActivity({
      type: 'quota_adjusted',
      severity: 'info',
      title: `افزایش سهمیه منابع ${tenant.name}`,
      description: `سقف ذخیره‌سازی ابری به ${newQuota} گیگابایت افزایش یافت.`,
      subsystem: 'Usage',
      route: '#gm-12-usage?id=' + tid,
      routeLabel: 'GM-12 سهمیه و مصرف',
      actor: 'SuperAdmin'
    });
  }

  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast(`سهمیه جدید برای ${tenant.name} با موفقیت در پایگاه داده اعمال شد.`, 'success');
  }
  if (window.location && window.GMRouter && typeof window.GMRouter.handleRoute === 'function') {
    window.GMRouter.handleRoute();
  }
};

window.GMViews = window.GMViews || {};
window.GMViews.GM12 = {
  render(params) {
    return window.renderGM12(params);
  }
};
