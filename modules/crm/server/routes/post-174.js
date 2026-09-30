'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/wallet/topup/staff-approve', __westoModuleContext.requireAuth, async (req, res) => {
  const role = __westoModuleContext.effectiveRole(req.user);
  if (!['cashier', 'waiter', 'manager', 'owner', 'admin'].includes(role)) {
    return res.status(403).json({ error: 'تأیید شارژ کیف پول فقط با دسترسی گارسون، صندوقدار یا مدیریت مجاز است.' });
  }

  const { requestId, trackingCode, phone, amountToman, packageId, paymentTender = 'CASH', notes } = req.body || {};
  let targetPhone = phone;
  let targetAmount = amountToman;
  let targetPackageId = packageId;
  let targetRequest = null;

  if (requestId || trackingCode) {
    targetRequest = (__westoModuleContext.db.walletTopupRequests || []).find((r) => (requestId && r.id === requestId) || (trackingCode && r.trackingCode === String(trackingCode).trim()));
    if (targetRequest) {
      targetPhone = targetRequest.phone;
      targetAmount = targetRequest.amountToman;
      targetPackageId = targetRequest.packageId;
    }
  }

  if (targetRequest?.status === 'completed') {
    // Replays of a completed in-store request are idempotent and must never
    // mint a second wallet credit.  The stable source id below is also the
    // Finance V2 idempotency boundary used for the first approval.
    const sourceId = `STAFF-${targetRequest.id}`;
    const event = (__westoModuleContext.db.financeV2?.events || []).find((item) => item.source === 'wallet.topup' && item.sourceId === sourceId);
    if (!event || event.status !== 'posted') return res.status(409).json({ error: 'wallet_topup_finance_missing' });
    return res.json({
      ok: true, approved: true, idempotent: true,
      newBalance: __westoModuleContext.walletEngine.getWalletBalance(__westoModuleContext.db, targetRequest.phone),
      totalCredit: Number(targetRequest.totalCredit) || Number(targetRequest.amountToman) || 0,
      bonusToman: Number(targetRequest.bonusToman) || 0,
      phone: targetRequest.phone,
      finance: { event },
    });
  }
  if (targetRequest && (targetRequest.channel !== 'instore_staff' || targetRequest.status !== 'pending_staff_approval')) {
    return res.status(409).json({ error: 'wallet_topup_request_not_approvable' });
  }

  if (!targetPhone) {
    return res.status(400).json({ error: 'شماره مشتری یا کد پیگیری درخواست الزامی است.' });
  }

  let finalAmount = Math.max(0, Math.round(Number(targetAmount) || 0));
  if (targetPackageId) {
    const pack = __westoModuleContext.walletEngine.getWalletPackages(__westoModuleContext.db).find((p) => p.id === targetPackageId);
    if (pack) finalAmount = pack.amountToman;
  }

  if (finalAmount <= 0) {
    return res.status(400).json({ error: 'مبلغ شارژ نامعتبر است.' });
  }

  let branchId;
  try { branchId = Number(targetRequest?.branchId) || __westoModuleContext.parseBranchId(req); if (targetRequest?.branchId) __westoModuleContext.assertUserBranchAccess(req.user, targetRequest.branchId); } catch (error) { return res.status(error.status || 400).json({ error: error.code || 'branch_invalid', message: error.message }); }
  if (!branchId) return res.status(400).json({ error: 'wallet_topup_branch_required' });

  const approverInfo = {
    phone: req.user.phone,
    role,
    roleLabel: role === 'cashier' ? 'صندوقدار' : role === 'waiter' ? 'گارسون' : 'مدیریت',
    name: req.user.name || (role === 'cashier' ? 'صندوقدار' : 'گارسون'),
  };

  // Request-backed approvals use a stable reference.  A timestamp here would
  // turn a repeated approval of the same request into a second Finance event.
  const reference = targetRequest ? `STAFF-${targetRequest.id}` : `STAFF-${role.toUpperCase()}-${Date.now()}`;
  let result;
  try {
    const bonusInfo = __westoModuleContext.walletEngine.calculateTopupBonus(finalAmount, __westoModuleContext.walletEngine.getWalletPackages(__westoModuleContext.db));
    result = await __westoModuleContext.applyWalletTopupWithFinance(req, { branchId, amountToman: finalAmount, bonusToman: targetRequest?.bonusToman ?? bonusInfo.bonusToman, packageId: targetPackageId, phone: targetPhone, paymentMethod: paymentTender === 'POS' ? 'pos_card' : 'cash_in_store', reference, actor: `${approverInfo.roleLabel} (${req.user.phone})` }, () => {
      const value = __westoModuleContext.walletEngine.topupWallet(__westoModuleContext.db, { phone: targetPhone, amountToman: finalAmount, packageId: targetPackageId, paymentMethod: paymentTender === 'POS' ? 'pos_card' : 'cash_in_store', reference, actor: `${approverInfo.roleLabel} (${req.user.phone})` });
      if (targetRequest) { targetRequest.status = 'completed'; targetRequest.approvedAt = new Date().toISOString(); targetRequest.approvedBy = approverInfo; }
      return value;
    });
  } catch (error) { return res.status(error.status || 409).json({ error: error.code || 'wallet_topup_failed', message: error.message }); }

  __westoModuleContext.recordAudit(req, 'wallet.staff_approved', 'user', targetPhone, {
    amountToman: finalAmount,
    totalCredit: result.totalCredit,
    approvedBy: approverInfo,
    paymentTender,
    notes,
  });

  try {
    __westoModuleContext.smsEngine.sendSms(__westoModuleContext.db, {
      phone: targetPhone,
      name: '',
      templateKey: 'wallet_topup',
      vars: { name: 'مشتری گرامی', amount: finalAmount, wallet_balance: result.newBalance },
      triggerType: 'event',
    });
  } catch (_) {}

  res.json({
    ok: true,
    approved: true,
    approver: approverInfo,
    newBalance: result.newBalance,
    totalCredit: result.totalCredit,
    bonusToman: result.bonusToman,
    phone: targetPhone,
  });
});
};
