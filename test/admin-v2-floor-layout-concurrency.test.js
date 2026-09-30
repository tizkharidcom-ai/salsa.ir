'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registerAdminV2Routes } = require('../server/admin-v2');
const adminV2Source = fs.readFileSync(path.join(__dirname, '..', 'server', 'admin-v2.js'), 'utf8');

function mountFloorRoutes(db, {
  save = async () => true, branchId = 7, audit = null, appendAudit = null,
} = {}) {
  const routes = new Map();
  const app = {
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers.at(-1)); },
    put(path, ...handlers) { routes.set(`PUT ${path}`, handlers.at(-1)); },
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers.at(-1)); },
    patch() {}, delete() {},
  };

  registerAdminV2Routes({
    app,
    getDb: () => db,
    save,
    requireCapability: () => (_req, _res, next) => next?.(),
    requireAdmin: (_req, _res, next) => next?.(),
    parseBranchId: () => branchId,
    normalizeDigits: (value) => String(value),
    phoneRe: /^\d+$/,
    recordAudit: audit || ((_req, action, entityType, entityId, payload, targetBranch, options) => (
      options?.deferAppend ? { id: `audit-${action}-${entityId}`, action, entityType, entityId, payload, branchId: targetBranch } : null
    )),
    appendAudit: appendAudit || (() => {}),
  });
  return routes;
}

async function invoke(handler, req) {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler(req, res);
  return res;
}

test('floor layout rejects a stale device revision without overwriting the latest layout', async () => {
  const db = {
    tables: [{ id: 1, branchId: 7, label: 'میز ۱', x: 10, y: 10 }],
    floorZones: [],
    floorFixtures: [],
    floors: [],
    floorSettingsList: [],
  };
  const routes = mountFloorRoutes(db);
  const getFloor = routes.get('GET /api/admin/v2/floor');
  const saveLayout = routes.get('PUT /api/admin/v2/floor/layout');

  const deviceA = await invoke(getFloor, {});
  const deviceB = await invoke(getFloor, {});
  assert.ok(Number.isSafeInteger(deviceA.body.layoutRevision), 'GET floor must expose a durable layout revision');
  assert.equal(deviceB.body.layoutRevision, deviceA.body.layoutRevision);

  const latest = await invoke(saveLayout, {
    body: {
      expectedLayoutRevision: deviceA.body.layoutRevision,
      tables: [{ id: 1, x: 20, y: 20 }],
    },
  });
  assert.equal(latest.statusCode, 200);
  assert.ok(latest.body.layoutRevision > deviceA.body.layoutRevision);

  const stale = await invoke(saveLayout, {
    body: {
      expectedLayoutRevision: deviceB.body.layoutRevision,
      tables: [{ id: 1, x: 80, y: 80 }],
    },
  });
  assert.equal(stale.statusCode, 409, 'a stale device must receive a conflict');
  assert.equal(stale.body.error, 'floor_layout_revision_conflict');
  assert.equal(stale.body.layoutRevision, latest.body.layoutRevision, 'the client receives the revision it must reload');
  assert.equal(db.tables[0].x, 20, 'the rejected stale snapshot must not replace the current layout');
});

test('floor layout requires an explicit revision before mutating branch state', async () => {
  const db = {
    tables: [{ id: 1, branchId: 7, label: 'میز ۱', x: 10, y: 10 }],
    floorZones: [], floorFixtures: [], floors: [], floorSettingsList: [],
  };
  const routes = mountFloorRoutes(db);
  const response = await invoke(routes.get('PUT /api/admin/v2/floor/layout'), {
    body: { tables: [{ id: 1, x: 90, y: 90 }] },
  });

  assert.equal(response.statusCode, 428);
  assert.equal(db.tables[0].x, 10);
});

