/**
 * prototype/js/godmode/domain/commercial/repository.js
 *
 * Domain Repository for Commercial, Plans, and Fleet-wide Billing (superadmin.md §10).
 * Connects to /api/control/billing.
 * Isolates fleet-wide financial exception queues from individual restaurant dossiers.
 */

(function (global) {
  'use strict';

  class CommercialRepository {
    constructor(client, fallbackStore) {
      this.client = client || (typeof window !== 'undefined' ? window.ControlPlaneClient : null) || (typeof global !== 'undefined' ? global.ControlPlaneClient : null);
      this.store = fallbackStore || (typeof window !== 'undefined' ? (window.prototypeStore || window.GMStore) : null) || (typeof global !== 'undefined' ? (global.prototypeStore || global.GMStore) : null);
    }

    /** Read the authoritative, versioned Control Plane pricing catalog. */
    async listPlans() {
      if (!this.client || typeof this.client.get !== 'function') {
        throw this._planError('CONTROL_PLANE_CLIENT_UNAVAILABLE', 'ارتباط Control Plane در این محیط پیکربندی نشده است.');
      }
      const response = await this.client.get('/api/control/billing/plans?includeDrafts=true');
      if (!Array.isArray(response?.data) || response.data.some(plan => !plan || typeof plan !== 'object'
        || typeof plan.planCode !== 'string' || typeof plan.version !== 'string'
        || typeof plan.isDraft !== 'boolean' || !Array.isArray(plan.includedFeatures)
        || !plan.quotas || typeof plan.quotas !== 'object' || Array.isArray(plan.quotas))) {
        throw this._planError('CONTROL_PLANE_PLAN_RESPONSE_INVALID', 'پاسخ API فهرست پلن‌ها ساختار معتبر ندارد.');
      }
      this.lastPlansMeta = response.meta || null;
      return response.data;
    }

    /** Read the server-owned comparison matrix; never synthesize missing rows. */
    async getPlanMatrix() {
      if (!this.client || typeof this.client.get !== 'function') {
        throw this._planError('CONTROL_PLANE_CLIENT_UNAVAILABLE', 'ارتباط Control Plane در این محیط پیکربندی نشده است.');
      }
      const response = await this.client.get('/api/control/billing/plans/matrix');
      const matrix = response?.data;
      if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)
        || !Array.isArray(matrix.plans) || !Array.isArray(matrix.featureComparison)
        || matrix.featureComparison.some(feature => !feature || typeof feature.key !== 'string'
          || !feature.plans || typeof feature.plans !== 'object' || Array.isArray(feature.plans))) {
        throw this._planError('CONTROL_PLANE_PLAN_MATRIX_INVALID', 'پاسخ ماتریس پلن‌ها ساختار معتبر ندارد.');
      }
      this.lastPlanMatrixMeta = response.meta || null;
      return matrix;
    }

    /** Resolve write capability from the authenticated Control Plane session. */
    async getPlanMutationAccess() {
      if (!this.client || typeof this.client.get !== 'function') {
        return { allowed: false, role: null, code: 'CONTROL_PLANE_CLIENT_UNAVAILABLE', reason: 'ارتباط Control Plane در این محیط پیکربندی نشده است.' };
      }
      try {
        const response = await this.client.get('/api/control/auth/session');
        const principal = response?.data?.principal;
        const csrfToken = response?.data?.session?.csrfToken;
        if (!principal || typeof principal.role !== 'string') {
          return { allowed: false, role: null, code: 'PLATFORM_SESSION_INVALID', reason: 'Control Plane نشست معتبر و نقش اپراتور را برنگرداند.' };
        }
        const allowed = ['platform_owner', 'platform_operations'].includes(principal.role);
        const hasCsrf = typeof csrfToken === 'string' && csrfToken.length > 0;
        const canMutate = allowed && hasCsrf;
        return {
          allowed: canMutate,
          role: principal.role,
          csrfToken: hasCsrf ? csrfToken : null,
          code: canMutate ? null : (allowed ? 'PLATFORM_CSRF_UNAVAILABLE' : 'INSUFFICIENT_PLATFORM_PERMISSIONS'),
          reason: canMutate ? null : (allowed
            ? 'نشست پلتفرم توکن CSRF معتبر برای ثبت تغییر برنگرداند؛ عملیات غیرفعال است.'
            : `نقش «${principal.role}» طبق مجوز backend اجازهٔ ساخت یا انتشار پلن ندارد.`)
        };
      } catch (error) {
        return {
          allowed: false,
          role: null,
          code: error?.code || 'PLATFORM_SESSION_UNAVAILABLE',
          status: error?.status || 0,
          reason: error?.message || 'نشست Control Plane بررسی نشد.'
        };
      }
    }

    _planError(code, message, cause) {
      const error = new Error(message);
      error.code = code;
      if (cause) error.cause = cause;
      return error;
    }

    async _postPlanMutation(path, payload, idempotencyKey) {
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
        throw this._planError('IDEMPOTENCY_KEY_INVALID', 'برای ثبت تغییر، کلید یکتای idempotency معتبر لازم است.');
      }
      if (!this.client || typeof this.client.post !== 'function') {
        throw this._planError('CONTROL_PLANE_CLIENT_UNAVAILABLE', 'ارتباط Control Plane در این محیط پیکربندی نشده است.');
      }
      const access = await this.getPlanMutationAccess();
      if (!access.allowed) {
        throw this._planError(access.code || 'PLATFORM_MUTATION_NOT_ALLOWED', access.reason);
      }
      const response = await this.client.post(path, payload, {
        headers: {
          'Idempotency-Key': idempotencyKey,
          'X-CSRF-Token': access.csrfToken
        }
      });
      if (!response || response.data === undefined || response.data === null) {
        throw this._planError('CONTROL_PLANE_MUTATION_RESPONSE_INVALID', 'سرور نتیجهٔ تغییر پلن را برنگرداند.');
      }
      return { data: response.data, meta: response.meta || null };
    }

    async createPlanDraft(payload, { idempotencyKey } = {}) {
      return this._postPlanMutation('/api/control/billing/plans/draft', payload, idempotencyKey);
    }

    async publishPlanDraft(planCode, { effectiveFrom, idempotencyKey } = {}) {
      if (typeof planCode !== 'string' || !planCode.trim()) {
        throw this._planError('PLAN_CODE_REQUIRED', 'کد پلن برای انتشار الزامی است.');
      }
      const payload = effectiveFrom ? { effectiveFrom } : {};
      return this._postPlanMutation(`/api/control/billing/plans/${encodeURIComponent(planCode)}/publish`, payload, idempotencyKey);
    }

    /**
     * List Fleet-Wide Billing Exceptions (Overdue, Grace, Pending)
     */
    async getBillingExceptions() {
      try {
        const response = await this.client.get('/api/control/billing/invoices?status=overdue');
        if (response.data && response.data.length > 0) return response.data;
      } catch (_) {}

      // Generate exception summary from known tenants
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
        const response = await this.client.get(`/api/control/billing/invoices?tenantId=${encodeURIComponent(tenantId)}`);
        return response.data || [];
      } catch (_) {
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
    }

    /**
     * Get Map of Globally Killed Business Modules
     */
    getGlobalKillswitches() {
      if (this.store && typeof this.store.getGlobalKillswitches === 'function') {
        return this.store.getGlobalKillswitches();
      }
      return this.store?.state?.globalKillswitches || {};
    }

    /**
     * Toggle Platform-Wide Emergency Killswitch for a Business Module
     */
    async toggleGlobalKillswitch(moduleKey, enabled, reason = '') {
      try {
        if (this.client) {
          await this.client.post('/api/control/policy/killswitch', {
            moduleKey,
            enabled,
            reason
          });
        }
      } catch (_) {}

      if (this.store && typeof this.store.toggleGlobalKillswitch === 'function') {
        return this.store.toggleGlobalKillswitch(moduleKey, enabled, reason);
      }
      return { killed: !enabled, reason };
    }

    /**
     * Extend Grace Period for an Overdue Restaurant
     */
    async extendGracePeriod(tenantId, additionalDays = 7, reason = '') {
      try {
        if (this.client) {
          await this.client.post(`/api/control/billing/tenants/${encodeURIComponent(tenantId)}/extend-grace`, {
            additionalDays,
            reason
          });
        }
      } catch (_) {}

      if (this.store && typeof this.store.extendGracePeriod === 'function') {
        return this.store.extendGracePeriod(tenantId, additionalDays, reason);
      }
      return { ok: true, tenantId, additionalDays };
    }

    /**
     * Get Paid Invoices Pending Module/License Activation
     */
    getPendingActivationInvoices() {
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
      } catch (_) {}

      if (this.store && typeof this.store.activatePendingInvoice === 'function') {
        return this.store.activatePendingInvoice(invoiceId);
      }
      return { ok: true, invoiceId, activationStatus: 'activated' };
    }

    /**
     * Get All Platform Invoices
     */
    getAllInvoices() {
      if (this.store && typeof this.store.getInvoices === 'function') {
        return this.store.getInvoices('all');
      }
      return [];
    }

    /**
     * Calculate Fleet Commercial & Billing Pulse Metrics
     */
    getCommercialPulseMetrics() {
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
      if (this.store && typeof this.store.getInvoiceDetails === 'function') {
        return this.store.getInvoiceDetails(invoiceId);
      }
      return null;
    }

    /**
     * Issue an Official Platform Invoice
     */
    issueInvoice(tenantId, invoiceData) {
      if (this.store && typeof this.store.issueInvoice === 'function') {
        return this.store.issueInvoice(tenantId, invoiceData);
      }
      return { id: `inv_${Date.now()}`, tenantId, status: 'pending' };
    }

    /**
     * Get Platform-wide Tax & VAT Ledger Summary
     */
    getTaxSummary() {
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
        moadianComplianceRate: '۱۰۰٪',
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
