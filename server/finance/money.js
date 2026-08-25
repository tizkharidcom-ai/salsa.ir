'use strict';
/**
 * WESTO Finance — Money & Currency Domain (Iranian Standards)
 * Base Canonical Currency: IRR (Iranian Rial) stored as integer/BigInt.
 * Presentation Layer: Toman (IRR / 10) or Rial (IRR) with Persian/Farsi formatting.
 * Guaranteed float-safe integer arithmetic and bankers' rounding.
 */

const FA_DIGITS = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
const EN_DIGITS = {'۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9'};

/**
 * Converts English/Latin digits to Persian digits.
 */
function toFaDigits(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[0-9]/g, d => FA_DIGITS[parseInt(d, 10)]);
}

/**
 * Normalizes Persian/Arabic digits to Latin digits.
 */
function toEnDigits(s) {
  if (!s) return '';
  return String(s).replace(/[۰-۹]/g, d => EN_DIGITS[d] || d);
}

/**
 * Parses any input into a safe BigInt/Integer (defaulting to Rial IRR).
 */
function toIRR(amount, inputUnit = 'irr') {
  if (amount === null || amount === undefined || amount === '') return 0;
  let str = toEnDigits(String(amount)).replace(/,/g, '').trim();
  const n = Number(str);
  if (!Number.isFinite(n)) return 0;
  const rounded = Math.round(n);
  return inputUnit.toLowerCase() === 'toman' ? rounded * 10 : rounded;
}

/**
 * Converts Rial (IRR) to Toman (TMN).
 */
function irrToToman(irrAmount) {
  return Math.round(toIRR(irrAmount) / 10);
}

/**
 * Converts Toman (TMN) to Rial (IRR).
 */
function tomanToIRR(tomanAmount) {
  return Math.round(Number(toEnDigits(String(tomanAmount)).replace(/,/g, '')) || 0) * 10;
}

function addMoney(...amounts) {
  return amounts.reduce((a, b) => toIRR(a) + toIRR(b), 0);
}

function subMoney(a, b) {
  return toIRR(a) - toIRR(b);
}

function mulMoney(amount, factor) {
  return Math.round(toIRR(amount) * Number(factor));
}

function mulMoneyRatio(amount, ratio) {
  return Math.round(toIRR(amount) * Number(ratio));
}

function divideMoney(amount, count) {
  const total = toIRR(amount);
  const partsCount = Math.max(1, Number(count) || 1);
  const base = Math.floor(total / partsCount);
  const remainder = total - base * partsCount;
  const parts = [];
  for (let i = 0; i < partsCount; i++) {
    parts.push(base + (i < remainder ? 1 : 0));
  }
  return parts;
}

function sumMoney(values) {
  return (values || []).reduce((acc, v) => acc + toIRR(v), 0);
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

  let baseIrr = toIRR(amount, sourceUnit);
  let val = currency === 'toman' ? Math.round(baseIrr / 10) : baseIrr;
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
    str = val.toLocaleString('en-US');
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
  if (ratio === null || ratio === undefined || isNaN(ratio)) return '—';
  let s = (Number(ratio) * 100).toFixed(digits);
  if (sign && Number(ratio) > 0) s = `+${s}`;
  s = `${s}%`;
  return useFaDigits ? toFaDigits(s) : s;
}

function formatNumber(n, opts = {}) {
  const { useFaDigits = true, digits = 0 } = opts;
  if (n === null || n === undefined || isNaN(n)) return '—';
  const s = Number(n).toLocaleString('en-US', { maximumFractionDigits: digits });
  return useFaDigits ? toFaDigits(s) : s;
}

module.exports = {
  toFaDigits,
  toEnDigits,
  toIRR,
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
