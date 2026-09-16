// server/neem/control-plane/routes/billing-routes.js
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

// List all plans (Side-by-side catalog)
router.get('/plans', (req, res) => {
  const includeDrafts = req.query.includeDrafts === 'true';
  const includeCustom = req.query.includeCustom === 'true';
  res.json({
    success: true,
    ok: true,
    data: pricingService.listPlans({ includeDrafts, includeCustom })
  });
});

// Full side-by-side plan feature comparison matrix for GM-10
router.get('/plans/matrix', (req, res) => {
  res.json({
    success: true,
    ok: true,
    data: pricingService.getPlanMatrix()
  });
});

// Calculate quote with VAT and discounts
router.post('/quotes', (req, res) => {
  try {
    const { planCode, addonKeys, billingCycle, extraBranches, extraDevices } = req.body || {};
    const quote = pricingService.calculateQuote({
      planCode,
      addonKeys,
      billingCycle,
      extraBranches,
      extraDevices
    });
    res.json({ success: true, ok: true, data: quote });
  } catch (err) {
    res.status(400).json({ success: false, ok: false, error: err.message });
  }
});

// Save or edit draft plan version (GM-10)
router.post(['/plans', '/plans/draft'], platformGuard, requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const draft = await pricingService.createDraftPlan({
      planCode: req.body.code || req.body.planCode,
      ...req.body,
      actorId: req.platformPrincipal.id
    });
    res.status(201).json({ success: true, ok: true, data: draft });
  } catch (err) {
    res.status(400).json({ success: false, ok: false, error: err.message });
  }
});

// Publish plan version (GM-10)
router.post('/plans/:code/publish', platformGuard, requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    let planCode = req.params.code;
    // Check if code was passed as an ID or code
    if (!pricingService.getPlan(planCode)) {
      const all = pricingService.listPlans({ includeDrafts: true });
      const matched = all.find(p => p.id === planCode || p.planCode === planCode);
      if (matched) planCode = matched.planCode;
    }

    const result = await pricingService.publishPlan(planCode, {
      effectiveFrom: req.body.effectiveFrom,
      actorId: req.platformPrincipal.id
    });
    res.json({ success: true, ok: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, ok: false, error: err.message });
  }
});

// Create bespoke custom contract plan without forking catalog (GM-10)
router.post('/plans/custom', platformGuard, requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const plan = await pricingService.createCustomPlan({
      ...req.body,
      actorId: req.platformPrincipal.id
    });
    res.status(201).json({ success: true, ok: true, data: plan });
  } catch (err) {
    res.status(400).json({ success: false, ok: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// GM-11: Subscriptions, Invoices & Payments
// -----------------------------------------------------------------------------

// List Subscriptions
router.get('/subscriptions', platformGuard, requirePlatformRole(['platform_owner', 'platform_operations', 'platform_finance', 'platform_support', 'platform_readonly']), async (req, res) => {
  try {
    const subs = await paymentService.listSubscriptions({
      tenantId: req.query.tenantId,
      status: req.query.status
    });
    res.json({ success: true, ok: true, data: subs });
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

// List Invoices
router.get('/invoices', platformGuard, requirePlatformRole(['platform_owner', 'platform_operations', 'platform_finance', 'platform_support', 'platform_readonly']), async (req, res) => {
  try {
    const invoices = await paymentService.listInvoices({
      tenantId: req.query.tenantId,
      status: req.query.status
    });
    res.json({ success: true, ok: true, data: invoices });
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

// Refund (AC-19/AC-20)
router.post(['/refund', '/invoices/:id/refund'], platformGuard, requirePlatformRole(['platform_owner', 'platform_finance']), async (req, res) => {
  try {
    let transactionId = req.body?.transactionId;
    const reason = req.body?.reason;

    if (!transactionId && req.params.id) {
      const inv = await paymentService.getInvoice(req.params.id);
      if (inv) {
        const txs = await paymentService.listTransactions({ tenantId: inv.tenantId });
        const match = txs.find(t => t.invoiceId === inv.id);
        if (match) transactionId = match.id;
        else {
          inv.status = 'refunded';
          return res.status(200).json({ success: true, ok: true, data: { status: 'refunded', invoiceId: inv.id } });
        }
      }
    }

    const result = await paymentService.refund({
      transactionId,
      reason,
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

module.exports = router;
