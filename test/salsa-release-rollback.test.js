'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const serviceModules = [
  'server/salsa/control-plane/releases/release-canary-service.js',
  'superadmin/backend/releases/release-canary-service.js'
];
const routeModules = [
  'server/salsa/control-plane/routes/release-routes.js',
  'superadmin/backend/routes/release-routes.js'
];

const FAILED_VERSION = 'v2.4.0';
const STABLE_VERSION = 'v2.3.9';

function createFixture() {
  return {
    releases: [
      { version: FAILED_VERSION, status: 'promoted', created_at: new Date('2026-09-20T00:00:00.000Z') },
      { version: STABLE_VERSION, status: 'promoted', created_at: new Date('2026-09-10T00:00:00.000Z') }
    ],
    waves: [
      { id: 'wave-24-1', version: FAILED_VERSION, wave_number: 1, status: 'passed', created_at: new Date('2026-09-21T00:00:00.000Z') }
    ]
  };
}

class FakeDatabase {
  constructor({ failReleaseUpdate = false, failRollback = false, fixture = createFixture(), events = [] } = {}) {
    this.releases = fixture.releases;
    this.waves = fixture.waves;
    this.failReleaseUpdate = failReleaseUpdate;
    this.failRollback = failRollback;
    this.events = events;
    this.queries = [];
  }

  async connect() {
    const database = this;
    let snapshot = null;
    return {
      async query(sql, params = []) {
        const statement = String(sql).trim();
        const upper = statement.toUpperCase();
        database.queries.push({ sql: statement, params: [...params] });
        if (upper === 'BEGIN') {
          snapshot = structuredClone({ releases: database.releases, waves: database.waves });
          database.events.push('BEGIN');
          return { rows: [] };
        }
        if (upper === 'COMMIT') {
          snapshot = null;
          database.events.push('COMMIT');
          return { rows: [] };
        }
        if (upper === 'ROLLBACK') {
          if (database.failRollback) throw database.failRollback;
          if (snapshot) {
            database.releases = snapshot.releases;
            database.waves = snapshot.waves;
          }
          snapshot = null;
          database.events.push('ROLLBACK');
          return { rows: [] };
        }
        if (upper.startsWith('SELECT') && upper.includes('FROM NEEM_RELEASES')) {
          if (upper.includes('WHERE VERSION =')) {
            const release = database.releases.find((row) => row.version === params[0]);
            return { rows: release ? [{ version: release.version, status: release.status }] : [] };
          }
          const rows = database.releases
            .filter((row) => row.status === 'promoted' && row.version !== params[0])
            .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
            .slice(0, 1)
            .map(({ version, status }) => ({ version, status }));
          return { rows };
        }
        if (upper.startsWith('SELECT') && upper.includes('FROM NEEM_ROLLOUT_WAVES')) {
          return {
            rows: database.waves
              .filter((row) => row.version === params[0])
              .map((row) => ({ ...row }))
          };
        }
        if (upper.startsWith('UPDATE NEEM_RELEASES')) {
          if (database.failReleaseUpdate) throw database.failReleaseUpdate;
          const [expectedStatus, version] = params;
          const release = database.releases.find((row) => row.version === version && row.status === expectedStatus);
          if (!release) return { rows: [] };
          release.status = 'rolled_back';
          return { rows: [{ version, status: release.status }] };
        }
        if (upper.startsWith('UPDATE NEEM_ROLLOUT_WAVES')) {
          const [expectedStatus, version, id] = params;
          const wave = database.waves.find((row) => row.id === id && row.version === version && row.status === expectedStatus);
          if (!wave) return { rows: [] };
          wave.status = 'rolled_back';
          return { rows: [{ id, status: wave.status }] };
        }
        throw new Error(`Unexpected fake database query: ${statement}`);
      },
      release() { database.events.push('RELEASE_CLIENT'); }
    };
  }
}

