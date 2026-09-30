'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/reservations', __westoModuleContext.requireCapability('reservations.view'), (req, res) => {
  // Walk-in guests have no date/time slot; they are served by the waiter
  // reception endpoint and must not pollute the online reservation calendar.
  const requestedBranch = __westoModuleContext.requestBranchValue(req);
  const allowedBranchIds = __westoModuleContext.branchScopeForUser(req.user, { role: __westoModuleContext.effectiveRole(req.user) });
  let branchId = null;
  try {
    if (requestedBranch != null) {
      branchId = __westoModuleContext.parseBranchId(req);
    } else if (allowedBranchIds !== null) {
      if (!allowedBranchIds.length) {
        return res.status(403).json({ error: 'branch_scope_empty', message: 'برای این کاربر شعبهٔ مجازی تعریف نشده است.' });
      }
      const preferred = __westoModuleContext.defaultBranch();
      branchId = preferred && allowedBranchIds.includes(Number(preferred.id))
        ? preferred.id
        : allowedBranchIds[0];
    }
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.code || 'branch_invalid', message: error.message });
  }
  let list = (__westoModuleContext.db.reservations || []).filter((item) => !__westoModuleContext.waitlist.isWaitlist(item)).slice();
  if (branchId != null) list = list.filter((r) => Number(r.branchId) === Number(branchId));
  let queryDate = req.query.date ? String(req.query.date).slice(0, 10) : null;
  if (queryDate && /^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(queryDate)) {
    try {
      const p = __westoModuleContext.shamsi.toShamsiParts(queryDate);
      queryDate = p.isoDate;
    } catch (_) {}
  }
  if (queryDate) list = list.filter((r) => r.date === queryDate);
  if (req.query.status) list = list.filter((r) => r.status === req.query.status);
  const today = new Date().toISOString().slice(0, 10);
  const active = list.filter((r) => __westoModuleContext.ACTIVE_RES_STATUSES.has(r.status));
  const terminal = new Set(['cancelled', 'no_show']);
  list.sort((a, b) => {
    const aClosed = terminal.has(String(a.status));
    const bClosed = terminal.has(String(b.status));
    if (aClosed !== bClosed) return aClosed ? 1 : -1;
    const ak = `${a.date || ''}T${a.time || '00:00'}`;
    const bk = `${b.date || ''}T${b.time || '00:00'}`;
    return aClosed ? bk.localeCompare(ak) : ak.localeCompare(bk);
  });
  const maxCovers = Math.max(1, Number(__westoModuleContext.db.reservationSettings?.maxCoversPerSlot) || 24);
  const slotMap = new Map();
  for (const r of active) {
    const key = `${r.date}|${r.time}`;
    const row = slotMap.get(key) || { date: r.date, time: r.time, covers: 0, parties: 0 };
    row.covers += Math.max(1, Number(r.partySize) || 1);
    row.parties += 1;
    slotMap.set(key, row);
  }
  const slotLoad = [...slotMap.values()]
    .map((row) => ({ ...row, maxCovers, percent: Math.min(100, Math.round((row.covers / maxCovers) * 100)) }))
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))
    .slice(0, 120);
  const todayActive = active.filter((r) => r.date === today);
  res.json({
    reservations: list.slice(0, 200).map((r) => ({
      ...r,
      shamsiDate: __westoModuleContext.shamsi.formatShamsiDate(r.date),
      shamsiDateLong: __westoModuleContext.shamsi.formatShamsiDateLong(r.date),
      shamsiDateFull: __westoModuleContext.shamsi.formatShamsiDateFull(r.date),
    })),
    settings: __westoModuleContext.db.reservationSettings,
    slotLoad,
    serverTime: new Date().toISOString(),
    summary: {
      today: todayActive.length,
      todayCovers: todayActive.reduce((sum, r) => sum + Math.max(1, Number(r.partySize) || 1), 0),
      pending: list.filter((r) => r.status === 'pending').length,
      confirmed: list.filter((r) => r.status === 'confirmed').length,
      seated: list.filter((r) => r.status === 'seated' && r.date === today).length,
      noShowToday: list.filter((r) => r.status === 'no_show' && r.date === today).length,
    },
  });
});
};
