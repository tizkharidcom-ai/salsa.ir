'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/promo-slides', __westoModuleContext.requireCapability('content.manage'), (req, res) => {
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;
  const slides = (__westoModuleContext.db.promoSlides || [])
    .filter((slide) => !branchId || slide.branchId == null || Number(slide.branchId) === branchId)
    .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) || Number(a.id) - Number(b.id));
  res.json({ slides, branches: __westoModuleContext.db.branches || [] });
});
};
