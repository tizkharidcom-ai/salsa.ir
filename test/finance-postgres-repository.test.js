'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizedSchemaAvailable, syncFinanceState } = require('../server/finance-postgres-repository');

class RecordingClient {
  constructor({ available = true } = {}) { this.available = available; this.queries = []; }
  async query(sql, values = []) {
    this.queries.push({ sql: String(sql), values });
    if (/to_regclass/.test(sql)) return { rows: [this.available ? {
      finance_events: 'finance_events', finance_payments: 'finance_payments', finance_refunds: 'finance_refunds', inventory_movements: 'finance_inventory_movements',
      purchase_orders: 'finance_purchase_orders', goods_receipts: 'finance_goods_receipts', cost_accruals: 'finance_cost_accruals', cost_payments: 'finance_cost_payments',
      depreciation_runs: 'finance_depreciation_runs', depreciation_lines: 'finance_asset_depreciation_lines', journal_entries: 'journal_entries_v2', journal_lines: 'journal_lines_v2',
      approvals: 'finance_approvals', reconciliation_items: 'reconciliation_items', outbox: 'finance_outbox',
      cost_snapshots: 'finance_order_item_cost_snapshots', movement_valuations: 'finance_inventory_movement_valuations',
      production_batches: 'finance_production_batches', inventory_items: 'finance_inventory_items_v2', recipe_versions: 'finance_recipe_versions', recipe_ingredients: 'finance_recipe_ingredients', recipe_workflow: true,
      cost_commitments: 'finance_cost_commitments', fixed_assets: 'finance_fixed_assets', payroll_runs: 'finance_payroll_runs',
      opening_balances: 'finance_opening_balance_batches', branch_rollouts: 'finance_branch_rollouts', migration_baselines: 'finance_migration_baselines', idempotency_requests: 'finance_idempotency_requests', legacy_archive: 'finance_legacy_archive',
      schema_migrations: 'finance_schema_migrations', vendor_invoices: 'finance_vendor_invoices', vendor_payments: 'finance_vendor_payments',
      vendor_invoice_reversals: true, vendor_payment_reversals: true, legacy_backfill: true,
    } : {}] };
    return { rows: [], rowCount: 1 };
  }
}

class ArchiveConflictClient extends RecordingClient {
  async query(sql, values = []) {
    if (/INSERT INTO finance_legacy_archive/.test(sql)) return { rows: [], rowCount: 0 };
    return super.query(sql, values);
  }
}

class PartialSchemaClient extends RecordingClient {
  async query(sql, values = []) {
    const result = await super.query(sql, values);
    if (/to_regclass/.test(sql) && result.rows?.[0]) result.rows[0].finance_payments = null;
    return result;
  }
}

class BaselineConflictClient extends RecordingClient {
  async query(sql, values = []) {
    if (/SELECT branch_id,status,source_count,source_keys/.test(sql)) {
      return { rows: [{
        branch_id: 1, status: 'active', source_count: 99, source_keys: [], source_fingerprints: {},
        source_sha256: 'b'.repeat(64), trust_summary: {}, scanned_by: 'old-auditor', scanned_at: '2026-08-01T00:00:00.000Z',
      }], rowCount: 1 };
    }
    return super.query(sql, values);
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
    productionBatches: [], recipeVersions: [], orderItemCostSnapshots: [],
    payments: [{
      id: '50000000-0000-4000-8000-000000000001', orderId: 1, branchId: 1, tender: 'card', amountIrr: 1000,
      status: 'succeeded', idempotencyKey: 'order:1:payment:1', paidAt: '2026-08-24T10:00:00.000Z', createdAt: '2026-08-24T10:00:00.000Z', payload: {},
    }],
    refunds: [{
      id: '60000000-0000-4000-8000-000000000001', paymentId: '50000000-0000-4000-8000-000000000001', amountIrr: 100,
      reason: 'test refund', status: 'succeeded', idempotencyKey: 'refund:1', approvedBy: 'owner', approvedAt: '2026-08-24T11:00:00.000Z', createdBy: 'accountant', createdAt: '2026-08-24T10:30:00.000Z',
    }],
    reconciliationItems: [], costCommitments: [], costAccruals: [], costPayments: [], fixedAssets: [], depreciationRuns: [], payrollRuns: [], payrollPayments: [], openingBalanceBatches: [], branchRollouts: [], migrationBaselines: [], legacyArchive: [],
    idempotencyRequests: { 'route-key-123': { kind: 'POST:/api/admin/v2/finance/purchase-orders', fingerprint: 'a'.repeat(64), at: '2026-08-24T09:00:00.000Z' } },
    idempotency: { 'route-key-123': { kind: 'purchase_order', id: 'route-po-1', at: '2026-08-24T09:00:00.000Z' } },
  };
}

