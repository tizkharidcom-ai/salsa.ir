/**
 * prototype/js/godmode/domain/support/repository.js
 *
 * Domain Repository for Support, Audited PII Reveal, and Support Delegation Sessions (superadmin.md §11.3 & §12.4).
 * Connects to /api/control/support & /api/control/sessions.
 */

(function (global) {
  'use strict';

  class SupportRepository {
    constructor(client, appMode, fallbackStore) {
      this.client = client;
      this.appMode = appMode;
      this.store = fallbackStore;
    }

    get _client() {
      return this.client || (typeof window !== 'undefined' ? window.ControlPlaneClient : null) || (typeof global !== 'undefined' ? global.ControlPlaneClient : null) || (typeof require !== 'undefined' ? require('../../api/control-plane-client.js') : null);
    }

    get _appMode() {
      return this.appMode || (typeof window !== 'undefined' ? window.GodModeAppMode : null) || (typeof global !== 'undefined' ? global.GodModeAppMode : null) || (typeof require !== 'undefined' ? require('../../app/app-mode.js') : null);
    }

    get _store() {
      return this.store || (typeof window !== 'undefined' ? (window.prototypeStore || window.GMStore) : null) || (typeof global !== 'undefined' ? (global.prototypeStore || global.GMStore) : null) || (typeof require !== 'undefined' ? require('../../../store.js').prototypeStore : null);
    }

    /**
     * List Tickets for a specific Restaurant or Fleet-wide
     */
    async listTickets(tenantId = null) {
      const isProd = this._appMode?.isProduction();
      const url = tenantId ? `/api/control/support/tickets?tenantId=${encodeURIComponent(tenantId)}` : '/api/control/support/tickets';

      try {
        const res = await this._client.get(url);
        return {
          tickets: res.data || [],
          meta: res.meta || { source: 'control-plane', status: 'live', observedAt: new Date().toISOString() }
        };
      } catch (err) {
        if (isProd) {
          // Zero fake tickets in production (§16 & §17)
          return {
            tickets: [],
            meta: {
              source: 'control-plane',
              status: 'failed',
              error: err.message,
              observedAt: new Date().toISOString()
            }
          };
        }

        // Demo fallback only in demo mode
        return {
          tickets: [
            {
              id: 'tkt_101',
              tenantId: tenantId || 'westo',
              subject: 'بررسی تنظیمات چاپ فاکتور در سالن',
              status: 'open',
              priority: 'normal',
              category: 'hardware',
              createdAt: new Date(Date.now() - 7200000).toISOString()
            }
          ],
          meta: { source: 'demo-fixture', status: 'demo', observedAt: new Date().toISOString() }
        };
      }
    }

    /**
     * Create Time-Limited Support Delegation Session (superadmin.md §11.3 & §17)
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

      const isProd = this._appMode?.isProduction();

      try {
        const res = await this._client.post('/api/control/support/sessions', payload);
        return {
          ...res.data,
          meta: res.meta || { source: 'control-plane', status: 'live', observedAt: new Date().toISOString() }
        };
      } catch (err) {
        if (isProd) {
          // Zero fake session in production (§16 & §17)
          throw new Error(`خطای ایجاد نشست پشتیبانی در سرور کنترل پلن: ${err.message}`);
        }

        // Demo fallback only in demo / test mode
        return {
          sessionId: `sess_sup_${Date.now()}`,
          tenantId,
          reason,
          durationMinutes,
          token: `dlog_demo_${Date.now()}`,
          expiresAt: new Date(Date.now() + durationMinutes * 60000).toISOString(),
          status: 'active',
          approvalStatus: 'approved',
          delegationToken: 'dlog_demo_active',
          meta: { source: 'demo-fixture', status: 'demo', observedAt: new Date().toISOString() }
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

      const res = await this._client.post(`/api/control/data/customers/${encodeURIComponent(customerId)}/reveal`, payload);
      return res.data;
    }

    /**
     * Reveal Customer Sensitive PII with Mandatory Audit Trail (superadmin.md §11.5)
     */
    async revealCustomerPII(tenantId, reason) {
      if (!tenantId || !reason || typeof reason !== 'string' || reason.trim().length < 3) {
        throw new Error('برای مشاهده اطلاعات حساس PII، ثبت دلیل موجه (حداقل ۳ حرف) الزامی است.');
      }

      const isProd = this._appMode?.isProduction();

      try {
        const res = await this._client.post('/api/control/pii/reveal', {
          tenantId,
          reason: reason.trim()
        });
        return {
          revealed: true,
          ...res.data,
          meta: res.meta || { source: 'control-plane', status: 'live' }
        };
      } catch (err) {
        if (isProd) {
          throw new Error(`خطای امنیتی در دریافت اطلاعات حساس: ${err.message}`);
        }

        // Demo fallback
        return {
          revealed: true,
          tenantId,
          billingEmail: `finance@${tenantId.replace('tnt_', '')}.salsa.ir`,
          ownerPhone: '09121234567',
          revealedAt: new Date().toISOString(),
          meta: { source: 'demo-fixture', status: 'demo' }
        };
      }
    }
  }

  const SupportRepoInstance = new SupportRepository();
  global.SupportRepository = SupportRepoInstance;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SupportRepoInstance;
  }
})(typeof window !== 'undefined' ? window : globalThis);
