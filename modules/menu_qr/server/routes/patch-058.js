'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.patch('/api/menu/:id', __westoModuleContext.requireAdmin, async (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const item = (__westoModuleContext.db.menuItems || []).find((m) => Number(m.id) === targetId);
  if (!item) return res.status(404).json({ error: 'not found' });
  const parseNum = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    const n = Number(__westoModuleContext.normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? null : n;
  };
  if (typeof req.body.name === 'string') item.name = req.body.name.trim().slice(0, 120);
  if (typeof req.body.desc === 'string') item.desc = req.body.desc.trim().slice(0, 500);
  const rawPrice = parseNum(req.body.price);
  if (rawPrice != null && rawPrice >= 0) item.price = Math.round(rawPrice);
  if (typeof req.body.available === 'boolean') item.available = req.body.available;
  if (Array.isArray(req.body.allergens)) item.allergens = __westoModuleContext.normalizeAllergens(req.body.allergens);
  if (Array.isArray(req.body.dietary)) item.dietary = req.body.dietary.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 10);
  const rawPrep = parseNum(req.body.prepTime ?? req.body.prepTimeMinutes);
  if (rawPrep != null && rawPrep >= 0) item.prepTime = Math.round(rawPrep);
  if (req.body.stock === null || req.body.stock === '') item.stock = null;
  else {
    const rawStock = parseNum(req.body.stock);
    if (rawStock != null && rawStock >= 0) {
      item.stock = Math.round(rawStock);
      if (item.stock === 0) item.available = false;
    }
  }
  item.updatedAt = Date.now();
  __westoModuleContext.save({ rebuildProducts: true });
  res.json({ ok: true, item: __westoModuleContext.menuItemForResponse(item) });
});
};