function createHttpController(serviceModule, { body = { ok: true, activeVersion: STABLE_VERSION, operationId: 'traffic-op-42' }, ok = true, events = [] } = {}) {
  const servicePath = path.resolve(__dirname, '..', serviceModule);
  const controllerPath = path.join(path.dirname(servicePath), 'traffic-controller.js');
  const { HttpTrafficController } = require(controllerPath);
  let calls = 0;
  const controller = new HttpTrafficController({
    endpoint: 'https://traffic-controller.invalid/revert',
    token: 'test-only-token',
    fetchImpl: async (url, options) => {
      calls += 1;
      events.push({ type: 'provider', url, options });
      return { ok, json: async () => body };
    }
  });
  return { controller, get calls() { return calls; } };
}

function createService(serviceModule, db, controller) {
  const absolutePath = path.resolve(__dirname, '..', serviceModule);
  const { ReleaseCanaryService } = require(absolutePath);
  const service = new ReleaseCanaryService({ db, allowFixtureMode: false, trafficController: controller });
  return service;
}

for (const serviceModule of serviceModules) {
  test(`${serviceModule}: manual rollback is confirmed, state-checked, and fail-closed`, async (t) => {
    const scenario = (name, run) => t.test(name, run);

    await scenario('missing controller fails without changing release or wave', async () => {
      const db = new FakeDatabase();
      const service = createService(serviceModule, db, null);
      service.trafficController = null;
      await assert.rejects(
        service.rollbackRelease({ releaseId: FAILED_VERSION }),
        (error) => error.code === 'TRAFFIC_CONTROLLER_UNAVAILABLE' && error.status === 503
      );
      assert.equal(db.releases[0].status, 'promoted');
      assert.equal(db.waves[0].status, 'passed');
      assert.equal(db.queries.some((query) => /^UPDATE/i.test(query.sql)), false);
    });

    await scenario('failed HTTP provider never records rolled_back', async () => {
      const db = new FakeDatabase();
      const provider = createHttpController(serviceModule, { ok: false, body: { ok: false, activeVersion: 'v2.4.0' } });
      const service = createService(serviceModule, db, provider.controller);
      await assert.rejects(
        service.rollbackRelease({ releaseId: FAILED_VERSION }),
        (error) => error.code === 'TRAFFIC_ROLLBACK_NOT_CONFIRMED' && error.status === 502
      );
      assert.equal(provider.calls, 1);
      assert.equal(db.releases[0].status, 'promoted');
      assert.equal(db.waves[0].status, 'passed');
      assert.equal(db.queries.some((query) => /^UPDATE/i.test(query.sql)), false);
    });

    await scenario('provider success with the wrong active version is not accepted', async () => {
      const db = new FakeDatabase();
      const provider = createHttpController(serviceModule, {
        body: { ok: true, activeVersion: FAILED_VERSION, operationId: 'wrong-active-version' }
      });
      const service = createService(serviceModule, db, provider.controller);
      await assert.rejects(
        service.rollbackRelease({ releaseId: FAILED_VERSION }),
        (error) => error.code === 'TRAFFIC_ROLLBACK_NOT_CONFIRMED' && error.status === 502
      );
      assert.equal(db.releases[0].status, 'promoted');
      assert.equal(db.waves[0].status, 'passed');
      assert.equal(db.queries.some((query) => /^UPDATE/i.test(query.sql)), false);
    });

    await scenario('missing release is 404 and provider is not contacted', async () => {
      const db = new FakeDatabase({ fixture: { releases: [], waves: [] } });
      const provider = createHttpController(serviceModule);
      const service = createService(serviceModule, db, provider.controller);
      await assert.rejects(
        service.rollbackRelease({ releaseId: FAILED_VERSION }),
        (error) => error.code === 'RELEASE_NOT_FOUND' && error.status === 404
      );
      assert.equal(provider.calls, 0);
      assert.equal(db.queries.some((query) => /^UPDATE/i.test(query.sql)), false);
    });

    await scenario('database update failure is propagated after provider confirmation', async () => {
      const databaseError = new Error('synthetic database write failure');
      const db = new FakeDatabase({ failReleaseUpdate: databaseError });
      const provider = createHttpController(serviceModule);
      const service = createService(serviceModule, db, provider.controller);
      await assert.rejects(
        service.rollbackRelease({ releaseId: FAILED_VERSION }),
        (error) => error === databaseError
      );
      assert.equal(provider.calls, 1);
      assert.equal(db.events.includes('ROLLBACK'), true);
      assert.equal(db.events.includes('COMMIT'), false);
      assert.equal(db.releases[0].status, 'promoted');
      assert.equal(db.waves[0].status, 'passed');
    });

    await scenario('database rollback failure is surfaced and retains the initiating error', async () => {
      const databaseError = new Error('synthetic database write failure');
      const rollbackError = new Error('synthetic transaction rollback failure');
      const db = new FakeDatabase({ failReleaseUpdate: databaseError, failRollback: rollbackError });
      const provider = createHttpController(serviceModule);
      const service = createService(serviceModule, db, provider.controller);
      await assert.rejects(
        service.rollbackRelease({ releaseId: FAILED_VERSION }),
        (error) => error === rollbackError && error.originalError === databaseError
      );
      assert.equal(db.events.includes('COMMIT'), false);
    });

    await scenario('success follows confirmed stable version and transaction commit', async () => {
      const events = [];
      const db = new FakeDatabase({ events });
      const provider = createHttpController(serviceModule, { events });
      const service = createService(serviceModule, db, provider.controller);
      const result = await service.rollbackRelease({
        releaseId: FAILED_VERSION,
        reason: 'Operator-confirmed rollback',
        actorId: 'platform-owner-7'
      });
      assert.equal(result.status, 'rolled_back');
      assert.equal(result.targetSafeVersion, STABLE_VERSION);
      assert.equal(result.waveId, 'wave-24-1');
      assert.equal(result.rolledBackBy, 'platform-owner-7');
      assert.equal(db.releases[0].status, 'rolled_back');
      assert.equal(db.waves[0].status, 'rolled_back');
      assert.equal(db.events.includes('COMMIT'), true);
      const providerEventIndex = events.findIndex((event) => event?.type === 'provider');
      const commitEventIndex = events.indexOf('COMMIT');
      assert.equal(providerEventIndex >= 0 && commitEventIndex > providerEventIndex, true);
      const providerRequest = events[providerEventIndex].options;
      assert.equal(providerRequest.method, 'POST');
      assert.equal(JSON.parse(providerRequest.body).stableVersion, STABLE_VERSION);
    });

    await scenario('the local in-memory adapter commits release and wave state changes', async () => {
      const servicePath = path.resolve(__dirname, '..', serviceModule);
      const databasePath = path.resolve(path.dirname(servicePath), '../db/database.js');
      const { InMemoryTestAdapter } = require(databasePath);
      const db = new InMemoryTestAdapter({ seedFixtures: false });
      db.tables.neem_releases.push(
        { version: FAILED_VERSION, status: 'promoted', created_at: new Date('2026-09-20T00:00:00.000Z') },
        { version: STABLE_VERSION, status: 'promoted', created_at: new Date('2026-09-10T00:00:00.000Z') }
      );
      db.tables.neem_rollout_waves.push({
        id: 'wave-24-memory', version: FAILED_VERSION, wave_number: 1, status: 'passed',
        created_at: new Date('2026-09-21T00:00:00.000Z')
      });
      const provider = createHttpController(serviceModule);
      const service = createService(serviceModule, db, provider.controller);
      const result = await service.rollbackRelease({ releaseId: FAILED_VERSION });
      assert.equal(result.status, 'rolled_back');
      assert.equal(db.tables.neem_releases.find((row) => row.version === FAILED_VERSION).status, 'rolled_back');
      assert.equal(db.tables.neem_rollout_waves[0].status, 'rolled_back');
    });

    await scenario('non-rollbackable release state is rejected before provider call', async () => {
      const fixture = createFixture();
      fixture.releases[0].status = 'draft';
      const db = new FakeDatabase({ fixture });
      const provider = createHttpController(serviceModule);
      const service = createService(serviceModule, db, provider.controller);
      await assert.rejects(
        service.rollbackRelease({ releaseId: FAILED_VERSION }),
        (error) => error.code === 'RELEASE_NOT_ROLLBACKABLE' && error.status === 409
      );
      assert.equal(provider.calls, 0);
    });

    await scenario('explicit target must exist and be promoted', async () => {
      const fixture = createFixture();
      fixture.releases[1].status = 'draft';
      const db = new FakeDatabase({ fixture });
      const provider = createHttpController(serviceModule);
      const service = createService(serviceModule, db, provider.controller);
      await assert.rejects(
        service.rollbackRelease({ releaseId: FAILED_VERSION, targetSafeVersion: STABLE_VERSION }),
        (error) => error.code === 'ROLLBACK_TARGET_INVALID' && error.status === 409
      );
      assert.equal(provider.calls, 0);
    });

    await scenario('missing explicit stable target is rejected before provider call', async () => {
      const db = new FakeDatabase();
      const provider = createHttpController(serviceModule);
      const service = createService(serviceModule, db, provider.controller);
      await assert.rejects(
        service.rollbackRelease({ releaseId: FAILED_VERSION, targetSafeVersion: 'v2.2.0' }),
        (error) => error.code === 'ROLLBACK_TARGET_INVALID' && error.status === 409
      );
      assert.equal(provider.calls, 0);
      assert.equal(db.queries.some((query) => /^UPDATE/i.test(query.sql)), false);
    });

    await scenario('latest rollout wave must be running or passed', async () => {
      const fixture = createFixture();
      fixture.waves[0].status = 'pending';
      const db = new FakeDatabase({ fixture });
      const provider = createHttpController(serviceModule);
      const service = createService(serviceModule, db, provider.controller);
      await assert.rejects(
        service.rollbackRelease({ releaseId: FAILED_VERSION }),
        (error) => error.code === 'ROLLBACK_WAVE_INVALID' && error.status === 409
      );
      assert.equal(provider.calls, 0);
    });
  });
}

