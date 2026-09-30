'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/sms/rfm', __westoModuleContext.requireAdmin, (req, res) => {
  const rfm = __westoModuleContext.smsEngine.calculateCustomerRfm(__westoModuleContext.db);
  res.json(rfm);
});
};
