'use strict';

/**
 * WESTO Loyalty & Customer Club Tier Engine
 *
 * Implements multi-tier loyalty membership, dynamic points multiplier,
 * tier-based discount / cashback rates, progress tracking, and audit-safe ledger entries.
 */

const DEFAULT_LOYALTY_TIERS = Object.freeze([
  {
    id: 'bronze',
    name: 'برنزی',
    minPoints: 0,
    minSpendToman: 0,
    multiplier: 1.0,
    discountPct: 1,
    color: '#cd7f32',
    badgeIcon: '🥉',
    perks: ['کسب ۱ امتیاز به ازای هر ۱۰۰ تومان', '۱٪ تخفیف روی سفارش‌ها'],
  },
  {
    id: 'silver',
    name: 'نقره‌ای',
    minPoints: 500,
    minSpendToman: 2_000_000,
    multiplier: 1.25,
    discountPct: 3,
    color: '#94a3b8',
    badgeIcon: '🥈',
    perks: ['ضریب ۱٫۲۵ برابری امتیاز', '۳٪ تخفیف روی سفارش‌ها', 'آفرهای ویژه هفتگی'],
  },
  {
    id: 'gold',
    name: 'طلایی',
    minPoints: 2000,
    minSpendToman: 10_000_000,
    multiplier: 1.5,
    discountPct: 5,
    color: '#f59e0b',
    badgeIcon: '🥇',
    perks: ['ضریب ۱٫۵ برابری امتیاز', '۵٪ تخفیف روی سفارش‌ها', 'اولویت در آماده‌سازی', 'پیش‌غذای رایگان در روز تولد'],
  },
  {
    id: 'vip',
    name: 'الماسی VIP',
    minPoints: 5000,
    minSpendToman: 25_000_000,
    multiplier: 2.0,
    discountPct: 8,
    color: '#a855f7',
    badgeIcon: '💎',
    perks: ['ضریب ۲ برابری امتیاز', '۸٪ تخفیف روی تمام فاکتورها', 'پشتیبانی اختصاصی', 'رزرو اختصاصی میز VIP'],
  },
]);

function getLoyaltyTiers(db) {
  if (Array.isArray(db?.loyalty?.tiers) && db.loyalty.tiers.length > 0) {
    return db.loyalty.tiers;
  }
  return DEFAULT_LOYALTY_TIERS.map((t) => ({ ...t }));
}

function resolveCustomerTier(db, userOrData) {
  const tiers = getLoyaltyTiers(db);
  const points = Math.max(0, Math.round(Number(userOrData?.points) || 0));
  const totalSpend = Math.max(0, Math.round(Number(userOrData?.totalSpendToman ?? userOrData?.totalSpentToman ?? userOrData?.totalSpend ?? userOrData?.total) || 0));

  // Sort tiers from highest threshold to lowest
  const sorted = [...tiers].sort((a, b) => (b.minPoints || 0) - (a.minPoints || 0));

  let currentTier = sorted[sorted.length - 1] || DEFAULT_LOYALTY_TIERS[0];

  for (const tier of sorted) {
    const hasPointThreshold = Number(tier.minPoints || 0) > 0;
    const hasSpendThreshold = Number(tier.minSpendToman || 0) > 0;
    const pointsMet = hasPointThreshold && points >= tier.minPoints;
    const spendMet = hasSpendThreshold && totalSpend >= tier.minSpendToman;
    if (pointsMet || spendMet) {
      currentTier = tier;
      break;
    }
  }

  // Find next tier if available
  const tierIndex = tiers.findIndex((t) => t.id === currentTier.id);
  const nextTier = tierIndex >= 0 && tierIndex < tiers.length - 1 ? tiers[tierIndex + 1] : null;

  let progressPct = 100;
  let pointsToNext = 0;
  let spendToNext = 0;

  if (nextTier) {
    const currentMin = currentTier.minPoints || 0;
    const targetMin = nextTier.minPoints || 0;
    const pointRange = Math.max(1, targetMin - currentMin);
    const pointProgress = Math.min(pointRange, Math.max(0, points - currentMin));
    progressPct = Math.min(100, Math.max(0, Math.round((pointProgress / pointRange) * 100)));
    pointsToNext = Math.max(0, targetMin - points);
    if (nextTier.minSpendToman) {
      spendToNext = Math.max(0, nextTier.minSpendToman - totalSpend);
    }
  }

  return {
    tier: currentTier,
    nextTier,
    progressPct,
    pointsToNext,
    spendToNext,
    points,
    totalSpend,
    multiplier: currentTier.multiplier || 1.0,
    discountPct: currentTier.discountPct || 0,
    badge: `${currentTier.badgeIcon || '🥉'} ${currentTier.name}`,
  };
}