for (const routeModule of routeModules) {
  test(`${routeModule}: rollback route delegates and forwards service failures`, async () => {
    const absoluteRoutePath = path.resolve(__dirname, '..', routeModule);
    const servicePath = path.resolve(path.dirname(absoluteRoutePath), '../releases/release-canary-service.js');
    const { ReleaseCanaryService } = require(servicePath);
    const originalRollback = ReleaseCanaryService.prototype.rollbackRelease;
    const router = require(absoluteRoutePath);
    const layer = router.stack.find((entry) => entry.route?.path === '/releases/:id/rollback');
    assert.ok(layer, 'manual rollback route is registered');
    const handler = layer.route.stack.at(-1).handle;
    const request = {
      params: { id: FAILED_VERSION },
      body: { targetSafeVersion: STABLE_VERSION, reason: 'Route test' },
      platformPrincipal: { id: 'route-operator' }
    };
    const createResponse = () => ({
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    });
    try {
      const response = createResponse();
      let forwardedError = null;
      ReleaseCanaryService.prototype.rollbackRelease = async function (input) {
        assert.deepEqual(input, {
          releaseId: FAILED_VERSION,
          targetSafeVersion: STABLE_VERSION,
          reason: 'Route test',
          actorId: 'route-operator'
        });
        return { id: FAILED_VERSION, status: 'rolled_back', targetSafeVersion: STABLE_VERSION };
      };
      await handler(request, response, (error) => { forwardedError = error || null; });
      assert.equal(forwardedError, null);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.data.status, 'rolled_back');

      const databaseError = new Error('route database failure');
      ReleaseCanaryService.prototype.rollbackRelease = async () => { throw databaseError; };
      const failedResponse = createResponse();
      let routeError = null;
      await handler(request, failedResponse, (error) => { routeError = error || null; });
      assert.equal(routeError, databaseError);
      assert.equal(failedResponse.body, null);
    } finally {
      ReleaseCanaryService.prototype.rollbackRelease = originalRollback;
    }
  });
}
