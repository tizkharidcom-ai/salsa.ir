'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  encodeOrderHistoryCursor,
  historyPageSize,
  normalizeOrderHistoryCursor,
  paginateCachedClosedOrders,
} = require('../server/order-history');

test('order history cursor round-trips stable UTC timestamp and id', () => {
  const cursor = encodeOrderHistoryCursor({ id: 91, createdAt: '2026-09-23T09:30:00.000Z' });
  assert.deepEqual(normalizeOrderHistoryCursor(cursor), { createdAt: '2026-09-23T09:30:00.000Z', id: 91 });
  assert.equal(normalizeOrderHistoryCursor(null), null);
});

test('order history cursor preserves PostgreSQL microseconds and does not skip rows within one millisecond', () => {
  const orders = [
    { id: 1, branchId: 2, status: 'done', createdAt: '2026-09-23T09:30:00.000002Z' },
    { id: 99, branchId: 2, status: 'done', createdAt: '2026-09-23T09:30:00.000001Z' },
  ];
  const first = paginateCachedClosedOrders(orders, { branchId: 2, limit: 1 });
  assert.deepEqual(first.orders.map((order) => order.id), [1]);
  assert.deepEqual(normalizeOrderHistoryCursor(first.nextCursor), {
    createdAt: '2026-09-23T09:30:00.000002Z', id: 1,
  });
  const second = paginateCachedClosedOrders(orders, { branchId: 2, limit: 1, cursor: first.nextCursor });
  assert.deepEqual(second.orders.map((order) => order.id), [99]);
  assert.equal(second.hasMore, false);
});

test('PostgreSQL archive cursor serializes created_at at microsecond precision', () => {
  const pgState = fs.readFileSync(path.join(__dirname, '..', 'server', 'postgres-state.js'), 'utf8');
  const start = pgState.indexOf('async listClosedOrders({ branchId');
  const end = pgState.indexOf('async appendAudit(', start);
  assert.ok(start >= 0 && end > start, 'durable closed-order query exists');
  const query = pgState.slice(start, end);
  assert.match(query, /AS created_at_cursor/);
  assert.match(query, /SS\.US/);
  assert.match(query, /encodeOrderHistoryCursor\(pageRows\[pageRows\.length - 1\]\)/);
});

test('order history rejects malformed cursors and caps page size', () => {
  for (const cursor of ['not-base64!', 'e30', 'eyJpZCI6MX0', 'a'.repeat(257)]) {
    assert.throws(() => normalizeOrderHistoryCursor(cursor), { code: 'order_history_cursor_invalid', status: 400 });
  }
  assert.equal(historyPageSize('1000'), 100);
  assert.equal(historyPageSize('-4'), 1);
  assert.equal(historyPageSize('invalid'), 30);
});

test('cached closed order history filters branch and status and pages without duplicates', () => {
  const orders = [
    { id: 1, branchId: 2, status: 'done', createdAt: '2026-09-23T10:00:00.000Z' },
    { id: 2, branchId: 2, status: 'cancelled', createdAt: '2026-09-23T10:00:00.000Z' },
    { id: 3, branchId: 2, status: 'preparing', createdAt: '2026-09-23T12:00:00.000Z' },
    { id: 4, branchId: 3, status: 'delivered', createdAt: '2026-09-23T11:00:00.000Z' },
    { id: 5, branchId: 2, status: 'picked_up', createdAt: '2026-09-23T09:00:00.000Z' },
  ];

  const first = paginateCachedClosedOrders(orders, { branchId: 2, limit: 1 });
  assert.deepEqual(first.orders.map((order) => order.id), [2]);
  assert.equal(first.hasMore, true);
  const second = paginateCachedClosedOrders(orders, { branchId: 2, limit: 1, cursor: first.nextCursor });
  assert.deepEqual(second.orders.map((order) => order.id), [1]);
  assert.equal(second.hasMore, true);
  const third = paginateCachedClosedOrders(orders, { branchId: 2, limit: 1, cursor: second.nextCursor });
  assert.deepEqual(third.orders.map((order) => order.id), [5]);
  assert.equal(third.hasMore, false);
});

test('admin closed-order history retains capability and tenant boundaries and is read-only in UI', () => {
  const root = path.join(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server', 'server.js'), 'utf8');
  const admin = fs.readFileSync(path.join(root, 'js', 'admin.js'), 'utf8');
  const routeStart = server.indexOf("app.get('/api/admin/orders', requireCapability('orders.view')");
  const routeEnd = server.indexOf("app.post('/api/staff/orders'", routeStart);
  const route = server.slice(routeStart, routeEnd);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  assert.match(route, /history\s*\|\|\s*''\) === 'closed'/);
  assert.match(route, /stateStore\.listClosedOrders\(\{ branchId, cursor, limit \}\)/);
  assert.match(route, /tenantId === 'westo'/);
  assert.match(route, /paginateCachedClosedOrders\(db\.orders \|\| \[\], \{ branchId, cursor, limit \}\)/);
  assert.match(route, /complete:\s*false/);
  assert.match(route, /پیش از مهاجرت هنوز تأیید نشده/);

  const historyStart = admin.indexOf('const loadOrderHistory = async');
  const historyEnd = admin.indexOf('const filterOrders=', historyStart);
  const historyUi = admin.slice(historyStart, historyEnd);
  assert.ok(historyStart >= 0 && historyEnd > historyStart);
  assert.match(historyUi, /history:\s*'closed'/);
  assert.match(historyUi, /branchQs\(query\)/);
  assert.match(historyUi, /query\.cursor\s*=\s*historyCursor/);
  assert.match(admin, /id="order-history-status" class="order-history-status" role="status" aria-live="polite"/);
  assert.match(historyUi, /<details><summary>اقلام سفارش/);
  assert.doesNotMatch(historyUi, /data-onext|data-ostatus|data-payment-action/);
});
