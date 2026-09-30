'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/campaigns/status', (req, res) => {
  const happyHour = __westoModuleContext.campaignsEngine.checkHappyHourStatus(__westoModuleContext.db);
  const config = __westoModuleContext.campaignsEngine.getCampaignConfig(__westoModuleContext.db);
  res.json({
    happyHour,
    campaigns: {
      birthdayEnabled: config.birthday.enabled,
      referralEnabled: config.referral.enabled,
      happyHourEnabled: config.happyHour.enabled,
    },
  });
});
};
