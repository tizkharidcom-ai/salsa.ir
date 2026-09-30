'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'role-panel.js'), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

const fetchWaiterSource = sourceBetween('async function fetchWaiter()', '\n  async function refreshWaiterAfterMutation()');
const waiterMetricsSource = sourceBetween('function waiterMetrics()', '\n  function waiterFloor()');
const waiterReservationsSource = sourceBetween('function waiterReservations()', '\n  async function openWaitlistDialog()');

test('optional waitlist/reservation snapshot failures do not hide the usable waiter floor and orders', async () => {
  const state = { data: {} };
  const floor = { tables: [{ id: 12, state: 'available' }] };
  const calls = { calls: [] };
  const orders = { orders: [{ id: 501, status: 'sent_to_kitchen' }] };
  const api = async (url) => {
    if (url.includes('/api/admin/v2/floor')) return floor;
    if (url.includes('/api/waiter/calls')) return calls;
    if (url.includes('/api/admin/orders')) return orders;
    if (url.includes('/api/admin/reservations')) throw new Error('reservation service unavailable');
    if (url.includes('/api/waiter/waitlist')) return { waitlist: [], summary: {} };
    throw new Error(`unexpected request: ${url}`);
  };
  const fetchWaiter = new Function('api', 'qs', 'state', `${fetchWaiterSource}\nreturn fetchWaiter;`)(api, () => '?branch=1', state);

  await fetchWaiter();

  assert.deepEqual(state.data.floor, floor);
  assert.deepEqual(state.data.calls, []);
  assert.deepEqual(state.data.orders, orders.orders);
  assert.equal(state.data.reservations, null);
  assert.equal(state.data.waiterDataIssues.reservations, true);
  assert.equal(state.data.waiterDataIssues.waitlist, false);
});

test('failed optional lists render unavailable states instead of claiming the lists are empty', () => {
  const main = { innerHTML: '', querySelectorAll: () => [] };
  const document = {
    body: { classList: { remove() {} } },
    getElementById: () => null,
  };
  const render = new Function(
    'state', 'clearRoleHeaderContext', 'document', 'main', 'pageHead', 'num', 'time', 'esc', 'empty',
    `${waiterReservationsSource}\nreturn waiterReservations;`,
  )(
    {
      data: {
        waitlist: [],
        waitlistSummary: {},
        reservations: null,
        waiterDataIssues: { reservations: true, waitlist: true },
      },
    },
    () => {},
    document,
    main,
    (_kicker, _title, _description, action) => `<header>${action}</header>`,
    (value) => String(value ?? 0),
    () => '—',
    (value) => String(value ?? ''),
    (message) => `<div class="empty-state">${message}</div>`,
  );

  render();

  assert.match(main.innerHTML, /صف انتظار بارگیری نشد/);
  assert.match(main.innerHTML, /رزروهای امروز بارگیری نشد/);
  assert.doesNotMatch(main.innerHTML, /صف انتظار خالی است/);
  assert.doesNotMatch(main.innerHTML, /برای امروز رزرو زمان‌داری ثبت نشده است/);
  assert.match(main.innerHTML, /پذیرش موقتاً در دسترس نیست/);
  assert.match(main.innerHTML, /data-waiter-data-retry/);
});

test('waiter metrics show reservation data as unknown, not zero, when the snapshot failed', () => {
  const render = new Function(
    'state', 'orderIsOpen', 'waiterTableContext', 'num', 'metric',
    `${waiterMetricsSource}\nreturn waiterMetrics;`,
  )(
    {
      data: {
        floor: { tables: [] },
        calls: [],
        orders: [],
        reservations: null,
        waiterDataIssues: { reservations: true, waitlist: false },
      },
    },
    () => false,
    () => ({ orders: [], calls: [], state: 'available' }),
    (value) => String(value ?? 0),
    (label, value, detail) => `${label}:${value}:${detail}`,
  );

  const metrics = render();
  assert.match(metrics, /رزرو امروز:—:اطلاعات در دسترس نیست/);
  assert.doesNotMatch(metrics, /رزرو امروز:0:/);
});
