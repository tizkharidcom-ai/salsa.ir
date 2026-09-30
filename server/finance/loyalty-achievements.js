'use strict';

const METRICS = Object.freeze([
  'coffee_units',
  'early_orders',
  'completed_orders',
  'distinct_desserts',
  'consecutive_months',
]);

const DEFAULT_LOYALTY_ACHIEVEMENTS = Object.freeze([
  { id: 'coffee_master', name: 'قهوه‌خور اعظم', description: 'تعداد مشخصی واحد از دستهٔ قهوه سفارش دهید.', icon: '☕', metric: 'coffee_units', target: 20, enabled: true, rewardPoints: 0, coffeeCategoryIds: [7675], dessertCategoryIds: [], rewardStartsAt: null },
  { id: 'early_bird', name: 'صبح‌نشین', description: 'پیش از ساعت ۱۰ سفارش تکمیل‌شده ثبت کنید.', icon: '🌅', metric: 'early_orders', target: 10, enabled: true, rewardPoints: 0, coffeeCategoryIds: [], dessertCategoryIds: [], rewardStartsAt: null },
  { id: 'loyal_friend', name: 'رفیق وستو', description: 'به تعداد مشخصی سفارش تکمیل‌شده برسید.', icon: '🐈', metric: 'completed_orders', target: 10, enabled: true, rewardPoints: 0, coffeeCategoryIds: [], dessertCategoryIds: [], rewardStartsAt: null },
  { id: 'sweet_tooth', name: 'شیرین‌پسند', description: 'محصولات دسر متفاوت را امتحان کنید.', icon: '🍰', metric: 'distinct_desserts', target: 5, enabled: true, rewardPoints: 0, coffeeCategoryIds: [], dessertCategoryIds: [7697], rewardStartsAt: null },
  { id: 'always_here', name: 'همیشگی', description: 'در ماه‌های متوالی سفارش تکمیل‌شده داشته باشید.', icon: '🔥', metric: 'consecutive_months', target: 3, enabled: true, rewardPoints: 0, coffeeCategoryIds: [], dessertCategoryIds: [], rewardStartsAt: null },
]);

const COMPLETED_STATUSES = new Set(['done', 'picked_up', 'delivered', 'completed']);
const INVALID_PAYMENT_STATUSES = new Set(['cancelled', 'canceled', 'refunded', 'refund', 'failed', 'void', 'unpaid']);
const FALLBACK_TIME_ZONE = 'Asia/Tehran';

function getLoyaltyAchievements(db) {
  const configured = db?.loyalty?.achievements;
  if (!Array.isArray(configured) || configured.length === 0) {
    return DEFAULT_LOYALTY_ACHIEVEMENTS.map((item) => ({ ...item, coffeeCategoryIds: [...item.coffeeCategoryIds], dessertCategoryIds: [...item.dessertCategoryIds] }));
  }
  return configured.map((item) => ({ ...item, coffeeCategoryIds: [...(item.coffeeCategoryIds || [])], dessertCategoryIds: [...(item.dessertCategoryIds || [])] }));
}

