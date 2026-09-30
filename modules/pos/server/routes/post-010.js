'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/cashier/drawer/close', __westoModuleContext.requireCapability('cash.manage'), async (req, res) => {
  const branchId = __westoModuleContext.parseBranchId(req) || __westoModuleContext.defaultBranch()?.id || 1;
  const countedAmount = __westoModuleContext.parseCashDrawerAmount(req.body?.countedAmount, { allowZero: true });
  if (countedAmount == null) return res.status(400).json({ error: 'cash_counted_amount_invalid' });
  const queueKey = __westoModuleContext.cashDrawerMutationQueueKey(req, branchId);
  return __westoModuleContext.withCashDrawerMutationLock(queueKey, async () => {
    const session = __westoModuleContext.activeCashSession(req.user, branchId);
    const requestedSessionId = String(req.body?.sessionId || '').trim();
    if (session && requestedSessionId && String(session.id) !== requestedSessionId) {
      return res.status(409).json({ error: 'cash_drawer_session_changed' });
    }
    const closedSession = session || (requestedSessionId
      ? (__westoModuleContext.db.cashSessions || []).find((item) => String(item.id) === requestedSessionId
        && String(item.phone) === String(req.user.phone)
        && Number(item.branchId) === Number(branchId)
        && item.closedAt)
      : null);
    if (!closedSession) return res.status(409).json({ error: 'cash_drawer_not_open' });
    const requestFingerprint = __westoModuleContext.cashDrawerMovementFingerprint({
      tenantId: req.tenantId, branchId, sessionId: closedSession.id,
      phone: req.user.phone, type: 'close', amount: countedAmount, note: '',
    });
    if (closedSession.closeRequestFingerprint) {
      if (closedSession.closeRequestFingerprint !== requestFingerprint) {
        return res.status(409).json({ error: 'cash_drawer_close_idempotency_conflict' });
      }
      const closedTotals = __westoModuleContext.cashSessionTotals(closedSession);
      if (!closedTotals) return res.status(409).json({ error: 'cash_drawer_ledger_invalid' });
      return res.json({
        ok: true, idempotent: true, session: closedSession,
        totals: { ...closedTotals, counted: closedSession.countedAmount, variance: closedSession.variance },
      });
    }
    if (!session) return res.status(409).json({ error: 'cash_drawer_not_open' });
    const totals = __westoModuleContext.cashSessionTotals(session);
    if (!totals) return res.status(409).json({ error: 'cash_drawer_ledger_invalid', message: 'سابقهٔ صندوق معتبر نیست؛ بستن صندوق انجام نشد.' });
    const snapshot = __westoModuleContext.snapshotFinanceMutationState();
    session.countedAmount = countedAmount;
    session.variance = session.countedAmount - totals.expected;
    session.closedAt = new Date().toISOString();
    session.closeRequestFingerprint = requestFingerprint;
    __westoModuleContext.recordAudit(req, 'cash_drawer.closed', 'cash_session', session.id, { countedAmount: session.countedAmount, variance: session.variance }, branchId);
    try {
      const financeResult = __westoModuleContext.financeV2.captureCashClose(__westoModuleContext.db, session, { actor: req.user.phone });
      await __westoModuleContext.persistFinanceMutation(snapshot);
      return res.json({ ok: true, session, totals: { ...totals, counted: session.countedAmount, variance: session.variance }, finance: financeResult });
    } catch (error) {
      __westoModuleContext.restoreFinanceMutationState(snapshot);
      return res.status(error.status || 503).json({ error: error.code || error.message });
    }
  });
});
};
