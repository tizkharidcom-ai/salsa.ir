// server/neem/control-plane/policy/shadow-middleware.js
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

        const shadowTenant = req.tenant || {
          id: req.headers['x-tenant-id'] || 'westo-demo',
          status: 'active',
          displayName: 'کافه رستوران وستو'
        };

        const result = await evaluatorService.evaluateAccess({
          identity: shadowIdentity,
          tenant: shadowTenant,
          permissionKey: matchedPermission,
          featureKey: defaultFeature
        });

        req.neemShadowPolicy = {
          evaluated: true,
          permissionKey: matchedPermission,
          decision: result.decision,
          reason: result.reason,
          latencyMs: result.latencyMs,
          timestamp: new Date().toISOString()
        };

        res.setHeader('X-NEEM-Shadow-Decision', result.decision);
      }
    } catch (shadowErr) {
      // Fail-safe: Any shadow evaluation error is recorded internally and never affects request flow
      req.neemShadowPolicy = {
        evaluated: false,
        error: shadowErr.message
      };
    } finally {
      next();
    }
  };
}

module.exports = {
  createShadowPolicyMiddleware
};
