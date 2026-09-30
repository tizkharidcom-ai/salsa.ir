// prototype/js/app.js
// Main Application Controller for GODMODE Prototype

window.GMApp = {
  activeModalCallback: null,
  lastFocusedElement: null,
  sidebarReturnFocus: null,

  init() {
    console.log('GODMODE Phase 1 Prototype Initialized.');
    this.initTheme();
    this.restoreSidebarState();
    this.setupEventListeners();
    this.syncMobileSidebarAccessibility();
    if (window.GMCommandPalette && typeof window.GMCommandPalette.initListeners === 'function') {
      window.GMCommandPalette.initListeners();
    }
    this.updateActivityBadge();
    this.updateProvenanceBanner();
    this.updateKernelHealthBadge();
    window.GMRouter.init();
    this.initSidebarGroups();

    if (window.GMEventBus && typeof window.GMEventBus.on === 'function') {
      window.GMEventBus.on('gm:route-changed', () => {
        this.updateKernelHealthBadge();
      });
    }

    const store = window.prototypeStore || window.GMStore;
    if (store && typeof store.subscribe === 'function') {
      store.subscribe(() => {
        this.updateProvenanceBanner();
        this.updateKernelHealthBadge();
      });
    }
  },

  quickToggleTenantStatus(tenantId) {
    const store = window.prototypeStore || window.GMStore;
    if (!store) return;
    const tenants = store.getTenants ? store.getTenants() : (store.state?.tenants || []);
    const tenant = tenants.find((t) => t.id === tenantId);
    if (!tenant) return;
    const nextStatus = tenant.status === 'active' ? 'suspended' : 'active';
    const label = nextStatus === 'active' ? 'فعال' : 'معلق';

    const executeToggle = async (reason = 'تغییر وضعیت سریع از نوار مدیریت') => {
      try {
        if (window.RestaurantsRepository && typeof window.RestaurantsRepository.updateLifecycle === 'function') {
          await window.RestaurantsRepository.updateLifecycle(tenantId, nextStatus, reason);
        } else {
          tenant.status = nextStatus;
          if (typeof store.save === 'function') store.save();
        }
        if (window.GMToast && typeof window.GMToast.show === 'function') {
          window.GMToast.show(`وضعیت «${tenant.name}» به ${label} تغییر یافت.`, 'info');
        }
        if (window.GodModeRouter && typeof window.GodModeRouter.renderCurrentRoute === 'function') {
          window.GodModeRouter.renderCurrentRoute();
        } else if (window.GMRouter && typeof window.GMRouter.handleRoute === 'function') {
          window.GMRouter.handleRoute();
        }
      } catch (err) {
        if (window.GMToast) window.GMToast.show('خطا در تغییر وضعیت: ' + err.message, 'error');
      }
    };

    if (window.ConfirmDialog && typeof window.ConfirmDialog.open === 'function') {
      window.ConfirmDialog.open({
        title: `${nextStatus === 'active' ? 'فعال‌سازی مجدد' : 'تعلیق'} حساب رستوران ${tenant.name}`,
        message: nextStatus === 'active'
          ? `آیا از فعال‌سازی مجدد حساب «${tenant.name}» اطمینان دارید؟ تمام دسترسی‌ها و سرویس‌های فعال بازیابی خواهند شد.`
          : `هشدار: با تعلیق حساب، دسترسی کلیه پرسنل و پایانه‌های POS و KDS این رستوران موقتاً مسدود می‌شود.`,
        impactText: nextStatus === 'active' ? 'بازیابی سرویس‌های فعال پایانه و سفارش‌گیری' : 'قطع موقت تمامی سرویس‌ها و پایانه‌های شعبه',
        confirmLabel: `تأیید و ${label} کردن`,
        danger: nextStatus === 'suspended',
        requireReason: true,
        onConfirm: async (reason) => {
          await executeToggle(reason);
        }
      });
      return;
    }

    executeToggle();
  },

  quickToggleFeature(featureKey, tenantId = null) {
    const store = window.prototypeStore || window.GMStore;
    if (!store) return;
    tenantId = tenantId || (typeof store.getActiveTenantId === 'function' ? store.getActiveTenantId() : null);
    if (!tenantId || (typeof store.getTenant === 'function' && !store.getTenant(tenantId))) {
      if (window.GMToast) window.GMToast.show('ابتدا یک مشتری معتبر را از فهرست باز کنید.', 'warning');
      return;
    }
    const isNowActive = !store.isFeatureEnabled(tenantId, featureKey);
    store.toggleFeature(tenantId, featureKey, isNowActive);
    const tenantSlug = tenantId === 'tnt_westo_demo' ? 'westo' : (tenantId.startsWith('tnt_') ? tenantId.replace(/^tnt_/, '') : tenantId);
    this.syncFeatureToggleToLiveServer(featureKey, isNowActive, tenantSlug);

    const feature = store.state?.features?.find((f) => f.key === featureKey);
    const label = isNowActive ? 'روشن (فعال)' : 'خاموش (غیرفعال)';
    const name = feature?.nameFa || featureKey;

    if (window.GMToast && typeof window.GMToast.show === 'function') {
      window.GMToast.show(`قابلیت «${name}» اکنون ${label} است.`, 'success');
    }

    // If currently on GM-04, retain tab=features in URL
    if (window.location.hash && window.location.hash.includes('gm-04-tenant-detail') && !window.location.hash.includes('tab=')) {
      const [base, q] = window.location.hash.split('?');
      const search = new URLSearchParams(q || '');
      search.set('tab', 'features');
      if (tenantId && !search.get('id')) search.set('id', tenantId);
      window.location.hash = `${base}?${search.toString()}`;
      return;
    }

    // Refresh UI to reflect immediate state change
    if (window.GodModeRouter && typeof window.GodModeRouter.renderCurrentRoute === 'function') {
      window.GodModeRouter.renderCurrentRoute();
    } else if (window.GMRouter && typeof window.GMRouter.handleRoute === 'function') {
      window.GMRouter.handleRoute();
    }
  },

  async syncFeatureToggleToLiveServer(featureKey, enabled, tenantId = 'westo') {
    // In God Mode, all backend actions route strictly through Control Plane (port 3061).
    // Zero direct fetch to tenant runtime port 4180 (superadmin.md §11).
    if (window.EntitlementsRepository && typeof window.EntitlementsRepository.setModuleStatus === 'function') {
      try {
        await window.EntitlementsRepository.setModuleStatus(tenantId, featureKey, enabled, 'همگام‌سازی از منوی سریع سوپر ادمین');
      } catch (err) {
        console.warn('Control Plane module sync:', err.message);
      }
    }
  },

  async provisionTenantOnLiveServer(slug, name, domain) {
    // In God Mode, tenant onboarding routes strictly through Control Plane (port 3061).
    // Zero direct fetch to port 4180 (superadmin.md §11).
    if (window.RestaurantsRepository && typeof window.RestaurantsRepository.create === 'function') {
      try {
        await window.RestaurantsRepository.create({
          tenantId: slug,
          displayName: name,
          canonicalDomain: domain || `${slug}.salsa.ir`,
          planCode: 'starter'
        });
      } catch (err) {
        console.warn('Control Plane tenant provisioning:', err.message);
      }
    }
  },

  quickAddTenant(event) {
    if (event) event.preventDefault();
    window.location.hash = '#gm-05-tenant-new';
  },

  quickSyncData() {
    if (window.GMToast) {
      window.GMToast.show('همگام‌سازی با کنترل‌پلن زنده با موفقیت فراخوانی شد.', 'success');
    }
  },

  quickExportBackup() {
    const store = window.prototypeStore || window.GMStore;
    const data = store && store.state ? store.state : { timestamp: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `salsa-prototype-fixture-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (window.GMToast) {
      window.GMToast.show('فایل خروجی داده‌های پلتفرم با موفقیت دانلود شد.', 'info');
    }
  },

  quickClearCache() {
    try {
      const preserveKeys = ['salsa_nav_mode', 'salsa_sidebar_collapsed'];
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith('salsa_') && !preserveKeys.includes(k)) {
          localStorage.removeItem(k);
        }
      });
    } catch (e) {}
    if (window.GMToast) {
      window.GMToast.show('حافظه موقت کش پاکسازی شد.', 'success');
    }
    if (window.GMRouter && typeof window.GMRouter.handleRoute === 'function') {
      window.GMRouter.handleRoute();
    }
  },

  quickResetMock() {
    const store = window.prototypeStore || window.GMStore;
    if (store && typeof store.resetStore === 'function') {
      store.resetStore();
    }
    if (window.GMToast) {
      window.GMToast.show('داده‌های اولیه سامانه بازنشانی شدند.', 'info');
    }
    if (window.GMRouter && typeof window.GMRouter.handleRoute === 'function') {
      window.GMRouter.handleRoute();
    }
  },

  toggleSidebarCollapse() {
    const layout = document.querySelector('.app-layout');
    if (!layout) return;
    const isCollapsed = layout.classList.toggle('sidebar-collapsed');
    try {
      localStorage.setItem('salsa_sidebar_collapsed', isCollapsed ? 'true' : 'false');
    } catch (e) {}
  },

  restoreSidebarState() {
    try {
      if (localStorage.getItem('salsa_sidebar_collapsed') === 'true') {
        const layout = document.querySelector('.app-layout');
        if (layout) layout.classList.add('sidebar-collapsed');
      }
    } catch (e) {}
  },

  initSidebarGroups() {
    const groups = document.querySelectorAll('.nav-group[data-nav-group]');
    if (!groups.length) return;

    // New information architecture gets a clean expansion state so stale
    // preferences from the former taxonomy cannot reopen unrelated groups.
    const storageKey = 'salsa_sidebar_groups_v5_single_workspace';
    const legacyStorageKey = 'neem_sidebar_groups_v5_single_workspace';
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(storageKey) || localStorage.getItem(legacyStorageKey) || '{}') || {};
    } catch (e) {}

    const activeGroup = document.querySelector('.nav-group.is-active-group')?.dataset.navGroup;

    groups.forEach((group) => {
      const key = group.dataset.navGroup;
      const toggle = group.querySelector('[data-nav-group-toggle]');
      if (!toggle) return;

      const expanded = key === activeGroup || (!activeGroup && key === 'overview');
      this.setSidebarGroupExpanded(group, toggle, expanded);

      if (toggle.dataset.bound === 'true') return;
      toggle.dataset.bound = 'true';
      toggle.addEventListener('click', () => {
        const nextExpanded = group.classList.contains('is-collapsed');
        if (nextExpanded) {
          groups.forEach((otherGroup) => {
            if (otherGroup === group) return;
            const otherKey = otherGroup.dataset.navGroup;
            const otherToggle = otherGroup.querySelector('[data-nav-group-toggle]');
            if (otherToggle) this.setSidebarGroupExpanded(otherGroup, otherToggle, false);
            saved[otherKey] = false;
          });
        }
        this.setSidebarGroupExpanded(group, toggle, nextExpanded);
        saved[key] = nextExpanded;
        try {
          localStorage.setItem(storageKey, JSON.stringify(saved));
        } catch (e) {}
      });
    });
  },

  setSidebarGroupExpanded(group, toggle, expanded) {
    group.classList.toggle('is-collapsed', !expanded);
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  },

  updateKernelHealthBadge() {
    const badge = document.getElementById('kernel-health-badge');
    if (!badge || !window.GMKernel) return;
    const all = window.GMKernel.getAllModules();
    const healthy = all.filter(m => m.status === 'healthy' || m.status === 'recovering').length;
    badge.textContent = `${healthy.toLocaleString('fa-IR')}/${all.length.toLocaleString('fa-IR')}`;
    if (healthy === all.length) {
      badge.className = 'badge badge-xs badge-success';
    } else {
      badge.className = 'badge badge-xs badge-warning';
    }
  },

  openKernelHealthDrawer() {
    if (!window.GMKernel) return;
    const kernel = window.GMKernel;
    const probe = kernel.runFullProbe();
    const allModules = kernel.getAllModules();
    const workspaces = Object.values(kernel.workspaces);

    const wsCards = workspaces.map(ws => {
      const wsMods = allModules.filter(m => m.workspaceId === ws.id);
      const wsHealthy = wsMods.filter(m => m.status === 'healthy').length;
      return `
        <div style="background: var(--gm-surface, #fff); border: 1px solid var(--gm-border, #e2e8f0); border-radius: 8px; padding: 0.75rem; display: grid; gap: 0.25rem;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <strong style="font-size: 0.8rem; color: var(--gm-ink, #0f172a);">${ws.icon} ${ws.titleFa}</strong>
            <span class="badge badge-xs ${wsHealthy === wsMods.length ? 'badge-success' : 'badge-warning'}">
              ${wsHealthy.toLocaleString('fa-IR')} / ${wsMods.length.toLocaleString('fa-IR')}
            </span>
          </div>
          <small style="color: var(--gm-muted, #64748b); font-size: 0.68rem;">${wsMods.length} ماژول مستقل و ایزوله</small>
        </div>
      `;
    }).join('');

    const modRows = allModules.map(m => {
      const isIsolated = m.status === 'isolated' || m.circuitTripped;
      const isHealthy = m.status === 'healthy';
      const tone = isHealthy ? 'success' : (isIsolated ? 'danger' : 'warning');
      const statusText = isHealthy ? 'سالم و فعال' : (isIsolated ? 'ایزوله (مدارشکن)' : 'در حال بازیابی');

      return `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 0.8rem; border-bottom: 1px solid var(--gm-border, #f1f5f9); font-size: 0.73rem;">
          <div style="display: grid; gap: 0.15rem; min-width: 0;">
            <div style="display: flex; align-items: center; gap: 0.4rem;">
              <code style="font-family: monospace; font-weight: bold; color: var(--gm-accent, #E6292A);">${m.id}</code>
              <strong style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${m.titleFa}</strong>
            </div>
            <small style="color: var(--gm-muted, #64748b);">مسیر: #${m.route} · حوزه: ${m.scope}</small>
          </div>
          <div style="display: flex; align-items: center; gap: 0.5rem; flex: 0 0 auto;">
            <span class="badge badge-xs badge-${tone}">
              <span class="status-dot dot-${tone === 'success' ? 'green' : (tone === 'danger' ? 'red' : 'amber')}"></span>
              ${statusText}
            </span>
            <button type="button" class="btn btn-outline-secondary btn-xs" onclick="window.GMKernel.retryModule('${m.id}'); window.GMApp.openKernelHealthDrawer(); window.GMToast && window.GMToast.show('ماژول ${m.id} بازنشانی شد.', 'info');" title="ریست وضعیت خطا و مدارشکن">
              ↺ ریست
            </button>
            <a href="#${m.route}" class="btn btn-primary btn-xs" onclick="window.GMDrawer && window.GMDrawer.close();" title="مسیریابی مستقیم">
              مشاهده ←
            </a>
          </div>
        </div>
      `;
    }).join('');

    const drawerBody = `
      <div style="display: grid; gap: 1rem; padding: 0.25rem;">
        <div style="background: linear-gradient(135deg, rgba(49,87,213,0.06), rgba(18,183,106,0.04)); border: 1px solid var(--gm-border, #e2e8f0); border-radius: 10px; padding: 1rem; display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;">
          <div>
            <h4 style="margin: 0; font-size: 0.95rem; color: var(--gm-ink, #0f172a);">
              معماری مونولیت ماژولار گادمود (Modular Monolith)
            </h4>
            <p style="margin: 0.25rem 0 0; font-size: 0.72rem; color: var(--gm-muted, #64748b);">
              تمام ۲۸ صفحه در کپسول‌های ایزوله با حصار مهار خطا (Blast-Radius Containment) اجرا می‌شوند.
            </p>
          </div>
          <div style="text-align: left;">
            <div style="font-size: 1.25rem; font-weight: 800; color: #15803d; font-family: monospace;">
              ${probe.percent.toLocaleString('fa-IR')}٪
            </div>
            <small style="font-size: 0.68rem; color: #166534; font-weight: 700;">سلامت کل</small>
          </div>
        </div>

        <div>
          <h5 style="margin: 0 0 0.5rem; font-size: 0.8rem; color: var(--gm-ink, #0f172a);">
            تفکیک ۶ فضای کاری اصلی (Workspaces)
          </h5>
          <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem;">
            ${wsCards}
          </div>
        </div>

        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 0.5rem;">
          <h5 style="margin: 0; font-size: 0.8rem; color: var(--gm-ink, #0f172a);">
            وضعیت تفصیلی ۲۸ ماژول و مدارشکن‌ها
          </h5>
          <button type="button" class="btn btn-outline-primary btn-xs" onclick="const p = window.GMKernel.runFullProbe(); window.GMToast && window.GMToast.show('پروب زنده انجام شد: ' + p.healthy + ' از ' + p.total + ' ماژول سالم هستند.', 'success'); window.GMApp.openKernelHealthDrawer();">
            ⚡ تست پروب زنده همه ماژول‌ها
          </button>
        </div>

        <div style="background: var(--gm-surface, #fff); border: 1px solid var(--gm-border, #e2e8f0); border-radius: 8px; max-height: 380px; overflow-y: auto;">
          ${modRows}
        </div>
      </div>
    `;

    if (window.GMDrawer && typeof window.GMDrawer.open === 'function') {
      window.GMDrawer.open('⚡ وضعیت سلامت و ایزولاسیون مونولیت ماژولار (۲۸ ماژول)', drawerBody, {
        subtitle: 'پایش بلادرنگ ۶ فضای کاری و مهار خطای انفرادی صفحات',
        badge: 'Modular Monolith Kernel'
      });
    }
  },


  applyPageNavigationContext(viewName) {
    const route = window.GMCommandPalette?.routes?.find((item) => item.id === viewName);
    const contract = window.GMPageContracts?.getForView(viewName);
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
      mainContent.dataset.view = viewName || '';
      mainContent.dataset.module = contract?.module || 'overview';
      mainContent.dataset.scope = contract?.scope || 'platform';
    }
    document.body.dataset.activeModule = contract?.module || 'overview';
    document.body.dataset.activeScope = contract?.scope || 'platform';
    const breadcrumb = document.querySelector('#main-content .breadcrumb-nav');
    if (!route || !breadcrumb) return;

    // GM-04 owns its complete customer hierarchy. Its breadcrumb is rendered
    // from the active dossier tab and must not receive the platform-level
    // section/current-title injection used by standalone pages.
    if (breadcrumb.dataset.breadcrumbContext === 'customer-dossier') return;

    const hashQuery = new URLSearchParams((window.location.hash || '').split('?')[1] || '');
    const requestedTenantId = hashQuery.get('id') || hashQuery.get('tenantId');
    const isAggregateTenantView = requestedTenantId === 'all' || (viewName === 'GM11' && !requestedTenantId);
    const store = window.prototypeStore || window.GMStore;
    const tenantId = requestedTenantId || (store && typeof store.getActiveTenantId === 'function' ? store.getActiveTenantId() : null);
    const tenant = tenantId && store && typeof store.getTenant === 'function' ? store.getTenant(tenantId) : null;

    // Every tenant-scoped standalone route still belongs to the customer
    // dossier. Keep one readable hierarchy even when a legacy deep link opens
    // a functional view directly; aggregate platform views retain their own
    // module context.
    if (contract?.scope === 'tenant' && !isAggregateTenantView) {
      const escapeBreadcrumbText = (value) => String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
      breadcrumb.dataset.breadcrumbContext = 'customer-route';
      breadcrumb.setAttribute('aria-label', 'مسیر پرونده مشتری');
      breadcrumb.innerHTML = `
        <a href="#gm-03-tenants" class="breadcrumb-link">مشتریان</a>
        <span class="breadcrumb-separator">/</span>
        <a href="#gm-04-tenant-detail?id=${encodeURIComponent(tenant?.id || tenantId || '')}&tab=summary" class="breadcrumb-link breadcrumb-tenant">${escapeBreadcrumbText(tenant?.name || 'مشتری انتخاب‌شده')}</a>
        <span class="breadcrumb-separator">/</span>
        <span class="breadcrumb-current" aria-current="page">${escapeBreadcrumbText(route.title)}</span>
      `;
      return;
    }

    const current = breadcrumb.querySelector('.breadcrumb-current');
    if (current) {
      current.textContent = route.title;
      current.title = `${route.code}: ${route.title}`;
    }

    let section = breadcrumb.querySelector('.breadcrumb-section');
    if (!section) {
      const firstSeparator = breadcrumb.querySelector('.breadcrumb-separator');
      if (!firstSeparator) return;
      section = document.createElement('span');
      section.className = 'breadcrumb-section';
      section.setAttribute('aria-label', 'حوزه کاری');
      const separator = document.createElement('span');
      separator.className = 'breadcrumb-separator';
      separator.setAttribute('aria-hidden', 'true');
      separator.textContent = '/';
      firstSeparator.after(section, separator);
    }
    // Tenant routes stay inside the customer dossier hierarchy even when their
    // functional module is billing, security, infrastructure, or operations.
    section.textContent = contract?.scope === 'tenant' && !isAggregateTenantView ? 'مشتریان' : route.category;

    // Process maps remain available from the command palette and the
    // workflow hub. They are intentionally not injected into every page: the
    // operator's current task should own the first viewport.
    document.getElementById('workflow-stepper-bar')?.remove();
  },

  setupEventListeners() {
    window.addEventListener('resize', () => this.syncMobileSidebarAccessibility());
    // Keyboard accessibility: Escape key and focus trapping (WCAG 2.1.2 & 2.4.3)
    document.addEventListener('keydown', (e) => {
      // Global Command Palette Shortcut: Cmd+K / Ctrl+K or / (when not focused in inputs)
      const isCmdK = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K');
      const isSlash = e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (isCmdK || isSlash) {
        e.preventDefault();
        this.toggleCommandPalette();
        return;
      }

      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

      // Global Help shortcut: '?' (when not in text input)
      if (e.key === '?' && !isInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        this.openShortcutsHelpModal();
        return;
      }

      // Quick navigation shortcuts with Alt key
      if (e.altKey && !e.metaKey && !e.ctrlKey) {
        const altKey = e.key.toLowerCase();
        const altRoutes = {
          'h': '#gm-02-overview',
          'c': '#gm-03-tenants',
          'b': '#gm-11-billing',
          'p': '#gm-10-plans',
          'd': '#gm-19-devices',
          'o': '#gm-22-operations',
          'a': '#gm-26-audit',
          's': '#gm-21-support',
          'w': '#proc-onboarding',
        };
        if (altRoutes[altKey]) {
          e.preventDefault();
          if (altKey === 'w' && window.GMWorkflows && typeof window.GMWorkflows.openHierarchyModal === 'function') {
            window.GMWorkflows.openHierarchyModal();
          } else {
            window.location.hash = altRoutes[altKey];
          }
          return;
        }
      }

      // Two-stroke sequential navigation (g + key)
      if (!isInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const now = Date.now();
        if (e.key.toLowerCase() === 'g') {
          this._lastGTime = now;
          return;
        }
        if (this._lastGTime && (now - this._lastGTime) < 850) {
          const gKey = e.key.toLowerCase();
          this._lastGTime = 0;
          const gRoutes = {
            'h': '#gm-02-overview',
            'c': '#gm-03-tenants',
            'b': '#gm-11-billing',
            'p': '#gm-10-plans',
            'd': '#gm-19-devices',
            'o': '#gm-22-operations',
            'a': '#gm-26-audit',
            's': '#gm-21-support',
          };
          if (gRoutes[gKey]) {
            e.preventDefault();
            window.location.hash = gRoutes[gKey];
            return;
          }
        }
      }

      if (e.key === 'Escape') {
        const cmdPalette = document.getElementById('command-palette-backdrop');
        if (cmdPalette && cmdPalette.classList.contains('open')) {
          this.closeCommandPalette();
          return;
        }
        const modalBackdrop = document.getElementById('modal-backdrop');
        if (modalBackdrop && modalBackdrop.classList.contains('open')) {
          this.closeModal();
          return;
        }
        const wfBackdrop = document.getElementById('workflow-modal-backdrop');
        if (wfBackdrop && wfBackdrop.classList.contains('open')) {
          if (window.GMWorkflows && typeof window.GMWorkflows.closeHierarchyModal === 'function') {
            window.GMWorkflows.closeHierarchyModal();
          }
          return;
        }
        const appDrawer = document.getElementById('app-drawer');
        if (appDrawer && appDrawer.classList.contains('open')) {
          this.closeDrawer();
          return;
        }
        const sidebar = document.getElementById('app-sidebar');
        if (sidebar && sidebar.classList.contains('open')) {
          this.toggleSidebar(false);
          return;
        }
        if (window.GMTableSelect && typeof window.GMTableSelect.clearActive === 'function') {
          const cleared = window.GMTableSelect.clearActive();
          if (cleared) return;
        }
      }

      // Tab trap for active command palette
      const cmdPalette = document.getElementById('command-palette-backdrop');
      if (cmdPalette && cmdPalette.classList.contains('open')) {
        this.trapFocus(cmdPalette, e);
        return;
      }

      // Tab trap for active modal
      const modal = document.getElementById('modal-backdrop');
      if (modal && modal.classList.contains('open')) {
        this.trapFocus(modal, e);
        return;
      }

      // Tab trap for active drawer
      const drawer = document.getElementById('app-drawer');
      if (drawer && drawer.classList.contains('open')) {
        this.trapFocus(drawer, e);
        return;
      }

      const sidebar = document.getElementById('app-sidebar');
      if (sidebar && sidebar.classList.contains('open') && window.innerWidth <= 768) {
        this.trapFocus(sidebar, e);
      }
    });

    // Close command palette on backdrop click
    const cmdBackdrop = document.getElementById('command-palette-backdrop');
    if (cmdBackdrop) {
      cmdBackdrop.addEventListener('click', (e) => {
        if (e.target === cmdBackdrop) {
          this.closeCommandPalette();
        }
      });
    }

    // Close modal on backdrop click
    const modalBackdrop = document.getElementById('modal-backdrop');
    if (modalBackdrop) {
      modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) {
          this.closeModal();
        }
      });
    }

    // Close drawer on backdrop click
    const drawerBackdrop = document.getElementById('drawer-backdrop');
    if (drawerBackdrop) {
      drawerBackdrop.addEventListener('click', (e) => {
        if (e.target === drawerBackdrop) {
          this.closeDrawer();
          const sidebar = document.getElementById('app-sidebar');
          if (sidebar && sidebar.classList.contains('open')) {
            this.toggleSidebar();
          }
        }
      });
    }

    // Close mobile sidebar on nav-item click
    document.addEventListener('click', (e) => {
      const navItem = e.target.closest('.app-sidebar .nav-item');
      if (navItem && window.innerWidth <= 768) {
        const sidebar = document.getElementById('app-sidebar');
        if (sidebar && sidebar.classList.contains('open')) {
          this.toggleSidebar();
        }
      }
    });
  },

  // Toast Notification System & Persistent Operational Activity Logger
  showToast(message, type = 'info', duration = 3500, options = {}) {
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

      toast.innerHTML = `
        <span style="font-weight: 700; font-size: 16px;">${icon}</span>
        <div style="flex: 1; font-size: 13px; line-height: 1.5;">${message}</div>
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
        const routeLabel = this.getRouteLabel(hash);
        store.addActivity({
          type: options.activityType || 'system_notification',
          severity: (type === 'error' || type === 'danger') ? 'danger' : type,
          title: options.activityTitle || message,
          description: options.activityDesc || `اقدام از طریق بخش «${routeLabel}» با موفقیت مخابره شد.`,
          subsystem: options.subsystem || this.getSubsystemFromRoute(hash),
          route: hash,
          routeLabel: routeLabel,
          actor: options.actor || 'SuperAdmin (ناظر)',
          details: options.details || null
        });
        this.updateActivityBadge();
      }
    }
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
  },

  // Drawer Component (GODMODE.MD §20.2 & §20.5)
  openDrawer(title, contentHtml, options = {}) {
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

  closeDrawer() {
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
  },

  openShortcutsHelpModal() {
    const shortcuts = [
      {
        category: 'عمومی و ناوبری',
        items: [
          { keys: ['⌘K', 'یا', '/'], desc: 'جستجوی سراسری و پالت دستورات' },
          { keys: ['?'], desc: 'نمایش راهنمای کلیدهای میانبر' },
          { keys: ['Esc'], desc: 'بستن پنجره‌ها، دراورها و پالت باز' },
        ]
      },
      {
        category: 'پرش مستقیم به بخش‌ها (Alt + کلید)',
        items: [
          { keys: ['Alt', '+', 'H'], desc: 'پیشخوان کلان سیستم (Overview)' },
          { keys: ['Alt', '+', 'C'], desc: 'فهرست مشتریان و مجموعه‌ها (Tenants)' },
          { keys: ['Alt', '+', 'B'], desc: 'صورت‌حساب و امور مالی (Billing)' },
          { keys: ['Alt', '+', 'P'], desc: 'مدیریت پلن‌ها و تعرفه‌ها (Plans)' },
          { keys: ['Alt', '+', 'D'], desc: 'پایانه‌ها و دستگاه‌های POS (Devices)' },
          { keys: ['Alt', '+', 'O'], desc: 'پایش و سلامت عملیات (Operations)' },
          { keys: ['Alt', '+', 'A'], desc: 'لاگ وقایع و بازرسی امنیتی (Audit Log)' },
          { keys: ['Alt', '+', 'S'], desc: 'مرکز پشتیبانی و درخواست‌ها (Support)' },
          { keys: ['Alt', '+', 'W'], desc: 'نقشه فرایندهای استاندارد پلتفرم (Workflows)' },
        ]
      },
      {
        category: 'پیمایش متوالی (فشردن G و سپس کلید بعدی)',
        items: [
          { keys: ['g', 'h'], desc: 'انتقال به پیشخوان اصلی' },
          { keys: ['g', 'c'], desc: 'انتقال به مدیریت مشتریان' },
          { keys: ['g', 'b'], desc: 'انتقال به بخش مالی' },
          { keys: ['g', 'p'], desc: 'انتقال به بخش پلن‌ها' },
          { keys: ['g', 'd'], desc: 'انتقال به دستگاه‌ها' },
          { keys: ['g', 'o'], desc: 'انتقال به پایش عملیات' },
          { keys: ['g', 'a'], desc: 'انتقال به بازرسی امنیتی' },
          { keys: ['g', 's'], desc: 'انتقال به مرکز پشتیبانی' },
        ]
      }
    ];

    const contentHtml = `
      <div class="shortcuts-modal-container">
        <p style="font-size:0.85rem; color:var(--text-secondary,#64748b); margin-bottom:1rem;">
          جهت افزایش سرعت عمل اپراتورهای پلتفرم SALSA GODMODE، کلیدهای میانبر زیر در تمامی صفحات فعال هستند:
        </p>
        <div class="shortcuts-modal-grid">
          ${shortcuts.map((group) => `
            <div class="shortcuts-card">
              <h4 style="font-size:0.88rem; font-weight:700; color:var(--text-primary,#0f172a); margin:0 0 0.65rem 0; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:0.4rem;">
                ${group.category}
              </h4>
              <ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:0.45rem;">
                ${group.items.map((item) => `
                  <li style="display:flex; justify-content:space-between; align-items:center; font-size:0.8rem;">
                    <span style="color:var(--text-secondary,#64748b);">${item.desc}</span>
                    <span style="display:flex; gap:0.2rem; align-items:center;">
                      ${item.keys.map((k) => `<kbd class="gm-kbd-badge">${k}</kbd>`).join('')}
                    </span>
                  </li>
                `).join('')}
              </ul>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    this.openModal('راهنمای کلیدهای میانبر پلتفرم SALSA GODMODE', contentHtml, null, { cancelText: 'بستن راهنما' });
  },

  // Modal Component
  openModal(title, contentHtml, onConfirm = null, options = {}) {
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

  closeModal() {
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
  },

  // Global Command & Quick Switcher Palette
  openCommandPalette() {
    if (window.GMCommandPalette && typeof window.GMCommandPalette.open === 'function') {
      window.GMCommandPalette.open();
    }
  },

  closeCommandPalette() {
    if (window.GMCommandPalette && typeof window.GMCommandPalette.close === 'function') {
      window.GMCommandPalette.close();
    }
  },

  toggleCommandPalette() {
    if (window.GMCommandPalette && typeof window.GMCommandPalette.toggle === 'function') {
      window.GMCommandPalette.toggle();
    }
  },

  // Theme & Appearance Management (Pass: Dark/Light Mode Header Modal)
  initTheme() {
    let pref = 'light';
    try {
      pref = localStorage.getItem('salsa_theme') || 'light';
    } catch (_) {}
    this.applyTheme(pref, false);

    // Watch OS appearance changes when preference is set to "system"
    if (typeof window.matchMedia === 'function') {
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
  },

  applyTheme(pref, notify = false) {
    const validModes = ['light', 'dark', 'system'];
    const mode = validModes.includes(pref) ? pref : 'light';
    try {
      localStorage.setItem('salsa_theme', mode);
    } catch (_) {}

    let resolved = mode;
    if (mode === 'system') {
      const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
      resolved = mq && mq.matches ? 'dark' : 'light';
    }

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

    // Update Header Button Icon and Title
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

    if (notify && typeof this.showToast === 'function') {
      const modeNames = { light: 'روشن', dark: 'تیره', system: 'هماهنگ با سیستم' };
      this.showToast(`پوسته سامانه با موفقیت به «${modeNames[mode]}» تغییر یافت.`, 'info');
    }
  },

  selectThemeInModal(mode) {
    this.applyTheme(mode, false);
    const bodyEl = document.getElementById('modal-body');
    if (bodyEl && document.getElementById('theme-selection-container')) {
      bodyEl.innerHTML = this.renderThemeModalBody(mode);
    }
  },

  openThemeModal() {
    let currentPref = 'light';
    try {
      currentPref = localStorage.getItem('salsa_theme') || 'light';
    } catch (_) {}

    const contentHtml = this.renderThemeModalBody(currentPref);

    this.openModal(
      'تنظیم پوسته و ظاهر سامانه (تم)',
      contentHtml,
      () => {
        let savedPref = 'light';
        try {
          savedPref = localStorage.getItem('salsa_theme') || 'light';
        } catch (_) {}
        const modeNames = { light: 'روشن', dark: 'تیره', system: 'هماهنگ با سیستم' };
        if (typeof this.showToast === 'function') {
          this.showToast(`پوستهٔ «${modeNames[savedPref]}» با موفقیت ذخیره شد.`, 'success');
        }
        return true;
      },
      {
        confirmText: 'تأیید و ذخیره',
        cancelText: 'بستن',
        severity: null
      }
    );
  },

  renderThemeModalBody(currentPref) {
    return `
      <div id="theme-selection-container" style="padding: 0.25rem 0;">
        <p style="font-size: 0.82rem; color: var(--gm-muted); margin: 0 0 1.25rem 0; line-height: 1.5;">
          پوسته مورد نظر خود را برای محیط کاربری کنسول مدیریت ناوگان SALSA انتخاب فرمایید:
        </p>
        
        <div class="theme-cards-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.85rem; margin-bottom: 1.25rem;">
          
          <!-- Light Theme Card -->
          <div class="theme-card-option ${currentPref === 'light' ? 'is-selected' : ''}" onclick="window.GMApp.selectThemeInModal('light')" role="button" tabindex="0" aria-label="تم روشن" style="border: 2px solid ${currentPref === 'light' ? 'var(--gm-accent)' : 'var(--gm-border)'}; border-radius: 12px; padding: 0.85rem 0.65rem; cursor: pointer; text-align: center; transition: all 0.2s ease; background: ${currentPref === 'light' ? 'var(--gm-accent-soft)' : 'var(--gm-surface)'}; box-shadow: ${currentPref === 'light' ? '0 0 0 3px rgba(49, 87, 213, 0.18)' : 'none'};">
            <div style="width: 100%; height: 50px; border-radius: 6px; background: #ffffff; border: 1px solid #e2e8f0; display: flex; flex-direction: column; padding: 6px; gap: 4px; margin-bottom: 0.65rem; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
              <div style="height: 8px; width: 45%; background: #0284c7; border-radius: 3px;"></div>
              <div style="height: 6px; width: 85%; background: #f1f5f9; border-radius: 2px;"></div>
              <div style="height: 6px; width: 65%; background: #f1f5f9; border-radius: 2px;"></div>
            </div>
            <div style="display: flex; align-items: center; justify-content: center; gap: 0.3rem; margin-bottom: 0.2rem;">
              <span style="font-size: 1.1rem;">☀️</span>
              <span style="font-weight: 700; font-size: 0.84rem; color: var(--gm-ink);">تم روشن</span>
            </div>
            <div style="font-size: 0.72rem; color: var(--gm-muted); line-height: 1.35; min-height: 2.2rem;">کنتراست استاندارد و پس‌زمینه روشن</div>
            <div style="margin-top: 0.5rem;">
              <span class="badge ${currentPref === 'light' ? 'badge-primary' : 'badge-neutral'}" style="font-size: 0.68rem; padding: 0.2rem 0.5rem;">${currentPref === 'light' ? '✓ فعال' : 'انتخاب'}</span>
            </div>
          </div>

          <!-- Dark Theme Card -->
          <div class="theme-card-option ${currentPref === 'dark' ? 'is-selected' : ''}" onclick="window.GMApp.selectThemeInModal('dark')" role="button" tabindex="0" aria-label="تم تیره" style="border: 2px solid ${currentPref === 'dark' ? 'var(--gm-accent)' : 'var(--gm-border)'}; border-radius: 12px; padding: 0.85rem 0.65rem; cursor: pointer; text-align: center; transition: all 0.2s ease; background: ${currentPref === 'dark' ? 'var(--gm-accent-soft)' : 'var(--gm-surface)'}; box-shadow: ${currentPref === 'dark' ? '0 0 0 3px rgba(49, 87, 213, 0.18)' : 'none'};">
            <div style="width: 100%; height: 50px; border-radius: 6px; background: #090d16; border: 1px solid #1e293b; display: flex; flex-direction: column; padding: 6px; gap: 4px; margin-bottom: 0.65rem; box-shadow: 0 1px 3px rgba(0,0,0,0.3);">
              <div style="height: 8px; width: 45%; background: #38bdf8; border-radius: 3px;"></div>
              <div style="height: 6px; width: 85%; background: #1e293b; border-radius: 2px;"></div>
              <div style="height: 6px; width: 65%; background: #1e293b; border-radius: 2px;"></div>
            </div>
            <div style="display: flex; align-items: center; justify-content: center; gap: 0.3rem; margin-bottom: 0.2rem;">
              <span style="font-size: 1.1rem;">🌙</span>
              <span style="font-weight: 700; font-size: 0.84rem; color: var(--gm-ink);">تم تیره</span>
            </div>
            <div style="font-size: 0.72rem; color: var(--gm-muted); line-height: 1.35; min-height: 2.2rem;">کاهش خستگی چشم و پالت دارک</div>
            <div style="margin-top: 0.5rem;">
              <span class="badge ${currentPref === 'dark' ? 'badge-primary' : 'badge-neutral'}" style="font-size: 0.68rem; padding: 0.2rem 0.5rem;">${currentPref === 'dark' ? '✓ فعال' : 'انتخاب'}</span>
            </div>
          </div>

          <!-- System Match Card -->
          <div class="theme-card-option ${currentPref === 'system' ? 'is-selected' : ''}" onclick="window.GMApp.selectThemeInModal('system')" role="button" tabindex="0" aria-label="هماهنگ با سیستم" style="border: 2px solid ${currentPref === 'system' ? 'var(--gm-accent)' : 'var(--gm-border)'}; border-radius: 12px; padding: 0.85rem 0.65rem; cursor: pointer; text-align: center; transition: all 0.2s ease; background: ${currentPref === 'system' ? 'var(--gm-accent-soft)' : 'var(--gm-surface)'}; box-shadow: ${currentPref === 'system' ? '0 0 0 3px rgba(49, 87, 213, 0.18)' : 'none'};">
            <div style="width: 100%; height: 50px; border-radius: 6px; background: linear-gradient(90deg, #ffffff 50%, #090d16 50%); border: 1px solid #64748b; display: flex; flex-direction: column; padding: 6px; gap: 4px; margin-bottom: 0.65rem;">
              <div style="height: 8px; width: 45%; background: #2563eb; border-radius: 3px;"></div>
              <div style="height: 6px; width: 85%; background: rgba(148,163,184,0.3); border-radius: 2px;"></div>
              <div style="height: 6px; width: 65%; background: rgba(148,163,184,0.3); border-radius: 2px;"></div>
            </div>
            <div style="display: flex; align-items: center; justify-content: center; gap: 0.3rem; margin-bottom: 0.2rem;">
              <span style="font-size: 1.1rem;">💻</span>
              <span style="font-weight: 700; font-size: 0.84rem; color: var(--gm-ink);">هماهنگ با سیستم</span>
            </div>
            <div style="font-size: 0.72rem; color: var(--gm-muted); line-height: 1.35; min-height: 2.2rem;">پیروی خودکار از تم سیستم‌عامل</div>
            <div style="margin-top: 0.5rem;">
              <span class="badge ${currentPref === 'system' ? 'badge-primary' : 'badge-neutral'}" style="font-size: 0.68rem; padding: 0.2rem 0.5rem;">${currentPref === 'system' ? '✓ فعال' : 'انتخاب'}</span>
            </div>
          </div>

        </div>

        <div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 0.75rem; background: var(--gm-canvas); border: 1px solid var(--gm-border); border-radius: 8px; font-size: 0.74rem; color: var(--gm-muted);">
          <span style="font-size: 0.9rem;">💡</span>
          <span>با کلیک روی هر پوسته، تغییرات به‌صورت بلادرنگ در محیط اعمال شده و با دکمه «تأیید و ذخیره» نهایی می‌گردد.</span>
        </div>
      </div>
    `;
  },

  // Responsive Sidebar Toggle
  syncMobileSidebarAccessibility() {
    const sidebar = document.getElementById('app-sidebar');
    const btn = document.getElementById('mobile-menu-btn');
    const backdrop = document.getElementById('drawer-backdrop');
    if (!sidebar) return;

    const isMobile = window.innerWidth <= 768;
    const isOpen = sidebar.classList.contains('open');
    if (!isMobile) {
      sidebar.inert = false;
      sidebar.removeAttribute('aria-hidden');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      return;
    }

    sidebar.inert = !isOpen;
    sidebar.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    if (btn) btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (backdrop) {
      backdrop.classList.toggle('open', isOpen);
      backdrop.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    }
  },

  toggleSidebar(forceOpen) {
    const sidebar = document.getElementById('app-sidebar');
    const btn = document.getElementById('mobile-menu-btn');
    if (!sidebar || window.innerWidth > 768) return false;

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
  },

  // Route & Subsystem Resolvers
  getRouteLabel(hash) {
    const clean = (hash || '').replace(/^#\/?/, '').split('?')[0];
    const canonical = window.GMCommandPalette?.routes?.find((route) => route.hash.replace(/^#\/?/, '') === clean);
    if (canonical) return `${canonical.code} ${canonical.title}`;
    const map = {
      'gm-01-login': 'GM-01 ورود و امنیت',
      'gm-02-overview': 'GM-02 پیشخوان کلان',
      'gm-03-tenants': 'GM-03 فهرست مشتریان',
      'gm-04-tenant-detail': 'GM-04 پرونده ۳۶۰ مشتری',
      'gm-05-tenant-new': 'GM-05 آنبوردینگ مشتری',
      'gm-06-provisioning': 'GM-06 تحویل محیط',
      'gm-08-features': 'GM-08 کاتالوگ امکانات',
      'gm-09-tenant-features': 'GM-09 افزونه‌های مشتری',
      'gm-10-plans': 'GM-10 پلن‌های تجاری',
      'gm-11-billing': 'GM-11 اشتراک و مالی',
      'gm-12-usage': 'GM-12 مصرف منابع و سهمیه',
      'gm-13-identities': 'GM-13 شناسه‌ها و سشن‌ها',
      'gm-14-access-roles': 'GM-14 ماتریس نقش‌ها',
      'gm-15-simulator': 'GM-15 شبیه‌ساز دسترسی',
      'gm-16-automations': 'GM-16 خودکارسازی',
      'gm-17-customers': 'GM-17 حفاظت داده PII',
      'gm-18-domains': 'GM-18 دامنه‌ها و DNS',
      'gm-19-devices': 'GM-19 ناوگان دستگاه‌ها',
      'gm-20-backups': 'GM-20 پشتیبان و بازیابی',
      'gm-21-support': 'GM-21 پشتیبانی فنی',
      'gm-22-operations': 'GM-22 سلامت و رخدادها',
      'gm-23-releases': 'GM-23 ریلیز و قناری',
      'gm-24-infrastructure': 'GM-24 سرور و زیرساخت VPS',
      'gm-25-jobs': 'GM-25 صف پردازش‌ها',
      'gm-26-audit': 'GM-26 لاگ ممیزی',
      'gm-27-team': 'GM-27 تنظیمات پلتفرم',
      'gm-28-portal': 'GM-28 پورتال مشتری'
    };
    return map[clean] || (clean ? `#${clean}` : 'پیشخوان SALSA');
  },

  getSubsystemFromRoute(hash) {
    const clean = (hash || '').replace(/^#\/?/, '').split('?')[0];
    if (['gm-02-overview', 'gm-22-operations', 'gm-25-jobs'].includes(clean)) return 'مرکز فرماندهی';
    if (['gm-03-tenants', 'gm-04-tenant-detail', 'gm-05-tenant-new', 'gm-06-provisioning', 'gm-09-tenant-features', 'gm-17-customers', 'gm-18-domains', 'gm-19-devices', 'gm-21-support', 'gm-28-portal'].includes(clean)) return 'مشتریان';
    if (['gm-08-features', 'gm-10-plans', 'gm-11-billing', 'gm-12-usage'].includes(clean)) return 'محصول و درآمد';
    if (['gm-01-login', 'gm-13-identities', 'gm-14-access-roles', 'gm-15-simulator'].includes(clean)) return 'هویت و دسترسی';
    if (['gm-16-automations', 'gm-20-backups', 'gm-23-releases', 'gm-24-infrastructure'].includes(clean)) return 'زیرساخت و تداوم';
    if (['gm-26-audit', 'gm-27-team'].includes(clean)) return 'حاکمیت پلتفرم';
    return 'پلتفرم';
  },

  // Operational Activity Ledger & History
  updateActivityBadge() {
    const store = window.prototypeStore || window.GMStore;
    if (!store || typeof store.getUnreadActivitiesCount !== 'function') return;
    const count = store.getUnreadActivitiesCount();
    const badge = document.getElementById('activity-badge-count');
    const bellBtn = document.getElementById('btn-activity-ledger');
    
    if (badge) {
      if (count > 0) {
        badge.style.display = 'inline-flex';
        badge.innerText = count > 99 ? '۹۹+' : count.toLocaleString('fa-IR');
      } else {
        badge.style.display = 'none';
        badge.innerText = '۰';
      }
    }
    if (bellBtn) {
      bellBtn.classList.toggle('has-unread', count > 0);
      bellBtn.dataset.unreadCount = String(count);
      const label = count > 0 
        ? `مرکز تاریخچه و رویدادهای عملیاتی (${count.toLocaleString('fa-IR')} رویداد خوانده‌نشده)`
        : 'مرکز تاریخچه و رویدادهای عملیاتی (تمام رویدادها خوانده شده)';
      bellBtn.setAttribute('aria-label', label);
      bellBtn.title = label;
    }
  },

  openActivityDrawer(filter = 'all') {
    this.activeActivityFilter = filter;
    const store = window.prototypeStore || window.GMStore;
    if (!store || typeof store.getActivities !== 'function') return;

    const activities = store.getActivities(filter);
    const tenants = typeof store.getTenants === 'function' ? store.getTenants() : [];
    const redactTenantText = (value) => {
      let text = String(value == null ? '' : value);
      const identities = tenants.flatMap((tenant) => [tenant?.name, tenant?.organization, tenant?.slug]
        .filter(Boolean)
        .flatMap((identity) => {
          const full = String(identity);
          const withoutParenthetical = full.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
          return [full, withoutParenthetical];
        }))
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);
      identities.forEach((identity) => {
        text = text.split(identity).join('مشتری');
      });
      return text;
    };
    const unreadCount = store.getUnreadActivitiesCount();
    const allActivities = store.getActivities('all');
    const dangerCount = allActivities.filter(a => a.severity === 'danger' || a.severity === 'error' || a.severity === 'critical').length;
    const warningCount = allActivities.filter(a => a.severity === 'warning').length;
    const successCount = allActivities.filter(a => a.severity === 'success').length;

    const contentHtml = `
      <div class="activity-ledger-container" role="region" aria-label="دفتر کل رویدادها و تاریخچه عملیاتی">
        <!-- Subtitle & Quick Stats -->
        <div style="margin-bottom: 1rem; font-size: 0.75rem; color: var(--text-secondary); line-height: 1.5;">
          ثبت رخدادها، هشدارها و تغییرات بخش‌های پلتفرم با امکان بازخوانی و پیگیری مسیر.
        </div>

        <!-- Toolbar & Filter Chips -->
        <div class="activity-toolbar" role="toolbar" aria-label="فیلترهای تاریخچه عملیات">
          <div class="activity-chips-group" role="group" aria-label="فیلتر شدت رویدادها">
            <button class="filter-chip ${filter === 'all' ? 'active' : ''}" onclick="window.GMApp.openActivityDrawer('all')" aria-pressed="${filter === 'all'}">
              همه (${allActivities.length})
            </button>
            <button class="filter-chip ${filter === 'unread' ? 'active' : ''}" onclick="window.GMApp.openActivityDrawer('unread')" aria-pressed="${filter === 'unread'}">
              خوانده‌نشده (${unreadCount})
            </button>
            <button class="filter-chip ${filter === 'danger' ? 'active' : ''}" onclick="window.GMApp.openActivityDrawer('danger')" aria-pressed="${filter === 'danger'}">
              خطا (${dangerCount})
            </button>
            <button class="filter-chip ${filter === 'warning' ? 'active' : ''}" onclick="window.GMApp.openActivityDrawer('warning')" aria-pressed="${filter === 'warning'}">
              هشدار (${warningCount})
            </button>
            <button class="filter-chip ${filter === 'success' ? 'active' : ''}" onclick="window.GMApp.openActivityDrawer('success')" aria-pressed="${filter === 'success'}">
              موفقیت (${successCount})
            </button>
          </div>

          <div class="activity-actions-row" style="display: flex; gap: 0.5rem; justify-content: space-between; align-items: center; margin-top: 0.75rem; padding-bottom: 0.75rem; border-bottom: 1px solid var(--border-subtle);">
            <button class="btn btn-ghost btn-xs text-secondary" onclick="window.GMApp.markAllActivitiesRead()" aria-label="علامت‌گذاری تمام رویدادها به‌عنوان خوانده‌شده" ${unreadCount === 0 ? 'disabled' : ''}>
              ✓ خوانده‌شدن همه
            </button>
            <button class="btn btn-ghost btn-xs text-muted" onclick="window.GMApp.archiveReadActivities()" aria-label="بایگانی رویدادهای خوانده‌شده" ${allActivities.length - unreadCount === 0 ? 'disabled' : ''}>
              بایگانی خوانده‌شده‌ها
            </button>
          </div>
        </div>

        <!-- Activity Feed List -->
        <div class="activity-feed-list" style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 1rem;">
          ${activities.length === 0 ? `
            <div class="activity-empty surface-subtle" style="text-align: center; padding: 2.5rem 1rem;">
              <div style="font-size: 1.75rem; margin-bottom: 0.5rem; opacity: 0.6;">📋</div>
              <div class="text-strong text-primary text-sm">هیچ رویدادی در این نما وجود ندارد</div>
              <div class="text-xs text-secondary" style="margin-top: 0.35rem; margin-bottom: 1rem;">
                ${filter === 'unread' ? 'تمام رویدادهای عملیاتی پیشین بررسی و خوانده شده‌اند.' : 'هیچ رکوردی منطبق با فیلتر انتخابی ثبت نشده است.'}
              </div>
              ${filter !== 'all' ? `
                <button class="btn btn-secondary btn-xs" onclick="window.GMApp.openActivityDrawer('all')">
                  مشاهده همه رویدادها
                </button>
              ` : ''}
            </div>
          ` : activities.map(a => `
            <div class="activity-card surface-subtle ${!a.read ? 'activity-unread' : ''} activity-${a.severity}" id="act-item-${a.id}">
              <div class="activity-card-header">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <span class="activity-severity-badge badge badge-${a.severity === 'danger' || a.severity === 'error' ? 'danger' : a.severity === 'warning' ? 'warning' : a.severity === 'success' ? 'success' : 'neutral'}">
                    ${a.severity === 'danger' || a.severity === 'error' ? 'خطا' : a.severity === 'warning' ? 'هشدار' : a.severity === 'success' ? 'موفق' : 'اطلاع'}
                  </span>
                  <a href="${a.route}" class="activity-route-badge badge badge-neutral" onclick="window.GMApp.closeDrawer();" title="پرش به صفحه ${a.routeLabel}">
                    ${a.routeLabel}
                  </a>
                  ${!a.read ? `<span class="activity-unread-dot" title="خوانده‌نشده"></span>` : ''}
                </div>
                <div class="activity-timestamp text-xs text-muted" title="${a.timestampIso || a.timestamp}">
                  ${a.timestamp}
                </div>
              </div>

              <div class="activity-card-body">
                <div class="activity-title text-sm text-strong text-primary" style="margin-top: 0.4rem;">
                  ${redactTenantText(a.title)}
                </div>
                ${a.description ? `
                  <div class="activity-desc text-xs text-secondary" style="margin-top: 0.25rem; line-height: 1.5;">
                    ${redactTenantText(a.description)}
                  </div>
                ` : ''}
                
                ${a.details ? `
                  <div class="activity-trace-toggle-wrapper" style="margin-top: 0.5rem;">
                    <details class="activity-trace-details">
                      <summary class="text-xs text-cyan" style="cursor: pointer; user-select: none;">جزئیات تشخیصی و پارامترها</summary>
                      <pre class="surface-subtle cell-mono text-xs text-ltr" style="margin-top: 0.35rem; padding: 0.5rem 0.65rem; font-size: 0.688rem; overflow-x: auto; background: rgba(0, 0, 0, 0.3); border-radius: var(--radius-xs);">${redactTenantText(JSON.stringify(a.details, null, 2))}</pre>
                    </details>
                  </div>
                ` : ''}
              </div>

              <div class="activity-card-footer" style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.65rem; padding-top: 0.5rem; border-top: 1px solid var(--border-subtle); font-size: 0.725rem;">
                <div class="text-xs text-muted">
                  عامل: <span class="text-secondary">${a.actor}</span>
                </div>
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                  ${!a.read ? `
                    <button class="btn btn-ghost btn-xs text-cyan" onclick="window.GMApp.markActivityRead('${a.id}')" aria-label="علامت‌گذاری رویداد به‌عنوان خوانده‌شده">
                      علامت خوانده شد
                    </button>
                  ` : ''}
                  <a href="${a.route}" class="btn btn-outline-cyan btn-xs" onclick="window.GMApp.closeDrawer();" aria-label="مشاهده در ${a.routeLabel}">
                    مشاهده بخش ←
                  </a>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    this.openDrawer('مرکز رویدادها و تاریخچه عملیات (Activity Ledger)', contentHtml);
  },

  toggleActivityDrawer() {
    const drawer = document.getElementById('app-drawer');
    const title = document.getElementById('drawer-title');
    if (drawer && drawer.classList.contains('open') && title && title.innerText.includes('Activity Ledger')) {
      this.closeDrawer();
    } else {
      this.openActivityDrawer('all');
    }
  },

  markActivityRead(id) {
    const store = window.prototypeStore || window.GMStore;
    if (store && typeof store.markActivityAsRead === 'function') {
      store.markActivityAsRead(id);
      this.updateActivityBadge();
      this.openActivityDrawer(this.activeActivityFilter || 'all');
    }
  },

  markAllActivitiesRead() {
    const store = window.prototypeStore || window.GMStore;
    if (store && typeof store.markAllActivitiesAsRead === 'function') {
      store.markAllActivitiesAsRead();
      this.updateActivityBadge();
      this.openActivityDrawer(this.activeActivityFilter || 'all');
      this.showToast('تمام رویدادهای عملیاتی با موفقیت به‌عنوان خوانده‌شده علامت‌گذاری شدند.', 'success', 2500, { silentActivity: true });
    }
  },

  archiveReadActivities() {
    const store = window.prototypeStore || window.GMStore;
    if (store && typeof store.archiveReadActivities === 'function') {
      const removed = store.archiveReadActivities();
      this.updateActivityBadge();
      this.openActivityDrawer(this.activeActivityFilter || 'all');
      this.showToast(`${removed.toLocaleString('fa-IR')} رویداد خوانده‌شده بایگانی و پاکسازی شد.`, 'info', 2500, { silentActivity: true });
    }
  },

  // Provenance Banner: this static application is always an isolated preview.
  updateProvenanceBanner() {
    const banner = document.getElementById('prototype-banner') || document.querySelector('.prototype-banner');
    if (!banner) return;
    banner.style.removeProperty('background');
    banner.style.removeProperty('border-bottom');
    banner.innerHTML = `
      <div class="prototype-banner-copy">
        <span class="prototype-banner-dot" aria-hidden="true" style="background: var(--color-warning, #f59e0b);"></span>
        <span class="badge badge-provenance-local"><span class="status-dot dot-amber"></span> پیش‌نمایش ایزوله · غیرعملیاتی</span>
        <strong>مرکز مدیریت SALSA GODMODE</strong>
        <span class="prototype-banner-detail">این نسخه از داده‌های ساختگی استفاده می‌کند و به API یا پایگاه‌دادهٔ عملیاتی متصل نیست.</span>
      </div>
      <div class="prototype-banner-actions">
        <a href="#gm-24-infrastructure" class="btn btn-secondary btn-xs" aria-label="مشاهده وضعیت زیرساخت">
          مشاهده زیرساخت
        </a>
      </div>
    `;
  },

  async checkLiveBridge() {
    this.showToast('اتصال عملیاتی در این پیش‌نمایش برقرار نیست؛ داده‌ها ساختگی و ایزوله‌اند.', 'warning', 5000);
    window.location.hash = '#gm-24-infrastructure';
  },

  // Reset Mock Data
  confirmResetMockData() {
    this.openModal(
      'تأیید بازنشانی پیش‌نمایش محلی',
      `
        <p>آیا می‌خواهید وضعیت محلی مرورگر پاک شود و داده‌های ساختگی پیش‌نمایش دوباره بارگذاری شوند؟</p>
        <div class="alert alert-info" style="margin-top: 12px;">
          <strong>اطلاعیه:</strong> این کار دادهٔ عملیاتی ایجاد یا بازیابی نمی‌کند؛ فقط fixtureهای ساختگی محلی را برمی‌گرداند.
        </div>
      `,
      () => {
        const store = window.prototypeStore || window.GMStore;
        if (store && typeof store.clearAllDemoData === 'function') {
          store.clearAllDemoData();
        } else if (store && typeof store.resetAll === 'function') {
          store.resetAll();
        } else if (store && typeof store.resetStore === 'function') {
          store.resetStore();
        }
        this.updateActivityBadge();
        this.showToast('کش مرورگر با موفقیت پاکسازی شد.', 'success', 3500, {
          activityTitle: 'بازنشانی پیش‌نمایش محلی',
          activityDesc: 'داده‌های ساختگی ایزوله دوباره بارگذاری شدند؛ هیچ دادهٔ عملیاتی تغییر نکرد.',
          subsystem: 'Platform Admin',
          severity: 'info'
        });
        window.GMRouter.refresh();
      }
    );
  }
};

// Table Collection & Bulk Selection Controller
window.GMTableSelect = {
  instances: new Map(),
  activeInstance: null,

  initTable(tableSelector, options = {}) {
    const table = typeof tableSelector === 'string' ? document.querySelector(tableSelector) : tableSelector;
    if (!table) return null;

    const selectAllSelector = options.selectAllSelector || (options.selectAllId ? (options.selectAllId.startsWith('#') ? options.selectAllId : '#' + options.selectAllId) : null);
    const selectAllEl = selectAllSelector ? document.querySelector(selectAllSelector) : table.querySelector('thead input[type="checkbox"]');

    const rowSelector = options.rowCheckboxSelector || (options.rowCheckboxClass ? (options.rowCheckboxClass.startsWith('.') ? options.rowCheckboxClass : '.' + options.rowCheckboxClass) : 'tbody tr input[type="checkbox"]');

    const rawBulkId = options.bulkBarId ? options.bulkBarId.replace(/^#/, '') : null;
    const bulkBar = options.bulkBar || (rawBulkId ? (typeof document !== 'undefined' && document.getElementById ? (document.getElementById(rawBulkId) || (document.querySelector && document.querySelector('#' + rawBulkId))) : null) : null);

    const rawCountId = options.countBadgeId ? options.countBadgeId.replace(/^#/, '') : null;
    const countBadge = options.countBadge ||
      (rawCountId ? (typeof document !== 'undefined' && document.getElementById ? (document.getElementById(rawCountId) || (document.querySelector && document.querySelector('#' + rawCountId))) : null) : null) ||
      (options.selectedCountClass ? (bulkBar && bulkBar.querySelector ? bulkBar.querySelector(options.selectedCountClass) : (typeof document !== 'undefined' && document.querySelector ? document.querySelector(options.selectedCountClass) : null)) : null) ||
      (bulkBar && bulkBar.querySelector ? (bulkBar.querySelector('.bulk-counter-badge') || bulkBar.querySelector('.bulk-selected-count')) : null);

    const instance = {
      table,
      selectAllEl,
      rowSelector,
      bulkBar,
      countBadge,
      options,

      getSelectedIds() {
        const checkedBoxes = Array.from(table.querySelectorAll(rowSelector + ':checked'));
        return checkedBoxes.map(cb => {
          const row = cb.closest('tr');
          return cb.getAttribute('data-id') || (row ? row.getAttribute('data-id') : null) || cb.value;
        }).filter(Boolean);
      },

      getSelectedRows() {
        return Array.from(table.querySelectorAll(rowSelector + ':checked')).map(cb => cb.closest('tr')).filter(Boolean);
      },

      getSelectedItems() {
        const checkedBoxes = Array.from(table.querySelectorAll(rowSelector + ':checked'));
        return checkedBoxes.map(cb => {
          const row = cb.closest('tr');
          return {
            id: cb.getAttribute('data-id') || (row ? row.getAttribute('data-id') : null) || cb.value,
            status: cb.getAttribute('data-status') || (row ? row.getAttribute('data-status') : null),
            checkbox: cb,
            row: row
          };
        });
      },

      clear() {
        const checkboxes = table.querySelectorAll(rowSelector);
        checkboxes.forEach(cb => {
          cb.checked = false;
          const tr = cb.closest('tr');
          if (tr) tr.classList.remove('selected-row');
        });
        if (selectAllEl) {
          selectAllEl.checked = false;
          selectAllEl.indeterminate = false;
        }
        if (bulkBar) {
          bulkBar.classList.remove('is-visible');
          if (bulkBar.classList && typeof bulkBar.classList.contains === 'function' && bulkBar.classList.contains('bulk-actions-docked')) {
            bulkBar.style.display = 'none';
          }
          const actionBtns = bulkBar.querySelectorAll('button:not(.bulk-clear-btn), .btn:not(.bulk-clear-btn)');
          actionBtns.forEach(btn => {
            btn.disabled = true;
            btn.setAttribute('disabled', 'true');
          });
        }
        if (window.GMTableSelect.activeInstance === this) {
          window.GMTableSelect.activeInstance = null;
        }
        if (typeof options.onSelectionChange === 'function') {
          options.onSelectionChange([], [], []);
        }
      },

      clearSelection() {
        return this.clear();
      },

      sync() {
        const rows = Array.from(table.querySelectorAll('tbody tr')).filter(r => !r.id || !r.id.includes('empty'));
        let visibleCount = 0;
        let visibleSelectedCount = 0;
        let totalSelectedCount = 0;

        rows.forEach(r => {
          const cb = r.querySelector(rowSelector);
          if (!cb) return;
          const isVisible = r.style.display !== 'none';
          if (isVisible) visibleCount++;

          if (cb.checked) {
            totalSelectedCount++;
            r.classList.add('selected-row');
            if (isVisible) visibleSelectedCount++;
          } else {
            r.classList.remove('selected-row');
          }
        });

        if (selectAllEl) {
          if (visibleCount === 0 || visibleSelectedCount === 0) {
            selectAllEl.checked = false;
            selectAllEl.indeterminate = false;
          } else if (visibleSelectedCount === visibleCount) {
            selectAllEl.checked = true;
            selectAllEl.indeterminate = false;
          } else {
            selectAllEl.checked = false;
            selectAllEl.indeterminate = true;
          }
        }

        if (bulkBar) {
          const actionBtns = bulkBar.querySelectorAll('button:not(.bulk-clear-btn), .btn:not(.bulk-clear-btn)');
          actionBtns.forEach(btn => {
            if (totalSelectedCount > 0) {
              btn.disabled = false;
              btn.removeAttribute('disabled');
            } else {
              btn.disabled = true;
              btn.setAttribute('disabled', 'true');
            }
          });

          if (totalSelectedCount > 0) {
            bulkBar.classList.add('is-visible');
            if (bulkBar.style && bulkBar.style.display === 'none') {
              bulkBar.style.display = '';
            }
            window.GMTableSelect.activeInstance = instance;
          } else {
            bulkBar.classList.remove('is-visible');
            if (bulkBar.classList && typeof bulkBar.classList.contains === 'function' && bulkBar.classList.contains('bulk-actions-docked')) {
              bulkBar.style.display = 'none';
            }
            if (window.GMTableSelect.activeInstance === instance) {
              window.GMTableSelect.activeInstance = null;
            }
          }
        }

        if (countBadge) {
          countBadge.textContent = `${totalSelectedCount.toLocaleString('fa-IR')} مورد انتخاب‌شده`;
        }

        if (typeof options.onSelectionChange === 'function') {
          const selectedIds = this.getSelectedIds();
          const selectedRows = this.getSelectedRows();
          options.onSelectionChange(selectedIds, selectedRows, this.getSelectedItems());
        }
      }
    };

    // Attach master selectAll listener
    if (selectAllEl) {
      selectAllEl.onchange = (e) => {
        const shouldCheck = e.target.checked;
        const rows = Array.from(table.querySelectorAll('tbody tr')).filter(r => !r.id || !r.id.includes('empty'));
        rows.forEach(r => {
          if (r.style.display !== 'none') {
            const cb = r.querySelector(rowSelector);
            if (cb) {
              cb.checked = shouldCheck;
              if (shouldCheck) r.classList.add('selected-row');
              else r.classList.remove('selected-row');
            }
          }
        });
        instance.sync();
      };
    }

    // Attach row change listener
    table.addEventListener('change', (e) => {
      if (e.target.matches(rowSelector)) {
        const tr = e.target.closest('tr');
        if (tr) {
          if (e.target.checked) tr.classList.add('selected-row');
          else tr.classList.remove('selected-row');
        }
        instance.sync();
      }
    });

    // Clear buttons inside bulkBar
    if (bulkBar) {
      const clearBtn = bulkBar.querySelector('.bulk-clear-btn');
      if (clearBtn) {
        clearBtn.onclick = () => instance.clear();
      }
      // Initialize action buttons as disabled
      const actionBtns = bulkBar.querySelectorAll('button:not(.bulk-clear-btn), .btn:not(.bulk-clear-btn)');
      actionBtns.forEach(btn => {
        btn.disabled = true;
        btn.setAttribute('disabled', 'true');
      });
    }

    this.instances.set(table, instance);
    return instance;
  },

  clearActive() {
    if (this.activeInstance) {
      this.activeInstance.clear();
      this.activeInstance = null;
      return true;
    }
    return false;
  }
};

// ==========================================================================
// Global Findability, Command Palette & Fast Orientation Controller
// ==========================================================================
window.GMCommandPalette = {
  isOpen: false,
  activeIndex: 0,
  lastFocusedElement: null,
  filteredItems: [],

  // Canonical task order shared with the sidebar information architecture.
  // Search results follow work domains and workflows instead of legacy GM numbers.
  navigationOrder: [
    'GM02', 'GM22', 'GM25',
    'GM03',
    'GM08', 'GM10',
    'GM01',
    'GM24', 'GM23', 'GM16',
    'GM26', 'GM27'
  ],

  routes: [
    { id: 'GM01', hash: '#gm-01-login', code: 'GM-01', title: 'ورود و امنیت حساب', category: 'هویت و دسترسی', icon: '⌾', keywords: ['login', 'auth', 'ورود', 'احراز', 'هویت', 'نشست', 'امنیت', 'پسورد', 'رمز', 'mfa', 'تایید دو مرحله‌ای'] },
    { id: 'GM02', hash: '#gm-02-overview', code: 'GM-02', title: 'وضعیت و آمادگی پلتفرم', category: 'مرکز فرماندهی', icon: '◫', keywords: ['overview', 'dashboard', 'پیشخوان', 'داشبورد', 'متریک', 'سلامت', 'رویدادها', 'خلاصه', 'وضعیت'] },
    { id: 'GM03', hash: '#gm-03-tenants', code: 'GM-03', title: 'فهرست مجموعه‌ها', category: 'مشتریان', icon: '▦', keywords: ['tenants', 'organizations', 'مجموعه', 'شعب', 'کافه', 'رستوران', 'فهرست', 'مشتری سازمانی'] },
    { id: 'GM04', hash: '#gm-04-tenant-detail', code: 'GM-04', title: 'پرونده کامل مشتری', category: 'مشتریان', icon: '◎', keywords: ['tenant detail', 'detail', 'پرونده', 'شناسنامه', 'وضعیت', 'مشخصات', 'پروفایل', '۳۶۰'], tenantScoped: true, discoverable: false, parentRoute: 'gm-03-tenants' },
    { id: 'GM05', hash: '#gm-05-tenant-new', code: 'GM-05', title: 'ایجاد مجموعه جدید', category: 'مشتریان', icon: '＋', keywords: ['new tenant', 'create', 'onboarding', 'ایجاد', 'مشتری جدید', 'ثبت نام', 'آنبوردینگ', 'ویزارد', 'محیط جدید'], discoverable: false, parentRoute: 'gm-03-tenants' },
    { id: 'GM06', hash: '#gm-06-provisioning', code: 'GM-06', title: 'راه‌اندازی و تحویل محیط', category: 'مشتریان', icon: '⇧', keywords: ['provisioning', 'deploy', 'تحویل', 'آماده سازی', 'پروویژنینگ', 'استقرار', 'دیتابیس', 'سرور', 'vps'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM08', hash: '#gm-08-features', code: 'GM-08', title: 'کاتالوگ سرویس‌ها', category: 'محصول و درآمد', icon: '▤', keywords: ['features', 'modules', 'catalog', 'ماژول‌ها', 'قابلیت‌ها', 'فیچر', 'کاتالوگ', 'امکانات', 'افزونه', 'سرویس'] },
    { id: 'GM09', hash: '#gm-09-tenant-features', code: 'GM-09', title: 'سرویس‌های فعال مشتری', category: 'مشتریان', icon: '◈', keywords: ['tenant features', 'addons', 'فعال‌سازی', 'امکانات مشتری', 'افزونه‌ها', 'فلگ', 'سوئیچ', 'سرویس فعال'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM10', hash: '#gm-10-plans', code: 'GM-10', title: 'پلن‌ها و تعرفه‌ها', category: 'محصول و درآمد', icon: '▣', keywords: ['plans', 'packages', 'pricing', 'پلن‌ها', 'تعرفه‌ها', 'بسته‌ها', 'اشتراک', 'قیمت', 'تیر'] },
    { id: 'GM11', hash: '#gm-11-billing', code: 'GM-11', title: 'اشتراک، صورتحساب و پرداخت', category: 'مشتریان', icon: '◈', keywords: ['billing', 'invoices', 'payment', 'مالی', 'فاکتور', 'اشتراک', 'پرداخت', 'شارژ', 'حسابداری'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM12', hash: '#gm-12-usage', code: 'GM-12', title: 'مصرف و سهمیه مشتری', category: 'مشتریان', icon: '▥', keywords: ['usage', 'quota', 'limits', 'سهمیه', 'مصرف', 'کووتا', 'محدودیت', 'ترافیک', 'استفاده'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM13', hash: '#gm-13-identities', code: 'GM-13', title: 'کاربران و عضویت‌ها', category: 'مشتریان', icon: '♙', keywords: ['identities', 'users', 'sessions', 'کاربران', 'نشست‌ها', 'سشن', 'سشن‌ها', 'پرسنل', 'اکانت'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM14', hash: '#gm-14-access-roles', code: 'GM-14', title: 'نقش‌ها و مجوزها', category: 'مشتریان', icon: '♜', keywords: ['roles', 'permissions', 'rbac', 'دسترسی', 'نقش‌ها', 'مجوزها', 'ماتریس', 'صلاحیت'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM15', hash: '#gm-15-simulator', code: 'GM-15', title: 'ارزیابی و تطبیق دسترسی', category: 'مشتریان', icon: '△', keywords: ['simulator', 'access check', 'ارزیابی دسترسی', 'تست دسترسی', 'ارزیابی مجوز', 'فرمول دسترسی'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM16', hash: '#gm-16-automations', code: 'GM-16', title: 'خودکارسازی و قوانین', category: 'زیرساخت و تداوم', icon: '↯', keywords: ['automations', 'rules', 'triggers', 'خودکارسازی', 'قواعد', 'اتومیشن', 'وب‌هوک', 'تریگر', 'گردش کار'] },
    { id: 'GM17', hash: '#gm-17-customers', code: 'GM-17', title: 'مشتریان نهایی رستوران', category: 'مشتریان', icon: '♧', keywords: ['customers', 'contacts', 'crm', 'مشتریان نهایی', 'مخاطبین', 'کاربران نهایی', 'دفترچه'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM18', hash: '#gm-18-domains', code: 'GM-18', title: 'دامنه و هویت برند', category: 'مشتریان', icon: '◎', keywords: ['domains', 'dns', 'ssl', 'tls', 'دامنه', 'دی ان اس', 'گواهی', 'برندینگ', 'دامنه اختصاصی'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM19', hash: '#gm-19-devices', code: 'GM-19', title: 'دستگاه‌ها و همگام‌سازی', category: 'مشتریان', icon: '▰', keywords: ['devices', 'pos', 'hardware', 'sync', 'پوز', 'سخت‌افزار', 'دستگاه‌ها', 'پرینتر', 'پایانه فروش', 'سینک'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM20', hash: '#gm-20-backups', code: 'GM-20', title: 'پشتیبان و بازیابی', category: 'مشتریان', icon: '▥', keywords: ['backups', 'restore', 'snapshot', 'پشتیبان', 'بکاپ', 'بازیابی', 'اسنپ‌شات', 'دیتابیس', 'پشتیبان‌گیری'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM21', hash: '#gm-21-support', code: 'GM-21', title: 'تیکت و پشتیبانی', category: 'مشتریان', icon: '◇', keywords: ['support', 'tickets', 'helpdesk', 'پشتیبانی', 'تیکت‌ها', 'درخواست‌ها', 'کمک', 'مشکلات'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' },
    { id: 'GM22', hash: '#gm-22-operations', code: 'GM-22', title: 'سلامت، رخدادها و هشدارها', category: 'مرکز فرماندهی', icon: '◉', keywords: ['operations', 'health', 'incidents', 'uptime', 'سلامت', 'آپ‌تایم', 'رخدادها', 'حوادث', 'مانیتورینگ', 'پایش'] },
    { id: 'GM23', hash: '#gm-23-releases', code: 'GM-23', title: 'نسخه، انتشار و بازگشت', category: 'زیرساخت و تداوم', icon: '⇄', keywords: ['releases', 'canary', 'rollback', 'deploy', 'انتشار', 'نسخه‌ها', 'کاناری', 'رول‌بک', 'نسخه', 'ورژن'] },
    { id: 'GM24', hash: '#gm-24-infrastructure', code: 'GM-24', title: 'پایش سرور و زیرساخت VPS', category: 'زیرساخت و تداوم', icon: '⬡', keywords: ['infrastructure', 'vps', 'server', 'topology', 'cloud', 'زیرساخت', 'سرور', 'وی‌پی‌اس', 'دیتابیس', 'منابع', 'کلاستر'] },
    { id: 'GM25', hash: '#gm-25-jobs', code: 'GM-25', title: 'صف اجرا و کارهای پس‌زمینه', category: 'مرکز فرماندهی', icon: '↻', keywords: ['jobs', 'queues', 'background', 'retry', 'صف کارها', 'وظایف', 'جاب‌ها', 'پردازش ناهمگام', 'تلاش مجدد'] },
    { id: 'GM26', hash: '#gm-26-audit', code: 'GM-26', title: 'ردپای ممیزی', category: 'حاکمیت پلتفرم', icon: '≣', keywords: ['audit', 'logs', 'compliance', 'ممیزی', 'لاگ‌ها', 'ره‌گیری', 'رویدادهای امنیتی', 'گزارش'] },
    { id: 'GM27', hash: '#gm-27-team', code: 'GM-27', title: 'تیم راهبری و تنظیمات', category: 'حاکمیت پلتفرم', icon: '⚙', keywords: ['team', 'settings', 'config', 'admin', 'تیم', 'راهبران', 'تنظیمات', 'پیکربندی سیستم', 'اعضا'] },
    { id: 'GM28', hash: '#gm-28-portal', code: 'GM-28', title: 'پورتال و قرارداد مشتری', category: 'مشتریان', icon: '▱', keywords: ['portal', 'contract', 'agreement', 'sla', 'پورتال', 'قرارداد', 'سند سازمانی', 'مستندات', 'تعهدات'], tenantScoped: true, discoverable: false, parentRoute: 'gm-04-tenant-detail' }
  ],

  actions: [
    {
      id: 'act-theme-settings',
      title: 'تنظیم پوسته و تم (روشن / تیره)',
      subtitle: 'باز کردن مودال انتخاب تم روشن، تیره و سیستم',
      icon: '🌓',
      code: 'پوسته',
      keywords: ['theme', 'dark', 'light', 'mode', 'پوسته', 'تم', 'تیره', 'روشن', 'شب', 'روز', 'دارک'],
      execute: () => {
        if (window.GMApp && typeof window.GMApp.openThemeModal === 'function') {
          window.GMApp.openThemeModal();
        }
      }
    },
    {
      id: 'act-shortcuts-help',
      title: 'راهنمای کلیدهای میانبر پلتفرم (؟)',
      subtitle: 'مشاهده تمام کلیدهای دسترسی سریع کیبورد و ناوبری',
      icon: '⌨️',
      code: 'میانبرها',
      keywords: ['keyboard', 'shortcuts', 'help', 'کلیدها', 'میانبر', 'راهنما', 'کیبورد', 'کلید'],
      execute: () => {
        if (window.GMApp && typeof window.GMApp.openShortcutsHelpModal === 'function') {
          window.GMApp.openShortcutsHelpModal();
        }
      }
    },
    {
      id: 'act-control-plane-setup',
      title: 'الزامات اتصال کنترل‌پلن',
      subtitle: 'مرور وضعیت زیرساخت متمرکز VPS و اتصال امن پلتفرم salsa.ir',
      icon: '🛡️',
      code: 'امنیت',
      keywords: ['کنترل‌پلن', 'اتصال', 'امنیت', 'multi tenant', 'api', 'production', 'وستو', 'westo'],
      execute: () => {
        window.location.hash = '#gm-24-infrastructure';
      }
    },
    {
      id: 'act-new-tenant',
      title: 'ایجاد مشتری سازمانی جدید',
      subtitle: 'ورود به ویزارد راه‌اندازی ۵ مرحله‌ای (GM-05)',
      icon: '➕',
      code: 'اقدام',
      keywords: ['ایجاد مشتری', 'ثبت نام', 'جدید', 'آنبوردینگ', 'new tenant', 'create', 'افزودن مشتری'],
      execute: () => {
        window.location.hash = '#gm-05-tenant-new';
      }
    },
    {
      id: 'act-operations-health',
      title: 'پایش سلامت سیستم و سرور VPS',
      subtitle: 'مشاهده آپ‌تایم و وضعیت زیرساخت پلتفرم (GM-22)',
      icon: '🩺',
      code: 'اقدام',
      keywords: ['سلامت', 'پایش', 'مانیتورینگ', 'آپ‌تایم', 'health', 'operations'],
      execute: () => {
        window.location.hash = '#gm-22-operations';
      }
    },
    {
      id: 'act-access-simulator',
      title: 'اجرای شبیه‌ساز ارزیابی دسترسی',
      subtitle: 'بررسی زنده مجوزهای کاربران و فرمول ارزیابی (GM-15)',
      icon: '🔬',
      code: 'اقدام',
      discoverable: false,
      parentRoute: 'gm-04-tenant-detail',
      keywords: ['شبیه‌ساز', 'دسترسی', 'مجوز', 'تست', 'simulator', 'rbac'],
      execute: () => {
        window.location.hash = '#gm-15-simulator';
      }
    },
    {
      id: 'act-background-jobs',
      title: 'مشاهده صف کارها و وظایف ناهمگام',
      subtitle: 'مدیریت جاب‌ها و تلاش مجدد دسته‌ای (GM-25)',
      icon: '⏱️',
      code: 'اقدام',
      keywords: ['صف کارها', 'جاب', 'وظایف', 'تلاش مجدد', 'jobs', 'queue'],
      execute: () => {
        window.location.hash = '#gm-25-jobs';
      }
    },
    {
      id: 'act-activity-ledger',
      title: 'باز کردن دفتر کل رویدادهای عملیاتی',
      subtitle: 'مشاهده هشدارها، خطاها و تاریخچه پلتفرم',
      icon: '🔔',
      code: 'اقدام',
      keywords: ['رویدادها', 'دفتر کل', 'تاریخچه', 'اعلانات', 'activity', 'ledger', 'events'],
      execute: () => {
        if (window.GMApp && typeof window.GMApp.openActivityDrawer === 'function') {
          window.GMApp.openActivityDrawer('all');
        }
      }
    },
    {
      id: 'act-workflow-directory',
      title: 'نقشه و سلسله‌مراتب استاندارد تمام فرایندها',
      subtitle: 'مشاهده ۶ فرایند استاندارد سازمانی و گام‌های متوالی آن‌ها',
      icon: '🧭',
      code: 'فرایند',
      keywords: ['فرایند', 'فرایندها', 'سلسله مراتب', 'گردش کار', 'workflow', 'process', 'sop', 'مراحل', 'گام‌ها'],
      execute: () => {
        if (window.GMWorkflows && typeof window.GMWorkflows.openHierarchyModal === 'function') {
          window.GMWorkflows.openHierarchyModal();
        }
      }
    },
    {
      id: 'act-proc-onboarding',
      title: 'فرایند ۱: جذب، آماده‌سازی و راه‌اندازی مشتری جدید',
      subtitle: 'گام ۱ از ۷: ثبت مشخصات سازمانی مجموعه جدید (GM-05)',
      icon: '🚀',
      code: 'PROC-01',
      keywords: ['فرایند راه‌اندازی', 'آنبوردینگ', 'ثبت مشتری', 'استقرار', 'onboarding', 'provisioning'],
      execute: () => {
        if (window.GMWorkflows && typeof window.GMWorkflows.navigateToStep === 'function') {
          window.GMWorkflows.navigateToStep('proc-onboarding', 1);
        } else {
          window.location.hash = '#gm-05-tenant-new';
        }
      }
    },
    {
      id: 'act-proc-operations',
      title: 'فرایند ۲: عملیات روزمره و پایش پایانه‌های سالن',
      subtitle: 'گام ۱ از ۵: بررسی وضعیت و آمادگی پلتفرم (GM-02)',
      icon: '⚡',
      code: 'PROC-02',
      keywords: ['فرایند عملیات', 'پایش پایانه', 'پوز', 'همگام‌سازی', 'operations', 'sync'],
      execute: () => {
        if (window.GMWorkflows && typeof window.GMWorkflows.navigateToStep === 'function') {
          window.GMWorkflows.navigateToStep('proc-operations', 1);
        } else {
          window.location.hash = '#gm-02-overview';
        }
      }
    },
    {
      id: 'act-proc-commercial',
      title: 'فرایند ۳: چرخه تجاری، پلن‌ها و صورتحساب',
      subtitle: 'گام ۱ از ۵: کاتالوگ ماژول‌ها و سرویس‌های پلتفرم (GM-08)',
      icon: '💎',
      code: 'PROC-03',
      keywords: ['فرایند تجاری', 'مالی', 'صورتحساب', 'پلن', 'تعرفه', 'commercial', 'billing'],
      execute: () => {
        if (window.GMWorkflows && typeof window.GMWorkflows.navigateToStep === 'function') {
          window.GMWorkflows.navigateToStep('proc-commercial', 1);
        } else {
          window.location.hash = '#gm-08-features';
        }
      }
    },
    {
      id: 'act-proc-security',
      title: 'فرایند ۴: امنیت، هویت سازمانی و حاکمیت دسترسی',
      subtitle: 'گام ۱ از ۶: ورود دومرحله‌ای و امنیت حساب (GM-01)',
      icon: '🛡️',
      code: 'PROC-04',
      keywords: ['فرایند امنیت', 'هویت', 'دسترسی', 'نقش‌ها', 'rbac', 'security', 'governance'],
      execute: () => {
        if (window.GMWorkflows && typeof window.GMWorkflows.navigateToStep === 'function') {
          window.GMWorkflows.navigateToStep('proc-security', 1);
        } else {
          window.location.hash = '#gm-01-login';
        }
      }
    },
    {
      id: 'act-proc-incident',
      title: 'فرایند ۵: مدیریت رخداد، پشتیبانی و بازیابی اضطراری',
      subtitle: 'گام ۱ از ۶: پایش رخدادها و اعلام قطعی (GM-22)',
      icon: '🚨',
      code: 'PROC-05',
      keywords: ['فرایند رخداد', 'حادثه', 'پشتیبانی', 'تیکت', 'بازیابی', 'incident', 'dr'],
      execute: () => {
        if (window.GMWorkflows && typeof window.GMWorkflows.navigateToStep === 'function') {
          window.GMWorkflows.navigateToStep('proc-incident', 1);
        } else {
          window.location.hash = '#gm-22-operations';
        }
      }
    },
    {
      id: 'act-proc-infrastructure',
      title: 'فرایند ۶: زیرساخت، انتشار نسخه و خودکارسازی',
      subtitle: 'گام ۱ از ۴: پایش سرور اختصاصی VPS و اتصالات دیتابیس (GM-24)',
      icon: '⚙️',
      code: 'PROC-06',
      keywords: ['فرایند زیرساخت', 'سرور', 'vps', 'نسخه', 'انتشار', 'infrastructure', 'release'],
      execute: () => {
        if (window.GMWorkflows && typeof window.GMWorkflows.navigateToStep === 'function') {
          window.GMWorkflows.navigateToStep('proc-infrastructure', 1);
        } else {
          window.location.hash = '#gm-24-infrastructure';
        }
      }
    }
  ],

  normalize(str) {
    if (!str) return '';
    return String(str)
      .toLowerCase()
      .replace(/[\u064A\u0649]/g, 'ی')
      .replace(/[\u0643]/g, 'ک')
      .replace(/[\u0629]/g, 'ه')
      .replace(/[\u064B-\u065F]/g, '')
      .replace(/[۰-۹]/g, d => '0123456789'['۰۱۲۳۴۵۶۷۸۹'.indexOf(d)])
      .replace(/[-_]/g, '')
      .trim();
  },

  recordVisit(viewName, routeName) {
    try {
      const cleanRouteName = (routeName || '').replace(/^#\/?/, '').split('?')[0];
      const route = this.routes.find(r => r.id === viewName || r.hash.replace(/^#\/?/, '') === cleanRouteName);
      if (!route || route.id === 'GM01' || route.discoverable === false) return; // Keep tenant surfaces inside the dossier

      let recents = this.getStoredRecents();
      // Remove existing occurrence if already in list
      recents = recents.filter(r => r.id !== route.id);
      // Prepend to top
      recents.unshift({
        id: route.id,
        hash: route.hash,
        code: route.code,
        title: route.title,
        category: route.category,
        icon: route.icon,
        tenantScoped: !!route.tenantScoped
      });
      // Limit to 4
      recents = recents.slice(0, 4);
      localStorage.setItem('salsa_recent_routes', JSON.stringify(recents));
    } catch (e) {}
  },

  getStoredRecents() {
    try {
      const stored = localStorage.getItem('salsa_recent_routes');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          return parsed.filter((item) => {
            const route = this.routes.find((candidate) => candidate.id === item.id);
            return route && route.discoverable !== false;
          });
        }
      }
    } catch (e) {}
    return [];
  },

  getRecents() {
    const stored = this.getStoredRecents();
    if (stored.length > 0) return stored;
    // Default recents if none visited yet
    return [
      this.routes.find(r => r.id === 'GM02'),
      this.routes.find(r => r.id === 'GM03'),
      this.routes.find(r => r.id === 'GM25')
    ].filter(Boolean);
  },

  search(query = '') {
    const q = this.normalize(query);
    if (!q) {
      return {
        isDefault: true,
        recents: this.getRecents(),
        actions: this.actions.filter((action) => action.discoverable !== false),
        tenants: [],
        routes: []
      };
    }

    const tokens = q.split(/\s+/).filter(Boolean);

    const matchesTokens = (targetStr) => {
      const norm = this.normalize(targetStr);
      return tokens.every(t => norm.includes(t));
    };

    // 1. Search actions
    const matchedActions = this.actions.filter(act => act.discoverable !== false && (() => {
      const searchSpace = [act.title, act.subtitle, act.code, ...(act.keywords || [])].join(' ');
      return matchesTokens(searchSpace);
    })());

    // 2. Search tenants (from prototype store)
    const store = window.GMStore || window.prototypeStore;
    const allTenants = (store && typeof store.getTenants === 'function') ? store.getTenants() : [];
    const matchedTenants = allTenants.filter(t => {
      const searchSpace = [t.name, t.id, t.cell, t.plan, t.status].join(' ');
      return matchesTokens(searchSpace);
    }).map(t => ({
      id: t.id,
      title: t.name,
      subtitle: `مشتری سازمانی · سرور اختصاصی VPS · پلن ${t.plan || 'enterprise'}`,
      code: t.id,
      icon: '🏢',
      execute: () => {
        if (store && typeof store.setActiveTenantId === 'function') {
          store.setActiveTenantId(t.id);
        }
        if (window.GMApp && typeof window.GMApp.showToast === 'function') {
          window.GMApp.showToast(`دامنه عملیاتی به «${t.name}» تنظیم شد.`, 'success', 2500);
        }
        window.location.hash = `#gm-04-tenant-detail?id=${t.id}`;
      }
    }));

    // 3. Search routes
    const matchedRoutes = this.routes.filter(r => r.discoverable !== false && (() => {
      const searchSpace = [r.title, r.code, r.code.replace('-', ''), r.category, ...(r.keywords || [])].join(' ');
      return matchesTokens(searchSpace);
    })()).sort((a, b) => this.navigationOrder.indexOf(a.id) - this.navigationOrder.indexOf(b.id));

    return {
      isDefault: false,
      recents: [],
      actions: matchedActions,
      tenants: matchedTenants,
      routes: matchedRoutes
    };
  },

  open() {
    const backdrop = document.getElementById('command-palette-backdrop');
    const input = document.getElementById('command-palette-input');
    if (!backdrop || !input) return;

    this.isOpen = true;
    this.lastFocusedElement = document.activeElement;
    backdrop.classList.add('open');
    backdrop.removeAttribute('aria-hidden');

    input.value = '';
    this.activeIndex = 0;
    this.render();

    // Prevent background scrolling
    if (typeof document !== 'undefined' && document.body) {
      document.body.style.overflow = 'hidden';
    }

    setTimeout(() => {
      input.focus();
    }, 40);
  },

  close() {
    const backdrop = document.getElementById('command-palette-backdrop');
    if (!backdrop) return;

    this.isOpen = false;
    backdrop.classList.remove('open');
    backdrop.setAttribute('aria-hidden', 'true');
    if (typeof document !== 'undefined' && document.body) {
      document.body.style.overflow = '';
    }

    if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
      try { this.lastFocusedElement.focus(); } catch (e) {}
    } else {
      const trigger = document.getElementById('header-command-trigger');
      if (trigger) trigger.focus();
    }
  },

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  },

  render() {
    const input = document.getElementById('command-palette-input');
    const resultsContainer = document.getElementById('command-palette-results');
    const footerMeta = document.getElementById('command-footer-meta');
    if (!resultsContainer) return;

    const query = input ? input.value : '';
    const searchData = this.search(query);

    // Build flattened list of items to facilitate keyboard navigation
    this.filteredItems = [];
    let html = '';

    if (searchData.isDefault) {
      // 1. Recents Group
      if (searchData.recents && searchData.recents.length > 0) {
        html += `<div class="command-group" role="group" aria-label="مقصد‌های اخیر">`;
        html += `<div class="command-group-title"><span>🕒 مقصد‌های اخیر</span><span style="font-family: var(--font-mono); font-size: 0.65rem;">حافظه مسیرها</span></div>`;
        searchData.recents.forEach(item => {
          const itemIdx = this.filteredItems.length;
          this.filteredItems.push({
            type: 'route',
            item: item,
            execute: () => { window.location.hash = item.hash; }
          });
          html += this.renderItemHtml({
            title: item.title,
            subtitle: item.category,
            code: item.code,
            icon: item.icon
          }, itemIdx, 'پرش');
        });
        html += `</div>`;
      }

      // 2. Quick Actions Group
      if (searchData.actions && searchData.actions.length > 0) {
        html += `<div class="command-group" role="group" aria-label="اقدامات سریع">`;
        html += `<div class="command-group-title"><span>اقدامات متداول و سریع</span></div>`;
        searchData.actions.forEach(action => {
          const itemIdx = this.filteredItems.length;
          this.filteredItems.push({
            type: 'action',
            item: action,
            execute: action.execute
          });
          html += this.renderItemHtml(action, itemIdx, 'اجرا');
        });
        html += `</div>`;
      }

      if (footerMeta) {
        const globalRouteCount = this.routes.filter((route) => route.discoverable !== false).length;
        footerMeta.textContent = `${globalRouteCount.toLocaleString('fa-IR')} مقصد سراسری · پرونده مشتری از فهرست مشتریان`;
      }
    } else {
      // Results from query
      const totalMatches = (searchData.actions.length) + (searchData.tenants.length) + (searchData.routes.length);

      if (totalMatches === 0) {
        html = `
          <div class="command-empty-state">
            <div class="command-empty-icon" aria-hidden="true"></div>
          <div class="text-primary" style="font-weight: 600;">نتیجه‌ای برای «${this.escapeHtml(query)}» یافت نشد</div>
          <div class="text-secondary" style="font-size: 0.75rem;">عبارت دیگری مانند «بکاپ»، «dns»، «GM-25»، «پوز» یا «مشتری» را امتحان کنید.</div>
          </div>
        `;
        if (footerMeta) {
          footerMeta.textContent = '۰ نتیجه';
        }
      } else {
        // Actions
        if (searchData.actions.length > 0) {
          html += `<div class="command-group" role="group" aria-label="اقدامات منطبق">`;
          html += `<div class="command-group-title"><span>اقدامات منطبق (${searchData.actions.length.toLocaleString('fa-IR')})</span></div>`;
          searchData.actions.forEach(act => {
            const itemIdx = this.filteredItems.length;
            this.filteredItems.push({
              type: 'action',
              item: act,
              execute: act.execute
            });
            html += this.renderItemHtml(act, itemIdx, 'اجرا');
          });
          html += `</div>`;
        }

        // Tenants
        if (searchData.tenants.length > 0) {
          html += `<div class="command-group" role="group" aria-label="مشتریان منطبق">`;
          html += `<div class="command-group-title"><span>🏢 مشتریان سازمانی (${searchData.tenants.length.toLocaleString('fa-IR')})</span></div>`;
          searchData.tenants.forEach(tnt => {
            const itemIdx = this.filteredItems.length;
            this.filteredItems.push({
              type: 'tenant',
              item: tnt,
              execute: tnt.execute
            });
            html += this.renderItemHtml(tnt, itemIdx, 'انتخاب');
          });
          html += `</div>`;
        }

        // Routes
        if (searchData.routes.length > 0) {
          html += `<div class="command-group" role="group" aria-label="صفحات و نماها">`;
          html += `<div class="command-group-title"><span>📑 صفحات پلتفرم (${searchData.routes.length.toLocaleString('fa-IR')})</span></div>`;
          searchData.routes.forEach(r => {
            const itemIdx = this.filteredItems.length;
            this.filteredItems.push({
              type: 'route',
              item: r,
              execute: () => { window.location.hash = r.hash; }
            });
            html += this.renderItemHtml({
              title: r.title,
              subtitle: r.category,
              code: r.code,
              icon: r.icon
            }, itemIdx, 'پرش');
          });
          html += `</div>`;
        }

        if (footerMeta) {
          footerMeta.textContent = `${totalMatches.toLocaleString('fa-IR')} نتیجه منطبق`;
        }
      }
    }

    resultsContainer.innerHTML = html;

    // Normalize active index
    if (this.activeIndex >= this.filteredItems.length) {
      this.activeIndex = Math.max(0, this.filteredItems.length - 1);
    }
    this.updateActiveItemVisuals();
  },

  renderItemHtml(item, index, actionBadgeText = 'پرش') {
    const isActive = index === this.activeIndex;
    return `
      <div class="command-item ${isActive ? 'is-active' : ''}" 
           id="command-item-${index}" 
           role="option" 
           aria-selected="${isActive}" 
           data-item-index="${index}"
           onclick="window.GMCommandPalette.selectIndex(${index})">
        <div class="command-item-icon" aria-hidden="true">${item.icon || '📄'}</div>
        <div class="command-item-content">
          <div class="command-item-title-row">
            <span class="command-item-title">${this.escapeHtml(item.title)}</span>
            ${item.code ? `<span class="command-item-code">${this.escapeHtml(item.code)}</span>` : ''}
          </div>
          ${item.subtitle ? `<div class="command-item-subtitle">${this.escapeHtml(item.subtitle)}</div>` : ''}
        </div>
        <span class="command-item-action" aria-hidden="true">${actionBadgeText} ↵</span>
      </div>
    `;
  },

  updateActiveItemVisuals() {
    const items = document.querySelectorAll('.command-palette-body .command-item');
    items.forEach((el, idx) => {
      const isSelected = idx === this.activeIndex;
      if (isSelected) {
        el.classList.add('is-active');
        el.setAttribute('aria-selected', 'true');
        el.scrollIntoView({ block: 'nearest' });
      } else {
        el.classList.remove('is-active');
        el.setAttribute('aria-selected', 'false');
      }
    });
    const input = document.getElementById('command-palette-input');
    if (input && this.filteredItems.length > 0) {
      input.setAttribute('aria-activedescendant', `command-item-${this.activeIndex}`);
    } else if (input) {
      input.removeAttribute('aria-activedescendant');
    }
  },

  navigate(direction) {
    if (this.filteredItems.length === 0) return;
    this.activeIndex = (this.activeIndex + direction + this.filteredItems.length) % this.filteredItems.length;
    this.updateActiveItemVisuals();
  },

  selectIndex(index) {
    if (index >= 0 && index < this.filteredItems.length) {
      const selected = this.filteredItems[index];
      this.close();
      if (selected && typeof selected.execute === 'function') {
        selected.execute();
      }
    }
  },

  activateSelected() {
    if (this.filteredItems.length > 0 && this.activeIndex >= 0 && this.activeIndex < this.filteredItems.length) {
      this.selectIndex(this.activeIndex);
    }
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  initListeners() {
    const input = document.getElementById('command-palette-input');
    if (input) {
      input.addEventListener('input', () => {
        this.activeIndex = 0;
        this.render();
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.navigate(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.navigate(-1);
        } else if (e.key === 'Home') {
          e.preventDefault();
          this.activeIndex = 0;
          this.updateActiveItemVisuals();
        } else if (e.key === 'End') {
          e.preventDefault();
          this.activeIndex = Math.max(0, this.filteredItems.length - 1);
          this.updateActiveItemVisuals();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          this.activateSelected();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.close();
        }
      });
    }

    const backdrop = document.getElementById('command-palette-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          this.close();
        }
      });
    }
  }
};

// Global shorthand utility functions
window.showToast = window.GMApp.showToast.bind(window.GMApp);
window.openDrawer = window.GMApp.openDrawer.bind(window.GMApp);
window.closeDrawer = window.GMApp.closeDrawer.bind(window.GMApp);
window.openModal = window.GMApp.openModal.bind(window.GMApp);
window.closeModal = window.GMApp.closeModal.bind(window.GMApp);
window.openCommandPalette = window.GMApp.openCommandPalette.bind(window.GMApp);
window.closeCommandPalette = window.GMApp.closeCommandPalette.bind(window.GMApp);
window.toggleCommandPalette = window.GMApp.toggleCommandPalette.bind(window.GMApp);
window.openActivityDrawer = window.GMApp.openActivityDrawer.bind(window.GMApp);
window.toggleActivityDrawer = window.GMApp.toggleActivityDrawer.bind(window.GMApp);
window.initTableSelection = window.GMTableSelect.initTable.bind(window.GMTableSelect);
window.openThemeModal = window.GMApp.openThemeModal.bind(window.GMApp);
window.openShortcutsHelpModal = window.GMApp.openShortcutsHelpModal.bind(window.GMApp);

document.addEventListener('DOMContentLoaded', () => {
  window.GMApp.init();
});
