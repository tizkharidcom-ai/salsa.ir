'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.delete('/api/admin/tables/:id', __westoModuleContext.requireAdmin, async (req, res) => {
  // The legacy endpoint has no expectedLayoutRevision and cannot join the
  // floor-layout lock used by /api/admin/v2/floor/tables/delete. Refuse every
  // legacy delete until it can be routed through that guarded mutation; even
  // idle-table deletes must not silently bypass revisioning.
  return res.status(428).json({
    error: 'floor_layout_revision_required',
    message: 'حذف میز از این مسیر قدیمی امن نیست. نقشه را از API نسخه‌دار تازه کنید و حذف را همراه نسخهٔ نقشه انجام دهید.',
    replacement: {
      read: 'GET /api/admin/v2/floor?branchId={branchId}',
      delete: 'POST /api/admin/v2/floor/tables/delete',
      requiredBody: ['expectedLayoutRevision', 'tableIds'],
    },
  });
});
};
