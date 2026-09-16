/**
 * prototype/js/views/gm06-provisioning.js
 * 
 * GM-06: آماده‌سازی و تحویل (/provisioning/:jobId)
 * پیگیری لحظه‌ای پیشرفت، استپر مراحل، شبیه‌سازی Retry، لاگ خط‌به‌خط و خلاصه تحویل
 */

window.GMViews = window.GMViews || {};

function generateJobLogs(job) {
  const logs = [
    { time: '14:28:10', level: 'INFO', text: `آغاز اجرای فرآیند آماده‌سازی خودکار برای کار ${job.id}` },
    { time: '14:28:11', level: 'INFO', text: `تخصیص کانتینر ایزوله در منطقه تهران (سلول cell-teh-01)` },
    { time: '14:28:12', level: 'SUCCESS', text: `گام ۱: اعتبارسنجی دامنه و یکتایی نام تجاری «${job.tenantName}» با موفقیت انجام شد.` },
    { time: '14:28:14', level: 'INFO', text: `دریافت قالب صفر-داده tpl-blank-restaurant-full و اعتبارسنجی چک‌سام SHA-256` },
    { time: '14:28:15', level: 'SUCCESS', text: `گام ۲: ساختار اولیه حساب خام، جداول دیتابیس و کاتالوگ پیش‌فرض با موفقیت اعمال شد.` },
  ];
  if (job.status === 'failed') {
    logs.push({ time: '14:28:18', level: 'WARN', text: `تلاش برای برقراری اتصال به Agent محلی در پورت ۸۴۴۳ (تلاش ${job.retryCount || 1} از ۳)...` });
    logs.push({ time: '14:28:25', level: 'ERROR', text: `گام ۳: خطای تایم‌اوت ارتباط با Agent محلی Cell (ERR-CELL-TIMEOUT-504) — توقف خودکار پردازش.` });
  } else if (job.status === 'running') {
    logs.push({ time: '14:28:18', level: 'INFO', text: `گام ۳: تخصیص سهمیه دیتابیس ایزوله در حال اجرا...` });
  } else {
    logs.push({ time: '14:28:18', level: 'SUCCESS', text: `گام ۳: تخصیص سهمیه دیتابیس ایزوله و اعمال سهمیه‌های مصرف با موفقیت پایان یافت.` });
    logs.push({ time: '14:28:20', level: 'SUCCESS', text: `گام ۴: پیامک فعال‌سازی حساب و لینک ورود یکبارمصرف به شماره مالک ارسال شد.` });
    logs.push({ time: '14:28:21', level: 'SUCCESS', text: `آماده‌سازی خودکار با موفقیت پایان یافت. شناسه دسترسی تحویل ثبت شد.` });
  }
  return logs.map(log => ({
    ...log,
    level: log.level === 'SUCCESS' ? 'INFO' : log.level,
    text: log.text
  }));
}

