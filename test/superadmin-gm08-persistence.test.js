'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const viewSource = fs.readFileSync(path.resolve(__dirname, '../prototype/js/views/gm08-features.js'), 'utf8');
const policyRouter = require('../server/salsa/control-plane/routes/policy-routes');

const feature = { key: 'server.menu', nameFa: 'منوی سرور', category: 'catalog', dependencies: [] };

function createHarness({ baseUrl = 'https://admin.example.test', client, switches = [], globalMutationsAvailable = false } = {}) {
  const calls = [];
  const localMutations = [];
  const refreshes = [];
  const toasts = [];
  const controlClient = client || {
    getBaseUrl: () => baseUrl,
    async post(endpoint, body) { calls.push({ method: 'POST', endpoint, body }); return { ok: true, data: null }; },
    async delete(endpoint) { calls.push({ method: 'DELETE', endpoint }); return { ok: true, data: { revoked: true } }; },
    async get(endpoint) {
      calls.push({ method: 'GET', endpoint });
      if (endpoint === '/api/control/policy/catalog') return { ok: true, data: { features: [feature] } };
      if (endpoint === '/api/control/policy/killswitch') return {
        ok: true,
        data: switches,
        capabilities: { globalMutationsAvailable }
      };
      throw new Error(`Unexpected endpoint: ${endpoint}`);
    }
  };
  const window = {
    location: { origin: 'https://admin.example.test', hash: '#gm-08-features' },
    ControlPlaneClient: controlClient,
    GMRouter: { refresh() { refreshes.push(true); } },
    GMApp: { showToast(message, kind) { toasts.push({ message, kind }); } },
    prototypeStore: {
      toggleFeatureGlobal(featureKey, enabled, reason) {
        localMutations.push({ featureKey, enabled, reason });
        return { success: true };
      }
    }
  };
  vm.runInNewContext(viewSource, { window, document: {}, Date, URLSearchParams });
  return { view: window.GMViews.GM08, calls, localMutations, refreshes, toasts };
}

