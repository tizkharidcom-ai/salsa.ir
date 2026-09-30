'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const repositorySource = fs.readFileSync(path.join(root, 'prototype/js/godmode/domain/commercial/repository.js'), 'utf8');
const viewSource = fs.readFileSync(path.join(root, 'prototype/js/views/gm10-plans.js'), 'utf8');

function makeRepository(client, prototypeStore) {
  const window = { ControlPlaneClient: client, prototypeStore };
  const module = { exports: {} };
  vm.runInNewContext(repositorySource, { window, module, console }, { filename: 'commercial-repository.js' });
  return module.exports;
}

function makeView(repository, options = {}) {
  const content = { innerHTML: '', addEventListener() {}, removeEventListener() {} };
  const confirmation = { current: null };
  const window = {
    CommercialRepository: repository,
    crypto: { randomUUID: () => 'gm10-idempotency-0001' },
    GodModeConfirmDialog: {
      show(value) { confirmation.current = value; }
    },
    GMApp: {
      openDrawer(_title, html) { window.drawerHtml = html; },
      closeDrawer() {},
      showToast(message) { window.lastToast = message; }
    }
  };
  if (options.storeGetter) {
    Object.defineProperty(window, 'prototypeStore', {
      get() { throw new Error('GM10 must not access the local fixture store'); }
    });
  }
  const document = { getElementById: id => id === 'gm10-live-content' ? content : null };
  vm.runInNewContext(viewSource, { window, document, console, FormData }, { filename: 'gm10-plans.js' });
  return { view: window.GMViews.GM10, window, content, confirmation };
}

function session(role = 'platform_owner') {
  return { data: { principal: { id: 'cp-principal', role }, session: { csrfToken: 'session-bound-csrf' } } };
}

const apiPlan = {
  planCode: 'api_custom_catalog',
  version: '7.4.2',
  isDraft: false,
  isCustom: false,
  nameFa: 'نام واقعی از پاسخ API',
  descriptionFa: 'شرح کنترل‌پلن',
  basePriceMonthlyRials: 76543210,
  basePriceMonthlyToman: 7654321,
  basePriceAnnualRials: 91851852,
  basePriceAnnualToman: 9185185,
  includedBranches: 2,
  includedDevices: 3,
  includedUsers: 6,
  includedFeatures: ['api_feature_alpha'],
  quotas: { maxBranches: 2, maxDevices: 3, maxUsers: 6, maxOrders: 2468, maxStorageMb: 13579, maxSms: 864 },
  effectiveFrom: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-20T12:30:00.000Z',
  pricingSource: 'postgres_plan_version'
};

test('GM10 reads the exact private Control Plane plans endpoint and ignores store plans', async () => {
  const paths = [];
  const fixtureStore = { state: { plans: [{ name: 'LOCAL FIXTURE PRICE', price: 999999999 }] } };
  const client = {
    async get(endpoint) {
      paths.push(endpoint);
      return { data: [apiPlan], meta: { source: 'control-plane', status: 'live', observedAt: '2026-09-24T00:00:00.000Z' } };
    }
  };
  const repository = makeRepository(client, fixtureStore);

  const plans = await repository.listPlans();

  assert.deepEqual(paths, ['/api/control/billing/plans?includeDrafts=true']);
  assert.deepEqual(plans, [apiPlan]);
  assert.equal(plans[0].basePriceMonthlyToman, 7654321);
  assert.equal(repository.lastPlansMeta.source, 'control-plane');
});

test('GM10 preserves a valid empty API catalog and propagates network errors without fixture fallback', async () => {
  const emptyRepository = makeRepository({ get: async () => ({ data: [] }) }, { state: { plans: [apiPlan] } });
  assert.deepEqual(await emptyRepository.listPlans(), []);

  const offlineRepository = makeRepository({ get: async () => { throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }); } }, { state: { plans: [apiPlan] } });
  await assert.rejects(offlineRepository.listPlans(), error => error.code === 'ECONNREFUSED');
});

