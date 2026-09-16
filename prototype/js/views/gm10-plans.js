/**
 * prototype/js/views/gm10-plans.js
 * 
 * GM-10: پلن و قیمت (/plans)
 * ماتریس سطوح اشتراک، بسته‌های مرجع، سهمیه‌بندی منابع و مقایسه جامع
 */

window.renderGM10 = function() {
  const store = window.prototypeStore || window.GMStore;
  const plans = (store && store.state && store.state.plans) ? store.state.plans : [];
  const featuresCount = (store && typeof store.getFeaturesCount === 'function') ? store.getFeaturesCount() : 44;
  const displayPlanName = (planName) => String(planName || '')
    .replace(/Starter/gi, 'شروع')
    .replace(/Growth/gi, 'رشد')
    .replace(/Scale/gi, 'مقیاس‌پذیر')
    .replace(/Enterprise/gi, 'سراسری')
    .replace(/\s*\([^)]*\)\s*$/, '');
  const displayPlanDescription = (description) => String(description || '')
    .replace(/KDS/gi, 'نمایشگر آشپزخانه')
    .replace(/POS/gi, 'صندوق')
    .replace(/پوز/gi, 'صندوق');

  return `
    <div class="page-header gm10-page">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
          <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current" aria-current="page">پلن‌ها و تعرفه‌ها</span>
        </nav>
        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
          <h1>
            ماتریس پلن‌ها و سطوح تجاری NEEM
            <span class="page-code-badge">GM-10</span>
          </h1>
          <span class="badge badge-scope-global"><span class="status-dot dot-purple"></span> کلان پلتفرم</span>
        </div>
        <p>پیش‌نمایش بسته‌های قیمتی و سهمیه‌ای؛ قیمت قطعی، SLA و قرارداد عملیاتی از این صفحه صادر نمی‌شود.</p>
      </div>
      <div class="header-actions">
        <a href="#gm-05-tenant-new" class="btn btn-primary">
          شروع تحویل مشتری جدید
        </a>
        <button type="button" class="btn btn-secondary" onclick="window.GMViews.GM10.openPlanCompareDrawer()">
          مقایسه تخصصی سهمیه‌ها
        </button>
      </div>
    </div>

    <!-- Standardized Operational Guidance Banner -->
    <div class="op-context-banner op-context-warning" role="region" aria-label="راهنمای سطوح اشتراک و تخصیص سهمیه‌ها">
      <div class="op-context-header">
        <span>معماری بسته‌های اشتراک و سهمیه‌بندی منابع (Subscription Tiers &amp; Quota Governance)</span>
        <span class="badge badge-warning">Fixture؛ قرارداد منتشر نشده</span>
      </div>
      <div class="op-context-grid">
        <div class="op-context-item">
          <span class="op-context-label">سطوح اشتراک مصوب:</span>
          <span class="op-context-desc">۴ سطح سناریویی با ظرفیت‌های نمایشی؛ منبع نسخه‌دار قیمت و quota در Control Plane متصل نیست.</span>
        </div>
        <div class="op-context-item">
          <span class="op-context-label">پلن پیشنهادی برای شروع:</span>
          <span class="op-context-desc">پلن پیشنهادی فقط برای نمایش است؛ ظرفیت دستگاه، QR و بکاپ بدون قرارداد و metering معتبر قطعی نیست.</span>
        </div>
        <div class="op-context-item">
          <span class="op-context-label">اقدام استاندارد اپراتور:</span>
          <span class="op-context-desc">برای ایجاد حساب جدید روی «انتخاب پلن» کلیک کنید یا با «شناسنامه سهمیه» جزئیات دقیق منابع هر پلن را مشاهده فرمایید.</span>
        </div>
      </div>
    </div>

    <div class="data-quality-strip" role="status" aria-label="وضعیت منبع پلن‌ها و قیمت‌گذاری">
      <div class="data-quality-label"><span class="dq-badge-dot dot-cyan"></span><span>وضعیت قیمت‌گذاری</span></div>
      <div class="data-quality-grid">
        <span class="dq-badge"><span class="dq-badge-dot dot-purple"></span><span class="dq-dim-name">منبع</span><span class="dq-dim-val">${plans.length.toLocaleString('fa-IR')} سطح</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">پلن‌های قابل مشاهده</span><span class="dq-dim-val">${plans.length.toLocaleString('fa-IR')} سطح</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">وضعیت</span><span class="dq-dim-val">پیش‌نمایش تصمیم</span></span>
      </div>
      <span class="dq-action-hint"><span>قیمت‌ها و سهمیه‌ها برای مقایسهٔ رابط هستند؛ انتشار قرارداد واقعی نیازمند تأیید جداگانه است</span></span>
    </div>

    ${window.GMDataState ? window.GMDataState.renderFreshnessBar({
      viewId: 'GM10',
      sourceLabel: 'ماتریس سطوح اشتراک و سهمیه‌های پایه پلتفرم',
      sourceMode: 'local',
      totalCount: plans.length,
      countLabel: 'سطح پلن تجاری'
    }) : ''}

    ${(() => {
      const dataState = window.GMDataState ? window.GMDataState.getViewState('GM10') : { state: 'live' };
      if (dataState.state === 'failed' || dataState.state === 'error') {
        return window.GMDataState.renderFailedState({
          viewId: 'GM10',
          title: 'خطا در واکشی ماتریس پلن‌ها و قیمت‌ها',
          reason: 'ارتباط با سرویس مدیریت تعرفه و صورتحساب پلتفرم برقرار نشد.',
          errorCode: 'ERR_PLANS_MATRIX_UNAVAILABLE'
        });
      }
      if (dataState.state === 'empty') {
        return window.GMDataState.renderEmptyState({
          title: 'هیچ پلنی یافت نشد',
          description: 'ماتریس پلن‌های تجاری خالی است.',
          actionLabel: 'بارگذاری مجدد',
          actionHash: '#gm-10-plans'
        });
      }
      if (dataState.state === 'loading') {
        return window.GMDataState.renderSkeleton('table', 4);
      }
      if (dataState.state === 'stale') {
        return window.GMDataState.renderStaleBanner('GM10');
      }
      if (dataState.state === 'refreshing') {
        return window.GMDataState.renderRefreshingBanner ? window.GMDataState.renderRefreshingBanner('GM10') : '';
      }
      return '';
    })()}

    ${(window.GMDataState && ['failed', 'empty', 'error', 'loading'].includes(window.GMDataState.getViewState('GM10').state)) ? '' : `
    <!-- Plan recommendation & comparison tier cards -->
    <div class="plan-tier-grid" role="region" aria-label="خلاصه سطوح اشتراک پلتفرم">
      ${plans.map((p, idx) => {
        const isFlagship = p.name.includes('Growth');
        const posCount = idx * 2 + 2;
        return `
          <div class="plan-tier-card ${isFlagship ? 'is-flagship' : ''}" id="tier-card-${idx}" style="${isFlagship ? 'border-color: var(--gm-accent, #1a73e8); box-shadow: 0 4px 12px rgba(26, 115, 232, 0.12);' : ''}">
            <div class="plan-tier-header">
              <div class="plan-tier-badge-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <span class="badge ${isFlagship ? 'badge-primary' : 'badge-neutral'}">${isFlagship ? 'پیشنهاد محبوب' : (p.name.includes('Enterprise') ? 'سراسری' : 'استاندارد')}</span>
                <span class="cell-mono" style="font-size: 0.72rem; color: var(--text-tertiary);">سطح ${idx + 1}</span>
              </div>
              <h3 class="plan-tier-title" style="font-size: 1.1rem; font-weight: 700; margin: 0 0 0.25rem;">${displayPlanName(p.name)}</h3>
              <p class="plan-tier-desc" style="font-size: 0.75rem; color: var(--text-secondary); min-height: 2.2rem;">${displayPlanDescription(p.description)}</p>
            </div>

            <div class="plan-tier-price-box" style="margin: 0.75rem 0; padding: 0.65rem; background: var(--bg-surface-subtle, #f8f9fa); border-radius: 6px;">
              <span class="plan-tier-price" style="font-size: 1.25rem; font-weight: 800; color: var(--text-primary);">${p.price.toLocaleString('fa-IR')}</span>
              <span class="plan-tier-period" style="font-size: 0.75rem; color: var(--text-secondary);">تومان / ${p.period}</span>
            </div>

            <ul class="plan-tier-features-list" style="list-style: none; padding: 0; margin: 0 0 1rem; display: flex; flex-direction: column; gap: 0.4rem; font-size: 0.78rem;">
              <li class="plan-tier-feature-item" style="display: flex; align-items: center; gap: 0.4rem;">
                <span class="check-icon" style="color: #10b981;">✓</span>
                <span>${p.featuresCount.toLocaleString('fa-IR')} قابلیت تجاری</span>
              </li>
              <li class="plan-tier-feature-item" style="display: flex; align-items: center; gap: 0.4rem;">
                <span class="check-icon" style="color: #10b981;">✓</span>
                <span>ظرفیت ${posCount.toLocaleString('fa-IR')} پایانه صندوق</span>
              </li>
              <li class="plan-tier-feature-item" style="display: flex; align-items: center; gap: 0.4rem;">
                <span class="check-icon" style="color: #10b981;">✓</span>
                <span>پشتیبان‌گیری + ایزولاسیون</span>
              </li>
            </ul>

            <div class="plan-tier-actions" style="margin-top: auto; display: flex; flex-direction: column; gap: 0.4rem;">
              <a href="#gm-05-tenant-new?plan=${encodeURIComponent(p.name)}" 
                 class="btn ${isFlagship ? 'btn-primary' : 'btn-secondary'} btn-sm" 
                 style="width: 100%; justify-content: center;"
                 aria-label="شروع تحویل با پلن ${displayPlanName(p.name)}">
                شروع تحویل
              </a>
              <button type="button" 
                      class="btn btn-ghost btn-sm" 
                      style="width: 100%; justify-content: center; font-size: 0.72rem;"
                      onclick="window.GMViews.GM10.openPlanDetailDrawer('${p.name}')"
                      aria-label="مشاهده شناسنامه سهمیه ${displayPlanName(p.name)}">
                شناسنامه سهمیه
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <!-- Structured Comparison Matrix Table -->
    <section class="surface-panel plans-matrix" aria-labelledby="plans-matrix-title">
      <div class="table-toolbar">
        <div>
          <h2 id="plans-matrix-title" class="section-title" style="margin: 0;">مقایسه‌ی سریع پلن‌ها</h2>
          <p class="text-secondary" style="margin: 0.25rem 0 0; font-size: 0.75rem;">قیمت، ظرفیت و مناسب‌بودن هر سطح را در یک نگاه مقایسه کنید.</p>
        </div>
        <details class="progressive-disclosure">
          <summary>راهنمای تصمیم‌گیری</summary>
          <p class="text-secondary" style="margin: 0.5rem 0 0; font-size: 0.75rem;">برای شروع، پلنی را انتخاب کنید که ظرفیت دستگاه و تعداد قابلیت موردنیاز امروز را پوشش دهد؛ ارتقا در پرونده مشتری انجام می‌شود.</p>
        </details>
      </div>
      <div class="table-responsive">
        <table class="data-table" id="plansTable" aria-label="مقایسه پلن‌های تجاری">
          <thead>
            <tr>
              <th>پلن</th>
              <th>قیمت و دوره</th>
              <th>قابلیت‌های پایه</th>
              <th>ظرفیت دستگاه</th>
              <th>شرح کوتاه</th>
              <th class="cell-actions">اقدام</th>
            </tr>
          </thead>
          <tbody>
            ${plans.map((p, idx) => `
              <tr class="${idx === 2 ? 'is-recommended' : ''}">
                <td>
                  <strong class="text-primary">${displayPlanName(p.name)}</strong>
                  ${idx === 2 ? '<span class="badge badge-cyan" style="display: block; width: max-content; margin-top: 0.35rem;">پیشنهاد فعلی</span>' : ''}
                </td>
                <td class="cell-mono"><strong>${p.price.toLocaleString('fa-IR')}</strong><br><span class="text-secondary" style="font-size: 0.7rem;">تومان / ${p.period}</span></td>
                <td>${p.featuresCount.toLocaleString('fa-IR')} قابلیت</td>
                <td>${(idx * 2 + 2).toLocaleString('fa-IR')} پایانه صندوق</td>
                <td style="min-width: 220px;">${displayPlanDescription(p.description)}</td>
                <td class="cell-actions">
                  <a href="#gm-05-tenant-new?plan=${encodeURIComponent(p.name)}" class="btn ${idx === 2 ? 'btn-primary' : 'btn-secondary'} btn-sm" aria-label="ایجاد مشتری جدید با پلن ${displayPlanName(p.name)}">انتخاب پلن</a>
                  <button type="button" class="btn btn-ghost btn-sm" style="margin-top: 0.25rem; font-size: 0.7rem;" onclick="window.GMViews.GM10.openPlanDetailDrawer('${p.name}')" aria-label="مشاهده جزئیات کامل سهمیه پلن ${displayPlanName(p.name)}">شناسنامه سهمیه</button>
                  <details class="row-disclosure" style="margin-top: 0.45rem;">
                    <summary>جزئیات</summary>
                    <div class="text-secondary" style="font-size: 0.7rem; text-align: right; margin-top: 0.35rem;">پشتیبان‌گیری روزانه و ایزولاسیون کامل داده</div>
                  </details>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
    `}
  `;
};

window.GMViews = window.GMViews || {};
window.GMViews.GM10 = {
  render: window.renderGM10,

  openPlanDetailDrawer(planName) {
    const store = window.prototypeStore || window.GMStore;
    const plans = (store && store.state && store.state.plans) ? store.state.plans : [];
    const displayPlanName = (value) => String(value || '')
      .replace(/Starter/gi, 'شروع')
      .replace(/Growth/gi, 'رشد')
      .replace(/Scale/gi, 'مقیاس‌پذیر')
      .replace(/Enterprise/gi, 'سراسری')
      .replace(/\s*\([^)]*\)\s*$/, '');
    const plan = plans.find(p => p.name === planName || p.id === planName);
    if (!plan) {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast('پلن در کاتالوگ Fixture یافت نشد؛ جزئیات جایگزین نمایش داده نمی‌شود.', 'warning');
      }
      return;
    }

    const isEnterprise = plan.name.includes('Enterprise');
    const isScale = plan.name.includes('Scale');
    const isGrowth = plan.name.includes('Growth');

    const posQuota = isEnterprise ? 'نامحدود (تا ۵۰)' : isScale ? '۸ پایانه' : isGrowth ? '۴ پایانه' : '۲ پایانه';
    const ramQuota = isEnterprise ? '۸ گیگابایت اختصاصی' : isScale ? '۴ گیگابایت' : isGrowth ? '۲ گیگابایت' : '۱ گیگابایت';
    const storageQuota = isEnterprise ? '۱ ترابایت NVMe' : isScale ? '۲۰۰ گیگابایت' : isGrowth ? '۵۰ گیگابایت' : '۱۰ گیگابایت';
    const txQuota = isEnterprise ? 'نامحدود' : isScale ? '۵۰,۰۰۰ تراکنش' : isGrowth ? '۱۰,۰۰۰ تراکنش' : '۲,۰۰۰ تراکنش';
    const slaLevel = 'هدف طراحی؛ SLA قراردادی تأیید نشده';

    const content = `
      <div style="display: flex; flex-direction: column; gap: 1.25rem;">
        <!-- KPI Metric Cards -->
        <div class="drawer-kpi-grid">
          <div class="drawer-kpi-card">
            <div class="drawer-kpi-title">تعرفه نمایشی اشتراک</div>
            <div class="drawer-kpi-value" style="color: var(--accent-cyan); font-size: 1.05rem;">${plan.price.toLocaleString('fa-IR')} تومان</div>
            <div style="font-size: 0.75rem; color: var(--state-warning); margin-top: 0.25rem;">Fixture؛ Quote و دوره قراردادی صادر نشده</div>
          </div>

          <div class="drawer-kpi-card">
            <div class="drawer-kpi-title">ظرفیت پایانه صندوق</div>
            <div class="drawer-kpi-value" style="color: var(--text-primary); font-size: 1.05rem;">${posQuota}</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">مجوز اتصال سخت‌افزار</div>
          </div>

          <div class="drawer-kpi-card">
            <div class="drawer-kpi-title">قابلیت‌های همراه</div>
            <div class="drawer-kpi-value" style="color: var(--state-success); font-size: 1.05rem;">${plan.featuresCount.toLocaleString('fa-IR')} قابلیت</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">امکانات پیش‌فرض فعال</div>
          </div>

          <div class="drawer-kpi-card">
            <div class="drawer-kpi-title">سقف تراکنش ماهانه</div>
            <div class="drawer-kpi-value" style="color: var(--text-primary); font-size: 1.05rem;">${txQuota}</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">بدون افت کارایی پایگاه‌داده</div>
          </div>
        </div>

        <!-- 4D Synthetic Telemetry Audit Strip -->
        <div class="data-quality-strip" role="status" aria-label="ارزیابی کیفیت سهمیه پلن">
          <div class="data-quality-label"><span class="dq-badge-dot dot-cyan"></span><span>ممیزی سهمیه‌ها</span></div>
          <div class="data-quality-grid">
            <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">ایزولاسیون</span><span class="dq-dim-val">کامل</span></span>
            <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">تعهد SLA</span><span class="dq-dim-val">${slaLevel}</span></span>
            <span class="dq-badge"><span class="dq-badge-dot dot-purple"></span><span class="dq-dim-name">پشتیبان‌گیری</span><span class="dq-dim-val">${isGrowth || isScale || isEnterprise ? 'روزانه و کامل' : 'هفتگی'}</span></span>
            <span class="dq-badge"><span class="dq-badge-dot dot-cyan"></span><span class="dq-dim-name">تطابق قرارداد</span><span class="dq-dim-val">معتبر</span></span>
          </div>
        </div>

        <!-- Resource Quotas Table -->
        <div class="drawer-section">
          <h4 class="drawer-section-title">سهمیه‌بندی منابع زیرساخت و کانتینر</h4>
          <div style="display: flex; flex-direction: column; gap: 0.4rem; font-size: 0.813rem;">
            <div style="display: flex; justify-content: space-between; padding: 0.4rem 0; border-bottom: 1px solid var(--border-subtle);">
              <span style="color: var(--text-secondary);">حافظه رم کانتینر اختصاصی:</span>
              <span class="cell-mono text-cyan" style="font-weight: 600;">${ramQuota}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 0.4rem 0; border-bottom: 1px solid var(--border-subtle);">
              <span style="color: var(--text-secondary);">فضای ذخیره‌سازی ابری امن:</span>
              <span class="cell-mono" style="font-weight: 600; color: var(--text-primary);">${storageQuota}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 0.4rem 0; border-bottom: 1px solid var(--border-subtle);">
              <span style="color: var(--text-secondary);">سقف حساب‌های کاربری و پرسنل:</span>
              <span style="font-weight: 600; color: var(--text-primary);">${isEnterprise ? 'نامحدود' : isScale ? '۳۰ کاربر' : isGrowth ? '۱۰ کاربر' : '۳ کاربر'}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 0.4rem 0; border-bottom: 1px solid var(--border-subtle);">
              <span style="color: var(--text-secondary);">بافر آفلاین سفارشات صندوق:</span>
              <span style="font-weight: 600; color: var(--state-success);">۷ روز کش کامل محلی</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 0.4rem 0; border-bottom: 1px solid var(--border-subtle);">
              <span style="color: var(--text-secondary);">پشتیبانی و پاسخگویی:</span>
              <span style="font-weight: 600; color: var(--text-primary);">${isEnterprise ? 'مدیر حساب اختصاصی ۲۴/۷' : isScale ? 'تلفنی و تیکت فوری' : 'تیکت استاندارد'}</span>
            </div>
          </div>
        </div>

        <!-- Default Features Checklist -->
        <div class="drawer-section">
          <h4 class="drawer-section-title">امکانات و ماژول‌های فعال پیش‌فرض</h4>
          <div class="surface-subtle" style="padding: 0.75rem; border-radius: 6px; font-size: 0.813rem; line-height: 1.6;">
            <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.35rem;">
              <li style="display: flex; align-items: center; gap: 0.4rem;">
                <span style="color: var(--state-success); font-weight: bold;">✓</span>
                <span>مدیریت کاتالوگ منو، دسته‌بندی اقلام و قیمت‌گذاری چندسطحی</span>
              </li>
              <li style="display: flex; align-items: center; gap: 0.4rem;">
                <span style="color: var(--state-success); font-weight: bold;">✓</span>
                <span>ثبت سفارشات سالن و بیرون‌بر به همراه چاپ فیش صندوق</span>
              </li>
              ${isGrowth || isScale || isEnterprise ? `
                <li style="display: flex; align-items: center; gap: 0.4rem;">
                  <span style="color: var(--state-success); font-weight: bold;">✓</span>
                  <span>منوی آنلاین QR و ثبت سفارش مستقیم مهمانان سر میز</span>
                </li>
                <li style="display: flex; align-items: center; gap: 0.4rem;">
                  <span style="color: var(--state-success); font-weight: bold;">✓</span>
                  <span>باشگاه مشتریان پایه، مدیریت پرسنل و ثبت شیفت‌ها</span>
                </li>
              ` : ''}
              ${isScale || isEnterprise ? `
                <li style="display: flex; align-items: center; gap: 0.4rem;">
                  <span style="color: var(--state-success); font-weight: bold;">✓</span>
                  <span>نمایشگر آشپزخانه و مدیریت چند ایستگاه آماده‌سازی</span>
                </li>
                <li style="display: flex; align-items: center; gap: 0.4rem;">
                  <span style="color: var(--state-success); font-weight: bold;">✓</span>
                  <span>انبارداری فرمولاسیونی و محاسبه خودکار مصرف بر مبنای رسپی</span>
                </li>
              ` : ''}
              ${isEnterprise ? `
                <li style="display: flex; align-items: center; gap: 0.4rem;">
                  <span style="color: var(--state-success); font-weight: bold;">✓</span>
                  <span>حسابداری دوبل مالیاتی، اتصال مستقیم سامانه مودیان و وب‌هوک‌های اختصاصی</span>
                </li>
              ` : ''}
            </ul>
          </div>
        </div>

        <!-- CTA Toolbar -->
        <div class="drawer-cta-toolbar">
          <a href="#gm-05-tenant-new?plan=${encodeURIComponent(plan.name)}" 
             class="btn btn-primary drawer-cta-btn" 
             onclick="window.GMApp && window.GMApp.closeDrawer ? window.GMApp.closeDrawer() : null">
            <span>شروع تحویل مشتری با این پلن</span>
            <span>←</span>
          </a>
          <a href="#gm-08-features" 
             class="btn btn-secondary drawer-cta-btn" 
             onclick="window.GMApp && window.GMApp.closeDrawer ? window.GMApp.closeDrawer() : null">
            <span>مشاهده کاتالوگ قابلیت‌ها</span>
            <span>←</span>
          </a>
          <button type="button" 
                  class="btn btn-secondary drawer-cta-btn" 
                  onclick="window.GMViews.GM10.openPlanCompareDrawer()">
            <span>مقایسه تخصصی همه پلن‌ها</span>
            <span>←</span>
          </button>
        </div>
      </div>
    `;

    if (window.GMApp && window.GMApp.openDrawer) {
      window.GMApp.openDrawer(`شناسنامه سهمیه: ${displayPlanName(plan.name)}`, content, { subtitle: `مشخصات فنی، ظرفیت پایانه‌ها و سهمیه منابع` });
    } else if (typeof openDrawer === 'function') {
      openDrawer(`شناسنامه سهمیه: ${displayPlanName(plan.name)}`, content);
    }
  },

  openPlanCompareDrawer() {
    const store = window.prototypeStore || window.GMStore;
    const plans = (store && store.state && store.state.plans) ? store.state.plans : [];

    const content = `
      <div style="display: flex; flex-direction: column; gap: 1.25rem;">
        <div class="drawer-section">
          <p style="font-size: 0.813rem; color: var(--text-secondary); margin: 0 0 1rem; line-height: 1.5;">
            جدول تفصیلی زیر سهمیه‌ها و مرزهای عملیاتی هر یک از ۴ سطح اشتراک NEEM را برای برنامه‌ریزی مهاجرت و توسعه رستوران‌ها مشخص می‌کند.
          </p>

          <div class="table-responsive" style="border: 1px solid var(--border-default); border-radius: 8px;">
            <table class="data-table" style="font-size: 0.75rem; text-align: center;" aria-label="جدول تفصیلی مقایسه سهمیه‌ها و مرزهای عملیاتی پلن‌ها">
              <thead>
                <tr>
                  <th style="text-align: right;">شاخص مقایسه‌ای</th>
                  <th>شروع</th>
                  <th style="background: color-mix(in srgb, var(--accent-cyan) 8%, transparent); color: var(--accent-cyan);">رشد</th>
                  <th>مقیاس‌پذیر</th>
                  <th>سراسری</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="text-align: right; font-weight: 600;">تعرفه ماهانه</td>
                  <td class="cell-mono">۹۹۰,۰۰۰ ت</td>
                  <td class="cell-mono" style="background: color-mix(in srgb, var(--accent-cyan) 4%, transparent); font-weight: 700; color: var(--accent-cyan);">۱,۸۵۰,۰۰۰ ت</td>
                  <td class="cell-mono">۳,۴۰۰,۰۰۰ ت</td>
                  <td class="cell-mono">۶,۵۰۰,۰۰۰ ت</td>
                </tr>
                <tr>
                  <td style="text-align: right; font-weight: 600;">پایانه‌های صندوق</td>
                  <td>۲ صندوق</td>
                  <td style="background: color-mix(in srgb, var(--accent-cyan) 4%, transparent); font-weight: 600;">۴ صندوق</td>
                  <td>۸ صندوق</td>
                  <td>نامحدود</td>
                </tr>
                <tr>
                  <td style="text-align: right; font-weight: 600;">قابلیت‌های همراه</td>
                  <td>۸ قابلیت</td>
                  <td style="background: color-mix(in srgb, var(--accent-cyan) 4%, transparent); font-weight: 600;">۱۸ قابلیت</td>
                  <td>۳۲ قابلیت</td>
                  <td>${featuresCount.toLocaleString('fa-IR')} قابلیت (کامل)</td>
                </tr>
                <tr>
                  <td style="text-align: right; font-weight: 600;">سفارش آنلاین QR</td>
                  <td>—</td>
                  <td style="background: color-mix(in srgb, var(--accent-cyan) 4%, transparent); color: var(--state-success); font-weight: bold;">✓ فعال</td>
                  <td style="color: var(--state-success); font-weight: bold;">✓ فعال</td>
                  <td style="color: var(--state-success); font-weight: bold;">✓ فعال</td>
                </tr>
                <tr>
                  <td style="text-align: right; font-weight: 600;">نمایشگر آشپزخانه</td>
                  <td>—</td>
                  <td style="background: color-mix(in srgb, var(--accent-cyan) 4%, transparent);">افزونه جداگانه</td>
                  <td style="color: var(--state-success); font-weight: bold;">✓ فعال</td>
                  <td style="color: var(--state-success); font-weight: bold;">✓ فعال</td>
                </tr>
                <tr>
                  <td style="text-align: right; font-weight: 600;">انبارداری و رسپی آنالیز</td>
                  <td>—</td>
                  <td style="background: color-mix(in srgb, var(--accent-cyan) 4%, transparent);">افزونه جداگانه</td>
                  <td style="color: var(--state-success); font-weight: bold;">✓ فعال</td>
                  <td style="color: var(--state-success); font-weight: bold;">✓ فعال</td>
                </tr>
                <tr>
                  <td style="text-align: right; font-weight: 600;">حسابداری دوبل و مودیان</td>
                  <td>—</td>
                  <td style="background: color-mix(in srgb, var(--accent-cyan) 4%, transparent);">—</td>
                  <td>افزونه جداگانه</td>
                  <td style="color: var(--state-success); font-weight: bold;">✓ فعال</td>
                </tr>
                <tr>
                  <td style="text-align: right; font-weight: 600;">پشتیبان‌گیری دیتابیس</td>
                  <td>هفتگی</td>
                  <td style="background: color-mix(in srgb, var(--accent-cyan) 4%, transparent); font-weight: 600;">روزانه و کامل</td>
                  <td>ساعتی و کامل</td>
                  <td>پیوسته + DR سایت دوم</td>
                </tr>
                <tr>
                  <td style="text-align: right; font-weight: 600;">تعهد در دسترس بودن (SLA)</td>
                  <td>هدف طراحی</td>
                  <td style="background: color-mix(in srgb, var(--accent-cyan) 4%, transparent); font-weight: 600;">هدف طراحی</td>
                  <td>هدف طراحی</td>
                  <td>هدف طراحی</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- CTA Toolbar -->
        <div class="drawer-cta-toolbar">
          <a href="#gm-05-tenant-new?plan=Growth%20(%D8%B1%D8%B4%D8%AF)" 
             class="btn btn-primary drawer-cta-btn" 
             onclick="window.GMApp && window.GMApp.closeDrawer ? window.GMApp.closeDrawer() : null">
            <span>شروع تحویل با پلن رشد پیشنهادی</span>
            <span>←</span>
          </a>
          <button type="button" 
                  class="btn btn-secondary drawer-cta-btn" 
                  onclick="window.GMApp && window.GMApp.closeDrawer ? window.GMApp.closeDrawer() : null">
            <span>بستن و بازگشت به جدول پلن‌ها</span>
          </button>
        </div>
      </div>
    `;

    if (window.GMApp && window.GMApp.openDrawer) {
      window.GMApp.openDrawer('مقایسه جامع سطوح اشتراک (Plan Matrix Comparison)', content, { subtitle: 'ارزیابی تطبیقی امکانات، ظرفیت‌ها و سهمیه‌های ۴ گانه' });
    } else if (typeof openDrawer === 'function') {
      openDrawer('مقایسه جامع سطوح اشتراک (Plan Matrix Comparison)', content);
    }
  }
};
