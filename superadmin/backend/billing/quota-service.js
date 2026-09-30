// server/salsa/control-plane/billing/quota-service.js
'use strict';

const { getDatabase } = require('../db/database');
const auditService = require('../audit/audit-service');
const config = require('../config');

const DEFAULT_QUOTA = {
  maxBranches: 1,
  maxDevices: 2,
  maxUsers: 5,
  maxOrders: -1, // -1 means unlimited according to contract
  maxStorageMb: 5000,
  maxSms: 1000,
  currentBranches: 1,
  currentDevices: 1,
  currentUsers: 1,
  currentOrders: 42,
  currentStorageMb: 120,
  currentSms: 85
};

class QuotaService {
  constructor() {
    this.db = getDatabase();
    this.inMemoryQuotas = new Map();
    this.reservationLocks = new Map();
    this.allowInMemoryFallback = config.isTest && process.env.SALSA_SEED_FIXTURES !== 'false';
  }

  reset() {
    this.inMemoryQuotas.clear();
    this.reservationLocks.clear();
  }

  async listQuotas() {
    try {
      const res = await this.db.query('SELECT * FROM neem_billing_quotas ORDER BY tenant_id');
      if (res.rows && res.rows.length > 0) {
        return res.rows.map(r => this._formatQuotaRow(r));
      }
      if (!this.allowInMemoryFallback) return [];
    } catch (error) {
      if (!this.allowInMemoryFallback) {
        error.code = error.code || 'QUOTA_DATABASE_UNAVAILABLE';
        throw error;
      }
    }

    if (this.inMemoryQuotas.size === 0) {
      this._seedDefaults();
    }
    return Array.from(this.inMemoryQuotas.values());
  }

  async getQuotas(tenantId) {
    if (!tenantId) throw new Error('QUOTA_ERROR: tenantId is required.');

    let raw = null;
    try {
      const sql = 'SELECT * FROM neem_billing_quotas WHERE tenant_id = $1';
      const res = await this.db.query(sql, [tenantId]);
      if (res.rows && res.rows.length > 0) {
        raw = this._formatQuotaRow(res.rows[0]);
      }
    } catch (error) {
      if (!this.allowInMemoryFallback) {
        error.code = error.code || 'QUOTA_DATABASE_UNAVAILABLE';
        throw error;
      }
    }

    if (!raw) {
      if (!this.allowInMemoryFallback) {
        const err = new Error(`QUOTA_NOT_INITIALIZED: No quota row exists for tenant '${tenantId}'.`);
        err.code = 'QUOTA_NOT_INITIALIZED';
        err.status = 409;
        throw err;
      }
      if (this.inMemoryQuotas.has(tenantId)) {
        raw = this.inMemoryQuotas.get(tenantId);
      } else {
        raw = {
          tenantId,
          ...DEFAULT_QUOTA,
          lastMeasuredAt: new Date().toISOString()
        };
        this.inMemoryQuotas.set(tenantId, raw);
      }
    }

    // Return unified object with both flat and nested limits/used properties
    return this._wrapQuota(raw);
  }

  formatUnlimited(val) {
    return val === -1 ? 'نامحدود طبق قرارداد' : String(val);
  }

  _wrapQuota(raw) {
    return {
      ...raw,
      limits: {
        branches: raw.maxBranches,
        devices: raw.maxDevices,
        users: raw.maxUsers,
        orders: raw.maxOrders,
        storageMb: raw.maxStorageMb,
        smsCredits: raw.maxSms
      },
      used: {
        branches: raw.currentBranches,
        devices: raw.currentDevices,
        users: raw.currentUsers,
        orders: raw.currentOrders,
        storageMb: raw.currentStorageMb,
        smsCredits: raw.currentSms
      }
    };
  }

