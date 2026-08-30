'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const auditEngine = require('../server/finance/audit-engine');
const reconciliationEngine = require('../server/finance/reconciliation-engine');
const finance = require('../server/finance-v2');
const { classifyLegacyFinance } = require('../server/finance/legacy-classifier');

function postedAccountingFixture() {
  const acc = {
    accounts: [
      { code: '1110', name: 'Cash', nameFa: 'وجه نقد', type: 'asset', isPostingAccount: true },
      { code: '4110', name: 'Sales', nameFa: 'فروش', type: 'revenue', isPostingAccount: true },
    ],
    journalEntries: [{
      id: 'je-final-day', number: 'JE-1', date: '2026-08-31T18:30:00.000Z', status: 'posted',
      totalAmount: 1000, lines: [
        { accountCode: '1110', debit: 1000, credit: 0 },
        { accountCode: '4110', debit: 0, credit: 1000 },
      ],
    }],
  };
  acc.journalEntries[0].previousHash = 'GENESIS-00000000000000000000000000000000';
  acc.journalEntries[0].hash = auditEngine.computeJournalHash(acc.journalEntries[0]);
  return acc;
}

test('unknown or empty accounting roles never inherit administrator permissions', () => {
  assert.equal(auditEngine.validateRBACPermission(undefined, 'POST_JOURNAL').allowed, false);
  assert.equal(auditEngine.validateRBACPermission('made-up-role', 'POST_JOURNAL').allowed, false);
  assert.equal(auditEngine.validateRBACPermission('admin', 'POST_JOURNAL').allowed, true);
});

test('official accounting exports include the full date supplied as a day boundary', () => {
  const acc = postedAccountingFixture();
  const journal = auditEngine.generateOfficialGeneralJournal(acc, { to: '2026-08-31' });
  assert.equal(journal.totalRows, 2);
  const trialBalance = auditEngine.generateOfficialTrialBalance(acc, '2026-08-31');
  assert.equal(trialBalance.totalDebitTurnover, 1000);
  assert.equal(trialBalance.totalCreditTurnover, 1000);
});

test('legacy settlement rejects negative or greater-than-gross fees before recording', () => {
  const acc = {};
  assert.throws(() => reconciliationEngine.recordSettlement(acc, { grossAmount: 1000, feeAmount: 1001 }), /کارمزد تسویه/);
  assert.throws(() => reconciliationEngine.recordSettlement(acc, { grossAmount: 1000, feeAmount: -1 }), /کارمزد تسویه/);
  assert.equal((acc.settlements || []).length, 0);
});

test('finance events reject unsafe amounts and versions before mutating state', () => {
  const db = {};
  const state = finance.ensureFinanceV2(db);
  assert.throws(() => finance.recordEvent(db, {
    source: 'test', sourceId: 'unsafe-amount', amountIrr: Number.MAX_SAFE_INTEGER + 1,
  }), (error) => error.code === 'finance_event_amount_invalid');
  assert.throws(() => finance.recordEvent(db, {
    source: 'test', sourceId: 'fractional-version', amountIrr: 1, sourceVersion: 1.5,
  }), (error) => error.code === 'finance_event_version_invalid');
  assert.equal(state.events.length, 0);
  assert.deepEqual(state.idempotency, {});
});

test('Finance V2 day-only ranges include events through 23:59:59.999', () => {
  const db = {
    orders: [],
    branches: [{ id: 1, name: 'اصلی' }],
    accounting: { fiscalPeriods: [], journalEntries: [] },
  };
  const state = finance.ensureFinanceV2(db);
  state.events.push(
    { id: 'event-final-day', branchId: 1, source: 'test', sourceId: 'final', status: 'blocked', occurredAt: '2026-08-31T23:59:59.000Z', amountIrr: 1 },
    { id: 'event-next-day', branchId: 1, source: 'test', sourceId: 'next', status: 'blocked', occurredAt: '2026-09-01T00:00:00.000Z', amountIrr: 1 },
  );
  const report = finance.dailyOperations(db, { branchId: 1, from: '2026-08-31', to: '2026-08-31' });
  assert.deepEqual(report.events.map((row) => row.id), ['event-final-day']);
});

