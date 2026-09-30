'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/inventory', __westoModuleContext.requireAdmin, (req, res) => {
  const cats = Object.fromEntries((__westoModuleContext.db.menuCategories || []).map((c) => [c.id, c.title]));
  const items = (__westoModuleContext.db.menuItems || []).map((m) => ({
    id: m.id,
    name: m.name,
    categoryId: m.categoryId,
    category: cats[m.categoryId] || String(m.categoryId),
    stock: m.stock === undefined ? null : m.stock,
    lowStockAt: m.lowStockAt ?? 5,
    available: m.available !== false,
    tracked: typeof m.stock === 'number',
    low:
      typeof m.stock === 'number' &&
      m.stock > 0 &&
      m.stock <= (m.lowStockAt ?? 5),
    empty: m.stock === 0,
  }));
  res.json({
    items,
    summary: {
      tracked: items.filter((i) => i.tracked).length,
      low: items.filter((i) => i.low).length,
      empty: items.filter((i) => i.empty).length,
      unlimited: items.filter((i) => !i.tracked).length,
    },
  });
});
};
