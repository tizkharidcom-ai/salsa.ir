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
    id: 701,
    branchId: 7,
    fulfillment: 'dine_in',
    status: 'sent_to_kitchen',
    column: 'new',
    paymentMethod: 'cashier',
    paymentStatus: 'unpaid',
    items: [{ key: 'line-1', name: 'Test item' }],
    ...overrides,
  };
}

function acceptedRestaurantDelivery(overrides = {}) {
  const acceptedAt = new Date(Date.now() - 10_000).toISOString();
  const handoffAt = new Date(Date.now() - 5_000).toISOString();
  return ticket({
    id: 702,
    fulfillment: 'delivery',
    deliveryAcceptance: {
      status: 'accepted',
      source: 'restaurant',
      reference: 'kds-acceptance-0007',
      acceptedAt,
      acceptedBy: { phone: '09120000007', role: 'manager' },
    },
    statusHistory: [{ status: 'sent_to_kitchen', at: handoffAt }],
    ...overrides,
  });
}

test('failed and pending online attempts never enter KDS, while explicit COD/unpaid remains eligible', () => {
  const failedOnline = ticket({
    id: 711,
    paymentMethod: 'online',
    paymentStatus: 'failed',
    paymentAttemptId: 'attempt-711',
    paymentAttempt: { id: 'attempt-711', orderId: 711, branchId: 7, tender: 'online', status: 'failed' },
  });
  const pendingOnline = ticket({
    id: 712,
    paymentMethod: 'online',
    paymentStatus: 'pending',
    paymentAttemptId: 'attempt-712',
    paymentAttempt: { id: 'attempt-712', orderId: 712, branchId: 7, tender: 'online', status: 'pending' },
  });
  const codUnpaid = ticket({ id: 713, paymentMethod: 'cashier', paymentStatus: 'unpaid' });

  const queue = prepareKitchenQueue([failedOnline, pendingOnline, codUnpaid], { branchId: 7 });
  assert.deepEqual(queue.tickets.map((entry) => entry.id), [713]);
  assert.equal(queue.counts.blockedReasons.paymentAttemptFailed, 1);
  assert.equal(queue.counts.blockedReasons.paymentNotSettled, 1);
  assert.equal(queue.tickets[0].paymentStatus, 'unpaid', 'KDS eligibility does not imply payment collection');
  assert.equal(transitionKitchenTicket(failedOnline, 'start_ticket').reason, 'paymentAttemptFailed');
  assert.equal(transitionKitchenTicket(codUnpaid, 'start_ticket').ok, true);
});

test('paid manual and mixed cash/manual-card settlement remain eligible without conflating tender and fulfillment', () => {
  const manuallyPaid = ticket({
    id: 721,
    paymentMethod: 'cashier',
    paymentStatus: 'paid',
    paymentTender: 'manual_card',
    paymentTenders: ['cash', 'manual_card'],
  });
  const explicitManualCard = ticket({ id: 722, paymentMethod: 'manual_card', paymentStatus: 'paid' });
  const cashPaid = ticket({ id: 723, paymentMethod: 'cash', paymentStatus: 'paid' });

  const queue = prepareKitchenQueue([manuallyPaid, explicitManualCard, cashPaid], { branchId: 7 });
  assert.deepEqual(new Set(queue.tickets.map((entry) => entry.id)), new Set([721, 722, 723]));
  assert.equal(queue.tickets.length, 3);
  assert.equal(manuallyPaid.fulfillment, 'dine_in');
  assert.equal(manuallyPaid.paymentTender, 'manual_card');
});

