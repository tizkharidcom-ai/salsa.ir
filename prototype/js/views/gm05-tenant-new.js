/**
 * prototype/js/views/gm05-tenant-new.js
 * 
 * GM-05: افزودن مشتری جدید (Flow 1: ویزارد ایجاد مشتری با حساب خام)
 */

let currentWizardStep = 1;
let editingFromStep8 = false;
let wizardData = {
  name: 'کافه وستو (Westo Café)',
  slug: 'westo-new',
  organization: 'مجموعه کافه‌رستوران وستو',
  domain: 'westo-new.salsa.ir',
  plan: 'Growth (رشد)',
  templateCode: 'tpl-blank-cafe-v1',
  cellId: 'cell-teh-01',
  ownerName: 'مالک وستو',
  ownerPhone: '۰۹۱۲۰۰۰۰۰۹۹'
};

// Escaping helper: delegates to the canonical GMPageContracts helper when
// present, with a local inline fallback so this file works standalone too.
// Declared with var: view files share the global script scope, and var
// redeclaration is intentionally tolerated by the platform loading order.
var esc = (typeof window !== 'undefined' && window.GMPageContracts && typeof window.GMPageContracts.escapeHtml === 'function')
  ? window.GMPageContracts.escapeHtml
  : function esc(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };

window.renderGM05 = function(params) {
  if (params && params.plan) {
    wizardData.plan = decodeURIComponent(params.plan);
  }
  if (params && params.template) {
    wizardData.templateCode = decodeURIComponent(params.template);
  }
  editingFromStep8 = false;

  const templates = (window.prototypeStore && window.prototypeStore.state) ? window.prototypeStore.state.templates : [];
  const plans = (window.prototypeStore && window.prototypeStore.state) ? window.prototypeStore.state.plans : [];
  const selectedTemplate = templates.find(template => template.code === wizardData.templateCode);
  const cells = (window.prototypeStore && window.prototypeStore.state && Array.isArray(window.prototypeStore.state.infrastructureCells))
    ? window.prototypeStore.state.infrastructureCells : [];
  const selectedCell = cells.find(cell => cell.id === wizardData.cellId);

  return `
    <div class="page-header gm05-page">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
          <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
          <span class="breadcrumb-separator">/</span>
          <a href="#gm-03-tenants" class="breadcrumb-link">مشتریان</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current" aria-current="page">ایجاد و آنبوردینگ مشتری</span>
        </nav>
        <h1>
          ایجاد مجموعه جدید
        </h1>
        <p>فرآیند ۸ گامی ایجاد حساب با تضمین داده صفر تجاری، سهمیه ایزوله و دعوت امن مالک</p>
      </div>
      <div class="header-actions">
        <button type="button" id="btnResetWizardDefaults" class="btn btn-secondary btn-sm" onclick="window.resetWizardToWestoDefaults()" style="display: none;">
          بازنشانی به مقادیر پیش‌فرض
        </button>
        <a href="#gm-03-tenants" class="btn btn-secondary">
          انصراف و بازگشت
        </a>
      </div>
    </div>

    <!-- Screen Reader Live Notification Region -->
    <div id="wizardAriaLive" class="sr-only" aria-live="polite"></div>

    <div class="wizard-layout">
      <!-- Right Column: Step Navigator -->
      <div class="wizard-steps" role="tablist" aria-label="مراحل فرآیند ایجاد مشتری">
        <div class="step-item ${currentWizardStep === 1 ? 'active' : ''} ${currentWizardStep > 1 ? 'completed' : ''}" 
             role="tab" 
             tabindex="0" 
             aria-selected="${currentWizardStep === 1}" 
             aria-current="${currentWizardStep === 1 ? 'step' : 'false'}" 
             aria-label="گام ۱: نام و سازمان رستوران"
             onclick="setWizardStep(1)"
             onkeydown="if(event.key === ' ' || event.key === 'Enter'){ event.preventDefault(); setWizardStep(1); }">
          <div class="step-number" aria-hidden="true">۱</div>
          <div>نام و سازمان رستوران</div>
        </div>
        <div class="step-item ${currentWizardStep === 2 ? 'active' : ''} ${currentWizardStep > 2 ? 'completed' : ''}" 
             role="tab" 
             tabindex="0" 
             aria-selected="${currentWizardStep === 2}" 
             aria-current="${currentWizardStep === 2 ? 'step' : 'false'}" 
             aria-label="گام ۲: شناسه Slug و دامنه"
             onclick="setWizardStep(2)"
             onkeydown="if(event.key === ' ' || event.key === 'Enter'){ event.preventDefault(); setWizardStep(2); }">
          <div class="step-number" aria-hidden="true">۲</div>
          <div>شناسه Slug و دامنه</div>
        </div>
        <div class="step-item ${currentWizardStep === 3 ? 'active' : ''} ${currentWizardStep > 3 ? 'completed' : ''}" 
             role="tab" 
             tabindex="0" 
             aria-selected="${currentWizardStep === 3}" 
             aria-current="${currentWizardStep === 3 ? 'step' : 'false'}" 
             aria-label="گام ۳: قالب حساب خام (Zero-Data)"
             onclick="setWizardStep(3)"
             onkeydown="if(event.key === ' ' || event.key === 'Enter'){ event.preventDefault(); setWizardStep(3); }">
          <div class="step-number" aria-hidden="true">۳</div>
          <div>قالب حساب خام (Zero-Data)</div>
        </div>
        <div class="step-item ${currentWizardStep === 4 ? 'active' : ''} ${currentWizardStep > 4 ? 'completed' : ''}" 
             role="tab" 
             tabindex="0" 
             aria-selected="${currentWizardStep === 4}" 
             aria-current="${currentWizardStep === 4 ? 'step' : 'false'}" 
             aria-label="گام ۴: انتخاب پلن تجاری"
             onclick="setWizardStep(4)"
             onkeydown="if(event.key === ' ' || event.key === 'Enter'){ event.preventDefault(); setWizardStep(4); }">
          <div class="step-number" aria-hidden="true">۴</div>
          <div>انتخاب پلن تجاری</div>
        </div>
        <div class="step-item ${currentWizardStep === 5 ? 'active' : ''} ${currentWizardStep > 5 ? 'completed' : ''}" 
             role="tab" 
             tabindex="0" 
             aria-selected="${currentWizardStep === 5}" 
             aria-current="${currentWizardStep === 5 ? 'step' : 'false'}" 
             aria-label="گام ۵: میزبانی سرور VPS"
             onclick="setWizardStep(5)"
             onkeydown="if(event.key === ' ' || event.key === 'Enter'){ event.preventDefault(); setWizardStep(5); }">
          <div class="step-number" aria-hidden="true">۵</div>
          <div>میزبانی سرور VPS</div>
        </div>
        <div class="step-item ${currentWizardStep === 6 ? 'active' : ''} ${currentWizardStep > 6 ? 'completed' : ''}" 
             role="tab" 
             tabindex="0" 
             aria-selected="${currentWizardStep === 6}" 
             aria-current="${currentWizardStep === 6 ? 'step' : 'false'}" 
             aria-label="گام ۶: اطلاعات و دعوت مالک"
             onclick="setWizardStep(6)"
             onkeydown="if(event.key === ' ' || event.key === 'Enter'){ event.preventDefault(); setWizardStep(6); }">
          <div class="step-number" aria-hidden="true">۶</div>
          <div>اطلاعات و دعوت مالک</div>
        </div>
        <div class="step-item ${currentWizardStep === 7 ? 'active' : ''} ${currentWizardStep > 7 ? 'completed' : ''}" 
             role="tab" 
             tabindex="0" 
             aria-selected="${currentWizardStep === 7}" 
             aria-current="${currentWizardStep === 7 ? 'step' : 'false'}" 
             aria-label="گام ۷: مرور تعهدات و چک‌لیست"
             onclick="setWizardStep(7)"
             onkeydown="if(event.key === ' ' || event.key === 'Enter'){ event.preventDefault(); setWizardStep(7); }">
          <div class="step-number" aria-hidden="true">۷</div>
          <div>مرور تعهدات و چک‌لیست</div>
        </div>
        <div class="step-item ${currentWizardStep === 8 ? 'active' : ''} ${currentWizardStep > 8 ? 'completed' : ''}" 
             role="tab" 
             tabindex="0" 
             aria-selected="${currentWizardStep === 8}" 
             aria-current="${currentWizardStep === 8 ? 'step' : 'false'}" 
             aria-label="گام ۸: مرور جامع و ساخت نهایی"
             onclick="setWizardStep(8)"
             onkeydown="if(event.key === ' ' || event.key === 'Enter'){ event.preventDefault(); setWizardStep(8); }">
          <div class="step-number" aria-hidden="true">۸</div>
          <div>مرور جامع و ساخت نهایی</div>
        </div>
      </div>

      <!-- Center Column: Step Form Content -->
      <div class="wizard-card">
        <div class="wizard-progress" role="status" aria-live="polite">
          <div class="wizard-progress-copy">
            <span>مسیر ایجاد مشتری</span>
            <strong id="wizardProgressText">گام ${currentWizardStep} از ۸</strong>
          </div>
          <div class="wizard-progress-track" aria-hidden="true">
            <div id="wizardProgressFill" class="wizard-progress-fill" style="width: ${(currentWizardStep / 8) * 100}%;"></div>
          </div>
        </div>
        <div id="wizardStepContainer">
          ${renderStepContent(currentWizardStep, templates, plans)}
        </div>

        <div id="wizardFooterContainer" style="display: flex; justify-content: space-between; align-items: center; margin-top: 2rem; padding-top: 1.25rem; border-top: 1px solid var(--border-subtle);">
          ${renderWizardFooter(currentWizardStep)}
        </div>
      </div>

      <!-- Left Column: Live Service & Domain Summary -->
      <div class="wizard-summary">
        <h4 style="color: var(--text-primary); font-size: 0.875rem; font-weight: 600; margin-bottom: 0.75rem; border-bottom: 1px solid var(--border-subtle); padding-bottom: 0.4rem;">
          خلاصه سرویس و دامنه
        </h4>
        
        <div style="display: flex; flex-direction: column; gap: 0.75rem; font-size: 0.8rem;">
          <div>
            <div style="color: var(--text-tertiary);">نام مجموعه:</div>
            <div style="color: var(--text-primary); font-weight: 700;" id="summaryName">${esc(wizardData.name)}</div>
          </div>

          <div>
            <div style="color: var(--text-tertiary);">دامنه دسترسی اختصاصی:</div>
            <div class="cell-mono" style="color: var(--accent-cyan); font-weight: 600;" id="summaryDomain">${esc(wizardData.domain)}</div>
          </div>

          <div>
            <div style="color: var(--text-tertiary);">قالب تجاری پایه:</div>
            <div style="color: var(--text-primary);" id="summaryTemplate">${esc(selectedTemplate ? selectedTemplate.name : wizardData.templateCode)}</div>
          </div>

          <div>
            <div style="color: var(--text-tertiary);">پلن و هزینه تخمینی:</div>
            <div style="color: var(--state-success); font-weight: 700;" id="summaryPlan">${esc(wizardData.plan)}</div>
          </div>

          <div>
            <div style="color: var(--text-tertiary);">سرور میزبان:</div>
            <div style="color: var(--text-primary);" id="summaryCell">${esc(selectedCell ? selectedCell.name : wizardData.cellId)}</div>
          </div>

          <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid var(--border-success); border-radius: var(--radius-md); padding: 0.65rem;">
            <div style="color: var(--state-success); font-weight: 700; margin-bottom: 0.2rem;">تضمین ایزولاسیون:</div>
            <div style="color: var(--text-secondary); font-size: 0.725rem;">هیچ داده، فاکتور، شماره تماس یا سابقه سفارش از مشتری دیگری وارد این حساب نخواهد شد.</div>
          </div>
        </div>
      </div>
    </div>
  `;
};

