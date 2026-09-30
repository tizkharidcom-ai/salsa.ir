'use strict';

/**
 * Source-reviewed query/header contracts for the NEEM/WESTO OpenAPI inventory.
 *
 * This catalog is intentionally small and conservative. It only promotes a
 * parameter when the route handler's validation/fallback/security behavior is
 * explicit in source. All other auditor-observed parameters remain
 * source_observed with a deliberately open schema.
 */

function key(method, path) {
  return `${String(method).toUpperCase()} ${String(path)}`;
}

function pathKey(method, path, name) {
  return `${key(method, path)}:${name}`;
}

function parameter({ name, in: location, schema, required = false, description, sourceEvidence, ...extensions }) {
  return {
    name,
    in: location,
    required,
    schema,
    description,
    sourceEvidence,
    ...extensions
  };
}

function query(options) {
  return parameter({ ...options, in: 'query' });
}

function header(options) {
  return parameter({ ...options, in: 'header' });
}

const contracts = new Map();
const pathContracts = new Map();

function add(method, path, parameters, constraints = []) {
  contracts.set(key(method, path), { parameters, constraints });
}

function addPath(method, path, name, contract) {
  pathContracts.set(pathKey(method, path, name), contract);
}

add('GET', '/api/loyalty/customer', [
  query({
    name: 'phone',
    required: true,
    schema: { type: 'string' },
    description: 'Customer phone number; the route normalizes Persian/Arabic digits and rejects an absent or invalid phone value.',
    sourceEvidence: 'server/server.js:6225-6228'
  })
]);

add('GET', '/api/reservations/slots', [
  query({
    name: 'branch',
    schema: { type: 'string' },
    description: 'Branch identifier accepted as one of the two alternative branch selectors.',
    sourceEvidence: 'server/server.js:7332-7354'
  }),
  query({
    name: 'branchId',
    schema: { type: 'string' },
    description: 'Branch identifier accepted as one of the two alternative branch selectors.',
    sourceEvidence: 'server/server.js:7332-7354'
  }),
  query({
    name: 'date',
    required: true,
    schema: { type: 'string', format: 'date' },
    description: 'Reservation date in YYYY-MM-DD form; the route rejects a missing or malformed value.',
    sourceEvidence: 'server/server.js:7332-7342'
  }),
  query({
    name: 'partySize',
    schema: { type: 'integer', minimum: 1 },
    description: 'Requested party size; the route defaults the absent value to 2 and validates it as a positive count.',
    sourceEvidence: 'server/server.js:7332-7354'
  })
], [
  {
    rule: 'at_least_one',
    location: 'query',
    names: ['branch', 'branchId'],
    description: 'At least one branch selector is required; the handler resolves branchId first and falls back to branch.'
  }
]);

add('POST', '/api/control/integrations/westo/events', [
  header({
    name: 'x-neem-tenant-id',
    required: true,
    schema: { type: 'string' },
    description: 'Signed tenant identifier; it must be present and match body.tenantId.',
    sourceEvidence: 'server/salsa/control-plane/routes/integration-routes.js:27-39,64-75'
  }),
  header({
    name: 'x-westo-bridge-timestamp',
    required: true,
    schema: { type: 'string', pattern: '^\\d{10,16}$' },
    description: 'Unix timestamp used by the bridge HMAC verification and clock-skew check.',
    sourceEvidence: 'server/salsa/control-plane/routes/integration-routes.js:27-49'
  }),
  header({
    name: 'x-westo-bridge-signature',
    required: true,
    schema: { type: 'string' },
    description: 'HMAC-SHA256 bridge signature, optionally prefixed with sha256=.',
    sourceEvidence: 'server/salsa/control-plane/routes/integration-routes.js:27-49'
  })
]);

add('POST', '/api/control/billing/verify', [
  header({
    name: 'x-neem-gateway-timestamp',
    schema: { type: 'string' },
    description: 'Gateway callback timestamp; required by the production callback verifier and skipped only in test configuration.',
    sourceEvidence: 'server/salsa/control-plane/routes/billing-routes.js:242-260',
    'x-neem-required-in': ['production']
  }),
  header({
    name: 'x-neem-gateway-signature',
    schema: { type: 'string' },
    description: 'Gateway callback HMAC signature; required by the production callback verifier and skipped only in test configuration.',
    sourceEvidence: 'server/salsa/control-plane/routes/billing-routes.js:242-260',
    'x-neem-required-in': ['production']
  })
]);

for (const path of [
  '/api/control/provision',
  '/api/control/jobs',
  '/api/control/provisioning/jobs',
  '/api/control/provisioning/provision'
]) {
  add('POST', path, [
    header({
      name: 'idempotency-key',
      schema: { type: 'string' },
      description: 'Optional idempotency key; the handler first accepts body.idempotencyKey and then falls back to this header.',
      sourceEvidence: 'server/salsa/control-plane/routes/tenant-provisioning-routes.js:87-90'
    })
  ]);
}

add('GET', '/api/control/infra/resolve-host', [
  query({
    name: 'host',
    schema: { type: 'string' },
    description: 'Optional explicit host; when absent the handler falls back to x-forwarded-host and then host.',
    sourceEvidence: 'server/salsa/control-plane/routes/infra-routes.js:11-16'
  }),
  header({
    name: 'x-forwarded-host',
    schema: { type: 'string' },
    description: 'Optional reverse-proxy host fallback used when query.host is absent.',
    sourceEvidence: 'server/salsa/control-plane/routes/infra-routes.js:11-16'
  }),
  header({
    name: 'host',
    schema: { type: 'string' },
    description: 'Standard host fallback used when query.host and x-forwarded-host are absent.',
    sourceEvidence: 'server/salsa/control-plane/routes/infra-routes.js:11-16'
  })
]);

add('GET', '/api/control/audit', [
  query({
    name: 'limit',
    schema: { type: 'integer' },
    description: 'Optional event limit; the handler converts it to Number and defaults an absent value to 50.',
    sourceEvidence: 'server/salsa/control-plane/routes/audit-routes.js:11-20'
  }),
  query({
    name: 'tenantId',
    schema: { type: 'string' },
    description: 'Optional tenant filter passed to the audit service.',
    sourceEvidence: 'server/salsa/control-plane/routes/audit-routes.js:11-20'
  })
]);

