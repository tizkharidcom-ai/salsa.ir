'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/admin/menu-complements/:id', __westoModuleContext.requireCapability('menu.manage'), (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const complement = (__westoModuleContext.db.menuComplements || []).find((item) => Number(item.id) === targetId);
  if (!complement) return res.status(404).json({ error: 'مکمل پیدا نشد' });
  const normalized = __westoModuleContext.normalizeComplementInput(req.body || {}, complement);
  if (normalized.error) return res.status(400).json(normalized);
  Object.assign(complement, normalized.complement);
  __westoModuleContext.save({ bumpMenu: true });
  res.json({ ok: true, complement });
});
};
