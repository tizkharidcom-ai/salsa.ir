'use strict';

/**
 * Disposable MinIO provider smoke for the D8 S3-compatible artifact adapter.
 * This is stronger than the in-process HTTP harness but is still local
 * provider evidence, not production retention or escrow evidence.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { S3CompatibleBackupArtifactStore } = require('../server/salsa/control-plane/backup/backup-artifact-store');
const { BackupManifestService } = require('../server/salsa/control-plane/backup/backup-manifest-service');
const { InMemoryTestAdapter } = require('../server/salsa/control-plane/db/database');

const CONFIRMATION = 'RUN_NEEM_MINIO_SMOKE';
const image = process.env.NEEM_MINIO_IMAGE || 'minio/minio:latest';
const port = Number(process.env.NEEM_MINIO_PORT || 55470);
const accessKey = 'neem-minio-smoke';
const rootPassword = `neem-root-${process.pid}-${Date.now()}`;

function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) {
    throw new Error(`docker ${args.join(' ')} failed: ${result.stderr || result.error?.message || result.status}`);
  }
  return String(result.stdout || '').trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReady(timeoutMs = 60000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/minio/health/ready`);
      if (response.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`MinIO readiness timed out after ${timeoutMs}ms`);
}

async function main() {
  if (process.env.NEEM_MINIO_CONFIRM !== CONFIRMATION) {
    throw new Error(`Refusing provider smoke without NEEM_MINIO_CONFIRM=${CONFIRMATION}.`);
  }
  if (!Number.isInteger(port) || port < 1024) throw new Error('NEEM_MINIO_PORT must be a valid port.');

  const container = `neem-minio-${Date.now()}-${process.pid}`;
  const checks = [];
  const record = (name, passed, details = null) => {
    checks.push({ name, passed, details: passed ? 'ok' : details });
    assert.equal(passed, true, name);
  };

  try {
    docker([
      'run', '-d', '--name', container,
      '-e', `MINIO_ROOT_USER=${accessKey}`,
      '-e', `MINIO_ROOT_PASSWORD=${rootPassword}`,
      '-p', `127.0.0.1:${port}:9000`,
      image, 'server', '/data', '--address', ':9000'
    ]);
    await waitForReady();

    const keyring = {
      v1: crypto.randomBytes(32).toString('hex'),
      v2: crypto.randomBytes(32).toString('hex')
    };
    const endpoint = `http://127.0.0.1:${port}`;
    const store = new S3CompatibleBackupArtifactStore({
      endpoint,
      bucket: 'neem-backups',
      accessKeyId: accessKey,
      secretAccessKey: rootPassword,
      region: 'ir-thr-1',
      prefix: 'd8-minio-smoke',
      encryptionKeyring: keyring,
      activeKeyId: 'v1',
      allowInsecureLocalhost: true
    });
    await store.request('PUT', '');
    record('real MinIO bucket endpoint is reachable', true);

    const db = new InMemoryTestAdapter();
    const manifests = new BackupManifestService({ db, artifactStore: store, allowFixtureMode: false });
    const manifest = await manifests.createBackupManifest({
      tenantId: 'tenant-minio',
      dbContent: Buffer.from([0x00, 0xff, 0x11, 0x7f]),
      filesContent: Buffer.from('minio-assets'),
      encryptionKeyId: 'v1'
    });
    record('manifest writes encrypted DB and files objects to MinIO',
      await store.exists({ tenantId: 'tenant-minio', manifestId: manifest.id, kind: 'db' }) &&
      await store.exists({ tenantId: 'tenant-minio', manifestId: manifest.id, kind: 'files' }));
    record('manifest verifies by reading real MinIO objects', (await manifests.verifyManifest(manifest.id)).verified === true);

    await assert.rejects(
      store.put({ tenantId: 'tenant-minio', manifestId: manifest.id, kind: 'db', content: 'overwrite-attempt' }),
      /BACKUP_ARTIFACT_IMMUTABLE/
    );
    record('MinIO overwrite attempt is fail-closed', true);

    await manifests.rotateManifestEncryptionKey(manifest.id, 'v2');
    record('key rotation replaces both MinIO objects only through explicit rotation',
      await store.keyId({ tenantId: 'tenant-minio', manifestId: manifest.id, kind: 'db' }) === 'v2' &&
      await store.keyId({ tenantId: 'tenant-minio', manifestId: manifest.id, kind: 'files' }) === 'v2');
    record('rotated MinIO artifacts still verify', (await manifests.verifyManifest(manifest.id)).verified === true);

    const recovered = new S3CompatibleBackupArtifactStore({
      endpoint,
      bucket: 'neem-backups',
      accessKeyId: accessKey,
      secretAccessKey: rootPassword,
      region: 'ir-thr-1',
      prefix: 'd8-minio-smoke',
      encryptionKeyring: { v2: keyring.v2 },
      activeKeyId: 'v2',
      allowInsecureLocalhost: true
    });
    record('new process with only the rotated key recovers DB bytes',
      (await recovered.read({ tenantId: 'tenant-minio', manifestId: manifest.id, kind: 'db' })).equals(Buffer.from([0x00, 0xff, 0x11, 0x7f])));

    const raceResults = await Promise.allSettled([
      store.put({ tenantId: 'tenant-minio', manifestId: 'race-manifest', kind: 'db', content: 'race-a' }),
      store.put({ tenantId: 'tenant-minio', manifestId: 'race-manifest', kind: 'db', content: 'race-b' })
    ]);
    const fulfilled = raceResults.filter((result) => result.status === 'fulfilled');
    const rejected = raceResults.filter((result) => result.status === 'rejected');
    record('concurrent MinIO writers have one immutable winner',
      fulfilled.length === 1 && rejected.length === 1 && /BACKUP_ARTIFACT_IMMUTABLE/.test(rejected[0].reason?.message || ''));

    console.log(JSON.stringify({ ok: true, provider: 'minio-disposable', image, endpoint, checks }, null, 2));
  } catch (error) {
    try { console.error(`--- MinIO logs ---\n${docker(['logs', '--tail=120', container])}`); } catch {}
    throw error;
  } finally {
    try { docker(['rm', '-f', container]); } catch {}
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
