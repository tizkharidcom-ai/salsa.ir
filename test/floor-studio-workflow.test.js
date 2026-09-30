'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const floorStudioSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin', 'floor-studio.js'), 'utf8');
const floorPlanCss = fs.readFileSync(path.join(__dirname, '..', 'css', 'waiter-floor-plan.css'), 'utf8');
const { __test: floorStudioTest } = require('../js/admin/floor-studio');

test('focused floor map ignores unpositioned tables and keeps pan finite', () => {
  const zone = { x: 60, y: 10, w: 30, h: 50 };
  const pan = floorStudioTest.calculateZoneFocusPan(zone, [
    { x: 70, y: 25 }, { x: undefined, y: undefined }, { x: '', y: '' }, { x: NaN, y: 40 },
  ], 600, 500, 1);
  assert.deepEqual(pan, { x: -150, y: 75 });
  assert.deepEqual(floorStudioTest.calculateZoneFocusPan(null, [{ x: undefined, y: undefined }], 600, 500), { x: 0, y: 0 });
});

test('table membership and drawn section geometry stay distinct', () => {
  const zone = { x: 25, y: 10, w: 30, h: 70 };
  assert.equal(floorStudioTest.isTableInsideZone({ x: 40, y: 50 }, zone), true);
  assert.equal(floorStudioTest.isTableInsideZone({ x: 15, y: 50 }, zone), false);
  assert.equal(floorStudioTest.isTableInsideZone({ x: undefined, y: 50 }, zone), false);
});

test('section sync follows the table center, stays on its floor, and leaves out-of-zone tables untouched', () => {
  const normalize = (name) => String(name || '').trim();
  const zones = [
    { id: 'ground-main', name: 'سالن', x: 0, y: 0, w: 50, h: 100, floorId: 'ground' },
    { id: 'ground-terrace', name: 'تراس', x: 50, y: 0, w: 50, h: 100, floorId: 'ground' },
    { id: 'upper-main', name: 'بالا', x: 0, y: 0, w: 100, h: 100, floorId: 'upper' },
  ];
  const tables = [
    { id: 1, x: 20, y: 30, zone: 'تراس', floorId: 'ground' },
    { id: 2, x: 70, y: 20, zone: 'تراس', floorId: 'ground' },
    { id: 3, x: 101, y: 10, zone: 'تراس', floorId: 'ground' },
    { id: 4, x: 20, y: 30, zone: 'تراس', floorId: 'upper' },
    { id: 5, x: 20, y: 40, zone: 'سالن', floorId: 'ground', _floorStudioUnassignedZone: true },
  ];

  const changes = floorStudioTest.planFloorZoneMembershipSync(tables, zones, 'ground', normalize);
  assert.deepEqual(changes, [
    { tableId: 1, fromZone: 'تراس', toZone: 'سالن' },
    { tableId: 5, fromZone: 'سالن', toZone: 'سالن' },
  ]);
  assert.equal(floorStudioTest.applyFloorZoneMembershipSync(tables, changes, normalize), 2);
  assert.equal(tables[0].zone, 'سالن');
  assert.equal(tables[1].zone, 'تراس');
  assert.equal(tables[2].zone, 'تراس');
  assert.equal(tables[3].zone, 'تراس');
  assert.equal(tables[4]._floorStudioUnassignedZone, undefined);
});

test('dragging a table resynchronizes its section, and the existing-map repair is reviewable and undoable', () => {
  const dragStart = floorStudioSource.indexOf('const handleTableDrag =');
  const dragEnd = floorStudioSource.indexOf('// ─── Fixture Drag', dragStart);
  const dragFlow = floorStudioSource.slice(dragStart, dragEnd);
  assert.match(dragFlow, /planFloorZoneMembershipSync\(droppedTables, floorZones, activeFloorId, normalizeZone\)/);
  assert.match(dragFlow, /applyFloorZoneMembershipSync\(droppedTables, zoneChanges, normalizeZone\)/);
  assert.match(floorStudioSource, /id="map-sync-table-zones"/);
  assert.match(floorStudioSource, /پیش از اصلاح، نسخهٔ فعلی در تاریخچه ثبت می‌شود/);
  assert.match(floorStudioSource, /جای میز و صندلی‌ها تغییر نمی‌کند/);
});

test('floor studio keeps supported 21–24 seat capacities when preparing saved tables', () => {
  assert.equal(floorStudioTest.normalizeSeatCapacity(21), 21);
  assert.equal(floorStudioTest.normalizeSeatCapacity(24), 24);
});

test('floor studio seat capacity normalization stays within the supported range', () => {
  assert.equal(floorStudioTest.normalizeSeatCapacity(25), 24);
  assert.equal(floorStudioTest.normalizeSeatCapacity(0), 4);
  assert.equal(floorStudioTest.normalizeSeatCapacity(0, 1), 1);
  assert.equal(floorStudioTest.normalizeSeatCapacity(2.6), 3);
});

