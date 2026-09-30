'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/analytics', __westoModuleContext.requireAdmin, (req, res) => {
  const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
  const since = Date.now() - days * 24 * 3600 * 1000;
  const visits = (__westoModuleContext.db.visits || []).filter((v) => new Date(v.at).getTime() >= since);
  const byDay = {};
  const byPath = {};
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const v of visits) {
    const d = v.at.slice(0, 10);
    byDay[d] = (byDay[d] || 0) + 1;
    byPath[v.path] = (byPath[v.path] || 0) + 1;
    byHour[new Date(v.at).getHours()] += 1;
  }
  const sessions = new Set(visits.map((v) => v.sessionId)).size;
  res.json({
    days,
    total: visits.length,
    sessions,
    byDay,
    byHour,
    topPaths: Object.entries(byPath)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([path, count]) => ({ path, count })),
    recent: visits.slice(0, 40),
  });
});
};
