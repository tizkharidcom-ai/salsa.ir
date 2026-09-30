/**
 * prototype/js/godmode/pages/restaurants/workspace/activity.js
 *
 * Tab 7: Human-Readable Tenant Audit & Activities (superadmin.md §7.8).
 * Scoped to current restaurant. Shows who changed what, when and why.
 * Technical JSON payload available on-demand via expandable drawer.
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

  function formatFaDate(dateVal) {
    if (!dateVal) return 'اخیراً';
    try {
      const d = new Date(dateVal);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('fa-IR') + ' ' + d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
      }
    } catch (_) {}
    return String(dateVal);
  }

  async function renderActivityTab(restaurant, params) {
    const client = global.ControlPlaneClient;
    let events = [];

    try {
      if (client) {
        const res = await client.get(`/api/control/audit?tenantId=${encodeURIComponent(restaurant.id)}&limit=20`, { timeoutMs: 3000 });
        events = res.data || [];
      }
    } catch (_) {}

    if (events.length === 0) {
      events = [
        {
          id: 'aud_init_1',
          action: 'TENANT_PROVISIONED',
          actionFa: 'راه‌اندازی اولیه و آماده‌سازی فضای پایگاه داده',
          actor_id: 'مدیر پلتفرم سالسا',
          occurred_at: restaurant.createdAt || new Date().toISOString()
        },
        {
          id: 'aud_init_2',
          action: 'PLAN_ASSIGNED',
          actionFa: `تخصیص پلن ${restaurant.plan} و ماژول‌های پیش‌فرض`,
          actor_id: 'مدیر پلتفرم سالسا',
          occurred_at: restaurant.createdAt || new Date().toISOString()
        }
      ];
    }

    return `
      <div class="workspace-tab-panel activity-panel">
        <div style="margin-bottom: 1.5rem;">
          <h2 style="font-size: 1.15rem; font-weight: 700; margin: 0 0 0.25rem 0;">
            تاریخچه رویدادها و فعالیت‌های مجموعه
          </h2>
          <p style="font-size: 0.85rem; color: #666; margin: 0;">
            گزارش ممیزی شفاف از تغییرات پلن، ماژول‌ها، تغییر وضعیت و نشست‌های پشتیبانی
          </p>
        </div>

        <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); overflow: hidden;">
          <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
            <thead>
              <tr style="background: var(--salsa-surface-subtle, #F9FAFB); text-align: right; border-bottom: 1px solid var(--salsa-border, #E5E7EB);">
                <th style="padding: 0.85rem 1rem;">شرح اقدام انجام‌شده</th>
                <th style="padding: 0.85rem 1rem;">شناسه رویداد</th>
                <th style="padding: 0.85rem 1rem;">عامل اقدام (Actor)</th>
                <th style="padding: 0.85rem 1rem;">زمان رویداد</th>
              </tr>
            </thead>
            <tbody>
              ${events.map(e => `
                <tr style="border-bottom: 1px solid var(--salsa-border, #F3F4F6);">
                  <td style="padding: 0.85rem 1rem; font-weight: 600;">
                    ${esc(e.actionFa || e.action || 'اقدام سیستمی')}
                  </td>
                  <td style="padding: 0.85rem 1rem; font-family: var(--font-mono); font-size: 0.75rem; color: #888;">
                    ${esc(e.id)}
                  </td>
                  <td style="padding: 0.85rem 1rem; color: #555;">
                    ${esc(e.actor_id || e.actorId || 'سیستم')}
                  </td>
                  <td style="padding: 0.85rem 1rem; color: #888; font-size: 0.75rem;">
                    ${formatFaDate(e.occurred_at)}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  if (global.GodModeRestaurantWorkspace) {
    global.GodModeRestaurantWorkspace.registerTabRenderer('activity', renderActivityTab);
  }
})(typeof window !== 'undefined' ? window : globalThis);
