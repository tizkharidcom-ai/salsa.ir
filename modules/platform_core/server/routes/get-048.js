'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/i18n', __westoModuleContext.requireAdmin, (req, res) => {
  const items = __westoModuleContext.db.menuItems || [];
  const missingEn = items.filter((m) => !String(m.en || '').trim()).length;
  const missingDescEn = items.filter((m) => m.desc && !String(m.descEn || '').trim()).length;
  const missingAr = items.filter((m) => !String(m.ar || '').trim()).length;
  const missingDescAr = items.filter((m) => m.desc && !String(m.descAr || '').trim()).length;
  res.json({
    i18n: __westoModuleContext.db.i18n,
    stats: {
      total: items.length,
      withEn: items.filter((m) => String(m.en || '').trim()).length,
      missingEn,
      missingDescEn,
      withAr: items.filter((m) => String(m.ar || '').trim()).length,
      missingAr,
      missingDescAr,
      engine: __westoModuleContext.translationEngine(),
    },
  });
});
};