function normalizeLoyaltyAchievements(raw, { validCategoryIds } = {}) {
  const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 30) fail('achievements_array_required', 'حداقل یک هدف لازم است و حداکثر ۳۰ هدف می‌توانید تعریف کنید.');
  const ids = new Set();
  const names = new Set();
  const categories = validCategoryIds ? new Set([...validCategoryIds].map(Number)) : null;
  const cleanText = (value, max) => String(value ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().replace(/\s+/g, ' ').slice(0, max);
  const normalizeCategories = (value, label) => {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > 30) fail('invalid_achievement_categories', `دسته‌های ${label} معتبر نیستند.`);
    const result = [...new Set(value.map(Number))];
    if (result.some((id) => !Number.isSafeInteger(id) || id <= 0 || (categories && !categories.has(id)))) {
      fail('invalid_achievement_categories', `دسته‌های ${label} باید از منوی همین مجموعه باشند.`);
    }
    return result;
  };
  const result = raw.map((entry, index) => {
    const item = entry && typeof entry === 'object' ? entry : {};
    const id = String(item.id || '').trim();
    if (!/^[a-zA-Z0-9_-]{1,48}$/.test(id) || ids.has(id)) fail('invalid_achievement_id', `شناسهٔ هدف ${index + 1} معتبر یا یکتا نیست.`);
    ids.add(id);
    const name = cleanText(item.name, 48);
    const nameKey = name.normalize('NFKC').toLowerCase();
    if (!name || names.has(nameKey)) fail('invalid_achievement_name', 'نام هدف‌ها باید یکتا و بین ۱ تا ۴۸ نویسه باشد.');
    names.add(nameKey);
    const description = cleanText(item.description, 240);
    if (!description) fail('invalid_achievement_description', `توضیح هدف «${name}» الزامی است.`);
    const metric = String(item.metric || '');
    if (!METRICS.includes(metric)) fail('invalid_achievement_metric', `معیار هدف «${name}» معتبر نیست.`);
    const target = Number(item.target);
    const rewardPoints = Number(item.rewardPoints);
    if (!Number.isSafeInteger(target) || target < 1 || target > 1_000_000) fail('invalid_achievement_target', `هدف «${name}» باید عددی بین ۱ تا ۱٬۰۰۰٬۰۰۰ باشد.`);
    if (!Number.isSafeInteger(rewardPoints) || rewardPoints < 0 || rewardPoints > 1_000_000) fail('invalid_achievement_reward', `امتیاز جایزهٔ «${name}» معتبر نیست.`);
    const icon = cleanText(item.icon || '⭐', 12) || '⭐';
    const coffeeCategoryIds = normalizeCategories(item.coffeeCategoryIds, 'قهوه');
    const dessertCategoryIds = normalizeCategories(item.dessertCategoryIds, 'دسر');
    if (metric === 'coffee_units' && coffeeCategoryIds.length === 0) fail('achievement_coffee_category_required', `برای هدف «${name}» دست‌کم یک دستهٔ قهوه انتخاب کنید.`);
    if (metric === 'distinct_desserts' && dessertCategoryIds.length === 0) fail('achievement_dessert_category_required', `برای هدف «${name}» دست‌کم یک دستهٔ دسر انتخاب کنید.`);
    return {
      id,
      name,
      description,
      icon,
      metric,
      target,
      enabled: item.enabled !== false,
      rewardPoints,
      coffeeCategoryIds,
      dessertCategoryIds,
      rewardStartsAt: typeof item.rewardStartsAt === 'string' && Number.isFinite(Date.parse(item.rewardStartsAt)) ? new Date(item.rewardStartsAt).toISOString() : null,
    };
  });
  const preservedIds = new Set(result.map((item) => item.id));
  if (DEFAULT_LOYALTY_ACHIEVEMENTS.some((item) => !preservedIds.has(item.id))) {
    fail('default_achievement_required', 'پنج هدف اصلی باشگاه باید حفظ شوند؛ نام و معیار آن‌ها قابل ویرایش است.');
  }
  return result;
}

function isValidCompletedOrder(order) {
  if (!order || !COMPLETED_STATUSES.has(String(order.status || '').trim().toLowerCase())) return false;
  if (order.cancelledAt || order.refundedAt || order.invalidatedAt) return false;
  const payment = String(order.paymentStatus || order.payment_state || '').trim().toLowerCase();
  if (INVALID_PAYMENT_STATUSES.has(payment)) return false;
  return true;
}

function normalizePhoneKey(value) {
  let digits = String(value ?? '')
    .replace(/[۰-۹]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))
    .replace(/[٠-٩]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit))
    .replace(/\D/g, '');
  if (digits.startsWith('0098')) digits = digits.slice(4);
  else if (digits.startsWith('98') && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  return digits;
}

function orderBelongsToMember(order, member) {
  if (order?.userId !== undefined && order.userId !== null) {
    const ownerId = String(order.userId).trim();
    return !!ownerId && member?.id !== undefined && member?.id !== null && ownerId === String(member.id).trim();
  }
  const orderPhone = order?.phone || order?.userPhone || order?.customerPhone || '';
  const orderKey = normalizePhoneKey(orderPhone);
  const memberKey = normalizePhoneKey(member?.phone);
  return !!orderKey && orderKey === memberKey;
}

