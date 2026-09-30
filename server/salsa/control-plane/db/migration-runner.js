'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');
const MIGRATION_FILE_PATTERN = /^(\d{3})_(.+)\.sql$/;
const MIGRATION_LOCK_KEY = 'neem-control-plane-schema-migrations-v1';
const APPLY_CONFIRMATION = 'APPLY_NEEM_CONTROL_PLANE';
const BACKFILL_CONFIRMATION = 'BACKFILL_NEEM_CONTROL_LEDGER';

function normalizeVersion(version) {
  const value = String(version || '').trim();
  return /^\d+$/.test(value) ? value.padStart(3, '0') : value;
}

function checksum(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function migrationDescription(sql, fallback) {
  const match = sql.match(/^--\s*Migration\s+\d+\s*:\s*(.+)$/mi);
  return match ? match[1].trim() : fallback;
}

function loadMigrations(migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  const files = fs.readdirSync(migrationsDir)
    .filter((fileName) => MIGRATION_FILE_PATTERN.test(fileName))
    .sort();
  const seenVersions = new Set();

  return files.map((fileName) => {
    const match = fileName.match(MIGRATION_FILE_PATTERN);
    const version = normalizeVersion(match[1]);
    if (seenVersions.has(version)) {
      throw new Error(`DUPLICATE_CONTROL_PLANE_MIGRATION_VERSION: ${version}`);
    }
    seenVersions.add(version);
    const filePath = path.join(migrationsDir, fileName);
    const sql = fs.readFileSync(filePath, 'utf8');
    return Object.freeze({
      version,
      fileName,
      filePath,
      description: migrationDescription(sql, match[2].replace(/_/g, ' ')),
      checksumSha256: checksum(sql),
      sql
    });
  });
}

function stripStandaloneTransactionWrappers(sql) {
  return sql
    .split(/\r?\n/)
    .filter((line) => !/^\s*(BEGIN|COMMIT)\s*;\s*$/i.test(line))
    .join('\n');
}

function planMigrations(migrations, appliedRows = []) {
  const migrationByVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  const appliedByVersion = new Map();
  const unknownApplied = [];
  const checksumDrift = [];
  const unverified = [];

  for (const row of appliedRows) {
    const version = normalizeVersion(row.version);
    if (appliedByVersion.has(version)) {
      unknownApplied.push({ version, reason: 'duplicate_ledger_row' });
      continue;
    }
    appliedByVersion.set(version, row);
    const migration = migrationByVersion.get(version);
    if (!migration) {
      unknownApplied.push({ version, reason: 'migration_file_missing' });
      continue;
    }
    if (row.checksum_sha256 && row.checksum_sha256 !== migration.checksumSha256) {
      checksumDrift.push({
        version,
        expected: migration.checksumSha256,
        actual: row.checksum_sha256,
        fileName: migration.fileName
      });
    } else if (!row.checksum_sha256) {
      unverified.push({ version, fileName: migration.fileName });
    }
  }

  const pending = migrations.filter((migration) => !appliedByVersion.has(migration.version));
  return {
    pending,
    applied: [...appliedByVersion.keys()].sort(),
    unknownApplied,
    checksumDrift,
    unverified,
    ready: unknownApplied.length === 0 && checksumDrift.length === 0
  };
}

async function readAppliedMigrations(client) {
  const registration = await client.query(
    "SELECT to_regclass('public.neem_control_migrations') AS migration_table"
  );
  if (!registration.rows?.[0]?.migration_table) return [];

  const columns = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'neem_control_migrations'
  `);
  const columnNames = new Set(columns.rows.map((row) => row.column_name));
  const checksumColumn = columnNames.has('checksum_sha256') ? ', checksum_sha256' : '';
  const sourceColumn = columnNames.has('source_file') ? ', source_file' : '';
  const executionColumn = columnNames.has('execution_ms') ? ', execution_ms' : '';
  const result = await client.query(
    `SELECT version, description, applied_at${checksumColumn}${sourceColumn}${executionColumn}
     FROM neem_control_migrations ORDER BY version`
  );
  return result.rows;
}

async function ensureMigrationLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS neem_control_migrations (
      version TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      checksum_sha256 TEXT,
      source_file TEXT,
      execution_ms INTEGER NOT NULL DEFAULT 0
    )
  `);
  await client.query('ALTER TABLE neem_control_migrations ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT');
  await client.query('ALTER TABLE neem_control_migrations ADD COLUMN IF NOT EXISTS source_file TEXT');
  await client.query('ALTER TABLE neem_control_migrations ADD COLUMN IF NOT EXISTS execution_ms INTEGER NOT NULL DEFAULT 0');
}

async function recordMigration(client, migration, executionMs) {
  await client.query(
    `INSERT INTO neem_control_migrations
       (version, description, applied_at, checksum_sha256, source_file, execution_ms)
     VALUES ($1, $2, now(), $3, $4, $5)
     ON CONFLICT (version) DO UPDATE SET
       description = EXCLUDED.description,
       checksum_sha256 = EXCLUDED.checksum_sha256,
       source_file = EXCLUDED.source_file,
       execution_ms = EXCLUDED.execution_ms`,
    [migration.version, migration.description, migration.checksumSha256, migration.fileName, executionMs]
  );
}

async function getPlan(client, migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  const migrations = loadMigrations(migrationsDir);
  const appliedRows = await readAppliedMigrations(client);
  return { migrations, appliedRows, plan: planMigrations(migrations, appliedRows) };
}

