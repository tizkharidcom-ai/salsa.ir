'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const finance = require('../server/finance-v2');
const accountingEngine = require('../server/accounting-engine');
const inventoryEngine = require('../server/finance/inventory-engine');
const predictiveEngine = require('../server/finance/predictive-engine');
const { capabilitiesFor, normalizeRole, roleLabel } = require('../server/command-center');

function fixture() {
  return {
    orders: [], cashSessions: [], branches: [{ id: 1, name: 'اصلی' }],
    accounting: {
      fiscalPeriods: [{ id: 'p-current', name: 'دوره آزمون', startDate: '2026-08-01', endDate: '2026-08-31', status: 'open' }],
      journalEntries: [], settlements: [], vendors: [], vendorBills: [], expenses: [], purchaseOrders: [], goodsReceipts: [],
      inventoryItems: [], inventoryTransactions: [], recipes: [], wasteLog: [], cashDrawers: [],
    },
  };
}

function paidOrder(overrides = {}) {
  return {
    id: 10, orderNo: 'W-10', branchId: 1, status: 'paid', paymentStatus: 'paid', fulfillment: 'dine_in',
    total: 150000, createdAt: '2026-08-24T10:00:00.000Z', paidAt: '2026-08-24T10:03:00.000Z',
    partialPayments: [
      { id: 1, tender: 'cash', amount: 50000, at: '2026-08-24T10:02:00.000Z' },
      { id: 2, tender: 'card', amount: 100000, at: '2026-08-24T10:03:00.000Z' },
    ],
    ...overrides,
  };
}

function financeRouteHarness(db, save, role = 'owner') {
  const routes = new Map();
  const app = {
    get(route, ...handlers) {
      const handler = handlers.at(-1);
      routes.set(`GET ${route}`, (req, ...args) => { req.route = { path: route }; return handler(req, ...args); });
    },
    post(route, ...handlers) {
      const handler = handlers.at(-1);
      routes.set(`POST ${route}`, (req, ...args) => { req.route = { path: route }; return handler(req, ...args); });
    },
  };
  finance.registerFinanceV2Routes({
    app, getDb: () => db, save,
    requireCapability: () => (_req, _res, next) => next(),
    effectiveRole: () => role,
  });
  return routes;
}

function financeRequest({ key = 'route-test-key', body = {}, params = {}, query = {}, method = 'POST', user = { phone: 'owner-1' } } = {}) {
  return { method, body, params, query, user, get: (name) => name === 'Idempotency-Key' ? key : null };
}

function financeResponse() {
  return {
    statusCode: 200, headersSent: false, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.headersSent = true; return this; },
  };
}

function reconcileAllCardPayments(db, batchNo) {
  const cardPayments = finance.ensureFinanceV2(db).payments
    .filter((payment) => Number(payment.branchId) === 1 && payment.tender === 'card');
  if (!cardPayments.length) return null;
  return finance.recordSettlementV2(db, {
    branchId: 1,
    paymentIds: cardPayments.map((payment) => payment.id),
    psp: 'shadow-psp',
    terminalId: 'shadow-terminal',
    batchNo,
    feeIrr: 0,
    bankAmountIrr: cardPayments.reduce((sum, payment) => sum + payment.amountIrr, 0),
    bankReference: `SHADOW-BANK-${batchNo}`,
    settledAt: '2026-08-24T15:00:00.000Z',
  }, 'accountant-1');
}

test('data quality does not call an empty legacy cash model parallel', () => {
  const db = fixture();
  db.cashSessions.push({ id: 'session-1', branchId: 1, openedAt: '2026-08-24T10:00:00.000Z' });
  assert.equal(finance.dataQuality(db, 1).issues.some((issue) => issue.code === 'parallel_cash_models'), false);

  db.accounting.cashDrawers.push({ id: 'legacy-drawer-1', branchId: 1, openedAt: '2026-08-24T10:00:00.000Z' });
  assert.equal(finance.dataQuality(db, 1).issues.some((issue) => issue.code === 'parallel_cash_models'), true);
});

test('finance routes enforce explicit branch scope for queries, searches and entity mutations', async () => {
  const db = fixture();
  db.branches.push({ id: 2, name: 'دوم' });
  db.orders.push(
    paidOrder({ id: 11, orderNo: 'W-BRANCH-1', branchId: 1 }),
    paidOrder({ id: 22, orderNo: 'W-BRANCH-2', branchId: 2 }),
  );
  const state = finance.ensureFinanceV2(db);
  state.purchaseOrders.push({ id: 'po-branch-2', number: 'PO-B2', branchId: 2, status: 'draft', lines: [] });
  state.journalEntries.push(
    { id: 'entry-1', number: 'F2-1', branchId: 1, description: 'scope marker', debitIrr: 1, date: '2026-08-25T10:00:00.000Z' },
    { id: 'entry-2', number: 'F2-2', branchId: 2, description: 'scope marker', debitIrr: 1, date: '2026-08-25T10:00:00.000Z' },
  );
  state.approvals.push(
    { id: 'approval-1', entityType: 'journal_entry', entityId: 'entry-1', status: 'pending', createdAt: '2026-08-25T10:00:00.000Z' },
    { id: 'approval-2', entityType: 'journal_entry', entityId: 'entry-2', status: 'pending', createdAt: '2026-08-25T10:00:00.000Z' },
  );
  let saveCalls = 0;
  const routes = financeRouteHarness(db, async () => { saveCalls += 1; }, 'accountant');
  const scopedUser = { phone: 'accountant-1', role: 'accountant', allowedBranchIds: [1] };

  const searchResponse = financeResponse();
  await routes.get('GET /api/admin/v2/finance/search')(
    financeRequest({ method: 'GET', key: '', query: { q: 'W-BRANCH' }, user: scopedUser }), searchResponse,
  );
  assert.equal(searchResponse.statusCode, 200);
  assert.equal(searchResponse.body.meta.branchId, 1);
  assert.deepEqual(searchResponse.body.data.map((row) => row.id), [11]);

  const approvalsResponse = financeResponse();
  await routes.get('GET /api/admin/v2/finance/approvals')(
    financeRequest({ method: 'GET', key: '', query: {}, user: scopedUser }), approvalsResponse,
  );
  assert.deepEqual(approvalsResponse.body.data.map((row) => row.id), ['approval-1']);

  const deniedQueryResponse = financeResponse();
  await routes.get('GET /api/admin/v2/finance/search')(
    financeRequest({ method: 'GET', key: '', query: { q: 'W-BRANCH', branchId: 2 }, user: scopedUser }), deniedQueryResponse,
  );
  assert.equal(deniedQueryResponse.statusCode, 403);
  assert.equal(deniedQueryResponse.body.error.code, 'finance_branch_access_denied');

  const deniedMutationResponse = financeResponse();
  await routes.get('POST /api/admin/v2/finance/purchase-orders/:id/submit')(
    financeRequest({ key: 'denied-po-submit', params: { id: 'po-branch-2' }, user: scopedUser }), deniedMutationResponse,
  );
  assert.equal(deniedMutationResponse.statusCode, 403);
  assert.equal(deniedMutationResponse.body.error.code, 'finance_branch_access_denied');
  assert.equal(state.purchaseOrders[0].status, 'draft');
  assert.equal(saveCalls, 0);
});

test('money contract stores integer IRR and split tender creates one debit per method', () => {
  const built = finance.salesLines(paidOrder());
  assert.equal(built.ok, true);
  assert.equal(built.totalIrr, 1500000);
  assert.deepEqual(built.lines.slice(0, 2).map((line) => [line.accountCode, line.debitIrr]), [['1110', 500000], ['1320', 1000000]]);
  assert.equal(built.lines.reduce((sum, line) => sum + line.debitIrr, 0), built.lines.reduce((sum, line) => sum + line.creditIrr, 0));
});

test('paid order capture posts once when an open fiscal period exists', () => {
  const db = fixture(); const order = paidOrder(); db.orders.push(order);
  const first = finance.capturePaidOrder(db, order, { actor: 'accountant-1' });
  const second = finance.capturePaidOrder(db, order, { actor: 'accountant-1' });
  assert.equal(first.event.status, 'posted');
  assert.ok(first.journalEntry);
  assert.equal(second.idempotentReplay, true);
  assert.equal(first.costing.event.status, 'blocked');
  assert.equal(first.costing.event.error.code, 'order_items_missing');
  assert.equal(db.financeV2.events.length, 2);
  assert.equal(db.financeV2.journalEntries.length, 1);
  assert.equal(db.financeV2.journalEntries[0].debitIrr, db.financeV2.journalEntries[0].creditIrr);
});

test('direct paid-order capture rolls back payments and events on a cross-branch conflict', () => {
  const db = fixture();
  const order = paidOrder({ id: 'atomic-paid-order' });
  db.orders.push(order);
  const state = finance.ensureFinanceV2(db);
  state.events.push({
    id: 'other-branch-paid-event', source: 'order.paid', sourceId: order.id, sourceVersion: 1,
    idempotencyKey: '2:order.paid:atomic-paid-order:v1', branchId: 2, status: 'posted', journalEntryId: null,
  });
  const before = structuredClone(state);

  assert.throws(() => finance.capturePaidOrder(db, order), (error) => error.code === 'finance_event_source_branch_conflict');
  assert.deepEqual(db.financeV2, before);
});

test('direct inventory operation rolls back physical rows and event when journal validation fails', () => {
  const db = fixture();
  db.accounting.accounts = [{ code: '1610', name: 'موجودی' }];
  db.accounting.inventoryItems = [{ id: 'milk', name: 'شیر', unit: 'لیتر', qtyOnHand: 10, avgCostIrr: 100000, branchId: 1 }];
  const state = finance.ensureFinanceV2(db);
  const before = structuredClone(state);

  assert.throws(() => finance.recordInventoryOperationV2(db, 'waste', {
    branchId: 1, itemId: 'milk', quantity: 2, unit: 'لیتر', reason: 'کنترل اتمیک', occurredAt: '2026-08-24T09:00:00.000Z',
  }, 'kitchen-1', 'atomic-waste-1'), (error) => error.code === 'account_unknown');
  assert.deepEqual(db.financeV2, before);
});

test('finance mutations wait for durable persistence, serialize retries and roll back memory on failure', async () => {
  const db = fixture();
  let releaseSave;
  const saveCalls = [];
  const routes = financeRouteHarness(db, (options) => {
    saveCalls.push(options);
    return new Promise((resolve) => { releaseSave = resolve; });
  });
  const handler = routes.get('POST /api/admin/v2/finance/fiscal-periods');
  const requestBody = { name: 'شهریور', startDate: '2026-09-01', endDate: '2026-09-30' };
  const firstResponse = financeResponse();
  const replayResponse = financeResponse();
  const first = handler(financeRequest({ body: requestBody }), firstResponse);
  const replay = handler(financeRequest({ body: requestBody }), replayResponse);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(firstResponse.headersSent, false);
  assert.equal(replayResponse.headersSent, false);
  assert.deepEqual(saveCalls, [{ requireDurable: true }]);
  releaseSave(true);
  await Promise.all([first, replay]);
  assert.equal(firstResponse.statusCode, 201);
  assert.equal(replayResponse.statusCode, 200);
  assert.equal(replayResponse.body.data.idempotentReplay, true);
  assert.equal(db.financeV2.fiscalPeriods.length, 1);
  const mismatchResponse = financeResponse();
  await handler(financeRequest({ body: { ...requestBody, name: 'دوره‌ای با بدنه متفاوت' } }), mismatchResponse);
  assert.equal(mismatchResponse.statusCode, 409);
  assert.equal(mismatchResponse.body.error.code, 'idempotency_key_payload_mismatch');
  assert.equal(db.financeV2.fiscalPeriods.length, 1);
  assert.deepEqual(saveCalls, [{ requireDurable: true }]);

  const failedDb = fixture();
  const failure = Object.assign(new Error('postgres unavailable'), { code: 'finance_persistence_failed', status: 503 });
  const failedRoutes = financeRouteHarness(failedDb, async () => { throw failure; });
  const failedResponse = financeResponse();
  await failedRoutes.get('POST /api/admin/v2/finance/fiscal-periods')(
    financeRequest({ key: 'failed-period', body: requestBody }), failedResponse,
  );
  assert.equal(failedResponse.statusCode, 503);
  assert.equal(failedResponse.body.error.code, 'finance_persistence_failed');
  assert.equal(failedDb.financeV2, undefined);
});

test('missing fiscal period blocks posting without inventing a journal', () => {
  const db = fixture(); db.accounting.fiscalPeriods = []; const order = paidOrder(); db.orders.push(order);
  const result = finance.capturePaidOrder(db, order);
  assert.equal(result.event.status, 'blocked');
  assert.equal(result.event.error.code, 'fiscal_period_missing');
  assert.equal(db.financeV2.journalEntries.length, 0);
});

test('opening balance preview is non-mutating and requires a balanced, approved, reversible balance-sheet batch', () => {
  const db = fixture();
  accountingEngine.ensureAccountingData(db);
  finance.ensureFinanceV2(db).fiscalPeriods.push({
    id: 'period-opening', name: 'دوره افتتاحیه', startDate: '2026-08-01', endDate: '2026-08-31', status: 'open',
  });
  const input = {
    branchId: 1, asOfDate: '2026-08-01', sourceReference: 'TB-OPEN-1405',
    lines: [
      { accountCode: '1210', debitIrr: 25000000, creditIrr: 0, memo: 'مانده بانک' },
      { accountCode: '1610', debitIrr: 5000000, creditIrr: 0, memo: 'موجودی اول دوره' },
      { accountCode: '2110', debitIrr: 0, creditIrr: 4000000, memo: 'بدهی تأمین‌کننده' },
      { accountCode: '3100', debitIrr: 0, creditIrr: 26000000, memo: 'سرمایه افتتاحیه' },
    ],
  };
  const before = structuredClone(db.financeV2);
  const preview = finance.openingBalancePreview(db, input);
  assert.equal(preview.ready, true);
  assert.deepEqual(preview.totals, { debitIrr: 30000000, creditIrr: 30000000 });
  assert.equal(preview.policy.automaticBalancingAccount, false);
  assert.deepEqual(db.financeV2, before);
  assert.throws(() => finance.openingBalancePreview(db, { ...input, lines: [
    { accountCode: '1210', debitIrr: 1000, creditIrr: 0 },
    { accountCode: '3900', debitIrr: 0, creditIrr: 1000 },
  ] }), (error) => error.code === 'opening_balance_account_invalid');
  assert.throws(() => finance.openingBalancePreview(db, { ...input, lines: [
    { accountCode: '1210', debitIrr: 1000.5, creditIrr: 0 },
    { accountCode: '3100', debitIrr: 0, creditIrr: 1000.5 },
  ] }), (error) => error.code === 'opening_balance_amount_invalid');
  assert.throws(() => finance.openingBalancePreview(db, { ...input, lines: [
    { accountCode: '1210', debitIrr: 1000, creditIrr: 0 },
    { accountCode: '3100', debitIrr: 0, creditIrr: 900 },
  ] }), (error) => error.code === 'journal_unbalanced');

  const requested = finance.requestOpeningBalance(db, input, 'accountant-1');
  assert.equal(requested.batch.status, 'pending_approval');
  assert.equal(requested.journalEntry.source, 'opening_balance');
  assert.equal(requested.approval.operation, 'post_opening_balance');
  assert.throws(() => finance.requestOpeningBalance(db, input, 'accountant-2'), (error) => error.code === 'opening_balance_active_batch_exists');
  assert.throws(() => finance.decideApproval(db, requested.approval.id, 'approved', 'accountant-1'), (error) => error.code === 'segregation_of_duties');
  const posted = finance.decideApproval(db, requested.approval.id, 'approved', 'owner-1');
  assert.equal(posted.openingBalanceBatch.status, 'posted');
  assert.equal(requested.journalEntry.status, 'posted');
  assert.equal(requested.journalEntry.periodId, 'period-opening');
  const reversal = finance.reverseEntry(db, requested.journalEntry.id, 'owner-1', 'اصلاح مانده افتتاحیه', '2026-08-02T12:00:00.000Z');
  assert.equal(requested.batch.status, 'reversed');
  assert.equal(requested.batch.reversalJournalEntryId, reversal.id);
  const replacement = finance.requestOpeningBalance(db, { ...input, sourceReference: 'TB-OPEN-1405-R2' }, 'accountant-2');
  assert.equal(replacement.batch.status, 'pending_approval');
});

test('opening balance API preview does not persist and creation is durable and idempotent', async () => {
  const db = fixture();
  accountingEngine.ensureAccountingData(db);
  finance.ensureFinanceV2(db).fiscalPeriods.push({ id: 'period-opening-api', name: 'افتتاحیه API', startDate: '2026-08-01', endDate: '2026-08-31', status: 'open' });
  let saves = 0;
  const routes = financeRouteHarness(db, async (options) => { assert.deepEqual(options, { requireDurable: true }); saves += 1; });
  const body = {
    branchId: 1, asOfDate: '2026-08-01', sourceReference: 'OPEN-API-1',
    lines: [
      { accountCode: '1210', debitIrr: 1000, creditIrr: 0 },
      { accountCode: '3100', debitIrr: 0, creditIrr: 1000 },
    ],
  };
  const previewResponse = financeResponse();
  await routes.get('POST /api/admin/v2/finance/opening-balances/preview')(financeRequest({ body }), previewResponse);
  assert.equal(previewResponse.statusCode, 200);
  assert.equal(previewResponse.body.data.ready, true);
  assert.equal(saves, 0);
  const createHandler = routes.get('POST /api/admin/v2/finance/opening-balances');
  const firstResponse = financeResponse();
  await createHandler(financeRequest({ key: 'opening-api-key', body }), firstResponse);
  assert.equal(firstResponse.statusCode, 201);
  assert.equal(firstResponse.body.data.batch.status, 'pending_approval');
  assert.equal(saves, 1);
  const replayResponse = financeResponse();
  await createHandler(financeRequest({ key: 'opening-api-key', body }), replayResponse);
  assert.equal(replayResponse.statusCode, 200);
  assert.equal(replayResponse.body.data.idempotentReplay, true);
  assert.equal(db.financeV2.openingBalanceBatches.length, 1);
  assert.equal(saves, 1);
});

