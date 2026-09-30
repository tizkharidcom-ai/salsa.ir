'use strict';

/**
 * WESTO → SALSA Policy Enforcement Layer (TPEL)
 *
 * This module wires the SALSA control-plane PolicyEvaluatorService into the
 * live WESTO Express server without disturbing the existing auth middleware
 * stack.  It operates in two modes:
 *
 *   shadow  — evaluates policy, emits audit headers/logs, never blocks (default)
 *   enforce — same as shadow but returns 403 on DENY
 *
 * The mode is controlled by the environment variable:
 *   SALSA_POLICY_MODE=shadow|enforce (or NEEM_POLICY_MODE) (default: shadow)
 *
 * A PrincipalContext (req.salsaPrincipal / req.neemPrincipal) is attached to every request so that
 * route handlers can read the resolved tenant + identity without re-evaluating.
 *
 * Invariants:
 *  - Never mutates req.user or req.tenant
 *  - Never blocks in shadow mode
 *  - Fail-closed: on evaluator error in enforce mode → 403 audit
 *  - No network calls (all evaluation is synchronous in-process)
 *  - server/data/db.json and prototype/ are never touched
 */

const evaluatorService = require('./control-plane/policy/evaluator-service');
const { lookupPolicyCapability, OWNER_ONLY_SETTINGS_CATEGORIES } = require('./route-capability-map');
const { normalizeTenantId } = require('./tenant-context');
const { normalizeRole } = require('../command-center');

const ENFORCE_MODE = process.env.SALSA_POLICY_MODE === 'enforce' || process.env.NEEM_POLICY_MODE === 'enforce';
const SHADOW_MODE  = !ENFORCE_MODE;

// ── Principal Builder ─────────────────────────────────────────────────────

/**
 * Build a NEEM PrincipalContext from the live Express request.
 * This does NOT require the user to be authenticated — unauthenticated
 * requests get a guest principal with status:'inactive'.
 *
 * @param {import('express').Request} req
 * @returns {object} neemPrincipal
 */
function buildPrincipal(req, { resolveUser = null } = {}) {
  let user = req.user || null;
  if (!user && typeof resolveUser === 'function') {
    try {
      user = resolveUser(req) || null;
    } catch (_) {
      user = null;
    }
  }
  // WESTO still stores legacy administrators as `admin`; the shared policy
  // evaluator uses the canonical platform role `owner`. Keep the principal
  // contract aligned with the existing requireCapability/effectiveRole path.
  const canonicalRole = normalizeRole(user?.role);
  const tenantSources = [
    req.tenantContext?.tenantId,
    req.tenantId,
    req.tenant?.tenantId,
  ].filter((value) => value != null && String(value).trim() !== '');
  const normalizedTenantIds = tenantSources.map((value) => normalizeTenantId(value));
  const tenantId = normalizedTenantIds.length > 0
    && normalizedTenantIds.every(Boolean)
    && new Set(normalizedTenantIds).size === 1
    ? normalizedTenantIds[0]
    : null;
  const tenant = req.tenantContext || req.tenant || null;
  const tenantStatus = String(tenant?.status || 'active').trim().toLowerCase();
  const hasAuthoritativeTenant = Boolean(tenantId && tenantStatus === 'active');
  const userId = String(user?.phone || user?.id || '').trim();
  const userStatus = user?.blocked === true
    || ['blocked', 'disabled', 'inactive', 'suspended', 'deleted'].includes(String(user?.status || '').trim().toLowerCase())
    ? 'suspended'
    : 'active';
  const identityStatus = hasAuthoritativeTenant && user && userId && userStatus === 'active'
    ? 'active'
    : 'inactive';

  const identity = user
    ? {
        id: userId || 'unknown',
        phone: String(user.phone || ''),
        name: String(user.name || ''),
        role: canonicalRole,
        status: identityStatus,
        tenantId,
      }
    : {
        id: 'anonymous',
        phone: '',
        name: '',
        role: 'guest',
        status: 'inactive',
        tenantId,
      };

  const tenantContext = tenantId
    ? {
        id: tenantId,
        displayName: tenant.displayName || tenantId,
        status: hasAuthoritativeTenant ? 'active' : 'inactive',
        cellId: tenant.cellId || `${tenantId}-cell-01`,
        mode: tenant.mode || 'cloud',
      }
    : {
        id: null,
        displayName: '',
        status: 'inactive',
        cellId: null,
        mode: 'cloud',
      };

  return {
    identity,
    tenant: tenantContext,
    requestId: req.requestId || null,
    resolvedAt: new Date().toISOString(),
  };
}

