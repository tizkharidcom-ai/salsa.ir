'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/waiter/waitlist', __westoModuleContext.requireCapability('reservations.receive'), async (req, res) => {
  let branchId;
  try { branchId = __westoModuleContext.parseBranchId(req); } catch (error) {
    return res.status(error.status || 400).json({ error: error.code || 'waitlist_branch_invalid', message: error.message });
  }
  if (!branchId) return res.status(400).json({ error: 'waitlist_branch_required', message: 'شعبهٔ فعال مشخص نیست.' });
  return __westoModuleContext.serializeWaitlistMutation(branchId, async () => {
    __westoModuleContext.db.reservations = Array.isArray(__westoModuleContext.db.reservations) ? __westoModuleContext.db.reservations : [];
    const reservationsBefore = __westoModuleContext.db.reservations.slice();
    const hadAuditLog = Array.isArray(__westoModuleContext.db.auditLog);
    const auditLogBefore = hadAuditLog ? __westoModuleContext.db.auditLog.slice() : null;
    try {
      const result = __westoModuleContext.waitlist.createWaitlistEntry({
        records: __westoModuleContext.db.reservations,
        branchId,
        phone: __westoModuleContext.normalizeDigits(req.body?.phone || '').trim(),
        name: req.body?.name,
        partySize: req.body?.partySize == null || String(req.body.partySize).trim() === '' ? null : __westoModuleContext.normalizeDigits(req.body.partySize),
        note: req.body?.note,
        idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotencyKey,
        phoneRe: __westoModuleContext.PHONE_RE,
        nextId: (rows) => Math.max(0, ...rows.map((row) => Number(row.id) || 0), 0) + 1,
        maxParty: __westoModuleContext.db.reservationSettings?.maxParty || 40,
      });
      if (!result.idempotentReplay) {
        __westoModuleContext.recordAudit(req, 'waitlist.created', 'reservation', result.entry.id, { phone: result.entry.phone, partySize: result.entry.partySize }, branchId);
        await __westoModuleContext.save({ requireDurable: true });
        try { __westoModuleContext.publishOperationalEvent('waitlist.created', { waitlistId: result.entry.id, branchId, status: result.entry.status }); }
        catch (eventError) { console.error('[waitlist-create] post-commit event failed', eventError?.message || eventError); }
      }
      return res.status(result.idempotentReplay ? 200 : 201).json({ ok: true, idempotent: result.idempotentReplay, entry: __westoModuleContext.publicWaitlistEntry(result.entry) });
    } catch (error) {
      __westoModuleContext.db.reservations = reservationsBefore;
      if (hadAuditLog) __westoModuleContext.db.auditLog = auditLogBefore;
      else delete __westoModuleContext.db.auditLog;
      return res.status(error.status || 503).json({ error: error.code || 'waitlist_create_failed', message: error.message, entry: error.entry ? __westoModuleContext.publicWaitlistEntry(error.entry) : undefined });
    }
  });
});
};
