/**
 * prototype/js/views/gm18-domains.js
 * 
 * GM-18: دامنه‌ها، ساب‌دامین‌ها و برندینگ اختصاصی وایت‌لیبل (/domains)
 * مدیریت هاستینگ ساب‌دامین‌های salsa.ir، اتصال دامنه اختصاصی مشتریان (BYOD)،
 * صدور خودکار گواهی On-Demand TLS و شخصی‌سازی هویت بصری بدون ذکر نام پلتفرم سالسا.
 */

window.renderGM18 = function(params) {
  const store = window.prototypeStore || window.GMStore;
  const tenantId = params?.id || (store ? store.getActiveTenantId() : 'tnt_westo_demo');
  const tenant = (store && store.getTenant ? store.getTenant(tenantId) : null) || { id: tenantId, name: 'کافه وستو', slug: 'westo', domain: 'westo.salsa.ir', cellId: 'cell-teh-01' };
  const tenantSlug = tenant.slug || 'westo';
  const tenantSubdomain = `${tenantSlug}.salsa.ir`;
  const domains = store && store.getDomains ? store.getDomains(tenantId) : [];
  const customDomains = domains.filter(d => d.type === 'custom_primary' || d.isCustomDomain);
  const domainSource = domains.length ? 'سامانه دامنه‌های متمرکز SALSA VPS' : 'بدون رکورد دامنه';

  return `
    <div class="page-header gm18-page">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
          <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
          <span class="breadcrumb-separator">/</span>
          <a href="#gm-04-tenant-detail?id=${tenant.id}" class="breadcrumb-link">پرونده مشتری</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current" aria-current="page">دامنه‌ها و وایت‌لیبل</span>
        </nav>
        <h1>
          دامنه‌ها و برندینگ وایت‌لیبل: ${tenant.name}
          <span class="badge badge-scope-tenant"><span class="status-dot dot-active"></span> ساب‌دامین فعال</span>
          <span class="badge badge-cyan cell-mono">${tenantSubdomain}</span>
          <span class="page-code-badge">GM-18</span>
        </h1>
        <p>مدیریت ساب‌دامین پیش‌فرض پلتفرم، اتصال دامنه‌های اختصاصی مشتریان (BYOD) و صدور آنی گواهی امنیتی On-Demand TLS</p>
      </div>
      <div class="header-actions">
        <button class="btn btn-primary" onclick="window.openGM18AddDomainModal('${tenant.id}')">
          اتصال دامنه اختصاصی جدید (BYOD)
        </button>
        <button class="btn btn-secondary" onclick="window.openGM18WhiteLabelPreviewModal('${tenant.domain || 'westocoffee.ir'}', '${tenant.name}')">
          پیش‌نمایش زنده وایت‌لیبل 👁️
        </button>
        <a href="#gm-04-tenant-detail?id=${tenant.id}" class="btn btn-secondary">
          پرونده ۳۶۰ مشتری
        </a>
      </div>
    </div>

    <!-- Architectural Guidance Banner for salsa.ir Platform & White-label BYOD -->
    <div class="op-context-banner op-context-info" role="region" aria-label="راهنمای معماری دامنه‌های پلتفرم سالسا">
      <div class="op-context-header">
        <span>معماری شبکه و هاستینگ پلتفرم سالسا (salsa.ir) و دامنه‌های اختصاصی (White-label)</span>
        <span class="badge badge-cyan">On-Demand TLS / Caddy & Nginx VPS</span>
      </div>
      <div class="op-context-grid">
        <div class="op-context-item">
          <span class="op-context-label">دامنه مادر و ساب‌دامین‌ها:</span>
          <span class="op-context-desc">پلتفرم مرکزی بر روی <code class="cell-mono">salsa.ir</code> و مشتریان روی ساب‌دامین اختصاصی <code class="cell-mono">${tenantSubdomain}</code> میزبانی می‌شوند.</span>
        </div>
        <div class="op-context-item">
          <span class="op-context-label">اتصال دامنه اختصاصی (BYOD):</span>
          <span class="op-context-desc">مشتری با تنظیم رکورد CNAME به سمت <code class="cell-mono">${tenantSubdomain}</code> می‌تواند دامنه شخصی خود را متصل کند؛ سامانه کاملاً بدون ذکر نام سالسا (White-label) لود می‌شود.</span>
        </div>
        <div class="op-context-item">
          <span class="op-context-label">صدور خودکار گواهی SSL:</span>
          <span class="op-context-desc">با On-Demand TLS و اعتبارسنجی امنیتی Ask Endpoint، گواهی امنیتی معتبر به صورت آنی و خودکار برای هر دامنه صادر می‌شود.</span>
        </div>
      </div>
    </div>

    <!-- Telemetry & Metric Cards -->
    <div class="grid-cols-4" style="margin-bottom: 1.25rem;">
      <div class="card stat-card" style="border-right: 3px solid var(--accent-cyan);">
        <div class="stat-label">دامنه اصلی پلتفرم</div>
        <div class="stat-val cell-mono" style="font-size: 1.1rem; color: var(--accent-cyan);">salsa.ir</div>
        <div class="stat-desc">پیشخوان گادمود و کنترل‌پلن مرکزی</div>
      </div>
      <div class="card stat-card" style="border-right: 3px solid #10B981;">
        <div class="stat-label">ساب‌دامین پلتفرمی این مشتری</div>
        <div class="stat-val cell-mono" style="font-size: 1.1rem; color: #10B981;">${tenantSubdomain}</div>
        <div class="stat-desc">هاست فعال ابری (پورت ۴۱۸۰)</div>
      </div>
      <div class="card stat-card" style="border-right: 3px solid #8B5CF6;">
        <div class="stat-label">دامنه‌های اختصاصی متصل</div>
        <div class="stat-val cell-mono" style="font-size: 1.1rem; color: #8B5CF6;">${customDomains.length.toLocaleString('fa-IR')} دامنه</div>
        <div class="stat-desc">وایت‌لیبل ۱۰۰٪ مستقل</div>
      </div>
      <div class="card stat-card" style="border-right: 3px solid #F59E0B;">
        <div class="stat-label">موتور گواهی امنیتی SSL</div>
        <div class="stat-val" style="font-size: 0.95rem; color: #F59E0B; font-weight: 700;">On-Demand TLS</div>
        <div class="stat-desc">صدور درلحظه با Caddy / Let's Encrypt</div>
      </div>
    </div>

    ${window.GMDataState ? window.GMDataState.renderFreshnessBar({
      viewId: 'GM18',
      sourceLabel: 'سامانه دامنه‌های اختصاصی و گواهی SSL',
      sourceMode: 'local',
      totalCount: domains.length,
      countLabel: 'دامنه ثبت‌شده'
    }) : ''}

    <div class="data-quality-strip" role="status" aria-label="وضعیت داده‌های دامنه و برندینگ">
      <div class="data-quality-label"><span class="dq-badge-dot dot-cyan"></span><span>پایش شبکه دامنه‌ها</span></div>
      <div class="data-quality-grid">
        <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">سرور متمرکز</span><span class="dq-dim-val">VPS لینوکس Ubuntu (185.143.232.10)</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">وایلدکارت پلتفرم</span><span class="dq-dim-val">*.salsa.ir متصل و پایدار</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-purple"></span><span class="dq-dim-name">امنیت کوکی و نشست</span><span class="dq-dim-val">ایزوله در دامنه اختصاصی</span></span>
      </div>
      <span class="dq-action-hint"><span>اتصال مستقیم DNS و کش پروکسی سرور فعال است</span></span>
    </div>

    ${(() => {
      const dataState = window.GMDataState ? window.GMDataState.getViewState('GM18') : { state: 'live' };
      if (dataState.state === 'failed' || dataState.state === 'error') {
        return window.GMDataState.renderErrorState({
          viewId: 'GM18',
          title: 'خطا در بارگذاری دامنه‌های اختصاصی',
          reason: 'پاسخی از کنترل‌پنل مدیریت DNS و Edge CDN دریافت نشد.',
          errorCode: 'ERR_DNS_EDGE_UNREACHABLE'
        });
      }
      if (dataState.state === 'empty') {
        return window.GMDataState.renderEmptyState({
          title: 'هیچ دامنه‌ای یافت نشد',
          description: 'هنوز دامنه اختصاصی برای هیچ مجموعه‌ای متصل نگردیده است.',
          actionLabel: 'اتصال دامنه جدید',
          onAction: "window.openGM18AddDomainModal()"
        });
      }
      if (dataState.state === 'loading') {
        return window.GMDataState.renderSkeleton('table', 4);
      }
      if (dataState.state === 'refreshing') {
        return window.GMDataState.renderRefreshingBanner('GM18');
      }
      if (dataState.state === 'stale') {
        return window.GMDataState.renderStaleBanner('GM18');
      }
      return '';
    })()}

    ${(window.GMDataState && ['failed', 'empty', 'error', 'loading'].includes(window.GMDataState.getViewState('GM18').state)) ? '' : `
    
    <!-- SECTION 1: Subdomain Hub Card -->
    <div class="card" style="margin-bottom: 1.25rem; border: 1px solid rgba(14, 165, 233, 0.25); background: linear-gradient(180deg, rgba(14, 165, 233, 0.04) 0%, var(--bg-surface-elevated) 100%);">
      <div style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 0.75rem; margin-bottom: 0.75rem; border-bottom: 1px solid var(--border-subtle); flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <span class="badge badge-cyan" style="font-size: 0.7rem; margin-bottom: 0.3rem;">ساب‌دامین رسمی مشتری در پلتفرم سالسا</span>
          <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--text-primary); margin: 0;">
            🌐 https://${tenantSubdomain}
          </h3>
        </div>
        <div style="display: flex; gap: 0.5rem; align-items: center;">
          <span class="badge badge-success"><span class="status-dot dot-active"></span> وایلدکارت فعال و آماده بهره‌برداری</span>
          <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard?.writeText('https://${tenantSubdomain}'); window.GMApp?.showToast('آدرس ساب‌دامین در کلیپ‌بورد کپی شد: https://${tenantSubdomain}', 'success');">
            کپی آدرس ساب‌دامین
          </button>
          <button class="btn btn-primary btn-sm" onclick="window.openGM18WhiteLabelPreviewModal('${tenantSubdomain}', '${tenant.name}')">
            مشاهده سایت مشتری ↗
          </button>
        </div>
      </div>
      <p style="font-size: 0.813rem; color: var(--text-secondary); line-height: 1.6; margin: 0;">
        این ساب‌دامین به عنوان هاست ابری همیشگی و مستقل مشتری عمل می‌کند. اگر مشتری مایل به اتصال دامنه اختصاصی خودش (مانند <code class="cell-mono">order.shandiz.com</code>) باشد، کافی است یک رکورد CNAME به سمت <strong class="cell-mono" style="color: var(--accent-cyan);">${tenantSubdomain}</strong> تنظیم کند. در این صورت کاربران مشتری مستقیماً روی دامنه خودش با سامانه کار کرده و هیچ اثری از پلتفرم سالسا نمی‌بینند.
      </p>
    </div>

    <!-- SECTION 2: Domains Table -->
    <div class="table-wrapper">
      <div class="table-toolbar" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <div style="font-weight: 600; font-size: 0.875rem; color: var(--text-primary);">فهرست دامنه‌های متصل و وضعیت مسیریابی پروکسی معکوس</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.15rem;">پایش رکوردهای DNS، مقاصد CNAME و اعتبارسنجی On-Demand TLS بر روی سرور VPS</div>
        </div>
        <div>
          <button class="btn btn-outline-cyan btn-sm" onclick="window.openGM18AddDomainModal('${tenant.id}')">
            + اتصال دامنه جدید
          </button>
        </div>
      </div>
      <div class="table-responsive">
        <table class="data-table" aria-label="جدول فهرست دامنه‌های اختصاصی و وضعیت اتصال DNS">
          <thead>
            <tr>
              <th>دامنه (Host)</th>
              <th>مشتری منتسب</th>
              <th>نوع دامنه</th>
              <th>مقصد CNAME</th>
              <th>وضعیت DNS</th>
              <th>گواهی امنیتی SSL</th>
              <th>نوع میزبانی</th>
              <th class="cell-actions">اقدامات</th>
            </tr>
          </thead>
          <tbody>
            ${domains.length > 0 ? domains.map(d => {
              const isCustom = d.type === 'custom_primary' || d.isCustomDomain;
              const isSub = d.type === 'platform_subdomain' || d.isSubdomain;
              const isPlat = d.isPlatform || d.type === 'platform_hub';
              const target = d.targetCname || (isCustom ? `${tenantSlug}.salsa.ir` : 'salsa.ir');

              return `
                <tr>
                  <td>
                    <div style="display: flex; flex-direction: column;">
                      <span class="cell-mono" style="font-weight: 600; color: ${isCustom ? '#A855F7' : 'var(--accent-cyan)'}; font-size: 0.813rem;">
                        ${d.domain}
                      </span>
                      ${isCustom ? '<span style="font-size: 0.7rem; color: #A855F7;">وایت‌لیبل کامل (بدون برندینگ سالسا)</span>' : ''}
                    </div>
                  </td>
                  <td><strong style="color: var(--text-primary);">${d.tenantName}</strong></td>
                  <td>
                    ${isCustom
                      ? '<span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #C084FC; border: 1px solid rgba(168, 85, 247, 0.3);">دامنه اختصاصی (BYOD)</span>'
                      : isSub
                      ? '<span class="badge badge-cyan">ساب‌دامین پلتفرمی</span>'
                      : '<span class="badge badge-neutral">دامنه مادر پلتفرم</span>'
                    }
                  </td>
                  <td><code class="nav-code cell-mono">${target}</code></td>
                  <td>
                    ${d.dnsStatus === 'verified'
                      ? '<span class="badge badge-success"><span class="status-dot dot-active"></span> احراز شده</span>'
                      : '<span class="badge badge-warning"><span class="status-dot"></span> در انتظار DNS</span>'
                    }
                  </td>
                  <td>
                    ${d.sslStatus === 'active'
                      ? `<span class="badge badge-success">${isCustom ? 'On-Demand TLS' : 'Wildcard SSL'}</span>`
                      : '<span class="badge badge-warning">صدور خودکار...</span>'
                    }
                  </td>
                  <td>
                    <span style="font-size: 0.75rem; color: var(--text-secondary);">${d.cdnProvider || 'Caddy VPS Ingress'}</span>
                  </td>
                  <td class="cell-actions">
                    <button class="btn btn-secondary btn-sm" onclick="window.openGM18DnsGuideModal('${d.domain}', '${target}')" aria-label="راهنمای DNS دامنه ${d.domain}">
                      راهنمای DNS
                    </button>
                    ${isCustom ? `
                      <button class="btn btn-outline-cyan btn-sm" onclick="window.openGM18WhiteLabelPreviewModal('${d.domain}', '${d.tenantName}')" title="پیش‌نمایش زنده در مرورگر">
                        پیش‌نمایش
                      </button>
                    ` : ''}
                  </td>
                </tr>
              `;
            }).join('') : `
              <tr>
                <td colspan="8" style="text-align: center; padding: 2.5rem 1rem;">
                  <div class="empty-state empty-state-compact">
                    <div class="empty-state-icon"><span class="badge-dot dot-cyan"></span></div>
                    <h3>هیچ دامنه اختصاصی ثبت نشده است</h3>
                    <p>برای شروع، می‌توانید اولین دامنه اختصاصی مشتری را به ساب‌دامین ${tenantSubdomain} متصل نمایید.</p>
                    <button class="btn btn-primary btn-sm" onclick="window.openGM18AddDomainModal('${tenant.id}')">اتصال دامنه اختصاصی جدید</button>
                  </div>
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </div>

    <!-- White-label Branding & Custom Theme Preview -->
    <div class="card" style="margin-top: 1.25rem;">
      <div style="margin-bottom: 0.85rem; padding-bottom: 0.6rem; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-weight: 600; color: var(--text-primary); font-size: 0.875rem;">شخصی‌سازی هویت بصری وایت‌لیبل (White-Label Branding)</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.15rem;">هنگامی که مشتری با دامنه اختصاصی خود وارد سامانه می‌شود، این هویت بصری اعمال می‌گردد.</div>
        </div>
        <span class="badge badge-success"><span class="status-dot dot-active"></span> ایزولاسیون کوکی و تم فعال</span>
      </div>
      <div>
        <div class="grid-cols-2" style="align-items: center; gap: 1.5rem;">
          <div style="display: flex; flex-direction: column; gap: 0.75rem;">
            <div class="form-group">
              <label class="form-label" for="gm18-brand-name">نام تجاری در دامنه اختصاصی (White-label Title):</label>
              <input type="text" id="gm18-brand-name" class="form-control" value="${tenant.name}" readonly aria-label="نام نمایشی برند" />
            </div>
            <div class="form-group">
              <label class="form-label" for="gm18-accent-color">رنگ سازمانی و تم رستوران (Brand Accent):</label>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <div style="width: 28px; height: 28px; border-radius: 4px; background: #D97706; border: 1px solid var(--border-default);"></div>
                <input type="text" id="gm18-accent-color" class="form-control cell-mono" value="#D97706 (Amber Gold)" readonly style="width: 170px;" aria-label="رنگ اصلی برند" />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">حذف نام و لوگوی سالسا (Hide SALSA Branding):</label>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span class="badge badge-success">فعال ۱۰۰٪ (هیچ لوگو یا لینکی به سالسا وجود ندارد)</span>
                <span class="badge badge-neutral">کوکی‌ها محدود به دامنه مشتری</span>
              </div>
            </div>
          </div>

          <!-- Browser Mockup Window -->
          <div style="background: #0F172A; border: 1px solid #334155; border-radius: 8px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.4);">
            <div style="background: #1E293B; padding: 0.5rem 0.75rem; display: flex; align-items: center; gap: 0.5rem; border-bottom: 1px solid #334155;">
              <div style="display: flex; gap: 5px;">
                <span style="width: 10px; height: 10px; border-radius: 50%; background: #EF4444; display: inline-block;"></span>
                <span style="width: 10px; height: 10px; border-radius: 50%; background: #F59E0B; display: inline-block;"></span>
                <span style="width: 10px; height: 10px; border-radius: 50%; background: #10B981; display: inline-block;"></span>
              </div>
              <div style="background: #0F172A; border-radius: 4px; padding: 0.2rem 0.6rem; font-size: 0.7rem; color: #94A3B8; display: flex; align-items: center; gap: 0.35rem; flex: 1; direction: ltr;">
                <span style="color: #10B981;">🔒 https://</span><span style="color: #F8FAFC; font-weight: 600;">${tenant.domain && tenant.domain !== tenantSubdomain ? tenant.domain : (tenantSlug + '.ir')}</span>/order
              </div>
            </div>
            <div style="padding: 1.25rem; text-align: center;">
              <div style="background: #1E293B; border-radius: 6px; padding: 0.85rem 1rem; display: flex; justify-content: space-between; align-items: center; border: 1px solid #334155;">
                <div style="font-weight: 700; font-size: 0.95rem; color: #F59E0B; letter-spacing: 0.5px;">${tenant.name.toUpperCase()}</div>
                <div style="display: flex; gap: 0.85rem; font-size: 0.75rem; color: #94A3B8;">
                  <span>منوی آنلاین</span>
                  <span>سفارش میز</span>
                  <span>پیگیری سفارش</span>
                </div>
              </div>
              <div style="margin-top: 1rem; font-size: 0.75rem; color: #64748B;">
                ⚡ میزبانی نامرئی بر روی ساب‌دامین ${tenantSubdomain} (سرور متمرکز VPS)
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    `}
  `;
};

window.cleanGM18DomainInput = function(el) {
  if (!el) return;
  let val = el.value.trim().toLowerCase();
  val = val.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\s+/g, '');
  if (val !== el.value) {
    el.value = val;
  }
  if (val && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(val)) {
    if (window.GMApp && typeof window.GMApp.clearFieldError === 'function') {
      window.GMApp.clearFieldError(el);
    }
  }

  // Live update DNS records helper in modal
  const targetCnameEl = document.getElementById('modal-cname-val');
  const txtValEl = document.getElementById('modal-txt-val');
  if (targetCnameEl && val) {
    const isSubdomain = val.split('.').length > 2;
    const hostLabel = isSubdomain ? val.split('.')[0] : '@';
    targetCnameEl.textContent = `${hostLabel} CNAME ${targetCnameEl.getAttribute('data-target')}`;
  }
  if (txtValEl && val) {
    txtValEl.textContent = `_salsa-challenge.${val} TXT salsa-verify=${Math.random().toString(36).substring(2, 10)}`;
  }
};

window.openGM18AddDomainModal = function(preferredTenantId) {
  const store = window.prototypeStore || window.GMStore;
  const tenants = store && store.getTenants ? store.getTenants() : [];
  const activeTenantId = preferredTenantId || (store && store.getActiveTenantId ? store.getActiveTenantId() : 'tnt_westo_demo');
  const activeTenant = tenants.find(t => t.id === activeTenantId) || tenants[0] || { id: activeTenantId, name: 'کافه وستو', slug: 'westo' };
  const expectedCnameTarget = `${activeTenant.slug || 'westo'}.salsa.ir`;

  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div class="surface-subtle" style="padding: 0.75rem; border-radius: 6px; font-size: 0.813rem; line-height: 1.5; border-right: 3px solid var(--accent-cyan);">
        <strong>نحوه کارکرد دامنه اختصاصی (BYOD):</strong> مشتری دامنه اختصاصی خود را در پنل DNS ثبت می‌کند؛ سرور VPS ما با On-Demand TLS به طور خودکار گواهی SSL صادر کرده و وب‌سایت مشتری بدون هیچ ردپایی از نام «سالسا» لود می‌شود.
      </div>

      <div>
        <label class="form-label" for="modal-domain-tenant">
          مجموعه دارنده وب‌سایت:
          <span class="field-badge field-required" aria-hidden="true">الزامی</span>
        </label>
        <select id="modal-domain-tenant" class="form-control" aria-label="انتخاب مجموعه هدف" onchange="window.updateGM18ModalTarget(this.value)">
          ${tenants.map(t => `<option value="${t.id}" data-slug="${t.slug || 'tenant'}" data-name="${t.name}" ${t.id === activeTenantId ? 'selected' : ''}>${t.name} (${t.slug || t.id}.salsa.ir)</option>`).join('')}
        </select>
        <div class="form-helper-text">
          <span>ساب‌دامین هاستینگ ابری این مشتری: <code id="modal-tenant-cname-preview" class="cell-mono" style="color: var(--accent-cyan);">${expectedCnameTarget}</code></span>
        </div>
      </div>

      <div>
        <label class="form-label" for="modal-domain-name">
          نام دامنه اختصاصی مشتری:
          <span class="field-badge field-required" aria-hidden="true">الزامی</span>
        </label>
        <input type="text" id="modal-domain-name" class="form-control cell-mono" placeholder="مثال: order.shandiz.com یا westocoffee.ir" oninput="window.cleanGM18DomainInput(this)" aria-required="true" aria-label="نام دامنه اختصاصی" />
        <div class="form-helper-text">
          <span>دامنه ملی (ir.) یا بین‌المللی (com, net, ...)؛ بدون وارد کردن http یا www.</span>
        </div>
      </div>

      <!-- Live DNS Instructions Box -->
      <div style="background: var(--bg-surface-subtle); border: 1px solid var(--border-default); border-radius: 6px; padding: 0.85rem;">
        <div style="font-weight: 600; font-size: 0.813rem; color: var(--text-primary); margin-bottom: 0.5rem;">
          📋 رکوردهایی که مشتری باید در پنل DNS (کلودفلر، ابرآروان یا ایرنیک) ثبت کند:
        </div>
        <div class="cell-mono" style="font-size: 0.75rem; background: var(--bg-surface-elevated); padding: 0.6rem; border-radius: 4px; display: flex; flex-direction: column; gap: 0.4rem; direction: ltr; text-align: left;">
          <div><strong style="color: var(--accent-cyan);">۱. ساب‌دامین (مانند order):</strong> <span id="modal-cname-val" data-target="${expectedCnameTarget}">order CNAME ${expectedCnameTarget}</span></div>
          <div><strong style="color: #10B981;">۲. دامنه اصلی (Apex):</strong> @ A 185.143.232.10</div>
          <div><strong style="color: #F59E0B;">۳. احراز مالکیت:</strong> <span id="modal-txt-val">_salsa-challenge TXT salsa-verify=auto</span></div>
        </div>
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal('اتصال دامنه اختصاصی جدید (Custom Domain BYOD)', content, () => {
      const inputEl = document.getElementById('modal-domain-name');
      let domainInput = (inputEl ? inputEl.value : '').trim().toLowerCase();
      domainInput = domainInput.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\s+/g, '');
      if (inputEl) inputEl.value = domainInput;

      if (!domainInput) {
        if (window.GMApp && typeof window.GMApp.setFieldError === 'function') {
          window.GMApp.setFieldError(inputEl, 'نام دامنه اختصاصی الزامی است.');
        }
        window.GMApp.showToast('لطفاً نام دامنه را وارد کنید.', 'error');
        if (inputEl) inputEl.focus();
        return false;
      }

      const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
      if (!domainRegex.test(domainInput)) {
        if (window.GMApp && typeof window.GMApp.setFieldError === 'function') {
          window.GMApp.setFieldError(inputEl, 'فرمت دامنه معتبر نیست. مثال صحیح: order.shandiz.com یا mycafe.ir');
        }
        window.GMApp.showToast('فرمت دامنه واردشده نامعتبر است.', 'error');
        if (inputEl) inputEl.focus();
        return false;
      }

      const tenantSel = document.getElementById('modal-domain-tenant');
      const tenantId = tenantSel ? tenantSel.value : (store?.getActiveTenantId?.() || null);
      const selectedOption = tenantSel ? tenantSel.options[tenantSel.selectedIndex] : null;
      const tenantName = selectedOption ? selectedOption.getAttribute('data-name') : (store?.getTenant?.(tenantId)?.name || 'مشتری انتخاب‌شده');
      const tenantSlug = selectedOption ? selectedOption.getAttribute('data-slug') : (store?.getTenant?.(tenantId)?.slug || 'westo');
      const targetCname = `${tenantSlug}.salsa.ir`;

      if (store && store.addDomain) {
        store.addDomain({
          domain: domainInput,
          tenantId,
          tenantName,
          tenantSlug,
          type: 'custom_primary',
          targetCname,
          cdnProvider: 'Caddy On-Demand TLS (VPS)',
          sslExpires: 'تمدید خودکار ۹۰ روزه (Let\'s Encrypt)',
          whiteLabel: true
        });
      }

      window.GMApp.showToast(`دامنه اختصاصی ${domainInput} با موفقیت ثبت شد؛ به محض تنظیم رکورد CNAME به سمت ${targetCname}، گواهی SSL به صورت خودکار صادر می‌شود.`, 'success');
      if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
        window.GMRouter.refresh();
      } else if (window.GMRouter && typeof window.GMRouter.handleRoute === 'function') {
        window.GMRouter.handleRoute();
      }
      return true;
    });
  }
};

window.updateGM18ModalTarget = function(tenantId) {
  const store = window.prototypeStore || window.GMStore;
  const tenant = store?.getTenant?.(tenantId);
  const slug = tenant?.slug || 'westo';
  const target = `${slug}.salsa.ir`;
  const prevEl = document.getElementById('modal-tenant-cname-preview');
  if (prevEl) prevEl.textContent = target;
  const cnameEl = document.getElementById('modal-cname-val');
  if (cnameEl) {
    cnameEl.setAttribute('data-target', target);
    cnameEl.textContent = `order CNAME ${target}`;
  }
};

window.openGM18DnsGuideModal = function(domain, targetCname) {
  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <p class="text-primary" style="font-size: 0.813rem; line-height: 1.6;">
        برای اتصال دامنه <strong>${domain}</strong> به ساب‌دامین اختصاصی پلتفرم سالسا و فعال‌سازی وایت‌لیبل، رکوردهای زیر را در پنل مدیریت DNS خود ثبت فرمایید:
      </p>

      <div class="table-responsive">
        <table class="data-table" style="font-size: 0.75rem;">
          <thead>
            <tr>
              <th>نوع رکورد</th>
              <th>نام میزبان (Host)</th>
              <th>مقصد / مقدار (Value)</th>
              <th>TTL</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span class="badge badge-cyan">CNAME</span></td>
              <td><code class="cell-mono">order</code> یا <code class="cell-mono">@</code></td>
              <td><code class="cell-mono text-cyan" style="font-weight: 700;">${targetCname}</code></td>
              <td>300 (یا Auto)</td>
            </tr>
            <tr>
              <td><span class="badge badge-neutral">A (در صورت عدم پشتیبانی از CNAME برای دامنه اصلی)</span></td>
              <td><code class="cell-mono">@</code></td>
              <td><code class="cell-mono">185.143.232.10</code></td>
              <td>300</td>
            </tr>
            <tr>
              <td><span class="badge badge-warning">TXT (احراز مالکیت دامنه)</span></td>
              <td><code class="cell-mono">_salsa-challenge</code></td>
              <td><code class="cell-mono">salsa-verify=89104fa92b</code></td>
              <td>300</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="surface-subtle" style="font-size: 0.75rem; color: var(--text-secondary); padding: 0.75rem; border-radius: 6px; line-height: 1.5;">
        💡 <strong>نکته کلودفلر و ابرآروان:</strong> برای کارکرد بی‌نقص On-Demand TLS، توصیه می‌شود وضعیت پروکسی (ابر نارنجی / Cloud Proxy) را در ابتدا روی حالت خاموش (DNS Only) قرار دهید تا صدور گواهی مستقیم انجام شود.
      </div>

      <button class="btn btn-primary btn-sm btn-block" onclick="window.triggerGM18DnsCheck('${domain}')">
        بررسی فوری اتصال DNS و وضعیت SSL
      </button>
    </div>
  `;

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal(`راهنمای تنظیم رکوردهای DNS برای ${domain}`, content);
  }
};

