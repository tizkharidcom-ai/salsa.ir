// server/salsa/control-plane/billing/payment-service.js
'use strict';

const crypto = require('crypto');
const { getDatabase } = require('../db/database');
const { getGatewayAdapter, defaultGateway } = require('./gateway-adapter');
const config = require('../config');
const pricingService = require('./pricing-service');
const grantService = require('../policy/grant-service');
const auditService = require('../audit/audit-service');

function markBillingError(error, code) {
  if (error && error.code && error.code !== code) error.causeCode = error.code;
  if (error) error.code = code;
  return error;
}

class PaymentService {
  constructor(options = {}) {
    this.db = getDatabase();
    this.pricing = options.pricingService || pricingService;
    this.gateway = options.gateway || (config.isTest ? (defaultGateway || getGatewayAdapter('saman_sep')) : getGatewayAdapter('saman_sep'));
    this.inMemorySubscriptions = new Map();
    this.inMemoryInvoices = new Map();
    this.inMemoryTransactions = new Map();
    this.allowInMemoryFallback = config.isTest && process.env.SALSA_SEED_FIXTURES !== 'false';
    if (this.allowInMemoryFallback) this._initSeeds();
  }

  reset() {
    this.inMemorySubscriptions.clear();
    this.inMemoryInvoices.clear();
    this.inMemoryTransactions.clear();
    if (this.allowInMemoryFallback) this._initSeeds();
  }

  _initSeeds() {
    const sub1 = {
      id: 'sub_westo_001',
      tenantId: 'westo-demo',
      planCode: 'scale',
      status: 'active',
      billingCycle: 'annual',
      currentPeriodStart: '2026-01-01T00:00:00Z',
      currentPeriodEnd: '2026-12-31T23:59:59Z',
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      metadata: { renewedAt: '2026-01-01T00:00:00Z', autoRenew: true },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    };
    this.inMemorySubscriptions.set(sub1.id, sub1);

    const sub2 = {
      id: 'sub_cafe_002',
      tenantId: 'tehran-cafe-02',
      planCode: 'starter',
      status: 'trial',
      billingCycle: 'monthly',
      currentPeriodStart: '2026-09-01T00:00:00Z',
      currentPeriodEnd: '2026-09-15T23:59:59Z',
      cancelAtPeriodEnd: false,
      trialEndsAt: '2026-09-15T23:59:59Z',
      metadata: { trialDaysRemaining: 9 },
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z'
    };
    this.inMemorySubscriptions.set(sub2.id, sub2);

    const inv1 = {
      id: 'inv_westo_2026_01',
      invoiceNumber: 'INV-1404-0982',
      tenantId: 'westo-demo',
      subscriptionId: sub1.id,
      amountSubtotalRials: 180000000 * 12,
      discountAmountRials: Math.round((180000000 * 12 * 20) / 100),
      vatAmountRials: Math.round((180000000 * 12 * 0.8 * 10) / 100),
      amountTotalRials: Math.round(180000000 * 12 * 0.8 * 1.1),
      status: 'paid',
      entitlementStatus: 'activated',
      currency: 'IRR',
      billingCycle: 'annual',
      dueDate: '2026-01-05T00:00:00Z',
      paidAt: '2026-01-02T10:15:30Z',
      settlementReference: 'SEP-REF-14040102001',
      lineItems: [
        {
          description: 'پلن مقیاس (اسکیل) سالانه',
          quantity: 12,
          unitPriceRials: 180000000,
          totalRials: 180000000 * 12
        }
      ],
      createdAt: '2026-01-01T00:00:00Z'
    };
    this.inMemoryInvoices.set(inv1.id, inv1);

    const tx1 = {
      id: 'tx_westo_001',
      invoiceId: inv1.id,
      tenantId: 'westo-demo',
      idempotencyKey: 'idemp_seed_westo_001',
      gatewayProvider: 'saman_sep',
      gatewayAuthority: 'auth_seed_westo_111',
      traceNumber: 'TRACE_9918231',
      amountRials: inv1.amountTotalRials,
      status: 'successful',
      entitlementActivated: true,
      entitlementActivatedAt: '2026-01-02T10:15:35Z',
      retryCount: 0,
      createdAt: '2026-01-02T10:12:00Z',
      settledAt: '2026-01-02T10:15:30Z'
    };
    this.inMemoryTransactions.set(tx1.id, tx1);
  }

  async listSubscriptions(options = {}) {
    let tenantId = null;
    let status = null;
    if (typeof options === 'string') {
      tenantId = options;
    } else if (options && typeof options === 'object') {
      tenantId = options.tenantId || options.tenant_id;
      status = options.status;
    }

    try {
      if (this.db) {
        let sql = 'SELECT * FROM neem_billing_subscriptions';
        const params = [];
        if (tenantId) {
          sql += ' WHERE tenant_id = $1';
          params.push(tenantId);
        }
        const dbRes = await this.db.query(sql, params);
        if (dbRes && dbRes.rows && dbRes.rows.length > 0) {
          let list = dbRes.rows.map(r => ({
            id: r.id,
            tenantId: r.tenant_id,
            planCode: r.plan_code,
            planVersion: r.plan_version,
            status: r.status,
            currentPeriodEnd: r.current_period_end,
            createdAt: r.created_at,
            updatedAt: r.updated_at
          }));
          if (status) list = list.filter(s => s.status === status);
          return list;
        }
        if (!this.allowInMemoryFallback) return [];
      }
    } catch (error) {
      if (!this.allowInMemoryFallback) {
        markBillingError(error, 'BILLING_DATABASE_UNAVAILABLE');
        throw error;
      }
    }

    let list = Array.from(this.inMemorySubscriptions.values());
    if (tenantId) list = list.filter(s => s.tenantId === tenantId);
    if (status) list = list.filter(s => s.status === status);
    return list;
  }

