// server/salsa/tenant-registry.js
'use strict';

const fs = require('fs');
const path = require('path');
const { CANONICAL_FEATURES } = require('./canonical-features');
const { defaultVersions, validateSelections } = require('../../modules/runtime');

const TENANTS_DIR = path.resolve(__dirname, '../data/tenants');
const DEFAULT_JSON_DB_PATH = path.resolve(__dirname, '../data/db.json');

function ensureTenantsDirectory(directory = TENANTS_DIR) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function normalizeDigits(val) {
  return String(val || '')
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

function normalizeTenantId(value) {
  const clean = String(value || '').trim().toLowerCase();
  return /^[a-z][a-z0-9-]{1,62}$/.test(clean) ? clean : null;
}

function tenantIdentityMatches(db, tenantId) {
  return normalizeTenantId(db?.tenantIdentity?.tenantId) === tenantId;
}

function tenantRegistryError(message, code) {
  return Object.assign(new Error(message), { code, status: 503 });
}

function hostnameFromHostHeader(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  if (!raw) return '';
  try {
    return new URL(`http://${raw}`).hostname.toLowerCase().replace(/\.$/, '');
  } catch (_error) {
    return raw.split(':')[0];
  }
}

/**
 * Creates a zero-data, completely clean/raw tenant database
 */
function createBlankTenantDb(tenantId, options = {}) {
  const cleanId = String(tenantId).trim().toLowerCase();
  const displayName = String(options.name || options.tradeName || '').trim() || null;
  const ownerPhone = typeof options.ownerPhone === 'string'
    ? normalizeDigits(options.ownerPhone).trim()
    : '';
  const ownerName = String(options.ownerName || '').trim() || null;
  const canonicalDomain = String(options.domain || '').trim().toLowerCase() || null;
  const address = String(options.address || '').trim() || null;
  const hasOwnerPhone = ownerPhone.length > 0;

  return {
    tenantIdentity: {
      tenantId: cleanId,
      tenantSlug: cleanId,
      displayName,
      canonicalDomain,
      cellId: options.cellId || null,
      storageMode: 'database-per-tenant',
      plan: options.plan || null,
      templateCode: options.templateCode || 'tpl-blank-cafe-v1',
      moduleVersions: { ...defaultVersions(), ...validateSelections(options.moduleVersions || {}) },
      createdAt: new Date().toISOString(),
    },
    settings: {
      otpTtlMs: 120000,
      siteTitle: displayName,
      metaDescription: null,
      adminPhones: hasOwnerPhone ? [ownerPhone] : [],
      currency: null,
      tomanConversionRate: null,
      taxPercent: null,
      serviceChargePercent: null,
      packagingFeeIrr: null,
    },
    restaurant: {
      name: displayName,
      phone: hasOwnerPhone ? ownerPhone : null,
      address,
    },
    branches: [],
    tables: [], // 0 tables (clean)
    menuCategories: [],
    menuItems: [], // 0 menu items (100% clean/raw commercial state)
    products: [],
    content: {},
    faq: [],
    hours: {},
    promotions: [],
    promoSlides: [],
    menuComplements: [],
    menuComplementRules: [],
    reservations: [],
    waiterCalls: [],
    deliveryZones: [],
    auditLog: [],
    cashSessions: [],
    staffShifts: [],
    paymentAttempts: [],
    orders: [], // 0 orders
    users: hasOwnerPhone ? [
      {
        id: 1,
        name: ownerName,
        phone: ownerPhone,
        role: 'owner',
        points: 0,
        active: true,
        createdAt: new Date().toISOString(),
      },
    ] : [],
    accounting: {
      settings: { autoPostOrders: true },
      chartOfAccounts: [
        { code: '1110', nameFa: 'صندوق نقد', type: 'asset', normalBalance: 'debit' },
        { code: '1310', nameFa: 'حساب‌های بانکی و درگاه آنلاین', type: 'asset', normalBalance: 'debit' },
        { code: '1320', nameFa: 'کارتخوان‌های POS', type: 'asset', normalBalance: 'debit' },
        { code: '1610', nameFa: 'موجودی انبار مواد اولیه', type: 'asset', normalBalance: 'debit' },
        { code: '2110', nameFa: 'حساب‌های پرداختنی (بستانکاران)', type: 'liability', normalBalance: 'credit' },
        { code: '2120', nameFa: 'کالای دریافت شده فاکتور نشده (GRNI)', type: 'liability', normalBalance: 'credit' },
        { code: '2210', nameFa: 'مالیات بر ارزش افزوده فروش', type: 'liability', normalBalance: 'credit' },
        { code: '2500', nameFa: 'سپرده و شارژ کیف پول مشتریان', type: 'liability', normalBalance: 'credit' },
        { code: '3100', nameFa: 'سرمایه و حقوق صاحبان سهام', type: 'equity', normalBalance: 'credit' },
        { code: '4110', nameFa: 'درآمد حاصل از فروش غذا و نوشیدنی', type: 'revenue', normalBalance: 'credit' },
        { code: '5100', nameFa: 'بهای تمام‌شده کالای فروش‌رفته (COGS)', type: 'expense', normalBalance: 'debit' },
        { code: '6100', nameFa: 'هزینه‌های جاری و عملیاتی', type: 'expense', normalBalance: 'debit' },
      ],
      inventoryItems: [], // 0 items
      vendors: [],
    },
    financeV2: {
      rollout: { captureEnabled: true, enabledBranchIds: [], cutoverBranchIds: [] },
      journalEntries: [],
      events: [],
      recipeVersions: [],
      goodsReceipts: [],
      purchaseOrders: [],
      vendorInvoices: [],
      inventoryMovements: [],
      cashSessions: [],
      idempotency: {},
      idempotencyRequests: {},
      settings: {
        vatPercent: null,
        serviceChargePercent: null,
      },
    },
    featureEntitlements: {
      'core.workspace': { active: true, status: 'active', updatedAt: new Date().toISOString() },
      'catalog.menu': { active: true, status: 'active', updatedAt: new Date().toISOString() },
    },
    theme: {
      accent: '#78d0d8',
      accentInk: '#0a1a1c',
      surface: '#111318',
      bg: '#08090b',
      fog: '#ece8e2',
      radius: 14,
      fontDisplay: 'Vazirmatn',
    },
    loyalty: {
      enabled: null,
      pointsPerToman: null,
      redeemValue: null,
      welcomePoints: null,
    },
    salsaIntegration: {
      enabled: false,
      tenantId: cleanId,
      endpoint: null,
      outbox: [],
      lastError: '',
      mode: 'unconfigured',
    },
    neemIntegration: {
      enabled: false,
      tenantId: cleanId,
      endpoint: null,
      outbox: [],
      lastError: '',
      mode: 'unconfigured',
    },
  };
}

class TenantRegistry {
  constructor(baseWestoDb, dbPath = DEFAULT_JSON_DB_PATH) {
    this.baseWestoDb = baseWestoDb;
    this.baseDbPath = dbPath;
    this.tenantsDir = path.join(path.dirname(dbPath), 'tenants');
    this.tenants = new Map();
    this.tenants.set('westo', baseWestoDb);

    // Ensure Westo has all 48 canonical features active
    this.ensureWestoPilotFeatures();
  }

  ensureWestoPilotFeatures() {
    if (!this.baseWestoDb.featureEntitlements) {
      this.baseWestoDb.featureEntitlements = {};
    }
    for (const feat of CANONICAL_FEATURES) {
      if (!this.baseWestoDb.featureEntitlements[feat.key]) {
        this.baseWestoDb.featureEntitlements[feat.key] = {
          active: true,
          status: 'active',
          updatedAt: new Date().toISOString(),
        };
      }
    }
  }

  getTenantFilePath(tenantId) {
    const cleanId = normalizeTenantId(tenantId);
    if (!cleanId) {
      throw Object.assign(new Error('TENANT_ID_INVALID: tenant id must be canonical.'), {
        code: 'tenant_id_invalid',
        status: 400,
      });
    }
    ensureTenantsDirectory(this.tenantsDir);
    return path.join(this.tenantsDir, `${cleanId}.json`);
  }

  hasTenant(tenantId) {
    const cleanId = normalizeTenantId(tenantId);
    if (!cleanId) return false;
    if (cleanId === 'westo') return true;
    return Boolean(this.getTenantDb(cleanId));
  }

  getTenantDb(tenantId = 'westo') {
    const cleanId = normalizeTenantId(tenantId);
    // Reads must never provision. Tenant creation is an explicit control-plane
    // operation; an unknown id is a hard miss and cannot create an object or
    // write a tenant JSON file as a side effect of a request.
    if (!cleanId) return null;
    if (cleanId === 'westo') {
      return this.baseWestoDb;
    }

    if (this.tenants.has(cleanId)) {
      const cached = this.tenants.get(cleanId);
      if (!tenantIdentityMatches(cached, cleanId)) {
        console.error(`[tenant-registry] Refusing tenant identity mismatch for ${cleanId}.`);
        return null;
      }
      return cached;
    }

    const filePath = this.getTenantFilePath(cleanId);
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!tenantIdentityMatches(parsed, cleanId)) {
          console.error(`[tenant-registry] Refusing persisted tenant identity mismatch for ${cleanId}.`);
          return null;
        }
        this.tenants.set(cleanId, parsed);
        return parsed;
      } catch (err) {
        console.error(`[tenant-registry] Failed to read tenant ${cleanId} DB:`, err.message);
      }
    }

    return null;
  }

  saveTenantDb(tenantId = 'westo', options = {}) {
    const cleanId = normalizeTenantId(tenantId || 'westo');
    if (!cleanId) {
      throw Object.assign(new Error('TENANT_ID_INVALID: tenant id must be canonical.'), {
        code: 'tenant_id_invalid',
        status: 400,
      });
    }
    if (cleanId === 'westo') {
      return; // Handled by global save()
    }

    const tenantDb = this.tenants.get(cleanId);
    if (!tenantDb) {
      if (options.requireDurable) {
        throw Object.assign(new Error(`Tenant ${cleanId} is not loaded and cannot be persisted.`), {
          code: 'tenant_persistence_target_missing',
          status: 503,
        });
      }
      return false;
    }
    if (!tenantIdentityMatches(tenantDb, cleanId)) {
      throw tenantRegistryError(`Tenant ${cleanId} cannot persist a database owned by another tenant.`, 'tenant_identity_mismatch');
    }

    try {
      const filePath = this.getTenantFilePath(cleanId);
      const tmpPath = `${filePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(tenantDb, null, 2), { mode: 0o600 });
      fs.renameSync(tmpPath, filePath);
      return true;
    } catch (err) {
      console.error(`[tenant-registry] Failed to persist tenant ${cleanId}:`, err.message);
      if (options.requireDurable) {
        throw Object.assign(err, {
          code: 'tenant_persistence_failed',
          status: 503,
        });
      }
      return false;
    }
  }

  provisionTenant(tenantId, options = {}) {
    const cleanId = normalizeTenantId(tenantId);
    if (!cleanId) {
      throw new Error('TENANT_ID_INVALID: tenant id must contain lowercase letters, digits, and hyphens only.');
    }
    const filePath = this.getTenantFilePath(cleanId);
    if (this.tenants.has(cleanId) || fs.existsSync(filePath)) {
      const existing = this.getTenantDb(cleanId);
      if (existing) return existing;
      throw tenantRegistryError(`Tenant ${cleanId} already has an unreadable or mismatched registry entry.`, 'tenant_registry_entry_invalid');
    }
    const blankDb = createBlankTenantDb(cleanId, options);
    this.tenants.set(cleanId, blankDb);
    try {
      this.saveTenantDb(cleanId, { requireDurable: true });
    } catch (error) {
      this.tenants.delete(cleanId);
      throw error;
    }
    return blankDb;
  }

  // Compatibility entry point used by the WESTO control-plane bridge.
  // Keeping provisioning here makes tenant creation idempotent and prevents
  // routes from constructing storage paths themselves.
  createTenant(tenantId, options = {}) {
    return this.provisionTenant(tenantId, options);
  }

  resolveTenantIdForHost(hostHeader, {
    baseDomain = 'salsa.ir',
    defaultTenantId = 'westo',
    defaultHosts = [],
  } = {}) {
    const hostname = hostnameFromHostHeader(hostHeader);
    if (!hostname) return null;

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return this.hasTenant(defaultTenantId) ? defaultTenantId : null;
    }

    const normalizedDefaultHosts = new Set(defaultHosts.map(hostnameFromHostHeader));
    if (normalizedDefaultHosts.has(hostname) && this.hasTenant(defaultTenantId)) {
      return defaultTenantId;
    }

    const suffixes = new Set([
      `.${String(baseDomain).toLowerCase()}`,
      '.salsa.ir',
      '.neem.ir',
    ]);
    for (const suffix of suffixes) {
      if (hostname.endsWith(suffix)) {
        const candidate = normalizeTenantId(hostname.slice(0, -suffix.length));
        if (candidate && this.hasTenant(candidate)) return candidate;
      }
    }

    if (hostname.endsWith('.localhost')) {
      const candidate = normalizeTenantId(hostname.slice(0, -'.localhost'.length));
      return candidate && this.hasTenant(candidate) ? candidate : null;
    }

    for (const tenant of this.listTenants()) {
      const tenantDb = this.getTenantDb(tenant.slug);
      const canonicalDomain = hostnameFromHostHeader(tenantDb.tenantIdentity?.canonicalDomain);
      if (canonicalDomain && canonicalDomain === hostname) return tenant.slug;
    }
    return null;
  }

  listTenants() {
    ensureTenantsDirectory(this.tenantsDir);
    const files = fs.readdirSync(this.tenantsDir).filter((f) => f.endsWith('.json'));
    const list = [
      {
        id: 'westo',
        slug: 'westo',
        name: this.baseWestoDb.settings?.siteTitle || 'کافه وستو',
        subdomain: 'westo.salsa.ir',
        isPilot: true,
      },
    ];

    for (const file of files) {
      const slug = normalizeTenantId(file.replace(/\.json$/, ''));
      if (!slug) continue;
      if (slug === 'westo') continue;
      const tDb = this.getTenantDb(slug);
      if (!tDb) continue;
      list.push({
        id: slug,
        slug,
        name: tDb.restaurant?.name || tDb.settings?.siteTitle || slug,
        subdomain: `${slug}.salsa.ir`,
        isPilot: false,
      });
    }

    return list;
  }
}

module.exports = {
  createBlankTenantDb,
  TenantRegistry,
};
