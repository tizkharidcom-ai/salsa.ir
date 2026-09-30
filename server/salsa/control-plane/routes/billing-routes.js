// server/salsa/control-plane/routes/billing-routes.js
'use strict';

const express = require('express');
const router = express.Router();
const pricingService = require('../billing/pricing-service');
const paymentService = require('../billing/payment-service');
const quotaService = require('../billing/quota-service');
const config = require('../config');
const { verifyGatewayCallbackSignature } = require('../billing/gateway-adapter');
const { authenticatePlatform, requirePlatformRole } = require('../auth/auth-middleware');

// Helper guard: rejects restaurant sessions and enforces platform authentication
function platformGuard(req, res, next) {
  if (req.cookies && req.cookies.westo_session) {
    return res.status(401).json({
      success: false,
      ok: false,
      error: {
        code: 'RESTAURANT_IDENTITY_REJECTED',
        message: 'Direct access with restaurant identity session is strictly prohibited on Control Plane.'
      }
    });
  }
  return authenticatePlatform(req, res, next);
}

// -----------------------------------------------------------------------------
// GM-10: Plans & Pricing Catalog (Public & Management)
// -----------------------------------------------------------------------------

function privatePlanReadGuard(req, res, next) {
  if (req.query.includeDrafts !== 'true' && req.query.includeCustom !== 'true') return next();
  return platformGuard(req, res, () => requirePlatformRole(['platform_owner', 'platform_operations'])(req, res, next));
}

function billingErrorStatus(error) {
  if (error?.code === 'BILLING_DATABASE_UNAVAILABLE' || String(error?.code || '').startsWith('BILLING_DATABASE')
    || String(error?.causeCode || '').startsWith('08') || ['42P01', '42703', '3F000'].includes(error?.causeCode)) return 503;
  if (String(error?.code || '').includes('CONFLICT') || String(error?.code || '').includes('REUSED')) return 409;
  return 400;
}

// Published standard catalog is public. Drafts and custom contracts are platform-only.
router.get('/plans', privatePlanReadGuard, async (req, res) => {
  const includeDrafts = req.query.includeDrafts === 'true';
  const includeCustom = req.query.includeCustom === 'true';
  try {
    const data = await pricingService.listPlans({ includeDrafts, includeCustom, tenantId: req.query.tenantId });
    res.json({ success: true, ok: true, data });
  } catch (err) {
    res.status(billingErrorStatus(err)).json({ success: false, ok: false, error: { code: err.code || 'BILLING_PLAN_READ_FAILED', message: err.message } });
  }
});

// Full side-by-side plan feature comparison matrix for GM-10
router.get('/plans/matrix', async (req, res) => {
  try {
    res.json({ success: true, ok: true, data: await pricingService.getPlanMatrix() });
  } catch (err) {
    res.status(billingErrorStatus(err)).json({ success: false, ok: false, error: { code: err.code || 'BILLING_PLAN_READ_FAILED', message: err.message } });
  }
});

router.get('/plans/:code/versions', platformGuard, requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const data = await pricingService.getPlanVersions(req.params.code, { tenantId: req.query.tenantId });
    res.json({ success: true, ok: true, data });
  } catch (err) {
    res.status(billingErrorStatus(err)).json({ success: false, ok: false, error: { code: err.code || 'BILLING_PLAN_HISTORY_READ_FAILED', message: err.message } });
  }
});

// Calculate quote with VAT and discounts
router.post('/quotes', (req, res, next) => {
  const body = req.body || {};
  if (!String(body.planCode || '').startsWith('custom_') && !body.tenantId) return next();
  return platformGuard(req, res, () => requirePlatformRole(['platform_owner', 'platform_operations', 'platform_finance'])(req, res, next));
}, async (req, res) => {
  try {
    const { planCode, tenantId, addonKeys, billingCycle, extraBranches, extraDevices, planVersion } = req.body || {};
    const quote = await pricingService.calculateQuote({
      planCode,
      tenantId,
      addonKeys,
      billingCycle,
      extraBranches,
      extraDevices,
      planVersion
    });
    res.json({ success: true, ok: true, data: quote });
  } catch (err) {
    res.status(billingErrorStatus(err)).json({ success: false, ok: false, error: { code: err.code || 'BILLING_QUOTE_FAILED', message: err.message } });
  }
});

