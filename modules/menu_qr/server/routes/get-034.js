'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/js/content-bootstrap.static.js', (req, res, next) => {
  const tenantId = req.tenantContext?.tenantId || req.tenantId || __westoModuleContext.db.tenantIdentity?.tenantId;
  if (!tenantId || tenantId === 'westo') return next();
  const json = JSON.stringify(__westoModuleContext.publicContentPayload()).replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  res.type('application/javascript');
  res.setHeader('Cache-Control', 'no-store');
  res.send(`window.__WESTO_CONTENT__=${json};`);
});
};
