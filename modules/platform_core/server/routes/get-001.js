'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/session', __westoModuleContext.requireCommandCenterAccess, (req, res) => {
  const allowedBranchIds = __westoModuleContext.branchScopeForUser(req.user, { role: __westoModuleContext.effectiveRole(req.user) });
  res.json({
    user: __westoModuleContext.publicUser(req.user),
    moduleAccess: __westoModuleContext.customerAccessSnapshot(__westoModuleContext.db),
    branchId: __westoModuleContext.parseBranchId(req),
    branches: (__westoModuleContext.db.branches || []).filter((branch) => branch.active !== false
      && (allowedBranchIds === null || allowedBranchIds.includes(Number(branch.id)))),
  });
});
};
