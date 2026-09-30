'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/admin/settings', __westoModuleContext.requireAdmin, (req, res) => {
  const s = req.body.settings || {};
  let configuredAdminPhones = null;
  if (Array.isArray(s.adminPhones) && s.adminPhones.length) {
    configuredAdminPhones = s.adminPhones.map((phone) => __westoModuleContext.normalizeDigits(phone).trim());
    if (configuredAdminPhones.some((phone) => __westoModuleContext.PLATFORM_ONLY_PHONE_IDENTITIES.has(phone))) {
      return res.status(400).json({ error: 'platform_identity_cannot_be_tenant_owner', message: 'حساب راهبر پلتفرم را نمی‌توان به مالک رستوران تبدیل کرد.' });
    }
    if (!configuredAdminPhones.every((phone) => __westoModuleContext.PHONE_RE.test(phone))) {
      return res.status(400).json({ error: 'admin_phone_invalid' });
    }
  }
  if (typeof s.siteTitle === 'string') __westoModuleContext.db.settings.siteTitle = s.siteTitle;
  if (typeof s.metaDescription === 'string') __westoModuleContext.db.settings.metaDescription = s.metaDescription;
  if (configuredAdminPhones) __westoModuleContext.db.settings.adminPhones = configuredAdminPhones;
  const L = req.body.loyalty || {};
  if (!__westoModuleContext.db.loyalty) __westoModuleContext.db.loyalty = {};
  if (typeof L.enabled === 'boolean') __westoModuleContext.db.loyalty.enabled = L.enabled;
  if (typeof L.pointsPerToman === 'number') __westoModuleContext.db.loyalty.pointsPerToman = Math.max(0, Math.min(1, L.pointsPerToman));
  if (typeof L.redeemValue === 'number') __westoModuleContext.db.loyalty.redeemValue = Math.max(0, Math.round(L.redeemValue));
  if (typeof L.welcomePoints === 'number') __westoModuleContext.db.loyalty.welcomePoints = Math.max(0, Math.round(L.welcomePoints));
  __westoModuleContext.save();
  res.json({ ok: true, settings: __westoModuleContext.db.settings, loyalty: __westoModuleContext.db.loyalty });
});
};
