// server/neem/control-plane/tenant/template-service.js
'use strict';

const crypto = require('crypto');

/**
 * Zero-Data Canonical Tenant Database Template Specification
 * Designed according to GODMODE.MD Section 6, Section 28 (Phase 4 / GM-07):
 * - Guarantees ZERO commercial data in new tenants (0 orders, 0 menu items, 0 tables, 0 transactions).
 * - No hardcoded Westo legacy defaults or restaurant-specific metadata.
 * - Pure relational structure with standard tenant-level tables.
 */
const CANONICAL_TENANT_DDL = `
-- NEEM Zero-Data Tenant Schema V1.0.0
CREATE TABLE IF NOT EXISTS tenant_metadata (
    key VARCHAR(64) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_branches (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(32) NOT NULL UNIQUE,
    address TEXT,
    phone VARCHAR(32),
    is_main BOOLEAN DEFAULT false,
    status VARCHAR(32) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_users (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(32),
    role VARCHAR(32) NOT NULL,
    status VARCHAR(32) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_tables (
    id VARCHAR(64) PRIMARY KEY,
    branch_id VARCHAR(64) REFERENCES tenant_branches(id),
    table_number VARCHAR(32) NOT NULL,
    capacity INT DEFAULT 4,
    status VARCHAR(32) DEFAULT 'available',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_menu_items (
    id VARCHAR(64) PRIMARY KEY,
    branch_id VARCHAR(64) REFERENCES tenant_branches(id),
    category_id VARCHAR(64),
    title VARCHAR(255) NOT NULL,
    price_cents BIGINT NOT NULL DEFAULT 0,
    is_available BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_orders (
    id VARCHAR(64) PRIMARY KEY,
    branch_id VARCHAR(64) REFERENCES tenant_branches(id),
    order_number VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    total_amount_cents BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_ledger (
    id VARCHAR(64) PRIMARY KEY,
    account_code VARCHAR(32) NOT NULL,
    debit_cents BIGINT NOT NULL DEFAULT 0,
    credit_cents BIGINT NOT NULL DEFAULT 0,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
`.trim();

const CANONICAL_TEMPLATES = [
  {
    code: 'empty',
    name: 'حساب کاملاً خام (Zero-Data Raw)',
    version: '1.0.0',
    businessType: 'universal',
    description: 'پایگاه داده رابطه‌ای کاملاً خالی بدون ردیف‌های تجاری، منو، سفارش یا مانده افتتاحیه.',
    requiredFeatures: ['core.workspace'],
    zeroDataVerified: true,
    activeTenantsCount: 2
  },
  {
    code: 'cafe_suggested',
    name: 'کافه با ساختار پیشنهادی (Cafe Structure)',
    version: '1.0.0',
    businessType: 'cafe',
    description: 'قالب خام کافه با دسته‌بندی‌های مرجع بدون قیمت، بدون کاربر معاملاتی و صفر داده تجاری.',
    requiredFeatures: ['core.workspace', 'catalog.menu'],
    zeroDataVerified: true,
    activeTenantsCount: 0
  },
  {
    code: 'restaurant_suggested',
    name: 'رستوران با ساختار پیشنهادی (Restaurant Structure)',
    version: '1.0.0',
    businessType: 'restaurant',
    description: 'قالب خام رستوران با ساختار سالن و میزهای خالی، بدون سفارش یا رویداد مالی.',
    requiredFeatures: ['core.workspace', 'catalog.menu', 'floor.tables'],
    zeroDataVerified: true,
    activeTenantsCount: 0
  }
];

class TemplateService {
  listTemplates() {
    return CANONICAL_TEMPLATES.map(t => ({
      ...t,
      checksum: this.getTemplateChecksum(t.code)
    }));
  }

  getTemplate(code = 'empty') {
    const t = CANONICAL_TEMPLATES.find(x => x.code === code) || CANONICAL_TEMPLATES[0];
    return {
      ...t,
      checksum: this.getTemplateChecksum(t.code),
      ddl: CANONICAL_TENANT_DDL,
      canonicalTables: [
        'tenant_metadata',
        'tenant_branches',
        'tenant_users',
        'tenant_tables',
        'tenant_menu_items',
        'tenant_orders',
        'tenant_ledger'
      ]
    };
  }

  getCanonicalDDL(templateCode = 'empty') {
    return CANONICAL_TENANT_DDL;
  }

  getTemplateChecksum(templateCode = 'empty') {
    return crypto.createHash('sha256').update(CANONICAL_TENANT_DDL).digest('hex');
  }

  /**
   * Validates that an instantiated tenant database matches the zero-data requirement
   */
  validateZeroDataCompliance(tableCounts = {}) {
    const violations = [];
    const forbiddenRows = [
      'tenant_orders',
      'tenant_menu_items',
      'tenant_tables',
      'tenant_ledger',
      'tenant_users'
    ];

    for (const table of forbiddenRows) {
      const count = tableCounts[table] || 0;
      if (count > 0) {
        violations.push(`NON_ZERO_DATA_VIOLATION: Table '${table}' contains ${count} rows. Expected 0 in raw tenant account.`);
      }
    }

    return {
      compliant: violations.length === 0,
      violations,
      verifiedTables: Object.keys(tableCounts)
    };
  }
}

const templateServiceInstance = new TemplateService();
templateServiceInstance.TemplateService = TemplateService;
templateServiceInstance.listTemplates = templateServiceInstance.listTemplates.bind(templateServiceInstance);
templateServiceInstance.getTemplate = templateServiceInstance.getTemplate.bind(templateServiceInstance);
templateServiceInstance.getCanonicalDDL = templateServiceInstance.getCanonicalDDL.bind(templateServiceInstance);
templateServiceInstance.getTemplateChecksum = templateServiceInstance.getTemplateChecksum.bind(templateServiceInstance);
templateServiceInstance.validateZeroDataCompliance = templateServiceInstance.validateZeroDataCompliance.bind(templateServiceInstance);

module.exports = templateServiceInstance;