// Source-reviewed path semantics. These entries are deliberately limited to
// identifiers whose domain is explicit in the route/service/schema source;
// generic `{id}` parameters remain route-derived until their meaning is
// unambiguous on a per-operation basis.
const tenantScopedPaths = [
  ['GET', '/api/control/{tenantId}/invitations'],
  ['POST', '/api/control/{tenantId}/invitations'],
  ['GET', '/api/control/automation/sync-status/{tenantId}'],
  ['GET', '/api/control/billing/quotas/{tenantId}'],
  ['PUT', '/api/control/billing/quotas/{tenantId}'],
  ['POST', '/api/control/billing/quotas/{tenantId}/reserve'],
  ['GET', '/api/control/data/support/tickets/{tenantId}'],
  ['GET', '/api/control/data/tickets/{tenantId}'],
  ['GET', '/api/control/infra/domains/{tenantId}'],
  ['GET', '/api/control/policy/grants/{tenantId}'],
  ['GET', '/api/control/policy/overrides/{tenantId}'],
  ['GET', '/api/control/provisioning/{tenantId}/invitations'],
  ['POST', '/api/control/provisioning/{tenantId}/invitations'],
  ['GET', '/api/control/provisioning/tenants/{tenantId}/readiness'],
  ['GET', '/api/control/support/support/tickets/{tenantId}'],
  ['GET', '/api/control/support/tickets/{tenantId}'],
  ['GET', '/api/control/tenants/{tenantId}/readiness'],
  ['GET', '/api/control/tickets/{tenantId}']
];

for (const [method, path] of tenantScopedPaths) {
  addPath(method, path, 'tenantId', {
    semanticType: 'tenant_id',
    schema: { type: 'string', minLength: 2, maxLength: 63, pattern: '^[a-z][a-z0-9-]{1,62}$' },
    description: 'Tenant identifier constrained by the Control Plane tenant_id schema; lowercase slug with 2–63 characters.',
    sourceEvidence: 'server/salsa/control-plane-schema.sql:6; server/salsa/control-plane/migrations/001_baseline_schema.sql:7'
  });
}

addPath('GET', '/api/control/tenants/{id}', 'id', {
  semanticType: 'tenant_id',
  schema: { type: 'string', minLength: 2, maxLength: 63, pattern: '^[a-z][a-z0-9-]{1,62}$' },
  description: 'Tenant detail lookup key; the registry normalizes the route value and queries the neem_tenants.tenant_id column, which enforces the lowercase slug contract.',
  sourceEvidence: 'server/salsa/control-plane/routes/tenant-routes.js:37-46; server/salsa/control-plane/registry/tenant-service.js:22-47; server/salsa/control-plane-schema.sql:6'
});

const automationRulePaths = [
  ['GET', '/api/control/automation/rules/{id}'],
  ['POST', '/api/control/automation/rules/{id}/pause']
];
for (const [method, path] of automationRulePaths) {
  addPath(method, path, 'id', {
    semanticType: 'automation_rule_id',
    schema: { type: 'string', maxLength: 64 },
    description: 'Automation rule identifier resolved by the rule engine against neem_automation_rules.id.',
    sourceEvidence: 'server/salsa/control-plane/routes/automation-routes.js:29-36,76-83; server/salsa/control-plane/automation/rule-engine.js:140-154; server/salsa/control-plane/migrations/006_automation_and_scheduler.sql:4-5'
  });
}

const automationOutboxPaths = [
  ['POST', '/api/control/automation/outbox/{id}/retry'],
  ['POST', '/api/control/automation/outbox/{id}/cancel']
];
for (const [method, path] of automationOutboxPaths) {
  addPath(method, path, 'id', {
    semanticType: 'automation_outbox_id',
    schema: { type: 'string', maxLength: 64 },
    description: 'Automation outbox task identifier resolved against neem_automation_outbox.id; the action handlers do not reinterpret the route value as another identifier domain.',
    sourceEvidence: 'server/salsa/control-plane/routes/automation-routes.js:182-205; server/salsa/control-plane/automation/outbox-worker.js:764-821; server/salsa/control-plane/migrations/006_automation_and_scheduler.sql:17-18'
  });
}

addPath('POST', '/api/control/automation/incidents/{id}/resolve', 'id', {
  semanticType: 'automation_incident_id',
  schema: { type: 'string', maxLength: 64 },
  description: 'Operational incident identifier resolved by syncStateService against neem_incidents.id.',
  sourceEvidence: 'server/salsa/control-plane/routes/automation-routes.js:249-256; server/salsa/control-plane/automation/sync-state-service.js:287-301; server/salsa/control-plane/migrations/011_releases_canary_and_incidents.sql:64-65'
});

const billingSubscriptionPaths = [
  ['GET', '/api/control/billing/subscriptions/{id}'],
  ['POST', '/api/control/billing/subscriptions/{id}/renew'],
  ['POST', '/api/control/billing/subscriptions/{id}/cancel']
];
for (const [method, path] of billingSubscriptionPaths) {
  addPath(method, path, 'id', {
    semanticType: 'billing_subscription_id',
    schema: { type: 'string', maxLength: 64 },
    description: 'Billing subscription identifier resolved by paymentService against neem_billing_subscriptions.id.',
    sourceEvidence: 'server/salsa/control-plane/routes/billing-routes.js:134-170; server/salsa/control-plane/billing/payment-service.js:163-170; server/salsa/control-plane/migrations/005_neem_billing_and_subscriptions.sql:15-16'
  });
}

const billingInvoicePaths = [
  ['GET', '/api/control/billing/invoices/{id}'],
  ['GET', '/api/control/billing/invoices/{id}/snapshot'],
  ['POST', '/api/control/billing/invoices/{id}/refund']
];
for (const [method, path] of billingInvoicePaths) {
  addPath(method, path, 'id', {
    semanticType: 'billing_invoice_id',
    schema: { type: 'string', maxLength: 64 },
    description: 'Billing invoice identifier resolved by paymentService against neem_billing_invoices.id; the refund alias uses the route value as the invoice lookup key.',
    sourceEvidence: 'server/salsa/control-plane/routes/billing-routes.js:186-205,283-299; server/salsa/control-plane/billing/payment-service.js:299-304; server/salsa/control-plane/migrations/005_neem_billing_and_subscriptions.sql:32-33'
  });
}