test('floor level parsing preserves a valid zero and negative level', () => {
  const parse = floorStudioTest.parseFloorLevel;
  assert.equal(parse('0', 3), 0);
  assert.equal(parse('-2', 3), -2);
  assert.equal(parse('', 3), 3);
  assert.equal(parse('1.5', 3), 3);
  assert.match(floorStudioSource, /const level = parseFloorLevel\(form\.querySelector\('#fm-floor-level'\)\?\.value, nextLevel\)/);
  assert.match(floorStudioSource, /level: parseFloorLevel\(form\.querySelector\('#fm-floor-edit-level'\)\?\.value/);
});

test('floor deletion confirmation describes the actual reassignment destination', () => {
  const start = floorStudioSource.indexOf('const deleteFloor = la.deleteFloor');
  const end = floorStudioSource.indexOf('const promptMoveTableFloor', start);
  assert.ok(start >= 0 && end > start);
  const deleteFlow = floorStudioSource.slice(start, end);
  assert.match(deleteFlow, /floorLevels\.find\(\(fl\) => fl\.id !== floorId\)/);
  assert.match(deleteFlow, /به اولین طبقهٔ باقی‌مانده منتقل خواهند شد/);
  assert.doesNotMatch(deleteFlow, /به طبقه همکف منتقل خواهند شد/);
});

test('layout history restores independent snapshots and supports undo/redo', () => {
  let state = { tables: [{ id: 1, x: 10 }] };
  const history = floorStudioTest.createLayoutHistory(() => state, (snapshot) => { state = snapshot; });

  history.recordBefore();
  state.tables[0].x = 20;
  assert.equal(history.undo(), true);
  assert.deepEqual(state, { tables: [{ id: 1, x: 10 }] });

  state.tables[0].x = 99;
  assert.equal(history.redo(), true);
  assert.deepEqual(state, { tables: [{ id: 1, x: 20 }] });
  assert.equal(history.undoCount, 1);
  assert.equal(history.redoCount, 0);
});

test('clearing history after an explicit server refresh removes stale undo and redo snapshots', () => {
  let state = { x: 1 };
  const history = floorStudioTest.createLayoutHistory(() => state, (snapshot) => { state = snapshot; });
  history.recordBefore();
  state = { x: 2 };
  history.undo();
  assert.equal(history.redoCount, 1);
  history.clear();
  assert.equal(history.undo(), false);
  assert.equal(history.redo(), false);
  assert.equal(history.undoCount, 0);
  assert.equal(history.redoCount, 0);
});

test('a new layout edit clears redo history and history is bounded', () => {
  let state = { x: 0 };
  const history = floorStudioTest.createLayoutHistory(() => state, (snapshot) => { state = snapshot; }, 2);

  for (const x of [1, 2, 3]) {
    history.recordBefore();
    state = { x };
  }
  assert.equal(history.undoCount, 2);
  assert.equal(history.undo(), true);
  assert.deepEqual(state, { x: 2 });
  assert.equal(history.undo(), true);
  assert.deepEqual(state, { x: 1 });
  assert.equal(history.undo(), false);

  history.recordBefore();
  state = { x: 4 };
  assert.equal(history.redoCount, 0);
  assert.equal(history.redo(), false);
});

test('drag history records only the first actual movement in a gesture', () => {
  let checkpoints = 0;
  let dirtySignals = 0;
  const checkpoint = floorStudioTest.createHistoryCheckpoint(() => { checkpoints += 1; }, () => { dirtySignals += 1; });

  assert.equal(checkpoint(false), false);
  assert.equal(checkpoint(true), true);
  assert.equal(checkpoint(true), false);
  assert.equal(checkpoints, 1);
  assert.equal(dirtySignals, 1, 'the first real pointer movement invalidates an in-flight save immediately');
});

test('floor studio pins every request to the branch selected when the studio was created', () => {
  const selectedBranch = { id: 7 };
  const context = floorStudioTest.createFloorBranchContext(selectedBranch.id);
  selectedBranch.id = 12;

  assert.equal(context.id, 7);
  assert.equal(context.query(), '?branchId=7');
  assert.equal(context.query('mode=full'), '?mode=full&branchId=7');
  assert.match(floorStudioSource, /const floorBranch = createFloorBranchContext\(getCurrentBranchId\(\)\)/);
  assert.match(floorStudioSource, /const branchQuery = \(\) => floorBranch\.query\(\)/);
  assert.match(floorStudioSource, /branchId: currentBranchId\(\)/);
  assert.match(floorStudioSource, /const isCurrentStudio = \(\) => isMounted[\s\S]*?String\(floorBranch\.id/);
  assert.match(floorStudioSource, /if \(!isCurrentStudio\(\)\) return;/);
  assert.doesNotMatch(floorStudioSource, /branchQs\(\)/);
});

test('layout revision distinguishes the snapshot being saved from newer edits', () => {
  const revision = floorStudioTest.createLayoutRevision();
  revision.markDirty();
  const saveSnapshot = revision.snapshot();

  assert.equal(revision.isCurrent(saveSnapshot), true);
  revision.markDirty();
  assert.equal(revision.isCurrent(saveSnapshot), false);
  assert.equal(revision.isCurrent(revision.snapshot()), true);
});

test('floor-plan backups cannot be restored into a different branch', () => {
  const compatible = floorStudioTest.isLayoutImportBranchCompatible;
  assert.equal(compatible(7, 7), true);
  assert.equal(compatible('7', 7), true);
  assert.equal(compatible(undefined, 7), true);
  assert.equal(compatible(8, 7), false);
  assert.equal(compatible(8, undefined), false);

  assert.match(floorStudioSource, /isLayoutImportBranchCompatible\(parsed\.branchId, currentBranchId\(\)\)/);
  assert.match(floorStudioSource, /parsed\.tables\.map\(\(table, index\) => \{/);
  assert.match(floorStudioSource, /const saved = await saveFloorLayout\(true\);\s*if \(!saved\) return false;/);
});

test('layout saves serialize requests and coalesce queued snapshots to the latest request', async () => {
  const runner = floorStudioTest.createSerializedSaveRunner();
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let releaseFirst;
  const firstSaveGate = new Promise((resolve) => { releaseFirst = resolve; });

  const first = runner.run(async () => {
    calls.push('first');
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await firstSaveGate;
    inFlight -= 1;
    return true;
  });
  await Promise.resolve();
  const superseded = runner.run(async () => { calls.push('superseded'); return true; });
  const latest = runner.run(async () => {
    calls.push('latest');
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    inFlight -= 1;
    return true;
  });

  assert.equal(first, superseded);
  assert.equal(first, latest);
  releaseFirst();
  assert.equal(await first, true);
  assert.deepEqual(calls, ['first', 'latest']);
  assert.equal(maxInFlight, 1);
  assert.equal(runner.isRunning, false);
});

test('floor saves send the server revision and keep a successful revision for queued local edits', () => {
  assert.match(floorStudioSource, /expectedLayoutRevision:\s*floorData\.layoutRevision/);
  assert.match(floorStudioSource, /const responseLayoutRevision = res\?\.floor\?\.layoutRevision \?\? res\?\.layoutRevision/);
  assert.match(floorStudioSource, /floorData = \{ \.\.\.\(floorData \|\| \{\}\), layoutRevision: responseLayoutRevision \}/);
  assert.match(floorStudioSource, /نسخهٔ چیدمان دریافت نشده است؛ صفحه را تازه کنید/);
});

test('zone dragging snaps to the grid and clamps within the canvas', () => {
  assert.deepEqual(
    floorStudioTest.calculateZoneDragPosition({ x: 10.1, y: 20.2, w: 25, h: 30 }, 2.2, -2.2, 0.5),
    { x: 12.5, y: 18 },
  );
  assert.deepEqual(
    floorStudioTest.calculateZoneDragPosition({ x: 90, y: 95, w: 20, h: 10 }, 100, 100, 1),
    { x: 80, y: 90 },
  );
  assert.deepEqual(
    floorStudioTest.calculateZoneDragPosition({ x: 0, y: 0, w: 20, h: 20 }, -30, -50, 1),
    { x: 0, y: 0 },
  );
});

test('mobile seat and table-size steppers report no-op boundaries without creating edits', () => {
  const adjust = floorStudioTest.calculateMobileTableAdjustment;
  assert.deepEqual(adjust({ seats: 23 }, 'inc-seats'), { key: 'seats', value: 24, changed: true });
  assert.deepEqual(adjust({ seats: 24 }, 'inc-seats'), { key: 'seats', value: 24, changed: false });
  assert.deepEqual(adjust({ seats: 1 }, 'dec-seats'), { key: 'seats', value: 1, changed: false });
  assert.deepEqual(adjust({ scale: 2.9 }, 'inc-scale'), { key: 'scale', value: 3, changed: true });
  assert.deepEqual(adjust({ scale: 3 }, 'inc-scale'), { key: 'scale', value: 3, changed: false });
  assert.deepEqual(adjust({ scale: 0.5 }, 'dec-scale'), { key: 'scale', value: 0.5, changed: false });
  assert.deepEqual(adjust({ scale: 1, scaleX: 1 }, 'inc-width'), { key: 'scaleX', value: 1.1, changed: true });
  assert.deepEqual(adjust({ scale: 1, scaleY: 1 }, 'dec-length'), { key: 'scaleY', value: 0.9, changed: true });
  assert.deepEqual(adjust({ rotation: 315 }, 'rotate'), { key: 'rotation', value: 0, changed: true });
  assert.equal(adjust({ seats: 4 }, 'unknown').changed, false);
});

test('negative and multi-turn rotations normalize to a stable 0–359 degree range', () => {
  const normalize = floorStudioTest.normalizeFloorRotation;
  assert.equal(normalize(-90), 270);
  assert.equal(normalize(-405), 315);
  assert.equal(normalize(360), 0);
  assert.equal(normalize(765), 45);
  assert.equal(normalize(Number.NaN), 0);

  const rotateMobileTable = floorStudioTest.calculateMobileTableAdjustment({ rotation: -90 }, 'rotate');
  assert.deepEqual(rotateMobileTable, { key: 'rotation', value: 315, changed: true });
  assert.match(floorStudioSource, /table\.rotation = normalizeFloorRotation\(table\.rotation\)/);
  assert.match(floorStudioSource, /rotation: normalizeFloorRotation\(t\.rotation\)/);
  assert.match(floorStudioSource, /rotation: normalizeFloorRotation\(f\.rotation\)/);
  assert.doesNotMatch(floorStudioSource, /\(Number\((?:t|f)\.rotation\) \|\| 0\) % 360/);
});

test('floor filtering scopes records and keeps records without a persisted floor explicitly unassigned', () => {
  const entities = [
    { id: 1, floorId: 'ground', zone: 'سالن' },
    { id: 2, floorId: 'upper', zone: 'سالن' },
    { id: 3, zone: 'تراس' },
  ];
  assert.equal(floorStudioTest.floorEntityId(entities[2]), '__unassigned__');
  assert.deepEqual(floorStudioTest.entitiesForFloor(entities, 'upper').map(({ id }) => id), [2]);
  assert.deepEqual(floorStudioTest.entitiesForFloor(entities, '__unassigned__').map(({ id }) => id), [3]);
  assert.equal(floorStudioTest.zonesShareLayoutSpace({ floorId: 'ground' }, { floorId: 'upper' }), false);
  assert.equal(floorStudioTest.zonesShareLayoutSpace({}, { floorId: 'ground' }), false);
});

test('moving a table offers only destination-floor sections and safely falls back when names differ', () => {
  const normalize = (name) => String(name || '').trim().replace('سالن اصلی', 'سالن');
  const zones = [
    { id: 'g-main', name: 'سالن اصلی', floorId: 'ground' },
    { id: 'u-patio', name: 'تراس', floorId: 'upper' },
  ];
  const tables = [
    { id: 1, floorId: 'ground', zone: 'سالن' },
    { id: 2, floorId: 'upper', zone: 'تراس' },
  ];
  const targetOptions = floorStudioTest.floorZoneOptionsForMove(zones, tables, 'upper', normalize);
  assert.deepEqual(targetOptions, ['بدون بخش', 'تراس']);
  assert.equal(floorStudioTest.preferredFloorZone(targetOptions, 'سالن', normalize), 'بدون بخش');
  assert.equal(floorStudioTest.preferredFloorZone(targetOptions, 'تراس', normalize), 'تراس');

  const moveFlow = floorStudioSource.slice(
    floorStudioSource.indexOf('const promptMoveTableFloor ='),
    floorStudioSource.indexOf('const promptAddFixture =', floorStudioSource.indexOf('const promptMoveTableFloor =')),
  );
  assert.match(moveFlow, /id="fm-target-zone"/);
  assert.match(moveFlow, /floorZoneOptionsForMove\(floorZones, tables, floorSelect\.value, normalizeZone\)/);
  assert.match(moveFlow, /markTableZoneAssigned\(table, targetZone, normalizeZone\)/);
  assert.match(moveFlow, /\['busy', 'reserved', 'attention'\]/);
});

test('furniture and chair choices are keyboard-operable buttons with announced selection state', () => {
  assert.match(floorStudioSource, /<button type="button" class="furniture-shape-card[\s\S]*?aria-pressed="\$\{curShape === s\.id\}"/);
  assert.match(floorStudioSource, /<button type="button" class="furniture-chair-pill[\s\S]*?aria-pressed="\$\{curChair === c\.id\}"/);
  assert.match(floorStudioSource, /data-seat-preset="\$\{cnt\}" aria-pressed=/);
  assert.match(floorStudioSource, /setAttribute\('aria-pressed', String\(selected\)\)/);
  assert.match(floorStudioSource, /aria-label="ظرفیت صندلی میز"/);
  assert.match(floorPlanCss, /\.furniture-shape-card:focus-visible,[\s\S]*?\.furniture-chair-pill:focus-visible,[\s\S]*?outline:\s*3px solid/);
});

test('automatic table grouping never includes tables from another floor', () => {
  const tables = [
    { id: 1, floorId: 'ground', zone: 'سالن' },
    { id: 2, floorId: 'upper', zone: 'سالن' },
    { id: 3, floorId: 'upper', zone: 'تراس' },
  ];
  const groups = floorStudioTest.groupTablesByZoneForFloor(tables, 'upper');
  assert.deepEqual(groups.get('سالن').map(({ id }) => id), [2]);
  assert.deepEqual(groups.get('تراس').map(({ id }) => id), [3]);
  assert.equal(groups.has('ground'), false);
});

test('table merge rejects cross-floor or already-linked tables without changing any relationship', () => {
  const tables = [
    { id: 1, floorId: 'ground', mergedWith: null, mergedInto: null },
    { id: 2, floorId: 'upper', mergedWith: null, mergedInto: null },
    { id: 3, floorId: 'ground', mergedWith: [4], mergedInto: null },
    { id: 4, floorId: 'ground', mergedWith: null, mergedInto: 3 },
    { id: 5, floorId: 'ground', mergedWith: null, mergedInto: null },
  ];
  const before = structuredClone(tables);

  assert.deepEqual(floorStudioTest.planTableMerge(tables, [1, 2], 'ground'), {
    ok: false, reason: 'different_floor',
  });
  assert.deepEqual(floorStudioTest.planTableMerge(tables, [3, 5], 'ground'), {
    ok: false, reason: 'already_merged',
  });
  assert.deepEqual(floorStudioTest.planTableMerge(tables, [1, 99], 'ground'), {
    ok: false, reason: 'missing_table',
  });
  assert.equal(floorStudioTest.applyTableMergePlan(tables, { ok: false, memberIds: [1, 5] }), false);
  assert.deepEqual(tables, before, 'invalid merges must not partially mutate the table graph');
});

test('valid table merge has a deterministic parent and creates reciprocal links', () => {
  const tables = [
    { id: 9, floorId: 'ground' },
    { id: 3, floorId: 'ground' },
    { id: 5, floorId: 'ground' },
  ];
  const plan = floorStudioTest.planTableMerge(tables, new Set([5, 9, 3]), 'ground');

  assert.deepEqual(plan, { ok: true, reason: null, memberIds: [9, 3, 5] });
  assert.equal(floorStudioTest.applyTableMergePlan(tables, plan), true);
  assert.deepEqual(tables.map(({ id, mergedWith, mergedInto }) => ({ id, mergedWith, mergedInto })), [
    { id: 9, mergedWith: [3, 5], mergedInto: null },
    { id: 3, mergedWith: null, mergedInto: 9 },
    { id: 5, mergedWith: null, mergedInto: 9 },
  ]);
});

test('zone rename and delete affect only tables and geometry on the zone floor', () => {
  const zones = [
    { id: 'ground-patio', name: 'حیاط', floorId: 'ground' },
    { id: 'upper-patio', name: 'حیاط', floorId: 'upper' },
    { id: 'ground-main', name: 'سالن', floorId: 'ground' },
  ];
  const tables = [
    { id: 1, zone: 'حیاط', floorId: 'ground' },
    { id: 2, zone: 'حیاط', floorId: 'upper' },
  ];
  const normalize = (name) => String(name || '').trim();
  assert.equal(floorStudioTest.isFloorZoneNameTaken(zones, 'حیاط', 'ground', normalize, 'ground-patio'), false);
  assert.equal(floorStudioTest.isFloorZoneNameTaken(zones, 'حیاط', 'ground', normalize), true);
  floorStudioTest.renameZoneAndTablesOnFloor(zones, tables, 'ground-patio', 'حیاط جلو', normalize);
  assert.equal(zones[0].name, 'حیاط جلو');
  assert.deepEqual(tables.map(({ zone }) => zone), ['حیاط جلو', 'حیاط']);

  const removed = floorStudioTest.removeZoneAndReassignTablesOnFloor(zones, tables, 'ground-patio', 'سالن', normalize);
  assert.deepEqual(removed.zones.map(({ id }) => id), ['upper-patio', 'ground-main']);
  assert.deepEqual(tables.map(({ zone }) => zone), ['سالن', 'حیاط']);
});

test('empty server collections stay empty and existing floor records are passed through unchanged', () => {
  const realZone = { id: 'zone-live', name: 'حیاط واقعی', floorId: 'ground' };
  const realFixture = { id: 'fixture-live', name: 'ورودی ثبت‌شده', floorId: 'ground' };
  assert.deepEqual(floorStudioTest.floorCollection({ zones: [], fixtures: [] }, 'zones'), []);
  assert.deepEqual(floorStudioTest.floorCollection({ zones: [], fixtures: [] }, 'fixtures'), []);
  assert.deepEqual(floorStudioTest.floorCollection({ zones: [realZone], fixtures: [realFixture] }, 'zones'), [realZone]);
  assert.deepEqual(floorStudioTest.floorCollection({ zones: [realZone], fixtures: [realFixture] }, 'fixtures'), [realFixture]);
  assert.deepEqual(floorStudioTest.floorCollection({}, 'fixtures'), []);
  assert.doesNotMatch(floorStudioSource, /DEFAULT_FLOOR_ZONES|DEFAULT_FLOOR_FIXTURES/);
  assert.match(floorStudioSource, /floorCollection\(floorData, 'fixtures'\)\.map/);
  assert.match(floorStudioSource, /floorCollection\(floorData, 'zones'\)\.map/);
  assert.match(floorStudioSource, /floor-studio-empty-state/);
  assert.doesNotMatch(floorStudioSource, /plan-fixture--entrance" title="ورودی اصلی رستوران/);
});

test('missing table coordinates remain provisional until the operator places the real table', () => {
  const suggest = floorStudioTest.suggestedTablePosition;
  const saveCoordinates = floorStudioTest.tableCoordinatesForSave;
  const markPositioned = floorStudioTest.markTablePositioned;
  const existing = { id: 804, label: 'میز ثبت‌شده', x: 37.5, y: 61, zone: 'بخش واقعی' };
  assert.deepEqual(saveCoordinates(existing), { x: 37.5, y: 61 });
  assert.deepEqual(saveCoordinates({ id: 806, x: 0, y: 0 }), { x: 0, y: 0 });

  const provisional = { id: 805, label: 'میز ثبت‌شدهٔ بدون مختصات', ...suggest(5), _floorStudioSuggestedPosition: true };
  assert.deepEqual(saveCoordinates(provisional), {});
  assert.deepEqual(suggest(5), { x: 38, y: 28 });
  markPositioned(provisional);
  assert.equal(provisional._floorStudioSuggestedPosition, undefined);
  assert.deepEqual(saveCoordinates(provisional), { x: 38, y: 28 });

  assert.match(floorStudioSource, /if \(!hasX \|\| !hasY\)[\s\S]*?table\._floorStudioSuggestedPosition = true/);
  assert.match(floorStudioSource, /جانمایی پیشنهادی، ذخیره‌نشده/);
  assert.match(floorStudioSource, /مختصات ثبت‌شده ندارند؛ جایگاه نشان‌داده‌شده موقت است و تا جانمایی اپراتور ذخیره نمی‌شود/);
  assert.doesNotMatch(floorStudioSource, /DEFAULT_TABLE_COORDINATES/);
});

test('an empty floor does not invent sections and unassigned real tables stay explicitly unassigned', () => {
  const normalize = (zone) => {
    const value = String(zone || '').trim();
    if (!value) return '';
    return /^(?:terrace|outdoor)$/i.test(value) ? 'تراس' : value;
  };
  assert.equal(floorStudioTest.normalizeTableZoneValue('', normalize), 'بدون بخش');
  assert.equal(floorStudioTest.normalizeTableZoneValue('حیاط ثبت‌شده', normalize), 'حیاط ثبت‌شده');
  assert.equal(floorStudioTest.normalizeTableZoneValue('terrace', normalize), 'تراس');
  const unassigned = { zone: 'بدون بخش', _floorStudioUnassignedZone: true };
  assert.deepEqual(floorStudioTest.tableZoneForSave(unassigned, normalize), {});
  floorStudioTest.markTableZoneAssigned(unassigned, 'حیاط ثبت‌شده', normalize);
  assert.equal(unassigned._floorStudioUnassignedZone, undefined);
  assert.deepEqual(floorStudioTest.tableZoneForSave(unassigned, normalize), { zone: 'حیاط ثبت‌شده' });
  assert.doesNotMatch(floorStudioSource, /const standardZones = \['سالن', 'تراس', 'ویژه'\]/);
  assert.doesNotMatch(floorStudioSource, /id="map-templates-btn"|map-templates-btn.*showTemplateModal/);
  assert.match(floorStudioSource, /currentFloorZones\.map\(\(zone\) => normalizeZone\(zone\.name\)\)/);
  assert.match(floorStudioSource, /\.\.\.tableZoneForSave\(t, normalizeZone\)/);
  assert.match(floorStudioSource, /'بدون بخش'/);
});

test('unconfigured branches stay empty; starter templates require an explicit choice on a real empty floor', () => {
  const {
    UNASSIGNED_FLOOR_ID, floorExists, hasUnassignedFloorEntities,
    floorIdForPersistence, isFloorLayoutEmpty, FLOOR_LAYOUT_TEMPLATES, materializeFloorTemplate,
  } = floorStudioTest;
  const empty = { tables: [], zones: [], fixtures: [] };
  assert.equal(floorExists([], UNASSIGNED_FLOOR_ID), false);
  assert.equal(hasUnassignedFloorEntities([], [], []), false);
  assert.deepEqual(floorIdForPersistence({ floorId: UNASSIGNED_FLOOR_ID }), {});
  assert.equal(isFloorLayoutEmpty(empty), true);
  assert.equal(isFloorLayoutEmpty({ ...empty, tables: [{ id: 81 }] }), false);
  assert.equal(materializeFloorTemplate(FLOOR_LAYOUT_TEMPLATES[0], UNASSIGNED_FLOOR_ID), null);

  const starter = materializeFloorTemplate(FLOOR_LAYOUT_TEMPLATES[1], 'floor-real-1', 'test-starter');
  assert.equal(starter.zones.length, 2);
  assert.ok(starter.zones.every((zone) => zone.floorId === 'floor-real-1'));
  assert.deepEqual(starter.fixtures, []);
  assert.doesNotMatch(floorStudioSource, /tables\s*=\s*tpl\.tables/);
  assert.match(floorStudioSource, /input type="radio" name="floor-layout-template"[^>]*required/);
  assert.match(floorStudioSource, /map-use-starter-template/);
  const mountStart = floorStudioSource.indexOf('const mount = async');
  const mountEnd = floorStudioSource.indexOf('  return { mount, unmount };', mountStart);
  assert.ok(mountStart >= 0 && mountEnd > mountStart, 'mount function has an explicit end marker');
  const mountSource = floorStudioSource.slice(mountStart, mountEnd);
  assert.doesNotMatch(mountSource, /materializeFloorTemplate|FLOOR_LAYOUT_TEMPLATES/);
});

test('empty sections from the server clear local section state after save', () => {
  assert.match(floorStudioSource, /if \(Array\.isArray\(res\.floor\.zones\)\) \{[\s\S]*?floorZones = res\.floor\.zones\.map/);
  assert.doesNotMatch(floorStudioSource, /Array\.isArray\(res\.floor\.zones\) && res\.floor\.zones\.length > 0/);
});

test('floor table deletion requires a complete revisioned server response and partitions all requested ids', () => {
  const validate = floorStudioTest.validateFloorTableDeleteResponse;
  const floor = { layoutRevision: 5, tables: [{ id: 3 }] };
  assert.deepEqual(validate({
    ok: true, floor, deletedIds: ['1'], alreadyAbsentIds: [], rejected: [{ id: '2', reason: 'table_reserved' }],
  }, [1, 2]), {
    ok: true, floor, deletedIds: ['1'], alreadyAbsentIds: [], rejected: [{ id: '2', reason: 'table_reserved' }],
  });
  assert.equal(validate({ ok: true, floor, deletedIds: ['1'], alreadyAbsentIds: [], rejected: [] }, [1, 2]).ok, false);
  assert.equal(validate({ ok: true, floor: { tables: [] }, deletedIds: [], alreadyAbsentIds: ['1'], rejected: [] }, [1]).ok, false);
  assert.match(floorStudioSource, /api\/admin\/v2\/floor\/tables\/delete\$\{branchQuery\(\)\}/);
  assert.match(floorStudioSource, /expectedLayoutRevision:\s*floorData\.layoutRevision/);
  assert.match(floorStudioSource, /deleteFloorTables\(\[tableId\]\)/);
  assert.match(floorStudioSource, /deleteFloorTables\(idsToDelete\)/);
  assert.match(floorStudioSource, /result\.rejected\.forEach\(\(\{ id \}\) => selectedTableIds\.add/);
  assert.match(floorStudioSource, /floorData = result\.floor;/);
  assert.doesNotMatch(floorStudioSource, /api\(`\/api\/admin\/tables\/\$\{tableId\}.*method: 'DELETE'/);
});

test('revision conflicts are visible, block blind retries, and offer backup before explicit refresh', () => {
  const conflict = floorStudioTest.isFloorLayoutRevisionConflict;
  assert.equal(conflict(new Error('floor_layout_revision_conflict')), true);
  assert.equal(conflict(new Error('نقشه در دستگاه دیگری تغییر کرده است')), true);
  assert.equal(conflict(new Error('timeout')), false);
  assert.match(floorStudioSource, /if \(hasLayoutRevisionConflict\) \{[\s\S]*?return Promise\.resolve\(false\);/);
  assert.match(floorStudioSource, /data-floor-conflict-action="export"/);
  assert.match(floorStudioSource, /data-floor-conflict-action="reload"/);
  assert.match(floorStudioSource, /تغییرات ذخیره‌نشدهٔ همین دستگاه را کنار می‌گذارد/);
  assert.match(floorStudioSource, /layoutHistory\.clear\(\);/);
});

test('waiter-call success is distinct from a failed or incomplete floor refresh', () => {
  const { isUsableFloorDataSnapshot, floorRefreshNotice } = floorStudioTest;
  assert.equal(isUsableFloorDataSnapshot({ layoutRevision: 4, tables: [] }), true);
  assert.equal(isUsableFloorDataSnapshot({ layoutRevision: -1, tables: [] }), false);
  assert.equal(isUsableFloorDataSnapshot({ layoutRevision: 4, tables: null }), false);
  assert.deepEqual(floorRefreshNotice(true), {
    message: 'رسیدگی به فراخوان ثبت شد و وضعیت میز به‌روز شد.', type: 'success',
  });
  assert.deepEqual(floorRefreshNotice(false), {
    message: 'رسیدگی ثبت شد، اما وضعیت میز تازه نشد؛ اتصال را بررسی و نقشه را دوباره بارگیری کنید.', type: 'info',
  });

  const resolveAction = floorStudioSource.slice(
    floorStudioSource.indexOf("document.getElementById('floor-inspector-resolve')"),
    floorStudioSource.indexOf('// ── Mobile table editor', floorStudioSource.indexOf("document.getElementById('floor-inspector-resolve')")),
  );
  assert.match(resolveAction, /await api\(`\/api\/waiter\/calls\/\$\{callId\}`[\s\S]*?const refreshed = await loadFloorData\(\);[\s\S]*?floorRefreshNotice\(refreshed\)/);
  assert.doesNotMatch(resolveAction, /catch \{\}/);
  assert.doesNotMatch(resolveAction, /showToast\('رسیدگی به فراخوان ثبت شد/);
});

test('waiter-call lookup matches exact table identity and Persian/Arabic digits only', () => {
  const { isWaiterCallForTable } = floorStudioTest;
  const table = { id: 1, label: 'میز ۱' };

  assert.equal(isWaiterCallForTable({ tableNo: '1' }, table), true);
  assert.equal(isWaiterCallForTable({ tableNo: 'میز ۱' }, table), true);
  assert.equal(isWaiterCallForTable({ tableNo: 'میز ١' }, table), true);
  assert.equal(isWaiterCallForTable({ tableNo: 'VIP 1' }, { id: 8, label: 'VIP 1' }), true);
  assert.equal(isWaiterCallForTable({ tableNo: '10' }, table), false);
  assert.equal(isWaiterCallForTable({ tableNo: 'میز ۱۰' }, table), false);
  assert.equal(isWaiterCallForTable({ tableNo: 'VIP 10' }, { id: 1, label: 'VIP 1' }), false);
  assert.equal(isWaiterCallForTable({ tableNo: null }, table), false);
  assert.equal(isWaiterCallForTable({ tableNo: 'VIP' }, { id: 1, label: 'VIP' }, [
    { id: 1, label: 'VIP' }, { id: 2, label: 'VIP' },
  ]), false, 'duplicate table labels are ambiguous and must not close a call');
  assert.match(floorStudioSource, /isWaiterCallForTable\(c, inspTable, tables\)/);
});

test('locked floor view disables every layout-writing control and skips a clean save', () => {
  const openingTag = (id) => {
    const marker = floorStudioSource.indexOf(`id="${id}"`);
    assert.notEqual(marker, -1, `control exists: ${id}`);
    const start = floorStudioSource.lastIndexOf('<button', marker);
    const end = floorStudioSource.indexOf('>', marker);
    assert.ok(start >= 0 && end > marker, `button opening tag exists: ${id}`);
    return floorStudioSource.slice(start, end + 1);
  };

  for (const id of [
    'map-add-floor',
  ]) {
    assert.match(openingTag(id), /\$\{isEditMode \? '' : 'disabled'\}/, `${id} is available for setup only in edit mode`);
  }
  for (const id of ['map-floor-settings', 'map-import-json', 'map-add-table', 'map-add-fixture', 'map-draw-zone', 'map-auto-align', 'map-add-zone']) {
    assert.match(openingTag(id), /\$\{canEditCurrentFloor \? '' : 'disabled'\}/, `${id} requires an actual configured floor`);
  }
  assert.match(openingTag('map-save-layout'), /\$\{isEditMode && isLayoutDirty \? '' : 'disabled'\}/);
  assert.match(floorStudioSource, /if \(!isEditMode \|\| !requireConfiguredFloor\('تراز خودکار میزها'\)\) return;\s*autoAlignTables\(\);/);
  assert.match(floorStudioSource, /if \(!isEditMode\) return;\s*promptFloorSettings\(\);/);
  assert.match(floorStudioSource, /if \(!isLayoutDirty\) \{\s*showToast\('حالت نمایش فعال شد؛ تغییری برای ذخیره نبود\.'/);
  assert.match(floorStudioSource, /layoutSaveRunner\.run\(\(\) => persistFloorLayout\(silent\)\)/);
  assert.match(floorStudioSource, /layoutRevision\.isCurrent\(saveRevision\) && res\?\.floor/);
  assert.match(floorStudioSource, /saveButton\.disabled = !isEditMode \|\| saving \|\| !isLayoutDirty/);
});

test('layout tables expose keyboard activation and the mobile edit canvas remains pannable', () => {
  assert.match(floorStudioSource, /role="button" tabindex="0"/);
  assert.match(floorStudioSource, /canvas\.addEventListener\('keydown', \(e\) => \{\s*const tableEl = e\.target\.closest\('\.plan-table\[role="button"\]\[tabindex="0"\]'\)/);
  assert.match(floorStudioSource, /if \(!e\.repeat\) tableEl\.click\(\)/);

  const editCanvas = floorPlanCss.match(/body\.admin-app \.admin-floor-page \.architectural-canvas-wrap\.is-edit-mode\s*\{([^}]*)\}/);
  assert.ok(editCanvas, 'mobile edit canvas has a dedicated touch rule');
  assert.match(editCanvas[1], /touch-action:\s*pan-x pan-y\s*!important/);
  assert.match(floorPlanCss, /body\.admin-app \.admin-floor-page\.is-edit-mode \.plan-table,[\s\S]*?touch-action:\s*none/);
  assert.match(floorPlanCss, /\.floor-table\.waiter-table-card:focus-visible\s*\{/);
  assert.match(floorPlanCss, /\.floor-table\.waiter-table-card\[data-state="reserved"\]/);
});

test('mobile layout keeps undo, redo, and grid snapping reachable without a selected table', () => {
  const historyToolbar = floorPlanCss.lastIndexOf('body.admin-app .admin-floor-page .floor-history-buttons {');
  assert.ok(historyToolbar >= 0, 'mobile history actions have a dedicated responsive rule');
  assert.match(floorPlanCss.slice(historyToolbar, historyToolbar + 320), /display:\s*grid\s*!important/);
  assert.match(floorPlanCss.slice(historyToolbar, historyToolbar + 900), /min-height:\s*44px/);
  assert.match(floorPlanCss, /body\.admin-app \.admin-floor-page \.floor-toolbar__group--precision\s*\{[^}]*display:\s*flex\s*!important/s);
  assert.match(floorStudioSource, /id="map-history-undo"[^>]*aria-label="بازگشت تغییر قبلی"/);
  assert.match(floorStudioSource, /id="map-history-redo"[^>]*aria-label="بازانجام تغییر"/);
  assert.doesNotMatch(floorPlanCss, /\.floor-history-buttons\s*\{[^}]*display:\s*none\s*!important/s);
});

test('operational floor refresh changes live status but preserves local geometry and layout revision', () => {
  const local = [{
    id: 1, x: 22, y: 34, zone: 'تراس', floorId: 'ground', shape: 'circle', seats: 4,
    state: 'available', serviceOrderId: null, waiterCallId: null,
  }];
  const refreshed = floorStudioTest.mergeFloorOperationalState(local, [{
    id: 1, x: 88, y: 91, zone: 'سالن', floorId: 'upper', shape: 'booth', seats: 8,
    state: 'busy', stateLabel: 'در حال سرویس', serviceOrderId: 501, waiterCallId: null,
  }]);

  assert.deepEqual(refreshed[0], {
    ...local[0], state: 'busy', stateLabel: 'در حال سرویس', serviceOrderId: 501,
  });
  assert.notEqual(refreshed, local, 'refresh returns a new table collection');
  const loader = floorStudioSource.slice(
    floorStudioSource.indexOf('  const loadFloorData = async () => {'),
    floorStudioSource.indexOf('  const reloadLatestLayoutAfterConflict', floorStudioSource.indexOf('  const loadFloorData = async () => {')),
  );
  assert.match(loader, /mergeFloorOperationalState\(tables, fresh\.tables\)/);
  assert.match(loader, /if \(fresh\.layoutRevision !== floorData\?\.layoutRevision\)[\s\S]*?hasLayoutRevisionConflict = true/);
  assert.match(floorStudioSource, /وضعیت میز به‌روز شد، اما نسخهٔ نقشه هم‌زمان تغییر کرده است؛ چیدمان محلی حفظ شد و ذخیره تا بررسی تعارض متوقف است/);
  assert.doesNotMatch(loader, /floorData\s*=\s*fresh|table\.(?:x|y|zone|floorId|shape)\s*=/);
});

test('undo and redo restore layout geometry without rolling back live table service state', () => {
  const historical = [{ id: 44, x: 12, y: 20, state: 'available', stateLabel: 'آزاد', serviceOrderId: null }];
  const current = [{ id: 44, x: 50, y: 60, state: 'busy', stateLabel: 'در حال سرویس', serviceOrderId: 'ord-live' }];
  const restored = floorStudioTest.mergeFloorOperationalState(historical, current);

  assert.equal(restored[0].x, 12, 'undo restores the prior saved geometry');
  assert.equal(restored[0].state, 'busy');
  assert.equal(restored[0].stateLabel, 'در حال سرویس');
  assert.equal(restored[0].serviceOrderId, 'ord-live');
  assert.match(floorStudioSource, /\(snapshot\) => \{\s*tables = mergeFloorOperationalState\(snapshot\.tables, tables\)/);
});

test('conflict reload rejects incomplete layout snapshots before replacing local state', () => {
  const complete = {
    layoutRevision: 4, tables: [], zones: [], fixtures: [], floors: [], settings: {},
  };
  assert.equal(floorStudioTest.isCompleteFloorLayoutSnapshot(complete), true);
  assert.equal(floorStudioTest.isCompleteFloorLayoutSnapshot({ ...complete, zones: undefined }), false);
  assert.equal(floorStudioTest.isCompleteFloorLayoutSnapshot({ ...complete, layoutRevision: -1 }), false);
  const reload = floorStudioSource.slice(
    floorStudioSource.indexOf('  const reloadLatestLayoutAfterConflict'),
    floorStudioSource.indexOf('  // ─── Modal سیستم', floorStudioSource.indexOf('  const reloadLatestLayoutAfterConflict')),
  );
  assert.match(reload, /if \(!isCompleteFloorLayoutSnapshot\(fresh\)\)[\s\S]*?floorData = fresh/);
});

test('new sections use an actually free slot and never shrink or overlap existing sections', () => {
  const occupied = [{ id: 'whole-floor', x: 0, y: 0, w: 100, h: 100 }];
  const snapshot = structuredClone(occupied);
  assert.equal(floorStudioTest.findFloorZonePlacement(occupied, 40, 30), null);
  assert.deepEqual(occupied, snapshot);

  const placement = floorStudioTest.findFloorZonePlacement([{ x: 2, y: 2, w: 40, h: 30 }], 20, 20);
  assert.ok(placement);
  assert.ok(placement.x >= 2 && placement.y >= 2);
  assert.ok(placement.x + placement.w <= 98 && placement.y + placement.h <= 98);
  assert.ok(placement.x >= 42 || placement.y >= 32, 'new placement does not overlap the existing section');
  assert.deepEqual(
    floorStudioTest.findFloorZonePlacement([{ x: 0, y: 0, w: 78, h: 96 }], 20, 96),
    { x: 78, y: 2, w: 20, h: 96 },
    'the exact far-edge slot is considered even when it is not aligned to the scan step',
  );
  assert.match(floorStudioSource, /const freeSlot = findFloorZonePlacement\(currentFloorZones, calcW, calcH\);[\s\S]*?if \(!freeSlot\)[\s\S]*?return false;/);
  assert.doesNotMatch(floorStudioSource, /largest\.w = halfW|largest\.h = halfH/);
});
