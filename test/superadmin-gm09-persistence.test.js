'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const viewSource = fs.readFileSync(
  path.join(__dirname, '../prototype/js/views/gm09-tenant-features.js'),
  'utf8',
);
const entitlementsRepository = require('../prototype/js/godmode/domain/entitlements/repository');
const frontendEntitlementsRepository = require('../superadmin/frontend/js/godmode/domain/entitlements/repository');

const tenantId = 'tenant-one';
const feature = {
  key: 'crm.loyalty', nameFa: 'باشگاه مشتریان', category: 'marketing', dependencies: [],
  moduleKey: 'crm', commercialState: 'addon', lifecycle: 'ga', baseEntitlement: false
};

function createServerState({ enabled = false, tenantResponseId = tenantId, effectiveTenantId = tenantId } = {}) {
  return {
    tenant: { id: tenantResponseId, displayName: 'مشتری ثبت‌شده', status: 'active', planCode: 'پایه', metadata: { branchesCount: 2 } },
    catalog: { features: [{ ...feature, priceMonthlyIrr: 99999999 }] },
    effectiveTenantId,
    enabled,
    grants: enabled ? [{ tenantId, featureKey: feature.key, grantKind: 'addon', status: 'ACTIVE', isActive: true }] : []
  };
}

function createHarness({ state = createServerState(), failReads = false, syncFailure = false } = {}) {
  const calls = [];
  const toasts = [];
  let drawer = '';
  const nodes = {
    addonDependencyBox: { textContent: '', innerHTML: '' },
    addonPricingBox: { textContent: '', innerHTML: '' }
  };
  const client = {
    getBaseUrl: () => 'https://admin.example.test',
    async get(endpoint) {
      calls.push({ method: 'GET', endpoint });
      if (failReads) throw new Error('control plane unavailable');
      if (endpoint === `/api/control/tenants/${tenantId}`) return { ok: true, data: state.tenant };
      if (endpoint === '/api/control/policy/catalog') return { ok: true, data: state.catalog };
      if (endpoint === `/api/control/policy/effective/${tenantId}`) {
        return {
          ok: true,
          data: {
            tenantId: state.effectiveTenantId,
            tenantStatus: 'active',
            features: {
              [feature.key]: {
                enabled: state.enabled,
                source: state.enabled ? 'grant' : 'catalog',
                reason: state.enabled ? 'مجوز سرور' : 'مجوزی ثبت نشده'
              }
            }
          }
        };
      }
      if (endpoint === `/api/control/policy/grants/${tenantId}`) return { ok: true, data: state.grants };
      throw new Error(`Unexpected endpoint ${endpoint}`);
    },
    async post(endpoint, body) {
      calls.push({ method: 'POST', endpoint, body });
      if (endpoint === '/api/control/policy/grants') {
        state.enabled = true;
        state.grants = [{ tenantId: body.tenantId, featureKey: body.featureKey, grantKind: body.grantKind, status: 'ACTIVE', isActive: true }];
        if (syncFailure) {
          const error = new Error('POLICY_SYNC_FAILED');
          error.status = 502;
          throw error;
        }
        return { ok: true, data: { tenantId: body.tenantId, featureKey: body.featureKey, policyApplied: true } };
      }
      if (endpoint === '/api/control/policy/toggle') {
        state.enabled = body.enabled === true;
        if (!state.enabled) state.grants = [];
        return { ok: true, data: { tenantId: body.tenantId, enabled: false, results: [{ featureKey: body.featureKey, policyApplied: true }] } };
      }
      throw new Error(`Unexpected endpoint ${endpoint}`);
    }
  };
  const window = {
    GMViews: {},
    ControlPlaneClient: client,
    prototypeStore: {
      getFeatures() { throw new Error('GM09 must not read local fixture features'); },
      grantAddon() { throw new Error('GM09 must not write local fixtures'); },
      revokeAddon() { throw new Error('GM09 must not write local fixtures'); }
    },
    GMApp: {
      showToast: (message, kind) => toasts.push({ message, kind }),
      closeDrawer() {},
      openDrawer(_title, content) { drawer = content; }
    },
    GMRouter: { refresh() {} },
    location: { hash: `#gm-09-tenant-features?id=${tenantId}` }
  };
  const document = {
    getElementById(id) {
      if (id === 'addonSelect') return { value: feature.key };
      if (id === 'addonDuration') return { value: '3' };
      return nodes[id] || null;
    }
  };
  vm.runInNewContext(viewSource, { window, document }, { filename: 'gm09-tenant-features.js' });
  return { window, calls, toasts, state, client, nodes, get drawer() { return drawer; } };
}

async function settleLoads() {
  await new Promise(resolve => setImmediate(resolve));
}