function calculateOrderLoyaltyDiscount(subtotalToman, tier) {
  const subtotal = Math.max(0, Math.round(Number(subtotalToman) || 0));
  const discountPct = Math.max(0, Math.min(100, Number(tier?.discountPct) || 0));
  if (!subtotal || !discountPct) return 0;
  return Math.round((subtotal * discountPct) / 100);
}

function calculateOrderPointsEarned(db, orderTotalToman, tier) {
  if (!db?.loyalty?.enabled) return 0;
  const total = Math.max(0, Math.round(Number(orderTotalToman) || 0));
  const baseRate = Number(db?.loyalty?.pointsPerToman) || 0.01;
  const multiplier = Number(tier?.multiplier) || 1.0;
  return Math.max(0, Math.floor(total * baseRate * multiplier));
}

function summarizeTiersMembership(db, customers = []) {
  const tiers = getLoyaltyTiers(db);
  const counts = Object.fromEntries(tiers.map((t) => [t.id, 0]));
  const pointsByTier = Object.fromEntries(tiers.map((t) => [t.id, 0]));
  const spendByTier = Object.fromEntries(tiers.map((t) => [t.id, 0]));

  for (const customer of customers) {
    const resolved = resolveCustomerTier(db, customer);
    const tierId = resolved.tier.id;
    if (counts[tierId] !== undefined) {
      counts[tierId] += 1;
      pointsByTier[tierId] += resolved.points;
      spendByTier[tierId] += resolved.totalSpend;
    }
  }

  return tiers.map((tier) => ({
    ...tier,
    memberCount: counts[tier.id] || 0,
    totalPoints: pointsByTier[tier.id] || 0,
    totalSpendToman: spendByTier[tier.id] || 0,
  }));
}

function calculateOrderDiscounts(db, { subtotalToman = 0, phone = '', user = null, redeemPoints = 0 } = {}) {
  const subtotal = Math.max(0, Math.round(Number(subtotalToman) || 0));
  const customer = user || (phone ? (db.users || []).find((u) => u.phone === phone) : null);
  const resolved = resolveCustomerTier(db, customer);

  // 1. Tier Discount
  const tierDiscountToman = calculateOrderLoyaltyDiscount(subtotal, resolved.tier);

  // 2. Points Redemption Discount
  const redeemVal = Math.max(0, Math.round(Number(db?.loyalty?.redeemValue) || 1000));
  const availablePoints = Math.max(0, Math.round(Number(customer?.points) || 0));
  const maxRedeemablePoints = redeemVal > 0 ? Math.min(availablePoints, Math.floor(subtotal / redeemVal)) : 0;
  const requestedPoints = Math.max(0, Math.round(Number(redeemPoints) || 0));
  const pointsRedeemed = Math.min(requestedPoints, maxRedeemablePoints);
  const pointsDiscountToman = pointsRedeemed * redeemVal;

  const totalDiscountToman = tierDiscountToman + pointsDiscountToman;
  const finalPayable = Math.max(0, subtotal - totalDiscountToman);

  return {
    customerPhone: customer?.phone || phone || null,
    customerName: customer?.name || null,
    availablePoints,
    tier: resolved.tier,
    tierDiscountToman,
    tierDiscountPct: resolved.tier.discountPct || 0,
    redeemValue: redeemVal,
    maxRedeemablePoints,
    pointsRedeemed,
    pointsDiscountToman,
    totalDiscountToman,
    finalPayable,
  };
}

module.exports = {
  DEFAULT_LOYALTY_TIERS,
  getLoyaltyTiers,
  resolveCustomerTier,
  calculateOrderLoyaltyDiscount,
  calculateOrderPointsEarned,
  calculateOrderDiscounts,
  summarizeTiersMembership,
};
