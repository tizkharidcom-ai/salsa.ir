'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'westo_session=; Path=/; HttpOnly; Max-Age=0');
  res.json({ ok: true });
});
};