addPath('POST', '/api/control/billing/transactions/{id}/retry-activation', 'id', {
  semanticType: 'billing_transaction_id',
  schema: { type: 'string', maxLength: 64 },
  description: 'Billing transaction identifier resolved by paymentService against neem_billing_transactions.id for entitlement-activation retry.',
  sourceEvidence: 'server/salsa/control-plane/routes/billing-routes.js:271-280; server/salsa/control-plane/billing/payment-service.js:824-851; server/salsa/control-plane/migrations/005_neem_billing_and_subscriptions.sql:49-50'
});

const infrastructureDomainPaths = [
  ['POST', '/api/control/infra/domains/{id}/verify-dns'],
  ['POST', '/api/control/infra/domains/{id}/request-tls']
];
for (const [method, path] of infrastructureDomainPaths) {
  addPath(method, path, 'id', {
    semanticType: 'infrastructure_domain_id',
    schema: { type: 'string', maxLength: 64 },
    description: 'Infrastructure domain identifier passed to the DNS/TLS services and persisted as neem_infrastructure_domains.id.',
    sourceEvidence: 'server/salsa/control-plane/routes/infra-routes.js:62-77; server/salsa/control-plane/migrations/008_infrastructure_domains_and_tls.sql:4-6'
  });
}

addPath('POST', '/api/control/edge/devices/{id}/fence', 'id', {
  semanticType: 'edge_device_id',
  schema: { type: 'string', maxLength: 64 },
  description: 'Edge device identifier passed to pairingService.fenceDevice and persisted as neem_edge_devices.id.',
  sourceEvidence: 'server/salsa/control-plane/routes/edge-routes.js:115-127; server/salsa/control-plane/migrations/009_edge_devices_and_leases.sql:4-6'
});

const membershipPaths = [
  ['GET', '/api/control/identities/{id}'],
  ['PATCH', '/api/control/identities/{id}/role'],
  ['POST', '/api/control/identities/{id}/suspend'],
  ['POST', '/api/control/identities/{id}/reactivate'],
  ['POST', '/api/control/identities/{id}/revoke'],
  ['DELETE', '/api/control/identities/{id}']
];
for (const [method, path] of membershipPaths) {
  addPath(method, path, 'id', {
    semanticType: 'tenant_membership_id',
    schema: { type: 'string', maxLength: 64 },
    description: 'Tenant membership identifier. Despite the router prefix, the handlers read and mutate neem_tenant_memberships.id through identityService membership operations.',
    sourceEvidence: 'server/salsa/control-plane/routes/identity-routes.js:40-75,129-176,178-342; server/salsa/control-plane/tenant/identity-service.js:1-40; server/salsa/control-plane/migrations/013_tenant_identities_and_memberships.sql:21-24'
  });
}

const supportTicketPaths = [
  ['GET', '/api/control/data/support/tickets/{id}'],
  ['GET', '/api/control/data/support/tickets/{id}/details'],
  ['POST', '/api/control/data/support/tickets/{id}/messages'],
  ['PATCH', '/api/control/data/support/tickets/{id}/status'],
  ['GET', '/api/control/data/ticket-details/{id}'],
  ['GET', '/api/control/data/tickets/{id}/details'],
  ['POST', '/api/control/data/tickets/{id}/messages'],
  ['PATCH', '/api/control/data/tickets/{id}/status'],
  ['GET', '/api/control/support/support/tickets/{id}'],
  ['GET', '/api/control/support/support/tickets/{id}/details'],
  ['POST', '/api/control/support/support/tickets/{id}/messages'],
  ['PATCH', '/api/control/support/support/tickets/{id}/status'],
  ['GET', '/api/control/support/ticket-details/{id}'],
  ['GET', '/api/control/support/tickets/{id}'],
  ['GET', '/api/control/support/tickets/{id}/details'],
  ['POST', '/api/control/support/tickets/{id}/messages'],
  ['PATCH', '/api/control/support/tickets/{id}/status'],
  ['GET', '/api/control/ticket-details/{id}'],
  ['GET', '/api/control/tickets/{id}/details'],
  ['POST', '/api/control/tickets/{id}/messages'],
  ['PATCH', '/api/control/tickets/{id}/status']
];
for (const [method, path] of supportTicketPaths) {
  addPath(method, path, 'id', {
    semanticType: 'support_ticket_id',
    schema: { type: 'string', maxLength: 64 },
    description: 'Support ticket identifier resolved by supportService ticket detail/message/status operations and persisted as neem_support_tickets.id. Alias routes are equivalent projections of the same handler.',
    sourceEvidence: 'server/salsa/control-plane/routes/support-routes.js:135-178; server/salsa/control-plane/migrations/007_support_and_pii_security.sql:4-6'
  });
}

const tenantCustomerRevealPaths = [
  ['POST', '/api/control/customers/{id}/reveal'],
  ['POST', '/api/control/data/customers/{id}/reveal'],
  ['POST', '/api/control/data/data/customers/{id}/reveal'],
  ['POST', '/api/control/support/customers/{id}/reveal'],
  ['POST', '/api/control/support/data/customers/{id}/reveal']
];
for (const [method, path] of tenantCustomerRevealPaths) {
  addPath(method, path, 'id', {
    semanticType: 'tenant_customer_id',
    schema: { type: 'string', maxLength: 64 },
    description: 'Tenant customer identifier used by the controlled PII reveal handler and persisted as neem_tenant_customers.id.',
    sourceEvidence: 'server/salsa/control-plane/routes/support-routes.js:306-324; server/salsa/control-plane/migrations/017_support_tickets_sessions_keyring_and_pii_audit.sql:34-37'
  });
}

addPath('POST', '/api/control/policy/outbox/{id}/ack', 'id', {
  semanticType: 'policy_outbox_id',
  schema: { type: 'string', format: 'uuid' },
  description: 'Policy distribution outbox identifier acknowledged by publishService against neem_policy_outbox.id, whose canonical Control Plane schema is UUID.',
  sourceEvidence: 'server/salsa/control-plane/routes/policy-routes.js:138-145; server/salsa/control-plane/policy/publish-service.js:94-103; server/salsa/control-plane/migrations/003_versioned_policy_engine.sql:55-58'
});

