#!/usr/bin/env node
'use strict';

/**
 * Unified Database Readiness & Health Diagnostic Tool
 *
 * Inspects both WESTO Data Plane (PostgreSQL or JSON snapshot) and
 * NEEM Control Plane (PostgreSQL or Ephemeral In-Memory Adapter).
 *
 * Checks:
 *  - Database connectivity and round-trip ping latency
 *  - Connection pool metrics and limits
 *  - PostgreSQL server parameters (shared_buffers, work_mem, max_connections)
 *  - Migration ledger status and SHA-256 drift detection
 *  - Table existence, row counts, and sizing
 *  - Unindexed foreign key detection (DBA optimization check)
 *  - JSON state integrity fallback inspection
 *
 * Usage:
 *   node scripts/database-readiness-check.js [--json] [--summary] [--westo-only] [--neem-only]
 */

const fs = require('node:fs');
const path = require('node:path');

// Proactively load .env.local or .env if present
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return false;
  try {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const equalsIdx = trimmed.indexOf('=');
      if (equalsIdx <= 0) continue;
      const key = trimmed.slice(0, equalsIdx).trim();
      let value = trimmed.slice(equalsIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
    return true;
  } catch (_error) {
    return false;
  }
}

const ROOT_DIR = path.resolve(__dirname, '..');
loadEnvFile(path.join(ROOT_DIR, '.env.local'));
loadEnvFile(path.join(ROOT_DIR, '.env'));

const { discoverMigrations, buildMigrationPlan, readAppliedMigrations } = require('./migrate-finance-v2-postgres');
const neemReadiness = require('../server/salsa/control-plane/db/readiness');
const neemConfig = require('../server/salsa/control-plane/config');
const { getDatabase, getDatabasePoolMetrics, InMemoryTestAdapter } = require('../server/salsa/control-plane/db/database');

async function inspectPostgresSettings(client) {
  try {
    const res = await client.query(`
      SELECT name, setting, unit
      FROM pg_settings
      WHERE name IN (
        'server_version', 'shared_buffers', 'work_mem', 'maintenance_work_mem',
        'effective_cache_size', 'max_connections', 'random_page_cost'
      )
    `);
    const settings = {};
    for (const row of res.rows) {
      settings[row.name] = row.unit ? `${row.setting} ${row.unit}` : row.setting;
    }
    return settings;
  } catch (_error) {
    return null;
  }
}

async function findUnindexedForeignKeys(client) {
  try {
    const query = `
      SELECT
        c.conrelid::regclass::text AS table_name,
        c.conname AS constraint_name,
        pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      WHERE c.contype = 'f'
        AND c.connamespace = 'public'::regnamespace
        AND NOT EXISTS (
          SELECT 1
          FROM pg_index i
          WHERE i.indrelid = c.conrelid
            AND i.indkey[0:array_length(c.conkey, 1) - 1] = c.conkey
        )
      ORDER BY table_name, constraint_name;
    `;
    const res = await client.query(query);
    return res.rows.map((row) => ({
      table: row.table_name,
      constraint: row.constraint_name,
      definition: row.definition
    }));
  } catch (_error) {
    return [];
  }
}

