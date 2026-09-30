'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.delete('/api/faq/:id', __westoModuleContext.requireAdmin, (req, res) => {
  if (!Array.isArray(__westoModuleContext.db.faq)) __westoModuleContext.db.faq = [];
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  __westoModuleContext.db.faq = __westoModuleContext.db.faq.filter((f) => Number(f.id) !== targetId);
  __westoModuleContext.save();
  res.json({ ok: true });
});
};
