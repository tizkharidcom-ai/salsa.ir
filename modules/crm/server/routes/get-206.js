'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/feedback/meta', (req, res) => {
  const s = __westoModuleContext.db.feedbackSettings || {};
  const branch = __westoModuleContext.resolveBranch(req.query.branchId);
  res.json({
    enabled: s.enabled !== false,
    title: s.title || 'نظر شما',
    subtitle: s.subtitle || '',
    thankYou: s.thankYou || 'ممنون',
    restaurant: __westoModuleContext.db.restaurant?.name || 'وستو',
    branch: branch ? { id: branch.id, name: branch.name } : null,
    branches: (__westoModuleContext.db.branches || [])
      .filter((b) => b.active !== false)
      .map((b) => ({ id: b.id, name: b.name })),
  });
});
};