test('paid online orders need a uniquely linked paid attempt or persisted attempt reference', () => {
  const linkedPaidAttempt = ticket({
    id: 731,
    paymentMethod: 'online',
    paymentStatus: 'paid',
    paymentAttemptId: 'attempt-731',
    paymentAttempt: { id: 'attempt-731', orderId: 731, branchId: 7, tender: 'online', status: 'paid' },
  });
  const historyLinkedAttempt = ticket({
    id: 732,
    paymentMethod: 'online',
    paymentStatus: 'paid',
    paymentAttemptId: 'attempt-732',
    statusHistory: [{ status: 'sent_to_kitchen', meta: { paymentAttemptId: 'attempt-732' } }],
  });
  const missingProvenance = ticket({ id: 733, paymentMethod: 'online', paymentStatus: 'paid' });
  const failedAttemptProjectedPaid = ticket({
    id: 734,
    paymentMethod: 'online',
    paymentStatus: 'paid',
    paymentAttemptId: 'attempt-734',
    paymentAttempt: { id: 'attempt-734', orderId: 734, branchId: 7, tender: 'online', status: 'failed' },
  });
  const wrongOrderAttempt = ticket({
    id: 735,
    paymentMethod: 'online',
    paymentStatus: 'paid',
    paymentAttemptId: 'attempt-735',
    paymentAttempt: { id: 'attempt-735', orderId: 999, branchId: 7, tender: 'online', status: 'paid' },
  });

  const queue = prepareKitchenQueue([
    linkedPaidAttempt,
    historyLinkedAttempt,
    missingProvenance,
    failedAttemptProjectedPaid,
    wrongOrderAttempt,
  ], { branchId: 7 });
  assert.deepEqual(queue.tickets.map((entry) => entry.id), [731, 732]);
  assert.equal(queue.counts.blockedReasons.paymentProvenanceInvalid, 3);
  assert.equal(kitchenPaymentEligibility(linkedPaidAttempt).eligible, true);
  assert.equal(transitionKitchenTicket(failedAttemptProjectedPaid, 'start_ticket').error, 'kitchen_payment_not_eligible');
});

test('ambiguous payment method and conflicting online tender fail closed', () => {
  const unknownMethod = ticket({ id: 741, paymentMethod: 'crypto', paymentStatus: 'unpaid' });
  const explicitlyNullMethod = ticket({ id: 742, paymentMethod: null, paymentStatus: 'unpaid' });
  const contradictoryTender = ticket({
    id: 743,
    paymentMethod: 'online',
    paymentStatus: 'paid',
    paymentTender: 'cash',
    paymentAttemptId: 'attempt-743',
    paymentAttempt: { id: 'attempt-743', orderId: 743, branchId: 7, tender: 'online', status: 'paid' },
  });

  const queue = prepareKitchenQueue([unknownMethod, explicitlyNullMethod, contradictoryTender], { branchId: 7 });
  assert.deepEqual(queue.tickets, []);
  assert.equal(queue.counts.blockedReasons.paymentMethodAmbiguous, 2);
  assert.equal(queue.counts.blockedReasons.paymentProvenanceInvalid, 1);
});

test('restaurant acceptance remains a separate required gate for delivery, independent of payment state', () => {
  const acceptedUnpaidCod = acceptedRestaurantDelivery({
    id: 751,
    paymentMethod: 'cashier',
    paymentStatus: 'unpaid',
  });
  const rejectedButPaid = ticket({
    id: 752,
    fulfillment: 'delivery',
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    deliveryAcceptance: { status: 'rejected' },
  });
  const awaitingButPaid = ticket({
    id: 753,
    fulfillment: 'delivery',
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    deliveryAcceptance: { status: 'pending' },
  });

  const queue = prepareKitchenQueue([acceptedUnpaidCod, rejectedButPaid, awaitingButPaid], { branchId: 7 });
  assert.deepEqual(queue.tickets.map((entry) => entry.id), [751]);
  assert.equal(queue.tickets[0].paymentStatus, 'unpaid');
  assert.equal(queue.counts.blockedReasons.acceptanceRejected, 1);
  assert.equal(queue.counts.blockedReasons.acceptanceRequired, 1);
  assert.equal(transitionKitchenTicket(rejectedButPaid, 'start_ticket').error, 'delivery_acceptance_rejected');
  assert.equal(transitionKitchenTicket(acceptedUnpaidCod, 'start_ticket').ok, true);
});

test('branch-scoped KDS filtering keeps eligible payment tickets inside their branch', () => {
  const branchSeven = ticket({ id: 761, branchId: 7 });
  const branchEight = ticket({ id: 762, branchId: 8 });

  assert.deepEqual(prepareKitchenQueue([branchSeven, branchEight], { branchId: 7 }).tickets.map((entry) => entry.id), [761]);
  assert.deepEqual(prepareKitchenQueue([branchSeven, branchEight], { branchId: 8 }).tickets.map((entry) => entry.id), [762]);
  assert.deepEqual(prepareKitchenQueue([branchSeven, branchEight], { branchId: 'invalid' }).tickets, []);
  assert.deepEqual(prepareKitchenQueue([branchSeven, ticket({ id: 763, branchId: undefined })], { branchId: 7 }).tickets.map((entry) => entry.id), [761]);
});
