'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/staff/shifts/open', __westoModuleContext.requireCapability('ops.view'), async (req, res) => {
  const branchId = __westoModuleContext.parseBranchId(req) || __westoModuleContext.defaultBranch()?.id || 1;
  const existing = __westoModuleContext.activeStaffShift(req.user, branchId);
  if (existing) return res.json({ ok: true, idempotent: true, shift: existing });
  const snapshot = __westoModuleContext.snapshotFinanceMutationState();
  const shift = {
    id: __westoModuleContext.nextId(__westoModuleContext.db.staffShifts),
    phone: req.user.phone,
    role: __westoModuleContext.effectiveRole(req.user),
    branchId,
    openedAt: new Date().toISOString(),
    closedAt: null,
  };
  __westoModuleContext.db.staffShifts.unshift(shift);
  __westoModuleContext.recordAudit(req, 'shift.opened', 'shift', shift.id, {}, branchId);
  try {
    await __westoModuleContext.persistFinanceMutation(snapshot);
    res.status(201).json({ ok: true, shift });
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.code || 'shift_persistence_failed' });
  }
});
};
