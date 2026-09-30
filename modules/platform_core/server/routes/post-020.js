'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/auth/request-otp', (req, res) => {
  const phone = __westoModuleContext.normalizeDigits(req.body?.phone || '').trim();
  if (!__westoModuleContext.PHONE_RE.test(phone)) return res.status(400).json({ error: 'شماره موبایل معتبر نیست' });

  // Anti-Spam & Rate-Limiting Cooldown Check
  const enforceCooldown = !__westoModuleContext.IS_NODE_TEST_RUNTIME || req.headers['x-enforce-cooldown'] === 'true';
  const now = Date.now();
  const lastRequested = __westoModuleContext.otpRequestTimestamps.get(phone) || 0;
  if (enforceCooldown && (now - lastRequested < __westoModuleContext.OTP_COOLDOWN_MS)) {
    const retryAfter = Math.ceil((lastRequested + __westoModuleContext.OTP_COOLDOWN_MS - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({
      ok: false,
      error: 'rate_limited',
      message: `لطفاً پیش از درخواست مجدد کد، ${retryAfter} ثانیه صبر کنید.`,
      retryAfterSeconds: retryAfter
    });
  }

  const code = String(__westoModuleContext.crypto.randomInt(10000, 99999));
  __westoModuleContext.otps.set(phone, {
    code,
    expiresAt: now + (__westoModuleContext.db.settings.otpTtlMs || 120000),
    attempts: 0,
    requestedAt: now
  });
  __westoModuleContext.otpRequestTimestamps.set(phone, now);

  const demoOtp = __westoModuleContext.isOtpDemoMode(process.env);
  if (!demoOtp) {
    __westoModuleContext.otps.delete(phone);
    return res.status(503).json({ error: 'ارسال OTP در محیط تولید هنوز پیکربندی نشده است' });
  }
  console.log(`[OTP:demo] ${phone} -> ${code}`);
  res.json({ ok: true, demo: true, code, ttlMs: __westoModuleContext.db.settings.otpTtlMs || 120000 });
});
};
