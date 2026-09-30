'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const os = require('node:os');
const crypto = require('node:crypto');

const isolatedEnvironmentKeys = [
  'NODE_ENV', 'WESTO_DB_PATH', 'WESTO_ALLOW_TEST_DB_WRITE', 'DATABASE_URL',
  'WESTO_POSTGRES_REQUIRED', 'SALSA_CONTROL_DATABASE_URL', 'NEEM_CONTROL_DATABASE_URL',
];
const originalEnvironment = Object.fromEntries(isolatedEnvironmentKeys.map((key) => [key, process.env[key]]));
const checkoutDbPath = path.resolve(__dirname, '../server/data/db.json');
const checkoutDbHashBefore = crypto.createHash('sha256').update(fs.readFileSync(checkoutDbPath)).digest('hex');
const isolatedTestDbPath = path.join(os.tmpdir(), `westo-reservation-test-${process.pid}-${crypto.randomUUID()}.json`);
assert.equal(fs.existsSync(isolatedTestDbPath), false, 'the unique temporary database path does not exist yet');
process.env.NODE_ENV = 'test';
process.env.WESTO_DB_PATH = isolatedTestDbPath;
process.env.WESTO_ALLOW_TEST_DB_WRITE = 'false';
delete process.env.DATABASE_URL;
delete process.env.SALSA_CONTROL_DATABASE_URL;
delete process.env.NEEM_CONTROL_DATABASE_URL;
process.env.WESTO_POSTGRES_REQUIRED = 'false';
process.once('exit', () => {
  for (const key of isolatedEnvironmentKeys) {
    if (originalEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnvironment[key];
  }
  fs.rmSync(isolatedTestDbPath, { force: true });
  fs.rmSync(`${isolatedTestDbPath}.${process.pid}.tmp`, { force: true });
  fs.rmSync(`${isolatedTestDbPath}.${process.pid}.shutdown.tmp`, { force: true });
});

const htmlPath = path.join(__dirname, '../reserve.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((script) => script.trim());

function extractInlineFunction(name) {
  const script = inlineScripts.find((item) => item.includes(`function ${name}(`));
  assert.ok(script, `${name} is present in an inline script`);
  const match = script.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n      \\}`));
  assert.ok(match, `${name} body can be isolated for a focused behavior check`);
  return match[0];
}

test('the complete inline scripts on the public reservation page parse', () => {
  assert.ok(inlineScripts.length > 0, 'inline scripts exist');
  inlineScripts.forEach((script, index) => {
    assert.doesNotThrow(() => new vm.Script(script, { filename: `reserve.html:inline-${index + 1}` }));
  });
});

test('the server test harness uses an isolated database and preserves the checkout database', () => {
  assert.equal(process.env.WESTO_DB_PATH, isolatedTestDbPath);
  assert.notEqual(path.resolve(process.env.WESTO_DB_PATH), checkoutDbPath);
  assert.equal(process.env.WESTO_ALLOW_TEST_DB_WRITE, 'false');
  assert.equal(process.env.DATABASE_URL, undefined);
  assert.equal(process.env.SALSA_CONTROL_DATABASE_URL, undefined);
  assert.equal(process.env.NEEM_CONTROL_DATABASE_URL, undefined);
  const currentHash = crypto.createHash('sha256').update(fs.readFileSync(checkoutDbPath)).digest('hex');
  assert.equal(currentHash, checkoutDbHashBefore);
});

test('reservation submit sends nothing unless the opaque retry key is retained and verified', async () => {
  const keyFunction = extractInlineFunction('getReservationRetryKey');
  const submitFunction = extractInlineFunction('submitReservationRequest');
  let fetchCalls = 0;
  const makeSubmit = (storage) => vm.runInNewContext(`(() => {
    let memoryReservationRetryKey = '';
    const reservationRetryStorageKey = 'westo_reservation_retry_key';
    ${keyFunction}
    ${submitFunction}
    return submitReservationRequest;
  })()`, {
    sessionStorage: storage,
    window: { crypto: { getRandomValues(bytes) { bytes.fill(7); return bytes; } } },
    fetch() { fetchCalls += 1; return Promise.resolve({ ok: true }); },
  });

  const inaccessibleStorage = {
    getItem() { throw new Error('storage denied'); },
    setItem() { throw new Error('storage denied'); },
  };
  await assert.rejects(makeSubmit(inaccessibleStorage)({ name: 'PII', phone: '09123456789' }), {
    code: 'reservation_retry_storage_unavailable',
  });
  assert.equal(fetchCalls, 0);

  const silentStorage = { getItem() { return null; }, setItem() {} };
  await assert.rejects(makeSubmit(silentStorage)({ name: 'PII', phone: '09123456789' }), {
    code: 'reservation_retry_storage_unavailable',
  });
  assert.equal(fetchCalls, 0);

  const values = new Map();
  const workingStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
  await makeSubmit(workingStorage)({ name: 'PII', phone: '09123456789' });
  assert.equal(fetchCalls, 1);
  assert.equal(values.size, 1);
  assert.match(values.get('westo_reservation_retry_key'), /^reservation-[a-f0-9]{32}$/);
  assert.doesNotMatch([...values.values()].join(' '), /PII|09123456789/);
});

const serverPath = path.resolve(__dirname, '../server/server.js');
const originalLoad = Module._load;
const notificationCalls = [];
const events = [];
let failNextWrite = false;
Module._load = function loadWithReservationNotificationStub(request, parent, isMain) {
  if (request === './whatsapp-notify' && parent?.filename === serverPath) {
    return {
      notifyOrderWhatsApp: async () => ({ skipped: true }),
      notifyReservationWhatsApp: async (_db, reservation) => {
        events.push('notification');
        notificationCalls.push(Number(reservation.id));
        return { skipped: false, webhook: { sent: true } };
      },
      waMeUrl: () => null,
      buildOrderMessage: () => '',
      resolveNotifyPhone: () => '',
      toWaDigits: (value) => String(value || ''),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const serverModule = require(serverPath);
Module._load = originalLoad;

const { app, db, stateStore } = serverModule;
const trackedDbKeys = ['reservationSettings', 'reservations', 'reservationIdempotency', 'auditLog', 'branches', 'commandCenter'];
const originalDb = Object.fromEntries(trackedDbKeys.map((key) => [
  key,
  Object.prototype.hasOwnProperty.call(db, key) ? JSON.parse(JSON.stringify(db[key])) : undefined,
]));
const originalHasDbKey = Object.fromEntries(trackedDbKeys.map((key) => [key, Object.prototype.hasOwnProperty.call(db, key)]));
const originalStateStoreEnabled = stateStore.enabled;
const originalStateStoreWrite = stateStore.write;
const originalStateStoreAppendAudit = stateStore.appendAudit;
let branchId;
let testDate;
let currentWrites;
const reservationRouteLayer = (app.router || app._router).stack.find((layer) =>
  layer.route?.path === '/api/reservations' && layer.route.methods.post
);
assert.ok(reservationRouteLayer, 'public reservation POST route exists');
const reservationHandler = reservationRouteLayer.route.stack[0].handle;

function isoLocalDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function resetReservationState() {
  notificationCalls.length = 0;
  events.length = 0;
  currentWrites = [];
  failNextWrite = false;

  const branches = JSON.parse(JSON.stringify(originalDb.branches || []));
  const branch = branches.find((item) => item.active !== false) || branches[0];
  assert.ok(branch, 'an active branch exists in the fixture');
  branchId = Number(branch.id);
  branch.hours = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((day) => [
    day,
    { open: '00:00', close: '23:59', closed: false },
  ]));
  db.branches = branches;
  db.reservationSettings = {
    ...(originalDb.reservationSettings || {}),
    enabled: true,
    slotMinutes: 30,
    maxParty: 12,
    advanceDays: 30,
    minHoursAhead: 0,
    maxCoversPerSlot: 2,
  };
  db.reservations = [];
  db.reservationIdempotency = {};
  db.auditLog = [];
  db.commandCenter = { ...(originalDb.commandCenter || {}), eventRevision: 0 };

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  testDate = isoLocalDate(tomorrow);
}

function payload(overrides = {}) {
  return {
    branchId,
    date: testDate,
    time: '12:00',
    partySize: 2,
    name: 'رزرو آزمایشی',
    phone: '09123456789',
    note: '',
    ...overrides,
  };
}

async function postReservation(body, key) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['idempotency-key'] = key;
  const req = {
    body,
    headers,
    get(name) { return headers[String(name).toLowerCase()] || ''; },
  };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  await reservationHandler(req, res);
  return { status: res.statusCode, body: res.body };
}

test.before(async () => {
  process.env.NODE_ENV = 'test';
  stateStore.enabled = true;
  stateStore.appendAudit = async () => {};
  stateStore.write = async (state) => {
    const hasNewKey = Object.values(state.reservationIdempotency || {}).some((item) =>
      (state.reservations || []).some((reservation) => Number(reservation.id) === Number(item.reservationId))
    );
    const write = { hasReservation: (state.reservations || []).length > 0, hasIdempotencyRecord: hasNewKey };
    currentWrites.push(write);
    if (failNextWrite) {
      failNextWrite = false;
      events.push('write-failed');
      throw Object.assign(new Error('simulated durable store failure'), { code: 'test_write_failed', status: 503 });
    }
    events.push('durable');
    return true;
  };
  resetReservationState();
});

test.beforeEach(() => resetReservationState());

test.after(async () => {
  const checkoutDbHashAfter = crypto.createHash('sha256').update(fs.readFileSync(checkoutDbPath)).digest('hex');
  assert.equal(checkoutDbHashAfter, checkoutDbHashBefore, 'reservation tests did not change server/data/db.json');
  stateStore.enabled = originalStateStoreEnabled;
  stateStore.write = originalStateStoreWrite;
  stateStore.appendAudit = originalStateStoreAppendAudit;
  for (const key of trackedDbKeys) {
    if (originalHasDbKey[key]) db[key] = originalDb[key];
    else delete db[key];
  }
});

test('production requires an idempotency key and invalid or out-of-window dates fail closed', async () => {
  process.env.NODE_ENV = 'production';
  const missingKey = await postReservation(payload(), null);
  assert.equal(missingKey.status, 400);
  assert.equal(missingKey.body.code, 'idempotency_key_required');

  process.env.NODE_ENV = 'test';
  const invalidDate = await postReservation(payload({ date: '2026-02-31' }), 'date-invalid-0001');
  assert.equal(invalidDate.status, 400);
  assert.equal(invalidDate.body.code, 'reservation_date_invalid');

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const outOfWindow = await postReservation(payload({ date: isoLocalDate(yesterday) }), 'date-old-0001');
  assert.equal(outOfWindow.status, 400);
  assert.equal(outOfWindow.body.code, 'reservation_date_out_of_range');
  assert.equal(db.reservations.length, 0);
  assert.equal(notificationCalls.length, 0);
  assert.equal(currentWrites.length, 0);
});

test('missing, array, and scalar request bodies return 400 without reservation, write, or notification', async () => {
  for (const body of [undefined, null, [], 'not-an-object']) {
    const result = await postReservation(body, 'body-invalid-0001');
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'reservation_body_invalid');
  }
  assert.equal(db.reservations.length, 0);
  assert.deepEqual(db.reservationIdempotency, {});
  assert.equal(currentWrites.length, 0);
  assert.equal(notificationCalls.length, 0);
});

test('a durable commit failure rolls back reservation and idempotency state before notification', async () => {
  failNextWrite = true;
  const result = await postReservation(payload(), 'rollback-0001');
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'reservation_persistence_failed');
  assert.equal(db.reservations.length, 0);
  assert.equal(Object.hasOwn(db.reservationIdempotency, 'rollback-0001'), false);
  assert.equal(notificationCalls.length, 0);
  assert.deepEqual(events, ['write-failed']);
});

test('same key and payload replay the reservation without another write or notification; changed payload conflicts', async () => {
  const key = 'replay-0001';
  const requestBody = payload();
  const created = await postReservation(requestBody, key);
  assert.equal(created.status, 201);
  assert.equal(created.body.idempotentReplay, false);
  assert.equal(currentWrites[0].hasReservation, true);
  assert.equal(currentWrites[0].hasIdempotencyRecord, true);
  assert.ok(events.indexOf('durable') >= 0 && events.indexOf('durable') < events.indexOf('notification'));

  const writeCount = currentWrites.length;
  const replay = await postReservation(requestBody, key);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(replay.body.reservation.id, created.body.reservation.id);
  assert.equal(currentWrites.length, writeCount);
  assert.equal(notificationCalls.length, 1);

  const conflict = await postReservation(payload({ note: 'متن متفاوت' }), key);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'idempotency_key_conflict');
  assert.equal(db.reservations.length, 1);
  assert.equal(notificationCalls.length, 1);
});

test('closed days and full slots reject stale public requests; concurrent same-slot creates serialize in-process', async () => {
  const branch = db.branches.find((item) => Number(item.id) === branchId);
  const weekday = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${testDate}T12:00:00`).getDay()];
  branch.hours[weekday] = { closed: true };
  const closed = await postReservation(payload(), 'closed-0001');
  assert.equal(closed.status, 409);
  assert.equal(closed.body.code, 'reservation_day_closed');
  assert.equal(db.reservations.length, 0);

  branch.hours[weekday] = { open: '00:00', close: '23:59', closed: false };
  const concurrent = await Promise.all([
    postReservation(payload(), 'capacity-a-0001'),
    postReservation(payload({ name: 'رزرو دوم' }), 'capacity-b-0001'),
  ]);
  assert.deepEqual(concurrent.map((item) => item.status).sort(), [201, 409]);
  const rejected = concurrent.find((item) => item.status === 409);
  assert.equal(rejected.body.code, 'reservation_slot_unavailable');
  assert.equal(db.reservations.length, 1);
  assert.equal(notificationCalls.length, 1);
});
