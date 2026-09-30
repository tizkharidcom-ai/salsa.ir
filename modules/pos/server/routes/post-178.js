'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/orders/:id/pay-wallet', __westoModuleContext.requireAuth, __westoModuleContext.serializeOrderMutationRoute(async (req, res) => {
  const persistenceReadiness = __westoModuleContext.settlementPersistenceGate.check({
    postgresEnabled: __westoModuleContext.stateStore.enabled,
    postgresRequired: __westoModuleContext.stateStore.required,
  });
  if (!persistenceReadiness.ok) {
    return res.status(persistenceReadiness.status).json({ error: persistenceReadiness.code, message: persistenceReadiness.message });
  }
  const orderId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (__westoModuleContext.db.orders || []).find((o) => Number(o.id) === orderId);
  if (!order) return res.status(404).json({ error: 'سفارش یافت نشد.' });
  const branchId = __westoModuleContext.persistedOrderBranchId(order);
  if (!branchId) return res.status(409).json({ error: 'order_branch_unresolved', message: 'شعبهٔ ثبت‌شدهٔ سفارش معتبر نیست؛ پرداخت تا تطبیق شعبه انجام نمی‌شود.' });

  const phone = __westoModuleContext.normalizeDigits(req.user?.phone || '').trim();
  if (!phone) return res.status(400).json({ error: 'شماره مشتری برای پرداخت کیف پول مشخص نیست.' });
  if (order.phone && __westoModuleContext.normalizeDigits(order.phone).trim() !== phone) {
    return res.status(403).json({ error: 'این سفارش به حساب مشتری دیگری تعلق دارد.' });
  }
  if (!order.phone) return res.status(409).json({ error: 'سفارش شماره مشتری قابل پرداخت از کیف پول ندارد.' });

  const idempotencyKey = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
  if (process.env.NODE_ENV === 'production' && !idempotencyKey) {
    return res.status(400).json({ error: 'settlement_idempotency_required', message: 'برای ثبت پرداخت، کلید یکتای درخواست لازم است.' });
  }
  if (idempotencyKey && !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(idempotencyKey)) {
    return res.status(400).json({ error: 'settlement_idempotency_invalid' });
  }
  const inFlightKey = idempotencyKey ? __westoModuleContext.settlementLockKey(req, order, idempotencyKey, branchId) : null;
  const requestFingerprint = idempotencyKey ? __westoModuleContext.checkoutIdempotencyFingerprint({ orderId: order.id, branchId, action: 'wallet-pay-remaining' }, req.user) : null;
  const existingWalletPayment = idempotencyKey
    ? (Array.isArray(order.partialPayments) ? order.partialPayments : []).find((payment) => payment.idempotencyKey === idempotencyKey)
    : null;
  if (existingWalletPayment) {
    if (!__westoModuleContext.isSettlementRequestFingerprint(existingWalletPayment.requestFingerprint)) {
      return res.status(409).json({ error: 'idempotency_replay_unavailable', message: 'اثر انگشت پرداخت کیف پول موجود نیست؛ برای جلوگیری از برداشت تکراری، ابتدا سابقهٔ کیف پول و سفارش را تطبیق دهید.' });
    }
    if (existingWalletPayment.requestFingerprint !== requestFingerprint) {
      return res.status(409).json({ error: 'idempotency_key_conflict', message: 'این کلید برای درخواست پرداخت دیگری استفاده شده است.' });
    }
    const pending = __westoModuleContext.settlementInFlight.get(inFlightKey);
    if (pending) {
      const outcome = await pending;
      if (!outcome.ok) return res.status(outcome.status || 503).json({ error: outcome.error || 'finance_persistence_failed', message: outcome.message });
    }
    return res.json({
      ok: true,
      idempotent: true,
      order: __westoModuleContext.operationalOrderResponse(order, req.user),
      payment: __westoModuleContext.operationalPaymentResponse(existingWalletPayment, req.user),
    });
  }
  if (order.paymentStatus === 'unknown') {
    return res.status(409).json({ error: 'payment_status_reconciliation_required', message: 'وضعیت پرداخت سفارش باید پیش از برداشت از کیف پول تطبیق شود.' });
  }
  if (order.paymentStatus === 'paid') {
    return res.json({ ok: true, idempotent: true, order: __westoModuleContext.operationalOrderResponse(order, req.user) });
  }

  const existingPayments = Array.isArray(order.partialPayments) ? order.partialPayments : [];
  const settlementAmounts = __westoModuleContext.resolveSettlementAmounts({
    total: order.total,
    amountPaid: order.amountPaid,
    payments: existingPayments,
    tender: 'wallet',
  });
  if (!settlementAmounts.ok) {
    return res.status(409).json({
      error: settlementAmounts.error,
      ...(settlementAmounts.outstanding !== undefined ? { outstanding: settlementAmounts.outstanding } : {}),
      message: 'ماندهٔ پرداخت از سابقهٔ سفارش قابل‌اعتماد نیست؛ پیش از برداشت کیف پول، پرداخت‌ها را تطبیق دهید.',
    });
  }
  const { orderTotal, alreadyPaid, outstanding, requestedAmount: payableAmount } = settlementAmounts;
  if (!outstanding) {
    return res.status(409).json({ error: 'order_payment_reconciliation_required', message: 'وضعیت سفارش پرداخت‌نشده است اما مانده‌ای برای برداشت وجود ندارد؛ ابتدا وضعیت را تطبیق دهید.' });
  }
  const currentBalance = __westoModuleContext.walletEngine.getWalletBalance(__westoModuleContext.db, phone);

  if (currentBalance < payableAmount) {
    return res.status(400).json({
      error: `موجودی کیف پول (${currentBalance.toLocaleString('fa-IR')} تومان) برای پرداخت ماندهٔ این فاکتور (${payableAmount.toLocaleString('fa-IR')} تومان) کافی نیست.`,
      currentBalance,
      required: payableAmount,
    });
  }

  // Wallet debit, order state, Finance V2 capture, loyalty and cashback form
  // one user-visible payment. Never leave a deducted wallet behind when the
  // fiscal period is closed or the sale cannot be posted.
  const snapshot = __westoModuleContext.snapshotFinanceMutationState();
  let resolveWalletPayment;
  let walletPaymentPromise;
  let paymentResult;
  let financeResult;
  let cashbackAmount = 0;
  try {
    paymentResult = __westoModuleContext.walletEngine.payFromWallet(__westoModuleContext.db, {
      phone,
      amountToman: payableAmount,
      orderId: order.id,
      orderNo: order.orderNo,
      actor: req.user?.phone || 'customer',
    });

    // Mark order paid with wallet tender only inside the same rollback scope.
    const fullyPaid = alreadyPaid + payableAmount >= orderTotal;
    order.paymentStatus = fullyPaid ? 'paid' : 'partial';
    order.paymentMethod = 'wallet';
    order.paymentTender = 'wallet';
    if (fullyPaid && !order.paidAt) order.paidAt = new Date().toISOString();
    order.partialPayments = Array.isArray(order.partialPayments) ? order.partialPayments : [];
    if (!order.partialPayments.some((row) => String(row.id || '') === String(paymentResult.paymentEntry.id))) {
      order.partialPayments.push({
        id: paymentResult.paymentEntry.id,
        tender: 'wallet',
        amount: payableAmount,
        at: order.paidAt || new Date().toISOString(),
        by: req.user?.phone || 'customer',
        ...(idempotencyKey ? { idempotencyKey, requestFingerprint } : {}),
      });
    }
    order.amountPaid = alreadyPaid + payableAmount;
    order.paymentTenders = [...new Set(order.partialPayments.map((row) => row.tender).filter(Boolean))];
    if (fullyPaid) {
      const nextStatus = __westoModuleContext.nextOrderStatusAfterPayment(order);
      if (nextStatus && __westoModuleContext.canTransitionOrder(order, nextStatus)) {
        __westoModuleContext.appendOrderStatus(order, nextStatus, req.user || null, { source: 'wallet' });
      } else if (__westoModuleContext.normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo }) !== 'delivery'
          && ['pending', 'pending_cashier'].includes(String(order.status || ''))) {
        __westoModuleContext.appendOrderStatus(order, 'paid', req.user || null, { source: 'wallet' });
      }
    }

    financeResult = __westoModuleContext.financeV2.capturePaidOrder(__westoModuleContext.db, order, {
      actor: req.user?.phone || 'customer-wallet',
      idempotencyKey: `order:${branchId}:${order.id}:wallet-payment`,
    });
    if (!financeResult?.journalEntry || financeResult.journalEntry.status !== 'posted') {
      const captureCode = financeResult?.event?.error?.code || 'finance_capture_blocked';
      throw Object.assign(new Error('پرداخت ثبت نشد چون سند فروش در دفتر مالی ثبت نشد.'), {
        code: captureCode,
        status: 409,
        details: financeResult?.event?.error || null,
      });
    }

    // Award order loyalty points and cashback only after the sale journal is
    // confirmed; these credits must not survive a failed accounting capture.
    __westoModuleContext.maybeAwardOrderLoyalty(order);
    const user = (__westoModuleContext.db.users || []).find((u) => u.phone === phone);
    const tierInfo = __westoModuleContext.loyaltyEngine.resolveCustomerTier(__westoModuleContext.db, user);
    const cashbackPct = tierInfo.discountPct || 3;
    cashbackAmount = Math.round((payableAmount * cashbackPct) / 100);
    if (cashbackAmount > 0) {
      __westoModuleContext.walletEngine.awardWalletCashback(__westoModuleContext.db, {
        phone,
        amountToman: cashbackAmount,
        orderId: order.id,
        cashbackPct,
        actor: 'system',
      });
    }
    if (idempotencyKey) {
      walletPaymentPromise = new Promise((resolve) => { resolveWalletPayment = resolve; });
      __westoModuleContext.settlementInFlight.set(inFlightKey, walletPaymentPromise);
    }
    await __westoModuleContext.persistFinanceMutation(snapshot);
  } catch (error) {
    __westoModuleContext.restoreFinanceMutationState(snapshot);
    if (walletPaymentPromise) {
      resolveWalletPayment?.({ ok: false, status: error.status || 503, error: error.code || error.message, message: error.message });
      __westoModuleContext.settlementInFlight.delete(inFlightKey);
    }
    return res.status(error.status || 503).json({
      error: error.code || error.message,
      ...(__westoModuleContext.userCan(req.user, 'payments.manage') && error.details ? { details: error.details } : {}),
    });
  }

  try {
    __westoModuleContext.publishOperationalEvent('payment.updated', { orderId: order.id, branchId: order.branchId, status: order.paymentStatus, tender: 'wallet' });
    __westoModuleContext.publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status });
  } catch (eventError) { console.error('[wallet-payment] post-commit event failed', eventError?.message || eventError); }
  resolveWalletPayment?.({ ok: true });
  if (inFlightKey) __westoModuleContext.settlementInFlight.delete(inFlightKey);

  res.json({
    ok: true,
    order: __westoModuleContext.operationalOrderResponse(order, req.user),
    paymentResult: {
      ok: paymentResult?.ok === true,
      amountPaid: paymentResult?.amountPaid ?? null,
      newBalance: paymentResult?.newBalance ?? null,
    },
    ...(__westoModuleContext.userCan(req.user, 'payments.manage') ? { finance: financeResult } : {}),
    cashbackAwarded: cashbackAmount,
    newWalletBalance: __westoModuleContext.walletEngine.getWalletBalance(__westoModuleContext.db, phone),
  });
}));
};
