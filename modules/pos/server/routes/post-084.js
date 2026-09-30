'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/cashier/orders/:id/receipt', __westoModuleContext.requireCapability('payments.manage'), async (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (__westoModuleContext.db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  const branchId = Number(order.branchId) || __westoModuleContext.defaultBranch()?.id || 1;
  try {
    __westoModuleContext.assertUserBranchAccess(req.user, branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message });
  }
  if (order.paymentStatus !== 'paid') return res.status(409).json({ error: 'order_not_paid' });
  const method = String(req.body?.method || 'none');
  if (!['print', 'email', 'sms', 'none'].includes(method)) return res.status(400).json({ error: 'receipt_method_invalid' });
  if (method === 'print') {
    const printer = __westoModuleContext.printerForBranch(__westoModuleContext.db, branchId, req.body?.printerId);
    if (!printer) return res.status(409).json({ error: 'printer_not_configured' });
    try {
      // A paid receipt is generated only from the canonical, persisted order.
      const result = await __westoModuleContext.sendOrderToPrinter(order, printer, { restaurantName: __westoModuleContext.db.restaurant?.name || 'وستو' });
      const printedAt = new Date().toISOString();
      order.receipt = {
        method,
        status: 'printed',
        printerId: printer.id,
        printedAt,
        selectedAt: printedAt,
        by: req.user.phone,
      };
      order.lastPrint = { status: 'printed', printerId: printer.id, printedAt, by: req.user.phone };
      __westoModuleContext.recordAudit(req, 'order.receipt_printed', 'order', order.id, { method, printerId: printer.id, host: printer.host, port: printer.port, bytes: result.bytes }, branchId);
      __westoModuleContext.save();
      return res.json({ ok: true, order: __westoModuleContext.operationalOrderResponse(order, req.user), printed: true, deliveryConfigured: true, printer: __westoModuleContext.publicPrinterConfig(printer), result });
    } catch (error) {
      const failedAt = new Date().toISOString();
      order.receipt = {
        method,
        status: 'failed',
        printerId: printer.id,
        selectedAt: failedAt,
        by: req.user.phone,
        error: error.code || error.message,
      };
      order.lastPrint = {
        status: 'failed',
        printerId: printer.id,
        printedAt: failedAt,
        by: req.user.phone,
        error: error.code || error.message,
      };
      __westoModuleContext.recordAudit(req, 'order.receipt_print_failed', 'order', order.id, { method, printerId: printer.id, host: printer.host, port: printer.port, error: error.code || error.message }, branchId);
      __westoModuleContext.save();
      return res.status(error.status || 502).json({ error: error.code || 'printer_unreachable', message: error.message, printer: __westoModuleContext.publicPrinterConfig(printer) });
    }
  }
  order.receipt = {
    method,
    status: 'selected',
    destination: String(req.body?.destination || '').trim().slice(0, 180),
    selectedAt: new Date().toISOString(),
    by: req.user.phone,
  };
  __westoModuleContext.recordAudit(req, 'order.receipt_selected', 'order', order.id, { method }, order.branchId);
  __westoModuleContext.save();
  res.json({ ok: true, order: __westoModuleContext.operationalOrderResponse(order, req.user), deliveryConfigured: method === 'none' });
});
};
