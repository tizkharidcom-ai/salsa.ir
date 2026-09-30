'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const routeModules = [
  'server/salsa/control-plane/routes/release-routes.js',
  'superadmin/backend/routes/release-routes.js'
];

function getPromotionHandler(router) {
  const layer = router.stack.find((entry) => entry.route?.path === '/releases/:id/promote');
  assert.ok(layer, 'release promotion route is registered');
  return layer.route.stack.at(-1).handle;
}

async function invoke(handler, releaseId = 'v9.8.7') {
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  let forwardedError = null;
  await handler({
    params: { id: releaseId },
    body: { reason: 'Production rollout approved' },
    platformPrincipal: { id: 'release-operator' }
  }, response, (error) => { forwardedError = error || null; });
  return { response, forwardedError };
}

for (const routeModule of routeModules) {
  test(`${routeModule}: direct promotion stays fail-closed without production evidence`, async (t) => {
    const absoluteRoutePath = path.resolve(__dirname, '..', routeModule);
    const router = require(absoluteRoutePath);
    const handler = getPromotionHandler(router);
    const database = require(path.resolve(path.dirname(absoluteRoutePath), '../db/database')).getDatabase();
    const originalQuery = database.query;
    const originalManifestPath = process.env.NEEM_PRODUCTION_GATE_MANIFEST;
    const originalManifestJson = process.env.NEEM_PRODUCTION_GATE_MANIFEST_JSON;
    const queries = [];

    delete process.env.NEEM_PRODUCTION_GATE_MANIFEST;
    delete process.env.NEEM_PRODUCTION_GATE_MANIFEST_JSON;
    database.query = async (sql, params) => {
      queries.push({ sql: String(sql), params });
      if (/^\s*SELECT/i.test(String(sql))) {
        return { rows: [{ id: 'release-row-1', version: 'v9.8.7', status: 'canary' }] };
      }
      throw new Error('Unexpected mutation during blocked promotion test');
    };

    try {
      await t.test('NO_GO readiness prevents all release UPDATEs', async () => {
        const { response, forwardedError } = await invoke(handler);
        assert.equal(forwardedError?.code, 'PRODUCTION_GATE_BLOCKED');
        assert.equal(forwardedError?.status, 409);
        assert.equal(response.body, null);
        assert.equal(queries.length, 1);
        assert.match(queries[0].sql, /^\s*SELECT/i);
        assert.equal(queries.some((query) => /^\s*UPDATE/i.test(query.sql)), false);
      });

      await t.test('non-canary releases cannot be promoted directly', async () => {
        queries.length = 0;
        database.query = async (sql, params) => {
          queries.push({ sql: String(sql), params });
          return { rows: [{ id: 'release-row-1', version: 'v9.8.7', status: 'draft' }] };
        };
        const { response, forwardedError } = await invoke(handler);
        assert.equal(forwardedError, null);
        assert.equal(response.statusCode, 409);
        assert.equal(response.body.error.code, 'RELEASE_NOT_IN_CANARY');
        assert.equal(queries.length, 1);
        assert.equal(queries.some((query) => /^\s*UPDATE/i.test(query.sql)), false);
      });

      await t.test('database failures are forwarded and never reported as promoted', async () => {
        queries.length = 0;
        const databaseError = new Error('database unavailable');
        database.query = async () => { throw databaseError; };
        const { response, forwardedError } = await invoke(handler);
        assert.equal(forwardedError, databaseError);
        assert.equal(response.body, null);
      });
    } finally {
      database.query = originalQuery;
      if (originalManifestPath === undefined) delete process.env.NEEM_PRODUCTION_GATE_MANIFEST;
      else process.env.NEEM_PRODUCTION_GATE_MANIFEST = originalManifestPath;
      if (originalManifestJson === undefined) delete process.env.NEEM_PRODUCTION_GATE_MANIFEST_JSON;
      else process.env.NEEM_PRODUCTION_GATE_MANIFEST_JSON = originalManifestJson;
    }
  });
}
