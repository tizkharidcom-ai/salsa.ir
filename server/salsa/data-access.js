'use strict';

const { Pool } = require('pg');
const {
  assertTenantContext,
  createTenantContext,
  normalizeDatabaseName,
  requireTenantContext,
  requireTenantId,
} = require('./tenant-context');

function databaseUrlFor(baseUrl, databaseName) {
  if (!baseUrl) throw new Error('TENANT_DATABASE_UNAVAILABLE: tenant database base URL is not configured.');
  const url = new URL(baseUrl);
  const cleanDatabaseName = String(databaseName || '').trim().toLowerCase();
  const tenantId = cleanDatabaseName.replace(/^tenant_/, '').replace(/_test$/, '').replace(/_/g, '-');
  url.pathname = `/${normalizeDatabaseName(cleanDatabaseName, tenantId)}`;
  return url.toString();
}

function defaultPoolFactory(connectionString, options = {}) {
  return new Pool({
    connectionString,
    max: Number(options.max || process.env.NEEM_TENANT_POOL_MAX || 10),
    idleTimeoutMillis: Number(options.idleTimeoutMillis || process.env.NEEM_TENANT_POOL_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(options.connectionTimeoutMillis || process.env.NEEM_TENANT_POOL_CONNECT_TIMEOUT_MS || 5000),
    allowExitOnIdle: true,
  });
}

function rowsFromControlQuery(result, source) {
  if (!result || !Array.isArray(result.rows)) {
    throw new Error(`CONTROL_DATA_ACCESS_INVALID_RESPONSE: ${source} lookup did not return rows.`);
  }
  return result.rows;
}

function tenantRoutingIdentity(registration) {
  const tenantId = requireTenantId(registration?.tenant_id || registration?.tenantId);
  const rawDatabaseName = registration?.database_name || registration?.databaseName;
  if (typeof rawDatabaseName !== 'string' || !rawDatabaseName.trim()) {
    throw new Error(`TENANT_REGISTRATION_INVALID: tenant '${tenantId}' has no database binding.`);
  }
  const databaseName = normalizeDatabaseName(rawDatabaseName, tenantId);
  const databaseProvider = String(registration.database_provider || registration.databaseProvider || 'postgres')
    .trim()
    .toLowerCase();
  if (!databaseProvider) {
    throw new Error(`TENANT_REGISTRATION_INVALID: tenant '${tenantId}' has no database provider.`);
  }
  const rawCellId = registration.cell_id ?? registration.cellId ?? null;
  return {
    tenantId,
    databaseName,
    databaseProvider,
    cellId: rawCellId == null ? null : String(rawCellId).trim() || null,
  };
}

function selectUniqueTenantRegistration(host, candidates) {
  if (candidates.length === 0) return null;

  const routingByTenant = new Map();
  for (const registration of candidates) {
    const identity = tenantRoutingIdentity(registration);
    const routing = JSON.stringify({
      databaseName: identity.databaseName,
      databaseProvider: identity.databaseProvider,
      cellId: identity.cellId,
    });
    const previous = routingByTenant.get(identity.tenantId);
    if (previous && previous !== routing) {
      throw new Error(`TENANT_REGISTRATION_AMBIGUOUS: host '${host}' resolves tenant '${identity.tenantId}' to conflicting data bindings.`);
    }
    routingByTenant.set(identity.tenantId, routing);
  }

  if (routingByTenant.size > 1) {
    throw new Error(`TENANT_HOST_AMBIGUOUS: host '${host}' is registered to multiple tenants.`);
  }

  // Keep the existing source precedence (infrastructure, verified alias,
  // canonical domain, platform subdomain), but only after every source agrees.
  return candidates[0];
}

class ControlDataAccess {
  constructor({ pool, query = null } = {}) {
    if (!pool && typeof query !== 'function') {
      throw new Error('CONTROL_DATA_ACCESS_INVALID: a control database pool or query function is required.');
    }
    this.pool = pool || null;
    this.queryFn = query;
  }

  async query(text, params = []) {
    if (this.queryFn) return this.queryFn(text, params);
    return this.pool.query(text, params);
  }

  async findTenantByHost(hostname) {
    const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
    if (!host) return null;

    let subdomainSlug = null;
    for (const base of ['salsa.ir', 'neem.ir', 'salsa.test', 'neem.test']) {
      if (host.endsWith(`.${base}`)) {
        const slug = host.slice(0, -(base.length + 1));
        const reserved = new Set(['admin', 'api', 'control', 'status', 'www', 'mail', 'cdn', 'static']);
        if (!reserved.has(slug) && /^[a-z0-9_-]+$/.test(slug)) subdomainSlug = slug;
        break;
      }
    }

    // Resolve every supported hostname source in one statement so they share
    // a single database snapshot. Returning one row from any source must not
    // hide a conflicting registration in another source.
    const lookup = await this.query(`
      SELECT
        d.tenant_id,
        t.display_name,
        t.status,
        t.cell_id,
        t.database_name,
        t.database_provider,
        t.canonical_domain,
        t.metadata,
        d.domain_name,
        d.domain_kind,
        d.tls_status,
        1 AS source_priority
      FROM neem_infrastructure_domains d
      JOIN neem_tenants t ON t.tenant_id = d.tenant_id
      WHERE d.domain_name = $1
        AND d.is_active = true
        AND d.dns_verification_status = 'verified'
        AND t.status = 'active'
      UNION ALL
      SELECT
        d.tenant_id,
        t.display_name,
        t.status,
        t.cell_id,
        t.database_name,
        t.database_provider,
        t.canonical_domain,
        t.metadata,
        d.domain AS domain_name,
        d.domain_kind,
        NULL::text AS tls_status,
        2 AS source_priority
      FROM neem_domains d
      JOIN neem_tenants t ON t.tenant_id = d.tenant_id
      WHERE d.domain = $1
        AND d.verification_status = 'verified'
        AND t.status = 'active'
      UNION ALL
      SELECT
        tenant_id,
        display_name,
        status,
        cell_id,
        database_name,
        database_provider,
        canonical_domain,
        metadata,
        canonical_domain AS domain_name,
        'canonical_domain' AS domain_kind,
        NULL::text AS tls_status,
        3 AS source_priority
      FROM neem_tenants
      WHERE LOWER(canonical_domain) = $1
        AND status = 'active'
      UNION ALL
      SELECT
        tenant_id,
        display_name,
        status,
        cell_id,
        database_name,
        database_provider,
        canonical_domain,
        metadata,
        $1 AS domain_name,
        'platform_subdomain' AS domain_kind,
        NULL::text AS tls_status,
        4 AS source_priority
      FROM neem_tenants
      WHERE $2::text IS NOT NULL
        AND (tenant_id = $2 OR LOWER(canonical_domain) = $1)
        AND status = 'active'
      ORDER BY source_priority
    `, [host, subdomainSlug]);

    return selectUniqueTenantRegistration(
      host,
      rowsFromControlQuery(lookup, 'tenant host')
    );
  }

  async findTenantById(tenantId) {
    const canonical = requireTenantId(tenantId);
    const result = await this.query(`
      SELECT tenant_id, display_name, status, cell_id, database_name,
             database_provider, canonical_domain, metadata
      FROM neem_tenants
      WHERE tenant_id = $1
      LIMIT 1
    `, [canonical]);
    return result.rows?.[0] || null;
  }
}

class TenantDataAccess {
  constructor({ manager, context } = {}) {
    if (!manager) throw new Error('TENANT_DATA_ACCESS_INVALID: connection manager is required.');
    this.manager = manager;
    this.context = createTenantContext(context || {});
  }

  get tenantId() {
    return this.context.tenantId;
  }

  async query(text, params = []) {
    assertTenantContext(requireTenantContext(), this.tenantId);
    const pool = await this.manager.getPoolForContext(this.context);
    return pool.query(text, params);
  }

  async transaction(callback) {
    assertTenantContext(requireTenantContext(), this.tenantId);
    const pool = await this.manager.getPoolForContext(this.context);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client, this.context);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

class TenantConnectionManager {
  constructor({
    baseUrl = process.env.NEEM_TENANT_DB_POSTGRES_URL,
    poolFactory = defaultPoolFactory,
    maxPools = Number(process.env.NEEM_TENANT_POOL_CACHE_MAX || 100),
    logger = console,
  } = {}) {
    this.baseUrl = baseUrl || null;
    this.poolFactory = poolFactory;
    this.maxPools = Number.isFinite(maxPools) && maxPools > 0 ? maxPools : 100;
    this.logger = logger;
    this.pools = new Map();
    this.inFlight = new Map();
  }

  async getPoolForContext(context) {
    const safeContext = createTenantContext(context || {});
    const current = requireTenantContext();
    assertTenantContext(current, safeContext.tenantId);
    if (safeContext.status !== 'active') {
      throw new Error(`TENANT_CONTEXT_INACTIVE: tenant '${safeContext.tenantId}' is not active.`);
    }
    if (process.env.NODE_ENV === 'production' && safeContext.databaseName.endsWith('_test')) {
      throw new Error(`TENANT_DATABASE_TEST_BINDING_FORBIDDEN: production cannot use tenant test database '${safeContext.databaseName}'.`);
    }
    if (safeContext.databaseProvider !== 'postgres') {
      throw new Error(`TENANT_DATABASE_UNSUPPORTED: provider '${safeContext.databaseProvider}' is not supported by this manager.`);
    }
    if (!this.baseUrl) {
      throw new Error('TENANT_DATABASE_UNAVAILABLE: NEEM_TENANT_DB_POSTGRES_URL is not configured.');
    }

    const existing = this.pools.get(safeContext.tenantId);
    if (existing) {
      if (existing.databaseName !== safeContext.databaseName
        || existing.databaseProvider !== safeContext.databaseProvider) {
        throw new Error(`TENANT_DATABASE_BINDING_CHANGED: tenant '${safeContext.tenantId}' has a cached pool for a different database binding; invalidate it before rerouting.`);
      }
      return existing.pool;
    }
    const pending = this.inFlight.get(safeContext.tenantId);
    if (pending) {
      if (pending.databaseName !== safeContext.databaseName
        || pending.databaseProvider !== safeContext.databaseProvider) {
        throw new Error(`TENANT_DATABASE_BINDING_CHANGED: tenant '${safeContext.tenantId}' is already opening a pool for a different database binding.`);
      }
      return pending.promise;
    }

    const opening = {
      databaseName: safeContext.databaseName,
      databaseProvider: safeContext.databaseProvider,
      promise: null,
    };
    opening.promise = Promise.resolve().then(async () => {
      if (this.pools.size >= this.maxPools) {
        throw new Error('TENANT_POOL_CACHE_EXHAUSTED: tenant pool cache limit reached.');
      }
      const connectionString = databaseUrlFor(this.baseUrl, safeContext.databaseName);
      const pool = this.poolFactory(connectionString, { tenantId: safeContext.tenantId });
      pool.on?.('error', (error) => {
        this.logger.error?.(`[tenant-pool:${safeContext.tenantId}] idle client error:`, error.message);
      });
      this.pools.set(safeContext.tenantId, {
        pool,
        databaseName: safeContext.databaseName,
        databaseProvider: safeContext.databaseProvider,
        createdAt: new Date().toISOString(),
      });
      return pool;
    }).finally(() => {
      if (this.inFlight.get(safeContext.tenantId) === opening) {
        this.inFlight.delete(safeContext.tenantId);
      }
    });
    this.inFlight.set(safeContext.tenantId, opening);
    return opening.promise;
  }

  forContext(context) {
    return new TenantDataAccess({ manager: this, context });
  }

  invalidate(tenantId) {
    const canonical = requireTenantId(tenantId);
    const entry = this.pools.get(canonical);
    if (!entry) return false;
    this.pools.delete(canonical);
    void entry.pool.end().catch((error) => {
      this.logger.warn?.(`[tenant-pool:${canonical}] close failed:`, error.message);
    });
    return true;
  }

  metrics() {
    return {
      poolCount: this.pools.size,
      tenantIds: [...this.pools.keys()],
      maxPools: this.maxPools,
    };
  }

  async close() {
    const entries = [...this.pools.values()];
    this.pools.clear();
    await Promise.all(entries.map((entry) => entry.pool.end().catch(() => {})));
  }
}

function createTenantDataAccess({ manager, context } = {}) {
  return new TenantDataAccess({ manager, context });
}

module.exports = {
  databaseUrlFor,
  ControlDataAccess,
  TenantDataAccess,
  TenantConnectionManager,
  createTenantDataAccess,
};
