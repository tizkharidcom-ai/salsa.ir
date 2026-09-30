'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const runtime = require('../modules/runtime');
const sourceView = require('../modules/source-view');
const { buildRelease } = require('../scripts/build-westo-module-release');
const { createBlankTenantDb } = require('../server/salsa/tenant-registry');
const { resolveFeatureForRoute, isFeatureEnabledForTenant } = require('../server/salsa/canonical-features');
const { customerAccessSnapshot, withoutUnsubscribedFinance } = require('../modules/platform_core/server/module-access');
const { ModuleReleaseService } = require('../server/salsa/control-plane/policy/module-release-service');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

test('all canonical module files have one implementation, preserved aliases, and sealed releases', () => {
  assert.equal(runtime.catalog().length, 14);
  for (const { key } of runtime.catalog()) {
    const definition = runtime.getDefinition(key);
    assert.equal(runtime.verifyRelease(key, '1.0.0').valid, true, key);
    assert.equal(buildRelease(key).unchanged, true, key);
    for (const file of definition.files) {
      const legacy = path.join(runtime.ROOT, file.legacyPath);
      const canonical = path.join(runtime.ROOT, 'modules', key, file.path);
      assert.equal(fs.lstatSync(legacy).isSymbolicLink(), true, file.legacyPath);
      assert.equal(fs.realpathSync(legacy), fs.realpathSync(canonical));
    }
  }
  assert.equal(runtime.resolveFrontendAsset('js/admin.js', {}), null);
  assert.equal(runtime.resolveFrontendAsset('js/content-bootstrap.static.js', runtime.defaultVersions()), null);
  assert.equal(runtime.getRelease('platform_core', '1.0.0').assets.some(asset => asset.legacyPath === 'js/content-bootstrap.static.js'), false);
  assert.throws(() => runtime.getRelease('menu_qr', '../../server'), { code: 'module_version_invalid' });
  assert.throws(() => runtime.validateSelections({ menu_qr: '3.0.0' }), { code: 'module_release_unavailable' });
  assert.throws(() => runtime.getDefinition('unknown'), { code: 'module_unknown' });
  assert.equal(runtime.resolveFrontendAsset('../server/server.js', runtime.defaultVersions()), null);
});

test('218 route bodies and 37 admin views preserve the original logical program after extraction', () => {
  const routes = require('../modules/http-routes.json').routes;
  const views = require('../modules/admin-views.json').views;
  assert.equal(routes.length, 218);
  assert.equal(views.length, 37);
  for (const route of routes) assert.equal(hash(sourceView.routeStatement(route.moduleKey, route.id)), route.originalSha256, route.path);
  for (const view of views) assert.equal(hash(sourceView.viewProperty(view.moduleKey, view.tab)), view.originalSha256, view.tab);
});

test('blank tenant gets actual versions and no WESTO commercial records; subscriptions never remove data', () => {
  const db = createBlankTenantDb('darbar', { name: 'دربار' });
  for (const key of ['menuItems', 'products', 'orders', 'reservations', 'users', 'tables']) assert.deepEqual(db[key], []);
  assert.deepEqual(db.tenantIdentity.moduleVersions, runtime.defaultVersions());
  assert.equal(db.financeV2.rollout.captureEnabled, true);
  const snapshot = customerAccessSnapshot(db);
  assert.equal(snapshot.features['catalog.menu'], true);
  assert.equal(snapshot.features['finance.workspace'], false);
  assert.equal(snapshot.features['kitchen.kds'], false);
  const event = { id: 'historic-sale' };
  db.financeV2.events.push(event);
  db.featureEntitlements['finance.workspace'] = { status: 'active', active: true };
  assert.equal(customerAccessSnapshot(db).features['finance.workspace'], true);
  for (const grant of [false, { active: true, status: 'revoked' }, { active: true, expiresAt: '2020-01-01' }, { active: true, expiresAt: 'invalid' }]) {
    db.featureEntitlements['finance.workspace'] = grant;
    assert.equal(isFeatureEnabledForTenant(db, 'finance.workspace'), false);
    assert.equal(db.financeV2.events[0], event);
  }
  assert.deepEqual(withoutUnsubscribedFinance(db, { order: { id: 1 }, finance: { journalEntry: { id: 2 } }, financeReceipt: {} }), { order: { id: 1 } });
});

test('legacy finance endpoints and alternative operational APIs cannot bypass module access', () => {
  for (const route of ['/v1/reports/pnl', '/v1/exports/general-journal', '/v1/audit/integrity', '/v1/tax/einvoices', '/api/tax/einvoices', '/v1/expenses', '/api/admin/v2/finance/events']) {
    assert.equal(resolveFeatureForRoute(route), 'finance.workspace', route);
  }
  assert.equal(resolveFeatureForRoute('/v1/pos/sales/1'), 'orders.pos');
  assert.equal(resolveFeatureForRoute('/api/admin/v2/kitchen'), 'kitchen.kds');
  assert.equal(resolveFeatureForRoute('/api/admin/v2/crm'), 'crm.directory');
  assert.equal(resolveFeatureForRoute('/api/admin/v2/floor'), 'floor.tables');
  assert.equal(resolveFeatureForRoute('/api/admin/wallet/adjust'), 'crm.wallet');
  assert.equal(resolveFeatureForRoute('/api/content', 'GET'), null);
  assert.equal(resolveFeatureForRoute('/api/content', 'POST'), 'content.website');
});

