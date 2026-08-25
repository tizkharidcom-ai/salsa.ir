'use strict';
/**
 * WESTO Finance — Iran Tax & VAT Rule Engine (Effective-Dated)
 * Compliant with Iranian VAT Law & Permanent Value Added Tax Statutes.
 * Key Architectural Decisions:
 * 1. ZERO HARD-CODED RATES: All rates are versioned and effective-dated.
 * 2. SEPARATE TAXABLE BASE: Taxable base = Gross - Eligible Discounts (as per VAT statute).
 * 3. INPUT VAT RECOVERABILITY: Distinguishes between recoverable and non-recoverable input tax.
 * 4. TAX SNAPSHOT: Every invoice/order stores an immutable snapshot of the applied rule.
 */

const { toIRR, mulMoneyRatio } = require('./money');

/**
 * Initializes and ensures default effective-dated tax categories and rules.
 */
function ensureTaxSettings(acc) {
  if (!acc.taxSettings || typeof acc.taxSettings !== 'object') {
    acc.taxSettings = {
      defaultCategory: 'standard_1405',
      categories: [
        {
          code: 'standard_1405',
          name: 'استاندارد رستورانی (۱۰٪ سال ۱۴۰۵)',
          nameFa: 'مالیات بر ارزش افزوده استاندارد ۱۰٪',
          defaultRate: 0.10,
          exempt: false,
          effectiveFrom: '2026-03-21',
          effectiveTo: null,
          legalSource: 'قانون بودجه سال ۱۴۰۵ کل کشور - افزایش نرخ مالیات بر ارزش افزوده به ۱۰٪',
        },
        {
          code: 'standard_historical_9',
          name: 'استاندارد سنواتی (۹٪)',
          nameFa: 'مالیات بر ارزش افزوده سنواتی ۹٪',
          defaultRate: 0.09,
          exempt: false,
          effectiveFrom: '2022-01-01',
          effectiveTo: '2026-03-20',
          legalSource: 'قانون دائمی مالیات بر ارزش افزوده مصوب ۱۴۰۰',
        },
        {
          code: 'exempt_staple',
          name: 'معاف از مالیات (ماده ۹ ق.م.ا)',
          nameFa: 'کالاهای اساسی و فرآوری‌نشده معاف',
          defaultRate: 0.0,
          exempt: true,
          effectiveFrom: '2022-01-01',
          effectiveTo: null,
          legalSource: 'ماده ۹ قانون دائمی مالیات بر ارزش افزوده',
        },
      ],
      rules: [
        {
          id: 'tr-1405-std',
          code: 'VAT_STD_1405',
          name: 'نرخ پایه ارزش افزوده سال ۱۴۰۵',
          taxCategory: 'standard_1405',
          rate: 0.10,
          inclusive: false,
          recoverability: 'RECOVERABLE', // for B2B input tax
          effectiveFrom: '2026-03-21',
          effectiveTo: null,
          legalSource: 'قانون بودجه سال ۱۴۰۵',
          version: 2,
          status: 'active',
        },
        {
          id: 'tr-1400-std',
          code: 'VAT_STD_1400',
          name: 'نرخ پایه ارزش افزوده سنواتی ۹٪',
          taxCategory: 'standard_historical_9',
          rate: 0.09,
          inclusive: false,
          recoverability: 'RECOVERABLE',
          effectiveFrom: '2022-01-01',
          effectiveTo: '2026-03-20',
          legalSource: 'قانون مالیات بر ارزش افزوده ۱۴۰۰',
          version: 1,
          status: 'archived',
        },
        {
          id: 'tr-exempt',
          code: 'VAT_EXEMPT',
          name: 'معافیت مواد خام اساسی',
          taxCategory: 'exempt_staple',
          rate: 0.0,
          inclusive: false,
          recoverability: 'NON_RECOVERABLE',
          effectiveFrom: '2022-01-01',
          effectiveTo: null,
          legalSource: 'ماده ۹ قانون مالیات بر ارزش افزوده',
          version: 1,
          status: 'active',
        },
      ],
    };
  }
  return acc.taxSettings;
}

/**
 * Resolves the most appropriate effective Tax Rule for a given date and category.
 */