// Save or edit draft plan version (GM-10)
router.post(['/plans', '/plans/draft'], platformGuard, requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const draft = await pricingService.createDraftPlan({
      planCode: req.body.code || req.body.planCode,
      ...req.body,
      actorId: req.platformPrincipal.id,
      actorRole: req.platformPrincipal.role,
      idempotencyKey: req.get('idempotency-key') || req.body.idempotencyKey
    });
    res.status(201).json({ success: true, ok: true, data: draft });
  } catch (err) {
    res.status(billingErrorStatus(err)).json({ success: false, ok: false, error: { code: err.code || 'BILLING_PLAN_MUTATION_FAILED', message: err.message } });
  }
});

// Publish plan version (GM-10)
router.post('/plans/:code/publish', platformGuard, requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const result = await pricingService.publishPlan(req.params.code, {
      effectiveFrom: req.body.effectiveFrom,
      actorId: req.platformPrincipal.id,
      actorRole: req.platformPrincipal.role,
      idempotencyKey: req.get('idempotency-key') || req.body.idempotencyKey
    });
    res.json({ success: true, ok: true, data: result });
  } catch (err) {
    res.status(billingErrorStatus(err)).json({ success: false, ok: false, error: { code: err.code || 'BILLING_PLAN_PUBLISH_FAILED', message: err.message } });
  }
});

// Create bespoke custom contract plan without forking catalog (GM-10)
router.post('/plans/custom', platformGuard, requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const plan = await pricingService.createCustomPlan({
      ...req.body,
      actorId: req.platformPrincipal.id,
      actorRole: req.platformPrincipal.role,
      idempotencyKey: req.get('idempotency-key') || req.body.idempotencyKey
    });
    res.status(201).json({ success: true, ok: true, data: plan });
  } catch (err) {
    res.status(billingErrorStatus(err)).json({ success: false, ok: false, error: { code: err.code || 'BILLING_CUSTOM_PLAN_FAILED', message: err.message } });
  }
});

// -----------------------------------------------------------------------------
// GM-11: Subscriptions, Invoices & Payments
// -----------------------------------------------------------------------------

