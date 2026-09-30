'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPostgresStateStore } = require('../server/postgres-state');

function createSharedPostgresPool(shared) {
  return class FakePostgresPool {
    async query(sql, params = []) {
      const query = String(sql);
      if (/^\s*SELECT data, version FROM westo_state WHERE id = 1/i.test(query)) {
        return shared.row
          ? { rowCount: 1, rows: [{ data: structuredClone(shared.row.data), version: shared.row.version }] }
          : { rowCount: 0, rows: [] };
      }
      if (query.includes("to_regclass('public.unified_orders')")) {
        return { rowCount: 1, rows: [{ tbl: null }] };
      }
      if (query.includes("to_regclass('public.finance_events')")) {
        return { rowCount: 1, rows: [{ finance_events: null }] };
      }
      if (/^\s*INSERT INTO westo_state/i.test(query)) {
        if (shared.row) return { rowCount: 0, rows: [] };
        shared.row = { data: JSON.parse(params[0]), version: 1 };
        return { rowCount: 1, rows: [{ version: 1 }] };
      }
      if (/^\s*UPDATE westo_state/i.test(query)) {
        if (!shared.row || Number(shared.row.version) !== Number(params[2])) {
          return { rowCount: 0, rows: [] };
        }
        shared.row = {
          data: JSON.parse(params[0]),
          version: Number(shared.row.version) + 1,
        };
        return { rowCount: 1, rows: [{ version: shared.row.version }] };
      }
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(query)) return { rowCount: 0, rows: [] };
      if (/^\s*(CREATE|ALTER|DROP|GRANT|REVOKE|COMMENT|CREATE INDEX)/i.test(query)) {
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`Unexpected SQL in isolated concurrency test: ${query.slice(0, 100)}`);
    }

    async connect() {
      return {
        query: this.query.bind(this),
        release() {},
      };
    }

    async end() {}
  };
}

test('independent PostgreSQL state-store instances reject stale concurrent order/payment snapshots', async (t) => {
  const shared = { row: null };
  const Pool = createSharedPostgresPool(shared);
  const options = {
    connectionString: 'postgres://isolated-test.invalid/state',
    Pool,
    logger: { info() {}, warn() {}, error() {} },
  };
  const first = createPostgresStateStore(options);
  const second = createPostgresStateStore(options);
  t.after(async () => Promise.all([first.close(), second.close()]));

  const seed = { orders: [], financeV2: { journalEntries: [] } };
  await first.hydrate(seed);
  await second.hydrate(seed);
  assert.equal(shared.row.version, 1);

  const firstSnapshot = {
    orders: [{ id: 901, branchId: 7, amountPaid: 100, paymentStatus: 'partial' }],
    financeV2: { journalEntries: [{ id: 'first-payment-leg' }] },
  };
  const staleSnapshot = {
    orders: [{ id: 901, branchId: 7, amountPaid: 80, paymentStatus: 'partial' }],
    financeV2: { journalEntries: [{ id: 'stale-payment-leg' }] },
  };

  const writes = await Promise.allSettled([first.write(firstSnapshot), second.write(staleSnapshot)]);
  assert.equal(writes.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(writes.filter((result) => result.status === 'rejected').length, 1);
  const conflict = writes.find((result) => result.status === 'rejected').reason;
  assert.equal(conflict.code, 'postgres_state_write_conflict');
  assert.equal(conflict.status, 409);
  assert.equal(shared.row.version, 2);
  assert.ok(
    ['first-payment-leg', 'stale-payment-leg'].includes(shared.row.data.financeV2.journalEntries[0].id),
    'exactly one competing snapshot is durable',
  );
  assert.notEqual(
    shared.row.data.financeV2.journalEntries[0].id,
    writes[0].status === 'fulfilled' ? staleSnapshot.financeV2.journalEntries[0].id : firstSnapshot.financeV2.journalEntries[0].id,
    'the losing stale financial snapshot must not overwrite the committed payment leg',
  );
});