  async getSubscription(id) {
    if (!id) return null;
    if (!this.allowInMemoryFallback) {
      try {
        const result = await this.db.query('SELECT * FROM neem_billing_subscriptions WHERE id = $1', [id]);
        const row = result.rows?.[0];
        return row ? {
          id: row.id,
          tenantId: row.tenant_id,
          planCode: row.plan_code,
          planVersion: row.plan_version,
          status: row.status,
          billingCycle: row.billing_cycle,
          currentPeriodStart: row.current_period_start,
          currentPeriodEnd: row.current_period_end,
          cancelAtPeriodEnd: row.cancel_at_period_end,
          trialEndsAt: row.trial_ends_at,
          version: row.version,
          metadata: row.metadata,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        } : null;
      } catch (error) {
        markBillingError(error, 'BILLING_DATABASE_UNAVAILABLE');
        throw error;
      }
    }
    return this.inMemorySubscriptions.get(id) || null;
  }

  async renewSubscription(id, { months = 1, actorId = 'platform_finance', _subscriptionLockHeld = false } = {}) {
    if (!Number.isSafeInteger(Number(months)) || Number(months) <= 0 || Number(months) > 120) {
      throw new Error('SUBSCRIPTION_ERROR: months must be a positive integer no greater than 120.');
    }
    months = Number(months);
    if (!this.allowInMemoryFallback && !_subscriptionLockHeld) {
      return this._withPersistentAdvisoryLock(`subscription:${id}`, () => this.renewSubscription(id, {
        months,
        actorId,
        _subscriptionLockHeld: true
      }));
    }
    const sub = await this.getSubscription(id);
    if (!sub) throw new Error(`SUBSCRIPTION_NOT_FOUND: '${id}' does not exist.`);

    const currentEnd = new Date(sub.currentPeriodEnd);
    const newEnd = new Date(currentEnd);
    newEnd.setMonth(newEnd.getMonth() + months);

    sub.currentPeriodEnd = newEnd.toISOString();
    sub.status = 'active';
    sub.version = Number(sub.version || 1) + 1;
    sub.updatedAt = new Date().toISOString();

    if (!this.allowInMemoryFallback) {
      await this.db.query(
        `UPDATE neem_billing_subscriptions
            SET current_period_end = $1, status = 'active', version = version + 1, updated_at = now()
          WHERE id = $2`,
        [sub.currentPeriodEnd, id]
      );
    } else {
      this.inMemorySubscriptions.set(id, sub);
    }

    await auditService.recordEvent({
      actorId,
      action: 'BILLING_SUBSCRIPTION_RENEWED',
      targetType: 'subscription',
      targetId: id,
      tenantId: sub.tenantId,
      metadata: { newPeriodEnd: sub.currentPeriodEnd, months }
    });

    return sub;
  }

  async cancelSubscription(id, { actorId = 'platform_owner', _subscriptionLockHeld = false } = {}) {
    if (!this.allowInMemoryFallback && !_subscriptionLockHeld) {
      return this._withPersistentAdvisoryLock(`subscription:${id}`, () => this.cancelSubscription(id, {
        actorId,
        _subscriptionLockHeld: true
      }));
    }
    const sub = await this.getSubscription(id);
    if (!sub) throw new Error(`SUBSCRIPTION_NOT_FOUND: '${id}' does not exist.`);

    sub.cancelAtPeriodEnd = true;
    sub.version = Number(sub.version || 1) + 1;
    sub.updatedAt = new Date().toISOString();

    if (!this.allowInMemoryFallback) {
      await this.db.query(
        `UPDATE neem_billing_subscriptions
            SET cancel_at_period_end = true, version = version + 1, updated_at = now()
          WHERE id = $1`,
        [id]
      );
    } else {
      this.inMemorySubscriptions.set(id, sub);
    }

    await auditService.recordEvent({
      actorId,
      action: 'BILLING_SUBSCRIPTION_CANCELED',
      targetType: 'subscription',
      targetId: id,
      tenantId: sub.tenantId
    });

    return sub;
  }

  async listInvoices({ tenantId, status } = {}) {
    if (!this.allowInMemoryFallback) {
      const params = [];
      let sql = 'SELECT * FROM neem_billing_invoices';
      const clauses = [];
      if (tenantId) {
        params.push(tenantId);
        clauses.push(`tenant_id = $${params.length}`);
      }
      if (status) {
        params.push(status);
        clauses.push(`status = $${params.length}`);
      }
      if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
      sql += ' ORDER BY created_at DESC';
      const result = await this.db.query(sql, params);
      return (result.rows || []).map(row => this._formatInvoiceRow(row));
    }
    let list = Array.from(this.inMemoryInvoices.values());
    if (tenantId) list = list.filter(i => i.tenantId === tenantId);
    if (status) list = list.filter(i => i.status === status);
    return list;
  }

  async getInvoice(id) {
    if (!this.allowInMemoryFallback) {
      const result = await this.db.query('SELECT * FROM neem_billing_invoices WHERE id = $1', [id]);
      return result.rows?.[0] ? this._formatInvoiceRow(result.rows[0]) : null;
    }
    return this.inMemoryInvoices.get(id) || null;
  }

