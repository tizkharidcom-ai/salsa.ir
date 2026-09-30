/**
 * prototype/js/godmode/pages/restaurants/workspace/shell.js
 *
 * Restaurant Workspace Shell (superadmin.md §7).
 * Replaces the 1,850-line GM04 monolith with a lightweight shell.
 * Renders the persistent Context Header and delegates tab content to modular tab renderers:
 *   1. overview
 *   2. subscription
 *   3. people
 *   4. hardware
 *   5. channels
 *   6. reliability
 *   7. activity
 */

(function (global) {
  'use strict';

  const tabRenderers = new Map();

  function registerTabRenderer(tabId, rendererFn) {
    if (typeof rendererFn === 'function') {
      tabRenderers.set(tabId, rendererFn);
    }
  }

  // Drain any tab registrations that occurred before shell was initialized
  if (Array.isArray(global.__godModeTabQueue)) {
    global.__godModeTabQueue.forEach(item => {
      if (item && item.tabId && typeof item.rendererFn === 'function') {
        tabRenderers.set(item.tabId, item.rendererFn);
      }
    });
    global.__godModeTabQueue = [];
  }

  async function renderRestaurantWorkspaceShell(context = {}) {
    const { params = {}, tab = 'overview' } = context;
    const tenantId = params.id || params.tenantId || 'westo';

    const restRepo = global.RestaurantsRepository;
    if (!restRepo) {
      return '<div class="alert alert-danger">سرویس مخزن اطلاعات رستوران در دسترس نیست.</div>';
    }

    let restaurant = null;
    try {
      const res = await restRepo.getRestaurant(tenantId);
      restaurant = res.restaurant;
    } catch (err) {
      return `
        <div class="godmode-page-container">
          <div class="alert alert-danger" style="margin: 2rem 0; padding: 1.5rem;" role="alert">
            <h2>مجموعه «${tenantId}» یافت نشد</h2>
            <p>${err.message}</p>
            <a href="#restaurants" class="btn btn-secondary">بازگشت به فهرست رستوران‌ها</a>
          </div>
        </div>
      `;
    }

    const contextHeaderHtml = global.RestaurantContextHeader
      ? global.RestaurantContextHeader.render(restaurant, tab)
      : '';

    // Render active tab content
    const renderer = tabRenderers.get(tab) || tabRenderers.get('overview');
    let tabContentHtml = '';

    if (renderer) {
      try {
        tabContentHtml = await renderer(restaurant, params);
      } catch (err) {
        tabContentHtml = `
          <div class="alert alert-danger" style="margin-top: 1rem;">
            خطا در نمایش بخش ${tab}: ${err.message}
          </div>
        `;
      }
    } else {
      tabContentHtml = `
        <div class="empty-state" style="padding: 3rem; text-align: center;">
          <h3>بخش «${tab}» در دسترس نیست</h3>
          <p>ماژول مربوط به این تب بارگذاری نشده است.</p>
        </div>
      `;
    }

    return `
      <div class="godmode-page-container restaurant-workspace-container">
        <!-- Persistent Context Header -->
        ${contextHeaderHtml}

        <!-- Active Tab Panel -->
        <div class="workspace-active-panel" id="workspace-tab-content" style="margin-top: 1.5rem;">
          ${tabContentHtml}
        </div>
      </div>
    `;
  }

  global.GodModeRestaurantWorkspace = Object.freeze({
    registerTabRenderer,
    render: renderRestaurantWorkspaceShell
  });

  // Register in Router
  if (global.GodModeRouter) {
    global.GodModeRouter.registerRenderer('restaurant-workspace', renderRestaurantWorkspaceShell);
  }

  // Backward compatibility alias for legacy GM04 renderer hook
  global.renderGM04 = function (params) {
    return renderRestaurantWorkspaceShell({ params, tab: params?.tab || 'overview' });
  };
  global.renderGodModeRestaurantWorkspace = renderRestaurantWorkspaceShell;
})(typeof window !== 'undefined' ? window : globalThis);
