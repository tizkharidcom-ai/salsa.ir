'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.patch('/api/waiter/orders/:id/status', __westoModuleContext.requireCapability('service.manage'), __westoModuleContext.serializeOrderMutationRoute(async (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (__westoModuleContext.db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  try {
    __westoModuleContext.assertUserBranchAccess(req.user, order.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  const next = String(req.body?.status || '');
  if (next === 'done' && order.status === 'done') {
    return res.json({ ok: true, idempotent: true, order: __westoModuleContext.operationalOrderResponse(order, req.user) });
  }
  const allowed = order.fulfillment === 'dine_in' && order.status === 'ready' ? ['done'] : [];
  if (!allowed.includes(next)) return res.status(409).json({ error: 'waiter_transition_invalid', current: order.status, allowed });
  const snapshot = __westoModuleContext.snapshotFinanceMutationState();
  try {
  __westoModuleContext.appendOrderStatus(order, next, req.user, { source: 'waiter' });
  __westoModuleContext.maybeAwardOrderLoyalty(order);
  __westoModuleContext.recordAudit(req, 'order.status_changed', 'order', order.id, { status: next, source: 'waiter' }, order.branchId);
  await __westoModuleContext.persistFinanceMutation(snapshot);
  try { __westoModuleContext.publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: next }); }
  catch (eventError) { console.error('[waiter-status] post-commit event failed', eventError?.message || eventError); }
  res.json({ ok: true, order: __westoModuleContext.operationalOrderResponse(order, req.user) });
  } catch (error) {
    __westoModuleContext.restoreFinanceMutationState(snapshot);
    return res.status(error.status || 503).json({ error: error.code || 'order_persistence_failed', message: error.message });
  }
}));
};