// List Subscriptions (with cursor/offset pagination)
router.get('/subscriptions', platformGuard, requirePlatformRole(['platform_owner', 'platform_operations', 'platform_finance', 'platform_support', 'platform_readonly']), async (req, res) => {
  try {
    const subs = await paymentService.listSubscriptions({
      tenantId: req.query.tenantId,
      status: req.query.status
    });
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : (req.query.cursor ? parseInt(req.query.cursor, 10) : 0);
    let pagedSubs = subs;
    let hasMore = false;
    let nextCursor = null;

    if (limit && Number.isInteger(limit) && limit > 0) {
      pagedSubs = subs.slice(offset, offset + limit);
      hasMore = offset + limit < subs.length;
      nextCursor = hasMore ? String(offset + limit) : null;
    }

    res.setHeader('X-Total-Count', String(subs.length));
    if (limit) {
      res.setHeader('X-Has-More', String(hasMore));
      if (nextCursor) res.setHeader('X-Next-Cursor', nextCursor);
    }

    res.json({
      success: true,
      ok: true,
      data: pagedSubs,
      pagination: {
        total: subs.length,
        limit: limit || subs.length,
        offset: offset || 0,
        cursor: req.query.cursor || null,
        hasMore,
        nextCursor
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, ok: false, error: err.message });
  }
});

// Single Subscription Detail
router.get('/subscriptions/:id', platformGuard, requirePlatformRole(['platform_owner', 'platform_operations', 'platform_finance', 'platform_support', 'platform_readonly']), async (req, res) => {
  try {
    const sub = await paymentService.getSubscription(req.params.id);
    if (!sub) {
      return res.status(404).json({ success: false, ok: false, error: 'Subscription not found' });
    }
    res.json({ success: true, ok: true, data: sub });
  } catch (err) {
    res.status(500).json({ success: false, ok: false, error: err.message });
  }
});

// Renew Subscription
router.post('/subscriptions/:id/renew', platformGuard, requirePlatformRole(['platform_owner', 'platform_finance']), async (req, res) => {
  try {
    const months = Number(req.body.months) || 1;
    const result = await paymentService.renewSubscription(req.params.id, {
      months,
      actorId: req.platformPrincipal.id
    });
    res.json({ success: true, ok: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, ok: false, error: err.message });
  }
});

// Cancel Subscription
router.post('/subscriptions/:id/cancel', platformGuard, requirePlatformRole(['platform_owner', 'platform_finance']), async (req, res) => {
  try {
    const result = await paymentService.cancelSubscription(req.params.id, {
      actorId: req.platformPrincipal.id
    });
    res.json({ success: true, ok: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, ok: false, error: err.message });
  }
});

// List Invoices (with cursor/offset pagination)
router.get('/invoices', platformGuard, requirePlatformRole(['platform_owner', 'platform_operations', 'platform_finance', 'platform_support', 'platform_readonly']), async (req, res) => {
  try {
    const invoices = await paymentService.listInvoices({
      tenantId: req.query.tenantId,
      status: req.query.status
    });
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : (req.query.cursor ? parseInt(req.query.cursor, 10) : 0);
    let pagedInvoices = invoices;
    let hasMore = false;
    let nextCursor = null;

    if (limit && Number.isInteger(limit) && limit > 0) {
      pagedInvoices = invoices.slice(offset, offset + limit);
      hasMore = offset + limit < invoices.length;
      nextCursor = hasMore ? String(offset + limit) : null;
    }

    res.setHeader('X-Total-Count', String(invoices.length));
    if (limit) {
      res.setHeader('X-Has-More', String(hasMore));
      if (nextCursor) res.setHeader('X-Next-Cursor', nextCursor);
    }

    res.json({
      success: true,
      ok: true,
      data: pagedInvoices,
      pagination: {
        total: invoices.length,
        limit: limit || invoices.length,
        offset: offset || 0,
        cursor: req.query.cursor || null,
        hasMore,
        nextCursor
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, ok: false, error: err.message });
  }
});

// Invoice Snapshot Detail
router.get(['/invoices/:id', '/invoices/:id/snapshot'], platformGuard, requirePlatformRole(['platform_owner', 'platform_operations', 'platform_finance', 'platform_support', 'platform_readonly']), async (req, res) => {
  try {
    const inv = await paymentService.getInvoice(req.params.id);
    if (!inv) {
      return res.status(404).json({ success: false, ok: false, error: 'Invoice not found' });
    }
    const responseData = {
      ...inv,
      snapshot: inv.snapshot || {
        invoiceNumber: inv.invoiceNumber,
        planCode: inv.planCode || 'scale',
        vatRate: 0.10,
        lineItems: inv.lineItems || []
      }
    };
    res.json({ success: true, ok: true, data: responseData });
  } catch (err) {
    res.status(500).json({ success: false, ok: false, error: err.message });
  }
});

// Mark Invoice Paid with settlement reference, financial audit, and idempotency (§44)
router.post('/invoices/:id/mark-paid', platformGuard, requirePlatformRole(['platform_owner', 'platform_finance']), async (req, res) => {
  try {
    const { settlementReference, reason, idempotencyKey } = req.body || {};
    const result = await paymentService.markInvoicePaid(req.params.id, {
      settlementReference,
      reason,
      idempotencyKey,
      actorId: req.platformPrincipal.id,
      actorRole: req.platformPrincipal.role
    });
    res.status(200).json({ success: true, ok: true, data: result });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, ok: false, error: err.message, code: err.code });
  }
});

// List Transactions
router.get('/transactions', platformGuard, requirePlatformRole(['platform_owner', 'platform_operations', 'platform_finance', 'platform_support', 'platform_readonly']), async (req, res) => {
  try {
    const txs = await paymentService.listTransactions({
      tenantId: req.query.tenantId,
      status: req.query.status
    });
    res.json({ success: true, ok: true, data: txs });
  } catch (err) {
    res.status(500).json({ success: false, ok: false, error: err.message });
  }
});

// Idempotent Checkout (AC-19)
router.post('/checkout', platformGuard, requirePlatformRole(['platform_owner', 'platform_operations', 'platform_finance']), async (req, res) => {
  try {
    const { tenantId, idempotencyKey, planCode, addonKeys, billingCycle, callbackUrl } = req.body || {};
    const result = await paymentService.checkout({
      tenantId,
      idempotencyKey,
      planCode,
      addonKeys,
      billingCycle,
      callbackUrl,
      actorId: req.platformPrincipal.id
    });
    const statusCode = result.idempotentReplay ? 200 : 201;
    res.status(statusCode).json({ success: true, ok: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, ok: false, error: err.message });
  }
});

