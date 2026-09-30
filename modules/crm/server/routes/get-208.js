'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/feedback', __westoModuleContext.requireCapability('pii.view'), (req, res) => {
  let bid;
  try {
    __westoModuleContext.assertRequestBranchAccess(req);
    bid = __westoModuleContext.parseBranchId(req);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message });
  }
  let list = __westoModuleContext.db.feedback || [];
  if (bid != null) list = list.filter((f) => Number(f.branchId) === Number(bid));
  else if (__westoModuleContext.effectiveRole(req.user) !== 'owner') return res.status(403).json({ error: 'branch_scope_required' });
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
  const since = Date.now() - days * 24 * 3600 * 1000;
  const windowed = list.filter((f) => new Date(f.createdAt).getTime() >= since);
  res.json({
    settings: __westoModuleContext.db.feedbackSettings || {},
    feedback: list.slice(0, 100),
    stats: __westoModuleContext.feedbackNpsStats(windowed),
    days,
  });
});
};
