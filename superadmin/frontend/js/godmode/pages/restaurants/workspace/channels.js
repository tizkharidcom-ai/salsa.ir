/**
 * prototype/js/godmode/pages/restaurants/workspace/channels.js
 *
 * Tab 5: Channels & Brand Settings (superadmin.md §7.6 & §12.2).
 * Unifies Domain configuration, TLS/SSL certificate status, customer portal and branding.
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

  async function renderChannelsTab(restaurant, params) {
    const client = global.ControlPlaneClient ? (typeof global.ControlPlaneClient.getInstance === 'function' ? global.ControlPlaneClient.getInstance() : global.ControlPlaneClient) : null;
    let liveDomains = [];
    try {
      if (client) {
        const domRes = await client.get(`/api/control/infra/domains/${encodeURIComponent(restaurant.id)}`, { timeoutMs: 3000 });
        if (Array.isArray(domRes?.data)) liveDomains = domRes.data;
      }
    } catch (_) {}

    const defaultDomain = `${restaurant.id}.salsa.ir`;

    const customDomains = new Set();
    if (restaurant.domain && restaurant.domain !== defaultDomain) {
      customDomains.add(restaurant.domain);
    }
    if (Array.isArray(liveDomains)) {
      liveDomains.forEach(d => {
        const domainName = typeof d === 'string' ? d : (d?.domain || d?.hostname);
        if (domainName && domainName !== defaultDomain) customDomains.add(domainName);
      });
    }
    if (Array.isArray(restaurant.domains)) {
      restaurant.domains.forEach(d => {
        if (d && d !== defaultDomain) customDomains.add(d);
      });
    }
    const customDomainList = Array.from(customDomains);
    const primaryActiveDomain = customDomainList[0] || defaultDomain;
    const portalUrl = `http://${primaryActiveDomain}/`;

    return `
      <div class="workspace-tab-panel channels-panel">
        <!-- Top Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
          <div>
            <h2 style="font-size: 1.15rem; font-weight: 700; margin: 0 0 0.25rem 0; color: var(--text-primary, #111);">
              کانال‌های فروش آنلاین و دامنه‌ها
            </h2>
            <p style="font-size: 0.85rem; color: var(--text-secondary, #666); margin: 0;">
              دامنه‌های اختصاصی، گواهی امنیتی SSL و درگاه عمومی مشتریان
            </p>
          </div>
          <div>
            <button type="button" class="btn btn-primary btn-sm" onclick="window.GodModeAppShell ? window.GodModeAppShell.openAddDomainModal('${esc(restaurant.id)}') : null">
              ➕ اتصال دامنه اختصاصی جدید
            </button>
          </div>
        </div>

        <!-- Section 1: Primary Domains Card -->
        <div class="card" style="border-radius: 12px; border: 1px solid var(--border, var(--salsa-border, #E5E7EB)); overflow: hidden; margin-bottom: 2rem;">
          <div class="card-header" style="background: var(--surface-2, var(--salsa-surface-subtle, #F9FAFB)); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border, var(--salsa-border, #E5E7EB)); display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <strong style="font-size: 0.95rem; color: var(--text-primary, #111);">دامنه‌های متصل و فعال</strong>
              <span class="badge badge-neutral" style="font-size: 0.75rem;">${1 + customDomainList.length} دامنه</span>
            </div>
            <span style="font-size: 0.8rem; color: var(--text-secondary, #666);">پراکسی معکوس Edge Router با مسیریابی ایزوله</span>
          </div>
          <div class="card-body" style="padding: 0; background: var(--card, #FFF);">
            <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
              <thead>
                <tr style="background: var(--surface-2, #FAFAFA); text-align: right; border-bottom: 1px solid var(--border, #EEE);">
                  <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">نام دامنه</th>
                  <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">نوع پیکربندی</th>
                  <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">وضعیت DNS</th>
                  <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">گواهی امنیتی (SSL/TLS)</th>
                  <th style="padding: 0.75rem 1rem; text-align: left; color: var(--text-secondary, #666);">اقدام</th>
                </tr>
              </thead>
              <tbody>
                <tr style="border-bottom: 1px solid var(--border, #F3F4F6);">
                  <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 600; direction: ltr; text-align: right; color: var(--text-primary, #111);">
                    ${esc(defaultDomain)}
                  </td>
                  <td style="padding: 0.75rem 1rem; color: var(--text-secondary, #555);">زیردامنه ابری سالسا (پیش‌فرض)</td>
                  <td style="padding: 0.75rem 1rem;">
                    <span class="badge badge-success">متصل و فعال</span>
                  </td>
                  <td style="padding: 0.75rem 1rem;">
                    <span class="badge badge-success">Let's Encrypt Wildcard</span>
                  </td>
                  <td style="padding: 0.75rem 1rem; text-align: left;">
                    <a href="http://${esc(defaultDomain)}/" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-xs">
                      مشاهده درگاه ↗
                    </a>
                  </td>
                </tr>
                ${customDomainList.map(dom => `
                  <tr style="border-bottom: 1px solid var(--border, #F3F4F6);">
                    <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 600; direction: ltr; text-align: right; color: var(--text-primary, #111);">
                      ${esc(dom)}
                    </td>
                    <td style="padding: 0.75rem 1rem; color: var(--text-secondary, #555);">دامنه اختصاصی (CNAME)</td>
                    <td style="padding: 0.75rem 1rem;">
                      <span class="badge badge-success">CNAME تأییدشده</span>
                    </td>
                    <td style="padding: 0.75rem 1rem;">
                      <span class="badge badge-success">خودکار (TLS 1.3)</span>
                    </td>
                    <td style="padding: 0.75rem 1rem; text-align: left;">
                      <a href="http://${esc(dom)}/" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-xs">
                        مشاهده درگاه ↗
                      </a>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Section 2: QR Code and Customer Destination -->
        <div class="card" style="border-radius: 12px; border: 1px solid var(--border, var(--salsa-border, #E5E7EB)); padding: 1.5rem; background: var(--card, #FFF);">
          <h3 style="font-size: 1rem; font-weight: 700; margin-top: 0; margin-bottom: 0.5rem; color: var(--text-primary, #111);">کدهای QR و منوی سر میز</h3>
          <p style="font-size: 0.85rem; color: var(--text-secondary, #666); margin-bottom: 1.25rem;">
            آدرس مقصد پیش‌فرض برای بارکدهای QR نصب‌شده سر میزهای رستوران:
          </p>
          <div style="background: var(--surface-2, var(--salsa-surface-subtle, #F9FAFB)); padding: 0.85rem 1.25rem; border-radius: 8px; font-family: var(--font-mono); font-size: 0.9rem; direction: ltr; display: flex; justify-content: space-between; align-items: center; color: var(--text-primary, #111);">
            <span>${esc(portalUrl)}?table=TABLE_ID</span>
            <button type="button" class="btn btn-secondary btn-xs" onclick="navigator.clipboard ? navigator.clipboard.writeText('${esc(portalUrl)}').then(() => window.GMToast ? window.GMToast.show('لینک درگاه در کلیپ‌بورد کپی شد.', 'success') : null) : prompt('کپی لینک:', '${esc(portalUrl)}')">
              کپی لینک پایه
            </button>
          </div>
        </div>

      </div>
    `;
  }

  if (global.GodModeRestaurantWorkspace) {
    global.GodModeRestaurantWorkspace.registerTabRenderer('channels', renderChannelsTab);
  }
})(typeof window !== 'undefined' ? window : globalThis);
