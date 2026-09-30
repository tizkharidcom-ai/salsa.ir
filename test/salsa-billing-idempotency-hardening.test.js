'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const paymentService = require('../server/salsa/control-plane/billing/payment-service');
const auditService = require('../server/salsa/control-plane/audit/audit-service');
const grantService = require('../server/salsa/control-plane/policy/grant-service');

function cloneState(state) {
  return {
    invoices: new Map([...state.invoices].map(([key, value]) => [key, structuredClone(value)])),
    transactions: new Map([...state.transactions].map(([key, value]) => [key, structuredClone(value)]))
  };
}

class BillingDbHarness {
  constructor({ invoices = [], transactions = [], concurrentInsertOnLookup = null } = {}) {
    this.state = {
      invoices: new Map(invoices.map(row => [row.id, structuredClone(row)])),
      transactions: new Map(transactions.map(row => [row.id, structuredClone(row)]))
    };
    this.concurrentInsertOnLookup = concurrentInsertOnLookup;
    this.connectCount = 0;
  }

  async query(sql, params = []) {
    return this._query(this.state, sql, params);
  }

  async connect() {
    this.connectCount += 1;
    let working = null;
    let dirty = false;
    return {
      query: async (sql, params = []) => {
        if (sql === 'BEGIN') {
          working = cloneState(this.state);
          dirty = false;
          return { rowCount: null, rows: [] };
        }
        if (sql === 'COMMIT') {
          if (dirty) this.state = working || this.state;
          working = null;
          dirty = false;
          return { rowCount: null, rows: [] };
        }
        if (sql === 'ROLLBACK') {
          working = null;
          dirty = false;
          return { rowCount: null, rows: [] };
        }
        const result = this._query(working || this.state, sql, params);
        if (/^(INSERT|UPDATE|DELETE)\b/i.test(sql.trim())) dirty = true;
        return result;
      },
      release() {}
    };
  }