test('ambiguous legacy cashier tender is blocked explicitly', () => {
  const db = fixture(); const order = paidOrder({ partialPayments: [], paymentMethod: 'cashier' }); db.orders.push(order);
  const result = finance.capturePaidOrder(db, order);
  assert.equal(result.event.status, 'blocked');
  assert.equal(result.event.error.code, 'payment_tender_missing');
  assert.throws(() => finance.resolveEvent(db, result.event.id, {
    tenders: [{ tender: 'card', amountIrr: 1500000 }],
  }, 'accountant-1'), (error) => error.code === 'tender_evidence_reference_required');
  const resolved = finance.resolveEvent(db, result.event.id, {
    tenders: [{ tender: 'card', amountIrr: 1500000 }], evidenceReference: 'POS-1405-000123',
  }, 'accountant-1');
  assert.equal(resolved.event.status, 'posted');
  assert.equal(resolved.event.payload.reviewEvidenceReference, 'POS-1405-000123');
  assert.deepEqual(resolved.event.payload.reviewedTenderSnapshot, [{ tender: 'card', amountIrr: 1500000 }]);
  assert.equal(resolved.entry.lines[0].paymentMethod, 'card');
});

test('an order blocked only by fiscal period retains its source split tender without manual evidence', () => {
  const db = fixture(); db.accounting.fiscalPeriods = []; const order = paidOrder(); db.orders.push(order);
  const captured = finance.capturePaidOrder(db, order);
  assert.equal(captured.event.error.code, 'fiscal_period_missing');
  db.financeV2.fiscalPeriods.push({ id: 'period-v2', name: 'دوره V2', startDate: '2026-08-01', endDate: '2026-08-31', status: 'open' });
  const resolved = finance.resolveEvent(db, captured.event.id, {}, 'accountant-1');
  assert.equal(resolved.event.status, 'posted');
  assert.deepEqual(resolved.entry.lines.slice(0, 2).map((line) => [line.paymentMethod, line.debitIrr]), [['cash', 500000], ['card', 1000000]]);
  assert.equal(resolved.event.payload.reviewEvidenceReference, undefined);
});

test('legacy migration classifies into a read-only archive and records controlled decisions without posting', () => {
  const db = fixture();
  db.orders.push(paidOrder({ id: 11, orderNo: 'W-11' }));
  db.orders.push(paidOrder({ id: 12, orderNo: 'W-12', partialPayments: [], paymentMethod: 'cashier' }));
  db.accounting.settlements = [
    { id: 's-1', provider: 'psp', terminalId: 't-1', batchNo: 'b-1', amount: 100, createdAt: '2026-08-24T12:00:00.000Z' },
    { id: 's-2', provider: 'psp', terminalId: 't-1', batchNo: 'b-1', amount: 100, createdAt: '2026-08-24T12:01:00.000Z' },
  ];
  db.accounting.journalEntries = [{ id: 'test-1', number: 'TEST-1', description: 'سند آزمایشی', date: '2026-08-24' }];
  const sourceBefore = structuredClone({ orders: db.orders, accounting: db.accounting });
  const first = finance.classifyAndArchiveLegacy(db, 'accountant-1');
  const second = finance.classifyAndArchiveLegacy(db, 'accountant-1');
  assert.equal(first.classification.verified, 1);
  assert.equal(first.classification.inferred_needs_approval, 1);
  assert.equal(first.classification.quarantined, 3);
  assert.equal(first.created, 5);
  assert.equal(second.created, 0);
  assert.equal(second.unchanged, 5);
  assert.equal(first.baselineCreated, true);
  assert.equal(first.baseline.sourceCount, 5);
  assert.equal(second.baselineCreated, false);
  assert.equal(finance.legacyMigrationReadiness(db, 1).unresolvedRecords, 2);
  assert.deepEqual({ orders: db.orders, accounting: db.accounting }, sourceBefore);
  assert.equal(db.financeV2.journalEntries.length, 0);

  const inferred = db.financeV2.legacyArchive.find((row) => row.sourceId === '12');
  assert.throws(() => finance.decideLegacyArchive(db, inferred.id, {
    decision: 'approved_for_backfill', decisionNotes: 'رسید بررسی شد', evidenceReference: 'POS-12',
  }, 'accountant-1', 'accountant'), (error) => error.code === 'legacy_backfill_approver_required');
  assert.throws(() => finance.decideLegacyArchive(db, inferred.id, {
    decision: 'approved_for_backfill', decisionNotes: 'رسید بررسی شد',
  }, 'owner-1', 'owner'), (error) => error.code === 'legacy_backfill_evidence_required');
  assert.throws(() => finance.decideLegacyArchive(db, inferred.id, {
    decision: 'approved_for_backfill', decisionNotes: 'رسید بررسی شد', evidenceReference: 'POS-12',
  }, 'owner-1', 'owner'), (error) => error.code === 'legacy_backfill_tenders_required');
  const decided = finance.decideLegacyArchive(db, inferred.id, {
    decision: 'approved_for_backfill', decisionNotes: 'رسید کارتخوان با مبلغ سفارش تطبیق شد', evidenceReference: 'POS-12',
    reviewedTenders: [{ tender: 'cash', amountIrr: 500000 }, { tender: 'card', amountIrr: 1000000 }],
  }, 'owner-1', 'owner');
  assert.equal(decided.record.decision, 'approved_for_backfill');
  assert.deepEqual(decided.record.reviewedTenders, [{ tender: 'cash', amountIrr: 500000 }, { tender: 'card', amountIrr: 1000000 }]);
  assert.equal(decided.policy.automaticBackfill, false);
  assert.equal(db.financeV2.journalEntries.length, 0);

  const quarantined = db.financeV2.legacyArchive.find((row) => row.trustStatus === 'quarantined');
  assert.throws(() => finance.decideLegacyArchive(db, quarantined.id, {
    decision: 'approved_for_backfill', decisionNotes: 'تلاش برای خروج', evidenceReference: 'X-1',
  }, 'owner-1', 'owner'), (error) => error.code === 'quarantined_backfill_forbidden');
});

test('approved legacy order backfill previews, requests independent approval and posts one source event with split payments', () => {
  const db = fixture();
  const order = paidOrder({ id: 21, orderNo: 'W-21', items: [] }); db.orders.push(order);
  finance.classifyAndArchiveLegacy(db, 'accountant-1');
  const archived = db.financeV2.legacyArchive.find((row) => row.sourceTable === 'orders' && row.sourceId === '21');
  finance.decideLegacyArchive(db, archived.id, {
    decision: 'approved_for_backfill', decisionNotes: 'رسیدهای نقد و کارت با سفارش تطبیق شدند', evidenceReference: 'Z-REPORT-21',
  }, 'owner-1', 'owner');
  const preview = finance.legacyOrderBackfillPreview(db, archived.id);
  assert.equal(preview.ready, true);
  assert.deepEqual(preview.tenders.map((row) => [row.tender, row.amountIrr]), [['cash', 500000], ['card', 1000000]]);
  assert.deepEqual(preview.totals, { debitIrr: 1500000, creditIrr: 1500000 });
  assert.equal(db.financeV2.journalEntries.length, 0);

  const requested = finance.requestLegacyOrderBackfill(db, archived.id, 'accountant-1');
  const replay = finance.requestLegacyOrderBackfill(db, archived.id, 'accountant-1');
  assert.equal(requested.entry.status, 'pending_approval');
  assert.equal(requested.approval.operation, 'post_legacy_order_backfill');
  assert.equal(replay.idempotentReplay, true);
  assert.equal(db.financeV2.events.length, 0);
  assert.throws(() => finance.decideApproval(db, requested.approval.id, 'approved', 'accountant-1'), (error) => error.code === 'segregation_of_duties');

  const posted = finance.decideApproval(db, requested.approval.id, 'approved', 'owner-2');
  assert.equal(posted.entry.status, 'posted');
  assert.equal(posted.entry.source, 'order.paid');
  assert.equal(posted.legacyBackfill.backfillStatus, 'posted');
  assert.equal(posted.legacyBackfillEvent.status, 'posted');
  assert.equal(posted.legacyBackfillEvent.journalEntryId, posted.entry.id);
  assert.deepEqual(posted.legacyBackfillPayments.map((row) => [row.tender, row.amountIrr]), [['cash', 500000], ['card', 1000000]]);
  assert.equal(posted.legacyBackfillCosting.event.status, 'blocked');
  assert.equal(posted.legacyBackfillCosting.event.error.code, 'order_items_missing');
  assert.equal(db.financeV2.events.filter((row) => row.source === 'order.paid' && row.sourceId === '21').length, 1);
  assert.equal(db.financeV2.journalEntries.filter((row) => row.source === 'order.paid' && row.sourceId === '21').length, 1);
  assert.equal(finance.dataQuality(db, 1).uncaptured.some((row) => String(row.id) === '21'), false);
  const captureReplay = finance.capturePaidOrder(db, order, { actor: 'system' });
  assert.equal(captureReplay.idempotentReplay, true);
  assert.equal(db.financeV2.journalEntries.filter((row) => row.source === 'order.paid').length, 1);
  const cardPayment = posted.legacyBackfillPayments.find((row) => row.tender === 'card');
  const cardReconciliation = db.financeV2.reconciliationItems.find((row) => row.paymentId === cardPayment.id);
  cardReconciliation.status = 'matched';
  assert.throws(() => finance.reverseEntry(db, posted.entry.id, 'owner-3', 'ابطال پس از تطبیق', '2026-08-24T14:00:00.000Z'), (error) => error.code === 'legacy_backfill_has_reconciliation_activity');
  cardReconciliation.status = 'unmatched';
  const reversal = finance.reverseEntry(db, posted.entry.id, 'owner-3', 'اصلاح مستند بازسازی', '2026-08-24T14:00:00.000Z');
  assert.equal(archived.backfillStatus, 'reversed');
  assert.equal(archived.backfillReversalJournalEntryId, reversal.id);
  assert.equal(posted.legacyBackfillPayments.every((row) => row.status === 'cancelled'), true);
  assert.equal(cardReconciliation.status, 'exception');
  assert.equal(finance.legacyOrderBackfillPreview(db, archived.id).blockers.some((row) => row.code === 'legacy_backfill_reversed'), true);
});

test('manual journal requires a different approver and posts immutably after approval', () => {
  const db = fixture();
  const entry = finance.createDraft(db, {
    date: '2026-08-24T12:00:00.000Z', branchId: 1, costCenter: 'branch:1', description: 'اصلاح کنترل‌شده',
    lines: [
      { accountCode: '1110', debitIrr: 1000, creditIrr: 0, branchId: 1, costCenter: 'branch:1' },
      { accountCode: '3100', debitIrr: 0, creditIrr: 1000, branchId: 1, costCenter: 'branch:1' },
    ],
  }, 'accountant-1');
  const { approval } = finance.submitDraft(db, entry.id, 'accountant-1');
  assert.throws(() => finance.decideApproval(db, approval.id, 'approved', 'accountant-1'), (error) => error.code === 'segregation_of_duties');
  const decided = finance.decideApproval(db, approval.id, 'approved', 'owner-1');
  assert.equal(decided.entry.status, 'posted');
  assert.equal(decided.entry.postedBy, 'owner-1');
});

test('reversal preserves the posted original and adds an equal opposite entry', () => {
  const db = fixture(); const order = paidOrder(); db.orders.push(order);
  const captured = finance.capturePaidOrder(db, order, { actor: 'system' });
  const reversal = finance.reverseEntry(db, captured.journalEntry.id, 'owner-1', 'ابطال کنترل‌شده', '2026-08-24T14:00:00.000Z');
  assert.equal(captured.journalEntry.status, 'posted');
  assert.equal(captured.journalEntry.reversedById, reversal.id);
  assert.equal(reversal.reversalOfId, captured.journalEntry.id);
  assert.deepEqual(reversal.lines.map((line) => [line.debitIrr, line.creditIrr]), captured.journalEntry.lines.map((line) => [line.creditIrr, line.debitIrr]));
  const snapshot = finance.reportSnapshot(db, { branchId: 1, from: '2026-08-01', to: '2026-08-31T23:59:59.999Z' });
  assert.equal(snapshot.ledger.salesIrr, 0);
  assert.equal(snapshot.ledger.netRevenueIrr, 0);
  assert.equal(snapshot.reconciliation.salesDifferenceIrr, 1500000);
});

test('formal reports are derived from posted V2 lines and preserve the accounting equation', () => {
  const db = fixture(); const order = paidOrder(); db.orders.push(order);
  finance.capturePaidOrder(db, order, { actor: 'system' });
  const reports = finance.financialReports(db, { branchId: 1, from: '2026-08-01', to: '2026-08-31T23:59:59.999Z' });
  assert.equal(reports.trialBalance.status, 'balanced');
  assert.equal(reports.trialBalance.debitIrr, 1500000);
  assert.equal(reports.trialBalance.creditIrr, 1500000);
  assert.equal(reports.profitAndLoss.revenueIrr, 1500000);
  assert.equal(reports.profitAndLoss.netProfitIrr, 1500000);
  assert.equal(reports.balanceSheet.assetsIrr, 1500000);
  assert.equal(reports.balanceSheet.equityIrr, 1500000);
  assert.equal(reports.balanceSheet.equationDifferenceIrr, 0);
  assert.equal(reports.cashFlow.status, 'rule_based');
  assert.equal(reports.cashFlow.operatingIrr, 500000);
  assert.equal(reports.cashFlow.netChangeIrr, 500000);
  assert.equal(reports.generalLedger.rows.length, 3);
});

test('manual journal rejects fractional or unsafe IRR before creating a draft', () => {
  const db = fixture();
  const make = (amount) => finance.createDraft(db, {
    date: '2026-08-24T12:00:00.000Z', branchId: 1, costCenter: 'branch:1', description: 'کنترل قرارداد پول',
    lines: [
      { accountCode: '5100', debitIrr: amount, creditIrr: 0, branchId: 1, costCenter: 'branch:1' },
      { accountCode: '1110', debitIrr: 0, creditIrr: amount, branchId: 1, costCenter: 'branch:1' },
    ],
  }, 'accountant-1');
  assert.throws(() => make(10.5), (error) => error.code === 'amount_irr_invalid');
  assert.throws(() => make(Number.MAX_SAFE_INTEGER + 1), (error) => error.code === 'amount_irr_invalid');
  assert.equal(db.financeV2.journalEntries.length, 0);
});

test('fiscal periods are contiguous and preliminary close/reopen preserves segregation of duties', () => {
  const db = fixture();
  const august = finance.createFiscalPeriod(db, { name: 'مرداد', startDate: '2026-08-01', endDate: '2026-08-31' }, 'manager-1');
  assert.throws(
    () => finance.createFiscalPeriod(db, { name: 'دوره با فاصله', startDate: '2026-09-02', endDate: '2026-09-30' }, 'manager-1'),
    (error) => error.code === 'fiscal_period_gap',
  );
  const september = finance.createFiscalPeriod(db, { name: 'شهریور', startDate: '2026-09-01', endDate: '2026-09-30' }, 'manager-1');
  assert.equal(september.status, 'open');
  const closed = finance.closeFiscalPeriod(db, august.id, 'accountant-1', { preliminary: true });
  assert.equal(closed.period.status, 'soft_closed');
  const { approval } = finance.requestPeriodReopen(db, august.id, 'manager-1', 'اصلاح سند جاافتاده');
  assert.throws(() => finance.decideApproval(db, approval.id, 'approved', 'manager-1'), (error) => error.code === 'segregation_of_duties');
  const reopened = finance.decideApproval(db, approval.id, 'approved', 'owner-1');
  assert.equal(reopened.period.status, 'reopened');
  assert.equal(reopened.period.reopenedBy, 'owner-1');
});

test('cash pay-out is captured immediately but posting waits for manager approval and accountant classification', () => {
  const db = fixture();
  const session = { id: 3, branchId: 1, openedAt: '2026-08-24T08:00:00.000Z' };
  const movement = { id: 7, type: 'pay_out', amount: -25000, note: 'خرید فوری', at: '2026-08-24T09:00:00.000Z' };
  const captured = finance.captureCashMovement(db, session, movement, { actor: 'cashier-1' });
  assert.equal(captured.event.status, 'blocked');
  const approval = db.financeV2.approvals[0];
  assert.throws(() => finance.resolveEvent(db, captured.event.id, { counterpartAccount: '6990' }, 'accountant-1'), (error) => error.code === 'finance_approval_required');
  finance.decideApproval(db, approval.id, 'approved', 'owner-1');
  const resolved = finance.resolveEvent(db, captured.event.id, { counterpartAccount: '6990' }, 'accountant-1');
  assert.equal(resolved.event.status, 'posted');
  assert.equal(resolved.entry.debitIrr, 250000);
});

test('cash close posts only the observed variance and remains balanced', () => {
  const db = fixture();
  const result = finance.captureCashClose(db, { id: 4, branchId: 1, countedAmount: 100500, variance: 500, closedAt: '2026-08-24T20:00:00.000Z' }, { actor: 'cashier-1' });
  assert.equal(result.event.status, 'posted');
  const entry = db.financeV2.journalEntries[0];
  assert.equal(entry.debitIrr, 5000);
  assert.equal(entry.creditIrr, 5000);
});

