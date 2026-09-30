/**
 * prototype/js/godmode/pages/commercial/commercial.js
 *
 * Destination 3: Commercial (Product Catalog, Plans & Fleet Billing Exceptions) (superadmin.md §3.3, §9 & §10).
 * Platform-wide commercial management:
 *   - Tab 'modules': Business Module catalog with global killswitch safeguards
 *   - Tab 'plans': Subscription plan definitions & pricing
 *   - Tab 'billing': Fleet-wide overdue accounts and exception queues
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

  function unavailablePage(message) {
    return `
      <section class="godmode-page-container commercial-page" role="status" aria-live="polite">
        <div class="card" style="max-width: 760px; margin: 2rem auto; padding: 1.5rem;">
          <h1 style="margin: 0 0 .6rem; font-size: 1.25rem;">اطلاعات عملیاتی در دسترس نیست</h1>
          <p style="margin: 0; color: var(--text-secondary, #666); line-height: 1.8;">${esc(message)}</p>
          <p style="margin: .75rem 0 0; color: var(--text-secondary, #666); line-height: 1.8;">برای جلوگیری از نمایش آمار یا انجام عملیات غیرواقعی، محتوای این بخش تا اتصال احرازشده به کنترل‌پلین پنهان است.</p>
        </div>
      </section>`;
  }

  function formatMoney(value) {
    if (value == null || value === '') return '—';
    return Number.isFinite(Number(value)) ? Number(value).toLocaleString('fa-IR') : '—';
  }

  function inOperationalMode() {
    return Boolean(global.GodModeAppMode && typeof global.GodModeAppMode.isProduction === 'function' && global.GodModeAppMode.isProduction());
  }

  function notifyUnavailableAction() {
    if (global.GMToast) global.GMToast.show('این عملیات فقط با حساب عملیاتی و اتصال احرازشده به کنترل‌پلین در دسترس است.', 'warning');
  }

  async function runCommercialAction(method, args, successMessage, tone = 'success') {
    if (!inOperationalMode()) return notifyUnavailableAction();
    const repo = global.CommercialRepository;
    if (!repo || typeof repo[method] !== 'function') {
      if (global.GMToast) global.GMToast.show('این عملیات هنوز API عملیاتی ندارد و اجرا نشد.', 'warning');
      return;
    }
    try {
      await repo[method](...args);
      if (global.GMToast) global.GMToast.show(successMessage, tone);
      if (global.GodModeRouter) global.GodModeRouter.handleRoute();
    } catch (error) {
      if (global.GMToast) global.GMToast.show(error?.message || 'عملیات در کنترل‌پلین ناموفق بود؛ تغییری تأیید نشد.', 'error');
    }
  }

  async function renderCommercialPage(context = {}) {
    const { params = {}, section = 'modules' } = context;
    const activeSection = params.section || params.tab || section || 'modules';

    const commercialRepo = global.CommercialRepository;
    const entitlementsRepo = global.EntitlementsRepository;
    const restRepo = global.RestaurantsRepository;

    if (!inOperationalMode()) {
      return unavailablePage('این نسخه محیط پیش‌نمایش ایزوله است و دادهٔ مالی یا اشتراک عملیاتی ندارد.');
    }
    if (!commercialRepo || !entitlementsRepo || !restRepo) {
      return unavailablePage('یکی از سرویس‌های دادهٔ تجاری، دسترسی ماژول‌ها یا مجموعه‌ها پیکربندی نشده است.');
    }

    let plans = [];
    let modules = [];
    let exceptions = [];
    let globalKillswitches = {};
    let restaurants = [];
    let pendingInvoices = [];
    let allInvoices = [];
    let subscriptions = [];
    let pulse = null;
    let taxSummary = null;
    let quotaMetrics = [];
    let moduleAdoptionCounts = {};

    try {
      plans = await commercialRepo.listPlans();
      exceptions = await commercialRepo.getBillingExceptions();
      globalKillswitches = await commercialRepo.getGlobalKillswitches();
      pendingInvoices = await commercialRepo.getPendingActivationInvoices();
      allInvoices = await commercialRepo.getAllInvoices();
      pulse = await commercialRepo.getCommercialPulseMetrics();
      taxSummary = await commercialRepo.getTaxSummary();
      subscriptions = await commercialRepo.listSubscriptions();
      modules = await entitlementsRepo.getBusinessModules();
      if (typeof commercialRepo.getModuleAdoptionCount === 'function') {
        const adoptionCounts = await Promise.all(modules.map(async (module) => [module.key, await commercialRepo.getModuleAdoptionCount(module.key)]));
        moduleAdoptionCounts = Object.fromEntries(adoptionCounts);
      }
      const result = await restRepo.listRestaurants();
      restaurants = Array.isArray(result?.restaurants) ? result.restaurants : [];
      if (typeof commercialRepo.getQuotaMetrics === 'function') quotaMetrics = await commercialRepo.getQuotaMetrics();
      if (![plans, exceptions, pendingInvoices, allInvoices, subscriptions, modules, restaurants, quotaMetrics].every(Array.isArray)) {
        return unavailablePage('پاسخ یکی از سرویس‌های عملیاتی قالب معتبر ندارد؛ داده‌ها برای جلوگیری از نمایش عدد نادرست پنهان شدند.');
      }
    } catch (error) {
      return unavailablePage(`خواندن داده از کنترل‌پلین موفق نشد: ${error?.message || 'خطای نامشخص'}`);
    }

    return `
      <div class="godmode-page-container commercial-page">
        <!-- Top Bar -->
        <div class="page-top-bar" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
          <div>
            <h1 style="font-size: 1.5rem; font-weight: 800; margin: 0 0 0.25rem 0; color: var(--salsa-text-primary, #111);">
              محصول و مالی پلتفرم
            </h1>
            <p style="font-size: 0.85rem; color: var(--salsa-text-secondary, #666); margin: 0;">
              تعریف کلان ماژول‌های محصول، پلن‌های اشتراک، سهمیه‌ها و صدور لایسنس ناوگان
            </p>
          </div>
        </div>

        <!-- Commercial Pulse Metrics Banner -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
          <div class="card" style="padding: 1.15rem; border-radius: 12px; border: 1px solid var(--border, #E5E7EB); background: var(--card, #FFF);">
            <div style="font-size: 0.8rem; color: var(--text-secondary, #666); margin-bottom: 0.35rem;">درآمد ماهانه تکرارشونده (MRR)</div>
            <div style="font-size: 1.35rem; font-weight: 800; font-family: var(--font-mono); color: #2563EB;">
              ${formatMoney(pulse?.mrrToman)} <span style="font-size: 0.8rem; font-weight: normal; color: var(--text-secondary, #666);">تومان</span>
            </div>
            <div style="font-size: 0.75rem; color: #10B981; margin-top: 0.25rem;">
              بر مبنای ${pulse?.activeTenantsCount == null ? '—' : Number(pulse.activeTenantsCount).toLocaleString('fa-IR')} مجموعه فعال
            </div>
          </div>

          <div class="card" style="padding: 1.15rem; border-radius: 12px; border: 1px solid var(--border, #E5E7EB); background: var(--card, #FFF);">
            <div style="font-size: 0.8rem; color: var(--text-secondary, #666); margin-bottom: 0.35rem;">مجموع وصولی‌های ثبت‌شده</div>
            <div style="font-size: 1.35rem; font-weight: 800; font-family: var(--font-mono); color: #10B981;">
              ${formatMoney(pulse?.collectedToman)} <span style="font-size: 0.8rem; font-weight: normal; color: var(--text-secondary, #666);">تومان</span>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary, #666); margin-top: 0.25rem;">
              مجموع ثبت‌شده در سرویس مالی
            </div>
          </div>

          <div class="card" style="padding: 1.15rem; border-radius: 12px; border: 1px solid var(--border, #E5E7EB); background: var(--card, #FFF);">
            <div style="font-size: 0.8rem; color: var(--text-secondary, #666); margin-bottom: 0.35rem;">لایسنس‌های در انتظار تخصیص</div>
            <div style="font-size: 1.35rem; font-weight: 800; font-family: var(--font-mono); color: ${pendingInvoices.length > 0 ? '#F59E0B' : '#10B981'};">
              ${pendingInvoices.length} فاکتور
            </div>
            <div style="font-size: 0.75rem; color: ${pendingInvoices.length > 0 ? '#D97706' : 'var(--text-secondary, #666)'}; margin-top: 0.25rem;">
              ${pendingInvoices.length > 0 ? 'نیازمند استقرار آنی در کلاستر' : 'تمامی لایسنس‌ها مستقر شده‌اند'}
            </div>
          </div>

          <div class="card" style="padding: 1.15rem; border-radius: 12px; border: 1px solid var(--border, #E5E7EB); background: var(--card, #FFF);">
            <div style="font-size: 0.8rem; color: var(--text-secondary, #666); margin-bottom: 0.35rem;">مطالبات در دوره مهلت (At-Risk)</div>
            <div style="font-size: 1.35rem; font-weight: 800; font-family: var(--font-mono); color: ${exceptions.length > 0 ? '#EF4444' : '#10B981'};">
              ${exceptions.length} حساب
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary, #666); margin-top: 0.25rem;">
              ${exceptions.length > 0 ? `${formatMoney(pulse?.atRiskToman)} تومان در مهلت پرداخت` : 'مورد معوقی در دادهٔ دریافت‌شده ثبت نشده است'}
            </div>
          </div>
        </div>

        <!-- Section Navigation Tabs (§3.3 & §59) -->
        <nav class="sub-nav-tabs" style="display: flex; gap: 0.5rem; margin-bottom: 1.5rem; border-bottom: 1px solid var(--border, #E5E7EB); padding-bottom: 0.5rem; overflow-x: auto;">
          <a href="#commercial?section=modules" class="btn ${activeSection === 'modules' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="white-space: nowrap;">
            📦 کاتالوگ ماژول‌ها و توانمندی‌ها (${modules.length})
          </a>
          <a href="#commercial?section=plans" class="btn ${activeSection === 'plans' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="white-space: nowrap;">
            ▣ پلن‌ها و محدودیت‌ها (${plans.length})
          </a>
          <a href="#commercial?section=subscriptions" class="btn ${activeSection === 'subscriptions' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="white-space: nowrap;">
            📋 اشتراک‌های ناوگان (${subscriptions.length})
          </a>
          <a href="#commercial?section=billing" class="btn ${activeSection === 'billing' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="white-space: nowrap;">
            💳 فاکتورها و تسویه‌ها (${allInvoices.length})
          </a>
          <a href="#commercial?section=quotas" class="btn ${activeSection === 'quotas' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="white-space: nowrap;">
            📊 سهمیه‌ها و مصرف منابع
          </a>
          <a href="#commercial?section=reconciliation" class="btn ${activeSection === 'reconciliation' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="white-space: nowrap;">
            ⚖️ تطبیق درآمد و صف مغایرت‌ها ${pendingInvoices.length > 0 ? `<span class="badge badge-warning" style="margin-right: 0.3rem;">${pendingInvoices.length} مغایرت</span>` : ''}
          </a>
        </nav>

        <!-- Tab 1: Business Modules Catalog -->
        ${activeSection === 'modules' ? `
          <div>
            <div style="margin-bottom: 1.25rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
              <div>
                <strong style="font-size: 1rem;">کاتالوگ ماژول‌های پلتفرم سالسا</strong>
                <span style="font-size: 0.8rem; color: #666; display: block;">${modules.length.toLocaleString('fa-IR')} ماژول در کاتالوگ</span>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem;">
              ${modules.map(m => {
                const killSwitch = globalKillswitches?.[m.key];
                const isKilled = Boolean(killSwitch?.killed);
                const adoptionCount = moduleAdoptionCounts[m.key] ?? null;
                return `
                  <div class="card" style="padding: 1.25rem; border-radius: 10px; border: ${isKilled ? '1px solid #EF4444; background: #FEF2F2;' : '1px solid var(--salsa-border, #E5E7EB);'}; display: flex; flex-direction: column; justify-content: space-between;">
                    <div>
                      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                          <span style="font-size: 1.3rem;">${esc(m.icon)}</span>
                          <strong style="font-size: 0.95rem;">${esc(m.nameFa)}</strong>
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.35rem;">
                          <span class="badge badge-neutral" style="font-size: 0.75rem;">${adoptionCount == null ? 'آمار تخصیص نامشخص' : `${Number(adoptionCount).toLocaleString('fa-IR')} مجموعه`}</span>
                          ${isKilled ? `
                            <span class="badge badge-danger" title="${esc(globalKillswitches[m.key]?.reason || '')}">
                              توقف اضطراری
                            </span>
                          ` : `
                            <span class="badge ${killSwitch ? 'badge-success' : 'badge-neutral'}">${killSwitch ? 'فعال' : 'وضعیت نامشخص'}</span>
                          `}
                        </div>
                      </div>
                      <p style="font-size: 0.8rem; color: ${isKilled ? '#991B1B' : '#666'}; line-height: 1.5; margin: 0 0 0.75rem 0;">
                        ${esc(m.descriptionFa)}
                      </p>
                      <div style="font-size: 0.75rem; color: #888; font-family: var(--font-mono); direction: ltr; text-align: right; margin-bottom: 0.75rem;">
                        کلیدهای فنی: ${m.technicalFeatures.join(', ')}
                      </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 0.6rem; border-top: 1px dashed ${isKilled ? '#FCA5A5' : '#EEE'}; font-size: 0.8rem;">
                      <span>قیمت‌گذاری: وابسته به پلن منتشرشده</span>
                      ${!killSwitch ? `
                        <button type="button" class="btn btn-secondary btn-xs" disabled aria-disabled="true" title="وضعیت از سرویس دریافت نشده است">وضعیت نامشخص</button>
                      ` : isKilled ? `
                        <button type="button" class="btn btn-primary btn-xs" onclick="window.GodModeCommercial ? window.GodModeCommercial.openRestoreModuleModal('${esc(m.key)}') : null">
                          ✓ فعال‌سازی مجدد
                        </button>
                      ` : `
                        <button type="button" class="btn btn-ghost btn-xs text-danger" onclick="window.GodModeCommercial ? window.GodModeCommercial.openGlobalKillSwitchModal('${esc(m.key)}') : null">
                          توقف اضطراری سراسری…
                        </button>
                      `}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Tab 2: Plans Catalog & Limits -->
        ${activeSection === 'plans' ? `
          <div>
            <div style="margin-bottom: 1.25rem; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong style="font-size: 1rem;">پلن‌های استاندارد اشتراک و سهمیه‌های سخت‌افزاری</strong>
                <span style="font-size: 0.8rem; color: #666; display: block;">تعریف بسته‌های فروش، توزیع ناوگان و سقف منابع هر پلن</span>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.25rem;">
              ${plans.map(p => {
                const planCode = (p.code || p.id || '').toLowerCase();
                const activeCount = restaurants.filter(r => (r.plan || '').toLowerCase().includes(planCode) || (r.planId === p.id)).length;
                const fleetPercent = restaurants.length > 0 ? Math.round((activeCount / restaurants.length) * 100) : 0;
                return `
                  <div class="card" style="padding: 1.35rem; border-radius: 12px; border: 1px solid var(--border, #E5E7EB); display: flex; flex-direction: column; justify-content: space-between; background: var(--card, #FFF);">
                    <div>
                      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                        <strong style="font-size: 1.15rem;">${esc(p.name)}</strong>
                        <span class="badge badge-neutral" style="font-size: 0.75rem;">
                          ${activeCount} مجموعه فعال (${fleetPercent}٪)
                        </span>
                      </div>
                      <p style="font-size: 0.85rem; color: var(--text-secondary, #666); margin-bottom: 0.85rem; line-height: 1.5;">${esc(p.description || '')}</p>
                      <div style="font-size: 1.35rem; font-weight: 800; color: #2563EB; margin-bottom: 1rem;">
                        ${formatMoney(p.priceToman)} <span style="font-size: 0.8rem; font-weight: normal; color: var(--text-secondary, #666);">تومان / ماه</span>
                      </div>

                      <!-- Hardware & Quotas Limits Grid -->
                      <div style="background: var(--surface-2, #F9FAFB); border-radius: 8px; padding: 0.75rem 0.85rem; font-size: 0.8rem; display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 1rem; border: 1px solid var(--border, #F3F4F6);">
                        <div style="display: flex; justify-content: space-between;">
                          <span style="color: var(--text-secondary, #666);">پایانه‌های صندوق مجاز (POS):</span>
                        <strong style="font-family: var(--font-mono);">${p.limits?.maxPosDevices ?? '—'} دستگاه</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                          <span style="color: var(--text-secondary, #666);">سقف تعداد شعب مجاز:</span>
                        <strong style="font-family: var(--font-mono);">${p.limits?.maxBranches ?? '—'} شعبه</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                          <span style="color: var(--text-secondary, #666);">سهمیه ماهانه پیامک:</span>
                        <strong style="font-family: var(--font-mono);">${p.limits?.smsMonthlyQuota == null ? '—' : Number(p.limits.smsMonthlyQuota).toLocaleString('fa-IR')} پیامک</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                          <span style="color: var(--text-secondary, #666);">فضای ذخیره‌سازی داده:</span>
                        <strong style="font-family: var(--font-mono);">${p.limits?.storageGb ?? '—'} GB</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                          <span style="color: var(--text-secondary, #666);">حداکثر پرسنل و کاربران:</span>
                        <strong style="font-family: var(--font-mono);">${p.limits?.maxUsers ?? '—'} کاربر</strong>
                        </div>
                      </div>

                      <!-- Included Modules Badges -->
                      <div style="font-size: 0.85rem;">
                        <strong style="font-size: 0.8rem; color: var(--foreground, #444); display: block; margin-bottom: 0.5rem;">ماژول‌های تجاری این پلن:</strong>
                        <div style="flex; flex-wrap: wrap; gap: 0.35rem;">
                          ${(p.includedModules || []).map(modKey => {
                            const mDef = modules.find(m => m.key === modKey);
                            return `<span style="display: inline-flex; align-items: center; gap: 0.25rem; background: var(--surface-3, #F3F4F6); color: var(--foreground, #374151); padding: 0.2rem 0.5rem; border-radius: 6px; font-size: 0.75rem;">
                              <span>${mDef?.icon || '📦'}</span>
                              <span>${esc(mDef ? mDef.nameFa : modKey)}</span>
                            </span>`;
                          }).join('')}
                        </div>
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Tab 3: Fleet Billing & License Allocations -->
        ${activeSection === 'billing' ? `
          <div style="display: flex; flex-direction: column; gap: 1.5rem;">
            
            <!-- Section A: Paid Invoices Awaiting License Provisioning -->
            ${pendingInvoices.length > 0 ? `
              <div class="card" style="border-radius: 12px; border: 1px solid var(--warning, #F59E0B); background: rgba(245, 158, 11, 0.08); overflow: hidden;">
                <div class="card-header" style="background: rgba(245, 158, 11, 0.15); padding: 0.85rem 1.25rem; border-bottom: 1px solid rgba(245, 158, 11, 0.25); display: flex; justify-content: space-between; align-items: center;">
                  <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span class="badge badge-warning">اقدام فوری</span>
                    <strong style="font-size: 0.95rem; color: var(--text-primary, #F59E0B);">فاکتورهای تسویه‌شده در انتظار تخصیص و استقرار لایسنس (${pendingInvoices.length})</strong>
                  </div>
                  <span style="font-size: 0.8rem; color: var(--text-secondary, #D97706);">تراکنش‌های بانکی تأییدشده که نیازمند فعال‌سازی نهایی ماژول‌ها هستند</span>
                </div>
                <div class="card-body" style="padding: 0; background: var(--card, #FFF);">
                  <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                    <thead>
                      <tr style="background: var(--surface-2, #FAFAFA); text-align: right; border-bottom: 1px solid var(--border, #EEE);">
                        <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">شناسه فاکتور</th>
                        <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">مجموعه / مشتری</th>
                        <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">مبلغ تسویه‌شده</th>
                        <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">زمان پرداخت</th>
                        <th style="padding: 0.75rem 1rem; text-align: left; color: var(--text-secondary, #666);">عملیات تخصیص لایسنس</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${pendingInvoices.map(inv => `
                        <tr style="border-bottom: 1px solid var(--border, #F3F4F6);">
                          <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 700; color: var(--text-primary, #111);">
                            ${esc(inv.id)}
                          </td>
                          <td style="padding: 0.75rem 1rem; font-weight: 600;">
                            <a href="#restaurants/workspace?id=${esc(inv.tenantId)}&tab=subscription" style="text-decoration: none; color: inherit;">
                              ${esc(inv.tenantId)}
                            </a>
                          </td>
                          <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 700; color: #10B981;">
                            ${(inv.total || inv.amount || 0).toLocaleString('fa-IR')} تومان
                          </td>
                          <td style="padding: 0.75rem 1rem; color: var(--text-secondary, #666); font-size: 0.8rem;">
                            ${esc(inv.paidAt || inv.createdAt || 'اخیراً')}
                          </td>
                          <td style="padding: 0.75rem 1rem; text-align: left;">
                            <button type="button" class="btn btn-primary btn-xs" onclick="window.GodModeCommercial ? window.GodModeCommercial.activateInvoiceLicense('${esc(inv.id)}') : null">
                              تخصیص فوری لایسنس ⚡
                            </button>
                          </td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            ` : ''}

            <!-- Section B: Overdue Accounts & Grace Exceptions -->
            <div class="card" style="border-radius: 12px; border: 1px solid var(--border, var(--salsa-border, #E5E7EB)); overflow: hidden; background: var(--card, #FFF);">
              <div class="card-header" style="background: var(--surface-2, var(--salsa-surface-subtle, #F9FAFB)); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border, var(--salsa-border, #E5E7EB)); display: flex; justify-content: space-between; align-items: center;">
                <strong style="font-size: 0.95rem; color: var(--text-primary, #111);">فاکتورهای معوق و حساب‌های نیازمند پیگیری (${exceptions.length})</strong>
                <span style="font-size: 0.8rem; color: var(--text-secondary, #666);">رسیدگی به دوره مهلت (Grace Period) ناوگان</span>
              </div>
              <div class="card-body" style="padding: 0;">
                ${exceptions.length === 0 ? `
                  <div style="padding: 3rem; text-align: center; color: var(--text-secondary, #666);">
                    <div style="font-size: 2rem; margin-bottom: 0.5rem;">💳</div>
                    <strong style="display: block; margin-bottom: 0.25rem; color: var(--text-primary, #111);">هیچ حساب معوقی در کل ناوگان وجود ندارد</strong>
                    <span style="font-size: 0.85rem;">تمام مجموعه‌ها در وضعیت مالی منظم قرار دارند.</span>
                  </div>
                ` : `
                  <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                    <thead>
                      <tr style="background: var(--surface-2, #FAFAFA); text-align: right; border-bottom: 1px solid var(--border, #EEE);">
                        <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">نام مجموعه</th>
                        <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">مبلغ معوقه</th>
                        <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">پلن</th>
                        <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">مهلت پرداخت تا</th>
                        <th style="padding: 0.75rem 1rem; text-align: left; color: var(--text-secondary, #666);">اقدام</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${exceptions.map(e => `
                        <tr style="border-bottom: 1px solid var(--border, #F3F4F6);">
                          <td style="padding: 0.75rem 1rem; font-weight: 700;">
                            <a href="#restaurants/workspace?id=${esc(e.tenantId)}&tab=subscription" style="text-decoration: none; color: inherit;">
                              ${esc(e.tenantName || e.tenantId)}
                            </a>
                          </td>
                          <td style="padding: 0.75rem 1rem; font-weight: 700; color: #DC2626;">
                            ${(e.amountToman || 0).toLocaleString('fa-IR')} تومان
                          </td>
                          <td style="padding: 0.75rem 1rem;">${esc(e.planName)}</td>
                          <td style="padding: 0.75rem 1rem; color: #666;">
                            ${e.graceUntil ? new Date(e.graceUntil).toLocaleDateString('fa-IR') : '—'}
                          </td>
                          <td style="padding: 0.75rem 1rem; text-align: left;">
                            <div style="display: flex; gap: 0.4rem; justify-content: flex-end;">
                              <button type="button" class="btn btn-secondary btn-xs" onclick="window.GodModeCommercial.openExtendGraceModal('${esc(e.tenantId)}', '${esc(e.tenantName || e.tenantId)}', 7)">
                                +۷ روز
                              </button>
                              <button type="button" class="btn btn-secondary btn-xs" onclick="window.GodModeCommercial.openExtendGraceModal('${esc(e.tenantId)}', '${esc(e.tenantName || e.tenantId)}', 14)">
                                +۱۴ روز
                              </button>
                              <a href="#restaurants/workspace?id=${esc(e.tenantId)}&tab=subscription" class="btn btn-ghost btn-xs">
                                پرونده ↗
                              </a>
                            </div>
                          </td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                `}
              </div>
            </div>

            <!-- Section C: Tax & Financial Ledger Banner & Invoices -->
            <div class="card" style="border-radius: 12px; border: 1px solid var(--border, #E5E7EB); overflow: hidden; background: var(--card, #FFF);">
              <div class="card-header" style="background: var(--surface-2, #F9FAFB); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border, #E5E7EB); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
                <div>
                  <strong style="font-size: 0.95rem;">دفتر کل صورتحساب‌های رسمی و انطباق مالیاتی سامانه مودیان (${allInvoices.length})</strong>
                  <span style="font-size: 0.8rem; color: var(--text-secondary, #666); display: block;">مدیریت فاکتورهای رسمی و وضعیت ثبت مالیاتی، بر اساس پاسخ سرویس متصل</span>
                </div>
                <div style="display: flex; gap: 0.5rem;">
                  <button type="button" class="btn btn-secondary btn-sm" onclick="window.GodModeCommercial ? window.GodModeCommercial.openIssueInvoiceModal() : null">
                    ➕ صدور صورتحساب دستی
                  </button>
                </div>
              </div>

              <!-- Tax & Ledger Mini Pulse Strip -->
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; padding: 1rem 1.25rem; background: var(--surface-2, #FAFAFA); border-bottom: 1px solid var(--border, #E5E7EB);">
                <div style="background: var(--card, #FFF); padding: 0.75rem 1rem; border-radius: 8px; border: 1px solid var(--border, #E5E7EB);">
                  <span style="font-size: 0.75rem; color: var(--text-secondary, #666); display: block;">کل مبالغ فاکتور شده</span>
                  <strong style="font-size: 1.15rem; color: var(--foreground, #111827); font-family: var(--font-mono);">${formatMoney(taxSummary?.grossInvoicedToman)} <span style="font-size: 0.75rem; font-weight: normal;">تومان</span></strong>
                </div>
                <div style="background: var(--card, #FFF); padding: 0.75rem 1rem; border-radius: 8px; border: 1px solid var(--border, #E5E7EB);">
                  <span style="font-size: 0.75rem; color: #16A34A; display: block;">مالیات وصول‌شده</span>
                  <strong style="font-size: 1.15rem; color: #16A34A; font-family: var(--font-mono);">${formatMoney(taxSummary?.collectedVatToman)} <span style="font-size: 0.75rem; font-weight: normal;">تومان</span></strong>
                </div>
                <div style="background: var(--card, #FFF); padding: 0.75rem 1rem; border-radius: 8px; border: 1px solid var(--border, #E5E7EB);">
                  <span style="font-size: 0.75rem; color: #2563EB; display: block;">انطباق با سامانه مودیان</span>
                  <strong style="font-size: 1.15rem; color: #2563EB;">${esc(taxSummary?.moadianComplianceRate ?? '—')}</strong>
                  <span style="display: block; font-size: 0.7rem; color: var(--text-tertiary, #888);">گزارش سرویس مالیاتی</span>
                </div>
                <div style="background: var(--card, #FFF); padding: 0.75rem 1rem; border-radius: 8px; border: 1px solid var(--border, #E5E7EB);">
                  <span style="font-size: 0.75rem; color: var(--text-secondary, #666); display: block;">اسناد مالیاتی معتبر</span>
                  <strong style="font-size: 1.15rem; color: var(--foreground, #111827); font-family: var(--font-mono);">${allInvoices.length.toLocaleString('fa-IR')} <span style="font-size: 0.75rem; font-weight: normal;">سند ثبت‌شده</span></strong>
                </div>
              </div>

              <!-- Search and Filters Bar -->
              <div style="padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border, #E5E7EB); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
                <div style="flex: 1; min-width: 240px;">
                  <input 
                    type="text" 
                    id="commercial-invoice-search" 
                    class="form-control" 
                    placeholder="🔍 جستجو در شناسه فاکتور، نام مجموعه، یا کد پیگیری شاپرک..." 
                    oninput="window.GodModeCommercial ? window.GodModeCommercial.filterInvoices() : null" 
                    style="width: 100%; font-size: 0.82rem; padding: 0.45rem 0.75rem;" 
                  />
                </div>
                <div style="display: flex; gap: 0.35rem;" id="commercial-invoice-status-filters">
                  <button type="button" class="btn btn-primary btn-xs commercial-inv-status-btn active" data-status="all" onclick="window.GodModeCommercial.setInvoiceStatusFilter('all')">همه</button>
                  <button type="button" class="btn btn-secondary btn-xs commercial-inv-status-btn" data-status="paid" onclick="window.GodModeCommercial.setInvoiceStatusFilter('paid')">تسویه‌شده</button>
                  <button type="button" class="btn btn-secondary btn-xs commercial-inv-status-btn" data-status="pending" onclick="window.GodModeCommercial.setInvoiceStatusFilter('pending')">معوق / در انتظار پرداخت</button>
                </div>
              </div>

              <div class="card-body" style="padding: 0;">
                <table class="data-table" id="commercial-invoices-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                  <thead>
                    <tr style="background: var(--surface-2, #FAFAFA); text-align: right; border-bottom: 1px solid var(--border, #EEE);">
                      <th style="padding: 0.75rem 1rem;">شناسه فاکتور</th>
                      <th style="padding: 0.75rem 1rem;">مجموعه طرف قرارداد</th>
                      <th style="padding: 0.75rem 1rem;">مبلغ کل</th>
                      <th style="padding: 0.75rem 1rem;">وضعیت پرداخت</th>
                      <th style="padding: 0.75rem 1rem;">استقرار لایسنس</th>
                      <th style="padding: 0.75rem 1rem;">کد پیگیری شاپرک</th>
                      <th style="padding: 0.75rem 1rem; text-align: left;">سند مالیاتی</th>
                    </tr>
                  </thead>
                  <tbody id="commercial-invoices-tbody">
                    ${allInvoices.map(inv => {
                      const searchable = `${inv.id || ''} ${inv.tenantId || ''} ${inv.tenantName || ''} ${inv.paymentRef || ''}`.toLowerCase();
                      const totalWithVat = inv.totalAmount ?? inv.total ?? inv.amount;
                      return `
                      <tr class="commercial-invoice-row" data-status="${esc(inv.status)}" data-searchable="${esc(searchable)}" style="border-bottom: 1px solid #F3F4F6;">
                        <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 600;">
                          ${esc(inv.id)}
                        </td>
                        <td style="padding: 0.75rem 1rem;">
                          <a href="#restaurants/workspace?id=${esc(inv.tenantId)}&tab=subscription" style="text-decoration: none; color: inherit; font-weight: 500;">
                            ${esc(inv.tenantName || inv.tenantId)}
                          </a>
                        </td>
                        <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 700; color: var(--foreground, #111827);">
                          ${formatMoney(totalWithVat)} تومان
                        </td>
                        <td style="padding: 0.75rem 1rem;">
                          <span class="badge ${inv.status === 'paid' ? 'badge-success' : 'badge-danger'}">
                            ${inv.status === 'paid' ? 'تسویه‌شده' : 'معوق'}
                          </span>
                        </td>
                        <td style="padding: 0.75rem 1rem;">
                          <span class="badge ${inv.activationStatus === 'activated' ? 'badge-success' : (inv.status === 'paid' ? 'badge-warning' : 'badge-neutral')}">
                            ${inv.activationStatus === 'activated' ? 'لایسنس فعال' : (inv.status === 'paid' ? 'در انتظار تخصیص' : '—')}
                          </span>
                        </td>
                        <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-secondary, #666); direction: ltr; text-align: right;">
                          ${esc(inv.paymentRef || '—')}
                        </td>
                        <td style="padding: 0.75rem 1rem; text-align: left;">
                          <div style="display: flex; gap: 0.35rem; justify-content: flex-end;">
                            <button type="button" class="btn btn-secondary btn-xs" onclick="window.GodModeCommercial ? window.GodModeCommercial.viewInvoiceDetails('${esc(inv.id)}') : null">
                              📄 فاکتور رسمی
                            </button>
                            ${inv.status !== 'paid' ? `
                              <button type="button" class="btn btn-ghost btn-xs" onclick="window.GodModeCommercial ? window.GodModeCommercial.markPaid('${esc(inv.id)}') : null">
                                💵 تسویه دستی
                              </button>
                            ` : ''}
                          </div>
                        </td>
                      </tr>
                    `;}).join('')}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        ` : ''}

        <!-- Tab 4: Subscriptions Management (§3.3) -->
        ${activeSection === 'subscriptions' ? `
          <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); overflow: hidden; background: var(--card, #FFF);">
            <div class="card-header" style="background: var(--salsa-surface-subtle, #F9FAFB); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--salsa-border, #E5E7EB); display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong style="font-size: 0.95rem;">قراردادها و اشتراک‌های فعال ناوگان (${subscriptions.length})</strong>
                <span style="font-size: 0.8rem; color: var(--text-secondary, #666); display: block;">نظارت بر چرخه تمدید خودکار، وضعیت حقوق دسترسی و دوره اعتبار قراردادها</span>
              </div>
            </div>
            <div class="card-body" style="padding: 0;">
              <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                <thead>
                  <tr style="background: var(--surface-2, #FAFAFA); text-align: right; border-bottom: 1px solid var(--border, #EEE);">
                    <th style="padding: 0.75rem 1rem;">شناسه اشتراک</th>
                    <th style="padding: 0.75rem 1rem;">مجموعه طرف قرارداد</th>
                    <th style="padding: 0.75rem 1rem;">پلن فعال</th>
                    <th style="padding: 0.75rem 1rem;">دوره تسویه</th>
                    <th style="padding: 0.75rem 1rem;">وضعیت</th>
                    <th style="padding: 0.75rem 1rem;">تاریخ تمدید بعدی</th>
                    <th style="padding: 0.75rem 1rem; text-align: left;">مدیریت</th>
                  </tr>
                </thead>
                <tbody>
                  ${subscriptions.map(s => `
                    <tr style="border-bottom: 1px solid var(--border, #F3F4F6);">
                      <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 600;">${esc(s.id)}</td>
                      <td style="padding: 0.75rem 1rem; font-weight: 600;">
                        <a href="#restaurants/workspace?id=${esc(s.tenantId)}&tab=subscription" style="text-decoration: none; color: inherit;">
                          ${esc(s.tenantName || s.tenantId)}
                        </a>
                      </td>
                      <td style="padding: 0.75rem 1rem;">
                        <span class="badge badge-neutral">${esc((s.planCode || s.plan || 'Growth').toUpperCase())}</span>
                      </td>
                      <td style="padding: 0.75rem 1rem;">${s.billingCycle === 'annual' ? 'سالانه' : 'ماهانه'}</td>
                      <td style="padding: 0.75rem 1rem;">
                        <span class="badge ${s.status === 'active' ? 'badge-success' : (s.status === 'trial' ? 'badge-info' : 'badge-danger')}">
                          ${s.status === 'active' ? 'فعال' : (s.status === 'trial' ? 'آزمایشی' : 'معوق / نیازمند اقدام')}
                        </span>
                      </td>
                      <td style="padding: 0.75rem 1rem; font-size: 0.8rem; color: var(--text-secondary, #666);">
                        ${s.currentPeriodEnd ? new Date(s.currentPeriodEnd).toLocaleDateString('fa-IR') : '—'}
                      </td>
                      <td style="padding: 0.75rem 1rem; text-align: left;">
                        <a href="#restaurants/workspace?id=${esc(s.tenantId)}&tab=subscription" class="btn btn-secondary btn-xs">
                          مدیریت پرونده اشتراک ↗
                        </a>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}

        <!-- Tab 5: Usage & Quotas (§46) -->
        ${activeSection === 'quotas' ? `
          <div>
            <div style="margin-bottom: 1.25rem;">
              <strong style="font-size: 1rem;">سهمیه‌ها و ظرفیت‌های عملیاتی پلتفرم (Usage & Quotas)</strong>
              <span style="font-size: 0.8rem; color: var(--text-secondary, #666); display: block;">پایش مصرف، سقف‌های فنی و پیش‌بینی زمان تکمیل ظرفیت منابع در سطح پلتفرم و ناوگان</span>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem;">
              ${quotaMetrics.length === 0 ? `
                <div class="card" role="status" style="padding: 1.25rem; color: var(--text-secondary, #666);">
                  دادهٔ مصرف و سهمیه از سرویس عملیاتی دریافت نشد؛ عدد یا پیش‌بینی جایگزین نمایش داده نمی‌شود.
                </div>
              ` : quotaMetrics.map(q => `
                <div class="card" style="padding: 1.25rem; border-radius: 12px; border: 1px solid ${q.status === 'critical' ? '#EF4444' : (q.status === 'warning' ? '#F59E0B' : 'var(--salsa-border, #E5E7EB)')}; background: var(--card, #FFF);">
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
                    <div>
                      <strong style="font-size: 0.95rem; color: var(--text-primary, #111);">${esc(q.resource)}</strong>
                        <span style="font-size: 0.75rem; color: var(--text-secondary, #666); display: block;">منبع: ${esc(q.source)} | دوره: ${esc(q.period)}</span>
                    </div>
                    <span class="badge ${q.status === 'critical' ? 'badge-danger' : (q.status === 'warning' ? 'badge-warning' : 'badge-success')}">
                      ${q.percent}٪ مصرف‌شده
                    </span>
                  </div>

                  <!-- Progress Bar -->
                  <div style="background: var(--surface-3, #E5E7EB); border-radius: 6px; height: 8px; overflow: hidden; margin-bottom: 0.85rem;">
                    <div style="width: ${q.percent}%; height: 100%; background: ${q.status === 'critical' ? '#EF4444' : (q.status === 'warning' ? '#F59E0B' : '#10B981')};"></div>
                  </div>

                  <!-- Explainable Breakdown Grid -->
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; font-size: 0.78rem; background: var(--surface-2, #F9FAFB); padding: 0.75rem; border-radius: 8px; margin-bottom: 0.85rem; border: 1px solid var(--border, #F3F4F6);">
                    <div><span style="color: var(--text-secondary, #666);">مصرف جاری:</span> <strong>${esc(q.current)}</strong></div>
                    <div><span style="color: #666;">سقف قطعی:</span> <strong>${esc(q.limit)}</strong></div>
                    <div><span style="color: #666;">آستانه هشدار:</span> <strong>${esc(q.warningThreshold)}</strong></div>
                    <div><span style="color: #666;">زمان بازنشانی:</span> <strong>${esc(q.resetDate)}</strong></div>
                  </div>

                  <!-- Forecast & Recommendation -->
                  <div style="font-size: 0.78rem; border-top: 1px dashed #E5E7EB; padding-top: 0.65rem;">
                    <div style="margin-bottom: 0.35rem; color: #4B5563;">
                      📈 <strong>پیش‌بینی مصرف:</strong> ${esc(q.forecast)}
                    </div>
                    <div style="color: ${q.status === 'critical' ? '#DC2626' : (q.status === 'warning' ? '#D97706' : '#059669')}; font-weight: 600;">
                      💡 اقدام پیشنهادی: ${esc(q.recommendedAction)}
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Tab 6: Revenue Reconciliation & Exception Queue (§43) -->
        ${activeSection === 'reconciliation' ? `
          <div style="display: flex; flex-direction: column; gap: 1.5rem;">
            <div class="card" style="padding: 1.25rem; border-radius: 12px; border: 1px solid var(--border, #E5E7EB); background: var(--card, #FFF);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
                <div>
                  <h3 style="margin: 0; font-size: 1.1rem; font-weight: 800;">کنترل‌پین درآمد و صف رفع مغایرت‌های مالی (Revenue Reconciliation)</h3>
                  <p style="margin: 0.25rem 0 0 0; font-size: 0.8rem; color: var(--text-secondary, #666);">
                    شناسایی خودکار مغایرت‌های چرخه: کاتالوگ محصول ← پلن ← اشتراک ← صورتحساب ← پرداخت ← لایسنس
                  </p>
                </div>
                <button type="button" class="btn btn-secondary btn-sm" onclick="window.GodModeCommercial ? window.GodModeCommercial.refreshCommercial() : null">
                  🔄 بازبینی صف مغایرت‌ها
                </button>
              </div>
            </div>

            <!-- Exception Queue Table -->
            <div class="card" style="border-radius: 12px; border: 1px solid var(--border, #E5E7EB); overflow: hidden; background: var(--card, #FFF);">
              <div class="card-header" style="background: var(--surface-2, #F9FAFB); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border, #E5E7EB); display: flex; justify-content: space-between; align-items: center;">
                <strong style="font-size: 0.95rem;">صف مغایرت‌های عملیاتی درآمد و لایسنس (Exception Queue)</strong>
                <span class="badge ${pendingInvoices.length > 0 ? 'badge-warning' : 'badge-success'}">
                  ${pendingInvoices.length > 0 ? `${pendingInvoices.length} مغایرت فعال` : 'بدون مغایرت کشف‌شده'}
                </span>
              </div>
              <div class="card-body" style="padding: 0;">
                <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                  <thead>
                    <tr style="background: var(--surface-2, #FAFAFA); text-align: right; border-bottom: 1px solid var(--border, #EEE);">
                      <th style="padding: 0.75rem 1rem;">نوع مغایرت</th>
                      <th style="padding: 0.75rem 1rem;">مجموعه تحت تأثیر</th>
                      <th style="padding: 0.75rem 1rem;">شرح مغایرت زنجیره درآمد</th>
                      <th style="padding: 0.75rem 1rem;">سطح ریسک</th>
                      <th style="padding: 0.75rem 1rem; text-align: left;">اقدام اصلاحی (Remediation)</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${pendingInvoices.map(inv => `
                      <tr style="border-bottom: 1px solid #F3F4F6;">
                        <td style="padding: 0.75rem 1rem;">
                          <span class="badge badge-warning">پرداخت بدون فعال‌سازی</span>
                        </td>
                        <td style="padding: 0.75rem 1rem; font-weight: 600;">
                          <a href="#restaurants/workspace?id=${esc(inv.tenantId)}&tab=subscription" style="text-decoration: none; color: inherit;">
                            ${esc(inv.tenantName || inv.tenantId)}
                          </a>
                        </td>
                        <td style="padding: 0.75rem 1rem; font-size: 0.8rem; color: #555;">
                          تراکنش فاکتور ${esc(inv.id)} به مبلغ ${(inv.total || inv.amount || 0).toLocaleString('fa-IR')} تومان پرداخت شده اما لایسنس ماژول‌ها هنوز در کلاستر مستقر نشده است.
                        </td>
                        <td style="padding: 0.75rem 1rem;">
                          <span class="badge badge-danger">ریسک عملیاتی بالا</span>
                        </td>
                        <td style="padding: 0.75rem 1rem; text-align: left;">
                          <button type="button" class="btn btn-primary btn-xs" onclick="window.GodModeCommercial ? window.GodModeCommercial.activateInvoiceLicense('${esc(inv.id)}') : null">
                            ⚡ تخصیص فوری لایسنس
                          </button>
                        </td>
                      </tr>
                    `).join('')}

                    ${exceptions.map(exc => `
                      <tr style="border-bottom: 1px solid #F3F4F6;">
                        <td style="padding: 0.75rem 1rem;">
                          <span class="badge badge-danger">حساب معوق در مهلت</span>
                        </td>
                        <td style="padding: 0.75rem 1rem; font-weight: 600;">
                          <a href="#restaurants/workspace?id=${esc(exc.tenantId)}&tab=subscription" style="text-decoration: none; color: inherit;">
                            ${esc(exc.tenantName || exc.tenantId)}
                          </a>
                        </td>
                        <td style="padding: 0.75rem 1rem; font-size: 0.8rem; color: #555;">
                          مطالبه به مبلغ ${(exc.amountToman || 0).toLocaleString('fa-IR')} تومان سررسید شده و در دوره استمهال قرار دارد.
                        </td>
                        <td style="padding: 0.75rem 1rem;">
                          <span class="badge badge-warning">ریسک وصول درآمد</span>
                        </td>
                        <td style="padding: 0.75rem 1rem; text-align: left;">
                          <a href="#restaurants/workspace?id=${esc(exc.tenantId)}&tab=subscription" class="btn btn-secondary btn-xs">
                            بررسی وضعیت اشتراک ↗
                          </a>
                        </td>
                      </tr>
                    `).join('')}

                    ${pendingInvoices.length === 0 && exceptions.length === 0 ? `
                      <tr>
                        <td colspan="5" style="padding: 2.5rem; text-align: center; color: #666;">
                          <div style="font-size: 1.75rem; margin-bottom: 0.35rem;">✓</div>
                          <strong>تمامی مراحل زنجیره درآمد و لایسنس با موفقیت تطبیق یافته‌اند</strong>
                          <span style="font-size: 0.8rem; display: block; margin-top: 0.25rem;">هیچ مغایرت معوقه‌ای در سطح ناوگان شناسایی نشد.</span>
                        </td>
                      </tr>
                    ` : ''}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ` : ''}

      </div>
    `;
  }

  const GodModeCommercial = {
    currentInvoiceFilter: 'all',

    setInvoiceStatusFilter(status) {
      this.currentInvoiceFilter = status;
      const btns = document.querySelectorAll('.commercial-inv-status-btn');
      btns.forEach(b => {
        if (b.getAttribute('data-status') === status) {
          b.classList.add('active', 'btn-primary');
          b.classList.remove('btn-secondary');
        } else {
          b.classList.remove('active', 'btn-primary');
          b.classList.add('btn-secondary');
        }
      });
      this.filterInvoices();
    },

    filterInvoices() {
      const searchInput = document.getElementById('commercial-invoice-search');
      const query = (searchInput ? searchInput.value : '').toLowerCase().trim();
      const rows = document.querySelectorAll('.commercial-invoice-row');

      rows.forEach(row => {
        const status = row.getAttribute('data-status') || '';
        const searchable = (row.getAttribute('data-searchable') || '').toLowerCase();

        const matchStatus = this.currentInvoiceFilter === 'all' || status === this.currentInvoiceFilter;
        const matchQuery = !query || searchable.includes(query);

        if (matchStatus && matchQuery) {
          row.style.display = '';
        } else {
          row.style.display = 'none';
        }
      });
    },

    viewInvoiceDetails(invoiceId) {
      const commRepo = global.CommercialRepository;
      let details = null;
      if (commRepo && typeof commRepo.getInvoiceDetails === 'function') {
        details = commRepo.getInvoiceDetails(invoiceId);
      }
      if (!details) {
        if (global.GMToast) global.GMToast.show('مشخصات فاکتور یافت نشد.', 'warning');
        return;
      }

      const itemsHtml = (details.items || []).map((it, idx) => `
        <tr style="border-bottom: 1px solid #EEE;">
          <td style="padding: 0.5rem; text-align: center;">${idx + 1}</td>
          <td style="padding: 0.5rem; font-weight: 500;">${esc(it.desc || it.name || 'سرویس')}</td>
          <td style="padding: 0.5rem; text-align: center; font-family: monospace;">${it.count || 1}</td>
          <td style="padding: 0.5rem; text-align: left; font-family: monospace;">${(it.unitPrice || it.amount || 0).toLocaleString('fa-IR')} تومان</td>
          <td style="padding: 0.5rem; text-align: left; font-family: monospace; font-weight: 700;">${(it.total || it.amount || 0).toLocaleString('fa-IR')} تومان</td>
        </tr>
      `).join('');

      const content = `
        <div style="font-size: 0.85rem; line-height: 1.6; text-align: right;">
          <!-- Official Invoice Header -->
          <div style="border-bottom: 2px solid var(--salsa-primary, #111827); padding-bottom: 0.75rem; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <h3 style="margin: 0 0 0.25rem 0; font-size: 1.1rem; font-weight: 800; color: #111827;">صورتحساب الکترونیکی فروش کالا و خدمات</h3>
              <span style="font-size: 0.75rem; color: #666;">مطابق با استانداردهای سامانه مودیان و ماده ۲۶ قانون مالیات بر ارزش افزوده</span>
            </div>
            <div style="text-align: left;">
              <div style="font-size: 0.78rem; color: #666;">شماره سریال مالیاتی: <strong style="font-family: monospace; color: #111827;">${esc(details.taxCompliance?.fiscalSerial || details.id)}</strong></div>
              <div style="font-size: 0.78rem; color: #666;">تاریخ صدور: <strong style="font-family: monospace;">${esc(details.createdAt)}</strong></div>
              <span class="badge ${details.status === 'paid' ? 'badge-success' : 'badge-danger'}" style="margin-top: 0.25rem;">
                ${esc(details.statusFa)}
              </span>
            </div>
          </div>

          <!-- Moadian UID Banner -->
          <div style="background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 8px; padding: 0.6rem 0.85rem; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span style="font-size: 1.1rem;">🏛</span>
              <div>
                <strong style="font-size: 0.82rem; color: #166534;">شناسه یکتای مالیاتی (Moadian Tax UID):</strong>
                <span style="font-family: monospace; font-size: 0.82rem; font-weight: 700; color: #14532D; margin-right: 0.35rem;">${esc(details.taxCompliance?.taxUid)}</span>
              </div>
            </div>
            <span class="badge badge-success" style="font-size: 0.72rem;">${esc(details.taxCompliance?.moadianStatus)}</span>
          </div>

          <!-- Seller & Buyer 2-Column Grid -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.75rem; margin-bottom: 1rem;">
            <!-- Seller Box -->
            <div style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 0.75rem;">
              <strong style="display: block; font-size: 0.82rem; color: #374151; margin-bottom: 0.4rem; border-bottom: 1px dashed #D1D5DB; padding-bottom: 0.25rem;">مشخصات فروشنده (ارائه‌دهنده خدمت):</strong>
              <div style="font-size: 0.78rem; line-height: 1.6; color: #4B5563;">
                <div>نام: <strong>${esc(details.seller?.legalName)}</strong></div>
                <div>شناسه اقتصادی: <span style="font-family: monospace;">${esc(details.seller?.economicCode)}</span> | شناسه ملی: <span style="font-family: monospace;">${esc(details.seller?.nationalId)}</span></div>
                <div>نشانی: ${esc(details.seller?.address)}</div>
              </div>
            </div>

            <!-- Buyer Box -->
            <div style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 0.75rem;">
              <strong style="display: block; font-size: 0.82rem; color: #374151; margin-bottom: 0.4rem; border-bottom: 1px dashed #D1D5DB; padding-bottom: 0.25rem;">مشخصات خریدار (مجموعه طرف قرارداد):</strong>
              <div style="font-size: 0.78rem; line-height: 1.6; color: #4B5563;">
                <div>نام: <strong>${esc(details.buyer?.legalName)}</strong></div>
                <div>شناسه اقتصادی: <span style="font-family: monospace;">${esc(details.buyer?.economicCode)}</span> | شناسه ملی: <span style="font-family: monospace;">${esc(details.buyer?.nationalId)}</span></div>
                <div>نشانی: ${esc(details.buyer?.address)}</div>
              </div>
            </div>
          </div>

          <!-- Invoice Line Items Table -->
          <div style="border: 1px solid #E5E7EB; border-radius: 8px; overflow: hidden; margin-bottom: 1rem;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem;">
              <thead>
                <tr style="background: #F3F4F6; text-align: right;">
                  <th style="padding: 0.5rem; text-align: center; width: 30px;">ردیف</th>
                  <th style="padding: 0.5rem;">شرح کالا یا خدمت</th>
                  <th style="padding: 0.5rem; text-align: center; width: 50px;">تعداد</th>
                  <th style="padding: 0.5rem; text-align: left; width: 110px;">مبلغ واحد</th>
                  <th style="padding: 0.5rem; text-align: left; width: 120px;">مبلغ کل</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>
          </div>

          <!-- Financial Calculation Breakdown -->
          <div style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 0.85rem; margin-bottom: 1rem;">
            <div style="display: flex; justify-content: space-between; padding: 0.25rem 0; font-size: 0.82rem; color: #4B5563;">
              <span>مبلغ کل قبل از تخفیف و مالیات:</span>
              <span style="font-family: monospace; font-weight: 600;">${(details.subtotal || 0).toLocaleString('fa-IR')} تومان</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 0.25rem 0; font-size: 0.82rem; color: #4B5563;">
              <span>تخفیف‌های تجاری:</span>
              <span style="font-family: monospace;">${(details.discount || 0).toLocaleString('fa-IR')} تومان</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 0.25rem 0; font-size: 0.82rem; color: #16A34A; border-bottom: 1px dashed #D1D5DB; padding-bottom: 0.5rem;">
              <span>مالیات بر ارزش افزوده و عوارض قانونی (${details.vatRate || 10}٪):</span>
              <span style="font-family: monospace; font-weight: 700;">${(details.vatAmount || 0).toLocaleString('fa-IR')} تومان</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding-top: 0.5rem; font-size: 0.95rem; font-weight: 800; color: #111827;">
              <span>مبلغ نهایی قابل پرداخت:</span>
              <span style="font-family: monospace; color: #2563EB;">${(details.totalAmount || 0).toLocaleString('fa-IR')} تومان</span>
            </div>
          </div>

          <!-- Cryptographic Seal -->
          <div style="font-size: 0.72rem; color: var(--text-secondary, #666); background: var(--surface-2, #FFF); border: 1px solid var(--border, #E5E7EB); padding: 0.5rem 0.75rem; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; font-family: monospace;">
            <span>🛡 مهر امنیتی SHA-256: ${esc(details.taxCompliance?.digitalSignature?.substring(0, 32))}...</span>
            <span>حافظه مالیاتی: ${esc(details.taxCompliance?.fiscalMemoryId)}</span>
          </div>
        </div>
      `;

      if (global.GMApp && typeof global.GMApp.openModal === 'function') {
        global.GMApp.openModal(`سند مالیاتی رسمی — فاکتور ${details.id}`, content, null, { cancelText: 'بستن' });
      }
    },

    async openIssueInvoiceModal() {
      if (!inOperationalMode()) return notifyUnavailableAction();
      const commRepo = global.CommercialRepository;
      if (!commRepo || typeof commRepo.issueInvoice !== 'function') {
        if (global.GMToast) global.GMToast.show('صدور فاکتور تا آماده‌شدن API عملیاتی این بخش غیرفعال است.', 'warning');
        return;
      }
      const restRepo = global.RestaurantsRepository;
      let tenants = [];
      try {
        const result = await restRepo?.listRestaurants?.();
        tenants = Array.isArray(result?.restaurants) ? result.restaurants : [];
      } catch (_) {
        if (global.GMToast) global.GMToast.show('فهرست مجموعه‌ها از کنترل‌پلین دریافت نشد؛ فاکتوری صادر نشد.', 'error');
        return;
      }
      if (tenants.length === 0) {
        if (global.GMToast) global.GMToast.show('مجموعهٔ قابل انتخابی از کنترل‌پلین دریافت نشد.', 'warning');
        return;
      }

      const optionsHtml = tenants.map(t => `<option value="${esc(t.id)}">${esc(t.name)} (${esc(t.id)})</option>`).join('');

      const formHtml = `
        <div style="font-size: 0.9rem; text-align: right;">
          <p style="color: #666; margin-bottom: 1rem; font-size: 0.85rem;">
            صدور فاکتور رسمی بر اساس تنظیمات قانونی و مالیاتی ثبت‌شده در سرویس عملیاتی.
          </p>
          <div class="form-group" style="margin-bottom: 0.85rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">مجموعه طرف قرارداد</label>
            <select id="modal-inv-tenant" class="form-control" style="width: 100%; padding: 0.5rem;">
              <option value="" selected disabled>انتخاب مجموعه</option>
              ${optionsHtml}
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 0.85rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">شرح خدمت یا فاکتور</label>
            <input type="text" id="modal-inv-desc" class="form-control" value="" style="width: 100%;" required />
          </div>
          <div class="form-group" style="margin-bottom: 0.85rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">مبلغ پایه قبل از مالیات (تومان)</label>
            <input type="number" id="modal-inv-amount" class="form-control" value="" style="width: 100%; direction: ltr;" required />
          </div>
          <div style="font-size: 0.8rem; background: #F3F4F6; padding: 0.6rem 0.85rem; border-radius: 6px; margin-bottom: 1rem; color: #4B5563;">
            💡 نرخ مالیات و مبلغ نهایی طبق تنظیمات معتبر سمت سرور محاسبه می‌شود.
          </div>
        </div>
      `;

      if (global.GMApp && typeof global.GMApp.openModal === 'function') {
        global.GMApp.openModal('صدور صورتحساب رسمی پلتفرم سالسا', formHtml, () => {
          const tenantInput = document.getElementById('modal-inv-tenant');
          const descInput = document.getElementById('modal-inv-desc');
          const amountInput = document.getElementById('modal-inv-amount');

          const tenantId = tenantInput ? tenantInput.value : '';
          const description = descInput ? descInput.value.trim() : '';
          const amount = amountInput ? parseInt(amountInput.value, 10) : NaN;

          if (!tenantId || !description || !Number.isFinite(amount) || amount <= 0) {
            if (global.GMToast) global.GMToast.show('مجموعه، شرح و مبلغ معتبر را وارد کنید.', 'warning');
            return false;
          }

          commRepo.issueInvoice(tenantId, { description, amount }).then(() => {
            if (global.GMToast) global.GMToast.show('درخواست صدور فاکتور در سرویس عملیاتی ثبت شد.', 'success');
            if (global.GMApp) global.GMApp.closeModal();
            if (global.GodModeRouter) global.GodModeRouter.handleRoute();
          }).catch((error) => {
            if (global.GMToast) global.GMToast.show(error?.message || 'صدور فاکتور در سرویس عملیاتی ناموفق بود.', 'error');
          });
          return false;
        }, { confirmText: 'صدور و ثبت سند رسمی' });
      }
    },

    openGlobalKillSwitchModal(moduleKey) {
      if (!inOperationalMode()) return notifyUnavailableAction();
      if (!global.GodModeConfirmDialog) return;
      global.GodModeConfirmDialog.show({
        title: `توقف اضطراری سراسری ماژول ${moduleKey}`,
        severity: 'destructive',
        message: `آیا از قطع سراسری ماژول «${moduleKey}» در تمام رستوران‌های فعال اطمینان دارید؟ این عمل تأثیر فوری بر تمام صندوق‌ها و کاربران پلتفرم خواهد داشت.`,
        impactDetails: 'غیرفعال‌سازی سرویس در تمام ناوگان تا زمان فعال‌سازی مجدد.',
        requireReason: true,
        reasonPlaceholder: 'ذکر دلیل اضطراری برای توقف ماژول در سطح کشور...',
        confirmText: 'توقف اضطراری سراسری',
        onConfirm: async (reason) => {
          await runCommercialAction('toggleGlobalKillswitch', [moduleKey, false, reason], `دستور توقف ماژول «${moduleKey}» ثبت شد.`, 'danger');
        }
      });
    },

    openRestoreModuleModal(moduleKey) {
      if (!inOperationalMode()) return notifyUnavailableAction();
      if (!global.GodModeConfirmDialog) return;
      global.GodModeConfirmDialog.show({
        title: `رفع توقف و فعال‌سازی مجدد ماژول ${moduleKey}`,
        severity: 'warning',
        message: `آیا از رفع توقف اضطراری و بازگردانی ماژول «${moduleKey}» به وضعیت عملیاتی در کل پلتفرم اطمینان دارید؟`,
        impactDetails: 'فعال‌سازی مجدد ماژول برای تمام رستوران‌های دارای اشتراک یا افزونه مربوطه.',
        requireReason: true,
        reasonPlaceholder: 'ذکر دلیل فنی یا تاییدیه تست برای رفع انسداد...',
        confirmText: 'فعال‌سازی مجدد ماژول',
        onConfirm: async (reason) => {
          await runCommercialAction('toggleGlobalKillswitch', [moduleKey, true, reason], `درخواست فعال‌سازی ماژول «${moduleKey}» ثبت شد.`);
        }
      });
    },

    openExtendGraceModal(tenantId, tenantName, additionalDays = 7) {
      if (!inOperationalMode()) return notifyUnavailableAction();
      if (!global.GodModeConfirmDialog) return;
      global.GodModeConfirmDialog.show({
        title: `تمدید ${additionalDays} روزه مهلت پرداخت «${tenantName}»`,
        severity: 'warning',
        message: `آیا مایلید مهلت پرداخت صورتحساب‌های معوق «${tenantName}» را به مدت ${additionalDays} روز تمدید نمایید؟`,
        impactDetails: `وضعیت اشتراک در حالت مهلت (grace_period) حفظ شده و از مسدودسازی خودکار جلوگیری خواهد شد.`,
        requireReason: true,
        reasonPlaceholder: `ذکر علت تمدید ${additionalDays} روزه مهلت (تماس مشتری، توافق مالی، واریز بانکی در صف و...)`,
        confirmText: `تمدید ${additionalDays} روزه مهلت`,
        onConfirm: async (reason) => {
          await runCommercialAction('extendGracePeriod', [tenantId, additionalDays, reason], `درخواست تمدید مهلت «${tenantName}» ثبت شد.`);
        }
      });
    },

    activateInvoiceLicense(invoiceId) {
      if (!inOperationalMode()) return notifyUnavailableAction();
      if (!global.GodModeConfirmDialog) return;
      global.GodModeConfirmDialog.show({
        title: `تخصیص و استقرار آنی لایسنس فاکتور ${invoiceId}`,
        severity: 'safe',
        message: `آیا از تخصیص ماژول‌ها و صدور لایسنس فعال برای فاکتور ${invoiceId} اطمینان دارید؟`,
        impactDetails: 'ماژول‌های خریداری‌شده فاکتور به کلاستر رستوران متصل و توکن دسترسی به‌روز خواهد شد.',
        requireReason: false,
        confirmText: 'تخصیص آنی لایسنس ⚡',
        onConfirm: async () => {
          await runCommercialAction('activateInvoiceLicense', [invoiceId], `درخواست فعال‌سازی برای فاکتور ${invoiceId} ثبت شد.`);
        }
      });
    },

    markPaid(invoiceId) {
      return this.openMarkPaidModal(invoiceId);
    },

    openMarkPaidModal(invoiceId) {
      if (!inOperationalMode()) return notifyUnavailableAction();
      if (global.GMToast) global.GMToast.show('ثبت دستی پرداخت غیرفعال است؛ وضعیت پرداخت فقط از تأییدیهٔ درگاه/دفتر مالی تغییر می‌کند.', 'warning');
    },

    refreshCommercial() {
      if (global.GodModeRouter && typeof global.GodModeRouter.handleRoute === 'function') {
        global.GodModeRouter.handleRoute();
      }
    }
  };

  global.GodModeCommercial = GodModeCommercial;

  // Register in Router
  if (global.GodModeRouter) {
    global.GodModeRouter.registerRenderer('commercial', renderCommercialPage);
  }

  global.renderGodModeCommercial = renderCommercialPage;
})(typeof window !== 'undefined' ? window : globalThis);
