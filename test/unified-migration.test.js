'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { importPlan, importData } = require('../server/migrate-unified-postgres');

class RecordingClient {
  constructor() { this.queries = []; }
  async query(sql, values = []) {
    this.queries.push({ sql: String(sql), values });
    return { rowCount: 1, rows: [] };
  }
}

function sourceFixture() {
  return {
    branches: [{ id: 1, slug: 'main', name: 'شعبه اصلی' }],
    menuItems: [{ id: 10, categoryId: 1, name: 'شیرموز', price: 100000 }],
    tables: [{ id: 4, branchId: 1, label: 'میز ۴', seats: 2 }],
    orders: [{
      id: 21, orderNo: 'WSTO-21', branchId: 1, status: 'paid', paymentStatus: 'paid',
      paymentMethod: null, total: 100000, createdAt: '2026-08-25T10:00:00.000Z',
      items: [{ menuItemId: 10, name: 'شیرموز', qty: 1, price: 100000, lineTotal: 100000 }],
    }],
  };
}

test('unified import plan is read-only operational staging and never promises finance journals', () => {
  const plan = importPlan(sourceFixture(), { dbPath: '/tmp/source.json', sha256: 'abc' });
  assert.equal(plan.mode, 'operational_staging_only');
  assert.equal(plan.orders, 1);
  assert.equal(plan.financeJournalsCreated, 0);
  assert.equal(plan.financePolicy, 'finance_v2_evidence_approval_only');
  assert.equal(plan.sourceSha256, 'abc');
});

test('unified operational import stages a paid order without bypassing Finance V2 evidence approval', async () => {
  const client = new RecordingClient();
  await importData(client, sourceFixture());
  assert.ok(client.queries.some((row) => /INSERT INTO unified_orders/.test(row.sql)));
  assert.ok(client.queries.some((row) => /INSERT INTO unified_order_items/.test(row.sql)));
  assert.equal(client.queries.some((row) => /unified_journal_entries/.test(row.sql)), false);

  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'migrate-unified-postgres.js'), 'utf8');
  assert.doesNotMatch(source, /INSERT INTO unified_journal_entries/);
  assert.match(source, /WESTO_UNIFIED_IMPORT_CONFIRM/);
  assert.match(source, /IMPORT_OPERATIONAL_STAGING/);
});