async function applyPendingMigrations({
  client,
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
  acceptLegacyLedger = false
}) {
  if (!client || typeof client.query !== 'function') {
    throw new Error('CONTROL_PLANE_MIGRATION_CLIENT_REQUIRED');
  }

  await client.query('SELECT pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_KEY]);
  try {
    await ensureMigrationLedger(client);
    const initial = await getPlan(client, migrationsDir);
    const { plan } = initial;
    if (!plan.ready) {
      const error = new Error('FAIL-CLOSED: Control Plane migration ledger has unknown versions or checksum drift.');
      error.code = 'CONTROL_PLANE_MIGRATION_DRIFT';
      error.details = plan;
      throw error;
    }
    if (plan.pending.length > 0 && plan.unverified.length > 0 && !acceptLegacyLedger) {
      const error = new Error('FAIL-CLOSED: Existing Control Plane migration ledger has unverified legacy rows; backfill or explicitly accept it before applying new migrations.');
      error.code = 'CONTROL_PLANE_LEGACY_LEDGER_UNVERIFIED';
      error.details = plan;
      throw error;
    }

    const applied = [];
    for (const migration of plan.pending) {
      const startedAt = Date.now();
      await client.query('BEGIN');
      try {
        await client.query(stripStandaloneTransactionWrappers(migration.sql));
        await recordMigration(client, migration, Date.now() - startedAt);
        await client.query('COMMIT');
        applied.push(migration.version);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        error.message = `Migration ${migration.version} (${migration.fileName}) failed: ${error.message}`;
        throw error;
      }
    }

    return { applied, plan: (await getPlan(client, migrationsDir)).plan };
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_KEY]).catch(() => {});
  }
}

async function backfillLegacyChecksums({ client, migrationsDir = DEFAULT_MIGRATIONS_DIR }) {
  if (!client || typeof client.query !== 'function') {
    throw new Error('CONTROL_PLANE_MIGRATION_CLIENT_REQUIRED');
  }
  await client.query('SELECT pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_KEY]);
  try {
    await ensureMigrationLedger(client);
    const { migrations, appliedRows, plan } = await getPlan(client, migrationsDir);
    if (!plan.ready) {
      const error = new Error('FAIL-CLOSED: Cannot backfill a migration ledger with unknown versions or checksum drift.');
      error.code = 'CONTROL_PLANE_MIGRATION_DRIFT';
      error.details = plan;
      throw error;
    }
    const migrationByVersion = new Map(migrations.map((migration) => [migration.version, migration]));
    const backfilled = [];
    for (const row of appliedRows) {
      const version = normalizeVersion(row.version);
      if (row.checksum_sha256 || !migrationByVersion.has(version)) continue;
      await recordMigration(client, migrationByVersion.get(version), 0);
      backfilled.push(version);
    }
    return { backfilled, plan: (await getPlan(client, migrationsDir)).plan };
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_KEY]).catch(() => {});
  }
}

async function withPool(connectionString, callback) {
  if (!connectionString) throw new Error('SALSA_CONTROL_DATABASE_URL (or legacy NEEM_CONTROL_DATABASE_URL) is required.');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString });
  try {
    return await callback(pool);
  } finally {
    await pool.end();
  }
}

async function runCli(argv = process.argv.slice(2), env = process.env) {
  const mode = argv.includes('--apply') ? 'apply' : argv.includes('--backfill') ? 'backfill' : 'plan';
  const connectionString = env.SALSA_CONTROL_DATABASE_URL || env.NEEM_CONTROL_DATABASE_URL;
  const migrationConfirm = env.SALSA_CONTROL_MIGRATION_CONFIRM || env.NEEM_CONTROL_MIGRATION_CONFIRM;
  if (!connectionString) throw new Error('SALSA_CONTROL_DATABASE_URL (or legacy NEEM_CONTROL_DATABASE_URL) is required for Control Plane migration plan/apply.');
  if (mode === 'apply' && migrationConfirm !== APPLY_CONFIRMATION) {
    throw new Error(`Refusing to apply migrations without SALSA_CONTROL_MIGRATION_CONFIRM=${APPLY_CONFIRMATION}.`);
  }
  if (mode === 'backfill' && migrationConfirm !== BACKFILL_CONFIRMATION) {
    throw new Error(`Refusing to backfill without SALSA_CONTROL_MIGRATION_CONFIRM=${BACKFILL_CONFIRMATION}.`);
  }

  return withPool(connectionString, async (pool) => {
    const client = await pool.connect();
    try {
      if (mode === 'plan') return { mode, plan: (await getPlan(client)).plan };
      if (mode === 'backfill') return { mode, ...(await backfillLegacyChecksums({ client })) };
      return { mode, ...(await applyPendingMigrations({
        client,
        acceptLegacyLedger: argv.includes('--accept-legacy-ledger')
      })) };
    } finally {
      client.release();
    }
  });
}

if (require.main === module) {
  runCli().then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(`[NEEM CONTROL PLANE MIGRATIONS] ${error.code || 'FAILED'}: ${error.message}`);
    if (error.details) console.error(JSON.stringify(error.details, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  APPLY_CONFIRMATION,
  BACKFILL_CONFIRMATION,
  DEFAULT_MIGRATIONS_DIR,
  loadMigrations,
  normalizeVersion,
  planMigrations,
  stripStandaloneTransactionWrappers,
  readAppliedMigrations,
  ensureMigrationLedger,
  applyPendingMigrations,
  backfillLegacyChecksums,
  runCli
};