function isRewardEligibleAtLaunch(achievement, progress, orderId) {
  return !!achievement?.enabled
    && Number(achievement.rewardPoints) > 0
    && !!achievement.rewardStartsAt
    && !!progress?.unlocked
    && String(progress.thresholdOrderId) === String(orderId)
    && !!progress.completedAt
    && Date.parse(progress.completedAt) >= Date.parse(achievement.rewardStartsAt);
}

function sameAchievementRewardDefinition(previous, next) {
  if (!previous || !next) return false;
  const sortedIds = (value) => [...(Array.isArray(value) ? value : [])].map(Number).sort((a, b) => a - b);
  return String(previous.metric) === String(next.metric)
    && Number(previous.target) === Number(next.target)
    && Number(previous.rewardPoints) === Number(next.rewardPoints)
    && JSON.stringify(sortedIds(previous.coffeeCategoryIds)) === JSON.stringify(sortedIds(next.coffeeCategoryIds))
    && JSON.stringify(sortedIds(previous.dessertCategoryIds)) === JSON.stringify(sortedIds(next.dessertCategoryIds));
}

function recordAchievementAwardOnce(awards, details, credit) {
  if (!Array.isArray(awards) || !details?.key || awards.some((award) => award.key === details.key)) return null;
  const ledgerEntry = credit();
  if (!ledgerEntry) return null;
  const award = {
    key: details.key,
    memberKey: details.memberKey,
    achievementId: details.achievementId,
    orderId: details.orderId,
    points: details.points,
    ledgerId: ledgerEntry.id,
    at: ledgerEntry.at,
  };
  awards.push(award);
  return { award, ledgerEntry };
}

function asDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function completionDate(order) {
  const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  const completionEntry = [...history].reverse().find((entry) => COMPLETED_STATUSES.has(String(entry?.status || '').toLowerCase()));
  return asDate(order.completedAt) || asDate(order.deliveredAt) || asDate(order.pickedUpAt) || asDate(completionEntry?.at) || asDate(order.updatedAt) || asDate(order.createdAt);
}

function resolveTimeZone(order, branches, fallback = FALLBACK_TIME_ZONE) {
  const branch = (branches || []).find((item) => Number(item.id) === Number(order?.branchId));
  const candidate = branch?.timeZone || branch?.timezone || branch?.ianaTimeZone || fallback || FALLBACK_TIME_ZONE;
  try { new Intl.DateTimeFormat('en', { timeZone: candidate }).format(new Date()); return candidate; }
  catch (_) { return FALLBACK_TIME_ZONE; }
}

function localDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour) };
}

function normalizedOrderItems(order, menuItems) {
  const byId = new Map((menuItems || []).map((item) => [String(item.id), item]));
  return (Array.isArray(order.items) ? order.items : []).map((line) => {
    const id = line?.menuItemId ?? line?.itemId ?? line?.productId ?? line?.id;
    const product = id == null ? null : byId.get(String(id));
    return { id: id == null ? null : String(id), categoryId: line?.categoryId ?? product?.categoryId, quantity: Math.max(0, Number(line?.quantity ?? line?.qty ?? 1) || 0) };
  });
}

function longestConsecutiveMonthStreak(monthKeys) {
  const sorted = [...new Set(monthKeys)].sort((a, b) => a - b);
  let longest = 0;
  let current = 0;
  let previous = null;
  for (const key of sorted) {
    current = previous !== null && key === previous + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = key;
  }
  return longest;
}

