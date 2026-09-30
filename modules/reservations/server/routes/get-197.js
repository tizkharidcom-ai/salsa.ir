'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/reservations/slots', (req, res) => {
  const settings = __westoModuleContext.db.reservationSettings || {};
  if (settings.enabled === false) return res.status(403).json({ error: 'رزرو غیرفعال است' });
  let dateStr = String(req.query.date || '').slice(0, 10);
  if (/^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(dateStr)) {
    try {
      const parts = __westoModuleContext.shamsi.toShamsiParts(dateStr);
      dateStr = parts.isoDate;
    } catch (_) {}
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).json({ error: 'تاریخ نامعتبر' });
  const advance = Math.max(1, Number(settings.advanceDays) || 21);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const want = new Date(`${dateStr}T12:00:00`);
  const diffDays = Math.floor((want - today) / 86400000);
  if (diffDays < 0 || diffDays > advance) {
    return res.status(400).json({ error: `فقط تا ${advance} روز آینده قابل رزرو است` });
  }
  const branch = __westoModuleContext.resolveBranch(req.query.branch || req.query.branchId);
  if (!branch) return res.status(400).json({ error: 'شعبه یافت نشد' });
  const partySize = Number(req.query.partySize) || 2;
  const result = __westoModuleContext.listReservationSlots(branch, dateStr, partySize);
  res.json({
    date: dateStr,
    shamsiDate: __westoModuleContext.shamsi.formatShamsiDate(dateStr),
    shamsiDateLong: __westoModuleContext.shamsi.formatShamsiDateLong(dateStr),
    branchId: branch.id,
    partySize,
    ...result,
  });
});
};