test('Finance V2 refuses to post a journal line outside the configured COA', () => {
  const db = {
    accounting: {
      accounts: [{ code: '1110' }, { code: '4110' }],
      fiscalPeriods: [{ id: 'period', startDate: '2026-08-01', endDate: '2026-08-31', status: 'open' }],
    },
  };
  assert.throws(() => finance.createDraft(db, {
    date: '2026-08-24T12:00:00.000Z', branchId: 1, costCenter: 'branch:1',
    lines: [
      { accountCode: '1110', debitIrr: 1000, creditIrr: 0, branchId: 1, costCenter: 'branch:1' },
      { accountCode: '9999', debitIrr: 0, creditIrr: 1000, branchId: 1, costCenter: 'branch:1' },
    ],
  }, 'accountant-1'), (error) => error.code === 'account_unknown');
});

test('legacy depreciation duplicate detection does not merge different unscoped batches', () => {
  const line = (debit, credit) => [
    { accountCode: '6980', debit, credit: 0, branchId: null },
    { accountCode: '1890', debit: 0, credit, branchId: null },
  ];
  const db = {
    orders: [],
    accounting: {
      journalEntries: [
        { id: 'depr-4-items', source: 'depreciation', status: 'posted', date: '2026-08-24T06:00:00.000Z', description: 'استهلاک ۴ قلم', totalAmount: 100, lines: line(100, 100) },
        { id: 'depr-5-items-a', source: 'depreciation', status: 'posted', date: '2026-08-24T07:00:00.000Z', description: 'استهلاک ۵ قلم', totalAmount: 200, lines: line(200, 200) },
        { id: 'depr-5-items-b', source: 'depreciation', status: 'posted', date: '2026-08-24T08:00:00.000Z', description: 'استهلاک ۵ قلم', totalAmount: 200, lines: line(200, 200) },
      ],
    },
  };
  const result = classifyLegacyFinance(db, { analyzeSale: () => ({ ok: true, tenders: [] }) });
  const duplicates = result.rows.filter((row) => row.reason === 'duplicate_depreciation_asset_period');
  assert.deepEqual(duplicates.map((row) => row.sourceId).sort(), ['depr-5-items-a', 'depr-5-items-b']);
});

