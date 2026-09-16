/**
 * prototype/js/views/gm21-support.js
 * 
 * GM-21: تیکت‌ها و نشست‌های اضطراری پشتیبانی (/support)
 * پاسخگویی به درخواست‌های فنی، پایش SLA و مدیریت نشست‌های نمایندگی (Support Impersonation) با زمان‌سنج ابطال
 */

window.GMViews = window.GMViews || {};

window.renderGM21 = function(params) {
  const store = window.prototypeStore || window.GMStore;
  const tenants = store && store.getTenants ? store.getTenants() : [];
  const tenantId = (params && params.id) || (store ? store.getActiveTenantId() : 'tnt_westo_demo');
  const isAll = tenantId === 'all';
  const tenant = isAll
    ? { id: 'all', name: 'تمامی مشتریان و رستوران‌ها', cellId: 'سراسری' }
    : ((store && store.getTenant ? store.getTenant(tenantId) : null) || { id: tenantId, name: 'کافه وستو', cellId: 'cell-teh-01' });
  const tickets = store && store.getTickets ? store.getTickets(tenantId) : [];
  const sessions = (store && store.getSupportSessions ? store.getSupportSessions() : []).filter(s => isAll || !tenantId || s.tenantId === tenantId);
  const activeSessionCount = sessions.filter(s => s.status === 'active').length;
  const supportSource = tickets.length || sessions.length ? 'سامانه یکپارچه پشتیبانی و تیکتینگ NEEM' : 'بدون رکورد قابل مشاهده';
  const cellLabel = isAll ? 'سراسری' : ({ 'cell-teh-01': 'تهران', 'cell-msh-01': 'مشهد', 'cell-mashhad-01': 'مشهد' }[tenant.cellId] || 'مرکز عملیاتی');

  setTimeout(() => {
    if (window.GMViews && window.GMViews.GM21) {
      window.GMViews.GM21.init();
    }
  }, 50);

  return `
    <div class="page-header gm21-page">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
          <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
          <span class="breadcrumb-separator">/</span>
          ${isAll ? '' : `<a href="#gm-04-tenant-detail?id=${tenant.id}" class="breadcrumb-link">پرونده مشتری</a>`}
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current" aria-current="page">پشتیبانی فنی</span>
        </nav>
        <h1>
          ${isAll ? 'مرکز پشتیبانی و تیکت‌های کلان پلتفرم' : `تیکت‌ها و پشتیبانی: ${tenant.name}`}
          <span class="badge scope-cell-badge">${cellLabel}</span>
          <span class="badge ${isAll ? 'badge-scope-global' : 'badge-scope-tenant'}">
            <span class="status-dot ${isAll ? 'dot-purple' : 'dot-active'}"></span>
            ${isAll ? 'سراسری' : 'دامنه مشتری'}
          </span>
          <span class="page-code-badge">GM-21</span>
        </h1>
        <p>پایش تیکت‌های پشتیبانی مشتریان، تعهد پاسخگویی (SLA) و ورود مجاز اپراتور با زمان محدود</p>
      </div>
      <div class="header-actions">
        <button class="btn btn-primary" onclick="window.openGM21NewTicketModal()">
          ثبت تیکت پشتیبانی جدید
        </button>
        <a href="#gm-28-portal" class="btn btn-secondary">
          پورتال مشتریان
        </a>
      </div>
    </div>

    ${window.GMDataState ? window.GMDataState.renderFreshnessBar({
      viewId: 'GM21',
      sourceLabel: 'مرکز پشتیبانی تیکتینگ، صف‌های SLA و نشست‌های نمایندگی',
      sourceMode: 'local',
      totalCount: tickets.length,
      countLabel: 'تیکت پشتیبانی'
    }) : ''}

    <div class="op-context-banner op-context-info" role="region" aria-label="راهنمای اجرای پشتیبانی">
      <div class="op-context-header">
        <span>پشتیبانی و نشست اضطراری امن (Break-glass Access)</span>
        <span class="badge badge-success">سرویس پشتیبانی عملیاتی</span>
      </div>
      <div class="op-context-grid">
        <div class="op-context-item"><span class="op-context-label">منبع:</span><span class="op-context-desc">تیکت‌ها، نشست‌ها و شاخص‌های تعهد SLA از پایگاه داده پشتیبانی پلتفرم خوانده می‌شوند.</span></div>
        <div class="op-context-item"><span class="op-context-label">پیامد:</span><span class="op-context-desc">نشست‌های اضطراری با ثبت کامل رخداد امنیتی و محدودیت زمانی ۳۰ دقیقه‌ای صادر می‌گردند.</span></div>
        <div class="op-context-item"><span class="op-context-label">امنیت:</span><span class="op-context-desc">دسترسی‌ها تحت تفکیک کامل Tenant و ثبت اثر انگشت اپراتور کنترل می‌شود.</span></div>
      </div>
    </div>

    ${(() => {
      const dataState = window.GMDataState ? window.GMDataState.getViewState('GM21') : { state: 'live' };
      if (dataState.state === 'failed' || dataState.state === 'error') {
        return window.GMDataState.renderFailedState({
          viewId: 'GM21',
          title: 'خطا در واکشی تیکت‌های پشتیبانی',
          reason: 'ارتباط با سرور پشتیبانی فنی یا صف پیام‌ها برقرار نشد.',
          errorCode: 'ERR_SUPPORT_DISPATCH_UNREACHABLE'
        });
      }
      if (dataState.state === 'empty') {
        return window.GMDataState.renderEmptyState({
          title: 'هیچ تیکت پشتیبانی یافت نشد',
          summary: 'عدم ثبت تیکت فعال، درخواست پشتیبانی یا نشست دسترسی اضطراری',
          description: 'هیچ تیکت باز، ارجاع‌شده یا خاتمه‌یافته‌ای برای این مجموعه در بازه جاری ثبت نشده است.',
          auditScope: 'مکاتبات فنی اپراتور، نشست‌های دسترسی موقت نمایندگی و لاگ‌های ارجاع تیکت وستو',
          actionLabel: 'ثبت تیکت جدید',
          onAction: 'window.openGM21NewTicketModal()'
        });
      }
      if (dataState.state === 'loading') {
        return window.GMDataState.renderSkeleton('table', 4);
      }
      if (dataState.state === 'stale') {
        return window.GMDataState.renderStaleBanner('GM21');
      }
      if (dataState.state === 'refreshing') {
        return window.GMDataState.renderRefreshingBanner ? window.GMDataState.renderRefreshingBanner('GM21') : '';
      }
      return '';
    })()}

    ${(window.GMDataState && ['failed', 'empty', 'error', 'loading'].includes(window.GMDataState.getViewState('GM21').state)) ? '' : `
    <!-- Tenant Scope Correlation Bar -->
    <div class="tenant-correlation-bar">
      <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
        <span style="font-size: 0.813rem; font-weight: 600; color: var(--text-secondary);">تفکیک تیکت‌های رستوران:</span>
        <a href="#gm-21-support?id=all" class="filter-chip ${isAll ? 'active' : ''}">همه تیکت‌ها (${(store ? store.getTickets('all') : []).length})</a>
        ${tenants.map(t => {
          const tTcks = store ? store.getTickets(t.id) : [];
          return `
            <a href="#gm-21-support?id=${t.id}" class="filter-chip ${tenantId === t.id ? 'active' : ''}">
              ${t.name} (${tTcks.length})
            </a>
          `;
        }).join('')}
      </div>
      <div style="display: flex; gap: 0.5rem; align-items: center;">
        ${!isAll ? `
          <a href="#gm-04-tenant-detail?id=${tenantId}&tab=support" class="btn btn-xs btn-secondary">
            پرونده پشتیبانی ${tenant.name}
          </a>
        ` : ''}
        <button class="btn btn-xs btn-primary" onclick="window.grantBreakGlassSessionPrompt('${!isAll ? tenantId : 'tnt_westo_demo'}')">
          صدور ورود اضطراری
        </button>
      </div>
    </div>

    <!-- Operational Guidance Banner -->
    <div class="op-context-banner op-context-warning" role="region" aria-label="راهنمای امنیتی نشست‌های اضطراری پشتیبانی">
      <div class="op-context-header">
        <span>راهنمای نشست‌های نمایندگی پشتیبانی و ورود اضطراری</span>
        <span class="badge badge-warning">دسترسی موقت اضطراری</span>
      </div>
      <div class="op-context-grid">
        <div class="op-context-item">
          <span class="op-context-label">وضعیت جاری:</span>
          <span class="op-context-desc">امکان ورود موقت اپراتور به پنل کاربری مشتری با زمان‌سنج ابطال خودکار جهت رفع خطاهای سیستمی.</span>
        </div>
        <div class="op-context-item">
          <span class="op-context-label">تعهد معماری و پیامد:</span>
          <span class="op-context-desc">کلیه اقدامات، تغییرات فاکتور و مشاهده داده‌ها در <strong>لاگ ممیزی</strong> با امضای دیجیتال ثبت می‌گردد.</span>
        </div>
        <div class="op-context-item">
          <span class="op-context-label">اقدام استاندارد بعدی:</span>
          <span class="op-context-desc">به محض اتمام عیب‌یابی، دکمه <strong>«قطع فوری نشست»</strong> را کلیک کرده تا سشن باز نماند.</span>
        </div>
      </div>
    </div>

    <div class="data-quality-strip" role="status" aria-label="وضعیت داده‌های پشتیبانی">
      <div class="data-quality-label"><span class="dq-badge-dot dot-cyan"></span><span>وضعیت پشتیبانی</span></div>
      <div class="data-quality-grid">
        <span class="dq-badge"><span class="dq-badge-dot ${tickets.length || sessions.length ? 'dot-blue' : 'dot-purple'}"></span><span class="dq-dim-name">منبع</span><span class="dq-dim-val">${supportSource}</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">تیکت قابل مشاهده</span><span class="dq-dim-val">${tickets.length.toLocaleString('fa-IR')} مورد</span></span>
        <span class="dq-badge"><span class="dq-badge-dot ${activeSessionCount ? 'dot-emerald' : 'dot-purple'}"></span><span class="dq-dim-name">نشست اضطراری فعال</span><span class="dq-dim-val">${activeSessionCount.toLocaleString('fa-IR')} مورد</span></span>
      </div>
      <span class="dq-action-hint"><span>تعدادها از حافظه پیش‌نمایش خوانده می‌شوند؛ ورود اضطراری فقط با دلیل و ثبت ممیزی انجام شود</span></span>
    </div>

    <!-- Active Emergency Support Sessions -->
    <div class="card" style="margin-bottom: 1.25rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem; padding-bottom: 0.6rem; border-bottom: 1px solid var(--border-subtle);">
        <div>
          <div style="font-weight: 600; font-size: 0.875rem; color: var(--state-warning);">نشست‌های فعال نمایندگی پشتیبانی</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.15rem;">دسترسی موقت اپراتور پلتفرم به محیط کاربری با انقضای خودکار</div>
        </div>
        <span class="badge badge-warning">${activeSessionCount} نشست فعال</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 0.5rem;">
        ${sessions.map(s => `
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem; background: var(--bg-surface-subtle); padding: 0.75rem 1rem; border-radius: 6px; border: 1px solid var(--border-subtle);">
            <div>
              <div style="font-weight: 600; font-size: 0.813rem; color: var(--text-primary);">
                ${s.tenantName} — اپراتور: ${s.operatorName}
              </div>
              <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.2rem;">
                علت دسترسی: <em>${(s.reason || '').replace(/\s+طبق تیکت.*$/u, '')}</em>
                <details class="row-disclosure support-technical-details">
                  <summary>جزئیات فنی نشست</summary>
                  <span>${s.reason}</span>
                  <code class="nav-code">${s.scope}</code>
                </details>
              </div>
            </div>
            <div style="display: flex; gap: 0.5rem; align-items: center;">
              <span class="badge badge-neutral" style="font-size: 0.75rem;">${s.expiresInMinutes} دقیقه تا انقضا</span>
              <button class="btn btn-danger btn-sm" onclick="window.terminateGM21Session('${s.id}')" aria-label="ابطال فوری نشست پشتیبانی ${s.id}">
                قطع فوری نشست
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Tickets Table with Toolbar, Select All, and Bulk Actions -->
    <div class="table-wrapper">
      <div class="table-toolbar">
        <div class="table-filters" id="ticketStatusFilters" role="group" aria-label="فیلتر اولویت و وضعیت تیکت">
          <button class="filter-chip active" aria-pressed="true" onclick="window.GMViews.GM21.setStatusFilter('all', this)">همه (${tickets.length})</button>
          <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM21.setStatusFilter('high', this)">فوری (P1)</button>
          <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM21.setStatusFilter('normal', this)">عادی (P2)</button>
          <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM21.setStatusFilter('open', this)">باز</button>
        </div>
        <div class="table-search-group">
          <span id="ticketsFilterCount" class="filter-count-badge">نمایش ${tickets.length.toLocaleString('fa-IR')} از ${tickets.length.toLocaleString('fa-IR')} تیکت پشتیبانی</span>
          <div class="search-input-wrapper" id="ticketSearchWrapper">
            <input type="text" id="ticketSearchInput" class="form-control" placeholder="جست‌وجو در شناسه، مشتری، عنوان یا کارشناس..." aria-label="جست‌وجو در تیکت‌های پشتیبانی" style="width: 240px; padding: 0.35rem 0.75rem;" oninput="window.GMViews.GM21.setQuery(this.value)" />
            <button class="search-clear-btn" onclick="window.GMViews.GM21.clearSearch()" aria-label="پاکسازی جستجو">✕</button>
          </div>
        </div>
      </div>
      <div class="table-responsive">
        <table class="data-table" id="ticketsTable" aria-label="جدول فهرست تیکت‌های پشتیبانی فنی">
          <thead>
            <tr>
              <th class="cell-checkbox" style="width: 40px; text-align: center;">
                <input type="checkbox" id="tickets-select-all" aria-label="انتخاب همه تیکت‌های پشتیبانی" />
              </th>
              <th>تیکت</th>
              <th>مشتری / مجموعه</th>
              <th>دسته‌بندی</th>
              <th>اولویت</th>
              <th>مسئول پیگیری</th>
              <th>مهلت SLA</th>
              <th>وضعیت</th>
              <th class="cell-actions">عملیات</th>
            </tr>
          </thead>
          <tbody>
            ${tickets.map(t => `
              <tr class="ticket-row" data-id="${t.id}" data-priority="${t.priority}" data-status="${t.status}" data-search="${(t.id + ' ' + (t.tenantName || '') + ' ' + (t.title || '') + ' ' + (t.category || '') + ' ' + (t.assignedTo || '')).toLowerCase()}">
                <td class="cell-checkbox" style="text-align: center;">
                  <input type="checkbox" class="ticket-row-select" data-id="${t.id}" aria-label="انتخاب تیکت ${t.id}" />
                </td>
                <td>
                  <strong style="color: var(--text-primary);">${t.title}</strong>
                  <details class="row-disclosure support-technical-details">
                    <summary>شناسه تیکت</summary>
                    <code class="nav-code">${t.id}</code>
                  </details>
                </td>
                <td>
                  <a href="#gm-04-tenant-detail?id=${t.tenantId}&tab=support" style="text-decoration: none; color: var(--accent-cyan); font-weight: 600;" title="مشاهده پرونده پشتیبانی">
                    ${t.tenantName}
                  </a>
                </td>
                <td><span class="badge badge-neutral">${t.category}</span></td>
                <td>
                  ${t.priority === 'high'
                    ? '<span class="badge badge-danger">فوری (P1)</span>'
                    : '<span class="badge badge-neutral">عادی (P2)</span>'
                  }
                </td>
                <td style="color: var(--text-secondary);">${t.assignedTo}</td>
                <td>
                  <span class="cell-mono font-bold ${t.slaMinutesRemaining < 45 ? 'text-danger' : ''}">
                    ${t.slaMinutesRemaining} دقیقه
                  </span>
                </td>
                <td>
                  ${t.status === 'open'
                    ? '<span class="badge badge-warning"><span class="badge-dot"></span> باز</span>'
                    : '<span class="badge badge-neutral"><span class="badge-dot"></span> در دست بررسی</span>'
                  }
                </td>
                <td class="cell-actions">
                  <button class="btn btn-secondary btn-sm" onclick="window.openGM21TicketDrawer('${t.id}', '${t.title}', '${t.tenantName}')" aria-label="مشاهده جزئیات تیکت ${t.id}">
                    بررسی و اقدام
                  </button>
                </td>
              </tr>
            `).join('')}
            <tr id="tickets-empty-row" style="display: none;">
              <td colspan="9" style="text-align: center; padding: 2rem; color: var(--text-muted);">
                موردی مطابق با فیلترها یا عبارت جست‌وجو شده یافت نشد.
                <button class="btn btn-xs btn-secondary" style="margin-right: 0.5rem;" onclick="window.GMViews.GM21.resetAll()">پاکسازی فیلترها</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Docked Bulk Actions Bar -->
    <div id="gm21-bulk-actions" class="bulk-actions-docked" role="toolbar" aria-label="عملیات گروهی روی تیکت‌ها" style="display: none;">
      <div class="bulk-actions-content">
        <div class="bulk-actions-info">
          <span class="bulk-selected-count">۰ مورد انتخاب شده</span>
        </div>
        <div class="bulk-actions-buttons">
          <button class="btn btn-sm btn-primary" onclick="window.GMViews.GM21.bulkAssignSelected()">
            ارجاع گروهی به پشتیبان
          </button>
          <button class="btn btn-sm btn-secondary" onclick="window.GMViews.GM21.bulkCloseSelected()">
            بستن دسته‌جمعی تیکت‌ها
          </button>
          <button class="btn btn-sm btn-subtle" onclick="window.GMViews.GM21.tableSelect && window.GMViews.GM21.tableSelect.clearSelection()">
            لغو انتخاب
          </button>
        </div>
      </div>
    </div>
    `}
  `;
};

window.terminateGM21Session = function(sessionId) {
  const store = window.prototypeStore || window.GMStore;
  const sessions = (store && store.getSupportSessions) ? store.getSupportSessions() : [];
  const ses = sessions.find(s => s.id === sessionId) || { id: sessionId, agentName: 'کارشناس پشتیبانی', tenantName: 'کافه وستو' };

  const content = `
    <div style="display: flex; flex-direction: column; gap: 0.85rem;">
      <p class="text-primary" style="font-size: 0.813rem; line-height: 1.5;">
        آیا از قطع فوری نشست اضطراری <strong>${ses.id}</strong> برای کارشناس <strong>${ses.agentName}</strong> در مجموعه <strong>${ses.tenantName || 'کافه وستو'}</strong> اطمینان دارید؟
      </p>
      <div class="alert alert-danger">
        <strong>پیامد امنیتی:</strong> دسترسی کارشناس به دیتابیس و محیط اختصاصی مشتری بلافاصله مسدود می‌شود و رکورد قطع اضطراری در لاگ ممیزی پلتفرم ثبت خواهد شد.
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal('تأیید قطع فوری نشست پشتیبانی', content, () => {
      const result = store && store.terminateSupportSession ? store.terminateSupportSession(sessionId) : null;
      if (result) {
        window.GMApp.showToast(`نشست اضطراری ${sessionId} با موفقیت خاتمه یافت و دسترسی مسدود گردید.`, 'success');
        if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
          window.GMRouter.refresh();
        } else if (window.GMRouter && typeof window.GMRouter.handleRoute === 'function') {
          window.GMRouter.handleRoute();
        }
      }
    }, {
      confirmText: 'قطع فوری دسترسی',
      confirmVariant: 'danger',
      severity: 'danger',
      severityLabel: 'ابطال اضطراری'
    });
  } else {
    const result = store && store.terminateSupportSession ? store.terminateSupportSession(sessionId) : null;
    if (result && window.GMRouter) window.GMRouter.refresh();
  }
};

