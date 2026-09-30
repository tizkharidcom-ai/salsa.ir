'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const waitlist = require('../server/waitlist');

const phoneRe = /^09\d{9}$/;

function create(records = [], overrides = {}) {
  return waitlist.createWaitlistEntry({
    records,
    branchId: 1,
    phone: '09123456789',
    name: 'سارا رضایی',
    partySize: '3',
    note: 'میز کنار پنجره',
    idempotencyKey: 'waitlist-request-1',
    phoneRe,
    nextId: (rows) => Math.max(0, ...rows.map((row) => Number(row.id) || 0)) + 1,
    now: '2026-09-23T10:00:00.000Z',
    ...overrides,
  });
}

test('waitlist party size accepts only positive whole numbers and clamps to configured maximum', () => {
  assert.equal(waitlist.normalizePartySize('3', 4), 3);
  assert.equal(waitlist.normalizePartySize(7, 4), 4);
  assert.equal(waitlist.normalizePartySize('', 4), null);
  assert.equal(waitlist.normalizePartySize('1.5', 40), null);
  assert.equal(waitlist.normalizePartySize('1e2', 40), null);
  assert.equal(waitlist.normalizePartySize(Number.MAX_SAFE_INTEGER + 1, 40), null);
});

test('waitlist phone normalization accepts Persian and Arabic digits without losing leading zero', () => {
  const globalPhonePattern = /^09\d{9}$/g;
  assert.equal(waitlist.validatePhone('۰۹۱۲۳۴۵۶۷۸۹', globalPhonePattern), '09123456789');
  assert.equal(waitlist.validatePhone('٠٩١٢٣٤٥٦٧٨٩', globalPhonePattern), '09123456789');
  assert.equal(waitlist.validatePhone('09123456789', globalPhonePattern), '09123456789');
  assert.throws(() => waitlist.validatePhone(9123456789, phoneRe), { code: 'waitlist_phone_invalid' });
  assert.throws(() => waitlist.validatePhone({ phone: '09123456789' }, phoneRe), { code: 'waitlist_phone_invalid' });
});

test('waitlist create rejects unsafe branch, text, and idempotency-key values instead of coercing them', () => {
  assert.throws(() => create([], { branchId: '1e0' }), { code: 'waitlist_branch_invalid' });
  assert.throws(() => create([], { name: { toString: () => 'نام' } }), { code: 'waitlist_input_invalid' });
  assert.throws(() => create([], { idempotencyKey: { key: 'waitlist-request-1' } }), { code: 'waitlist_idempotency_key_invalid' });
  assert.throws(() => create([], { idempotencyKey: `x${'a'.repeat(160)}` }), { code: 'waitlist_idempotency_key_invalid' });
  assert.throws(() => create([], { idempotencyKey: 'key\nforged' }), { code: 'waitlist_idempotency_key_invalid' });
});

test('waitlist create replay is idempotent only for the same normalized request payload', () => {
  const records = [];
  const first = create(records);
  const replay = create(records, { phone: '۰۹۱۲۳۴۵۶۷۸۹' });
  assert.equal(first.idempotentReplay, false);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.entry.id, first.entry.id);
  assert.equal(records.length, 1);

  for (const changed of [
    { name: 'مریم رضایی' },
    { note: 'یادداشت دیگر' },
    { partySize: '4' },
    { branchId: 2 },
    { phone: '09111111111' },
  ]) {
    assert.throws(() => create(records, changed), { code: 'waitlist_idempotency_conflict', status: 409 });
  }
  assert.equal(records.length, 1);
});

test('terminal waitlist records do not block a new visit for the same phone', () => {
  const records = [];
  const { entry } = create(records);
  entry.status = 'left';
  const next = create(records, { idempotencyKey: 'waitlist-request-2' });
  assert.notEqual(next.entry.id, entry.id);
  assert.equal(records.length, 2);
});

test('waitlist seating cannot be cancelled into a false terminal state; seated guests must leave', () => {
  assert.equal(waitlist.canTransition('waiting', 'seated'), true);
  assert.equal(waitlist.canTransition('seated', 'seated'), true);
  assert.equal(waitlist.canTransition('seated', 'left'), true);
  assert.equal(waitlist.canTransition('seated', 'cancelled'), false);
  assert.equal(waitlist.canTransition('left', 'waiting'), false);
  assert.equal(waitlist.canTransition('cancelled', 'seated'), false);
});

