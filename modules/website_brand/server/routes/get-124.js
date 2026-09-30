'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/restaurant', __westoModuleContext.requireAdmin, (req, res) => {
  const branch = __westoModuleContext.resolveBranch(req.query.branchId || req.query.branch);
  res.json({
    restaurant: __westoModuleContext.db.restaurant,
    hours: branch?.hours || __westoModuleContext.db.hours,
    branch,
    branches: __westoModuleContext.db.branches || [],
  });
});
};
