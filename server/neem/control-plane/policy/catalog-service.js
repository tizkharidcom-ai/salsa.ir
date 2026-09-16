// server/neem/control-plane/policy/catalog-service.js
'use strict';

const crypto = require('crypto');
const { getDatabase } = require('../db/database');

// 48 Canonical Sellable Features from Section 7.2 of GODMODE.MD
const CANONICAL_FEATURES = [
  // 1. Core & Base (4)
  { key: 'core.workspace', nameFa: 'فضای کاری پایه و مشخصات سازمانی', category: 'core', priceMonthly: 0, dependencies: [] },
  { key: 'core.multi_branch', nameFa: 'مدیریت شعب چندگانه و ساختار هلدینگ', category: 'core', priceMonthly: 650000, dependencies: ['core.workspace'] },
  { key: 'core.audit_trail', nameFa: 'لاگ پیشرفته ممیزی و امنیت داده', category: 'core', priceMonthly: 300000, dependencies: ['core.workspace'] },
  { key: 'core.backup_retention', nameFa: 'بکاپ‌گیری بلادرنگ و ماندگاری ابری', category: 'core', priceMonthly: 250000, dependencies: ['core.workspace'] },

  // 2. Catalog & Menu (5)
  { key: 'catalog.menu', nameFa: 'منوی دیجیتال و دسته‌بندی اقلام', category: 'catalog', priceMonthly: 0, dependencies: ['core.workspace'] },
  { key: 'catalog.modifiers', nameFa: 'تاپینگ‌ها و گزینه‌های سفارشی غذا', category: 'catalog', priceMonthly: 150000, dependencies: ['catalog.menu'] },
  { key: 'catalog.pricing', nameFa: 'قیمت‌گذاری پیشرفته چندسطحی', category: 'catalog', priceMonthly: 200000, dependencies: ['catalog.menu'] },
  { key: 'catalog.languages', nameFa: 'منوی چندزبانه بین‌المللی', category: 'catalog', priceMonthly: 180000, dependencies: ['catalog.menu'] },
  { key: 'catalog.print', nameFa: 'قالب‌های چاپ و خروجی فیزیکی منو', category: 'catalog', priceMonthly: 120000, dependencies: ['catalog.menu'] },

  // 3. Orders & POS (5)
  { key: 'orders.pos', nameFa: 'صندوق فروشگاهی لمسی (POS)', category: 'orders', priceMonthly: 450000, dependencies: ['catalog.menu'] },
  { key: 'orders.online', nameFa: 'سفارش‌گیری آنلاین مشتریان', category: 'orders', priceMonthly: 350000, dependencies: ['catalog.menu'] },
  { key: 'orders.advanced', nameFa: 'تفکیک فاکتور و کورس‌های سرو غذا', category: 'orders', priceMonthly: 250000, dependencies: ['orders.pos'] },
  { key: 'orders.discounts', nameFa: 'کوپن‌ها و تخفیف‌های خودکار سبد خرید', category: 'orders', priceMonthly: 190000, dependencies: ['orders.pos'] },
  { key: 'orders.offline_sync', nameFa: 'ثبت سفارش در قطعی اینترنت و سینک محلی', category: 'orders', priceMonthly: 400000, dependencies: ['orders.pos'] },

  // 4. Floor, Hall & Tables (4)
  { key: 'floor.tables', nameFa: 'مدیریت میزها و نقشه سالن', category: 'floor', priceMonthly: 200000, dependencies: ['core.workspace'] },
  { key: 'floor.qr', nameFa: 'سفارش سر میز با کیوآرکد اختصاصی', category: 'floor', priceMonthly: 220000, dependencies: ['floor.tables', 'orders.online'] },
  { key: 'staff.waiter', nameFa: 'ترمینال سیار گارسون', category: 'floor', priceMonthly: 300000, dependencies: ['floor.tables'] },
  { key: 'floor.service_charge', nameFa: 'حق سرویس و مالیات سالن', category: 'floor', priceMonthly: 150000, dependencies: ['floor.tables'] },

  // 5. Kitchen & KDS (3)
  { key: 'kitchen.kds', nameFa: 'نمایشگر آشپزخانه (KDS)', category: 'kitchen', priceMonthly: 400000, dependencies: ['orders.pos'] },
  { key: 'kitchen.stations', nameFa: 'تفکیک ایستگاه‌های پخت و بار', category: 'kitchen', priceMonthly: 280000, dependencies: ['kitchen.kds'] },
  { key: 'kitchen.expediter', nameFa: 'ایستگاه اکسپدایتر و بازرسی نهایی سینی', category: 'kitchen', priceMonthly: 200000, dependencies: ['kitchen.kds'] },

  // 6. Reservations & Waitlist (3)
  { key: 'booking.reservations', nameFa: 'رزرو آنلاین و مدیریت تقویم میز', category: 'booking', priceMonthly: 280000, dependencies: ['floor.tables'] },
  { key: 'booking.waitlist', nameFa: 'صف انتظار هوشمند مهمانان حضوری', category: 'booking', priceMonthly: 190000, dependencies: ['floor.tables'] },
  { key: 'booking.deposit', nameFa: 'پیش‌دریافت و بیعانه رزرو', category: 'booking', priceMonthly: 220000, dependencies: ['booking.reservations'] },

  // 7. Delivery & Dispatch (3)
  { key: 'delivery.dispatch', nameFa: 'مدیریت ناوگان پیک و دیسپچ هوشمند', category: 'delivery', priceMonthly: 320000, dependencies: ['orders.online'] },
  { key: 'delivery.zones', nameFa: 'محدوده‌های کرایه و نقشه‌بندی شهری', category: 'delivery', priceMonthly: 180000, dependencies: ['delivery.dispatch'] },
  { key: 'delivery.tracking', nameFa: 'پیگیری زنده موقعیت پیک روی نقشه', category: 'delivery', priceMonthly: 250000, dependencies: ['delivery.dispatch'] },

  // 8. Payments & Cash (3)
  { key: 'payments.gateway', nameFa: 'درگاه پرداخت اینترنتی شاپرک', category: 'payments', priceMonthly: 0, dependencies: ['orders.online'] },
  { key: 'cash.drawers', nameFa: 'صندوق نقدی و کنترل شیفت صندوق‌دار', category: 'payments', priceMonthly: 200000, dependencies: ['orders.pos'] },
  { key: 'payments.terminal_link', nameFa: 'اتصال مستقیم نرم‌افزار به کارتخوان (PC-POS)', category: 'payments', priceMonthly: 280000, dependencies: ['orders.pos'] },

  // 9. Finance & Ledger (7)
  { key: 'finance.workspace', nameFa: 'حسابداری دوبل و دفاتر قانونی', category: 'finance', priceMonthly: 600000, dependencies: ['core.workspace'] },
  { key: 'finance.purchases', nameFa: 'فاکتور خرید و حساب بستانکاران', category: 'finance', priceMonthly: 350000, dependencies: ['finance.workspace'] },
  { key: 'finance.reconciliation', nameFa: 'مغایرت‌گیری خودکار بانکی', category: 'finance', priceMonthly: 400000, dependencies: ['finance.workspace'] },
  { key: 'finance.assets', nameFa: 'اموال و استهلاک دارایی‌های رستوران', category: 'finance', priceMonthly: 250000, dependencies: ['finance.workspace'] },
  { key: 'finance.payroll', nameFa: 'حقوق و دستمزد پرسنل', category: 'finance', priceMonthly: 380000, dependencies: ['finance.workspace'] },
  { key: 'finance.tax_adapter', nameFa: 'اتصال به سامانه مؤدیان و مالیات', category: 'finance', priceMonthly: 500000, dependencies: ['finance.workspace'] },
  { key: 'finance.consolidation', nameFa: 'تلفیق مالی شعب چندگانه', category: 'finance', priceMonthly: 800000, dependencies: ['finance.workspace', 'core.multi_branch'] },

  // 10. Inventory & Recipes (3)
  { key: 'stock.inventory', nameFa: 'انبارداری و شمارش لحظه‌ای موجودی', category: 'inventory', priceMonthly: 400000, dependencies: ['core.workspace'] },
  { key: 'stock.recipes', nameFa: 'رسپی و بهای تمام‌شده غذا (COGS)', category: 'inventory', priceMonthly: 550000, dependencies: ['stock.inventory', 'catalog.menu'] },
  { key: 'stock.procurement', nameFa: 'سفارش‌گذاری خودکار کسری انبار', category: 'inventory', priceMonthly: 300000, dependencies: ['stock.inventory'] },

  // 11. CRM & Marketing (5)
  { key: 'crm.directory', nameFa: 'دایرکتوری مشتریان و پروفایل مصرف', category: 'crm', priceMonthly: 0, dependencies: ['core.workspace'] },
  { key: 'crm.loyalty', nameFa: 'باشگاه مشتریان و امتیازات خرید', category: 'crm', priceMonthly: 450000, dependencies: ['crm.directory'] },
  { key: 'crm.wallet', nameFa: 'کیف پول اعتباری مشتری', category: 'crm', priceMonthly: 250000, dependencies: ['crm.directory'] },
  { key: 'marketing.campaigns', nameFa: 'کمپین‌های تخفیفی و خودکارسازی', category: 'crm', priceMonthly: 300000, dependencies: ['crm.directory'] },
  { key: 'marketing.sms', nameFa: 'پیامک هوشمند اطلاع‌رسانی و بازاریابی', category: 'crm', priceMonthly: 200000, dependencies: ['crm.directory'] },

  // 12. Brand & Insights (4)
  { key: 'content.website', nameFa: 'وب‌سایت اختصاصی برند', category: 'brand', priceMonthly: 350000, dependencies: ['core.workspace'] },
  { key: 'brand.custom_domain', nameFa: 'دامنه اینترنتی اختصاصی (ir / com)', category: 'brand', priceMonthly: 250000, dependencies: ['content.website'] },
  { key: 'brand.white_label', nameFa: 'حذف لوگوی پلتفرم (وایت‌لیبل کامل)', category: 'brand', priceMonthly: 600000, dependencies: ['brand.custom_domain'] },
  { key: 'insights.reports', nameFa: 'گزارش‌های تحلیلی و سود و زیان دوره‌ای', category: 'insights', priceMonthly: 200000, dependencies: ['core.workspace'] }
];

class CatalogService {
  constructor() {
    this.currentVersion = 'v2.4.0';
  }

  getFeatures() {
    return [...CANONICAL_FEATURES];
  }

  getFeature(key) {
    return CANONICAL_FEATURES.find(f => f.key === key) || null;
  }

  getChecksum() {
    const raw = JSON.stringify(CANONICAL_FEATURES);
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  validateDependencies(featureKey, activeFeatureKeys = []) {
    const feature = this.getFeature(featureKey);
    if (!feature) {
      return { valid: false, missingDependencies: [], error: `قابلیت '${featureKey}' در کاتالوگ پلتفرم وجود ندارد.` };
    }

    const activeSet = new Set(activeFeatureKeys);
    const missing = (feature.dependencies || []).filter(dep => !activeSet.has(dep));

    return {
      valid: missing.length === 0,
      missingDependencies: missing,
      error: missing.length > 0 
        ? `پیش‌نیازهای زیر برای فعال‌سازی '${feature.nameFa}' الزامی است: [${missing.join(', ')}]` 
        : null
    };
  }
}

module.exports = new CatalogService();
