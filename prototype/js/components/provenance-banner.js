// prototype/js/components/provenance-banner.js
// Provenance Banner and Environment Transparency for GODMODE
'use strict';

const GMProvenance = {
  renderBanner() {
    return `
      <div class="prototype-banner-copy">
        <span class="prototype-banner-dot" aria-hidden="true" style="background: var(--color-warning, #f59e0b);"></span>
        <span class="badge badge-provenance-local"><span class="status-dot dot-amber"></span> پیش‌نمایش ایزوله · غیرعملیاتی</span>
        <strong>مرکز مدیریت SALSA GODMODE</strong>
        <span class="prototype-banner-detail">این نسخه از داده‌های ساختگی استفاده می‌کند و به API یا پایگاه‌دادهٔ عملیاتی متصل نیست.</span>
      </div>
    `;
  },

  update() {
    const banner = document.getElementById('prototype-banner') || document.querySelector('.prototype-banner');
    if (!banner) return;
    banner.style.removeProperty('background');
    banner.style.removeProperty('border-bottom');
    banner.innerHTML = this.renderBanner();
  },

  checkLiveBridge() {
    if (window.GMApp && typeof window.GMApp.showToast === 'function') {
      window.GMApp.showToast('اتصال به هستهٔ عملیاتی در این پیش‌نمایش برقرار نیست.', 'warning', 4000);
    }
  }
};

if (typeof window !== 'undefined') {
  window.GMProvenance = GMProvenance;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GMProvenance;
  module.exports.GMProvenance = GMProvenance;
}
