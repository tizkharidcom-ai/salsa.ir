'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/admin/whatsapp', __westoModuleContext.requireAdmin, (req, res) => {
  if (!__westoModuleContext.db.whatsappNotify) __westoModuleContext.db.whatsappNotify = {};
  const s = req.body.settings || req.body || {};
  if (typeof s.enabled === 'boolean') __westoModuleContext.db.whatsappNotify.enabled = s.enabled;
  if (typeof s.onOrder === 'boolean') __westoModuleContext.db.whatsappNotify.onOrder = s.onOrder;
  if (typeof s.onReservation === 'boolean') __westoModuleContext.db.whatsappNotify.onReservation = s.onReservation;
  if (typeof s.phone === 'string') {
    __westoModuleContext.db.whatsappNotify.phone = __westoModuleContext.normalizeDigits(s.phone).trim();
  }
  __westoModuleContext.save();
  res.json({ ok: true, settings: __westoModuleContext.db.whatsappNotify });
});
};
