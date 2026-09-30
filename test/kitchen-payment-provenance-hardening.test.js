'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  kitchenPaymentEligibility,
  prepareKitchenQueue,
  transitionKitchenTicket,
} = require('../server/kitchen-queue');

function ticket(overrides = {}) {
  return {
    id: 'kds-payment-provenance-1',
    branchId: 7,
    fulfillment: 'dine_in',
    status: 'sent_to_kitchen',
    column: 'new',
    paymentMethod: 'cashier',
    paymentStatus: 'paid',
    paymentTender: 'cash',
    paymentTenders: ['cash'],
    ...overrides,
  };
}

test('KDS rejects non-local tender evidence on cashier orders while preserving cash plus manual-card settlement', () => {
  const contradictorySingleTender = ticket({ paymentTenders: ['cash', 'online'] });
  const contradictoryLastTender = ticket({ paymentTender: 'online' });
  const malformedTenderList = ticket({ paymentTenders: 'cash,manual_card' });
  const mixedLocalSettlement = ticket({
    paymentTender: 'manual_card',
    paymentTenders: ['cash', 'manual_card'],
  });

  for (const invalid of [contradictorySingleTender, contradictoryLastTender, malformedTenderList]) {
    assert.deepEqual(kitchenPaymentEligibility(invalid), {
      eligible: false,
      reason: 'paymentProvenanceInvalid',
    });
    assert.equal(transitionKitchenTicket(invalid, 'start_ticket').error, 'kitchen_payment_not_eligible');
  }

  assert.equal(kitchenPaymentEligibility(mixedLocalSettlement).eligible, true);
  assert.deepEqual(prepareKitchenQueue([
    contradictorySingleTender,
    contradictoryLastTender,
    malformedTenderList,
    mixedLocalSettlement,
  ], { branchId: 7 }).tickets.map((entry) => entry.id), [mixedLocalSettlement.id]);
  assert.equal(prepareKitchenQueue([contradictorySingleTender], { branchId: 7 }).counts.blockedReasons.paymentProvenanceInvalid, 1);
});

test('online tender evidence remains exclusive to verified online payment attempts', () => {
  const malformedOnlineTenderList = ticket({
    id: 'kds-online-unpaid',
    paymentMethod: 'online',
    paymentStatus: 'paid',
    paymentTender: 'online',
    paymentTenders: 'online',
    paymentAttemptId: 'attempt-kds-online',
    paymentAttempt: {
      id: 'attempt-kds-online',
      orderId: 'kds-online-unpaid',
      branchId: 7,
      tender: 'online',
      status: 'paid',
    },
  });

  assert.deepEqual(kitchenPaymentEligibility(malformedOnlineTenderList), {
    eligible: false,
    reason: 'paymentProvenanceInvalid',
  });
});
