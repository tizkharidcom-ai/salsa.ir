'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizedSchemaAvailable, syncFinanceState } = require('../server/finance-postgres-repository');

class RecordingClient {
  constructor({ available = true } = {}) { this.available = available; this.queries = []; }
  async query(sql, values = []) {
    this.queries.push({ sql: String(sql), values });
    if (/to_regclass/.test(sql)) return { rows: [this.available ? {
      finance_events: 'finance_events', journal_entries: 'journal_entries_v2', outbox: 'finance_outbox',
      cost_snapshots: 'finance_order_item_cost_snapshots', movement_valuations: 'finance_inventory_movement_valuations',
      production_batches: 'finance_production_batches', cost_commitments: 'finance_cost_commitments', fixed_assets: 'finance_fixed_assets', payroll_runs: 'finance_payroll_runs',
      opening_balances: 'finance_opening_balance_batches', legacy_archive: 'finance_legacy_archive', legacy_backfill: true,
    } : {}] };
    return { rows: [], rowCount: 1 };
  }
}

function financeState() {
  return {
    fiscalPeriods: [{ id: '10000000-0000-4000-8000-000000000001', name: 'مرداد', startDate: '2026-08-01', endDate: '2026-08-31', status: 'open' }],
    events: [{
      id: '20000000-0000-4000-8000-000000000001', source: 'order.paid', sourceId: '1', sourceVersion: 1,
      idempotencyKey: 'order:1:v1', branchId: 1, occurredAt: '2026-08-24T10:00:00.000Z', amountIrr: 1000,
      payload: {}, status: 'posted', error: null, processedAt: '2026-08-24T10:00:01.000Z', createdAt: '2026-08-24T10:00:00.000Z',
    }],
    journalEntries: [{
      id: '30000000-0000-4000-8000-000000000001', number: 'F2-000001', periodId: '10000000-0000-4000-8000-000000000001',
      sourceEventId: '20000000-0000-4000-8000-000000000001', source: 'order.paid', sourceId: '1', date: '2026-08-24T10:00:00.000Z',
      description: 'فروش', status: 'posted', debitIrr: 1000, creditIrr: 1000, branchId: 1, createdBy: 'system', createdAt: '2026-08-24T10:00:00.000Z', postedBy: 'system', postedAt: '2026-08-24T10:00:01.000Z',
      lines: [
        { id: '40000000-0000-4000-8000-000000000001', lineNo: 1, accountCode: '1110', debitIrr: 1000, creditIrr: 0, branchId: 1, costCenter: 'branch:1' },
        { id: '40000000-0000-4000-8000-000000000002', lineNo: 2, accountCode: '4110', debitIrr: 0, creditIrr: 1000, branchId: 1, costCenter: 'branch:1' },
      ],
    }],
    approvals: [], purchaseOrders: [], goodsReceipts: [], vendorInvoices: [], supplierPayments: [],
    inventoryMovements: [{
      id: '70000000-0000-4000-8000-000000000001', branchId: 1, itemId: 'inv-1', movementType: 'waste',
      quantityBase: -1, unitCostIrr: null, totalCostIrr: null, source: 'inventory.waste', sourceId: '80000000-0000-4000-8000-000000000001',
      occurredAt: '2026-08-24T12:00:00.000Z', createdBy: 'kitchen', createdAt: '2026-08-24T12:00:00.000Z', reversalOfId: null,
    }],
    inventoryMovementValuations: [{
      id: '90000000-0000-4000-8000-000000000001', movementId: '70000000-0000-4000-8000-000000000001',
      unitCostIrr: 100, totalCostIrr: 100, source: 'inventory_avg_cost_irr', createdBy: 'accountant', createdAt: '2026-08-24T12:30:00.000Z',
    }],
    productionBatches: [], orderItemCostSnapshots: [],
    payments: [{
      id: '50000000-0000-4000-8000-000000000001', orderId: 1, branchId: 1, tender: 'card', amountIrr: 1000,
      status: 'succeeded', idempotencyKey: 'order:1:payment:1', paidAt: '2026-08-24T10:00:00.000Z', createdAt: '2026-08-24T10:00:00.000Z', payload: {},
    }],
    refunds: [{
      id: '60000000-0000-4000-8000-000000000001', paymentId: '50000000-0000-4000-8000-000000000001', amountIrr: 100,
      reason: 'test refund', status: 'succeeded', idempotencyKey: 'refund:1', approvedBy: 'owner', approvedAt: '2026-08-24T11:00:00.000Z', createdBy: 'accountant', createdAt: '2026-08-24T10:30:00.000Z',
    }],
    reconciliationItems: [], costCommitments: [], costAccruals: [], costPayments: [], fixedAssets: [], depreciationRuns: [], payrollRuns: [], payrollPayments: [], openingBalanceBatches: [], legacyArchive: [],
  };
}

