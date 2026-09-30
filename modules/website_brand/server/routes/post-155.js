'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/admin/upload', __westoModuleContext.requireAdmin, (req, res) => {
  __westoModuleContext.upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'آپلود ناموفق' });
    if (!req.file) return res.status(400).json({ error: 'no file' });
    res.json({ ok: true, path: `uploads/${req.file.filename}` });
  });
});
};
