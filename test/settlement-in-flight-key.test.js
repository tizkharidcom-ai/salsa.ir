'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSettlementInFlightKey } = require('../server/settlement-in-flight-key');

const identity = overrides => createSettlementInFlightKey({
  tenantId: 'tenant-a',
  branchId: 2,
  orderId: 41,
  idempotencyKey: 'settlement-retry-001',
  ...overrides,
});

test('settlement coordination separates identical order ids and keys across tenants', () => {
  assert.notEqual(identity(), identity({ tenantId: 'tenant-b' }));
});

test('settlement coordination also separates branches but keeps exact retries stable', () => {
  assert.equal(identity(), identity({ branchId: '2', orderId: '41' }));
  assert.notEqual(identity(), identity({ branchId: 3 }));
  assert.notEqual(identity(), identity({ idempotencyKey: 'settlement-retry-002' }));
  assert.equal(identity({ branchId: '002' }), identity({ branchId: 2 }));
});

test('unscoped branch identity cannot collide with a textual sentinel and invalid branch ids fail closed', () => {
  const unscoped = identity({ branchId: null });
  assert.throws(() => identity({ branchId: 'unscoped' }), error => error.code === 'settlement_lock_branch_identity_invalid');
  assert.notEqual(unscoped, identity({ branchId: 1 }));
  for (const branchId of [0, -1, 'x', 'unscoped', {}, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => identity({ branchId }), error => error.code === 'settlement_lock_branch_identity_invalid');
  }
});

test('settlement coordination fails closed if tenant, order, or retry identity is missing', () => {
  for (const overrides of [
    { tenantId: '' },
    { orderId: null },
    { idempotencyKey: '' },
    { idempotencyKey: 'short' },
    { tenantId: {} },
    { orderId: 'order\u200B1' },
  ]) {
    assert.throws(() => identity(overrides), error => error.code === 'settlement_lock_identity_required');
  }
});
