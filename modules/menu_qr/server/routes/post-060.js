'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/admin/menu/bulk-undo-prices', __westoModuleContext.requireAdmin, (req, res) => {
  const changes = Array.isArray(req.body.changes) ? req.body.changes : [];
  if (!changes.length) return res.status(400).json({ error: 'لیست تغییرات برای بازگردانی خالی است' });
  let restored = 0;
  changes.forEach((c) => {
    const item = (__westoModuleContext.db.menuItems || []).find((m) => Number(m.id) === Number(c.id));
    if (item && c.oldPrice != null) {
      item.price = Math.max(0, Math.round(Number(c.oldPrice)));
      item.updatedAt = Date.now();
      restored++;
    }
  });
  __westoModuleContext.save({ rebuildProducts: true });
  res.json({ ok: true, restoredCount: restored });
});
};
