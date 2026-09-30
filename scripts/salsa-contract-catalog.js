'use strict';

/**
 * scripts/salsa-contract-catalog.js
 * 
 * Canonical machine-readable target contract reference for Project NEEM / Westo Phase 0.
 * Derived strictly from GODMODE.MD Section 7.2 (48 Sellable Features)
 * and docs/salsa/contracts/features-and-permissions-catalog.md (11 Structured Dimensions).
 */

// 48 Sellable Features (GODMODE.MD Section 7.2, lines 271-318)
const VALID_FEATURES = Object.freeze(new Set([
  'core.workspace', 'catalog.menu', 'catalog.modifiers', 'catalog.pricing', 'catalog.languages', 'catalog.print',
  'orders.online', 'orders.pos', 'orders.advanced', 'floor.tables', 'floor.qr', 'staff.waiter',
  'kitchen.kds', 'booking.reservations', 'booking.waitlist', 'delivery.dispatch', 'payments.gateway', 'cash.drawers',
  'finance.workspace', 'finance.purchases', 'finance.reconciliation', 'finance.assets', 'finance.payroll',
  'finance.tax_adapter', 'finance.consolidation', 'stock.inventory', 'stock.recipes', 'stock.procurement',
  'crm.directory', 'crm.loyalty', 'crm.wallet', 'marketing.campaigns', 'marketing.sms',
  'content.website', 'brand.custom_domain', 'brand.white_label', 'insights.reports', 'insights.analytics',
  'insights.cost_control', 'insights.local_ai', 'staff.management', 'platform.multi_branch', 'platform.edge',
  'platform.desktop', 'platform.api', 'platform.exports', 'platform.backup_plus', 'platform.support_plus'
]));

// Canonical Permission Keys (features-and-permissions-catalog.md Section 2)
const VALID_PERMISSIONS = Object.freeze(new Set([
  // 1. View
  'menu.view', 'orders.view', 'kitchen.view', 'tables.view', 'reservations.view', 'delivery.view',
  'inventory.view', 'finance.view', 'finance.reports.view', 'reports.view', 'analytics.view',
  'audit.view', 'command.view', 'ops.view',
  // 2. Create / Update / Mutate
  'orders.create', 'orders.manage', 'orders.course.manage', 'orders.split', 'orders.move_table',
  'menu.manage', 'menu.price.update', 'inventory.manage', 'inventory.operations', 'inventory.receiving',
  'service.manage', 'reservations.manage', 'reservations.receive', 'delivery.manage', 'cash.manage',
  'promotions.manage', 'content.manage', 'finance.journal.create',
  // 3. Finance Authorizations & Lifecycle
  'finance.journal.post', 'finance.period.close', 'finance.period.reopen', 'finance.approve',
  'finance.reconcile', 'finance.payables.manage', 'finance.settings.manage',
  // 4. Payments & Refunds
  'payments.refund.request', 'payments.refund.approve', 'payments.collect', 'payments.manage',
  // 5. PII & CRM
  'customers.phone.masked', 'customers.phone.reveal', 'customers.directory.manage',
  // 6. Exports
  'reports.export', 'finance.export', 'customers.export', 'backup.download',
  // 7. Printing & Messaging
  'orders.receipt.print', 'orders.receipt.reprint', 'printing.settings.manage',
  'messaging.send', 'messaging.settings.manage',
  // 8. Access Control & Staff
  'admin.access', 'roles.assign', 'permissions.override', 'staff.manage', 'role.preview',
  // 9. Platform Support
  'support.session.create', 'support.session.write', 'support.view_as',
  // 10. Fleet, Hardware & Infrastructure
  'devices.pair', 'devices.revoke', 'domains.manage', 'releases.deploy', 'automations.manage',
  // 11. User Authenticated Self-Service (Scoped to own_records)
  'profile.self.manage', 'wallet.self.view', 'wallet.topup', 'loyalty.self.view', 'reservations.self.create',
  'orders.self.pay', 'campaigns.self.claim'
]));

// Valid Scopes
const VALID_SCOPES = Object.freeze(new Set([
  'platform',
  'tenant',
  'branch',
  'device',
  'own_records',
  'public',
  'system'
]));

function validateContractMapping({ feature, permission, scope, isExempt = false } = {}) {
  const errors = [];

  if (feature === 'unresolved') {
    errors.push('feature_unresolved');
  } else if (!VALID_FEATURES.has(feature)) {
    errors.push(`invalid_feature:${feature}`);
  }

  if (isExempt) {
    if (permission !== null && permission !== undefined) {
      errors.push(`exempt_route_must_have_null_permission:${permission}`);
    }
    if (scope !== 'public' && scope !== 'system') {
      errors.push(`exempt_route_invalid_scope:${scope}`);
    }
  } else {
    if (permission === 'unresolved' || !permission) {
      errors.push('permission_unresolved');
    } else if (!VALID_PERMISSIONS.has(permission)) {
      errors.push(`invalid_permission:${permission}`);
    }
  }

  if (scope === 'unresolved') {
    errors.push('scope_unresolved');
  } else if (!VALID_SCOPES.has(scope)) {
    errors.push(`invalid_scope:${scope}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  VALID_FEATURES,
  VALID_PERMISSIONS,
  VALID_SCOPES,
  validateContractMapping
};
