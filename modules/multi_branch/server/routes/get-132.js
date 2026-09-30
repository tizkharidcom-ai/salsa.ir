'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/branches', (req, res) => {
  const list = (__westoModuleContext.db.branches || [])
    .filter((b) => req.query.all === '1' || b.active !== false)
    .map((b) => ({
      id: b.id,
      slug: b.slug,
      name: b.name,
      address: b.address,
      phone: b.phone,
      active: b.active !== false,
    }));
  res.json({ branches: list });
});
};