test('normalized repository reports missing migrations instead of pretending PostgreSQL is active', async () => {
  const client = new RecordingClient({ available: false });
  assert.equal(await normalizedSchemaAvailable(client), false);
  const result = await syncFinanceState(client, financeState());
  assert.deepEqual(result, { available: false, reason: 'finance_schema_missing' });
  assert.equal(client.queries.length, 2);
});

test('normalized repository rejects a partial finance schema before sync can fail mid-flight', async () => {
  const client = new PartialSchemaClient();
  assert.equal(await normalizedSchemaAvailable(client), false);
  assert.deepEqual(await syncFinanceState(client, financeState()), { available: false, reason: 'finance_schema_missing' });
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
  state.branchRollouts.push({
    id: 'f0000000-0000-4000-8000-000000000001', branchId: 1, status: 'active',
    approvalId: 'f0000000-0000-4000-8000-000000000002', requestedBy: 'manager', requestedAt: '2026-08-25T10:00:00.000Z',
    decidedBy: 'owner', decidedAt: '2026-08-25T11:00:00.000Z', activatedBy: 'owner', activatedAt: '2026-08-25T11:00:00.000Z',
    readinessSnapshot: { status: 'READY_FOR_CUTOVER_REVIEW' }, readinessAtActivation: { status: 'READY_FOR_CUTOVER_REVIEW' },
  });
  state.migrationBaselines.push({
    id: 'fa000000-0000-4000-8000-000000000001', branchId: 1, status: 'active', sourceCount: 1,
    sourceKeys: ['orders:legacy-1'], sourceFingerprints: { 'orders:legacy-1': 'a'.repeat(64) }, sourceSha256: 'b'.repeat(64),
    trustSummary: { verified: 0, inferred_needs_approval: 1, quarantined: 0 }, scannedBy: 'accountant',
    scannedAt: '2026-08-25T09:00:00.000Z', supersededAt: null,
  });
  state.approvals.push({
    id: 'ab000000-0000-4000-8000-000000000001', operation: 'approve_recipe_version', entityType: 'recipe_version',
    entityId: 'ab000000-0000-4000-8000-000000000002', amountIrr: 0, status: 'approved', createdBy: 'kitchen-1',
    createdAt: '2026-08-20T10:00:00.000Z', decidedBy: 'owner-1', decidedAt: '2026-08-20T11:00:00.000Z', history: [],
  });
  state.recipeVersions.push({
    id: 'ab000000-0000-4000-8000-000000000002', recipeId: 'menu:501:branch:1', menuItemId: '501', menuItemName: 'برگر',
    name: 'برگر نسخه ۱', version: 1, branchId: 1, yieldQuantity: 1, effectiveFrom: '2026-08-20T00:00:00.000Z',
    effectiveTo: null, outputItemId: null, status: 'approved', approvalId: 'ab000000-0000-4000-8000-000000000001',
    createdBy: 'kitchen-1', createdAt: '2026-08-20T10:00:00.000Z', approvedBy: 'owner-1', approvedAt: '2026-08-20T11:00:00.000Z', history: [],
    ingredients: [{ id: 'ab000000-0000-4000-8000-000000000003', lineNo: 1, itemId: 'beef', quantity: 0.2, unit: 'kg', quantityBasis: 'raw', yieldPercent: 100 }],
  });
  const operationalState = { accounting: { inventoryItems: [{ id: 'beef', branchId: 1, sku: 'BEEF', name: 'گوشت', unit: 'kg', minStock: 1, safetyStock: 0.5, leadTimeDays: 2 }] } };
  const result = await syncFinanceState(client, state, { operationalState });
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
  assert.ok(client.queries.some((row) => /INSERT INTO finance_branch_rollouts/.test(row.sql)));
  assert.ok(client.queries.some((row) => /INSERT INTO finance_migration_baselines/.test(row.sql)));
  assert.ok(client.queries.some((row) => /INSERT INTO finance_legacy_archive/.test(row.sql)));
  assert.ok(client.queries.some((row) => /INSERT INTO finance_idempotency_requests/.test(row.sql)));
  const approvalInsert = client.queries.findIndex((row) => /INSERT INTO finance_approvals/.test(row.sql) && row.values[0] === 'ab000000-0000-4000-8000-000000000001');
  const inventoryInsert = client.queries.findIndex((row) => /INSERT INTO finance_inventory_items_v2/.test(row.sql));
  const recipeInsert = client.queries.findIndex((row) => /INSERT INTO finance_recipe_versions/.test(row.sql));
  const ingredientInsert = client.queries.findIndex((row) => /INSERT INTO finance_recipe_ingredients/.test(row.sql));
  const recipePromote = client.queries.findIndex((row) => /UPDATE finance_recipe_versions SET status='approved'/.test(row.sql));
  assert.ok(approvalInsert > -1 && inventoryInsert > approvalInsert && recipeInsert > inventoryInsert && ingredientInsert > recipeInsert && recipePromote > ingredientInsert);
  assert.ok(client.queries.some((row) => /backfill_reversal_journal_entry_id/.test(row.sql)));
  assert.equal(result.counts.costCommitments, 1);
  assert.equal(result.counts.costAccruals, 1);
  assert.equal(result.counts.fixedAssets, 1);
  assert.equal(result.counts.depreciationRuns, 1);
  assert.equal(result.counts.payrollRuns, 1);
  assert.equal(result.counts.payrollPayments, 1);
  assert.equal(result.counts.openingBalanceBatches, 1);
  assert.equal(result.counts.branchRollouts, 1);
  assert.equal(result.counts.migrationBaselines, 1);
  assert.equal(result.counts.legacyArchive, 1);
  assert.equal(result.counts.idempotencyRequests, 1);
  assert.equal(result.counts.recipeVersions, 1);
});