const supportSessionPaths = [
  ['POST', '/api/control/data/sessions/{id}/revoke'],
  ['POST', '/api/control/data/support/sessions/{id}/end'],
  ['POST', '/api/control/data/support/sessions/{id}/revoke'],
  ['POST', '/api/control/sessions/{id}/revoke'],
  ['POST', '/api/control/support/sessions/{id}/end'],
  ['POST', '/api/control/support/sessions/{id}/revoke'],
  ['POST', '/api/control/support/support/sessions/{id}/end'],
  ['POST', '/api/control/support/support/sessions/{id}/revoke']
];
for (const [method, path] of supportSessionPaths) {
  addPath(method, path, 'id', {
    semanticType: 'support_session_id',
    schema: { type: 'string', maxLength: 64 },
    description: 'Support session identifier passed to the shared revokeSession handler. The service generates the supp_sess_ prefix and migration 007 reconciles the baseline UUID column to VARCHAR(64).',
    sourceEvidence: 'server/salsa/control-plane/routes/support-routes.js:251-255; server/salsa/control-plane/support/support-service.js:346-350,604-607; server/salsa/control-plane/migrations/007_support_and_pii_security.sql:19-20,33-47'
  });
}

const financeV2PathGroups = [
  {
    semanticType: 'restaurant_order_id',
    name: 'orderId',
    paths: [
      ['GET', '/api/admin/v2/finance/orders/{orderId}/chain'],
      ['POST', '/api/admin/v2/finance/orders/{orderId}/refund-requests'],
      ['POST', '/api/admin/v2/finance/events/orders/{orderId}/capture']
    ],
    description: 'WESTO restaurant order identifier resolved against db.orders by finance-v2 order-chain, refund and capture handlers.',
    sourceEvidence: 'server/finance-v2.js:3783-3789,6318-6321,6364-6375,6645-6650'
  },
  {
    semanticType: 'finance_inventory_item_id',
    name: 'id',
    paths: [['PATCH', '/api/admin/v2/finance/inventory-items/{id}']],
    description: 'Finance V2 inventory item identifier resolved against accounting.inventoryItems by updateInventoryItemV2.',
    sourceEvidence: 'server/finance-v2.js:601-609,612-615,6336-6344'
  },
  {
    semanticType: 'finance_purchase_order_id',
    name: 'id',
    paths: [['POST', '/api/admin/v2/finance/purchase-orders/{id}/submit']],
    description: 'Finance V2 purchase order identifier resolved against state.purchaseOrders by submitPurchaseOrderV2.',
    sourceEvidence: 'server/finance-v2.js:1880-1887,1890-1898,6391-6399'
  },
  {
    semanticType: 'finance_vendor_invoice_id',
    name: 'id',
    paths: [
      ['POST', '/api/admin/v2/finance/vendor-invoices/{id}/match-review'],
      ['POST', '/api/admin/v2/finance/vendor-invoices/{id}/payment-request']
    ],
    description: 'Finance V2 vendor invoice identifier resolved against state.vendorInvoices by match-review and supplier-payment handlers.',
    sourceEvidence: 'server/finance-v2.js:2084-2093,2114-2125,2143-2152,6410-6432'
  },
  {
    semanticType: 'finance_cost_commitment_id',
    name: 'id',
    paths: [
      ['POST', '/api/admin/v2/finance/cost-commitments/{id}/deactivate'],
      ['POST', '/api/admin/v2/finance/cost-commitments/{id}/accruals']
    ],
    description: 'Finance V2 recurring cost commitment identifier resolved against state.costCommitments.',
    sourceEvidence: 'server/finance-v2.js:2188-2196,2232-2256,6443-6459'
  },
  {
    semanticType: 'finance_cost_accrual_id',
    name: 'id',
    paths: [['POST', '/api/admin/v2/finance/cost-accruals/{id}/payment-request']],
    description: 'Finance V2 cost accrual identifier resolved against state.costAccruals by requestCostAccrualPayment.',
    sourceEvidence: 'server/finance-v2.js:2307-2317,6461-6468'
  },
  {
    semanticType: 'finance_inventory_event_id',
    name: 'eventId',
    paths: [['POST', '/api/admin/v2/finance/inventory-operations/{eventId}/reversal']],
    description: 'Finance V2 inventory operation event identifier resolved against state.events and restricted to inventory operation sources.',
    sourceEvidence: 'server/finance-v2.js:4858-4868,6508-6514'
  },
  {
    semanticType: 'finance_payroll_run_id',
    name: 'id',
    paths: [['POST', '/api/admin/v2/finance/payroll-runs/{id}/payment-request']],
    description: 'Finance V2 payroll run identifier resolved by requestPayrollPaymentV2 against the payroll run collection.',
    sourceEvidence: 'server/finance-v2.js:2577-2588,6589-6595'
  },
  {
    semanticType: 'finance_fiscal_period_id',
    name: 'id',
    paths: [
      ['POST', '/api/admin/v2/finance/fiscal-periods/{id}/close'],
      ['POST', '/api/admin/v2/finance/fiscal-periods/{id}/reopen-request']
    ],
    description: 'Finance V2 fiscal period identifier resolved against state.fiscalPeriods by close and reopen handlers.',
    sourceEvidence: 'server/finance-v2.js:808-815,849-856,6614-6636'
  },
  {
    semanticType: 'finance_event_id',
    name: 'id',
    paths: [['POST', '/api/admin/v2/finance/events/{id}/resolve']],
    description: 'Finance V2 event identifier resolved by resolveEvent against state.events.',
    sourceEvidence: 'server/finance-v2.js:2692-2705,6685-6691'
  },
  {
    semanticType: 'finance_legacy_archive_id',
    name: 'id',
    paths: [
      ['POST', '/api/admin/v2/finance/migration/archive/{id}/decision'],
      ['POST', '/api/admin/v2/finance/migration/archive/{id}/backfill-preview'],
      ['POST', '/api/admin/v2/finance/migration/archive/{id}/backfill-request']
    ],
    description: 'Read-only/archive migration record identifier resolved through the guarded legacy archive helpers; the route scope check runs before mutation.',
    sourceEvidence: 'server/finance-v2.js:2925-2935,2977-2988,3028-3040,6717-6738'
  },
  {
    semanticType: 'finance_journal_entry_id',
    name: 'id',
    paths: [
      ['POST', '/api/admin/v2/finance/journal-entries/{id}/submit'],
      ['POST', '/api/admin/v2/finance/journal-entries/{id}/reversal']
    ],
    description: 'Finance V2 journal entry identifier resolved by submitDraft/reverseEntry against state.journalEntries.',
    sourceEvidence: 'server/finance-v2.js:5418-5428,5834-5845,6754-6768'
  },
  {
    semanticType: 'finance_bank_statement_line_id',
    name: 'id',
    paths: [['POST', '/api/admin/v2/finance/reconciliation/bank-statement-lines/{id}/match']],
    description: 'Finance V2 bank statement line identifier resolved by matchBankStatementLine.',
    sourceEvidence: 'server/finance-v2.js:3668-3678,6798-6808'
  },
  {
    semanticType: 'finance_approval_id',
    name: 'id',
    paths: [['POST', '/api/admin/v2/finance/approvals/{id}/decision']],
    description: 'Finance V2 approval identifier resolved by decideApproval against state.approvals.',
    sourceEvidence: 'server/finance-v2.js:5435-5446,6831-6839'
  }
];
for (const group of financeV2PathGroups) {
  for (const [method, path] of group.paths) {
    addPath(method, path, group.name, {
      semanticType: group.semanticType,
      schema: { type: 'string', maxLength: 64 },
      description: group.description,
      sourceEvidence: group.sourceEvidence
    });
  }
}

