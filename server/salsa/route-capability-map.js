'use strict';

/**
 * WESTO Route-to-Capability Map
 *
 * Maps HTTP method + path pattern to a granular capability string.
 * This is the authoritative contract between the NEEM policy engine
 * and the WESTO server routes.
 *
 * Families covered:
 *   1. Finance / Ledger / Reports
 *   2. Users / Roles / PII / CRM
 *   3. Orders / Cashier / Payments
 *   4. KDS / Sync / Electron/Edge
 *   5. Settings / Export / Backup / Admin-v2
 *
 * Format: 'METHOD /path/pattern' -> 'capability'
 * Wildcards: ':param' segments are normalised to ':*' for matching.
 */

const ROUTE_CAPABILITY_MAP = Object.freeze({
  // Family 1: Finance / Ledger / Reports
  'GET /api/admin/finance/overview':            'finance.view',
  'GET /api/admin/finance/ai-cfo-brief':        'finance.view',
  'GET /api/admin/finance/predictive':          'finance.view',
  'GET /api/admin/finance/sales':               'finance.view',
  'GET /api/admin/finance/gl':                  'finance.view',
  'GET /api/admin/finance/coa':                 'finance.view',
  'GET /api/admin/finance/journal':             'finance.view',
  'GET /api/admin/finance/journal/:*':          'finance.view',
  'GET /api/admin/finance/cash-drawers':        'finance.view',
  'GET /api/admin/finance/petty-cash':          'finance.view',
  'GET /api/admin/finance/purchase-orders':     'finance.view',
  'GET /api/admin/finance/einvoices':           'finance.view',
  'GET /api/admin/finance/taxpayer/settings':   'finance.view',
  'GET /api/admin/finance/trial-balance':       'finance.view',
  'GET /api/admin/finance/income-statement':    'finance.view',
  'GET /api/admin/finance/balance-sheet':       'finance.view',
  'GET /api/admin/finance/cash-flow':           'finance.view',
  'GET /api/admin/finance/ar':                  'finance.view',
  'GET /api/admin/finance/ap':                  'finance.view',
  'GET /api/admin/finance/assets':              'finance.view',
  'GET /api/admin/finance/payroll':             'finance.view',
  'GET /api/admin/finance/bank-feeds':          'finance.view',
  'GET /api/admin/finance/periods':             'finance.view',
  'GET /api/admin/finance/tax-matrix':          'finance.settings.manage',
  'PATCH /api/admin/finance/tax-matrix':        'finance.settings.manage',
  'POST /api/admin/finance/tax-matrix/rule':    'finance.settings.manage',
  'GET /api/admin/finance/export':              'finance.export',
  'POST /api/admin/finance/export':             'finance.export',
  'POST /api/admin/finance/coa':                'finance.journal.create',
  'PATCH /api/admin/finance/coa/:*':            'finance.journal.create',
  'POST /api/admin/finance/journal':            'finance.journal.create',
  'POST /api/admin/finance/journal/:*/reverse': 'finance.journal.create',
  'POST /api/admin/finance/cash-drawers/session': 'cash.manage',
  'POST /api/admin/finance/petty-cash/:*/fund': 'finance.journal.create',
  'POST /api/admin/finance/purchase-orders':    'finance.payables.manage',
  'PATCH /api/admin/finance/purchase-orders/:*': 'finance.payables.manage',
  'POST /api/admin/finance/einvoices/:*/retry': 'finance.journal.create',
  'POST /api/admin/finance/taxpayer/settings':  'finance.settings.manage',
  'POST /api/admin/finance/periods':            'finance.period.close',
  'PATCH /api/admin/finance/periods/:*':        'finance.period.reopen',
  'POST /api/admin/finance/payroll':            'finance.payables.manage',
  'POST /api/admin/finance/reconcile':          'finance.reconcile',
  'GET /api/admin/v2/finance':                  'finance.view',

  // Family 2: Users / Roles / PII / CRM
  'GET /api/admin/v2/crm':                      'pii.view',
  'GET /api/admin/v2/staff':                    'staff.view',
  'POST /api/admin/v2/staff':                   'staff.manage',
  'PATCH /api/admin/v2/staff/:*':               'staff.manage',
  'DELETE /api/admin/v2/staff/:*':              'staff.manage',
  'GET /api/admin/audit':                       'audit.view',
  'GET /api/admin/v2/overview':                 'command.view',
  'GET /api/admin/session':                     'command.view',
  'GET /api/admin/role-preview':                'role.preview',
  'GET /api/admin/payments':                    'payments.manage',
  'GET /api/admin/qr-code':                     'tables.view',
  'GET /api/admin/promo-slides':                'content.manage',
  'POST /api/admin/promo-slides':               'content.manage',
  'GET /api/admin/reservations':                'reservations.view',

  // Family 3: Orders / Cashier / Payments
  'GET /api/admin/orders':                      'orders.view',
  'GET /api/admin/v2/orders':                   'orders.view',
  'POST /api/staff/orders':                     'orders.create',
  'PATCH /api/cashier/orders/:*':               'orders.manage',
  'PATCH /api/cashier/orders/:*/status':        'orders.manage',
  'PATCH /api/waiter/orders/:*':                'service.manage',
  'PATCH /api/waiter/orders/:*/status':         'service.manage',
  'GET /api/waiter/calls':                      'service.manage',
  'PATCH /api/waiter/calls/:*':                 'service.manage',
  'GET /api/waiter/waitlist':                   'reservations.receive',
  'POST /api/waiter/waitlist':                  'reservations.receive',
  'PATCH /api/waiter/waitlist/:*':              'reservations.receive',
  'POST /api/cashier/orders/:*/settle':         'payments.manage',
  'POST /api/staff/orders/:*/settle':           'payments.collect',
  'POST /api/cashier/orders/:*/apply-loyalty':  'orders.manage',
  'POST /api/cashier/orders/:*/print':          'payments.manage',
  'POST /api/cashier/orders/:*/receipt':        'payments.manage',
  'GET /api/cashier/drawer':                    'cash.manage',
  'GET /api/cashier/printer':                   'payments.manage',
  'GET /api/cashier/printers/system':           'payments.manage',
  'PUT /api/cashier/printer':                   'payments.manage',
  'POST /api/cashier/printer/test':             'payments.manage',
  'POST /api/cashier/drawer/open':              'cash.manage',
  'POST /api/cashier/drawer/movements':         'cash.manage',
  'POST /api/cashier/drawer/close':             'cash.manage',
  'POST /api/waiter/orders/:*/split':           'orders.split',
  'PATCH /api/waiter/orders/:*/move-table':     'orders.move_table',
  'PATCH /api/waiter/orders/:*/fire-course':    'orders.course.manage',
  'GET /api/kitchen/orders':                    'kitchen.view',
  'PATCH /api/kitchen/orders/:*':               'kitchen.manage',
  'PATCH /api/kitchen/items/:*/availability':   'kitchen.manage',
  'GET /api/kitchen/calls':                     'service.manage',
  'PATCH /api/kitchen/calls/:*':                'service.manage',
  'GET /api/kitchen/inventory':                 'inventory.view',
  'POST /api/kitchen/inventory/goods-receipts': 'inventory.receiving',
  'POST /api/kitchen/inventory/recipe-versions': 'inventory.operations',
  'POST /api/kitchen/inventory/waste':          'inventory.operations',
  'POST /api/kitchen/inventory/stock-counts':   'inventory.operations',
  'POST /api/kitchen/inventory/production-batches': 'inventory.operations',
  'POST /api/staff/shifts/open':                'ops.view',
  'POST /api/staff/shifts/close':               'ops.view',

  // Family 4: KDS / Kitchen / Sync / Edge
  'GET /api/admin/v2/kitchen':                  'kitchen.view',
  'GET /api/staff/menu':                        'orders.create',

  // Family 5: Settings / Export / Backup / Admin-v2 Resources
  'GET /api/admin/v2/settings':                 'admin.access',
  'PATCH /api/admin/v2/settings':               'settings.manage',
  'GET /api/admin/v2/resources':                'admin.access',
  'GET /api/admin/v2/resources/:*':             'admin.access',
  'POST /api/admin/v2/resources/:*':            'admin.access',
  'PATCH /api/admin/v2/resources/:*/:*':        'admin.access',
  'DELETE /api/admin/v2/resources/:*/:*':       'admin.access',
  'GET /api/admin/v2/desktop/releases':         'admin.access',
  'GET /api/admin/salsa-integration':           'admin.access',
  'POST /api/admin/salsa-integration/retry':    'admin.access',
  'POST /api/admin/salsa-integration/backfill': 'admin.access',
  'GET /api/admin/neem-integration':            'admin.access',
  'POST /api/admin/neem-integration/retry':     'admin.access',
  'POST /api/admin/neem-integration/backfill':  'admin.access',
  'GET /api/admin/delivery-zones':              'delivery.view',
  'POST /api/admin/delivery-zones':             'delivery.manage',
  'PATCH /api/admin/delivery-zones/:*':         'delivery.manage',
  'DELETE /api/admin/delivery-zones/:*':        'delivery.manage',
  'GET /api/admin/v2/catalog':                  'inventory.view',
  'GET /api/admin/menu-engineering':            'menu.manage',
  'POST /api/admin/menu-complements':           'menu.manage',
  'PUT /api/admin/menu-complements/:*':         'menu.manage',
  'DELETE /api/admin/menu-complements/:*':      'menu.manage',
  'POST /api/admin/menu-complement-rules':      'menu.manage',
  'PUT /api/admin/menu-complement-rules/:*':    'menu.manage',
  'DELETE /api/admin/menu-complement-rules/:*': 'menu.manage',
  'PUT /api/menu/categories/order':             'menu.manage',
  'GET /api/admin/v2/floor':                    'tables.view',
  'PUT /api/admin/v2/floor/layout':             'tables.manage',
  'GET /api/admin/command-center':              'command.view',
  'GET /api/admin/events':                      'ops.view',
});

