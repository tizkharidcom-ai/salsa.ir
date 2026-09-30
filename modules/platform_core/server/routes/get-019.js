'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/audit', __westoModuleContext.requireCapability('admin.access'), (req, res) => {
  const branchId = __westoModuleContext.parseBranchId(req);
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 80));
  const log = __westoModuleContext.branchScoped(__westoModuleContext.db.auditLog || [], branchId).slice(0, limit);
  res.json({ audit: log, branchId: branchId || null });
});
};