test('data-quality gates do not import branch-specific duplicates or blocked events from another branch', () => {
  const db = {
    branches: [{ id: 1 }, { id: 2 }],
    orders: [],
    accounting: {
      fiscalPeriods: [{ id: 'period', startDate: '2026-08-01', endDate: '2026-08-31', status: 'open' }],
      journalEntries: [],
      settlements: [
        { id: 'settlement-2a', branchId: 2, provider: 'psp', batchNo: 'B-2' },
        { id: 'settlement-2b', branchId: 2, provider: 'psp', batchNo: 'B-2' },
      ],
      cashDrawers: [],
    },
  };
  const state = finance.ensureFinanceV2(db);
  state.events.push({ id: 'blocked-branch-2', branchId: 2, status: 'blocked', source: 'test', amountIrr: 1 });
  state.journalEntries.push({ id: 'journal-branch-2', branchId: 2, status: 'pending_approval' });
  state.approvals.push({ id: 'approval-branch-2', entityType: 'journal_entry', entityId: 'journal-branch-2', status: 'pending' });
  assert.equal(finance.dataQuality(db, 1).settlementDuplicates.length, 0);
  assert.equal(finance.dataQuality(db, 1).issues.some((issue) => issue.code === 'blocked_finance_events'), false);
  assert.equal(finance.dataQuality(db, 2).settlementDuplicates.length, 1);
  assert.equal(finance.dataQuality(db, 2).issues.some((issue) => issue.code === 'blocked_finance_events'), true);
  assert.equal(finance.shadowRunReadiness(db, 1, { storageStatus: { available: true, required: true } }).gates.find((gate) => gate.id === 'pending_approvals').value, 0);
  assert.equal(finance.shadowRunReadiness(db, 2, { storageStatus: { available: true, required: true } }).gates.find((gate) => gate.id === 'pending_approvals').value, 1);
  assert.equal(finance.ledgerClose(db, { branchId: 1, from: '2026-08-01', to: '2026-08-31' }).closeChecklist.find((item) => item.id === 'approvals-clear').passed, true);
  assert.equal(finance.ledgerClose(db, { branchId: 2, from: '2026-08-01', to: '2026-08-31' }).closeChecklist.find((item) => item.id === 'approvals-clear').passed, false);

  db.orders.push({ id: 'shared-order-id', branchId: 1, status: 'paid', paymentStatus: 'paid', total: 10, partialPayments: [{ tender: 'cash', amount: 10 }] });
  state.events.push({ id: 'sale-branch-2', branchId: 2, source: 'order.paid', sourceId: 'shared-order-id', status: 'posted' });
  assert.equal(finance.dataQuality(db, 1).uncaptured.some((order) => order.id === 'shared-order-id'), true);

  state.events.push(
    { id: 'sale-branch-1', branchId: 1, source: 'order.paid', sourceId: 'complete-order', status: 'posted', journalEntryId: 'sale-entry', occurredAt: '2026-08-24T10:00:00.000Z', amountIrr: 100 },
    { id: 'cogs-branch-1', branchId: 1, source: 'order.cogs', sourceId: 'complete-order', status: 'posted', journalEntryId: 'cogs-entry' },
  );
  state.payments.push({ id: 'payment-branch-2', branchId: 2, orderId: 'complete-order', status: 'succeeded', amountIrr: 100 });
  assert.equal(finance.shadowRunReadiness(db, 1, { storageStatus: { available: true, required: true } }).completeOrders, 0);

  state.events.push(
    { id: 'orphan-sale', branchId: 1, source: 'order.paid', sourceId: 'missing-order', status: 'posted', journalEntryId: 'orphan-sale-entry', amountIrr: 100 },
    { id: 'orphan-cogs', branchId: 1, source: 'order.cogs', sourceId: 'missing-order', status: 'posted', journalEntryId: 'orphan-cogs-entry', amountIrr: 20 },
  );
  const orphanQuality = finance.dataQuality(db, 1);
  assert.equal(orphanQuality.issues.some((issue) => issue.code === 'orphaned_finance_sale_events'), true);
  assert.equal(orphanQuality.issues.some((issue) => issue.code === 'orphaned_finance_cogs_events'), true);
  assert.equal(finance.shadowRunReadiness(db, 1, { storageStatus: { available: true, required: true } }).completeOrders, 0);
});

test('legacy duplicate keys keep terminals and branches distinct', () => {
  const db = {
    orders: [],
    accounting: {
      settlements: [
        { id: 'terminal-a', branchId: 1, provider: 'psp', terminalId: 'A', batchNo: 'B-1' },
        { id: 'terminal-b', branchId: 1, provider: 'psp', terminalId: 'B', batchNo: 'B-1' },
        { id: 'branch-a', branchId: 1, provider: 'psp', terminalId: 'SAME', batchNo: 'B-2' },
        { id: 'branch-b', branchId: 2, provider: 'psp', terminalId: 'SAME', batchNo: 'B-2' },
      ],
      expenses: [
        { id: 'expense-1', branchId: 1, date: '2026-08-24', amount: 100, title: 'آب' },
        { id: 'expense-2', branchId: 2, date: '2026-08-24', amount: 100, title: 'آب' },
      ],
      journalEntries: [],
    },
  };
  const result = classifyLegacyFinance(db, { analyzeSale: () => ({ ok: true, tenders: [] }) });
  assert.equal(result.rows.some((row) => row.reason === 'duplicate_settlement_batch'), false);
  assert.equal(result.rows.some((row) => row.reason === 'possible_duplicate_expense'), false);
});

