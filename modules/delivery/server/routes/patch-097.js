'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.patch('/api/admin/delivery-zones/:id', __westoModuleContext.requireCapability('delivery.manage'), async (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const initial = (__westoModuleContext.db.deliveryZones || []).find((item) => Number(item.id) === targetId);
  if (!initial) return res.status(404).json({ error: 'not found' });
  const initialBranchId = Number(initial.branchId) || Number(__westoModuleContext.defaultBranch()?.id) || 1;
  try { __westoModuleContext.assertUserBranchAccess(req.user, initialBranchId); } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  return __westoModuleContext.serializeAdminConfigMutation(initialBranchId, async () => {
    const current = (__westoModuleContext.db.deliveryZones || []).find((item) => Number(item.id) === targetId);
    if (!current) return res.status(404).json({ error: 'not found' });
    const currentBranchId = Number(current.branchId) || Number(__westoModuleContext.defaultBranch()?.id) || 1;
    try { __westoModuleContext.assertUserBranchAccess(req.user, currentBranchId); } catch (error) {
      return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
    }
    if (currentBranchId !== initialBranchId) return res.status(409).json({ error: 'delivery_zone_changed', message: 'محدودهٔ ارسال هنگام ویرایش تغییر کرده است؛ صفحه را تازه کنید.' });
    if (__westoModuleContext.requestBranchValue(req) != null && Number(__westoModuleContext.parseBranchId(req)) !== currentBranchId) {
      return res.status(409).json({ error: 'delivery_zone_branch_immutable', message: 'محدودهٔ ارسال را نمی‌توان به شعبهٔ دیگری منتقل کرد.' });
    }
    const zone = __westoModuleContext.cleanDeliveryZone({ ...(req.body || {}), branchId: currentBranchId }, current);
    if (!zone.name) return res.status(400).json({ error: 'نام محدوده لازم است' });
    const before = { ...current };
    Object.assign(current, zone);
    const auditLogWasPresent = Array.isArray(__westoModuleContext.db.auditLog);
    let auditEntry;
    try {
      auditEntry = __westoModuleContext.recordAudit(req, 'delivery_zone.updated', 'delivery_zone', current.id, { name: current.name }, current.branchId, { deferAppend: true });
      await __westoModuleContext.persistAdminConfigMutation(() => {
        for (const key of Object.keys(current)) delete current[key];
        Object.assign(current, before);
        __westoModuleContext.rollbackAuditEntry(auditEntry, auditLogWasPresent);
      });
    } catch (error) {
      return __westoModuleContext.respondAdminConfigPersistenceFailure(res, error, 'delivery_zone_persistence_failed');
    }
    __westoModuleContext.appendAuditAfterCommit(auditEntry);
    try { __westoModuleContext.publishOperationalEvent('delivery_zone.updated', { zoneId: current.id, branchId: current.branchId }); }
    catch (eventError) { console.error('[delivery-zone-update] post-commit event failed', eventError?.message || eventError); }
    return res.json({ ok: true, zone: current });
  });
});
};
