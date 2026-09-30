'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/menu/categories/:id', __westoModuleContext.requireAdmin, (req, res) => {
  if (!Array.isArray(__westoModuleContext.db.menuCategories)) __westoModuleContext.db.menuCategories = [];
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const cat = __westoModuleContext.db.menuCategories.find((c) => Number(c.id) === targetId);
  if (!cat) return res.status(404).json({ error: 'دسته پیدا نشد' });
  if (typeof req.body.title === 'string') {
    const title = req.body.title.trim().slice(0, 80);
    if (!title) return res.status(400).json({ error: 'عنوان دسته لازم است' });
    cat.title = title;
    cat.name1 = title;
    cat.name2 = '';
  }
  // Ignore legacy name1/name2 writes — title is the single display field.
  if (typeof req.body.shortDesc === 'string') cat.shortDesc = req.body.shortDesc.trim().slice(0, 300);
  if (typeof req.body.longDesc === 'string') cat.longDesc = req.body.longDesc.trim().slice(0, 800);
  if (typeof req.body.hiddenOnSite === 'boolean') cat.hiddenOnSite = req.body.hiddenOnSite;
  if (typeof req.body.coverImg === 'string') {
    const coverImg = __westoModuleContext.sanitizeCoverImg(req.body.coverImg);
    if (coverImg === null) {
      return res.status(400).json({ error: 'مسیر کاور نامعتبر است (لیبل نوشیدنی Giro مجاز نیست)' });
    }
    cat.coverImg = coverImg;
  }
  const coverErr = __westoModuleContext.assertVisibleCategoryCover(cat);
  if (coverErr) return res.status(400).json({ error: coverErr });
  __westoModuleContext.save({ rebuildProducts: true });
  res.json({ ok: true, category: cat, menuCategories: __westoModuleContext.db.menuCategories, products: __westoModuleContext.db.products });
});
};
