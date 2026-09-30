'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/ops/:view', __westoModuleContext.requireCapability('admin.access'), (req, res) => {
  const view = String(req.params.view || '');
  if (!__westoModuleContext.SALSA_OPERATION_VIEWS.has(view)) return res.status(404).json({ error: 'unknown_salsa_view' });
  const base = (process.env.SALSA_OPS_URL || process.env.NEEM_OPS_URL || 'http://127.0.0.1:3050').replace(/\/?(?:#.*)?$/, '');
  res.redirect(302, `${base}/#${encodeURIComponent(view)}`);
});
};
