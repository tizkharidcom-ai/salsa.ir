// server/neem/control-plane/routes/release-routes.js
'use strict';

const express = require('express');
const router = express.Router();
const { ReleaseCanaryService } = require('../releases/release-canary-service');
const { getDatabase } = require('../db/database');
const { authenticatePlatform, requirePlatformRole } = require('../auth/auth-middleware');

const releaseService = new ReleaseCanaryService();
const db = getDatabase();

// All release and incident management requires platform authentication
router.use(authenticatePlatform);

/**
 * POST /api/control/releases
 */
router.post('/releases', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res, next) => {
  try {
    const { version, manifest_checksum, git_commit_sha, min_compatible_edge_version, release_notes } = req.body || {};
    if (!version || !manifest_checksum || !git_commit_sha) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_REQUIRED_FIELDS', message: 'version, manifest_checksum, git_commit_sha required' }
      });
    }

    const release = await releaseService.createRelease({
      version,
      manifestChecksum: manifest_checksum,
      gitCommitSha: git_commit_sha,
      minCompatibleEdgeVersion: min_compatible_edge_version,
      releaseNotes: release_notes
    });

    return res.status(201).json({
      success: true,
      data: release
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/control/releases/:version/waves
 */
router.post('/releases/:version/waves', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res, next) => {
  try {
    const version = req.params.version;
    const { wave_number, target_cohort, target_tenants, latency_p95_threshold_ms } = req.body || {};

    const wave = await releaseService.startWave({
      version,
      waveNumber: wave_number || 1,
      targetCohort: target_cohort || 'internal_canary',
      targetTenants: target_tenants || [],
      latencyP95ThresholdMs: latency_p95_threshold_ms
    });

    return res.status(201).json({
      success: true,
      data: wave
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/control/releases/:version/evaluate-canary
 */
router.post('/releases/:version/evaluate-canary', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res, next) => {
  try {
    const version = req.params.version;
    const { wave_id, error_rate_pct, latency_p95_ms } = req.body || {};
    if (!wave_id || error_rate_pct === undefined || latency_p95_ms === undefined) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'TELEMETRY_REQUIRED',
          message: 'wave_id, error_rate_pct, and latency_p95_ms are required; missing telemetry never defaults to a healthy value.'
        }
      });
    }

    const result = await releaseService.evaluateCanaryTelemetry({
      version,
      waveId: wave_id,
      errorRatePct: Number(error_rate_pct),
      latencyP95Ms: Number(latency_p95_ms)
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/control/releases
 */
router.get('/releases', requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support', 'platform_readonly']), async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM neem_releases ORDER BY created_at DESC');
    return res.status(200).json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/control/incidents
 */
router.get('/incidents', requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support', 'platform_readonly']), async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM neem_incidents ORDER BY created_at DESC');
    return res.status(200).json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
