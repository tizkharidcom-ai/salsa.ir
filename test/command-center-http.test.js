'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const financeV2 = require('../server/finance-v2');

const runHttpTests = process.env.RUN_HTTP_TESTS === 'true';

if (!runHttpTests) {
  test('command center HTTP workflow (opt-in)', { skip: 'Set RUN_HTTP_TESTS=true to run the local-port integration test.' }, () => {});
} else {
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'westo-command-center-'));
const dbPath = path.join(tempDir, 'db.json');
const secretPath = path.join(tempDir, 'secret.key');
const seed = JSON.parse(JSON.stringify(require('../server/seed')));
seed.branches.push({ id: 2, name: 'شعبه دوم تست', slug: 'branch-2-test', active: true });
seed.users = [
  { phone: '09374333028', name: 'مالک تست', email: '', role: 'owner', points: 0, createdAt: new Date().toISOString(), blocked: false },
  { phone: '09150000002', name: 'صندوق تست', email: '', role: 'cashier', points: 0, createdAt: new Date().toISOString(), blocked: false },
  { phone: '09150000003', name: 'گارسون تست', email: '', role: 'waiter', points: 0, createdAt: new Date().toISOString(), blocked: false },
  { phone: '09150000001', name: 'آشپز تست', email: '', role: 'kitchen', points: 0, createdAt: new Date().toISOString(), blocked: false },
  { phone: '09150000004', name: 'حسابدار تست', email: '', role: 'accountant', allowedBranchIds: [1], points: 0, createdAt: new Date().toISOString(), blocked: false },
];
seed.accounting = {
  ...(seed.accounting || {}),
  inventoryItems: [{ id: 'test-milk', sku: 'TEST-MILK', name: 'شیر تست', unit: 'لیتر', qtyOnHand: 10, minStock: 2, avgCostIrr: 100000, branchId: 1 }],
  recipes: [], inventoryTransactions: [], wasteLog: [],
  journalEntries: [{ id: 'legacy-test-journal', number: 'TEST-LEGACY', description: 'سند آزمایشی مهاجرت', date: '2026-08-02' }],
  settlements: [], cashDrawers: [],
  fiscalPeriods: [{ id: 'test-period', name: 'دوره تست HTTP', startDate: '2026-08-01', endDate: '2026-08-31', status: 'open' }],
};
seed.orders = Array.isArray(seed.orders) ? seed.orders : [];
seed.orders.push({
  id: 900001, orderNo: 'LEGACY-HTTP-1', branchId: 1, status: 'paid', paymentStatus: 'paid', fulfillment: 'pickup',
  total: 100000, partialPayments: [{ id: 'legacy-pay-1', tender: 'card', amount: 100000, at: '2026-08-02T10:00:00.000Z' }],
  createdAt: '2026-08-02T09:55:00.000Z', paidAt: '2026-08-02T10:00:00.000Z', items: [],
});
fs.writeFileSync(dbPath, JSON.stringify(seed));

process.env.WESTO_DB_PATH = dbPath;
process.env.WESTO_SECRET_PATH = secretPath;
process.env.PORT = '0';
process.env.NODE_ENV = 'test';

const { startServer, db: serverDb } = require('../server/server');

async function json(base, url, { method = 'GET', body, cookie, headers = {} } = {}) {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { response, body: await response.json() };
}

async function login(base, phone) {
  const otp = await json(base, '/api/auth/request-otp', { method: 'POST', body: { phone } });
  assert.equal(otp.response.status, 200);
  const verified = await json(base, '/api/auth/verify-otp', { method: 'POST', body: { phone, code: otp.body.code } });
  assert.equal(verified.response.status, 200);
  return verified.response.headers.get('set-cookie').split(';')[0];
}