test('finance event, journal, costing, refund and settlement identities cannot cross branches', () => {
  const db = {
    branches: [{ id: 1 }, { id: 2 }],
    orders: [],
    accounting: { fiscalPeriods: [{ id: 'period', startDate: '2026-08-01', endDate: '2026-08-31', status: 'open' }], journalEntries: [] },
  };
  const state = finance.ensureFinanceV2(db);
  state.events.push({ id: 'branch-2-event', source: 'same-source', sourceId: 'same-id', sourceVersion: 1, idempotencyKey: 'branch-2-key', branchId: 2, status: 'pending' });
  assert.throws(() => finance.recordEvent(db, { source: 'same-source', sourceId: 'same-id', branchId: 1, idempotencyKey: 'branch-1-key' }), (error) => error.code === 'finance_event_source_branch_conflict');
  state.journalEntries.push({ id: 'branch-2-entry', source: 'posted-source', sourceId: 'posted-id', branchId: 2, status: 'posted', lines: [] });
  const branchOneEvent = { id: 'branch-1-event', source: 'posted-source', sourceId: 'posted-id', branchId: 1, status: 'pending', occurredAt: '2026-08-24T10:00:00.000Z' };
  assert.throws(() => finance.__test.postEventJournal(db, branchOneEvent, [
    { accountCode: '1110', debitIrr: 10, creditIrr: 0, branchId: 1, costCenter: 'branch:1' },
    { accountCode: '4110', debitIrr: 0, creditIrr: 10, branchId: 1, costCenter: 'branch:1' },
  ], 'فروش', 'accountant-1'), (error) => error.code === 'finance_journal_source_branch_conflict');

  const order = { id: 'shared-order', branchId: 1, status: 'paid', paymentStatus: 'paid', total: 10, items: [] };
  db.orders.push(order);
  state.events.push({ id: 'branch-2-cogs', source: 'order.cogs', sourceId: order.id, branchId: 2, status: 'posted', journalEntryId: 'cogs-2' });
  assert.throws(() => finance.captureOrderCogs(db, order), (error) => error.code === 'order_cogs_source_branch_conflict');

  state.payments.push({ id: 'cross-payment', orderId: order.id, branchId: 2, status: 'succeeded', amountIrr: 100 });
  assert.throws(() => finance.requestOrderRefund(db, order.id, { paymentId: 'cross-payment', amountIrr: 10, reason: 'آزمون شعبه', refundDate: '2026-08-24T12:00:00.000Z' }, 'accountant-1', 'refund-cross-branch'), (error) => error.code === 'refund_payment_branch_mismatch');

  state.reconciliationItems.push({ id: 'settlement-branch-2', kind: 'settlement', branchId: 2, psp: 'psp', terminalId: 'terminal', batchNo: 'batch', status: 'matched' });
  state.payments.push({ id: 'branch-1-payment', orderId: 'settlement-order', branchId: 1, tender: 'card', status: 'succeeded', amountIrr: 100 });
  state.reconciliationItems.push({ id: 'payment-branch-1', kind: 'payment', branchId: 1, paymentId: 'branch-1-payment', status: 'unmatched' });
  const settlement = finance.recordSettlementV2(db, {
    branchId: 1, paymentIds: ['branch-1-payment'], psp: 'psp', terminalId: 'terminal', batchNo: 'batch', feeIrr: 0, bankAmountIrr: 100, settledAt: '2026-08-24T15:00:00.000Z',
  }, 'accountant-1');
  assert.equal(settlement.settlement.branchId, 1);
});

