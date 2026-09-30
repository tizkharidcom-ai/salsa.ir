'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/admin/menu-complement-rules', __westoModuleContext.requireCapability('menu.manage'), (req, res) => {
  const normalized = __westoModuleContext.normalizeComplementRuleInput(req.body || {});
  if (normalized.error) return res.status(400).json(normalized);
  const rule = { id: Math.max(0, ...(__westoModuleContext.db.menuComplementRules || []).map((item) => Number(item.id) || 0)) + 1, ...normalized.rule };
  __westoModuleContext.db.menuComplementRules.push(rule);
  __westoModuleContext.save({ bumpMenu: true });
  res.status(201).json({ ok: true, rule });
});
};
