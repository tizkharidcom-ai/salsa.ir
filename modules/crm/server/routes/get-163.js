'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/loyalty/tiers', __westoModuleContext.requireOwner, (req, res) => {
  const rawMembers = __westoModuleContext.db.users.map(__westoModuleContext.publicUser);
  const tiers = __westoModuleContext.loyaltyEngine.summarizeTiersMembership(__westoModuleContext.db, rawMembers);
  res.json({ tiers });
});
};
