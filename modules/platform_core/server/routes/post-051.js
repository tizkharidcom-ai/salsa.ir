'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/admin/translate/menu/:id', __westoModuleContext.requireAdmin, async (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const item = (__westoModuleContext.db.menuItems || []).find((m) => Number(m.id) === targetId);
  if (!item) return res.status(404).json({ error: 'not found' });
  const langs = Array.isArray(req.body.langs) && req.body.langs.length
    ? req.body.langs.map(String)
    : ['en', 'ar'];
  const tr = await __westoModuleContext.translateMenuItem(item, { force: !!req.body.force, langs });
  if (langs.includes('en')) {
    item.en = tr.en;
    item.descEn = tr.descEn;
  }
  if (langs.includes('ar')) {
    item.ar = tr.ar;
    item.descAr = tr.descAr;
  }
  __westoModuleContext.save();
  res.json({ ok: true, item, engine: tr.engine });
});
};