test('accountant role has granular finance access but cannot approve or reopen periods', () => {
  const user = { phone: '09120000000', role: 'accountant' };
  const capabilities = capabilitiesFor(user, { adminPhones: [] });
  assert.equal(normalizeRole('accountant'), 'accountant');
  assert.equal(roleLabel('accountant'), 'حسابدار');
  assert.ok(capabilities.includes('finance.view'));
  assert.ok(capabilities.includes('finance.journal.create'));
  assert.equal(capabilities.includes('finance.approve'), false);
  assert.equal(capabilities.includes('finance.period.reopen'), false);
  assert.equal(capabilities.includes('inventory.operations'), false);
  assert.ok(capabilitiesFor({ role: 'kitchen' }, {}).includes('inventory.operations'));
  assert.equal(capabilitiesFor({ role: 'cashier' }, {}).includes('inventory.operations'), false);
});

test('accountant workbench exposes real operational queues instead of report-only cards', () => {
  const db = fixture();
  const order = paidOrder();
  db.orders.push(order);
  const captured = finance.capturePaidOrder(db, order, { actor: 'system' });
  const draft = finance.createDraft(db, {
    date: '2026-08-24T12:00:00.000Z', branchId: 1, costCenter: 'branch:1', description: 'سند عملیاتی',
    lines: [
      { accountCode: '5100', debitIrr: 10000, creditIrr: 0, branchId: 1, costCenter: 'branch:1' },
      { accountCode: '1110', debitIrr: 0, creditIrr: 10000, branchId: 1, costCenter: 'branch:1' },
    ],
  }, 'accountant-1');
  finance.submitDraft(db, draft.id, 'accountant-1');
  captured.event.status = 'blocked';
  captured.event.error = { code: 'review_required', message: 'نیازمند بازبینی' };

  const data = finance.workbench(db, { branchId: 1, from: '2026-08-01', to: '2026-08-31T23:59:59.999Z' });
  assert.equal(data.operations.counters.blockedEvents, 2);
  assert.equal(data.operations.counters.pendingApprovals, 1);
  assert.equal(data.operations.journalDrafts[0].status, 'pending_approval');
  assert.equal(data.operations.events[0].error.code, 'review_required');
  assert.ok(data.operations.periodSource);
});

test('kitchen recipe versions require independent approval, retire the prior version and drive order COGS', () => {
  const db = fixture();
  db.menuItems = [{ id: 501, name: 'برگر مخصوص', active: true }];
  db.accounting.inventoryItems = [
    { id: 'beef', name: 'گوشت', unit: 'kg', qtyOnHand: 20, avgCostIrr: 100000, branchId: 1 },
    { id: 'bread', name: 'نان', unit: 'count', qtyOnHand: 100, avgCostIrr: 10000, branchId: 1 },
  ];
  const first = finance.requestRecipeVersion(db, {
    branchId: 1, menuItemId: 501, effectiveFrom: '2026-08-01', yieldQuantity: 1,
    ingredients: [
      { itemId: 'beef', quantity: 0.2, unit: 'kg', quantityBasis: 'raw', yieldPercent: 100 },
      { itemId: 'bread', quantity: 1, unit: 'count', quantityBasis: 'usable', yieldPercent: 100 },
    ],
  }, 'kitchen-1');
  assert.equal(first.recipeVersion.status, 'pending_approval');
  assert.throws(() => finance.decideApproval(db, first.approval.id, 'approved', 'kitchen-1'), (error) => error.code === 'segregation_of_duties');
  finance.decideApproval(db, first.approval.id, 'approved', 'owner-1');
  assert.equal(first.recipeVersion.status, 'approved');

  const order = paidOrder({ id: 5010, items: [{ menuItemId: 501, name: 'برگر مخصوص', qty: 2, lineTotal: 150000 }] });
  db.orders.push(order);
  const captured = finance.capturePaidOrder(db, order, { actor: 'system' });
  assert.equal(captured.costing.event.status, 'posted');
  assert.equal(captured.costing.snapshots[0].recipeVersionId, first.recipeVersion.id);
  assert.equal(captured.costing.snapshots[0].theoreticalCogsIrr, 60000);
  assert.deepEqual(captured.costing.movements.map((row) => [row.itemId, row.quantityBase]), [['beef', -0.4], ['bread', -2]]);

  const second = finance.requestRecipeVersion(db, {
    branchId: 1, menuItemId: 501, effectiveFrom: '2026-08-25', yieldQuantity: 1,
    ingredients: [
      { itemId: 'beef', quantity: 0.25, unit: 'kg', quantityBasis: 'raw', yieldPercent: 100 },
      { itemId: 'bread', quantity: 1, unit: 'count', quantityBasis: 'usable', yieldPercent: 100 },
    ],
  }, 'kitchen-1');
  finance.decideApproval(db, second.approval.id, 'approved', 'owner-1');
  assert.equal(first.recipeVersion.status, 'retired');
  assert.equal(first.recipeVersion.effectiveTo, second.recipeVersion.effectiveFrom);
  assert.equal(second.recipeVersion.status, 'approved');

  const rejected = finance.requestRecipeVersion(db, {
    branchId: 1, menuItemId: 501, effectiveFrom: '2026-08-26', yieldQuantity: 1,
    ingredients: [{ itemId: 'beef', quantity: 0.3, unit: 'kg', quantityBasis: 'raw', yieldPercent: 100 }],
  }, 'kitchen-2');
  finance.decideApproval(db, rejected.approval.id, 'rejected', 'owner-1', 'آزمایش پخت تکمیل نشده');
  assert.equal(rejected.recipeVersion.status, 'rejected');
  assert.equal(second.recipeVersion.status, 'approved');
});

test('recipe version input rejects duplicate ingredients, incompatible units and duplicate pending requests', () => {
  const db = fixture();
  db.menuItems = [{ id: 701, name: 'نوشیدنی تست', active: true }];
  db.accounting.inventoryItems = [{ id: 'milk', name: 'شیر', unit: 'l', qtyOnHand: 5, avgCostIrr: 100, branchId: 1 }];
  assert.throws(() => finance.requestRecipeVersion(db, {
    branchId: 1, menuItemId: 701, effectiveFrom: '2026-08-01', yieldQuantity: 1,
    ingredients: [{ itemId: 'milk', quantity: 1, unit: 'kg' }],
  }, 'kitchen-1'), (error) => error.code === 'unit_incompatible');
  assert.throws(() => finance.requestRecipeVersion(db, {
    branchId: 1, menuItemId: 701, effectiveFrom: '2026-08-01', yieldQuantity: 1,
    ingredients: [{ itemId: 'milk', quantity: 1, unit: 'l' }, { itemId: 'milk', quantity: 1, unit: 'l' }],
  }, 'kitchen-1'), (error) => error.code === 'recipe_ingredient_duplicate');
  finance.requestRecipeVersion(db, {
    branchId: 1, menuItemId: 701, effectiveFrom: '2026-08-01', yieldQuantity: 1,
    ingredients: [{ itemId: 'milk', quantity: 1, unit: 'l' }],
  }, 'kitchen-1');
  assert.throws(() => finance.requestRecipeVersion(db, {
    branchId: 1, menuItemId: 701, effectiveFrom: '2026-08-02', yieldQuantity: 1,
    ingredients: [{ itemId: 'milk', quantity: 1, unit: 'l' }],
  }, 'kitchen-1'), (error) => error.code === 'recipe_version_pending_exists');
});

test('kitchen recipe API is durable and idempotent and exposes only branch-scoped operational fields', async () => {
  const db = fixture();
  db.menuItems = [{ id: 801, name: 'سالاد فصل', active: true }];
  db.accounting.inventoryItems = [{ id: 'lettuce', name: 'کاهو', unit: 'kg', qtyOnHand: 5, avgCostIrr: 100, branchId: 1 }];
  let saveCalls = 0;
  const routes = financeRouteHarness(db, async () => { saveCalls += 1; }, 'kitchen');
  const body = {
    branchId: 1, menuItemId: 801, effectiveFrom: '2026-08-01', yieldQuantity: 1,
    ingredients: [{ itemId: 'lettuce', quantity: 0.1, unit: 'kg', quantityBasis: 'raw', yieldPercent: 100 }],
  };
  const firstResponse = financeResponse();
  await routes.get('POST /api/kitchen/inventory/recipe-versions')(
    financeRequest({ key: 'recipe-route-key', body, user: { phone: 'kitchen-1', role: 'kitchen', allowedBranchIds: [1] } }), firstResponse,
  );
  assert.equal(firstResponse.statusCode, 201);
  assert.equal(firstResponse.body.data.recipeVersion.status, 'pending_approval');
  assert.equal(saveCalls, 1);
  const replayResponse = financeResponse();
  await routes.get('POST /api/kitchen/inventory/recipe-versions')(
    financeRequest({ key: 'recipe-route-key', body, user: { phone: 'kitchen-1', role: 'kitchen', allowedBranchIds: [1] } }), replayResponse,
  );
  assert.equal(replayResponse.statusCode, 200);
  assert.equal(replayResponse.body.data.idempotentReplay, true);
  assert.equal(finance.ensureFinanceV2(db).recipeVersions.length, 1);
  assert.equal(saveCalls, 1);

  const inventoryResponse = financeResponse();
  await routes.get('GET /api/kitchen/inventory')(
    financeRequest({ method: 'GET', key: '', query: { branchId: 1 }, user: { phone: 'kitchen-1', role: 'kitchen', allowedBranchIds: [1] } }), inventoryResponse,
  );
  assert.deepEqual(inventoryResponse.body.data.menuItems.map((row) => row.id), ['801']);
  assert.equal(inventoryResponse.body.data.recipeVersions[0].ingredients[0].itemId, 'lettuce');
  assert.equal(JSON.stringify(inventoryResponse.body.data).includes('avgCostIrr'), false);
  assert.equal(JSON.stringify(inventoryResponse.body.data).includes('accountCode'), false);
});

test('paid sale snapshots effective recipe, consumes shadow inventory and posts COGS exactly once', () => {
  const db = fixture();
  db.accounting.inventoryItems = [
    { id: 'milk', name: 'شیر', unit: 'لیتر', qtyOnHand: 10, avgCostIrr: 100000, branchId: 1 },
    { id: 'banana', name: 'موز', unit: 'گرم', qtyOnHand: 1000, avgCostIrr: 200, branchId: 1 },
  ];
  db.accounting.recipes = [{
    id: 'milkshake-v1', menuItemId: 'milkshake', name: 'شیرموز', version: 1, branchId: 1,
    effectiveFrom: '2026-08-01T00:00:00.000Z',
    ingredients: [
      { itemId: 'milk', qty: 250, unit: 'میلی‌لیتر', quantityBasis: 'raw' },
      { itemId: 'banana', qty: 25, unit: 'گرم', quantityBasis: 'raw' },
    ],
  }];
  const order = paidOrder({
    items: [{ menuItemId: 'milkshake', name: 'شیرموز', qty: 2, lineTotal: 150000 }],
  });
  db.orders.push(order);

  const first = finance.capturePaidOrder(db, order, { actor: 'system' });
  assert.equal(first.event.status, 'posted');
  assert.equal(first.costing.event.status, 'posted');
  assert.equal(first.costing.snapshots.length, 1);
  assert.equal(first.costing.snapshots[0].theoreticalCogsIrr, 60000);
  assert.deepEqual(first.costing.movements.map((row) => [row.itemId, row.quantityBase]), [['milk', -0.5], ['banana', -50]]);
  assert.equal(db.financeV2.journalEntries.length, 2);
  assert.equal(db.financeV2.journalEntries[1].source, 'order.cogs');
  assert.equal(db.financeV2.journalEntries[1].debitIrr, 60000);
  const costing = finance.costingInventory(db, { branchId: 1, from: '2026-08-01', to: '2026-08-31T23:59:59.999Z' });
  assert.equal(costing.actualConsumption.amountIrr, 60000);
  assert.equal(costing.itemProfitability.status, 'snapshot_backed');
  assert.deepEqual(costing.itemProfitability.rows.map((row) => [row.menuItemId, row.netSalesIrr, row.theoreticalCogsIrr, row.contributionIrr]), [
    ['milkshake', 1500000, 60000, 1440000],
  ]);

  db.accounting.recipes[0].ingredients[0].qty = 500;
  const second = finance.capturePaidOrder(db, order, { actor: 'system' });
  assert.equal(second.costing.idempotentReplay, true);
  assert.equal(second.costing.snapshots[0].theoreticalCogsIrr, 60000);
  assert.equal(db.financeV2.orderItemCostSnapshots.length, 1);
  assert.equal(db.financeV2.inventoryMovements.length, 2);
  assert.equal(db.financeV2.journalEntries.length, 2);
});

test('COGS never creates a cost journal before the matching sale is posted', () => {
  const db = fixture();
  db.accounting.inventoryItems = [{ id: 'milk', name: 'شیر', unit: 'لیتر', qtyOnHand: 10, avgCostIrr: 100000, branchId: 1 }];
  db.accounting.recipes = [{
    id: 'latte-v1', menuItemId: 'latte', name: 'لاته', version: 1, branchId: 1,
    effectiveFrom: '2026-08-01T00:00:00.000Z',
    ingredients: [{ itemId: 'milk', qty: 250, unit: 'میلی‌لیتر', quantityBasis: 'raw' }],
  }];
  const order = paidOrder({
    id: 810,
    items: [{ menuItemId: 'latte', name: 'لاته', qty: 1, lineTotal: 150000 }],
  });
  assert.throws(() => finance.captureOrderCogs(db, order), (error) => error.code === 'order_cogs_sales_journal_required');
  assert.equal(finance.ensureFinanceV2(db).events.length, 0);
  assert.equal(finance.ensureFinanceV2(db).journalEntries.length, 0);
});

test('ready COGS retry posts only formerly blocked paid orders after explicit confirmation', () => {
  const db = fixture();
  db.accounting.inventoryItems = [{ id: 'milk', name: 'شیر', unit: 'لیتر', qtyOnHand: 10, avgCostIrr: 100000, branchId: 1 }];
  const order = paidOrder({
    id: 811,
    orderNo: 'RETRY-811',
    items: [{ menuItemId: 'latte', name: 'لاته', qty: 1, lineTotal: 150000 }],
  });
  db.orders.push(order);
  const initial = finance.capturePaidOrder(db, order, { actor: 'system' });
  assert.equal(initial.event.status, 'posted');
  assert.equal(initial.costing.event.status, 'blocked');
  assert.equal(finance.ensureFinanceV2(db).journalEntries.length, 1);

  assert.throws(() => finance.retryReadyOrderCogs(db, { branchId: 1 }, 'accountant-1'), (error) => error.code === 'order_cogs_retry_confirmation_required');
  assert.equal(finance.ensureFinanceV2(db).orderItemCostSnapshots.length, 0);

  db.accounting.recipes = [{
    id: 'latte-v1', menuItemId: 'latte', name: 'لاته', version: 1, branchId: 1,
    effectiveFrom: '2026-08-01T00:00:00.000Z',
    ingredients: [{ itemId: 'milk', qty: 250, unit: 'میلی‌لیتر', quantityBasis: 'raw' }],
  }];
  const retried = finance.retryReadyOrderCogs(db, { branchId: 1, confirmed: true }, 'accountant-1');
  assert.equal(retried.candidateCount, 1);
  assert.equal(retried.processed, 1);
  assert.equal(retried.posted, 1);
  assert.equal(retried.stillBlocked, 0);
  assert.equal(retried.remainingBlocked, 0);
  assert.equal(finance.ensureFinanceV2(db).events.find((event) => event.source === 'order.cogs').status, 'posted');
  assert.equal(finance.ensureFinanceV2(db).orderItemCostSnapshots.length, 1);
  assert.equal(finance.ensureFinanceV2(db).inventoryMovements.length, 1);
  assert.equal(finance.ensureFinanceV2(db).journalEntries.filter((entry) => entry.source === 'order.cogs').length, 1);

  const replay = finance.retryReadyOrderCogs(db, { branchId: 1, confirmed: true }, 'accountant-1');
  assert.equal(replay.candidateCount, 0);
  assert.equal(replay.processed, 0);
  assert.equal(replay.posted, 0);
  assert.equal(finance.ensureFinanceV2(db).journalEntries.filter((entry) => entry.source === 'order.cogs').length, 1);
});

test('ready COGS retry route requires confirmation and replays a batch safely', async () => {
  const db = fixture();
  db.accounting.inventoryItems = [{ id: 'milk', name: 'شیر', unit: 'لیتر', qtyOnHand: 10, avgCostIrr: 100000, branchId: 1 }];
  const order = paidOrder({
    id: 812,
    orderNo: 'RETRY-812',
    items: [{ menuItemId: 'latte', name: 'لاته', qty: 1, lineTotal: 150000 }],
  });
  db.orders.push(order);
  finance.capturePaidOrder(db, order, { actor: 'system' });
  db.accounting.recipes = [{
    id: 'latte-v1', menuItemId: 'latte', name: 'لاته', version: 1, branchId: 1,
    effectiveFrom: '2026-08-01T00:00:00.000Z',
    ingredients: [{ itemId: 'milk', qty: 250, unit: 'میلی‌لیتر', quantityBasis: 'raw' }],
  }];
  let saves = 0;
  const routes = financeRouteHarness(db, async () => { saves += 1; }, 'accountant');
  const handler = routes.get('POST /api/admin/v2/finance/events/cogs/retry-ready');

  const rejected = financeResponse();
  await handler(financeRequest({ key: 'retry-cogs-unconfirmed', body: { branchId: 1 } }), rejected);
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.body.error.code, 'order_cogs_retry_confirmation_required');
  assert.equal(finance.ensureFinanceV2(db).journalEntries.filter((entry) => entry.source === 'order.cogs').length, 0);

  const first = financeResponse();
  const body = { branchId: 1, confirmed: true };
  await handler(financeRequest({ key: 'retry-cogs-route', body }), first);
  assert.equal(first.statusCode, 201);
  assert.equal(first.body.data.posted, 1);
  assert.equal(saves, 1);

  const replay = financeResponse();
  await handler(financeRequest({ key: 'retry-cogs-route', body }), replay);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.data.idempotentReplay, true);
  assert.equal(replay.body.data.posted, 1);
  assert.equal(saves, 1);
  assert.equal(finance.ensureFinanceV2(db).journalEntries.filter((entry) => entry.source === 'order.cogs').length, 1);
});