  async setQuotas(tenantId, newQuotas = {}, actorId = 'platform_system') {
    if (!tenantId) throw new Error('QUOTA_ERROR: tenantId is required.');

    const current = await this.getQuotas(tenantId);

    // Support both short names (branches, devices, etc.) and maxNames (maxBranches, maxDevices, etc.)
    const readLimit = (shortKey, longKey, currentValue) => {
      const value = newQuotas[shortKey] !== undefined ? newQuotas[shortKey] : newQuotas[longKey];
      if (value === undefined) return currentValue;
      const normalized = Number(value);
      if (!Number.isInteger(normalized) || normalized < -1) {
        throw new Error(`QUOTA_ERROR: ${shortKey} must be an integer greater than or equal to -1.`);
      }
      return normalized;
    };
    const maxBranches = readLimit('branches', 'maxBranches', current.maxBranches);
    const maxDevices = readLimit('devices', 'maxDevices', current.maxDevices);
    const maxUsers = readLimit('users', 'maxUsers', current.maxUsers);
    const maxOrders = readLimit('orders', 'maxOrders', current.maxOrders);
    const maxStorageMb = readLimit('storageMb', 'maxStorageMb', current.maxStorageMb);
    const maxSms = readLimit('smsCredits', 'maxSms', current.maxSms);

    // AC-25 Rule: Downgrade from higher limit does NOT delete existing resources
    const updated = {
      tenantId,
      maxBranches,
      maxDevices,
      maxUsers,
      maxOrders,
      maxStorageMb,
      maxSms,
      max_branches: maxBranches,
      max_devices: maxDevices,
      max_users: maxUsers,
      max_orders_monthly: maxOrders,
      max_storage_mb: maxStorageMb,
      max_sms_monthly: maxSms,
      currentBranches: current.currentBranches,
      currentDevices: current.currentDevices,
      currentUsers: current.currentUsers,
      currentOrders: current.currentOrders,
      currentStorageMb: current.currentStorageMb,
      currentSms: current.currentSms,
      current_branches: current.currentBranches,
      current_devices: current.currentDevices,
      current_users: current.currentUsers,
      current_orders_monthly: current.currentOrders,
      current_storage_mb: current.currentStorageMb,
      current_sms_monthly: current.currentSms,
      lastMeasuredAt: new Date().toISOString()
    };

    try {
      const sql = `
        INSERT INTO neem_billing_quotas
          (tenant_id, max_branches, max_devices, max_users, max_orders_monthly, max_storage_mb, max_sms_monthly, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, now())
        ON CONFLICT (tenant_id) DO UPDATE
          SET max_branches = EXCLUDED.max_branches,
              max_devices = EXCLUDED.max_devices,
              max_users = EXCLUDED.max_users,
              max_orders_monthly = EXCLUDED.max_orders_monthly,
              max_storage_mb = EXCLUDED.max_storage_mb,
              max_sms_monthly = EXCLUDED.max_sms_monthly,
              updated_at = now()
        RETURNING *
      `;
      const dbRes = await this.db.query(sql, [
        tenantId,
        updated.maxBranches,
        updated.maxDevices,
        updated.maxUsers,
        updated.maxOrders,
        updated.maxStorageMb,
        updated.maxSms
      ]);
      if (!this.allowInMemoryFallback && (!dbRes || !dbRes.rows || dbRes.rows.length === 0)) {
        throw new Error(`QUOTA_UPDATE_NOT_PERSISTED: No quota row was returned for tenant '${tenantId}'.`);
      }
    } catch (error) {
      if (!this.allowInMemoryFallback) {
        error.code = error.code || 'QUOTA_DATABASE_WRITE_FAILED';
        throw error;
      }
    }

    this.inMemoryQuotas.set(tenantId, updated);

    await auditService.recordEvent({
      actorId,
      action: 'BILLING_QUOTA_UPDATED',
      targetType: 'quota',
      targetId: tenantId,
      tenantId,
      metadata: {
        previous: current,
        updated: {
          maxBranches: updated.maxBranches,
          maxDevices: updated.maxDevices,
          maxUsers: updated.maxUsers,
          maxOrders: updated.maxOrders,
          maxStorageMb: updated.maxStorageMb,
          maxSms: updated.maxSms
        }
      }
    });

    return updated;
  }

