'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.delete('/api/admin/menu-complements/:id', __westoModuleContext.requireCapability('menu.manage'), (req, res) => {
  const id = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  if (!(__westoModuleContext.db.menuComplements || []).some((item) => Number(item.id) === id)) return res.status(404).json({ error: 'مکمل پیدا نشد' });
  __westoModuleContext.db.menuComplements = __westoModuleContext.db.menuComplements.filter((item) => Number(item.id) !== id);
  for (const rule of __westoModuleContext.db.menuComplementRules || []) rule.complementIds = (rule.complementIds || []).filter((entry) => Number(entry) !== id);
  __westoModuleContext.db.menuComplementRules = (__westoModuleContext.db.menuComplementRules || []).filter((rule) => (rule.complementIds || []).length);
  __westoModuleContext.save({ bumpMenu: true });
  res.json({ ok: true });
});
};
