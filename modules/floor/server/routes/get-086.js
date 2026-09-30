'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/waiter/calls', __westoModuleContext.requireCapability('service.manage'), (req, res) => {
  const branchId = __westoModuleContext.parseBranchId(req);
  const calls = __westoModuleContext.branchScoped(__westoModuleContext.db.waiterCalls || [], branchId)
    .filter((call) => call.status === 'open' || call.status === 'new')
    .slice(0, 80);
  res.json({ calls, serverTime: new Date().toISOString() });
});
};
