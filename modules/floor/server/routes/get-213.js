'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get(['/waiter', '/waiter.html'], (req, res) => res.redirect(302, '/admin/waiter'));
};
