'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TENANT_MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');
const MIGRATION_FILE_PATTERN = /^(\d{3})_(.+)\.sql$/;

function normalizeVersion(version) {
  const value = String(version || '').trim();
  return /^\d+$/.test(value) ? value.padStart(3, '0') : value;
}

function checksum(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function migrationName(fileName) {
  return fileName.replace(/\.sql$/, '');
}

function loadTenantMigrations(migrationsDir = DEFAULT_TENANT_MIGRATIONS_DIR) {
  if (!fs.existsSync(migrationsDir)) return [];
  const files = fs.readdirSync(migrationsDir)
    .filter((fileName) => MIGRATION_FILE_PATTERN.test(fileName))
    .sort();

  return files.map((fileName) => {
    const match = fileName.match(MIGRATION_FILE_PATTERN);
    const version = normalizeVersion(match[1]);
    const filePath = path.join(migrationsDir, fileName);
    const sql = fs.readFileSync(filePath, 'utf8');
    return Object.freeze({
      version,
      fileName,
      name: migrationName(fileName),
      filePath,
      checksumSha256: checksum(sql),
      sql,
    });
  });
}

async function ensureTenantMigrationLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS tenant_schema_migrations (
      version VARCHAR(32) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      checksum_sha256 VARCHAR(64) NOT NULL,
      execution_ms INT NOT NULL DEFAULT 0
    )
  `);
}

async function readAppliedTenantMigrations(client) {
  await ensureTenantMigrationLedger(client);
  const result = await client.query(`
    SELECT version, name, applied_at, checksum_sha256, execution_ms
    FROM tenant_schema_migrations
    ORDER BY version ASC
  `);
  return result.rows || [];
}

async function getTenantMigrationStatus(client, migrationsDir = DEFAULT_TENANT_MIGRATIONS_DIR) {
  const migrations = loadTenantMigrations(migrationsDir);
  const applied = await readAppliedTenantMigrations(client);
  const appliedSet = new Set(applied.map((r) => normalizeVersion(r.version)));

  const pending = migrations.filter((m) => !appliedSet.has(m.version));
  return {
    totalMigrations: migrations.length,
    appliedCount: applied.length,
    pendingCount: pending.length,
    applied,
    pending: pending.map((p) => ({ version: p.version, name: p.name })),
  };
}

async function applyTenantMigrations(client, { migrationsDir = DEFAULT_TENANT_MIGRATIONS_DIR } = {}) {
  await ensureTenantMigrationLedger(client);
  const migrations = loadTenantMigrations(migrationsDir);
  const applied = await readAppliedTenantMigrations(client);
  const appliedMap = new Map(applied.map((r) => [normalizeVersion(r.version), r]));

  const appliedResults = [];

  for (const migration of migrations) {
    if (appliedMap.has(migration.version)) {
      continue;
    }

    const start = Date.now();
    await client.query('BEGIN');
    try {
      await client.query(migration.sql);
      const executionMs = Date.now() - start;
      await client.query(`
        INSERT INTO tenant_schema_migrations (version, name, applied_at, checksum_sha256, execution_ms)
        VALUES ($1, $2, now(), $3, $4)
        ON CONFLICT (version) DO UPDATE SET
          name = EXCLUDED.name,
          checksum_sha256 = EXCLUDED.checksum_sha256,
          execution_ms = EXCLUDED.execution_ms
      `, [migration.version, migration.name, migration.checksumSha256, executionMs]);
      await client.query('COMMIT');

      appliedResults.push({
        version: migration.version,
        name: migration.name,
        checksum: migration.checksumSha256,
        executionMs,
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      const error = new Error(`TENANT_MIGRATION_FAILED: Migration ${migration.version} (${migration.name}) failed: ${err.message}`);
      error.migration = migration;
      error.cause = err;
      throw error;
    }
  }

  return {
    ok: true,
    applied: appliedResults,
    currentVersion: migrations.length > 0 ? migrations[migrations.length - 1].version : '000',
  };
}

module.exports = {
  DEFAULT_TENANT_MIGRATIONS_DIR,
  loadTenantMigrations,
  ensureTenantMigrationLedger,
  readAppliedTenantMigrations,
  getTenantMigrationStatus,
  applyTenantMigrations,
};
