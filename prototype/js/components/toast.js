// prototype/js/components/toast.js
// Toast Notification Hub Controller
'use strict';

const GMToast = {
  escapeMessage(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  show(message, type = 'info', duration = 3500, options = {}) {
    const container = document.getElementById('toast-container');
    if (container) {
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.setAttribute('role', (type === 'error' || type === 'danger') ? 'alert' : 'status');
      toast.setAttribute('aria-live', (type === 'error' || type === 'danger') ? 'assertive' : 'polite');
      toast.setAttribute('aria-atomic', 'true');

      let icon = 'ℹ️';
      if (type === 'success') icon = '✓';
      if (type === 'error' || type === 'danger') icon = '✕';
      if (type === 'warning') icon = '⚠️';

      const safeMessage = this.escapeMessage(message);
      toast.innerHTML = `
        <span style="font-weight: 700; font-size: 16px;">${icon}</span>
        <div style="flex: 1; font-size: 13px; line-height: 1.5;">${safeMessage}</div>
      `;

      container.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => {
          if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
      }, duration);
    }

    // Persist to Operational Activity Ledger unless explicitly opted out
    if (!options || !options.silentActivity) {
      const store = window.prototypeStore || window.GMStore;
      if (store && typeof store.addActivity === 'function') {
        const hash = (typeof window !== 'undefined' && window.location && window.location.hash) ? window.location.hash : '#gm-02-overview';
        const routeLabel = window.GMApp?.getRouteLabel ? window.GMApp.getRouteLabel(hash) : hash;
        store.addActivity({
          type: options.activityType || 'system_notification',
          severity: (type === 'error' || type === 'danger') ? 'danger' : type,
          title: options.activityTitle || message,
          description: options.activityDesc || `اقدام از طریق بخش «${routeLabel}» با موفقیت مخابره شد.`,
          subsystem: options.subsystem || (window.GMApp?.getSubsystemFromRoute ? window.GMApp.getSubsystemFromRoute(hash) : 'پلتفرم'),
          route: hash,
          routeLabel: routeLabel,
          actor: options.actor || 'SuperAdmin (ناظر)',
          details: options.details || null
        });
        if (window.GMApp && typeof window.GMApp.updateActivityBadge === 'function') {
          window.GMApp.updateActivityBadge();
        }
      }
    }
  }
};

if (typeof window !== 'undefined') {
  window.GMToast = GMToast;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GMToast;
  module.exports.GMToast = GMToast;
}
