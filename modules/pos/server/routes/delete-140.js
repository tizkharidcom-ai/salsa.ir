'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.delete('/api/admin/promotions/:id', __westoModuleContext.requireAdmin, (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  __westoModuleContext.db.promotions = (__westoModuleContext.db.promotions || []).filter((p) => Number(p.id) !== targetId);
  __westoModuleContext.save();
  res.json({ ok: true });
});
};
