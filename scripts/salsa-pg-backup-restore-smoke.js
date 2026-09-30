'use strict';

/**
 * Disposable PostgreSQL backup/restore gate for D8/D9-B.
 *
 * It performs a real custom-format pg_dump, stores the dump through the
 * encrypted NEEM artifact store, verifies the Control Plane manifest, restores
 * into a newly allocated tenant database, and checks the peer tenant boundary.
 * It requires explicit confirmation and exact source/peer database names.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const CONFIRMATION = 'RUN_NEEM_PG_BACKUP_RESTORE_SMOKE';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function safeDatabaseName(value, label) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`${label} must be a safe PostgreSQL database name.`);
  }
  return value;
}

function connectionParts(rawUrl, databaseOverride = null) {
  const url = new URL(rawUrl);
  const database = databaseOverride || decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  if (!database) throw new Error('PostgreSQL URL must include a database name.');
  return {
    host: url.hostname,
    port: url.port || '5432',
    user: decodeURIComponent(url.username || ''),
    password: decodeURIComponent(url.password || ''),
    database
  };
}

async function createClient(rawUrl, databaseName) {
  const { Client } = require('pg');
  const url = new URL(rawUrl);
  url.pathname = `/${safeDatabaseName(databaseName, 'databaseName')}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  return client;
}

function runPgTool({ tool, operation, connection, container, input = null }) {
  const args = [
    'exec',
    '-e', `PGPASSWORD=${connection.password}`,
    '-i',
    container,
    tool,
    '-h', '127.0.0.1',
    '-p', '5432',
    '-U', connection.user
  ];

  if (operation === 'dump') {
    args.push('--format=custom', '--no-owner', '--no-privileges', '--dbname', connection.database);
  } else {
    args.push('--no-owner', '--no-privileges', '--exit-on-error', '--dbname', connection.database);
  }

  const result = spawnSync('docker', args, {
    input,
    encoding: null,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  if (result.error || result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : String(result.stderr || '');
    throw new Error(`${tool} ${operation} failed: ${stderr || result.error?.message || `exit ${result.status}`}`);
  }
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || '');
}

async function main() {
  if (process.env.NEEM_PG_BACKUP_RESTORE_CONFIRM !== CONFIRMATION) {
    throw new Error(`Refusing backup/restore mutation without NEEM_PG_BACKUP_RESTORE_CONFIRM=${CONFIRMATION}.`);
  }

  const controlUrl = requireEnv('NEEM_CONTROL_DATABASE_URL');
  const dataUrl = requireEnv('NEEM_TENANT_DB_POSTGRES_URL');
  const adminUrl = requireEnv('NEEM_TENANT_DB_ADMIN_URL');
  const sourceTenantId = requireEnv('NEEM_BACKUP_SOURCE_TENANT_ID');
  const sourceDatabase = safeDatabaseName(requireEnv('NEEM_BACKUP_SOURCE_DATABASE'), 'NEEM_BACKUP_SOURCE_DATABASE');
  const peerDatabase = safeDatabaseName(requireEnv('NEEM_BACKUP_PEER_DATABASE'), 'NEEM_BACKUP_PEER_DATABASE');
  const container = requireEnv('NEEM_PG_TOOL_DOCKER_CONTAINER');
  const artifactRoot = path.resolve(requireEnv('NEEM_BACKUP_ARTIFACT_DIR'));
  const encryptionKey = requireEnv('NEEM_BACKUP_ENCRYPTION_KEY');

  // Keep this disposable harness out of production-only config validation;
  // the database adapter and manifest service remain persistent/real.
  process.env.NODE_ENV = 'development';
  process.env.NEEM_SESSION_SECRET ||= 'neem_backup_restore_smoke_session_secret';

  const { getDatabase } = require('../server/salsa/control-plane/db/database');
  const { BackupArtifactStore } = require('../server/salsa/control-plane/backup/backup-artifact-store');
  const { BackupManifestService } = require('../server/salsa/control-plane/backup/backup-manifest-service');
  const { PostgresTenantDatabaseAdapter } = require('../server/salsa/control-plane/tenant/tenant-database-adapter');

  const db = getDatabase();
  const artifactStore = new BackupArtifactStore({ rootDir: artifactRoot, encryptionKey });
  const manifestService = new BackupManifestService({ db, artifactStore, allowFixtureMode: false });
  const adapter = new PostgresTenantDatabaseAdapter({ connectionUrl: dataUrl, adminConnectionUrl: adminUrl });
  const source = await createClient(dataUrl, sourceDatabase);
  const peer = await createClient(dataUrl, peerDatabase);
  const targetTenantId = `restore-${Date.now()}-${process.pid}`;
  const checks = [];
  let targetHandle = null;
  let manifest = null;
  let artifactManifestId = null;
  const sentinelId = `backup_restore_${Date.now()}_${process.pid}`;

  const record = (name, passed, details = null) => {
    checks.push({ name, passed, details: passed ? 'ok' : details });
    assert.equal(passed, true, name);
  };

  try {
    await source.query(
      `INSERT INTO tenant_orders (id, order_number, status, total_amount_cents) VALUES ($1, $2, $3, $4)`,
      [sentinelId, sentinelId, 'paid', 444]
    );
    const sourceRow = await source.query('SELECT id, total_amount_cents FROM tenant_orders WHERE id = $1', [sentinelId]);
    record('source tenant sentinel is present before dump', sourceRow.rows.length === 1 && Number(sourceRow.rows[0].total_amount_cents) === 444, sourceRow.rows);

    const dump = runPgTool({
      tool: 'pg_dump',
      operation: 'dump',
      connection: connectionParts(dataUrl, sourceDatabase),
      container
    });
    record('custom-format pg_dump produced a non-empty artifact', dump.length > 0, { bytes: dump.length });

    const filesContent = Buffer.from(JSON.stringify({ tenantId: sourceTenantId, files: [] }), 'utf8');
    manifest = await manifestService.createBackupManifest({
      tenantId: sourceTenantId,
      scope: 'tenant',
      epoch: 1,
      dbContent: dump,
      filesContent,
      configSnapshot: { sourceDatabase, tool: 'pg_dump-custom' },
      encryptionKeyId: 'smoke-key-v1'
    });
    artifactManifestId = manifest.id;
    record('encrypted database artifact exists', await artifactStore.exists({ tenantId: sourceTenantId, manifestId: manifest.id, kind: 'db' }));
    const restoredArtifact = await artifactStore.read({ tenantId: sourceTenantId, manifestId: manifest.id, kind: 'db' });
    record('encrypted artifact decrypts byte-for-byte', crypto.createHash('sha256').update(restoredArtifact).digest('hex') === crypto.createHash('sha256').update(dump).digest('hex'));
    const verifiedManifest = await manifestService.verifyManifest(manifest.id);
    record('Control Plane manifest verifies the real dump artifact', verifiedManifest.verified === true, verifiedManifest);

    targetHandle = await adapter.allocateDatabase({ tenantId: targetTenantId, cellId: 'cell-teh-restore' });
    record('restore target is a distinct postgres database', targetHandle.provider === 'postgres' && targetHandle.databaseName !== sourceDatabase && targetHandle.databaseName !== peerDatabase, targetHandle);
    const targetConnection = connectionParts(dataUrl, targetHandle.databaseName);
    const targetDump = runPgTool({
      tool: 'pg_restore',
      operation: 'restore',
      connection: targetConnection,
      container,
      input: restoredArtifact
    });
    record('pg_restore completed without errors', targetDump.length === 0, { stdoutBytes: targetDump.length });

    const target = await createClient(dataUrl, targetHandle.databaseName);
    try {
      const targetTable = await target.query(`SELECT to_regclass('public.tenant_orders') AS table_name`);
      const targetRow = await target.query('SELECT id, total_amount_cents FROM tenant_orders WHERE id = $1', [sentinelId]);
      const identity = await target.query(`SELECT current_user, has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_database`);
      record('restored target schema exists', targetTable.rows[0]?.table_name === 'tenant_orders', targetTable.rows);
      record('restored target contains source sentinel', targetRow.rows.length === 1 && Number(targetRow.rows[0].total_amount_cents) === 444, targetRow.rows);
      record('restored target uses runtime role without CREATEDB', identity.rows[0]?.current_user === connectionParts(dataUrl).user && identity.rows[0]?.can_create_database === false, identity.rows[0]);
    } finally {
      await target.end();
    }

    const peerRow = await peer.query('SELECT id FROM tenant_orders WHERE id = $1', [sentinelId]);
    record('peer tenant does not observe restored sentinel', peerRow.rows.length === 0, peerRow.rows);
    console.log(JSON.stringify({ ok: true, checks, sourceDatabase, targetDatabase: targetHandle.databaseName, peerDatabase, manifestId: manifest.id }, null, 2));
  } finally {
    await source.query('DELETE FROM tenant_orders WHERE id = $1', [sentinelId]).catch(() => {});
    await source.end().catch(() => {});
    await peer.end().catch(() => {});
    if (targetHandle) await adapter.dropDatabase(targetHandle).catch(() => {});
    if (manifest) await db.query('DELETE FROM neem_backup_manifests WHERE id = $1', [manifest.id]).catch(() => {});
    if (artifactManifestId) {
      await fs.rm(path.join(artifactRoot, sourceTenantId, artifactManifestId), { recursive: true, force: true }).catch(() => {});
    }
    await db.end?.().catch?.(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