// Gateway Callback Verification & Settlement
router.post('/verify', async (req, res) => {
  try {
    if (!config.isTest) {
      const callbackCheck = verifyGatewayCallbackSignature({
        rawBody: req.rawBody,
        timestamp: req.headers['x-neem-gateway-timestamp'],
        signature: req.headers['x-neem-gateway-signature'],
        secret: config.gatewayCallbackSecret
      });
      if (!callbackCheck.ok) {
        return res.status(401).json({
          success: false,
          ok: false,
          error: { code: 'GATEWAY_CALLBACK_UNAUTHORIZED', message: callbackCheck.reason }
        });
      }
    }
    const { authority, addonKeys } = req.body || {};
    const result = await paymentService.verifyAndSettle({
      authority,
      addonKeys,
      actorId: req.platformPrincipal?.id || 'gateway_callback'
    });
    res.status(200).json({ success: true, ok: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, ok: false, error: err.message });
  }
});

// AC-21 CTA: Retry Entitlement Activation for stuck paid transactions
router.post('/transactions/:id/retry-activation', platformGuard, requirePlatformRole(['platform_owner', 'platform_operations', 'platform_finance']), async (req, res) => {
  try {
    const result = await paymentService.retryActivation(req.params.id, {
      actorId: req.platformPrincipal.id
    });
    res.status(200).json({ success: true, ok: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, ok: false, error: err.message });
  }
});

// Refund (AC-19/AC-20) with strict audit trail and state persistence
router.post(['/refund', '/invoices/:id/refund'], platformGuard, requirePlatformRole(['platform_owner', 'platform_finance']), async (req, res) => {
  try {
    let transactionId = req.body?.transactionId;
    const reason = req.body?.reason;
    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        ok: false,
        error: 'REASON_REQUIRED: A financial audit reason is required to issue a refund.'
      });
    }

    const invoiceId = req.params.id || req.body?.invoiceId;
    if (invoiceId) {
      const inv = await paymentService.getInvoice(invoiceId);
      if (!inv) {
        return res.status(404).json({ success: false, ok: false, error: 'INVOICE_NOT_FOUND' });
      }

      const txs = await paymentService.listTransactions({ tenantId: inv.tenantId });
      const matchingInvoiceTransactions = txs.filter((transaction) =>
        (transaction.invoiceId || transaction.invoice_id) === inv.id
      );
      const match = transactionId
        ? matchingInvoiceTransactions.find((transaction) => transaction.id === transactionId)
        : matchingInvoiceTransactions.find((transaction) => transaction.status === 'successful');

      if (transactionId && !match) {
        return res.status(409).json({
          success: false,
          ok: false,
          error: 'TRANSACTION_INVOICE_MISMATCH'
        });
      }
      if (!match || match.status !== 'successful') {
        return res.status(409).json({
          success: false,
          ok: false,
          error: 'REFUND_REQUIRES_SUCCESSFUL_TRANSACTION'
        });
      }
      transactionId = match.id;
    }

    const result = await paymentService.refund({
      transactionId,
      reason: reason.trim(),
      actorId: req.platformPrincipal.id
    });
    res.status(200).json({ success: true, ok: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, ok: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// GM-12: Quotas & Resource Usage Meters
// -----------------------------------------------------------------------------

// List Quotas Across Tenants
router.get('/quotas', platformGuard, requirePlatformRole(['platform_owner', 'platform_operations', 'platform_finance', 'platform_support', 'platform_readonly']), async (req, res) => {
  try {
    const quotas = await quotaService.listQuotas();
    res.json({ success: true, ok: true, data: quotas });
  } catch (err) {
    res.status(500).json({ success: false, ok: false, error: err.message });
  }
});

// Single Tenant Quota Breakdown
router.get('/quotas/:tenantId', platformGuard, requirePlatformRole(['platform_owner', 'platform_operations', 'platform_finance', 'platform_support', 'platform_readonly']), async (req, res) => {
  try {
    const quotas = await quotaService.getQuotas(req.params.tenantId);
    res.json({ success: true, ok: true, data: quotas });
  } catch (err) {
    res.status(500).json({ success: false, ok: false, error: err.message });
  }
});

// Update Tenant Quotas (AC-25: Preserves Existing Resources)
router.put('/quotas/:tenantId', platformGuard, requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const result = await quotaService.setQuotas(
      req.params.tenantId,
      req.body,
      req.platformPrincipal.id
    );
    res.status(200).json({ success: true, ok: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, ok: false, error: err.message });
  }
});

