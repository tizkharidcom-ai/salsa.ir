'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.patch('/api/admin/promotions/:id', __westoModuleContext.requireAdmin, (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const promo = (__westoModuleContext.db.promotions || []).find((p) => Number(p.id) === targetId);
  if (!promo) return res.status(404).json({ error: 'not found' });
  if (typeof req.body.title === 'string') promo.title = req.body.title.trim().slice(0, 120);
  if (req.body.percent != null) {
    const rawPct = typeof req.body.percent === 'number'
      ? req.body.percent
      : Number(__westoModuleContext.normalizeDigits(String(req.body.percent)).replace(/[,٬_\s]/g, '').trim());
    if (!isNaN(rawPct)) {
      promo.percent = Math.max(0, Math.min(90, Math.round(rawPct)));
    }
  }
  if (typeof req.body.code === 'string') promo.code = req.body.code.trim().slice(0, 32).toUpperCase();
  if (typeof req.body.active === 'boolean') promo.active = req.body.active;
  if (req.body.endsAt !== undefined) promo.endsAt = req.body.endsAt;
  __westoModuleContext.save();
  res.json({ ok: true, promo });
});
};
