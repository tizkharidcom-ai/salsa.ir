'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.patch('/api/waiter/orders/:id', __westoModuleContext.requireCapability('service.manage'), __westoModuleContext.serializeOrderMutationRoute(__westoModuleContext.handleEditOrder));
};
