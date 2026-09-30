'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/admin/reservation-settings', __westoModuleContext.requireAdmin, (req, res) => {
  if (!__westoModuleContext.db.reservationSettings) __westoModuleContext.db.reservationSettings = {};
  const s = req.body.settings || req.body || {};
  const parseNum = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    const clean = String(v)
      .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
      .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      .replace(/[,٬_\s]/g, '')
      .trim();
    const n = Number(clean);
    return isNaN(n) ? null : n;
  };

  if (typeof s.enabled === 'boolean') __westoModuleContext.db.reservationSettings.enabled = s.enabled;
  const slotMinutes = parseNum(s.slotMinutes);
  if (slotMinutes != null) {
    __westoModuleContext.db.reservationSettings.slotMinutes = Math.max(15, Math.min(120, Math.round(slotMinutes)));
  }
  const maxParty = parseNum(s.maxParty);
  if (maxParty != null) {
    __westoModuleContext.db.reservationSettings.maxParty = Math.max(1, Math.min(40, Math.round(maxParty)));
  }
  const maxCoversPerSlot = parseNum(s.maxCoversPerSlot);
  if (maxCoversPerSlot != null) {
    __westoModuleContext.db.reservationSettings.maxCoversPerSlot = Math.max(1, Math.min(200, Math.round(maxCoversPerSlot)));
  }
  const advanceDays = parseNum(s.advanceDays);
  if (advanceDays != null) {
    __westoModuleContext.db.reservationSettings.advanceDays = Math.max(1, Math.min(90, Math.round(advanceDays)));
  }
  const minHoursAhead = parseNum(s.minHoursAhead);
  if (minHoursAhead != null) {
    __westoModuleContext.db.reservationSettings.minHoursAhead = Math.max(0, Math.min(48, Math.round(minHoursAhead)));
  }
  __westoModuleContext.save();
  res.json({ ok: true, settings: __westoModuleContext.db.reservationSettings });
});
};
