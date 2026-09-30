// prototype/js/views/gm15-simulator.js
// GM-15: شبیه‌ساز تصمیم دسترسی (Access Decision Simulator)
// ارزیابی فرمول جامع: Identity + Tenant + Entitlement + Role + Personal Override

window.GMViews = window.GMViews || {};

const operatorizeSimulationText = (value) => String(value || '')
  .replace(/\(Explicit Deny\)/gi, '')
  .replace(/\(Explicit Allow\)/gi, '')
  .replace(/\(Entitlement\)/gi, '')
  .replace(/\(Role Allow\)/gi, '')
  .replace(/\(NOT PersonalDeny\)/gi, '')
  .replace(/\bowner\b/gi, 'مالک مجموعه')
  .replace(/\bactive\b/gi, 'فعال')
  .replace(/\bfinance\.workspace\b/gi, 'حسابداری')
  .replace(/\bfinance\.general\b/gi, 'حسابداری')
  .replace(/\borders\.pos\b/gi, 'صندوق فروشگاهی')
  .replace(/\bcrm\.loyalty\b/gi, 'باشگاه مشتریان')
  .replace(/\bExplicit Deny\b/gi, 'منع صریح')
  .replace(/\bExplicit Allow\b/gi, 'اجازه صریح')
  .replace(/\bRole Allow\b/gi, 'اجازه نقش')
  .replace(/\bNOT PersonalDeny\b/gi, 'نبود منع شخصی')
  .replace(/\s{2,}/g, ' ')
  .trim();

const operatorizeSimulationStep = (step) => String(step || '')
  .replace(/\s*\(Entitlement\)/gi, '')
  .replace(/\s*\(Role Allow\)/gi, '')
  .replace(/\s*\(NOT PersonalDeny\)/gi, '');

