'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getOrderAging } = require('../server/operational-order-aging');

const now = Date.parse('2026-09-23T12:00:00.000Z');

test('an old order recently moved into the kitchen is not falsely reported as late', () => {
  const result = getOrderAging({
    status: 'preparing',
    createdAt: '2026-09-22T12:00:00.000Z',
    statusHistory: [{ status: 'preparing', at: '2026-09-23T11:55:00.000Z' }],
  }, now);

  assert.equal(result.ageMinutes, 1440);
  assert.equal(result.stageAgeMinutes, 5);
  assert.equal(result.attentionType, null);
});

test('long payment and cashier waits are surfaced as payment attention, not kitchen delay', () => {
  for (const status of ['pending_online', 'awaiting_confirmation', 'pay_at_cashier']) {
    const result = getOrderAging({
      status,
      createdAt: '2026-09-23T11:30:00.000Z',
      statusHistory: [{ status, at: '2026-09-23T11:30:00.000Z' }],
    }, now);

    assert.equal(result.stageAgeMinutes, 30);
    assert.equal(result.attentionType, 'payment');
  }
});

test('kitchen and handoff delays are classified by the current stage', () => {
  const kitchen = getOrderAging({
    status: 'sent_to_kitchen',
    createdAt: '2026-09-23T11:10:00.000Z',
    statusHistory: [{ status: 'sent_to_kitchen', at: '2026-09-23T11:10:00.000Z' }],
  }, now);
  const handoff = getOrderAging({
    status: 'ready',
    createdAt: '2026-09-23T11:10:00.000Z',
    statusHistory: [{ status: 'ready', at: '2026-09-23T11:10:00.000Z' }],
  }, now);

  assert.equal(kitchen.attentionType, 'kitchen');
  assert.equal(handoff.attentionType, 'handoff');
});

test('the latest matching status history entry wins and invalid dates stay safe', () => {
  const result = getOrderAging({
    status: 'preparing',
    createdAt: 'not-a-date',
    statusHistory: [
      { status: 'preparing', at: '2026-09-23T11:00:00.000Z' },
      { status: 'ready', at: '2026-09-23T11:30:00.000Z' },
      { status: 'preparing', at: '2026-09-23T11:50:00.000Z' },
    ],
  }, now);

  assert.equal(result.ageMinutes, 0);
  assert.equal(result.stageAgeMinutes, 10);
  assert.equal(result.attentionType, null);
});
