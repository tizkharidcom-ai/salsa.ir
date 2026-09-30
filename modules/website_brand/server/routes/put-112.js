'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/faq/:id', __westoModuleContext.requireAdmin, (req, res) => {
  if (!Array.isArray(__westoModuleContext.db.faq)) __westoModuleContext.db.faq = [];
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const item = __westoModuleContext.db.faq.find((f) => Number(f.id) === targetId);
  if (!item) return res.status(404).json({ error: 'not found' });
  if (typeof req.body.q === 'string') item.q = req.body.q;
  if (typeof req.body.a === 'string') item.a = req.body.a;
  __westoModuleContext.save();
  res.json({ ok: true, item });
});
};
