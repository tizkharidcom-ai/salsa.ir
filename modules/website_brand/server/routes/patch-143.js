'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.patch('/api/admin/promo-slides/:id', __westoModuleContext.requireCapability('content.manage'), (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const index = (__westoModuleContext.db.promoSlides || []).findIndex((slide) => Number(slide.id) === targetId);
  if (index < 0) return res.status(404).json({ error: 'not found' });
  const updated = __westoModuleContext.sanitizePromoSlideInput(req.body || {}, __westoModuleContext.db.promoSlides[index]);
  updated.updatedAt = new Date().toISOString();
  __westoModuleContext.db.promoSlides[index] = updated;
  __westoModuleContext.save();
  res.json({ ok: true, slide: updated });
});
};