test('shadow cutover readiness fails when data-quality exceptions remain', () => {
  const db = {
    branches: [{ id: 1 }],
    orders: [],
    accounting: {
      fiscalPeriods: [{ id: 'period', startDate: '2026-08-01', endDate: '2026-08-31', status: 'open' }],
      journalEntries: [],
      settlements: [
        { id: 'duplicate-a', branchId: 1, provider: 'psp', terminalId: 'T-1', batchNo: 'B-1' },
        { id: 'duplicate-b', branchId: 1, provider: 'psp', terminalId: 'T-1', batchNo: 'B-1' },
      ],
      cashDrawers: [],
    },
  };
  const readiness = finance.shadowRunReadiness(db, 1, { storageStatus: { available: true, required: true } });
  const gate = readiness.gates.find((item) => item.id === 'data_quality');
  assert.equal(gate.passed, false);
  assert.deepEqual(gate.value.map((item) => item.code), ['duplicate_settlement_batch']);
  assert.equal(readiness.status, 'NO_GO');
});

test('ledger close blocks duplicate expense candidates instead of closing a contaminated period', () => {
  const db = {
    branches: [{ id: 1 }],
    orders: [],
    accounting: {
      fiscalPeriods: [{ id: 'period', startDate: '2026-08-01', endDate: '2026-08-31', status: 'open' }],
      expenses: [
        { id: 'expense-a', branchId: 1, date: '2026-08-24', amount: 100, title: 'اجاره' },
        { id: 'expense-b', branchId: 1, date: '2026-08-24', amount: 100, title: 'اجاره' },
      ],
      journalEntries: [],
    },
  };
  const checklist = finance.ledgerClose(db, { branchId: 1, from: '2026-08-01', to: '2026-08-31' }).closeChecklist;
  assert.equal(checklist.find((item) => item.id === 'duplicates-clear').passed, false);
});

test('migration readiness and event resolution never borrow same-id records from another branch', () => {
  const db = {
    branches: [{ id: 1 }, { id: 2 }],
    orders: [
      { id: 'shared-source', branchId: 1, status: 'paid', paymentStatus: 'paid', total: 10, partialPayments: [{ tender: 'cash', amount: 10 }], createdAt: '2026-08-02T10:00:00.000Z' },
      { id: 'new-shared-source', branchId: 1, status: 'paid', paymentStatus: 'paid', total: 10, partialPayments: [{ tender: 'cash', amount: 10 }], createdAt: '2026-08-02T10:00:00.000Z' },
      { id: 'event-source', branchId: 2, status: 'paid', paymentStatus: 'paid', total: 10, partialPayments: [{ tender: 'cash', amount: 10 }], createdAt: '2026-08-02T10:00:00.000Z' },
    ],
    accounting: {
      fiscalPeriods: [{ id: 'period', startDate: '2026-08-01', endDate: '2026-08-31', status: 'open' }],
      journalEntries: [],
    },
  };
  const state = finance.ensureFinanceV2(db);
  state.migrationBaselines.push({
    id: 'baseline-1', branchId: 1, status: 'active', scannedAt: '2026-08-01T00:00:00.000Z',
    sourceKeys: ['orders:shared-source'], sourceFingerprints: {}, sourceSha256: 'baseline',
  });
  state.legacyArchive.push({ id: 'archive-branch-2', sourceTable: 'orders', sourceId: 'shared-source', branchId: 2, trustStatus: 'verified', decision: 'keep_quarantined' });
  state.events.push(
    { id: 'event-branch-2', source: 'order.paid', sourceId: 'shared-source', branchId: 2, status: 'posted', createdAt: '2026-08-02T12:00:00.000Z' },
    { id: 'new-event-branch-2', source: 'order.paid', sourceId: 'new-shared-source', branchId: 2, status: 'posted', createdAt: '2026-08-02T12:00:00.000Z' },
  );

  const readiness = finance.legacyMigrationReadiness(db, 1);
  assert.equal(readiness.missingArchiveRecords, 1);
  assert.equal(readiness.newUnscopedRecords, 1);

  const event = finance.recordEvent(db, {
    source: 'order.paid', sourceId: 'event-source', sourceVersion: 2,
    idempotencyKey: 'order:shared-source:branch-1', branchId: 1, occurredAt: '2026-08-02T12:00:00.000Z', amountIrr: 100,
    payload: { tenderSnapshot: [{ tender: 'cash', amountIrr: 100 }] }, status: 'blocked',
  }).event;
  assert.throws(() => finance.resolveEvent(db, event.id, {}, 'accountant-1'), (error) => error.code === 'order_not_found');
});

