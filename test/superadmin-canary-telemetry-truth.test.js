'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { ReleaseCanaryService } = require('../server/salsa/control-plane/releases/release-canary-service');

const NOW = Date.parse('2026-09-24T09:00:00.000Z');
const RELEASE = {
  version: 'v9.8.7',
  manifestChecksum: 'a'.repeat(64),
  gitCommitSha: 'b'.repeat(40)
};
const WAVE = {
  id: 'wave_12345678',
  version: RELEASE.version,
  wave_number: 1,
  target_cohort: 'internal_canary',
  error_budget_threshold_pct: 2,
  latency_p95_threshold_ms: 750,
  status: 'running',
  release_manifest_checksum: RELEASE.manifestChecksum,
  release_git_commit_sha: RELEASE.gitCommitSha
};

function freshTelemetry(overrides = {}) {
  return {
    releaseVersion: RELEASE.version,
    releaseManifestChecksum: RELEASE.manifestChecksum,
    releaseGitCommitSha: RELEASE.gitCommitSha,
    waveId: WAVE.id,
    targetCohort: WAVE.target_cohort,
    windowStart: '2026-09-24T08:55:00.000Z',
    windowEnd: '2026-09-24T08:59:30.000Z',
    observedAt: '2026-09-24T08:59:45.000Z',
    errorRatePct: 0.2,
    latencyP95Ms: 180,
    ...overrides
  };
}

function createDb({ wave = WAVE, losePassWrite = false } = {}) {
  const calls = [];
  const db = {
    calls,
    async query(sql, params = []) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ statement, params });
      if (/SELECT w\.\*/i.test(statement)) {
        return { rows: wave ? [{ ...wave }] : [] };
      }
      if (/SELECT version FROM neem_releases/i.test(statement)) {
        return { rows: [{ version: 'v9.8.6' }] };
      }
      if (/UPDATE neem_rollout_waves SET status = 'passed'/i.test(statement)) {
        if (losePassWrite) {
          wave.status = 'aborted';
          return { rows: [], rowCount: 0 };
        }
        wave.status = 'passed';
        return { rows: [{ id: wave.id, status: wave.status }] };
      }
      if (/UPDATE neem_rollout_waves SET status = 'aborted'/i.test(statement) ||
          /UPDATE neem_releases SET status = 'rolled_back'/i.test(statement) ||
          /UPDATE neem_releases SET status = 'promoted'/i.test(statement) ||
          /UPDATE neem_releases SET status = 'canary'/i.test(statement)) {
        return { rows: [] };
      }
      if (/INSERT INTO neem_incidents/i.test(statement)) return { rows: [] };
      throw new Error(`Unexpected query in canary truth test: ${statement}`);
    }
  };
  return db;
}

function makeService({ telemetry, provider, wave = WAVE, maxAgeMs, losePassWrite = false } = {}) {
  const db = createDb({ wave: { ...wave }, losePassWrite });
  const options = {
    db,
    allowFixtureMode: true,
    currentStableVersion: 'v9.8.6',
    clock: () => NOW
  };
  if (provider) options.canaryTelemetryProvider = provider;
  else if (telemetry !== undefined) {
    options.canaryTelemetryProvider = { readCanaryTelemetry: async () => telemetry };
  }
  if (maxAgeMs !== undefined) options.canaryTelemetryMaxAgeMs = maxAgeMs;
  return { service: new ReleaseCanaryService(options), db };
}

async function evaluate(service) {
  return service.evaluateCanaryTelemetry({
    version: RELEASE.version,
    waveId: WAVE.id,
    errorRatePct: 0,
    latencyP95Ms: 0
  });
}

test('no telemetry adapter returns unknown and leaves rollout state untouched', async () => {
  const { service, db } = makeService();
  const result = await evaluate(service);
  assert.equal(result.outcome, 'TELEMETRY_UNKNOWN');
  assert.equal(result.telemetry_status, 'unknown');
  assert.equal(result.reason_code, 'TELEMETRY_ADAPTER_UNAVAILABLE');
  assert.equal(db.calls.some(({ statement }) => /^(UPDATE|INSERT)/i.test(statement)), false);
  assert.equal(service.currentStableVersion, 'v9.8.6');
});

