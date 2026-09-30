'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/admin/loyalty/adjust', __westoModuleContext.requireOwner, (req, res) => {
  const phone = __westoModuleContext.normalizeDigits(req.body.phone || '').trim();
  const delta = Math.round(Number(req.body.delta) || 0);
  const reason = String(req.body.reason || 'manual').slice(0, 80);
  if (!__westoModuleContext.PHONE_RE.test(phone)) return res.status(400).json({ error: 'شماره معتبر نیست' });
  if (!delta) return res.status(400).json({ error: 'مقدار امتیاز صفر است' });
  const entry = __westoModuleContext.awardLoyaltyPoints(phone, delta, reason, { manual: true });
  __westoModuleContext.save();
  const user = __westoModuleContext.db.users.find((u) => u.phone === phone);
  const resolved = __westoModuleContext.loyaltyEngine.resolveCustomerTier(__westoModuleContext.db, user);
  res.json({
    ok: true,
    entry,
    user: {
      ...__westoModuleContext.publicUser(user),
      tier: resolved.tier,
      badge: resolved.badge,
    },
  });
});
};
