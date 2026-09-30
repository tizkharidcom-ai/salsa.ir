'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.patch('/api/waiter/calls/:id', __westoModuleContext.requireCapability('service.manage'), async (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const call = (__westoModuleContext.db.waiterCalls || []).find((item) => Number(item.id) === targetId);
  if (!call) return res.status(404).json({ error: 'not found' });
  try {
    __westoModuleContext.assertUserBranchAccess(req.user, call.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  if (String(req.body?.status || '') !== 'done') return res.status(400).json({ error: 'call_status_invalid' });
  return __westoModuleContext.serializeAdminConfigMutation(call.branchId, async () => {
    const current = (__westoModuleContext.db.waiterCalls || []).find((item) => Number(item.id) === targetId);
    if (!current) return res.status(404).json({ error: 'not found' });
    try {
      __westoModuleContext.assertUserBranchAccess(req.user, current.branchId);
    } catch (error) {
      return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
    }
    if (current.status === 'done') return res.json({ ok: true, idempotent: true, call: current });
    if (!['open', 'new'].includes(String(current.status || ''))) {
      return res.status(409).json({ error: 'waiter_call_transition_invalid', current: current.status });
    }

    const snapshot = __westoModuleContext.snapshotFinanceMutationState();
    current.status = 'done';
    current.resolvedAt = new Date().toISOString();
    current.resolvedBy = req.user.phone;
    const auditEntry = __westoModuleContext.recordAudit(req, 'waiter_call.resolved', 'waiter_call', current.id, { tableNo: current.tableNo }, current.branchId, { deferAppend: true });
    try {
      await __westoModuleContext.persistFinanceMutation(snapshot);
    } catch (error) {
      return res.status(error.status || 503).json({ error: error.code || 'waiter_call_persistence_failed', message: 'ثبت انجام فراخوان پایدار نشد؛ دوباره همگام‌سازی کنید.' });
    }

    __westoModuleContext.appendAuditAfterCommit(auditEntry);
    let eventPublished = true;
    try {
      __westoModuleContext.publishOperationalEvent('waiter_call.updated', { callId: current.id, branchId: current.branchId, status: current.status });
    } catch (error) {
      eventPublished = false;
      console.error('[waiter-call] committed event failed', error?.message || error);
    }
    return res.json({ ok: true, eventPublished, call: current });
  }).catch((error) => {
    if (res.headersSent) return undefined;
    return res.status(error.status || 503).json({ error: error.code || 'waiter_call_update_failed' });
  });
});
};
