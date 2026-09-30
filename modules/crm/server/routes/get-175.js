'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/wallet/topup-requests/pending', __westoModuleContext.requireAuth, (req, res) => {
  const role = __westoModuleContext.effectiveRole(req.user);
  if (!['cashier', 'waiter', 'manager', 'owner', 'admin'].includes(role)) {
    return res.status(403).json({ error: 'دسترسی فقط برای کادر سالن و صندوق مجاز است.' });
  }

  let branchId;
  try { branchId = __westoModuleContext.parseBranchId(req); } catch (error) {
    return res.status(error.status || 400).json({ error: error.code || 'branch_invalid', message: error.message });
  }
  const pending = __westoModuleContext.branchScoped((__westoModuleContext.db.walletTopupRequests || []), branchId)
    .filter((r) => r.status === 'pending_staff_approval')
    .slice(0, 50);

  res.json({ ok: true, requests: pending });
});
};
