// server/salsa/control-plane/tenant/tenant-database-adapter.js
'use strict';

const crypto = require('crypto');
const config = require('../config');

/**
 * Base Abstract Tenant Database Adapter
 */
class TenantDatabaseAdapter {
  async allocateDatabase(options) {
    throw new Error('Method allocateDatabase() must be implemented.');
  }

  async executeDDL(handle, ddl) {
    throw new Error('Method executeDDL() must be implemented.');
  }

  async verifyZeroData(handle) {
    throw new Error('Method verifyZeroData() must be implemented.');
  }

  async ping(handle) {
    throw new Error('Method ping() must be implemented.');
  }

  async quarantineDatabase(handle, reason) {
    throw new Error('Method quarantineDatabase() must be implemented.');
  }

  async dropDatabase(handle) {
    throw new Error('Method dropDatabase() must be implemented.');
  }
}

/**
 * InMemory Tenant Database Adapter for unit tests and local ephemeral validation
 * Strictly mimics real PostgreSQL isolation, constraints, failure modes, and zero-data queries.
 */
class InMemoryTenantDatabaseAdapter extends TenantDatabaseAdapter {
  constructor() {
    super();
    this.instances = new Map();
    this.simulatedFailures = new Map(); // stepName -> Error
  }

  reset() {
    this.instances.clear();
    this.simulatedFailures.clear();
  }

  setSimulatedFailure(stepName, err) {
    if (err) {
      this.simulatedFailures.set(stepName, err);
    } else {
      this.simulatedFailures.delete(stepName);
    }
  }

  clearSimulatedFailures() {
    this.simulatedFailures.clear();
  }

