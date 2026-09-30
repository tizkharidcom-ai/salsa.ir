'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.patch('/api/auth/profile', __westoModuleContext.requireAuth, (req, res) => {
  const { name, email, birthdate, gender, city, address, preferences, notes, avatar } = req.body || {};
  const user = (__westoModuleContext.db.users || []).find((u) => u.phone === req.user.phone) || req.user;
  if (typeof name === 'string') user.name = name.trim().slice(0, 100);
  if (typeof email === 'string') user.email = email.trim().slice(0, 200);

  if (typeof birthdate === 'string' && birthdate.trim()) {
    const trimmedBday = birthdate.trim().slice(0, 50);
    if (trimmedBday !== (user.birthdate || '')) {
      if (__westoModuleContext.isBirthdateLocked(user)) {
        return res.status(400).json({
          error: 'تاریخ تولد قبلاً ثبت شده و امکان تغییر آن تا ۱ سال وجود ندارد. برای تغییر، با مدیریت هماهنگ فرمایید.'
        });
      }
      user.birthdate = trimmedBday;
      user.birthdateUpdatedAt = new Date().toISOString();
      try {
        __westoModuleContext.campaignsEngine.checkBirthdayEligibility(__westoModuleContext.db, user);
      } catch (_) {}
    }
  }

  if (typeof gender === 'string') user.gender = gender.trim().slice(0, 20);
  if (typeof city === 'string') user.city = city.trim().slice(0, 100);
  if (typeof address === 'string') user.address = address.trim().slice(0, 300);
  if (Array.isArray(preferences)) user.preferences = preferences.map((p) => String(p).trim().slice(0, 50)).filter(Boolean);
  if (typeof notes === 'string') user.notes = notes.trim().slice(0, 500);
  if (typeof avatar === 'string') user.avatar = avatar.trim().slice(0, 200000);

  __westoModuleContext.save();
  res.json({ ok: true, user: __westoModuleContext.publicUser(user) });
});
};
