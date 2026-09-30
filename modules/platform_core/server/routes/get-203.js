'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/whatsapp', __westoModuleContext.requireAdmin, (req, res) => {
  res.json({
    settings: __westoModuleContext.db.whatsappNotify || {},
    log: (__westoModuleContext.db.whatsappLog || []).slice(0, 40),
    webhookConfigured: !!process.env.WHATSAPP_WEBHOOK_URL,
    resolvedPhone: __westoModuleContext.toWaDigits(__westoModuleContext.resolveNotifyPhone(__westoModuleContext.db, req.query.branchId)),
  });
});
};
