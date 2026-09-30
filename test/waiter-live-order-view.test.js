'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../js/order-payment-state');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'role-panel.js'), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test('a served dine-in table stays occupied until payment is consistently settled', () => {
  const orderSource = sourceBetween('function orderIsOpen(order) {', '\n  function waiterWorkflowMarkup');
  const orderIsOpen = new Function(`${orderSource}\nreturn orderIsOpen;`)();
  const terminal = { status: 'done', fulfillment: 'dine_in', total: 100 };

  for (const paymentStatus of ['unpaid', 'partial', 'pending', 'failed', 'unknown', undefined]) {
    const order = { ...terminal, paymentStatus, amountPaid: paymentStatus === 'partial' ? 40 : 0 };
    assert.equal(orderIsOpen(order), true, `done/${paymentStatus || 'missing'} must keep its table occupied`);
  }

  assert.equal(orderIsOpen({ ...terminal, paymentStatus: 'paid', amountPaid: 100 }), false);
  assert.equal(orderIsOpen({ ...terminal, paymentStatus: 'paid', amountPaid: 90 }), true, 'inconsistent paid evidence must not release the table');
  assert.equal(orderIsOpen({ ...terminal, paymentStatus: 'refunded', amountPaid: 100 }), false, 'a consistent reversal after completed service releases the table');
  assert.equal(orderIsOpen({ ...terminal, status: 'cancelled', paymentStatus: 'unknown' }), false, 'cancelled service releases the table');
  assert.equal(orderIsOpen({ ...terminal, status: 'ready', paymentStatus: 'paid', amountPaid: 100 }), true, 'unfinished service remains open regardless of payment');
});

test('live waiter snapshots repaint the open order list', () => {
  const refreshSource = sourceBetween('function refreshWaiterViewAfterSync()', '\n  function startStream()');
  const painted = [];
  const refresh = new Function(
    'state', 'waiterFloor', 'waiterCalls', 'waiterOrders', 'waiterReservations',
    `${refreshSource}\nreturn refreshWaiterViewAfterSync;`,
  )(
    { activeView: 'orders', waiterTerminal: null, data: { orders: [{ id: 42 }] } },
    () => painted.push('floor'),
    () => painted.push('calls'),
    () => painted.push('orders'),
    () => painted.push('reservations'),
  );

  refresh();

  assert.deepEqual(painted, ['orders']);
});

test('waiter order-list editing refreshes and opens only the latest editable invoice', async () => {
  const editSource = sourceBetween('async function openWaiterOrderEditor(orderId, button)', '\n  function openUnmappedOrderTableAssignment');
  const state = {
    branchId: 2, waiterBranchGeneration: 4,
    data: { orders: [{ id: 31, fulfillment: 'dine_in', status: 'pay_at_cashier', tableNo: '5' }] },
  };
  const notices = [];
  const terminalCalls = [];
  const button = { disabled: false, dataset: {}, textContent: 'ویرایش و ارسال سفارش' };
  let fetchCount = 0;
  const openEditor = new Function(
    'state', 'button', 'setBusy', 'fetchWaiter', 'showToast', 'orderCanEdit',
    'orderIsOpen', 'waiterOrderHasMappedTable', 'openUnmappedOrderTableAssignment',
    'openWaiterTerminal', 'refreshWaiterViewAfterSync',
    `${editSource}\nreturn openWaiterOrderEditor;`,
  )(
    state, button,
    (target, busy) => { target.disabled = busy; },
    async () => { fetchCount += 1; return true; },
    (message, kind) => notices.push({ message, kind }),
    (order) => order.status === 'pay_at_cashier',
    () => true,
    () => true,
    () => assert.fail('mapped editable invoices open directly'),
    async (tableNo, options) => terminalCalls.push({ tableNo, options }),
    () => {},
  );

  const opened = await openEditor('31', button);

  assert.equal(opened, true);
  assert.equal(fetchCount, 1);
  assert.deepEqual(terminalCalls, [{ tableNo: '5', options: { selectedOrderId: 31 } }]);
  assert.equal(button.disabled, false);
  assert.deepEqual(notices, []);
  assert.match(source, /data-edit-waiter-order=/);
});

test('a waiter edit action refuses an order that became non-editable after the list rendered', async () => {
  const editSource = sourceBetween('async function openWaiterOrderEditor(orderId, button)', '\n  function openUnmappedOrderTableAssignment');
  const state = {
    branchId: 2, waiterBranchGeneration: 4,
    data: { orders: [{ id: 31, fulfillment: 'dine_in', status: 'ready', tableNo: '5' }] },
  };
  const notices = [];
  let terminalOpened = false;
  let refreshedView = false;
  const button = { disabled: false, dataset: {}, textContent: 'ویرایش و ارسال سفارش' };
  const openEditor = new Function(
    'state', 'button', 'setBusy', 'fetchWaiter', 'showToast', 'orderCanEdit',
    'orderIsOpen', 'waiterOrderHasMappedTable', 'openUnmappedOrderTableAssignment',
    'openWaiterTerminal', 'refreshWaiterViewAfterSync',
    `${editSource}\nreturn openWaiterOrderEditor;`,
  )(
    state, button, (target, busy) => { target.disabled = busy; }, async () => true,
    (message, kind) => notices.push({ message, kind }),
    (order) => order.status !== 'ready', () => true, () => true,
    () => {}, async () => { terminalOpened = true; }, () => { refreshedView = true; },
  );

  const opened = await openEditor(31, button);

  assert.equal(opened, false);
  assert.equal(terminalOpened, false);
  assert.equal(refreshedView, true);
  assert.equal(button.disabled, false);
  assert.equal(notices[0].kind, 'warning');
  assert.match(notices[0].message, /دیگر قابل ویرایش نیست/);
});

