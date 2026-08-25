'use strict';

/**
 * WESTO Shamsi (Jalali) Interactive DatePicker & Calendar UI Component
 * Full-featured Persian calendar picker with dark glassmorphism styling, year/month navigation,
 * single & range selection, ISO synchronization, and universal auto-enhancement for date inputs.
 */

(function (root, factory) {
  const resolvedCore = typeof root !== 'undefined' && root.ShamsiCore
    ? root.ShamsiCore
    : (typeof window !== 'undefined' && window.ShamsiCore
      ? window.ShamsiCore
      : (typeof globalThis !== 'undefined' && globalThis.ShamsiCore ? globalThis.ShamsiCore : null));
  const lib = factory(resolvedCore);
  if (typeof module === 'object' && module.exports) {
    module.exports = lib;
  }
  if (typeof root !== 'undefined') {
    root.ShamsiDatePicker = lib;
  }
  if (typeof window !== 'undefined') {
    window.ShamsiDatePicker = lib;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.ShamsiDatePicker = lib;
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this)), function (ShamsiCore) {

  if (!ShamsiCore) {
    console.error('[ShamsiDatePicker] ShamsiCore library is required.');
    return {};
  }

  const {
    toFaDigits,
    toEnDigits,
    gregorianToJalali,
    jalaliToGregorian,
    getJalaliMonthDays,
    JALALI_MONTH_NAMES,
    JALALI_WEEKDAYS_SHORT,
    toShamsiParts,
    formatShamsiDate,
    parseDateInput,
  } = ShamsiCore;

  const padZero = (value) => String(Number(value) || 0).padStart(2, '0');
  const isoDateFromGregorian = ({ gy, gm, gd }) => `${gy}-${padZero(gm)}-${padZero(gd)}`;
  const canonicalDatePart = (value) => {
    const raw = toEnDigits(String(value || '')).trim();
    const gregorian = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (gregorian && Number(gregorian[1]) > 1600) return `${gregorian[1]}-${gregorian[2]}-${gregorian[3]}`;
    const jalali = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
    if (jalali && Number(jalali[1]) >= 1200 && Number(jalali[1]) <= 1600) {
      return isoDateFromGregorian(jalaliToGregorian(Number(jalali[1]), Number(jalali[2]), Number(jalali[3])));
    }
    return '';
  };
  const canonicalTimePart = (value) => {
    const match = toEnDigits(String(value || '')).match(/[T\s](\d{1,2}):(\d{2})/);
    return match ? `${padZero(match[1])}:${padZero(match[2])}` : '00:00';
  };

  let activePopover = null;
  let activeInstance = null;

  class ShamsiDatePickerInstance {
    constructor(inputElement, options = {}) {
      this.input = typeof inputElement === 'string' ? document.querySelector(inputElement) : inputElement;
      if (!this.input) return;

      this.input._shamsiPicker = this;

      this.opts = Object.assign({
        mode: 'single', // 'single' | 'range'
        minDate: null,
        maxDate: null,
        useFaDigits: true,
        autoClose: true,
        placeholder: 'انتخاب تاریخ شمسی...',
        onSelect: null,
        includeTime: false,
        sourceType: '',
        initialValue: '',
      }, options);

      this.sourceType = this.opts.sourceType || this.input.dataset.nativeDateType || this.input.type || 'text';
      this.includeTime = this.opts.includeTime || this.sourceType === 'datetime-local';
      this.timeValue = '00:00';

      this.currentViewYear = 1405;
      this.currentViewMonth = 6;
      this.selectedJalali = null;
      this.rangeStartJalali = null;
      this.rangeEndJalali = null;

      this.init();
    }

    init() {
      // Determine initial date
      const initialVal = this.opts.initialValue
        || this.input.dataset.isoDateTime
        || this.input.dataset.isoDate
        || this.input.value
        || this.input.dataset.defaultDate;
      const initialParts = toShamsiParts(initialVal || new Date());
      this.currentViewYear = initialParts.year;
      this.currentViewMonth = initialParts.month;
      this.timeValue = this.includeTime ? canonicalTimePart(initialVal) : '00:00';

      if (initialVal) {
        this.selectedJalali = { jy: initialParts.year, jm: initialParts.month, jd: initialParts.day };
        this.updateInputDisplay(canonicalDatePart(initialVal) || initialParts.isoDate, initialParts.shamsiString, true);
      }

      this.wrapInput();
      this.attachEvents();
    }

    wrapInput() {
      if (this.input.parentElement.classList.contains('shamsi-date-trigger-wrapper')) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'shamsi-date-trigger-wrapper';

      this.input.parentNode.insertBefore(wrapper, this.input);
      wrapper.appendChild(this.input);

      this.input.classList.add('shamsi-date-input');
      this.input.readOnly = true; // prevent mobile virtual keyboard opening native date
      this.input.setAttribute('dir', 'ltr');
      this.input.setAttribute('aria-haspopup', 'dialog');
      this.input.setAttribute('aria-expanded', 'false');

      if (!this.input.placeholder) {
        this.input.placeholder = this.opts.placeholder;
      }

      // Add Calendar SVG Icon
      const icon = document.createElement('span');
      icon.className = 'shamsi-date-icon';
      icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="18" y2="10"></line></svg>`;
      wrapper.appendChild(icon);
    }

    attachEvents() {
      this.input.addEventListener('click', (e) => {
        e.stopPropagation();
        this.open();
      });
    }

    open() {
      if (activePopover && activeInstance === this) return;
      if (activePopover) closeActivePopover();

      const canonical = this.includeTime ? this.input.dataset.isoDateTime : this.input.dataset.isoDate;
      if (canonical) {
        const parts = toShamsiParts(canonical);
        this.selectedJalali = { jy: parts.year, jm: parts.month, jd: parts.day };
        this.currentViewYear = parts.year;
        this.currentViewMonth = parts.month;
        if (this.includeTime) this.timeValue = canonicalTimePart(canonical);
      }

      activeInstance = this;
      activePopover = this.createPopover();
      document.body.appendChild(activePopover);

      this.render();
      this.positionPopover();

      setTimeout(() => {
        if (activePopover) activePopover.classList.add('active');
      }, 10);

      this.input.classList.add('active');
      this.input.setAttribute('aria-expanded', 'true');
    }

    createPopover() {
      const popover = document.createElement('div');
      popover.className = 'shamsi-datepicker-popover';
      popover.setAttribute('role', 'dialog');
      popover.setAttribute('aria-label', this.includeTime ? 'انتخاب تاریخ و ساعت شمسی' : 'انتخاب تاریخ شمسی');
      popover.addEventListener('click', (e) => e.stopPropagation());
      return popover;
    }

    positionPopover() {
      if (!activePopover || !this.input) return;
      const rect = this.input.getBoundingClientRect();
      const popHeight = 360;
      const popWidth = 320;

      let top = rect.bottom + window.scrollY + 6;
      let left = rect.right + window.scrollX - popWidth;

      // Viewport bounds checking
      if (left < 10) left = 10;
      if (top + popHeight > window.innerHeight + window.scrollY && rect.top - popHeight > 0) {
        top = rect.top + window.scrollY - popHeight - 6;
      }

      if (window.innerWidth <= 480) {
        activePopover.style.position = 'fixed';
        activePopover.style.inset = 'auto 8px 8px 8px';
        activePopover.style.width = 'auto';
      } else {
        activePopover.style.position = 'absolute';
        activePopover.style.inset = 'auto';
        activePopover.style.width = `${popWidth}px`;
        activePopover.style.top = `${top}px`;
        activePopover.style.left = `${left}px`;
      }
    }

    render() {
      if (!activePopover) return;
      activePopover.innerHTML = '';

      // Header
      const header = document.createElement('div');
      header.className = 'sdp-header';

      // Next Month Button (< in RTL moves to next month)
      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'sdp-nav-btn';
      nextBtn.innerHTML = '‹';
      nextBtn.title = 'ماه بعد';
      nextBtn.onclick = () => this.changeMonth(1);

      // Prev Month Button (> in RTL moves to prev month)
      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'sdp-nav-btn';
      prevBtn.innerHTML = '›';
      prevBtn.title = 'ماه قبل';
      prevBtn.onclick = () => this.changeMonth(-1);

      // Selectors Container
      const selectors = document.createElement('div');
      selectors.className = 'sdp-selectors';

      // Month Select
      const monthSel = document.createElement('select');
      monthSel.className = 'sdp-select';
      JALALI_MONTH_NAMES.forEach((mName, idx) => {
        const opt = document.createElement('option');
        opt.value = idx + 1;
        opt.textContent = mName;
        if (idx + 1 === this.currentViewMonth) opt.selected = true;
        monthSel.appendChild(opt);
      });
      monthSel.onchange = (e) => {
        this.currentViewMonth = parseInt(e.target.value, 10);
        this.render();
      };

      // Year Select
      const yearSel = document.createElement('select');
      yearSel.className = 'sdp-select';
      const startYear = Math.min(1380, this.currentViewYear - 40);
      const endYear = Math.max(1450, this.currentViewYear + 40);
      for (let y = startYear; y <= endYear; y++) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = toFaDigits(String(y));
        if (y === this.currentViewYear) opt.selected = true;
        yearSel.appendChild(opt);
      }
      yearSel.onchange = (e) => {
        this.currentViewYear = parseInt(e.target.value, 10);
        this.render();
      };

      selectors.appendChild(monthSel);
      selectors.appendChild(yearSel);

      header.appendChild(prevBtn);
      header.appendChild(selectors);
      header.appendChild(nextBtn);
      activePopover.appendChild(header);

      // Weekday Headers: شنبه تا جمعه (ش، ی، د، س، چ، پ، ج)
      const weekdays = document.createElement('div');
      weekdays.className = 'sdp-weekdays';
      const weekOrder = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
      weekOrder.forEach((w) => {
        const span = document.createElement('div');
        span.textContent = w;
        weekdays.appendChild(span);
      });
      activePopover.appendChild(weekdays);

      // Days Grid
      const daysGrid = document.createElement('div');
      daysGrid.className = 'sdp-days-grid';

      // Calculate first day of month weekday
      const firstDayGreg = jalaliToGregorian(this.currentViewYear, this.currentViewMonth, 1);
      const firstDayDate = new Date(firstDayGreg.gy, firstDayGreg.gm - 1, firstDayGreg.gd);
      // JS day: 0=Sun, 1=Mon, ..., 6=Sat
      // We want Saturday=0, Sunday=1, ..., Friday=6
      const jsDay = firstDayDate.getDay();
      const startOffset = (jsDay + 1) % 7;

      // Empty lead days
      for (let i = 0; i < startOffset; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'sdp-day sdp-empty';
        daysGrid.appendChild(emptyCell);
      }

      const totalDays = getJalaliMonthDays(this.currentViewYear, this.currentViewMonth);
      const todayParts = toShamsiParts(new Date());

      for (let d = 1; d <= totalDays; d++) {
        const dayCell = document.createElement('button');
        dayCell.type = 'button';
        dayCell.className = 'sdp-day';
        dayCell.textContent = this.opts.useFaDigits ? toFaDigits(String(d)) : String(d);

        const currentJ = { jy: this.currentViewYear, jm: this.currentViewMonth, jd: d };

        // Is Today
        if (todayParts.year === currentJ.jy && todayParts.month === currentJ.jm && todayParts.day === currentJ.jd) {
          dayCell.classList.add('sdp-today');
        }

        // Is Friday
        const dayGreg = jalaliToGregorian(currentJ.jy, currentJ.jm, d);
        const dayObj = new Date(dayGreg.gy, dayGreg.gm - 1, dayGreg.gd);
        const isoDate = isoDateFromGregorian(dayGreg);
        const minDate = canonicalDatePart(this.input.getAttribute('min') || this.opts.minDate);
        const maxDate = canonicalDatePart(this.input.getAttribute('max') || this.opts.maxDate);
        const disabled = Boolean((minDate && isoDate < minDate) || (maxDate && isoDate > maxDate));
        if (dayObj.getDay() === 5) {
          dayCell.classList.add('sdp-friday');
        }

        // Is Selected
        if (this.selectedJalali && this.selectedJalali.jy === currentJ.jy && this.selectedJalali.jm === currentJ.jm && this.selectedJalali.jd === currentJ.jd) {
          dayCell.classList.add('sdp-selected');
        }

        dayCell.setAttribute('aria-label', `${d} ${JALALI_MONTH_NAMES[this.currentViewMonth - 1]} ${this.currentViewYear}`);
        if (disabled) {
          dayCell.classList.add('sdp-disabled');
          dayCell.disabled = true;
        } else {
          dayCell.onclick = () => this.selectDay(currentJ, dayObj);
        }

        daysGrid.appendChild(dayCell);
      }

      activePopover.appendChild(daysGrid);

      if (this.includeTime) {
        const timeRow = document.createElement('label');
        timeRow.className = 'sdp-time-row';
        const timeLabel = document.createElement('span');
        timeLabel.textContent = 'ساعت';
        const timeInput = document.createElement('input');
        timeInput.type = 'time';
        timeInput.step = '60';
        timeInput.value = this.timeValue;
        timeInput.setAttribute('aria-label', 'ساعت به وقت محلی');
        timeInput.addEventListener('change', () => {
          this.timeValue = timeInput.value || '00:00';
          if (!this.selectedJalali) return;
          const selectedGregorian = jalaliToGregorian(this.selectedJalali.jy, this.selectedJalali.jm, this.selectedJalali.jd);
          const shamsi = `${this.selectedJalali.jy}/${padZero(this.selectedJalali.jm)}/${padZero(this.selectedJalali.jd)}`;
          this.updateInputDisplay(isoDateFromGregorian(selectedGregorian), shamsi);
        });
        timeRow.append(timeLabel, timeInput);
        activePopover.appendChild(timeRow);
      }

      // Footer: Quick Actions
      const footer = document.createElement('div');
      footer.className = 'sdp-footer';

      const todayBtn = document.createElement('button');
      todayBtn.type = 'button';
      todayBtn.className = 'sdp-btn-link';
      todayBtn.textContent = 'امروز';
      todayBtn.onclick = () => {
        const tParts = toShamsiParts(new Date());
        this.currentViewYear = tParts.year;
        this.currentViewMonth = tParts.month;
        const todayIso = tParts.isoDate;
        const minDate = canonicalDatePart(this.input.getAttribute('min') || this.opts.minDate);
        const maxDate = canonicalDatePart(this.input.getAttribute('max') || this.opts.maxDate);
        if ((!minDate || todayIso >= minDate) && (!maxDate || todayIso <= maxDate)) {
          this.selectDay({ jy: tParts.year, jm: tParts.month, jd: tParts.day }, new Date());
        }
      };

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'sdp-btn-link sdp-clear';
      clearBtn.textContent = 'پاک کردن';
      clearBtn.onclick = () => this.clear();

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'sdp-btn-link';
      closeBtn.textContent = 'بستن';
      closeBtn.onclick = () => closeActivePopover();

      footer.appendChild(todayBtn);
      footer.appendChild(clearBtn);
      footer.appendChild(closeBtn);
      activePopover.appendChild(footer);
    }

    changeMonth(delta) {
      this.currentViewMonth += delta;
      if (this.currentViewMonth > 12) {
        this.currentViewMonth = 1;
        this.currentViewYear += 1;
      } else if (this.currentViewMonth < 1) {
        this.currentViewMonth = 12;
        this.currentViewYear -= 1;
      }
      this.render();
    }

    selectDay(jalaliDate, gregorianDate) {
      this.selectedJalali = jalaliDate;
      const isoDate = `${gregorianDate.getFullYear()}-${padZero(gregorianDate.getMonth() + 1)}-${padZero(gregorianDate.getDate())}`;
      const shamsiStr = `${jalaliDate.jy}/${padZero(jalaliDate.jm)}/${padZero(jalaliDate.jd)}`;

      this.updateInputDisplay(isoDate, shamsiStr);

      if (this.includeTime) {
        const [hour, minute] = this.timeValue.split(':').map(Number);
        gregorianDate.setHours(hour || 0, minute || 0, 0, 0);
      }

      if (typeof this.opts.onSelect === 'function') {
        this.opts.onSelect(gregorianDate, shamsiStr, isoDate);
      }

      if (this.opts.autoClose) {
        closeActivePopover();
      } else {
        this.render();
      }
    }

    updateInputDisplay(isoDate, shamsiStr, silent = false) {
      this.input.dataset.isoDate = isoDate;
      let displayValue = shamsiStr;
      if (this.includeTime) {
        this.input.dataset.isoDateTime = `${isoDate}T${this.timeValue}`;
        displayValue = `${shamsiStr}، ساعت ${this.timeValue}`;
      } else {
        delete this.input.dataset.isoDateTime;
      }
      this.input.value = this.opts.useFaDigits ? toFaDigits(displayValue) : displayValue;

      // Dispatch input & change events
      if (!silent) {
        this.input.dispatchEvent(new Event('input', { bubbles: true }));
        this.input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    clear() {
      this.selectedJalali = null;
      this.input.dataset.isoDate = '';
      this.input.dataset.isoDateTime = '';
      this.input.value = '';
      this.input.dispatchEvent(new Event('input', { bubbles: true }));
      this.input.dispatchEvent(new Event('change', { bubbles: true }));
      closeActivePopover();
    }
  }

  function closeActivePopover() {
    if (activePopover) {
      activePopover.classList.remove('active');
      setTimeout(() => {
        if (activePopover && activePopover.parentNode) {
          activePopover.parentNode.removeChild(activePopover);
        }
        activePopover = null;
      }, 150);
    }
    if (activeInstance && activeInstance.input) {
      activeInstance.input.classList.remove('active');
      activeInstance.input.setAttribute('aria-expanded', 'false');
    }
    activeInstance = null;
  }

  // Global document click to close popover
  document.addEventListener('click', (e) => {
    if (activePopover && !activePopover.contains(e.target)) {
      closeActivePopover();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && activePopover) closeActivePopover();
  });

  // Window resize to reposition
  window.addEventListener('resize', () => {
    if (activeInstance) activeInstance.positionPopover();
  });

  /**
   * Universal Auto-Initialization
   */
  function autoInit(container = document) {
    const matches = (selector) => {
      const nodes = [];
      if (container?.nodeType === 1 && container.matches(selector)) nodes.push(container);
      if (typeof container?.querySelectorAll === 'function') nodes.push(...container.querySelectorAll(selector));
      return nodes;
    };

    // 1. Upgrade inputs with data-shamsi-picker or class shamsi-picker
    const customPickers = matches('input[data-shamsi-picker], input.shamsi-date-picker, input.shamsi-datepicker');
    customPickers.forEach((inp) => {
      if (!inp._shamsiPicker && !['date', 'datetime-local'].includes(inp.type)) {
        inp._shamsiPicker = new ShamsiDatePickerInstance(inp);
      }
    });

    // 2. Upgrade native date and datetime-local inputs while preserving an ISO data contract.
    const nativeDateInputs = matches('input[type="date"], input[type="datetime-local"]');
    nativeDateInputs.forEach((inp) => {
      if (!inp._shamsiPicker) {
        const sourceType = inp.type;
        const initialValue = inp.value;
        inp.dataset.nativeDateType = sourceType;
        if (sourceType === 'datetime-local') inp.dataset.isoDateTime = initialValue;
        else inp.dataset.isoDate = initialValue;
        inp.type = 'text';
        inp._shamsiPicker = new ShamsiDatePickerInstance(inp, {
          sourceType,
          includeTime: sourceType === 'datetime-local',
          initialValue,
        });
      }
    });
  }

  function getISOValue(inputElement) {
    const input = typeof inputElement === 'string' ? document.querySelector(inputElement) : inputElement;
    if (!input) return '';
    if (input.dataset.nativeDateType === 'datetime-local' || input._shamsiPicker?.includeTime) {
      return input.dataset.isoDateTime || '';
    }
    return input.dataset.isoDate || input.value || '';
  }

  function setISOValue(inputElement, value, { silent = false } = {}) {
    const input = typeof inputElement === 'string' ? document.querySelector(inputElement) : inputElement;
    if (!input) return '';
    const picker = input._shamsiPicker;
    const isoDate = canonicalDatePart(value);
    if (!isoDate) {
      if (picker) picker.clear();
      else input.value = '';
      return '';
    }
    const parts = toShamsiParts(isoDate);
    if (picker) {
      picker.timeValue = picker.includeTime ? canonicalTimePart(value) : '00:00';
      picker.selectedJalali = { jy: parts.year, jm: parts.month, jd: parts.day };
      picker.updateInputDisplay(isoDate, parts.shamsiString, silent);
      return getISOValue(input);
    }
    input.dataset.isoDate = isoDate;
    input.value = toFaDigits(parts.shamsiString);
    return isoDate;
  }

  // Auto-init on DOMContentLoaded
  if (typeof document !== 'undefined') {
    const boot = () => {
      autoInit();
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) autoInit(node);
        }));
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      setTimeout(boot, 0);
    }
  }

  return {
    ShamsiDatePickerInstance,
    autoInit,
    close: closeActivePopover,
    getISOValue,
    setISOValue,
    attach: (el, opts) => {
      const input = typeof el === 'string' ? document.querySelector(el) : el;
      if (!input) return null;
      return input._shamsiPicker || new ShamsiDatePickerInstance(input, opts);
    },
  };
}));
