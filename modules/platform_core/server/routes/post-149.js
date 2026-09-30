'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/analytics/visit', (req, res) => {
  const pathName = String(req.body.path || '/').slice(0, 200);
  const referrer = String(req.body.referrer || '').slice(0, 300);
  const sessionId = String(req.body.sessionId || __westoModuleContext.crypto.randomBytes(8).toString('hex')).slice(0, 64);
  const ua = String(req.headers['user-agent'] || '').slice(0, 200);
  const at = new Date().toISOString();
  __westoModuleContext.db.visits = __westoModuleContext.db.visits || [];
  __westoModuleContext.db.visits.unshift({ at, path: pathName, referrer, sessionId, ua });
  __westoModuleContext.db.visits = __westoModuleContext.db.visits.slice(0, 5000);
  __westoModuleContext.db.visitSessions = __westoModuleContext.db.visitSessions || {};
  __westoModuleContext.db.visitSessions[sessionId] = at;
  // prune old session map
  const keys = Object.keys(__westoModuleContext.db.visitSessions);
  if (keys.length > 8000) {
    for (const k of keys.slice(0, keys.length - 4000)) delete __westoModuleContext.db.visitSessions[k];
  }
  __westoModuleContext.save();
  res.json({ ok: true });
});
};
