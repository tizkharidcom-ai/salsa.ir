'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/club', __westoModuleContext.requireOwner, (req, res) => {
  const orderStatsByPhone = new Map();
  const now = Date.now();
  for (const o of (__westoModuleContext.db.orders || [])) {
    const phone = String(o.phone || '').trim();
    if (!phone) continue;
    const stat = orderStatsByPhone.get(phone) || { orders: 0, total: 0, lastOrderAt: null };
    stat.orders += 1;
    if (o.paid || ['paid', 'preparing', 'ready', 'delivered', 'completed'].includes(o.status)) {
      stat.total += Number(o.total) || 0;
    }
    if (!stat.lastOrderAt || new Date(o.createdAt || 0) > new Date(stat.lastOrderAt)) {
      stat.lastOrderAt = o.createdAt;
    }
    orderStatsByPhone.set(phone, stat);
  }

  let totalOrderSpendToman = 0;
  let totalPaidOrders = 0;
  let atRiskCount = 0;
  let championsCount = 0;

  const rawMembers = (__westoModuleContext.db.users || []).map(__westoModuleContext.publicUser).sort((a, b) => (b.points || 0) - (a.points || 0));
  const members = rawMembers.map((m) => {
    const tierInfo = __westoModuleContext.loyaltyEngine.resolveCustomerTier(__westoModuleContext.db, m);
    const walletBalanceToman = __westoModuleContext.walletEngine.getWalletBalance(__westoModuleContext.db, m.phone);
    const stat = orderStatsByPhone.get(m.phone) || { orders: 0, total: 0, lastOrderAt: null };
    const recencyDays = stat.lastOrderAt ? Math.max(0, Math.floor((now - new Date(stat.lastOrderAt).getTime()) / (1000 * 3600 * 24))) : null;
    const monetaryToman = Math.round(stat.total / 10);
    totalOrderSpendToman += monetaryToman;
    totalPaidOrders += stat.orders;

    let rfmSegment = 'new';
    let rfmLabel = 'مشتری جدید 🌱';
    if (stat.orders >= 6 && recencyDays != null && recencyDays <= 30) {
      rfmSegment = 'champion';
      rfmLabel = 'قهرمان 🏆';
      championsCount++;
    } else if (stat.orders >= 3 && recencyDays != null && recencyDays <= 45) {
      rfmSegment = 'loyal';
      rfmLabel = 'وفادار 💎';
    } else if (stat.orders >= 2 && recencyDays != null && recencyDays <= 60) {
      rfmSegment = 'potential';
      rfmLabel = 'مستعد رشد 🚀';
    } else if (stat.orders >= 2 && recencyDays != null && recencyDays > 60) {
      rfmSegment = 'at_risk';
      rfmLabel = 'در معرض ریزش ⚠️';
      atRiskCount++;
    } else if (recencyDays != null && recencyDays > 90) {
      rfmSegment = 'churned';
      rfmLabel = 'خواب‌رفته 💤';
    } else if (stat.orders <= 1 && recencyDays != null && recencyDays <= 30) {
      rfmSegment = 'new';
      rfmLabel = 'مشتری جدید 🌱';
    }

    return {
      ...m,
      orders: stat.orders,
      total: stat.total,
      monetaryToman,
      recencyDays,
      rfmSegment,
      rfmLabel,
      walletBalanceToman,
      tier: tierInfo.tier,
      nextTier: tierInfo.nextTier,
      progressPct: tierInfo.progressPct,
      pointsToNext: tierInfo.pointsToNext,
      multiplier: tierInfo.multiplier,
      discountPct: tierInfo.discountPct,
      badge: tierInfo.badge,
    };
  });
  const walletSummary = __westoModuleContext.walletEngine.summarizeWallet(__westoModuleContext.db);
  const newFeedback = (__westoModuleContext.db.feedback || []).filter((f) => !f.reviewed).length;
  res.json({
    ok: true,
    summary: {
      customers: members.length,
      points: members.reduce((s, m) => s + (m.points || 0), 0),
      walletTotalToman: walletSummary.totalLiabilityToman || 0,
      activeWallets: walletSummary.activeWalletsCount || 0,
      avgLtvToman: members.length ? Math.round(totalOrderSpendToman / members.length) : 0,
      avgOrderToman: totalPaidOrders ? Math.round(totalOrderSpendToman / totalPaidOrders) : 0,
      atRiskCount,
      championsCount,
      newFeedback,
    },
    customers: members,
  });
});
};
