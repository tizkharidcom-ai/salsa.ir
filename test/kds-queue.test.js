'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareKitchenQueue, transitionKitchenTicket } = require('../server/kitchen-queue');

function acceptedByRestaurant(reference = 'delivery-accept-71', overrides = {}) {
  return {
    status: 'accepted',
    source: 'restaurant',
    acceptedAt: new Date(Date.now() - 1000).toISOString(),
    acceptedBy: { phone: '09123456789', role: 'manager' },
    reference,
    ...overrides,
  };
}

test('kitchen queue keeps every active ticket and counts tickets beyond the former 80-ticket cap', () => {
  const tickets = Array.from({ length: 123 }, (_, index) => ({
    id: index + 1,
    column: ['new', 'preparing', 'ready'][index % 3],
    createdAt: new Date(1_700_000_000_000 + index * 1000).toISOString(),
    kds: { priority: index === 121 },
  }));

  const result = prepareKitchenQueue(tickets);

  assert.equal(result.tickets.length, 123);
  assert.equal(new Set(result.tickets.map((ticket) => ticket.id)).size, 123);
  assert.equal(result.counts.new, 41);
  assert.equal(result.counts.preparing, 41);
  assert.equal(result.counts.ready, 41);
  assert.equal(result.tickets[0].id, 122);
  assert.equal(result.tickets[1].id, 1);
});

test('kitchen queue ordering is stable by priority then oldest creation time', () => {
  const result = prepareKitchenQueue([
    { id: 'later', createdAt: '2026-09-23T10:02:00.000Z', kds: { priority: false } },
    { id: 'priority', createdAt: '2026-09-23T10:03:00.000Z', kds: { priority: true } },
    { id: 'earlier', createdAt: '2026-09-23T10:01:00.000Z', kds: { priority: false } },
  ]);

  assert.deepEqual(result.tickets.map((ticket) => ticket.id), ['priority', 'earlier', 'later']);
});

test('tickets with missing or invalid timestamps stay visible but cannot jump ahead of dated work', () => {
  const result = prepareKitchenQueue([
    { id: 'missing', column: 'new' },
    { id: 'invalid', column: 'new', createdAt: 'not-a-date' },
    { id: 'newer', column: 'new', createdAt: '2026-09-23T10:02:00.000Z' },
    { id: 'older', column: 'new', createdAt: '2026-09-23T10:01:00.000Z' },
    { id: 'priority-undated', column: 'new', kds: { priority: true } },
  ]);

  assert.deepEqual(result.tickets.map((ticket) => ticket.id), [
    'priority-undated', 'older', 'newer', 'missing', 'invalid',
  ]);
  assert.equal(result.tickets.length, 5, 'timestamp problems do not discard operational tickets');
});

test('delivery tickets stay out of KDS until persisted restaurant acceptance has a reference, independently of payment', () => {
  const acceptance = acceptedByRestaurant();
  const kitchenHandoffAt = new Date(Date.parse(acceptance.acceptedAt) + 1_000).toISOString();
  const acceptedButUnpaid = {
    id: 'accepted-delivery', branchId: 7, fulfillment: 'delivery', status: 'sent_to_kitchen',
    paymentStatus: 'unpaid',
    statusAt: kitchenHandoffAt,
    statusHistory: [{ status: 'sent_to_kitchen', at: kitchenHandoffAt }],
    deliveryAcceptance: acceptance,
  };
  const unrecorded = {
    id: 'unrecorded', branchId: 7, fulfillment: 'delivery', status: 'paid', paymentStatus: 'paid',
  };
  const pending = {
    id: 'pending', branchId: 7, fulfillment: 'delivery', status: 'sent_to_kitchen', paymentStatus: 'unpaid',
    deliveryAcceptance: 'pending',
  };
  const rejected = {
    id: 'rejected', branchId: 7, fulfillment: 'delivery', status: 'preparing', paymentStatus: 'partial',
    deliveryAcceptance: 'rejected',
  };
  const forgedAcceptance = {
    id: 'forged', branchId: 7, fulfillment: 'delivery', status: 'ready', paymentStatus: 'paid',
    deliveryAcceptance: acceptedByRestaurant('not-restaurant', { source: 'cashier' }),
  };
  const dineIn = { id: 'dine-in', branchId: 7, fulfillment: 'dine_in', status: 'sent_to_kitchen', paymentStatus: 'unpaid' };
  const otherBranch = { ...unrecorded, id: 'other-branch', branchId: 8 };

  const result = prepareKitchenQueue(
    [acceptedButUnpaid, unrecorded, pending, rejected, forgedAcceptance, dineIn, otherBranch],
    { branchId: 7 },
  );

  assert.deepEqual(result.tickets.map((ticket) => ticket.id), ['accepted-delivery', 'dine-in']);
  assert.equal(result.tickets[0].paymentStatus, 'unpaid', 'acceptance does not rewrite or require payment');
  assert.deepEqual(result.counts, {
    new: 2,
    preparing: 0,
    ready: 0,
    cancelled: 0,
    blocked: 4,
    blockedReasons: {
      acceptanceRequired: 2,
      acceptanceRejected: 1,
      acceptanceProvenanceInvalid: 1,
    },
  });
});

