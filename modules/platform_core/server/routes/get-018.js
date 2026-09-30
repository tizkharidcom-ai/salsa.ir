'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/events', __westoModuleContext.requireCapability('ops.view'), (req, res) => {
  const branchId = __westoModuleContext.parseBranchId(req);
  __westoModuleContext.eventHub.subscribe(req, res, (event) => {
    if (event.permission && !__westoModuleContext.userCan(req.user, event.permission)) return false;
    const eventBranch = event.payload?.branchId;
    return !branchId || !eventBranch || Number(eventBranch) === Number(branchId);
  });
});
};
