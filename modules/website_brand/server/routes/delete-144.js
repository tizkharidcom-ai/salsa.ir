'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.delete('/api/admin/promo-slides/:id', __westoModuleContext.requireCapability('content.manage'), (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  __westoModuleContext.db.promoSlides = (__westoModuleContext.db.promoSlides || []).filter((slide) => Number(slide.id) !== targetId);
  __westoModuleContext.save();
  res.json({ ok: true });
});
};
