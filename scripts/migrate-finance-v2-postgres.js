'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATION_PATTERN = /^(?:00[2-9]|0[1-9]\d|[1-9]\d{2})_.*\.sql$/;

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

async function applyMigrations(pool, migrations) {
  const client = await pool.connect();
  const results = [];
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('westo:finance-v2-schema-migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS finance_schema_migrations (
      version TEXT PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      checksum_sha256 TEXT NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
      execution_ms INTEGER NOT NULL CHECK (execution_ms >= 0),
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
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
    for (const migration of plan) {
      if (migration.status === 'applied') {
        results.push({ version: migration.version, filename: migration.filename, status: 'skipped_applied', checksumSha256: migration.checksumSha256 });
        continue;
      }
      const started = Date.now();
      await client.query(migration.sql);
      const executionMs = Math.max(0, Date.now() - started);
      await client.query(`INSERT INTO finance_schema_migrations(version,filename,checksum_sha256,execution_ms)
        VALUES($1,$2,$3,$4)`, [migration.version, migration.filename, migration.checksumSha256, executionMs]);
      results.push({ version: migration.version, filename: migration.filename, status: 'applied', checksumSha256: migration.checksumSha256, executionMs });
    }
    return results;
  } catch (error) {
    // A migration file owns its BEGIN/COMMIT block. If it failed mid-file,
    // clear the aborted transaction before releasing the session-level lock.
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

module.exports = { MIGRATION_PATTERN, discoverMigrations, buildMigrationPlan, readAppliedMigrations, planMigrations, applyMigrations, main };
