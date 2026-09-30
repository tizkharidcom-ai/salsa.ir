'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/wallet/topup', __westoModuleContext.requireAuth, async (req, res) => {
  const role = __westoModuleContext.effectiveRole(req.user);
  const isStaff = ['cashier', 'waiter', 'manager', 'owner', 'admin'].includes(role);
  const { gatewayToken, reference } = req.body || {};

  let matchedGatewayRequest = null;
  if (!isStaff) {
    if (gatewayToken) {
      matchedGatewayRequest = (__westoModuleContext.db.walletTopupRequests || []).find(
        (r) => r.gatewayToken === gatewayToken && r.phone === req.user.phone && r.status === 'pending_gateway'
      );
    }
    if (!matchedGatewayRequest) {
      return res.status(403).json({
        error: 'شارژ کیف پول صرفاً با تأیید پرسنل مجاز یا دریافت تاییدیه معتبر درگاه بانکی امکان‌پذیر است.',
        requiresVerification: true,
      });
    }
  }

  const phone = (isStaff && req.body.phone) ? req.body.phone : req.user.phone;
  const amountToman = Math.max(0, Math.round(Number(req.body.amountToman || req.body.amount) || 0));
  const packageId = req.body.packageId ? String(req.body.packageId).trim() : null;
  const paymentMethod = req.body.paymentMethod || (isStaff ? 'in_store_staff' : 'online_gateway');

  if (!amountToman && !packageId) {
    return res.status(400).json({ error: 'مبلغ شارژ یا شناسه بسته الزامی است.' });
  }

  let finalAmount = amountToman;
  if (packageId) {
    const pack = __westoModuleContext.walletEngine.getWalletPackages(__westoModuleContext.db).find((p) => p.id === packageId);
    if (pack) finalAmount = pack.amountToman;
  }

  if (finalAmount <= 0) {
    return res.status(400).json({ error: 'مبلغ شارژ نامعتبر است.' });
  }

  let branchId;
  try { branchId = __westoModuleContext.parseBranchId(req); } catch (error) { return res.status(error.status || 400).json({ error: error.code || 'branch_invalid', message: error.message }); }
  if (!branchId) return res.status(400).json({ error: 'wallet_topup_branch_required' });

  const financeReference = (isStaff && reference)
    ? reference
    : (matchedGatewayRequest ? `GW-${matchedGatewayRequest.authority || matchedGatewayRequest.trackingCode}` : (isStaff ? `STAFF-${role.toUpperCase()}-${Date.now()}` : `GW-${Date.now()}`));

  let result;
  try {
    const bonusInfo = __westoModuleContext.walletEngine.calculateTopupBonus(finalAmount, __westoModuleContext.walletEngine.getWalletPackages(__westoModuleContext.db));
    result = await __westoModuleContext.applyWalletTopupWithFinance(req, { branchId, amountToman: finalAmount, bonusToman: bonusInfo.bonusToman, packageId, phone, paymentMethod, reference: financeReference, actor: isStaff ? `${role} (${req.user.phone})` : (req.user.phone || 'customer') }, () => {
      const topupVal = __westoModuleContext.walletEngine.topupWallet(__westoModuleContext.db, {
        phone, amountToman: finalAmount, packageId, paymentMethod, reference: financeReference,
        actor: isStaff ? `${role} (${req.user.phone})` : (req.user.phone || 'customer'),
      });
      if (matchedGatewayRequest) {
        matchedGatewayRequest.status = 'completed';
        matchedGatewayRequest.approvedAt = new Date().toISOString();
        matchedGatewayRequest.approvedBy = { role: 'payment_gateway', name: 'تاییدیه درگاه بانکی شاپرک', ref: matchedGatewayRequest.authority };
      }
      return topupVal;
    });
  } catch (error) { return res.status(error.status || 409).json({ error: error.code || 'wallet_topup_failed', message: error.message }); }

  try {
    __westoModuleContext.smsEngine.sendSms(__westoModuleContext.db, {
      phone,
      name: req.user?.name || '',
      templateKey: 'wallet_topup',
      vars: {
        name: req.user?.name || 'مشتری گرامی',
        amount: finalAmount,
        wallet_balance: result.newBalance,
      },
      triggerType: 'event',
    });
  } catch (_) {}

  res.json({ ok: true, ...result });
});
};
