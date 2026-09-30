'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/call-waiter/cancel', async (req, res) => {
  const tableNo = __westoModuleContext.normalizeDigits(String(req.body?.tableNo || '')).trim().slice(0, 20);
  const rawCallId = __westoModuleContext.normalizeDigits(String(req.body?.callId ?? '')).trim();
  const branchInput = __westoModuleContext.normalizeDigits(String(req.body?.branchId ?? '')).trim();
  if (!tableNo) return res.status(400).json({ error: 'شماره میز لازم است' });
  if (rawCallId && !/^\d+$/u.test(rawCallId)) return res.status(400).json({ error: 'call_id_invalid' });
  if (branchInput && !/^\d+$/u.test(branchInput)) return res.status(400).json({ error: 'branch_invalid' });
  const callId = rawCallId ? Number(rawCallId) : null;
  if (callId !== null && (!Number.isSafeInteger(callId) || callId <= 0)) {
    return res.status(400).json({ error: 'call_id_invalid' });
  }
  const branchId = branchInput ? Number(branchInput) : Number(__westoModuleContext.defaultBranch()?.id);
  if (!Number.isSafeInteger(branchId) || branchId <= 0
      || !(__westoModuleContext.db.branches || []).some((branch) => Number(branch.id) === branchId && branch.active !== false)) {
    return res.status(400).json({ error: 'branch_invalid' });
  }
  const tableMatch = __westoModuleContext.tableForBranch(tableNo, branchId)
    || (__westoModuleContext.db.tables || []).find((table) => __westoModuleContext.tableBranchId(table) === branchId
      && table.active !== false && __westoModuleContext.tableNoBelongsToTable(tableNo, table.id));
  if (!tableMatch || tableMatch.active === false) {
    return res.status(404).json({ error: 'waiter_call_table_not_found' });
  }

  return __westoModuleContext.serializeAdminConfigMutation(branchId, async () => {
    __westoModuleContext.db.waiterCalls = Array.isArray(__westoModuleContext.db.waiterCalls) ? __westoModuleContext.db.waiterCalls : [];
    const tableCallMatches = (call) => Number(call.branchId) === branchId
      && (__westoModuleContext.tableNoBelongsToTable(call.tableNo, tableMatch.id)
        || Number(__westoModuleContext.tableForBranch(call.tableNo, branchId)?.id) === Number(tableMatch.id));
    const call = callId === null
      ? __westoModuleContext.db.waiterCalls.find((item) => ['open', 'new'].includes(String(item.status || '')) && tableCallMatches(item))
      : __westoModuleContext.db.waiterCalls.find((item) => Number(item.id) === callId && tableCallMatches(item));
    if (!call) return res.status(404).json({ error: 'فراخوان بازی یافت نشد' });
    if (call.status === 'cancelled') return res.json({ ok: true, idempotent: true, call });
    if (!['open', 'new'].includes(String(call.status || ''))) {
      return res.status(409).json({ error: 'waiter_call_transition_invalid', current: call.status });
    }

    const snapshot = __westoModuleContext.snapshotFinanceMutationState();
    call.status = 'cancelled';
    call.resolvedAt = new Date().toISOString();
    call.resolvedBy = 'guest';
    const auditEntry = __westoModuleContext.recordAudit(req, 'waiter_call.cancelled', 'waiter_call', call.id, {
      tableNo: call.tableNo,
    }, branchId, { deferAppend: true });
    try {
      await __westoModuleContext.persistFinanceMutation(snapshot);
    } catch (error) {
      return res.status(error.status || 503).json({
        error: error.code || 'waiter_call_persistence_failed',
        message: 'لغو فراخوان ذخیره نشد؛ دوباره تلاش کنید.',
      });
    }

    __westoModuleContext.appendAuditAfterCommit(auditEntry);
    let eventPublished = true;
    try {
      __westoModuleContext.publishOperationalEvent('waiter_call.updated', {
        callId: call.id, branchId: call.branchId, status: call.status,
      });
    } catch (error) {
      eventPublished = false;
      console.error('[waiter-call] committed cancellation event failed', error?.message || error);
    }
    return res.json({ ok: true, eventPublished, call });
  }).catch((error) => {
    if (res.headersSent) return undefined;
    return res.status(error.status || 503).json({ error: error.code || 'waiter_call_cancel_failed' });
  });
});
};