test('admin view factory retains receiver and live context values across invocations', async () => {
  const sandbox = { window: {}, console };
  vm.runInNewContext(fs.readFileSync(path.join(runtime.ROOT, 'js/admin/modules/core/registry.js'), 'utf8'), sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(runtime.ROOT, 'modules/crm/frontend/admin-views.js'), 'utf8'), sandbox);
  const calls = [], receiver = { name: 'existing-tabs' };
  const context = { tabs: { club(...args) { calls.push([this, ...args]); return 'same-view'; } } };
  await sandbox.window.WestoAdminModules.invokeView('crm', 'sms', context, receiver, []);
  assert.equal(calls[0][1], 'sms');
  context.tabs = { club(...args) { calls.push([this, ...args]); return 'updated-context'; } };
  await sandbox.window.WestoAdminModules.invokeView('crm', 'sms', context, receiver, []);
  assert.equal(calls.length, 2);
  sandbox.window.WestoAdminModules.defineView('test', 'receiver', ctx => function(value) { ctx.value = value; return this.name; });
  assert.equal(sandbox.window.WestoAdminModules.invokeView('test', 'receiver', context, receiver, [9]), 'existing-tabs');
  assert.equal(context.value, 9);
});

function releaseDatabase({ revision = 0, receipt = true, auditFails = false } = {}) {
  let metadata = { moduleReleaseRevision: revision, featureEntitlements: { 'finance.workspace': false }, marker: 'keep' };
  const statements = [], audits = [];
  const client = { release() { statements.push('RELEASE'); }, async query(sql, params) {
    statements.push(sql);
    if (sql.startsWith('SELECT')) return { rows: [{ tenant_id: params[0], metadata }] };
    if (sql.startsWith('UPDATE')) { metadata = JSON.parse(params[1]); return { rows: receipt ? [{ tenant_id: params[0] }] : [] }; }
    return { rows: [] };
  } };
  const service = new ModuleReleaseService({ getDatabase: () => client, getClient: async () => client,
    audit: { async recordEvent(event) { if (auditFails) throw new Error('audit-failed'); audits.push(event); } } });
  return { service, statements, audits, metadata: () => metadata };
}
const assignment = { tenantId: 'darbar', moduleKey: 'menu_qr', version: '1.0.0', expectedRevision: 0, reason: 'انتخاب نسخهٔ موجود', actorId: 'operator-1' };

test('module release selection persists with audit in the same transaction and does not grant features', async () => {
  const db = releaseDatabase();
  const result = await db.service.assign(assignment);
  assert.equal(result.applied, true);
  assert.equal(result.entitlementChanged, false);
  assert.equal(db.metadata().marker, 'keep');
  assert.deepEqual(db.metadata().featureEntitlements, { 'finance.workspace': false });
  assert.equal(db.metadata().moduleReleaseRevision, 1);
  assert.equal(db.audits[0].database.query instanceof Function, true);
  assert.equal(db.statements.at(-2), 'COMMIT');
  assert.equal(db.statements.at(-1), 'RELEASE');
  const catalog = await db.service.getTenantReleases('darbar');
  assert.equal(catalog.revision, 1);
  assert.equal(catalog.modules.length, 14);
});

test('stale selections, missing durable receipt, and audit failure roll back and release the database client', async () => {
  for (const [options, code] of [[{ revision: 2 }, 'MODULE_RELEASE_REVISION_CONFLICT'], [{ receipt: false }, 'MODULE_RELEASE_PERSISTENCE_UNCONFIRMED'], [{ auditFails: true }, 'audit-failed']]) {
    const db = releaseDatabase(options);
    await assert.rejects(db.service.assign(assignment), error => error.code === code || error.message === code);
    assert.equal(db.statements.includes('COMMIT'), false);
    assert.equal(db.statements.at(-2), 'ROLLBACK');
    assert.equal(db.statements.at(-1), 'RELEASE');
  }
  const db = releaseDatabase();
  await assert.rejects(db.service.assign({ ...assignment, version: '3.0.0' }), { code: 'module_release_unavailable' });
  assert.equal(db.statements.length, 0);
});

