'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/wallet/me', __westoModuleContext.requireAuth, (req, res) => {
  const phone = req.user.phone;
  const balance = __westoModuleContext.walletEngine.getWalletBalance(__westoModuleContext.db, phone);
  const packages = __westoModuleContext.walletEngine.getWalletPackages(__westoModuleContext.db);
  const ledger = (__westoModuleContext.db.walletLedger || []).filter((e) => e.phone === phone).slice(0, 30);
  const resolved = __westoModuleContext.loyaltyEngine.resolveCustomerTier(__westoModuleContext.db, req.user);
  res.json({
    phone,
    walletBalanceToman: balance,
    packages,
    ledger,
    tier: resolved.tier,
    badge: resolved.badge,
  });
});
};
