'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/admin/loyalty/achievements', __westoModuleContext.requireOwner, async (req, res) => {
  const validCategoryIds = (__westoModuleContext.db.menuCategories || []).map((category) => Number(category.id));
  let normalized;
  try {
    normalized = __westoModuleContext.loyaltyAchievements.normalizeLoyaltyAchievements(req.body?.achievements, { validCategoryIds });
  } catch (error) {
    return res.status(400).json({ error: error.code || 'invalid_loyalty_achievements', message: error.message });
  }
  if (!__westoModuleContext.db.loyalty) __westoModuleContext.db.loyalty = {};
  const previous = __westoModuleContext.db.loyalty.achievements;
  const previousById = new Map(__westoModuleContext.loyaltyAchievements.getLoyaltyAchievements(__westoModuleContext.db).map((item) => [item.id, item]));
  const savedAt = new Date().toISOString();
  __westoModuleContext.db.loyalty.achievements = normalized.map((achievement) => {
    const prior = previousById.get(achievement.id);
    const priorRewardWasLive = prior?.enabled !== false && Number(prior?.rewardPoints) > 0 && !!prior?.rewardStartsAt
      && __westoModuleContext.loyaltyAchievements.sameAchievementRewardDefinition(prior, achievement);
    const rewardStartsAt = achievement.enabled && achievement.rewardPoints > 0
      ? (priorRewardWasLive ? prior.rewardStartsAt : savedAt)
      : null;
    return { ...achievement, rewardStartsAt };
  });
  try {
    const persisted = await __westoModuleContext.save({ requireDurable: true });
    if (persisted !== true) throw Object.assign(new Error('ذخیرهٔ پایدار تنظیمات تأیید نشد.'), { code: 'persistence_unconfirmed', status: 503 });
  } catch (error) {
    if (previous === undefined) delete __westoModuleContext.db.loyalty.achievements;
    else __westoModuleContext.db.loyalty.achievements = previous;
    return res.status(error.status || 503).json({ error: error.code || 'loyalty_achievement_save_failed', message: 'ذخیرهٔ پایدار هدف‌های وفاداری انجام نشد؛ تغییری اعمال نشده است.' });
  }
  return res.json({ ok: true, achievements: __westoModuleContext.db.loyalty.achievements });
});
};