window.renderGM06 = function(params) {
  const store = window.prototypeStore || window.GMStore;
  const jobs = store && store.getJobs ? store.getJobs() : [];
  const jobId = params?.jobId || (jobs[0] ? jobs[0].id : 'JOB-9021');
  const job = (store && store.getJob ? store.getJob(jobId) : null) || jobs[0] || {
    id: jobId,
    tenantName: 'کافه وستو (Westo Café)',
    tenantId: 'tnt_westo_demo',
    step: 'ایجاد دیتابیس ایزوله',
    progressPercent: 65,
    retryCount: 1,
    status: 'failed',
    errorMessage: 'تایم‌اوت ارتباط با Agent محلی Cell',
    steps: []
  };
  const zeroDataVerified = true;
  const zeroDataLabel = 'تأییدشده و آماده تحویل به مشتری';
  const zeroDataBadgeClass = 'badge-success';
  const jobStatusLabel = job.status === 'failed' ? 'نیازمند اقدام' : job.status === 'completed' ? 'تکمیل‌شده' : 'در حال پردازش';
  const jobSource = 'موتور تحویل خودکار NEEM Provisioning';
  const logs = generateJobLogs(job);

  const stepsList = (job.steps && job.steps.length > 0) ? job.steps : [
    { name: 'اعتبارسنجی دامنه و یکتایی نام تجاری', status: 'completed' },
    { name: 'ایجاد ساختار اولیه حساب خام از Template', status: 'completed' },
    { name: 'تخصیص سهمیه دیتابیس ایزوله', status: job.status === 'failed' ? 'failed' : 'completed' },
    { name: 'ارسال پیامک دعوت مالک رستوران', status: job.status === 'completed' ? 'completed' : 'pending' }
  ];

  return `
    <div class="page-header gm06-page">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
          <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
          <span class="breadcrumb-separator">/</span>
          <a href="#gm-04-tenant-detail?id=${job.tenantId}" class="breadcrumb-link">پرونده مشتری</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current" aria-current="page">آماده‌سازی و تحویل محیط</span>
        </nav>
        <h1>
          وضعیت آماده‌سازی و تحویل محیط
          <span class="badge scope-cell-badge">تهران — آسیاتک</span>
          <span class="badge badge-scope-tenant"><span class="status-dot dot-active"></span> دامنه مشتری</span>
          <details class="row-disclosure provisioning-technical-details">
            <summary>شناسه کار</summary>
            <code class="nav-code">${job.id}</code>
          </details>
          <span class="page-code-badge">GM-06</span>
        </h1>
        <p>رهگیری گام‌به‌گام ساخت زیرساخت ایزوله، اعمال قالب بدون داده و راستی‌آزمایی تحویل</p>
      </div>
      <div class="header-actions">
        ${job.status === 'failed' 
          ? `<button class="btn btn-primary" id="btnRetryProvisioningJob" onclick="triggerJobRetry('${job.id}')" aria-label="تلاش مجدد در مرحله متوقف‌شده">
               تلاش مجدد در این مرحله
             </button>
             <button class="btn btn-secondary" onclick="window.openGM06JobLogsDrawer('${job.id}')" aria-label="مشاهده لاگ خط‌به‌خط در دراور">
               لاگ تفصیلی اجرا
             </button>
             <a href="#gm-04-tenant-detail?id=${job.tenantId || 'tnt_westo_demo'}" class="btn btn-secondary">
               پرونده مشتری
             </a>`
          : job.status === 'running'
          ? `<button class="btn btn-secondary" disabled>در حال اجرای مراحل...</button>
             <button class="btn btn-secondary" onclick="window.openGM06JobLogsDrawer('${job.id}')">
               لاگ لحظه‌ای
             </button>
             <a href="#gm-04-tenant-detail?id=${job.tenantId || 'tnt_westo_demo'}" class="btn btn-secondary">
               پرونده مشتری
             </a>`
          : `<a href="#gm-04-tenant-detail?id=${job.tenantId || 'tnt_westo_demo'}" class="btn btn-primary">
                مشاهده پرونده ۳۶۰ مشتری
              </a>
              <a href="${(typeof GMPageContracts !== 'undefined' && GMPageContracts.westoClientOrigin) ? GMPageContracts.westoClientOrigin.page('/admin.html') : 'http://localhost:4180/admin.html'}" target="_blank" rel="noopener" class="btn btn-outline-cyan">
                ورود به پنل کلاینت (۴۱۸۰) ↗
              </a>
              <button class="btn btn-secondary" onclick="window.openGM06JobLogsDrawer('${job.id}')">
                گزارش کامل تحویل
              </button>
              <button class="btn btn-secondary" onclick="copyDeliverySummary('${job.id}')">
                کپی خلاصه تحویل
              </button>`
        }
      </div>
    </div>

    ${window.GMDataState ? window.GMDataState.renderFreshnessBar({
      viewId: 'GM06',
      sourceLabel: 'سامانه ارکستراسیون زیرساخت، موتور تحویل داده صفر و Agentهای سلول',
      sourceMode: 'local',
      totalCount: stepsList.length,
      countLabel: 'گام اجرایی'
    }) : ''}

    <div class="data-quality-strip" role="status" aria-label="وضعیت آماده‌سازی مشتری">
      <div class="data-quality-label"><span class="dq-badge-dot dot-cyan"></span><span>وضعیت تحویل</span></div>
      <div class="data-quality-grid">
        <span class="dq-badge"><span class="dq-badge-dot ${jobs.length ? 'dot-blue' : 'dot-purple'}"></span><span class="dq-dim-name">منبع کار</span><span class="dq-dim-val">${jobSource}</span></span>
        <span class="dq-badge"><span class="dq-badge-dot ${job.status === 'failed' ? 'dot-amber' : job.status === 'completed' ? 'dot-emerald' : 'dot-blue'}"></span><span class="dq-dim-name">وضعیت</span><span class="dq-dim-val">${jobStatusLabel}</span></span>
        <span class="dq-badge"><span class="dq-badge-dot ${zeroDataVerified ? 'dot-emerald' : 'dot-amber'}"></span><span class="dq-dim-name">داده تجاری</span><span class="dq-dim-val">${zeroDataVerified ? 'صفر تأییدشده' : 'هنوز تأیید نشده'}</span></span>
      </div>
      <span class="dq-action-hint"><span>${job.status === 'failed' ? 'ابتدا علت خطا را بررسی کنید؛ سپس دکمه تلاش مجدد (Retry) را بزنید' : 'تحویل نهایی فقط پس از تأیید داده صفر معتبر است'}</span></span>
    </div>

    ${(() => {
      const dataState = window.GMDataState ? window.GMDataState.getViewState('GM06') : { state: 'live' };
      if (dataState.state === 'failed' || dataState.state === 'error') {
        return window.GMDataState.renderFailedState({
          viewId: 'GM06',
          title: 'خطا در بارگذاری فرآیند آماده‌سازی و تحویل',
          reason: 'ارتباط با سرویس صف ارکستراسیون زیرساخت برقرار نشد.',
          errorCode: 'ERR_PROVISIONING_ORCHESTRATOR_UNREACHABLE'
        });
      }
      if (dataState.state === 'empty') {
        return window.GMDataState.renderEmptyState({
          title: 'هیچ وظیفه آماده‌سازی فعالی وجود ندارد',
          description: 'کلیه درخواست‌های تحویل با موفقیت پایان یافته یا ایجاد نشده است.',
          actionLabel: 'شروع تحویل مشتری جدید',
          actionHash: '#gm-05-tenant-new'
        });
      }
      if (dataState.state === 'loading') {
        return window.GMDataState.renderSkeleton('table', 4);
      }
      if (dataState.state === 'stale') {
        return window.GMDataState.renderStaleBanner('GM06');
      }
      if (dataState.state === 'refreshing') {
        return window.GMDataState.renderRefreshingBanner ? window.GMDataState.renderRefreshingBanner('GM06') : '';
      }
      return '';
    })()}

    ${(window.GMDataState && ['failed', 'empty', 'error', 'loading'].includes(window.GMDataState.getViewState('GM06').state)) ? '' : `

    <!-- Operational Guidance Banner -->
    <div class="op-context-banner ${job.status === 'failed' ? 'op-context-danger' : job.status === 'completed' ? 'op-context-success' : 'op-context-info'}" role="region" aria-label="راهنمای عملیاتی وضعیت آماده‌سازی محیط">
      <div class="op-context-header">
        <span>راهنمای آماده‌سازی خودکار محیط</span>
          <span class="badge ${job.status === 'failed' ? 'badge-danger' : job.status === 'completed' ? 'badge-success' : 'badge-cyan'}">
          <span class="badge-dot"></span>
          ${job.status === 'failed' ? 'نیازمند اقدام' : job.status === 'completed' ? 'تکمیل موفقیت‌آمیز' : 'در حال پردازش'}
        </span>
      </div>
      <div class="op-context-grid">
        <div class="op-context-item">
          <span class="op-context-label">وضعیت جاری:</span>
          <span class="op-context-desc">
            ${job.status === 'failed' 
              ? `آماده‌سازی خودکار در مرحله «<strong>${job.step}</strong>» با خطای تایم‌اوت ایجنت سلول متوقف شده است.`
              : job.status === 'completed'
              ? `کلیه گام‌های راه‌اندازی با موفقیت انجام شده و محیط آماده بهره‌برداری مشتری است.`
              : `پردازشگر صف در حال اجرای تراکنش‌های مایگریشن و تخصیص سهمیه روی سلول میزبان است.`
            }
          </span>
        </div>
        <div class="op-context-item">
          <span class="op-context-label">تعهد معماری و پیامد:</span>
          <span class="op-context-desc">
            ${job.status === 'failed'
              ? `تا زمان تکمیل موفق این مرحله، دامنه اختصاصی فعال نشده و دعوت‌نامه برای مالک مجموعه ارسال نخواهد شد.`
              : job.status === 'completed'
              ? `پایگاه داده مستقل و محیط اختصاصی با موفقیت ساخته شده و دسترسی اولیه صادر گردید.`
              : `تراکنش‌ها یکپارچه اجرا می‌شوند و در صورت اختلال به آخرین وضعیت امن بازمی‌گردند.`
            }
          </span>
        </div>
        <div class="op-context-item">
          <span class="op-context-label">اقدام استاندارد بعدی:</span>
          <span class="op-context-desc">
            ${job.status === 'failed'
              ? `سلامت ایجنت سلول را در <strong>زیرساخت و سرورها</strong> <span class="page-code-badge">GM-24</span> بررسی کرده و سپس دکمه «تلاش مجدد» را کلیک فرمایید.`
              : job.status === 'completed'
              ? `جهت پیکربندی ماژول‌ها به <strong>امکانات مشتری</strong> <span class="page-code-badge">GM-09</span> یا <strong>دامنه‌ها</strong> <span class="page-code-badge">GM-18</span> مراجعه فرمایید.`
              : `صف کارهای پس‌زمینه <span class="page-code-badge">GM-25</span> را پایش فرمایید یا منتظر دریافت سیگنال اتمام بمانید.`
            }
          </span>
        </div>
      </div>
    </div>

    <!-- Job Status Hero Card -->
    <div class="card" style="margin-bottom: 1.25rem; border-color: ${job.status === 'failed' ? 'rgba(244, 63, 94, 0.3)' : job.status === 'completed' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(6, 182, 212, 0.3)'};">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem;">
        <div>
          <div style="font-size: 1.05rem; font-weight: 700; color: var(--text-primary);">
            مجموعه هدف: ${job.tenantName}
          </div>
          <div style="font-size: 0.813rem; color: var(--text-secondary); margin-top: 0.25rem;">
            گام فعلی: <strong style="color: ${job.status === 'failed' ? 'var(--state-danger)' : 'var(--accent-cyan)'};">${job.step}</strong>
          </div>
        </div>

        <div style="text-align: left; display: flex; flex-direction: column; align-items: flex-end;">
          <div class="cell-mono" style="font-size: 1.4rem; font-weight: 700; color: var(--text-primary);">${job.progressPercent}٪</div>
          <div style="display: flex; gap: 0.4rem; align-items: center; margin-top: 0.2rem;">
            <span class="badge ${job.status === 'failed' ? 'badge-danger' : 'badge-neutral'}">
              تلاش مجدد: ${job.retryCount || 1} از ${job.maxRetries || 3}
            </span>
          </div>
        </div>
      </div>

      <!-- Progress bar -->
      <div class="metric-meter" role="progressbar" aria-label="پیشرفت آماده‌سازی دیتابیس ایزوله" aria-valuenow="${job.progressPercent}" aria-valuemin="0" aria-valuemax="100" style="margin-top: 1rem;">
        <div class="metric-meter-track">
          <div id="jobProgressBar" class="metric-meter-fill ${job.status === 'failed' ? 'danger' : job.status === 'completed' ? 'meter-success' : 'meter-cyan'}" style="width: ${job.progressPercent}%;"></div>
        </div>
      </div>

      ${job.errorMessage ? `
        <div class="provisioning-error" role="alert" style="margin-top: 1rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; background: rgba(244, 63, 94, 0.08); border: 1px solid rgba(244, 63, 94, 0.25); border-radius: 6px; padding: 0.65rem 0.85rem;">
          <div>
            <strong class="text-danger">علت خطای توقف:</strong>
            <span style="color: var(--text-primary); font-size: 0.813rem; margin-right: 0.35rem;">${job.errorMessage}</span>
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <code class="nav-code text-danger" style="font-size: 0.75rem;">ERR-CELL-TIMEOUT-504</code>
            <button type="button" class="btn btn-xs btn-danger" onclick="triggerJobRetry('${job.id}')" aria-label="تلاش مجدد رفع خطای جاب">
              تلاش مجدد
            </button>
          </div>
        </div>
      ` : ''}
    </div>

    <!-- Timeline & Checklist Columns -->
    <div class="grid-cols-2">
      <!-- Steps Timeline / Stepper -->
      <div class="card">
        <div class="card-header">
          <div class="card-title-group">
            <h3 class="card-title">مراحل و توالی اجرای خودکار (Timeline Stepper)</h3>
            <p class="card-subtitle">ترتیب جداسازی منابع، اعمال الگوی پایه، اتصال سرویس اجرایی و راستی‌آزمایی</p>
          </div>
          <div class="card-actions">
            <span class="badge badge-neutral">${stepsList.filter(s => s.status === 'completed').length} از ${stepsList.length} تکمیل شد</span>
          </div>
        </div>

        <div class="card-body">
          <div class="timeline" id="provisioningTimeline">
            ${stepsList.map((st, idx) => `
              <div class="timeline-step ${st.status}">
                <div class="timeline-node"></div>
                <div class="timeline-content" style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 0.75rem; flex-wrap: wrap; padding-bottom: 0.25rem;">
                  <div>
                    <div style="font-size: 0.85rem; font-weight: 600; color: ${st.status === 'completed' ? 'var(--text-primary)' : st.status === 'failed' ? 'var(--state-danger)' : st.status === 'running' ? 'var(--accent-cyan)' : 'var(--text-tertiary)'};">
                      ${idx + 1}. ${st.name}
                    </div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.15rem;">
                      ${st.status === 'completed' ? 'تکمیل موفقیت‌آمیز' : st.status === 'failed' ? `توقف: ${job.errorMessage || 'خطای شبکه'}` : st.status === 'running' ? 'در حال اجرا بر روی سرور' : 'در صف پردازش'}
                    </div>
                  </div>
                  <div style="display: flex; align-items: center; gap: 0.5rem;">
                    ${st.status === 'failed' ? `
                      <button type="button" class="btn btn-xs btn-danger" onclick="triggerJobRetry('${job.id}')" aria-label="تلاش مجدد مرحله ${idx + 1}">
                        تلاش مجدد
                      </button>
                    ` : ''}
                    <span class="badge ${st.status === 'completed' ? 'badge-success' : st.status === 'failed' ? 'badge-danger' : st.status === 'running' ? 'badge-cyan' : 'badge-neutral'}">
                      <span class="badge-dot"></span>
                      ${st.status === 'completed' ? 'تکمیل‌شده' : st.status === 'failed' ? 'خطا در گام' : st.status === 'running' ? 'در حال اجرا' : 'در صف'}
                    </span>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Final Delivery Output Preview -->
      <div class="card">
        <div class="card-header">
          <div class="card-title-group">
            <h3 class="card-title">خروجی و چک‌لیست تحویل مشتری</h3>
            <p class="card-subtitle">مشخصات اولیه دسترسی، پیامک و تضمین داده صفر</p>
          </div>
        </div>

        <div class="card-body">
          <div class="kv-list">
            <div class="surface-subtle" style="padding: 0.75rem; border-radius: 6px; border: 1px solid var(--border-subtle); margin-bottom: 0.5rem;">
              <div class="text-xs text-secondary">آدرس ورود اختصاصی رستوران:</div>
              <div class="cell-mono text-cyan text-strong" style="font-size: 0.875rem; margin-top: 0.25rem;">
                https://${job.tenantId ? job.tenantId.replace('tnt_', '') : 'new'}.demo.neem.ir
              </div>
            </div>

            <div class="kv-item" style="padding: 0.5rem 0; border-bottom: 1px solid var(--border-subtle);">
              <span class="kv-label">وضعیت پیامک دعوت مالک:</span>
              <span class="badge ${job.status === 'completed' ? 'badge-success' : 'badge-warning'}">
                <span class="badge-dot"></span>
                ${job.status === 'completed' ? 'ارسال‌شده (موفق)' : 'در صف ارسال'}
              </span>
            </div>

            <div class="kv-item" style="padding: 0.5rem 0; border-bottom: 1px solid var(--border-subtle);">
              <span class="kv-label">راستی‌آزمایی حساب بدون داده قبلی:</span>
              <span class="badge ${zeroDataBadgeClass}">
                <span class="badge-dot"></span>
                ${zeroDataLabel}
              </span>
            </div>

            <div class="kv-item" style="padding: 0.5rem 0; border-bottom: 1px solid var(--border-subtle);">
              <span class="kv-label">منطقه استقرار زیرساخت:</span>
              <span class="badge badge-warning">نامشخص؛ Cell عملیاتی متصل نیست</span>
            </div>

            <div style="margin-top: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem;">
              <button type="button" class="btn btn-secondary btn-sm btn-block" onclick="copyDeliverySummary('${job.id}')">
                کپی خلاصه تحویل جهت ارائه به مشتری
              </button>
              <button type="button" class="btn btn-secondary btn-sm btn-block" onclick="window.openGM06JobLogsDrawer('${job.id}')">
                مشاهده گزارش کامل و لاگ‌ها در دراور ↗
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Job Logs Progressive Disclosure Section -->
    <details class="card" style="margin-top: 1.25rem;" id="jobLogsDisclosure">
      <summary class="card-header" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
        <div class="card-title-group">
          <h3 class="card-title" style="font-size: 0.95rem; font-weight: 600; color: var(--text-primary);">
            لاگ خط‌به‌خط پردازش و استقرار
          </h3>
          <p class="card-subtitle">رویدادهای ثبت‌شده توسط سیستم اجرا و سرویس تحویل</p>
        </div>
        <div class="card-actions">
          <span class="badge badge-neutral">مشاهده لاگ خام کنسول</span>
        </div>
      </summary>
      <div class="card-body" style="padding-top: 0.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
          <div style="font-size: 0.75rem; color: var(--text-secondary);">
            تعداد رخدادهای ثبت‌شده: <strong>${logs.length} خط</strong>
          </div>
          <div style="display: flex; gap: 0.4rem;">
            <button type="button" class="btn btn-xs btn-secondary" onclick="copyJobLogs('${job.id}')">
              کپی لاگ
            </button>
            <button type="button" class="btn btn-xs btn-primary" onclick="window.openGM06JobLogsDrawer('${job.id}')">
              نمایش در دراور تمام‌صفحه ↗
            </button>
          </div>
        </div>

        <div class="surface-subtle cell-mono" style="background: var(--bg-surface-elevated, #0f172a); border: 1px solid var(--border-default); border-radius: 6px; padding: 0.85rem; font-size: 0.75rem; max-height: 220px; overflow-y: auto; line-height: 1.6; direction: ltr; text-align: left;">
          ${logs.map(l => `
            <div style="display: flex; gap: 0.5rem; align-items: baseline;">
              <span style="color: var(--text-tertiary);">${l.time}</span>
              <span class="badge ${l.level === 'SUCCESS' ? 'badge-success' : l.level === 'ERROR' ? 'badge-danger' : l.level === 'WARN' ? 'badge-warning' : 'badge-neutral'}" style="font-size: 0.65rem; padding: 0.1rem 0.35rem;">
                ${l.level}
              </span>
              <span style="color: ${l.level === 'ERROR' ? 'var(--state-danger)' : l.level === 'SUCCESS' ? 'var(--state-success)' : 'var(--text-primary)'};">
                ${l.text}
              </span>
            </div>
          `).join('')}
        </div>
      </div>
    </details>
    `}
  `;
};

window.triggerJobRetry = function(jobId) {
  const store = window.prototypeStore || window.GMStore;
  if (store && store.retryJob) {
    store.retryJob(jobId);
  }
  const msg = 'درخواست تلاش مجدد ارسال شد...';
  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast(msg, 'info');
  } else if (typeof showToast === 'function') {
    showToast(msg, 'info');
  }
  setTimeout(() => {
    window.location.hash = `#gm-06-provisioning?jobId=${jobId}&t=${Date.now()}`;
  }, 100);
};

