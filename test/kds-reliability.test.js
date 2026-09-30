'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'role-panel.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

function functionSource(name) {
  const signature = `function ${name}(`;
  const found = source.indexOf(signature);
  assert.notEqual(found, -1, `expected ${name} to exist in role-panel.js`);
  const start = source.lastIndexOf('\n', found) + 1;
  const end = source.indexOf('\n  }', found);
  assert.notEqual(end, -1, `expected ${name} body to close`);
  return source.slice(start, end + 4);
}

function loadHelpers(names, dependencies = {}) {
  const params = Object.keys(dependencies);
  const definitions = names.map(functionSource).join('\n');
  const values = names.map((name) => name);
  return new Function(...params, `${definitions}\nreturn { ${values.join(', ')} };`)(...Object.values(dependencies));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('concurrent KDS refreshes coalesce but always fetch a final authoritative snapshot', async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const state = {
    kdsSnapshotInFlight: null,
    kdsSnapshotRefreshQueued: false,
    kdsHeldNotices: new Map(),
    kdsLastOpenCount: 0,
    kdsActionNeedsRefresh: true,
    data: { kitchen: { tickets: [{ id: 'stale' }] } },
  };
  const { fetchKitchen } = loadHelpers(['fetchKitchen'], {
    state,
    api: () => (++calls === 1 ? first.promise : second.promise),
    qs: () => '?branchId=3',
    kdsBeep: () => {},
    kdsHeldCourseItems: new Function(`${functionSource('kdsHeldCourseItems')}\nreturn kdsHeldCourseItems;`)(),
  });

  const one = fetchKitchen();
  const two = fetchKitchen();
  assert.equal(calls, 1, 'the in-flight request is shared');
  first.resolve({ tickets: [{ id: 'intermediate', column: 'new', items: [] }], counts: {}, allDay: [] });
  await new Promise(setImmediate);
  assert.equal(calls, 2, 'a caller arriving mid-request queues one more server read');
  second.resolve({ tickets: [{ id: 'authoritative', column: 'preparing', items: [] }], counts: {}, allDay: [] });

  await Promise.all([one, two]);
  assert.equal(state.data.kitchen.tickets[0].id, 'authoritative');
  assert.equal(state.kdsActionNeedsRefresh, false);
  assert.equal(state.kdsSnapshotInFlight, null);
});

test('KDS action request preserves the 409 response for reconciliation and never retries it', async () => {
  const conflict = { error: 'kds_ticket_incomplete', incomplete: ['0:10', '1:11'] };
  let calls = 0;
  const { requestKdsAction } = loadHelpers(['requestKdsAction'], {
    state: { branchId: 9 },
    fetch: async (url, options) => {
      calls += 1;
      assert.equal(url, '/api/kitchen/orders/42');
      assert.equal(options.method, 'PATCH');
      return { status: 409, ok: false, json: async () => conflict };
    },
    AbortController,
    setTimeout,
    clearTimeout,
    location: { href: '' },
    errorMessage: () => 'ticket incomplete',
  });

  await assert.rejects(requestKdsAction(42, { action: 'complete_ticket' }), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.code, 'kds_ticket_incomplete');
    assert.deepEqual(error.data, conflict);
    return true;
  });
  assert.equal(calls, 1, 'mutating kitchen requests are not blindly replayed');
});

test('a lost response is reconciled from fresh server state and 409 held keys stay distinguishable', () => {
  const { kdsActionOutcome, kdsActionRecovery } = loadHelpers(['kdsActionOutcome', 'kdsActionRecovery'], {
    kdsHeldCourseItems: (ticket) => ticket?.heldCourseItems || [],
  });
  const payload = { action: 'complete_item', lineKey: '0:10' };
  const ticket = { column: 'preparing', items: [{ key: '0:10', completedAt: '2026-09-23T10:00:00Z' }] };
  assert.equal(kdsActionOutcome(ticket, payload), true);
  assert.deepEqual(kdsActionRecovery(new Error('connection lost'), payload, ticket), {
    applied: true,
    conflict: false,
    code: undefined,
    hiddenIncompleteKeys: [],
  });

  const heldConflict = Object.assign(new Error('incomplete'), {
    status: 409,
    code: 'kds_ticket_incomplete',
    data: { error: 'kds_ticket_incomplete', incomplete: ['0:10', '1:11', '1:11'] },
  });
  assert.deepEqual(kdsActionRecovery(heldConflict, { action: 'complete_ticket' }, ticket), {
    applied: false,
    conflict: true,
    code: 'kds_ticket_incomplete',
    hiddenIncompleteKeys: ['1:11'],
  });
});