  /**
   * Atomic Quota Reservation (AC-26):
   * Prevents parallel requests from bypassing quotas through sequential atomic lock checks.
   */
  async atomicReserve(tenantId, resourceType, quantity = 1) {
    if (!tenantId || !resourceType) {
      throw new Error('QUOTA_ERROR: tenantId and resourceType are required for reservation.');
    }

    quantity = Number(quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error('QUOTA_ERROR: quantity must be a positive integer.');
    }

    const resourceColumns = {
      branch: ['current_branches', 'max_branches', 'currentBranches'],
      branches: ['current_branches', 'max_branches', 'currentBranches'],
      device: ['current_devices', 'max_devices', 'currentDevices'],
      devices: ['current_devices', 'max_devices', 'currentDevices'],
      user: ['current_users', 'max_users', 'currentUsers'],
      users: ['current_users', 'max_users', 'currentUsers'],
      order: ['current_orders_monthly', 'max_orders_monthly', 'currentOrders'],
      orders: ['current_orders_monthly', 'max_orders_monthly', 'currentOrders'],
      sms: ['current_sms_monthly', 'max_sms_monthly', 'currentSms'],
      smsCredits: ['current_sms_monthly', 'max_sms_monthly', 'currentSms'],
      storage: ['current_storage_mb', 'max_storage_mb', 'currentStorageMb'],
      storageMb: ['current_storage_mb', 'max_storage_mb', 'currentStorageMb']
    };
    const columns = resourceColumns[resourceType];
    if (!columns) {
      throw new Error(`QUOTA_ERROR: Unsupported resourceType '${resourceType}'.`);
    }

    if (!this.allowInMemoryFallback) {
      const [currentColumn, maxColumn, currentKey] = columns;
      const result = await this.db.query(
        `UPDATE neem_billing_quotas
            SET ${currentColumn} = ${currentColumn} + $1, updated_at = now()
          WHERE tenant_id = $2
            AND (${maxColumn} = -1 OR ${currentColumn} + $1 <= ${maxColumn})
          RETURNING ${currentColumn} AS current_value, ${maxColumn} AS max_value`,
        [quantity, tenantId]
      );
      if (!result.rows || result.rows.length === 0) {
        const quota = await this.getQuotas(tenantId);
        const current = Number(quota[currentKey]);
        const maxKey = {
          currentBranches: 'maxBranches',
          currentDevices: 'maxDevices',
          currentUsers: 'maxUsers',
          currentOrders: 'maxOrders',
          currentSms: 'maxSms',
          currentStorageMb: 'maxStorageMb'
        }[currentKey];
        const max = Number(quota[maxKey]);
        if (max !== -1 && current + quantity > max) {
          const err = new Error(`QUOTA_EXCEEDED: Resource limit reached for '${resourceType}' (${current}/${max}). Requesting +${quantity} exceeds quota.`);
          err.code = 'QUOTA_EXCEEDED';
          err.status = 409;
          throw err;
        }
        throw new Error(`QUOTA_RESERVATION_NOT_PERSISTED: Tenant '${tenantId}' quota row was not updated.`);
      }
      const row = result.rows[0];
      return {
        success: true,
        tenantId,
        resourceType,
        reservedQuantity: quantity,
        current: Number(row.current_value),
        used: Number(row.current_value),
        limit: Number(row.max_value),
        max: Number(row.max_value),
        isUnlimited: Number(row.max_value) === -1
      };
    }

    const lockKey = `${tenantId}:${resourceType}`;
    const prevLock = this.reservationLocks.get(lockKey) || Promise.resolve();
    let releaseLock;
    const currentLock = new Promise(resolve => { releaseLock = resolve; });
    this.reservationLocks.set(lockKey, currentLock);

    try {
      await prevLock;
      const quota = await this.getQuotas(tenantId);
      let currentKey;
      let maxKey;

      if (resourceType === 'branch' || resourceType === 'branches') {
        currentKey = 'currentBranches';
        maxKey = 'maxBranches';
      } else if (resourceType === 'device' || resourceType === 'devices') {
        currentKey = 'currentDevices';
        maxKey = 'maxDevices';
      } else if (resourceType === 'user' || resourceType === 'users') {
        currentKey = 'currentUsers';
        maxKey = 'maxUsers';
      } else if (resourceType === 'order' || resourceType === 'orders') {
        currentKey = 'currentOrders';
        maxKey = 'maxOrders';
      } else if (resourceType === 'sms' || resourceType === 'smsCredits') {
        currentKey = 'currentSms';
        maxKey = 'maxSms';
      } else if (resourceType === 'storage' || resourceType === 'storageMb') {
        currentKey = 'currentStorageMb';
        maxKey = 'maxStorageMb';
      }

      const max = quota[maxKey];
      const current = quota[currentKey];

      // Check if unlimited (-1)
      if (max !== -1 && current + quantity > max) {
        const err = new Error(`QUOTA_EXCEEDED: Resource limit reached for '${resourceType}' (${current}/${max}). Requesting +${quantity} exceeds quota.`);
        err.code = 'QUOTA_EXCEEDED';
        err.status = 409;
        throw err;
      }

      // Atomic increment
      const updatedCount = current + quantity;
      const stored = this.inMemoryQuotas.get(tenantId) || quota;
      stored[currentKey] = updatedCount;
      stored.lastMeasuredAt = new Date().toISOString();
      this.inMemoryQuotas.set(tenantId, stored);

      const colMap = {
        currentBranches: 'current_branches',
        currentDevices: 'current_devices',
        currentUsers: 'current_users',
        currentOrders: 'current_orders_monthly',
        currentStorageMb: 'current_storage_mb',
        currentSms: 'current_sms_monthly'
      };
      const col = colMap[currentKey] || 'current_branches';
      try {
        await this.db.query(`UPDATE neem_billing_quotas SET ${col} = $1 WHERE tenant_id = $2`, [updatedCount, tenantId]);
      } catch {}

      return {
        success: true,
        tenantId,
        resourceType,
        reservedQuantity: quantity,
        current: updatedCount,
        used: updatedCount,
        limit: max,
        max,
        isUnlimited: max === -1
      };
    } finally {
      releaseLock();
      if (this.reservationLocks.get(lockKey) === currentLock) {
        this.reservationLocks.delete(lockKey);
      }
    }
  }