test('normalized repository reports missing migrations instead of pretending PostgreSQL is active', async () => {
  const client = new RecordingClient({ available: false });
  assert.equal(await normalizedSchemaAvailable(client), false);
  const result = await syncFinanceState(client, financeState());
  assert.deepEqual(result, { available: false, reason: 'finance_schema_missing' });
  assert.equal(client.queries.length, 2);
});

test('normalized repository inserts posted journal as draft, then lines, then promotes it in one caller transaction', async () => {
  const client = new RecordingClient();
  const state = financeState();
  state.costCommitments.push({
    id: 'a0000000-0000-4000-8000-000000000001', branchId: 1, name: 'اجاره', type: 'rent', frequency: 'monthly',
    monthlyAmountIrr: 2000, expenseAccount: '6200', liabilityAccount: '2700', behavior: 'fixed', startDate: '2026-08-01',
    endDate: null, status: 'active', createdBy: 'accountant', createdAt: '2026-08-01T00:00:00.000Z',
  });
  state.costAccruals.push({
    id: 'a0000000-0000-4000-8000-000000000002', costCommitmentId: 'a0000000-0000-4000-8000-000000000001',
    branchId: 1, serviceMonth: '2026-08', postingDate: '2026-08-24T12:00:00.000Z', fiscalPeriodId: '10000000-0000-4000-8000-000000000001',
    amountIrr: 2000, expenseAccount: '6200', liabilityAccount: '2700', status: 'posted', paidAmountIrr: 1000,
    journalEntryId: '30000000-0000-4000-8000-000000000001', approvalId: 'a0000000-0000-4000-8000-000000000003',
    createdBy: 'accountant', createdAt: '2026-08-24T12:00:00.000Z', postedBy: 'owner', postedAt: '2026-08-24T13:00:00.000Z',
  });
  state.costPayments.push({
    id: 'a0000000-0000-4000-8000-000000000004', costAccrualId: 'a0000000-0000-4000-8000-000000000002', branchId: 1,
    amountIrr: 1000, paymentMethod: 'bank', paymentDate: '2026-08-25T12:00:00.000Z', status: 'paid',
    approvalId: 'a0000000-0000-4000-8000-000000000005', journalEntryId: '30000000-0000-4000-8000-000000000001',
    createdBy: 'accountant', createdAt: '2026-08-25T11:00:00.000Z', approvedBy: 'owner', approvedAt: '2026-08-25T12:00:00.000Z',
  });
  state.fixedAssets.push({
    id: 'b0000000-0000-4000-8000-000000000001', branchId: 1, assetCode: 'AST-F2-1', name: 'اسپرسوساز',
    category: 'kitchen_bar', assetAccount: '1810', fundingMethod: 'bank', fundingAccount: '1210', sourceReference: 'INV-1',
    purchaseDate: '2026-08-01', inServiceDate: '2026-08-01', purchaseCostIrr: 12000, salvageValueIrr: 0,
    usefulLifeMonths: 12, depreciationMethod: 'straight_line', depreciationConvention: 'full_month', accumulatedDepreciationIrr: 1000,
    status: 'active', acquisitionJournalEntryId: '30000000-0000-4000-8000-000000000001', acquisitionApprovalId: 'b0000000-0000-4000-8000-000000000002',
    createdBy: 'accountant', createdAt: '2026-08-01T00:00:00.000Z', approvedBy: 'owner', approvedAt: '2026-08-01T01:00:00.000Z', lastDepreciationMonth: '2026-08', lastDepreciationAt: '2026-08-25T13:00:00.000Z',
  });
  state.depreciationRuns.push({
    id: 'b0000000-0000-4000-8000-000000000003', branchId: 1, serviceMonth: '2026-08', postingDate: '2026-08-25T12:00:00.000Z',
    fiscalPeriodId: '10000000-0000-4000-8000-000000000001', method: 'straight_line', convention: 'full_month', totalDepreciationIrr: 1000,
    status: 'posted', journalEntryId: '30000000-0000-4000-8000-000000000001', approvalId: 'b0000000-0000-4000-8000-000000000004',
    createdBy: 'accountant', createdAt: '2026-08-25T11:00:00.000Z', postedBy: 'owner', postedAt: '2026-08-25T13:00:00.000Z',
    lines: [{ id: 'b0000000-0000-4000-8000-000000000005', assetId: 'b0000000-0000-4000-8000-000000000001', amountIrr: 1000, accumulatedBeforeIrr: 0, remainingBeforeIrr: 12000 }],
  });
  state.payrollRuns.push({
    id: 'c0000000-0000-4000-8000-000000000001', branchId: 1, serviceMonth: '2026-08', postingDate: '2026-08-25T12:00:00.000Z',
    fiscalPeriodId: '10000000-0000-4000-8000-000000000001', sourceReference: 'PAYROLL-1', headcount: 2,
    kitchenGrossIrr: 2000, serviceGrossIrr: 1000, totalGrossIrr: 3000, employerInsuranceIrr: 300,
    employeeInsuranceIrr: 200, totalInsuranceIrr: 500, payrollTaxIrr: 100, otherDeductionsIrr: 0,
    netPayIrr: 2700, totalExpenseIrr: 3300, calculationPolicy: 'accountant_confirmed_totals_no_automatic_statutory_rate',
    status: 'partially_paid', paidByLiability: { net_salary: 1000, social_security: 0, payroll_tax: 0, other_deductions: 0 },
    journalEntryId: '30000000-0000-4000-8000-000000000001', approvalId: 'c0000000-0000-4000-8000-000000000002',
    createdBy: 'accountant', createdAt: '2026-08-25T10:00:00.000Z', postedBy: 'owner', postedAt: '2026-08-25T11:00:00.000Z',
  });
  state.payrollPayments.push({
    id: 'c0000000-0000-4000-8000-000000000003', payrollRunId: 'c0000000-0000-4000-8000-000000000001', branchId: 1,
    liabilityType: 'net_salary', liabilityAccount: '2600', amountIrr: 1000, paymentMethod: 'bank', paymentDate: '2026-08-26T12:00:00.000Z',
    reference: 'BANK-PAY-1', status: 'paid', approvalId: 'c0000000-0000-4000-8000-000000000004', journalEntryId: '30000000-0000-4000-8000-000000000001',
    createdBy: 'accountant', createdAt: '2026-08-26T10:00:00.000Z', approvedBy: 'owner', approvedAt: '2026-08-26T12:00:00.000Z',
  });
  state.legacyArchive.push({
    id: 'd0000000-0000-4000-8000-000000000001', sourceTable: 'orders', sourceId: 'legacy-1', trustStatus: 'inferred_needs_approval',
    reason: 'payment_tender_missing', sourcePayload: { id: 'legacy-1', total: 100 }, branchId: 1, amountIrr: 1000,
    occurredAt: '2026-08-24T10:00:00.000Z', classificationDetails: {}, decision: 'approved_for_backfill',
    decisionNotes: 'رسید کارتخوان کنترل شد', evidenceReference: 'POS-1', decisionHistory: [], decidedBy: 'owner',
    decidedAt: '2026-08-25T12:00:00.000Z', archivedBy: 'accountant', archivedAt: '2026-08-25T10:00:00.000Z',
    reviewedTenders: [{ tender: 'card', amountIrr: 1000 }], backfillStatus: 'not_requested',
  });
  state.openingBalanceBatches.push({
    id: 'e0000000-0000-4000-8000-000000000001', branchId: 1, asOfDate: '2026-08-01',
    fiscalPeriodId: '10000000-0000-4000-8000-000000000001', sourceReference: 'OPEN-1',
    debitIrr: 1000, creditIrr: 1000, status: 'posted',
    lines: [
      { accountCode: '1210', debitIrr: 1000, creditIrr: 0, branchId: 1, costCenter: 'branch:1' },
      { accountCode: '3100', debitIrr: 0, creditIrr: 1000, branchId: 1, costCenter: 'branch:1' },
    ],
    journalEntryId: '30000000-0000-4000-8000-000000000001', approvalId: 'e0000000-0000-4000-8000-000000000002',
    createdBy: 'accountant', createdAt: '2026-08-01T00:00:00.000Z', decidedBy: 'owner', decidedAt: '2026-08-01T01:00:00.000Z',
    postedBy: 'owner', postedAt: '2026-08-01T01:00:00.000Z',
  });
  const result = await syncFinanceState(client, state);
  assert.equal(result.available, true);
  const entryInsert = client.queries.findIndex((row) => /INSERT INTO journal_entries_v2/.test(row.sql));
  const lineInsert = client.queries.findIndex((row) => /INSERT INTO journal_lines_v2/.test(row.sql));
  const promote = client.queries.findIndex((row) => /UPDATE journal_entries_v2 SET status/.test(row.sql));
  assert.ok(entryInsert > -1 && lineInsert > entryInsert && promote > lineInsert);
  assert.equal(client.queries[entryInsert].values[8], 'draft');
  assert.equal(client.queries[promote].values[1], 'posted');
  assert.ok(client.queries.some((row) => /INSERT INTO finance_outbox/.test(row.sql)));
  const paymentInsert = client.queries.findIndex((row) => /INSERT INTO finance_payments/.test(row.sql));
  const refundInsert = client.queries.findIndex((row) => /INSERT INTO finance_refunds/.test(row.sql));
  assert.ok(paymentInsert > -1 && refundInsert > paymentInsert);
  assert.ok(client.queries.some((row) => /INSERT INTO finance_inventory_movement_valuations/.test(row.sql)));
  assert.ok(client.queries.some((row) => /INSERT INTO finance_cost_commitments/.test(row.sql)));
  assert.ok(client.queries.some((row) => /INSERT INTO finance_cost_accruals/.test(row.sql)));
  assert.ok(client.queries.some((row) => /INSERT INTO finance_cost_payments/.test(row.sql)));
  assert.ok(client.queries.some((row) => /INSERT INTO finance_fixed_assets/.test(row.sql)));
  assert.ok(client.queries.some((row) => /INSERT INTO finance_depreciation_runs/.test(row.sql)));
  assert.ok(client.queries.some((row) => /INSERT INTO finance_asset_depreciation_lines/.test(row.sql)));
  assert.ok(client.queries.some((row) => /INSERT INTO finance_payroll_runs/.test(row.sql)));
  assert.ok(client.queries.some((row) => /INSERT INTO finance_payroll_payments/.test(row.sql)));
  assert.ok(client.queries.some((row) => /INSERT INTO finance_opening_balance_batches/.test(row.sql)));
  assert.ok(client.queries.some((row) => /INSERT INTO finance_legacy_archive/.test(row.sql)));
  assert.ok(client.queries.some((row) => /backfill_reversal_journal_entry_id/.test(row.sql)));
  assert.equal(result.counts.costCommitments, 1);
  assert.equal(result.counts.costAccruals, 1);
  assert.equal(result.counts.fixedAssets, 1);
  assert.equal(result.counts.depreciationRuns, 1);
  assert.equal(result.counts.payrollRuns, 1);
  assert.equal(result.counts.payrollPayments, 1);
  assert.equal(result.counts.openingBalanceBatches, 1);
  assert.equal(result.counts.legacyArchive, 1);
});
