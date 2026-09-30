'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/delivery/orders/:id/reject', __westoModuleContext.requireCapability('delivery.manage'), async (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  if (!Number.isSafeInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'order_id_invalid' });
  const initial = (__westoModuleContext.db.orders || []).find((item) => Number(item.id) === targetId);
  if (!initial) return res.status(404).json({ error: 'not found' });
  const initialBranchId = __westoModuleContext.persistedOrderBranchId(initial);
  if (!initialBranchId) return res.status(409).json({ error: 'order_branch_invalid' });
  if (!(__westoModuleContext.db.branches || []).some((branch) => Number(branch.id) === initialBranchId && branch.active !== false)) {
    return res.status(409).json({ error: 'order_branch_inactive' });
  }
  try {
    __westoModuleContext.assertUserBranchAccess(req.user, initialBranchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }

  const rawReason = typeof req.body?.reason === 'string' ? req.body.reason : '';
  const reason = rawReason.replace(/\r\n?/gu, '\n').trim();
  if (!reason || reason.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(reason)) {
    return res.status(400).json({ error: 'delivery_rejection_reason_required', message: 'دلیل رد سفارش را کوتاه و روشن وارد کنید.' });
  }
  const idempotencyKey = String(req.get?.('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
  if (idempotencyKey && !__westoModuleContext.ORDER_IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    return res.status(400).json({ error: 'delivery_rejection_idempotency_invalid' });
  }

  return __westoModuleContext.serializeBranchOrderMutation(initial, async () => {
    const order = (__westoModuleContext.db.orders || []).find((item) => Number(item.id) === targetId);
    if (!order) return res.status(404).json({ error: 'not found' });
    if (__westoModuleContext.persistedOrderBranchId(order) !== initialBranchId) return res.status(409).json({ error: 'order_branch_changed' });
    try {
      __westoModuleContext.assertUserBranchAccess(req.user, initialBranchId);
    } catch (error) {
      return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
    }
    if (__westoModuleContext.normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo }) !== 'delivery') {
      return res.status(409).json({ error: 'delivery_rejection_not_applicable' });
    }

    const priorDecision = order.deliveryAcceptance;
    if (priorDecision?.status === 'rejected') {
      const provenanceValid = priorDecision.source === 'restaurant'
        && typeof priorDecision.reason === 'string' && priorDecision.reason.trim()
        && Number.isFinite(Date.parse(priorDecision.rejectedAt || ''))
        && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(String(priorDecision.reference || ''))
        && typeof priorDecision.rejectedBy?.phone === 'string' && priorDecision.rejectedBy.phone.trim()
        && ['owner', 'manager', 'cashier'].includes(String(priorDecision.rejectedBy.role || '').toLowerCase());
      if (!provenanceValid) return res.status(409).json({ error: 'delivery_rejection_provenance_invalid' });
      if (priorDecision.reason !== reason || (idempotencyKey && priorDecision.reference !== idempotencyKey)) {
        return res.status(409).json({ error: 'delivery_rejection_idempotency_conflict' });
      }
      const auditExists = (__westoModuleContext.db.auditLog || []).some((entry) => entry.action === 'delivery.order_rejected'
        && String(entry.targetId) === String(order.id)
        && String(entry.meta?.reference || '') === String(priorDecision.reference));
      if (!auditExists) {
        const auditSnapshot = __westoModuleContext.snapshotFinanceMutationState();
        const auditEntry = __westoModuleContext.recordAudit(req, 'delivery.order_rejected', 'order', order.id, {
          reference: priorDecision.reference, reason: priorDecision.reason,
          recoveredAfterCommit: true,
        }, initialBranchId, { deferAppend: true });
        try {
          await __westoModuleContext.persistFinanceMutation(auditSnapshot);
        } catch (error) {
          return res.status(error.status || 503).json({ error: error.code || 'delivery_rejection_audit_persistence_failed' });
        }
        __westoModuleContext.appendAuditAfterCommit(auditEntry);
      }
      return res.json({ ok: true, idempotent: true, order: __westoModuleContext.operationalOrderResponse(order, req.user) });
    }
    if (priorDecision?.status === 'accepted') {
      return res.status(409).json({ error: 'delivery_already_accepted' });
    }

    const status = String(order.status || '').trim().toLowerCase();
    const kitchenWasStarted = Boolean(order.startedAt)
      || ['sent_to_kitchen', 'preparing', 'ready', 'dispatched', 'delivered'].includes(status)
      || (Array.isArray(order.statusHistory) && order.statusHistory.some((entry) =>
        ['sent_to_kitchen', 'preparing', 'ready', 'dispatched', 'delivered'].includes(String(entry?.status || '').toLowerCase())));
    if (kitchenWasStarted) {
      return res.status(409).json({ error: 'delivery_rejection_after_kitchen_start' });
    }
    if (!['pending_online', 'awaiting_confirmation', 'pay_at_cashier', 'paid'].includes(status)) {
      return res.status(409).json({ error: 'delivery_rejection_state_invalid', current: order.status });
    }

    const actorRole = String(__westoModuleContext.effectiveRole(req.user) || '').trim().toLowerCase();
    const actorPhone = String(req.user?.phone || '').trim();
    if (!actorPhone || actorPhone.length > 64 || !['owner', 'manager', 'cashier'].includes(actorRole)) {
      return res.status(403).json({ error: 'delivery_rejection_actor_invalid' });
    }
    const referenceFromRequest = String(req.requestId || '');
    const reference = idempotencyKey
      || (/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(referenceFromRequest) ? referenceFromRequest : __westoModuleContext.crypto.randomUUID());
    if ((__westoModuleContext.db.orders || []).some((candidate) => Number(candidate.id) !== targetId
      && Number(candidate.branchId) === initialBranchId
      && String(candidate.deliveryAcceptance?.reference || '') === reference)) {
      return res.status(409).json({ error: 'delivery_rejection_idempotency_conflict' });
    }

    const snapshot = __westoModuleContext.snapshotFinanceMutationState();
    order.deliveryAcceptance = {
      status: 'rejected',
      source: 'restaurant',
      rejectedAt: new Date().toISOString(),
      rejectedBy: { phone: actorPhone, role: actorRole },
      reason,
      reference,
    };
    try {
      await __westoModuleContext.persistFinanceMutation(snapshot);
    } catch (error) {
      return res.status(error.status || 503).json({
        error: error.code || 'delivery_rejection_persistence_failed',
        message: 'رد سفارش ذخیره نشد؛ وضعیت قبلی حفظ شد.',
      });
    }

    const auditSnapshot = __westoModuleContext.snapshotFinanceMutationState();
    const auditEntry = __westoModuleContext.recordAudit(req, 'delivery.order_rejected', 'order', order.id, {
      reference, reason, previousStatus: status,
    }, initialBranchId, { deferAppend: true });
    try {
      await __westoModuleContext.persistFinanceMutation(auditSnapshot);
    } catch (error) {
      return res.status(error.status || 503).json({
        error: error.code || 'delivery_rejection_audit_persistence_failed',
        message: 'رد سفارش ثبت شد اما ثبت سابقه کامل نشد؛ وضعیت را تازه و دوباره بررسی کنید.',
      });
    }
    __westoModuleContext.appendAuditAfterCommit(auditEntry);
    let eventPublished = true;
    try {
      __westoModuleContext.publishOperationalEvent('order.updated', {
        orderId: order.id, branchId: initialBranchId, status: order.status, deliveryAcceptance: 'rejected',
      });
    } catch (error) {
      eventPublished = false;
      console.error('[delivery-rejection] committed event failed', error?.message || error);
    }
    return res.json({ ok: true, idempotent: false, eventPublished, order: __westoModuleContext.operationalOrderResponse(order, req.user) });
  }).catch((error) => {
    if (res.headersSent) return undefined;
    return res.status(error.status || 503).json({ error: error.code || 'delivery_rejection_failed', message: error.message });
  });
});
};
