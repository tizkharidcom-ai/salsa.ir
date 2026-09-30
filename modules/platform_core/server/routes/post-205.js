'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/admin/whatsapp/order/:id', __westoModuleContext.requireAdmin, (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (__westoModuleContext.db.orders || []).find((o) => Number(o.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  const branch = (__westoModuleContext.db.branches || []).find((b) => b.id === Number(order.branchId));
  const text = __westoModuleContext.buildOrderMessage(order, {
    brand: __westoModuleContext.db.restaurant?.name || 'وستو',
    branchName: branch?.name,
  });
  const phone = __westoModuleContext.resolveNotifyPhone(__westoModuleContext.db, order.branchId);
  const url = __westoModuleContext.waMeUrl(phone, text);
  if (!url) return res.status(400).json({ error: 'شماره واتساپ تنظیم نشده' });
  res.json({ ok: true, url, phone: __westoModuleContext.toWaDigits(phone), text });
});
};
