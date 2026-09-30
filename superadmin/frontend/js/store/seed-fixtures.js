/**
 * prototype/js/store/seed-fixtures.js
 * 
 * Canonical Seed Fixtures and Reference Catalogs for SALSA GODMODE Prototype.
 * 100% Synthetic, fail-closed, isolated from live database runtime.
 */

'use strict';

const CANONICAL_FEATURES = [
  { key: 'core.workspace', nameFa: 'فضای کاری اصلی رستوران', category: 'پایه', pricePerMonth: 0, dependencies: [] },
  { key: 'catalog.menu', nameFa: 'منوی دیجیتال و دسته‌بندی', category: 'کاتالوگ', pricePerMonth: 0, dependencies: ['core.workspace'] },
  { key: 'catalog.modifiers', nameFa: 'تاپینگ‌ها و گزینه‌های سفارشی', category: 'کاتالوگ', pricePerMonth: 150000, dependencies: ['catalog.menu'] },
  { key: 'catalog.pricing', nameFa: 'قیمت‌گذاری پیشرفته و متغیر', category: 'کاتالوگ', pricePerMonth: 200000, dependencies: ['catalog.menu'] },
  { key: 'catalog.languages', nameFa: 'منوی چندزبانه (بین‌المللی)', category: 'کاتالوگ', pricePerMonth: 180000, dependencies: ['catalog.menu'] },
  { key: 'catalog.print', nameFa: 'قالب‌های چاپ و خروجی فیزیکی منو', category: 'کاتالوگ', pricePerMonth: 120000, dependencies: ['catalog.menu'] },
  
  { key: 'orders.online', nameFa: 'سفارش‌گیری آنلاین مشتریان', category: 'سفارشات', pricePerMonth: 350000, dependencies: ['catalog.menu'] },
  { key: 'orders.pos', nameFa: 'صندوق فروشگاهی لمسی (POS)', category: 'سفارشات', pricePerMonth: 450000, dependencies: ['catalog.menu'] },
  { key: 'orders.advanced', nameFa: 'تفکیک صورتحساب و کورس غذا', category: 'سفارشات', pricePerMonth: 250000, dependencies: ['orders.pos'] },
  
  { key: 'floor.tables', nameFa: 'مدیریت میزها و نقشه سالن', category: 'سالن', pricePerMonth: 200000, dependencies: ['core.workspace'] },
  { key: 'floor.qr', nameFa: 'سفارش سر میز با کیوآرکد اختصاصی', category: 'سالن', pricePerMonth: 220000, dependencies: ['floor.tables', 'orders.online'] },
  { key: 'staff.waiter', nameFa: 'ترمینال سیار گارسون', category: 'پرسنل', pricePerMonth: 300000, dependencies: ['floor.tables'] },
  { key: 'kitchen.kds', nameFa: 'نمایشگر آشپزخانه (KDS)', category: 'آشپزخانه', pricePerMonth: 400000, dependencies: ['orders.pos'] },
  
  { key: 'booking.reservations', nameFa: 'رزرو آنلاین میز', category: 'رزرو', pricePerMonth: 280000, dependencies: ['floor.tables'] },
  { key: 'booking.waitlist', nameFa: 'صف انتظار هوشمند مهمانان', category: 'رزرو', pricePerMonth: 190000, dependencies: ['floor.tables'] },
  { key: 'delivery.dispatch', nameFa: 'مدیریت پیک و ارسال اختصاصی', category: 'تحویل', pricePerMonth: 320000, dependencies: ['orders.online'] },
  
  { key: 'payments.gateway', nameFa: 'درگاه پرداخت آنلاین شاپرک', category: 'مالی', pricePerMonth: 0, dependencies: ['orders.online'] },
  { key: 'cash.drawers', nameFa: 'مدیریت صندوق نقدی و شفت', category: 'مالی', pricePerMonth: 200000, dependencies: ['orders.pos'] },
  { key: 'finance.workspace', nameFa: 'حسابداری دوبل و اسناد دفاتر', category: 'مالی', pricePerMonth: 600000, dependencies: ['core.workspace'] },
  { key: 'finance.purchases', nameFa: 'فاکتور خرید و بستانکاران', category: 'مالی', pricePerMonth: 350000, dependencies: ['finance.workspace'] },
  { key: 'finance.reconciliation', nameFa: 'مغایرت‌گیری بانکی پوز', category: 'مالی', pricePerMonth: 400000, dependencies: ['finance.workspace'] },
  { key: 'finance.assets', nameFa: 'اموال و استهلاک دارایی‌ها', category: 'مالی', pricePerMonth: 250000, dependencies: ['finance.workspace'] },
  { key: 'finance.payroll', nameFa: 'حقوق و دستمزد و کارکرد پرسنل', category: 'مالی', pricePerMonth: 380000, dependencies: ['finance.workspace'] },
  { key: 'finance.tax_adapter', nameFa: 'سامانه مؤدیان و کارتخوان', category: 'مالی', pricePerMonth: 500000, dependencies: ['finance.workspace'] },
  { key: 'finance.consolidation', nameFa: 'تلفیق مالی چند شعبه‌ای', category: 'مالی', pricePerMonth: 800000, dependencies: ['finance.workspace', 'platform.multi_branch'] },
  
  { key: 'stock.inventory', nameFa: 'انبارداری و شمارش موجودی', category: 'انبار', pricePerMonth: 400000, dependencies: ['core.workspace'] },
  { key: 'stock.recipes', nameFa: 'دستور تهیه و بهای تمام‌شده غذا (COGS)', category: 'انبار', pricePerMonth: 550000, dependencies: ['stock.inventory', 'catalog.menu'] },
  { key: 'stock.procurement', nameFa: 'سفارش خرید و کسری هوشمند', category: 'انبار', pricePerMonth: 300000, dependencies: ['stock.inventory'] },
  
  { key: 'crm.directory', nameFa: 'دفترچه تلفن و پروفایل مشتریان', category: 'CRM', pricePerMonth: 0, dependencies: ['core.workspace'] },
  { key: 'crm.loyalty', nameFa: 'باشگاه مشتریان و امتیازات', category: 'CRM', pricePerMonth: 450000, dependencies: ['crm.directory'] },
  { key: 'crm.wallet', nameFa: 'کیف پول شارژی مشتری', category: 'CRM', pricePerMonth: 250000, dependencies: ['crm.directory'] },
  { key: 'marketing.campaigns', nameFa: 'کمپین‌های تخفیف و مناسبتی', category: 'مارکتینگ', pricePerMonth: 300000, dependencies: ['crm.directory'] },
  { key: 'marketing.sms', nameFa: 'پیامک هوشمند و اطلاع‌رسانی', category: 'مارکتینگ', pricePerMonth: 200000, dependencies: ['crm.directory'] },
  
  { key: 'content.website', nameFa: 'وب‌سایت اختصاصی و محتوا', category: 'برند', pricePerMonth: 350000, dependencies: ['core.workspace'] },
  { key: 'brand.custom_domain', nameFa: 'دامنه اختصاصی مشتری (ir/com)', category: 'برند', pricePerMonth: 250000, dependencies: ['content.website'] },
  { key: 'brand.white_label', nameFa: 'حذف برند سالسا (وایت‌لیبل)', category: 'برند', pricePerMonth: 600000, dependencies: ['brand.custom_domain'] },
  
  { key: 'insights.reports', nameFa: 'گزارش‌های دوره‌ای و فصلی', category: 'گزارشات', pricePerMonth: 200000, dependencies: ['core.workspace'] },
  { key: 'insights.analytics', nameFa: 'داشبورد تحلیلی فروش و سالن', category: 'گزارشات', pricePerMonth: 400000, dependencies: ['insights.reports'] },
  { key: 'insights.cost_control', nameFa: 'تحلیل نقطه سربه‌سر و هزینه', category: 'گزارشات', pricePerMonth: 500000, dependencies: ['stock.recipes', 'finance.workspace'] },
  { key: 'insights.local_ai', nameFa: 'پیش‌بینی هوشمند مصرف محلی', category: 'گزارشات', pricePerMonth: 700000, dependencies: ['insights.analytics'] },
  
  { key: 'staff.management', nameFa: 'مدیریت شیفت و سطوح دسترسی', category: 'پرسنل', pricePerMonth: 200000, dependencies: ['core.workspace'] },
  { key: 'platform.multi_branch', nameFa: 'پشتیبانی از شبکه چندشعبه‌ای', category: 'پلتفرم', pricePerMonth: 850000, dependencies: ['core.workspace'] },
  { key: 'platform.edge', nameFa: 'همگام‌سازی محلی و چاپ LAN', category: 'پلتفرم', pricePerMonth: 450000, dependencies: ['orders.pos'] },
  { key: 'platform.desktop', nameFa: 'اپلیکیشن دسکتاپ آفلاین', category: 'پلتفرم', pricePerMonth: 350000, dependencies: ['platform.edge'] },
  
  { key: 'infra.high_avail', nameFa: 'تضمین پایداری ۹۹.۹٪ و Failover', category: 'زیرساخت', pricePerMonth: 950000, dependencies: ['core.workspace'] },
  { key: 'infra.hourly_backup', nameFa: 'پشتیبان‌گیری ساعتی رمزنگاری‌شده', category: 'زیرساخت', pricePerMonth: 400000, dependencies: ['core.workspace'] },
  { key: 'infra.dedicated_ip', nameFa: 'آی‌پی اختصاصی و تونل امن', category: 'زیرساخت', pricePerMonth: 300000, dependencies: ['core.workspace'] },
  { key: 'infra.audit_vault', nameFa: 'مخزن لاگ حسابرسی غیرقابل‌تغییر', category: 'زیرساخت', pricePerMonth: 500000, dependencies: ['core.workspace'] }
];

