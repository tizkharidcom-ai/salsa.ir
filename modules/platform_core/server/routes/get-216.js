'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get(Object.keys(__westoModuleContext.PAGES), (req, res) => {
  if (req.path.startsWith('/admin') || req.path === '/login') res.setHeader('Cache-Control', 'no-store');
  const pagePath = __westoModuleContext.PAGES[req.path] || __westoModuleContext.PAGES[String(req.path || '').replace(/\/$/, '')];
  if (!pagePath) return res.status(404).send('Not Found');
  const selected = __westoModuleContext.moduleRuntime.resolveFrontendAsset(pagePath, req.tenantContext?.moduleVersions || {});
  if (selected) res.setHeader('X-Westo-Module-Version', `${selected.moduleKey}@${selected.version}`);
  res.sendFile(selected?.absolute || __westoModuleContext.path.join(__westoModuleContext.ROOT, pagePath));
});
};
