'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

function kitchenCallPatchHandler(dependencies) {
  const start = serverSource.indexOf("app.patch('/api/kitchen/calls/:id'");
  const end = serverSource.indexOf('\n});', start);
  assert.ok(start >= 0 && end > start, 'the KDS waiter-call route is present');

  const routeSource = serverSource.slice(start, end);
  const arrow = routeSource.indexOf('(req, res) => {');
  assert.ok(arrow >= 0, 'the route handler can be isolated without starting the server');

  const body = routeSource.slice(arrow + '(req, res) => {'.length);
  return new Function(
    ...Object.keys(dependencies),
    `return (req, res) => {${body};};`,
  )(...Object.values(dependencies));
}

test('invalid KDS waiter-call status is rejected without marking an open call resolved', () => {
  const call = { id: 17, branchId: 4, status: 'open' };
  const before = { ...call };
  let saves = 0;
  const handler = kitchenCallPatchHandler({
    db: { waiterCalls: [call] },
    normalizeDigits: (value) => value,
    assertUserBranchAccess: () => {},
    save: () => { saves += 1; },
  });
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  handler({ params: { id: '17' }, body: { status: 'erase' }, user: { phone: 'audit' } }, response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(call, before);
  assert.equal(saves, 0);
});

test('resolving a waiter call records completion time only for the done state', () => {
  const call = { id: 18, branchId: 4, status: 'open', resolvedAt: null };
  let saves = 0;
  const handler = kitchenCallPatchHandler({
    db: { waiterCalls: [call] },
    normalizeDigits: (value) => value,
    assertUserBranchAccess: () => {},
    save: () => { saves += 1; },
  });
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  handler({ params: { id: '18' }, body: { status: 'done' }, user: { phone: 'audit' } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(call.status, 'done');
  assert.ok(Number.isFinite(Date.parse(call.resolvedAt)));
  assert.equal(saves, 1);
});

test('reopening a waiter call clears its old resolution timestamp', () => {
  const call = { id: 19, branchId: 4, status: 'done', resolvedAt: '2026-09-23T00:00:00.000Z' };
  const handler = kitchenCallPatchHandler({
    db: { waiterCalls: [call] },
    normalizeDigits: (value) => value,
    assertUserBranchAccess: () => {},
    save: () => {},
  });
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  handler({ params: { id: '19' }, body: { status: 'open' }, user: { phone: 'audit' } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(call.status, 'open');
  assert.equal(call.resolvedAt, null);
});
