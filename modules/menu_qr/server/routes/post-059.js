'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/admin/menu/bulk-adjust-prices', __westoModuleContext.requireAdmin, (req, res) => {
  const categoryId = req.body.categoryId != null && req.body.categoryId !== '' ? Number(req.body.categoryId) : null;
  const percentChange = Number(req.body.percentChange) || 0;
  const roundToNearest = Math.max(100, Number(req.body.roundToNearest) || 1000);
  if (!percentChange || Math.abs(percentChange) > 100) {
    return res.status(400).json({ error: 'درصد تغییر نامعتبر است (باید بین -۱۰۰ تا ۱۰۰ باشد)' });
  }
  const factor = 1 + (percentChange / 100);
  const itemsToUpdate = (__westoModuleContext.db.menuItems || []).filter((m) => categoryId == null || Number(m.categoryId) === categoryId);
  const changes = [];
  itemsToUpdate.forEach((m) => {
    const oldPrice = m.price || 0;
    const newPrice = Math.max(0, Math.round((oldPrice * factor) / roundToNearest) * roundToNearest);
    m.price = newPrice;
    m.updatedAt = Date.now();
    changes.push({ id: m.id, name: m.name, oldPrice, newPrice });
  });
  __westoModuleContext.save({ rebuildProducts: true });
  res.json({ ok: true, updatedCount: changes.length, changes });
});
};
