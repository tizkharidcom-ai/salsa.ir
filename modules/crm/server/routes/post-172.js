'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/wallet/topup/request', __westoModuleContext.requireAuth, (req, res) => {
  const phone = req.user.phone;
  const user = (__westoModuleContext.db.users || []).find((u) => u.phone === phone) || req.user;
  const amountToman = Math.max(0, Math.round(Number(req.body.amountToman || req.body.amount) || 0));
  const packageId = req.body.packageId ? String(req.body.packageId).trim() : null;
  const channel = req.body.channel === 'instore_staff' ? 'instore_staff' : 'online_gateway';
  if (channel === 'online_gateway' && process.env.NODE_ENV === 'production') {
    return res.status(503).json({ error: 'wallet_online_gateway_not_configured', message: 'شارژ آنلاین تا اتصال و تأیید واقعی درگاه بانکی در دسترس نیست؛ از شارژ حضوری استفاده کنید.' });
  }
  let branchId;
  try { branchId = __westoModuleContext.parseBranchId(req); } catch (error) { return res.status(error.status || 400).json({ error: error.code || 'branch_invalid', message: error.message }); }
  if (!branchId) return res.status(400).json({ error: 'wallet_topup_branch_required' });

  let finalAmount = amountToman;
  const packages = __westoModuleContext.walletEngine.getWalletPackages(__westoModuleContext.db);
  if (packageId) {
    const pack = packages.find((p) => p.id === packageId);
    if (pack) finalAmount = pack.amountToman;
  }

  if (finalAmount <= 0) {
    return res.status(400).json({ error: 'مبلغ شارژ یا شناسه بسته معتبر نیست.' });
  }

  const bonusInfo = __westoModuleContext.walletEngine.calculateTopupBonus(finalAmount, packages);
  const requestId = `wtop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const trackingCode = __westoModuleContext.generateShortTrackingCode();
  const gatewayToken = `gw_tok_${Math.random().toString(36).slice(2, 12)}`;

  const topupRequest = {
    id: requestId,
    trackingCode,
    phone,
    customerName: user.name || 'مشتری گرامی',
    amountToman: finalAmount,
    bonusToman: bonusInfo.bonusToman,
    totalCredit: bonusInfo.totalCreditToman,
    packageId,
    channel,
    status: channel === 'online_gateway' ? 'pending_gateway' : 'pending_staff_approval',
    gatewayToken,
    authority: `AU_${Date.now()}_${trackingCode}`,
    createdAt: new Date().toISOString(),
    approvedBy: null,
    approvedAt: null,
    tableNo: req.body.tableNo || null,
    branchId,
  };

  __westoModuleContext.db.walletTopupRequests.unshift(topupRequest);
  __westoModuleContext.db.walletTopupRequests = __westoModuleContext.db.walletTopupRequests.slice(0, 1000);
  __westoModuleContext.save();

  res.json({
    ok: true,
    request: {
      id: topupRequest.id,
      trackingCode: topupRequest.trackingCode,
      amountToman: topupRequest.amountToman,
      bonusToman: topupRequest.bonusToman,
      totalCredit: topupRequest.totalCredit,
      channel: topupRequest.channel,
      status: topupRequest.status,
      authority: topupRequest.authority,
      gatewayToken: topupRequest.gatewayToken,
      instructions: channel === 'instore_staff'
        ? `کد پیگیری شما ${trackingCode} است. لطفاً برای پرداخت نقدی یا کارتخوان، این کد را به گارسون یا صندوقدار اعلام نمایید.`
        : 'در حال اتصال به درگاه بانکی جهت پرداخت و دریافت تاییدیه…',
    },
  });
});
};
