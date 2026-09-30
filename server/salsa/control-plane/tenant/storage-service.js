// server/salsa/control-plane/tenant/storage-service.js
'use strict';

const path = require('path');
const fs = require('fs');

/**
 * Tenant-Scoped File Storage Service
 * Enforces strict boundary isolation:
 * - Sanitizes paths to prevent directory traversal (e.g. '../')
 * - Ensures Tenant A has zero visibility into Tenant B's storage
 */
class TenantStorageService {
  constructor({ baseDir = null, isTest = process.env.NODE_ENV === 'test' } = {}) {
    this.isTest = isTest;
    this.baseDir = baseDir || path.resolve(process.cwd(), 'storage/tenants');
    // In-memory virtual store for safe test harness
    this.virtualStores = new Map();
  }

  _sanitizePath(tenantId, subPath) {
    if (!tenantId || typeof tenantId !== 'string') {
      throw new Error('STORAGE_ERROR: Valid tenantId is required.');
    }
    if (tenantId.includes('..') || tenantId.includes('/') || tenantId.includes('\\')) {
      throw new Error('SECURITY_VIOLATION: Invalid characters in tenantId.');
    }

    if (!subPath || typeof subPath !== 'string') {
      throw new Error('STORAGE_ERROR: Valid subPath is required.');
    }

    // Strictly block directory traversal attempts
    const normalized = path.normalize(subPath);
    if (subPath.includes('..') || normalized.startsWith('..') || path.isAbsolute(subPath)) {
      throw new Error('SECURITY_VIOLATION: Path traversal attempt blocked.');
    }

    const cleanSub = normalized.replace(/\0/g, '');
    return cleanSub;
  }

  async putFile(tenantId, subPath, content) {
    const cleanPath = this._sanitizePath(tenantId, subPath);

    if (this.isTest) {
      if (!this.virtualStores.has(tenantId)) {
        this.virtualStores.set(tenantId, new Map());
      }
      const store = this.virtualStores.get(tenantId);
      store.set(cleanPath, Buffer.isBuffer(content) ? content : Buffer.from(content));
      return {
        tenantId,
        path: cleanPath,
        sizeBytes: store.get(cleanPath).length,
        storedAt: new Date().toISOString()
      };
    }

    // Production Filesystem Mode
    const targetDir = path.join(this.baseDir, tenantId, path.dirname(cleanPath));
    const targetFile = path.join(this.baseDir, tenantId, cleanPath);
    await fs.promises.mkdir(targetDir, { recursive: true });
    await fs.promises.writeFile(targetFile, content);

    return {
      tenantId,
      path: cleanPath,
      sizeBytes: Buffer.byteLength(content),
      storedAt: new Date().toISOString()
    };
  }

  async getFile(tenantId, subPath) {
    const cleanPath = this._sanitizePath(tenantId, subPath);

    if (this.isTest) {
      const store = this.virtualStores.get(tenantId);
      if (!store || !store.has(cleanPath)) {
        return null;
      }
      return store.get(cleanPath);
    }

    const targetFile = path.join(this.baseDir, tenantId, cleanPath);
    try {
      return await fs.promises.readFile(targetFile);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async listFiles(tenantId) {
    if (!tenantId) throw new Error('Valid tenantId required.');

    if (this.isTest) {
      const store = this.virtualStores.get(tenantId);
      if (!store) return [];
      return Array.from(store.keys());
    }

    const tenantDir = path.join(this.baseDir, tenantId);
    try {
      const entries = await fs.promises.readdir(tenantDir, { recursive: true });
      return entries;
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async deleteFile(tenantId, subPath) {
    const cleanPath = this._sanitizePath(tenantId, subPath);

    if (this.isTest) {
      const store = this.virtualStores.get(tenantId);
      if (!store) return false;
      return store.delete(cleanPath);
    }

    const targetFile = path.join(this.baseDir, tenantId, cleanPath);
    try {
      await fs.promises.unlink(targetFile);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  }

  reset() {
    this.virtualStores.clear();
  }
}

module.exports = new TenantStorageService();
