'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.delete('/api/admin/branches/:id', __westoModuleContext.requireAdmin, (req, res) => {
  const id = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  if ((__westoModuleContext.db.branches || []).length <= 1) {
    return res.status(400).json({ error: 'حداقل یک شعبه لازم است' });
  }
  const fallback = (__westoModuleContext.db.branches || []).find((b) => Number(b.id) !== id);
  __westoModuleContext.db.branches = (__westoModuleContext.db.branches || []).filter((b) => Number(b.id) !== id);
  for (const t of __westoModuleContext.db.tables || []) {
    if (Number(t.branchId) === id) t.branchId = fallback ? fallback.id : 1;
  }
  for (const o of __westoModuleContext.db.orders || []) {
    if (Number(o.branchId) === id) o.branchId = fallback ? fallback.id : 1;
  }
  __westoModuleContext.syncLegacyHours();
  __westoModuleContext.save();
  res.json({ ok: true });
});
};
