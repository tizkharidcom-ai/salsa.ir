'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.patch('/api/cashier/orders/:id', __westoModuleContext.requireCapability('orders.manage'), __westoModuleContext.serializeOrderMutationRoute(__westoModuleContext.handleEditOrder));
};
