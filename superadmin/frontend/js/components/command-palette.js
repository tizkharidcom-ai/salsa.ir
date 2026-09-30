// prototype/js/components/command-palette.js
// Global Findability, Command Palette & Fast Orientation Controller
'use strict';

const GMCommandPalette = {
  isOpen: false,
  activeIndex: 0,
  lastFocusedElement: null,
  filteredItems: [],

  // Canonical task order shared with the sidebar information architecture.
  // Search results follow work domains and workflows instead of legacy GM numbers.
  navigationOrder: [
    'GM02', 'GM22', 'GM25',
    'GM03',
    'GM08', 'GM10',
    'GM01',
    'GM24', 'GM23', 'GM16',
    'GM26', 'GM27'
  ],

  routes: [
    { id: 'GM01', hash: '#gm-01-login', code: 'GM-01', title: 'ورود و امنیت حساب', category: 'هویت و دسترسی', icon: '⌾', keywords: ['login', 'auth', 'ورود', 'احراز', 'هویت', 'نشست', 'امنیت', 'پسورد', 'رمز', 'mfa', 'تایید دو مرحله‌ای'] },
    { id: 'GM02', hash: '#gm-02-overview', code: 'GM-02', title: 'وضعیت و آمادگی پلتفرم', category: 'مرکز فرماندهی', icon: '◫', keywords: ['overview', 'dashboard', 'پیشخوان', 'داشبورد', 'متریک', 'سلامت', 'رویدادها', 'خلاصه', 'وضعیت'] },
    { id: 'GM03', hash: '#gm-03-tenants', code: 'GM-03', title: 'فهرست مجموعه‌ها', category: 'مشتریان', icon: '▦', keywords: ['tenants', 'organizations', 'مجموعه', 'شعب', 'کافه', 'رستوران', 'فهرست', 'مشتری سازمانی'] },
    { id: 'GM04', hash: '#gm-04-tenant-detail', code: 'GM-04', title: 'پرونده کامل مشتری', category: 'مشتریان', icon: '◎', keywords: ['tenant detail', 'detail', 'پرونده', 'شناسنامه', 'وضعیت', 'مشخصات', 'پروفایل', '۳۶۰'], tenantScoped: true, discoverable: false, parentRoute: 'gm-03-tenants' },
    { id: 'GM05', hash: '#gm-05-tenant-new', code: 'GM-05', title: 'ایجاد مجموعه جدید', category: 'مشتریان', icon: '＋', keywords: ['new tenant', 'create', 'onboarding', 'ایجاد', 'مشتری جدید', 'ثبت نام', 'آنبوردینگ', 'ویزارد', 'محیط جدید'], discoverable: false, parentRoute: 'gm-03-tenants' },
    { id: 'GM06', hash: '#gm-06-provisioning', code: 'GM-06', title: 'راه‌اندازی و تحویل محیط', category: 'مشتریان', icon: '⇧', keywords: ['provisioning', 'deploy', 'تحویل', 'آماده سازی', 'پروویژنینگ', 'استقرار', 'دیتابیس', 'سرور', 'vps'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM07', hash: '#gm-07-templates', code: 'GM-07', title: 'الگوهای آماده راه‌اندازی', category: 'مشتریان', icon: '📋', keywords: ['templates', 'blueprints', 'الگوها', 'قالب‌ها', 'آماده سازی', 'تمپلیت', 'راه‌اندازی'], discoverable: false, parentRoute: 'gm-03-tenants' },
    { id: 'GM08', hash: '#gm-08-features', code: 'GM-08', title: 'کاتالوگ سرویس‌ها', category: 'محصول و درآمد', icon: '▤', keywords: ['features', 'modules', 'catalog', 'ماژول‌ها', 'قابلیت‌ها', 'فیچر', 'کاتالوگ', 'امکانات', 'افزونه', 'سرویس'] },
    { id: 'GM09', hash: '#gm-09-tenant-features', code: 'GM-09', title: 'سرویس‌های فعال مشتری', category: 'مشتریان', icon: '◈', keywords: ['tenant features', 'addons', 'فعال‌سازی', 'امکانات مشتری', 'افزونه‌ها', 'فلگ', 'سوئیچ', 'سرویس فعال'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM10', hash: '#gm-10-plans', code: 'GM-10', title: 'پلن‌ها و تعرفه‌ها', category: 'محصول و درآمد', icon: '▣', keywords: ['plans', 'packages', 'pricing', 'پلن‌ها', 'تعرفه‌ها', 'بسته‌ها', 'اشتراک', 'قیمت', 'تیر'] },
    { id: 'GM11', hash: '#gm-11-billing', code: 'GM-11', title: 'اشتراک، صورتحساب و پرداخت', category: 'محصول و درآمد', icon: '◈', keywords: ['billing', 'invoices', 'payment', 'مالی', 'فاکتور', 'اشتراک', 'پرداخت', 'شارژ', 'حسابداری'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM12', hash: '#gm-12-usage', code: 'GM-12', title: 'مصرف و سهمیه مشتری', category: 'محصول و درآمد', icon: '▥', keywords: ['usage', 'quota', 'limits', 'سهمیه', 'مصرف', 'کووتا', 'محدودیت', 'ترافیک', 'استفاده'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM13', hash: '#gm-13-identities', code: 'GM-13', title: 'کاربران و عضویت‌ها', category: 'هویت و دسترسی', icon: '♙', keywords: ['identities', 'users', 'sessions', 'کاربران', 'نشست‌ها', 'سشن', 'سشن‌ها', 'پرسنل', 'اکانت'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM14', hash: '#gm-14-access-roles', code: 'GM-14', title: 'نقش‌ها و مجوزها', category: 'هویت و دسترسی', icon: '♜', keywords: ['roles', 'permissions', 'rbac', 'دسترسی', 'نقش‌ها', 'مجوزها', 'ماتریس', 'صلاحیت'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM15', hash: '#gm-15-simulator', code: 'GM-15', title: 'ارزیابی و تطبیق دسترسی', category: 'هویت و دسترسی', icon: '△', keywords: ['simulator', 'access check', 'ارزیابی دسترسی', 'تست دسترسی', 'ارزیابی مجوز', 'فرمول دسترسی'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM16', hash: '#gm-16-automations', code: 'GM-16', title: 'خودکارسازی و قوانین', category: 'زیرساخت و تداوم', icon: '↯', keywords: ['automations', 'rules', 'triggers', 'خودکارسازی', 'قواعد', 'اتومیشن', 'وب‌هوک', 'تریگر', 'گردش کار'] },
    { id: 'GM17', hash: '#gm-17-customers', code: 'GM-17', title: 'مشتریان نهایی رستوران', category: 'مشتریان', icon: '♧', keywords: ['customers', 'contacts', 'crm', 'مشتریان نهایی', 'مخاطبین', 'کاربران نهایی', 'دفترچه'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM18', hash: '#gm-18-domains', code: 'GM-18', title: 'دامنه و هویت برند', category: 'مشتریان', icon: '◎', keywords: ['domains', 'dns', 'ssl', 'tls', 'دامنه', 'دی ان اس', 'گواهی', 'برندینگ', 'دامنه اختصاصی'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM19', hash: '#gm-19-devices', code: 'GM-19', title: 'دستگاه‌ها و همگام‌سازی', category: 'مشتریان', icon: '▰', keywords: ['devices', 'pos', 'hardware', 'sync', 'پوز', 'سخت‌افزار', 'دستگاه‌ها', 'پرینتر', 'پایانه فروش', 'سینک'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM20', hash: '#gm-20-backups', code: 'GM-20', title: 'پشتیبان و بازیابی', category: 'زیرساخت و تداوم', icon: '▥', keywords: ['backups', 'restore', 'snapshot', 'پشتیبان', 'بکاپ', 'بازیابی', 'اسنپ‌شات', 'دیتابیس', 'پشتیبان‌گیری'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM21', hash: '#gm-21-support', code: 'GM-21', title: 'تیکت و پشتیبانی', category: 'مشتریان', icon: '◇', keywords: ['support', 'tickets', 'helpdesk', 'پشتیبانی', 'تیکت‌ها', 'درخواست‌ها', 'کمک', 'مشکلات'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM22', hash: '#gm-22-operations', code: 'GM-22', title: 'سلامت، رخدادها و هشدارها', category: 'مرکز فرماندهی', icon: '◉', keywords: ['operations', 'health', 'incidents', 'uptime', 'سلامت', 'آپ‌تایم', 'رخدادها', 'حوادث', 'مانیتورینگ', 'پایش'] },
    { id: 'GM23', hash: '#gm-23-releases', code: 'GM-23', title: 'نسخه، انتشار و بازگشت', category: 'زیرساخت و تداوم', icon: '⇄', keywords: ['releases', 'canary', 'rollback', 'deploy', 'انتشار', 'نسخه‌ها', 'کاناری', 'رول‌بک', 'نسخه', 'ورژن'] },
    { id: 'GM24', hash: '#gm-24-infrastructure', code: 'GM-24', title: 'پایش سرور و زیرساخت VPS', category: 'زیرساخت و تداوم', icon: '⬡', keywords: ['infrastructure', 'vps', 'server', 'topology', 'cloud', 'زیرساخت', 'سرور', 'وی‌پی‌اس', 'دیتابیس', 'منابع', 'کلاستر'] },
    { id: 'GM25', hash: '#gm-25-jobs', code: 'GM-25', title: 'صف اجرا و کارهای پس‌زمینه', category: 'مرکز فرماندهی', icon: '↻', keywords: ['jobs', 'queues', 'background', 'retry', 'صف کارها', 'وظایف', 'جاب‌ها', 'پردازش ناهمگام', 'تلاش مجدد'] },
    { id: 'GM26', hash: '#gm-26-audit', code: 'GM-26', title: 'ردپای ممیزی', category: 'حاکمیت پلتفرم', icon: '≣', keywords: ['audit', 'logs', 'compliance', 'ممیزی', 'لاگ‌ها', 'ره‌گیری', 'رویدادهای امنیتی', 'گزارش'] },
    { id: 'GM27', hash: '#gm-27-team', code: 'GM-27', title: 'تیم راهبری و تنظیمات', category: 'حاکمیت پلتفرم', icon: '⚙', keywords: ['team', 'settings', 'config', 'admin', 'تیم', 'راهبران', 'تنظیمات', 'پیکربندی سیستم', 'اعضا'] },
    { id: 'GM28', hash: '#gm-28-portal', code: 'GM-28', title: 'پورتال و قرارداد مشتری', category: 'مشتریان', icon: '▱', keywords: ['portal', 'contract', 'agreement', 'sla', 'پورتال', 'قرارداد', 'سند سازمانی', 'مستندات', 'تعهدات'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' }
  ],

  actions: [
    {
      id: 'act-open-restaurants',
      title: 'فهرست مجموعه‌ها و رستوران‌ها',
      subtitle: 'مشاهده لیست تمام مشتریان سازمانی، وضعیت لایف‌سایکل و شعب',
      icon: '🏢',
      code: 'ناوبری',
      keywords: ['restaurants', 'tenants', 'مجموعه‌ها', 'رستوران‌ها', 'مشتریان', 'کافه'],
      execute: () => {
        window.location.hash = '#restaurants';
      }
    },
    {
      id: 'act-create-restaurant',
      title: 'ایجاد مجموعه / رستوران جدید',
      subtitle: 'ورود به ویزارد راه‌اندازی و ثبت شناسه یکتای مشتری سازمانی',
      icon: '➕',
      code: 'اقدام',
      keywords: ['create', 'new restaurant', 'new tenant', 'ایجاد رستوران', 'افزودن مجموعه', 'آنبوردینگ'],
      execute: () => {
        if (window.GodModeAppShell && typeof window.GodModeAppShell.openOnboardingModal === 'function') {
          window.GodModeAppShell.openOnboardingModal();
        } else {
          window.location.hash = '#restaurants/create';
        }
      }
    },
    {
      id: 'act-search-invoices',
      title: 'جستجو و پایش صورتحساب‌ها و فاکتورها',
      subtitle: 'ورود به بخش مالی، بررسی وضعیت تسویه و فاکتورهای سررسیدشده',
      icon: '💳',
      code: 'مالی',
      keywords: ['invoices', 'billing', 'فاکتور', 'صورتحساب', 'مالی', 'بدهی', 'تسویه'],
      execute: () => {
        window.location.hash = '#commercial?section=billing';
      }
    },
    {
      id: 'act-view-incidents',
      title: 'مرکز رخدادها و حوادث عملیاتی (Incidents)',
      subtitle: 'پایش سلامت پلتفرم، رخدادهای باز و جدول زمانی حل بحران',
      icon: '🚨',
      code: 'عملیات',
      keywords: ['incidents', 'outage', 'رخداد', 'حادثه', 'قطعی', 'بحران', 'سلامت'],
      execute: () => {
        window.location.hash = '#operations?section=incidents';
      }
    },
    {
      id: 'act-open-failed-jobs',
      title: 'صف وظایف و کارهای ناموفق (Failed Jobs)',
      subtitle: 'مشاهده صف جاب‌ها، تلاش‌های مجدد و رهگیری Correlation ID',
      icon: '↻',
      code: 'عملیات',
      keywords: ['failed jobs', 'queues', 'خطا', 'جاب‌ها', 'صف', 'تلاش مجدد', 'outbox'],
      execute: () => {
        window.location.hash = '#operations?section=jobs';
      }
    },
    {
      id: 'act-go-to-audit',
      title: 'ردپای ممیزی سراسری ضدجعل (Audit Trail)',
      subtitle: 'مشاهده زنجیره هش رمزنگاری SHA-256 و لاگ تغییرات حساس پلتفرم',
      icon: '≣',
      code: 'ممیزی',
      keywords: ['audit', 'logs', 'ممیزی', 'لاگ', 'زنجیره هش', 'sha256', 'تغییرات'],
      execute: () => {
        window.location.hash = '#settings?section=audit';
      }
    },
    {
      id: 'act-theme-settings',
      title: 'تنظیم پوسته و تم (روشن / تیره)',
      subtitle: 'باز کردن مودال انتخاب تم روشن، تیره و سیستم',
      icon: '🌓',
      code: 'پوسته',
      keywords: ['theme', 'dark', 'light', 'mode', 'پوسته', 'تم', 'تیره', 'روشن', 'شب', 'روز', 'دارک'],
      execute: () => {
        if (window.GMApp && typeof window.GMApp.openThemeModal === 'function') {
          window.GMApp.openThemeModal();
        }
      }
    },
    {
      id: 'act-kernel-health',
      title: 'پایش سلامت مونولیت ماژولار و ایزولاسیون خطا (۲۸ ماژول)',
      subtitle: 'مشاهده وضعیت سلامت ۶ فضای کاری، مهار خطا و تست پروب زنده',
      icon: '⚡',
      code: 'ماژولار',
      keywords: ['kernel', 'health', 'modular', 'monolith', 'ماژولار', 'مونولیت', 'سلامت', 'مدارشکن', 'ایزولاسیون', 'خطا', 'پروب'],
      execute: () => {
        if (window.GMApp && typeof window.GMApp.openKernelHealthDrawer === 'function') {
          window.GMApp.openKernelHealthDrawer();
        }
      }
    },
    {
      id: 'act-control-plane-setup',
      title: 'الزامات اتصال کنترل‌پلن',
      subtitle: 'مرور الزامات اتصال API امن و چندمستاجری پلتفرم',
      icon: '🛡️',
      code: 'امنیت',
      keywords: ['کنترل‌پلن', 'اتصال', 'امنیت', 'multi tenant', 'api', 'production', 'وستو', 'westo'],
      execute: () => {
        window.location.hash = '#gm-24-infrastructure';
      }
    },
    {
      id: 'act-new-tenant',
      title: 'ایجاد مشتری سازمانی جدید',
      subtitle: 'ورود به ویزارد راه‌اندازی ۵ مرحله‌ای (GM-05)',
      icon: '➕',
      code: 'اقدام',
      keywords: ['ایجاد مشتری', 'ثبت نام', 'جدید', 'آنبوردینگ', 'new tenant', 'create', 'افزودن مشتری'],
      execute: () => {
        window.location.hash = '#gm-05-tenant-new';
      }
    },
    {
      id: 'act-operations-health',
      title: 'پایش سلامت سیستم و سرور VPS',
      subtitle: 'مشاهده آپ‌تایم و وضعیت زیرساخت پلتفرم (GM-22)',
      icon: '🩺',
      code: 'اقدام',
      keywords: ['سلامت', 'پایش', 'مانیتورینگ', 'آپ‌تایم', 'health', 'operations'],
      execute: () => {
        window.location.hash = '#gm-22-operations';
      }
    },
    {
      id: 'act-access-simulator',
      title: 'ارزیابی و تطبیق دسترسی‌ها',
      subtitle: 'بررسی زنده مجوزهای کاربران و فرمول ارزیابی (GM-15)',
      icon: '🛡️',
      code: 'اقدام',
      discoverable: false,
      parentRoute: 'gm-04-tenant-detail',
      keywords: ['ارزیابی دسترسی', 'دسترسی', 'مجوز', 'تست', 'evaluation', 'rbac'],
      execute: () => {
        window.location.hash = '#gm-15-simulator';
      }
    },
    {
      id: 'act-background-jobs',
      title: 'مشاهده صف کارها و وظایف ناهمگام',
      subtitle: 'مدیریت جاب‌ها و تلاش مجدد دسته‌ای (GM-25)',
      icon: '⏱️',
      code: 'اقدام',
      keywords: ['صف کارها', 'جاب', 'وظایف', 'تلاش مجدد', 'jobs', 'queue'],
      execute: () => {
        window.location.hash = '#gm-25-jobs';
      }
    },
    {
      id: 'act-activity-ledger',
      title: 'باز کردن دفتر کل رویدادهای عملیاتی',
      subtitle: 'مشاهده هشدارها، خطاها و تاریخچه پلتفرم',
      icon: '🔔',
      code: 'اقدام',
      keywords: ['رویدادها', 'دفتر کل', 'تاریخچه', 'اعلانات', 'activity', 'ledger', 'events'],
      execute: () => {
        if (window.GMApp && typeof window.GMApp.openActivityDrawer === 'function') {
          window.GMApp.openActivityDrawer('all');
        }
      }
    },
    {
      id: 'act-workflow-directory',
      title: 'نقشه و سلسله‌مراتب استاندارد تمام فرایندها',
      subtitle: 'مشاهده ۶ فرایند استاندارد سازمانی و گام‌های متوالی آن‌ها',
      icon: '🧭',
      code: 'فرایند',
      keywords: ['فرایند', 'فرایندها', 'سلسله مراتب', 'گردش کار', 'workflow', 'process', 'sop', 'مراحل', 'گام‌ها'],
      execute: () => {
        if (window.GMWorkflows && typeof window.GMWorkflows.openHierarchyModal === 'function') {
          window.GMWorkflows.openHierarchyModal();
        }
      }
    },
    {
      id: 'act-proc-onboarding',
      title: 'فرایند ۱: جذب، آماده‌سازی و راه‌اندازی مشتری جدید',
      subtitle: 'گام ۱ از ۷: ثبت مشخصات سازمانی مجموعه جدید (GM-05)',
      icon: '🚀',
      code: 'PROC-01',
      keywords: ['فرایند راه‌اندازی', 'آنبوردینگ', 'ثبت مشتری', 'استقرار', 'onboarding', 'provisioning'],
      execute: () => {
        if (window.GMWorkflows && typeof window.GMWorkflows.navigateToStep === 'function') {
          window.GMWorkflows.navigateToStep('proc-onboarding', 1);
        } else {
          window.location.hash = '#gm-05-tenant-new';
        }
      }
    },
    {
      id: 'act-proc-operations',
      title: 'فرایند ۲: عملیات روزمره و پایش پایانه‌های سالن',
      subtitle: 'گام ۱ از ۵: بررسی وضعیت و آمادگی پلتفرم (GM-02)',
      icon: '⚡',
      code: 'PROC-02',
      keywords: ['فرایند عملیات', 'پایش پایانه', 'پوز', 'همگام‌سازی', 'operations', 'sync'],
      execute: () => {
        if (window.GMWorkflows && typeof window.GMWorkflows.navigateToStep === 'function') {
          window.GMWorkflows.navigateToStep('proc-operations', 1);
        } else {
          window.location.hash = '#gm-02-overview';
        }
      }
    },
    {
      id: 'act-proc-commercial',
      title: 'فرایند ۳: چرخه تجاری، پلن‌ها و صورتحساب',
      subtitle: 'گام ۱ از ۵: کاتالوگ ماژول‌ها و سرویس‌های پلتفرم (GM-08)',
      icon: '💎',
      code: 'PROC-03',
      keywords: ['فرایند تجاری', 'مالی', 'صورتحساب', 'پلن', 'تعرفه', 'commercial', 'billing'],
      execute: () => {
        if (window.GMWorkflows && typeof window.GMWorkflows.navigateToStep === 'function') {
          window.GMWorkflows.navigateToStep('proc-commercial', 1);
        } else {
          window.location.hash = '#gm-08-features';
        }
      }
    },
    {
      id: 'act-proc-security',
      title: 'فرایند ۴: امنیت، هویت سازمانی و حاکمیت دسترسی',
      subtitle: 'گام ۱ از ۶: ورود دومرحله‌ای و امنیت حساب (GM-01)',
      icon: '🛡️',
      code: 'PROC-04',
      keywords: ['فرایند امنیت', 'هویت', 'دسترسی', 'نقش‌ها', 'rbac', 'security', 'governance'],
      execute: () => {
        if (window.GMWorkflows && typeof window.GMWorkflows.navigateToStep === 'function') {
          window.GMWorkflows.navigateToStep('proc-security', 1);
        } else {
          window.location.hash = '#gm-01-login';
        }
      }
    },
    {
      id: 'act-proc-incident',
      title: 'فرایند ۵: مدیریت رخداد، پشتیبانی و بازیابی اضطراری',
      subtitle: 'گام ۱ از ۶: پایش رخدادها و اعلام قطعی (GM-22)',
      icon: '🚨',
      code: 'PROC-05',
      keywords: ['فرایند رخداد', 'حادثه', 'پشتیبانی', 'تیکت', 'بازیابی', 'incident', 'dr'],
      execute: () => {
        if (window.GMWorkflows && typeof window.GMWorkflows.navigateToStep === 'function') {
          window.GMWorkflows.navigateToStep('proc-incident', 1);
        } else {
          window.location.hash = '#gm-22-operations';
        }
      }
    },
    {
      id: 'act-proc-infrastructure',
      title: 'فرایند ۶: زیرساخت، انتشار نسخه و خودکارسازی',
      subtitle: 'گام ۱ از ۴: پایش سرور اختصاصی VPS و اتصالات دیتابیس (GM-24)',
      icon: '⚙️',
      code: 'PROC-06',
      keywords: ['فرایند زیرساخت', 'سرور', 'vps', 'نسخه', 'انتشار', 'infrastructure', 'release'],
      execute: () => {
        if (window.GMWorkflows && typeof window.GMWorkflows.navigateToStep === 'function') {
          window.GMWorkflows.navigateToStep('proc-infrastructure', 1);
        } else {
          window.location.hash = '#gm-24-infrastructure';
        }
      }
    }
  ],

  normalize(str) {
    if (!str) return '';
    return String(str)
      .toLowerCase()
      .replace(/[\u064A\u0649]/g, 'ی')
      .replace(/[\u0643]/g, 'ک')
      .replace(/[\u0629]/g, 'ه')
      .replace(/[\u064B-\u065F]/g, '')
      .replace(/[۰-۹]/g, d => '0123456789'['۰۱۲۳۴۵۶۷۸۹'.indexOf(d)])
      .replace(/[-_]/g, '')
      .trim();
  },

  recordVisit(viewName, routeName) {
    try {
      const cleanRouteName = (routeName || '').replace(/^#\/?/, '').split('?')[0];
      const route = this.routes.find(r => r.id === viewName || r.hash.replace(/^#\/?/, '') === cleanRouteName);
      if (!route || route.id === 'GM01' || route.discoverable === false) return; // Keep tenant surfaces inside the dossier

      let recents = this.getStoredRecents();
      // Remove existing occurrence if already in list
      recents = recents.filter(r => r.id !== route.id);
      // Prepend to top
      recents.unshift({
        id: route.id,
        hash: route.hash,
        code: route.code,
        title: route.title,
        category: route.category,
        icon: route.icon,
        tenantScoped: !!route.tenantScoped
      });
      // Limit to 4
      recents = recents.slice(0, 4);
      localStorage.setItem('salsa_recent_routes', JSON.stringify(recents));
    } catch (e) {}
  },

  getStoredRecents() {
    try {
      const stored = localStorage.getItem('salsa_recent_routes');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          return parsed.filter((item) => {
            const route = this.routes.find((candidate) => candidate.id === item.id);
            return route && route.discoverable !== false;
          });
        }
      }
    } catch (e) {}
    return [];
  },

  getRecents() {
    const stored = this.getStoredRecents();
    if (stored.length > 0) return stored;
    // Default recents if none visited yet
    return [
      this.routes.find(r => r.id === 'GM02'),
      this.routes.find(r => r.id === 'GM03'),
      this.routes.find(r => r.id === 'GM25')
    ].filter(Boolean);
  },

  search(query = '') {
    const q = this.normalize(query);
    if (!q) {
      return {
        isDefault: true,
        recents: this.getRecents(),
        actions: this.actions.filter((action) => action.discoverable !== false),
        tenants: [],
        routes: []
      };
    }

    const tokens = q.split(/\s+/).filter(Boolean);

    const matchesTokens = (targetStr) => {
      const norm = this.normalize(targetStr);
      return tokens.every(t => norm.includes(t));
    };

    // 1. Search actions
    const matchedActions = this.actions.filter(act => act.discoverable !== false && (() => {
      const searchSpace = [act.title, act.subtitle, act.code, ...(act.keywords || [])].join(' ');
      return matchesTokens(searchSpace);
    })());

    // 2. Search restaurants / tenants (§54: Name, Tenant ID, Branch, Domain, Phone, Owner)
    const store = window.GMStore || window.prototypeStore;
    const allTenants = (store && typeof store.getTenants === 'function') ? store.getTenants() : [];
    const matchedTenants = allTenants.filter(t => {
      const branchesStr = (t.branches || []).map(b => `${b.name || ''} ${b.slug || ''}`).join(' ');
      const domainsStr = (t.domains || []).join(' ');
      const searchSpace = [t.name, t.id, t.cell, t.plan, t.status, t.ownerName, t.ownerPhone, t.phone, branchesStr, domainsStr].join(' ');
      return matchesTokens(searchSpace);
    }).map(t => ({
      id: t.id,
      title: t.name,
      subtitle: `مجموعه ${t.id} · پلن ${t.plan || 'business'} · ${t.branches ? t.branches.length : 1} شعبه`,
      code: t.id,
      icon: '🏢',
      execute: () => {
        if (store && typeof store.setActiveTenantId === 'function') {
          store.setActiveTenantId(t.id);
        }
        window.location.hash = `#restaurants/${t.id}/overview`;
      }
    }));

    // 3. Search invoices (§54: Invoice ID, Tenant name, Amount, Period, Status, Payment Ref)
    const allInvoices = (store && typeof store.getInvoices === 'function') ? store.getInvoices() : (store?.state?.invoices || []);
    const matchedInvoices = allInvoices.filter(inv => {
      const searchSpace = [inv.id, inv.tenantName, inv.tenantId, inv.period, inv.status, inv.paymentRef, inv.amount].join(' ');
      return matchesTokens(searchSpace);
    }).map(inv => ({
      id: inv.id,
      title: `فاکتور ${inv.id} (${inv.tenantName || 'مشتری پلتفرم'})`,
      subtitle: `مبلغ: ${typeof inv.amount === 'number' ? inv.amount.toLocaleString('fa-IR') : inv.amount} تومان · وضعیت: ${inv.status || 'معلق'} · دوره ${inv.period || 'جاری'}`,
      code: inv.id,
      icon: '💳',
      execute: () => {
        window.location.hash = `#commercial?section=billing`;
      }
    }));

    // 4. Search devices (§54: Device ID, Name, Model, Serial, Type, Branch)
    const allDevices = (store && typeof store.getHardwareCatalog === 'function') ? store.getHardwareCatalog() : (store?.state?.devices || []);
    const matchedDevices = allDevices.filter(dev => {
      const searchSpace = [dev.id, dev.name, dev.model, dev.serial, dev.type, dev.branch, dev.manufacturer].join(' ');
      return matchesTokens(searchSpace);
    }).map(dev => ({
      id: dev.id,
      title: `${dev.name || dev.model || dev.id}`,
      subtitle: `${dev.type || 'پایانه / چاپگر'} · سازنده: ${dev.manufacturer || 'استاندارد'} · شناسه: ${dev.id}`,
      code: dev.id,
      icon: '🖨️',
      execute: () => {
        window.location.hash = `#settings?section=hardware`;
      }
    }));

    // 5. Search jobs (§54: Job ID, Title, Type, Status, Correlation ID, Request ID)
    const allJobs = (store && typeof store.getBackgroundJobs === 'function') ? store.getBackgroundJobs() : (store?.state?.jobs || []);
    const matchedJobs = allJobs.filter(job => {
      const searchSpace = [job.id, job.title, job.type, job.status, job.correlationId, job.requestId, job.targetTenantId].join(' ');
      return matchesTokens(searchSpace);
    }).map(job => ({
      id: job.id,
      title: `وظیفه ${job.id}: ${job.title || job.type}`,
      subtitle: `وضعیت: ${job.status || 'در صف'} · ردیابی: ${job.correlationId || job.requestId || 'مستقیم'}`,
      code: job.id,
      icon: '⏱️',
      execute: () => {
        window.location.hash = `#operations?section=jobs`;
      }
    }));

    // 6. Search routes
    const matchedRoutes = this.routes.filter(r => r.discoverable !== false && (() => {
      const searchSpace = [r.title, r.code, r.code.replace('-', ''), r.category, ...(r.keywords || [])].join(' ');
      return matchesTokens(searchSpace);
    })()).sort((a, b) => this.navigationOrder.indexOf(a.id) - this.navigationOrder.indexOf(b.id));

    // Merge backend results if available for this query
    if (this._backendResults && Array.isArray(this._backendResults) && this._lastBackendQuery === q) {
      for (const res of this._backendResults) {
        if (res.type === 'restaurant' && !matchedTenants.some(t => t.id === res.id || t.code === res.id.replace('tenant_', ''))) {
          matchedTenants.unshift({
            id: res.id,
            title: res.title,
            subtitle: res.subtitle,
            code: res.id.replace('tenant_', ''),
            icon: '🏢',
            execute: () => { window.location.hash = res.hash; }
          });
        } else if (res.type === 'invoice' && !matchedInvoices.some(i => i.id === res.id || i.code === res.id.replace('inv_', ''))) {
          matchedInvoices.unshift({
            id: res.id,
            title: res.title,
            subtitle: res.subtitle,
            code: res.id.replace('inv_', ''),
            icon: '💳',
            execute: () => { window.location.hash = res.hash; }
          });
        } else if (res.type === 'device' && !matchedDevices.some(d => d.id === res.id || d.code === res.id.replace('dev_', ''))) {
          matchedDevices.unshift({
            id: res.id,
            title: res.title,
            subtitle: res.subtitle,
            code: res.id.replace('dev_', ''),
            icon: '🖨️',
            execute: () => { window.location.hash = res.hash; }
          });
        } else if (res.type === 'job' && !matchedJobs.some(j => j.id === res.id || j.code === res.id.replace('job_', ''))) {
          matchedJobs.unshift({
            id: res.id,
            title: res.title,
            subtitle: res.subtitle,
            code: res.id.replace('job_', ''),
            icon: '⏱️',
            execute: () => { window.location.hash = res.hash; }
          });
        } else if (res.type === 'navigation' && !matchedRoutes.some(r => r.id === res.id || r.hash === res.hash)) {
          matchedRoutes.unshift({
            id: res.id,
            title: res.title,
            category: res.category,
            code: res.badge,
            icon: '⚡',
            hash: res.hash
          });
        }
      }
    }

    return {
      isDefault: false,
      recents: [],
      actions: matchedActions,
      tenants: matchedTenants,
      invoices: matchedInvoices,
      devices: matchedDevices,
      jobs: matchedJobs,
      routes: matchedRoutes
    };
  },

  open() {
    const backdrop = document.getElementById('command-palette-backdrop');
    const input = document.getElementById('command-palette-input');
    if (!backdrop || !input) return;

    this.isOpen = true;
    this.lastFocusedElement = document.activeElement;
    backdrop.classList.add('open');
    backdrop.removeAttribute('aria-hidden');

    input.value = '';
    this.activeIndex = 0;
    this.render();

    // Prevent background scrolling
    if (typeof document !== 'undefined' && document.body) {
      document.body.style.overflow = 'hidden';
    }

    setTimeout(() => {
      input.focus();
    }, 40);
  },

  close() {
    const backdrop = document.getElementById('command-palette-backdrop');
    if (!backdrop) return;

    this.isOpen = false;
    backdrop.classList.remove('open');
    backdrop.setAttribute('aria-hidden', 'true');
    if (typeof document !== 'undefined' && document.body) {
      document.body.style.overflow = '';
    }

    if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
      try { this.lastFocusedElement.focus(); } catch (e) {}
    } else {
      const trigger = document.getElementById('header-command-trigger');
      if (trigger) trigger.focus();
    }
  },

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  },

  render() {
    const input = document.getElementById('command-palette-input');
    const resultsContainer = document.getElementById('command-palette-results');
    const footerMeta = document.getElementById('command-footer-meta');
    if (!resultsContainer) return;

    const query = input ? input.value : '';
    const searchData = this.search(query);

    // Build flattened list of items to facilitate keyboard navigation
    this.filteredItems = [];
    let html = '';

    if (searchData.isDefault) {
      // 1. Recents Group
      if (searchData.recents && searchData.recents.length > 0) {
        html += `<div class="command-group" role="group" aria-label="مقصد‌های اخیر">`;
        html += `<div class="command-group-title"><span>🕒 مقصد‌های اخیر</span><span style="font-family: var(--font-mono); font-size: 0.65rem;">حافظه مسیرها</span></div>`;
        searchData.recents.forEach(item => {
          const itemIdx = this.filteredItems.length;
          this.filteredItems.push({
            type: 'route',
            item: item,
            execute: () => { window.location.hash = item.hash; }
          });
          html += this.renderItemHtml({
            title: item.title,
            subtitle: item.category,
            code: item.code,
            icon: item.icon
          }, itemIdx, 'پرش');
        });
        html += `</div>`;
      }

      // 2. Quick Actions Group
      if (searchData.actions && searchData.actions.length > 0) {
        html += `<div class="command-group" role="group" aria-label="اقدامات سریع">`;
        html += `<div class="command-group-title"><span>اقدامات متداول و سریع</span></div>`;
        searchData.actions.forEach(action => {
          const itemIdx = this.filteredItems.length;
          this.filteredItems.push({
            type: 'action',
            item: action,
            execute: action.execute
          });
          html += this.renderItemHtml(action, itemIdx, 'اجرا');
        });
        html += `</div>`;
      }

      if (footerMeta) {
        const globalRouteCount = this.routes.filter((route) => route.discoverable !== false).length;
        footerMeta.textContent = `${globalRouteCount.toLocaleString('fa-IR')} مقصد سراسری · پرونده مشتری از فهرست مشتریان`;
      }
    } else {
      // Results from query
      const totalMatches = (searchData.actions?.length || 0) +
                           (searchData.tenants?.length || 0) +
                           (searchData.invoices?.length || 0) +
                           (searchData.devices?.length || 0) +
                           (searchData.jobs?.length || 0) +
                           (searchData.routes?.length || 0);

      if (totalMatches === 0) {
        html = `
          <div class="command-empty-state">
            <div class="command-empty-icon" aria-hidden="true"></div>
            <div class="text-primary" style="font-weight: 600;">نتیجه‌ای برای «${this.escapeHtml(query)}» یافت نشد</div>
            <div class="text-secondary" style="font-size: 0.75rem;">عبارت دیگری مانند نام مجموعه، شناسه فاکتور، نام دستگاه، یا کد جاب را امتحان کنید.</div>
          </div>
        `;
        if (footerMeta) {
          footerMeta.textContent = '۰ نتیجه';
        }
      } else {
        // Actions
        if (searchData.actions && searchData.actions.length > 0) {
          html += `<div class="command-group" role="group" aria-label="اقدامات منطبق">`;
          html += `<div class="command-group-title"><span>⚡ اقدامات منطبق (${searchData.actions.length.toLocaleString('fa-IR')})</span></div>`;
          searchData.actions.forEach(act => {
            const itemIdx = this.filteredItems.length;
            this.filteredItems.push({
              type: 'action',
              item: act,
              execute: act.execute
            });
            html += this.renderItemHtml(act, itemIdx, 'اجرا');
          });
          html += `</div>`;
        }

        // Tenants / Restaurants
        if (searchData.tenants && searchData.tenants.length > 0) {
          html += `<div class="command-group" role="group" aria-label="مشتریان و مجموعه‌ها">`;
          html += `<div class="command-group-title"><span>🏢 مجموعه‌ها و رستوران‌ها (${searchData.tenants.length.toLocaleString('fa-IR')})</span></div>`;
          searchData.tenants.forEach(tnt => {
            const itemIdx = this.filteredItems.length;
            this.filteredItems.push({
              type: 'tenant',
              item: tnt,
              execute: tnt.execute
            });
            html += this.renderItemHtml(tnt, itemIdx, 'انتخاب');
          });
          html += `</div>`;
        }

        // Invoices
        if (searchData.invoices && searchData.invoices.length > 0) {
          html += `<div class="command-group" role="group" aria-label="صورتحساب‌ها و مالی">`;
          html += `<div class="command-group-title"><span>💳 صورتحساب‌ها و مالی (${searchData.invoices.length.toLocaleString('fa-IR')})</span></div>`;
          searchData.invoices.forEach(inv => {
            const itemIdx = this.filteredItems.length;
            this.filteredItems.push({
              type: 'invoice',
              item: inv,
              execute: inv.execute
            });
            html += this.renderItemHtml(inv, itemIdx, 'مشاهده');
          });
          html += `</div>`;
        }

        // Devices
        if (searchData.devices && searchData.devices.length > 0) {
          html += `<div class="command-group" role="group" aria-label="دستگاه‌ها و سخت‌افزارها">`;
          html += `<div class="command-group-title"><span>🖨️ پایانه‌ها و دستگاه‌ها (${searchData.devices.length.toLocaleString('fa-IR')})</span></div>`;
          searchData.devices.forEach(dev => {
            const itemIdx = this.filteredItems.length;
            this.filteredItems.push({
              type: 'device',
              item: dev,
              execute: dev.execute
            });
            html += this.renderItemHtml(dev, itemIdx, 'مشاهده');
          });
          html += `</div>`;
        }

        // Jobs
        if (searchData.jobs && searchData.jobs.length > 0) {
          html += `<div class="command-group" role="group" aria-label="وظایف و جاب‌ها">`;
          html += `<div class="command-group-title"><span>⏱️ صف وظایف و پردازش‌ها (${searchData.jobs.length.toLocaleString('fa-IR')})</span></div>`;
          searchData.jobs.forEach(job => {
            const itemIdx = this.filteredItems.length;
            this.filteredItems.push({
              type: 'job',
              item: job,
              execute: job.execute
            });
            html += this.renderItemHtml(job, itemIdx, 'رهگیری');
          });
          html += `</div>`;
        }

        // Routes
        if (searchData.routes && searchData.routes.length > 0) {
          html += `<div class="command-group" role="group" aria-label="صفحات و نماها">`;
          html += `<div class="command-group-title"><span>📑 مقاصد پلتفرم (${searchData.routes.length.toLocaleString('fa-IR')})</span></div>`;
          searchData.routes.forEach(r => {
            const itemIdx = this.filteredItems.length;
            this.filteredItems.push({
              type: 'route',
              item: r,
              execute: () => { window.location.hash = r.hash; }
            });
            html += this.renderItemHtml({
              title: r.title,
              subtitle: r.category,
              code: r.code,
              icon: r.icon
            }, itemIdx, 'پرش');
          });
          html += `</div>`;
        }

        if (footerMeta) {
          footerMeta.textContent = `${totalMatches.toLocaleString('fa-IR')} نتیجه منطبق`;
        }
      }
    }

    resultsContainer.innerHTML = html;

    // Normalize active index
    if (this.activeIndex >= this.filteredItems.length) {
      this.activeIndex = Math.max(0, this.filteredItems.length - 1);
    }
    this.updateActiveItemVisuals();
  },

  renderItemHtml(item, index, actionBadgeText = 'پرش') {
    const isActive = index === this.activeIndex;
    return `
      <div class="command-item ${isActive ? 'is-active' : ''}" 
           id="command-item-${index}" 
           role="option" 
           aria-selected="${isActive}" 
           data-item-index="${index}"
           onclick="window.GMCommandPalette.selectIndex(${index})">
        <div class="command-item-icon" aria-hidden="true">${item.icon || '📄'}</div>
        <div class="command-item-content">
          <div class="command-item-title-row">
            <span class="command-item-title">${this.escapeHtml(item.title)}</span>
            ${item.code ? `<span class="command-item-code">${this.escapeHtml(item.code)}</span>` : ''}
          </div>
          ${item.subtitle ? `<div class="command-item-subtitle">${this.escapeHtml(item.subtitle)}</div>` : ''}
        </div>
        <span class="command-item-action" aria-hidden="true">${actionBadgeText} ↵</span>
      </div>
    `;
  },

  updateActiveItemVisuals() {
    const items = document.querySelectorAll('.command-palette-body .command-item');
    items.forEach((el, idx) => {
      const isSelected = idx === this.activeIndex;
      if (isSelected) {
        el.classList.add('is-active');
        el.setAttribute('aria-selected', 'true');
        el.scrollIntoView({ block: 'nearest' });
      } else {
        el.classList.remove('is-active');
        el.setAttribute('aria-selected', 'false');
      }
    });
    const input = document.getElementById('command-palette-input');
    if (input && this.filteredItems.length > 0) {
      input.setAttribute('aria-activedescendant', `command-item-${this.activeIndex}`);
    } else if (input) {
      input.removeAttribute('aria-activedescendant');
    }
  },

  navigate(direction) {
    if (this.filteredItems.length === 0) return;
    this.activeIndex = (this.activeIndex + direction + this.filteredItems.length) % this.filteredItems.length;
    this.updateActiveItemVisuals();
  },

  selectIndex(index) {
    if (index >= 0 && index < this.filteredItems.length) {
      const selected = this.filteredItems[index];
      this.close();
      if (selected && typeof selected.execute === 'function') {
        selected.execute();
      }
    }
  },

  activateSelected() {
    if (this.filteredItems.length > 0 && this.activeIndex >= 0 && this.activeIndex < this.filteredItems.length) {
      this.selectIndex(this.activeIndex);
    }
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  _searchTimer: null,
  _lastBackendQuery: '',
  _backendResults: null,

  triggerBackendSearch(query) {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
    const q = (query || '').trim();
    if (q.length < 2) {
      this._backendResults = null;
      this._lastBackendQuery = '';
      return;
    }
    this._searchTimer = setTimeout(async () => {
      try {
        let results = null;
        if (window.ControlPlaneClient && typeof window.ControlPlaneClient.get === 'function') {
          const res = await window.ControlPlaneClient.get(`/api/control/search?q=${encodeURIComponent(q)}`);
          if (res && (res.ok || res.success) && res.data) {
            results = res.data.results || [];
          }
        } else if (typeof fetch === 'function') {
          const res = await fetch(`/api/control/search?q=${encodeURIComponent(q)}`, {
            headers: { 'Accept': 'application/json' },
            credentials: 'include'
          });
          if (res.ok) {
            const body = await res.json();
            results = body.data?.results || [];
          }
        }
        if (results) {
          const inputEl = document.getElementById('command-palette-input');
          if (inputEl && inputEl.value.trim() === q) {
            this._backendResults = results;
            this._lastBackendQuery = this.normalize(q);
            this.render();
          }
        }
      } catch (_) {}
    }, 200);
  },

  initListeners() {
    const input = document.getElementById('command-palette-input');
    if (input) {
      input.addEventListener('input', () => {
        this.activeIndex = 0;
        this.render();
        this.triggerBackendSearch(input.value);
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.navigate(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.navigate(-1);
        } else if (e.key === 'Home') {
          e.preventDefault();
          this.activeIndex = 0;
          this.updateActiveItemVisuals();
        } else if (e.key === 'End') {
          e.preventDefault();
          this.activeIndex = Math.max(0, this.filteredItems.length - 1);
          this.updateActiveItemVisuals();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          this.activateSelected();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.close();
        }
      });
    }

    const backdrop = document.getElementById('command-palette-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          this.close();
        }
      });
    }
  }
};

if (typeof window !== 'undefined') {
  window.GMCommandPalette = GMCommandPalette;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GMCommandPalette;
  module.exports.GMCommandPalette = GMCommandPalette;
}
