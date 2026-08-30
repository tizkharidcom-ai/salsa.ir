'use strict';
/**
 * WESTO Finance — Money & Currency Domain (Iranian Standards)
 * Base Canonical Currency: IRR (Iranian Rial) stored as integer/BigInt.
 * Presentation Layer: Toman (IRR / 10) or Rial (IRR) with Persian/Farsi formatting.
 * Guaranteed float-safe integer arithmetic and bankers' rounding.
 */

const FA_DIGITS = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
const EN_DIGITS = {'۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9'};
const MAX_SAFE_IRR = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_IRR = -MAX_SAFE_IRR;
const MAX_NUMERIC_INPUT_LENGTH = 4096;
const MAX_DIVISION_PARTS = 100000;

/**
 * Converts English/Latin digits to Persian digits.
 */
function toFaDigits(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[0-9]/g, d => FA_DIGITS[parseInt(d, 10)]);
}

function formatFaGrouped(value, options = {}) {
  return toFaDigits(Number(value).toLocaleString('en-US', options))
    .replace(/,/g, '٫')
    .replace(/\./g, '٫');
}

/**
 * Normalizes Persian/Arabic digits to Latin digits.
 */
function toEnDigits(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/[۰-۹]/g, d => EN_DIGITS[d] || d)
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

function normalizeUnit(inputUnit) {
  const unit = String(inputUnit == null ? 'irr' : inputUnit).trim().toLowerCase();
  if (unit === 'irr' || unit === 'rial' || unit === 'ریال') return 'irr';
  if (unit === 'toman' || unit === 'tmn' || unit === 'تومان') return 'toman';
  throw new RangeError(`واحد مبلغ نامعتبر است: ${inputUnit}`);
}

function parseDecimalRational(value) {
  if (value === null || value === undefined || value === '') {
    return { numerator: 0n, denominator: 1n };
  }
  if (typeof value === 'bigint') {
    return { numerator: value, denominator: 1n };
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new RangeError('مبلغ باید عددی متناهی باشد؛ NaN و Infinity مجاز نیستند.');
  }

  const source = toEnDigits(String(value)).replace(/[٫]/g, '.').replace(/[٬,]/g, '').trim();
  if (source.length > MAX_NUMERIC_INPUT_LENGTH) {
    throw new RangeError('مبلغ از طول مجاز ورودی بیشتر است.');
  }
  const match = source.match(/^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) {
    throw new TypeError(`مبلغ نامعتبر است: ${String(value)}`);
  }

  const [, sign, integerPart, fractionPart = '', exponentText] = match;
  const exponent = exponentText ? Number(exponentText) : 0;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) {
    throw new RangeError('توان اعشاری مبلغ خارج از محدوده مجاز است.');
  }

  const digits = `${integerPart}${fractionPart}`.replace(/^0+(?=\d)/, '');
  let numerator = BigInt(digits || '0');
  const decimalPlaces = fractionPart.length - exponent;
  let denominator = 1n;
  if (decimalPlaces > 0) {
    denominator = 10n ** BigInt(decimalPlaces);
  } else if (decimalPlaces < 0) {
    numerator *= 10n ** BigInt(-decimalPlaces);
  }
  if (sign === '-') numerator = -numerator;
  return { numerator, denominator };
}

function roundHalfEven(numerator, denominator = 1n) {
  if (denominator <= 0n) throw new RangeError('مخرج مبلغ باید مثبت باشد.');
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  let quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const doubled = remainder * 2n;
  if (doubled > denominator || (doubled === denominator && quotient % 2n === 1n)) quotient += 1n;
  return negative ? -quotient : quotient;
}

function toSafeNumber(value, label = 'مبلغ') {
  if (value < MIN_SAFE_IRR || value > MAX_SAFE_IRR) {
    throw new RangeError(`${label} از محدوده امن عدد صحیح خارج است.`);
  }
  return Number(value);
}

function toIRR(amount, inputUnit = 'irr') {
  const unit = normalizeUnit(inputUnit);
  const parsed = parseDecimalRational(amount);
  let rounded = roundHalfEven(parsed.numerator, parsed.denominator);
  if (unit === 'toman') rounded *= 10n;
  return toSafeNumber(rounded);
}

/**
 * Converts an amount to canonical IRR only when the result is exact.
 * Ledger boundaries use this helper so fractional IRR cannot be rounded into
 * a different posted amount.
 */
function toIntegerIRR(amount, inputUnit = 'irr') {
  const unit = normalizeUnit(inputUnit);
  const parsed = parseDecimalRational(amount);
  let numerator = parsed.numerator * (unit === 'toman' ? 10n : 1n);
  if (numerator % parsed.denominator !== 0n) {
    throw new RangeError('مبلغ دفترکل باید مقدار صحیح IRR باشد و نباید گرد شود.');
  }
  return toSafeNumber(numerator / parsed.denominator);
}

/**
 * Converts Rial (IRR) to Toman (TMN).
 */
function irrToToman(irrAmount) {
  return toSafeNumber(roundHalfEven(BigInt(toIRR(irrAmount)), 10n), 'مبلغ تومان');
}

