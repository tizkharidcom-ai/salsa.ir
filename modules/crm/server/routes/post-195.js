'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/admin/sms/run-winback', __westoModuleContext.requireAdmin, async (req, res) => {
  const parseNum = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    const n = Number(__westoModuleContext.normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? null : n;
  };
  const segment = req.body.segment || 'at_risk';
  const rewardWalletToman = parseNum(req.body.rewardWalletToman) ?? 50000;
  const maxRecipients = parseNum(req.body.maxRecipients) ?? 50;

  const snapshot = __westoModuleContext.snapshotFinanceMutationState();
  try {
    const branchId = __westoModuleContext.parseBranchId(req);
    if (!branchId) return res.status(400).json({ error: 'wallet_topup_branch_required' });
    const result = await __westoModuleContext.smsEngine.executeWinbackCampaign(__westoModuleContext.db, {
      segment,
      rewardWalletToman,
      maxRecipients,
      walletTopup: (input) => __westoModuleContext.campaignWalletTopupWithFinance(input, branchId, 'automated-retention'),
    });
    await __westoModuleContext.persistFinanceMutation(snapshot);
    res.json(result);
  } catch (err) {
    __westoModuleContext.restoreFinanceMutationState(snapshot);
    res.status(400).json({ error: err.message });
  }
});
};
