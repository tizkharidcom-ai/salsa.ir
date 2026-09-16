/**
 * prototype/js/workspaces/index.js
 * 
 * Canonical 6-Workspace Monolith Registry for GODMODE.
 * Defines the canonical workspaces, modules, screen routing metadata, and capabilities.
 */

'use strict';

const GODMODE_WORKSPACES = [
  {
    id: 'overview',
    code: 'COMMAND_CENTER',
    titleFa: 'مرکز فرماندهی',
    titleEn: 'Command Center',
    purposeFa: 'وضعیت، رخداد و اجرای سامانه',
    icon: '◫',
    defaultView: 'gm-02-overview',
    views: [
      { id: 'gm-02', route: 'gm-02-overview', title: 'وضعیت و آمادگی پلتفرم', code: 'GM-02', subgroup: 'تصویر کلان' },
      { id: 'gm-22', route: 'gm-22-operations', title: 'سلامت، رخدادها و هشدارها', code: 'GM-22', subgroup: 'پایش و اجرا' },
      { id: 'gm-25', route: 'gm-25-jobs', title: 'صف اجرا و کارهای پس‌زمینه', code: 'GM-25', subgroup: 'پایش و اجرا' }
    ]
  },
  {
    id: 'customers',
    code: 'CUSTOMERS',
    titleFa: 'مشتریان',
    titleEn: 'Customers & Tenants',
    purposeFa: 'از ایجاد تا قرارداد و پشتیبانی',
    icon: '👥',
    defaultView: 'gm-03-tenants',
    views: [
      { id: 'gm-03', route: 'gm-03-tenants', title: 'فهرست مجموعه‌ها', code: 'GM-03', subgroup: 'فهرست و پرونده' }
    ],
    // Every tenant-owned control is reached after a tenant is selected. These are
    // dossier surfaces, not peer destinations in the platform sidebar.
    dossierTabs: [
      { id: 'gm-04', route: 'gm-04-tenant-detail', title: 'خلاصه و شناسنامه', code: 'GM-04', tab: 'summary' },
      { id: 'gm-28', route: 'gm-28-portal', title: 'قرارداد و پورتال', code: 'GM-28', tab: 'portal' },
      { id: 'gm-06', route: 'gm-06-provisioning', title: 'راه‌اندازی و تحویل', code: 'GM-06', tab: 'provisioning' },
      { id: 'gm-09', route: 'gm-09-tenant-features', title: 'امکانات مشتری', code: 'GM-09', tab: 'features' },
      { id: 'gm-13', route: 'gm-13-identities', title: 'کاربران و پرسنل', code: 'GM-13', tab: 'users' },
      { id: 'gm-14', route: 'gm-14-access-roles', title: 'نقش‌ها و مجوزها', code: 'GM-14', tab: 'users' },
      { id: 'gm-15', route: 'gm-15-simulator', title: 'ارزیابی دسترسی', code: 'GM-15', tab: 'users' },
      { id: 'gm-11', route: 'gm-11-billing', title: 'مالی و صورتحساب‌ها', code: 'GM-11', tab: 'billing' },
      { id: 'gm-12', route: 'gm-12-usage', title: 'مصرف و سهمیه', code: 'GM-12', tab: 'usage' },
      { id: 'gm-19', route: 'gm-19-devices', title: 'دستگاه‌ها و پایانه‌ها', code: 'GM-19', tab: 'devices' },
      { id: 'gm-20', route: 'gm-20-backups', title: 'پشتیبان و بازیابی', code: 'GM-20', tab: 'backups' },
      { id: 'gm-18', route: 'gm-18-domains', title: 'دامنه و برندینگ', code: 'GM-18', tab: 'domains' },
      { id: 'gm-21', route: 'gm-21-support', title: 'تیکت و پشتیبانی', code: 'GM-21', tab: 'support' },
      { id: 'gm-17', route: 'gm-17-customers', title: 'مشتریان نهایی', code: 'GM-17', tab: 'customers' }
    ],
    // Registry entry points that are not tied to a selected dossier.
    customerFlows: [
      { id: 'gm-05', route: 'gm-05-tenant-new', title: 'ایجاد مجموعه جدید', code: 'GM-05' },
      { id: 'gm-07', route: 'gm-07-templates', title: 'الگوهای آماده راه‌اندازی', code: 'GM-07' }
    ]
  },
  {
    id: 'billing',
    code: 'BILLING',
    titleFa: 'مالی و اشتراک',
    titleEn: 'Billing & Subscriptions',
    purposeFa: 'بسته‌ها، فاکتورها و سقف مصرف',
    icon: '💳',
    defaultView: 'gm-08-features',
    views: [
      { id: 'gm-08', route: 'gm-08-features', title: 'کاتالوگ قابلیت‌ها', code: 'GM-08', subgroup: 'کاتالوگ و پلن' },
      { id: 'gm-10', route: 'gm-10-plans', title: 'پلن‌های اشتراک', code: 'GM-10', subgroup: 'کاتالوگ و پلن' }
    ]
  },
  {
    id: 'security',
    code: 'SECURITY',
    titleFa: 'امنیت و دسترسی',
    titleEn: 'Security & Access',
    purposeFa: 'شناسه‌ها، نقش‌ها و احراز هویت',
    icon: '🔒',
    defaultView: 'gm-01-login',
    views: [
      { id: 'gm-01', route: 'gm-01-login', title: 'ورود مدیران ارشد', code: 'GM-01', subgroup: 'احراز هویت' }
    ]
  },
  {
    id: 'infra',
    code: 'INFRASTRUCTURE',
    titleFa: 'زیرساخت و تداوم',
    titleEn: 'Infrastructure & Reliability',
    purposeFa: 'اتوماسیون، نسخه‌ها و کلاسترها',
    icon: '⚙️',
    defaultView: 'gm-24-infrastructure',
    views: [
      { id: 'gm-16', route: 'gm-16-automations', title: 'اتوماسیون و جاب‌های خودکار', code: 'GM-16', subgroup: 'اتوماسیون و بازیابی' },
      { id: 'gm-23', route: 'gm-23-releases', title: 'انتشار نسخه و رول‌بک قناری', code: 'GM-23', subgroup: 'استقرار و زیرساخت' },
      { id: 'gm-24', route: 'gm-24-infrastructure', title: 'سرورها، کلاسترها و شبکه‌ها', code: 'GM-24', subgroup: 'استقرار و زیرساخت' }
    ]
  },
  {
    id: 'governance',
    code: 'GOVERNANCE',
    titleFa: 'حاکمیت و تیم',
    titleEn: 'Governance & Organization',
    purposeFa: 'ردگیری ممیزی و تیم توسعه',
    icon: '🏛️',
    defaultView: 'gm-26-audit',
    views: [
      { id: 'gm-26', route: 'gm-26-audit', title: 'دفتر کل ممیزی و رویدادها', code: 'GM-26', subgroup: 'حاکمیت پلتفرم' },
      { id: 'gm-27', route: 'gm-27-team', title: 'تیم داخلی و ساختار سازمانی', code: 'GM-27', subgroup: 'حاکمیت پلتفرم' }
    ]
  }
];

// Helper to look up workspace by view ID or route
function getWorkspaceForView(viewIdOrRoute) {
  if (!viewIdOrRoute) return null;
  const target = String(viewIdOrRoute).toLowerCase().replace(/^gm-/, 'gm');
  for (const ws of GODMODE_WORKSPACES) {
    const surfaces = [...(ws.views || []), ...(ws.dossierTabs || []), ...(ws.customerFlows || [])];
    const match = surfaces.find(v => {
      const vNorm = v.id.toLowerCase().replace(/^gm-/, 'gm');
      const rNorm = v.route.toLowerCase().replace(/^gm-/, 'gm');
      return target === vNorm || target === rNorm || target.includes(vNorm);
    });
    if (match) return ws;
  }
  return null;
}

if (typeof window !== 'undefined') {
  window.GODMODE_WORKSPACES = GODMODE_WORKSPACES;
  window.getWorkspaceForView = getWorkspaceForView;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GODMODE_WORKSPACES,
    getWorkspaceForView
  };
}
