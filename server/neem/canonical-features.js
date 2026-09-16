// server/neem/canonical-features.js
'use strict';

/**
 * 48 Canonical Sellable Features of the NEEM Restaurant Platform
 * Categorized into 12 functional domains.
 */
const CANONICAL_FEATURES = Object.freeze([
  // 1. Core & Base (4)
  { key: 'core.workspace', nameFa: 'فضای کاری پایه و مشخصات سازمانی', category: 'core', dependencies: [] },
  { key: 'core.multi_branch', nameFa: 'مدیریت شعب چندگانه و ساختار هلدینگ', category: 'core', dependencies: ['core.workspace'] },
  { key: 'core.audit_trail', nameFa: 'لاگ پیشرفته ممیزی و امنیت داده', category: 'core', dependencies: ['core.workspace'] },
  { key: 'core.backup_retention', nameFa: 'بکاپ‌گیری بلادرنگ و ماندگاری ابری', category: 'core', dependencies: ['core.workspace'] },

  // 2. Catalog & Menu (5)
  { key: 'catalog.menu', nameFa: 'منوی دیجیتال و دسته‌بندی اقلام', category: 'catalog', dependencies: ['core.workspace'] },
  { key: 'catalog.modifiers', nameFa: 'تاپینگ‌ها و گزینه‌های سفارشی غذا', category: 'catalog', dependencies: ['catalog.menu'] },
  { key: 'catalog.pricing', nameFa: 'قیمت‌گذاری پیشرفته چندسطحی', category: 'catalog', dependencies: ['catalog.menu'] },
  { key: 'catalog.languages', nameFa: 'منوی چندزبانه بین‌المللی', category: 'catalog', dependencies: ['catalog.menu'] },
  { key: 'catalog.print', nameFa: 'قالب‌های چاپ و خروجی فیزیکی منو', category: 'catalog', dependencies: ['catalog.menu'] },

  // 3. Orders & POS (5)
  { key: 'orders.pos', nameFa: 'صندوق فروشگاهی لمسی (POS)', category: 'orders', dependencies: ['catalog.menu'] },
  { key: 'orders.online', nameFa: 'سفارش‌گیری آنلاین مشتریان', category: 'orders', dependencies: ['catalog.menu'] },
  { key: 'orders.advanced', nameFa: 'تفکیک فاکتور و کورس‌های سرو غذا', category: 'orders', dependencies: ['orders.pos'] },
  { key: 'orders.discounts', nameFa: 'کوپن‌ها و تخفیف‌های خودکار سبد خرید', category: 'orders', dependencies: ['orders.pos'] },
  { key: 'orders.offline_sync', nameFa: 'ثبت سفارش در قطعی اینترنت و سینک محلی', category: 'orders', dependencies: ['orders.pos'] },

  // 4. Floor, Hall & Tables (4)
  { key: 'floor.tables', nameFa: 'مدیریت میزها و نقشه سالن', category: 'floor', dependencies: ['core.workspace'] },
  { key: 'floor.qr', nameFa: 'سفارش سر میز با کیوآرکد اختصاصی', category: 'floor', dependencies: ['floor.tables', 'orders.online'] },
  { key: 'staff.waiter', nameFa: 'ترمینال سیار گارسون', category: 'floor', dependencies: ['floor.tables'] },
  { key: 'floor.service_charge', nameFa: 'حق سرویس و مالیات سالن', category: 'floor', dependencies: ['floor.tables'] },

  // 5. Kitchen & KDS (3)
  { key: 'kitchen.kds', nameFa: 'نمایشگر آشپزخانه (KDS)', category: 'kitchen', dependencies: ['orders.pos'] },
  { key: 'kitchen.stations', nameFa: 'تفکیک ایستگاه‌های پخت و بار', category: 'kitchen', dependencies: ['kitchen.kds'] },
  { key: 'kitchen.expediter', nameFa: 'ایستگاه اکسپدایتر و بازرسی نهایی سینی', category: 'kitchen', dependencies: ['kitchen.kds'] },

  // 6. Reservations & Waitlist (3)
  { key: 'booking.reservations', nameFa: 'رزرو آنلاین و مدیریت تقویم میز', category: 'booking', dependencies: ['floor.tables'] },
  { key: 'booking.waitlist', nameFa: 'صف انتظار هوشمند مهمانان حضوری', category: 'booking', dependencies: ['floor.tables'] },
  { key: 'booking.deposit', nameFa: 'پیش‌دریافت و بیعانه رزرو', category: 'booking', dependencies: ['booking.reservations'] },

  // 7. Delivery & Dispatch (3)
  { key: 'delivery.dispatch', nameFa: 'مدیریت ناوگان پیک و دیسپچ هوشمند', category: 'delivery', dependencies: ['orders.online'] },
  { key: 'delivery.zones', nameFa: 'محدوده‌های کرایه و نقشه‌بندی شهری', category: 'delivery', dependencies: ['delivery.dispatch'] },
  { key: 'delivery.tracking', nameFa: 'پیگیری زنده موقعیت پیک روی نقشه', category: 'delivery', dependencies: ['delivery.dispatch'] },

  // 8. Payments & Cash (3)
  { key: 'payments.gateway', nameFa: 'درگاه پرداخت اینترنتی شاپرک', category: 'payments', dependencies: ['orders.online'] },
  { key: 'cash.drawers', nameFa: 'صندوق نقدی و کنترل شیفت صندوق‌دار', category: 'payments', dependencies: ['orders.pos'] },
  { key: 'payments.terminal_link', nameFa: 'اتصال مستقیم نرم‌افزار به کارتخوان (PC-POS)', category: 'payments', dependencies: ['orders.pos'] },

  // 9. Finance & Ledger (7)
  { key: 'finance.workspace', nameFa: 'حسابداری دوبل و دفاتر قانونی', category: 'finance', dependencies: ['core.workspace'] },
  { key: 'finance.purchases', nameFa: 'فاکتور خرید و حساب بستانکاران', category: 'finance', dependencies: ['finance.workspace'] },
  { key: 'finance.reconciliation', nameFa: 'مغایرت‌گیری خودکار بانکی', category: 'finance', dependencies: ['finance.workspace'] },
  { key: 'finance.assets', nameFa: 'اموال و استهلاک دارایی‌های رستوران', category: 'finance', dependencies: ['finance.workspace'] },
  { key: 'finance.payroll', nameFa: 'حقوق و دستمزد پرسنل', category: 'finance', dependencies: ['finance.workspace'] },
  { key: 'finance.tax_adapter', nameFa: 'اتصال به سامانه مؤدیان و مالیات', category: 'finance', dependencies: ['finance.workspace'] },
  { key: 'finance.consolidation', nameFa: 'تلفیق مالی شعب چندگانه', category: 'finance', dependencies: ['finance.workspace', 'core.multi_branch'] },

  // 10. Inventory & Recipes (3)
  { key: 'stock.inventory', nameFa: 'انبارداری و شمارش لحظه‌ای موجودی', category: 'inventory', dependencies: ['core.workspace'] },
  { key: 'stock.recipes', nameFa: 'رسپی و بهای تمام‌شده غذا (COGS)', category: 'inventory', dependencies: ['stock.inventory', 'catalog.menu'] },
  { key: 'stock.procurement', nameFa: 'سفارش‌گذاری خودکار کسری انبار', category: 'inventory', dependencies: ['stock.inventory'] },

  // 11. CRM & Marketing (5)
  { key: 'crm.directory', nameFa: 'دایرکتوری مشتریان و پروفایل مصرف', category: 'crm', dependencies: ['core.workspace'] },
  { key: 'crm.loyalty', nameFa: 'باشگاه مشتریان و امتیازات خرید', category: 'crm', dependencies: ['crm.directory'] },
  { key: 'crm.wallet', nameFa: 'کیف پول اعتباری مشتری', category: 'crm', dependencies: ['crm.directory'] },
  { key: 'marketing.campaigns', nameFa: 'کمپین‌های تخفیفی و خودکارسازی', category: 'crm', dependencies: ['crm.directory'] },
  { key: 'marketing.sms', nameFa: 'پیامک هوشمند اطلاع‌رسانی و بازاریابی', category: 'crm', dependencies: ['crm.directory'] },

  // 12. Brand & Insights (4)
  { key: 'content.website', nameFa: 'وب‌سایت اختصاصی برند', category: 'brand', dependencies: ['core.workspace'] },
  { key: 'brand.custom_domain', nameFa: 'دامنه اینترنتی اختصاصی (ir / com)', category: 'brand', dependencies: ['content.website'] },
  { key: 'brand.white_label', nameFa: 'حذف لوگوی پلتفرم (وایت‌لیبل کامل)', category: 'brand', dependencies: ['brand.custom_domain'] },
  { key: 'insights.reports', nameFa: 'گزارش‌های تحلیلی و سود و زیان دوره‌ای', category: 'insights', dependencies: ['core.workspace'] }
]);