  _purchasedAddonItems(invoice) {
    if (!Array.isArray(invoice?.lineItems)) return [];
    return invoice.lineItems.filter(item => {
      if (!item || typeof item.featureKey !== 'string' || !item.featureKey.trim()) return false;
      if (item.pricingMeaning === 'included_no_additional_charge') return false;
      const totalRials = Number(item.totalRials);
      return Number.isSafeInteger(totalRials) && totalRials > 0;
    });
  }

  async listTransactions({ tenantId, status } = {}) {
    if (!this.allowInMemoryFallback) {
      const params = [];
      let sql = 'SELECT * FROM neem_billing_transactions';
      const clauses = [];
      if (tenantId) {
        params.push(tenantId);
        clauses.push(`tenant_id = $${params.length}`);
      }
      if (status) {
        params.push(status);
        clauses.push(`status = $${params.length}`);
      }
      if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
      sql += ' ORDER BY created_at DESC';
      const result = await this.db.query(sql, params);
      return (result.rows || []).map(row => this._formatTransactionRow(row));
    }
    let list = Array.from(this.inMemoryTransactions.values());
    if (tenantId) list = list.filter(t => t.tenantId === tenantId);
    if (status) list = list.filter(t => t.status === status);
    return list;
  }

  _checkoutReplayResult(tx) {
    return {
      idempotentReplay: true,
      transactionId: tx.id,
      invoiceId: tx.invoiceId || tx.invoice_id,
      status: tx.status,
      amountRials: tx.amountRials ?? tx.amount_rials,
      authority: tx.gatewayAuthority || tx.gateway_authority || null
    };
  }

  async _assertCheckoutReplayMatches(tx, { tenantId, planCode, addonKeys, billingCycle } = {}) {
    const conflict = (code, message) => {
      const error = new Error(message);
      error.code = code;
      error.status = 409;
      throw error;
    };
    const txTenantId = tx.tenantId || tx.tenant_id;
    if (!txTenantId || txTenantId !== tenantId) {
      conflict('BILLING_IDEMPOTENCY_CONFLICT', 'The idempotency key is already bound to a different checkout intent.');
    }

    const invoiceId = tx.invoiceId || tx.invoice_id;
    const invoice = invoiceId ? await this.getInvoice(invoiceId) : null;
    const lineItems = Array.isArray(invoice?.lineItems) ? invoice.lineItems : null;
    const invoiceTenantId = invoice?.tenantId || invoice?.tenant_id;
    const storedPlanCode = invoice?.planCode || lineItems?.find(item => item?.planCode)?.planCode;
    const storedBillingCycle = invoice?.billingCycle || invoice?.billing_cycle;
    const invoiceAmount = Number(invoice?.amountTotalRials ?? invoice?.amount_total_rials);
    const transactionAmount = Number(tx.amountRials ?? tx.amount_rials);
    const storedAddonKeys = lineItems
      ?.map(item => item?.featureKey)
      .filter(Boolean);
    const requestedAddonKeys = [...new Set((addonKeys || []).map(String))].sort();
    const canonicalStoredAddonKeys = storedAddonKeys ? [...new Set(storedAddonKeys.map(String))].sort() : null;

    if (!invoice || !lineItems || !storedPlanCode || !storedBillingCycle || !canonicalStoredAddonKeys ||
        invoiceTenantId !== tenantId ||
        !Number.isSafeInteger(invoiceAmount) || !Number.isSafeInteger(transactionAmount) || invoiceAmount !== transactionAmount ||
        storedPlanCode !== planCode || storedBillingCycle !== billingCycle ||
        JSON.stringify(canonicalStoredAddonKeys) !== JSON.stringify(requestedAddonKeys)) {
      conflict('BILLING_IDEMPOTENCY_CONFLICT', 'The idempotency key is already bound to a different or unverifiable checkout intent.');
    }
  }

