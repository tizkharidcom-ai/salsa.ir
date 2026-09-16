// server/neem/control-plane/releases/release-canary-service.js
'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { getDatabase } = require('../db/database');
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
