'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/wallet/packages', __westoModuleContext.requireOwner, (req, res) => {
  res.json({ packages: __westoModuleContext.walletEngine.getWalletPackages(__westoModuleContext.db) });
});
};
