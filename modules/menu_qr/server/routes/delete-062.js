'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.delete('/api/menu/:id', __westoModuleContext.requireAdmin, async (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  if (__westoModuleContext.tenantConnectionManager?.baseUrl && req.tenantDataAccess && req.tenantContext?.databaseProvider === 'postgres') {
    try {
      await __westoModuleContext.tenantMenuRepository.deleteMenuItem(req.tenantDataAccess, targetId);
    } catch (err) {
      console.error('[Tenant Menu Delete Error]', err);
      return res.status(500).json({ ok: false, error: 'menu_delete_failed', message: err.message });
    }
  }
  __westoModuleContext.db.menuItems = (__westoModuleContext.db.menuItems || []).filter((m) => Number(m.id) !== targetId);
  __westoModuleContext.save({ rebuildProducts: true });
  res.json({ ok: true });
});
};
