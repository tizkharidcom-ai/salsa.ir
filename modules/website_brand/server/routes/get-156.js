'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/uploads', __westoModuleContext.requireAdmin, (req, res) => {
  __westoModuleContext.fs.mkdirSync(__westoModuleContext.UPLOADS, { recursive: true });
  const files = __westoModuleContext.fs.readdirSync(__westoModuleContext.UPLOADS).map((f) => ({ path: `uploads/${f}`, size: __westoModuleContext.fs.statSync(__westoModuleContext.path.join(__westoModuleContext.UPLOADS, f)).size }));
  res.json({ files });
});
};