test('waitlist update validates all fields and table constraints without mutating the saved entry', () => {
  const entry = {
    id: 4, source: 'walk_in', branchId: 1, status: 'called', name: 'سارا',
    phone: '09123456789', partySize: 2, note: '', tableNo: null,
  };
  const tables = [{ id: 5, branchId: 1, seats: 2, active: true }];

  assert.throws(() => waitlist.prepareWaitlistUpdate({
    entry, tables, body: { status: 'seated', tableNo: '5', partySize: '۴', name: 'نام جدید' },
  }), { code: 'waitlist_table_capacity', status: 409 });
  assert.deepEqual(entry, {
    id: 4, source: 'walk_in', branchId: 1, status: 'called', name: 'سارا',
    phone: '09123456789', partySize: 2, note: '', tableNo: null,
  });
});

test('waitlist seating uses exact split-table ids and blocks a busy parent table', () => {
  assert.equal(waitlist.normalizeTableId('  میز ۵-۲ '), '5-2');
  assert.equal(waitlist.tableIdsOverlap('5-2', '5'), true);
  assert.equal(waitlist.tableIdsOverlap('5-1', '5-2'), false);

  const entry = { id: 8, source: 'walk_in', branchId: 1, status: 'called', partySize: 2, tableNo: null };
  assert.throws(() => waitlist.prepareWaitlistUpdate({
    entry,
    tables: [{ id: '5-2', branchId: 1, seats: 4, active: true }],
    body: { status: 'seated', tableNo: '۵-۲' },
    isTableBusy: (tableNo) => waitlist.tableIdsOverlap('5', tableNo),
  }), { code: 'waitlist_table_busy', status: 409 });
  assert.equal(entry.status, 'called');
  assert.equal(entry.tableNo, null);
});

test('timed reservations block a table only during the configured service window', () => {
  const now = new Date(2026, 8, 23, 10, 0, 0);
  assert.equal(waitlist.reservationBlocksTable({ status: 'confirmed', date: '2026-09-23', time: '10:15', endTime: '10:45' }, now, 30), true);
  assert.equal(waitlist.reservationBlocksTable({ status: 'pending', date: '2026-09-23', time: '09:00', endTime: '09:30' }, now, 30), false);
  assert.equal(waitlist.reservationBlocksTable({ status: 'confirmed', date: '2026-09-23', time: '12:00', endTime: '12:30' }, now, 30), false);
  assert.equal(waitlist.reservationBlocksTable({ status: 'confirmed', date: '2026-09-24', time: '10:15', endTime: '10:45' }, now, 30), false);
  assert.equal(waitlist.reservationBlocksTable({ status: 'seated', date: 'invalid', time: 'invalid' }, now, 30), true);
  assert.equal(waitlist.reservationBlocksTable({ status: 'confirmed', date: 'invalid', time: 'invalid' }, now, 30), true);
  assert.equal(waitlist.reservationBlocksTable({ status: 'cancelled', date: 'invalid', time: 'invalid' }, now, 30), false);
});

test('waitlist seating retries are idempotent and cannot silently move a seated guest', () => {
  const entry = {
    id: 9, source: 'walk_in', branchId: 1, status: 'seated', name: 'سارا',
    phone: '09123456789', partySize: 2, note: '', tableNo: '5-2',
    statusAt: '2026-09-23T10:00:00.000Z', seatedAt: '2026-09-23T10:00:00.000Z',
  };
  const tables = [
    { id: '5-2', branchId: 1, seats: 4, active: true },
    { id: '6', branchId: 1, seats: 4, active: true },
  ];
  const retry = waitlist.prepareWaitlistUpdate({
    entry,
    tables,
    body: { status: 'seated', tableNo: '۵-۲' },
    isTableBusy: () => true,
  });
  assert.equal(retry.idempotent, true);
  assert.equal(retry.entry.statusAt, entry.statusAt);
  assert.throws(() => waitlist.prepareWaitlistUpdate({
    entry, tables, body: { status: 'seated', tableNo: '6' },
  }), { code: 'waitlist_table_move_requires_leave', status: 409 });
});

test('waitlist list rejects invalid branch identity and filters terminal entries on request', () => {
  const records = [
    { id: 1, source: 'walk_in', branchId: 1, status: 'waiting', createdAt: 'invalid' },
    { id: 2, source: 'walk_in', branchId: '1', status: 'left', createdAt: '2026-09-23T09:00:00.000Z' },
    { id: 3, source: 'reservation', branchId: 1, status: 'confirmed' },
  ];
  assert.deepEqual(waitlist.listWaitlist(records, '1e0'), []);
  assert.deepEqual(waitlist.listWaitlist(records, 1, { includeTerminal: false }).map(({ id }) => id), [1]);
  assert.deepEqual(waitlist.listWaitlist(records, 1).map(({ id }) => id), [1, 2]);
});