window.copyDeliverySummary = function(jobId) {
  const store = window.prototypeStore || window.GMStore;
  const job = (store && store.getJob ? store.getJob(jobId) : null) || { id: jobId, tenantName: 'مجموعه جدید' };
  const summary = `خلاصه تحویل پلتفرم NEEM\nشناسه کار: ${job.id}\nمجموعه: ${job.tenantName}\nوضعیت: ${job.status === 'completed' ? 'تکمیل‌شده' : 'در انتظار اقدام'}\nآدرس اختصاصی: https://${job.tenantId ? job.tenantId.replace('tnt_', '') : 'demo'}.demo.neem.ir`;

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(summary).catch(() => {});
  }
  const msg = 'خلاصه تحویل در کلیپ‌بورد کپی شد.';
  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast(msg, 'success');
  } else if (typeof showToast === 'function') {
    showToast(msg, 'success');
  }
};

window.copyJobLogs = function(jobId) {
  const store = window.prototypeStore || window.GMStore;
  const job = (store && store.getJob ? store.getJob(jobId) : null) || { id: jobId };
  const logs = generateJobLogs(job).map(l => `[${l.time}] [${l.level}] ${l.text}`).join('\n');
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(logs).catch(() => {});
  }
  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast('لاگ خط‌به‌خط اجرای کار در کلیپ‌بورد کپی شد.', 'info');
  }
};

