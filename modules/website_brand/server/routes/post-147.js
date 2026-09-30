'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/promo-slides/:id/click', (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const slide = (__westoModuleContext.db.promoSlides || []).find((item) => Number(item.id) === targetId);
  if (slide) { slide.clicks = (Number(slide.clicks) || 0) + 1; __westoModuleContext.save(); }
  res.status(204).end();
});
};
