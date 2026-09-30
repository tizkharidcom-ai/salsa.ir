/**
 * prototype/js/godmode/pages/restaurants/workspace/hardware.js
 *
 * Tab 4: Branches & Branch Hardware (superadmin.md §7.5 & §12.1).
 * Hierarchy: Restaurant -> Branch -> POS, KDS, Waiter tablets & Printers.
 * Test print commands route through Control Plane. Zero direct fetch to cell runtime.
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

  async function renderHardwareTab(restaurant, params) {
    const restRepo = global.RestaurantsRepository;
    const branches = restRepo ? await restRepo.getBranches(restaurant.id) : [];
    const opsRepo = global.OperationsRepository ? (typeof global.OperationsRepository.getInstance === 'function' ? global.OperationsRepository.getInstance() : global.OperationsRepository) : null;
    const client = global.ControlPlaneClient ? (typeof global.ControlPlaneClient.getInstance === 'function' ? global.ControlPlaneClient.getInstance() : global.ControlPlaneClient) : null;

    let devices = [];
    try {
      if (opsRepo && typeof opsRepo.getDevices === 'function') {
        devices = await opsRepo.getDevices(restaurant.id);
      } else if (client) {
        const devRes = await client.get(`/api/control/edge/devices?tenant_id=${encodeURIComponent(restaurant.id)}`, { timeoutMs: 3000 });
        if (Array.isArray(devRes?.data)) devices = devRes.data;
      }
    } catch (_) {}

    const printers = devices.filter(d => d.type === 'printer' || d.category === 'printer');

    return `
      <div class="workspace-tab-panel hardware-panel">
        <!-- Top Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
          <div>
            <h2 style="font-size: 1.15rem; font-weight: 700; margin: 0 0 0.25rem 0; color: var(--text-primary, #111);">
              شعب و تجهیزات سخت‌افزاری
            </h2>
            <p style="font-size: 0.85rem; color: var(--text-secondary, #666); margin: 0;">
              صندوق‌ها، نمایشگرهای KDS و پرینترهای متصل به تفکیک هر شعبه
            </p>
          </div>
          <div style="display: flex; gap: 0.75rem;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="window.GodModeAppShell ? window.GodModeAppShell.openAddDeviceModal('${esc(restaurant.id)}') : null">
              ➕ ثبت پایانه جدید
            </button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="window.GodModeAppShell ? window.GodModeAppShell.openAddBranchModal('${esc(restaurant.id)}') : null">
              ➕ افزودن شعبه جدید
            </button>
            <a href="#settings?section=hardware" class="btn btn-ghost btn-sm">
              کاتالوگ مدل‌های پرینتر ↗
            </a>
          </div>
        </div>

        <!-- Branches Cards -->
        <div style="margin-bottom: 2rem;">
          <h3 style="font-size: 0.95rem; font-weight: 700; margin-bottom: 0.75rem; color: var(--text-primary, #111);">فهرست شعب فعال (${branches.length})</h3>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem;">
            ${branches.map(b => `
              <div class="card" style="padding: 1.25rem; border-radius: 10px; border: 1px solid var(--border, var(--salsa-border, #E5E7EB)); background: var(--card, #FFF);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                  <strong style="font-size: 1rem; color: var(--text-primary, #111);">${esc(b.name)}</strong>
                  <span class="badge badge-success">شعبه فعال</span>
                </div>
                <div style="font-size: 0.8rem; color: var(--text-secondary, #666); margin-bottom: 0.75rem;">
                  کد شعبه: ${esc(b.code)} | ${esc(b.city || 'تهران')}
                </div>
                <div style="font-size: 0.8rem; line-height: 1.6; color: var(--text-secondary, #444); padding-top: 0.5rem; border-top: 1px dashed var(--border, var(--salsa-border, #EEE));">
                  <span>پایانه‌ها: ۳ دستگاه فعال</span> • <span>پرینترها: ۲ چاپگر آنلاین</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Section 2: Printers & Direct Test Commands -->
        <div class="card" style="border-radius: 12px; border: 1px solid var(--border, var(--salsa-border, #E5E7EB)); overflow: hidden; margin-bottom: 2rem; background: var(--card, #FFF);">
          <div class="card-header" style="background: var(--surface-2, var(--salsa-surface-subtle, #F9FAFB)); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border, var(--salsa-border, #E5E7EB)); display: flex; justify-content: space-between; align-items: center;">
            <strong style="font-size: 0.95rem; color: var(--text-primary, #111);">پرینترهای مستقر در شعب</strong>
            <span style="font-size: 0.75rem; color: var(--text-secondary, #666);">فرمان‌های تست از کانال امن کنترل پلن صادر می‌شوند</span>
          </div>
          <div class="card-body" style="padding: 0;">
            <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
              <thead>
                <tr style="background: var(--surface-2, #FAFAFA); text-align: right; border-bottom: 1px solid var(--border, #EEE);">
                  <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">نام پرینتر</th>
                  <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">شعبه</th>
                  <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">مدل سخت‌افزار</th>
                  <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">آدرس شبکه</th>
                  <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">وضعیت</th>
                  <th style="padding: 0.75rem 1rem; text-align: left; color: var(--text-secondary, #666);">تست چاپ</th>
                </tr>
              </thead>
              <tbody>
                ${printers.map(p => `
                  <tr style="border-bottom: 1px solid var(--border, #F3F4F6);">
                    <td style="padding: 0.75rem 1rem; font-weight: 600; color: var(--text-primary, #111);">${esc(p.name)}</td>
                    <td style="padding: 0.75rem 1rem; color: var(--text-secondary, #555);">${esc(p.branch)}</td>
                    <td style="padding: 0.75rem 1rem; color: var(--text-secondary, #555);">${esc(p.model)}</td>
                    <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); direction: ltr; text-align: right; color: var(--text-primary, #111);">${esc(p.ip)}</td>
                    <td style="padding: 0.75rem 1rem;">
                      <span class="badge badge-success"><span class="status-dot dot-green"></span>آماده به کار</span>
                    </td>
                    <td style="padding: 0.75rem 1rem; text-align: left;">
                      <button type="button"
                              class="btn btn-secondary btn-xs"
                              onclick="window.GodModeHardware ? window.GodModeHardware.testPrint('${esc(restaurant.id)}', '${esc(p.id)}') : null">
                        🖨 ارسال تست چاپ
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Section 3: POS & KDS Devices -->
        <div class="card" style="border-radius: 12px; border: 1px solid var(--border, var(--salsa-border, #E5E7EB)); overflow: hidden; background: var(--card, #FFF);">
          <div class="card-header" style="background: var(--surface-2, var(--salsa-surface-subtle, #F9FAFB)); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border, var(--salsa-border, #E5E7EB)); display: flex; justify-content: space-between; align-items: center;">
            <strong style="font-size: 0.95rem; color: var(--text-primary, #111);">پایانه‌های فروش و نمایشگرهای متصل</strong>
            <button type="button" class="btn btn-secondary btn-xs" onclick="window.GodModeAppShell ? window.GodModeAppShell.openAddDeviceModal('${esc(restaurant.id)}') : null">
              ➕ ثبت پایانه جدید
            </button>
          </div>
          <div class="card-body" style="padding: 0;">
            <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
              <thead>
                <tr style="background: var(--surface-2, #FAFAFA); text-align: right; border-bottom: 1px solid var(--border, #EEE);">
                  <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">نام پایانه</th>
                  <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">نوع</th>
                  <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">شعبه</th>
                  <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">وضعیت اتصال</th>
                  <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">آخرین ارتباط</th>
                </tr>
              </thead>
              <tbody>
                ${devices.length > 0 ? devices.map(d => `
                  <tr style="border-bottom: 1px solid var(--border, #F3F4F6);">
                    <td style="padding: 0.75rem 1rem; font-weight: 600; color: var(--text-primary, #111);">${esc(d.name || d.deviceName)}</td>
                    <td style="padding: 0.75rem 1rem; color: var(--text-secondary, #555);">${esc(d.type || d.deviceKind || 'POS')}</td>
                    <td style="padding: 0.75rem 1rem; color: var(--text-secondary, #555);">${esc(d.branch || d.branchId || 'شعبه اصلی')}</td>
                    <td style="padding: 0.75rem 1rem;">
                      <span class="badge ${d.status === 'online' || d.status === 'active' ? 'badge-success' : 'badge-neutral'}">
                        <span class="status-dot ${d.status === 'online' || d.status === 'active' ? 'dot-green' : 'dot-gray'}"></span>
                        ${d.status === 'online' || d.status === 'active' ? 'آنلاین' : (esc(d.status) || 'نامشخص')}
                      </span>
                    </td>
                    <td style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">${esc(d.lastSeen || d.last_seen || 'نامشخص')}</td>
                  </tr>
                `).join('') : `
                  <tr>
                    <td colspan="5" style="padding: 1.5rem; text-align: center; color: var(--text-secondary, #64748b);">
                      هیچ پایانه یا دستگاه سخت‌افزاری ثبت نشده است.
                    </td>
                  </tr>
                `}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    `;
  }

  const GodModeHardware = {
    async testPrint(tenantId, printerId) {
      const client = global.ControlPlaneClient ? (typeof global.ControlPlaneClient.getInstance === 'function' ? global.ControlPlaneClient.getInstance() : global.ControlPlaneClient) : null;
      try {
        if (client) {
          await client.post('/api/control/edge/printers/test', { tenantId, printerId });
        }
        if (global.GMToast) global.GMToast.show(`دستور چاپ تستی در صف ارسال قرار گرفت.`, 'info');
      } catch (err) {
        if (global.GMToast) global.GMToast.show(`خطا در ارسال دستور چاپ تستی: ${err.message || 'عدم دسترسی به سرویس اج'}`, 'error');
      }
    }
  };

  global.GodModeHardware = GodModeHardware;

  if (global.GodModeRestaurantWorkspace) {
    global.GodModeRestaurantWorkspace.registerTabRenderer('hardware', renderHardwareTab);
  }
})(typeof window !== 'undefined' ? window : globalThis);