  _query(state, sql, params) {
    if (sql.startsWith('SELECT pg_advisory_xact_lock')) return { rowCount: null, rows: [] };
    if (sql.includes('SELECT * FROM neem_billing_transactions WHERE idempotency_key = $1')) {
      const rows = [...state.transactions.values()].filter(row => row.idempotency_key === params[0]);
      if (!rows.length && this.concurrentInsertOnLookup && state === this.state) {
        const raced = this.concurrentInsertOnLookup;
        this.concurrentInsertOnLookup = null;
        this.state.invoices.set(raced.invoice.id, structuredClone(raced.invoice));
        this.state.transactions.set(raced.transaction.id, structuredClone(raced.transaction));
      }
      return { rowCount: rows.length, rows: structuredClone(rows) };
    }
    if (sql.includes('SELECT * FROM neem_billing_transactions WHERE gateway_authority = $1')) {
      const rows = [...state.transactions.values()].filter(row => row.gateway_authority === params[0]);
      return { rowCount: rows.length, rows: structuredClone(rows) };
    }
    if (sql.includes('SELECT * FROM neem_billing_transactions WHERE id = $1')) {
      const row = state.transactions.get(params[0]);
      return { rowCount: row ? 1 : 0, rows: row ? [structuredClone(row)] : [] };
    }
    if (sql.includes('SELECT * FROM neem_billing_invoices WHERE id = $1')) {
      const row = state.invoices.get(params[0]);
      return { rowCount: row ? 1 : 0, rows: row ? [structuredClone(row)] : [] };
    }

    if (sql.startsWith('INSERT INTO neem_billing_invoices')) {
      const [id, invoice_number, tenant_id, amount_subtotal_rials, vat_amount_rials,
        discount_amount_rials, amount_total_rials, due_date, line_items, billing_cycle,
        plan_code, plan_version] = params;
      state.invoices.set(id, {
        id, invoice_number, tenant_id, amount_subtotal_rials, vat_amount_rials,
        discount_amount_rials, amount_total_rials, due_date,
        line_items: typeof line_items === 'string' ? JSON.parse(line_items) : line_items,
        billing_cycle, plan_code, plan_version, status: 'unpaid',
        entitlement_status: 'pending', currency: 'IRR'
      });
      return { rowCount: 1, rows: [] };
    }
    if (sql.startsWith('INSERT INTO neem_billing_transactions')) {
      const [id, invoice_id, tenant_id, idempotency_key, gateway_provider, amount_rials] = params;
      if ([...state.transactions.values()].some(row => row.idempotency_key === idempotency_key)) {
        const error = new Error('duplicate idempotency key');
        error.code = '23505';
        throw error;
      }
      state.transactions.set(id, {
        id, invoice_id, tenant_id, idempotency_key, gateway_provider,
        gateway_authority: null, amount_rials, status: 'pending',
        entitlement_activated: false, retry_count: 0
      });
      return { rowCount: 1, rows: [structuredClone(state.transactions.get(id))] };
    }
    if (sql.startsWith('UPDATE neem_billing_transactions') && sql.includes('SET gateway_provider = $1')) {
      const [gateway_provider, gateway_authority, id, idempotency_key] = params;
      const row = state.transactions.get(id);
      if (!row || row.idempotency_key !== idempotency_key) return { rowCount: 0, rows: [] };
      row.gateway_provider = gateway_provider;
      row.gateway_authority = gateway_authority;
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("SET status = 'successful', trace_number = $1, settled_at = now()")) {
      const [trace_number, id, tenant_id] = params;
      const row = state.transactions.get(id);
      if (!row || row.tenant_id !== tenant_id || !['pending', 'failed'].includes(row.status)) return { rowCount: 0, rows: [] };
      row.status = 'successful';
      row.trace_number = trace_number;
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("SET status = 'paid', paid_at = now(), settlement_reference = $1")) {
      const [settlement_reference, id, tenant_id, amount] = params;
      const row = state.invoices.get(id);
      if (!row || row.tenant_id !== tenant_id || Number(row.amount_total_rials) !== Number(amount) || row.status !== 'unpaid') {
        return { rowCount: 0, rows: [] };
      }
      row.status = 'paid';
      row.settlement_reference = settlement_reference;
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("SET status = 'refunded', refund_reason = $1")) {
      const [refund_reason, refund_reference, id] = params;
      const row = state.transactions.get(id);
      if (!row) return { rowCount: 0, rows: [] };
      Object.assign(row, { status: 'refunded', refund_reason, refund_reference });
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("UPDATE neem_billing_invoices SET status = 'refunded'")) {
      const row = state.invoices.get(params[0]);
      if (!row) return { rowCount: 0, rows: [] };
      Object.assign(row, { status: 'refunded', entitlement_status: 'refunded' });
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes('SET entitlement_activated = $1')) {
      const row = state.transactions.get(params[2]);
      if (!row) return { rowCount: 0, rows: [] };
      row.entitlement_activated = params[0];
      row.activation_error = params[1];
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes('SET entitlement_activated = true')) {
      const row = state.transactions.get(params[0]);
      if (!row) return { rowCount: 0, rows: [] };
      row.entitlement_activated = true;
      row.retry_count = (row.retry_count || 0) + 1;
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes('UPDATE neem_billing_invoices SET entitlement_status = $1')) {
      const row = state.invoices.get(params[1]);
      if (!row) return { rowCount: 0, rows: [] };
      row.entitlement_status = params[0];
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("UPDATE neem_billing_invoices SET entitlement_status = 'activated'")) {
      const row = state.invoices.get(params[0]);
      if (!row) return { rowCount: 0, rows: [] };
      row.entitlement_status = 'activated';
      return { rowCount: 1, rows: [] };
    }
    if (sql.startsWith('UPDATE neem_billing_transactions SET status = $1')) {
      const row = state.transactions.get(params[1]);
      if (!row) return { rowCount: 0, rows: [] };
      row.status = params[0];
      return { rowCount: 1, rows: [] };
    }
    if (sql.startsWith('UPDATE neem_billing_transactions SET status =')) {
      const row = state.transactions.get(params[0]);
      if (!row) return { rowCount: 0, rows: [] };
      row.status = 'failed';
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`Unexpected billing SQL in test harness: ${sql}`);
  }
}

function createService({ db, gateway, pricing } = {}) {
  return Object.assign(Object.create(Object.getPrototypeOf(paymentService)), {
    db,
    gateway,
    pricing: pricing || {
      async calculateQuote({ planCode = 'starter', addonKeys = [], billingCycle = 'monthly' } = {}) {
        const months = billingCycle === 'annual' ? 12 : 1;
        const lineItems = [{ planCode, planVersion: 'v1', totalRials: 1000 * months }];
        for (const featureKey of [...new Set(addonKeys)]) lineItems.push({ featureKey, totalRials: 100 });
        return {
          planCode, planVersion: 'v1', pricingSource: 'test-fixture',
          subtotalRials: 1000 * months, vatAmountRials: 0,
          discountAmountRials: 0, finalTotalRials: 1000 * months,
          lineItems
        };
      }
    },
    allowInMemoryFallback: false,
    inMemorySubscriptions: new Map(),
    inMemoryInvoices: new Map(),
    inMemoryTransactions: new Map()
  });
}

