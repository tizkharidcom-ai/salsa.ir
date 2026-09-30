'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/call-waiter', async (req, res) => {
  const tableNo = __westoModuleContext.normalizeDigits(String(req.body.tableNo || '')).trim().slice(0, 20);
  if (!tableNo) return res.status(400).json({ error: 'شماره میز لازم است' });
  const note = String(req.body.note || '').trim().slice(0, 120);
  // Older clients omitted requestType; preserve their established meaning as
  // a service call while rejecting unknown types instead of silently losing
  // the request's intent.
  const requestType = String(req.body?.requestType ?? 'service').trim().toLowerCase();
  if (!['service', 'bill', 'supplies', 'other'].includes(requestType)) {
    return res.status(400).json({ error: 'waiter_call_request_type_invalid' });
  }
  const branchInput = __westoModuleContext.normalizeDigits(String(req.body?.branchId ?? '')).trim();
  if (branchInput && !/^\d+$/u.test(branchInput)) {
    return res.status(400).json({ error: 'branch_invalid' });
  }
  const branchId = branchInput ? Number(branchInput) : Number(__westoModuleContext.defaultBranch()?.id);
  if (!Number.isSafeInteger(branchId) || branchId <= 0
      || !(__westoModuleContext.db.branches || []).some((branch) => Number(branch.id) === branchId && branch.active !== false)) {
    return res.status(400).json({ error: 'branch_invalid' });
  }
  const tableMatch = __westoModuleContext.tableForBranch(tableNo, branchId)
    || (__westoModuleContext.db.tables || []).find((table) => __westoModuleContext.tableBranchId(table) === branchId
      && table.active !== false && __westoModuleContext.tableNoBelongsToTable(tableNo, table.id));
  if (!tableMatch) return res.status(404).json({ error: 'waiter_call_table_not_found', message: 'میز فعال در شعبهٔ انتخاب‌شده پیدا نشد.' });
  if (tableMatch.active === false) return res.status(409).json({ error: 'waiter_call_table_inactive' });

  return __westoModuleContext.serializeAdminConfigMutation(branchId, async () => {
    __westoModuleContext.db.waiterCalls = Array.isArray(__westoModuleContext.db.waiterCalls) ? __westoModuleContext.db.waiterCalls : [];
    const activeCall = __westoModuleContext.db.waiterCalls.find((call) => Number(call.branchId) === branchId
      && ['open', 'new'].includes(String(call.status || ''))
      && __westoModuleContext.tableNoBelongsToTable(call.tableNo, tableMatch.id)
      && String(call.requestType || 'service').trim().toLowerCase() === requestType
      && String(call.note || '').trim().slice(0, 120) === note);
    if (activeCall) return res.json({ ok: true, idempotent: true, call: activeCall });

    const snapshot = __westoModuleContext.snapshotFinanceMutationState();
    const numericIds = __westoModuleContext.db.waiterCalls.map((call) => Number(call.id)).filter(Number.isSafeInteger);
    const call = {
      id: Math.max(0, ...numericIds) + 1,
      tableNo,
      requestType,
      note,
      branchId,
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    __westoModuleContext.db.waiterCalls.unshift(call);
    __westoModuleContext.db.waiterCalls = __westoModuleContext.db.waiterCalls.slice(0, 200);
    const auditEntry = __westoModuleContext.recordAudit(req, 'waiter_call.created', 'waiter_call', call.id, {
      tableNo: call.tableNo, requestType: call.requestType, note: call.note,
    }, branchId, { deferAppend: true });
    try {
      await __westoModuleContext.persistFinanceMutation(snapshot);
    } catch (error) {
      return res.status(error.status || 503).json({ error: error.code || 'waiter_call_persistence_failed', message: 'فراخوان ذخیره نشد؛ دوباره تلاش کنید.' });
    }

    __westoModuleContext.appendAuditAfterCommit(auditEntry);
    let eventPublished = true;
    try {
      __westoModuleContext.publishOperationalEvent('waiter_call.created', {
        callId: call.id,
        branchId: call.branchId,
        tableNo: call.tableNo,
        requestType: call.requestType,
        note: call.note,
      });
    } catch (error) {
      eventPublished = false;
      console.error('[waiter-call] committed event failed', error?.message || error);
    }
    return res.json({ ok: true, eventPublished, call });
  }).catch((error) => {
    if (res.headersSent) return undefined;
    return res.status(error.status || 503).json({ error: error.code || 'waiter_call_create_failed' });
  });
});
};
