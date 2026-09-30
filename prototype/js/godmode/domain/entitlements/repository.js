/**
 * prototype/js/godmode/domain/entitlements/repository.js
 *
 * Canonical Entitlement & Business Module Engine (superadmin.md §9).
 * Bridges commercial Business Modules with technical feature keys.
 * Single source of truth for effective entitlement evaluation.
 */

(function (global) {
  'use strict';

  // 1. Canonical Business Modules covering all 12 operational domains of WESTO
  const BUSINESS_MODULES = Object.freeze([
    // 1. Orders & POS
    {
      key: 'pos',
      nameFa: 'صندوق و سفارش‌گیری لمسی (POS)',
      descriptionFa: 'پایانه فروشگاهی، صدور فاکتور، تسویه چندبخشی، کارتخوان و تخفیف‌ها',
      icon: '📠',
      technicalFeatures: ['orders.pos', 'orders.fast_checkout', 'billing.invoicing', 'cash.drawers'],
      category: 'operations',
    },
    // 2. Kitchen & KDS
    {
      key: 'kds',
      nameFa: 'نمایشگر هوشمند آشپزخانه و بار (KDS)',
      descriptionFa: 'گردش کار آماده‌سازی غذا، ایستگاه‌های پخت، اکسپدایتر و زمان‌بندی سفارش',
      icon: '🍳',
      technicalFeatures: ['kitchen.kds', 'kitchen.stations', 'kitchen.expediter'],
      category: 'kitchen',
    },
    // 3. Digital Menu & QR
    {
      key: 'menu_qr',
      nameFa: 'منوی دیجیتال و QR سر میز',
      descriptionFa: 'منوی چندزبانه سر میز، کدهای QR اختصاصی میزها و گزینه‌های سفارشی غذا',
      icon: '📱',
      technicalFeatures: ['catalog.menu', 'catalog.modifiers', 'floor.qr', 'catalog.pricing'],
      category: 'experience',
    },
    // 4. Floor, Hall & Waiter
    {
      key: 'floor',
      nameFa: 'سالن، نقشه میزها و ترمینال گارسون',
      descriptionFa: 'مدیریت چیدمان میزها، ترمینال سیار گارسون، فراخوان مهمان و حق سرویس',
      icon: '🪑',
      technicalFeatures: ['floor.tables', 'staff.waiter', 'floor.service_charge'],
      category: 'floor',
    },
    // 5. Reservations & Waitlist
    {
      key: 'reservations',
      nameFa: 'رزرواسیون آنلاین و صف انتظار (Waitlist)',
      descriptionFa: 'تقویم رزرو میز، پیش‌دریافت بیعانه و صف انتظار هوشمند مهمانان حضوری',
      icon: '📅',
      technicalFeatures: ['booking.reservations', 'booking.waitlist', 'booking.deposit'],
      category: 'experience',
    },
    // 6. Delivery & Dispatch
    {
      key: 'delivery',
      nameFa: 'پیک، دیسپچ و ردیابی سفارشات',
      descriptionFa: 'مدیریت ناوگان پیک، محدوده‌های کرایه شهری و ردیابی زنده روی نقشه',
      icon: '🛵',
      technicalFeatures: ['delivery.dispatch', 'delivery.zones', 'delivery.tracking'],
      category: 'operations',
    },
    // 7. Payments & POS Terminal Link
    {
      key: 'payments',
      nameFa: 'درگاه آنلاین و اتصال کارتخوان (PC-POS)',
      descriptionFa: 'اتصال به درگاه‌های شاپرک و اتصال مستقیم نرم‌افزار به پوز بانکی',
      icon: '💳',
      technicalFeatures: ['payments.gateway', 'payments.terminal_link', 'cash.drawers'],
      category: 'finance',
    },
    // 8. Accounting, Tax & Finance
    {
      key: 'accounting',
      nameFa: 'حسابداری دوبل، دفاتر و سامانه مؤدیان',
      descriptionFa: 'دفتر کل، مغایرت بانکی، صورت سود و زیان، دارایی‌های ثابت و اتصال مؤدیان',
      icon: '📊',
      technicalFeatures: ['finance.workspace', 'finance.purchases', 'finance.reconciliation', 'finance.tax_adapter', 'finance.assets'],
      category: 'finance',
    },
    // 9. Inventory, Recipes & COGS
    {
      key: 'inventory',
      nameFa: 'انبارداری، فرمولاسیون و بهای تمام‌شده (COGS)',
      descriptionFa: 'کسر اتوماتیک مواد اولیه از انبار، آنالیز رسپی، کاردکس کالا و تدارکات',
      icon: '📦',
      technicalFeatures: ['stock.inventory', 'stock.recipes', 'stock.procurement'],
      category: 'management',
    },
    // 10. CRM, Loyalty & SMS
    {
      key: 'crm',
      nameFa: 'باشگاه مشتریان، کیف پول و پیامک (CRM)',
      descriptionFa: 'امتیازدهی، کیف پول اعتباری، کمپین‌های تخفیفی و پیامک‌های هوشمند خودکار',
      icon: '🎁',
      technicalFeatures: ['crm.loyalty', 'crm.wallet', 'marketing.campaigns', 'marketing.sms', 'crm.directory'],
      category: 'marketing',
    },
    // 11. Multi-Branch & Central Management
    {
      key: 'multi_branch',
      nameFa: 'مدیریت متمرکز هلدینگ و چندشعبه‌ای',
      descriptionFa: 'تلفیق مالی شعب چندگانه، گزارش‌های یکپارچه و انتقال کالا بین شعب',
      icon: '🏢',
      technicalFeatures: ['core.multi_branch', 'finance.consolidation', 'core.workspace'],
      category: 'scale',
    },
    // 12. Brand Website & White-label
    {
      key: 'website_brand',
      nameFa: 'وب‌سایت برند، دامنه اختصاصی و وایت‌لیبل',
      descriptionFa: 'دامنه اختصاصی با SSL خودکار، وب‌سایت مستقل و حذف نشان‌های پلتفرم',
      icon: '🌐',
      technicalFeatures: ['content.website', 'brand.custom_domain', 'brand.white_label'],
      category: 'brand',
    },
    // 13. Reports & AI Insights
    {
      key: 'analytics',
      nameFa: 'گزارش‌های مدیریتی و هوش تحلیلی',
      descriptionFa: 'داشبورد هوشمند فروش، ساعات پیک، بهینه‌ساز هزینه‌ها و پیش‌بینی فروش',
      icon: '📈',
      technicalFeatures: ['insights.reports', 'analytics.dashboard', 'analytics.export'],
      category: 'management',
    }
  ]);

  class EntitlementsRepository {
    constructor(client) {
      this.client = client || (typeof window !== 'undefined' ? window.ControlPlaneClient : null) || (typeof global !== 'undefined' ? global.ControlPlaneClient : null);
    }

    getBusinessModules() {
      return BUSINESS_MODULES;
    }

    requireClient(method = 'get') {
      const operation = { get: 'خواندن', post: 'ثبت', delete: 'لغو' }[method] || 'انجام درخواست';
      if (!this.client || typeof this.client[method] !== 'function') {
        throw new Error(`اتصال کنترل‌پلن یا امکان ${operation} در دسترس نیست؛ وضعیت محلی جایگزین منبع سرور نمی‌شود.`);
      }
      return this.client;
    }

    unwrapServerResponse(response, description) {
      if (!response || response.ok !== true || response.data === undefined) {
        throw new Error(`پاسخ معتبر از کنترل‌پلن برای ${description} دریافت نشد.`);
      }
      return response.data;
    }

    /**
     * Calculate Authoritative Effective Entitlements for a Tenant
     */
    async calculateEffectiveEntitlements(tenantId) {
      if (!tenantId) throw new Error('tenantId الزامی است.');
      const client = this.requireClient();
      const encodedTenantId = encodeURIComponent(tenantId);
      const [moduleResponse, effectiveResponse, tenantResponse] = await Promise.all([
        client.get('/api/control/policy/modules'),
        client.get(`/api/control/policy/effective/${encodedTenantId}`),
        client.get(`/api/control/tenants/${encodedTenantId}`)
      ]);
      const moduleData = this.unwrapServerResponse(moduleResponse, 'کاتالوگ ماژول‌ها');
      const effective = this.unwrapServerResponse(effectiveResponse, 'مجوزهای مؤثر مستأجر');
      const tenant = this.unwrapServerResponse(tenantResponse, 'پرونده مستأجر');
      if ((effective.tenantId && effective.tenantId !== tenantId) ||
          ((tenant.id || tenant.tenantId) && (tenant.id || tenant.tenantId) !== tenantId)) {
        throw new Error('شناسه مستأجر در پاسخ سرور با درخواست هم‌خوانی ندارد؛ نتیجه کنار گذاشته شد.');
      }
      const serverModules = Array.isArray(moduleData.modules) ? moduleData.modules : [];
      const serverFeatures = effective.features && typeof effective.features === 'object' ? effective.features : null;
      if (!serverFeatures || serverModules.length === 0) {
        throw new Error('کاتالوگ یا ارزیابی مؤثر سرور خالی است؛ وضعیت محلی جایگزین نشد.');
      }

      const modules = serverModules.map((module) => {
        const { priceMonthlyIrr: _unverifiedPrice, ...safeModule } = module;
        const keys = Array.isArray(module.technicalFeatures) ? module.technicalFeatures : [];
        if (!keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(serverFeatures, key))) {
          throw new Error(`ارزیابی سرور برای همه قابلیت‌های ماژول «${module.key}» موجود نیست.`);
        }
        const outcomes = keys.map(key => serverFeatures[key]);
        const enabledCount = outcomes.filter(outcome => outcome.enabled === true).length;
        const isEnabled = enabledCount === outcomes.length;
        const state = isEnabled ? 'enabled' : (enabledCount > 0 ? 'partial' : 'disabled');
        return {
          ...safeModule,
          state,
          isEnabled,
          enabledFeatureCount: enabledCount,
          totalFeatureCount: keys.length,
          reason: [...new Set(outcomes.map(outcome => outcome.reason).filter(Boolean))].join('؛ '),
          technicalFeatures: keys,
          primaryFeatureKey: keys[0]
        };
      });

      return {
        tenantId,
        tenantName: tenant.displayName || tenant.name || tenantId,
        tenantStatus: tenant.status || effective.tenantStatus || 'unknown',
        isSuspended: effective.isSuspended === true,
        modules,
        source: 'control-plane',
        observedAt: effective.effectiveFrom || effectiveResponse.meta?.observedAt || null
      };
    }

    /**
     * Authoritative Technical Feature Entitlement Evaluator
     */
    async getEffectiveEntitlements(tenantId) {
      if (!tenantId) throw new Error('برای خواندن مجوز مؤثر، شناسه مستأجر صریحاً لازم است.');
      const response = await this.requireClient('get').get(`/api/control/policy/effective/${encodeURIComponent(tenantId)}`);
      const effective = this.unwrapServerResponse(response, 'مجوزهای مؤثر مستأجر');
      if (effective.tenantId !== tenantId) throw new Error('پاسخ مجوز مؤثر متعلق به مستأجر درخواستی نیست.');
      return {
        tenantId,
        tenantStatus: effective.tenantStatus,
        isSuspended: effective.isSuspended === true,
        entitlements: effective.features || {},
        source: 'control-plane',
        observedAt: effective.effectiveFrom || response.meta?.observedAt || null
      };
    }

    /**
     * Operator module/feature status toggle
     */
    async setModuleStatus(tenantId, moduleOrFeatureKey, enabled, reason = '') {
      return this.setModuleOverride(tenantId, moduleOrFeatureKey, enabled ? 'allow' : 'deny', reason || 'تغییر وضعیت توسط اپراتور');
    }

    /**
     * Enable Business Module as an Add-on (Server-Authoritative, No duplicate sync)
     */
    async enableModuleAddon(tenantId, moduleKey, durationMonths = 1, metadata = {}) {
      if (!tenantId) throw new Error('شناسه مستأجر برای فعال‌سازی ماژول الزامی است.');
      const moduleDef = BUSINESS_MODULES.find(m => m.key === moduleKey);
      if (!moduleDef) throw new Error(`ماژول «${moduleKey}» معتبر نیست.`);

      const months = Number(durationMonths);
      if (!Number.isInteger(months) || months < 1 || months > 120) throw new Error('مدت مجوز باید بین ۱ تا ۱۲۰ ماه باشد.');

      const primaryKey = moduleDef.technicalFeatures[0];
      const payload = {
        tenantId,
        featureKey: primaryKey,
        grantKind: 'addon',
        durationMonths: months,
        metadata: {
          businessModule: moduleKey,
          moduleNameFa: moduleDef.nameFa,
          ...metadata
        }
      };

      const response = await this.requireClient('post').post('/api/control/policy/grants', payload);
      const result = this.unwrapServerResponse(response, 'ثبت مجوز افزونه');
      if (result.tenantId && result.tenantId !== tenantId) throw new Error('مجوز ثبت‌شده متعلق به مستأجر دیگری است.');
      return result;
    }

    /**
     * Disable / Cancel a Business Module Add-on
     */
    async disableModuleAddon(tenantId, moduleKey, reason = '') {
      if (!tenantId) throw new Error('شناسه مستأجر برای لغو ماژول الزامی است.');
      const moduleDef = BUSINESS_MODULES.find(m => m.key === moduleKey);
      const primaryKey = moduleDef ? moduleDef.technicalFeatures[0] : moduleKey;
      const response = await this.requireClient('delete').delete(`/api/control/policy/grants/${encodeURIComponent(tenantId)}/${encodeURIComponent(primaryKey)}`, {
        body: reason ? { reason } : undefined
      });
      const result = this.unwrapServerResponse(response, 'لغو مجوز افزونه');
      return { ...result, tenantId, moduleKey };
    }

    /**
     * Apply Operator Temporary Override with mandatory reason (superadmin.md §9.6)
     */
    async setModuleOverride(tenantId, moduleKey, state, decisionReason) {
      if (!tenantId) throw new Error('شناسه مستأجر برای ثبت استثنا الزامی است.');
      if (!decisionReason || !decisionReason.trim()) {
        throw new Error('برای ثبت استثنای اختصاصی، ذکر دلیل الزامی است.');
      }

      const moduleDef = BUSINESS_MODULES.find(m => m.key === moduleKey);
      const primaryKey = moduleDef ? moduleDef.technicalFeatures[0] : moduleKey;

      const payload = {
        tenantId,
        permissionKey: primaryKey,
        state: state === 'allow' ? 'allow' : 'deny',
        decisionReason: decisionReason.trim()
      };

      const response = await this.requireClient('post').post('/api/control/policy/overrides', payload);
      return this.unwrapServerResponse(response, 'ثبت استثنای مجوز');
    }

    /**
     * Operator 1-click toggle for a business module or technical feature
     * Updates policy grants & overrides on SALSA Control Plane and syncs directly to WESTO.
     */
    async toggleModuleForTenant(tenantId, moduleOrFeatureKey, targetState, reason = '') {
      if (!tenantId) throw new Error('شناسه رستوران (tenantId) الزامی است.');
      if (typeof targetState !== 'boolean') throw new Error('وضعیت هدف باید صریحاً فعال یا غیرفعال باشد.');
      const isEnabled = Boolean(targetState);
      const moduleDef = BUSINESS_MODULES.find(m => m.key === moduleOrFeatureKey);
      const technicalKeys = moduleDef ? moduleDef.technicalFeatures : [moduleOrFeatureKey];
      const primaryKey = technicalKeys[0];

      const response = await this.requireClient('post').post('/api/control/policy/toggle', {
        tenantId,
        featureKey: primaryKey,
        featureKeys: technicalKeys,
        enabled: isEnabled,
        reason: reason || (isEnabled ? `فعال‌سازی ماژول ${moduleDef?.nameFa || moduleOrFeatureKey}` : `غیرفعال‌سازی ماژول ${moduleDef?.nameFa || moduleOrFeatureKey}`)
      });
      const responseData = this.unwrapServerResponse(response, 'تغییر مجوز ماژول');
      if (responseData.tenantId !== tenantId || responseData.enabled !== isEnabled ||
          !Array.isArray(responseData.featureKeys) || technicalKeys.some(key => !responseData.featureKeys.includes(key))) {
        throw new Error('تأیید تغییر از سرور با مستأجر یا قابلیت‌های درخواستی هم‌خوانی ندارد.');
      }
      const failedSync = (responseData.results || []).find(result => result.featureKey && technicalKeys.includes(result.featureKey) && result.syncedToWesto === false);
      if (failedSync) {
        const error = new Error('مجوز در کنترل‌پلن ثبت شد، اما همگام‌سازی مستأجر تأیید نشد.');
        error.policyApplied = failedSync.policyApplied === true;
        error.syncPending = true;
        throw error;
      }

      return {
        ok: true,
        tenantId,
        moduleKey: moduleOrFeatureKey,
        technicalKeys,
        primaryKey,
        enabled: isEnabled,
        data: responseData,
        source: 'control-plane'
      };
    }
  }

  const EntitlementsRepoInstance = new EntitlementsRepository();
  global.EntitlementsRepository = EntitlementsRepoInstance;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = EntitlementsRepoInstance;
  }
})(typeof window !== 'undefined' ? window : globalThis);
