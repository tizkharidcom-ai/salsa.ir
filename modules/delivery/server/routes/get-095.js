'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/delivery-zones', __westoModuleContext.requireCapability('delivery.view'), (req, res) => {
  const branchId = __westoModuleContext.parseBranchId(req);
  res.json({ zones: __westoModuleContext.branchScoped(__westoModuleContext.db.deliveryZones || [], branchId).sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0)) });
});
};
