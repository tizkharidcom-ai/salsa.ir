'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveAuditTenantId } = require('../server/audit-tenant-scope');

const source = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');

test('audit tenant attribution prefers the verified request tenant and async context over static host configuration', () => {
  assert.equal(resolveAuditTenantId({ tenantId: 'restaurant-a' }, 'restaurant-b', 'fixed-tenant'), 'restaurant-a');
  assert.equal(resolveAuditTenantId(null, 'restaurant-b', 'fixed-tenant'), 'restaurant-b');
  assert.equal(resolveAuditTenantId({ tenantContext: { tenantId: 'restaurant-c' } }, null, 'fixed-tenant'), 'restaurant-c');
  assert.equal(resolveAuditTenantId({ tenant: { tenantId: 'restaurant-d' } }, null, 'fixed-tenant'), 'restaurant-d');
  assert.equal(resolveAuditTenantId(null, null, 'fixed-tenant'), 'fixed-tenant');
});

test('audit records in request handlers use tenant-scoped identity instead of only the process tenant', () => {
  assert.match(source, /entry\.tenantId = resolveAuditTenantId\(req, tenantStorage\.getStore\(\)\?\.tenantId, TENANT_CONFIG\.tenantId\)/);
});
