/**
 * prototype/js/godmode/app/registry.js
 *
 * Canonical Single Source of Truth for SALSA God Mode / Super Admin.
 * Defines exactly 5 primary navigation destinations, their pages, permissions,
 * breadcrumbs, command palette search entries, and complete backward-compatible
 * redirects for all legacy GM01-GM29 routes.
 */

(function (global) {
  'use strict';

  // 1. Exactly 5 Canonical Top-Level Destination Groups (superadmin.md §3)
  const NAVIGATION_GROUPS = Object.freeze([
    {
      id: 'home',
      titleFa: 'خانه',
      purposeFa: 'مرکز کار و کارهای فوری امروز',
      icon: '⌂',
      defaultRoute: 'home',
      order: 1
    },
    {
      id: 'restaurants',
      titleFa: 'رستوران‌ها',
      purposeFa: 'فهرست مجموعه‌ها، رستوران جدید و پرونده رستوران',
      icon: '🏢',
      defaultRoute: 'restaurants',
      order: 2
    },
    {
      id: 'commercial',
      titleFa: 'محصول و مالی',
      purposeFa: 'ماژول‌های محصول، پلن‌ها و مالی ناوگان',
      icon: '💳',
      defaultRoute: 'commercial',
      order: 3
    },
    {
      id: 'operations',
      titleFa: 'عملیات',
      purposeFa: 'کارتابل هشدارها، جاب‌ها، تله‌متری و انتشار',
      icon: '⚡',
      defaultRoute: 'operations',
      order: 4
    },
    {
      id: 'settings',
      titleFa: 'تنظیمات پلتفرم',
      purposeFa: 'تیم سالسا، امنیت، ممیزی و کاتالوگ سخت‌افزار',
      icon: '⚙',
      defaultRoute: 'settings',
      order: 5
    }
  ]);

  // 2. Canonical Restaurant Workspace Tabs (superadmin.md §7)
  const RESTAURANT_WORKSPACE_TABS = Object.freeze([
    { id: 'overview', labelFa: 'نمای کلی', icon: '📋', order: 1, purpose: 'وضعیت در یک نگاه و چک‌لیست راه‌اندازی' },
    { id: 'subscription', labelFa: 'اشتراک و ماژول‌ها', icon: '📦', order: 2, purpose: 'پلن، ماژول‌های تجاری و سهمیه مصرف' },
    { id: 'people', labelFa: 'افراد و دسترسی', icon: '👥', order: 3, purpose: 'مدیران مجموعه و نشست‌های پشتیبانی' },
    { id: 'hardware', labelFa: 'شعب و سخت‌افزار', icon: '🖥', order: 4, purpose: 'دستگاه‌ها، پوز، KDS و پرینترهای شعب' },
    { id: 'channels', labelFa: 'کانال‌ها و برند', icon: '🌐', order: 5, purpose: 'دامنه‌ها، وضعیت TLS و درگاه مشتری' },
    { id: 'reliability', labelFa: 'پایداری و پشتیبانی', icon: '🛡', order: 6, purpose: 'تیکت‌ها، نسخه‌های پشتیبان و همگام‌سازی' },
    { id: 'activity', labelFa: 'فعالیت‌ها', icon: '📜', order: 7, purpose: 'تاریخچه تغییرات و ممیزی قابل‌فهم' }
  ]);

  // 3. Complete Page Definitions with Canonical Routes and Legacy Aliases
  const PAGES = Object.freeze([
    {
      id: 'home',
      canonicalRoute: 'home',
      titleFa: 'خانه — مرکز کار',
      shortTitleFa: 'خانه',
      group: 'home',
      scope: 'platform',
      requiredRole: ['platform_owner', 'platform_operations', 'platform_support', 'platform_finance', 'platform_readonly'],
      inSidebar: true,
      aliases: ['overview', 'gm-02-overview', 'gm-02', 'gm02', '']
    },
    {
      id: 'restaurants',
      canonicalRoute: 'restaurants',
      titleFa: 'فهرست رستوران‌ها و مجموعه‌ها',
      shortTitleFa: 'همه رستوران‌ها',
      group: 'restaurants',
      scope: 'platform',
      requiredRole: ['platform_owner', 'platform_operations', 'platform_support', 'platform_finance', 'platform_readonly'],
      inSidebar: true,
      aliases: ['customers', 'tenants', 'gm-03-tenants', 'gm-03', 'gm03', 'customers/tenants']
    },
    {
      id: 'restaurant-new',
      canonicalRoute: 'restaurants/new',
      titleFa: 'ایجاد مجموعه جدید',
      shortTitleFa: 'رستوران جدید',
      group: 'restaurants',
      scope: 'platform',
      requiredRole: ['platform_owner', 'platform_operations'],
      inSidebar: false,
      parentRoute: 'restaurants',
      aliases: ['customers/new', 'tenants/new', 'gm-05-tenant-new', 'gm-05', 'gm05']
    },
    {
      id: 'restaurant-workspace',
      canonicalRoute: 'restaurants/workspace',
      titleFa: 'پرونده رستوران',
      shortTitleFa: 'پرونده مجموعه',
      group: 'restaurants',
      scope: 'tenant',
      requiredRole: ['platform_owner', 'platform_operations', 'platform_support', 'platform_finance', 'platform_readonly'],
      inSidebar: false,
      parentRoute: 'restaurants',
      aliases: [
        'customer', 'tenants/detail', 'customers/detail',
        'gm-04-tenant-detail', 'gm-04', 'gm04',
        // Legacy subpage jumps now fold into workspace tabs:
        'customer/provisioning', 'gm-06-provisioning', 'gm-06', 'gm06', 'provisioning',
        'customer/features', 'gm-09-tenant-features', 'gm-09', 'gm09', 'tenant-features',
        'customer/billing', 'customer/usage', 'gm-12-usage', 'gm-12', 'gm12', 'usage',
        'customer/users', 'gm-13-identities', 'gm-13', 'gm13', 'identities',
        'customer/access', 'gm-14-access-roles', 'gm-14', 'gm14', 'access/roles',
        'customer/simulator', 'gm-15-simulator', 'gm-15', 'gm15', 'access/simulator',
        'customer/guests', 'gm-17-customers', 'gm-17', 'gm17', 'data/customers',
        'customer/domains', 'gm-18-domains', 'gm-18', 'gm18',
        'customer/devices', 'gm-19-devices', 'gm-19', 'gm19',
        'customer/backups', 'gm-20-backups', 'gm-20', 'gm20',
        'customer/support', 'gm-21-support', 'gm-21', 'gm21',
        'customer/portal', 'gm-28-portal', 'gm-28', 'gm28', 'portal'
      ]
    },
    {
      id: 'commercial',
      canonicalRoute: 'commercial',
      titleFa: 'محصول و مالی پلتفرم',
      shortTitleFa: 'محصول و مالی',
      group: 'commercial',
      scope: 'platform',
      requiredRole: ['platform_owner', 'platform_operations', 'platform_finance', 'platform_readonly'],
      inSidebar: true,
      aliases: [
        'catalog', 'features', 'gm-08-features', 'gm-08', 'gm08', 'product/features',
        'plans', 'gm-10-plans', 'gm-10', 'gm10', 'product/plans',
        'billing', 'gm-11-billing', 'gm-11', 'gm11', 'revenue', 'revenue/invoices', 'revenue/subscriptions'
      ]
    },
    {
      id: 'operations',
      canonicalRoute: 'operations',
      titleFa: 'عملیات پلتفرم',
      shortTitleFa: 'عملیات',
      group: 'operations',
      scope: 'platform',
      requiredRole: ['platform_owner', 'platform_operations', 'platform_support', 'platform_readonly'],
      inSidebar: true,
      aliases: [
        'gm-22-operations', 'gm-22', 'gm22', 'incidents', 'operations/incidents', 'operations/health',
        'jobs', 'gm-25-jobs', 'gm-25', 'gm25',
        'infrastructure', 'gm-24-infrastructure', 'gm-24', 'gm24', 'cells',
        'releases', 'gm-23-releases', 'gm-23', 'gm23',
        'automations', 'gm-16-automations', 'gm-16', 'gm16'
      ]
    },
    {
      id: 'settings',
      canonicalRoute: 'settings',
      titleFa: 'تنظیمات پلتفرم',
      shortTitleFa: 'تنظیمات پلتفرم',
      group: 'settings',
      scope: 'platform',
      requiredRole: ['platform_owner', 'platform_operations', 'platform_readonly'],
      inSidebar: true,
      aliases: [
        'team', 'gm-27-team', 'gm-27', 'gm27',
        'audit', 'gm-26-audit', 'gm-26', 'gm26',
        'login', 'auth', 'gm-01-login', 'gm-01', 'gm01', 'me/security',
        'printers', 'gm-29-printers', 'gm-29', 'gm29', 'settings/printers'
      ]
    }
  ]);

  // Fast Lookup Maps
  const pageById = new Map();
  const routeToPageMap = new Map();

  PAGES.forEach((page) => {
    pageById.set(page.id, page);
    routeToPageMap.set(page.canonicalRoute.toLowerCase(), page);
    (page.aliases || []).forEach((alias) => {
      routeToPageMap.set(alias.toLowerCase(), page);
    });
  });

  // Query parameter stripper for transient keys
  const transientKeys = new Set(['cache', 't', 'ts', '_ts', '_cache', 'timestamp']);

  function cleanQueryString(query) {
    if (!query) return '';
    return query
      .split('&')
      .filter((part) => {
        if (!part) return false;
        const key = part.split('=')[0];
        return !transientKeys.has(key);
      })
      .join('&');
  }

  /**
   * Resolve any raw hash (e.g. #gm-04-tenant-detail?id=westo&tab=features)
   * to canonical target route, page definition, parsed params, and recommended tab.
   */
  function resolveHash(rawHash) {
    let clean = String(rawHash || '').replace(/^#\/?/, '').trim();
    const qIndex = clean.indexOf('?');
    let path = qIndex === -1 ? clean : clean.slice(0, qIndex);
    const queryString = qIndex === -1 ? '' : cleanQueryString(clean.slice(qIndex + 1));
    const params = new URLSearchParams(queryString);

    path = path.toLowerCase();
    if (!path) path = 'home';

    // Check specific legacy route-to-tab mappings for Restaurant Workspace
    let explicitTab = params.get('tab') || null;
    if (!explicitTab) {
      if (['gm-06-provisioning', 'gm-06', 'gm06', 'customer/provisioning', 'provisioning'].includes(path)) explicitTab = 'overview';
      else if (['gm-09-tenant-features', 'gm-09', 'gm09', 'customer/features', 'tenant-features', 'customer/usage', 'gm-12-usage', 'gm-12', 'gm12', 'usage', 'gm-11-billing', 'gm-11', 'gm11', 'billing'].includes(path)) explicitTab = 'subscription';
      else if (['gm-13-identities', 'gm-13', 'gm13', 'customer/users', 'identities', 'gm-14-access-roles', 'gm-14', 'gm14', 'customer/access', 'gm-15-simulator', 'gm-15', 'gm15', 'customer/simulator'].includes(path)) explicitTab = 'people';
      else if (['gm-19-devices', 'gm-19', 'gm19', 'customer/devices', 'gm-29-printers', 'gm-29', 'gm29', 'printers'].includes(path)) explicitTab = 'hardware';
      else if (['gm-18-domains', 'gm-18', 'gm18', 'customer/domains', 'customer/portal', 'gm-28-portal', 'gm-28', 'gm28', 'portal'].includes(path)) explicitTab = 'channels';
      else if (['gm-20-backups', 'gm-20', 'gm20', 'customer/backups', 'gm-21-support', 'gm-21', 'gm21', 'customer/support'].includes(path)) explicitTab = 'reliability';
      else if (['gm-26-audit', 'gm-26', 'gm26'].includes(path) && params.get('id')) explicitTab = 'activity';
      else if (path.includes('gm-04') || path.includes('detail') || path.includes('workspace')) explicitTab = 'overview';
    }

    // Specific legacy route-to-section mappings for Commercial / Operations / Settings
    let section = params.get('section') || null;
    if (!section) {
      if (['plans', 'gm-10-plans', 'gm-10', 'gm10'].includes(path)) section = 'plans';
      else if (['billing', 'gm-11-billing', 'gm-11', 'gm11', 'revenue'].includes(path)) section = 'billing';
      else if (['catalog', 'features', 'gm-08-features', 'gm-08', 'gm08'].includes(path)) section = 'modules';
      else if (['jobs', 'gm-25-jobs', 'gm-25', 'gm25'].includes(path)) section = 'jobs';
      else if (['infrastructure', 'gm-24-infrastructure', 'gm-24', 'gm24', 'cells'].includes(path)) section = 'infra';
      else if (['releases', 'gm-23-releases', 'gm-23', 'gm23'].includes(path)) section = 'releases';
      else if (['automations', 'gm-16-automations', 'gm-16', 'gm16'].includes(path)) section = 'automation';
      else if (['team', 'gm-27-team', 'gm-27', 'gm27'].includes(path)) section = 'team';
      else if (['audit', 'gm-26-audit', 'gm-26', 'gm26'].includes(path) && !params.get('id')) section = 'audit';
      else if (['login', 'auth', 'gm-01-login', 'gm-01', 'gm01', 'me/security'].includes(path)) section = 'security';
      else if (['printers', 'gm-29-printers', 'gm-29', 'gm29'].includes(path)) section = 'hardware';
    }

    let matchedPage = routeToPageMap.get(path) || pageById.get('home');
    if (params.get('id') && explicitTab) {
      matchedPage = pageById.get('restaurant-workspace') || matchedPage;
    }

    // Build canonical hash
    const canonicalParams = new URLSearchParams(queryString);
    if (explicitTab) canonicalParams.set('tab', explicitTab);
    if (section) canonicalParams.set('section', section);

    const canonicalQuery = canonicalParams.toString();
    const canonicalHash = `#${matchedPage.canonicalRoute}${canonicalQuery ? '?' + canonicalQuery : ''}`;

    return {
      page: matchedPage,
      canonicalRoute: matchedPage.canonicalRoute,
      canonicalHash,
      params: Object.fromEntries(canonicalParams.entries()),
      tab: explicitTab,
      section,
      isLegacy: path !== matchedPage.canonicalRoute.toLowerCase()
    };
  }

  // Canonical Command Palette search index generator
  function getCommandPaletteItems() {
    const items = [];

    // Main 5 navigation destinations
    NAVIGATION_GROUPS.forEach((group) => {
      items.push({
        id: `nav-${group.id}`,
        title: group.titleFa,
        subtitle: group.purposeFa,
        icon: group.icon,
        category: 'بخش‌های اصلی',
        hash: `#${group.defaultRoute}`,
        keywords: [group.id, group.titleFa, group.purposeFa]
      });
    });

    // Quick Actions
    items.push({
      id: 'action-create-restaurant',
      title: 'ایجاد رستوران / مجموعه جدید',
      subtitle: 'راه‌اندازی ۳ مرحله‌ای مجموعه جدید',
      icon: '➕',
      category: 'اقدام‌های پرکاربرد',
      hash: '#restaurants/new',
      keywords: ['new', 'create', 'رستوران جدید', 'مجموعه جدید', 'ساخت']
    });

    items.push({
      id: 'action-view-inbox',
      title: 'کارتابل هشدارهای عملیاتی',
      subtitle: 'مشاهده خطاهای راه‌اندازی، بکاپ و دستگاه‌ها',
      icon: '🚨',
      category: 'اقدام‌های پرکاربرد',
      hash: '#operations?section=inbox',
      keywords: ['inbox', 'alerts', 'هشدارها', 'خطاها', 'رسیدگی']
    });

    items.push({
      id: 'action-view-plans',
      title: 'پلن‌ها و تعرفه‌ها',
      subtitle: 'مشاهده و تعریف پلن‌های اشتراک',
      icon: '▣',
      category: 'محصول و مالی',
      hash: '#commercial?section=plans',
      keywords: ['plans', 'پلن', 'قیمت', 'تعرفه']
    });

    items.push({
      id: 'action-view-modules',
      title: 'کاتالوگ ماژول‌های تجاری',
      subtitle: 'مشاهده صندوق، KDS، حسابداری، انبار و CRM',
      icon: '📦',
      category: 'محصول و مالی',
      hash: '#commercial?section=modules',
      keywords: ['modules', 'ماژول', 'امکانات', 'قابلیت']
    });

    items.push({
      id: 'action-view-jobs',
      title: 'صف کارها و اجراهای پس‌زمینه',
      subtitle: 'پایش صف جاب‌های راه‌اندازی و سیستم',
      icon: '↻',
      category: 'عملیات',
      hash: '#operations?section=jobs',
      keywords: ['jobs', 'صف کارها', 'اجرا']
    });

    items.push({
      id: 'action-view-team',
      title: 'مدیریت تیم راهبری سالسا',
      subtitle: 'اعضا و دسترسی‌های تیم پلتفرم',
      icon: '👤',
      category: 'تنظیمات',
      hash: '#settings?section=team',
      keywords: ['team', 'تیم', 'کاربران سالسا', 'ادمین']
    });

    return items;
  }

  // Export to global scope
  const GodModeRegistry = Object.freeze({
    NAVIGATION_GROUPS,
    RESTAURANT_WORKSPACE_TABS,
    PAGES,
    resolveHash,
    getPageById: (id) => pageById.get(id) || null,
    getPageByRoute: (route) => routeToPageMap.get(String(route).toLowerCase()) || null,
    getCommandPaletteItems
  });

  global.GodModeRegistry = GodModeRegistry;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GodModeRegistry;
  }
})(typeof window !== 'undefined' ? window : globalThis);