// ── Core Enforcement ──────────────────────────────────────────────────────

/**
 * Evaluate policy for a given capability and principal, then either block
 * or shadow-log based on NEEM_POLICY_MODE.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {Function}                   next
 * @param {string}                     capabilityKey
 * @param {string|null}                featureKey
 * @returns {Promise<void>}
 */
async function enforcePolicy(req, res, next, capabilityKey, featureKey = null) {
  const principal = req.neemPrincipal || buildPrincipal(req);

  let result;
  try {
    result = await evaluatorService.evaluateAccess({
      identity: principal.identity,
      tenant: principal.tenant,
      permissionKey: capabilityKey,
      featureKey,
    });
  } catch (evalErr) {
    // Fail-closed in enforce mode; shadow mode passes through
    if (ENFORCE_MODE) {
      res.setHeader('X-SALSA-Policy-Decision', 'ERROR');
      res.setHeader('X-NEEM-Policy-Decision', 'ERROR');
      res.setHeader('X-SALSA-Policy-Mode', 'enforce');
      res.setHeader('X-NEEM-Policy-Mode', 'enforce');
      return res.status(403).json({
        error: 'policy_eval_error',
        requestId: req.requestId,
        message: 'خطا در ارزیابی سیاست دسترسی.',
      });
    }
    req.salsaShadowPolicy = req.neemShadowPolicy = { evaluated: false, error: evalErr.message };
    res.setHeader('X-SALSA-Shadow-Decision', 'ERROR');
    res.setHeader('X-NEEM-Shadow-Decision', 'ERROR');
    return next();
  }

  const isDeny = result.decision === 'DENY';
  const mode = ENFORCE_MODE ? 'enforce' : 'shadow';

  // Attach shadow policy result to request for logging / audit
  const shadowPayload = {
    evaluated: true,
    permissionKey: capabilityKey,
    featureKey,
    decision: result.decision,
    reason: result.reason,
    latencyMs: result.latencyMs,
    mode,
    timestamp: new Date().toISOString(),
    isOwnerOverridden: result.isOwnerOverridden || false,
  };
  req.salsaShadowPolicy = shadowPayload;
  req.neemShadowPolicy = shadowPayload;

  res.setHeader('X-SALSA-Shadow-Decision', result.decision);
  res.setHeader('X-NEEM-Shadow-Decision', result.decision);
  res.setHeader('X-SALSA-Policy-Mode', mode);
  res.setHeader('X-NEEM-Policy-Mode', mode);

  if (isDeny) {
    // Always log a DENY regardless of mode
    console.warn(
      `[salsa-tpel] DENY ${mode} | ${req.method} ${req.path} | ` +
      `identity=${principal.identity.id} role=${principal.identity.role} ` +
      `tenant=${principal.tenant.id} cap=${capabilityKey} | ${result.reason}`,
    );

    if (ENFORCE_MODE) {
      return res.status(403).json({
        error: 'policy_denied',
        requestId: req.requestId,
        capabilityKey,
        reason: result.reason,
        mode,
      });
    }
    // Shadow: fall through but log
  }

  if (result.isOwnerOverridden) {
    console.warn(
      `[salsa-tpel] OWNER-OVERRIDE WARN | ${req.method} ${req.path} | ` +
      `explicit deny applied to owner (${principal.identity.id}) for cap=${capabilityKey}`,
    );
  }

  next();
}

// ── Express Middleware Factories ──────────────────────────────────────────

/**
 * Global middleware that attaches req.neemPrincipal to every request.
 * Install once after tenantHostMiddleware.
 *
 * Does not block. Does not require authentication.
 */
function neemPrincipalMiddleware(req, res, next) {
  try {
    req.salsaPrincipal = req.neemPrincipal = buildPrincipal(req);
  } catch (_) {
    // Non-blocking: principal attachment failure is never fatal
    req.salsaPrincipal = req.neemPrincipal = null;
  }
  next();
}

/**
 * Principal middleware factory for hosts whose session resolver is owned by
 * the application (for example WESTO's legacy signed-session resolver).
 * Resolving the user before the route-aware policy middleware is essential:
 * otherwise every mapped request is evaluated as the anonymous guest.
 */
function createNeemPrincipalMiddleware({ resolveUser = null } = {}) {
  return (req, res, next) => {
    try {
      req.salsaPrincipal = req.neemPrincipal = buildPrincipal(req, { resolveUser });
    } catch (_) {
      req.salsaPrincipal = req.neemPrincipal = null;
    }
    next();
  };
}

