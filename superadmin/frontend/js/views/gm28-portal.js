/**
 * prototype/js/views/gm28-portal.js
 * 
 * GM-28: پورتال قرارداد و حساب مشتری سازمانی (account.salsa.ir)
 * نمای مشتری‌محور و امن بدون افشای جزئیات داخلی مهندسی (فاقد Cell ID یا Policy Hash)، شامل قرارداد، مصرف، فاکتورها و تحویل داده
 */

window.renderGM28Panel = function(params) {
  const store = params?.store || window.prototypeStore || window.GMStore;
  const tenantFromParams = params?.tenant || null;
  const tenantId = params?.id || tenantFromParams?.id || (store ? store.getActiveTenantId() : 'tnt_westo_demo');
  const tenant = tenantFromParams || (store && store.getTenant ? store.getTenant(tenantId) : null);
  if (!tenant) {
    return `
      <div class="empty-state" role="alert">
        <h2>مشتری در رجیستری Mock یافت نشد</h2>
        <p>شناسهٔ ${tenantId || 'نامشخص'} معتبر نیست؛ دادهٔ مشتری دیگری نمایش داده نمی‌شود.</p>
        <a class="btn btn-secondary" href="#gm-03-tenants">بازگشت به فهرست مشتریان</a>
      </div>
    `;
  }
  const invoices = store && store.getTenantInvoices ? store.getTenantInvoices(tenant.id) : (store && store.getInvoices ? store.getInvoices(tenant.id) : []);
  const subscription = store && store.getTenantSubscription ? store.getTenantSubscription(tenant.id) : null;
  const usage = null;
  const portalSource = invoices.length || subscription ? 'حافظه محلی Store' : 'داده قراردادی قابل مشاهده نیست';

  return `
    <!-- Tenant Executive Summary -->
    <div class="card" style="margin-bottom: 1.25rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
        <div>
          <div style="font-size: 0.75rem; color: var(--text-secondary);">سازمان طرف قرارداد:</div>
          <h2 style="font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin: 0.25rem 0;">${tenant.organization}</h2>
          <div style="font-size: 0.813rem; color: var(--accent-cyan);">دامنه اصلی: <a href="https://${tenant.domain}" target="_blank" style="color: inherit; text-decoration: underline;">${tenant.domain}</a></div>
        </div>
        <div style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;">
          <div style="background: var(--bg-surface-subtle); border: 1px solid var(--border-default); border-radius: 6px; padding: 0.5rem 1rem;">
            <div style="font-size: 0.688rem; color: var(--text-secondary);">پلن تجاری</div>
            <div style="font-weight: 700; color: var(--accent-cyan); font-size: 0.875rem; margin-top: 0.15rem;">${subscription ? subscription.planName : tenant.plan}</div>
          </div>
          <div style="background: var(--bg-surface-subtle); border: 1px solid var(--border-default); border-radius: 6px; padding: 0.5rem 1rem;">
            <div style="font-size: 0.688rem; color: var(--text-secondary);">تمدید بعدی</div>
            <div style="font-weight: 600; font-size: 0.875rem; color: var(--text-primary); margin-top: 0.15rem;">${subscription ? subscription.nextRenewal : '۱۴۰۳/۰۷/۰۱'}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Active Features & Addons for Customer -->
    <div class="grid-cols-2" style="margin-bottom: 1.25rem;">
      <div class="card">
        <div class="card-header">
          <div class="card-title-group">
            <h3 class="card-title">امکانات فعال در بسته تجاری شما</h3>
            <p class="card-subtitle">بر اساس پلن Scale و افزونه‌های اختصاصی خریداری‌شده</p>
          </div>
        </div>
        <div class="card-body">
          <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0.85rem; background: var(--bg-surface-subtle); border: 1px solid var(--border-subtle); border-radius: 6px;">
              <div>
                <strong style="color: var(--text-primary); font-size: 0.813rem;">صندوق لمسی فروشگاهی (POS)</strong>
                <div style="font-size: 0.75rem; color: var(--text-secondary);">سفارش‌گیری، فاکتور و صندوق نقدی</div>
              </div>
              <span class="badge badge-success"><span class="status-dot dot-green"></span> فعال و تحت پوشش اشتراک</span>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0.85rem; background: var(--bg-surface-subtle); border: 1px solid var(--border-subtle); border-radius: 6px;">
              <div>
                <strong style="color: var(--text-primary); font-size: 0.813rem;">نمایشگر سفارشات آشپزخانه (KDS)</strong>
                <div style="font-size: 0.75rem; color: var(--text-secondary);">تفکیک ایستگاه‌های سالن و بار گرم</div>
              </div>
              <span class="badge badge-success"><span class="status-dot dot-green"></span> فعال و در حال سرویس‌دهی</span>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0.85rem; background: var(--bg-surface-subtle); border: 1px solid var(--border-subtle); border-radius: 6px;">
              <div>
                <strong style="color: var(--text-primary); font-size: 0.813rem;">حسابداری دوبل و اسناد دفاتر (Finance V2)</strong>
                <div style="font-size: 0.75rem; color: var(--text-secondary);">اسناد مالی، تراز آزمایشی و سود و زیان</div>
              </div>
              <span class="badge badge-success"><span class="status-dot dot-green"></span> فعال و در حال سرویس‌دهی</span>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0.85rem; background: var(--bg-surface-subtle); border: 1px solid var(--border-subtle); border-radius: 6px;">
              <div>
                <strong style="color: var(--text-primary); font-size: 0.813rem;">انبارداری و بهای تمام‌شده (COGS)</strong>
                <div style="font-size: 0.75rem; color: var(--text-secondary);">مدیریت موجودی و هشدار کسری مواد اولیه</div>
              </div>
              <span class="badge badge-success"><span class="status-dot dot-green"></span> فعال و در حال سرویس‌دهی</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Resource Usage & Support -->
      <div class="card">
        <div class="card-header">
          <div class="card-title-group">
            <h3 class="card-title">سهمیه و مصرف ماهانه مجاز</h3>
            <p class="card-subtitle">میزان استفاده از منابع ابری در دوره جاری</p>
          </div>
        </div>
        <div class="card-body">
          <div style="display: flex; flex-direction: column; gap: 0.85rem;">
            <div class="metric-meter" role="status" aria-label="فضای فایل و دیتابیس مجاز">
              <div class="metric-meter-header">
                <span class="metric-meter-label">فضای فایل و دیتابیس:</span>
                <span class="metric-meter-val" style="color: var(--gm-accent, #1a73e8);">۴.۲ گیگابایت از ۵۰ گیگابایت (۸٪)</span>
              </div>
              <div class="metric-meter-track">
                <div class="metric-meter-fill" style="width: 8%; background: var(--gm-accent, #1a73e8);"></div>
              </div>
            </div>

            <div class="metric-meter" role="status" aria-label="صندوق‌های فعال همزمان">
              <div class="metric-meter-header">
                <span class="metric-meter-label">صندوق‌های فعال همزمان:</span>
                <span class="metric-meter-val" style="color: var(--gm-accent, #1a73e8);">۴ صندوق فعال از ۸ صندوق مجاز (۵۰٪)</span>
              </div>
              <div class="metric-meter-track">
                <div class="metric-meter-fill" style="width: 50%; background: var(--gm-accent, #1a73e8);"></div>
              </div>
            </div>

            <div style="background: var(--accent-cyan-subtle); border: 1px solid var(--border-focus); border-radius: 6px; padding: 0.75rem; font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.5rem; line-height: 1.45; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
              <div>
                <strong style="color: var(--accent-cyan);">پشتیبانی سازمانی:</strong> سطح طلایی با تضمین SLA ۹۹.۹٪ — پاسخ‌گویی ۲۴/۷ فعال
              </div>
              <button type="button" class="btn btn-secondary btn-xs" onclick="window.openCustomerSupportRequestModal('${tenant.id}')">
                ثبت تیکت راهنمایی
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Billing Invoices History -->
    <div class="table-wrapper">
      <div class="table-toolbar">
        <div>
          <div style="font-weight: 600; font-size: 0.875rem; color: var(--text-primary);">فاکتورها و سوابق پرداخت رسمی</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.15rem;">سوابق تسویه‌حساب دوره‌ای و فاکتورهای رسمی صادره</div>
        </div>
      </div>
      <div class="table-responsive">
        <table class="data-table" aria-label="جدول فاکتورها و سوابق پرداخت رسمی">
          <thead>
            <tr>
              <th>سند مالی</th>
              <th>دوره</th>
              <th>مبلغ کل با مالیات</th>
              <th>وضعیت پرداخت</th>
              <th>تاریخ پرداخت</th>
              <th>وضعیت دریافت</th>
              <th class="cell-actions">دریافت سند</th>
            </tr>
          </thead>
          <tbody>
            ${invoices.map(inv => `
              <tr>
                <td>
                  <span class="badge badge-neutral">فاکتور رسمی</span>
                  <details class="row-disclosure portal-row-disclosure">
                    <summary>جزئیات سند</summary>
                    <span class="cell-mono">شماره سند: ${inv.id}</span>
                  </details>
                </td>
                <td style="color: var(--text-secondary);">${inv.period}</td>
                <td class="cell-mono font-bold" style="font-size: 0.813rem; color: var(--state-warning);">— تومان (Fixture)</td>
                <td>
                  ${inv.status === 'paid'
                    ? '<span class="badge badge-warning"><span class="badge-dot"></span> Fixture؛ تسویه تأیید نشده</span>'
                    : '<span class="badge badge-warning"><span class="badge-dot"></span> Fixture؛ وضعیت پرداخت نامشخص</span>'
                  }
                </td>
                <td style="font-size: 0.75rem; color: var(--text-secondary);">${inv.paidAt || '—'}</td>
                <td>
                  <span class="badge badge-warning">Fixture؛ فایل معتبر موجود نیست</span>
                  <details class="row-disclosure portal-row-disclosure">
                    <summary>کد رهگیری</summary>
                    <span class="cell-mono">${inv.paymentRef || '—'}</span>
                  </details>
                </td>
                <td class="cell-actions">
                  <button class="btn btn-secondary btn-sm" onclick="window.GMApp ? window.GMApp.showToast('فایل رسمی صورتحساب PDF با مهر دیجیتال آماده دانلود شد.', 'success') : null" aria-label="دانلود سند مالی">
                    دریافت PDF فاکتور
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
};