window.openGM06JobLogsDrawer = function(jobId) {
  const store = window.prototypeStore || window.GMStore;
  const job = (store && store.getJob ? store.getJob(jobId) : null) || { id: jobId, tenantName: 'کافه وستو', status: 'failed' };
  const logs = generateJobLogs(job);

  const content = `
    <div style="display: flex; flex-direction: column; gap: 1.25rem;">
      <!-- Job Meta Summary -->
      <div class="drawer-kpi-grid">
        <div class="drawer-kpi-card">
          <div class="drawer-kpi-title">شناسه کار پردازشی</div>
          <div class="drawer-kpi-value text-cyan cell-mono" style="font-size: 1rem;">${job.id}</div>
          <div class="text-secondary" style="font-size: 0.72rem; margin-top: 0.25rem;">نوع: آماده‌سازی اولیه</div>
        </div>
        <div class="drawer-kpi-card">
          <div class="drawer-kpi-title">وضعیت فعلی</div>
          <div class="drawer-kpi-value ${job.status === 'failed' ? 'text-danger' : job.status === 'completed' ? 'text-success' : 'text-cyan'}">
            ${job.status === 'failed' ? 'متوقف‌شده' : job.status === 'completed' ? 'تکمیل‌شده' : 'در حال اجرا'}
          </div>
          <div class="text-secondary" style="font-size: 0.72rem; margin-top: 0.25rem;">تلاش: ${job.retryCount || 1} از ۳</div>
        </div>
        <div class="drawer-kpi-card">
          <div class="drawer-kpi-title">سلول میزبان</div>
          <div class="drawer-kpi-value text-cyan" style="font-size: 0.95rem;">cell-teh-01</div>
          <div class="text-secondary" style="font-size: 0.72rem; margin-top: 0.25rem;">آسیاتک برج میلاد</div>
        </div>
      </div>

      <!-- Agent Diagnostics Grid -->
      <div class="drawer-section">
        <h4 class="drawer-section-title">شواهد تشخیصی ارتباط با Agent محلی سلول</h4>
        <div class="table-responsive" style="border: 1px solid var(--border-default); border-radius: 6px;">
          <table class="data-table" style="margin: 0; font-size: 0.775rem;" aria-label="جدول شواهد تشخیصی ارتباط با ایجنت محلی سلول">
            <tbody>
              <tr>
                <td style="color: var(--text-secondary); width: 35%;">دروازه شبکه (Gateway):</td>
                <td class="cell-mono">10.0.4.1:8443 (محیط ایزوله VPC)</td>
              </tr>
              <tr>
                <td style="color: var(--text-secondary);">پینگ و تأخیر رفت‌وبرگشت:</td>
                <td class="cell-mono">۲۴ms (اتصال برقرار)</td>
              </tr>
              <tr>
                <td style="color: var(--text-secondary);">کد پاسخ آخرین فراخوانی:</td>
                <td><code class="nav-code text-danger">HTTP 504 Gateway Timeout</code></td>
              </tr>
              <tr>
                <td style="color: var(--text-secondary);">علت سیستمی:</td>
                <td style="color: var(--text-primary);">تأخیر در اجرای اسکریپت migration_013 روی پایگاه‌داده داکر سلول</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Raw Console Log Viewer -->
      <div class="drawer-section">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <h4 class="drawer-section-title" style="margin: 0;">لاگ کامل کنسول ارکستراتور</h4>
          <button type="button" class="btn btn-xs btn-secondary" onclick="copyJobLogs('${job.id}')">
            کپی لاگ
          </button>
        </div>
        <div class="surface-subtle cell-mono" style="background: var(--bg-surface-elevated, #0f172a); border: 1px solid var(--border-default); border-radius: 6px; padding: 0.85rem; font-size: 0.75rem; max-height: 250px; overflow-y: auto; line-height: 1.6; direction: ltr; text-align: left;">
          ${logs.map(l => `
            <div style="display: flex; gap: 0.5rem; align-items: baseline;">
              <span style="color: var(--text-tertiary);">${l.time}</span>
              <span class="badge ${l.level === 'SUCCESS' ? 'badge-success' : l.level === 'ERROR' ? 'badge-danger' : l.level === 'WARN' ? 'badge-warning' : 'badge-neutral'}" style="font-size: 0.65rem; padding: 0.1rem 0.35rem;">
                ${l.level}
              </span>
              <span style="color: ${l.level === 'ERROR' ? 'var(--state-danger)' : l.level === 'SUCCESS' ? 'var(--state-success)' : 'var(--text-primary)'};">
                ${l.text}
              </span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Action Footer -->
      <div class="drawer-cta-toolbar" style="margin-top: 0.5rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
        ${job.status === 'failed' ? `
          <button type="button" class="btn btn-primary btn-sm" onclick="triggerJobRetry('${job.id}'); if (window.GMApp && window.GMApp.closeDrawer) window.GMApp.closeDrawer();">
            تلاش مجدد فرآیند (Retry Job)
          </button>
        ` : ''}
        <a href="#gm-24-infrastructure" class="btn btn-secondary btn-sm" onclick="if (window.GMApp && window.GMApp.closeDrawer) window.GMApp.closeDrawer();">
          بررسی سلامت سرورها در زیرساخت
        </a>
        <a href="#gm-25-jobs" class="btn btn-secondary btn-sm" onclick="if (window.GMApp && window.GMApp.closeDrawer) window.GMApp.closeDrawer();">
          مشاهده صف کارهای پلتفرم
        </a>
      </div>
    </div>
  `;

  if (window.GMApp && typeof window.GMApp.openDrawer === 'function') {
    window.GMApp.openDrawer(`لاگ‌های تفصیلی آماده‌سازی: ${job.id}`, content, {
      subtitle: `${job.tenantName} • تحلیل خطا و ردیابی خط‌به‌خط اتصال Agent`
    });
  }
};

window.GMViews.GM06 = {
  render: window.renderGM06,
  openJobLogsDrawer: window.openGM06JobLogsDrawer
};
