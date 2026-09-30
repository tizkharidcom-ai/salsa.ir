'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/i18n', (req, res) => {
  res.json({ i18n: __westoModuleContext.db.i18n || { guestLangEnabled: true, defaultLang: 'fa', supported: ['fa', 'en', 'ar'] } });
});
};
