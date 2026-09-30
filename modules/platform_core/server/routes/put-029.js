'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/user/addresses/:id', __westoModuleContext.requireAuth, (req, res) => {
  const user = (__westoModuleContext.db.users || []).find((u) => u.phone === req.user.phone) || req.user;
  user.addresses = Array.isArray(user.addresses) ? user.addresses : [];

  const addr = user.addresses.find((a) => a.id === req.params.id);
  if (!addr) return res.status(404).json({ error: 'نشانی یافت نشد.' });

  const {
    title,
    city,
    district,
    address,
    plaque,
    unit,
    floor,
    receiverName,
    receiverPhone,
    note,
    isDefault,
  } = req.body || {};

  if (typeof title === 'string') addr.title = title.trim().slice(0, 50);
  if (typeof city === 'string') addr.city = city.trim().slice(0, 100);
  if (typeof district === 'string') addr.district = district.trim().slice(0, 100);
  if (typeof address === 'string') {
    const trimmed = address.trim();
    if (!trimmed) return res.status(400).json({ error: 'نشانی پستی نمی‌تواند خالی باشد.' });
    addr.address = trimmed.slice(0, 300);
  }
  if (typeof plaque === 'string') addr.plaque = plaque.trim().slice(0, 20);
  if (typeof unit === 'string') addr.unit = unit.trim().slice(0, 20);
  if (typeof floor === 'string') addr.floor = floor.trim().slice(0, 20);
  if (typeof receiverName === 'string') addr.receiverName = receiverName.trim().slice(0, 100);
  if (typeof receiverPhone === 'string') addr.receiverPhone = receiverPhone.trim().slice(0, 30);
  if (typeof note === 'string') addr.note = note.trim().slice(0, 300);

  if (typeof isDefault === 'boolean' && isDefault) {
    user.addresses.forEach((a) => { a.isDefault = (a.id === addr.id); });
    user.address = addr.address;
    user.city = addr.city;
    if (addr.note) user.notes = addr.note;
  }

  __westoModuleContext.save();
  res.json({ ok: true, address: addr, addresses: user.addresses });
});
};
