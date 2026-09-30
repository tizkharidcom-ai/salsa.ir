// prototype/js/views/gm25-jobs.js
// GM-25: صف کارها و جاب‌های پس‌زمینه (Background Jobs & Workers)
// Flow 4: پیگیری job با وضعیت و retry شبیه‌سازی‌شده

window.GMViews = window.GMViews || {};

window.GMViews.GM25 = {
  state: {
    statusFilter: 'all',
    searchQuery: ''
  },

  render() {
    this.state = { statusFilter: 'all', searchQuery: '' };
    const store = window.GMStore || window.prototypeStore;
    const jobs = store && store.getJobs ? store.getJobs() : [];

    const runningCount = jobs.filter(j => j.status === 'running').length;
    const failedCount = jobs.filter(j => j.status === 'failed').length;
    const completedCount = jobs.filter(j => j.status === 'completed').length;

    return `
      <div class="page-header gm25-page">
        <div class="page-title-group">
          <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
            <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
            <span class="breadcrumb-separator">/</span>
            <span class="breadcrumb-current" aria-current="page">صف کارها و وظایف</span>
          </nav>
          <h1>
            صف اجرا و کارهای پس‌زمینه
            <span class="badge badge-scope-global"><span class="status-dot dot-purple"></span> کلان پلتفرم</span>
            <span class="page-code-badge">GM-25</span>
          </h1>
          <p>پایش وضعیت کارهای سیستمی (آماده‌سازی، اعطای افزونه، پشتیبان‌گیری)، خطاها و بازآزمایی هوشمند</p>
        </div>
        <div class="header-actions">
          <button class="btn btn-primary" onclick="window.GMDataState ? window.GMDataState.refreshView('GM25') : (window.GMRouter ? window.GMRouter.refresh() : null)">
            به‌روزرسانی صف
          </button>
          <a href="#gm-03-tenants" class="btn btn-secondary">
            انتخاب مشتری برای رهگیری
          </a>
        </div>
      </div>

      ${window.GMDataState ? window.GMDataState.renderFreshnessBar({
        viewId: 'GM25',
        sourceLabel: 'صف پردازشگر کارهای پس‌زمینه',
        sourceMode: 'local',
        totalCount: jobs.length,
        countLabel: 'کار در صف'
      }) : ''}

      <div class="op-context-banner op-context-info" role="region" aria-label="مدیریت صف پردازش پس‌زمینه">
        <div class="op-context-header">
          <span>صف پردازش ناهمگام و کارگران پس‌زمینه (Background Worker Queue)</span>
          <span class="badge badge-cyan">سرور متمرکز VPS</span>
        </div>
        <div class="op-context-grid">
          <div class="op-context-item"><span class="op-context-label">منبع داده:</span><span class="op-context-desc">پایش زنده وضعیت جاب‌های استقرار شِمای مشتریان، پشتیبان‌گیری و همگام‌سازی POS.</span></div>
          <div class="op-context-item"><span class="op-context-label">تعهد عملیاتی:</span><span class="op-context-desc">تضمین اجرای یکتا (Idempotency) و قفل پردازش (Worker Lease) جهت جلوگیری از تداخل موازی.</span></div>
          <div class="op-context-item"><span class="op-context-label">وضعیت کارگران:</span><span class="op-context-desc">کارگران پردازشگر محلی بر روی سرور VPS با تأییدیه ACK و بازپخش خودکار در صورت خطا.</span></div>
        </div>
      </div>

      ${window.GMDataState ? window.GMDataState.renderDataQualityBadges('jobs') : ''}

      ${(() => {
        const dataState = window.GMDataState ? window.GMDataState.getViewState('GM25') : { state: 'live' };
        if (dataState.state === 'failed' || dataState.state === 'error') {
          return window.GMDataState.renderFailedState({
            viewId: 'GM25',
            title: 'خطا در ارتباط با سرور صف و کارگران پس‌زمینه',
            reason: 'ارتباط با مدیر صف کارها دچار قطعی موقت شده است.',
            errorCode: 'ERR_JOB_QUEUE_DISCONNECTED'
          });
        }
        if (dataState.state === 'empty') {
          return window.GMDataState.renderEmptyState({
            title: 'صف کارها خالی است',
            summary: 'عدم وجود وظیفه ناهمگام در صف‌های پردازش، تعویق یا خطا',
            description: 'در حال حاضر هیچ کار پس‌زمینه‌ای (پشتیبان‌گیری، تحویل حساب، ارسال پیامک و بستن فاکتور) در صف قرار ندارد.',
            auditScope: 'صف‌های پردازشی، کارهای تأخیری و تاریخچه تلاش مجدد مشتریان',
            actionLabel: 'به‌روزرسانی صف',
            onAction: "window.GMDataState.refreshView('GM25')"
          });
        }
        if (dataState.state === 'loading') {
          return window.GMDataState.renderSkeleton('table', 4);
        }
        if (dataState.state === 'stale') {
          return window.GMDataState.renderStaleBanner('GM25');
        }
        if (dataState.state === 'refreshing') {
          return window.GMDataState.renderRefreshingBanner ? window.GMDataState.renderRefreshingBanner('GM25') : '';
        }
        return '';
      })()}

      ${(window.GMDataState && ['failed', 'empty', 'error', 'loading'].includes(window.GMDataState.getViewState('GM25').state)) ? '' : `
      <!-- Queue Metrics -->
      <div class="grid-cols-4" style="margin-bottom: 1.25rem;">
        <div class="card stat-card">
          <div class="stat-header"><span>کل کارهای ثبت‌شده</span></div>
          <div class="stat-value">${jobs.length}</div>
          <div class="stat-footer"><span>تعداد کل تسک‌های صف</span></div>
        </div>
        <div class="card stat-card">
          <div class="stat-header"><span>در حال پردازش</span></div>
          <div class="stat-value text-cyan">${runningCount}</div>
          <div class="stat-footer"><span class="badge badge-neutral">وضعیت پردازش پس‌زمینه</span></div>
        </div>
        <div class="card stat-card">
          <div class="stat-header"><span>ناموفق / نیازمند اقدام</span></div>
          <div class="stat-value text-danger">${failedCount}</div>
          <div class="stat-footer"><span class="badge badge-danger">نیازمند بررسی یا تکرار</span></div>
        </div>
        <div class="card stat-card">
          <div class="stat-header"><span>پایان‌یافته موفق</span></div>
          <div class="stat-value text-success">${completedCount}</div>
          <div class="stat-footer"><span class="badge badge-success">پایان‌یافته با موفقیت</span></div>
        </div>
      </div>

      <!-- Job Filter Tabs and Table -->
      <div class="table-wrapper">
        <div class="table-toolbar" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
          <div class="table-filters" id="jobsStatusChips" role="group" aria-label="فیلتر وضعیت پردازش‌های سیستم">
            <button class="filter-chip active" data-status="all" aria-pressed="true" onclick="window.GMViews.GM25.setStatusFilter('all')">
              همه کارها (${jobs.length})
            </button>
            <button class="filter-chip" data-status="failed" aria-pressed="false" onclick="window.GMViews.GM25.setStatusFilter('failed')">
              ناموفق (${failedCount})
            </button>
            <button class="filter-chip" data-status="running" aria-pressed="false" onclick="window.GMViews.GM25.setStatusFilter('running')">
              در حال اجرا (${runningCount})
            </button>
            <button class="filter-chip" data-status="completed" aria-pressed="false" onclick="window.GMViews.GM25.setStatusFilter('completed')">
              موفق (${completedCount})
            </button>
          </div>
          <div class="table-search-group">
            <span id="jobsFilterCount" class="filter-count-badge">نمایش ${jobs.length.toLocaleString('fa-IR')} از ${jobs.length.toLocaleString('fa-IR')} پردازش</span>
            <div class="search-input-wrapper" id="jobsSearchWrapper">
              <input type="text" id="jobsSearchInput" class="form-control" placeholder="جست‌وجو در شناسه، نوع یا مشتری..." style="width: 230px; padding: 0.35rem 0.75rem;" aria-label="جست‌وجو در صف پردازش‌ها" oninput="window.GMViews.GM25.search(this.value)" />
              <button class="search-clear-btn" onclick="window.GMViews.GM25.clearSearch()" aria-label="پاکسازی جستجو">✕</button>
            </div>
          </div>
        </div>
        <div class="table-responsive">
          <table class="data-table" id="gm25-jobs-table" aria-label="جدول پردازش‌ها و صف کارهای پس‌زمینه">
            <thead>
              <tr>
                <th class="col-checkbox"><input type="checkbox" id="gm25-select-all" aria-label="انتخاب همه پردازش‌های جدول" /></th>
                <th>کار</th>
                <th>نوع کار</th>
                <th>دامنه</th>
                <th>وضعیت</th>
                <th>پیشرفت</th>
                <th>تلاش‌ها</th>
                <th>پیام وضعیت / خطا</th>
                <th>زمان ثبت</th>
                <th class="cell-actions">عملیات</th>
              </tr>
            </thead>
            <tbody>
              ${jobs.map(j => {
                return `
                <tr id="row-job-${j.id}" data-id="${j.id}" data-status="${j.status}" data-search="${j.id} ${j.type} ${this.formatJobType(j.type)} ${j.tenantId} ${j.status} ${j.error || ''}">
                  <td class="col-checkbox">
                    <input type="checkbox" class="job-row-select" data-id="${j.id}" data-status="${j.status}" aria-label="انتخاب پردازش ${j.id}" />
                  </td>
                  <td>
                    <strong style="color: var(--text-primary);">${this.formatJobType(j.type)}</strong>
                    <details class="row-disclosure jobs-technical-details">
                      <summary>شناسه کار</summary>
                      <code class="nav-code">${j.id}</code>
                    </details>
                  </td>
                  <td>
                    <span style="color: var(--text-secondary);">${this.formatJobType(j.type)}</span>
                    <details class="row-disclosure jobs-technical-details">
                      <summary>نوع فنی</summary>
                      <code class="cell-mono">${j.type}</code>
                    </details>
                  </td>
                  <td>
                    <span class="badge badge-neutral">مشتری انتخاب‌شده</span>
                    <details class="row-disclosure jobs-technical-details">
                      <summary>شناسه دامنه</summary>
                      <code class="cell-mono">${j.tenantId}</code>
                    </details>
                  </td>
                  <td>
                    ${j.status === 'completed' ? '<span class="badge badge-success"><span class="badge-dot"></span> تکمیل‌شده</span>' : ''}
                    ${j.status === 'failed' ? '<span class="badge badge-danger"><span class="badge-dot"></span> ناموفق</span>' : ''}
                    ${j.status === 'running' ? '<span class="badge badge-warning"><span class="badge-dot"></span> در حال اجرا</span>' : ''}
                  </td>
                  <td style="min-width: 100px;">
                    <div style="background: var(--bg-subtle, #f1f5f9); height: 5px; border-radius: 3px; overflow: hidden; border: 1px solid var(--border-default);">
                      <div class="metric-meter-fill ${j.status === 'failed' ? 'meter-danger' : 'meter-cyan'}" style="width: ${j.progress}%; height: 100%;"></div>
                    </div>
                    <div style="font-size: 0.7rem; color: var(--text-secondary); margin-top: 0.2rem; font-family: var(--font-mono);">${j.progress}%</div>
                  </td>
                  <td>
                    <span class="cell-mono" style="font-size: 0.75rem;">${j.attempts} / ${j.maxRetries}</span>
                  </td>
                  <td style="max-width: 220px;">
                    ${j.error 
                      ? `<span class="text-danger" style="font-size: 0.75rem; font-weight: 500;">${j.error}</span>`
                      : `<span style="color: var(--text-secondary); font-size: 0.75rem;">مراحل Fixture تکمیل‌نمایشی است؛ ACK واقعی ثبت نشده</span>`}
                  </td>
                  <td class="cell-mono" style="font-size: 0.75rem; color: var(--text-tertiary, #64748b);" dir="ltr">${j.createdAt}</td>
                  <td class="cell-actions">
                    <div style="display: flex; gap: 0.35rem; justify-content: flex-end;">
                      ${j.status === 'failed' ? `
                        <button class="btn btn-warning btn-sm" onclick="window.GMViews.GM25.triggerRetry('${j.id}')">
                          تلاش مجدد
                        </button>
                      ` : ''}
                      <button class="btn btn-secondary btn-sm" onclick="window.GMViews.GM25.viewJobDetails('${j.id}')">
                        جزئیات
                      </button>
                    </div>
                  </td>
                </tr>
              `;
              }).join('')}
              <tr id="jobs-empty-row" style="display: none;">
                <td colspan="10" class="table-empty-cell" style="text-align: center; padding: 2.5rem 1rem; color: var(--text-secondary);">
                  <div style="font-size: 0.875rem; font-weight: 600; color: var(--text-primary); margin-bottom: 0.35rem;">هیچ پردازشی با این مشخصات پیدا نشد</div>
                  <div style="font-size: 0.75rem; color: var(--text-tertiary, #64748b); margin-bottom: 0.85rem;">می‌توانید فیلتر وضعیت را به «همه کارها» برگردانید یا عبارت جستجو را پاک کنید.</div>
                  <button class="btn btn-secondary btn-sm" onclick="window.GMViews.GM25.resetAll()">پاکسازی فیلتر و جست‌وجو</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Bulk Actions Docked Bar -->
      <div id="gm25-bulk-actions" class="table-bulk-actions-bar" role="toolbar" aria-label="عملیات گروهی روی پردازش‌های انتخاب‌شده">
        <div class="bulk-actions-info">
          <span class="bulk-counter-badge" id="gm25-bulk-count">۰ مورد انتخاب‌شده</span>
          <span class="bulk-actions-label">اقدامات دسته‌جمعی:</span>
        </div>
        <div class="bulk-actions-btns">
          <button type="button" class="btn btn-warning btn-sm" id="gm25-bulk-retry-btn" onclick="window.GMViews.GM25.triggerBulkRetry()" disabled>
            بازآزمایی کارهای ناموفق
          </button>
          <button type="button" class="btn btn-secondary btn-sm" id="gm25-bulk-copy-btn" onclick="window.GMViews.GM25.copySelectedIds()" disabled>
            کپی شناسه‌ها
          </button>
          <button type="button" class="bulk-clear-btn" onclick="window.GMViews.GM25.clearSelection()">
            لغو انتخاب
          </button>
        </div>
      </div>
      `}
    `;
  },

  formatJobType(type) {
    const map = {
      'tenant_provision': 'آماده‌سازی مجموعه جدید',
      'tenant_provisioning': 'آماده‌سازی مجموعه جدید',
      'addon_grant': 'اعطای لایسنس و فعال‌سازی افزونه',
      'domain_verification': 'راستی‌آزمایی رکورد DNS دامنه',
      'schema_migration': 'مایگریشن دیتابیس ایزوله',
      'menu_export': 'خروجی کاتالوگ و اقلام منو',
      'menu_sync': 'همگام‌سازی کاتالوگ منو',
      'policy_deployment': 'انتشار سیاست‌های دسترسی',
      'backup_snapshot': 'تهیه اسنپ‌شات و بکاپ'
    };
    return map[type] || type;
  },

  setStatusFilter(status) {
    this.state.statusFilter = status;
    const chips = document.querySelectorAll('#jobsStatusChips .filter-chip');
    chips.forEach(c => {
      const match = c.getAttribute('data-status') === status;
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

  setFilter(status) {
    this.setStatusFilter(status);
  },

  search(query) {
    this.state.searchQuery = query || '';
    this.applyFilters();
  },

  clearSearch() {
    this.state.searchQuery = '';
    const input = document.getElementById('jobsSearchInput');
    if (input) {
      input.value = '';
      input.focus();
    }
    this.applyFilters();
  },

  resetAll() {
    this.state.statusFilter = 'all';
    this.state.searchQuery = '';
    const input = document.getElementById('jobsSearchInput');
    if (input) input.value = '';
    const chips = document.querySelectorAll('#jobsStatusChips .filter-chip');
    chips.forEach(c => {
      const isAll = c.getAttribute('data-status') === 'all';
      if (isAll) {
        c.classList.add('active');
        c.setAttribute('aria-pressed', 'true');
      } else {
        c.classList.remove('active');
        c.setAttribute('aria-pressed', 'false');
      }
    });
    this.applyFilters();
    if (this.tableSelect) {
      this.tableSelect.clear();
    }
  },

  applyFilters() {
    const q = (this.state.searchQuery || '').trim().toLowerCase();
    const status = this.state.statusFilter;
    const rows = document.querySelectorAll('table.data-table tbody tr[id^="row-job-"]');
    const emptyRow = document.getElementById('jobs-empty-row');
    const countBadge = document.getElementById('jobsFilterCount');
    const searchWrapper = document.getElementById('jobsSearchWrapper');

    if (searchWrapper) {
      if (q) searchWrapper.classList.add('has-value');
      else searchWrapper.classList.remove('has-value');
    }

    let visibleCount = 0;
    const totalCount = rows.length;

    rows.forEach(r => {
      const rowStatus = r.getAttribute('data-status');
      const rowText = (r.getAttribute('data-search') || r.innerText).toLowerCase();

      const statusMatch = status === 'all' || rowStatus === status;
      const searchMatch = !q || rowText.includes(q);
      const isVisible = statusMatch && searchMatch;

      r.style.display = isVisible ? '' : 'none';
      if (isVisible) visibleCount++;
    });

    if (emptyRow) {
      emptyRow.style.display = (visibleCount === 0 && totalCount > 0) ? '' : 'none';
    }

    if (countBadge) {
      countBadge.innerText = `نمایش ${visibleCount.toLocaleString('fa-IR')} از ${totalCount.toLocaleString('fa-IR')} پردازش`;
    }

    if (this.tableSelect) {
      this.tableSelect.sync();
    }
  },

  triggerRetry(jobId) {
    const store = window.GMStore || window.prototypeStore;
    const jobs = store && store.getJobs ? store.getJobs() : [];
    const job = jobs.find(j => j.id === jobId);
    const jobName = job ? `${job.id} (${this.formatJobType(job.type)})` : jobId;

    const modalContent = `
      <div style="display: flex; flex-direction: column; gap: 0.85rem;">
        <p>آیا از بازآزمایی مجدد پردازش <strong>${jobName}</strong> اطمینان دارید؟</p>
        ${job && job.error ? `
          <div class="job-error-callout">
            <strong class="job-error-callout-title">آخرین خطای ثبت‌شده:</strong>
            <div class="job-error-callout-msg">${job.error}</div>
          </div>
        ` : ''}
        <div class="alert alert-info" style="font-size: 0.78rem;">
          این فرمان وضعیت کار را به حالت «در حال اجرا» برمی‌گرداند و شمارنده تلاش را افزایش می‌دهد.
        </div>
      </div>
    `;

    if (window.GMApp && typeof window.GMApp.openModal === 'function') {
      if (window.GMApp.showToast) {
        window.GMApp.showToast(`بازآزمایی جاب ${jobId} آماده‌ی تأیید است.`, 'info');
      }
      // Defer the modal one tick so the pointerup/keyboard activation that
      // opened it cannot land on the freshly-rendered confirm button.
      setTimeout(() => {
        window.GMApp.openModal(`تأیید بازآزمایی پردازش ${jobId}`, modalContent, () => {
          this.executeRetry(jobId);
        });
      }, 0);
    } else {
      this.executeRetry(jobId);
    }
  },

  executeRetry(jobId) {
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast(`درخواست بازآزمایی برای جاب ${jobId} ارسال شد...`, 'info');
    }
    const store = window.GMStore || window.prototypeStore;
    if (store && store.retryJob) {
      store.retryJob(jobId);
    }
    if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
      window.GMRouter.refresh();
    }

    setTimeout(() => {
      if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
        window.GMRouter.refresh();
      }
    }, 1200);
    setTimeout(() => {
      if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
        window.GMRouter.refresh();
      }
    }, 2800);
  },

  copyJobLogs(jobId) {
    const store = window.GMStore || window.prototypeStore;
    const jobs = store && store.getJobs ? store.getJobs() : [];
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;

    const logText = [
      `[JOB_ID]: ${job.id}`,
      `[TYPE]: ${job.type} (${this.formatJobType(job.type)})`,
      `[TENANT]: ${job.tenantId}`,
      `[STATUS]: ${job.status}`,
      `[ATTEMPTS]: ${job.attempts}/${job.maxRetries}`,
      `[PROGRESS]: ${job.progress}%`,
      `[TIMESTAMP]: ${job.createdAt}`,
      job.error ? `[ERROR]: ${job.error}` : null,
      `[TRACE]:`,
      `  - [${job.createdAt}] Job enqueued to redis worker-pool-3`,
      `  - [${job.createdAt}] Attempt 1 initialized by system scheduler`,
      job.status === 'failed'
        ? `  - [${job.createdAt}] Step failed: ${job.error}\n  - [${job.createdAt}] Job marked as FAILED. Awaiting retry or dead-letter queue.`
        : `  - [${job.createdAt}] Execution completed in 1.4s.\n  - [${job.createdAt}] Status updated to COMPLETED.`
    ].filter(Boolean).join('\n');

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(logText).catch(() => {});
    }
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast(`متن خطا و لاگ اجرایی جاب ${job.id} در کلیپ‌بورد کپی شد.`, 'info');
    }
  },

  viewJobDetails(jobId) {
    const store = window.GMStore || window.prototypeStore;
    const jobs = store && store.getJobs ? store.getJobs() : [];
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;

    const content = `
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <div class="surface-subtle">
          <div class="text-xs text-secondary">شناسه و نوع کار</div>
          <div class="cell-mono text-cyan text-strong" style="font-size: 0.875rem; margin-top: 0.2rem;">${job.id}</div>
          <div class="text-xs text-secondary" style="margin-top: 0.15rem;">${this.formatJobType(job.type)} (${job.type})</div>
        </div>

        <div class="kv-list" style="border-top: 1px solid var(--border-subtle); padding-top: 0.6rem;">
          <div class="kv-item">
            <span class="kv-label">مجموعه هدف:</span>
            <span class="kv-val">${job.tenantId}</span>
          </div>
          <div class="kv-item">
            <span class="kv-label">وضعیت فعلی:</span>
            <span class="text-primary">${job.status}</span>
          </div>
          <div class="kv-item">
            <span class="kv-label">شمارنده تلاش:</span>
            <span class="cell-mono text-primary">${job.attempts} از ${job.maxRetries}</span>
          </div>
          <div class="kv-item">
            <span class="kv-label">پیشرفت کلی:</span>
            <span class="cell-mono text-cyan">${job.progress}%</span>
          </div>
        </div>

        ${job.error ? `
          <div class="job-error-callout">
            <strong class="job-error-callout-title">پیام خطا:</strong>
            <div class="job-error-callout-msg">${job.error}</div>
          </div>
        ` : ''}

        <div>
          <div class="job-trace-toolbar">
            <label class="form-label" style="font-size: 0.813rem; font-weight: 600; color: var(--text-primary); margin: 0;">رد پای اجرایی:</label>
            <button type="button" class="btn btn-secondary btn-xs" onclick="window.GMViews.GM25.copyJobLogs('${job.id}')" title="کپی متن کامل لاگ و رخدادها">
              کپی لاگ
            </button>
          </div>
          <div class="job-trace-box cell-mono text-xs text-ltr">
            [${job.createdAt}] Job enqueued to redis worker-pool-3<br>
            [${job.createdAt}] Attempt 1 initialized by system scheduler<br>
            ${job.status === 'failed' ? `[${job.createdAt}] Step failed: ${job.error}<br>[${job.createdAt}] Job marked as FAILED. Awaiting retry or dead-letter queue.` : `[${job.createdAt}] Execution completed in 1.4s.<br>[${job.createdAt}] Status updated to COMPLETED.`}
          </div>
        </div>

        ${job.status === 'failed' ? `
          <div style="margin-top: 0.5rem;">
            <button class="btn btn-warning btn-block" onclick="window.GMViews.GM25.triggerRetry('${job.id}'); if (window.GMApp && window.GMApp.closeDrawer) window.GMApp.closeDrawer();">
              تلاش مجدد
            </button>
          </div>
        ` : ''}
      </div>
    `;

    if (window.GMApp && window.GMApp.openDrawer) {
      window.GMApp.openDrawer(`گزارش وضعیت جاب: ${job.id}`, content);
    }
  },

  afterRender() {
    this.initSelection();
  },

  initSelection() {
    if (window.GMTableSelect) {
      this.tableSelect = window.GMTableSelect.initTable('#gm25-jobs-table', {
        selectAllSelector: '#gm25-select-all',
        rowCheckboxSelector: '.job-row-select',
        bulkBarId: 'gm25-bulk-actions',
        countBadgeId: 'gm25-bulk-count',
        onSelectionChange: (selectedIds, selectedRows, items) => {
          const failedItems = items.filter(it => it.status === 'failed');
          const retryBtn = document.getElementById('gm25-bulk-retry-btn');
          if (retryBtn) {
            if (failedItems.length > 0) {
              retryBtn.removeAttribute('disabled');
              retryBtn.innerHTML = `بازآزمایی ${failedItems.length.toLocaleString('fa-IR')} کار ناموفق`;
            } else {
              retryBtn.setAttribute('disabled', 'true');
              retryBtn.innerHTML = 'بازآزمایی (مورد ناموفقی نیست)';
            }
          }
        }
      });
    }
  },

  clearSelection() {
    if (this.tableSelect) {
      this.tableSelect.clear();
    }
  },

  copySelectedIds() {
    if (!this.tableSelect) return;
    const ids = this.tableSelect.getSelectedIds();
    if (ids.length === 0) {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast('لطفاً حداقل یک جاب را برای کپی شناسه انتخاب فرمایید.', 'warning');
      }
      return;
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(ids.join(', ')).catch(() => {});
    }
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast(`${ids.length.toLocaleString('fa-IR')} شناسه در کلیپ‌بورد کپی شد.`, 'info');
    }
  },

  triggerBulkRetry() {
    if (!this.tableSelect) return;
    const items = this.tableSelect.getSelectedItems();
    const failedItems = items.filter(it => it.status === 'failed');

    if (failedItems.length === 0) {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast('هیچ کار ناموفقی در میان موارد انتخاب‌شده وجود ندارد.', 'warning');
      }
      return;
    }

    const failedIds = failedItems.map(it => it.id);
    const modalContent = `
      <div style="display: flex; flex-direction: column; gap: 0.85rem;">
        <p>آیا از بازآزمایی مجدد و راه‌اندازی هم‌زمان <strong>${failedIds.length.toLocaleString('fa-IR')}</strong> پردازش ناموفق زیر در صف اطمینان دارید؟</p>
        <div class="surface-subtle" style="max-height: 180px; overflow-y: auto;">
          ${failedItems.map(item => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.35rem 0; border-bottom: 1px solid var(--border-subtle);">
              <code class="nav-code">${item.id}</code>
              <span class="badge badge-danger" style="font-size: 0.72rem;">ناموفق</span>
            </div>
          `).join('')}
        </div>
        <div class="alert alert-info" style="font-size: 0.78rem;">
          این فرمان فقط صف محلی Fixture را تغییر می‌دهد؛ Worker واقعی، outbox و ACK مقصد در دسترس نیست.
        </div>
      </div>
    `;

    if (window.GMApp && window.GMApp.openModal) {
      // Keep the confirmation boundary intact for pointer and keyboard users.
      setTimeout(() => {
        window.GMApp.openModal('تأیید بازآزمایی گروهی پردازش‌ها', modalContent, () => {
          const store = window.GMStore || window.prototypeStore;
          if (store && store.bulkRetryJobs) {
            store.bulkRetryJobs(failedIds);
          } else if (store && store.retryJob) {
            failedIds.forEach(id => store.retryJob(id));
          }
          if (this.tableSelect) {
            this.tableSelect.clear();
          }
          if (window.GMApp && window.GMApp.showToast) {
            window.GMApp.showToast(`فرمان تلاش مجدد برای ${failedIds.length.toLocaleString('fa-IR')} کار فقط در Fixture ثبت شد؛ Worker واقعی فراخوانی نشد.`, 'info');
          }
          if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
            window.GMRouter.refresh();
          }
        });
      }, 0);
    }
  }
};

window.renderGM25 = function(params) {
  setTimeout(() => {
    if (window.GMViews.GM25 && typeof window.GMViews.GM25.initSelection === 'function') {
      window.GMViews.GM25.initSelection();
    }
  }, 0);
  return window.GMViews.GM25.render(params);
};
