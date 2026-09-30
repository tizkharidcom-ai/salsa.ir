'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.patch('/api/admin/reservations/:id', __westoModuleContext.requireCapability('reservations.manage'), (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const item = (__westoModuleContext.db.reservations || []).find((r) => Number(r.id) === targetId);
  if (!item) return res.status(404).json({ error: 'not found' });
  try {
    __westoModuleContext.assertUserBranchAccess(req.user, item.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  if (req.body?.branchId != null && Number(req.body.branchId) !== Number(item.branchId)) {
    return res.status(404).json({ error: 'reservation_branch_mismatch' });
  }
  const allowed = ['pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'];
  if (typeof req.body.status === 'string' && allowed.includes(req.body.status)) {
    item.status = req.body.status;
    item.statusAt = new Date().toISOString();
    if (req.body.status === 'seated' && !item.seatedAt) item.seatedAt = new Date().toISOString();
    if (req.body.status === 'completed' && !item.completedAt) item.completedAt = new Date().toISOString();
  }
  if (typeof req.body.note === 'string') item.note = req.body.note.trim().slice(0, 200);
  if (req.body.tableNo !== undefined) {
    item.tableNo = req.body.tableNo == null || req.body.tableNo === '' ? null : String(req.body.tableNo).trim().slice(0, 20);
  }
  if (req.body.occasion !== undefined) {
    item.occasion = req.body.occasion == null || req.body.occasion === '' ? null : String(req.body.occasion).trim().slice(0, 40);
  }
  if (req.body.partySize != null) {
    const rawParty = typeof req.body.partySize === 'number'
      ? req.body.partySize
      : Number(String(req.body.partySize).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).trim());
    if (!isNaN(rawParty)) {
      item.partySize = Math.max(1, Math.min(Number(__westoModuleContext.db.reservationSettings?.maxParty) || 12, Math.round(rawParty)));
    }
  }
  __westoModuleContext.recordAudit(req, 'reservation.updated', 'reservation', item.id, { status: item.status, partySize: item.partySize, tableNo: item.tableNo }, item.branchId);
  __westoModuleContext.publishOperationalEvent('reservation.updated', { reservationId: item.id, branchId: item.branchId, status: item.status });
  __westoModuleContext.save();
  res.json({ ok: true, reservation: item });
});
};