// Routes below are live server declarations with an explicit requireCapability
// guard. Keep those contracts ahead of broad legacy-family rules so the policy
// layer cannot silently substitute a weaker/different capability.
const REGISTERED_ROUTE_CAPABILITY_MAP = Object.freeze({
  'PATCH /api/admin/orders/:*': 'orders.manage',
  'PATCH /api/admin/promo-slides/:*': 'content.manage',
  'DELETE /api/admin/promo-slides/:*': 'content.manage',
  'POST /api/admin/promo-slides/reorder': 'content.manage',
  'PATCH /api/admin/reservations/:*': 'reservations.manage',
  'GET /api/admin/v2/finance/sales-cash-bank': 'finance.view',
  'GET /api/admin/v2/finance/orders/:*/chain': 'finance.view',
  'GET /api/admin/v2/finance/purchases-payables': 'finance.payables.manage',
  'POST /api/admin/v2/finance/goods-receipts': 'inventory.receiving',
  'POST /api/admin/v2/finance/vendor-invoices': 'finance.payables.manage',
  'POST /api/admin/v2/finance/vendor-invoices/:*/match-review': 'finance.payables.manage',
  'POST /api/admin/v2/finance/vendor-invoices/:*/payment-request': 'finance.payables.manage',
  'POST /api/admin/v2/finance/cost-commitments': 'finance.payables.manage',
  'POST /api/admin/v2/finance/cost-commitments/:*/deactivate': 'finance.payables.manage',
  'POST /api/admin/v2/finance/cost-commitments/:*/accruals': 'finance.payables.manage',
  'POST /api/admin/v2/finance/cost-accruals/:*/payment-request': 'finance.payables.manage',
  'POST /api/admin/v2/finance/inventory-movements': 'inventory.operations',
  'POST /api/admin/v2/finance/fiscal-periods': 'finance.settings.manage',
  'POST /api/admin/v2/finance/fiscal-periods/:*/close': 'finance.period.close',
  'POST /api/admin/v2/finance/fiscal-periods/:*/reopen-request': 'finance.period.reopen',
  'GET /api/admin/v2/finance/events': 'finance.view',
  'GET /api/admin/v2/finance/migration/archive': 'finance.view',
  'POST /api/admin/v2/finance/migration/archive/:*/backfill-preview': 'finance.view',
  'GET /api/admin/v2/finance/journal-entries': 'finance.view',
  'POST /api/admin/v2/finance/journal-entries': 'finance.journal.create',
  'POST /api/admin/v2/finance/journal-entries/:*/submit': 'finance.journal.create',
  'POST /api/admin/v2/finance/journal-entries/:*/reversal': 'finance.journal.post',
  'GET /api/admin/v2/finance/reconciliation': 'finance.reconcile',
  'POST /api/admin/v2/finance/reconciliation/refunds/:*/match': 'finance.reconcile',
  'POST /api/admin/v2/finance/reconciliation/bank-statement-lines': 'finance.reconcile',
  'POST /api/admin/v2/finance/reconciliation/bank-statement-lines/:*/match': 'finance.reconcile',
  'GET /api/admin/v2/finance/approvals': 'finance.view',
  'POST /api/admin/v2/finance/approvals/:*/decision': 'finance.approve',
  'GET /api/admin/v2/finance/search': 'finance.view',
  'POST /api/admin/v2/finance/rollout/:*/cutover-request': 'finance.settings.manage',
});