window.openGM21TicketDrawer = function(ticketId, title, tenantName) {
  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div>
        <div class="text-secondary" style="font-size: 0.75rem;">مشتری مربوطه:</div>
        <div class="text-primary" style="font-weight: 700; font-size: 0.95rem; margin-top: 0.15rem;">${tenantName}</div>
        <div class="text-cyan" style="font-weight: 600; font-size: 0.813rem; margin-top: 0.35rem;">${title}</div>
      </div>

      <div class="drawer-section-divider">
        <label class="form-label text-primary" style="font-size: 0.813rem; font-weight: 600;">اقدامات سریع اپراتور:</label>
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          <button class="btn btn-primary btn-sm" onclick="window.GMApp ? window.GMApp.showToast('نشست پشتیبانی امن برای این تیکت فعال گردید.', 'success') : null">
            آغاز نشست پشتیبانی امن
          </button>
          <button class="btn btn-secondary btn-sm" onclick="window.GMApp ? window.GMApp.showToast('پیامک پیگیری با موفقیت به شماره مالک رستوران ارسال شد.', 'success') : null">
            ارسال پیامک به مالک
          </button>
        </div>
      </div>

      <div class="drawer-section-divider">
        <label class="form-label text-primary" style="font-size: 0.813rem; font-weight: 600;">شواهد تشخیصی متصل به تیکت:</label>
        <div class="surface-subtle text-secondary cell-mono" style="font-size: 0.75rem;">
          <div>دستگاه مرتبط: پایانه مرکزی ۱ (۱۹۲.۱۶۸.۱.۱۰۱)</div>
          <div style="margin-top: 0.2rem;">وضعیت شبکه: متصل و پایدار (پینگ ۳ میلی‌ثانیه)</div>
          <div style="margin-top: 0.2rem;">کد خطا: ERR_PRINT_TIMEOUT (پوشش داده‌شده با صف محلی)</div>
        </div>
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openDrawer) {
    window.GMApp.openDrawer(`بررسی تیکت: ${ticketId}`, content);
  }
};

