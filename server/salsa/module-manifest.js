'use strict';

/**
 * Canonical commercial module manifest for WESTO.
 *
 * A module is the product/pricing boundary shown to operators. A feature is
 * the technical enforcement boundary used by WESTO. Keeping this mapping in
 * one shared file prevents the Control Plane, billing and the data plane from
 * inventing different feature keys.
 */
const MODULE_LIFECYCLES = Object.freeze(['planned', 'alpha', 'beta', 'ga', 'deprecated', 'retired']);
const COMMERCIAL_STATES = Object.freeze(['included', 'addon', 'quote_only', 'not_sellable']);
const MODULE_CATALOG_PROVENANCE = Object.freeze({
  priceSource: 'static_module_manifest',
  priceMeaning: 'module_list_price_not_subscription_plan_price',
  tenantEntitlement: 'not_included'
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const MODULES = Object.freeze([
  {
    key: 'platform_core', nameFa: 'هسته پلتفرم و پایداری', icon: '🧱', category: 'core',
    descriptionFa: 'فضای کاری، ممیزی و نگهداری نسخه‌های پشتیبان؛ زیرساخت اجباری همه مجموعه‌ها',
    lifecycle: 'ga', commercialState: 'included', priceMonthlyIrr: 0, controllable: false,
    dependencies: [],
    technicalFeatures: ['core.workspace', 'core.audit_trail', 'core.backup_retention']
  },
  {
    key: 'menu_qr', nameFa: 'منوی دیجیتال و سفارش آنلاین', icon: '📱', category: 'experience',
    descriptionFa: 'منو، افزودنی‌ها، قیمت‌گذاری، زبان، چاپ، سفارش آنلاین و QR میز',
    lifecycle: 'ga', commercialState: 'addon', priceMonthlyIrr: 2900000, controllable: true,
    dependencies: ['platform_core'],
    technicalFeatures: ['catalog.menu', 'catalog.modifiers', 'catalog.pricing', 'catalog.languages', 'catalog.print', 'orders.online', 'floor.qr']
  },
  {
    key: 'pos', nameFa: 'صندوق و سفارش‌گیری (POS)', icon: '📠', category: 'operations',
    descriptionFa: 'فروش حضوری، تخفیف، سفارش پیشرفته، کار آفلاین و صندوق نقدی',
    lifecycle: 'ga', commercialState: 'addon', priceMonthlyIrr: 4900000, controllable: true,
    dependencies: ['menu_qr'],
    technicalFeatures: ['orders.pos', 'orders.advanced', 'orders.discounts', 'orders.offline_sync', 'cash.drawers']
  },
  {
    key: 'floor', nameFa: 'سالن، میزها و گارسون', icon: '🪑', category: 'floor',
    descriptionFa: 'نقشه میزها، ترمینال گارسون و حق سرویس',
    lifecycle: 'ga', commercialState: 'addon', priceMonthlyIrr: 3500000, controllable: true,
    dependencies: ['platform_core'],
    technicalFeatures: ['floor.tables', 'staff.waiter', 'floor.service_charge']
  },
  {
    key: 'kds', nameFa: 'آشپزخانه و KDS', icon: '🍳', category: 'kitchen',
    descriptionFa: 'نمایشگر آشپزخانه، ایستگاه‌های پخت و اکسپدایتر',
    lifecycle: 'ga', commercialState: 'addon', priceMonthlyIrr: 3900000, controllable: true,
    dependencies: ['pos'],
    technicalFeatures: ['kitchen.kds', 'kitchen.stations', 'kitchen.expediter']
  },
  {
    key: 'reservations', nameFa: 'رزرو و صف انتظار', icon: '📅', category: 'experience',
    descriptionFa: 'رزرو میز، صف انتظار و بیعانه',
    lifecycle: 'beta', commercialState: 'addon', priceMonthlyIrr: 2900000, controllable: true,
    dependencies: ['floor'],
    technicalFeatures: ['booking.reservations', 'booking.waitlist', 'booking.deposit']
  },
  {
    key: 'delivery', nameFa: 'ارسال و ناوگان پیک', icon: '🛵', category: 'operations',
    descriptionFa: 'دیسپچ، محدوده‌های ارسال و رهگیری زنده',
    lifecycle: 'beta', commercialState: 'addon', priceMonthlyIrr: 3900000, controllable: true,
    dependencies: ['menu_qr'],
    technicalFeatures: ['delivery.dispatch', 'delivery.zones', 'delivery.tracking']
  },
  {
    key: 'payments', nameFa: 'پرداخت و اتصال کارتخوان', icon: '💳', category: 'finance',
    descriptionFa: 'درگاه پرداخت و اتصال مستقیم PC-POS',
    lifecycle: 'beta', commercialState: 'addon', priceMonthlyIrr: 2900000, controllable: true,
    dependencies: ['pos', 'menu_qr'],
    technicalFeatures: ['payments.gateway', 'payments.terminal_link']
  },
  {
    key: 'accounting', nameFa: 'حسابداری و مالیات', icon: '📊', category: 'finance',
    descriptionFa: 'دفتر کل، خرید، مغایرت بانکی، دارایی، حقوق و سامانه مؤدیان',
    lifecycle: 'beta', commercialState: 'addon', priceMonthlyIrr: 5900000, controllable: true,
    dependencies: ['platform_core'],
    technicalFeatures: ['finance.workspace', 'finance.purchases', 'finance.reconciliation', 'finance.assets', 'finance.payroll', 'finance.tax_adapter']
  },
  {
    key: 'inventory', nameFa: 'انبار، رسپی و تدارکات', icon: '📦', category: 'management',
    descriptionFa: 'موجودی، فرمولاسیون و خرید خودکار',
    lifecycle: 'ga', commercialState: 'addon', priceMonthlyIrr: 5900000, controllable: true,
    dependencies: ['menu_qr'],
    technicalFeatures: ['stock.inventory', 'stock.recipes', 'stock.procurement']
  },
  {
    key: 'crm', nameFa: 'CRM، وفاداری و پیامک', icon: '🎁', category: 'marketing',
    descriptionFa: 'دایرکتوری مشتری، امتیاز، کیف پول، کمپین و پیامک',
    lifecycle: 'ga', commercialState: 'addon', priceMonthlyIrr: 3900000, controllable: true,
    dependencies: ['platform_core'],
    technicalFeatures: ['crm.directory', 'crm.loyalty', 'crm.wallet', 'marketing.campaigns', 'marketing.sms']
  },
  {
    key: 'multi_branch', nameFa: 'مدیریت چندشعبه‌ای', icon: '🏢', category: 'scale',
    descriptionFa: 'ساختار هلدینگ و تلفیق مالی شعب',
    lifecycle: 'alpha', commercialState: 'quote_only', priceMonthlyIrr: null, controllable: true,
    dependencies: ['accounting'],
    technicalFeatures: ['core.multi_branch', 'finance.consolidation']
  },
  {
    key: 'website_brand', nameFa: 'وب‌سایت و وایت‌لیبل', icon: '🌐', category: 'brand',
    descriptionFa: 'وب‌سایت، دامنه اختصاصی و حذف برند پلتفرم',
    lifecycle: 'beta', commercialState: 'addon', priceMonthlyIrr: 4900000, controllable: true,
    dependencies: ['platform_core'],
    technicalFeatures: ['content.website', 'brand.custom_domain', 'brand.white_label']
  },
  {
    key: 'analytics', nameFa: 'گزارش‌های مدیریتی', icon: '📈', category: 'management',
    descriptionFa: 'گزارش‌های تحلیلی و سود و زیان دوره‌ای',
    lifecycle: 'beta', commercialState: 'addon', priceMonthlyIrr: 3500000, controllable: true,
    dependencies: ['platform_core'],
    technicalFeatures: ['insights.reports']
  }
].map(module => deepFreeze({
  ...module,
  catalogProvenance: { ...MODULE_CATALOG_PROVENANCE }
})));

const MODULE_MAP = new Map(MODULES.map(module => [module.key, module]));
const FEATURE_MODULE_MAP = new Map();
for (const module of MODULES) {
  for (const featureKey of module.technicalFeatures) {
    if (FEATURE_MODULE_MAP.has(featureKey)) {
      throw new Error(`MODULE_MANIFEST_DUPLICATE_FEATURE: ${featureKey}`);
    }
    FEATURE_MODULE_MAP.set(featureKey, module.key);
  }
}

function copyModule(module) {
  if (!module) return null;
  return {
    ...module,
    technicalFeatures: [...module.technicalFeatures],
    dependencies: [...module.dependencies],
    catalogProvenance: { ...module.catalogProvenance }
  };
}

function getModules() {
  return MODULES.map(copyModule);
}

function getModule(moduleKey) {
  return copyModule(MODULE_MAP.get(moduleKey));
}

function getModuleForFeature(featureKey) {
  const moduleKey = FEATURE_MODULE_MAP.get(featureKey);
  return moduleKey ? copyModule(MODULE_MAP.get(moduleKey)) : null;
}

function findDependencyCycles(nodes, getDependencies) {
  const nodeKeys = new Set(nodes.map(node => node.key));
  const states = new Map();
  const stack = [];
  const cycles = [];

  function visit(key) {
    states.set(key, 1);
    stack.push(key);
    for (const dependency of getDependencies(key)) {
      if (!nodeKeys.has(dependency)) continue;
      if (states.get(dependency) === 1) {
        const start = stack.indexOf(dependency);
        cycles.push([...stack.slice(start), dependency]);
      } else if (!states.has(dependency)) {
        visit(dependency);
      }
    }
    stack.pop();
    states.set(key, 2);
  }

  for (const key of nodeKeys) {
    if (!states.has(key)) visit(key);
  }
  return cycles;
}

function validateManifest(canonicalFeatures) {
  const features = Array.isArray(canonicalFeatures) ? canonicalFeatures : [];
  const malformedCanonicalFeatures = [];
  const featureCounts = new Map();
  for (const [index, feature] of features.entries()) {
    if (!feature || typeof feature.key !== 'string' || !feature.key || !Array.isArray(feature.dependencies) ||
      feature.dependencies.some(dependency => typeof dependency !== 'string' || !dependency)) {
      malformedCanonicalFeatures.push(index);
      continue;
    }
    featureCounts.set(feature.key, (featureCounts.get(feature.key) || 0) + 1);
  }

  const canonicalKeys = new Set(featureCounts.keys());
  const mappedKeys = new Set(FEATURE_MODULE_MAP.keys());
  const duplicateCanonicalFeatures = [...featureCounts].filter(([, count]) => count > 1).map(([key]) => key);
  const unknownFeatureDependencies = [...new Set(features.flatMap(feature => {
    if (!feature || typeof feature.key !== 'string' || !Array.isArray(feature.dependencies)) return [];
    return feature.dependencies.filter(dependency => !canonicalKeys.has(dependency));
  }))];
  const featureDependencyCycles = findDependencyCycles(
    features.filter(feature => feature && typeof feature.key === 'string'),
    key => features.find(feature => feature?.key === key)?.dependencies || []
  );

  const moduleCounts = new Map();
  const invalidModules = [];
  for (const module of MODULES) {
    if (!module || typeof module.key !== 'string' || !module.key) {
      invalidModules.push(module?.key || '<unknown>');
      continue;
    }
    moduleCounts.set(module.key, (moduleCounts.get(module.key) || 0) + 1);
    const validPrice = module.priceMonthlyIrr === null ||
      (Number.isSafeInteger(module.priceMonthlyIrr) && module.priceMonthlyIrr >= 0);
    if (!MODULE_LIFECYCLES.includes(module.lifecycle) || !COMMERCIAL_STATES.includes(module.commercialState) ||
      typeof module.controllable !== 'boolean' || !validPrice ||
      !Array.isArray(module.dependencies) || module.dependencies.some(key => typeof key !== 'string' || !key) ||
      !Array.isArray(module.technicalFeatures) || module.technicalFeatures.some(key => typeof key !== 'string' || !key)) {
      invalidModules.push(module.key);
    }
  }
  const duplicateModuleKeys = [...moduleCounts].filter(([, count]) => count > 1).map(([key]) => key);
  const moduleKeys = new Set(moduleCounts.keys());
  const unknownModuleDependencies = [...new Set(MODULES.flatMap(module =>
    Array.isArray(module?.dependencies) ? module.dependencies.filter(key => !moduleKeys.has(key)) : []
  ))];
  const moduleDependencyCycles = findDependencyCycles(
    MODULES.filter(module => module && typeof module.key === 'string'),
    key => MODULE_MAP.get(key)?.dependencies || []
  );
  const duplicateModuleFeatures = [];
  const featureOwners = new Map();
  for (const module of MODULES) {
    for (const key of Array.isArray(module?.technicalFeatures) ? module.technicalFeatures : []) {
      if (featureOwners.has(key)) duplicateModuleFeatures.push(key);
      else featureOwners.set(key, module.key);
    }
  }

  const missingFromModules = [...canonicalKeys].filter(key => !mappedKeys.has(key));
  const unknownModuleFeatures = [...mappedKeys].filter(key => !canonicalKeys.has(key));
  return {
    valid: canonicalKeys.size === mappedKeys.size && missingFromModules.length === 0 && unknownModuleFeatures.length === 0 &&
      malformedCanonicalFeatures.length === 0 && duplicateCanonicalFeatures.length === 0 &&
      unknownFeatureDependencies.length === 0 && featureDependencyCycles.length === 0 && invalidModules.length === 0 &&
      duplicateModuleKeys.length === 0 && unknownModuleDependencies.length === 0 &&
      moduleDependencyCycles.length === 0 && duplicateModuleFeatures.length === 0,
    missingFromModules,
    unknownModuleFeatures,
    malformedCanonicalFeatures,
    duplicateCanonicalFeatures,
    unknownFeatureDependencies,
    featureDependencyCycles,
    invalidModules,
    duplicateModuleKeys,
    unknownModuleDependencies,
    moduleDependencyCycles,
    duplicateModuleFeatures
  };
}

module.exports = {
  MODULE_LIFECYCLES,
  COMMERCIAL_STATES,
  MODULE_CATALOG_PROVENANCE,
  MODULES,
  // Export snapshots for compatibility; mutations cannot alter the private indexes.
  MODULE_MAP: new Map(MODULE_MAP),
  FEATURE_MODULE_MAP: new Map(FEATURE_MODULE_MAP),
  getModules,
  getModule,
  getModuleForFeature,
  validateManifest
};
