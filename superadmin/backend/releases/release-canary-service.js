// server/salsa/control-plane/releases/release-canary-service.js
'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { getDatabase, getDatabaseClient } = require('../db/database');
const config = require('../config');
const { evaluateProductionReadiness } = require('../operational/production-readiness-gate');
const { HttpTrafficController } = require('./traffic-controller');

const SEMVER_PATTERN = /^[vV]?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

function parseSemver(value) {
  const match = String(value || '').trim().match(SEMVER_PATTERN);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : []
  };
}

function compareSemver(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (index >= left.prerelease.length) return -1;
    if (index >= right.prerelease.length) return 1;
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

class ReleaseCanaryService {
  constructor({ db = getDatabase(), currentStableVersion = 'v2.3.9', allowFixtureMode = null, readinessManifestProvider = null, trafficController = null } = {}) {
    if (config.isProduction && allowFixtureMode === true) {
      throw new Error('PRODUCTION_FIXTURE_MODE_FORBIDDEN: release promotion cannot bypass the production readiness gate.');
    }
    this.db = db;
    this.currentStableVersion = currentStableVersion;
    this.allowFixtureMode = allowFixtureMode === null
      ? (config.isTest || (!config.isProduction && config.allowEphemeralDev))
      : Boolean(allowFixtureMode);
    this.readinessManifestProvider = readinessManifestProvider || (() => this.loadReadinessManifestFromEnvironment());
    this.trafficController = trafficController || (config.trafficControllerUrl && config.trafficControllerToken
      ? new HttpTrafficController({ endpoint: config.trafficControllerUrl, token: config.trafficControllerToken })
      : null);
  }

  async loadReadinessManifestFromEnvironment() {
    if (process.env.NEEM_PRODUCTION_GATE_MANIFEST_JSON) {
      return JSON.parse(process.env.NEEM_PRODUCTION_GATE_MANIFEST_JSON);
    }
    if (process.env.NEEM_PRODUCTION_GATE_MANIFEST) {
      return JSON.parse(await fs.readFile(path.resolve(process.env.NEEM_PRODUCTION_GATE_MANIFEST), 'utf8'));
    }
    return null;
  }

  async assertProductionReadinessForPromotion(expectedReleaseId) {
    let manifest = null;
    try {
      manifest = await this.readinessManifestProvider();
    } catch (error) {
      const blocked = new Error(`PRODUCTION_GATE_BLOCKED: readiness manifest could not be loaded (${error.message}).`);
      blocked.code = 'PRODUCTION_GATE_BLOCKED';
      blocked.status = 409;
      blocked.readiness = { ok: false, status: 'NO_GO', blockers: ['MANIFEST_READ_FAILED'] };
      throw blocked;
    }
    const readiness = evaluateProductionReadiness(manifest, { expectedReleaseId });
    if (!readiness.ok) {
      const blocked = new Error(`PRODUCTION_GATE_BLOCKED: ${readiness.blockers.join(', ') || 'production readiness is NO_GO'}.`);
      blocked.code = 'PRODUCTION_GATE_BLOCKED';
      blocked.status = 409;
      blocked.readiness = readiness;
      throw blocked;
    }
    return readiness;
  }

  /**
   * Manually reverts a release only after the configured traffic controller
   * confirms the selected promoted release is active.
   */
  async rollbackRelease({ releaseId, targetSafeVersion = null, reason = 'Emergency rollback triggered by operator', actorId = 'operator' } = {}) {
    const failedVersion = String(releaseId || '').trim();
    if (!parseSemver(failedVersion)) {
      const err = new Error('RELEASE_VALIDATION_ERROR: release id must be a valid semantic version.');
      err.code = 'RELEASE_VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) {
      const err = new Error('ROLLBACK_VALIDATION_ERROR: reason must be a non-empty string of at most 500 characters.');
      err.code = 'ROLLBACK_VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }
    if (typeof actorId !== 'string' || !actorId.trim()) {
      const err = new Error('ROLLBACK_VALIDATION_ERROR: actor id is required.');
      err.code = 'ROLLBACK_VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }
    if (targetSafeVersion !== null && targetSafeVersion !== undefined &&
        (typeof targetSafeVersion !== 'string' || !parseSemver(targetSafeVersion.trim()))) {
      const err = new Error('ROLLBACK_VALIDATION_ERROR: targetSafeVersion must be a valid semantic version.');
      err.code = 'ROLLBACK_VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }

    const client = await getDatabaseClient(this.db);
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;

      const releaseResult = await client.query(
        'SELECT version, status FROM neem_releases WHERE version = $1 FOR UPDATE',
        [failedVersion]
      );
      const release = releaseResult.rows?.[0];
      if (!release) {
        const err = new Error(`RELEASE_NOT_FOUND: Release '${failedVersion}' was not found.`);
        err.code = 'RELEASE_NOT_FOUND';
        err.status = 404;
        throw err;
      }
      if (!['canary', 'promoted'].includes(release.status)) {
        const err = new Error(`RELEASE_NOT_ROLLBACKABLE: Release '${failedVersion}' is '${release.status}', not canary or promoted.`);
        err.code = 'RELEASE_NOT_ROLLBACKABLE';
        err.status = 409;
        throw err;
      }

      let targetResult;
      const requestedTarget = targetSafeVersion == null ? null : targetSafeVersion.trim();
      if (requestedTarget) {
        if (requestedTarget === failedVersion) {
          const err = new Error('ROLLBACK_TARGET_INVALID: targetSafeVersion must differ from the release being rolled back.');
          err.code = 'ROLLBACK_TARGET_INVALID';
          err.status = 409;
          throw err;
        }
        targetResult = await client.query(
          'SELECT version, status FROM neem_releases WHERE version = $1 FOR UPDATE',
          [requestedTarget]
        );
      } else {
        // This is the existing automated rollback policy: use the newest other
        // promoted release. Never use the fixture-only stable-version fallback
        // for an operator-triggered production rollback.
        targetResult = await client.query(
          `SELECT version, status FROM neem_releases
           WHERE status = 'promoted' AND version <> $1
           ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
          [failedVersion]
        );
      }
      const target = targetResult.rows?.[0];
      if (!target || target.version === failedVersion || target.status !== 'promoted' || !parseSemver(target.version)) {
        const err = new Error('ROLLBACK_TARGET_INVALID: a different, promoted release is required as the stable target.');
        err.code = 'ROLLBACK_TARGET_INVALID';
        err.status = 409;
        throw err;
      }

      const wavesResult = await client.query(
        `SELECT id, version, wave_number, status, created_at FROM neem_rollout_waves
         WHERE version = $1 ORDER BY wave_number DESC, created_at DESC FOR UPDATE`,
        [failedVersion]
      );
      const waves = (wavesResult.rows || [])
        .filter((wave) => wave.version === failedVersion)
        .sort((left, right) => Number(right.wave_number) - Number(left.wave_number) ||
          new Date(right.created_at || 0) - new Date(left.created_at || 0));
      const wave = waves[0];
      if (!wave || !wave.id || !['running', 'passed'].includes(wave.status)) {
        const err = new Error('ROLLBACK_WAVE_INVALID: the release must have a latest rollout wave in running or passed state.');
        err.code = 'ROLLBACK_WAVE_INVALID';
        err.status = 409;
        throw err;
      }

      const controller = this.trafficController;
      if (!(controller instanceof HttpTrafficController) || !controller.isConfigured()) {
        const err = new Error('TRAFFIC_CONTROLLER_UNAVAILABLE: a configured HTTP traffic controller is required; release state was not changed.');
        err.code = 'TRAFFIC_CONTROLLER_UNAVAILABLE';
        err.status = 503;
        throw err;
      }

      let trafficResult;
      try {
        trafficResult = await controller.revertToStable({
          failedVersion,
          stableVersion: target.version,
          waveId: wave.id
        });
      } catch (cause) {
        const err = new Error('TRAFFIC_ROLLBACK_NOT_CONFIRMED: the HTTP traffic controller did not confirm the stable target.');
        err.code = cause?.code || 'TRAFFIC_ROLLBACK_NOT_CONFIRMED';
        err.status = cause?.status || 502;
        err.cause = cause;
        throw err;
      }
      if (trafficResult?.ok !== true || trafficResult.activeVersion !== target.version) {
        const err = new Error('TRAFFIC_ROLLBACK_NOT_CONFIRMED: the HTTP traffic controller did not confirm the stable target.');
        err.code = 'TRAFFIC_ROLLBACK_NOT_CONFIRMED';
        err.status = 502;
        throw err;
      }

      const releaseUpdate = await client.query(
        `UPDATE neem_releases SET status = 'rolled_back', updated_at = NOW()
         WHERE status = $1 AND version = $2 RETURNING version, status`,
        [release.status, failedVersion]
      );
      if (!releaseUpdate.rows?.some((row) => row.version === failedVersion && row.status === 'rolled_back')) {
        const err = new Error('RELEASE_STATE_CHANGED: release state changed before rollback could be recorded.');
        err.code = 'RELEASE_STATE_CHANGED';
        err.status = 409;
        throw err;
      }

      const waveUpdate = await client.query(
        `UPDATE neem_rollout_waves SET status = 'rolled_back', updated_at = NOW()
         WHERE status = $1 AND version = $2 AND id = $3 RETURNING id, status`,
        [wave.status, failedVersion, wave.id]
      );
      if (!waveUpdate.rows?.some((row) => row.id === wave.id && row.status === 'rolled_back')) {
        const err = new Error('ROLLBACK_WAVE_STATE_CHANGED: rollout wave state changed before rollback could be recorded.');
        err.code = 'ROLLBACK_WAVE_STATE_CHANGED';
        err.status = 409;
        throw err;
      }

      await client.query('COMMIT');
      transactionOpen = false;
      this.currentStableVersion = target.version;
      return {
        id: failedVersion,
        failedVersion,
        status: 'rolled_back',
        targetSafeVersion: target.version,
        waveId: wave.id,
        operationId: trafficResult.operationId || null,
        reason: reason.trim(),
        rolledBackAt: new Date().toISOString(),
        rolledBackBy: actorId.trim()
      };
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
          transactionOpen = false;
        } catch (rollbackError) {
          // A failed transaction rollback is itself a database failure and
          // must reach the caller; retain the initiating failure for diagnosis.
          if (rollbackError && typeof rollbackError === 'object') rollbackError.originalError = error;
          throw rollbackError;
        }
      }
      throw error;
    } finally {
      if (typeof client.release === 'function') client.release();
    }
  }

  /**
   * Registers a new platform release candidate
   */
  async createRelease({
    version,
    manifestChecksum,
    gitCommitSha,
    minCompatibleEdgeVersion = '2.3.0',
    releaseNotes = ''
  }) {
    if (!parseSemver(version)) {
      const err = new Error('RELEASE_VALIDATION_ERROR: version must be a valid semantic version.');
      err.code = 'RELEASE_VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }
    if (!parseSemver(minCompatibleEdgeVersion)) {
      const err = new Error('RELEASE_VALIDATION_ERROR: minCompatibleEdgeVersion must be a valid semantic version.');
      err.code = 'RELEASE_VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }
    if (!/^[0-9a-f]{64}$/i.test(String(manifestChecksum || ''))) {
      const err = new Error('RELEASE_VALIDATION_ERROR: manifestChecksum must be a SHA-256 hex digest.');
      err.code = 'RELEASE_VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }
    if (!/^[0-9a-f]{40}$/i.test(String(gitCommitSha || ''))) {
      const err = new Error('RELEASE_VALIDATION_ERROR: gitCommitSha must be a 40-character commit SHA.');
      err.code = 'RELEASE_VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }

    const res = await this.db.query(
      `INSERT INTO neem_releases (version, manifest_checksum, git_commit_sha, min_compatible_edge_version, release_notes, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'draft', NOW())
       RETURNING *`,
      [version, manifestChecksum, gitCommitSha, minCompatibleEdgeVersion, releaseNotes]
    );

    return res.rows[0];
  }

  /**
   * Semver compatibility checker for Edge Terminals (AC-56)
   */
  isEdgeVersionCompatible(minRequiredStr, deviceVersionStr) {
    const minimum = parseSemver(minRequiredStr);
    const device = parseSemver(deviceVersionStr);
    if (!minimum || !device) return false;
    return compareSemver(device, minimum) >= 0;
  }

  /**
   * Initiates a canary rollout wave
   */
  async startWave({ version, waveNumber, targetCohort, targetTenants = [], latencyP95ThresholdMs = config.canaryLatencyP95ThresholdMs }) {
    if (!Number.isInteger(Number(waveNumber)) || Number(waveNumber) < 1) {
      const err = new Error('WAVE_VALIDATION_ERROR: waveNumber must be a positive integer.');
      err.code = 'WAVE_VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }
    const allowedCohorts = new Set(['internal_canary', 'pilot_tenants', 'general_fleet']);
    if (!allowedCohorts.has(targetCohort)) {
      const err = new Error(`WAVE_VALIDATION_ERROR: Unsupported target cohort '${targetCohort}'.`);
      err.code = 'WAVE_VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }
    if (!Array.isArray(targetTenants)) {
      const err = new Error('WAVE_VALIDATION_ERROR: targetTenants must be an array.');
      err.code = 'WAVE_VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }
    const normalizedLatencyThreshold = Number(latencyP95ThresholdMs);
    if (!Number.isFinite(normalizedLatencyThreshold) || normalizedLatencyThreshold <= 0) {
      const err = new Error('WAVE_VALIDATION_ERROR: latencyP95ThresholdMs must be a positive number.');
      err.code = 'WAVE_VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }

    const releaseRes = await this.db.query('SELECT * FROM neem_releases WHERE version = $1', [version]);
    const release = releaseRes.rows?.[0];
    if (!release) {
      const err = new Error(`RELEASE_NOT_FOUND: Release '${version}' does not exist.`);
      err.code = 'RELEASE_NOT_FOUND';
      err.status = 404;
      throw err;
    }
    if (!['draft', 'canary'].includes(release.status)) {
      const err = new Error(`WAVE_NOT_ALLOWED: Release '${version}' is '${release.status}' and cannot receive a new rollout wave.`);
      err.code = 'WAVE_NOT_ALLOWED';
      err.status = 409;
      throw err;
    }
    if (Number(waveNumber) > 1) {
      const previousRes = await this.db.query(
        `SELECT id, status FROM neem_rollout_waves WHERE version = $1 AND wave_number = $2`,
        [version, Number(waveNumber) - 1]
      );
      if (!previousRes.rows?.some((row) => row.status === 'passed')) {
        const err = new Error(`WAVE_SEQUENCE_BLOCKED: Wave ${Number(waveNumber) - 1} for release '${version}' must pass before starting wave ${Number(waveNumber)}.`);
        err.code = 'WAVE_SEQUENCE_BLOCKED';
        err.status = 409;
        throw err;
      }
    }

    const existingWaveRes = await this.db.query(
      `SELECT id, status FROM neem_rollout_waves WHERE version = $1 AND wave_number = $2`,
      [version, Number(waveNumber)]
    );
    if (existingWaveRes.rows?.length) {
      const err = new Error(`WAVE_ALREADY_EXISTS: Release '${version}' already has rollout wave ${Number(waveNumber)}.`);
      err.code = 'WAVE_ALREADY_EXISTS';
      err.status = 409;
      throw err;
    }

    const waveId = `wave_${crypto.randomUUID().slice(0, 8)}`;

    // Set release to canary if not already promoted
    await this.db.query(
      `UPDATE neem_releases SET status = 'canary' WHERE version = $1 AND status = 'draft'`,
      [version]
    );

    const res = await this.db.query(
      `INSERT INTO neem_rollout_waves (id, version, wave_number, target_cohort, target_tenants, healthy_threshold_pct, error_budget_threshold_pct, latency_p95_threshold_ms, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 95.0, 2.0, $6, 'running', NOW(), NOW())
       RETURNING *`,
      [waveId, version, Number(waveNumber), targetCohort, JSON.stringify(targetTenants), normalizedLatencyThreshold]
    );

    return res.rows[0];
  }

  /**
   * Evaluates telemetry and executes automated rollback on circuit breaker trip (AC-55)
   */
  async evaluateCanaryTelemetry({ version, waveId, errorRatePct, latencyP95Ms }) {
    const waveRes = await this.db.query(`SELECT * FROM neem_rollout_waves WHERE id = $1`, [waveId]);
    if (waveRes.rows.length === 0) {
      throw new Error(`Wave ${waveId} not found`);
    }

    const wave = waveRes.rows[0];
    if (wave.version !== version) {
      const err = new Error(`WAVE_VERSION_MISMATCH: Wave '${waveId}' belongs to release '${wave.version}', not '${version}'.`);
      err.code = 'WAVE_VERSION_MISMATCH';
      err.status = 409;
      throw err;
    }
    if (wave.status !== 'running') {
      return {
        outcome: wave.status === 'aborted' || wave.status === 'rolled_back'
          ? 'CIRCUIT_BREAKER_ALREADY_HANDLED'
          : 'WAVE_ALREADY_EVALUATED',
        status: wave.status,
        wave_id: waveId,
        active_stable_version: this.currentStableVersion
      };
    }
    const normalizedErrorRatePct = Number(errorRatePct);
    const normalizedLatencyP95Ms = Number(latencyP95Ms);
    if (!Number.isFinite(normalizedErrorRatePct) || normalizedErrorRatePct < 0 || normalizedErrorRatePct > 100 ||
        !Number.isFinite(normalizedLatencyP95Ms) || normalizedLatencyP95Ms < 0) {
      const err = new Error('TELEMETRY_VALIDATION_ERROR: errorRatePct must be 0..100 and latencyP95Ms must be non-negative.');
      err.code = 'TELEMETRY_VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }
    const thresholdPct = Number(wave.error_budget_threshold_pct || 2.0);
    const latencyThresholdMs = Number(wave.latency_p95_threshold_ms || config.canaryLatencyP95ThresholdMs);
    const errorBudgetExceeded = normalizedErrorRatePct > thresholdPct;
    const latencyBudgetExceeded = normalizedLatencyP95Ms > latencyThresholdMs;

    // AC-55: either error or latency budget trips the same fail-closed circuit breaker.
    if (errorBudgetExceeded || latencyBudgetExceeded) {
      // Resolve the traffic target before changing the release/wave state. A
      // missing promoted release must leave the canary running so an operator
      // can repair the rollback target instead of being left with a half-applied
      // rollback and no safe destination.
      const stableRes = await this.db.query(
        `SELECT version FROM neem_releases WHERE status = 'promoted' AND version <> $1 ORDER BY created_at DESC LIMIT 1`,
        [version]
      );
      const stableVersion = stableRes.rows?.[0]?.version || (this.allowFixtureMode ? this.currentStableVersion : null);
      if (!stableVersion) {
        const err = new Error('ROLLBACK_GATE_FAILED: No promoted stable release is available for traffic reversion.');
        err.code = 'ROLLBACK_GATE_FAILED';
        err.status = 409;
        throw err;
      }

      let trafficResult = { ok: true, activeVersion: stableVersion, operationId: 'fixture-only' };
      if (!this.allowFixtureMode) {
        if (!this.trafficController || typeof this.trafficController.revertToStable !== 'function') {
          const err = new Error('ROLLBACK_GATE_FAILED: No traffic controller is configured; database state was not changed.');
          err.code = 'ROLLBACK_GATE_FAILED';
          err.status = 409;
          throw err;
        }
        trafficResult = await this.trafficController.revertToStable({ failedVersion: version, stableVersion, waveId });
        if (!trafficResult || trafficResult.ok !== true || trafficResult.activeVersion !== stableVersion) {
          const err = new Error('ROLLBACK_GATE_FAILED: Traffic reversion was not confirmed; database state was not changed.');
          err.code = 'ROLLBACK_GATE_FAILED';
          err.status = 502;
          throw err;
        }
      }

      // 1. Abort wave
      await this.db.query(`UPDATE neem_rollout_waves SET status = 'aborted', updated_at = NOW() WHERE id = $1`, [waveId]);

      // 2. Rollback release
      await this.db.query(`UPDATE neem_releases SET status = 'rolled_back' WHERE version = $1 AND status IN ('draft', 'canary')`, [version]);
      this.currentStableVersion = stableVersion;

      // 3. Create critical incident
      const incidentId = `inc_canary_${String(waveId).replace(/[^a-zA-Z0-9_]/g, '_')}`.slice(0, 64);
      await this.db.query(
        `INSERT INTO neem_incidents (id, title, severity, status, affected_scope, trigger_event, root_cause, mitigation_actions, created_at)
         VALUES ($1, $2, 'sev1_critical', 'mitigated', $3, 'CANARY_CIRCUIT_BREAKER_TRIPPED', $4, $5, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [
          incidentId,
          `Automated Canary Rollback: Release ${version} exceeded canary stop rules`,
          `cohort:${wave.target_cohort}`,
          `Canary error rate ${normalizedErrorRatePct}% (limit ${thresholdPct}%). Latency P95 ${normalizedLatencyP95Ms}ms (limit ${latencyThresholdMs}ms).`,
          JSON.stringify([
            { action: 'abort_canary_wave', wave_id: waveId },
            { action: 'revert_traffic_to_stable', stable_version: stableVersion },
            { action: 'notify_oncall_engineer' }
          ])
        ]
      );

      return {
        outcome: 'CIRCUIT_BREAKER_ROLLED_BACK',
        status: 'rolled_back',
        wave_id: waveId,
        error_rate_pct: normalizedErrorRatePct,
        latency_p95_ms: normalizedLatencyP95Ms,
        stop_reasons: [errorBudgetExceeded ? 'error_rate' : null, latencyBudgetExceeded ? 'latency_p95' : null].filter(Boolean),
        incident_id: incidentId,
        active_stable_version: stableVersion,
        traffic_operation_id: trafficResult.operationId || null
      };
    }

    const isFinalWave = wave.target_cohort === 'general_fleet' || wave.wave_number >= 3;
    if (isFinalWave && !this.allowFixtureMode) {
      // Keep the wave running when the release gate is missing. Promotion must
      // be retryable after an operator supplies evidence; it must not create a
      // half-promoted release or consume the final wave on a failed gate.
      await this.assertProductionReadinessForPromotion(version);
    }

    // Telemetry healthy, pass wave
    await this.db.query(`UPDATE neem_rollout_waves SET status = 'passed', updated_at = NOW() WHERE id = $1`, [waveId]);

    // If final wave (e.g. wave 3 or general_fleet), promote release
    if (isFinalWave) {
      await this.db.query(`UPDATE neem_releases SET status = 'promoted' WHERE version = $1`, [version]);
      this.currentStableVersion = version;
    }

    return {
      outcome: 'WAVE_PASSED_PROCEED_NEXT',
      status: 'passed',
      wave_id: waveId,
      error_rate_pct: normalizedErrorRatePct,
      latency_p95_ms: normalizedLatencyP95Ms
    };
  }
}

module.exports = {
  ReleaseCanaryService
};
