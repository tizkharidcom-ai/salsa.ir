/**
 * prototype/js/godmode/app/router.js
 *
 * Canonical Hash Router for SALSA God Mode (superadmin.md §17.1).
 * Driven directly by GodModeRegistry.
 * Seamlessly resolves legacy GM01-GM29 routes without breaking bookmarks or tests.
 */

(function (global) {
  'use strict';

  class GodModeRouter {
    constructor() {
      this._currentRoute = null;
      this._currentParams = {};
      this._pageRenderers = new Map();
      this._isHandling = false;
    }

    registerRenderer(pageId, rendererFn) {
      if (typeof rendererFn === 'function') {
        this._pageRenderers.set(pageId, rendererFn);
      }
    }

    init() {
      window.addEventListener('hashchange', () => this.handleRoute());
      // Handle initial route on startup
      this.handleRoute();
    }

    async handleRoute() {
      if (this._isHandling) return;
      this._isHandling = true;

      try {
        const rawHash = window.location.hash || '#home';
        const registry = global.GodModeRegistry;
        if (!registry) {
          console.warn('[GodModeRouter] GodModeRegistry not loaded yet.');
          return;
        }

        const resolved = registry.resolveHash(rawHash);
        const { page, canonicalHash, params, tab, section, isLegacy } = resolved;

        // If legacy route, silently update URL in address bar to canonical format
        if (isLegacy && window.history && typeof window.history.replaceState === 'function') {
          window.history.replaceState(null, '', canonicalHash);
        }

        this._currentRoute = page.canonicalRoute;
        this._currentParams = params;

        // Update active nav in Sidebar
        if (global.GodModeAppShell) {
          global.GodModeAppShell.renderSidebar(page.canonicalRoute);
        }

        const mainContent = document.getElementById('main-content');
        if (!mainContent) return;

        // Phase 4: Route RBAC Enforcement — Validate permissions before calling renderer
        const permissions = global.GodModePermissions;
        if (permissions && permissions.isAuthenticated()) {
          if (page.requiredRole && !permissions.hasRole(page.requiredRole)) {
            mainContent.innerHTML = `
              <div class="empty-state-container" style="padding: 4rem 2rem; text-align: center; max-width: 580px; margin: 3rem auto; background: var(--bg-card, #18181B); border-radius: 16px; border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));">
                <div style="font-size: 3rem; margin-bottom: 1rem;">🚫</div>
                <h2 style="margin-bottom: 0.5rem; color: var(--text-primary, #FAFAFA); font-size: 1.25rem;">عدم دسترسی به بخش «${page.titleFa}»</h2>
                <p style="color: var(--text-secondary, #A1A1AA); font-size: 0.9rem; line-height: 1.6; margin-bottom: 1.5rem;">
                  نقش کاربری فعلی شما (${permissions.principal?.role || 'محدود'}) مجوز دسترسی به این بخش از پلتفرم را ندارد.
                </p>
                <button class="btn btn-secondary btn-sm" onclick="location.hash='#home'" style="cursor: pointer;">بازگشت به پیشخوان پلتفرم</button>
              </div>
            `;
            return;
          }
        }

        // Check for page renderer
        const renderer = this._pageRenderers.get(page.id);
        if (renderer) {
          mainContent.innerHTML = '<div class="loading-state-container" style="padding: 3rem; text-align: center;"><span class="spinner" aria-hidden="true">⏳</span> در حال بارگذاری اطلاعات...</div>';
          try {
            const html = await renderer({ params, tab, section, page });
            mainContent.innerHTML = html;
            window.scrollTo(0, 0);

            // Announce route for screen readers (WCAG 4.1.3)
            const announcer = document.getElementById('route-announcer');
            if (announcer) {
              announcer.textContent = `صفحه ${page.titleFa} بارگذاری شد.`;
            }
          } catch (err) {
            console.error(`[GodModeRouter] Render error for page ${page.id}:`, err);
            mainContent.innerHTML = `
              <div class="alert alert-danger" style="margin: 2rem; padding: 1.5rem;" role="alert">
                <h3>خطا در نمایش صفحه ${page.titleFa}</h3>
                <p>${err.message}</p>
                <button class="btn btn-secondary btn-sm" onclick="window.GodModeRouter.handleRoute()">تلاش مجدد</button>
              </div>
            `;
          }
        } else {
          // Fallback if dedicated modular page is not registered yet: check legacy renderers
          this._renderLegacyFallback(page.id, mainContent, params);
        }
      } finally {
        this._isHandling = false;
      }
    }

    _renderLegacyFallback(pageId, container, params) {
      container.innerHTML = `
        <div class="empty-state-container" style="padding: 4rem 2rem; text-align: center;">
          <h2>بخش ${pageId} در حال آماده‌سازی است</h2>
          <p>ماژول مربوطه در حال بارگذاری است.</p>
          <a href="#home" class="btn btn-primary">بازگشت به خانه</a>
        </div>
      `;
    }

    navigate(canonicalPath, queryParams = {}) {
      const qs = new URLSearchParams(queryParams).toString();
      window.location.hash = `#${canonicalPath}${qs ? '?' + qs : ''}`;
    }

    get currentRoute() {
      return this._currentRoute;
    }

    get currentParams() {
      return this._currentParams;
    }
  }

  const GodModeRouterInstance = new GodModeRouter();
  global.GodModeRouter = GodModeRouterInstance;

  // Compatibility hook for legacy GMRouter
  if (global.GMRouter) {
    global.GMRouter.handleRoute = () => GodModeRouterInstance.handleRoute();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GodModeRouterInstance;
  }
})(typeof window !== 'undefined' ? window : globalThis);
