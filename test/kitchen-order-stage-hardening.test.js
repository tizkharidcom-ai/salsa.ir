'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareKitchenQueue, transitionKitchenTicket } = require('../server/kitchen-queue');

function acceptedRestaurantDelivery() {
  const acceptedAt = new Date(Date.now() - 10_000).toISOString();
  const handoffAt = new Date(Date.now() - 5_000).toISOString();
  return {
    id: 'delivery-accepted-unpaid',
    branchId: 7,
    fulfillment: 'delivery',
    status: 'sent_to_kitchen',
    paymentStatus: 'unpaid',
    column: 'new',
    deliveryAcceptance: {
      status: 'accepted',
      source: 'restaurant',
      reference: 'acceptance-stage-0007',
      acceptedAt,
      acceptedBy: { phone: '09120000007', role: 'manager' },
    },
    statusHistory: [{ status: 'sent_to_kitchen', at: handoffAt }],
  };
}

test('accepted unpaid delivery enters KDS; unaccepted delivery stays blocked and payment remains independent', () => {
  const accepted = acceptedRestaurantDelivery();
  const waiting = {
    ...accepted,
    id: 'delivery-waiting',
    deliveryAcceptance: { status: 'pending' },
  };

  const queue = prepareKitchenQueue([waiting, accepted], { branchId: 7 });
  assert.deepEqual(queue.tickets.map((ticket) => ticket.id), ['delivery-accepted-unpaid']);
  assert.equal(queue.tickets[0].paymentStatus, 'unpaid');
  assert.equal(queue.counts.blockedReasons.acceptanceRequired, 1);
  assert.equal(transitionKitchenTicket(waiting, 'start_ticket').error, 'delivery_acceptance_required');

  const started = transitionKitchenTicket(accepted, 'start_ticket');
  assert.equal(started.ok, true);
  assert.equal(started.ticket.status, 'preparing');
  assert.equal(started.ticket.paymentStatus, 'unpaid', 'kitchen progress must not collect or rewrite payment');
});

test('KDS cannot mark a ticket ready while any item is incomplete or a course is held', () => {
  const preparing = {
    id: 21,
    status: 'preparing',
    paymentStatus: 'partial',
    column: 'preparing',
    items: [
      { key: '0:101', completedAt: '2026-09-24T10:00:00.000Z' },
      { key: '1:102', completedAt: null },
    ],
    heldCourseItems: [],
  };

  const incomplete = transitionKitchenTicket(preparing, 'complete_ticket');
  assert.deepEqual(incomplete, {
    ok: false,
    error: 'kds_ticket_incomplete',
    current: 'preparing',
    incomplete: ['1:102'],
  });

  const held = transitionKitchenTicket({
    ...preparing,
    items: [{ key: '0:101', completedAt: '2026-09-24T10:00:00.000Z' }],
    heldCourseItems: [{ key: '1:202', courseStatus: 'hold' }],
  }, 'complete_ticket');
  assert.equal(held.error, 'kds_ticket_incomplete');
  assert.deepEqual(held.incomplete, ['1:202']);
  assert.equal(held.current, 'preparing');
});

test('complete transition requires a non-empty, fully completed snapshot and preserves payment state', () => {
  const empty = transitionKitchenTicket({
    status: 'preparing', column: 'preparing', paymentStatus: 'unpaid', items: [], heldCourseItems: [],
  }, 'complete_ticket');
  assert.equal(empty.error, 'kds_ticket_incomplete');

  const ticket = {
    status: 'preparing',
    column: 'preparing',
    paymentStatus: 'unpaid',
    items: [{ key: '0:101', completedAt: '2026-09-24T10:00:00.000Z' }],
    heldCourseItems: [],
  };
  const ready = transitionKitchenTicket(ticket, 'complete_ticket');
  assert.equal(ready.ok, true);
  assert.equal(ready.ticket.status, 'ready');
  assert.equal(ready.ticket.paymentStatus, 'unpaid');
  assert.equal(ticket.status, 'preparing', 'the pure transition must not mutate its source snapshot');
  assert.equal(transitionKitchenTicket(ready.ticket, 'complete_ticket').idempotent, true);
});

test('ready transition rejects malformed completion timestamps and malformed held-course snapshots', () => {
  const invalidTimestamp = {
    status: 'preparing',
    column: 'preparing',
    items: [{ key: 'line-invalid-time', completedAt: 'not-a-timestamp' }],
    heldCourseItems: [],
  };
  const rejected = transitionKitchenTicket(invalidTimestamp, 'complete_ticket');
  assert.equal(rejected.error, 'kds_ticket_incomplete');
  assert.deepEqual(rejected.incomplete, ['line-invalid-time']);

  const malformedHeldSnapshot = transitionKitchenTicket({
    status: 'preparing',
    column: 'preparing',
    items: [{ key: 'line-complete', completedAt: '2026-09-24T10:00:00.000Z' }],
    heldCourseItems: null,
  }, 'complete_ticket');
  assert.equal(malformedHeldSnapshot.error, 'kds_ticket_incomplete');
  assert.deepEqual(malformedHeldSnapshot.incomplete, ['ticket']);

  const staleReady = transitionKitchenTicket({
    status: 'ready',
    column: 'ready',
    items: [{ key: 'line-invalid-time', completedAt: 'not-a-timestamp' }],
    heldCourseItems: [],
  }, 'complete_ticket');
  assert.equal(staleReady.error, 'kds_ticket_incomplete', 'idempotent replay must not bless an invalid ready snapshot');
});

test('serving remains outside the KDS state machine after a ticket is ready', () => {
  const served = transitionKitchenTicket({ status: 'ready', column: 'ready' }, 'serve_ticket');
  assert.equal(served.ok, false);
  assert.equal(served.error, 'kitchen_action_invalid');
  assert.deepEqual(served.allowed, ['recall_ticket']);
});
