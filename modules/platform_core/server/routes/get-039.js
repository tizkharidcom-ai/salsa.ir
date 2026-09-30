'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/staff/menu', __westoModuleContext.requireCapability('orders.create'), (req, res) => {
  res.json(__westoModuleContext.staffMenuPayload(req.query.branchId || req.query.branch));
});
};