test('service worker returns the new code before the previous assignment cache and retains offline fallback', async () => {
  const cached = { version: 'old' }, fresh = { ok: true, version: 'new', clone() { return this; } };
  let offline = false;
  const handlers = {};
  const context = vm.createContext({ self: { addEventListener(name, fn) { handlers[name] = fn; }, location: { origin: 'https://darbar.test' } },
    caches: { async open() { return { async match() { return cached; }, async put() {} }; } },
    async fetch(_request, options) { assert.equal(options.cache, 'no-cache'); if (offline) throw new Error('offline'); return fresh; },
    Response: { error() { throw new Error('no-fallback'); } }, URL });
  vm.runInContext(fs.readFileSync(path.join(runtime.ROOT, 'sw.js'), 'utf8'), context);
  const request = { method: 'GET', url: 'https://darbar.test/js/admin.js', destination: 'script' };
  let result;
  handlers.fetch({ request, respondWith(promise) { result = promise; } });
  assert.equal(await result, fresh);
  offline = true;
  handlers.fetch({ request, respondWith(promise) { result = promise; } });
  assert.equal(await result, cached);
});

test('paid access survives registry overrides and unsubscribed finance never renders its dashboard panel', async () => {
  const source = fs.readFileSync(path.join(runtime.ROOT, 'js/admin.js'), 'utf8');
  const accessHelpers = source.slice(source.indexOf('  function canOpenModuleTab('), source.indexOf('  const financeWorkspaceHref ='));
  const financePanel = source.slice(source.indexOf('  function renderDashboardBreakEvenShell('), source.indexOf('  function mountDashboardBreakEven('));
  const mount = source.slice(source.indexOf('  function mountAdminModules('), source.indexOf('  function initShell('));
  const context = { window: {}, console, moduleAccess: { tabFeatures: { accounting: 'finance.workspace', kitchen: 'kitchen.kds' },
    features: { 'finance.workspace': false, 'kitchen.kds': false } }, hasCapability: () => true,
    tabs: { async accounting() { throw new Error('original must not run'); } }, main: {}, state: {}, currentUser: {}, activeTab: 'dashboard', branchesCache: [],
    document: { documentElement: { dataset: {} }, querySelectorAll: () => [] } };
  for (const name of ['api', 'branchQs', 'currentBranch', 'esc', 'fmtMoney', 'fmtNum', 'fmtDateTime', 'financeWorkspaceHref', 'setActiveTab', 'showToast', 'sparkBars']) context[name] = () => {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(runtime.ROOT, 'js/admin/modules/core/registry.js'), 'utf8'), context);
  vm.runInContext(accessHelpers + financePanel + mount, context);
  assert.equal(context.hasModuleCapability('finance.view'), false);
  assert.equal(context.hasModuleCapability('orders.view'), true);
  assert.equal(context.renderDashboardBreakEvenShell(null, null, null, true), '');
  let invoked = false;
  context.window.WestoAdminModules.register({ id: 'accounting', tabs: ['accounting'], createTabs() { return { async accounting() { invoked = true; } }; } });
  context.mountAdminModules();
  await assert.rejects(context.tabs.accounting(), /اشتراک/);
  assert.equal(invoked, false);
  context.moduleAccess.features['finance.workspace'] = true;
  assert.equal(context.hasModuleCapability('finance.view'), true);
  await context.tabs.accounting();
  assert.equal(invoked, true);
});

test('the existing empty menu view renders its zero count using the shared Persian number formatter', async () => {
  const context = { window: {}, console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(runtime.ROOT, 'js/admin/modules/core/registry.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(runtime.ROOT, 'modules/menu_qr/frontend/admin-views.js'), 'utf8'), context);
  const stopAfterMarkup = new Error('stop-after-markup');
  let markup = '';
  const viewContext = { state: {}, setActiveTab() {}, api: async () => ({ menuCategories: [], menuItems: [], items: [] }),
    fmtNum: value => Number(value || 0).toLocaleString('fa-IR'), esc: value => String(value || ''), fmtMoney: () => '',
    main: { set innerHTML(value) { markup = value; throw stopAfterMarkup; } } };
  await assert.rejects(context.window.WestoAdminModules.invokeView('menu_qr', 'menu', viewContext, {}, []), error => error === stopAfterMarkup);
  assert.match(markup, /همه \(۰\)/);
  assert.match(markup, /دسته‌ای نیست/);
  assert.match(markup, /افزودن غذا/);
});

test('adding a file for a future release does not invalidate an already sealed customer version', () => {
  const source = fs.readFileSync(path.join(runtime.ROOT, 'modules/runtime.js'), 'utf8');
  const implementation = source.slice(source.indexOf('function getRelease('), source.indexOf('function listReleases('));
  const original = runtime.getDefinition('menu_qr');
  const futureDefinition = { ...original, files: [...original.files, { layer: 'frontend', legacyPath: 'js/future-menu-ui.js' }] };
  const context = vm.createContext({ fs, path, crypto, API_VERSION: runtime.API_VERSION,
    getDefinition: () => futureDefinition,
    releaseDirectory: (key, version) => path.join(runtime.ROOT, 'modules', key, 'releases', version),
    moduleError: code => Object.assign(new Error(code), { code }), isReleaseAsset: runtime.isReleaseAsset,
  });
  vm.runInContext(implementation, context);
  assert.equal(context.getRelease('menu_qr', '1.0.0').digest, runtime.getRelease('menu_qr', '1.0.0').digest);
});
