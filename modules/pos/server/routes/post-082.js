'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/cashier/printer/test', __westoModuleContext.requireCapability('payments.manage'), async (req, res) => {
  const branchId = __westoModuleContext.parseBranchId(req) || __westoModuleContext.defaultBranch()?.id || 1;
  const printer = __westoModuleContext.printerForBranch(__westoModuleContext.db, branchId);
  if (!printer) return res.status(409).json({ error: 'printer_not_configured' });
  try {
    const result = req.body?.raster
      ? await __westoModuleContext.printRasterReceipt(req.body.raster, printer)
      : await __westoModuleContext.testPrinter(printer);
    __westoModuleContext.recordAudit(req, 'printer.test_printed', 'printer', printer.id, { transport: printer.transport, host: printer.host, port: printer.port, systemPrinterName: printer.systemPrinterName, bytes: result.bytes }, branchId);
    __westoModuleContext.save();
    return res.json({ ok: true, branchId, printed: true, printer: __westoModuleContext.publicPrinterConfig(printer), result });
  } catch (error) {
    __westoModuleContext.recordAudit(req, 'printer.test_failed', 'printer', printer.id, { transport: printer.transport, host: printer.host, port: printer.port, systemPrinterName: printer.systemPrinterName, error: error.code || error.message }, branchId);
    __westoModuleContext.save();
    return res.status(error.status || 502).json({ error: error.code || 'printer_unreachable', message: error.message, printer: __westoModuleContext.publicPrinterConfig(printer) });
  }
});
};
