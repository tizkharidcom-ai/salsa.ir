'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const financeV2 = require('../server/finance-v2');
const { resolveSettlementAmounts } = require('../server/settlement-amounts');
const serverSource = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');

test('partial cash and manual-card receipts post customer deposits immediately and clear them once on sale', () => {
  const order = {
    id: 'audit-partial-mixed-order',
    branchId: 1,
    orderNo: 'AUDIT-1',
    total: 10_000,
    amountPaid: 4_000,
    status: 'pay_at_cashier',
    paymentStatus: 'partial',
    partialPayments: [
      { id: 1, tender: 'cash', amount: 2_000, at: '2026-09-23T10:00:00.000Z' },
      { id: 2, tender: 'manual_card', amount: 2_000, reference: 'AUDIT-POS-2', at: '2026-09-23T10:01:00.000Z' },
    ],
    items: [{ id: 'line-1', name: 'Audit item', qty: 1, price: 10_000, lineTotal: 10_000 }],
    createdAt: '2026-09-23T09:59:00.000Z',
  };
  const db = {
    orders: [order],
    financeV2: {
      rollout: { captureEnabled: true, enabledBranchIds: [] },
      fiscalPeriods: [{ id: 'open-1', branchId: 1, startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' }],
      events: [], payments: [], journalEntries: [], reconciliationItems: [], idempotency: {},
    },
  };

  const cashReceipt = financeV2.captureOrderPaymentReceipt(db, order, order.partialPayments[0], {
    actor: 'cashier-audit', cashSessionId: 'cash-session-audit',
  });
  const cardReceipt = financeV2.captureOrderPaymentReceipt(db, order, order.partialPayments[1], { actor: 'cashier-audit' });
  const replay = financeV2.captureOrderPaymentReceipt(db, order, order.partialPayments[1], { actor: 'cashier-audit' });

  assert.equal(cashReceipt.event.source, 'order.payment_received');
  assert.equal(cardReceipt.journalEntry.status, 'posted');
  assert.equal(replay.idempotentReplay, true);
  assert.equal(db.financeV2.events.length, 2);
  assert.equal(db.financeV2.payments.length, 2);
  assert.equal(db.financeV2.journalEntries.length, 2);
  assert.equal(db.financeV2.reconciliationItems.length, 1);
  assert.equal(db.financeV2.reconciliationItems[0].journalEntryId, cardReceipt.journalEntry.id);
  assert.equal(db.financeV2.reconciliationItems[0].status, 'unmatched');
  assert.equal(db.financeV2.journalEntries.flatMap((entry) => entry.lines).filter((line) => line.accountCode === '4110').length, 0,
    'partial receipts must not recognize sales revenue');

  const finalPayment = {
    id: 3, tender: 'cash', amount: 6_000, amountTendered: 6_000,
    at: '2026-09-23T10:02:00.000Z', cashSessionId: 'cash-session-audit',
  };
  order.partialPayments.push(finalPayment);
  order.amountPaid = 10_000;
  order.paymentStatus = 'paid';
  order.status = 'paid';
  order.paidAt = finalPayment.at;
  const lastReceipt = financeV2.captureOrderPaymentReceipt(db, order, finalPayment, {
    actor: 'cashier-audit', cashSessionId: finalPayment.cashSessionId,
  });
  const sale = financeV2.capturePaidOrder(db, order, { actor: 'cashier-audit' });
  assert.equal(lastReceipt.journalEntry.status, 'posted');
  assert.equal(sale.journalEntry.status, 'posted');
  const saleDebits = sale.journalEntry.lines.filter((line) => line.debitIrr > 0);
  assert.equal(saleDebits.length, 3);
  assert.equal(saleDebits.every((line) => line.accountCode === '2500'), true);
  assert.equal(saleDebits.reduce((sum, line) => sum + line.debitIrr, 0), 100_000);
  assert.equal(sale.journalEntry.lines.find((line) => line.accountCode === '4110').creditIrr, 100_000);
  assert.equal(db.financeV2.payments.length, 3);
  assert.equal(db.financeV2.journalEntries.length, 4);
});

test('a sale blocked by a closed period clears prior customer deposits when the event is resolved', () => {
  const order = {
    id: 'audit-deferred-sale-order', branchId: 8, orderNo: 'AUDIT-DEFERRED-1',
    total: 900, amountPaid: 900, paymentStatus: 'paid', status: 'paid',
    createdAt: '2026-09-23T10:00:00.000Z', paidAt: '2026-09-23T10:05:00.000Z',
    partialPayments: [
      { id: 'deposit-1', tender: 'cash', amount: 400, at: '2026-09-23T10:01:00.000Z' },
      { id: 'deposit-2', tender: 'manual_card', amount: 500, reference: 'AUDIT-DEFERRED-POS', at: '2026-09-23T10:02:00.000Z' },
    ],
    items: [{ id: 'deferred-line-1', name: 'Deferred sale item', qty: 1, price: 900, lineTotal: 900 }],
  };
  const period = { id: 'closed-8', branchId: 8, startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' };
  const db = {
    orders: [order],
    financeV2: {
      rollout: { captureEnabled: true, enabledBranchIds: [] }, fiscalPeriods: [period],
      events: [], payments: [], journalEntries: [], reconciliationItems: [], idempotency: {},
    },
  };
  for (const payment of order.partialPayments) {
    financeV2.captureOrderPaymentReceipt(db, order, payment, { actor: 'cashier-deferred-test' });
  }

  period.status = 'closed';
  const blockedSale = financeV2.capturePaidOrder(db, order, { actor: 'cashier-deferred-test' });
  assert.equal(blockedSale.event.status, 'blocked');
  assert.equal(blockedSale.journalEntry, null);
  assert.equal(db.financeV2.payments.length, 2, 'receipt rows remain available while sale posting awaits an open period');

  period.status = 'open';
  const resolution = financeV2.resolveEvent(db, blockedSale.event.id, {}, 'accountant-deferred-test');
  assert.equal(resolution.entry.status, 'posted');
  const deposits = resolution.entry.lines.filter((line) => line.accountCode === '2500' && line.debitIrr > 0);
  assert.deepEqual(deposits.map((line) => line.debitIrr), [4_000, 5_000]);
  assert.equal(resolution.entry.lines.some((line) => line.accountCode === '1110' && line.debitIrr > 0), false,
    'resolving the sale must not debit cash/card a second time');
  assert.equal(db.financeV2.payments.length, 2);
  assert.equal(db.financeV2.payments.every((payment) => payment.saleJournalEntryId === resolution.entry.id), true);
});

test('cashier route posts each physical receipt before attempting sale capture or durable commit', () => {
  const handlerStart = serverSource.indexOf('const handleSettleOrder = async');
  const handlerEnd = serverSource.indexOf("app.post('/api/cashier/orders/:id/settle'", handlerStart);
  const handler = serverSource.slice(handlerStart, handlerEnd);
  const receiptCapture = handler.indexOf('captureOrderPaymentReceipt');
  const saleCapture = handler.indexOf('financeV2.capturePaidOrder');
  const durableCommit = handler.indexOf('persistFinanceMutation(snapshot)');
  assert.ok(receiptCapture >= 0 && saleCapture > receiptCapture && durableCommit > saleCapture,
    'receipt, completed sale, and durable write must remain inside the same rollback boundary');
  assert.match(handler, /\['cash', 'manual_card'\]\.includes\(tender\)\s*\?\s*financeV2\.captureOrderPaymentReceipt/);
});

test('pre-sale cash refund releases the deposit and restores only the outstanding amount before final sale', () => {
  const order = {
    id: 'audit-pre-sale-refund-order', branchId: 4, orderNo: 'AUDIT-REFUND-1',
    total: 1_000, amountPaid: 500, balanceDue: 500, paymentStatus: 'partial', status: 'pay_at_cashier',
    createdAt: '2026-09-23T10:00:00.000Z',
    partialPayments: [{ id: 1, tender: 'cash', amount: 500, at: '2026-09-23T10:00:00.000Z', cashSessionId: 'cash-refund-session' }],
    items: [{ id: 'refund-line-1', name: 'Test item', qty: 1, price: 1_000, lineTotal: 1_000 }],
  };
  const db = {
    orders: [order],
    financeV2: {
      rollout: { captureEnabled: true, enabledBranchIds: [] },
      fiscalPeriods: [{ id: 'refund-open-4', branchId: 4, startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' }],
      events: [], payments: [], refunds: [], approvals: [], journalEntries: [], reconciliationItems: [], idempotency: {},
    },
  };
  const receipt = financeV2.captureOrderPaymentReceipt(db, order, order.partialPayments[0], {
    actor: 'cashier-refund-test', cashSessionId: 'cash-refund-session',
  });
  const request = financeV2.requestOrderRefund(db, order.id, {
    branchId: 4, paymentId: receipt.payment.id, amountIrr: 1_000,
    reason: 'order adjustment', refundDate: '2026-09-23T10:01:00.000Z',
  }, 'cashier-refund-test', 'audit-refund-request-1');
  financeV2.decideApproval(db, request.approval.id, 'approved', 'manager-refund-test', 'independent approval', { branchId: 4 });
  const evidence = {
    id: 'refund-outgoing-1', kind: 'bank_statement_line', direction: 'outgoing',
    sourceRecordId: 'bank-import-1/line-1', sourcePaymentId: receipt.payment.id,
    branchId: 4, amountIrr: 1_000, bankReference: 'REFUND-OUT-1', status: 'unmatched',
    verifiedAt: '2026-09-23T10:02:00.000Z',
  };
  db.financeV2.reconciliationItems.push(evidence);
  const refundEntry = financeV2.postApprovedRefund(db, request.refund, 'manager-refund-test', evidence.id);

  assert.equal(refundEntry.source, 'order.payment_refund');
  assert.equal(refundEntry.lines.find((line) => line.accountCode === '2500')?.debitIrr, 1_000);
  assert.equal(refundEntry.lines.find((line) => line.accountCode === '1110')?.creditIrr, 1_000);
  assert.equal(request.refund.recognitionState, 'customer_deposit');
  assert.equal(request.refund.revenueRefundIrr, 0);
  assert.equal(order.amountPaid, 400);
  assert.equal(order.balanceDue, 600);
  assert.equal(order.paymentStatus, 'partial');
  assert.deepEqual(resolveSettlementAmounts({
    total: order.total, amountPaid: order.amountPaid, payments: order.partialPayments,
  }), { ok: true, orderTotal: 1_000, alreadyPaid: 400, outstanding: 600, requestedAmount: 600, amountTendered: 600 });
  assert.deepEqual(financeV2.reportSnapshot(db, { branchId: 4 }).operational, {
    paidOrders: 0, grossSalesIrr: 0, refundsIrr: 0, salesIrr: 0,
    source: 'orders + financeV2.refunds(succeeded)',
  });

  const finalPayment = { id: 2, tender: 'cash', amount: 600, at: '2026-09-23T10:03:00.000Z', cashSessionId: 'cash-refund-session' };
  order.partialPayments.push(finalPayment);
  order.amountPaid = 1_000; order.balanceDue = 0; order.paymentStatus = 'paid'; order.status = 'paid'; order.paidAt = finalPayment.at;
  financeV2.captureOrderPaymentReceipt(db, order, finalPayment, { actor: 'cashier-refund-test', cashSessionId: finalPayment.cashSessionId });
  const sale = financeV2.capturePaidOrder(db, order, { actor: 'cashier-refund-test' });
  assert.equal(sale.journalEntry.status, 'posted');
  const depositDebits = sale.journalEntry.lines.filter((line) => line.accountCode === '2500' && line.debitIrr > 0)
    .map((line) => line.debitIrr).sort((left, right) => left - right);
  assert.deepEqual(depositDebits, [4_000, 6_000], 'the sale clears only the unrefunded part of the original receipt, plus the final receipt');
  assert.equal(db.financeV2.payments[0].amountIrr, 5_000);
  assert.equal(db.financeV2.payments[0].refundedIrr, 1_000);
});

test('audit: cashier settlement fails closed when a legacy idempotency replay has no valid fingerprint', () => {
  const helper = serverSource.match(/function isSettlementRequestFingerprint\(value\)\s*\{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper, 'settlement replay fingerprint validator exists');
  const isSettlementRequestFingerprint = vm.runInNewContext(`${helper}; isSettlementRequestFingerprint;`);

  assert.equal(isSettlementRequestFingerprint('a'.repeat(64)), true);
  assert.equal(isSettlementRequestFingerprint(undefined), false);
  assert.equal(isSettlementRequestFingerprint('legacy-fingerprint'), false);
  assert.equal(isSettlementRequestFingerprint('g'.repeat(64)), false);

  const handlerStart = serverSource.indexOf('const handleSettleOrder = async');
  const handlerEnd = serverSource.indexOf("app.post('/api/cashier/orders/:id/settle'", handlerStart);
  const handler = serverSource.slice(handlerStart, handlerEnd);
  const unavailableGuard = handler.indexOf('if (!isSettlementRequestFingerprint(existingPayment.requestFingerprint))');
  const fingerprintConflict = handler.indexOf('existingPayment.requestFingerprint && existingPayment.requestFingerprint !== requestFingerprint');
  assert.ok(unavailableGuard >= 0 && fingerprintConflict > unavailableGuard,
    'incomplete legacy replay data is rejected before normal fingerprint conflict/replay handling');
  assert.match(handler.slice(unavailableGuard, fingerprintConflict), /idempotency_replay_unavailable/);
  assert.match(handler.slice(unavailableGuard, fingerprintConflict), /پرداخت را دوباره ثبت نکنید/);
});
