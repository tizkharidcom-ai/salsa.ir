'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/newsletter', __westoModuleContext.requireOwner, (req, res) => {
  res.json({ newsletter: Array.isArray(__westoModuleContext.db.newsletter) ? __westoModuleContext.db.newsletter : [] });
});
};
