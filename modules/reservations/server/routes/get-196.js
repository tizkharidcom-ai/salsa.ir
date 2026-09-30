'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/reservations/meta', (req, res) => {
  const settings = __westoModuleContext.db.reservationSettings || {};
  res.json({
    enabled: settings.enabled !== false,
    settings: {
      slotMinutes: settings.slotMinutes ?? 30,
      maxParty: settings.maxParty ?? 12,
      advanceDays: settings.advanceDays ?? 21,
      minHoursAhead: settings.minHoursAhead ?? 1,
    },
    restaurant: {
      name: __westoModuleContext.db.restaurant?.name,
      phone: __westoModuleContext.db.restaurant?.phone,
    },
    branches: (__westoModuleContext.db.branches || [])
      .filter((b) => b.active !== false)
      .map((b) => ({ id: b.id, slug: b.slug, name: b.name, address: b.address })),
  });
});
};
