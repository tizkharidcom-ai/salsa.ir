/**
 * prototype/js/godmode/domain/commercial/repository.js
 *
 * Domain Repository for Commercial, Plans, and Fleet-wide Billing (superadmin.md §10).
 * Connects to /api/control/billing.
 * Isolates fleet-wide financial exception queues from individual restaurant dossiers.
 */

(function (global) {
  'use strict';

  function rialToToman(value) {
    if (value == null || value === '') return null;
    const rials = Number(value);
    if (!Number.isSafeInteger(rials)) return null;
    return rials / 10;
  }

  function normalizePlatformInvoice(invoice) {
    if (!invoice || typeof invoice !== 'object') return invoice;
    const lineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems.map(item => ({
      ...item,
      unitPriceToman: rialToToman(item.unitPriceRials),
      totalToman: rialToToman(item.totalRials)
    })) : [];
    return {
      ...invoice,
      status: invoice.status === 'unpaid' ? 'pending' : invoice.status,
      subtotalAmount: rialToToman(invoice.amountSubtotalRials),
      discountAmount: rialToToman(invoice.discountAmountRials),
      vatAmount: rialToToman(invoice.vatAmountRials),
      totalAmount: rialToToman(invoice.amountTotalRials),
      paymentRef: invoice.settlementReference || null,
      activationStatus: invoice.entitlementStatus === 'activated' ? 'activated' : invoice.entitlementStatus,
      lineItems
    };
  }

  class CommercialRepository {
    constructor(client, fallbackStore) {
      this.client = client || (typeof window !== 'undefined' ? window.ControlPlaneClient : null) || (typeof global !== 'undefined' ? global.ControlPlaneClient : null);
      this.store = fallbackStore || (typeof window !== 'undefined' ? (window.prototypeStore || window.GMStore) : null) || (typeof global !== 'undefined' ? (global.prototypeStore || global.GMStore) : null);
      this._appMode = (typeof window !== 'undefined' ? window.GodModeAppMode : null) || (typeof global !== 'undefined' ? global.GodModeAppMode : null);
    }

    /**
     * List Subscription Plans
     */
    async listPlans() {
      try {
        if (this.client) {
          const response = await this.client.get('/api/control/billing/plans?includeDrafts=true');
          if (response && Array.isArray(response.data)) return response.data;
        }
      } catch (err) {
        if (this._appMode && this._appMode.isProduction()) {
          console.warn('[CommercialRepo] Failed to fetch plans from backend:', err.message);
          throw err;
        }
      }

      if (this._appMode && this._appMode.isProduction()) {
        throw new Error('BILLING_PLANS_UNAVAILABLE: Control Plane did not return subscription plans.');
      }

      // Fallback local plans from store
      const storePlans = this.store?.state?.plans || [];
      if (storePlans.length > 0) {
        return storePlans.map(p => ({
          id: p.id,
          code: p.id.replace('plan_', ''),
          name: p.name,
          priceToman: p.priceToman || p.price,
          billingPeriod: p.period || 'monthly',
          description: p.description,
          featuresCount: p.featuresCount || (p.includedFeatures ? p.includedFeatures.length : 12),
          includedModules: p.includedModules || (
            p.id.includes('starter') ? ['pos', 'menu_qr'] :
            p.id.includes('growth') ? ['pos', 'menu_qr', 'kds', 'crm'] :
            p.id.includes('scale') ? ['pos', 'menu_qr', 'kds', 'inventory', 'accounting', 'crm', 'reservations', 'multi_branch', 'analytics'] :
            ['pos', 'menu_qr', 'kds', 'inventory', 'accounting', 'crm', 'reservations', 'website_brand', 'multi_branch', 'analytics']
          ),
          limits: p.limits || {}
        }));
      }

      return [
        {
          id: 'plan_starter',
          code: 'starter',
          name: 'Starter (پایه)',
          priceToman: 990000,
          billingPeriod: 'monthly',
          includedModules: ['pos', 'menu_qr'],
          description: 'مناسب کافه‌ها و رستوران‌های کوچک تک‌شعبه',
          limits: { maxPosDevices: 1, maxBranches: 1, storageGb: 5, smsMonthlyQuota: 1000, maxUsers: 3 }
        },
        {
          id: 'plan_growth',
          code: 'growth',
          name: 'Growth (رشد)',
          priceToman: 1850000,
          billingPeriod: 'monthly',
          includedModules: ['pos', 'menu_qr', 'kds', 'crm'],
          description: 'مناسب رستوران‌های شلوغ با سفارش‌گیری سالن و بیرون‌بر',
          limits: { maxPosDevices: 4, maxBranches: 2, storageGb: 20, smsMonthlyQuota: 5000, maxUsers: 8 }
        },
        {
          id: 'plan_scale',
          code: 'scale',
          name: 'Scale (سازمانی)',
          priceToman: 3400000,
          billingPeriod: 'monthly',
          includedModules: ['pos', 'menu_qr', 'kds', 'inventory', 'accounting', 'crm', 'reservations', 'multi_branch', 'analytics'],
          description: 'مجموعه‌های زنجیره‌ای و بزرگ با انبارهای متعدد',
          limits: { maxPosDevices: 8, maxBranches: 5, storageGb: 50, smsMonthlyQuota: 15000, maxUsers: 25 }
        }
      ];
    }

    /**
     * List Fleet-Wide Billing Exceptions (Overdue, Grace, Pending)
     */
    async getBillingExceptions() {
      try {
        if (this.client) {
          const response = await this.client.get('/api/control/billing/invoices?status=overdue');
          if (response && Array.isArray(response.data)) return response.data;
        }
      } catch (err) {
        if (this._appMode && this._appMode.isProduction()) {
          console.warn('[CommercialRepo] Failed to fetch exceptions from backend:', err.message);
          throw err;
        }
      }

      if (this._appMode && this._appMode.isProduction()) {
        throw new Error('BILLING_EXCEPTIONS_UNAVAILABLE: Control Plane did not return the billing exception queue.');
      }

      // Generate exception summary from known tenants (dev/demo only)
      const tenants = (this.store && typeof this.store.getTenants === 'function')
        ? this.store.getTenants()
        : [];

      const exceptions = [];
      tenants.forEach((t) => {
        if (t.status === 'past_due' || t.status === 'grace_period') {
          exceptions.push({
            id: `inv_${t.id}_due`,
            tenantId: t.id,
            tenantName: t.name,
            amountToman: 3900000,
            status: 'overdue',
            dueDate: new Date(Date.now() - 86400000 * 3).toISOString(),
            graceUntil: new Date(Date.now() + 86400000 * 4).toISOString(),
            planName: t.plan || 'Growth',
            daysPastDue: 3
          });
        }
      });

      return exceptions;
    }

    /**
     * Get Invoices for a Single Restaurant
     */
    async getTenantInvoices(tenantId) {
      if (!tenantId) return [];
      try {
        if (this.client) {
          const response = await this.client.get(`/api/control/billing/invoices?tenantId=${encodeURIComponent(tenantId)}`);
          if (response && response.data) return response.data;
        }
      } catch (err) {
        if (this._appMode && this._appMode.isProduction()) {
          console.warn('[CommercialRepo] Failed to fetch tenant invoices:', err.message);
          return [];
        }
      }

      if (this._appMode && this._appMode.isProduction()) {
        return [];
      }

      return [
        {
          id: `inv_${tenantId}_001`,
          invoiceNumber: 'INV-1405-081',
          tenantId,
          amountToman: 3900000,
          status: 'paid',
          createdAt: new Date(Date.now() - 86400000 * 20).toISOString(),
          paidAt: new Date(Date.now() - 86400000 * 19).toISOString(),
          period: 'آبان ۱۴۰۵'
        }
      ];
    }

    /**
     * Mark an invoice as paid with settlement reference, reason, and idempotency (§44)
     */
    async markInvoicePaid(invoiceId, { settlementReference, reason, idempotencyKey } = {}) {
      const payload = {
        settlementReference,
        reason,
        idempotencyKey: idempotencyKey || `idemp_pay_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
      };
      if (this.client) {
        const res = await this.client.post(`/api/control/billing/invoices/${encodeURIComponent(invoiceId)}/mark-paid`, payload);
        return res.data || res;
      }
      if (this._appMode && this._appMode.isProduction()) {
        throw new Error('BILLING_CLIENT_UNAVAILABLE: Control plane client unavailable in production.');
      }
      if (this.store && typeof this.store.markInvoicePaid === 'function') {
        return this.store.markInvoicePaid(invoiceId, payload);
      }
      return { success: true, ok: true, invoiceId };
    }

    /**
     * List Subscriptions
     */
    async listSubscriptions(options = {}) {
      try {
        if (this.client) {
          const qs = new URLSearchParams();
          if (options.tenantId) qs.set('tenantId', options.tenantId);
          if (options.status) qs.set('status', options.status);
          const res = await this.client.get(`/api/control/billing/subscriptions?${qs.toString()}`);
          if (res && res.data) return res.data;
        }
      } catch (err) {
        if (this._appMode && this._appMode.isProduction()) throw err;
      }
      if (this._appMode?.isProduction()) throw new Error('BILLING_SUBSCRIPTIONS_UNAVAILABLE: Control Plane did not return subscriptions.');
      return [];
    }

    /**
     * Get Quotas & Resource Usage
     */
    async getQuotas(tenantId) {
      try {
        if (this.client) {
          const url = tenantId ? `/api/control/billing/quotas/${encodeURIComponent(tenantId)}` : '/api/control/billing/quotas';
          const res = await this.client.get(url);
          if (res && res.data) return res.data;
        }
      } catch (err) {
        if (this._appMode && this._appMode.isProduction()) throw err;
      }
      return null;
    }

    /**
     * Get Map of Globally Killed Business Modules
     */
    getGlobalKillswitches() {
      if (this._appMode?.isProduction()) return {};
      if (this.store && typeof this.store.getGlobalKillswitches === 'function') {
        return this.store.getGlobalKillswitches();
      }
      return this.store?.state?.globalKillswitches || {};
    }

    async listGlobalKillswitches() {
      try {
        if (this.client) {
          const response = await this.client.get('/api/control/policy/killswitch');
          if (!Array.isArray(response?.data)) {
            throw new Error('KILLSWITCH_STATE_INVALID: Control Plane returned an invalid module state list.');
          }
          const states = response.data.reduce((result, item) => {
            const key = item.moduleKey || item.featureKey;
            if (key) result[key] = { ...item, killed: item.status === 'active' };
            return result;
          }, {});
          states.__capabilities = response.capabilities && typeof response.capabilities === 'object'
            ? response.capabilities
            : {};
          return states;
        }
      } catch (error) {
        if (this._appMode?.isProduction?.()) throw error;
      }
      if (this._appMode?.isProduction?.()) {
        throw new Error('KILLSWITCH_STATE_UNAVAILABLE: Control Plane did not return global module states.');
      }
      return this.getGlobalKillswitches();
    }

    /**
     * Toggle Platform-Wide Emergency Killswitch for a Business Module
     */
    async toggleGlobalKillswitch(moduleKey, enabled, reason = '') {
      try {
        if (this.client) {
          const response = enabled
            ? await this.client.delete(`/api/control/policy/killswitch/${encodeURIComponent(moduleKey)}`)
            : await this.client.post('/api/control/policy/killswitch', {
                moduleKey,
                reason
              });
          return response.data || response;
        }
      } catch (err) {
        if (this._appMode?.isProduction()) throw err;
      }

      if (this._appMode?.isProduction()) {
        throw new Error('KILLSWITCH_UNAVAILABLE: Control Plane did not acknowledge the feature policy change.');
      }

      if (this.store && typeof this.store.toggleGlobalKillswitch === 'function') {
        return this.store.toggleGlobalKillswitch(moduleKey, enabled, reason);
      }
      return { killed: !enabled, reason };
    }

    /**
     * Preflight Change Plan (Phase 1.1 & Phase 16)
     */
    async preflightChangePlan(subscriptionId, newPlanId) {
      if (this.client) {
        const res = await this.client.post(`/api/control/billing/subscriptions/${encodeURIComponent(subscriptionId)}/change-plan/preflight`, {
          newPlanId
        });
        return res?.data;
      }
      if (this._appMode?.isProduction()) throw new Error('BILLING_CLIENT_UNAVAILABLE: Control Plane client unavailable in production.');
      return { ok: true, subscriptionId, newPlanId };
    }

    /**
     * Change Subscription Plan (Phase 1.1)
     */
    async changeSubscriptionPlan(subscriptionId, newPlanId, reason, options = {}) {
      if (this.client) {
        const res = await this.client.post(`/api/control/billing/subscriptions/${encodeURIComponent(subscriptionId)}/change-plan`, {
          tenantId: options.tenantId || subscriptionId,
          newPlanId,
          reason,
          effectiveMode: options.effectiveMode || 'immediate',
          expectedVersion: options.expectedVersion,
          idempotencyKey: options.idempotencyKey
        });
        return res?.data;
      }
      if (this._appMode?.isProduction()) throw new Error('BILLING_CLIENT_UNAVAILABLE: Control Plane client unavailable in production.');
      return { ok: true, subscriptionId, newPlanId, reason };
    }

    /**
     * Extend Grace Period for Subscription (Phase 1.2)
     */
    async extendGracePeriod(subscriptionId, additionalDays = 7, reason = '', options = {}) {
      const newGraceUntil = new Date(Date.now() + additionalDays * 24 * 60 * 60 * 1000).toISOString();
      if (this.client) {
        try {
          const res = await this.client.post(`/api/control/billing/subscriptions/${encodeURIComponent(subscriptionId)}/extend-grace`, {
            newGraceUntil,
            reason,
            expectedVersion: options.expectedVersion,
            idempotencyKey: options.idempotencyKey
          });
          return res?.data;
        } catch (err) {
          if (this._appMode?.isProduction()) throw err;
        }
      }
      if (this._appMode?.isProduction()) throw new Error('GRACE_PERIOD_UNAVAILABLE: Control Plane did not acknowledge the grace-period change.');
      if (this.store && typeof this.store.extendGracePeriod === 'function') {
        return this.store.extendGracePeriod(subscriptionId, additionalDays, reason);
      }
      return { ok: true, subscriptionId, additionalDays, newGraceUntil };
    }

    /**
     * Get Paid Invoices Pending Module/License Activation
     */
    async getPendingActivationInvoices() {
      if (this._appMode?.isProduction()) {
        return (await this.getAllInvoices()).filter(inv => inv.status === 'paid' && inv.activationStatus === 'pending');
      }
      const invoices = (this.store && typeof this.store.getInvoices === 'function')
        ? this.store.getInvoices('all')
        : [];
      return invoices.filter(inv => inv.status === 'paid' && inv.activationStatus === 'pending');
    }

    /**
     * Complete License and Module Provisioning for a Paid Invoice
     */
    async activateInvoiceLicense(invoiceId) {
      try {
        if (this.client) {
          await this.client.post(`/api/control/billing/invoices/${encodeURIComponent(invoiceId)}/activate`, {});
        }
      } catch (err) {
        if (this._appMode?.isProduction()) throw err;
      }

      if (this._appMode?.isProduction()) {
        throw new Error('LICENSE_ACTIVATION_UNAVAILABLE: Control Plane did not acknowledge invoice activation.');
      }

      if (this.store && typeof this.store.activatePendingInvoice === 'function') {
        return this.store.activatePendingInvoice(invoiceId);
      }
      return { ok: true, invoiceId, activationStatus: 'activated' };
    }

    /**
     * Get All Platform Invoices
     */
    async getAllInvoices() {
      if (this._appMode?.isProduction()) {
        if (!this.client) throw new Error('BILLING_INVOICES_UNAVAILABLE: Control Plane client is unavailable.');
        try {
          const response = await this.client.get('/api/control/billing/invoices');
          if (Array.isArray(response?.data)) return response.data.map(normalizePlatformInvoice);
          throw new Error('BILLING_INVOICES_INVALID: Control Plane returned an invalid invoice ledger.');
        } catch (error) {
          console.warn('[CommercialRepo] Failed to fetch invoice ledger:', error.message);
          throw error;
        }
      }
      if (this.store && typeof this.store.getInvoices === 'function') {
        return this.store.getInvoices('all');
      }
      return [];
    }

    async getInvoiceDetailsForPlatform(invoiceId) {
      if (!invoiceId) return null;
      if (this._appMode?.isProduction()) {
        if (!this.client) throw new Error('BILLING_CLIENT_UNAVAILABLE: Control plane client unavailable in production.');
        const response = await this.client.get(`/api/control/billing/invoices/${encodeURIComponent(invoiceId)}`);
        const invoice = response?.data;
        if (!invoice || typeof invoice !== 'object' || String(invoice.id) !== String(invoiceId)) {
          throw new Error('BILLING_INVOICE_DETAIL_INVALID: Control Plane returned an invalid invoice snapshot.');
        }
        return normalizePlatformInvoice(invoice);
      }
      return this.getInvoiceDetails(invoiceId);
    }

    /**
     * Calculate Fleet Commercial & Billing Pulse Metrics
     */
    getCommercialPulseMetrics() {
      if (this._appMode?.isProduction()) {
        return {
          mrrToman: null,
          collectedToman: null,
          activeTenantsCount: null,
          totalTenantsCount: null,
          pendingLicenseCount: null,
          overdueCount: null,
          atRiskToman: null,
          dataStatus: 'unavailable'
        };
      }
      const tenants = (this.store && typeof this.store.getTenants === 'function')
        ? this.store.getTenants()
        : [];
      const invoices = (this.store && typeof this.store.getInvoices === 'function')
        ? this.store.getInvoices('all')
        : [];

      const activeTenants = tenants.filter(t => t.status === 'active' || t.status === 'grace_period');
      const pendingInvoices = invoices.filter(i => i.status === 'paid' && i.activationStatus === 'pending');
      const overdueTenants = tenants.filter(t => t.status === 'past_due' || t.status === 'grace_period');

      const planPriceMap = {
        starter: 990000,
        growth: 1850000,
        scale: 3400000,
        enterprise: 6500000
      };

      let mrrToman = 0;
      tenants.forEach(t => {
        if (t.status !== 'suspended' && t.status !== 'canceled') {
          const pLower = (t.plan || 'growth').toLowerCase();
          if (pLower.includes('starter')) mrrToman += planPriceMap.starter;
          else if (pLower.includes('scale')) mrrToman += planPriceMap.scale;
          else if (pLower.includes('enterprise')) mrrToman += planPriceMap.enterprise;
          else mrrToman += planPriceMap.growth;
        }
      });

      const collectedToman = invoices
        .filter(i => i.status === 'paid')
        .reduce((sum, i) => sum + (i.total || i.amount || 0), 0);

      const atRiskToman = overdueTenants.length * 1850000;

      return {
        mrrToman,
        collectedToman,
        activeTenantsCount: activeTenants.length,
        totalTenantsCount: tenants.length,
        pendingLicenseCount: pendingInvoices.length,
        overdueCount: overdueTenants.length,
        atRiskToman
      };
    }

    /**
     * Get Complete Official Tax Invoice Breakdown & Moadian Token
     */
    getInvoiceDetails(invoiceId) {
      if (this._appMode?.isProduction()) return null;
      if (this.store && typeof this.store.getInvoiceDetails === 'function') {
        return this.store.getInvoiceDetails(invoiceId);
      }
      return null;
    }

    /**
     * Issue an Official Platform Invoice
     */
    issueInvoice(tenantId, invoiceData) {
      if (this._appMode?.isProduction()) {
        throw new Error('INVOICE_ISSUANCE_UNAVAILABLE: No production invoice-issuance endpoint is configured.');
      }
      if (this.store && typeof this.store.issueInvoice === 'function') {
        return this.store.issueInvoice(tenantId, invoiceData);
      }
      return { id: `inv_${Date.now()}`, tenantId, status: 'pending' };
    }

    /**
     * Get Platform-wide Tax & VAT Ledger Summary
     */
    async getTaxSummary() {
      if (this.client) {
        try {
          const res = await this.client.get('/api/control/billing/tax/summary');
          if (res && res.data) return res.data;
        } catch (err) {
          if (this._appMode?.isProduction()) throw err;
        }
      }
      if (this._appMode?.isProduction()) throw new Error('TAX_SUMMARY_UNAVAILABLE: Control Plane did not return the tax ledger summary.');
      if (this.store && typeof this.store.getTaxSummary === 'function') {
        return this.store.getTaxSummary();
      }
      return {
        grossInvoicedToman: 0,
        paidGrossToman: 0,
        collectedVatToman: 0,
        pendingVatToman: 0,
        paidCount: 0,
        pendingCount: 0,
        totalCount: 0,
        moadianStatus: 'NotIntegrated',
        moadianStatusFa: 'عدم اتصال به سامانه مودیان (پیکربندی نشده)',
        moadianComplianceRate: 'عدم اتصال',
        taxRatePercent: 10
      };
    }
  }

  const CommercialRepoInstance = new CommercialRepository();
  global.CommercialRepository = CommercialRepoInstance;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CommercialRepoInstance;
  }
})(typeof window !== 'undefined' ? window : globalThis);
