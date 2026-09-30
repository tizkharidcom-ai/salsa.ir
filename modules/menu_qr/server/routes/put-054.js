'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/menu/categories/order', __westoModuleContext.requireAdmin, (req, res) => {
  if (!Array.isArray(__westoModuleContext.db.menuCategories)) __westoModuleContext.db.menuCategories = [];
  const order = Array.isArray(req.body.order) ? req.body.order.map(Number) : [];
  if (!order.length) return res.status(400).json({ error: 'ترتیب نامعتبر است' });
  const byId = Object.fromEntries(__westoModuleContext.db.menuCategories.map((c) => [c.id, c]));
  const next = [];
  for (const id of order) {
    if (byId[id]) {
      next.push(byId[id]);
      delete byId[id];
    }
  }
  for (const c of Object.values(byId)) next.push(c);
  __westoModuleContext.db.menuCategories = next;
  __westoModuleContext.save({ rebuildProducts: true });
  res.json({ ok: true, menuCategories: __westoModuleContext.db.menuCategories, products: __westoModuleContext.db.products });
});
};