const operationalRestaurantOrderPaths = [
  ['PATCH', '/api/cashier/orders/{id}'],
  ['POST', '/api/cashier/orders/{id}/apply-loyalty'],
  ['POST', '/api/cashier/orders/{id}/settle'],
  ['POST', '/api/staff/orders/{id}/settle'],
  ['POST', '/api/cashier/orders/{id}/print'],
  ['POST', '/api/cashier/orders/{id}/receipt'],
  ['PATCH', '/api/cashier/orders/{id}/status'],
  ['PATCH', '/api/waiter/orders/{id}/status'],
  ['PATCH', '/api/waiter/orders/{id}/fire-course'],
  ['POST', '/api/waiter/orders/{id}/split'],
  ['PATCH', '/api/waiter/orders/{id}/move-table'],
  ['PATCH', '/api/admin/orders/{id}'],
  ['PATCH', '/api/v2/orders/{id}/status'],
  ['PATCH', '/api/kitchen/orders/{id}'],
  ['POST', '/api/orders/{id}/pay-wallet'],
  ['POST', '/api/admin/whatsapp/order/{id}']
];
for (const [method, path] of operationalRestaurantOrderPaths) {
  addPath(method, path, 'id', {
    semanticType: 'restaurant_order_id',
    schema: { type: 'string', maxLength: 64 },
    description: 'Operational restaurant order identifier resolved against db.orders; the handlers normalize Persian/Arabic digits and compare the resulting numeric key with the order record.',
    sourceEvidence: 'server/server.js:3481-3484,3571-3574,3630-3633,3791-3794,3820-3823,3879-3882,3931-3934,4054-4057,4083-4086,4166-4169,4326-4329,4390-4393,4642-4646,6789-6791,7581-7583'
  });
}

const waiterCallPaths = [
  ['PATCH', '/api/waiter/calls/{id}'],
  ['PATCH', '/api/kitchen/calls/{id}']
];
for (const [method, path] of waiterCallPaths) {
  addPath(method, path, 'id', {
    semanticType: 'waiter_call_id',
    schema: { type: 'string', maxLength: 64 },
    description: 'Waiter-service call identifier resolved against db.waiterCalls; both waiter and kitchen handlers use the same call collection and numeric record key.',
    sourceEvidence: 'server/server.js:3912-3915,4838-4841; server/server.js:300-301,446-448'
  });
}

addPath('PATCH', '/api/waiter/waitlist/{id}', 'id', {
  semanticType: 'waitlist_entry_id',
  schema: { type: 'string', maxLength: 64 },
  description: 'Waitlist entry identifier resolved against db.reservations and constrained by waitlist.isWaitlist before the entry is mutated.',
  sourceEvidence: 'server/server.js:4014-4017; server/server.js:3986-3990'
});

