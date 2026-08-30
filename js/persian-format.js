/* WESTO Persian number formatting — one presentation rule for all amounts. */
(function (global) {
  'use strict';

  const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
  const GROUP_SEPARATOR = '٫';

  function toFaDigits(value) {
    return String(value ?? '').replace(/[0-9]/g, (digit) => FA_DIGITS[Number(digit)]);
  }

  function toNumber(value) {
    if (typeof value === 'number') return value;
    let normalized = String(value ?? '')
      .replace(/[۰-۹]/g, (digit) => String(FA_DIGITS.indexOf(digit)))
      .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
      .replace(/[٬,]/g, '')
      .trim();
    if (/^-?\d{1,3}(?:٫\d{3})+$/.test(normalized)) normalized = normalized.replace(/٫/g, '');
    else normalized = normalized.replace('٫', '.');
    return Number(normalized);
  }

  function isPersianLocale(locale) {
    return /^(fa|fa[-_])/i.test(String(locale || 'fa-IR'));
  }

  function formatNumber(value, options = {}) {
    const numeric = toNumber(value);
    if (!Number.isFinite(numeric)) return options.invalid ?? '—';

    const {
      locale = 'fa-IR',
      invalid: _invalid,
      ...intlOptions
    } = options;
    const formatted = new Intl.NumberFormat(
      isPersianLocale(locale) ? 'en-US' : locale,
      intlOptions,
    ).format(numeric);
    if (!isPersianLocale(locale)) return formatted;
    return toFaDigits(formatted).replace(/,/g, GROUP_SEPARATOR).replace(/\./g, GROUP_SEPARATOR);
  }

  function formatAmount(value, { locale = 'fa-IR', unit = 'تومان', ...options } = {}) {
    const formatted = formatNumber(value, { locale, maximumFractionDigits: 0, ...options });
    return unit ? `${formatted} ${unit}` : formatted;
  }

  global.WestoPersianFormat = Object.freeze({
    number: formatNumber,
    amount: formatAmount,
    toFaDigits,
    groupSeparator: GROUP_SEPARATOR,
  });
}(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : {}));
