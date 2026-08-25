const test = require('node:test');
const assert = require('node:assert/strict');
const { createPostgresStateStore, mergeState, stateSummary, reconciliationSummary } = require('../server/postgres-state');

class FakePool {
  constructor() {
    this.snapshot = null;
    this.version = 0;
    this.audit = [];
    this.queries = [];
  }

  async query(sql, values = []) {
    this.queries.push({ sql, values });
    if (/SELECT data, version FROM westo_state/.test(sql)) {
      return this.snapshot ? { rowCount: 1, rows: [{ data: this.snapshot, version: this.version }] } : { rowCount: 0, rows: [] };
    }
    if (/INSERT INTO westo_state/.test(sql)) {
      if (this.snapshot) return { rowCount: 0, rows: [] };
      this.snapshot = JSON.parse(values[0]);
      this.version = 1;
      return { rowCount: 1, rows: [{ version: this.version }] };
    }
    if (/UPDATE westo_state/.test(sql)) {
      if (!this.snapshot || Number(values[2]) !== this.version) return { rowCount: 0, rows: [] };
      this.snapshot = JSON.parse(values[0]);
      this.version += 1;
      return { rowCount: 1, rows: [{ version: this.version }] };
    }
    if (/INSERT INTO westo_audit_events/.test(sql)) {
      this.audit.push(values);
      return { rowCount: 1, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  }

  async end() {}
}

class FinanceSchemaPool extends FakePool {
  async query(sql, values = []) {
    if (/to_regclass/.test(sql)) {
      this.queries.push({ sql, values });
      return { rows: [{
        finance_events: 'finance_events', journal_entries: 'journal_entries_v2', outbox: 'finance_outbox',
        cost_snapshots: 'finance_order_item_cost_snapshots', movement_valuations: 'finance_inventory_movement_valuations',
        production_batches: 'finance_production_batches', cost_commitments: 'finance_cost_commitments',
        fixed_assets: 'finance_fixed_assets', payroll_runs: 'finance_payroll_runs', opening_balances: 'finance_opening_balance_batches', legacy_archive: 'finance_legacy_archive', legacy_backfill: true,
      }] };
    }
    return super.query(sql, values);
  }
}

test('postgres store seeds once then hydrates the authoritative snapshot', async () => {
  const store = createPostgresStateStore({ connectionString: 'postgres://test', Pool: FakePool, logger: { info() {}, warn() {} } });
  const first = { menuItems: [{ id: 1 }], orders: [], reservations: [], users: [] };
  const seeded = await store.hydrate(first);
  assert.equal(seeded.source, 'json-seeded');

  await store.write({ ...first, orders: [{ id: 8 }] });
  const hydrated = await store.hydrate({ menuItems: [], orders: [], reservations: [], users: [], deliveryZones: [] });
  assert.equal(hydrated.source, 'postgres');
  assert.equal(hydrated.state.orders[0].id, 8);
  assert.deepEqual(stateSummary(hydrated.state), { menuCategories: 0, menuItems: 1, orders: 1, reservations: 0, users: 0 });
  await store.appendAudit({ id: '00000000-0000-4000-8000-000000000001', at: new Date().toISOString(), actor: null, action: 'test', targetType: 'test', targetId: '1', branchId: 1, meta: {} });
  await store.close();
});

test('required PostgreSQL mode fails closed when finance schema is missing', async () => {
  const store = createPostgresStateStore({ connectionString: 'postgres://test', required: true, Pool: FakePool, logger: { info() {}, warn() {} } });
  await assert.rejects(() => store.hydrate({ orders: [] }), (error) => error.code === 'finance_schema_required');
  assert.deepEqual(store.financeStatus(), { required: true, snapshotVersion: null, available: false, reason: 'finance_schema_required' });
  await store.close();
});

test('required PostgreSQL mode accepts a complete normalized finance schema and never needs JSON write authority', async () => {
  const store = createPostgresStateStore({ connectionString: 'postgres://test', required: true, Pool: FinanceSchemaPool, logger: { info() {}, warn() {} } });
  const state = { menuItems: [], orders: [], reservations: [], users: [], financeV2: {} };
  const hydrated = await store.hydrate(state);
  assert.equal(hydrated.source, 'json-seeded');
  assert.equal(store.required, true);
  assert.equal(store.financeStatus().available, true);
  assert.equal(store.financeStatus().snapshotVersion, 1);
  await store.close();
});

test('two PostgreSQL-backed processes detect stale snapshots instead of losing an update', async () => {
  const backend = { snapshot: null, version: 0, queries: [] };
  class SharedPool extends FakePool {
    constructor() { super(); }
    async query(sql, values = []) {
      backend.queries.push({ sql, values });
      if (/SELECT data, version FROM westo_state/.test(sql)) {
        return backend.snapshot ? { rowCount: 1, rows: [{ data: backend.snapshot, version: backend.version }] } : { rowCount: 0, rows: [] };
      }
      if (/INSERT INTO westo_state/.test(sql)) {
        if (backend.snapshot) return { rowCount: 0, rows: [] };
        backend.snapshot = JSON.parse(values[0]); backend.version = 1;
        return { rowCount: 1, rows: [{ version: 1 }] };
      }
      if (/UPDATE westo_state/.test(sql)) {
        if (Number(values[2]) !== backend.version) return { rowCount: 0, rows: [] };
        backend.snapshot = JSON.parse(values[0]); backend.version += 1;
        return { rowCount: 1, rows: [{ version: backend.version }] };
      }
      return { rowCount: 0, rows: [] };
    }
  }
  const logger = { info() {}, warn() {} };
  const first = createPostgresStateStore({ connectionString: 'postgres://shared', Pool: SharedPool, logger });
  const second = createPostgresStateStore({ connectionString: 'postgres://shared', Pool: SharedPool, logger });
  const base = { menuItems: [], orders: [], reservations: [], users: [] };
  await first.hydrate(base);
  await second.hydrate(base);
  await first.write({ ...base, orders: [{ id: 1 }] });
  await assert.rejects(() => second.write({ ...base, orders: [{ id: 2 }] }), (error) => error.code === 'postgres_state_write_conflict' && error.status === 409);
  assert.deepEqual(backend.snapshot.orders, [{ id: 1 }]);
  await first.close(); await second.close();
});

test('state merge retains fallback fields introduced after an older snapshot', () => {
  assert.deepEqual(mergeState({ deliveryZones: [], commandCenter: { schemaVersion: 1 }, orders: [] }, { orders: [{ id: 2 }] }), {
    deliveryZones: [], commandCenter: { schemaVersion: 1 }, orders: [{ id: 2 }],
  });
});

test('reconciliation summary checks stock, payments and financial totals', () => {
  const summary = reconciliationSummary({
    menuItems: [{ id: 1, stock: 4 }, { id: 2, stock: null }],
    orders: [
      { id: 1, total: 100, status: 'paid', paymentStatus: 'paid' },
      { id: 2, total: 60, status: 'cancelled', paymentStatus: 'cancelled' },
    ],
    reservations: [{ id: 1, status: 'pending' }, { id: 2, status: 'cancelled' }],
    paymentAttempts: [{ id: 1, status: 'paid' }, { id: 2, status: 'failed' }],
  });
  assert.equal(summary.finiteStockItems, 1);
  assert.equal(summary.finiteStockUnits, 4);
  assert.equal(summary.orderGrossTotal, 160);
  assert.equal(summary.paidOrderTotal, 100);
  assert.equal(summary.activeReservations, 1);
  assert.equal(summary.paidPayments, 1);
});
