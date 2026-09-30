'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/menu-engineering', __westoModuleContext.requireCapability('menu.manage'), (req, res) => {
  res.json({
    menuCategories: __westoModuleContext.db.menuCategories || [],
    menuItems: (__westoModuleContext.db.menuItems || []).map(({ id, categoryId, name, img, available }) => ({ id, categoryId, name, img: img || '', available: available !== false })),
    menuComplements: __westoModuleContext.db.menuComplements || [],
    menuComplementRules: __westoModuleContext.db.menuComplementRules || [],
  });
});
};
