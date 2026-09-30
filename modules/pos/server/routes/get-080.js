'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/cashier/printers/system', __westoModuleContext.requireCapability('payments.manage'), async (req, res) => {
  try {
    const result = await __westoModuleContext.listSystemPrinters();
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(error.status || 502).json({ error: error.code || 'system_printer_discovery_failed', message: error.message });
  }
});
};
