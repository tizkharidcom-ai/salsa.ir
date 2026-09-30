'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/user/addresses', __westoModuleContext.requireAuth, (req, res) => {
  const user = (__westoModuleContext.db.users || []).find((u) => u.phone === req.user.phone) || req.user;
  user.addresses = Array.isArray(user.addresses) ? user.addresses : [];

  const {
    title = '🏠 منزل',
    city = '',
    district = '',
    address = '',
    plaque = '',
    unit = '',
    floor = '',
    receiverName = '',
    receiverPhone = '',
    note = '',
    isDefault = false,
  } = req.body || {};

  const cleanAddress = String(address).trim();
  if (!cleanAddress) {
    return res.status(400).json({ error: 'نشانی پستی الزامی است.' });
  }

  const newAddressId = `addr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const shouldBeDefault = isDefault || user.addresses.length === 0;

  if (shouldBeDefault) {
    user.addresses.forEach((a) => { a.isDefault = false; });
  }

  const newAddr = {
    id: newAddressId,
    title: String(title).trim().slice(0, 50) || '🏠 منزل',
    city: String(city).trim().slice(0, 100),
    district: String(district).trim().slice(0, 100),
    address: cleanAddress.slice(0, 300),
    plaque: String(plaque).trim().slice(0, 20),
    unit: String(unit).trim().slice(0, 20),
    floor: String(floor).trim().slice(0, 20),
    receiverName: String(receiverName || user.name || '').trim().slice(0, 100),
    receiverPhone: String(receiverPhone || user.phone || '').trim().slice(0, 30),
    note: String(note).trim().slice(0, 300),
    isDefault: shouldBeDefault,
    createdAt: new Date().toISOString(),
  };

  user.addresses.unshift(newAddr);
  if (shouldBeDefault) {
    user.address = newAddr.address;
    user.city = newAddr.city;
    if (newAddr.note) user.notes = newAddr.note;
  }

  __westoModuleContext.save();
  res.json({ ok: true, address: newAddr, addresses: user.addresses });
});
};
