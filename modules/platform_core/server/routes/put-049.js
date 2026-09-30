'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/admin/i18n', __westoModuleContext.requireAdmin, (req, res) => {
  if (!__westoModuleContext.db.i18n) __westoModuleContext.db.i18n = { guestLangEnabled: true, defaultLang: 'fa', supported: ['fa', 'en', 'ar'] };
  if (typeof req.body.guestLangEnabled === 'boolean') __westoModuleContext.db.i18n.guestLangEnabled = req.body.guestLangEnabled;
  if (req.body.defaultLang === 'fa' || req.body.defaultLang === 'en' || req.body.defaultLang === 'ar') {
    __westoModuleContext.db.i18n.defaultLang = req.body.defaultLang;
  }
  __westoModuleContext.db.i18n.supported = ['fa', 'en', 'ar'];
  __westoModuleContext.save();
  res.json({ ok: true, i18n: __westoModuleContext.db.i18n });
});
};
