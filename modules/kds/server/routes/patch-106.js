'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.patch('/api/kitchen/items/:id/availability', __westoModuleContext.requireCapability('kitchen.manage'), async (req, res) => {
  const branchId = __westoModuleContext.requestedKdsBranch(req);
  if (!branchId) return res.status(400).json({ error: 'branch_invalid' });
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  if (!Number.isSafeInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'menu_item_id_invalid' });
  const item = (__westoModuleContext.db.menuItems || []).find((entry) => Number(entry.id) === targetId);
  if (!item || !__westoModuleContext.menuItemBelongsToBranch(item, branchId)) return res.status(404).json({ error: 'not found' });
  if (typeof req.body?.available !== 'boolean') return res.status(400).json({ error: 'availability_invalid' });
  if (req.body.available && item.available === false) {
    return res.status(409).json({ error: 'menu_item_globally_unavailable', message: 'این کالا در کاتالوگ اصلی غیرفعال است؛ فعال‌سازی شعبه‌ای کافی نیست.' });
  }

  return __westoModuleContext.serializeAdminConfigMutation(branchId, async () => {
    const snapshot = __westoModuleContext.snapshotFinanceMutationState();
    const mutation = __westoModuleContext.setMenuAvailabilityOverride(__westoModuleContext.db, {
      menuItemId: item.id,
      branchId,
      available: req.body.available,
    });
    if (!mutation.ok) return res.status(409).json({ error: mutation.error });
    const auditEntry = __westoModuleContext.recordAudit(req, 'kds.item_availability_changed', 'menu_item', item.id, {
      branchId, available: req.body.available,
    }, branchId, { deferAppend: true });
    try {
      await __westoModuleContext.persistFinanceMutation(snapshot, { bumpMenu: true });
    } catch (error) {
      return res.status(error.status || 503).json({
        error: error.code || 'menu_availability_persistence_failed',
        message: 'تغییر موجودی شعبه ذخیره نشد؛ وضعیت قبلی حفظ شد.',
      });
    }

    __westoModuleContext.appendAuditAfterCommit(auditEntry);
    let eventPublished = true;
    try {
      __westoModuleContext.publishOperationalEvent('menu.availability_updated', {
        menuItemId: item.id, branchId, available: req.body.available,
      });
    } catch (error) {
      eventPublished = false;
      console.error('[kds] committed availability event failed', error?.message || error);
    }
    return res.json({
      ok: true,
      eventPublished,
      branchId,
      item: __westoModuleContext.kdsMenuAvailabilityPayload(item, branchId),
    });
  }).catch((error) => {
    if (res.headersSent) return undefined;
    return res.status(error.status || 503).json({ error: error.code || 'menu_availability_update_failed' });
  });
});
};
