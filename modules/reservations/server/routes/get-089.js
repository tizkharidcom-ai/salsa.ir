'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/waiter/waitlist', __westoModuleContext.requireCapability('reservations.receive'), (req, res) => {
  const branchId = __westoModuleContext.parseBranchId(req);
  const entries = __westoModuleContext.waitlistForBranch(branchId, String(req.query.history || '') === '1');
  const active = entries.filter((entry) => __westoModuleContext.waitlist.ACTIVE_WAITLIST_STATUSES.has(entry.status));
  res.json({
    waitlist: entries,
    summary: {
      waiting: active.filter((entry) => entry.status === 'waiting').length,
      called: active.filter((entry) => entry.status === 'called').length,
      seated: active.filter((entry) => entry.status === 'seated').length,
      total: active.length,
    },
    serverTime: new Date().toISOString(),
  });
});
};
