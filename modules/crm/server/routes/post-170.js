'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/loyalty/redeem', __westoModuleContext.requireAuth, (req, res) => {
  const user = (__westoModuleContext.db.users || []).find((u) => __westoModuleContext.phonesMatch(u.phone, req.user.phone)) || req.user;
  const cost = Math.max(1, Math.round(Number(req.body?.cost) || 500));
  const currentPts = Math.max(0, Math.round(Number(user.points) || 0));

  if (currentPts < cost) {
    return res.status(400).json({ ok: false, error: 'امتیاز شما برای دریافت این جایزه کافی نیست.' });
  }

  user.points = currentPts - cost;

  if (!Array.isArray(__westoModuleContext.db.loyaltyLedger)) __westoModuleContext.db.loyaltyLedger = [];
  const voucherCode = `WST-REW-${Date.now().toString(36).toUpperCase()}`;
  __westoModuleContext.db.loyaltyLedger.unshift({
    id: `ly_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    phone: user.phone,
    delta: -cost,
    type: 'reward_redeem',
    description: `دریافت جایزه لاته مهمان وستو (${voucherCode})`,
    voucherCode,
    at: new Date().toISOString(),
  });

  __westoModuleContext.save();

  const resolved = __westoModuleContext.loyaltyEngine.resolveCustomerTier(__westoModuleContext.db, user);
  const walletBalance = __westoModuleContext.walletEngine.getWalletBalance(__westoModuleContext.db, user.phone);

  res.json({
    ok: true,
    voucherCode,
    points: user.points,
    user: __westoModuleContext.publicUser(user),
    loyalty: {
      points: user.points,
      walletBalanceToman: walletBalance,
      tier: resolved.tier,
      nextTier: resolved.nextTier,
      progressPct: resolved.progressPct,
      pointsToNext: resolved.pointsToNext,
    },
  });
});
};
