'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/admin/sms/send-test', __westoModuleContext.requireAdmin, async (req, res) => {
  const phone = __westoModuleContext.normalizeDigits(req.body.phone || '').trim();
  const text = String(req.body.text || req.body.message || '').trim();
  const templateKey = req.body.templateKey || 'custom';

  if (!__westoModuleContext.PHONE_RE.test(phone)) return res.status(400).json({ error: 'شماره موبایل معتبر نیست.' });

  try {
    const result = await __westoModuleContext.smsEngine.sendSms(__westoModuleContext.db, {
      phone,
      customText: text,
      templateKey,
      vars: req.body.vars || { name: 'تست مدیریت' },
      triggerType: 'manual',
    });
    __westoModuleContext.save();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
};
