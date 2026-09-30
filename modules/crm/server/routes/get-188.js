'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get(['/api/admin/campaigns', '/api/admin/campaigns/summary'], __westoModuleContext.requireAdmin, (req, res) => {
  const summary = __westoModuleContext.campaignsEngine.summarizeCampaigns(__westoModuleContext.db);
  res.json(summary);
});
};
