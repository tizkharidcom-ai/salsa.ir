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

function normalizeLoyaltyTiers(rawTiers) {
  const fail = (code, message) => {
    const error = new Error(message);
    error.code = code;
    throw error;
  };
  if (!Array.isArray(rawTiers) || rawTiers.length < 1) {
    fail('tiers_array_required', 'حداقل یک سطح وفاداری لازم است.');
  }
  if (rawTiers.length > 20) fail('tiers_limit_exceeded', 'حداکثر ۲۰ سطح وفاداری می‌توانید تعریف کنید.');

  const ids = new Set();
  const names = new Set();
  const tiers = rawTiers.map((raw, index) => {
    const item = raw && typeof raw === 'object' ? raw : {};
    const id = String(item.id || `tier-${index + 1}`).trim();
    const name = String(item.name || '').trim().replace(/\s+/g, ' ');
    if (!/^[a-zA-Z0-9_-]{1,48}$/.test(id)) fail('invalid_tier_id', `شناسهٔ سطح ${index + 1} معتبر نیست.`);
    if (ids.has(id)) fail('duplicate_tier_id', 'شناسهٔ سطح‌ها باید یکتا باشد.');
    ids.add(id);
    if (!name || Array.from(name).length > 40) fail('invalid_tier_name', `نام سطح ${index + 1} باید بین ۱ تا ۴۰ نویسه باشد.`);
    const nameKey = name.normalize('NFKC').toLowerCase();
    if (names.has(nameKey)) fail('duplicate_tier_name', 'نام سطح‌ها نباید تکراری باشد.');
    names.add(nameKey);

    const number = (key, fallback, { integer = false, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
      const value = item[key] == null || item[key] === '' ? fallback : Number(item[key]);
      if (!Number.isFinite(value) || value < min || value > max) {
        fail(`invalid_${key}`, `مقدار «${key}» در سطح «${name}» معتبر نیست.`);
      }
      const normalized = integer ? Math.round(value) : value;
      if (!Number.isSafeInteger(normalized) && integer) fail(`invalid_${key}`, `مقدار «${key}» بیش از حد بزرگ است.`);
      return normalized;
    };

    const minPoints = number('minPoints', 0, { integer: true, max: 1_000_000_000 });
    const minSpendToman = number('minSpendToman', 0, { integer: true, max: 1_000_000_000_000 });
    const multiplier = number('multiplier', 1, { min: 1, max: 10 });
    const discountPct = number('discountPct', 0, { min: 0, max: 50 });
    const color = String(item.color || '#a855f7').trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) fail('invalid_tier_color', `رنگ سطح «${name}» معتبر نیست.`);
    const badgeIcon = Array.from(String(item.badgeIcon || '🥉').trim()).slice(0, 6).join('');
    if (!badgeIcon) fail('invalid_tier_badge', `برای سطح «${name}» یک نشان انتخاب کنید.`);
    const rawPerks = Array.isArray(item.perks) ? item.perks : [];
    if (rawPerks.length > 8) fail('tier_perks_limit_exceeded', `برای سطح «${name}» حداکثر ۸ مزیت وارد کنید.`);
    const perks = rawPerks.map((perk) => String(perk).trim().slice(0, 120)).filter(Boolean);

    return { id, name, minPoints, minSpendToman, multiplier, discountPct, color, badgeIcon, perks };
  });

  if (tiers[0].minPoints !== 0 || tiers[0].minSpendToman !== 0) {
    fail('base_tier_threshold_required', 'شرط سطح پایه باید صفر امتیاز و صفر تومان باشد.');
  }
  for (let index = 1; index < tiers.length; index += 1) {
    const previous = tiers[index - 1];
    const current = tiers[index];
    if (current.minPoints < previous.minPoints || current.minSpendToman < previous.minSpendToman) {
      fail('tier_thresholds_out_of_order', 'حداقل امتیاز و خرید باید از سطح پایه به سطح‌های بالاتر افزایشی باشد.');
    }
    if (current.minPoints === previous.minPoints && current.minSpendToman === previous.minSpendToman) {
      fail('duplicate_tier_thresholds', 'هر سطح باید دست‌کم یک شرط ورود متفاوت از سطح قبلی داشته باشد.');
    }
    if (previous.minPoints > 0 && current.minPoints === previous.minPoints) {
      fail('tier_points_threshold_not_increasing', 'حداقل امتیاز سطح‌های بالاتر باید بیشتر باشد.');
    }
    if (previous.minSpendToman > 0 && current.minSpendToman === previous.minSpendToman) {
      fail('tier_spend_threshold_not_increasing', 'حداقل خرید سطح‌های بالاتر باید بیشتر باشد.');
    }
  }
  return tiers;
}

function resolveCustomerTier(db, userOrData) {
  const tiers = getLoyaltyTiers(db);
  const points = Math.max(0, Math.round(Number(userOrData?.points) || 0));
  const totalSpend = Math.max(0, Math.round(Number(userOrData?.totalSpendToman ?? userOrData?.totalSpentToman ?? userOrData?.totalSpend ?? userOrData?.total) || 0));

  // Tier order is the configured progression from base to highest.
  let currentTier = tiers[0] || DEFAULT_LOYALTY_TIERS[0];

  for (const tier of tiers) {
    const hasPointThreshold = Number(tier.minPoints || 0) > 0;
    const hasSpendThreshold = Number(tier.minSpendToman || 0) > 0;
    const pointsMet = hasPointThreshold && points >= tier.minPoints;
    const spendMet = hasSpendThreshold && totalSpend >= tier.minSpendToman;
    if (pointsMet || spendMet) {
      currentTier = tier;
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
  const baseRate = Math.max(0, Number(db?.loyalty?.pointsPerToman ?? 0.01) || 0);
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
  const redeemVal = db?.loyalty?.enabled ? Math.max(0, Math.round(Number(db?.loyalty?.redeemValue ?? 1000) || 0)) : 0;
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
  normalizeLoyaltyTiers,
  resolveCustomerTier,
  calculateOrderLoyaltyDiscount,
  calculateOrderPointsEarned,
  calculateOrderDiscounts,
  summarizeTiersMembership,
};