/**
 * Owner-sensitive settings categories that require settings.manage
 * (owner-only). Manager may view but not mutate these.
 */
const OWNER_ONLY_SETTINGS_CATEGORIES = Object.freeze([
  'users',
  'security',
  'permissions',
  'integrations',
  'external-systems',
]);

function lookupRouteMap(routeMap, method, routePath) {
  const exact = `${method} ${routePath}`;
  if (Object.prototype.hasOwnProperty.call(routeMap, exact)) return routeMap[exact];

  const segments = routePath.split('/');
  for (const [pattern, capability] of Object.entries(routeMap)) {
    const [patternMethod, patternPath] = pattern.split(' ');
    if (patternMethod !== method) continue;
    const patternSegments = patternPath.split('/');
    if (patternSegments.length !== segments.length) continue;
    if (patternSegments.every((segment, index) => segment === ':*' || segment === segments[index])) {
      return capability;
    }
  }
  return null;
}

/**
 * Normalise a route path by replacing Express-style :param segments with :*
 * so that ROUTE_CAPABILITY_MAP lookup keys are stable.
 *
 * @param {string} method  HTTP verb (uppercased)
 * @param {string} path    req.path value from Express
 * @returns {string|null}  capability string or null if no match
 */
function lookupPolicyCapability(method, path) {
  const verb = String(method || '').toUpperCase();
  const routePath = String(path || '').replace(/\/+$/, '') || '/';

  // GODMODE contract overrides for legacy route families. These rules are
  // intentionally evaluated before the compatibility map below: the latter
  // contains historical aliases used by older clients, while this layer must
  // enforce the current route contract at the first TPEL boundary.
  const isRead = ['GET', 'HEAD', 'OPTIONS'].includes(verb);
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(verb);

  if (verb === 'GET' && /^\/api\/staff\/session\/[^/]+$/.test(routePath)) return 'ops.view';
  const registeredRouteCapability = lookupRouteMap(REGISTERED_ROUTE_CAPABILITY_MAP, verb, routePath);
  if (registeredRouteCapability) return registeredRouteCapability;
  if (routePath === '/api/admin/menu-engineering') return 'menu.view';
  if (routePath === '/api/admin/loyalty/tiers' || routePath === '/api/admin/loyalty/achievements' || routePath === '/api/admin/loyalty/adjust') return 'admin.access';
  if (routePath.startsWith('/api/admin/wallet/summary') || routePath.startsWith('/api/admin/wallet/packages') || routePath.startsWith('/api/admin/wallet/adjust')) return 'admin.access';
  if (routePath.startsWith('/api/pos/sales/') && routePath.endsWith('/refunds')) return 'payments.refund.request';

  if (routePath === '/ops' || routePath.startsWith('/ops/')) return 'admin.access';
  if (routePath.startsWith('/api/admin/salsa-integration') || routePath.startsWith('/api/admin/neem-integration')) return isRead ? 'analytics.view' : 'automations.manage';

  if (routePath.startsWith('/api/admin/v2/overview')) return 'analytics.view';
  if (routePath === '/api/admin/v2/staff') return isRead ? 'audit.view' : 'staff.manage';
  if (routePath.startsWith('/api/admin/v2/staff/')) return 'staff.manage';
  if (routePath === '/api/admin/v2/catalog') return 'menu.view';
  if (routePath === '/api/admin/v2/crm') return 'pii.view';
  if (routePath === '/api/admin/v2/settings') return isRead ? 'command.view' : 'admin.access';
  if (routePath.startsWith('/api/admin/v2/desktop/releases')) return 'menu.view';
  if (routePath === '/api/admin/v2/resources' || routePath.startsWith('/api/admin/v2/resources/')) return isRead ? 'command.view' : 'admin.access';

  if (routePath === '/api/admin/users' || routePath.startsWith('/api/admin/users/')) {
    return isRead ? 'admin.access' : 'staff.manage';
  }
  if (routePath === '/api/admin/roles' || routePath.startsWith('/api/admin/roles/')) {
    return isRead ? 'audit.view' : 'staff.manage';
  }
  if (routePath === '/api/admin/newsletter') return 'content.manage';
  if (routePath.startsWith('/api/admin/promotions')) return 'content.manage';
  if (routePath.startsWith('/api/admin/loyalty') || routePath.startsWith('/api/admin/club')) return 'admin.access';
  if (routePath.startsWith('/api/admin/feedback')) return isRead ? 'pii.view' : 'customers.directory.manage';
  if (routePath.startsWith('/api/admin/notifications')) return 'command.view';

  // Finance V2 is deliberately explicit by operation. A generic finance
  // write capability would let an accountant-approved read path accidentally
  // authorize posting, approval, refund, or inventory mutation.
  if (routePath.startsWith('/api/admin/v2/finance/')) {
    if (routePath.includes('/inventory-items')) return 'inventory.operations';
    if (routePath.includes('/operating-expenses')) return isRead ? 'finance.view' : 'finance.payables.manage';
    if (routePath.includes('/refund-requests')) return 'payments.refund.request';
    if (routePath.includes('/purchase-orders')) return isRead ? 'finance.view' : 'inventory.manage';
    if (routePath.includes('/inventory-operations/') && routePath.endsWith('/reversal')) return 'inventory.operations';
    if (routePath.includes('/costing-inventory')) return 'inventory.view';
    if (routePath.includes('/costing-intelligence')) return 'finance.reports.view';
    if (routePath.includes('/planning/break-even')) return 'finance.reports.view';
    if (routePath.includes('/ledger-close')) return 'finance.view';
    if (routePath.includes('/opening-balances')) return routePath.includes('/preview') ? 'finance.view' : 'finance.journal.post';
    if (routePath.includes('/fixed-assets') || routePath.includes('/depreciation-runs')) return 'finance.settings.manage';
    if (routePath.includes('/payroll-runs')) return 'finance.approve';
    if (routePath.includes('/events/orders/') && routePath.endsWith('/capture')) return 'payments.collect';
    if (routePath.includes('/events/cogs/retry-ready')) return 'inventory.operations';
    if (routePath.includes('/events/')) return 'finance.journal.create';
    if (routePath.includes('/migration/') && (routePath.includes('/decision') || routePath.includes('/backfill-request'))) return 'finance.approve';
    if (routePath.includes('/migration/classify')) return 'finance.journal.create';
    if (routePath.includes('/reconciliation/settlements')) return 'finance.view';
    if (routePath.endsWith('/reports')) return 'reports.view';
    if (routePath.includes('/contracts') || routePath.includes('/workbench') || routePath.includes('/cutover-') || routePath.includes('/rollout')) return 'finance.view';
  }

  // Legacy finance compatibility routes remain read-only where their global
  // interceptor says HTTP 410, but reads still receive the same target cap.
  if (routePath.startsWith('/api/admin/finance/') || routePath.startsWith('/v1/') || routePath.startsWith('/api/tax/')) {
    if (verb === 'POST' && routePath === '/api/admin/finance/cash-drawers/session') return 'cash.manage';
    if (routePath.includes('/audit-hash') || routePath.includes('/audit/integrity') || routePath.includes('/compliance-10y')) return 'audit.view';
    if (routePath.startsWith('/v1/reports/')) return 'reports.view';
    if (routePath.includes('/cfo/') || routePath.includes('/ai-cfo') || routePath.includes('/predictive') || routePath.includes('/menu-engineering') || routePath.includes('/branch-comparison') || routePath.includes('/ap-aging') || routePath.endsWith('/pnl') || routePath.includes('/income-statement') || routePath.includes('/balance-sheet') || routePath.includes('/cash-flow')) return 'finance.reports.view';
    if (routePath.includes('/restaurant-kpis')) return 'analytics.view';
    if (routePath.includes('/z-reports')) return 'reports.view';
    if (routePath.includes('/exports/')) return 'finance.export';
    if (routePath.includes('/inventory/') || routePath.includes('/recipes') || routePath.includes('/recipe-cards') || routePath.includes('/subrecipes') || routePath.includes('/goods-receipts') || routePath.includes('/purchase-orders')) return 'inventory.view';
    if (routePath.includes('/validate-permission')) return 'finance.journal.create';
    return 'finance.view';
  }

  // Authenticated customer self-service is evaluated by the route guard after
  // the user resolver. It is kept out of the generic admin fallbacks below so
  // a guest ordering/menu endpoint is never treated as a staff permission.
  if (routePath === '/api/loyalty/customer' || routePath === '/api/loyalty/qr-code' || routePath === '/api/loyalty/redeem') return 'loyalty.self.view';
  if (routePath === '/api/orders/:id/pay-wallet' || routePath.startsWith('/api/orders/') && routePath.endsWith('/pay-wallet')) return 'orders.self.pay';
  if (routePath === '/api/campaigns/claim-birthday') return 'campaigns.self.claim';

  const mappedCapability = lookupRouteMap(ROUTE_CAPABILITY_MAP, verb, routePath);
  if (mappedCapability) return mappedCapability;

  // These authenticated operational namespaces require an explicit route
  // contract. Do not let a new endpoint inherit a broad staff/cashier/kitchen
  // capability merely because it shares a URL prefix.
  if (/^\/api\/(staff|waiter|cashier|kitchen)(\/|$)/.test(routePath)) return 'route.unmapped';

  // The legacy WESTO server still has a number of routes registered through
  // `requireAdmin`. Keep the runtime contract granular for those routes too,
  // without maintaining a second 400-line list. These rules are deliberately
  // ordered from sensitive/specific families to broader administration paths.
  const admin = routePath.startsWith('/api/admin/');

  if (routePath === '/api/content' || routePath.startsWith('/api/admin/upload') || routePath === '/api/admin/uploads') {
    return 'content.manage';
  }
  const publicMenuRead = isRead && (
    routePath === '/api/menu' ||
    routePath === '/api/menu/categories' ||
    routePath.startsWith('/api/products/')
  );
  if (publicMenuRead) return null;
  if (routePath.startsWith('/api/admin/i18n') || routePath.startsWith('/api/admin/translate/') || routePath.startsWith('/api/admin/menu') || routePath.startsWith('/api/menu') || routePath.startsWith('/api/products/')) {
    return isRead ? 'menu.view' : 'menu.manage';
  }
  if (routePath.startsWith('/api/faq')) return 'content.manage';
  if (routePath.startsWith('/api/admin/prices/') || routePath.startsWith('/api/admin/pricing')) return 'menu.price.update';

  if (routePath.startsWith('/api/admin/v2/crm') || routePath.startsWith('/api/admin/customers') || routePath.startsWith('/api/admin/feedback')) {
    return isRead ? 'pii.view' : 'customers.directory.manage';
  }
  if (routePath === '/api/admin/users' || routePath.startsWith('/api/admin/users/')) return isRead ? 'admin.access' : 'staff.manage';
  if (routePath === '/api/admin/roles' || routePath.startsWith('/api/admin/roles/')) return isRead ? 'staff.view' : 'staff.manage';
  if (routePath.startsWith('/api/admin/stats') || routePath.startsWith('/api/admin/analytics')) return 'analytics.view';
  if (routePath.startsWith('/api/admin/notifications')) return 'command.view';

  if (routePath.startsWith('/api/admin/tables')) return isRead ? 'tables.view' : 'tables.manage';
  if (routePath.startsWith('/api/admin/branches')) return isRead ? 'command.view' : 'admin.access';
  if (routePath.startsWith('/api/admin/reservation-settings')) return isRead ? 'reservations.view' : 'reservations.manage';
  if (routePath.startsWith('/api/admin/promotions')) return 'promotions.manage';
  if (routePath.startsWith('/api/admin/campaigns')) return 'promotions.manage';
  if (routePath.startsWith('/api/admin/delivery-zones')) return isRead ? 'delivery.view' : 'delivery.manage';
  if (routePath.startsWith('/api/admin/inventory')) return isRead ? 'inventory.view' : 'inventory.operations';
  if (routePath.startsWith('/api/admin/loyalty') || routePath.startsWith('/api/admin/club')) return 'admin.access';

  if (routePath.startsWith('/api/admin/sms') || routePath.startsWith('/api/admin/whatsapp')) {
    return isWrite && (routePath.includes('/send') || routePath.includes('/run') || routePath.includes('/order'))
      ? 'messaging.send'
      : isRead ? 'messaging.settings.manage' : 'messaging.settings.manage';
  }

  if (routePath.startsWith('/api/admin/settings') || routePath.startsWith('/api/admin/theme') || routePath.startsWith('/api/admin/hours') || routePath.startsWith('/api/admin/restaurant')) {
    return isRead ? 'command.view' : 'admin.access';
  }
  if (routePath.startsWith('/api/admin/v2/desktop') || routePath.startsWith('/api/admin/v2/resources')) return 'admin.access';

  // Finance V1 mutations are intercepted by the 410 middleware, but reads and
  // the vendor compatibility surface still need a capability contract.
  if (routePath.startsWith('/api/admin/finance/') || routePath.startsWith('/v1/') || routePath.startsWith('/api/tax/')) {
    if (!isRead && routePath.includes('/vendors')) return 'finance.payables.manage';
    if (routePath.includes('/exports/')) return 'finance.export';
    if (routePath.includes('/reconcile') || routePath.includes('/settlements') || routePath.includes('/bank')) return isRead ? 'finance.view' : 'finance.reconcile';
    if (routePath.includes('/payroll') || routePath.includes('/purchase') || routePath.includes('/vendors') || routePath.includes('/bills')) return isRead ? 'finance.view' : 'finance.payables.manage';
    if (routePath.includes('/journal') || routePath.includes('/coa') || routePath.includes('/expenses') || routePath.includes('/petty-cash')) return isRead ? 'finance.view' : 'finance.journal.create';
    return 'route.unmapped';
  }

  if (routePath.startsWith('/api/admin/v2/finance/')) return 'route.unmapped';

  // Every private admin route must have an explicit policy contract. Owner
  // wildcard access remains available for recovery, while staff roles fail
  // closed until the route is mapped to its actual local capability.
  if (admin) return 'route.unmapped';
  return null;
}

