const test = require('node:test');
const assert = require('node:assert/strict');
const {
  can,
  normalizeRole,
  quoteFulfillment,
  allowedOrderTransitions,
  canTransitionOrder,
  canEditOrderBeforeKitchen,
  branchScopeForUser,
} = require('../server/command-center');

test('legacy admin safely normalizes to owner without losing access', () => {
  const user = { phone: '09120000000', role: 'admin' };
  assert.equal(normalizeRole(user.role), 'owner');
  assert.equal(can(user, 'orders.manage'), true);
  assert.equal(can({ role: 'cashier' }, 'command.view'), true);
  assert.equal(can({ role: 'cashier' }, 'menu.manage'), false);
  assert.equal(can({ role: 'cashier' }, 'cash.manage'), true);
  assert.equal(can({ role: 'waiter' }, 'service.manage'), true);
  assert.equal(can({ role: 'waiter' }, 'payments.manage'), false);
  assert.equal(can({ role: 'kitchen' }, 'kitchen.view'), true);
  assert.equal(can({ role: 'kitchen' }, 'inventory.receiving'), true);
  assert.equal(can({ role: 'accountant' }, 'inventory.receiving'), false);
  assert.equal(can({ role: 'kitchen' }, 'command.view'), false);
});

test('branch scope preserves owner access and normalizes explicit staff branches', () => {
  assert.equal(branchScopeForUser({ role: 'owner', allowedBranchIds: [2] }), null);
  assert.deepEqual(branchScopeForUser({ role: 'accountant', allowedBranchIds: ['2', 1, 2, 0, 'bad'] }), [2, 1]);
  assert.deepEqual(branchScopeForUser({ role: 'manager', branchId: 3 }), [3]);
  assert.equal(branchScopeForUser({ role: 'accountant' }), null);
  assert.deepEqual(branchScopeForUser({ role: 'accountant', allowedBranchIds: [] }), []);
});

test('delivery quote enforces branch, zone activation and minimum order', () => {
  const zone = { id: 3, branchId: 1, name: 'سجاد', active: true, minOrder: 300000, fee: 45000, etaMinutes: 35 };
  const tooSmall = quoteFulfillment({ fulfillment: 'delivery', subtotal: 299000, zone, branchId: 1 });
  assert.equal(tooSmall.ok, false);
  assert.equal(tooSmall.code, 'delivery_minimum_not_met');

  const valid = quoteFulfillment({ fulfillment: 'delivery', subtotal: 300000, zone, branchId: 1 });
  assert.deepEqual(valid, {
    ok: true,
    fulfillment: 'delivery',
    deliveryFee: 45000,
    total: 345000,
    zone: { id: 3, name: 'سجاد', minimum: 300000, fee: 45000, etaMinutes: 35 },
    etaMinutes: 35,
  });
  assert.equal(quoteFulfillment({ fulfillment: 'delivery', subtotal: 400000, zone, branchId: 2 }).ok, false);
});

test('order state machine distinguishes pickup and courier completion', () => {
  const pickup = { status: 'ready', fulfillment: 'pickup', paymentStatus: 'paid' };
  assert.deepEqual(allowedOrderTransitions(pickup), ['picked_up', 'cancelled']);
  assert.equal(canTransitionOrder(pickup, 'picked_up'), true);
  assert.equal(canTransitionOrder(pickup, 'delivered'), false);

  const courier = { status: 'ready', fulfillment: 'delivery', paymentStatus: 'paid' };
  assert.deepEqual(allowedOrderTransitions(courier), ['dispatched', 'cancelled']);
  assert.equal(canTransitionOrder({ ...courier, status: 'dispatched' }, 'delivered'), true);
  assert.equal(canTransitionOrder({ status: 'done', fulfillment: 'dine_in' }, 'preparing'), false);
});

test('cashier editing stops exactly when kitchen preparation starts', () => {
  assert.equal(canEditOrderBeforeKitchen({ status: 'sent_to_kitchen', paymentMethod: 'cashier' }), true);
  assert.equal(canEditOrderBeforeKitchen({ status: 'paid', paymentMethod: 'cashier' }), true);
  assert.equal(canEditOrderBeforeKitchen({ status: 'paid', paymentMethod: 'cashier', startedAt: new Date().toISOString() }), false);
  assert.equal(canEditOrderBeforeKitchen({ status: 'preparing', paymentMethod: 'cashier' }), false);
  assert.equal(canEditOrderBeforeKitchen({ status: 'paid', paymentMethod: 'online' }), false);
});
