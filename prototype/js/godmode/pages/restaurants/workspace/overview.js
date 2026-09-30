/**
 * prototype/js/godmode/pages/restaurants/workspace/overview.js
 *
 * Tab 1: Restaurant Overview (superadmin.md §7.2).
 * 30-second understanding of restaurant status:
 *   - Setup checklist & Readiness
 *   - Subscription & billing summary
 *   - Active business modules
 *   - Branches & key hardware
 *   - Open support incidents
 *   - Domain & portal status
 *   - Backup summary
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

  async function renderOverviewTab(restaurant, params) {
    const entitlementsRepo = global.EntitlementsRepository;
    const restRepo = global.RestaurantsRepository;

    let evalData = null;
    let branches = [];
    try {
      if (entitlementsRepo) {
        evalData = await entitlementsRepo.calculateEffectiveEntitlements(restaurant.id);
      }
      if (restRepo) {
        branches = await restRepo.getBranches(restaurant.id);
      }
    } catch (_) {}

    const store = global.prototypeStore || global.GMStore;
    const devices = store && typeof store.getDevices === 'function' ? store.getDevices(restaurant.id) : [];
    const backups = store && typeof store.getBackups === 'function' ? store.getBackups(restaurant.id) : [];
    const latestBackup = backups && backups.length > 0 ? backups[0] : null;
    const backupDateText = latestBackup
      ? (new Date(latestBackup.createdAt).toLocaleDateString('fa-IR') + ' ' + new Date(latestBackup.createdAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }))
      : 'امروز، ساعت ۰۴:۰۰';

    const modules = evalData?.modules || [];
    const activeModules = modules.filter(m => m.isEnabled);

    const clientDomain = restaurant.domain || `${restaurant.id}.salsa.ir`;

    return `
      <div class="workspace-tab-panel overview-panel">
        <!-- 3-Column Cards Grid -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem;">
          
          <!-- Card 1: Subscription & Billing Summary -->
          <div class="card" style="border-radius: 10px; border: 1px solid var(--salsa-border, #E5E7EB); padding: 1.25rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <strong style="font-size: 0.95rem;">اشتراک و وضعیت حساب</strong>
              <a href="#restaurants/workspace?id=${esc(restaurant.id)}&tab=subscription" class="btn btn-ghost btn-xs">مدیریت ←</a>
            </div>
            <div style="font-size: 0.85rem; line-height: 1.8;">
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #666;">پلن فعال:</span>
                <strong>${esc(restaurant.plan)}</strong>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #666;">دوره تسویه:</span>
                <span>ماهانه (سررسید ۱ ماه دیگر)</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #666;">وضعیت مالی:</span>
                <span class="badge badge-success">تسویه‌شده (جاری)</span>
              </div>
            </div>
          </div>

          <!-- Card 2: Active Business Modules -->
          <div class="card" style="border-radius: 10px; border: 1px solid var(--salsa-border, #E5E7EB); padding: 1.25rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <strong style="font-size: 0.95rem;">ماژول‌های فعال (${activeModules.length})</strong>
              <a href="#restaurants/workspace?id=${esc(restaurant.id)}&tab=subscription" class="btn btn-ghost btn-xs">همه ماژول‌ها ←</a>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
              ${activeModules.slice(0, 6).map(m => `
                <span class="badge badge-neutral" style="font-size: 0.75rem; padding: 0.35rem 0.6rem;">
                  <span aria-hidden="true" style="margin-left: 0.25rem;">${esc(m.icon)}</span>
                  <span>${esc(m.nameFa.split(' ')[0])}</span>
                </span>
              `).join('')}
              ${activeModules.length > 6 ? `<span class="badge badge-neutral" style="font-size: 0.75rem;">+${activeModules.length - 6} ماژول دیگر</span>` : ''}
            </div>
          </div>

          <!-- Card 3: Branches & Key Hardware -->
          <div class="card" style="border-radius: 10px; border: 1px solid var(--salsa-border, #E5E7EB); padding: 1.25rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <strong style="font-size: 0.95rem;">شعب و پایانه‌ها</strong>
              <a href="#restaurants/workspace?id=${esc(restaurant.id)}&tab=hardware" class="btn btn-ghost btn-xs">مدیریت ←</a>
            </div>
            <div style="font-size: 0.85rem; line-height: 1.8;">
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #666;">تعداد شعبه فعال:</span>
                <strong>${branches.length} شعبه</strong>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #666;">صندوق‌ها و تجهیزات:</span>
                <span>${devices.length > 0 ? `${devices.length} پایانه ثبت‌شده` : '۳ دستگاه فعال (پیش‌فرض)'}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #666;">پرینترهای سالن و آشپزخانه:</span>
                <span>۲ پرینتر آنلاین</span>
              </div>
            </div>
          </div>

          <!-- Card 4: Channels & Public Domain -->
          <div class="card" style="border-radius: 10px; border: 1px solid var(--salsa-border, #E5E7EB); padding: 1.25rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <strong style="font-size: 0.95rem;">درگاه عمومی و دامنه</strong>
              <a href="#restaurants/workspace?id=${esc(restaurant.id)}&tab=channels" class="btn btn-ghost btn-xs">تنظیمات ←</a>
            </div>
            <div style="font-size: 0.85rem; line-height: 1.8;">
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #666;">دامنه پیش‌فرض:</span>
                <span style="direction: ltr; font-family: var(--font-mono); font-size: 0.8rem;">${esc(clientDomain)}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #666;">گواهی امنیتی SSL:</span>
                <span class="badge badge-success" style="font-size: 0.75rem;">فعال و معتبر</span>
              </div>
            </div>
          </div>

          <!-- Card 5: Reliability & Backups -->
          <div class="card" style="border-radius: 10px; border: 1px solid var(--salsa-border, #E5E7EB); padding: 1.25rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <strong style="font-size: 0.95rem;">پشتیبان‌گیری و تداوم</strong>
              <a href="#restaurants/workspace?id=${esc(restaurant.id)}&tab=reliability" class="btn btn-ghost btn-xs">مشاهده ←</a>
            </div>
            <div style="font-size: 0.85rem; line-height: 1.8;">
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #666;">آخرین نسخه پشتیبان:</span>
                <span>${esc(backupDateText)}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #666;">وضعیت بررسی سلامت بکاپ:</span>
                <span class="badge badge-success" style="font-size: 0.75rem;">تأییدشده (${backups.length > 0 ? `${backups.length} نسخه` : 'سیستمی'})</span>
              </div>
            </div>
          </div>

          <!-- Card 6: Support & Assistance -->
          <div class="card" style="border-radius: 10px; border: 1px solid var(--salsa-border, #E5E7EB); padding: 1.25rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <strong style="font-size: 0.95rem;">پشتیبانی و تیکت‌ها</strong>
              <a href="#restaurants/workspace?id=${esc(restaurant.id)}&tab=reliability" class="btn btn-ghost btn-xs">تیکت‌ها ←</a>
            </div>
            <div style="font-size: 0.85rem; line-height: 1.8;">
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #666;">تیکت‌های باز:</span>
                <span>۰ تیکت نیازمند اقدام</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #666;">نشست تفویض فعال:</span>
                <span style="color: #888;">هیچ نشستی فعال نیست</span>
              </div>
            </div>
          </div>

        </div>
      </div>
    `;
  }

  if (global.GodModeRestaurantWorkspace) {
    global.GodModeRestaurantWorkspace.registerTabRenderer('overview', renderOverviewTab);
  }
})(typeof window !== 'undefined' ? window : globalThis);
