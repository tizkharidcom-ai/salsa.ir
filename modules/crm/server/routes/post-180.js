'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/admin/wallet/adjust', __westoModuleContext.requireOwner, async (req, res) => {
  const phone = __westoModuleContext.normalizeDigits(req.body.phone || '').trim();
  const rawDelta = req.body.deltaToman ?? req.body.delta;
  const parsedDelta = typeof rawDelta === 'number'
    ? rawDelta
    : Number(__westoModuleContext.normalizeDigits(String(rawDelta || '')).replace(/[,٬_\s]/g, '').trim());
  const deltaToman = Math.round(parsedDelta || 0);
  const reason = String(req.body.reason || 'تعدیل دستی توسط مدیر').slice(0, 120);
  const key = String(req.get('Idempotency-Key') || '').trim();

  if (!__westoModuleContext.PHONE_RE.test(phone)) return res.status(400).json({ error: 'شماره موبایل معتبر نیست.' });
  if (!deltaToman) return res.status(400).json({ error: 'مبلغ تغییر نمی‌تواند صفر باشد.' });
  if (!key) return res.status(400).json({ error: 'کلید Idempotency-Key الزامی است.' });

  let branchId;
  try { branchId = __westoModuleContext.parseBranchId(req); } catch (error) {
    return res.status(error.status || 400).json({ error: error.code || 'branch_invalid', message: error.message });
  }
  if (!branchId) return res.status(400).json({ error: 'wallet_adjust_branch_required' });

  const snapshot = __westoModuleContext.snapshotFinanceMutationState();
  try {
    const result = __westoModuleContext.financeV2.captureWalletAdjustment(__westoModuleContext.db, {
      branchId,
      phone,
      deltaToman,
      reason,
      sourceId: `MANUAL-${key}`,
      reference: `MANUAL-${key}`,
    }, {
      actor: req.user?.phone || 'admin',
      idempotencyKey: key,
      applyWallet: ({ event }) => {
        const walletResult = __westoModuleContext.walletEngine.adjustWallet(__westoModuleContext.db, {
          phone,
          deltaToman,
          reason,
          actor: req.user?.phone || 'admin',
        });
        if (walletResult.adjustEntry) {
          walletResult.adjustEntry.meta = { ...(walletResult.adjustEntry.meta || {}), financeEventId: event.id };
        }
        return walletResult;
      },
    });
    if (result.blocked || !result.journalEntry) {
      throw Object.assign(new Error('تعدیل کیف‌پول تا ثبت سند مالی قابل تکمیل نیست.'), {
        code: result.event?.error?.code || 'wallet_adjust_finance_blocked', status: 409,
      });
    }
    __westoModuleContext.recordAudit(req, 'wallet.adjusted', 'user', phone, { deltaToman, reason, branchId, financeEventId: result.event.id }, branchId);
    await __westoModuleContext.persistFinanceMutation(snapshot);
    return res.json({ ok: true, ...result.walletResult, finance: { event: result.event, journalEntry: result.journalEntry, idempotentReplay: result.idempotentReplay } });
  } catch (error) {
    __westoModuleContext.restoreFinanceMutationState(snapshot);
    return res.status(error.status || 409).json({ error: error.code || 'wallet_adjust_failed', message: error.message });
  }
});
};
