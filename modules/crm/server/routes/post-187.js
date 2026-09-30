'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/campaigns/claim-birthday', __westoModuleContext.requireAuth, async (req, res) => {
  const snapshot = __westoModuleContext.snapshotFinanceMutationState();
  try {
    const branchId = __westoModuleContext.parseBranchId(req);
    if (!branchId) return res.status(400).json({ error: 'wallet_topup_branch_required' });
    const result = __westoModuleContext.campaignsEngine.grantBirthdayGift(__westoModuleContext.db, req.user.phone, new Date(), {
      walletTopup: (input) => __westoModuleContext.campaignWalletTopupWithFinance(input, branchId, 'birthday-campaign'),
    });

    // Trigger Smart Birthday SMS
    try {
      __westoModuleContext.smsEngine.sendSms(__westoModuleContext.db, {
        phone: req.user.phone,
        name: req.user.name || '',
        templateKey: 'birthday',
        vars: {
          name: req.user.name || 'همراه گرامی',
          amount: result.walletBonusToman || 100000,
        },
        triggerType: 'event',
      });
    } catch (_) {}

    await __westoModuleContext.persistFinanceMutation(snapshot);
    res.json(result);
  } catch (err) {
    __westoModuleContext.restoreFinanceMutationState(snapshot);
    res.status(400).json({ error: err.message });
  }
});
};
