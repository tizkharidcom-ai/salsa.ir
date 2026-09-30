/**
 * prototype/js/views/gm09-tenant-features.js
 * 
 * GM-09: امکانات یک مشتری (/tenants/:tenantId/features)
 * مجوزها و وضعیت مؤثر مستأجر از کنترل‌پلن خوانده می‌شوند.
 */

window.GMViews = window.GMViews || {};

const gm09PendingMutations = new Set();
const gm09Snapshots = new Map();
const gm09LoadStates = new Map();
const gm09MutationStates = new Map();
let gm09DrawerTenantId = '';

function gm09Escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function gm09ControlPlaneClient() {
  const client = window.ControlPlaneClient;
  if (!client || typeof client.get !== 'function' || typeof client.post !== 'function') {
    throw new Error('اتصال کنترل‌پلن در دسترس نیست؛ دادهٔ محلی جایگزین نمی‌شود.');
  }
  return client;
}

function gm09ResponseData(response, label) {
  if (!response || response.ok !== true || response.data === undefined) {
    throw new Error(`پاسخ معتبر کنترل‌پلن برای ${label} دریافت نشد.`);
  }
  return response.data;
}

function gm09LoadTenantSnapshot(tenantId, { force = false } = {}) {
  if (!tenantId) return Promise.reject(new Error('شناسهٔ مستأجر الزامی است.'));
  const currentState = gm09LoadStates.get(tenantId);
  if (currentState?.promise) return currentState.promise;
  if (!force && gm09Snapshots.has(tenantId)) return Promise.resolve(gm09Snapshots.get(tenantId));
  gm09LoadStates.set(tenantId, { status: 'loading', error: null, promise: null });

  const request = (async () => {
    try {
      const client = gm09ControlPlaneClient();
      const encodedId = encodeURIComponent(tenantId);
      const [tenantResponse, catalogResponse, effectiveResponse, grantsResponse] = await Promise.all([
        client.get(`/api/control/tenants/${encodedId}`),
        client.get('/api/control/policy/catalog'),
        client.get(`/api/control/policy/effective/${encodedId}`),
        client.get(`/api/control/policy/grants/${encodedId}`)
      ]);
      const tenant = gm09ResponseData(tenantResponse, 'پروندهٔ مستأجر');
      const catalog = gm09ResponseData(catalogResponse, 'کاتالوگ قابلیت‌ها');
      const effective = gm09ResponseData(effectiveResponse, 'مجوزهای مؤثر');
      const grants = gm09ResponseData(grantsResponse, 'مجوزهای ثبت‌شده');
      const returnedTenantId = tenant.tenantId || tenant.id;
      if (returnedTenantId !== tenantId || effective.tenantId !== tenantId || !Array.isArray(grants) ||
          !Array.isArray(catalog.features) || !effective.features || typeof effective.features !== 'object') {
        throw new Error('دامنه یا ساختار پاسخ با مستأجر درخواستی هم‌خوان نیست؛ داده نمایش داده نشد.');
      }
      if (grants.some(grant => (grant.tenantId || grant.tenant_id) && (grant.tenantId || grant.tenant_id) !== tenantId)) {
        throw new Error('پاسخ مجوزها شامل شناسهٔ مستأجر دیگری است؛ داده رد شد.');
      }
      const missingEffective = catalog.features.filter(feature => !Object.prototype.hasOwnProperty.call(effective.features, feature.key));
      if (missingEffective.length > 0) throw new Error('ارزیابی مؤثر سرور برای بخشی از کاتالوگ ناقص است؛ وضعیت حدس زده نمی‌شود.');

      const snapshot = {
        tenant,
        catalog,
        effective,
        grants,
        observedAt: effectiveResponse.meta?.observedAt || null
      };
      gm09Snapshots.set(tenantId, snapshot);
      gm09LoadStates.set(tenantId, { status: catalog.features.length ? 'ready' : 'empty', error: null, promise: null });
      return snapshot;
    } catch (error) {
      gm09LoadStates.set(tenantId, { status: 'error', error: error?.message || 'دریافت داده از سرور ناموفق بود.', promise: null });
      throw error;
    } finally {
      if (window.GMRouter?.refresh) window.GMRouter.refresh();
    }
  })();
  gm09LoadStates.set(tenantId, { status: 'loading', error: null, promise: request });
  return request;
}

