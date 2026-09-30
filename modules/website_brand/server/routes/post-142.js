'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/admin/promo-slides', __westoModuleContext.requireCapability('content.manage'), (req, res) => {
  const id = __westoModuleContext.nextId(__westoModuleContext.db.promoSlides || []);
  const base = {
    id, title: '', subtitle: '', badge: '', image: '', ctaLabel: '', actionType: 'none',
    actionValue: '', kind: 'general', placement: 'entrance', shareEnabled: true, enabled: true, status: 'published', startAt: null, endAt: null,
    branchId: null, sortOrder: (__westoModuleContext.db.promoSlides || []).length, autoplayMs: 0, impressions: 0, clicks: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const slide = __westoModuleContext.sanitizePromoSlideInput(req.body || {}, base);
  if (!slide.title && !slide.image) return res.status(400).json({ error: 'عنوان یا تصویر الزامی است' });
  __westoModuleContext.db.promoSlides = __westoModuleContext.db.promoSlides || [];
  __westoModuleContext.db.promoSlides.push(slide);
  __westoModuleContext.save();
  res.json({ ok: true, slide });
});
};
