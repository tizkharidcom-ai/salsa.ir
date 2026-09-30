'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.patch('/api/admin/feedback/:id', __westoModuleContext.requireAdmin, (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const item = (__westoModuleContext.db.feedback || []).find((f) => Number(f.id) === targetId);
  if (!item) return res.status(404).json({ error: 'not found' });
  try {
    __westoModuleContext.assertUserBranchAccess(req.user, item.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message });
  }
  const st = String(req.body.status || '').trim();
  if (['new', 'reviewed', 'in_progress', 'resolved', 'archived'].includes(st)) item.status = st;
  if (typeof req.body.resolutionNote === 'string') {
    item.resolutionNote = req.body.resolutionNote.trim().slice(0, 300);
    item.resolvedAt = new Date().toISOString();
  }
  __westoModuleContext.save();
  res.json({ ok: true, item });
});
};