window.openGM21NewTicketModal = function() {
  const content = `
    <div style="display: flex; flex-direction: column; gap: 0.85rem;" id="new-ticket-form">
      <div class="form-group">
        <label class="form-label" for="new-ticket-tenant">مجموعه هدف:</label>
        <select id="new-ticket-tenant" class="form-control" aria-describedby="new-ticket-tenant-help" aria-label="مجموعه هدف برای ثبت تیکت">
          <option value="tnt_westo_demo">کافه وستو (Westo Café)</option>
        </select>
        <div id="new-ticket-tenant-help" class="form-helper-text">
          <span>مجموعه‌ای که گزارش اختلال یا درخواست فنی توسط آن ثبت شده است.</span>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="new-ticket-category">دسته‌بندی موضوعی:</label>
        <select id="new-ticket-category" class="form-control" aria-label="دسته‌بندی موضوعی تیکت">
          <option value="عملیات و سخت‌افزار">عملیات، پایانه‌های پوز و شبکه</option>
          <option value="حسابداری و مالی">حسابداری، فاکتور و اسناد دوبل</option>
          <option value="سفارش‌گیری و منو">سفارش‌گیری آنلاین و اقلام منو</option>
          <option value="سایر">سایر موارد پشتیبانی</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="new-ticket-title">
          عنوان تیکت:
          <span class="field-badge field-required" aria-hidden="true">الزامی</span>
        </label>
        <input type="text" id="new-ticket-title" class="form-control" placeholder="مثال: اختلال در صدور فیش صندوق شماره ۲" aria-describedby="new-ticket-title-help" aria-required="true" oninput="window.GMApp && window.GMApp.clearFieldError(this)" aria-label="عنوان تیکت پشتیبانی" />
        <div id="new-ticket-title-help" class="form-helper-text">
          <span>شرح مختصر یک‌خطی از موضوع درخواست پشتیبانی فنی (حداقل ۵ نویسه).</span>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="new-ticket-priority">سطح اولویت و تعهد زمانی (SLA):</label>
        <select id="new-ticket-priority" class="form-control" aria-describedby="new-ticket-priority-help" aria-label="سطح اولویت و تعهد زمانی تیکت">
          <option>عادی (SLA: ۴ ساعت)</option>
          <option>فوری (SLA: ۱ ساعت)</option>
          <option>بحرانی (SLA: ۳۰ دقیقه)</option>
        </select>
        <div id="new-ticket-priority-help" class="form-helper-text">
          <span>اولویت تعیین‌کننده زمان واکنش تیم کشیک عملیات در زمان بروز اختلال است.</span>
        </div>
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal('ثبت تیکت پشتیبانی داخلی', content, () => {
      const store = window.prototypeStore || window.GMStore;
      const titleEl = document.getElementById('new-ticket-title');
      const catEl = document.getElementById('new-ticket-category');
      const title = titleEl ? titleEl.value.trim() : '';
      const category = catEl ? catEl.value : 'عملیات و سخت‌افزار';

      if (!title || title.length < 5) {
        if (window.GMApp && typeof window.GMApp.setFieldError === 'function') {
          window.GMApp.setFieldError(titleEl, 'عنوان تیکت الزامی است و باید حداقل ۵ نویسه باشد.');
        }
        if (window.GMApp && typeof window.GMApp.showToast === 'function') {
          window.GMApp.showToast('لطفاً عنوان معتبری برای تیکت وارد نمایید.', 'warning');
        }
        return false;
      }

      if (window.GMApp && typeof window.GMApp.clearFieldError === 'function') {
        window.GMApp.clearFieldError(titleEl);
      }

      const tenantId = store?.getActiveTenantId?.() || null;
      if (!tenantId || !store?.getTenant?.(tenantId)) {
        window.GMApp.showToast('پرونده مشتری معتبر نیست؛ تیکتی ثبت نشد.', 'error');
        return false;
      }
      if (store && typeof store.createTicket === 'function') {
        store.createTicket({
          title: title,
          category: category,
          tenantId
        });
      }
      window.GMApp.showToast('تیکت فقط در دادهٔ نمونهٔ مرورگر ثبت شد؛ به صف عملیاتی ارسال نشد.', 'info');
      if (window.GMRouter) window.GMRouter.refresh();
      return true;
    });
  }
};

window.grantBreakGlassSessionPrompt = function(tenantId) {
  const store = window.prototypeStore || window.GMStore;
  const tid = tenantId || (store ? store.getActiveTenantId() : null);
  const tenant = store && store.getTenant ? store.getTenant(tid) : null;
  if (!tenant) {
    window.GMApp?.showToast?.('پرونده مشتری معتبر نیست؛ نشست اضطراری صادر نشد.', 'error');
    return false;
  }

  const content = `
    <div style="display: flex; flex-direction: column; gap: 0.85rem;" id="breakglass-form">
      <div style="background: rgba(244, 63, 94, 0.08); border: 1px solid rgba(244, 63, 94, 0.25); border-radius: 6px; padding: 0.75rem;">
        <strong style="color: #fb7185; font-size: 0.85rem; display: block; margin-bottom: 0.25rem;">پروتکل واکنش به رخداد اضطراری</strong>
        <p style="font-size: 0.75rem; color: #cbd5e1; margin: 0; line-height: 1.45;">این اقدام تمامی نشست‌های عادی را ارتقا داده و بلافاصله در لاگ‌های حسابرسی رمزنگاری‌شده NEEM با امضای اپراتور کشیک ثبت خواهد شد.</p>
      </div>

      <div class="form-group">
        <label class="form-label" for="breakglass-tenant">مجموعه هدف:</label>
        <input type="text" id="breakglass-tenant" class="form-control" value="${tenant.name} (${tid})" readonly disabled aria-label="مجموعه هدف برای ورود اضطراری" />
      </div>

      <div class="form-group">
        <label class="form-label" for="breakglass-reason">
          علت صدور مجوز اضطراری:
          <span class="field-badge field-required" aria-hidden="true">الزامی</span>
        </label>
        <textarea id="breakglass-reason" class="form-control" rows="3" placeholder="مثال: بررسی مغایرت در تراکنش‌های صندوق شماره ۲…" aria-required="true" oninput="window.GMApp && window.GMApp.clearFieldError(this)" aria-label="علت صدور مجوز اضطراری ورود"></textarea>
        <div class="form-hint">شرح دقیق دلیل مداخله فنی (حداقل ۱۰ نویسه جهت پیگیری قانونی و ممیزی).</div>
      </div>

      <div class="grid-cols-2" style="margin-bottom: 0;">
        <div class="form-group">
          <label class="form-label" for="breakglass-duration">مدت زمان اعتبار نشست:</label>
          <select id="breakglass-duration" class="form-control" aria-label="مدت زمان اعتبار نشست ورود اضطراری">
            <option value="30">۳۰ دقیقه (پیشنهادی)</option>
            <option value="60" selected>۱ ساعت</option>
            <option value="120">۲ ساعت</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="breakglass-operator">اپراتور صادرکننده:</label>
          <input type="text" id="breakglass-operator" class="form-control" value="اپراتور نمونهٔ NEEM" readonly aria-label="اپراتور صادرکننده مجوز" />
        </div>
      </div>

      <div class="form-group" style="margin-top: 0.25rem;">
        <label for="breakglass-confirm-check" style="display: flex; gap: 0.5rem; align-items: center; font-size: 0.813rem; color: var(--text-primary); cursor: pointer;">
          <input type="checkbox" id="breakglass-confirm-check" onchange="window.GMApp && window.GMApp.clearFieldError(this)" aria-label="پذیرش مسئولیت قانونی و امنیتی ورود اضطراری" />
          <span>مسئولیت قانونی و امنیتی ورود اضطراری به حساب مشتری را می‌پذیرم.</span>
        </label>
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal(`صدور دسترسی اضطراری: ${tenant.name}`, content, () => {
      const reasonEl = document.getElementById('breakglass-reason');
      const checkEl = document.getElementById('breakglass-confirm-check');
      const durEl = document.getElementById('breakglass-duration');
      const reasonVal = (reasonEl ? reasonEl.value : '').trim();
      const confirmed = checkEl ? checkEl.checked : false;
      const duration = parseInt(durEl ? durEl.value : '60', 10);

      let hasError = false;
      if (!reasonVal || reasonVal.length < 10) {
        if (window.GMApp && typeof window.GMApp.setFieldError === 'function') {
          window.GMApp.setFieldError(reasonEl, 'ثبت علت موجه الزامی است (حداقل ۱۰ نویسه).');
        }
        hasError = true;
      } else if (reasonEl && window.GMApp && typeof window.GMApp.clearFieldError === 'function') {
        window.GMApp.clearFieldError(reasonEl);
      }

      if (!confirmed) {
        if (checkEl && window.GMApp && typeof window.GMApp.setFieldError === 'function') {
          window.GMApp.setFieldError(checkEl, 'تأیید پذیرش مسئولیت الزامی است.');
        }
        hasError = true;
      } else if (checkEl && window.GMApp && typeof window.GMApp.clearFieldError === 'function') {
        window.GMApp.clearFieldError(checkEl);
      }

      if (hasError) {
        if (window.GMApp && typeof window.GMApp.showToast === 'function') {
          window.GMApp.showToast('لطفاً خطاهای مشخص‌شده در فرم دسترسی اضطراری را اصلاح نمایید.', 'warning');
        }
        return false;
      }

      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast(`پروتوتایپ مجاز به صدور نشست اضطراری برای ${tenant.name} نیست؛ هیچ دسترسی‌ای ایجاد نشد.`, 'warning');
      }
      return false;
    }, {
      confirmText: 'تأیید و صدور فوری نشست',
      confirmVariant: 'danger',
      severity: 'danger',
      severityLabel: 'اقدام امنیتی حساس'
    });
  }
};

