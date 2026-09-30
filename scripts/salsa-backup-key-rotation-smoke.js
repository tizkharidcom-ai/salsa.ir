'use strict';

process.env.NODE_ENV = 'test';
process.env.NEEM_ENV = 'test';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { InMemoryTestAdapter } = require('../server/salsa/control-plane/db/database');
const { BackupArtifactStore } = require('../server/salsa/control-plane/backup/backup-artifact-store');
const { BackupManifestService } = require('../server/salsa/control-plane/backup/backup-manifest-service');

async function main() {
  const rootDir = await fs.mkdtemp('/private/tmp/neem-backup-key-rotation-smoke-');
  const db = new InMemoryTestAdapter();
  const keyring = {
    v1: crypto.randomBytes(32).toString('hex'),
    v2: crypto.randomBytes(32).toString('hex')
  };
  try {
    const store = new BackupArtifactStore({ rootDir, encryptionKeyring: keyring, activeKeyId: 'v1' });
    const manifests = new BackupManifestService({ db, artifactStore: store });
    const dbContent = Buffer.from([0x00, 0xff, 0x01, 0x7f]);
    const filesContent = Buffer.from('neem-assets-v1');
    const manifest = await manifests.createBackupManifest({
      tenantId: 'smoke-rotation',
      dbContent,
      filesContent
    });
    const before = await manifests.verifyManifest(manifest.id);
    await manifests.rotateManifestEncryptionKey(manifest.id, 'v2');
    const after = await manifests.verifyManifest(manifest.id);
    const recovered = new BackupArtifactStore({
      rootDir,
      encryptionKeyring: { v2: keyring.v2 },
      activeKeyId: 'v2'
    });
    const recoveredDb = await recovered.read({ tenantId: 'smoke-rotation', manifestId: manifest.id, kind: 'db' });
    const result = {
      ok: before.verified && after.verified && Buffer.compare(recoveredDb, dbContent) === 0,
      checks: [
        ['manifest_verified_before_rotation', before.verified],
        ['db_artifact_rewrapped_to_v2', await store.keyId({ tenantId: 'smoke-rotation', manifestId: manifest.id, kind: 'db' }) === 'v2'],
        ['files_artifact_rewrapped_to_v2', await store.keyId({ tenantId: 'smoke-rotation', manifestId: manifest.id, kind: 'files' }) === 'v2'],
        ['manifest_verified_after_rotation', after.verified],
        ['recovery_with_new_key_only', Buffer.compare(recoveredDb, dbContent) === 0]
      ],
      manifest_id: manifest.id,
      active_key_id: store.activeKeyId
    };
    result.passed = result.checks.filter(([, passed]) => passed).length;
    result.total = result.checks.length;
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok || result.passed !== result.total) process.exitCode = 1;
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exitCode = 1;
});
