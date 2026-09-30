'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/theme', __westoModuleContext.requireAdmin, (req, res) => {
  res.json({ theme: __westoModuleContext.db.theme || {} });
});
};
