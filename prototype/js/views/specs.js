// prototype/js/views/specs.js
// شناسنامه و مستندات مشخصات صفحات باقیمانده (GM-11..12, GM-16..24, GM-26..28).
// مسیر/دامنه/مجوز canonical هر صفحه از prototype/js/contracts.js تزریق می‌شود؛
// targetRoutes زیر فقط جزئیات اجرایی مشاهده‌شده برای همان قرارداد است.

window.GMViews = window.GMViews || {};

window.GMViews.Specs = {
  screens: [
    {
      id: 'gm-11',
      title: 'GM-11: صورتحساب و اشتراک مشتری (Subscriptions & Invoices)',
      category: 'بازرگانی و مالی',
      targetRoutes: ['/api/control/billing/invoices', '/api/control/billing/subscriptions', '/api/control/billing/transactions'],
      permissions: ['billing.invoice.read'],
      summary: 'نمایش tenant-scoped صورتحساب، اشتراک، تراکنش و وضعیت فعال‌سازی؛ وضعیت پرداخت و داده حسابداری تا پاسخ معتبر API قطعی تلقی نمی‌شود.',
      inputs: ['فیلتر مستأجر', 'فاکتور و اشتراک', 'وضعیت پرداخت', 'بازه سررسید'],
      outputs: ['جدول فاکتورها', 'جزئیات اشتراک', 'ردیابی تراکنش و فعال‌سازی']
    },
    {
      id: 'gm-12',
      title: 'GM-12: مصرف و سهمیه مشتری (Usage & Quotas)',
      category: 'بازرگانی و عملیات',
      targetRoutes: ['/api/control/billing/quotas', '/api/control/billing/quotas/:tenantId', '/api/control/billing/transactions'],
      permissions: ['billing.usage.read'],
      summary: 'نمایش مصرف و سهمیه tenant-scoped با تفکیک داده موجود از metering تأییدنشده و جلوگیری از نتیجه‌سازی از Fixture.',
      inputs: ['مستأجر هدف', 'دوره مصرف', 'نوع سهمیه', 'رزرو یا مصرف ثبت‌شده'],
      outputs: ['نوار مصرف', 'وضعیت سقف‌ها', 'ردیابی رزرو سهمیه']
    },
    {
      id: 'gm-16',
      title: 'GM-16: اتوماسیون، Outbox و اجرای زمان‌بندی‌شده (Automations)',
      category: 'عملیات پلتفرم',
      targetRoutes: ['/api/control/automation/rules', '/api/control/automation/executions', '/api/control/automation/outbox', '/api/control/automation/incidents'],
      permissions: ['automation.read'],
      summary: 'پایش قواعد اتوماسیون، اجرای زمان‌بندی‌شده، صف Outbox و مدیریت Incidentهای زیرساختی با تضمین سلامت صف عملیاتی.',
      inputs: ['قواعد اتوماسیون', 'بازه اجرا', 'وضعیت Outbox', 'Incident و retry'],
      outputs: ['فهرست قواعد', 'تاریخچه اجرا', 'صف تحویل رویداد', 'Incidentهای باز']
    },
    {
      id: 'gm-17',
      title: 'GM-17: دفترچه مشتریان (Customer Directory)',
      category: 'مشتریان و مستأجران',
      targetRoutes: ['/api/control/data/customers', '/api/control/data/customers/search', '/api/control/data/customers/:id/reveal'],
      permissions: ['customer.directory.read'],
      summary: 'نمایش دفترچه مشتری tenant-scoped با جست‌وجو، کنترل افشای PII و خروجی‌هایی که فقط پس از پاسخ معتبر قابل اتکا هستند.',
      inputs: ['جست‌وجوی مشتری', 'مستأجر فعال', 'فیلتر VIP', 'درخواست reveal کنترل‌شده'],
      outputs: ['فهرست مشتریان', 'جزئیات tenant-scoped', 'رویداد ممیزی افشای PII']
    },
    {
      id: 'gm-18',
      title: 'GM-18: دامنه‌ها و گواهی مشتری (Domains)',
      category: 'شبکه و عملیات',
      targetRoutes: ['/api/control/infra/domains', '/api/control/infra/domains/:tenantId', '/api/control/infra/domains/:id/verify-dns', '/api/control/infra/domains/:id/request-tls'],
      permissions: ['domain.read'],
      summary: 'پایش اتصال دامنه tenant، اعتبارسنجی DNS و درخواست TLS با تفکیک روشن بین وضعیت مشاهده‌شده و عملیات تأییدنشده.',
      inputs: ['دامنه', 'مستأجر هدف', 'بررسی DNS', 'درخواست TLS'],
      outputs: ['وضعیت DNS', 'وضعیت TLS', 'مسیر Edge و نتیجه آخرین بررسی']
    },
    {
      id: 'gm-19',
      title: 'GM-19: دستگاه‌ها و Edge Fleet (Devices)',
      category: 'دستگاه و عملیات محلی',
      targetRoutes: ['/api/control/edge/devices', '/api/control/edge/conflicts', '/api/control/edge/sync', '/api/control/edge/leases/renew'],
      permissions: ['edge.device.read'],
      summary: 'فهرست دستگاه‌ها، وضعیت Pair و همگام‌سازی Edge، تعارض‌ها و تمدید lease با نمایش explicit وضعیت اتصال.',
      inputs: ['مستأجر هدف', 'دستگاه Edge', 'تعارض همگام‌سازی', 'lease'],
      outputs: ['ناوگان دستگاه‌ها', 'وضعیت اتصال', 'صف تعارض‌ها', 'نتیجه sync و renew']
    },
    {
      id: 'gm-20',
      title: 'GM-20: پشتیبان‌گیری و آزمون بازیابی (Backups)',
      category: 'پایداری و امنیت',
      targetRoutes: ['/api/control/backups/manifests', '/api/control/backups/verify', '/api/control/backups/restore-drill'],
      permissions: ['backup.read'],
      summary: 'نمایش Manifestهای پشتیبان، صحت‌سنجی هش و آزمون restore؛ موفقیت عملیاتی فقط با evidence بیرونی و runbook معتبر اعلام می‌شود.',
      inputs: ['مستأجر یا سلول هدف', 'Manifest', 'بررسی checksum', 'آزمون restore'],
      outputs: ['فهرست پشتیبان‌ها', 'نتیجه verify', 'گزارش restore drill']
    },
    {
      id: 'gm-21',
      title: 'GM-21: پشتیبانی و تیکت‌ها (Support)',
      category: 'پشتیبانی مشتری',
      targetRoutes: ['/api/control/tickets', '/api/control/tickets/:id/details', '/api/control/tickets/:id/messages', '/api/control/tickets/:id/status'],
      permissions: ['support.ticket.read'],
      summary: 'مدیریت تیکت tenant-scoped، جزئیات، پیام‌ها و وضعیت؛ ورود پشتیبانی و session approval باید auditپذیر بماند.',
      inputs: ['مستأجر', 'تیکت', 'پیام پشتیبانی', 'وضعیت و اولویت'],
      outputs: ['فهرست تیکت‌ها', 'رشته پیام', 'وضعیت حل و تاریخچه اقدام']
    },
    {
      id: 'gm-22',
      title: 'GM-22: عملیات و دیده‌پذیری پلتفرم (Operations)',
      category: 'پایش و عملیات',
      targetRoutes: ['/api/control/overview', '/api/control/incidents', '/api/control/health', '/metrics'],
      permissions: ['observability.read'],
      summary: 'نمایش سلامت، Incident، شاخص‌های مشاهده‌پذیری و وضعیت عملیاتی پلتفرم بدون تبدیل Fixture یا نبود داده به موفقیت واقعی.',
      inputs: ['بازه زمانی', 'Incident', 'tenant یا cell هدف', 'شاخص سلامت'],
      outputs: ['خلاصه عملیاتی', 'فهرست Incident', 'health و metrics', 'مسیر اقدام بعدی']
    },
    {
      id: 'gm-23',
      title: 'GM-23: انتشار و Canary (Releases)',
      category: 'انتشار و پایداری',
      targetRoutes: ['/api/control/releases', '/api/control/releases/:version/waves', '/api/control/releases/:version/evaluate-canary'],
      permissions: ['release.read'],
      summary: 'فهرست release، موج‌های انتشار و ارزیابی Canary؛ رجیستری Digest و approval تولیدی باید جداگانه evidence داشته باشد.',
      inputs: ['نسخه', 'Digest', 'موج انتشار', 'شاخص Canary'],
      outputs: ['فهرست releaseها', 'موج‌ها', 'نتیجه ارزیابی', 'شرایط rollback']
    },
    {
      id: 'gm-24',
      title: 'GM-24: زیرساخت و Edge (Infrastructure)',
      category: 'شبکه و زیرساخت',
      targetRoutes: ['/api/control/infra/domains', '/api/control/infra/probes', '/api/control/edge/devices', '/api/control/infra/resolve-host'],
      permissions: ['infrastructure.read'],
      summary: 'نمایش دامنه‌ها، probeها، دستگاه‌های Edge و resolve-host با تفکیک صریح داده مشاهده‌شده از evidence زیرساخت واقعی.',
      inputs: ['دامنه و میزبان', 'probe', 'دستگاه Edge', 'cell یا region'],
      outputs: ['نقشه زیرساخت', 'وضعیت probe', 'وضعیت Edge', 'نتیجه resolve']
    },
    {
      id: 'gm-26',
      title: 'GM-26: ممیزی تغییرناپذیر (Audit)',
      category: 'امنیت و انطباق',
      targetRoutes: ['/api/control/audit', '/api/control/audit/sessions', '/api/control/audit/pii', '/api/control/audit/siem/export'],
      permissions: ['audit.read'],
      summary: 'نمایش رویدادهای ممیزی، نشست‌ها، رخدادهای PII و خروجی SIEM با زنجیره شواهد و tenant scope.',
      inputs: ['عامل', 'مستأجر', 'دامنه تغییر', 'بازه زمانی', 'سطح حساسیت'],
      outputs: ['دفتر رویداد', 'جزئیات تغییر', 'وضعیت integrity', 'خروجی SIEM']
    },
    {
      id: 'gm-27',
      title: 'GM-27: تیم و تنظیمات پلتفرم (Team & Settings)',
      category: 'پیکربندی کلان',
      targetRoutes: ['/api/control/identities', '/api/control/identities/invite', '/api/control/openapi'],
      permissions: ['platform.team.read'],
      summary: 'مدیریت اعضای تیم کنترل‌پلن، ماتریس نقش‌ها و احراز هویت دومرحله‌ای (MFA) با ثبت ممیزی کامل تغییرات پیکربندی پلتفرم.',
      inputs: ['عضو تیم', 'نقش و scope', 'MFA', 'تنظیم کلان'],
      outputs: ['فهرست تیم', 'وضعیت نقش و MFA', 'ثبت ممیزی تغییرات']
    },
    {
      id: 'gm-28',
      title: 'GM-28: پورتال قرارداد و حساب مشتری (Customer Portal)',
      category: 'مشتریان و مالی',
      targetRoutes: ['/api/control/billing/subscriptions', '/api/control/billing/invoices', '/api/control/billing/quotas'],
      permissions: ['portal.contract.read'],
      summary: 'نمایش قرارداد، اشتراک، فاکتور و سهمیه در زبان مشتری؛ هیچ Fixture یا وضعیت نبود metering نباید به تحویل واقعی تعبیر شود.',
      inputs: ['مستأجر فعال', 'قرارداد', 'دوره مصرف', 'صورتحساب'],
      outputs: ['خلاصه قرارداد', 'فاکتورها', 'سهمیه و مصرف', 'درخواست خروجی یا پشتیبانی']
    }
  ],

  render() {
    return `
      <div class="page-header">
        <div>
          <div class="page-title">
            <span>شناسنامه و مشخصات صفحات فازهای بعد (Screen Specifications)</span>
            <span class="badge badge-neutral">Specifications Library</span>
          </div>
          <p class="page-desc">
            مشخصات کارکردی، روت‌های هدف، سطوح دسترسی و نیازمندی‌های داده‌ای صفحات GM-11 تا GM-28 طبق بخش‌های موضوعی سند GODMODE.MD.
          </p>
        </div>
        <div class="header-actions">
          <a href="#gm-02-overview" class="btn btn-secondary">
            بازگشت به پیشخوان
          </a>
        </div>
      </div>

      <div class="card" style="margin-bottom: 24px;">
        <div class="card-body" style="padding: 16px 20px;">
          <div class="alert alert-info" style="margin: 0;">
            این بخش تضمین می‌کند که تمامی ۲۸ صفحه معماری Control Plane دارای شناسنامه دقیق، ورودی/خروجی، مجوز دسترسی RBAC و روت‌های هدف مشخص هستند.
          </div>
        </div>
      </div>

      <div class="grid-2">
        ${this.screens.map(s => `
          <div class="card" id="${s.id}">
            <div class="card-header">
              <div>
                <div class="card-title">${s.title}</div>
                <div class="card-subtitle"><span class="badge badge-neutral">${s.category}</span></div>
              </div>
            </div>
            <div class="card-body">
              <p style="font-size: 13px; line-height: 1.7; color: var(--color-slate-200); margin-bottom: 14px;">
                ${s.summary}
              </p>

              <div style="display: flex; flex-direction: column; gap: 8px;">
                <div>
                  <span class="info-label">مجوزهای دسترسی الزامی:</span>
                  <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px;">
                    ${s.permissions.map(p => `<code class="code-badge" style="color: var(--color-warning);">${p}</code>`).join('')}
                  </div>
                </div>

                <div style="margin-top: 6px;">
                  <span class="info-label">روت‌های هدف API:</span>
                  <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px;">
                    ${s.targetRoutes.map(r => `<code class="code-badge">${r}</code>`).join('')}
                  </div>
                </div>

                <div style="margin-top: 6px;">
                  <span class="info-label">ورودی‌های کلیدی:</span>
                  <div style="font-size: 12px; color: var(--color-slate-300); margin-top: 2px;">
                    ${s.inputs.join(' • ')}
                  </div>
                </div>

                <div style="margin-top: 4px;">
                  <span class="info-label">خروجی‌ها و نتایج:</span>
                  <div style="font-size: 12px; color: var(--color-slate-300); margin-top: 2px;">
                    ${s.outputs.join(' • ')}
                  </div>
                </div>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }
};
