'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get(['/checkout', '/checkout.html'], (req, res) => res.redirect(302, '/order'));
};