const CANONICAL_PLANS = [
  {
    id: 'starter',
    nameFa: 'پایه (استارتر)',
    nameEn: 'Starter',
    basePrice: 950000,
    featuresIncluded: ['core.workspace', 'catalog.menu', 'crm.directory'],
    maxBranches: 1,
    maxDevices: 2,
    supportLevel: 'استاندارد (تیکت)'
  },
  {
    id: 'growth',
    nameFa: 'رشد و توسعه (پرو)',
    nameEn: 'Growth / Pro',
    basePrice: 2850000,
    featuresIncluded: ['core.workspace', 'catalog.menu', 'orders.pos', 'floor.tables', 'crm.directory', 'crm.loyalty', 'insights.reports'],
    maxBranches: 3,
    maxDevices: 8,
    supportLevel: 'اولویت‌دار (تلفن و تیکت)'
  },
  {
    id: 'enterprise',
    nameFa: 'سراسری (اینترپرایز)',
    nameEn: 'Enterprise',
    basePrice: 7900000,
    featuresIncluded: ['core.workspace', 'catalog.menu', 'catalog.modifiers', 'orders.pos', 'kitchen.kds', 'floor.tables', 'floor.qr', 'booking.reservations', 'finance.workspace', 'stock.inventory', 'crm.directory', 'crm.loyalty', 'insights.analytics', 'platform.multi_branch', 'infra.hourly_backup'],
    maxBranches: 20,
    maxDevices: 50,
    supportLevel: 'اختصاصی ۲۴/۷ همراه با مدیر حساب'
  }
];

if (typeof window !== 'undefined') {
  window.GMSeedFixtures = {
    CANONICAL_FEATURES,
    CANONICAL_PLANS
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CANONICAL_FEATURES,
    CANONICAL_PLANS
  };
}
