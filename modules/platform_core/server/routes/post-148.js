'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/admin/prices/bulk', __westoModuleContext.requireAdmin, (req, res) => {
  const mode = req.body.mode === 'set' ? 'set' : req.body.mode === 'delta' ? 'delta' : 'percent';
  const parseNum = (v) => {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v;
    return Number(__westoModuleContext.normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
  };
  const value = parseNum(req.body.value);
  const rawCat = req.body.categoryId != null ? req.body.categoryId : null;
  const categoryId = rawCat != null && rawCat !== ''
    ? Number(__westoModuleContext.normalizeDigits(String(rawCat)).replace(/\D/g, ''))
    : null;
  if (!Number.isFinite(value)) return res.status(400).json({ error: 'مقدار نامعتبر' });
  let n = 0;
  for (const item of (__westoModuleContext.db.menuItems || [])) {
    if (categoryId != null && Number(item.categoryId) !== categoryId) continue;
    if (mode === 'percent') item.price = Math.max(0, Math.round(item.price * (1 + value / 100)));
    else if (mode === 'delta') item.price = Math.max(0, Math.round(item.price + value));
    else item.price = Math.max(0, Math.round(value));
    n += 1;
  }
  __westoModuleContext.save();
  res.json({ ok: true, updated: n });
});
};