test('command center enforces roles and the kitchen transition boundary', async (t) => {
  const server = await startServer();
  t.after(async () => {
    // Let the 50ms atomic snapshot debounce flush before removing its sandbox.
    await new Promise((resolve) => setTimeout(resolve, 80));
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const ownerCookie = await login(base, '09374333028');
  const cashierCookie = await login(base, '09150000002');
  const waiterCookie = await login(base, '09150000003');
  const kitchenCookie = await login(base, '09150000001');
  const accountantCookie = await login(base, '09150000004');

  const branchDenied = await json(base, '/api/admin/v2/finance/migration/archive?branchId=2', { cookie: accountantCookie });
  assert.equal(branchDenied.response.status, 403);
  assert.equal(branchDenied.body.error, 'branch_access_denied', JSON.stringify(branchDenied.body));
  const malformedJson = await fetch(`${base}/api/admin/v2/finance/fiscal-periods`, {
    method: 'POST', headers: { Cookie: accountantCookie, 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(malformedJson.status, 400);
  assert.equal((await malformedJson.json()).error, 'invalid_json');

  const migrationClassify = await json(base, '/api/admin/v2/finance/migration/classify', {
    method: 'POST', cookie: accountantCookie, headers: { 'Idempotency-Key': 'http-legacy-classify-1' }, body: {},
  });
  assert.equal(migrationClassify.response.status, 201, JSON.stringify(migrationClassify.body));
  assert.equal(migrationClassify.body.data.policy.postingsPerformed, 0);
  assert.ok(migrationClassify.body.data.archive.total > 0);
  const migrationReplay = await json(base, '/api/admin/v2/finance/migration/classify', {
    method: 'POST', cookie: accountantCookie, headers: { 'Idempotency-Key': 'http-legacy-classify-1' }, body: {},
  });
  assert.equal(migrationReplay.response.status, 200);
  assert.equal(migrationReplay.body.data.idempotentReplay, true);
  const migrationArchive = await json(base, '/api/admin/v2/finance/migration/archive?pageSize=100', { cookie: accountantCookie });
  assert.equal(migrationArchive.response.status, 200);
  const reviewableLegacy = migrationArchive.body.data.find((row) => row.trustStatus !== 'quarantined');
  assert.ok(reviewableLegacy);
  const accountantCannotApproveBackfill = await json(base, `/api/admin/v2/finance/migration/archive/${reviewableLegacy.id}/decision`, {
    method: 'POST', cookie: accountantCookie, headers: { 'Idempotency-Key': 'http-legacy-decision-denied' },
    body: { decision: 'approved_for_backfill', decisionNotes: 'مدرک کنترل شد', evidenceReference: 'POS-HTTP-1' },
  });
  assert.equal(accountantCannotApproveBackfill.response.status, 403);
  assert.equal(accountantCannotApproveBackfill.body.error.code, 'legacy_backfill_approver_required');
  const ownerApprovedBackfill = await json(base, `/api/admin/v2/finance/migration/archive/${reviewableLegacy.id}/decision`, {
    method: 'POST', cookie: ownerCookie, headers: { 'Idempotency-Key': 'http-legacy-decision-owner' },
    body: { decision: 'approved_for_backfill', decisionNotes: 'رسید و مبلغ منبع عملیاتی تطبیق شد', evidenceReference: 'POS-HTTP-1' },
  });
  assert.equal(ownerApprovedBackfill.response.status, 200);
  assert.equal(ownerApprovedBackfill.body.data.record.decision, 'approved_for_backfill');
  assert.equal(ownerApprovedBackfill.body.data.policy.automaticBackfill, false);
  const backfillPreview = await json(base, `/api/admin/v2/finance/migration/archive/${reviewableLegacy.id}/backfill-preview`, {
    method: 'POST', cookie: accountantCookie, body: {},
  });
  assert.equal(backfillPreview.response.status, 200);
  assert.equal(backfillPreview.body.data.ready, true);
  assert.equal(backfillPreview.body.data.policy.journalPosted, false);
  const backfillRequest = await json(base, `/api/admin/v2/finance/migration/archive/${reviewableLegacy.id}/backfill-request`, {
    method: 'POST', cookie: accountantCookie, headers: { 'Idempotency-Key': 'http-legacy-backfill-request' }, body: {},
  });
  assert.equal(backfillRequest.response.status, 201);
  assert.equal(backfillRequest.body.data.entry.status, 'pending_approval');
  const backfillApproval = await json(base, `/api/admin/v2/finance/approvals/${backfillRequest.body.data.approval.id}/decision`, {
    method: 'POST', cookie: ownerCookie, headers: { 'Idempotency-Key': 'http-legacy-backfill-post' }, body: { decision: 'approved', comment: 'بازسازی کنترل‌شده تأیید شد' },
  });
  assert.equal(backfillApproval.response.status, 200);
  assert.equal(backfillApproval.body.data.entry.source, 'order.paid');
  assert.equal(backfillApproval.body.data.legacyBackfill.backfillStatus, 'posted');
  assert.equal(backfillApproval.body.data.legacyBackfillEvent.status, 'posted');
  const quarantinedLegacy = migrationArchive.body.data.find((row) => row.trustStatus === 'quarantined');
  assert.ok(quarantinedLegacy);
  const quarantineCannotBackfill = await json(base, `/api/admin/v2/finance/migration/archive/${quarantinedLegacy.id}/decision`, {
    method: 'POST', cookie: ownerCookie, headers: { 'Idempotency-Key': 'http-legacy-quarantine-denied' },
    body: { decision: 'approved_for_backfill', decisionNotes: 'نباید مجاز شود', evidenceReference: 'X-1' },
  });
  assert.equal(quarantineCannotBackfill.response.status, 409);
  assert.equal(quarantineCannotBackfill.body.error.code, 'quarantined_backfill_forbidden');

  const ownerDashboard = await json(base, '/api/admin/command-center', { cookie: ownerCookie });
  assert.equal(ownerDashboard.response.status, 200);
  const kitchenDashboard = await json(base, '/api/admin/command-center', { cookie: kitchenCookie });
  assert.equal(kitchenDashboard.response.status, 403);
  const waiterDashboard = await json(base, '/api/admin/command-center', { cookie: waiterCookie });
  assert.equal(waiterDashboard.response.status, 403);

  assert.equal((await json(base, '/api/staff/session/cashier', { cookie: cashierCookie })).response.status, 200);
  assert.equal((await json(base, '/api/staff/session/waiter', { cookie: waiterCookie })).response.status, 200);
  assert.equal((await json(base, '/api/staff/session/kitchen', { cookie: kitchenCookie })).response.status, 200);
  assert.equal((await json(base, '/api/staff/session/cashier', { cookie: waiterCookie })).response.status, 403);

  const kitchenInventory = await json(base, '/api/kitchen/inventory?branchId=1', { cookie: kitchenCookie });
  assert.equal(kitchenInventory.response.status, 200);
  assert.equal(kitchenInventory.body.data.items[0].availableQuantity, 10);
  assert.equal(kitchenInventory.body.data.policy.financialAccountsHiddenFromOperator, true);
  assert.equal((await json(base, '/api/kitchen/inventory?branchId=1', { cookie: cashierCookie })).response.status, 403);
  const wasteHeaders = { 'Idempotency-Key': 'http-waste-1' };
  const kitchenWaste = await json(base, '/api/kitchen/inventory/waste', {
    method: 'POST', cookie: kitchenCookie, headers: wasteHeaders,
    body: { branchId: 1, itemId: 'test-milk', quantity: 1, unit: 'لیتر', reason: 'آزمون نقش آشپز', occurredAt: '2026-08-24T09:00:00.000Z' },
  });
  assert.equal(kitchenWaste.response.status, 201);
  assert.equal(kitchenWaste.body.data.event.status, 'posted');
  const kitchenWasteReplay = await json(base, '/api/kitchen/inventory/waste', {
    method: 'POST', cookie: kitchenCookie, headers: wasteHeaders,
    body: { branchId: 1, itemId: 'test-milk', quantity: 1, unit: 'لیتر', reason: 'آزمون نقش آشپز', occurredAt: '2026-08-24T09:00:00.000Z' },
  });
  assert.equal(kitchenWasteReplay.response.status, 200);
  assert.equal(kitchenWasteReplay.body.data.idempotentReplay, true);
  const kitchenWasteKeyReuse = await json(base, '/api/kitchen/inventory/waste', {
    method: 'POST', cookie: kitchenCookie, headers: wasteHeaders,
    body: { branchId: 1, itemId: 'test-milk', quantity: 2, unit: 'لیتر', reason: 'بدنه متفاوت', occurredAt: '2026-08-24T09:00:00.000Z' },
  });
  assert.equal(kitchenWasteKeyReuse.response.status, 409);
  assert.equal(kitchenWasteKeyReuse.body.error.code, 'idempotency_key_payload_mismatch');
  assert.equal((await json(base, '/api/kitchen/inventory/waste', {
    method: 'POST', cookie: cashierCookie, headers: { 'Idempotency-Key': 'cashier-waste-denied' },
    body: { branchId: 1, itemId: 'test-milk', quantity: 1, unit: 'لیتر', reason: 'نباید مجاز باشد' },
  })).response.status, 403);

  const bankLineHeaders = { 'Idempotency-Key': 'http-bank-line-1' };
  const bankLine = await json(base, '/api/admin/v2/finance/reconciliation/bank-statement-lines', {
    method: 'POST', cookie: ownerCookie, headers: bankLineHeaders,
    body: { branchId: 1, bankReference: 'HTTP-BANK-1', bankAccountCode: '1210', direction: 'inflow', amountIrr: 100000, occurredAt: '2026-08-24T09:30:00.000Z', description: 'مدرک بانکی آزمون' },
  });
  assert.equal(bankLine.response.status, 201);
  assert.equal(bankLine.body.data.statementLine.status, 'unmatched');
  const bankLineReplay = await json(base, '/api/admin/v2/finance/reconciliation/bank-statement-lines', {
    method: 'POST', cookie: ownerCookie, headers: bankLineHeaders,
    body: { branchId: 1, bankReference: 'HTTP-BANK-1', bankAccountCode: '1210', direction: 'inflow', amountIrr: 100000, occurredAt: '2026-08-24T09:30:00.000Z', description: 'مدرک بانکی آزمون' },
  });
  assert.equal(bankLineReplay.response.status, 200);
  assert.equal(bankLineReplay.body.data.idempotentReplay, true);
  const bankLineKeyReuse = await json(base, '/api/admin/v2/finance/reconciliation/bank-statement-lines', {
    method: 'POST', cookie: ownerCookie, headers: bankLineHeaders,
    body: { branchId: 1, bankReference: 'SHOULD-NOT-DUPLICATE', bankAccountCode: '1210', direction: 'inflow', amountIrr: 100000, occurredAt: '2026-08-24T09:31:00.000Z' },
  });
  assert.equal(bankLineKeyReuse.response.status, 409);
  assert.equal(bankLineKeyReuse.body.error.code, 'idempotency_key_payload_mismatch');
  assert.equal((await json(base, '/api/admin/v2/finance/reconciliation/bank-statement-lines', {
    method: 'POST', cookie: cashierCookie, headers: { 'Idempotency-Key': 'cashier-bank-denied' },
    body: { branchId: 1, bankReference: 'DENIED', bankAccountCode: '1210', direction: 'inflow', amountIrr: 100000, occurredAt: '2026-08-24T09:32:00.000Z' },
  })).response.status, 403);

  const v2Period = await json(base, '/api/admin/v2/finance/fiscal-periods', {
    method: 'POST', cookie: ownerCookie, headers: { 'Idempotency-Key': 'http-period-v2-1' },
    body: { name: 'دوره تست هزینه', startDate: '2026-08-01', endDate: '2026-08-31' },
  });
  assert.equal(v2Period.response.status, 201);
  const purchaseOrder = await json(base, '/api/admin/v2/finance/purchase-orders', {
    method: 'POST', cookie: accountantCookie, headers: { 'Idempotency-Key': 'http-po-receiving-1' },
    body: { branchId: 1, vendorId: 'vendor-http', issueDate: '2026-08-24T08:00:00.000Z', lines: [{ itemId: 'test-milk', description: 'شیر تست', quantity: 4, unit: 'لیتر', unitPriceIrr: 100000 }] },
  });
  assert.equal(purchaseOrder.response.status, 201);
  const poId = purchaseOrder.body.data.purchaseOrder.id;
  const poLineId = purchaseOrder.body.data.purchaseOrder.lines[0].id;
  const poSubmit = await json(base, `/api/admin/v2/finance/purchase-orders/${poId}/submit`, {
    method: 'POST', cookie: accountantCookie, headers: { 'Idempotency-Key': 'http-po-receiving-submit-1' }, body: {},
  });
  assert.equal(poSubmit.response.status, 200);
  const poApproval = await json(base, `/api/admin/v2/finance/approvals/${poSubmit.body.data.approval.id}/decision`, {
    method: 'POST', cookie: ownerCookie, headers: { 'Idempotency-Key': 'http-po-receiving-approve-1' }, body: { decision: 'approved', comment: 'خرید موردنیاز تأیید شد' },
  });
  assert.equal(poApproval.response.status, 200);
  const receivingQueue = await json(base, '/api/kitchen/inventory?branchId=1', { cookie: kitchenCookie });
  assert.equal(receivingQueue.response.status, 200);
  assert.equal(receivingQueue.body.data.receivablePurchaseOrders[0].lines[0].remainingQuantity, 4);
  assert.doesNotMatch(JSON.stringify(receivingQueue.body.data.receivablePurchaseOrders), /unitPriceIrr|lineValueIrr|totalIrr|accountCode/);
  const receiptHeaders = { 'Idempotency-Key': 'http-kitchen-grn-1' };
  const kitchenReceipt = await json(base, '/api/kitchen/inventory/goods-receipts', {
    method: 'POST', cookie: kitchenCookie, headers: receiptHeaders,
    body: { branchId: 1, purchaseOrderId: poId, deliveryNoteNumber: 'DN-HTTP-1', receivedAt: '2026-08-24T12:00:00.000Z', lines: [{ purchaseOrderLineId: poLineId, receivedQuantity: 4 }] },
  });
  assert.equal(kitchenReceipt.response.status, 201);
  assert.equal(kitchenReceipt.body.data.goodsReceipt.status, 'completed');
  assert.equal(kitchenReceipt.body.data.policy.purchasePricesHiddenFromOperator, true);
  assert.doesNotMatch(JSON.stringify(kitchenReceipt.body.data), /unitPriceIrr|lineValueIrr|totalValueIrr|accountCode|journalEntry/);
  const kitchenReceiptReplay = await json(base, '/api/kitchen/inventory/goods-receipts', {
    method: 'POST', cookie: kitchenCookie, headers: receiptHeaders,
    body: { branchId: 1, purchaseOrderId: poId, deliveryNoteNumber: 'DN-HTTP-1', receivedAt: '2026-08-24T12:00:00.000Z', lines: [{ purchaseOrderLineId: poLineId, receivedQuantity: 4 }] },
  });
  assert.equal(kitchenReceiptReplay.response.status, 200);
  assert.equal(kitchenReceiptReplay.body.data.idempotentReplay, true);
  const kitchenReceiptKeyReuse = await json(base, '/api/kitchen/inventory/goods-receipts', {
    method: 'POST', cookie: kitchenCookie, headers: receiptHeaders,
    body: { branchId: 1, purchaseOrderId: poId, deliveryNoteNumber: 'DN-HTTP-CHANGED', receivedAt: '2026-08-24T12:00:00.000Z', lines: [{ purchaseOrderLineId: poLineId, receivedQuantity: 4 }] },
  });
  assert.equal(kitchenReceiptKeyReuse.response.status, 409);
  assert.equal(kitchenReceiptKeyReuse.body.error.code, 'idempotency_key_payload_mismatch');
  assert.equal((await json(base, '/api/admin/v2/finance/goods-receipts', {
    method: 'POST', cookie: accountantCookie, headers: { 'Idempotency-Key': 'http-accountant-grn-denied' },
    body: { branchId: 1, purchaseOrderId: poId, lines: [{ purchaseOrderLineId: poLineId, receivedQuantity: 1 }] },
  })).response.status, 403);
  const receiptId = kitchenReceipt.body.data.goodsReceipt.id;
  const receiptLineId = kitchenReceipt.body.data.goodsReceipt.lines[0].id;
  const varianceInvoice = await json(base, '/api/admin/v2/finance/vendor-invoices', {
    method: 'POST', cookie: accountantCookie, headers: { 'Idempotency-Key': 'http-variance-invoice-1' },
    body: { goodsReceiptId: receiptId, invoiceNumber: 'INV-VARIANCE-HTTP-1', invoiceDate: '2026-08-24T13:00:00.000Z', vatIrr: 0, lines: [{ goodsReceiptLineId: receiptLineId, invoicedQuantity: 4, unitPriceIrr: 110000 }] },
  });
  assert.equal(varianceInvoice.response.status, 201);
  assert.equal(varianceInvoice.body.data.vendorInvoice.status, 'match_exception');
  const varianceInvoiceId = varianceInvoice.body.data.vendorInvoice.id;
  const matchReview = await json(base, `/api/admin/v2/finance/vendor-invoices/${varianceInvoiceId}/match-review`, {
    method: 'POST', cookie: accountantCookie, headers: { 'Idempotency-Key': 'http-variance-review-1' },
    body: { reason: 'قیمت جدید با پیش‌فاکتور تأمین‌کننده بررسی شود', evidenceReference: 'QUOTE-HTTP-1' },
  });
  assert.equal(matchReview.response.status, 201);
  const missingDecisionReason = await json(base, `/api/admin/v2/finance/approvals/${matchReview.body.data.approval.id}/decision`, {
    method: 'POST', cookie: ownerCookie, headers: { 'Idempotency-Key': 'http-variance-review-no-comment' }, body: { decision: 'approved', comment: '' },
  });
  assert.equal(missingDecisionReason.response.status, 400);
  assert.equal(missingDecisionReason.body.error.code, 'three_way_match_decision_comment_required');
  const matchAccepted = await json(base, `/api/admin/v2/finance/approvals/${matchReview.body.data.approval.id}/decision`, {
    method: 'POST', cookie: ownerCookie, headers: { 'Idempotency-Key': 'http-variance-review-approved' },
    body: { decision: 'approved', comment: 'پیش‌فاکتور جدید و علت افزایش قیمت بررسی و تأیید شد' },
  });
  assert.equal(matchAccepted.response.status, 200);
  assert.equal(matchAccepted.body.data.vendorInvoiceMatch.matchStatus, 'accepted_variance');
  assert.equal(matchAccepted.body.data.vendorInvoiceEntry.lines.find((line) => line.accountCode === '5150').debitIrr, 40000);
  const commitment = await json(base, '/api/admin/v2/finance/cost-commitments', {
    method: 'POST', cookie: accountantCookie, headers: { 'Idempotency-Key': 'http-cost-commitment-1' },
    body: { branchId: 1, name: 'اجاره تست HTTP', type: 'rent', monthlyAmountIrr: 2000000, startDate: '2026-08-01' },
  });
  assert.equal(commitment.response.status, 201);
  assert.equal(commitment.body.data.commitment.expenseAccount, '6200');
  const accrual = await json(base, `/api/admin/v2/finance/cost-commitments/${commitment.body.data.commitment.id}/accruals`, {
    method: 'POST', cookie: accountantCookie, headers: { 'Idempotency-Key': 'http-cost-accrual-1' },
    body: { postingDate: '2026-08-24' },
  });
  assert.equal(accrual.response.status, 201);
  assert.equal(accrual.body.data.accrual.status, 'pending_approval');
  const accrualApproval = await json(base, `/api/admin/v2/finance/approvals/${accrual.body.data.approval.id}/decision`, {
    method: 'POST', cookie: ownerCookie, headers: { 'Idempotency-Key': 'http-cost-accrual-approve-1' }, body: { decision: 'approved' },
  });
  assert.equal(accrualApproval.response.status, 200);
  assert.equal(accrualApproval.body.data.costAccrual.status, 'posted');
  const costPayment = await json(base, `/api/admin/v2/finance/cost-accruals/${accrual.body.data.accrual.id}/payment-request`, {
    method: 'POST', cookie: accountantCookie, headers: { 'Idempotency-Key': 'http-cost-payment-1' },
    body: { amountIrr: 1000000, paymentMethod: 'bank', paymentDate: '2026-08-25T12:00:00.000Z', reference: 'HTTP-RENT-1' },
  });
  assert.equal(costPayment.response.status, 201);
  const costPaymentApproval = await json(base, `/api/admin/v2/finance/approvals/${costPayment.body.data.approval.id}/decision`, {
    method: 'POST', cookie: ownerCookie, headers: { 'Idempotency-Key': 'http-cost-payment-approve-1' }, body: { decision: 'approved' },
  });
  assert.equal(costPaymentApproval.response.status, 200);
  assert.equal(costPaymentApproval.body.data.costPayment.status, 'paid');
  assert.deepEqual(costPaymentApproval.body.data.costPaymentEntry.lines.map((line) => [line.accountCode, line.debitIrr, line.creditIrr]), [
    ['2700', 1000000, 0], ['1210', 0, 1000000],
  ]);
  const fixedAsset = await json(base, '/api/admin/v2/finance/fixed-assets', {
    method: 'POST', cookie: accountantCookie, headers: { 'Idempotency-Key': 'http-fixed-asset-1' },
    body: { branchId: 1, assetCode: 'AST-HTTP-1', name: 'اسپرسوساز تست HTTP', category: 'kitchen_bar', fundingMethod: 'bank', sourceReference: 'INV-HTTP-ASSET-1', purchaseDate: '2026-08-01', inServiceDate: '2026-08-01', purchaseCostIrr: 12000000, salvageValueIrr: 0, usefulLifeMonths: 12 },
  });
  assert.equal(fixedAsset.response.status, 201);
  assert.equal(fixedAsset.body.data.asset.status, 'pending_approval');
  const assetApproval = await json(base, `/api/admin/v2/finance/approvals/${fixedAsset.body.data.approval.id}/decision`, {
    method: 'POST', cookie: ownerCookie, headers: { 'Idempotency-Key': 'http-fixed-asset-approve-1' }, body: { decision: 'approved' },
  });
  assert.equal(assetApproval.response.status, 200);
  assert.equal(assetApproval.body.data.fixedAsset.status, 'active');
  const depreciationPreview = await json(base, '/api/admin/v2/finance/depreciation-runs/preview', {
    method: 'POST', cookie: accountantCookie, body: { branchId: 1, postingDate: '2026-08-25' },
  });
  assert.equal(depreciationPreview.response.status, 200);
  assert.equal(depreciationPreview.body.data.totalDepreciationIrr, 1000000);
  const depreciationRun = await json(base, '/api/admin/v2/finance/depreciation-runs', {
    method: 'POST', cookie: accountantCookie, headers: { 'Idempotency-Key': 'http-depreciation-run-1' }, body: { branchId: 1, postingDate: '2026-08-25' },
  });
  assert.equal(depreciationRun.response.status, 201);
  assert.equal(depreciationRun.body.data.run.status, 'pending_approval');
  const depreciationApproval = await json(base, `/api/admin/v2/finance/approvals/${depreciationRun.body.data.approval.id}/decision`, {
    method: 'POST', cookie: ownerCookie, headers: { 'Idempotency-Key': 'http-depreciation-approve-1' }, body: { decision: 'approved' },
  });
  assert.equal(depreciationApproval.response.status, 200);
  assert.equal(depreciationApproval.body.data.depreciationRun.status, 'posted');
  assert.equal((await json(base, '/api/admin/finance/depreciation/run', { method: 'POST', cookie: ownerCookie, body: {} })).response.status, 410);
  const legacyPosWrite = await json(base, '/api/pos/sales', {
    method: 'POST', cookie: cashierCookie, body: { external_id: 'LEGACY-POS-BLOCKED', status: 'paid', total: 1000 },
  });
  assert.equal(legacyPosWrite.response.status, 410);
  assert.equal(legacyPosWrite.body.error.code, 'finance_v1_pos_read_only');
  const legacyPosRefundWrite = await json(base, '/api/pos/sales/LEGACY-POS-BLOCKED/refunds', {
    method: 'POST', cookie: cashierCookie, body: { amount: 1000, reason: 'legacy route guard' },
  });
  assert.equal(legacyPosRefundWrite.response.status, 410);
  assert.equal(legacyPosRefundWrite.body.error.code, 'finance_v1_pos_read_only');
  const legacyExpenseWrite = await json(base, '/v1/expenses', {
    method: 'POST', cookie: ownerCookie, body: { branchId: 1, amount: 1000, description: 'legacy route guard' },
  });
  assert.equal(legacyExpenseWrite.response.status, 410);
  assert.equal(legacyExpenseWrite.body.error.code, 'finance_v1_read_only');
  const legacyTaxWrite = await json(base, '/api/tax/einvoices', {
    method: 'POST', cookie: ownerCookie, body: { invoiceId: 'LEGACY-TAX-BLOCKED' },
  });
  assert.equal(legacyTaxWrite.response.status, 410);
  assert.equal(legacyTaxWrite.body.error.code, 'finance_v1_read_only');
  for (const legacyWritePath of [
    '/v1/pos/sales', '/v1/pos/sales/LEGACY-POS-BLOCKED/refunds', '/v1/settlements', '/v1/settlements/imports',
    '/v1/expenses', '/v1/payroll/runs', '/v1/payroll/runs/LEGACY-PAYROLL/disburse',
    '/v1/bank-transactions/imports', '/v1/reconciliations/bank', '/v1/inventory/waste',
  ]) {
    const legacyWrite = await json(base, legacyWritePath, { method: 'POST', cookie: ownerCookie, body: {} });
    assert.equal(legacyWrite.response.status, 410, legacyWritePath);
    assert.equal(legacyWrite.body.error.code, 'finance_v1_read_only', legacyWritePath);
  }
  const payrollBody = {
    branchId: 1, postingDate: '2026-08-25', headcount: 3, sourceReference: 'HTTP-PAYROLL-1405-06',
    kitchenGrossIrr: 12000000, serviceGrossIrr: 8000000, employerInsuranceIrr: 2000000,
    employeeInsuranceIrr: 1500000, payrollTaxIrr: 500000, otherDeductionsIrr: 0, netPayIrr: 18000000,
  };
  const payrollPreview = await json(base, '/api/admin/v2/finance/payroll-runs/preview', {
    method: 'POST', cookie: accountantCookie, body: payrollBody,
  });
  assert.equal(payrollPreview.response.status, 200);
  assert.equal(payrollPreview.body.data.totalExpenseIrr, 22000000);
  const payrollRun = await json(base, '/api/admin/v2/finance/payroll-runs', {
    method: 'POST', cookie: accountantCookie, headers: { 'Idempotency-Key': 'http-payroll-run-1' }, body: payrollBody,
  });
  assert.equal(payrollRun.response.status, 201);
  assert.equal(payrollRun.body.data.run.status, 'pending_approval');
  const payrollApproval = await json(base, `/api/admin/v2/finance/approvals/${payrollRun.body.data.approval.id}/decision`, {
    method: 'POST', cookie: ownerCookie, headers: { 'Idempotency-Key': 'http-payroll-approve-1' }, body: { decision: 'approved' },
  });
  assert.equal(payrollApproval.response.status, 200);
  assert.equal(payrollApproval.body.data.payrollRun.status, 'posted');
  const payrollPayment = await json(base, `/api/admin/v2/finance/payroll-runs/${payrollRun.body.data.run.id}/payment-request`, {
    method: 'POST', cookie: accountantCookie, headers: { 'Idempotency-Key': 'http-payroll-payment-1' },
    body: { liabilityType: 'net_salary', amountIrr: 10000000, paymentMethod: 'bank', paymentDate: '2026-08-26T12:00:00.000Z', reference: 'HTTP-PAY-1' },
  });
  assert.equal(payrollPayment.response.status, 201);
  assert.equal(payrollPayment.body.data.payment.status, 'pending_approval');
  const payrollPaymentApproval = await json(base, `/api/admin/v2/finance/approvals/${payrollPayment.body.data.approval.id}/decision`, {
    method: 'POST', cookie: ownerCookie, headers: { 'Idempotency-Key': 'http-payroll-payment-approve-1' }, body: { decision: 'approved' },
  });
  assert.equal(payrollPaymentApproval.response.status, 200);
  assert.equal(payrollPaymentApproval.body.data.payrollRun.status, 'partially_paid');
  assert.deepEqual(payrollPaymentApproval.body.data.payrollPaymentEntry.lines.map((line) => [line.accountCode, line.debitIrr, line.creditIrr]), [
    ['2600', 10000000, 0], ['1210', 0, 10000000],
  ]);
  assert.equal((await json(base, '/api/admin/finance/payroll/runs', { method: 'POST', cookie: ownerCookie, body: {} })).response.status, 410);

  const openedShift = await json(base, '/api/staff/shifts/open', { method: 'POST', cookie: cashierCookie, body: { branchId: 1 } });
  assert.equal(openedShift.response.status, 201);
  assert.equal(openedShift.body.shift.closedAt, null);

  const call = await json(base, '/api/call-waiter', { method: 'POST', body: { tableNo: '1', note: 'آب' } });
  assert.equal(call.response.status, 200);
  const waiterCalls = await json(base, '/api/waiter/calls', { cookie: waiterCookie });
  assert.equal(waiterCalls.response.status, 200);
  assert.equal(waiterCalls.body.calls.length, 1);
  const resolved = await json(base, `/api/waiter/calls/${call.body.call.id}`, { method: 'PATCH', cookie: waiterCookie, body: { status: 'done' } });
  assert.equal(resolved.response.status, 200);
  assert.equal((await json(base, '/api/kitchen/calls', { cookie: kitchenCookie })).response.status, 403);

  const drawer = await json(base, '/api/cashier/drawer/open', { method: 'POST', cookie: cashierCookie, body: { branchId: 1, openingAmount: 500000 } });
  assert.equal(drawer.response.status, 201);
  const blockedShiftClose = await json(base, '/api/staff/shifts/close', { method: 'POST', cookie: cashierCookie, body: { branchId: 1 } });
  assert.equal(blockedShiftClose.response.status, 409);
  assert.equal(blockedShiftClose.body.error, 'cash_drawer_still_open');
  const payOut = await json(base, '/api/cashier/drawer/movements', { method: 'POST', cookie: cashierCookie, body: { branchId: 1, type: 'pay_out', amount: 50000, note: 'تنخواه' } });
  assert.equal(payOut.body.totals.expected, 450000);

  const item = seed.menuItems.find((entry) => entry.available !== false);
  const created = await json(base, '/api/checkout/orders', {
    method: 'POST',
    body: {
      branchId: 1,
      fulfillment: 'pickup',
      paymentMethod: 'cashier',
      name: 'مهمان تست',
      phone: '09151111111',
      items: [{ menuItemId: item.id, qty: 1 }],
    },
  });
  assert.equal(created.response.status, 201);
  const orderId = created.body.order.id;

  const orderBeforeFinanceConflict = JSON.parse(JSON.stringify(serverDb.orders.find((entry) => Number(entry.id) === Number(orderId))));
  const drawerBeforeFinanceConflict = JSON.parse(JSON.stringify(serverDb.cashSessions.find((entry) => entry.id === drawer.body.session.id)));
  const financeState = financeV2.ensureFinanceV2(serverDb);
  financeState.events.push({
    id: 'cross-branch-order-paid-conflict', source: 'order.paid', sourceId: String(orderId), sourceVersion: 1,
    idempotencyKey: `2:order.paid:${orderId}:v1`, branchId: 2, occurredAt: orderBeforeFinanceConflict.createdAt,
    amountIrr: 1, payload: {}, status: 'posted', error: null, journalEntryId: null, createdAt: new Date().toISOString(), processedAt: null,
  });
  const blockedSettlement = await json(base, `/api/cashier/orders/${orderId}/settle`, {
    method: 'POST', cookie: cashierCookie, body: { tender: 'cash' },
  });
  assert.equal(blockedSettlement.response.status, 503);
  assert.equal(blockedSettlement.body.error, 'finance_event_source_branch_conflict');
  assert.deepEqual(serverDb.orders.find((entry) => Number(entry.id) === Number(orderId)), orderBeforeFinanceConflict);
  assert.deepEqual(serverDb.cashSessions.find((entry) => entry.id === drawer.body.session.id), drawerBeforeFinanceConflict);
  serverDb.financeV2.events = serverDb.financeV2.events.filter((entry) => entry.id !== 'cross-branch-order-paid-conflict');

  const settled = await json(base, `/api/cashier/orders/${orderId}/settle`, {
    method: 'POST', cookie: cashierCookie, body: { tender: 'cash' },
  });
  assert.equal(settled.response.status, 200);
  assert.equal(settled.body.order.paymentTender, 'cash');
  assert.equal(settled.body.drawer.totals.sales, created.body.order.total);
  const cashierCannotFireKitchen = await json(base, `/api/v2/orders/${orderId}/status`, {
    method: 'PATCH', cookie: cashierCookie, body: { status: 'preparing' },
  });
  assert.equal(cashierCannotFireKitchen.response.status, 403);

  const paid = await json(base, `/api/v2/orders/${orderId}/status`, {
    method: 'PATCH', cookie: ownerCookie, body: { status: 'paid' },
  });
  assert.equal(paid.response.status, 200);

  const preparing = await json(base, `/api/kitchen/orders/${orderId}`, {
    method: 'PATCH', cookie: kitchenCookie, body: { status: 'preparing' },
  });
  assert.equal(preparing.response.status, 200);
  const blockedIncompleteTicket = await json(base, `/api/kitchen/orders/${orderId}`, {
    method: 'PATCH', cookie: kitchenCookie, body: { status: 'ready' },
  });
  assert.equal(blockedIncompleteTicket.response.status, 409);
  assert.equal(blockedIncompleteTicket.body.error, 'kds_ticket_incomplete');
  const invalidCancel = await json(base, `/api/kitchen/orders/${orderId}`, {
    method: 'PATCH', cookie: kitchenCookie, body: { status: 'cancelled' },
  });
  assert.equal(invalidCancel.response.status, 409);
  const firstQueue = await json(base, '/api/kitchen/orders', { cookie: kitchenCookie });
  assert.equal(firstQueue.body.branchId, 1);
  const invalidKitchenBranch = await json(base, '/api/kitchen/orders?branchId=999', { cookie: kitchenCookie });
  assert.equal(invalidKitchenBranch.response.status, 400);
  const crossBranchKitchenWrite = await json(base, `/api/kitchen/orders/${orderId}`, {
    method: 'PATCH', cookie: kitchenCookie, body: { branchId: 2, action: 'start_ticket' },
  });
  assert.equal(crossBranchKitchenWrite.response.status, 404);
  const firstTicket = firstQueue.body.tickets.find((ticket) => ticket.id === orderId);
  const ready = await json(base, `/api/kitchen/orders/${orderId}`, {
    method: 'PATCH', cookie: kitchenCookie, body: { action: 'complete_item', lineKey: firstTicket.items[0].key },
  });
  assert.equal(ready.response.status, 200);
  assert.equal(ready.body.order.status, 'ready');

  const dineIn = await json(base, '/api/staff/orders', {
    method: 'POST', cookie: cashierCookie,
    body: {
      branchId: 1, fulfillment: 'dine_in', tableNo: '10', paymentMethod: 'cashier', sendToKitchen: true,
      items: [{ menuItemId: item.id, qty: 1, modifiers: [{ name: 'تند' }, { name: 'بیکن' }], note: 'سس جدا' }],
    },
  });
  assert.equal(dineIn.response.status, 201);
  assert.equal(dineIn.body.order.status, 'sent_to_kitchen');
  assert.equal(dineIn.body.order.paymentStatus, 'unpaid');
  assert.equal(dineIn.body.order.items[0].modifiers[1].price, 220000);
  const dineInId = dineIn.body.order.id;

  const editedBeforeKitchen = await json(base, `/api/cashier/orders/${dineInId}`, {
    method: 'PATCH', cookie: cashierCookie,
    body: {
      branchId: 1,
      note: 'ویرایش صندوق پیش از شروع',
      items: [{ menuItemId: item.id, qty: 2, modifiers: [{ name: 'تند' }, { name: 'بیکن' }], note: 'سس جدا' }],
    },
  });
  assert.equal(editedBeforeKitchen.response.status, 200);
  assert.equal(editedBeforeKitchen.body.order.items[0].qty, 2);
  assert.equal(editedBeforeKitchen.body.order.editRevision, 1);
  assert.equal(editedBeforeKitchen.body.order.note, 'ویرایش صندوق پیش از شروع');

  const kitchenQueue = await json(base, '/api/kitchen/orders', { cookie: kitchenCookie });
  assert.equal(kitchenQueue.body.tickets.some((ticket) => ticket.id === dineInId && ticket.column === 'new'), true);
  assert.ok(Array.isArray(kitchenQueue.body.allDay));
  assert.ok(Array.isArray(kitchenQueue.body.stations));
  assert.ok(Array.isArray(kitchenQueue.body.availability));
  assert.equal(typeof kitchenQueue.body.performance.averagePrepSec, 'number');
  const dineTicket = kitchenQueue.body.tickets.find((ticket) => ticket.id === dineInId);
  assert.ok(dineTicket.items[0].key);
  assert.ok(['hot', 'cold', 'bar'].includes(dineTicket.items[0].station));
  const prioritized = await json(base, `/api/kitchen/orders/${dineInId}`, {
    method: 'PATCH', cookie: kitchenCookie, body: { action: 'prioritize', priority: true },
  });
  assert.equal(prioritized.body.order.kds.priority, true);
  const kitchenNote = await json(base, `/api/kitchen/orders/${dineInId}`, {
    method: 'PATCH', cookie: kitchenCookie, body: { action: 'note', note: 'آلرژی نیازمند تأیید' },
  });
  assert.equal(kitchenNote.body.order.kitchenNote, 'آلرژی نیازمند تأیید');
  const dinePreparing = await json(base, `/api/kitchen/orders/${dineInId}`, {
    method: 'PATCH', cookie: kitchenCookie, body: { action: 'start_ticket' },
  });
  assert.equal(dinePreparing.body.order.status, 'preparing');
  assert.equal(dinePreparing.body.order.paymentStatus, 'unpaid');
  const itemCompleted = await json(base, `/api/kitchen/orders/${dineInId}`, {
    method: 'PATCH', cookie: kitchenCookie, body: { action: 'complete_item', lineKey: dineTicket.items[0].key },
  });
  assert.equal(itemCompleted.body.order.status, 'ready');
  assert.ok(itemCompleted.body.order.items[0].completedAt);
  const itemUndone = await json(base, `/api/kitchen/orders/${dineInId}`, {
    method: 'PATCH', cookie: kitchenCookie, body: { action: 'undo_item', lineKey: dineTicket.items[0].key },
  });
  assert.equal(itemUndone.body.order.status, 'preparing');
  assert.equal(itemUndone.body.order.items[0].completedAt, null);
  const stationCompleted = await json(base, `/api/kitchen/orders/${dineInId}`, {
    method: 'PATCH', cookie: kitchenCookie, body: { action: 'complete_station', station: dineTicket.items[0].station },
  });
  assert.equal(stationCompleted.body.order.status, 'ready');
  const stationCompletedAgain = await json(base, `/api/kitchen/orders/${dineInId}`, {
    method: 'PATCH', cookie: kitchenCookie, body: { action: 'complete_station', station: dineTicket.items[0].station },
  });
  assert.equal(stationCompletedAgain.response.status, 200);
  assert.equal(stationCompletedAgain.body.idempotent, true);
  assert.ok(Array.isArray(stationCompletedAgain.body.order.items));
  const recalled = await json(base, `/api/kitchen/orders/${dineInId}`, {
    method: 'PATCH', cookie: kitchenCookie, body: { action: 'recall_ticket' },
  });
  assert.equal(recalled.body.order.status, 'preparing');
  assert.equal(recalled.body.order.items[0].completedAt, null);
  const unavailable = await json(base, `/api/kitchen/items/${item.id}/availability`, {
    method: 'PATCH', cookie: kitchenCookie, body: { available: false },
  });
  assert.equal(unavailable.response.status, 200);
  assert.equal(unavailable.body.item.available, false);
  const availableAgain = await json(base, `/api/kitchen/items/${item.id}/availability`, {
    method: 'PATCH', cookie: kitchenCookie, body: { available: true },
  });
  assert.equal(availableAgain.body.item.available, true);
  const lockedAfterKitchenStart = await json(base, `/api/cashier/orders/${dineInId}`, {
    method: 'PATCH', cookie: cashierCookie,
    body: { branchId: 1, items: [{ menuItemId: item.id, qty: 1 }] },
  });
  assert.equal(lockedAfterKitchenStart.response.status, 409);
  assert.equal(lockedAfterKitchenStart.body.error, 'order_edit_locked');

  const cashTotal = editedBeforeKitchen.body.order.total;
  const firstShare = Math.floor(cashTotal / 2);
  const partial = await json(base, `/api/cashier/orders/${dineInId}/settle`, {
    method: 'POST', cookie: cashierCookie, body: { tender: 'card', paymentAmount: firstShare },
  });
  assert.equal(partial.response.status, 200);
  assert.equal(partial.body.order.status, 'preparing');
  assert.equal(partial.body.order.paymentStatus, 'partial');
  assert.equal(partial.body.order.amountPaid, firstShare);
  const remaining = cashTotal - firstShare;
  const dineSettled = await json(base, `/api/cashier/orders/${dineInId}/settle`, {
    method: 'POST', cookie: cashierCookie, body: { tender: 'cash', paymentAmount: remaining, amountTendered: remaining + 500000 },
  });
  assert.equal(dineSettled.response.status, 200);
  assert.equal(dineSettled.body.order.status, 'preparing');
  assert.equal(dineSettled.body.order.paymentStatus, 'paid');
  assert.equal(dineSettled.body.order.changeDue, 500000);
  const receipt = await json(base, `/api/cashier/orders/${dineInId}/receipt`, {
    method: 'POST', cookie: cashierCookie, body: { method: 'none' },
  });
  assert.equal(receipt.response.status, 200);
  assert.equal(receipt.body.order.receipt.method, 'none');

  const drawerAtClose = await json(base, '/api/cashier/drawer?branchId=1', { cookie: cashierCookie });
  const closedDrawer = await json(base, '/api/cashier/drawer/close', {
    method: 'POST', cookie: cashierCookie,
    body: { branchId: 1, countedAmount: drawerAtClose.body.totals.expected },
  });
  assert.equal(closedDrawer.response.status, 200);
  const closedShift = await json(base, '/api/staff/shifts/close', { method: 'POST', cookie: cashierCookie, body: { branchId: 1 } });
  assert.equal(closedShift.response.status, 200);
  assert.ok(closedShift.body.shift.closedAt);
});
}
