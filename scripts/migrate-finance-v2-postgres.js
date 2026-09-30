'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATION_PATTERN = /^(?:00[2-9]|0[1-9]\d|[1-9]\d{2})_.*\.sql$/;
const REQUIRED_OPERATIONAL_RELATIONS = ['unified_branches', 'unified_orders'];

function discoverMigrations(migrationsDir = path.join(__dirname, '..', 'server', 'migrations')) {
  return fs.readdirSync(migrationsDir)
    .filter((name) => MIGRATION_PATTERN.test(name))
    .sort()
    .map((name) => {
      const filePath = path.join(migrationsDir, name);
      const sql = fs.readFileSync(filePath, 'utf8');
      return {
        version: name.split('_')[0],
        filename: name,
        path: filePath,
        checksumSha256: crypto.createHash('sha256').update(sql).digest('hex'),
        sql,
      };
    });
}

function buildMigrationPlan(migrations, appliedRows = []) {
  const applied = new Map(appliedRows.map((row) => [String(row.version), row]));
  const knownVersions = new Set(migrations.map((migration) => migration.version));
  const plan = migrations.map((migration) => {
    const row = applied.get(migration.version);
    if (!row) return { ...migration, status: 'pending' };
    const checksumMatches = row.checksum_sha256 === migration.checksumSha256;
    const filenameMatches = row.filename === migration.filename;
    return {
      ...migration,
      status: checksumMatches && filenameMatches ? 'applied' : 'checksum_mismatch',
      appliedFilename: row.filename,
      appliedChecksumSha256: row.checksum_sha256,
      appliedAt: row.applied_at || null,
    };
  });
  for (const row of appliedRows) {
    const version = String(row.version);
    if (knownVersions.has(version)) continue;
    plan.push({
      version,
      filename: row.filename || null,
      status: 'unknown_applied',
      appliedFilename: row.filename || null,
      appliedChecksumSha256: row.checksum_sha256 || null,
      appliedAt: row.applied_at || null,
    });
  }
  return plan.sort((a, b) => String(a.version).localeCompare(String(b.version), undefined, { numeric: true }));
}

async function readAppliedMigrations(client) {
  const exists = await client.query("SELECT to_regclass('public.finance_schema_migrations') AS migration_ledger");
  if (!exists.rows?.[0]?.migration_ledger) return [];
  const result = await client.query('SELECT version,filename,checksum_sha256,applied_at FROM finance_schema_migrations ORDER BY version');
  return result.rows || [];
}

function migrationBody(sql) {
  const source = String(sql || '').replace(/^\uFEFF/, '');
  if (!/^\s*BEGIN\s*;\s*/i.test(source) || !/\s*COMMIT\s*;\s*$/i.test(source)) {
    const error = new Error('Every finance migration must be wrapped by a single BEGIN/COMMIT pair.');
    error.code = 'finance_migration_transaction_wrapper_invalid';
    throw error;
  }
  const body = source.replace(/^\s*BEGIN\s*;\s*/i, '').replace(/\s*COMMIT\s*;\s*$/i, '').trim();
  if (!body) {
    const error = new Error('A finance migration cannot have an empty transaction body.');
    error.code = 'finance_migration_transaction_body_empty';
    throw error;
  }
  return `${body}\n`;
}

function requireBackupReference(value = process.env.WESTO_FINANCE_BACKUP_REFERENCE) {
  const reference = String(value || '').trim();
  if (!reference) {
    const error = new Error('A verified database backup reference is required before applying a pending Finance V2 migration.');
    error.code = 'finance_backup_reference_required';
    throw error;
  }
  if (reference.length > 512) {
    const error = new Error('The database backup reference is too long.');
    error.code = 'finance_backup_reference_invalid';
    throw error;
  }
  return reference;
}

async function assertOperationalSchema(client) {
  const result = await client.query(`SELECT
    to_regclass('public.unified_branches') AS unified_branches,
    to_regclass('public.unified_orders') AS unified_orders`);
  const row = result.rows?.[0] || {};
  const missing = REQUIRED_OPERATIONAL_RELATIONS.filter((relation) => !row[relation]);
  if (missing.length) {
    const error = new Error(`Unified operational schema is required before Finance V2 migrations: ${missing.join(', ')}`);
    error.code = 'finance_operational_schema_required';
    error.details = { missing };
    throw error;
  }
  return { available: true, relations: REQUIRED_OPERATIONAL_RELATIONS.slice() };
}

