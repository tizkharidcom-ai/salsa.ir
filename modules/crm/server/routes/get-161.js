'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/loyalty', __westoModuleContext.requireOwner, (req, res) => {
  const rawMembers = __westoModuleContext.db.users.map(__westoModuleContext.publicUser).sort((a, b) => b.points - a.points);
  const members = rawMembers.map((m) => {
    const tierInfo = __westoModuleContext.loyaltyEngine.resolveCustomerTier(__westoModuleContext.db, m);
    return {
      ...m,
      tier: tierInfo.tier,
      nextTier: tierInfo.nextTier,
      progressPct: tierInfo.progressPct,
      pointsToNext: tierInfo.pointsToNext,
      multiplier: tierInfo.multiplier,
      discountPct: tierInfo.discountPct,
      badge: tierInfo.badge,
    };
  });
  const tiers = __westoModuleContext.loyaltyEngine.summarizeTiersMembership(__westoModuleContext.db, rawMembers);
  const completedOrders = (__westoModuleContext.db.orders || []).filter(__westoModuleContext.loyaltyAchievements.isValidCompletedOrder);
  const linkedMembers = (__westoModuleContext.db.users || []).filter((member) => __westoModuleContext.effectiveRole(member) === 'user');
  const unlinkedCompleted = completedOrders.filter((order) => !linkedMembers.some((member) => __westoModuleContext.loyaltyAchievements.orderBelongsToMember(order, member)));
  const membersWithoutCompletedOrders = linkedMembers.filter((member) => Number(member.points) > 0
    && !completedOrders.some((order) => __westoModuleContext.loyaltyAchievements.orderBelongsToMember(order, member)));
  res.json({
    loyalty: {
      ...(__westoModuleContext.db.loyalty || {}),
      tiers: __westoModuleContext.loyaltyEngine.getLoyaltyTiers(__westoModuleContext.db),
    },
    achievements: __westoModuleContext.loyaltyAchievements.getLoyaltyAchievements(__westoModuleContext.db),
    menuCategories: (__westoModuleContext.db.menuCategories || []).map((category) => ({ id: category.id, title: category.title || category.name1 || `دسته ${category.id}` })),
    diagnostics: {
      completedOrders: completedOrders.length,
      unlinkedCompletedOrders: unlinkedCompleted.length,
      unlinkedOrdersSample: unlinkedCompleted.slice(0, 12).map((order) => ({
        orderNo: order.orderNo || `W-${order.id}`,
        status: order.status,
        completedAt: __westoModuleContext.loyaltyAchievements.completionDate(order)?.toISOString() || null,
        phoneLast4: __westoModuleContext.normalizeDigits(order.phone || order.userPhone || order.customerPhone || '').replace(/\D/g, '').slice(-4),
      })),
      membersWithPointsWithoutLinkedCompletedOrders: membersWithoutCompletedOrders.length,
      membersWithoutOrdersSample: membersWithoutCompletedOrders.slice(0, 12).map((member) => ({
        name: String(member.name || 'مشتری').slice(0, 48),
        phoneLast4: __westoModuleContext.normalizeDigits(member.phone || '').replace(/\D/g, '').slice(-4),
        points: Math.max(0, Math.round(Number(member.points) || 0)),
      })),
    },
    tiers,
    members,
    ledger: (__westoModuleContext.db.loyaltyLedger || []).slice(0, 80),
    totals: {
      members: members.filter((m) => m.points > 0).length,
      pointsIssued: members.reduce((s, m) => s + m.points, 0),
    },
  });
});
};
