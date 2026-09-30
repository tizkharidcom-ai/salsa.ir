'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/staff/orders', __westoModuleContext.requireCapability('orders.create'), async (req, res) => {
  const idempotencyKey = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
  if (idempotencyKey && !__westoModuleContext.ORDER_IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    return res.status(400).json({ error: 'idempotency_key_invalid', message: 'کلید یکتای سفارش معتبر نیست.' });
  }
  if (process.env.NODE_ENV === 'production' && !idempotencyKey) {
    return res.status(400).json({ error: 'idempotency_key_required', message: 'برای ثبت سفارش، کلید یکتای درخواست لازم است.' });
  }
  try {
    const result = await __westoModuleContext.createAndPersistCheckoutOrder(req.body || {}, {
      requireTable: String(req.body?.fulfillment || 'dine_in') === 'dine_in',
      requirePhone: false,
      idempotencyKey,
      actor: req.user,
    }, async ({ order }) => {
      if (req.body?.sendToKitchen === true && order.paymentMethod !== 'online' && order.status === 'pay_at_cashier'
          && __westoModuleContext.canTransitionOrder(order, 'sent_to_kitchen')) {
        __westoModuleContext.appendOrderStatus(order, 'sent_to_kitchen', req.user, { source: 'staff-pos', paymentStatus: order.paymentStatus });
        __westoModuleContext.recordAudit(req, 'order.sent_to_kitchen', 'order', order.id, { paymentStatus: order.paymentStatus }, order.branchId);
        return () => __westoModuleContext.publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status });
      }
      return null;
    });
    if (result.error) return res.status(result.status || 400).json(result);
    res.status(result.idempotent ? 200 : 201).json({
      ok: true,
      idempotent: !!result.idempotent,
      order: __westoModuleContext.operationalOrderResponse(result.order, req.user),
    });
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
});
};
