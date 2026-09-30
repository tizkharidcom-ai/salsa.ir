'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/admin/neem-integration/backfill', __westoModuleContext.requireCapability('admin.access'), __westoModuleContext.handleIntegrationBackfill);
};
