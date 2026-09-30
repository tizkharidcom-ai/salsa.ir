'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPostgresStateStore } = require('../server/postgres-state');
const { normalizePersistedOperationalOrder } = require('../server/operational-order-retention');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
const financeRepositorySource = fs.readFileSync(path.join(__dirname, '..', 'server', 'finance-postgres-repository.js'), 'utf8');

function fakePoolFactory({ hasOrderTable = true, rows = [] } = {}) {
  return class FakePool {
    constructor() { this.queries = []; this.ended = false; }
    on() {}
    async query(sql, params = []) {
      this.queries.push(String(sql));
      if (String(sql).includes("to_regclass('public.unified_orders')")) {
        return { rows: [{ tbl: hasOrderTable ? 'unified_orders' : null }] };
      }
      if (String(sql).includes('FROM unified_orders')) {
        this.lastOrderQueryParams = params;
        let matching = rows.slice();
        if (params.length && params[0] != null) matching = matching.filter((row) => Number(row.branch_id) === Number(params[0]));
        if (params.length >= 4) {
          const cursorTime = new Date(params[1]).getTime();
          const cursorId = Number(params[2]);
          matching = matching.filter((row) => {
            const createdAt = new Date(row.created_at || 0).getTime() || 0;
            return createdAt < cursorTime || (createdAt === cursorTime && Number(row.id) < cursorId);
          });
        }
        if (/\bLIMIT \$\d+/i.test(String(sql))) matching = matching.slice(0, Number(params.at(-1)));
        return { rows: matching };
      }
      return { rows: [], rowCount: 0 };
    }
    async end() { this.ended = true; }
  };
}

test('normalized actionable order rows restore canonical status, branch, and timestamps safely', () => {
  const normalized = normalizePersistedOperationalOrder({
    id: '42', branch_id: '7', status: 'preparing', created_at: new Date('2026-09-23T10:00:00Z'),
    data: { id: 42, branchId: 7, status: 'paid', createdAt: null, items: [{ name: 'خوراک' }] },
  });
  assert.deepEqual(normalized, {
    id: 42,
    branchId: 7,
    status: 'preparing',
    createdAt: '2026-09-23T10:00:00.000Z',
    items: [{ name: 'خوراک' }],
  });
  assert.equal(normalizePersistedOperationalOrder({ id: 'x', branch_id: 7, status: 'ready', data: {} }), null);
  assert.equal(normalizePersistedOperationalOrder({ id: 42, branch_id: null, status: 'ready', data: { id: 42 } }), null);
  assert.equal(normalizePersistedOperationalOrder({ id: 42, branch_id: 7, status: 'ready', data: '{bad' }), null);
});

test('PostgreSQL store reads every actionable order while leaving closed orders in the durable archive', async () => {
  const rows = [
    { id: '42', branch_id: '7', status: 'preparing', created_at: new Date('2026-09-23T10:00:00Z'), data: { id: 42, branchId: 7, items: [] } },
    { id: '43', branch_id: '7', status: 'unknown_legacy', created_at: new Date('2026-09-22T10:00:00Z'), data: JSON.stringify({ id: 43, branchId: 7 }) },
    { id: 'bad', branch_id: '7', status: 'ready', created_at: new Date(), data: {} },
  ];
  let pool;
  const store = createPostgresStateStore({
    connectionString: 'postgres://test.invalid/order-recovery',
    Pool: class extends fakePoolFactory({ rows }) {
      constructor(options) { super(options); pool = this; }
    },
    logger: { error() {}, warn() {}, info() {} },
  });

  const result = await store.loadActionableOrders();
  assert.equal(result.available, true);
  assert.equal(result.invalidRows, 1);
  assert.deepEqual(result.orders.map((order) => [order.id, order.status]), [[42, 'preparing'], [43, 'unknown_legacy']]);
  const selection = pool.queries.find((sql) => sql.includes('FROM unified_orders'));
  assert.match(selection, /lower\(status\) NOT IN \('cancelled', 'done', 'delivered', 'picked_up'\)/);
  assert.match(selection, /ORDER BY created_at ASC, id ASC/);
  await store.close();
  assert.equal(pool.ended, true);
});

test('missing normalized order table is reported instead of pretending the archive was checked', async () => {
  let pool;
  const store = createPostgresStateStore({
    connectionString: 'postgres://test.invalid/no-order-table',
    Pool: class extends fakePoolFactory({ hasOrderTable: false }) {
      constructor(options) { super(options); pool = this; }
    },
    logger: { error() {}, warn() {}, info() {} },
  });

  const result = await store.loadActionableOrders();
  assert.deepEqual(result, { available: false, reason: 'operational_order_store_missing', orders: [] });
  assert.equal(pool.queries.some((sql) => sql.includes('FROM unified_orders')), false);
  await store.close();
});