/**
 * Converts Toman (TMN) to Rial (IRR).
 */
function tomanToIRR(tomanAmount) {
  return toIRR(tomanAmount, 'toman');
}

function addMoney(...amounts) {
  const total = amounts.reduce((sum, amount) => sum + BigInt(toIRR(amount)), 0n);
  return toSafeNumber(total, 'جمع مبالغ');
}

function subMoney(a, b) {
  return toSafeNumber(BigInt(toIRR(a)) - BigInt(toIRR(b)), 'تفاضل مبالغ');
}

function multiplyMoney(amount, factor) {
  const parsedFactor = parseDecimalRational(factor);
  const product = BigInt(toIRR(amount)) * parsedFactor.numerator;
  return toSafeNumber(roundHalfEven(product, parsedFactor.denominator), 'حاصل ضرب مبلغ');
}

const mulMoney = multiplyMoney;
const mulMoneyRatio = multiplyMoney;

function divideMoney(amount, count) {
  const countNumber = typeof count === 'bigint' ? toSafeNumber(count, 'تعداد تقسیم') : Number(count);
  if (!Number.isSafeInteger(countNumber) || countNumber <= 0) {
    throw new RangeError('تعداد تقسیم باید یک عدد صحیح مثبت باشد.');
  }
  if (countNumber > MAX_DIVISION_PARTS) {
    throw new RangeError(`تعداد سهم‌ها نمی‌تواند بیشتر از ${MAX_DIVISION_PARTS.toLocaleString('en-US')} باشد.`);
  }
  const total = BigInt(toIRR(amount));
  const divisor = BigInt(countNumber);
  let base = total / divisor;
  let remainder = total % divisor;
  if (remainder < 0n) {
    base -= 1n;
    remainder += divisor;
  }
  const parts = [];
  for (let i = 0; i < countNumber; i++) {
    parts.push(toSafeNumber(base + (BigInt(i) < remainder ? 1n : 0n), 'سهم تقسیم‌شده'));
  }
  return parts;
}

function sumMoney(values) {
  if (values == null) return 0;
  if (!Array.isArray(values)) throw new TypeError('فهرست مبالغ باید آرایه باشد.');
  return addMoney(...values);
}

/**
 * Formats an amount with currency label and Persian digits.
 * @param {number|string} amount - Amount in Rial (IRR) by default.
 * @param {object} opts - Formatting options.
 */
function formatMoney(amount, opts = {}) {
  const {
    currency = 'toman', // 'toman' | 'irr' | 'none'
    sourceUnit = 'irr',  // input is in 'irr' or 'toman'
    locale = 'fa',
    compact = false,
    showSign = false
  } = opts;

  const baseIrr = toIRR(amount, sourceUnit);
  let val = currency === 'toman' ? irrToToman(baseIrr) : baseIrr;
  const isNeg = val < 0;
  val = Math.abs(val);

  let str;
  if (compact) {
    if (val >= 1e12) str = (val / 1e12).toFixed(1).replace(/\.0$/, '') + ' همت';
    else if (val >= 1e9) str = (val / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    else if (val >= 1e6) str = (val / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    else if (val >= 1e3) str = (val / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    else str = String(val);
  } else {
    str = locale === 'fa' ? formatFaGrouped(val) : val.toLocaleString('en-US');
  }

  if (locale === 'fa') str = toFaDigits(str);
  if (isNeg) str = `−${str}`;
  else if (showSign && val > 0) str = `+${str}`;

  if (currency === 'toman') return locale === 'fa' ? `${str} تومان` : `${str} TMN`;
  if (currency === 'irr' || currency === 'rial') return locale === 'fa' ? `${str} ریال` : `${str} IRR`;
  return str;
}

function formatPercent(ratio, opts = {}) {
  const { digits = 1, useFaDigits = true, sign = false } = opts;
  const numericRatio = Number(ratio);
  if (ratio === null || ratio === undefined || !Number.isFinite(numericRatio)) return '—';
  let s = (numericRatio * 100).toFixed(digits);
  if (sign && numericRatio > 0) s = `+${s}`;
  s = `${s}%`;
  return useFaDigits ? toFaDigits(s) : s;
}

function formatNumber(n, opts = {}) {
  const { useFaDigits = true, digits = 0 } = opts;
  const numericValue = Number(n);
  if (n === null || n === undefined || !Number.isFinite(numericValue)) return '—';
  const s = useFaDigits
    ? formatFaGrouped(numericValue, { maximumFractionDigits: digits })
    : numericValue.toLocaleString('en-US', { maximumFractionDigits: digits });
  return useFaDigits ? toFaDigits(s) : s;
}

module.exports = {
  toFaDigits,
  toEnDigits,
  toIRR,
  toIntegerIRR,
  toInt: toIRR,
  irrToToman,
  tomanToIRR,
  addMoney,
  subMoney,
  mulMoney,
  mulMoneyRatio,
  divideMoney,
  sumMoney,
  formatMoney,
  formatPercent,
  formatNumber,
};