test('reviewing a missing tender posts matching V2 payments and clears the tender-quality exception', () => {
  const db = {
    branches: [{ id: 1 }],
    orders: [],
    accounting: {
      fiscalPeriods: [{ id: 'period', startDate: '2026-08-01', endDate: '2026-08-31', status: 'open' }],
      journalEntries: [],
    },
  };
  const order = { id: 'review-order', branchId: 1, status: 'paid', paymentStatus: 'paid', total: 150000, paymentMethod: 'cashier', createdAt: '2026-08-24T10:00:00.000Z', paidAt: '2026-08-24T10:03:00.000Z' };
  db.orders.push(order);
  const captured = finance.capturePaidOrder(db, order, { actor: 'system' });
  assert.equal(captured.event.status, 'blocked');
  assert.equal(finance.dataQuality(db, 1).issues.some((issue) => issue.code === 'payment_tender_missing'), true);
  const resolved = finance.resolveEvent(db, captured.event.id, {
    tenders: [{ tender: 'cash', amountIrr: 1500000 }], evidenceReference: 'POS-REVIEW-1',
  }, 'accountant-1');
  assert.equal(resolved.event.status, 'posted');
  assert.equal(resolved.payments.length, 1);
  assert.equal(resolved.payments[0].amountIrr, 1500000);
  assert.equal(finance.dataQuality(db, 1).issues.some((issue) => issue.code === 'payment_tender_missing'), false);
});

test('posted sale replay repairs missing payments only from an exact tender snapshot and stays idempotent', () => {
  const db = {
    branches: [{ id: 1 }],
    orders: [{ id: 'posted-sale', branchId: 1, status: 'paid', paymentStatus: 'paid', total: 150000, createdAt: '2026-08-24T10:00:00.000Z' }],
    accounting: {
      fiscalPeriods: [{ id: 'period', startDate: '2026-08-01', endDate: '2026-08-31', status: 'open' }],
      journalEntries: [],
    },
  };
  const state = finance.ensureFinanceV2(db);
  state.events.push({
    id: 'already-posted-sale', branchId: 1, source: 'order.paid', sourceId: 'posted-sale',
    status: 'posted', journalEntryId: 'sale-entry', amountIrr: 1500000,
    occurredAt: '2026-08-24T10:03:00.000Z', payload: {
      tenderSnapshot: [{ tender: 'card', amountIrr: 1500000, paymentId: 'legacy-card-1', providerReference: 'POS-1' }],
    },
  });
  const first = finance.resolveEvent(db, 'already-posted-sale', {}, 'accountant-1');
  assert.equal(first.idempotentReplay, true);
  assert.equal(first.payments.length, 1);
  assert.equal(first.payments[0].amountIrr, 1500000);
  assert.equal(state.reconciliationItems.filter((row) => row.kind === 'payment').length, 1);
  assert.equal(finance.dataQuality(db, 1).postedSalePaymentGaps.length, 0);

  const second = finance.resolveEvent(db, 'already-posted-sale', {}, 'accountant-1');
  assert.equal(second.payments.length, 1);
  assert.equal(state.payments.length, 1);
  assert.equal(state.reconciliationItems.filter((row) => row.kind === 'payment').length, 1);
});

