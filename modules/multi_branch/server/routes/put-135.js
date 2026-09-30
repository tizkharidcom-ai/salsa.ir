'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/admin/branches/:id', __westoModuleContext.requireAdmin, (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const branch = (__westoModuleContext.db.branches || []).find((b) => Number(b.id) === targetId);
  if (!branch) return res.status(404).json({ error: 'not found' });
  if (typeof req.body.name === 'string') branch.name = req.body.name.trim().slice(0, 80);
  if (typeof req.body.address === 'string') branch.address = req.body.address.trim().slice(0, 200);
  if (typeof req.body.phone === 'string') branch.phone = req.body.phone.trim().slice(0, 40);
  if (typeof req.body.whatsapp === 'string') branch.whatsapp = req.body.whatsapp.trim().slice(0, 40);
  if (typeof req.body.mapUrl === 'string') branch.mapUrl = req.body.mapUrl.trim().slice(0, 500);
  if (typeof req.body.active === 'boolean') branch.active = req.body.active;
  if (typeof req.body.slug === 'string') {
    const slug = req.body.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
    if (slug && !(__westoModuleContext.db.branches || []).some((b) => b.slug === slug && b.id !== branch.id)) {
      branch.slug = slug;
    }
  }
  if (req.body.hours && typeof req.body.hours === 'object') {
    const days = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
    if (!branch.hours) branch.hours = __westoModuleContext.defaultHoursTemplate();
    for (const d of days) {
      if (!req.body.hours[d]) continue;
      branch.hours[d] = {
        open: String(req.body.hours[d].open || '10:00').slice(0, 5),
        close: String(req.body.hours[d].close || '23:00').slice(0, 5),
        closed: !!req.body.hours[d].closed,
      };
    }
    __westoModuleContext.syncLegacyHours();
  }
  __westoModuleContext.save();
  res.json({ ok: true, branch });
});
};
