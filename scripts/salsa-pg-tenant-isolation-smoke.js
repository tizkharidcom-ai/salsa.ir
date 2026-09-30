'use strict';

/**
 * Disposable PostgreSQL smoke gate for D6.
 *
 * This intentionally mutates the supplied control-plane database and creates
 * two tenant databases. It therefore requires an explicit confirmation and
 * should only be run against a disposable/staging fixture. It never uses the
 * WESTO Finance database implicitly and never runs without control, data-plane
 * and lifecycle-plane URLs.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const CONFIRMATION = 'RUN_NEEM_TENANT_PG_ISOLATION_SMOKE';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function createClient(connectionString, databaseName = null) {
  const { Client } = require('pg');
  const url = new URL(connectionString);
  if (databaseName) url.pathname = `/${databaseName}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  return client;
}

async function main() {
  if (process.env.NEEM_TENANT_PG_SMOKE_CONFIRM !== CONFIRMATION) {
    throw new Error(`Refusing to mutate PostgreSQL without NEEM_TENANT_PG_SMOKE_CONFIRM=${CONFIRMATION}.`);
  }

  const controlUrl = requireEnv('NEEM_CONTROL_DATABASE_URL');
  const tenantClusterUrl = requireEnv('NEEM_TENANT_DB_POSTGRES_URL');
  const tenantAdminUrl = requireEnv('NEEM_TENANT_DB_ADMIN_URL');
  // Development is deliberate: it selects the persistent Pool adapter while
  // avoiding production-only secret validation in this disposable harness.
  process.env.NODE_ENV = 'development';

  const { getDatabase } = require('../server/salsa/control-plane/db/database');
  const runner = require('../server/salsa/control-plane/tenant/provisioning-runner');
  const storageService = require('../server/salsa/control-plane/tenant/storage-service');
  const cacheSessionService = require('../server/salsa/control-plane/tenant/cache-session-service');
  const { PostgresTenantDatabaseAdapter } = require('../server/salsa/control-plane/tenant/tenant-database-adapter');

  const db = getDatabase();
  const adapter = new PostgresTenantDatabaseAdapter({
    connectionUrl: tenantClusterUrl,
    adminConnectionUrl: tenantAdminUrl
  });
  const suffix = `${Date.now()}-${process.pid}`.replace(/[^0-9-]/g, '');
  const tenantA = `iso-a-${suffix}`;
  const tenantB = `iso-b-${suffix}`;
  const tenantIds = [tenantA, tenantB];
  const handles = [];
  const checks = [];

  const recordCheck = (name, passed, details = null) => {
    checks.push({ name, passed, details: passed ? 'ok' : details });
    assert.equal(passed, true, name);
  };

  try {
    const [resultA, resultB] = await Promise.all([
      runner.startProvisioningJob({
        tenantId: tenantA,
        displayName: 'D6 PostgreSQL Isolation A',
        cellId: 'cell-teh-01',
        planCode: 'starter',
        canonicalDomain: `${tenantA}.smoke.neem.ir`,
        ownerEmail: `${tenantA}@smoke.neem.ir`,
        idempotencyKey: `d6-pg-isolation-${tenantA}`,
        initiatedBy: 'd6_pg_isolation_smoke'
      }),
      runner.startProvisioningJob({
        tenantId: tenantB,
        displayName: 'D6 PostgreSQL Isolation B',
        cellId: 'cell-teh-02',
        planCode: 'starter',
        canonicalDomain: `${tenantB}.smoke.neem.ir`,
        ownerEmail: `${tenantB}@smoke.neem.ir`,
        idempotencyKey: `d6-pg-isolation-${tenantB}`,
        initiatedBy: 'd6_pg_isolation_smoke'
      })
    ]);

    for (const result of [resultA, resultB]) {
      recordCheck(`${result.tenantId}: provisioning completed`, result.status === 'completed', result);
      recordCheck(`${result.tenantId}: postgres resource allocated`, result.resourceHandle?.provider === 'postgres', result.resourceHandle);
      handles.push(result.resourceHandle);
    }

    const readiness = await Promise.all(tenantIds.map((tenantId) => runner.inspectTenantReadiness(tenantId)));
    for (const item of readiness) {
      recordCheck(`${item.tenantId}: readiness gates passed`, item.ready === true, item);
      recordCheck(`${item.tenantId}: zero-data before write`, item.database.zeroDataCompliant === true, item.database);
      recordCheck(`${item.tenantId}: schema checksum verified`, item.checks.schema.checksumVerified === true, item.checks.schema);
    }

    const clients = await Promise.all(handles.map((handle) => createClient(tenantClusterUrl, handle.databaseName)));
    try {
      await clients[0].query(
        `INSERT INTO tenant_orders (id, order_number, status, total_amount_cents) VALUES ($1, $2, $3, $4)`,
        [`order_${tenantA}`, `A-${suffix}`, 'paid', 111]
      );
      await clients[1].query(
        `INSERT INTO tenant_orders (id, order_number, status, total_amount_cents) VALUES ($1, $2, $3, $4)`,
        [`order_${tenantB}`, `B-${suffix}`, 'paid', 222]
      );

      const [rowsA, rowsB] = await Promise.all([
        clients[0].query('SELECT id, total_amount_cents FROM tenant_orders ORDER BY id'),
        clients[1].query('SELECT id, total_amount_cents FROM tenant_orders ORDER BY id')
      ]);
      recordCheck('tenant A reads only tenant A sentinel', rowsA.rows.length === 1 && rowsA.rows[0].id === `order_${tenantA}`, rowsA.rows);
      recordCheck('tenant B reads only tenant B sentinel', rowsB.rows.length === 1 && rowsB.rows[0].id === `order_${tenantB}`, rowsB.rows);
      recordCheck('tenant A cannot observe tenant B row', !rowsA.rows.some((row) => row.id === `order_${tenantB}`), rowsA.rows);
      recordCheck('tenant B cannot observe tenant A row', !rowsB.rows.some((row) => row.id === `order_${tenantA}`), rowsB.rows);

      const countBeforeCleanup = await Promise.all(clients.map((client) => client.query('SELECT count(*)::int AS count FROM tenant_orders')));
      recordCheck('each tenant contains exactly one isolated row', countBeforeCleanup.every((result) => result.rows[0].count === 1), countBeforeCleanup.map((result) => result.rows[0].count));
    } finally {
      await Promise.all(clients.map(async (client) => {
        await client.query('DELETE FROM tenant_orders');
        await client.end();
      }));
    }

    const [zeroA, zeroB] = await Promise.all(handles.map((handle) => adapter.verifyZeroData(handle)));
    recordCheck('tenant A returns to zero-data after sentinel cleanup', zeroA.compliant === true, zeroA);
    recordCheck('tenant B returns to zero-data after sentinel cleanup', zeroB.compliant === true, zeroB);

    await storageService.putFile(tenantA, 'isolation.txt', 'tenant-a');
    await storageService.putFile(tenantB, 'isolation.txt', 'tenant-b');
    recordCheck('storage A is tenant-scoped', (await storageService.getFile(tenantA, 'isolation.txt')).toString() === 'tenant-a');
    recordCheck('storage B is tenant-scoped', (await storageService.getFile(tenantB, 'isolation.txt')).toString() === 'tenant-b');
    cacheSessionService.setCache(tenantA, 'isolation', 'tenant-a');
    cacheSessionService.setCache(tenantB, 'isolation', 'tenant-b');
    recordCheck('cache A is tenant-scoped', cacheSessionService.getCache(tenantA, 'isolation') === 'tenant-a');
    recordCheck('cache B is tenant-scoped', cacheSessionService.getCache(tenantB, 'isolation') === 'tenant-b');

    const registry = await db.query(
      `SELECT tenant_id, status, database_provider FROM neem_tenants WHERE tenant_id = ANY($1::text[]) ORDER BY tenant_id`,
      [tenantIds]
    );
    recordCheck('control-plane registry contains two active postgres tenants', registry.rows.length === 2 && registry.rows.every((row) => row.status === 'active' && row.database_provider === 'postgres'), registry.rows);

    console.log(JSON.stringify({
      ok: true,
      tenantIds,
      databaseNames: handles.map((handle) => handle.databaseName),
      checks,
      note: 'Sentinel rows were deleted before completion; drop the two generated tenant databases and control-plane rows when the disposable cluster is discarded.'
    }, null, 2));
  } finally {
    // Remove only the exact files created by this run. Database cleanup is
    // intentionally left to the disposable-cluster lifecycle to avoid
    // pretending a shared staging database is safe to mutate automatically.
    await Promise.all(tenantIds.map((tenantId) => fs.rm(path.resolve(process.cwd(), 'storage/tenants', tenantId), { recursive: true, force: true })));
    await db.end?.().catch?.(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
