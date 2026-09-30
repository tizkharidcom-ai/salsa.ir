'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.patch(['/api/admin/users/:phone', '/api/admin/customers/:phone'], __westoModuleContext.requireAdmin, (req, res) => {
  const targetPhone = __westoModuleContext.normalizeDigits(decodeURIComponent(String(req.params.phone || ''))).trim();
  const user = __westoModuleContext.db.users.find((u) => u.phone === targetPhone);
  if (!user) return res.status(404).json({ error: 'not found' });

  const isSelf = String(req.user?.phone || '') === String(user.phone || '');
  if (typeof req.body.blocked === 'boolean' && isSelf) {
    return res.status(400).json({
      error: 'staff_self_protected',
      message: 'کاربر جاری را نمی‌توان مسدود یا از حالت مسدود خارج کرد.',
    });
  }

  try {
    __westoModuleContext.assertStaffMutationBoundary(__westoModuleContext.db, req.user, user, { allowSelf: true });
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'staff_mutation_forbidden', message: error.message });
  }

  const requestedRole = String(req.body.role || '').trim().toLowerCase();
  const newRole = __westoModuleContext.USER_ROLE_MAP[requestedRole] || null;
  if (newRole && newRole !== user.role && ['owner', 'manager'].includes(newRole) && !__westoModuleContext.isOwnerActor(__westoModuleContext.db, req.user)) {
    return res.status(403).json({
      error: newRole === 'owner' ? 'staff_owner_protected' : 'staff_manager_protected',
      message: newRole === 'owner' ? 'اعطای نقش مالک فقط توسط مالک امکان‌پذیر است.' : 'اعطای نقش مدیر فقط توسط مالک امکان‌پذیر است.',
    });
  }
  const branchAssignmentSpecified = Object.prototype.hasOwnProperty.call(req.body || {}, 'allowedBranchIds')
    || Object.prototype.hasOwnProperty.call(req.body || {}, 'branchId');
  let assignedBranchIds = null;
  const resultingRole = newRole || user.role;
  if (branchAssignmentSpecified || (newRole && newRole !== user.role && __westoModuleContext.STAFF_BRANCH_ROLES.has(resultingRole))) {
    const branchRequest = __westoModuleContext.requestedBranchAssignments(req.body || {}, user);
    if (branchRequest.error) return res.status(branchRequest.error.status).json({ error: branchRequest.error.code, message: branchRequest.error.message });
    const assignmentError = __westoModuleContext.validateStaffBranchAssignments(req.user, resultingRole, branchRequest.ids);
    if (assignmentError) return res.status(assignmentError.status).json({ error: assignmentError.code, message: assignmentError.message });
    assignedBranchIds = branchRequest.ids;
  }

  if (typeof req.body.blocked === 'boolean') user.blocked = req.body.blocked;
  if (typeof req.body.name === 'string') user.name = req.body.name.trim();
  if (typeof req.body.email === 'string') user.email = req.body.email.trim();
  if (typeof req.body.notes === 'string') user.notes = req.body.notes.trim().slice(0, 500);
  if (Array.isArray(req.body.tags)) {
    user.tags = req.body.tags.map((t) => String(t).trim().slice(0, 30)).filter(Boolean);
  }
  if (typeof req.body.vipNote === 'string') {
    user.vipNote = req.body.vipNote.trim().slice(0, 300);
  }
  if (req.body.points != null) {
    const parsePoints = (v) => {
      if (v == null || v === '') return null;
      if (typeof v === 'number') return isNaN(v) ? null : v;
      const n = Number(__westoModuleContext.normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
      return isNaN(n) ? null : n;
    };
    const pts = parsePoints(req.body.points);
    if (pts != null) user.points = Math.max(0, Math.round(pts));
  }
  if (assignedBranchIds) user.allowedBranchIds = assignedBranchIds;
  if (typeof req.body.birthdate === 'string') {
    user.birthdate = req.body.birthdate.trim().slice(0, 50);
    user.birthdateUpdatedAt = new Date().toISOString();
    try { __westoModuleContext.campaignsEngine.checkBirthdayEligibility(__westoModuleContext.db, user); } catch (_) {}
  }
  if (newRole) user.role = newRole;
  __westoModuleContext.recordAudit(req, 'user.access_updated', 'user', user.phone, { role: user.role, blocked: !!user.blocked, birthdate: user.birthdate, allowedBranchIds: user.allowedBranchIds });
  __westoModuleContext.save();
  res.json({ ok: true, user: __westoModuleContext.publicUser(user) });
});
};
