'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/auth/verify-otp', (req, res) => {
  const phone = __westoModuleContext.normalizeDigits(req.body?.phone || '').trim();
  const code = __westoModuleContext.normalizeDigits(req.body?.code || '').trim();
  const entry = __westoModuleContext.otps.get(phone);
  if (!entry || entry.expiresAt < Date.now()) return res.status(400).json({ error: 'کد منقضی شده است؛ دوباره درخواست دهید' });

  // Anti-Brute-Force: Track attempts and destroy code after MAX_OTP_ATTEMPTS
  entry.attempts = (entry.attempts || 0) + 1;
  if (entry.attempts > __westoModuleContext.MAX_OTP_ATTEMPTS) {
    __westoModuleContext.otps.delete(phone);
    return res.status(429).json({
      error: 'تعداد تلاش‌های ناموفق بیش از حد مجاز بود؛ کد باطل شد. لطفاً دوباره درخواست کد دهید.',
      code: 'MAX_ATTEMPTS_EXCEEDED'
    });
  }

  if (entry.code !== code) {
    const remaining = __westoModuleContext.MAX_OTP_ATTEMPTS - entry.attempts;
    return res.status(400).json({
      error: remaining > 0
        ? `کد واردشده درست نیست (${remaining} تلاش باقی‌مانده)`
        : 'کد واردشده درست نیست'
    });
  }
  __westoModuleContext.otps.delete(phone);

  // [TEMPORARILY DISABLED] platform-admin login restriction
  // if (PLATFORM_ONLY_PHONE_IDENTITIES.has(phone)
  //     || (Array.isArray(db.users) && db.users.some((candidate) =>
  //       normalizeDigits(String(candidate.phone || '')).trim() === phone && candidate.principalType === 'platform_admin'))) {
  //   return res.status(403).json({ error: 'separate_platform_account_required', message: 'حساب راهبر پلتفرم با حساب مالک رستوران جداست.' });
  // }

  if (!Array.isArray(__westoModuleContext.db.users)) __westoModuleContext.db.users = [];
  if (!__westoModuleContext.db.settings) __westoModuleContext.db.settings = { adminPhones: [] };
  if (!Array.isArray(__westoModuleContext.db.settings.adminPhones)) __westoModuleContext.db.settings.adminPhones = [];
  if (!Array.isArray(__westoModuleContext.db.loginLog)) __westoModuleContext.db.loginLog = [];

  let user = __westoModuleContext.db.users.find((u) => u.phone === phone);
  const isAdmin = Array.isArray(__westoModuleContext.db.settings.adminPhones) && __westoModuleContext.db.settings.adminPhones.includes(phone);
  if (!user) {
    user = {
      phone,
      name: '',
      email: '',
      role: isAdmin ? 'owner' : 'user',
      points: 0,
      createdAt: new Date().toISOString(),
      blocked: false,
    };
    __westoModuleContext.db.users.push(user);
    if (__westoModuleContext.db.loyalty && __westoModuleContext.db.loyalty.welcomePoints) {
      __westoModuleContext.awardLoyaltyPoints(phone, __westoModuleContext.db.loyalty.welcomePoints, 'welcome');
    }
  }
  // [DEV] Sync role with adminPhones on every login
  if (isAdmin && user.role !== 'owner') user.role = 'owner';
  user.lastLoginAt = new Date().toISOString();
  __westoModuleContext.db.loginLog.unshift({ phone, at: user.lastLoginAt });
  __westoModuleContext.db.loginLog = __westoModuleContext.db.loginLog.slice(0, 200);
  __westoModuleContext.save();
  const secureCookie = req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  const token = __westoModuleContext.makeToken(phone, req.tenantId || req.tenant?.tenantId || req.tenant?.tenantSlug);
  res.setHeader('Set-Cookie', `westo_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(__westoModuleContext.SESSION_TTL_MS / 1000)}${secureCookie ? '; Secure' : ''}`);
  res.json({ ok: true, user: __westoModuleContext.publicUser(user), token });
});
};
