'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.patch('/api/waiter/waitlist/:id', __westoModuleContext.requireCapability('reservations.receive'), async (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const entry = (__westoModuleContext.db.reservations || []).find((item) => Number(item.id) === targetId && __westoModuleContext.waitlist.isWaitlist(item));
  if (!entry) return res.status(404).json({ error: 'waitlist_not_found', message: 'مهمان موردنظر در صف پیدا نشد.' });
  try { __westoModuleContext.assertUserBranchAccess(req.user, entry.branchId); } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  return __westoModuleContext.serializeWaitlistMutation(entry.branchId, async () => {
    const current = (__westoModuleContext.db.reservations || []).find((item) => Number(item.id) === targetId && __westoModuleContext.waitlist.isWaitlist(item));
    if (!current) return res.status(404).json({ error: 'waitlist_not_found', message: 'مهمان موردنظر در صف پیدا نشد.' });
    try { __westoModuleContext.assertUserBranchAccess(req.user, current.branchId); } catch (error) {
      return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
    }

    let prepared;
    const operationNow = new Date();
    try {
      prepared = __westoModuleContext.waitlist.prepareWaitlistUpdate({
        entry: current,
        records: __westoModuleContext.db.reservations || [],
        tables: __westoModuleContext.db.tables || [],
        body: req.body || {},
        maxParty: __westoModuleContext.db.reservationSettings?.maxParty || 40,
        now: operationNow.toISOString(),
        isTableBusy: (tableNo, table, candidate) => {
          const orderBusy = (__westoModuleContext.db.orders || []).some((order) => __westoModuleContext.activeDineInOrderOnTable(order, table.id, candidate.branchId));
          if (orderBusy) return true;
          return (__westoModuleContext.db.reservations || []).some((item) => item !== candidate
            && Number(item.branchId) === Number(candidate.branchId)
            && __westoModuleContext.waitlist.tableIdsOverlap(item.tableNo, tableNo)
            && ((__westoModuleContext.waitlist.isWaitlist(item) && item.status === 'seated')
              || (!__westoModuleContext.waitlist.isWaitlist(item) && __westoModuleContext.waitlist.reservationBlocksTable(
                item,
                operationNow,
                __westoModuleContext.db.reservationSettings?.slotMinutes,
              ))));
        },
      });
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.code || 'waitlist_update_invalid', message: error.message, current: current.status });
    }
    if (prepared.idempotent) return res.json({ ok: true, idempotent: true, entry: __westoModuleContext.publicWaitlistEntry(current) });

    const before = JSON.parse(JSON.stringify(current));
    const hadAuditLog = Array.isArray(__westoModuleContext.db.auditLog);
    const auditLogBefore = hadAuditLog ? __westoModuleContext.db.auditLog.slice() : null;
    Object.assign(current, prepared.entry);
    try {
      __westoModuleContext.recordAudit(req, 'waitlist.updated', 'reservation', current.id, { status: current.status, tableNo: current.tableNo || null }, current.branchId);
      await __westoModuleContext.save({ requireDurable: true });
    } catch (error) {
      Object.assign(current, before);
      if (hadAuditLog) __westoModuleContext.db.auditLog = auditLogBefore;
      else delete __westoModuleContext.db.auditLog;
      return res.status(error.status || 503).json({ error: error.code || 'waitlist_persistence_failed', message: 'تغییر صف پایدار نشد؛ دوباره همگام‌سازی کنید.', current: current.status });
    }
    try { __westoModuleContext.publishOperationalEvent('waitlist.updated', { waitlistId: current.id, branchId: current.branchId, status: current.status, tableNo: current.tableNo || null }); }
    catch (eventError) { console.error('[waitlist-update] post-commit event failed', eventError?.message || eventError); }
    return res.json({ ok: true, entry: __westoModuleContext.publicWaitlistEntry(current) });
  });
});
};