test('adapter read failures, missing evidence and invalid freshness policy fail closed', async (t) => {
  await t.test('provider exception', async () => {
    const { service, db } = makeService({
      provider: { readCanaryTelemetry: async () => { throw new Error('private adapter detail'); } }
    });
    const result = await evaluate(service);
    assert.equal(result.reason_code, 'TELEMETRY_READ_FAILED');
    assert.equal(db.calls.some(({ statement }) => /^(UPDATE|INSERT)/i.test(statement)), false);
  });

  await t.test('invalid max age', async () => {
    const { service, db } = makeService({ telemetry: freshTelemetry(), maxAgeMs: Number.NaN });
    const result = await evaluate(service);
    assert.equal(result.telemetry_status, 'unknown');
    assert.equal(db.calls.some(({ statement }) => /^(UPDATE|INSERT)/i.test(statement)), false);
  });
});

test('stale, future-dated or release/wave-unbound telemetry cannot pass a wave', async (t) => {
  const cases = [
    ['stale observation window', { windowStart: '2026-09-24T08:35:00.000Z', windowEnd: '2026-09-24T08:40:00.000Z', observedAt: '2026-09-24T08:40:00.000Z' }, 'TELEMETRY_STALE'],
    ['future observation', { observedAt: '2026-09-24T09:00:01.000Z' }, 'TELEMETRY_INVALID'],
    ['different wave', { waveId: 'wave_other' }, 'TELEMETRY_UNBOUND'],
    ['different release', { releaseVersion: 'v9.8.6' }, 'TELEMETRY_UNBOUND'],
    ['different manifest', { releaseManifestChecksum: 'c'.repeat(64) }, 'TELEMETRY_UNBOUND'],
    ['different commit', { releaseGitCommitSha: 'd'.repeat(40) }, 'TELEMETRY_UNBOUND'],
    ['different cohort', { targetCohort: 'general_fleet' }, 'TELEMETRY_UNBOUND'],
    ['non-numeric metric', { errorRatePct: '0' }, 'TELEMETRY_INVALID'],
    ['invalid measurement window', { windowStart: '2026-09-24T08:59:45.000Z' }, 'TELEMETRY_INVALID']
  ];

  for (const [name, overrides, reason] of cases) {
    await t.test(name, async () => {
      const { service, db } = makeService({ telemetry: freshTelemetry(overrides) });
      const result = await evaluate(service);
      assert.equal(result.outcome, 'TELEMETRY_UNKNOWN');
      assert.equal(result.reason_code, reason);
      assert.equal(db.calls.some(({ statement }) => /^(UPDATE|INSERT)/i.test(statement)), false);
    });
  }
});

test('only fresh telemetry bound to the exact release artifact and wave can pass', async () => {
  const { service, db } = makeService({ telemetry: freshTelemetry() });
  const result = await evaluate(service);
  assert.equal(result.outcome, 'WAVE_PASSED_PROCEED_NEXT');
  assert.equal(result.telemetry_status, 'verified');
  assert.equal(result.telemetry_observed_at, '2026-09-24T08:59:45.000Z');
  assert.deepEqual([...service.trustedPassedWaveIds], [WAVE.id]);
  assert.equal(db.calls.some(({ statement }) => /UPDATE neem_rollout_waves SET status = 'passed'/i.test(statement)), true);
});

test('verified metrics do not claim a pass if the rollout state changed concurrently', async () => {
  const { service } = makeService({ telemetry: freshTelemetry(), losePassWrite: true });
  await assert.rejects(evaluate(service), { code: 'WAVE_STATE_CHANGED', status: 409 });
  assert.equal(service.trustedPassedWaveIds.has(WAVE.id), false);
});

test('persisted passed state without current-process telemetry provenance is reported unknown', async () => {
  const { service } = makeService({ wave: { ...WAVE, status: 'passed' } });
  const result = await evaluate(service);
  assert.equal(result.outcome, 'WAVE_ALREADY_EVALUATED');
  assert.equal(result.telemetry_status, 'unknown');
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason_code, 'TRUSTED_EVALUATION_NOT_RECORDED');
});