  async checkAndEnforce(tenantId, resourceType) {
    const quotas = await this.getQuotas(tenantId);
    let allowed = true;
    let current = 0;
    let max = 0;

    if (resourceType === 'branch') {
      current = quotas.currentBranches;
      max = quotas.maxBranches;
      allowed = max === -1 || current < max;
    } else if (resourceType === 'device') {
      current = quotas.currentDevices;
      max = quotas.maxDevices;
      allowed = max === -1 || current < max;
    } else if (resourceType === 'user') {
      current = quotas.currentUsers;
      max = quotas.maxUsers;
      allowed = max === -1 || current < max;
    } else if (resourceType === 'order') {
      current = quotas.currentOrders;
      max = quotas.maxOrders;
      allowed = max === -1 || current < max;
    } else if (resourceType === 'sms') {
      current = quotas.currentSms;
      max = quotas.maxSms;
      allowed = max === -1 || current < max;
    }

    if (!allowed) {
      const err = new Error(`QUOTA_EXCEEDED: Resource limit reached for '${resourceType}' (${current}/${max}). Upgrade your subscription plan.`);
      err.code = 'QUOTA_EXCEEDED';
      err.status = 409;
      throw err;
    }

    return { allowed: true, current, max, isUnlimited: max === -1 };
  }

  _formatQuotaRow(r) {
    return {
      tenantId: r.tenant_id,
      maxBranches: r.max_branches ?? 1,
      maxDevices: r.max_devices ?? 2,
      maxUsers: r.max_users ?? 5,
      maxOrders: r.max_orders_monthly !== undefined ? r.max_orders_monthly : -1,
      maxStorageMb: r.max_storage_mb ?? 5000,
      maxSms: r.max_sms_monthly ?? 1000,
      currentBranches: r.current_branches ?? 0,
      currentDevices: r.current_devices ?? 0,
      currentUsers: r.current_users ?? 0,
      currentOrders: r.current_orders_monthly ?? 0,
      currentStorageMb: r.current_storage_mb ?? 0,
      currentSms: r.current_sms_monthly ?? 0,
      lastMeasuredAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString()
    };
  }

  _seedDefaults() {
    this.inMemoryQuotas.set('westo-demo', {
      tenantId: 'westo-demo',
      maxBranches: 5,
      maxDevices: 12,
      maxUsers: 40,
      maxOrders: -1, // Unlimited per contract
      maxStorageMb: 15000,
      maxSms: 5000,
      currentBranches: 2,
      currentDevices: 4,
      currentUsers: 8,
      currentOrders: 328,
      currentStorageMb: 2450,
      currentSms: 680,
      lastMeasuredAt: new Date().toISOString()
    });

    this.inMemoryQuotas.set('tehran-cafe-02', {
      tenantId: 'tehran-cafe-02',
      maxBranches: 1,
      maxDevices: 2,
      maxUsers: 5,
      maxOrders: -1,
      maxStorageMb: 2000,
      maxSms: 500,
      currentBranches: 1,
      currentDevices: 2,
      currentUsers: 3,
      currentOrders: 85,
      currentStorageMb: 410,
      currentSms: 120,
      lastMeasuredAt: new Date().toISOString()
    });
  }
}

module.exports = new QuotaService();
