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

const { toEnDigits } = require('../../../platform_core/server/finance/money.js');

function taxError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function integerMoney(value, code = 'tax_amount_invalid', label = 'مبلغ') {
  if (value === null || value === undefined || value === '') return 0;
  let numberValue;
  if (typeof value === 'number') {
    numberValue = value;
    if (!Number.isSafeInteger(numberValue)) throw taxError(code, `${label} باید عدد صحیح ریالی در محدودهٔ امن باشد.`);
  } else {
    const normalized = toEnDigits(String(value)).replace(/[,_\s]/g, '');
    if (!/^-?\d+$/.test(normalized)) throw taxError(code, `${label} باید عدد صحیح ریالی باشد.`);
    numberValue = Number(normalized);
  }
  if (!Number.isSafeInteger(numberValue)) throw taxError(code, `${label} باید عدد صحیح ریالی در محدودهٔ امن باشد.`);
  return numberValue;
}

function nonNegativeMoney(value, code, label) {
  const amount = integerMoney(value, code, label);
  if (amount < 0) throw taxError(code, `${label} نمی‌تواند منفی باشد.`);
  return amount;
}

function targetDateKey(date) {
  const parsed = date instanceof Date ? new Date(date.getTime()) : new Date(date || Date.now());
  if (!Number.isFinite(parsed.getTime())) throw taxError('tax_date_invalid', 'تاریخ اعمال مالیات معتبر نیست.');
  return parsed.toISOString().slice(0, 10);
}

function effectiveOn(row, targetDate) {
  if (row.effectiveFrom && String(row.effectiveFrom).slice(0, 10) > targetDate) return false;
  if (row.effectiveTo && String(row.effectiveTo).slice(0, 10) < targetDate) return false;
  return true;
}

function validRate(value) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw taxError('tax_rate_invalid', 'نرخ مالیات باید بین صفر و یک باشد.');
  return rate;
}

function positiveQuantity(value) {
  const normalized = typeof value === 'string' ? toEnDigits(value).replace(/[,\s]/g, '') : value;
  const quantity = Number(normalized == null || normalized === '' ? 1 : normalized);
  if (!Number.isFinite(quantity) || quantity <= 0) throw taxError('tax_quantity_invalid', 'تعداد/مقدار ردیف مالیاتی باید بیشتر از صفر باشد.');
  return quantity;
}

function safeTotal(value, code = 'tax_total_unsafe') {
  if (!Number.isSafeInteger(value) || value < 0) throw taxError(code, 'جمع مالیاتی از محدودهٔ امن ریال خارج است.');
  return value;
}

function parseDecimalRational(value, label = 'نرخ') {
  const source = toEnDigits(String(value)).replace(/[٫]/g, '.').replace(/[٬,]/g, '').trim();
  const match = source.match(/^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) throw taxError('tax_rate_invalid', `${label} باید عدد معتبر باشد.`);
  const [, sign, integerPart, fractionPart = '', exponentText] = match;
  const exponent = exponentText ? Number(exponentText) : 0;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) {
    throw taxError('tax_rate_invalid', `${label} خارج از محدودهٔ مجاز است.`);
  }
  let numerator = BigInt(`${integerPart}${fractionPart}` || '0');
  const decimalPlaces = fractionPart.length - exponent;
  let denominator = 1n;
  if (decimalPlaces > 0) denominator = 10n ** BigInt(decimalPlaces);
  else if (decimalPlaces < 0) numerator *= 10n ** BigInt(-decimalPlaces);
  if (sign === '-') numerator = -numerator;
  return { numerator, denominator };
}

function roundHalfEven(numerator, denominator) {
  if (denominator <= 0n) throw taxError('tax_rounding_invalid', 'مخرج گرد کردن مالیات معتبر نیست.');
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  let quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const doubled = remainder * 2n;
  if (doubled > denominator || (doubled === denominator && quotient % 2n === 1n)) quotient += 1n;
  return negative ? -quotient : quotient;
}

function roundedRatio(amount, numerator, denominator, code = 'tax_total_unsafe') {
  const rounded = roundHalfEven(BigInt(amount) * numerator, denominator);
  if (rounded < 0n || rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw taxError(code, 'مبلغ مالیاتی از محدودهٔ امن ریال خارج است.');
  return Number(rounded);
}

function booleanSetting(value, code, label) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === 1) return Boolean(value);
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  throw taxError(code, `${label} باید true یا false باشد.`);
}

