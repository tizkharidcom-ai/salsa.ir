// prototype/js/router.js
// Client-side Hash Router for GODMODE Control Plane Prototype

window.GMRouter = {
  routes: {
    'gm-01-login': 'GM01',
    'gm-01-auth': 'GM01',
    'login': 'GM01',
    'auth': 'GM01',
    'me/security': 'GM01',

    'gm-02-overview': 'GM02',
    'overview': 'GM02',

    'gm-03-tenants': 'GM03',
    'tenants': 'GM03',
    'customers/tenants': 'GM03',

    'gm-04-tenant-detail': 'GM04',
    'tenants/detail': 'GM04',
    'customers/detail': 'GM04',

    'gm-05-tenant-new': 'GM05',
    'tenants/new': 'GM05',
    'customers/new': 'GM05',

    'gm-06-provisioning': 'GM06',
    'provisioning': 'GM06',
    'customers/provisioning': 'GM06',


    'gm-08-features': 'GM08',
    'features': 'GM08',
    'product/features': 'GM08',
    'product': 'GM08',

    'gm-09-tenant-features': 'GM09',
    'tenant-features': 'GM09',
    'product/entitlements': 'GM09',
    'entitlements': 'GM09',

    'gm-10-plans': 'GM10',
    'plans': 'GM10',
    'product/plans': 'GM10',

    'gm-11-billing': 'GM11',
    'billing': 'GM11',
    'revenue': 'GM11',
    'revenue/subscriptions': 'GM11',
    'revenue/invoices': 'GM11',

    'gm-12-usage': 'GM12',
    'usage': 'GM12',
    'revenue/usage': 'GM12',

    'gm-13-identities': 'GM13',
    'identities': 'GM13',
    'security/users': 'GM13',
    'security': 'GM13',

    'gm-14-access-roles': 'GM14',
    'access/roles': 'GM14',
    'roles': 'GM14',
    'security/roles': 'GM14',

    'gm-15-simulator': 'GM15',
    'access/simulator': 'GM15',
    'simulator': 'GM15',

    'gm-16-automations': 'GM16',
    'automations': 'GM16',

    'gm-17-customers': 'GM17',
    'data/customers': 'GM17',
    'customers': 'GM17',

    'gm-18-domains': 'GM18',
    'domains': 'GM18',
    'platform/domains': 'GM18',
    'platform': 'GM18',

    'gm-19-devices': 'GM19',
    'devices': 'GM19',
    'customers/devices': 'GM19',

    'gm-20-backups': 'GM20',
    'backups': 'GM20',
    'operations/backups': 'GM20',

    'gm-21-support': 'GM21',
    'support': 'GM21',
    'support/sessions': 'GM21',
    'customers/support': 'GM21',

    'gm-22-operations': 'GM22',
    'operations': 'GM22',
    'operations/health': 'GM22',
    'operations/incidents': 'GM22',
    'incidents': 'GM22',

    'gm-23-releases': 'GM23',
    'releases': 'GM23',
    'platform/releases': 'GM23',

    'gm-24-infrastructure': 'GM24',
    'infrastructure': 'GM24',
    'platform/infrastructure': 'GM24',
    'cells': 'GM24',

    'gm-25-jobs': 'GM25',
    'jobs': 'GM25',
    'operations/jobs': 'GM25',

    'gm-26-audit': 'GM26',
    'audit': 'GM26',
    'security/audit': 'GM26',

    'gm-27-team': 'GM27',
    'team': 'GM27',
    'settings': 'GM27',
    'platform/settings': 'GM27',

    'gm-28-portal': 'GM28',
    'portal': 'GM28',
    'account': 'GM28',

    'gm-29-printers': 'GM29',
    'printers': 'GM29',
    'settings/printers': 'GM29',

    'specs': 'Specs'
  },

  routeToModule: {
    'gm-02-overview': 'overview',
    'overview': 'overview',

    'gm-03-tenants': 'customers',
    'tenants': 'customers',
    'customers/tenants': 'customers',
    'gm-04-tenant-detail': 'customers',
    'tenants/detail': 'customers',
    'customers/detail': 'customers',
    'gm-05-tenant-new': 'customers',
    'tenants/new': 'customers',
    'customers/new': 'customers',
    'gm-06-provisioning': 'customers',
    'provisioning': 'customers',
    'customers/provisioning': 'customers',
    'gm-09-tenant-features': 'customers',
    'tenant-features': 'customers',
    'product/entitlements': 'billing',
    'entitlements': 'billing',

    'gm-17-customers': 'customers',
    'data/customers': 'customers',
    'customers': 'customers',
    'customers/devices': 'customers',
    'customers/support': 'customers',

    'gm-08-features': 'billing',
    'features': 'billing',
    'product': 'billing',
    'product/features': 'billing',
    'gm-10-plans': 'billing',
    'plans': 'billing',
    'product/plans': 'billing',
    'gm-11-billing': 'billing',
    'billing': 'billing',
    'revenue': 'billing',
    'revenue/subscriptions': 'billing',
    'revenue/invoices': 'billing',
    'gm-12-usage': 'billing',
    'usage': 'billing',
    'revenue/usage': 'billing',

    'gm-14-access-roles': 'security',
    'access/roles': 'security',
    'roles': 'security',
    'security/roles': 'security',
    'gm-15-simulator': 'security',
    'access/simulator': 'security',
    'simulator': 'security',
    'gm-13-identities': 'security',
    'identities': 'security',
    'security': 'security',
    'security/users': 'security',
    'security/audit': 'platform',

    'gm-16-automations': 'infrastructure',
    'automations': 'infrastructure',

    'gm-22-operations': 'overview',
    'operations': 'overview',
    'incidents': 'overview',
    'gm-19-devices': 'customers',
    'devices': 'customers',
    'gm-20-backups': 'infrastructure',
    'backups': 'infrastructure',
    'gm-23-releases': 'infrastructure',
    'releases': 'infrastructure',
    'gm-24-infrastructure': 'infrastructure',
    'infrastructure': 'infrastructure',
    'cells': 'infrastructure',
    'gm-25-jobs': 'overview',
    'jobs': 'overview',

    'gm-01-login': 'security',
    'login': 'security',

    'gm-18-domains': 'customers',
    'domains': 'customers',

    'gm-21-support': 'customers',
    'support': 'customers',
    'support/sessions': 'customers',
    'gm-26-audit': 'platform',
    'audit': 'platform',
    'gm-27-team': 'platform',
    'team': 'platform',
    'settings': 'platform',
    'gm-28-portal': 'customers',
    'portal': 'customers',
    'account': 'customers',

    'gm-29-printers': 'platform',
    'printers': 'platform',
    'settings/printers': 'platform'
  },

  tenantScopedViews: [
    'GM04', 'GM06', 'GM09', 'GM11', 'GM12', 'GM13', 'GM14', 'GM15',
    'GM17', 'GM18', 'GM19', 'GM20', 'GM21', 'GM28'
  ],

  applyContracts() {
    const contracts = window.GMPageContracts;
    if (!contracts) return;
    this.routes = contracts.buildRouteMap();
    this.routeToModule = contracts.buildModuleMap();
    this.tenantScopedViews = contracts.tenantScopedViews();
  },

  // Views are intentionally framework-free and many of them render links as
  // template strings. Normalize those links after every render so operators
  // see and copy short routes (`#customers`, `#customer/billing`, etc.) even
  // when a view still references a compatible legacy GM route internally.
  compactLinks(root) {
    const contracts = window.GMPageContracts;
    if (!contracts || typeof contracts.compactHash !== 'function' || !root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('a[href^="#"]').forEach((link) => {
      const href = link.getAttribute('href');
      const compact = contracts.compactHash(href);
      if (compact && compact !== href) link.setAttribute('href', compact);
    });
  },

  // Build a canonical hash before assigning it. This keeps in-place tab
  // changes and programmatic navigation on the same short route format as
  // normal hashchange navigation.
  compactHash(hash) {
    const contracts = window.GMPageContracts;
    return contracts && typeof contracts.compactHash === 'function'
      ? contracts.compactHash(hash)
      : hash;
  },

  observeLinkCompaction() {
    if (this._linkObserver || typeof MutationObserver !== 'function' || typeof document === 'undefined' || !document.body) return;
    const contracts = window.GMPageContracts;
    if (!contracts || typeof contracts.compactHash !== 'function') return;
    this._linkObserver = new MutationObserver((mutations) => {
      mutations.forEach(({ addedNodes }) => {
        addedNodes.forEach((node) => {
          if (!node || node.nodeType !== 1) return;
          if (node.matches?.('a[href^="#"]')) {
            const href = node.getAttribute('href');
            const compact = contracts.compactHash(href);
            if (compact && compact !== href) node.setAttribute('href', compact);
          }
          this.compactLinks(node);
        });
      });
    });
    this._linkObserver.observe(document.body, { childList: true, subtree: true });
  },

  isTenantScoped(viewName) {
    return this.tenantScopedViews.includes(viewName);
  },

  syncViews() {
    window.GMViews = window.GMViews || {};
    for (let i = 1; i <= 29; i++) {
      const pad = String(i).padStart(2, '0');
      const key = `GM${pad}`;
      const renderFnName = `render${key}`;
      if (typeof window[renderFnName] === 'function') {
        if (!window.GMViews[key]) {
          window.GMViews[key] = { render: (params) => window[renderFnName](params) };
        } else if (typeof window.GMViews[key].render !== 'function') {
          window.GMViews[key].render = (params) => window[renderFnName](params);
        }
      } else if (window.GMViews[key] && typeof window.GMViews[key].render === 'function') {
        window[renderFnName] = (params) => window.GMViews[key].render(params);
      }
    }
  },

  init() {
    this.applyContracts();
    this.syncViews();
    this.compactLinks(document);
    this.observeLinkCompaction();
    window.addEventListener('hashchange', () => this.handleRoute());
    window.addEventListener('gm:tenant-changed', () => {
      const rawHash = window.location.hash.replace(/^#\/?/, '');
      const [routeName] = rawHash.split('?');
      const targetViewName = routeName ? this.routes[routeName] : 'GM02';
      if (this.isTenantScoped(targetViewName)) {
        this.handleRoute();
      }
    });
    if (!window.location.hash) {
      window.location.hash = '#home';
    } else {
      this.handleRoute();
    }
  },

  handleRoute() {
    // If modern canonical GodModeRouter is available, delegate directly
    if (typeof window !== 'undefined' && window.GodModeRouter && typeof window.GodModeRouter.handleRoute === 'function') {
      window.GodModeRouter.handleRoute();
      return;
    }

    this.syncViews();
    const rawHash = window.location.hash.replace(/^#\/?/, '');
    const [routeName, query] = rawHash.split('?');
    const targetViewName = routeName ? this.routes[routeName] : 'GM02';
    const contract = window.GMPageContracts && typeof window.GMPageContracts.getForView === 'function'
      ? window.GMPageContracts.getForView(targetViewName)
      : null;
    const compactRoute = contract?.shortRoute || routeName || 'overview';
    const canonicalPageRoute = contract?.route || routeName;
    // Cache-busting query strings belong to development tooling, not to the
    // operator-facing address. Keep old GM fragments compatible, then replace
    // them with the short product route without adding a history entry.
    if (typeof window.history?.replaceState === 'function' && typeof window.location?.href === 'string') {
      try {
        const address = new URL(window.location.href);
        const compactHash = this.compactHash(`#${routeName || 'overview'}${query ? `?${query}` : ''}`);
        const needsCompaction = address.searchParams.has('cache') || address.hash !== compactHash;
        if (needsCompaction) {
          address.searchParams.delete('cache');
          address.hash = compactHash.slice(1);
          window.history.replaceState(null, '', address.toString());
        }
      } catch (_error) {
        // A constrained test/browser host may not expose a mutable URL object.
      }
    }
    const dossierTabByView = {
      GM06: 'provisioning',
      GM09: 'features',
      GM11: 'billing',
      GM12: 'usage',
      GM13: 'identities',
      GM14: 'access',
      GM15: 'simulator',
      GM17: 'customers',
      GM18: 'domains',
      GM19: 'devices',
      GM20: 'backups',
      GM21: 'support',
      GM28: 'portal'
    };
    const isLegacyPortalRoute = targetViewName === 'GM28';
    const navRouteName = isLegacyPortalRoute ? 'gm-04-tenant-detail' : routeName;

    this.currentRoute = compactRoute;

    // Refresh activity ledger badge
    if (window.GMApp && typeof window.GMApp.updateActivityBadge === 'function') {
      window.GMApp.updateActivityBadge();
    }

    // Record route visit for Command Palette Recents (Pass 16)
    if (window.GMCommandPalette && typeof window.GMCommandPalette.recordVisit === 'function') {
      window.GMCommandPalette.recordVisit(targetViewName, this.currentRoute);
    }

    // Update active nav link & group (Selected State per GODMODE.MD §20.4)
    const activeModule = this.routeToModule[routeName] || this.routeToModule[this.currentRoute] || 'overview';
    let exactFound = false;

    // Reset all nav groups
    document.querySelectorAll('.nav-group').forEach(grp => grp.classList.remove('is-active-group'));

    // Pass 1: exact route match
    document.querySelectorAll('.nav-item').forEach(link => {
      const href = link.getAttribute('href') || '';
      const isExact = (
        href === `#${this.currentRoute}` ||
        href === `#${navRouteName}` ||
        href === `#${canonicalPageRoute}`
      );
      if (isExact) {
        exactFound = true;
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
        const parentGroup = link.closest('.nav-group');
        if (parentGroup) {
          parentGroup.classList.add('is-active-group');
          parentGroup.classList.remove('is-collapsed');
          parentGroup.querySelector('[data-nav-group-toggle]')?.setAttribute('aria-expanded', 'true');
        }
        try { link.scrollIntoView({ block: 'nearest' }); } catch (e) {}
      } else {
        link.classList.remove('active');
        link.removeAttribute('aria-current');
      }
    });

    // Pass 2: fallback to parent module if on a sub-route without direct link
    if (!exactFound) {
      document.querySelectorAll('.nav-item').forEach(link => {
        const module = link.getAttribute('data-module');
        if (module && module === activeModule && !exactFound) {
          link.classList.add('active');
          link.setAttribute('aria-current', 'page');
          const parentGroup = link.closest('.nav-group');
          if (parentGroup) {
            parentGroup.classList.add('is-active-group');
            parentGroup.classList.remove('is-collapsed');
            parentGroup.querySelector('[data-nav-group-toggle]')?.setAttribute('aria-expanded', 'true');
          }
          exactFound = true;
        }
      });
    }

    // Keep the navigation calm for new operators: one active workstream stays open
    // after routing, while unrelated groups are collapsed until explicitly opened.
    const activeNavGroup = document.querySelector('.nav-group.is-active-group');
    document.querySelectorAll('.nav-group').forEach(group => {
      if (group === activeNavGroup) return;
      const toggle = group.querySelector('[data-nav-group-toggle]');
      if (!toggle) return;
      if (window.GMApp && typeof window.GMApp.setSidebarGroupExpanded === 'function') {
        window.GMApp.setSidebarGroupExpanded(group, toggle, false);
      } else {
        group.classList.add('is-collapsed');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });

    // Close mobile sidebar if open
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar && sidebar.classList.contains('open')) {
      sidebar.classList.remove('open');
      const btn = document.getElementById('mobile-menu-btn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      const backdrop = document.getElementById('drawer-backdrop');
      if (backdrop && !document.getElementById('app-drawer')?.classList.contains('open')) {
        backdrop.classList.remove('open');
        backdrop.setAttribute('aria-hidden', 'true');
      }
    }

    // Parse query params (e.g. ?id=tnt_westo_demo)
    const params = {};
    if (query) {
      const searchParams = new URLSearchParams(query);
      for (const [k, v] of searchParams.entries()) {
        params[k] = v;
      }
    }

    // Tenant-owned deep links remain compatible, but render inside the
    // selected customer's dossier so tenant work cannot escape its workspace.
    let effectiveViewName = targetViewName;
    if (isLegacyPortalRoute) {
      effectiveViewName = 'GM04';
      params.tab = 'portal';
    }

    // Tenant-owned routes are fail-closed. A customer must be selected from
    // the registry and must still exist; stale global context is never reused.
    const store = window.GMStore || window.prototypeStore;
    if (this.isTenantScoped(targetViewName)) {
      const requestedTenantId = params.id || params.tenantId;
      const requestedTenant = requestedTenantId && store && typeof store.getTenant === 'function'
        ? store.getTenant(requestedTenantId)
        : null;
      if (!requestedTenant) {
        if (targetViewName === 'GM19' && (!requestedTenantId || requestedTenantId === 'all')) {
          params.id = 'all';
        } else {
          window.location.hash = '#gm-03-tenants';
          return;
        }
      } else {
        params.id = requestedTenant.id;
        delete params.tenantId;
        store.setActiveTenantId(requestedTenant.id, { silent: true });
      }
    }

    const dossierTab = dossierTabByView[targetViewName];
    const hasExplicitTenant = Boolean(params.id) && params.id !== 'all';
    if (!isLegacyPortalRoute && dossierTab && hasExplicitTenant) {
      effectiveViewName = 'GM04';
      params.tab = dossierTab;
    }

    // Render view via Modular Monolith Kernel with Fault-Isolation Boundary
    const mainContent = document.getElementById('main-content');
    if (window.GMKernel && typeof window.GMKernel.executeView === 'function') {
      window.GMKernel.executeView(effectiveViewName, params, mainContent);
    } else {
      const viewObj = window.GMViews && window.GMViews[effectiveViewName];
      const renderFn = window['render' + effectiveViewName];

      if (viewObj && typeof viewObj.render === 'function') {
        try {
          mainContent.innerHTML = viewObj.render(params);
          if (typeof viewObj.afterRender === 'function') {
            viewObj.afterRender(params);
          }
        } catch (err) {
          console.error('Render error in view', targetViewName, err);
          mainContent.innerHTML = `
            <div class="alert alert-danger" style="margin: 32px;" role="alert" aria-live="assertive" aria-label="خطا در رندر صفحه">
              <h3>خطا در رندر صفحه (${targetViewName})</h3>
              <p>${err.message}</p>
            </div>
          `;
        }
      } else if (typeof renderFn === 'function') {
        try {
          mainContent.innerHTML = renderFn(params);
        } catch (err) {
          console.error('Render error in function', 'render' + targetViewName, err);
          mainContent.innerHTML = `
            <div class="alert alert-danger" style="margin: 32px;" role="alert" aria-live="assertive" aria-label="خطا در رندر صفحه">
              <h3>خطا در فراخوانی تابع صفحه (${targetViewName})</h3>
              <p>${err.message}</p>
            </div>
          `;
        }
      } else {
        mainContent.innerHTML = `
          <div class="card" style="margin: 32px;" role="region" aria-label="صفحه یافت نشد">
            <div class="card-body" style="text-align: center; padding: 48px 24px;">
              <h2>صفحه یافت نشد (۴۰۴)</h2>
              <p style="color: var(--color-slate-400); margin: 12px 0 24px;">مسیر درخواستی در پروتوتایپ موجود نیست.</p>
              <a href="#gm-02-overview" class="btn btn-primary" aria-label="بازگشت به پیشخوان راهبری">بازگشت به پیشخوان</a>
            </div>
          </div>
        `;
      }
    }

    this.compactLinks(mainContent);

    // Publish route change through Resilient Event Bus
    if (window.GMEventBus && typeof window.GMEventBus.emit === 'function') {
      window.GMEventBus.emit('gm:route-changed', {
        route: this.currentRoute,
        view: effectiveViewName,
        params
      });
    }

    if (window.GMApp && typeof window.GMApp.applyPageNavigationContext === 'function') {
      window.GMApp.applyPageNavigationContext(effectiveViewName);
    }
    window.scrollTo(0, 0);

    // Tab Overflow Resilience & Active Tab Auto-Scroll (GODMODE.MD §20.5)
    setTimeout(() => {
      const activeTab = mainContent.querySelector('.nav-tabs .active, .hub-tabs-bar .active, .tab-link.active, .dossier-tab-btn.active');
      if (activeTab && typeof activeTab.scrollIntoView === 'function') {
        try { activeTab.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'auto' }); } catch (e) {}
      }
    }, 40);

    // Accessibility: Focus management on route change & route narration (WCAG 2.4.3 & 4.1.3)
    const pageHeading = mainContent.querySelector('h1') || mainContent;
    if (pageHeading) {
      if (!pageHeading.hasAttribute('tabindex')) {
        pageHeading.setAttribute('tabindex', '-1');
      }
      try {
        pageHeading.focus({ preventScroll: true });
      } catch (e) {}

      const announcer = document.getElementById('route-announcer');
      if (announcer) {
        const titleText = pageHeading.innerText ? pageHeading.innerText.replace(/\s+/g, ' ').trim() : this.currentRoute;
        announcer.textContent = `صفحه ${titleText} بارگذاری شد.`;
      }
    }
  },

  refresh() {
    this.handleRoute();
  },

  navigate(hash) {
    window.location.hash = this.compactHash(hash);
  }
};