function gm09GrantIsActive(grant) {
  if (typeof grant?.isActive === 'boolean') return grant.isActive;
  const status = String(grant?.status || '').toLowerCase();
  if (status !== 'active') return false;
  return !grant.expiresAt || new Date(grant.expiresAt).getTime() > Date.now();
}

function gm09ActiveGrants(snapshot) {
  return Object.fromEntries(snapshot.grants
    .filter(gm09GrantIsActive)
    .map(grant => [grant.featureKey || grant.feature_key, grant]));
}

async function gm09PersistFeatureState(tenantId, featureKey, enabled, durationMonths = 12) {
  const client = gm09ControlPlaneClient();
  const response = enabled
    ? await client.post('/api/control/policy/grants', {
        tenantId,
        featureKey,
        grantKind: 'addon',
        durationMonths: Number(durationMonths),
        metadata: { source: 'GM09' }
      })
    : await client.post('/api/control/policy/toggle', {
        tenantId,
        featureKey,
        enabled: false,
        reason: 'غیرفعال‌سازی دسترسی از پنل مدیریت'
      });
  const result = gm09ResponseData(response, 'ثبت تغییر دسترسی');
  if (enabled) {
    const resultTenant = result.tenantId || result.tenant_id;
    const resultFeature = result.featureKey || result.feature_key;
    if ((resultTenant && resultTenant !== tenantId) || (resultFeature && resultFeature !== featureKey)) {
      throw new Error('پاسخ ثبت مجوز به مستأجر یا قابلیت دیگری مربوط است.');
    }
  } else if (result.tenantId !== tenantId || result.enabled !== false ||
      !result.results?.some(item => item.featureKey === featureKey && item.policyApplied === true)) {
    throw new Error('کنترل‌پلن غیرفعال‌سازی این قابلیت برای همین مستأجر را تأیید نکرد.');
  }
  return result;
}

function gm09Toast(message, kind = 'info') {
  if (window.GMApp && typeof window.GMApp.showToast === 'function') {
    window.GMApp.showToast(message, kind);
  } else if (typeof window.showToast === 'function') {
    window.showToast(message, kind);
  }
}

function gm09MutationKey(tenantId, featureKey) {
  return `${tenantId}:${featureKey}`;
}

async function gm09MutateFeature({ tenantId, featureKey, enabled, durationMonths = 12 }) {
  const mutationKey = gm09MutationKey(tenantId, featureKey);
  if (gm09PendingMutations.has(mutationKey)) return false;
  gm09PendingMutations.add(mutationKey);
  try {
    let mutationResult;
    try {
      mutationResult = await gm09PersistFeatureState(tenantId, featureKey, enabled, durationMonths);
    } catch (error) {
      if (error?.status === 502) {
        try {
          const snapshot = await gm09LoadTenantSnapshot(tenantId, { force: true });
          const effectiveState = snapshot.effective.features[featureKey]?.enabled === true;
          const grantPersisted = Boolean(gm09ActiveGrants(snapshot)[featureKey]);
          if ((enabled && grantPersisted) || (!enabled && !effectiveState)) {
            const message = 'سیاست در کنترل‌پلن ذخیره شده، اما همگام‌سازی سرویس مستأجر ناموفق است.';
            gm09MutationStates.set(tenantId, { status: 'sync_pending', message, featureKey });
            gm09Toast(message, 'warning');
            return { status: 'sync_pending', snapshot };
          }
        } catch (_) {}
      }
      const message = `ثبت یا تأیید تغییر از سرور ناموفق بود: ${error?.message || 'خطای نامشخص'}`;
      gm09MutationStates.set(tenantId, { status: 'error', message, featureKey });
      gm09Toast(message, 'error');
      return { status: 'error', error };
    }

    let snapshot;
    try {
      snapshot = await gm09LoadTenantSnapshot(tenantId, { force: true });
    } catch (error) {
      const message = `تغییر از سرور پذیرفته شد، اما بازخوانی وضعیت ذخیره‌شده ممکن نشد: ${error.message}`;
      gm09MutationStates.set(tenantId, { status: 'pending_readback', message, featureKey });
      gm09Toast(message, 'warning');
      return { status: 'pending_readback', mutationResult };
    }
    const effectiveState = snapshot.effective.features[featureKey]?.enabled === true;
    const grantPersisted = Boolean(gm09ActiveGrants(snapshot)[featureKey]);
    const confirmed = enabled ? grantPersisted : !effectiveState;
    const status = confirmed ? 'saved' : 'pending_readback';
    const message = confirmed
      ? 'تغییر در کنترل‌پلن ذخیره و با بازخوانی سرور تأیید شد؛ وضعیت انتشار به سرویس مشتری جداگانه قابل مشاهده نیست.'
      : 'درخواست به سرور رسید، اما بازخوانی مجوز مؤثر با درخواست منطبق نیست؛ وضعیت تأییدنشده است.';
    gm09MutationStates.set(tenantId, { status, message, featureKey });
    if (!confirmed) gm09Toast(message, 'warning');
    return { status, snapshot, mutationResult };
  } finally {
    gm09PendingMutations.delete(mutationKey);
  }
}

