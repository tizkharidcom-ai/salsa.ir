// Canonical feature and module catalog shared with the WESTO data plane.
'use strict';

const crypto = require('crypto');
const { CANONICAL_FEATURES } = require('../../../server/salsa/canonical-features');
const moduleManifest = require('../../../server/salsa/module-manifest');

// Toman values are retained only for backward compatibility with the existing
// quote service. Module-level prices use IRR in module-manifest.js.
const FEATURE_PRICES_TOMAN = Object.freeze({
  'core.workspace': 0, 'core.multi_branch': 650000, 'core.audit_trail': 300000, 'core.backup_retention': 250000,
  'catalog.menu': 0, 'catalog.modifiers': 150000, 'catalog.pricing': 200000, 'catalog.languages': 180000, 'catalog.print': 120000,
  'orders.pos': 450000, 'orders.online': 350000, 'orders.advanced': 250000, 'orders.discounts': 190000, 'orders.offline_sync': 400000,
  'floor.tables': 200000, 'floor.qr': 220000, 'staff.waiter': 300000, 'floor.service_charge': 150000,
  'kitchen.kds': 400000, 'kitchen.stations': 280000, 'kitchen.expediter': 200000,
  'booking.reservations': 280000, 'booking.waitlist': 190000, 'booking.deposit': 220000,
  'delivery.dispatch': 320000, 'delivery.zones': 180000, 'delivery.tracking': 250000,
  'payments.gateway': 0, 'cash.drawers': 200000, 'payments.terminal_link': 280000,
  'finance.workspace': 600000, 'finance.purchases': 350000, 'finance.reconciliation': 400000, 'finance.assets': 250000,
  'finance.payroll': 380000, 'finance.tax_adapter': 500000, 'finance.consolidation': 800000,
  'stock.inventory': 400000, 'stock.recipes': 550000, 'stock.procurement': 300000,
  'crm.directory': 0, 'crm.loyalty': 450000, 'crm.wallet': 250000, 'marketing.campaigns': 300000, 'marketing.sms': 200000,
  'content.website': 350000, 'brand.custom_domain': 250000, 'brand.white_label': 600000, 'insights.reports': 200000
});

class CatalogService {
  constructor() {
    this.currentVersion = 'v3.0.0';
  }

  getFeatures() {
    return CANONICAL_FEATURES.map(feature => ({
      ...feature,
      priceMonthly: FEATURE_PRICES_TOMAN[feature.key] ?? null,
      priceMonthlyIrr: FEATURE_PRICES_TOMAN[feature.key] == null ? null : FEATURE_PRICES_TOMAN[feature.key] * 10
    }));
  }

  getModules() { return moduleManifest.getModules(); }
  getModule(key) { return moduleManifest.getModule(key); }
  getFeature(key) { return this.getFeatures().find(feature => feature.key === key) || null; }

  getChecksum() {
    const raw = JSON.stringify({ modules: this.getModules(), features: this.getFeatures() });
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  validateDependencies(featureKey, activeFeatureKeys = []) {
    const feature = this.getFeature(featureKey);
    if (!feature) {
      return { valid: false, missingDependencies: [], error: `قابلیت '${featureKey}' در کاتالوگ پلتفرم وجود ندارد.` };
    }
    const activeSet = new Set(activeFeatureKeys);
    const missing = (feature.dependencies || []).filter(dependency => !activeSet.has(dependency));
    return {
      valid: missing.length === 0,
      missingDependencies: missing,
      error: missing.length ? `پیش‌نیازهای زیر برای فعال‌سازی '${feature.nameFa}' الزامی است: [${missing.join(', ')}]` : null
    };
  }
}

module.exports = new CatalogService();