function invoiceRow({ id = 'inv-1', tenantId = 'tenant-a', amount = 1000, status = 'unpaid', lineItems = [{ planCode: 'starter', planVersion: 'v1' }] } = {}) {
  return {
    id, invoice_number: `number-${id}`, tenant_id: tenantId,
    amount_subtotal_rials: amount, vat_amount_rials: 0,
    discount_amount_rials: 0, amount_total_rials: amount,
    status, entitlement_status: 'pending', currency: 'IRR', billing_cycle: 'monthly',
    due_date: '2026-12-31T00:00:00.000Z', line_items: lineItems,
    plan_code: 'starter', plan_version: 'v1', created_at: '2026-09-24T00:00:00.000Z'
  };
}

function transactionRow({
  id = 'tx-1', invoiceId = 'inv-1', tenantId = 'tenant-a',
  key = 'key-1', authority = 'auth-1', amount = 1000, status = 'pending',
  refundReference = null
} = {}) {
  return {
    id, invoice_id: invoiceId, tenant_id: tenantId, idempotency_key: key,
    gateway_provider: 'test_gateway', gateway_authority: authority,
    amount_rials: amount, status, trace_number: null,
    entitlement_activated: false, retry_count: 0,
    refund_reference: refundReference
  };
}

async function withAuditStub(callback) {
  const original = auditService.recordEvent;
  auditService.recordEvent = async () => ({ ok: true });
  try {
    return await callback();
  } finally {
    auditService.recordEvent = original;
  }
}

test('checkout idempotency replays only the same persisted purchase intent', async () => {
  const db = new BillingDbHarness();
  let providerCalls = 0;
  const service = createService({
    db,
    gateway: {
      providerCode: 'test_gateway',
      async requestPayment() {
        providerCalls += 1;
        return { success: true, provider: 'test_gateway', authority: 'auth-checkout', paymentUrl: 'https://pay.invalid/session' };
      }
    }
  });

  await withAuditStub(async () => {
    const first = await service.checkout({
      tenantId: 'tenant-a', idempotencyKey: 'checkout-1',
      planCode: 'starter', addonKeys: ['reports'], billingCycle: 'monthly'
    });
    const replay = await service.checkout({
      tenantId: 'tenant-a', idempotencyKey: 'checkout-1',
      planCode: 'starter', addonKeys: ['reports', 'reports'], billingCycle: 'monthly'
    });

    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.transactionId, first.transactionId);
    assert.equal(replay.authority, 'auth-checkout');
    assert.equal(providerCalls, 1);

    await assert.rejects(
      service.checkout({ tenantId: 'tenant-b', idempotencyKey: 'checkout-1', planCode: 'starter', addonKeys: ['reports'] }),
      error => error.code === 'BILLING_IDEMPOTENCY_CONFLICT' && error.status === 409
    );
    await assert.rejects(
      service.checkout({ tenantId: 'tenant-a', idempotencyKey: 'checkout-1', planCode: 'starter', addonKeys: [], billingCycle: 'monthly' }),
      error => error.code === 'BILLING_IDEMPOTENCY_CONFLICT' && error.status === 409
    );
    assert.equal(providerCalls, 1);
  });
});

test('checkout unique-key race reuses the winning transaction without a second provider request', async () => {
  const racedInvoice = invoiceRow({ id: 'inv-race' });
  const racedTransaction = transactionRow({ id: 'tx-race', invoiceId: 'inv-race', key: 'checkout-race', authority: null });
  const db = new BillingDbHarness({
    concurrentInsertOnLookup: { invoice: racedInvoice, transaction: racedTransaction }
  });
  let providerCalls = 0;
  const service = createService({
    db,
    gateway: {
      providerCode: 'test_gateway',
      async requestPayment() {
        providerCalls += 1;
        throw new Error('concurrent reservation must prevent gateway call');
      }
    }
  });

  const replay = await service.checkout({
    tenantId: 'tenant-a', idempotencyKey: 'checkout-race', planCode: 'starter'
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.transactionId, 'tx-race');
  assert.equal(replay.status, 'pending');
  assert.equal(providerCalls, 0);
  assert.deepEqual([...db.state.invoices.keys()], ['inv-race']);
});

test('ambiguous checkout response remains pending and is never re-sent for the same key', async () => {
  const db = new BillingDbHarness();
  let providerCalls = 0;
  const service = createService({
    db,
    gateway: {
      providerCode: 'test_gateway',
      async requestPayment() {
        providerCalls += 1;
        throw new Error('simulated transport timeout after request dispatch');
      }
    }
  });
  const intent = { tenantId: 'tenant-a', idempotencyKey: 'checkout-timeout', planCode: 'starter' };

  await assert.rejects(service.checkout(intent), error => error.code === 'BILLING_GATEWAY_OUTCOME_UNKNOWN' && error.status === 503);
  const [reserved] = [...db.state.transactions.values()];
  assert.equal(reserved.status, 'pending');
  assert.equal(reserved.gateway_authority, null);

  const replay = await service.checkout(intent);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.status, 'pending');
  assert.equal(providerCalls, 1);
});

