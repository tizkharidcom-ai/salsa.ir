'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/admin/hours', __westoModuleContext.requireAdmin, async (req, res) => {
  const days = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
  const incoming = req.body?.hours;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return res.status(400).json({ error: 'hours_invalid', message: 'ساختار ساعت کاری معتبر نیست.' });
  }
  for (const day of days) {
    const value = incoming[day];
    if (value != null && (typeof value !== 'object' || Array.isArray(value))) {
      return res.status(400).json({ error: 'hours_invalid', message: 'ساختار ساعت کاری معتبر نیست.' });
    }
    for (const field of ['open', 'close']) {
      if (typeof value?.[field] !== 'string') continue;
      if (!__westoModuleContext.validateAdminHoursTime(value[field])) {
        return res.status(400).json({ error: 'hours_time_invalid', day, field, message: 'ساعت باید در قالب ۲۴ ساعتهٔ ساعت:دقیقه باشد.' });
      }
    }
  }
  let branchId;
  try { branchId = __westoModuleContext.parseBranchId(req); } catch (error) {
    return res.status(error.status || 400).json({ error: error.code || 'branch_invalid', message: error.message });
  }
  const branch = __westoModuleContext.resolveBranchExact(branchId);
  if (!branch) return res.status(400).json({ error: 'شعبه یافت نشد' });
  return __westoModuleContext.serializeAdminConfigMutation(branch.id, async () => {
    const currentBranch = __westoModuleContext.resolveBranchExact(branch.id);
    if (!currentBranch) return res.status(409).json({ error: 'branch_changed', message: 'شعبه تغییر کرده است؛ صفحه را تازه کنید.' });
    const hadBranchHours = Object.prototype.hasOwnProperty.call(currentBranch, 'hours');
    const previousBranchHours = hadBranchHours ? JSON.parse(JSON.stringify(currentBranch.hours)) : undefined;
    const hadLegacyHours = Object.prototype.hasOwnProperty.call(__westoModuleContext.db, 'hours');
    const previousLegacyHours = hadLegacyHours ? JSON.parse(JSON.stringify(__westoModuleContext.db.hours)) : undefined;
    if (!currentBranch.hours || typeof currentBranch.hours !== 'object' || Array.isArray(currentBranch.hours)) {
      currentBranch.hours = __westoModuleContext.defaultHoursTemplate();
    }
    for (const day of days) {
      if (!incoming[day]) continue;
      const current = currentBranch.hours[day] || { open: '10:00', close: '23:00', closed: false };
      if (typeof incoming[day].open === 'string') current.open = __westoModuleContext.validateAdminHoursTime(incoming[day].open);
      if (typeof incoming[day].close === 'string') current.close = __westoModuleContext.validateAdminHoursTime(incoming[day].close);
      if (typeof incoming[day].closed === 'boolean') current.closed = incoming[day].closed;
      currentBranch.hours[day] = current;
    }
    __westoModuleContext.syncLegacyHours();
    const auditLogWasPresent = Array.isArray(__westoModuleContext.db.auditLog);
    let auditEntry;
    try {
      auditEntry = __westoModuleContext.recordAudit(req, 'branch.hours.updated', 'branch', currentBranch.id, { days: days.filter((day) => incoming[day]) }, currentBranch.id, { deferAppend: true });
      await __westoModuleContext.persistAdminConfigMutation(() => {
        if (hadBranchHours) currentBranch.hours = previousBranchHours;
        else delete currentBranch.hours;
        if (hadLegacyHours) __westoModuleContext.db.hours = previousLegacyHours;
        else delete __westoModuleContext.db.hours;
        __westoModuleContext.rollbackAuditEntry(auditEntry, auditLogWasPresent);
      });
    } catch (error) {
      return __westoModuleContext.respondAdminConfigPersistenceFailure(res, error, 'hours_persistence_failed');
    }
    __westoModuleContext.appendAuditAfterCommit(auditEntry);
    return res.json({ ok: true, hours: currentBranch.hours, branchId: currentBranch.id });
  });
});
};
