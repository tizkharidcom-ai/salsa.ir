'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBlankTenantDb, TenantRegistry } = require('../server/salsa/tenant-registry');

test('zero-data tenant provisioning leaves unknown commercial and ownership settings unconfigured', (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'westo-tenant-zero-data-'));
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const registry = new TenantRegistry({}, path.join(temporaryDirectory, 'db.json'));

  const tenant = registry.provisionTenant('tenant-clean');
  const persisted = JSON.parse(fs.readFileSync(registry.getTenantFilePath('tenant-clean'), 'utf8'));

  assert.deepEqual(tenant.users, []);
  assert.deepEqual(tenant.settings.adminPhones, []);
  assert.equal(tenant.restaurant.phone, null);
  assert.equal(tenant.restaurant.name, null);
  assert.equal(tenant.restaurant.address, null);
  assert.deepEqual(tenant.branches, [], 'no guessed branch, branch name, or opening hours are seeded');
  assert.deepEqual(tenant.menuCategories, []);
  assert.deepEqual(tenant.menuItems, []);
  assert.equal(tenant.tenantIdentity.displayName, null);
  assert.equal(tenant.tenantIdentity.canonicalDomain, null);
  assert.equal(tenant.tenantIdentity.cellId, null);
  assert.equal(tenant.tenantIdentity.plan, null);
  assert.equal(tenant.settings.taxPercent, null);
  assert.equal(tenant.financeV2.settings.vatPercent, null);
  assert.equal(tenant.loyalty.welcomePoints, null);
  assert.equal(tenant.loyalty.enabled, null);
  assert.equal(tenant.salsaIntegration.enabled, false);
  assert.equal(tenant.neemIntegration.enabled, false);
  assert.deepEqual(persisted, tenant, 'the durable snapshot preserves the explicitly unconfigured state');
  assert.doesNotMatch(JSON.stringify(tenant), /09120000000|تهران|شعبه اصلی|Starter \(پایه\)/);

  const ownerConfigured = createBlankTenantDb('tenant-owner', {
    ownerPhone: '۰۹۱۲۳۴۵۶۷۸۹',
    ownerName: 'مدیر واقعی',
  });
  assert.deepEqual(ownerConfigured.settings.adminPhones, ['09123456789']);
  assert.equal(ownerConfigured.users.length, 1);
  assert.equal(ownerConfigured.users[0].phone, '09123456789');
  assert.equal(ownerConfigured.users[0].name, 'مدیر واقعی');
});

test('durable tenant writes fail closed when the tenant snapshot cannot be replaced', (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'westo-tenant-persist-'));
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

  // A file at the tenants-directory path forces a deterministic ENOTDIR on
  // snapshot creation without touching the repository or production data.
  fs.writeFileSync(path.join(temporaryDirectory, 'tenants'), 'not-a-directory');
  const registry = new TenantRegistry({}, path.join(temporaryDirectory, 'db.json'));
  registry.tenants.set('tenant-one', { tenantIdentity: { tenantId: 'tenant-one' } });

  assert.throws(
    () => registry.saveTenantDb('tenant-one', { requireDurable: true }),
    (error) => error.status === 503 && error.code === 'tenant_persistence_failed',
  );
});

test('durable tenant writes reject a missing in-memory tenant instead of reporting success', () => {
  const registry = new TenantRegistry({}, path.join(os.tmpdir(), 'westo-unused-tenant-db.json'));
  assert.throws(
    () => registry.saveTenantDb('tenant-missing', { requireDurable: true }),
    { code: 'tenant_persistence_target_missing', status: 503 },
  );
});

test('tenant registry never serves or persists a snapshot whose owner tenant id differs from its file scope', (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'westo-tenant-isolation-'));
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

  const tenantsDirectory = path.join(temporaryDirectory, 'tenants');
  fs.mkdirSync(tenantsDirectory, { recursive: true });
  fs.writeFileSync(path.join(tenantsDirectory, 'tenant-alpha.json'), JSON.stringify({
    tenantIdentity: { tenantId: 'tenant-beta' },
    users: [{ id: 'beta-owner', role: 'owner' }],
  }));
  const registry = new TenantRegistry({}, path.join(temporaryDirectory, 'db.json'));

  assert.equal(registry.getTenantDb('tenant-alpha'), null);
  assert.equal(registry.hasTenant('tenant-alpha'), false);
  assert.equal(registry.getTenantDb('tenant-beta'), null, 'another tenant file is never used as a fallback');
  assert.equal(registry.listTenants().some((tenant) => tenant.slug === 'tenant-alpha'), false);
  assert.throws(
    () => registry.provisionTenant('tenant-alpha'),
    { code: 'tenant_registry_entry_invalid', status: 503 },
    'provisioning does not silently overwrite an unreadable or cross-tenant snapshot',
  );
});

test('tenant registry rejects non-canonical ids before constructing a storage path', (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'westo-tenant-path-'));
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const registry = new TenantRegistry({}, path.join(temporaryDirectory, 'db.json'));

  assert.throws(() => registry.getTenantFilePath('../tenant-beta'), { code: 'tenant_id_invalid', status: 400 });
  assert.throws(() => registry.saveTenantDb('../tenant-beta'), { code: 'tenant_id_invalid', status: 400 });
  assert.equal(fs.existsSync(path.join(temporaryDirectory, 'tenant-beta.json')), false);
});

test('tenant provisioning fails closed and removes its in-memory entry when durable write fails', (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'westo-tenant-provision-'));
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(temporaryDirectory, 'tenants'), 'not-a-directory');
  const registry = new TenantRegistry({}, path.join(temporaryDirectory, 'db.json'));

  assert.throws(
    () => registry.provisionTenant('tenant-alpha'),
    (error) => error.status === 503 && error.code === 'tenant_persistence_failed',
  );
  assert.equal(registry.tenants.has('tenant-alpha'), false, 'a failed durable provision is not left available in memory');
});