/**
 * Route-level middleware factory.
 * Returns an async middleware that enforces (or shadow-evaluates) the given
 * capability against the SALSA policy engine.
 *
 * Usage:
 *   app.get('/api/admin/v2/crm', requireCapabilityEnforced('pii.view'), handler)
 *
 * @param {string}      capabilityKey  Capability to evaluate
 * @param {object}      [opts]
 * @param {string|null} [opts.featureKey]  Optional feature/module key
 * @returns {Function}  Express middleware
 */
function requireCapabilityEnforced(capabilityKey, { featureKey = null } = {}) {
  return async (req, res, next) => {
    // Ensure principal is attached
    if (!req.salsaPrincipal && !req.neemPrincipal) {
      req.salsaPrincipal = req.neemPrincipal = buildPrincipal(req);
    }
    await enforcePolicy(req, res, next, capabilityKey, featureKey);
  };
}

/**
 * Route-level middleware for the few WESTO handlers that intentionally accept
 * any one of several capabilities. The legacy guard has OR semantics, so the
 * TPEL check must preserve that contract instead of evaluating only the first
 * capability and accidentally denying a valid operator in enforce mode.
 */
function requireAnyCapabilityEnforced(capabilityKeys, { featureKey = null } = {}) {
  const capabilities = [...new Set((Array.isArray(capabilityKeys) ? capabilityKeys : [capabilityKeys])
    .map((key) => String(key || '').trim())
    .filter(Boolean))];

  if (capabilities.length <= 1) return requireCapabilityEnforced(capabilities[0] || 'admin.access', { featureKey });

  return async (req, res, next) => {
    if (!req.salsaPrincipal && !req.neemPrincipal) {
      req.salsaPrincipal = req.neemPrincipal = buildPrincipal(req);
    }
    const principal = req.salsaPrincipal || req.neemPrincipal;
    const mode = ENFORCE_MODE ? 'enforce' : 'shadow';
    const results = [];

    for (const capabilityKey of capabilities) {
      try {
        const result = await evaluatorService.evaluateAccess({
          identity: principal.identity,
          tenant: principal.tenant,
          permissionKey: capabilityKey,
          featureKey,
        });
        results.push({ capabilityKey, result });
        if (result.decision === 'ALLOW') {
          const shadowPayload = {
            evaluated: true,
            permissionKey: capabilityKey,
            featureKey,
            decision: result.decision,
            reason: result.reason,
            latencyMs: result.latencyMs,
            mode,
            timestamp: new Date().toISOString(),
            isOwnerOverridden: result.isOwnerOverridden || false,
          };
          req.salsaShadowPolicy = shadowPayload;
          req.neemShadowPolicy = shadowPayload;
          res.setHeader('X-SALSA-Shadow-Decision', result.decision);
          res.setHeader('X-NEEM-Shadow-Decision', result.decision);
          res.setHeader('X-SALSA-Policy-Mode', mode);
          res.setHeader('X-NEEM-Policy-Mode', mode);
          return next();
        }
      } catch (evalErr) {
        if (ENFORCE_MODE) {
          res.setHeader('X-SALSA-Policy-Decision', 'ERROR');
          res.setHeader('X-NEEM-Policy-Decision', 'ERROR');
          res.setHeader('X-SALSA-Policy-Mode', mode);
          res.setHeader('X-NEEM-Policy-Mode', mode);
          return res.status(403).json({
            error: 'policy_eval_error',
            requestId: req.requestId,
            message: 'خطا در ارزیابی سیاست دسترسی.',
          });
        }
        const shadowError = { evaluated: false, error: evalErr.message, mode };
        req.salsaShadowPolicy = shadowError;
        req.neemShadowPolicy = shadowError;
        res.setHeader('X-SALSA-Shadow-Decision', 'ERROR');
        res.setHeader('X-NEEM-Shadow-Decision', 'ERROR');
        res.setHeader('X-SALSA-Policy-Mode', mode);
        res.setHeader('X-NEEM-Policy-Mode', mode);
        return next();
      }
    }

    const last = results[results.length - 1];
    const result = last?.result;
    const reason = result?.reason || 'هیچ‌یک از مجوزهای لازم تأیید نشد.';
    const shadowDeny = {
      evaluated: true,
      permissionKey: capabilities.join('|'),
      featureKey,
      decision: 'DENY',
      reason,
      latencyMs: results.reduce((sum, item) => sum + Number(item.result?.latencyMs || 0), 0),
      mode,
      timestamp: new Date().toISOString(),
      isOwnerOverridden: results.some((item) => item.result?.isOwnerOverridden),
    };
    req.salsaShadowPolicy = shadowDeny;
    req.neemShadowPolicy = shadowDeny;
    res.setHeader('X-SALSA-Shadow-Decision', 'DENY');
    res.setHeader('X-NEEM-Shadow-Decision', 'DENY');
    res.setHeader('X-SALSA-Policy-Mode', mode);
    res.setHeader('X-NEEM-Policy-Mode', mode);
    console.warn(
      `[salsa-tpel] DENY ${mode} | ${req.method} ${req.path} | ` +
      `identity=${principal.identity.id} role=${principal.identity.role} ` +
      `tenant=${principal.tenant.id} caps=${capabilities.join(',')} | ${reason}`,
    );
    if (ENFORCE_MODE) {
      return res.status(403).json({
        error: 'policy_denied',
        requestId: req.requestId,
        capabilityKey: capabilities,
        reason,
        mode,
      });
    }
    return next();
  };
}

