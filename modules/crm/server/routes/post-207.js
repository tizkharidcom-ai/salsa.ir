'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/feedback', (req, res) => {
  const s = __westoModuleContext.db.feedbackSettings || {};
  if (s.enabled === false) return res.status(403).json({ error: 'بازخورد غیرفعال است' });
  if (req.body.score == null || req.body.score === '' || typeof req.body.score === 'boolean') {
    return res.status(400).json({ error: 'امتیاز باید عدد صحیح ۰ تا ۱۰ باشد' });
  }
  const score = Number(req.body.score);
  if (!Number.isFinite(score) || score < 0 || score > 10 || Math.floor(score) !== score) {
    return res.status(400).json({ error: 'امتیاز باید عدد صحیح ۰ تا ۱۰ باشد' });
  }
  const branch = __westoModuleContext.resolveBranch(req.body.branchId);
  const comment = String(req.body.comment || '').trim().slice(0, 800);
  const name = String(req.body.name || '').trim().slice(0, 80);
  const phone = __westoModuleContext.normalizeDigits(req.body.phone || '').trim().slice(0, 15);
  const orderId = req.body.orderId != null ? Number(req.body.orderId) : null;
  const source = String(req.body.source || 'web').trim().slice(0, 40);
  const entry = {
    id: Math.max(0, ...(__westoModuleContext.db.feedback || []).map((f) => f.id), 0) + 1,
    score,
    bucket: score >= 9 ? 'promoter' : score >= 7 ? 'passive' : 'detractor',
    comment,
    name,
    phone,
    orderId: Number.isFinite(orderId) && orderId > 0 ? orderId : null,
    branchId: branch?.id || null,
    source,
    status: 'new',
    createdAt: new Date().toISOString(),
  };
  __westoModuleContext.db.feedback = __westoModuleContext.db.feedback || [];
  __westoModuleContext.db.feedback.unshift(entry);
  __westoModuleContext.db.feedback = __westoModuleContext.db.feedback.slice(0, 2000);
  __westoModuleContext.save();
  res.json({ ok: true, id: entry.id, thankYou: s.thankYou || 'ممنون از بازخوردتان' });
});
};
