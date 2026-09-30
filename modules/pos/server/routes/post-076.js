'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/cashier/orders/:id/apply-loyalty', __westoModuleContext.requireCapability('orders.manage'), __westoModuleContext.serializeOrderMutationRoute(async (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (__westoModuleContext.db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  // Loyalty preview/apply returns the order and can mutate its total. It must
  // obey the same branch boundary as settlement and order editing, including
  // when the caller omits a branchId from the optional body.
  try {
    __westoModuleContext.assertUserBranchAccess(req.user, order.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  const phone = __westoModuleContext.normalizeDigits(req.body?.phone || order.phone || '').trim();
  const redeemPoints = Number(__westoModuleContext.normalizeDigits(String(req.body?.redeemPoints || '0')).replace(/\D/g, '')) || 0;
  if (redeemPoints > 0) {
    return res.status(409).json({ error: 'loyalty_redemption_requires_settlement', message: 'استفاده از امتیاز تا زمان پیاده‌سازی رزرو و ثبت اتمیک در تسویه غیرفعال است.' });
  }

  const authorizedCustomer = phone && (req.user?.phone === phone || __westoModuleContext.userCan(req.user, 'orders.manage'));
  const user = authorizedCustomer ? (__westoModuleContext.db.users || []).find((u) => u.phone === phone) : null;
  const discounts = __westoModuleContext.loyaltyEngine.calculateOrderDiscounts(__westoModuleContext.db, {
    subtotalToman: order.subtotal,
    phone: user ? phone : '',
    user,
    redeemPoints: 0,
  });

  if (req.body?.apply) {
    const amountPaid = Math.max(0, Number(order.amountPaid) || 0);
    const nextTotal = Math.max(0, Number(order.subtotal || 0) + Number(order.deliveryFee || 0) - discounts.totalDiscountToman);
    if (nextTotal < amountPaid) return res.status(409).json({ error: 'order_edit_refund_required', amountPaid, nextTotal });
    const snapshot = __westoModuleContext.snapshotFinanceMutationState();
    try {
    order.phone = phone || order.phone;
    if (user?.name && !order.name) order.name = user.name;
    order.tierDiscountToman = discounts.tierDiscountToman;
    order.pointsRedeemed = 0;
    order.pointsDiscountToman = discounts.pointsDiscountToman;
    order.loyaltyTier = discounts.tier?.id || 'bronze';
    order.discount = discounts.totalDiscountToman;
    order.total = nextTotal;
    order.amountPaid = amountPaid;
    order.balanceDue = Math.max(0, nextTotal - amountPaid);
    __westoModuleContext.recordAudit(req, 'order.loyalty_discount_applied', 'order', order.id, { tierDiscountToman: discounts.tierDiscountToman, pointsRedeemed: 0 }, order.branchId);
    await __westoModuleContext.persistFinanceMutation(snapshot);
    try { __westoModuleContext.publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status, edited: true }); }
    catch (eventError) { console.error('[loyalty-discount] post-commit event failed', eventError?.message || eventError); }
    } catch (error) {
      __westoModuleContext.restoreFinanceMutationState(snapshot);
      return res.status(error.status || 503).json({ error: error.code || 'order_persistence_failed', message: error.message });
    }
  }

  res.json({
    ok: true,
    order: __westoModuleContext.operationalOrderResponse(order, req.user),
    discounts,
    customer: user && __westoModuleContext.userCan(req.user, 'pii.view')
      ? {
          name: user.name,
          phone: user.phone,
          points: user.points,
          walletBalance: __westoModuleContext.walletEngine.getWalletBalance(__westoModuleContext.db, user.phone),
          tier: discounts.tier,
        }
      : null,
  });
}));
};
