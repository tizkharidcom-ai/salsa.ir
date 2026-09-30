'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('../server/admin-v2');
const { __test: floorStudioTest } = require('../js/admin/floor-studio');

test('floor reservations occupy a table only while their same-day status is active', () => {
  const today = __test.localDateKey();
  const model = __test.floor({
    tables: [1, 2, 3].map((id) => ({ id, label: `میز ${id}`, branchId: 1, active: true, seats: 2 })),
    reservations: [
      { id: 1, branchId: 1, date: today, status: 'confirmed', tableNo: '1' },
      { id: 2, branchId: 1, date: today, status: 'completed', tableNo: '2' },
      { id: 3, branchId: 1, date: today, status: 'cancelled', tableNo: '3' },
    ],
  }, 1);

  assert.deepEqual(model.tables.map(({ state }) => state), ['reserved', 'available', 'available']);
  assert.equal(model.summary.reservations, 1);
});

test('floor map keeps a reservation assigned during its active service window', () => {
  const now = new Date(2026, 0, 15, 10, 0, 0);
  const today = __test.localDateKey(now);
  const model = __test.floor({
    tables: [{ id: 1, label: 'میز ۱', branchId: 1, active: true, seats: 2 }],
    reservationSettings: { slotMinutes: 30 },
    reservations: [{
      id: 1, branchId: 1, date: today, time: '09:45', endTime: '10:15',
      status: 'confirmed', tableNo: '1',
    }],
  }, 1, now);

  assert.equal(model.tables[0].state, 'reserved');
  assert.equal(model.summary.reservations, 1);
});

test('floor map releases a same-day reservation after its service window ends', () => {
  const now = new Date(2026, 0, 15, 10, 0, 0);
  const today = __test.localDateKey(now);
  const model = __test.floor({
    tables: [{ id: 1, label: 'میز ۱', branchId: 1, active: true, seats: 2 }],
    reservationSettings: { slotMinutes: 30 },
    reservations: [{
      id: 1, branchId: 1, date: today, time: '09:00', endTime: '09:30',
      status: 'confirmed', tableNo: '1',
    }],
  }, 1, now);

  assert.equal(model.tables[0].state, 'available');
  assert.equal(model.summary.reservations, 0);
});

test('floor reservations stay scoped to the selected branch, date, and reserving statuses', () => {
  const today = __test.localDateKey();
  const nextLocalDay = new Date();
  nextLocalDay.setDate(nextLocalDay.getDate() + 1);
  const tomorrow = __test.localDateKey(nextLocalDay);
  const model = __test.floor({
    tables: [1, 2, 3, 4, 5].map((id) => ({ id, label: `میز ${id}`, branchId: 1, active: true, seats: 2 })),
    reservations: [
      { id: 1, branchId: 1, date: today, status: 'confirmed', tableNo: '1' },
      { id: 2, branchId: 1, date: today, status: 'completed', tableNo: '2' },
      { id: 3, branchId: 1, date: tomorrow, status: 'confirmed', tableNo: '3' },
      { id: 4, branchId: 2, date: today, status: 'confirmed', tableNo: '4' },
      { id: 5, branchId: 1, date: today, status: 'pending', tableNo: '5' },
    ],
  }, 1);

  assert.deepEqual(model.tables.map(({ state }) => state), [
    'reserved', 'available', 'available', 'available', 'reserved',
  ]);
  assert.equal(model.summary.reservations, 2);
});

test('empty floor response contains neutral settings and no invented floors, zones, fixtures, or tables', () => {
  const model = __test.floor({
    tables: [], floorZones: [], floorFixtures: [], floors: [], floorSettingsList: [], reservations: [], orders: [],
  }, 7);

  assert.deepEqual(model.tables, []);
  assert.deepEqual(model.zones, []);
  assert.deepEqual(model.fixtures, []);
  assert.deepEqual(model.floors, []);
  assert.deepEqual(model.settings, {
    widthM: 20, lengthM: 25, gridStep: 0.5, bgTheme: 'blueprint',
    wallThickness: 0.4, showRulers: true, showGrid: true, branchId: 7,
  });
});

test('floor layout undo and redo preserve table, seat, zone, floor, fixture, and scale settings', () => {
  const state = {
    tables: [{ id: 5, x: 25, y: 40, seats: 4, chairScale: 1, zone: 'تراس', floorId: 'ground' }],
    zones: [{ id: 'zone-terrace', x: 50, y: 10, w: 35, h: 60 }],
    fixtures: [{ id: 'fix-bar', x: 12, y: 8, w: 20, h: 6 }],
    floors: [{ id: 'ground', name: 'همکف', level: 0 }],
    settings: { lengthM: 20, widthM: 15, showGrid: true },
    activeFloorId: 'ground',
    activeZone: 'all',
  };
  const restore = (snapshot) => Object.assign(state, snapshot);
  const history = floorStudioTest.createLayoutHistory(() => state, restore);
  const original = structuredClone(state);

  history.recordBefore();
  state.tables[0].x = 31;
  state.tables[0].seats = 6;
  state.tables[0].zone = 'سالن';
  state.zones[0].w = 42;
  state.fixtures[0].x = 18;
  state.settings.showGrid = false;
  state.floors.push({ id: 'roof', name: 'روف‌گاردن', level: 1 });
  state.activeFloorId = 'roof';
  state.activeZone = 'سالن';
  const edited = structuredClone(state);

  assert.equal(history.undo(), true);
  assert.deepEqual(state, original);
  assert.equal(history.redo(), true);
  assert.deepEqual(state, edited);
  assert.equal(history.undoCount, 1);
  assert.equal(history.redoCount, 0);
});

test('gesture history checkpoints ignore no-op motion and capture only before the first real change', () => {
  let snapshots = 0;
  const checkpoint = floorStudioTest.createHistoryCheckpoint(() => { snapshots += 1; });

  assert.equal(checkpoint(false), false);
  assert.equal(checkpoint(false), false);
  assert.equal(snapshots, 0);
  assert.equal(checkpoint(true), true);
  assert.equal(checkpoint(true), false);
  assert.equal(snapshots, 1);
});

test('zone drag snaps to the selected grid and clamps the zone inside the floor', () => {
  assert.deepEqual(
    floorStudioTest.calculateZoneDragPosition({ x: 11, y: 14, w: 25, h: 20 }, 6, 4, 5),
    { x: 15, y: 20 },
  );
  assert.deepEqual(
    floorStudioTest.calculateZoneDragPosition({ x: 80, y: 90, w: 25, h: 20 }, 30, 30, 5),
    { x: 75, y: 80 },
  );
});
