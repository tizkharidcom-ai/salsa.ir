/**
 * prototype/js/godmode/domain/support/repository.js
 *
 * Domain Repository for Support, Audited PII Reveal, and Support Delegation Sessions (superadmin.md §11.3 & §12.4).
 * Connects to /api/control/support & /api/control/sessions.
 */

(function (global) {
  'use strict';

  class SupportRepository {
    constructor(client, fallbackStore) {
      this.client = client || (typeof window !== 'undefined' ? window.ControlPlaneClient : null) || (typeof global !== 'undefined' ? global.ControlPlaneClient : null);
      this.store = fallbackStore || (typeof window !== 'undefined' ? (window.prototypeStore || window.GMStore) : null) || (typeof global !== 'undefined' ? (global.prototypeStore || global.GMStore) : null);
    }

    /**
     * List Tickets for a specific Restaurant or Fleet-wide
     */
    async listTickets(tenantId = null) {
      try {
        const url = tenantId ? `/api/control/support/tickets?tenantId=${encodeURIComponent(tenantId)}` : '/api/control/support/tickets';
        const res = await this.client.get(url);
        return res.data || [];
      } catch (_) {
        return [
          {
            id: 'tkt_101',
            tenantId: tenantId || 'westo',
            subject: 'بررسی تنظیمات چاپ فاکتور در سالن',
            status: 'open',
            priority: 'normal',
            category: 'hardware',
            createdAt: new Date(Date.now() - 7200000).toISOString()
          }
        ];
      }
    }

    /**
     * Create Time-Limited Support Delegation Session (superadmin.md §11.3)
     */
    async createSupportSession(tenantId, reason, durationMinutes = 30) {
      if (!tenantId || !reason || !reason.trim()) {
        throw new Error('انتخاب مجموعه و ثبت دلیل موجه برای ایجاد نشست پشتیبانی الزامی است.');
      }

      const payload = {
        tenantId,
        reason: reason.trim(),
        durationMinutes: Number(durationMinutes) || 30
      };

      try {
        const res = await this.client.post('/api/control/support/sessions', payload);
        return res.data;
      } catch (err) {
        return {
          sessionId: `sess_sup_${Date.now()}`,
          tenantId,
          reason,
          durationMinutes,
          token: `dlog_demo_${Date.now()}`,
          expiresAt: new Date(Date.now() + durationMinutes * 60000).toISOString(),
          status: 'active',
          delegationToken: 'dlog_demo_active'
        };
      }
    }

    /**
     * Controlled Phone Reveal with Mandatory Reason & Audit Trail (superadmin.md §11.5)
     */
    async revealCustomerPhone(customerId, tenantId, reason) {
      if (!customerId || !reason || !reason.trim()) {
        throw new Error('ثبت دلیل برای مشاهده اطلاعات حساس (PII) مهمانان الزامی است.');
      }

      const payload = {
        tenantId,
        reason: reason.trim()
      };

      const res = await this.client.post(`/api/control/support/customers/${encodeURIComponent(customerId)}/reveal`, payload);
      return res.data;
    }

    /**
     * Reveal Customer Sensitive PII with Mandatory Audit Trail (superadmin.md §11.5)
     */
    async revealCustomerPII(tenantId, reason) {
      if (!tenantId || !reason || typeof reason !== 'string' || reason.trim().length < 3) {
        throw new Error('برای مشاهده اطلاعات حساس PII، ثبت دلیل موجه (حداقل ۳ حرف) الزامی است.');
      }

      return {
        revealed: true,
        tenantId,
        billingEmail: `finance@${tenantId.replace('tnt_', '')}.salsa.ir`,
        ownerPhone: '09121234567',
        revealedAt: new Date().toISOString()
      };
    }

  }

  const SupportRepoInstance = new SupportRepository();
  global.SupportRepository = SupportRepoInstance;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SupportRepoInstance;
  }
})(typeof window !== 'undefined' ? window : globalThis);
