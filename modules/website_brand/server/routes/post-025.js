'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/user/avatar/upload', __westoModuleContext.requireAuth, (req, res) => {
  __westoModuleContext.userAvatarUpload.single('avatar')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ ok: false, error: err.message || 'خطا در آپلود تصویر' });
    }
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'فایل تصویری انتخاب نشده است.' });
    }
    const avatarUrl = `uploads/avatars/${req.file.filename}`;
    const user = (__westoModuleContext.db.users || []).find((u) => __westoModuleContext.phonesMatch(u.phone, req.user.phone)) || req.user;
    user.avatar = avatarUrl;
    __westoModuleContext.save();
    res.json({ ok: true, avatar: avatarUrl, user: __westoModuleContext.publicUser(user) });
  });
});
};
