'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/checkout/payments/:id/sandbox-confirm', __westoModuleContext.sandboxPaymentGuard, __westoModuleContext.serializePaymentOrderMutationRoute(async (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const payment = (__westoModuleContext.db.paymentAttempts || []).find((item) => Number(item.id) === targetId);
  if (!payment) return res.status(404).json({ error: 'payment_not_found' });
  if (payment.mode !== 'sandbox') return res.status(409).json({ error: 'sandbox_disabled' });
  if (!req.body?.token || req.body.token !== payment.sandboxToken) return res.status(403).json({ error: 'payment_token_invalid' });
  const status = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : '';
  if (!status) return res.status(400).json({ error: 'payment_status_required' });
  if (!['paid', 'failed', 'cancelled', 'unknown', 'reconciliation_required'].includes(status)) {
    return res.status(400).json({ error: 'payment_status_invalid' });
  }
  const snapshot = __westoModuleContext.snapshotFinanceMutationState();
  let result;
  try {
    result = __westoModuleContext.settlePaymentAttempt(payment, { status, reference: `sandbox-${payment.id}`, source: 'sandbox-confirm' });
    if (result.error) return res.status(result.status || 400).json(result);
    await __westoModuleContext.persistFinanceMutation(snapshot);
  } catch (error) {
    __westoModuleContext.restoreFinanceMutationState(snapshot);
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
  try { __westoModuleContext.publishPaymentCommitEffects(result, status); } catch (error) { console.error('[payment-post-commit] integration effect failed', error?.message || error); }
  res.json({ ok: true, idempotent: result.idempotent, payment: __westoModuleContext.publicPaymentAttempt(result.payment), order: __westoModuleContext.publicCheckoutOrderView(result.order) });
}));
};