test('accepted delivery requires canonical restaurant provenance, valid time, reference, and an authorized actor', () => {
  const invalidAcceptances = [
    ['string status only', 'accepted'],
    ['object status only', { status: 'accepted' }],
    ['short reference', acceptedByRestaurant('short')],
    ['malformed reference', acceptedByRestaurant('bad reference')],
    ['oversized reference', acceptedByRestaurant(`delivery-${'x'.repeat(160)}`)],
    ['missing source', acceptedByRestaurant('delivery-review-0002', { source: undefined })],
    ['invalid timestamp', acceptedByRestaurant('delivery-review-0003', { acceptedAt: 'not-a-date' })],
    ['future timestamp', acceptedByRestaurant('delivery-review-0004', { acceptedAt: new Date(Date.now() + 60_000).toISOString() })],
    ['missing actor phone', acceptedByRestaurant('delivery-review-0005', { acceptedBy: { role: 'manager' } })],
    ['oversized actor phone', acceptedByRestaurant('delivery-review-0008', { acceptedBy: { phone: '1'.repeat(65), role: 'manager' } })],
    ['untrusted actor role', acceptedByRestaurant('delivery-review-0006', { acceptedBy: { phone: '09123456789', role: 'kitchen' } })],
    ['nested-only provenance', { status: 'accepted', provenance: acceptedByRestaurant('delivery-review-0007') }],
  ];

  for (const [label, deliveryAcceptance] of invalidAcceptances) {
    const result = prepareKitchenQueue([{
      id: label, fulfillment: 'delivery', status: 'sent_to_kitchen', deliveryAcceptance,
    }]);
    assert.equal(result.tickets.length, 0, `${label} must not reach active KDS`);
    assert.equal(result.counts.blockedReasons.acceptanceProvenanceInvalid, 1, `${label} must be surfaced for review`);
  }

  const validRoles = ['owner', 'manager', 'cashier'];
  for (const [index, role] of validRoles.entries()) {
    const acceptance = acceptedByRestaurant(`delivery-role-${index}-valid`, {
      acceptedBy: { phone: '09123456789', role },
    });
    const kitchenHandoffAt = new Date(Date.parse(acceptance.acceptedAt) + 1_000).toISOString();
    const result = prepareKitchenQueue([{
      id: `valid-${role}`, fulfillment: 'delivery', status: 'sent_to_kitchen',
      statusHistory: [{ status: 'sent_to_kitchen', at: kitchenHandoffAt }],
      deliveryAcceptance: acceptance,
    }]);
    assert.equal(result.tickets.length, 1, `${role} is an authorized restaurant actor`);
  }
});

test('pure KDS ticket transitions fail closed for unaccepted delivery, including replay of an active state', () => {
  const waiting = { id: 81, fulfillment: 'delivery', status: 'sent_to_kitchen', column: 'new' };
  assert.deepEqual(transitionKitchenTicket(waiting, 'start_ticket'), {
    ok: false, error: 'delivery_acceptance_required', current: 'new',
  });

  const stalePreparing = { ...waiting, status: 'preparing', column: 'preparing' };
  assert.equal(transitionKitchenTicket(stalePreparing, 'start_ticket').error, 'delivery_acceptance_required');

  const accepted = {
    ...waiting,
    statusHistory: [{ status: 'sent_to_kitchen', at: '2026-09-23T00:00:02.000Z' }],
    deliveryAcceptance: acceptedByRestaurant('delivery-accept-81', {
      acceptedAt: '2026-09-23T00:00:01.000Z',
    }),
  };
  assert.equal(transitionKitchenTicket(accepted, 'start_ticket').ok, true);

  const acceptedButUnattributed = { ...waiting, deliveryAcceptance: { status: 'accepted' } };
  assert.equal(transitionKitchenTicket(acceptedButUnattributed, 'start_ticket').error, 'delivery_acceptance_provenance_invalid');
});
