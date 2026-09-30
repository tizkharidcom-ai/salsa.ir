'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/loyalty/me', __westoModuleContext.requireAuth, (req, res) => {
  const resolved = __westoModuleContext.loyaltyEngine.resolveCustomerTier(__westoModuleContext.db, req.user);
  const walletBalance = __westoModuleContext.walletEngine.getWalletBalance(__westoModuleContext.db, req.user.phone);
  const member = (__westoModuleContext.db.users || []).find((candidate) => __westoModuleContext.loyaltyAchievements.orderBelongsToMember({ userId: req.user.id, phone: req.user.phone }, candidate)) || req.user;
  const memberKey = member.id !== undefined && member.id !== null
    ? `user:${String(member.id)}`
    : `phone:${__westoModuleContext.loyaltyAchievements.normalizePhoneKey(member.phone || req.user.phone)}`;
  const linkedOrders = (__westoModuleContext.db.orders || []).filter((order) => __westoModuleContext.loyaltyAchievements.orderBelongsToMember(order, member));
  const awards = (__westoModuleContext.db.loyaltyAchievementAwards || []).filter((award) => award.memberKey === memberKey);
  const achievementRows = __westoModuleContext.loyaltyAchievements.evaluateAchievements(
    __westoModuleContext.loyaltyAchievements.getLoyaltyAchievements(__westoModuleContext.db),
    linkedOrders,
    {
      menuItems: __westoModuleContext.db.menuItems || [],
      branches: __westoModuleContext.db.branches || [],
      fallbackTimeZone: __westoModuleContext.db.settings?.businessTimeZone || __westoModuleContext.db.settings?.timezone || __westoModuleContext.loyaltyAchievements.FALLBACK_TIME_ZONE,
    },
  ).map((achievement) => {
    const award = awards.find((entry) => entry.achievementId === achievement.id);
    let rewardStatus = 'in_progress';
    if (award) rewardStatus = 'issued';
    else if (achievement.unlocked && achievement.rewardPoints <= 0) rewardStatus = 'not_configured';
    else if (achievement.unlocked && achievement.rewardStartsAt && achievement.completedAt
      && Date.parse(achievement.completedAt) < Date.parse(achievement.rewardStartsAt)) rewardStatus = 'completed_before_rewards';
    else if (achievement.unlocked && !__westoModuleContext.db.loyalty?.enabled) rewardStatus = 'program_paused';
    else if (achievement.unlocked) rewardStatus = 'award_review';
    return { ...achievement, thresholdOrderId: undefined, rewardStatus, rewardIssuedAt: award?.at || null, pointsAwarded: award?.points || 0 };
  });
  res.json({
    points: Math.max(0, Math.round(Number(req.user.points) || 0)),
    walletBalanceToman: walletBalance,
    tier: resolved.tier,
    nextTier: resolved.nextTier,
    progressPct: resolved.progressPct,
    pointsToNext: resolved.pointsToNext,
    spendToNext: resolved.spendToNext,
    multiplier: resolved.multiplier,
    discountPct: resolved.discountPct,
    badge: resolved.badge,
    loyalty: {
      enabled: !!__westoModuleContext.db.loyalty?.enabled,
      pointsPerToman: __westoModuleContext.db.loyalty?.pointsPerToman ?? 0,
      redeemValue: __westoModuleContext.db.loyalty?.redeemValue ?? 0,
      welcomePoints: __westoModuleContext.db.loyalty?.welcomePoints ?? 0,
      tiers: __westoModuleContext.loyaltyEngine.getLoyaltyTiers(__westoModuleContext.db),
      achievements: achievementRows,
      achievementProgressSource: 'server_completed_orders',
    },
    achievements: achievementRows,
    ledger: (__westoModuleContext.db.loyaltyLedger || []).filter((e) => e.phone === req.user.phone).slice(0, 20),
  });
});
};
