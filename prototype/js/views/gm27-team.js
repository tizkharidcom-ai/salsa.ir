/**
 * prototype/js/views/gm27-team.js
 * 
 * GM-27: اعضای تیم پلتفرم NEEM و تنظیمات سیستمی (/team و /settings)
 * مدیریت اپراتورهای مرکزی، حدود اختیارات، الزام عامل دوم (MFA) و سیاست‌های کلی ماندگاری داده
 */

window.renderGM27 = function() {
  const store = window.prototypeStore || window.GMStore;
  const team = store && store.getTeamMembers ? store.getTeamMembers() : [];
  const settings = store && store.getPlatformSettings ? store.getPlatformSettings() : {};
  const teamSource = team.length || Object.keys(settings).length ? 'حافظه محلی Store' : 'بدون تنظیمات قابل مشاهده';
  const roleLabels = {
    owner: 'مالک پلتفرم',
    support_lead: 'سرپرست پشتیبانی',
    infrastructure_ops: 'مسئول زیرساخت'
  };
  const scopeLabels = {
    'all_tenants (نامحدود)': 'همه مشتریان',
    support_tenants: 'مشتریان تحت پشتیبانی',
    cells_infrastructure: 'زیرساخت سلول‌ها'
  };
  const mfaLabels = {
    'active (YubiKey + TOTP)': 'فعال (کلید سخت‌افزاری)',
    'active (TOTP)': 'فعال (کد یک‌بارمصرف)'
  };

  return `
    <div class="page-header gm27-page">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
          <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current" aria-current="page">تیم و تنظیمات</span>
        </nav>
        <h1>
          تیم راهبری و تنظیمات پلتفرم
          <span class="badge badge-scope-global"><span class="status-dot dot-purple"></span> کلان پلتفرم</span>
          <span class="page-code-badge">GM-27</span>
        </h1>
        <p>مدیریت اعضای تیم راهبری NEEM، سطوح دسترسی اپراتورها و پیکربندی‌های سراسری سیستم</p>
      </div>
      <div class="header-actions">
        <button class="btn btn-primary" onclick="window.saveGM27PlatformSettings()">
          ذخیره تغییرات سیاست‌ها
        </button>
        <a href="#gm-26-audit" class="btn btn-secondary">
          تاریخچه ممیزی
        </a>
      </div>
    </div>

    ${window.GMDataState ? window.GMDataState.renderFreshnessBar({
      viewId: 'GM27',
      sourceLabel: 'فهرست پرسنل و تنظیمات سراسری پلتفرم',
      sourceMode: 'local',
      totalCount: team.length,
      countLabel: 'عضو تیم'
    }) : ''}

    <div class="data-quality-strip" role="status" aria-label="وضعیت داده‌های تیم و تنظیمات">
      <div class="data-quality-label"><span class="dq-badge-dot dot-cyan"></span><span>وضعیت تیم و تنظیمات</span></div>
      <div class="data-quality-grid">
        <span class="dq-badge"><span class="dq-badge-dot ${team.length || Object.keys(settings).length ? 'dot-blue' : 'dot-purple'}"></span><span class="dq-dim-name">منبع</span><span class="dq-dim-val">${teamSource}</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">عضو قابل مشاهده</span><span class="dq-dim-val">${team.length.toLocaleString('fa-IR')} نفر</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">تنظیمات</span><span class="dq-dim-val">ویرایش با تأیید اپراتور</span></span>
      </div>
      <span class="dq-action-hint"><span>تغییرات این صفحه بر سیاست‌های سراسری اثر می‌گذارد و باید قبل از انتشار بازبینی شود</span></span>
    </div>

    ${(() => {
      const dataState = window.GMDataState ? window.GMDataState.getViewState('GM27') : { state: 'live' };
      if (dataState.state === 'failed' || dataState.state === 'error') {
        return window.GMDataState.renderErrorState({
          viewId: 'GM27',
          title: 'خطا در بارگذاری اعضای تیم و تنظیمات',
          reason: 'پاسخی از رجیستری اعضای تیم پلتفرم دریافت نشد.',
          errorCode: 'ERR_TEAM_REGISTRY_TIMEOUT'
        });
      }
      if (dataState.state === 'empty') {
        return window.GMDataState.renderEmptyState({
          title: 'عضوی در تیم ثبت نشده است',
          description: 'هیچ عضوی در فهرست کاربران سطح راهبری پلتفرم وجود ندارد.',
          actionLabel: 'افزودن عضو جدید',
          onAction: "window.openGM27InviteModal()"
        });
      }
      if (dataState.state === 'loading') {
        return window.GMDataState.renderSkeleton('table', 4);
      }
      if (dataState.state === 'refreshing') {
        return window.GMDataState.renderRefreshingBanner('GM27');
      }
      if (dataState.state === 'stale') {
        return window.GMDataState.renderStaleBanner('GM27');
      }
      return '';
    })()}

    ${(window.GMDataState && ['failed', 'empty', 'error', 'loading'].includes(window.GMDataState.getViewState('GM27').state)) ? '' : `
    <div class="grid-cols-2" style="margin-bottom: 1.25rem;">
      <!-- Team Members List -->
      <div class="table-wrapper" style="margin-bottom: 0;">
        <div class="table-toolbar">
          <div>
            <div style="font-weight: 600; font-size: 0.875rem; color: var(--text-primary);">اعضای دارای دسترسی به پنل مدیریت NEEM</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.15rem;">تفکیک نقش‌های راهبری، پشتیبانی و زیرساخت</div>
          </div>
        </div>
        <div class="table-responsive">
          <table class="data-table" aria-label="جدول اعضای دارای دسترسی به پنل مدیریت NEEM">
            <thead>
              <tr>
                <th>نام و هویت</th>
                <th>نقش پلتفرم</th>
                <th>دامنه اختیار</th>
                <th>وضعیت MFA</th>
                <th>آخرین فعالیت</th>
              </tr>
            </thead>
            <tbody>
              ${team.map(m => `
                <tr>
                  <td>
                    <strong style="color: var(--text-primary);">${m.name.replace(/\s*\([^)]*\)/, '')}</strong>
                    <div class="cell-mono" style="font-size: 0.75rem; color: #64748b;">${m.email}</div>
                    <details class="row-disclosure team-row-disclosure">
                      <summary>جزئیات فنی عضو</summary>
                      <span class="cell-mono">شناسه: ${m.id} · نقش: ${m.role}</span>
                    </details>
                  </td>
                  <td><span class="badge badge-neutral">${roleLabels[m.role] || m.role}</span></td>
                  <td><span class="badge badge-neutral">${scopeLabels[m.scope] || m.scope}</span></td>
                  <td><span class="badge badge-success"><span class="badge-dot"></span> ${mfaLabels[m.mfaStatus] || 'فعال'}</span></td>
                  <td style="font-size: 0.75rem; color: var(--text-secondary);">${m.lastActive}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Global Platform Settings -->
      <div class="card">
        <div class="card-header">
          <div class="card-title-group">
            <h3 class="card-title">تنظیمات سراسری و سیاست‌های پیش‌فرض</h3>
            <p class="card-subtitle">پارامترهای حاکم بر تمام سلول‌ها و قراردادهای مشتریان</p>
          </div>
        </div>
        <div class="card-body">
          <form onsubmit="window.saveGM27Settings(event)" style="display: flex; flex-direction: column; gap: 0.85rem;">
            <div class="form-group">
              <label class="form-label" for="set-platform-name">
                نام پلتفرم در هدر و اسناد:
                <span class="field-badge field-required" aria-hidden="true">الزامی</span>
              </label>
              <input type="text" id="set-platform-name" class="form-control" value="${settings.platformName || 'مرکز مدیریت پلتفرم NEEM'}" aria-label="نام پلتفرم در هدر و اسناد" aria-required="true" oninput="window.GMApp && window.GMApp.clearFieldError(this)" />
            </div>

            <div class="form-group">
              <label class="form-label" for="set-currency">
                واحد پول رسمی پیش‌فرض:
                <span class="field-badge field-required" aria-hidden="true">الزامی</span>
              </label>
              <input type="text" id="set-currency" class="form-control" value="${settings.defaultCurrency || 'تومان (IRR)'}" aria-label="واحد پول رسمی پیش‌فرض" aria-required="true" oninput="window.GMApp && window.GMApp.clearFieldError(this)" />
            </div>

            <div class="grid-cols-2" style="margin-bottom: 0;">
              <div class="form-group">
                <label class="form-label" for="set-trial-days">
                  مدت تست رایگان (روز):
                  <span class="field-badge field-required" aria-hidden="true">الزامی</span>
                </label>
                <input type="number" id="set-trial-days" class="form-control cell-mono" min="1" max="90" value="${settings.defaultTrialDays || 14}" aria-label="مدت تست رایگان به روز (بین ۱ تا ۹۰)" aria-required="true" oninput="window.GMApp && window.GMApp.clearFieldError(this)" />
                <div class="form-hint">بازه مجاز: ۱ الی ۹۰ روز</div>
              </div>
              <div class="form-group">
                <label class="form-label" for="set-support-ttl">
                  سقف نشست پشتیبانی (دقیقه):
                  <span class="field-badge field-required" aria-hidden="true">الزامی</span>
                </label>
                <input type="number" id="set-support-ttl" class="form-control cell-mono" min="15" max="480" value="${settings.supportSessionMaxMinutes || 120}" aria-label="سقف نشست پشتیبانی به دقیقه (بین ۱۵ تا ۴۸۰)" aria-required="true" oninput="window.GMApp && window.GMApp.clearFieldError(this)" />
                <div class="form-hint">بازه مجاز: ۱۵ الی ۴۸۰ دقیقه</div>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="set-retention">سیاست نگهداری داده‌های مالی پس از لغو قرارداد:</label>
              <input type="text" id="set-retention" class="form-control" value="${settings.dataRetentionYears || 10} سال طبق قانون تجارت الکترونیک و مالیات" readonly aria-label="سیاست نگهداری داده‌های مالی پس از لغو قرارداد" />
            </div>

            <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem; flex-wrap: wrap;">
              <button type="submit" id="btnSaveGM27Settings" class="btn btn-primary" style="flex: 1; justify-content: center;">
                ذخیره تغییرات در تنظیمات پلتفرم
              </button>
              <button type="button" id="btnResetGM27Settings" class="btn btn-secondary" onclick="window.resetGM27Settings()" title="بازنشانی فیلدها به مقادیر پیش‌فرض استاندارد">
                بازیابی پیش‌فرض
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
    `}
  `;
};

window.resetGM27Settings = function() {
  const pName = document.getElementById('set-platform-name');
  const curr = document.getElementById('set-currency');
  const tDays = document.getElementById('set-trial-days');
  const sTtl = document.getElementById('set-support-ttl');

  if (pName) pName.value = 'مرکز مدیریت پلتفرم NEEM';
  if (curr) curr.value = 'تومان (IRR)';
  if (tDays) tDays.value = 14;
  if (sTtl) sTtl.value = 120;

  if (window.GMApp && typeof window.GMApp.clearAllErrors === 'function') {
    window.GMApp.clearAllErrors(document.querySelector('form[onsubmit="window.saveGM27Settings(event)"]'));
  }

  if (window.GMApp && typeof window.GMApp.showToast === 'function') {
    window.GMApp.showToast('تنظیمات به مقادیر پیش‌فرض استاندارد بازنشانی شد.', 'info');
  }
};

window.saveGM27Settings = function(e) {
  if (e) e.preventDefault();
  const store = window.prototypeStore || window.GMStore;
  const platformNameEl = document.getElementById('set-platform-name');
  const trialDaysEl = document.getElementById('set-trial-days');
  const supportTtlEl = document.getElementById('set-support-ttl');
  const submitBtn = document.getElementById('btnSaveGM27Settings');

  const platformName = (platformNameEl ? platformNameEl.value : '').trim();
  const defaultCurrency = document.getElementById('set-currency')?.value || 'تومان (IRR)';
  const defaultTrialDays = parseInt(trialDaysEl ? trialDaysEl.value : '', 10);
  const supportSessionMaxMinutes = parseInt(supportTtlEl ? supportTtlEl.value : '', 10);

  let hasError = false;

  if (!platformName || platformName.length < 3) {
    if (window.GMApp && typeof window.GMApp.setFieldError === 'function') {
      window.GMApp.setFieldError(platformNameEl, 'نام پلتفرم الزامی است و باید حداقل ۳ نویسه باشد.');
    }
    hasError = true;
  } else if (window.GMApp && typeof window.GMApp.clearFieldError === 'function') {
    window.GMApp.clearFieldError(platformNameEl);
  }

  if (isNaN(defaultTrialDays) || defaultTrialDays < 1 || defaultTrialDays > 90) {
    if (window.GMApp && typeof window.GMApp.setFieldError === 'function') {
      window.GMApp.setFieldError(trialDaysEl, 'مدت تست رایگان باید عددی بین ۱ تا ۹۰ روز باشد.');
    }
    hasError = true;
  } else if (window.GMApp && typeof window.GMApp.clearFieldError === 'function') {
    window.GMApp.clearFieldError(trialDaysEl);
  }

  if (isNaN(supportSessionMaxMinutes) || supportSessionMaxMinutes < 15 || supportSessionMaxMinutes > 480) {
    if (window.GMApp && typeof window.GMApp.setFieldError === 'function') {
      window.GMApp.setFieldError(supportTtlEl, 'سقف نشست پشتیبانی باید عددی بین ۱۵ تا ۴۸۰ دقیقه باشد.');
    }
    hasError = true;
  } else if (window.GMApp && typeof window.GMApp.clearFieldError === 'function') {
    window.GMApp.clearFieldError(supportTtlEl);
  }

  if (hasError) {
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast('لطفاً مقادیر نامعتبر مشخص‌شده در فرم را اصلاح فرمایید.', 'warning');
    }
    return false;
  }

  if (window.GMApp && typeof window.GMApp.setSubmitting === 'function') {
    window.GMApp.setSubmitting(submitBtn, true, 'در حال ذخیره‌سازی تنظیمات...');
  }

  setTimeout(() => {
    if (store && store.updatePlatformSettings) {
      store.updatePlatformSettings({
        platformName,
        defaultCurrency,
        defaultTrialDays,
        supportSessionMaxMinutes
      });
    }

    if (window.GMApp && typeof window.GMApp.setSubmitting === 'function') {
      window.GMApp.setSubmitting(submitBtn, false);
    }

    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast('تنظیمات سراسری فقط در Fixture محلی ذخیره شد؛ انتشار روی Control Plane انجام نشده است.', 'info');
    }
  }, 400);

  return true;
};

window.openGM27InviteMemberModal = function() {
  const content = `
    <div style="display: flex; flex-direction: column; gap: 0.85rem;">
      <div>
        <label class="form-label" for="invite-name">
          نام و نام خانوادگی:
          <span class="field-badge field-required" aria-hidden="true">الزامی</span>
        </label>
        <input type="text" id="invite-name" class="form-control" placeholder="مثال: مریم حسینی" aria-label="نام و نام خانوادگی عضو جدید" aria-required="true" />
      </div>
      <div>
        <label class="form-label" for="invite-email">
          ایمیل سازمانی (neem.ir):
          <span class="field-badge field-required" aria-hidden="true">الزامی</span>
        </label>
        <input type="email" id="invite-email" class="form-control cell-mono" placeholder="hosseini@neem.ir" aria-label="ایمیل سازمانی" aria-required="true" />
        <div class="form-hint">آدرس ایمیل پرسنلی معتبر در دامنه neem.ir جهت ارسال کلید امنیتی</div>
      </div>
      <div>
        <label class="form-label" for="invite-role">
          نقش و مسئولیت:
          <span class="field-badge field-required" aria-hidden="true">الزامی</span>
        </label>
        <select id="invite-role" class="form-control" aria-label="نقش و مسئولیت عضو جدید">
          <option>پشتیبان فنی (Support Operator)</option>
          <option>مدیر مالی و اشتراک‌ها (Billing Ops)</option>
          <option>مهندس زیرساخت و سلول‌ها (Infra Ops)</option>
        </select>
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal('افزودن عضو جدید به تیم پلتفرم NEEM', content, () => {
      const nameEl = document.getElementById('invite-name');
      const emailEl = document.getElementById('invite-email');
      const nameVal = (nameEl ? nameEl.value : '').trim();
      const emailVal = (emailEl ? emailEl.value : '').trim().toLowerCase();

      let hasError = false;

      if (!nameVal || nameVal.length < 3) {
        if (window.GMApp && typeof window.GMApp.setFieldError === 'function') {
          window.GMApp.setFieldError(nameEl, 'نام و نام خانوادگی عضو جدید الزامی است (حداقل ۳ نویسه).');
        }
        hasError = true;
      } else if (window.GMApp && typeof window.GMApp.clearFieldError === 'function') {
        window.GMApp.clearFieldError(nameEl);
      }

      if (!emailVal || !emailVal.includes('@')) {
        if (window.GMApp && typeof window.GMApp.setFieldError === 'function') {
          window.GMApp.setFieldError(emailEl, 'لطفاً یک نشانی ایمیل معتبر وارد نمایید.');
        }
        hasError = true;
      } else if (window.GMApp && typeof window.GMApp.clearFieldError === 'function') {
        window.GMApp.clearFieldError(emailEl);
      }

      if (hasError) {
        if (window.GMApp && window.GMApp.showToast) {
          window.GMApp.showToast('لطفاً مشخصات خواسته شده را به طور صحیح تکمیل فرمایید.', 'error');
        }
        return false;
      }

      const roleEl = document.getElementById('invite-role');
      const roleVal = roleEl ? roleEl.value : 'پشتیبان فنی';

      const store = window.prototypeStore || window.GMStore;
      if (store && typeof store.addTeamMember === 'function') {
        store.addTeamMember({
          name: nameVal,
          email: emailVal,
          role: roleVal
        });
      }

      window.GMApp.showToast(`عضو ${nameVal} (${emailVal}) فقط در Fixture محلی ثبت شد؛ دعوت‌نامه یا ایمیل واقعی ارسال نشده است.`, 'info');
      if (window.GMRouter) window.GMRouter.refresh();
      return true;
    });
  }
};
