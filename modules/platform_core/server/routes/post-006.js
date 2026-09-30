'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/staff/shifts/close', __westoModuleContext.requireCapability('ops.view'), async (req, res) => {
  const branchId = __westoModuleContext.parseBranchId(req) || __westoModuleContext.defaultBranch()?.id || 1;
  return __westoModuleContext.withCashDrawerMutationLock(__westoModuleContext.cashDrawerMutationQueueKey(req, branchId), async () => {
    const shift = __westoModuleContext.activeStaffShift(req.user, branchId);
    if (!shift) return res.status(409).json({ error: 'shift_not_open' });
    if (__westoModuleContext.activeCashSession(req.user, branchId)) return res.status(409).json({ error: 'cash_drawer_still_open' });
    const snapshot = __westoModuleContext.snapshotFinanceMutationState();
    shift.closedAt = new Date().toISOString();
    __westoModuleContext.recordAudit(req, 'shift.closed', 'shift', shift.id, {}, branchId);
    try {
      await __westoModuleContext.persistFinanceMutation(snapshot);
      return res.json({ ok: true, shift });
    } catch (error) {
      return res.status(error.status || 503).json({ error: error.code || 'shift_persistence_failed' });
    }
  });
});
};
