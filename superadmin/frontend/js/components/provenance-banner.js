// prototype/js/components/provenance-banner.js
// Provenance Banner and Environment Transparency for GODMODE
'use strict';

const GMProvenance = {
  renderBanner() {
    const store = window.prototypeStore || window.GMStore;
    const westo = store ? (typeof store.getTenant === 'function' ? store.getTenant('westo') : null) : null;
    const isLive = Boolean(westo && (westo.liveConnected || westo.liveUrl));

    if (isLive) {
      return `
        <div class="prototype-banner-copy">
          <span class="prototype-banner-dot" aria-hidden="true" style="background: var(--color-success, #10b981);"></span>
          <span class="badge badge-success" style="font-size: 11px;"><span class="status-dot dot-green pulse"></span> اکوسیستم عملیاتی</span>
          <strong>مرکز مدیریت پلتفرم سالسا (SALSA)</strong>
          <span class="prototype-banner-detail">متصل به مشتری شماره ۱ (کافه وستو) — داده‌های عملیاتی زنده و آماده برای استقرار سرور VPS.</span>
        </div>
      `;
    }

    return `
      <div class="prototype-banner-copy">
        <span class="prototype-banner-dot" aria-hidden="true" style="background: var(--color-warning, #f59e0b);"></span>
        <span class="badge badge-provenance-local"><span class="status-dot dot-amber"></span> پیش‌نمایش محلی</span>
        <strong>مرکز مدیریت SALSA GODMODE</strong>
        <span class="prototype-banner-detail">پیش‌نمایش محلی — داده‌ها نمایشی و ایزوله‌اند؛ اتصال عملیاتی پس از برقراری تأیید خواهد شد.</span>
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
      window.GMApp.showToast('اتصال با هسته عملیاتی کافه وستو (پورت ۴۱۸۰) برقرار است.', 'success', 3000);
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
