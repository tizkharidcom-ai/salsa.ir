'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/user/addresses/:id/default', __westoModuleContext.requireAuth, (req, res) => {
  const user = (__westoModuleContext.db.users || []).find((u) => u.phone === req.user.phone) || req.user;
  user.addresses = Array.isArray(user.addresses) ? user.addresses : [];

  const target = user.addresses.find((a) => a.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'نشانی یافت نشد.' });

  user.addresses.forEach((a) => { a.isDefault = (a.id === target.id); });
  user.address = target.address;
  user.city = target.city;
  if (target.note) user.notes = target.note;

  __westoModuleContext.save();
  res.json({ ok: true, addresses: user.addresses, defaultAddress: target });
});
};
