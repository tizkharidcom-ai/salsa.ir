'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const achievements = require('../server/finance/loyalty-achievements');

const order = (id, createdAt, extra = {}) => ({
  id,
  status: 'done',
  createdAt,
  completedAt: createdAt,
  phone: '09123334444',
  items: [],
  ...extra,
});

test('matches orders to a member by authoritative account id or normalized phone only', () => {
  const member = { id: 'user-7', phone: '09123334444' };
  assert.equal(achievements.orderBelongsToMember({ userId: 'user-7', phone: '09999999999' }, member), true);
  assert.equal(achievements.orderBelongsToMember({ userId: 'someone-else', phone: member.phone }, member), false);
  assert.equal(achievements.orderBelongsToMember({ phone: '+98 912 333 4444' }, member), true);
  assert.equal(achievements.orderBelongsToMember({ userPhone: '۰۹۱۲۳۳۳۴۴۴۴' }, member), true);
  assert.equal(achievements.orderBelongsToMember({ phone: '09120000000' }, member), false);
});

test('only completed, non-cancelled and non-refunded orders contribute', () => {
  assert.equal(achievements.isValidCompletedOrder(order(1, '2026-01-01T08:00:00Z')), true);
  assert.equal(achievements.isValidCompletedOrder(order(2, '2026-01-01T08:00:00Z', { status: 'cancelled' })), false);
  assert.equal(achievements.isValidCompletedOrder(order(3, '2026-01-01T08:00:00Z', { paymentStatus: 'refunded' })), false);
  assert.equal(achievements.isValidCompletedOrder(order(4, '2026-01-01T08:00:00Z', { status: 'ready' })), false);
});

test('coffee goal counts product quantities from selected category IDs', () => {
  const goal = { id: 'coffee', name: 'Coffee', description: 'Coffee', icon: '☕', metric: 'coffee_units', target: 4, enabled: true, rewardPoints: 0, coffeeCategoryIds: [7675], dessertCategoryIds: [] };
  const result = achievements.evaluateAchievement(goal, [order(1, '2026-01-01T08:00:00Z', {
    items: [{ menuItemId: 101, quantity: 3 }, { menuItemId: 102, quantity: 1 }],
  })], { menuItems: [{ id: 101, categoryId: 7675 }, { id: 102, categoryId: 7701 }] });
  assert.equal(result.current, 3);
  assert.equal(result.unlocked, false);
});

test('dessert goal counts distinct menu products rather than units or repeated lines', () => {
  const goal = { id: 'desserts', name: 'Dessert', description: 'Dessert', icon: '🍰', metric: 'distinct_desserts', target: 2, enabled: true, rewardPoints: 0, coffeeCategoryIds: [], dessertCategoryIds: [7697] };
  const result = achievements.evaluateAchievement(goal, [order(1, '2026-01-01T08:00:00Z', {
    items: [{ menuItemId: 201, quantity: 4 }, { menuItemId: 201, quantity: 2 }, { menuItemId: 202, quantity: 1 }],
  })], { menuItems: [{ id: 201, categoryId: 7697 }, { id: 202, categoryId: 7697 }] });
  assert.equal(result.current, 2);
  assert.equal(result.thresholdOrderId, 1);
  assert.equal(result.unlocked, true);
});

test('early order uses branch-local time with a strict boundary before 10:00', () => {
  const goal = { id: 'early', name: 'Early', description: 'Early', icon: '🌅', metric: 'early_orders', target: 1, enabled: true, rewardPoints: 0, coffeeCategoryIds: [], dessertCategoryIds: [] };
  const context = { branches: [{ id: 1, timeZone: 'Asia/Tehran' }] };
  const before = achievements.evaluateAchievement(goal, [order(1, '2026-01-10T06:29:00Z')], context);
  const boundary = achievements.evaluateAchievement(goal, [order(2, '2026-01-10T06:30:00Z')], context);
  assert.equal(before.current, 1); // 09:59 in Tehran
  assert.equal(boundary.current, 0); // exactly 10:00 is not before 10
});

