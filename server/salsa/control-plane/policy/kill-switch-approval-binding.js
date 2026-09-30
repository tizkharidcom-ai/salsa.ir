'use strict';

const CRITICAL_KILLSWITCH_ACTION = 'platform.kill_switch.activate';

function buildCriticalKillSwitchBinding({
  featureKey = null,
  moduleKey = null,
  featureKeys,
  scope,
  reason,
  severity,
  expiresAt,
  affectedTenantCount,
} = {}) {
  const requestedKey = moduleKey || featureKey;
  const expiration = new Date(expiresAt);
  const normalizedFeatures = Array.isArray(featureKeys)
    ? [...new Set(featureKeys.map(key => String(key).trim()))].sort()
    : [];
  if (!requestedKey || scope !== 'global' || severity !== 'critical'
    || typeof reason !== 'string' || !reason.trim()
    || !Number.isFinite(expiration.getTime())
    || !Number.isSafeInteger(affectedTenantCount) || affectedTenantCount < 0
    || normalizedFeatures.length === 0 || normalizedFeatures.some(key => !key)) {
    const error = new Error('Critical kill-switch approval binding is incomplete or invalid.');
    error.code = 'KILLSWITCH_APPROVAL_BINDING_INVALID';
    error.httpStatus = 422;
    throw error;
  }
  const targetResource = `platform.kill-switch:${requestedKey}`;
  const payload = {
    requestedKey,
    featureKey: featureKey || null,
    moduleKey: moduleKey || null,
    featureKeys: normalizedFeatures,
    scope,
    reason: reason.trim(),
    severity,
    expiresAt: expiration.toISOString(),
    affectedTenantCount,
  };
  return { actionType: CRITICAL_KILLSWITCH_ACTION, targetResource, payload };
}

module.exports = { CRITICAL_KILLSWITCH_ACTION, buildCriticalKillSwitchBinding };
