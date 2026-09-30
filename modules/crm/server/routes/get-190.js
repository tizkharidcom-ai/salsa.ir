'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/sms/stats', __westoModuleContext.requireAdmin, (req, res) => {
  const summary = __westoModuleContext.smsEngine.summarizeSmsEngine(__westoModuleContext.db);
  res.json(summary);
});
};
