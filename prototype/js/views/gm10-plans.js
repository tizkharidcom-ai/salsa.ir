/**
 * GM-10: server-backed commercial plan catalog and version publishing.
 * Prices, quotas, feature definitions, drafts, and publish results come only
 * from the Control Plane API. This view deliberately has no store/fixture path.
 */
(function (global) {
  'use strict';

  const state = {
    status: 'loading',
    plans: [],
    matrix: null,
    matrixError: null,
    access: null,
    error: null,
    lastMutationResult: null,
    pendingPublishes: new Map(),
    requestId: 0,
    loading: false,
    handler: null
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatApiValue(value) {
    if (value === null || value === undefined || value === '') return 'در API ثبت نشده';
    if (typeof value === 'number' && Number.isFinite(value)) return value.toLocaleString('fa-IR');
    if (typeof value === 'boolean') return value ? 'بله' : 'خیر';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function formatDate(value) {
    if (!value) return 'در API ثبت نشده';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('fa-IR') : String(value);
  }

  function currentRepository() {
    return global.CommercialRepository || null;
  }

  function getMutationDisabledReason() {
    if (!state.access) return 'ابتدا نشست Control Plane و نقش مجاز بررسی شود.';
    if (!state.access.allowed) return state.access.reason || 'نقش یا نشست فعلی اجازهٔ تغییر پلن ندارد.';
    if (!global.GodModeConfirmDialog || typeof global.GodModeConfirmDialog.show !== 'function') {
      return 'سرویس تأیید امن عملیات در این صفحه بارگذاری نشده؛ تغییر پلن غیرفعال است.';
    }
    return '';
  }

  function errorPanel(error) {
    const status = Number(error && error.status) || 0;
    const authFailure = status === 401 || status === 403;
    const title = authFailure ? 'دسترسی به کاتالوگ پلن‌ها مجاز نیست' : 'دریافت کاتالوگ پلن‌ها ناموفق بود';
    const explanation = authFailure
      ? 'این مسیر API فقط برای نشست پلتفرمیِ دارای مجوز نمایش draftها در دسترس است. با حساب پلتفرم وارد شوید یا دسترسی نقش را بررسی کنید.'
      : status === 0
        ? 'ارتباط با Control Plane برقرار نشد. اتصال سرویس و نشانی Control Plane را بررسی و دوباره تلاش کنید.'
        : 'Control Plane پاسخ خطا داد. پس از بررسی سرویس و دسترسی، دوباره تلاش کنید.';
    return `
      <section class="card" role="alert" aria-live="assertive" aria-labelledby="gm10-error-title">
        <div class="card-body">
          <h2 id="gm10-error-title">${title}</h2>
          <p>${explanation}</p>
          <p><strong>پاسخ API:</strong> ${escapeHtml(error && error.message || 'پیام خطا دریافت نشد')}
            ${error && error.code ? ' · ' + escapeHtml(error.code) : ''}
            ${status ? ' · HTTP ' + status.toLocaleString('fa-IR') : ''}</p>
          <button type="button" class="btn btn-primary" data-gm10-action="refresh">تلاش دوباره</button>
          ${renderMutationResult()}
        </div>
      </section>`;
  }

  function emptyPanel() {
    return `
      <section class="card" role="status" aria-labelledby="gm10-empty-title">
        <div class="card-body">
          <h2 id="gm10-empty-title">کاتالوگ API خالی است</h2>
          <p>Control Plane پاسخ موفق داد، اما هیچ پلن منتشرشده یا draft در پاسخ این درخواست نبود. دادهٔ نمایشی جایگزین نمی‌شود.</p>
          <p>برای ایجاد draft از این صفحه، ابتدا باید پلن مبنا و داده‌های واقعی قیمت، سهمیه و قابلیت‌ها در کاتالوگ Control Plane موجود باشد.</p>
          <button type="button" class="btn btn-secondary" data-gm10-action="refresh">بازخوانی کاتالوگ</button>
          ${renderMutationResult()}
        </div>
      </section>`;
  }

  function renderLoading() {
    return `
      <section class="card" role="status" aria-live="polite">
        <div class="card-body">
          <p>در حال خواندن پلن‌ها، قیمت‌ها و سهمیه‌ها از Control Plane…</p>
          <div class="progress" aria-hidden="true"><div class="progress-bar" style="width: 40%"></div></div>
        </div>
      </section>`;
  }

  function featureName(key) {
    const feature = state.matrix && state.matrix.featureComparison
      ? state.matrix.featureComparison.find(item => item && item.key === key)
      : null;
    return feature && feature.nameFa ? feature.nameFa : key;
  }

  function renderMutationResult() {
    if (!state.lastMutationResult) return '';
    const result = state.lastMutationResult;
    return `
      <section class="card" role="status" aria-live="polite" aria-labelledby="gm10-result-title">
        <div class="card-body">
          <h2 id="gm10-result-title">${result.kind === 'published' ? 'نتیجهٔ انتشار از سرور' : 'نتیجهٔ ثبت draft از سرور'}</h2>
          <p>این نتیجه مستقیماً از پاسخ عملیات Control Plane آمده است؛ مقدار محلی یا پیش‌بینی‌شده نمایش داده نمی‌شود.</p>
          <pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:20rem;overflow:auto">${escapeHtml(JSON.stringify(result.data, null, 2))}</pre>
        </div>
      </section>`;
  }

  function renderAccessNotice() {
    const reason = getMutationDisabledReason();
    if (!reason) {
      return `<p class="text-secondary" role="status">نشست تأیید شد · نقش مجاز از Control Plane: <code>${escapeHtml(state.access.role)}</code>. مجوز نهایی هر عملیات را سرور بررسی می‌کند.</p>`;
    }
    return `
      <div class="alert alert-warning" role="note">
        <strong>ساخت و انتشار پلن غیرفعال است.</strong>
        <span>${escapeHtml(reason)}</span>
      </div>`;
  }

  function quotaRows(plan) {
    const quotas = plan && plan.quotas && typeof plan.quotas === 'object' && !Array.isArray(plan.quotas)
      ? plan.quotas : {};
    const fixed = [
      ['includedBranches', 'شعبهٔ همراه'],
      ['includedDevices', 'دستگاه همراه'],
      ['includedUsers', 'کاربر همراه']
    ].map(([key, label]) => `
      <div class="gm10-data-row"><span>${label}</span><strong>${escapeHtml(formatApiValue(plan[key]))}</strong></div>`);
    const extra = Object.entries(quotas).map(([key, value]) => `
      <div class="gm10-data-row"><span><code>${escapeHtml(key)}</code></span><strong>${escapeHtml(formatApiValue(value))}</strong></div>`);
    if (!Object.keys(quotas).length) extra.push('<p class="text-secondary">سهمیه‌ای در بخش quotas پاسخ API ثبت نشده است.</p>');
    return fixed.concat(extra).join('');
  }

  function draftQuotaSafety(plan) {
    const quotas = plan && plan.quotas && typeof plan.quotas === 'object' && !Array.isArray(plan.quotas)
      ? plan.quotas : {};
    const requiredKeys = ['maxBranches', 'maxDevices', 'maxUsers', 'maxOrders', 'maxStorageMb', 'maxSms'];
    const missing = requiredKeys.filter(key => !Object.prototype.hasOwnProperty.call(quotas, key));
    if (missing.length) {
      return 'ثبت draft امن نیست: پاسخ API این کلیدهای سهمیه را ندارد و endpoint ساخت draft برای آن‌ها مقدار پیش‌فرض داخلی می‌سازد: ' + missing.join('، ');
    }
    if (Number(quotas.maxBranches) !== Number(plan.includedBranches)
      || Number(quotas.maxDevices) !== Number(plan.includedDevices)
      || Number(quotas.maxUsers) !== Number(plan.includedUsers)) {
      return 'ثبت draft امن نیست: سهمیه‌های شعبه/دستگاه/کاربر API با فیلدهای همراه همین نسخه هم‌خوان نیستند؛ ابتدا قرارداد backend را هماهنگ کنید.';
    }
    if (Object.values(quotas).some(value => !Number.isSafeInteger(Number(value)))) {
      return 'ثبت draft امن نیست: دست‌کم یک سهمیهٔ API عدد صحیح قابل‌حفظ نیست؛ برای جلوگیری از تبدیل یا حذف داده، عملیات غیرفعال است.';
    }
    const currentFeatureKeys = Array.isArray(plan.includedFeatures) ? plan.includedFeatures : [];
    if ((!state.matrix || !Array.isArray(state.matrix.featureComparison) || !state.matrix.featureComparison.length)
      && currentFeatureKeys.length === 0) {
      return 'ثبت draft امن نیست: API هیچ قابلیت مبنا برنگرداند و ماتریس قابلیت هم در دسترس نیست؛ ویژگی جدید ساخته نمی‌شود.';
    }
    if (state.matrix && Array.isArray(state.matrix.featureComparison)) {
      const canonicalKeys = new Set(state.matrix.featureComparison.map(item => item && item.key).filter(Boolean));
      const unknownKeys = currentFeatureKeys.filter(key => !canonicalKeys.has(key));
      if (unknownKeys.length) {
        return 'ثبت draft امن نیست: دست‌کم یک قابلیت نسخه در ماتریس canonical API نیست؛ تغییر باعث حذف خاموش قابلیت می‌شود: ' + unknownKeys.join('، ');
      }
    }
    return '';
  }

  function renderPlanCard(plan, index, draftCountForCode) {
    const code = escapeHtml(plan.planCode);
    const version = escapeHtml(plan.version);
    const isDraft = plan.isDraft === true;
    const accessReason = getMutationDisabledReason();
    const canMutate = !accessReason;
    const draftSafetyReason = draftQuotaSafety(plan);
    const isAmbiguous = isDraft && draftCountForCode > 1;
    const noDraftForCode = draftCountForCode === 0;
    const statusLabel = isDraft ? 'پیش‌نویس' : 'منتشرشده';
    const featureKeys = Array.isArray(plan.includedFeatures) ? plan.includedFeatures : [];
    const featureList = featureKeys.length
      ? `<ul class="gm10-feature-list">${featureKeys.map(key => `<li>${escapeHtml(featureName(key))}<code>${escapeHtml(key)}</code></li>`).join('')}</ul>`
      : '<p class="text-secondary">در پاسخ API قابلیتی برای این نسخه ثبت نشده است.</p>';
    const monthly = typeof plan.basePriceMonthlyToman === 'number' && Number.isFinite(plan.basePriceMonthlyToman)
      ? `<strong>${escapeHtml(formatApiValue(Number(plan.basePriceMonthlyToman)))} تومان</strong>`
      : '<strong>قیمت ماهانه در API ثبت نشده</strong>';
    const annual = typeof plan.basePriceAnnualToman === 'number' && Number.isFinite(plan.basePriceAnnualToman)
      ? `<span>${escapeHtml(formatApiValue(Number(plan.basePriceAnnualToman)))} تومان / سال</span>`
      : '';
    const provisioningLink = !isDraft
      ? `<a class="btn btn-ghost" href="#gm-05-tenant-new?plan=${encodeURIComponent(plan.nameFa || plan.planCode)}">ادامهٔ ایجاد مشتری با این پلن</a>`
      : '';
    const actionMarkup = isDraft
      ? `
        <button type="button" class="btn btn-secondary" data-gm10-action="edit-draft" data-plan-code="${code}" data-version="${version}" ${canMutate && !draftSafetyReason ? '' : 'disabled'}>ویرایش همین draft</button>
        <button type="button" class="btn btn-primary" data-gm10-action="publish" data-plan-code="${code}" data-version="${version}" ${canMutate && !isAmbiguous ? '' : 'disabled'}>بررسی و انتشار</button>
        ${isAmbiguous ? '<p class="text-warning">برای این کد بیش از یک draft از API آمده؛ endpoint انتشار draft را مبهم انتخاب می‌کند، پس انتشار غیرفعال است.</p>' : ''}
        ${draftSafetyReason ? `<p class="text-warning">${escapeHtml(draftSafetyReason)}</p>` : ''}
      `
        : noDraftForCode
        ? `<button type="button" class="btn btn-secondary" data-gm10-action="new-draft" data-plan-code="${code}" data-version="${version}" ${canMutate && !draftSafetyReason ? '' : 'disabled'}>ساخت draft بر پایهٔ این نسخه</button>
           ${draftSafetyReason ? `<p class="text-warning">${escapeHtml(draftSafetyReason)}</p>` : ''}`
        : '<p class="text-secondary">برای این کد draft موجود است؛ همان نسخه را از کارت پیش‌نویس ویرایش کنید.</p>';
    return `
      <article class="card gm10-plan-card" data-plan-code="${code}" data-plan-version="${version}">
        <div class="card-body">
          <div class="gm10-card-heading">
            <div><h2>${escapeHtml(plan.nameFa || plan.planCode || 'نام ثبت‌نشده در API')}</h2><p><code>${code}</code> · نسخهٔ <code>${version}</code></p></div>
            <span class="badge ${isDraft ? 'badge-warning' : 'badge-success'}">${statusLabel}</span>
          </div>
          <p>${escapeHtml(plan.descriptionFa || 'شرحی در API ثبت نشده است.')}</p>
          <div class="gm10-price-block">
            <span>قیمت پایهٔ ماهانه</span>${monthly}
            ${annual ? `<span>قیمت پایهٔ سالانه · ${annual}</span>` : ''}
            <small>مبنای پول API: ${escapeHtml(formatApiValue(plan.basePriceMonthlyRials))} ریال</small>
          </div>
          <div class="gm10-data-grid">${quotaRows(plan)}</div>
          <details class="gm10-features">
            <summary>قابلیت‌های ثبت‌شده در API · ${featureKeys.length.toLocaleString('fa-IR')}</summary>${featureList}
          </details>
          <p class="text-secondary">اثرگذاری: ${escapeHtml(formatDate(plan.effectiveFrom))} · به‌روزرسانی: ${escapeHtml(formatDate(plan.updatedAt))}</p>
          <div class="gm10-actions">
            <button type="button" class="btn btn-ghost" data-gm10-action="details" data-plan-code="${code}" data-version="${version}">جزئیات API</button>
            ${provisioningLink}
            ${actionMarkup}
          </div>
        </div>
      </article>`;
  }

  function renderMatrix() {
    if (state.matrixError) {
      return `
        <section class="card" role="note">
          <div class="card-body">
            <h2>مقایسهٔ ماتریسی در دسترس نیست</h2>
            <p>کاتالوگ پلن از API خوانده شده، اما درخواست <code>/plans/matrix</code> ناموفق بود. مقایسه یا مقادیر جایگزین ساخته نشده است.</p>
            <p><strong>پاسخ API:</strong> ${escapeHtml(state.matrixError.message || 'خطای نامشخص')}</p>
            <button type="button" class="btn btn-secondary" data-gm10-action="refresh">تلاش دوباره</button>
          </div>
        </section>`;
    }
    if (!state.matrix) return '';
    const plans = state.matrix.plans;
    const features = state.matrix.featureComparison;
    const quotaRowsData = [
      { key: 'includedBranches', label: 'شعبهٔ همراه' },
      { key: 'includedDevices', label: 'دستگاه همراه' },
      { key: 'includedUsers', label: 'کاربر همراه' }
    ];
    const quotaKeys = new Set();
    plans.forEach(plan => Object.keys(plan.quotas || {}).forEach(key => quotaKeys.add(key)));
    Array.from(quotaKeys).forEach(key => quotaRowsData.push({ key: 'quotas.' + key, label: key }));
    return `
      <section class="card gm10-matrix">
        <div class="card-body">
          <h2>مقایسهٔ کاتالوگ Control Plane</h2>
          <p>تمام ستون‌ها و سلول‌ها از پاسخ <code>/api/control/billing/plans/matrix</code> و دادهٔ پلن‌های همان API خوانده شده‌اند.</p>
          <div class="table-responsive"><table class="data-table">
            <thead><tr><th>شاخص</th>${plans.map(plan => `<th>${escapeHtml(plan.nameFa || plan.planCode)}<br><code>${escapeHtml(plan.planCode)} · ${escapeHtml(plan.version)}</code></th>`).join('')}</tr></thead>
            <tbody>
              <tr><th>قیمت پایهٔ ماهانه (تومان)</th>${plans.map(plan => `<td>${escapeHtml(formatApiValue(plan.basePriceMonthlyToman))}</td>`).join('')}</tr>
              ${quotaRowsData.map(row => `<tr><th>${escapeHtml(row.label)}</th>${plans.map(plan => {
                const value = row.key.startsWith('quotas.') ? (plan.quotas || {})[row.key.slice(7)] : plan[row.key];
                return `<td>${escapeHtml(formatApiValue(value))}</td>`;
              }).join('')}</tr>`).join('')}
              ${features.map(feature => `<tr><th>${escapeHtml(feature.nameFa || feature.key)}<br><code>${escapeHtml(feature.key)}</code></th>${plans.map(plan => `<td>${feature.plans && feature.plans[plan.planCode] === true ? '✓' : '—'}</td>`).join('')}</tr>`).join('')}
            </tbody>
          </table></div>
        </div>
      </section>`;
  }

  function renderCatalog() {
    const draftsByCode = new Map();
    state.plans.filter(plan => plan.isDraft === true).forEach(plan => {
      draftsByCode.set(plan.planCode, (draftsByCode.get(plan.planCode) || 0) + 1);
    });
    const sourceLabel = state.plansMeta && state.plansMeta.observedAt
      ? formatDate(state.plansMeta.observedAt) : 'زمان پاسخ در دسترس نیست';
    return `
      <div class="gm10-source-line" role="status">
        <strong>منبع قیمت، سهمیه و ویژگی: Control Plane API</strong>
        <span>پاسخ فهرست پلن‌ها: ${escapeHtml(sourceLabel)}</span>
        <button type="button" class="btn btn-secondary btn-sm" data-gm10-action="refresh" ${state.loading ? 'disabled' : ''}>بازخوانی از سرور</button>
      </div>
      ${renderAccessNotice()}
      ${renderMutationResult()}
      <section class="gm10-plan-grid" aria-label="پلن‌های بازگشتی از API">
        ${state.plans.map((plan, index) => renderPlanCard(plan, index, draftsByCode.get(plan.planCode) || 0)).join('')}
      </section>
      ${renderMatrix()}
      <p class="text-secondary">این صفحه فقط کاتالوگ و نسخه‌بندی قیمت‌گذاری را مدیریت می‌کند؛ هیچ تغییر subscription یا قرارداد مستأجر از این مسیر انجام نمی‌شود.</p>`;
  }

  function renderMainContent() {
    if (state.status === 'loading' && !state.plans.length) return renderLoading();
    if (state.status === 'failed') return errorPanel(state.error || new Error('خطای نامشخص'));
    if (state.status === 'empty') return emptyPanel();
    return renderCatalog();
  }

  function makeIdempotencyKey() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    return 'gm10-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  }

  function getPlan(planCode, version) {
    return state.plans.find(plan => plan.planCode === planCode && String(plan.version) === String(version)) || null;
  }

  function openPlanDetailDrawer(planCode, version) {
    const plan = getPlan(planCode, version);
    if (!plan) return;
    const features = Array.isArray(plan.includedFeatures) ? plan.includedFeatures : [];
    const details = [
      ['planCode', plan.planCode],
      ['version', plan.version],
      ['state', plan.isDraft === true ? 'draft' : 'published'],
      ['nameFa', plan.nameFa],
      ['descriptionFa', plan.descriptionFa],
      ['basePriceMonthlyRials', plan.basePriceMonthlyRials],
      ['basePriceMonthlyToman', plan.basePriceMonthlyToman],
      ['basePriceAnnualRials', plan.basePriceAnnualRials],
      ['basePriceAnnualToman', plan.basePriceAnnualToman],
      ['includedBranches', plan.includedBranches],
      ['includedDevices', plan.includedDevices],
      ['includedUsers', plan.includedUsers],
      ['quotas', plan.quotas],
      ['includedFeatures', features],
      ['effectiveFrom', plan.effectiveFrom],
      ['effectiveTo', plan.effectiveTo],
      ['createdAt', plan.createdAt],
      ['updatedAt', plan.updatedAt],
      ['pricingSource', plan.pricingSource]
    ];
    const content = `
      <div class="gm10-api-detail">
        <p>مقادیر زیر عین پاسخ API هستند؛ ویژگی قراردادی یا SLA که در پاسخ نیست اضافه نشده است.</p>
        <dl>${details.map(([key, value]) => `<div class="gm10-data-row"><dt><code>${escapeHtml(key)}</code></dt><dd>${escapeHtml(value === undefined ? 'در پاسخ API وجود ندارد' : JSON.stringify(value))}</dd></div>`).join('')}</dl>
        <h3>نام قابلیت‌ها از ماتریس API</h3>
        <ul>${features.map(key => `<li>${escapeHtml(featureName(key))} <code>${escapeHtml(key)}</code></li>`).join('')}</ul>
      </div>`;
    if (global.GMApp && typeof global.GMApp.openDrawer === 'function') {
      global.GMApp.openDrawer('جزئیات پلن · Control Plane', content, { subtitle: escapeHtml(plan.planCode + ' · ' + plan.version) });
    }
  }

  function openDraftDrawer(planCode, version) {
    const reason = getMutationDisabledReason();
    const plan = getPlan(planCode, version);
    if (!plan || reason) return;
    const currentFeatures = new Set(Array.isArray(plan.includedFeatures) ? plan.includedFeatures : []);
    const matrixFeatures = state.matrix ? state.matrix.featureComparison : [];
    const features = matrixFeatures.length
      ? matrixFeatures
      : Array.from(currentFeatures).map(key => ({ key, nameFa: key }));
    const quotas = plan.quotas && typeof plan.quotas === 'object' && !Array.isArray(plan.quotas) ? plan.quotas : {};
    const quotaControls = Object.entries(quotas).map(([key, value]) => {
      if (!Number.isSafeInteger(Number(value))) return '';
      return `
        <label class="form-group"><span><code>${escapeHtml(key)}</code></span>
          <input class="form-control" type="number" step="1" min="-1" name="quota-${escapeHtml(key)}" data-quota-key="${escapeHtml(key)}" value="${escapeHtml(value)}" required>
        </label>`;
    }).join('');
    const hasUneditableQuota = Object.values(quotas).some(value => !Number.isSafeInteger(Number(value)));
    const quotaSafetyReason = draftQuotaSafety(plan);
    const content = `
      <form id="gm10-draft-form" class="gm10-draft-form" onsubmit="return window.GMViews.GM10.submitDraft(event)">
        <p>فرم از نسخهٔ واقعی ${escapeHtml(plan.planCode)} · ${escapeHtml(plan.version)} پر شده است. نسخهٔ جدید و هر تغییر را خودتان وارد کنید؛ هیچ قیمت یا سهمیه‌ای از پیش پیشنهاد نمی‌شود.</p>
        <div id="gm10-draft-feedback" role="alert" aria-live="assertive"></div>
        <input type="hidden" name="planCode" value="${escapeHtml(plan.planCode)}">
        <label class="form-group"><span>کد نسخهٔ draft <b aria-hidden="true">*</b></span>
          <input class="form-control" name="version" type="text" maxlength="32" required value="${plan.isDraft === true ? escapeHtml(plan.version) : ''}" placeholder="نسخه را وارد کنید">
        </label>
        <label class="form-group"><span>نام پلن</span>
          <input class="form-control" name="nameFa" type="text" maxlength="128" required value="${escapeHtml(plan.nameFa || '')}">
        </label>
        <label class="form-group"><span>شرح</span>
          <textarea class="form-control" name="descriptionFa" maxlength="4000" rows="3">${escapeHtml(plan.descriptionFa || '')}</textarea>
        </label>
        <label class="form-group"><span>قیمت پایهٔ ماهانه (ریال؛ مقدار از API)</span>
          <input class="form-control" name="basePriceMonthlyRials" type="number" min="0" step="1" required value="${escapeHtml(plan.basePriceMonthlyRials)}">
        </label>
        <div class="gm10-form-grid">
          <label class="form-group"><span>شعبهٔ همراه</span><input class="form-control" name="includedBranches" type="number" min="1" step="1" required value="${escapeHtml(plan.includedBranches)}"></label>
          <label class="form-group"><span>دستگاه همراه</span><input class="form-control" name="includedDevices" type="number" min="1" step="1" required value="${escapeHtml(plan.includedDevices)}"></label>
          <label class="form-group"><span>کاربر همراه</span><input class="form-control" name="includedUsers" type="number" min="1" step="1" required value="${escapeHtml(plan.includedUsers)}"></label>
        </div>
        ${quotaSafetyReason ? `<div class="alert alert-warning" role="alert">${escapeHtml(quotaSafetyReason)}</div>` : ''}
        <fieldset><legend>سهمیه‌های API</legend>
          ${quotaControls || '<p>برای این پلن سهمیهٔ قابل‌ویرایشی در پاسخ API ثبت نشده است؛ فیلد تازه‌ای ساخته نمی‌شود.</p>'}
          ${hasUneditableQuota ? '<p class="text-warning">شکل بعضی سهمیه‌ها عدد صحیح نیست؛ برای جلوگیری از تبدیل یا حذف داده، ثبت draft غیرفعال است.</p>' : ''}
        </fieldset>
        <fieldset><legend>قابلیت‌های کاتالوگ API</legend>
          ${features.map(feature => `
            <label class="gm10-feature-option"><input type="checkbox" name="includedFeatures" value="${escapeHtml(feature.key)}" ${currentFeatures.has(feature.key) ? 'checked' : ''}>
              <span>${escapeHtml(feature.nameFa || feature.key)}</span> <code>${escapeHtml(feature.key)}</code></label>`).join('') || '<p>کاتالوگ قابلیت از API خالی است؛ انتخاب قابلیت در دسترس نیست.</p>'}
        </fieldset>
        ${state.matrixError ? '<p class="text-warning">ماتریس نام‌گذاری در دسترس نیست؛ فقط کلیدهای قابلیت همین نسخهٔ API قابل انتخاب‌اند.</p>' : ''}
        <button type="submit" class="btn btn-primary" ${hasUneditableQuota || !features.length || Boolean(quotaSafetyReason) ? 'disabled' : ''}>بررسی و ثبت draft</button>
      </form>`;
    if (global.GMApp && typeof global.GMApp.openDrawer === 'function') {
      global.GMApp.openDrawer(plan.isDraft === true ? 'ویرایش پیش‌نویس پلن' : 'ساخت پیش‌نویس پلن', content, { subtitle: 'ارسال با تأیید، نشست مجاز و idempotency key' });
    }
  }

  function numericField(formData, name, min) {
    const raw = formData.get(name);
    const value = Number(raw);
    if (raw === null || raw === '' || !Number.isSafeInteger(value) || value < min) {
      throw new Error('مقدار «' + name + '» باید عدد صحیح معتبر باشد.');
    }
    return value;
  }

  async function submitDraft(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const feedback = document.getElementById('gm10-draft-feedback');
    const repo = currentRepository();
    if (!repo || typeof repo.createPlanDraft !== 'function') {
      if (feedback) feedback.textContent = 'عملیات draft در repository در دسترس نیست؛ درخواستی ارسال نشد.';
      return false;
    }
    try {
      const formData = new FormData(form);
      const planCode = String(formData.get('planCode') || '');
      const payload = {
        planCode,
        version: String(formData.get('version') || '').trim(),
        nameFa: String(formData.get('nameFa') || '').trim(),
        descriptionFa: String(formData.get('descriptionFa') || ''),
        basePriceMonthlyRials: numericField(formData, 'basePriceMonthlyRials', 0),
        includedBranches: numericField(formData, 'includedBranches', 1),
        includedDevices: numericField(formData, 'includedDevices', 1),
        includedUsers: numericField(formData, 'includedUsers', 1),
        includedFeatures: Array.from(form.querySelectorAll('input[name="includedFeatures"]:checked')).map(input => input.value),
        quotas: {}
      };
      form.querySelectorAll('[data-quota-key]').forEach(input => {
        payload.quotas[input.dataset.quotaKey] = numericField(formData, input.name, -1);
      });
      if (!payload.version || !payload.nameFa) throw new Error('نسخه و نام پلن الزامی است.');
      if (state.access && !state.access.allowed) throw new Error(state.access.reason || 'نشست مجاز برای تغییر پلن وجود ندارد.');
      const signature = JSON.stringify(payload);
      const key = state.pendingDraft && state.pendingDraft.signature === signature
        ? state.pendingDraft.key
        : makeIdempotencyKey();
      state.pendingDraft = { signature, key };
      if (feedback) feedback.textContent = 'در انتظار تأیید نهایی اپراتور…';
      global.GodModeConfirmDialog.show({
        title: 'تأیید ثبت draft پلن',
        severity: 'high',
        message: 'نسخهٔ draft با مقادیر زیر به Control Plane ارسال می‌شود. این کار نسخهٔ منتشرشده و subscription مستأجران را تغییر نمی‌دهد.',
        impactDetails: JSON.stringify(payload, null, 2),
        confirmText: 'ثبت draft در Control Plane',
        onConfirm: async function () {
          try {
            const result = await repo.createPlanDraft(payload, { idempotencyKey: key });
            state.pendingDraft = null;
            state.lastMutationResult = { kind: 'draft', data: result.data };
            if (global.GMApp && typeof global.GMApp.closeDrawer === 'function') global.GMApp.closeDrawer();
            await GM10.load();
          } catch (error) {
            state.pendingDraft = { signature, key };
            if (feedback) feedback.textContent = (error.code ? error.code + ' · ' : '') + error.message;
            throw error;
          }
        }
      });
    } catch (error) {
      if (feedback) feedback.textContent = error.message;
    }
    return false;
  }

  function confirmPublish(planCode, version) {
    const plan = getPlan(planCode, version);
    const draftsForCode = state.plans.filter(item => item.planCode === planCode && item.isDraft === true);
    if (!plan || plan.isDraft !== true || draftsForCode.length !== 1 || getMutationDisabledReason()) return;
    const payload = { planCode, version: plan.version };
    const operationId = planCode + ':' + version;
    const publishSignature = JSON.stringify({ planCode, version });
    const previous = state.pendingPublishes.get(operationId);
    const idempotencyKey = previous && previous.signature === publishSignature ? previous.key : makeIdempotencyKey();
    state.pendingPublishes.set(operationId, { signature: publishSignature, key: idempotencyKey });
    global.GodModeConfirmDialog.show({
      title: 'تأیید انتشار نسخهٔ پلن',
      severity: 'high',
      message: 'با تأیید، Control Plane همین draft را منتشر می‌کند. قیمت و سهمیه از نو محاسبه نمی‌شوند؛ سرور نسخهٔ مؤثر و تعداد اشتراک‌های مرتبط را در نتیجه اعلام می‌کند.',
      impactDetails: JSON.stringify({
        planCode: plan.planCode,
        version: plan.version,
        nameFa: plan.nameFa,
        descriptionFa: plan.descriptionFa,
        basePriceMonthlyRials: plan.basePriceMonthlyRials,
        basePriceMonthlyToman: plan.basePriceMonthlyToman,
        includedBranches: plan.includedBranches,
        includedDevices: plan.includedDevices,
        includedUsers: plan.includedUsers,
        quotas: plan.quotas,
        includedFeatures: plan.includedFeatures,
        effectiveFrom: 'اگر زمان مؤثر ارسال نشود، backend از زمان سرور استفاده می‌کند.'
      }, null, 2),
      confirmText: 'انتشار از طریق Control Plane',
      onConfirm: async function () {
        try {
          const result = await currentRepository().publishPlanDraft(planCode, { idempotencyKey });
          state.pendingPublishes.delete(operationId);
          state.lastMutationResult = { kind: 'published', data: result.data };
          await GM10.load();
        } catch (error) {
          state.pendingPublishes.set(operationId, { signature: publishSignature, key: idempotencyKey });
          if (global.GMApp && typeof global.GMApp.showToast === 'function') {
            global.GMApp.showToast((error.code ? error.code + ' · ' : '') + error.message, 'danger');
          }
          throw error;
        }
      }
    });
  }

  const GM10 = {
    state,
    render: function () {
      return `
        <style>
          .gm10-plan-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,19rem),1fr));gap:1rem;margin-block:1rem}
          .gm10-plan-card .card-body{display:flex;flex-direction:column;gap:.75rem;height:100%}
          .gm10-card-heading,.gm10-source-line,.gm10-actions{display:flex;align-items:center;justify-content:space-between;gap:.65rem;flex-wrap:wrap}
          .gm10-card-heading h2{margin:0}.gm10-card-heading p{margin:.25rem 0 0}
          .gm10-price-block,.gm10-data-grid,.gm10-api-detail{display:grid;gap:.5rem;padding:.75rem;border:1px solid var(--border-default);border-radius:.65rem}
          .gm10-price-block small{display:block;color:var(--text-secondary)}
          .gm10-data-row{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;padding:.4rem 0;border-bottom:1px solid var(--border-subtle)}
          .gm10-data-row:last-child{border-bottom:0}.gm10-feature-list{display:grid;gap:.35rem}
          .gm10-feature-list li,.gm10-feature-option{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
          .gm10-form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:.75rem}
          .gm10-draft-form{display:grid;gap:.85rem}.gm10-draft-form fieldset{display:grid;gap:.55rem;min-width:0}
          .gm10-matrix .table-responsive{overflow:auto}.gm10-matrix td,.gm10-matrix th{white-space:nowrap}
          @media(max-width:36rem){.gm10-actions>*{width:100%}.gm10-data-row{gap:.5rem}.gm10-plan-card .card-body{padding:1rem}}
        </style>
        <div class="page-header gm10-page">
          <div class="page-title-group">
            <nav class="breadcrumb-nav" aria-label="مسیر راهبری"><a href="#gm-02-overview">پیشخوان</a><span aria-hidden="true">/</span><span aria-current="page">پلن‌ها و قیمت‌گذاری</span></nav>
            <h1>قیمت‌گذاری و سهمیه‌های پلتفرم <span class="page-code-badge">GM-10</span></h1>
            <p>کاتالوگ نسخه‌دار، قیمت و سهمیه از Control Plane؛ بدون دادهٔ نمایشی یا تغییر در subscription مستأجر.</p>
          </div>
          <div class="header-actions"><button type="button" class="btn btn-secondary" onclick="window.GMViews.GM10.openPlanCompareDrawer()">مقایسهٔ API</button></div>
        </div>
        <div id="gm10-live-content" aria-live="polite">${renderMainContent()}</div>`;
    },
    afterRender: function () {
      const container = document.getElementById('gm10-live-content');
      if (container && (!state.handler || state.handler.node !== container)) {
        if (state.handler && state.handler.listener) state.handler.node.removeEventListener('click', state.handler.listener);
        const listener = function (event) {
          const button = event.target.closest('[data-gm10-action]');
          if (!button || !container.contains(button)) return;
          const action = button.dataset.gm10Action;
          if (action === 'refresh') GM10.load();
          if (action === 'compare') GM10.openPlanCompareDrawer();
          if (action === 'details') openPlanDetailDrawer(button.dataset.planCode, button.dataset.version);
          if (action === 'new-draft' || action === 'edit-draft') openDraftDrawer(button.dataset.planCode, button.dataset.version);
          if (action === 'publish') confirmPublish(button.dataset.planCode, button.dataset.version);
        };
        container.addEventListener('click', listener);
        state.handler = { node: container, listener };
      }
      if (state.status === 'loading' && !state.loading) GM10.load();
    },
    load: async function () {
      const repo = currentRepository();
      if (!repo || typeof repo.listPlans !== 'function' || typeof repo.getPlanMatrix !== 'function') {
        state.status = 'failed';
        state.error = Object.assign(new Error('CommercialRepository با API پلن‌ها در دسترس نیست.'), { code: 'COMMERCIAL_REPOSITORY_UNAVAILABLE', status: 0 });
        GM10.updateContent();
        return;
      }
      const requestId = ++state.requestId;
      state.loading = true;
      if (!state.plans.length) state.status = 'loading';
      GM10.updateContent();
      const matrixRequest = repo.getPlanMatrix().then(matrix => ({ matrix })).catch(error => ({ matrixError: error }));
      const accessRequest = typeof repo.getPlanMutationAccess === 'function'
        ? repo.getPlanMutationAccess().then(access => ({ access })).catch(error => ({ accessError: error }))
        : Promise.resolve({ access: { allowed: false, reason: 'repository احراز نشست پلتفرم را پشتیبانی نمی‌کند.', code: 'PLATFORM_SESSION_CHECK_UNAVAILABLE' } });
      try {
        const plans = await repo.listPlans();
        const [matrixResult, accessResult] = await Promise.all([matrixRequest, accessRequest]);
        if (requestId !== state.requestId) return;
        state.matrix = matrixResult.matrix || null;
        state.matrixError = matrixResult.matrixError || null;
        state.access = accessResult.access || {
          allowed: false,
          reason: accessResult.accessError && accessResult.accessError.message || 'نشست Control Plane بررسی نشد.',
          code: accessResult.accessError && accessResult.accessError.code || 'PLATFORM_SESSION_CHECK_UNAVAILABLE'
        };
        state.plans = plans;
        state.plansMeta = repo.lastPlansMeta || null;
        state.error = null;
        state.status = plans.length ? 'ready' : 'empty';
      } catch (error) {
        const [matrixResult, accessResult] = await Promise.all([matrixRequest, accessRequest]);
        if (requestId !== state.requestId) return;
        state.matrix = matrixResult.matrix || null;
        state.matrixError = matrixResult.matrixError || null;
        state.access = accessResult.access || {
          allowed: false,
          reason: accessResult.accessError && accessResult.accessError.message || 'نشست Control Plane بررسی نشد.',
          code: accessResult.accessError && accessResult.accessError.code || 'PLATFORM_SESSION_CHECK_UNAVAILABLE'
        };
        state.error = error;
        state.status = 'failed';
      } finally {
        if (requestId === state.requestId) {
          state.loading = false;
          GM10.updateContent();
        }
      }
    },
    updateContent: function () {
      const content = document.getElementById('gm10-live-content');
      if (content) content.innerHTML = renderMainContent();
    },
    openPlanDetailDrawer,
    openPlanCompareDrawer: function () {
      if (!state.matrix) {
        if (global.GMApp && typeof global.GMApp.showToast === 'function') global.GMApp.showToast(state.matrixError ? state.matrixError.message : 'ماتریس API هنوز دریافت نشده است.', 'warning');
        return;
      }
      const content = renderMatrix();
      if (global.GMApp && typeof global.GMApp.openDrawer === 'function') {
        global.GMApp.openDrawer('مقایسهٔ پلن‌ها · API', content, { subtitle: 'دادهٔ واقعی Control Plane' });
      }
    },
    openDraftDrawer,
    submitDraft,
    confirmPublish
  };

  global.renderGM10 = function () { return GM10.render(); };
  global.GMViews = global.GMViews || {};
  global.GMViews.GM10 = GM10;
})(typeof window !== 'undefined' ? window : globalThis);
