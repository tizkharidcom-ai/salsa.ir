'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.patch('/api/admin/orders/:id', __westoModuleContext.requireCapability('orders.manage'), __westoModuleContext.serializeOrderMutationRoute(async (req, res) => {
  if (!['owner', 'manager'].includes(__westoModuleContext.effectiveRole(req.user))) return res.status(403).json({ error: 'supervisor_required' });
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (__westoModuleContext.db.orders || []).find((o) => Number(o.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  try {
    __westoModuleContext.assertUserBranchAccess(req.user, order.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  const allowed = ['pending_online', 'awaiting_confirmation', 'pay_at_cashier', 'sent_to_kitchen', 'paid', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done', 'cancelled'];
  const status = String(req.body?.status || '');
  if (!allowed.includes(status)) return res.status(400).json({ error: 'order_status_invalid' });
  if (status === 'paid' && order.paymentStatus !== 'paid') {
    return res.status(409).json({ error: 'payment_settlement_required', message: 'پرداخت را از مسیر تسویه ثبت کنید؛ تغییر وضعیت سفارش رسید دریافت وجه نیست.' });
  }
  if (status === String(order.status || '')) return res.json({ ok: true, idempotent: true, order: __westoModuleContext.operationalOrderResponse(order, req.user) });
  if (status === 'cancelled') {
    const cancellation = __westoModuleContext.orderCancellationGuard(order);
    if (!cancellation.ok) return res.status(409).json({ error: cancellation.code, message: cancellation.message });
  }
  if (!__westoModuleContext.canTransitionOrder(order, status)) {
    return res.status(409).json({ error: 'order_transition_invalid', current: order.status, allowed: __westoModuleContext.allowedOrderTransitions(order) });
  }
  const snapshot = __westoModuleContext.snapshotFinanceMutationState();
  try {
    if (status === 'cancelled' && __westoModuleContext.shouldReleaseOrderInventory(order)) {
      __westoModuleContext.adjustOrderInventory(order.items, 1, order.branchId);
    }
    __westoModuleContext.appendOrderStatus(order, status, req.user, { source: 'legacy-admin' });
    if (status === 'cancelled') {
      __westoModuleContext.reverseCancelledOrderFinancialEffects(order, req.user);
    }
    if (['done', 'picked_up', 'delivered'].includes(status)) __westoModuleContext.maybeAwardOrderLoyalty(order);
    __westoModuleContext.recordAudit(req, 'order.status_changed', 'order', order.id, { status, source: 'legacy-admin' }, order.branchId);
    await __westoModuleContext.persistFinanceMutation(snapshot);
  } catch (error) {
    __westoModuleContext.restoreFinanceMutationState(snapshot);
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
  try {
    __westoModuleContext.publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status });
    __westoModuleContext.neemBridge.enqueueOrder(order, (__westoModuleContext.db.paymentAttempts || []).find((item) => Number(item.orderId) === Number(order.id)) || null);
  } catch (error) { console.error('[order-post-commit] integration effect failed', error?.message || error); }
  res.json({ ok: true, order: __westoModuleContext.operationalOrderResponse(order, req.user) });
}));
};
