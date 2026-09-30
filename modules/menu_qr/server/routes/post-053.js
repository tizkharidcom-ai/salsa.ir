'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/menu/categories', __westoModuleContext.requireAdmin, async (req, res) => {
  if (!Array.isArray(__westoModuleContext.db.menuCategories)) __westoModuleContext.db.menuCategories = [];
  const title = String(req.body.title || '').trim().slice(0, 80);
  if (!title) return res.status(400).json({ error: 'عنوان دسته لازم است' });
  const coverRaw = typeof req.body.coverImg === 'string' ? req.body.coverImg : '';
  const coverImg = __westoModuleContext.sanitizeCoverImg(coverRaw);
  if (coverImg === null) {
    return res.status(400).json({ error: 'مسیر کاور نامعتبر است (لیبل نوشیدنی Giro مجاز نیست)' });
  }
  const id = Math.max(0, ...__westoModuleContext.db.menuCategories.map((c) => c.id), 0) + 1;
  const cat = {
    id,
    title,
    name1: String(req.body.name1 || '').trim().slice(0, 80),
    name2: String(req.body.name2 || '').trim().slice(0, 80),
    shortDesc: String(req.body.shortDesc || '').trim().slice(0, 300),
    longDesc: String(req.body.longDesc || '').trim().slice(0, 800),
    hiddenOnSite: req.body.hiddenOnSite === true,
    coverImg,
  };
  const coverErr = __westoModuleContext.assertVisibleCategoryCover(cat);
  if (coverErr) return res.status(400).json({ error: coverErr });
  __westoModuleContext.db.menuCategories.push(cat);
  if (__westoModuleContext.tenantConnectionManager?.baseUrl && req.tenantDataAccess && req.tenantContext?.databaseProvider === 'postgres') {
    try {
      await __westoModuleContext.tenantMenuRepository.createCategory(req.tenantDataAccess, cat);
    } catch (err) {
      console.warn?.('[Tenant Category Persist Warning]', err.message);
    }
  }
  __westoModuleContext.save({ rebuildProducts: true });
  res.json({ ok: true, category: cat, menuCategories: __westoModuleContext.db.menuCategories, products: __westoModuleContext.db.products });
});
};
