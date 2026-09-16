/**
 * prototype/js/views/gm16-automations.js
 * 
 * GM-16: قواعد خودکارسازی و قوانین پس‌زمینه (/automations)
 * تعریف تریگرها، شرایط و اکشن‌های زمان‌بندی‌شده جهت تمدید، انقضای لایسنس، دیده‌بان پوزها و پاکسازی نشست‌ها
 */

window.renderGM16 = function() {
  const store = window.prototypeStore || window.GMStore;
  const automations = store && store.getAutomations ? store.getAutomations() : [];
  const activeCount = automations.filter(a => a.status === 'active').length;
  const pausedCount = automations.filter(a => a.status !== 'active').length;
  const automationSource = automations.length ? 'موتور اتوماسیون عملیاتی NEEM' : 'بدون قانون قابل مشاهده';
  const humanizeRuleText = value => String(value || '')
    .replace(/Heartbeat/gi, 'ضربان سلامت')
    .replace(/Grant/gi, 'مجوز')
    .replace(/active/gi, 'فعال')
    .replace(/expired/gi, 'منقضی')
    .replace(/offline/gi, 'قطع‌شده')
    .replace(/Rate[- ]?limit/gi, 'محدودیت سرعت');

  return `
    <div class="page-header gm16-page">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
          <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current" aria-current="page">قواعد خودکارسازی</span>
        </nav>
        <h1>
          خودکارسازی و قوانین سیستم
          <span class="page-code-badge">GM-16</span>
        </h1>
        <p>تنظیم موتور قوانین پس‌زمینه بر پایه الگوی چهارگانه: رخداد راه‌انداز / شرط / اقدام سیستمی / زمان‌بندی</p>
      </div>
      <div class="header-actions">
        <button class="btn btn-primary" onclick="window.openGM16CreateRuleModal()">
          تعریف قانون خودکار جدید
        </button>
        <a href="#gm-25-jobs" class="btn btn-secondary">
          صف پردازش جاب‌ها
        </a>
      </div>
    </div>

    ${window.GMDataState ? window.GMDataState.renderFreshnessBar({
      viewId: 'GM16',
      sourceLabel: 'موتور رویدادها و قواعد خودکارسازی',
      sourceMode: 'local',
      totalCount: automations.length,
      countLabel: 'قاعده ثبت‌شده'
    }) : ''}

    <div class="op-context-banner op-context-info" role="region" aria-label="راهنمای اجرای قوانین خودکارسازی">
      <div class="op-context-header">
        <span>قواعد خودکارسازی و زمان‌بندی رویدادها</span>
        <span class="badge badge-success">Runner عملیاتی متصل</span>
      </div>
      <div class="op-context-grid">
        <div class="op-context-item"><span class="op-context-label">منبع:</span><span class="op-context-desc">قوانین و شمارنده‌ها از پایگاه داده قوانین پس‌زمینه NEEM خوانده می‌شوند.</span></div>
        <div class="op-context-item"><span class="op-context-label">پیامد:</span><span class="op-context-desc">اقدامات مطابق شروط و با رعایت Idempotency به Workerهای اجرایی ارسال می‌گردد.</span></div>
        <div class="op-context-item"><span class="op-context-label">وضعیت:</span><span class="op-context-desc">پایش پیوسته رویدادها و صف‌های پیام فعال و پایدار است.</span></div>
      </div>
    </div>

    <div class="data-quality-strip" role="status" aria-label="وضعیت داده‌های خودکارسازی">
      <div class="data-quality-label"><span class="dq-badge-dot dot-cyan"></span><span>وضعیت قوانین</span></div>
      <div class="data-quality-grid">
        <span class="dq-badge"><span class="dq-badge-dot ${automations.length ? 'dot-blue' : 'dot-purple'}"></span><span class="dq-dim-name">منبع</span><span class="dq-dim-val">${automationSource}</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">فعال</span><span class="dq-dim-val">${activeCount.toLocaleString('fa-IR')} قانون</span></span>
        <span class="dq-badge"><span class="dq-badge-dot ${pausedCount ? 'dot-amber' : 'dot-blue'}"></span><span class="dq-dim-name">متوقف</span><span class="dq-dim-val">${pausedCount.toLocaleString('fa-IR')} قانون</span></span>
      </div>
      <span class="dq-action-hint"><span>هر اقدام خودکار قبل از فعال‌سازی باید دامنه اثر مشخص داشته باشد</span></span>
    </div>

    ${(() => {
      const dataState = window.GMDataState ? window.GMDataState.getViewState('GM16') : { state: 'live' };
      if (dataState.state === 'failed' || dataState.state === 'error') {
        return window.GMDataState.renderErrorState({
          viewId: 'GM16',
          title: 'خطا در بارگذاری قواعد خودکارسازی',
          reason: 'پاسخی از موتور رویدادها و وب‌هوک‌های پس‌زمینه دریافت نشد.',
          errorCode: 'ERR_AUTOMATION_ENGINE_TIMEOUT'
        });
      }
      if (dataState.state === 'empty') {
        return window.GMDataState.renderEmptyState({
          title: 'هیچ قانون خودکارسازی یافت نشد',
          description: 'هیچ قاعده خودکارسازی یا وب‌هوکی در سیستم تعریف نگردیده است.',
          actionLabel: 'تعریف قانون جدید',
          onAction: "window.openGM16CreateRuleModal()"
        });
      }
      if (dataState.state === 'loading') {
        return window.GMDataState.renderSkeleton('table', 5);
      }
      if (dataState.state === 'refreshing') {
        return window.GMDataState.renderRefreshingBanner('GM16');
      }
      if (dataState.state === 'stale') {
        return window.GMDataState.renderStaleBanner('GM16');
      }
      return '';
    })()}

    ${(window.GMDataState && ['failed', 'empty', 'error', 'loading'].includes(window.GMDataState.getViewState('GM16').state)) ? '' : `

    <!-- Advanced rule-engine explanation stays available without competing with the table. -->
    <details class="card progressive-disclosure automation-guidance" style="margin-bottom: 1.15rem;">
      <summary>
        <span>راهنمای موتور اجرای قوانین</span>
        <span class="badge badge-cyan">۴ مرحله: رخداد · شرط · اقدام · زمان‌بندی</span>
      </summary>
      <div class="card-body">
        <div class="op-context-grid">
          <div class="op-context-item">
            <span class="op-context-label">چه چیزی اجرا می‌شود؟</span>
            <span class="op-context-desc">هر قانون از رخداد راه‌انداز، شرط احراز، اقدام سیستمی و زمان‌بندی تشکیل می‌شود.</span>
          </div>
          <div class="op-context-item">
            <span class="op-context-label">پیامد</span>
            <span class="op-context-desc">نتیجهٔ قانون به‌صورت رویداد تغییر وضعیت به سرویس‌های پس‌زمینه سرور و دستگاه‌ها مخابره می‌شود.</span>
          </div>
        </div>
      </div>
    </details>

    <!-- Automations Table -->
    <div class="table-wrapper">
      <div class="table-toolbar">
        <div>
          <div style="font-weight: 600; font-size: 0.875rem; color: var(--text-primary);">فهرست قواعد فعال و زمان‌بندی‌شده</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.15rem;">تعداد اجرای اخیر، وضعیت و جزئیات زنجیره عملیاتی</div>
        </div>
      </div>
      <div class="table-responsive">
        <table class="data-table" aria-label="جدول فهرست قواعد خودکارسازی فعال">
          <thead>
            <tr>
              <th>عنوان قانون</th>
              <th>زمان یا رویداد آغازگر</th>
              <th>شرط اجرا</th>
              <th>اقدام پس از اجرا</th>
              <th>وضعیت</th>
              <th>آخرین اجرای موفق</th>
              <th class="cell-actions">عملیات</th>
            </tr>
          </thead>
          <tbody>
            ${automations.length > 0 ? automations.map(a => `
              <tr>
                <td>
                  <strong style="color: var(--text-primary);">${a.name.replace(/\s*\([^)]*\)/, '')}</strong>
                  <details class="row-disclosure automation-row-disclosure">
                    <summary>شناسه فنی قانون</summary>
                    <span class="cell-mono">${a.id}</span>
                  </details>
                </td>
                <td><span class="badge badge-neutral">${humanizeRuleText(a.trigger)}</span></td>
                <td style="font-size: 0.75rem; max-width: 220px; color: var(--text-secondary);">${humanizeRuleText(a.condition)}</td>
                <td style="font-size: 0.75rem; color: var(--accent-cyan); font-weight: 600;">${humanizeRuleText(a.action)}</td>
                <td>
                  ${a.status === 'active'
                    ? '<span class="badge badge-success"><span class="badge-dot"></span> فعال</span>'
                    : '<span class="badge badge-neutral">متوقف‌شده</span>'
                  }
                </td>
                <td class="cell-mono" style="font-size: 0.75rem; color: var(--text-tertiary);">${a.lastRun}</td>
                <td class="cell-actions">
                  <button class="btn btn-secondary btn-sm" onclick="window.toggleGM16Rule('${a.id}')" aria-label="تغییر وضعیت قانون ${a.name.replace(/\s*\([^)]*\)/, '')}">
                    ${a.status === 'active' ? 'توقف' : 'فعال‌سازی'}
                  </button>
                </td>
              </tr>
            `).join('') : `
              <tr>
                <td colspan="7" style="text-align: center; padding: 2.5rem 1rem;">
                  <div class="empty-state empty-state-compact">
                    <div class="empty-state-icon"><span class="badge-dot dot-cyan"></span></div>
                    <h3>هیچ قانون خودکارسازی تعریف نشده است</h3>
                    <p>برای شروع، می‌توانید اولین قانون خودکار را تنظیم فرمایید.</p>
                    <button class="btn btn-primary btn-sm" onclick="window.openGM16CreateRuleModal()">تعریف قانون خودکار جدید</button>
                  </div>
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
    `}
  `;
};

window.toggleGM16Rule = function(ruleId) {
  const store = window.prototypeStore || window.GMStore;
  const res = store && store.toggleAutomation ? store.toggleAutomation(ruleId) : null;
  if (res) {
    const msg = `وضعیت قانون "${res.name}" به ${res.status === 'active' ? 'فعال' : 'متوقف'} تغییر یافت.`;
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast(msg, 'info');
    } else if (typeof showToast === 'function') {
      showToast(msg, 'info');
    }

    if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
      window.GMRouter.refresh();
    } else if (window.GMRouter && typeof window.GMRouter.handleRoute === 'function') {
      window.GMRouter.handleRoute();
    }
  }
};

window.openGM16CreateRuleModal = function() {
  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div>
        <label class="form-label" for="rule-name-input">نام قانون:</label>
        <input type="text" id="rule-name-input" class="form-control" placeholder="مثال: هشدار اتمام اعتبار لایسنس پیامکی" aria-label="نام قانون خودکارسازی" />
      </div>

      <div class="surface-subtle" style="display: flex; flex-direction: column; gap: 0.75rem;">
        <div>
          <label class="form-label">۱. رویداد راه‌انداز (Trigger):</label>
          <select class="form-control" aria-label="رویداد راه‌انداز Trigger">
            <option>انقضای تاریخ سررسید فاکتور</option>
            <option>عدم دریافت پینگ دستگاه پوز بیش از ۳۰ دقیقه</option>
            <option>ثبت لغو سفارش با مبلغ بیش از ۱,۰۰۰,۰۰۰ تومان</option>
            <option>افزایش بار پردازش در سرور متمرکز VPS به بیش از ۸۰٪</option>
          </select>
        </div>

        <div>
          <label class="form-label">۲. شرط احراز (Condition):</label>
          <input type="text" class="form-control" value="مشتری در وضعیت active باشد و بدهی معوق داشته باشد" aria-label="شرط احراز Condition" />
        </div>

        <div>
          <label class="form-label">۳. اقدام سیستمی (Action):</label>
          <select class="form-control" aria-label="اقدام سیستمی Action">
            <option>ارسال پیامک اخطار به مالک و پشتیبان فنی</option>
            <option>غیرفعال‌سازی موقت ماژول مربوطه تا تسویه</option>
            <option>ابطال فوری نشست‌های باز</option>
            <option>تولید تیکت پشتیبانی با اولویت بالا</option>
          </select>
        </div>

        <div>
          <label class="form-label">۴. زمان‌بندی (Schedule):</label>
          <input type="text" class="form-control cell-mono" value="0 0 * * * (هر شب رأس ساعت ۱۲)" aria-label="زمان‌بندی اجرای قانون Schedule" />
        </div>
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal('تعریف قانون خودکارسازی جدید', content, () => {
      window.GMApp.showToast('پروتوتایپ به موتور اتوماسیون متصل نیست؛ قانونی ذخیره یا فعال نشد.', 'warning');
      return false;
    });
  }
};
