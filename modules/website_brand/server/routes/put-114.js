'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/faq-order', __westoModuleContext.requireAdmin, (req, res) => {
  if (!Array.isArray(__westoModuleContext.db.faq)) __westoModuleContext.db.faq = [];
  const order = (Array.isArray(req.body.order) ? req.body.order : []).map((id) =>
    Number(__westoModuleContext.normalizeDigits(String(id || '')).replace(/\D/g, ''))
  );
  __westoModuleContext.db.faq.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  __westoModuleContext.save();
  res.json({ ok: true, faq: __westoModuleContext.db.faq });
});
};