// GM-28 remains a backwards-compatible deep link, but its canonical home is
// the matching customer's dossier (GM-04 → قرارداد و پورتال).
window.renderGM28 = function(params) {
  const store = params?.store || window.prototypeStore || window.GMStore;
  const tenantId = params?.id || (store ? store.getActiveTenantId() : 'tnt_westo_demo');
  const tenant = params?.tenant || (store && store.getTenant ? store.getTenant(tenantId) : null);
  if (!tenant) return window.renderGM28Panel(params);

  return `
    <div class="page-header">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر پرونده مشتری">
          <a href="#gm-03-tenants" class="breadcrumb-link">مشتریان</a>
          <span class="breadcrumb-separator">/</span>
          <a href="#gm-04-tenant-detail?id=${tenant.id}&tab=summary" class="breadcrumb-link">${tenant.name}</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current" aria-current="page">قرارداد و پورتال</span>
        </nav>
        <h1>قرارداد و پورتال مشتری: ${tenant.name}<span class="badge badge-scope-tenant"><span class="status-dot dot-active"></span> دامنه مشتری</span></h1>
        <p>سوابق اشتراک، فاکتورها، سهمیه مصرفی و تحویل داده در پرونده همین مشتری نگهداری می‌شود.</p>
      </div>
      <div class="header-actions">
        ${tenant.id === 'tnt_westo_demo' ? `
          <a href="${(typeof GMPageContracts !== 'undefined' && GMPageContracts.westoClientOrigin) ? GMPageContracts.westoClientOrigin.page('/') : 'http://localhost:4180/'}" target="_blank" rel="noopener" class="btn btn-outline-cyan">مشاهده نمای مشتری وستو (۴۱۸۰) ↗</a>
        ` : ''}
        <button class="btn btn-primary" onclick="window.GMApp ? window.GMApp.showToast('بسته خروجی داده‌های مشتری با موفقیت آماده‌سازی شد.', 'success') : null">دریافت بسته داده‌ها</button>
        <a href="#gm-04-tenant-detail?id=${tenant.id}&tab=portal" class="btn btn-secondary">بازگشت به پرونده مشتری</a>
      </div>
    </div>
    ${window.renderGM28Panel(params)}
  `;
};

