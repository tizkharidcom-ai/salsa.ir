'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/referrals/apply', __westoModuleContext.requireAuth, async (req, res) => {
  const referralCode = String(req.body.code || req.body.referralCode || '').trim();
  if (!referralCode) return res.status(400).json({ error: 'کد معرف الزامی است.' });

  const snapshot = __westoModuleContext.snapshotFinanceMutationState();
  try {
    const branchId = __westoModuleContext.parseBranchId(req);
    if (!branchId) return res.status(400).json({ error: 'wallet_topup_branch_required' });
    const result = __westoModuleContext.campaignsEngine.applyReferralCode(__westoModuleContext.db, {
      inviteePhone: req.user.phone,
      referralCode,
      walletTopup: (input) => __westoModuleContext.campaignWalletTopupWithFinance(input, branchId, 'referral-system'),
    });
    await __westoModuleContext.persistFinanceMutation(snapshot);
    res.json(result);
  } catch (err) {
    __westoModuleContext.restoreFinanceMutationState(snapshot);
    res.status(400).json({ error: err.message });
  }
});
};