test('shadow cutover readiness requires PostgreSQL plus 100 fully costed orders across seven operating days', () => {
  const db = fixture();
  db.accounting.inventoryItems = [
    { id: 'milk', name: 'شیر', unit: 'لیتر', qtyOnHand: 1000, avgCostIrr: 100000, branchId: 1 },
    { id: 'banana', name: 'موز', unit: 'گرم', qtyOnHand: 100000, avgCostIrr: 200, branchId: 1 },
  ];
  db.accounting.recipes = [{
    id: 'milkshake-v1', menuItemId: 'milkshake', name: 'شیرموز', version: 1, branchId: 1,
    effectiveFrom: '2026-08-01T00:00:00.000Z',
    ingredients: [{ itemId: 'milk', qty: 250, unit: 'میلی‌لیتر' }, { itemId: 'banana', qty: 25, unit: 'گرم' }],
  }];
  finance.ensureFinanceV2(db).fiscalPeriods.push({ id: 'shadow-period', name: 'دوره سایه', startDate: '2026-08-01', endDate: '2026-08-31', status: 'open' });
  const missingBaseline = finance.shadowRunReadiness(db, 1, { storageStatus: { available: true, required: true, snapshotVersion: 2 } });
  assert.equal(missingBaseline.gates.find((gate) => gate.id === 'migration_baseline').passed, false);
  const baselineScan = finance.classifyAndArchiveLegacy(db, 'accountant-1', 1);
  assert.equal(baselineScan.baseline.sourceCount, 0);
  const storageStatus = { available: true, required: true, snapshotVersion: 2 };
  for (let index = 0; index < 100; index += 1) {
    const day = String((index % 7) + 1).padStart(2, '0');
    const order = paidOrder({
      id: 1000 + index, orderNo: `SHADOW-${index + 1}`,
      createdAt: `2026-08-${day}T10:00:00.000Z`, paidAt: `2026-08-${day}T10:03:00.000Z`,
      items: [{ menuItemId: 'milkshake', name: 'شیرموز', qty: 1, lineTotal: 150000 }],
    });
    db.orders.push(order);
    finance.capturePaidOrder(db, order, { actor: 'system' });
    if (index === 0) {
      const early = finance.shadowRunReadiness(db, 1, { storageStatus });
      assert.equal(early.status, 'NO_GO');
      assert.equal(early.completeOrders, 1);
      assert.equal(early.operatingDays, 1);
    }
  }
  reconcileAllCardPayments(db, 'SHADOW-BATCH-1');
  const readiness = finance.shadowRunReadiness(db, 1, { storageStatus });
  assert.equal(readiness.status, 'READY_FOR_CUTOVER_REVIEW');
  assert.equal(readiness.completeOrders, 100);
  assert.equal(readiness.operatingDays, 7);
  assert.equal(readiness.gates.every((gate) => gate.passed), true);
  assert.deepEqual(readiness.policy, { minimumCompleteOrders: 100, minimumOperatingDays: 7, bothThresholdsRequired: true, automaticCutover: false });
});

test('branch cutover feature flag requires green shadow gates, independent approval and approval-time revalidation', () => {
  const notReady = fixture();
  assert.throws(() => finance.requestBranchCutover(notReady, 1, 'manager-1', {
    storageStatus: { available: false, required: true, reason: 'database_url_required' },
  }), (error) => error.code === 'finance_cutover_not_ready' && error.details.failedGates.length > 0);

  const db = fixture();
  db.accounting.inventoryItems = [
    { id: 'milk', name: 'شیر', unit: 'لیتر', qtyOnHand: 1000, avgCostIrr: 100000, branchId: 1 },
    { id: 'banana', name: 'موز', unit: 'گرم', qtyOnHand: 100000, avgCostIrr: 200, branchId: 1 },
  ];
  db.accounting.recipes = [{
    id: 'milkshake-v1', menuItemId: 'milkshake', name: 'شیرموز', version: 1, branchId: 1,
    effectiveFrom: '2026-08-01T00:00:00.000Z',
    ingredients: [{ itemId: 'milk', qty: 250, unit: 'میلی‌لیتر' }, { itemId: 'banana', qty: 25, unit: 'گرم' }],
  }];
  finance.ensureFinanceV2(db).fiscalPeriods.push({ id: 'rollout-period', name: 'دوره انتقال', startDate: '2026-08-01', endDate: '2026-08-31', status: 'open' });
  finance.classifyAndArchiveLegacy(db, 'accountant-1', 1);
  const storageStatus = { available: true, required: true, snapshotVersion: 2 };
  for (let index = 0; index < 100; index += 1) {
    const day = String((index % 7) + 1).padStart(2, '0');
    const order = paidOrder({
      id: 3000 + index, orderNo: `ROLLOUT-${index + 1}`,
      createdAt: `2026-08-${day}T10:00:00.000Z`, paidAt: `2026-08-${day}T10:03:00.000Z`,
      items: [{ menuItemId: 'milkshake', name: 'شیرموز', qty: 1, lineTotal: 150000 }],
    });
    db.orders.push(order);
    finance.capturePaidOrder(db, order, { actor: 'system' });
  }

  reconcileAllCardPayments(db, 'ROLLOUT-BATCH-1');
  const requested = finance.requestBranchCutover(db, 1, 'manager-1', { storageStatus });
  assert.equal(requested.rollout.status, 'pending_approval');
  assert.equal(requested.approval.operation, 'activate_finance_branch_cutover');
  assert.equal(finance.branchRolloutStatus(db, 1, { storageStatus }).status, 'pending_approval');
  assert.throws(() => finance.decideApproval(db, requested.approval.id, 'approved', 'manager-1', null, { storageStatus }), (error) => error.code === 'segregation_of_duties');

  const temporaryBlock = finance.recordEvent(db, {
    source: 'cutover.test', sourceId: 'blocked', sourceVersion: 1, idempotencyKey: 'cutover:test:blocked',
    branchId: 1, occurredAt: '2026-08-07T12:00:00.000Z', amountIrr: 0, status: 'blocked', error: { code: 'test_block' },
  }).event;
  assert.throws(() => finance.decideApproval(db, requested.approval.id, 'approved', 'owner-1', null, { storageStatus }), (error) => error.code === 'finance_cutover_revalidation_failed');
  db.financeV2.events = db.financeV2.events.filter((event) => event.id !== temporaryBlock.id);

  const approved = finance.decideApproval(db, requested.approval.id, 'approved', 'owner-1', 'صورتجلسه انتقال', { storageStatus });
  assert.equal(approved.branchRollout.status, 'active');
  assert.equal(approved.branchRolloutReadiness.status, 'READY_FOR_CUTOVER_REVIEW');
  assert.deepEqual(db.financeV2.rollout.cutoverBranchIds, [1]);
  assert.equal(finance.branchRolloutStatus(db, 1, { storageStatus }).cutoverActive, true);
  assert.throws(() => finance.requestBranchCutover(db, 1, 'owner-2', { storageStatus }), (error) => error.code === 'finance_rollout_already_active');
});

test('shadow recipe consumption changes capacity without mutating or clamping legacy on-hand stock', () => {
  const db = fixture();
  db.accounting.inventoryItems = [
    { id: 'milk', name: 'شیر', unit: 'لیتر', qtyOnHand: 10, avgCostIrr: 100000, branchId: 1 },
    { id: 'banana', name: 'موز', unit: 'گرم', qtyOnHand: 1000, avgCostIrr: 200, branchId: 1 },
  ];
  db.accounting.recipes = [{
    id: 'milkshake-v1', menuItemId: 'milkshake', name: 'شیرموز', version: 1, branchId: 1,
    ingredients: [{ itemId: 'milk', qty: 250, unit: 'میلی‌لیتر', quantityBasis: 'raw' }, { itemId: 'banana', qty: 25, unit: 'گرم', quantityBasis: 'raw' }],
  }];
  const order = paidOrder({ items: [{ menuItemId: 'milkshake', name: 'شیرموز', qty: 8, lineTotal: 150000 }] });
  db.orders.push(order);
  finance.capturePaidOrder(db, order);
  const capacity = finance.costingInventory(db, { branchId: 1 }).intelligence.recipeCapacity[0];
  assert.equal(capacity.capacity, 32);
  assert.equal(db.accounting.inventoryItems[0].qtyOnHand, 10);
  assert.equal(db.accounting.inventoryItems[1].qtyOnHand, 1000);
});

test('kitchen waste records physical truth, posts value once and reverses without editing the original movement', () => {
  const db = fixture();
  db.accounting.inventoryItems = [{ id: 'milk', sku: 'MILK', name: 'شیر', unit: 'لیتر', qtyOnHand: 10, minStock: 3, avgCostIrr: 100000, branchId: 1 }];
  const first = finance.recordInventoryOperationV2(db, 'waste', {
    branchId: 1, itemId: 'milk', quantity: 2, unit: 'لیتر', reason: 'خرابی زنجیره سرد', occurredAt: '2026-08-24T09:00:00.000Z',
  }, 'kitchen-1', 'waste-1');
  const replay = finance.recordInventoryOperationV2(db, 'waste', {
    branchId: 1, itemId: 'milk', quantity: 2, unit: 'لیتر', reason: 'خرابی زنجیره سرد', occurredAt: '2026-08-24T09:00:00.000Z',
  }, 'kitchen-1', 'waste-1');
  assert.equal(first.event.status, 'posted');
  assert.equal(first.journalEntry.debitIrr, 200000);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(db.financeV2.inventoryMovements.length, 1);
  assert.equal(finance.kitchenInventory(db, { branchId: 1 }).items[0].availableQuantity, 8);
  assert.equal(finance.costingInventory(db, { branchId: 1 }).actualConsumption.amountIrr, 200000);

  const originalMovement = structuredClone(db.financeV2.inventoryMovements[0]);
  const reversed = finance.reverseInventoryOperationV2(db, first.event.id, {
    reason: 'ثبت روی کالای اشتباه', occurredAt: '2026-08-24T10:00:00.000Z',
  }, 'owner-1', 'waste-reversal-1');
  assert.equal(reversed.event.status, 'posted');
  assert.equal(reversed.movements[0].reversalOfId, originalMovement.id);
  assert.deepEqual(db.financeV2.inventoryMovements[0], originalMovement);
  assert.equal(finance.kitchenInventory(db, { branchId: 1 }).items[0].availableQuantity, 10);
  assert.equal(db.financeV2.journalEntries.length, 2);
  assert.throws(() => finance.reverseInventoryOperationV2(db, first.event.id, { reason: 'تکرار معکوس' }, 'owner-1', 'waste-reversal-2'), (error) => error.code === 'inventory_event_already_reversed');
});

test('unvalued waste never invents money, remains physically effective and can be valued later by the accountant', () => {
  const db = fixture();
  db.accounting.inventoryItems = [{ id: 'milk', name: 'شیر', unit: 'لیتر', qtyOnHand: 10, avgCost: 10000, branchId: 1 }];
  const captured = finance.recordInventoryOperationV2(db, 'waste', {
    branchId: 1, itemId: 'milk', quantity: 1, unit: 'لیتر', reason: 'تاریخ مصرف', occurredAt: '2026-08-24T09:00:00.000Z',
  }, 'kitchen-1', 'waste-unvalued-1');
  assert.equal(captured.event.status, 'blocked');
  assert.equal(captured.event.error.code, 'inventory_cost_unit_ambiguous');
  assert.equal(captured.movements[0].totalCostIrr, null);
  assert.equal(finance.kitchenInventory(db, { branchId: 1 }).items[0].availableQuantity, 9);
  assert.equal(db.financeV2.journalEntries.length, 0);

  db.accounting.inventoryItems[0].avgCostIrr = 120000;
  const resolved = finance.resolveEvent(db, captured.event.id, {}, 'accountant-1');
  assert.equal(resolved.event.status, 'posted');
  assert.equal(resolved.entry.debitIrr, 120000);
  assert.equal(db.financeV2.inventoryMovements[0].totalCostIrr, null);
  assert.equal(db.financeV2.inventoryMovementValuations[0].totalCostIrr, 120000);
});

test('stock count records material variance as an accountant exception', () => {
  const db = fixture();
  db.accounting.inventoryItems = [{ id: 'coffee', name: 'قهوه', unit: 'کیلوگرم', qtyOnHand: 10, avgCostIrr: 500000, branchId: 1 }];
  const counted = finance.recordInventoryOperationV2(db, 'stock_count', {
    branchId: 1, itemId: 'coffee', countedQuantity: 8, unit: 'کیلوگرم', reason: 'شمارش پایان شیفت', occurredAt: '2026-08-24T20:00:00.000Z',
  }, 'kitchen-1', 'count-1');
  assert.equal(counted.event.status, 'posted');
  assert.equal(counted.deltaBase, -2);
  assert.ok(counted.issues.some((issue) => issue.code === 'stock_count_material_variance'));
  assert.equal(db.financeV2.reconciliationItems[0].kind, 'inventory_exception');
  assert.equal(db.financeV2.reconciliationItems[0].status, 'exception');
});

test('production batch transfers consumed cost once, tracks actual yield and exposes shortages for review', () => {
  const db = fixture();
  db.accounting.inventoryItems = [
    { id: 'milk', name: 'شیر', unit: 'لیتر', qtyOnHand: 10, avgCostIrr: 100000, branchId: 1 },
    { id: 'shake-base', name: 'بیس شیرموز', unit: 'عدد', qtyOnHand: 0, avgCostIrr: 0, branchId: 1 },
  ];
  db.accounting.recipes = [{
    id: 'shake-batch-v1', name: 'بچ شیرموز', version: 1, branchId: 1, servings: 40, outputItemId: 'shake-base',
    ingredients: [{ itemId: 'milk', qty: 10, unit: 'لیتر', quantityBasis: 'raw' }],
  }];
  const batch = finance.recordInventoryOperationV2(db, 'production_batch', {
    branchId: 1, recipeId: 'shake-batch-v1', plannedYield: 40, actualYield: 35, occurredAt: '2026-08-24T11:00:00.000Z',
  }, 'kitchen-1', 'batch-1');
  assert.equal(batch.event.status, 'posted');
  assert.equal(batch.totalCostIrr, 1000000);
  assert.equal(batch.journalEntry.debitIrr, 1000000);
  assert.equal(batch.journalEntry.creditIrr, 1000000);
  assert.deepEqual(batch.movements.map((row) => [row.itemId, row.quantityBase]), [['milk', -10], ['shake-base', 35]]);
  assert.equal(batch.issues.some((issue) => issue.code === 'inventory_shortage'), false);
  assert.equal(db.financeV2.reconciliationItems.length, 0);
  const inventory = finance.kitchenInventory(db, { branchId: 1 });
  assert.equal(inventory.items.find((row) => row.id === 'milk').availableQuantity, 0);
  assert.equal(inventory.items.find((row) => row.id === 'shake-base').availableQuantity, 35);
  assert.equal(inventory.policy.financialAccountsHiddenFromOperator, true);
});

test('production batch with insufficient ingredients is rejected before any physical or financial mutation', () => {
  const db = fixture();
  db.accounting.inventoryItems = [
    { id: 'milk', name: 'شیر', unit: 'لیتر', qtyOnHand: 8, avgCostIrr: 100000, branchId: 1 },
    { id: 'shake-base', name: 'بیس شیرموز', unit: 'عدد', qtyOnHand: 0, avgCostIrr: 0, branchId: 1 },
  ];
  db.accounting.recipes = [{
    id: 'shake-batch-v1', name: 'بچ شیرموز', version: 1, branchId: 1, servings: 40, outputItemId: 'shake-base',
    ingredients: [{ itemId: 'milk', qty: 10, unit: 'لیتر', quantityBasis: 'raw' }],
  }];
  assert.throws(() => finance.recordInventoryOperationV2(db, 'production_batch', {
    branchId: 1, recipeId: 'shake-batch-v1', plannedYield: 40, actualYield: 35,
  }, 'kitchen-1', 'batch-shortage-1'), (error) => error.code === 'production_inventory_shortage');
  assert.deepEqual(db.financeV2.inventoryMovements, []);
  assert.deepEqual(db.financeV2.productionBatches, []);
  assert.deepEqual(db.financeV2.events, []);
  assert.deepEqual(db.financeV2.journalEntries, []);
  assert.equal(finance.kitchenInventory(db, { branchId: 1 }).items.find((row) => row.id === 'milk').availableQuantity, 8);
});

