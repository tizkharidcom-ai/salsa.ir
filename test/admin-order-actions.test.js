'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const adminSource = fs.readFileSync(path.join(root, 'js/admin.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');

function loadNextStatusesForOrder() {
  const match = adminSource.match(/function nextStatusesForOrder\(order\) \{[\s\S]*?\n  \}/);
  assert.ok(match, 'order status option helper exists');
  return new Function(`${match[0]}\nreturn nextStatusesForOrder;`)();
}

test('admin order controls prefer server-authorized transitions over the legacy local guess', () => {
  const nextStatusesForOrder = loadNextStatusesForOrder();
  assert.deepEqual(nextStatusesForOrder({
    status: 'pending_online',
    allowedStatusTransitions: [],
  }), ['pending_online']);
  assert.deepEqual(nextStatusesForOrder({
    status: 'preparing',
    allowedStatusTransitions: ['ready', 'cancelled', 'unexpected'],
  }), ['preparing', 'ready', 'cancelled']);
});

test('admin order cards show the server cancellation block reason and use server transition data', () => {
  const ordersStart = adminSource.indexOf('    async orders() {');
  const ordersEnd = adminSource.indexOf('\n    async delivery()', ordersStart);
  assert.ok(ordersStart >= 0 && ordersEnd > ordersStart);
  const ordersUi = adminSource.slice(ordersStart, ordersEnd);
  const serverOrdersStart = serverSource.indexOf("app.get('/api/admin/orders'");
  const serverOrdersEnd = serverSource.indexOf("app.post('/api/staff/orders'", serverOrdersStart);
  assert.ok(serverOrdersStart >= 0 && serverOrdersEnd > serverOrdersStart);

  assert.match(serverSource.slice(serverOrdersStart, serverOrdersEnd), /orders\.map\(\(order\) => operationalOrderResponse\(order, req\.user\)\)/);
  assert.match(ordersUi, /nextStatusesForOrder\(order\)\.map/);
  assert.match(ordersUi, /cancellationBlocked\?\.message[\s\S]{0,100}admin-cancel-blocked/);
});
