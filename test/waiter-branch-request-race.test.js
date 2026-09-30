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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const fetchWaiterSource = sourceBetween('async function fetchWaiter()', '\n  async function refreshWaiterAfterMutation()');
const loadMenuSource = sourceBetween('async function loadMenu(force = false)', '\n  async function showOrderComposer');
const renderSource = sourceBetween('async function render()', '\n  let waiterAudioElement = null;');
const branchSwitchSource = sourceBetween('function setActiveBranch(value)', '\n  function clearRoleHeaderContext()');

test('late waiter snapshot from the previous branch cannot replace the active branch floor, calls, orders or status', async () => {
  const requests = [];
  const api = (url) => {
    const pending = deferred();
    requests.push({ url, ...pending });
    return pending.promise;
  };
  const state = { branchId: 1, waiterBranchGeneration: 0, waiterSnapshotRequestId: 0, data: { previous: true } };
  const fetchWaiter = new Function('api', 'qs', 'state', `${fetchWaiterSource}\nreturn fetchWaiter;`)(api, () => '', state);

  const oldBranchRequest = fetchWaiter();
  assert.equal(requests.length, 5);
  assert.ok(requests.every(({ url }) => url.includes('branchId=1')));

  state.branchId = 2;
  state.waiterBranchGeneration += 1;
  state.waiterSnapshotRequestId += 1;
  state.data = {};
  const currentBranchRequest = fetchWaiter();
  assert.equal(requests.length, 10);
  assert.ok(requests.slice(5).every(({ url }) => url.includes('branchId=2')));

  function resolveBranch(branchId) {
    const batch = requests.filter(({ url }) => url.includes(`branchId=${branchId}`));
    for (const request of batch) {
      const { url } = request;
      if (url.includes('/floor')) request.resolve({ branchId, tables: [{ id: branchId, branchId }] });
      else if (url.includes('/waiter/calls')) request.resolve({ calls: [{ id: branchId, branchId, status: `branch-${branchId}` }] });
      else if (url.includes('/admin/orders')) request.resolve({ orders: [{ id: branchId, branchId, status: `branch-${branchId}` }] });
      else if (url.includes('/admin/reservations')) request.resolve({ summary: { branchId } });
      else request.resolve({ waitlist: [{ id: branchId, branchId }], summary: { branchId } });
    }
  }

  resolveBranch(2);
  assert.equal(await currentBranchRequest, true);
  assert.equal(state.data.floor.tables[0].branchId, 2);
  assert.equal(state.data.calls[0].branchId, 2);
  assert.equal(state.data.orders[0].branchId, 2);
  assert.equal(state.data.reservations.summary.branchId, 2);
  assert.equal(state.data.waitlist[0].branchId, 2);

  resolveBranch(1);
  assert.equal(await oldBranchRequest, false);
  assert.equal(state.data.floor.tables[0].branchId, 2);
  assert.equal(state.data.calls[0].branchId, 2);
  assert.equal(state.data.orders[0].branchId, 2);
  assert.equal(state.data.reservations.summary.branchId, 2);
});

test('late menu response from a prior branch generation cannot replace the current menu', async () => {
  const requests = [];
  const api = (url) => {
    const pending = deferred();
    requests.push({ url, ...pending });
    return pending.promise;
  };
  const state = {
    branchId: 1,
    waiterBranchGeneration: 0,
    waiterMenuRequestId: 0,
    menuItems: [], menuCategories: [], menuComplements: [], menuComplementRules: [],
  };
  const loadMenu = new Function('api', 'state', `${loadMenuSource}\nreturn loadMenu;`)(api, state);

  const oldBranchRequest = loadMenu(true);
  state.branchId = 2;
  state.waiterBranchGeneration += 1;
  state.waiterMenuRequestId += 1;
  const currentBranchRequest = loadMenu(true);
  assert.match(requests[0].url, /branchId=1/);
  assert.match(requests[1].url, /branchId=2/);

  requests[1].resolve({ menuItems: [{ id: 2 }], menuCategories: [{ id: 2 }], menuComplements: [{ id: 2 }], menuComplementRules: [{ id: 2 }] });
  await currentBranchRequest;
  requests[0].resolve({ menuItems: [{ id: 1 }], menuCategories: [{ id: 1 }], menuComplements: [{ id: 1 }], menuComplementRules: [{ id: 1 }] });
  await oldBranchRequest;

  assert.deepEqual(state.menuItems, [{ id: 2 }]);
  assert.deepEqual(state.menuCategories, [{ id: 2 }]);
  assert.deepEqual(state.menuComplements, [{ id: 2 }]);
  assert.deepEqual(state.menuComplementRules, [{ id: 2 }]);
});

