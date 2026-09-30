'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/admin/delivery-zones', __westoModuleContext.requireCapability('delivery.manage'), async (req, res) => {
  let branchId;
  try { branchId = __westoModuleContext.parseBranchId(req); } catch (error) {
    return res.status(error.status || 400).json({ error: error.code || 'branch_invalid', message: error.message });
  }
  if (branchId == null) return res.status(400).json({ error: 'branch_required' });
  return __westoModuleContext.serializeAdminConfigMutation(branchId, async () => {
    const zone = __westoModuleContext.cleanDeliveryZone({ ...(req.body || {}), branchId });
    if (!zone.name) return res.status(400).json({ error: 'نام محدوده لازم است' });
    const hadZones = Array.isArray(__westoModuleContext.db.deliveryZones);
    __westoModuleContext.db.deliveryZones = hadZones ? __westoModuleContext.db.deliveryZones : [];
    __westoModuleContext.db.deliveryZones.push(zone);
    const auditLogWasPresent = Array.isArray(__westoModuleContext.db.auditLog);
    let auditEntry;
    try {
      auditEntry = __westoModuleContext.recordAudit(req, 'delivery_zone.created', 'delivery_zone', zone.id, { name: zone.name }, zone.branchId, { deferAppend: true });
      await __westoModuleContext.persistAdminConfigMutation(() => {
        __westoModuleContext.db.deliveryZones = (__westoModuleContext.db.deliveryZones || []).filter((candidate) => candidate !== zone);
        if (!hadZones && __westoModuleContext.db.deliveryZones.length === 0) delete __westoModuleContext.db.deliveryZones;
        __westoModuleContext.rollbackAuditEntry(auditEntry, auditLogWasPresent);
      });
    } catch (error) {
      return __westoModuleContext.respondAdminConfigPersistenceFailure(res, error, 'delivery_zone_persistence_failed');
    }
    __westoModuleContext.appendAuditAfterCommit(auditEntry);
    try { __westoModuleContext.publishOperationalEvent('delivery_zone.updated', { zoneId: zone.id, branchId: zone.branchId }); }
    catch (eventError) { console.error('[delivery-zone-create] post-commit event failed', eventError?.message || eventError); }
    return res.status(201).json({ ok: true, zone });
  });
});
};
