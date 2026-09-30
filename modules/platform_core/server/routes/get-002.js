'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/modules', __westoModuleContext.requireCommandCenterAccess, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, tenantId: req.tenantId,
    modules: __westoModuleContext.moduleRuntime.catalog(req.tenantContext?.moduleVersions || __westoModuleContext.db.tenantIdentity?.moduleVersions || {}),
    access: __westoModuleContext.customerAccessSnapshot(__westoModuleContext.db) });
});
};
