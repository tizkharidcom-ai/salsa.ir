/**
 * WESTO Apple-Style Shamsi 3D Wheel Date Picker (دیت‌پیکر چرخشی اپل شمسی وستو)
 * Supports full touch inertia, mouse dragging, wheel scrolling, and dynamic Shamsi leap year calculations.
 */
(function (global) {
  'use strict';

  const SHAMSI_MONTHS = [
    'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
  ];

  const ITEM_HEIGHT = 42;
  const VISIBLE_ITEMS = 5;
  const CENTER_INDEX = 2; // Middle item out of 5

  function isShamsiLeapYear(year) {
    // 33-year cycle standard Shamsi algorithm
    const a = (year - 474) % 2820 + 474;
    const b = (a * 682 - 110) % 2816;
    return b < 682;
  }

  function getDaysInShamsiMonth(year, monthIndex) {
    if (monthIndex < 6) return 31; // Farvardin - Shahrivar
    if (monthIndex < 11) return 30; // Mehr - Bahman
    return isShamsiLeapYear(year) ? 30 : 29; // Esfand
  }

  function toFaDigits(num) {
    return String(num).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
  }

  class WheelColumnController {
    constructor(containerEl, items, initialIndex, onSelect) {
      this.container = containerEl;
      this.track = containerEl.querySelector('.shamsi-wheel-track');
      this.items = items;
      this.selectedIndex = Math.max(0, Math.min(items.length - 1, initialIndex));
      this.onSelect = onSelect;
      this.y = -this.selectedIndex * ITEM_HEIGHT;
      this.targetY = this.y;
      this.isDragging = false;
      this.startY = 0;
      this.startPosY = 0;
      this.lastY = 0;
      this.lastTime = 0;
      this.velocity = 0;
      this.animId = null;

      this.renderItems();
      this.bindEvents();
      this.updateTransforms();
    }

    setItems(newItems, preferredIndex) {
      this.items = newItems;
      if (preferredIndex !== undefined) {
        this.selectedIndex = Math.max(0, Math.min(newItems.length - 1, preferredIndex));
      } else {
        this.selectedIndex = Math.min(this.selectedIndex, newItems.length - 1);
      }
      this.y = -this.selectedIndex * ITEM_HEIGHT;
      this.targetY = this.y;
      this.renderItems();
      this.updateTransforms();
    }

    renderItems() {
      this.track.innerHTML = this.items.map((item, i) => `
        <div class="shamsi-wheel-item ${i === this.selectedIndex ? 'is-selected' : ''}" data-index="${i}">
          ${typeof item === 'number' ? toFaDigits(item) : item}
        </div>
      `).join('');
    }

    updateTransforms() {
      const currentScrollIndex = -this.y / ITEM_HEIGHT;

      const itemEls = this.track.children;
      for (let i = 0; i < itemEls.length; i++) {
        const el = itemEls[i];
        const dist = i - currentScrollIndex;
        const absDist = Math.abs(dist);

        if (absDist > 3.2) {
          el.style.opacity = '0';
          el.style.transform = 'translateY(0) rotateX(0deg) scale(0.7)';
          continue;
        }

        const rotateX = Math.max(-50, Math.min(50, dist * 22));
        const scale = Math.max(0.85, 1 - absDist * 0.08);
        const opacity = Math.max(0.48, 1 - absDist * 0.28);

        el.style.opacity = opacity.toFixed(2);
        el.style.transform = `rotateX(${rotateX.toFixed(1)}deg) scale(${scale.toFixed(2)})`;
        el.classList.toggle('is-selected', Math.round(currentScrollIndex) === i);
      }

      this.track.style.transform = `translate3d(0, ${this.y}px, 0)`;
    }

    snapToIndex(index, animate = true) {
      this.selectedIndex = Math.max(0, Math.min(this.items.length - 1, index));
      this.targetY = -this.selectedIndex * ITEM_HEIGHT;

      if (!animate) {
        this.y = this.targetY;
        this.updateTransforms();
        if (this.onSelect) this.onSelect(this.selectedIndex, this.items[this.selectedIndex]);
        return;
      }

      this.animateToTarget();
    }

    animateToTarget() {
      if (this.animId) cancelAnimationFrame(this.animId);

      const step = () => {
        const diff = this.targetY - this.y;
        if (Math.abs(diff) < 0.5) {
          this.y = this.targetY;
          this.updateTransforms();
          if (this.onSelect) this.onSelect(this.selectedIndex, this.items[this.selectedIndex]);
          return;
        }

        this.y += diff * 0.22;
        this.updateTransforms();
        this.animId = requestAnimationFrame(step);
      };

      this.animId = requestAnimationFrame(step);
    }

    bindEvents() {
      const onStart = (clientY) => {
        if (this.animId) cancelAnimationFrame(this.animId);
        this.isDragging = true;
        this.startY = clientY;
        this.startPosY = this.y;
        this.lastY = clientY;
        this.lastTime = Date.now();
        this.velocity = 0;
      };

      const onMove = (clientY) => {
        if (!this.isDragging) return;
        const now = Date.now();
        const dt = now - this.lastTime;
        const dy = clientY - this.lastY;

        if (dt > 0) {
          this.velocity = (dy / dt) * 15;
        }

        this.lastY = clientY;
        this.lastTime = now;

        const delta = clientY - this.startY;
        let newY = this.startPosY + delta;

        // Rubber banding limits
        const minY = -(this.items.length - 1) * ITEM_HEIGHT;
        const maxY = 0;
        if (newY > maxY) newY = maxY + (newY - maxY) * 0.35;
        if (newY < minY) newY = minY + (newY - minY) * 0.35;

        this.y = newY;
        this.updateTransforms();
      };

      const onEnd = () => {
        if (!this.isDragging) return;
        this.isDragging = false;

        const projectedY = this.y + this.velocity * 3.5;
        let targetIndex = Math.round(-projectedY / ITEM_HEIGHT);
        targetIndex = Math.max(0, Math.min(this.items.length - 1, targetIndex));

        this.snapToIndex(targetIndex, true);
      };

      // Pointer / Touch events
      this.container.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.container.setPointerCapture(e.pointerId);
        onStart(e.clientY);
      });

      this.container.addEventListener('pointermove', (e) => {
        if (this.isDragging) {
          e.preventDefault();
          onMove(e.clientY);
        }
      });

      const finishPointer = (e) => {
        if (this.isDragging) {
          try { this.container.releasePointerCapture(e.pointerId); } catch (_) {}
          onEnd();
        }
      };

      this.container.addEventListener('pointerup', finishPointer);
      this.container.addEventListener('pointercancel', finishPointer);

      // Mouse Wheel
      this.container.addEventListener('wheel', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY > 0 ? 1 : -1;
        const newIndex = Math.max(0, Math.min(this.items.length - 1, this.selectedIndex + delta));
        this.snapToIndex(newIndex, true);
      }, { passive: false });

      // Click on item
      this.track.addEventListener('click', (e) => {
        const itemEl = e.target.closest('.shamsi-wheel-item');
        if (itemEl && itemEl.dataset.index !== undefined) {
          this.snapToIndex(Number(itemEl.dataset.index), true);
        }
      });
    }
  }

  class ShamsiWheelDatePicker {
    constructor(options = {}) {
      this.minYear = options.minYear || 1320;
      this.maxYear = options.maxYear || (window.ShamsiCore ? window.ShamsiCore.today().gy : 1405);
      this.onConfirm = options.onConfirm || null;
      this.currentDate = options.defaultDate || { year: 1370, month: 6, day: 15 };

      this.createModal();
      this.initControllers();
    }

    createModal() {
      let overlay = document.getElementById('shamsi-wheel-picker-modal');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'shamsi-wheel-picker-modal';
        overlay.className = 'shamsi-wheel-modal-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'انتخاب تاریخ تولد شمسی');

        overlay.innerHTML = `
          <div class="shamsi-wheel-sheet">
            <div class="shamsi-wheel-header">
              <button type="button" class="shamsi-wheel-btn-cancel" id="shamsi-wheel-cancel">انصراف</button>
              <div style="text-align:center;">
                <h3 class="shamsi-wheel-title">انتخاب تاریخ تولد</h3>
                <div class="shamsi-wheel-subtitle" id="shamsi-wheel-preview">۱۵ شهریور ۱۳۷۰</div>
              </div>
              <button type="button" class="shamsi-wheel-btn-confirm" id="shamsi-wheel-confirm">تأیید</button>
            </div>

            <div class="shamsi-wheel-presets">
              <button type="button" class="shamsi-preset-btn" data-year="1355">دهه ۵۰</button>
              <button type="button" class="shamsi-preset-btn" data-year="1365">دهه ۶۰</button>
              <button type="button" class="shamsi-preset-btn is-active" data-year="1375">دهه ۷۰</button>
              <button type="button" class="shamsi-preset-btn" data-year="1385">دهه ۸۰</button>
              <button type="button" class="shamsi-preset-btn" data-year="1395">دهه ۹۰</button>
            </div>

            <div class="shamsi-wheel-stage">
              <div class="shamsi-wheel-lens"></div>

              <!-- Day Column -->
              <div class="shamsi-wheel-column col-day" id="wheel-col-day">
                <div class="shamsi-wheel-track"></div>
              </div>

              <!-- Month Column -->
              <div class="shamsi-wheel-column col-month" id="wheel-col-month">
                <div class="shamsi-wheel-track"></div>
              </div>

              <!-- Year Column -->
              <div class="shamsi-wheel-column col-year" id="wheel-col-year">
                <div class="shamsi-wheel-track"></div>
              </div>
            </div>
          </div>
        `;

        document.body.appendChild(overlay);
      }

      this.overlay = overlay;
      this.previewEl = overlay.querySelector('#shamsi-wheel-preview');

      overlay.querySelector('#shamsi-wheel-cancel').onclick = () => this.close();
      overlay.querySelector('#shamsi-wheel-confirm').onclick = () => {
        const val = this.getFormattedValue();
        if (this.onConfirm) this.onConfirm(val);
        this.close();
      };

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.close();
      });

      overlay.querySelectorAll('.shamsi-preset-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          overlay.querySelectorAll('.shamsi-preset-btn').forEach(b => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          const targetYear = Number(btn.dataset.year);
          const yIndex = this.years.indexOf(targetYear);
          if (yIndex !== -1 && this.yearController) {
            this.yearController.snapToIndex(yIndex, true);
          }
        });
      });
    }

    initControllers() {
      // Years list
      this.years = [];
      for (let y = this.maxYear; y >= this.minYear; y--) {
        this.years.push(y);
      }

      // Initial day count
      const daysCount = getDaysInShamsiMonth(this.currentDate.year, this.currentDate.month - 1);
      this.days = Array.from({ length: daysCount }, (_, i) => i + 1);

      const dayIndex = Math.min(this.days.length - 1, Math.max(0, this.currentDate.day - 1));
      const monthIndex = Math.min(11, Math.max(0, this.currentDate.month - 1));
      const yearIndex = Math.max(0, this.years.indexOf(this.currentDate.year));

      const onUpdate = () => {
        const selectedYear = this.years[this.yearController?.selectedIndex || 0];
        const selectedMonth = (this.monthController?.selectedIndex || 0) + 1;

        // Check if days count in month changed
        const maxDays = getDaysInShamsiMonth(selectedYear, selectedMonth - 1);
        if (this.days.length !== maxDays) {
          this.days = Array.from({ length: maxDays }, (_, i) => i + 1);
          this.dayController.setItems(this.days);
        }

        const selectedDay = this.days[this.dayController?.selectedIndex || 0];
        this.currentDate = { year: selectedYear, month: selectedMonth, day: selectedDay };
        this.updatePreview();
      };

      this.dayController = new WheelColumnController(
        this.overlay.querySelector('#wheel-col-day'),
        this.days,
        dayIndex,
        onUpdate
      );

      this.monthController = new WheelColumnController(
        this.overlay.querySelector('#wheel-col-month'),
        SHAMSI_MONTHS,
        monthIndex,
        onUpdate
      );

      this.yearController = new WheelColumnController(
        this.overlay.querySelector('#wheel-col-year'),
        this.years,
        yearIndex,
        onUpdate
      );

      this.updatePreview();
    }

    updatePreview() {
      if (this.previewEl) {
        const d = this.currentDate;
        const mName = SHAMSI_MONTHS[d.month - 1] || '';
        this.previewEl.textContent = `${toFaDigits(d.day)} ${mName} ${toFaDigits(d.year)}`;
      }
    }

    getFormattedValue() {
      const d = this.currentDate;
      const mm = String(d.month).padStart(2, '0');
      const dd = String(d.day).padStart(2, '0');
      return {
        isoShamsi: `${d.year}/${mm}/${dd}`,
        label: `${d.day} ${SHAMSI_MONTHS[d.month - 1]} ${d.year}`,
        year: d.year,
        month: d.month,
        day: d.day,
      };
    }

    open(initialDateStr, onConfirm) {
      if (onConfirm) this.onConfirm = onConfirm;

      if (initialDateStr) {
        // Parse "1370/06/15" or similar
        const parts = String(initialDateStr).replace(/[۰-۹]/g, d => '0123456789'['۰۱۲۳۴۵۶۷۸۹'.indexOf(d)]).split(/[\/\-.]/);
        if (parts.length === 3) {
          const y = Number(parts[0]);
          const m = Number(parts[1]);
          const d = Number(parts[2]);
          if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
            this.currentDate = { year: y, month: m, day: d };
            const yIndex = this.years.indexOf(y);
            if (yIndex !== -1) this.yearController.snapToIndex(yIndex, false);
            this.monthController.snapToIndex(m - 1, false);
            this.dayController.snapToIndex(d - 1, false);
          }
        }
      }

      this.overlay.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    }

    close() {
      this.overlay.classList.remove('is-open');
      document.body.style.overflow = '';
    }
  }

  global.ShamsiWheelDatePicker = ShamsiWheelDatePicker;
})(typeof window !== 'undefined' ? window : this);
