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

  async function renderCommercialPage(context = {}) {
    const { params = {}, section = 'modules' } = context;
    const activeSection = params.section || params.tab || section || 'modules';

    const commercialRepo = global.CommercialRepository;
    const entitlementsRepo = global.EntitlementsRepository;
    const restRepo = global.RestaurantsRepository;
    const isProduction = Boolean(
      global.__SALSA_RUNTIME_CONFIG__?.environment === 'production' ||
      global.GodModeAppMode?.isProduction?.()
    );

    let plans = [];
    let modules = [];
    let exceptions = [];
    let globalKillswitches = {};
    let restaurants = [];
    let pendingInvoices = [];
    let allInvoices = [];
    let subscriptions = [];
    let billingExceptionsAvailable = !isProduction;
    let invoiceLedgerAvailable = !isProduction;
    let pendingLicensesAvailable = !isProduction;
    let taxSummaryAvailable = !isProduction;
    let restaurantsAvailable = !isProduction;
    let subscriptionsAvailable = !isProduction;
    let planCatalogAvailable = !isProduction;
    let moduleCatalogAvailable = !isProduction;
    let globalKillswitchesAvailable = !isProduction;
    let globalKillMutationsAvailable = !isProduction;
    let globalKillCapabilityReason = '';
    let pulse = isProduction ? {
      mrrToman: null,
      collectedToman: null,
      activeTenantsCount: null,
      totalTenantsCount: null,
      pendingLicenseCount: null,
      overdueCount: null,
      atRiskToman: null,
      dataStatus: 'unavailable'
    } : {
      mrrToman: 7190000,
      collectedToman: 15400000,
      activeTenantsCount: 4,
      totalTenantsCount: 4,
      pendingLicenseCount: 0,
      overdueCount: 0,
      atRiskToman: 0
    };
    let taxSummary = {
      grossInvoicedToman: null,
      paidGrossToman: null,
      collectedVatToman: null,
      pendingVatToman: null,
      paidCount: null,
      pendingCount: null,
      totalCount: null,
      moadianStatus: 'NotIntegrated',
      moadianStatusFa: 'عدم اتصال به سامانه مودیان (پیکربندی نشده)',
      moadianMemoryId: null,
      taxRatePercent: 10,
      dataStatus: 'unavailable'
    };

    const readSource = async (read, validate) => {
      if (typeof read !== 'function') return false;
      try {
        const value = await read();
        return validate(value) ? value : false;
      } catch (_) {
        return false;
      }
    };

    if (commercialRepo) {
      const [plansResult, exceptionsResult, killswitchResult, pendingResult, invoicesResult, pulseResult, taxResult, subscriptionsResult] = await Promise.all([
        readSource(() => commercialRepo.listPlans(), Array.isArray),
        readSource(() => commercialRepo.getBillingExceptions(), Array.isArray),
        readSource(() => typeof commercialRepo.listGlobalKillswitches === 'function'
          ? commercialRepo.listGlobalKillswitches()
          : commercialRepo.getGlobalKillswitches(), value => Boolean(value && typeof value === 'object')),
        readSource(() => commercialRepo.getPendingActivationInvoices?.(), Array.isArray),
        readSource(() => commercialRepo.getAllInvoices?.(), Array.isArray),
        readSource(() => commercialRepo.getCommercialPulseMetrics?.(), value => Boolean(value && typeof value === 'object')),
        readSource(() => commercialRepo.getTaxSummary?.(), value => Boolean(value && typeof value === 'object' && value.dataStatus !== 'unavailable')),
        readSource(() => commercialRepo.listSubscriptions?.(), Array.isArray)
      ]);
      if (plansResult !== false) { plans = plansResult; planCatalogAvailable = true; }
      if (exceptionsResult !== false) { exceptions = exceptionsResult; billingExceptionsAvailable = true; }
      if (killswitchResult !== false) {
        globalKillswitches = killswitchResult;
        globalKillswitchesAvailable = true;
        const capability = killswitchResult.__capabilities;
        globalKillMutationsAvailable = !isProduction || capability?.globalMutationsAvailable === true;
        globalKillCapabilityReason = capability?.globalMutationsAvailable === false
          ? 'پخش توقف اضطراری به همهٔ رستوران‌ها هنوز عملیاتی نیست.'
          : 'آمادگی توقف سراسری از کنترل‌پلین تأیید نشده است.';
      }
      if (pendingResult !== false) { pendingInvoices = pendingResult; pendingLicensesAvailable = true; }
      if (invoicesResult !== false) { allInvoices = invoicesResult; invoiceLedgerAvailable = true; }
      if (pulseResult !== false) pulse = pulseResult;
      if (taxResult !== false) { taxSummary = taxResult; taxSummaryAvailable = true; }
      if (subscriptionsResult !== false) { subscriptions = subscriptionsResult; subscriptionsAvailable = true; }
    }
    if (entitlementsRepo) {
      const result = await readSource(() => typeof entitlementsRepo.refreshBusinessModules === 'function'
        ? entitlementsRepo.refreshBusinessModules()
        : entitlementsRepo.getBusinessModules(), Array.isArray);
      if (result !== false) { modules = result; moduleCatalogAvailable = true; }
    }
    if (restRepo) {
      const result = await readSource(() => restRepo.listRestaurants(), value => Array.isArray(value?.restaurants));
      if (result !== false) {
        restaurants = result.restaurants;
        restaurantsAvailable = true;
      }
    }

    try {
      if (!isProduction && subscriptions.length === 0 && restaurants.length > 0) {
        subscriptions = restaurants.map(r => ({
          id: `sub_${r.id}`,
          tenantId: r.id,
          tenantName: r.name,
          planCode: (r.plan || 'growth').toLowerCase(),
          status: r.status === 'suspended' ? 'suspended' : (r.status === 'past_due' ? 'past_due' : 'active'),
          billingCycle: 'monthly',
          currentPeriodEnd: new Date(Date.now() + 86400000 * 25).toISOString(),
          createdAt: r.createdAt || new Date().toISOString()
        }));
      }
    } catch (_) {}

    const quotaMetrics = isProduction ? [] : [
      {
        resource: 'API Requests (کنترل‌پین و فراخوانی وب‌سرویس)',
        current: '7.3M',
        limit: '10M',
        percent: 73,
        period: 'ماهانه',
        resetDate: '۱۲ روز دیگر',
        warningThreshold: '85%',
        hardLimit: '10M',
        source: 'سهمیه سازمانی پلن',
        forecast: 'پایان ماه: ۹.۴M درخواست (زیر سقف مجاز)',
        status: 'normal',
        recommendedAction: 'هیچ اقدامی لازم نیست'
      },
      {
        resource: 'فضای ذخیره‌سازی ابری و پایگاه داده (Storage)',
        current: '47 GB',
        limit: '50 GB',
        percent: 94,
        period: 'مداوم',
        resetDate: 'بدون بازنشانی',
        warningThreshold: '90%',
        hardLimit: '50 GB',
        source: 'پلن مقیاس (Scale)',
        forecast: 'تکمیل ظرفیت ظرف ۵ روز آینده در صورت عدم ارتقا',
        status: 'critical',
        recommendedAction: 'ارتقای سهمیه به ۱۰۰ گیگابایت یا پاکسازی داده‌های موقت'
      },
      {
        resource: 'پیامک‌های اطلاع‌رسانی و احراز هویت (SMS Quota)',
        current: '4,210',
        limit: '5,000',
        percent: 84,
        period: 'ماهانه',
        resetDate: '۱۸ روز دیگر',
        warningThreshold: '80%',
        hardLimit: '5,000',
        source: 'بسته پایه پیامک',
        forecast: 'پایان ماه: ۵,۴۰۰ پیامک (احتمال توقف ارسال در ۸ روز آینده)',
        status: 'warning',
        recommendedAction: 'خرید بسته تکمیلی ۵,۰۰۰ عددی پیامک'
      },
      {
        resource: 'پایانه‌های فعال صندوق (Active POS Terminals)',
        current: '14',
        limit: '16',
        percent: 87,
        period: 'مداوم',
        resetDate: 'بدون بازنشانی',
        warningThreshold: '90%',
        hardLimit: '16',
        source: 'مجموع سهمیه ناوگان فعال',
        forecast: 'ظرفیت پاسخگوی ۲ صندوق جدید',
        status: 'normal',
        recommendedAction: 'وضعیت نرمال ناوگان'
      }
    ];

    const formatToman = (value, fallback = 'نامشخص') => value == null ? fallback : Number(value).toLocaleString('fa-IR');
    const formatLimit = (value, unit) => value == null ? 'نامشخص' : `${Number(value).toLocaleString('fa-IR')} ${unit}`;
    const pulseUnavailable = isProduction && pulse.dataStatus === 'unavailable';
    const taxSummaryUnavailable = isProduction && (!taxSummaryAvailable || taxSummary.dataStatus === 'unavailable');
    const hasUnavailableSource = isProduction && (!planCatalogAvailable || !moduleCatalogAvailable || !globalKillswitchesAvailable || !restaurantsAvailable || !subscriptionsAvailable || !invoiceLedgerAvailable || !pendingLicensesAvailable || !billingExceptionsAvailable || !taxSummaryAvailable);

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

        ${hasUnavailableSource ? `
          <div class="alert alert-warning" role="status" style="margin-bottom: 1rem;">
            بعضی اطلاعات از کنترل‌پلین دریافت نشد؛ مقدار ناموجود «نامشخص» است و به‌صورت صفر یا وضعیت سالم نمایش داده نمی‌شود.
          </div>
        ` : ''}
        ${isProduction && globalKillswitchesAvailable && !globalKillMutationsAvailable ? `
          <div class="alert alert-warning" role="status" style="margin-bottom: 1rem;">
            وضعیت کلیدهای اضطراری دریافت شد، اما پخش توقف به همهٔ رستوران‌ها هنوز عملیاتی نیست؛ تغییر سراسری از این صفحه غیرفعال است.
          </div>
        ` : ''}

        <!-- Commercial Pulse Metrics Banner -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
          <div class="card" style="padding: 1.15rem; border-radius: 12px; border: 1px solid var(--border, #E5E7EB); background: var(--card, #FFF);">
            <div style="font-size: 0.8rem; color: var(--text-secondary, #666); margin-bottom: 0.35rem;">درآمد ماهانه تکرارشونده (MRR)</div>
            <div style="font-size: 1.35rem; font-weight: 800; font-family: var(--font-mono); color: #2563EB;">
              ${pulseUnavailable ? 'نامشخص' : formatToman(pulse.mrrToman)} <span style="font-size: 0.8rem; font-weight: normal; color: var(--text-secondary, #666);">${pulseUnavailable ? '' : 'تومان'}</span>
            </div>
            <div style="font-size: 0.75rem; color: ${pulseUnavailable ? 'var(--text-secondary, #666)' : '#10B981'}; margin-top: 0.25rem;">
              ${pulseUnavailable ? 'داده عملیاتی از Control Plane دریافت نشد' : `برآورد بر مبنای ${pulse.activeTenantsCount || restaurants.length} مجموعه فعال ناوگان`}
            </div>
          </div>

          <div class="card" style="padding: 1.15rem; border-radius: 12px; border: 1px solid var(--border, #E5E7EB); background: var(--card, #FFF);">
            <div style="font-size: 0.8rem; color: var(--text-secondary, #666); margin-bottom: 0.35rem;">مجموع وصولی‌های ثبت‌شده</div>
            <div style="font-size: 1.35rem; font-weight: 800; font-family: var(--font-mono); color: #10B981;">
              ${pulseUnavailable ? 'نامشخص' : formatToman(pulse.collectedToman)} <span style="font-size: 0.8rem; font-weight: normal; color: var(--text-secondary, #666);">${pulseUnavailable ? '' : 'تومان'}</span>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary, #666); margin-top: 0.25rem;">
              ${pulseUnavailable ? 'دفتر وصول از منبع عملیاتی دریافت نشد' : 'مجموع وصولی‌های ثبت‌شده در سامانه مالی'}
            </div>
          </div>

          <div class="card" style="padding: 1.15rem; border-radius: 12px; border: 1px solid var(--border, #E5E7EB); background: var(--card, #FFF);">
            <div style="font-size: 0.8rem; color: var(--text-secondary, #666); margin-bottom: 0.35rem;">لایسنس‌های در انتظار تخصیص</div>
            <div style="font-size: 1.35rem; font-weight: 800; font-family: var(--font-mono); color: ${pendingInvoices.length > 0 ? '#F59E0B' : (isProduction && !pendingLicensesAvailable ? '#6B7280' : '#10B981')};">
              ${isProduction && !pendingLicensesAvailable ? 'نامشخص' : `${pendingInvoices.length} فاکتور`}
            </div>
            <div style="font-size: 0.75rem; color: ${pendingInvoices.length > 0 ? '#D97706' : 'var(--text-secondary, #666)'}; margin-top: 0.25rem;">
              ${pendingInvoices.length > 0 ? 'نیازمند پیگیری تخصیص لایسنس' : (isProduction && !pendingLicensesAvailable ? 'وضعیت تخصیص از منبع مالی دریافت نشد' : (isProduction ? 'فاکتور در انتظار تخصیص ثبت نشده است' : 'تمامی لایسنس‌ها مستقر شده‌اند'))}
            </div>
          </div>

          <div class="card" style="padding: 1.15rem; border-radius: 12px; border: 1px solid var(--border, #E5E7EB); background: var(--card, #FFF);">
            <div style="font-size: 0.8rem; color: var(--text-secondary, #666); margin-bottom: 0.35rem;">مطالبات در دوره مهلت (At-Risk)</div>
            <div style="font-size: 1.35rem; font-weight: 800; font-family: var(--font-mono); color: ${exceptions.length > 0 ? '#EF4444' : (isProduction && !billingExceptionsAvailable ? '#6B7280' : '#10B981')};">
              ${isProduction && !billingExceptionsAvailable ? 'نامشخص' : `${exceptions.length} حساب`}
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary, #666); margin-top: 0.25rem;">
              ${exceptions.length > 0 ? `${formatToman(pulse.atRiskToman)} تومان در مهلت پرداخت` : (isProduction && !billingExceptionsAvailable ? 'وضعیت مطالبات از منبع مالی دریافت نشد' : (isProduction ? 'مطالبهٔ سررسیدگذشته ثبت نشده است' : 'وصول کلیه مطالبات تا این لحظه'))}
            </div>
          </div>
        </div>

        <!-- Section Navigation Tabs (§3.3 & §59) -->
        <nav class="sub-nav-tabs" style="display: flex; gap: 0.5rem; margin-bottom: 1.5rem; border-bottom: 1px solid var(--border, #E5E7EB); padding-bottom: 0.5rem; overflow-x: auto;">
          <a href="#commercial?section=modules" class="btn ${activeSection === 'modules' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="white-space: nowrap;">
            📦 کاتالوگ ماژول‌ها و توانمندی‌ها (${isProduction && !moduleCatalogAvailable ? '—' : modules.length})
          </a>
          <a href="#commercial?section=plans" class="btn ${activeSection === 'plans' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="white-space: nowrap;">
            ▣ پلن‌ها و محدودیت‌ها (${isProduction && !planCatalogAvailable ? '—' : plans.length})
          </a>
          <a href="#commercial?section=subscriptions" class="btn ${activeSection === 'subscriptions' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="white-space: nowrap;">
            📋 اشتراک‌های ناوگان (${isProduction && !subscriptionsAvailable ? '—' : subscriptions.length})
          </a>
          <a href="#commercial?section=billing" class="btn ${activeSection === 'billing' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="white-space: nowrap;">
            💳 فاکتورها و تسویه‌ها (${isProduction && !invoiceLedgerAvailable ? '—' : allInvoices.length})
          </a>
          <a href="#commercial?section=quotas" class="btn ${activeSection === 'quotas' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="white-space: nowrap;">
            📊 سهمیه‌ها و مصرف منابع
          </a>
          <a href="#commercial?section=reconciliation" class="btn ${activeSection === 'reconciliation' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="white-space: nowrap;">
            ⚖️ تطبیق درآمد و صف مغایرت‌ها ${pendingInvoices.length > 0 ? `<span class="badge badge-warning" style="margin-right: 0.3rem;">${pendingInvoices.length} مغایرت</span>` : (isProduction && !pendingLicensesAvailable ? '<span class="badge badge-neutral" style="margin-right: 0.3rem;">وضعیت نامشخص</span>' : '')}
          </a>
        </nav>

        <!-- Tab 1: Business Modules Catalog -->
        ${activeSection === 'modules' ? `
          <div>
            <div style="margin-bottom: 1.25rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
              <div>
                <strong style="font-size: 1rem;">کاتالوگ ماژول‌های پلتفرم سالسا</strong>
                <span style="font-size: 0.8rem; color: #666; display: block;">${isProduction && !moduleCatalogAvailable ? 'کاتالوگ ماژول از کنترل‌پلین دریافت نشد.' : `${modules.length} ماژول در کاتالوگ محصول`}</span>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem;">
              ${modules.map(m => {
                const isKilled = Boolean(globalKillswitches[m.key]?.killed);
                const lifecycleLabels = { planned: 'برنامه‌ریزی', alpha: 'آلفا', beta: 'بتا', ga: 'پایدار', deprecated: 'در حال بازنشستگی', retired: 'بازنشسته' };
                const lifecycleClass = m.lifecycle === 'ga' ? 'badge-success' : (m.lifecycle === 'beta' ? 'badge-warning' : 'badge-neutral');
                const hasApprovedPrice = m.catalogProvenance?.priceMeaning === 'approved_customer_tariff' &&
                  m.defaultPriceToman != null && Number.isFinite(Number(m.defaultPriceToman));
                const priceLabel = m.commercialState === 'included'
                  ? 'شامل هسته پلتفرم'
                  : (m.commercialState === 'quote_only')
                    ? 'نیازمند برآورد اختصاصی'
                    : hasApprovedPrice
                      ? `${Number(m.defaultPriceToman).toLocaleString('fa-IR')} تومان / ماه`
                      : 'قیمت مصوب ثبت نشده';
                const adoptionCount = restaurants.filter(r => {
                  const grants = entitlementsRepo?.getTenantGrants ? entitlementsRepo.getTenantGrants(r.id) : null;
                  return (grants && grants[m.key]?.granted) || (r.plan && r.plan.toLowerCase().includes('scale')) || (m.key === 'pos' || m.key === 'menu_qr');
                }).length;
                return `
                  <div class="card" style="padding: 1.25rem; border-radius: 10px; border: ${isKilled ? '1px solid #EF4444; background: #FEF2F2;' : '1px solid var(--salsa-border, #E5E7EB);'}; display: flex; flex-direction: column; justify-content: space-between;">
                    <div>
                      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                          <span style="font-size: 1.3rem;">${esc(m.icon)}</span>
                          <strong style="font-size: 0.95rem;">${esc(m.nameFa)}</strong>
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.35rem;">
                          <span class="badge badge-neutral" style="font-size: 0.75rem;">${isProduction ? 'میزان استفاده نامشخص' : `${adoptionCount} مجموعه فعال`}</span>
                          ${isKilled ? `
                            <span class="badge badge-danger" title="${esc(globalKillswitches[m.key]?.reason || '')}">
                              توقف اضطراری
                            </span>
                          ` : `
                            <span class="badge ${lifecycleClass}">${esc(lifecycleLabels[m.lifecycle] || m.lifecycle || 'نامشخص')}</span>
                          `}
                        </div>
                      </div>
                      <p style="font-size: 0.8rem; color: ${isKilled ? '#991B1B' : '#666'}; line-height: 1.5; margin: 0 0 0.75rem 0;">
                        ${esc(m.descriptionFa)}
                      </p>
                      <div style="font-size: 0.75rem; color: #888; font-family: var(--font-mono); direction: ltr; text-align: right; margin-bottom: 0.75rem;">
                        کلیدهای فنی: ${Array.isArray(m.technicalFeatures) ? m.technicalFeatures.join(', ') : 'نامشخص'}
                      </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 0.6rem; border-top: 1px dashed ${isKilled ? '#FCA5A5' : '#EEE'}; font-size: 0.8rem;">
                      <span>مدل فروش: ${esc(priceLabel)}</span>
                      ${m.controllable === false ? `
                        <span class="badge badge-neutral">هسته اجباری؛ غیرقابل قطع</span>
                      ` : isKilled && isProduction && !globalKillMutationsAvailable ? `
                        <button type="button" class="btn btn-ghost btn-xs" disabled title="${esc(globalKillCapabilityReason)}">
                          وضعیت توقف ثبت شده؛ تغییر سراسری در دسترس نیست
                        </button>
                      ` : isKilled ? `
                        <button type="button" class="btn btn-primary btn-xs" onclick="window.GodModeCommercial ? window.GodModeCommercial.openRestoreModuleModal('${esc(m.key)}') : null">
                          ✓ فعال‌سازی مجدد
                        </button>
                      ` : (isProduction && (!globalKillswitchesAvailable || !globalKillMutationsAvailable) ? `
                        <button type="button" class="btn btn-ghost btn-xs" disabled title="${esc(!globalKillswitchesAvailable ? 'وضعیت کلید کنترل از کنترل‌پلین دریافت نشد' : globalKillCapabilityReason)}">
                          ${globalKillMutationsAvailable ? 'وضعیت کنترل دریافت نشد' : 'توقف سراسری هنوز عملیاتی نیست'}
                        </button>
                      ` : `
                        <button type="button" class="btn btn-ghost btn-xs text-danger" onclick="window.GodModeCommercial ? window.GodModeCommercial.openGlobalKillSwitchModal('${esc(m.key)}') : null">
                          توقف اضطراری سراسری…
                        </button>
                      `)}
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
                          ${isProduction && !restaurantsAvailable ? 'پذیرش نامشخص' : `${activeCount} مجموعه فعال (${fleetPercent}٪)`}
                        </span>
                      </div>
                      <p style="font-size: 0.85rem; color: var(--text-secondary, #666); margin-bottom: 0.85rem; line-height: 1.5;">${esc(p.description || '')}</p>
                        <div style="font-size: 1.35rem; font-weight: 800; color: #2563EB; margin-bottom: 1rem;">
                        ${p.priceToman == null ? 'نامشخص' : Number(p.priceToman).toLocaleString('fa-IR')} <span style="font-size: 0.8rem; font-weight: normal; color: var(--text-secondary, #666);">${p.priceToman == null ? '' : 'تومان / ماه'}</span>
                      </div>

                      <!-- Hardware & Quotas Limits Grid -->
                      <div style="background: var(--surface-2, #F9FAFB); border-radius: 8px; padding: 0.75rem 0.85rem; font-size: 0.8rem; display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 1rem; border: 1px solid var(--border, #F3F4F6);">
                        <div style="display: flex; justify-content: space-between;">
                          <span style="color: var(--text-secondary, #666);">پایانه‌های صندوق مجاز (POS):</span>
                          <strong style="font-family: var(--font-mono);">${formatLimit(p.limits?.maxPosDevices, 'دستگاه')}</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                          <span style="color: var(--text-secondary, #666);">سقف تعداد شعب مجاز:</span>
                          <strong style="font-family: var(--font-mono);">${formatLimit(p.limits?.maxBranches, 'شعبه')}</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                          <span style="color: var(--text-secondary, #666);">سهمیه ماهانه پیامک:</span>
                          <strong style="font-family: var(--font-mono);">${formatLimit(p.limits?.smsMonthlyQuota, 'پیامک')}</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                          <span style="color: var(--text-secondary, #666);">فضای ذخیره‌سازی داده:</span>
                          <strong style="font-family: var(--font-mono);">${formatLimit(p.limits?.storageGb, 'GB')}</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                          <span style="color: var(--text-secondary, #666);">حداکثر پرسنل و کاربران:</span>
                          <strong style="font-family: var(--font-mono);">${formatLimit(p.limits?.maxUsers, 'کاربر')}</strong>
                        </div>
                      </div>

                      <!-- Included Modules Badges -->
                      <div style="font-size: 0.85rem;">
                        <strong style="font-size: 0.8rem; color: var(--foreground, #444); display: block; margin-bottom: 0.5rem;">ماژول‌های تجاری این پلن:</strong>
                        <div style="flex; flex-wrap: wrap; gap: 0.35rem;">
                          ${(Array.isArray(p.includedModules) ? p.includedModules : []).map(modKey => {
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
                  <span style="font-size: 0.8rem; color: var(--text-secondary, #D97706);">پرداخت ثبت‌شده و منتظر فعال‌سازی نهایی ماژول‌ها</span>
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
                            ${(inv.totalAmount ?? inv.total ?? inv.amount) == null ? 'نامشخص' : `${Number(inv.totalAmount ?? inv.total ?? inv.amount).toLocaleString('fa-IR')} تومان`}
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
            ` : (isProduction && !pendingLicensesAvailable ? '<div class="alert alert-warning" role="status">وضعیت تخصیص لایسنس از کنترل‌پلین دریافت نشد.</div>' : '')}

            <!-- Section B: Overdue Accounts & Grace Exceptions -->
            <div class="card" style="border-radius: 12px; border: 1px solid var(--border, var(--salsa-border, #E5E7EB)); overflow: hidden; background: var(--card, #FFF);">
              <div class="card-header" style="background: var(--surface-2, var(--salsa-surface-subtle, #F9FAFB)); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border, var(--salsa-border, #E5E7EB)); display: flex; justify-content: space-between; align-items: center;">
                <strong style="font-size: 0.95rem; color: var(--text-primary, #111);">فاکتورهای معوق و حساب‌های نیازمند پیگیری (${isProduction && !billingExceptionsAvailable ? 'نامشخص' : exceptions.length})</strong>
                <span style="font-size: 0.8rem; color: var(--text-secondary, #666);">رسیدگی به دوره مهلت (Grace Period) ناوگان</span>
              </div>
              <div class="card-body" style="padding: 0;">
                ${exceptions.length === 0 && isProduction && !billingExceptionsAvailable ? `
                  <div role="status" style="padding: 2rem; text-align: center; color: var(--text-secondary, #666);">وضعیت مطالبات از کنترل‌پلین دریافت نشد.</div>
                ` : exceptions.length === 0 ? `
                  <div style="padding: 3rem; text-align: center; color: var(--text-secondary, #666);">
                    <strong style="display: block; margin-bottom: 0.25rem; color: var(--text-primary, #111);">مورد معوقی در دفتر مطالبات ثبت نشده است</strong>
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
                    <strong style="font-size: 0.95rem;">دفتر صورتحساب و وضعیت مالیاتی (${isProduction && !invoiceLedgerAvailable ? 'نامشخص' : allInvoices.length})</strong>
                    <span style="font-size: 0.8rem; color: var(--text-secondary, #666); display: block;">جزئیات سند و مالیات فقط از دادهٔ ثبت‌شده در کنترل‌پلین نمایش داده می‌شود.</span>
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
                  <strong style="font-size: 1.15rem; color: var(--foreground, #111827); font-family: var(--font-mono);">${taxSummaryUnavailable ? 'نامشخص' : `${formatToman(taxSummary.grossInvoicedToman)} تومان`}</strong>
                </div>
                <div style="background: var(--card, #FFF); padding: 0.75rem 1rem; border-radius: 8px; border: 1px solid var(--border, #E5E7EB);">
                  <span style="font-size: 0.75rem; color: #16A34A; display: block;">ارزش افزوده وصولی</span>
                  <strong style="font-size: 1.15rem; color: #16A34A; font-family: var(--font-mono);">${taxSummaryUnavailable ? 'نامشخص' : `${formatToman(taxSummary.collectedVatToman)} تومان`}</strong>
                </div>
                <div style="background: var(--card, #FFF); padding: 0.75rem 1rem; border-radius: 8px; border: 1px solid var(--border, #E5E7EB);">
                  <span style="font-size: 0.75rem; color: var(--text-secondary, #666); display: block;">وضعیت سامانه مودیان</span>
                  ${taxSummaryUnavailable
                    ? `<strong style="font-size: 0.95rem; color: var(--text-secondary, #666);">نامشخص</strong><span style="display:block;font-size:0.7rem;color:var(--text-secondary,#666);">وضعیت اتصال از منبع مالی دریافت نشد</span>`
                    : taxSummary.moadianStatus === 'Integrated'
                    ? `<strong style="font-size: 0.95rem; color: #16A34A; display: flex; align-items: center; gap: 0.35rem; margin-top: 0.2rem;">
                         <span style="width: 8px; height: 8px; border-radius: 50%; background: #16A34A; display: inline-block;"></span>
                         متصل (تایید شده)
                       </strong>
                       <span style="display: block; font-size: 0.7rem; color: var(--text-tertiary, #888); font-family: var(--font-mono); margin-top: 2px;">حافظه: ${taxSummary.moadianMemoryId || 'فعال'}</span>`
                    : (taxSummary.moadianStatus === 'Unavailable'
                      ? `<strong style="font-size: 0.95rem; color: #DC2626; display: flex; align-items: center; gap: 0.35rem; margin-top: 0.2rem;">
                           <span style="width: 8px; height: 8px; border-radius: 50%; background: #DC2626; display: inline-block;"></span>
                           در دسترس نبودن سامانه
                         </strong>
                         <span style="display: block; font-size: 0.7rem; color: #DC2626; margin-top: 2px;">خطا در برقراری ارتباط</span>`
                      : `<strong style="font-size: 0.95rem; color: #D97706; display: flex; align-items: center; gap: 0.35rem; margin-top: 0.2rem;">
                           <span style="width: 8px; height: 8px; border-radius: 50%; background: #D97706; display: inline-block;"></span>
                           عدم اتصال (پیکربندی نشده)
                         </strong>
                         <span style="display: block; font-size: 0.7rem; color: var(--text-tertiary, #888); margin-top: 2px;">کلید مودیان تنظیم نشده</span>`
                      )
                  }
                </div>
                <div style="background: var(--card, #FFF); padding: 0.75rem 1rem; border-radius: 8px; border: 1px solid var(--border, #E5E7EB);">
                  <span style="font-size: 0.75rem; color: var(--text-secondary, #666); display: block;">اسناد مالیاتی معتبر</span>
                  <strong style="font-size: 1.15rem; color: var(--foreground, #111827); font-family: var(--font-mono);">${isProduction && !invoiceLedgerAvailable ? 'نامشخص' : allInvoices.length} <span style="font-size: 0.75rem; font-weight: normal;">${isProduction && !invoiceLedgerAvailable ? '' : 'فقره فاکتور'}</span></strong>
                </div>
              </div>

              <!-- Search and Filters Bar -->
              <div style="padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border, #E5E7EB); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
                <div style="flex: 1; min-width: 240px;">
                  <input 
                    type="text" 
                    id="commercial-invoice-search" 
                    class="form-control" 
                    placeholder="🔍 جستجو در شناسه فاکتور، نام مجموعه یا کد پیگیری پرداخت..." 
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
                      <th style="padding: 0.75rem 1rem;">مبلغ و مالیات ثبت‌شده</th>
                      <th style="padding: 0.75rem 1rem;">وضعیت پرداخت</th>
                      <th style="padding: 0.75rem 1rem;">استقرار لایسنس</th>
                      <th style="padding: 0.75rem 1rem;">کد پیگیری پرداخت</th>
                      <th style="padding: 0.75rem 1rem; text-align: left;">سند مالیاتی</th>
                    </tr>
                  </thead>
                  <tbody id="commercial-invoices-tbody">
                    ${allInvoices.length === 0 ? `<tr><td colspan="7" style="padding:2rem;text-align:center;color:var(--text-secondary,#666);">${isProduction && !invoiceLedgerAvailable ? 'دفتر فاکتورها از کنترل‌پلین دریافت نشد.' : 'فاکتوری در دفتر ثبت نشده است.'}</td></tr>` : ''}
                    ${allInvoices.map(inv => {
                      const searchable = `${inv.id || ''} ${inv.tenantId || ''} ${inv.tenantName || ''} ${inv.paymentRef || ''}`.toLowerCase();
                      const subtotal = inv.subtotalAmount ?? inv.amount ?? null;
                      const totalWithVat = inv.totalAmount ?? (subtotal != null && inv.vatAmount != null ? subtotal + inv.vatAmount : null);
                      const statusLabel = inv.status === 'paid' ? 'تسویه‌شده' : (inv.status === 'pending' || inv.status === 'overdue' ? 'در انتظار پرداخت' : 'نامشخص');
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
                          ${totalWithVat == null ? 'نامشخص' : `${Number(totalWithVat).toLocaleString('fa-IR')} تومان`}
                        </td>
                        <td style="padding: 0.75rem 1rem;">
                          <span class="badge ${inv.status === 'paid' ? 'badge-success' : (inv.status === 'pending' || inv.status === 'overdue' ? 'badge-warning' : 'badge-neutral')}" title="وضعیت: ${esc(inv.status || 'نامشخص')}">
                            ${statusLabel}
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
                              📄 جزئیات سند
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
                <strong style="font-size: 0.95rem;">قراردادها و اشتراک‌های فعال ناوگان (${isProduction && !subscriptionsAvailable ? 'نامشخص' : subscriptions.length})</strong>
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
                  ${subscriptions.length === 0 ? `<tr><td colspan="7" style="padding:2rem;text-align:center;color:var(--text-secondary,#666);">${isProduction && !subscriptionsAvailable ? 'فهرست اشتراک‌ها از کنترل‌پلین دریافت نشد.' : 'اشتراکی برای نمایش ثبت نشده است.'}</td></tr>` : ''}
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
              ${quotaMetrics.map(q => `
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
                <span class="badge ${pendingInvoices.length > 0 ? 'badge-warning' : (isProduction && (!pendingLicensesAvailable || !billingExceptionsAvailable) ? 'badge-neutral' : 'badge-success')} ">
                  ${pendingInvoices.length > 0 ? `${pendingInvoices.length} مغایرت فعال` : (isProduction && (!pendingLicensesAvailable || !billingExceptionsAvailable) ? 'وضعیت نامشخص' : 'مغایرت ثبت‌نشده')}
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

                    ${pendingInvoices.length === 0 && exceptions.length === 0 && isProduction && (!pendingLicensesAvailable || !billingExceptionsAvailable) ? `
                      <tr><td colspan="5" style="padding:2rem;text-align:center;color:var(--text-secondary,#666);">دادهٔ کافی برای تطبیق درآمد و لایسنس دریافت نشد.</td></tr>
                    ` : pendingInvoices.length === 0 && exceptions.length === 0 ? `
                      <tr>
                        <td colspan="5" style="padding: 2.5rem; text-align: center; color: #666;">
                          <strong>مغایرتی در داده‌های دریافت‌شده ثبت نشده است</strong>
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

    async viewInvoiceDetails(invoiceId) {
      const commRepo = global.CommercialRepository;
      let details = null;
      const isProduction = Boolean(
        global.__SALSA_RUNTIME_CONFIG__?.environment === 'production' ||
        global.GodModeAppMode?.isProduction?.()
      );
      try {
        if (commRepo && typeof commRepo.getInvoiceDetailsForPlatform === 'function') {
          details = await commRepo.getInvoiceDetailsForPlatform(invoiceId);
        } else if (!isProduction && commRepo && typeof commRepo.getInvoiceDetails === 'function') {
          details = commRepo.getInvoiceDetails(invoiceId);
        }
      } catch (error) {
        if (global.GMToast) global.GMToast.show('دریافت جزئیات صورتحساب از کنترل‌پلین انجام نشد.', 'warning');
        return;
      }
      if (!details) {
        if (global.GMToast) global.GMToast.show('مشخصات فاکتور یافت نشد.', 'warning');
        return;
      }

      if (isProduction) {
        const amount = value => Number.isSafeInteger(Number(value))
          ? `${Number(value).toLocaleString('fa-IR')} تومان`
          : 'نامشخص';
        const date = value => {
          const parsed = value ? new Date(value) : null;
          return parsed && Number.isFinite(parsed.getTime()) ? parsed.toLocaleString('fa-IR') : '—';
        };
        const statusLabels = { paid: 'تسویه‌شده', pending: 'در انتظار پرداخت', overdue: 'معوق', failed: 'ناموفق', refunded: 'بازپرداخت‌شده' };
        const lines = (details.lineItems || []).map((item, index) => `
          <tr style="border-bottom:1px solid var(--border,#E5E7EB)">
            <td style="padding:.55rem">${index + 1}</td>
            <td style="padding:.55rem">${esc(item.description || item.name || details.planCode || 'اشتراک')}</td>
            <td style="padding:.55rem;text-align:center">${esc(item.quantity ?? 1)}</td>
            <td style="padding:.55rem;text-align:left">${amount(item.unitPriceToman)}</td>
            <td style="padding:.55rem;text-align:left">${amount(item.totalToman)}</td>
          </tr>`).join('');
        const content = `
          <section style="text-align:right;line-height:1.7">
            <header style="display:flex;justify-content:space-between;gap:.75rem;flex-wrap:wrap;border-bottom:1px solid var(--border,#E5E7EB);padding-bottom:.75rem">
              <div><strong>صورتحساب اشتراک پلتفرم</strong><div>مجموعه: ${esc(details.tenantName || details.tenantId || '—')}</div></div>
              <div><span>شماره: </span><strong dir="ltr">${esc(details.invoiceNumber || details.id)}</strong><div>${esc(statusLabels[details.status] || 'نامشخص')}</div></div>
            </header>
            <div style="overflow:auto;margin:.75rem 0">
              <table style="width:100%;border-collapse:collapse;min-width:520px">
                <thead><tr><th>ردیف</th><th>شرح</th><th>تعداد</th><th>مبلغ واحد</th><th>جمع</th></tr></thead>
                <tbody>${lines || '<tr><td colspan="5" style="padding:1rem;text-align:center">ردیف صورتحساب در snapshot ثبت نشده است.</td></tr>'}</tbody>
              </table>
            </div>
            <dl style="display:grid;grid-template-columns:1fr auto;gap:.4rem .8rem;margin:0">
              <dt>مبلغ پایه</dt><dd>${amount(details.subtotalAmount)}</dd>
              <dt>تخفیف ثبت‌شده</dt><dd>${amount(details.discountAmount)}</dd>
              <dt>ارزش افزوده ثبت‌شده</dt><dd>${amount(details.vatAmount)}</dd>
              <dt><strong>مبلغ نهایی</strong></dt><dd><strong>${amount(details.totalAmount)}</strong></dd>
              <dt>تاریخ صدور</dt><dd>${date(details.createdAt)}</dd>
              <dt>تاریخ تسویه</dt><dd>${date(details.paidAt)}</dd>
              <dt>مرجع تسویه</dt><dd dir="ltr">${esc(details.settlementReference || '—')}</dd>
            </dl>
            <p style="margin:.9rem 0 0;padding:.65rem;background:var(--surface-2,#F3F4F6);border-radius:8px;font-size:.78rem">
              این snapshot صورتحساب اشتراک است؛ گواهی صدور یا ثبت در سامانهٔ مودیان در منبع داده موجود نیست.
            </p>
          </section>`;
        if (global.GMApp && typeof global.GMApp.openModal === 'function') {
          global.GMApp.openModal(`جزئیات صورتحساب ${details.invoiceNumber || details.id}`, content, null, { cancelText: 'بستن' });
        }
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

    openIssueInvoiceModal() {
      const commRepo = global.CommercialRepository;
      const restRepo = global.RestaurantsRepository;
      const tenants = restRepo && typeof restRepo.getKnownTenantsSync === 'function' ? restRepo.getKnownTenantsSync() : [];

      const optionsHtml = tenants.map(t => `<option value="${esc(t.id)}">${esc(t.name)} (${esc(t.id)})</option>`).join('');

      const formHtml = `
        <div style="font-size: 0.9rem; text-align: right;">
          <p style="color: #666; margin-bottom: 1rem; font-size: 0.85rem;">
            صدور فاکتور رسمی جدید با محاسبه خودکار ۱۰٪ مالیات بر ارزش افزوده و صدور شناسه سامانه مودیان.
          </p>
          <div class="form-group" style="margin-bottom: 0.85rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">مجموعه طرف قرارداد</label>
            <select id="modal-inv-tenant" class="form-control" style="width: 100%; padding: 0.5rem;">
              ${optionsHtml || '<option value="" disabled selected>هیچ مجموعه واقعی ثبت نشده است</option>'}
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 0.85rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">شرح خدمت یا فاکتور</label>
            <input type="text" id="modal-inv-desc" class="form-control" value="اشتراک ۳ ماهه و پشتیبانی اختصاصی سالسا" style="width: 100%;" required />
          </div>
          <div class="form-group" style="margin-bottom: 0.85rem;">
            <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">مبلغ پایه قبل از مالیات (تومان)</label>
            <input type="number" id="modal-inv-amount" class="form-control" value="3000000" style="width: 100%; direction: ltr;" required />
          </div>
          <div style="font-size: 0.8rem; background: #F3F4F6; padding: 0.6rem 0.85rem; border-radius: 6px; margin-bottom: 1rem; color: #4B5563;">
            💡 <strong>محاسبه خودکار مالیات:</strong> ۱۰٪ مالیات ارزش افزوده به مبلغ فوق افزوده شده و فاکتور نهایی صادر خواهد شد.
          </div>
        </div>
      `;

      if (global.GMApp && typeof global.GMApp.openModal === 'function') {
        global.GMApp.openModal('صدور صورتحساب رسمی پلتفرم سالسا', formHtml, () => {
          const tenantInput = document.getElementById('modal-inv-tenant');
          const descInput = document.getElementById('modal-inv-desc');
          const amountInput = document.getElementById('modal-inv-amount');

          const tenantId = tenantInput ? tenantInput.value : '';
          const description = descInput ? descInput.value.trim() : 'خدمات سالسا';
          const amount = amountInput ? parseInt(amountInput.value, 10) : 3000000;

          if (!tenantId) {
            if (global.GMToast) global.GMToast.show('ابتدا یک مجموعه واقعی ثبت کنید.', 'warning');
            return false;
          }
          if (!amount || amount <= 0) {
            if (global.GMToast) global.GMToast.show('مبلغ فاکتور باید بزرگتر از صفر باشد.', 'warning');
            return false;
          }

          if (commRepo && typeof commRepo.issueInvoice === 'function') {
            commRepo.issueInvoice(tenantId, { description, amount });
          }
          if (global.GMToast) global.GMToast.show('فاکتور رسمی با موفقیت صادر و در سامانه مودیان ثبت شد.', 'success');
          if (global.GodModeRouter) global.GodModeRouter.handleRoute();
          return true;
        }, { confirmText: 'صدور و ثبت سند رسمی' });
      }
    },

    openGlobalKillSwitchModal(moduleKey) {
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
          if (global.CommercialRepository) {
            await global.CommercialRepository.toggleGlobalKillswitch(moduleKey, false, reason);
          }
          if (global.GMToast) global.GMToast.show(`دستور توقف سراسری ماژول «${moduleKey}» با موفقیت ثبت و اعمال شد.`, 'danger');
          if (global.GodModeRouter) global.GodModeRouter.handleRoute();
        }
      });
    },

    openRestoreModuleModal(moduleKey) {
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
          if (global.CommercialRepository) {
            await global.CommercialRepository.toggleGlobalKillswitch(moduleKey, true, reason);
          }
          if (global.GMToast) global.GMToast.show(`ماژول «${moduleKey}» مجدداً فعال شد.`, 'success');
          if (global.GodModeRouter) global.GodModeRouter.handleRoute();
        }
      });
    },

    openExtendGraceModal(tenantId, tenantName, additionalDays = 7) {
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
          if (global.CommercialRepository) {
            await global.CommercialRepository.extendGracePeriod(tenantId, additionalDays, reason);
          }
          if (global.GMToast) global.GMToast.show(`مهلت پرداخت «${tenantName}» به مدت ${additionalDays} روز تمدید گردید.`, 'success');
          if (global.GodModeRouter) global.GodModeRouter.handleRoute();
        }
      });
    },

    activateInvoiceLicense(invoiceId) {
      if (!global.GodModeConfirmDialog) return;
      global.GodModeConfirmDialog.show({
        title: `تخصیص و استقرار آنی لایسنس فاکتور ${invoiceId}`,
        severity: 'safe',
        message: `آیا از تخصیص ماژول‌ها و صدور لایسنس فعال برای فاکتور ${invoiceId} اطمینان دارید؟`,
        impactDetails: 'ماژول‌های خریداری‌شده فاکتور به کلاستر رستوران متصل و توکن دسترسی به‌روز خواهد شد.',
        requireReason: false,
        confirmText: 'تخصیص آنی لایسنس ⚡',
        onConfirm: async () => {
          const commRepo = global.CommercialRepository;
          if (commRepo && typeof commRepo.activateInvoiceLicense === 'function') {
            await commRepo.activateInvoiceLicense(invoiceId);
          }
          if (global.GMToast) global.GMToast.show(`لایسنس فاکتور ${invoiceId} با موفقیت تخصیص یافت و مستقر شد.`, 'success');
          if (global.GodModeRouter) global.GodModeRouter.handleRoute();
        }
      });
    },

    markPaid(invoiceId) {
      return this.openMarkPaidModal(invoiceId);
    },

    openMarkPaidModal(invoiceId) {
      if (global.GodModeCommandFramework && typeof global.GodModeCommandFramework.execute === 'function') {
        global.GodModeCommandFramework.execute('MarkInvoicePaid', { invoiceId });
      } else if (global.GMToast) {
        global.GMToast.show('فریم‌ورک فرمان در دسترس نیست.', 'warning');
      }
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
