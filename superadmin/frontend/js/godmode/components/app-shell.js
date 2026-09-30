/**
 * prototype/js/godmode/components/app-shell.js
 *
 * App Shell Navigation & Layout Manager (superadmin.md §3 & §17.1).
 * Dynamically renders the 5-group sidebar directly from GodModeRegistry.
 * Coordinates modal dialogs, slide-over drawer, and theme toggling.
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

  class GodModeAppShellManager {
    constructor() {
      this._initialized = false;
      this.activeModalCallback = null;
      this.lastFocusedElement = null;
      this.sidebarReturnFocus = null;
    }

    init() {
      if (this._initialized) return;
      this._initialized = true;

      this.initTheme();
      this.restoreSidebarState();
      this.renderSidebar();
      this.bindGlobalEvents();
      this.updateProvenanceBanner();

      if (global.GMCommandPalette && typeof global.GMCommandPalette.initListeners === 'function') {
        global.GMCommandPalette.initListeners();
      }

      // Listen for app-mode changes to update banner
      if (global.GodModeAppMode) {
        global.GodModeAppMode.subscribe(() => {
          this.updateProvenanceBanner();
        });
      }
    }

    /**
     * Theme & Appearance Management
     */
    initTheme() {
      let pref = 'light';
      try {
        pref = localStorage.getItem('salsa_theme') || 'light';
      } catch (_) {}
      this.applyTheme(pref, false);

      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const listener = () => {
          let currentPref = 'light';
          try { currentPref = localStorage.getItem('salsa_theme') || 'light'; } catch (_) {}
          if (currentPref === 'system') {
            this.applyTheme('system', false);
          }
        };
        if (typeof mq.addEventListener === 'function') {
          mq.addEventListener('change', listener);
        } else if (typeof mq.addListener === 'function') {
          mq.addListener(listener);
        }
      }
    }

    applyTheme(pref, notify = false) {
      const validModes = ['light', 'dark', 'system'];
      const mode = validModes.includes(pref) ? pref : 'light';
      try {
        localStorage.setItem('salsa_theme', mode);
      } catch (_) {}

      let resolved = mode;
      if (mode === 'system') {
        const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
        resolved = mq && mq.matches ? 'dark' : 'light';
      }

      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', resolved);
        document.documentElement.setAttribute('data-theme-pref', mode);
        document.documentElement.style.colorScheme = resolved;
        if (document.body) {
          document.body.setAttribute('data-theme', resolved);
        }

        const themeColorEl = document.getElementById('meta-theme-color');
        if (themeColorEl) {
          themeColorEl.setAttribute('content', resolved === 'dark' ? '#0b1120' : '#f8fafc');
        }

        const iconEl = document.getElementById('header-theme-icon');
        const btnEl = document.getElementById('btn-theme-modal');
        if (iconEl) {
          if (mode === 'dark') iconEl.textContent = '🌙';
          else if (mode === 'light') iconEl.textContent = '☀️';
          else iconEl.textContent = '🌓';
        }
        if (btnEl) {
          const modeNames = { light: 'روشن', dark: 'تیره', system: 'هماهنگ با سیستم' };
          btnEl.setAttribute('title', `پوسته فعلی: ${modeNames[mode]} (کلیک برای تغییر)`);
        }
      }

      if (notify && global.GMToast) {
        const modeNames = { light: 'روشن', dark: 'تیره', system: 'هماهنگ با سیستم' };
        global.GMToast.show(`پوسته سامانه به «${modeNames[mode]}» تغییر یافت.`, 'info');
      }
    }

    renderThemeModalBody(currentMode) {
      const options = [
        { id: 'light', label: 'پوسته روشن', desc: 'مناسب محیط‌های پرنور اداری', icon: '☀️' },
        { id: 'dark', label: 'پوسته تیره', desc: 'کاهش خستگی چشم در کاربری طولانی', icon: '🌙' },
        { id: 'system', label: 'هماهنگ با سیستم', desc: 'پیروی خودکار از تنظیمات سیستم‌عامل', icon: '🌓' }
      ];

      return `
        <div id="theme-selection-container" style="display: flex; flex-direction: column; gap: 0.75rem;">
          <p style="font-size: 0.85rem; color: var(--text-secondary, #64748b); margin-bottom: 0.5rem;">
            پوسته دیداری مورد نظر خود را برای محیط مدیریت SALSA انتخاب کنید:
          </p>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem;">
            ${options.map(opt => `
              <div onclick="window.GodModeAppShell.selectThemeInModal('${opt.id}')"
                   style="border: 2px solid ${currentMode === opt.id ? 'var(--primary, #2563EB)' : 'rgba(255,255,255,0.1)'};
                          background: ${currentMode === opt.id ? 'rgba(37,99,235,0.1)' : 'transparent'};
                          border-radius: 8px; padding: 1rem 0.5rem; text-align: center; cursor: pointer; transition: all 0.2s;">
                <div style="font-size: 1.75rem; margin-bottom: 0.5rem;">${opt.icon}</div>
                <div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 0.25rem;">${opt.label}</div>
                <div style="font-size: 0.7rem; color: var(--text-secondary, #64748b);">${opt.desc}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    selectThemeInModal(mode) {
      this.applyTheme(mode, false);
      const bodyEl = document.getElementById('modal-body');
      if (bodyEl && document.getElementById('theme-selection-container')) {
        bodyEl.innerHTML = this.renderThemeModalBody(mode);
      }
    }

    openThemeModal() {
      let currentPref = 'light';
      try {
        currentPref = localStorage.getItem('salsa_theme') || 'light';
      } catch (_) {}

      const contentHtml = this.renderThemeModalBody(currentPref);
      this.openModal('تنظیم پوسته و ظاهر سامانه (تم)', contentHtml, () => {
        let savedPref = 'light';
        try { savedPref = localStorage.getItem('salsa_theme') || 'light'; } catch (_) {}
        const modeNames = { light: 'روشن', dark: 'تیره', system: 'هماهنگ با سیستم' };
        if (global.GMToast) {
          global.GMToast.show(`پوسته «${modeNames[savedPref]}» ذخیره شد.`, 'success');
        }
        return true;
      }, { confirmText: 'تأیید و ذخیره' });
    }

    /**
     * Sidebar Controls
     */
    toggleSidebarCollapse() {
      const layout = document.querySelector('.app-layout');
      if (!layout) return;
      const isCollapsed = layout.classList.toggle('sidebar-collapsed');
      try {
        localStorage.setItem('salsa_sidebar_collapsed', isCollapsed ? 'true' : 'false');
      } catch (e) {}
    }

    restoreSidebarState() {
      try {
        if (localStorage.getItem('salsa_sidebar_collapsed') === 'true') {
          const layout = document.querySelector('.app-layout');
          if (layout) layout.classList.add('sidebar-collapsed');
        }
      } catch (e) {}
    }

    toggleSidebar(forceOpen) {
      const sidebar = document.getElementById('app-sidebar');
      const btn = document.getElementById('mobile-menu-btn');
      if (!sidebar || (typeof window !== 'undefined' && window.innerWidth > 768)) return false;

      const nextOpen = typeof forceOpen === 'boolean'
        ? forceOpen
        : !sidebar.classList.contains('open');
      if (nextOpen === sidebar.classList.contains('open')) return nextOpen;

      if (nextOpen) {
        this.sidebarReturnFocus = document.activeElement === btn ? btn : document.activeElement;
      }
      sidebar.classList.toggle('open', nextOpen);
      this.syncMobileSidebarAccessibility();

      if (nextOpen) {
        const firstFocusable = sidebar.querySelector('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (firstFocusable && typeof firstFocusable.focus === 'function') firstFocusable.focus();
      } else if (this.sidebarReturnFocus && typeof this.sidebarReturnFocus.focus === 'function') {
        this.sidebarReturnFocus.focus();
        this.sidebarReturnFocus = null;
      }
      return nextOpen;
    }

    syncMobileSidebarAccessibility() {
      const sidebar = document.getElementById('app-sidebar');
      const btn = document.getElementById('mobile-menu-btn');
      if (!sidebar) return;
      const isOpen = sidebar.classList.contains('open');
      if (btn) btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      if (typeof window !== 'undefined' && window.innerWidth <= 768) {
        sidebar.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
        if (!isOpen) sidebar.setAttribute('inert', '');
        else sidebar.removeAttribute('inert');
      } else {
        sidebar.removeAttribute('aria-hidden');
        sidebar.removeAttribute('inert');
      }
    }

    /**
     * Modal Controller
     */
    openModal(title, contentHtml, onConfirm = null, options = {}) {
      if (global.GMModal && typeof global.GMModal.open === 'function') {
        return global.GMModal.open(title, contentHtml, onConfirm, options);
      }

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
              this.closeModal();
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
    }

    closeModal() {
      if (global.GMModal && typeof global.GMModal.close === 'function') {
        return global.GMModal.close();
      }

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
      if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
        try { this.lastFocusedElement.focus(); } catch (e) {}
      }
    }

    /**
     * Drawer Controller
     */
    openDrawer(title, contentHtml, options = {}) {
      if (global.GMDrawer && typeof global.GMDrawer.open === 'function') {
        return global.GMDrawer.open(title, contentHtml, options);
      }
    }

    closeDrawer() {
      if (global.GMDrawer && typeof global.GMDrawer.close === 'function') {
        return global.GMDrawer.close();
      }
    }

    toggleActivityDrawer() {
      if (global.GMDrawer && global.GMDrawer.isOpen && global.GMDrawer.isOpen()) {
        this.closeDrawer();
      } else if (global.GMActivityLedger && typeof global.GMActivityLedger.openDrawer === 'function') {
        global.GMActivityLedger.openDrawer();
      }
    }

    /**
     * Command Palette Controls
     */
    openCommandPalette() {
      if (global.GMCommandPalette && typeof global.GMCommandPalette.open === 'function') {
        global.GMCommandPalette.open();
      }
    }

    closeCommandPalette() {
      if (global.GMCommandPalette && typeof global.GMCommandPalette.close === 'function') {
        global.GMCommandPalette.close();
      }
    }

    toggleCommandPalette() {
      if (global.GMCommandPalette) {
        if (global.GMCommandPalette.isOpen) {
          this.closeCommandPalette();
        } else {
          this.openCommandPalette();
        }
      }
    }

    /**
     * Shortcuts Help Dialog
     */
    openShortcutsHelpModal() {
      const shortcuts = [
        {
          category: 'ناوبری و جست‌وجو',
          items: [
            { keys: ['Ctrl', 'K'], desc: 'باز کردن پالت دستورات سراسری' },
            { keys: ['/'], desc: 'جست‌وجوی سریع' },
            { keys: ['?'], desc: 'نمایش راهنمای کلیدهای میانبر' },
            { keys: ['Esc'], desc: 'بستن کادرها و پنجره‌ها' }
          ]
        },
        {
          category: 'پنجره‌ها و نماها',
          items: [
            { keys: ['Alt', 'H'], desc: 'رفتن به پیشخوان کلان (Home)' },
            { keys: ['Alt', 'R'], desc: 'رفتن به فهرست رستوران‌ها' },
            { keys: ['Alt', 'C'], desc: 'بخش تجاری و تعرفه‌ها' },
            { keys: ['Alt', 'O'], desc: 'عملیات و سلامت پلتفرم' },
            { keys: ['Alt', 'S'], desc: 'تنظیمات و امنیت سیستم' }
          ]
        }
      ];

      const html = `
        <div class="shortcuts-modal-container" style="display: flex; flex-direction: column; gap: 1rem;">
          <p style="font-size: 0.85rem; color: var(--text-secondary, #64748b); margin: 0;">
            کلیدهای میانبر فعال در کنسول مدیریت SALSA Super Admin:
          </p>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
            ${shortcuts.map(g => `
              <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.75rem;">
                <h4 style="font-size: 0.85rem; font-weight: 700; margin: 0 0 0.5rem 0; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 0.35rem;">
                  ${g.category}
                </h4>
                <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem;">
                  ${g.items.map(i => `
                    <li style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem;">
                      <span style="color: var(--text-secondary, #64748b);">${i.desc}</span>
                      <span style="display: flex; gap: 0.2rem;">
                        ${i.keys.map(k => `<kbd class="gm-kbd-badge" style="background: rgba(255,255,255,0.1); padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.75rem;">${k}</kbd>`).join('')}
                      </span>
                    </li>
                  `).join('')}
                </ul>
              </div>
            `).join('')}
          </div>
        </div>
      `;

      this.openModal('راهنمای کلیدهای میانبر پلتفرم SALSA', html, null, { cancelText: 'بستن راهنما' });
    }

    /**
     * Backward-Compatible Action Helpers
     */
    quickToggleTenantStatus(tenantId) {
      if (!tenantId) return;
      this.openSuspendModal(tenantId);
    }

    async quickToggleFeature(featureKey, tenantId = null) {
      const store = global.prototypeStore || global.GMStore;
      if (!store) return;
      tenantId = tenantId || (typeof store.getActiveTenantId === 'function' ? store.getActiveTenantId() : null);
      if (!tenantId) {
        if (global.GMToast) global.GMToast.show('ابتدا یک مجموعه معتبر را انتخاب کنید.', 'warning');
        return;
      }
      if (global.EntitlementsRepository) {
        const isNowActive = !store.isFeatureEnabled(tenantId, featureKey);
        await global.EntitlementsRepository.setModuleStatus(tenantId, featureKey, isNowActive, 'تغییر سریع از پوسته مدیریت');
        if (global.GMToast) global.GMToast.show(`وضعیت ماژول «${featureKey}» به‌روزرسانی شد.`, 'success');
        if (global.GodModeRouter) global.GodModeRouter.handleRoute();
      }
    }

    /**
     * Dynamically renders the Sidebar with exactly 5 canonical groups
     */
    renderSidebar(activeRoute = 'home') {
      const sidebarNavGroups = document.getElementById('sidebar-nav-groups');
      if (!sidebarNavGroups || !global.GodModeRegistry) return;

      const groups = global.GodModeRegistry.NAVIGATION_GROUPS || [];
      const resolved = global.GodModeRegistry.resolveHash(window.location.hash);
      const activeGroup = resolved.page?.group || 'home';

      let html = '';
      groups.forEach((g) => {
        const isGroupActive = g.id === activeGroup;
        html += `
          <div class="nav-group ${isGroupActive ? 'nav-group-active' : ''}" data-nav-group="${esc(g.id)}">
            <a href="#${esc(g.defaultRoute)}" class="nav-item ${isGroupActive ? 'active' : ''}" title="${esc(g.purposeFa)}">
              <span class="nav-title">
                <span class="nav-icon" aria-hidden="true">${esc(g.icon)}</span>
                <span>${esc(g.titleFa)}</span>
              </span>
            </a>
          </div>
        `;
      });

      sidebarNavGroups.innerHTML = html;
    }

    updateProvenanceBanner() {
      const banner = document.getElementById('prototype-banner');
      if (!banner || !global.GodModeAppMode) return;

      const isProd = global.GodModeAppMode.isProduction();
      const cleanDataButton = document.getElementById('btn-clean-data');
      if (cleanDataButton) {
        cleanDataButton.style.display = isProd ? 'none' : 'inline-flex';
      }
      banner.dataset.sourceStatus = 'unverified';
      banner.innerHTML = `
        <div class="prototype-banner-copy">
          <span class="prototype-banner-dot" aria-hidden="true"></span>
          <span class="badge badge-warning" style="font-size: 11px;">${isProd ? 'اتصال تأییدنشده' : 'پیش‌نمایش ایزوله'}</span>
          <strong>مرکز مدیریت SALSA GODMODE</strong>
          <span class="prototype-banner-detail">
            ${isProd ? 'وضعیت عملیاتی و منبع زندهٔ داده‌ها تا دریافت پاسخ معتبر از کنترل‌پلین تأیید نشده است.' : 'این پیش‌نمایش ایزوله است و داده‌های آن عملیاتی نیستند.'}
          </span>
        </div>
      `;
    }

    bindGlobalEvents() {
      // Close dropdowns on outside click
      document.addEventListener('click', (e) => {
        const menu = document.getElementById('restaurant-action-menu');
        const trigger = document.getElementById('btn-restaurant-more');
        if (menu && menu.style.display !== 'none' && !menu.contains(e.target) && e.target !== trigger) {
          menu.style.display = 'none';
        }
      });

      // Global Keyboard Shortcuts
      document.addEventListener('keydown', (e) => {
        // Ignore typing in inputs or textareas
        const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

        // Ctrl/Cmd + K
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
          e.preventDefault();
          this.toggleCommandPalette();
          return;
        }

        // Forward slash '/' when not typing
        if (!isInput && e.key === '/') {
          e.preventDefault();
          this.openCommandPalette();
          return;
        }

        // Escape closes any open modal, drawer, or palette
        if (e.key === 'Escape') {
          const backdrop = document.getElementById('modal-backdrop');
          if (backdrop && backdrop.classList.contains('open')) {
            this.closeModal();
            return;
          }
          if (global.GMDrawer && global.GMDrawer.isOpen && global.GMDrawer.isOpen()) {
            this.closeDrawer();
            return;
          }
          if (global.GMCommandPalette && global.GMCommandPalette.isOpen) {
            this.closeCommandPalette();
            return;
          }
        }
      });
    }

    toggleRestaurantActionMenu(event) {
      if (event) event.stopPropagation();
      const menu = document.getElementById('restaurant-action-menu');
      if (!menu) return;
      menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    }

    copyTenantId(tenantId) {
      if (!tenantId) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(tenantId).then(() => {
          if (global.GMToast) global.GMToast.show(`شناسه «${tenantId}» در کلیپ‌بورد کپی شد.`, 'success');
        });
      } else {
        prompt('شناسه مجموعه را کپی کنید:', tenantId);
      }
    }

    openSuspendModal(tenantId) {
      if (global.GodModeCommandFramework) {
        global.GodModeCommandFramework.execute('SuspendRestaurant', { tenantId }).catch(() => {});
        return;
      }
      if (!global.GodModeConfirmDialog) return;
      global.GodModeConfirmDialog.show({
        title: `تعلیق سرویس مجموعه ${tenantId}`,
        severity: 'destructive',
        message: 'آیا از تعلیق کامل سرویس‌های این مجموعه اطمینان دارید؟ در صورت تعلیق، ورود صندوق و ثبت سفارش برای این رستوران غیرفعال خواهد شد.',
        impactDetails: 'غیرفعال‌سازی دسترسی صندوق (POS)، منوی دیجیتال سر میز و نمایشگرهای آشپزخانه شعبه.',
        requireReason: true,
        reasonPlaceholder: 'مثال: بدهی معوق بیش از ۱۵ روز / نقض شرایط استفاده / درخواست رسمی مدیریت',
        confirmText: 'تعلیق قطعی سرویس',
        onConfirm: async (reason) => {
          if (global.RestaurantsRepository) {
            await global.RestaurantsRepository.transitionLifecycle(tenantId, 'suspended', reason);
            if (global.GMToast) global.GMToast.show(`سرویس مجموعه «${tenantId}» با موفقیت معلق شد.`, 'danger');
            if (global.GodModeRouter) global.GodModeRouter.handleRoute();
          }
        }
      });
    }

    openReactivateModal(tenantId) {
      if (global.GodModeCommandFramework) {
        global.GodModeCommandFramework.execute('ReactivateRestaurant', { tenantId }).catch(() => {});
        return;
      }
      if (!global.GodModeConfirmDialog) return;
      global.GodModeConfirmDialog.show({
        title: `رفع تعلیق و بازگشت به کار ${tenantId}`,
        severity: 'moderate',
        message: 'با رفع تعلیق، تمام ماژول‌ها و دسترسی‌های فعال این رستوران بلافاصله در دسترس قرار خواهند گرفت.',
        requireReason: true,
        reasonPlaceholder: 'مثال: تسویه حساب کامل صورتحساب / رفع مغایرت قراردادی',
        confirmText: 'فعال‌سازی مجدد',
        onConfirm: async (reason) => {
          if (global.RestaurantsRepository) {
            await global.RestaurantsRepository.transitionLifecycle(tenantId, 'active', reason);
            if (global.GMToast) global.GMToast.show(`سرویس مجموعه «${tenantId}» فعال شد.`, 'success');
            if (global.GodModeRouter) global.GodModeRouter.handleRoute();
          }
        }
      });
    }

    openSupportDelegationModal(tenantId) {
      if (global.GodModeCommandFramework) {
        global.GodModeCommandFramework.execute('CreateSupportSession', { tenantId }).catch(() => {});
        return;
      }
      if (!global.GodModeConfirmDialog) return;
      global.GodModeConfirmDialog.show({
        title: `ایجاد نشست تفویض پشتیبانی برای ${tenantId}`,
        severity: 'high',
        message: 'با ایجاد این نشست، دسترسی زمان‌دار (۳۰ دقیقه) به عنوان پشتیبان در پنل داخلی رستوران صادر شده و تمام اقدامات در ممیزی امنیتی ثبت می‌شود.',
        requireReason: true,
        reasonPlaceholder: 'شماره تیکت پشتیبانی و شرح عیب گزارش‌شده...',
        confirmText: 'صدور مجوز نشست پشتیبانی',
        onConfirm: async (reason) => {
          if (global.SupportRepository) {
            const session = await global.SupportRepository.createSupportSession(tenantId, reason, 30);
            if (global.GMToast) global.GMToast.show(`نشست پشتیبانی فعال شد (اعتبار: ۳۰ دقیقه).`, 'info');
          }
        }
      });
    }

    openAddBranchModal(tenantId) {
      const store = global.prototypeStore || global.GMStore;
      const tenant = store ? store.getTenant(tenantId) : null;
      const tenantName = tenant ? tenant.name : tenantId;

      const html = `
        <div style="font-size: 0.9rem;">
          <p style="color: #666; margin-bottom: 1.25rem;">
            ثبت شعبه فیزیکی جدید برای <strong>${esc(tenantName)}</strong>. پایانه‌ها و تجهیزات سفارش‌گیری می‌توانند به این شعبه اختصاص یابند.
          </p>
          <div class="form-group" style="margin-bottom: 1rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">نام شعبه <span class="text-danger">*</span></label>
            <input type="text" id="modal-branch-name" class="form-control" placeholder="مثال: شعبه ۲ (سعادت‌آباد)" style="width: 100%;" required />
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
            <div class="form-group">
              <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">کد شعبه</label>
              <input type="text" id="modal-branch-code" class="form-control" placeholder="BR-02" style="width: 100%;" />
            </div>
            <div class="form-group">
              <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">شهر</label>
              <input type="text" id="modal-branch-city" class="form-control" value="تهران" style="width: 100%;" />
            </div>
          </div>
          <div class="form-group" style="margin-bottom: 1rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">آدرس کامل شعبه</label>
            <input type="text" id="modal-branch-address" class="form-control" placeholder="خیابان، پلاک، طبقه..." style="width: 100%;" />
          </div>
        </div>
      `;

      if (global.GMApp && typeof global.GMApp.openModal === 'function') {
        global.GMApp.openModal(`افزودن شعبه جدید — ${tenantName}`, html, () => {
          const nameEl = document.getElementById('modal-branch-name');
          const codeEl = document.getElementById('modal-branch-code');
          const cityEl = document.getElementById('modal-branch-city');
          const addrEl = document.getElementById('modal-branch-address');
          const name = nameEl ? nameEl.value.trim() : '';
          if (!name) {
            if (global.GMToast) global.GMToast.show('وارد کردن نام شعبه الزامی است.', 'warning');
            return false;
          }
          if (store && typeof store.createBranch === 'function') {
            store.createBranch(tenantId, {
              name,
              code: codeEl?.value.trim() || `BR-0${Math.floor(2 + Math.random() * 8)}`,
              city: cityEl?.value.trim() || 'تهران',
              address: addrEl?.value.trim() || ''
            });
          }
          if (global.GMToast) global.GMToast.show(`شعبه «${name}» با موفقیت اضافه شد.`, 'success');
          if (global.GodModeRouter) global.GodModeRouter.handleRoute();
          return true;
        }, { confirmText: 'ثبت و راه‌اندازی شعبه' });
      }
    }

    openChangePlanModal(tenantId) {
      const store = global.prototypeStore || global.GMStore;
      const tenant = store ? store.getTenant(tenantId) : null;
      const currentPlan = tenant ? (tenant.plan || 'Growth') : 'Growth';

      const html = `
        <div style="font-size: 0.9rem;">
          <p style="color: #666; margin-bottom: 1.25rem;">
            انتخاب سطح اشتراک و پلن تجاری جدید برای مجموعه. تغییر پلن سهمیه‌ها و مجوزهای دسترسی را فوراً به‌روزرسانی می‌کند.
          </p>
          <div class="form-group" style="margin-bottom: 1rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">پلن تجاری جدید <span class="text-danger">*</span></label>
            <select id="modal-change-plan-select" class="form-control" style="width: 100%; padding: 0.5rem;">
              <option value="Starter" ${currentPlan.includes('Starter') ? 'selected' : ''}>Starter — پایه (تک‌شعبه / ۱ صندوق / ۲,۴۰۰,۰۰۰ تومان)</option>
              <option value="Growth" ${currentPlan.includes('Growth') ? 'selected' : ''}>Growth — رشد (تا ۲ شعبه / ۴ صندوق / ۳,۹۰۰,۰۰۰ تومان)</option>
              <option value="Scale" ${currentPlan.includes('Scale') ? 'selected' : ''}>Scale — توسعه (تا ۵ شعبه / ۸ صندوق / ۶,۹۰۰,۰۰۰ تومان)</option>
              <option value="Enterprise" ${currentPlan.includes('Enterprise') ? 'selected' : ''}>Enterprise — سازمانی (شعب نامحدود / اختصاصی / ۹,۹۰۰,۰۰۰ تومان)</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 1rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">دوره صورتحساب</label>
            <select id="modal-change-billing-cycle" class="form-control" style="width: 100%; padding: 0.5rem;">
              <option value="monthly">ماهانه (تمدید خودکار)</option>
              <option value="annual">سالانه (با ۲۰٪ تخفیف پرداخت نقدی)</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 0.5rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">علت تغییر پلن <span class="text-danger">*</span></label>
            <textarea id="modal-change-plan-reason" class="form-control" rows="2" placeholder="علت ارتقا یا دانگرید پلن (جهت ثبت در سند ممیزی)..." style="width: 100%;" required></textarea>
          </div>
        </div>
      `;

      if (global.GMApp && typeof global.GMApp.openModal === 'function') {
        global.GMApp.openModal('تغییر پلن اشتراک مجموعه', html, () => {
          const planSelect = document.getElementById('modal-change-plan-select');
          const reasonInput = document.getElementById('modal-change-plan-reason');
          const newPlan = planSelect ? planSelect.value : 'Growth';
          const reason = reasonInput ? reasonInput.value.trim() : '';
          if (!reason) {
            if (global.GMToast) global.GMToast.show('ثبت دلیل تغییر پلن الزامی است.', 'warning');
            return false;
          }
          if (store && typeof store.updateTenantPlan === 'function') {
            store.updateTenantPlan(tenantId, newPlan, reason);
          } else if (tenant) {
            tenant.plan = newPlan;
            if (typeof store?.save === 'function') store.save();
          }
          if (global.GMToast) global.GMToast.show(`پلن مجموعه به «${newPlan}» تغییر یافت و مجوزها به‌روز شدند.`, 'success');
          if (global.GodModeRouter) global.GodModeRouter.handleRoute();
          return true;
        }, { confirmText: 'تأیید و اعمال تغییر پلن' });
      }
    }

    openAddDomainModal(tenantId) {
      const store = global.prototypeStore || global.GMStore;
      const tenant = store ? store.getTenant(tenantId) : null;
      const tenantName = tenant ? tenant.name : tenantId;

      const html = `
        <div style="font-size: 0.9rem;">
          <p style="color: #666; margin-bottom: 1.25rem;">
            اتصال دامنه رسمی یا زیردامنه اختصاصی مشتری به پلتفرم سالسا برای <strong>${esc(tenantName)}</strong>.
          </p>
          <div class="form-group" style="margin-bottom: 1rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">نام دامنه اختصاصی <span class="text-danger">*</span></label>
            <input type="text" id="modal-domain-name" class="form-control" placeholder="مثال: menu.westocafe.ir" style="width: 100%; direction: ltr; text-align: right;" required />
          </div>
          <div style="background: var(--salsa-surface-subtle, #F9FAFB); padding: 0.85rem; border-radius: 8px; font-size: 0.8rem; color: #555; margin-bottom: 1rem; line-height: 1.6;">
            <strong>راهنمای تنظیم DNS:</strong>
            <div>یک رکورد CNAME با نام مورد نظر به آدرس <code>edge.salsa.ir</code> تعریف فرمایید. گواهی امنیتی SSL به صورت خودکار طی چند دقیقه صادر می‌گردد.</div>
          </div>
        </div>
      `;

      if (global.GMApp && typeof global.GMApp.openModal === 'function') {
        global.GMApp.openModal(`اتصال دامنه اختصاصی — ${tenantName}`, html, () => {
          const domainInput = document.getElementById('modal-domain-name');
          const domain = domainInput ? domainInput.value.trim().toLowerCase() : '';
          if (!domain || !domain.includes('.')) {
            if (global.GMToast) global.GMToast.show('لطفاً یک دامنه معتبر وارد نمایید.', 'warning');
            return false;
          }
          if (tenant) {
            tenant.domain = domain;
            if (!Array.isArray(tenant.domains)) tenant.domains = [];
            if (!tenant.domains.includes(domain)) tenant.domains.push(domain);
            if (store && typeof store.save === 'function') store.save();
          }
          if (global.GMToast) global.GMToast.show(`دامنه «${domain}» با موفقیت متصل شد و گواهی SSL در صف صدور قرار گرفت.`, 'success');
          if (global.GodModeRouter) global.GodModeRouter.handleRoute();
          return true;
        }, { confirmText: 'تأیید و اتصال دامنه' });
      }
    }

    openVerifyBackupModal(backupId) {
      if (!global.GodModeConfirmDialog) return;
      global.GodModeConfirmDialog.show({
        title: 'آزمون بازیابی اسنپ‌شات (Restore Drill)',
        severity: 'safe',
        message: `آیا مایل به اجرای مانور آزمایشی بازیابی اسنپ‌شات «${backupId}» در سندباکس ایزوله و بررسی تمامیت داده‌ها هستید؟`,
        impactDetails: 'این آزمون در کانتینر ایزوله موقت اجرا شده و هیچ تداخلی با عملیات فعال فروش و سفارش‌گیری رستوران ندارد.',
        requireReason: false,
        confirmText: 'اجرای آزمون یکپارچگی',
        onConfirm: async () => {
          const store = global.prototypeStore || global.GMStore;
          if (store && typeof store.verifyBackup === 'function') {
            const res = store.verifyBackup(backupId);
            if (res && res.success) {
              const detail = res.verifiedTables ? ` (${res.verifiedTables} جدول، ${res.verifiedRows} رکورد تأیید شد - مدت: ${res.drillDurationSeconds}s)` : '';
              if (global.GMToast) global.GMToast.show(`راستی‌آزمایی اسنپ‌شات با موفقیت انجام شد${detail}.`, 'success');
            } else {
              if (global.GMToast) global.GMToast.show(res?.error || 'خطا در راستی‌آزمایی اسنپ‌شات.', 'danger');
            }
          }
          if (global.GodModeRouter) global.GodModeRouter.handleRoute();
        }
      });
    }

    openRevokeSessionsModal(tenantId, memberId) {
      if (!global.GodModeConfirmDialog) return;
      global.GodModeConfirmDialog.show({
        title: 'ابطال نشست‌های فعال حساب',
        severity: 'high',
        message: 'آیا از ابطال تمامی نشست‌های فعال این حساب اطمینان دارید؟ کاربر فوراً از تمام مرورگرها و دستگاه‌ها خارج شده و نیاز به ورود مجدد خواهد داشت.',
        impactDetails: 'خروج آنی از پنل ادمین و صندوق متصل به این کاربر.',
        requireReason: true,
        reasonPlaceholder: 'علت ابطال نشست (مثال: تغییر مسئولیت پرسنل، اقدام پیشگیرانه امنیتی)...',
        confirmText: 'ابطال قطعی نشست‌ها',
        onConfirm: async (reason) => {
          const store = global.prototypeStore || global.GMStore;
          if (store && store.state?.auditLogs) {
            store.state.auditLogs.unshift({
              id: `aud_${Date.now()}`,
              action: 'ابطال نشست‌های کاربر',
              targetId: memberId || tenantId,
              actorId: 'مدیر ارشد پلتفرم',
              reason,
              occurredAt: new Date().toISOString()
            });
            if (typeof store.save === 'function') store.save();
          }
          if (global.GMToast) global.GMToast.show('نشست‌های فعال کاربر با موفقیت باطل شد.', 'success');
          if (global.GodModeRouter) global.GodModeRouter.handleRoute();
        }
      });
    }

    openCreateBackupModal(tenantId) {
      if (!global.GodModeConfirmDialog) return;
      global.GodModeConfirmDialog.show({
        title: 'ایجاد نسخه پشتیبان فوری (اسنپ‌شات ایزوله)',
        severity: 'safe',
        message: 'یک نسخه پشتیبان فوری از کلیه تنظیمات، فاکتورها، انبارداری و داده‌های پایگاه این مجموعه با امضای امنیتی SHA-256 ذخیره خواهد شد.',
        impactDetails: 'هیچ وقفه‌ای در عملیات صندوق و سفارش‌گیری مجموعه رخ نخواهد داد.',
        requireReason: false,
        confirmText: 'ایجاد و ذخیره اسنپ‌شات',
        onConfirm: async () => {
          const store = global.prototypeStore || global.GMStore;
          if (store && typeof store.createBackup === 'function') {
            store.createBackup(tenantId, {
              name: `اسنپ‌شات دستی فوری (${new Date().toLocaleTimeString('fa-IR')})`,
              reason: 'پشتیبان‌گیری فوری به درخواست اپراتور گاد مود'
            });
          }
          if (global.GMToast) global.GMToast.show('نسخه پشتیبان فوری با موفقیت ایجاد و اعتبارسنجی شد.', 'success');
          if (global.GodModeRouter) global.GodModeRouter.handleRoute();
        }
      });
    }

    openInviteTeamMemberModal() {
      const html = `
        <div style="font-size: 0.9rem;">
          <p style="color: #666; margin-bottom: 1.25rem;">
            ارسال دعوت‌نامه عضویت در تیم راهبری و SRE پلتفرم سالسا با تعیین نقش و دسترسی‌های دقیق.
          </p>
          <div class="form-group" style="margin-bottom: 1rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">نام و نام خانوادگی <span class="text-danger">*</span></label>
            <input type="text" id="modal-member-name" class="form-control" placeholder="مثال: رضا محمدی" style="width: 100%;" required />
          </div>
          <div class="form-group" style="margin-bottom: 1rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">آدرس ایمیل سازمانی <span class="text-danger">*</span></label>
            <input type="email" id="modal-member-email" class="form-control" placeholder="rmohammadi@salsa.ir" style="width: 100%; direction: ltr; text-align: right;" required />
          </div>
          <div class="form-group" style="margin-bottom: 0.5rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">نقش سطح پلتفرم (Platform RBAC)</label>
            <select id="modal-member-role" class="form-control" style="width: 100%; padding: 0.5rem;">
              <option value="platform_operations">مهندسی عملیات و پایش (Platform Operations)</option>
              <option value="platform_support">کارشناس پشتیبانی و حل اختلاف (Platform Support)</option>
              <option value="platform_finance">امور مالی و صدور فاکتور (Platform Finance)</option>
              <option value="platform_readonly">ناظر امنیتی فقط خواندنی (Platform Readonly)</option>
              <option value="platform_owner">مدیر ارشد و مالک پلتفرم (Platform Owner)</option>
            </select>
          </div>
        </div>
      `;

      if (global.GMApp && typeof global.GMApp.openModal === 'function') {
        global.GMApp.openModal('دعوت عضو جدید به تیم پلتفرم سالسا', html, () => {
          const nameInput = document.getElementById('modal-member-name');
          const emailInput = document.getElementById('modal-member-email');
          const roleSelect = document.getElementById('modal-member-role');
          const name = nameInput ? nameInput.value.trim() : '';
          const email = emailInput ? emailInput.value.trim() : '';
          const role = roleSelect ? roleSelect.value : 'platform_operations';
          if (!name || !email) {
            if (global.GMToast) global.GMToast.show('نام و ایمیل عضو جدید الزامی است.', 'warning');
            return false;
          }
          const store = global.prototypeStore || global.GMStore;
          if (store) {
            if (!store.state.platformUsers) store.state.platformUsers = [];
            store.state.platformUsers.push({
              id: `usr_${Date.now()}`,
              name,
              email,
              role,
              status: 'invited',
              createdAt: new Date().toISOString()
            });
            if (store.state.auditLogs) {
              store.state.auditLogs.unshift({
                id: `aud_${Date.now()}`,
                action: 'دعوت عضو جدید به تیم سالسا',
                targetId: email,
                actorId: 'مدیر ارشد پلتفرم',
                reason: `تخصیص دسترسی سطح ${role}`,
                occurredAt: new Date().toISOString()
              });
            }
            if (typeof store.save === 'function') store.save();
          }
          if (global.GMToast) global.GMToast.show(`دعوت‌نامه امنیتی با موفقیت برای «${name}» ارسال شد.`, 'success');
          if (global.GodModeRouter) global.GodModeRouter.handleRoute();
          return true;
        }, { confirmText: 'ارسال دعوت‌نامه' });
      }
    }

    openInviteTenantAdminModal(tenantId) {
      const store = global.prototypeStore || global.GMStore;
      const tenant = store ? store.getTenant(tenantId) : null;
      const tenantName = tenant ? tenant.name : tenantId;

      const html = `
        <div style="font-size: 0.9rem;">
          <p style="color: #666; margin-bottom: 1.25rem;">
            ارسال دعوت‌نامه به مدیر یا شریک جدید برای دسترسی به پنل مدیریت <strong>${esc(tenantName)}</strong>.
          </p>
          <div class="form-group" style="margin-bottom: 1rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">نام و نام خانوادگی مدیر <span class="text-danger">*</span></label>
            <input type="text" id="modal-tenant-admin-name" class="form-control" placeholder="مثال: سهراب حسینی" style="width: 100%;" required />
          </div>
          <div class="form-group" style="margin-bottom: 1rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">شماره همراه (جهت ورود پیامکی) <span class="text-danger">*</span></label>
            <input type="tel" id="modal-tenant-admin-phone" class="form-control" placeholder="۰۹۱۲۰۰۰۰۰۰۰" style="width: 100%; direction: ltr; text-align: right;" required />
          </div>
          <div class="form-group" style="margin-bottom: 0.5rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">سمت یا نقش در رستوران</label>
            <select id="modal-tenant-admin-role" class="form-control" style="width: 100%; padding: 0.5rem;">
              <option value="manager">مدیر شعبه (Branch Manager)</option>
              <option value="admin">مدیر فنی و سیستم (Tenant Admin)</option>
              <option value="accountant">حسابدار ارشد (Head Accountant)</option>
            </select>
          </div>
        </div>
      `;

      if (global.GMApp && typeof global.GMApp.openModal === 'function') {
        global.GMApp.openModal(`دعوت مدیر جدید — ${tenantName}`, html, () => {
          const nameInput = document.getElementById('modal-tenant-admin-name');
          const phoneInput = document.getElementById('modal-tenant-admin-phone');
          const roleInput = document.getElementById('modal-tenant-admin-role');
          const name = nameInput ? nameInput.value.trim() : '';
          const phone = phoneInput ? phoneInput.value.trim() : '';
          const role = roleInput ? roleInput.value : 'admin';
          if (!name || !phone) {
            if (global.GMToast) global.GMToast.show('نام و شماره همراه مدیر الزامی است.', 'warning');
            return false;
          }
          if (store && typeof store.addTenantUser === 'function') {
            store.addTenantUser(tenantId, { name, phone, role });
          }
          if (global.GMToast) global.GMToast.show(`دعوت‌نامه ورود با موفقیت برای «${name}» ارسال شد.`, 'success');
          if (global.GodModeRouter) global.GodModeRouter.handleRoute();
          return true;
        }, { confirmText: 'ارسال دعوت‌نامه پیامکی' });
      }
    }

    openAddDeviceModal(tenantId) {
      const store = global.prototypeStore || global.GMStore;
      const tenant = store ? store.getTenant(tenantId) : null;
      const tenantName = tenant ? tenant.name : tenantId;
      const branches = store && typeof store.getBranches === 'function' ? store.getBranches(tenantId) : [];

      const html = `
        <div style="font-size: 0.9rem;">
          <p style="color: #666; margin-bottom: 1.25rem;">
            ثبت و اتصال پایانه فروشگاهی، نمایشگر آشپزخانه یا تبلت برای مجموعه <strong>${esc(tenantName)}</strong>.
          </p>
          <div class="form-group" style="margin-bottom: 1rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">نام پایانه یا نام مستعار <span class="text-danger">*</span></label>
            <input type="text" id="modal-device-name" class="form-control" placeholder="مثال: صندوق ۲ سالن VIP یا نمایشگر بار" style="width: 100%;" required />
          </div>
          <div class="form-group" style="margin-bottom: 1rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">نوع دستگاه / کاربرد</label>
            <select id="modal-device-type" class="form-control" style="width: 100%; padding: 0.5rem;">
              <option value="Desktop POS (Windows/Electron)">صندوق اصلی فروش (Desktop POS)</option>
              <option value="Kitchen Display System (KDS)">نمایشگر سفارش آشپزخانه (KDS)</option>
              <option value="Waiter Tablet (Android/PWA)">تبلت سفارش‌گیری سالن‌دار (Tablet)</option>
              <option value="Self-Order Kiosk">کیوسک سفارش‌گیر مشتری (Kiosk)</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 1rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">شعبه استقرار</label>
            <select id="modal-device-branch" class="form-control" style="width: 100%; padding: 0.5rem;">
              ${branches.length > 0 ? branches.map(b => `<option value="${esc(b.name)}">${esc(b.name)}</option>`).join('') : '<option value="شعبه اصلی">شعبه اصلی</option>'}
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 0.5rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">آدرس IP محلی (اختیاری)</label>
            <input type="text" id="modal-device-ip" class="form-control" placeholder="192.168.1.110" style="width: 100%; font-family: var(--font-mono); direction: ltr; text-align: right;" />
          </div>
        </div>
      `;

      if (global.GMApp && typeof global.GMApp.openModal === 'function') {
        global.GMApp.openModal(`ثبت پایانه سخت‌افزاری — ${tenantName}`, html, () => {
          const nameInput = document.getElementById('modal-device-name');
          const typeInput = document.getElementById('modal-device-type');
          const branchInput = document.getElementById('modal-device-branch');
          const ipInput = document.getElementById('modal-device-ip');

          const name = nameInput ? nameInput.value.trim() : '';
          const type = typeInput ? typeInput.value : 'Desktop POS (Windows/Electron)';
          const branch = branchInput ? branchInput.value : 'شعبه اصلی';
          const ipAddress = ipInput ? ipInput.value.trim() : '192.168.1.110';

          if (!name) {
            if (global.GMToast) global.GMToast.show('نام پایانه الزامی است.', 'warning');
            return false;
          }

          if (store && typeof store.addDevice === 'function') {
            store.addDevice(tenantId, { name, type, branch, ipAddress });
          }

          if (global.GMToast) global.GMToast.show(`پایانه «${name}» با موفقیت افزوده شد.`, 'success');
          if (global.GodModeRouter) global.GodModeRouter.handleRoute();
          return true;
        }, { confirmText: 'ثبت پایانه' });
      }
    }

    openAddHardwareModal() {
      const html = `
        <div style="font-size: 0.9rem;">
          <p style="color: #666; margin-bottom: 1.25rem;">
            ثبت مدل چاپگر یا پایانه سخت‌افزاری جدید با گواهی رسمی تطابق با پروتکل ESC/POS سالسا.
          </p>
          <div class="form-group" style="margin-bottom: 1rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">نام سازنده / برند <span class="text-danger">*</span></label>
            <input type="text" id="modal-hw-manufacturer" class="form-control" placeholder="مثال: EPSON یا BIXOLON یا SEWOO" style="width: 100%;" required />
          </div>
          <div class="form-group" style="margin-bottom: 1rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">مدل دقیق دستگاه <span class="text-danger">*</span></label>
            <input type="text" id="modal-hw-model" class="form-control" placeholder="مثال: TM-T20III" style="width: 100%; font-family: var(--font-mono);" required />
          </div>
          <div class="form-group" style="margin-bottom: 1rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">نوع دستگاه</label>
            <select id="modal-hw-type" class="form-control" style="width: 100%; padding: 0.5rem;">
              <option value="چاپگر حرارتی صدور فیش">چاپگر حرارتی صدور فیش</option>
              <option value="چاپگر حرارتی سفارش آشپزخانه">چاپگر حرارتی سفارش آشپزخانه</option>
              <option value="چاپگر برچسب و بارکد">چاپگر برچسب و بارکد</option>
              <option value="پایانه لمسی صندوق (POS)">پایانه لمسی صندوق (POS)</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 0.5rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">عرض کاغذ و مشخصات چاپ</label>
            <input type="text" id="modal-hw-width" class="form-control" placeholder="80mm / Auto Cutter" style="width: 100%; font-family: var(--font-mono);" />
          </div>
        </div>
      `;

      if (global.GMApp && typeof global.GMApp.openModal === 'function') {
        global.GMApp.openModal('ثبت مدل سخت‌افزار در کاتالوگ رسمی', html, () => {
          const manufacturer = document.getElementById('modal-hw-manufacturer')?.value.trim();
          const model = document.getElementById('modal-hw-model')?.value.trim();
          const type = document.getElementById('modal-hw-type')?.value;
          const paperWidth = document.getElementById('modal-hw-width')?.value.trim() || '80mm';

          if (!manufacturer || !model) {
            if (global.GMToast) global.GMToast.show('نام سازنده و مدل دستگاه الزامی است.', 'warning');
            return false;
          }

          const store = global.prototypeStore || global.GMStore;
          if (store && typeof store.addHardwareModel === 'function') {
            store.addHardwareModel({ manufacturer, model, type, paperWidth });
          }
          if (global.GMToast) global.GMToast.show(`مدل «${manufacturer} ${model}» با موفقیت ثبت شد.`, 'success');
          if (global.GodModeRouter) global.GodModeRouter.handleRoute();
          return true;
        }, { confirmText: 'ثبت در کاتالوگ' });
      }
    }
  }

  const GodModeAppShell = new GodModeAppShellManager();
  global.GodModeAppShell = GodModeAppShell;
  global.GMApp = GodModeAppShell;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GodModeAppShell;
  }
})(typeof window !== 'undefined' ? window : globalThis);
