'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('../server/admin-v2');

function acceptedDelivery(id) {
  return {
    id,
    branchId: 1,
    fulfillment: 'delivery',
    status: 'sent_to_kitchen',
    paymentStatus: 'paid',
    deliveryAcceptance: {
      status: 'accepted',
      source: 'restaurant',
      reference: `accept-${id}`,
      acceptedAt: new Date(Date.now() - 1000).toISOString(),
      acceptedBy: { phone: '09120000001', role: 'manager' },
    },
    statusAt: new Date().toISOString(),
  };
}

test('admin v2 kitchen read model excludes unaccepted delivery and payment-review orders', () => {
  const db = {
    orders: [
      { ...acceptedDelivery(1), deliveryAcceptance: { status: 'unrecorded' } },
      acceptedDelivery(2),
      { id: 3, branchId: 1, fulfillment: 'pickup', status: 'preparing', paymentStatus: 'unknown' },
      { id: 4, branchId: 1, fulfillment: 'pickup', status: 'sent_to_kitchen', paymentStatus: 'partial' },
      { ...acceptedDelivery(5), branchId: 2 },
    ],
  };

  const model = __test.kitchen(db, 1);

  assert.deepEqual(model.lanes.map((lane) => lane.tickets.map((ticket) => ticket.id)), [
    [2, 4], [], [],
  ]);
});