window.triggerGM18DnsCheck = function(domain) {
  const store = window.prototypeStore || window.GMStore;
  if (store && store.verifyDomainDns) {
    store.verifyDomainDns(domain);
  }
  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast(`بررسی DNS دامنه ${domain} انجام شد؛ رکورد CNAME تطبیق یافت و گواهی On-Demand TLS فعال است.`, 'success');
  }
  if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
    window.GMRouter.refresh();
  }
};

window.openGM18WhiteLabelPreviewModal = function(domain, tenantName) {
  const cleanDomain = String(domain || 'order.shandiz.com').replace(/^https?:\/\//, '');
  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div style="background: #0F172A; border: 1px solid #334155; border-radius: 8px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
        <!-- Browser Bar -->
        <div style="background: #1E293B; padding: 0.6rem 0.85rem; display: flex; align-items: center; gap: 0.6rem; border-bottom: 1px solid #334155;">
          <div style="display: flex; gap: 5px;">
            <span style="width: 11px; height: 11px; border-radius: 50%; background: #EF4444; display: inline-block;"></span>
            <span style="width: 11px; height: 11px; border-radius: 50%; background: #F59E0B; display: inline-block;"></span>
            <span style="width: 11px; height: 11px; border-radius: 50%; background: #10B981; display: inline-block;"></span>
          </div>
          <div style="background: #0F172A; border-radius: 4px; padding: 0.3rem 0.75rem; font-size: 0.75rem; color: #94A3B8; display: flex; align-items: center; gap: 0.45rem; flex: 1; direction: ltr;">
            <span style="color: #10B981; font-weight: 700;">🔒 https://</span><span style="color: #F8FAFC; font-weight: 600;">${cleanDomain}</span>/menu
          </div>
        </div>

        <!-- Simulated Restaurant Website -->
        <div style="padding: 1.5rem; background: #0B1120;">
          <div style="background: #1E293B; border-radius: 8px; padding: 1rem 1.25rem; display: flex; justify-content: space-between; align-items: center; border: 1px solid #334155;">
            <div>
              <div style="font-weight: 800; font-size: 1.1rem; color: #F59E0B;">${tenantName}</div>
              <div style="font-size: 0.75rem; color: #94A3B8; margin-top: 0.2rem;">سامانه آنلاین سفارش‌گیری و منوی دیجیتال</div>
            </div>
            <div style="display: flex; gap: 1rem; font-size: 0.8rem; color: #CBD5E1;">
              <span style="color: #F59E0B; font-weight: 600;">منو</span>
              <span>درباره ما</span>
              <span>تماس</span>
              <button class="btn btn-primary btn-sm" style="background: #D97706; border-color: #D97706;">سبد خرید (۰)</button>
            </div>
          </div>

          <div style="margin-top: 1.25rem; display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem;">
            <div style="background: #1E293B; border: 1px solid #334155; border-radius: 6px; padding: 0.85rem; text-align: center;">
              <div style="font-size: 1.5rem; margin-bottom: 0.3rem;">☕</div>
              <div style="font-weight: 600; color: #F8FAFC; font-size: 0.85rem;">اسپرسو دوبل</div>
              <div style="color: #F59E0B; font-size: 0.75rem; margin-top: 0.25rem;">۶۵,۰۰۰ تومان</div>
            </div>
            <div style="background: #1E293B; border: 1px solid #334155; border-radius: 6px; padding: 0.85rem; text-align: center;">
              <div style="font-size: 1.5rem; margin-bottom: 0.3rem;">🥐</div>
              <div style="font-weight: 600; color: #F8FAFC; font-size: 0.85rem;">کروسان فرانسوی</div>
              <div style="color: #F59E0B; font-size: 0.75rem; margin-top: 0.25rem;">۸۵,۰۰۰ تومان</div>
            </div>
            <div style="background: #1E293B; border: 1px solid #334155; border-radius: 6px; padding: 0.85rem; text-align: center;">
              <div style="font-size: 1.5rem; margin-bottom: 0.3rem;">🥗</div>
              <div style="font-weight: 600; color: #F8FAFC; font-size: 0.85rem;">سالاد سزار ویژه</div>
              <div style="color: #F59E0B; font-size: 0.75rem; margin-top: 0.25rem;">۱۹۰,۰۰۰ تومان</div>
            </div>
          </div>

          <div style="margin-top: 1.25rem; padding-top: 0.85rem; border-top: 1px solid #1E293B; text-align: center; font-size: 0.75rem; color: #64748B;">
            تمامی حقوق متعلق به ${tenantName} است · قدرت‌گرفته از هاست ابری اختصاصی (بدون هیچ نشانی از SALSA)
          </div>
        </div>
      </div>

      <div class="surface-subtle" style="font-size: 0.8rem; line-height: 1.5; padding: 0.75rem; border-radius: 6px; border-right: 3px solid #10B981;">
        ✅ <strong>ضمانت وایت‌لیبل ۱۰۰٪:</strong> هدرهای Server، کوکی‌های نشست کاربر و متاتگ‌های OpenGraph همگی به دامنه اختصاصی کاربر محدود بوده و هیچ ارجاعی به ساب‌دامین‌های سالسا یا شرکت وجود ندارد.
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal(`پیش‌نمایش زنده وایت‌لیبل در مرورگر (${cleanDomain})`, content);
  }
};
