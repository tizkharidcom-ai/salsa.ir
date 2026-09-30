'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.patch('/api/kitchen/orders/:id', __westoModuleContext.requireCapability('kitchen.manage'), __westoModuleContext.serializeOrderMutationRoute(async (req, res) => {
  const branchId = __westoModuleContext.requestedKdsBranch(req);
  if (!branchId) return res.status(400).json({ error: 'branch_invalid' });
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (__westoModuleContext.db.orders || []).find((o) => Number(o.id) === targetId && Number(o.branchId) === Number(branchId));
  if (!order) return res.status(404).json({ error: 'not found' });
  if (__westoModuleContext.normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo }) === 'delivery' && !__westoModuleContext.hasAcceptedDelivery(order)) {
    return res.status(409).json({ error: 'delivery_acceptance_required', message: 'این سفارش تا ثبت پذیرش رستوران وارد آشپزخانه نمی‌شود.' });
  }
  if (!__westoModuleContext.isKitchenOrderPaymentEligible(order, __westoModuleContext.paymentStatusFor(order))) {
    return res.status(409).json({ error: 'payment_reconciliation_required', message: 'وضعیت پرداخت این سفارش باید پیش از ورود به صف آشپزخانه تطبیق شود.' });
  }
  const legacyStatus = String(req.body?.status || '');
  const requestedAction = String(req.body?.action || '');
  const actionName = requestedAction || (legacyStatus === 'preparing' ? 'start_ticket' : legacyStatus === 'ready' ? 'complete_ticket' : '');
  const snapshot = __westoModuleContext.snapshotFinanceMutationState();
  const kds = __westoModuleContext.ensureKdsState(order);
  const now = new Date().toISOString();
  const actor = { phone: req.user.phone, name: req.user.name || '' };
  const lines = __westoModuleContext.kitchenLines(order);
  const lineKey = String(req.body?.lineKey || '');
  const line = lines.find((entry) => entry.key === lineKey);
  const isNew = ['sent_to_kitchen', 'paid'].includes(order.status);
  if (!['sent_to_kitchen', 'paid', 'preparing', 'ready'].includes(String(order.status || ''))) {
    return res.status(409).json({ error: 'kitchen_transition_invalid', current: order.status, allowed: [] });
  }
  const start = () => {
    if (isNew && __westoModuleContext.canTransitionOrder(order, 'preparing')) __westoModuleContext.appendOrderStatus(order, 'preparing', req.user, { source: 'kds', action: actionName });
  };
  let auditAction = `kds.${actionName || 'invalid'}`;

  if (actionName === 'start_ticket') {
    if (order.status === 'preparing') return res.json(__westoModuleContext.kdsIdempotent(order));
    if (!isNew) return res.status(409).json({ error: 'kitchen_transition_invalid', current: order.status, allowed: ['preparing'] });
    if (!lines.length) return res.status(409).json({ error: 'kds_ticket_incomplete', incomplete: (order.items || []).map((item, index) => __westoModuleContext.kdsLineKey(item, index)) });
    start();
  } else if (actionName === 'complete_item') {
    if (!line) return res.status(409).json({ error: 'kds_item_invalid', lineKey, current: order.status });
    // A lost response after the final item completed must be safely retryable
    // even though that completion already moved the ticket to `ready`.
    if (kds.itemStates[lineKey]?.completedAt) return res.json(__westoModuleContext.kdsIdempotent(order));
    if (order.status === 'ready') return res.status(409).json({ error: 'kds_item_invalid', lineKey, current: order.status });
    start();
    kds.itemStates[lineKey] = { completedAt: now, completedBy: actor };
    const allComplete = __westoModuleContext.kitchenHeldCourseItems(order).length === 0
      && __westoModuleContext.kitchenLines(order).every((entry) => kds.itemStates[entry.key]?.completedAt);
    if (allComplete && order.status === 'preparing' && __westoModuleContext.canTransitionOrder(order, 'ready')) {
      __westoModuleContext.appendOrderStatus(order, 'ready', req.user, { source: 'kds', action: 'all_items_complete' });
      kds.completedAt = order.readyAt;
    }
  } else if (actionName === 'complete_station') {
    const station = String(req.body?.station || '');
    if (!['hot', 'cold', 'bar'].includes(station)) return res.status(409).json({ error: 'kds_station_invalid', station, current: order.status });
    const stationLines = lines.filter((entry) => entry.station === station);
    if (!stationLines.length) return res.status(409).json({ error: 'kds_station_empty', station });
    // A retried station completion is a no-op even when another station is
    // still working and the whole order remains `preparing`. Do not persist,
    // audit, or publish the same station completion again.
    if (stationLines.every((entry) => kds.itemStates[entry.key]?.completedAt)) return res.json(__westoModuleContext.kdsIdempotent(order));
    if (order.status === 'ready') return res.status(409).json({ error: 'kds_station_invalid', station, current: order.status });
    start();
    for (const entry of stationLines) kds.itemStates[entry.key] = kds.itemStates[entry.key] || { completedAt: now, completedBy: actor };
    const allComplete = __westoModuleContext.kitchenHeldCourseItems(order).length === 0
      && __westoModuleContext.kitchenLines(order).every((entry) => kds.itemStates[entry.key]?.completedAt);
    if (allComplete && order.status === 'preparing' && __westoModuleContext.canTransitionOrder(order, 'ready')) {
      __westoModuleContext.appendOrderStatus(order, 'ready', req.user, { source: 'kds', action: 'all_stations_complete' });
      kds.completedAt = order.readyAt;
    }
  } else if (actionName === 'undo_item') {
    if (!line || !kds.itemStates[lineKey]?.completedAt) return res.json(__westoModuleContext.kdsIdempotent(order));
    if (order.status === 'ready') {
      __westoModuleContext.appendOrderStatus(order, 'preparing', req.user, { source: 'kds', action: 'undo_item' });
      order.readyAt = null;
      kds.completedAt = null;
    }
    delete kds.itemStates[lineKey];
  } else if (actionName === 'complete_ticket') {
    const incomplete = lines.filter((entry) => !kds.itemStates[entry.key]?.completedAt);
    const heldKeys = (order.items || [])
      .map((item, index) => String(item.courseStatus || 'fired').toLowerCase() === 'hold' ? __westoModuleContext.kdsLineKey(item, index) : null)
      .filter(Boolean);
    if (!lines.length || incomplete.length || heldKeys.length) {
      return res.status(409).json({ error: 'kds_ticket_incomplete', incomplete: [...incomplete.map((entry) => entry.key), ...heldKeys] });
    }
    // Validate the persisted ticket even for a replay. A stale/corrupt `ready`
    // status must not be acknowledged as complete when its items are not.
    if (order.status === 'ready') return res.json(__westoModuleContext.kdsIdempotent(order));
    start();
    if (order.status !== 'preparing' || !__westoModuleContext.canTransitionOrder(order, 'ready')) return res.status(409).json({ error: 'kitchen_transition_invalid', current: order.status, allowed: ['ready'] });
    __westoModuleContext.appendOrderStatus(order, 'ready', req.user, { source: 'kds', action: 'complete_ticket' });
    kds.completedAt = order.readyAt;
  } else if (actionName === 'recall_ticket') {
    if (order.status === 'preparing') return res.json(__westoModuleContext.kdsIdempotent(order));
    if (order.status !== 'ready') return res.status(409).json({ error: 'kitchen_recall_invalid', current: order.status });
    __westoModuleContext.appendOrderStatus(order, 'preparing', req.user, { source: 'kds', action: 'recall_ticket' });
    order.readyAt = null;
    kds.completedAt = null;
    kds.itemStates = {};
  } else if (actionName === 'prioritize') {
    if (order.status === 'ready') return res.status(409).json({ error: 'kitchen_priority_invalid', current: order.status });
    kds.priority = req.body?.priority !== false;
    kds.priorityAt = kds.priority ? now : null;
  } else if (actionName === 'note') {
    order.kitchenNote = String(req.body?.note || '').trim().slice(0, 240);
    kds.needsAttention = !!order.kitchenNote;
  } else {
    return res.status(409).json({ error: 'kitchen_transition_invalid', current: order.status, allowed: ['start_ticket', 'complete_item', 'complete_station', 'complete_ticket', 'recall_ticket', 'prioritize', 'note'] });
  }

  __westoModuleContext.recordAudit(req, auditAction, 'order', order.id, { action: actionName, lineKey: lineKey || null, status: order.status }, order.branchId);
  try {
    await __westoModuleContext.persistFinanceMutation(snapshot);
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.code || 'kds_persistence_failed', message: 'تغییر وضعیت آشپزخانه پایدار نشد؛ دوباره همگام‌سازی کنید.' });
  }
  let eventPublished = true;
  try {
    __westoModuleContext.publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status, kdsAction: actionName });
  } catch (error) {
    eventPublished = false;
    console.error('[kds] committed state event failed', error?.message || error);
  }
  res.json({ ok: true, eventPublished, order: __westoModuleContext.kitchenTicket(order) });
}));
};