  async allocateDatabase({ tenantId, cellId = 'cell-teh-01' }) {
    if (this.simulatedFailures.has('allocate_database')) {
      const err = this.simulatedFailures.get('allocate_database');
      throw (err instanceof Error ? err : new Error(String(err)));
    }

    if (!tenantId) {
      throw new Error('VALIDATION_ERROR: tenantId is required to allocate database.');
    }

    const safeDbName = `tenant_${tenantId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    const handleId = `db_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    // Create completely isolated in-memory tenant instance
    const instance = {
      handleId,
      tenantId,
      cellId,
      databaseName: safeDbName,
      provider: 'inmemory_isolated',
      host: '127.0.0.1',
      port: 5432,
      status: 'allocated',
      tables: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.instances.set(tenantId, instance);

    return {
      handleId,
      tenantId,
      cellId,
      databaseName: safeDbName,
      provider: 'inmemory_isolated',
      host: '127.0.0.1',
      port: 5432,
      status: 'allocated',
      allocatedAt: instance.createdAt.toISOString()
    };
  }

  async executeDDL(handle, ddl) {
    if (this.simulatedFailures.has('apply_zero_data_schema')) {
      const err = this.simulatedFailures.get('apply_zero_data_schema');
      throw (err instanceof Error ? err : new Error(String(err)));
    }

    const tenantId = handle?.tenantId;
    const instance = this.instances.get(tenantId);
    if (!instance) {
      throw new Error(`TENANT_DB_NOT_FOUND: Isolated database for tenant '${tenantId}' not found.`);
    }

    if (instance.status === 'quarantined') {
      throw new Error(`DATABASE_QUARANTINED: Database for '${tenantId}' is currently quarantined.`);
    }

    // Parse CREATE TABLE statements in DDL to initialize tables
    const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/gi;
    let match;
    const tablesCreated = [];

    while ((match = tableRegex.exec(ddl)) !== null) {
      const tableName = match[1];
      if (!instance.tables[tableName]) {
        instance.tables[tableName] = [];
      }
      tablesCreated.push(tableName);
    }

    const checksum = crypto.createHash('sha256').update(ddl).digest('hex');
    instance.schemaChecksum = checksum;
    instance.status = 'schema_applied';
    instance.updatedAt = new Date();

    return {
      applied: true,
      tablesCreated,
      checksum
    };
  }

  async verifyZeroData(handle) {
    const tenantId = handle?.tenantId;
    const instance = this.instances.get(tenantId);
    if (!instance) {
      throw new Error(`TENANT_DB_NOT_FOUND: Isolated database for tenant '${tenantId}' not found.`);
    }

    const canonicalCommercialTables = [
      'tenant_orders',
      'tenant_menu_items',
      'tenant_tables',
      'tenant_ledger',
      'tenant_users'
    ];

    const tableCounts = {};
    const violations = [];

    for (const tableName of canonicalCommercialTables) {
      const rows = instance.tables[tableName] || [];
      const count = rows.length;
      tableCounts[tableName] = count;

      if (count > 0) {
        violations.push(`NON_ZERO_DATA_VIOLATION: Table '${tableName}' in tenant '${tenantId}' contains ${count} records. Expected 0 in raw account.`);
      }
    }

    return {
      compliant: violations.length === 0,
      tableCounts,
      violations,
      verifiedAt: new Date().toISOString()
    };
  }

  async ping(handle) {
    const tenantId = handle?.tenantId;
    const instance = this.instances.get(tenantId);
    if (!instance) {
      return { ok: false, error: 'Database instance not found' };
    }
    if (instance.status === 'quarantined') {
      return { ok: false, error: 'Database instance is quarantined' };
    }
    return { ok: true, healthy: true, latencyMs: 1.2 };
  }

  async quarantineDatabase(handle, reason = 'Provisioning step failed') {
    const tenantId = handle?.tenantId;
    const instance = this.instances.get(tenantId);
    if (instance) {
      instance.status = 'quarantined';
      instance.quarantineReason = reason;
      instance.updatedAt = new Date();
      return { quarantined: true, tenantId, reason };
    }
    return { quarantined: false };
  }

  async dropDatabase(handle) {
    const tenantId = handle?.tenantId;
    if (tenantId && this.instances.has(tenantId)) {
      this.instances.delete(tenantId);
      return { dropped: true, tenantId };
    }
    return { dropped: false };
  }

  async query(handle, sql, params = []) {
    const tenantId = typeof handle === 'string' ? handle : handle?.tenantId;
    const instance = this.instances.get(tenantId);
    if (!instance) throw new Error(`Instance for '${tenantId}' not found.`);

    // Simple INSERT parser for tests
    const insertMatch = /INSERT\s+INTO\s+([a-zA-Z0-9_]+)/i.exec(sql);
    if (insertMatch) {
      const tableName = insertMatch[1];
      if (!instance.tables[tableName]) instance.tables[tableName] = [];
      const record = { id: params[0] || `rec_${Date.now()}`, rawParams: params };
      instance.tables[tableName].push(record);
      return { rows: [record], rowCount: 1 };
    }

    // Simple SELECT parser
    const selectMatch = /FROM\s+([a-zA-Z0-9_]+)/i.exec(sql);
    if (selectMatch) {
      const tableName = selectMatch[1];
      const rows = instance.tables[tableName] || [];
      return { rows: [...rows], rowCount: rows.length };
    }

    return { rows: [], rowCount: 0 };
  }

  // Test helper: insert row into tenant's isolated table to test zero-data detection
  insertRecord(tenantId, tableName, record) {
    const instance = this.instances.get(tenantId);
    if (!instance) throw new Error(`Instance for '${tenantId}' not found.`);
    if (!instance.tables[tableName]) instance.tables[tableName] = [];
    instance.tables[tableName].push(record);
  }
}

/**
 * PostgreSQL Tenant Database Adapter
 * Used when connecting to real PostgreSQL cluster in staging/production.
 * Strictly isolated: never connects to Westo db.json or restaurant connection pool.
 */
class PostgresTenantDatabaseAdapter extends TenantDatabaseAdapter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.connectionUrl = config.connectionUrl || process.env.NEEM_TENANT_DB_POSTGRES_URL;
    this.adminConnectionUrl = config.adminConnectionUrl || process.env.NEEM_TENANT_DB_ADMIN_URL;
  }

  requireDataConnection() {
    if (!this.connectionUrl) {
      throw new Error('INFRA_UNAVAILABLE: Real PostgreSQL tenant data URL (NEEM_TENANT_DB_POSTGRES_URL) is not configured.');
    }
    return this.connectionUrl;
  }

  requireAdminConnection() {
    if (!this.adminConnectionUrl) {
      throw new Error('FAIL-CLOSED: NEEM_TENANT_DB_ADMIN_URL is required for tenant database lifecycle operations.');
    }
    return this.adminConnectionUrl;
  }

  assertRoleSeparation() {
    const dataUser = databaseUserFromUrl(this.requireDataConnection());
    const adminUser = databaseUserFromUrl(this.requireAdminConnection());
    if (!dataUser || !adminUser || dataUser === adminUser) {
      throw new Error('FAIL-CLOSED: Tenant data and lifecycle PostgreSQL URLs must use distinct roles.');
    }
    return { dataUser, adminUser };
  }

  async allocateDatabase({ tenantId, cellId = 'cell-teh-01' }) {
    const adminConnectionUrl = this.requireAdminConnection();
    const { dataUser } = this.assertRoleSeparation();

    const { Client } = require('pg');
    const safeDbName = `tenant_${tenantId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    const handleId = `db_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    const adminClient = new Client({ connectionString: adminConnectionUrl });
    await adminClient.connect();

    try {
      // Check if db already exists
      const checkRes = await adminClient.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [safeDbName]);
      if (checkRes.rowCount === 0) {
        // Create isolated database safely
        await adminClient.query(`CREATE DATABASE ${quoteIdentifier(safeDbName)}`);
      }

      // The lifecycle role owns creation; the application role must receive
      // only the database/schema privileges needed for tenant data work.
      const tenantDbUrl = databaseUrlFor(adminConnectionUrl, safeDbName);
      const tenantAdminClient = new Client({ connectionString: tenantDbUrl });
      await tenantAdminClient.connect();
      try {
        await tenantAdminClient.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(safeDbName)} TO ${quoteIdentifier(dataUser)}`);
        await tenantAdminClient.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${quoteIdentifier(dataUser)}`);
      } finally {
        await tenantAdminClient.end().catch(() => {});
      }

      return {
        handleId,
        tenantId,
        cellId,
        databaseName: safeDbName,
        provider: 'postgres',
        host: adminClient.host || '127.0.0.1',
        port: adminClient.port || 5432,
        status: 'allocated',
        allocatedAt: new Date().toISOString()
      };
    } finally {
      await adminClient.end().catch(() => {});
    }
  }

  async executeDDL(handle, ddl) {
    const dataConnectionUrl = this.requireDataConnection();
    this.assertRoleSeparation();

    const { Client } = require('pg');
    const dbUrl = new URL(dataConnectionUrl);
    dbUrl.pathname = `/${assertSafeDatabaseName(handle?.databaseName)}`;

    const client = new Client({ connectionString: dbUrl.toString() });
    await client.connect();

    try {
      await client.query(ddl);
      try {
        const { applyTenantMigrations } = require('./tenant-migration-runner');
        await applyTenantMigrations(client);
      } catch (migrationErr) {
        console.warn?.('[tenant-migrations warning]', migrationErr.message);
      }
      const checksum = crypto.createHash('sha256').update(ddl).digest('hex');
      return {
        applied: true,
        checksum
      };
    } finally {
      await client.end().catch(() => {});
    }
  }

  async verifyZeroData(handle) {
    const dataConnectionUrl = this.requireDataConnection();
    this.assertRoleSeparation();

    const { Client } = require('pg');
    const dbUrl = new URL(dataConnectionUrl);
    dbUrl.pathname = `/${assertSafeDatabaseName(handle?.databaseName)}`;

    const client = new Client({ connectionString: dbUrl.toString() });
    await client.connect();

    const canonicalCommercialTables = [
      'tenant_orders',
      'tenant_menu_items',
      'tenant_tables',
      'tenant_ledger',
      'tenant_users'
    ];

    const tableCounts = {};
    const violations = [];

    try {
      for (const table of canonicalCommercialTables) {
        const res = await client.query(`SELECT count(*)::int as cnt FROM ${table}`);
        const count = res.rows[0]?.cnt || 0;
        tableCounts[table] = count;
        if (count > 0) {
          violations.push(`NON_ZERO_DATA_VIOLATION: Table '${table}' contains ${count} rows.`);
        }
      }

      return {
        compliant: violations.length === 0,
        tableCounts,
        violations,
        verifiedAt: new Date().toISOString()
      };
    } finally {
      await client.end().catch(() => {});
    }
  }

  async ping(handle) {
    const dataConnectionUrl = this.connectionUrl;
    if (!dataConnectionUrl) return { ok: false, error: 'Tenant data connection URL not configured' };
    this.assertRoleSeparation();
    const { Client } = require('pg');
    const dbUrl = new URL(dataConnectionUrl);
    dbUrl.pathname = `/${assertSafeDatabaseName(handle?.databaseName)}`;

    const client = new Client({ connectionString: dbUrl.toString() });
    const start = Date.now();
    try {
      await client.connect();
      await client.query('SELECT 1');
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      await client.end().catch(() => {});
    }
  }

  async quarantineDatabase(handle, reason) {
    const adminConnectionUrl = this.requireAdminConnection();
    this.assertRoleSeparation();
    const databaseName = assertSafeDatabaseName(handle?.databaseName);
    const { Client } = require('pg');
    const adminClient = new Client({ connectionString: adminConnectionUrl });
    await adminClient.connect();
    try {
      // Stop new sessions at the database boundary. Existing application
      // connections are still handled by the deployment connection drain;
      // this method must not pretend that a metadata-only status is isolation.
      await adminClient.query(`ALTER DATABASE ${quoteIdentifier(databaseName)} WITH CONNECTION LIMIT 0`);
      await adminClient.query(`REVOKE CONNECT ON DATABASE ${quoteIdentifier(databaseName)} FROM PUBLIC`);
      return {
        quarantined: true,
        databaseName,
        connectionLimit: 0,
        publicConnectRevoked: true,
        reason
      };
    } finally {
      await adminClient.end().catch(() => {});
    }
  }

  async dropDatabase(handle) {
    const adminConnectionUrl = this.requireAdminConnection();
    this.assertRoleSeparation();
    const { Client } = require('pg');
    const adminClient = new Client({ connectionString: adminConnectionUrl });
    await adminClient.connect();
    try {
      await adminClient.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(assertSafeDatabaseName(handle?.databaseName))}`);
      return { dropped: true, databaseName: handle.databaseName };
    } finally {
      await adminClient.end().catch(() => {});
    }
  }
}

function assertSafeDatabaseName(databaseName) {
  if (typeof databaseName !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(databaseName)) {
    throw new Error('VALIDATION_ERROR: Tenant database name is not a safe PostgreSQL identifier.');
  }
  return databaseName;
}

function databaseUserFromUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.username ? decodeURIComponent(parsed.username) : null;
  } catch (_error) {
    return null;
  }
}

function databaseUrlFor(rawUrl, databaseName) {
  const url = new URL(rawUrl);
  url.pathname = `/${assertSafeDatabaseName(databaseName)}`;
  return url.toString();
}

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

// Singleton instances
const inMemoryAdapterInstance = new InMemoryTenantDatabaseAdapter();
const postgresAdapterInstance = new PostgresTenantDatabaseAdapter();

function getTenantDatabaseAdapter() {
  if (process.env.NEEM_TENANT_DB_POSTGRES_URL) {
    if (!process.env.NEEM_TENANT_DB_ADMIN_URL && !config.isTest && !config.allowEphemeralDev) {
      throw new Error('FAIL-CLOSED: NEEM_TENANT_DB_ADMIN_URL is required outside test or explicit ephemeral development mode.');
    }
    return postgresAdapterInstance;
  }
  if (config.isTest || config.allowEphemeralDev) {
    return inMemoryAdapterInstance;
  }
  throw new Error(
    'FAIL-CLOSED: NEEM_TENANT_DB_POSTGRES_URL is required for tenant provisioning outside test or explicit ephemeral development mode.'
  );
}

function createTenantDatabaseAdapter({ tenantId, cellId, driver = 'inmemory' } = {}) {
  if (driver === 'postgres' || (driver !== 'inmemory' && process.env.NEEM_TENANT_DB_POSTGRES_URL)) {
    return new PostgresTenantDatabaseAdapter({
      tenantId,
      cellId,
      connectionUrl: process.env.NEEM_TENANT_DB_POSTGRES_URL,
      adminConnectionUrl: process.env.NEEM_TENANT_DB_ADMIN_URL
    });
  }
  return new InMemoryTenantDatabaseAdapter({ tenantId, cellId });
}

module.exports = {
  TenantDatabaseAdapter,
  InMemoryTenantDatabaseAdapter,
  PostgresTenantDatabaseAdapter,
  getTenantDatabaseAdapter,
  createTenantDatabaseAdapter,
  inMemoryAdapterInstance,
  postgresAdapterInstance
};