test('a successful waiter call stays visibly successful when snapshot refresh fails', async () => {
  const resolveSource = sourceBetween('async function resolveWaiterCall(button)', '\n  function wireCalls');
  const notices = [];
  const calls = [{ id: 'call/7', status: 'open' }];
  const state = {
    branchId: 3, waiterBranchGeneration: 5, activeView: 'calls',
    data: { calls }, waiterCallMutations: new Set(), waiterCallNeedsRefresh: new Set(),
  };
  let apiCount = 0;
  let paintCount = 0;
  const button = { disabled: false, dataset: {}, textContent: 'رسیدگی شد' };
  const resolve = new Function(
    'state', 'button', 'waiterCallStateKey', 'setBusy', 'api', 'showToast',
    'refreshWaiterCallSnapshot', 'fetchWaiter', 'dialog', 'paintWaiterCallView',
    'refreshWaiterViewAfterSync', `${resolveSource}\nreturn resolveWaiterCall;`,
  )(
    state,
    button,
    (id, branchId) => `${branchId}:${id}`,
    (target, busy) => { if (target) target.disabled = busy; },
    async (url, options) => {
      apiCount += 1;
      assert.equal(url, '/api/waiter/calls/call%2F7');
      assert.equal(options.method, 'PATCH');
      assert.deepEqual(JSON.parse(options.body), { status: 'done' });
    },
    (message, kind) => notices.push({ message, kind }),
    async () => false,
    async () => { throw new Error('اتصال قطع شد'); },
    { open: false },
    () => { paintCount += 1; },
    () => {},
  );
  button.closest = () => ({ dataset: { callId: 'call/7' } });

  const completed = await resolve(button);

  assert.equal(completed, true);
  assert.equal(apiCount, 1);
  assert.equal(paintCount, 1);
  assert.deepEqual(state.data.calls, [], 'the confirmed call is removed from the visible local snapshot');
  assert.equal(button.disabled, false);
  assert.match(notices[0].message, /رسیدگی به فراخوان ثبت شد/);
  assert.equal(notices[0].kind, undefined);
  assert.equal(notices[1].kind, 'warning');
  assert.match(notices[1].message, /تازه‌سازی فهرست ناموفق بود/);
});

test('an ambiguous waiter call cannot be submitted again until an authoritative refresh', async () => {
  const resolveSource = sourceBetween('async function resolveWaiterCall(button)', '\n  function wireCalls');
  const notices = [];
  const state = {
    branchId: 3, waiterBranchGeneration: 5, activeView: 'calls',
    data: { calls: [{ id: 8, status: 'open' }] },
    waiterCallMutations: new Set(), waiterCallNeedsRefresh: new Set(),
  };
  let apiCount = 0;
  let paintCount = 0;
  const button = { disabled: false, dataset: {}, textContent: 'رسیدگی شد' };
  const resolve = new Function(
    'state', 'button', 'waiterCallStateKey', 'setBusy', 'api', 'showToast',
    'refreshWaiterCallSnapshot', 'fetchWaiter', 'dialog', 'paintWaiterCallView',
    'refreshWaiterViewAfterSync', `${resolveSource}\nreturn resolveWaiterCall;`,
  )(
    state, button, (id, branchId) => `${branchId}:${id}`,
    (target, busy) => { if (target) target.disabled = busy; },
    async () => { apiCount += 1; throw Object.assign(new Error('پاسخ نامشخص'), { outcomeUnknown: true }); },
    (message, kind) => notices.push({ message, kind }),
    async () => false,
    async () => false,
    { open: false },
    () => { paintCount += 1; },
    () => {},
  );
  button.closest = () => ({ dataset: { callId: '8' } });

  const completed = await resolve(button);

  assert.equal(completed, false);
  assert.equal(apiCount, 1);
  assert.equal(paintCount, 1);
  assert.ok(state.waiterCallNeedsRefresh.has('3:8'));
  assert.equal(button.disabled, false, 'rerendered UI must represent the refresh lock, not a stale busy state');
  assert.ok(notices.some(({ kind }) => kind === 'warning'));
  assert.match(source, /data-refresh-call-status/);
});

test('waiter live events are deferred while a modal is open and refreshed on close', () => {
  const streamSource = sourceBetween('function startStream()', '\n  function handlePosShortcut');
  const liveSyncSource = sourceBetween('function startWaiterLiveSync()', '\n  function applyLatestWaiterOrder');

  assert.match(streamSource, /role === 'waiter' && dialog\.open[\s\S]*?state\.waiterRefreshPending = true/);
  assert.match(streamSource, /waiterDialogRefreshListener[\s\S]*?dialog\.addEventListener\('close'/);
  assert.match(streamSource, /waiterBranchGeneration[\s\S]*?refreshWaiterViewAfterSync\(\)/);
  assert.match(liveSyncSource, /ageMin\(c\.createdAt\)/, 'displayed call wait times refresh when their minute changes');
  assert.match(liveSyncSource, /if \(dialog\.open\) state\.waiterRefreshPending = true/);
});
