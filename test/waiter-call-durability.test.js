'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
const clientSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'table-cart.js'), 'utf8');

function routeHandler(marker, dependencies) {
  const start = source.indexOf(marker);
  const nextRoute = source.indexOf('\n\napp.', start);
  assert.ok(start >= 0 && nextRoute > start, `route exists: ${marker}`);
  const route = source.slice(start, nextRoute);
  const signature = 'async (req, res) => {';
  const bodyStart = route.indexOf(signature);
  const bodyEnd = route.lastIndexOf('\n});');
  assert.ok(bodyStart >= 0 && bodyEnd > bodyStart, `async handler can be isolated: ${marker}`);
  const body = route.slice(bodyStart + signature.length, bodyEnd);
  return new Function(
    ...Object.keys(dependencies),
    `return async (req, res) => {${body}\n};`,
  )(...Object.values(dependencies));
}

function response() {
  return {
    statusCode: 200,
    body: null,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function fixture(initial = {}) {
  let shouldFailPersist = Boolean(initial.failPersist);
  const db = {
    branches: [{ id: 1, active: true }, { id: 2, active: true }],
    tables: [
      { id: 7, label: 'میز ۷', branchId: 1, active: true },
      { id: 7, label: 'میز ۷', branchId: 2, active: true },
      { id: 8, label: 'میز ۸', branchId: 1, active: false },
    ],
    waiterCalls: [],
    auditLog: [],
    ...initial,
  };
  const effects = [];
  const mutationQueues = new Map();
  const deps = {
    db,
    normalizeDigits: (value) => String(value).replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))),
    defaultBranch: () => db.branches.find((branch) => branch.active !== false),
    tableBranchId: (table) => Number(table.branchId || 1),
    tableNoBelongsToTable: (tableNo, tableId) => {
      const canonical = (value) => String(value || '').replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
        .trim().replace(/^میز\s*/u, '').replace(/\s+/g, '');
      const actual = canonical(tableNo);
      const target = canonical(tableId);
      return Boolean(actual && target && (actual === target || actual.startsWith(`${target}-`)));
    },
    tableForBranch: (tableNo, branchId) => db.tables.find((table) => Number(table.branchId || 1) === Number(branchId)
      && (String(table.id) === String(tableNo).replace(/^میز\s*/u, '')
        || String(table.label) === String(tableNo)) ) || null,
    serializeAdminConfigMutation: (branchId, operation) => {
      const key = String(branchId);
      const previous = mutationQueues.get(key) || Promise.resolve();
      const current = previous.catch(() => {}).then(operation);
      mutationQueues.set(key, current);
      return current.finally(() => {
        if (mutationQueues.get(key) === current) mutationQueues.delete(key);
      });
    },
    snapshotFinanceMutationState: () => JSON.parse(JSON.stringify({ waiterCalls: db.waiterCalls, auditLog: db.auditLog })),
    recordAudit: (...args) => {
      effects.push(['audit-created', args[1]]);
      return { action: args[1], details: args[4] };
    },
    appendAuditAfterCommit: (entry) => { effects.push(['audit-appended', entry.action]); db.auditLog.push(entry); },
    publishOperationalEvent: (name, payload) => effects.push(['event', name, payload]),
    persistFinanceMutation: async (snapshot) => {
      effects.push(['persist']);
      if (shouldFailPersist) {
        db.waiterCalls = snapshot.waiterCalls;
        db.auditLog = snapshot.auditLog;
        throw Object.assign(new Error('write failed'), { status: 503, code: 'durable_write_failed' });
      }
    },
    assertUserBranchAccess: () => {},
  };
  return { db, effects, deps, setFailPersist(value) { shouldFailPersist = Boolean(value); } };
}

test('public waiter-call creation rejects inactive or missing tables without persistence', async () => {
  for (const tableNo of ['99', '8']) {
    const { db, effects, deps } = fixture();
    const handler = routeHandler("app.post('/api/call-waiter'", deps);
    const res = response();
    await handler({ body: { tableNo, branchId: 1 }, requestId: 'req-1' }, res);
    assert.ok([404, 409].includes(res.statusCode));
    assert.equal(db.waiterCalls.length, 0);
    assert.deepEqual(effects, []);
  }
});

