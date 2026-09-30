'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/waiter/orders/:id/split', __westoModuleContext.requireCapability('orders.split'), __westoModuleContext.serializeOrderMutationRoute(async (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (__westoModuleContext.db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  try {
    __westoModuleContext.assertUserBranchAccess(req.user, order.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  const idempotencyKey = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
  if (process.env.NODE_ENV === 'production' && !idempotencyKey) {
    return res.status(400).json({ error: 'order_split_idempotency_required', message: 'برای تفکیک فاکتور در محیط تولید، کلید یکتای درخواست لازم است.' });
  }
  if (idempotencyKey && !__westoModuleContext.ORDER_IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    return res.status(400).json({ error: 'order_split_idempotency_invalid' });
  }
  const splitMode = req.body?.mode || 'seat';
  if (!['seat', 'items'].includes(splitMode)) {
    return res.status(400).json({ error: 'split_mode_invalid' });
  }
  const targetSeat = Number(req.body?.seat || 0);
  const requestedItemIndices = Array.isArray(req.body?.itemIndices)
    ? [...new Set(req.body.itemIndices.map(Number).filter((index) => Number.isInteger(index) && index >= 0))]
    : [];
  const requestFingerprint = idempotencyKey ? __westoModuleContext.checkoutIdempotencyFingerprint({
    orderId: order.id,
    branchId: __westoModuleContext.persistedOrderBranchId(order),
    mode: splitMode,
    seat: splitMode === 'seat' ? targetSeat : null,
    itemIndices: splitMode === 'items' ? requestedItemIndices : [],
  }, req.user) : null;
  if (idempotencyKey && order.splitOperations != null && !Array.isArray(order.splitOperations)) {
    return res.status(409).json({ error: 'idempotency_replay_unavailable', message: 'سابقهٔ تفکیک سفارش معتبر نیست؛ پیش از تکرار، فاکتورهای مرتبط را دستی تطبیق دهید.' });
  }
  const splitOperations = Array.isArray(order.splitOperations) ? order.splitOperations : [];
  const priorSplit = idempotencyKey
    ? splitOperations.find((operation) => operation?.idempotencyKey === idempotencyKey)
    : null;
  if (priorSplit) {
    if (!/^[a-f0-9]{64}$/i.test(String(priorSplit.requestFingerprint || ''))) {
      return res.status(409).json({ error: 'idempotency_replay_unavailable', message: 'اطلاعات بازیابی تفکیک کامل نیست؛ سفارش‌ها را بررسی کنید و درخواست را تکرار نکنید.' });
    }
    if (priorSplit.requestFingerprint !== requestFingerprint) {
      return res.status(409).json({ error: 'idempotency_key_conflict' });
    }
    const replayOrder = (__westoModuleContext.db.orders || []).find((item) => Number(item.id) === Number(priorSplit.splitOrderId));
    if (!replayOrder || Number(replayOrder.splitFromOrderId) !== Number(order.id)
        || Number(replayOrder.branchId) !== Number(order.branchId)) {
      return res.status(409).json({ error: 'idempotency_replay_unavailable', message: 'فاکتور حاصل از تفکیک دیگر در دسترس نیست؛ وضعیت را دستی تطبیق دهید.' });
    }
    return res.json({ ok: true, idempotent: true, primaryOrder: __westoModuleContext.operationalOrderResponse(order, req.user), splitOrder: __westoModuleContext.operationalOrderResponse(replayOrder, req.user) });
  }
  if (['paid', 'partial', 'pending', 'unknown'].includes(String(order.paymentStatus || '').toLowerCase())
    || order.status === 'paid'
    || __westoModuleContext.receivedAmount(order) > 0) {
    return res.status(409).json({ error: 'order_split_locked', message: 'تا تعیین تکلیف پرداخت یا ثبت دریافت، تفکیک فاکتور ممکن نیست؛ ابتدا وضعیت صندوق را بررسی کنید.' });
  }
  const splitLifecycle = __westoModuleContext.orderSplitLifecycleGuard(order);
  if (!splitLifecycle.ok) {
    return res.status(409).json({ error: splitLifecycle.code, message: splitLifecycle.message });
  }
  if (__westoModuleContext.normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo }) !== 'dine_in') {
    return res.status(409).json({ error: 'order_split_dine_in_only', message: 'تفکیک فاکتور فقط برای سفارش حضوری مجاز است.' });
  }
  if (!Array.isArray(order.items) || order.items.length <= 1) {
    return res.status(400).json({ error: 'cannot_split_single_item_order' });
  }
  const selectedItemIndices = requestedItemIndices.filter((index) => index < order.items.length);

  const splitItems = [];
  const remainingItems = [];

  order.items.forEach((item, idx) => {
    let shouldMove = false;
    if (splitMode === 'seat' && targetSeat > 0) {
      shouldMove = Number(item.seat) === targetSeat;
    } else if (splitMode === 'items') {
      shouldMove = selectedItemIndices.includes(idx);
    }
    if (shouldMove) splitItems.push(item);
    else remainingItems.push(item);
  });

  if (!splitItems.length || !remainingItems.length) {
    return res.status(400).json({ error: 'split_must_leave_items_in_both_orders' });
  }

  const lineSubtotal = (item) => Number(item.lineTotal) || Number(item.price) * Number(item.qty);
  const splitSubtotal = splitItems.reduce((sum, item) => sum + lineSubtotal(item), 0);
  const remainingSubtotal = remainingItems.reduce((sum, item) => sum + lineSubtotal(item), 0);
  const discountAllocation = __westoModuleContext.allocateOrderSplitDiscount(order.discount || 0, splitSubtotal, remainingSubtotal);
  if (!discountAllocation) {
    return res.status(409).json({ error: 'order_split_pricing_invalid', message: 'مبلغ اقلام یا تخفیف سفارش برای تفکیک معتبر نیست.' });
  }

  const snapshot = __westoModuleContext.snapshotFinanceMutationState();
  order.items = remainingItems;
  order.subtotal = remainingSubtotal;
  order.discount = discountAllocation.remainingDiscount;
  order.total = remainingSubtotal - discountAllocation.remainingDiscount;
  order.balanceDue = order.total;
  order.splitCount = Math.max(0, Number(order.splitCount) || 0) + 1;

  const newSubId = __westoModuleContext.nextId(__westoModuleContext.db.orders);
  const baseTable = __westoModuleContext.canonicalTableNo(order.tableNo).replace(/-\d+$/u, '') || String(order.tableNo || '').trim();
  const subTableNo = __westoModuleContext.nextDineInCheckNo(order.branchId, baseTable, `${baseTable}-2`);
  const subOrder = {
    ...JSON.parse(JSON.stringify(order)),
    id: newSubId,
    orderNo: `W-${String(Date.now()).slice(-6)}-${newSubId}`,
    tableNo: subTableNo,
    checkNo: subTableNo,
    items: splitItems,
    subtotal: splitSubtotal,
    discount: discountAllocation.selectedDiscount,
    total: splitSubtotal - discountAllocation.selectedDiscount,
    checkNo: subTableNo,
    createdAt: new Date().toISOString(),
    statusAt: new Date().toISOString(),
    paymentStatus: 'unpaid',
    amountPaid: 0,
    partialPayments: [],
    balanceDue: splitSubtotal - discountAllocation.selectedDiscount,
    splitFromOrderId: order.id,
    splitMode,
    splitSeat: splitMode === 'seat' ? targetSeat : null,
    splitItemIndices: splitMode === 'items' ? selectedItemIndices : [],
    splitAt: new Date().toISOString(),
  };
  __westoModuleContext.db.orders.unshift(subOrder);
  if (idempotencyKey) {
    order.splitOperations = [
      ...splitOperations,
      {
        idempotencyKey,
        requestFingerprint,
        splitOrderId: subOrder.id,
        createdAt: subOrder.splitAt,
      },
    ];
  }

  __westoModuleContext.recordAudit(req, 'order.split', 'order', order.id, { newOrderId: subOrder.id, subTableNo }, order.branchId);
  try {
    await __westoModuleContext.persistFinanceMutation(snapshot);
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.code || 'order_split_persistence_failed', message: 'تفکیک سفارش به‌صورت پایدار ثبت نشد؛ وضعیت را تازه کنید و دوباره بررسی کنید.' });
  }
  __westoModuleContext.publishOperationalEvent('order.created', { orderId: subOrder.id, branchId: subOrder.branchId, status: subOrder.status });
  __westoModuleContext.publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status });
  res.json({ ok: true, primaryOrder: __westoModuleContext.operationalOrderResponse(order, req.user), splitOrder: __westoModuleContext.operationalOrderResponse(subOrder, req.user) });
}));
};
