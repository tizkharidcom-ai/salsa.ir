'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/admin/translate/menu', __westoModuleContext.requireAdmin, async (req, res) => {
  const force = !!req.body.force;
  const onlyMissing = req.body.onlyMissing !== false;
  const ids = Array.isArray(req.body.ids)
    ? req.body.ids.map((id) => Number(__westoModuleContext.normalizeDigits(String(id)).replace(/\D/g, ''))).filter(Number.isFinite)
    : null;
  const langs = Array.isArray(req.body.langs) && req.body.langs.length
    ? req.body.langs.map(String)
    : ['en', 'ar'];
  let targets = __westoModuleContext.db.menuItems || [];
  if (ids) targets = targets.filter((m) => ids.includes(Number(m.id)));
  if (onlyMissing && !force) {
    targets = targets.filter(
      (m) =>
        !String(m.en || '').trim() ||
        __westoModuleContext.isBrokenEn(m.en) ||
        (m.desc && (!String(m.descEn || '').trim() || __westoModuleContext.isBrokenEn(m.descEn))) ||
        !String(m.ar || '').trim() ||
        (m.desc && !String(m.descAr || '').trim()),
    );
  }
  const updated = [];
  for (const item of targets) {
    const tr = await __westoModuleContext.translateMenuItem(item, { force, langs });
    if (langs.includes('en')) {
      item.en = tr.en;
      item.descEn = tr.descEn;
    }
    if (langs.includes('ar')) {
      item.ar = tr.ar;
      item.descAr = tr.descAr;
    }
    updated.push({
      id: item.id,
      en: item.en,
      descEn: item.descEn,
      ar: item.ar,
      descAr: item.descAr,
      engine: tr.engine,
    });
  }
  __westoModuleContext.save();
  res.json({
    ok: true,
    count: updated.length,
    engine: __westoModuleContext.translationEngine(),
    items: updated,
  });
});
};
