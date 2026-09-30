/**
 * prototype/js/godmode/components/confirm-dialog.js
 *
 * Action Safety and Confirmation Dialog (superadmin.md §16.2).
 * Handles safe, moderate, high-impact, and destructive actions.
 * Enforces mandatory operator reason and shows clear impact previews.
 */

(function (global) {
  'use strict';

  function esc(val) {
    return String(val == null ? '' : val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showConfirmDialog(options = {}) {
    const {
      title = 'تأیید اقدام',
      severity = 'moderate', // 'safe' | 'moderate' | 'high' | 'destructive'
      message = 'آیا از انجام این عملیات اطمینان دارید؟',
      impactDetails = null,
      requireReason = false,
      reasonPlaceholder = 'علت انجام این اقدام را وارد کنید...',
      confirmText = 'تأیید و اعمال',
      cancelText = 'انصراف',
      onConfirm = async () => {}
    } = options;

    const modalBackdrop = document.getElementById('modal-backdrop');
    if (!modalBackdrop) return;

    const modalTitle = document.getElementById('modal-title');
    const modalSeverityBadge = document.getElementById('modal-severity-badge');
    const modalBody = document.getElementById('modal-body');
    const modalConfirmBtn = document.getElementById('modal-confirm-btn');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');

    if (modalTitle) modalTitle.textContent = title;

    if (modalSeverityBadge) {
      modalSeverityBadge.style.display = 'inline-block';
      if (severity === 'destructive') {
        modalSeverityBadge.className = 'badge badge-danger';
        modalSeverityBadge.textContent = 'عملیات پرخطر و حساس';
      } else if (severity === 'high') {
        modalSeverityBadge.className = 'badge badge-warning';
        modalSeverityBadge.textContent = 'تأثیر بالا';
      } else {
        modalSeverityBadge.className = 'badge badge-info';
        modalSeverityBadge.textContent = 'اقدام استاندارد';
      }
    }

    let bodyHtml = `<p class="modal-message-text" style="font-size: 0.95rem; line-height: 1.6; margin-bottom: 1rem;">${esc(message)}</p>`;

    if (impactDetails) {
      bodyHtml += `
        <div class="alert alert-warning" style="margin-bottom: 1rem; font-size: 0.85rem; line-height: 1.5;" role="note">
          <strong>پیش‌نمایش اثرات این اقدام:</strong>
          <p style="margin: 0.25rem 0 0 0;">${esc(impactDetails)}</p>
        </div>
      `;
    }

    if (requireReason) {
      bodyHtml += `
        <div class="form-group" style="margin-top: 1rem;">
          <label for="confirm-dialog-reason-input" style="font-size: 0.85rem; font-weight: 600; display: block; margin-bottom: 0.35rem;">
            علت اقدام <span class="text-danger">*</span>
          </label>
          <textarea id="confirm-dialog-reason-input" class="form-control" rows="3" placeholder="${esc(reasonPlaceholder)}" style="width: 100%; resize: vertical;" required></textarea>
        </div>
      `;
    }

    if (modalBody) modalBody.innerHTML = bodyHtml;

    if (modalConfirmBtn) {
      modalConfirmBtn.textContent = confirmText;
      modalConfirmBtn.className = severity === 'destructive' ? 'btn btn-danger' : 'btn btn-primary';
      modalConfirmBtn.disabled = false;

      // Unbind previous onclick
      const newConfirmBtn = modalConfirmBtn.cloneNode(true);
      modalConfirmBtn.parentNode.replaceChild(newConfirmBtn, modalConfirmBtn);

      newConfirmBtn.onclick = async () => {
        let reason = '';
        if (requireReason) {
          const reasonInput = document.getElementById('confirm-dialog-reason-input');
          reason = reasonInput ? reasonInput.value.trim() : '';
          if (!reason) {
            if (global.GMToast) global.GMToast.show('ثبت دلیل برای این عملیات الزامی است.', 'warning');
            if (reasonInput) reasonInput.focus();
            return;
          }
        }

        newConfirmBtn.disabled = true;
        newConfirmBtn.innerHTML = '<span class="spinner" aria-hidden="true">⏳</span> در حال اعمال...';

        try {
          await onConfirm(reason);
          closeModal();
        } catch (err) {
          newConfirmBtn.disabled = false;
          newConfirmBtn.textContent = confirmText;
          if (global.GMToast) global.GMToast.show(`خطا در اجرای عملیات: ${err.message}`, 'danger');
        }
      };
    }

    function closeModal() {
      modalBackdrop.classList.remove('open');
      modalBackdrop.setAttribute('aria-hidden', 'true');
      modalBackdrop.setAttribute('inert', '');
    }

    if (modalCancelBtn) {
      modalCancelBtn.onclick = closeModal;
    }

    modalBackdrop.classList.add('open');
    modalBackdrop.removeAttribute('aria-hidden');
    modalBackdrop.removeAttribute('inert');
  }

  global.GodModeConfirmDialog = Object.freeze({
    show: showConfirmDialog
  });
})(typeof window !== 'undefined' ? window : globalThis);
