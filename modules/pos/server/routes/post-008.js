'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/cashier/drawer/open', __westoModuleContext.requireCapability('cash.manage'), async (req, res) => {
  const branchId = __westoModuleContext.parseBranchId(req) || __westoModuleContext.defaultBranch()?.id || 1;
  const openingAmount = __westoModuleContext.parseCashDrawerAmount(req.body?.openingAmount, { allowZero: true });
  if (openingAmount == null) return res.status(400).json({ error: 'cash_amount_invalid' });
  const queueKey = __westoModuleContext.cashDrawerMutationQueueKey(req, branchId);
  return __westoModuleContext.withCashDrawerMutationLock(queueKey, async () => {
    if (!__westoModuleContext.activeStaffShift(req.user, branchId)) {
      return res.status(409).json({ error: 'staff_shift_not_open' });
    }
    const existing = __westoModuleContext.activeCashSession(req.user, branchId);
    const retry = __westoModuleContext.cashDrawerOpenRetry(existing, openingAmount);
    if (retry.kind === 'conflict') {
      return res.status(409).json({ error: 'cash_drawer_opening_conflict', session: retry.session });
    }
    if (retry.kind === 'duplicate') {
      const totals = __westoModuleContext.cashSessionTotals(retry.session);
      if (!totals) return res.status(409).json({ error: 'cash_drawer_ledger_invalid' });
      return res.json({ ok: true, idempotent: true, session: retry.session, totals });
    }
    const snapshot = __westoModuleContext.snapshotFinanceMutationState();
    const session = {
      id: __westoModuleContext.nextId(__westoModuleContext.db.cashSessions),
      phone: req.user.phone,
      branchId,
      openingAmount,
      openedAt: new Date().toISOString(),
      closedAt: null,
      movements: [],
    };
    try {
      __westoModuleContext.db.cashSessions.unshift(session);
      __westoModuleContext.recordAudit(req, 'cash_drawer.opened', 'cash_session', session.id, { openingAmount }, branchId);
      await __westoModuleContext.persistFinanceMutation(snapshot);
      return res.status(201).json({ ok: true, session, totals: __westoModuleContext.cashSessionTotals(session) });
    } catch (error) {
      __westoModuleContext.restoreFinanceMutationState(snapshot);
      return res.status(error.status || 503).json({ error: error.code || error.message });
    }
  });
});
};
