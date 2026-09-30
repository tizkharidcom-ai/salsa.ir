'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get(['/kitchen', '/kitchen.html', '/kds', '/kds.html'], (req, res) => res.redirect(302, '/admin/kitchen'));
};
