'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

function routeSlice(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `route block exists: ${startMarker}`);
  return source.slice(start, end);
}

function branchHelpers({ user, branches }) {
  const start = source.indexOf('function requestBranchValue(req) {');
  const end = source.indexOf('function syncLegacyHours()', start);
  assert.ok(start >= 0 && end > start, 'request branch helpers exist');
  const database = { branches };
  const preferred = () => branches.find((branch) => branch.active !== false) || branches[0] || null;
  const scopeFor = (candidate) => candidate.role === 'owner' ? null : candidate.allowedBranchIds || [];
  const helpers = new Function(
    'db', 'defaultBranch', 'normalizeDigits', 'branchScopeForUser', 'effectiveRole',
    `${source.slice(start, end)}\nreturn { parseBranchId, assertRequestBranchAccess };`,
  )(
    database,
    preferred,
    (value) => String(value ?? '').replace(/[۰-۹]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)),
    scopeFor,
    (candidate) => candidate.role,
  );
  return {
    parse: (req) => helpers.parseBranchId({ ...req, user }),
    assertRequestAccess: (req) => helpers.assertRequestBranchAccess({ ...req, user }),
  };
}

function recordBranchAssertion() {
  const start = source.indexOf('function assertUserBranchAccess(user, branchId) {');
  const end = source.indexOf('\nfunction requireAdmin(', start);
  assert.ok(start >= 0 && end > start, 'record branch assertion exists');
  return new Function(
    'branchScopeForUser', 'effectiveRole', 'branchScopeError',
    `${source.slice(start, end)}\nreturn assertUserBranchAccess;`,
  )(
    (user) => user.role === 'owner' ? null : (user.allowedBranchIds || []),
    (user) => user.role,
    (code, status, message) => Object.assign(new Error(message), { code, status }),
  );
}

test('branch-scoped staff without a branch value resolve only to an assigned branch and invalid ids never fall back', () => {
  const branches = [
    { id: 1, active: true, slug: 'central' },
    { id: 2, active: true, slug: 'north' },
  ];
  const branchTwo = branchHelpers({ user: { role: 'manager', allowedBranchIds: [2] }, branches });

  assert.equal(branchTwo.parse({ query: {}, body: {} }), 2, 'a scoped manager defaults to their assigned branch');
  assert.throws(
    () => branchTwo.parse({ query: { branchId: '1' }, body: {} }),
    (error) => error.code === 'branch_access_denied',
  );
  assert.throws(
    () => branchTwo.parse({ query: { branchId: '999' }, body: {} }),
    (error) => error.code === 'branch_invalid',
  );
  const unscoped = branchHelpers({ user: { role: 'manager', allowedBranchIds: [] }, branches });
  assert.throws(
    () => unscoped.assertRequestAccess({ query: {}, body: {} }),
    (error) => error.code === 'branch_scope_empty',
  );
});

test('record mutations allow the selected branch and reject an out-of-scope record before mutation', () => {
  const assertAccess = recordBranchAssertion();
  const manager = { role: 'manager', allowedBranchIds: [2] };
  assert.doesNotThrow(() => assertAccess(manager, 2));
  assert.throws(
    () => assertAccess(manager, 1),
    (error) => error.code === 'branch_access_denied' && error.status === 403,
  );
  assert.doesNotThrow(() => assertAccess({ role: 'owner' }, 1));
});

test('delivery-zone creation pins the selected authorized branch instead of silently using the default', () => {
  const createRoute = routeSlice(
    "app.post('/api/admin/delivery-zones'",
    "app.patch('/api/admin/delivery-zones/:id'",
  );
  const selectedBranch = createRoute.indexOf('branchId = parseBranchId(req)');
  const cleanZone = createRoute.indexOf('cleanDeliveryZone({ ...(req.body || {}), branchId })');
  assert.ok(selectedBranch >= 0 && cleanZone > selectedBranch);
  assert.match(createRoute, /if \(branchId == null\) return res\.status\(400\)/);
});

