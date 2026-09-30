'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/admin/branches', __westoModuleContext.requireAdmin, (req, res) => {
  const id = Math.max(0, ...(__westoModuleContext.db.branches || []).map((b) => b.id), 0) + 1;
  let slug = String(req.body.slug || `branch-${id}`)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 40);
  if (!slug) slug = `branch-${id}`;
  if ((__westoModuleContext.db.branches || []).some((b) => b.slug === slug)) {
    return res.status(400).json({ error: 'اسلاگ تکراری است' });
  }
  const branch = {
    id,
    slug,
      name: String(req.body.name || `شعبه ${id}`).trim().slice(0, 80),
      address: String(req.body.address || '').trim().slice(0, 200),
    phone: String(req.body.phone || '').trim().slice(0, 40),
    whatsapp: String(req.body.whatsapp || '').trim().slice(0, 40),
    mapUrl: String(req.body.mapUrl || '').trim().slice(0, 500),
    active: req.body.active !== false,
    hours: req.body.hours && typeof req.body.hours === 'object'
      ? req.body.hours
      : __westoModuleContext.defaultHoursTemplate(),
  };
  __westoModuleContext.db.branches.push(branch);
  __westoModuleContext.save();
  res.json({ ok: true, branch });
});
};