async function inspectWestoDatabase() {
  const connectionString = process.env.DATABASE_URL;
  const isRequired = process.env.WESTO_POSTGRES_REQUIRED === 'true';

  if (!connectionString) {
    // Inspect JSON state fallback
    const jsonPath = path.join(ROOT_DIR, 'server', 'data', 'db.json');
    const jsonExists = fs.existsSync(jsonPath);
    let jsonDetails = null;

    if (jsonExists) {
      try {
        const stat = fs.statSync(jsonPath);
        const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        jsonDetails = {
          fileSizeKb: (stat.size / 1024).toFixed(1),
          modifiedAt: stat.mtime.toISOString(),
          ordersCount: Array.isArray(data.orders) ? data.orders.length : 0,
          menuItemsCount: Array.isArray(data.menuItems) ? data.menuItems.length : 0,
          branchesCount: Array.isArray(data.branches) ? data.branches.length : 0,
          usersCount: Array.isArray(data.users) ? data.users.length : 0,
          tablesCount: Array.isArray(data.tables) ? data.tables.length : 0,
        };
      } catch (err) {
        jsonDetails = { error: err.message };
      }
    }

    return {
      status: isRequired ? 'UNREADY' : 'LOCAL_JSON',
      storageEngine: 'json_fallback',
      databaseUrlConfigured: false,
      required: isRequired,
      jsonFallback: {
        path: jsonPath,
        exists: jsonExists,
        details: jsonDetails,
      },
    };
  }

  let pg;
  try {
    pg = require('pg');
  } catch (error) {
    return {
      status: 'DRIVER_MISSING',
      storageEngine: 'postgres',
      databaseUrlConfigured: true,
      error: 'pg package is not installed',
    };
  }

  const pool = new pg.Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'false' ? false : (
      process.env.DATABASE_SSL === 'true' || process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
        : undefined
    ),
    connectionTimeoutMillis: Math.max(1000, Number(process.env.DATABASE_CONNECT_TIMEOUT_MS) || 5000),
  });

  if (typeof pool.on === 'function') {
    pool.on('error', () => {});
  }

  const pingStart = Date.now();
  let client;
  try {
    client = await pool.connect();
    const pingLatencyMs = Math.max(0, Date.now() - pingStart);

    const versionRes = await client.query('SELECT version(), current_database() as db_name, current_user as db_user');
    const dbMeta = versionRes.rows[0] || {};
    const settings = await inspectPostgresSettings(client);

    // Check migrations
    const migrations = discoverMigrations();
    const appliedRows = await readAppliedMigrations(client);
    const plan = buildMigrationPlan(migrations, appliedRows);

    const pending = plan.filter((m) => m.status === 'pending');
    const drift = plan.filter((m) => ['checksum_mismatch', 'unknown_applied'].includes(m.status));
    const applied = plan.filter((m) => m.status === 'applied');

    // Check core tables
    const tablesRes = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    const tableNames = new Set(tablesRes.rows.map((r) => r.table_name));

    const coreTables = [
      'westo_state', 'westo_audit_events', 'unified_branches', 'unified_orders',
      'unified_menu_items', 'unified_customers', 'journal_entries_v2', 'journal_lines_v2',
      'fiscal_periods_v2', 'finance_events', 'finance_approvals', 'finance_schema_migrations'
    ];
    const missingTables = coreTables.filter((t) => !tableNames.has(t));

    // Sample row counts
    const rowCounts = {};
    for (const table of ['westo_state', 'westo_audit_events', 'unified_orders', 'journal_entries_v2']) {
      if (tableNames.has(table)) {
        try {
          const countRes = await client.query(`SELECT count(*)::int AS count FROM ${table}`);
          rowCounts[table] = countRes.rows[0].count;
        } catch (_err) {
          rowCounts[table] = null;
        }
      }
    }

    // Unindexed foreign keys
    const unindexedFks = await findUnindexedForeignKeys(client);

    const isReady = missingTables.length === 0 && pending.length === 0 && drift.length === 0;

    return {
      status: isReady ? 'READY' : (missingTables.length > 0 ? 'SCHEMA_INCOMPLETE' : (pending.length > 0 ? 'MIGRATIONS_PENDING' : 'DRIFT_DETECTED')),
      storageEngine: 'postgres',
      databaseUrlConfigured: true,
      databaseName: dbMeta.db_name,
      databaseUser: dbMeta.db_user,
      pingLatencyMs,
      serverVersion: dbMeta.version,
      serverSettings: settings,
      poolMetrics: {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount,
      },
      migrations: {
        totalFiles: migrations.length,
        appliedCount: applied.length,
        pendingCount: pending.length,
        driftCount: drift.length,
        drift: drift.map((d) => ({ version: d.version, filename: d.filename, status: d.status })),
        pending: pending.map((p) => ({ version: p.version, filename: p.filename })),
      },
      schema: {
        totalPublicTables: tableNames.size,
        missingCoreTables: missingTables,
        sampledRowCounts: rowCounts,
      },
      optimizations: {
        unindexedForeignKeysCount: unindexedFks.length,
        unindexedForeignKeys: unindexedFks,
      }
    };
  } catch (error) {
    return {
      status: 'CONNECTION_FAILED',
      storageEngine: 'postgres',
      databaseUrlConfigured: true,
      error: error.message,
      code: error.code,
    };
  } finally {
    if (client) client.release();
    await pool.end().catch(() => {});
  }
}

