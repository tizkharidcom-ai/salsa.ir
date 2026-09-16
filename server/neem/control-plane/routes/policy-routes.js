// server/neem/control-plane/routes/policy-routes.js
'use strict';

const express = require('express');
const router = express.Router();
const catalogService = require('../policy/catalog-service');
const grantService = require('../policy/grant-service');
const overrideService = require('../policy/override-service');
const evaluatorService = require('../policy/evaluator-service');
const publishService = require('../policy/publish-service');
const { authenticatePlatform, requirePlatformRole } = require('../auth/auth-middleware');

// Public or Authenticated Catalog Endpoint
router.get('/catalog', (req, res) => {
  const features = catalogService.getFeatures();
  res.json({
    ok: true,
    data: {
      featuresCount: features.length,
      checksum: catalogService.getChecksum(),
      features
    }
  });
});

// Require platform auth for management endpoints
router.use(authenticatePlatform);

// 1. Commercial Grants
router.get('/grants/:tenantId', async (req, res) => {
  try {
    const grants = await grantService.listGrants(req.params.tenantId);
    res.json({ ok: true, data: grants });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/grants', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const { tenantId, featureKey, grantKind, durationMonths, metadata } = req.body;
    const grant = await grantService.issueGrant({
      tenantId,
      featureKey,
      grantKind,
      durationMonths,
      actorId: req.platformPrincipal.id,
      metadata
    });
    res.status(201).json({ ok: true, data: grant });
  } catch (err) {
    const status = err.message.includes('DEPENDENCY_VIOLATION') ? 409 : 400;
    res.status(status).json({ ok: false, error: err.message });
  }
});

// 2. Personal Overrides (Allow / Deny / Inherit)
router.get('/overrides/:tenantId', async (req, res) => {
  try {
    const { userId } = req.query;
    const overrides = await overrideService.listOverrides(req.params.tenantId, userId);
    res.json({ ok: true, data: overrides });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/overrides', requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support']), async (req, res) => {
  try {
    const { tenantId, userId, permissionKey, state, decisionReason } = req.body;
    const result = await overrideService.setOverride({
      tenantId,
      userId,
      permissionKey,
      state,
      decisionReason,
      actorId: req.platformPrincipal.id
    });
    res.status(200).json({ ok: true, data: result });
  } catch (err) {
    const status = err.message.includes('REASON_REQUIRED') ? 422 : 400;
    res.status(status).json({ ok: false, error: err.message });
  }
});

// 3. Explainable Policy Evaluator & Simulator
router.post('/evaluate', async (req, res) => {
  try {
    let context = Object.assign({}, req.body || {});
    if (!context.tenant && context.tenantId) {
      context.tenant = {
        id: context.tenantId,
        status: context.tenantStatus || 'active',
        displayName: context.tenantName || context.tenantId
      };
    }
    if (!context.identity) {
      const actor = context.actor || {};
      context.identity = {
        id: context.userId || actor.id || 'usr_sim_01',
        role: context.actorRole || context.role || actor.role || 'owner',
        status: context.userStatus || actor.status || 'active',
        name: context.userName || actor.name || context.userId || 'کاربر شبیه‌ساز'
      };
    }
    const evaluation = await evaluatorService.evaluateAccess(context);
    res.json({ ok: true, data: evaluation });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// 4. Policy Snapshot Publishing & Outbox ACK
router.post('/publish', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const { tenantId, targetCell } = req.body;
    const published = await publishService.publishPolicySnapshot({
      tenantId,
      publishedBy: req.platformPrincipal.id,
      targetCell
    });
    res.status(201).json({ ok: true, data: published });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/outbox', async (req, res) => {
  try {
    const { tenantId } = req.query;
    const items = await publishService.listOutbox(tenantId);
    res.json({ ok: true, data: items });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/outbox/:id/ack', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const success = await publishService.acknowledgeDistribution(req.params.id);
    res.json({ ok: true, data: { acknowledged: success } });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
