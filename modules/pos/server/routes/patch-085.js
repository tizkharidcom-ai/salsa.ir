'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.patch('/api/cashier/orders/:id/status', __westoModuleContext.requireCapability('orders.manage'), __westoModuleContext.serializeOrderMutationRoute(async (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (__westoModuleContext.db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  try {
    __westoModuleContext.assertUserBranchAccess(req.user, order.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  const next = String(req.body?.status || '');
  if (next && next === String(order.status || '')) {
    return res.json({ ok: true, idempotent: true, order: __westoModuleContext.operationalOrderResponse(order, req.user) });
  }
  if (__westoModuleContext.normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo }) === 'delivery'
      && ['dispatched', 'delivered'].includes(next) && !__westoModuleContext.hasAcceptedDelivery(order)) {
    return res.status(409).json({ error: 'delivery_acceptance_required', message: 'ارسال و تحویل پیک بدون پذیرش ثبت‌شدهٔ رستوران ممکن نیست.' });
  }
  const allowed = {
    pay_at_cashier: ['cancelled'],
    awaiting_confirmation: ['cancelled'],
    ready: order.fulfillment === 'delivery' ? ['dispatched'] : order.fulfillment === 'pickup' ? ['picked_up'] : ['done'],
    dispatched: order.fulfillment === 'delivery' ? ['delivered'] : [],
  }[String(order.status || '')] || [];
  if (!allowed.includes(next)) return res.status(409).json({ error: 'cashier_transition_invalid', current: order.status, allowed });
  if (next === 'cancelled') {
    const cancellation = __westoModuleContext.orderCancellationGuard(order);
    if (!cancellation.ok) return res.status(409).json({ error: cancellation.code, message: cancellation.message });
  }
  const snapshot = __westoModuleContext.snapshotFinanceMutationState();
  try {
  if (next === 'cancelled' && __westoModuleContext.shouldReleaseOrderInventory(order)) {
    __westoModuleContext.adjustOrderInventory(order.items, 1, order.branchId);
  }
  __westoModuleContext.appendOrderStatus(order, next, req.user, { source: 'cashier' });
  if (['done', 'picked_up', 'delivered'].includes(next)) __westoModuleContext.maybeAwardOrderLoyalty(order);
  __westoModuleContext.recordAudit(req, 'order.status_changed', 'order', order.id, { status: next, source: 'cashier' }, order.branchId);
  await __westoModuleContext.persistFinanceMutation(snapshot);
  try { __westoModuleContext.publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: next }); }
  catch (eventError) { console.error('[cashier-status] post-commit event failed', eventError?.message || eventError); }
  res.json({ ok: true, order: __westoModuleContext.operationalOrderResponse(order, req.user) });
  } catch (error) {
    __westoModuleContext.restoreFinanceMutationState(snapshot);
    return res.status(error.status || 503).json({ error: error.code || 'order_persistence_failed', message: error.message });
  }
}));
};