test('posted sale without a reliable tender snapshot remains a visible blocking exception', () => {
  const db = {
    branches: [{ id: 1 }],
    orders: [{ id: 'opaque-sale', branchId: 1, status: 'paid', paymentStatus: 'paid', total: 100000, createdAt: '2026-08-24T10:00:00.000Z' }],
    accounting: {
      fiscalPeriods: [{ id: 'period', startDate: '2026-08-01', endDate: '2026-08-31', status: 'open' }],
      journalEntries: [],
    },
  };
  const state = finance.ensureFinanceV2(db);
  state.events.push({
    id: 'opaque-posted-sale', branchId: 1, source: 'order.paid', sourceId: 'opaque-sale',
    status: 'posted', journalEntryId: 'sale-entry', amountIrr: 1000000,
    occurredAt: '2026-08-24T10:03:00.000Z', payload: { tenderSnapshot: [] },
  });
  state.events.push({
    id: 'unsafe-posted-sale', branchId: 1, source: 'order.paid', sourceId: 'opaque-sale',
    status: 'posted', journalEntryId: 'sale-entry-unsafe', amountIrr: 1000000,
    occurredAt: '2026-08-24T10:04:00.000Z', payload: {
      tenderSnapshot: [{ tender: 'card', amountIrr: Number.MAX_SAFE_INTEGER + 1 }],
    },
  });
  const quality = finance.dataQuality(db, 1);
  assert.equal(quality.issues.some((issue) => issue.code === 'posted_sale_tender_evidence_missing'), true);
  assert.equal(quality.issues.some((issue) => issue.code === 'posted_sale_payment_records_missing'), true);
  assert.doesNotThrow(() => finance.dataQuality(db, 1));
  const replay = finance.resolveEvent(db, 'opaque-posted-sale', {}, 'accountant-1');
  assert.equal(replay.payments.length, 0);
  assert.equal(state.payments.length, 0);
});

test('reconciliation and POS settlement engines post only valid accounts present in DEFAULT_COA', () => {
  const accountingEngine = require('../server/accounting-engine');
  const db = { accounting: {} };
  const acc = accountingEngine.ensureAccountingData(db);
  const coaCodes = new Set(acc.accounts.map((a) => a.code));

  // 1. Utilities expense resolves to 6300
  let postedLines = null;
  reconciliationEngine.createExpenseEntry(acc, {
    category: 'قبوض آب و برق',
    amount: 500000,
    paymentMethod: 'bank',
  }, {
    postJournalFn: (je) => { postedLines = je.lines; return { id: 'je-util', number: 'JE-UTIL' }; },
  });
  assert.ok(postedLines);
  assert.equal(postedLines[0].accountCode, '6300');
  assert.ok(coaCodes.has(postedLines[0].accountCode));

  // 2. Settlement fee resolves to 6710
  postedLines = null;
  reconciliationEngine.recordSettlement(acc, {
    grossAmount: 1000000,
    feeAmount: 5000,
    provider: 'کارتخوان شاپرک',
  }, {
    postJournalFn: (je) => { postedLines = je.lines; return { id: 'je-stl', number: 'JE-STL' }; },
  });
  assert.ok(postedLines);
  assert.equal(postedLines[1].accountCode, '6710');
  assert.ok(coaCodes.has(postedLines[1].accountCode));

  // 3. Cash drawer shortage resolves to 5500
  acc.cashDrawers.push({
    id: 'test-drawer-1',
    drawerName: 'صندوق تست',
    cashierName: 'صندوق‌دار',
    openingFloat: 100000,
    cashSales: 500000,
    cashRefunds: 0,
    status: 'open',
  });
  postedLines = null;
  reconciliationEngine.closeCashDrawer(acc, 'test-drawer-1', { closingCash: 580000 }, {
    postJournalFn: (je) => { postedLines = je.lines; return { id: 'je-short', number: 'JE-SHORT' }; },
  });
  assert.ok(postedLines);
  assert.equal(postedLines[0].accountCode, '5500');
  assert.ok(coaCodes.has(postedLines[0].accountCode));

  // 4. Verify 1630 exists for WIP
  assert.ok(coaCodes.has('1630'));
});

