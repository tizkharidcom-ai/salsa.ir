// server/salsa/control-plane/billing/pricing-service.js
'use strict';

const catalogService = require('../policy/catalog-service');
const { getDatabase } = require('../db/database');
const auditService = require('../audit/audit-service');
const config = require('../config');

const INITIAL_PLANS = {
  starter: {
    planCode: 'starter',
    version: '1.0.0',
    isDraft: false,
    isCustom: false,
    nameFa: 'پلن پایه (استارتر)',
    descriptionFa: 'مناسب برای کافه‌ها و رستوران‌های تک‌شعبه با فرآیندهای پایه‌ای سفارش‌گیری و ثبت میز',
    basePriceMonthlyRials: 45000000, // 4.5 million Tomans = 45M Rials
    includedBranches: 1,
    includedDevices: 2,
    includedUsers: 5,
    includedFeatures: ['core.workspace', 'catalog.menu', 'orders.pos'],
    quotas: {
      maxBranches: 1,
      maxDevices: 2,
      maxUsers: 5,
      maxOrders: -1, // unlimited
      maxStorageMb: 2000,
      maxSms: 500
    },
    publishedAt: '2026-01-01T00:00:00Z',
    effectiveFrom: '2026-01-01T00:00:00Z'
  },
  growth: {
    planCode: 'growth',
    version: '1.0.0',
    isDraft: false,
    isCustom: false,
    nameFa: 'پلن رشد (گروت)',
    descriptionFa: 'ایده‌آل برای رستوران‌های چندسالنی و فعال همراه با سیستم آشپزخانه KDS و مدیریت میزها',
    basePriceMonthlyRials: 95000000, // 9.5M Tomans = 95M Rials
    includedBranches: 2,
    includedDevices: 5,
    includedUsers: 15,
    includedFeatures: ['core.workspace', 'catalog.menu', 'orders.pos', 'floor.tables', 'kitchen.kds'],
    quotas: {
      maxBranches: 2,
      maxDevices: 5,
      maxUsers: 15,
      maxOrders: -1,
      maxStorageMb: 5000,
      maxSms: 1500
    },
    publishedAt: '2026-01-01T00:00:00Z',
    effectiveFrom: '2026-01-01T00:00:00Z'
  },
  scale: {
    planCode: 'scale',
    version: '1.0.0',
    isDraft: false,
    isCustom: false,
    nameFa: 'پلن مقیاس (اسکیل)',
    descriptionFa: 'پوشش زنجیره‌ای و پیشرفته همراه با حسابداری تجاری، انبارداری هوشمند و کنترل هزینه‌ها',
    basePriceMonthlyRials: 180000000, // 18M Tomans = 180M Rials
    includedBranches: 5,
    includedDevices: 12,
    includedUsers: 40,
    includedFeatures: ['core.workspace', 'catalog.menu', 'orders.pos', 'floor.tables', 'kitchen.kds', 'finance.workspace', 'stock.inventory'],
    quotas: {
      maxBranches: 5,
      maxDevices: 12,
      maxUsers: 40,
      maxOrders: -1,
      maxStorageMb: 15000,
      maxSms: 5000
    },
    publishedAt: '2026-01-01T00:00:00Z',
    effectiveFrom: '2026-01-01T00:00:00Z'
  },
  enterprise: {
    planCode: 'enterprise',
    version: '1.0.0',
    isDraft: false,
    isCustom: false,
    nameFa: 'پلن سازمانی (اینترپرایز)',
    descriptionFa: 'راهکار فراگیر برای هولدینگ‌های رستورانی، برندهای چندشعبه‌ای، باشگاه مشتریان و گزارش‌های تجمیعی',
    basePriceMonthlyRials: 350000000, // 35M Tomans = 350M Rials
    includedBranches: 15,
    includedDevices: 40,
    includedUsers: 100,
    includedFeatures: ['core.workspace', 'core.multi_branch', 'catalog.menu', 'orders.pos', 'floor.tables', 'kitchen.kds', 'finance.workspace', 'stock.inventory', 'crm.directory', 'insights.reports'],
    quotas: {
      maxBranches: 15,
      maxDevices: 40,
      maxUsers: 100,
      maxOrders: -1,
      maxStorageMb: 50000,
      maxSms: 20000
    },
    publishedAt: '2026-01-01T00:00:00Z',
    effectiveFrom: '2026-01-01T00:00:00Z'
  }
};

const VAT_PERCENTAGE = 10; // 10% Iranian VAT (ارزش افزوده)
const ANNUAL_DISCOUNT_PERCENT = 20; // 20% discount on annual subscriptions

class PricingService {
  constructor() {
    this.plans = JSON.parse(JSON.stringify(INITIAL_PLANS));
    this.customPlans = new Map();
    this.db = getDatabase();
    this.allowInMemoryFallback = config.isTest || config.allowEphemeralDev;
  }

