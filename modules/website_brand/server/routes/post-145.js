'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/admin/promo-slides/reorder', __westoModuleContext.requireCapability('content.manage'), (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
  if (!ids.length) return res.status(400).json({ error: 'ids required' });
  const order = new Map(ids.map((id, index) => [id, index]));
  for (const slide of __westoModuleContext.db.promoSlides || []) {
    if (order.has(Number(slide.id))) slide.sortOrder = order.get(Number(slide.id));
  }
  __westoModuleContext.save();
  res.json({ ok: true });
});
};
