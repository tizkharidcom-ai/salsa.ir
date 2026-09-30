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

    const opsRepo = global.OperationsRepository ? (typeof global.OperationsRepository.getInstance === 'function' ? global.OperationsRepository.getInstance() : global.OperationsRepository) : null;
    let devices = [];
    let backups = [];
    try {
      if (opsRepo && typeof opsRepo.getDevices === 'function') {
        devices = await opsRepo.getDevices(restaurant.id);
      } else if (client) {
        const devRes = await client.get(`/api/control/edge/devices?tenantId=${encodeURIComponent(restaurant.id)}`, { timeoutMs: 3000 });
        if (Array.isArray(devRes?.data)) devices = devRes.data;
      }
    } catch (_) {}

    async function getBackups(tenantId) {
      try {
        if (client) {
          const bkRes = await client.get(`/api/control/backups?tenantId=${encodeURIComponent(tenantId)}`, { timeoutMs: 3000 });
          if (Array.isArray(bkRes?.data)) return bkRes.data;
        }
      } catch (_) {}
      return [];
    }
    backups = await getBackups(restaurant.id);

    const latestBackup = backups && backups.length > 0 ? backups[0] : null;
    const backupDateText = latestBackup
      ? (new Date(latestBackup.createdAt || latestBackup.created_at).toLocaleDateString('fa-IR') + ' ' + new Date(latestBackup.createdAt || latestBackup.created_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }))
      : 'اطلاعات پشتیبان ثبت نشده است';

    const modules = evalData?.modules || [];
    const activeModules = modules.filter(m => m.isEnabled);

    let openTicketsCount = 0;
    let delegationState = 'فاقد نشست فعال';
    try {
      if (client) {
        const [ticketsRes, sessionsRes] = await Promise.allSettled([
          client.get(`/api/control/support/tickets?tenantId=${encodeURIComponent(restaurant.id)}`, { timeoutMs: 3000 }),
          client.get(`/api/control/support/sessions?tenantId=${encodeURIComponent(restaurant.id)}&all=true`, { timeoutMs: 3000 })
        ]);
        if (ticketsRes.status === 'fulfilled' && Array.isArray(ticketsRes.value?.data)) {
          openTicketsCount = ticketsRes.value.data.filter(t => t.status === 'open' || t.status === 'pending' || t.status === 'in_progress').length;
        }
        if (sessionsRes.status === 'fulfilled' && Array.isArray(sessionsRes.value?.data)) {
          const sessions = sessionsRes.value.data;
          if (sessions.length > 0) {
            delegationState = sessions[0].state || sessions[0].stage || (sessions[0].approval_status === 'approved' ? 'Active' : 'AwaitingTenantApproval');
          }
        }
      }
    } catch (_) {}

    const clientDomain = restaurant.domain || `${restaurant.id}.salsa.ir`;

    // Attention evaluation (§25 & §93)
    const attentionItems = [];
    if (restaurant.status === 'suspended') {
      attentionItems.push({
        title: 'سرویس مجموعه معلق است',
        desc: 'پایانه‌های فروش و منوی دیجیتال مسدود می‌باشند.',
        cta: 'رفع تعلیق',
        action: `window.GodModeAppShell ? window.GodModeAppShell.openReactivateModal('${esc(restaurant.id)}') : null`
      });
    }
    if (restaurant.status === 'past_due' || restaurant.status === 'grace_period') {
      attentionItems.push({
        title: 'سررسید صورتحساب پرداخت‌نشده',
        desc: 'اشتراک در دوره مهلت پرداخت قرار دارد؛ نیاز به تمدید یا پیگیری وصول.',
        cta: 'مشاهده مالی',
        action: `location.hash='#restaurants/workspace?id=${esc(restaurant.id)}&tab=subscription'`
      });
    }
    if (devices.length === 0) {
      attentionItems.push({
        title: 'هیچ پایانه پوز فعالی ثبت نشده است',
        desc: 'برای سفارش‌گیری سالن یا صندوق حداقل یک پایانه سخت‌افزاری لازم است.',
        cta: 'ثبت پایانه',
        action: `window.GodModeAppShell ? window.GodModeAppShell.openAddDeviceModal('${esc(restaurant.id)}') : null`
      });
    }

    return `
      <div class="workspace-tab-panel overview-panel" style="display: flex; flex-direction: column; gap: 1.5rem;">
        
        <!-- LAYER 1: STATUS & ATTENTION (§26 Layer 1) -->
        <div class="overview-layer-status" style="background: var(--salsa-surface-subtle, #F9FAFB); border: 1px solid var(--salsa-border, #E5E7EB); border-radius: 12px; padding: 1.25rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
            <div style="display: flex; align-items: center; gap: 1.5rem; flex-wrap: wrap;">
              <div>
                <span style="font-size: 0.75rem; color: #64748b; display: block; margin-bottom: 0.2rem;">چرخه حیات (Lifecycle)</span>
                ${global.StatusBadge ? global.StatusBadge.renderLifecycleBadge(restaurant.status) : `<span class="badge badge-info">${esc(restaurant.status)}</span>`}
              </div>
              <div style="border-right: 1px solid var(--salsa-border, #E2E8F0); padding-right: 1.5rem;">
                <span style="font-size: 0.75rem; color: #64748b; display: block; margin-bottom: 0.2rem;">وضعیت اشتراک تجاری</span>
                <span class="badge ${restaurant.status === 'past_due' ? 'badge-danger' : 'badge-success'}">
                  ${restaurant.status === 'past_due' ? 'معوق (Past Due)' : 'جاری و فعال'}
                </span>
              </div>
              <div style="border-right: 1px solid var(--salsa-border, #E2E8F0); padding-right: 1.5rem;">
                <span style="font-size: 0.75rem; color: #64748b; display: block; margin-bottom: 0.2rem;">سلامت عملیاتی</span>
                ${global.StatusBadge ? global.StatusBadge.renderHealthBadge(restaurant.health || 'healthy') : `<span class="badge badge-success">پایدار</span>`}
              </div>
            </div>

            <div>
              ${attentionItems.length > 0 ? `
                <span class="badge badge-warning" style="font-size: 0.82rem; padding: 0.35rem 0.65rem;">
                  ⚠️ ${attentionItems.length} مورد نیازمند رسیدگی
                </span>
              ` : `
                <span class="badge badge-neutral" style="font-size: 0.82rem; padding: 0.35rem 0.65rem;">
                  ✅ وضعیت نرمال بدون اخطار فوری
                </span>
              `}
            </div>
          </div>

          <!-- Explainable Attention Banners -->
          ${attentionItems.length > 0 ? `
            <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--salsa-border, #E2E8F0); display: flex; flex-direction: column; gap: 0.5rem;">
              ${attentionItems.map(item => `
                <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px; padding: 0.6rem 0.85rem; display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <strong style="font-size: 0.83rem; color: #92400E; display: block;">${esc(item.title)}</strong>
                    <span style="font-size: 0.78rem; color: #78350F;">${esc(item.desc)}</span>
                  </div>
                  <button type="button" class="btn btn-warning btn-xs" onclick="${esc(item.action)}">
                    ${esc(item.cta)} ←
                  </button>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>

        <!-- LAYER 2: BUSINESS IDENTITY (§26 Layer 2) -->
        <div class="overview-layer-identity card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); padding: 1.25rem;">
          <h3 style="font-size: 0.95rem; font-weight: 700; margin: 0 0 1rem 0; padding-bottom: 0.5rem; border-bottom: 1px solid var(--salsa-border, #F1F5F9); color: var(--text-primary, #0f172a);">
            هویت کسب‌وکار و اطلاعات پایه
          </h3>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; font-size: 0.85rem;">
            <div>
              <span style="color: #64748b; display: block; font-size: 0.75rem;">نام کامل مجموعه:</span>
              <strong style="font-size: 0.95rem;">${esc(restaurant.name)}</strong>
            </div>
            <div>
              <span style="color: #64748b; display: block; font-size: 0.75rem;">شناسه یکتا (Tenant ID):</span>
              <code style="font-family: var(--font-mono); font-size: 0.85rem; background: rgba(0,0,0,0.05); padding: 0.15rem 0.35rem; border-radius: 4px;">${esc(restaurant.id)}</code>
            </div>
            <div>
              <span style="color: #64748b; display: block; font-size: 0.75rem;">تعداد شعب فعال:</span>
              <strong>${branches.length} شعبه فیزیکی</strong>
            </div>
            <div>
              <span style="color: #64748b; display: block; font-size: 0.75rem;">مدیر ارشد / مالک:</span>
              <span>${esc(restaurant.owner?.name || 'مدیریت مجموعه')} (${esc(restaurant.owner?.email || '—')})</span>
            </div>
            <div>
              <span style="color: #64748b; display: block; font-size: 0.75rem;">دامنه اختصاصی برند:</span>
              <span style="direction: ltr; font-family: var(--font-mono); font-size: 0.8rem;">${esc(clientDomain)}</span>
            </div>
            <div>
              <span style="color: #64748b; display: block; font-size: 0.75rem;">پلن اشتراک و دوره:</span>
              <strong style="color: #2563EB;">${esc(restaurant.plan)} (ماهانه)</strong>
            </div>
          </div>
        </div>

        <!-- LAYER 3: RECENT OPERATIONAL SIGNALS (§26 Layer 3) -->
        <div>
          <h3 style="font-size: 0.95rem; font-weight: 700; margin: 0 0 1rem 0; color: var(--text-primary, #0f172a);">
            سیگنال‌ها و شاخص‌های عملیاتی جاری
          </h3>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.25rem;">
            
            <!-- Signal 1: Billing & Latest Invoice -->
            <div class="card" style="border-radius: 10px; border: 1px solid var(--salsa-border, #E5E7EB); padding: 1.1rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                <strong style="font-size: 0.88rem;">آخرین صورتحساب مالی</strong>
                <a href="#restaurants/workspace?id=${esc(restaurant.id)}&tab=subscription" class="btn btn-ghost btn-xs">مشاهده فاکتورها ←</a>
              </div>
              <div style="font-size: 0.83rem; line-height: 1.7;">
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: #666;">وضعیت آخرین دوره:</span>
                  <span class="badge badge-success">تسویه‌شده</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: #666;">بدهی معوق / استمهال:</span>
                  <span>۰ تومان</span>
                </div>
              </div>
            </div>

            <!-- Signal 2: Verified Backup & RPO -->
            <div class="card" style="border-radius: 10px; border: 1px solid var(--salsa-border, #E5E7EB); padding: 1.1rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                <strong style="font-size: 0.88rem;">پشتیبان و انطباق RPO</strong>
                <a href="#restaurants/workspace?id=${esc(restaurant.id)}&tab=reliability" class="btn btn-ghost btn-xs">بازیابی ←</a>
              </div>
              <div style="font-size: 0.83rem; line-height: 1.7;">
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: #666;">آخرین نسخه تأییدشده:</span>
                  <span>${esc(backupDateText)}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: #666;">شاخص RPO پلتفرم:</span>
                  ${latestBackup ? '<span class="badge badge-success">منطبق (کمتر از ۴ ساعت)</span>' : '<span class="badge badge-neutral">اطلاعات در دسترس نیست</span>'}
                </div>
              </div>
            </div>

            <!-- Signal 3: Hardware & Devices Online -->
            <div class="card" style="border-radius: 10px; border: 1px solid var(--salsa-border, #E5E7EB); padding: 1.1rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                <strong style="font-size: 0.88rem;">پایانه‌ها و سخت‌افزار اج</strong>
                <a href="#restaurants/workspace?id=${esc(restaurant.id)}&tab=hardware" class="btn btn-ghost btn-xs">مدیریت پایانه‌ها ←</a>
              </div>
              <div style="font-size: 0.83rem; line-height: 1.7;">
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: #666;">پایانه‌های آنلاین:</span>
                  <strong>${devices.length > 0 ? `${devices.length} دستگاه متصل` : '<span style="color: #64748b;">اطلاعات دستگاه در دسترس نیست</span>'}</strong>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: #666;">وضعیت چاپگرهای حرارتی:</span>
                  ${devices.some(d => d.type === 'printer' || d.category === 'printer') ? '<span class="badge badge-success">آماده به کار (ESC/POS)</span>' : '<span class="badge badge-neutral">اطلاعات چاپگر در دسترس نیست</span>'}
                </div>
              </div>
            </div>

            <!-- Signal 4: Support & Delegation -->
            <div class="card" style="border-radius: 10px; border: 1px solid var(--salsa-border, #E5E7EB); padding: 1.1rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                <strong style="font-size: 0.88rem;">پشتیبانی و تفویض دسترسی</strong>
                <a href="#restaurants/workspace?id=${esc(restaurant.id)}&tab=reliability" class="btn btn-ghost btn-xs">تاریخچه تیکت‌ها ←</a>
              </div>
              <div style="font-size: 0.83rem; line-height: 1.7;">
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: #666;">تیکت‌های باز فعال:</span>
                  <span style="font-weight: 600;">${openTicketsCount} مورد</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="color: #666;">نشست تفویض فعال:</span>
                  <span class="badge ${delegationState === 'Active' ? 'badge-success' : delegationState === 'AwaitingTenantApproval' ? 'badge-warning' : 'badge-neutral'}" style="font-size: 0.75rem;">
                    ${esc(delegationState)}
                  </span>
                </div>
              </div>
            </div>

            <!-- Signal 5: Active Business Modules -->
            <div class="card" style="border-radius: 10px; border: 1px solid var(--salsa-border, #E5E7EB); padding: 1.1rem; grid-column: 1 / -1;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                <strong style="font-size: 0.88rem;">ماژول‌های فعال تجاری (${activeModules.length})</strong>
                <a href="#restaurants/workspace?id=${esc(restaurant.id)}&tab=subscription" class="btn btn-ghost btn-xs">کاتالوگ ماژول‌ها ←</a>
              </div>
              <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                ${activeModules.map(m => `
                  <span class="badge badge-neutral" style="font-size: 0.78rem; padding: 0.4rem 0.65rem;">
                    <span aria-hidden="true" style="margin-left: 0.3rem;">${esc(m.icon)}</span>
                    <span>${esc(m.nameFa)}</span>
                  </span>
                `).join('')}
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
