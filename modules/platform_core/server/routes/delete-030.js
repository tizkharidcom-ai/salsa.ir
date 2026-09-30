'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.delete('/api/user/addresses/:id', __westoModuleContext.requireAuth, (req, res) => {
  const user = (__westoModuleContext.db.users || []).find((u) => u.phone === req.user.phone) || req.user;
  user.addresses = Array.isArray(user.addresses) ? user.addresses : [];

  const wasDefault = user.addresses.find((a) => a.id === req.params.id)?.isDefault;
  user.addresses = user.addresses.filter((a) => a.id !== req.params.id);

  if (wasDefault && user.addresses.length > 0) {
    user.addresses[0].isDefault = true;
    user.address = user.addresses[0].address;
    user.city = user.addresses[0].city;
  } else if (user.addresses.length === 0) {
    user.address = '';
  }

  __westoModuleContext.save();
  res.json({ ok: true, addresses: user.addresses });
});
};