test('GM10 gets feature comparison only from the Control Plane matrix endpoint', async () => {
  const paths = [];
  const matrix = {
    plans: [apiPlan],
    featureComparison: [{ key: 'api_feature_alpha', nameFa: 'قابلیت مرجع API', plans: { api_custom_catalog: true } }]
  };
  const repository = makeRepository({
    get: async endpoint => {
      paths.push(endpoint);
      return { data: matrix, meta: { source: 'control-plane' } };
    }
  });

  assert.deepEqual(await repository.getPlanMatrix(), matrix);
  assert.deepEqual(paths, ['/api/control/billing/plans/matrix']);
});

test('draft and publish POSTs require a live authorized session and carry CSRF plus idempotency headers', async () => {
  const calls = [];
  const client = {
    async get(endpoint) {
      assert.equal(endpoint, '/api/control/auth/session');
      return session('platform_operations');
    },
    async post(...args) {
      calls.push(args);
      return { data: { plan: apiPlan, newVersion: apiPlan.version } };
    }
  };
  const repository = makeRepository(client);
  const draftPayload = {
    planCode: apiPlan.planCode,
    version: '7.4.3',
    nameFa: apiPlan.nameFa,
    descriptionFa: apiPlan.descriptionFa,
    basePriceMonthlyRials: apiPlan.basePriceMonthlyRials,
    includedBranches: apiPlan.includedBranches,
    includedDevices: apiPlan.includedDevices,
    includedUsers: apiPlan.includedUsers,
    includedFeatures: apiPlan.includedFeatures,
    quotas: apiPlan.quotas
  };
  await repository.createPlanDraft(draftPayload, { idempotencyKey: 'draft-key-0001' });
  await repository.publishPlanDraft(apiPlan.planCode, { idempotencyKey: 'publish-key-001' });

  assert.equal(calls[0][0], '/api/control/billing/plans/draft');
  assert.deepEqual(calls[0][1], draftPayload);
  assert.equal(calls[0][2].headers['Idempotency-Key'], 'draft-key-0001');
  assert.equal(calls[0][2].headers['X-CSRF-Token'], 'session-bound-csrf');
  assert.equal(calls[1][0], '/api/control/billing/plans/api_custom_catalog/publish');
  assert.equal(JSON.stringify(calls[1][1]), '{}');
  assert.equal(calls[1][2].headers['Idempotency-Key'], 'publish-key-001');
  assert.equal(calls[1][2].headers['X-CSRF-Token'], 'session-bound-csrf');
});

test('GM10 blocks pricing writes when the authenticated role is not accepted by the backend', async () => {
  let postCalls = 0;
  const repository = makeRepository({
    get: async () => session('platform_finance'),
    post: async () => { postCalls += 1; return { data: {} }; }
  });
  const access = await repository.getPlanMutationAccess();
  assert.equal(access.allowed, false);
  await assert.rejects(
    repository.createPlanDraft({ planCode: apiPlan.planCode }, { idempotencyKey: 'draft-key-0002' }),
    error => error.code === 'INSUFFICIENT_PLATFORM_PERMISSIONS'
  );
  assert.equal(postCalls, 0);
});

test('GM10 renders returned API price, quota, and feature data and never reads a local store', async () => {
  const matrix = {
    plans: [apiPlan],
    featureComparison: [{ key: 'api_feature_alpha', nameFa: 'نام قابلیت ماتریس', plans: { api_custom_catalog: true } }]
  };
  const repository = {
    lastPlansMeta: { observedAt: '2026-09-24T00:00:00.000Z' },
    async listPlans() { return [apiPlan]; },
    async getPlanMatrix() { return matrix; },
    async getPlanMutationAccess() { return { allowed: true, role: 'platform_owner', csrfToken: 'csrf' }; }
  };
  const mounted = makeView(repository, { storeGetter: true });
  await mounted.view.load();
  const html = mounted.view.render();

  assert.match(html, /نام واقعی از پاسخ API/);
  assert.match(html, /۷٬۶۵۴٬۳۲۱/);
  assert.match(html, /۱۳٬۵۷۹/);
  assert.match(html, /نام قابلیت ماتریس/);
  assert.match(html, /Control Plane API/);
  assert.doesNotMatch(html, /LOCAL FIXTURE PRICE|۹۹.۹٪|SLA|990000|1850000|3400000/);
});

