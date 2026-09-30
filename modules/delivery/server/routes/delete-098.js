'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.delete('/api/admin/delivery-zones/:id', __westoModuleContext.requireCapability('delivery.manage'), async (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const initial = (__westoModuleContext.db.deliveryZones || []).find((item) => Number(item.id) === targetId);
  if (!initial) return res.status(404).json({ error: 'not found' });
  const initialBranchId = Number(initial.branchId) || Number(__westoModuleContext.defaultBranch()?.id) || 1;
  try { __westoModuleContext.assertUserBranchAccess(req.user, initialBranchId); } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  return __westoModuleContext.serializeAdminConfigMutation(initialBranchId, async () => {
    const zones = __westoModuleContext.db.deliveryZones || [];
    const index = zones.findIndex((item) => Number(item.id) === targetId);
    if (index < 0) return res.status(404).json({ error: 'not found' });
    const zone = zones[index];
    const zoneBranchId = Number(zone.branchId) || Number(__westoModuleContext.defaultBranch()?.id) || 1;
    try { __westoModuleContext.assertUserBranchAccess(req.user, zoneBranchId); } catch (error) {
      return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
    }
    if (zoneBranchId !== initialBranchId) return res.status(409).json({ error: 'delivery_zone_changed', message: 'محدودهٔ ارسال هنگام حذف تغییر کرده است؛ صفحه را تازه کنید.' });
    __westoModuleContext.db.deliveryZones = zones.filter((item) => item !== zone);
    const auditLogWasPresent = Array.isArray(__westoModuleContext.db.auditLog);
    let auditEntry;
    try {
      auditEntry = __westoModuleContext.recordAudit(req, 'delivery_zone.deleted', 'delivery_zone', zone.id, { name: zone.name }, zone.branchId, { deferAppend: true });
      await __westoModuleContext.persistAdminConfigMutation(() => {
        const currentZones = __westoModuleContext.db.deliveryZones || (__westoModuleContext.db.deliveryZones = []);
        if (!currentZones.includes(zone)) currentZones.splice(Math.min(index, currentZones.length), 0, zone);
        __westoModuleContext.rollbackAuditEntry(auditEntry, auditLogWasPresent);
      });
    } catch (error) {
      return __westoModuleContext.respondAdminConfigPersistenceFailure(res, error, 'delivery_zone_persistence_failed');
    }
    __westoModuleContext.appendAuditAfterCommit(auditEntry);
    try { __westoModuleContext.publishOperationalEvent('delivery_zone.updated', { zoneId: zone.id, branchId: zone.branchId, deleted: true }); }
    catch (eventError) { console.error('[delivery-zone-delete] post-commit event failed', eventError?.message || eventError); }
    return res.json({ ok: true });
  });
});
};
