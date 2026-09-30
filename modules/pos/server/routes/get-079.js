'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/cashier/printer', __westoModuleContext.requireCapability('payments.manage'), (req, res) => {
  const branchId = __westoModuleContext.parseBranchId(req) || __westoModuleContext.defaultBranch()?.id || 1;
  const printer = __westoModuleContext.printerForBranch(__westoModuleContext.db, branchId);
  res.json({ ok: true, branchId, printer: __westoModuleContext.publicPrinterConfig(printer), directPrint: true });
});
};
