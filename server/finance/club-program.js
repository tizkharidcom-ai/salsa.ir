'use strict';

const crypto = require('node:crypto');
const { normalizePhoneKey, orderBelongsToMember, isValidCompletedOrder } = require('./loyalty-achievements');

function fail(code, message, status = 400) {
  throw Object.assign(new Error(message), { code, status });
}
function number(value, { min = 0, max = 1e9, integer = true } = {}) {
  if (value === '' || value == null || typeof value === 'boolean') fail('club_number_invalid', 'مقدار عددی الزامی است.');
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isSafeInteger(parsed))) {
    fail('club_number_invalid', 'مقدار عددی خارج از بازهٔ مجاز است.');
  }
  return parsed;
}
function normalizeRules(input) {
  if (typeof input?.enabled !== 'boolean') fail('club_enabled_invalid', 'وضعیت فعال‌بودن باشگاه معتبر نیست.');
  return {
    enabled: input.enabled,
    pointsPerToman: number(input.pointsPerToman, { max: 1, integer: false }),
    redeemValue: number(input.redeemValue, { max: 1e6 }),
    welcomePoints: number(input.welcomePoints, { max: 1e6 }),
  };
}
function findMember(db, phone) {
  const key = normalizePhoneKey(phone);
  const matches = (db.users || []).filter((user) => key && normalizePhoneKey(user.phone) === key);
  if (matches.length !== 1) fail('club_member_ambiguous', 'حساب مشتری یافت نشد یا نیاز به بررسی پیوند حساب دارد.', 409);
  if (matches[0].blocked) fail('club_member_blocked', 'حساب مشتری غیرفعال است.', 403);
  return matches[0];
}
function memberKey(user) {
  return user.id != null ? `user:${user.id}` : `phone:${normalizePhoneKey(user.phone)}`;
}
function appendPoints(db, user, delta, reason, meta = {}, at = new Date().toISOString()) {
  number(delta, { min: -1e9 });
  const current = number(Number(user.points) || 0, { max: Number.MAX_SAFE_INTEGER });
  db.loyaltyLedger ||= [];
  if (meta.key) {
    const existing = db.loyaltyLedger.find((entry) => entry.meta?.key === meta.key && normalizePhoneKey(entry.phone) === normalizePhoneKey(user.phone));
    if (existing) {
      if (existing.delta !== delta || existing.reason !== reason) fail('club_idempotency_conflict', 'این شناسه قبلاً برای درخواست دیگری استفاده شده است.', 409);
      return existing;
    }
  }
  const balance = current + delta;
  if (!Number.isSafeInteger(balance) || balance < 0) fail('club_points_insufficient', 'موجودی امتیاز کافی نیست.', 409);
  user.points = balance;
  const entry = { id: crypto.randomUUID(), phone: user.phone, memberKey: memberKey(user), delta, balance, reason, meta, at };
  db.loyaltyLedger.unshift(entry);
  return entry;
}
function normalizeRewards(input) {
  if (!Array.isArray(input) || input.length > 30) fail('club_rewards_invalid', 'حداکثر ۳۰ جایزه می‌توانید تعریف کنید.');
  const ids = new Set();
  return input.map((item) => {
    const id = String(item.id || '').trim();
    const title = String(item.title || '').trim();
    if (!/^[a-zA-Z0-9_-]{1,48}$/.test(id) || ids.has(id)) fail('club_reward_id_invalid', 'شناسهٔ جایزه باید معتبر و یکتا باشد.');
    ids.add(id);
    if (!title || title.length > 80 || typeof item.enabled !== 'boolean') fail('club_reward_invalid', 'نام و وضعیت جایزه را مشخص کنید.');
    return {
      id, title, enabled: item.enabled, kind: 'wallet_credit',
      description: String(item.description || '').trim().slice(0, 240),
      icon: Array.from(String(item.icon || '🎁')).slice(0, 8).join(''),
      pointsCost: number(item.pointsCost, { min: 1, max: 1e7 }),
      walletCreditToman: number(item.walletCreditToman, { min: 1, max: 1e7 }),
      maxPerMember: number(item.maxPerMember ?? 0, { max: 1000 }),
    };
  });
}
function rewardsForMember(db, user) {
  return (db.loyalty?.rewards || []).filter((reward) => reward.enabled).map((reward) => {
    const claimed = (db.loyaltyRedemptions || []).filter((entry) => entry.memberKey === memberKey(user) && entry.rewardId === reward.id).length;
    return { ...reward, claimed, available: !!db.loyalty?.enabled && (!reward.maxPerMember || claimed < reward.maxPerMember) && Number(user.points) >= reward.pointsCost };
  });
}
function redeemReward(db, { user, rewardId, key, branchId, creditWallet, now = new Date().toISOString() }) {
  if (!/^[a-zA-Z0-9._:-]{8,160}$/.test(String(key || ''))) fail('club_idempotency_required', 'شناسهٔ یکتای درخواست الزامی است.');
  db.loyaltyRedemptions ||= [];
  const identity = memberKey(user);
  const existing = db.loyaltyRedemptions.find((entry) => entry.memberKey === identity && entry.key === key);
  if (existing) {
    if (existing.rewardId !== rewardId || existing.branchId !== branchId) fail('club_idempotency_conflict', 'درخواست تکراری با اطلاعات متفاوت است.', 409);
    return { ...existing, replay: true };
  }
  if (!db.loyalty?.enabled) fail('club_disabled', 'دریافت جایزه در حال حاضر غیرفعال است.', 409);
  const reward = (db.loyalty.rewards || []).find((item) => item.id === rewardId && item.enabled);
  if (!reward) fail('club_reward_unavailable', 'این جایزه در دسترس نیست.', 404);
  const count = db.loyaltyRedemptions.filter((entry) => entry.memberKey === identity && entry.rewardId === rewardId).length;
  if (reward.maxPerMember && count >= reward.maxPerMember) fail('club_reward_limit', 'سهم دریافت این جایزه تکمیل شده است.', 409);
  if (Number(user.points || 0) < reward.pointsCost) fail('club_points_insufficient', 'امتیاز شما کافی نیست.', 409);
  const id = crypto.randomUUID();
  // Caller persists the points, wallet liability journal and receipt together.
  const credited = creditWallet({ phone: user.phone, amountToman: reward.walletCreditToman, paymentMethod: 'loyalty_reward', reference: `CLUB-${id}`, actor: 'customer-club', bonusToman: 0 });
  appendPoints(db, user, -reward.pointsCost, 'reward_redeem', { key: `redeem:${key}`, rewardId, redemptionId: id }, now);
  const entry = { id, key, memberKey: identity, phone: user.phone, rewardId, title: reward.title, pointsCost: reward.pointsCost, walletCreditToman: reward.walletCreditToman, branchId, at: now, status: 'credited', walletEntryId: credited?.topupEntry?.id || null };
  db.loyaltyRedemptions.unshift(entry);
  return entry;
}
function memberOrders(db, user) {
  return (db.orders || []).filter((order) => orderBelongsToMember(order, user) && isValidCompletedOrder(order));
}
module.exports = { fail, number, normalizeRules, findMember, memberKey, appendPoints, normalizeRewards, rewardsForMember, redeemReward, memberOrders };