window.GMViews.GM15 = {
  lastEvaluation: null,

  render(params) {
    const store = window.prototypeStore || window.GMStore;
    const activeTenantId = params?.id || (store ? store.getActiveTenantId() : 'tnt_westo_demo');
    const tenant = (store && store.getTenant ? store.getTenant(activeTenantId) : null) || { id: activeTenantId, name: 'مجموعه هدف' };
    const identities = store ? store.getIdentities() : [];
    const tenants = store ? store.getTenants() : [];
    const simulatorSource = identities.length || tenants.length ? 'موتور ارزیابی سیاست‌های دسترسی SALSA' : 'بدون داده قابل مشاهده';
    const roleLabels = { owner: 'مالک مجموعه', manager: 'مدیر عملیاتی', accountant: 'حسابدار ارشد', cashier: 'صندوق‌دار' };
    const displayTenantName = (tenant) => String(tenant?.name || 'مجموعه هدف').replace(/\s*\([^)]*\)\s*$/, '');

    // Default canonical test cases (Allow, Explicit Deny, Unentitled Feature)
    const testCases = [
      { userId: 'usr_owner_reza', tenantId: 'tnt_westo_demo', perm: 'orders.void', feat: 'orders.pos', label: 'سناریو ۱: دسترسی مجاز مالک به ابطال سفارش' },
      { userId: 'usr_owner_reza', tenantId: 'tnt_westo_demo', perm: 'finance.export', feat: 'finance.workspace', label: 'سناریو ۲: منع صریح شخصی مالک در خروجی مالی' },
      { userId: 'usr_owner_reza', tenantId: 'tnt_westo_demo', perm: 'crm.loyalty.points', feat: 'crm.loyalty', label: 'سناریو ۳: دسترسی به قابلیت فعال‌نشده' }
    ];

    return `
      <div class="page-header gm15-page">
        <div class="page-title-group">
          <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
            <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
            <span class="breadcrumb-separator">/</span>
            <a href="#gm-04-tenant-detail?id=${tenant.id}" class="breadcrumb-link">پرونده مشتری</a>
            <span class="breadcrumb-separator">/</span>
            <span class="breadcrumb-current" aria-current="page">شبیه‌ساز ارزیابی سیاست</span>
          </nav>
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <h1>
              آزمایش سیاست و دسترسی
              <span class="page-code-badge">GM-15</span>
            </h1>
            <span class="badge badge-scope-tenant"><span class="status-dot dot-active"></span> ${tenant.name}</span>
          </div>
          <p>ارزیابی گام‌به‌گام فرمول ۵ شرطی تصمیم‌گیری امنیتی و عیب‌یابی برخط رد یا تایید درخواست‌ها</p>
        </div>
        <div class="header-actions">
          <button class="btn btn-primary" onclick="simulateAccess()">
            اجرای ارزیابی سیاست
          </button>
          <a href="#gm-14-access-roles" class="btn btn-secondary" title="GM-14: ماتریس دسترسی">
            ماتریس دسترسی
          </a>
        </div>
      </div>

      <div class="data-quality-strip" role="status" aria-label="وضعیت داده‌های شبیه‌ساز دسترسی">
        <div class="data-quality-label"><span class="dq-badge-dot dot-cyan"></span><span>محیط شبیه‌سازی</span></div>
        <div class="data-quality-grid">
          <span class="dq-badge"><span class="dq-badge-dot ${identities.length || tenants.length ? 'dot-blue' : 'dot-purple'}"></span><span class="dq-dim-name">منبع</span><span class="dq-dim-val">${simulatorSource}</span></span>
          <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">دامنه آزمایش</span><span class="dq-dim-val">${identities.length.toLocaleString('fa-IR')} کاربر · ${tenants.length.toLocaleString('fa-IR')} مجموعه</span></span>
          <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">اثر عملیاتی</span><span class="dq-dim-val">فقط خواندنی</span></span>
        </div>
        <span class="dq-action-hint"><span>نتیجه آزمایش توکن یا نشست زنده را تغییر نمی‌دهد</span></span>
      </div>

      <!-- Operational Guidance Banner -->
      <div class="op-context-banner op-context-info" role="region" aria-label="راهنمای عملیاتی شبیه‌ساز سیاست دسترسی">
        <div class="op-context-header">
          <span>شبیه‌ساز امنیتی تصمیم‌گیری دسترسی</span>
          <span class="badge badge-neutral">محیط ارزیابی ایزوله</span>
        </div>
        <div class="op-context-grid">
          <div class="op-context-item">
            <span class="op-context-label">وضعیت جاری:</span>
            <span class="op-context-desc">آزمایش ریاضی ۵ متغیر تصمیم‌گیری امنیتی بدون ایجاد هرگونه تغییر در توکن‌ها یا نشست‌های زنده کاربران.</span>
          </div>
          <div class="op-context-item">
            <span class="op-context-label">تعهد معماری و پیامد:</span>
            <span class="op-context-desc">تصمیم نهایی حاصل ضرب منطقی وضعیت هویت، ایزولاسیون مجموعه، لایسنس ماژول، نقش و اصل تقدم منع صریح است.</span>
          </div>
          <div class="op-context-item">
            <span class="op-context-label">اقدام استاندارد بعدی:</span>
            <span class="op-context-desc">سناریوهای مرزی را با سناریوهای سریع زیر تست کنید؛ در صورت لزوم منع شخصی را در <strong>ماتریس دسترسی</strong> ثبت نمایید.</span>
          </div>
        </div>
      </div>

      <!-- Policy Formula: useful for review, hidden from the primary operator path. -->
      <details class="card progressive-disclosure sim-formula-details" style="margin-bottom: 1.25rem;">
        <summary>
          <span>فرمول تصمیم دسترسی</span>
          <span class="badge badge-neutral">برای بررسی فنی</span>
        </summary>
        <div class="card-body">
          <div class="sim-formula-label">هسته تصمیم‌گیری پنج شرط را به‌ترتیب بررسی می‌کند:</div>
          <div class="sim-formula-code">
            Decision = IdentityActive &amp;&amp; TenantActive &amp;&amp; FeatureEntitled &amp;&amp; (RoleAllow || PersonalAllow) &amp;&amp; !PersonalDeny
          </div>
        </div>
      </details>

      <!-- Simulator Inputs & Results -->
      <div class="grid-cols-2" style="margin-bottom: 1.25rem;">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">پارامترهای ارزیابی درخواست</h3>
          </div>
          <div>
            <form id="simulator-form" onsubmit="window.GMViews.GM15.runSimulation(event)">
              <div class="form-group">
                    <label class="form-label" for="sim-user">کاربر درخواست‌دهنده:</label>
                <select class="form-control" id="sim-user" aria-label="شناسه کاربر" aria-describedby="sim-user-help">
                  ${identities.map(u => `
                    <option value="${u.id}">${u.displayName} — ${roleLabels[u.role] || 'نقش سازمانی'}</option>
                  `).join('')}
                </select>
                <div id="sim-user-help" class="form-helper-text">
                  <span>شناسه کاربر، نقش سازمانی و فعال‌بودن حساب را در فرمول تعیین می‌کند.</span>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label" for="sim-tenant">مجموعه هدف:</label>
                <select class="form-control" id="sim-tenant" aria-label="مجموعه هدف" aria-describedby="sim-tenant-help">
                  ${tenants.map(t => `
                    <option value="${t.id}">${displayTenantName(t)}</option>
                  `).join('')}
                </select>
                <div id="sim-tenant-help" class="form-helper-text">
                  <span>مجموعه‌ای که درخواست عملیاتی در فضای داده‌های ایزوله آن اجرا می‌شود.</span>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label" for="sim-perm">عملیات درخواستی:</label>
                <select class="form-control" id="sim-perm" aria-label="مجوز درخواستی" aria-describedby="sim-perm-help">
                  <option value="finance.export">خروجی اسناد مالی حساس</option>
                  <option value="orders.void">ابطال سفارش و فاکتور</option>
                  <option value="menu.manage">تغییر اقلام و منو</option>
                  <option value="discounts.apply">اعمال تخفیف</option>
                  <option value="crm.loyalty.points">تخصیص امتیاز وفاداری</option>
                  <option value="staff.invite">افزودن پرسنل جدید</option>
                </select>
                <div id="sim-perm-help" class="form-helper-text">
                  <span>مجوز اتمیک مورد نیاز برای اجرای اقدام یا دریافت خروجی داده.</span>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label" for="sim-feature">ماژول مرتبط:</label>
                <select class="form-control" id="sim-feature" aria-label="قابلیت تجاری مرتبط" aria-describedby="sim-feature-help">
                  <option value="finance.workspace">حسابداری دوبل و اسناد دفاتر</option>
                  <option value="orders.pos">صندوق فروشگاهی لمسی</option>
                  <option value="catalog.menu">منوی دیجیتال و دسته‌بندی</option>
                  <option value="crm.loyalty">باشگاه مشتریان و وفاداری</option>
                  <option value="stock.inventory">انبارداری و شمارش موجودی</option>
                </select>
                <div id="sim-feature-help" class="form-helper-text">
                  <span>ماژول تجاری که در صورت غیرفعال بودن لایسنس آن در پلن، درخواست رد خواهد شد.</span>
                </div>
              </div>

              <div class="sim-action-row">
                <button type="submit" id="btnRunSimulation" class="btn btn-primary sim-primary-action">
                  محاسبه نتیجه دسترسی
                </button>
                <button type="button" id="btnResetSimulation" class="btn btn-secondary" onclick="window.GMViews.GM15.resetToWestoDefault()" title="بازنشانی پارامترها به سناریوی استاندارد کافه وستو">
                  بازیابی پیش‌فرض وستو
                </button>
              </div>
            </form>

            <details class="progressive-disclosure sim-scenarios">
              <summary>
                <span>سناریوهای آماده تست سریع</span>
                <span class="badge badge-neutral">۳ سناریو</span>
              </summary>
              <div class="sim-scenario-list">
                ${testCases.map((tc, idx) => `
                  <button type="button" class="btn btn-secondary btn-sm sim-scenario-button" aria-label="بارگذاری سناریو: ${tc.label}" onclick="window.GMViews.GM15.loadTestCase('${tc.userId}', '${tc.tenantId}', '${tc.perm}', '${tc.feat}')">
                    ${idx + 1}. ${tc.label}
                  </button>
                `).join('')}
              </div>
            </details>
          </div>
        </div>

        <!-- Evaluation Results Display -->
        <div class="card" id="sim-result-card" role="region" aria-live="polite" aria-label="نتیجه ارزیابی تصمیم سیاست">
          <div id="sim-live-announcer" class="sr-only" aria-live="assertive" aria-atomic="true"></div>
          <div class="card-header">
            <h3 class="card-title">نتیجه و تفکیک تصمیم‌گیری</h3>
            <div class="card-actions">
              <span id="sim-eval-time" class="badge badge-neutral sim-eval-time-badge">آماده ارزیابی</span>
            </div>
          </div>
          <div id="sim-result-body">
            <div class="sim-empty-state">
              <div class="text-strong text-secondary">پارامترها را انتخاب و دکمه محاسبه را بزنید</div>
              <div class="text-xs text-tertiary">نتیجه بر اساس کاربر، مجموعه، قابلیت و نقش محاسبه می‌شود.</div>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  loadTestCase(userId, tenantId, perm, feat) {
    const uEl = document.getElementById('sim-user');
    const tEl = document.getElementById('sim-tenant');
    const pEl = document.getElementById('sim-perm');
    const fEl = document.getElementById('sim-feature');

    if (uEl) uEl.value = userId;
    if (tEl) tEl.value = tenantId;
    if (pEl) pEl.value = perm;
    if (fEl) fEl.value = feat;
    this.runSimulation();
  },

  resetToWestoDefault() {
    const form = document.getElementById('simulator-form');
    if (window.GMApp && typeof window.GMApp.clearAllErrors === 'function') {
      window.GMApp.clearAllErrors(form);
    }
    const store = window.prototypeStore || window.GMStore;
    if (store && typeof store.setOverride === 'function') {
      store.setOverride('tnt_westo_demo', 'usr_owner_reza', 'orders.void', 'inherit', 'بازنشانی پیش‌فرض');
      store.setOverride('tnt_westo_demo', 'usr_owner_reza', 'finance.export', 'inherit', 'بازنشانی پیش‌فرض');
    }
    this.loadTestCase('usr_owner_reza', 'tnt_westo_demo', 'orders.void', 'orders.pos');
    if (window.GMApp && typeof window.GMApp.showToast === 'function') {
      window.GMApp.showToast('پارامترهای شبیه‌ساز به سناریوی پیش‌فرض کافه وستو بازنشانی شد.', 'info');
    }
  },

  simulateOverride(state) {
    const uEl = document.getElementById('sim-user');
    const tEl = document.getElementById('sim-tenant');
    const pEl = document.getElementById('sim-perm');

    const userId = uEl ? uEl.value : 'usr_owner_reza';
    const tenantId = tEl ? tEl.value : 'tnt_westo_demo';
    const perm = pEl ? pEl.value : 'finance.export';

    const store = window.prototypeStore || window.GMStore;
    const stateFa = state === 'deny' ? 'منع صریح' : (state === 'allow' ? 'اجازه صریح' : 'ارث‌بری از نقش');

    if (store && typeof store.setOverride === 'function') {
      const reason = state === 'deny'
        ? 'منع صریح تستی از شبیه‌ساز GODMODE'
        : state === 'allow'
        ? 'اجازه صریح تستی از شبیه‌ساز GODMODE'
        : 'بازنشانی به ارث‌بری از نقش';
      store.setOverride(tenantId, userId, perm, state, reason);
      if (window.GMApp && typeof window.GMApp.showToast === 'function') {
        window.GMApp.showToast(`وضعیت سیاست به «${stateFa}» تغییر یافت.`, 'info');
      }
    }
    this.runSimulation();

    const announcer = document.getElementById('sim-live-announcer');
    if (announcer) {
      const decisionFa = this.lastEvaluation && this.lastEvaluation.decision === 'ALLOW' ? 'مجاز' : 'رد دسترسی';
      announcer.textContent = `سیاست به «${stateFa}» تنظیم شد. نتیجه محاسبه: ${decisionFa}.`;
    }
  },

  runSimulation(e) {
    if (e) e.preventDefault();

    const uEl = document.getElementById('sim-user');
    const tEl = document.getElementById('sim-tenant');
    const pEl = document.getElementById('sim-perm');
    const fEl = document.getElementById('sim-feature');

    let hasError = false;
    if (uEl && !uEl.value) {
      if (window.GMApp && typeof window.GMApp.setFieldError === 'function') {
        window.GMApp.setFieldError(uEl, 'انتخاب کاربر معتبر الزامی است.');
      }
      hasError = true;
    } else if (uEl && window.GMApp && typeof window.GMApp.clearFieldError === 'function') {
      window.GMApp.clearFieldError(uEl);
    }

    if (tEl && !tEl.value) {
      if (window.GMApp && typeof window.GMApp.setFieldError === 'function') {
        window.GMApp.setFieldError(tEl, 'انتخاب مجموعه الزامی است.');
      }
      hasError = true;
    } else if (tEl && window.GMApp && typeof window.GMApp.clearFieldError === 'function') {
      window.GMApp.clearFieldError(tEl);
    }

    if (pEl && !pEl.value) {
      if (window.GMApp && typeof window.GMApp.setFieldError === 'function') {
        window.GMApp.setFieldError(pEl, 'انتخاب مجوز درخواستی الزامی است.');
      }
      hasError = true;
    } else if (pEl && window.GMApp && typeof window.GMApp.clearFieldError === 'function') {
      window.GMApp.clearFieldError(pEl);
    }

    if (fEl && !fEl.value) {
      if (window.GMApp && typeof window.GMApp.setFieldError === 'function') {
        window.GMApp.setFieldError(fEl, 'انتخاب ماژول قابلیت تجاری الزامی است.');
      }
      hasError = true;
    } else if (fEl && window.GMApp && typeof window.GMApp.clearFieldError === 'function') {
      window.GMApp.clearFieldError(fEl);
    }

    if (hasError) {
      if (window.GMApp && typeof window.GMApp.showToast === 'function') {
        window.GMApp.showToast('لطفاً مقادیر ورودی شبیه‌ساز را به درستی انتخاب نمایید.', 'warning');
      }
      return false;
    }

    const userId = uEl ? uEl.value : 'usr_owner_reza';
    const tenantId = tEl ? tEl.value : 'tnt_westo_demo';
    const perm = pEl ? pEl.value : 'finance.export';
    const feat = fEl ? fEl.value : 'finance.workspace';

    const store = window.prototypeStore || window.GMStore;
    const res = store && store.evaluateAccess ? store.evaluateAccess(userId, tenantId, perm, feat) : {
      decision: 'DENIED',
      reason: 'سیاست امنیتی فعال نیست',
      steps: [],
      override: { state: 'inherit' }
    };
    this.lastEvaluation = res;

    const body = document.getElementById('sim-result-body');
    const timeEl = document.getElementById('sim-eval-time');
    if (timeEl) {
      timeEl.innerHTML = `زمان ارزیابی: ${new Date().toLocaleTimeString('fa-IR')} (بلادرنگ)`;
    }

    if (!body) return;

    const statusBanner = res.decision === 'ALLOW'
      ? `<div class="sim-status-banner-allow">
          <div class="sim-status-title">نتیجه نهایی: مجاز</div>
          <div class="sim-status-desc">درخواست احراز شد و تمام شروط ۵گانه ارزیابی پاس شدند.</div>
        </div>`
      : `<div class="sim-status-banner-deny">
          <div class="sim-status-title">نتیجه نهایی: رد دسترسی</div>
          <div class="sim-status-desc">دسترسی مسدود شد: ${operatorizeSimulationText(res.reason)}</div>
        </div>`;

    const steps = res.steps || [];
    const step0 = steps[0]?.passed ? 1 : 0;
    const step1 = steps[1]?.passed ? 1 : 0;
    const step2 = steps[2]?.passed ? 1 : 0;
    const step3 = steps[3]?.passed ? 1 : 0;
    const isAllow = res.override?.state === 'allow' ? 1 : 0;
    const isDeny = res.override?.state === 'deny' ? 1 : 0;

    body.innerHTML = `
      ${statusBanner}

      <!-- Dynamic Decision Formula Breakdown -->
      <div class="sim-formula-card">
        <div class="sim-formula-title">فرمول تصمیم‌گیری قطعی:</div>
        <div class="sim-formula-code">
          <span class="sim-plain-result">هویت، مجموعه، قابلیت و نقش بررسی شد؛ نتیجه: <strong style="color: ${res.decision === 'ALLOW' ? 'var(--state-success)' : 'var(--state-danger)'};">${res.decision === 'ALLOW' ? 'مجاز' : 'رد دسترسی'}</strong></span>
          <details class="row-disclosure operator-technical-details" style="margin-top: 0.35rem;"><summary>فرمول فنی</summary><code>Decision = ValidIdentity(${step0}) ∧ ValidTenant(${step1}) ∧ Entitlement(${step2}) ∧ (RoleAllow(${step3}) ∨ PersonalAllow(${isAllow})) ∧ ¬ExplicitDeny(${isDeny})</code></details>
        </div>
      </div>

      <div style="margin-top: 0.85rem;">
        <label class="form-label" style="margin-bottom: 0.5rem; font-size: 0.813rem; font-weight: 600; color: var(--text-primary);">گام‌های ارزیابی زنجیره تصمیم:</label>
        
        <div class="kv-list">
          ${steps.map(s => `
            <div class="surface-subtle kv-item" style="padding: 0.6rem 0.85rem; border-right: 3px solid ${s.passed ? 'var(--state-success)' : 'var(--state-danger)'};">
              <div>
                <div class="text-strong text-primary text-sm">${operatorizeSimulationStep(s.step)}</div>
                <div class="text-xs text-secondary" style="margin-top: 0.15rem;">${operatorizeSimulationText(s.detail)}</div>
              </div>
              <span class="badge ${s.passed ? 'badge-success' : 'badge-danger'}">
                ${s.passed ? 'قبول' : 'رد'}
              </span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Quick Override Simulation Buttons -->
      <div class="sim-override-card">
        <div class="sim-override-title">تست مستقیم تنظیم شخصی برای این کاربر و مجوز:</div>
        <div class="sim-override-actions">
          <button type="button" class="btn btn-sm ${res.override && res.override.state === 'deny' ? 'btn-danger active' : 'btn-secondary'}" onclick="window.GMViews.GM15.simulateOverride('deny')" aria-pressed="${res.override && res.override.state === 'deny' ? 'true' : 'false'}" title="تنظیم صریح روی منع">
            منع صریح
          </button>
          <button type="button" class="btn btn-sm ${res.override && res.override.state === 'allow' ? 'btn-success active' : 'btn-secondary'}" onclick="window.GMViews.GM15.simulateOverride('allow')" aria-pressed="${res.override && res.override.state === 'allow' ? 'true' : 'false'}" title="تنظیم صریح روی اجازه">
            اجازه صریح
          </button>
          <button type="button" class="btn btn-sm ${(!res.override || res.override.state === 'inherit') ? 'btn-primary active' : 'btn-secondary'}" onclick="window.GMViews.GM15.simulateOverride('inherit')" aria-pressed="${(!res.override || res.override.state === 'inherit') ? 'true' : 'false'}" title="حذف تنظیم شخصی و بازگشت به ارث‌بری">
            ارث‌بری از نقش
          </button>
          <span class="sim-override-status-label">
            وضعیت جاری: <strong style="color: var(--text-primary);">${res.override && res.override.state === 'deny' ? 'منع صریح' : (res.override && res.override.state === 'allow' ? 'اجازه صریح' : 'ارث‌بری از نقش')}</strong>
          </span>
        </div>
        ${res.impactOnOwner ? `<div class="sim-impact-alert"><span class="status-dot dot-warning" style="margin-left: 0.35rem;"></span>${res.impactOnOwner}</div>` : ''}
      </div>

      <div class="sim-footer-row">
        <a href="#gm-14-access-roles" class="btn btn-secondary btn-sm">
          تنظیم کامل در ماتریس نقش‌ها
        </a>
      </div>
    `;
  }
};

window.renderGM15 = function(params) {
  return window.GMViews.GM15.render(params);
};
