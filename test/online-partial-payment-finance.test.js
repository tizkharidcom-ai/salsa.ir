'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');
const financeV2 = require('../server/finance-v2');
const { paymentAttemptTransition } = require('../server/payment-attempt-transitions');

const serverSource = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
const settleStart = serverSource.indexOf('function settlePaymentAttempt(');
const settleEnd = serverSource.indexOf('\nfunction publishPaymentCommitEffects', settleStart);
assert.ok(settleStart >= 0 && settleEnd > settleStart, 'server payment settlement function must be available to this isolated integration harness');

const settlePaymentAttempt = new Function(
  'db', 'paymentAttemptTransition', 'nextOrderStatusAfterPayment', 'canTransitionOrder',
  'appendOrderStatus', 'financeV2', 'recordAudit',
  `${serverSource.slice(settleStart, settleEnd)}\nreturn settlePaymentAttempt;`,
);

function fixture() {
  const order = {
    id: 71001,
    orderNo: 'PO-1',
    branchId: 4,
    fulfillment: 'pickup',
    paymentMethod: 'online',
    total: 1000,
    amountPaid: 0,
    paymentStatus: 'pending',
    status: 'pending_online',
    partialPayments: [],
    items: [{ id: 'line-1', name: 'Test item', qty: 1, price: 1000, lineTotal: 1000 }],
    createdAt: '2026-09-24T10:00:00.000Z',
  };
  const db = {
    orders: [order],
    financeV2: {
      rollout: { captureEnabled: true, enabledBranchIds: [] },
      fiscalPeriods: [{
        id: 'open-4', branchId: 4, startDate: '2026-01-01', endDate: '2026-12-31', status: 'open',
      }],
      events: [], payments: [], journalEntries: [], reconciliationItems: [], idempotency: {},
    },
  };
  const settle = settlePaymentAttempt(
    db,
    paymentAttemptTransition,
    (candidate) => candidate.paymentStatus === 'paid' ? 'awaiting_confirmation' : null,
    () => true,
    (candidate, status) => { candidate.status = status; },
    financeV2,
    () => undefined,
  );
  return { db, order, settle };
}

function attempt(id, amount) {
  return {
    id, orderId: 71001, branchId: 4,
    tender: 'online', provider: 'sandbox', mode: 'sandbox', amount,
    status: 'pending', createdAt: '2026-09-24T10:01:00.000Z',
  };
}

function callCapture(settle, payment, reference) {
  return settle(payment, { status: 'paid', reference, source: 'isolated-test-capture' });
}

test('each partial online capture posts one idempotent Finance V2 receipt; sale posts once at full coverage', () => {
  const { db, order, settle } = fixture();
  const firstAttempt = attempt('capture-1', 350);

  const first = callCapture(settle, firstAttempt, 'provider-ref-1');
  assert.equal(first.order.paymentStatus, 'partial');
  assert.equal(first.order.amountPaid, 350);
  assert.equal(first.order.status, 'pending_online', 'partial capture must not advance the order to the kitchen');
  assert.equal(db.financeV2.events.filter((event) => event.source === 'order.payment_received').length, 1);
  assert.equal(db.financeV2.payments.length, 1);
  assert.equal(db.financeV2.journalEntries.length, 1);
  assert.equal(db.financeV2.journalEntries[0].lines.find((line) => line.accountCode === '1310').debitIrr, 3500);
  assert.equal(db.financeV2.journalEntries[0].lines.find((line) => line.accountCode === '2500').creditIrr, 3500);
  assert.equal(db.financeV2.journalEntries.some((entry) => entry.lines.some((line) => line.accountCode === '4110' || line.accountCode === '4120')), false);

  const replay = callCapture(settle, firstAttempt, 'provider-ref-1');
  assert.equal(replay.idempotent, true);
  assert.equal(db.financeV2.events.filter((event) => event.source === 'order.payment_received').length, 1);
  assert.equal(db.financeV2.payments.length, 1);
  assert.equal(db.financeV2.journalEntries.length, 1);

  const secondAttempt = attempt('capture-2', 650);
  const second = callCapture(settle, secondAttempt, 'provider-ref-2');
  assert.equal(second.order.paymentStatus, 'paid');
  assert.equal(second.order.amountPaid, 1000);
  assert.equal(second.order.status, 'awaiting_confirmation');
  assert.equal(db.financeV2.events.filter((event) => event.source === 'order.payment_received').length, 2);
  assert.equal(db.financeV2.payments.length, 2);
  assert.equal(db.financeV2.journalEntries.length, 3, 'two receipts plus one sale journal');

  const sale = db.financeV2.journalEntries.find((entry) => entry.source === 'order.paid');
  assert.ok(sale);
  const depositDebits = sale.lines.filter((line) => line.accountCode === '2500' && line.debitIrr > 0);
  assert.deepEqual(depositDebits.map((line) => line.debitIrr).sort((a, b) => a - b), [3500, 6500]);
  assert.equal(sale.lines.some((line) => line.accountCode === '1310' && line.debitIrr > 0), false,
    'sale posting consumes the deposit liability; it must not debit the PSP clearing asset twice');
  assert.equal(sale.lines.find((line) => line.accountCode === '4120').creditIrr, 10000);

  const secondReplay = callCapture(settle, secondAttempt, 'provider-ref-2');
  assert.equal(secondReplay.idempotent, true);
  assert.equal(db.financeV2.events.filter((event) => event.source === 'order.payment_received').length, 2);
  assert.equal(db.financeV2.payments.length, 2);
  assert.equal(db.financeV2.journalEntries.length, 3);
  assert.equal(order.partialPayments.length, 2);
});