test('GM10 distinguishes a network failure from a successful empty catalog', async () => {
  const matrix = { plans: [], featureComparison: [] };
  const offline = makeView({
    async listPlans() { throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }); },
    async getPlanMatrix() { return matrix; },
    async getPlanMutationAccess() { return { allowed: false, reason: 'no session' }; }
  });
  await offline.view.load();
  assert.equal(offline.view.state.status, 'failed');
  assert.match(offline.content.innerHTML, /دریافت کاتالوگ پلن‌ها ناموفق بود/);
  assert.match(offline.content.innerHTML, /ارتباط با Control Plane برقرار نشد/);

  const empty = makeView({
    async listPlans() { return []; },
    async getPlanMatrix() { return matrix; },
    async getPlanMutationAccess() { return { allowed: false, reason: 'no session' }; }
  });
  await empty.view.load();
  assert.equal(empty.view.state.status, 'empty');
  assert.match(empty.content.innerHTML, /کاتالوگ API خالی است/);
  assert.doesNotMatch(empty.content.innerHTML, /دریافت کاتالوگ پلن‌ها ناموفق بود/);
});

test('GM10 disables mutation controls with an actionable reason when session or source quotas are unsafe', async () => {
  const noAccess = makeView({
    async listPlans() { return [apiPlan]; },
    async getPlanMatrix() { return { plans: [apiPlan], featureComparison: [{ key: 'api_feature_alpha', nameFa: 'قابلیت', plans: { api_custom_catalog: true } }] }; },
    async getPlanMutationAccess() { return { allowed: false, reason: 'نقش platform_finance مجاز نیست.' }; }
  });
  await noAccess.view.load();
  assert.match(noAccess.view.render(), /data-gm10-action="new-draft"[^>]*disabled/);
  assert.match(noAccess.view.render(), /نقش platform_finance مجاز نیست/);

  const unsafePlan = { ...apiPlan, quotas: { maxBranches: 2, maxDevices: 3, maxUsers: 6, maxOrders: 2468, maxStorageMb: 13579 } };
  const unsafe = makeView({
    async listPlans() { return [unsafePlan]; },
    async getPlanMatrix() { return { plans: [unsafePlan], featureComparison: [{ key: 'api_feature_alpha', nameFa: 'قابلیت', plans: { api_custom_catalog: true } }] }; },
    async getPlanMutationAccess() { return { allowed: true, role: 'platform_owner', csrfToken: 'csrf' }; }
  });
  await unsafe.view.load();
  assert.match(unsafe.view.render(), /maxSms/);
  assert.match(unsafe.view.render(), /data-gm10-action="new-draft"[^>]*disabled/);
});

test('GM10 publishing requires an explicit confirmation and reuses the idempotency key after an uncertain failure', async () => {
  let attempts = 0;
  const keys = [];
  const repository = {
    async listPlans() { return [{ ...apiPlan, isDraft: true, version: '7.4.3' }]; },
    async getPlanMatrix() { return { plans: [], featureComparison: [] }; },
    async getPlanMutationAccess() { return { allowed: true, role: 'platform_owner', csrfToken: 'csrf' }; },
    async publishPlanDraft(_code, options) {
      keys.push(options.idempotencyKey);
      attempts += 1;
      if (attempts === 1) throw new Error('response lost');
      return { data: { plan: { planCode: apiPlan.planCode, version: '7.4.3', isDraft: false }, impactedTenantsCount: 0 } };
    }
  };
  const mounted = makeView(repository);
  await mounted.view.load();

  mounted.view.confirmPublish(apiPlan.planCode, '7.4.3');
  assert.equal(attempts, 0, 'the POST must wait for the confirmation step');
  await assert.rejects(mounted.confirmation.current.onConfirm(), /response lost/);
  mounted.view.confirmPublish(apiPlan.planCode, '7.4.3');
  await mounted.confirmation.current.onConfirm();

  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.equal(mounted.view.state.lastMutationResult.data.impactedTenantsCount, 0);
});
