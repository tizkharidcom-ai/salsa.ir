'use strict';

const { CANONICAL_FEATURES, isFeatureEnabledForTenant } = require('../../../server/salsa/canonical-features');
const TAB_FEATURES = Object.freeze({
  kitchen: 'kitchen.kds', orders: 'orders.pos', reservations: 'booking.reservations',
  delivery: 'delivery.dispatch', tables: 'floor.tables',
  menu: 'catalog.menu', prices: 'catalog.pricing', products: 'catalog.menu',
  printmenu: 'catalog.print', translate: 'catalog.languages', complements: 'catalog.modifiers',
  inventory: 'stock.inventory', costControl: 'stock.recipes',
  accounting: 'finance.workspace', finance: 'finance.workspace', expenses: 'finance.workspace',
  club: 'crm.directory', loyalty: 'crm.loyalty', wallet: 'crm.wallet',
  campaigns: 'marketing.campaigns', sms: 'marketing.sms',
  feedback: 'crm.directory', newsletter: 'crm.directory',
  analytics: 'insights.reports', reports: 'insights.reports',
  branches: 'core.multi_branch', promotions: 'orders.discounts',
  restaurant: 'content.website', theme: 'content.website', hours: 'content.website',
  promoSlides: 'content.website', content: 'content.website', media: 'content.website', faq: 'content.website',
});

function customerAccessSnapshot(tenantDb) {
  return {
    features: Object.fromEntries(CANONICAL_FEATURES.map(feature =>
      [feature.key, isFeatureEnabledForTenant(tenantDb, feature.key)])),
    tabFeatures: { ...TAB_FEATURES },
    backgroundFinancialCapture: {
      policy: 'independent_of_accounting_subscription',
      configured: tenantDb?.financeV2?.rollout?.captureEnabled !== false,
    },
    dataRetention: 'preserved_when_access_disabled',
  };
}

// Operational payment receipts remain available to POS operators. Internal
// event/journal projections must not reveal the unsubscribed accounting UI.
function withoutUnsubscribedFinance(tenantDb, payload) {
  if (isFeatureEnabledForTenant(tenantDb, 'finance.workspace') || !payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const { finance, financeReceipt, ...operational } = payload;
  return operational;
}

module.exports = { TAB_FEATURES, customerAccessSnapshot, withoutUnsubscribedFinance };
