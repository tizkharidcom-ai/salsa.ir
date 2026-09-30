'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.delete('/api/menu/categories/:id', __westoModuleContext.requireAdmin, (req, res) => {
  if (!Array.isArray(__westoModuleContext.db.menuCategories)) __westoModuleContext.db.menuCategories = [];
  const id = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const cat = __westoModuleContext.db.menuCategories.find((c) => Number(c.id) === id);
  if (!cat) return res.status(404).json({ error: 'دسته پیدا نشد' });
  const inUse = (__westoModuleContext.db.menuItems || []).some((m) => Number(m.categoryId) === id);
  if (inUse) {
    return res.status(400).json({ error: 'ابتدا غذاهای این دسته را جابه‌جا یا حذف کنید' });
  }
  if (__westoModuleContext.db.menuCategories.length <= 1) {
    return res.status(400).json({ error: 'حداقل یک دسته باید باقی بماند' });
  }
  __westoModuleContext.db.menuCategories = __westoModuleContext.db.menuCategories.filter((c) => Number(c.id) !== id);
  __westoModuleContext.save({ rebuildProducts: true });
  res.json({ ok: true, menuCategories: __westoModuleContext.db.menuCategories, products: __westoModuleContext.db.products });
});
};