test('delivery-zone update and delete authorize the persisted record branch before mutation', () => {
  const updateRoute = routeSlice(
    "app.patch('/api/admin/delivery-zones/:id'",
    "app.delete('/api/admin/delivery-zones/:id'",
  );
  const deleteRoute = routeSlice(
    "app.delete('/api/admin/delivery-zones/:id'",
    "app.get('/api/admin/payments'",
  );
  const updateAccess = updateRoute.indexOf('assertUserBranchAccess(req.user, currentBranchId)');
  const updateMutation = updateRoute.indexOf('Object.assign(current, zone)');
  assert.ok(updateAccess >= 0 && updateMutation > updateAccess);
  assert.match(updateRoute, /delivery_zone_branch_immutable/);

  const deleteAccess = deleteRoute.indexOf('assertUserBranchAccess(req.user, zoneBranchId)');
  const deleteMutation = deleteRoute.indexOf('db.deliveryZones = zones.filter');
  assert.ok(deleteAccess >= 0 && deleteMutation > deleteAccess);
});

test('working-hours writes resolve the requested or permitted branch through strict branch authorization', () => {
  const hoursRoute = routeSlice("app.put('/api/admin/hours'", "app.get('/api/admin/tables'");
  const parsedBranch = hoursRoute.indexOf('branchId = parseBranchId(req)');
  const exactBranch = hoursRoute.indexOf('const branch = resolveBranchExact(branchId)');
  assert.ok(parsedBranch >= 0 && exactBranch > parsedBranch);
  assert.doesNotMatch(hoursRoute, /resolveBranch\(req\.body\.branchId\s*\|\|\s*req\.query\.branchId\)/);
});

