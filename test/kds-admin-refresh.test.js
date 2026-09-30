'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

function loadKitchenRequestSettler() {
  const match = source.match(/async function settleKitchenWorkspaceRequests\([^)]*\) \{[\s\S]*?\n  \}/);
  assert.ok(match, 'the isolated kitchen request settler is present');
  return new Function(`${match[0]}\nreturn settleKitchenWorkspaceRequests;`)();
}

function loadKitchenHelper(name) {
  const match = source.match(new RegExp(`(?:async\\s+)?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`));
  assert.ok(match, `the isolated ${name} helper is present`);
  return new Function(`${match[0]}\nreturn ${name};`)();
}

test('a waiter-call API failure does not discard a successful kitchen queue snapshot', async () => {
  const settleKitchenWorkspaceRequests = loadKitchenRequestSettler();
  const queue = { tickets: [{ id: 24, column: 'preparing' }], counts: { preparing: 1 } };
  const callsError = new Error('calls service unavailable');

  const result = await settleKitchenWorkspaceRequests(Promise.resolve(queue), Promise.reject(callsError));

  assert.equal(result.queue, queue);
  assert.deepEqual(result.calls, { calls: [] });
  assert.equal(result.callsError, callsError);
});

test('a failed primary queue request still rejects instead of presenting a stale/empty board as current', async () => {
  const settleKitchenWorkspaceRequests = loadKitchenRequestSettler();
  const queueError = new Error('queue service unavailable');

  await assert.rejects(
    settleKitchenWorkspaceRequests(Promise.reject(queueError), Promise.resolve({ calls: [] })),
    (error) => error === queueError
  );
});

test('a failed queue request does not wait for a stalled, unrelated waiter-call request', async () => {
  const settleKitchenWorkspaceRequests = loadKitchenRequestSettler();
  const queueError = new Error('queue service unavailable');
  const stalledCallsRequest = new Promise(() => {});
  const settled = settleKitchenWorkspaceRequests(Promise.reject(queueError), stalledCallsRequest)
    .then(() => null, (error) => error);
  const result = await Promise.race([settled, new Promise((resolve) => setImmediate(() => resolve('still waiting')))]);

  assert.equal(result, queueError);
});

test('a stalled waiter-call API times out without blocking the authoritative kitchen queue', async () => {
  const settleKitchenWorkspaceRequests = loadKitchenRequestSettler();
  const queue = { tickets: [{ id: 41, column: 'new' }] };
  const result = await settleKitchenWorkspaceRequests(Promise.resolve(queue), new Promise(() => {}), 5);

  assert.equal(result.queue, queue);
  assert.deepEqual(result.calls, { calls: [] });
  assert.equal(result.callsError.code, 'KITCHEN_CALLS_TIMEOUT');
});

test('late or cross-branch kitchen snapshots cannot replace the current branch board', () => {
  const shouldRenderKitchenSnapshot = loadKitchenHelper('shouldRenderKitchenSnapshot');

  assert.equal(shouldRenderKitchenSnapshot(4, 4, '12', 12, 'kitchen'), true);
  assert.equal(shouldRenderKitchenSnapshot(3, 4, '12', 12, 'kitchen'), false, 'an older request cannot win a race');
  assert.equal(shouldRenderKitchenSnapshot(4, 4, '12', 13, 'kitchen'), false, 'a prior branch cannot overwrite the new branch');
  assert.equal(shouldRenderKitchenSnapshot(4, 4, '12', 12, 'orders'), false, 'a hidden workspace is not repainted');
});

test('admin kitchen keeps explicit priority ahead of FIFO age ordering', () => {
  const orderKitchenAdminTickets = loadKitchenHelper('orderKitchenAdminTickets');
  const tickets = [
    { id: 'old', ageSec: 900, kds: { priority: false } },
    { id: 'priority-new', ageSec: 60, kds: { priority: true } },
    { id: 'middle', ageSec: 300, kds: { priority: false } },
  ];

  assert.deepEqual(orderKitchenAdminTickets(tickets).map((ticket) => ticket.id), ['priority-new', 'old', 'middle']);
  assert.deepEqual(tickets.map((ticket) => ticket.id), ['old', 'priority-new', 'middle'], 'display ordering does not mutate the API snapshot');
});