test('normalized repository rejects an immutable legacy archive source conflict', async () => {
  const client = new ArchiveConflictClient();
  await assert.rejects(() => syncFinanceState(client, {
    legacyArchive: [{
      id: '30000000-0000-4000-8000-000000000001', sourceTable: 'orders', sourceId: '1', trustStatus: 'verified',
      reason: 'verified_tender', sourcePayload: { id: 1 }, branchId: 1, amountIrr: 100, occurredAt: '2026-08-01T00:00:00.000Z',
      classificationDetails: {}, decision: 'pending', decisionHistory: [], reviewedTenders: [], archivedBy: 'auditor',
      archivedAt: '2026-08-01T00:00:00.000Z',
    }],
  }), (error) => error.code === 'postgres_legacy_archive_immutable_conflict');
});

test('normalized repository rejects an immutable migration baseline conflict', async () => {
  const client = new BaselineConflictClient();
  await assert.rejects(() => syncFinanceState(client, {
    migrationBaselines: [{
      id: '40000000-0000-4000-8000-000000000001', branchId: 1, status: 'active', sourceCount: 1,
      sourceKeys: ['orders:1'], sourceFingerprints: { 'orders:1': 'a'.repeat(64) }, sourceSha256: 'a'.repeat(64),
      trustSummary: {}, scannedBy: 'new-auditor', scannedAt: '2026-08-02T00:00:00.000Z',
    }],
  }), (error) => error.code === 'postgres_migration_baseline_immutable_conflict');
});
