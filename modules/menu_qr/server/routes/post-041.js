'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/admin/menu-complements', __westoModuleContext.requireCapability('menu.manage'), (req, res) => {
  const normalized = __westoModuleContext.normalizeComplementInput(req.body || {});
  if (normalized.error) return res.status(400).json(normalized);
  const complement = { id: Math.max(0, ...(__westoModuleContext.db.menuComplements || []).map((item) => Number(item.id) || 0)) + 1, ...normalized.complement };
  __westoModuleContext.db.menuComplements.push(complement);
  __westoModuleContext.save({ bumpMenu: true });
  res.status(201).json({ ok: true, complement });
});
};
