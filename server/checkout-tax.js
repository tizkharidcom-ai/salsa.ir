'use strict';

const taxEngine = require('./finance/tax-engine');

function checkoutTaxError(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

function safeScaledToman(value, label) {
  const amount = Number(value);
  const scaled = amount * 10;
  if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(scaled)) {
    throw checkoutTaxError('checkout_tax_amount_invalid', `مبلغ ${label} برای محاسبهٔ مالیات معتبر نیست.`);
  }
  return scaled;
}

function checkoutSnapshotAmountsForLegacyToman(order) {
  const snapshot = order?.taxSnapshot ?? order?.tax_snapshot;
  const branchId = order?.branchId ?? order?.branch_id;
  const orderTotal = Number(order?.total);
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.currency !== 'IRR' || snapshot.inclusive !== true
      || branchId == null || String(snapshot.branchId) !== String(branchId)
      || !Number.isSafeInteger(orderTotal) || orderTotal < 0 || !Number.isSafeInteger(orderTotal * 10)) return null;

  const amounts = ['totalTaxIrr', 'grossIrr', 'discountIrr', 'totalPayableIrr'];
  if (amounts.some((key) => !Number.isSafeInteger(snapshot[key]) || snapshot[key] < 0)) return null;
  const lines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
  if (!lines.length) return null;
  const exactAmount = (value) => Number.isSafeInteger(value) && value >= 0;
  const validRuleSnapshot = (rule) => rule && typeof rule === 'object'
    && String(rule.locationId ?? '') === String(branchId)
    && (typeof rule.id === 'string' || Number.isSafeInteger(rule.id)) && String(rule.id).trim()
    && typeof rule.code === 'string' && rule.code.trim()
    && typeof rule.legalSource === 'string' && rule.legalSource.trim()
    && Number.isSafeInteger(Number(rule.version)) && Number(rule.version) > 0
    && Number.isFinite(Number(rule.rate)) && Number(rule.rate) >= 0 && Number(rule.rate) <= 1
    && rule.inclusive === true;

  let lineGrossIrr = 0;
  let lineDiscountIrr = 0;
  let lineTaxIrr = 0;
  let lineBaseIrr = 0;
  for (const line of lines) {
    if (line?.type !== 'menu' || !String(line.taxCategory || '').trim() || !validRuleSnapshot(line.ruleSnapshot)
        || !['grossIrr', 'discountIrr', 'taxableBaseIrr', 'taxAmountIrr'].every((key) => exactAmount(line[key]))
        || line.grossIrr - line.discountIrr !== line.taxableBaseIrr + line.taxAmountIrr) return null;
    lineGrossIrr += line.grossIrr;
    lineDiscountIrr += line.discountIrr;
    lineTaxIrr += line.taxAmountIrr;
    lineBaseIrr += line.taxableBaseIrr;
  }

  let deliveryGrossIrr = 0;
  let deliveryTaxIrr = 0;
  let deliveryBaseIrr = 0;
  if (snapshot.deliveryFee != null) {
    const fee = snapshot.deliveryFee;
    if (!String(fee.taxCategory || '').trim() || !validRuleSnapshot(fee.ruleSnapshot)
        || !['grossIrr', 'taxableBaseIrr', 'taxAmountIrr'].every((key) => exactAmount(fee[key]))
        || fee.grossIrr !== fee.taxableBaseIrr + fee.taxAmountIrr) return null;
    deliveryGrossIrr = fee.grossIrr;
    deliveryTaxIrr = fee.taxAmountIrr;
    deliveryBaseIrr = fee.taxableBaseIrr;
  }

  const payableIrr = snapshot.grossIrr - snapshot.discountIrr;
  const taxIrr = lineTaxIrr + deliveryTaxIrr;
  const discountIrr = lineDiscountIrr;
  const netSalesIrr = lineBaseIrr + deliveryBaseIrr;
  if (![payableIrr, taxIrr, discountIrr, netSalesIrr, lineGrossIrr + deliveryGrossIrr].every(Number.isSafeInteger)
      || payableIrr !== snapshot.totalPayableIrr || payableIrr !== orderTotal * 10
      || snapshot.grossIrr !== lineGrossIrr + deliveryGrossIrr
      || snapshot.discountIrr !== discountIrr || snapshot.totalTaxIrr !== taxIrr
      || payableIrr !== netSalesIrr + taxIrr) return null;

  const tomanAmounts = [payableIrr, taxIrr, discountIrr, netSalesIrr];
  if (tomanAmounts.some((amount) => amount % 10 !== 0)) return null;
  return {
    orderTotalToman: payableIrr / 10,
    totalTaxToman: taxIrr / 10,
    discountToman: discountIrr / 10,
    netSalesToman: netSalesIrr / 10,
  };
}