window.GMViews.GM21 = {
  statusFilter: 'all',
  query: '',
  tableSelect: null,

  init() {
    if (window.GMTableSelect && typeof window.GMTableSelect.initTable === 'function') {
      this.tableSelect = window.GMTableSelect.initTable('#ticketsTable', {
        selectAllId: '#tickets-select-all',
        rowCheckboxClass: '.ticket-row-select',
        rowClass: '.ticket-row',
        bulkBarId: '#gm21-bulk-actions',
        selectedCountClass: '.bulk-selected-count'
      });
    }
  },

  applyFilters() {
    const rows = document.querySelectorAll('#ticketsTable tbody tr.ticket-row');
    let visibleCount = 0;
    const totalCount = rows.length;

    rows.forEach(row => {
      const priority = row.getAttribute('data-priority') || '';
      const status = row.getAttribute('data-status') || '';
      const searchData = row.getAttribute('data-search') || '';

      let matchFilter = true;
      if (this.statusFilter === 'high') matchFilter = priority === 'high';
      else if (this.statusFilter === 'normal') matchFilter = priority === 'normal' || priority === 'low';
      else if (this.statusFilter === 'open') matchFilter = status === 'open';

      const matchQuery = !this.query || searchData.includes(this.query);

      if (matchFilter && matchQuery) {
        row.style.display = '';
        visibleCount++;
      } else {
        row.style.display = 'none';
      }
    });

    const emptyRow = document.getElementById('tickets-empty-row');
    if (emptyRow) {
      emptyRow.style.display = (visibleCount === 0 && totalCount > 0) ? '' : 'none';
    }

    const countBadge = document.getElementById('ticketsFilterCount');
    if (countBadge) {
      countBadge.textContent = `نمایش ${visibleCount.toLocaleString('fa-IR')} از ${totalCount.toLocaleString('fa-IR')} تیکت پشتیبانی`;
    }

    const wrapper = document.getElementById('ticketSearchWrapper');
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
    document.querySelectorAll('#ticketStatusFilters .filter-chip').forEach(el => {
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
    const input = document.getElementById('ticketSearchInput');
    if (input) input.value = '';
    this.setQuery('');
  },

  resetAll() {
    this.statusFilter = 'all';
    const firstChip = document.querySelector('#ticketStatusFilters .filter-chip');
    if (firstChip) {
      document.querySelectorAll('#ticketStatusFilters .filter-chip').forEach(el => {
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

  bulkAssignSelected() {
    const ids = this.tableSelect ? this.tableSelect.getSelectedIds() : [];
    if (ids.length === 0) {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast('لطفاً ابتدا حداقل یک تیکت را انتخاب فرمایید.', 'warning');
      }
      return;
    }
    if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast(`${ids.length} تیکت فقط در Fixture به کارشناس نمونه ارجاع داده شد؛ صف عملیاتی تغییر نکرد.`, 'info');
    }
  },

  bulkCloseSelected() {
    const ids = this.tableSelect ? this.tableSelect.getSelectedIds() : [];
    if (ids.length === 0) {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast('لطفاً ابتدا حداقل یک تیکت را انتخاب فرمایید.', 'warning');
      }
      return;
    }
    if (window.GMApp && window.GMApp.openModal) {
      const content = `
        <p class="text-primary" style="font-size: 0.813rem; line-height: 1.5;">
          آیا از بستن دسته‌جمعی <strong>${ids.length} تیکت</strong> انتخاب‌شده اطمینان دارید؟
        </p>
        <div class="alert alert-warning" style="margin-top: 0.5rem;">
          این اقدام وضعیت تیکت‌ها را به «پایان‌یافته» تغییر داده و به مشتریان اطلاع‌رسانی پیامکی ارسال خواهد شد.
        </div>
      `;
      window.GMApp.openModal('تأیید بستن دسته‌جمعی تیکت‌ها', content, () => {
        if (window.GMApp && window.GMApp.showToast) {
          window.GMApp.showToast(`${ids.length} تیکت فقط در Fixture بسته شدند؛ پیامک یا وضعیت عملیاتی تغییر نکرد.`, 'info');
        }
        if (this.tableSelect) this.tableSelect.clearSelection();
      }, {
        confirmText: 'بستن تیکت‌ها',
        confirmVariant: 'primary'
      });
    }
  }
};