window.renderGM09 = function(params) {
  const tenantId = String(params?.id || params?.tenantId || '').trim();
  if (!tenantId) return `
    <div class="empty-state" role="status">
      <h2>مستأجر انتخاب نشده است</h2>
      <p>برای مشاهدهٔ مجوزها، یک شناسهٔ مستأجر را از پروندهٔ همان مشتری انتخاب کنید.</p>
      <a class="btn btn-secondary" href="#gm-03-tenants">رفتن به فهرست مشتریان</a>
    </div>`;
  if (!/^[a-z][a-z0-9_-]{1,62}$/.test(tenantId)) return `
    <div class="empty-state" role="alert"><h2>شناسهٔ مستأجر نامعتبر است</h2><p>درخواستی به سرور ارسال نشد.</p></div>`;

  const loadState = gm09LoadStates.get(tenantId);
  const snapshot = gm09Snapshots.get(tenantId);
  if (!snapshot || loadState?.status === 'error') {
    if (loadState?.status === 'error') return `
      <div class="empty-state" role="alert">
        <h2>اطلاعات مستأجر از سرور در دسترس نیست</h2>
        <p>${gm09Escape(loadState.error)}</p>
        <button type="button" class="btn btn-secondary" onclick="window.GMViews.GM09.retry('${tenantId}')">تلاش دوباره</button>
      </div>`;
    if (!loadState?.promise) gm09LoadTenantSnapshot(tenantId).catch(() => {});
    return '<div class="empty-state" role="status"><h2>در حال دریافت پرونده و مجوزها از کنترل‌پلن…</h2></div>';
  }
  if (!snapshot.catalog.features.length) return `
    <div class="empty-state" role="status">
      <h2>کاتالوگ قابلیت سرور خالی است</h2>
      <p>برای این مستأجر هیچ تعریف قابلیتی از کنترل‌پلن دریافت نشد؛ دادهٔ نمونه نمایش داده نمی‌شود.</p>
    </div>`;

  const sourceTenant = snapshot.tenant;
  const tenant = {
    ...sourceTenant,
    id: tenantId,
    name: sourceTenant.displayName || sourceTenant.name || tenantId,
    plan: sourceTenant.planCode || sourceTenant.plan || 'پلن ثبت نشده'
  };
  const allFeatures = snapshot.catalog.features;
  const grants = gm09ActiveGrants(snapshot);
  const effectiveFeatures = snapshot.effective.features;
  const featureNameByKey = Object.fromEntries(allFeatures.map(feature => [feature.key, feature.nameFa]));
  const enabledFeatureCount = Object.values(effectiveFeatures).filter(feature => feature.enabled === true).length;
  const disabledFeatureCount = allFeatures.length - enabledFeatureCount;
  const mutationState = gm09MutationStates.get(tenantId);
  const tenantName = gm09Escape(tenant.name);
  const escapedTenantId = gm09Escape(tenant.id);
  const tenantStatus = gm09Escape(tenant.status || snapshot.effective.tenantStatus || 'نامشخص');
  const branchCount = Number.isSafeInteger(Number(tenant.metadata?.branchesCount)) ? Number(tenant.metadata.branchesCount) : null;

  return `
    <div class="page-header gm09-page">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
          <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
          <span class="breadcrumb-separator">/</span>
          <a href="#gm-04-tenant-detail?id=${escapedTenantId}" class="breadcrumb-link">پرونده مشتری</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current" aria-current="page">امکانات و افزونه‌ها</span>
        </nav>
        <div style="display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap;">
          <h1 style="display: flex; align-items: center; gap: 0.5rem; margin: 0;">
            امکانات مستأجر: ${tenantName}
            <span class="page-code-badge">GM-09</span>
          </h1>
          <span class="badge badge-scope-tenant">دامنهٔ مجوز: کل مستأجر</span>
        </div>
        <p>وضعیت مؤثر و مجوزهای ذخیره‌شده از کنترل‌پلن خوانده می‌شوند؛ انتشار به سرویس مشتری جداگانه قابل مشاهده نیست.</p>
      </div>
      <div class="header-actions" style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
        <button class="btn btn-primary" id="btnOpenSellAddonModal" onclick="openSellAddonDrawer('${escapedTenantId}')" style="display: inline-flex; align-items: center; gap: 0.35rem;">
          <span>➕</span>
          <span>تخصیص دسترسی</span>
        </button>
        <a href="#gm-04-tenant-detail?id=${escapedTenantId}&tab=features" class="btn btn-secondary">
          بازگشت به پرونده
        </a>
      </div>
    </div>

    <div class="card" role="note" aria-label="تصمیم نقش‌های مجوزها" style="margin-bottom:1rem; border-color:var(--state-warning, #b54708);">
      <strong>تصمیم نقش‌ها باز است</strong>
      <div style="margin-top:.35rem; color:var(--text-secondary); line-height:1.6;">
        طبق تصمیم کاربر، هویت حساب مدیر پلتفرم (Platform Admin) و مالک رستوران (Restaurant Owner) جدا می‌ماند. نقش‌های داخل مستأجر که مجاز به مشاهده یا تغییر مجوز مؤثر، تخصیص مجوز یا استثنای دسترسی باشند هنوز نیازمند تصمیم کاربرند؛ تا آن زمان مجوزهای نقش‌های مستأجر و مرز RBAC تغییر داده نشده‌اند.
      </div>
    </div>

    ${mutationState ? `
      <div class="card" role="${mutationState.status === 'error' ? 'alert' : 'status'}" style="margin-bottom:1rem; border-color:${mutationState.status === 'error' ? 'var(--state-danger)' : mutationState.status === 'sync_pending' || mutationState.status === 'pending_readback' ? 'var(--state-warning)' : 'var(--border-subtle)'}">
        <strong>${mutationState.status === 'saved' ? 'ذخیره‌شده در کنترل‌پلن' : mutationState.status === 'sync_pending' ? 'ذخیره‌شده؛ همگام‌سازی ناموفق' : mutationState.status === 'pending_readback' ? 'در انتظار تأیید بازخوانی' : 'خطا در ثبت'}</strong>
        <div>${gm09Escape(mutationState.message)}</div>
      </div>` : ''}

    <!-- Modern Tenant Context Card -->
    <div class="card" style="margin-bottom: 1.25rem; border-radius: 12px; border-color: rgba(99, 102, 241, 0.2); background: linear-gradient(135deg, rgba(99, 102, 241, 0.04) 0%, rgba(2, 132, 199, 0.04) 100%);">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.85rem;">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div style="width: 44px; height: 44px; border-radius: 10px; background: rgba(99, 102, 241, 0.12); display: flex; align-items: center; justify-content: center; font-size: 1.35rem; flex-shrink: 0;">
            🏪
          </div>
          <div>
            <div style="display: flex; align-items: center; gap: 0.45rem;">
              <strong style="color: var(--text-primary); font-size: 0.95rem;">${tenantName}</strong>
              <span class="badge badge-scope-tenant">سیاست مشترک همهٔ شعب</span>
            </div>
            <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 0.2rem;">
              پلن: <strong style="color: var(--accent-cyan);">${gm09Escape(tenant.plan)}</strong> • وضعیت مستأجر: <span class="badge badge-neutral" style="font-size: 0.68rem;">${tenantStatus}</span>
            </div>
            <details class="row-disclosure tenant-technical-details" style="margin-top: 0.2rem;">
              <summary style="font-size: 0.72rem; color: var(--text-tertiary); cursor: pointer;">جزئیات فنی دامنه و زیرساخت</summary>
              <div style="font-size: 0.72rem; margin-top: 0.25rem; font-family: var(--font-mono); color: var(--text-secondary);">
                شناسه مستأجر: ${escapedTenantId}${tenant.cellId ? ` · شناسه سلول: ${gm09Escape(tenant.cellId)}` : ''}
              </div>
            </details>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap;">
          <span class="badge badge-neutral" style="font-size: 0.8rem; padding: 0.35rem 0.65rem;">
            ${enabledFeatureCount} دسترسی مؤثر در کنترل‌پلن
          </span>
          <span class="badge badge-neutral" style="font-size: 0.8rem; padding: 0.35rem 0.65rem;">
            ${disabledFeatureCount} دسترسی غیرفعال در کنترل‌پلن
          </span>
        </div>
      </div>
    </div>

    <div class="data-quality-strip" role="status" aria-label="وضعیت منبع حقوق استفاده مشتری">
      <div class="data-quality-label"><span class="dq-badge-dot dot-cyan"></span><span>وضعیت حقوق استفاده</span></div>
      <div class="data-quality-grid">
        <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">منبع</span><span class="dq-dim-val">کنترل‌پلن</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">دامنه</span><span class="dq-dim-val">${tenantName} · همهٔ شعب</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">مجوز ثبت‌شده</span><span class="dq-dim-val">${Object.keys(grants).length.toLocaleString('fa-IR')} مورد</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">انتشار به سرویس</span><span class="dq-dim-val">وضعیت از API ارائه نشده</span></span>
      </div>
      <span class="dq-action-hint"><span>قیمت مصوب و وضعیت همگام‌سازی پس از ثبت از API فعلی قابل تأیید نیست.</span></span>
    </div>

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
              const effective = effectiveFeatures[f.key];
              const isEnabled = effective.enabled === true;
              const isGloballyDisabled = effective.source === 'killswitch';
              const isUnverifiedStop = effective.source === 'unverified_killswitch';
              const isPolicyLocked = isGloballyDisabled || isUnverifiedStop;
              const isCommerciallyControllable = f.commercialState === 'addon' && f.baseEntitlement !== true && !['planned', 'retired'].includes(f.lifecycle);
              const canMutate = isCommerciallyControllable && !isPolicyLocked;
              const sourceLabel = {
                grant: `افزونه · ${gm09Escape(grant?.grantKind || 'مجوز')}`,
                base_plan: 'شامل سیاست پایه',
                override_allow: 'استثنای مجاز',
                override_deny: 'استثنای مسدود',
                killswitch: 'توقف سراسری',
                unverified_killswitch: 'توقف ثبت شده؛ توزیع نامشخص',
                tenant_suspension: 'تعلیق مستأجر',
                catalog: 'بدون مجوز'
              }[effective.source] || gm09Escape(effective.source || 'نامشخص');
              return `
                <tr id="row-feature-${f.key}" class="${isGloballyDisabled ? 'row-globally-disabled' : ''}">
                  <td>
                    <div class="cell-primary" style="font-weight: 500;">
                      ${gm09Escape(f.nameFa)}
                      ${isGloballyDisabled ? '<span class="badge badge-danger" style="margin-right: 0.35rem; font-size: 0.65rem;">توقف ثبت شده</span>' : isUnverifiedStop ? '<span class="badge badge-warning" style="margin-right: 0.35rem; font-size: 0.65rem;">توزیع تأیید نشده</span>' : ''}
                    </div>
                    <details class="row-disclosure feature-row-disclosure">
                      <summary>جزئیات فنی</summary>
                      <span class="cell-mono">کلید: ${f.key}</span>
                    </details>
                  </td>
                  <td>
                    <span class="badge ${isGranted ? 'badge-success' : 'badge-neutral'}">${sourceLabel}</span>
                  </td>
                  <td>
                    ${isPolicyLocked ? `
                      <span class="badge ${isGloballyDisabled ? 'badge-danger' : 'badge-warning'}" style="font-size: 0.72rem;" title="${gm09Escape(effective.reason || 'وضعیت توزیع سیاست سراسری تأیید نشده است')}">
                        ${isGloballyDisabled ? 'توقف ثبت‌شده' : 'توزیع نامشخص'}
                      </span>
                    ` : (isEnabled
                      ? '<span style="color: var(--state-success); font-weight: 600; font-size: 0.75rem;">فعال</span>'
                      : '<span style="color: var(--text-tertiary); font-size: 0.75rem;">غیرفعال</span>'
                    )}
                  </td>
                  <td>
                    ${isPolicyLocked ? `
                      <span class="badge ${isGloballyDisabled ? 'badge-danger' : 'badge-warning'}" style="font-size: 0.7rem;" title="${gm09Escape(effective.reason || 'توزیع سراسری تأیید نشده است')}">${isGloballyDisabled ? 'توقف ثبت‌شده در سیاست' : 'اثر مستأجر نامشخص'}</span>
                    ` : `<span class="badge ${isEnabled ? 'badge-success' : 'badge-neutral'}">${gm09Escape(effective.reason || (isEnabled ? 'فعال در سیاست مؤثر سرور' : 'غیرفعال در سیاست مؤثر سرور'))}</span>`}
                  </td>
                  <td class="cell-mono" style="font-size: 0.75rem;">
                    ${isGranted && grant.expiresAt ? gm09Escape(grant.expiresAt) : isGranted ? 'پایان اعتبار در پاسخ ثبت نشده' : effective.source === 'base_plan' ? 'مشمول سیاست پایه' : '—'}
                  </td>
                  <td>
                    ${(f.dependencies || []).length === 0
                      ? '<span style="color: var(--text-tertiary); font-size: 0.75rem;">مستقل</span>' 
                      : `<span class="badge badge-warning" style="margin-left: 0.2rem; font-size: 0.68rem;">${f.dependencies.map(d => gm09Escape(featureNameByKey[d] || d)).join('، ')}</span>
                        <details class="row-disclosure feature-row-disclosure">
                          <summary>کلیدهای فنی</summary>
                          <span class="cell-mono">${f.dependencies.map(gm09Escape).join('، ')}</span>
                        </details>`
                    }
                  </td>
                  <td class="cell-actions">
                    <button type="button" 
                            class="toggle-switch-btn ${isEnabled && !isPolicyLocked ? 'on' : ''}"
                            role="switch" 
                            aria-checked="${isEnabled && !isPolicyLocked ? 'true' : 'false'}"
                            aria-label="تغییر وضعیت ${gm09Escape(f.nameFa)}"
                            ${!canMutate ? `disabled title="${isPolicyLocked ? 'وضعیت توقف یا توزیع هنوز برای این مستأجر تأیید نشده است' : 'این قابلیت از مسیر افزونهٔ قابل تخصیص مدیریت نمی‌شود'}" style="margin-left: 0.5rem; vertical-align: middle; opacity: 0.45; cursor: not-allowed;"` : `onclick="toggleTenantFeature('${escapedTenantId}', '${gm09Escape(f.key)}')" style="margin-left: 0.5rem; vertical-align: middle;"`}>
                      <span class="toggle-switch-knob"></span>
                    </button>
                    ${!canMutate ? `
                      <button class="btn btn-sm btn-secondary" disabled style="opacity: 0.7; cursor: not-allowed; font-size: 0.72rem;">${isPolicyLocked ? 'توزیع تأیید نشده' : 'غیرقابل تخصیص'}</button>
                    ` : (isEnabled
                      ? `<button class="btn btn-sm btn-secondary" aria-label="غیرفعال‌سازی ${gm09Escape(f.nameFa)} برای مستأجر ${tenantName}" onclick="toggleTenantFeature('${escapedTenantId}', '${gm09Escape(f.key)}')">غیرفعال‌سازی</button>`
                      : `<button class="btn btn-sm btn-primary" aria-label="افزودن ${gm09Escape(f.nameFa)} به مستأجر ${tenantName}" onclick="quickSellFeature('${escapedTenantId}', '${gm09Escape(f.key)}')">فعال‌سازی</button>`
                    )}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
};

