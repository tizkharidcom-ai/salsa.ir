'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/admin/sms/settings', __westoModuleContext.requireAdmin, (req, res) => {
  __westoModuleContext.db.smsConfig = __westoModuleContext.db.smsConfig || {};
  if (req.body.provider !== undefined) __westoModuleContext.db.smsConfig.provider = String(req.body.provider || 'simulator').trim();
  if (req.body.apiKey !== undefined) __westoModuleContext.db.smsConfig.apiKey = String(req.body.apiKey || '').trim();
  if (req.body.senderLine !== undefined) __westoModuleContext.db.smsConfig.senderLine = __westoModuleContext.normalizeDigits(String(req.body.senderLine || '1000912')).trim();
  if (req.body.enabled !== undefined) __westoModuleContext.db.smsConfig.enabled = !!req.body.enabled;
  if (req.body.templates && typeof req.body.templates === 'object') {
    __westoModuleContext.db.smsConfig.templates = __westoModuleContext.db.smsConfig.templates || {};
    for (const [k, v] of Object.entries(req.body.templates)) {
      __westoModuleContext.db.smsConfig.templates[k] = {
        ...(__westoModuleContext.db.smsConfig.templates[k] || {}),
        ...v,
      };
    }
  }
  __westoModuleContext.save();
  res.json({ ok: true, config: __westoModuleContext.smsEngine.getSmsConfig(__westoModuleContext.db) });
});
};
