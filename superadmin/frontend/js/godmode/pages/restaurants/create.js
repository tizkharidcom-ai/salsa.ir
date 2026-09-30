/**
 * prototype/js/godmode/pages/restaurants/create.js
 *
 * Destination 2: New Restaurant Onboarding Wizard (superadmin.md §8).
 * Simplifies 8-step engineering wizard to 3 clean, human steps:
 *   Step 1: Restaurant & Owner Info
 *   Step 2: Plan & Modules Selection
 *   Step 3: Review & Idempotent Provisioning
 * Automatically advances to Provisioning Progress and redirects to the Restaurant Workspace.
 */

(function (global) {
  'use strict';

  function esc(val) {
    return String(val == null ? '' : val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let wizardState = {
    step: 1, // 1, 2, 3, or 'progress'
    name: '',
    slug: '',
    city: 'تهران',
    mainBranchName: 'شعبه اصلی',
    ownerName: '',
    ownerPhone: '',
    ownerEmail: '',
    planCode: 'growth',
    billingCycle: 'monthly',
    selectedModules: ['pos', 'menu_qr'],
    isSubmitting: false,
    errorMessage: null,
    jobProgress: []
  };

  function slugify(text) {
    return String(text || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || `rest-${Date.now().toString(36)}`;
  }

  async function renderRestaurantNewPage() {
    const commercialRepo = global.CommercialRepository;
    const entitlementsRepo = global.EntitlementsRepository;

    const plans = commercialRepo ? await commercialRepo.listPlans() : [];
    const allModules = entitlementsRepo ? entitlementsRepo.getBusinessModules() : [];

    const currentPlan = plans.find(p => p.code === wizardState.planCode) || plans[1] || { name: 'Growth', priceToman: 3900000 };

    return `
      <div class="godmode-page-container restaurant-create-page" style="max-width: 800px; margin: 0 auto; padding-bottom: 4rem;">
        <!-- Header -->
        <div style="margin-bottom: 2rem; text-align: center;">
          <h1 style="font-size: 1.6rem; font-weight: 800; margin: 0 0 0.5rem 0;">
            راه‌اندازی مجموعه و رستوران جدید
          </h1>
          <p style="font-size: 0.9rem; color: var(--salsa-text-secondary, #666); margin: 0;">
            فرآیند ساده ۳ مرحله‌ای ثبت اطلاعات، انتخاب اشتراک و راه‌اندازی خودکار
          </p>
        </div>

        <!-- Step Indicator -->
        <div class="wizard-stepper" style="display: flex; justify-content: space-between; position: relative; margin-bottom: 2.5rem;">
          <div style="position: absolute; top: 18px; right: 15%; left: 15%; height: 2px; background: var(--salsa-border, #E5E7EB); z-index: 1;"></div>
          
          <div class="step-node step-1 ${wizardState.step >= 1 ? 'step-active' : ''}" style="position: relative; z-index: 2; text-align: center; flex: 1;">
            <div style="width: 36px; height: 36px; border-radius: 50%; background: ${wizardState.step >= 1 ? '#2563EB' : '#F3F4F6'}; color: ${wizardState.step >= 1 ? '#FFF' : '#666'}; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; margin-bottom: 0.35rem;">
              ۱
            </div>
            <div style="font-size: 0.8rem; font-weight: 600;">مشخصات مجموعه</div>
          </div>

          <div class="step-node step-2 ${wizardState.step >= 2 ? 'step-active' : ''}" style="position: relative; z-index: 2; text-align: center; flex: 1;">
            <div style="width: 36px; height: 36px; border-radius: 50%; background: ${wizardState.step >= 2 ? '#2563EB' : '#F3F4F6'}; color: ${wizardState.step >= 2 ? '#FFF' : '#666'}; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; margin-bottom: 0.35rem;">
              ۲
            </div>
            <div style="font-size: 0.8rem; font-weight: 600;">پلن و ماژول‌ها</div>
          </div>

          <div class="step-node step-3 ${wizardState.step >= 3 ? 'step-active' : ''}" style="position: relative; z-index: 2; text-align: center; flex: 1;">
            <div style="width: 36px; height: 36px; border-radius: 50%; background: ${wizardState.step >= 3 ? '#2563EB' : '#F3F4F6'}; color: ${wizardState.step >= 3 ? '#FFF' : '#666'}; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; margin-bottom: 0.35rem;">
              ۳
            </div>
            <div style="font-size: 0.8rem; font-weight: 600;">بازبینی و ایجاد</div>
          </div>
        </div>

        ${wizardState.errorMessage ? `
          <div class="alert alert-danger" style="margin-bottom: 1.5rem;" role="alert">
            ${esc(wizardState.errorMessage)}
          </div>
        ` : ''}

        <!-- Wizard Step 1: Basic Info -->
        ${wizardState.step === 1 ? `
          <div class="card" style="padding: 1.75rem; border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB);">
            <h2 style="font-size: 1.1rem; font-weight: 700; margin-top: 0; margin-bottom: 1.25rem;">گام ۱ — اطلاعات اصلی مجموعه و مالک</h2>
            
            <div class="form-group" style="margin-bottom: 1.25rem;">
              <label style="display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.4rem;">
                نام مجموعه / رستوران <span class="text-danger">*</span>
              </label>
              <input type="text"
                     class="form-control"
                     placeholder="مثال: کافه رستوران وستو"
                     value="${esc(wizardState.name)}"
                     oninput="window.GodModeNewRestaurant ? window.GodModeNewRestaurant.setName(this.value) : null"
                     style="width: 100%; font-size: 0.95rem;" required />
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem;">
              <div class="form-group">
                <label style="display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.4rem;">
                  شهر محل فعالیت
                </label>
                <input type="text"
                       class="form-control"
                       value="${esc(wizardState.city)}"
                       oninput="window.GodModeNewRestaurant ? window.GodModeNewRestaurant.setCity(this.value) : null"
                       style="width: 100%; font-size: 0.95rem;" />
              </div>

              <div class="form-group">
                <label style="display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.4rem;">
                  نام شعبه اول
                </label>
                <input type="text"
                       class="form-control"
                       value="${esc(wizardState.mainBranchName)}"
                       oninput="window.GodModeNewRestaurant ? window.GodModeNewRestaurant.setMainBranch(this.value) : null"
                       style="width: 100%; font-size: 0.95rem;" />
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem;">
              <div class="form-group">
                <label style="display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.4rem;">
                  نام و نام خانوادگی مدیر/مالک <span class="text-danger">*</span>
                </label>
                <input type="text"
                       class="form-control"
                       placeholder="مثال: علی اکبری"
                       value="${esc(wizardState.ownerName)}"
                       oninput="window.GodModeNewRestaurant ? window.GodModeNewRestaurant.setOwnerName(this.value) : null"
                       style="width: 100%; font-size: 0.95rem;" required />
              </div>

              <div class="form-group">
                <label style="display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.4rem;">
                  شماره موبایل مدیر (جهت ورود و ارسال دعوت) <span class="text-danger">*</span>
                </label>
                <input type="tel"
                       class="form-control"
                       placeholder="۰۹۱۲۰۰۰۰۰۰۰"
                       value="${esc(wizardState.ownerPhone)}"
                       oninput="window.GodModeNewRestaurant ? window.GodModeNewRestaurant.setOwnerPhone(this.value) : null"
                       style="width: 100%; font-size: 0.95rem; direction: ltr; text-align: right;" required />
              </div>
            </div>

            <div class="form-group" style="margin-bottom: 1.5rem;">
              <label style="display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.4rem;">
                ایمیل اختصاصی مدیر (اختیاری)
              </label>
              <input type="email"
                     class="form-control"
                     placeholder="admin@myrestaurant.ir"
                     value="${esc(wizardState.ownerEmail)}"
                     oninput="window.GodModeNewRestaurant ? window.GodModeNewRestaurant.setOwnerEmail(this.value) : null"
                     style="width: 100%; font-size: 0.95rem; direction: ltr; text-align: right;" />
            </div>

            <!-- Advanced options collapsed by default -->
            <details style="margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed var(--salsa-border, #E5E7EB); font-size: 0.85rem;">
              <summary style="cursor: pointer; color: var(--salsa-text-muted, #666); font-weight: 600;">تنظیمات پیشرفته شناسه و دامنه (Advanced)</summary>
              <div style="margin-top: 0.75rem;">
                <label style="display: block; margin-bottom: 0.35rem;">شناسه یکتای سیستمی (Slug):</label>
                <input type="text"
                       class="form-control"
                       value="${esc(wizardState.slug || slugify(wizardState.name))}"
                       oninput="window.GodModeNewRestaurant ? window.GodModeNewRestaurant.setSlug(this.value) : null"
                       style="direction: ltr; font-family: var(--font-mono); width: 100%; font-size: 0.85rem;" />
                <span style="font-size: 0.75rem; color: #888;">دامنه پیش‌فرض: ${esc(wizardState.slug || slugify(wizardState.name))}.salsa.ir</span>
              </div>
            </details>

            <div style="display: flex; justify-content: flex-end; margin-top: 2rem;">
              <button type="button" class="btn btn-primary" onclick="window.GodModeNewRestaurant ? window.GodModeNewRestaurant.goToStep2() : null">
                ادامه به انتخاب پلن و ماژول‌ها ←
              </button>
            </div>
          </div>
        ` : ''}

        <!-- Wizard Step 2: Plan & Modules Selection -->
        ${wizardState.step === 2 ? `
          <div class="card" style="padding: 1.75rem; border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB);">
            <h2 style="font-size: 1.1rem; font-weight: 700; margin-top: 0; margin-bottom: 1.25rem;">گام ۲ — انتخاب پلن و ماژول‌های تجاری</h2>
            
            <div style="margin-bottom: 1.5rem;">
              <label style="display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.6rem;">
                پلن اشتراک
              </label>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
                ${plans.map(p => {
                  const isSelected = wizardState.planCode === p.code;
                  return `
                    <div class="plan-card ${isSelected ? 'plan-selected' : ''}"
                         onclick="window.GodModeNewRestaurant ? window.GodModeNewRestaurant.setPlan('${esc(p.code)}') : null"
                         style="border: 2px solid ${isSelected ? '#2563EB' : 'var(--salsa-border, #E5E7EB)'}; background: ${isSelected ? 'rgba(37, 99, 235, 0.04)' : '#FFF'}; border-radius: 10px; padding: 1rem; cursor: pointer; text-align: center;">
                      <strong style="display: block; font-size: 1rem; margin-bottom: 0.25rem;">${esc(p.name)}</strong>
                      <div style="font-size: 1.1rem; font-weight: 800; color: #2563EB; margin-bottom: 0.35rem;">
                        ${(p.priceToman || 0).toLocaleString('fa-IR')} <span style="font-size: 0.75rem; font-weight: normal;">تومان / ماه</span>
                      </div>
                      <p style="font-size: 0.75rem; color: #666; margin: 0;">${esc(p.description || '')}</p>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>

            <div style="margin-bottom: 1.5rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
                <label style="display: block; font-size: 0.85rem; font-weight: 600; margin: 0;">
                  ماژول‌های تجاری و قابلیت‌های وستو (Modular Capabilities)
                </label>
                <div style="display: flex; gap: 0.4rem;">
                  <button type="button" class="btn btn-ghost btn-xs" onclick="window.GodModeNewRestaurant ? window.GodModeNewRestaurant.selectAllModules() : null">
                    ✓ انتخاب همه
                  </button>
                  <button type="button" class="btn btn-ghost btn-xs" onclick="window.GodModeNewRestaurant ? window.GodModeNewRestaurant.selectDefaultModules() : null">
                    ماژول‌های پایه
                  </button>
                  <button type="button" class="btn btn-ghost btn-xs" onclick="window.GodModeNewRestaurant ? window.GodModeNewRestaurant.clearAllModules() : null">
                    پاک‌کردن
                  </button>
                </div>
              </div>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 0.75rem;">
                ${allModules.map(m => {
                  const isChecked = wizardState.selectedModules.includes(m.key);
                  return `
                    <label style="display: flex; align-items: flex-start; gap: 0.6rem; padding: 0.75rem 0.85rem; border: 1px solid ${isChecked ? 'var(--primary, #2563EB)' : 'var(--salsa-border, #E5E7EB)'}; background: ${isChecked ? 'rgba(37, 99, 235, 0.04)' : '#FFF'}; border-radius: 8px; cursor: pointer; font-size: 0.85rem; transition: border-color 0.2s, background-color 0.2s;">
                      <input type="checkbox"
                             ${isChecked ? 'checked' : ''}
                             style="margin-top: 3px;"
                             onchange="window.GodModeNewRestaurant ? window.GodModeNewRestaurant.toggleModule('${esc(m.key)}') : null" />
                      <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 0.35rem; margin-bottom: 2px;">
                          <span>${esc(m.icon || '📦')}</span>
                          <strong style="color: var(--text-primary, #111);">${esc(m.nameFa)}</strong>
                        </div>
                        <p style="font-size: 0.75rem; color: #666; margin: 0; line-height: 1.4;">${esc(m.descriptionFa || '')}</p>
                      </div>
                    </label>
                  `;
                }).join('')}
              </div>
            </div>

            <!-- Dynamic Price Summary Banner -->
            <div style="background: var(--salsa-surface-subtle, #F9FAFB); border-radius: 10px; padding: 1rem 1.25rem; margin-top: 1.5rem; display: flex; justify-content: space-between; align-items: center; border: 1px solid var(--salsa-border, #E5E7EB);">
              <div>
                <span style="font-size: 0.8rem; color: #666;">برآورد تعرفه ماهانه اشتراک:</span>
                <strong style="display: block; font-size: 1.2rem; color: #2563EB; font-weight: 800;">
                  ${((currentPlan.priceToman || 3900000) + (wizardState.selectedModules.length * 290000)).toLocaleString('fa-IR')} تومان / ماه
                </strong>
              </div>
              <span class="badge badge-success" style="font-size: 0.8rem;">
                ${wizardState.selectedModules.length} ماژول فعال
              </span>
            </div>

            <div style="display: flex; justify-content: space-between; margin-top: 2rem;">
              <button type="button" class="btn btn-secondary" onclick="window.GodModeNewRestaurant ? window.GodModeNewRestaurant.setStep(1) : null">
                → بازگشت به اطلاعات
              </button>
              <button type="button" class="btn btn-primary" onclick="window.GodModeNewRestaurant ? window.GodModeNewRestaurant.setStep(3) : null">
                ادامه به بازبینی نهایی ←
              </button>
            </div>
          </div>
        ` : ''}

        <!-- Wizard Step 3: Review & Idempotent Submit -->
        ${wizardState.step === 3 ? `
          <div class="card" style="padding: 1.75rem; border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB);">
            <h2 style="font-size: 1.1rem; font-weight: 700; margin-top: 0; margin-bottom: 1.25rem;">گام ۳ — بازبینی نهایی و راه‌اندازی مجموعه</h2>
            
            <div style="background: var(--salsa-surface-subtle, #F9FAFB); border-radius: 10px; padding: 1.25rem; margin-bottom: 1.5rem; font-size: 0.9rem;">
              <div style="display: flex; justify-content: space-between; padding-bottom: 0.6rem; border-bottom: 1px solid var(--salsa-border, #EEE); margin-bottom: 0.6rem;">
                <span style="color: #666;">نام مجموعه:</span>
                <strong>${esc(wizardState.name)}</strong>
              </div>
              <div style="display: flex; justify-content: space-between; padding-bottom: 0.6rem; border-bottom: 1px solid var(--salsa-border, #EEE); margin-bottom: 0.6rem;">
                <span style="color: #666;">شهر و شعبه اصلی:</span>
                <span>${esc(wizardState.city)} — ${esc(wizardState.mainBranchName)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; padding-bottom: 0.6rem; border-bottom: 1px solid var(--salsa-border, #EEE); margin-bottom: 0.6rem;">
                <span style="color: #666;">مدیر / مالک:</span>
                <span>${esc(wizardState.ownerName)} (${esc(wizardState.ownerPhone)})</span>
              </div>
              <div style="display: flex; justify-content: space-between; padding-bottom: 0.6rem; border-bottom: 1px solid var(--salsa-border, #EEE); margin-bottom: 0.6rem;">
                <span style="color: #666;">پلن انتخابی:</span>
                <strong>${esc(currentPlan.name)}</strong>
              </div>
              <div style="display: flex; justify-content: space-between; padding-bottom: 0.6rem; border-bottom: 1px solid var(--salsa-border, #EEE); margin-bottom: 0.6rem;">
                <span style="color: #666;">ماژول‌های انتخابی:</span>
                <span>${wizardState.selectedModules.length > 0 ? `${wizardState.selectedModules.length} ماژول فعال اولیه` : 'فقط ماژول‌های پایه'}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #666;">دامنه پیش‌فرض:</span>
                <span style="direction: ltr; font-family: var(--font-mono);">${esc(wizardState.slug || slugify(wizardState.name))}.salsa.ir</span>
              </div>
            </div>

            <div class="alert alert-info" style="margin-bottom: 1.5rem; font-size: 0.85rem;" role="note">
              با کلیک روی دکمه زیر، ساختار اختصاصی داده‌ها، ایجاد شعبه و دعوت مدیر به صورت خودکار انجام خواهد شد.
            </div>

            <div style="display: flex; justify-content: space-between; margin-top: 1.5rem;">
              <button type="button" class="btn btn-secondary" onclick="window.GodModeNewRestaurant ? window.GodModeNewRestaurant.setStep(2) : null">
                → ویرایش پلن و ماژول‌ها
              </button>
              <button type="button"
                      class="btn btn-primary"
                      id="btn-submit-create-restaurant"
                      ${wizardState.isSubmitting ? 'disabled' : ''}
                      onclick="window.GodModeNewRestaurant ? window.GodModeNewRestaurant.submitCreation() : null">
                ${wizardState.isSubmitting ? '<span class="spinner">⏳</span> در حال راه‌اندازی...' : 'تأیید و ساخت رستوران'}
              </button>
            </div>
          </div>
        ` : ''}

        <!-- Wizard Step: Provisioning Progress Screen (§30 & §31) -->
        ${wizardState.step === 'progress' ? `
          <div class="card" style="padding: 2rem; border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); text-align: center;">
            <div style="font-size: 2.5rem; margin-bottom: 1rem;">${wizardState.jobFailed ? '⚠️' : '⚙️'}</div>
            <h2 style="font-size: 1.2rem; font-weight: 700; margin-bottom: 0.5rem;">
              ${wizardState.jobFailed ? 'خطا در فرآیند راه‌اندازی مجموعه' : 'راه‌اندازی مجموعه در حال انجام است'}
            </h2>
            <p style="font-size: 0.85rem; color: #666; margin-bottom: 1.5rem;">
              ${wizardState.jobFailed ? 'یکی از گام‌های راه‌اندازی با خطا مواجه شد. به لطف معماری گام‌محور (Resumable)، می‌توانید پس از رفع مشکل گام ناموفق را مجدداً اجرا کنید.' : 'مراحل خودکارسازی ایزولاسیون داده‌ها و تنظیمات امنیتی در حال اجرا است.'}
            </p>

            ${wizardState.jobId ? `
              <div style="margin-bottom: 1rem; font-size: 0.75rem; color: #64748b;">
                شناسه جاب راه‌اندازی: <code style="font-family: var(--font-mono);">${esc(wizardState.jobId)}</code>
              </div>
            ` : ''}

            <div style="max-width: 480px; margin: 0 auto; text-align: right; font-size: 0.85rem;">
              ${(wizardState.jobSteps || [
                { name: 'ثبت اطلاعات و شناسه در رجیستری', status: 'completed' },
                { name: 'ایزولاسیون فضای پایگاه داده رستوران', status: 'completed' },
                { name: 'ایجاد شعبه اول و پایانه صندوق', status: 'completed' },
                { name: 'صدور دعوت‌نامه مالک و تخصیص لایسنس', status: 'completed' },
                { name: 'بررسی‌های نهایی آمادگی (Readiness)', status: wizardState.jobFailed ? 'failed' : 'completed' }
              ]).map((step, idx) => `
                <div style="padding: 0.6rem 0; border-bottom: 1px solid #EEE; display: flex; justify-content: space-between; align-items: center;">
                  <span>${idx + 1}. ${esc(step.name || step.stepName || step.title)}</span>
                  <span class="badge ${step.status === 'completed' || step.status === 'succeeded' ? 'badge-success' : (step.status === 'failed' ? 'badge-danger' : (step.status === 'running' ? 'badge-warning' : 'badge-neutral'))}">
                    ${step.status === 'completed' || step.status === 'succeeded' ? 'انجام شد' : (step.status === 'failed' ? 'ناموفق' : (step.status === 'running' ? 'در حال اجرا...' : 'در انتظار'))}
                  </span>
                </div>
              `).join('')}
            </div>

            ${wizardState.jobFailed ? `
              <div class="alert alert-danger" style="margin-top: 1.5rem; text-align: right; font-size: 0.85rem;">
                <strong>علت خطا:</strong> ${esc(wizardState.errorMessage || 'خطای اتصال به کلاستر دیتابیس')}
              </div>
              <div style="margin-top: 1.5rem; display: flex; justify-content: center; gap: 1rem;">
                <button type="button" class="btn btn-warning" onclick="window.GodModeNewRestaurant ? window.GodModeNewRestaurant.retryFailedStep() : null">
                  🔄 تلاش مجدد گام ناموفق (Resume)
                </button>
                <button type="button" class="btn btn-secondary" onclick="window.GodModeNewRestaurant ? window.GodModeNewRestaurant.reset() : null">
                  انصراف و شروع مجدد
                </button>
              </div>
            ` : `
              <div style="margin-top: 2rem; display: flex; justify-content: center; gap: 1rem;">
                <button type="button" class="btn btn-secondary" onclick="window.GodModeNewRestaurant ? window.GodModeNewRestaurant.reset() : null">
                  ➕ ثبت یک مجموعه دیگر
                </button>
                <a href="#restaurants/workspace?id=${esc(wizardState.slug || slugify(wizardState.name))}" class="btn btn-primary" style="padding: 0.6rem 1.5rem;">
                  ورود به پرونده رستوران ←
                </a>
              </div>
            `}
          </div>
        ` : ''}

      </div>
    `;
  }

  const GodModeNewRestaurant = {
    setName(val) {
      wizardState.name = val;
      if (!wizardState.slug) wizardState.slug = slugify(val);
    },
    setCity(val) { wizardState.city = val; },
    setMainBranch(val) { wizardState.mainBranchName = val; },
    setOwnerName(val) { wizardState.ownerName = val; },
    setOwnerPhone(val) { wizardState.ownerPhone = val; },
    setOwnerEmail(val) { wizardState.ownerEmail = val; },
    setSlug(val) { wizardState.slug = slugify(val); },
    setPlan(code) {
      wizardState.planCode = code;
      if (global.GodModeRouter) global.GodModeRouter.handleRoute();
    },
    toggleModule(key) {
      const idx = wizardState.selectedModules.indexOf(key);
      if (idx === -1) wizardState.selectedModules.push(key);
      else wizardState.selectedModules.splice(idx, 1);
      if (global.GodModeRouter) global.GodModeRouter.handleRoute();
    },
    selectAllModules() {
      const entitlementsRepo = global.EntitlementsRepository;
      const allMods = entitlementsRepo ? entitlementsRepo.getBusinessModules() : [];
      wizardState.selectedModules = allMods.map(m => m.key);
      if (global.GodModeRouter) global.GodModeRouter.handleRoute();
    },
    selectDefaultModules() {
      wizardState.selectedModules = ['pos', 'kds', 'menu_qr', 'floor', 'reservations', 'analytics'];
      if (global.GodModeRouter) global.GodModeRouter.handleRoute();
    },
    clearAllModules() {
      wizardState.selectedModules = [];
      if (global.GodModeRouter) global.GodModeRouter.handleRoute();
    },
    setStep(s) {
      wizardState.step = s;
      wizardState.errorMessage = null;
      if (global.GodModeRouter) global.GodModeRouter.handleRoute();
    },
    goToStep2() {
      if (!wizardState.name || !wizardState.name.trim()) {
        wizardState.errorMessage = 'لطفاً نام مجموعه را وارد کنید.';
        if (global.GodModeRouter) global.GodModeRouter.handleRoute();
        return;
      }
      if (!wizardState.ownerName || !wizardState.ownerPhone) {
        wizardState.errorMessage = 'نام و شماره تماس مدیر الزامی است.';
        if (global.GodModeRouter) global.GodModeRouter.handleRoute();
        return;
      }
      const rawPhone = String(wizardState.ownerPhone || '').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[^0-9]/g, '');
      if (!/^09\d{9}$/.test(rawPhone)) {
        wizardState.errorMessage = 'شماره همراه مدیر باید ۱۱ رقم بوده و با ۰۹ شروع شود.';
        if (global.GodModeRouter) global.GodModeRouter.handleRoute();
        return;
      }
      this.setStep(2);
    },
    async submitCreation() {
      if (wizardState.isSubmitting) return;
      wizardState.isSubmitting = true;
      wizardState.errorMessage = null;
      wizardState.jobFailed = false;
      if (global.GodModeRouter) global.GodModeRouter.handleRoute();

      const restRepo = global.RestaurantsRepository;
      const tenantId = wizardState.slug || slugify(wizardState.name);

      try {
        if (restRepo) {
          await restRepo.createDraftTenant({
            tenantId,
            displayName: wizardState.name,
            planCode: wizardState.planCode,
            status: 'provisioning',
            city: wizardState.city,
            ownerName: wizardState.ownerName,
            ownerPhone: wizardState.ownerPhone,
            ownerEmail: wizardState.ownerEmail,
            primaryBranchName: wizardState.mainBranchName,
            selectedModules: wizardState.selectedModules
          });

          // Execute Provisioning
          const res = await restRepo.provisionTenant({
            tenantId,
            displayName: wizardState.name,
            planCode: wizardState.planCode,
            canonicalDomain: `${tenantId}.salsa.ir`,
            ownerEmail: wizardState.ownerEmail || `${tenantId}@salsa.ir`,
            selectedModules: wizardState.selectedModules
          });
          if (res && res.jobId) {
            wizardState.jobId = res.jobId;
          }
        }

        wizardState.isSubmitting = false;
        wizardState.step = 'progress';
        if (global.GMToast) global.GMToast.show(`عملیات راه‌اندازی مجموعه «${wizardState.name}» در صف اجرا قرار گرفت.`, 'info');
        if (global.GodModeRouter) global.GodModeRouter.handleRoute();
      } catch (err) {
        wizardState.isSubmitting = false;
        wizardState.jobFailed = true;
        wizardState.errorMessage = `خطا در ایجاد رستوران: ${err.message}`;
        if (global.GodModeRouter) global.GodModeRouter.handleRoute();
      }
    },
    async retryFailedStep() {
      if (!wizardState.jobId) return;
      const restRepo = global.RestaurantsRepository;
      if (!restRepo) return;
      try {
        await restRepo.retryProvisioningJob(wizardState.jobId);
        wizardState.jobFailed = false;
        wizardState.errorMessage = null;
        if (global.GMToast) global.GMToast.show('گام ناموفق با موفقیت مجدداً در صف اجرا قرار گرفت.', 'info');
        if (global.GodModeRouter) global.GodModeRouter.handleRoute();
      } catch (err) {
        wizardState.errorMessage = `خطا در تلاش مجدد: ${err.message}`;
        if (global.GodModeRouter) global.GodModeRouter.handleRoute();
      }
    },
    reset() {
      wizardState = {
        step: 1,
        name: '',
        slug: '',
        city: 'تهران',
        mainBranchName: 'شعبه اصلی',
        ownerName: '',
        ownerPhone: '',
        ownerEmail: '',
        planCode: 'growth',
        billingCycle: 'monthly',
        selectedModules: ['pos', 'menu_qr'],
        isSubmitting: false,
        errorMessage: null,
        jobProgress: []
      };
      if (global.GodModeRouter) global.GodModeRouter.handleRoute();
    }
  };

  global.GodModeNewRestaurant = GodModeNewRestaurant;

  // Register in Router
  if (global.GodModeRouter) {
    global.GodModeRouter.registerRenderer('restaurant-new', renderRestaurantNewPage);
  }

  global.renderGodModeNewRestaurant = renderRestaurantNewPage;
})(typeof window !== 'undefined' ? window : globalThis);