const catalogAndOperationsPathGroups = [
  {
    semanticType: 'user_address_id',
    name: 'id',
    paths: [
      ['PUT', '/api/user/addresses/{id}'],
      ['DELETE', '/api/user/addresses/{id}'],
      ['POST', '/api/user/addresses/{id}/default']
    ],
    description: 'Authenticated user address identifier resolved inside the current user.addresses collection; created address keys use the addr_ prefix and the legacy addr_default key is also supported.',
    sourceEvidence: 'server/server.js:1965-2019,2022-2066,2069-2085,2088-2102'
  },
  {
    semanticType: 'menu_item_id',
    name: 'id',
    paths: [
      ['POST', '/api/admin/translate/menu/{id}'],
      ['PUT', '/api/menu/{id}'],
      ['DELETE', '/api/menu/{id}'],
      ['PATCH', '/api/kitchen/items/{id}/availability']
    ],
    description: 'Menu item identifier resolved against db.menuItems by translation, catalog mutation and kitchen availability handlers.',
    sourceEvidence: 'server/server.js:2524-2527,2648-2652,2745-2748,4736-4739'
  },
  {
    semanticType: 'menu_category_id',
    name: 'id',
    paths: [
      ['PUT', '/api/menu/categories/{id}'],
      ['DELETE', '/api/menu/categories/{id}']
    ],
    description: 'Menu category identifier resolved against db.menuCategories by category update/delete handlers.',
    sourceEvidence: 'server/server.js:2602-2606,2631-2635'
  },
  {
    semanticType: 'menu_complement_id',
    name: 'id',
    paths: [
      ['PUT', '/api/admin/menu-complements/{id}'],
      ['DELETE', '/api/admin/menu-complements/{id}']
    ],
    description: 'Menu complement identifier resolved against db.menuComplements and removed from dependent rules on delete.',
    sourceEvidence: 'server/server.js:2389-2392,2400-2404'
  },
  {
    semanticType: 'menu_complement_rule_id',
    name: 'id',
    paths: [
      ['PUT', '/api/admin/menu-complement-rules/{id}'],
      ['DELETE', '/api/admin/menu-complement-rules/{id}']
    ],
    description: 'Menu complement rule identifier resolved against db.menuComplementRules by rule update/delete handlers.',
    sourceEvidence: 'server/server.js:2419-2422,2430-2434'
  },
  {
    semanticType: 'payment_attempt_id',
    name: 'id',
    paths: [['POST', '/api/checkout/payments/{id}/sandbox-confirm']],
    description: 'Checkout payment-attempt identifier resolved against db.paymentAttempts and settled through settlePaymentAttempt.',
    sourceEvidence: 'server/server.js:3101-3116,3174-3177,3307-3324'
  },
  {
    semanticType: 'payment_provider',
    name: 'provider',
    paths: [['POST', '/api/payments/webhook/{provider}']],
    description: 'Payment provider key matched exactly against payment.provider before the webhook is accepted; the configured provider is carried on payment attempts.',
    sourceEvidence: 'server/server.js:3104-3110,3228-3237,3327-3333'
  },
  {
    semanticType: 'delivery_zone_id',
    name: 'id',
    paths: [
      ['PATCH', '/api/admin/delivery-zones/{id}'],
      ['DELETE', '/api/admin/delivery-zones/{id}']
    ],
    description: 'Delivery-zone identifier resolved against db.deliveryZones by branch-scoped update/delete handlers.',
    sourceEvidence: 'server/server.js:4198-4213,4239-4249,4252-4260'
  },
  {
    semanticType: 'faq_id',
    name: 'id',
    paths: [
      ['PUT', '/api/faq/{id}'],
      ['DELETE', '/api/faq/{id}']
    ],
    description: 'FAQ identifier resolved against db.faq by admin update/delete handlers.',
    sourceEvidence: 'server/server.js:4862-4870,4872-4877'
  },
  {
    semanticType: 'table_id',
    name: 'id',
    paths: [['DELETE', '/api/admin/tables/{id}']],
    description: 'Restaurant table identifier resolved against db.tables with optional branch guard during deletion.',
    sourceEvidence: 'server/server.js:5536-5542,5602-5613'
  },
  {
    semanticType: 'branch_id',
    name: 'id',
    paths: [
      ['PUT', '/api/admin/branches/{id}'],
      ['DELETE', '/api/admin/branches/{id}']
    ],
    description: 'Restaurant branch identifier resolved against db.branches; deletion also reassigns dependent tables and orders to a fallback branch.',
    sourceEvidence: 'server/server.js:5671-5673,5704-5707,5737-5751'
  },
  {
    semanticType: 'promotion_id',
    name: 'id',
    paths: [
      ['PATCH', '/api/admin/promotions/{id}'],
      ['DELETE', '/api/admin/promotions/{id}']
    ],
    description: 'Promotion identifier resolved against db.promotions by admin update/delete handlers.',
    sourceEvidence: 'server/server.js:5755-5756,5782-5799,5801-5805'
  },
  {
    semanticType: 'promo_slide_id',
    name: 'id',
    paths: [
      ['PATCH', '/api/admin/promo-slides/{id}'],
      ['DELETE', '/api/admin/promo-slides/{id}'],
      ['POST', '/api/promo-slides/{id}/impression'],
      ['POST', '/api/promo-slides/{id}/click']
    ],
    description: 'Promotional slide identifier resolved against db.promoSlides by admin mutation and public impression/click handlers.',
    sourceEvidence: 'server/server.js:5808-5813,5832-5847,5861-5873'
  },
  {
    semanticType: 'reservation_id',
    name: 'id',
    paths: [['PATCH', '/api/admin/reservations/{id}']],
    description: 'Reservation identifier resolved against db.reservations by the admin reservation mutation handler.',
    sourceEvidence: 'server/server.js:7428-7433,7491-7495'
  },
  {
    semanticType: 'feedback_id',
    name: 'id',
    paths: [['PATCH', '/api/admin/feedback/{id}']],
    description: 'Operational feedback identifier resolved against db.feedback by the admin status mutation handler.',
    sourceEvidence: 'server/server.js:7659-7669,7686-7691'
  }
];
for (const group of catalogAndOperationsPathGroups) {
  for (const [method, path] of group.paths) {
    addPath(method, path, group.name, {
      semanticType: group.semanticType,
      schema: { type: 'string', maxLength: 64 },
      description: group.description,
      sourceEvidence: group.sourceEvidence
    });
  }
}

