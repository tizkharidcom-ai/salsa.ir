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
      technicalFeatures: ['orders.pos', 'orders.advanced', 'orders.discounts', 'orders.offline_sync', 'cash.drawers'],
      category: 'operations',
      defaultPriceToman: 490000
    },
    // 2. Kitchen & KDS
    {
      key: 'kds',
      nameFa: 'نمایشگر هوشمند آشپزخانه و بار (KDS)',
      descriptionFa: 'گردش کار آماده‌سازی غذا، ایستگاه‌های پخت، اکسپدایتر و زمان‌بندی سفارش',
      icon: '🍳',
      technicalFeatures: ['kitchen.kds', 'kitchen.stations', 'kitchen.expediter'],
      category: 'kitchen',
      defaultPriceToman: 390000
    },
    // 3. Digital Menu & QR
    {
      key: 'menu_qr',
      nameFa: 'منوی دیجیتال و QR سر میز',
      descriptionFa: 'منوی چندزبانه سر میز، کدهای QR اختصاصی میزها و گزینه‌های سفارشی غذا',
      icon: '📱',
      technicalFeatures: ['catalog.menu', 'catalog.modifiers', 'floor.qr', 'catalog.pricing'],
      category: 'experience',
      defaultPriceToman: 290000
    },
    // 4. Floor, Hall & Waiter
    {
      key: 'floor',
      nameFa: 'سالن، نقشه میزها و ترمینال گارسون',
      descriptionFa: 'مدیریت چیدمان میزها، ترمینال سیار گارسون، فراخوان مهمان و حق سرویس',
      icon: '🪑',
      technicalFeatures: ['floor.tables', 'staff.waiter', 'floor.service_charge'],
      category: 'floor',
      defaultPriceToman: 350000
    },
    // 5. Reservations & Waitlist
    {
      key: 'reservations',
      nameFa: 'رزرواسیون آنلاین و صف انتظار (Waitlist)',
      descriptionFa: 'تقویم رزرو میز، پیش‌دریافت بیعانه و صف انتظار هوشمند مهمانان حضوری',
      icon: '📅',
      technicalFeatures: ['booking.reservations', 'booking.waitlist', 'booking.deposit'],
      category: 'experience',
      defaultPriceToman: 290000
    },
    // 6. Delivery & Dispatch
    {
      key: 'delivery',
      nameFa: 'پیک، دیسپچ و ردیابی سفارشات',
      descriptionFa: 'مدیریت ناوگان پیک، محدوده‌های کرایه شهری و ردیابی زنده روی نقشه',
      icon: '🛵',
      technicalFeatures: ['delivery.dispatch', 'delivery.zones', 'delivery.tracking'],
      category: 'operations',
      defaultPriceToman: 390000
    },
    // 7. Payments & POS Terminal Link
    {
      key: 'payments',
      nameFa: 'درگاه آنلاین و اتصال کارتخوان (PC-POS)',
      descriptionFa: 'اتصال به درگاه‌های شاپرک و اتصال مستقیم نرم‌افزار به پوز بانکی',
      icon: '💳',
      technicalFeatures: ['payments.gateway', 'payments.terminal_link', 'cash.drawers'],
      category: 'finance',
      defaultPriceToman: 290000
    },
    // 8. Accounting, Tax & Finance
    {
      key: 'accounting',
      nameFa: 'حسابداری دوبل، دفاتر و سامانه مؤدیان',
      descriptionFa: 'دفتر کل، مغایرت بانکی، صورت سود و زیان، دارایی‌های ثابت و اتصال مؤدیان',
      icon: '📊',
      technicalFeatures: ['finance.workspace', 'finance.purchases', 'finance.reconciliation', 'finance.tax_adapter', 'finance.assets'],
      category: 'finance',
      defaultPriceToman: 590000
    },
    // 9. Inventory, Recipes & COGS
    {
      key: 'inventory',
      nameFa: 'انبارداری، فرمولاسیون و بهای تمام‌شده (COGS)',
      descriptionFa: 'کسر اتوماتیک مواد اولیه از انبار، آنالیز رسپی، کاردکس کالا و تدارکات',
      icon: '📦',
      technicalFeatures: ['stock.inventory', 'stock.recipes', 'stock.procurement'],
      category: 'management',
      defaultPriceToman: 590000
    },
    // 10. CRM, Loyalty & SMS
    {
      key: 'crm',
      nameFa: 'باشگاه مشتریان، کیف پول و پیامک (CRM)',
      descriptionFa: 'امتیازدهی، کیف پول اعتباری، کمپین‌های تخفیفی و پیامک‌های هوشمند خودکار',
      icon: '🎁',
      technicalFeatures: ['crm.loyalty', 'crm.wallet', 'marketing.campaigns', 'marketing.sms', 'crm.directory'],
      category: 'marketing',
      defaultPriceToman: 390000
    },
    // 11. Multi-Branch & Central Management
    {
      key: 'multi_branch',
      nameFa: 'مدیریت متمرکز هلدینگ و چندشعبه‌ای',
      descriptionFa: 'تلفیق مالی شعب چندگانه، گزارش‌های یکپارچه و انتقال کالا بین شعب',
      icon: '🏢',
      technicalFeatures: ['core.multi_branch', 'finance.consolidation', 'core.workspace'],
      category: 'scale',
      defaultPriceToman: 790000
    },
    // 12. Brand Website & White-label
    {
      key: 'website_brand',
      nameFa: 'وب‌سایت برند، دامنه اختصاصی و وایت‌لیبل',
      descriptionFa: 'دامنه اختصاصی با SSL خودکار، وب‌سایت مستقل و حذف نشان‌های پلتفرم',
      icon: '🌐',
      technicalFeatures: ['content.website', 'brand.custom_domain', 'brand.white_label'],
      category: 'brand',
      defaultPriceToman: 490000
    },
    // 13. Reports & AI Insights
    {
      key: 'analytics',
      nameFa: 'گزارش‌های مدیریتی و هوش تحلیلی',
      descriptionFa: 'داشبورد هوشمند فروش، ساعات پیک، بهینه‌ساز هزینه‌ها و پیش‌بینی فروش',
      icon: '📈',
      technicalFeatures: ['insights.reports'],
      category: 'management',
      defaultPriceToman: 350000
    }
  ]);

  class EntitlementsRepository {
    constructor(client, fallbackStore) {
      this.client = client || (typeof window !== 'undefined' ? window.ControlPlaneClient : null) || (typeof global !== 'undefined' ? global.ControlPlaneClient : null);
      this.store = fallbackStore || (typeof window !== 'undefined' ? (window.prototypeStore || window.GMStore) : null) || (typeof global !== 'undefined' ? (global.prototypeStore || global.GMStore) : null);
      this._businessModules = BUSINESS_MODULES;
      this._appMode = (typeof window !== 'undefined' ? window.GodModeAppMode : null) || (typeof global !== 'undefined' ? global.GodModeAppMode : null);
    }

    getBusinessModules() {
      return this._businessModules;
    }

    async refreshBusinessModules() {
      try {
        if (!this.client || typeof this.client.get !== 'function') {
          throw new Error('MODULE_CATALOG_UNAVAILABLE: Control Plane client is unavailable.');
        }
        const response = await this.client.get('/api/control/policy/modules');
        const modules = response?.data?.modules;
        if (!Array.isArray(modules) || modules.length === 0 || modules.some(module => !module || typeof module.key !== 'string' || !module.key.trim())) {
          throw new Error('MODULE_CATALOG_INVALID: Control Plane did not return a module catalog.');
        }
        this._businessModules = modules.map(module => ({
          ...module,
          // The manifest's static list price is not an approved customer tariff.
          // Keep operational consumers from mistaking it for a billable price.
          defaultPriceToman: module.catalogProvenance?.priceMeaning === 'approved_customer_tariff' &&
            Number.isSafeInteger(module.priceMonthlyIrr) && module.priceMonthlyIrr >= 0
            ? Math.round(module.priceMonthlyIrr / 10)
            : null
        }));
      } catch (error) {
        console.warn('[EntitlementsRepository] Module manifest unavailable:', error.message);
        if (this._appMode?.isProduction?.()) {
          this._businessModules = [];
          throw error;
        }
      }
      return this._businessModules;
    }

    /**
     * Calculate Authoritative Effective Entitlements for a Tenant
     */
    async calculateEffectiveEntitlements(tenantId) {
      if (!tenantId) throw new Error('tenantId الزامی است.');

      const businessModules = await this.refreshBusinessModules();

      // 1. Fetch live grants from Control Plane
      let serverGrants = [];
      try {
        const res = await this.client.get(`/api/control/policy/grants/${encodeURIComponent(tenantId)}`);
        serverGrants = res.data || [];
      } catch (_) {}

      // 2. Fetch tenant & plan from store or client
      const store = this.store;
      let tenant = null;
      let plan = null;
      let isSuspended = false;

      if (store) {
        tenant = store.getTenant(tenantId);
        if (tenant) {
          isSuspended = tenant.status === 'suspended' || tenant.status === 'cancelled';
          const planCode = (tenant.plan || 'growth').toLowerCase();
          plan = (store.state?.plans || []).find(p => p.id === tenant.planId || (p.code && p.code.toLowerCase() === planCode) || (p.name && p.name.toLowerCase().includes(planCode))) || store.state?.plans?.[0];
        }
      }

      const planIncludedFeatures = new Set(plan?.includedFeatures || ['catalog.menu', 'orders.pos', 'billing.invoicing', 'portal.qr_menu']);
      const activeGrantsMap = new Map();
      serverGrants.forEach(g => {
        if (g.status === 'active') activeGrantsMap.set(g.feature_key || g.featureKey, g);
      });

      // Also merge local grants in demo mode
      if (store && typeof store.getTenantGrants === 'function') {
        const localGrants = store.getTenantGrants(tenantId) || {};
        Object.entries(localGrants).forEach(([key, val]) => {
          if (val && !activeGrantsMap.has(key)) {
            activeGrantsMap.set(key, val);
          }
        });
      }

      // Check global kill-switch
      const globallyDisabledKeys = new Set(
        (store?.state?.features || []).filter(f => f.globallyDisabled).map(f => f.key)
      );
      const globalKillswitches = (store && typeof store.getGlobalKillswitches === 'function')
        ? store.getGlobalKillswitches()
        : (store?.state?.globalKillswitches || {});

      // Map to each Business Module
      const evaluatedModules = businessModules.map((mod) => {
        const allKeys = mod.technicalFeatures;
        const primaryKey = allKeys[0];

        let state = 'not_purchased';
        let reason = 'خریداری نشده — امکان فعال‌سازی به صورت افزونه وجود دارد';
        let isEnabled = false;

        const isGloballyDisabled = allKeys.some(k => globallyDisabledKeys.has(k)) || Boolean(globalKillswitches[mod.key]?.killed);
        const isPlanIncluded = allKeys.some(k => planIncludedFeatures.has(k));
        const hasDirectGrant = allKeys.some(k => activeGrantsMap.has(k));

        if (isGloballyDisabled) {
          state = 'globally_disabled';
          reason = globalKillswitches[mod.key]?.reason || 'توقف اضطراری موقت توسط مهندسی پلتفرم سالسا';
          isEnabled = false;
        } else if (isSuspended) {
          state = 'suspended';
          reason = 'سرویس مجموعه معلق است؛ ماژول موقتاً مسدود شده';
          isEnabled = false;
        } else if (hasDirectGrant) {
          const grant = activeGrantsMap.get(primaryKey) || {};
          state = grant.type === 'trial' ? 'trial' : (grant.type === 'override' ? 'override' : 'addon');
          reason = grant.type === 'override' ? 'استثنای اختصاصی فعال' : 'افزونه فعال تجاری (Add-on)';
          isEnabled = true;
        } else if (isPlanIncluded) {
          state = 'included';
          reason = `شامل پلن اشتراک فعلی (${plan ? plan.name : 'رشد'})`;
          isEnabled = true;
        }

        return {
          ...mod,
          state,
          isEnabled,
          reason,
          planName: plan?.name || 'استاندارد',
          primaryFeatureKey: primaryKey
        };
      });

      return {
        tenantId,
        tenantName: tenant?.name || tenantId,
        isSuspended,
        modules: evaluatedModules
      };
    }

    /**
     * Authoritative Technical Feature Entitlement Evaluator
     */
    async getEffectiveEntitlements(tenantId) {
      const tid = tenantId || (this.store && typeof this.store.getActiveTenantId === 'function' ? this.store.getActiveTenantId() : null);
      if (!tid) return { tenantId: null, isSuspended: false, entitlements: {} };

      const store = this.store || global.prototypeStore || (typeof require !== 'undefined' ? require('../../../../prototype/js/store.js').prototypeStore : null);
      const tenant = store && typeof store.getTenant === 'function' ? store.getTenant(tid) : null;
      if (!tenant) {
        return { tenantId: tid, isSuspended: false, entitlements: {} };
      }

      if (store && typeof store.calculateEffectiveEntitlements === 'function') {
        const effective = store.calculateEffectiveEntitlements(tid);
        return {
          tenantId: tid,
          tenantName: tenant.name || tid,
          isSuspended: tenant.status === 'suspended',
          entitlements: effective
        };
      }

      return { tenantId: tid, isSuspended: tenant.status === 'suspended', entitlements: {} };
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
      const moduleDef = this._businessModules.find(m => m.key === moduleKey);
      if (!moduleDef) throw new Error(`ماژول «${moduleKey}» معتبر نیست.`);

      const primaryKey = moduleDef.technicalFeatures[0];
      const payload = {
        tenantId,
        featureKey: primaryKey,
        grantKind: 'addon',
        durationMonths: Number(durationMonths) || 1,
        metadata: {
          businessModule: moduleKey,
          moduleNameFa: moduleDef.nameFa,
          ...metadata
        }
      };

      const response = await this.client.post('/api/control/policy/grants', payload);

      // Sync local store cache
      if (this.store && typeof this.store.grantFeature === 'function') {
        this.store.grantFeature(tenantId, primaryKey, {
          type: 'addon',
          durationMonths: Number(durationMonths) || 1,
          name: moduleDef.nameFa
        });
      }

      return response.data;
    }

    /**
     * Disable / Cancel a Business Module Add-on
     */
    async disableModuleAddon(tenantId, moduleKey, reason = '') {
      if (!tenantId) throw new Error('شناسه رستوران (tenantId) الزامی است.');
      const moduleDef = this._businessModules.find(m => m.key === moduleKey);
      const primaryKey = moduleDef ? moduleDef.technicalFeatures[0] : moduleKey;
      if (!this.client || typeof this.client.delete !== 'function') {
        throw new Error('سرویس کنترل‌پلن برای لغو دسترسی در دسترس نیست.');
      }

      const response = await this.client.delete(`/api/control/policy/grants/${encodeURIComponent(tenantId)}/${encodeURIComponent(primaryKey)}`, {
        body: { reason: String(reason || '').trim() || 'OPERATOR_REVOKED' }
      });
      if (response?.ok === false || response?.data?.ok === false) {
        throw new Error(response?.error?.message || response?.data?.error || 'لغو دسترسی در کنترل‌پلن تأیید نشد.');
      }

      if (this.store && typeof this.store.revokeFeatureGrant === 'function') {
        this.store.revokeFeatureGrant(tenantId, primaryKey, reason);
      } else if (this.store && this.store.state?.tenantGrants?.[tenantId]) {
        delete this.store.state.tenantGrants[tenantId][primaryKey];
        if (typeof this.store.save === 'function') this.store.save();
      }
      return { ok: true, moduleKey, data: response?.data ?? response ?? null };
    }

    /**
     * Apply Operator Temporary Override with mandatory reason (superadmin.md §9.6)
     */
    async setModuleOverride(tenantId, moduleKey, state, decisionReason) {
      if (!decisionReason || !decisionReason.trim()) {
        throw new Error('برای ثبت استثنای اختصاصی، ذکر دلیل الزامی است.');
      }

      const moduleDef = this._businessModules.find(m => m.key === moduleKey);
      const primaryKey = moduleDef ? moduleDef.technicalFeatures[0] : moduleKey;

      const payload = {
        tenantId,
        permissionKey: primaryKey,
        state: state === 'allow' ? 'allow' : 'deny',
        decisionReason: decisionReason.trim()
      };

      const response = await this.client.post('/api/control/policy/overrides', payload);

      if (this.store && typeof this.store.toggleFeature === 'function') {
        this.store.toggleFeature(tenantId, primaryKey, state === 'allow');
      }

      return response.data;
    }

    /**
     * Operator 1-click toggle for a business module or technical feature
     * Updates policy grants & overrides on SALSA Control Plane and syncs directly to WESTO.
     */
    async toggleModuleForTenant(tenantId, moduleOrFeatureKey, targetState, reason = '') {
      if (!tenantId) throw new Error('شناسه رستوران (tenantId) الزامی است.');
      const isEnabled = Boolean(targetState);
      await this.refreshBusinessModules();
      const moduleDef = this._businessModules.find(m => m.key === moduleOrFeatureKey);
      const technicalKeys = moduleDef ? moduleDef.technicalFeatures : [moduleOrFeatureKey];
      const primaryKey = technicalKeys[0];

      let responseData = null;
      try {
        if (this.client && typeof this.client.post === 'function') {
          const payload = {
            tenantId,
            enabled: isEnabled,
            reason: reason || (isEnabled ? `فعال‌سازی ماژول ${moduleDef?.nameFa || moduleOrFeatureKey}` : `غیرفعال‌سازی ماژول ${moduleDef?.nameFa || moduleOrFeatureKey}`)
          };
          const endpoint = moduleDef
            ? `/api/control/policy/modules/${encodeURIComponent(moduleOrFeatureKey)}/state`
            : '/api/control/policy/toggle';
          if (!moduleDef) {
            payload.featureKey = primaryKey;
            payload.featureKeys = technicalKeys;
          }
          const res = await this.client.post(endpoint, payload);
          responseData = res ? res.data : null;
          if (moduleDef && responseData?.syncedToWesto !== true) {
            throw new Error('همگام‌سازی ماژول با WESTO تأیید نشد.');
          }
        }
      } catch (err) {
        const isProduction = Boolean(this._appMode?.isProduction?.());
        if (isProduction) throw err;
        console.warn('[EntitlementsRepository] Remote policy toggle failed; demo cache only:', err.message);
      }

      // Update local store / cache
      if (this.store) {
        for (const key of technicalKeys) {
          if (isEnabled) {
            if (typeof this.store.grantFeature === 'function') {
              this.store.grantFeature(tenantId, key, {
                type: 'addon',
                durationMonths: 12,
                name: moduleDef?.nameFa || key
              });
            }
            if (typeof this.store.setFeatureOverride === 'function') {
              this.store.setFeatureOverride(tenantId, key, 'allow');
            }
          } else {
            if (typeof this.store.revokeFeatureGrant === 'function') {
              this.store.revokeFeatureGrant(tenantId, key, reason || 'Operator toggle off');
            }
            if (typeof this.store.setFeatureOverride === 'function') {
              this.store.setFeatureOverride(tenantId, key, 'deny');
            }
          }
          if (typeof this.store.toggleFeature === 'function') {
            this.store.toggleFeature(tenantId, key, isEnabled);
          }
        }
        if (typeof this.store.save === 'function') {
          this.store.save();
        }
      }

      return {
        ok: Boolean(responseData) || !this._appMode?.isProduction?.(),
        tenantId,
        moduleKey: moduleOrFeatureKey,
        technicalKeys,
        primaryKey,
        enabled: isEnabled,
        data: responseData
      };
    }
  }

  const EntitlementsRepoInstance = new EntitlementsRepository();
  global.EntitlementsRepository = EntitlementsRepoInstance;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = EntitlementsRepoInstance;
  }
})(typeof window !== 'undefined' ? window : globalThis);
