'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/admin/loyalty/tiers', __westoModuleContext.requireOwner, (req, res) => {
  let normalizedTiers;
  try {
    normalizedTiers = __westoModuleContext.loyaltyEngine.normalizeLoyaltyTiers(req.body.tiers);
  } catch (error) {
    return res.status(400).json({ error: error.code || 'invalid_loyalty_tiers', message: error.message });
  }
  if (!__westoModuleContext.db.loyalty) __westoModuleContext.db.loyalty = {};
  __westoModuleContext.db.loyalty.tiers = normalizedTiers;
  __westoModuleContext.save();
  res.json({ ok: true, tiers: __westoModuleContext.db.loyalty.tiers });
});
};
