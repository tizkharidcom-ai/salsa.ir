'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/profile/birthday', __westoModuleContext.requireAuth, (req, res) => {
  const birthdate = String(req.body.birthdate || '').trim();
  if (!birthdate) return res.status(400).json({ error: 'تاریخ تولد نامعتبر است.' });

  const user = __westoModuleContext.db.users.find((u) => u.phone === req.user.phone);
  if (!user) return res.status(404).json({ error: 'کاربر یافت نشد.' });

  if (birthdate !== (user.birthdate || '') && __westoModuleContext.isBirthdateLocked(user)) {
    return res.status(400).json({
      error: 'تاریخ تولد قبلاً ثبت شده و امکان تغییر آن تا ۱ سال وجود ندارد. برای تغییر، با مدیریت هماهنگ فرمایید.',
      birthdateLocked: true,
      birthdate: user.birthdate,
    });
  }

  user.birthdate = birthdate;
  user.birthdateUpdatedAt = new Date().toISOString();
  __westoModuleContext.save();

  const eligibility = __westoModuleContext.campaignsEngine.checkBirthdayEligibility(__westoModuleContext.db, user);
  res.json({ ok: true, birthdate: user.birthdate, eligibility, birthdateLocked: true });
});
};