/**
 * Compatibility lookup retained for existing WESTO callers and older tests.
 * It describes the historical local guard vocabulary; policy enforcement and
 * GODMODE audit use lookupPolicyCapability above. Keeping the two names
 * explicit prevents a compatibility alias from being mistaken for the
 * current security contract.
 */
function lookupCapability(method, path) {
  const verb = String(method || '').toUpperCase();
  const routePath = String(path || '').replace(/\/+$/, '') || '/';
  const exact = `${verb} ${routePath}`;
  if (Object.prototype.hasOwnProperty.call(ROUTE_CAPABILITY_MAP, exact)) return ROUTE_CAPABILITY_MAP[exact];

  const segments = routePath.split('/');
  for (const [pattern, cap] of Object.entries(ROUTE_CAPABILITY_MAP)) {
    const [patVerb, patPath] = pattern.split(' ');
    if (patVerb !== verb) continue;
    const patSegs = patPath.split('/');
    if (patSegs.length !== segments.length) continue;
    if (patSegs.every((seg, i) => seg === ':*' || seg === segments[i])) return cap;
  }

  const isRead = ['GET', 'HEAD', 'OPTIONS'].includes(verb);
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(verb);
  const admin = routePath.startsWith('/api/admin/');

  if (routePath === '/api/content' || routePath.startsWith('/api/admin/upload') || routePath === '/api/admin/uploads') return 'content.manage';
  const publicMenuRead = isRead && (
    routePath === '/api/menu' ||
    routePath === '/api/menu/categories' ||
    routePath.startsWith('/api/products/')
  );
  if (publicMenuRead) return null;
  if (routePath.startsWith('/api/admin/i18n') || routePath.startsWith('/api/admin/translate/') || routePath.startsWith('/api/admin/menu') || routePath.startsWith('/api/menu') || routePath.startsWith('/api/products/')) {
    return isRead ? 'menu.view' : 'menu.manage';
  }
  if (routePath.startsWith('/api/faq')) return 'content.manage';
  if (routePath.startsWith('/api/admin/prices/') || routePath.startsWith('/api/admin/pricing')) return 'menu.price.update';
  if (routePath.startsWith('/api/admin/v2/crm') || routePath.startsWith('/api/admin/customers') || routePath.startsWith('/api/admin/feedback')) return isRead ? 'pii.view' : 'customers.directory.manage';
  if (routePath === '/api/admin/users' || routePath.startsWith('/api/admin/users/')) return isRead ? 'admin.access' : 'staff.manage';
  if (routePath === '/api/admin/roles' || routePath.startsWith('/api/admin/roles/')) return isRead ? 'staff.view' : 'staff.manage';
  if (routePath.startsWith('/api/admin/stats') || routePath.startsWith('/api/admin/analytics')) return 'analytics.view';
  if (routePath.startsWith('/api/admin/notifications')) return 'command.view';
  if (routePath.startsWith('/api/admin/tables')) return isRead ? 'tables.view' : 'service.manage';
  if (routePath.startsWith('/api/admin/branches')) return isRead ? 'command.view' : 'admin.access';
  if (routePath.startsWith('/api/admin/reservation-settings')) return isRead ? 'reservations.view' : 'reservations.manage';
  if (routePath.startsWith('/api/admin/promotions') || routePath.startsWith('/api/admin/campaigns')) return 'promotions.manage';
  if (routePath.startsWith('/api/admin/delivery-zones')) return isRead ? 'delivery.view' : 'delivery.manage';
  if (routePath.startsWith('/api/admin/inventory')) return isRead ? 'inventory.view' : 'inventory.operations';
  if (routePath.startsWith('/api/admin/loyalty') || routePath.startsWith('/api/admin/club')) return 'admin.access';
  if (routePath.startsWith('/api/admin/sms') || routePath.startsWith('/api/admin/whatsapp')) {
    return isWrite && (routePath.includes('/send') || routePath.includes('/run') || routePath.includes('/order'))
      ? 'messaging.send'
      : 'messaging.settings.manage';
  }
  if (routePath.startsWith('/api/admin/settings') || routePath.startsWith('/api/admin/theme') || routePath.startsWith('/api/admin/hours') || routePath.startsWith('/api/admin/restaurant')) return isRead ? 'command.view' : 'admin.access';
  if (routePath.startsWith('/api/admin/v2/desktop') || routePath.startsWith('/api/admin/v2/resources')) return 'admin.access';
  if (routePath.startsWith('/api/admin/finance/') || routePath.startsWith('/v1/') || routePath.startsWith('/api/tax/')) {
    if (!isRead && routePath.includes('/vendors')) return 'finance.payables.manage';
    if (routePath.includes('/exports/')) return 'finance.export';
    if (routePath.includes('/reconcile') || routePath.includes('/settlements') || routePath.includes('/bank')) return isRead ? 'finance.view' : 'finance.reconcile';
    if (routePath.includes('/payroll') || routePath.includes('/purchase') || routePath.includes('/vendors') || routePath.includes('/bills')) return isRead ? 'finance.view' : 'finance.payables.manage';
    if (routePath.includes('/journal') || routePath.includes('/coa') || routePath.includes('/expenses') || routePath.includes('/petty-cash')) return isRead ? 'finance.view' : 'finance.journal.create';
    return 'finance.view';
  }
  if (routePath.startsWith('/api/admin/v2/finance/')) return 'route.unmapped';
  if (/^\/api\/(staff|waiter|cashier|kitchen)(\/|$)/.test(routePath)) return 'route.unmapped';
  if (admin) return 'route.unmapped';
  return null;
}

module.exports = {
  ROUTE_CAPABILITY_MAP,
  OWNER_ONLY_SETTINGS_CATEGORIES,
  lookupPolicyCapability,
  lookupCapability,
};
