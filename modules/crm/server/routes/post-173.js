'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/wallet/topup/gateway-verify', __westoModuleContext.requireAuth, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(503).json({ error: 'wallet_online_gateway_not_configured', message: 'تأیید شارژ فقط پس از اتصال امن به درگاه واقعی امکان‌پذیر است.' });
  }
  const { requestId, gatewayToken } = req.body || {};
  const request = (__westoModuleContext.db.walletTopupRequests || []).find((r) => (requestId && r.id === requestId) || (gatewayToken && r.gatewayToken === gatewayToken));

  if (!request) {
    return res.status(404).json({ error: 'درخواست درگاه یافت نشد.' });
  }

  // A gateway request is customer-owned.  Without this check any signed-in
  // customer who obtains another request id/token could credit a different
  // wallet.  Branch access is checked too for staff sessions so a scoped
  // operator cannot confirm a request from another branch.
  if (String(request.phone || '') !== String(req.user.phone || '')) {
    return res.status(403).json({ error: 'wallet_topup_request_owner_mismatch' });
  }
  try {
    __westoModuleContext.assertUserBranchAccess(req.user, request.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message });
  }

  if (request.status === 'completed') {
    const eventSourceId = `GW-${String(request.authority || request.trackingCode)}`;
    const event = (__westoModuleContext.db.financeV2?.events || []).find((item) => item.source === 'wallet.topup' && item.sourceId === eventSourceId);
    if (!event || event.status !== 'posted') return res.status(409).json({ error: 'wallet_topup_finance_missing' });
    return res.json({ ok: true, message: 'این شارژ قبلاً تایید و اعمال شده است.', newBalance: __westoModuleContext.walletEngine.getWalletBalance(__westoModuleContext.db, request.phone), finance: { event } });
  }

  if (!gatewayToken || request.gatewayToken !== gatewayToken) {
    return res.status(403).json({ error: 'توکن تأییدیه درگاه بانکی نامعتبر است.' });
  }

  const branchId = Number(request.branchId) || null;
  if (!branchId) return res.status(400).json({ error: 'wallet_topup_branch_required' });
  let result;
  try {
    result = await __westoModuleContext.applyWalletTopupWithFinance(req, { branchId, amountToman: request.amountToman, bonusToman: request.bonusToman, packageId: request.packageId, phone: request.phone, paymentMethod: 'online_gateway', reference: `GW-${request.authority || request.trackingCode}`, actor: 'تاییدیه درگاه بانکی' }, () => {
      const value = __westoModuleContext.walletEngine.topupWallet(__westoModuleContext.db, { phone: request.phone, amountToman: request.amountToman, packageId: request.packageId, paymentMethod: 'online_gateway', reference: `GW-${request.authority || request.trackingCode}`, actor: 'تاییدیه درگاه بانکی' });
      request.status = 'completed'; request.approvedAt = new Date().toISOString();
      request.approvedBy = { role: 'payment_gateway', name: 'تاییدیه درگاه بانکی شاپرک', ref: request.authority };
      return value;
    });
  } catch (error) { return res.status(error.status || 409).json({ error: error.code || 'wallet_topup_failed', message: error.message }); }

  try {
    __westoModuleContext.smsEngine.sendSms(__westoModuleContext.db, {
      phone: request.phone,
      name: request.customerName,
      templateKey: 'wallet_topup',
      vars: { name: request.customerName, amount: request.amountToman, wallet_balance: result.newBalance },
      triggerType: 'event',
    });
  } catch (_) {}

  res.json({ ok: true, verified: true, ...result, request });
});
};
