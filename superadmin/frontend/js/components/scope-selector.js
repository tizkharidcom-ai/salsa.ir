// prototype/js/components/scope-selector.js
// Scope Awareness & Multi-Tenant Context Management
'use strict';

const GMScopeSelector = {
  renderSelector(targetViewName) {
    return this.update(targetViewName);
  },

  onScopeChange(newTenantId) {
    return this.onChange(newTenantId);
  },

  update(targetViewName) {
    const container = document.getElementById('header-scope-wrapper');
    if (!container) return;

    const store = window.GMStore || window.prototypeStore;
    if (!store || typeof store.getTenants !== 'function') return;

    const tenants = store.getTenants();
    const activeTenantId = store.getActiveTenantId ? store.getActiveTenantId() : 'tnt_westo_demo';
    const activeTenant = store.getActiveTenant ? store.getActiveTenant() : tenants[0];
    const cellId = (activeTenant && activeTenant.cellId) || 'cell-teh-01';
    const cellLabel = ({ 'cell-teh-01': 'تهران', 'cell-msh-01': 'مشهد', 'cell-mashhad-01': 'مشهد' }[cellId] || 'مرکز عملیاتی');
    const tenantLabel = (tenant) => String(tenant?.name || 'مشتری فعال').replace(/\s*\([^)]*\)\s*$/, '');

    const currentRoute = window.GMRouter ? window.GMRouter.currentRoute : '';
    const viewName = targetViewName || (window.GMRouter && window.GMRouter.routes ? window.GMRouter.routes[currentRoute] : 'GM02');
    const isTenantScoped = window.GMRouter && typeof window.GMRouter.isTenantScoped === 'function'
      ? window.GMRouter.isTenantScoped(viewName)
      : false;

    const scopeBadgeHtml = isTenantScoped
      ? `<span class="badge badge-scope-tenant" id="header-scope-badge" title="صفحه جاری در دامنه این مشتری اختصاص یافته است"><span class="status-dot dot-active"></span> دامنه مشتری</span>`
      : `<span class="badge badge-scope-global" id="header-scope-badge" title="صفحه جاری در سطح کنترل‌پلن سراسری قرار دارد"><span class="status-dot dot-purple"></span> سراسری</span>`;

    container.innerHTML = `
      <label for="header-tenant-select" class="scope-label" title="تغییر دامنه مشتری فعال در سراسر پنل">
        <span class="scope-icon" aria-hidden="true">🏢</span>
        <span>دامنه:</span>
      </label>
      <select id="header-tenant-select" class="scope-select" onchange="window.GMApp.onScopeTenantChange(this.value)" aria-label="انتخاب مشتری سازمانی فعال">
        ${tenants.map(t => `<option value="${t.id}" ${t.id === activeTenantId ? 'selected' : ''}>${tenantLabel(t)}</option>`).join('')}
      </select>
      <span class="badge scope-cell-badge" id="header-cell-badge" title="مرکز عملیاتی (${cellId})">${cellLabel}</span>
      ${scopeBadgeHtml}
    `;
  },

  onChange(newTenantId) {
    const store = window.GMStore || window.prototypeStore;
    if (!store) return;

    const oldTenantId = store.getActiveTenantId ? store.getActiveTenantId() : '';
    if (newTenantId === oldTenantId) return;

    store.setActiveTenantId(newTenantId);
    const tenant = store.getTenant(newTenantId);
    const tenantName = tenant ? tenant.name : newTenantId;
    const cellId = (tenant && tenant.cellId) || 'cell-teh-01';

    if (window.GMApp && typeof window.GMApp.showToast === 'function') {
      window.GMApp.showToast(`دامنه فعال به «${tenantName}» [${cellId}] تغییر یافت.`, 'info', 2500, {
        activityTitle: `تغییر دامنه مشتری فعال به ${tenantName}`,
        activityDesc: `سوئیچ دامنه نظارتی به مجموعه ${tenantName} با کلاستر میزبان ${cellId}`,
        subsystem: 'Scope Context',
        severity: 'info'
      });
    }

    this.update();

    // If on a tenant-scoped route, refresh or re-navigate
    if (window.GMRouter) {
      const rawHash = window.location.hash.replace(/^#\/?/, '');
      const [routeName] = rawHash.split('?');
      const targetViewName = routeName ? window.GMRouter.routes[routeName] : 'GM02';
      if (window.GMRouter.isTenantScoped(targetViewName)) {
        if (window.location.hash.includes('?')) {
          window.location.hash = `#${routeName}?id=${newTenantId}`;
        } else {
          window.GMRouter.handleRoute();
        }
      }
    }
  }
};

if (typeof window !== 'undefined') {
  window.GMScopeSelector = GMScopeSelector;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GMScopeSelector;
  module.exports.GMScopeSelector = GMScopeSelector;
}