async function inspectNeemDatabase() {
  const isProd = neemConfig.isProduction;
  const dbUrl = neemConfig.databaseUrl;
  const allowEphemeral = neemConfig.allowEphemeralDev || process.env.NEEM_CONTROL_ALLOW_EPHEMERAL_DEV === 'true';

  if (!dbUrl && !allowEphemeral && !isProd) {
    return {
      status: 'NOT_CONFIGURED_DEV',
      storageEngine: 'unconfigured',
      databaseUrlConfigured: false,
      isProduction: false,
      message: 'NEEM_CONTROL_DATABASE_URL is not set. Configure NEEM_CONTROL_DATABASE_URL for PostgreSQL persistence or NEEM_CONTROL_ALLOW_EPHEMERAL_DEV=true for local in-memory operation.',
    };
  }

  try {
    const db = getDatabase();
    const isInMemory = db instanceof InMemoryTestAdapter || Boolean(db?.isInMemory);

    if (isInMemory) {
      return {
        status: isProd ? 'FAILED_IN_PROD' : 'EPHEMERAL_ACTIVE',
        storageEngine: 'in_memory_adapter',
        databaseUrlConfigured: Boolean(dbUrl),
        isProduction: isProd,
        tablesCount: Object.keys(db.tables || {}).length,
        auditEventsCount: (db.tables?.neem_control_audit_events || []).length,
        tenantsCount: (db.tables?.neem_tenants || []).length,
        principalsCount: (db.tables?.neem_platform_principals || []).length,
        poolMetrics: getDatabasePoolMetrics(db),
      };
    }

    // Real PostgreSQL instance
    const pingStart = Date.now();
    await db.query('SELECT 1');
    const pingLatencyMs = Math.max(0, Date.now() - pingStart);

    const readinessResult = await neemReadiness.inspectControlPlaneDatabase(db);
    const poolMetrics = getDatabasePoolMetrics(db);

    return {
      status: readinessResult.ready ? 'READY' : 'SCHEMA_INCOMPLETE',
      storageEngine: 'postgres',
      databaseUrlConfigured: true,
      isProduction: isProd,
      pingLatencyMs,
      databaseName: readinessResult.databaseName,
      schemaName: readinessResult.schemaName,
      poolMetrics,
      migrations: {
        requiredCount: readinessResult.requiredMigrations.length,
        appliedCount: readinessResult.appliedVersions.length,
        missingCount: readinessResult.missingMigrations.length,
        missing: readinessResult.missingMigrations,
      },
      schema: {
        requiredTablesCount: readinessResult.requiredTables.length,
        missingTablesCount: readinessResult.missingTables.length,
        missingTables: readinessResult.missingTables,
      }
    };
  } catch (error) {
    return {
      status: 'INSPECTION_FAILED',
      storageEngine: dbUrl ? 'postgres' : 'unknown',
      databaseUrlConfigured: Boolean(dbUrl),
      isProduction: isProd,
      error: error.message,
      code: error.code,
      details: error.details || null,
    };
  }
}

async function runReadinessCheck(options = {}) {
  const result = {
    timestamp: new Date().toISOString(),
    overallStatus: 'READY',
    westo: null,
    neem: null,
  };

  if (!options.neemOnly) {
    result.westo = await inspectWestoDatabase();
  }

  if (!options.westoOnly) {
    result.neem = await inspectNeemDatabase();
  }

  // Determine overall status
  const westoOk = !result.westo || ['READY', 'LOCAL_JSON'].includes(result.westo.status);
  const neemOk = !result.neem || ['READY', 'EPHEMERAL_ACTIVE', 'NOT_CONFIGURED_DEV'].includes(result.neem.status);

  if (result.westo?.status === 'CONNECTION_FAILED' || result.neem?.status === 'FAILED_IN_PROD') {
    result.overallStatus = 'FAILED';
  } else if (!westoOk || !neemOk) {
    result.overallStatus = 'DEGRADED';
  } else {
    result.overallStatus = 'READY';
  }

  return result;
}

