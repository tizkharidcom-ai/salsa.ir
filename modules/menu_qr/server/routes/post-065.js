'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/checkout/orders', __westoModuleContext.publicOrderMutationGuard('orders.online'), async (req, res) => {
  try {
    const rawReceiptCode = req.get('Idempotency-Key') || req.body?.idempotencyKey;
    const receiptCode = __westoModuleContext.normalizeCheckoutReceiptCode(rawReceiptCode);
    if (!receiptCode) {
      return res.status(400).json({ error: 'receipt_code_invalid', message: 'کد پیگیری سفارش معتبر نیست.' });
    }
    const result = await __westoModuleContext.createAndPersistCheckoutOrder(req.body || {}, {
      requireQuote: true,
      requireName: true,
      idempotencyKey: __westoModuleContext.checkoutReceiptIndexKey(receiptCode),
      actor: req.user || null,
    });
    if (result.error) return res.status(result.status || 400).json(result);
    res.status(result.idempotent ? 200 : 201).json({
      ok: true,
      idempotent: !!result.idempotent,
      order: __westoModuleContext.publicCheckoutOrderView(result.order),
      payment: result.payment
        ? { ...__westoModuleContext.publicPaymentAttempt(result.payment), sandboxToken: result.payment.mode === 'sandbox' ? result.payment.sandboxToken : undefined }
        : null,
      whatsapp: null,
    });
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
});
};