test('ambiguous inventory money or shortage blocks COGS without snapshots, movements or fake journal', () => {
  const ambiguous = fixture();
  ambiguous.accounting.inventoryItems = [{ id: 'milk', name: 'شیر', unit: 'لیتر', qtyOnHand: 10, avgCost: 10000, branchId: 1 }];
  ambiguous.accounting.recipes = [{ id: 'r1', menuItemId: 'milkshake', ingredients: [{ itemId: 'milk', qty: 1, unit: 'لیتر', quantityBasis: 'raw' }] }];
  const order = paidOrder({ items: [{ menuItemId: 'milkshake', name: 'شیرموز', qty: 1, lineTotal: 150000 }] });
  ambiguous.orders.push(order);
  const blocked = finance.capturePaidOrder(ambiguous, order);
  assert.equal(blocked.costing.event.status, 'blocked');
  assert.equal(blocked.costing.event.error.code, 'inventory_cost_unit_ambiguous');
  assert.equal(ambiguous.financeV2.orderItemCostSnapshots.length, 0);
  assert.equal(ambiguous.financeV2.inventoryMovements.length, 0);
  assert.equal(ambiguous.financeV2.journalEntries.length, 1);

  const shortage = fixture();
  shortage.accounting.inventoryItems = [{ id: 'milk', name: 'شیر', unit: 'لیتر', qtyOnHand: 0.5, avgCostIrr: 100000, branchId: 1 }];
  shortage.accounting.recipes = [{ id: 'r1', menuItemId: 'milkshake', ingredients: [{ itemId: 'milk', qty: 1, unit: 'لیتر', quantityBasis: 'raw' }] }];
  shortage.orders.push(order);
  const shortageResult = finance.capturePaidOrder(shortage, order);
  assert.equal(shortageResult.costing.event.error.code, 'inventory_shortage');
  assert.equal(shortage.financeV2.inventoryMovements.length, 0);
  assert.equal(shortage.accounting.inventoryItems[0].qtyOnHand, 0.5);
});

test('successful online payment writes a reliable tender and recovers finance capture on retry', () => {
  const db = fixture();
  const order = paidOrder({ paymentStatus: 'pending', status: 'pending_online', partialPayments: [], paymentMethod: 'online', paidAt: null });
  const payment = { id: 77, orderId: order.id, amount: order.total, status: 'paid', provider: 'sandbox', reference: 'ref-77', updatedAt: '2026-08-24T10:03:00.000Z' };
  db.orders.push(order);
  const first = finance.captureOnlinePaidOrder(db, order, payment, { actor: 'gateway:sandbox' });
  const second = finance.captureOnlinePaidOrder(db, order, payment, { actor: 'gateway:sandbox' });
  assert.equal(order.paymentStatus, 'paid');
  assert.equal(order.paymentTender, 'online');
  assert.equal(order.partialPayments.length, 1);
  assert.equal(first.event.status, 'posted');
  assert.equal(second.idempotentReplay, true);
  assert.equal(db.financeV2.events.filter((row) => row.source === 'order.paid').length, 1);
});

test('customer refund requires independent approval, respects payment ceiling and posts proportional tax without changing inventory', () => {
  const db = fixture();
  const order = paidOrder({ taxAmount: 15000 });
  db.orders.push(order);
  finance.capturePaidOrder(db, order, { actor: 'accountant-1' });
  const cardPayment = db.financeV2.payments.find((row) => row.tender === 'card');
  assert.ok(cardPayment);
  const requested = finance.requestOrderRefund(db, order.id, {
    paymentId: cardPayment.id, amountIrr: 300000, reason: 'لغو پس از پرداخت', refundDate: '2026-08-24T12:00:00.000Z',
  }, 'accountant-1', 'refund-request-1');
  assert.equal(requested.refund.status, 'pending_approval');
  assert.equal(requested.refund.inventoryEffect, 'none_financial_refund_only');
  assert.throws(() => finance.decideApproval(db, requested.approval.id, 'approved', 'accountant-1'), (error) => error.code === 'segregation_of_duties');
  const approved = finance.decideApproval(db, requested.approval.id, 'approved', 'owner-1');
  assert.equal(approved.financeRefund.status, 'succeeded');
  assert.equal(approved.financeRefund.taxRefundIrr, 30000);
  assert.equal(approved.financeRefund.revenueRefundIrr, 270000);
  assert.deepEqual(approved.refundEntry.lines.map((line) => [line.accountCode, line.debitIrr, line.creditIrr]), [
    ['4110', 270000, 0], ['2210', 30000, 0], ['1320', 0, 300000],
  ]);
  assert.equal(db.financeV2.inventoryMovements.length, 0);
  assert.equal(db.financeV2.reconciliationItems.find((row) => row.kind === 'refund').status, 'matched');
  assert.throws(() => finance.requestOrderRefund(db, order.id, {
    paymentId: cardPayment.id, amountIrr: 800000, reason: 'بیش از مانده', refundDate: '2026-08-24T13:00:00.000Z',
  }, 'accountant-2', 'refund-request-2'), (error) => error.code === 'refund_total_exceeds_payment');
  const snapshot = finance.reportSnapshot(db, { branchId: 1, from: '2026-08-01', to: '2026-08-31T23:59:59.999Z' });
  assert.equal(snapshot.operational.grossSalesIrr, 1500000);
  assert.equal(snapshot.operational.refundsIrr, 300000);
  assert.equal(snapshot.operational.salesIrr, 1200000);
  assert.equal(snapshot.ledger.salesIrr, 1200000);
  assert.equal(snapshot.ledger.netRevenueIrr, 1080000);
  assert.equal(snapshot.ledger.taxIrr, 120000);
  assert.equal(snapshot.reconciliation.salesDifferenceIrr, 0);
});

test('PSP settlement reconciles selected payments to gross, fee and bank deposit exactly once', () => {
  const db = fixture(); const order = paidOrder(); db.orders.push(order);
  finance.capturePaidOrder(db, order, { actor: 'system' });
  const unmatched = db.financeV2.reconciliationItems.find((row) => row.kind === 'payment');
  assert.ok(unmatched);
  const settled = finance.recordSettlementV2(db, {
    branchId: 1, paymentIds: [unmatched.paymentId], psp: 'به‌پرداخت', terminalId: 'TERM-1', batchNo: 'BATCH-1',
    feeIrr: 10000, bankAmountIrr: 990000, bankReference: 'BANK-1', settledAt: '2026-08-24T15:00:00.000Z',
  }, 'accountant-1');
  assert.equal(settled.settlement.status, 'matched');
  assert.equal(unmatched.status, 'matched');
  assert.deepEqual(settled.journalEntry.lines.map((line) => [line.accountCode, line.debitIrr, line.creditIrr]), [
    ['1210', 990000, 0], ['6710', 10000, 0], ['1320', 0, 1000000],
  ]);
  assert.throws(() => finance.recordSettlementV2(db, {
    branchId: 1, paymentIds: [unmatched.paymentId], psp: 'به‌پرداخت', terminalId: 'TERM-1', batchNo: 'BATCH-1',
    feeIrr: 10000, bankAmountIrr: 990000, settledAt: '2026-08-24T16:00:00.000Z',
  }, 'accountant-1'), (error) => error.code === 'settlement_batch_duplicate');
});

test('bank statement evidence matches only an exact posted bank movement and remains idempotent by reference', () => {
  const db = fixture();
  const draft = finance.createDraft(db, {
    date: '2026-08-24T12:00:00.000Z', branchId: 1, costCenter: 'branch:1', description: 'واریز سرمایه به بانک',
    lines: [
      { accountCode: '1210', debitIrr: 750000, creditIrr: 0, branchId: 1, costCenter: 'branch:1' },
      { accountCode: '3100', debitIrr: 0, creditIrr: 750000, branchId: 1, costCenter: 'branch:1' },
    ],
  }, 'accountant-1');
  const submitted = finance.submitDraft(db, draft.id, 'accountant-1');
  finance.decideApproval(db, submitted.approval.id, 'approved', 'owner-1');
  const statement = finance.recordBankStatementLine(db, {
    branchId: 1, bankReference: 'BANK-TX-750', bankAccountCode: '1210', direction: 'inflow',
    amountIrr: 750000, occurredAt: '2026-08-24T13:00:00.000Z', description: 'واریز نقدی',
  }, 'accountant-1');
  assert.equal(statement.status, 'unmatched');
  assert.equal(db.financeV2.journalEntries.length, 1, 'bank evidence must not create a journal');
  const matched = finance.matchBankStatementLine(db, statement.id, { journalEntryId: draft.id }, 'accountant-1');
  assert.equal(matched.statementLine.status, 'matched');
  assert.equal(matched.statementLine.details.matchMode, 'exact_amount_direction_account_branch');
  assert.equal(matched.statementLine.journalEntryId, draft.id);
  assert.throws(() => finance.recordBankStatementLine(db, {
    branchId: 1, bankReference: 'bank-tx-750', bankAccountCode: '1210', direction: 'inflow',
    amountIrr: 750000, occurredAt: '2026-08-24T13:05:00.000Z',
  }, 'accountant-1'), (error) => error.code === 'bank_statement_reference_duplicate');
  const view = finance.salesCashBank(db, { branchId: 1, from: '2026-08-01', to: '2026-08-31T23:59:59.999Z' });
  assert.equal(view.reconciliation.bankStatementLines[0].matchedJournal.number, draft.number);
  assert.equal(view.reconciliation.bankCandidates.length, 0);
});

test('bank reconciliation refuses amount, direction, branch and duplicate journal-account matches', () => {
  const db = fixture();
  const draft = finance.createDraft(db, {
    date: '2026-08-24T12:00:00.000Z', branchId: 1, costCenter: 'branch:1', description: 'پرداخت بانکی',
    lines: [
      { accountCode: '6200', accountType: 'expense', debitIrr: 500000, creditIrr: 0, branchId: 1, costCenter: 'branch:1' },
      { accountCode: '1210', debitIrr: 0, creditIrr: 500000, branchId: 1, costCenter: 'branch:1' },
    ],
  }, 'accountant-1');
  const submitted = finance.submitDraft(db, draft.id, 'accountant-1');
  finance.decideApproval(db, submitted.approval.id, 'approved', 'owner-1');
  const wrong = finance.recordBankStatementLine(db, {
    branchId: 1, bankReference: 'BANK-WRONG', bankAccountCode: '1210', direction: 'inflow',
    amountIrr: 500000, occurredAt: '2026-08-24T14:00:00.000Z',
  }, 'accountant-1');
  assert.throws(() => finance.matchBankStatementLine(db, wrong.id, { journalEntryId: draft.id }, 'accountant-1'), (error) => error.code === 'bank_match_amount_direction_mismatch');
  assert.equal(wrong.status, 'unmatched');
  const exact = finance.recordBankStatementLine(db, {
    branchId: 1, bankReference: 'BANK-EXACT', bankAccountCode: '1210', direction: 'outflow',
    amountIrr: 500000, occurredAt: '2026-08-24T14:00:00.000Z',
  }, 'accountant-1');
  finance.matchBankStatementLine(db, exact.id, { journalEntryId: draft.id }, 'accountant-1');
  const duplicateTarget = finance.recordBankStatementLine(db, {
    branchId: 1, bankReference: 'BANK-DUPLICATE-TARGET', bankAccountCode: '1210', direction: 'outflow',
    amountIrr: 500000, occurredAt: '2026-08-24T14:05:00.000Z',
  }, 'accountant-1');
  assert.throws(() => finance.matchBankStatementLine(db, duplicateTarget.id, { journalEntryId: draft.id }, 'accountant-1'), (error) => error.code === 'bank_match_journal_already_used');
});

test('monthly rent and payroll commitments create one approved accrual per month and feed actual break-even', () => {
  const db = fixture();
  const commitment = finance.createCostCommitment(db, {
    branchId: 1, name: 'اجاره شعبه اصلی', type: 'rent', monthlyAmountIrr: 20000000,
    startDate: '2026-08-01', counterpartyId: 'landlord-1',
  }, 'accountant-1');
  assert.equal(commitment.expenseAccount, '6200');
  assert.equal(commitment.liabilityAccount, '2700');
  assert.throws(() => finance.createCostAccrual(db, commitment.id, { postingDate: '2026-08-24' }, 'accountant-1'), (error) => error.code === 'cost_accrual_v2_period_required');
  finance.createFiscalPeriod(db, { name: 'مرداد ۱۴۰۵', startDate: '2026-08-01', endDate: '2026-08-31' }, 'owner-1');
  const created = finance.createCostAccrual(db, commitment.id, { postingDate: '2026-08-24' }, 'accountant-1');
  assert.equal(created.accrual.status, 'pending_approval');
  assert.equal(created.journalEntry.status, 'pending_approval');
  assert.deepEqual(created.journalEntry.lines.map((line) => [line.accountCode, line.debitIrr, line.creditIrr]), [
    ['6200', 20000000, 0], ['2700', 0, 20000000],
  ]);
  assert.throws(() => finance.decideApproval(db, created.approval.id, 'approved', 'accountant-1'), (error) => error.code === 'segregation_of_duties');
  finance.decideApproval(db, created.approval.id, 'approved', 'owner-1');
  assert.equal(created.accrual.status, 'posted');
  assert.throws(() => finance.createCostAccrual(db, commitment.id, { postingDate: '2026-08-30' }, 'accountant-2'), (error) => error.code === 'cost_accrual_period_duplicate');
  const performance = finance.createDraft(db, {
    date: '2026-08-25T12:00:00.000Z', branchId: 1, costCenter: 'branch:1', description: 'فروش و هزینه متغیر مبنای برنامه',
    lines: [
      { accountCode: '1210', debitIrr: 10000000, creditIrr: 0, branchId: 1, costCenter: 'branch:1' },
      { accountCode: '4110', debitIrr: 0, creditIrr: 10000000, branchId: 1, costCenter: 'branch:1' },
      { accountCode: '5100', debitIrr: 4000000, creditIrr: 0, branchId: 1, costCenter: 'branch:1' },
      { accountCode: '1610', debitIrr: 0, creditIrr: 4000000, branchId: 1, costCenter: 'branch:1' },
    ],
  }, 'accountant-2');
  const performanceApproval = finance.submitDraft(db, performance.id, 'accountant-2');
  finance.decideApproval(db, performanceApproval.approval.id, 'approved', 'owner-1');
  const actual = finance.actualBreakEvenFromLedger(db, { branchId: 1, from: '2026-08-01', to: '2026-08-31T23:59:59.999Z' });
  assert.equal(actual.fixedCostIrr, 20000000);
  assert.equal(actual.unclassified.length, 0);
  const planned = finance.plannedBreakEvenFromCommitments(db, { branchId: 1, from: '2026-08-01', to: '2026-08-31T23:59:59.999Z' });
  assert.equal(planned.status, 'available');
  assert.equal(planned.committedFixedCostIrr, 20000000);
  assert.equal(planned.breakEvenSalesIrr, 33333334);
  const twoMonths = finance.plannedBreakEvenFromCommitments(db, { branchId: 1, from: '2026-08-01', to: '2026-09-30T23:59:59.999Z' });
  assert.equal(twoMonths.committedFixedCostIrr, 40000000);
  assert.deepEqual(twoMonths.commitments[0].months.map((row) => [row.month, row.activeDays, row.daysInMonth, row.amountIrr]), [
    ['2026-08', 31, 31, 20000000], ['2026-09', 30, 30, 20000000],
  ]);
  const partialMonth = finance.plannedBreakEvenFromCommitments(db, { branchId: 1, from: '2026-08-16', to: '2026-08-31T23:59:59.999Z' });
  assert.equal(partialMonth.committedFixedCostIrr, 10322581);
  assert.equal(partialMonth.reportingPeriod.proration, 'calendar_days_per_month');
});

test('periodic cost payment requires owner approval, respects remaining payable and reverses without deleting history', () => {
  const db = fixture();
  finance.createFiscalPeriod(db, { name: 'مرداد ۱۴۰۵', startDate: '2026-08-01', endDate: '2026-08-31' }, 'owner-1');
  const commitment = finance.createCostCommitment(db, {
    branchId: 1, name: 'حقوق تیم سالن', type: 'payroll_service', monthlyAmountIrr: 12000000, startDate: '2026-08-01',
  }, 'accountant-1');
  const created = finance.createCostAccrual(db, commitment.id, { postingDate: '2026-08-24' }, 'accountant-1');
  finance.decideApproval(db, created.approval.id, 'approved', 'owner-1');
  const requested = finance.requestCostAccrualPayment(db, created.accrual.id, {
    amountIrr: 7000000, paymentMethod: 'bank', paymentDate: '2026-08-25T12:00:00.000Z', reference: 'PAYROLL-1',
  }, 'accountant-1');
  assert.equal(requested.payment.status, 'pending_approval');
  assert.equal(created.accrual.paidAmountIrr, 0);
  assert.throws(() => finance.requestCostAccrualPayment(db, created.accrual.id, {
    amountIrr: 6000000, paymentMethod: 'bank', paymentDate: '2026-08-25T13:00:00.000Z',
  }, 'accountant-2'), (error) => error.code === 'cost_payment_amount_invalid');
  const approved = finance.decideApproval(db, requested.approval.id, 'approved', 'owner-1');
  assert.deepEqual(approved.costPaymentEntry.lines.map((line) => [line.accountCode, line.debitIrr, line.creditIrr]), [
    ['2600', 7000000, 0], ['1210', 0, 7000000],
  ]);
  assert.equal(created.accrual.status, 'partially_paid');
  assert.equal(created.accrual.paidAmountIrr, 7000000);
  assert.throws(() => finance.reverseEntry(db, created.journalEntry.id, 'owner-1', 'ابطال بعد از پرداخت', '2026-08-26T12:00:00.000Z'), (error) => error.code === 'cost_accrual_has_payment_activity');
  finance.reverseEntry(db, approved.costPaymentEntry.id, 'owner-1', 'برگشت پرداخت بانکی', '2026-08-26T12:00:00.000Z');
  assert.equal(requested.payment.status, 'reversed');
  assert.equal(created.accrual.status, 'posted');
  assert.equal(created.accrual.paidAmountIrr, 0);
});

