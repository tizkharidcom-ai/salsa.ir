'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.delete('/api/admin/menu-complement-rules/:id', __westoModuleContext.requireCapability('menu.manage'), (req, res) => {
  const id = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  if (!(__westoModuleContext.db.menuComplementRules || []).some((item) => Number(item.id) === id)) return res.status(404).json({ error: 'قانون مکمل پیدا نشد' });
  __westoModuleContext.db.menuComplementRules = __westoModuleContext.db.menuComplementRules.filter((item) => Number(item.id) !== id);
  __westoModuleContext.save({ bumpMenu: true });
  res.json({ ok: true });
});
};
