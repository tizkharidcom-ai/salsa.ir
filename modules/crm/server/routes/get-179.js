'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/wallet/summary', __westoModuleContext.requireOwner, (req, res) => {
  const summary = __westoModuleContext.walletEngine.summarizeWallet(__westoModuleContext.db);
  res.json(summary);
});
};