test('fixed asset acquisition and monthly depreciation require independent approval and one active run per asset-month', () => {
  const db = fixture();
  finance.createFiscalPeriod(db, { name: 'مرداد ۱۴۰۵', startDate: '2026-08-01', endDate: '2026-08-31' }, 'owner-1');
  const acquired = finance.createFixedAssetV2(db, {
    branchId: 1, assetCode: 'AST-ESP-01', name: 'دستگاه اسپرسوساز', category: 'kitchen_bar',
    fundingMethod: 'bank', sourceReference: 'INV-ASSET-100', purchaseDate: '2026-08-01', inServiceDate: '2026-08-01',
    purchaseCostIrr: 12000000, salvageValueIrr: 0, usefulLifeMonths: 12,
  }, 'accountant-1');
  assert.equal(acquired.asset.status, 'pending_approval');
  assert.deepEqual(acquired.journalEntry.lines.map((line) => [line.accountCode, line.debitIrr, line.creditIrr]), [
    ['1810', 12000000, 0], ['1210', 0, 12000000],
  ]);
  assert.throws(() => finance.decideApproval(db, acquired.approval.id, 'approved', 'accountant-1'), (error) => error.code === 'segregation_of_duties');
  finance.decideApproval(db, acquired.approval.id, 'approved', 'owner-1');
  assert.equal(acquired.asset.status, 'active');
  const preview = finance.previewDepreciationV2(db, { branchId: 1, postingDate: '2026-08-25' });
  assert.equal(preview.status, 'available');
  assert.equal(preview.totalDepreciationIrr, 1000000);
  const run = finance.createDepreciationRunV2(db, { branchId: 1, postingDate: '2026-08-25' }, 'accountant-1');
  assert.equal(run.run.status, 'pending_approval');
  assert.equal(acquired.asset.accumulatedDepreciationIrr, 0);
  assert.throws(() => finance.createDepreciationRunV2(db, { branchId: 1, postingDate: '2026-08-26' }, 'accountant-2'), (error) => error.code === 'depreciation_no_eligible_assets');
  finance.decideApproval(db, run.approval.id, 'approved', 'owner-1');
  assert.equal(run.run.status, 'posted');
  assert.equal(acquired.asset.accumulatedDepreciationIrr, 1000000);
  const reversal = finance.reverseEntry(db, run.journalEntry.id, 'owner-1', 'اصلاح استهلاک', '2026-08-26T12:00:00.000Z');
  assert.equal(run.run.status, 'reversed');
  assert.equal(run.run.reversalJournalEntryId, reversal.id);
  assert.equal(acquired.asset.accumulatedDepreciationIrr, 0);
  const corrected = finance.createDepreciationRunV2(db, { branchId: 1, postingDate: '2026-08-27' }, 'accountant-2');
  finance.decideApproval(db, corrected.approval.id, 'approved', 'owner-1');
  assert.throws(() => finance.reverseEntry(db, acquired.journalEntry.id, 'owner-1', 'ابطال خرید', '2026-08-28T12:00:00.000Z'), (error) => error.code === 'fixed_asset_has_depreciation');
});

test('V2 payroll validates the accounting equation and separates approval, liabilities, payment and reversal', () => {
  const db = fixture();
  const valid = {
    branchId: 1, postingDate: '2026-08-25', headcount: 4, sourceReference: 'PAYROLL-1405-06',
    kitchenGrossIrr: 20000000, serviceGrossIrr: 10000000, employerInsuranceIrr: 3000000,
    employeeInsuranceIrr: 2000000, payrollTaxIrr: 1000000, otherDeductionsIrr: 500000, netPayIrr: 26500000,
  };
  assert.throws(() => finance.createPayrollRunV2(db, valid, 'accountant-1'), (error) => error.code === 'payroll_v2_period_required');
  assert.throws(() => finance.previewPayrollRunV2({ ...valid, netPayIrr: 27000000 }), (error) => error.code === 'payroll_net_reconciliation_failed');
  assert.throws(() => finance.previewPayrollRunV2({ ...valid, serviceMonth: '2026-07' }), (error) => error.code === 'payroll_service_month_posting_mismatch');
  finance.createFiscalPeriod(db, { name: 'مرداد ۱۴۰۵', startDate: '2026-08-01', endDate: '2026-08-31' }, 'owner-1');
  const created = finance.createPayrollRunV2(db, valid, 'accountant-1');
  assert.equal(created.run.status, 'pending_approval');
  assert.equal(created.run.totalExpenseIrr, 33000000);
  assert.deepEqual(created.journalEntry.lines.map((line) => [line.accountCode, line.debitIrr, line.creditIrr]), [
    ['6110', 20000000, 0], ['6120', 10000000, 0], ['6140', 3000000, 0],
    ['2220', 0, 1000000], ['2230', 0, 5000000], ['2700', 0, 500000], ['2600', 0, 26500000],
  ]);
  assert.throws(() => finance.decideApproval(db, created.approval.id, 'approved', 'accountant-1'), (error) => error.code === 'segregation_of_duties');
  finance.decideApproval(db, created.approval.id, 'approved', 'owner-1');
  assert.equal(created.run.status, 'posted');
  assert.throws(() => finance.createPayrollRunV2(db, valid, 'accountant-2'), (error) => error.code === 'payroll_branch_period_duplicate');
  const requested = finance.requestPayrollPaymentV2(db, created.run.id, {
    liabilityType: 'net_salary', amountIrr: 15000000, paymentMethod: 'bank', paymentDate: '2026-08-26T12:00:00.000Z', reference: 'BANK-PAY-1',
  }, 'accountant-1');
  assert.throws(() => finance.requestPayrollPaymentV2(db, created.run.id, {
    liabilityType: 'net_salary', amountIrr: 12000000, paymentMethod: 'bank', paymentDate: '2026-08-26T13:00:00.000Z',
  }, 'accountant-2'), (error) => error.code === 'payroll_payment_amount_invalid');
  const approved = finance.decideApproval(db, requested.approval.id, 'approved', 'owner-1');
  assert.deepEqual(approved.payrollPaymentEntry.lines.map((line) => [line.accountCode, line.debitIrr, line.creditIrr]), [
    ['2600', 15000000, 0], ['1210', 0, 15000000],
  ]);
  assert.equal(created.run.status, 'partially_paid');
  assert.equal(created.run.paidByLiability.net_salary, 15000000);
  assert.throws(() => finance.reverseEntry(db, created.journalEntry.id, 'owner-1', 'ابطال پس از پرداخت', '2026-08-27T12:00:00.000Z'), (error) => error.code === 'payroll_run_has_payment_activity');
  finance.reverseEntry(db, approved.payrollPaymentEntry.id, 'owner-1', 'برگشت پرداخت', '2026-08-27T12:00:00.000Z');
  assert.equal(requested.payment.status, 'reversed');
  assert.equal(created.run.status, 'posted');
  assert.equal(created.run.paidByLiability.net_salary, 0);
  finance.reverseEntry(db, created.journalEntry.id, 'owner-1', 'اصلاح لیست حقوق', '2026-08-28T12:00:00.000Z');
  assert.equal(created.run.status, 'reversed');
});

test('actual break-even uses only posted classified restaurant accounts and stays partial when current expenses are unclassified', () => {
  const db = fixture();
  const entry = finance.createDraft(db, {
    date: '2026-08-24T12:00:00.000Z', branchId: 1, costCenter: 'branch:1', description: 'عملکرد واقعی دوره',
    lines: [
      { accountCode: '1210', debitIrr: 10000000, creditIrr: 0, branchId: 1, costCenter: 'branch:1' },
      { accountCode: '4110', debitIrr: 0, creditIrr: 10000000, branchId: 1, costCenter: 'branch:1' },
      { accountCode: '5100', debitIrr: 4000000, creditIrr: 0, branchId: 1, costCenter: 'branch:1' },
      { accountCode: '1610', debitIrr: 0, creditIrr: 4000000, branchId: 1, costCenter: 'branch:1' },
      { accountCode: '6100', debitIrr: 1000000, creditIrr: 0, branchId: 1, costCenter: 'branch:1' },
      { accountCode: '6200', debitIrr: 1000000, creditIrr: 0, branchId: 1, costCenter: 'branch:1' },
      { accountCode: '1210', debitIrr: 0, creditIrr: 2000000, branchId: 1, costCenter: 'branch:1' },
    ],
  }, 'accountant-1');
  const submitted = finance.submitDraft(db, entry.id, 'accountant-1');
  finance.decideApproval(db, submitted.approval.id, 'approved', 'owner-1');
  const actual = finance.actualBreakEvenFromLedger(db, { branchId: 1, from: '2026-08-01', to: '2026-08-31T23:59:59.999Z' });
  assert.equal(actual.status, 'available');
  assert.equal(actual.netSalesIrr, 10000000);
  assert.equal(actual.variableCostIrr, 4000000);
  assert.equal(actual.fixedCostIrr, 2000000);
  assert.equal(actual.breakEvenSalesIrr, 3333334);
  const misc = finance.createDraft(db, {
    date: '2026-08-24T13:00:00.000Z', branchId: 1, costCenter: 'branch:1', description: 'هزینه نیازمند طبقه‌بندی',
    lines: [
      { accountCode: '6990', debitIrr: 500000, creditIrr: 0, branchId: 1, costCenter: 'branch:1' },
      { accountCode: '1210', debitIrr: 0, creditIrr: 500000, branchId: 1, costCenter: 'branch:1' },
    ],
  }, 'accountant-2');
  const miscSubmitted = finance.submitDraft(db, misc.id, 'accountant-2');
  finance.decideApproval(db, miscSubmitted.approval.id, 'approved', 'owner-1');
  const partial = finance.actualBreakEvenFromLedger(db, { branchId: 1, from: '2026-08-01', to: '2026-08-31T23:59:59.999Z' });
  assert.equal(partial.status, 'partial_coverage');
  assert.equal(partial.official, false);
  assert.equal(partial.unclassified[0].accountCode, '6990');
  assert.equal(partial.coveragePercent, 92.31);
});

test('V2 procurement posts GRNI, matched AP and owner-approved supplier payment as one traceable chain', () => {
  const db = fixture();
  db.accounting.inventoryItems = [{ id: 'milk', name: 'شیر', unit: 'لیتر', qtyOnHand: 0, avgCostIrr: 0, branchId: 1 }];
  const po = finance.createPurchaseOrderV2(db, {
    branchId: 1, vendorId: 'vendor-1', issueDate: '2026-08-24T08:00:00.000Z',
    lines: [{ itemId: 'milk', description: 'شیر', quantity: 10, unit: 'لیتر', unitPriceIrr: 100000 }],
  }, 'accountant-1');
  const submitted = finance.submitPurchaseOrderV2(db, po.id, 'accountant-1');
  assert.throws(() => finance.decideApproval(db, submitted.approval.id, 'approved', 'accountant-1'), (error) => error.code === 'segregation_of_duties');
  finance.decideApproval(db, submitted.approval.id, 'approved', 'owner-1');
  assert.equal(po.status, 'approved');

  const received = finance.receiveGoodsV2(db, {
    purchaseOrderId: po.id, deliveryNoteNumber: 'DN-100', receivedAt: '2026-08-24T09:00:00.000Z',
    lines: [{ purchaseOrderLineId: po.lines[0].id, receivedQuantity: 10 }],
  }, 'warehouse-1');
  assert.equal(received.event.status, 'posted');
  assert.equal(received.journalEntry.debitIrr, 1000000);
  assert.equal(db.financeV2.inventoryMovements[0].quantityBase, 10);
  assert.equal(po.status, 'received');

  const invoiced = finance.createVendorInvoiceV2(db, {
    goodsReceiptId: received.goodsReceipt.id, invoiceNumber: 'INV-100', invoiceDate: '2026-08-24T10:00:00.000Z', vatIrr: 100000, totalIrr: 1100000,
    lines: [{ goodsReceiptLineId: received.goodsReceipt.lines[0].id, invoicedQuantity: 10, unitPriceIrr: 100000 }],
  }, 'accountant-1');
  assert.equal(invoiced.threeWayMatch.status, 'matched');
  assert.equal(invoiced.event.status, 'posted');
  assert.equal(invoiced.journalEntry.debitIrr, 1100000);

  const requested = finance.requestSupplierPaymentV2(db, invoiced.vendorInvoice.id, {
    amountIrr: 1100000, paymentMethod: 'bank', paymentDate: '2026-08-24T11:00:00.000Z', reference: 'BANK-100',
  }, 'accountant-1');
  const paid = finance.decideApproval(db, requested.approval.id, 'approved', 'owner-1');
  assert.equal(paid.supplierPayment.status, 'paid');
  assert.equal(paid.supplierPaymentEntry.debitIrr, 1100000);
  assert.equal(invoiced.vendorInvoice.status, 'paid');
  assert.equal(invoiced.vendorInvoice.paidAmountIrr, 1100000);
  assert.deepEqual(db.financeV2.journalEntries.map((row) => row.source), ['purchase.goods_received', 'purchase.vendor_invoice', 'purchase.supplier_payment']);
  assert.ok(db.financeV2.journalEntries.every((row) => row.debitIrr === row.creditIrr));
  assert.throws(() => finance.reverseEntry(db, invoiced.journalEntry.id, 'owner-1', 'ابطال فاکتور پس از پرداخت', '2026-08-24T12:00:00.000Z'), (error) => error.code === 'vendor_invoice_has_payment_activity');
  const paymentReversal = finance.reverseEntry(db, paid.supplierPaymentEntry.id, 'owner-1', 'برگشت پرداخت بانکی تأمین‌کننده', '2026-08-24T12:00:00.000Z');
  assert.equal(paid.supplierPayment.status, 'reversed');
  assert.equal(paid.supplierPayment.reversalJournalEntryId, paymentReversal.id);
  assert.equal(invoiced.vendorInvoice.paidAmountIrr, 0);
  assert.equal(invoiced.vendorInvoice.status, 'open');
  const invoiceReversal = finance.reverseEntry(db, invoiced.journalEntry.id, 'owner-1', 'اصلاح فاکتور تأمین‌کننده', '2026-08-24T13:00:00.000Z');
  assert.equal(invoiced.vendorInvoice.status, 'reversed');
  assert.equal(invoiced.vendorInvoice.reversalJournalEntryId, invoiceReversal.id);
  const corrected = finance.createVendorInvoiceV2(db, {
    goodsReceiptId: received.goodsReceipt.id, invoiceNumber: 'INV-100-CORRECTED', invoiceDate: '2026-08-24T14:00:00.000Z', vatIrr: 100000, totalIrr: 1100000,
    lines: [{ goodsReceiptLineId: received.goodsReceipt.lines[0].id, invoicedQuantity: 10, unitPriceIrr: 100000 }],
  }, 'accountant-1');
  assert.equal(corrected.vendorInvoice.status, 'open');
});

test('V2 procurement blocks over-receipt, duplicate invoice and three-way variance before AP posting', () => {
  const db = fixture();
  db.accounting.inventoryItems = [{ id: 'coffee', name: 'قهوه', unit: 'کیلوگرم', qtyOnHand: 0, avgCostIrr: 200000, branchId: 1 }];
  const po = finance.createPurchaseOrderV2(db, {
    branchId: 1, vendorId: 'vendor-1', lines: [{ itemId: 'coffee', quantity: 5, unit: 'کیلوگرم', unitPriceIrr: 200000 }],
  }, 'accountant-1');
  const submitted = finance.submitPurchaseOrderV2(db, po.id, 'accountant-1');
  finance.decideApproval(db, submitted.approval.id, 'approved', 'owner-1');
  assert.throws(() => finance.receiveGoodsV2(db, {
    purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: po.lines[0].id, receivedQuantity: 6 }],
  }, 'warehouse-1'), (error) => error.code === 'goods_receipt_over_quantity');
  const received = finance.receiveGoodsV2(db, {
    purchaseOrderId: po.id, deliveryNoteNumber: 'DN-200', lines: [{ purchaseOrderLineId: po.lines[0].id, receivedQuantity: 5 }],
  }, 'warehouse-1');
  const variance = finance.createVendorInvoiceV2(db, {
    goodsReceiptId: received.goodsReceipt.id, invoiceNumber: 'INV-200', vatIrr: 0,
    lines: [{ goodsReceiptLineId: received.goodsReceipt.lines[0].id, invoicedQuantity: 5, unitPriceIrr: 210000 }],
  }, 'accountant-1');
  assert.equal(variance.vendorInvoice.status, 'match_exception');
  assert.equal(variance.event.status, 'blocked');
  assert.equal(variance.event.error.code, 'three_way_match_variance');
  assert.equal(db.financeV2.journalEntries.filter((row) => row.source === 'purchase.vendor_invoice').length, 0);
  assert.throws(() => finance.requestSupplierPaymentV2(db, variance.vendorInvoice.id, { amountIrr: 1000, paymentMethod: 'bank' }, 'accountant-1'), (error) => error.code === 'three_way_match_required');
  const review = finance.requestVendorInvoiceMatchReview(db, variance.vendorInvoice.id, {
    reason: 'قیمت جدید تأمین‌کننده با مدرک بررسی شود', evidenceReference: 'QUOTE-200',
  }, 'accountant-1');
  assert.equal(review.approval.status, 'pending');
  assert.throws(() => finance.decideApproval(db, review.approval.id, 'approved', 'accountant-1', 'تأیید'), (error) => error.code === 'segregation_of_duties');
  assert.throws(() => finance.decideApproval(db, review.approval.id, 'approved', 'owner-1', ''), (error) => error.code === 'three_way_match_decision_comment_required');
  const accepted = finance.decideApproval(db, review.approval.id, 'approved', 'owner-1', 'قیمت با پیش‌فاکتور جدید تطبیق و تأیید شد');
  assert.equal(accepted.vendorInvoiceMatch.status, 'open');
  assert.equal(accepted.vendorInvoiceMatch.matchStatus, 'accepted_variance');
  assert.equal(accepted.vendorInvoiceEntry.status, 'posted');
  assert.equal(accepted.vendorInvoiceEntry.lines.find((line) => line.accountCode === '5150').debitIrr, 50000);
  assert.equal(variance.event.status, 'posted');
  assert.equal(finance.requestSupplierPaymentV2(db, variance.vendorInvoice.id, { amountIrr: 1000, paymentMethod: 'bank' }, 'accountant-1').supplierPayment.status, 'pending_approval');
  assert.throws(() => finance.createVendorInvoiceV2(db, {
    goodsReceiptId: received.goodsReceipt.id, invoiceNumber: 'INV-200', vatIrr: 0,
    lines: [{ goodsReceiptLineId: received.goodsReceipt.lines[0].id, invoicedQuantity: 5, unitPriceIrr: 200000 }],
  }, 'accountant-1'), (error) => error.code === 'vendor_invoice_duplicate');
});

