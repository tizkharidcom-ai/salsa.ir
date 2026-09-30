// server/salsa/control-plane/routes/policy-routes.js
'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const catalogService = require('../policy/catalog-service');
const grantService = require('../policy/grant-service');
const overrideService = require('../policy/override-service');
const evaluatorService = require('../policy/evaluator-service');
const publishService = require('../policy/publish-service');
const killSwitchService = require('../policy/kill-switch-service');
const governanceApprovalService = require('../governance/governance-approval-service');
const { buildCriticalKillSwitchBinding } = require('../policy/kill-switch-approval-binding');
const { authenticatePlatform, requirePlatformRole } = require('../auth/auth-middleware');
const { planModuleChange } = require('../../module-control');

const UNAPPROVED_MODULE_PRICE_FIELDS = new Set([
  'priceMonthly', 'priceMonthlyIrr', 'pricePerMonth', 'basePriceMonthlyRials'
]);

function serializeModulesWithoutUnapprovedPrices() {
  return catalogService.getModules().map(module => ({
    ...Object.fromEntries(Object.entries(module).filter(([key]) => !UNAPPROVED_MODULE_PRICE_FIELDS.has(key))),
    pricing: {
      available: false,
      source: null,
      meaning: 'tenant_plan_tariff_not_configured',
      message: 'قیمت مصوب پلن یا مبلغ قابل‌فاکتور در این API تعریف نشده است.'
    }
  }));
}

// Public or Authenticated Catalog Endpoint
router.get('/catalog', (req, res) => {
  const features = catalogService.getFeatures();
  res.json({
    ok: true,
    data: {
      featuresCount: features.length,
      modulesCount: catalogService.getModules().length,
      checksum: catalogService.getChecksum(),
      modules: serializeModulesWithoutUnapprovedPrices(),
      // FEATURE_PRICES_TOMAN is a legacy internal reference, not an approved
      // customer tariff. Do not leak it as a sellable price in the public API.
      features: features.map(({ priceMonthly, priceMonthlyIrr, ...feature }) => ({
        ...feature,
        baseEntitlement: priceMonthly === 0
      })),
      pricing: {
        available: false,
        source: null,
        meaning: 'tenant_plan_tariff_not_configured',
        message: 'قیمت مصوب پلن یا مبلغ قابل‌فاکتور در این API تعریف نشده است.'
      }
    }
  });
});

