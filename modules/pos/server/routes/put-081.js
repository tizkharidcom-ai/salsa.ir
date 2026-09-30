'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/cashier/printer', __westoModuleContext.requireCapability('payments.manage'), (req, res) => {
  const branchId = __westoModuleContext.parseBranchId(req) || __westoModuleContext.defaultBranch()?.id || 1;
  const current = __westoModuleContext.printerForBranch(__westoModuleContext.db, branchId);
  try {
    const printer = __westoModuleContext.normalizePrinterConfig({ ...(req.body || {}), branchId }, current || { ...__westoModuleContext.DEFAULT_PRINTER_CONFIG, branchId });
    __westoModuleContext.ensurePrintingData(__westoModuleContext.db, branchId);
    const existingIndex = __westoModuleContext.db.printing.printers.findIndex((item) => Number(item.branchId) === Number(branchId));
    if (existingIndex >= 0) __westoModuleContext.db.printing.printers[existingIndex] = printer;
    else __westoModuleContext.db.printing.printers.push(printer);
    __westoModuleContext.db.printing.defaultPrinterId = printer.id;
    __westoModuleContext.recordAudit(req, 'printer.configured', 'printer', printer.id, { transport: printer.transport, host: printer.host, port: printer.port, systemPrinterName: printer.systemPrinterName, protocol: printer.protocol }, branchId);
    __westoModuleContext.save();
    res.json({ ok: true, branchId, printer: __westoModuleContext.publicPrinterConfig(printer), directPrint: true });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.code || 'printer_config_invalid', message: error.message, field: error.field || null });
  }
});
};
