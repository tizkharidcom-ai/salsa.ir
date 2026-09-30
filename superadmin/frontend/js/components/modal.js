// prototype/js/components/modal.js
// Modal & Confirmation Dialog Controller for GODMODE
'use strict';

const GMModal = {
  activeModalCallback: null,
  lastFocusedElement: null,

  open(title, contentHtml, onConfirm = null, options = {}) {
    this.lastFocusedElement = document.activeElement;

    const backdrop = document.getElementById('modal-backdrop');
    const titleEl = document.getElementById('modal-title');
    const bodyEl = document.getElementById('modal-body');
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn') || backdrop?.querySelector('.modal-footer .btn-secondary');
    const badgeEl = document.getElementById('modal-severity-badge');

    if (titleEl) titleEl.innerText = title;
    if (bodyEl) bodyEl.innerHTML = contentHtml;

    if (badgeEl) {
      if (options.severity) {
        badgeEl.style.display = 'inline-flex';
        badgeEl.className = `badge badge-${options.severity}`;
        badgeEl.innerHTML = options.severityLabel || (options.severity === 'danger' ? 'عملیات حساس' : options.severity === 'warning' ? 'هشدار' : 'اطلاعیه');
      } else {
        badgeEl.style.display = 'none';
      }
    }

    if (cancelBtn) {
      cancelBtn.textContent = options.cancelText || 'انصراف';
    }

    this.activeModalCallback = onConfirm;

    if (confirmBtn) {
      if (onConfirm) {
        confirmBtn.style.display = 'inline-flex';
        confirmBtn.textContent = options.confirmText || 'تأیید و ادامه';

        // Apply semantic button variant class
        confirmBtn.className = 'btn';
        if (options.confirmVariant === 'danger') {
          confirmBtn.classList.add('btn-danger');
        } else if (options.confirmVariant === 'warning') {
          confirmBtn.classList.add('btn-warning');
        } else {
          confirmBtn.classList.add('btn-primary');
        }

        confirmBtn.onclick = () => {
          const keepOpen = onConfirm();
          if (keepOpen !== false) {
            this.close();
          }
        };
      } else {
        confirmBtn.style.display = 'none';
      }
    }

    if (backdrop) {
      backdrop.classList.add('open');
      backdrop.removeAttribute('aria-hidden');
      backdrop.removeAttribute('inert');
    }
    const layout = document.querySelector('.app-layout');
    if (layout) layout.setAttribute('inert', '');
    if (typeof document !== 'undefined' && document.body) {
      document.body.style.overflow = 'hidden';
    }

    // Focus safety: for destructive actions (danger variant), focus the cancel button first to prevent accidental Enter!
    setTimeout(() => {
      let focusTarget = null;
      if (options.confirmVariant === 'danger' && cancelBtn) {
        focusTarget = cancelBtn;
      } else {
        focusTarget = backdrop?.querySelector('input:not([type="hidden"]), select, textarea, #modal-confirm-btn, .modal-close');
      }
      if (focusTarget) {
        focusTarget.focus();
      }
    }, 50);
  },

  close() {
    const backdrop = document.getElementById('modal-backdrop');
    if (backdrop) {
      backdrop.classList.remove('open');
      backdrop.setAttribute('aria-hidden', 'true');
      backdrop.setAttribute('inert', '');
    }
    const layout = document.querySelector('.app-layout');
    if (layout) layout.removeAttribute('inert');
    this.activeModalCallback = null;
    if (typeof document !== 'undefined' && document.body) {
      document.body.style.overflow = '';
    }

    // Restore previously focused element
    if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
      try { this.lastFocusedElement.focus(); } catch (e) {}
    }
  }
};

if (typeof window !== 'undefined') {
  window.GMModal = GMModal;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GMModal;
  module.exports.GMModal = GMModal;
}
