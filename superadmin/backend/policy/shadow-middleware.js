// server/salsa/control-plane/policy/shadow-middleware.js
'use strict';

const evaluatorService = require('./evaluator-service');

/**
 * Shadow Policy Middleware
 * Non-blocking, read-only shadow evaluation for testing policy logic against live route patterns.
 * Never mutates request body, never alters status code, and never interrupts the pipeline.
 */
function createShadowPolicyMiddleware({ permissionMap = {}, defaultFeature = null } = {}) {
  return async function shadowPolicyMiddleware(req, res, next) {
    try {
      const path = req.path || req.url;
      const method = req.method;
      const lookupKey = `${method} ${path}`;

      const matchedPermission = permissionMap[lookupKey] || permissionMap[path] || null;

      if (matchedPermission) {
        // Construct shadow evaluation context
        const shadowIdentity = req.user || {
          id: 'shadow_guest',
          role: 'guest',
          status: 'active'
        };

        const tenantId = req.tenant?.id || req.headers['x-tenant-id'];
        if (!tenantId) throw new Error('SHADOW_TENANT_CONTEXT_REQUIRED');
        const shadowTenant = req.tenant || { id: tenantId, status: 'active', displayName: tenantId };

        const result = await evaluatorService.evaluateAccess({
          identity: shadowIdentity,
          tenant: shadowTenant,
          permissionKey: matchedPermission,
          featureKey: defaultFeature
        });

        const shadowData = {
          evaluated: true,
          permissionKey: matchedPermission,
          decision: result.decision,
          reason: result.reason,
          latencyMs: result.latencyMs,
          timestamp: new Date().toISOString()
        };
        req.salsaShadowPolicy = shadowData;
        req.neemShadowPolicy = shadowData;

        res.setHeader('X-SALSA-Shadow-Decision', result.decision);
        res.setHeader('X-NEEM-Shadow-Decision', result.decision);
      }
    } catch (shadowErr) {
      // Fail-safe: Any shadow evaluation error is recorded internally and never affects request flow
      const errData = {
        evaluated: false,
        error: shadowErr.message
      };
      req.salsaShadowPolicy = errData;
      req.neemShadowPolicy = errData;
    } finally {
      next();
    }
  };
}

module.exports = {
  createShadowPolicyMiddleware
};
