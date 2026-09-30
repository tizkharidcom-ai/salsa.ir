'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/kitchen/calls', __westoModuleContext.requireCapability('service.manage'), (req, res) => {
  // Resolve the authenticated kitchen operator's effective branch when the
  // UI omits branchId; otherwise a scoped operator receives every branch's
  // open waiter call because the old query-only filter treated omission as a
  // consolidated view.
  const allowedBranchIds = __westoModuleContext.branchScopeForUser(req.user, { role: __westoModuleContext.effectiveRole(req.user) });
  const bid = allowedBranchIds === null
    ? (req.query.branchId ? Number(req.query.branchId) : null)
    : __westoModuleContext.parseBranchId(req);
  const calls = (__westoModuleContext.db.waiterCalls || [])
    .filter((c) => c.status === 'open')
    .filter((c) => (bid ? Number(c.branchId) === bid : true))
    .slice(0, 40);
  res.json({ calls });
});
};
