'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/payments', __westoModuleContext.requireCapability('payments.manage'), (req, res) => {
  const branchId = __westoModuleContext.parseBranchId(req);
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 80));
  res.json({
    provider: __westoModuleContext.paymentProviderPublicStatus(__westoModuleContext.db.paymentProvider, {
      nodeEnv: process.env.NODE_ENV,
      providerReady: __westoModuleContext.productionPaymentProviderReady(),
    }),
    payments: __westoModuleContext.branchScoped(__westoModuleContext.db.paymentAttempts || [], branchId).slice(0, limit).map(__westoModuleContext.publicPaymentAttempt),
  });
});
};