function validateBranchRule(settings, taxCategory, { branchId, fulfillment, date }) {
  const rule = taxEngine.resolveTaxRule(settings, {
    taxCategory,
    date,
    fulfillmentType: fulfillment,
    locationId: branchId,
  });
  const isBranchRule = rule && rule.locationId != null && String(rule.locationId) === String(branchId);
  const isCurrent = rule && (!rule.effectiveFrom || String(rule.effectiveFrom).slice(0, 10) <= date)
    && (!rule.effectiveTo || String(rule.effectiveTo).slice(0, 10) >= date);
  const isActive = rule && String(rule.status || 'active').toLowerCase() === 'active';
  const hasIdentity = rule && (typeof rule.id === 'string' || Number.isSafeInteger(rule.id))
    && String(rule.id).trim() && typeof rule.code === 'string' && rule.code.trim()
    && Number.isSafeInteger(Number(rule.version)) && Number(rule.version) > 0;
  const hasSource = rule && typeof rule.legalSource === 'string' && rule.legalSource.trim();
  if (!rule || !isBranchRule || !isCurrent || !isActive || !hasIdentity || !hasSource || rule.inclusive !== true) {
    throw checkoutTaxError(
      'checkout_tax_snapshot_unavailable',
      'ثبت سفارش متوقف شد؛ برای این شعبه، گروه مالیاتی و قاعدهٔ مؤثرِ تأییدشده با قیمتِ شامل مالیات در دسترس نیست.',
    );
  }
  return rule;
}

