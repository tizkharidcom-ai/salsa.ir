'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/cashier/orders/:id/print', __westoModuleContext.requireCapability('payments.manage'), async (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (__westoModuleContext.db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  const branchId = Number(order.branchId) || __westoModuleContext.defaultBranch()?.id || 1;
  try {
    __westoModuleContext.assertUserBranchAccess(req.user, branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message });
  }
  const printer = __westoModuleContext.printerForBranch(__westoModuleContext.db, branchId, req.body?.printerId);
  if (!printer) return res.status(409).json({ error: 'printer_not_configured' });
  try {
    // Official order printouts must be rendered from the authoritative order;
    // never let a browser-supplied image redefine prices or payment state.
    const result = await __westoModuleContext.sendOrderToPrinter(order, printer, { restaurantName: __westoModuleContext.db.restaurant?.name || 'وستو' });
    const printedAt = new Date().toISOString();
    order.lastPrint = { status: 'printed', printerId: printer.id, printedAt, by: req.user.phone };
    __westoModuleContext.recordAudit(req, 'order.printed', 'order', order.id, { printerId: printer.id, host: printer.host, port: printer.port, bytes: result.bytes, paid: order.paymentStatus === 'paid' }, branchId);
    __westoModuleContext.save();
    return res.json({ ok: true, printed: true, printer: __westoModuleContext.publicPrinterConfig(printer), result, order: __westoModuleContext.operationalOrderResponse(order, req.user) });
  } catch (error) {
    order.lastPrint = { status: 'failed', printerId: printer.id, printedAt: new Date().toISOString(), by: req.user.phone, error: error.code || error.message };
    __westoModuleContext.recordAudit(req, 'order.print_failed', 'order', order.id, { printerId: printer.id, host: printer.host, port: printer.port, error: error.code || error.message }, branchId);
    __westoModuleContext.save();
    return res.status(error.status || 502).json({ error: error.code || 'printer_unreachable', message: error.message, printer: __westoModuleContext.publicPrinterConfig(printer) });
  }
});
};