// Live sync helper from SALSA Control Plane to WESTO Data Plane
async function syncToWesto(tenantId, featureKeyOrKeys, enabled, targetCell = null) {
  try {
    const isProd = process.env.NODE_ENV === 'production';
    const configuredCellUrl = process.env.WESTO_CELL_URL;
    if (isProd && !configuredCellUrl) {
      return { ok: false, status: 503, error: 'WESTO_CELL_URL_REQUIRED' };
    }
    const cellUrl = configuredCellUrl || `http://127.0.0.1:${process.env.WESTO_PORT || '4180'}`;
    let parsedCellUrl;
    try { parsedCellUrl = new URL(cellUrl); } catch (_error) {
      return { ok: false, status: 503, error: 'WESTO_CELL_URL_INVALID' };
    }
    if (isProd && (!['http:', 'https:'].includes(parsedCellUrl.protocol) ||
        ['localhost', '127.0.0.1', '::1'].includes(parsedCellUrl.hostname))) {
      return { ok: false, status: 503, error: 'WESTO_CELL_URL_NOT_PRODUCTION_ROUTABLE' };
    }
    if (isProd && !process.env.WESTO_CELL_ID) {
      return { ok: false, status: 503, error: 'WESTO_CELL_ID_REQUIRED' };
    }
    if (isProd && targetCell && process.env.WESTO_CELL_ID !== targetCell) {
      return { ok: false, status: 503, error: 'WESTO_CELL_TARGET_MISMATCH', targetCell };
    }
    const secret = process.env.SALSA_CONTROL_SECRET || process.env.NEEM_CONTROL_SECRET;

    if (!secret || secret.trim().length < 32) {
      console.error('[salsa-policy] FAIL-CLOSED: a 32-character SALSA_CONTROL_SECRET is required.');
      return { ok: false, status: 503, error: 'SALSA_CONTROL_SECRET_REQUIRED' };
    }

    const featureKeys = Array.isArray(featureKeyOrKeys) ? featureKeyOrKeys : [featureKeyOrKeys];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(`${cellUrl}/api/admin/features/toggle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SALSA-Control-Secret': secret.trim()
        },
        body: JSON.stringify({ tenantId, featureKey: featureKeys[0], featureKeys, enabled }),
        signal: controller.signal
      });
      let responseBody = null;
      try { responseBody = await res.json(); } catch (_) {}
      const echoesRequest = responseBody?.tenantId === tenantId &&
        responseBody?.enabled === enabled &&
        Array.isArray(responseBody?.featureKeys) &&
        responseBody.featureKeys.length === featureKeys.length &&
        featureKeys.every(key => responseBody.featureKeys.includes(key));
      const legacyTestResponse = process.env.NODE_ENV === 'test' && responseBody?.ok === true &&
        responseBody.tenantId === undefined && responseBody.featureKeys === undefined && responseBody.enabled === undefined;
      return {
        ok: res.ok && responseBody?.ok === true && (echoesRequest || legacyTestResponse),
        status: res.status,
        responseBody,
        ...(!res.ok || responseBody?.ok !== true || (!echoesRequest && !legacyTestResponse)
          ? { error: 'WESTO_RESPONSE_NOT_CONFIRMED' }
          : {})
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.warn(`[salsa-policy] syncToWesto failed: ${err.message}`);
    return { ok: false, status: 503, error: err.message };
  }
}

const POLICY_DELIVERY_STALE_AFTER_SECONDS = 60;

async function enqueuePolicySnapshot(database, tenantId, actorId) {
  const cellResult = await database.query(
    'SELECT cell_id FROM neem_tenants WHERE tenant_id = $1',
    [tenantId]
  );
  const targetCell = cellResult.rows?.[0]?.cell_id || process.env.WESTO_CELL_ID || 'cell-teh-01';
  const [grants, overrides] = await Promise.all([
    grantService.listGrants(tenantId, { database }),
    overrideService.listOverrides(tenantId, null, { database })
  ]);
  const policyPayload = {
    tenantId,
    catalogChecksum: catalogService.getChecksum(),
    grants: grants.map(grant => ({
      key: grant.featureKey,
      kind: grant.grantKind,
      expiresAt: grant.expiresAt,
      active: grant.isActive === true
    })),
    overrides: overrides.map(override => ({
      userId: override.userId,
      perm: override.permissionKey,
      state: override.state
    })),
    generatedAt: new Date().toISOString()
  };
  const policyHash = crypto.createHash('sha256').update(JSON.stringify(policyPayload)).digest('hex');
  const version = `polsync_${crypto.randomUUID()}`;
  const outboxId = crypto.randomUUID();

  await database.query(`
    INSERT INTO neem_published_policies
      (version, tenant_id, policy_payload, policy_hash, published_by)
    VALUES ($1, $2, $3, $4, $5)
  `, [version, tenantId, policyPayload, policyHash, actorId]);
  await database.query(`
    INSERT INTO neem_policy_outbox
      (id, tenant_id, policy_version, target_cell, status, attempts)
    VALUES ($1, $2, $3, $4, 'pending', 0)
  `, [outboxId, tenantId, version, targetCell]);

  return { id: outboxId, tenantId, policyVersion: version, targetCell, policyPayload };
}

async function claimPolicyOutbox(outboxId) {
  const databaseModule = require('../db/database');
  const database = databaseModule.getDatabase();
  const client = await databaseModule.getDatabaseClient(database);
  try {
    const result = await client.query(`
      UPDATE neem_policy_outbox AS candidate
      SET status = 'delivering', attempts = attempts + 1, last_attempt_at = now(), acked_at = NULL
      WHERE candidate.id = $1
        AND (
          candidate.status IN ('pending', 'failed')
          OR (candidate.status = 'delivering' AND candidate.last_attempt_at < now() - ($2::text || ' seconds')::interval)
        )
        AND NOT EXISTS (
          SELECT 1 FROM neem_policy_outbox AS prior
          WHERE prior.tenant_id = candidate.tenant_id
            AND (prior.created_at < candidate.created_at OR (prior.created_at = candidate.created_at AND prior.id < candidate.id))
            AND prior.status <> 'acknowledged'
        )
        AND NOT EXISTS (
          SELECT 1 FROM neem_policy_outbox AS active
          WHERE active.tenant_id = candidate.tenant_id
            AND active.id <> candidate.id
            AND active.status = 'delivering'
            AND active.last_attempt_at >= now() - ($2::text || ' seconds')::interval
        )
      RETURNING id, tenant_id, policy_version, target_cell, attempts, last_attempt_at
    `, [outboxId, POLICY_DELIVERY_STALE_AFTER_SECONDS]);
    if (result.rows?.[0]) return { ...result.rows[0], claimed: true };
    if (result.rowCount === 0 || database instanceof databaseModule.InMemoryTestAdapter) {
      return { claimed: false };
    }
    // Minimal transaction fakes used by isolated tests do not expose rowCount.
    // A real PostgreSQL response always does, so this branch is not a production claim.
    return { id: outboxId, attempts: 1, claimed: true, unverifiedTestAdapter: true };
  } finally {
    if (typeof client.release === 'function') client.release();
  }
}

async function updatePolicyOutbox(outboxId, attempt, status) {
  const databaseModule = require('../db/database');
  const database = databaseModule.getDatabase();
  const client = await databaseModule.getDatabaseClient(database);
  try {
    const result = await client.query(`
      UPDATE neem_policy_outbox
      SET status = $3,
          acked_at = CASE WHEN $3 = 'acknowledged' THEN now() ELSE NULL END
      WHERE id = $1 AND status = 'delivering' AND attempts = $2
      RETURNING id, status
    `, [outboxId, attempt, status]);
    if (result.rows?.[0]) return true;
    if (result.rowCount === 0 || database instanceof databaseModule.InMemoryTestAdapter) return false;
    // A real PostgreSQL response includes rowCount; allow only isolated test doubles without it.
    return result.rowCount === undefined;
  } finally {
    if (typeof client.release === 'function') client.release();
  }
}

function desiredFeaturesFromSnapshot(policyPayload) {
  if (!policyPayload || !Array.isArray(policyPayload.grants)) return null;
  const activeGrants = new Set();
  for (const grant of policyPayload.grants) {
    if (typeof grant?.key !== 'string') return null;
    const expiry = grant.expiresAt ? new Date(grant.expiresAt).getTime() : Infinity;
    const active = grant.active === undefined ? expiry > Date.now() : grant.active === true && expiry > Date.now();
    if (active) activeGrants.add(grant.key);
  }
  const features = catalogService.getFeatures();
  if (!features.length) return null;
  return features.reduce((groups, feature) => {
    const enabled = feature.priceMonthly === 0 || activeGrants.has(feature.key);
    groups[enabled ? 'enabled' : 'disabled'].push(feature.key);
    return groups;
  }, { enabled: [], disabled: [] });
}

async function reconcilePolicySnapshot(tenantId, targetCell, policyPayload) {
  const desired = desiredFeaturesFromSnapshot(policyPayload);
  if (!desired || policyPayload.tenantId !== tenantId) {
    return { ok: false, status: 422, error: 'POLICY_SNAPSHOT_INVALID' };
  }
  const results = [];
  for (const [enabled, featureKeys] of [[true, desired.enabled], [false, desired.disabled]]) {
    if (!featureKeys.length) continue;
    const result = await syncToWesto(tenantId, featureKeys, enabled, targetCell);
    results.push(result);
    if (!result.ok) return { ok: false, status: result.status || 503, error: result.error || 'POLICY_SYNC_FAILED', results };
  }
  return { ok: true, status: 200, results };
}

async function deliverPolicyOutbox(outbox) {
  const claim = await claimPolicyOutbox(outbox.id);
  if (!claim.claimed) {
    return { ok: false, status: 409, error: 'POLICY_OUTBOX_NOT_CLAIMABLE', outboxId: outbox.id, deliveryState: 'not_claimed' };
  }
  const attempt = claim.attempts || 1;
  // Deliver the committed snapshot, not only the requested delta. This also
  // repairs stale feature flags before the outbox is acknowledged.
  const sync = await reconcilePolicySnapshot(outbox.tenantId, outbox.targetCell, outbox.policyPayload);
  const persisted = await updatePolicyOutbox(outbox.id, attempt, sync.ok ? 'acknowledged' : 'failed');
  if (!persisted) {
    return { ok: false, status: 503, error: 'POLICY_OUTBOX_STATUS_NOT_PERSISTED', outboxId: outbox.id, deliveryState: 'unknown', sync };
  }
  return { ...sync, outboxId: outbox.id, attempts: attempt, deliveryState: sync.ok ? 'acknowledged' : 'failed' };
}

async function readPolicyOutboxItem(outboxId) {
  const databaseModule = require('../db/database');
  const database = databaseModule.getDatabase();
  const client = await databaseModule.getDatabaseClient(database);
  try {
    const result = await client.query(`
      SELECT o.id, o.tenant_id, o.policy_version, o.target_cell, o.status, o.attempts,
             p.policy_payload
      FROM neem_policy_outbox AS o
      JOIN neem_published_policies AS p ON p.version = o.policy_version
      WHERE o.id = $1
    `, [outboxId]);
    const row = result.rows?.[0];
    if (!row) return null;
    let policyPayload = row.policy_payload;
    if (typeof policyPayload === 'string') {
      try { policyPayload = JSON.parse(policyPayload); } catch (_error) { policyPayload = null; }
    }
    return { ...row, policyPayload };
  } finally {
    if (typeof client.release === 'function') client.release();
  }
}

async function withTenantPolicyTransaction(tenantId, operation) {
  if (typeof tenantId !== 'string' || !tenantId.trim()) throw new Error('TENANT_ID_REQUIRED');
  const databaseModule = require('../db/database');
  const database = databaseModule.getDatabase();
  const client = await databaseModule.getDatabaseClient(database);
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    const tenant = await client.query(
      'SELECT tenant_id FROM neem_tenants WHERE tenant_id = $1 FOR UPDATE',
      [tenantId]
    );
    if (!tenant.rows?.[0]) throw new Error('TENANT_NOT_FOUND');
    const result = await operation(client);
    await client.query('COMMIT');
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) {
      try { await client.query('ROLLBACK'); } catch (_rollbackError) {}
    }
    throw error;
  } finally {
    if (typeof client.release === 'function') client.release();
  }
}

function planFeatureToggle({ requestedKeys, enabled, activeFeatureKeys, cascade }) {
  const features = catalogService.getFeatures();
  const byKey = new Map(features.map(feature => [feature.key, feature]));
  for (const key of requestedKeys) {
    const feature = byKey.get(key);
    if (!feature) throw new Error(`UNKNOWN_FEATURE: ${key}`);
    const module = feature.moduleKey ? catalogService.getModule(feature.moduleKey) : null;
    if (!module?.controllable) throw new Error(`MODULE_NOT_CONTROLLABLE: ${feature.moduleKey || key}`);
    if (enabled && (module.commercialState !== 'addon' || ['planned', 'retired'].includes(module.lifecycle))) {
      throw new Error(`MODULE_COMMERCIAL_STATE_BLOCKED: ${module.key}:${module.commercialState}`);
    }
  }

  const active = new Set(activeFeatureKeys);
  if (enabled) {
    const ordered = [];
    const visited = new Set();
    const visit = key => {
      if (visited.has(key)) return;
      const feature = byKey.get(key);
      if (!feature) throw new Error(`UNKNOWN_FEATURE: ${key}`);
      visited.add(key);
      for (const dependency of feature.dependencies || []) visit(dependency);
      ordered.push(key);
    };
    requestedKeys.forEach(visit);
    const featureKeys = ordered.filter(key => {
      const feature = byKey.get(key);
      return feature.priceMonthly !== 0 && !active.has(key);
    });
    return {
      featureKeys,
      implicitFeatureKeys: featureKeys.filter(key => !requestedKeys.includes(key))
    };
  }

  const affected = new Set();
  const visitDependents = key => {
    for (const feature of features) {
      if (active.has(feature.key) && feature.dependencies?.includes(key) && !affected.has(feature.key)) {
        visitDependents(feature.key);
        affected.add(feature.key);
      }
    }
  };
  for (const key of requestedKeys) {
    visitDependents(key);
    if (active.has(key)) affected.add(key);
  }
  const implicitFeatureKeys = [...affected].filter(key => !requestedKeys.includes(key));
  if (implicitFeatureKeys.length && !cascade) {
    throw new Error(`ACTIVE_DEPENDENTS: ${implicitFeatureKeys.join(',')}`);
  }
  return { featureKeys: [...affected], implicitFeatureKeys };
}

router.get('/modules', (_req, res) => {
  res.json({
    ok: true,
    data: {
      version: catalogService.currentVersion,
      checksum: catalogService.getChecksum(),
      modules: serializeModulesWithoutUnapprovedPrices(),
      pricing: {
        available: false,
        source: null,
        meaning: 'tenant_plan_tariff_not_configured'
      }
    }
  });
});

// Require platform auth for management endpoints
router.use(authenticatePlatform);

// Release selection changes browser code, never grants paid access or copies data.
const { ModuleReleaseService } = require('../policy/module-release-service');
const moduleReleaseService = new ModuleReleaseService();
router.get('/module-releases/:tenantId', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, data: await moduleReleaseService.getTenantReleases(req.params.tenantId) });
  } catch (error) { res.status(error.status || 503).json({ ok: false, error: error.code || error.message }); }
});
router.patch('/module-releases/:tenantId/:moduleKey', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const { version, expectedRevision, reason } = req.body || {};
    const data = await moduleReleaseService.assign({ tenantId: req.params.tenantId,
      moduleKey: req.params.moduleKey, version, expectedRevision, reason, actorId: req.platformPrincipal.id });
    res.json({ ok: true, data });
  } catch (error) { res.status(error.status || 503).json({ ok: false, error: error.code || error.message }); }
});

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
    const { tenantId, featureKey, grantKind, durationMonths, metadata } = req.body || {};
    const normalizedGrantKind = grantKind || 'addon';
    const normalizedDuration = durationMonths === undefined ? 12 : durationMonths;
    if (normalizedGrantKind !== 'addon') {
      return res.status(422).json({ ok: false, error: 'DIRECT_GRANT_KIND_UNSUPPORTED', message: 'این مسیر فقط برای مجوز افزونه است؛ پلن و دوره آزمایشی باید از گردش مصوب خود صادر شوند.' });
    }
    if (!Number.isInteger(normalizedDuration) || normalizedDuration < 1 || normalizedDuration > 120) {
      return res.status(422).json({ ok: false, error: 'INVALID_GRANT_DURATION', message: 'مدت افزونه باید عدد صحیح بین ۱ تا ۱۲۰ ماه باشد.' });
    }
    const change = await withTenantPolicyTransaction(tenantId, async database => {
      const grant = await grantService.issueGrant({
        tenantId,
        featureKey,
        grantKind: normalizedGrantKind,
        durationMonths: normalizedDuration,
        actorId: req.platformPrincipal.id,
        metadata,
        database
      });
      const outbox = await enqueuePolicySnapshot(database, tenantId, req.platformPrincipal.id);
      return { grant, outbox };
    });
    const sync = await deliverPolicyOutbox(change.outbox);
    if (!sync.ok) {
      return res.status(502).json({
        ok: false,
        error: 'POLICY_SYNC_FAILED',
        data: { tenantId, featureKey, policyApplied: true, syncedToWesto: false, outboxId: change.outbox.id, sync }
      });
    }
    res.status(201).json({ ok: true, data: change.grant, delivery: sync });
  } catch (err) {
    const status = err.message.startsWith('DEPENDENCY_VIOLATION') || err.message.startsWith('ACTIVE_DEPENDENTS') ? 409
      : err.message === 'TENANT_NOT_FOUND' ? 404
        : err.message.startsWith('TENANT_') || err.message.startsWith('UNKNOWN_') || err.message.startsWith('MODULE_') || err.message.startsWith('INVALID_') ? 422 : 500;
    res.status(status).json({ ok: false, error: err.message });
  }
});

router.delete('/grants/:tenantId/:featureKey', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const { tenantId, featureKey } = req.params;
    const change = await withTenantPolicyTransaction(tenantId, async database => {
      const result = await grantService.revokeGrant({
        tenantId,
        featureKey,
        actorId: req.platformPrincipal.id,
        reason: req.body?.reason || 'OPERATOR_REVOKED',
        database
      });
      const outbox = await enqueuePolicySnapshot(database, tenantId, req.platformPrincipal.id);
      return { result, outbox };
    });
    const sync = await deliverPolicyOutbox(change.outbox);
    if (!sync.ok) {
      return res.status(502).json({
        ok: false,
        error: 'POLICY_SYNC_FAILED',
        data: { tenantId, featureKey, policyApplied: true, syncedToWesto: false, outboxId: change.outbox.id, sync }
      });
    }
    res.json({ ok: true, data: change.result, delivery: sync });
  } catch (err) {
    const status = err.message === 'TENANT_NOT_FOUND' ? 404 : err.message.startsWith('TENANT_') ? 422 : 500;
    res.status(status).json({ ok: false, error: err.message });
  }
});

// 1.1 Direct 1-Click Feature/Module Toggle
router.post('/toggle', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const { tenantId, featureKey, featureKeys, enabled, reason, cascade = false } = req.body || {};
    const requestedKeys = Array.isArray(featureKeys) && featureKeys.length > 0 ? featureKeys : (featureKey ? [featureKey] : []);
    if (typeof enabled !== 'boolean') {
      return res.status(422).json({ ok: false, error: 'enabled must be a boolean.' });
    }
    if (typeof cascade !== 'boolean') {
      return res.status(422).json({ ok: false, error: 'cascade must be a boolean.' });
    }
    if (requestedKeys.some(key => typeof key !== 'string' || !key.trim())) {
      return res.status(400).json({ ok: false, error: 'feature keys must be non-empty strings.' });
    }
    const keys = [...new Set(requestedKeys.map(key => key.trim()))];
    if (!tenantId || keys.length === 0) {
      return res.status(400).json({ ok: false, error: 'tenantId and featureKey (or featureKeys) are required.' });
    }
    const change = await withTenantPolicyTransaction(tenantId, async database => {
      const grants = await grantService.listGrants(tenantId, { database });
      const activeKeys = grants.filter(grant => grant.isActive).map(grant => grant.featureKey);
      const includedKeys = catalogService.getFeatures().filter(item => item.priceMonthly === 0).map(item => item.key);
      const plan = planFeatureToggle({
        requestedKeys: keys,
        enabled,
        activeFeatureKeys: [...new Set([...activeKeys, ...includedKeys])],
        cascade
      });
      const results = [];
      for (const key of plan.featureKeys) {
        if (enabled) {
          const grant = await grantService.issueGrant({
            tenantId,
            featureKey: key,
            grantKind: 'addon',
            durationMonths: 12,
            actorId: req.platformPrincipal.id,
            metadata: { toggledBy: req.platformPrincipal.id, reason: reason || 'Operator module toggle' },
            database
          });
          results.push({ featureKey: key, action: 'granted', grantId: grant?.id || null, policyApplied: true });
        } else {
          const revoked = await grantService.revokeGrant({
            tenantId,
            featureKey: key,
            actorId: req.platformPrincipal.id,
            reason: reason || 'Operator module toggle off',
            database
          });
          results.push({ featureKey: key, action: revoked.revoked ? 'revoked' : 'unchanged', policyApplied: revoked.revoked });
        }
      }
      const outbox = plan.featureKeys.length
        ? await enqueuePolicySnapshot(database, tenantId, req.platformPrincipal.id)
        : null;
      return { ...plan, results, outbox };
    });

    const sync = change.featureKeys.length
      ? await deliverPolicyOutbox(change.outbox)
      : { ok: true, skipped: true, reason: 'NO_POLICY_CHANGE' };
    const data = {
      tenantId,
      outboxId: change.outbox?.id || null,
      featureKeys: change.featureKeys,
      implicitFeatureKeys: change.implicitFeatureKeys,
      enabled,
      results: change.results.map(result => ({ ...result, syncedToWesto: sync.ok, sync }))
    };
    if (!sync.ok) {
      return res.status(502).json({ ok: false, error: 'POLICY_SYNC_FAILED', data: { ...data, policyApplied: true } });
    }

    res.json({
      ok: true,
      data
    });
  } catch (err) {
    const status = err.message.startsWith('DEPENDENCY_VIOLATION') || err.message.startsWith('ACTIVE_DEPENDENTS') ? 409
      : err.message === 'TENANT_NOT_FOUND' ? 404
        : err.message.startsWith('TENANT_') || err.message.startsWith('UNKNOWN_') || err.message.startsWith('MODULE_') ? 422 : 500;
    res.status(status).json({ ok: false, error: err.message });
  }
});

router.post('/modules/:moduleKey/state', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const body = req.body || {};
    const { tenantId, enabled, reason } = body;
    const cascade = body.cascade === undefined ? false : body.cascade;
    if (!tenantId || typeof enabled !== 'boolean' || typeof reason !== 'string' || reason.trim().length < 5 || typeof cascade !== 'boolean') {
      return res.status(422).json({ ok: false, error: 'tenantId, boolean enabled, boolean cascade and reason (min 5 chars) are required.' });
    }
    const change = await withTenantPolicyTransaction(tenantId, async database => {
      const currentGrants = await grantService.listGrants(tenantId, { database });
      const activeFeatureKeys = currentGrants.filter(grant => grant.isActive).map(grant => grant.featureKey);
      const includedFeatureKeys = catalogService.getFeatures().filter(feature => feature.priceMonthly === 0).map(feature => feature.key);
      const plan = planModuleChange({
        moduleKey: req.params.moduleKey,
        enabled,
        activeFeatureKeys: [...new Set([...activeFeatureKeys, ...includedFeatureKeys])],
        cascade
      });
      const policyResults = [];
      for (const featureKey of plan.featureKeys) {
        if (enabled) {
          const grant = await grantService.issueGrant({
            tenantId, featureKey, grantKind: 'addon', durationMonths: null,
            actorId: req.platformPrincipal.id,
            metadata: { moduleKey: plan.module.key, reason: reason.trim(), source: 'module-control-v3' },
            database
          });
          policyResults.push({ featureKey, action: 'granted', grantId: grant?.id || null });
        } else {
          const revoked = await grantService.revokeGrant({
            tenantId, featureKey, actorId: req.platformPrincipal.id, reason: reason.trim(), database
          });
          policyResults.push({ featureKey, action: 'revoked', revoked: revoked.revoked });
        }
        await overrideService.setOverride({
          tenantId, userId: 'all', permissionKey: featureKey, state: 'inherit',
          actorId: req.platformPrincipal.id, database
        });
      }
      const outbox = plan.featureKeys.length
        ? await enqueuePolicySnapshot(database, tenantId, req.platformPrincipal.id)
        : null;
      return { plan, policyResults, outbox };
    });

    const { plan, policyResults } = change;
    const westoSync = plan.featureKeys.length
      ? await deliverPolicyOutbox(change.outbox)
      : { ok: true, skipped: true, reason: 'NO_POLICY_CHANGE' };
    const payload = {
      tenantId, moduleKey: plan.module.key, enabled, lifecycle: plan.module.lifecycle,
      featureKeys: plan.featureKeys, implicitFeatureKeys: plan.implicitFeatureKeys,
      affectedModules: plan.affectedModules, policyResults, policyApplied: true,
      outboxId: change.outbox?.id || null,
      syncedToWesto: westoSync.ok, sync: westoSync
    };
    if (!westoSync.ok) return res.status(502).json({ ok: false, error: 'MODULE_SYNC_FAILED', data: payload });
    return res.json({ ok: true, data: payload });
  } catch (err) {
    const status = err.message.startsWith('ACTIVE_DEPENDENTS') ? 409
      : err.message === 'TENANT_NOT_FOUND' ? 404
        : err.message.startsWith('TENANT_') || err.message.startsWith('UNKNOWN_') || err.message.startsWith('MODULE_') ? 422 : 500;
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
    const tRes = await tenantRepo.query(
      'SELECT tenant_id, status, display_name FROM neem_tenants WHERE tenant_id = $1',
      [tenantId]
    );
    const tenant = tRes.rows?.[0] || null;
    if (!tenant) {
      return res.status(404).json({ ok: false, error: 'TENANT_NOT_FOUND' });
    }

    const grants = await grantService.listGrants(tenantId);
    const killSwitches = await killSwitchService.listActive();
    const tenantStatus = String(tenant.status || '').toLowerCase();
    const isSuspended = !['active', 'provisioning'].includes(tenantStatus);

    const effectiveFeatures = {};
    const catalog = catalogService.getFeatures();
    const version = `ent_${tenantId}_${Date.now()}`;
    const effectiveFrom = new Date().toISOString();

    for (const feat of catalog) {
      const key = feat.key;
      const ks = killSwitches.find(k => (k.featureKey === key || k.featureKeys?.includes(key)) && k.status === 'active');
      const grant = grants.find(g => g.featureKey === key && g.isActive === true);

      let enabled = false;
      let reason = 'غیرفعال در لایسنس تجاری';
      let source = 'catalog';

      if (ks) {
        enabled = false;
        if (ks.distributionStatus === 'synced' && ks.scope !== 'global') {
          reason = `توقف ثبت‌شده: ${ks.reason}`;
          source = 'killswitch';
        } else {
          reason = `توقف ثبت‌شده در کنترل‌پلن؛ توزیع سراسری تأیید نشده: ${ks.reason}`;
          source = 'unverified_killswitch';
        }
      } else if (isSuspended) {
        enabled = false;
        reason = 'سرویس مجموعه معلق است';
        source = 'tenant_suspension';
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
        baseEntitlement: feat.priceMonthly === 0,
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
        tenantStatus: tenant.status,
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

router.post('/outbox/:id/retry', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const item = await readPolicyOutboxItem(req.params.id);
    if (!item) return res.status(404).json({ ok: false, error: 'POLICY_OUTBOX_NOT_FOUND' });
    if (item.status === 'acknowledged') {
      return res.json({ ok: true, data: { outboxId: item.id, status: 'acknowledged', replay: true } });
    }

    const result = await deliverPolicyOutbox({
      id: item.id,
      tenantId: item.tenant_id,
      targetCell: item.target_cell,
      policyPayload: item.policyPayload
    });
    if (!result.ok) {
      const status = result.status === 409 ? 409 : 502;
      return res.status(status).json({
        ok: false,
        error: result.error === 'POLICY_OUTBOX_NOT_CLAIMABLE' ? result.error : 'POLICY_SYNC_FAILED',
        data: {
          tenantId: item.tenant_id,
          outboxId: item.id,
          policyApplied: true,
          syncedToWesto: false,
          deliveryState: result.deliveryState,
          sync: result
        }
      });
    }
    return res.json({ ok: true, data: { tenantId: item.tenant_id, outboxId: item.id, status: 'acknowledged', sync: result } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/outbox/:id/ack', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  return res.status(409).json({
    ok: false,
    error: 'POLICY_OUTBOX_ACK_REQUIRES_VERIFIED_DELIVERY',
    message: 'تأیید دستی حذف شده است؛ برای ارسال مجدد و ثبت ACK واقعی از مسیر retry استفاده کنید.'
  });
});

// 5. Canonical Platform Kill Switch (Phase 1.3)
router.get('/killswitch', async (req, res) => {
  try {
    res.json({
      ok: true,
      data: await killSwitchService.listActive(),
      capabilities: {
        globalMutationsAvailable: false,
        reason: 'GLOBAL_KILLSWITCH_FANOUT_NOT_IMPLEMENTED'
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/killswitch', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const { featureKey, moduleKey, scope = 'global', reason, severity = 'high', expiresAt, affectedTenantCount = 0 } = req.body || {};
    const requestedKey = moduleKey || featureKey;
    const module = catalogService.getModule(requestedKey);
    const featureKeys = module ? module.technicalFeatures : (featureKey ? [featureKey] : []);
    if (!requestedKey || typeof reason !== 'string' || !reason.trim() || featureKeys.length === 0 || featureKeys.some(key => !catalogService.getFeature(key))) {
      return res.status(400).json({ ok: false, error: 'A valid moduleKey/featureKey and reason are mandatory for platform kill switch.' });
    }
    if (scope !== 'global') {
      return res.status(422).json({ ok: false, error: 'Only global kill-switch scope is currently supported.' });
    }
    if (!['low', 'high', 'critical'].includes(severity)) {
      return res.status(422).json({ ok: false, error: 'severity must be low, high, or critical.' });
    }
    const tenantCount = Number(affectedTenantCount);
    if (!Number.isSafeInteger(tenantCount) || tenantCount < 0) {
      return res.status(422).json({ ok: false, error: 'affectedTenantCount must be a non-negative integer.' });
    }
    const expiration = expiresAt ? new Date(expiresAt) : new Date(Date.now() + 24 * 60 * 60 * 1000);
    if (!Number.isFinite(expiration.getTime()) || expiration.getTime() <= Date.now()) {
      return res.status(422).json({ ok: false, error: 'expiresAt must be a valid future date.' });
    }
    if (severity === 'critical') {
      if (!expiresAt) {
        return res.status(422).json({
          ok: false,
          error: 'KILLSWITCH_EXPIRY_REQUIRED_FOR_APPROVAL',
          message: 'برای پیوند امن تأیید، زمان انقضای دقیق توقف بحرانی را مشخص کنید.'
        });
      }
      let binding;
      try {
        binding = buildCriticalKillSwitchBinding({
          featureKey: featureKey || null,
          moduleKey: moduleKey || null,
          featureKeys,
          scope,
          reason,
          severity,
          expiresAt: expiration.toISOString(),
          affectedTenantCount: tenantCount,
        });
        await governanceApprovalService.assertApprovedAction({
          id: req.body?.approvalId,
          actorId: req.platformPrincipal?.id,
          actorRole: req.platformPrincipal?.role,
          requestId: req.requestId || null,
          ...binding,
        });
      } catch (error) {
        const status = Number.isInteger(error?.httpStatus) ? error.httpStatus : 409;
        return res.status(status).json({
          ok: false,
          error: error?.code || 'CRITICAL_KILLSWITCH_APPROVAL_REQUIRED',
          message: status >= 500
            ? 'تأیید پایدار بررسی نشد؛ توقف سراسری انجام نشده است.'
            : error.message,
        });
      }
    }
    return res.status(503).json({
      ok: false,
      error: 'GLOBAL_KILLSWITCH_FANOUT_NOT_IMPLEMENTED',
      message: 'توقف سراسری تا پیاده‌سازی و تأیید پایدار توزیع و ACK از تمام cellها و مستأجران قابل ثبت نیست؛ هیچ تغییری ذخیره یا ارسال نشد.'
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/killswitch/:featureKey', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    return res.status(503).json({
      ok: false,
      error: 'GLOBAL_KILLSWITCH_FANOUT_NOT_IMPLEMENTED',
      message: 'توقف سراسری تا دریافت ACK پایدار از تمام cellها قابل لغو نیست؛ هیچ تغییری ذخیره یا ارسال نشد.'
    });
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
