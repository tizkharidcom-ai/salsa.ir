'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/cashier/orders/:id/settle', __westoModuleContext.requireCapability('payments.manage'), __westoModuleContext.serializeOrderMutationRoute(async (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  return __westoModuleContext.withCashDrawerSettlementLock(req, targetId, () => __westoModuleContext.handleSettleOrder(req, res, targetId));
}));
};