const FEATURE_MAP = new Map(CANONICAL_FEATURES.map((f) => [f.key, f]));

/**
 * Maps incoming route prefixes to corresponding feature requirement
 */
function resolveFeatureForRoute(req) {
  const p = String(req.path || '').toLowerCase();

  // 1. Finance
  if (p.startsWith('/api/admin/finance') || p.startsWith('/api/admin/v2/finance') || p === '/admin/finance.html') {
    return 'finance.workspace';
  }

  // 2. POS & Cashier
  if (p.startsWith('/api/cashier') || p.startsWith('/api/staff/orders') || p === '/pos' || p === '/pos.html' || p === '/admin/cashier') {
    return 'orders.pos';
  }

  // 3. Public Order Mutations
  if (p === '/api/orders' && req.method === 'POST') {
    return 'orders.pos';
  }
  if (p.startsWith('/api/checkout') && req.method === 'POST') {
    return 'orders.online';
  }

  // 4. Waiter & Floor Service
  if (p.startsWith('/api/waiter') && !p.includes('/waitlist')) {
    return 'staff.waiter';
  }
  if (p.startsWith('/api/call-waiter') || p === '/waiter' || p === '/waiter.html' || p === '/admin/waiter') {
    return 'staff.waiter';
  }

  // 5. Tables & Architectural Floor
  if (p.startsWith('/api/admin/tables') || p.startsWith('/api/floor/tables')) {
    return 'floor.tables';
  }

  // 6. Kitchen & KDS
  if (p.startsWith('/api/kitchen') && !p.includes('/inventory')) {
    return 'kitchen.kds';
  }
  if (p === '/kds' || p === '/kitchen' || p === '/kitchen.html' || p === '/admin/kitchen') {
    return 'kitchen.kds';
  }

  // 7. Reservations & Waitlist
  if (p.startsWith('/api/reservations')) {
    return 'booking.reservations';
  }
  if (p.startsWith('/api/waiter/waitlist')) {
    return 'booking.waitlist';
  }

  // 8. Inventory & Stock
  if (p.startsWith('/api/admin/inventory') || p.startsWith('/api/kitchen/inventory')) {
    if (p.includes('recipe-version')) return 'stock.recipes';
    return 'stock.inventory';
  }

  // 9. Loyalty & CRM
  if (p.startsWith('/api/admin/loyalty') || p.includes('/apply-loyalty')) {
    return 'crm.loyalty';
  }
  if (p.startsWith('/api/wallet')) {
    return 'crm.wallet';
  }

  // 10. Delivery
  if (p.startsWith('/api/admin/delivery-zones') || p.startsWith('/api/delivery')) {
    return 'delivery.zones';
  }

  // 11. Analytics & Reports
  if (p.startsWith('/api/admin/analytics')) {
    return 'insights.reports';
  }

  return null;
}

/**
 * Checks whether a feature is active for the given database state
 */
function isFeatureEnabledForTenant(tenantDb, featureKey) {
  if (!featureKey) return true;
  const isWestoPilot = tenantDb?.tenantIdentity?.tenantId === 'westo' || !tenantDb?.tenantIdentity?.tenantId;
  const entitlements = tenantDb?.featureEntitlements || tenantDb?.neemEntitlements || null;

  if (!entitlements) {
    return isWestoPilot;
  }

  const grant = entitlements[featureKey];
  if (grant === true) return true;
  if (!grant) {
    return isWestoPilot;
  }

  if (grant.active === false || grant.status === 'disabled') return false;
  if (grant.expiresAt && new Date(grant.expiresAt).getTime() <= Date.now()) return false;
  return true;
}

function getFeatureInfo(featureKey) {
  return FEATURE_MAP.get(featureKey) || { key: featureKey, nameFa: featureKey, category: 'other' };
}

module.exports = {
  CANONICAL_FEATURES,
  FEATURE_MAP,
  resolveFeatureForRoute,
  isFeatureEnabledForTenant,
  getFeatureInfo,
};