function buildCheckoutTaxSnapshot({
  taxSettings,
  branchId,
  fulfillment,
  lines,
  discountToman = 0,
  deliveryFeeToman = 0,
  date = new Date(),
}) {
  const branchKey = String(branchId ?? '').trim();
  const numericBranchId = Number(branchKey);
  if (!branchKey || !Number.isSafeInteger(numericBranchId) || numericBranchId <= 0
      || !['dine_in', 'pickup', 'delivery'].includes(String(fulfillment || ''))) {
    throw checkoutTaxError('checkout_tax_context_invalid', 'شعبه یا روش دریافت برای محاسبهٔ مالیات معتبر نیست.');
  }
  if (!taxSettings || typeof taxSettings !== 'object' || !Array.isArray(taxSettings.rules)
      || !Array.isArray(taxSettings.categories) || typeof taxSettings.defaultCategory !== 'string'
      || !taxSettings.defaultCategory.trim()) {
    throw checkoutTaxError(
      'checkout_tax_snapshot_unavailable',
      'ثبت سفارش متوقف شد؛ تنظیم معتبر مالیات برای شعبه تعریف نشده است.',
    );
  }
  const parsedDate = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(parsedDate.getTime())) throw checkoutTaxError('checkout_tax_date_invalid', 'تاریخ محاسبهٔ مالیات معتبر نیست.');
  const effectiveDate = parsedDate.toISOString().slice(0, 10);
  const safeLines = Array.isArray(lines) ? lines : [];
  if (!safeLines.length) throw checkoutTaxError('checkout_tax_lines_required', 'برای ثبت سفارش، ردیف‌های مشمول محاسبهٔ مالیات لازم است.');

  const menuItems = safeLines.map((line) => {
    const amountIrr = safeScaledToman(line?.lineTotal, 'اقلام سفارش');
    const menuItemId = Number(line?.menuItemId);
    if (!Number.isSafeInteger(menuItemId) || menuItemId <= 0) {
      throw checkoutTaxError('checkout_tax_menu_item_invalid', 'شناسهٔ یکی از اقلام سفارش برای محاسبهٔ مالیات معتبر نیست.');
    }
    const taxCategory = String(line?.taxCategory || taxSettings.defaultCategory).trim();
    if (!taxCategory) throw checkoutTaxError('checkout_tax_category_missing', 'گروه مالیاتی اقلام سفارش تعیین نشده است.');
    validateBranchRule(taxSettings, taxCategory, { branchId, fulfillment, date: effectiveDate });
    return {
      menuItemId,
      unitPrice: amountIrr,
      quantity: 1,
      taxCategory,
    };
  });

  const discountIrr = safeScaledToman(discountToman, 'تخفیف');
  const itemTax = taxEngine.calculateTax(taxSettings, menuItems, {
    date: effectiveDate,
    fulfillmentType: fulfillment,
    locationId: branchId,
    globalDiscount: discountIrr,
  });
  const expectedItemPayableIrr = safeLines.reduce((sum, line) => sum + safeScaledToman(line.lineTotal, 'اقلام سفارش'), 0) - discountIrr;
  if (!Number.isSafeInteger(expectedItemPayableIrr) || expectedItemPayableIrr < 0 || itemTax.grandTotal !== expectedItemPayableIrr) {
    throw checkoutTaxError('checkout_tax_total_mismatch', 'جمع اقلام و تخفیف با محاسبهٔ قطعی مالیات یکسان نیست.');
  }

  const deliveryFee = Number(deliveryFeeToman || 0);
  let deliveryTax = null;
  if (deliveryFee > 0) {
    const deliveryCategory = String(taxSettings.deliveryFeeTaxCategory || '').trim();
    if (!deliveryCategory) {
      throw checkoutTaxError(
        'checkout_tax_delivery_rule_missing',
        'ثبت ارسال متوقف شد؛ گروه مالیاتی و قاعدهٔ شامل قیمت برای هزینهٔ ارسال این شعبه تعریف نشده است.',
      );
    }
    validateBranchRule(taxSettings, deliveryCategory, { branchId, fulfillment, date: effectiveDate });
    const deliveryAmountIrr = safeScaledToman(deliveryFee, 'هزینهٔ ارسال');
    deliveryTax = taxEngine.calculateTax(taxSettings, [{ unitPrice: deliveryAmountIrr, quantity: 1, taxCategory: deliveryCategory }], {
      date: effectiveDate,
      fulfillmentType: fulfillment,
      locationId: branchId,
    });
    if (deliveryTax.grandTotal !== deliveryAmountIrr) {
      throw checkoutTaxError('checkout_tax_delivery_total_mismatch', 'هزینهٔ ارسال با محاسبهٔ قطعی مالیات یکسان نیست.');
    }
  }

  const totalTaxIrr = itemTax.totalTax + (deliveryTax?.totalTax || 0);
  const grossIrr = safeLines.reduce((sum, line) => sum + safeScaledToman(line.lineTotal, 'اقلام سفارش'), 0)
    + safeScaledToman(deliveryFee, 'هزینهٔ ارسال');
  const discountTotalIrr = itemTax.totalDiscounts;
  const totalPayableIrr = grossIrr - discountTotalIrr;
  if (![totalTaxIrr, grossIrr, discountTotalIrr, totalPayableIrr].every(Number.isSafeInteger)
      || totalTaxIrr < 0 || totalPayableIrr < 0) {
    throw checkoutTaxError('checkout_tax_total_invalid', 'جمع تصویر مالیاتی از محدودهٔ امن خارج است.');
  }

  return {
    schemaVersion: 1,
    currency: 'IRR',
    branchId: numericBranchId,
    fulfillment,
    inclusive: true,
    effectiveDate,
    totalTaxIrr,
    grossIrr,
    discountIrr: discountTotalIrr,
    totalPayableIrr,
    lines: itemTax.items.map((row, index) => ({
      type: 'menu',
      menuItemId: menuItems[index].menuItemId,
      taxCategory: row.taxCategory,
      grossIrr: row.grossAmount,
      discountIrr: row.discountAmount,
      taxableBaseIrr: row.taxableBase,
      taxAmountIrr: row.taxAmount,
      ruleSnapshot: row.ruleSnapshot,
    })),
    deliveryFee: deliveryTax ? {
      taxCategory: String(taxSettings.deliveryFeeTaxCategory).trim(),
      grossIrr: deliveryTax.items[0].grossAmount,
      taxableBaseIrr: deliveryTax.items[0].taxableBase,
      taxAmountIrr: deliveryTax.items[0].taxAmount,
      ruleSnapshot: deliveryTax.items[0].ruleSnapshot,
    } : null,
  };
}

module.exports = { buildCheckoutTaxSnapshot, checkoutSnapshotAmountsForLegacyToman };