function evaluateAchievement(achievement, orders, { menuItems = [], branches = [], fallbackTimeZone = FALLBACK_TIME_ZONE } = {}) {
  const validOrders = (orders || []).filter(isValidCompletedOrder).map((order) => ({
    order,
    completedAt: completionDate(order),
    placedAt: asDate(order.createdAt),
    timeZone: resolveTimeZone(order, branches, fallbackTimeZone),
  })).filter((row) => row.completedAt || row.placedAt).sort((a, b) => (a.completedAt || a.placedAt) - (b.completedAt || b.placedAt));
  let current = 0;
  let thresholdOrderId = null;
  let thresholdAt = null;
  if (achievement.metric === 'completed_orders') {
    current = validOrders.length;
    const crossing = validOrders[achievement.target - 1];
    if (crossing) { thresholdOrderId = crossing.order.id; thresholdAt = crossing.completedAt || crossing.placedAt; }
  } else if (achievement.metric === 'early_orders') {
    const early = validOrders.filter((row) => row.placedAt && localDateParts(row.placedAt, row.timeZone).hour < 10);
    current = early.length;
    const crossing = early[achievement.target - 1];
    if (crossing) { thresholdOrderId = crossing.order.id; thresholdAt = crossing.completedAt || crossing.placedAt; }
  } else if (achievement.metric === 'coffee_units') {
    let accumulated = 0;
    for (const row of validOrders) {
      const count = normalizedOrderItems(row.order, menuItems).filter((line) => achievement.coffeeCategoryIds.includes(Number(line.categoryId)))
        .reduce((sum, line) => sum + Math.max(0, Math.floor(line.quantity)), 0);
      if (!count) continue;
      const before = accumulated;
      accumulated += count;
      if (!thresholdOrderId && before < achievement.target && accumulated >= achievement.target) {
        thresholdOrderId = row.order.id;
        thresholdAt = row.completedAt || row.placedAt;
      }
    }
    current = accumulated;
  } else if (achievement.metric === 'distinct_desserts') {
    const seen = new Set();
    for (const row of validOrders) {
      for (const line of normalizedOrderItems(row.order, menuItems)) {
        if (line.id && achievement.dessertCategoryIds.includes(Number(line.categoryId))) {
          seen.add(line.id);
          if (!thresholdOrderId && seen.size >= achievement.target) {
            thresholdOrderId = row.order.id;
            thresholdAt = row.completedAt || row.placedAt;
          }
        }
      }
    }
    current = seen.size;
  } else if (achievement.metric === 'consecutive_months') {
    const monthToFirstOrder = new Map();
    for (const row of validOrders) {
      const date = row.completedAt || row.placedAt;
      const { year, month } = localDateParts(date, row.timeZone);
      const key = year * 12 + month - 1;
      if (!monthToFirstOrder.has(key)) monthToFirstOrder.set(key, row);
    }
    const sorted = [...monthToFirstOrder.keys()].sort((a, b) => a - b);
    let streak = 0;
    let previous = null;
    for (const key of sorted) {
      streak = previous !== null && key === previous + 1 ? streak + 1 : 1;
      if (streak >= achievement.target && !thresholdOrderId) {
        const firstInStreak = monthToFirstOrder.get(key - achievement.target + 1);
        const crossing = monthToFirstOrder.get(key);
        thresholdOrderId = crossing?.order.id ?? firstInStreak?.order.id ?? null;
        thresholdAt = crossing?.completedAt || crossing?.placedAt || null;
      }
      previous = key;
    }
    current = longestConsecutiveMonthStreak(sorted);
  }
  return {
    id: achievement.id,
    name: achievement.name,
    description: achievement.description,
    icon: achievement.icon,
    metric: achievement.metric,
    target: achievement.target,
    current,
    progressPct: Math.min(100, Math.round((current / achievement.target) * 100)),
    unlocked: current >= achievement.target,
    completedAt: thresholdAt ? thresholdAt.toISOString() : null,
    thresholdOrderId,
    rewardPoints: achievement.rewardPoints,
    rewardStartsAt: achievement.rewardStartsAt || null,
  };
}

function evaluateAchievements(achievements, orders, context) {
  return (achievements || []).filter((achievement) => achievement.enabled !== false)
    .map((achievement) => evaluateAchievement(achievement, orders, context));
}

module.exports = {
  METRICS,
  DEFAULT_LOYALTY_ACHIEVEMENTS,
  FALLBACK_TIME_ZONE,
  getLoyaltyAchievements,
  normalizeLoyaltyAchievements,
  isValidCompletedOrder,
  normalizePhoneKey,
  orderBelongsToMember,
  isRewardEligibleAtLaunch,
  sameAchievementRewardDefinition,
  recordAchievementAwardOnce,
  completionDate,
  resolveTimeZone,
  evaluateAchievement,
  evaluateAchievements,
};