test('rejected three-way variance remains immutable and releases receipt quantity for a corrected invoice', () => {
  const db = fixture();
  db.accounting.inventoryItems = [{ id: 'milk', name: 'شیر', unit: 'لیتر', qtyOnHand: 0, avgCostIrr: 100000, branchId: 1 }];
  const po = finance.createPurchaseOrderV2(db, {
    branchId: 1, vendorId: 'vendor-1', lines: [{ itemId: 'milk', quantity: 2, unit: 'لیتر', unitPriceIrr: 100000 }],
  }, 'accountant-1');
  const submitted = finance.submitPurchaseOrderV2(db, po.id, 'accountant-1');
  finance.decideApproval(db, submitted.approval.id, 'approved', 'owner-1');
  const received = finance.receiveGoodsV2(db, {
    purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: po.lines[0].id, receivedQuantity: 2 }],
  }, 'kitchen-1');
  const wrong = finance.createVendorInvoiceV2(db, {
    goodsReceiptId: received.goodsReceipt.id, invoiceNumber: 'WRONG-1',
    lines: [{ goodsReceiptLineId: received.goodsReceipt.lines[0].id, invoicedQuantity: 2, unitPriceIrr: 120000 }],
  }, 'accountant-1');
  const review = finance.requestVendorInvoiceMatchReview(db, wrong.vendorInvoice.id, { reason: 'قیمت فاکتور با قرارداد سازگار نیست' }, 'accountant-1');
  finance.decideApproval(db, review.approval.id, 'rejected', 'owner-1', 'فاکتور رد شد و باید اصلاح‌شده صادر شود');
  assert.equal(wrong.vendorInvoice.status, 'match_rejected');
  assert.equal(wrong.event.status, 'blocked');
  assert.equal(wrong.event.error.code, 'three_way_match_rejected');
  assert.equal(db.financeV2.journalEntries.filter((row) => row.source === 'purchase.vendor_invoice').length, 0);
  const corrected = finance.createVendorInvoiceV2(db, {
    goodsReceiptId: received.goodsReceipt.id, invoiceNumber: 'CORRECT-1',
    lines: [{ goodsReceiptLineId: received.goodsReceipt.lines[0].id, invoicedQuantity: 2, unitPriceIrr: 100000 }],
  }, 'accountant-2');
  assert.equal(corrected.vendorInvoice.status, 'open');
  assert.equal(corrected.event.status, 'posted');
});

test('multi-line procurement locks base units and prevents duplicate receipt or invoice rows', () => {
  const db = fixture();
  db.accounting.inventoryItems = [
    { id: 'milk', name: 'شیر', unit: 'لیتر', qtyOnHand: 0, avgCostIrr: 100000, branchId: 1 },
    { id: 'coffee', name: 'قهوه', unit: 'کیلوگرم', qtyOnHand: 0, avgCostIrr: 200000, branchId: 1 },
  ];
  assert.throws(() => finance.createPurchaseOrderV2(db, {
    branchId: 1, vendorId: 'vendor-1', lines: [{ itemId: 'milk', quantity: 1, unit: 'عدد', unitPriceIrr: 100000 }],
  }, 'accountant-1'), (error) => error.code === 'purchase_item_unit_mismatch');
  assert.throws(() => finance.createPurchaseOrderV2(db, {
    branchId: 1, vendorId: 'vendor-1', lines: [{ itemId: 'unknown', quantity: 1, unit: 'عدد', unitPriceIrr: 100000 }],
  }, 'accountant-1'), (error) => error.code === 'purchase_item_not_found');
  const po = finance.createPurchaseOrderV2(db, {
    branchId: 1, vendorId: 'vendor-1', lines: [
      { itemId: 'milk', quantity: 10, unit: 'لیتر', unitPriceIrr: 100000 },
      { itemId: 'coffee', quantity: 4, unit: 'کیلوگرم', unitPriceIrr: 200000 },
    ],
  }, 'accountant-1');
  assert.deepEqual(po.lines.map((line) => [line.itemId, line.unit]), [['milk', 'لیتر'], ['coffee', 'کیلوگرم']]);
  finance.decideApproval(db, finance.submitPurchaseOrderV2(db, po.id, 'accountant-1').approval.id, 'approved', 'owner-1');
  assert.throws(() => finance.receiveGoodsV2(db, {
    purchaseOrderId: po.id, lines: [
      { purchaseOrderLineId: po.lines[0].id, receivedQuantity: 5 },
      { purchaseOrderLineId: po.lines[0].id, receivedQuantity: 5 },
    ],
  }, 'warehouse-1'), (error) => error.code === 'goods_receipt_duplicate_purchase_order_line');
  assert.equal(db.financeV2.goodsReceipts.length, 0);
  const received = finance.receiveGoodsV2(db, {
    purchaseOrderId: po.id, lines: [
      { purchaseOrderLineId: po.lines[0].id, receivedQuantity: 10 },
      { purchaseOrderLineId: po.lines[1].id, receivedQuantity: 4 },
    ],
  }, 'warehouse-1');
  assert.equal(received.goodsReceipt.lines.length, 2);
  assert.throws(() => finance.createVendorInvoiceV2(db, {
    goodsReceiptId: received.goodsReceipt.id, invoiceNumber: 'MULTI-DUP', lines: [
      { goodsReceiptLineId: received.goodsReceipt.lines[0].id, invoicedQuantity: 5, unitPriceIrr: 100000 },
      { goodsReceiptLineId: received.goodsReceipt.lines[0].id, invoicedQuantity: 5, unitPriceIrr: 100000 },
    ],
  }, 'accountant-1'), (error) => error.code === 'vendor_invoice_duplicate_receipt_line');
  assert.equal(db.financeV2.vendorInvoices.length, 0);
  const invoice = finance.createVendorInvoiceV2(db, {
    goodsReceiptId: received.goodsReceipt.id, invoiceNumber: 'MULTI-OK', lines: [
      { goodsReceiptLineId: received.goodsReceipt.lines[0].id, invoicedQuantity: 5, unitPriceIrr: 100000 },
      { goodsReceiptLineId: received.goodsReceipt.lines[1].id, invoicedQuantity: 4, unitPriceIrr: 200000 },
    ],
  }, 'accountant-1');
  assert.equal(invoice.vendorInvoice.lines.length, 2);
  assert.equal(invoice.vendorInvoice.quantityCoverage, 'partial_invoice');
  assert.equal(invoice.vendorInvoice.unbilledReceiptQuantity, 5);
  assert.equal(invoice.vendorInvoice.status, 'open');
});

test('kitchen receiving queue exposes physical facts without prices or account codes', () => {
  const db = fixture();
  db.accounting.inventoryItems = [{ id: 'milk', name: 'شیر', unit: 'لیتر', qtyOnHand: 0, avgCostIrr: 100000, branchId: 1 }];
  db.accounting.vendors = [{ id: 'vendor-1', nameFa: 'لبنیات تست', branchId: 1 }];
  const po = finance.createPurchaseOrderV2(db, {
    branchId: 1, vendorId: 'vendor-1', expectedDate: '2026-08-25',
    lines: [{ itemId: 'milk', description: 'شیر تازه', quantity: 10, unit: 'لیتر', unitPriceIrr: 100000 }],
  }, 'accountant-1');
  const submitted = finance.submitPurchaseOrderV2(db, po.id, 'accountant-1');
  finance.decideApproval(db, submitted.approval.id, 'approved', 'owner-1');

  const queue = finance.kitchenInventory(db, { branchId: 1 });
  assert.equal(queue.summary.receivablePurchaseOrderLines, 1);
  assert.equal(queue.receivablePurchaseOrders[0].vendorName, 'لبنیات تست');
  assert.equal(queue.receivablePurchaseOrders[0].lines[0].remainingQuantity, 10);
  assert.equal(queue.policy.purchasePricesHiddenFromOperator, true);
  assert.doesNotMatch(JSON.stringify(queue.receivablePurchaseOrders), /unitPriceIrr|lineValueIrr|totalIrr|accountCode/);
  assert.throws(() => finance.receiveGoodsV2(db, {
    branchId: 2, purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: po.lines[0].id, receivedQuantity: 1 }],
  }, 'kitchen-1'), (error) => error.code === 'goods_receipt_branch_mismatch');
});

test('costing headlines and inventory components respect the requested reporting period', () => {
  const db = fixture();
  const state = finance.ensureFinanceV2(db);
  state.orderItemCostSnapshots.push(
    { id: 'aug-snapshot', branchId: 1, menuItemId: 'shake', itemName: 'شیرموز', quantity: 1, netSalesIrr: 300000, theoreticalCogsIrr: 100000, capturedAt: '2026-08-10T10:00:00.000Z' },
    { id: 'jul-snapshot', branchId: 1, menuItemId: 'shake', itemName: 'شیرموز', quantity: 2, netSalesIrr: 600000, theoreticalCogsIrr: 200000, capturedAt: '2026-07-10T10:00:00.000Z' },
  );
  state.inventoryMovements.push(
    { id: 'aug-sale', branchId: 1, itemId: 'milk', movementType: 'sale_consumption', quantityBase: -1, totalCostIrr: 100000, occurredAt: '2026-08-10T10:00:00.000Z' },
    { id: 'aug-waste', branchId: 1, itemId: 'milk', movementType: 'waste', quantityBase: -0.5, totalCostIrr: 50000, occurredAt: '2026-08-11T10:00:00.000Z' },
    { id: 'jul-sale', branchId: 1, itemId: 'milk', movementType: 'sale_consumption', quantityBase: -2, totalCostIrr: 200000, occurredAt: '2026-07-10T10:00:00.000Z' },
  );
  state.journalEntries.push(
    { id: 'aug-cogs', source: 'order.cogs', sourceId: 'aug', branchId: 1, status: 'posted', debitIrr: 100000, creditIrr: 100000, date: '2026-08-10T10:00:00.000Z', lines: [] },
    { id: 'jul-cogs', source: 'order.cogs', sourceId: 'jul', branchId: 1, status: 'posted', debitIrr: 200000, creditIrr: 200000, date: '2026-07-10T10:00:00.000Z', lines: [] },
  );
  const august = finance.costingInventory(db, { branchId: 1, from: '2026-08-01', to: '2026-08-31T23:59:59.999Z' });
  assert.equal(august.theoreticalCogs.amountIrr, 100000);
  assert.equal(august.actualConsumption.amountIrr, 150000);
  assert.equal(august.actualConsumption.postedCogsIrr, 100000);
  assert.deepEqual(august.actualConsumption.components, { theoreticalSaleConsumptionIrr: 100000, wasteIrr: 50000, negativeCountAdjustmentIrr: 0 });
  assert.equal(august.itemProfitability.rows[0].theoreticalGrossProfitIrr, 200000);
  assert.equal(august.itemProfitability.rows[0].theoreticalGrossMarginPercent, 66.67);
});