test('promotion evidence requires a trusted passed final wave for the same release in this service instance', async (t) => {
  const finalWave = {
    id: 'wave_final_1',
    version: RELEASE.version,
    wave_number: 3,
    target_cohort: 'pilot_tenants',
    status: 'passed'
  };
  function serviceWithRows(rows) {
    return new ReleaseCanaryService({
      db: { query: async () => ({ rows }) },
      allowFixtureMode: true
    });
  }

  await t.test('stored passed state alone is not trusted', async () => {
    const service = serviceWithRows([finalWave]);
    await assert.rejects(service.assertTrustedFinalWaveForPromotion(RELEASE.version), {
      code: 'TRUSTED_FINAL_CANARY_PASS_REQUIRED', status: 409
    });
  });

  await t.test('trusted final wave for this release is accepted', async () => {
    const service = serviceWithRows([finalWave]);
    service.trustedPassedWaveIds.add(finalWave.id);
    const evidence = await service.assertTrustedFinalWaveForPromotion(RELEASE.version);
    assert.deepEqual(evidence, {
      releaseVersion: RELEASE.version,
      waveId: finalWave.id,
      waveNumber: 3,
      targetCohort: 'pilot_tenants'
    });
  });

  await t.test('trusted ID is insufficient for another release or a non-final wave', async () => {
    const mismatchedReleaseService = serviceWithRows([{ ...finalWave, version: 'v9.8.6' }]);
    mismatchedReleaseService.trustedPassedWaveIds.add(finalWave.id);
    await assert.rejects(mismatchedReleaseService.assertTrustedFinalWaveForPromotion(RELEASE.version), {
      code: 'TRUSTED_FINAL_CANARY_PASS_REQUIRED'
    });

    const nonFinalService = serviceWithRows([{ ...finalWave, wave_number: 2, target_cohort: 'pilot_tenants' }]);
    nonFinalService.trustedPassedWaveIds.add(finalWave.id);
    await assert.rejects(nonFinalService.assertTrustedFinalWaveForPromotion(RELEASE.version), {
      code: 'TRUSTED_FINAL_CANARY_PASS_REQUIRED'
    });
  });
});

test('route rejects operator metrics and exposes adapter absence as unknown', async (t) => {
  const routerPath = path.resolve(__dirname, '../server/salsa/control-plane/routes/release-routes.js');
  const router = require(routerPath);
  const route = router.stack.find((entry) => entry.route?.path === '/releases/:version/evaluate-canary');
  assert.ok(route, 'canary evaluation route is registered');
  const handler = route.route.stack.at(-1).handle;
  // Swap the service method on its prototype for this isolated route-contract test.
  const serviceModule = require('../server/salsa/control-plane/releases/release-canary-service');
  const original = serviceModule.ReleaseCanaryService.prototype.evaluateCanaryTelemetry;
  const calls = [];
  serviceModule.ReleaseCanaryService.prototype.evaluateCanaryTelemetry = async function (args) {
    calls.push(args);
    return { outcome: 'TELEMETRY_UNKNOWN', telemetry_status: 'unknown', reason_code: 'TELEMETRY_ADAPTER_UNAVAILABLE' };
  };

  function responseRecorder() {
    return {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };
  }

  try {
    await t.test('operator-supplied metrics are rejected before evaluation', async () => {
      const res = responseRecorder();
      await handler({ params: { version: RELEASE.version }, body: { wave_id: WAVE.id, error_rate_pct: 0, latency_p95_ms: 1 } }, res, (err) => { throw err; });
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.code, 'OPERATOR_TELEMETRY_FORBIDDEN');
      assert.equal(calls.length, 0);
    });

    await t.test('without adapter evidence route responds unknown, not healthy', async () => {
      const res = responseRecorder();
      await handler({ params: { version: RELEASE.version }, body: { wave_id: WAVE.id } }, res, (err) => { throw err; });
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.success, false);
      assert.equal(res.body.data.telemetry_status, 'unknown');
      assert.deepEqual(calls.at(-1), { version: RELEASE.version, waveId: WAVE.id });
    });
  } finally {
    serviceModule.ReleaseCanaryService.prototype.evaluateCanaryTelemetry = original;
  }
});