window.openCustomerSupportRequestModal = function(tenantId) {
  const store = window.prototypeStore || window.GMStore;
  const tid = tenantId || (store ? store.getActiveTenantId() : 'tnt_westo_demo');
  const content = `
    <div style="display: flex; flex-direction: column; gap: 0.85rem;" id="cust-ticket-form">
      <div class="form-group">
        <label class="form-label" for="cust-ticket-subject">
          موضوع درخواست راهنمایی:
          <span class="field-badge field-required" aria-hidden="true">الزامی</span>
        </label>
        <input type="text" id="cust-ticket-subject" class="form-control" placeholder="مثال: سوال در مورد نحوه گزارش‌گیری فصلی مالیات" aria-required="true" oninput="window.GMApp && window.GMApp.clearFieldError(this)" aria-label="موضوع درخواست راهنمایی" />
      </div>
      <div class="form-group">
        <label class="form-label" for="cust-ticket-dept">دپارتمان مربوطه:</label>
        <select id="cust-ticket-dept" class="form-control" aria-label="دپارتمان مربوطه برای درخواست">
          <option>پشتیبانی فنی و پایانه‌های پوز</option>
          <option>امور مالی، فاکتور و قراردادها</option>
          <option>آموزش و کاربری منوی دیجیتال</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="cust-ticket-msg">
          شرح کامل سوال یا گزارش مشکل:
          <span class="field-badge field-required" aria-hidden="true">الزامی</span>
        </label>
        <textarea id="cust-ticket-msg" class="form-control" rows="4" placeholder="لطفاً جزئیات سوال یا مورد مشاهده‌شده را شرح دهید..." aria-required="true" oninput="window.GMApp && window.GMApp.clearFieldError(this)" aria-label="شرح کامل سوال یا گزارش مشکل"></textarea>
      </div>
      <div style="display: flex; justify-content: flex-start;">
        <button type="button" class="btn btn-secondary btn-xs" onclick="window.resetCustomerTicketForm()">
          پاکسازی و بازنشانی فرم
        </button>
      </div>
    </div>
  `;

  window.resetCustomerTicketForm = function() {
    const sEl = document.getElementById('cust-ticket-subject');
    const mEl = document.getElementById('cust-ticket-msg');
    if (sEl) sEl.value = '';
    if (mEl) mEl.value = '';
    const form = document.getElementById('cust-ticket-form');
    if (window.GMApp && typeof window.GMApp.clearAllErrors === 'function') {
      window.GMApp.clearAllErrors(form);
    }
  };

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal('ارسال درخواست راهنمایی و پشتیبانی کافه وستو', content, () => {
      const sEl = document.getElementById('cust-ticket-subject');
      const mEl = document.getElementById('cust-ticket-msg');
      const subj = (sEl ? sEl.value : '').trim();
      const msg = (mEl ? mEl.value : '').trim();

      let hasError = false;
      if (!subj || subj.length < 5) {
        if (window.GMApp && typeof window.GMApp.setFieldError === 'function') {
          window.GMApp.setFieldError(sEl, 'موضوع درخواست الزامی است (حداقل ۵ نویسه).');
        }
        hasError = true;
      } else if (sEl && window.GMApp && typeof window.GMApp.clearFieldError === 'function') {
        window.GMApp.clearFieldError(sEl);
      }

      if (!msg || msg.length < 10) {
        if (window.GMApp && typeof window.GMApp.setFieldError === 'function') {
          window.GMApp.setFieldError(mEl, 'شرح درخواست الزامی است (حداقل ۱۰ نویسه).');
        }
        hasError = true;
      } else if (mEl && window.GMApp && typeof window.GMApp.clearFieldError === 'function') {
        window.GMApp.clearFieldError(mEl);
      }

      if (hasError) {
        if (window.GMApp && typeof window.GMApp.showToast === 'function') {
          window.GMApp.showToast('لطفاً فیلدهای الزامی فرم را تکمیل فرمایید.', 'warning');
        }
        return false;
      }

      if (store && typeof store.createTicket === 'function') {
        store.createTicket({
          title: subj,
          category: document.getElementById('cust-ticket-dept')?.value || 'پشتیبانی عمومی',
          tenantId: tid
        });
      }

      window.GMApp.showToast('درخواست راهنمایی فقط در Fixture محلی ثبت شد؛ پیام یا ارجاع واقعی ارسال نشده است.', 'info');
      return true;
    }, {
      confirmText: 'ارسال درخواست'
    });
  }
};
