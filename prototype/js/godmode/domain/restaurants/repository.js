/**
 * prototype/js/godmode/domain/restaurants/repository.js
 *
 * Domain Repository for Restaurant / Organization entities (superadmin.md §6 & §7).
 * Connects directly to Control Plane endpoints (/api/control/tenants & /api/control/provisioning).
 * Honors APP_MODE: In production, never falls back to DEFAULT_FLEET; surfaces clean error/empty states.
 */

(function (global) {
  'use strict';

  class RestaurantsRepository {
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
     * List all restaurants/tenants with optional filtering
     */
    async listRestaurants(options = {}) {
      let list = [];
      let meta = null;

      // If in production mode, call backend strictly
      if (this._appMode?.isProduction()) {
        const response = await this._client.get('/api/control/tenants');
        list = this._normalizeList(response.data || []);
        meta = response.meta;
      } else {
        // In demo mode: try backend first, if unavailable use unified demo provider
        try {
          const response = await this._client.get('/api/control/tenants', { timeoutMs: 3000 });
          if (response && response.data && response.data.length > 0) {
            list = this._normalizeList(response.data);
            meta = response.meta;
          }
        } catch (_) {}

        if (!list.length) {
          const store = this._store;
          const localTenants = (store && typeof store.getTenants === 'function')
            ? store.getTenants()
            : [];
          list = this._normalizeList(localTenants);
          meta = {
            source: 'demo-fixture',
            status: 'demo',
            observedAt: new Date().toISOString()
          };
        }
      }

      if (options.query) {
        const q = options.query.toLowerCase().trim();
        list = list.filter(r => 
          (r.name && r.name.toLowerCase().includes(q)) ||
          (r.displayName && r.displayName.toLowerCase().includes(q)) ||
          (r.id && r.id.toLowerCase().includes(q)) ||
          (r.tenantId && r.tenantId.toLowerCase().includes(q))
        );
      }
      if (options.status) {
        list = list.filter(r => r.status === options.status);
      }

      return { restaurants: list, meta };
    }

    /**
     * Get single restaurant dossier
     */
    async getRestaurant(tenantId) {
      if (!tenantId) throw new Error('شناسه مجموعه (tenantId) الزامی است.');

      if (this._appMode?.isProduction()) {
        const response = await this._client.get(`/api/control/tenants/${encodeURIComponent(tenantId)}`);
        return {
          restaurant: this._normalizeSingle(response.data),
          meta: response.meta
        };
      }

      // Demo mode
      try {
        const response = await this._client.get(`/api/control/tenants/${encodeURIComponent(tenantId)}`, { timeoutMs: 3000 });
        if (response && response.data) {
          return {
            restaurant: this._normalizeSingle(response.data),
            meta: response.meta
          };
        }
      } catch (_) {}

      const store = this._store;
      const local = (store && typeof store.getTenant === 'function')
        ? store.getTenant(tenantId)
        : null;

      if (!local) {
        const error = new Error(`مجموعه «${tenantId}» یافت نشد.`);
        error.code = 'TENANT_NOT_FOUND';
        throw error;
      }

      return {
        restaurant: this._normalizeSingle(local),
        meta: {
          source: 'demo-fixture',
          status: 'demo',
          observedAt: new Date().toISOString()
        }
      };
    }

    /**
     * Create Draft Tenant
     */
    async createDraftTenant(data) {
      if (!data.displayName || !data.tenantId) {
        throw new Error('نام مجموعه و شناسه یکتا (slug) الزامی است.');
      }

      const cleanSlug = String(data.tenantId || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      const domain = data.canonicalDomain || `${cleanSlug || 'tenant'}.salsa.ir`;

      const payload = {
        tenantId: data.tenantId,
        displayName: data.displayName,
        planCode: data.planCode || 'growth',
        cellId: data.cellId || 'cell-teh-01',
        canonicalDomain: domain,
        metadata: {
          city: data.city || 'تهران',
          ownerName: data.ownerName || '',
          ownerPhone: data.ownerPhone || '',
          ownerEmail: data.ownerEmail || '',
          primaryBranchName: data.primaryBranchName || 'شعبه اصلی',
          selectedModules: Array.isArray(data.selectedModules) ? data.selectedModules : []
        }
      };

      try {
        const response = await this._client.post('/api/control/tenants', payload);
        return response.data;
      } catch (err) {
        if (this._appMode?.isDemo()) {
          const store = this._store;
          if (store && typeof store.createTenant === 'function') {
            const storeSlug = payload.tenantId.replace(/^tnt[-_]/, '').replace(/[^a-z0-9-]/g, '-');
            const created = store.createTenant({
              slug: storeSlug,
              id: payload.tenantId,
              name: payload.displayName,
              domain: payload.canonicalDomain,
              status: 'provisioning',
              plan: payload.planCode,
              selectedModules: payload.metadata.selectedModules,
              primaryBranchName: payload.metadata.primaryBranchName,
              ...payload.metadata
            });
            const actualTenant = store.getTenant(`tnt_${storeSlug}`) || store.getTenant(payload.tenantId) || created.tenant || created;
            return {
              tenantId: actualTenant?.id || payload.tenantId,
              displayName: payload.displayName,
              status: 'provisioning',
              ...actualTenant
            };
          }
        }
        throw err;
      }
    }

    async create(data) {
      if (!data.tenantId) {
        data.tenantId = 'tnt_' + (data.slug || ('rest_' + Date.now()));
      }
      return this.createDraftTenant(data);
    }

    /**
     * Execute Tenant Provisioning (Idempotent)
     */
    async provisionTenant(data, idempotencyKey) {
      const payload = {
        tenantId: data.tenantId,
        displayName: data.displayName,
        planCode: data.planCode || 'growth',
        cellId: data.cellId || 'cell-teh-01',
        canonicalDomain: data.canonicalDomain,
        ownerEmail: data.ownerEmail || `${data.tenantId}@salsa.ir`,
        templateCode: data.templateCode || 'tpl-blank-cafe-v1',
        idempotencyKey: idempotencyKey || `idem_${data.tenantId}_${Date.now()}`
      };

      try {
        const response = await this._client.post('/api/control/provision', payload);
        return response.data;
      } catch (err) {
        if (this._appMode?.isDemo()) {
          const store = this._store;
          if (store) {
            const tid = payload.tenantId;
            const tenant = store.getTenant(tid) || store.getTenant(`tnt_${tid}`) || store.getTenant(tid.replace(/^tnt_/, ''));
            if (tenant) {
              tenant.status = 'active';
              store.save();
            }
            const jobs = store.state?.jobs || [];
            const job = jobs.find(j => j.tenantId === tid || j.tenantId === `tnt_${tid}`);
            if (job) {
              job.status = 'completed';
              job.progress = 100;
              job.progressPercent = 100;
              store.save();
            }
          }
          return {
            jobId: `job_demo_${Date.now()}`,
            status: 'completed',
            isDuplicate: false,
            message: 'راه‌اندازی نمایشی در حافظه موقت با موفقیت ثبت شد.'
          };
        }
        throw err;
      }
    }

    /**
     * Server-Authoritative Lifecycle Transition (superadmin.md §16.1)
     * Replaces unsafe local toggle; requires reason and creates server-side audit.
     */
    async transitionLifecycle(tenantId, nextStatus, reason) {
      if (!tenantId || !nextStatus) {
        throw new Error('شناسه رستوران و وضعیت جدید الزامی است.');
      }
      if (!reason || !reason.trim()) {
        throw new Error('ثبت دلیل برای تغییر وضعیت سرویس الزامی است.');
      }

      const payload = {
        status: nextStatus,
        reason: reason.trim()
      };

      try {
        const response = await this._client.post(`/api/control/tenants/${encodeURIComponent(tenantId)}/lifecycle`, payload);
        // Refresh local cache if present
        if (this._store && typeof this._store.updateTenantStatus === 'function') {
          this._store.updateTenantStatus(tenantId, nextStatus, reason);
        }
        return response.data;
      } catch (err) {
        if (this._appMode?.isDemo()) {
          const store = this._store;
          if (store) {
            const tenant = store.getTenant(tenantId) || store.getTenant(`tnt_${tenantId}`) || (store.state?.tenants || []).find(t => t.id === tenantId || t.slug === tenantId);
            if (tenant) {
              tenant.status = nextStatus;
              if (typeof store.save === 'function') store.save();
              return { success: true, status: nextStatus, tenantId: tenant.id };
            }
          }
        }
        throw err;
      }
    }

    async updateLifecycle(tenantId, nextStatus, reason) {
      return this.transitionLifecycle(tenantId, nextStatus, reason);
    }

    /**
     * Fetch Branches for a Restaurant
     */
    async getBranches(tenantId) {
      if (this._store && typeof this._store.getBranches === 'function') {
        const list = this._store.getBranches(tenantId);
        if (list && list.length > 0) return list;
      }

      // Default branch for tenant
      return [
        {
          id: `brn_${tenantId}_main`,
          tenantId,
          name: 'شعبه اصلی (مرکزی)',
          code: 'BR-01',
          isPrimary: true,
          status: 'active',
          city: 'تهران',
          address: 'تهران، دفتر مرکزی مجموعه',
          posCount: 2,
          kdsCount: 1,
          printerCount: 2
        }
      ];
    }

    getRolePermissions(role) {
      const store = this._store;
      if (store && typeof store.getRolePermissions === 'function') {
        return store.getRolePermissions(role);
      }
      return {
        role,
        nameFa: role,
        scope: 'branch',
        defaultPermissions: [],
        permissionsDetail: [],
        description: 'دسترسی پیش‌فرض'
      };
    }

    toggleTenantUserStatus(tenantId, userId, active, reason) {
      const store = this._store;
      if (store && typeof store.toggleTenantUserStatus === 'function') {
        return store.toggleTenantUserStatus(tenantId, userId, active, reason);
      }
      return { id: userId, status: active ? 'active' : 'suspended', active };
    }

    resetTenantUserCredentials(tenantId, userId, reason) {
      const store = this._store;
      if (store && typeof store.resetTenantUserCredentials === 'function') {
        return store.resetTenantUserCredentials(tenantId, userId, reason);
      }
      return {
        success: true,
        userId,
        tempOtp: '123456',
        expiresAt: '۱۵ دقیقه دیگر'
      };
    }

    // Normalizers ensuring clean, predictable shapes without raw leaking port/cells in regular UI
    _normalizeList(rawList) {
      return (rawList || []).map((item) => this._normalizeSingle(item));
    }

    _normalizeSingle(t) {
      if (!t) return null;
      const id = t.id || t.tenant_id || t.tenantId;
      const name = t.name || t.displayName || t.display_name || id;
      const status = t.status ? String(t.status).toLowerCase() : (t.lifecycleStatus ? String(t.lifecycleStatus).toLowerCase() : null);
      const plan = t.plan || t.planCode || t.plan_code || null;
      const city = t.city || t.metadata?.city || null;
      const domain = t.canonicalDomain || t.canonical_domain || t.domain || (Array.isArray(t.domains) && t.domains[0]) || null;
      const ownerName = t.ownerName || t.owner_name || t.metadata?.ownerName || t.owner?.name || null;
      const ownerPhone = t.ownerPhone || t.owner_phone || t.metadata?.ownerPhone || t.owner?.phone || null;
      const ownerEmail = t.ownerEmail || t.owner_email || t.metadata?.ownerEmail || t.owner?.email || null;
      const branchCount = typeof t.branchCount === 'number' 
        ? t.branchCount 
        : (typeof t.branch_count === 'number' 
            ? t.branch_count 
            : (Array.isArray(t.branches) ? t.branches.length : null));
      const cellId = t.cellId || t.cell_id || null;

      // Separate Lifecycle from Operational Health (superadmin.md §5 & §16)
      let health = t.health || 'healthy';
      let attentionReason = t.attentionReason || null;
      if (status === 'suspended') {
        health = 'incident';
        attentionReason = 'سرویس مجموعه به دلیل معوقه یا اقدام مدیریتی معلق است';
      } else if (status === 'past_due' || status === 'grace_period') {
        health = 'attention';
        attentionReason = 'فاکتور در دوره تنفس قرار دارد';
      }

      return {
        id,
        name,
        status,
        health,
        attentionReason,
        plan,
        city,
        domain,
        owner: {
          name: ownerName,
          phone: ownerPhone,
          email: ownerEmail
        },
        branchCount,
        cellId,
        createdAt: t.createdAt || t.created_at || null,
        lastObservedAt: t.lastObservedAt || t.last_observed_at || t.updatedAt || null
      };
    }
  }

  const RestaurantsRepoInstance = new RestaurantsRepository();
  global.RestaurantsRepository = RestaurantsRepoInstance;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RestaurantsRepoInstance;
  }
})(typeof window !== 'undefined' ? window : globalThis);
