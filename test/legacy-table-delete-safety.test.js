'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

function mountLegacyDeleteRoute(db) {
  const start = serverSource.indexOf("app.delete('/api/admin/tables/:id'");
  const end = serverSource.indexOf('\n\n// QR artwork', start);
  assert.notEqual(start, -1, 'legacy DELETE route must remain registered for a guided compatibility response');
  assert.notEqual(end, -1, 'legacy DELETE route boundary must be identifiable');

  let saveCalls = 0;
  const requireAdmin = () => {};
  const module = { exports: {} };
  vm.runInNewContext(`
    let registeredPath = null;
    let registeredHandlers = null;
    const app = { delete(routePath, ...handlers) { registeredPath = routePath; registeredHandlers = handlers; } };
    ${serverSource.slice(start, end)}
    module.exports = { path: registeredPath, handlers: registeredHandlers };
  `, {
    module,
    requireAdmin,
    db,
    save: async () => { saveCalls += 1; return true; },
    normalizeDigits: (value) => String(value),
    parseBranchId: () => 7,
    tableBranchId: (table) => Number(table.branchId),
  }, { filename: 'server/server.js legacy table delete route' });

  return { ...module.exports, requireAdmin, getSaveCalls: () => saveCalls };
}

function responseRecorder() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('legacy table DELETE remains authenticated and is fail-closed with a revisioned API guide', async () => {
  const db = { tables: [{ id: 1, branchId: 7, label: 'میز ۱' }], floorLayoutRevisions: { 7: 4 } };
  const route = mountLegacyDeleteRoute(db);

  assert.equal(route.path, '/api/admin/tables/:id');
  assert.equal(route.handlers[0], route.requireAdmin, 'legacy deletion must retain its admin authentication middleware');

  const before = JSON.stringify(db);
  const response = responseRecorder();
  await route.handlers.at(-1)({ params: { id: '1' } }, response);

  assert.equal(response.statusCode, 428);
  assert.equal(response.body.error, 'floor_layout_revision_required');
  assert.equal(response.body.replacement.read, 'GET /api/admin/v2/floor?branchId={branchId}');
  assert.equal(response.body.replacement.delete, 'POST /api/admin/v2/floor/tables/delete');
  assert.deepEqual(Array.from(response.body.replacement.requiredBody), ['expectedLayoutRevision', 'tableIds']);
  assert.equal(JSON.stringify(db), before, 'the legacy request must not mutate tables or revisions');
  assert.equal(route.getSaveCalls(), 0, 'the legacy request must not persist an unrevisioned deletion');
});

test('legacy DELETE rejects tables with active orders, reservations, or waiter calls without changing state', async (t) => {
  const activeFixtures = [
    {
      name: 'active dine-in order',
      orders: [{ id: 11, branchId: 7, tableNo: '1', fulfillment: 'dine_in', status: 'preparing' }],
    },
    {
      name: 'active reservation',
      reservations: [{ id: 12, branchId: 7, tableNo: '1', status: 'confirmed', date: '2099-01-01' }],
    },
    {
      name: 'open waiter call',
      waiterCalls: [{ id: 13, branchId: 7, tableNo: '1', status: 'open' }],
    },
  ];

  for (const fixture of activeFixtures) {
    await t.test(fixture.name, async () => {
      const db = {
        tables: [{ id: 1, branchId: 7, label: 'میز ۱' }],
        floorLayoutRevisions: { 7: 2 },
        ...fixture,
      };
      const route = mountLegacyDeleteRoute(db);
      const before = JSON.stringify(db);
      const response = responseRecorder();
      await route.handlers.at(-1)({ params: { id: '1' } }, response);

      assert.equal(response.statusCode, 428);
      assert.equal(response.body.error, 'floor_layout_revision_required');
      assert.equal(JSON.stringify(db), before, 'active operational records and the table must remain untouched');
      assert.equal(route.getSaveCalls(), 0);
    });
  }
});

test('legacy DELETE also refuses an idle table instead of bypassing the layout revision guard', async () => {
  const db = { tables: [{ id: 1, branchId: 7, label: 'میز آزاد' }], floorLayoutRevisions: { 7: 2 } };
  const route = mountLegacyDeleteRoute(db);
  const before = JSON.stringify(db);
  const response = responseRecorder();
  await route.handlers.at(-1)({ params: { id: '1' } }, response);

  assert.equal(response.statusCode, 428);
  assert.equal(response.body.error, 'floor_layout_revision_required');
  assert.equal(JSON.stringify(db), before, 'even idle tables must use the versioned deletion guard');
  assert.equal(route.getSaveCalls(), 0);
});
