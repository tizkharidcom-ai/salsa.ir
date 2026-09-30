#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadTenantConfig } = require('../server/salsa/tenant-config');

function parseDatabaseUrl(connectionString) {
  if (!connectionString) {
    const error = new Error('DATABASE_URL is required. No PostgreSQL backup was attempted.');
    error.code = 'database_url_required';
    throw error;
  }
  let url;
  try { url = new URL(connectionString); } catch {
    const error = new Error('DATABASE_URL is not a valid PostgreSQL connection URL.');
    error.code = 'database_url_invalid';
    throw error;
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    const error = new Error('DATABASE_URL must use the PostgreSQL protocol.');
    error.code = 'database_url_invalid';
    throw error;
  }
  return {
    host: url.hostname || '127.0.0.1',
    port: url.port || '5432',
    user: decodeURIComponent(url.username || ''),
    password: decodeURIComponent(url.password || ''),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
  };
}

function stamp(value = new Date()) {
  return value.toISOString().replace(/[:.]/g, '-');
}

function buildBackupPlan({ outputRoot, databaseUrl, now = new Date(), tenantConfig = loadTenantConfig() } = {}) {
  const database = parseDatabaseUrl(databaseUrl);
  const root = path.resolve(outputRoot || path.join(__dirname, '..', 'artifacts', 'finance-v2', 'postgres-backups'));
  const base = stamp(now);
  let outputDir = path.join(root, base);
  let suffix = 1;
  while (fs.existsSync(outputDir)) outputDir = path.join(root, `${base}-${suffix++}`);
  return {
    outputDir,
    outputPath: path.join(outputDir, 'finance-v2.dump'),
    manifestPath: path.join(outputDir, 'manifest.json'),
    createdAt: now.toISOString(),
    tenant: {
      tenantId: tenantConfig.tenantId,
      canonicalDomain: tenantConfig.canonicalDomain,
      cellId: tenantConfig.cellId,
    },
    database: { host: database.host, port: database.port, name: database.database, user: database.user },
    connection: database,
  };
}

function runBackup({ plan, dumpCommand = process.env.WESTO_PG_DUMP_BIN || 'pg_dump', environment = process.env } = {}) {
  if (!plan?.outputPath || !plan?.manifestPath) throw new Error('A complete PostgreSQL backup plan is required.');
  fs.mkdirSync(plan.outputDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(plan.outputDir, 0o700);
  const childEnvironment = { ...environment };
  for (const key of ['host', 'port', 'user', 'password', 'database']) {
    const value = plan.connection?.[key];
    if (value) childEnvironment[`PG${key === 'host' ? 'HOST' : key === 'port' ? 'PORT' : key === 'user' ? 'USER' : key === 'password' ? 'PASSWORD' : 'DATABASE'}`] = value;
  }
  if (environment.DATABASE_SSL === 'false') childEnvironment.PGSSLMODE = 'disable';
  const dockerContainer = String(environment.WESTO_PG_DUMP_DOCKER_CONTAINER || '').trim();
  const command = dockerContainer ? 'docker' : dumpCommand;
  const args = dockerContainer
    ? ['exec', '-i', dockerContainer, 'sh', '-c', 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom -U "$POSTGRES_USER" -d "$POSTGRES_DB"']
    : ['--format=custom', '--file', plan.outputPath];
  const result = spawnSync(command, args, {
    env: childEnvironment,
    encoding: null,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    try { fs.unlinkSync(plan.outputPath); } catch {}
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : result.stderr;
    const error = new Error(String(stderr || result.error?.message || `${command} exited with ${result.status}`));
    error.code = result.error?.code || 'finance_postgres_backup_failed';
    throw error;
  }
  if (dockerContainer) {
    if (!result.stdout?.length) {
      const error = new Error('pg_dump returned an empty backup.');
      error.code = 'finance_postgres_backup_empty';
      throw error;
    }
    fs.writeFileSync(plan.outputPath, result.stdout, { mode: 0o600, flag: 'wx' });
  }
  fs.chmodSync(plan.outputPath, 0o600);
  const dump = fs.readFileSync(plan.outputPath);
  const manifest = {
    schemaVersion: 1,
    createdAt: plan.createdAt,
    tenant: plan.tenant,
    database: plan.database,
    tool: 'pg_dump',
    format: 'custom',
    artifact: { file: path.basename(plan.outputPath), bytes: dump.length, sha256: crypto.createHash('sha256').update(dump).digest('hex') },
  };
  fs.writeFileSync(plan.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return { ...plan, manifest, backupReference: plan.manifestPath };
}

function main() {
  const plan = buildBackupPlan({
    outputRoot: process.env.WESTO_FINANCE_BACKUP_DIR,
    databaseUrl: process.env.DATABASE_URL,
    tenantConfig: loadTenantConfig(),
  });
  const result = runBackup({ plan });
  process.stdout.write(`${JSON.stringify({ ok: true, backupReference: result.backupReference, manifest: result.manifest }, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'finance_postgres_backup_failed', error: error.message }, null, 2)}\n`);
    process.exitCode = error.code === 'database_url_required' || error.code === 'database_url_invalid' ? 2 : 1;
  }
}

module.exports = { parseDatabaseUrl, stamp, buildBackupPlan, runBackup, main };
