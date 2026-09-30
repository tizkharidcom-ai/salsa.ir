'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/referrals/me', __westoModuleContext.requireAuth, (req, res) => {
  const user = req.user;
  const referralCode = __westoModuleContext.campaignsEngine.ensureUserReferral(user);
  const referrals = (__westoModuleContext.db.referrals || []).filter((r) => r.inviterPhone === user.phone);
  const config = __westoModuleContext.campaignsEngine.getCampaignConfig(__westoModuleContext.db).referral;

  res.json({
    referralCode,
    referralUrl: `/register?ref=${referralCode}`,
    rewardStats: {
      totalInvited: referrals.length,
      rewardedCount: referrals.filter((r) => r.status === 'rewarded').length,
      totalEarnedWalletToman: referrals.filter((r) => r.status === 'rewarded').reduce((s, r) => s + (r.inviterRewardWalletToman || 0), 0),
      totalEarnedPoints: referrals.filter((r) => r.status === 'rewarded').reduce((s, r) => s + (r.inviterRewardPoints || 0), 0),
    },
    rewardsConfig: {
      inviterRewardWalletToman: config.inviterRewardWalletToman,
      inviterRewardPoints: config.inviterRewardPoints,
      inviteeRewardWalletToman: config.inviteeRewardWalletToman,
      inviteeRewardPoints: config.inviteeRewardPoints,
      inviteeDiscountPct: config.inviteeDiscountPct,
    },
    referrals,
  });
});
};
