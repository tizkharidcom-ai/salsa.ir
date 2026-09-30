'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.delete('/api/admin/users/:phone', __westoModuleContext.requireOwner, (req, res) => {
  const targetPhone = __westoModuleContext.normalizeDigits(decodeURIComponent(String(req.params.phone || ''))).trim();
  if (String(req.user?.phone || '') === targetPhone) {
    return res.status(400).json({ error: 'staff_self_protected', message: 'مالک جاری نمی‌تواند حساب خود را حذف کند.' });
  }
  const user = __westoModuleContext.db.users.find((u) => u.phone === targetPhone);
  __westoModuleContext.db.users = __westoModuleContext.db.users.filter((u) => u.phone !== targetPhone);
  if (user) __westoModuleContext.recordAudit(req, 'user.deleted', 'user', user.phone, { role: user.role });
  __westoModuleContext.save();
  res.json({ ok: true });
});
};
