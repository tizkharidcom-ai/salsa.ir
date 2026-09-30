'use strict';

function resolveAuditTenantId(req, contextTenantId, fallbackTenantId) {
  const resolved = req?.tenantId
    || req?.tenantContext?.tenantId
    || contextTenantId
    || req?.tenant?.tenantId
    || fallbackTenantId;
  const normalized = String(resolved || '').trim();
  return normalized || null;
}

module.exports = { resolveAuditTenantId };