window.openSellAddonDrawer = function(tenantId) {
  const snapshot = gm09Snapshots.get(tenantId);
  if (!snapshot) {
    gm09Toast('اطلاعات مستأجر از سرور بارگذاری نشده است؛ تخصیصی انجام نشد.', 'error');
    gm09LoadTenantSnapshot(tenantId).catch(() => {});
    return;
  }
  gm09DrawerTenantId = tenantId;
  const tenantName = gm09Escape(snapshot.tenant.displayName || snapshot.tenant.name || tenantId);
  const grants = gm09ActiveGrants(snapshot);
  const availableFeatures = snapshot.catalog.features.filter(feature =>
    feature.commercialState === 'addon' && feature.baseEntitlement !== true && !['planned', 'retired'].includes(feature.lifecycle) &&
    !snapshot.effective.features[feature.key]?.enabled &&
    !['killswitch', 'unverified_killswitch'].includes(snapshot.effective.features[feature.key]?.source));
  const defaultFeature = availableFeatures[0] || null;
  const content = `
    <div style="display:flex; flex-direction:column; gap:1rem;">
      <div class="surface-subtle" style="padding:.75rem;">
        <strong>تخصیص دسترسی برای ${tenantName}</strong>
        <div style="color:var(--text-secondary); margin-top:.25rem;">این اقدام مجوز را در کنترل‌پلن ثبت می‌کند؛ پرداخت/قیمت‌گذاری در این مسیر انجام نمی‌شود. دامنهٔ مجوز کل مستأجر است.</div>
      </div>
      <div class="form-group">
        <label class="form-label" for="addonSelect">قابلیت موردنظر</label>
        <select id="addonSelect" class="form-control" ${defaultFeature ? '' : 'disabled'} onchange="updateAddonDrawerCalculations(this.value)">
          ${availableFeatures.map(feature => `<option value="${gm09Escape(feature.key)}" ${feature.key === defaultFeature?.key ? 'selected' : ''}>${gm09Escape(feature.nameFa)} (${gm09Escape(feature.key)})</option>`).join('')}
          ${defaultFeature ? '' : '<option value="">دسترسی جدیدی برای تخصیص وجود ندارد</option>'}
        </select>
      </div>
      <div id="addonDependencyBox" class="surface-subtle"></div>
      <div class="form-group">
        <label class="form-label" for="addonDuration">مدت مجوز</label>
        <select id="addonDuration" class="form-control" onchange="updateAddonDrawerCalculations(document.getElementById('addonSelect').value)">
          <option value="1">۱ ماه</option><option value="3">۳ ماه</option><option value="6">۶ ماه</option><option value="12" selected>۱۲ ماه</option>
        </select>
      </div>
      <div id="addonPricingBox" class="surface-subtle" role="note"></div>
      <div style="display:flex; justify-content:flex-end; gap:.5rem;">
        <button class="btn btn-secondary" onclick="window.GMApp?.closeDrawer?.()">انصراف</button>
        <button class="btn btn-primary" id="btnConfirmSellAddon" ${defaultFeature ? '' : 'disabled'} onclick="confirmAddonSale('${gm09Escape(tenantId)}')">ثبت دسترسی در کنترل‌پلن</button>
      </div>
    </div>`;
  if (window.GMApp?.openDrawer) window.GMApp.openDrawer(`دسترسی‌های ${tenantName}`, content);
  else if (typeof openDrawer === 'function') openDrawer(`دسترسی‌های ${tenantName}`, content);
  if (defaultFeature) window.updateAddonDrawerCalculations(defaultFeature.key);
  else {
    const depBox = document.getElementById('addonDependencyBox');
    const priceBox = document.getElementById('addonPricingBox');
    if (depBox) depBox.textContent = 'هیچ قابلیت قابل تخصیص از کاتالوگ سرور موجود نیست.';
    if (priceBox) priceBox.textContent = 'قیمت مصوب در API کاتالوگ موجود نیست.';
  }
};

