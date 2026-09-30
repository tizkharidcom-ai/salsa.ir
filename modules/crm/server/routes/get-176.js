'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/wallet/topup-requests/my', __westoModuleContext.requireAuth, (req, res) => {
  const myRequests = (__westoModuleContext.db.walletTopupRequests || [])
    .filter((r) => r.phone === req.user.phone)
    .slice(0, 10);
  res.json({ ok: true, requests: myRequests });
});
};