test('GM08 uses the mounted Control Plane kill-switch contract', () => {
  const routes = policyRouter.stack.filter(layer => layer.route).map(layer => ({
    path: layer.route.path,
    methods: Object.keys(layer.route.methods)
  }));
  assert.ok(routes.some(route => route.path === '/killswitch' && route.methods.includes('get')));
  assert.ok(routes.some(route => route.path === '/killswitch' && route.methods.includes('post')));
  assert.ok(routes.some(route => route.path === '/killswitch/:featureKey' && route.methods.includes('delete')));
  const appSource = fs.readFileSync(path.resolve(__dirname, '../server/salsa/control-plane/app.js'), 'utf8');
  assert.match(appSource, /app\.use\(['"]\/api\/control\/policy['"],\s*policyRoutes\)/);
});

test('GM08 reload reads the server catalog and persisted kill-switch state, never local fixtures', async () => {
  const persistedSwitch = {
    status: 'active', featureKey: feature.key, featureKeys: [feature.key],
    reason: 'نگهداری', distributionStatus: 'pending'
  };
  const harness = createHarness({ switches: [persistedSwitch] });

  await harness.view.loadServerSnapshot();
  const html = harness.view.render();

  assert.match(html, /منوی سرور/);
  assert.match(html, /ارسال: در انتظار ارسال/);
  assert.match(html, /توقف سراسری در دسترس نیست/);
  assert.doesNotMatch(html, /قابلیت آزمایشی|محیط عملیاتی وستو|پایگاه داده عملیاتی وستو/);
  assert.doesNotMatch(html, /\d[\d٬,]*\s*تومان/);
  assert.deepEqual(harness.localMutations, []);
});

test('GM08 reports an honest empty catalog and does not substitute local records', async () => {
  const harness = createHarness({ client: {
    getBaseUrl: () => 'https://admin.example.test',
    async get(endpoint) {
      if (endpoint.endsWith('/catalog')) return { ok: true, data: { features: [] } };
      return { ok: true, data: [] };
    },
    async post() { throw new Error('unexpected write'); },
    async delete() { throw new Error('unexpected write'); }
  } });

  await harness.view.loadServerSnapshot();
  const html = harness.view.render();

  assert.match(html, /کاتالوگ سرور خالی است/);
  assert.doesNotMatch(html, /قابلیت آزمایشی|tnt_westo_demo/);
});

test('GM08 shows load failure instead of operational-looking fallback data', async () => {
  const harness = createHarness({ client: {
    getBaseUrl: () => 'https://admin.example.test',
    async get() { throw new Error('control plane unavailable'); },
    async post() { throw new Error('unexpected write'); },
    async delete() { throw new Error('unexpected write'); }
  } });

  await harness.view.loadServerSnapshot();

  assert.match(harness.view.render(), /control plane unavailable/);
  assert.equal(harness.view.catalogSnapshot, null);
});

test('GM08 refuses cross-origin mutations without local or remote writes', async () => {
  const harness = createHarness({
    baseUrl: 'https://control.example.test',
    client: {
      getBaseUrl: () => 'https://control.example.test',
      async post() { throw new Error('write must not be attempted'); },
      async delete() { throw new Error('write must not be attempted'); },
      async get() { throw new Error('read must not be attempted'); }
    }
  });

  const result = await harness.view.runGlobalMutation({ featureKey: feature.key, enabled: false, reason: 'maintenance' });

  assert.equal(result, null);
  assert.deepEqual(harness.localMutations, []);
  assert.match(harness.view.mutationError, /مبدأ همین صفحه/);
});

test('GM08 disables and refuses global actions while durable cell fan-out is unavailable', async () => {
  const harness = createHarness();
  await harness.view.loadServerSnapshot();
  const html = harness.view.render();
  const result = await harness.view.runGlobalMutation({ featureKey: feature.key, enabled: false, reason: 'maintenance' }, { refresh: false });

  assert.equal(result, null);
  assert.match(html, /fan-out پایدار به همهٔ cellها/);
  assert.match(html, /class="btn btn-sm btn-outline-danger" disabled/);
  assert.deepEqual(harness.calls.filter(call => call.method === 'POST' || call.method === 'DELETE'), []);
  assert.deepEqual(harness.localMutations, []);
  assert.match(harness.view.mutationError, /GLOBAL_KILLSWITCH_FANOUT_NOT_IMPLEMENTED/);
});

test('GM08 only reports a kill-switch after server readback confirms persisted state', async () => {
  let stored = [];
  const calls = [];
  const harness = createHarness({ globalMutationsAvailable: true, client: {
    getBaseUrl: () => 'https://admin.example.test',
    async post(endpoint, body) {
      calls.push(['POST', endpoint, body]);
      stored = [{ status: 'active', featureKey: body.featureKey, featureKeys: [body.featureKey], distributionStatus: 'synced' }];
      return { ok: true, data: stored[0] };
    },
    async delete() { throw new Error('unexpected delete'); },
    async get(endpoint) {
      calls.push(['GET', endpoint]);
      if (endpoint.endsWith('/catalog')) return { ok: true, data: { features: [feature] } };
      return { ok: true, data: stored, capabilities: { globalMutationsAvailable: true } };
    }
  } });
  await harness.view.loadServerSnapshot();

  const result = await harness.view.runGlobalMutation({ featureKey: feature.key, enabled: false, reason: 'maintenance' }, { refresh: false });

  assert.equal(result.serverConfirmed, true);
  assert.deepEqual(calls.map(call => call[0]), ['GET', 'GET', 'POST', 'GET']);
  assert.equal(harness.view.catalogSnapshot.killSwitches[0].distributionStatus, 'synced');
  assert.deepEqual(harness.localMutations, []);
});

test('GM08 distinguishes persisted policy from failed distribution after a 502', async () => {
  const stored = [{ status: 'active', featureKey: feature.key, featureKeys: [feature.key], distributionStatus: 'failed' }];
  const harness = createHarness({ globalMutationsAvailable: true, client: {
    getBaseUrl: () => 'https://admin.example.test',
    async post() { const error = new Error('POLICY_SYNC_FAILED'); error.status = 502; throw error; },
    async delete() { throw new Error('unexpected delete'); },
    async get(endpoint) {
      if (endpoint.endsWith('/catalog')) return { ok: true, data: { features: [feature] } };
      return { ok: true, data: stored, capabilities: { globalMutationsAvailable: true } };
    }
  } });
  await harness.view.loadServerSnapshot();

  const result = await harness.view.runGlobalMutation({ featureKey: feature.key, enabled: false, reason: 'maintenance' }, { refresh: false });

  assert.equal(result, null);
  assert.match(harness.view.mutationError, /ذخیره شد، اما انتشار.*ناموفق/);
  assert.match(harness.view.render(), /ارسال: آخرین تلاش ناموفق/);
  assert.deepEqual(harness.localMutations, []);
});

test('GM08 restore is confirmed only after the server returns no active kill switch', async () => {
  const calls = [];
  const harness = createHarness({ globalMutationsAvailable: true, client: {
    getBaseUrl: () => 'https://admin.example.test',
    async post() { throw new Error('unexpected post'); },
    async delete(endpoint) { calls.push(['DELETE', endpoint]); return { ok: true, data: { revoked: true } }; },
    async get(endpoint) {
      calls.push(['GET', endpoint]);
      if (endpoint.endsWith('/catalog')) return { ok: true, data: { features: [feature] } };
      return { ok: true, data: [], capabilities: { globalMutationsAvailable: true } };
    }
  } });
  await harness.view.loadServerSnapshot();

  const result = await harness.view.runGlobalMutation({ featureKey: feature.key, enabled: true, reason: '' }, { refresh: false });

  assert.equal(result.serverConfirmed, true);
  assert.deepEqual(calls.slice(-2).map(call => call[0]), ['DELETE', 'GET']);
  assert.deepEqual(harness.localMutations, []);
});
