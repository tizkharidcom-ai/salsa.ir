'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/products/:id', __westoModuleContext.requireAdmin, (req, res) => {
  res.status(410).json({
    error: 'این مسیر منسوخ است — از مدیریت دسته‌های کاروسل استفاده کنید',
  });
});
};
