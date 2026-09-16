// server/neem/control-plane/backup/backup-manifest-service.js
'use strict';

const crypto = require('crypto');
const { getDatabase } = require('../db/database');
const { sha256 } = require('../auth/crypto-util');
const { createArtifactStoreFromEnvironment } = require('./backup-artifact-store');
const config = require('../config');

class BackupManifestService {
  constructor({ db = getDatabase(), artifactStore = createArtifactStoreFromEnvironment(), allowFixtureMode = null } = {}) {
    this.db = db;
    this.artifactStore = artifactStore;
    this.allowFixtureMode = allowFixtureMode === null
      ? (config.isTest || config.allowEphemeralDev)
      : Boolean(allowFixtureMode);
    if (!this.artifactStore && !this.allowFixtureMode) {
      throw new Error('FAIL-CLOSED: persistent backup manifests require an encrypted artifact destination and key material.');
    }
  }

  /**
   * Generates an encrypted backup manifest containing DB, files, and config
   */
  async createBackupManifest({
    tenantId,
    scope = 'tenant',
    epoch = 1,
    dbContent = '',
    filesContent = '',
    configSnapshot = {},
    retentionTier = 'daily',
    encryptionKeyId = null
  }) {
    const manifestId = `bck_${crypto.randomUUID().slice(0, 8)}`;
    const effectiveEncryptionKeyId = this.artifactStore
      ? this.artifactStore.assertKeyAvailable(encryptionKeyId || this.artifactStore.activeKeyId)
      : (encryptionKeyId || 'neem_key_dr_2026_01');
    
    // Checksums
    const dbChecksum = sha256(dbContent);
    const filesChecksum = sha256(filesContent);

    // Retention duration
    let retentionDays = 30;
    if (retentionTier === 'weekly') retentionDays = 90;
    if (retentionTier === 'monthly') retentionDays = 365;
    if (retentionTier === 'permanent') retentionDays = 3650;

    const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);
    const totalSizeBytes = Buffer.byteLength(dbContent, 'utf8') + Buffer.byteLength(filesContent, 'utf8');

    const manifest = {
      id: manifestId,
      tenant_id: tenantId,
      scope,
      epoch,
      db_dump_ref: this.artifactStore
        ? this.artifactStore.ref({ tenantId, manifestId, kind: 'db' })
        : `s3://neem-backups/${tenantId}/${manifestId}/database.sql.enc`,
      db_checksum_sha256: dbChecksum,
      files_ref: this.artifactStore
        ? this.artifactStore.ref({ tenantId, manifestId, kind: 'files' })
        : `s3://neem-backups/${tenantId}/${manifestId}/storage_assets.tar.gz.enc`,
      files_checksum_sha256: filesChecksum,
      config_snapshot: configSnapshot,
      encryption_key_id: effectiveEncryptionKeyId,
      status: 'pending',
      retention_tier: retentionTier,
      size_bytes: totalSizeBytes,
      created_at: new Date(),
      expires_at: expiresAt
    };

    if (this.artifactStore) {
      await this.artifactStore.put({ tenantId, manifestId, kind: 'db', content: dbContent, keyId: effectiveEncryptionKeyId });
      await this.artifactStore.put({ tenantId, manifestId, kind: 'files', content: filesContent, keyId: effectiveEncryptionKeyId });
    }

