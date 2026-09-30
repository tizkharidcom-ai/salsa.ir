'use strict';

/*
 * Real PostgreSQL boundary smoke. The caller owns the disposable PostgreSQL
 * container; this script creates exactly one control database and exactly one
 * empty tenant database inside it. It creates only the two tiny registry
 * tables needed by the resolver, never runs application migrations, and never
 * imports restaurant data.
 */

const { Pool, Client } = require('pg');
const { ControlDataAccess, TenantConnectionManager } = require('../server/salsa/data-access');
const { TenantResolver } = require('../server/salsa/tenant-resolver');
const { runWithTenantContext } = require('../server/salsa/tenant-context');

const tenantId = String(process.env.NEEM_INFRA_SMOKE_TENANT_ID || 'westo-infra-smoke').trim().toLowerCase();
const controlDatabase = process.env.NEEM_INFRA_SMOKE_CONTROL_DATABASE || 'neem_control_infra_smoke';
const tenantDatabase = process.env.NEEM_INFRA_SMOKE_TENANT_DATABASE || 'tenant_westo_infra_smoke';
const domain = process.env.NEEM_INFRA_SMOKE_DOMAIN || `${tenantId}.neem.test`;
const adminUrl = process.env.NEEM_INFRA_SMOKE_ADMIN_URL;
const controlUrl = process.env.NEEM_INFRA_SMOKE_CONTROL_URL;
const tenantBaseUrl = process.env.NEEM_INFRA_SMOKE_TENANT_BASE_URL;

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error(`Invalid smoke database name '${value}'.`);
  return `"${value}"`;
}

async function ensureDatabase(name) {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!result.rowCount) await client.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  if (!adminUrl || !controlUrl || !tenantBaseUrl) {
    throw new Error('NEEM_INFRA_SMOKE_ADMIN_URL, NEEM_INFRA_SMOKE_CONTROL_URL and NEEM_INFRA_SMOKE_TENANT_BASE_URL are required.');
  }

  await ensureDatabase(controlDatabase);
  await ensureDatabase(tenantDatabase);

  const controlPool = new Pool({ connectionString: controlUrl, max: 2 });
  const tenantManager = new TenantConnectionManager({ baseUrl: tenantBaseUrl, maxPools: 2 });
  try {
    // Minimal test registry only. This is a fixture, not a production
    // migration, and contains no PII, menu, order, or customer records.
    await controlPool.query(`
      CREATE TABLE IF NOT EXISTS neem_tenants (
        tenant_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL,
        cell_id TEXT NOT NULL,
        database_name TEXT NOT NULL,
        database_provider TEXT NOT NULL,
        canonical_domain TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS neem_infrastructure_domains (
        domain_name TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES neem_tenants(tenant_id),
        domain_kind TEXT NOT NULL,
        dns_verification_status TEXT NOT NULL,
        tls_status TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true
      );
    `);
    await controlPool.query(`
      INSERT INTO neem_tenants
        (tenant_id, display_name, status, cell_id, database_name, database_provider, canonical_domain)
      VALUES ($1, 'وستو - تست زیرساخت', 'active', 'cell-infra-smoke', $2, 'postgres', $3)
      ON CONFLICT (tenant_id) DO UPDATE SET
        status = EXCLUDED.status,
        database_name = EXCLUDED.database_name,
        canonical_domain = EXCLUDED.canonical_domain
    `, [tenantId, tenantDatabase, domain]);
    await controlPool.query(`
      INSERT INTO neem_infrastructure_domains
        (domain_name, tenant_id, domain_kind, dns_verification_status, tls_status, is_active)
      VALUES ($1, $2, 'neem_subdomain', 'verified', 'issued', true)
      ON CONFLICT (domain_name) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        dns_verification_status = EXCLUDED.dns_verification_status,
        tls_status = EXCLUDED.tls_status,
        is_active = EXCLUDED.is_active
    `, [domain, tenantId]);

    const controlDatabaseResult = await controlPool.query('SELECT current_database() AS database_name');
    const controlDataAccess = new ControlDataAccess({ pool: controlPool });
    const resolver = new TenantResolver({
      controlDataAccess,
      baseDomain: 'neem.test',
      allowLocalDevelopment: false,
    });
    const context = await resolver.resolveHost(domain);
    if (!context || context.tenantId !== tenantId) {
      throw new Error('SMOKE_FAILED: Control DB domain resolver did not return the expected tenant.');
    }

    const tenantData = tenantManager.forContext(context);
    const selected = await runWithTenantContext(context, async () => {
      const databaseResult = await tenantData.query('SELECT current_database() AS database_name');
      const tablesResult = await tenantData.query(`
        SELECT count(*)::int AS application_tables
        FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      `);
      return {
        database: databaseResult.rows[0]?.database_name,
        applicationTables: tablesResult.rows[0]?.application_tables || 0,
      };
    });

    if (selected.database !== tenantDatabase) {
      throw new Error(`SMOKE_FAILED: resolver selected '${selected.database}', expected '${tenantDatabase}'.`);
    }
    if (selected.database === controlDatabase) {
      throw new Error('SMOKE_FAILED: tenant connection resolved to the Control DB.');
    }
    if (selected.applicationTables !== 0) {
      throw new Error(`SMOKE_FAILED: tenant test database contains ${selected.applicationTables} application tables.`);
    }

    console.log(JSON.stringify({
      ok: true,
      resolver: 'registered exact domain -> active tenant',
      tenantId: context.tenantId,
      domain: context.domain,
      controlDatabase: controlDatabaseResult.rows[0]?.database_name,
      tenantDatabase: selected.database,
      tenantApplicationTables: selected.applicationTables,
      dataImported: false,
      applicationMigrationsRun: false,
      poolMetrics: tenantManager.metrics(),
    }, null, 2));
  } finally {
    await tenantManager.close();
    await controlPool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`[neem-tenant-infrastructure-real-smoke] ${error.message}`);
  process.exitCode = 1;
});
