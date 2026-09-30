'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareKitchenQueue, transitionKitchenTicket } = require('../server/kitchen-queue');

test('normalized complete action cannot bypass item-completion guard or bless an invalid ready replay', () => {
  const incompletePreparing = {
    id: 'incomplete-preparing',
    status: 'preparing',
    column: 'preparing',
    paymentMethod: 'cashier',
    paymentStatus: 'unpaid',
    items: [{ key: 'line-1', completedAt: null }],
    heldCourseItems: [],
  };

  const preparingResult = transitionKitchenTicket(incompletePreparing, ' complete_ticket ');
  assert.equal(preparingResult.ok, false);
  assert.equal(preparingResult.error, 'kds_ticket_incomplete');
  assert.deepEqual(preparingResult.incomplete, ['line-1']);
  assert.equal(incompletePreparing.status, 'preparing', 'rejected transitions must not mutate the source ticket');

  const invalidReadyReplay = transitionKitchenTicket({
    ...incompletePreparing,
    id: 'invalid-ready-replay',
    status: 'ready',
    column: 'ready',
  }, 'complete_ticket ');
  assert.equal(invalidReadyReplay.ok, false);
  assert.equal(invalidReadyReplay.error, 'kds_ticket_incomplete');
  assert.deepEqual(invalidReadyReplay.incomplete, ['line-1']);
});

test('restaurant acceptance still gates delivery entry into the kitchen', () => {
  const waiting = {
    id: 'delivery-awaiting-acceptance',
    fulfillment: 'delivery',
    status: 'sent_to_kitchen',
    column: 'new',
    paymentMethod: 'cashier',
    paymentStatus: 'unpaid',
    deliveryAcceptance: { status: 'pending' },
  };

  const result = transitionKitchenTicket(waiting, ' start_ticket ');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'delivery_acceptance_required');
  assert.equal(waiting.status, 'sent_to_kitchen');
});

test('branch-scoped queues fail closed for empty, malformed, and coerced branch identifiers', () => {
  const tickets = [
    { id: 'branch-7', branchId: 7, status: 'sent_to_kitchen', column: 'new', paymentMethod: 'cashier', paymentStatus: 'unpaid' },
    { id: 'branch-8', branchId: 8, status: 'sent_to_kitchen', column: 'new', paymentMethod: 'cashier', paymentStatus: 'unpaid' },
    { id: 'boolean-branch', branchId: true, status: 'sent_to_kitchen', column: 'new', paymentMethod: 'cashier', paymentStatus: 'unpaid' },
    { id: 'missing-branch', status: 'sent_to_kitchen', column: 'new', paymentMethod: 'cashier', paymentStatus: 'unpaid' },
  ];

  assert.deepEqual(prepareKitchenQueue(tickets, { branchId: '7' }).tickets.map((ticket) => ticket.id), ['branch-7']);
  assert.deepEqual(prepareKitchenQueue(tickets, { branchId: '' }).tickets, [],
    'an explicitly empty branch must not widen the queue to all branches');
  assert.deepEqual(prepareKitchenQueue(tickets, { branchId: true }).tickets, [],
    'JavaScript coercion must not turn a boolean into a valid branch identifier');
  assert.deepEqual(prepareKitchenQueue(tickets, { branchId: 1 }).tickets, [],
    'malformed ticket branch ids must not be coerced into a real branch');
});

test('idempotent KDS replays revalidate delivery acceptance and online payment evidence', () => {
  const validReady = {
    id: 'valid-ready-replay',
    status: 'ready',
    column: 'ready',
    paymentMethod: 'cashier',
    paymentStatus: 'unpaid',
    items: [{ key: 'line-1', completedAt: '2026-09-24T10:00:00.000Z' }],
    heldCourseItems: [],
  };
  const validReplay = transitionKitchenTicket(validReady, 'complete_ticket');
  assert.equal(validReplay.ok, true);
  assert.equal(validReplay.idempotent, true);
  assert.equal(validReplay.ticket, validReady);

  const unacceptedDeliveryReplay = transitionKitchenTicket({
    ...validReady,
    id: 'unaccepted-delivery-replay',
    fulfillment: 'delivery',
    deliveryAcceptance: { status: 'pending' },
  }, 'complete_ticket');
  assert.deepEqual(unacceptedDeliveryReplay, {
    ok: false,
    error: 'delivery_acceptance_required',
    current: 'ready',
  });

  const failedOnlineReplay = transitionKitchenTicket({
    ...validReady,
    id: 'failed-online-replay',
    paymentMethod: 'online',
    paymentStatus: 'failed',
    paymentAttemptId: 'attempt-failed-replay',
    paymentAttempt: {
      id: 'attempt-failed-replay',
      orderId: 'failed-online-replay',
      branchId: 7,
      tender: 'online',
      status: 'failed',
    },
  }, 'complete_ticket');
  assert.deepEqual(failedOnlineReplay, {
    ok: false,
    error: 'kitchen_payment_not_eligible',
    current: 'ready',
    reason: 'paymentAttemptFailed',
  });
});

test('a paid online replay with an attempt from another branch is rejected', () => {
  const crossBranchAttempt = {
    id: 'cross-branch-attempt',
    status: 'ready',
    column: 'ready',
    branchId: 7,
    paymentMethod: 'online',
    paymentStatus: 'paid',
    paymentAttemptId: 'attempt-branch-8',
    paymentAttempt: {
      id: 'attempt-branch-8',
      orderId: 'cross-branch-attempt',
      branchId: 8,
      tender: 'online',
      status: 'paid',
    },
    items: [{ key: 'line-1', completedAt: '2026-09-24T10:00:00.000Z' }],
    heldCourseItems: [],
  };

  assert.deepEqual(transitionKitchenTicket(crossBranchAttempt, 'complete_ticket'), {
    ok: false,
    error: 'kitchen_payment_not_eligible',
    current: 'ready',
    reason: 'paymentProvenanceInvalid',
  });
});
