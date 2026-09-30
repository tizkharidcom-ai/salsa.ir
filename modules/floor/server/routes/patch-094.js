'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.patch('/api/waiter/orders/:id/move-table', __westoModuleContext.requireCapability('orders.move_table'), async (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  if (!Number.isSafeInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'order_id_invalid' });
  const initial = (__westoModuleContext.db.orders || []).find((item) => Number(item.id) === targetId);
  if (!initial) return res.status(404).json({ error: 'not found' });
  const initialBranchId = __westoModuleContext.persistedOrderBranchId(initial);
  if (!initialBranchId) return res.status(409).json({ error: 'order_branch_invalid' });
  try {
    __westoModuleContext.assertUserBranchAccess(req.user, initialBranchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  const nextTable = String(req.body?.tableNo || '').trim();
  if (!nextTable) return res.status(400).json({ error: 'table_required' });
  return __westoModuleContext.serializeBranchOrderMutation(initial, async () => {
    const order = (__westoModuleContext.db.orders || []).find((item) => Number(item.id) === targetId);
    if (!order) return res.status(404).json({ error: 'not found' });
    if (__westoModuleContext.persistedOrderBranchId(order) !== initialBranchId) {
      return res.status(409).json({ error: 'order_branch_changed' });
    }
    try {
      __westoModuleContext.assertUserBranchAccess(req.user, initialBranchId);
    } catch (error) {
      return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
    }
    if (!(__westoModuleContext.db.branches || []).some((branch) => Number(branch.id) === initialBranchId && branch.active !== false)) {
      return res.status(409).json({ error: 'order_branch_inactive' });
    }

    const fulfillment = __westoModuleContext.normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo });
    const status = String(order.status || '').trim().toLowerCase();
    const invoiceStatus = String(order.invoiceStatus || '').trim().toLowerCase();
    const explicitlyClosed = order.closed === true || order.invoiceClosed === true
      || Boolean(order.closedAt || order.invoiceClosedAt)
      || ['closed', 'settled', 'paid', 'cancelled', 'canceled', 'void', 'refunded'].includes(invoiceStatus);
    const serviceComplete = ['done', 'completed', 'picked_up', 'delivered'].includes(status);
    const unpaidCompletion = ['unpaid', 'partial', 'pending', 'failed', 'unknown'].includes(__westoModuleContext.paymentStatusFor(order));
    const knownOpenStatus = ['draft', 'pay_at_cashier', 'awaiting_confirmation', 'pending_online',
      'sent_to_kitchen', 'preparing', 'ready', 'paid', 'dispatched', 'done', 'completed', 'picked_up', 'delivered'];
    if (fulfillment !== 'dine_in' || explicitlyClosed || !knownOpenStatus.includes(status)
        || status === 'cancelled' || (serviceComplete && !unpaidCompletion)) {
      return res.status(409).json({ error: 'order_not_open_dine_in', message: 'فقط سفارش حضوریِ باز و تسویه‌نشده قابل انتقال است.' });
    }

    const targetTable = __westoModuleContext.tableForBranch(nextTable, initialBranchId);
    if (!targetTable || Number(__westoModuleContext.tableBranchId(targetTable)) !== initialBranchId) {
      return res.status(404).json({ error: 'table_not_found', message: 'میز مقصد در شعبهٔ فعال پیدا نشد.' });
    }
    if (targetTable.active === false) {
      return res.status(409).json({ error: 'table_inactive', message: 'میز مقصد غیرفعال است.' });
    }
    const oldTable = order.tableNo || null;
    if (__westoModuleContext.tableNoBelongsToTable(oldTable, targetTable.id)) {
      const movedAuditExists = (__westoModuleContext.db.auditLog || []).some((entry) => entry.action === 'order.table_moved'
        && String(entry.targetId) === String(order.id)
        && String(entry.meta?.nextTable || '') === String(order.tableNo));
      if (!movedAuditExists) {
        const auditSnapshot = __westoModuleContext.snapshotFinanceMutationState();
        const auditEntry = __westoModuleContext.recordAudit(req, 'order.table_moved', 'order', order.id, {
          oldTable: null, nextTable: String(order.tableNo), recoveredAfterCommit: true,
        }, initialBranchId, { deferAppend: true });
        try {
          await __westoModuleContext.persistFinanceMutation(auditSnapshot);
        } catch (error) {
          return res.status(error.status || 503).json({
            error: error.code || 'order_table_move_audit_persistence_failed',
            message: 'انتقال انجام شده اما ثبت سابقه کامل نشد؛ وضعیت را تازه و دوباره بررسی کنید.',
          });
        }
        __westoModuleContext.appendAuditAfterCommit(auditEntry);
      }
      return res.json({ ok: true, idempotent: true, order: __westoModuleContext.operationalOrderResponse(order, req.user), oldTable, nextTable: oldTable });
    }

    const occupied = (__westoModuleContext.db.orders || []).some((candidate) => Number(candidate.id) !== targetId
      && Number(candidate.branchId) === initialBranchId
      && __westoModuleContext.waitlist.tableIdsOverlap(candidate.tableNo, targetTable.id)
      && __westoModuleContext.activeDineInOrderOnTable(candidate, candidate.tableNo, initialBranchId));
    if (occupied || ['busy', 'occupied'].includes(String(targetTable.state || '').trim().toLowerCase())) {
      return res.status(409).json({ error: 'table_occupied', message: 'میز مقصد در حال سرویس است؛ میز دیگری انتخاب کنید.' });
    }
    if (String(targetTable.state || '').trim().toLowerCase() === 'reserved') {
      return res.status(409).json({ error: 'table_reserved', message: 'میز مقصد رزرو شده است؛ میز دیگری انتخاب کنید.' });
    }

    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const reserved = (__westoModuleContext.db.reservations || []).some((entry) => {
      if (Number(entry.branchId) !== initialBranchId || !__westoModuleContext.waitlist.tableIdsOverlap(entry.tableNo, targetTable.id)) return false;
      if (__westoModuleContext.waitlist.isWaitlist(entry)) return String(entry.status || '') === 'seated';
      const reservationStatus = String(entry.status || '').trim().toLowerCase();
      if (!['pending', 'confirmed', 'seated'].includes(reservationStatus)) return false;
      const dateKey = String(entry.date || '').slice(0, 10);
      return reservationStatus === 'seated'
        || __westoModuleContext.waitlist.reservationBlocksTable(entry, now, __westoModuleContext.db.reservationSettings?.slotMinutes)
        || !/^\d{4}-\d{2}-\d{2}$/u.test(dateKey)
        || dateKey > todayKey;
    });
    if (reserved) {
      return res.status(409).json({ error: 'table_reserved', message: 'میز مقصد برای رزرو یا مهمانِ نشسته نگه داشته شده است.' });
    }

    const snapshot = __westoModuleContext.snapshotFinanceMutationState();
    const assignedTable = String(targetTable.id);
    order.tableNo = assignedTable;
    order.checkNo = __westoModuleContext.nextDineInCheckNo(initialBranchId, assignedTable, assignedTable);
    try {
      await __westoModuleContext.persistFinanceMutation(snapshot);
    } catch (error) {
      return res.status(error.status || 503).json({
        error: error.code || 'order_table_move_persistence_failed',
        message: 'انتقال میز ذخیره نشد؛ وضعیت قبلی سفارش حفظ شد.',
      });
    }

    const auditSnapshot = __westoModuleContext.snapshotFinanceMutationState();
    const auditEntry = __westoModuleContext.recordAudit(req, 'order.table_moved', 'order', order.id, {
      oldTable, nextTable: assignedTable,
    }, initialBranchId, { deferAppend: true });
    try {
      await __westoModuleContext.persistFinanceMutation(auditSnapshot);
    } catch (error) {
      return res.status(error.status || 503).json({
        error: error.code || 'order_table_move_audit_persistence_failed',
        message: 'انتقال ذخیره شد اما ثبت سابقه کامل نشد؛ وضعیت را تازه و دوباره بررسی کنید.',
      });
    }
    __westoModuleContext.appendAuditAfterCommit(auditEntry);
    let eventPublished = true;
    try {
      __westoModuleContext.publishOperationalEvent('order.updated', { orderId: order.id, branchId: initialBranchId, tableNo: assignedTable });
    } catch (error) {
      eventPublished = false;
      console.error('[waiter-move-table] committed event failed', error?.message || error);
    }
    return res.json({ ok: true, idempotent: false, eventPublished, order: __westoModuleContext.operationalOrderResponse(order, req.user), oldTable, nextTable: assignedTable });
  }).catch((error) => {
    if (res.headersSent) return undefined;
    return res.status(error.status || 503).json({ error: error.code || 'order_table_move_failed', message: error.message });
  });
});
};
