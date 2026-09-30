'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get(['/pos', '/pos.html', '/cashier', '/cashier.html'], (req, res) => res.redirect(302, '/admin/cashier'));
};
