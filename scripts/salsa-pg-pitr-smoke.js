'use strict';

/**
 * Disposable PostgreSQL physical PITR/WAL drill for D9-B.
 *
 * This is deliberately separate from the logical pg_dump/pg_restore drill.
 * It starts an isolated PostgreSQL instance with WAL archiving enabled, takes
 * a physical base backup, writes events before and after a recovery target,
 * and restores a second instance to that target. The original instance and
 * all generated files are removed in finally.
 */

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');

const CONFIRMATION = 'RUN_NEEM_PG_PITR_SMOKE';
const IMAGE = process.env.NEEM_PG_PITR_IMAGE || 'postgres:16-alpine';
const sourcePort = Number(process.env.NEEM_PG_PITR_SOURCE_PORT || 55460);
const restorePort = Number(process.env.NEEM_PG_PITR_RESTORE_PORT || 55461);

function runDocker(args, { input = null } = {}) {
  const result = spawnSync('docker', args, {
    input,
    encoding: null,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout.toString('utf8') : String(result.stdout || '');
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : String(result.stderr || '');
  if (result.error || result.status !== 0) {
    throw new Error(`docker ${args.join(' ')} failed: ${stderr || result.error?.message || `exit ${result.status}`}`);
  }
  return stdout.trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(label, predicate, timeoutMs = 60000, intervalMs = 500) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms${lastError ? `: ${lastError.message}` : ''}`);
}

async function connect(port, password) {
  const client = new Client({
    host: '127.0.0.1',
    port,
    user: 'postgres',
    password,
    database: 'postgres'
  });
  await client.connect();
  return client;
}

async function waitForPostgres(port, password) {
  let client = null;
  await waitFor(`PostgreSQL ${port}`, async () => {
    try {
      client = await connect(port, password);
      await client.query('SELECT 1');
      return true;
    } catch {
      await client?.end().catch(() => {});
      client = null;
      return false;
    }
  });
  return client;
}

async function listFiles(directory) {
  return (await fs.readdir(directory)).filter((entry) => !entry.startsWith('.'));
}

async function extractArchive(archivePath, destination) {
  runDocker(['run', '--rm', '-v', `${destination}:/extract`, '-v', `${archivePath}:/archive:ro`, 'alpine:3.20',
    'tar', '-xzf', '/archive', '-C', '/extract']);
}

async function main() {
  if (process.env.NEEM_PG_PITR_CONFIRM !== CONFIRMATION) {
    throw new Error(`Refusing physical PITR mutation without NEEM_PG_PITR_CONFIRM=${CONFIRMATION}.`);
  }
  if (!Number.isInteger(sourcePort) || !Number.isInteger(restorePort) || sourcePort < 1024 || restorePort < 1024 || sourcePort === restorePort) {
    throw new Error('NEEM_PG_PITR_SOURCE_PORT and NEEM_PG_PITR_RESTORE_PORT must be distinct valid ports.');
  }

  const rootDir = await fs.mkdtemp('/private/tmp/neem-pg-pitr-');
  const walDir = path.join(rootDir, 'wal');
  const baseDir = path.join(rootDir, 'base');
  const restoreDir = path.join(rootDir, 'restore');
  await Promise.all([walDir, baseDir, restoreDir].map(async (directory) => {
    await fs.mkdir(directory, { recursive: true, mode: 0o777 });
    await fs.chmod(directory, 0o777);
  }));

  const suffix = `${Date.now()}-${process.pid}`;
  const sourceName = `neem-pitr-source-${suffix}`;
  const restoreName = `neem-pitr-restore-${suffix}`;
  const password = `pitr_${process.pid}_${Date.now()}`;
  const keepArtifacts = process.env.NEEM_PG_PITR_KEEP_ARTIFACTS === 'true';
  const checks = [];
  const record = (name, passed, details = null) => {
    checks.push({ name, passed, details: passed ? 'ok' : details });
    assert.equal(passed, true, name);
  };
  let source = null;
  let restored = null;

  try {
    runDocker([
      'run', '-d', '--name', sourceName,
      '-e', `POSTGRES_PASSWORD=${password}`,
      '-p', `127.0.0.1:${sourcePort}:5432`,
      '-v', `${walDir}:/wal`,
      '-v', `${baseDir}:/base`,
      IMAGE, 'postgres',
      '-c', 'wal_level=replica',
      '-c', 'archive_mode=on',
      '-c', 'archive_timeout=1s',
      '-c', 'archive_command=test ! -f /wal/%f && cp %p /wal/%f'
    ]);

    source = await waitForPostgres(sourcePort, password);
    await source.query(`CREATE TABLE IF NOT EXISTS neem_pitr_events (
      event_id TEXT PRIMARY KEY,
      event_value TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
    )`);
    await source.query(`INSERT INTO neem_pitr_events (event_id, event_value) VALUES ('before-target', 'baseline')`);

    runDocker(['exec', '-e', `PGPASSWORD=${password}`, '-u', 'postgres', sourceName,
      'pg_basebackup', '-h', '127.0.0.1', '-p', '5432', '-U', 'postgres', '-D', '/base', '-Ft', '-X', 'stream', '-z']);
    const baseFiles = await listFiles(baseDir);
    record('physical pg_basebackup produced base and WAL archives', baseFiles.some((file) => file.startsWith('base.tar')) && baseFiles.some((file) => file.startsWith('pg_wal.tar')), baseFiles);

    await source.query(`INSERT INTO neem_pitr_events (event_id, event_value) VALUES ('after-target-1', 'must-survive')`);
    const targetResult = await source.query('SELECT clock_timestamp() AS recovery_target');
    const recoveryTarget = targetResult.rows[0].recovery_target.toISOString().replace('T', ' ').replace('Z', '+00');
    await sleep(2500);
    await source.query(`INSERT INTO neem_pitr_events (event_id, event_value) VALUES ('after-target-2', 'must-not-survive')`);
    await source.query('SELECT pg_switch_wal()');

    let archivedCount = 0;
    await waitFor('WAL archive', async () => {
      const result = await source.query('SELECT archived_count FROM pg_stat_archiver');
      archivedCount = Number(result.rows[0]?.archived_count || 0);
      return archivedCount > 0;
    });
    const walFiles = await listFiles(walDir);
    record('WAL archive contains at least one completed segment', walFiles.length > 0 && archivedCount > 0, { archivedCount, walFiles });

    const baseArchive = path.join(baseDir, baseFiles.find((file) => file.startsWith('base.tar')));
    const walArchive = path.join(baseDir, baseFiles.find((file) => file.startsWith('pg_wal.tar')));
    await extractArchive(baseArchive, restoreDir);
    await extractArchive(walArchive, restoreDir);
    await fs.writeFile(path.join(restoreDir, 'postgresql.auto.conf'), [
      `restore_command = 'cp /wal/%f %p'`,
      `recovery_target_time = '${recoveryTarget}'`,
      `recovery_target_action = 'promote'`,
      ''
    ].join('\n'), { mode: 0o600 });
    await fs.writeFile(path.join(restoreDir, 'recovery.signal'), '', { mode: 0o600 });
    runDocker(['run', '--rm', '-v', `${restoreDir}:/data`, 'alpine:3.20', 'chown', '-R', '999:999', '/data']);

    runDocker([
      'run', '-d', '--name', restoreName,
      '-e', `POSTGRES_PASSWORD=${password}`,
      '-p', `127.0.0.1:${restorePort}:5432`,
      '-v', `${restoreDir}:/var/lib/postgresql/data`,
      '-v', `${walDir}:/wal:ro`,
      IMAGE, 'postgres',
      '-c', 'logging_collector=off',
      '-c', 'log_destination=stderr'
    ]);
    restored = await waitForPostgres(restorePort, password);
    const targetRows = await restored.query('SELECT event_id, event_value FROM neem_pitr_events ORDER BY event_id');
    const byId = new Map(targetRows.rows.map((row) => [row.event_id, row.event_value]));
    record('PITR restored the baseline event', byId.get('before-target') === 'baseline', targetRows.rows);
    record('PITR retained the event before the recovery target', byId.get('after-target-1') === 'must-survive', targetRows.rows);
    record('PITR excluded the event after the recovery target', !byId.has('after-target-2'), targetRows.rows);
    const recoveryState = await restored.query(`SELECT pg_is_in_recovery() AS recovering, current_setting('archive_mode') AS archive_mode`);
    record('PITR promoted the restored instance after recovery', recoveryState.rows[0]?.recovering === false, recoveryState.rows[0]);

    console.log(JSON.stringify({ ok: true, image: IMAGE, sourcePort, restorePort, recoveryTarget, archivedCount, checks }, null, 2));
  } catch (error) {
    for (const name of [sourceName, restoreName]) {
      try {
        console.error(`--- ${name} state ---\n${runDocker(['inspect', '--format', '{{json .State}}', name])}`);
      } catch {}
      try {
        console.error(`--- ${name} logs ---\n${runDocker(['logs', '--tail=120', name])}`);
      } catch {}
      try {
        console.error(`--- ${name} data logs ---\n${runDocker(['exec', name, 'sh', '-c', 'for file in /var/lib/postgresql/data/log/*; do [ -f "$file" ] && tail -80 "$file"; done'])}`);
      } catch {}
    }
    throw error;
  } finally {
    await source?.end().catch(() => {});
    await restored?.end().catch(() => {});
    try { runDocker(['rm', '-f', restoreName]); } catch {}
    try { runDocker(['rm', '-f', sourceName]); } catch {}
    if (keepArtifacts) console.error(`PITR artifacts preserved at ${rootDir}`);
    else await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
