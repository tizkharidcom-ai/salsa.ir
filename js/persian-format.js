/* WESTO Persian number formatting — one presentation rule for all amounts. */
(function (global) {
  'use strict';

  const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
  const GROUP_SEPARATOR = '٫';
  const MONEY_FIELD_PATTERN = /(amount|price|cost|fee|salary|rent|payroll|utility|utilities|sales|variable|balance|wallet|topup|charge|revenue|profit|capital|deposit|withdraw|payment|purchase|commission|packaging|minorder|minspend|maximum|minimum|مبلغ|قیمت|هزینه|بها|کارمزد|حقوق|اجاره|فروش|درآمد|سود|سرمایه|موجودی|شارژ|خرید|دریافت|پرداخت|تخفیف|مالیات|ارزش)/i;
  const NON_MONEY_FIELD_PATTERN = /(quantity|qty|count|headcount|party|points|percent|percentage|vatpercent|duration|days|hours|minutes|month|year|port|priority|stock|reorder|yield|تعداد|مقدار|نفر|امتیاز|درصد|زمان|روز|ساعت|ماه|سال|پورت|اولویت|موجودی اولیه|نقطه سفارش|بازده)/i;

  function toFaDigits(value) {
    return String(value ?? '').replace(/[0-9]/g, (digit) => FA_DIGITS[Number(digit)]);
  }

  function toNumber(value) {
    if (typeof value === 'number') return value;
    let normalized = String(value ?? '')
      .replace(/[۰-۹]/g, (digit) => String(FA_DIGITS.indexOf(digit)))
      .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
      .replace(/تومان|ریال/g, '')
      .replace(/[٬,]/g, '')
      .trim();
    if (/^-?\d{1,3}(?:٫\d{3})+$/.test(normalized)) normalized = normalized.replace(/٫/g, '');
    else normalized = normalized.replace('٫', '.');
    return Number(normalized);
  }

  function formatMoneyInput(value) {
    if (value === null || value === undefined || String(value).trim() === '') return '';
    const normalized = String(value)
      .replace(/[۰-۹]/g, (digit) => String(FA_DIGITS.indexOf(digit)))
      .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
      .replace(/[^0-9-]/g, '');
    if (!normalized || normalized === '-') return normalized;
    const sign = normalized.startsWith('-') ? '-' : '';
    const digits = normalized.replace(/-/g, '').replace(/^0+(?=\d)/, '') || '0';
    return toFaDigits(Number(`${sign}${digits}`).toLocaleString('en-US'))
      .replace(/,/g, GROUP_SEPARATOR);
  }

  function isMoneyInput(input) {
    if (!input || input.nodeType !== 1 || input.tagName !== 'INPUT') return false;
    if (input.dataset.moneyInput === 'true') return true;
    if (input.dataset.moneyInput === 'false' || input.type === 'date' || input.type === 'time' || input.type === 'tel') return false;
    // The Shamsi picker upgrades native date inputs to text inputs. Keep its
    // Persian date display (slashes) out of money grouping, even when the
    // surrounding label contains words such as «سود» or «هزینه».
    if (input.dataset.nativeDateType || input.dataset.shamsiPicker !== undefined || input.classList.contains('shamsi-date-input')) return false;
    const label = input.closest('label')?.textContent || '';
    const identity = [input.name, input.id, input.className].filter(Boolean).join(' ');
    if (/(vendor|supplier|seller|customer|person|spender|receiver|طرف حساب|فروشنده|تأمین‌کننده|تحویل‌گیرنده)/i.test(identity)) return false;
    const source = [identity, input.getAttribute('data-price'), input.getAttribute('data-me-price'), input.placeholder, input.getAttribute('aria-label'), label].filter(Boolean).join(' ');
    return MONEY_FIELD_PATTERN.test(source) && !NON_MONEY_FIELD_PATTERN.test(source);
  }

  function formatMoneyInputNode(input) {
    if (!isMoneyInput(input)) return;
    input.dataset.moneyInput = 'true';
    input.setAttribute('inputmode', 'numeric');
    if (input.type === 'number') input.type = 'text';
    if (input.value) input.value = formatMoneyInput(input.value);
    if (input.dataset.moneyBound === 'true') return;
    input.dataset.moneyBound = 'true';
    input.addEventListener('input', () => {
      const before = input.value;
      const caret = input.selectionStart ?? before.length;
      const digitsBeforeCaret = before.slice(0, caret).replace(/[^0-9۰-۹٠-٩]/g, '').length;
      const formatted = formatMoneyInput(before);
      // React-controlled fields must see an ASCII value in their onChange handler;
      // the microtask restores the Persian presentation after that handler runs.
      input.value = before.trim() ? String(toNumber(before) || 0) : '';
      queueMicrotask(() => { input.value = formatted; });
      if (document.activeElement === input) {
        let position = 0;
        let seen = 0;
        while (position < formatted.length && seen < digitsBeforeCaret) {
          if (/[0-9۰-۹٠-٩]/.test(formatted[position])) seen += 1;
          position += 1;
        }
        try { input.setSelectionRange(position, position); } catch {}
      }
    });
    input.addEventListener('blur', () => { input.value = formatMoneyInput(input.value); });
  }

  function bindMoneyInputs(root = document) {
    if (!root?.querySelectorAll) return;
    if (root.matches?.('input')) formatMoneyInputNode(root);
    root.querySelectorAll('input').forEach(formatMoneyInputNode);
  }

  function installMoneyInputBinding() {
    if (typeof document === 'undefined' || document.documentElement.dataset.westoMoneyBinding === 'true') return;
    document.documentElement.dataset.westoMoneyBinding = 'true';
    bindMoneyInputs(document);
    new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => {
      if (node.nodeType === 1) bindMoneyInputs(node);
    }))).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('formdata', (event) => {
      const form = event.target;
      if (!form?.elements) return;
      [...form.elements].filter(isMoneyInput).forEach((input) => {
        if (input.name) event.formData.set(input.name, String(toNumber(input.value) || 0));
      });
    });
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
    parse: toNumber,
    formatMoneyInput,
    bindMoneyInputs,
    toFaDigits,
    groupSeparator: GROUP_SEPARATOR,
  });
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installMoneyInputBinding, { once: true });
    else installMoneyInputBinding();
  }
}(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : {}));
