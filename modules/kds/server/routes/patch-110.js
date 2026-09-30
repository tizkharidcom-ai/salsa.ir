'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.patch('/api/kitchen/calls/:id', __westoModuleContext.requireCapability('service.manage'), (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const call = (__westoModuleContext.db.waiterCalls || []).find((c) => Number(c.id) === targetId);
  if (!call) return res.status(404).json({ error: 'not found' });
  try {
    __westoModuleContext.assertUserBranchAccess(req.user, call.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  const requestedStatus = req.body?.status;
  if (!['done', 'open'].includes(requestedStatus)) {
    return res.status(400).json({ error: 'kitchen_call_status_invalid', allowed: ['open', 'done'] });
  }
  if (call.status !== requestedStatus) {
    call.status = requestedStatus;
    call.resolvedAt = requestedStatus === 'done' ? new Date().toISOString() : null;
  }
  __westoModuleContext.save();
  res.json({ ok: true, call });
});
};
