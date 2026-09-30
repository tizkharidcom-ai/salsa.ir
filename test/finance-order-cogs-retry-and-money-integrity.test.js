'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const financeV2 = require('../server/finance-v2');
const orderCosting = require('../server/finance/order-costing');

const PAID_AT = '2026-09-24T08:00:00.000Z';

function fixture({ onHand = 1 } = {}) {
  const db = {
    orders: [],
    branches: [{ id: 1, active: true }],
    accounting: {
      settings: {},
      inventoryItems: [{
        id: 'flour-b1', branchId: 1, name: 'آرد', unit: 'g', qtyOnHand: onHand, avgCostIrr: 100,
      }],
      recipes: [{
        id: 'recipe-dish-b1', branchId: 1, menuItemId: 'dish-1', version: 1, status: 'approved',
        effectiveFrom: '2026-01-01T00:00:00.000Z', yieldQuantity: 1,
        ingredients: [{ itemId: 'flour-b1', quantity: 1, unit: 'g', quantityBasis: 'raw' }],
      }],
    },
  };
  financeV2.createFiscalPeriod(db, {
    branchId: 1, name: 'دورهٔ آزمون', startDate: '2026-01-01', endDate: '2026-12-31',
  }, 'finance-test');
  return db;
}

function paidOrder(id, partialPayments = [{ id: `payment-${id}`, tender: 'cash', amount: 1000, at: PAID_AT }]) {
  return {
    id, orderNo: id, branchId: 1, fulfillment: 'pickup', total: 1000,
    status: 'paid', paymentStatus: 'paid', paymentTender: 'cash',
    createdAt: PAID_AT, paidAt: PAID_AT, partialPayments,
    items: [{ id: `line-${id}`, menuItemId: 'dish-1', name: 'غذا', qty: 1, lineTotal: 1000 }],
  };
}

test('cash plus card legs post separately while sale, payment projections, reconciliation and replay stay singular', () => {
  const db = fixture();
  const order = paidOrder('split-tender-1', [
    { id: 'cash-leg-1', tender: 'cash', amount: 300, at: PAID_AT },
    { id: 'card-leg-1', tender: 'manual_card', amount: 700, reference: 'POS-SPLIT-1', at: PAID_AT },
  ]);
  db.orders.push(order);

  const first = financeV2.capturePaidOrder(db, order, { actor: 'finance-test' });
  const replay = financeV2.capturePaidOrder(db, order, { actor: 'finance-test' });
  const saleEntries = db.financeV2.journalEntries.filter((entry) => entry.source === 'order.paid');

  assert.equal(first.journalEntry?.status, 'posted');
  assert.equal(replay.idempotentReplay, true);
  assert.equal(saleEntries.length, 1);
  assert.equal(saleEntries[0].lines.find((line) => line.accountCode === '1110')?.debitIrr, 3000);
  assert.equal(saleEntries[0].lines.find((line) => line.accountCode === '1320')?.debitIrr, 7000);
  assert.equal(saleEntries[0].lines.find((line) => line.accountCode === '4120')?.creditIrr, 10000);
  assert.deepEqual(db.financeV2.payments.map((payment) => payment.amountIrr).sort((a, b) => a - b), [3000, 7000]);
  assert.equal(db.financeV2.reconciliationItems.filter((item) => item.kind === 'payment').length, 1);
  assert.equal(db.financeV2.reconciliationItems.find((item) => item.kind === 'payment')?.amountIrr, 7000);
  assert.equal(db.financeV2.events.filter((event) => event.source === 'order.paid').length, 1);
  assert.equal(db.financeV2.events.filter((event) => event.source === 'order.cogs').length, 1);
});

test('pre-sale cash and card receipts are consumed once from customer deposits when the split-tender sale posts', () => {
  const db = fixture();
  const order = paidOrder('split-prepayment-1', []);
  order.paymentStatus = 'partial';
  const cashLeg = { id: 'pre-cash-1', tender: 'cash', amount: 300, at: PAID_AT, cashSessionId: 'cash-session-1' };
  const cardLeg = { id: 'pre-card-1', tender: 'manual_card', amount: 700, at: PAID_AT, reference: 'POS-PRE-SPLIT-1' };

  const cashReceipt = financeV2.captureOrderPaymentReceipt(db, order, cashLeg, { actor: 'finance-test' });
  const cardReceipt = financeV2.captureOrderPaymentReceipt(db, order, cardLeg, { actor: 'finance-test' });
  order.partialPayments = [cashLeg, cardLeg];
  order.amountPaid = 1000;
  order.paymentStatus = 'paid';
  db.orders.push(order);

  const first = financeV2.capturePaidOrder(db, order, { actor: 'finance-test' });
  const replay = financeV2.capturePaidOrder(db, order, { actor: 'finance-test' });
  const sale = db.financeV2.journalEntries.find((entry) => entry.source === 'order.paid');
  const receiptEntries = db.financeV2.journalEntries.filter((entry) => entry.source === 'order.payment_received');

  assert.equal(first.journalEntry?.status, 'posted');
  assert.equal(replay.idempotentReplay, true);
  assert.equal(receiptEntries.length, 2);
  assert.equal(receiptEntries.find((entry) => entry.id === cashReceipt.journalEntry.id)?.lines[0].debitIrr, 3000);
  assert.equal(receiptEntries.find((entry) => entry.id === cardReceipt.journalEntry.id)?.lines[0].debitIrr, 7000);
  assert.deepEqual(sale.lines.filter((line) => line.accountCode === '2500' && line.debitIrr > 0)
    .map((line) => line.debitIrr).sort((a, b) => a - b), [3000, 7000]);
  assert.equal(sale.lines.some((line) => ['1110', '1320'].includes(line.accountCode) && line.debitIrr > 0), false);
  assert.equal(db.financeV2.payments.length, 2);
  assert.equal(db.financeV2.reconciliationItems.filter((item) => item.kind === 'payment').length, 1);
  assert.equal(db.financeV2.reconciliationItems.find((item) => item.kind === 'payment')?.journalEntryId, cardReceipt.journalEntry.id);
  assert.equal(db.financeV2.events.filter((event) => event.source === 'order.payment_received').length, 2);
  assert.equal(db.financeV2.events.filter((event) => event.source === 'order.paid').length, 1);
});

