'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const paymentService = require('../server/salsa/control-plane/billing/payment-service');
const grantService = require('../server/salsa/control-plane/policy/grant-service');
const auditService = require('../server/salsa/control-plane/audit/audit-service');
const { PricingService } = require('../server/salsa/control-plane/billing/pricing-service');

test('restaurant-owner identity cannot author platform tariffs', async () => {
  const pricing = new PricingService({ db: null });
  await assert.rejects(
    () => pricing.createDraftPlan({
      planCode: 'starter',
      nameFa: 'تعرفهٔ غیرمجاز',
      basePriceMonthlyRials: 1,
      actorId: 'restaurant-owner-1',
      actorRole: 'owner'
    }),
    error => error.code === 'PLATFORM_ACTOR_REQUIRED'
  );
});

test('billing settlement and activation retry grant only positively charged invoice add-ons', async t => {
  const original = {
    allowInMemoryFallback: paymentService.allowInMemoryFallback,
    db: paymentService.db,
    gateway: paymentService.gateway,
    transactions: paymentService.inMemoryTransactions,
    invoices: paymentService.inMemoryInvoices,
    issueGrant: grantService.issueGrant,
    recordEvent: auditService.recordEvent
  };
  const issued = [];

  paymentService.allowInMemoryFallback = true;
  paymentService.db = { async query() { return { rows: [] }; } };
  paymentService.gateway = {
    async verifyPayment({ amountRials }) {
      return { success: true, amountRials, traceNumber: 'isolated-trace' };
    }
  };
  paymentService.inMemoryTransactions = new Map();
  paymentService.inMemoryInvoices = new Map();
  grantService.issueGrant = async grant => {
    issued.push(grant);
    return { id: `isolated-grant-${issued.length}`, ...grant };
  };
  auditService.recordEvent = async () => ({});
  t.after(() => {
    paymentService.allowInMemoryFallback = original.allowInMemoryFallback;
    paymentService.db = original.db;
    paymentService.gateway = original.gateway;
    paymentService.inMemoryTransactions = original.transactions;
    paymentService.inMemoryInvoices = original.invoices;
    grantService.issueGrant = original.issueGrant;
    auditService.recordEvent = original.recordEvent;
  });

  const lineItems = [
    {
      featureKey: 'core.workspace',
      unitPriceRials: 0,
      quantity: 1,
      totalRials: 0,
      pricingMeaning: 'included_no_additional_charge'
    },
    {
      featureKey: 'orders.pos',
      unitPriceRials: 500,
      quantity: 1,
      totalRials: 500,
      pricingMeaning: 'paid_addon',
      pricingSource: 'approved_versioned_tariff'
    }
  ];

  paymentService.inMemoryInvoices.set('invoice-settle', {
    id: 'invoice-settle', tenantId: 'tenant-isolated', amountTotalRials: 1500,
    status: 'unpaid', lineItems
  });
  paymentService.inMemoryTransactions.set('transaction-settle', {
    id: 'transaction-settle', invoiceId: 'invoice-settle', tenantId: 'tenant-isolated',
    gatewayAuthority: 'isolated-authority', amountRials: 1500, status: 'pending'
  });

  const settlement = await paymentService.verifyAndSettle({
    authority: 'isolated-authority',
    addonKeys: ['finance.workspace'], // callback input must not create an entitlement
    actorId: 'isolated-gateway'
  });
  assert.equal(settlement.success, true);
  assert.deepEqual(issued.map(grant => grant.featureKey), ['orders.pos']);

  paymentService.inMemoryInvoices.set('invoice-retry', {
    id: 'invoice-retry', tenantId: 'tenant-isolated', amountTotalRials: 1500,
    status: 'paid', lineItems
  });
  paymentService.inMemoryTransactions.set('transaction-retry', {
    id: 'transaction-retry', invoiceId: 'invoice-retry', tenantId: 'tenant-isolated',
    amountRials: 1500, status: 'successful', entitlementActivated: false
  });

  const retry = await paymentService.retryActivation('transaction-retry', { actorId: 'isolated-operator' });
  assert.equal(retry.entitlementActivated, true);
  assert.deepEqual(issued.map(grant => grant.featureKey), ['orders.pos', 'orders.pos']);
  assert.ok(issued.every(grant => grant.tenantId === 'tenant-isolated'));
});