test('callback needs complete provider proof and settlement replay is idempotent', async () => {
  const db = new BillingDbHarness({
    invoices: [invoiceRow()],
    transactions: [transactionRow()]
  });
  let verifyCalls = 0;
  const service = createService({
    db,
    gateway: {
      async verifyPayment() {
        verifyCalls += 1;
        if (verifyCalls === 1) return { success: true, traceNumber: 'trace-1' };
        return { success: true, traceNumber: 'trace-1', amountRials: 1000 };
      }
    }
  });

  await withAuditStub(async () => {
    await assert.rejects(
      service.verifyAndSettle({ authority: 'auth-1' }),
      error => error.code === 'BILLING_VERIFICATION_OUTCOME_UNKNOWN' && error.status === 503
    );
    assert.equal(db.connectCount, 1, 'verification failure must release its single advisory-lock connection');
    assert.equal(db.state.transactions.get('tx-1').status, 'pending');
    assert.equal(db.state.invoices.get('inv-1').status, 'unpaid');

    const settled = await service.verifyAndSettle({ authority: 'auth-1' });
    assert.equal(settled.success, true);
    assert.equal(db.connectCount, 2, 'settlement must persist on the advisory-lock connection without checking out another one');
    assert.equal(db.state.transactions.get('tx-1').status, 'successful');
    assert.equal(db.state.invoices.get('inv-1').status, 'paid');

    const replay = await service.verifyAndSettle({ authority: 'auth-1' });
    assert.equal(replay.alreadySettled, true);
    assert.equal(verifyCalls, 2);
  });
});

test('activation retry reuses its lock connection for grants, state, and audit', async () => {
  const db = new BillingDbHarness({
    invoices: [invoiceRow({ lineItems: [{ featureKey: 'addon.reports', totalRials: 100, pricingMeaning: 'paid_addon' }] })],
    transactions: [transactionRow({ status: 'successful' })]
  });
  const service = createService({ db });
  const originalIssueGrant = grantService.issueGrant;
  const originalRecordEvent = auditService.recordEvent;
  let grantDatabase = null;
  grantService.issueGrant = async input => {
    grantDatabase = input.database;
    return { id: 'grant-1', featureKey: input.featureKey };
  };
  auditService.recordEvent = async () => ({ ok: true });
  try {
    const result = await service.retryActivation('tx-1');
    assert.equal(result.entitlementActivated, true);
    assert.ok(grantDatabase && typeof grantDatabase.query === 'function');
    assert.equal(db.connectCount, 1, 'activation retry must not check out another connection while its advisory lock is held');
    assert.equal(db.state.transactions.get('tx-1').entitlement_activated, true);
  } finally {
    grantService.issueGrant = originalIssueGrant;
    auditService.recordEvent = originalRecordEvent;
  }
});

test('refund reuses its lock connection for invoice, transaction, and audit writes', async () => {
  const db = new BillingDbHarness({
    invoices: [invoiceRow({ status: 'paid' })],
    transactions: [transactionRow({ status: 'successful' })]
  });
  const service = createService({
    db,
    gateway: { async refundPayment() { return { refundReference: 'refund-2' }; } }
  });
  const originalRecordEvent = auditService.recordEvent;
  auditService.recordEvent = async () => ({ ok: true });
  try {
    const result = await service.refund({ transactionId: 'tx-1', reason: 'requested' });
    assert.equal(result.status, 'refunded');
    assert.equal(db.connectCount, 1, 'refund must not check out another connection while its advisory lock is held');
    assert.equal(db.state.transactions.get('tx-1').refund_reference, 'refund-2');
    assert.equal(db.state.invoices.get('inv-1').status, 'refunded');
  } finally {
    auditService.recordEvent = originalRecordEvent;
  }
});

test('a durably confirmed refund callback is replayed without another provider refund', async () => {
  const db = new BillingDbHarness({
    invoices: [invoiceRow({ status: 'refunded' })],
    transactions: [transactionRow({ status: 'refunded', refundReference: 'refund-1' })]
  });
  let providerRefundCalls = 0;
  const service = createService({
    db,
    gateway: {
      async refundPayment() {
        providerRefundCalls += 1;
        throw new Error('must not call provider for a confirmed replay');
      }
    }
  });

  const replay = await service.refund({ transactionId: 'tx-1' });
  assert.equal(replay.alreadyRefunded, true);
  assert.equal(replay.refundReference, 'refund-1');
  assert.equal(providerRefundCalls, 0);
});
