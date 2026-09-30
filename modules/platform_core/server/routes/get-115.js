'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/users', __westoModuleContext.requireOwner, (req, res) => {
  const users = (__westoModuleContext.db.users || []).map((u) => {
    const pub = __westoModuleContext.publicUser(u);
    try {
      const tierInfo = __westoModuleContext.loyaltyEngine.resolveCustomerTier(__westoModuleContext.db, u);
      pub.tier = tierInfo?.tier || { id: 'bronze', name: 'برنزی', badgeIcon: '🥉' };
    } catch (_) {
      pub.tier = { id: 'bronze', name: 'برنزی', badgeIcon: '🥉' };
    }
    try {
      pub.walletBalanceToman = __westoModuleContext.walletEngine.getWalletBalance(__westoModuleContext.db, u.phone);
    } catch (_) {
      pub.walletBalanceToman = 0;
    }
    const userOrders = (__westoModuleContext.db.orders || []).filter((o) => o.phone === u.phone);
    pub.ordersCount = userOrders.length;
    pub.totalSpendToman = userOrders
      .filter((o) => __westoModuleContext.FINANCIAL_PAID_ORDER_STATUSES.has(String(o.status || '')))
      .reduce((sum, o) => sum + Number(o.total || 0), 0);
    return pub;
  });
  res.json({ users, branches: __westoModuleContext.db.branches || [] });
});
};
