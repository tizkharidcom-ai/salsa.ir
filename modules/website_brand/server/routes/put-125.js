'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/admin/restaurant', __westoModuleContext.requireAdmin, (req, res) => {
  const r = req.body.restaurant || {};
  const keys = [
    'name', 'brandName', 'tagline', 'about', 'address', 'phone', 'whatsapp',
    'instagram', 'website', 'mapUrl', 'currency',
  ];
  for (const k of keys) {
    if (typeof r[k] === 'string') __westoModuleContext.db.restaurant[k] = r[k].trim().slice(0, k === 'about' ? 2000 : 200);
  }
  const parsePct = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    const n = Number(__westoModuleContext.normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? null : n;
  };
  const taxPct = parsePct(r.taxPercent);
  if (taxPct != null) __westoModuleContext.db.restaurant.taxPercent = Math.max(0, Math.min(100, taxPct));
  const svcPct = parsePct(r.servicePercent);
  if (svcPct != null) __westoModuleContext.db.restaurant.servicePercent = Math.max(0, Math.min(100, svcPct));
  __westoModuleContext.save();
  res.json({ ok: true, restaurant: __westoModuleContext.db.restaurant });
});
};
