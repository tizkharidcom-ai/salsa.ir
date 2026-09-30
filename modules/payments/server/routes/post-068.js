'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/payments/webhook/:provider', __westoModuleContext.serializePaymentOrderMutationRoute(async (req, res) => {
  const payment = (__westoModuleContext.db.paymentAttempts || []).find((item) => Number(item.id) === Number(req.body?.paymentAttemptId));
  if (!payment || payment.provider !== String(req.params.provider || '')) return res.status(404).json({ error: 'payment_not_found' });
  // No production gateway adapter or provider-specific raw-body verifier is
  // installed yet. Never let a configured shared secret or a sandbox token
  // turn this placeholder endpoint into a production payment authority.
  if (process.env.NODE_ENV === 'production') {
    return res.status(503).json({ error: 'payment_webhook_provider_unavailable' });
  }
  if (payment.mode !== 'sandbox' || payment.provider !== 'sandbox') {
    return res.status(503).json({ error: 'payment_webhook_provider_unavailable' });
  }
  if (!req.body?.token || req.body.token !== payment.sandboxToken) {
    return res.status(401).json({ error: 'webhook_unauthorized' });
  }
  const status = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : '';
  if (!status) return res.status(400).json({ error: 'payment_status_required' });
  if (!['paid', 'failed', 'cancelled', 'unknown', 'reconciliation_required'].includes(status)) {
    return res.status(400).json({ error: 'payment_status_invalid' });
  }
  const callbackAmountText = __westoModuleContext.normalizeDigits(String(req.body?.amount ?? '')).replace(/[٬,]/g, '').trim();
  const callbackAmount = Number(callbackAmountText);
  const expectedAmount = Number(payment.amount);
  if (!Number.isSafeInteger(callbackAmount) || !Number.isSafeInteger(expectedAmount) || callbackAmount !== expectedAmount) {
    return res.status(409).json({ error: 'payment_amount_mismatch' });
  }
  const snapshot = __westoModuleContext.snapshotFinanceMutationState();
  let result;
  try {
    result = __westoModuleContext.settlePaymentAttempt(payment, {
      status,
      reference: req.body?.reference,
      source: `webhook:${payment.provider}`,
    });
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