  reset() {
    this.plans = JSON.parse(JSON.stringify(INITIAL_PLANS));
    this.customPlans.clear();
  }

  listPlans({ includeDrafts = true, includeCustom = false } = {}) {
    let all = Object.values(this.plans);
    if (!includeDrafts) {
      all = all.filter(p => !p.isDraft);
    }
    if (includeCustom) {
      all = all.concat(Array.from(this.customPlans.values()));
    }
    return all.map(p => ({
      ...p,
      basePriceMonthlyToman: Math.round(p.basePriceMonthlyRials / 10),
      basePriceAnnualRials: Math.round(p.basePriceMonthlyRials * 12 * (1 - ANNUAL_DISCOUNT_PERCENT / 100)),
      basePriceAnnualToman: Math.round((p.basePriceMonthlyRials * 12 * (1 - ANNUAL_DISCOUNT_PERCENT / 100)) / 10)
    }));
  }

  getPlan(planCode) {
    if (this.plans[planCode]) return this.plans[planCode];
    if (this.customPlans.has(planCode)) return this.customPlans.get(planCode);
    return null;
  }

  /**
   * Side-by-side comparison matrix of standard plans for GM-10
   */
  getPlanMatrix() {
    const plans = Object.values(this.plans).filter(p => !p.isCustom);
    const allFeatures = catalogService.getFeatures();

    // Map each feature to which plans include it
    const featureComparison = allFeatures.map(f => {
      const row = {
        key: f.key,
        nameFa: f.nameFa,
        category: f.category,
        plans: {}
      };
      for (const p of plans) {
        row.plans[p.planCode] = (p.includedFeatures || []).includes(f.key);
      }
      return row;
    });

    return {
      plans: this.listPlans({ includeDrafts: true }),
      featureComparison,
      vatPercentage: VAT_PERCENTAGE,
      annualDiscountPercent: ANNUAL_DISCOUNT_PERCENT
    };
  }

  /**
   * Save or update a draft plan version (GM-10)
   */
  async createDraftPlan({
    planCode,
    nameFa,
    descriptionFa,
    basePriceMonthlyRials,
    includedBranches = 1,
    includedDevices = 2,
    includedUsers = 5,
    includedFeatures = [],
    quotas = {},
    version = '1.1.0-draft',
    actorId = 'platform_owner'
  }) {
    if (!planCode || !nameFa) {
      throw new Error('PLAN_ERROR: planCode and nameFa are required.');
    }

    const draft = {
      planCode,
      version,
      isDraft: true,
      isCustom: false,
      nameFa,
      descriptionFa: descriptionFa || '',
      basePriceMonthlyRials: Number(basePriceMonthlyRials) || 0,
      includedBranches: Number(includedBranches) || 1,
      includedDevices: Number(includedDevices) || 2,
      includedUsers: Number(includedUsers) || 5,
      includedFeatures: Array.isArray(includedFeatures) ? includedFeatures : [],
      quotas: {
        maxBranches: Number(includedBranches) || 1,
        maxDevices: Number(includedDevices) || 2,
        maxUsers: Number(includedUsers) || 5,
        maxOrders: quotas.maxOrders ?? -1,
        maxStorageMb: quotas.maxStorageMb ?? 5000,
        maxSms: quotas.maxSms ?? 1000,
        ...quotas
      },
      updatedAt: new Date().toISOString()
    };

    this.plans[planCode] = draft;

    await auditService.recordEvent({
      actorId,
      action: 'BILLING_PLAN_DRAFT_SAVED',
      targetType: 'billing_plan',
      targetId: planCode,
      metadata: { planCode, version, isDraft: true }
    });

    return draft;
  }

  /**
   * Publish draft plan version with effective date and impacted tenants count (GM-10)
   */
  async publishPlan(planCode, { effectiveFrom = new Date().toISOString(), actorId = 'platform_owner' } = {}) {
    const plan = this.plans[planCode];
    if (!plan) {
      throw new Error(`PLAN_ERROR: Plan '${planCode}' not found.`);
    }

    // Determine current version increment
    const currentVer = plan.version.replace('-draft', '');
    const parts = currentVer.split('.').map(Number);
    const newVersion = `${parts[0] || 1}.${(parts[1] || 0) + 1}.0`;

    plan.isDraft = false;
    plan.version = newVersion;
    plan.publishedAt = new Date().toISOString();
    plan.effectiveFrom = effectiveFrom;

    let impactedTenantsCount = 0;
    try {
      const result = await this.db.query(
        `SELECT COUNT(*)::int AS count
           FROM neem_billing_subscriptions
          WHERE plan_code = $1
            AND status IN ('trial', 'active', 'past_due', 'grace_period')`,
        [planCode]
      );
      impactedTenantsCount = Number(result.rows?.[0]?.count || 0);
    } catch (error) {
      if (!this.allowInMemoryFallback) {
        error.code = error.code || 'BILLING_IMPACT_QUERY_FAILED';
        throw error;
      }
      // Test/ephemeral mode has no durable subscription catalog to count.
    }

    await auditService.recordEvent({
      actorId,
      action: 'BILLING_PLAN_PUBLISHED',
      targetType: 'billing_plan',
      targetId: planCode,
      metadata: { planCode, newVersion, effectiveFrom, impactedTenantsCount }
    });

    return {
      plan,
      newVersion,
      effectiveFrom,
      impactedTenantsCount
    };
  }