test('manual promotion requires trusted final-wave evidence before the production readiness gate', async (t) => {
  const router = require('../server/salsa/control-plane/routes/release-routes');
  const route = router.stack.find((entry) => entry.route?.path === '/releases/:id/promote');
  assert.ok(route, 'promotion route is registered');
  const handler = route.route.stack.at(-1).handle;
  const servicePrototype = ReleaseCanaryService.prototype;
  const originalTelemetryGuard = servicePrototype.assertTrustedFinalWaveForPromotion;
  const originalReadinessGate = servicePrototype.assertProductionReadinessForPromotion;
  const database = require('../server/salsa/control-plane/db/database').getDatabase();
  const originalQuery = database.query;
  const calls = [];

  function responseRecorder() {
    return {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };
  }
  async function invoke() {
    const res = responseRecorder();
    let forwardedError = null;
    await handler({
      params: { id: RELEASE.version },
      body: { reason: 'Approved' },
      platformPrincipal: { id: 'platform-operator' }
    }, res, (error) => { forwardedError = error || null; });
    return { res, forwardedError };
  }

  database.query = async (sql) => {
    const statement = String(sql).replace(/\s+/g, ' ').trim();
    calls.push(`db:${statement.startsWith('UPDATE') ? 'UPDATE' : 'SELECT'}`);
    if (/^\s*SELECT/i.test(statement)) {
      return { rows: [{ id: 'release-row', version: RELEASE.version, status: 'canary' }] };
    }
    if (/^\s*UPDATE/i.test(statement)) {
      return { rows: [{ id: 'release-row', version: RELEASE.version, status: 'promoted' }] };
    }
    throw new Error(`Unexpected promotion query: ${statement}`);
  };

  try {
    await t.test('missing in-process final-wave proof blocks before mutation', async () => {
      calls.length = 0;
      servicePrototype.assertTrustedFinalWaveForPromotion = async () => {
        calls.push('telemetry');
        throw Object.assign(new Error('missing trusted final wave'), { code: 'TRUSTED_FINAL_CANARY_PASS_REQUIRED', status: 409 });
      };
      servicePrototype.assertProductionReadinessForPromotion = async () => { calls.push('readiness'); };
      const { res, forwardedError } = await invoke();
      assert.equal(forwardedError?.code, 'TRUSTED_FINAL_CANARY_PASS_REQUIRED');
      assert.deepEqual(calls, ['db:SELECT', 'readiness', 'telemetry']);
      assert.equal(res.body, null);
    });

    await t.test('trusted final-wave proof still must pass the existing readiness gate', async () => {
      calls.length = 0;
      servicePrototype.assertTrustedFinalWaveForPromotion = async (version) => {
        calls.push(`telemetry:${version}`);
        return { releaseVersion: version, waveId: 'wave-final' };
      };
      servicePrototype.assertProductionReadinessForPromotion = async (version) => {
        calls.push(`readiness:${version}`);
        throw Object.assign(new Error('production evidence missing'), { code: 'PRODUCTION_GATE_BLOCKED', status: 409 });
      };
      const { res, forwardedError } = await invoke();
      assert.equal(forwardedError?.code, 'PRODUCTION_GATE_BLOCKED');
      assert.deepEqual(calls, ['db:SELECT', `readiness:${RELEASE.version}`]);
      assert.equal(res.body, null);
    });

    await t.test('promotion proceeds only after both gates pass', async () => {
      calls.length = 0;
      servicePrototype.assertTrustedFinalWaveForPromotion = async (version) => {
        calls.push(`telemetry:${version}`);
        return { releaseVersion: version, waveId: 'wave-final' };
      };
      servicePrototype.assertProductionReadinessForPromotion = async (version) => {
        calls.push(`readiness:${version}`);
        return { ok: true };
      };
      const { res, forwardedError } = await invoke();
      assert.equal(forwardedError, null);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.data.status, 'promoted');
      assert.deepEqual(calls, ['db:SELECT', `readiness:${RELEASE.version}`, `telemetry:${RELEASE.version}`, 'db:UPDATE']);
    });
  } finally {
    servicePrototype.assertTrustedFinalWaveForPromotion = originalTelemetryGuard;
    servicePrototype.assertProductionReadinessForPromotion = originalReadinessGate;
    database.query = originalQuery;
  }
});
