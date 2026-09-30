// prototype/js/components/activity-ledger.js
// Operational Activity Ledger & History Drawer
'use strict';

const GMActivityLedger = {
  activeFilter: 'all',

  openDrawer(filter = 'all') {
    this.activeFilter = filter;
    const contentHtml = this.renderDrawerContent(filter);
    if (window.GMApp && typeof window.GMApp.openDrawer === 'function') {
      window.GMApp.openDrawer('مرکز رویدادها و تاریخچه عملیات (Activity Ledger)', contentHtml);
    }
  },

  renderDrawerContent(filter = 'all') {
    const store = (typeof window !== 'undefined' && (window.prototypeStore || window.GMStore)) || null;
    if (!store || typeof store.getActivities !== 'function') {
      return '<div class="activity-ledger-container"><p>داده‌های تاریخچه در دسترس نیست.</p></div>';
    }

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
    const unreadCount = typeof store.getUnreadActivitiesCount === 'function' ? store.getUnreadActivitiesCount() : 0;
    const allActivities = store.getActivities('all');
    const dangerCount = allActivities.filter(a => a.severity === 'danger' || a.severity === 'error' || a.severity === 'critical').length;
    const warningCount = allActivities.filter(a => a.severity === 'warning').length;
    const successCount = allActivities.filter(a => a.severity === 'success').length;

    return `
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
  },

  updateBadge() {
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
      const label = count > 0 
        ? `مرکز تاریخچه و رویدادهای عملیاتی (${count.toLocaleString('fa-IR')} رویداد خوانده‌نشده)`
        : 'مرکز تاریخچه و رویدادهای عملیاتی (تمام رویدادها خوانده شده)';
      bellBtn.setAttribute('aria-label', label);
      bellBtn.title = label;
    }
  }
};

if (typeof window !== 'undefined') {
  window.GMActivityLedger = GMActivityLedger;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GMActivityLedger;
  module.exports.GMActivityLedger = GMActivityLedger;
}
