// server/salsa/control-plane/routes/backup-routes.js
'use strict';

const express = require('express');
const router = express.Router();
const { BackupManifestService } = require('../backup/backup-manifest-service');
const { RestoreReconciliationService } = require('../backup/restore-reconciliation-service');
const { getDatabase } = require('../db/database');
const { authenticatePlatform, requirePlatformRole } = require('../auth/auth-middleware');
const { createArtifactStoreFromEnvironment } = require('../backup/backup-artifact-store');

const artifactStore = createArtifactStoreFromEnvironment();
const manifestService = new BackupManifestService({ artifactStore });
const restoreService = new RestoreReconciliationService({ artifactStore });
const db = getDatabase();

// Authenticate all backup management routes
router.use(authenticatePlatform);

/**
 * POST /api/control/backups/manifests
 */
router.post('/manifests', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res, next) => {
  try {
    const { tenant_id, scope, epoch, db_content, files_content, config_snapshot, retention_tier } = req.body;
    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_TENANT_ID', message: 'tenant_id is required' }
      });
    }

    const manifest = await manifestService.createBackupManifest({
      tenantId: tenant_id,
      scope,
      epoch,
      dbContent: db_content || '',
      filesContent: files_content || '',
      configSnapshot: config_snapshot || {},
      retentionTier: retention_tier || 'daily'
    });

    return res.status(201).json({
      success: true,
      data: manifest
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/control/backups/verify
 */
router.post('/verify', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res, next) => {
  try {
    const { manifest_id, simulated_artifacts } = req.body;
    if (!manifest_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_MANIFEST_ID', message: 'manifest_id is required' }
      });
    }

    const verification = await manifestService.verifyManifest(manifest_id, simulated_artifacts || {});
    return res.status(200).json({
      success: true,
      data: verification
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/control/backups/restore-drill
 */
router.post('/restore-drill', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res, next) => {
  try {
    const { manifest_id, target_tenant_id } = req.body;
    if (!manifest_id || !target_tenant_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_REQUIRED_FIELDS', message: 'manifest_id and target_tenant_id are required' }
      });
    }

    const drill = await restoreService.executeIsolatedRestoreDrill({
      manifestId: manifest_id,
      targetTenantId: target_tenant_id,
      executedBy: req.platformPrincipal?.id || 'platform_ops_dr'
    });

    return res.status(200).json({
      success: true,
      data: drill
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/control/backups/manifests
 */
router.get('/manifests', requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support', 'platform_readonly']), async (req, res, next) => {
  try {
    const tenantId = req.query.tenant_id;
    const query = tenantId
      ? `SELECT * FROM neem_backup_manifests WHERE tenant_id = $1 ORDER BY created_at DESC`
      : `SELECT * FROM neem_backup_manifests ORDER BY created_at DESC`;
    const params = tenantId ? [tenantId] : [];
    const result = await db.query(query, params);

    return res.status(200).json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    next(err);
  }
});

router.get('/dr-status', requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support', 'platform_readonly']), async (req, res, next) => {
  try {
    const tenantId = req.query.tenant_id || req.query.tenantId;
    const query = tenantId
      ? `SELECT * FROM neem_backup_manifests WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`
      : `SELECT * FROM neem_backup_manifests ORDER BY created_at DESC LIMIT 1`;
    const params = tenantId ? [tenantId] : [];
    const [latestResult, countResult] = await Promise.all([
      db.query(query, params),
      db.query(
        tenantId
          ? `SELECT COUNT(*) AS total_count FROM neem_backup_manifests WHERE tenant_id = $1`
          : `SELECT COUNT(*) AS total_count FROM neem_backup_manifests`,
        params
      )
    ]);
    const latest = (latestResult.rows || []).slice().sort((a, b) =>
      new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    )[0] || null;
    const countRows = countResult.rows || [];
    const rawCount = countRows.length === 1 ? countRows[0]?.total_count : null;
    const parsedCount = rawCount === null || rawCount === undefined ? NaN : Number(rawCount);
    // The in-memory development adapter returns matching rows for COUNT queries.
    const snapshotCount = Number.isSafeInteger(parsedCount) && parsedCount >= 0
      ? parsedCount
      : (countRows.length > 0 && countRows.every(row => row && row.id && row.tenant_id) ? countRows.length : null);
    const latestManifest = latest ? {
      id: latest.id ?? null,
      tenant_id: latest.tenant_id ?? null,
      scope: latest.scope ?? null,
      epoch: latest.epoch ?? null,
      status: latest.status ?? null,
      created_at: latest.created_at ?? null,
      expires_at: latest.expires_at ?? null,
      retention_tier: latest.retention_tier ?? null,
      size_bytes: latest.size_bytes ?? null,
      encryption_key_id: latest.encryption_key_id ?? null,
      db_dump_ref: latest.db_dump_ref ?? null,
      db_checksum_sha256: latest.db_checksum_sha256 ?? null,
      files_ref: latest.files_ref ?? null,
      files_checksum_sha256: latest.files_checksum_sha256 ?? null
    } : null;

    return res.status(200).json({
      success: true,
      data: {
        status: 'blocked',
        statusReason: 'شواهد معتبر عملیاتی برای سنجش آمادگی بازیابی به این endpoint متصل نیست.',
        rpoMinutes: null,
        rtoMinutes: null,
        pitrCapable: null,
        walStreamingStatus: 'unknown',
        primaryStorageProvider: null,
        offsiteStorageProvider: null,
        offsiteSynced: null,
        lastWalFlushAt: null,
        encryptionStandard: null,
        hashVerification: 'unknown',
        retentionPolicyDays: null,
        latestSnapshotTime: latest?.created_at ?? null,
        totalSnapshotsCount: snapshotCount,
        drReadinessScore: null,
        evidence: {
          source: 'neem_backup_manifests',
          tenant_id: tenantId || null,
          snapshot_count_status: snapshotCount === null ? 'unknown' : 'observed',
          latest_manifest: latestManifest,
          unavailable: [
            'rpoMinutes', 'rtoMinutes', 'pitrCapable', 'walStreamingStatus',
            'primaryStorageProvider', 'offsiteStorageProvider', 'offsiteSynced',
            'lastWalFlushAt', 'encryptionStandard', 'hashVerification',
            'retentionPolicyDays', 'drReadinessScore'
          ]
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

router.get('/', requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support', 'platform_readonly']), async (req, res, next) => {
  try {
    const tenantId = req.query.tenant_id || req.query.tenantId;
    const query = tenantId
      ? `SELECT * FROM neem_backup_manifests WHERE tenant_id = $1 ORDER BY created_at DESC`
      : `SELECT * FROM neem_backup_manifests ORDER BY created_at DESC`;
    const params = tenantId ? [tenantId] : [];
    const result = await db.query(query, params);

    return res.status(200).json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