function renderStepContent(step, templates, plans) {
  const cells = (window.prototypeStore && window.prototypeStore.state && Array.isArray(window.prototypeStore.state.infrastructureCells))
    ? window.prototypeStore.state.infrastructureCells
    : [];
  const selectedCell = cells.find(cell => cell.id === wizardData.cellId);

  if (step === 1) {
    return `
      <h3 style="color: var(--text-primary); font-size: 1.1rem; font-weight: 800; margin-bottom: 0.5rem;">گام ۱: مشخصات سازمانی رستوران</h3>
      <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 1.5rem;">نام برند تجاری و سازمان دارنده مجوز را وارد کنید.</p>
      
      <div class="form-group">
        <label class="form-label" for="wizName">
          نام تجاری رستوران / کافه
          <span class="field-badge field-required" aria-hidden="true">الزامی</span>
        </label>
        <input type="text" id="wizName" class="form-control" value="${esc(wizardData.name)}" oninput="updateWizardField('name', this.value)" aria-required="true" />
      </div>

      <div class="form-group">
        <label class="form-label" for="wizOrg">
          نام سازمان یا شرکت دارنده مجوز
          <span class="field-badge field-optional" aria-hidden="true">اختیاری</span>
        </label>
        <input type="text" id="wizOrg" class="form-control" value="${esc(wizardData.organization)}" oninput="updateWizardField('organization', this.value)" />
      </div>
    `;
  }

  if (step === 2) {
    return `
      <h3 style="color: var(--text-primary); font-size: 1.1rem; font-weight: 800; margin-bottom: 0.5rem;">گام ۲: شناسه یکتا (Slug) و آدرس دامنه</h3>
      <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 1.5rem;">شناسه یکتا در تمام پلتفرم و روتر دامنه جهت ایزولاسیون کامل ترافیک استفاده می‌شود.</p>
      
      <div class="form-group">
        <label class="form-label" for="wizSlug">
          شناسه یکتا (Slug انگلیسی)
          <span class="field-badge field-required" aria-hidden="true">الزامی</span>
        </label>
        <div class="input-group">
          <input type="text" id="wizSlug" class="form-control cell-mono" value="${esc(wizardData.slug)}" oninput="updateWizardField('slug', this.value)" aria-required="true" style="direction: ltr; text-align: left;" />
          <span class="input-group-addon cell-mono">.salsa.ir</span>
        </div>
        <div class="form-hint">فقط حروف کوچک انگلیسی، ارقام و خط فاصله (بدون فاصله یا کاراکتر خاص)</div>
      </div>

      <div class="form-group">
        <label class="form-label" for="wizDomain">
          ساب‌دامین پلتفرمی اختصاصی
          <span class="field-badge field-optional" aria-hidden="true">تولید خودکار</span>
        </label>
        <div class="input-group">
          <span class="input-group-addon cell-mono">https://</span>
          <input type="text" id="wizDomain" class="form-control cell-mono" value="${esc(wizardData.domain)}" readonly style="background: var(--bg-surface-subtle); color: var(--accent-cyan); direction: ltr; text-align: left;" />
        </div>
        <div class="form-hint">هاست پیش‌فرض مشتری بر روی پلتفرم سالسا؛ مشتری می‌تواند در آینده دامنه اختصاصی خود (مانند order.mycafe.ir) را به این ساب‌دامین متصل کند.</div>
      </div>
    `;
  }

  if (step === 3) {
    return `
      <h3 style="color: var(--text-primary); font-size: 1.1rem; font-weight: 800; margin-bottom: 0.5rem;">گام ۳: انتخاب Template حساب خام تجاری (Zero-Data Seed)</h3>
      <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 1.5rem;">قالب‌های استاندارد شرکتی با تضمین ساختار تمیز و بدون داده‌های تستی؛ پایگاه داده شِمای ایزوله در سرور متمرکز VPS مقداردهی اولیه می‌شود.</p>

      <div id="wizTemplate" role="radiogroup" aria-label="انتخاب قالب حساب خام تجاری" style="display: flex; flex-direction: column; gap: 0.75rem;">
        ${templates.map(tpl => {
          const isSelected = wizardData.templateCode === tpl.code;
          return `
            <div 
              role="radio"
              aria-checked="${isSelected}"
              tabindex="0"
              aria-label="قالب ${tpl.name}"
              class="selectable-card ${isSelected ? 'selected' : ''}"
              style="background: var(--bg-surface-elevated); border: 2px solid ${isSelected ? 'var(--accent-cyan)' : 'var(--border-subtle)'}; border-radius: var(--radius-md); padding: 1rem; cursor: pointer;"
              onclick="selectWizardTemplate('${tpl.code}')"
              onkeydown="if(event.key === ' ' || event.key === 'Enter'){ event.preventDefault(); selectWizardTemplate('${tpl.code}'); }"
            >
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span class="custom-radio-indicator ${isSelected ? 'active' : ''}"></span>
                  <span style="font-weight: 700; color: var(--text-primary);">${tpl.name}</span>
                </div>
                <span class="badge badge-warning"><span class="badge-dot"></span> Fixture؛ داده صفر تأیید نشده</span>
              </div>
              <div style="font-size: 0.78rem; color: var(--text-secondary);">${tpl.description}</div>
              <div class="cell-mono" style="font-size: 0.7rem; color: var(--text-tertiary); margin-top: 0.5rem;">SHA256 Fixture: ${tpl.seedChecksum.slice(0, 24)}... · تأیید تولیدی نشده</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  if (step === 4) {
    return `
      <h3 style="color: var(--text-primary); font-size: 1.1rem; font-weight: 800; margin-bottom: 0.5rem;">گام ۴: انتخاب پلن اشتراک تجاری</h3>
      <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 1.5rem;">پلن تعیین‌کننده سهمیه اولیه شعب، تعداد دستگاه‌ها و پکیج قابلیت‌هاست.</p>

      <div id="wizPlan" role="radiogroup" aria-label="انتخاب پلن اشتراک تجاری" class="grid-cols-2" style="margin-bottom: 0;">
        ${plans.map(p => {
          const isSelected = wizardData.plan.includes(p.name.split(' ')[0]);
          return `
            <div 
              role="radio"
              aria-checked="${isSelected}"
              tabindex="0"
              aria-label="پلن ${p.name} قیمت ${p.price.toLocaleString('fa-IR')} تومان"
              class="selectable-card ${isSelected ? 'selected' : ''}"
              style="background: var(--bg-surface-elevated); border: 2px solid ${isSelected ? 'var(--accent-cyan)' : 'var(--border-subtle)'}; border-radius: var(--radius-md); padding: 1rem; cursor: pointer;"
              onclick="selectWizardPlan('${p.name}')"
              onkeydown="if(event.key === ' ' || event.key === 'Enter'){ event.preventDefault(); selectWizardPlan('${p.name}'); }"
            >
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="font-weight: 700; color: var(--text-primary); font-size: 0.95rem;">${p.name}</div>
                <span class="custom-radio-indicator ${isSelected ? 'active' : ''}"></span>
              </div>
              <div style="font-size: 1.1rem; font-weight: 800; color: var(--accent-cyan); margin: 0.4rem 0;" class="cell-mono">${p.price.toLocaleString('fa-IR')} تومان</div>
              <div style="font-size: 0.75rem; color: var(--text-secondary);">${p.description}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  if (step === 5) {
    return `
      <h3 style="color: var(--text-primary); font-size: 1.1rem; font-weight: 800; margin-bottom: 0.5rem;">گام ۵: تأیید میزبانی روی سرور متمرکز VPS</h3>
      <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 1.5rem;">تمام سرویس‌ها روی سرور اختصاصی متمرکز وستو (Single VPS) اجرا می‌شوند و تفکیک داده‌های مشتری از طریق شِمای ایزوله دیتابیس انجام می‌پذیرد.</p>
      
      <div class="form-group">
        <label class="form-label" for="wizCell">
          سرور میزبان
          <span class="field-badge field-required" aria-hidden="true">الزامی</span>
        </label>
        <select id="wizCell" class="form-control" aria-label="سلول زیرساخت ابری" onchange="updateWizardField('cellId', this.value)">
          ${cells.map(cell => `<option value="${cell.id}"${cell.id === wizardData.cellId ? ' selected' : ''}>${cell.name} · ظرفیت ${cell.tenantsAssigned}/${cell.tenantsCapacity} مستأجر</option>`).join('')}
        </select>
        <div class="form-hint" style="margin-top: 0.4rem; font-size: 0.75rem; color: var(--text-secondary);">
          میزبانی متمرکز روی هاست اصلی وستو با پایش بلادرنگ منابع و پشتیبان‌گیری منظم.
        </div>
      </div>
    `;
  }

  if (step === 6) {
    return `
      <h3 style="color: var(--text-primary); font-size: 1.1rem; font-weight: 800; margin-bottom: 0.5rem;">گام ۶: اطلاعات و دعوت امن مالک رستوران</h3>
      <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 1.5rem;">اطلاعات هویتی مالک جهت ارسال پیامک فعال‌سازی، لینک ورود امن و صدور دسترسی مدیریت ارشد ثبت می‌گردد.</p>
      
      <div class="form-group">
        <label class="form-label" for="wizOwnerName">
          نام و نام خانوادگی مالک
          <span class="field-badge field-required" aria-hidden="true">الزامی</span>
        </label>
        <input type="text" id="wizOwnerName" class="form-control" value="${esc(wizardData.ownerName)}" oninput="updateWizardField('ownerName', this.value)" aria-required="true" />
      </div>

      <div class="form-group">
        <label class="form-label" for="wizOwnerPhone">
          شماره همراه مالک رستوران
          <span class="field-badge field-required" aria-hidden="true">الزامی</span>
        </label>
        <input type="text" id="wizOwnerPhone" class="form-control cell-mono" value="${esc(wizardData.ownerPhone)}" oninput="updateWizardField('ownerPhone', this.value)" aria-required="true" aria-label="شماره همراه مالک رستوران" placeholder="۰۹۱۲۰۰۰۰۰۹۹" />
        <div class="form-hint">شماره همراه مالک جهت ارسال پیامک کد ورود، اعتبارسنجی OTP و لینک دعوت رسمی به پلتفرم.</div>
      </div>
    `;
  }

  if (step === 7) {
    return `
      <h3 style="color: var(--text-primary); font-size: 1.1rem; font-weight: 800; margin-bottom: 0.5rem;">گام ۷: مرور تعهدات ایزولاسیون و پیش‌نیازها</h3>
      <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 1.25rem;">لطفاً پیش از ثبت نهایی، موارد زیر را کنترل نمایید:</p>

      <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        <label for="chkIso1" style="display: flex; gap: 0.6rem; align-items: center; font-size: 0.85rem; color: var(--text-primary); cursor: pointer;">
          <input type="checkbox" id="chkIso1" checked disabled />
          <span>تأیید عدم وجود داده پیش‌فرض، منو یا سفارش قبلی در ساختار حساب</span>
        </label>
        <label for="chkIso2" style="display: flex; gap: 0.6rem; align-items: center; font-size: 0.85rem; color: var(--text-primary); cursor: pointer;">
          <input type="checkbox" id="chkIso2" checked disabled />
          <span>جداسازی کامل کلیدهای رمزنگاری و فضای ذخیره‌سازی ابری</span>
        </label>
        <label for="chkIso3" style="display: flex; gap: 0.6rem; align-items: center; font-size: 0.85rem; color: var(--text-primary); cursor: pointer;">
          <input type="checkbox" id="chkIso3" checked disabled />
          <span>فعال‌سازی لاگ ممیزی تمامی درخواست‌های اپراتور روی این پرونده</span>
        </label>
      </div>
    `;
  }

  if (step === 8) {
    const allErrors = typeof validateAllWizardSteps === 'function' ? validateAllWizardSteps() : [];
    const selectedTemplate = templates ? templates.find(t => t.code === wizardData.templateCode) : null;
    const templateTitle = selectedTemplate ? selectedTemplate.name : 'کافه خام (تضمین ۰ داده)';

    let errorSummaryHtml = '';
    if (allErrors.length > 0) {
      errorSummaryHtml = `
        <div class="form-error-summary" role="alert" aria-live="assertive" id="wizardErrorSummary">
          <div class="form-error-summary-header">
            <span><span class="status-dot dot-warning" style="margin-left: 0.35rem;"></span>پیش از تأیید نهایی، لطفاً ${allErrors.length.toLocaleString('fa-IR')} مورد الزامی زیر را اصلاح فرمایید:</span>
          </div>
          <ul class="form-error-summary-list">
            ${allErrors.map(err => `
              <li>
                <span>گام ${err.step.toLocaleString('fa-IR')}: ${esc(err.message)}</span>
                <button type="button" class="form-error-summary-link" onclick="setWizardStep(${err.step}, true)">
                  (ویرایش در گام ${err.step.toLocaleString('fa-IR')} ←)
                </button>
              </li>
            `).join('')}
          </ul>
        </div>
      `;
    }

    return `
      ${errorSummaryHtml}
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <h3 style="color: var(--text-primary); font-size: 1.1rem; font-weight: 800; margin-bottom: 0.35rem;">گام ۸: مرور جامع پرونده و صف‌بندی کار تحویل</h3>
          <p style="color: var(--text-secondary); font-size: 0.85rem; margin: 0;">اطلاعات واردشده را بازبینی کنید. با کلیک بر روی دکمه ویرایش مستقیم هر بخش، مشخصات اصلاح شده و دکمه بازگشت فوری در دسترس شما خواهد بود.</p>
        </div>
        <span class="badge badge-warning" style="font-size: 0.75rem;"><span class="status-dot dot-amber"></span> استقرار پروداکشن هنوز تأیید نشده</span>
      </div>

      <div class="grid-cols-2" style="margin-top: 1rem; margin-bottom: 1rem; gap: 0.85rem;">
        <!-- Card 1: Identity & Domain -->
        <div style="background: var(--bg-surface-elevated); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem; border-bottom: 1px solid var(--border-subtle); padding-bottom: 0.4rem;">
              <span style="font-weight: 700; color: var(--text-primary); font-size: 0.85rem;">۱. هویت و دامنه اختصاصی</span>
              <span class="badge badge-neutral" style="font-size: 0.7rem;">گام ۱ و ۲</span>
            </div>
            <div style="font-size: 0.8rem; display: flex; flex-direction: column; gap: 0.35rem; color: var(--text-secondary);">
              <div>نام تجاری: <strong style="color: var(--text-primary);" id="revName">${esc(wizardData.name)}</strong></div>
              <div>سازمان دارنده: <span style="color: var(--text-secondary);">${esc(wizardData.organization || '—')}</span></div>
              <div>شناسه یکتا (Slug): <span class="cell-mono" style="color: var(--accent-cyan); font-weight: 600;">${esc(wizardData.slug)}</span></div>
              <div>دامنه اتصال: <span class="cell-mono" style="color: var(--accent-cyan);" id="revDomain">${esc(wizardData.domain)}</span></div>
            </div>
          </div>
          <div style="margin-top: 0.75rem; text-align: left;">
            <button type="button" class="btn btn-secondary btn-xs" id="btnEditStep1" onclick="setWizardStep(1, true)">
              ویرایش مشخصات هویت
            </button>
          </div>
        </div>

        <!-- Card 2: Template & Plan -->
        <div style="background: var(--bg-surface-elevated); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem; border-bottom: 1px solid var(--border-subtle); padding-bottom: 0.4rem;">
              <span style="font-weight: 700; color: var(--text-primary); font-size: 0.85rem;">۲. قالب پایه و پلن اشتراک</span>
              <span class="badge badge-neutral" style="font-size: 0.7rem;">گام ۳ و ۴</span>
            </div>
            <div style="font-size: 0.8rem; display: flex; flex-direction: column; gap: 0.35rem; color: var(--text-secondary);">
              <div>قالب بذر اولیه: <strong style="color: var(--text-primary);">${esc(templateTitle)}</strong></div>
              <div>پلن تجاری: <strong style="color: var(--state-success);" id="revPlan">${esc(wizardData.plan)}</strong></div>
              <div>سیاست ایزولاسیون: <span style="color: var(--state-warning);">سناریوی ایزولاسیون؛ اجرا نشده</span></div>
            </div>
          </div>
          <div style="margin-top: 0.75rem; text-align: left;">
            <button type="button" class="btn btn-secondary btn-xs" id="btnEditStep3" onclick="setWizardStep(3, true)">
              ویرایش قالب یا پلن
            </button>
          </div>
        </div>

        <!-- Card 3: Host VPS & Owner Contact -->
        <div style="background: var(--bg-surface-elevated); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem; border-bottom: 1px solid var(--border-subtle); padding-bottom: 0.4rem;">
              <span style="font-weight: 700; color: var(--text-primary); font-size: 0.85rem;">۳. میزبانی و دعوت امن مالک</span>
              <span class="badge badge-neutral" style="font-size: 0.7rem;">گام ۵ و ۶</span>
            </div>
            <div style="font-size: 0.8rem; display: flex; flex-direction: column; gap: 0.35rem; color: var(--text-secondary);">
              <div>سرور میزبان: <span style="color: var(--text-primary);">${esc(selectedCell ? selectedCell.name : (wizardData.cellId || '—'))}</span></div>
              <div>مالک رستوران: <strong style="color: var(--text-primary);">${esc(wizardData.ownerName)}</strong></div>
              <div>شماره همراه جهت دعوت: <span class="cell-mono" style="color: var(--text-primary); font-weight: 600;">${esc(wizardData.ownerPhone)}</span></div>
            </div>
          </div>
          <div style="margin-top: 0.75rem; text-align: left;">
            <button type="button" class="btn btn-secondary btn-xs" id="btnEditStep6" onclick="setWizardStep(6, true)">
              ویرایش اطلاعات مالک
            </button>
          </div>
        </div>

        <!-- Card 4: Security Guarantees & Readiness -->
        <div style="background: var(--bg-surface-elevated); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem; border-bottom: 1px solid var(--border-subtle); padding-bottom: 0.4rem;">
              <span style="font-weight: 700; color: var(--text-primary); font-size: 0.85rem;">۴. چک‌لیست و امنیت ایزولاسیون</span>
              <span class="badge badge-neutral" style="font-size: 0.7rem;">گام ۷</span>
            </div>
            <div style="font-size: 0.78rem; display: flex; flex-direction: column; gap: 0.35rem; color: var(--text-secondary);">
              <div style="color: var(--state-warning);">! عدم وجود داده، منو یا سفارش قبلی هنوز اثبات نشده</div>
              <div style="color: var(--state-warning);">! تفکیک کلید رمزنگاری و دیتابیس ابری هنوز اجرا نشده</div>
              <div style="color: var(--state-warning);">! ثبت ممیزی Control Plane هنوز در دسترس نیست</div>
            </div>
          </div>
          <div style="margin-top: 0.75rem; text-align: left;">
            <button type="button" class="btn btn-secondary btn-xs" id="btnEditStep7" onclick="setWizardStep(7, true)">
              بازبینی تعهدات
            </button>
          </div>
        </div>
      </div>

      <div class="alert alert-primary" style="margin-top: 1.25rem;">
        <span class="alert-icon">ℹ️</span>
        <div class="alert-content">
          <div class="alert-title">شروع فرآیند تحویل و ایزولاسیون حساب خام</div>
          <div class="alert-description">با فشردن دکمه زیر، کار پس‌زمینه ایجاد حساب خام ساخته شده و بی‌درنگ به مرکز پایش تحویل هدایت می‌شوید.</div>
        </div>
      </div>
    `;
  }
}

function renderWizardFooter(step) {
  return `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 1.5rem; border-top: 1px solid var(--border-subtle); padding-top: 1rem; flex-wrap: wrap; gap: 0.75rem;">
      <div style="display: flex; gap: 0.5rem; align-items: center;">
        ${step > 1 
          ? `<button type="button" class="btn btn-secondary" id="btnPrevWizardStep" onclick="prevWizardStep()">← مرحله قبل</button>`
          : `<span></span>`
        }
        <button type="button" class="btn btn-secondary btn-sm" id="btnResetWizardDefaults" onclick="confirmResetWizardDefaults()" title="پاک کردن اطلاعات واردشده">
          پاک کردن فرم
        </button>
      </div>
      <div style="display: flex; gap: 0.5rem; align-items: center;">
      ${editingFromStep8 && step < 8
        ? `<button type="button" class="btn btn-outline-cyan" id="btnReturnToReview" onclick="returnToStep8Review()">
             بازگشت به مرور نهایی (گام ۸)
           </button>`
        : ''
      }
      ${step < 8 
        ? `<button type="button" class="btn btn-primary" id="btnNextWizardStep" onclick="nextWizardStep()">مرحله بعد →</button>`
        : `<button type="button" class="btn btn-primary text-strong" id="btnSubmitTenantCreation" onclick="submitTenantCreation()" title="GM-06: تحویل و راه‌اندازی حساب">
             <!-- ایجاد حساب خام و شروع تحویل (GM-06) -->
             ایجاد حساب خام و شروع تحویل
             <span class="page-code-badge" style="font-size: 0.688rem; margin: 0 0.35rem;">GM-06</span>
           </button>`
      }
      </div>
    </div>
  `;
}

function confirmResetWizardDefaults() {
  const modalHtml = `
    <div style="padding: 0.5rem 0;">
      <p style="color: var(--text-secondary); margin-bottom: 1.25rem; line-height: 1.6; font-size: 0.875rem;">
        اطلاعات واردشده پاک می‌شود و فرم ایجاد مشتری به حالت اولیه بازمی‌گردد.
      </p>
      <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
        <button type="button" class="btn btn-secondary btn-sm" onclick="window.GMApp && window.GMApp.closeModal ? window.GMApp.closeModal() : null">
          انصراف
        </button>
        <button type="button" class="btn btn-danger btn-sm" id="btnConfirmResetWizard" onclick="window.resetWizardForm(); window.GMApp && window.GMApp.closeModal ? window.GMApp.closeModal() : null;">
          تأیید و بازیابی پیش‌فرض
        </button>
      </div>
    </div>
  `;
  if (window.GMApp && typeof window.GMApp.openModal === 'function') {
    window.GMApp.openModal('تأیید بازنشانی مقادیر ویزارد', modalHtml);
  } else {
    resetWizardForm();
  }
}
window.confirmResetWizardDefaults = confirmResetWizardDefaults;

function resetWizardForm() {
  wizardData = {
    name: '',
    slug: '',
    organization: '',
    domain: '',
    plan: 'Growth (رشد)',
    templateCode: 'tpl-blank-cafe-v1',
    cellId: 'cell-teh-01',
    ownerName: '',
    ownerPhone: ''
  };
  const stepContainer = document.getElementById('wizardStepContainer');
  if (stepContainer && window.GMApp && typeof window.GMApp.clearAllErrors === 'function') {
    window.GMApp.clearAllErrors(stepContainer);
  }
  setWizardStep(currentWizardStep);
  if (window.GMApp && typeof window.GMApp.showToast === 'function') {
    window.GMApp.showToast('فرم مشتری جدید پاک شد.', 'info');
  }
}
window.resetWizardForm = resetWizardForm;

function setWizardStep(step, fromStep8) {
  if (typeof fromStep8 === 'boolean') {
    editingFromStep8 = fromStep8;
  } else if (step === 8) {
    editingFromStep8 = false;
  }
  currentWizardStep = step;
  const container = document.getElementById('wizardStepContainer');
  if (container) {
    const templates = (window.prototypeStore && window.prototypeStore.state) ? window.prototypeStore.state.templates : [];
    const plans = (window.prototypeStore && window.prototypeStore.state) ? window.prototypeStore.state.plans : [];
    container.innerHTML = renderStepContent(currentWizardStep, templates, plans);
  }
  const footerContainer = document.getElementById('wizardFooterContainer');
  if (footerContainer) {
    footerContainer.innerHTML = renderWizardFooter(currentWizardStep);
  }
  document.querySelectorAll('.step-item').forEach((el, idx) => {
    const isCur = idx + 1 === currentWizardStep;
    const isComp = idx + 1 < currentWizardStep;
    el.className = `step-item ${isCur ? 'active' : ''} ${isComp ? 'completed' : ''}`;
    el.setAttribute('aria-selected', isCur ? 'true' : 'false');
    el.setAttribute('aria-current', isCur ? 'step' : 'false');
  });

  const progressText = document.getElementById('wizardProgressText');
  if (progressText) progressText.textContent = `گام ${step} از ۸`;
  const progressFill = document.getElementById('wizardProgressFill');
  if (progressFill) progressFill.style.width = `${(step / 8) * 100}%`;

  const liveEl = document.getElementById('wizardAriaLive');
  if (liveEl) {
    liveEl.textContent = `مرحله ${step} از ۸ فعال گردید.`;
  }
}
window.setWizardStep = setWizardStep;

function returnToStep8Review() {
  editingFromStep8 = false;
  setWizardStep(8);
}
window.returnToStep8Review = returnToStep8Review;

function toEnglishDigits(str) {
  if (!str && str !== 0) return '';
  const fa = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  const ar = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  let res = String(str);
  for (let i = 0; i < 10; i++) {
    res = res.split(fa[i]).join(String(i)).split(ar[i]).join(String(i));
  }
  return res;
}

function validateWizardStep(step) {
  const errors = [];
  if (step === 1) {
    const name = (wizardData.name || '').trim();
    if (!name || name.length < 3) {
      errors.push({ fieldId: 'wizName', step: 1, message: 'نام تجاری رستوران الزامی است و باید حداقل ۳ نویسه باشد.' });
    }
  } else if (step === 2) {
    const slug = (wizardData.slug || '').trim();
    if (!slug || slug.length < 3) {
      errors.push({ fieldId: 'wizSlug', step: 2, message: 'شناسه یکتا (Slug) الزامی است و باید حداقل ۳ نویسه باشد.' });
    } else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      errors.push({ fieldId: 'wizSlug', step: 2, message: 'شناسه یکتا فقط می‌تواند شامل حروف کوچک انگلیسی، ارقام و خط فاصله باشد.' });
    } else {
      const tenants = (window.prototypeStore && window.prototypeStore.state && Array.isArray(window.prototypeStore.state.tenants))
        ? window.prototypeStore.state.tenants : [];
      const domain = String(wizardData.domain || '').trim().toLowerCase();
      const duplicate = tenants.find(tenant => tenant.slug === slug || String(tenant.domain || '').trim().toLowerCase() === domain);
      if (duplicate) {
        errors.push({ fieldId: 'wizSlug', step: 2, message: 'این شناسه یا دامنه قبلاً ثبت شده است؛ مقدار یکتای دیگری انتخاب کنید.' });
      }
    }
  } else if (step === 3) {
    const templates = (window.prototypeStore && window.prototypeStore.state && Array.isArray(window.prototypeStore.state.templates))
      ? window.prototypeStore.state.templates : [];
    const selectedTemplate = templates.find(template => template.code === wizardData.templateCode);
    if (!selectedTemplate || !selectedTemplate.isZeroData || !selectedTemplate.verifiedZeroData) {
      errors.push({ fieldId: 'wizTemplate', step: 3, message: 'یک قالب معتبر و دارای تضمین صفر-داده را انتخاب کنید.' });
    }
  } else if (step === 4) {
    const plans = (window.prototypeStore && window.prototypeStore.state && Array.isArray(window.prototypeStore.state.plans))
      ? window.prototypeStore.state.plans : [];
    if (!plans.some(plan => plan.name === wizardData.plan || plan.id === wizardData.plan)) {
      errors.push({ fieldId: 'wizPlan', step: 4, message: 'یک پلن معتبر از کاتالوگ پلن‌ها را انتخاب کنید.' });
    }
  } else if (step === 5) {
    const cells = (window.prototypeStore && window.prototypeStore.state && Array.isArray(window.prototypeStore.state.infrastructureCells))
      ? window.prototypeStore.state.infrastructureCells : [];
    if (!cells.some(cell => cell.id === wizardData.cellId)) {
      errors.push({ fieldId: 'wizCell', step: 5, message: 'یک سرور زیرساختی معتبر را انتخاب کنید.' });
    }
  } else if (step === 6) {
    const ownerName = (wizardData.ownerName || '').trim();
    if (!ownerName || ownerName.length < 3) {
      errors.push({ fieldId: 'wizOwnerName', step: 6, message: 'نام و نام خانوادگی مالک الزامی است و باید حداقل ۳ نویسه باشد.' });
    }
    const rawPhone = (wizardData.ownerPhone || '').trim();
    const phone = toEnglishDigits(rawPhone);
    if (!phone || !/^09\d{9}$/.test(phone)) {
      errors.push({ fieldId: 'wizOwnerPhone', step: 6, message: 'شماره همراه مالک باید ۱۱ رقم با فرمت ۰۹xxxxxxxxx باشد.' });
    }
  }
  return errors;
}
window.validateWizardStep = validateWizardStep;

function validateAllWizardSteps() {
  return [
    ...validateWizardStep(1),
    ...validateWizardStep(2),
    ...validateWizardStep(3),
    ...validateWizardStep(4),
    ...validateWizardStep(5),
    ...validateWizardStep(6)
  ];
}
window.validateAllWizardSteps = validateAllWizardSteps;

function nextWizardStep() {
  const errors = validateWizardStep(currentWizardStep);
  if (errors.length > 0) {
    errors.forEach(err => {
      const inputEl = document.getElementById(err.fieldId);
      if (inputEl && window.GMApp && typeof window.GMApp.setFieldError === 'function') {
        window.GMApp.setFieldError(inputEl, err.message);
      }
    });
    const firstEl = document.getElementById(errors[0].fieldId);
    if (firstEl && typeof firstEl.focus === 'function') {
      firstEl.focus();
    }
    if (window.GMApp && typeof window.GMApp.showToast === 'function') {
      window.GMApp.showToast('لطفاً خطاهای این مرحله را قبل از رفتن به مرحله بعد برطرف فرمایید.', 'warning');
    }
    return false;
  }
  if (currentWizardStep < 8) {
    setWizardStep(currentWizardStep + 1);
  }
  return true;
}
window.nextWizardStep = nextWizardStep;

function prevWizardStep() {
  if (currentWizardStep > 1) {
    setWizardStep(currentWizardStep - 1);
  }
}
window.prevWizardStep = prevWizardStep;

function updateWizardField(key, val) {
  wizardData[key] = val;
  if (key === 'slug') {
    const cleanSlug = window.GMApp && typeof window.GMApp.sanitizeSlug === 'function' ? window.GMApp.sanitizeSlug(val) : val;
    wizardData.domain = `${cleanSlug || 'domain'}.salsa.ir`;
    const dEl = document.getElementById('wizDomain');
    if (dEl) dEl.value = wizardData.domain;
  }

  // Real-time error clearing on valid input
  const stepErrors = validateWizardStep(currentWizardStep);
  const curFieldHasError = stepErrors.some(e => {
    if (key === 'name' && e.fieldId === 'wizName') return true;
    if (key === 'slug' && e.fieldId === 'wizSlug') return true;
    if (key === 'ownerName' && e.fieldId === 'wizOwnerName') return true;
    if (key === 'ownerPhone' && e.fieldId === 'wizOwnerPhone') return true;
    if (key === 'cellId' && e.fieldId === 'wizCell') return true;
    return false;
  });

  const fieldIdMap = { name: 'wizName', slug: 'wizSlug', ownerName: 'wizOwnerName', ownerPhone: 'wizOwnerPhone', cellId: 'wizCell' };
  const inputEl = document.getElementById(fieldIdMap[key]);
  if (inputEl && !curFieldHasError && window.GMApp && typeof window.GMApp.clearFieldError === 'function') {
    window.GMApp.clearFieldError(inputEl);
  }

  const sName = document.getElementById('summaryName');
  if (sName) sName.textContent = wizardData.name;
  const sDom = document.getElementById('summaryDomain');
  if (sDom) sDom.textContent = wizardData.domain;
  const sCell = document.getElementById('summaryCell');
  if (sCell) {
    const cells = (window.prototypeStore && window.prototypeStore.state && Array.isArray(window.prototypeStore.state.infrastructureCells))
      ? window.prototypeStore.state.infrastructureCells : [];
    sCell.textContent = cells.find(cell => cell.id === wizardData.cellId)?.name || wizardData.cellId || '—';
  }
  const rName = document.getElementById('revName');
  if (rName) rName.textContent = wizardData.name;
  const rDom = document.getElementById('revDomain');
  if (rDom) rDom.textContent = wizardData.domain;
}
window.updateWizardField = updateWizardField;

function selectWizardTemplate(code) {
  wizardData.templateCode = code;
  const tpl = (window.prototypeStore && window.prototypeStore.state) ? window.prototypeStore.state.templates.find(t => t.code === code) : null;
  const sTpl = document.getElementById('summaryTemplate');
  if (sTpl && tpl) sTpl.textContent = tpl.name;
  setWizardStep(3);
}
window.selectWizardTemplate = selectWizardTemplate;

function selectWizardPlan(name) {
  wizardData.plan = name;
  const sPlan = document.getElementById('summaryPlan');
  if (sPlan) sPlan.textContent = name;
  const rPlan = document.getElementById('revPlan');
  if (rPlan) rPlan.textContent = name;
  setWizardStep(4);
}
window.selectWizardPlan = selectWizardPlan;

function submitTenantCreation() {
  const allErrors = validateAllWizardSteps();
  if (allErrors.length > 0) {
    setWizardStep(8);
    const summary = document.getElementById('wizardErrorSummary');
    if (summary && typeof summary.scrollIntoView === 'function') {
      summary.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (window.GMApp && typeof window.GMApp.showToast === 'function') {
      window.GMApp.showToast('فرم دارای خطاهای تکمیل‌نشده است. لطفاً موارد مشخص‌شده را اصلاح فرمایید.', 'error');
    }
    return false;
  }

  const submitBtn = document.getElementById('btnSubmitTenantCreation');
  if (window.GMApp && typeof window.GMApp.setSubmitting === 'function') {
    window.GMApp.setSubmitting(submitBtn, true, 'در حال ایجاد حساب خام و شروع تحویل...');
  }

  const store = window.prototypeStore || window.GMStore;
  const result = store && store.createTenant ? store.createTenant(wizardData) : { tenant: wizardData, job: { id: 'JOB-9021' } };
  if (!result || result.success === false || !result.tenant || !result.job) {
    if (window.GMApp && typeof window.GMApp.setSubmitting === 'function') {
      window.GMApp.setSubmitting(submitBtn, false);
    }
    if (window.GMApp && typeof window.GMApp.showToast === 'function') {
      window.GMApp.showToast(result?.error || 'ایجاد مستأجر انجام نشد. داده‌ها را بررسی و دوباره تلاش کنید.', 'error');
    }
    return false;
  }
  const toastMsg = `مشتری ${result.tenant.name} با موفقیت ثبت شد؛ ساب‌دامین ${result.tenant.slug || 'westo'}.salsa.ir تخصیص یافته و استقرار پایگاه‌داده آغاز گردید.`;
  if (window.GMApp && typeof window.GMApp.showToast === 'function') {
    window.GMApp.showToast(toastMsg, 'success');
  } else if (typeof showToast === 'function') {
    showToast(toastMsg, 'success');
  }
  window.location.hash = `#gm-04-tenant-detail?id=${result.tenant.id}&tab=provisioning&jobId=${result.job.id}`;
  return result;
}
window.submitTenantCreation = submitTenantCreation;

window.resetWizardToWestoDefaults = function() {
  wizardData = {
    name: 'کافه وستو (Westo Café)',
    slug: 'westo',
    organization: 'مجموعه کافه‌رستوران وستو',
    domain: 'westo.salsa.ir',
    plan: 'Enterprise (سراسری)',
    templateCode: 'tpl-blank-cafe-v1',
    cellId: 'cell-teh-01',
    ownerName: 'مالک وستو',
    ownerPhone: '۰۹۱۲۰۰۰۰۰۹۹'
  };
  currentWizardStep = 1;
  const live = document.getElementById('wizardAriaLive');
  if (live) live.textContent = 'فرم ثبت مشتری به مقادیر اولیه بازنشانی شد.';
  if (typeof renderStepIndicator === 'function') renderStepIndicator(1);
  if (typeof updateStepUI === 'function') updateStepUI(1);
};
