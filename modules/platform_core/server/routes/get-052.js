'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/allergens', (req, res) => {
  res.json({ allergens: __westoModuleContext.ALLERGENS, dayparts: __westoModuleContext.DAYPARTS.map(({ id, label }) => ({ id, label })) });
});
};
