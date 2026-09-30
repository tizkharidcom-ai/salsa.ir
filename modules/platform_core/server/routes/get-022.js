'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/auth/me', (req, res) => {
  const user = __westoModuleContext.currentUser(req);
  // Guests get 200 + null (avoids Chrome "Failed to load resource" 401 noise)
  if (!user) return res.json({ user: null });
  res.json({ user: __westoModuleContext.publicUser(user) });
});
};
