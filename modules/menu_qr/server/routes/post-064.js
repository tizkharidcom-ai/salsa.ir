'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/checkout/quote', (req, res) => {
  const input = req.body || {};
  const selectionError = __westoModuleContext.validateExplicitCheckoutSelections(input);
  if (selectionError) return res.status(selectionError.status).json(selectionError);
  const tableNo = __westoModuleContext.normalizeDigits(String(input.tableNo || input.table || '')).trim().slice(0, 20);
  const fulfillment = __westoModuleContext.normalizeFulfillment(input.fulfillment, { tableNo });
  const branch = __westoModuleContext.findOrderBranch(input, tableNo, fulfillment);
  if (!branch || branch.active === false) return res.status(400).json({ error: 'table_or_branch_invalid', message: 'میز فعال و شعبهٔ معتبر را انتخاب کنید.' });
  const zone = fulfillment === 'delivery'
    ? (__westoModuleContext.db.deliveryZones || []).find((item) => Number(item.id) === Number(input.deliveryZoneId || input.zoneId))
    : null;
  const lineResult = __westoModuleContext.orderLinesFromRequest(input.items, { branchId: branch.id });
  if (lineResult.error) return res.status(400).json(lineResult);
  const quote = __westoModuleContext.quoteFulfillment({ fulfillment, subtotal: lineResult.subtotal, zone, branchId: branch?.id });
  if (!quote.ok) return res.status(400).json(quote);

  const paymentMethod = String(input.paymentMethod || 'cashier').trim() === 'online' ? 'online' : 'cashier';
  if (paymentMethod === 'online' && !__westoModuleContext.productionPaymentProviderReady()) {
    return res.status(503).json({ error: 'payment_provider_not_ready', message: 'پرداخت آنلاین اکنون در دسترس نیست؛ روش پرداخت دیگری انتخاب کنید.' });
  }
  const pricing = __westoModuleContext.calculateCheckoutPricing({
    input,
    actor: req.user,
    subtotal: lineResult.subtotal,
    deliveryFee: quote.deliveryFee,
  });
  if (pricing.error) return res.status(pricing.status || 400).json(pricing);

  const finalTotal = pricing.total;
  const checkoutTax = __westoModuleContext.checkoutTaxForOrder({
    branch,
    fulfillment,
    lines: lineResult.lines,
    discount: pricing.discount,
    deliveryFee: quote.deliveryFee,
    total: finalTotal,
    date: new Date(),
  });
  if (checkoutTax.error) return res.status(checkoutTax.status || 409).json(checkoutTax);
  const quoteInput = { ...input, tableNo, fulfillment, paymentMethod, phone: pricing.phone };
  const quoteIntent = __westoModuleContext.checkoutQuoteIntent({
    input: quoteInput, branch, fulfillment, lines: lineResult.lines,
    subtotal: lineResult.subtotal, deliveryFee: quote.deliveryFee,
    discount: pricing.discount, total: finalTotal, phone: pricing.phone, taxSnapshot: checkoutTax.snapshot,
  });

  res.json({
    ok: true,
    quoteToken: __westoModuleContext.createCheckoutQuoteToken(__westoModuleContext.SECRET, quoteIntent),
    fulfillment,
    subtotal: lineResult.subtotal,
    deliveryFee: quote.deliveryFee,
    discount: pricing.discount,
    tierDiscountToman: pricing.discountCalc.tierDiscountToman,
    tier: pricing.discountCalc.tier,
    pointsRedeemed: pricing.discountCalc.pointsRedeemed,
    pointsDiscountToman: pricing.discountCalc.pointsDiscountToman,
    maxRedeemablePoints: pricing.discountCalc.maxRedeemablePoints,
    availablePoints: pricing.discountCalc.availablePoints,
    total: finalTotal,
    tax: { inclusive: true, totalTaxIrr: checkoutTax.snapshot.totalTaxIrr },
    minimum: quote.minimum,
    etaMinutes: quote.etaMinutes,
    zone: quote.zone,
    branchId: branch?.id || null,
  });
});
};
