'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/admin/promotions', __westoModuleContext.requireAdmin, (req, res) => {
  const id = Math.max(0, ...(__westoModuleContext.db.promotions || []).map((p) => Number(p.id) || 0), 0) + 1;
  const parsePct = (v) => {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return isNaN(v) ? 0 : v;
    const n = Number(__westoModuleContext.normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? 0 : n;
  };
  const promo = {
    id,
    title: String(req.body.title || '').trim().slice(0, 120),
    percent: Math.max(0, Math.min(90, Math.round(parsePct(req.body.percent)))),
    code: String(req.body.code || '').trim().slice(0, 32).toUpperCase(),
    active: req.body.active !== false,
    startsAt: req.body.startsAt || new Date().toISOString(),
    endsAt: req.body.endsAt || null,
    createdAt: new Date().toISOString(),
  };
  if (!promo.title) return res.status(400).json({ error: 'عنوان الزامی است' });
  __westoModuleContext.db.promotions = __westoModuleContext.db.promotions || [];
  __westoModuleContext.db.promotions.unshift(promo);
  __westoModuleContext.save();
  res.json({ ok: true, promo });
});
};