function formatConsoleOutput(report) {
  const chalk = {
    cyan: (s) => `\x1b[36m${s}\x1b[0m`,
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
    gray: (s) => `\x1b[90m${s}\x1b[0m`,
  };

  const statusColor = (status) => {
    if (['READY', 'LOCAL_JSON', 'EPHEMERAL_ACTIVE'].includes(status)) return chalk.green(status);
    if (['MIGRATIONS_PENDING', 'SCHEMA_INCOMPLETE', 'DEGRADED', 'NOT_CONFIGURED_DEV'].includes(status)) return chalk.yellow(status);
    return chalk.red(status);
  };

  console.log(chalk.bold('\n========================================================================'));
  console.log(chalk.cyan('        WESTO & NEEM DATABASE READINESS & OPTIMIZATION DIAGNOSTIC        '));
  console.log(chalk.bold('========================================================================'));
  console.log(`Timestamp:      ${report.timestamp}`);
  console.log(`Overall Health: ${statusColor(report.overallStatus)}\n`);

  if (report.westo) {
    console.log(chalk.bold('--- [1] WESTO Data Plane Subsystem ---'));
    console.log(`Status:         ${statusColor(report.westo.status)}`);
    console.log(`Storage Engine: ${report.westo.storageEngine}`);

    if (report.westo.storageEngine === 'postgres') {
      if (report.westo.databaseName) {
        console.log(`Database:       ${report.westo.databaseName} (User: ${report.westo.databaseUser})`);
        console.log(`Ping Latency:   ${report.westo.pingLatencyMs} ms`);
        console.log(`Pool Stats:     Total: ${report.westo.poolMetrics.totalCount} | Idle: ${report.westo.poolMetrics.idleCount} | Waiting: ${report.westo.poolMetrics.waitingCount}`);
        console.log(`Migrations:     ${report.westo.migrations.appliedCount}/${report.westo.migrations.totalFiles} applied (Pending: ${report.westo.migrations.pendingCount}, Drift: ${report.westo.migrations.driftCount})`);
        console.log(`Public Tables:  ${report.westo.schema.totalPublicTables} tables detected`);
        if (report.westo.schema.missingCoreTables.length > 0) {
          console.log(chalk.red(`Missing Tables: ${report.westo.schema.missingCoreTables.join(', ')}`));
        }
        if (report.westo.optimizations?.unindexedForeignKeysCount > 0) {
          console.log(chalk.yellow(`Optimization:   ${report.westo.optimizations.unindexedForeignKeysCount} unindexed foreign key(s) identified`));
        }
      } else if (report.westo.error) {
        console.log(chalk.red(`Error:          ${report.westo.error} (${report.westo.code || 'N/A'})`));
      }
    } else if (report.westo.storageEngine === 'json_fallback') {
      const fb = report.westo.jsonFallback;
      console.log(`Snapshot Exists: ${fb.exists ? chalk.green('Yes') : chalk.red('No')} (${fb.path})`);
      if (fb.details) {
        console.log(`Snapshot Stats:  Size: ${fb.details.fileSizeKb} KB | Orders: ${fb.details.ordersCount} | Items: ${fb.details.menuItemsCount} | Branches: ${fb.details.branchesCount}`);
      }
    }
    console.log('');
  }

  if (report.neem) {
    console.log(chalk.bold('--- [2] NEEM Control Plane Subsystem ---'));
    console.log(`Status:         ${statusColor(report.neem.status)}`);
    console.log(`Storage Engine: ${report.neem.storageEngine}`);

    if (report.neem.storageEngine === 'postgres') {
      console.log(`Database:       ${report.neem.databaseName}`);
      console.log(`Ping Latency:   ${report.neem.pingLatencyMs} ms`);
      console.log(`Migrations:     ${report.neem.migrations.appliedCount}/${report.neem.migrations.requiredCount} applied (Missing: ${report.neem.migrations.missingCount})`);
      if (report.neem.schema.missingTablesCount > 0) {
        console.log(chalk.red(`Missing Tables: ${report.neem.schema.missingTables.join(', ')}`));
      }
    } else if (report.neem.storageEngine === 'in_memory_adapter') {
      console.log(`Mode:           Isolated In-Memory Test/Development Engine`);
      console.log(`State Counters: Tenants: ${report.neem.tenantsCount} | Audit Events: ${report.neem.auditEventsCount} | Principals: ${report.neem.principalsCount}`);
    } else if (report.neem.status === 'NOT_CONFIGURED_DEV') {
      console.log(chalk.yellow(`Notice:         ${report.neem.message}`));
    } else if (report.neem.error) {
      console.log(chalk.red(`Error:          ${report.neem.error} (${report.neem.code || 'N/A'})`));
    }
    console.log('');
  }

  console.log(chalk.bold('========================================================================\n'));
}

async function main() {
  const args = process.argv.slice(2);
  const isJson = args.includes('--json');
  const westoOnly = args.includes('--westo-only');
  const neemOnly = args.includes('--neem-only');

  const report = await runReadinessCheck({ westoOnly, neemOnly });

  if (isJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    formatConsoleOutput(report);
  }

  if (report.overallStatus === 'FAILED') {
    process.exitCode = 2;
  } else if (report.overallStatus === 'DEGRADED') {
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal readiness check failure:', err);
    process.exit(2);
  });
}

module.exports = {
  runReadinessCheck,
  inspectWestoDatabase,
  inspectNeemDatabase,
  inspectPostgresSettings,
  findUnindexedForeignKeys,
};
