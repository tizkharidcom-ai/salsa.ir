'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/cashier/drawer', __westoModuleContext.requireCapability('cash.manage'), (req, res) => {
  const branchId = __westoModuleContext.parseBranchId(req) || __westoModuleContext.defaultBranch()?.id || 1;
  return __westoModuleContext.withCashDrawerMutationLock(__westoModuleContext.cashDrawerMutationQueueKey(req, branchId), async () => {
    const session = __westoModuleContext.activeCashSession(req.user, branchId);
    const totals = session ? __westoModuleContext.cashSessionTotals(session) : null;
    if (session && !totals) return res.status(409).json({ error: 'cash_drawer_ledger_invalid', message: 'سابقهٔ صندوق قابل جمع‌بندی نیست؛ پیش از ادامه آن را تطبیق دهید.' });
    return res.json({ session, totals });
  });
});
};
