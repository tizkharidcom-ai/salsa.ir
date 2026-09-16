'use strict';

/**
 * WESTO → NEEM Policy Enforcement Layer (TPEL)
 *
 * This module wires the NEEM control-plane PolicyEvaluatorService into the
 * live WESTO Express server without disturbing the existing auth middleware
 * stack.  It operates in two modes:
 *
 *   shadow  — evaluates policy, emits audit headers/logs, never blocks (default)
 *   enforce — same as shadow but returns 403 on DENY
 *
 * The mode is controlled by the environment variable:
 *   NEEM_POLICY_MODE=shadow|enforce   (default: shadow)
 *
 * A PrincipalContext (req.neemPrincipal) is attached to every request so that
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

const ENFORCE_MODE = process.env.NEEM_POLICY_MODE === 'enforce';
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
  const canonicalRole = String(user?.role || 'guest').toLowerCase() === 'admin'
    ? 'owner'
    : String(user?.role || 'guest').toLowerCase();
  const tenant = req.tenant || null;

  const tenantId = tenant
    ? String(tenant.tenantId || 'westo')
    : String(process.env.NEEM_TENANT_ID || 'westo');

  const identity = user
    ? {
        id: String(user.phone || user.id || 'unknown'),
        phone: String(user.phone || ''),
        name: String(user.name || ''),
        role: canonicalRole,
        status: user.blocked ? 'suspended' : 'active',
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

  const tenantContext = tenant
    ? {
        id: tenantId,
        displayName: tenant.displayName || tenantId,
        status: 'active',
        cellId: tenant.cellId || `${tenantId}-cell-01`,
        mode: tenant.mode || 'cloud',
      }
    : {
        id: tenantId,
        displayName: tenantId,
        status: 'active',
        cellId: `${tenantId}-cell-01`,
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
      res.setHeader('X-NEEM-Policy-Decision', 'ERROR');
      res.setHeader('X-NEEM-Policy-Mode', 'enforce');
      return res.status(403).json({
        error: 'policy_eval_error',
        requestId: req.requestId,
        message: 'خطا در ارزیابی سیاست دسترسی.',
      });
    }
    req.neemShadowPolicy = { evaluated: false, error: evalErr.message };
    res.setHeader('X-NEEM-Shadow-Decision', 'ERROR');
    return next();
  }

  const isDeny = result.decision === 'DENY';
  const mode = ENFORCE_MODE ? 'enforce' : 'shadow';

  // Attach shadow policy result to request for logging / audit
  req.neemShadowPolicy = {
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

  res.setHeader('X-NEEM-Shadow-Decision', result.decision);
  res.setHeader('X-NEEM-Policy-Mode', mode);

  if (isDeny) {
    // Always log a DENY regardless of mode
    console.warn(
      `[neem-tpel] DENY ${mode} | ${req.method} ${req.path} | ` +
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
      `[neem-tpel] OWNER-OVERRIDE WARN | ${req.method} ${req.path} | ` +
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
    req.neemPrincipal = buildPrincipal(req);
  } catch (_) {
    // Non-blocking: principal attachment failure is never fatal
    req.neemPrincipal = null;
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
      req.neemPrincipal = buildPrincipal(req, { resolveUser });
    } catch (_) {
      req.neemPrincipal = null;
    }
    next();
  };
}

/**
 * Route-level middleware factory.
 * Returns an async middleware that enforces (or shadow-evaluates) the given
 * capability against the NEEM policy engine.
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
    if (!req.neemPrincipal) req.neemPrincipal = buildPrincipal(req);
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
    if (!req.neemPrincipal) req.neemPrincipal = buildPrincipal(req);
    const principal = req.neemPrincipal;
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
          req.neemShadowPolicy = {
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
          res.setHeader('X-NEEM-Shadow-Decision', result.decision);
          res.setHeader('X-NEEM-Policy-Mode', mode);
          return next();
        }
      } catch (evalErr) {
        if (ENFORCE_MODE) {
          res.setHeader('X-NEEM-Policy-Decision', 'ERROR');
          res.setHeader('X-NEEM-Policy-Mode', mode);
          return res.status(403).json({
            error: 'policy_eval_error',
            requestId: req.requestId,
            message: 'خطا در ارزیابی سیاست دسترسی.',
          });
        }
        req.neemShadowPolicy = { evaluated: false, error: evalErr.message, mode };
        res.setHeader('X-NEEM-Shadow-Decision', 'ERROR');
        res.setHeader('X-NEEM-Policy-Mode', mode);
        return next();
      }
    }

    const last = results[results.length - 1];
    const result = last?.result;
    const reason = result?.reason || 'هیچ‌یک از مجوزهای لازم تأیید نشد.';
    req.neemShadowPolicy = {
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
    res.setHeader('X-NEEM-Shadow-Decision', 'DENY');
    res.setHeader('X-NEEM-Policy-Mode', mode);
    console.warn(
      `[neem-tpel] DENY ${mode} | ${req.method} ${req.path} | ` +
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
 *   app.use(neemRouteAwarePolicyMiddleware())
 *
 * In shadow mode this never blocks. In enforce mode it blocks on DENY
 * only for routes that are in ROUTE_CAPABILITY_MAP.
 */
function neemRouteAwarePolicyMiddleware() {
  return async (req, res, next) => {
    // Only evaluate routes that are in the capability map
    const cap = lookupPolicyCapability(req.method, req.path);
    if (!cap) return next();

    if (!req.neemPrincipal) req.neemPrincipal = buildPrincipal(req);
    // Authentication remains the first observable boundary. Do not turn an
    // anonymous request into a policy 403 before the route's normal auth
    // middleware can explain that a session is required.
    if (ENFORCE_MODE && req.neemPrincipal.identity.status !== 'active') {
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
 * Used by neem-bridge and any route that receives tenant-scoped payloads.
 *
 * @param {string} expectedTenantId   The server's authoritative tenant ID
 * @param {import('express').Request} req
 * @returns {{ ok: boolean, actual: string, expected: string }}
 */
function assertTenantBoundary(expectedTenantId, req) {
  const actual = String(
    req.neemPrincipal?.tenant?.id ||
    req.tenant?.tenantId ||
    process.env.NEEM_TENANT_ID ||
    'westo'
  ).trim().toLowerCase();
  const expected = String(expectedTenantId || 'westo').trim().toLowerCase();
  return { ok: actual === expected, actual, expected };
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
  neemPrincipalMiddleware,
  createNeemPrincipalMiddleware,
  requireCapabilityEnforced,
  requireAnyCapabilityEnforced,
  neemRouteAwarePolicyMiddleware,
  assertTenantBoundary,
  isOwnerOnlySettingsCategory,
  ENFORCE_MODE,
  SHADOW_MODE,
};