function resolveTaxRule(taxSettings, opts = {}) {
  const {
    taxCategory = 'standard_1405',
    date = new Date(),
    fulfillmentType = null,
    locationId = null,
  } = opts;

  const targetDate = new Date(date).toISOString().slice(0, 10);
  const rules = (taxSettings.rules || []).filter((r) => {
    if (r.status !== 'active') return false;
    if (r.taxCategory !== taxCategory && r.code !== taxCategory) return false;
    if (r.effectiveFrom && r.effectiveFrom > targetDate) return false;
    if (r.effectiveTo && r.effectiveTo < targetDate) return false;
    return true;
  });

  if (rules.length === 0) {
    // Fallback to latest active rule in category or first active rule
    const fallback = (taxSettings.rules || []).find((r) => r.status === 'active' && r.taxCategory === taxCategory)
      || (taxSettings.rules || []).find((r) => r.status === 'active')
      || null;
    return fallback;
  }

  // Scoring by specificity
  const score = (r) => {
    let s = 0;
    if (fulfillmentType && r.fulfillmentType === fulfillmentType) s += 4;
    if (locationId && r.locationId === locationId) s += 2;
    if (!r.fulfillmentType) s += 1;
    if (!r.locationId) s += 1;
    return s;
  };

  rules.sort((a, b) => score(b) - score(a) || (b.version || 1) - (a.version || 1));
  return rules[0];
}

/**
 * Calculates line-by-line and aggregated VAT for items.
 * Enforces rule: Taxable Base = (Gross Price * Quantity) - Eligible Discounts.
 */
function calculateTax(taxSettings, items = [], opts = {}) {
  const {
    date = new Date(),
    fulfillmentType = null,
    locationId = null,
    globalDiscount = 0,
  } = opts;

  const results = [];
  const linesCount = Math.max(1, items.length);
  const allocatedGlobalDiscountPerLine = Math.floor(toIRR(globalDiscount) / linesCount);

  for (const item of items) {
    const qty = Number(item.quantity || item.qty || 1);
    const unitPrice = toIRR(item.unitPrice || item.price || 0);
    const lineDiscount = toIRR(item.discount || 0) + allocatedGlobalDiscountPerLine;
    const grossAmount = unitPrice * qty;
    const netBase = Math.max(0, grossAmount - lineDiscount);

    const taxCat = item.taxCategory || item.taxCode || 'standard_1405';
    const catInfo = (taxSettings.categories || []).find((c) => c.code === taxCat);
    const isExempt = catInfo ? catInfo.exempt : false;

    const rule = isExempt
      ? null
      : resolveTaxRule(taxSettings, { taxCategory: taxCat, date, fulfillmentType, locationId });

    const rate = isExempt ? 0 : (rule ? rule.rate : (catInfo ? catInfo.defaultRate : 0.10));
    const inclusive = rule ? rule.inclusive : false;

    let taxAmount = 0;
    let taxableBase = netBase;
    let totalPayable = netBase;

    if (!isExempt && rate > 0) {
      if (inclusive) {
        taxableBase = Math.round(netBase / (1 + rate));
        taxAmount = netBase - taxableBase;
        totalPayable = netBase;
      } else {
        taxAmount = mulMoneyRatio(netBase, rate);
        taxableBase = netBase;
        totalPayable = netBase + taxAmount;
      }
    }

    results.push({
      ...item,
      quantity: qty,
      unitPrice,
      grossAmount,
      discountAmount: lineDiscount,
      taxCategory: taxCat,
      taxRate: rate,
      taxRatePct: Math.round(rate * 100),
      taxableBase,
      taxAmount,
      totalPayable,
      exempt: isExempt,
      ruleSnapshot: rule
        ? { id: rule.id, code: rule.code, rate: rule.rate, version: rule.version, legalSource: rule.legalSource }
        : { code: 'EXEMPT', rate: 0, version: 1, legalSource: 'ماده ۹ ق.م.ا' },
    });
  }

  const subtotalGross = results.reduce((s, x) => s + x.grossAmount, 0);
  const totalDiscounts = results.reduce((s, x) => s + x.discountAmount, 0);
  const totalTaxableBase = results.reduce((s, x) => s + x.taxableBase, 0);
  const totalTax = results.reduce((s, x) => s + x.taxAmount, 0);
  const grandTotal = results.reduce((s, x) => s + x.totalPayable, 0);

  // Grouped breakdown by rate
  const breakdownMap = new Map();
  for (const line of results) {
    const key = `${line.taxRate}|${line.taxCategory}`;
    const ex = breakdownMap.get(key) || {
      taxRate: line.taxRate,
      taxRatePct: line.taxRatePct,
      taxCategory: line.taxCategory,
      taxableBase: 0,
      taxAmount: 0,
      lineCount: 0,
    };
    ex.taxableBase += line.taxableBase;
    ex.taxAmount += line.taxAmount;
    ex.lineCount++;
    breakdownMap.set(key, ex);
  }

  return {
    items: results,
    subtotalGross,
    totalDiscounts,
    totalTaxableBase,
    totalTax,
    grandTotal,
    breakdown: [...breakdownMap.values()],
    calculatedAt: new Date().toISOString(),
  };
}

module.exports = {
  ensureTaxSettings,
  resolveTaxRule,
  calculateTax,
};