test('blocked COGS can be retried with a new immutable event version after inventory is replenished', () => {
  const db = fixture({ onHand: 0 });
  const order = paidOrder('cogs-retry-after-receipt');
  db.orders.push(order);
  const first = financeV2.capturePaidOrder(db, order, { actor: 'finance-test' });
  const firstEvent = first.costing.event;
  const firstFingerprint = firstEvent.payloadFingerprint;

  assert.equal(firstEvent.status, 'blocked');
  assert.equal(firstEvent.error.code, 'inventory_shortage');
  db.accounting.inventoryItems[0].qtyOnHand = 1;

  const retried = financeV2.retryReadyOrderCogs(db, { branchId: 1, confirmed: true }, 'finance-test');
  const cogsEvents = db.financeV2.events.filter((event) => event.source === 'order.cogs');
  const postedCogsEntries = db.financeV2.journalEntries.filter((entry) => entry.source === 'order.cogs' && entry.status === 'posted');

  assert.equal(retried.posted, 1);
  assert.equal(retried.remainingBlocked, 0);
  assert.equal(cogsEvents.length, 2);
  assert.deepEqual(cogsEvents.map((event) => event.sourceVersion), [1, 2]);
  assert.equal(cogsEvents[0].status, 'quarantined');
  assert.equal(cogsEvents[0].error.code, 'order_cogs_attempt_superseded');
  assert.equal(cogsEvents[0].payloadFingerprint, firstFingerprint);
  assert.equal(cogsEvents[0].payload.supersededByEventId, cogsEvents[1].id);
  assert.equal(cogsEvents[1].payload.retryOfEventId, cogsEvents[0].id);
  assert.equal(cogsEvents[1].status, 'posted');
  assert.equal(postedCogsEntries.length, 1);
  assert.equal(db.financeV2.inventoryMovements.filter((movement) => movement.source === 'order.cogs').length, 1);
});

test('a blocked COGS retry with no order timestamp reuses the persisted event time and identity', () => {
  const db = fixture();
  const order = paidOrder('cogs-retry-no-timestamp');
  delete order.paidAt;
  delete order.createdAt;
  db.orders.push(order);

  const first = financeV2.capturePaidOrder(db, order, { actor: 'finance-test' });
  const firstEvent = first.costing.event;
  financeV2.retryReadyOrderCogs(db, { branchId: 1, confirmed: true }, 'finance-test');
  financeV2.retryReadyOrderCogs(db, { branchId: 1, confirmed: true }, 'finance-test');

  const retries = db.financeV2.events.filter((event) => event.source === 'order.cogs');
  assert.equal(firstEvent.error.code, 'sale_date_invalid');
  assert.equal(retries.length, 1);
  assert.equal(retries[0].sourceVersion, 1);
  assert.equal(retries[0].status, 'blocked');
});

test('fractional Toman payment and refund amounts are not rounded into a balanced sale', () => {
  const db = fixture();
  for (const partialPayments of [
    [{ id: 'fractional-payment', tender: 'cash', amount: 99.9 }],
    [{ id: 'fractional-refund', tender: 'cash', amount: 100, refundedAmount: 0.1 }],
  ]) {
    const result = financeV2.salesLines(paidOrder('invalid-tender-amount', partialPayments), db);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'payment_tender_invalid');
  }
});

test('fractional legacy Toman line amounts cannot produce a rounded revenue snapshot', () => {
  assert.equal(orderCosting.legacyOrderAmountToIrr(999.9), null);
  const db = fixture();
  const result = orderCosting.buildOrderCosting(db, {
    id: 'fractional-line-total', branchId: 1, paidAt: PAID_AT,
    items: [{ id: 'line-1', menuItemId: 'dish-1', qty: 1, lineTotal: 999.9 }],
  });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'order_line_sales_amount_invalid'));
  assert.deepEqual(result.snapshots, []);
});
