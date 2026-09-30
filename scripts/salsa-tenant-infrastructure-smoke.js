'use strict';

/*
 * Disposable infrastructure smoke: creates/reuses exactly one empty tenant
 * database, resolves it from a registered host, and proves the selected
 * PostgreSQL database is not the existing WESTO database. It does not run
 * application migrations and does not import menu, order, or customer data.
 */

const { Client } = require('pg');
const { TenantResolver } = require('../server/salsa/tenant-resolver');
const { TenantConnectionManager } = require('../server/salsa/data-access');
const { runWithTenantContext } = require('../server/salsa/tenant-context');

const tenantId = String(process.env.NEEM_TENANT_INFRA_SMOKE_ID || 'tenant-infra-smoke').trim().toLowerCase();
const databaseName = `tenant_${tenantId.replace(/-/g, '_')}`;
const domain = `${tenantId}.localhost`;
const baseUrl = process.env.NEEM_TENANT_DB_TEST_BASE_URL
  || process.env.NEEM_TENANT_DB_POSTGRES_URL
  || process.env.DATABASE_URL;

function databaseUrlFor(rawUrl, database) {
  const url = new URL(rawUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

function quoteIdentifier(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

async function ensureDatabase() {
  if (!baseUrl) throw new Error('NEEM_TENANT_DB_TEST_BASE_URL or DATABASE_URL is required.');
  const adminUrl = process.env.NEEM_TENANT_DB_TEST_ADMIN_URL
    || process.env.NEEM_TENANT_DB_ADMIN_URL
    || databaseUrlFor(baseUrl, 'postgres');
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
    if (!exists.rowCount) await client.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  } finally {
    await client.end();
  }
}

async function main() {
  await ensureDatabase();
  const registration = {
    tenant_id: tenantId,
    status: 'active',
    cell_id: 'cell-infra-smoke',
    database_name: databaseName,
    database_provider: 'postgres',
    canonical_domain: domain,
    domain_name: domain,
    domain_kind: 'neem_subdomain',
  };
  const resolver = new TenantResolver({
    controlDataAccess: {
      async findTenantByHost(host) { return host === domain ? registration : null; },
      async findTenantById(id) { return id === tenantId ? registration : null; },
    },
    baseDomain: 'neem.ir',
  });
  const context = await resolver.resolveHost(domain);
  if (!context) throw new Error('SMOKE_FAILED: registered test domain did not resolve.');

  const manager = new TenantConnectionManager({ baseUrl });
  try {
    const data = manager.forContext(context);
    const result = await runWithTenantContext(context, () => data.query('SELECT current_database()'));
    const selectedDatabase = result.rows[0]?.current_database;
    const tableResult = await runWithTenantContext(context, () => data.query(`
      SELECT count(*)::int AS user_tables
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    `));
    const applicationTables = tableResult.rows[0]?.user_tables || 0;
    const baseDatabase = new URL(baseUrl).pathname.replace(/^\/+/, '');
    if (selectedDatabase !== databaseName) {
      throw new Error(`SMOKE_FAILED: selected database '${selectedDatabase}' is not '${databaseName}'.`);
    }
    if (selectedDatabase === baseDatabase) {
      throw new Error('SMOKE_FAILED: tenant smoke resolved to the WESTO database.');
    }
    if (applicationTables !== 0) {
      throw new Error(`SMOKE_FAILED: test tenant database is not empty; found ${applicationTables} application tables.`);
    }
    console.log(JSON.stringify({
      ok: true,
      tenantId,
      domain,
      database: selectedDatabase,
      baseDatabase,
      dataImported: false,
      migrationsRun: false,
      applicationTables,
      poolCount: manager.metrics().poolCount,
    }, null, 2));
  } finally {
    await manager.close();
  }
}

main().catch((error) => {
  console.error(`[neem-tenant-infrastructure-smoke] ${error.message}`);
  process.exitCode = 1;
});
