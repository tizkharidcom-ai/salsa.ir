'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');
const { legacyTenantPersistenceError } = require('../server/salsa/tenant-persistence-policy');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

test('production legacy JSON tenant state is blocked while local development and WESTO state remain available', () => {
  assert.equal(legacyTenantPersistenceError({ nodeEnv: 'development', tenantId: 'tenant-one' }), null);
  assert.equal(legacyTenantPersistenceError({ nodeEnv: 'production', tenantId: 'westo' }), null);
  assert.deepEqual(
    ((error) => ({ code: error.code, status: error.status }))(legacyTenantPersistenceError({ nodeEnv: 'production', tenantId: 'tenant-one' })),
    { code: 'tenant_postgres_state_adapter_required', status: 503 },
  );
});

test('production tenant persistence fails closed when the tenant identity is missing or blank', () => {
  for (const tenantId of [undefined, null, '', '   ']) {
    const error = legacyTenantPersistenceError({ nodeEnv: 'production', tenantId });
    assert.equal(error?.code, 'tenant_identity_required');
    assert.equal(error?.status, 503);
  }
  assert.equal(legacyTenantPersistenceError({ nodeEnv: 'development', tenantId: undefined }), null);
});

test('tenant request boundary and every direct JSON tenant write gate enforce the persistence hold first', () => {
  const saveBranchStart = serverSource.indexOf("if (currentTenantId !== 'westo') {");
  const saveBranchEnd = serverSource.indexOf('const waiter = new Promise', saveBranchStart);
  const saveBranch = serverSource.slice(saveBranchStart, saveBranchEnd);
  assert.ok(saveBranch.indexOf('legacyTenantPersistenceError') < saveBranch.indexOf('tenantRegistry.saveTenantDb'));

  const middlewareStart = serverSource.indexOf('app.use((req, res, next) => {\n  if (!TENANT_INFRASTRUCTURE_ENABLED)');
  const middlewareEnd = serverSource.indexOf('// ── SALSA Tenant Policy Enforcement Layer', middlewareStart);
  const middleware = serverSource.slice(middlewareStart, middlewareEnd);
  assert.ok(middleware.indexOf('legacyTenantPersistenceError({ tenantId })') < middleware.indexOf('tenantRegistry.getTenantDb(tenantId)'));
  const tenantContextPersistenceGuard = middleware.indexOf('legacyTenantPersistenceError({ tenantId: context?.tenantId })');
  const tenantContextLookup = middleware.indexOf('tenantRegistry.getTenantDb(context.tenantId)');
  assert.ok(tenantContextPersistenceGuard >= 0 && tenantContextLookup > tenantContextPersistenceGuard,
    'production rejects a missing tenant identity before getTenantDb can apply its WESTO default');
  assert.ok(middleware.indexOf('legacyTenantPersistenceError({ tenantId: context?.tenantId })') < middleware.indexOf('tenantRegistry.provisionTenant('));

  const featureToggleStart = serverSource.indexOf("if (req.path === '/api/admin/features/toggle' && req.method === 'POST')");
  const provisionStart = serverSource.indexOf("if (req.path === '/api/admin/tenants/provision' && req.method === 'POST')");
  assert.ok(serverSource.indexOf('legacyTenantPersistenceError({ tenantId: targetTenant })', featureToggleStart) < serverSource.indexOf('tenantRegistry.saveTenantDb(targetTenant)', featureToggleStart));
  assert.ok(serverSource.indexOf('legacyTenantPersistenceError({ tenantId })', provisionStart) < serverSource.indexOf('tenantRegistry.createTenant(tenantId', provisionStart));
});