test('GM09 with no tenant selection makes no API request and never selects the demo tenant', () => {
  const harness = createHarness();
  const html = harness.window.renderGM09({});

  assert.match(html, /مستأجر انتخاب نشده است/);
  assert.doesNotMatch(html, /tnt_westo_demo|مشتری ثبت‌شده/);
  assert.deepEqual(harness.calls, []);
});

test('GM09 reload renders persisted server grants, tenant scope, and no synthetic price', async () => {
  const harness = createHarness({ state: createServerState({ enabled: true }) });
  harness.window.renderGM09({ id: tenantId });
  await settleLoads();
  const html = harness.window.renderGM09({ id: tenantId });

  assert.match(html, /مشتری ثبت‌شده/);
  assert.match(html, /فعال در سیاست مؤثر سرور|مجوز سرور/);
  assert.match(html, /سیاست مشترک همهٔ شعب/);
  assert.match(html, /تصمیم نقش‌ها باز است/);
  assert.match(html, /Platform Admin/);
  assert.match(html, /Restaurant Owner/);
  assert.match(html, /مجوزهای نقش‌های مستأجر و مرز RBAC تغییر داده نشده‌اند/);
  assert.match(html, /قیمت مصوب و وضعیت همگام‌سازی پس از ثبت از API فعلی قابل تأیید نیست/);
  assert.doesNotMatch(html, /۹۹٬۹۹۹٬۹۹۹|99999999|tnt_westo_demo|محیط عملیاتی وستو/);
  assert.equal(harness.calls.some(call => call.endpoint.includes('/api/control/policy/effective/tenant-one')), true);
});

test('GM09 reloads persisted policy in a fresh view context rather than carrying local state', async () => {
  const serverState = createServerState({ enabled: true });
  const firstPage = createHarness({ state: serverState });
  firstPage.window.renderGM09({ id: tenantId });
  await settleLoads();
  assert.match(firstPage.window.renderGM09({ id: tenantId }), /فعال در سیاست مؤثر سرور|مجوز سرور/);

  const reloadedPage = createHarness({ state: serverState });
  reloadedPage.window.renderGM09({ id: tenantId });
  await settleLoads();
  const htmlAfterReload = reloadedPage.window.renderGM09({ id: tenantId });

  assert.match(htmlAfterReload, /فعال در سیاست مؤثر سرور|مجوز سرور/);
  assert.equal(reloadedPage.calls.filter(call => call.method === 'GET').length, 4);
  assert.equal(reloadedPage.calls.some(call => call.endpoint.includes('tnt_westo_demo')), false);
});

test('GM09 refuses a server response belonging to another tenant', async () => {
  const harness = createHarness({ state: createServerState({ effectiveTenantId: 'tenant-other' }) });
  harness.window.renderGM09({ id: tenantId });
  await settleLoads();

  assert.match(harness.window.renderGM09({ id: tenantId }), /دامنه یا ساختار پاسخ با مستأجر درخواستی هم‌خوان نیست/);
  assert.equal(harness.window.renderGM09({ id: tenantId }).includes('مشتری ثبت‌شده'), false);
});

test('GM09 read failure is an error state and does not fall back to seed data', async () => {
  const harness = createHarness({ failReads: true });
  harness.window.renderGM09({ id: tenantId });
  await settleLoads();

  const html = harness.window.renderGM09({ id: tenantId });
  assert.match(html, /control plane unavailable/);
  assert.doesNotMatch(html, /tnt_westo_demo|باشگاه مشتریان/);
});

test('GM09 grant becomes saved only after server write and readback, without local mutation', async () => {
  const harness = createHarness();

  harness.window.renderGM09({ id: tenantId });
  await settleLoads();
  const result = await harness.window.quickSellFeature(tenantId, feature.key);
  const html = harness.window.renderGM09({ id: tenantId });

  assert.equal(result, true);
  assert.equal(harness.state.enabled, true);
  assert.equal(harness.calls.filter(call => call.method === 'GET').length, 8);
  assert.match(html, /ذخیره‌شده در کنترل‌پلن/);
  assert.equal(harness.window.location.hash.startsWith(`#gm-09-tenant-features?id=${tenantId}`), true);
});

test('GM09 distinguishes committed policy from failed tenant-service sync', async () => {
  const harness = createHarness({ syncFailure: true });
  harness.window.renderGM09({ id: tenantId });
  await settleLoads();

  const result = await harness.window.quickSellFeature(tenantId, feature.key);
  const html = harness.window.renderGM09({ id: tenantId });

  assert.equal(result, false);
  assert.equal(harness.state.enabled, true);
  assert.match(html, /ذخیره‌شده؛ همگام‌سازی ناموفق/);
  assert.match(html, /سیاست در کنترل‌پلن ذخیره شده، اما همگام‌سازی سرویس مستأجر ناموفق است/);
});

