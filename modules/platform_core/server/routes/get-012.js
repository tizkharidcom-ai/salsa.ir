'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/neem-integration', __westoModuleContext.requireCapability('admin.access'), __westoModuleContext.handleIntegrationStatus);
};
