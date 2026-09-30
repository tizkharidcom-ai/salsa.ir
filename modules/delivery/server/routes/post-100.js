'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/delivery/orders/:id/accept', __westoModuleContext.requireCapability('delivery.manage'), async (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  if (!Number.isSafeInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'order_id_invalid' });
  const initial = (__westoModuleContext.db.orders || []).find((item) => Number(item.id) === targetId);
  if (!initial) return res.status(404).json({ error: 'not found' });
  const initialBranchId = Number(initial.branchId);
  if (!Number.isSafeInteger(initialBranchId) || initialBranchId <= 0) return res.status(409).json({ error: 'order_branch_invalid' });
  if (!(__westoModuleContext.db.branches || []).some((branch) => Number(branch.id) === initialBranchId && branch.active !== false)) {
    return res.status(409).json({ error: 'order_branch_inactive' });
  }
  try {
    __westoModuleContext.assertUserBranchAccess(req.user, initialBranchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  const idempotencyKey = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
  if (process.env.NODE_ENV === 'production' && !idempotencyKey) {
    return res.status(400).json({ error: 'delivery_acceptance_idempotency_required', message: 'برای پذیرش سفارش، کلید یکتای درخواست لازم است.' });
  }
  if (idempotencyKey && !__westoModuleContext.ORDER_IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    return res.status(400).json({ error: 'delivery_acceptance_idempotency_invalid' });
  }

  return __westoModuleContext.serializeBranchOrderMutation(initial, async () => {
    const order = (__westoModuleContext.db.orders || []).find((item) => Number(item.id) === targetId);
    if (!order) return res.status(404).json({ error: 'not found' });
    if (Number(order.branchId) !== initialBranchId) return res.status(409).json({ error: 'order_branch_changed' });
    try {
      __westoModuleContext.assertUserBranchAccess(req.user, order.branchId);
    } catch (error) {
      return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
    }
    if (__westoModuleContext.normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo }) !== 'delivery') {
      return res.status(409).json({ error: 'delivery_acceptance_not_applicable' });
    }
    if (order.deliveryAcceptance?.status === 'accepted') {
      const acceptance = __westoModuleContext.validateDeliveryAcceptance(order);
      if (!acceptance.ok) {
        return res.status(409).json({ error: 'delivery_acceptance_provenance_invalid', message: 'پذیرش قبلی قابل انتساب و تأیید نیست؛ این سفارش نیازمند بررسی است.' });
      }
      if (idempotencyKey && acceptance.reference !== idempotencyKey) {
        return res.status(409).json({ error: 'delivery_acceptance_idempotency_conflict' });
      }
      return res.json({ ok: true, idempotent: true, order: __westoModuleContext.operationalOrderResponse(order, req.user) });
    }
    if (idempotencyKey && (__westoModuleContext.db.orders || []).some((candidate) =>
      Number(candidate.id) !== targetId
      && Number(candidate.branchId) === initialBranchId
      && String(candidate.deliveryAcceptance?.reference || '') === idempotencyKey)) {
      return res.status(409).json({ error: 'delivery_acceptance_idempotency_conflict' });
    }
    if (order.deliveryAcceptance?.status === 'rejected') {
      return res.status(409).json({ error: 'delivery_acceptance_rejected' });
    }
    const status = String(order.status || '');
    const kitchenWasStarted = Boolean(order.startedAt)
      || ['sent_to_kitchen', 'preparing', 'ready', 'dispatched', 'delivered'].includes(status)
      || (Array.isArray(order.statusHistory) && order.statusHistory.some((entry) => ['sent_to_kitchen', 'preparing', 'ready', 'dispatched', 'delivered'].includes(String(entry?.status || ''))));
    if (kitchenWasStarted) {
      return res.status(409).json({ error: 'delivery_acceptance_after_kitchen_start', message: 'پذیرش باید پیش از ورود سفارش به آشپزخانه ثبت شود؛ این سفارش نیازمند بررسی سابقه است.' });
    }
    if (!['pending_online', 'awaiting_confirmation', 'pay_at_cashier', 'paid'].includes(status)) {
      return res.status(409).json({ error: 'delivery_acceptance_state_invalid', current: status });
    }

    const snapshot = __westoModuleContext.snapshotFinanceMutationState();
    const acceptedAt = new Date().toISOString();
    const requestReference = String(req.requestId || '');
    const reference = idempotencyKey || (/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(requestReference) ? requestReference : __westoModuleContext.crypto.randomUUID());
    const deliveryAcceptance = {
      status: 'accepted',
      acceptedAt,
      acceptedBy: { phone: String(req.user.phone || ''), role: __westoModuleContext.effectiveRole(req.user) },
      source: 'restaurant',
      reference,
    };
    const acceptance = __westoModuleContext.validateDeliveryAcceptance({ fulfillment: 'delivery', deliveryAcceptance });
    if (!acceptance.ok) {
      return res.status(403).json({ error: 'delivery_acceptance_actor_invalid', message: 'حساب کاربری مجاز برای پذیرش سفارش معتبر نیست.' });
    }
    order.deliveryAcceptance = deliveryAcceptance;
    const nextStatus = __westoModuleContext.nextOrderStatusAfterDeliveryAcceptance(order);
    if (nextStatus && __westoModuleContext.canTransitionOrder(order, nextStatus)) {
      __westoModuleContext.appendOrderStatus(order, nextStatus, req.user, { source: 'restaurant-delivery-acceptance', acceptanceReference: reference });
    }
    __westoModuleContext.recordAudit(req, 'delivery.order_accepted', 'order', order.id, {
      reference,
      previousStatus: status,
      resultingStatus: order.status,
      paymentStatus: __westoModuleContext.paymentStatusFor(order),
    }, order.branchId);
    try {
      await __westoModuleContext.persistFinanceMutation(snapshot);
    } catch (error) {
      return res.status(error.status || 503).json({ error: error.code || 'delivery_acceptance_persistence_failed', message: error.message });
    }
    try {
      __westoModuleContext.publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status, deliveryAcceptance: 'accepted' });
      __westoModuleContext.neemBridge.enqueueOrder(order, (__westoModuleContext.db.paymentAttempts || []).find((item) => Number(item.orderId) === Number(order.id)) || null);
    } catch (error) {
      console.error('[delivery-acceptance] post-commit event failed', error?.message || error);
    }
    return res.json({ ok: true, idempotent: false, order: __westoModuleContext.operationalOrderResponse(order, req.user) });
  }).catch((error) => {
    console.error('[delivery-acceptance] mutation failed', error?.message || error);
    if (res.headersSent) return undefined;
    return res.status(error.status || 503).json({ error: error.code || 'delivery_acceptance_failed', message: error.message || 'پذیرش سفارش ثبت نشد.' });
  });
});
};
