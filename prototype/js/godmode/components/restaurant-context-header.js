/**
 * prototype/js/godmode/components/restaurant-context-header.js
 *
 * Persistent Context Header for Restaurant Workspace (superadmin.md §7.1).
 * Preserves restaurant identity, lifecycle, health, plan, and primary actions
 * across all 7 workspace tabs without losing context.
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

  function renderRestaurantContextHeader(restaurant, activeTabId = 'overview') {
    if (!restaurant) return '';

    const StatusBadge = global.StatusBadge;
    const SourceState = global.SourceState;

    const lifecycleHtml = StatusBadge ? StatusBadge.renderLifecycleBadge(restaurant.status) : '';
    const healthHtml = StatusBadge ? StatusBadge.renderHealthBadge(restaurant.health) : '';

    const timeRelative = SourceState ? SourceState.formatRelativeTime(restaurant.lastObservedAt) : 'هم‌اکنون';

    const clientDomain = restaurant.domain || `${restaurant.id}.salsa.ir`;
    // Clean admin link resolving to tenant admin URL
    const adminUrl = `http://${clientDomain}/admin.html`;

    const isSuspended = restaurant.status === 'suspended';

    return `
      <div class="restaurant-context-header" data-tenant-id="${esc(restaurant.id)}">
        <div class="context-top-row">
          <div class="context-identity">
            <div class="restaurant-logo-placeholder" aria-hidden="true">
              ${esc(restaurant.name.slice(0, 2))}
            </div>
            <div class="identity-text">
              <div class="identity-name-row">
                <h1 class="restaurant-title">${esc(restaurant.name)}</h1>
                <div class="badges-row status-badge-row status-badge">
                  ${lifecycleHtml}
                  ${healthHtml}
                </div>
              </div>
              <div class="identity-meta-row">
                <span class="meta-item">
                  <span class="meta-label">پلن:</span>
                  <strong>${esc(restaurant.plan)}</strong>
                </span>
                <span class="meta-separator">•</span>
                <span class="meta-item">
                  <span class="meta-label">شعب:</span>
                  <strong>${esc(restaurant.branchCount)} شعبه</strong>
                </span>
                <span class="meta-separator">•</span>
                <span class="meta-item">
                  <span class="meta-label">مدیر:</span>
                  <span>${esc(restaurant.owner?.name || '—')}</span>
                </span>
                <span class="meta-separator">•</span>
                <span class="meta-item" title="${esc(restaurant.lastObservedAt)}">
                  <span class="meta-label">آخرین پایش:</span>
                  <span>${esc(timeRelative)}</span>
                </span>
              </div>
            </div>
          </div>

          <div class="context-actions">
            <!-- Primary Action: Open Tenant Admin -->
            <a href="${esc(adminUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary" title="ورود مستقیم به پنل مدیریت داخلی رستوران">
              <span>ورود به پنل رستوران</span>
              <span aria-hidden="true">↗</span>
            </a>

            <!-- More Actions Dropdown -->
            <div class="action-dropdown" style="position: relative; display: inline-block;">
              <button type="button" class="btn btn-secondary btn-icon-only" id="btn-restaurant-more" onclick="window.GodModeAppShell ? window.GodModeAppShell.toggleRestaurantActionMenu(event) : null" aria-label="اقدام‌های بیشتر و مدیریت سرویس" aria-haspopup="true">
                •••
              </button>
              <div class="action-dropdown-menu" id="restaurant-action-menu" style="display: none;">
                <button type="button" class="dropdown-item" onclick="window.GodModeAppShell ? window.GodModeAppShell.copyTenantId('${esc(restaurant.id)}') : null">
                  <span>کپی شناسه یکتا (${esc(restaurant.id)})</span>
                </button>
                <button type="button" class="dropdown-item" onclick="window.GodModeAppShell ? window.GodModeAppShell.openSupportDelegationModal('${esc(restaurant.id)}') : null">
                  <span>تفویض دسترسی پشتیبانی (زمان‌دار)</span>
                </button>
                <div class="dropdown-divider"></div>
                ${isSuspended ? `
                  <button type="button" class="dropdown-item text-success" onclick="window.GodModeAppShell ? window.GodModeAppShell.openReactivateModal('${esc(restaurant.id)}') : null">
                    <span>رفع تعلیق و فعال‌سازی سرویس</span>
                  </button>
                ` : `
                  <button type="button" class="dropdown-item text-danger" onclick="window.GodModeAppShell ? window.GodModeAppShell.openSuspendModal('${esc(restaurant.id)}') : null">
                    <span>تعلیق سرویس رستوران…</span>
                  </button>
                `}
              </div>
            </div>
          </div>
        </div>

        ${restaurant.attentionReason ? `
          <div class="context-attention-alert" role="alert">
            <span class="alert-icon" aria-hidden="true">⚠️</span>
            <span>${esc(restaurant.attentionReason)}</span>
          </div>
        ` : ''}

        <!-- Persistent 7 Tabs Navigation -->
        <nav class="restaurant-workspace-tabs" role="tablist" aria-label="بخش‌های پرونده رستوران">
          ${(global.GodModeRegistry?.RESTAURANT_WORKSPACE_TABS || []).map(tab => {
            const isActive = tab.id === activeTabId;
            return `
              <a href="#restaurants/workspace?id=${esc(restaurant.id)}&tab=${esc(tab.id)}"
                 class="workspace-tab-btn ${isActive ? 'active' : ''}"
                 role="tab"
                 aria-selected="${isActive}"
                 aria-current="${isActive ? 'page' : 'false'}"
                 title="${esc(tab.purpose)}">
                <span class="tab-icon" aria-hidden="true">${esc(tab.icon)}</span>
                <span class="tab-label">${esc(tab.labelFa)}</span>
              </a>
            `;
          }).join('')}
        </nav>
      </div>
    `;
  }

  global.RestaurantContextHeader = Object.freeze({
    render: renderRestaurantContextHeader
  });
})(typeof window !== 'undefined' ? window : globalThis);
