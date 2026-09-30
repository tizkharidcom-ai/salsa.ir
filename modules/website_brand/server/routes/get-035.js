'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/content', (req, res) => {
  res.json(__westoModuleContext.publicContentPayload());
});
};