test('amount, tender, projection and over-capture mismatches fail closed without a Finance receipt', () => {
  for (const [label, mutate, expectedCode] of [
    ['fractional amount', (payment) => { payment.amount = 350.5; }, 'online_payment_amount_invalid'],
    ['wrong attempt tender', (payment) => { payment.tender = 'cash'; }, 'online_payment_tender_invalid'],
    ['wrong order tender', (payment, order) => { order.paymentMethod = 'cashier'; }, 'online_payment_tender_invalid'],
  ]) {
    const { db, order } = fixture();
    const payment = attempt(`invalid-${label.replaceAll(' ', '-')}`, 350);
    payment.status = 'paid';
    mutate(payment, order);
    assert.throws(() => financeV2.captureOnlinePaidOrder(db, order, payment), { code: expectedCode, status: 409 }, label);
    assert.equal(order.partialPayments.length, 0, `${label}: rejected capture must not mutate the order`);
    assert.equal(db.financeV2.events.length, 0, `${label}: rejected capture must not write an event`);
    assert.equal(db.financeV2.payments.length, 0, `${label}: rejected capture must not project a finance payment`);
    assert.equal(db.financeV2.journalEntries.length, 0, `${label}: rejected capture must not post a journal`);
  }

  const mismatchedProjection = fixture();
  mismatchedProjection.order.amountPaid = 1;
  const projectionAttempt = attempt('projection-mismatch', 350);
  projectionAttempt.status = 'paid';
  assert.throws(() => financeV2.captureOnlinePaidOrder(mismatchedProjection.db, mismatchedProjection.order, projectionAttempt), {
    code: 'online_payment_projection_mismatch', status: 409,
  });
  assert.equal(mismatchedProjection.db.financeV2.events.length, 0);

  const { db, order } = fixture();
  const first = attempt('valid-capture', 700);
  first.status = 'paid';
  financeV2.captureOnlinePaidOrder(db, order, first);
  const overCapture = attempt('over-capture', 301);
  overCapture.status = 'paid';
  assert.throws(() => financeV2.captureOnlinePaidOrder(db, order, overCapture), {
    code: 'online_payment_amount_exceeds_due', status: 409,
  });
  assert.equal(order.amountPaid, 700);
  assert.equal(order.partialPayments.length, 1);
  assert.equal(db.financeV2.events.filter((event) => event.source === 'order.payment_received').length, 1);
  assert.equal(db.financeV2.payments.length, 1);
  assert.equal(db.financeV2.journalEntries.length, 1);
});

test('a replayed capture id cannot be reused with a different amount or provider reference', () => {
  const { db, order } = fixture();
  const payment = attempt('capture-identity', 400);
  payment.status = 'paid';
  payment.reference = 'capture-identity-ref';
  financeV2.captureOnlinePaidOrder(db, order, payment);

  assert.throws(() => financeV2.captureOnlinePaidOrder(db, order, { ...payment, amount: 401 }), {
    code: 'online_payment_identity_conflict', status: 409,
  });
  assert.throws(() => financeV2.captureOnlinePaidOrder(db, order, { ...payment, reference: 'different-ref' }), {
    code: 'online_payment_identity_conflict', status: 409,
  });
  assert.equal(order.amountPaid, 400);
  assert.equal(db.financeV2.events.filter((event) => event.source === 'order.payment_received').length, 1);
  assert.equal(db.financeV2.payments.length, 1);
  assert.equal(db.financeV2.journalEntries.length, 1);
});
