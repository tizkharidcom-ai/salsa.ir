'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/user/feedback', __westoModuleContext.requireAuth, (req, res) => {
  const { rating, comment, tags, aspectRatings } = req.body || {};
  const user = (__westoModuleContext.db.users || []).find((u) => u.phone === req.user.phone) || req.user;
  __westoModuleContext.db.feedbacks = Array.isArray(__westoModuleContext.db.feedbacks) ? __westoModuleContext.db.feedbacks : [];

  const feedbackId = `fb_${Date.now()}_${__westoModuleContext.crypto.randomBytes(4).toString('hex')}`;
  const numRating = Math.min(5, Math.max(1, Number(rating) || 5));
  const newFeedback = {
    id: feedbackId,
    phone: user.phone,
    userName: user.name || 'مشتری وستو',
    rating: numRating,
    comment: typeof comment === 'string' ? comment.trim().slice(0, 1000) : '',
    tags: Array.isArray(tags) ? tags.map((t) => String(t).slice(0, 50)) : [],
    aspectRatings: typeof aspectRatings === 'object' && aspectRatings ? aspectRatings : {},
    createdAt: new Date().toISOString(),
  };

  __westoModuleContext.db.feedbacks.unshift(newFeedback);

  let pointsAwarded = 0;
  const lastAwardTime = user.lastFeedbackRewardAt ? new Date(user.lastFeedbackRewardAt).getTime() : 0;
  const monthMs = 30 * 24 * 60 * 60 * 1000;
  if (Date.now() - lastAwardTime > monthMs) {
    pointsAwarded = 50;
    user.points = (Number(user.points) || 0) + pointsAwarded;
    user.lastFeedbackRewardAt = new Date().toISOString();
  }

  __westoModuleContext.save();
  res.json({
    ok: true,
    message: 'با تشکر! بازخورد شما با موفقیت ثبت شد.',
    pointsAwarded,
    newPoints: user.points,
  });
});
};
