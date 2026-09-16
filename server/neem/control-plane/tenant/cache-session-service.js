// server/neem/control-plane/tenant/cache-session-service.js
'use strict';

/**
 * Scoped Tenant Cache & Session Service
 * Enforces strict namespacing so no cross-tenant leakage can occur in cache or sessions.
 */
class TenantCacheSessionService {
  constructor() {
    this.cacheStore = new Map();
    this.sessionStore = new Map();
  }

  _scopedKey(tenantId, type, key) {
    if (!tenantId || !key) {
      throw new Error('CACHE_ERROR: Both tenantId and key are required.');
    }
    return `t:${tenantId}:${type}:${key}`;
  }

  // --- Cache Operations ---
  setCache(tenantId, key, value, ttlSeconds = 3600) {
    const compositeKey = this._scopedKey(tenantId, 'cache', key);
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.cacheStore.set(compositeKey, { value, expiresAt });
  }

  getCache(tenantId, key) {
    const compositeKey = this._scopedKey(tenantId, 'cache', key);
    const item = this.cacheStore.get(compositeKey);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.cacheStore.delete(compositeKey);
      return null;
    }
    return item.value;
  }

  deleteCache(tenantId, key) {
    const compositeKey = this._scopedKey(tenantId, 'cache', key);
    return this.cacheStore.delete(compositeKey);
  }

  // --- Scoped Tenant Sessions ---
  createTenantSession(tenantId, sessionId, userData, ttlSeconds = 86400) {
    const compositeKey = this._scopedKey(tenantId, 'sess', sessionId);
    const session = {
      tenantId,
      sessionId,
      userData,
      expiresAt: Date.now() + ttlSeconds * 1000,
      createdAt: new Date().toISOString()
    };
    this.sessionStore.set(compositeKey, session);
    return session;
  }

  getTenantSession(tenantId, sessionId) {
    const compositeKey = this._scopedKey(tenantId, 'sess', sessionId);
    const session = this.sessionStore.get(compositeKey);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this.sessionStore.delete(compositeKey);
      return null;
    }
    return session;
  }

  revokeTenantSession(tenantId, sessionId) {
    const compositeKey = this._scopedKey(tenantId, 'sess', sessionId);
    return this.sessionStore.delete(compositeKey);
  }

  reset() {
    this.cacheStore.clear();
    this.sessionStore.clear();
  }
}

module.exports = new TenantCacheSessionService();
