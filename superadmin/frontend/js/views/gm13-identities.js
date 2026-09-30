// prototype/js/views/gm13-identities.js
// GM-13: شناسه‌ها، حساب‌های کاربری و نشست‌ها (Identities & Sessions)

window.GMViews = window.GMViews || {};

window.GMViews.GM13 = {
  render(params) {
    const store = window.GMStore || window.prototypeStore;
    const activeTenantId = params?.id || (store && store.getActiveTenantId ? store.getActiveTenantId() : null) || null;
    const tenant = (activeTenantId && store && store.getTenant ? store.getTenant(activeTenantId) : null)
      || { id: activeTenantId || '', name: 'مجموعه انتخاب نشده' };
    const identities = activeTenantId && store && store.getIdentities ? store.getIdentities(activeTenantId) : [];
    const activeSessionsCount = identities.reduce((acc, u) => acc + (u.activeSessions || 0), 0);
    const roleLabels = { owner: 'مالک مجموعه', manager: 'مدیر عملیاتی', accountant: 'حسابدار ارشد', cashier: 'صندوق‌دار', kitchen: 'آشپزخانه', support: 'پشتیبان سطح ۳' };
    const maskMobile = (value) => {
      const digits = String(value || '');
      if (digits.length < 7) return 'شماره محافظت‌شده';
      return `${digits.slice(0, 4)}***${digits.slice(-2)}`;
    };

    return `
      <div class="page-header gm13-page">
        <div class="page-title-group">
          <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
            <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
            <span class="breadcrumb-separator">/</span>
            <a href="#gm-04-tenant-detail?id=${tenant.id}" class="breadcrumb-link">پرونده مشتری</a>
            <span class="breadcrumb-separator">/</span>
            <span class="breadcrumb-current" aria-current="page">هویت و دسترسی</span>
          </nav>
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
          <h1>
              حساب‌ها، عضویت‌ها و نشست‌ها
              <span class="page-code-badge">GM-13</span>
            </h1>
            <span class="badge badge-scope-tenant"><span class="status-dot dot-active"></span> ${tenant.name}</span>
          </div>
          <p>هویت پلتفرم و عضویت رستوران جدا هستند؛ وضعیت این نما از منبع محلی می‌آید و مجوز runtime را تغییر نمی‌دهد.</p>
        </div>
        <div class="header-actions">
          <a href="#gm-15-simulator" class="btn btn-primary">
            شبیه‌ساز ارزیابی دسترسی
          </a>
          <a href="#gm-14-access-roles" class="btn btn-secondary" title="GM-14: ماتریس نقش‌ها">
            ماتریس نقش‌ها
          </a>
        </div>
      </div>

      ${window.GMDataState ? window.GMDataState.renderFreshnessBar({
        viewId: 'GM13',
        sourceLabel: 'مخزن شناسه‌ها و پرسنل شعب وستو',
        sourceMode: 'local',
        totalCount: identities.length,
        countLabel: 'شناسه کاربری'
      }) : ''}

      <div class="data-quality-strip" role="status" aria-label="وضعیت داده‌های هویت">
        <div class="data-quality-label"><span class="dq-badge-dot dot-cyan"></span><span>وضعیت مخزن هویت</span></div>
        <div class="data-quality-grid">
          <span class="dq-badge"><span class="dq-badge-dot dot-purple"></span><span class="dq-dim-name">منبع</span><span class="dq-dim-val">حافظه محلی پروتوتایپ</span></span>
          <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">شناسه قابل مشاهده</span><span class="dq-dim-val">${identities.length.toLocaleString('fa-IR')} کاربر</span></span>
          <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">کنترل اقدام</span><span class="dq-dim-val">ابطال نشست نیازمند تأیید</span></span>
        </div>
        <span class="dq-action-hint"><span>پیش از ابطال، پروفایل و دامنه کاربر را بازبینی کنید</span></span>
      </div>

      ${(() => {
        const dataState = window.GMDataState ? window.GMDataState.getViewState('GM13') : { state: 'live' };
        if (dataState.state === 'failed' || dataState.state === 'error') {
          return window.GMDataState.renderErrorState({
            viewId: 'GM13',
            title: 'خطا در واکشی شناسه‌های کاربری',
            reason: 'پاسخی از سرویس دایرکتوری و احراز هویت مرکزی دریافت نشد.',
            errorCode: 'ERR_IDENTITY_PROVIDER_UNAVAILABLE'
          });
        }
        if (dataState.state === 'empty') {
          return window.GMDataState.renderEmptyState({
            title: 'هیچ کاربری ثبت نشده است',
            description: 'در حال حاضر هیچ حسابی در مخزن شناسه‌ها تعریف نگردیده است.',
            actionLabel: 'تعریف کاربر جدید',
            actionHash: '#gm-04-tenant-detail?tab=users'
          });
        }
        if (dataState.state === 'loading') {
          return window.GMDataState.renderSkeleton('cards', 4) + window.GMDataState.renderSkeleton('table', 5);
        }
        if (dataState.state === 'refreshing') {
          return window.GMDataState.renderRefreshingBanner('GM13');
        }
        if (dataState.state === 'stale') {
          return window.GMDataState.renderStaleBanner('GM13');
        }
        return '';
      })()}

      ${(window.GMDataState && ['failed', 'empty', 'error', 'loading'].includes(window.GMDataState.getViewState('GM13').state)) ? '' : `
      <!-- Quick Metrics -->
      <div class="grid-cols-4" style="margin-bottom: 1.25rem;">
        <div class="card stat-card">
          <div class="stat-header"><span>کل شناسه‌ها</span></div>
          <div class="stat-value">${identities.length}</div>
          <div class="stat-footer"><span>کاربران ثبت‌شده در مخزن پروتوتایپ</span></div>
        </div>
        <div class="card stat-card">
          <div class="stat-header"><span>نشست‌های فعال</span></div>
          <div class="stat-value" style="color: var(--state-success);">${activeSessionsCount}</div>
          <div class="stat-footer"><span class="badge badge-neutral">شمار ثبت‌شده در منبع محلی</span></div>
        </div>
        <div class="card stat-card">
          <div class="stat-header"><span>احراز هویت دومرحله‌ای (MFA)</span></div>
          <div class="stat-value">${identities.filter(i => i.mfaEnabled).length} / ${identities.length}</div>
          <div class="stat-footer"><span>فقط وضعیت ثبت‌شده؛ اعتبارسنجی زنده انجام نشده</span></div>
        </div>
        <div class="card stat-card">
          <div class="stat-header"><span>تقدم سیاست منع</span></div>
          <div class="stat-value" style="font-size: 1.1rem; color: var(--state-warning); margin-top: 0.35rem;">سخت‌گیرانه</div>
          <div class="stat-footer"><span>اولویت منع صریح بر مالک</span></div>
        </div>
      </div>

      <!-- Identities Table -->
      <div class="table-wrapper">
        <div class="table-toolbar">
          <div>
            <div style="font-weight: 600; font-size: 0.875rem; color: var(--text-primary);">فهرست شناسه‌ها و تخصیص نقش‌ها</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.15rem;">بررسی سطح دسترسی، وابستگی سازمانی و وضعیت امنیتی حساب‌ها</div>
          </div>
          <div style="display: flex; gap: 8px;">
            <input type="search" id="identity-search" class="form-control" placeholder="جستجوی نام یا موبایل..." aria-label="جستجوی نام، شماره تماس یا شناسه کاربر" style="width: 220px; padding: 0.35rem 0.75rem;" oninput="window.GMViews.GM13.filterTable(this.value)">
          </div>
        </div>
        <div class="table-responsive">
          <table class="data-table" id="identities-table" aria-label="جدول فهرست کاربران، شناسه‌ها و تخصیص نقش‌ها">
            <thead>
              <tr>
                <th>حساب و شناسه</th>
                <th>شماره همراه</th>
                <th>مجموعه / دامنه</th>
                <th>نقش پایه</th>
                <th>وضعیت MFA</th>
                <th>نشست‌ها</th>
                <th class="cell-actions">عملیات</th>
              </tr>
            </thead>
            <tbody>
              ${identities.map(u => `
                <tr data-search="${u.displayName} ${u.mobile} ${u.id} ${u.role}">
                <td>
                  <strong style="color: var(--text-primary);">${u.displayName}</strong>
                  <details class="row-disclosure identity-technical-details">
                    <summary>شناسه فنی</summary>
                    <code class="nav-code">${u.id}</code>
                  </details>
                </td>
                <td dir="ltr" style="text-align: right;"><span class="cell-mono" style="font-size: 0.75rem;">${maskMobile(u.mobile)}</span></td>
                <td>
                  <span class="badge badge-neutral">${u.tenantId && store && store.getTenant ? (store.getTenant(u.tenantId)?.name || 'دامنه مشتری') : 'پلتفرم'}</span>
                  ${u.tenantId ? `<details class="row-disclosure identity-technical-details"><summary>دامنه فنی</summary><code>${u.tenantId}</code></details>` : ''}
                </td>
                <td>
                    <span class="badge ${u.role === 'owner' ? 'badge-warning' : u.role === 'support' ? 'badge-danger' : 'badge-neutral'}">${roleLabels[u.role] || 'نقش سازمانی'}</span>
                  </td>
                  <td>
                    ${u.mfaEnabled 
                      ? '<span class="badge badge-success"><span class="badge-dot"></span> فعال</span>' 
                      : '<span class="badge badge-warning"><span class="badge-dot"></span> غیرفعال</span>'}
                  </td>
                  <td>
                    <span class="badge badge-neutral">${u.activeSessions} نشست</span>
                  </td>
                  <td class="cell-actions">
                    <div style="display: flex; gap: 0.35rem; justify-content: flex-end;">
                      <button class="btn btn-secondary btn-sm" aria-label="مشاهده جزئیات حساب کاربر ${u.displayName} (${u.id})" onclick="window.GMViews.GM13.showUserDetails('${u.id}')">
                        جزئیات
                      </button>
                      <button class="btn btn-secondary btn-sm" disabled title="تا اتصال ابطال نشست به runtime غیرفعال است" aria-label="ابطال نشست برای این حساب هنوز به runtime متصل نیست">
                        ابطال نشست · غیرفعال
                      </button>
                    </div>
                  </td>
                </tr>
              `).join('')}
              <tr id="identities-empty-row" style="display: none;">
                <td colspan="7" style="text-align: center; padding: 2rem 1rem;">
                  <div class="empty-state empty-state-compact">
                    <div class="empty-state-icon"><span class="badge-dot dot-warning"></span></div>
                    <h3>کاربری با این مشخصات یافت نشد</h3>
                    <p>نام، شماره تماس یا شناسه کاربر واردشده را بررسی فرمایید.</p>
                    <button class="btn btn-secondary btn-sm" onclick="document.getElementById('identity-search').value=''; window.GMViews.GM13.filterTable('');">پاکسازی جستجو</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      `}
    `;
  },

  filterTable(q) {
    const rows = document.querySelectorAll('#identities-table tbody tr');
    q = (q || '').trim().toLowerCase();
    let visibleCount = 0;
    rows.forEach(r => {
      if (r.id === 'identities-empty-row') return;
      const txt = (r.getAttribute('data-search') || '').toLowerCase();
      const matches = !q || txt.includes(q);
      r.style.display = matches ? '' : 'none';
      if (matches) visibleCount++;
    });
    const emptyRow = document.getElementById('identities-empty-row');
    if (emptyRow) emptyRow.style.display = visibleCount === 0 ? '' : 'none';
  },

  showUserDetails(id) {
    const store = window.GMStore || window.prototypeStore;
    const u = store && store.getIdentities ? store.getIdentities().find(x => x.id === id) : null;
    if (!u) return;

    const content = `
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <div class="surface-subtle">
          <div class="text-xs text-secondary">شناسه یکتای IAM</div>
          <div class="cell-mono text-cyan" style="font-size: 0.813rem; margin-top: 0.2rem;">${u.id}</div>
        </div>

        <div>
          <label class="form-label" style="font-size: 0.813rem; font-weight: 600; color: var(--text-primary);">اطلاعات هویتی و پرسنلی:</label>
          <div class="kv-list" style="margin-top: 0.4rem;">
            <div class="kv-item">
              <span class="kv-label">نام کامل:</span>
              <span class="kv-val">${u.displayName}</span>
            </div>
            <div class="kv-item">
              <span class="kv-label">شماره همراه:</span>
              <span class="cell-mono text-ltr text-primary">${u.mobile}</span>
            </div>
            <div class="kv-item">
              <span class="kv-label">نقش سازمانی:</span>
              <span class="text-cyan text-strong">${u.role}</span>
            </div>
            <div class="kv-item">
              <span class="kv-label">مجموعه مرجع:</span>
              <span class="text-primary">${u.tenantId || 'سیستمی'}</span>
            </div>
          </div>
        </div>

        <div class="surface-subtle surface-cyan" style="font-size: 0.75rem; color: var(--text-secondary);">
          وضعیت نشست‌ها: کاربر دارای <strong>${u.activeSessions}</strong> نشست فعال معتبر است.
        </div>

        <div style="margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.5rem;">
          <a href="#gm-14-access-roles" class="btn btn-secondary btn-block" onclick="window.GMApp ? window.GMApp.closeDrawer() : null">
            تنظیم منع یا اجازه شخصی (Override)
          </a>
          <a href="#gm-15-simulator" class="btn btn-primary btn-block" onclick="window.GMApp ? window.GMApp.closeDrawer() : null">
            آزمایش دسترسی در شبیه‌ساز
          </a>
        </div>
      </div>
    `;

    if (window.GMApp && window.GMApp.openDrawer) {
      window.GMApp.openDrawer(`پروفایل کاربر: ${u.displayName}`, content);
    }
  },

  revokeSessions(id) {
    const store = window.GMStore || window.prototypeStore;
    const u = store && store.getIdentities ? store.getIdentities().find(x => x.id === id) : null;
    if (!u) return;

    const content = `
      <div style="display: flex; flex-direction: column; gap: 0.85rem;">
        <p style="font-size: 0.813rem; color: var(--text-primary); line-height: 1.5;">
          آیا از ابطال تمام <strong>${u.activeSessions}</strong> نشست فعال کاربر <strong>${u.displayName}</strong> اطمینان دارید؟
        </p>
        <div class="alert alert-warning">
          <strong>هشدار دسترسی:</strong> توکن‌های احراز هویت بلافاصله نامعتبر شده و تمامی ارتباطات جاری کاربر در سامانه‌ها قطع خواهد شد.
        </div>
      </div>
    `;

    if (window.GMApp && window.GMApp.openModal) {
      window.GMApp.openModal('تأیید ابطال نشست‌های کاربر', content, () => {
        u.activeSessions = 0;
        const store = window.prototypeStore || window.GMStore;
        if (store) {
          const userInStore = (store.state.users || []).find(usr => usr.id === u.id);
          if (userInStore) {
            userInStore.activeSessions = 0;
          }
          store.save();
          if (typeof store.addActivity === 'function') {
            store.addActivity({
              type: 'sessions_revoked',
              severity: 'warning',
              title: `ابطال نشست‌های ${u.displayName}`,
              description: `تمامی نشست‌ها و توکن‌های فعال کاربر ${u.displayName} در سرور با موفقیت ابطال شدند.`,
              subsystem: 'Security',
              route: '#gm-13-identities',
              routeLabel: 'GM-13 هویت‌ها و نشست‌ها',
              actor: 'SuperAdmin'
            });
          }
        }
        window.GMApp.showToast(`نشست‌های فعال کاربر ${u.displayName} با موفقیت ابطال و دسترسی‌های آنلاین وی منقضی گردید.`, 'success');
        if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
          window.GMRouter.refresh();
        } else if (window.GMRouter && typeof window.GMRouter.handleRoute === 'function') {
          window.GMRouter.handleRoute();
        }
      }, {
        confirmText: 'ابطال تمام نشست‌ها',
        confirmVariant: 'danger',
        severity: 'danger',
        severityLabel: 'حذف دسترسی فعال'
      });
    }
  }
};

window.renderGM13 = function(params) {
  return window.GMViews.GM13.render(params);
};
