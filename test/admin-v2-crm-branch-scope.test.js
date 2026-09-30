'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');
const { registerAdminV2Routes, __test } = require('../server/admin-v2');

function crmFixture() {
  return {
    orders: [
      { id: 'b1-order', branchId: 1, phone: '09120000001', name: 'مشتری شعبه یک', total: 500000, status: 'paid', createdAt: new Date().toISOString() },
      { id: 'b2-order', branchId: 2, phone: '09120000002', name: 'مشتری شعبه دو', total: 900000, status: 'paid', createdAt: new Date().toISOString() },
    ],
    users: [
      { phone: '09120000001', name: 'پروفایل سراسری یک', points: 120, tags: ['حساسیت'], vipNote: 'یادداشت خصوصی', birthdate: '1990-01-01', walletBalanceToman: 250000 },
      { phone: '09120000003', name: 'بدون سفارش شعبه', points: 400, walletBalanceToman: 800000 },
    ],
    loyaltyLedger: [{ phone: '09120000001', balance: 120 }, { phone: '09120000003', balance: 400 }],
    newsletter: [{ email: 'private@example.test' }],
    feedback: [
      { id: 'fb1', branchId: 1, status: 'new' },
      { id: 'fb2', branchId: 2, status: 'new' },
    ],
    loyalty: { enabled: true },
  };
}

test('branch CRM excludes tenant-wide customer, loyalty, wallet, newsletter and dossier data', () => {
  const model = __test.crm(crmFixture(), 1);

  assert.deepEqual(model.customers.map((customer) => customer.phone), ['09120000001']);
  assert.equal(model.customers[0].points, null);
  assert.equal(model.customers[0].walletBalanceToman, null);
  assert.deepEqual(model.customers[0].tags, []);
  assert.equal(model.customers[0].vipNote, '');
  assert.equal(model.customers[0].tier, null);
  assert.equal(model.customerDetailsAvailable, false);
  assert.equal(model.walletSummary, null);
  assert.deepEqual(model.tiers, []);
  assert.deepEqual(model.newsletter, []);
  assert.deepEqual(model.feedback.map((item) => item.id), ['fb1']);
  assert.equal(model.summary.points, null);
  assert.equal(model.summary.walletTotalToman, null);
  assert.equal(model.summary.activeWallets, null);
  assert.equal(model.summary.upcomingBirthdaysCount, 0);
});

test('unscoped CRM retains tenant-owner customer and loyalty view', () => {
  const model = __test.crm(crmFixture(), null);

  assert.deepEqual(new Set(model.customers.map((customer) => customer.phone)), new Set([
    '09120000001', '09120000002', '09120000003',
  ]));
  assert.equal(model.customerDetailsAvailable, true);
  assert.ok(model.walletSummary);
  assert.equal(model.customers.find((customer) => customer.phone === '09120000001').points, 120);
  assert.equal(model.customers.find((customer) => customer.phone === '09120000001').walletBalanceToman, 250000);
  assert.equal(model.newsletter.length, 1);
});

test('CRM route resolves scoped and owner-wide requests without missing runtime helpers', () => {
  let crmHandler;
  const app = new Proxy({}, {
    get: (_target, method) => (...args) => {
      if (method === 'get' && args[0] === '/api/admin/v2/crm') crmHandler = args.at(-1);
    },
  });
  registerAdminV2Routes({
    app,
    getDb: crmFixture,
    save: () => true,
    requireCapability: () => (_req, _res, next) => next(),
    requireAdmin: (_req, _res, next) => next(),
    parseBranchId: (req) => Number(req.query.branchId || 1),
    requestBranchValue: (req) => req.query.branchId ?? null,
    effectiveRole: (user) => user?.role || 'guest',
    normalizeDigits: (value) => String(value || ''),
    phoneRe: /^09\d{9}$/,
  });
  assert.equal(typeof crmHandler, 'function');

  const call = (role, branchId) => {
    let status = 200;
    let body;
    const res = {
      status(code) { status = code; return this; },
      json(value) { body = value; return this; },
    };
    crmHandler({ query: { branchId }, user: { role } }, res);
    return { status, body };
  };

  const scoped = call('owner', '1');
  assert.equal(scoped.status, 200);
  assert.equal(scoped.body.customerDetailsAvailable, false);
  assert.deepEqual(scoped.body.customers.map((customer) => customer.phone), ['09120000001']);

  const ownerWide = call('owner', 'all');
  assert.equal(ownerWide.status, 200);
  assert.equal(ownerWide.body.customerDetailsAvailable, true);
  assert.equal(ownerWide.body.customers.length, 3);

  const denied = call('manager', 'all');
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, 'crm_all_branches_owner_only');
});

test('CRM page never falls back to the unscoped legacy customer APIs after an access error', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
  const requestStart = source.indexOf('d = await api(crmAllBranchesScope && hasCapability(\'owner\')');
  const dataStart = source.indexOf('const customers = d.customers || d.members || [];', requestStart);
  assert.notEqual(requestStart, -1);
  assert.notEqual(dataStart, -1);
  const loadBlock = source.slice(requestStart, dataStart);

  assert.doesNotMatch(loadBlock, /\/api\/admin\/(?:club|loyalty)/);
  assert.match(loadBlock, /اطلاعات مشتریان در دسترس نیست/);
  assert.match(source.slice(dataStart, dataStart + 180), /customerDetailsAvailable/);
});

test('only owners can explicitly switch CRM from one branch to the tenant-wide view', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'admin-v2.js'), 'utf8');
  const serverEntry = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  const routeStart = server.indexOf("app.get('/api/admin/v2/crm'");
  const routeEnd = server.indexOf("app.get('/api/admin/v2/finance'", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  const route = server.slice(routeStart, routeEnd);
  const ownerGuard = route.indexOf("effectiveRole(req.user) !== 'owner'");
  const globalModel = route.indexOf('crm(getDb(), null)');
  assert.ok(ownerGuard >= 0 && globalModel > ownerGuard);
  assert.match(route, /requestedBranch\s*=\s*requestBranchValue\(req\)/);
  assert.match(route, /return res\.json\(crm\(getDb\(\),\s*parseBranchId\(req\)\)\)/);
  assert.match(server, /function registerAdminV2Routes\(\{[^}]*requestBranchValue[^}]*effectiveRole/);
  const registrationStart = serverEntry.indexOf('registerAdminV2Routes({');
  const registrationEnd = serverEntry.indexOf('\n});', registrationStart);
  assert.ok(registrationStart >= 0 && registrationEnd > registrationStart);
  assert.match(serverEntry.slice(registrationStart, registrationEnd), /requestBranchValue\s*,[\s\S]*effectiveRole\s*,/);

  const ui = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
  assert.match(ui, /crmAllBranchesScope && hasCapability\('owner'\)/);
  assert.match(ui, /branchId=all/);
  assert.match(ui, /hasCapability\('owner'\) \? `<div class="row-actions"[\s\S]*?crm-all-branches-btn/);
});