test('monthly goal requires genuinely consecutive active months', () => {
  const goal = { id: 'months', name: 'Months', description: 'Months', icon: '🔥', metric: 'consecutive_months', target: 3, enabled: true, rewardPoints: 0, coffeeCategoryIds: [], dessertCategoryIds: [] };
  const gapped = achievements.evaluateAchievement(goal, [
    order(1, '2026-01-10T08:00:00Z'), order(2, '2026-03-10T08:00:00Z'), order(3, '2026-05-10T08:00:00Z'),
  ]);
  const consecutive = achievements.evaluateAchievement(goal, [
    order(1, '2026-01-10T08:00:00Z'), order(2, '2026-02-10T08:00:00Z'), order(3, '2026-03-10T08:00:00Z'),
  ]);
  assert.equal(gapped.current, 1);
  assert.equal(gapped.unlocked, false);
  assert.equal(consecutive.current, 3);
  assert.equal(consecutive.thresholdOrderId, 3);
});

test('historical completion is displayable but not eligible for a post-launch reward', () => {
  const goal = { enabled: true, rewardPoints: 100, rewardStartsAt: '2026-02-01T00:00:00.000Z' };
  assert.equal(achievements.isRewardEligibleAtLaunch(goal, { unlocked: true, thresholdOrderId: 5, completedAt: '2026-01-31T23:59:59.000Z' }, 5), false);
  assert.equal(achievements.isRewardEligibleAtLaunch(goal, { unlocked: true, thresholdOrderId: 6, completedAt: '2026-02-01T00:00:00.000Z' }, 6), true);
  assert.equal(achievements.isRewardEligibleAtLaunch(goal, { unlocked: true, thresholdOrderId: 5, completedAt: '2026-02-02T00:00:00.000Z' }, 6), false);
});

test('reward baseline remains stable for presentation edits but resets for reward-rule edits', () => {
  const original = { metric: 'coffee_units', target: 20, rewardPoints: 100, coffeeCategoryIds: [2, 1], dessertCategoryIds: [] };
  assert.equal(achievements.sameAchievementRewardDefinition(original, { ...original, name: 'نام تازه', description: 'توضیح تازه', icon: '✨' }), true);
  assert.equal(achievements.sameAchievementRewardDefinition(original, { ...original, target: 21 }), false);
  assert.equal(achievements.sameAchievementRewardDefinition(original, { ...original, metric: 'completed_orders' }), false);
  assert.equal(achievements.sameAchievementRewardDefinition(original, { ...original, rewardPoints: 101 }), false);
  assert.equal(achievements.sameAchievementRewardDefinition(original, { ...original, coffeeCategoryIds: [1, 3] }), false);
});

test('a loyalty achievement retry can credit a member only once', () => {
  const awards = [];
  let credits = 0;
  const details = { key: 'user:7:coffee', memberKey: 'user:7', achievementId: 'coffee', orderId: 99, points: 100 };
  const credit = () => ({ id: ++credits, at: '2026-02-01T00:00:00.000Z' });
  const first = achievements.recordAchievementAwardOnce(awards, details, credit);
  const retry = achievements.recordAchievementAwardOnce(awards, details, credit);
  assert.ok(first);
  assert.equal(retry, null);
  assert.equal(credits, 1);
  assert.equal(awards.length, 1);
});

test('achievement configuration is allowlisted, category-bound, and rejects missing rule inputs', () => {
  const defaults = achievements.DEFAULT_LOYALTY_ACHIEVEMENTS.map((item) => ({ ...item }));
  assert.equal(achievements.normalizeLoyaltyAchievements(defaults, { validCategoryIds: [7675, 7697] }).length, 5);
  const invalidMetric = defaults.map((item) => ({ ...item }));
  invalidMetric[0].metric = 'freeform_script';
  assert.throws(() => achievements.normalizeLoyaltyAchievements(invalidMetric, { validCategoryIds: [7675, 7697] }), { code: 'invalid_achievement_metric' });
  const missingCategory = defaults.map((item) => ({ ...item }));
  missingCategory[0].coffeeCategoryIds = [];
  assert.throws(() => achievements.normalizeLoyaltyAchievements(missingCategory, { validCategoryIds: [7675, 7697] }), { code: 'achievement_coffee_category_required' });
  const foreignCategory = defaults.map((item) => ({ ...item }));
  foreignCategory[0].coffeeCategoryIds = [999999];
  assert.throws(() => achievements.normalizeLoyaltyAchievements(foreignCategory, { validCategoryIds: [7675, 7697] }), { code: 'invalid_achievement_categories' });
});
