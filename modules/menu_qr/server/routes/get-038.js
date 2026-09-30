'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/menu', async (req, res) => {
  try {
    const requestedBranch = req.query?.branchId || req.query?.branch;
    if (requestedBranch && !__westoModuleContext.resolveBranchExact(requestedBranch)) {
      return res.status(400).json({ error: 'branch_invalid', message: 'شعبهٔ انتخاب‌شده معتبر نیست.' });
    }
    if (__westoModuleContext.tenantConnectionManager?.baseUrl && req.tenantDataAccess && req.tenantContext?.databaseProvider === 'postgres') {
      const pgItems = await __westoModuleContext.tenantMenuRepository.listMenuItems(req.tenantDataAccess);
      __westoModuleContext.db.menuItems = pgItems;
      const pgCategories = await __westoModuleContext.tenantMenuRepository.listCategories(req.tenantDataAccess);
      if (pgCategories.length > 0) {
        __westoModuleContext.db.menuCategories = pgCategories;
      }
    }
    res.json(__westoModuleContext.publicGuestMenuPayload(req.query || {}));
  } catch (err) {
    console.error('[Menu GET Error]', err);
    res.status(500).json({ ok: false, error: 'menu_retrieval_failed', message: 'دریافت منو موقتاً با مشکل روبه‌رو شد.' });
  }
});
};
