'use strict';

function tenantMetadataSql() {
  return `
    CREATE TABLE IF NOT EXISTS neem_tenant_metadata (
      tenant_id TEXT PRIMARY KEY CHECK (tenant_id ~ '^[a-z][a-z0-9-]{1,62}$'),
      tenant_slug TEXT NOT NULL UNIQUE CHECK (tenant_slug ~ '^[a-z][a-z0-9-]{1,62}$'),
      display_name TEXT NOT NULL,
      canonical_domain TEXT NOT NULL,
      cell_id TEXT NOT NULL,
      storage_mode TEXT NOT NULL DEFAULT 'database-per-tenant',
      schema_version INTEGER NOT NULL DEFAULT 1,
      app_release TEXT NOT NULL DEFAULT 'local',
      provisioned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS neem_tenant_metadata_cell_idx ON neem_tenant_metadata(cell_id);
  `;
}

async function ensureTenantMetadata(pool, config, { required = false } = {}) {
  if (!config?.tenantId) {
    const error = new Error('NEEM_TENANT_ID is required for tenant metadata.');
    error.code = 'tenant_id_required';
    if (required) throw error;
    return { available: false, reason: error.code };
  }

  await pool.query(tenantMetadataSql());
  await pool.query(
    `INSERT INTO neem_tenant_metadata
      (tenant_id, tenant_slug, display_name, canonical_domain, cell_id, app_release)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [config.tenantId, config.tenantSlug, config.displayName, config.canonicalDomain, config.cellId, config.release],
  );

  const result = await pool.query(
    `SELECT tenant_id, tenant_slug, canonical_domain, cell_id, storage_mode, schema_version, app_release
       FROM neem_tenant_metadata WHERE tenant_id = $1`,
    [config.tenantId],
  );
  const row = result.rows?.[0];
  if (!row || row.tenant_slug !== config.tenantSlug || row.storage_mode !== 'database-per-tenant') {
    const error = new Error(`Tenant database identity mismatch for ${config.tenantId}.`);
    error.code = 'tenant_database_identity_mismatch';
    error.details = { expected: config.tenantId, actual: row || null };
    throw error;
  }
  return { available: true, metadata: row };
}

module.exports = { tenantMetadataSql, ensureTenantMetadata };
