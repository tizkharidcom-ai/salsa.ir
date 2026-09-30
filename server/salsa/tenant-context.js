'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const TENANT_ID_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;
const DATABASE_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const tenantStorage = new AsyncLocalStorage();

function normalizeTenantId(value) {
  const clean = String(value || '').trim().toLowerCase();
  return TENANT_ID_PATTERN.test(clean) ? clean : null;
}

function requireTenantId(value) {
  const tenantId = normalizeTenantId(value);
  if (!tenantId) {
    throw new Error('TENANT_CONTEXT_INVALID: a canonical tenant id is required.');
  }
  return tenantId;
}

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase().replace(/\.$/, '');
}

function normalizeDatabaseName(value, tenantId) {
  const canonicalTenantId = requireTenantId(tenantId);
  const expected = `tenant_${canonicalTenantId.replace(/-/g, '_')}`;
  const candidate = String(value || expected)
    .trim()
    .toLowerCase();
  if (!DATABASE_NAME_PATTERN.test(candidate)) {
    throw new Error('TENANT_CONTEXT_INVALID: tenant database name is not safe.');
  }
  if (candidate !== expected && candidate !== `${expected}_test`) {
    throw new Error('TENANT_BOUNDARY_VIOLATION: tenant database name must be derived from tenant id.');
  }
  return candidate;
}

/**
 * The only request-scoped tenant authority. The object is frozen so a route
 * cannot silently switch the data scope after host resolution.
 */
function createTenantContext({
  tenantId,
  tenantSlug = tenantId,
  domain = null,
  databaseName = null,
  databaseProvider = 'postgres',
  cellId = null,
  release = null,
  status = 'active',
  source = 'resolver',
  isPlatform = false,
} = {}) {
  const canonicalTenantId = requireTenantId(tenantId);
  const canonicalSlug = requireTenantId(tenantSlug);
  if (isPlatform) {
    throw new Error('TENANT_CONTEXT_INVALID: platform requests cannot carry a restaurant tenant context.');
  }

  return Object.freeze({
    tenantId: canonicalTenantId,
    tenantSlug: canonicalSlug,
    domain: domain ? normalizeHost(domain) : null,
    databaseName: normalizeDatabaseName(databaseName, canonicalTenantId),
    databaseProvider: String(databaseProvider || 'postgres').trim().toLowerCase(),
    cellId: cellId == null ? null : String(cellId),
    release: release == null ? null : String(release),
    status: String(status || 'active').trim().toLowerCase(),
    source: String(source || 'resolver'),
  });
}

function getTenantContext() {
  return tenantStorage.getStore() || null;
}

function requireTenantContext() {
  const context = getTenantContext();
  if (!context) {
    throw new Error('TENANT_CONTEXT_REQUIRED: tenant data access requires a resolved tenant context.');
  }
  // Rebuild even contexts installed through the exported AsyncLocalStorage.
  // A frozen object is not proof that its database binding was derived from
  // its tenant id; otherwise a caller could pair tenant A with tenant B's DB.
  return createTenantContext(context);
}

function runWithTenantContext(context, callback) {
  const safeContext = createTenantContext(context || {});
  return tenantStorage.run(safeContext, callback);
}

function assertTenantContext(context, expectedTenantId) {
  const actual = createTenantContext(context || {}).tenantId;
  const expected = requireTenantId(expectedTenantId);
  if (actual !== expected) {
    throw new Error(`TENANT_BOUNDARY_VIOLATION: context '${actual}' cannot access tenant '${expected}'.`);
  }
  return true;
}

function assertCurrentTenant(expectedTenantId) {
  return assertTenantContext(requireTenantContext(), expectedTenantId);
}

module.exports = {
  TENANT_ID_PATTERN,
  DATABASE_NAME_PATTERN,
  tenantStorage,
  normalizeTenantId,
  requireTenantId,
  normalizeHost,
  normalizeDatabaseName,
  createTenantContext,
  getTenantContext,
  requireTenantContext,
  runWithTenantContext,
  assertTenantContext,
  assertCurrentTenant,
};
