'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/settings', __westoModuleContext.requireAdmin, (req, res) => res.json({ settings: __westoModuleContext.db.settings, loyalty: __westoModuleContext.db.loyalty }));
};