test('PostgreSQL closed history is branch-scoped, keyset-paged, and reports invalid rows', async () => {
  const rows = [
    { id: '42', branch_id: '7', status: 'done', created_at: new Date('2026-09-23T10:00:00Z'), data: { id: 42, branchId: 7, total: 1200 } },
    { id: '41', branch_id: '7', status: 'cancelled', created_at: new Date('2026-09-23T09:00:00Z'), data: { id: 41, branchId: 7 } },
    { id: 'bad', branch_id: '7', status: 'done', created_at: new Date('2026-09-22T10:00:00Z'), data: {} },
  ];
  let pool;
  const store = createPostgresStateStore({
    connectionString: 'postgres://test.invalid/order-history',
    Pool: class extends fakePoolFactory({ rows }) {
      constructor(options) { super(options); pool = this; }
    },
    logger: { error() {}, warn() {}, info() {} },
  });
  const result = await store.listClosedOrders({ branchId: 7, limit: 1 });
  assert.equal(result.available, true);
  assert.equal(result.hasMore, true);
  assert.equal(result.orders[0].id, 42);
  assert.equal(result.orders[0].total, 1200);
  assert.deepEqual(pool.lastOrderQueryParams, [7, 2]);
  const selection = pool.queries.find((sql) => sql.includes('FROM unified_orders'));
  assert.match(selection, /lower\(status\) IN \('cancelled', 'done', 'delivered', 'picked_up'\)/);
  assert.match(selection, /\$1::bigint IS NULL OR branch_id = \$1/);
  assert.match(result.nextCursor, /^[A-Za-z0-9_-]+$/);

  const next = await store.listClosedOrders({ branchId: 7, cursor: result.nextCursor, limit: 1 });
  assert.deepEqual(pool.lastOrderQueryParams, [7, new Date('2026-09-23T10:00:00.000Z').toISOString(), 42, 2]);
  assert.match(pool.queries.filter((sql) => sql.includes('FROM unified_orders')).at(-1), /\(COALESCE\(created_at, 'epoch'::timestamptz\), id\) < \(\$2::timestamptz, \$3::bigint\)/);
  assert.equal(next.orders[0].id, 41);
  await store.close();
});

test('missing normalized order table is reported by the closed history reader', async () => {
  const store = createPostgresStateStore({
    connectionString: 'postgres://test.invalid/no-history-table',
    Pool: fakePoolFactory({ hasOrderTable: false }),
    logger: { error() {}, warn() {}, info() {} },
  });
  assert.deepEqual(await store.listClosedOrders(), {
    available: false, reason: 'operational_order_store_missing', orders: [], hasMore: false, nextCursor: null, invalidRows: 0,
  });
  await store.close();
});

test('server startup reconciles the PostgreSQL actionable queue before opening the HTTP listener', () => {
  const start = serverSource.indexOf('async function hydrateStateFromPostgres() {');
  const end = serverSource.indexOf('\nasync function startServer()', start);
  assert.ok(start >= 0 && end > start, 'startup hydration function exists');
  const hydration = serverSource.slice(start, end);
  assert.match(hydration, /await stateStore\.loadActionableOrders\(\)/);
  assert.match(hydration, /mergeActionableOrders\(db\.orders, recovery\.orders\)/);
  assert.match(hydration, /stateStore\.required[\s\S]*?operational_order_store_missing/);
  assert.match(hydration, /operational_order_recovery_incomplete/);
  const startupStart = serverSource.indexOf('async function startServer() {');
  const startupEnd = serverSource.indexOf('\nasync function shutdown(', startupStart);
  const startup = serverSource.slice(startupStart, startupEnd);
  assert.ok(startup.indexOf('await hydrateStateFromPostgres()') < startup.indexOf('app.listen('),
    'the recovery barrier completes before HTTP traffic is accepted');
});

test('normalized order sync keeps historical rows instead of deleting rows absent from the current cache', () => {
  const start = financeRepositorySource.indexOf('async function syncOperationalOrders(client, operationalState) {');
  const end = financeRepositorySource.indexOf('\nasync function syncEvents(', start);
  assert.ok(start >= 0 && end > start, 'normalized operational order sync exists');
  const sync = financeRepositorySource.slice(start, end);
  assert.match(sync, /INSERT INTO unified_orders/);
  assert.match(sync, /JSON\.stringify\(order\)/);
  assert.doesNotMatch(sync, /DELETE\s+FROM\s+unified_orders/i,
    'cache eviction does not erase the durable order archive');
});
