'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/admin/menu-complement-rules/:id', __westoModuleContext.requireCapability('menu.manage'), (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const rule = (__westoModuleContext.db.menuComplementRules || []).find((item) => Number(item.id) === targetId);
  if (!rule) return res.status(404).json({ error: 'قانون مکمل پیدا نشد' });
  const normalized = __westoModuleContext.normalizeComplementRuleInput(req.body || {}, rule);
  if (normalized.error) return res.status(400).json(normalized);
  Object.assign(rule, normalized.rule);
  __westoModuleContext.save({ bumpMenu: true });
  res.json({ ok: true, rule });
});
};
