'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/restaurant', (req, res) => {
  res.json(__westoModuleContext.publicRestaurantPayload(req.query.branch || req.query.branchId));
});
};
