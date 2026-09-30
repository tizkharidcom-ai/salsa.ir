'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { retainOperationalOrders, mergeActionableOrders } = require('../server/operational-order-retention');

test('retention never evicts actionable orders even when their count exceeds the closed-ticket cache', () => {
  const actionable = Array.from({ length: 620 }, (_, index) => ({
    id: index + 1,
    status: index % 2 ? 'preparing' : 'pending_online',
  }));
  const result = retainOperationalOrders(actionable);

  assert.equal(result.length, actionable.length);
  assert.deepEqual(new Set(result.map((order) => order.id)), new Set(actionable.map((order) => order.id)));
});

test('closed-ticket cache keeps only the newest closed orders and leaves the input untouched', () => {
  const rows = [
    ...Array.from({ length: 510 }, (_, index) => ({
      id: index + 1,
      status: index % 2 ? 'done' : 'cancelled',
      createdAt: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
    })),
    { id: 9001, status: 'ready', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 9002, status: 'legacy_unknown', createdAt: '2026-01-01T00:00:00.000Z' },
  ];
  const originalIds = rows.map((order) => order.id);
  const result = retainOperationalOrders(rows, 500);
  const retainedClosed = result.filter((order) => ['done', 'cancelled', 'delivered', 'picked_up'].includes(order.status));

  assert.equal(rows.length, 512);
  assert.deepEqual(rows.map((order) => order.id), originalIds);
  assert.equal(retainedClosed.length, 500);
  assert.equal(Math.min(...retainedClosed.map((order) => order.id)), 11);
  assert.ok(result.some((order) => order.id === 9001));
  assert.ok(result.some((order) => order.id === 9002));
});

test('closed-order retention limit can be zero without dropping active or unknown-state records', () => {
  const rows = [
    { id: 1, status: 'done' },
    { id: 2, status: 'sent_to_kitchen' },
    { id: 3, status: 'future_state' },
  ];

  assert.deepEqual(retainOperationalOrders(rows, 0), rows.slice(1));
});

test('startup recovery merges omitted actionable rows once and still bounds only closed tickets', () => {
  const snapshot = [
    { id: 1, status: 'ready', branchId: 4 },
    { id: 2, status: 'done', branchId: 4 },
  ];
  const recovered = [
    { id: 1, status: 'ready', branchId: 4 },
    { id: 3, status: 'pay_at_cashier', branchId: 5 },
  ];
  const result = mergeActionableOrders(snapshot, recovered);

  assert.equal(result.restoredCount, 1);
  assert.deepEqual(result.orders.map((order) => order.id), [1, 3, 2]);
  assert.strictEqual(result.orders[0], snapshot[0]);
});
