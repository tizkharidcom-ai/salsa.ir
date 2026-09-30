'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/orders', __westoModuleContext.publicOrderMutationGuard('orders.pos'), async (req, res) => {
  try {
    const result = await __westoModuleContext.createAndPersistCheckoutOrder(req.body || {}, {
      requireTable: true,
      requireQuote: true,
      idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotencyKey || '',
      actor: req.user || null,
    });
    if (result.error) return res.status(result.status || 400).json(result);
    res.json({ ok: true, order: __westoModuleContext.publicCheckoutOrderView(result.order), whatsapp: null });
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
});
};
