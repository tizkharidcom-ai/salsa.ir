'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post(['/api/admin/users', '/api/admin/customers'], __westoModuleContext.requireAdmin, (req, res) => {
  const phone = __westoModuleContext.normalizeDigits(req.body.phone || '').trim();
  const name = String(req.body.name || '').trim().slice(0, 120);
  if (!__westoModuleContext.PHONE_RE.test(phone)) return res.status(400).json({ error: 'شماره موبایل معتبر نیست.' });
  if (!name) return res.status(400).json({ error: 'نام و نام خانوادگی لازم است.' });
  if (__westoModuleContext.db.users.some((user) => user.phone === phone)) return res.status(409).json({ error: 'کاربری با این شماره قبلاً ثبت شده است.' });
  
  const requestedRole = String(req.body.role || 'user').trim().toLowerCase();
  const role = __westoModuleContext.USER_ROLE_MAP[requestedRole] || 'guest';
  
  if (['owner', 'manager'].includes(role) && !__westoModuleContext.isOwnerActor(__westoModuleContext.db, req.user)) {
    return res.status(403).json({
      error: role === 'owner' ? 'staff_owner_protected' : 'staff_manager_protected',
      message: role === 'owner' ? 'حساب مالک فقط توسط مالک قابل ایجاد است.' : 'حساب مدیر فقط توسط مالک قابل ایجاد است.',
    });
  }

  const branchRequest = __westoModuleContext.requestedBranchAssignments(req.body || {});
  if (branchRequest.error) return res.status(branchRequest.error.status).json({ error: branchRequest.error.code, message: branchRequest.error.message });
  let allowedBranchIds = branchRequest.ids;
  if (!Array.isArray(req.body?.allowedBranchIds) && !Object.prototype.hasOwnProperty.call(req.body || {}, 'branchId') && role === 'owner') allowedBranchIds = null;
  if (role !== 'owner') {
    const assignmentError = __westoModuleContext.validateStaffBranchAssignments(req.user, role, allowedBranchIds || []);
    if (assignmentError) return res.status(assignmentError.status).json({ error: assignmentError.code, message: assignmentError.message });
  }

  const parsePoints = (v) => {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return isNaN(v) ? 0 : v;
    const n = Number(__westoModuleContext.normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? 0 : n;
  };

  const user = {
    phone,
    name,
    email: String(req.body.email || '').trim().slice(0, 160),
    role,
    allowedBranchIds,
    points: Math.max(0, Math.round(parsePoints(req.body.points))),
    notes: String(req.body.notes || '').trim().slice(0, 500),
    createdAt: new Date().toISOString(),
    blocked: false,
  };
  __westoModuleContext.db.users.push(user);
  __westoModuleContext.recordAudit(req, 'user.created', 'user', phone, { name, role, allowedBranchIds });
  __westoModuleContext.save();
  res.status(201).json({ ok: true, user: __westoModuleContext.publicUser(user) });
});
};
