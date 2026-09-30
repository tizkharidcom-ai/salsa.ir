'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/tables', __westoModuleContext.requireAdmin, (req, res) => {
  const bid = Number(__westoModuleContext.parseBranchId(req));
  const allowedBranchIds = __westoModuleContext.branchScopeForUser(req.user, { role: __westoModuleContext.effectiveRole(req.user) });
  const tables = (__westoModuleContext.db.tables || []).filter((table) => __westoModuleContext.tableBranchId(table) === bid);
  const branches = allowedBranchIds === null
    ? (__westoModuleContext.db.branches || [])
    : (__westoModuleContext.db.branches || []).filter((branch) => allowedBranchIds.includes(Number(branch.id)));
  res.json({ tables, branches });
});
};
