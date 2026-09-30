'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/loyalty/customer', __westoModuleContext.requireAuth, (req, res) => {
  const phone = __westoModuleContext.normalizeDigits(req.query.phone || '').trim();
  if (!phone || !__westoModuleContext.PHONE_RE.test(phone)) {
    return res.status(400).json({ error: 'شماره معتبر نیست' });
  }
  const role = __westoModuleContext.effectiveRole(req.user);
  const isSelf = req.user && req.user.phone === phone;
  const isStaff = ['cashier', 'waiter', 'manager', 'owner', 'admin'].includes(role)
    || __westoModuleContext.userCan(req.user, 'crm.view')
    || __westoModuleContext.userCan(req.user, 'orders.create')
    || __westoModuleContext.userCan(req.user, 'ops.view');

  if (!isSelf && !isStaff) {
    return res.status(403).json({ error: 'دسترسی به اطلاعات باشگاه این مشتری مجاز نیست.' });
  }

  const user = __westoModuleContext.db.users.find((u) => u.phone === phone);
  const resolved = __westoModuleContext.loyaltyEngine.resolveCustomerTier(__westoModuleContext.db, user || { phone, points: 0 });
  const walletBalance = __westoModuleContext.walletEngine.getWalletBalance(__westoModuleContext.db, phone);
  res.json({
    phone,
    name: user?.name || '',
    points: resolved.points,
    walletBalanceToman: walletBalance,
    tier: resolved.tier,
    nextTier: resolved.nextTier,
    progressPct: resolved.progressPct,
    pointsToNext: resolved.pointsToNext,
    spendToNext: resolved.spendToNext,
    discountPct: resolved.discountPct,
    multiplier: resolved.multiplier,
    badge: resolved.badge,
  });
});
};
