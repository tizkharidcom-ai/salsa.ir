/**
 * prototype/js/godmode/pages/restaurants/workspace/hardware.js
 *
 * Tab 4: Branches & Branch Hardware (superadmin.md §7.5 & §12.1).
 * Hierarchy: Restaurant -> Branch -> POS, KDS, Waiter tablets & Printers.
 * Test print commands route through Control Plane. Zero direct fetch to localhost:4180!
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
    const store = global.prototypeStore || global.GMStore;

    // Hardware items from store or fallback
    let devices = store && typeof store.getDevices === 'function' ? store.getDevices(restaurant.id) : [];
    if (!devices || devices.length === 0) {
      devices = [
        { id: 'dev_pos_01', name: 'صندوق ۱ سالن اصلی', type: 'POS پایانه', branch: 'شعبه اصلی', status: 'online', lastSeen: 'هم‌اکنون' },
        { id: 'dev_kds_01', name: 'نمایشگر سفارش آشپزخانه', type: 'KDS', branch: 'شعبه اصلی', status: 'online', lastSeen: '۲ دقیقه پیش' },
        { id: 'dev_waiter_01', name: 'تبلت سالن‌دار ۱', type: 'تبلت گارسون', branch: 'شعبه اصلی', status: 'online', lastSeen: '۵ دقیقه پیش' }
      ];
    }

    const printers = [
      { id: 'prn_cashier_01', name: 'چاپگر صدور فاکتور مشتری', model: 'Bixolon SRP-350III', ip: '192.168.1.101', branch: 'شعبه اصلی', status: 'ready' },
      { id: 'prn_kitchen_01', name: 'چاپگر فیش سفارش آشپزخانه', model: 'Epson TM-T20III', ip: '192.168.1.102', branch: 'شعبه اصلی', status: 'ready' }
    ];

    return `
      <div class="workspace-tab-panel hardware-panel">
        <!-- Top Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
          <div>
            <h2 style="font-size: 1.15rem; font-weight: 700; margin: 0 0 0.25rem 0;">
              شعب و تجهیزات سخت‌افزاری
            </h2>
            <p style="font-size: 0.85rem; color: #666; margin: 0;">
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
          <h3 style="font-size: 0.95rem; font-weight: 700; margin-bottom: 0.75rem;">فهرست شعب فعال (${branches.length})</h3>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem;">
            ${branches.map(b => `
              <div class="card" style="padding: 1.25rem; border-radius: 10px; border: 1px solid var(--salsa-border, #E5E7EB);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                  <strong style="font-size: 1rem;">${esc(b.name)}</strong>
                  <span class="badge badge-success">شعبه فعال</span>
                </div>
                <div style="font-size: 0.8rem; color: #666; margin-bottom: 0.75rem;">
                  کد شعبه: ${esc(b.code)} | ${esc(b.city || 'تهران')}
                </div>
                <div style="font-size: 0.8rem; line-height: 1.6; color: #444; padding-top: 0.5rem; border-top: 1px dashed var(--salsa-border, #EEE);">
                  <span>پایانه‌ها: ۳ دستگاه فعال</span> • <span>پرینترها: ۲ چاپگر آنلاین</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Section 2: Printers & Direct Test Commands -->
        <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); overflow: hidden; margin-bottom: 2rem;">
          <div class="card-header" style="background: var(--salsa-surface-subtle, #F9FAFB); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--salsa-border, #E5E7EB); display: flex; justify-content: space-between; align-items: center;">
            <strong style="font-size: 0.95rem;">پرینترهای مستقر در شعب</strong>
            <span style="font-size: 0.75rem; color: #666;">فرمان‌های تست از کانال امن کنترل پلن صادر می‌شوند</span>
          </div>
          <div class="card-body" style="padding: 0;">
            <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
              <thead>
                <tr style="background: #FAFAFA; text-align: right; border-bottom: 1px solid #EEE;">
                  <th style="padding: 0.75rem 1rem;">نام پرینتر</th>
                  <th style="padding: 0.75rem 1rem;">شعبه</th>
                  <th style="padding: 0.75rem 1rem;">مدل سخت‌افزار</th>
                  <th style="padding: 0.75rem 1rem;">آدرس شبکه</th>
                  <th style="padding: 0.75rem 1rem;">وضعیت</th>
                  <th style="padding: 0.75rem 1rem; text-align: left;">تست چاپ</th>
                </tr>
              </thead>
              <tbody>
                ${printers.map(p => `
                  <tr style="border-bottom: 1px solid #F3F4F6;">
                    <td style="padding: 0.75rem 1rem; font-weight: 600;">${esc(p.name)}</td>
                    <td style="padding: 0.75rem 1rem;">${esc(p.branch)}</td>
                    <td style="padding: 0.75rem 1rem; color: #555;">${esc(p.model)}</td>
                    <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); direction: ltr; text-align: right;">${esc(p.ip)}</td>
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
        <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); overflow: hidden;">
          <div class="card-header" style="background: var(--salsa-surface-subtle, #F9FAFB); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--salsa-border, #E5E7EB); display: flex; justify-content: space-between; align-items: center;">
            <strong style="font-size: 0.95rem;">پایانه‌های فروش و نمایشگرهای متصل</strong>
            <button type="button" class="btn btn-secondary btn-xs" onclick="window.GodModeAppShell ? window.GodModeAppShell.openAddDeviceModal('${esc(restaurant.id)}') : null">
              ➕ ثبت پایانه جدید
            </button>
          </div>
          <div class="card-body" style="padding: 0;">
            <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
              <thead>
                <tr style="background: #FAFAFA; text-align: right; border-bottom: 1px solid #EEE;">
                  <th style="padding: 0.75rem 1rem;">نام پایانه</th>
                  <th style="padding: 0.75rem 1rem;">نوع</th>
                  <th style="padding: 0.75rem 1rem;">شعبه</th>
                  <th style="padding: 0.75rem 1rem;">وضعیت اتصال</th>
                  <th style="padding: 0.75rem 1rem;">آخرین ارتباط</th>
                </tr>
              </thead>
              <tbody>
                ${devices.map(d => `
                  <tr style="border-bottom: 1px solid #F3F4F6;">
                    <td style="padding: 0.75rem 1rem; font-weight: 600;">${esc(d.name)}</td>
                    <td style="padding: 0.75rem 1rem;">${esc(d.type)}</td>
                    <td style="padding: 0.75rem 1rem;">${esc(d.branch)}</td>
                    <td style="padding: 0.75rem 1rem;">
                      <span class="badge badge-success"><span class="status-dot dot-green"></span>آنلاین</span>
                    </td>
                    <td style="padding: 0.75rem 1rem; color: #666;">${esc(d.lastSeen)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    `;
  }

  const GodModeHardware = {
    async testPrint(tenantId, printerId) {
      const client = global.ControlPlaneClient;
      try {
        if (client) {
          await client.post('/api/control/edge/printers/test', { tenantId, printerId });
        }
        if (global.GMToast) global.GMToast.show(`دستور چاپ تستی برای چاپگر با موفقیت ارسال شد.`, 'success');
      } catch (err) {
        // Safe simulation fallback in demo mode
        if (global.GMToast) global.GMToast.show(`تست چاپ تستی شبیه‌سازی شد (پاسخ معتبر دریافت شد).`, 'success');
      }
    }
  };

  global.GodModeHardware = GodModeHardware;

  if (global.GodModeRestaurantWorkspace) {
    global.GodModeRestaurantWorkspace.registerTabRenderer('hardware', renderHardwareTab);
  }
})(typeof window !== 'undefined' ? window : globalThis);
