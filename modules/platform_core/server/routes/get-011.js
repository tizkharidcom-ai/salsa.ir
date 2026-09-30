'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/tenant/context', (req, res) => {
  const identity = __westoModuleContext.db.tenantIdentity || {};
  res.json({
    ok: true,
    tenant: __westoModuleContext.publicTenantContext({
      ...__westoModuleContext.TENANT_CONFIG,
      tenantId: req.tenantId || identity.tenantId || __westoModuleContext.TENANT_CONFIG.tenantId,
      tenantSlug: req.tenantSlug || identity.tenantSlug || __westoModuleContext.TENANT_CONFIG.tenantSlug,
      displayName: identity.displayName || __westoModuleContext.db.restaurant?.name || __westoModuleContext.TENANT_CONFIG.displayName,
      canonicalDomain: identity.canonicalDomain || __westoModuleContext.TENANT_CONFIG.canonicalDomain,
    }),
  });
});
};