test('break-even dashboard keeps user planning costs outside the ledger and projects a dated crossing from posted contribution', () => {
  const db = fixture();
  const planResult = finance.upsertBreakEvenPlan(db, {
    branchId: 1,
    name: 'برنامه مرداد',
    startDate: '2026-08-01',
    deadlineDate: '2026-08-31',
    deadlineConfirmed: true,
    assumptions: [
      { id: 'rent', name: 'اجاره', categoryCode: 'rent', monthlyAmountIrr: 8_000_000_000 },
      { id: 'payroll', name: 'حقوق', categoryCode: 'payroll', monthlyAmountIrr: 4_500_000_000, headcount: 10, salaryPerPersonIrr: 450_000_000 },
      { id: 'utilities', name: 'آب و برق و گاز', categoryCode: 'utilities', monthlyAmountIrr: 300_000_000 },
    ],
  }, 'owner-1');
  assert.equal(planResult.plan.monthlyFixedCostIrr, 12_800_000_000);
  assert.equal(planResult.plan.deadline.isConfirmed, true);
  assert.equal(finance.ensureFinanceV2(db).journalEntries.length, 0);

  const state = finance.ensureFinanceV2(db);
  state.journalEntries.push(...Array.from({ length: 10 }, (_, index) => ({
    id: `break-even-ledger-${index + 1}`,
    branchId: 1,
    status: 'posted',
    date: `2026-08-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
    lines: [
      { accountCode: '4110', debitIrr: 0, creditIrr: 1_000_000_000 },
      { accountCode: '5100', debitIrr: 400_000_000, creditIrr: 0 },
    ],
  })));

  const dashboard = finance.breakEvenDashboard(db, { branchId: 1, asOfDate: '2026-08-10' });
  assert.equal(dashboard.status, 'available');
  assert.equal(dashboard.plan.actualRecord, false);
  assert.equal(dashboard.dataSources.selected.type, 'posted_ledger');
  assert.equal(dashboard.projection.fixedCostTotalIrr, 12_800_000_000);
  assert.equal(dashboard.projection.breakEvenSalesIrr, 21_333_333_334);
  assert.ok(dashboard.projection.forecast.breakEvenDate > '2026-08-10');
  assert.equal(dashboard.chart.series.some((row) => row.isForecast), true);
  assert.equal(dashboard.chart.deadline, '2026-08-31');
  const branchWithoutPlan = finance.breakEvenDashboard(db, { branchId: 2, asOfDate: '2026-08-10' });
  assert.equal(branchWithoutPlan.status, 'needs_plan');
  assert.equal(branchWithoutPlan.dataSources.candidates.length, 2);
});

test('break-even dashboard can use recipe-cost snapshots only when they carry both sales and covered COGS', () => {
  const db = fixture();
  finance.upsertBreakEvenPlan(db, {
    branchId: 1, startDate: '2026-08-01', deadlineDate: '2026-08-31', deadlineConfirmed: true,
    assumptions: [{ id: 'rent', name: 'اجاره', categoryCode: 'rent', monthlyAmountIrr: 8_000_000_000 }],
  }, 'owner-1');
  const state = finance.ensureFinanceV2(db);
  state.orderItemCostSnapshots.push(
    { id: 'snapshot-1', branchId: 1, capturedAt: '2026-08-01T12:00:00.000Z', netSalesIrr: 1_000_000_000, theoreticalCogsIrr: 400_000_000 },
    { id: 'snapshot-2', branchId: 1, capturedAt: '2026-08-02T12:00:00.000Z', netSalesIrr: 1_000_000_000, theoreticalCogsIrr: 400_000_000 },
  );
  const dashboard = finance.breakEvenDashboard(db, { branchId: 1, asOfDate: '2026-08-02' });
  assert.equal(dashboard.status, 'available');
  assert.equal(dashboard.dataSources.selected.type, 'recipe_cost_snapshots');
  assert.equal(dashboard.dataSources.selected.official, false);

  state.orderItemCostSnapshots[1].theoreticalCogsIrr = 0;
  state.orderItemCostSnapshots[0].theoreticalCogsIrr = 0;
  const incomplete = finance.breakEvenDashboard(db, { branchId: 1, asOfDate: '2026-08-02' });
  assert.equal(incomplete.status, 'insufficient_data');
  assert.ok(incomplete.projection.missing.includes('variable_cost'));
});

test('break-even plan route persists an idempotent, branch-scoped planning baseline', async () => {
  const db = fixture();
  let saves = 0;
  const routes = financeRouteHarness(db, async () => { saves += 1; }, 'accountant');
  const handler = routes.get('POST /api/admin/v2/finance/planning/break-even/plans');
  const body = {
    branchId: 1, startDate: '2026-08-01', deadlineDate: '2026-08-31', deadlineConfirmed: true,
    assumptions: [{ id: 'rent', name: 'اجاره', categoryCode: 'rent', monthlyAmountIrr: 8_000_000_000 }],
  };
  const first = financeResponse();
  await handler(financeRequest({ key: 'break-even-plan-route', body }), first);
  assert.equal(first.statusCode, 201);
  assert.equal(first.body.data.plan.branchId, 1);
  assert.equal(first.body.data.plan.actualRecord, false);
  assert.equal(saves, 1);

  const replay = financeResponse();
  await handler(financeRequest({ key: 'break-even-plan-route', body }), replay);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.data.idempotentReplay, true);
  assert.equal(finance.ensureFinanceV2(db).breakEvenPlans.length, 1);
});

test('break-even plan refuses to persist an unconfirmed suggested deadline', () => {
  const db = fixture();
  assert.throws(() => finance.upsertBreakEvenPlan(db, {
    branchId: 1,
    startDate: '2026-08-01',
    deadlineDate: '2026-08-31',
    assumptions: [{ id: 'rent', name: 'اجاره', categoryCode: 'rent', monthlyAmountIrr: 8_000_000_000 }],
  }, 'owner-1'), (error) => error.code === 'break_even_plan_deadline_confirmation_required');
  assert.equal(finance.ensureFinanceV2(db).breakEvenPlans.length, 0);
});

test('costing workspace turns weekday stockout forecast and approved inbound into a reorder action', () => {
  const db = fixture();
  db.accounting.inventoryItems = [{
    id: 'milk', name: 'شیر', unit: 'لیتر', qtyOnHand: 5, avgCostIrr: 100000, branchId: 1,
    leadTimeDays: 3, safetyDays: 1, minStock: 2,
  }];
  db.accounting.recipes = [{
    id: 'latte-v1', menuItemId: 'latte', name: 'لاته', version: 1, branchId: 1,
    effectiveFrom: '2026-08-01T00:00:00.000Z', servings: 1,
    ingredients: [{ itemId: 'milk', qty: 250, unit: 'میلی‌لیتر', quantityBasis: 'raw' }],
  }];
  db.orders = Array.from({ length: 28 }, (_, index) => ({
    id: index + 1, branchId: 1, status: 'done', paymentStatus: 'paid',
    createdAt: new Date(Date.UTC(2026, 7, index + 1, 12)).toISOString(),
    items: [{ menuItemId: 'latte', qty: 4 }],
  }));
  finance.ensureFinanceV2(db).purchaseOrders.push({
    id: 'po-milk', number: 'PO-MILK', branchId: 1, status: 'partially_received', expectedDate: '2026-08-30',
    lines: [{ itemId: 'milk', quantity: 5, receivedQuantity: 2, unit: 'لیتر' }],
  });
  const costing = finance.costingInventory(db, { branchId: 1 });
  const action = costing.stockoutActions.find((row) => row.itemId === 'milk');
  assert.equal(action.forecastDate, '2026-09-05');
  assert.equal(action.reorderByDate, '2026-09-01');
  assert.equal(action.actionStatus, 'scheduled');
  assert.equal(action.inboundUsedInSuggestion, 3);
  assert.equal(action.suggestedOrderQuantity, 5);
});

test('finance UI wires journal, event, approval and fiscal-period mutations with idempotency', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin-accounting.js'), 'utf8');
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /fin-journal-form/);
  assert.match(source, /data-fin-capture-order/);
  assert.match(source, /data-fin-retry-ready-cogs/);
  assert.match(source, /events\/cogs\/retry-ready/);
  assert.match(source, /data-fin-event-tender-amount/);
  assert.match(source, /REVIEW_TENDERS/);
  assert.match(source, /data-fin-approval-decision/);
  assert.match(source, /data-fin-close-period/);
  assert.match(source, /fin-po-form/);
  assert.match(source, /data-fin-po-lines/);
  assert.match(source, /data-fin-add-po-row/);
  assert.doesNotMatch(source, /fin-grn-form/);
  assert.match(source, /\/admin\/kitchen\?view=inventory/);
  assert.match(source, /fin-invoice-form/);
  assert.match(source, /data-fin-invoice-lines/);
  assert.match(source, /data-fin-add-invoice-row/);
  assert.match(source, /fin-break-even-plan-form/);
  assert.match(source, /fin-break-even-chart/);
  assert.match(source, /deadlineConfirmed/);
  assert.match(source, /fin-break-even-readiness/);
  assert.match(source, /planning\/break-even\/plans/);
  assert.match(source, /WestoBreakEvenChart/);
  assert.match(source, /getISOValue\(form\.elements\.startDate\)/);
  assert.match(source, /getISOValue\(form\.elements\.deadlineDate\)/);
  assert.match(source, /data-fin-request-match-review/);
  assert.match(source, /vendor-invoices\/\$\{encodeURIComponent\(button\.dataset\.finRequestMatchReview\)\}\/match-review/);
  assert.match(source, /fin-supplier-payment-form/);
  assert.match(source, /fin-refund-form/);
  assert.match(source, /refund-requests/);
  assert.match(source, /fin-settlement-form/);
  assert.match(source, /reconciliation\/settlements/);
  assert.match(source, /fin-bank-line-form/);
  assert.match(source, /reconciliation\/bank-statement-lines/);
  assert.match(source, /fin-cost-commitment-form/);
  assert.match(source, /fin-cost-accrual-form/);
  assert.match(source, /fin-cost-payment-form/);
  assert.match(source, /cost-commitments/);
  assert.match(source, /fin-fixed-asset-form/);
  assert.match(source, /fin-depreciation-form/);
  assert.match(source, /depreciation-runs\/preview/);
  assert.match(source, /\/api\/admin\/v2\/finance\/fixed-assets/);
  assert.match(source, /fin-payroll-run-form/);
  assert.match(source, /fin-payroll-payment-form/);
  assert.match(source, /payroll-runs\/preview/);
  assert.match(source, /payroll-runs\/\$\{encodeURIComponent\(values\.payrollRunId\)\}\/payment-request/);
  assert.match(source, /fin-opening-balance-form/);
  assert.match(source, /opening-balances\/preview/);
  assert.match(source, /\/api\/admin\/v2\/finance\/opening-balances/);
  assert.match(source, /data-fin-reverse-opening/);
  assert.match(source, /data-fin-cutover-request/);
  assert.match(source, /rollout\/\$\{encodeURIComponent\(state\.query\.branchId/);
  assert.match(source, /activate_finance_branch_cutover/);
  assert.match(source, /vendor-invoices\/\$\{encodeURIComponent\(values\.vendorInvoiceId\)\}\/payment-request/);
  assert.match(source, /migration\/classify/);
  assert.match(source, /خط مبنای انتقال داده/);
  assert.match(source, /migrationReadiness/);
  assert.match(source, /data-fin-event-evidence/);
  assert.match(source, /data-fin-legacy-decision/);
  assert.match(source, /backfill-preview/);
  assert.match(source, /backfill-request/);
  assert.match(source, /data-fin-legacy-tender/);
  assert.match(source, /fin-quick-guide/);
  assert.match(source, /آماده انتشار نیست/);
  assert.match(source, /gateValue\(gate\)/);
  assert.match(source, /financeSourceLabel\(row\.source\)/);
  assert.match(source, /dateOnly\(row\.startDate\).*dateOnly\(row\.endDate\)/);
  assert.match(source, /\/admin\/cashier\?view=drawer/);
  assert.doesNotMatch(source, />خروجی CSV</);
  assert.doesNotMatch(source, /یا backfill/);
  assert.doesNotMatch(source, /مرحلهٔ اجرا: Shadow/);
  assert.doesNotMatch(source, /بدون clamp منفی/);
});

test('PostgreSQL migration includes idempotency, settlement and depreciation uniqueness controls', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'server', 'migrations', '002_finance_v2.sql'), 'utf8');
  assert.match(sql, /idempotency_key TEXT NOT NULL UNIQUE/);
  assert.match(sql, /finance_settlement_batch_unique/);
  assert.match(sql, /finance_depreciation_asset_period_unique/);
  assert.match(sql, /CHECK \(status NOT IN \('posted','reversed'\)/);
  assert.match(sql, /decided_by IS NULL OR decided_by <> created_by/);
  assert.match(sql, /finance_journal_lines_immutable_guard/);
  assert.match(sql, /posted_journal_lines_are_immutable_use_reversal/);
  const settlementScopeSql = fs.readFileSync(path.join(__dirname, '..', 'server', 'migrations', '018_branch_scoped_settlement_uniqueness.sql'), 'utf8');
  assert.match(settlementScopeSql, /DROP INDEX IF EXISTS finance_settlement_batch_unique/);
  assert.match(settlementScopeSql, /ON reconciliation_items \(branch_id, psp, terminal_id, batch_no\)/);
  const inventorySql = fs.readFileSync(path.join(__dirname, '..', 'server', 'migrations', '004_inventory_operations.sql'), 'utf8');
  assert.match(inventorySql, /finance_inventory_movement_valuations/);
  assert.match(inventorySql, /finance_inventory_movement_single_reversal_idx/);
  assert.match(inventorySql, /inventory_movement_valuations_are_immutable/);
  assert.match(inventorySql, /production_batches_are_immutable_use_reversal/);
  const bankSql = fs.readFileSync(path.join(__dirname, '..', 'server', 'migrations', '005_bank_reconciliation.sql'), 'utf8');
  assert.match(bankSql, /finance_bank_statement_reference_unique/);
  assert.match(bankSql, /finance_bank_statement_journal_account_unique/);
  assert.match(bankSql, /finance_bank_statement_line_shape_check/);
  const recurringSql = fs.readFileSync(path.join(__dirname, '..', 'server', 'migrations', '006_recurring_costs.sql'), 'utf8');
  assert.match(recurringSql, /finance_cost_commitments/);
  assert.match(recurringSql, /finance_cost_accrual_active_month_unique/);
  const assetSql = fs.readFileSync(path.join(__dirname, '..', 'server', 'migrations', '007_fixed_assets.sql'), 'utf8');
  assert.match(assetSql, /finance_fixed_assets/);
  assert.match(assetSql, /finance_asset_depreciation_period_unique/);
  assert.match(assetSql, /accumulated_depreciation_irr <= purchase_cost_irr - salvage_value_irr/);
  const payrollSql = fs.readFileSync(path.join(__dirname, '..', 'server', 'migrations', '008_payroll_batches.sql'), 'utf8');
  assert.match(payrollSql, /finance_payroll_branch_month_unique/);
  assert.match(payrollSql, /accountant_confirmed_totals_no_automatic_statutory_rate/);
  assert.match(payrollSql, /net_pay_irr = total_gross_irr - employee_insurance_irr - payroll_tax_irr - other_deductions_irr/);
  assert.match(payrollSql, /finance_payroll_payment_ceiling_trigger/);
  const archiveSql = fs.readFileSync(path.join(__dirname, '..', 'server', 'migrations', '009_legacy_archive_decisions.sql'), 'utf8');
  assert.match(archiveSql, /approved_for_backfill/);
  assert.match(archiveSql, /finance_legacy_archive_quarantine_check/);
  assert.match(archiveSql, /decision_history JSONB/);
  const backfillSql = fs.readFileSync(path.join(__dirname, '..', 'server', 'migrations', '010_legacy_order_backfill.sql'), 'utf8');
  assert.match(backfillSql, /finance_legacy_archive_backfill_chain_check/);
  assert.match(backfillSql, /finance_legacy_archive_backfill_journal_unique/);
  assert.match(backfillSql, /finance_legacy_archive_backfill_reversal_unique/);
  assert.match(backfillSql, /backfill_reversal_journal_entry_id/);
  assert.match(backfillSql, /reviewed_tenders JSONB/);
  const openingSql = fs.readFileSync(path.join(__dirname, '..', 'server', 'migrations', '011_opening_balances.sql'), 'utf8');
  assert.match(openingSql, /finance_opening_balance_batches/);
  assert.match(openingSql, /finance_opening_balance_one_active_branch/);
  assert.match(openingSql, /finance_opening_balance_lines_valid/);
  assert.match(openingSql, /opening_balance_batches_are_immutable_use_reversal/);
  const rolloutSql = fs.readFileSync(path.join(__dirname, '..', 'server', 'migrations', '012_branch_finance_rollout.sql'), 'utf8');
  assert.match(rolloutSql, /finance_branch_rollouts/);
  assert.match(rolloutSql, /finance_branch_rollout_one_active_request/);
  assert.match(rolloutSql, /finance_branch_rollout_history_is_immutable/);
  const baselineSql = fs.readFileSync(path.join(__dirname, '..', 'server', 'migrations', '013_finance_migration_baselines.sql'), 'utf8');
  assert.match(baselineSql, /finance_migration_baselines/);
  assert.match(baselineSql, /finance_migration_baseline_one_active/);
  assert.match(baselineSql, /finance_migration_baseline_history_is_immutable/);
  assert.match(baselineSql, /source_count = jsonb_array_length\(source_keys\)/);
  const procurementImmutabilitySql = fs.readFileSync(path.join(__dirname, '..', 'server', 'migrations', '014_procurement_document_immutability.sql'), 'utf8');
  assert.match(procurementImmutabilitySql, /goods_receipts_are_immutable_use_reversal/);
  assert.match(procurementImmutabilitySql, /vendor_invoice_financial_fields_are_immutable_use_reversal/);
  const requestIdempotencySql = fs.readFileSync(path.join(__dirname, '..', 'server', 'migrations', '015_finance_request_idempotency.sql'), 'utf8');
  assert.match(requestIdempotencySql, /finance_idempotency_requests/);
  assert.match(requestIdempotencySql, /request_sha256 CHAR\(64\)/);
  assert.match(requestIdempotencySql, /finance_idempotency_requests_are_immutable/);
  const procurementReversalSql = fs.readFileSync(path.join(__dirname, '..', 'server', 'migrations', '016_procurement_reversals.sql'), 'utf8');
  assert.match(procurementReversalSql, /finance_vendor_invoice_reversal_chain_check/);
  assert.match(procurementReversalSql, /finance_vendor_payment_reversal_chain_check/);
  assert.match(procurementReversalSql, /vendor_payments_are_immutable_use_reversal/);
  const recipeWorkflowSql = fs.readFileSync(path.join(__dirname, '..', 'server', 'migrations', '017_recipe_version_workflow.sql'), 'utf8');
  assert.match(recipeWorkflowSql, /pending_approval/);
  assert.match(recipeWorkflowSql, /finance_recipe_segregation_of_duties/);
  assert.match(recipeWorkflowSql, /finance_recipe_ingredient_append_only/);
  assert.match(recipeWorkflowSql, /finance_recipe_version_delete_forbidden/);
  assert.match(openingSql, /code_value = '3900'/);
  const chartSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'accounting-engine.js'), 'utf8');
  assert.match(chartSource, /code: '2120'.*کالای دریافت‌شده و فاکتورنشده/);
  const migrationRunner = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'migrate-finance-v2-postgres.js'), 'utf8');
  assert.match(migrationRunner, /0\[1-9\]\\d/);
  assert.doesNotMatch(migrationRunner, /\^00\[2-9\]_/);
  const concurrencyVerifier = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'verify-finance-v2-concurrency.js'), 'utf8');
  assert.match(concurrencyVerifier, /FINANCE_CONCURRENCY_DISPOSABLE/);
  assert.match(concurrencyVerifier, /fiscal period overlap/);
  assert.match(concurrencyVerifier, /legacy backfill journal link/);
  assert.match(recurringSql, /finance_cost_payments/);
});

test('10,000 paid orders remain paginated and preserve exact reconciliation totals', () => {
  const db = fixture();
  db.orders = Array.from({ length: 10000 }, (_, index) => paidOrder({
    id: index + 1, orderNo: `W-${index + 1}`, total: 1000,
    partialPayments: [{ id: 1, tender: 'card', amount: 1000, at: '2026-08-24T10:03:00.000Z' }],
  }));
  const data = finance.salesCashBank(db, { branchId: 1, page: 400, pageSize: 25 });
  assert.equal(data.orders.length, 25);
  assert.deepEqual(data.pagination, { page: 400, pageSize: 25, total: 10000, pages: 400 });
  assert.equal(data.summary.operational.salesIrr, 100000000);
});

test('empty cost and forecast history stays explicit instead of seeding or estimating', () => {
  const acc = {};
  inventoryEngine.ensureInventory(acc);
  assert.deepEqual(acc.inventoryItems, []);
  assert.deepEqual(acc.recipes, []);
  const matrix = inventoryEngine.getMenuEngineeringMatrix(acc, { orders: [] });
  assert.equal(matrix.sufficientHistory, false);
  const forecast = predictiveEngine.getPredictiveAnalytics({ accounting: { accounts: [], journalEntries: [], expenses: [] }, orders: [] });
  assert.equal(forecast.projected30DayRevenue, null);
  assert.equal(forecast.forecastConfidence, null);
  assert.equal(forecast.runwayMonths, null);
});

test('legacy finance read models no longer invent Z-report, KPI, tip or subrecipe data', () => {
  const db = fixture();
  const kpis = accountingEngine.salesPosEngine.calculateRestaurantKPIs(db, { branchId: 1 });
  assert.equal(kpis.revenue, 0);
  assert.equal(kpis.checksCount, 0);
  assert.equal(kpis.averageCheck, null);
  assert.equal(kpis.foodCost, null);
  assert.equal(kpis.primeCostStatus, 'INSUFFICIENT_DATA');
  assert.equal(kpis.tableTurnover, null);
  const z = accountingEngine.salesPosEngine.generateZReport(db, { branchId: 1, businessDate: '2026-08-24' }, {
    ensureAccountingDataFn: accountingEngine.ensureAccountingData,
  });
  assert.equal(z.totalGrossSales, 0);
  assert.equal(z.checksCount, 0);
  assert.equal(z.guestsCount, null);
  assert.equal(z.totalVat, 0);
  assert.equal(z.totalTips, 0);
  assert.equal(z.status, 'INSUFFICIENT_DATA');
  assert.equal(z.journalEntryId, null);
  const routesSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'accounting-routes.js'), 'utf8');
  assert.doesNotMatch(routesSource, /Math\.max\(0, 1850000\)/);
  assert.doesNotMatch(routesSource, /acc\.subRecipes\s*=\s*\[\s*\{/);
});
