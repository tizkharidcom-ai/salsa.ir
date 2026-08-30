'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { discoverMigrations, buildMigrationPlan } = require('../scripts/migrate-finance-v2-postgres');

test('finance migration runner discovers every ordered migration with a stable checksum', () => {
  const migrations = discoverMigrations();
  assert.deepEqual(migrations.map((row) => row.version), ['002', '003', '004', '005', '006', '007', '008', '009', '010', '011', '012', '013', '014', '015', '016', '017', '018']);
  assert.equal(new Set(migrations.map((row) => row.checksumSha256)).size, migrations.length);
  assert.equal(migrations.every((row) => /^[0-9a-f]{64}$/.test(row.checksumSha256)), true);
});

test('finance migration plan distinguishes pending, applied and checksum drift', () => {
  const migrations = discoverMigrations().slice(0, 3);
  const plan = buildMigrationPlan(migrations, [
    { version: migrations[0].version, filename: migrations[0].filename, checksum_sha256: migrations[0].checksumSha256 },
    { version: migrations[1].version, filename: migrations[1].filename, checksum_sha256: '0'.repeat(64) },
  ]);
  assert.deepEqual(plan.map((row) => row.status), ['applied', 'checksum_mismatch', 'pending']);
});

test('finance migration plan fails closed on an applied version with no current file', () => {
  const migrations = discoverMigrations().slice(0, 1);
  const plan = buildMigrationPlan(migrations, [
    { version: migrations[0].version, filename: migrations[0].filename, checksum_sha256: migrations[0].checksumSha256 },
    { version: '999', filename: '999_removed.sql', checksum_sha256: 'a'.repeat(64) },
  ]);
  assert.deepEqual(plan.map((row) => row.status), ['applied', 'unknown_applied']);
});

test('finance migration CLI is plan-first and apply requires explicit confirmation', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'migrate-finance-v2-postgres.js'), 'utf8');
  assert.match(source, /BEGIN TRANSACTION READ ONLY/);
  assert.match(source, /finance_schema_migrations/);
  assert.match(source, /checksum_sha256/);
  assert.match(source, /WESTO_FINANCE_MIGRATION_CONFIRM/);
  assert.match(source, /APPLY_FINANCE_SCHEMA/);
  assert.match(source, /pg_advisory_lock/);
});