window.updateAddonDrawerCalculations = function(featureKey) {
  const snapshot = gm09Snapshots.get(gm09DrawerTenantId);
  const feature = snapshot?.catalog.features.find(item => item.key === featureKey);
  if (!feature) return;
  const dependencies = Array.isArray(feature.dependencies) ? feature.dependencies : [];
  const missing = dependencies.filter(key => snapshot.effective.features[key]?.enabled !== true);
  const depBox = document.getElementById('addonDependencyBox');
  if (depBox) {
    depBox.innerHTML = dependencies.length
      ? `<strong>پیش‌نیازهای ثبت‌شده در کاتالوگ:</strong><div>${dependencies.map(key => `${gm09Escape(snapshot.catalog.features.find(item => item.key === key)?.nameFa || key)} — ${snapshot.effective.features[key]?.enabled === true ? 'فعال در پاسخ کنترل‌پلن' : 'فعال نیست'}`).join('<br>')}</div><small>اعتبار نهایی وابستگی هنگام ثبت سمت سرور انجام می‌شود${missing.length ? '؛ یک یا چند پیش‌نیاز فعلاً فعال نیست.' : '.'}</small>`
      : '<div>در کاتالوگ سرور پیش‌نیازی ثبت نشده است.</div>';
  }
  const duration = Number(document.getElementById('addonDuration')?.value || 12);
  const priceBox = document.getElementById('addonPricingBox');
  if (priceBox) priceBox.innerHTML = `<div><strong>مدت مجوز:</strong> ${duration} ماه</div><div>قیمت مصوب/مبلغ فاکتور در API موجود نیست؛ این اقدام فقط مجوز دسترسی را ثبت می‌کند.</div>`;
};