test('an older waiter render cannot paint after a newer branch render', async () => {
  const pendingFetches = [];
  const state = { branchId: 1, waiterBranchGeneration: 0, waiterRenderRequestId: 0, activeView: 'floor', data: {} };
  const main = { innerHTML: '' };
  const paintedBranches = [];
  const app = { setAttribute() {} };
  const document = { getElementById: (id) => id === 'role-app' ? app : null };
  const render = new Function(
    'role', 'state', 'clearFloorCountdown', 'clearRoleHeaderContext', 'document', 'main',
    'isViewFeatureEnabled', 'pageHead', 'esc', 'empty', 'fetchWaiter', 'waiterCalls',
    'waiterOrders', 'waiterReservations', 'waiterFloor', 'fetchKitchenInventory',
    'kitchenInventoryPage', 'fetchKitchen', 'kitchenBoard', 'fetchCashier', 'cashierFloor',
    'cashierRegister', 'cashierTransactions', 'cashierDrawer', 'cashierMenu',
    `${renderSource}\nreturn render;`,
  )(
    'waiter', state, () => {}, () => {}, document, main, () => true,
    () => '', (value) => String(value), (value) => String(value),
    () => { const pending = deferred(); pendingFetches.push(pending); return pending.promise; },
    () => paintedBranches.push(`calls-${state.branchId}`),
    () => paintedBranches.push(`orders-${state.branchId}`),
    () => paintedBranches.push(`reservations-${state.branchId}`),
    () => paintedBranches.push(`floor-${state.branchId}`),
    async () => {}, () => {}, async () => {}, () => {}, async () => {}, () => {},
    () => {}, () => {}, () => {}, () => {},
  );

  const oldRender = render();
  state.branchId = 2;
  state.waiterBranchGeneration += 1;
  const newRender = render();
  pendingFetches[1].resolve(true);
  await newRender;
  pendingFetches[0].resolve(true);
  await oldRender;

  assert.deepEqual(paintedBranches, ['floor-2']);
});

test('an open waiter order or draft still blocks branch switching', () => {
  const selects = new Map([
    ['role-branch-select', { value: '2' }],
    ['role-user-branch-select', { value: '2' }],
  ]);
  const state = {
    branchId: 1, waiterBranchGeneration: 4, waiterSnapshotRequestId: 7,
    waiterTerminal: { branchId: 1, dirty: true, lines: [{ menuItemId: 99 }] },
  };
  const notices = [];
  let renderCount = 0;
  let streamCount = 0;
  let dialogCloseCount = 0;
  const setActiveBranch = new Function(
    'state', 'role', 'waiterTerminalHasUnsentWork', 'document', 'showToast', 'localStorage',
    'dialog', 'startStream', 'render', `${branchSwitchSource}\nreturn setActiveBranch;`,
  )(
    state, 'waiter', (terminal) => Boolean(terminal?.dirty || terminal?.lines?.length),
    { getElementById: (id) => selects.get(id) || null },
    (message) => notices.push(message), { setItem() { assert.fail('branch preference must not change'); } },
    { close() { dialogCloseCount += 1; } }, () => { streamCount += 1; }, () => { renderCount += 1; },
  );

  setActiveBranch('2');

  assert.equal(state.branchId, 1);
  assert.equal(state.waiterBranchGeneration, 4);
  assert.equal(state.waiterSnapshotRequestId, 7);
  assert.equal(selects.get('role-branch-select').value, '1');
  assert.equal(selects.get('role-user-branch-select').value, '1');
  assert.equal(renderCount, 0);
  assert.equal(streamCount, 0);
  assert.equal(dialogCloseCount, 0);
  assert.match(notices[0], /پیش‌نویس|در انتظار/);
});
