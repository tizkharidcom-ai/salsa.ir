'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/role-preview', __westoModuleContext.requireCapability('role.preview'), (req, res) => {
  res.json({
    workspaces: Object.entries(__westoModuleContext.STAFF_WORKSPACES).map(([role, item]) => ({
      role,
      label: item.label,
      path: item.path,
      capabilities: __westoModuleContext.ROLE_CAPABILITIES[role] || [],
    })),
  });
});
};
