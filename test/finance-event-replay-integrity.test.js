'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { recordEvent } = require('../server/finance-v2');

function freshDb() { return {}; }

function eventInput(overrides = {}) {
  return {
    source: 'order.paid',
    sourceId: 'order-42',
    sourceVersion: 3,
    idempotencyKey: 'paid-order-42-v3',
    branchId: 7,
    amountIrr: 125000,
    payload: {
      tenderSnapshot: [{ tender: 'card', amountIrr: 125000 }],
      reviewedBy: 'cashier-9',
    },
    ...overrides,
  };
}

test('identical event replay is stable across object key order and implicit timestamps', () => {
  const db = freshDb();
  const first = recordEvent(db, eventInput());
  const replay = recordEvent(db, eventInput({
    payload: {
      reviewedBy: 'cashier-9',
      tenderSnapshot: [{ amountIrr: 125000, tender: 'card' }],
    },
  }));

  assert.equal(first.idempotentReplay, false);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.event.id, first.event.id);
  assert.match(first.event.payloadFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(db.financeV2.events.length, 1);
});

test('replaying one event identity with a changed amount conflicts', () => {
  const db = freshDb();
  recordEvent(db, eventInput());

  assert.throws(() => recordEvent(db, eventInput({ amountIrr: 125001 })), {
    code: 'finance_event_payload_conflict',
    status: 409,
  });
  assert.equal(db.financeV2.events.length, 1);
});

test('replaying one event identity with a changed tender conflicts', () => {
  const db = freshDb();
  recordEvent(db, eventInput());

  assert.throws(() => recordEvent(db, eventInput({
    payload: { ...eventInput().payload, tenderSnapshot: [{ tender: 'cash', amountIrr: 125000 }] },
  })), {
    code: 'finance_event_payload_conflict',
    status: 409,
  });
});

test('source identity replay with a different idempotency key still validates the payload', () => {
  const db = freshDb();
  const first = recordEvent(db, eventInput());
  const replay = recordEvent(db, eventInput({ idempotencyKey: 'retry-key-2' }));
  assert.equal(replay.event.id, first.event.id);
  assert.equal(replay.idempotentReplay, true);

  assert.throws(() => recordEvent(db, eventInput({
    idempotencyKey: 'retry-key-3',
    payload: { ...eventInput().payload, reviewedBy: 'cashier-10' },
  })), {
    code: 'finance_event_payload_conflict',
    status: 409,
  });
  assert.equal(db.financeV2.events.length, 1);
});

test('event identity cannot replay into another branch even when its payload is otherwise identical', () => {
  const db = freshDb();
  recordEvent(db, eventInput());

  assert.throws(() => recordEvent(db, eventInput({ branchId: 8 })), {
    code: 'finance_event_source_branch_conflict',
    status: 409,
  });
  assert.throws(() => recordEvent(db, eventInput({ branchId: 8, idempotencyKey: 'retry-on-other-branch' })), {
    code: 'finance_event_source_branch_conflict',
    status: 409,
  });
  assert.equal(db.financeV2.events.length, 1);
});

test('later operational metadata does not change the original event fingerprint', () => {
  const db = freshDb();
  const first = recordEvent(db, eventInput());
  first.event.payload.processedBy = 'finance-worker';

  const replay = recordEvent(db, eventInput());
  assert.equal(replay.event.id, first.event.id);
  assert.equal(replay.idempotentReplay, true);
});

test('legacy events without a fingerprint can replay only when stored content matches', () => {
  const db = freshDb();
  const first = recordEvent(db, eventInput());
  delete first.event.payloadFingerprint;

  const replay = recordEvent(db, eventInput());
  assert.equal(replay.event.id, first.event.id);
  assert.equal(replay.idempotentReplay, true);
  assert.throws(() => recordEvent(db, eventInput({ amountIrr: 125001 })), {
    code: 'finance_event_payload_conflict',
    status: 409,
  });
});
