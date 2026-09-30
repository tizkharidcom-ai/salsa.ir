'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/cashier/drawer/movements', __westoModuleContext.requireCapability('cash.manage'), async (req, res) => {
  const branchId = __westoModuleContext.parseBranchId(req) || __westoModuleContext.defaultBranch()?.id || 1;
  const type = String(req.body?.type || '');
  if (!['pay_in', 'pay_out'].includes(type)) return res.status(400).json({ error: 'cash_movement_invalid' });
  const rawAmount = __westoModuleContext.parseCashDrawerAmount(req.body?.amount);
  if (rawAmount == null) return res.status(400).json({ error: 'cash_movement_amount_invalid' });
  const idempotency = __westoModuleContext.normalizeCashDrawerIdempotencyKey(req.get('Idempotency-Key'), req.body?.idempotencyKey);
  if (idempotency.error) return res.status(400).json({ error: idempotency.error });
  const note = String(req.body?.note || '').trim().slice(0, 160);
  const queueKey = __westoModuleContext.cashDrawerMutationQueueKey(req, branchId);
  return __westoModuleContext.withCashDrawerMutationLock(queueKey, async () => {
    const session = __westoModuleContext.activeCashSession(req.user, branchId);
    if (!session) return res.status(409).json({ error: 'cash_drawer_not_open' });
    const currentTotals = __westoModuleContext.cashSessionTotals(session);
    if (!currentTotals) return res.status(409).json({ error: 'cash_drawer_ledger_invalid', message: 'سابقهٔ صندوق معتبر نیست؛ تغییر جدید ثبت نشد.' });
    const amount = type === 'pay_out' ? -rawAmount : rawAmount;
    const requestFingerprint = __westoModuleContext.cashDrawerMovementFingerprint({
      tenantId: req.tenantId, branchId, sessionId: session.id, phone: req.user.phone, type, amount, note,
    });
    const retry = __westoModuleContext.findCashDrawerMovementRetry(session, idempotency.key, requestFingerprint);
    if (retry.kind === 'conflict') return res.status(409).json({ error: 'cash_movement_idempotency_conflict' });
    if (retry.kind === 'duplicate') {
      return res.json({
        ok: true, idempotent: true, movement: retry.movement, session, totals: currentTotals,
      });
    }

    if (type === 'pay_out' && __westoModuleContext.cashDrawerPayOutExceedsAvailable(currentTotals, rawAmount)) {
      return res.status(409).json({
        error: 'cash_drawer_insufficient_funds',
        available: Math.max(0, currentTotals.expected),
        requested: rawAmount,
        message: 'مبلغ خروج از وجه نقد قابل‌برداشت صندوق بیشتر است؛ مبلغ را کاهش دهید یا ورود نقدی ثبت کنید.',
      });
    }

    const projectedTotals = __westoModuleContext.cashSessionTotals({
      ...session,
      movements: [{ type, amount }, ...(Array.isArray(session.movements) ? session.movements : [])],
    });
    if (!projectedTotals) return res.status(409).json({ error: 'cash_drawer_ledger_invalid', message: 'جمع صندوق از محدودهٔ معتبر خارج می‌شود؛ تغییر ثبت نشد.' });

    const snapshot = __westoModuleContext.snapshotFinanceMutationState();
    const movement = {
      id: __westoModuleContext.nextId(session.movements), type, amount, note,
      idempotencyKey: idempotency.key, requestFingerprint,
      at: new Date().toISOString(), by: req.user.phone,
    };
    try {
      session.movements.unshift(movement);
      __westoModuleContext.recordAudit(req, `cash_drawer.${type}`, 'cash_session', session.id, { amount: movement.amount, note: movement.note }, branchId);
      const financeResult = __westoModuleContext.financeV2.captureCashMovement(__westoModuleContext.db, session, movement, { actor: req.user.phone });
      if (financeResult?.event) {
        movement.financeEventId = financeResult.event.id;
        movement.financeStatus = financeResult.event.status;
        movement.financeErrorCode = financeResult.event.error?.code || null;
      }
      await __westoModuleContext.persistFinanceMutation(snapshot);
      return res.status(201).json({ ok: true, movement, session, totals: __westoModuleContext.cashSessionTotals(session), finance: financeResult });
    } catch (error) {
      __westoModuleContext.restoreFinanceMutationState(snapshot);
      return res.status(error.status || 503).json({ error: error.code || error.message });
    }
  });
});
};
