'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/checkout/recovery', __westoModuleContext.guardPublicCheckoutRecovery, (req, res) => {
  const receiptCode = __westoModuleContext.normalizeCheckoutReceiptCode(req.body?.receiptCode);
  if (!receiptCode) return res.status(400).json({ error: 'receipt_code_invalid' });
  const indexKey = __westoModuleContext.checkoutReceiptIndexKey(receiptCode);
  const saved = indexKey ? __westoModuleContext.db.checkoutIdempotency?.[indexKey] : null;
  const order = saved && (__westoModuleContext.db.orders || []).find((item) => Number(item.id) === Number(saved.orderId));
  if (!order) return res.status(404).json({ error: 'receipt_not_found' });
  const projection = __westoModuleContext.publicCheckoutOrderView(order);
  if (!projection) return res.status(404).json({ error: 'receipt_not_found' });
  return res.json({ ok: true, order: projection });
});
};
