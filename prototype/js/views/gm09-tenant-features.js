/**
 * prototype/js/views/gm09-tenant-features.js
 * 
 * GM-09: امکانات یک مشتری (/tenants/:tenantId/features)
 * Flow 2: فروش افزونه با وابستگی/قیمت/تاریخ در شبیه‌سازی
 */

window.GMViews = window.GMViews || {};

window.renderGM09 = function(params) {
  const store = window.prototypeStore || window.GMStore;
  const tenantId = params?.id || (store ? store.getActiveTenantId() : 'tnt_westo_demo');
  const tenant = (store && typeof store.getTenant === 'function')
    ? store.getTenant(tenantId)
    : null;
  if (!tenant) {
    return `
      <div class="empty-state" role="alert">
        <h2>مشتری در رجیستری Mock یافت نشد</h2>
        <p>شناسهٔ ${tenantId || 'نامشخص'} معتبر نیست؛ هیچ مشتری دیگری به‌عنوان جایگزین نمایش داده نمی‌شود.</p>
        <a class="btn btn-secondary" href="#gm-03-tenants">بازگشت به فهرست مشتریان</a>
      </div>
    `;
  }
  const allFeatures = (store && typeof store.getFeatures === 'function')
    ? store.getFeatures()
    : [];
  const grants = (store && typeof store.getTenantGrants === 'function')
    ? store.getTenantGrants(tenant.id)
    : {};
  const featureNameByKey = Object.fromEntries(allFeatures.map(feature => [feature.key, feature.nameFa]));
  const cellLabel = {
    'cell-teh-01': 'سرور اصلی VPS',
    'cell-teh-02': 'استیجینگ VPS',
    'cell-msh-01': 'بکاپ آف‌سایت'
  }[tenant.cellId] || 'سرور متمرکز VPS';

  return `
    <div class="page-header">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
          <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
          <span class="breadcrumb-separator">/</span>
          <a href="#gm-04-tenant-detail?id=${tenant.id}" class="breadcrumb-link">پرونده مشتری</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current" aria-current="page">امکانات و افزونه‌ها</span>
        </nav>
        <h1>
          سرویس‌های فعال مشتری: ${tenant.name}
          <span class="badge scope-cell-badge">${cellLabel}</span>
          <span class="badge badge-scope-tenant"><span class="status-dot dot-active"></span> دامنه مشتری</span>
          <span class="page-code-badge">GM-09</span>
        </h1>
        <p>رصد وضعیت مؤثر امکانات، تخصیص حقوق استفاده و فعال‌سازی افزونه‌های سازمانی</p>
      </div>
      <div class="header-actions">
        ${tenant.id === 'tnt_westo_demo' ? `
          <a href="${(typeof GMPageContracts !== 'undefined' && GMPageContracts.westoClientOrigin) ? GMPageContracts.westoClientOrigin.page('/admin.html') : 'http://localhost:4180/admin.html'}" target="_blank" rel="noopener" class="btn btn-outline-cyan">
            ورود به پنل وستو (۴۱۸۰) ↗
          </a>
        ` : ''}
        <button class="btn btn-primary" id="btnOpenSellAddonModal" onclick="openSellAddonDrawer('${tenant.id}')">
          فعال‌سازی افزونه جدید
        </button>
        <a href="#gm-04-tenant-detail?id=${tenant.id}&tab=features" class="btn btn-secondary">
          پرونده ۳۶۰ مشتری
        </a>
      </div>
    </div>

    ${window.GMDataState ? window.GMDataState.renderFreshnessBar({
      viewId: 'GM09',
      sourceLabel: `حقوق دسترسی ${tenant.name}`,
      sourceMode: 'local',
      totalCount: allFeatures.length,
      countLabel: 'قابلیت کاتالوگ'
    }) : ''}

    <!-- Tenant Context Banner -->
    <div class="card" style="margin-bottom: 1.25rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.85rem;">
        <div>
          <div style="font-weight: 600; color: var(--text-primary); font-size: 0.875rem;">${tenant.name} <span class="badge scope-cell-badge" style="margin-right: 6px;">${cellLabel}</span></div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.15rem;">پلن اصلی قرارداد: <strong>${tenant.plan}</strong></div>
          <details class="row-disclosure tenant-technical-details">
            <summary>جزئیات فنی دامنه</summary>
            <span class="cell-mono">شناسه مشتری: ${tenant.id} · سرور میزبان: ${tenant.cellId || 'cell-teh-01'}</span>
          </details>
        </div>
        <div>
          <span class="badge badge-success"><span class="badge-dot dot-green"></span> ${Object.keys(grants).length} ماژول فعال (همگام با ۴۱۸۰)</span>
        </div>
      </div>
    </div>

    <div class="data-quality-strip" role="status" aria-label="وضعیت منبع حقوق استفاده مشتری">
      <div class="data-quality-label"><span class="dq-badge-dot dot-cyan"></span><span>وضعیت حقوق استفاده</span></div>
      <div class="data-quality-grid">
        <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">منبع</span><span class="dq-dim-val">سامانه مدیریت قابلیت‌های عملیاتی NEEM</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">دامنه</span><span class="dq-dim-val">${tenant.name}</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">مجوزهای فعال</span><span class="dq-dim-val">${Object.keys(grants).length.toLocaleString('fa-IR')} مورد</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">اعتبار</span><span class="dq-dim-val">عملیاتی و برخط</span></span>
      </div>
      <span class="dq-action-hint"><span>تغییر وضعیت امکانات بلافاصله در کلاینت‌های متصل از جمله وستو ۴۱۸۰ اعمال می‌شود.</span></span>
    </div>

    ${(() => {
      const dataState = window.GMDataState ? window.GMDataState.getViewState('GM09') : { state: 'live' };
      if (dataState.state === 'failed' || dataState.state === 'error') {
        return window.GMDataState.renderErrorState({
          viewId: 'GM09',
          title: 'خطا در بارگذاری امکانات مشتری',
          reason: 'پاسخی از رجیستری دسترسی‌های مشتری دریافت نشد.',
          errorCode: 'ERR_FEATURE_GRANTS_TIMEOUT'
        });
      }
      if (dataState.state === 'empty') {
        return window.GMDataState.renderEmptyState({
          title: 'هیچ مجوزی برای این مشتری تعریف نشده است',
          description: 'هیچ مجوزی در پرونده این مشتری فعال نشده است.',
          actionLabel: 'فعال‌سازی افزونه جدید',
          onAction: `openSellAddonDrawer('${tenant.id}')`
        });
      }
      if (dataState.state === 'loading') {
        return window.GMDataState.renderSkeleton('table', 5);
      }
      if (dataState.state === 'refreshing') {
        return window.GMDataState.renderRefreshingBanner('GM09');
      }
      if (dataState.state === 'stale') {
        return window.GMDataState.renderStaleBanner('GM09');
      }
      return '';
    })()}

    ${(window.GMDataState && ['failed', 'empty', 'error', 'loading'].includes(window.GMDataState.getViewState('GM09').state)) ? '' : `
    <!-- Features Management Table -->
    <div class="table-wrapper">
      <div class="table-responsive">
        <table class="data-table" id="tenantFeaturesTable" aria-label="جدول مدیریت امکانات و قابلیت‌های مشتری">
          <thead>
            <tr>
              <th>قابلیت</th>
              <th>منبع دسترسی</th>
              <th>وضعیت</th>
              <th>نتیجه مؤثر</th>
              <th>مدت اعتبار</th>
              <th>وابستگی‌ها</th>
              <th class="cell-actions">اقدامات</th>
            </tr>
          </thead>
          <tbody>
            ${allFeatures.map(f => {
              const grant = grants[f.key];
              const isGranted = !!grant;
              const isGloballyDisabled = Boolean(f.globallyDisabled);
              return `
                <tr id="row-feature-${f.key}" class="${isGloballyDisabled ? 'row-globally-disabled' : ''}">
                  <td>
                    <div class="cell-primary" style="font-weight: 500;">
                      ${f.nameFa}
                      ${isGloballyDisabled ? '<span class="badge badge-danger" style="margin-right: 0.35rem; font-size: 0.65rem;">تعلیق سراسری</span>' : ''}
                    </div>
                    <details class="row-disclosure feature-row-disclosure">
                      <summary>جزئیات فنی</summary>
                      <span class="cell-mono">کلید: ${f.key}</span>
                    </details>
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
                    ${isGloballyDisabled ? `
                      <span class="badge badge-danger" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 0.72rem;" title="${f.maintenanceReason || 'به‌روزرسانی زیرساخت پلتفرم'}">
                        <span class="status-dot dot-red pulse"></span> تعلیق سراسری (نگهداری)
                      </span>
                    ` : (isGranted 
                      ? '<span style="color: var(--state-success); font-weight: 600; font-size: 0.75rem;">فعال</span>'
                      : '<span style="color: var(--text-tertiary); font-size: 0.75rem;">غیرفعال</span>'
                    )}
                  </td>
                  <td>
                    ${isGloballyDisabled ? `
                      <span class="badge badge-danger" style="font-size: 0.7rem;" title="${f.maintenanceReason || 'به‌روزرسانی پلتفرم'}">مسدود سراسری (به‌روزرسانی)</span>
                    ` : (isGranted
                      ? '<span class="badge badge-success"><span class="badge-dot"></span> فعال</span>'
                      : '<span style="font-size: 0.75rem; color: var(--text-secondary);">نیازمند فعال‌سازی</span>'
                    )}
                  </td>
                  <td class="cell-mono" style="font-size: 0.75rem;">
                    ${isGranted && grant.expiresAt ? grant.expiresAt : isGranted ? 'پایدار در اشتراک' : '—'}
                  </td>
                  <td>
                    ${f.dependencies.length === 0 
                      ? '<span style="color: var(--text-tertiary); font-size: 0.75rem;">مستقل</span>' 
                      : `<span class="badge badge-warning" style="margin-left: 0.2rem; font-size: 0.68rem;">${f.dependencies.map(d => featureNameByKey[d] || d).join('، ')}</span>
                        <details class="row-disclosure feature-row-disclosure">
                          <summary>کلیدهای فنی</summary>
                          <span class="cell-mono">${f.dependencies.join('، ')}</span>
                        </details>`
                    }
                  </td>
                  <td class="cell-actions">
                    <button type="button" 
                            class="toggle-switch-btn ${isGranted && !isGloballyDisabled ? 'on' : ''}" 
                            role="switch" 
                            aria-checked="${isGranted && !isGloballyDisabled ? 'true' : 'false'}"
                            aria-label="تغییر وضعیت ${f.nameFa}"
                            ${isGloballyDisabled ? 'disabled title="این ماژول در سطح کلان پلتفرم جهت تعمیرات متوقف است" style="margin-left: 0.5rem; vertical-align: middle; opacity: 0.4; cursor: not-allowed;"' : `onclick="toggleTenantFeature('${tenant.id}', '${f.key}')" style="margin-left: 0.5rem; vertical-align: middle;"`}>
                      <span class="toggle-switch-knob"></span>
                    </button>
                    ${isGloballyDisabled ? `
                      <button class="btn btn-sm btn-outline-danger" disabled style="opacity: 0.7; cursor: not-allowed; font-size: 0.72rem;" title="${f.maintenanceReason || 'ماژول در حال به‌روزرسانی سراسری است'}">در حال تعمیر</button>
                    ` : (isGranted 
                      ? `<button class="btn btn-sm btn-secondary" aria-label="تنظیمات قابلیت ${f.nameFa} (${f.key}) برای مشتری ${tenant.name}" onclick="window.GMApp ? window.GMApp.openDrawer('تنظیمات قابلیت ${f.nameFa}', '<div style=\\'color: var(--text-secondary); font-size: 0.813rem;\\'>این قابلیت در حساب کاربری فعال است و دسترسی API آن برقرار می‌باشد.</div>') : alert('فعال است')">تنظیمات</button>`
                      : `<button class="btn btn-sm btn-primary" aria-label="افزودن قابلیت ${f.nameFa} (${f.key}) به حساب مشتری ${tenant.name}" onclick="quickSellFeature('${tenant.id}', '${f.key}')">افزودن</button>`
                    )}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
    `}
  `;
};

// Flow 2: Interactive Sell Addon Drawer
window.openSellAddonDrawer = function(tenantId) {
  const store = window.prototypeStore || window.GMStore;
  const tenant = store && store.getTenant ? store.getTenant(tenantId) : { id: tenantId, name: 'مشتری' };
  const features = store && store.getFeatures ? store.getFeatures() : [];
  const grants = store && store.getTenantGrants ? store.getTenantGrants(tenantId) : {};
  const ungrantedFeatures = features.filter(f => !grants[f.key]);

  const defaultAddon = ungrantedFeatures.find(f => f.key === 'crm.loyalty') || ungrantedFeatures[0] || { key: 'crm.loyalty', nameFa: 'باشگاه مشتریان و وفاداری' };

  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div style="background: rgba(6, 182, 212, 0.05); border: 1px solid rgba(6, 182, 212, 0.2); border-radius: 6px; padding: 0.75rem;">
        <div style="font-weight: 600; color: #38bdf8; font-size: 0.813rem;">فعال‌سازی و تخصیص افزونه جدید:</div>
        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.2rem; line-height: 1.45;">
          تخصیص ماژول پس از بررسی پیش‌نیازها مستقیماً در پایگاه داده مشتری فعال می‌گردد.
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="addonSelect">انتخاب افزونه تجاری برای فروش *</label>
        <select id="addonSelect" class="form-control" aria-label="انتخاب افزونه تجاری برای فروش" onchange="updateAddonDrawerCalculations(this.value)">
          ${ungrantedFeatures.map(f => `
            <option value="${f.key}" ${f.key === defaultAddon.key ? 'selected' : ''}>${f.nameFa} (${f.key})</option>
          `).join('')}
        </select>
      </div>

      <!-- Dependency check box -->
      <div id="addonDependencyBox" class="surface-subtle">
        <!-- Dynamically rendered -->
      </div>

      <!-- Pricing & Duration -->
      <div class="form-group">
        <label class="form-label" for="addonDuration">مدت اعتبار افزونه</label>
        <select id="addonDuration" class="form-control" aria-label="مدت اعتبار افزونه" onchange="updateAddonDrawerCalculations(document.getElementById('addonSelect').value)">
          <option value="1">۱ ماهه آزمایشی</option>
          <option value="3">۳ ماهه فصلی</option>
          <option value="6">۶ ماهه</option>
          <option value="12" selected>۱۲ ماهه سالانه (تخفیف ویژه)</option>
        </select>
      </div>

      <!-- Invoice Calculation Summary -->
      <div id="addonPricingBox" class="surface-subtle">
        <!-- Dynamically rendered -->
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.5rem;">
        <button class="btn btn-secondary" onclick="window.GMApp ? window.GMApp.closeDrawer() : (typeof closeDrawer === 'function' ? closeDrawer() : null)">انصراف</button>
        <button class="btn btn-primary" id="btnConfirmSellAddon" onclick="confirmAddonSale('${tenantId}')">
          تأیید و فعال‌سازی افزونه
        </button>
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openDrawer) {
    window.GMApp.openDrawer(`فروش افزونه به ${tenant.name}`, content);
  } else if (typeof openDrawer === 'function') {
    openDrawer(`فروش افزونه به ${tenant.name}`, content);
  }

  // Populate dynamic calculations
  updateAddonDrawerCalculations(defaultAddon.key);
};

window.updateAddonDrawerCalculations = function(featureKey) {
  const store = window.prototypeStore || window.GMStore;
  if (!store || !store.state) return;

  const feature = store.state.features.find(f => f.key === featureKey);
  if (!feature) return;

  const durationSelect = document.getElementById('addonDuration');
  const months = durationSelect ? parseInt(durationSelect.value, 10) : 12;
  const total = (feature.pricePerMonth || 0) * months;

  // Render Dependency Box
  const depBox = document.getElementById('addonDependencyBox');
  if (depBox) {
    if (feature.dependencies && feature.dependencies.length > 0) {
      depBox.innerHTML = `
        <div style="font-weight: 600; color: var(--text-primary); font-size: 0.813rem; margin-bottom: 0.25rem;">بررسی وابستگی‌های فنی:</div>
        <div style="font-size: 0.75rem; color: var(--text-secondary);">
          این افزونه نیازمند فعال‌بودن پیش‌نیاز <span class="badge badge-warning cell-mono">${feature.dependencies.join(', ')}</span> است.
        </div>
        <div style="margin-top: 0.35rem; display: flex; align-items: center; gap: 0.35rem; color: var(--state-success); font-size: 0.75rem;">
          <span>!</span> پیش‌نیاز در Fixture فهرست شده؛ احراز آن روی Control Plane انجام نشده است.
        </div>
      `;
    } else {
      depBox.innerHTML = `
        <div style="font-size: 0.75rem; color: var(--text-secondary);">این قابلیت در Fixture وابستگی ثبت‌شده ندارد؛ کاتالوگ عملیاتی خوانده نشده است.</div>
      `;
    }
  }

  // Render Pricing Box
  const priceBox = document.getElementById('addonPricingBox');
  if (priceBox) {
    priceBox.innerHTML = `
      <div class="text-strong text-primary text-sm" style="margin-bottom: 0.35rem;">محاسبه صورت‌حساب:</div>
      <div class="kv-list">
        <div class="kv-item text-xs">
          <span class="kv-label">تعرفه ماهانه:</span>
          <span class="cell-mono text-primary">${(feature.pricePerMonth || 0).toLocaleString('fa-IR')} تومان</span>
        </div>
        <div class="kv-item text-xs">
          <span class="kv-label">مدت زمان:</span>
          <span class="text-primary">${months} ماه</span>
        </div>
        <div class="kv-item text-primary text-strong" style="font-size: 0.875rem; border-top: 1px solid var(--border-subtle); padding-top: 0.4rem; margin-top: 0.25rem;">
          <span>مبلغ کل پیش‌فاکتور:</span>
          <span class="cell-mono text-cyan">${total.toLocaleString('fa-IR')} تومان</span>
        </div>
      </div>
    `;
  }
};

window.confirmAddonSale = function(tenantId) {
  const sel = document.getElementById('addonSelect');
  const durEl = document.getElementById('addonDuration');
  const featureKey = sel ? sel.value : 'crm.loyalty';
  const months = durEl ? Number(durEl.value) : 12;

  const store = window.prototypeStore || window.GMStore;
  const res = store && store.grantAddon ? store.grantAddon(tenantId, featureKey, months) : null;
  
  if (window.GMApp && window.GMApp.closeDrawer) {
    window.GMApp.closeDrawer();
  } else if (typeof closeDrawer === 'function') {
    closeDrawer();
  }

  const msg = res ? `افزونه «${res.feature.nameFa}» برای مدت ${months} ماه با موفقیت برای مشتری فعال شد.` : 'تغییرات افزونه با موفقیت اعمال گردید.';
  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast(msg, 'success');
  } else if (typeof showToast === 'function') {
    showToast(msg, 'success');
  }

  // Re-render table dynamically
  window.location.hash = `#gm-09-tenant-features?id=${tenantId}&t=${Date.now()}`;
};

window.toggleTenantFeature = function(tenantId, featureKey) {
  const store = window.prototypeStore || window.GMStore;
  if (!store) return;
  if (store.isFeatureGloballyDisabled && store.isFeatureGloballyDisabled(featureKey)) {
    if (window.GMApp && typeof window.GMApp.showToast === 'function') {
      window.GMApp.showToast('این قابلیت به دلیل به‌روزرسانی زیرساخت در سطح کل پلتفرم موقتاً مسدود است و امکان تغییر وضعیت در سطح مشتری را ندارد.', 'warning');
    }
    return;
  }
  const isCurrentlyActive = store.isFeatureEnabled(tenantId, featureKey);
  const nextState = !isCurrentlyActive;
  store.toggleFeature(tenantId, featureKey, nextState);
  const tenantSlug = tenantId === 'tnt_westo_demo' ? 'westo' : (tenantId.startsWith('tnt_') ? tenantId.replace(/^tnt_/, '') : tenantId);
  if (window.GMApp && typeof window.GMApp.syncFeatureToggleToLiveServer === 'function') {
    window.GMApp.syncFeatureToggleToLiveServer(featureKey, nextState, tenantSlug);
  }
  const feature = (store.getFeatures ? store.getFeatures() : []).find(f => f.key === featureKey);
  const label = nextState ? 'روشن (فعال)' : 'خاموش (غیرفعال)';
  if (window.GMApp && typeof window.GMApp.showToast === 'function') {
    window.GMApp.showToast(`قابلیت «${feature?.nameFa || featureKey}» اکنون ${label} است.`, nextState ? 'success' : 'info');
  }
  window.location.hash = `#gm-09-tenant-features?id=${tenantId}&t=${Date.now()}`;
};

window.quickSellFeature = function(tenantId, featureKey) {
  const store = window.prototypeStore || window.GMStore;
  const res = store && store.grantAddon ? store.grantAddon(tenantId, featureKey, 12) : null;
  const msg = res ? `افزونه «${res.feature.nameFa}» با موفقیت برای مشتری فعال گردید.` : 'تغییرات افزونه اعمال شد.';
  
  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast(msg, 'success');
  } else if (typeof showToast === 'function') {
    showToast(msg, 'success');
  }

  window.location.hash = `#gm-09-tenant-features?id=${tenantId}&t=${Date.now()}`;
};

window.GMViews.GM09 = {
  render(params) {
    return window.renderGM09(params);
  }
};