test('admin delivery and hours writes wait for durable persistence, roll back on failure, then publish', () => {
  const zoneRoutes = routeSlice("app.post('/api/admin/delivery-zones'", "app.get('/api/admin/payments'");
  for (const action of ['created', 'updated', 'deleted']) {
    const marker = `app.${action === 'created' ? 'post' : action === 'updated' ? 'patch' : 'delete'}('/api/admin/delivery-zones`;
    const start = zoneRoutes.indexOf(marker);
    const end = action === 'created'
      ? zoneRoutes.indexOf("app.patch('/api/admin/delivery-zones/:id'", start)
      : action === 'updated'
        ? zoneRoutes.indexOf("app.delete('/api/admin/delivery-zones/:id'", start)
        : zoneRoutes.length;
    const route = zoneRoutes.slice(start, end);
    assert.match(route, /await persistAdminConfigMutation\(/, `${action} persists durably with rollback`);
    assert.ok(route.indexOf('await persistAdminConfigMutation(') < route.indexOf("publishOperationalEvent('delivery_zone.updated'"));
    assert.match(route, /deferAppend: true/);
    assert.ok(route.indexOf('await persistAdminConfigMutation(') < route.indexOf('appendAuditAfterCommit(auditEntry)'));
  }
  assert.match(zoneRoutes, /serializeAdminConfigMutation\(branchId/);
  assert.match(zoneRoutes, /serializeAdminConfigMutation\(initialBranchId/);

  const hoursRoute = routeSlice("app.put('/api/admin/hours'", "app.get('/api/admin/tables'");
  assert.match(hoursRoute, /hours_time_invalid/);
  assert.match(hoursRoute, /serializeAdminConfigMutation\(branch\.id/);
  assert.match(hoursRoute, /await persistAdminConfigMutation\(/);
  assert.match(hoursRoute, /rollbackAuditEntry\(auditEntry, auditLogWasPresent\)/);
  assert.ok(hoursRoute.indexOf('await persistAdminConfigMutation(') < hoursRoute.indexOf('appendAuditAfterCommit(auditEntry)'));
});

test('durable admin-config persistence invokes a targeted rollback and propagates the storage error', async () => {
  const start = source.indexOf('async function persistAdminConfigMutation(rollback) {');
  const end = source.indexOf('\nif (db.menuComplementsV1Pending)', start);
  assert.ok(start >= 0 && end > start, 'durable config mutation helper exists');
  let saveOptions;
  let rollbackCalls = 0;
  const helper = new Function('save', 'console', `${source.slice(start, end)}\nreturn persistAdminConfigMutation;`)(
    async (options) => { saveOptions = options; throw Object.assign(new Error('database unavailable'), { code: 'db_down', status: 503 }); },
    { error() {} },
  );
  await assert.rejects(helper(() => { rollbackCalls += 1; }), (error) => error.code === 'db_down');
  assert.deepEqual(saveOptions, { requireDurable: true });
  assert.equal(rollbackCalls, 1);
});

test('save fails closed when neither the JSON snapshot nor PostgreSQL backend is writable', async () => {
  const start = source.indexOf('function save(opts = {}) {');
  const end = source.indexOf('\n// Critical operational routes', start);
  assert.ok(start >= 0 && end > start, 'shared save implementation exists');
  const makeSave = (stateStore = { enabled: false }) => new Function(
    'db', 'tenantStorage', 'defaultDb', 'TENANT_CONFIG', 'legacyTenantPersistenceError', 'tenantRegistry',
    'rebuildProductsFromMenu', 'bumpMenuRevision', 'shouldWriteJsonState', 'stateStore', 'settlementPersistenceGate',
    `let saveTimer = null; let saveWaiters = []; ${source.slice(start, end)}\nreturn save;`,
  )(
    {}, { getStore: () => null }, {}, {}, () => null, {}, () => {}, () => {}, () => false,
    stateStore, { recordFailure() {} },
  );
  const save = makeSave();
  assert.equal(await save(), false, 'best-effort save reports that nothing was persisted');
  await assert.rejects(save({ requireDurable: true }), (error) =>
    error.code === 'persistence_unavailable' && error.status === 503);
  const unconfirmedSave = makeSave({ enabled: true, async write() { return false; } });
  await assert.rejects(unconfirmedSave({ requireDurable: true }), (error) =>
    error.code === 'persistence_unconfirmed' && error.status === 503);
});

test('admin configuration writes serialize per tenant and branch without blocking other branches', async () => {
  const start = source.indexOf('const adminConfigMutationQueues = new Map();');
  const end = source.indexOf('\nasync function persistAdminConfigMutation', start);
  assert.ok(start >= 0 && end > start, 'branch-scoped config queue exists');
  let tenantId = 'tenant-a';
  const serialize = new Function('tenantStorage', 'TENANT_CONFIG', `${source.slice(start, end)}\nreturn serializeAdminConfigMutation;`)(
    { getStore: () => ({ tenantId }) }, { tenantId: 'fallback' },
  );
  const sequence = [];
  let releaseFirst;
  const blocked = new Promise((resolve) => { releaseFirst = resolve; });
  const first = serialize(2, async () => { sequence.push('first:start'); await blocked; sequence.push('first:end'); });
  const sameBranch = serialize(2, async () => { sequence.push('same-branch'); });
  const otherBranch = serialize(3, async () => { sequence.push('other-branch'); });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sequence, ['first:start', 'other-branch']);
  releaseFirst();
  await Promise.all([first, sameBranch, otherBranch]);
  assert.deepEqual(sequence, ['first:start', 'other-branch', 'first:end', 'same-branch']);

  tenantId = 'tenant-b';
  await serialize(2, async () => { sequence.push('other-tenant'); });
  assert.equal(sequence.at(-1), 'other-tenant');
});

test('working-hours validation accepts Persian 24-hour values and rejects malformed times', () => {
  const start = source.indexOf('function validateAdminHoursTime(value) {');
  const end = source.indexOf('\n}', start) + 2;
  assert.ok(start >= 0 && end > start, 'hours validator exists');
  const validate = new Function('normalizeDigits', `${source.slice(start, end)}\nreturn validateAdminHoursTime;`)(
    (value) => String(value).replace(/[۰-۹]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)),
  );
  assert.equal(validate('08:05'), '08:05');
  assert.equal(validate('۲۳:۵۹'), '23:59');
  for (const value of ['24:00', '9:00', '12:60', '9pm', '']) assert.equal(validate(value), null);
  assert.equal(validate(900), null);
});