const legacyFinancePathGroups = [
  {
    semanticType: 'finance_coa_code',
    name: 'code',
    paths: [['PATCH', '/api/admin/finance/coa/{code}']],
    description: 'Chart-of-accounts code resolved against acc.accounts by the legacy accounting route.',
    sourceEvidence: 'server/accounting-routes.js:200-205'
  },
  {
    semanticType: 'pos_sale_id',
    name: 'id',
    paths: [
      ['POST', '/v1/pos/sales/{id}/refunds'],
      ['POST', '/api/pos/sales/{id}/refunds'],
      ['GET', '/v1/pos/sales/{id}'],
      ['GET', '/api/pos/sales/{id}']
    ],
    description: 'POS sale identifier/key resolved by the legacy sales surface; read lookup accepts the internal id or external_id and refund aliases are read-only 410 compatibility routes.',
    sourceEvidence: 'server/accounting-routes.js:218-231'
  },
  {
    semanticType: 'tax_einvoice_key',
    name: 'id',
    paths: [
      ['GET', '/v1/tax/einvoices/{id}/status'],
      ['GET', '/api/tax/einvoices/{id}/status'],
      ['POST', '/api/admin/finance/einvoices/{id}/retry']
    ],
    description: 'Tax e-invoice identifier/key resolved against taxInvoices; the compatibility routes accept either invoice.id or tax_uid before status/retry.',
    sourceEvidence: 'server/accounting-routes.js:89-93,254-260,301-307'
  },
  {
    semanticType: 'legacy_journal_entry_key',
    name: 'id',
    paths: [['GET', '/api/admin/finance/journal/{id}']],
    description: 'Legacy accounting journal key resolved against acc.journalEntries by either entry.id or entry.number.',
    sourceEvidence: 'server/accounting-routes.js:385-391'
  },
  {
    semanticType: 'legacy_purchase_order_id',
    name: 'id',
    paths: [['POST', '/api/admin/finance/purchase-orders/{id}/approve']],
    description: 'Legacy accounting purchase-order identifier scoped against acc.purchaseOrders before approvePurchaseOrder.',
    sourceEvidence: 'server/accounting-routes.js:715-724'
  },
  {
    semanticType: 'finance_vendor_id',
    name: 'id',
    paths: [['PUT', '/api/admin/finance/vendors/{id}']],
    description: 'Accounting vendor identifier passed to the vendor upsert handler and resolved within acc.vendors.',
    sourceEvidence: 'server/accounting-routes.js:845-890'
  },
  {
    semanticType: 'finance_bill_id',
    name: 'id',
    paths: [
      ['POST', '/api/admin/finance/bills/{id}/pay'],
      ['POST', '/api/admin/finance/bills/{id}/payments']
    ],
    description: 'Vendor-bill identifier scoped against acc.vendorBills before payVendorBill; the two paths are aliases of the same handler.',
    sourceEvidence: 'server/accounting-routes.js:902-922'
  },
  {
    semanticType: 'legacy_payroll_run_id',
    name: 'id',
    paths: [
      ['POST', '/v1/payroll/runs/{id}/disburse'],
      ['POST', '/api/admin/finance/payroll/runs/{id}/disburse']
    ],
    description: 'Legacy accounting payroll-run identifier scoped against acc.payrollRuns before disbursePayroll; the v1 and admin aliases share the handler.',
    sourceEvidence: 'server/accounting-routes.js:977-995'
  },
  {
    semanticType: 'finance_fixed_asset_id',
    name: 'id',
    paths: [['POST', '/api/admin/finance/fixed-assets/{id}/dispose']],
    description: 'Fixed-asset identifier scoped against acc.fixedAssets before asset disposal and journal posting.',
    sourceEvidence: 'server/accounting-routes.js:1036-1054'
  },
  {
    semanticType: 'legacy_fiscal_period_id',
    name: 'id',
    paths: [
      ['POST', '/api/admin/finance/fiscal-periods/{id}/lock'],
      ['POST', '/api/admin/finance/fiscal-periods/{id}/reopen']
    ],
    description: 'Legacy accounting fiscal-period identifier scoped against acc.fiscalPeriods before lock/reopen; both actions use the period service.',
    sourceEvidence: 'server/accounting-routes.js:1095-1126'
  },
  {
    semanticType: 'finance_accrual_id',
    name: 'id',
    paths: [['POST', '/api/admin/finance/accruals/{id}/reverse']],
    description: 'Accounting accrual identifier scoped against acc.accruals before reverseAccrual.',
    sourceEvidence: 'server/accounting-routes.js:1342-1353'
  },
  {
    semanticType: 'finance_prepaid_id',
    name: 'id',
    paths: [['POST', '/api/admin/finance/prepaids/{id}/amortize']],
    description: 'Accounting prepaid-expense identifier scoped against acc.prepaids before amortizePrepaidPeriod.',
    sourceEvidence: 'server/accounting-routes.js:1373-1393'
  },
  {
    semanticType: 'billing_plan_code',
    name: 'code',
    paths: [['POST', '/api/control/billing/plans/{code}/publish']],
    description: 'Billing plan code resolved through pricingService.getPlan/listPlans and normalized to planCode before publication.',
    sourceEvidence: 'server/salsa/control-plane/routes/billing-routes.js:84-99'
  }
];
for (const group of legacyFinancePathGroups) {
  for (const [method, path] of group.paths) {
    addPath(method, path, group.name, {
      semanticType: group.semanticType,
      schema: { type: 'string', maxLength: 64 },
      description: group.description,
      sourceEvidence: group.sourceEvidence
    });
  }
}

const finalPathSemanticGroups = [
  {
    semanticType: 'deprecated_compatibility_token',
    name: 'id',
    paths: [
      ['PUT', '/api/products/{id}'],
      ['POST', '/api/admin/finance/journal/{id}/reverse']
    ],
    description: 'Opaque legacy path token retained only for route compatibility; the handler always returns HTTP 410 and does not resolve, validate or mutate a domain record.',
    sourceEvidence: 'server/server.js:2275-2280; server/accounting-routes.js:398-400'
  },
  {
    semanticType: 'admin_v2_resource_row_id',
    name: 'id',
    paths: [
      ['PATCH', '/api/admin/v2/resources/{resource}/{id}'],
      ['DELETE', '/api/admin/v2/resources/{resource}/{id}']
    ],
    description: 'Admin V2 resource-row identifier compared against row.id within the resource collection selected by the companion resource path parameter.',
    sourceEvidence: 'server/admin-v2.js:544-575'
  },
  {
    semanticType: 'finance_recipe_lookup_key',
    name: 'id',
    paths: [['GET', '/api/admin/finance/recipes/{id}']],
    description: 'Branch-scoped recipe lookup key accepting either recipe.id or recipe.menuItemId after Persian/Arabic digit normalization.',
    sourceEvidence: 'server/accounting-routes.js:1229-1240'
  },
  {
    semanticType: 'finance_recipe_id',
    name: 'id',
    paths: [
      ['PUT', '/api/admin/finance/recipes/{id}'],
      ['GET', '/api/admin/finance/recipes/{id}/bom']
    ],
    description: 'Branch-scoped recipe identifier resolved against recipe.id before update or BOM expansion.',
    sourceEvidence: 'server/accounting-routes.js:1255-1269,1655-1670; server/finance/inventory-engine.js:745-760'
  }
];
for (const group of finalPathSemanticGroups) {
  for (const [method, path] of group.paths) {
    addPath(method, path, group.name, {
      semanticType: group.semanticType,
      schema: { type: 'string' },
      description: group.description,
      sourceEvidence: group.sourceEvidence
    });
  }
}

const provisioningJobPaths = [
  ['GET', '/api/control/jobs/{jobId}'],
  ['POST', '/api/control/jobs/{jobId}/quarantine'],
  ['POST', '/api/control/jobs/{jobId}/retry'],
  ['GET', '/api/control/provision/{jobId}'],
  ['POST', '/api/control/provision/{jobId}/quarantine'],
  ['POST', '/api/control/provision/{jobId}/retry'],
  ['GET', '/api/control/provisioning/jobs/{jobId}'],
  ['POST', '/api/control/provisioning/jobs/{jobId}/quarantine'],
  ['POST', '/api/control/provisioning/jobs/{jobId}/retry'],
  ['GET', '/api/control/provisioning/provision/{jobId}'],
  ['POST', '/api/control/provisioning/provision/{jobId}/quarantine'],
  ['POST', '/api/control/provisioning/provision/{jobId}/retry']
];