window.confirmAddonSale = async function(tenantId) {
  const featureKey = document.getElementById('addonSelect')?.value || '';
  const months = Number(document.getElementById('addonDuration')?.value);
  if (!featureKey || !Number.isInteger(months) || months < 1 || months > 120) {
    gm09Toast('قابلیت و مدت مجوز معتبر انتخاب کنید.', 'error');
    return false;
  }
  const result = await gm09MutateFeature({ tenantId, featureKey, enabled: true, durationMonths: months });
  if (!['saved', 'sync_pending', 'pending_readback'].includes(result?.status)) return false;
  window.GMApp?.closeDrawer?.();
  if (result.status === 'saved') gm09Toast('مجوز در کنترل‌پلن ذخیره و بازخوانی شد؛ این مسیر رسید پرداخت صادر نمی‌کند.', 'success');
  window.location.hash = `#gm-09-tenant-features?id=${encodeURIComponent(tenantId)}&t=${Date.now()}`;
  return result.status === 'saved';
};

window.toggleTenantFeature = async function(tenantId, featureKey) {
  const snapshot = gm09Snapshots.get(tenantId);
  if (!snapshot) {
    gm09Toast('وضعیت جاری از سرور در دسترس نیست؛ تغییری انجام نشد.', 'error');
    return false;
  }
  const effective = snapshot.effective.features[featureKey];
  if (!effective) {
    gm09Toast('این قابلیت در ارزیابی سرور وجود ندارد؛ تغییری انجام نشد.', 'error');
    return false;
  }
  if (['killswitch', 'unverified_killswitch'].includes(effective.source)) {
    gm09Toast('سیاست توقف یا توزیع سراسری برای این مستأجر تأیید نشده؛ تغییر دیگری اعمال نشد.', 'warning');
    return false;
  }
  const enabled = effective.enabled !== true;
  const result = await gm09MutateFeature({ tenantId, featureKey, enabled });
  if (!['saved', 'sync_pending', 'pending_readback'].includes(result?.status)) return false;
  if (result.status === 'saved') gm09Toast('تغییر در کنترل‌پلن ذخیره و بازخوانی شد؛ وضعیت انتشار به سرویس مشتری جداگانه قابل مشاهده نیست.', 'success');
  window.location.hash = `#gm-09-tenant-features?id=${encodeURIComponent(tenantId)}&t=${Date.now()}`;
  return result.status === 'saved';
};

window.quickSellFeature = async function(tenantId, featureKey) {
  const result = await gm09MutateFeature({ tenantId, featureKey, enabled: true, durationMonths: 12 });
  if (!['saved', 'sync_pending', 'pending_readback'].includes(result?.status)) return false;
  if (result.status === 'saved') gm09Toast('مجوز ۱۲ماهه در کنترل‌پلن ذخیره شد؛ قیمت یا پرداختی در این مسیر ثبت نشده است.', 'success');
  window.location.hash = `#gm-09-tenant-features?id=${encodeURIComponent(tenantId)}&t=${Date.now()}`;
  return result.status === 'saved';
};

window.GMViews.GM09 = {
  render(params) {
    return window.renderGM09(params);
  }
};
