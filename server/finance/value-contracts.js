'use strict';

/**
 * Shared value boundaries for Finance V2.
 *
 * The accounting boundary stores integer IRR. Quantities remain decimal
 * numbers, but are parsed through the same Persian/Arabic/Latin input rules.
 * Dates are normalized at the boundary and units are canonicalized before any
 * inventory or recipe calculation.
 */

const money = require('./money');
const VALUE_CONTRACT_VERSION = 1;

const UNIT_ALIASES = Object.freeze({
  g: 'g', gram: 'g', grams: 'g', گرم: 'g',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg', کیلو: 'kg', کیلوگرم: 'kg', 'کیلو گرم': 'kg',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', میلیلیتر: 'ml', 'میلی لیتر': 'ml', 'میلی‌لیتر': 'ml',
  l: 'l', liter: 'l', litre: 'l', liters: 'l', litres: 'l', لیتر: 'l',
  count: 'count', each: 'count', unit: 'count', pcs: 'count', piece: 'count', عدد: 'count', واحد: 'count',
});

const UNIT_META = Object.freeze({
  g: { dimension: 'mass', baseFactor: 1 },
  kg: { dimension: 'mass', baseFactor: 1000 },
  ml: { dimension: 'volume', baseFactor: 1 },
  l: { dimension: 'volume', baseFactor: 1000 },
  count: { dimension: 'count', baseFactor: 1 },
});

function parseDecimal(value, { emptyValue = 0, allowNegative = true, label = 'عدد' } = {}) {
  if (value === null || value === undefined || String(value).trim() === '') return emptyValue;
  const parsed = money.parseDecimalRational(value);
  const numeric = Number(parsed.numerator) / Number(parsed.denominator);
  if (!Number.isFinite(numeric) || Math.abs(numeric) > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${label} از محدودهٔ امن خارج است.`);
  }
  if (!allowNegative && numeric < 0) throw new RangeError(`${label} نمی‌تواند منفی باشد.`);
  return numeric;
}

function parseInteger(value, { emptyValue = 0, allowNegative = true, label = 'عدد' } = {}) {
  if (value === null || value === undefined || String(value).trim() === '') return emptyValue;
  const parsed = money.parseDecimalRational(value);
  if (parsed.numerator % parsed.denominator !== 0n) throw new RangeError(`${label} باید عدد صحیح باشد.`);
  const numeric = Number(parsed.numerator / parsed.denominator);
  if (!Number.isSafeInteger(numeric)) throw new RangeError(`${label} از محدودهٔ امن خارج است.`);
  if (!allowNegative && numeric < 0) throw new RangeError(`${label} نمی‌تواند منفی باشد.`);
  return numeric;
}

function parseMoney(value, unit, { allowNegative = false, label = 'مبلغ' } = {}) {
  const amount = money.toIntegerIRR(value, unit);
  if (!Number.isSafeInteger(amount) || (!allowNegative && amount < 0)) {
    throw new RangeError(`${label} باید عدد صحیح ${allowNegative ? '' : 'نامنفی '}باشد.`);
  }
  return amount;
}

function parseIrr(value, options = {}) {
  return parseMoney(value, 'irr', { label: 'مبلغ ریالی', ...options });
}

function parseToman(value, options = {}) {
  return parseMoney(value, 'toman', { label: 'مبلغ تومانی', ...options });
}

function canonicalUnit(value) {
  const key = String(value ?? '').trim().toLowerCase().replace(/\u200c/g, ' ');
  return UNIT_ALIASES[key] || null;
}

function parseConversionMultiplier(value) {
  try {
    const multiplier = parseDecimal(value, { emptyValue: null, allowNegative: false, label: 'ضریب تبدیل' });
    return multiplier != null && multiplier > 0 ? multiplier : null;
  } catch {
    return null;
  }
}

function itemConversion(quantity, fromUnit, toUnit, conversions = []) {
  for (const row of Array.isArray(conversions) ? conversions : []) {
    const from = canonicalUnit(row?.fromUnit || row?.unit);
    const to = canonicalUnit(row?.toUnit || row?.baseUnit);
    const multiplier = parseConversionMultiplier(row?.multiplier ?? row?.factor);
    if (from === fromUnit && to === toUnit && multiplier != null) return quantity * multiplier;
    if (from === toUnit && to === fromUnit && multiplier != null) return quantity / multiplier;
  }
  return null;
}

function convertQuantity(quantity, from, to, conversions = []) {
  let value;
  try {
    value = parseDecimal(quantity, { emptyValue: null, allowNegative: false, label: 'مقدار' });
  } catch {
    return { ok: false, code: 'quantity_invalid', value: null };
  }
  const fromUnit = canonicalUnit(from);
  const toUnit = canonicalUnit(to);
  if (value == null || !Number.isFinite(value)) return { ok: false, code: 'quantity_invalid', value: null };
  if (!fromUnit || !toUnit) return { ok: false, code: 'unit_unknown', value: null, fromUnit, toUnit };
  if (fromUnit === toUnit) return { ok: true, value, fromUnit, toUnit, source: 'same_unit' };

  const explicit = itemConversion(value, fromUnit, toUnit, conversions);
  if (explicit != null && Number.isFinite(explicit)) {
    return { ok: true, value: explicit, fromUnit, toUnit, source: 'item_conversion' };
  }

  const fromMeta = UNIT_META[fromUnit];
  const toMeta = UNIT_META[toUnit];
  if (!fromMeta || !toMeta || fromMeta.dimension !== toMeta.dimension) {
    return { ok: false, code: 'unit_incompatible', value: null, fromUnit, toUnit };
  }
  const converted = value * fromMeta.baseFactor / toMeta.baseFactor;
  if (!Number.isFinite(converted)) return { ok: false, code: 'quantity_unsafe', value: null, fromUnit, toUnit };
  return { ok: true, value: converted, fromUnit, toUnit, source: 'dimension_conversion' };
}

function normalizeDateDigits(value) {
  return money.toEnDigits(String(value ?? '')).trim();
}

function parseDateOnly(value) {
  const text = normalizeDateDigits(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : null;
}

function requireDateOnly(value, { code = 'date_invalid', message = 'تاریخ معتبر نیست.' } = {}) {
  const date = parseDateOnly(value);
  if (!date) throw Object.assign(new Error(message), { code, status: 400 });
  return date;
}

function parseTimestamp(value) {
  const text = normalizeDateDigits(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
  if (!match || !parseDateOnly(match[1])) return null;
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function requireTimestamp(value, { code = 'timestamp_invalid', message = 'زمان باید تاریخ ISO معتبر همراه منطقهٔ زمانی باشد.' } = {}) {
  const timestamp = parseTimestamp(value);
  if (!timestamp) throw Object.assign(new Error(message), { code, status: 400 });
  return timestamp;
}

module.exports = {
  VALUE_CONTRACT_VERSION,
  UNIT_ALIASES,
  UNIT_META,
  parseDecimal,
  parseInteger,
  parseMoney,
  parseIrr,
  parseToman,
  canonicalUnit,
  convertQuantity,
  parseDateOnly,
  requireDateOnly,
  parseTimestamp,
  requireTimestamp,
};