    try {
      await this.db.query(
        `INSERT INTO neem_backup_manifests (id, tenant_id, scope, epoch, db_dump_ref, db_checksum_sha256, files_ref, files_checksum_sha256, config_snapshot, encryption_key_id, status, retention_tier, size_bytes, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          manifest.id,
          manifest.tenant_id,
          manifest.scope,
          manifest.epoch,
          manifest.db_dump_ref,
          manifest.db_checksum_sha256,
          manifest.files_ref,
          manifest.files_checksum_sha256,
          JSON.stringify(manifest.config_snapshot),
          manifest.encryption_key_id,
          manifest.status,
          manifest.retention_tier,
          manifest.size_bytes,
          manifest.created_at,
          manifest.expires_at
        ]
      );
    } catch (err) {
      throw err;
    }

    return manifest;
  }

  /**
   * Validates manifest integrity: verifies both DB dump and files archive (AC-49)
   */
  async verifyManifest(manifestId, simulatedActualArtifacts = {}) {
    const res = await this.db.query(
      `SELECT * FROM neem_backup_manifests WHERE id = $1`,
      [manifestId]
    );

    if (res.rows.length === 0) {
      throw new Error(`Backup manifest ${manifestId} not found`);
    }

    const manifest = res.rows[0];

    // In artifact-backed mode, verification reads and decrypts the actual
    // stored objects. The simulated checksum argument remains supported only
    // for legacy/unit fixtures that do not have an artifact store.
    let actualDbChecksum;
    let actualFilesChecksum;
    let actualDbKeyId;
    let actualFilesKeyId;
    if (this.artifactStore) {
      try {
        actualDbChecksum = await this.artifactStore.checksum({ tenantId: manifest.tenant_id, manifestId, kind: 'db' });
        actualFilesChecksum = await this.artifactStore.checksum({ tenantId: manifest.tenant_id, manifestId, kind: 'files' });
        actualDbKeyId = await this.artifactStore.keyId({ tenantId: manifest.tenant_id, manifestId, kind: 'db' });
        actualFilesKeyId = await this.artifactStore.keyId({ tenantId: manifest.tenant_id, manifestId, kind: 'files' });
      } catch (err) {
        await this.db.query(`UPDATE neem_backup_manifests SET status = 'corrupt' WHERE id = $1`, [manifestId]);
        return {
          verified: false,
          reason: 'MANIFEST_VERIFICATION_FAILED: Database or storage artifact is missing, unreadable, or authentication failed',
          details: { error: err.message }
        };
      }
    } else {
      // Legacy/unit fixtures may not have a filesystem-backed artifact store.
      // Keep their simulated verification contract, but never allow it to
      // override real artifacts when the store is configured.
      actualDbChecksum = simulatedActualArtifacts.db_checksum;
      actualFilesChecksum = simulatedActualArtifacts.files_checksum;
    }

    if (this.artifactStore &&
        (actualDbKeyId !== manifest.encryption_key_id || actualFilesKeyId !== manifest.encryption_key_id)) {
      await this.db.query(`UPDATE neem_backup_manifests SET status = 'corrupt' WHERE id = $1`, [manifestId]);
      return {
        verified: false,
        reason: 'MANIFEST_VERIFICATION_FAILED: Artifact key id does not match the manifest key id',
        details: {
          expected: manifest.encryption_key_id,
          database_artifact: actualDbKeyId,
          files_artifact: actualFilesKeyId
        }
      };
    }

    // AC-49: Check if database artifact exists and matches checksum
    if (!actualDbChecksum || actualDbChecksum !== manifest.db_checksum_sha256) {
      await this.db.query(`UPDATE neem_backup_manifests SET status = 'corrupt' WHERE id = $1`, [manifestId]);
      return {
        verified: false,
        reason: 'MANIFEST_VERIFICATION_FAILED: Database dump artifact corrupted or missing',
        details: { expected: manifest.db_checksum_sha256, actual: actualDbChecksum }
      };
    }

    // AC-49: Check if referenced file archive exists and matches checksum
    if (!actualFilesChecksum || actualFilesChecksum !== manifest.files_checksum_sha256) {
      await this.db.query(`UPDATE neem_backup_manifests SET status = 'corrupt' WHERE id = $1`, [manifestId]);
      return {
        verified: false,
        reason: 'MANIFEST_VERIFICATION_FAILED: Referenced storage files artifact missing or checksum mismatch',
        details: { expected: manifest.files_checksum_sha256, actual: actualFilesChecksum }
      };
    }

    // All artifacts present and intact
    await this.db.query(`UPDATE neem_backup_manifests SET status = 'verified' WHERE id = $1`, [manifestId]);
    return {
      verified: true,
      status: 'verified',
      manifest_id: manifestId,
      verified_at: new Date().toISOString()
    };
  }

  async rotateManifestEncryptionKey(manifestId, newEncryptionKeyId) {
    if (!this.artifactStore) {
      const err = new Error('BACKUP_KEY_ROTATION_REQUIRES_ARTIFACT_STORE');
      err.code = 'BACKUP_KEY_ROTATION_REQUIRES_ARTIFACT_STORE';
      err.status = 503;
      throw err;
    }
    const res = await this.db.query('SELECT * FROM neem_backup_manifests WHERE id = $1', [manifestId]);
    if (!res.rows.length) throw new Error(`Backup manifest ${manifestId} not found`);
    const manifest = res.rows[0];
    this.artifactStore.assertKeyAvailable(newEncryptionKeyId);

    await this.artifactStore.rotate({ tenantId: manifest.tenant_id, manifestId, kind: 'db', newKeyId: newEncryptionKeyId });
    await this.artifactStore.rotate({ tenantId: manifest.tenant_id, manifestId, kind: 'files', newKeyId: newEncryptionKeyId });
    const update = await this.db.query(
      'UPDATE neem_backup_manifests SET encryption_key_id = $1 WHERE id = $2',
      [newEncryptionKeyId, manifestId]
    );
    return update.rows?.[0] || { ...manifest, encryption_key_id: newEncryptionKeyId };
  }
}

module.exports = {
  BackupManifestService
};