test('floor layout preserves unassigned zones and fixtures without inventing a floor', async () => {
  const db = {
    tables: [], floorZones: [], floorFixtures: [], floors: [], floorSettingsList: [],
  };
  const routes = mountFloorRoutes(db);
  const response = await invoke(routes.get('PUT /api/admin/v2/floor/layout'), {
    body: {
      expectedLayoutRevision: 0,
      tables: [],
      zones: [
        { id: 'zone-unassigned', name: 'فضای ثبت‌نشده' },
        { id: 'zone-ground', name: 'طبقهٔ همکف', floorId: 'floor-ground' },
      ],
      fixtures: [
        { id: 'fixture-unassigned', name: 'المان ثبت‌نشده' },
        { id: 'fixture-ground', name: 'ورودی همکف', floorId: 'floor-ground' },
      ],
      floors: [],
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(Object.hasOwn(db.floorZones[0], 'floorId'), false);
  assert.equal(db.floorZones[1].floorId, 'floor-ground');
  assert.equal(Object.hasOwn(db.floorFixtures[0], 'floorId'), false);
  assert.equal(db.floorFixtures[1].floorId, 'floor-ground');
  assert.deepEqual(db.floors, [], 'saving unassigned geometry must not create a floor');
});

test('floor layout writes require tables.manage rather than waiter service/view capabilities', () => {
  assert.match(
    adminV2Source,
    /app\.put\('\/api\/admin\/v2\/floor\/layout',\s*requireCapability\('tables\.manage'\)/,
  );
});

test('failed durable persistence restores every changed row and leaves revision unchanged', async () => {
  const db = {
    tables: [{ id: 1, branchId: 7, label: 'میز ۱', x: 10, y: 10 }],
    floorZones: [{ id: 'zone-1', branchId: 7, name: 'قدیم' }],
    floorFixtures: [], floors: [], floorSettingsList: [],
  };
  const routes = mountFloorRoutes(db, { save: async () => false });
  const response = await invoke(routes.get('PUT /api/admin/v2/floor/layout'), {
    body: {
      expectedLayoutRevision: 0,
      tables: [{ id: 1, x: 90, y: 90 }],
      zones: [{ id: 'zone-2', name: 'جدید' }],
    },
  });

  assert.equal(response.statusCode, 503);
  assert.equal(db.tables[0].x, 10);
  assert.deepEqual(db.floorZones.map((zone) => zone.id), ['zone-1']);
  assert.equal(db.floorLayoutRevisions['7'], undefined);
});

test('concurrent saves from the same base revision serialize and only one is accepted', async () => {
  const db = {
    tables: [{ id: 1, branchId: 7, label: 'میز ۱', x: 10, y: 10 }],
    floorZones: [], floorFixtures: [], floors: [], floorSettingsList: [],
  };
  let releaseSave;
  let saveStarted;
  const started = new Promise((resolve) => { saveStarted = resolve; });
  const blocked = new Promise((resolve) => { releaseSave = resolve; });
  let saveCount = 0;
  const routes = mountFloorRoutes(db, { save: async () => {
    saveCount += 1;
    if (saveCount === 1) { saveStarted(); await blocked; }
    return true;
  } });
  const saveLayout = routes.get('PUT /api/admin/v2/floor/layout');
  const firstPromise = invoke(saveLayout, {
    body: { expectedLayoutRevision: 0, tables: [{ id: 1, x: 20, y: 20 }] },
  });
  await started;
  const secondPromise = invoke(saveLayout, {
    body: { expectedLayoutRevision: 0, tables: [{ id: 1, x: 80, y: 80 }] },
  });
  releaseSave();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 409);
  assert.equal(db.tables[0].x, 20);
  assert.equal(db.floorLayoutRevisions['7'], 1);
  assert.equal(saveCount, 1);
});

test('saving one branch cannot overwrite a matching table id in another branch', async () => {
  const db = {
    tables: [
      { id: 1, branchId: 7, label: 'میز شعبهٔ هفت', x: 10, y: 10 },
      { id: 1, branchId: 8, label: 'میز شعبهٔ هشت', x: 70, y: 70 },
    ],
    floorZones: [], floorFixtures: [], floors: [], floorSettingsList: [],
  };
  const branchSevenRoutes = mountFloorRoutes(db, { branchId: 7 });
  const getFloor = branchSevenRoutes.get('GET /api/admin/v2/floor');
  const saveLayout = branchSevenRoutes.get('PUT /api/admin/v2/floor/layout');
  const snapshot = await invoke(getFloor, {});
  const response = await invoke(saveLayout, {
    body: {
      expectedLayoutRevision: snapshot.body.layoutRevision,
      tables: [{ id: 1, label: 'میز به‌روزشده', x: 25, y: 35 }],
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(db.tables.map(({ branchId, x, y }) => ({ branchId, x, y })), [
    { branchId: 7, x: 25, y: 35 },
    { branchId: 8, x: 70, y: 70 },
  ]);
  assert.equal(response.body.floor.tables.find((table) => table.branchId === 7)?.x, 25);
  assert.equal(response.body.floor.tables.some((table) => table.branchId === 8), false);
});

test('floor layout rejects a table id owned only by another branch instead of cloning it', async () => {
  const db = {
    tables: [{ id: 42, branchId: 8, label: 'میز شعبهٔ هشت', x: 70, y: 70 }],
    floorZones: [], floorFixtures: [], floors: [], floorSettingsList: [],
  };
  const routes = mountFloorRoutes(db, { branchId: 7 });
  const snapshot = await invoke(routes.get('GET /api/admin/v2/floor'), {});
  const response = await invoke(routes.get('PUT /api/admin/v2/floor/layout'), {
    body: {
      expectedLayoutRevision: snapshot.body.layoutRevision,
      tables: [{ id: 42, label: 'میز بازسازی‌شده', x: 20, y: 30 }],
    },
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.error, 'floor_layout_table_branch_conflict');
  assert.deepEqual(db.tables, [{ id: 42, branchId: 8, label: 'میز شعبهٔ هشت', x: 70, y: 70 }]);
  assert.equal(db.floorLayoutRevisions?.['7'], undefined);
});

test('floor layout refuses physical changes to tables with live service, an open call, or an active reservation', async (t) => {
  const scenarios = [
    {
      name: 'active dine-in order',
      db: { orders: [{ id: 19, branchId: 7, tableNo: '1', fulfillment: 'dine_in', status: 'preparing', paymentStatus: 'paid' }] },
      reason: 'table_in_active_use',
    },
    {
      name: 'open waiter call',
      db: { waiterCalls: [{ id: 20, branchId: 7, tableNo: 'میز ۱', status: 'open' }] },
      reason: 'open_waiter_call',
    },
    {
      name: 'future confirmed reservation',
      db: { reservations: [{ id: 21, branchId: 7, tableNo: '1', status: 'confirmed', date: new Date(Date.now() + 86400000).toISOString().slice(0, 10) }] },
      reason: 'table_reserved',
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const db = {
        branches: [{ id: 7 }],
        tables: [{ id: 1, branchId: 7, label: 'میز ۱', x: 10, y: 10, seats: 4 }],
        orders: [], reservations: [], waiterCalls: [], floorZones: [], floorFixtures: [], floors: [], floorSettingsList: [],
        ...scenario.db,
      };
      const routes = mountFloorRoutes(db);
      const response = await invoke(routes.get('PUT /api/admin/v2/floor/layout'), {
        body: { expectedLayoutRevision: 0, tables: [{ id: 1, x: 30, y: 40, seats: 6 }] },
      });

      assert.equal(response.statusCode, 409);
      assert.equal(response.body.error, 'floor_layout_table_in_use');
      assert.deepEqual(response.body.tables, [{ id: '1', reason: scenario.reason }]);
      assert.deepEqual(db.tables, [{ id: 1, branchId: 7, label: 'میز ۱', x: 10, y: 10, seats: 4 }]);
      assert.equal(db.floorLayoutRevisions?.['7'], undefined);
    });
  }
});

test('floor layout occupancy guard ignores other branches and permits a non-layout metadata change', async () => {
  const db = {
    branches: [{ id: 7 }, { id: 8 }],
    tables: [{ id: 1, branchId: 7, label: 'میز ۱', x: 10, y: 10, seats: 4 }],
    orders: [{ id: 19, branchId: 8, tableNo: '1', fulfillment: 'dine_in', status: 'preparing', paymentStatus: 'paid' }],
    reservations: [], waiterCalls: [], floorZones: [], floorFixtures: [], floors: [], floorSettingsList: [],
  };
  const routes = mountFloorRoutes(db);
  const response = await invoke(routes.get('PUT /api/admin/v2/floor/layout'), {
    body: { expectedLayoutRevision: 0, tables: [{ id: 1, x: 25, y: 35, tableScaleX: 1.4, tableScaleY: 0.85, tags: ['window'] }] },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(db.tables[0].tags, ['window']);
  assert.equal(db.tables[0].x, 25);
  assert.equal(db.tables[0].tableScaleX, 1.4);
  assert.equal(db.tables[0].tableScaleY, 0.85);
});

test('single and bulk floor-table deletion are durable, audited, and versioned', async () => {
  const db = {
    branches: [{ id: 7 }],
    tables: [
      { id: 1, branchId: 7, label: 'میز ۱' },
      { id: 2, branchId: 7, label: 'میز ۲' },
    ],
    orders: [], reservations: [], waiterCalls: [], floorZones: [], floorFixtures: [], floors: [], floorSettingsList: [],
  };
  const appendedAudits = [];
  const saveCalls = [];
  const routes = mountFloorRoutes(db, {
    save: async (options) => { saveCalls.push(options); return true; },
    appendAudit: (entry) => appendedAudits.push(entry),
  });
  const response = await invoke(routes.get('POST /api/admin/v2/floor/tables/delete'), {
    body: { expectedLayoutRevision: 0, tableIds: [1, 2], branchId: 7 },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.deletedIds, ['1', '2']);
  assert.deepEqual(response.body.alreadyAbsentIds, []);
  assert.deepEqual(response.body.rejected, []);
  assert.equal(response.body.floor.layoutRevision, 1);
  assert.deepEqual(db.tables, []);
  assert.equal(saveCalls.length, 1);
  assert.deepEqual(saveCalls[0], { requireDurable: true });
  assert.equal(appendedAudits.length, 2);
});

test('floor-table deletion cannot remove a matching id from another branch', async () => {
  const db = {
    branches: [{ id: 7 }],
    tables: [{ id: 1, branchId: 8, label: 'میز شعبهٔ دیگر' }],
    orders: [], reservations: [], waiterCalls: [], floorZones: [], floorFixtures: [], floors: [], floorSettingsList: [],
  };
  const routes = mountFloorRoutes(db, { branchId: 7 });
  const response = await invoke(routes.get('POST /api/admin/v2/floor/tables/delete'), {
    body: { expectedLayoutRevision: 0, tableIds: [1] },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.deletedIds, []);
  assert.deepEqual(response.body.rejected, [{ id: '1', reason: 'table_not_found' }]);
  assert.deepEqual(db.tables, [{ id: 1, branchId: 8, label: 'میز شعبهٔ دیگر' }]);
  assert.equal(db.floorLayoutRevisions?.['7'], undefined);
});

test('floor-table deletion rejects a stale layout revision without mutation', async () => {
  const db = {
    branches: [{ id: 7 }], floorLayoutRevisions: { 7: 4 },
    tables: [{ id: 1, branchId: 7, label: 'میز ۱' }],
    orders: [], reservations: [], waiterCalls: [], floorZones: [], floorFixtures: [], floors: [], floorSettingsList: [],
  };
  const routes = mountFloorRoutes(db);
  const response = await invoke(routes.get('POST /api/admin/v2/floor/tables/delete'), {
    body: { expectedLayoutRevision: 3, tableIds: [1] },
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.error, 'floor_layout_revision_conflict');
  assert.deepEqual(db.tables.map(({ id }) => id), [1]);
  assert.equal(db.floorLayoutRevisions['7'], 4);
});

test('floor-table deletion refuses tables with active dine-in orders or seated reservations', async (t) => {
  const scenarios = [
    {
      name: 'active order',
      db: { orders: [{ id: 99, branchId: 7, tableNo: '1', fulfillment: 'dine_in', status: 'preparing', paymentStatus: 'paid' }], reservations: [] },
      reason: 'table_in_active_use',
    },
    {
      name: 'seated reservation',
      db: { orders: [], reservations: [{ id: 88, branchId: 7, tableNo: '1', status: 'seated', date: new Date().toISOString().slice(0, 10) }] },
      reason: 'table_reserved',
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const db = {
        branches: [{ id: 7 }], tables: [{ id: 1, branchId: 7, label: 'میز ۱' }],
        waiterCalls: [], floorZones: [], floorFixtures: [], floors: [], floorSettingsList: [], ...scenario.db,
      };
      const routes = mountFloorRoutes(db);
      const response = await invoke(routes.get('POST /api/admin/v2/floor/tables/delete'), {
        body: { expectedLayoutRevision: 0, tableIds: [1] },
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.body.rejected, [{ id: '1', reason: scenario.reason }]);
      assert.equal(db.tables.length, 1);
      assert.equal(db.floorLayoutRevisions?.['7'], undefined);
    });
  }
});

test('floor-table deletion refuses only matching open waiter calls and stays branch-scoped', async (t) => {
  const scenarios = [
    {
      name: 'matching Persian-number table call blocks deletion',
      waiterCalls: [{ id: 41, branchId: 7, status: 'open', tableNo: 'میز ۱' }],
      expectedStatus: 200,
      expectedDeleted: [],
      expectedRejected: [{ id: '1', reason: 'open_waiter_call' }],
    },
    {
      name: 'table 10 call does not block table 1 deletion',
      waiterCalls: [{ id: 42, branchId: 7, status: 'new', tableNo: 'میز ۱۰' }],
      expectedStatus: 200,
      expectedDeleted: ['1'],
      expectedRejected: [],
    },
    {
      name: 'another branch call does not block this branch table',
      waiterCalls: [{ id: 43, branchId: 8, status: 'open', tableNo: '1' }],
      expectedStatus: 200,
      expectedDeleted: ['1'],
      expectedRejected: [],
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const db = {
        branches: [{ id: 7 }, { id: 8 }],
        tables: [{ id: 1, branchId: 7, label: 'میز ۱' }],
        orders: [], reservations: [], waiterCalls: scenario.waiterCalls,
        floorZones: [], floorFixtures: [], floors: [], floorSettingsList: [],
      };
      const routes = mountFloorRoutes(db, { branchId: 7 });
      const response = await invoke(routes.get('POST /api/admin/v2/floor/tables/delete'), {
        body: { expectedLayoutRevision: 0, tableIds: [1] },
      });

      assert.equal(response.statusCode, scenario.expectedStatus);
      assert.deepEqual(response.body.deletedIds, scenario.expectedDeleted);
      assert.deepEqual(response.body.rejected, scenario.expectedRejected);
      assert.equal(db.tables.some((table) => table.branchId === 7), scenario.expectedDeleted.length === 0);
      assert.ok(scenario.waiterCalls.every((call) => db.waiterCalls.includes(call)), 'deletion never mutates waiter-call records');
    });
  }
});

test('failed durable floor-table deletion restores rows and does not append its audit record', async () => {
  const db = {
    branches: [{ id: 7 }],
    tables: [{ id: 1, branchId: 7, label: 'میز ۱' }],
    orders: [], reservations: [], waiterCalls: [], floorZones: [], floorFixtures: [], floors: [], floorSettingsList: [],
  };
  const appendedAudits = [];
  const routes = mountFloorRoutes(db, { save: async () => false, appendAudit: (entry) => appendedAudits.push(entry) });
  const response = await invoke(routes.get('POST /api/admin/v2/floor/tables/delete'), {
    body: { expectedLayoutRevision: 0, tableIds: [1] },
  });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(db.tables, [{ id: 1, branchId: 7, label: 'میز ۱' }]);
  assert.equal(db.floorLayoutRevisions?.['7'], undefined);
  assert.deepEqual(appendedAudits, []);
});
