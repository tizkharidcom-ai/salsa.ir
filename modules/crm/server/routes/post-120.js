'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/newsletter', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'ایمیل معتبر نیست' });
  if (!Array.isArray(__westoModuleContext.db.newsletter)) __westoModuleContext.db.newsletter = [];
  if (!__westoModuleContext.db.newsletter.find((n) => n.email === email)) {
    __westoModuleContext.db.newsletter.push({ email, at: new Date().toISOString() });
    __westoModuleContext.save();
  }
  res.json({ ok: true });
});
};
