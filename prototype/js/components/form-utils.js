// prototype/js/components/form-utils.js
// Form Utilities, Field Error Handlers, and Accessibility Traps for GODMODE
'use strict';

const GMFormUtils = {
  toPersianDigits(str) {
    if (!str && str !== 0) return '';
    const fa = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return String(str).replace(/[0-9]/g, d => fa[Number(d)]);
  },

  formatCurrency(amount, unit = 'تومان') {
    const num = Number(amount) || 0;
    return `${this.toPersianDigits(num.toLocaleString('en-US'))} ${unit}`;
  },

  // Persian / Arabic to English digit conversion
  toEnglishDigits(str) {
    if (!str && str !== 0) return '';
    const fa = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    const ar = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    let res = String(str);
    for (let i = 0; i < 10; i++) {
      res = res.split(fa[i]).join(String(i)).split(ar[i]).join(String(i));
    }
    return res;
  },

  // Slug sanitizer: English letters, numbers, hyphens
  sanitizeSlug(val) {
    if (!val) return '';
    return this.toEnglishDigits(val)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  },

  // Set field inline error (WCAG 3.3.1 & 3.3.2)
  setFieldError(inputEl, message) {
    if (!inputEl) return;
    inputEl.classList.add('error');
    inputEl.setAttribute('aria-invalid', 'true');
    const inputId = inputEl.id || 'field-' + Math.random().toString(36).substring(2, 7);
    if (!inputEl.id) inputEl.id = inputId;

    const formGroup = inputEl.closest ? inputEl.closest('.form-group') : null;
    if (formGroup) {
      formGroup.classList.add('has-error');
    }

    const errId = inputId + '-error';
    let errEl = document.getElementById(errId);
    if (!errEl) {
      errEl = document.createElement('div');
      errEl.id = errId;
      errEl.className = 'form-error-message form-error-text';
      errEl.setAttribute('role', 'alert');
      errEl.setAttribute('aria-live', 'assertive');
      if (inputEl.parentNode) {
        inputEl.parentNode.appendChild(errEl);
      }
    }
    errEl.innerHTML = `<span aria-hidden="true">⚠️</span> <span>${message}</span>`;
    
    // Wire aria-describedby
    const existingDesc = (inputEl.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
    if (!existingDesc.includes(errId)) {
      existingDesc.push(errId);
      inputEl.setAttribute('aria-describedby', existingDesc.join(' '));
    }
  },

  // Clear field inline error
  clearFieldError(inputEl) {
    if (!inputEl) return;
    inputEl.classList.remove('error');
    inputEl.removeAttribute('aria-invalid');
    const formGroup = inputEl.closest ? inputEl.closest('.form-group') : null;
    if (formGroup) {
      formGroup.classList.remove('has-error');
    }
    const inputId = inputEl.id;
    if (inputId) {
      const errId = inputId + '-error';
      const errEl = document.getElementById(errId);
      if (errEl && errEl.parentNode) {
        errEl.parentNode.removeChild(errEl);
      }
      const existingDesc = (inputEl.getAttribute('aria-describedby') || '').split(' ').filter(id => id && id !== errId);
      if (existingDesc.length) {
        inputEl.setAttribute('aria-describedby', existingDesc.join(' '));
      } else {
        inputEl.removeAttribute('aria-describedby');
      }
    }
  },

  // Clear all field errors in container or entire document
  clearAllErrors(container) {
    const root = container || document;
    if (!root || !root.querySelectorAll) return;
    const invalidInputs = root.querySelectorAll('.error, [aria-invalid="true"]');
    invalidInputs.forEach(input => this.clearFieldError(input));
    const errorGroups = root.querySelectorAll('.form-group.has-error');
    errorGroups.forEach(grp => grp.classList.remove('has-error'));
    const errorTexts = root.querySelectorAll('.form-error-message, .form-error-text');
    errorTexts.forEach(el => {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
  },

  // Empty recovery: reset form fields to default values and clear all errors
  resetFormWithDefaults(container, defaults = {}) {
    const root = container || document;
    this.clearAllErrors(root);
    if (!root || !root.querySelector) return;
    Object.keys(defaults).forEach(key => {
      const el = root.querySelector(`[name="${key}"], #${key}`);
      if (el) {
        if (el.type === 'checkbox') {
          el.checked = Boolean(defaults[key]);
        } else if (el.type === 'radio') {
          const radio = root.querySelector(`input[name="${key}"][value="${defaults[key]}"]`);
          if (radio) radio.checked = true;
        } else {
          el.value = defaults[key];
        }
        try {
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (e) {}
      }
    });
  },

  // Set button submitting state with spinner & disable prevention
  setSubmitting(btn, isSubmitting, loadingText = 'در حال ارسال و پردازش...') {
    if (!btn) return;
    if (isSubmitting) {
      btn.setAttribute('data-original-html', btn.innerHTML);
      btn.classList.add('btn-submitting');
      btn.setAttribute('disabled', 'true');
      btn.setAttribute('aria-busy', 'true');
      btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span> <span>${loadingText}</span>`;
    } else {
      const orig = btn.getAttribute('data-original-html');
      if (orig) btn.innerHTML = orig;
      btn.classList.remove('btn-submitting');
      btn.removeAttribute('disabled');
      btn.removeAttribute('aria-busy');
    }
  },

  // Trap keyboard focus inside active overlay (WCAG 2.1.2)
  trapFocus(container, e) {
    if (e.key !== 'Tab') return;
    const focusables = Array.from(container.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
    )).filter(el => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement);

    if (!focusables.length) {
      e.preventDefault();
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first || !container.contains(document.activeElement)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last || !container.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }
  }
};

if (typeof window !== 'undefined') {
  window.GMFormUtils = GMFormUtils;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GMFormUtils;
  module.exports.GMFormUtils = GMFormUtils;
}
