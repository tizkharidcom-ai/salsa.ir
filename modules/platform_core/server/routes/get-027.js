'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/user/addresses', __westoModuleContext.requireAuth, (req, res) => {
  const user = (__westoModuleContext.db.users || []).find((u) => u.phone === req.user.phone) || req.user;
  const addresses = Array.isArray(user.addresses) ? user.addresses : (user.address ? [{
    id: 'addr_default',
    title: '🏠 منزل',
    city: user.city || '',
    district: '',
    address: user.address,
    plaque: '',
    unit: '',
    floor: '',
    receiverName: user.name || '',
    receiverPhone: user.phone || '',
    note: user.notes || '',
    isDefault: true,
    createdAt: user.createdAt || new Date().toISOString(),
  }] : []);
  res.json({ ok: true, addresses });
});
};
