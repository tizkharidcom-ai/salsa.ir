'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/content', __westoModuleContext.requireAdmin, (req, res) => {
  const updates = req.body.content || {};
  for (const [k, v] of Object.entries(updates)) {
    if (typeof v === 'string') __westoModuleContext.db.content[k] = v;
  }
  __westoModuleContext.save();
  res.json({ ok: true, content: __westoModuleContext.db.content });
});
};
