'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put(['/api/admin/campaigns', '/api/admin/campaigns/settings'], __westoModuleContext.requireAdmin, (req, res) => {
  __westoModuleContext.db.campaigns = __westoModuleContext.db.campaigns || {};
  if (req.body.birthday) __westoModuleContext.db.campaigns.birthday = { ...__westoModuleContext.db.campaigns.birthday, ...req.body.birthday };
  if (req.body.referral) __westoModuleContext.db.campaigns.referral = { ...__westoModuleContext.db.campaigns.referral, ...req.body.referral };
  if (req.body.happyHour) __westoModuleContext.db.campaigns.happyHour = { ...__westoModuleContext.db.campaigns.happyHour, ...req.body.happyHour };
  __westoModuleContext.save();
  res.json({ ok: true, campaigns: __westoModuleContext.campaignsEngine.getCampaignConfig(__westoModuleContext.db) });
});
};
