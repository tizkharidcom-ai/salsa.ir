'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizedSchemaAvailable, syncFinanceState } = require('../server/finance-postgres-repository');

function refundFixture(overrides = {}) {
  return {
    id: 'refund-persistence-1', paymentId: 'payment-persistence-1', amountIrr: 2500,
    reason: 'customer refund', status: 'approved', idempotencyKey: 'refund-persistence-key-1',
    approvedBy: 'manager-1', approvedAt: '2026-09-20T10:05:00.000Z',
    createdBy: 'cashier-1', createdAt: '2026-09-20T10:00:00.000Z',
    ...overrides,
  };
}

async function captureRefundUpsert({ rowCount = 1, refund = refundFixture() } = {}) {
  const statements = [];
  const client = {
    async query(sql, values) {
      statements.push({ sql, values });
      if (sql.includes('INSERT INTO finance_refunds')) return { rows: rowCount ? [{ id: 'refund-persistence-1' }] : [], rowCount };
      if (sql.includes('information_schema.columns')) return { rows: [{ count: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
  await syncFinanceState(client, { refunds: [refund] }, { checkSchema: false });
  return statements.find((statement) => statement.sql.includes('INSERT INTO finance_refunds'));
}

test('PostgreSQL refund projection binds approval identity and allows only forward status transitions', async () => {
  const statement = await captureRefundUpsert();
  assert.ok(statement);
  for (const field of ['payment_id', 'amount_irr', 'reason', 'idempotency_key', 'created_by']) {
    assert.match(statement.sql, new RegExp(`finance_refunds\\.${field} IS NOT DISTINCT FROM EXCLUDED\\.${field}`));
  }
  assert.match(statement.sql, /finance_refunds\.status IS NOT DISTINCT FROM EXCLUDED\.status/);
  assert.match(statement.sql, /finance_refunds\.status='pending_approval' AND EXCLUDED\.status IN \('approved','cancelled'\)/);
  assert.match(statement.sql, /finance_refunds\.status='approved' AND EXCLUDED\.status IN \('processing','succeeded','failed','cancelled'\)/);
  assert.match(statement.sql, /finance_refunds\.status='processing' AND EXCLUDED\.status IN \('succeeded','failed','cancelled'\)/);
  assert.match(statement.sql, /finance_refunds\.approved_by IS NOT DISTINCT FROM EXCLUDED\.approved_by/);
  assert.match(statement.sql, /EXCLUDED\.approved_by IS NOT NULL AND EXCLUDED\.approved_at IS NOT NULL/);
});

test('PostgreSQL refund projection fails closed on identity or lifecycle conflicts', async () => {
  await assert.rejects(captureRefundUpsert({ rowCount: 0 }), {
    code: 'postgres_finance_immutable_conflict', entity: 'refund', sourceId: 'refund-persistence-1',
  });
});

test('PostgreSQL payment projection allows receipt-to-sale links to evolve while locking payment identity', async () => {
  const statements = [];
  const client = {
    async query(sql, values) {
      statements.push({ sql, values });
      if (sql.includes('INSERT INTO finance_payments')) return { rows: [{ id: 'payment-persistence-1' }], rowCount: 1 };
      if (sql.includes('information_schema.columns')) return { rows: [{ count: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
  await syncFinanceState(client, { payments: [{
    id: 'payment-persistence-1', orderId: 41, branchId: 4, tender: 'manual_card', amountIrr: 5000,
    status: 'succeeded', provider: null, providerReference: 'POS-REF-1',
    idempotencyKey: 'order:41:payment:1', paidAt: '2026-09-23T10:00:00.000Z',
    payload: {
      operationalPaymentId: '1', orderNo: 'ORD-41', cashSessionId: 'cash-session-41', receiptFinanceEventId: 'receipt-event-1',
      receiptJournalEntryId: 'receipt-journal-1', financeEventId: 'sale-event-1', journalEntryId: 'sale-journal-1',
    },
  }] }, { checkSchema: false });
  const statement = statements.find((entry) => entry.sql.includes('INSERT INTO finance_payments'));
  assert.ok(statement);
  assert.match(statement.sql, /ON CONFLICT\(id\) DO UPDATE SET status=EXCLUDED\.status,payload=EXCLUDED\.payload/);
  for (const key of ['operationalPaymentId', 'orderNo', 'cashSessionId', 'receiptFinanceEventId', 'receiptJournalEntryId']) {
    assert.match(statement.sql, new RegExp(`finance_payments\.payload->>'${key}' IS NOT DISTINCT FROM EXCLUDED\.payload->>'${key}'`));
  }
  assert.doesNotMatch(statement.sql, /finance_payments\.payload IS NOT DISTINCT FROM EXCLUDED\.payload/);
});

test('PostgreSQL event projection permits additive resolution metadata but preserves original evidence', async () => {
  const statements = [];
  const client = {
    async query(sql, values) {
      statements.push({ sql, values });
      if (sql.includes('INSERT INTO finance_events') || sql.includes('INSERT INTO finance_outbox')) {
        return { rows: [{ id: 'event-persistence-1' }], rowCount: 1 };
      }
      if (sql.includes('information_schema.columns')) return { rows: [{ count: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
  await syncFinanceState(client, { events: [{
    id: 'event-persistence-1', source: 'order.paid', sourceId: 'order-41', sourceVersion: 1,
    idempotencyKey: 'order-paid:41', branchId: 4, occurredAt: '2026-09-23T10:00:00.000Z', amountIrr: 5000,
    payload: { orderNo: 'ORD-41', tenderSnapshot: [{ tender: 'cash', amountIrr: 5000 }] },
    status: 'posted', error: null, processedAt: '2026-09-23T10:01:00.000Z', createdAt: '2026-09-23T10:00:00.000Z',
  }] }, { checkSchema: false });
  const statement = statements.find((entry) => entry.sql.includes('INSERT INTO finance_events'));
  assert.ok(statement);
  assert.match(statement.sql, /finance_events\.payload <@ EXCLUDED\.payload/);
  assert.doesNotMatch(statement.sql, /finance_events\.payload IS NOT DISTINCT FROM EXCLUDED\.payload/);
  assert.match(statement.sql, /finance_events\.source IS NOT DISTINCT FROM EXCLUDED\.source/);
  assert.match(statement.sql, /finance_events\.amount_irr IS NOT DISTINCT FROM EXCLUDED\.amount_irr/);
  const outboxStatement = statements.find((entry) => entry.sql.includes('INSERT INTO finance_outbox'));
  assert.ok(outboxStatement);
  assert.match(outboxStatement.sql, /finance_outbox\.payload <@ EXCLUDED\.payload/);
});

function schemaReadinessRow(overrides = {}) {
  return Object.fromEntries([
    'finance_events', 'finance_payments', 'finance_refunds', 'inventory_movements', 'purchase_orders', 'goods_receipts',
    'cost_accruals', 'cost_payments', 'depreciation_runs', 'depreciation_lines', 'journal_entries', 'journal_lines',
    'approvals', 'reconciliation_items', 'outbox', 'cost_snapshots', 'movement_valuations', 'production_batches',
    'inventory_items', 'inventory_balances', 'item_unit_conversions', 'cash_sessions', 'recipe_versions', 'recipe_ingredients',
    'cost_commitments', 'fixed_assets', 'payroll_runs', 'opening_balances', 'branch_rollouts', 'migration_baselines',
    'schema_migrations', 'idempotency_requests', 'legacy_archive', 'vendor_invoices', 'vendor_payments',
    'vendor_invoice_reversals', 'vendor_payment_reversals', 'recipe_workflow', 'legacy_backfill',
    'payment_branch_scope', 'refund_total_guard', 'payment_idempotency_unique', 'refund_idempotency_unique', 'idempotency_immutable',
  ].map((key) => [key, true]).map(([key, value]) => [key, overrides[key] ?? value]));
}

test('normalized PostgreSQL readiness requires branch, refund-total, and idempotency database guards', async () => {
  const client = { async query(sql) {
    assert.match(sql, /finance_payments_order_branch_fkey/);
    assert.match(sql, /finance_refund_total_guard/);
    assert.match(sql, /finance_idempotency_request_immutable_trigger/);
    assert.match(sql, /attnotnull/);
    return { rows: [schemaReadinessRow()] };
  } };
  assert.equal(await normalizedSchemaAvailable(client), true);

  for (const guard of [
    'payment_branch_scope', 'refund_total_guard', 'payment_idempotency_unique',
    'refund_idempotency_unique', 'idempotency_immutable',
  ]) {
    const missingGuardClient = { async query() { return { rows: [schemaReadinessRow({ [guard]: false })] }; } };
    assert.equal(await normalizedSchemaAvailable(missingGuardClient), false, `${guard} must fail readiness closed`);
  }
});