  async _withPersistentWriteTransaction(callback, code) {
    if (!this.db || typeof this.db.connect !== 'function') {
      throw markBillingError(new Error('Persistent billing database does not expose a transaction client.'), 'BILLING_DATABASE_UNAVAILABLE');
    }
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      markBillingError(error, code);
      throw error;
    } finally {
      client.release();
    }
  }

  _requireOneRow(result, message, code) {
    if (!result || result.rowCount !== 1) {
      const error = new Error(message);
      error.code = code;
      error.status = 409;
      throw error;
    }
  }

  /**
   * Idempotent Checkout: Initiates payment for an invoice or quote.
   * If the idempotencyKey has already been used, returns the existing transaction (AC-02 / AC-19).
   */
  async _reservePersistentCheckout({
    tenantId,
    idempotencyKey,
    invoiceId,
    invoiceNumber,
    quote,
    dueDate,
    transactionId,
    gatewayProvider,
    billingCycle
  }) {
    if (!this.db || typeof this.db.connect !== 'function') {
      throw markBillingError(new Error('Persistent billing database does not expose a transaction client.'), 'BILLING_DATABASE_UNAVAILABLE');
    }
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO neem_billing_invoices
          (id, invoice_number, tenant_id, amount_subtotal_rials, vat_amount_rials, discount_amount_rials, amount_total_rials, status, due_date, line_items, currency, billing_cycle, plan_code, plan_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'unpaid', $8, $9, 'IRR', $10, $11, $12)`,
        [
          invoiceId,
          invoiceNumber,
          tenantId,
          quote.subtotalRials,
          quote.vatAmountRials,
          quote.discountAmountRials,
          quote.finalTotalRials,
          dueDate,
          JSON.stringify(quote.lineItems),
          billingCycle,
          quote.planCode,
          quote.planVersion
        ]
      );
      const txRes = await client.query(
        `INSERT INTO neem_billing_transactions
          (id, invoice_id, tenant_id, idempotency_key, gateway_provider, amount_rials, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')
         RETURNING *`,
        [transactionId, invoiceId, tenantId, idempotencyKey, gatewayProvider, quote.finalTotalRials]
      );
      await client.query('COMMIT');
      return { duplicate: false, transaction: txRes.rows?.[0] || null };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') {
        const existingRes = await this.db.query(
          'SELECT * FROM neem_billing_transactions WHERE idempotency_key = $1',
          [idempotencyKey]
        );
        if (existingRes.rows?.[0]) {
          return { duplicate: true, transaction: existingRes.rows[0] };
        }
      }
      markBillingError(error, 'BILLING_CHECKOUT_RESERVATION_FAILED');
      throw error;
    } finally {
      client.release();
    }
  }

  async checkout({
    tenantId,
    idempotencyKey,
    planCode = 'starter',
    addonKeys = [],
    billingCycle = 'monthly',
    callbackUrl = 'https://neem.internal/billing/callback',
    actorId = 'platform_system'
  }) {
    if (!tenantId || typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 128 || !Array.isArray(addonKeys)) {
      throw new Error('CHECKOUT_ERROR: tenantId and idempotencyKey are required.');
    }
    const intent = {
      tenantId,
      planCode,
      addonKeys,
      billingCycle
    };

    // 1. Idempotency Check in Memory and Database
    for (const tx of this.inMemoryTransactions.values()) {
      if (tx.idempotencyKey === idempotencyKey) {
        await this._assertCheckoutReplayMatches(tx, intent);
        return this._checkoutReplayResult(tx);
      }
    }

    const checkSql = 'SELECT * FROM neem_billing_transactions WHERE idempotency_key = $1';
    let existingRes;
    try {
      existingRes = await this.db.query(checkSql, [idempotencyKey]);
    } catch (error) {
      if (!this.allowInMemoryFallback) {
        markBillingError(error, 'BILLING_DATABASE_UNAVAILABLE');
        throw error;
      }
    }
    if (existingRes?.rows?.length) {
      const existingTx = existingRes.rows[0];
      await this._assertCheckoutReplayMatches(existingTx, intent);
      return this._checkoutReplayResult(existingTx);
    }

    // 2. Calculate Quote
    const quote = await this.pricing.calculateQuote({
      tenantId,
      planCode,
      addonKeys,
      billingCycle
    });

    const invoiceId = 'inv_' + crypto.randomUUID().slice(0, 16);
    const invoiceNumber = 'INV-1405-' + crypto.randomInt(100000000, 1000000000);
    const transactionId = 'tx_' + crypto.randomUUID().slice(0, 16);
    const dueDate = new Date(Date.now() + 72 * 3600 * 1000).toISOString();

    // 3. Reserve the invoice and idempotency key durably before calling the
    // external gateway. This closes the SELECT-then-INSERT race: a second
    // process cannot create a second provider authority for the same key.
    const invoiceRecord = {
      id: invoiceId,
      invoiceNumber,
      tenantId,
      planCode: quote.planCode,
      planVersion: quote.planVersion,
      pricingSource: quote.pricingSource,
      amountSubtotalRials: quote.subtotalRials,
      vatAmountRials: quote.vatAmountRials,
      discountAmountRials: quote.discountAmountRials,
      amountTotalRials: quote.finalTotalRials,
      status: 'unpaid',
      entitlementStatus: 'pending',
      currency: 'IRR',
      billingCycle,
      dueDate,
      lineItems: quote.lineItems,
      createdAt: new Date().toISOString()
    };
    if (this.allowInMemoryFallback) {
      this.inMemoryInvoices.set(invoiceId, invoiceRecord);
    }

    let persistentReservation = null;
    if (!this.allowInMemoryFallback) {
      persistentReservation = await this._reservePersistentCheckout({
        tenantId,
        idempotencyKey,
        invoiceId,
        invoiceNumber,
        quote,
        dueDate,
        transactionId,
        gatewayProvider: this.gateway.providerCode || 'configured_gateway',
        billingCycle
      });
      if (persistentReservation.duplicate) {
        const existingTx = persistentReservation.transaction;
        await this._assertCheckoutReplayMatches(existingTx, intent);
        return this._checkoutReplayResult(existingTx);
      }
    }

    // Persist the reservation in memory too, so a thrown/malformed gateway
    // response cannot cause this process to issue a second provider request
    // for the same idempotency key.
    const txRecord = {
      id: transactionId,
      invoiceId,
      tenantId,
      idempotencyKey,
      gatewayProvider: this.gateway.providerCode || 'configured_gateway',
      gatewayAuthority: null,
      amountRials: quote.finalTotalRials,
      status: 'pending',
      entitlementActivated: false,
      retryCount: 0,
      createdAt: new Date().toISOString()
    };
    if (this.allowInMemoryFallback) this.inMemoryTransactions.set(transactionId, txRecord);

    // 4. Request Gateway Authority. A timeout/transport error is ambiguous:
    // the provider may have created an authority, so leave the durable
    // reservation pending and never retry the external call under this key.
    let gatewayRes;
    try {
      gatewayRes = await this.gateway.requestPayment({
        invoiceId,
        amountRials: quote.finalTotalRials,
        callbackUrl,
        description: `خرید اشتراک NEEM: ${planCode}`
      });
    } catch (error) {
      markBillingError(error, 'BILLING_GATEWAY_OUTCOME_UNKNOWN');
      error.status = 503;
      throw error;
    }

    if (!gatewayRes || gatewayRes.success !== true || !gatewayRes.provider || !gatewayRes.authority || !gatewayRes.paymentUrl) {
      const error = new Error('Gateway outcome is not safely replayable; the reserved checkout remains pending for reconciliation.');
      error.status = 503;
      throw markBillingError(error, 'BILLING_GATEWAY_OUTCOME_UNKNOWN');
    }

    // 5. Store the provider authority against the already-reserved transaction.
    if (this.allowInMemoryFallback) {
      txRecord.gatewayProvider = gatewayRes.provider;
      txRecord.gatewayAuthority = gatewayRes.authority;
    } else {
      try {
        const persistedRes = await this.db.query(
          `UPDATE neem_billing_transactions
              SET gateway_provider = $1, gateway_authority = $2
            WHERE id = $3 AND idempotency_key = $4`,
          [gatewayRes.provider, gatewayRes.authority, transactionId, idempotencyKey]
        );
        if (persistedRes && persistedRes.rowCount !== undefined && persistedRes.rowCount !== 1) {
          throw markBillingError(new Error('Gateway authority was not persisted for the reserved transaction.'), 'BILLING_TRANSACTION_NOT_PERSISTED');
        }
      } catch (error) {
        markBillingError(error, 'BILLING_TRANSACTION_NOT_PERSISTED');
        throw error;
      }
    }

    await auditService.recordEvent({
      actorId,
      action: 'BILLING_CHECKOUT_INITIATED',
      targetType: 'invoice',
      targetId: invoiceId,
      tenantId,
      metadata: {
        idempotency_key: idempotencyKey, amount_rials: quote.finalTotalRials,
        plan_code: quote.planCode, plan_version: quote.planVersion,
        plan_effective_from: quote.planEffectiveFrom, pricing_source: quote.pricingSource
      }
    });

    return {
      idempotentReplay: false,
      transactionId,
      invoiceId,
      invoiceNumber,
      amountRials: quote.finalTotalRials,
      authority: gatewayRes.authority,
      paymentUrl: gatewayRes.paymentUrl,
      status: 'pending'
    };
  }

  async _withPersistentAdvisoryLock(lockKey, callback) {
    if (!this.db || typeof this.db.connect !== 'function') {
      throw markBillingError(new Error('Persistent billing database does not expose a transaction client.'), 'BILLING_DATABASE_UNAVAILABLE');
    }
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [String(lockKey)]);
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async _withPersistentSettlementLock(authority, callback) {
    return this._withPersistentAdvisoryLock(`settlement:${authority}`, callback);
  }

  /**
   * Completes payment verification and issues grants automatically
   */
  async verifyAndSettle({ authority, addonKeys: _callbackAddonKeys = [], actorId = 'gateway_callback', _settlementLockHeld = false, _settlementClient = null } = {}) {
    if (!authority) throw new Error('VERIFICATION_ERROR: authority is required.');

    // A provider may deliver the same callback more than once and two delivery
    // workers may race. Serialize one authority across processes in persistent
    // mode; the second worker re-reads the committed status and exits through
    // the alreadySettled branch instead of verifying/granting again.
    if (!this.allowInMemoryFallback && !_settlementLockHeld) {
      return this._withPersistentSettlementLock(authority, client => this.verifyAndSettle({
        authority,
        addonKeys: _callbackAddonKeys,
        actorId,
        _settlementLockHeld: true,
        _settlementClient: client
      }));
    }
    const query = _settlementClient
      ? _settlementClient.query.bind(_settlementClient)
      : this.db.query.bind(this.db);

    // Find transaction in memory or DB
    let tx = null;
    for (const t of this.inMemoryTransactions.values()) {
      if (t.gatewayAuthority === authority) {
        tx = t;
        break;
      }
    }

    if (!tx) {
      const txSql = 'SELECT * FROM neem_billing_transactions WHERE gateway_authority = $1';
      try {
        const txRes = await query(txSql, [authority]);
        if (txRes.rows && txRes.rows.length > 0) tx = txRes.rows[0];
      } catch (error) {
        if (!this.allowInMemoryFallback) {
          markBillingError(error, 'BILLING_DATABASE_UNAVAILABLE');
          throw error;
        }
      }
    }

    if (!tx) {
      throw new Error(`TRANSACTION_NOT_FOUND: Authority '${authority}' does not exist.`);
    }

    if (tx.status === 'successful') {
      return {
        alreadySettled: true,
        transactionId: tx.id,
        invoiceId: tx.invoiceId || tx.invoice_id,
        status: 'successful'
      };
    }
    if (tx.status === 'refunded') {
      const err = new Error('PAYMENT_ALREADY_REFUNDED: A refunded transaction cannot be settled again.');
      err.code = 'PAYMENT_ALREADY_REFUNDED';
      err.status = 409;
      throw err;
    }

    const amountRials = tx.amountRials ?? tx.amount_rials;
    const invoiceId = tx.invoiceId || tx.invoice_id;
    const tenantId = tx.tenantId || tx.tenant_id;

    let inv;
    if (this.allowInMemoryFallback) {
      inv = await this.getInvoice(invoiceId);
    } else {
      const invoiceRes = await query('SELECT * FROM neem_billing_invoices WHERE id = $1', [invoiceId]);
      inv = invoiceRes.rows?.[0] ? this._formatInvoiceRow(invoiceRes.rows[0]) : null;
    }
    if (!inv) {
      const err = new Error(`INVOICE_NOT_FOUND: Invoice '${invoiceId}' does not exist.`);
      err.code = 'INVOICE_NOT_FOUND';
      err.status = 409;
      throw err;
    }
    const invoiceAmountRials = Number(inv.amountTotalRials);
    const transactionAmountRials = Number(amountRials);
    if (!Number.isSafeInteger(invoiceAmountRials) || !Number.isSafeInteger(transactionAmountRials) || invoiceAmountRials !== transactionAmountRials) {
      const err = new Error('BILLING_INVOICE_AMOUNT_MISMATCH: Transaction amount differs from the immutable invoice snapshot.');
      err.code = 'BILLING_INVOICE_AMOUNT_MISMATCH';
      err.status = 409;
      throw err;
    }

    // Verify with gateway adapter
    const verifyRes = await this.gateway.verifyPayment({
      authority,
      amountRials
    });

    if (verifyRes?.success === false) {
      tx.status = 'failed';
      try {
        await query(`UPDATE neem_billing_transactions SET status = 'failed' WHERE id = $1`, [tx.id]);
      } catch (error) {
        if (!this.allowInMemoryFallback) {
          markBillingError(error, 'BILLING_TRANSACTION_NOT_PERSISTED');
          throw error;
        }
      }
      throw new Error(`PAYMENT_FAILED: ${verifyRes.error}`);
    }
    const verifiedAmount = Number(verifyRes?.amountRials);
    const rawTraceNumber = verifyRes?.traceNumber;
    const traceNumber = typeof rawTraceNumber === 'string'
      ? rawTraceNumber.trim()
      : (Number.isSafeInteger(rawTraceNumber) ? String(rawTraceNumber) : '');
    if (verifyRes?.success !== true || !traceNumber || !Number.isSafeInteger(verifiedAmount) || verifiedAmount !== Number(amountRials)) {
      const error = new Error('Gateway verification did not return a complete, amount-matched settlement proof; payment remains pending.');
      error.code = 'BILLING_VERIFICATION_OUTCOME_UNKNOWN';
      error.status = 503;
      throw error;
    }

    // Persist the two local sides of settlement atomically. The provider check
    // has already completed; a DB failure leaves the transaction retryable,
    // and callback replay will re-verify instead of asserting payment.
    if (!this.allowInMemoryFallback) {
      const persistSettlement = async client => {
        const txUpdate = await client.query(
          `UPDATE neem_billing_transactions
              SET status = 'successful', trace_number = $1, settled_at = now()
            WHERE id = $2 AND tenant_id = $3 AND status IN ('pending', 'failed')`,
          [traceNumber, tx.id, tenantId]
        );
        this._requireOneRow(txUpdate, 'Billing transaction was not in a settleable state.', 'BILLING_SETTLEMENT_NOT_PERSISTED');
        const invoiceUpdate = await client.query(
          `UPDATE neem_billing_invoices
              SET status = 'paid', paid_at = now(), settlement_reference = $1
            WHERE id = $2 AND tenant_id = $3 AND amount_total_rials = $4 AND status = 'unpaid'`,
          [traceNumber, invoiceId, tenantId, amountRials]
        );
        this._requireOneRow(invoiceUpdate, 'Billing invoice was not in a settleable state.', 'BILLING_SETTLEMENT_NOT_PERSISTED');
      };
      if (_settlementClient) {
        try {
          await persistSettlement(_settlementClient);
        } catch (error) {
          markBillingError(error, 'BILLING_SETTLEMENT_NOT_PERSISTED');
          throw error;
        }
      } else {
        await this._withPersistentWriteTransaction(persistSettlement, 'BILLING_SETTLEMENT_NOT_PERSISTED');
      }
    }

    // Settle in-memory representations only after durable commit.
    tx.status = 'successful';
    tx.traceNumber = traceNumber;
    tx.settledAt = new Date().toISOString();
    inv.status = 'paid';
    inv.paidAt = new Date().toISOString();
    inv.settlementReference = traceNumber;

    // Issue Commercial Grants for purchased addons
    const issuedGrants = [];
    try {
      // Add-ons must come from the immutable invoice snapshot, never from the
      // unauthenticated callback body. Otherwise anyone holding an authority
      // could request arbitrary commercial grants.
      const purchasedAddonItems = this._purchasedAddonItems(inv);
      for (const item of purchasedAddonItems) {
        const grant = await grantService.issueGrant({
          tenantId,
          featureKey: item.featureKey,
          grantKind: 'addon',
          durationMonths: 12,
          actorId,
          metadata: {
            invoice_id: invoiceId,
            transaction_id: tx.id,
            charged_amount_rials: Number(item.totalRials),
            pricing_source: item.pricingSource || null
          },
          database: _settlementClient || undefined
        });
        issuedGrants.push(grant);
      }
      tx.entitlementActivated = true;
      tx.entitlementActivatedAt = new Date().toISOString();
      if (inv) inv.entitlementStatus = 'activated';
    } catch (err) {
      // AC-21: If grant distribution fails, payment is captured but activation is pending!
      tx.entitlementActivated = false;
      tx.activationError = err.message;
      if (inv) inv.entitlementStatus = 'failed';
    }

    try {
      await query(
        `UPDATE neem_billing_transactions
            SET entitlement_activated = $1,
                entitlement_activated_at = CASE WHEN $1 THEN now() ELSE NULL END,
                activation_error = $2
          WHERE id = $3`,
        [Boolean(tx.entitlementActivated), tx.activationError || null, tx.id]
      );
      await query(
        `UPDATE neem_billing_invoices SET entitlement_status = $1 WHERE id = $2`,
        [tx.entitlementActivated ? 'activated' : 'failed', invoiceId]
      );
    } catch (error) {
      if (!this.allowInMemoryFallback) {
        markBillingError(error, 'BILLING_ENTITLEMENT_STATE_NOT_PERSISTED');
        throw error;
      }
    }

    await auditService.recordEvent({
      actorId,
      action: 'BILLING_PAYMENT_SETTLED',
      targetType: 'transaction',
      targetId: tx.id,
      tenantId,
      metadata: {
        invoice_id: invoiceId,
        trace_number: traceNumber,
        grants_issued: issuedGrants.length,
        entitlement_activated: tx.entitlementActivated
      },
      database: _settlementClient || undefined
    });

    return {
      success: true,
      transactionId: tx.id,
      invoiceId,
      traceNumber,
      grantsIssued: issuedGrants.length,
      entitlementActivated: tx.entitlementActivated
    };
  }

  /**
   * AC-21 Retry Activation:
   * Re-attempts policy and entitlement sync for an already paid transaction without re-charging.
   */
  async retryActivation(transactionId, { actorId = 'platform_operations', _activationLockHeld = false, _activationClient = null } = {}) {
    if (!this.allowInMemoryFallback && !_activationLockHeld) {
      return this._withPersistentAdvisoryLock(`activation:${transactionId}`, client => this.retryActivation(transactionId, {
        actorId,
        _activationLockHeld: true,
        _activationClient: client
      }));
    }
    const query = _activationClient
      ? _activationClient.query.bind(_activationClient)
      : this.db.query.bind(this.db);
    let tx = this.inMemoryTransactions.get(transactionId);
    if (!tx) {
      const txSql = 'SELECT * FROM neem_billing_transactions WHERE id = $1';
      try {
        const res = await query(txSql, [transactionId]);
        if (res.rows && res.rows.length > 0) tx = res.rows[0];
      } catch (error) {
        if (!this.allowInMemoryFallback) {
          markBillingError(error, 'BILLING_DATABASE_UNAVAILABLE');
          throw error;
        }
      }
    }

    if (!tx) throw new Error(`TRANSACTION_NOT_FOUND: Transaction '${transactionId}' not found.`);
    if (tx.status !== 'successful') {
      throw new Error('ACTIVATION_ERROR: Can only retry activation for successful/paid transactions.');
    }
    if (tx.entitlementActivated || tx.entitlement_activated) {
      return {
        success: true,
        alreadyActivated: true,
        transactionId: tx.id,
        invoiceId: tx.invoiceId || tx.invoice_id,
        entitlementActivated: true,
        issuedGrantsCount: 0
      };
    }

    const invoiceId = tx.invoiceId || tx.invoice_id;
    let inv;
    if (this.allowInMemoryFallback) {
      inv = await this.getInvoice(invoiceId);
    } else {
      const invoiceRes = await query('SELECT * FROM neem_billing_invoices WHERE id = $1', [invoiceId]);
      inv = invoiceRes.rows?.[0] ? this._formatInvoiceRow(invoiceRes.rows[0]) : null;
    }
    const tenantId = tx.tenantId || tx.tenant_id;

    // Issue grants based on invoice line items
    const purchasedAddonItems = this._purchasedAddonItems(inv);
    const issuedGrants = [];
    for (const item of purchasedAddonItems) {
      const grant = await grantService.issueGrant({
        tenantId,
        featureKey: item.featureKey,
        grantKind: 'addon',
        durationMonths: 12,
        actorId,
        metadata: {
          invoice_id: invoiceId,
          transaction_id: tx.id,
          retried: true,
          charged_amount_rials: Number(item.totalRials),
          pricing_source: item.pricingSource || null
        },
        database: _activationClient || undefined
      });
      issuedGrants.push(grant);
    }

    tx.entitlementActivated = true;
    tx.entitlementActivatedAt = new Date().toISOString();
    tx.activationError = null;
    tx.retryCount = (tx.retryCount || 0) + 1;
    if (inv) inv.entitlementStatus = 'activated';

    try {
      await query(
        `UPDATE neem_billing_transactions
         SET entitlement_activated = true, entitlement_activated_at = now(), activation_error = null, retry_count = retry_count + 1
         WHERE id = $1`,
        [tx.id]
      );
      await query(
        `UPDATE neem_billing_invoices SET entitlement_status = 'activated' WHERE id = $1`,
        [invoiceId]
      );
    } catch (error) {
      if (!this.allowInMemoryFallback) {
        markBillingError(error, 'BILLING_ENTITLEMENT_STATE_NOT_PERSISTED');
        throw error;
      }
    }

    await auditService.recordEvent({
      actorId,
      action: 'BILLING_ENTITLEMENT_ACTIVATION_RETRIED',
      targetType: 'transaction',
      targetId: tx.id,
      tenantId,
      metadata: { invoiceId, issuedGrants: issuedGrants.length, retryCount: tx.retryCount },
      database: _activationClient || undefined
    });

    return {
      success: true,
      transactionId: tx.id,
      invoiceId,
      entitlementActivated: true,
      issuedGrantsCount: issuedGrants.length
    };
  }

  /**
   * Processes a refund without deleting tenant commercial data (AC-19/AC-20)
   */
  async refund({ transactionId, reason, actorId = 'platform_finance', _refundLockHeld = false, _refundClient = null } = {}) {
    if (!transactionId) throw new Error('REFUND_ERROR: transactionId is required.');

    // Provider refunds are irreversible external effects. Serialize them by
    // transaction in persistent mode so concurrent finance actions cannot send
    // two refund requests before either status update becomes visible.
    if (!this.allowInMemoryFallback && !_refundLockHeld) {
      return this._withPersistentAdvisoryLock(`refund:${transactionId}`, client => this.refund({
        transactionId,
        reason,
        actorId,
        _refundLockHeld: true,
        _refundClient: client
      }));
    }
    const query = _refundClient
      ? _refundClient.query.bind(_refundClient)
      : this.db.query.bind(this.db);

    let tx = this.inMemoryTransactions.get(transactionId);
    if (!tx) {
      const txSql = 'SELECT * FROM neem_billing_transactions WHERE id = $1';
      try {
        const txRes = await query(txSql, [transactionId]);
        if (txRes.rows && txRes.rows.length > 0) tx = txRes.rows[0];
      } catch (error) {
        if (!this.allowInMemoryFallback) {
          markBillingError(error, 'BILLING_DATABASE_UNAVAILABLE');
          throw error;
        }
      }
    }

    if (tx?.status === 'refunded') {
      return {
        success: true,
        alreadyRefunded: true,
        transactionId: tx.id,
        refundReference: tx.refundReference || tx.refund_reference || null,
        status: 'refunded'
      };
    }

    if (!tx || tx.status !== 'successful') {
      throw new Error('REFUND_ERROR: Only successful transactions can be refunded.');
    }

    const amountRials = tx.amountRials || tx.amount_rials;
    const invoiceId = tx.invoiceId || tx.invoice_id;
    const tenantId = tx.tenantId || tx.tenant_id;

    const refundRes = await this.gateway.refundPayment({
      transactionId,
      amountRials,
      reason
    });

    tx.status = 'refunded';
    tx.refundReason = reason || 'Customer refund request';
    tx.refundReference = refundRes.refundReference;
    tx.refundedAt = new Date().toISOString();

    let inv;
    if (this.allowInMemoryFallback) {
      inv = await this.getInvoice(invoiceId);
    } else {
      const invoiceRes = await query('SELECT * FROM neem_billing_invoices WHERE id = $1', [invoiceId]);
      inv = invoiceRes.rows?.[0] ? this._formatInvoiceRow(invoiceRes.rows[0]) : null;
    }
    if (inv) {
      inv.status = 'refunded';
      inv.entitlementStatus = 'refunded';
    }

    try {
      await query(
        `UPDATE neem_billing_transactions
         SET status = 'refunded', refund_reason = $1, refund_reference = $2, refunded_at = now()
         WHERE id = $3`,
        [reason || 'Customer refund request', refundRes.refundReference, tx.id]
      );
      await query(
        `UPDATE neem_billing_invoices SET status = 'refunded', entitlement_status = 'refunded' WHERE id = $1`,
        [invoiceId]
      );
    } catch (error) {
      if (!this.allowInMemoryFallback) {
        markBillingError(error, 'BILLING_REFUND_NOT_PERSISTED');
        throw error;
      }
    }

    await auditService.recordEvent({
      actorId,
      action: 'BILLING_TRANSACTION_REFUNDED',
      targetType: 'transaction',
      targetId: tx.id,
      tenantId,
      metadata: { reason, refund_reference: refundRes.refundReference, amount_rials: amountRials },
      database: _refundClient || undefined
    });

    return {
      success: true,
      transactionId: tx.id,
      refundReference: refundRes.refundReference,
      status: 'refunded'
    };
  }

  _formatInvoiceRow(row) {
    return {
      id: row.id,
      invoiceNumber: row.invoice_number,
      tenantId: row.tenant_id,
      subscriptionId: row.subscription_id,
      planCode: row.plan_code || null,
      planVersion: row.plan_version || null,
      amountSubtotalRials: row.amount_subtotal_rials,
      vatAmountRials: row.vat_amount_rials,
      discountAmountRials: row.discount_amount_rials,
      amountTotalRials: row.amount_total_rials,
      status: row.status,
      entitlementStatus: row.entitlement_status,
      currency: row.currency,
      billingCycle: row.billing_cycle,
      dueDate: row.due_date,
      paidAt: row.paid_at,
      settlementReference: row.settlement_reference,
      lineItems: Array.isArray(row.line_items)
        ? row.line_items
        : (() => {
            if (typeof row.line_items !== 'string') return [];
            try { return JSON.parse(row.line_items); } catch { return []; }
          })(),
      createdAt: row.created_at
    };
  }

  _formatTransactionRow(row) {
    return {
      id: row.id,
      invoiceId: row.invoice_id,
      tenantId: row.tenant_id,
      idempotencyKey: row.idempotency_key,
      gatewayProvider: row.gateway_provider,
      gatewayAuthority: row.gateway_authority,
      traceNumber: row.trace_number,
      amountRials: row.amount_rials,
      status: row.status,
      entitlementActivated: row.entitlement_activated,
      entitlementActivatedAt: row.entitlement_activated_at,
      activationError: row.activation_error,
      retryCount: row.retry_count,
      refundReason: row.refund_reason,
      refundReference: row.refund_reference,
      refundedAt: row.refunded_at,
      createdAt: row.created_at,
      settledAt: row.settled_at
    };
  }
}

module.exports = new PaymentService();
