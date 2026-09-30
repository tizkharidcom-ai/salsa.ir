'use strict';

const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');
const test = require('node:test');

const {
  ROLE_CAPABILITIES,
  branchScopeForUser,
  can,
  capabilitiesFor,
  normalizeRole,
} = require('../server/command-center');

const serverSource = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');

function assertCapabilities(role, { allow = [], deny = [] } = {}) {
  for (const capability of allow) {
    assert.equal(can({ role }, capability), true, `${role} should have ${capability}`);
  }
  for (const capability of deny) {
    assert.equal(can({ role }, capability), false, `${role} should not have ${capability}`);
  }
}

test('role normalization preserves owner/admin and fails closed for malformed or unknown roles', () => {
  assert.equal(normalizeRole('owner'), 'owner');
  assert.equal(normalizeRole(' ADMIN '), 'owner');
  assert.equal(normalizeRole('cashier'), 'cashier');
  assert.equal(normalizeRole('waiter'), 'waiter');
  assert.equal(normalizeRole('kitchen'), 'kitchen');

  for (const role of [undefined, null, '', 'superuser', ['admin'], { role: 'owner' }]) {
    assert.equal(normalizeRole(role), 'guest', `unexpected role input ${String(role)} must not elevate access`);
  }

  assert.equal(can(null, 'profile.self.manage'), false, 'missing identity must not inherit guest capabilities');
  assert.equal(can(undefined, 'cash.manage'), false);
  assert.equal(can([], 'profile.self.manage'), false, 'an array is not a user identity');
  assert.equal(can({ role: ['admin'] }, 'cash.manage'), false);
  assert.equal(can({ role: 'unknown' }, 'payments.manage'), false);
  assert.equal(can({ role: 'guest' }, 'profile.self.manage'), true, 'an explicit guest identity keeps self-service access');
});

test('waiter capabilities support floor service while excluding cash and administrative actions', () => {
  assertCapabilities('waiter', {
    allow: [
      'ops.view',
      'orders.view',
      'orders.create',
      'orders.course.manage',
      'orders.split',
      'orders.move_table',
      'tables.view',
      'service.manage',
      'reservations.receive',
      'payments.collect',
    ],
    deny: [
      'orders.manage',
      'payments.manage',
      'payments.refund.request',
      'cash.manage',
      'kitchen.manage',
      'staff.manage',
      'finance.view',
      'admin.access',
    ],
  });
});

test('cashier capabilities permit settlement and drawer work without kitchen or owner administration', () => {
  assertCapabilities('cashier', {
    allow: [
      'orders.view',
      'orders.create',
      'orders.manage',
      'payments.manage',
      'payments.collect',
      'cash.manage',
      'tables.view',
    ],
    deny: [
      'kitchen.view',
      'kitchen.manage',
      'service.manage',
      'staff.manage',
      'finance.approve',
      'role.preview',
      'admin.access',
    ],
  });
});

test('kitchen capabilities stay within KDS and inventory operations', () => {
  assertCapabilities('kitchen', {
    allow: ['ops.view', 'kitchen.view', 'kitchen.manage', 'inventory.view', 'inventory.operations', 'inventory.receiving'],
    deny: [
      'orders.view',
      'orders.create',
      'orders.manage',
      'payments.collect',
      'payments.manage',
      'cash.manage',
      'service.manage',
      'staff.manage',
      'finance.view',
      'admin.access',
    ],
  });
});

test('owner and legacy admin retain the owner wildcard', () => {
  for (const role of ['owner', 'admin']) {
    for (const capability of ['orders.manage', 'payments.manage', 'cash.manage', 'kitchen.manage', 'finance.approve', 'unknown.future.capability']) {
      assert.equal(can({ role }, capability), true, `${role} should retain owner access to ${capability}`);
    }
    assert.equal(branchScopeForUser({ role }), null, `${role} should retain unscoped branch access`);
  }
});

test('non-owner branch scope requires an explicit valid assignment and cannot widen from an empty list', () => {
  for (const role of ['waiter', 'cashier', 'kitchen']) {
    assert.deepEqual(branchScopeForUser({ role }), [], `${role} without an assignment must fail closed`);
    assert.deepEqual(branchScopeForUser({ role, branchId: 4 }), [4]);
    assert.deepEqual(branchScopeForUser({ role, allowedBranchIds: [4, '7', 4, 0, 'bad'] }), [4, 7]);
    assert.deepEqual(
      branchScopeForUser({ role, branchId: 9, allowedBranchIds: [] }),
      [],
      `${role} explicit empty scope must not fall back to branchId`,
    );
  }
  assert.deepEqual(branchScopeForUser({ role: 'waiter', allowedBranchIds: ['bad', 0, -2] }), []);
  assert.deepEqual(branchScopeForUser({ role: 'unknown' }), []);
});

test('capability definitions cannot be mutated through exported role lists', () => {
  for (const [role, capabilities] of Object.entries(ROLE_CAPABILITIES)) {
    assert.equal(Object.isFrozen(capabilities), true, `${role} capability list must be immutable`);
  }
  assert.equal(Object.isFrozen(capabilitiesFor({ role: 'waiter' })), true);
  assert.throws(() => ROLE_CAPABILITIES.waiter.push('cash.manage'), TypeError);
  assert.equal(can({ role: 'waiter' }, 'cash.manage'), false);
});

test('settlement and drawer routes retain separate payment and cash capability gates', () => {
  assert.match(serverSource, /app\.post\('\/api\/cashier\/orders\/:id\/settle',\s*requireCapability\('payments\.manage'\)/);
  assert.match(serverSource, /app\.post\('\/api\/staff\/orders\/:id\/settle',\s*requireCapability\('payments\.collect'\)/);
  assert.match(serverSource, /tender === 'cash' && !userCan\(req\.user, 'cash\.manage'\)/);

  for (const route of ['drawer', 'drawer/open', 'drawer/movements', 'drawer/close']) {
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      serverSource,
      new RegExp(`app\\.(?:get|post)\\('\\/api\\/cashier\\/${escaped}',\\s*requireCapability\\('cash\\.manage'\\)`),
      `cash drawer route ${route} must require cash.manage`,
    );
  }
});