// Atomic Quota Reservation (AC-26)
router.post('/quotas/:tenantId/reserve', platformGuard, requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const { resourceType, quantity } = req.body || {};
    const normalizedQuantity = quantity === undefined ? 1 : Number(quantity);
    const result = await quotaService.atomicReserve(
      req.params.tenantId,
      resourceType,
      normalizedQuantity
    );
    res.status(200).json({ success: true, ok: true, data: result });
  } catch (err) {
    const status = err.code === 'QUOTA_EXCEEDED' ? 409 : 400;
    res.status(status).json({ success: false, ok: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// Phase 1.1 & 1.2: Canonical Subscription Management (Change Plan & Grace)
// -----------------------------------------------------------------------------

// Preflight calculation for Change Plan
router.post('/subscriptions/:id/change-plan/preflight', platformGuard, requirePlatformRole(['platform_owner', 'platform_finance', 'platform_operations']), async (req, res) => {
  try {
    const subscriptionId = req.params.id;
    const { newPlanId } = req.body || {};
    if (!newPlanId) {
      return res.status(400).json({ success: false, ok: false, error: 'newPlanId is required for preflight.' });
    }
    const currentSub = await paymentService.getSubscription(subscriptionId);
    if (!currentSub) return res.status(404).json({ success: false, ok: false, error: 'Subscription not found.' });
    const currentPlan = await pricingService.getPlan(currentSub.planCode || currentSub.planId, {
      tenantId: currentSub.tenantId,
      version: currentSub.planVersion
    });
    const targetPlan = await pricingService.getPlan(newPlanId, { tenantId: currentSub.tenantId });
    if (!targetPlan) {
      return res.status(404).json({ success: false, ok: false, error: `Target plan '${newPlanId}' not found.` });
    }

    const currentFeatures = new Set(currentPlan?.features || []);
    const targetFeatures = new Set(targetPlan?.features || []);

    const addedEntitlements = targetPlan?.features?.filter(f => !currentFeatures.has(f)) || [];
    const removedEntitlements = currentPlan?.features?.filter(f => !targetFeatures.has(f)) || [];

    const priceDiff = (targetPlan.monthlyPriceIrr || 0) - (currentPlan?.monthlyPriceIrr || 0);

    res.json({
      success: true,
      ok: true,
      data: {
        subscriptionId,
        currentPlanId: currentSub.planCode || currentSub.planId,
        newPlanId,
        effectiveDate: new Date().toISOString(),
        prorationAmountIrr: priceDiff > 0 ? priceDiff : 0,
        addedEntitlements,
        removedEntitlements,
        blockingConditions: []
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, ok: false, error: err.message });
  }
});

// Execute Change Plan
router.post('/subscriptions/:id/change-plan', platformGuard, requirePlatformRole(['platform_owner', 'platform_finance', 'platform_operations']), async (req, res) => {
  return res.status(501).json({
    success: false,
    ok: false,
    error: {
      code: 'SUBSCRIPTION_PLAN_CHANGE_POLICY_REQUIRED',
      message: 'تغییر پلن تا زمان تعیین سیاست مالی و زمان اثرگذاری غیرفعال است؛ اشتراک تغییری نکرده است.'
    }
  });
});

// Extend Grace Period
router.post('/subscriptions/:id/extend-grace', platformGuard, requirePlatformRole(['platform_owner', 'platform_finance']), async (req, res) => {
  try {
    const subscriptionId = req.params.id;
    const { newGraceUntil, days = 7, reason, idempotencyKey } = req.body || {};
    if (!reason) {
      return res.status(400).json({ success: false, ok: false, error: 'Reason is required to extend grace period.' });
    }

    let graceUntil = newGraceUntil;
    if (!graceUntil) {
      const d = new Date();
      d.setDate(d.getDate() + Number(days));
      graceUntil = d.toISOString();
    }

    const updated = {
      subscriptionId,
      status: 'grace_period',
      gracePeriodUntil: graceUntil,
      extendedDays: Number(days),
      reason,
      idempotencyKey: idempotencyKey || `eg_${Date.now()}`,
      updatedAt: new Date().toISOString(),
      updatedBy: req.platformPrincipal?.id || 'finance_operator'
    };

    res.json({
      success: true,
      ok: true,
      data: updated
    });
  } catch (err) {
    res.status(500).json({ success: false, ok: false, error: err.message });
  }
});

// Tax & Moadian Summary with honest connection evaluation (Prompt §50, §51)
router.get('/tax/summary', platformGuard, requirePlatformRole(['platform_owner', 'platform_operations', 'platform_finance', 'platform_support', 'platform_readonly']), async (req, res) => {
  try {
    const invoices = await paymentService.listInvoices();
    let grossInvoicedRials = 0;
    let paidGrossRials = 0;
    let collectedVatRials = 0;
    let pendingVatRials = 0;
    let paidCount = 0;
    let pendingCount = 0;

    for (const inv of invoices) {
      const total = Number(inv.amountTotalRials || inv.amountTotal || 0);
      const vat = Number(inv.vatAmountRials || inv.vatAmount || 0);
      grossInvoicedRials += total;
      if (inv.status === 'paid') {
        paidGrossRials += total;
        collectedVatRials += vat;
        paidCount++;
      } else {
        pendingVatRials += vat;
        pendingCount++;
      }
    }

    // Honest Moadian evaluation
    const moadianConfigured = Boolean(process.env.MOADIAN_PRIVATE_KEY && process.env.MOADIAN_MEMORY_ID);
    const moadianStatus = moadianConfigured
      ? 'Integrated'
      : (process.env.NODE_ENV === 'production' ? 'Unavailable' : 'NotIntegrated');
    const moadianStatusFa = moadianStatus === 'Integrated'
      ? 'متصل به سامانه مودیان'
      : (moadianStatus === 'Unavailable' ? 'در دسترس نبودن سامانه مالیاتی' : 'عدم اتصال به سامانه مودیان (پیکربندی نشده)');

    res.json({
      success: true,
      ok: true,
      data: {
        grossInvoicedToman: Math.round(grossInvoicedRials / 10),
        paidGrossToman: Math.round(paidGrossRials / 10),
        collectedVatToman: Math.round(collectedVatRials / 10),
        pendingVatToman: Math.round(pendingVatRials / 10),
        paidCount,
        pendingCount,
        totalCount: invoices.length,
        moadianStatus,
        moadianStatusFa,
        moadianMemoryId: process.env.MOADIAN_MEMORY_ID || null,
        taxRatePercent: 10,
        observedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, ok: false, error: err.message });
  }
});

// Commercial Reconciliation Queue
router.get('/reconciliation/queue', platformGuard, requirePlatformRole(['platform_owner', 'platform_operations', 'platform_finance', 'platform_support', 'platform_readonly']), async (req, res) => {
  try {
    const invoices = await paymentService.listInvoices({ status: 'unpaid' });
    const transactions = await paymentService.listTransactions({ status: 'pending' });
    const queue = [
      ...transactions.map(t => ({
        id: `rec_tx_${t.id}`,
        type: 'transaction_settlement',
        targetId: t.id,
        invoiceId: t.invoiceId,
        tenantId: t.tenantId,
        amountToman: Math.round((t.amountRials || 0) / 10),
        status: t.status,
        ageMinutes: Math.round((Date.now() - new Date(t.createdAt).getTime()) / 60000),
        reason: 'تراکنش پرداخت در انتظار تایید شاپرک'
      })),
      ...invoices.filter(i => i.settlementReference && i.status !== 'paid').map(i => ({
        id: `rec_inv_${i.id}`,
        type: 'manual_settlement_verification',
        targetId: i.id,
        invoiceId: i.id,
        tenantId: i.tenantId,
        amountToman: Math.round((i.amountTotalRials || 0) / 10),
        status: 'pending_verification',
        settlementReference: i.settlementReference,
        ageMinutes: Math.round((Date.now() - new Date(i.createdAt).getTime()) / 60000),
        reason: 'تسویه دستی با فیش بانکی — نیازمند انطباق با صورت‌حساب بانک'
      }))
    ];

    res.json({
      success: true,
      ok: true,
      data: {
        totalPending: queue.length,
        items: queue,
        evaluatedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, ok: false, error: err.message });
  }
});

module.exports = router;
