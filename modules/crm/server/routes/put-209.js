'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/admin/feedback/settings', __westoModuleContext.requireOwner, (req, res) => {
  if (!__westoModuleContext.db.feedbackSettings) __westoModuleContext.db.feedbackSettings = {};
  const s = req.body.settings || req.body || {};
  if (typeof s.enabled === 'boolean') __westoModuleContext.db.feedbackSettings.enabled = s.enabled;
  if (typeof s.askAfterOrder === 'boolean') __westoModuleContext.db.feedbackSettings.askAfterOrder = s.askAfterOrder;
  if (typeof s.title === 'string') __westoModuleContext.db.feedbackSettings.title = s.title.trim().slice(0, 120);
  if (typeof s.subtitle === 'string') __westoModuleContext.db.feedbackSettings.subtitle = s.subtitle.trim().slice(0, 240);
  if (typeof s.thankYou === 'string') __westoModuleContext.db.feedbackSettings.thankYou = s.thankYou.trim().slice(0, 200);
  __westoModuleContext.save();
  res.json({ ok: true, settings: __westoModuleContext.db.feedbackSettings });
});
};
