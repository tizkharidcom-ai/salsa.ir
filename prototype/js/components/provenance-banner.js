// prototype/js/components/provenance-banner.js
// Provenance Banner and Environment Transparency for GODMODE
'use strict';

const GMProvenance = {
  renderBanner() {
    return `
      <div class="prototype-banner-copy">
        <span class="prototype-banner-dot" aria-hidden="true" style="background: var(--color-warning, #f59e0b);"></span>
        <span class="badge badge-provenance-local"><span class="status-dot dot-amber"></span> پیش‌نمایش محلی</span>
        <strong>نمونه رابط کاربری GODMODE</strong>
        <span class="prototype-banner-detail">داده‌ها ساختگی و ایزوله‌اند؛ اتصال عملیاتی و آمادگی تولید در این محیط تأیید نمی‌شود.</span>
      </div>
    `;
  },

  update() {
    const banner = document.getElementById('prototype-banner') || document.querySelector('.prototype-banner');
    if (!banner) return;
    banner.style.removeProperty('background');
    banner.style.removeProperty('border-bottom');
    banner.innerHTML = `
      <div class="prototype-banner-copy">
        <span class="prototype-banner-dot" aria-hidden="true" style="background: var(--color-warning, #f59e0b);"></span>
        <span class="badge badge-provenance-local"><span class="status-dot dot-amber"></span> پیش‌نمایش محلی</span>
        <strong>نمونه رابط کاربری GODMODE</strong>
        <span class="prototype-banner-detail">داده‌ها ساختگی و ایزوله‌اند؛ اتصال عملیاتی و آمادگی تولید در این محیط تأیید نمی‌شود.</span>
      </div>
    `;
  },

  checkLiveBridge() {
    if (window.GMApp && typeof window.GMApp.showToast === 'function') {
      window.GMApp.showToast('اتصال عملیاتی از پروتوتایپ مجاز نیست. برای مسیر امن، کنترل‌پلن تولید را پیکربندی کنید.', 'warning', 4000);
    }
    window.location.hash = '#gm-24-infrastructure';
  }
};

if (typeof window !== 'undefined') {
  window.GMProvenance = GMProvenance;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GMProvenance;
  module.exports.GMProvenance = GMProvenance;
}
