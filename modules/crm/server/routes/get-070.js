'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/profile/orders', __westoModuleContext.requireAuth, (req, res, next) => {
  req.url = '/api/orders/my-orders';
  __westoModuleContext.app.handle(req, res, next);
});
};