test('public waiter-call creation commits before audit, event, and success response', async () => {
  const { db, effects, deps } = fixture();
  const handler = routeHandler("app.post('/api/call-waiter'", deps);
  const res = response();
  await handler({ body: { tableNo: 'میز ۷', requestType: 'bill', note: 'صورتحساب', branchId: 2 }, requestId: 'req-2' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(db.waiterCalls[0].branchId, 2);
  assert.equal(db.waiterCalls[0].requestType, 'bill');
  assert.equal(db.auditLog[0].details.requestType, 'bill');
  assert.equal(effects.find(([name]) => name === 'event')[2].requestType, 'bill');
  assert.deepEqual(effects.map(([name]) => name), ['audit-created', 'persist', 'audit-appended', 'event']);
});

test('waiter-call request types are validated and distinct intents do not dedupe each other', async () => {
  const { db, effects, deps } = fixture();
  const handler = routeHandler("app.post('/api/call-waiter'", deps);

  const invalid = response();
  await handler({ body: { tableNo: '7', requestType: 'payment', branchId: 1 } }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error, 'waiter_call_request_type_invalid');
  assert.equal(db.waiterCalls.length, 0);
  assert.deepEqual(effects, []);

  const calls = [];
  for (const [requestType, note] of [
    ['service', 'حضور گارسون'],
    ['bill', 'درخواست صورتحساب'],
    ['supplies', 'درخواست دستمال'],
    ['other', 'سفارش مجدد'],
  ]) {
    const res = response();
    await handler({ body: { tableNo: '7', requestType, note, branchId: 1 } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.call.requestType, requestType);
    calls.push(res.body.call);
  }
  assert.equal(db.waiterCalls.length, 4);
  assert.deepEqual(new Set(db.waiterCalls.map((call) => call.requestType)), new Set(['service', 'bill', 'supplies', 'other']));

  effects.length = 0;
  const replay = response();
  await handler({ body: { tableNo: '7', requestType: 'bill', note: 'درخواست صورتحساب', branchId: 1 } }, replay);
  assert.equal(replay.body.idempotent, true);
  assert.equal(replay.body.call.id, calls[1].id);
  assert.deepEqual(effects, []);

  const changedIntent = response();
  await handler({ body: { tableNo: '7', requestType: 'bill', note: 'صورتحساب جداگانه', branchId: 1 } }, changedIntent);
  assert.equal(changedIntent.body.idempotent, undefined);
  assert.notEqual(changedIntent.body.call.id, calls[1].id);
  assert.equal(db.waiterCalls.length, 5);
});

test('simultaneous retries of the same active waiter intent create one durable call', async () => {
  const { db, effects, deps } = fixture();
  const handler = routeHandler("app.post('/api/call-waiter'", deps);
  const body = { tableNo: '7', requestType: 'supplies', note: 'درخواست دستمال', branchId: 1 };
  const first = response();
  const second = response();

  await Promise.all([
    handler({ body }, first),
    handler({ body }, second),
  ]);

  assert.equal(db.waiterCalls.length, 1);
  assert.equal(effects.filter(([name]) => name === 'persist').length, 1);
  assert.deepEqual([first.body.idempotent, second.body.idempotent].sort(), [undefined, true].sort());
  assert.equal(first.body.call.id, second.body.call.id);
});

test('waiter-call cancellation cannot use another branch call id or an inactive table', async () => {
  const { db, effects, deps } = fixture({ waiterCalls: [
    { id: 21, branchId: 1, tableNo: 'میز ۷', status: 'open' },
    { id: 22, branchId: 2, tableNo: 'میز ۷', status: 'open' },
  ] });
  const handler = routeHandler("app.post('/api/call-waiter/cancel'", deps);
  const crossBranch = response();
  await handler({ body: { tableNo: 'میز ۷', callId: 21, branchId: 2 } }, crossBranch);
  assert.equal(crossBranch.statusCode, 404);
  assert.equal(db.waiterCalls[0].status, 'open');
  assert.equal(db.waiterCalls[1].status, 'open');
  assert.deepEqual(effects, []);

  const inactive = response();
  await handler({ body: { tableNo: 'میز ۸', callId: 21, branchId: 1 } }, inactive);
  assert.equal(inactive.statusCode, 404);
  assert.deepEqual(effects, []);
});

test('failed durable cancellation restores state and does not publish audit or event', async () => {
  const { db, effects, deps } = fixture({
    failPersist: true,
    waiterCalls: [{ id: 31, branchId: 1, tableNo: 'میز ۷', status: 'open' }],
  });
  const handler = routeHandler("app.post('/api/call-waiter/cancel'", deps);
  const res = response();
  await handler({ body: { tableNo: 'میز ۷', callId: 31, branchId: 1 }, requestId: 'req-3' }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(db.waiterCalls[0].status, 'open');
  assert.deepEqual(effects.map(([name]) => name), ['audit-created', 'persist']);
});

test('successful waiter-call cancellation is idempotent and commits before side effects', async () => {
  const { db, effects, deps } = fixture({
    waiterCalls: [{ id: 41, branchId: 1, tableNo: 'میز ۷', status: 'open' }],
  });
  const handler = routeHandler("app.post('/api/call-waiter/cancel'", deps);
  const first = response();
  await handler({ body: { tableNo: 'میز ۷', callId: 41, branchId: 1 }, requestId: 'req-4' }, first);
  assert.equal(first.body.ok, true);
  assert.equal(db.waiterCalls[0].status, 'cancelled');
  assert.deepEqual(effects.map(([name]) => name), ['audit-created', 'persist', 'audit-appended', 'event']);

  effects.length = 0;
  const replay = response();
  await handler({ body: { tableNo: 'میز ۷', callId: 41, branchId: 1 }, requestId: 'req-5' }, replay);
  assert.equal(replay.body.idempotent, true);
  assert.deepEqual(effects, []);
});

test('waiter resolution rolls back if durable persistence fails and is safe to retry after success', async () => {
  const { db, effects, deps, setFailPersist } = fixture({
    failPersist: true,
    waiterCalls: [{ id: 51, branchId: 1, tableNo: 'میز ۷', status: 'open' }],
  });
  const handler = routeHandler("app.patch('/api/waiter/calls/:id'", deps);
  const failed = response();
  await handler({ params: { id: '51' }, body: { status: 'done' }, user: { phone: 'waiter' }, requestId: 'req-6' }, failed);
  assert.equal(failed.statusCode, 503);
  assert.equal(db.waiterCalls[0].status, 'open');
  assert.deepEqual(effects.map(([name]) => name), ['audit-created', 'persist']);

  setFailPersist(false);
  effects.length = 0;
  const succeeded = response();
  await handler({ params: { id: '51' }, body: { status: 'done' }, user: { phone: 'waiter' }, requestId: 'req-7' }, succeeded);
  assert.equal(succeeded.body.ok, true);
  assert.equal(db.waiterCalls[0].status, 'done');
  assert.deepEqual(effects.map(([name]) => name), ['audit-created', 'persist', 'audit-appended', 'event']);
});

test('guest cancellation sends its branch and does not clear the calling state on HTTP failure', () => {
  const start = clientSource.indexOf("const bindCancel = () => {");
  const end = clientSource.indexOf('\n      bindCancel();', start);
  assert.ok(start >= 0 && end > start, 'floating waiter cancellation handler exists');
  const cancelHandler = clientSource.slice(start, end);
  assert.match(cancelHandler, /JSON\.stringify\(\{ tableNo, callId: activeCallId, branchId \}\)/);
  assert.match(cancelHandler, /if \(!response\.ok \|\| data\.ok !== true\) throw/);
  assert.ok(cancelHandler.indexOf('if (!response.ok') < cancelHandler.indexOf('resetCallingState()'));
  assert.match(cancelHandler, /cancelBtn\.disabled = false/);
});

test('bill and ordinary waiter calls send distinct request types with the same table and branch context', () => {
  const directStart = clientSource.indexOf("callWaiterBtn.addEventListener('click'");
  const directEnd = clientSource.indexOf("\n    });", directStart);
  assert.ok(directStart >= 0 && directEnd > directStart, 'direct waiter button handler exists');
  const directHandler = clientSource.slice(directStart, directEnd);
  assert.match(directHandler, /JSON\.stringify\(\{ tableNo, requestType: 'service', note: tr\('cart\.waiterNote'\), \.\.\.waiterBranch \}\)/);
  assert.match(directHandler, /const waiterBranch = waiterBranchRequestContext\(initialCartContext\)/);
  assert.match(directHandler, /initialCartContext\.table/);

  const presetsStart = clientSource.indexOf('<div class="westo-call-presets"');
  const presetsEnd = clientSource.indexOf('</div>', presetsStart);
  assert.ok(presetsStart >= 0 && presetsEnd > presetsStart, 'waiter request presets exist');
  const presets = clientSource.slice(presetsStart, presetsEnd);
  assert.match(presets, /data-request-type="service" data-note="حضور گارسون در کنار میز"/);
  assert.match(presets, /data-request-type="bill" data-note="درخواست صورت‌حساب و فاکتور"/);
  assert.match(presets, /data-request-type="supplies" data-note="درخواست قاشق و چنگال، دستمال یا لیوان"/);
  assert.match(presets, /data-request-type="other" data-note="سفارش مجدد و مشاوره درباره منو"/);

  const selectionStart = clientSource.indexOf("modal.querySelectorAll('.call-preset-btn').forEach((btn) => {");
  const selectionEnd = clientSource.indexOf('const openModal =', selectionStart);
  assert.ok(selectionStart >= 0 && selectionEnd > selectionStart, 'selected preset drives the request type');
  assert.match(clientSource.slice(selectionStart, selectionEnd), /selectedRequestType = btn\.dataset\.requestType/);

  const submitStart = clientSource.indexOf("submitBtn.addEventListener('click', async () => {", selectionEnd);
  const submitEnd = clientSource.indexOf('\n    });', submitStart);
  assert.ok(submitStart >= 0 && submitEnd > submitStart, 'preset submission handler exists');
  const submitHandler = clientSource.slice(submitStart, submitEnd);
  assert.match(submitHandler, /const finalNote = customNote \? `\$\{selectedNote\}: \$\{customNote\}` : selectedNote/);
  assert.match(submitHandler, /JSON\.stringify\(\{ tableNo, requestType: selectedRequestType, note: finalNote, branchId \}\)/);
  assert.match(clientSource.slice(clientSource.indexOf('function initFloatingWaiterCall()'), selectionStart), /const tableNo = rawTable/);
  assert.match(clientSource.slice(clientSource.indexOf('function initFloatingWaiterCall()'), selectionStart), /const branchId = waiterBranch\.branchId/);
});
