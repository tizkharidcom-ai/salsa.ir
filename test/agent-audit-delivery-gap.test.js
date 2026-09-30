'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');
const vm = require('node:vm');

const serverSource = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
const functionStart = serverSource.indexOf('function appendOrderStatus(');
const functionEnd = serverSource.indexOf('\nfunction reverseCancelledOrderFinancialEffects(', functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart, 'the real order status helper must be present');

const context = { effectiveRole: (actor) => actor?.role || 'staff' };
vm.runInNewContext(
  `${serverSource.slice(functionStart, functionEnd)}\nthis.appendOrderStatus = appendOrderStatus;`,
  context,
  { filename: 'server/server.js appendOrderStatus' },
);

test('delivery dispatch transition does not leave customer-facing dispatch metadata pending', () => {
  const order = {
    id: 1,
    fulfillment: 'delivery',
    status: 'ready',
    delivery: { dispatchStatus: 'pending' },
    statusHistory: [],
  };

  context.appendOrderStatus(order, 'dispatched', { role: 'cashier' }, { source: 'audit' });

  assert.equal(order.status, 'dispatched');
  assert.equal(order.delivery.dispatchStatus, 'dispatched');
  assert.ok(Number.isFinite(Date.parse(order.dispatchedAt)));
  assert.equal(order.delivery.dispatchedAt, order.dispatchedAt);
});

test('delivery completion stores customer-facing state and a completion timestamp', () => {
  const order = {
    id: 2,
    fulfillment: 'delivery',
    status: 'dispatched',
    dispatchedAt: '2026-09-23T10:00:00.000Z',
    delivery: { dispatchStatus: 'dispatched', dispatchedAt: '2026-09-23T10:00:00.000Z' },
    statusHistory: [],
  };

  context.appendOrderStatus(order, 'delivered', { role: 'cashier' }, { source: 'audit' });

  assert.equal(order.delivery.dispatchStatus, 'delivered');
  assert.equal(order.delivery.dispatchedAt, '2026-09-23T10:00:00.000Z');
  assert.equal(order.delivery.deliveredAt, order.doneAt);
});

test('cashier route does not allow a dispatched non-delivery order to become delivered', () => {
  const routeStart = serverSource.indexOf("app.patch('/api/cashier/orders/:id/status'");
  const routeEnd = serverSource.indexOf("app.get('/api/waiter/calls'", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, 'the cashier status route is available for inspection');
  const route = serverSource.slice(routeStart, routeEnd);
  assert.match(route, /dispatched:\s*order\.fulfillment\s*===\s*'delivery'\s*\?\s*\['delivered'\]\s*:\s*\[\]/);
});
