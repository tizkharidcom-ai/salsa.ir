// prototype/js/workflow-hierarchy.js
// Standard Process & Workflow Hierarchy Architecture for SALSA Control Plane (GODMODE 3050)
'use strict';

(function() {
  const PROCESSES = [
    {
      id: 'proc-onboarding',
      code: 'PROC-01',
      name: 'جذب و راه‌اندازی مشتری جدید',
      englishName: 'Tenant Onboarding & Provisioning',
      domain: 'مدیریت مشتریان',
      icon: '🚀',
      color: '#0284c7',
      badgeClass: 'badge-info',
      summary: 'پذیرش قرارداد، ساخت دیتابیس، تنظیم لایسنس، اتصال دامنه اختصاصی و تجهیز پایانه‌ها',
      targetOutcome: 'مجموعه فعال با دیتابیس اختصاصی، لایسنس فعال، پوز و پورتال متصل',
      roles: ['راهبر فروش', 'اپراتور فنی', 'ادمین ناوگان'],
      steps: [
        {
          num: 1,
          viewId: 'GM05',
          route: 'gm-05-tenant-new',
          title: 'ثبت مجموعه جدید',
          action: 'ورود اطلاعات پایه و مشخصات سازمانی مشتری',
          description: 'تعریف شناسه مجموعه، نام برند، مالک، شماره تماس و اطلاعات حقوقی'
        },
        {
          num: 2,
          viewId: 'GM06',
          route: 'gm-06-provisioning',
          title: 'استقرار و تحویل محیط',
          action: 'اجرای پایپ‌لاین ساخت دیتابیس و بررسی سلامت سرویس',
          description: 'ایزوله‌سازی شِمای دیتابیس، استقرار روی سرور متمرکز VPS و اجرای خودکار مایگریشن‌ها'
        },
        {
          num: 3,
          viewId: 'GM04',
          route: 'gm-04-tenant-detail',
          query: 'tab=features',
          title: 'پیکربندی ماژول‌ها و لایسنس',
          action: 'فعال‌سازی سرویس‌ها و صدور کلیدهای لایسنس',
          description: 'روشن‌کردن ماژول‌های منو، انبار، سفارش‌گیر سالن و باشگاه مشتریان'
        },
        {
          num: 4,
          viewId: 'GM18',
          route: 'gm-18-domains',
          title: 'دامنه و هویت برند',
          action: 'تنظیم دامنه، رکوردهای DNS و گواهی امنیتی SSL',
          description: 'اتصال دامنه مشتری و هدایت ترافیک به سمت سرور کلاینت'
        },
        {
          num: 5,
          viewId: 'GM19',
          route: 'gm-19-devices',
          title: 'دستگاه‌ها و پایانه‌ها',
          action: 'ثبت صندوق‌های POS، پرینترها و تبلت‌های سالن',
          description: 'رجیستر کردن پایانه‌های سخت‌افزاری و تولید توکن‌های اتصال امن'
        },
        {
          num: 6,
          viewId: 'GM28',
          route: 'gm-28-portal',
          title: 'پورتال سلف‌سرویس مشتری',
          action: 'تحویل دسترسی به نماینده مشتری و تأیید قرارداد',
          description: 'ارسال دسترسی اولیه به مالک رستوران و امضای الکترونیک تعهدات سطح خدمت'
        }
      ]
    },
    {
      id: 'proc-operations',
      code: 'PROC-02',
      name: 'عملیات روزمره و پایش پایانه‌ها',
      englishName: 'Daily Operations & POS/KDS Sync',
      domain: 'مرکز فرماندهی و عملیات',
      icon: '⚡',
      color: '#10b981',
      badgeClass: 'badge-success',
      summary: 'پایش سلامت ناوگان، همگام‌سازی منو، نظارت بر کلاینت ۴۱۸۰ و پایانه فروش',
      targetOutcome: 'ارتباط پایدار بدون قطعی بین کنترل‌پلن و کلاینت‌های مشتریان',
      roles: ['اپراتور شیفت', 'پشتیبان فنی', 'ناظر عملیات'],
      steps: [
        {
          num: 1,
          viewId: 'GM02',
          route: 'gm-02-overview',
          title: 'وضعیت و آمادگی پلتفرم',
          action: 'مشاهده شاخص‌های کلان پلتفرم و سیگنال‌های حیاتی',
          description: 'بررسی شاخص‌های کلی ناوگان، تعداد مشتریان فعال و نمودار سلامت روزانه'
        },
        {
          num: 2,
          viewId: 'GM03',
          route: 'gm-03-tenants',
          query: 'view=table',
          title: 'فهرست مجموعه‌ها و پایش ۴۱۸۰',
          action: 'بررسی وضعیت اتصال مشتریان و دریافت داده‌های عملیاتی',
          description: 'نظارت بر همگام‌سازی بلادرنگ، تعداد شعب و پایانه‌های فعال مشتریان'
        },
        {
          num: 3,
          viewId: 'GM19',
          route: 'gm-19-devices',
          title: 'وضعیت پایانه‌های سالن و آشپزخانه',
          action: 'پایش ارتباط زنده با صندوق‌های POS، کیوسک و KDS',
          description: 'بررسی وضعیت آنلاین بودن پایانه‌های ثبت سفارش، پرینتر بار و نمایشگر آشپزخانه'
        },
        {
          num: 4,
          viewId: 'GM17',
          route: 'gm-17-customers',
          title: 'مشتریان نهایی و سوابق',
          action: 'پایش مراجعات و حساب‌های باشگاه مشتریان رستوران',
          description: 'رسیدگی به لیست مشتریان نهایی، امتیازهای وفاداری و سوابق اعتباری'
        },
        {
          num: 5,
          viewId: 'GM22',
          route: 'gm-22-operations',
          title: 'سلامت، رخدادها و هشدارها',
          action: 'پایش لحظه‌ای خطاهای سیستمی و هشدارهای قطعی پایانه‌ها',
          description: 'بررسی زمان پاسخگویی APIها، گلوگاه‌های شبکه و هشدارهای بلادرنگ'
        }
      ]
    },
    {
      id: 'proc-commercial',
      code: 'PROC-03',
      name: 'چرخه تجاری، پلن و صورتحساب',
      englishName: 'Commercial, Add-ons & Billing',
      domain: 'محصول و درآمد',
      icon: '💎',
      color: '#8b5cf6',
      badgeClass: 'badge-purple',
      summary: 'مدیریت بسته‌ها، ارتقای پلن، پایش سهمیه‌ها، صدور فاکتور و اعمال لایسنس',
      targetOutcome: 'مدیریت شفاف درآمد، تسویه منظم مالی و اعمال بلادرنگ قابلیت‌های خریداری‌شده',
      roles: ['مدیر مالی', 'اکانت منیجر', 'پشتیبان فروش'],
      steps: [
        {
          num: 1,
          viewId: 'GM08',
          route: 'gm-08-features',
          title: 'کاتالوگ سرویس‌ها و امکانات',
          action: 'بررسی قابلیت‌های پلتفرم و ماژول‌های قابل واگذاری',
          description: 'مرور جامع ماژول‌های کاتالوگ پلتفرم شامل انبار، هوش مصنوعی، مالی و وفاداری'
        },
        {
          num: 2,
          viewId: 'GM10',
          route: 'gm-10-plans',
          title: 'پلن‌ها و تعرفه‌ها',
          action: 'تنظیم بسته‌های اشتراک، تخفیفات و سطوح خدمات',
          description: 'پیکربندی پلن‌های پایه، حرفه‌ای و سازمانی بر اساس تعداد شعب و کاربران'
        },
        {
          num: 3,
          viewId: 'GM12',
          route: 'gm-12-usage',
          title: 'مصرف و سهمیه مشتری',
          action: 'پایش ترافیک، پیامک، تراکنش‌ها و بررسی عبور از سقف',
          description: 'کنترل میزان مصرف منابع ابری، پیامک‌های ارسالی و تراکنش‌های روزانه'
        },
        {
          num: 4,
          viewId: 'GM11',
          route: 'gm-11-billing',
          title: 'اشتراک، صورتحساب و پرداخت',
          action: 'صدور صورتحساب دوره‌ای، ثبت واریزی و تسویه مالی',
          description: 'صدور فاکتورهای رسمی، پیگیری وضعیت پرداخت‌ها و اعمال تمدید دوره'
        },
        {
          num: 5,
          viewId: 'GM09',
          route: 'gm-09-tenant-features',
          title: 'اعمال افزونه به کلاینت',
          action: 'انعکاس مستقیم لایسنس به نرم‌افزار کلاینت (پورت ۴۱۸۰)',
          description: 'فعال‌سازی آنی کلید لایسنس در پنل مدیریت کلاینت و باز شدن دسترسی کاربر'
        }
      ]
    },
    {
      id: 'proc-security',
      code: 'PROC-04',
      name: 'امنیت، هویت و حاکمیت دسترسی',
      englishName: 'Identity, Security & RBAC Governance',
      domain: 'هویت و حاکمیت',
      icon: '🛡️',
      color: '#f59e0b',
      badgeClass: 'badge-warning',
      summary: 'احراز هویت، کنترل دسترسی RBAC، شبیه‌سازی مجوزها و ممیزی رویدادها',
      targetOutcome: 'انطباق ۱۰۰٪ با سیاست‌های امنیتی، تفکیک کامل دسترسی‌ها و ردپای شفاف ممیزی',
      roles: ['راهبر امنیت (CISO)', 'مدیر سیستم', 'ممیز انطباق'],
      steps: [
        {
          num: 1,
          viewId: 'GM01',
          route: 'gm-01-login',
          title: 'ورود و امنیت حساب',
          action: 'احراز هویت دومرحله‌ای، بررسی امنیت گذرواژه و نشست',
          description: 'کنترل نشست‌های فعال راهبران و الزام ورود امن چندعامله'
        },
        {
          num: 2,
          viewId: 'GM13',
          route: 'gm-13-identities',
          title: 'کاربران و هویت‌ها',
          action: 'مدیریت پرسنل، نشست‌های فعال و وضعیت مسدودی',
          description: 'تعریف حساب‌های کاربری، تعیین عضویت‌ها و باطل‌سازی نشست‌های مشکوک'
        },
        {
          num: 3,
          viewId: 'GM14',
          route: 'gm-14-access-roles',
          title: 'نقش‌ها و مجوزها (RBAC)',
          action: 'تعریف ماتریس اختیارات و تفکیک وظایف سازمانی',
          description: 'مدیریت نقش‌های اپراتور، صندوقدار، مدیر سالن و اختیارات هر نقش'
        },
        {
          num: 4,
          viewId: 'GM15',
          route: 'gm-15-simulator',
          title: 'ارزیابی و شبیه‌ساز دسترسی',
          action: 'تست عملکرد مجوزها روی سناریوی فرضی قبل از اعمال',
          description: 'تست فرمول‌های دسترسی و اطمینان از عدم دسترسی غیرمجاز کاربر'
        },
        {
          num: 5,
          viewId: 'GM26',
          route: 'gm-26-audit',
          title: 'ردپای ممیزی و رویدادها',
          action: 'بررسی لاگ‌های غیرقابل جعل و ردیابی تغییرات امنیتی',
          description: 'تحلیل رویدادهای تغییر دسترسی، ارتقای لایسنس و دستکاری تنظیمات کلان'
        },
        {
          num: 6,
          viewId: 'GM27',
          route: 'gm-27-team',
          title: 'تیم راهبری و پیکربندی',
          action: 'تنظیمات سطح بالا، کلیدهای عمومی و پیکربندی راهبران',
          description: 'مدیریت اعضای تیم ارشد، سرفصل‌های مدیریتی و کلیدهای ارتباطی سیستم'
        }
      ]
    },
    {
      id: 'proc-incident',
      code: 'PROC-05',
      name: 'مدیریت رخداد، پشتیبانی و بازیابی',
      englishName: 'Incident Management, Support & DR',
      domain: 'پایداری و تداوم',
      icon: '🚨',
      color: '#ef4444',
      badgeClass: 'badge-danger',
      summary: 'تریاژ هشدارها، تیکت‌های مشتری، بررسی کارگران پردازش، پشتیبان و بازیابی',
      targetOutcome: 'کاهش زمان بازگشت به سرویس (MTTR) به زیر ۵ دقیقه و صفر شدن از دست رفتن داده',
      roles: ['تیم SRE', 'پشتیبانی ارشد', 'مدیر پلتفرم'],
      steps: [
        {
          num: 1,
          viewId: 'GM22',
          route: 'gm-22-operations',
          title: 'سلامت، رخدادها و هشدارها',
          action: 'تشخیص اولیه رخداد، ارزیابی شدت خطا و ثبت حادثه',
          description: 'شناسایی ناهنجاری، افت نرخ موفقیت یا خطاهای ۵xx در کلاینت یا سرور'
        },
        {
          num: 2,
          viewId: 'GM21',
          route: 'gm-21-support',
          title: 'تیکت و پشتیبانی مشتری',
          action: 'پاسخگویی به گزارش مشتری و ثبت ارتباط با رخداد',
          description: 'تریاژ تیکت‌های اضطراری شعب، اطلاع‌رسانی وضعیت به مدیران رستوران'
        },
        {
          num: 3,
          viewId: 'GM25',
          route: 'gm-25-jobs',
          title: 'صف پردازش و کارهای پس‌زمینه',
          action: 'بررسی وضعیت کارگران، جاب‌های متوقف یا قفل‌شده',
          description: 'رسیدگی به صف‌های ناموفق، بازنشانی کارهای معلق و تلاش مجدد'
        },
        {
          num: 4,
          viewId: 'GM15',
          route: 'gm-15-simulator',
          title: 'تأیید دسترسی‌های اضطراری',
          action: 'فعال‌سازی مجوز دسترسی تعمیرات یا شبیه‌سازی سطح دسترسی',
          description: 'صدور دسترسی موقت جهت مداخله فنی بدون نقض قوانین امنیتی'
        },
        {
          num: 5,
          viewId: 'GM20',
          route: 'gm-20-backups',
          title: 'پشتیبان و بازیابی اضطراری',
          action: 'بازیابی به نقطه زمانی یا اعمال آخرین نسخه پشتیبان سالم',
          description: 'اعمال اسنپ‌شات اضطراری یا بازیابی نسخه پشتیبان دیتابیس در صورت فساد داده'
        },
        {
          num: 6,
          viewId: 'GM26',
          route: 'gm-26-audit',
          title: 'ثبت گزارش پایانی ممیزی',
          action: 'مستندسازی اقدامات انجام‌شده در دفتر کل رخدادها',
          description: 'ثبت علت ریشه‌ای (RCA)، تغییرات اعمال‌شده و بستن پرونده رخداد'
        }
      ]
    },
    {
      id: 'proc-infrastructure',
      code: 'PROC-06',
      name: 'زیرساخت، انتشار نسخه و خودکارسازی',
      englishName: 'Infrastructure, Release & Automation',
      domain: 'زیرساخت و توسعه',
      icon: '⚙️',
      color: '#0d9488',
      badgeClass: 'badge-teal',
      summary: 'پایش منابع سرور VPS، قوانین خودکار، استقرار نسخه جدید و اعتبارسنجی پلتفرم',
      targetOutcome: 'انتشار پیوسته بدون قطعی سرویس (Zero-Downtime Deployments) و مدیریت منابع',
      roles: ['مهندس DevOps', 'معمار زیرساخت', 'مدیر ارشد فنی'],
      steps: [
        {
          num: 1,
          viewId: 'GM24',
          route: 'gm-24-infrastructure',
          title: 'پایش سرور و زیرساخت VPS',
          action: 'پایش سلامت منابع سرور اصلی VPS، سرویس‌های نود و پایگاه‌داده متمرکز',
          description: 'نظارت بر پردازنده، رم، دیسک NVMe و وضعیت اتصال به Postgres و Nginx'
        },
        {
          num: 2,
          viewId: 'GM16',
          route: 'gm-16-automations',
          title: 'خودکارسازی و قوانین',
          action: 'تعریف سیاست‌های خودکار، وب‌هوک‌ها و واکنش به آلارم‌ها',
          description: 'تنظیم قواعد پشتیبان‌گیری خودکار، پاکسازی داده‌های موقت و اسکیلینگ'
        },
        {
          num: 3,
          viewId: 'GM23',
          route: 'gm-23-releases',
          title: 'نسخه، انتشار و بازگشت',
          action: 'استقرار قناری، ارتقای نسخه به تولید یا بازگشت اضطراری',
          description: 'استقرار تدریجی نسخه جدید کنترل‌پلن و کلاینت‌های مشتریان با امکان رول‌بک فوری'
        },
        {
          num: 4,
          viewId: 'GM26',
          route: 'gm-26-audit',
          title: 'ممیزی تغییرات زیرساخت',
          action: 'تأیید انطباق تغییرات با قوانین امنیتی و حاکمیتی',
          description: 'تطبیق نسخه نهایی با الزامات انطباق و مستندسازی شناسه کامیت'
        }
      ]
    }
  ];

  const GMWorkflows = {
    processes: PROCESSES,
    isStepperCollapsed: false,

    init() {
      try {
        const stored = localStorage.getItem('gm_workflows_collapsed');
        if (stored !== null) {
          this.isStepperCollapsed = (stored === 'true');
        }
      } catch (e) {}
    },

    getAllProcesses() {
      return this.processes;
    },

    getProcess(processId) {
      return this.processes.find(p => p.id === processId);
    },

    getProcessesForView(viewId) {
      if (!viewId) return [];
      const cleanId = String(viewId).trim().toUpperCase();
      return this.processes.filter(p => p.steps.some(s => s.viewId === cleanId));
    },

    getPrimaryProcessForView(viewId) {
      const list = this.getProcessesForView(viewId);
      return list.length > 0 ? list[0] : null;
    },

    getStepInProcess(processId, viewId) {
      const proc = this.getProcess(processId);
      if (!proc) return null;
      const cleanId = String(viewId).trim().toUpperCase();
      return proc.steps.find(s => s.viewId === cleanId) || null;
    },

    toggleStepperCollapsed() {
      this.isStepperCollapsed = !this.isStepperCollapsed;
      try {
        localStorage.setItem('gm_workflows_collapsed', String(this.isStepperCollapsed));
      } catch (e) {}
      const bar = document.getElementById('workflow-stepper-bar');
      if (bar) {
        bar.classList.toggle('is-collapsed', this.isStepperCollapsed);
      }
    },

    navigateToStep(processId, stepNum) {
      const proc = this.getProcess(processId);
      if (!proc) return;
      const targetStep = proc.steps.find(s => s.num === Number(stepNum));
      if (!targetStep) return;

      let targetHash = `#${targetStep.route}`;
      if (targetStep.query) {
        targetHash += `?${targetStep.query}`;
      }
      window.location.hash = targetHash;
    },

    renderStepper(viewId) {
      if (!viewId) return '';
      const cleanId = String(viewId).trim().toUpperCase();
      const matchingProcesses = this.getProcessesForView(cleanId);
      if (matchingProcesses.length === 0) return '';

      // Default to primary process for this view
      const activeProc = matchingProcesses[0];
      const currentStep = activeProc.steps.find(s => s.viewId === cleanId);
      if (!currentStep) return '';

      const currentStepIdx = activeProc.steps.indexOf(currentStep);
      const prevStep = currentStepIdx > 0 ? activeProc.steps[currentStepIdx - 1] : null;
      const nextStep = currentStepIdx < activeProc.steps.length - 1 ? activeProc.steps[currentStepIdx + 1] : null;

      const collapsedClass = this.isStepperCollapsed ? 'is-collapsed' : '';

      return `
        <div class="workflow-stepper-bar google-breadcrumb-bar ${collapsedClass}" id="workflow-stepper-bar" role="navigation" aria-label="راهنمای فرایند استاندارد">
          <div class="workflow-stepper-inner google-breadcrumb-inner">
            <!-- Google Cloud Hierarchical Breadcrumb Trail -->
            <div class="google-breadcrumb-trail">
              <a href="#gm-02-overview" class="google-crumb-root" title="پیشخوان اصلی کنسول ابری">
                <span class="google-cloud-icon" aria-hidden="true">☁</span>
                <span>کنسول SALSA Cloud</span>
              </a>
              <span class="google-crumb-separator" aria-hidden="true">›</span>
              <span class="google-crumb-domain">${activeProc.domain}</span>
              <span class="google-crumb-separator" aria-hidden="true">›</span>
              <!-- Process Identity & Badge -->
              <div class="workflow-proc-identity">
                <button type="button" class="workflow-proc-tag" onclick="window.GMWorkflows.openHierarchyModal('${activeProc.id}')" title="مشاهده کل فرایند و گام‌ها در نقشه فرایندها">
                  <span class="workflow-proc-icon">${activeProc.icon}</span>
                  <span class="workflow-proc-code">${activeProc.code}</span>
                  <span class="workflow-proc-name">${activeProc.name}</span>
                  <span class="workflow-proc-badge">گام ${(currentStep.num).toLocaleString('fa-IR')} از ${(activeProc.steps.length).toLocaleString('fa-IR')}</span>
                </button>
              </div>
              <span class="google-crumb-separator" aria-hidden="true">›</span>
              <span class="google-crumb-current" aria-current="page">${currentStep.title}</span>
            </div>

            <!-- Quick Step Navigation Actions (Google Material style) -->
            <div class="workflow-stepper-actions">
              ${prevStep ? `
                <a href="#${prevStep.route}${prevStep.query ? '?' + prevStep.query : ''}" class="btn btn-ghost btn-xs workflow-nav-btn" title="گام قبلی: ${prevStep.title}">
                  🡲 قبلی
                </a>
              ` : `
                <button type="button" class="btn btn-ghost btn-xs workflow-nav-btn" disabled style="opacity: 0.35;">
                  🡲 قبلی
                </button>
              `}
              ${nextStep ? `
                <a href="#${nextStep.route}${nextStep.query ? '?' + nextStep.query : ''}" class="btn btn-primary btn-xs workflow-nav-btn" title="گام بعدی: ${nextStep.title}">
                  بعدی: ${nextStep.title} 🡸
                </a>
              ` : `
                <span class="workflow-proc-completed" title="این گام آخرین مرحله فرایند جاری است">✓ پایان فرایند</span>
              `}
              <button type="button" class="btn btn-secondary btn-xs workflow-map-btn" onclick="window.GMWorkflows.openHierarchyModal('${activeProc.id}')" title="باز کردن نقشه کامل فرایندهای سازمانی">
                🗺️ نقشه فرایندها
              </button>
              <button type="button" class="workflow-collapse-toggle" onclick="window.GMWorkflows.toggleStepperCollapsed()" title="جمع‌کردن / بازکردن نوار فرایند" aria-label="تغییر وضعیت نوار فرایند">
                <span class="collapse-icon">▾</span>
              </button>
            </div>
          </div>

          <!-- Steps Interactive Flow (Collapsible linear flow) -->
          <div class="workflow-steps-track" role="list">
            ${activeProc.steps.map((step, idx) => {
              const isCurrent = step.num === currentStep.num;
              const isPassed = step.num < currentStep.num;
              const stateClass = isCurrent ? 'current' : (isPassed ? 'passed' : 'upcoming');
              const targetHash = `#${step.route}${step.query ? '?' + step.query : ''}`;
              return `
                <a href="${targetHash}" class="workflow-step-item ${stateClass}" role="listitem" title="${step.num}. ${step.title}: ${step.action}">
                  <span class="workflow-step-num">${step.num}</span>
                  <span class="workflow-step-title">${step.title}</span>
                </a>
                ${idx < activeProc.steps.length - 1 ? '<span class="workflow-step-arrow" aria-hidden="true">←</span>' : ''}
              `;
            }).join('')}
          </div>
        </div>
      `;
    },

    renderHierarchyModalBody(selectedProcessId) {
      const activeId = selectedProcessId || this.processes[0].id;

      return `
        <div class="workflow-modal-layout">
          <!-- Header Banner -->
          <div class="workflow-modal-intro">
            <div class="workflow-intro-text">
              <h2>سلسله‌مراتب استاندارد فرایندهای عملیاتی SALSA</h2>
              <p>ساختار گام‌به‌گام و استاندارد برای هدایت تمامی عملیات سازمانی، راه‌اندازی مشتریان، مدیریت مالی، پایش پایانه‌ها و تداوم زیرساخت در پلتفرم ۳۰۵۰.</p>
            </div>
            <div class="workflow-intro-stats">
              <div class="workflow-stat-pill"><span class="stat-num">۶</span> فرایند استاندارد</div>
              <div class="workflow-stat-pill"><span class="stat-num">۲۷</span> صفحه تحت پوشش</div>
              <div class="workflow-stat-pill stat-emerald"><span class="stat-dot dot-green"></span> ۱۰۰٪ یکپارچه</div>
            </div>
          </div>

          <!-- Process Navigation Tabs -->
          <div class="workflow-tabs-header" role="tablist" aria-label="فهرست فرایندهای استاندارد">
            ${this.processes.map(proc => `
              <button type="button" 
                      role="tab" 
                      id="tab-${proc.id}"
                      class="workflow-tab-btn ${proc.id === activeId ? 'active' : ''}" 
                      aria-selected="${proc.id === activeId ? 'true' : 'false'}"
                      onclick="window.GMWorkflows.selectModalProcess('${proc.id}')">
                <span class="wf-tab-icon">${proc.icon}</span>
                <span class="wf-tab-title">${proc.name}</span>
                <span class="wf-tab-code">${proc.code}</span>
              </button>
            `).join('')}
          </div>

          <!-- Active Process Full Dossier -->
          <div class="workflow-process-content" id="workflow-process-content" role="tabpanel">
            ${this.renderProcessDetailCard(activeId)}
          </div>
        </div>
      `;
    },

    renderProcessDetailCard(processId) {
      const proc = this.getProcess(processId) || this.processes[0];
      return `
        <div class="workflow-dossier-card">
          <!-- Process Meta Bar -->
          <div class="workflow-dossier-header" style="border-right-color: ${proc.color};">
            <div class="workflow-dossier-main">
              <div class="workflow-dossier-badge-row">
                <span class="badge ${proc.badgeClass}">${proc.code}</span>
                <span class="workflow-domain-chip">${proc.domain}</span>
                <span class="workflow-english-title">${proc.englishName}</span>
              </div>
              <h3 class="workflow-dossier-title">
                <span class="title-icon">${proc.icon}</span>
                ${proc.name}
              </h3>
              <p class="workflow-dossier-summary">${proc.summary}</p>
            </div>
            <div class="workflow-dossier-meta">
              <div class="workflow-meta-item">
                <span class="meta-label">هدف نهایی و دستاورد:</span>
                <span class="meta-value">${proc.targetOutcome}</span>
              </div>
              <div class="workflow-meta-item">
                <span class="meta-label">نقش‌های مسئول:</span>
                <div class="meta-roles-list">
                  ${proc.roles.map(r => `<span class="role-pill">${r}</span>`).join('')}
                </div>
              </div>
              <div class="workflow-meta-actions">
                <a href="#${proc.steps[0].route}${proc.steps[0].query ? '?' + proc.steps[0].query : ''}" 
                   class="btn btn-primary btn-sm" 
                   onclick="window.GMWorkflows.closeHierarchyModal()">
                  شروع فرایند از گام ۱ (${proc.steps[0].title}) 🡸
                </a>
              </div>
            </div>
          </div>

          <!-- Sequential Timeline Steps -->
          <div class="workflow-timeline-wrapper">
            <h4 class="workflow-timeline-heading">گام‌های متوالی اجرای فرایند (${proc.steps.length} گام استاندارد)</h4>
            <div class="workflow-timeline-list">
              ${proc.steps.map((step, idx) => `
                <div class="workflow-timeline-node">
                  <div class="timeline-step-badge" style="background: ${proc.color};">
                    ${step.num}
                  </div>
                  <div class="timeline-step-card">
                    <div class="timeline-step-header">
                      <div class="timeline-step-title-group">
                        <span class="timeline-view-chip">${step.viewId}</span>
                        <h5 class="timeline-step-title">${step.title}</h5>
                      </div>
                      <a href="#${step.route}${step.query ? '?' + step.query : ''}" 
                         class="btn btn-outline-primary btn-xs timeline-go-btn"
                         onclick="window.GMWorkflows.closeHierarchyModal()">
                        ورود به این گام ↗
                      </a>
                    </div>
                    <div class="timeline-step-action">
                      <span class="action-icon">🎯</span>
                      <strong>اقدام اصلی:</strong> ${step.action}
                    </div>
                    <p class="timeline-step-desc">${step.description}</p>
                  </div>
                  ${idx < proc.steps.length - 1 ? '<div class="timeline-connector-line"></div>' : ''}
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    },

    selectModalProcess(processId) {
      const container = document.getElementById('workflow-process-content');
      if (container) {
        container.innerHTML = this.renderProcessDetailCard(processId);
      }
      document.querySelectorAll('.workflow-tab-btn').forEach(btn => {
        const isTarget = btn.id === `tab-${processId}`;
        btn.classList.toggle('active', isTarget);
        btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
      });
    },

    openHierarchyModal(initialProcessId) {
      let modalBackdrop = document.getElementById('workflow-modal-backdrop');
      if (!modalBackdrop) {
        modalBackdrop = document.createElement('div');
        modalBackdrop.id = 'workflow-modal-backdrop';
        modalBackdrop.className = 'modal-backdrop';
        modalBackdrop.setAttribute('role', 'dialog');
        modalBackdrop.setAttribute('aria-modal', 'true');
        modalBackdrop.setAttribute('aria-labelledby', 'workflow-modal-title');
        modalBackdrop.innerHTML = `
          <div class="modal-dialog workflow-modal-dialog" role="document">
            <div class="modal-header">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.25rem;">🧭</span>
                <h3 class="modal-title" id="workflow-modal-title">سلسله‌مراتب استاندارد فرایندهای عملیاتی SALSA</h3>
              </div>
              <button type="button" class="modal-close" onclick="window.GMWorkflows.closeHierarchyModal()" aria-label="بستن پنجره">✕</button>
            </div>
            <div class="modal-body" id="workflow-modal-body" style="padding: 0;">
              <!-- Dynamically populated -->
            </div>
            <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 0.8rem; color: var(--text-secondary);">برای ناوبری سریع در هر گام از دکمه «ورود به این گام» استفاده کنید.</span>
              <button type="button" class="btn btn-secondary btn-sm" onclick="window.GMWorkflows.closeHierarchyModal()">بستن پنجره</button>
            </div>
          </div>
        `;
        document.body.appendChild(modalBackdrop);

        // Backdrop click dismissal
        modalBackdrop.addEventListener('click', (e) => {
          if (e.target === modalBackdrop) {
            this.closeHierarchyModal();
          }
        });
      }

      const body = document.getElementById('workflow-modal-body');
      if (body) {
        body.innerHTML = this.renderHierarchyModalBody(initialProcessId);
      }

      modalBackdrop.classList.add('open');
      document.body.classList.add('modal-open');
    },

    closeHierarchyModal() {
      const modalBackdrop = document.getElementById('workflow-modal-backdrop');
      if (modalBackdrop) {
        modalBackdrop.classList.remove('open');
      }
      document.body.classList.remove('modal-open');
    }
  };

  // Initialize and export globally
  GMWorkflows.init();
  if (typeof window !== 'undefined') {
    window.GMWorkflows = GMWorkflows;
  }

  // Node.js CommonJS export for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GMWorkflows, PROCESSES };
  }
})();
