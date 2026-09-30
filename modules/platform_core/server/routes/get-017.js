'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/command-center', __westoModuleContext.requireCapability('command.view'), (req, res) => {
  res.json(__westoModuleContext.commandCenterPayload(__westoModuleContext.parseBranchId(req)));
});
};