test('GM09 disable uses tenant-scoped server policy and readback', async () => {
  const harness = createHarness({ state: createServerState({ enabled: true }) });
  harness.window.renderGM09({ id: tenantId });
  await settleLoads();

  const result = await harness.window.toggleTenantFeature(tenantId, feature.key);

  assert.equal(result, true);
  const request = harness.calls.find(call => call.method === 'POST' && call.endpoint === '/api/control/policy/toggle');
  assert.equal(request.body.tenantId, tenantId);
  assert.equal(request.body.enabled, false);
  assert.equal(harness.state.enabled, false);
  assert.equal(harness.calls.some(call => call.endpoint === '/api/control/policy/grants'), false);
});

test('GM09 addon drawer omits catalog prices and discloses that pricing is unavailable', async () => {
  const harness = createHarness();
  harness.window.renderGM09({ id: tenantId });
  await settleLoads();

  harness.window.openSellAddonDrawer(tenantId);

  assert.match(harness.drawer, /id="addonPricingBox"/);
  assert.match(harness.nodes.addonPricingBox.innerHTML, /قیمت مصوب\/مبلغ فاکتور در API موجود نیست/);
  assert.doesNotMatch(harness.drawer, /99999999|۹۹٬۹۹۹٬۹۹۹/);
});

test('entitlements repository uses server catalog and effective state without store or price fallback', async () => {
  const calls = [];
  entitlementsRepository.client = {
    async get(endpoint) {
      calls.push(endpoint);
      if (endpoint === '/api/control/policy/modules') return { ok: true, data: { modules: [{
        key: 'crm', nameFa: 'باشگاه', technicalFeatures: [feature.key], priceMonthlyIrr: 99999999
      }] } };
      if (endpoint === `/api/control/policy/effective/${tenantId}`) return { ok: true, data: {
        tenantId, features: { [feature.key]: { enabled: true, reason: 'مجوز سرور' } }
      } };
      if (endpoint === `/api/control/tenants/${tenantId}`) return { ok: true, data: { id: tenantId, displayName: 'مشتری ثبت‌شده' } };
      throw new Error(`Unexpected endpoint ${endpoint}`);
    }
  };

  const result = await entitlementsRepository.calculateEffectiveEntitlements(tenantId);

  assert.equal(result.source, 'control-plane');
  assert.equal(result.tenantId, tenantId);
  assert.equal(result.modules[0].state, 'enabled');
  assert.equal('priceMonthlyIrr' in result.modules[0], false);
  assert.deepEqual(calls, [
    '/api/control/policy/modules',
    `/api/control/policy/effective/${tenantId}`,
    `/api/control/tenants/${tenantId}`
  ]);
  assert.equal(entitlementsRepository.store, undefined);
});

test('entitlements repository rejects mismatched tenant and unavailable server instead of local fallback', async () => {
  entitlementsRepository.client = { async get() { return { ok: true, data: { tenantId: 'tenant-other', features: {} } }; } };
  await assert.rejects(entitlementsRepository.getEffectiveEntitlements(tenantId), /متعلق به مستأجر درخواستی نیست/);

  entitlementsRepository.client = { async get() { throw new Error('offline'); } };
  await assert.rejects(entitlementsRepository.getEffectiveEntitlements(tenantId), /offline/);
  assert.equal(entitlementsRepository.store, undefined);
});

test('entitlements repository keeps failed distribution distinct from policy application', async () => {
  entitlementsRepository.client = {
    async post(_endpoint, body) {
      return { ok: true, data: {
        tenantId: body.tenantId,
        enabled: body.enabled,
        featureKeys: body.featureKeys,
        results: [{ featureKey: body.featureKeys[0], policyApplied: true, syncedToWesto: false }]
      } };
    }
  };

  await assert.rejects(
    entitlementsRepository.toggleModuleForTenant(tenantId, feature.key, true),
    error => error.syncPending === true && error.policyApplied === true
  );
});

test('entitlements mutations require their specific API method instead of failing with a raw TypeError', async () => {
  const repository = new entitlementsRepository.constructor({
    async get() { return { ok: true, data: {} }; }
  });

  await assert.rejects(
    repository.toggleModuleForTenant(tenantId, feature.key, true),
    /امکان ثبت در دسترس نیست/
  );
});

test('production Super Admin replaces its bundled module map with an empty server catalog', async () => {
  const repository = new frontendEntitlementsRepository.constructor({
    async get() { return { ok: true, data: { modules: [] } }; }
  });
  repository._appMode = { isProduction: () => true };

  assert.ok(repository.getBusinessModules().length > 0, 'test begins with the bundled compatibility map');
  await assert.rejects(repository.refreshBusinessModules(), /MODULE_CATALOG_INVALID/);
  assert.deepEqual(repository.getBusinessModules(), []);
});