async function planMigrations(pool, migrations) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    const rows = await readAppliedMigrations(client);
    await client.query('ROLLBACK');
    return buildMigrationPlan(migrations, rows);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function applyMigrations(pool, migrations, { backupReference = process.env.WESTO_FINANCE_BACKUP_REFERENCE } = {}) {
  const client = await pool.connect();
  const results = [];
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('westo:finance-v2-schema-migrations'))");
    await assertOperationalSchema(client);
    const existing = await readAppliedMigrations(client);
    const plan = buildMigrationPlan(migrations, existing);
    const drift = plan.find((row) => ['checksum_mismatch', 'unknown_applied'].includes(row.status));
    if (drift) {
      const error = new Error(drift.status === 'unknown_applied'
        ? `Migration ${drift.version} is recorded in the database but no matching migration file is present.`
        : `Migration ${drift.version} differs from the previously applied file/checksum.`);
      error.code = drift.status === 'unknown_applied' ? 'finance_migration_unknown_applied' : 'finance_migration_checksum_mismatch';
      error.migration = drift.filename;
      throw error;
    }
    const pendingMigrations = plan.filter((row) => row.status === 'pending');
    const verifiedBackupReference = pendingMigrations.length ? requireBackupReference(backupReference) : null;
    const bodies = new Map(pendingMigrations.map((migration) => [migration.version, migrationBody(migration.sql)]));
    if (pendingMigrations.length) {
      await client.query(`CREATE TABLE IF NOT EXISTS finance_schema_migrations (
        version TEXT PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        checksum_sha256 TEXT NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
        execution_ms INTEGER NOT NULL CHECK (execution_ms >= 0),
        backup_reference TEXT,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await client.query('ALTER TABLE finance_schema_migrations ADD COLUMN IF NOT EXISTS backup_reference TEXT');
    }
    for (const migration of plan) {
      if (migration.status === 'applied') {
        results.push({ version: migration.version, filename: migration.filename, status: 'skipped_applied', checksumSha256: migration.checksumSha256 });
        continue;
      }
      const started = Date.now();
      // Older files carry their own transaction markers for direct inspection.
      // The runner strips only those outer markers and owns the transaction so
      // the schema change and its checksum ledger row commit together.
      await client.query('BEGIN');
      try {
        await client.query(bodies.get(migration.version));
        const executionMs = Math.max(0, Date.now() - started);
        await client.query(`INSERT INTO finance_schema_migrations(version,filename,checksum_sha256,execution_ms,backup_reference)
          VALUES($1,$2,$3,$4,$5)`, [migration.version, migration.filename, migration.checksumSha256, executionMs, verifiedBackupReference]);
        await client.query('COMMIT');
        results.push({ version: migration.version, filename: migration.filename, status: 'applied', checksumSha256: migration.checksumSha256, executionMs, backupReference: verifiedBackupReference });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
    }
    return results;
  } catch (error) {
    // Clear any aborted transaction before releasing the session-level lock.
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('westo:finance-v2-schema-migrations'))").catch(() => {});
    client.release();
  }
}

function publicPlan(plan) {
  return plan.map(({ path: ignoredPath, sql: ignoredSql, ...row }) => row);
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    const error = new Error('DATABASE_URL is required. Finance V2 migration was not attempted.');
    error.code = 'database_url_required';
    throw error;
  }
  const migrations = discoverMigrations();
  const pool = new Pool({ connectionString, ssl: process.env.DATABASE_SSL === 'false' ? false : undefined });
  const apply = process.argv.includes('--apply');
  try {
    if (!apply) {
      const plan = await planMigrations(pool, migrations);
      const drift = plan.filter((row) => ['checksum_mismatch', 'unknown_applied'].includes(row.status));
      process.stdout.write(`${JSON.stringify({ ok: drift.length === 0, applied: false, migrations: publicPlan(plan) }, null, 2)}\n`);
      if (drift.length) process.exitCode = 1;
      return;
    }
    if (process.env.WESTO_FINANCE_MIGRATION_CONFIRM !== 'APPLY_FINANCE_SCHEMA') {
      const error = new Error('Apply requires WESTO_FINANCE_MIGRATION_CONFIRM=APPLY_FINANCE_SCHEMA. No migration was attempted.');
      error.code = 'finance_migration_confirmation_required';
      throw error;
    }
    const results = await applyMigrations(pool, migrations);
    const tables = await pool.query(`SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name = ANY($1::text[]) ORDER BY table_name`, [[
      'finance_events', 'fiscal_periods_v2', 'journal_entries_v2', 'journal_lines_v2',
      'finance_approvals', 'reconciliation_items', 'finance_outbox', 'finance_legacy_archive',
      'finance_inventory_items_v2', 'finance_recipe_ingredients', 'finance_order_item_cost_snapshots',
      'finance_opening_balance_batches', 'finance_branch_rollouts', 'finance_migration_baselines', 'finance_schema_migrations',
    ]]);
    process.stdout.write(`${JSON.stringify({ ok: true, applied: true, migrations: results, tables: tables.rows.map((row) => row.table_name) }, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'finance_migration_failed', error: error.message, migration: error.migration || null }, null, 2)}\n`);
    process.exitCode = ['database_url_required', 'finance_migration_confirmation_required'].includes(error.code) ? 2 : 1;
  });
}

module.exports = {
  MIGRATION_PATTERN, REQUIRED_OPERATIONAL_RELATIONS, discoverMigrations, buildMigrationPlan,
  readAppliedMigrations, migrationBody, requireBackupReference, assertOperationalSchema, planMigrations, applyMigrations, main,
};
