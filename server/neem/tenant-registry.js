// server/neem/tenant-registry.js
'use strict';

const fs = require('fs');
const path = require('path');
const { CANONICAL_FEATURES } = require('./canonical-features');

const TENANTS_DIR = path.resolve(__dirname, '../data/tenants');
const DEFAULT_JSON_DB_PATH = path.resolve(__dirname, '../data/db.json');

function ensureTenantsDirectory() {
  if (!fs.existsSync(TENANTS_DIR)) {
    fs.mkdirSync(TENANTS_DIR, { recursive: true });
  }
}

function normalizeDigits(val) {
  return String(val || '')
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

/**
 * Creates a zero-data, completely clean/raw tenant database
 */
function createBlankTenantDb(tenantId, options = {}) {
  const cleanId = String(tenantId).trim().toLowerCase();
  const displayName = options.name || options.tradeName || `مجموعه ${cleanId}`;
  const ownerPhone = options.ownerPhone ? normalizeDigits(options.ownerPhone).trim() : '09120000000';
  const ownerName = options.ownerName || 'مدیر مجموعه';
  const canonicalDomain = options.domain || `${cleanId}.neem.ir`;

  return {
    tenantIdentity: {
      tenantId: cleanId,
      tenantSlug: cleanId,
      displayName,
      canonicalDomain,
      cellId: options.cellId || 'cell-teh-01',
      storageMode: 'database-per-tenant',
      plan: options.plan || 'Starter (پایه)',
      templateCode: options.templateCode || 'tpl-blank-cafe-v1',
      createdAt: new Date().toISOString(),
    },
    settings: {
      otpTtlMs: 120000,
      siteTitle: displayName,
      metaDescription: `سامانه منو، سفارش آنلاین و عملیات ${displayName}`,
      adminPhones: [ownerPhone],
      currency: 'IRR',
      tomanConversionRate: 10,
      taxPercent: 10,
      serviceChargePercent: 0,
      packagingFeeIrr: 0,
    },
    restaurant: {
      name: displayName,
      phone: ownerPhone,
      address: options.address || 'تهران',
    },
    branches: [
      {
        id: 1,
        slug: 'main',
        name: 'شعبه اصلی',
        address: options.address || '',
        phone: ownerPhone,
        active: true,
        hours: {
          saturday: { open: '09:00', close: '23:30' },
          sunday: { open: '09:00', close: '23:30' },
          monday: { open: '09:00', close: '23:30' },
          tuesday: { open: '09:00', close: '23:30' },
          wednesday: { open: '09:00', close: '23:30' },
          thursday: { open: '09:00', close: '23:30' },
          friday: { open: '09:00', close: '23:30' },
        },
      },
    ],
    tables: [], // 0 tables (clean)
    menuCategories: [
      { id: 1, title: 'پیش‌غذا', slug: 'appetizer', order: 1 },
      { id: 2, title: 'غذای اصلی', slug: 'main', order: 2 },
      { id: 3, title: 'نوشیدنی', slug: 'beverage', order: 3 },
      { id: 4, title: 'دسر', slug: 'dessert', order: 4 },
    ],
    menuItems: [], // 0 menu items (100% clean/raw commercial state)
    products: [],
    orders: [], // 0 orders
    users: [
      {
        id: 1,
        name: ownerName,
        phone: ownerPhone,
        role: 'owner',
        points: 0,
        active: true,
        createdAt: new Date().toISOString(),
      },
    ],
    accounting: {
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
        vatPercent: 10,
        serviceChargePercent: 0,
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
      enabled: true,
      pointsPerToman: 0.01,
      redeemValue: 1000,
      welcomePoints: 50,
    },
    neemIntegration: {
      enabled: true,
      tenantId: cleanId,
      endpoint: '',
      outbox: [],
      lastError: '',
      mode: 'outbox',
    },
  };
}

class TenantRegistry {
  constructor(baseWestoDb, dbPath = DEFAULT_JSON_DB_PATH) {
    this.baseWestoDb = baseWestoDb;
    this.baseDbPath = dbPath;
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
    ensureTenantsDirectory();
    return path.join(TENANTS_DIR, `${tenantId}.json`);
  }

  getTenantDb(tenantId = 'westo') {
    const cleanId = String(tenantId || 'westo').trim().toLowerCase();
    if (cleanId === 'westo') {
      return this.baseWestoDb;
    }

    if (this.tenants.has(cleanId)) {
      return this.tenants.get(cleanId);
    }

    const filePath = this.getTenantFilePath(cleanId);
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.tenants.set(cleanId, parsed);
        return parsed;
      } catch (err) {
        console.error(`[tenant-registry] Failed to read tenant ${cleanId} DB:`, err.message);
      }
    }

    // Provision clean zero-data tenant on first access
    const blankDb = createBlankTenantDb(cleanId);
    this.tenants.set(cleanId, blankDb);
    this.saveTenantDb(cleanId);
    return blankDb;
  }

  saveTenantDb(tenantId = 'westo') {
    const cleanId = String(tenantId || 'westo').trim().toLowerCase();
    if (cleanId === 'westo') {
      return; // Handled by global save()
    }

    const tenantDb = this.tenants.get(cleanId);
    if (!tenantDb) return;

    try {
      const filePath = this.getTenantFilePath(cleanId);
      const tmpPath = `${filePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(tenantDb, null, 2), { mode: 0o600 });
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      console.error(`[tenant-registry] Failed to persist tenant ${cleanId}:`, err.message);
    }
  }

  provisionTenant(tenantId, options = {}) {
    const cleanId = String(tenantId).trim().toLowerCase();
    const blankDb = createBlankTenantDb(cleanId, options);
    this.tenants.set(cleanId, blankDb);
    this.saveTenantDb(cleanId);
    return blankDb;
  }

  listTenants() {
    ensureTenantsDirectory();
    const files = fs.readdirSync(TENANTS_DIR).filter((f) => f.endsWith('.json'));
    const list = [
      {
        id: 'westo',
        slug: 'westo',
        name: this.baseWestoDb.settings?.siteTitle || 'کافه وستو',
        subdomain: 'westo.neem.ir',
        isPilot: true,
      },
    ];

    for (const file of files) {
      const slug = file.replace(/\.json$/, '');
      if (slug === 'westo') continue;
      const tDb = this.getTenantDb(slug);
      list.push({
        id: slug,
        slug,
        name: tDb.restaurant?.name || tDb.settings?.siteTitle || slug,
        subdomain: `${slug}.neem.ir`,
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
