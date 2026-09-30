'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/manifest.webmanifest', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('application/manifest+json');
  res.sendFile(__westoModuleContext.path.join(__westoModuleContext.ROOT, 'manifest.webmanifest'));
});
};