for (const [method, path] of provisioningJobPaths) {
  addPath(method, path, 'jobId', {
    semanticType: 'provisioning_job_id',
    schema: { type: 'string', maxLength: 64 },
    description: 'Provisioning job identifier persisted in neem_provisioning_jobs.id; generated jobs use the job_ prefix and the column is limited to 64 characters.',
    sourceEvidence: 'server/salsa/control-plane/tenant/provisioning-runner.js:103; server/salsa/control-plane/migrations/004_tenant_provisioning_and_isolation.sql:4-6'
  });
}

for (const method of ['POST']) {
  for (const path of [
    '/api/control/releases/{version}/waves',
    '/api/control/releases/{version}/evaluate-canary'
  ]) {
    addPath(method, path, 'version', {
      semanticType: 'semantic_version',
      schema: {
        type: 'string',
        pattern: '^[vV]?(\\d+)\\.(\\d+)\\.(\\d+)(?:-([0-9A-Za-z.-]+))?(?:\\+([0-9A-Za-z.-]+))?$'
      },
      description: 'Release version accepted by the source semver parser, including an optional v/V prefix, prerelease and build metadata.',
      sourceEvidence: 'server/salsa/control-plane/releases/release-canary-service.js:13-24'
    });
  }
}

addPath('GET', '/api/staff/session/{workspace}', 'workspace', {
  semanticType: 'staff_workspace',
  schema: { type: 'string', enum: ['cashier', 'waiter', 'kitchen'] },
  description: 'Operational staff workspace key; the route resolves only the cashier, waiter and kitchen workspaces.',
  sourceEvidence: 'server/server.js:1507-1515'
});

addPath('GET', '/ops/{view}', 'view', {
  semanticType: 'operations_view',
  schema: {
    type: 'string',
    enum: [
      'tables', 'customers', 'marketing', 'reservations', 'waiter-panel',
      'fin-overview', 'fin-sales', 'fin-cash-drawers', 'fin-settlements',
      'fin-journal', 'fin-gl', 'fin-coa', 'fin-trial-balance', 'fin-reports',
      'fin-period-close', 'fin-command-center', 'fin-expenses', 'fin-bank-feed',
      'fin-three-way-match', 'fin-tax-matrix'
    ]
  },
  description: 'Operations deep-link view accepted by the explicit NEEM_OPERATION_VIEWS allowlist.',
  sourceEvidence: 'server/server.js:1771-1782'
});

const adminResourcePaths = [
  ['GET', '/api/admin/v2/resources/{resource}'],
  ['POST', '/api/admin/v2/resources/{resource}'],
  ['PATCH', '/api/admin/v2/resources/{resource}/{id}'],
  ['DELETE', '/api/admin/v2/resources/{resource}/{id}']
];
for (const [method, path] of adminResourcePaths) {
  addPath(method, path, 'resource', {
    semanticType: 'admin_v2_resource',
    schema: {
      type: 'string',
      enum: ['customer-params', 'messages', 'credit-cards', 'survey-settings', 'warehouses', 'notices-list', 'shifts', 'terminal-categories', 'couriers', 'funds', 'event-reservation']
    },
    description: 'Admin V2 resource key accepted by the explicit ADMIN_V2_RESOURCE_KEYS allowlist.',
    sourceEvidence: 'server/admin-v2.js:283-291'
  });
}

const desktopDownloadPath = '/api/admin/v2/desktop/releases/{platform}/{arch}/{format}/download';
addPath('GET', desktopDownloadPath, 'platform', {
  semanticType: 'desktop_platform',
  schema: { type: 'string', enum: ['macos', 'windows'] },
  description: 'Desktop artifact platform emitted by the supported release extension map.',
  sourceEvidence: 'server/desktop-releases.js:9-14'
});
addPath('GET', desktopDownloadPath, 'arch', {
  semanticType: 'desktop_architecture',
  schema: { type: 'string', enum: ['arm64', 'x64', 'universal'] },
  description: 'Desktop artifact architecture derived by the release service; universal is the fallback architecture.',
  sourceEvidence: 'server/desktop-releases.js:18-23'
});
addPath('GET', desktopDownloadPath, 'format', {
  semanticType: 'desktop_artifact_format',
  schema: { type: 'string', enum: ['dmg', 'zip', 'exe'] },
  description: 'Desktop artifact format accepted by the supported release extension map.',
  sourceEvidence: 'server/desktop-releases.js:9-14'
});

addPath('POST', '/api/admin/v2/finance/rollout/{branchId}/cutover-request', 'branchId', {
  semanticType: 'branch_id',
  schema: { type: 'string', pattern: '^[0-9]*[1-9][0-9]*$' },
  description: 'Branch identifier encoded as decimal digits; the cutover handler requires a positive JavaScript safe integer before branch lookup and rejects missing, zero, fractional, exponential and unsafe values.',
  sourceEvidence: 'server/finance-v2.js:189-196,3300-3305,6307-6312'
});

const phonePaths = [
  ['PATCH', '/api/admin/users/{phone}', 'server/server.js:5038-5041'],
  ['PATCH', '/api/admin/customers/{phone}', 'server/server.js:5038-5041'],
  ['DELETE', '/api/admin/users/{phone}', 'server/server.js:5102-5105'],
  ['PATCH', '/api/admin/v2/staff/{phone}', 'server/admin-v2.js:398-400'],
  ['DELETE', '/api/admin/v2/staff/{phone}', 'server/admin-v2.js:416-418']
];
for (const [method, path, sourceEvidence] of phonePaths) {
  addPath(method, path, 'phone', {
    semanticType: 'phone_number',
    schema: { type: 'string' },
    description: 'Staff/customer phone identifier used as the account lookup key; legacy routes normalize digits before lookup, while Admin V2 compares the route value to the stored phone key.',
    sourceEvidence
  });
}

function getParameterContract(method, path) {
  return contracts.get(key(method, path)) || null;
}

function getPathParameterContract(method, path, name) {
  return pathContracts.get(pathKey(method, path, name)) || null;
}

function listParameterContracts() {
  return Object.fromEntries(contracts.entries());
}

module.exports = { getParameterContract, getPathParameterContract, listParameterContracts };
