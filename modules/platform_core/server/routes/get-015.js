'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/ops', __westoModuleContext.requireCapability('admin.access'), (req, res) => {
  const target = process.env.SALSA_OPS_URL || process.env.NEEM_OPS_URL || 'http://127.0.0.1:3050/#overview';
  res.redirect(302, target);
});
};
