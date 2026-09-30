'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/user/avatar', __westoModuleContext.requireAuth, (req, res) => {
  const { avatar } = req.body || {};
  const user = (__westoModuleContext.db.users || []).find((u) => __westoModuleContext.phonesMatch(u.phone, req.user.phone)) || req.user;
  user.avatar = typeof avatar === 'string' ? avatar.trim().slice(0, 200000) : '';
  __westoModuleContext.save();
  res.json({ ok: true, avatar: user.avatar, user: __westoModuleContext.publicUser(user) });
});
};
