'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/orders/my-orders', __westoModuleContext.requireAuth, (req, res) => {
  const userOrders = (__westoModuleContext.db.orders || [])
    .filter((o) => __westoModuleContext.customerOwnsHistoryOrder(o, req.user))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const tierInfo = __westoModuleContext.loyaltyEngine.resolveCustomerTier(__westoModuleContext.db, req.user);

  const mapped = userOrders.map((o) => {
    const totalAmount = Number(o.total || o.finalTotal || o.subtotal || 0);
    const calculatedPoints = __westoModuleContext.loyaltyEngine.calculateOrderPointsEarned(__westoModuleContext.db, totalAmount, tierInfo.tier);
    return {
      ...__westoModuleContext.customerOrderStatusProjection(o),
      id: o.id,
      orderNo: o.orderNo || `W-${o.id}`,
      createdAt: o.createdAt || new Date().toISOString(),
      fulfillment: o.fulfillment || 'dine_in',
      items: Array.isArray(o.items) ? o.items.map((it) => ({
        id: it.id || it.menuItemId || it.itemId || null,
        menuItemId: it.menuItemId || it.id || it.itemId || null,
        name: it.name || it.title || 'محصول منو',
        quantity: Number(it.quantity || it.qty || 1),
        price: Number(it.price || 0),
        total: Number(it.price || 0) * Number(it.quantity || it.qty || 1),
      })) : [],
      total: totalAmount,
      subtotal: Number(o.subtotal || o.total || 0),
      discount: Number(o.discount || o.loyaltyDiscount || 0),
      pointsEarned: o.pointsEarned !== undefined ? Number(o.pointsEarned) : calculatedPoints,
      paymentMethod: o.paymentMethod || o.tender || (o.paidWithWallet ? 'کیف پول' : 'آنلاین'),
      tableNo: o.tableNo || null,
      delivery: o.delivery || null,
    };
  });

  res.json({ ok: true, orders: mapped });
});
};
