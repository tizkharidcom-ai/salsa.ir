'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const financeV2 = require('../server/finance-v2');

function fixture() {
  return {
    orders: [],
    financeV2: {
      fiscalPeriods: [{
        id: 'open-branch-4', branchId: 4,
        startDate: '2026-01-01', endDate: '2026-12-31', status: 'open',
      }],
      journalEntries: [],
    },
  };
}

function orderSaleEvent(db, sourceVersion, amountIrr) {
  return financeV2.recordEvent(db, {
    source: 'order.paid',
    sourceId: 'order-ledger-hardening-1',
    sourceVersion,
    idempotencyKey: `order-ledger-hardening-1-v${sourceVersion}`,
    branchId: 4,
    occurredAt: `2026-09-20T10:0${sourceVersion}:00.000Z`,
    amountIrr,
    payload: { tenderSnapshot: [{ tender: 'cash', amountIrr }] },
  }).event;
}

function saleLines(amountIrr, tenderAccount = '1110') {
  return [
    { accountCode: tenderAccount, debitIrr: amountIrr, creditIrr: 0, branchId: 4, costCenter: 'branch:4' },
    { accountCode: '4110', debitIrr: 0, creditIrr: amountIrr, branchId: 4, costCenter: 'branch:4' },
  ];
}

test('a newer order-paid event cannot silently reuse an older posted sale journal', () => {
  const db = fixture();
  const firstEvent = orderSaleEvent(db, 1, 10_000);
  const firstJournal = financeV2.__test.postEventJournal(
    db, firstEvent, saleLines(10_000), 'order sale v1', 'finance-test',
  );

  const revisedEvent = orderSaleEvent(db, 2, 12_000);
  assert.throws(() => financeV2.__test.postEventJournal(
    db, revisedEvent, saleLines(12_000, '1320'), 'order sale v2', 'finance-test',
  ), {
    code: 'finance_journal_source_version_conflict',
    status: 409,
    details: {
      source: 'order.paid',
      sourceId: 'order-ledger-hardening-1',
      postedEventVersion: 1,
      requestedEventVersion: 2,
      journalEntryId: firstJournal.id,
    },
  });

  assert.equal(db.financeV2.journalEntries.length, 1);
  assert.equal(db.financeV2.journalEntries[0].debitIrr, 10_000);
  assert.equal(db.financeV2.journalEntries[0].lines[0].accountCode, '1110');
  assert.equal(revisedEvent.status, 'pending');
  assert.equal(revisedEvent.journalEntryId, null);
});

test('order capture does not project a revised tender set against the original sale journal', () => {
  const db = fixture();
  const order = {
    id: 'order-ledger-capture-1', branchId: 4, total: 1_000,
    paymentStatus: 'paid', paymentRevision: 1, paymentMethod: 'cash',
    paidAt: '2026-09-20T10:00:00.000Z', createdAt: '2026-09-20T10:00:00.000Z',
    partialPayments: [{ id: 'cash-leg-1', tender: 'cash', amount: 1_000, at: '2026-09-20T10:00:00.000Z' }],
  };
  db.orders.push(order);
  const first = financeV2.capturePaidOrder(db, order, {
    actor: 'finance-test', idempotencyKey: 'order-ledger-capture-v1',
  });
  assert.equal(first.journalEntry.debitIrr, 10_000);

  order.total = 1_200;
  order.paymentRevision = 2;
  order.paymentMethod = 'manual_card';
  order.partialPayments = [{
    id: 'card-leg-2', tender: 'manual_card', amount: 1_200,
    reference: 'isolated-pos-reference', at: '2026-09-20T10:01:00.000Z',
  }];

  assert.throws(() => financeV2.capturePaidOrder(db, order, {
    actor: 'finance-test', idempotencyKey: 'order-ledger-capture-v2',
  }), {
    code: 'finance_journal_source_version_conflict', status: 409,
  });

  assert.equal(db.financeV2.events.filter((event) => event.source === 'order.paid').length, 1);
  assert.equal(db.financeV2.payments.length, 1);
  assert.equal(db.financeV2.payments[0].amountIrr, 10_000);
  assert.equal(db.financeV2.payments[0].tender, 'cash');
  assert.equal(db.financeV2.journalEntries.length, 1);
  assert.equal(db.financeV2.journalEntries[0].debitIrr, 10_000);
  assert.equal(db.financeV2.journalEntries[0].lines[0].accountCode, '1110');
});

test('replaying the exact event remains linked to its original posted journal', () => {
  const db = fixture();
  const event = orderSaleEvent(db, 1, 10_000);
  const first = financeV2.__test.postEventJournal(
    db, event, saleLines(10_000), 'order sale', 'finance-test',
  );
  const replay = financeV2.__test.postEventJournal(
    db, event, saleLines(10_000), 'order sale', 'finance-test',
  );

  assert.equal(replay.id, first.id);
  assert.equal(db.financeV2.journalEntries.length, 1);
  assert.equal(event.status, 'posted');
});