function scopeMatches(rule, fulfillmentType, locationId) {
  if (rule.fulfillmentType != null
    && String(rule.fulfillmentType).trim().toUpperCase() !== String(fulfillmentType || '').trim().toUpperCase()) return false;
  if (rule.locationId != null
    && (locationId == null || String(rule.locationId) !== String(locationId))) return false;
  return true;
}

const DEFAULT_TAX_CATEGORIES = Object.freeze([
  {
    code: 'standard_1405',
    name: 'استاندارد رستورانی (نیازمند نرخ مؤثر تأییدشده)',
    nameFa: 'مالیات بر ارزش افزوده استاندارد',
    exempt: false,
    effectiveFrom: '2026-03-21',
    effectiveTo: null,
    legalSource: null,
  },
  {
    code: 'standard_historical_9',
    name: 'استاندارد سنواتی (نیازمند نرخ مؤثر تأییدشده)',
    nameFa: 'مالیات بر ارزش افزوده سنواتی',
    exempt: false,
    effectiveFrom: '2022-01-01',
    effectiveTo: '2026-03-20',
    legalSource: null,
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
]);

// Tax rates are tenant/legal configuration, not source-code defaults. A
// missing effective rule must stop posting rather than silently calculate a
// stale or unreviewed rate.
const DEFAULT_TAX_RULES = Object.freeze([]);
const UNVERIFIED_LEGACY_RULE_IDS = new Set(['tr-1405-std', 'tr-1400-std', 'tr-exempt']);
const UNVERIFIED_LEGACY_RULE_CODES = new Set(['VAT_STD_1405', 'VAT_STD_1400', 'VAT_EXEMPT']);

/**
 * Initializes the category catalogue without inventing legal tax rates.
 */
function ensureTaxSettings(acc) {
  if (!acc || typeof acc !== 'object') throw taxError('tax_settings_invalid', 'ساختار تنظیمات مالیاتی معتبر نیست.');
  if (!acc.taxSettings || typeof acc.taxSettings !== 'object') {
    acc.taxSettings = {
      defaultCategory: 'standard_1405',
      categories: DEFAULT_TAX_CATEGORIES.map(c => ({ ...c })),
      rules: DEFAULT_TAX_RULES.map(r => ({ ...r })),
    };
  } else {
    if (!Array.isArray(acc.taxSettings.categories) || acc.taxSettings.categories.length === 0) {
      acc.taxSettings.categories = DEFAULT_TAX_CATEGORIES.map(c => ({ ...c }));
    }
    if (!Array.isArray(acc.taxSettings.rules)) acc.taxSettings.rules = [];
    if (!acc.taxSettings.defaultCategory) acc.taxSettings.defaultCategory = 'standard_1405';
  }
  return acc.taxSettings;
}

/**
 * Resolves the most appropriate effective Tax Rule for a given date and category.
 */
function resolveTaxRule(taxSettings, opts = {}) {
  const settings = taxSettings && typeof taxSettings === 'object' ? taxSettings : {};
  const {
    taxCategory = settings.defaultCategory || 'standard_1405',
    date = new Date(),
    fulfillmentType = null,
    locationId = null,
  } = opts;

  const targetDate = targetDateKey(date);
  const isEffective = (row) => effectiveOn(row, targetDate);
  // Historical rules may be archived operationally, but remain valid for
  // their own effective interval. Never let a future active rule win merely
  // because the historical rule is archived.
  const activeEffective = (settings.rules || []).filter((r) => {
    const status = r.status == null ? 'active' : String(r.status).trim().toLowerCase();
    const isLegacyGeneratedDefault = UNVERIFIED_LEGACY_RULE_IDS.has(String(r.id || ''))
      || UNVERIFIED_LEGACY_RULE_CODES.has(String(r.code || ''));
    const hasLegalIdentity = (typeof r.id === 'string' || Number.isSafeInteger(r.id))
      && String(r.id ?? '').trim()
      && typeof r.code === 'string' && r.code.trim()
      && Number.isSafeInteger(Number(r.version)) && Number(r.version) > 0
      && typeof r.legalSource === 'string' && r.legalSource.trim();
    return !isLegacyGeneratedDefault && hasLegalIdentity
      && ['active', 'archived'].includes(status) && isEffective(r);
  });
  const rules = activeEffective.filter((r) => {
    if (r.taxCategory !== taxCategory && r.code !== taxCategory) return false;
    return scopeMatches(r, fulfillmentType, locationId);
  });

  // Scoring by specificity
  const score = (r) => {
    let s = 0;
    if (fulfillmentType
      && String(r.fulfillmentType || '').trim().toUpperCase() === String(fulfillmentType).trim().toUpperCase()) s += 4;
    if (locationId != null && String(r.locationId) === String(locationId)) s += 2;
    if (!r.fulfillmentType) s += 1;
    if (r.locationId == null) s += 1;
    return s;
  };

  if (rules.length) {
    rules.sort((a, b) => score(b) - score(a)
      || String(b.effectiveFrom || '').localeCompare(String(a.effectiveFrom || ''))
      || (b.version || 1) - (a.version || 1));
    return rules[0];
  }

  // A default category can span multiple effective tax categories. Pick the
  // currently effective non-exempt category rather than a future rule.
  const categories = Array.isArray(settings.categories) ? settings.categories : [];
  const compatibleCodes = new Set(categories
    .filter((category) => !category.exempt && isEffective(category))
    .map((category) => category.code));
  const categoryFamily = String(taxCategory).replace(/(?:_historical)?(?:_\d+)?$/, '');
  const fallback = activeEffective.filter((r) => {
    if (compatibleCodes.has(r.taxCategory)) return true;
    const ruleFamily = String(r.taxCategory || '').replace(/(?:_historical)?(?:_\d+)?$/, '');
    return categoryFamily && ruleFamily === categoryFamily;
  }).filter((r) => scopeMatches(r, fulfillmentType, locationId));
  fallback.sort((a, b) => score(b) - score(a)
    || String(b.effectiveFrom || '').localeCompare(String(a.effectiveFrom || ''))
    || (b.version || 1) - (a.version || 1));
  return fallback[0] || null;
}

/**
 * Calculates line-by-line and aggregated VAT for items.
 * Enforces rule: Taxable Base = (Gross Price * Quantity) - Eligible Discounts.
 */
function calculateTax(taxSettings, items = [], opts = {}) {
  const rawSettings = (taxSettings && typeof taxSettings === 'object' && taxSettings.taxSettings)
    ? taxSettings.taxSettings
    : (taxSettings && typeof taxSettings === 'object' ? taxSettings : {});
  const container = { taxSettings: { ...rawSettings } };
  const settings = ensureTaxSettings(container);
  const {
    date = new Date(),
    fulfillmentType = null,
    locationId = null,
    globalDiscount = 0,
  } = opts;

  const sourceItems = Array.isArray(items) ? items : [];
  const globalDiscountIrr = nonNegativeMoney(globalDiscount, 'tax_global_discount_invalid', 'تخفیف کلی');
  const prepared = sourceItems.map((item) => {
    const line = item && typeof item === 'object' ? item : {};
    const quantity = positiveQuantity(line.quantity ?? line.qty ?? line.count);
    const unitPrice = nonNegativeMoney(line.unitPrice ?? line.unit_price_irr ?? line.price ?? 0, 'tax_amount_invalid', 'قیمت واحد');
    const grossAmount = unitPrice * quantity;
    safeTotal(grossAmount, 'tax_gross_unsafe');
    const discount = nonNegativeMoney(line.discount ?? line.discount_irr ?? 0, 'tax_discount_invalid', 'تخفیف ردیف');
    if (discount > grossAmount) throw taxError('tax_discount_exceeds_gross', 'تخفیف ردیف از مبلغ ناخالص بیشتر است.');
    return { line, quantity, unitPrice, grossAmount, discount };
  });

  const capacities = prepared.map((row) => row.grossAmount - row.discount);
  const totalCapacity = capacities.reduce((sum, value) => safeTotal(sum + value), 0);
  if (globalDiscountIrr > totalCapacity) throw taxError('tax_global_discount_exceeds_gross', 'تخفیف کلی از مبلغ قابل تخفیف فروش بیشتر است.');
  const totalCapacityBig = BigInt(totalCapacity);
  const discountBig = BigInt(globalDiscountIrr);
  const allocationRows = capacities.map((capacity, index) => {
    const numerator = discountBig * BigInt(capacity);
    const base = totalCapacityBig === 0n ? 0n : numerator / totalCapacityBig;
    return {
      index,
      amount: Number(base),
      remainder: totalCapacityBig === 0n ? 0n : numerator % totalCapacityBig,
      capacity,
    };
  });
  let allocatedDiscount = allocationRows.reduce((sum, row) => sum + row.amount, 0);
  let remainingGlobalDiscount = globalDiscountIrr - allocatedDiscount;
  allocationRows.sort((a, b) => (b.remainder > a.remainder ? 1 : b.remainder < a.remainder ? -1 : a.index - b.index));
  for (const row of allocationRows) {
    if (remainingGlobalDiscount <= 0) break;
    if (row.amount < row.capacity) {
      row.amount += 1;
      remainingGlobalDiscount -= 1;
    }
  }
  if (remainingGlobalDiscount !== 0) throw taxError('tax_global_discount_allocation_failed', 'تخفیف کلی به‌صورت کامل بین ردیف‌ها تخصیص نیافت.');
  allocationRows.sort((a, b) => a.index - b.index);
  const globalAllocations = allocationRows.map((row) => row.amount);

  const results = prepared.map(({ line, quantity, unitPrice, grossAmount, discount }, index) => {
    const lineDiscount = discount + globalAllocations[index];
    const netBase = grossAmount - lineDiscount;
    const targetDate = targetDateKey(date);
    const taxCat = line.taxCategory ?? line.taxCode ?? settings.defaultCategory ?? 'standard_1405';
    const catInfo = (settings.categories || []).find((c) => c.code === taxCat);
    const isExempt = Boolean(catInfo?.exempt && effectiveOn(catInfo, targetDate));
    const rule = isExempt ? null : resolveTaxRule(settings, { taxCategory: taxCat, date, fulfillmentType, locationId });
    if (!isExempt && !rule) {
      throw taxError('tax_rule_missing', `برای گروه مالیاتی «${taxCat}» در تاریخ/محدودهٔ انتخاب‌شده قاعده مؤثر یافت نشد.`);
    }
    const rate = isExempt ? 0 : validRate(rule.rate);
    const inclusive = booleanSetting(rule?.inclusive, 'tax_inclusive_invalid', 'حالت inclusive مالیات');

    let taxAmount = 0;
    let taxableBase = netBase;
    let totalPayable = netBase;
    if (!isExempt && rate > 0) {
      if (inclusive) {
        const rateRational = parseDecimalRational(rate, 'نرخ مالیات');
        taxableBase = roundedRatio(
          netBase,
          rateRational.denominator,
          rateRational.denominator + rateRational.numerator,
          'tax_base_unsafe',
        );
        taxAmount = netBase - taxableBase;
        totalPayable = netBase;
      } else {
        const rateRational = parseDecimalRational(rate, 'نرخ مالیات');
        taxAmount = roundedRatio(netBase, rateRational.numerator, rateRational.denominator);
        totalPayable = netBase + taxAmount;
      }
    }
    safeTotal(taxAmount, 'tax_total_unsafe');
    safeTotal(taxableBase, 'tax_base_unsafe');
    safeTotal(totalPayable, 'tax_payable_unsafe');

    return {
      ...line,
      quantity,
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
        ? {
          id: rule.id,
          code: rule.code,
          rate: rule.rate,
          inclusive,
          recoverability: rule.recoverability || null,
          version: rule.version,
          effectiveFrom: rule.effectiveFrom || null,
          effectiveTo: rule.effectiveTo || null,
          fulfillmentType: rule.fulfillmentType || null,
          locationId: rule.locationId ?? null,
          legalSource: rule.legalSource,
        }
        : { code: 'EXEMPT', rate: 0, inclusive: false, version: 1, legalSource: 'ماده ۹ ق.م.ا' },
    };
  });

  const subtotalGross = results.reduce((sum, row) => safeTotal(sum + row.grossAmount), 0);
  const totalDiscounts = results.reduce((sum, row) => safeTotal(sum + row.discountAmount), 0);
  const totalTaxableBase = results.reduce((sum, row) => safeTotal(sum + row.taxableBase), 0);
  const totalTax = results.reduce((sum, row) => safeTotal(sum + row.taxAmount), 0);
  const grandTotal = results.reduce((sum, row) => safeTotal(sum + row.totalPayable), 0);

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
    ex.taxableBase = safeTotal(ex.taxableBase + line.taxableBase);
    ex.taxAmount = safeTotal(ex.taxAmount + line.taxAmount);
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