test('409 action recovery refreshes once, reveals held keys and leaves retries to the operator', async () => {
  const state = {
    branchId: 3,
    activeView: 'board',
    kdsActionNeedsRefresh: false,
    kdsPendingTickets: new Set(),
    kdsHeldNotices: new Map(),
    data: { kitchen: { tickets: [{ id: 42, column: 'preparing', items: [{ key: '0:10', completedAt: 'now' }] }] } },
  };
  const calls = { action: 0, refresh: 0, board: 0, toasts: [] };
  const currentTicket = {
    isConnected: true,
    setAttribute() {},
    removeAttribute() {},
    querySelectorAll: () => [{ disabled: false }],
  };
  const button = { isConnected: true, closest: () => currentTicket };
  const conflict = Object.assign(new Error('همهٔ اقلام کامل نشده‌اند'), {
    status: 409,
    code: 'kds_ticket_incomplete',
    data: { error: 'kds_ticket_incomplete', incomplete: ['0:10', '1:11'] },
  });
  const { runKdsAction } = loadHelpers(
    ['kdsActionOutcome', 'kdsActionRecovery', 'runKdsAction'],
    {
      state,
      requestKdsAction: async () => { calls.action += 1; throw conflict; },
      setKdsUndo: () => {},
      showToast: (message) => calls.toasts.push(message),
      fetchKitchen: async () => { calls.refresh += 1; },
      kitchenBoard: () => { calls.board += 1; },
      setBusy: () => {},
      num: (value) => String(value),
      kdsHeldCourseItems: (ticket) => ticket?.heldCourseItems || [],
    },
  );

  await runKdsAction(button, 42, { action: 'complete_ticket' }, 'سفارش آماده شد.');
  assert.equal(calls.action, 1);
  assert.equal(calls.refresh, 1);
  assert.equal(calls.board, 1);
  assert.deepEqual([...state.kdsHeldNotices.get('42')], ['1:11']);
  assert.match(calls.toasts.at(-1), /نوبت نگه‌داشته/);
  assert.equal(state.kdsPendingTickets.size, 0);
});

test('uncertain action plus failed snapshot blocks any repeat until synchronization succeeds', async () => {
  const state = {
    branchId: 3,
    activeView: 'board',
    kdsActionNeedsRefresh: false,
    kdsPendingTickets: new Set(),
    kdsHeldNotices: new Map(),
    data: { kitchen: { tickets: [{ id: 42, column: 'preparing', items: [] }] } },
  };
  let actions = 0;
  const toasts = [];
  const ticket = { isConnected: true, setAttribute() {}, removeAttribute() {}, querySelectorAll: () => [] };
  const button = { isConnected: true, closest: () => ticket };
  const { runKdsAction } = loadHelpers(
    ['kdsActionOutcome', 'kdsActionRecovery', 'runKdsAction'],
    {
      state,
      requestKdsAction: async () => { actions += 1; throw new Error('connection lost'); },
      setKdsUndo: () => {},
      showToast: (message) => toasts.push(message),
      fetchKitchen: async () => { throw new Error('snapshot unavailable'); },
      kitchenBoard: () => {},
      setBusy: () => {},
      num: (value) => String(value),
      kdsHeldCourseItems: (value) => value?.heldCourseItems || [],
    },
  );

  await runKdsAction(button, 42, { action: 'complete_item', lineKey: '0:10' }, 'انجام شد.');
  assert.equal(state.kdsActionNeedsRefresh, true);
  await runKdsAction(button, 42, { action: 'complete_item', lineKey: '0:10' }, 'انجام شد.');
  assert.equal(actions, 1, 'the stale UI cannot send the same action twice');
  assert.match(toasts.at(-1), /ابتدا پنل را تازه‌سازی کنید/);
});

test('held courses render as visible, non-actionable KDS rows and reconnect requests a snapshot', () => {
  const { kdsHeldCourseItemMarkup, kdsShouldRefreshAfterReconnect } = loadHelpers(
    ['kdsHeldCourseItemMarkup', 'kdsShouldRefreshAfterReconnect'],
    { esc: (value) => String(value), num: (value) => String(value || 0) },
  );
  const held = kdsHeldCourseItemMarkup({ name: 'پاستا', qty: 2, course: 'entrees' });
  assert.match(held, /منتظر اعلام سالن/);
  assert.doesNotMatch(held, /<button|data-kds-item/);
  assert.equal(kdsShouldRefreshAfterReconnect('kitchen', true, 'board'), true);
  assert.equal(kdsShouldRefreshAfterReconnect('kitchen', false, 'board'), false);
  assert.equal(kdsShouldRefreshAfterReconnect('kitchen', true, 'inventory'), false);
  assert.match(source, /kdsShouldRefreshAfterReconnect\(role, reconnected, state\.activeView\)[\s\S]{0,140}schedule\(true\)/);
});

test('KDS snapshots expose held course details separately from actionable and counted kitchen lines', () => {
  const ticketStart = serverSource.indexOf('function kitchenTicket(');
  const ticketEnd = serverSource.indexOf('function kdsPerformance(', ticketStart);
  const routeStart = serverSource.indexOf("app.get('/api/kitchen/orders'");
  const routeEnd = serverSource.indexOf("app.patch('/api/kitchen/orders/:id'", routeStart);
  assert.ok(ticketStart >= 0 && ticketEnd > ticketStart && routeStart >= 0 && routeEnd > routeStart);
  const ticketSource = serverSource.slice(ticketStart, ticketEnd);
  const routeSource = serverSource.slice(routeStart, routeEnd);
  assert.match(ticketSource, /heldCourseItems\s*=\s*kitchenLines\(order, \{ onlyHeld: true \}\)/);
  assert.match(ticketSource, /heldCourseItems,/);
  assert.match(routeSource, /kitchenLines\(o\)\.length > 0 \|\| kitchenLines\(o, \{ onlyHeld: true \}\)\.length > 0/);
  assert.match(routeSource, /ticket\.items\.filter\(\(entry\) => !entry\.completedAt\)/);
  assert.match(functionSource('kdsHeldCourseItems'), /ticket\?\.heldCourseItems/);
  assert.match(source, /ticket\.items \|\| \[\][\s\S]{0,100}kdsHeldCourseItems\(ticket\)/);
});
