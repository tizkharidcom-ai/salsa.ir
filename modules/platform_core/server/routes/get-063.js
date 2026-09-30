'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/checkout/meta', (req, res) => {
  const requestedBranch = req.query.branchId || req.query.branch;
  const branch = requestedBranch ? __westoModuleContext.resolveBranchExact(requestedBranch) : __westoModuleContext.defaultBranch();
  if (requestedBranch && !branch) return res.status(400).json({ error: 'branch_invalid', message: 'شعبهٔ انتخاب‌شده معتبر نیست.' });
  const paymentProvider = __westoModuleContext.paymentProviderPublicStatus(__westoModuleContext.db.paymentProvider, {
    nodeEnv: process.env.NODE_ENV,
    providerReady: __westoModuleContext.productionPaymentProviderReady(),
  });
  res.json({
    payment: {
      mode: paymentProvider.mode,
      provider: paymentProvider.provider,
      onlineEnabled: paymentProvider.enabled,
    },
    branches: (__westoModuleContext.db.branches || []).filter((item) => item.active !== false).map((item) => ({ id: item.id, slug: item.slug, name: item.name, address: item.address })),
    deliveryZones: (__westoModuleContext.db.deliveryZones || [])
      .filter((item) => item.active !== false && (!branch || Number(item.branchId) === Number(branch.id)))
      .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))
      .map((item) => ({ id: item.id, branchId: item.branchId, name: item.name, minOrder: item.minOrder, fee: item.fee, etaMinutes: item.etaMinutes })),
  });
});
};
