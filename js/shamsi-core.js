'use strict';

/**
 * WESTO Shamsi (Jalali) Core Calendar Engine
 * Accurate conversion between Gregorian and Solar Hijri (Shamsi/Jalali) calendars.
 * Uses native Intl engine with high-precision bidirectional conversion and Persian formatting.
 */

(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = lib;
  }
  if (typeof root !== 'undefined') {
    root.ShamsiCore = lib;
  }
  if (typeof window !== 'undefined') {
    window.ShamsiCore = lib;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.ShamsiCore = lib;
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this)), function () {

  const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  const EN_DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };

  const JALALI_MONTH_NAMES = [
    'فروردین',
    'اردیبهشت',
    'خرداد',
    'تیر',
    'مرداد',
    'شهریور',
    'مهر',
    'آبان',
    'آذر',
    'دی',
    'بهمن',
    'اسفند',
  ];

  const JALALI_WEEKDAYS = [
    'یکشنبه',
    'دوشنبه',
    'سه‌شنبه',
    'چهارشنبه',
    'پنجشنبه',
    'جمعه',
    'شنبه',
  ];

  const JALALI_WEEKDAYS_SHORT = ['ی', 'د', 'س', 'چ', 'پ', 'ج', 'ش'];

  function toFaDigits(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[0-9]/g, (d) => FA_DIGITS[parseInt(d, 10)]);
  }

  function toEnDigits(str) {
    if (!str) return '';
    return String(str).replace(/[۰-۹]/g, (d) => EN_DIGITS[d] || d);
  }

  function padZero(num, size = 2) {
    let s = String(num);
    while (s.length < size) s = '0' + s;
    return s;
  }

  const persianFormatter = new Intl.DateTimeFormat('en-US-u-ca-persian', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
    timeZone: 'Asia/Tehran',
  });

  /**
   * Gregorian Date to Jalali.
   * Supports gregorianToJalali(dateInput) or gregorianToJalali(gy, gm, gd).
   */
  function gregorianToJalali(gyOrInput, gm, gd) {
    let d;
    if (typeof gyOrInput === 'number' && typeof gm === 'number' && typeof gd === 'number') {
      d = new Date(Date.UTC(gyOrInput, gm - 1, gd, 12, 0, 0));
    } else {
      d = parseDateInput(gyOrInput);
    }
    const parts = persianFormatter.formatToParts(d);
    const map = {};
    parts.forEach((p) => { map[p.type] = p.value; });

    const jy = parseInt(map.year, 10) || 1405;
    const jm = parseInt(map.month, 10) || 1;
    const jd = parseInt(map.day, 10) || 1;
    const hour = parseInt(map.hour || 0, 10);
    const minute = parseInt(map.minute || 0, 10);
    const second = parseInt(map.second || 0, 10);

    return { jy, jm, jd, hour, minute, second };
  }

  /**
   * Jalali to Gregorian.
   */
  function jalaliToGregorian(jy, jm, jd) {
    jy = Number(toEnDigits(String(jy)));
    jm = Number(toEnDigits(String(jm)));
    jd = Number(toEnDigits(String(jd)));

    const gYear = jy + 621;
    for (let offset = -20; offset <= 380; offset++) {
      const d = new Date(Date.UTC(gYear, 2, 20 + offset));
      const j = gregorianToJalali(d);
      if (j.jy === jy && j.jm === jm && j.jd === jd) {
        return { gy: d.getUTCFullYear(), gm: d.getUTCMonth() + 1, gd: d.getUTCDate() };
      }
    }
    return { gy: gYear, gm: 1, gd: 1 };
  }

  /**
   * Checks if a Jalali year is leap year (کبیسه).
   */
  function isJalaliLeapYear(jy) {
    // 30 days in Esfand
    const g = jalaliToGregorian(jy, 12, 30);
    const j = gregorianToJalali(new Date(Date.UTC(g.gy, g.gm - 1, g.gd)));
    return j.jy === jy && j.jm === 12 && j.jd === 30;
  }

  /**
   * Number of days in a Jalali month.
   */
  function getJalaliMonthDays(jy, jm) {
    if (jm >= 1 && jm <= 6) return 31;
    if (jm >= 7 && jm <= 11) return 30;
    if (jm === 12) return isJalaliLeapYear(jy) ? 30 : 29;
    return 30;
  }

  /**
   * Parses any Date input (Date, ISO string, timestamp, Shamsi string).
   */
  function parseDateInput(input) {
    if (!input) return new Date();
    if (input instanceof Date) return isNaN(input.getTime()) ? new Date() : input;
    if (typeof input === 'number') return new Date(input);

    const s = toEnDigits(String(input)).trim();

    // Check if it's already Shamsi string e.g. "1405/06/02" or "1405-06-02"
    const shamsiMatch = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
    if (shamsiMatch) {
      const jy = parseInt(shamsiMatch[1], 10);
      const jm = parseInt(shamsiMatch[2], 10);
      const jd = parseInt(shamsiMatch[3], 10);
      const hr = parseInt(shamsiMatch[4] || 0, 10);
      const mn = parseInt(shamsiMatch[5] || 0, 10);
      const sc = parseInt(shamsiMatch[6] || 0, 10);

      if (jy >= 1200 && jy <= 1600 && jm >= 1 && jm <= 12 && jd >= 1 && jd <= 31) {
        const { gy, gm, gd } = jalaliToGregorian(jy, jm, jd);
        return new Date(gy, gm - 1, gd, hr, mn, sc);
      }
    }

    const parsed = new Date(s);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  /**
   * Converts a Date into rich Shamsi parts.
   */
  function toShamsiParts(dateInput) {
    const d = parseDateInput(dateInput);
    const { jy, jm, jd, hour, minute, second } = gregorianToJalali(d);

    const dayOfWeek = d.getDay(); // 0 is Sunday, 6 is Saturday
    const weekdayName = JALALI_WEEKDAYS[dayOfWeek];
    const weekdayShort = JALALI_WEEKDAYS_SHORT[dayOfWeek];
    const monthName = JALALI_MONTH_NAMES[jm - 1];

    const gy = d.getFullYear();
    const gm = d.getMonth() + 1;
    const gd = d.getDate();

    return {
      year: jy,
      month: jm,
      day: jd,
      hours: hour,
      minutes: minute,
      seconds: second,
      monthName,
      weekdayName,
      weekdayShort,
      dayOfWeek,
      isLeapYear: isJalaliLeapYear(jy),
      dateObj: d,
      isoDate: `${gy}-${padZero(gm)}-${padZero(gd)}`,
      isoDateTime: d.toISOString(),
      shamsiString: `${jy}/${padZero(jm)}/${padZero(jd)}`,
    };
  }

  /**
   * Formats date into custom Shamsi string.
   */
  function formatShamsi(dateInput, formatStr = 'YYYY/MM/DD', opts = {}) {
    const { useFaDigits = true } = opts;
    const p = toShamsiParts(dateInput);

    let res = formatStr
      .replace(/YYYY/g, String(p.year))
      .replace(/YY/g, String(p.year).slice(-2))
      .replace(/MMMM/g, p.monthName)
      .replace(/MM/g, padZero(p.month))
      .replace(/M/g, String(p.month))
      .replace(/DD/g, padZero(p.day))
      .replace(/D/g, String(p.day))
      .replace(/dddd/g, p.weekdayName)
      .replace(/ddd/g, p.weekdayShort)
      .replace(/HH/g, padZero(p.hours))
      .replace(/mm/g, padZero(p.minutes))
      .replace(/ss/g, padZero(p.seconds));

    return useFaDigits ? toFaDigits(res) : res;
  }

  function formatShamsiDate(dateInput, opts = {}) {
    return formatShamsi(dateInput, 'YYYY/MM/DD', opts);
  }

  function formatShamsiDateLong(dateInput, opts = {}) {
    return formatShamsi(dateInput, 'D MMMM YYYY', opts);
  }

  function formatShamsiDateFull(dateInput, opts = {}) {
    return formatShamsi(dateInput, 'dddd D MMMM YYYY', opts);
  }

  function formatShamsiDateTime(dateInput, opts = {}) {
    return formatShamsi(dateInput, 'YYYY/MM/DD - HH:mm', opts);
  }

  function formatShamsiDateTimeFull(dateInput, opts = {}) {
    return formatShamsi(dateInput, 'dddd D MMMM YYYY ساعت HH:mm', opts);
  }

  function formatShamsiTime(dateInput, opts = {}) {
    return formatShamsi(dateInput, 'HH:mm', opts);
  }

  function relativeShamsi(dateInput) {
    const d = parseDateInput(dateInput);
    const now = new Date();
    const diffSec = Math.round((now.getTime() - d.getTime()) / 1000);

    if (diffSec < 45) return 'همین الان';
    if (diffSec < 90) return 'یک دقیقه پیش';
    if (diffSec < 3600) return `${toFaDigits(Math.round(diffSec / 60))} دقیقه پیش`;
    if (diffSec < 7200) return 'یک ساعت پیش';
    if (diffSec < 86400) return `${toFaDigits(Math.round(diffSec / 3600))} ساعت پیش`;
    if (diffSec < 172800) return 'دیروز';
    if (diffSec < 2592000) return `${toFaDigits(Math.round(diffSec / 86400))} روز پیش`;
    if (diffSec < 5184000) return 'یک ماه پیش';
    if (diffSec < 31536000) return `${toFaDigits(Math.round(diffSec / 2592000))} ماه پیش`;
    return `${toFaDigits(Math.round(diffSec / 31536000))} سال پیش`;
  }

  return {
    toFaDigits,
    toEnDigits,
    gregorianToJalali,
    jalaliToGregorian,
    isJalaliLeapYear,
    getJalaliMonthDays,
    JALALI_MONTH_NAMES,
    JALALI_WEEKDAYS,
    JALALI_WEEKDAYS_SHORT,
    toShamsiParts,
    formatShamsi,
    formatShamsiDate,
    formatShamsiDateLong,
    formatShamsiDateFull,
    formatShamsiDateTime,
    formatShamsiDateTimeFull,
    formatShamsiTime,
    relativeShamsi,
    parseDateInput,
  };
}));
