'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/admin/inventory/adjust', __westoModuleContext.requireAdmin, (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.body.id || '')).replace(/\D/g, ''));
  const item = (__westoModuleContext.db.menuItems || []).find((m) => Number(m.id) === targetId);
  if (!item) return res.status(404).json({ error: 'not found' });
  const parseNum = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    const n = Number(__westoModuleContext.normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? null : n;
  };
  if (req.body.stock === null || req.body.mode === 'unlimited') {
    item.stock = null;
  } else if (req.body.mode === 'set') {
    const s = parseNum(req.body.stock);
    item.stock = Math.max(0, Math.round(s ?? 0));
  } else {
    const delta = Math.round(parseNum(req.body.delta) ?? 0);
    const base = typeof item.stock === 'number' ? item.stock : 0;
    item.stock = Math.max(0, base + delta);
  }
  if (item.stock === 0) item.available = false;
  else if (typeof item.stock === 'number' && item.stock > 0 && req.body.restock === true) {
    item.available = true;
  }
  const lowStock = parseNum(req.body.lowStockAt);
  if (lowStock != null) item.lowStockAt = Math.max(0, Math.round(lowStock));
  __westoModuleContext.save();
  res.json({ ok: true, item });
});
};