  /**
   * Create bespoke custom plan for specific contract without forking catalog (Section 8.1 / GM-10)
   */
  async createCustomPlan({
    tenantId,
    nameFa,
    basePriceMonthlyRials,
    includedBranches = 3,
    includedDevices = 8,
    includedUsers = 20,
    includedFeatures = [],
    quotas = {},
    actorId = 'platform_owner'
  }) {
    if (!tenantId || !nameFa) {
      throw new Error('CUSTOM_PLAN_ERROR: tenantId and nameFa are required.');
    }

    const customCode = `custom_${tenantId}`;
    const plan = {
      planCode: customCode,
      version: '1.0.0-bespoke',
      isDraft: false,
      isCustom: true,
      customTenantId: tenantId,
      nameFa: `قرارداد اختصاصی: ${nameFa}`,
      descriptionFa: `طرح تجاری سفارشی‌سازی‌شده برای مستأجر ${tenantId} بدون انشعاب کاتالوگ`,
      basePriceMonthlyRials: Number(basePriceMonthlyRials) || 0,
      includedBranches: Number(includedBranches) || 1,
      includedDevices: Number(includedDevices) || 2,
      includedUsers: Number(includedUsers) || 5,
      includedFeatures: Array.isArray(includedFeatures) ? includedFeatures : [],
      quotas: {
        maxBranches: Number(includedBranches) || 1,
        maxDevices: Number(includedDevices) || 2,
        maxUsers: Number(includedUsers) || 5,
        maxOrders: quotas.maxOrders ?? -1,
        maxStorageMb: quotas.maxStorageMb ?? 20000,
        maxSms: quotas.maxSms ?? 5000,
        ...quotas
      },
      publishedAt: new Date().toISOString(),
      effectiveFrom: new Date().toISOString()
    };

    this.customPlans.set(customCode, plan);

    await auditService.recordEvent({
      actorId,
      action: 'BILLING_CUSTOM_PLAN_CREATED',
      targetType: 'billing_plan',
      targetId: customCode,
      tenantId,
      metadata: { tenantId, customCode }
    });

    return plan;
  }

  calculateQuote({
    planCode = 'starter',
    addonKeys = [],
    billingCycle = 'monthly', // 'monthly' | 'annual'
    extraBranches = 0,
    extraDevices = 0
  }) {
    const plan = this.getPlan(planCode);
    if (!plan) {
      throw new Error(`PRICING_ERROR: Plan '${planCode}' is not valid.`);
    }

    const months = billingCycle === 'annual' ? 12 : 1;
    let basePlanTotal = plan.basePriceMonthlyRials * months;

    // Calculate Addons
    const lineItems = [
      {
        description: `${plan.nameFa} (${billingCycle === 'annual' ? 'سالانه' : 'ماهانـه'})`,
        unitPriceRials: plan.basePriceMonthlyRials,
        quantity: months,
        totalRials: basePlanTotal
      }
    ];

    let addonsSubtotal = 0;
    for (const key of addonKeys) {
      const feat = catalogService.getFeature(key);
      if (!feat) {
        throw new Error(`PRICING_ERROR: Addon feature '${key}' does not exist.`);
      }
      const featMonthly = (feat.priceMonthly || 0) * 10; // Convert Toman to Rials
      const featTotal = featMonthly * months;
      addonsSubtotal += featTotal;
      lineItems.push({
        description: `افزونه: ${feat.nameFa}`,
        featureKey: key,
        unitPriceRials: featMonthly,
        quantity: months,
        totalRials: featTotal
      });
    }

    const subtotal = basePlanTotal + addonsSubtotal;

    // Apply Annual Discount
    let discountAmount = 0;
    if (billingCycle === 'annual') {
      discountAmount = Math.round((subtotal * ANNUAL_DISCOUNT_PERCENT) / 100);
    }

    const taxableAmount = subtotal - discountAmount;
    const vatAmount = Math.round((taxableAmount * VAT_PERCENTAGE) / 100);
    const finalTotal = taxableAmount + vatAmount;

    return {
      planCode,
      billingCycle,
      months,
      lineItems,
      subtotalRials: subtotal,
      discountAmountRials: discountAmount,
      taxableAmountRials: taxableAmount,
      vatAmountRials: vatAmount,
      finalTotalRials: finalTotal,
      currency: 'IRR',
      finalTotalToman: Math.round(finalTotal / 10)
    };
  }
}

module.exports = new PricingService();