test('KDS cards visibly identify amended orders and safely omit malformed edit metadata', () => {
  const adminKitchenAmendmentLabel = loadKitchenHelper('adminKitchenAmendmentLabel');
  const label = adminKitchenAmendmentLabel({ editRevision: 2, editedAt: '2026-09-24T10:30:00.000Z' });
  assert.match(label, /^اصلاح سفارش پس از ارسال · نسخه ۲ · ساعت /);
  assert.equal(adminKitchenAmendmentLabel({ editRevision: 0, editedAt: 'not-a-date' }), '');
  assert.match(adminKitchenAmendmentLabel({ editRevision: 3, editedAt: 'not-a-date' }), /نسخه ۳/);

  const kitchenStart = source.indexOf('async kitchen() {');
  const kitchenEnd = source.indexOf('\n    async reservations()', kitchenStart);
  const kitchenUi = source.slice(kitchenStart, kitchenEnd);
  assert.match(kitchenUi, /adminKitchenAmendmentLabel\(t\)/);
  assert.match(kitchenUi, /class="kds-amendment">\$\{esc\(amendmentLabel\)\}/);

  const ticketStart = serverSource.indexOf('function kitchenTicket(');
  const ticketEnd = serverSource.indexOf('function kdsPerformance(', ticketStart);
  const ticketSource = serverSource.slice(ticketStart, ticketEnd);
  assert.match(ticketSource, /return\s*\{\s*\.\.\.order,/s, 'the branch-scoped KDS snapshot carries persisted edit metadata through to staff');
});

test('admin KDS status buttons suppress concurrent duplicate clicks while a request is pending', async () => {
  const runBusy = loadKitchenHelper('runBusy');
  let release;
  let actions = 0;
  const button = {
    dataset: {},
    textContent: 'آماده شد',
    disabled: false,
    setAttribute() {},
    removeAttribute() {},
  };
  const request = new Promise((resolve) => { release = resolve; });
  const first = runBusy(button, () => { actions += 1; return request; });
  const duplicate = runBusy(button, () => { actions += 1; return Promise.resolve(); });

  assert.equal(actions, 1);
  assert.equal(button.disabled, true);
  release({ ok: true });
  await Promise.all([first, duplicate]);
  assert.equal(button.disabled, false);
  assert.equal(button.dataset.busy, '0');
});

test('admin kitchen exposes an accessible retry when only waiter calls fail', () => {
  const kitchenStart = source.indexOf('async kitchen() {');
  const kitchenEnd = source.indexOf('\n    async reservations()', kitchenStart);
  assert.ok(kitchenStart >= 0 && kitchenEnd > kitchenStart);
  const kitchenUi = source.slice(kitchenStart, kitchenEnd);

  assert.match(kitchenUi, /settleKitchenWorkspaceRequests\([\s\S]*?api\(`\/api\/kitchen\/orders/);
  assert.match(kitchenUi, /callsError \? `<section class="section-box kds-calls-error" role="alert">/);
  assert.match(kitchenUi, /data-kds-calls-retry/);
  assert.match(kitchenUi, /تلاش دوباره/);
  assert.match(kitchenUi, /data-kds-queue-retry/);
  assert.match(kitchenUi, /data-kds-refresh/);
  assert.match(kitchenUi, /آخرین دریافت موفق/);
  assert.match(kitchenUi, /اطلاعات قبلی فقط برای مشاهده است/);
});

test('admin kitchen reports a lost live connection and fetches a fresh snapshot after reconnect', () => {
  const streamStart = source.indexOf('function startCommandCenterStream() {');
  const streamEnd = source.indexOf('\n  function pauseLiveWorkspace()', streamStart);
  assert.ok(streamStart >= 0 && streamEnd > streamStart);
  const stream = source.slice(streamStart, streamEnd);

  assert.match(source, /function setAdminKitchenStreamStatus\(connected\)/);
  assert.match(source, /data-kds-stream-status/);
  assert.match(stream, /stream\.onerror\s*=\s*\(\)\s*=>\s*\{[^}]*setAdminKitchenStreamStatus\(false\)/s);
  assert.match(stream, /stream\.onopen\s*=\s*\(\)\s*=>\s*\{[^}]*if \(streamHasOpened\) refreshLiveWorkspace\(\{ immediate: true \}\)/s);
});

test('admin KDS cards preserve kitchen-critical details and expose per-item actions without enabling held lines', () => {
  const kitchenStart = source.indexOf('async kitchen() {');
  const kitchenEnd = source.indexOf('\n    async reservations()', kitchenStart);
  const kitchenUi = source.slice(kitchenStart, kitchenEnd);

  assert.match(kitchenUi, /orderKitchenAdminTickets\(queue\.tickets \|\| \[\]\)/);
  assert.match(kitchenUi, /t\.kds\?\.priority === true \? '★ اولویت/);
  assert.match(kitchenUi, /یادداشت آشپزخانه/);
  assert.match(kitchenUi, /t\.heldCourseItems \|\| \[\]/);
  assert.match(kitchenUi, /منتظر ارسال دوره از سالن/);
  assert.match(kitchenUi, /data-kds-action="\$\{itemAction\.action\}"/);
  assert.match(kitchenUi, /isHeld \? null : adminKitchenLineAction\(item, ticket\.column\)/);
  assert.match(kitchenUi, /completionAction\.enabled/);
  assert.doesNotMatch(kitchenUi, /data-kstatus="\$\{t\.id\}"/);
});
