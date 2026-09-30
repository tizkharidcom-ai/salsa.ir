// server/salsa/control-plane/routes/policy-routes.js
'use strict';

const express = require('express');
const router = express.Router();
const catalogService = require('../policy/catalog-service');
const grantService = require('../policy/grant-service');
const overrideService = require('../policy/override-service');
const evaluatorService = require('../policy/evaluator-service');
const publishService = require('../policy/publish-service');
const { authenticatePlatform, requirePlatformRole } = require('../auth/auth-middleware');
const { planModuleChange } = require('../../../server/salsa/module-control');

// Public or Authenticated Catalog Endpoint
router.get('/catalog', (req, res) => {
  const features = catalogService.getFeatures();
  res.json({
    ok: true,
    data: {
      featuresCount: features.length,
      modulesCount: catalogService.getModules().length,
      checksum: catalogService.getChecksum(),
      modules: catalogService.getModules(),
      features
    }
  });
});

// Live sync helper from SALSA Control Plane to WESTO Data Plane
async function syncToWesto(tenantId, featureKeyOrKeys, enabled) {
  try {
    const isProd = process.env.NODE_ENV === 'production';
    const cellUrl = process.env.WESTO_CELL_URL || `http://127.0.0.1:${process.env.WESTO_PORT || '4180'}`;
    const secret = process.env.SALSA_CONTROL_SECRET || process.env.NEEM_CONTROL_SECRET;

    if (!secret || secret.trim().length < 32) {
      console.error('[salsa-policy] FAIL-CLOSED: a 32-character SALSA_CONTROL_SECRET is required.');
      return { ok: false, status: 503, error: 'SALSA_CONTROL_SECRET_REQUIRED' };
    }

    const featureKeys = Array.isArray(featureKeyOrKeys) ? featureKeyOrKeys : [featureKeyOrKeys];
    const res = await fetch(`${cellUrl}/api/admin/features/toggle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SALSA-Control-Secret': secret.trim()
      },
      body: JSON.stringify({ tenantId, featureKey: featureKeys[0], featureKeys, enabled })
    });
    let responseBody = null;
    try { responseBody = await res.json(); } catch (_) {}
    return { ok: res.ok, status: res.status, responseBody };
  } catch (err) {
    console.warn(`[salsa-policy] syncToWesto failed: ${err.message}`);
    return { ok: false, status: 503, error: err.message };
  }
}

router.get('/modules', (_req, res) => {
  res.json({
    ok: true,
    data: {
      version: catalogService.currentVersion,
      checksum: catalogService.getChecksum(),
      modules: catalogService.getModules()
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
    await syncToWesto(tenantId, featureKey, true);
    res.status(201).json({ ok: true, data: grant });
  } catch (err) {
    const status = err.message.includes('DEPENDENCY_VIOLATION') ? 409 : 400;
    res.status(status).json({ ok: false, error: err.message });
  }
});

router.delete('/grants/:tenantId/:featureKey', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const { tenantId, featureKey } = req.params;
    const result = await grantService.revokeGrant({
      tenantId,
      featureKey,
      actorId: req.platformPrincipal.id,
      reason: req.body?.reason || 'OPERATOR_REVOKED'
    });
    await syncToWesto(tenantId, featureKey, false);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 1.1 Direct 1-Click Feature/Module Toggle
router.post('/toggle', requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support']), async (req, res) => {
  try {
    const { tenantId, featureKey, featureKeys, enabled, reason } = req.body || {};
    const keys = Array.isArray(featureKeys) && featureKeys.length > 0 ? featureKeys : (featureKey ? [featureKey] : []);
    if (!tenantId || keys.length === 0) {
      return res.status(400).json({ ok: false, error: 'tenantId and featureKey (or featureKeys) are required.' });
    }
    const isEnabled = Boolean(enabled);
    const syncResults = {};

    for (const key of keys) {
      if (isEnabled) {
        try {
          await grantService.issueGrant({
            tenantId,
            featureKey: key,
            grantKind: 'addon',
            durationMonths: 12,
            actorId: req.platformPrincipal.id,
            metadata: { toggledBy: req.platformPrincipal.id, reason: reason || 'Operator 1-click toggle' }
          });
        } catch (_) {}
        try {
          await overrideService.setOverride({
            tenantId,
            userId: 'all',
            permissionKey: key,
            state: 'allow',
            decisionReason: reason || 'تغییر وضعیت به فعال توسط اپراتور',
            actorId: req.platformPrincipal.id
          });
        } catch (_) {}
      } else {
        try {
          await grantService.revokeGrant({
            tenantId,
            featureKey: key,
            actorId: req.platformPrincipal.id,
            reason: reason || 'Operator 1-click toggle off'
          });
        } catch (_) {}
        try {
          await overrideService.setOverride({
            tenantId,
            userId: 'all',
            permissionKey: key,
            state: 'deny',
            decisionReason: reason || 'غیرفعال‌سازی ماژول توسط اپراتور',
            actorId: req.platformPrincipal.id
          });
        } catch (_) {}
      }

      syncResults[key] = (await syncToWesto(tenantId, key, isEnabled)).ok;
    }

    res.json({
      ok: true,
      data: {
        tenantId,
        featureKeys: keys,
        enabled: isEnabled,
        syncedToWesto: syncResults
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Canonical business-module control. Dependencies are applied in topological
// order and WESTO receives the complete change as one batch.
router.post('/modules/:moduleKey/state', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const { tenantId, enabled, reason, cascade = false } = req.body || {};
    if (!tenantId || typeof enabled !== 'boolean' || !reason || reason.trim().length < 5) {
      return res.status(422).json({ ok: false, error: 'tenantId, boolean enabled and reason (min 5 chars) are required.' });
    }

    const currentGrants = await grantService.listGrants(tenantId);
    const activeFeatureKeys = currentGrants.filter(grant => grant.isActive).map(grant => grant.featureKey);
    const plan = planModuleChange({
      moduleKey: req.params.moduleKey,
      enabled,
      activeFeatureKeys,
      cascade: Boolean(cascade)
    });

    const policyResults = [];
    for (const featureKey of plan.featureKeys) {
      if (enabled) {
        const grant = await grantService.issueGrant({
          tenantId,
          featureKey,
          grantKind: 'addon',
          durationMonths: null,
          actorId: req.platformPrincipal.id,
          metadata: { moduleKey: plan.module.key, reason: reason.trim(), source: 'module-control-v3' }
        });
        policyResults.push({ featureKey, action: 'granted', grantId: grant?.id || null });
      } else {
        const revoked = await grantService.revokeGrant({
          tenantId,
          featureKey,
          actorId: req.platformPrincipal.id,
          reason: reason.trim()
        });
        policyResults.push({ featureKey, action: 'revoked', revoked: revoked.revoked });
      }
      await overrideService.setOverride({
        tenantId,
        userId: 'all',
        permissionKey: featureKey,
        state: 'inherit',
        actorId: req.platformPrincipal.id
      });
    }

    const westoSync = await syncToWesto(tenantId, plan.featureKeys, enabled);
    const payload = {
      tenantId,
      moduleKey: plan.module.key,
      enabled,
      lifecycle: plan.module.lifecycle,
      featureKeys: plan.featureKeys,
      implicitFeatureKeys: plan.implicitFeatureKeys,
      affectedModules: plan.affectedModules,
      policyResults,
      syncedToWesto: westoSync.ok,
      sync: westoSync
    };

    if (!westoSync.ok) {
      return res.status(502).json({ ok: false, error: 'MODULE_SYNC_FAILED', data: payload });
    }
    return res.json({ ok: true, data: payload });
  } catch (err) {
    const status = err.message.startsWith('ACTIVE_DEPENDENTS') ? 409
      : err.message.startsWith('UNKNOWN_') || err.message.startsWith('MODULE_') ? 422
        : 500;
    return res.status(status).json({ ok: false, error: err.message });
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

// 3.1 Authoritative Effective Entitlements Evaluator (Prompt §44, §45)
router.get(['/effective', '/effective/:tenantId'], async (req, res) => {
  try {
    const tenantId = req.params.tenantId || req.query.tenantId || req.query.tenant_id;
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: 'tenantId is required' });
    }
    const tenantRepo = require('../db/database').getDatabase();
    let tenant = null;
    try {
      const tRes = await tenantRepo.query('SELECT * FROM neem_tenants WHERE id = $1', [tenantId]);
      tenant = tRes.rows?.[0] || null;
    } catch (_) {}

    const grants = await grantService.listGrants(tenantId);
    const overrides = await overrideService.listOverrides(tenantId);
    const killSwitches = Array.from(activeKillSwitches.values());
    const isSuspended = tenant?.status === 'suspended' || tenant?.status === 'cancelled';

    const effectiveFeatures = {};
    const catalog = catalogService.getFeatures();
    const version = `ent_${tenantId}_${Date.now()}`;
    const effectiveFrom = new Date().toISOString();

    for (const feat of catalog) {
      const key = feat.key;
      const ks = killSwitches.find(k => (k.featureKey === key || k.featureKeys?.includes(key)) && k.status === 'active');
      const grant = grants.find(g => g.featureKey === key && g.status === 'active');
      const override = overrides.find(o => o.permissionKey === key);

      let enabled = false;
      let reason = 'غیرفعال در لایسنس تجاری';
      let source = 'catalog';

      if (ks) {
        enabled = false;
        reason = `توقف اضطراری پلتفرم: ${ks.reason}`;
        source = 'killswitch';
      } else if (isSuspended) {
        enabled = false;
        reason = 'سرویس مجموعه معلق است';
        source = 'tenant_suspension';
      } else if (override && override.state === 'deny') {
        enabled = false;
        reason = override.decisionReason || 'منع شخصی صریح';
        source = 'override_deny';
      } else if (override && override.state === 'allow') {
        enabled = true;
        reason = override.decisionReason || 'اجازه اختصاصی اپراتور';
        source = 'override_allow';
      } else if (grant) {
        enabled = true;
        reason = grant.grantKind === 'addon' ? 'افزونه فعال تجاری (Add-on)' : 'لایسنس اعطا شده';
        source = 'grant';
      } else if (feat.priceMonthly === 0) {
        enabled = true;
        reason = 'قابلیت پایه رایگان پلتفرم';
        source = 'base_plan';
      }

      effectiveFeatures[key] = {
        key,
        name: feat.name,
        category: feat.category,
        enabled,
        reason,
        source,
        effectiveFrom,
        version
      };
    }

    res.json({
      ok: true,
      data: {
        tenantId,
        tenantStatus: tenant?.status || 'active',
        isSuspended,
        version,
        effectiveFrom,
        features: effectiveFeatures
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
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
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 5. Canonical Platform Kill Switch (Phase 1.3)
const activeKillSwitches = new Map();

router.get('/killswitch', async (req, res) => {
  res.json({
    ok: true,
    data: Array.from(activeKillSwitches.values())
  });
});

router.post('/killswitch', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const { featureKey, moduleKey, scope = 'global', reason, severity = 'high', expiresAt, affectedTenantCount = 0 } = req.body || {};
    const requestedKey = moduleKey || featureKey;
    const module = catalogService.getModule(requestedKey);
    const featureKeys = module ? module.technicalFeatures : (featureKey ? [featureKey] : []);
    if (!requestedKey || !reason || featureKeys.length === 0 || featureKeys.some(key => !catalogService.getFeature(key))) {
      return res.status(400).json({ ok: false, error: 'A valid moduleKey/featureKey and reason are mandatory for platform kill switch.' });
    }
    const id = `ks_${requestedKey}_${Date.now()}`;
    const killSwitch = {
      id,
      featureKey: module ? null : featureKey,
      moduleKey: module?.key || null,
      featureKeys,
      scope,
      reason,
      severity,
      createdBy: req.platformPrincipal?.id || 'operator',
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      status: 'active',
      affectedTenantCount: Number(affectedTenantCount) || 1,
      approvalState: severity === 'critical' ? 'approved' : 'auto_approved'
    };
    activeKillSwitches.set(requestedKey, killSwitch);

    // Sync kill switch to WESTO as disabled
    const sync = await syncToWesto('westo', featureKeys, false);
    if (!sync.ok) return res.status(502).json({ ok: false, error: 'KILLSWITCH_SYNC_FAILED', data: { ...killSwitch, sync } });

    res.status(201).json({
      ok: true,
      data: killSwitch
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/killswitch/:featureKey', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const { featureKey } = req.params;
    const existing = activeKillSwitches.get(featureKey);
    const featureKeys = existing?.featureKeys || [featureKey];
    const sync = await syncToWesto('westo', featureKeys, true);
    if (!sync.ok) return res.status(502).json({ ok: false, error: 'KILLSWITCH_RESTORE_SYNC_FAILED', data: { featureKey, sync } });
    activeKillSwitches.delete(featureKey);
    res.json({ ok: true, data: { revoked: true, featureKey, featureKeys, syncedToWesto: true } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Platform Security Policy & Lockdown Routes
let platformSecurityPolicy = {
  mfaEnforcement: 'all_admins',
  sessionTimeoutMinutes: 30,
  ipAllowlistEnabled: false,
  ipAllowlist: [],
  tlsStrict: true,
  auditLogRetentionDays: 90,
  passwordPolicy: 'strong',
  updatedAt: new Date().toISOString()
};

router.get('/security', requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support', 'platform_readonly']), async (req, res) => {
  res.json({ ok: true, data: platformSecurityPolicy });
});

router.post('/security', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    platformSecurityPolicy = {
      ...platformSecurityPolicy,
      ...req.body,
      updatedAt: new Date().toISOString(),
      updatedBy: req.platformPrincipal?.id || 'operator'
    };
    res.json({ ok: true, data: platformSecurityPolicy });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/lockdown', requirePlatformRole(['platform_owner']), async (req, res) => {
  try {
    const { reason } = req.body || {};
    res.json({
      ok: true,
      data: {
        lockdownId: 'lck_' + Date.now(),
        status: 'active',
        reason: reason || 'Emergency security lockdown',
        activatedAt: new Date().toISOString(),
        activatedBy: req.platformPrincipal?.id || 'platform_owner'
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
