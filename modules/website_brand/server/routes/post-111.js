'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/faq', __westoModuleContext.requireAdmin, (req, res) => {
  if (!Array.isArray(__westoModuleContext.db.faq)) __westoModuleContext.db.faq = [];
  const id = Math.max(0, ...__westoModuleContext.db.faq.map((f) => Number(f.id) || 0), 0) + 1;
  const item = { id, q: String(req.body.q || '').trim(), a: String(req.body.a || '').trim() };
  __westoModuleContext.db.faq.push(item);
  __westoModuleContext.save();
  res.json({ ok: true, item });
});
};