/**
 * Route-aware middleware that auto-resolves the capability from
 * ROUTE_CAPABILITY_MAP, then evaluates policy.
 *
 * Install as a global middleware to shadow-evaluate ALL mapped routes:
 *   app.use(salsaRouteAwarePolicyMiddleware())
 *
 * In shadow mode this never blocks. In enforce mode it blocks on DENY
 * only for routes that are in ROUTE_CAPABILITY_MAP.
 */
function neemRouteAwarePolicyMiddleware() {
  return async (req, res, next) => {
    // Only evaluate routes that are in the capability map
    const cap = lookupPolicyCapability(req.method, req.path);
    if (!cap) return next();

    if (!req.salsaPrincipal && !req.neemPrincipal) {
      req.salsaPrincipal = req.neemPrincipal = buildPrincipal(req);
    }
    const principal = req.salsaPrincipal || req.neemPrincipal;
    // Authentication remains the first observable boundary. Do not turn an
    // anonymous request into a policy 403 before the route's normal auth
    // middleware can explain that a session is required.
    if (ENFORCE_MODE && principal.identity.status !== 'active') {
      return res.status(401).json({
        error: 'unauthorized',
        requestId: req.requestId,
        message: 'برای ارزیابی سیاست، احراز هویت فعال لازم است.',
      });
    }
    await enforcePolicy(req, res, next, cap, null);
  };
}

/**
 * Validate that req.tenant.id matches the expected tenantId for a
 * cross-tenant isolation boundary.
 *
 * Used by salsa-bridge and any route that receives tenant-scoped payloads.
 *
 * @param {string} expectedTenantId   The server's authoritative tenant ID
 * @param {import('express').Request} req
 * @returns {{ ok: boolean, actual: string, expected: string }}
 */
function assertTenantBoundary(expectedTenantId, req) {
  const expected = normalizeTenantId(expectedTenantId);
  const sources = [
    req?.tenantContext?.tenantId,
    req?.tenantId,
    req?.tenant?.tenantId,
    req?.salsaPrincipal?.tenant?.id,
    req?.neemPrincipal?.tenant?.id,
  ].filter((value) => value != null && String(value).trim() !== '');
  const actualIds = sources.map((value) => normalizeTenantId(value));
  const consistent = actualIds.length > 0
    && actualIds.every(Boolean)
    && new Set(actualIds).size === 1;
  const actual = consistent ? actualIds[0] : null;
  return { ok: Boolean(expected && actual && expected === actual), actual, expected };
}

/**
 * Check if a settings category mutation requires owner-level access.
 *
 * @param {string} category  The settings category slug
 * @returns {boolean}
 */
function isOwnerOnlySettingsCategory(category) {
  return OWNER_ONLY_SETTINGS_CATEGORIES.includes(String(category || ''));
}

module.exports = {
  buildPrincipal,
  enforcePolicy,
  salsaPrincipalMiddleware: neemPrincipalMiddleware,
  neemPrincipalMiddleware,
  createSalsaPrincipalMiddleware: createNeemPrincipalMiddleware,
  createNeemPrincipalMiddleware,
  requireCapabilityEnforced,
  requireAnyCapabilityEnforced,
  salsaRouteAwarePolicyMiddleware: neemRouteAwarePolicyMiddleware,
  neemRouteAwarePolicyMiddleware,
  assertTenantBoundary,
  isOwnerOnlySettingsCategory,
  ENFORCE_MODE,
  SHADOW_MODE,
};
