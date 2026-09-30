// prototype/js/components/drawer.js
// Slide-Over Drawer Component Controller for GODMODE (GODMODE.MD §20.2 & §20.5)
'use strict';

const GMDrawer = {
  lastFocusedElement: null,

  open(title, contentHtml, options = {}) {
    this.lastFocusedElement = document.activeElement;

    const drawer = document.getElementById('app-drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    const titleEl = document.getElementById('drawer-title');
    const subtitleEl = document.getElementById('drawer-subtitle');
    const bodyEl = document.getElementById('drawer-body');
    const footerEl = document.getElementById('drawer-footer');

    if (titleEl) titleEl.innerText = title;

    if (subtitleEl) {
      if (options.subtitle) {
        subtitleEl.innerHTML = options.subtitle;
        subtitleEl.style.display = 'flex';
      } else {
        subtitleEl.style.display = 'none';
        subtitleEl.innerHTML = '';
      }
    }

    if (bodyEl) bodyEl.innerHTML = contentHtml;

    if (footerEl) {
      if (options.footerHtml) {
        footerEl.innerHTML = options.footerHtml;
        footerEl.style.display = 'flex';
      } else {
        footerEl.style.display = 'none';
        footerEl.innerHTML = '';
      }
    }

    if (drawer) {
      if (options.width) {
        drawer.style.width = options.width;
      } else {
        drawer.style.width = '';
      }
      drawer.classList.add('open');
      drawer.removeAttribute('aria-hidden');
      drawer.removeAttribute('inert');
    }
    if (backdrop) {
      backdrop.classList.add('open');
      backdrop.removeAttribute('aria-hidden');
    }
    const layout = document.querySelector('.app-layout');
    if (layout) layout.setAttribute('inert', '');
    if (typeof document !== 'undefined' && document.body) {
      document.body.style.overflow = 'hidden';
    }

    // Focus close button inside drawer for accessibility
    const closeBtn = drawer?.querySelector('.drawer-close');
    if (closeBtn) {
      setTimeout(() => closeBtn.focus(), 50);
    }
  },

  close() {
    const drawer = document.getElementById('app-drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    const footerEl = document.getElementById('drawer-footer');
    const subtitleEl = document.getElementById('drawer-subtitle');

    if (drawer) {
      drawer.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
      drawer.setAttribute('inert', '');
      drawer.style.width = '';
    }
    if (backdrop) {
      backdrop.classList.remove('open');
      backdrop.setAttribute('aria-hidden', 'true');
    }
    if (footerEl) {
      footerEl.style.display = 'none';
      footerEl.innerHTML = '';
    }
    if (subtitleEl) {
      subtitleEl.style.display = 'none';
      subtitleEl.innerHTML = '';
    }
    const layout = document.querySelector('.app-layout');
    if (layout) layout.removeAttribute('inert');
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
  window.GMDrawer = GMDrawer;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GMDrawer;
  module.exports.GMDrawer = GMDrawer;
}
