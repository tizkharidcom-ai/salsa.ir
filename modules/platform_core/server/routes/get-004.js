'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/staff/session/:workspace', __westoModuleContext.requireCommandCenterAccess, (req, res) => {
  const workspace = String(req.params.workspace || '');
  if (!__westoModuleContext.canOpenWorkspace(req.user, workspace)) return res.status(403).json({ error: 'workspace_forbidden', workspace });
  const branchId = __westoModuleContext.parseBranchId(req) || __westoModuleContext.defaultBranch()?.id || null;
  const actualRole = __westoModuleContext.effectiveRole(req.user);
  const allowedBranchIds = __westoModuleContext.branchScopeForUser(req.user, { role: actualRole });
  res.json({
    user: __westoModuleContext.publicUser(req.user),
    workspace: {
      role: workspace,
      label: __westoModuleContext.STAFF_WORKSPACES[workspace].label,
      capabilities: __westoModuleContext.ROLE_CAPABILITIES[workspace] || [],
      preview: actualRole !== workspace,
      returnPath: actualRole === 'owner' || actualRole === 'manager' ? '/admin' : null,
    },
    branchId,
    branches: (__westoModuleContext.db.branches || []).filter((branch) => branch.active !== false
      && (allowedBranchIds === null || allowedBranchIds.includes(Number(branch.id)))),
    shift: __westoModuleContext.activeStaffShift(req.user, branchId),
  });
});
};
