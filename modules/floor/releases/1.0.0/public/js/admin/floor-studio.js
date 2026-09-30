/**
 * js/admin/floor-studio.js
 *
 * استودیوی نقشه و چیدمان سالن وستو — ریفکتورشده
 *
 * تغییرات کلیدی نسبت به نسخه قبل در admin.js:
 *  1. Event Delegation — یک listener روی canvas به جای هزاران listener جداگانه
 *  2. AbortController — cleanup کامل همه event ها هنگام unmount
 *  3. Partial DOM Update — drag/zoom/rotate بدون full re-render
 *  4. حذف window.__floorTimerInterval و window.__floorKeydownBound (memory leak)
 *  5. createDragHandler عمومی — حذف کد تکراری برای table/fixture/zone drag
 *  6. setUnsavedStatus / updateUndoButtonUi مستقیم بدون render
 */

'use strict';

const cloneLayoutSnapshot = (state) => JSON.parse(JSON.stringify(state));

const normalizeSeatCapacity = (value, fallback = 4) =>
  Math.max(1, Math.min(24, Math.round(Number(value) || fallback)));

// Older sessions may remember the unfinished cards view. Never let that
// preference turn the tables workspace into an empty page.
const resolveFloorViewMode = (requested, cardsAvailable = false) =>
  requested === 'cards' && cardsAvailable ? 'cards' : 'map';

const normalizeFloorRotation = (value) => {
  const angle = Number(value);
  if (!Number.isFinite(angle)) return 0;
  return ((Math.round(angle) % 360) + 360) % 360;
};

const isActiveFloorPointerEvent = (event, pointerId) => event?.pointerId == null
  || pointerId == null
  || Number(event.pointerId) === Number(pointerId);
const isCancelledFloorPointerEvent = (event) => event?.type === 'pointercancel';

const suggestedTablePosition = (index) => ({
  x: 14 + ((Math.max(0, Number(index) || 0) % 4) * 24),
  y: Math.min(90, 12 + (Math.floor(Math.max(0, Number(index) || 0) / 4) * 16)),
});

const tableCoordinatesForSave = (table) => {
  if (table?._floorStudioSuggestedPosition) return {};
  const normalizedCoordinate = (value) => Number.isFinite(Number(value))
    ? Math.max(0, Math.min(100, Math.round(Number(value) * 10) / 10))
    : 50;
  return {
    x: normalizedCoordinate(table?.x),
    y: normalizedCoordinate(table?.y),
  };
};

const markTablePositioned = (table) => {
  if (!table) return table;
  delete table._floorStudioSuggestedPosition;
  return table;
};

const normalizeTableZoneValue = (zone, normalizeZone) => {
  const value = String(zone ?? '').trim();
  return value ? normalizeZone(value) : 'بدون بخش';
};

const isTableInsideZone = (table, zone) => {
  if (!zone) return false;
  const x = Number(table?.x); const y = Number(table?.y);
  const left = Number(zone.x); const top = Number(zone.y);
  const width = Number(zone.w); const height = Number(zone.h);
  return [x, y, left, top, width, height].every(Number.isFinite)
    && x >= left && x <= left + width && y >= top && y <= top + height;
};

const calculateZoneFocusPan = (zone, zoneTables, stageWidth, stageHeight, zoom = 1) => {
  const xs = []; const ys = [];
  const addPoint = (x, y) => {
    if (Number.isFinite(x) && x >= 0 && x <= 100) xs.push(x);
    if (Number.isFinite(y) && y >= 0 && y <= 100) ys.push(y);
  };
  if (zone) {
    addPoint(Number(zone.x), Number(zone.y));
    addPoint(Number(zone.x) + Number(zone.w), Number(zone.y) + Number(zone.h));
  }
  (Array.isArray(zoneTables) ? zoneTables : []).forEach((table) => {
    if (table?.x == null || table?.y == null || table.x === '' || table.y === '') return;
    addPoint(Number(table.x), Number(table.y));
  });
  const scale = Number.isFinite(Number(zoom)) && Number(zoom) > 0 ? Number(zoom) : 1;
  const width = Number.isFinite(Number(stageWidth)) ? Number(stageWidth) : 0;
  const height = Number.isFinite(Number(stageHeight)) ? Number(stageHeight) : 0;
  return {
    x: xs.length ? Math.round((50 - (Math.min(...xs) + Math.max(...xs)) / 2) * width * scale / 100) : 0,
    y: ys.length && Math.max(...ys) - Math.min(...ys) < 85
      ? Math.round((50 - (Math.min(...ys) + Math.max(...ys)) / 2) * height * scale / 100) : 0,
  };
};

const tableZoneForSave = (table, normalizeZone) => table?._floorStudioUnassignedZone
  ? {}
  : { zone: normalizeTableZoneValue(table?.zone, normalizeZone) };

const markTableZoneAssigned = (table, zone, normalizeZone) => {
  if (!table) return table;
  table.zone = normalizeTableZoneValue(zone, normalizeZone);
  delete table._floorStudioUnassignedZone;
  return table;
};

const calculateMobileTableAdjustment = (table, action) => {
  if (!table) return { key: null, value: null, changed: false };
  if (action === 'inc-seats' || action === 'dec-seats') {
    const current = normalizeSeatCapacity(table.seats);
    const delta = action === 'inc-seats' ? 1 : -1;
    const value = Math.max(1, Math.min(24, current + delta));
    return { key: 'seats', value, changed: value !== current };
  }
  if (action === 'inc-scale' || action === 'dec-scale') {
    const current = Math.max(0.5, Math.min(3, Math.round((Number(table.scale) || 1) * 10) / 10));
    const delta = action === 'inc-scale' ? 0.1 : -0.1;
    const value = Math.max(0.5, Math.min(3, Math.round((current + delta) * 10) / 10));
    return { key: 'scale', value, changed: value !== current };
  }
  if (['inc-width', 'dec-width', 'inc-length', 'dec-length'].includes(action)) {
    const axis = action.endsWith('width') ? 'scaleX' : 'scaleY';
    const current = Math.max(0.5, Math.min(3, Number(table[axis] ?? table.scale) || 1));
    const delta = action.startsWith('inc-') ? 0.1 : -0.1;
    const value = Math.max(0.5, Math.min(3, Math.round((current + delta) * 10) / 10));
    return { key: axis, value, changed: value !== current };
  }
  if (action === 'rotate') {
    const current = normalizeFloorRotation(table.rotation);
    return { key: 'rotation', value: normalizeFloorRotation(current + 45), changed: true };
  }
  return { key: null, value: null, changed: false };
};

const UNASSIGNED_FLOOR_ID = '__unassigned__';
const floorCollection = (floor, key) => Array.isArray(floor?.[key]) ? floor[key] : [];
const floorEntityId = (entity) => {
  const raw = String(entity?.floorId || '').trim();
  if (raw && raw !== UNASSIGNED_FLOOR_ID && raw !== 'undefined' && raw !== 'null') {
    return raw;
  }
  return UNASSIGNED_FLOOR_ID;
};
const zonesShareLayoutSpace = (left, right) => floorEntityId(left) === floorEntityId(right);
const entitiesForFloor = (items, floorId) => (Array.isArray(items) ? items : [])
  .filter((item) => floorEntityId(item) === String(floorId || UNASSIGNED_FLOOR_ID));
const findFloorZoneAtPosition = (zones, floorId, x, y) => {
  const point = { x: Number(x), y: Number(y) };
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return entitiesForFloor(zones, floorId).find((zone) => isTableInsideZone(point, zone)) || null;
};
const planFloorZoneMembershipSync = (tables, zones, floorId, normalizeZone) =>
  entitiesForFloor(tables, floorId).flatMap((table) => {
    const zone = findFloorZoneAtPosition(zones, floorId, table.x, table.y);
    if (!zone) return [];
    const fromZone = normalizeTableZoneValue(table.zone, normalizeZone);
    const toZone = normalizeTableZoneValue(zone.name, normalizeZone);
    if (fromZone === toZone && !table._floorStudioUnassignedZone) return [];
    return [{ tableId: table.id, fromZone, toZone }];
  });
const applyFloorZoneMembershipSync = (tables, changes, normalizeZone) => {
  if (!Array.isArray(changes) || !changes.length) return 0;
  const zoneByTableId = new Map(changes.map((change) => [String(change.tableId), change.toZone]));
  let updated = 0;
  (Array.isArray(tables) ? tables : []).forEach((table) => {
    const zone = zoneByTableId.get(String(table.id));
    if (zone === undefined) return;
    markTableZoneAssigned(table, zone, normalizeZone);
    updated += 1;
  });
  return updated;
};
const floorExists = (floors, floorId) => (Array.isArray(floors) ? floors : [])
  .some((floor) => String(floor?.id || '') === String(floorId || ''));
const hasUnassignedFloorEntities = (...collections) => collections
  .some((items) => (Array.isArray(items) ? items : []).some((item) => floorEntityId(item) === UNASSIGNED_FLOOR_ID));
const floorIdForPersistence = (entity) => {
  const floorId = String(entity?.floorId || '').trim();
  return floorId && floorId !== UNASSIGNED_FLOOR_ID ? { floorId } : {};
};
const parseFloorLevel = (value, fallback = 0) => {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : fallback;
};
const mergeFloorOperationalState = (tables, floorTables) => {
  const operationalFields = [
    'state', 'stateLabel', 'serviceOrderId', 'serviceStartedAt',
    'serviceEndsAt', 'serviceRemainingSec', 'autoReleased', 'waiterCallId',
  ];
  const latestById = new Map((Array.isArray(floorTables) ? floorTables : [])
    .map((table) => [String(table?.id ?? ''), table]));
  return (Array.isArray(tables) ? tables : []).map((table) => {
    const latest = latestById.get(String(table?.id ?? ''));
    if (!latest) return table;
    const next = { ...table };
    operationalFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(latest, field)) next[field] = latest[field];
    });
    return next;
  });
};
const findFloorZonePlacement = (zones, width, height, step = 3) => {
  const w = Number(width);
  const h = Number(height);
  const increment = Math.max(0.5, Number(step) || 3);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0 || w > 96 || h > 96) return null;
  const occupied = Array.isArray(zones) ? zones : [];
  const positionsThroughEdge = (last) => {
    const positions = [];
    for (let position = 2; position <= last; position += increment) positions.push(position);
    if (!positions.length || positions[positions.length - 1] < last) positions.push(last);
    return positions;
  };
  for (const y of positionsThroughEdge(98 - h)) {
    for (const x of positionsThroughEdge(98 - w)) {
      const overlaps = occupied.some((zone) =>
        Math.max(x, Number(zone.x) || 0) < Math.min(x + w, (Number(zone.x) || 0) + (Number(zone.w) || 0))
        && Math.max(y, Number(zone.y) || 0) < Math.min(y + h, (Number(zone.y) || 0) + (Number(zone.h) || 0)));
      if (!overlaps) return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, w, h };
    }
  }
  return null;
};
const isFloorLayoutEmpty = ({ tables = [], zones = [], fixtures = [] } = {}) =>
  tables.length === 0 && zones.length === 0 && fixtures.length === 0;
const relatedFloorTableIds = (tables, requestedIds) => {
  const rows = Array.isArray(tables) ? tables : [];
  const related = new Set((Array.isArray(requestedIds) ? requestedIds : []).map((id) => String(Number(id))));
  let changed = true;
  while (changed) {
    changed = false;
    rows.forEach((table) => {
      const id = String(Number(table?.id));
      const parentId = table?.mergedInto == null ? '' : String(Number(table.mergedInto));
      const children = Array.isArray(table?.mergedWith) ? table.mergedWith.map((value) => String(Number(value))) : [];
      if (related.has(id) || parentId && related.has(parentId) || children.some((child) => related.has(child))) {
        [id, parentId, ...children].filter(Boolean).forEach((value) => {
          if (!related.has(value)) { related.add(value); changed = true; }
        });
      }
    });
  }
  return related;
};
const activeWaiterCallTableIds = (tables, requestedIds) => {
  const related = relatedFloorTableIds(tables, requestedIds);
  return [...new Set((Array.isArray(tables) ? tables : [])
    .filter((table) => related.has(String(Number(table?.id))) && table?.waiterCallId != null)
    .map((table) => String(Number(table.id))))];
};

const FLOOR_LAYOUT_TEMPLATES = Object.freeze([
  {
    id: 'single-area', title: 'یک فضای ساده', icon: '▱',
    desc: 'یک محدودهٔ خالی و قابل ویرایش؛ میزها از فهرست واقعی شعبه اضافه می‌شوند.',
    zones: [{ name: 'بخش ۱', x: 2, y: 2, w: 96, h: 96, color: 'blue', icon: '▱', shape: 'rectangle', lengthM: 12, widthM: 8 }],
    fixtures: [],
  },
  {
    id: 'two-areas', title: 'دو بخش مجزا', icon: '▤',
    desc: 'دو محدودهٔ پایه با نام‌های قابل تغییر؛ بدون میز یا اطلاعات رستوران نمونه.',
    zones: [
      { name: 'بخش ۱', x: 2, y: 2, w: 58, h: 96, color: 'blue', icon: '▱', shape: 'rectangle', lengthM: 8, widthM: 8 },
      { name: 'بخش ۲', x: 62, y: 2, w: 36, h: 96, color: 'emerald', icon: '▱', shape: 'rectangle', lengthM: 5, widthM: 8 },
    ],
    fixtures: [],
  },
  {
    id: 'counter-area', title: 'فضا با پیشخوان', icon: '▰',
    desc: 'یک بخش و یک پیشخوان قابل جابه‌جایی؛ میزها و ظرفیت از دادهٔ واقعی می‌آیند.',
    zones: [{ name: 'بخش ۱', x: 2, y: 2, w: 96, h: 96, color: 'blue', icon: '▱', shape: 'rectangle', lengthM: 12, widthM: 8 }],
    fixtures: [{ type: 'counter', name: 'پیشخوان', x: 38, y: 7, w: 24, h: 8, rotation: 0, color: 'cyan', icon: '▰' }],
  },
]);

const materializeFloorTemplate = (template, floorId, idPrefix = 'floor-template') => {
  const targetFloorId = String(floorId || '').trim();
  if (!template || !targetFloorId || targetFloorId === UNASSIGNED_FLOOR_ID) return null;
  return {
    zones: floorCollection(template, 'zones').map((zone, index) => ({
      ...zone, id: `${idPrefix}-zone-${index + 1}`, floorId: targetFloorId,
    })),
    fixtures: floorCollection(template, 'fixtures').map((fixture, index) => ({
      ...fixture, id: `${idPrefix}-fixture-${index + 1}`, floorId: targetFloorId,
    })),
  };
};
const validateFloorTableDeleteResponse = (response, requestedIds) => {
  const normalizedRequests = (Array.isArray(requestedIds) ? requestedIds : []).map((id) => {
    const value = Number(id);
    return Number.isSafeInteger(value) && value > 0 ? String(value) : 'invalid';
  });
  const requested = new Set(normalizedRequests);
  if (requested.size === 0 || requested.has('invalid') || requested.size !== normalizedRequests.length) {
    return { ok: false, reason: 'invalid_request' };
  }
  const floor = response?.floor;
  const validRevision = Number.isSafeInteger(floor?.layoutRevision) && floor.layoutRevision >= 0;
  if (!response?.ok || !validRevision || !Array.isArray(floor?.tables)
      || !Array.isArray(response.deletedIds) || !Array.isArray(response.alreadyAbsentIds)
      || !Array.isArray(response.rejected)) return { ok: false, reason: 'incomplete_response' };

  const normalizeAckIds = (ids) => ids.map((id) => {
    const value = Number(id);
    return Number.isSafeInteger(value) && value > 0 ? String(value) : 'invalid';
  });
  const deletedIds = normalizeAckIds(response.deletedIds);
  const alreadyAbsentIds = normalizeAckIds(response.alreadyAbsentIds);
  const rejected = response.rejected.map((entry) => ({ id: String(Number(entry?.id)), reason: String(entry?.reason || '') }));
  const allReported = [...deletedIds, ...alreadyAbsentIds, ...rejected.map(({ id }) => id)];
  if (allReported.some((id) => id === 'invalid' || !requested.has(id))
      || new Set(allReported).size !== allReported.length
      || allReported.length !== requested.size
      || rejected.some(({ reason }) => !reason)) return { ok: false, reason: 'invalid_response' };
  return { ok: true, floor, deletedIds, alreadyAbsentIds, rejected };
};

const planTableMerge = (tables, requestedIds, floorId) => {
  const ids = Array.from(new Set((Array.isArray(requestedIds) || requestedIds instanceof Set
    ? Array.from(requestedIds)
    : []).map((id) => String(id ?? '').trim()).filter(Boolean)));
  if (ids.length < 2) return { ok: false, reason: 'minimum_tables' };

  const byId = new Map((Array.isArray(tables) ? tables : []).map((table) => [String(table.id), table]));
  const members = ids.map((id) => byId.get(id));
  if (members.some((table) => !table)) return { ok: false, reason: 'missing_table' };

  const targetFloor = String(floorId || UNASSIGNED_FLOOR_ID);
  if (members.some((table) => floorEntityId(table) !== targetFloor)) {
    return { ok: false, reason: 'different_floor' };
  }

  const memberIds = new Set(ids);
  const hasExistingLink = members.some((table) => Boolean(table.mergedInto)
    || (Array.isArray(table.mergedWith) && table.mergedWith.length > 0))
    || (Array.isArray(tables) ? tables : []).some((table) => {
      if (table.mergedInto && memberIds.has(String(table.mergedInto))) return true;
      return Array.isArray(table.mergedWith) && table.mergedWith.some((id) => memberIds.has(String(id)));
    });
  if (hasExistingLink) return { ok: false, reason: 'already_merged' };

  // Preserve floor-table order, not Set insertion order, so the parent remains
  // deterministic regardless of the order in which touch selections occurred.
  const orderedMembers = (Array.isArray(tables) ? tables : []).filter((table) => memberIds.has(String(table.id)));
  return { ok: true, reason: null, memberIds: orderedMembers.map((table) => table.id) };
};

const applyTableMergePlan = (tables, plan) => {
  if (!plan?.ok || !Array.isArray(plan.memberIds) || plan.memberIds.length < 2) return false;
  const byId = new Map((Array.isArray(tables) ? tables : []).map((table) => [String(table.id), table]));
  const members = plan.memberIds.map((id) => byId.get(String(id)));
  if (members.some((table) => !table)) return false;
  const [master, ...children] = members;
  master.mergedWith = children.map((table) => table.id);
  master.mergedInto = null;
  children.forEach((table) => {
    table.mergedInto = master.id;
    table.mergedWith = null;
  });
  return true;
};

const groupTablesByZoneForFloor = (tables, floorId, normalizeZone = (zone) => String(zone || 'بدون بخش')) => {
  const groups = new Map();
  entitiesForFloor(tables, floorId).forEach((table) => {
    const zone = normalizeZone(table.zone) || 'بدون بخش';
    if (!groups.has(zone)) groups.set(zone, []);
    groups.get(zone).push(table);
  });
  return groups;
};

const floorZoneOptionsForMove = (zones, tables, floorId, normalizeZone) => {
  const names = [
    ...entitiesForFloor(zones, floorId).map((zone) => normalizeZone(zone.name)),
    ...entitiesForFloor(tables, floorId).map((table) => normalizeTableZoneValue(table.zone, normalizeZone)),
  ].map((name) => String(name || '').trim()).filter((name) => name && normalizeZone(name) !== normalizeZone('بدون بخش'));
  return ['بدون بخش', ...new Set(names)];
};

const preferredFloorZone = (options, currentZone, normalizeZone) =>
  options.find((name) => normalizeZone(name) === normalizeZone(currentZone)) || 'بدون بخش';

const isFloorZoneNameTaken = (zones, name, floorId, normalizeZone, exceptId = null) => {
  const normalizedName = normalizeZone(name);
  return entitiesForFloor(zones, floorId).some((zone) => zone.id !== exceptId
    && normalizeZone(zone.name) === normalizedName);
};

const renameZoneAndTablesOnFloor = (zones, tables, zoneId, newName, normalizeZone) => {
  const zone = (Array.isArray(zones) ? zones : []).find((item) => String(item.id) === String(zoneId));
  if (!zone) return null;
  const oldName = normalizeZone(zone.name);
  const floorId = floorEntityId(zone);
  zone.name = newName;
  (Array.isArray(tables) ? tables : []).forEach((table) => {
    if (floorEntityId(table) === floorId && normalizeZone(table.zone) === oldName) table.zone = newName;
  });
  return zone;
};

const removeZoneAndReassignTablesOnFloor = (zones, tables, zoneId, fallbackZone, normalizeZone) => {
  const zone = (Array.isArray(zones) ? zones : []).find((item) => String(item.id) === String(zoneId));
  if (!zone) return null;
  const deletedName = normalizeZone(zone.name);
  const floorId = floorEntityId(zone);
  const remainingZones = zones.filter((item) => String(item.id) !== String(zone.id));
  (Array.isArray(tables) ? tables : []).forEach((table) => {
    if (floorEntityId(table) === floorId && normalizeZone(table.zone) === deletedName) table.zone = fallbackZone;
  });
  return { zone, zones: remainingZones };
};

const isFloorLayoutRevisionConflict = (error) => {
  const message = String(error?.message || error || '');
  return message === 'floor_layout_revision_conflict'
    || message.includes('نقشه در دستگاه دیگری تغییر کرده است');
};

const isUsableFloorDataSnapshot = (floor) => Boolean(floor
  && Number.isSafeInteger(floor.layoutRevision)
  && floor.layoutRevision >= 0
  && Array.isArray(floor.tables));
const isCompleteFloorLayoutSnapshot = (floor) => isUsableFloorDataSnapshot(floor)
  && Array.isArray(floor.zones)
  && Array.isArray(floor.fixtures)
  && Array.isArray(floor.floors)
  && Boolean(floor.settings && typeof floor.settings === 'object' && !Array.isArray(floor.settings));

const floorRefreshNotice = (refreshed) => refreshed
  ? { message: 'رسیدگی به فراخوان ثبت شد و وضعیت میز به‌روز شد.', type: 'success' }
  : { message: 'رسیدگی ثبت شد، اما وضعیت میز تازه نشد؛ اتصال را بررسی و نقشه را دوباره بارگیری کنید.', type: 'info' };

const normalizeFloorTableReference = (value) => String(value ?? '')
  .normalize('NFKC')
  .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
  .replace(/[ي]/g, 'ی')
  .replace(/[ك]/g, 'ک')
  .replace(/[\s‌]+/g, ' ')
  .trim()
  .toLocaleLowerCase('fa');

const isWaiterCallForTable = (call, table, allTables = [table]) => {
  const callReference = normalizeFloorTableReference(call?.tableNo);
  if (!callReference || !table) return false;
  const tableId = normalizeFloorTableReference(table.id);
  if (tableId && callReference === tableId) return true;
  if (tableId && callReference === normalizeFloorTableReference(`میز ${tableId}`)) return true;

  const label = normalizeFloorTableReference(table.label);
  if (!label || callReference !== label) return false;
  const sameLabelTables = (Array.isArray(allTables) ? allTables : [table])
    .filter((candidate) => normalizeFloorTableReference(candidate?.label) === label);
  return sameLabelTables.length === 1 && String(sameLabelTables[0]?.id) === String(table.id);
};

const createLayoutHistory = (getState, restoreState, limit = 35) => {
  const undoStack = [];
  const redoStack = [];
  const pushLimited = (stack, state) => {
    stack.push(cloneLayoutSnapshot(state));
    if (stack.length > limit) stack.shift();
  };

  return {
    recordBefore() {
      pushLimited(undoStack, getState());
      redoStack.length = 0;
    },
    undo() {
      if (!undoStack.length) return false;
      pushLimited(redoStack, getState());
      restoreState(cloneLayoutSnapshot(undoStack.pop()));
      return true;
    },
    redo() {
      if (!redoStack.length) return false;
      pushLimited(undoStack, getState());
      restoreState(cloneLayoutSnapshot(redoStack.pop()));
      return true;
    },
    rollbackLatest() {
      if (!undoStack.length) return false;
      restoreState(cloneLayoutSnapshot(undoStack.pop()));
      redoStack.length = 0;
      return true;
    },
    clear() { undoStack.length = 0; redoStack.length = 0; },
    get undoCount() { return undoStack.length; },
    get redoCount() { return redoStack.length; },
  };
};

const createHistoryCheckpoint = (recordBefore, onFirstChange = null) => {
  let recorded = false;
  return (hasChanged) => {
    if (!hasChanged || recorded) return false;
    recorded = true;
    recordBefore();
    onFirstChange?.();
    return true;
  };
};

const createLayoutRevision = () => {
  let revision = 0;
  return {
    markDirty() { revision += 1; return revision; },
    snapshot() { return revision; },
    isCurrent(snapshot) { return revision === snapshot; },
  };
};

const isLayoutImportBranchCompatible = (backupBranchId, currentBranchId) => {
  const backupBranch = String(backupBranchId ?? '').trim();
  const currentBranch = String(currentBranchId ?? '').trim();
  if (!backupBranch) return true; // Backups created before branch IDs existed.
  return Boolean(currentBranch) && backupBranch === currentBranch;
};

const createFloorBranchContext = (branchId) => {
  const id = branchId == null || String(branchId).trim() === '' ? null : branchId;
  return Object.freeze({
    id,
    query(extra = '') {
      const params = new URLSearchParams(extra);
      if (id != null) params.set('branchId', String(id));
      const search = params.toString();
      return search ? `?${search}` : '';
    },
  });
};

const createSerializedSaveRunner = () => {
  let active = null;
  let queuedSave = null;

  return {
    run(save) {
      if (active) {
        // Keep only the newest request: every save serializes the full layout,
        // so replaying intermediate snapshots would be both wasteful and unsafe.
        queuedSave = save;
        return active;
      }

      let resolveRun;
      let rejectRun;
      active = new Promise((resolve, reject) => {
        resolveRun = resolve;
        rejectRun = reject;
      });
      const activePromise = active;

      (async () => {
        let nextSave = save;
        let result;
        try {
          while (nextSave) {
            queuedSave = null;
            result = await nextSave();
            if (result === false) break;
            nextSave = queuedSave;
          }
          if (active === activePromise) active = null;
          resolveRun(result);
        } catch (error) {
          if (active === activePromise) active = null;
          rejectRun(error);
        } finally {
          if (!active) queuedSave = null;
        }
      })();

      return activePromise;
    },
    get isRunning() { return Boolean(active); },
  };
};

const calculateZoneDragPosition = (zone, dx, dy, step) => {
  const snap = Math.max(0.1, Number(step) || 0.5);
  const width = Math.max(0, Number(zone?.w) || 0);
  const height = Math.max(0, Number(zone?.h) || 0);
  const x = Math.round((Math.round(((Number(zone?.x) || 0) + dx) / snap) * snap) * 10) / 10;
  const y = Math.round((Math.round(((Number(zone?.y) || 0) + dy) / snap) * snap) * 10) / 10;
  return {
    x: Math.max(0, Math.min(100 - width, x)),
    y: Math.max(0, Math.min(100 - height, y)),
  };
};

/* ============================================================
   Factory: createFloorStudio(opts) → { mount, unmount }
   opts: { main, api, getCurrentBranchId, showToast,
           fmtNum, esc, debounce, autosave, runBusy, currentBranch }
   ============================================================ */
function createFloorStudio(opts) {
  const {
    main, api, getCurrentBranchId, showToast,
    fmtNum, esc, debounce, currentBranch,
  } = opts;
  const floorBranch = createFloorBranchContext(getCurrentBranchId());

  // ─── AbortController برای cleanup کامل هنگام unmount ───────────────────
  let _abortCtrl = new AbortController();
  let _renderCtrl = new AbortController();
  const signal = () => _abortCtrl.signal;

  // ─── وضعیت داخلی ──────────────────────────────────────────────────────
  const VIEW_PREFS_KEY = 'westo_admin_tables_view_mode';
  const QR_PREFS_KEY = 'westo_admin_qr_studio_v1';
  const SIDEBAR_PREF_KEY = `westo_admin_floor_sidebar_collapsed_${floorBranch.id}`;

  const cardsViewAvailable = typeof opts.renderCardsView === 'function';
  let currentView = resolveFloorViewMode(localStorage.getItem(VIEW_PREFS_KEY), cardsViewAvailable);
  try { localStorage.setItem(VIEW_PREFS_KEY, currentView); } catch {}
  let activeZone = 'all';
  let tableSearchQuery = '';
  let showOverviewFixtures = false;
  let isSidebarCollapsed = false;
  try { isSidebarCollapsed = localStorage.getItem(SIDEBAR_PREF_KEY) === '1'; } catch {}
  let advancedOpen = false;
  // Browse first on every screen. Moving furniture always requires an explicit action.
  let isEditMode = false;
  let studioMode = 'furniture';
  let selectedTableId = null;
  let selectedFixtureId = null;
  let selectedZoneId = null;
  let activeDrag = null;
  let justDragged = false;
  let canvasZoom = 1;
  let canvasPanX = 0;
  let canvasPanY = 0;
  let snapGridStep = 0.5;
  let isSavingLayout = false;
  let isLayoutDirty = false;
  let hasLayoutRevisionConflict = false;
  let isDrawingZone = false;
  let isMounted = false;
  const layoutRevision = createLayoutRevision();
  const layoutSaveRunner = createSerializedSaveRunner();

  const selectedTableIds = new Set();
  let tables = [];
  let floorZones = [];
  let floorFixtures = [];
  let floorLevels = [];
  let floorSettings = {};
  let activeFloorId = UNASSIGNED_FLOOR_ID;
  let floorData = null;
  let qrPrefs = {};

  const layoutHistory = createLayoutHistory(
    () => ({ tables, zones: floorZones, fixtures: floorFixtures, floors: floorLevels, settings: floorSettings, activeFloorId, activeZone }),
    (snapshot) => {
      tables = mergeFloorOperationalState(snapshot.tables, tables);
      floorZones = snapshot.zones;
      floorFixtures = snapshot.fixtures;
      floorLevels = snapshot.floors;
      floorSettings = snapshot.settings || {};
      activeFloorId = snapshot.activeFloorId || floorLevels[0]?.id || UNASSIGNED_FLOOR_ID;
      activeZone = snapshot.activeZone || 'all';
    },
  );

  // ─── Timer interval (نه روی window — کنترل شده) ──────────────────────
  let _countdownTimer = null;
  let _pollTimer = null;

  // ─── متوقف‌سازی کامل ──────────────────────────────────────────────────
  function unmount() {
    isMounted = false;
    document.body.classList.remove('admin-floor-active');
    _abortCtrl.abort();
    _renderCtrl.abort();
    _abortCtrl = new AbortController();
    _renderCtrl = new AbortController();
    if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  // ─── helpers ──────────────────────────────────────────────────────────
  const origin = location.origin;
  const currentBranchId = () => floorBranch.id;
  const branchQuery = () => floorBranch.query();
  const isCurrentStudio = () => isMounted
    && String(getCurrentBranchId() ?? '') === String(floorBranch.id ?? '');

  const normalizeZone = (z) => {
    const s = String(z || '').trim();
    if (!s) return '';
    if (/^(?:سالن اصلی|سالن|main(?: hall)?)$/i.test(s)) return 'سالن';
    if (/^(?:تراس و فضای باز|تراس|terrace|outdoor)$/i.test(s)) return 'تراس';
    if (/^(?:سالن اختصاصی ویژه|سالن ویژه|ویژه|vip)$/i.test(s)) return 'ویژه';
    return s;
  };

  const tableById = (id) => tables.find((t) => Number(t.id) === Number(id)) || null;
  const tableTitle = (table) => String(table?.label || `میز ${table?.id || ''}`).trim();
  const activeTables = () => tables.filter((t) => t.active !== false);

  const br = () => currentBranch();

  const validHex = (v, fallback) => /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v) : fallback;
  const validBaseUrl = (v) => {
    try {
      const url = new URL(String(v || '').trim());
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      url.hash = ''; url.search = '';
      return url.href.replace(/\/$/, '');
    } catch { return ''; }
  };

  // ─── شکل و صندلی ─────────────────────────────────────────────────────
  const shapeLabel = (s) => ({
    rectangle: '⬛ مستطیل استاندارد', conference: '🏛️ کنفرانس و تشریفات',
    semi_circle: '🌙 نیم‌دایره و هلال', wall_counter: '🪟 کانتر دیواری',
    round_booth: '🛋️ مبل گرد نعل‌اسبی', circle: '⭕ گرد', square: '⏹️ مربع',
    booth: '🛋️ نیمکت VIP', bar_stool: '🍸 صندلی بار',
    oval: '🥚 بیضی تشریفاتی', lounge_takht: '🛏️ تخت سنتی',
    'open-terrace': '🌿 تراس و فضای باز', 'l-shape': '◱ ال‌شکل', corridor: '▭ طولی و راهرویی',
  }[s] || '⬛ مستطیل');

  const shapeIcon = (s) => ({
    rectangle: '⬛', conference: '🏛️', semi_circle: '🌙', wall_counter: '🪟',
    round_booth: '🛋️', circle: '⭕', square: '⏹️', booth: '🛋️',
    bar_stool: '🍸', oval: '🥚', lounge_takht: '🛏️',
  }[s] || '⬛');

  const shapeTitle = (s) => ({
    rectangle: 'مستطیل', conference: 'کنفرانس', semi_circle: 'نیم‌دایره',
    wall_counter: 'کانتر دیواری', round_booth: 'مبل گرد', circle: 'گرد',
    square: 'مربع', booth: 'نیمکت VIP', bar_stool: 'صندلی بار',
    oval: 'بیضی', lounge_takht: 'تخت سنتی',
  }[s] || 'مستطیل');

  const chairLabel = (m) => ({
    standard: '🪑 استاندارد', armchair: '🛋️ مبل دسته‌دار',
    bar_stool: '🍸 صندلی بار', booth_bench: '🧽 نیمکت چرمی', bolster: '🪡 متکای سنتی',
  }[m] || '🪑 استاندارد');

  const chairIcon = (m) => ({
    standard: '🪑', armchair: '🛋️', bar_stool: '🍸', booth_bench: '🧽', bolster: '🪡',
  }[m] || '🪑');

  // ─── QR helpers ───────────────────────────────────────────────────────
  const defaultQrPrefs = { baseUrl: origin, dark: '#11181b', light: '#ffffff', ecl: 'M', width: 768, margin: 5 };

  const normalizeQrPrefs = () => {
    qrPrefs = {
      ...defaultQrPrefs, ...qrPrefs,
      baseUrl: validBaseUrl(qrPrefs.baseUrl) || origin,
      dark: validHex(qrPrefs.dark, defaultQrPrefs.dark),
      light: validHex(qrPrefs.light, defaultQrPrefs.light),
      ecl: ['L', 'M', 'Q', 'H'].includes(String(qrPrefs.ecl).toUpperCase()) ? String(qrPrefs.ecl).toUpperCase() : 'M',
      width: [512, 768, 1024].includes(Number(qrPrefs.width)) ? Number(qrPrefs.width) : 768,
      margin: [3, 5, 8].includes(Number(qrPrefs.margin)) ? Number(qrPrefs.margin) : 5,
    };
  };
  const saveQrPrefs = () => { try { localStorage.setItem(QR_PREFS_KEY, JSON.stringify(qrPrefs)); } catch {} };
  const qrEclLabel = () => ({ L: 'سبک', M: 'استاندارد', Q: 'مقاوم', H: 'بسیار مقاوم' }[qrPrefs.ecl] || 'استاندارد');
  const qrEclHint = () => ({ L: 'فایل سبک', M: 'پیشنهاد وستو', Q: 'مناسب محیط شلوغ', H: 'بیشترین تحمل آسیب چاپ' }[qrPrefs.ecl] || 'پیشنهاد وستو');
  const baseQrUrl = () => validBaseUrl(qrPrefs.baseUrl) || origin;

  const tableDestination = (table) => {
    const url = new URL('/menu', `${baseQrUrl()}/`);
    url.searchParams.set('table', String(table?.id || ''));
    url.searchParams.set('branch', String(table?.branchId || currentBranchId() || 1));
    return url.href;
  };

  const qrAssetUrl = (table, { download = false } = {}) => {
    const url = new URL('/api/admin/qr-code', origin);
    url.searchParams.set('data', tableDestination(table));
    url.searchParams.set('dark', qrPrefs.dark);
    url.searchParams.set('light', qrPrefs.light);
    url.searchParams.set('ecl', qrPrefs.ecl);
    url.searchParams.set('width', String(qrPrefs.width));
    url.searchParams.set('margin', String(qrPrefs.margin));
    url.searchParams.set('filename', `westo-table-${table?.id || 'qr'}`);
    if (download) url.searchParams.set('download', '1');
    return url.href;
  };

  // ─── History (Undo/Redo) ────────────────────────────────────────────
  const pushHistory = () => {
    try { layoutHistory.recordBefore(); } catch {}
    updateUndoButtonUi();
  };

  const undoLayout = () => {
    if (!layoutHistory.undo()) return;
    updateUndoButtonUi();
    debouncedSaveFloor();
    render();
    showToast('آخرین تغییرات چیدمان سالن بازگردانی شد (Undo).', 'info');
  };

  const redoLayout = () => {
    if (!layoutHistory.redo()) return;
    updateUndoButtonUi();
    debouncedSaveFloor();
    render();
    showToast('تغییر مجدداً اعمال گردید (Redo).', 'info');
  };

  // ─── DOM helpers (بدون full render) ────────────────────────────────
  const updateUndoButtonUi = () => {
    if (!isCurrentStudio()) return;
    document.querySelectorAll('[data-mobile-table-action="undo"]').forEach((button) => {
      button.disabled = layoutHistory.undoCount === 0;
    });
    document.querySelectorAll('[data-mobile-table-action="redo"]').forEach((button) => {
      button.disabled = layoutHistory.redoCount === 0;
    });
    const undoBtn = document.getElementById('map-undo') || document.getElementById('map-history-undo');
    if (undoBtn) {
      undoBtn.disabled = layoutHistory.undoCount === 0;
      undoBtn.title = layoutHistory.undoCount > 0
        ? `بازگردانی آخرین تغییر (${fmtNum(layoutHistory.undoCount)})`
        : 'تاریخچه خالی است';
    }
    const redoBtn = document.getElementById('map-redo') || document.getElementById('map-history-redo');
    if (redoBtn) {
      redoBtn.disabled = layoutHistory.redoCount === 0;
      redoBtn.title = layoutHistory.redoCount > 0
        ? `تکرار تغییر (${fmtNum(layoutHistory.redoCount)})`
        : 'موردی برای تکرار نیست';
    }
  };

  const updateSaveStatus = (saving) => {
    isSavingLayout = saving;
    if (!isCurrentStudio()) return;
    const saveButton = document.getElementById('map-save-layout');
    if (saveButton) saveButton.disabled = !isEditMode || saving || !isLayoutDirty || hasLayoutRevisionConflict;
    const pill = document.getElementById('map-save-status');
    if (!pill) return;
    if (saving) {
      pill.className = 'floor-save-status is-saving';
      pill.innerHTML = '<span class="pulse-dot" style="background:#f59e0b"></span><span>در حال ذخیره...</span>';
    } else if (hasLayoutRevisionConflict) {
      pill.className = 'floor-save-status is-error';
      pill.innerHTML = '<span role="alert">⚠️ نقشه در دستگاه دیگری تغییر کرده؛ نسخهٔ شما ذخیره نشد.</span><button class="btn btn-sm btn-ghost" type="button" data-floor-conflict-action="export">دانلود نسخهٔ من</button><button class="btn btn-sm btn-ghost" type="button" data-floor-conflict-action="reload">بارگیری نسخهٔ تازه</button>';
    } else if (isLayoutDirty) {
      pill.className = 'floor-save-status is-dirty';
      pill.innerHTML = '<span>● تغییرات در انتظار ذخیره</span>';
    } else {
      pill.className = 'floor-save-status';
      pill.innerHTML = '<span>✓ چیدمان ذخیره است</span>';
    }
  };

  const setUnsavedStatus = () => {
    layoutRevision.markDirty();
    isLayoutDirty = true;
    updateSaveStatus(isSavingLayout);
  };

  const setSaveErrorStatus = (error) => {
    isSavingLayout = false;
    isLayoutDirty = true;
    if (!isCurrentStudio()) return;
    const saveButton = document.getElementById('map-save-layout');
    if (saveButton) saveButton.disabled = !isEditMode || hasLayoutRevisionConflict;
    const pill = document.getElementById('map-save-status');
    if (!pill) return;
    pill.className = 'floor-save-status is-error';
    const rawMessage = String(error?.message || '');
    const message = rawMessage.includes('floor_layout_table_in_use')
      || rawMessage.includes('چیدمان فیزیکی میزهای در حال سرویس')
      ? 'ذخیره نشد: میزِ در حال سرویس، دارای تماس باز یا رزرو فعال تغییر کرده است. پس از پایان سرویس دوباره تلاش کنید.'
      : rawMessage.includes('floor_layout_revision_conflict')
        ? 'ذخیره نشد: نقشه در دستگاه دیگری تغییر کرده است؛ نسخهٔ تازه را بارگیری کنید.'
        : rawMessage || 'اتصال به سرور را بررسی و دوباره تلاش کنید.';
    pill.innerHTML = `<span role="alert">${esc(message)}</span>`;
  };

  // ─── Zone Helpers ───────────────────────────────────────────────────
  const detectZoneAtCoords = (x, y) => findFloorZoneAtPosition(floorZones, activeFloorId, x, y);

  const detectTableCollision = (targetTable) =>
    tables.some((other) => {
      if (Number(other.id) === Number(targetTable.id)) return false;
      if (floorEntityId(other) !== floorEntityId(targetTable)) return false;
      const dx = (Number(other.x) || 0) - (Number(targetTable.x) || 0);
      const dy = (Number(other.y) || 0) - (Number(targetTable.y) || 0);
      return Math.hypot(dx, dy) < 8.5;
    });

  const sanitizeNonOverlappingZones = (zones) => {
    if (!Array.isArray(zones) || zones.length <= 1) return zones || [];
    const result = zones.map((z) => ({ ...z }));
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const a = result[i]; const b = result[j];
        if (!zonesShareLayoutSpace(a, b)) continue;
        const xOverlap = Math.max(a.x, b.x) < Math.min(a.x + a.w, b.x + b.w) - 0.5;
        const yOverlap = Math.max(a.y, b.y) < Math.min(a.y + a.h, b.y + b.h) - 0.5;
        if (xOverlap && yOverlap) {
          const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (overlapY <= overlapX) {
            const midY = Math.round((Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2);
            if (a.y < b.y) { a.h = Math.max(8, midY - a.y); b.h = Math.max(8, (b.y + b.h) - midY); b.y = midY; }
            else { b.h = Math.max(8, midY - b.y); a.h = Math.max(8, (a.y + a.h) - midY); a.y = midY; }
          } else {
            const midX = Math.round((Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2);
            if (a.x < b.x) { a.w = Math.max(8, midX - a.x); b.w = Math.max(8, (b.x + b.w) - midX); b.x = midX; }
            else { b.w = Math.max(8, midX - b.x); a.w = Math.max(8, (a.x + a.w) - midX); a.x = midX; }
          }
        }
      }
    }
    return result;
  };

  const dedupeFloorZones = (zones) => {
    const byNameAndFloor = new Map();
    (Array.isArray(zones) ? zones : []).forEach((zone) => {
      const normalized = { ...zone, name: normalizeZone(zone.name) };
      const key = `${normalized.floorId}::${normalized.name}`;
      const current = byNameAndFloor.get(key);
      const isCanonicalId = /^zone-(?:main|terrace|vip)$/.test(String(normalized.id || ''));
      const currentIsCanonicalId = /^zone-(?:main|terrace|vip)$/.test(String(current?.id || ''));
      const area = Math.max(0, Number(normalized.w) || 0) * Math.max(0, Number(normalized.h) || 0);
      const currentArea = Math.max(0, Number(current?.w) || 0) * Math.max(0, Number(current?.h) || 0);

      if (!current || (isCanonicalId && !currentIsCanonicalId) || (isCanonicalId === currentIsCanonicalId && area > currentArea)) {
        byNameAndFloor.set(key, normalized);
      }
    });
    return Array.from(byNameAndFloor.values());
  };

  const ensureTableGeometry = (table, index) => {
    const hasX = table.x !== '' && table.x != null && Number.isFinite(Number(table.x));
    const hasY = table.y !== '' && table.y != null && Number.isFinite(Number(table.y));
    if (hasX) table.x = Number(table.x);
    if (hasY) table.y = Number(table.y);
    if (!hasX || !hasY) {
      const suggestion = suggestedTablePosition(index);
      if (!hasX) table.x = suggestion.x;
      if (!hasY) table.y = suggestion.y;
      table._floorStudioSuggestedPosition = true;
    }
    if (hasX && hasY && !table._floorStudioSuggestedPosition) {
      markTablePositioned(table);
    }
    if (!String(table.zone ?? '').trim() && !table._floorStudioUnassignedZone) table._floorStudioUnassignedZone = true;
    table.shape = table.shape || (Number(table.seats) <= 2 ? 'circle' : Number(table.seats) >= 6 ? 'booth' : 'rectangle');
    table.rotation = normalizeFloorRotation(table.rotation);
    table.scale = Math.max(0.5, Math.min(3.0, Number(table.scale ?? table.tableScale) || 1));
    table.scaleX = Math.max(0.5, Math.min(3.0, Number(table.scaleX ?? table.tableScaleX) || table.scale));
    table.scaleY = Math.max(0.5, Math.min(3.0, Number(table.scaleY ?? table.tableScaleY) || table.scale));
    table.chairScale = Math.max(0.6, Math.min(2.0, Number(table.chairScale) || 1));
    table.seats = normalizeSeatCapacity(table.seats);
    table.zone = normalizeTableZoneValue(table.zone, normalizeZone);
  };

  const commitTablePosition = (table, element) => {
    const wasSuggested = Boolean(table?._floorStudioSuggestedPosition);
    markTablePositioned(table);
    if (!wasSuggested || !element) return;
    element.querySelector('.floor-table-position-status')?.remove();
    element.title = `${tableTitle(table)} — ${table.stateLabel || 'آزاد'}`;
    element.setAttribute('aria-label', `${tableTitle(table)} — ${table.stateLabel || 'آزاد'}، ${fmtNum(normalizeSeatCapacity(table.seats))} صندلی`);
  };

  const floorCountdownLabel = (endsAt) => {
    const seconds = Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 1000));
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    const twoDigits = (v) => Number(v).toLocaleString('fa-IR', { minimumIntegerDigits: 2, useGrouping: false });
    return `${twoDigits(minutes)}:${twoDigits(remainder)}`;
  };

  // ─── Save Layout ─────────────────────────────────────────────────────
  const persistFloorLayout = async (silent = false) => {
    const saveRevision = layoutRevision.snapshot();
    updateSaveStatus(true);
    try {
      if (!Number.isSafeInteger(floorData?.layoutRevision) || floorData.layoutRevision < 0) {
        throw new Error('نسخهٔ چیدمان دریافت نشده است؛ صفحه را تازه کنید و تغییرات را دوباره اعمال کنید.');
      }
      const layoutPayload = tables.map((t) => ({
        id: Number(t.id),
        label: String(t.label || `میز ${t.id}`).trim(),
        seats: normalizeSeatCapacity(t.seats),
        ...tableZoneForSave(t, normalizeZone),
        active: t.active !== false,
        ...tableCoordinatesForSave(t),
        shape: t.shape || 'rectangle',
        rotation: normalizeFloorRotation(t.rotation),
        tableScale: Math.max(0.6, Math.min(2.5, Math.round((Number(t.scale ?? t.tableScale) || 1) * 10) / 10)),
        tableScaleX: Math.max(0.5, Math.min(3, Math.round((Number(t.scaleX ?? t.tableScaleX ?? t.scale ?? t.tableScale) || 1) * 100) / 100)),
        tableScaleY: Math.max(0.5, Math.min(3, Math.round((Number(t.scaleY ?? t.tableScaleY ?? t.scale ?? t.tableScale) || 1) * 100) / 100)),
        chairScale: Math.max(0.6, Math.min(2.0, Math.round((Number(t.chairScale) || 1) * 10) / 10)),
        chairModel: String(t.chairModel || '').slice(0, 25) || undefined,
        ...floorIdForPersistence(t),
        mergedWith: Array.isArray(t.mergedWith) ? t.mergedWith : [],
        mergedInto: t.mergedInto || null,
        tags: Array.isArray(t.tags) ? t.tags : [],
      }));
      const zonesPayload = floorZones.map((z) => ({
        id: String(z.id),
        name: normalizeZone(z.name),
        x: Math.max(0, Math.min(100, Math.round(Number(z.x) * 10) / 10)),
        y: Math.max(0, Math.min(100, Math.round(Number(z.y) * 10) / 10)),
        w: Math.max(5, Math.min(100, Math.round(Number(z.w) * 10) / 10)),
        h: Math.max(5, Math.min(100, Math.round(Number(z.h) * 10) / 10)),
        color: z.color || 'blue', icon: z.icon || '🏷️',
        lengthM: z.lengthM, widthM: z.widthM, areaSqM: z.areaSqM,
        shape: z.shape, ...floorIdForPersistence(z),
      }));
      const fixturesPayload = floorFixtures.map((f) => ({
        id: String(f.id), type: f.type || 'fixture', name: f.name || 'المان',
        x: Math.max(0, Math.min(100, Math.round(Number(f.x) * 10) / 10)),
        y: Math.max(0, Math.min(100, Math.round(Number(f.y) * 10) / 10)),
        w: Math.max(2, Math.min(100, Math.round(Number(f.w) * 10) / 10)),
        h: Math.max(2, Math.min(100, Math.round(Number(f.h) * 10) / 10)),
        rotation: normalizeFloorRotation(f.rotation),
        color: f.color || 'slate', icon: f.icon || '🏷️',
        ...floorIdForPersistence(f),
      }));
      const floorsPayload = floorLevels.map((fl) => ({
        id: String(fl.id), name: String(fl.name),
        level: Number(fl.level) || 0, icon: fl.icon || '🏛️',
        isDefault: Boolean(fl.isDefault),
      }));
      const res = await api('/api/admin/v2/floor/layout', {
        method: 'PUT',
        body: JSON.stringify({
          expectedLayoutRevision: floorData.layoutRevision,
          tables: layoutPayload, zones: zonesPayload,
          fixtures: fixturesPayload, floors: floorsPayload,
          settings: floorSettings, branchId: currentBranchId(),
        }),
      });
      const responseLayoutRevision = res?.floor?.layoutRevision ?? res?.layoutRevision;
      if (!Number.isSafeInteger(responseLayoutRevision) || responseLayoutRevision < 0) {
        throw new Error('سرور نسخهٔ تازهٔ چیدمان را تأیید نکرد؛ وضعیت ذخیره را بررسی کنید.');
      }
      // A successful older save still advances the server revision even when
      // a newer local edit is queued. Keep that revision for the queued save,
      // but only replace the editable layout when this snapshot is current.
      floorData = { ...(floorData || {}), layoutRevision: responseLayoutRevision };
      if (layoutRevision.isCurrent(saveRevision) && res?.floor) {
        floorData = res.floor;
        if (Array.isArray(res.floor.zones)) {
          floorZones = res.floor.zones.map((z) => ({
            id: String(z.id), name: normalizeZone(z.name),
            x: Number(z.x) || 0, y: Number(z.y) || 0,
            w: Number(z.w) || 30, h: Number(z.h) || 30,
            color: z.color || 'blue', icon: z.icon || '🏷️',
            lengthM: z.lengthM, widthM: z.widthM, areaSqM: z.areaSqM,
            shape: z.shape, ...floorIdForPersistence(z),
          }));
        }
        if (Array.isArray(res.floor.fixtures)) {
          floorFixtures = res.floor.fixtures.map((f) => ({
            id: String(f.id), type: f.type || 'fixture', name: f.name || 'المان',
            x: Number(f.x) || 10, y: Number(f.y) || 10,
            w: Number(f.w) || 10, h: Number(f.h) || 8,
            rotation: Number(f.rotation) || 0,
            color: f.color || 'slate', icon: f.icon || '🏷️',
            ...floorIdForPersistence(f),
          }));
        }
        if (Array.isArray(res.floor.floors)) {
          floorLevels = res.floor.floors.map((fl) => ({
            id: String(fl.id), name: String(fl.name),
            level: Number(fl.level) || 0, icon: fl.icon || '🏛️',
            isDefault: Boolean(fl.isDefault),
          })).filter((floor) => floor.id && floor.id !== 'undefined');
          if (!floorExists(floorLevels, activeFloorId)) activeFloorId = floorLevels[0]?.id || UNASSIGNED_FLOOR_ID;
        }
      }
      const savedCurrentRevision = layoutRevision.isCurrent(saveRevision);
      if (savedCurrentRevision) isLayoutDirty = false;
      updateSaveStatus(false);
      if (!silent && savedCurrentRevision) showToast('چیدمان نقشه سالن با موفقیت ذخیره گردید.', 'success');
      return true;
    } catch (e) {
      if (isFloorLayoutRevisionConflict(e)) {
        hasLayoutRevisionConflict = true;
        updateSaveStatus(false);
        if (!silent) showToast('نقشه در دستگاه دیگری تغییر کرده است. نسخهٔ محلی را دانلود کنید و سپس نسخهٔ تازه را آگاهانه بارگیری کنید.', 'error');
      } else {
        setSaveErrorStatus(e);
        if (!silent) showToast(e.message || 'خطا در ذخیره چیدمان نقشه', 'error');
      }
      return false;
    }
  };
  const saveFloorLayout = (silent = false) => {
    if (hasLayoutRevisionConflict) {
      if (!silent) showToast('ابتدا تعارض را با دانلود نسخهٔ محلی یا بارگیری نسخهٔ تازه حل کنید.', 'warning');
      return Promise.resolve(false);
    }
    layoutRevision.markDirty();
    isLayoutDirty = true;
    updateSaveStatus(isSavingLayout);
    return layoutSaveRunner.run(() => persistFloorLayout(silent));
  };
  const showLayoutSaveFailure = () => showToast(
    hasLayoutRevisionConflict
      ? 'تعارض نسخه: نسخهٔ محلی را دانلود کنید و بعد نسخهٔ تازه را آگاهانه بارگیری کنید.'
      : 'تغییر روی همین دستگاه باقی مانده اما ذخیره نشد؛ اتصال را بررسی و دوباره ذخیره کنید.',
    'error',
  );
  const queuedSaveFloor = debounce(() => saveFloorLayout(true), 600);
  const debouncedSaveFloor = () => {
    setUnsavedStatus();
    queuedSaveFloor();
  };
  const rollbackCancelledLayoutGesture = (hasChanged, wasDirtyBeforeGesture) => {
    if (!hasChanged || !layoutHistory.rollbackLatest()) return false;
    // Invalidate any save snapshot captured while the cancelled gesture was
    // visible locally, then preserve and re-save edits that predated it.
    layoutRevision.markDirty();
    isLayoutDirty = wasDirtyBeforeGesture;
    updateSaveStatus(isSavingLayout);
    updateUndoButtonUi();
    render();
    if (wasDirtyBeforeGesture) debouncedSaveFloor();
    return true;
  };

  const loadFloorData = async () => {
    try {
      const fresh = await api(`/api/admin/v2/floor${branchQuery()}`);
      if (!isUsableFloorDataSnapshot(fresh)) return false;
      // This refresh follows an operational waiter-call action. It may update
      // live table status, but must not advance the layout revision or replace
      // geometry while local edits are pending on this device.
      tables = mergeFloorOperationalState(tables, fresh.tables);
      if (fresh.layoutRevision !== floorData?.layoutRevision) {
        hasLayoutRevisionConflict = true;
        updateSaveStatus(false);
      }
      return true;
    } catch {
      return false;
    }
  };

  const reloadLatestLayoutAfterConflict = async () => {
    queuedSaveFloor.cancel?.();
    try {
      const fresh = await api(`/api/admin/v2/floor${branchQuery()}`);
      if (!isCompleteFloorLayoutSnapshot(fresh)) {
        throw new Error('دادهٔ کامل و نسخه‌دار نقشه دریافت نشد؛ تغییرات محلی حفظ شده‌اند.');
      }

      floorData = fresh;
      floorLevels = floorCollection(fresh, 'floors').filter((floor) => String(floor?.id || '').trim()).map((floor) => ({
        id: String(floor.id), name: String(floor.name || 'طبقه بدون نام'),
        level: Number(floor.level) || 0, icon: floor.icon || '🏛️', isDefault: Boolean(floor.isDefault),
      }));
      floorZones = sanitizeNonOverlappingZones(dedupeFloorZones(floorCollection(fresh, 'zones').map((zone) => ({
        ...zone,
        id: String(zone.id || `zone-${Math.random().toString(36).slice(2, 7)}`),
        name: normalizeZone(zone.name),
        x: Number(zone.x) || 0, y: Number(zone.y) || 0,
        w: Number(zone.w) || 30, h: Number(zone.h) || 30,
        ...floorIdForPersistence(zone),
      }))));
      floorFixtures = floorCollection(fresh, 'fixtures').map((fixture, index) => ({
        ...fixture,
        id: String(fixture.id || `fixture-${index}`),
        x: Number(fixture.x) || 0, y: Number(fixture.y) || 0,
        w: Number(fixture.w) || 2, h: Number(fixture.h) || 2,
        ...floorIdForPersistence(fixture),
      }));
      if (fresh.settings && typeof fresh.settings === 'object') floorSettings = fresh.settings;
      tables = floorCollection(fresh, 'tables').map((table, index) => {
        const next = { ...table, zone: normalizeTableZoneValue(table.zone, normalizeZone) };
        if (!String(table.zone ?? '').trim()) next._floorStudioUnassignedZone = true;
        ensureTableGeometry(next, index);
        return next;
      });
      if (!floorExists(floorLevels, activeFloorId)) activeFloorId = floorLevels[0]?.id || UNASSIGNED_FLOOR_ID;
      if (hasUnassignedFloorEntities(tables, floorZones, floorFixtures)) activeFloorId = UNASSIGNED_FLOOR_ID;
      activeZone = 'all';
      selectedTableId = null;
      selectedFixtureId = null;
      selectedZoneId = null;
      selectedTableIds.clear();
      layoutHistory.clear();
      layoutRevision.markDirty(); // Invalidate any snapshot captured before the refresh.
      isLayoutDirty = false;
      hasLayoutRevisionConflict = false;
      updateSaveStatus(false);
      render();
      showToast('آخرین نسخهٔ ثبت‌شدهٔ نقشه بارگیری شد؛ تغییرات ذخیره‌نشدهٔ محلی کنار گذاشته شدند.', 'success');
      return true;
    } catch (error) {
      showToast(error?.message || 'بارگیری نسخهٔ تازه ناموفق بود؛ نسخهٔ محلی حفظ شده است.', 'error');
      return false;
    }
  };

  // ─── Modal سیستم (in-studio) ────────────────────────────────────────
  const showFloorModal = ({ title, bodyHtml, confirmText = 'تایید و ذخیره', confirmClass = 'btn-primary', cancelText = 'انصراف', modalClass = '', onConfirm }) => {
    const existing = document.getElementById('floor-modal-backdrop');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'floor-modal-backdrop';
    backdrop.className = 'floor-studio-backdrop';
    backdrop.innerHTML = `
      <div class="floor-studio-modal ${modalClass}" role="dialog" aria-modal="true">
        <div class="floor-studio-modal__head">
          <h3>${title}</h3>
          <button type="button" class="floor-studio-modal__close" id="floor-modal-close" aria-label="بستن">✕</button>
        </div>
        <form id="floor-modal-form">
          <div class="floor-studio-modal__body">${bodyHtml}</div>
          <div class="floor-studio-modal__actions">
            <button type="button" class="btn btn-sm btn-ghost" id="floor-modal-cancel">${esc(cancelText)}</button>
            <button type="submit" class="btn btn-sm ${esc(confirmClass)}" id="floor-modal-confirm">${esc(confirmText)}</button>
          </div>
        </form>
      </div>`;

    document.body.appendChild(backdrop);

    const close = () => {
      backdrop.remove();
      document.removeEventListener('keydown', onKeyDown);
    };
    const onKeyDown = (ev) => { if (ev.key === 'Escape') close(); };
    document.addEventListener('keydown', onKeyDown);

    backdrop.querySelector('#floor-modal-close')?.addEventListener('click', close);
    backdrop.querySelector('#floor-modal-cancel')?.addEventListener('click', close);
    backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) close(); });

    const form = backdrop.querySelector('#floor-modal-form');
    form?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (onConfirm) {
        const result = await onConfirm(form);
        if (result !== false) close();
      } else { close(); }
    });

    setTimeout(() => {
      const firstInput = form?.querySelector('input, select, textarea');
      if (firstInput) { firstInput.focus(); if (typeof firstInput.select === 'function') firstInput.select(); }
    }, 50);

    return { close };
  };

  // ─── Generic Drag Handler ────────────────────────────────────────────
  // جایگزین ۳ drag handler تکراری — table/fixture/zone drag
  const createDragHandler = ({ getScaleEl, onDragStart, onMove, onEnd, onCancel, snapStep = () => snapGridStep }) => {
    return (e, el) => {
      const scaleEl = getScaleEl ? getScaleEl() : (document.getElementById('admin-canvas-scaler') || document.getElementById('admin-floor-canvas'));
      if (!scaleEl) return;
      const rect = scaleEl.getBoundingClientRect();
      const startInfo = onDragStart ? onDragStart(e, el, rect) : {};
      if (startInfo === false) return;

      el.classList.add('is-dragging');
      try { el.setPointerCapture(e.pointerId); } catch {}

      let hasMoved = false;

      const onPointerMove = (ev) => {
        if (!isActiveFloorPointerEvent(ev, e.pointerId)) return;
        const dx = ((ev.clientX - e.clientX) / rect.width) * 100;
        const dy = ((ev.clientY - e.clientY) / rect.height) * 100;
        if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) hasMoved = true;
        onMove(ev, { dx, dy, rect, hasMoved, snap: snapStep() });
      };

      const onPointerUp = (ev) => {
        if (!isActiveFloorPointerEvent(ev, e.pointerId)) return;
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
        el.classList.remove('is-dragging');
        try { el.releasePointerCapture(ev.pointerId || e.pointerId); } catch {}
        if (isCancelledFloorPointerEvent(ev)) {
          if (onCancel) onCancel(ev, { hasMoved });
          return;
        }
        if (onEnd) onEnd(ev, { hasMoved });
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    };
  };

  // ─── Table Drag ──────────────────────────────────────────────────────
  const handleTableDrag = (e, el) => {
    const tableId = Number(el.dataset.table);
    const table = tableById(tableId);
    if (!table) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const originX = Number(table.x) || 50;
    const originY = Number(table.y) || 50;

    const scaleEl = document.getElementById('admin-canvas-scaler') || document.getElementById('admin-floor-canvas');
    if (!scaleEl) return;
    const rect = scaleEl.getBoundingClientRect();

    const isGroup = selectedTableIds.has(tableId) && selectedTableIds.size > 1;
    const groupMembers = isGroup
      ? Array.from(selectedTableIds).map((id) => {
          const t = tableById(id);
          const memberEl = scaleEl.querySelector(`.plan-table[data-table="${id}"]`);
          return { id, table: t, el: memberEl, ox: Number(t?.x) || 50, oy: Number(t?.y) || 50 };
        }).filter((m) => m.table && m.el)
      : [];

    el.classList.add('is-dragging');
    try { el.setPointerCapture(e.pointerId); } catch {}

    let badge = el.querySelector('.plan-table-coords-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'plan-table-coords-badge';
      el.appendChild(badge);
    }
    const roomL = Number(floorSettings.lengthM) || 20;
    const roomW = Number(floorSettings.widthM) || 15;
    badge.textContent = `${Math.round(originX)}% , ${Math.round(originY)}%`;

    let hasMoved = false;
    const wasDirtyBeforeGesture = isLayoutDirty;
    const checkpoint = createHistoryCheckpoint(pushHistory, setUnsavedStatus);

    const onPointerMove = (ev) => {
      if (!isActiveFloorPointerEvent(ev, e.pointerId)) return;
      const dx = ((ev.clientX - startX) / rect.width) * 100;
      const dy = ((ev.clientY - startY) / rect.height) * 100;
      let newX = Math.round((originX + dx) / snapGridStep) * snapGridStep;
      let newY = Math.round((originY + dy) / snapGridStep) * snapGridStep;

      // Smart guides
      let matchedX = null; let matchedY = null;
      const otherTables = tables.filter((t) => Number(t.id) !== Number(table.id) && floorEntityId(t) === activeFloorId);
      for (const ot of otherTables) {
        if (isGroup && selectedTableIds.has(Number(ot.id))) continue;
        const ox = Number(ot.x) || 50; const oy = Number(ot.y) || 50;
        if (Math.abs(newX - ox) <= 1.2) { newX = ox; matchedX = ox; }
        if (Math.abs(newY - oy) <= 1.2) { newY = oy; matchedY = oy; }
      }

      newX = Math.max(5, Math.min(95, newX));
      newY = Math.max(5, Math.min(95, newY));

      const groupTargets = isGroup ? groupMembers.map((m) => ({
        ...m,
        x: Math.max(5, Math.min(95, Math.round((m.ox + (newX - originX)) * 10) / 10)),
        y: Math.max(5, Math.min(95, Math.round((m.oy + (newY - originY)) * 10) / 10)),
      })) : [];
      const changesLayout = Math.abs((Number(table.x) || 0) - newX) > 0.001 ||
        Math.abs((Number(table.y) || 0) - newY) > 0.001 ||
        groupTargets.some((m) => Math.abs((Number(m.table.x) || 0) - m.x) > 0.001 || Math.abs((Number(m.table.y) || 0) - m.y) > 0.001);
      if (checkpoint(changesLayout)) hasMoved = true;
      if (Math.abs((Number(table.x) || 0) - newX) > 0.001 || Math.abs((Number(table.y) || 0) - newY) > 0.001) commitTablePosition(table, el);
      table.x = newX; table.y = newY;

      // Direct DOM update — بدون full render
      el.style.left = `${newX}%`;
      el.style.top = `${newY}%`;

      // Group Drag sync for all selected tables
      if (isGroup) {
        for (const m of groupTargets) {
          if (m.id === tableId) continue;
          if (Math.abs((Number(m.table.x) || 0) - m.x) > 0.001 || Math.abs((Number(m.table.y) || 0) - m.y) > 0.001) commitTablePosition(m.table, m.el);
          m.table.x = m.x;
          m.table.y = m.y;
          m.el.style.left = `${m.x}%`;
          m.el.style.top = `${m.y}%`;
        }
      }

      // Minimum Aisle Clearance Check (فاصله تردد تا نزدیک‌ترین میز به متر)
      let minDistanceM = 999;
      for (const ot of otherTables) {
        if (isGroup && selectedTableIds.has(Number(ot.id))) continue;
        const ox = Number(ot.x) || 50; const oy = Number(ot.y) || 50;
        const dxM = ((newX - ox) / 100) * roomL;
        const dyM = ((newY - oy) / 100) * roomW;
        const dist = Math.hypot(dxM, dyM);
        if (dist < minDistanceM) minDistanceM = dist;
      }
      const isClearanceWarn = minDistanceM < 0.75;
      const posXMeter = Math.round((newX / 100) * roomL * 10) / 10;
      const posYMeter = Math.round((newY / 100) * roomW * 10) / 10;

      if (badge) {
        badge.classList.toggle('is-clearance-warn', isClearanceWarn);
        if (isClearanceWarn) {
          badge.textContent = `${Math.round(newX)}% , ${Math.round(newY)}% · ⚠️ حریم عبور (${minDistanceM.toFixed(1)}م)`;
        } else {
          badge.textContent = `${Math.round(newX)}% , ${Math.round(newY)}% (${posXMeter}م , ${posYMeter}م)`;
        }
      }

      // Smart guide lines
      _updateSmartGuide('x', matchedX, scaleEl);
      _updateSmartGuide('y', matchedY, scaleEl);
    };

    const onPointerUp = (ev) => {
      if (!isActiveFloorPointerEvent(ev, e.pointerId)) return;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      el.classList.remove('is-dragging');
      badge?.remove();
      _hideSmartGuides();
      try { el.releasePointerCapture(ev.pointerId || e.pointerId); } catch {}
      if (isCancelledFloorPointerEvent(ev)) {
        rollbackCancelledLayoutGesture(hasMoved, wasDirtyBeforeGesture);
        return;
      }
      if (hasMoved) {
        const droppedTables = isGroup ? groupMembers.map((member) => member.table) : [table];
        const zoneChanges = planFloorZoneMembershipSync(droppedTables, floorZones, activeFloorId, normalizeZone);
        const reassignedCount = applyFloorZoneMembershipSync(droppedTables, zoneChanges, normalizeZone);
        justDragged = true;
        setTimeout(() => { justDragged = false; }, 180);
        debouncedSaveFloor();
        if (reassignedCount) {
          render();
          showToast(`بخش ${fmtNum(reassignedCount)} میز با محدودهٔ نقشه هماهنگ شد.`, 'info');
        }
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  // ─── Fixture Drag ────────────────────────────────────────────────────
  const handleFixtureDrag = (e, el) => {
    const fId = el.dataset.fixtureId;
    const fixture = floorFixtures.find((f) => f.id === fId);
    if (!fixture) return;

    const scaleEl = document.getElementById('admin-canvas-scaler') || document.getElementById('admin-floor-canvas');
    if (!scaleEl) return;
    const rect = scaleEl.getBoundingClientRect();
    const startX = e.clientX; const startY = e.clientY;
    const origX = Number(fixture.x) || 0; const origY = Number(fixture.y) || 0;
    let hasMoved = false;
    const wasDirtyBeforeGesture = isLayoutDirty;
    const checkpoint = createHistoryCheckpoint(pushHistory, setUnsavedStatus);

    el.classList.add('is-dragging');
    try { el.setPointerCapture(e.pointerId); } catch {}

    const onPointerMove = (ev) => {
      if (!isActiveFloorPointerEvent(ev, e.pointerId)) return;
      const dx = ((ev.clientX - startX) / rect.width) * 100;
      const dy = ((ev.clientY - startY) / rect.height) * 100;
      let newX = Math.round((origX + dx) / snapGridStep) * snapGridStep;
      let newY = Math.round((origY + dy) / snapGridStep) * snapGridStep;
      newX = Math.max(0, Math.min(100 - (Number(fixture.w) || 10), newX));
      newY = Math.max(0, Math.min(100 - (Number(fixture.h) || 8), newY));
      const nextX = Math.round(newX * 10) / 10;
      const nextY = Math.round(newY * 10) / 10;
      if (checkpoint(Math.abs((Number(fixture.x) || 0) - nextX) > 0.001 || Math.abs((Number(fixture.y) || 0) - nextY) > 0.001)) hasMoved = true;
      fixture.x = nextX;
      fixture.y = nextY;
      el.style.left = `${fixture.x}%`;
      el.style.top = `${fixture.y}%`;
    };

    const onPointerUp = (ev) => {
      if (!isActiveFloorPointerEvent(ev, e.pointerId)) return;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      el.classList.remove('is-dragging');
      try { el.releasePointerCapture(ev.pointerId || e.pointerId); } catch {}
      if (isCancelledFloorPointerEvent(ev)) {
        rollbackCancelledLayoutGesture(hasMoved, wasDirtyBeforeGesture);
        return;
      }
      if (hasMoved) {
        justDragged = true;
        setTimeout(() => { justDragged = false; }, 180);
        debouncedSaveFloor();
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  const handleZoneDrag = (e, el) => {
    const zone = entitiesForFloor(floorZones, activeFloorId).find((item) => item.id === el.dataset.zoneId);
    if (!zone || el.classList.contains('is-full-view')) return;
    const scaleEl = document.getElementById('admin-canvas-scaler') || document.getElementById('admin-floor-canvas');
    if (!scaleEl) return;
    const rect = scaleEl.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    let hasMoved = false;
    const wasDirtyBeforeGesture = isLayoutDirty;
    const checkpoint = createHistoryCheckpoint(pushHistory, setUnsavedStatus);

    el.classList.add('is-moving');
    try { el.setPointerCapture(e.pointerId); } catch {}

    const onPointerMove = (ev) => {
      if (!isActiveFloorPointerEvent(ev, e.pointerId)) return;
      const dx = ((ev.clientX - startX) / rect.width) * 100;
      const dy = ((ev.clientY - startY) / rect.height) * 100;
      const next = calculateZoneDragPosition(zone, dx, dy, snapGridStep);
      const changed = Math.abs((Number(zone.x) || 0) - next.x) > 0.001 || Math.abs((Number(zone.y) || 0) - next.y) > 0.001;
      if (checkpoint(changed)) hasMoved = true;
      zone.x = next.x;
      zone.y = next.y;
      el.style.left = `${next.x}%`;
      el.style.top = `${next.y}%`;
    };

    const onPointerUp = (ev) => {
      if (!isActiveFloorPointerEvent(ev, e.pointerId)) return;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      el.classList.remove('is-moving');
      try { el.releasePointerCapture(ev.pointerId || e.pointerId); } catch {}
      if (isCancelledFloorPointerEvent(ev)) {
        rollbackCancelledLayoutGesture(hasMoved, wasDirtyBeforeGesture);
        return;
      }
      if (!hasMoved) return;
      justDragged = true;
      setTimeout(() => { justDragged = false; }, 180);
      selectedZoneId = zone.id;
      debouncedSaveFloor();
      render();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  // ─── Fixture Resize ──────────────────────────────────────────────────
  const handleFixtureResize = (e, handleEl) => {
    const fixtureEl = handleEl.closest('.plan-fixture');
    const fId = fixtureEl?.dataset.fixtureId;
    const fixture = floorFixtures.find((f) => f.id === fId);
    if (!fixture) return;

    const scaleEl = document.getElementById('admin-canvas-scaler') || document.getElementById('admin-floor-canvas');
    if (!scaleEl) return;
    const rect = scaleEl.getBoundingClientRect();
    const startX = e.clientX; const startY = e.clientY;
    const origW = Number(fixture.w) || 12; const origH = Number(fixture.h) || 8;
    let hasMoved = false;
    const wasDirtyBeforeGesture = isLayoutDirty;
    const checkpoint = createHistoryCheckpoint(pushHistory, setUnsavedStatus);

    handleEl.classList.add('is-resizing');
    try { handleEl.setPointerCapture(e.pointerId); } catch {}

    const onPointerMove = (ev) => {
      if (!isActiveFloorPointerEvent(ev, e.pointerId)) return;
      const dx = ((ev.clientX - startX) / rect.width) * 100;
      const dy = ((ev.clientY - startY) / rect.height) * 100;
      const newW = Math.max(4, Math.min(60, Math.round((origW + dx) / snapGridStep) * snapGridStep));
      const newH = Math.max(3, Math.min(50, Math.round((origH + dy) / snapGridStep) * snapGridStep));
      const nextW = Math.round(newW * 10) / 10;
      const nextH = Math.round(newH * 10) / 10;
      if (checkpoint(Math.abs((Number(fixture.w) || 0) - nextW) > 0.001 || Math.abs((Number(fixture.h) || 0) - nextH) > 0.001)) hasMoved = true;
      fixture.w = nextW;
      fixture.h = nextH;
      fixtureEl.style.width = `${fixture.w}%`;
      fixtureEl.style.height = `${fixture.h}%`;
    };

    const onPointerUp = (ev) => {
      if (!isActiveFloorPointerEvent(ev, e.pointerId)) return;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      handleEl.classList.remove('is-resizing');
      try { handleEl.releasePointerCapture(ev.pointerId || e.pointerId); } catch {}
      if (isCancelledFloorPointerEvent(ev)) {
        rollbackCancelledLayoutGesture(hasMoved, wasDirtyBeforeGesture);
        return;
      }
      if (hasMoved) {
        debouncedSaveFloor();
        render();
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  // ─── CAD Directional Anchored Table Resize Engine ───────────────────────
  const handleTableResize = (e, handleEl) => {
    const tableEl = handleEl.closest('.plan-table');
    const tableId = Number(tableEl?.dataset.table);
    const table = tableById(tableId);
    if (!table || !tableEl) return;

    const corner = handleEl.dataset.resizeCorner || 'se';
    const origScale = Number(table.scale) || 1;
    const origScaleX = Number(table.scaleX ?? table.tableScaleX) || origScale;
    const origScaleY = Number(table.scaleY ?? table.tableScaleY) || origScale;

    const scaleEl = document.getElementById('admin-canvas-scaler') || document.getElementById('admin-floor-canvas');
    if (!scaleEl) return;
    const canvasRect = scaleEl.getBoundingClientRect();

    // اندازه فیزیکی محاسبه‌شده سطح میز بدون scale
    const surfaceEl = tableEl.querySelector('.plan-table-surface') || tableEl;
    const surfRect = surfaceEl.getBoundingClientRect();
    const unscaledW = Math.max(40, (surfRect.width / origScaleX) || 96);
    const unscaledH = Math.max(30, (surfRect.height / origScaleY) || 68);

    const origHW = (unscaledW * origScaleX) / 2;
    const origHH = (unscaledH * origScaleY) / 2;

    // مرکز فعلی میز در مختصات پیکسلی بوم
    const origCenterX = (table.x / 100) * canvasRect.width;
    const origCenterY = (table.y / 100) * canvasRect.height;
    let hasMoved = false;
    const wasDirtyBeforeGesture = isLayoutDirty;
    const checkpoint = createHistoryCheckpoint(pushHistory, setUnsavedStatus);

    // زاویه چرخش به رادیان
    const rad = ((Number(table.rotation) || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // تعیین بردار دستگیره و نقطه لنگر (Anchor) مقابل
    const dirU = (corner.endsWith('e') || corner === 'e') ? 1 : -1;
    const dirV = (corner.endsWith('s') || corner === 's') ? 1 : -1;
    const affectsWidth = ['e', 'w', 'ne', 'nw', 'se', 'sw'].includes(corner);
    const affectsLength = ['n', 's', 'ne', 'nw', 'se', 'sw'].includes(corner);

    const anchorLocalU = affectsWidth ? -dirU * origHW : 0;
    const anchorLocalV = affectsLength ? -dirV * origHH : 0;

    // مختصات پیکسلی لنگر روی بوم
    const anchorPxX = origCenterX + (anchorLocalU * cos - anchorLocalV * sin);
    const anchorPxY = origCenterY + (anchorLocalU * sin + anchorLocalV * cos);

    // ایجاد یا دریافت نشانگر زنده ابعاد (HUD Badge)
    let hudEl = document.querySelector('.floor-resize-hud');
    if (!hudEl) {
      hudEl = document.createElement('div');
      hudEl.className = 'floor-resize-hud';
      document.body.appendChild(hudEl);
    }

    handleEl.classList.add('is-resizing');
    try { handleEl.setPointerCapture(e.pointerId); } catch {}
    e.stopPropagation();

    const updateHud = (scaleX, scaleY, ev) => {
      if (!hudEl) return;
      const wCm = Math.round(unscaledW * scaleX * 1.5);
      const hCm = Math.round(unscaledH * scaleY * 1.5);
      hudEl.innerHTML = `
        <strong>📐 عرض ${fmtNum(wCm)} × طول ${fmtNum(hCm)} سانتی‌متر</strong>
        <small>${fmtNum(wCm)} × ${fmtNum(hCm)} سانتی‌متر</small>
        <small style="color:#64748b">عرض و طول جداگانه قابل تنظیم است</small>
      `;
      hudEl.style.left = `${ev.clientX}px`;
      hudEl.style.top = `${ev.clientY}px`;
    };

    updateHud(origScaleX, origScaleY, e);

    const onPointerMove = (ev) => {
      if (!isActiveFloorPointerEvent(ev, e.pointerId)) return;
      const curCanvasX = ev.clientX - canvasRect.left;
      const curCanvasY = ev.clientY - canvasRect.top;

      let newScale = origScale;
      let newScaleX = origScaleX;
      let newScaleY = origScaleY;
      let newXpct = table.x;
      let newYpct = table.y;

      if (ev.altKey) {
        // تغییر اندازه متقارن از مرکز با کلید Alt
        const distCenter = Math.hypot(curCanvasX - origCenterX, curCanvasY - origCenterY);
        const initDist = Math.hypot(origHW, origHH);
        const rawScale = origScale * (distCenter / Math.max(10, initDist));
        newScale = Math.max(0.5, Math.min(3.0, Math.round(rawScale * 20) / 20));
        newScaleX = newScale;
        newScaleY = newScale;
      } else {
        // تغییر اندازه مهندسی CAD با لنگر ثابت در گوشه مقابل
        const vX = curCanvasX - anchorPxX;
        const vY = curCanvasY - anchorPxY;

        // انتقال بردار کرسر به دستگاه مختصات محلی میز
        const localU = vX * cos + vY * sin;
        const localV = -vX * sin + vY * cos;

        // طول امتدادیافته در جهت مجاز
        const directedU = Math.max(15, localU * dirU);
        const directedV = Math.max(15, localV * dirV);

        newScaleX = affectsWidth ? Math.max(0.5, Math.min(3, Math.round((directedU / unscaledW) * 20) / 20)) : origScaleX;
        newScaleY = affectsLength ? Math.max(0.5, Math.min(3, Math.round((directedV / unscaledH) * 20) / 20)) : origScaleY;
        newScale = Math.max(newScaleX, newScaleY);

        // محاسبه مرکز جدید بر مبنای لنگر کاملاً ثابت
        const newHW = (unscaledW * newScaleX) / 2;
        const newHH = (unscaledH * newScaleY) / 2;

        const centerOffsetX = (affectsWidth ? dirU * newHW : 0) * cos - (affectsLength ? dirV * newHH : 0) * sin;
        const centerOffsetY = (affectsWidth ? dirU * newHW : 0) * sin + (affectsLength ? dirV * newHH : 0) * cos;

        const newCenterXpx = anchorPxX + centerOffsetX;
        const newCenterYpx = anchorPxY + centerOffsetY;

        newXpct = Math.max(2, Math.min(98, (newCenterXpx / canvasRect.width) * 100));
        newYpct = Math.max(2, Math.min(98, (newCenterYpx / canvasRect.height) * 100));
      }

      const nextX = Math.round(newXpct * 10) / 10;
      const nextY = Math.round(newYpct * 10) / 10;
      if (Math.abs((Number(table.x) || 0) - nextX) > 0.001 || Math.abs((Number(table.y) || 0) - nextY) > 0.001) commitTablePosition(table, tableEl);
      if (checkpoint(Math.abs(origScaleX - newScaleX) > 0.001 || Math.abs(origScaleY - newScaleY) > 0.001 ||
          Math.abs((Number(table.x) || 0) - nextX) > 0.001 || Math.abs((Number(table.y) || 0) - nextY) > 0.001)) hasMoved = true;
      table.scale = newScale;
      table.scaleX = newScaleX;
      table.scaleY = newScaleY;
      table.x = nextX;
      table.y = nextY;

      // به‌روزرسانی آنی DOM بدون ری‌رندر کل بوم
      const rot = table.rotation || 0;
      tableEl.style.left = `${table.x}%`;
      tableEl.style.top = `${table.y}%`;
      tableEl.style.transform = `translate(-50%, -50%) rotate(${rot}deg) scale(${newScaleX}, ${newScaleY})`;
      tableEl.style.setProperty('--table-scale', newScale);
      tableEl.style.setProperty('--table-label-inverse-x', String(1 / newScaleX));
      tableEl.style.setProperty('--table-label-inverse-y', String(1 / newScaleY));

      updateHud(newScaleX, newScaleY, ev);
    };

    const onPointerUp = (ev) => {
      if (!isActiveFloorPointerEvent(ev, e.pointerId)) return;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      handleEl.classList.remove('is-resizing');
      try { handleEl.releasePointerCapture(ev.pointerId || e.pointerId); } catch {}
      if (hudEl) { hudEl.remove(); hudEl = null; }
      if (isCancelledFloorPointerEvent(ev)) {
        rollbackCancelledLayoutGesture(hasMoved, wasDirtyBeforeGesture);
        return;
      }
      if (hasMoved) debouncedSaveFloor();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  // ─── Zone Resize ─────────────────────────────────────────────────────
  const handleZoneResize = (e, handleEl) => {
    const zoneId = handleEl.dataset.zoneId;
    const handleDir = handleEl.dataset.handle;
    const zone = entitiesForFloor(floorZones, activeFloorId).find((z) => z.id === zoneId);
    if (!zone) return;

    selectedZoneId = zoneId;
    const zoneEl = document.querySelector(`.plan-zone[data-zone-id="${zone.id}"]`);
    if (zoneEl) zoneEl.classList.add('is-resizing');

    const scaleEl = document.getElementById('admin-canvas-scaler') || document.getElementById('admin-floor-canvas');
    if (!scaleEl) return;
    const rect = scaleEl.getBoundingClientRect();
    const startX = e.clientX; const startY = e.clientY;
    const origX = zone.x; const origY = zone.y;
    const origW = zone.w; const origH = zone.h;
    let hasMoved = false;
    const wasDirtyBeforeGesture = isLayoutDirty;
    const checkpoint = createHistoryCheckpoint(pushHistory, setUnsavedStatus);

    handleEl.classList.add('is-resizing');
    try { handleEl.setPointerCapture(e.pointerId); } catch {}

    const onPointerMove = (ev) => {
      if (!isActiveFloorPointerEvent(ev, e.pointerId)) return;
      const dx = ((ev.clientX - startX) / rect.width) * 100;
      const dy = ((ev.clientY - startY) / rect.height) * 100;

      let newX = origX; let newY = origY; let newW = origW; let newH = origH;

      if (handleDir.includes('e')) newW = Math.max(10, Math.min(100 - origX, Math.round((origW + dx) / snapGridStep) * snapGridStep));
      if (handleDir.includes('s')) newH = Math.max(10, Math.min(100 - origY, Math.round((origH + dy) / snapGridStep) * snapGridStep));
      if (handleDir.includes('w')) {
        const maxShift = origW - 10;
        const shift = Math.max(-origX, Math.min(maxShift, Math.round(dx / snapGridStep) * snapGridStep));
        newX = origX + shift; newW = origW - shift;
      }
      if (handleDir.includes('n')) {
        const maxShift = origH - 10;
        const shift = Math.max(-origY, Math.min(maxShift, Math.round(dy / snapGridStep) * snapGridStep));
        newY = origY + shift; newH = origH - shift;
      }

      // Magnetic snapping به zone های مجاور
      entitiesForFloor(floorZones, floorEntityId(zone)).forEach((other) => {
        if (other.id === zone.id) return;
        if (handleDir.includes('e') && Math.abs((newX + newW) - other.x) <= 2) newW = other.x - newX;
        if (handleDir.includes('w') && Math.abs(newX - (other.x + other.w)) <= 2) { const tx = other.x + other.w; newW = (newX + newW) - tx; newX = tx; }
        if (handleDir.includes('s') && Math.abs((newY + newH) - other.y) <= 2) newH = other.y - newY;
        if (handleDir.includes('n') && Math.abs(newY - (other.y + other.h)) <= 2) { const ty = other.y + other.h; newH = (newY + newH) - ty; newY = ty; }
      });

      const nextX = Math.max(0, Math.min(100, Math.round(newX * 10) / 10));
      const nextY = Math.max(0, Math.min(100, Math.round(newY * 10) / 10));
      const nextW = Math.max(8, Math.min(100, Math.round(newW * 10) / 10));
      const nextH = Math.max(8, Math.min(100, Math.round(newH * 10) / 10));
      if (checkpoint(Math.abs((Number(zone.x) || 0) - nextX) > 0.001 || Math.abs((Number(zone.y) || 0) - nextY) > 0.001 ||
          Math.abs((Number(zone.w) || 0) - nextW) > 0.001 || Math.abs((Number(zone.h) || 0) - nextH) > 0.001)) hasMoved = true;
      zone.x = nextX;
      zone.y = nextY;
      zone.w = nextW;
      zone.h = nextH;

      if (zoneEl) {
        zoneEl.style.left = `${zone.x}%`;
        zoneEl.style.top = `${zone.y}%`;
        zoneEl.style.width = `${zone.w}%`;
        zoneEl.style.height = `${zone.h}%`;
      }
    };

    const onPointerUp = (ev) => {
      if (!isActiveFloorPointerEvent(ev, e.pointerId)) return;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      handleEl.classList.remove('is-resizing');
      if (zoneEl) zoneEl.classList.remove('is-resizing');
      try { handleEl.releasePointerCapture(ev.pointerId || e.pointerId); } catch {}
      if (isCancelledFloorPointerEvent(ev)) {
        rollbackCancelledLayoutGesture(hasMoved, wasDirtyBeforeGesture);
        return;
      }
      selectedZoneId = zone.id;
      if (hasMoved) {
        debouncedSaveFloor();
        render();
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  // ─── Smart Guide Lines ───────────────────────────────────────────────
  const _updateSmartGuide = (axis, matchedVal, scaleEl) => {
    const id = axis === 'x' ? 'floor-smart-guide-x' : 'floor-smart-guide-y';
    const cls = `floor-smart-guide floor-smart-guide--${axis}`;
    let guide = document.getElementById(id);
    if (matchedVal !== null) {
      if (!guide && scaleEl) {
        guide = document.createElement('div');
        guide.id = id;
        guide.className = cls;
        scaleEl.appendChild(guide);
      }
      if (guide) {
        guide.style.display = 'block';
        if (axis === 'x') guide.style.left = `${matchedVal}%`;
        else guide.style.top = `${matchedVal}%`;
      }
    } else if (guide) {
      guide.style.display = 'none';
    }
  };

  const _hideSmartGuides = () => {
    const gx = document.getElementById('floor-smart-guide-x');
    const gy = document.getElementById('floor-smart-guide-y');
    if (gx) gx.style.display = 'none';
    if (gy) gy.style.display = 'none';
  };

  // ─── Render Helpers ──────────────────────────────────────────────────
  const renderSvgConnectors = (canvasTables = tables) => {
    let lines = '';
    const canvasTableIds = new Set(canvasTables.map((table) => String(table.id)));
    canvasTables.forEach((t) => {
      if (t.mergedWith && Array.isArray(t.mergedWith)) {
        t.mergedWith.forEach((subId) => {
          const sub = tableById(subId);
          if (sub && canvasTableIds.has(String(sub.id)) && floorEntityId(t) === floorEntityId(sub) && activeFloorId === floorEntityId(t)) {
            lines += `<line x1="${t.x}%" y1="${t.y}%" x2="${sub.x}%" y2="${sub.y}%" class="plan-table-connector-line" stroke="#38bdf8" stroke-width="3" stroke-dasharray="6,4" opacity="0.85" />`;
          }
        });
      }
    });
    return lines;
  };

  const renderRulerTicksX = (totalMeters) => {
    const m = Math.max(10, Math.min(100, Number(totalMeters) || 20));
    let html = '';
    for (let i = 0; i <= m; i += 2) {
      const pct = (i / m) * 100;
      html += `<div class="floor-ruler-tick floor-ruler-tick--x" style="left:${pct.toFixed(1)}%"><span class="floor-ruler-tick__label">${fmtNum(i)}م</span></div>`;
    }
    return html;
  };

  const renderRulerTicksY = (totalMeters) => {
    const m = Math.max(8, Math.min(80, Number(totalMeters) || 15));
    let html = '';
    for (let i = 0; i <= m; i += 2) {
      const pct = (i / m) * 100;
      html += `<div class="floor-ruler-tick floor-ruler-tick--y" style="top:${pct.toFixed(1)}%"><span class="floor-ruler-tick__label">${fmtNum(i)}م</span></div>`;
    }
    return html;
  };

  const renderFixtureItem = (fixture) => {
    const isSelected = selectedFixtureId === fixture.id;
    const isNearTop = Number(fixture.y) < 20;
    const paletteHtml = (isSelected && isEditMode) ? `
      <div class="fixture-floating-palette" data-flip-down="${isNearTop}">
        <button type="button" data-fixture-action="rotate" title="چرخش ۴۵ درجه">↻ ۴۵°</button>
        <button type="button" data-fixture-action="delete" title="حذف سازه" style="color:#f43f5e">🗑️ حذف</button>
        <button type="button" data-fixture-action="close" title="بستن">✕</button>
      </div>` : '';

    return `
      <div class="plan-fixture plan-fixture--${esc(fixture.type)} plan-fixture--${esc(fixture.color || 'slate')} ${isSelected ? 'is-selected' : ''}"
           data-fixture-id="${esc(fixture.id)}"
           style="left:${fixture.x}%; top:${fixture.y}%; width:${fixture.w}%; height:${fixture.h}%; transform: rotate(${fixture.rotation || 0}deg); --fixture-rot: ${fixture.rotation || 0}deg;"
           title="${esc(fixture.name || fixture.type)}">
        <div class="plan-fixture-content">
          <span class="plan-fixture-icon">${esc(fixture.icon || '🏛️')}</span>
          <span class="plan-fixture-label">${esc(fixture.name || '')}</span>
        </div>
        ${paletteHtml}
        ${isEditMode ? `<div class="fixture-handle fixture-handle--se" data-handle="se" data-fixture-id="${esc(fixture.id)}"></div>` : ''}
      </div>`;
  };

  const renderPlanTableItem = (table) => {
    const isSelected = Number(selectedTableId) === Number(table.id) || selectedTableIds.has(Number(table.id));
    const isOutsideActiveZone = activeZone !== 'all' && normalizeTableZoneValue(table.zone, normalizeZone) !== activeZone;
    const shape = table.shape || 'rectangle';
    const tableScaleX = Math.max(0.5, Number(table.scaleX ?? table.scale) || 1);
    const tableScaleY = Math.max(0.5, Number(table.scaleY ?? table.scale) || 1);
    const seats = normalizeSeatCapacity(table.seats);
    const chairModel = table.chairModel || (shape === 'bar_stool' || shape === 'wall_counter' ? 'bar_stool' : shape === 'lounge_takht' ? 'bolster' : 'standard');
    const chairClass = `plan-chair plan-chair--${chairModel}`;
    let chairsHtml = '';

    if (shape === 'conference') {
      // Large Executive Conference / Banquet Table: 2 Head Chairs (left & right) + top & bottom rows
      if (seats >= 2) {
        chairsHtml += `<div class="${chairClass} plan-chair--head" style="left:-14px;top:50%;transform:translateY(-50%);width:9px;height:26px;border-radius:5px 2px 2px 5px" title="صندلی صدر"></div>`;
        chairsHtml += `<div class="${chairClass} plan-chair--head" style="right:-14px;top:50%;transform:translateY(-50%);width:9px;height:26px;border-radius:2px 5px 5px 2px" title="صندلی ذیل"></div>`;
      }
      const sideSeats = Math.max(0, seats - 2);
      const topCount = Math.ceil(sideSeats / 2);
      const botCount = sideSeats - topCount;
      for (let i = 0; i < topCount; i++) {
        const xPos = topCount === 1 ? 50 : 14 + (i * (72 / (topCount - 1)));
        chairsHtml += `<div class="${chairClass}" style="top:-14px;left:${xPos.toFixed(1)}%;transform:translateX(-50%);width:26px;height:10px;border-radius:6px 6px 3px 3px"></div>`;
      }
      for (let i = 0; i < botCount; i++) {
        const xPos = botCount === 1 ? 50 : 14 + (i * (72 / (botCount - 1)));
        chairsHtml += `<div class="${chairClass}" style="bottom:-14px;left:${xPos.toFixed(1)}%;transform:translateX(-50%);width:26px;height:10px;border-radius:3px 3px 6px 6px"></div>`;
      }
    } else if (shape === 'semi_circle') {
      // Half-moon / semi-circular table with outer banquette arc
      chairsHtml += `<div class="plan-semicircle-cushion"></div>`;
      for (let i = 0; i < seats; i++) {
        const angle = (Math.PI / (seats + 1)) * (i + 1);
        const rx = 52;
        const ry = 44;
        const left = 50 - rx * Math.cos(angle);
        const top = 30 + ry * Math.sin(angle);
        const deg = (angle * 180 / Math.PI) - 90;
        chairsHtml += `<div class="${chairClass}" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%;transform:translate(-50%,-50%) rotate(${deg.toFixed(1)}deg);width:24px;height:10px;border-radius:5px"></div>`;
      }
    } else if (shape === 'wall_counter') {
      // Wall-mounted bar counter: single-sided seating facing counter
      for (let i = 0; i < seats; i++) {
        const xPos = seats === 1 ? 50 : 14 + (i * (72 / (seats - 1)));
        chairsHtml += `<div class="${chairClass}" style="bottom:-15px;left:${xPos.toFixed(1)}%;transform:translateX(-50%);width:20px;height:20px;border-radius:50%"></div>`;
      }
    } else if (shape === 'round_booth') {
      chairsHtml += `<div class="plan-roundbooth-cushion"></div>`;
      for (let i = 0; i < seats; i++) {
        const angle = (1.5 * Math.PI / Math.max(1, seats - 1 || 1)) * i - (1.25 * Math.PI);
        const radius = 48;
        const left = 50 + radius * Math.cos(angle);
        const top = 50 + radius * Math.sin(angle);
        const deg = (angle * 180 / Math.PI) + 90;
        chairsHtml += `<div class="${chairClass}" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%;transform:translate(-50%,-50%) rotate(${deg.toFixed(1)}deg);width:22px;height:9px;border-radius:5px"></div>`;
      }
    } else if (shape === 'circle') {
      for (let i = 0; i < seats; i++) {
        const angle = (2 * Math.PI / seats) * i - (Math.PI / 2);
        const r = 56;
        const left = 50 + r * Math.cos(angle);
        const top = 50 + r * Math.sin(angle);
        const deg = (angle * 180 / Math.PI) + 90;
        chairsHtml += `<div class="${chairClass}" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%;transform:translate(-50%,-50%) rotate(${deg.toFixed(1)}deg);width:22px;height:10px;border-radius:5px"></div>`;
      }
    } else if (shape === 'square') {
      const perSide = Math.ceil(seats / 4);
      for (let s = 0; s < 4; s++) {
        for (let i = 0; i < perSide && (s * perSide + i) < seats; i++) {
          const pos = i / Math.max(1, perSide - 1);
          const pct = 20 + pos * 60;
          if (s === 0) chairsHtml += `<div class="${chairClass}" style="top:-14px;left:${pct}%;transform:translateX(-50%);width:22px;height:10px;border-radius:6px 6px 3px 3px"></div>`;
          else if (s === 1) chairsHtml += `<div class="${chairClass}" style="bottom:-14px;left:${pct}%;transform:translateX(-50%);width:22px;height:10px;border-radius:3px 3px 6px 6px"></div>`;
          else if (s === 2) chairsHtml += `<div class="${chairClass}" style="left:-14px;top:${pct}%;transform:translateY(-50%);width:10px;height:22px;border-radius:6px 3px 3px 6px"></div>`;
          else chairsHtml += `<div class="${chairClass}" style="right:-14px;top:${pct}%;transform:translateY(-50%);width:10px;height:22px;border-radius:3px 6px 6px 3px"></div>`;
        }
      }
    } else if (shape === 'booth') {
      chairsHtml += `<div class="plan-booth-cushion plan-booth-cushion--top"></div><div class="plan-booth-cushion plan-booth-cushion--bottom"></div>`;
    } else if (shape === 'bar_stool') {
      for (let i = 0; i < seats; i++) {
        const offset = seats === 1 ? 50 : 18 + (i * (64 / (seats - 1)));
        chairsHtml += `<div class="${chairClass} plan-chair--stool" style="bottom:-16px;left:${offset}%;transform:translateX(-50%);width:18px;height:18px;border-radius:50%"></div>`;
      }
    } else if (shape === 'oval') {
      for (let i = 0; i < seats; i++) {
        const angle = (2 * Math.PI / seats) * i - (Math.PI / 2);
        const rx = 56; const ry = 46;
        const left = 50 + rx * Math.cos(angle);
        const top = 50 + ry * Math.sin(angle);
        const deg = (angle * 180 / Math.PI) + 90;
        chairsHtml += `<div class="${chairClass}" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%;transform:translate(-50%,-50%) rotate(${deg.toFixed(1)}deg);width:24px;height:10px;border-radius:5px"></div>`;
      }
    } else if (shape === 'lounge_takht') {
      chairsHtml = `
        <div class="plan-takht-rug"></div>
        <div class="plan-takht-cushion plan-takht-cushion--n" title="پشتی سنتی"></div>
        <div class="plan-takht-cushion plan-takht-cushion--s" title="پشتی سنتی"></div>
        <div class="plan-takht-cushion plan-takht-cushion--e" title="پشتی سنتی"></div>
        <div class="plan-takht-cushion plan-takht-cushion--w" title="پشتی سنتی"></div>
      `;
    } else {
      if (seats <= 2) {
        chairsHtml += `<div class="${chairClass}" style="top:-14px;left:50%;transform:translateX(-50%);width:34px;height:10px;border-radius:6px 6px 3px 3px"></div>`;
        if (seats === 2) chairsHtml += `<div class="${chairClass}" style="bottom:-14px;left:50%;transform:translateX(-50%);width:34px;height:10px;border-radius:3px 3px 6px 6px"></div>`;
      } else {
        const half = Math.ceil(seats / 2);
        const otherHalf = seats - half;
        for (let i = 0; i < half; i++) {
          const xPos = half === 1 ? 50 : 16 + (i * (68 / (half - 1)));
          chairsHtml += `<div class="${chairClass}" style="top:-14px;left:${xPos.toFixed(1)}%;transform:translateX(-50%);width:26px;height:10px;border-radius:6px 6px 3px 3px"></div>`;
        }
        for (let i = 0; i < otherHalf; i++) {
          const xPos = otherHalf === 1 ? 50 : 16 + (i * (68 / (otherHalf - 1)));
          chairsHtml += `<div class="${chairClass}" style="bottom:-14px;left:${xPos.toFixed(1)}%;transform:translateX(-50%);width:26px;height:10px;border-radius:3px 3px 6px 6px"></div>`;
        }
      }
    }

    const sharedSeatLayout = window.WestoFloorChairLayout?.layout({ shape, seats, chairModel, chairScale: table.chairScale });
    if (sharedSeatLayout) chairsHtml = sharedSeatLayout.markup;

    const timerHtml = table.serviceEndsAt && !table.autoReleased && ['busy', 'attention'].includes(table.state)
      ? `<time class="plan-table-timer" data-service-ends="${esc(table.serviceEndsAt)}">${floorCountdownLabel(table.serviceEndsAt)}</time>` : '';

    const isMergedParent = table.mergedWith && Array.isArray(table.mergedWith) && table.mergedWith.length > 0;
    const isMergedSub = Boolean(table.mergedInto);
    let mergeBadgeHtml = '';
    if (isMergedParent) {
      mergeBadgeHtml = `<span class="plan-table-merge-badge" title="میز والد ادغام‌شده">🔗 ادغام (${fmtNum(table.mergedWith.length + 1)} میز)</span>`;
    } else if (isMergedSub) {
      mergeBadgeHtml = `<span class="plan-table-merge-badge is-sub" title="میز فرعی پیوندخورده">🔗 متصل به میز ${esc(table.mergedInto)}</span>`;
    }

    const existingZones = Array.from(new Set([
      ...entitiesForFloor(floorZones, activeFloorId).map((zone) => normalizeZone(zone.name)),
      ...entitiesForFloor(tables, activeFloorId).map((item) => normalizeTableZoneValue(item.zone, normalizeZone)),
    ].filter(Boolean)));
    const zoneOptions = existingZones.map((z) => `<option value="${esc(z)}" ${normalizeTableZoneValue(table.zone, normalizeZone) === z ? 'selected' : ''}>${esc(z)}</option>`).join('');

    const isNearTop = Number(table.y) < 22;
    const isNearLeft = Number(table.x) < 25;
    const isNearRight = Number(table.x) > 75;
    const alignX = isNearLeft ? 'left' : isNearRight ? 'right' : 'center';
    const suggestedPositionHtml = table._floorStudioSuggestedPosition
      ? '<span class="floor-table-position-status" title="مختصات ثبت‌شده ندارند؛ جایگاه نشان‌داده‌شده موقت است و تا جانمایی اپراتور ذخیره نمی‌شود" style="display:block;margin-top:2px;color:#fbbf24;font-size:10px">جانمایی پیشنهادی، ذخیره‌نشده</span>'
      : '';

    const isMerged = isMergedParent || isMergedSub;
    const paletteHtml = (isSelected && isEditMode && Number(selectedTableId) === Number(table.id)) ? `
      <div class="table-floating-palette" data-flip-down="${isNearTop}" data-align-x="${alignX}" data-palette-for="${table.id}">
        <div class="table-palette-cluster table-palette-cluster--seats">
          <button type="button" class="palette-mini-btn" data-table-action="dec-seats" title="کاهش صندلی (-)">−</button>
          <span class="palette-seats-badge" title="تعداد صندلی‌ها">${fmtNum(seats)} صندلی</span>
          <button type="button" class="palette-mini-btn" data-table-action="inc-seats" title="افزایش صندلی (+)">＋</button>
        </div>
        <div class="table-palette-cluster table-palette-cluster--scale" title="تنظیم مقیاس و اندازه مهندسی میز">
          <button type="button" class="palette-mini-btn" data-table-action="dec-scale" title="کوچک‌کردن ابعاد میز (−)">−</button>
          <span class="palette-seats-badge" title="ضریب مقیاس میز">${(Number(table.scale) || 1).toFixed(1)}×</span>
          <button type="button" class="palette-mini-btn" data-table-action="inc-scale" title="بزرگ‌کردن ابعاد میز (＋)">＋</button>
        </div>
        <button type="button" class="palette-studio-btn" data-table-action="furniture-modal" title="استودیوی مبلمان">
          <span>${shapeIcon(shape)} ${shapeTitle(shape)}</span>
          <span class="palette-chair-tag" title="مدل صندلی: ${chairLabel(chairModel)}">${chairIcon(chairModel)}</span>
        </button>
        <button type="button" class="palette-btn" data-table-action="rotate" title="چرخش ۴۵ درجه">↻ ۴۵°</button>
        <select data-table-action="zone-select" title="بخش سالن" style="background:#1e293b;border:1px solid rgba(255,255,255,0.15);color:#f8fafc;padding:3px 6px;border-radius:8px;font-size:11px;font-weight:700">
          ${zoneOptions}
        </select>
        <button type="button" class="palette-btn" data-table-action="toggle-shape" title="چرخش فرم هندسی">⊞ فرم</button>
        <div class="palette-more-wrapper">
          <button type="button" class="palette-btn palette-btn--more" data-table-action="toggle-more" title="عملیات بیشتر" aria-expanded="false" aria-controls="palette-more-menu-${table.id}">⋯</button>
          <div class="palette-more-menu" id="palette-more-menu-${table.id}" role="menu" style="display:none;">
            <button type="button" role="menuitem" data-table-action="toggle-active" style="color:${table.active !== false ? '#34d399' : '#94a3b8'}">
              ${table.active !== false ? '🟢 میز فعال است' : '⚪ میز خاموش است'}
            </button>
            <button type="button" role="menuitem" data-table-action="rename">✏️ تغییر نام و کد میز</button>
            <button type="button" role="menuitem" data-table-action="merge" style="color:${isMerged ? '#fbbf24' : '#38bdf8'}">
              ${isMerged ? '🔗 تفکیک پیوند' : '🔗 ادغام میزها'}
            </button>
            <button type="button" role="menuitem" data-table-action="move-floor">🏢 انتقال به طبقه</button>
            <button type="button" role="menuitem" data-table-action="duplicate" style="color:#38bdf8">⧉ کپی میز</button>
            <button type="button" role="menuitem" class="is-delete" data-table-action="delete" style="color:#f43f5e">🗑️ حذف این میز</button>
          </div>
        </div>
        <button type="button" data-table-action="close" title="بستن پالت" style="background:transparent;border:none;color:#94a3b8;font-size:13px;padding:2px 6px;cursor:pointer">✕</button>
      </div>` : '';

    return `
      <div class="plan-table plan-table--${esc(shape)} ${isSelected ? 'is-selected' : ''} ${isOutsideActiveZone ? 'is-zone-muted' : ''} ${isMergedParent ? 'is-merged-parent' : ''} ${isMergedSub ? 'is-merged-sub' : ''}"
           data-table="${esc(table.id)}"
           role="button" tabindex="0"
           data-state="${esc(table.state || (table.active === false ? 'inactive' : 'available'))}"
           data-seats="${seats}"
           ${table.autoReleased ? 'data-auto-released="true"' : ''}
           style="left:${table.x}%; top:${table.y}%; transform: translate(-50%, -50%) rotate(${table.rotation || 0}deg) scale(${tableScaleX}, ${tableScaleY}); --table-rot: ${table.rotation || 0}deg; --table-scale: ${table.scale || 1}; --chair-scale: ${table.chairScale || 1}; --table-label-inverse-x: ${1 / tableScaleX}; --table-label-inverse-y: ${1 / tableScaleY};"
           title="${esc(tableTitle(table))} — ${esc(table.stateLabel || 'آزاد')}${table._floorStudioSuggestedPosition ? ' — جانمایی پیشنهادی، ذخیره‌نشده' : ''}"
           aria-label="${esc(tableTitle(table))} — ${esc(table.stateLabel || 'آزاد')}، ${fmtNum(seats)} صندلی${table._floorStudioSuggestedPosition ? '، جانمایی نشده' : ''}">
        ${chairsHtml}
        <div class="plan-table-surface">
          <div class="plan-table-label">
            <span class="plan-table-number">${esc(tableTitle(table))}</span>
            <span class="plan-table-meta">${fmtNum(seats)} نفر · ${esc(normalizeTableZoneValue(table.zone, normalizeZone))}</span>
            ${suggestedPositionHtml}
            ${mergeBadgeHtml}
            ${timerHtml}
          </div>
        </div>
        ${paletteHtml}
        ${isEditMode && isSelected ? `
          <div class="table-resize-handle table-resize-handle--nw" data-resize-corner="nw" data-table-resize="${esc(table.id)}"></div>
          <div class="table-resize-handle table-resize-handle--ne" data-resize-corner="ne" data-table-resize="${esc(table.id)}"></div>
          <div class="table-resize-handle table-resize-handle--sw" data-resize-corner="sw" data-table-resize="${esc(table.id)}"></div>
          <div class="table-resize-handle table-resize-handle--se" data-resize-corner="se" data-table-resize="${esc(table.id)}"></div>
          <div class="table-resize-handle table-resize-handle--n" data-resize-corner="n" title="تغییر طول میز" data-table-resize="${esc(table.id)}"></div>
          <div class="table-resize-handle table-resize-handle--s" data-resize-corner="s" title="تغییر طول میز" data-table-resize="${esc(table.id)}"></div>
          <div class="table-resize-handle table-resize-handle--e" data-resize-corner="e" title="تغییر عرض میز" data-table-resize="${esc(table.id)}"></div>
          <div class="table-resize-handle table-resize-handle--w" data-resize-corner="w" title="تغییر عرض میز" data-table-resize="${esc(table.id)}"></div>` : ''}
      </div>`;
  };

  // ─── Main Render ─────────────────────────────────────────────────────
  const render = () => {
    if (!isCurrentStudio()) return;
    if (currentView === 'cards' && cardsViewAvailable) { renderCardsView(); }
    else { renderMapView(); }
  };

  const renderMapView = () => {
    const currentFloorConfigured = floorExists(floorLevels, activeFloorId);
    const canEditCurrentFloor = isEditMode && currentFloorConfigured;
    const showUnassignedFloor = hasUnassignedFloorEntities(tables, floorZones, floorFixtures);
    const currentFloorTables = entitiesForFloor(tables, activeFloorId);
    const currentFloorZones = entitiesForFloor(floorZones, activeFloorId);
    const tableZoneNames = currentFloorTables.map((table) => normalizeTableZoneValue(table.zone, normalizeZone));
    const allZonesList = Array.from(new Set([
      ...currentFloorZones.map((zone) => normalizeZone(zone.name)),
      ...tableZoneNames,
    ].filter(Boolean)));
    const zonesList = ['all', ...allZonesList];
    const zoneTitle = (z) => ({ all: 'همهٔ داده‌های این طبقه', 'بدون بخش': 'بدون بخش' }[z] || z);

    let visibleTables = activeZone === 'all'
      ? currentFloorTables
      : currentFloorTables.filter((t) => normalizeTableZoneValue(t.zone, normalizeZone) === activeZone);
    if (tableSearchQuery && tableSearchQuery.trim()) {
      const q = normalizeFloorTableReference(tableSearchQuery);
      visibleTables = visibleTables.filter((t) => {
        const title = normalizeFloorTableReference(tableTitle(t));
        const idStr = normalizeFloorTableReference(t.id);
        const zoneStr = normalizeFloorTableReference(normalizeTableZoneValue(t.zone, normalizeZone));
        return title.includes(q) || idStr.includes(q) || zoneStr.includes(q);
      });
    }
    const visibleFixtures = entitiesForFloor(floorFixtures, activeFloorId);
    const focusedZone = activeZone === 'all' ? null : currentFloorZones.find((zone) => normalizeZone(zone.name) === activeZone);
    const canvasTables = activeZone === 'all'
      ? currentFloorTables
      : currentFloorTables.filter((table) => normalizeTableZoneValue(table.zone, normalizeZone) === activeZone);
    const canvasFixtures = activeZone === 'all' ? (isEditMode || showOverviewFixtures ? visibleFixtures : []) : focusedZone
      ? visibleFixtures.filter((fixture) => {
          const centerX = Number(fixture.x) + Number(fixture.w || 0) / 2;
          const centerY = Number(fixture.y) + Number(fixture.h || 0) / 2;
          return centerX >= focusedZone.x && centerX <= focusedZone.x + focusedZone.w
            && centerY >= focusedZone.y && centerY <= focusedZone.y + focusedZone.h;
        })
      : [];
    const outsideZoneCount = focusedZone
      ? canvasTables.filter((table) => !isTableInsideZone(table, focusedZone)).length
      : 0;
    const zoneMembershipChanges = planFloorZoneMembershipSync(currentFloorTables, currentFloorZones, activeFloorId, normalizeZone);
    const canUseStarterTemplate = currentFloorConfigured && isFloorLayoutEmpty({
      tables: currentFloorTables, zones: currentFloorZones, fixtures: visibleFixtures,
    });
    const firstFloorNoticeHtml = floorLevels.length === 0 ? `
      <aside class="floor-first-setup" role="status">
        <div><strong>هنوز طبقه‌ای برای این شعبه ثبت نشده است</strong><span>برای شروع، یک طبقهٔ واقعی بسازید. میزهای ثبت‌شدهٔ بدون طبقه حفظ می‌شوند.</span></div>
        <button type="button" class="btn btn-sm btn-primary" id="map-create-first-floor">＋ تعریف اولین طبقه</button>
      </aside>` : '';

    const busyCount = canvasTables.filter((t) => t.state === 'busy').length;
    const attnCount = canvasTables.filter((t) => t.state === 'attention').length;
    const freeCount = canvasTables.filter((t) => t.state === 'available' || !t.state).length;

    const renderedZonesHtml = currentFloorZones.map((z) => {
      if (activeZone !== 'all' && normalizeZone(z.name) !== activeZone) return '';
      const legacyClass = z.id === 'zone-main' ? 'plan-zone--main' : z.id === 'zone-terrace' ? 'plan-zone--terrace' : z.id === 'zone-vip' ? 'plan-zone--vip' : 'plan-zone--custom';
      const themeClass = `plan-zone--${z.color || 'blue'}`;
      const zoneTables = currentFloorTables.filter((t) => normalizeTableZoneValue(t.zone, normalizeZone) === normalizeZone(z.name));
      const isSharedE = currentFloorZones.some((o) => o.id !== z.id && Math.abs(o.x - (z.x + z.w)) <= 3.5 && Math.max(z.y, o.y) < Math.min(z.y + z.h, o.y + o.h));
      const isSharedW = currentFloorZones.some((o) => o.id !== z.id && Math.abs((o.x + o.w) - z.x) <= 3.5 && Math.max(z.y, o.y) < Math.min(z.y + z.h, o.y + o.h));
      const isSharedS = currentFloorZones.some((o) => o.id !== z.id && Math.abs(o.y - (z.y + z.h)) <= 3.5 && Math.max(z.x, o.x) < Math.min(z.x + z.w, o.x + o.w));
      const isSharedN = currentFloorZones.some((o) => o.id !== z.id && Math.abs((o.y + o.h) - z.y) <= 3.5 && Math.max(z.x, o.x) < Math.min(z.x + z.w, o.x + o.w));
      const styleAttr = `left:${z.x}%; top:${z.y}%; width:${z.w}%; height:${z.h}%;`;

      const headerContent = `
        <div class="plan-zone__header">
          <div class="plan-zone__tag-group">
            <span class="plan-zone__tag">${esc(z.icon || '🏷️')} ${esc(z.name)}</span>
            <span class="plan-zone__count-badge">${fmtNum(zoneTables.length)} میز</span>
          </div>
          ${(isEditMode && studioMode === 'architecture' && selectedZoneId === z.id) ? `
            <div class="plan-zone__actions">
              <button type="button" class="plan-zone__act-btn" data-zone-action="dimensions" data-zone-id="${esc(z.id)}" title="تنظیم ابعاد و متراژ">ابعاد</button>
              <button type="button" class="plan-zone__act-btn" data-zone-action="rename" data-zone-id="${esc(z.id)}" title="تغییر نام بخش">نام</button>
              <button type="button" class="plan-zone__act-btn" data-zone-action="color" data-zone-id="${esc(z.id)}" title="تغییر رنگ بخش">رنگ</button>
              <button type="button" class="plan-zone__act-btn" data-zone-action="split" data-zone-id="${esc(z.id)}" title="تقسیم بخش">تقسیم</button>
              <button type="button" class="plan-zone__act-btn is-delete" data-zone-action="delete" data-zone-id="${esc(z.id)}" title="حذف بخش">حذف</button>
            </div>` : ''}
        </div>`;

      const handles = isEditMode ? `
        <div class="zone-handle zone-handle--n ${isSharedN ? 'is-shared' : ''}" data-handle="n" data-zone-id="${esc(z.id)}"></div>
        <div class="zone-handle zone-handle--s ${isSharedS ? 'is-shared' : ''}" data-handle="s" data-zone-id="${esc(z.id)}"></div>
        <div class="zone-handle zone-handle--e ${isSharedE ? 'is-shared' : ''}" data-handle="e" data-zone-id="${esc(z.id)}"></div>
        <div class="zone-handle zone-handle--w ${isSharedW ? 'is-shared' : ''}" data-handle="w" data-zone-id="${esc(z.id)}"></div>
        <div class="zone-handle zone-handle--nw" data-handle="nw" data-zone-id="${esc(z.id)}"></div>
        <div class="zone-handle zone-handle--ne" data-handle="ne" data-zone-id="${esc(z.id)}"></div>
        <div class="zone-handle zone-handle--se" data-handle="se" data-zone-id="${esc(z.id)}"></div>
        <div class="zone-handle zone-handle--sw" data-handle="sw" data-zone-id="${esc(z.id)}"></div>` : '';

      return `
        <div class="plan-zone plan-zone--interactive ${legacyClass} ${themeClass} is-zone-focused ${selectedZoneId === z.id ? 'is-selected' : ''} ${isSharedE ? 'has-shared-e' : ''} ${isSharedW ? 'has-shared-w' : ''} ${isSharedS ? 'has-shared-s' : ''} ${isSharedN ? 'has-shared-n' : ''}"
             data-zone-id="${esc(z.id)}"
             data-zone-name="${esc(z.name)}"
             style="${styleAttr}touch-action:${isEditMode && studioMode === 'architecture' ? 'none' : 'auto'};">
          ${headerContent}
          ${handles}
        </div>`;
    }).join('');

    // Inspector drawer (live mode)
    const inspectorTable = (!isEditMode && selectedTableId) ? tableById(selectedTableId) : null;
    let inspectorHtml = '';
    if (inspectorTable) {
      const stateClass = inspectorTable.state || 'available';
      const stateLabel = inspectorTable.stateLabel || (inspectorTable.active === false ? 'غیرفعال' : 'آزاد');
      const isBusy = stateClass === 'busy';
      const isAttn = stateClass === 'attention';
      const timerStr = isBusy && inspectorTable.serviceEndsAt ? floorCountdownLabel(inspectorTable.serviceEndsAt) : null;
      inspectorHtml = `
        <div class="floor-table-inspector" id="floor-inspector-card">
          <div class="floor-table-inspector__head">
            <h4 class="floor-table-inspector__title">
              <span>${esc(tableTitle(inspectorTable))}</span>
              <span class="floor-table-inspector__badge is-${esc(stateClass)}">${esc(stateLabel)}</span>
            </h4>
            <button type="button" class="floor-table-inspector__close" id="floor-inspector-close" title="بستن">✕</button>
          </div>
          <div class="floor-table-inspector__body">
            <div class="floor-table-inspector__row"><span>بخش سالن:</span><strong>${esc(normalizeTableZoneValue(inspectorTable.zone, normalizeZone))}</strong></div>
            <div class="floor-table-inspector__row"><span>ظرفیت پذیرایی:</span><strong>${fmtNum(inspectorTable.seats || 4)} نفر</strong></div>
            <div class="floor-table-inspector__row"><span>وضعیت سفارش:</span><strong>${isBusy ? (inspectorTable.serviceOrderId ? `سفارش #${inspectorTable.serviceOrderId}` : 'مشغول سرویس') : isAttn ? '⚠️ فراخوان گارسون' : 'آزاد برای پذیرش'}</strong></div>
            ${timerStr ? `<div class="floor-table-inspector__row"><span>زمان سرویس باقیمانده:</span><strong dir="ltr" style="color:#38bdf8">${timerStr}</strong></div>` : ''}
          </div>
          <div class="floor-table-inspector__actions">
            ${isAttn ? `<button type="button" class="floor-table-inspector__btn floor-table-inspector__btn--resolve" id="floor-inspector-resolve">✓ ثبت رسیدگی و بستن فراخوان</button>` : ''}
            <a class="floor-table-inspector__btn" href="${esc(qrAssetUrl(inspectorTable, { download: true }))}" download="westo-table-${inspectorTable.id}.png">🔲 دانلود رمزینه QR</a>
            <a class="floor-table-inspector__btn" href="${esc(tableDestination(inspectorTable))}" target="_blank" rel="noopener">📱 مشاهده منوی دیجیتال این میز</a>
            ${currentFloorConfigured ? '<button type="button" class="floor-table-inspector__btn" id="floor-inspector-switch-edit">ویرایش چیدمان این میز</button>' : '<p class="floor-inspector-note">این میز هنوز به طبقه‌ای وصل نیست. برای ویرایش مکان، ابتدا طبقهٔ آن را در تنظیمات چیدمان تعیین کنید.</p>'}
          </div>
        </div>`;
    }

    const mobileEditorTable = (isEditMode && selectedTableId) ? tableById(selectedTableId) : null;
    const mobileEditorHtml = mobileEditorTable ? `
      <section class="floor-mobile-table-editor" id="floor-mobile-table-editor" data-table-id="${esc(mobileEditorTable.id)}" aria-label="ویرایش ${esc(tableTitle(mobileEditorTable))}">
        <div class="floor-mobile-table-editor__head">
          <div>
            <small>ویرایش سریع میز</small>
            <strong>${esc(tableTitle(mobileEditorTable))}</strong>
          </div>
          <button type="button" data-mobile-table-action="close" aria-label="بستن ویرایش میز">✕</button>
        </div>
        <div class="floor-mobile-table-editor__grid">
          <div class="floor-mobile-table-editor__stepper" aria-label="تعداد صندلی">
            <button type="button" data-mobile-table-action="dec-seats" aria-label="کاهش صندلی">−</button>
            <span><b>${fmtNum(mobileEditorTable.seats || 4)}</b> صندلی</span>
            <button type="button" data-mobile-table-action="inc-seats" aria-label="افزایش صندلی">＋</button>
          </div>
          <div class="floor-mobile-table-editor__stepper" aria-label="عرض میز">
            <button type="button" data-mobile-table-action="dec-width" aria-label="کم کردن عرض">−</button>
            <span><b>${(Number(mobileEditorTable.scaleX ?? mobileEditorTable.scale) || 1).toFixed(1)}×</b> عرض</span>
            <button type="button" data-mobile-table-action="inc-width" aria-label="زیاد کردن عرض">＋</button>
          </div>
          <div class="floor-mobile-table-editor__stepper" aria-label="طول میز">
            <button type="button" data-mobile-table-action="dec-length" aria-label="کم کردن طول">−</button>
            <span><b>${(Number(mobileEditorTable.scaleY ?? mobileEditorTable.scale) || 1).toFixed(1)}×</b> طول</span>
            <button type="button" data-mobile-table-action="inc-length" aria-label="زیاد کردن طول">＋</button>
          </div>
          <button type="button" class="floor-mobile-table-editor__action" data-mobile-table-action="furniture-modal">${shapeIcon(mobileEditorTable.shape)} انتخاب میز و صندلی</button>
          <button type="button" class="floor-mobile-table-editor__action" data-mobile-table-action="rotate">↻ چرخش ۴۵ درجه</button>
          <label class="floor-mobile-table-editor__zone">
            <span>بخش سالن</span>
            <select data-mobile-table-action="zone-select">
              ${allZonesList.map((z) => `<option value="${esc(z)}" ${normalizeTableZoneValue(mobileEditorTable.zone, normalizeZone) === z ? 'selected' : ''}>${esc(zoneTitle(z))}</option>`).join('')}
            </select>
          </label>
          <div class="floor-mobile-table-editor__history" role="group" aria-label="تاریخچه تغییرات">
            <button type="button" data-mobile-table-action="undo" ${layoutHistory.undoCount === 0 ? 'disabled' : ''}>↩ بازگشت</button>
            <button type="button" data-mobile-table-action="redo" ${layoutHistory.redoCount === 0 ? 'disabled' : ''}>↪ بازانجام</button>
          </div>
          <button type="button" class="floor-mobile-table-editor__done" data-mobile-table-action="save-exit">✓ ذخیره و پایان ویرایش</button>
        </div>
      </section>` : '';

    const batchToolbarHtml = (isEditMode && selectedTableIds.size > 1) ? `
      <div class="floor-batch-toolbar" id="admin-batch-toolbar">
        <div class="floor-batch-toolbar__info"><span>${fmtNum(selectedTableIds.size)} میز انتخاب شده</span></div>
        <div class="floor-batch-toolbar__group">
          <span class="floor-batch-toolbar__label">تراز:</span>
          <button type="button" class="floor-batch-toolbar__btn" data-batch-act="align-left" title="تراز از لبه چپ">⇤ چپ</button>
          <button type="button" class="floor-batch-toolbar__btn" data-batch-act="align-center-x" title="تراز از مرکز افقی">⤹ وسط</button>
          <button type="button" class="floor-batch-toolbar__btn" data-batch-act="align-right" title="تراز از لبه راست">⇥ راست</button>
          <button type="button" class="floor-batch-toolbar__btn" data-batch-act="align-top" title="تراز از بالا">⤒ بالا</button>
          <button type="button" class="floor-batch-toolbar__btn" data-batch-act="align-center-y" title="تراز از مرکز عمودی">⤸ وسط</button>
          <button type="button" class="floor-batch-toolbar__btn" data-batch-act="align-bottom" title="تراز از پایین">⤓ پایین</button>
        </div>
        <div class="floor-batch-toolbar__group">
          <span class="floor-batch-toolbar__label">فاصله:</span>
          <button type="button" class="floor-batch-toolbar__btn" data-batch-act="distribute-h" title="توزیع مساوی افقی">⇔ افقی</button>
          <button type="button" class="floor-batch-toolbar__btn" data-batch-act="distribute-v" title="توزیع مساوی عمودی">⇕ عمودی</button>
        </div>
        <div class="floor-batch-toolbar__group">
          <button type="button" class="floor-batch-toolbar__btn floor-batch-toolbar__btn--primary" data-batch-act="batch-merge" title="ادغام میزها">🔗 ادغام میزها</button>
          <button type="button" class="floor-batch-toolbar__btn floor-batch-toolbar__btn--danger" data-batch-act="batch-delete" title="حذف میزهای انتخاب‌شده">🗑️ حذف</button>
          <button type="button" class="floor-batch-toolbar__btn" data-batch-act="batch-clear" title="لغو انتخاب">✕</button>
        </div>
      </div>` : '';

    const currentActiveZoneObj = focusedZone;

    main.innerHTML = `
      <div class="admin-floor-page floor-simple floor-studio-v2 ${isEditMode ? 'is-edit-mode' : 'is-live-mode'} ${isEditMode ? (studioMode === 'architecture' ? 'is-architecture-mode' : 'is-furniture-mode') : 'is-live-mode'}">
        <!-- ═══ Top Studio Command Bar ═══ -->
        <header class="floor-studio-header">
          <div class="floor-studio-header__left">
            <div class="floor-studio-branding">
              <span class="floor-studio-badge">WESTO ARCHITECTURAL STUDIO</span>
              <h1 class="floor-studio-title">نقشه و چیدمان سالن</h1>
            </div>

            <!-- Floor Levels Switcher Pills -->
            <div class="floor-levels-pills-bar" role="tablist" aria-label="مدیریت و انتخاب طبقات">
              ${floorLevels.map((fl) => `
                <button type="button" class="floor-level-pill ${activeFloorId === fl.id ? 'is-active' : ''}" data-floor-pill="${esc(fl.id)}">
                  <span class="floor-level-pill__icon">${esc(fl.icon || '🏛️')}</span>
                  <span class="floor-level-pill__name">${esc(fl.name)}</span>
                  <span class="floor-level-pill__count">${fmtNum(entitiesForFloor(tables, fl.id).length)}</span>
                  ${floorLevels.length > 1 ? `<span class="floor-level-pill__settings" data-edit-floor-pill="${esc(fl.id)}" title="تنظیمات طبقه">⚙️</span>` : ''}
                </button>`).join('')}
              ${showUnassignedFloor ? `
                <button type="button" class="floor-level-pill floor-level-pill--unassigned ${activeFloorId === UNASSIGNED_FLOOR_ID ? 'is-active' : ''}" data-floor-pill="${UNASSIGNED_FLOOR_ID}" aria-label="بدون طبقه">
                  <span class="floor-level-pill__icon">⌖</span>
                  <span class="floor-level-pill__name">بدون طبقه</span>
                </button>` : ''}
              ${isEditMode ? `
                <button type="button" class="floor-level-pill floor-level-pill--add" id="map-add-floor" title="تعریف طبقه یا فضای جدید" ${isEditMode ? '' : 'disabled'}>
                  <span>＋ افزودن طبقه</span>
                </button>` : ''}
            </div>
          </div>

          <!-- Live Telemetry Status Strip -->
          <div class="floor-studio-telemetry">
            <div class="floor-stat-chip floor-stat-chip--avail" title="میزهای آزاد و آماده پذیرش">
              <span class="floor-stat-dot"></span>
              <span class="floor-stat-label">آزاد:</span>
              <strong>${fmtNum(freeCount)}</strong>
            </div>
            <div class="floor-stat-chip floor-stat-chip--busy" title="میزهای مشغول سرویس">
              <span class="floor-stat-dot"></span>
              <span class="floor-stat-label">سرویس:</span>
              <strong>${fmtNum(busyCount)}</strong>
            </div>
            ${attnCount > 0 ? `
            <div class="floor-stat-chip floor-stat-chip--attn" title="میزهای دارای فراخوان گارسون">
              <span class="floor-stat-dot"></span>
              <span class="floor-stat-label">فراخوان:</span>
              <strong>${fmtNum(attnCount)}</strong>
            </div>` : ''}
          </div>

          <!-- Top Actions -->
          <div class="floor-studio-header__actions">
            <button type="button" class="floor-sidebar-toggle" id="floor-sidebar-toggle" aria-controls="floor-studio-sidebar" aria-expanded="${!isSidebarCollapsed}" aria-label="${isSidebarCollapsed ? 'بازکردن پنل فضاها و میزها' : 'جمع‌کردن پنل فضاها و میزها'}" title="${isSidebarCollapsed ? 'بازکردن پنل فضاها و میزها' : 'جمع‌کردن پنل فضاها و میزها'}">
              <span aria-hidden="true">${isSidebarCollapsed ? '▤' : '▥'}</span><span>${isSidebarCollapsed ? 'نمایش پنل' : 'جمع‌کردن پنل'}</span>
            </button>
            <span class="floor-save-status ${isLayoutDirty ? 'is-dirty' : ''}" id="map-save-status">${isLayoutDirty ? '● تغییرات ذخیره‌نشده' : '✓ چیدمان ذخیره است'}</span>
            <button type="button" class="floor-edit-toggle ${isEditMode ? 'is-editing' : ''}" id="map-toggle-edit">${isEditMode ? '✓ پایان و خروج' : '✏️ ویرایش چیدمان'}</button>
            <button class="btn btn-sm btn-primary" id="map-save-layout" type="button" ${isEditMode && isLayoutDirty ? '' : 'disabled'}>💾 ذخیره اکنون</button>
          </div>
        </header>

        ${isEditMode ? `
        <div class="floor-studio-dock" role="toolbar" aria-label="ابزارهای طراحی سالن">
          <div class="dock-segment">
            <button type="button" class="dock-btn ${studioMode === 'furniture' ? 'is-active' : ''}" id="map-mode-furniture" aria-pressed="${studioMode === 'furniture'}" title="حالت چیدمان میزها و مبلمان">🪑 میزها</button>
            <button type="button" class="dock-btn ${studioMode === 'architecture' ? 'is-active' : ''}" id="map-mode-architecture" aria-pressed="${studioMode === 'architecture'}" title="حالت معماری و تفکیک فضاها">📐 فضاها</button>
          </div>
          <div class="dock-divider"></div>
          <div class="dock-segment">
            <button class="dock-btn dock-btn--accent" id="map-add-table" type="button" title="افزودن میز جدید به سالن" ${canEditCurrentFloor ? '' : 'disabled'}>＋ میز</button>
            <button class="dock-btn" id="map-add-fixture" type="button" title="افزودن سازه معماری (پیشخوان، بار، پله، ستون)" ${canEditCurrentFloor ? '' : 'disabled'}>🏛️ سازه</button>
            <button class="dock-btn ${isDrawingZone ? 'is-active' : ''}" id="map-draw-zone" type="button" title="ترسیم محدوده فضا با ماوس روی نقشه" ${canEditCurrentFloor ? '' : 'disabled'}>✏️ ترسیم فضا</button>
          </div>
          <div class="dock-divider"></div>
          <div class="dock-segment">
            <button class="dock-btn" id="map-auto-align" type="button" title="مرتب‌سازی خودکار میزها" ${canEditCurrentFloor ? '' : 'disabled'}>↺ تراز خودکار</button>
            <div class="floor-snapping-ctrl" title="تنظیم دقت پرش به شبکه">
              <span class="snap-label">🧲 شبکه:</span>
              <button type="button" class="floor-snap-pill ${snapGridStep === 0.5 ? 'is-active' : ''}" data-snap-val="0.5">آزاد</button>
              <button type="button" class="floor-snap-pill ${snapGridStep === 2 ? 'is-active' : ''}" data-snap-val="2">۲٪</button>
              <button type="button" class="floor-snap-pill ${snapGridStep === 5 ? 'is-active' : ''}" data-snap-val="5">۵٪</button>
            </div>
          </div>
          <div class="dock-divider"></div>
          <div class="dock-segment">
            <button type="button" class="dock-btn" id="map-history-undo" aria-label="بازگشت تغییر قبلی" title="بازگشت تغییر قبلی (Ctrl+Z)" ${layoutHistory.undoCount === 0 ? 'disabled' : ''}>↩ بازگشت</button>
            <button type="button" class="dock-btn" id="map-history-redo" aria-label="بازانجام تغییر" title="بازانجام تغییر (Ctrl+Y)" ${layoutHistory.redoCount === 0 ? 'disabled' : ''}>↪ بازانجام</button>
          </div>
          <div class="dock-divider"></div>
          <div class="dock-segment">
            <button type="button" class="dock-btn" id="map-floor-settings" title="تنظیمات ابعاد و مقیاس پلان" ${canEditCurrentFloor ? '' : 'disabled'}>⚙️ پلان</button>
            <button type="button" class="dock-btn" id="map-export-json" title="پشتیبان‌گیری از چیدمان سالن">💾 پشتیبان</button>
            <button type="button" class="dock-btn" id="map-import-json" title="بازیابی چیدمان از فایل" ${canEditCurrentFloor ? '' : 'disabled'}>📂 بازیابی</button>
          </div>
        </div>` : ''}

        ${firstFloorNoticeHtml}

        <!-- ═══ Two-Column Studio Ecosystem (Sidebar + Canvas) ═══ -->
        <div class="floor-studio-body ${isSidebarCollapsed ? 'is-sidebar-collapsed' : ''}">
          <!-- Sidebar: Zones + Tables + Inspector -->
          <aside class="floor-studio-sidebar" id="floor-studio-sidebar" aria-label="مدیریت فضاهای سالن و میزها" ${isSidebarCollapsed ? 'hidden' : ''}>
            <!-- Zones Navigation Section -->
            <div class="floor-sidebar-section floor-sidebar-zones">
              <div class="floor-sidebar-header">
                <span class="floor-sidebar-title">بخش‌های سالن (${fmtNum(allZonesList.length)})</span>
                ${isEditMode ? `<button type="button" class="btn btn-xs btn-ghost" id="map-add-zone" ${canEditCurrentFloor ? '' : 'disabled'}>＋ فضا</button>` : ''}
              </div>
              <div class="floor-zone-pills-row">
                ${zonesList.map((z) => `
                  <button type="button" class="floor-zone-pill ${activeZone === z ? 'active' : ''}" data-zone-pill="${esc(z)}" aria-pressed="${activeZone === z}">
                    <span>${esc(z === 'all' ? 'همه بخش‌ها' : zoneTitle(z))}</span>
                    <span class="zone-badge-num">${fmtNum(z === 'all' ? currentFloorTables.length : currentFloorTables.filter((t) => normalizeTableZoneValue(t.zone, normalizeZone) === z).length)}</span>
                  </button>`).join('')}
              </div>
            </div>

            <!-- Active Table Quick Actions & Inspector -->
            ${inspectorHtml ? `
              <div class="floor-sidebar-section floor-sidebar-inspector">
                ${inspectorHtml}
              </div>` : ''}

            ${mobileEditorHtml ? `
              <div class="floor-sidebar-section floor-sidebar-mobile-editor">
                ${mobileEditorHtml}
              </div>` : ''}

            <!-- Tables Cards List -->
            <div class="floor-sidebar-section floor-sidebar-tables">
              <div class="floor-sidebar-header">
                <span class="floor-sidebar-title">میزهای ${esc(activeZone === 'all' ? 'این طبقه' : zoneTitle(activeZone))} (${fmtNum(visibleTables.length)})</span>
                ${isEditMode ? `<button type="button" class="btn btn-xs btn-primary" id="map-add-table-sidebar" ${canEditCurrentFloor ? '' : 'disabled'}>＋ میز</button>` : ''}
              </div>
              <div class="floor-table-search-box">
                <input type="text" id="map-table-search" class="floor-search-input" placeholder="🔍 جستجوی شماره یا نام میز..." value="${esc(tableSearchQuery)}" />
                ${tableSearchQuery ? `<button type="button" class="floor-search-clear" id="map-table-search-clear" title="پاک‌کردن جستجو">✕</button>` : ''}
              </div>
              <div class="floor-sidebar-tables-list">
                ${visibleTables.length ? visibleTables.map((t) => `
                  <button type="button" class="floor-table-card-v2 ${Number(selectedTableId) === Number(t.id) ? 'is-selected' : ''}" data-mobile-select-table="${esc(t.id)}" aria-pressed="${Number(selectedTableId) === Number(t.id)}">
                    <div class="floor-table-card-v2__main">
                      <div class="floor-table-card-v2__head">
                        <span class="floor-table-card-v2__title">${esc(tableTitle(t))}</span>
                        <span class="floor-table-status-pill status--${esc(t.state || 'available')}">
                          <span class="status-indicator-dot"></span>
                          ${esc(t.stateLabel || (t.active === false ? 'غیرفعال' : 'آزاد'))}
                        </span>
                      </div>
                      <div class="floor-table-card-v2__meta">
                        <span>👥 ${fmtNum(t.seats || 4)} صندلی</span>
                        <span>📍 ${esc(normalizeTableZoneValue(t.zone, normalizeZone))}</span>
                        ${t.mergedWith?.length ? `<span class="badge-merge">🔗 ادغام ${fmtNum(t.mergedWith.length + 1)}</span>` : ''}
                      </div>
                    </div>
                  </button>
                `).join('') : '<p class="floor-table-empty">در این بخش میزی ثبت نشده است.</p>'}
              </div>
            </div>
          </aside>

          <!-- Main Architectural Canvas Stage -->
          <main class="floor-studio-canvas-stage">
            <div class="floor-zone-focus-bar" aria-live="polite">
              <label class="floor-zone-mobile-picker" for="map-zone-mobile">
                <span>بخش نقشه</span>
                <select id="map-zone-mobile" aria-label="انتخاب بخش روی نقشه">
                  ${zonesList.map((zone) => `<option value="${esc(zone)}" ${activeZone === zone ? 'selected' : ''}>${esc(zone === 'all' ? 'همهٔ بخش‌ها' : zoneTitle(zone))}</option>`).join('')}
                </select>
              </label>
              <div class="floor-zone-focus-bar__identity">
                <strong>${activeZone === 'all' ? 'نقشهٔ کامل طبقه' : esc(activeZone)}</strong>
                <span>${activeZone === 'all' ? `${fmtNum(currentFloorTables.length)} میز · ${fmtNum(currentFloorZones.length)} بخش` : `${fmtNum(canvasTables.length)} میز در این بخش`}</span>
                ${outsideZoneCount ? `<span class="floor-zone-focus-bar__warning">${fmtNum(outsideZoneCount)} میز بیرون از محدودهٔ ترسیمی</span>` : ''}
              </div>
              <div class="floor-zone-focus-bar__actions">
                <span id="map-layout-collision-warning" class="floor-zone-focus-bar__collision-warning" role="status" hidden>
                  <span id="map-layout-collision-message"></span>
                  <button type="button" id="map-focus-layout-collisions" hidden>ویرایش میز قرمز</button>
                </span>
                ${isEditMode && activeZone === 'all' && zoneMembershipChanges.length ? `<button type="button" class="floor-zone-focus-bar__button" id="map-sync-table-zones">هماهنگ‌سازی ${fmtNum(zoneMembershipChanges.length)} میز با بخش‌ها</button>` : ''}
                ${activeZone === 'all' && !isEditMode && visibleFixtures.length ? `<button type="button" class="floor-zone-focus-bar__button" id="map-toggle-fixtures" aria-pressed="${showOverviewFixtures}">${showOverviewFixtures ? 'پنهان‌کردن سازه‌ها' : `نمایش سازه‌ها (${fmtNum(visibleFixtures.length)})`}</button>` : ''}
                ${activeZone !== 'all' ? `<button type="button" class="floor-zone-focus-bar__button" id="map-show-all-zones">همهٔ بخش‌ها</button>` : ''}
                ${isEditMode && currentActiveZoneObj ? `
                  <button type="button" class="floor-zone-focus-bar__button" id="map-active-zone-rename">تغییر نام</button>
                  <button type="button" class="floor-zone-focus-bar__button" id="map-active-zone-dims">متراژ ثبت‌شده</button>
                  <span class="floor-zone-focus-bar__hint">برای تغییر اندازه، لبهٔ نقطه‌چین را بکشید</span>` : ''}
              </div>
            </div>
            <!-- Hidden selects to preserve legacy event listeners compatibility -->
            <select id="map-floor-select" style="display:none;" aria-hidden="true">
              ${floorLevels.map((floor) => `<option value="${esc(floor.id)}" ${activeFloorId === floor.id ? 'selected' : ''}>${esc(floor.name)}</option>`).join('')}
              ${showUnassignedFloor ? `<option value="${UNASSIGNED_FLOOR_ID}" ${activeFloorId === UNASSIGNED_FLOOR_ID ? 'selected' : ''}>بدون طبقه</option>` : ''}
            </select>
            <select id="map-zone-select" style="display:none;" aria-hidden="true">
              ${zonesList.map((zone) => `<option value="${esc(zone)}" ${activeZone === zone ? 'selected' : ''}>${esc(zone === 'all' ? 'همهٔ فضاها' : zoneTitle(zone))}</option>`).join('')}
            </select>

            <!-- Architectural Canvas Wrap -->
            <div class="architectural-canvas-wrap ${isEditMode ? 'is-edit-mode' : ''} ${isDrawingZone ? 'is-drawing-zone' : ''} studio-mode--${isEditMode ? studioMode : 'live'} floor-theme--${floorSettings.bgTheme || 'slate-blueprint'}" id="admin-floor-canvas">
              ${floorSettings.showRulers !== false ? `
                <div class="floor-canvas-ruler-x" id="admin-ruler-x">${renderRulerTicksX(floorSettings.lengthM || 20)}</div>
                <div class="floor-canvas-ruler-y" id="admin-ruler-y">${renderRulerTicksY(floorSettings.widthM || 15)}</div>` : ''}

              <div class="admin-floor-canvas-scaler" id="admin-canvas-scaler" style="transform: translate(${canvasPanX}px, ${canvasPanY}px) scale(${canvasZoom}); transform-origin: center center;">
                ${renderedZonesHtml}

                <svg class="floor-canvas-connectors" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2">
                  ${renderSvgConnectors(canvasTables)}
                </svg>

                <div class="plan-fixtures-layer" id="admin-fixtures-layer">
                  ${canvasFixtures.map((f) => renderFixtureItem(f)).join('')}
                </div>

                <div class="plan-tables-layer" id="admin-tables-layer">
                  ${canvasTables.map((t) => renderPlanTableItem(t)).join('')}
                </div>
                ${activeZone === 'all' && currentFloorTables.length === 0 && currentFloorZones.length === 0 && visibleFixtures.length === 0 ? `
                  <div class="floor-studio-empty-state" role="status" style="position:absolute;inset:20% 12%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;pointer-events:auto;color:#cbd5e1">
                    <strong style="font-size:18px">برای این طبقه هنوز چیدمانی ثبت نشده است</strong>
                    <span>${currentFloorConfigured ? 'میزها و صندلی‌ها از دادهٔ واقعی شعبه اضافه می‌شوند.' : 'پس از تعریف طبقه، چیدمان را به‌صورت دستی یا با الگوی اختیاری بسازید.'}</span>
                    ${canUseStarterTemplate && isEditMode ? `<button type="button" class="btn btn-sm btn-ghost" id="map-use-starter-template">انتخاب الگوی شروع (اختیاری)</button>` : ''}
                  </div>` : ''}
                ${activeZone !== 'all' && !focusedZone && canvasTables.length === 0 ? `
                  <div class="floor-zone-canvas-empty" role="status">در این بخش هنوز نقشه یا میزی ثبت نشده است. برای ساخت بخش، ویرایش چیدمان را روشن کنید.</div>` : ''}
              </div>

              ${batchToolbarHtml}

              <!-- Floating Zoom Controls -->
              <div class="floor-canvas-controls">
                <button type="button" id="map-zoom-out" title="کوچک‌نمایی">－</button>
                <span class="zoom-indicator" id="map-zoom-label">${Math.round(canvasZoom * 100)}٪</span>
                <button type="button" id="map-zoom-in" title="بزرگ‌نمایی">＋</button>
                <button type="button" id="map-zoom-reset" title="اندازه پیش‌فرض (۱۰۰٪)">۱۰۰٪</button>
              </div>

            </div>
          </main>
        </div>
      </div>`;

    // بعد از render، event delegation را bind می‌کنیم
    bindMapEventDelegation();
    document.getElementById('map-focus-layout-collisions')?.addEventListener('click', () => {
      const ids = Array.from(document.querySelectorAll('#admin-tables-layer .plan-table.has-collision'))
        .map((table) => Number(table.dataset.table)).filter(Boolean);
      if (!ids.length) return;
      activeZone = 'all';
      isEditMode = true;
      studioMode = 'furniture';
      selectedZoneId = null;
      selectedTableId = ids[0];
      selectedTableIds.clear();
      render();
    });
    requestAnimationFrame(() => {
      const layer = document.getElementById('admin-tables-layer');
      const result = window.WestoFloorChairLayout?.resolveCollisions(layer);
      const warning = document.getElementById('map-layout-collision-warning');
      if (warning && result?.tableCollisions) {
        warning.hidden = false;
        const message = document.getElementById('map-layout-collision-message');
        if (message) message.textContent = `⚠️ ${fmtNum(result.tableCollisions)} برخورد بین میزها؛ میزهای قرمز را در حالت ویرایش از هم فاصله دهید.`;
        const action = document.getElementById('map-focus-layout-collisions');
        if (action) action.hidden = false;
      }
    });
  };

  const focusActiveZoneOnCanvas = () => {
    const stage = document.getElementById('admin-floor-canvas');
    const scaler = document.getElementById('admin-canvas-scaler');
    if (!stage || !scaler) return;
    if (activeZone === 'all') {
      canvasPanX = 0; canvasPanY = 0;
    } else {
      const zone = entitiesForFloor(floorZones, activeFloorId)
        .find((item) => normalizeZone(item.name) === activeZone);
      const zoneTables = entitiesForFloor(tables, activeFloorId)
        .filter((table) => normalizeTableZoneValue(table.zone, normalizeZone) === activeZone);
      const pan = calculateZoneFocusPan(zone, zoneTables, stage.clientWidth, stage.clientHeight, canvasZoom);
      canvasPanX = pan.x; canvasPanY = pan.y;
    }
    scaler.style.transform = `translate(${canvasPanX}px, ${canvasPanY}px) scale(${canvasZoom})`;
  };

  const chooseActiveZone = (nextZone) => {
    if (activeZone !== nextZone) {
      selectedTableId = null;
      selectedFixtureId = null;
      selectedZoneId = null;
      selectedTableIds.clear();
      tableSearchQuery = '';
    }
    activeZone = nextZone;
    render();
    focusActiveZoneOnCanvas();
  };

  // ─── Event Delegation — جایگزین bindMapEvents ────────────────────────
  // همه event ها روی یک canvas — بدون هزاران listener جداگانه
  const bindMapEventDelegation = () => {
    // render() replaces the whole studio DOM. Abort every handler attached to
    // the previous tree before wiring the new one, otherwise each render adds
    // another keyboard/document listener and actions fire repeatedly.
    _renderCtrl.abort();
    _renderCtrl = new AbortController();
    const canvas = document.getElementById('admin-floor-canvas');
    if (!canvas) return;

    const sig = _renderCtrl.signal;
    document.getElementById('floor-sidebar-toggle')?.addEventListener('click', () => {
      isSidebarCollapsed = !isSidebarCollapsed;
      try { localStorage.setItem(SIDEBAR_PREF_KEY, isSidebarCollapsed ? '1' : '0'); } catch {}
      const sidebar = document.getElementById('floor-studio-sidebar');
      const toggle = document.getElementById('floor-sidebar-toggle');
      main.querySelector('.floor-studio-body')?.classList.toggle('is-sidebar-collapsed', isSidebarCollapsed);
      if (sidebar) sidebar.hidden = isSidebarCollapsed;
      if (toggle) {
        const label = isSidebarCollapsed ? 'بازکردن پنل فضاها و میزها' : 'جمع‌کردن پنل فضاها و میزها';
        toggle.setAttribute('aria-expanded', String(!isSidebarCollapsed));
        toggle.setAttribute('aria-label', label);
        toggle.title = label;
        toggle.querySelector('span[aria-hidden]')?.replaceChildren(isSidebarCollapsed ? '▤' : '▥');
        const caption = toggle.querySelector('span:last-child');
        if (caption) caption.textContent = isSidebarCollapsed ? 'نمایش پنل' : 'جمع‌کردن پنل';
      }
      focusActiveZoneOnCanvas();
    }, { signal: sig });
    main.querySelector('.floor-advanced-tools')?.addEventListener('toggle', (event) => {
      advancedOpen = event.currentTarget.open;
    }, { signal: sig });
    // Search input
    const searchInput = document.getElementById('map-table-search');
    searchInput?.addEventListener('input', (e) => {
      tableSearchQuery = e.target.value;
      render();
      const nextInput = document.getElementById('map-table-search');
      if (nextInput) {
        nextInput.focus();
        nextInput.selectionStart = nextInput.selectionEnd = nextInput.value.length;
      }
    }, { signal: sig });
    document.getElementById('map-table-search-clear')?.addEventListener('click', () => {
      tableSearchQuery = '';
      render();
    }, { signal: sig });

    main.querySelectorAll('[data-mobile-select-table]').forEach((button) => {
      button.addEventListener('click', () => {
        const tId = Number(button.dataset.mobileSelectTable);
        selectedTableId = tId;
        selectedZoneId = null;
        selectedFixtureId = null;
        render();
        const canvasTable = document.querySelector(`.plan-table[data-table="${tId}"]`);
        if (canvasTable) {
          canvasTable.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
      }, { signal: sig });
    });
    main.addEventListener('click', (event) => {
      const actionButton = event.target.closest('[data-floor-conflict-action]');
      if (!actionButton) return;
      if (actionButton.dataset.floorConflictAction === 'export') {
        exportLayoutJson();
        return;
      }
      if (actionButton.dataset.floorConflictAction === 'reload') {
        showFloorModal({
          title: 'بارگیری آخرین نسخهٔ نقشه؟',
          confirmText: 'بارگیری نسخهٔ سرور',
          confirmClass: 'btn-danger',
          bodyHtml: '<p role="alert">این کار تغییرات ذخیره‌نشدهٔ همین دستگاه را کنار می‌گذارد. برای نگه‌داشتنشان، ابتدا «دانلود نسخهٔ من» را بزنید.</p>',
          onConfirm: reloadLatestLayoutAfterConflict,
        });
      }
    }, { signal: sig });

    // ── View mode switchers ──
    document.getElementById('view-mode-map')?.addEventListener('click', () => setViewMode('map'), { signal: sig });
    document.getElementById('view-mode-cards')?.addEventListener('click', () => setViewMode('cards'), { signal: sig });

    // ── Zoom controls (direct DOM — بدون render) ──
    const scaler = document.getElementById('admin-canvas-scaler');
    const zoomLabel = document.getElementById('map-zoom-label');
    const getCanvasPanLimits = () => {
      const width = canvas?.clientWidth || 0;
      const height = canvas?.clientHeight || 0;
      let centerX = 0;
      let centerY = 0;
      if (activeZone !== 'all') {
        const zone = entitiesForFloor(floorZones, activeFloorId)
          .find((item) => normalizeZone(item.name) === activeZone);
        const zoneTables = entitiesForFloor(tables, activeFloorId)
          .filter((table) => normalizeTableZoneValue(table.zone, normalizeZone) === activeZone);
        const focus = calculateZoneFocusPan(zone, zoneTables, width, height, canvasZoom);
        centerX = focus.x;
        centerY = focus.y;
      }
      const contentWidth = scaler?.offsetWidth || width;
      const contentHeight = scaler?.offsetHeight || height;
      const overflowX = Math.max(0, (contentWidth * canvasZoom - width) / 2);
      const overflowY = Math.max(0, (contentHeight * canvasZoom - height) / 2);
      return { minX: centerX - overflowX, maxX: centerX + overflowX, minY: centerY - overflowY, maxY: centerY + overflowY };
    };
    const clampCanvasPan = () => {
      const limits = getCanvasPanLimits();
      canvasPanX = Math.max(limits.minX, Math.min(limits.maxX, canvasPanX));
      canvasPanY = Math.max(limits.minY, Math.min(limits.maxY, canvasPanY));
    };
    const updateZoomUi = (keepMapInBounds = false) => {
      if (keepMapInBounds) clampCanvasPan();
      if (scaler) scaler.style.transform = `translate(${canvasPanX}px, ${canvasPanY}px) scale(${canvasZoom})`;
      if (zoomLabel) zoomLabel.textContent = `${Math.round(canvasZoom * 100)}٪`;
    };
    document.getElementById('map-zoom-in')?.addEventListener('click', () => { canvasZoom = Math.min(2.0, Math.round((canvasZoom + 0.1) * 10) / 10); updateZoomUi(true); }, { signal: sig });
    document.getElementById('map-zoom-out')?.addEventListener('click', () => { canvasZoom = Math.max(0.5, Math.round((canvasZoom - 0.1) * 10) / 10); updateZoomUi(true); }, { signal: sig });
    document.getElementById('map-zoom-reset')?.addEventListener('click', () => { canvasZoom = 1.0; focusActiveZoneOnCanvas(); updateZoomUi(); }, { signal: sig });

    // ── Trackpad: two-finger scroll pans; Ctrl/Cmd + wheel pinches around pointer ──
    canvas.addEventListener('wheel', (e) => {
      const rect = canvas.getBoundingClientRect();
      const oldZoom = canvasZoom;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.08 : -0.08;
        canvasZoom = Math.max(0.5, Math.min(2.0, Math.round((oldZoom + delta) * 100) / 100));
        const anchorX = e.clientX - rect.left - rect.width / 2;
        const anchorY = e.clientY - rect.top - rect.height / 2;
        canvasPanX = anchorX - ((anchorX - canvasPanX) / oldZoom) * canvasZoom;
        canvasPanY = anchorY - ((anchorY - canvasPanY) / oldZoom) * canvasZoom;
        updateZoomUi(true);
        return;
      }
      const deltaFactor = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? Math.max(1, canvas.clientHeight) : 1;
      const deltaX = e.deltaX * deltaFactor;
      const deltaY = e.deltaY * deltaFactor;
      if (!deltaX && !deltaY) return;
      e.preventDefault();
      canvasPanX = Math.round(canvasPanX - deltaX);
      canvasPanY = Math.round(canvasPanY - deltaY);
      updateZoomUi(true);
    }, { passive: false, signal: sig });

    // ── CAD Pan with Spacebar or Middle Mouse Button ──
    let isSpaceDown = false;
    window.addEventListener('keydown', (e) => {
      const activeElement = document.activeElement;
      const spaceActivatesControl = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(activeElement?.tagName)
        || activeElement?.isContentEditable
        || activeElement?.closest?.('[role="button"]');
      if (e.code === 'Space' && !spaceActivatesControl) {
        e.preventDefault();
        isSpaceDown = true;
        if (canvas) canvas.style.cursor = 'grab';
      }
    }, { signal: sig });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        isSpaceDown = false;
        if (canvas) canvas.style.cursor = '';
      }
    }, { signal: sig });

    // ── Snap grid ──
    main.querySelectorAll('.floor-snap-pill[data-snap-val]').forEach((btn) => {
      btn.addEventListener('click', () => {
        snapGridStep = parseFloat(btn.dataset.snapVal) || 0.5;
        main.querySelectorAll('.floor-snap-pill').forEach((b) => b.classList.toggle('is-active', b === btn));
      }, { signal: sig });
    });

    // ── Canvas click — deselect ──
    canvas.addEventListener('click', (e) => {
      if (!e.target.closest('.plan-table') && !e.target.closest('.table-floating-palette') &&
          !e.target.closest('.plan-fixture') && !e.target.closest('.fixture-floating-palette') &&
          !e.target.closest('.plan-zone') && !e.target.closest('.zone-floating-palette') &&
          !e.target.closest('.floor-table-inspector') && !e.target.closest('.floor-canvas-controls')) {
        let changed = false;
        if (selectedTableId !== null) { selectedTableId = null; changed = true; }
        if (selectedFixtureId !== null) { selectedFixtureId = null; changed = true; }
        if (selectedZoneId !== null) { selectedZoneId = null; changed = true; }
        if (changed) render();
      }
    }, { signal: sig });

    canvas.addEventListener('keydown', (e) => {
      const tableEl = e.target.closest('.plan-table[role="button"][tabindex="0"]');
      if (!tableEl || e.target !== tableEl || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) tableEl.click();
    }, { signal: sig });

    // ── Canvas pointerdown — Event Delegation برای table/fixture/zone/handle ──
    canvas.addEventListener('pointerdown', (e) => {
      const architectureBackgroundPan = isEditMode && studioMode === 'architecture' && e.button === 0 &&
        !e.target.closest('.plan-zone--interactive, .plan-fixture, .zone-handle, .zone-floating-palette, .fixture-floating-palette, .plan-zone__actions, [data-zone-action], .floor-canvas-controls, .floor-table-inspector');
      // Space / middle click always pans; in architecture mode, blank-canvas drag pans too.
      if (isSpaceDown || e.button === 1 || architectureBackgroundPan) {
        e.preventDefault();
        const initialPanX = canvasPanX;
        const initialPanY = canvasPanY;
        const startX = e.clientX - canvasPanX;
        const startY = e.clientY - canvasPanY;
        canvas?.classList.add('is-panning');
        if (canvas) canvas.style.cursor = 'grabbing';

        const onPanMove = (me) => {
          if (!isActiveFloorPointerEvent(me, e.pointerId)) return;
          canvasPanX = Math.round(me.clientX - startX);
          canvasPanY = Math.round(me.clientY - startY);
          updateZoomUi(true);
        };
        const onPanUp = (upEvent) => {
          if (!isActiveFloorPointerEvent(upEvent, e.pointerId)) return;
          window.removeEventListener('pointermove', onPanMove);
          window.removeEventListener('pointerup', onPanUp);
          window.removeEventListener('pointercancel', onPanUp);
          if (isCancelledFloorPointerEvent(upEvent)) {
            canvasPanX = initialPanX;
            canvasPanY = initialPanY;
            updateZoomUi(true);
          }
          canvas?.classList.remove('is-panning');
          if (canvas) canvas.style.cursor = isSpaceDown ? 'grab' : '';
        };
        window.addEventListener('pointermove', onPanMove);
        window.addEventListener('pointerup', onPanUp);
        window.addEventListener('pointercancel', onPanUp);
        return;
      }

      // Zone resize handle
      const handleEl = e.target.closest('.zone-handle');
      if (handleEl && isEditMode) {
        e.stopPropagation();
        e.preventDefault();
        handleZoneResize(e, handleEl);
        return;
      }

      // Fixture resize handle
      const fixHandleEl = e.target.closest('.fixture-handle--se');
      if (fixHandleEl && isEditMode) {
        e.stopPropagation();
        e.preventDefault();
        handleFixtureResize(e, fixHandleEl);
        return;
      }

      // Table resize handle (corner dot — اولویت بالاتر از drag)
      const tableResizeHandle = e.target.closest('.table-resize-handle');
      if (tableResizeHandle && isEditMode && studioMode === 'furniture') {
        e.stopPropagation();
        e.preventDefault();
        handleTableResize(e, tableResizeHandle);
        return;
      }

      // Table drag
      if (isEditMode) {
        const tableEl = e.target.closest('.plan-table');
        if (tableEl && !e.target.closest('.table-floating-palette')) {
          e.stopPropagation();
          e.preventDefault();
          handleTableDrag(e, tableEl);
          return;
        }

        // Fixture drag
        const fixEl = e.target.closest('.plan-fixture[data-fixture-id]');
        if (fixEl && !e.target.closest('.fixture-floating-palette') && !e.target.closest('.fixture-handle')) {
          e.preventDefault();
          handleFixtureDrag(e, fixEl);
          return;
        }

        const zoneEl = e.target.closest('.plan-zone--interactive');
        if (studioMode === 'architecture' && zoneEl &&
            !e.target.closest('.zone-floating-palette') && !e.target.closest('.plan-zone__actions') &&
            !e.target.closest('[data-zone-action]') && !e.target.closest('.zone-handle')) {
          e.stopPropagation();
          e.preventDefault();
          handleZoneDrag(e, zoneEl);
          return;
        }
      }

      // Drawing zone
      if (isDrawingZone) {
        if (e.target.closest('.plan-table') || e.target.closest('.table-floating-palette') || e.target.closest('.plan-zone__actions') || e.target.closest('[data-zone-action]') || e.target.closest('.zone-handle') || e.target.closest('.floor-canvas-controls')) return;
        startZoneDrawing(e, canvas);
        return;
      }

      // Marquee selection
      if (isEditMode && !isDrawingZone) {
        if (e.target.closest('.plan-table') || e.target.closest('.plan-fixture') || e.target.closest('.table-floating-palette') || e.target.closest('.fixture-floating-palette') || e.target.closest('.plan-zone__actions') || e.target.closest('.plan-zone__border-delete') || e.target.closest('.zone-floating-palette') || e.target.closest('[data-zone-action]') || e.target.closest('.zone-handle') || e.target.closest('.floor-canvas-controls') || e.target.closest('.floor-batch-toolbar') || e.target.closest('.floor-table-inspector')) return;
        startMarqueeSelection(e, canvas);
      }
    }, { signal: sig });

    // ── Table click — select ──
    canvas.addEventListener('click', (e) => {
      if (e.target.closest('.table-floating-palette')) return;
      if (justDragged) return;
      const tableEl = e.target.closest('.plan-table');
      if (tableEl) {
        e.stopPropagation();
        const tableId = Number(tableEl.dataset.table);
        const clickedTable = tableById(tableId);
        const clickedZone = clickedTable ? normalizeTableZoneValue(clickedTable.zone, normalizeZone) : activeZone;
        const zoneChanged = activeZone !== 'all' && clickedZone !== activeZone;
        if (zoneChanged) activeZone = clickedZone;
        selectedZoneId = null;
        selectedFixtureId = null;
        if (Number(selectedTableId) !== tableId || zoneChanged) {
          selectedTableId = tableId;
          render();
        }
      }
    }, { signal: sig });

    // ── Table palette action — click delegation ──
    canvas.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-table-action]');
      if (!btn) return;
      e.stopPropagation();
      const action = btn.dataset.tableAction;
      const paletteEl = btn.closest('.table-floating-palette');
      if (!paletteEl) return;
      const tableId = Number(paletteEl.dataset.paletteFor);
      const table = tableById(tableId);
      if (!table) return;

      if (action === 'furniture-modal') {
        promptTableFurnitureModal(table);
      } else if (action === 'toggle-more') {
        const menu = paletteEl.querySelector('.palette-more-menu');
        if (menu) {
          const shouldOpen = menu.style.display === 'none' || !menu.style.display;
          canvas.querySelectorAll('.palette-more-menu').forEach((otherMenu) => {
            if (otherMenu === menu) return;
            otherMenu.style.display = 'none';
            otherMenu.removeAttribute('data-placement');
            otherMenu.removeAttribute('data-align');
            otherMenu.closest('.palette-more-wrapper')?.querySelector('[data-table-action="toggle-more"]')?.setAttribute('aria-expanded', 'false');
          });

          if (!shouldOpen) {
            menu.style.display = 'none';
            menu.removeAttribute('data-placement');
            menu.removeAttribute('data-align');
            btn.setAttribute('aria-expanded', 'false');
            return;
          }

          menu.dataset.placement = 'bottom';
          menu.dataset.align = 'right';
          menu.style.display = 'flex';
          btn.setAttribute('aria-expanded', 'true');

          requestAnimationFrame(() => {
            if (!menu.isConnected || menu.style.display === 'none') return;
            const canvasRect = canvas.getBoundingClientRect();
            const triggerRect = btn.getBoundingClientRect();
            const menuRect = menu.getBoundingClientRect();
            const edgeGap = 10;
            const gap = 8;
            const spaceAbove = Math.max(0, triggerRect.top - canvasRect.top - gap);
            const spaceBelow = Math.max(0, canvasRect.bottom - triggerRect.bottom - gap);
            const placement = spaceBelow >= menuRect.height || spaceBelow >= spaceAbove ? 'bottom' : 'top';
            const spaceLeft = Math.max(0, triggerRect.right - canvasRect.left - edgeGap);
            const spaceRight = Math.max(0, canvasRect.right - triggerRect.left - edgeGap);
            const align = spaceLeft >= menuRect.width ? 'right'
              : spaceRight >= menuRect.width ? 'left'
                : spaceRight >= spaceLeft ? 'left' : 'right';
            menu.dataset.placement = placement;
            menu.dataset.align = align;
          });
        }
      } else if (action === 'rotate') {
        pushHistory();
        table.rotation = normalizeFloorRotation((Number(table.rotation) || 0) + 45);
        const el = canvas.querySelector(`.plan-table[data-table="${table.id}"]`);
        if (el) {
          const sc = table.scale || 1;
          el.style.transform = `translate(-50%, -50%) rotate(${table.rotation}deg) scale(${table.scaleX || sc}, ${table.scaleY || sc})`;
          el.style.setProperty('--table-rot', `${table.rotation}deg`);
        }
        debouncedSaveFloor();
      } else if (action === 'toggle-shape') {
        pushHistory();
        const shapeCycle = ['rectangle', 'conference', 'semi_circle', 'wall_counter', 'circle', 'square', 'oval', 'booth', 'round_booth', 'bar_stool', 'lounge_takht'];
        const currIdx = shapeCycle.indexOf(table.shape || 'rectangle');
        table.shape = shapeCycle[(currIdx + 1) % shapeCycle.length];
        render(); debouncedSaveFloor();
      } else if (action === 'inc-seats') {
        if ((Number(table.seats) || 4) >= 24) return;
        pushHistory();
        table.seats = Math.min(24, (Number(table.seats) || 4) + 1);
        render(); debouncedSaveFloor();
      } else if (action === 'dec-seats') {
        if ((Number(table.seats) || 4) <= 1) return;
        pushHistory();
        table.seats = Math.max(1, (Number(table.seats) || 4) - 1);
        render(); debouncedSaveFloor();
      } else if (action === 'inc-scale') {
        const curScale = Number(table.scale) || 1;
        if (curScale >= 3) return;
        pushHistory();
        table.scale = Math.min(3.0, Math.round((curScale + 0.1) * 10) / 10);
        table.scaleX = Math.min(3, (Number(table.scaleX) || curScale) + 0.1);
        table.scaleY = Math.min(3, (Number(table.scaleY) || curScale) + 0.1);
        render(); debouncedSaveFloor();
      } else if (action === 'dec-scale') {
        const curScale = Number(table.scale) || 1;
        if (curScale <= 0.5) return;
        pushHistory();
        table.scale = Math.max(0.5, Math.round((curScale - 0.1) * 10) / 10);
        table.scaleX = Math.max(0.5, (Number(table.scaleX) || curScale) - 0.1);
        table.scaleY = Math.max(0.5, (Number(table.scaleY) || curScale) - 0.1);
        render(); debouncedSaveFloor();
      } else if (action === 'toggle-active') {
        pushHistory();
        table.active = table.active === false ? true : false;
        render(); debouncedSaveFloor();
        showToast(`میز ${tableTitle(table)} ${table.active ? 'فعال' : 'غیرفعال'} شد.`, 'info');
      } else if (action === 'merge') {
        if ((table.mergedWith && table.mergedWith.length > 0) || table.mergedInto) unmergeTable(table);
        else mergeTablesGroup(selectedTableIds);
      } else if (action === 'move-floor') {
        promptMoveTableFloor(table);
      } else if (action === 'duplicate') {
        const nextId = (tables.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0)) + 1;
        const copy = { ...table, id: nextId, label: `${table.label || `میز ${table.id}`} (کپی)`, x: Math.min(92, (Number(table.x) || 50) + 5), y: Math.min(92, (Number(table.y) || 50) + 5), active: true };
        markTablePositioned(copy);
        ensureTableGeometry(copy, tables.length);
        pushHistory();
        tables.push(copy);
        selectedTableId = copy.id;
        const saved = await saveFloorLayout(true);
        render();
        if (saved) showToast(`میز «${copy.label}» تکثیر شد.`, 'success');
        else showLayoutSaveFailure();
      } else if (action === 'rename') {
        promptRenameTable(table);
      } else if (action === 'delete') {
        await deleteTableFromMap(table.id);
      } else if (action === 'close') {
        selectedTableId = null; render();
      } else if (action === 'zone-select') {
        // handled via change event below
      }
    }, { signal: sig });

    // ── Zone select change (delegation) ──
    canvas.addEventListener('change', (e) => {
      const sel = e.target.closest('select[data-table-action="zone-select"]');
      if (sel) {
        const paletteEl = sel.closest('.table-floating-palette');
        if (!paletteEl) return;
        const table = tableById(Number(paletteEl.dataset.paletteFor));
        if (!table) return;
        if (normalizeTableZoneValue(table.zone, normalizeZone) === normalizeTableZoneValue(e.target.value, normalizeZone)) return;
        pushHistory();
          markTableZoneAssigned(table, e.target.value, normalizeZone);
        render(); debouncedSaveFloor();
      }
    }, { signal: sig });

    // ── Zone actions ──
    canvas.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-zone-action]');
      if (!btn) return;
      e.stopPropagation();
      const action = btn.dataset.zoneAction;
      const zoneId = btn.dataset.zoneId;
      const zone = entitiesForFloor(floorZones, activeFloorId).find((z) => z.id === zoneId);
      if (!zone) return;
      if (action === 'rename') promptRenameZone(zone);
      else if (action === 'dimensions') promptZoneDimensions(zone);
      else if (action === 'color') cycleZoneColor(zone);
      else if (action === 'split') splitZone(zone);
      else if (action === 'delete') deleteZone(zone.id);
      else if (action === 'close') { selectedZoneId = null; render(); }
    }, { signal: sig });

    // ── Zone click (select) ──
    canvas.addEventListener('click', (e) => {
      if (justDragged) return;
      if (e.target.closest('[data-zone-action]') || e.target.closest('.zone-handle') || e.target.closest('.plan-table') || e.target.closest('.plan-fixture')) return;
      const zoneEl = e.target.closest('.plan-zone--interactive');
      if (!zoneEl || !isEditMode) return;
      if (studioMode === 'architecture' || e.target.closest('.plan-zone__header')) {
        const clickedZone = normalizeZone(zoneEl.dataset.zoneName);
        if (activeZone !== 'all' && clickedZone !== activeZone) activeZone = clickedZone;
        selectedZoneId = zoneEl.dataset.zoneId;
        selectedTableId = null;
        selectedFixtureId = null;
        render();
      }
    }, { signal: sig });

    // ── Fixture click & palette ──
    canvas.addEventListener('click', (e) => {
      if (e.target.closest('.fixture-floating-palette') || e.target.closest('.fixture-handle')) return;
      if (justDragged) return;
      const fixEl = e.target.closest('.plan-fixture[data-fixture-id]');
      if (!fixEl) return;
      e.stopPropagation();
      selectedFixtureId = fixEl.dataset.fixtureId;
      selectedTableId = null;
      render();
    }, { signal: sig });

    canvas.addEventListener('click', (e) => {
      const actBtn = e.target.closest('[data-fixture-action]');
      if (!actBtn) return;
      e.stopPropagation();
      const fId = actBtn.closest('.plan-fixture')?.dataset.fixtureId;
      const fixture = floorFixtures.find((f) => f.id === fId);
      if (!fixture) return;
      const action = actBtn.dataset.fixtureAction;
      if (action === 'rotate') {
        pushHistory();
        fixture.rotation = normalizeFloorRotation((Number(fixture.rotation) || 0) + 45);
        const el = canvas.querySelector(`.plan-fixture[data-fixture-id="${fId}"]`);
        if (el) el.style.transform = `rotate(${fixture.rotation}deg)`;
        debouncedSaveFloor();
      } else if (action === 'delete') {
        deleteFixture(fixture.id);
      } else if (action === 'close') {
        selectedFixtureId = null; render();
      }
    }, { signal: sig });

    // ── Zone pills ──
    main.querySelectorAll('[data-zone-pill]').forEach((pill) => {
      pill.addEventListener('click', () => chooseActiveZone(pill.dataset.zonePill), { signal: sig });
    });
    document.getElementById('map-show-all-zones')?.addEventListener('click', () => chooseActiveZone('all'), { signal: sig });
    document.getElementById('map-toggle-fixtures')?.addEventListener('click', () => {
      showOverviewFixtures = !showOverviewFixtures;
      render();
    }, { signal: sig });
    document.getElementById('map-zone-mobile')?.addEventListener('change', (event) => chooseActiveZone(event.target.value), { signal: sig });

    // ── Active zone strip buttons ──
    const curActiveZone = activeZone !== 'all' ? entitiesForFloor(floorZones, activeFloorId).find((z) => z.name === activeZone || normalizeZone(z.name) === normalizeZone(activeZone)) : null;
    if (curActiveZone) {
      document.getElementById('map-active-zone-dims')?.addEventListener('click', () => promptZoneDimensions(curActiveZone), { signal: sig });
      document.getElementById('map-active-zone-rename')?.addEventListener('click', () => promptRenameZone(curActiveZone), { signal: sig });
      document.getElementById('map-active-zone-color')?.addEventListener('click', () => cycleZoneColor(curActiveZone), { signal: sig });
      document.getElementById('map-active-zone-delete')?.addEventListener('click', () => deleteZone(curActiveZone.id), { signal: sig });
    }

    // ── Studio controls ──
    document.getElementById('map-zone-select')?.addEventListener('change', (event) => {
      chooseActiveZone(event.target.value);
      document.getElementById('map-zone-select')?.focus({ preventScroll: true });
    }, { signal: sig });
    document.getElementById('map-floor-select')?.addEventListener('change', (event) => {
      activeFloorId = event.target.value;
      activeZone = 'all';
      selectedTableId = null;
      selectedFixtureId = null;
      selectedZoneId = null;
      selectedTableIds.clear();
      render();
      document.getElementById('map-floor-select')?.focus({ preventScroll: true });
    }, { signal: sig });
    const floorToolbarEl = main.querySelector('.floor-toolbar');
    if (floorToolbarEl) {
      floorToolbarEl.addEventListener('wheel', (e) => {
        if (e.deltaY && !e.deltaX) {
          e.preventDefault();
          floorToolbarEl.scrollLeft += e.deltaY;
        }
      }, { passive: false, signal: sig });
    }
    main.querySelectorAll('#map-add-zone, #map-add-zone-sidebar').forEach((btn) => btn.addEventListener('click', promptAddZone, { signal: sig }));
    document.getElementById('map-use-starter-template')?.addEventListener('click', showTemplateModal, { signal: sig });
    document.getElementById('map-mode-furniture')?.addEventListener('click', () => { studioMode = 'furniture'; isEditMode = true; selectedZoneId = null; render(); showToast('حالت چیدمان مبلمان و میزها فعال شد.', 'info'); }, { signal: sig });
    document.getElementById('map-mode-architecture')?.addEventListener('click', () => { studioMode = 'architecture'; isEditMode = true; selectedTableId = null; render(); showToast('حالت معماری و تفکیک فضاها فعال شد.', 'info'); }, { signal: sig });
    document.getElementById('map-toggle-edit')?.addEventListener('click', async () => {
      isEditMode = !isEditMode;
      if (!isEditMode) {
        queuedSaveFloor.cancel?.();
        isDrawingZone = false;
        selectedTableId = null;
        selectedFixtureId = null;
        selectedZoneId = null;
        selectedTableIds.clear();
      }
      render();
      if (isEditMode) {
        showToast('حالت ویرایش چیدمان فعال گردید.', 'info');
        return;
      }
      if (!isLayoutDirty) {
        showToast('حالت نمایش فعال شد؛ تغییری برای ذخیره نبود.', 'info');
        return;
      }
      const saved = await saveFloorLayout(true);
      showToast(saved ? 'تغییرات ذخیره شد و حالت نمایش فعال گردید.' : 'حالت نمایش فعال شد، اما ذخیره انجام نشد.', saved ? 'success' : 'error');
    }, { signal: sig });
    main.querySelectorAll('#map-add-table, #map-add-table-sidebar').forEach((btn) => btn.addEventListener('click', addTableToMap, { signal: sig }));
    document.getElementById('map-auto-align')?.addEventListener('click', () => {
      if (!isEditMode || !requireConfiguredFloor('تراز خودکار میزها')) return;
      autoAlignTables();
    }, { signal: sig });
    document.getElementById('map-sync-table-zones')?.addEventListener('click', () => {
      if (!isEditMode || !requireConfiguredFloor('هماهنگ‌سازی بخش میزها')) return;
      const changes = planFloorZoneMembershipSync(
        entitiesForFloor(tables, activeFloorId),
        entitiesForFloor(floorZones, activeFloorId),
        activeFloorId,
        normalizeZone,
      );
      if (!changes.length) {
        render();
        showToast('همهٔ میزها از قبل در بخش ترسیمی خود هستند.', 'info');
        return;
      }
      const tablesById = new Map(tables.map((table) => [String(table.id), table]));
      const preview = changes.map((change) => {
        const table = tablesById.get(String(change.tableId));
        return `<li><strong>${esc(table ? tableTitle(table) : `میز ${change.tableId}`)}</strong>: از «${esc(change.fromZone)}» به «${esc(change.toZone)}»</li>`;
      }).join('');
      showFloorModal({
        title: 'هماهنگ‌سازی میزها با بخش‌های نقشه',
        confirmText: 'تطبیق و ذخیره',
        bodyHtml: `<p>${fmtNum(changes.length)} میز در محدودهٔ یک بخش ترسیمی قرار دارند، اما برچسب بخششان متفاوت است.</p><p>جای میز و صندلی‌ها تغییر نمی‌کند؛ فقط بخش هر میز بر اساس مرکز میز و مرز ترسیمی اصلاح می‌شود:</p><ul class="floor-zone-sync-preview">${preview}</ul><p>پیش از اصلاح، نسخهٔ فعلی در تاریخچه ثبت می‌شود و با «بازگشت» قابل برگشت است.</p>`,
        onConfirm: async () => {
          const latestChanges = planFloorZoneMembershipSync(
            entitiesForFloor(tables, activeFloorId),
            entitiesForFloor(floorZones, activeFloorId),
            activeFloorId,
            normalizeZone,
          );
          if (!latestChanges.length) {
            showToast('تغییری باقی نمانده؛ نقشه از قبل هماهنگ است.', 'info');
            return true;
          }
          queuedSaveFloor.cancel?.();
          pushHistory();
          const updatedCount = applyFloorZoneMembershipSync(tables, latestChanges, normalizeZone);
          if (!updatedCount) return false;
          render();
          const saved = await saveFloorLayout(true);
          if (saved) {
            showToast(`عضویت بخش ${fmtNum(updatedCount)} میز با مرزهای نقشه هماهنگ شد.`, 'success');
          } else {
            showLayoutSaveFailure();
          }
          return true;
        },
      });
    }, { signal: sig });
    document.getElementById('map-save-layout')?.addEventListener('click', () => {
      if (!isEditMode || !isLayoutDirty) return;
      queuedSaveFloor.cancel?.();
      saveFloorLayout(false);
    }, { signal: sig });

    // ── Draw zone button ──
    document.getElementById('map-draw-zone')?.addEventListener('click', () => {
      if (!requireConfiguredFloor('ترسیم بخش')) return;
      isDrawingZone = !isDrawingZone;
      if (isDrawingZone) { isEditMode = true; studioMode = 'architecture'; }
      render();
      showToast(isDrawingZone ? 'حالت ترسیم فعال شد؛ روی نقشه کلیک کنید و ماوس را بکشید.' : 'حالت ترسیم غیرفعال شد.', 'info');
    }, { signal: sig });

    // ── Floor pills ──
    main.querySelectorAll('[data-floor-pill]').forEach((pill) => {
      pill.addEventListener('click', () => {
        const nextFloorId = pill.dataset.floorPill;
        if (nextFloorId === activeFloorId) return;
        activeFloorId = nextFloorId;
        activeZone = 'all';
        selectedTableId = null;
        selectedFixtureId = null;
        selectedZoneId = null;
        selectedTableIds.clear();
        render();
      }, { signal: sig });
    });
    main.querySelectorAll('[data-edit-floor-pill]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetFloor = floorLevels.find((fl) => fl.id === btn.dataset.editFloorPill);
        if (targetFloor) promptEditFloor(targetFloor);
      }, { signal: sig });
    });
    document.getElementById('map-add-floor')?.addEventListener('click', promptAddFloor, { signal: sig });
    document.getElementById('map-create-first-floor')?.addEventListener('click', () => {
      if (floorLevels.length > 0) return;
      isEditMode = true;
      render();
      promptAddFloor();
    }, { signal: sig });
    document.getElementById('map-floor-settings')?.addEventListener('click', () => {
      if (!isEditMode) return;
      promptFloorSettings();
    }, { signal: sig });
    document.getElementById('map-export-json')?.addEventListener('click', exportLayoutJson, { signal: sig });
    document.getElementById('map-import-json')?.addEventListener('click', importLayoutJson, { signal: sig });

    // ── Undo / Redo ──
    document.getElementById('map-history-undo')?.addEventListener('click', undoLayout, { signal: sig });
    document.getElementById('map-history-redo')?.addEventListener('click', redoLayout, { signal: sig });
    document.getElementById('map-undo')?.addEventListener('click', undoLayout, { signal: sig });
    document.getElementById('map-redo')?.addEventListener('click', redoLayout, { signal: sig });

    // ── Add Fixture ──
    document.getElementById('map-add-fixture')?.addEventListener('click', promptAddFixture, { signal: sig });

    // ── Batch toolbar ──
    const batchToolbar = document.getElementById('admin-batch-toolbar');
    if (batchToolbar) {
      batchToolbar.querySelectorAll('[data-batch-act]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const act = btn.dataset.batchAct;
          if (act === 'batch-clear') { selectedTableIds.clear(); render(); }
          else if (act === 'batch-delete') { batchDeleteSelectedTables(); }
          else if (act === 'batch-merge') {
            mergeTablesGroup(selectedTableIds);
          } else if (act.startsWith('align-')) alignSelectedTables(act.replace('align-', ''));
          else if (act.startsWith('distribute-')) distributeSelectedTables(act.replace('distribute-', ''));
        }, { signal: sig });
      });
    }

    // ── Inspector drawer ──
    document.getElementById('floor-inspector-close')?.addEventListener('click', () => { selectedTableId = null; render(); }, { signal: sig });
    document.getElementById('floor-inspector-switch-edit')?.addEventListener('click', () => {
      isEditMode = true;
      render();
      document.querySelector('.floor-map-disclosure')?.scrollIntoView({ block: 'start' });
      showToast('حالت ویرایش چیدمان فعال گردید.', 'info');
    }, { signal: sig });
    document.getElementById('floor-inspector-resolve')?.addEventListener('click', async () => {
      const inspTable = tableById(selectedTableId);
      if (!inspTable) return;
      try {
        let callId = inspTable.waiterCallId;
        if (!callId) {
          const callsData = await api(`/api/waiter/calls${branchQuery()}`);
          const openCalls = Array.isArray(callsData?.calls) ? callsData.calls : Array.isArray(callsData) ? callsData : [];
          const matching = openCalls.find((c) => (c.status === 'open' || c.status === 'new') && isWaiterCallForTable(c, inspTable, tables));
          if (matching) callId = matching.id;
        }
        if (!callId) {
          showToast('فراخوان بازی برای این میز یافت نشد.', 'info');
          return;
        }
        await api(`/api/waiter/calls/${callId}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) });
        const refreshed = await loadFloorData();
        render();
        if (hasLayoutRevisionConflict) {
          showToast('وضعیت میز به‌روز شد، اما نسخهٔ نقشه هم‌زمان تغییر کرده است؛ چیدمان محلی حفظ شد و ذخیره تا بررسی تعارض متوقف است.', 'warning');
        } else {
          const notice = floorRefreshNotice(refreshed);
          showToast(notice.message, notice.type);
        }
      } catch (err) { showToast(err.message || 'خطا در ثبت رسیدگی به فراخوان', 'error'); }
    }, { signal: sig });

    // ── Mobile table editor — outside the scaled canvas for reliable touch ──
    const mobileEditor = document.getElementById('floor-mobile-table-editor');
    mobileEditor?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mobile-table-action]');
      if (!btn || btn.tagName === 'SELECT') return;
      const table = tableById(Number(mobileEditor.dataset.tableId));
      if (!table) return;
      const action = btn.dataset.mobileTableAction;

      if (action === 'close') {
        selectedTableId = null;
        render();
        return;
      }
      if (action === 'undo') {
        undoLayout();
        return;
      }
      if (action === 'redo') {
        redoLayout();
        return;
      }
      if (action === 'save-exit') {
        queuedSaveFloor.cancel?.();
        const hasChanges = isLayoutDirty;
        isEditMode = false;
        isDrawingZone = false;
        selectedTableId = null;
        selectedFixtureId = null;
        selectedZoneId = null;
        selectedTableIds.clear();
        render();
        if (!hasChanges) {
          showToast('حالت نمایش فعال شد؛ تغییری برای ذخیره نبود.', 'info');
          return;
        }
        saveFloorLayout(true).then((saved) => {
          showToast(saved ? 'چیدمان ذخیره شد و حالت نمایش فعال گردید.' : 'ذخیره چیدمان انجام نشد.', saved ? 'success' : 'error');
        });
        return;
      }
      if (action === 'furniture-modal') {
        promptTableFurnitureModal(table);
        return;
      }

      const adjustment = calculateMobileTableAdjustment(table, action);
      if (!adjustment.changed) return;
      pushHistory();
      table[adjustment.key] = adjustment.value;

      render();
      debouncedSaveFloor();
    }, { signal: sig });

    mobileEditor?.addEventListener('change', (e) => {
      const select = e.target.closest('select[data-mobile-table-action="zone-select"]');
      if (!select) return;
      const table = tableById(Number(mobileEditor.dataset.tableId));
      if (!table) return;
      pushHistory();
      markTableZoneAssigned(table, select.value, normalizeZone);
      render();
      debouncedSaveFloor();
    }, { signal: sig });

    // ── Countdown timer — بر خلاف قبل، این timer cleanup می‌شود ──
    if (_countdownTimer) clearInterval(_countdownTimer);
    _countdownTimer = setInterval(() => {
      const canvas2 = document.getElementById('admin-floor-canvas');
      if (!canvas2) { clearInterval(_countdownTimer); _countdownTimer = null; return; }
      canvas2.querySelectorAll('.plan-table-timer[data-service-ends]').forEach((tEl) => {
        const ends = tEl.getAttribute('data-service-ends');
        if (ends) tEl.textContent = floorCountdownLabel(ends);
      });
    }, 1000);

    // ── Global keyboard shortcuts (یک بار ثبت، با AbortController cleanup) ──
    document.addEventListener('keydown', (e) => {
      if (currentView !== 'map') return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault(); undoLayout();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault(); redoLayout();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedZoneId && !selectedTableId && !selectedFixtureId) {
        e.preventDefault(); deleteZone(selectedZoneId);
      }
    }, { signal: sig });
  };

  // ─── Zone Drawing ──────────────────────────────────────────────────────
  const startZoneDrawing = (e, canvas) => {
    const scaleEl = document.getElementById('admin-canvas-scaler') || canvas;
    const rect = scaleEl.getBoundingClientRect();
    const startX = ((e.clientX - rect.left) / rect.width) * 100;
    const startY = ((e.clientY - rect.top) / rect.height) * 100;
    const drawStart = { x: startX, y: startY, rect };

    const drawBox = document.createElement('div');
    drawBox.className = 'zone-drawing-rect';
    drawBox.style.cssText = `left:${startX}%;top:${startY}%;width:0%;height:0%`;
    scaleEl.appendChild(drawBox);

    const onMove = (ev) => {
      if (!isActiveFloorPointerEvent(ev, e.pointerId)) return;
      if (!drawStart) return;
      const curX = ((ev.clientX - drawStart.rect.left) / drawStart.rect.width) * 100;
      const curY = ((ev.clientY - drawStart.rect.top) / drawStart.rect.height) * 100;
      const x = Math.max(0, Math.min(100, Math.min(drawStart.x, curX)));
      const y = Math.max(0, Math.min(100, Math.min(drawStart.y, curY)));
      const w = Math.min(100 - x, Math.abs(curX - drawStart.x));
      const h = Math.min(100 - y, Math.abs(curY - drawStart.y));
      drawBox.style.left = `${x.toFixed(1)}%`;
      drawBox.style.top = `${y.toFixed(1)}%`;
      drawBox.style.width = `${w.toFixed(1)}%`;
      drawBox.style.height = `${h.toFixed(1)}%`;
      drawBox.innerHTML = `<span>${Math.round(w)}% × ${Math.round(h)}%</span>`;
    };

    const onUp = (ev) => {
      if (!isActiveFloorPointerEvent(ev, e.pointerId)) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (isCancelledFloorPointerEvent(ev)) {
        drawBox.remove();
        return;
      }
      const curX = ((ev.clientX - drawStart.rect.left) / drawStart.rect.width) * 100;
      const curY = ((ev.clientY - drawStart.rect.top) / drawStart.rect.height) * 100;
      const x = Math.round(Math.max(0, Math.min(100, Math.min(drawStart.x, curX))));
      const y = Math.round(Math.max(0, Math.min(100, Math.min(drawStart.y, curY))));
      const w = Math.round(Math.min(100 - x, Math.abs(curX - drawStart.x)));
      const h = Math.round(Math.min(100 - y, Math.abs(curY - drawStart.y)));
      drawBox.remove();
      if (w >= 6 && h >= 6) { isDrawingZone = false; promptCreateZone(x, y, w, h); }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // ─── Marquee Selection ────────────────────────────────────────────────
  const startMarqueeSelection = (e, canvas) => {
    const scaleEl = document.getElementById('admin-canvas-scaler') || canvas;
    const rect = scaleEl.getBoundingClientRect();
    const startX = ((e.clientX - rect.left) / rect.width) * 100;
    const startY = ((e.clientY - rect.top) / rect.height) * 100;
    const marqueeStart = { x: startX, y: startY, rect };

    const marqueeBox = document.createElement('div');
    marqueeBox.className = 'floor-marquee-box';
    marqueeBox.style.cssText = `left:${startX}%;top:${startY}%;width:0%;height:0%`;
    scaleEl.appendChild(marqueeBox);

    const onMove = (ev) => {
      if (!isActiveFloorPointerEvent(ev, e.pointerId)) return;
      const curX = ((ev.clientX - marqueeStart.rect.left) / marqueeStart.rect.width) * 100;
      const curY = ((ev.clientY - marqueeStart.rect.top) / marqueeStart.rect.height) * 100;
      const x = Math.max(0, Math.min(100, Math.min(marqueeStart.x, curX)));
      const y = Math.max(0, Math.min(100, Math.min(marqueeStart.y, curY)));
      marqueeBox.style.left = `${x}%`; marqueeBox.style.top = `${y}%`;
      marqueeBox.style.width = `${Math.min(100 - x, Math.abs(curX - marqueeStart.x))}%`;
      marqueeBox.style.height = `${Math.min(100 - y, Math.abs(curY - marqueeStart.y))}%`;
    };

    const onUp = (ev) => {
      if (!isActiveFloorPointerEvent(ev, e.pointerId)) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (isCancelledFloorPointerEvent(ev)) {
        marqueeBox.remove();
        return;
      }
      const curX = ((ev.clientX - marqueeStart.rect.left) / marqueeStart.rect.width) * 100;
      const curY = ((ev.clientY - marqueeStart.rect.top) / marqueeStart.rect.height) * 100;
      const minX = Math.min(marqueeStart.x, curX); const maxX = Math.max(marqueeStart.x, curX);
      const minY = Math.min(marqueeStart.y, curY); const maxY = Math.max(marqueeStart.y, curY);
      marqueeBox.remove();
      if (Math.abs(maxX - minX) > 2 && Math.abs(maxY - minY) > 2) {
        if (!ev.shiftKey) selectedTableIds.clear();
        entitiesForFloor(tables, activeFloorId).forEach((t) => {
          const tx = Number(t.x) || 50; const ty = Number(t.y) || 50;
          if (tx >= minX && tx <= maxX && ty >= minY && ty <= maxY) selectedTableIds.add(Number(t.id));
        });
        render();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // ─── View Mode ────────────────────────────────────────────────────────
  const setViewMode = (mode) => {
    currentView = resolveFloorViewMode(mode, cardsViewAvailable);
    try { localStorage.setItem(VIEW_PREFS_KEY, currentView); } catch {}
    render();
  };

  // ─── Cards View (QR studio) — simplified ─────────────────────────────
  const renderCardsView = () => {
    // این بخش از admin.js کپی می‌شود — تغییر اساسی در ساختار آن نداریم
    // فقط event binding در اینجا مستقیم انجام می‌شود
    // محتوای renderCardsView از admin.js موجود استفاده می‌شود (کوتاه‌سازی نشده)
    if (typeof opts.renderCardsView === 'function') {
      opts.renderCardsView({
        tables, floorData, selectedTableIds, qrPrefs, currentTableId: null,
        setViewMode, addTableToMap, deleteTableFromMap,
        tableById, tableTitle, activeTables, qrAssetUrl, tableDestination, qrEclLabel, qrEclHint,
        normalizeQrPrefs, saveQrPrefs, validHex, validBaseUrl,
      });
    }
  };

  // ─── CRUD Operations ─────────────────────────────────────────────────
  const addTableToMap = async () => {
    if (!floorExists(floorLevels, activeFloorId)) {
      showToast('ابتدا یک طبقهٔ واقعی بسازید؛ افزودن میز به بخش بدون طبقه مجاز نیست.', 'warning');
      return;
    }
    const nextId = (tables.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0)) + 1;
    const currentFloorZones = entitiesForFloor(floorZones, activeFloorId).map((zone) => normalizeZone(zone.name));
    const tableZoneNames = entitiesForFloor(tables, activeFloorId).map((table) => normalizeTableZoneValue(table.zone, normalizeZone));
    const allZonesList = Array.from(new Set([...currentFloorZones, ...tableZoneNames].filter(Boolean)));
    if (!allZonesList.length) allZonesList.push('بدون بخش');
    const targetZone = activeZone === 'all' ? (allZonesList[0] || 'بدون بخش') : activeZone;
    const defaultLabel = `میز ${nextId}`;

    showFloorModal({
      title: '➕ افزودن میز جدید به نقشه',
      confirmText: 'ایجاد و قرار دادن روی نقشه',
      confirmClass: 'btn-primary',
      bodyHtml: `
        <div class="floor-studio-modal__field">
          <label for="fm-table-label">نام یا شماره برچسب میز:</label>
          <input id="fm-table-label" type="text" value="${esc(defaultLabel)}" required />
        </div>
        <div class="floor-studio-modal__field">
          <label for="fm-table-floor">طبقه یا فضا:</label>
          <select id="fm-table-floor">
            ${floorLevels.map((fl) => `<option value="${esc(fl.id)}" ${fl.id === activeFloorId ? 'selected' : ''}>${esc(fl.icon || '🏛️')} ${esc(fl.name)}</option>`).join('')}
          </select>
        </div>
        <div class="floor-studio-modal__field">
          <label for="fm-table-zone">بخش سالن (زون):</label>
          <select id="fm-table-zone">
            ${allZonesList.map((z) => `<option value="${esc(z)}" ${z === targetZone ? 'selected' : ''}>${esc(z)}</option>`).join('')}
          </select>
        </div>
        <div class="floor-studio-modal__field">
          <label for="fm-table-seats">تعداد صندلی (ظرفیت پذیرایی):</label>
          <input id="fm-table-seats" type="number" min="1" max="24" value="4" required />
        </div>
        <div class="floor-studio-modal__field">
          <label>فرم هندسی میز:</label>
          <div class="floor-studio-modal__shape-grid" id="fm-table-shapes">
            <button type="button" class="floor-studio-modal__shape-btn is-active" data-shape="rectangle"><span>⬛</span><span>مستطیل</span></button>
            <button type="button" class="floor-studio-modal__shape-btn" data-shape="circle"><span>⭕</span><span>گرد</span></button>
            <button type="button" class="floor-studio-modal__shape-btn" data-shape="square"><span>⏹️</span><span>مربع</span></button>
            <button type="button" class="floor-studio-modal__shape-btn" data-shape="booth"><span>🛋️</span><span>نیمکت VIP</span></button>
            <button type="button" class="floor-studio-modal__shape-btn" data-shape="bar_stool"><span>🍸</span><span>صندلی بار</span></button>
            <button type="button" class="floor-studio-modal__shape-btn" data-shape="oval"><span>🥚</span><span>بیضی</span></button>
            <button type="button" class="floor-studio-modal__shape-btn" data-shape="lounge_takht"><span>🛏️</span><span>تخت سنتی</span></button>
          </div>
        </div>`,
      onConfirm: async (form) => {
        const chosenLabel = form.querySelector('#fm-table-label')?.value?.trim() || defaultLabel;
        const chosenFloor = form.querySelector('#fm-table-floor')?.value || activeFloorId;
        const chosenZone = normalizeTableZoneValue(form.querySelector('#fm-table-zone')?.value || targetZone, normalizeZone);
        const chosenSeats = normalizeSeatCapacity(form.querySelector('#fm-table-seats')?.value);
        const activeShapeBtn = form.querySelector('#fm-table-shapes .is-active');
        const chosenShape = activeShapeBtn?.dataset?.shape || 'rectangle';

        let initX = 30; let initY = 35;
        if (chosenZone === 'تراس') { initX = 70; initY = 35; }
        else if (chosenZone === 'ویژه') { initX = 70; initY = 80; }
        else if (chosenZone !== 'سالن') { initX = 50; initY = 50; }
        initX = Math.min(88, initX + ((tables.length % 4) * 4));
        initY = Math.min(88, initY + ((tables.length % 3) * 4));

        pushHistory();
        try {
          const res = await api('/api/admin/tables', {
            method: 'POST',
            body: JSON.stringify({ label: chosenLabel, seats: chosenSeats, zone: chosenZone, floorId: chosenFloor, branchId: currentBranchId(), x: initX, y: initY, shape: chosenShape, rotation: 0 }),
          });
          const created = res.table || { id: nextId, label: chosenLabel, seats: chosenSeats, zone: chosenZone, floorId: chosenFloor, branchId: currentBranchId(), x: initX, y: initY, shape: chosenShape, rotation: 0, active: true };
          ensureTableGeometry(created, tables.length);
          created.floorId = chosenFloor; created.state = 'available'; created.stateLabel = 'آزاد';
          tables.push(created);
          selectedTableId = created.id;
          activeFloorId = chosenFloor;
          const saved = await saveFloorLayout(true);
          render();
          if (saved) showToast(`میز جدید (${created.label}) به نقشه اضافه شد.`, 'success');
          else showLayoutSaveFailure();
          return true;
        } catch (err) {
          showToast(err.message || 'خطا در ساخت میز جدید', 'error');
          return false;
        }
      }
    });

    setTimeout(() => {
      document.getElementById('fm-table-shapes')?.querySelectorAll('.floor-studio-modal__shape-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          document.getElementById('fm-table-shapes').querySelectorAll('.floor-studio-modal__shape-btn').forEach((b) => b.classList.remove('is-active'));
          btn.classList.add('is-active');
        });
      });
    }, 60);
  };

  const deleteFloorTables = async (requestedIds) => {
    const ids = [...new Set((Array.isArray(requestedIds) ? requestedIds : [])
      .map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
    if (!ids.length) return { ok: false, reason: 'invalid_request' };
    if (hasLayoutRevisionConflict) {
      showLayoutSaveFailure();
      return { ok: false, reason: 'revision_conflict' };
    }
    if (isLayoutDirty) {
      queuedSaveFloor.cancel?.();
      const saved = await saveFloorLayout(true);
      if (!saved) {
        showLayoutSaveFailure();
        return { ok: false, reason: 'layout_save_failed' };
      }
    }
    if (!Number.isSafeInteger(floorData?.layoutRevision) || floorData.layoutRevision < 0) {
      showToast('نسخهٔ نقشه در دسترس نیست؛ ابتدا صفحه را دوباره بارگیری کنید.', 'error');
      return { ok: false, reason: 'revision_unavailable' };
    }

    try {
      const fresh = await api(`/api/admin/v2/floor${branchQuery()}`);
      if (!isUsableFloorDataSnapshot(fresh)) {
        showToast('وضعیت تازهٔ سالن تأیید نشد؛ برای ایمنی هیچ میزی حذف نشد.', 'error');
        return { ok: false, reason: 'floor_refresh_failed' };
      }
      if (fresh.layoutRevision !== floorData.layoutRevision) {
        hasLayoutRevisionConflict = true;
        updateSaveStatus(false);
        showToast('نسخهٔ نقشه تغییر کرده است؛ نسخهٔ تازه را آگاهانه بارگیری کنید. هیچ میزی حذف نشد.', 'error');
        return { ok: false, reason: 'revision_conflict' };
      }
      const latestTables = new Map(fresh.tables.map((table) => [Number(table.id), table]));
      tables = tables.map((table) => ({ ...table, ...(latestTables.get(Number(table.id)) || {}) }));
      const activeCallIds = activeWaiterCallTableIds(fresh.tables, ids);
      if (activeCallIds.length) {
        activeCallIds.forEach((id) => selectedTableIds.add(Number(id)));
        showToast('برای این میز یا یکی از میزهای متصل، فراخوان ویتر باز است؛ تا رسیدگی به آن حذف انجام نمی‌شود.', 'warning');
        return { ok: false, reason: 'active_waiter_call', ids: activeCallIds };
      }
      floorData = fresh;
      const response = await api(`/api/admin/v2/floor/tables/delete${branchQuery()}`, {
        method: 'POST',
        body: JSON.stringify({
          branchId: currentBranchId(),
          expectedLayoutRevision: floorData.layoutRevision,
          tableIds: ids,
        }),
      });
      const result = validateFloorTableDeleteResponse(response, ids);
      if (!result.ok) {
        showToast('پاسخ حذف میزها کامل یا معتبر نبود؛ نقشهٔ محلی تغییر نکرد.', 'error');
        return result;
      }

      const removed = new Set([...result.deletedIds, ...result.alreadyAbsentIds]);
      floorData = result.floor;
      const freshTables = new Map(result.floor.tables.map((table) => [Number(table.id), table]));
      removed.forEach((id) => selectedTableIds.delete(Number(id)));
      tables = tables
        .filter((table) => !removed.has(String(Number(table.id))))
        .map((table) => ({ ...table, ...(freshTables.get(Number(table.id)) || {}) }));
      if (selectedTableId != null && removed.has(String(Number(selectedTableId)))) selectedTableId = null;
      layoutHistory.clear();
      isLayoutDirty = false;
      updateSaveStatus(false);
      return { ...result, ok: true };
    } catch (error) {
      if (isFloorLayoutRevisionConflict(error)) {
        hasLayoutRevisionConflict = true;
        updateSaveStatus(false);
        showToast('نقشه در دستگاه دیگری تغییر کرده است؛ هیچ میزی حذف نشد. نسخهٔ تازه را آگاهانه بارگیری کنید.', 'error');
        return { ok: false, reason: 'revision_conflict' };
      }
      showToast(error?.message || 'حذف میزها تأیید نشد؛ وضعیت محلی حفظ شد.', 'error');
      return { ok: false, reason: 'request_failed' };
    }
  };

  const tableDeleteReasonLabel = (reason) => ({
    table_in_active_use: 'سفارش باز دارد',
    table_reserved: 'رزرو فعال دارد',
    open_waiter_call: 'فراخوان باز دارد',
    table_not_found: 'در این شعبه پیدا نشد',
  }[reason] || 'حذف نشد و نیازمند بررسی است');

  const showDeleteOutcome = (result, requestedCount) => {
    const completed = result.deletedIds.length + result.alreadyAbsentIds.length;
    if (result.rejected.length) {
      const reasons = [...new Set(result.rejected.map(({ reason }) => tableDeleteReasonLabel(reason)))].join('، ');
      showToast(`${fmtNum(completed)} میز حذف/تأیید شد؛ ${fmtNum(result.rejected.length)} میز باقی ماند (${reasons}).`, 'warning');
    } else if (completed === requestedCount) {
      showToast(`${fmtNum(result.deletedIds.length)} میز با تأیید سرور حذف شد.`, 'success');
    } else {
      showToast('نتیجهٔ حذف کامل نیست؛ موارد باقی‌مانده را دوباره بررسی کنید.', 'warning');
    }
  };

  const deleteTableFromMap = async (tableId) => {
    const table = tableById(tableId);
    if (!table) return;
    showFloorModal({
      title: '🗑️ تأیید حذف میز از سالن',
      confirmText: 'حذف میز',
      confirmClass: 'btn-danger',
      bodyHtml: `
        <p style="font-size:15px;color:#f8fafc;margin:0 0 8px">حذف «<strong>${esc(tableTitle(table))}</strong>» از همین شعبه بررسی می‌شود.</p>
        <p style="font-size:13px;color:#94a3b8;margin:0">اگر میز سفارش باز یا رزرو فعال داشته باشد، سرور حذف را رد می‌کند. پاسخ سرور مرجع نهایی است.</p>`,
      onConfirm: async () => {
        const result = await deleteFloorTables([tableId]);
        if (!result.ok) return false;
        result.rejected.forEach(({ id }) => selectedTableIds.add(Number(id)));
        render();
        showDeleteOutcome(result, 1);
        return true;
      },
    });
  };

  const batchDeleteSelectedTables = () => {
    if (selectedTableIds.size === 0) return;
    showFloorModal({
      title: `🗑️ حذف ${fmtNum(selectedTableIds.size)} میز انتخاب‌شده`,
      confirmText: 'بررسی و حذف در سرور',
      confirmClass: 'btn-danger',
      bodyHtml: `<p style="font-size:14px;color:#f8fafc">حذف برای هر میز در همین شعبه، با نسخهٔ فعلی نقشه بررسی می‌شود. میز دارای سفارش باز یا رزرو فعال باقی می‌ماند.</p>`,
      onConfirm: async () => {
        const idsToDelete = Array.from(selectedTableIds);
        const result = await deleteFloorTables(idsToDelete);
        if (!result.ok) return false;
        selectedTableIds.clear();
        result.rejected.forEach(({ id }) => selectedTableIds.add(Number(id)));
        if (selectedTableId != null && !result.rejected.some(({ id }) => Number(id) === Number(selectedTableId))) {
          selectedTableId = null;
        }
        render();
        showDeleteOutcome(result, idsToDelete.length);
        return true;
      },
    });
  };

  const promptRenameTable = (table) => {
    showFloorModal({
      title: `✏️ تغییر نام و برچسب ${tableTitle(table)}`,
      confirmText: 'ذخیره نام',
      confirmClass: 'btn-primary',
      bodyHtml: `<div class="floor-studio-modal__field"><label for="fm-rename-input">نام یا شماره میز:</label><input id="fm-rename-input" type="text" value="${esc(table.label || `میز ${table.id}`)}" required /></div>`,
      onConfirm: (form) => {
        const newName = form.querySelector('#fm-rename-input')?.value?.trim();
        if (!newName) return false;
        if (newName === table.label) return true;
        pushHistory();
        table.label = newName;
        debouncedSaveFloor(); render();
        showToast(`نام میز به «${table.label}» تغییر یافت.`, 'success');
        return true;
      }
    });
  };

  const mergeTablesGroup = (tableIds) => {
    const plan = planTableMerge(tables, tableIds, activeFloorId);
    if (!plan.ok) {
      const message = plan.reason === 'different_floor'
        ? 'فقط میزهای یک طبقه را می‌توان با هم ادغام کرد.'
        : plan.reason === 'already_merged'
          ? 'ابتدا پیوند ادغام قبلی را از میزهای انتخاب‌شده جدا کنید.'
          : plan.reason === 'minimum_tables'
            ? 'برای ادغام، حداقل ۲ میز را انتخاب کنید.'
            : 'یکی از میزهای انتخاب‌شده دیگر در این چیدمان وجود ندارد؛ انتخاب را تازه کنید.';
      showToast(message, 'warning');
      return false;
    }

    const tableByStringId = new Map(tables.map((table) => [String(table.id), table]));
    const groupTables = plan.memberIds.map((id) => tableByStringId.get(String(id))).filter(Boolean);
    if (groupTables.length < 2) return false;
    pushHistory();
    if (!applyTableMergePlan(tables, plan)) return false;
    debouncedSaveFloor(); render();
    showToast(`میزهای [${groupTables.map((t) => tableTitle(t)).join(' + ')}] با موفقیت ادغام شدند.`, 'success');
    return true;
  };

  const unmergeTable = (table) => {
    pushHistory();
    if (table.mergedWith && Array.isArray(table.mergedWith)) {
      const subIds = table.mergedWith.map(Number);
      tables.forEach((t) => { if (subIds.includes(Number(t.id))) { t.mergedInto = null; t.mergedWith = null; } });
      table.mergedWith = null;
    }
    if (table.mergedInto) {
      const master = tableById(table.mergedInto);
      if (master && Array.isArray(master.mergedWith)) {
        master.mergedWith = master.mergedWith.filter((id) => Number(id) !== Number(table.id));
        if (master.mergedWith.length === 0) master.mergedWith = null;
      }
      table.mergedInto = null;
    }
    debouncedSaveFloor(); render();
    showToast(`پیوند ${tableTitle(table)} تفکیک شد.`, 'info');
  };

  const alignSelectedTables = (alignment) => {
    const ids = Array.from(selectedTableIds).map(Number).filter(Boolean);
    if (ids.length < 2) return;
    const list = tables.filter((t) => ids.includes(Number(t.id)));
    if (list.length < 2) return;
    pushHistory();
    list.forEach(markTablePositioned);
    if (alignment === 'left') { const minX = Math.min(...list.map((t) => t.x)); list.forEach((t) => { t.x = minX; }); }
    else if (alignment === 'right') { const maxX = Math.max(...list.map((t) => t.x)); list.forEach((t) => { t.x = maxX; }); }
    else if (alignment === 'top') { const minY = Math.min(...list.map((t) => t.y)); list.forEach((t) => { t.y = minY; }); }
    else if (alignment === 'bottom') { const maxY = Math.max(...list.map((t) => t.y)); list.forEach((t) => { t.y = maxY; }); }
    else if (alignment === 'center-x') { const avgX = Math.round(list.reduce((sum, t) => sum + t.x, 0) / list.length); list.forEach((t) => { t.x = avgX; }); }
    else if (alignment === 'center-y') { const avgY = Math.round(list.reduce((sum, t) => sum + t.y, 0) / list.length); list.forEach((t) => { t.y = avgY; }); }
    debouncedSaveFloor(); render();
    showToast('هم‌ترازی میزها با موفقیت انجام شد.', 'success');
  };

  const distributeSelectedTables = (axis) => {
    const ids = Array.from(selectedTableIds).map(Number).filter(Boolean);
    if (ids.length < 3) { showToast('برای توزیع مساوی، حداقل ۳ میز لازم است.', 'warning'); return; }
    const list = tables.filter((t) => ids.includes(Number(t.id)));
    if (list.length < 3) return;
    pushHistory();
    list.forEach(markTablePositioned);
    if (axis === 'h') {
      list.sort((a, b) => a.x - b.x);
      const step = (list[list.length - 1].x - list[0].x) / (list.length - 1);
      list.forEach((t, i) => { t.x = Math.round((list[0].x + (i * step)) * 10) / 10; });
    } else {
      list.sort((a, b) => a.y - b.y);
      const step = (list[list.length - 1].y - list[0].y) / (list.length - 1);
      list.forEach((t, i) => { t.y = Math.round((list[0].y + (i * step)) * 10) / 10; });
    }
    debouncedSaveFloor(); render();
    showToast('فاصله میزها به طور یکنواخت توزیع شد.', 'success');
  };

  const autoAlignTables = async () => {
    if (!entitiesForFloor(tables, activeFloorId).length) {
      showToast('در این طبقه میزی برای مرتب‌سازی وجود ندارد.', 'info');
      return;
    }
    showFloorModal({
      title: '↺ مرتب‌سازی خودکار و مهندسی چیدمان',
      confirmText: 'اجرای مرتب‌سازی',
      confirmClass: 'btn-primary',
      bodyHtml: `
        <p style="font-size:14px;color:#f8fafc;margin:0 0 8px">آیا مایل به مرتب‌سازی خودکار و معماری میزها در بخش‌های سالن هستید؟</p>
        <p style="font-size:12px;color:#94a3b8;margin:0">میزهای سالن، تراس و سالن ویژه با فاصله‌گذاری استاندارد ۲ ستونه و فرم مهندسی بازچینی خواهند شد.</p>`,
      onConfirm: async () => {
        pushHistory();
        const byZone = groupTablesByZoneForFloor(tables, activeFloorId, (zone) => normalizeTableZoneValue(zone, normalizeZone));
        Array.from(byZone.values()).flat().forEach(markTablePositioned);

        const layoutZone = (list, xCols, baseX, baseY, yRange) => {
          const cols = xCols.length;
          const totalRows = Math.ceil(list.length / cols);
          const yStep = yRange / Math.max(1, totalRows);
          list.forEach((t, i) => {
            t.x = xCols[i % cols];
            t.y = Math.round(baseY + (Math.floor(i / cols) * yStep) + (yStep / 2));
            t.rotation = 0;
          });
        };

        if (byZone.has('سالن')) layoutZone(byZone.get('سالن'), [18, 36], 18, 20, 64);
        if (byZone.has('تراس')) layoutZone(byZone.get('تراس'), [62, 82], 62, 18, 32);
        if (byZone.has('ویژه')) { layoutZone(byZone.get('ویژه'), [62, 82], 62, 72, 24); byZone.get('ویژه').forEach((t) => { t.shape = 'booth'; }); }
        Array.from(byZone.keys()).forEach((z) => {
          if (['سالن', 'تراس', 'ویژه'].includes(z)) return;
          byZone.get(z).forEach((t, i) => { t.x = 48 + ((i % 3) * 16); t.y = 45 + (Math.floor(i / 3) * 18); });
        });

        const saved = await saveFloorLayout(true);
        render();
        if (saved) showToast('چیدمان میزها با موفقیت مرتب گردید.', 'success');
        else showLayoutSaveFailure();
        return true;
      }
    });
  };

  const deleteFixture = (fixtureId) => {
    pushHistory();
    floorFixtures = floorFixtures.filter((f) => f.id !== fixtureId);
    if (selectedFixtureId === fixtureId) selectedFixtureId = null;
    debouncedSaveFloor(); render();
    showToast('سازه از نقشه حذف گردید.', 'info');
  };

  const deleteZone = (zoneIdOrName) => {
    const currentFloorZones = entitiesForFloor(floorZones, activeFloorId);
    const zone = currentFloorZones.find((z) => z.id === zoneIdOrName || z.name === zoneIdOrName || normalizeZone(z.name) === normalizeZone(zoneIdOrName));
    if (!zone) return;
    const zoneName = zone.name;
    if (!zoneName) return;
    showFloorModal({
      title: `🗑️ حذف بخش «${esc(zoneName)}»`,
      confirmText: 'حذف بخش',
      confirmClass: 'btn-danger',
      bodyHtml: `
        <p style="font-size:14px;color:#f8fafc;margin:0 0 8px">آیا از حذف این بخش از نقشه سالن اطمینان دارید؟</p>
        <p style="font-size:12px;color:#94a3b8;margin:0">میزهای این بخش حذف نمی‌شوند و پس از حذف، بدون بخش باقی می‌مانند.</p>`,
      onConfirm: () => {
        const deletedName = zoneName;
        pushHistory();
        const result = removeZoneAndReassignTablesOnFloor(floorZones, tables, zone.id, 'بدون بخش', normalizeZone);
        if (result) floorZones = result.zones;
        if (activeZone === deletedName || normalizeZone(activeZone) === normalizeZone(deletedName)) activeZone = 'all';
        if (selectedZoneId === zone?.id || selectedZoneId === zoneIdOrName) selectedZoneId = null;
        debouncedSaveFloor(); render();
        showToast(`بخش «${deletedName}» حذف شد.`, 'success');
        return true;
      }
    });
  };

  const cycleZoneColor = (zone) => {
    const colors = ['blue', 'emerald', 'purple', 'amber', 'rose', 'cyan', 'slate'];
    const idx = colors.indexOf(zone.color || 'blue');
    pushHistory();
    zone.color = colors[(idx + 1) % colors.length];
    debouncedSaveFloor(); render();
    showToast(`رنگ بخش «${zone.name}» تغییر یافت.`, 'info');
  };

  const splitZone = (zone) => {
    pushHistory();
    let splitNameIndex = 2;
    while (isFloorZoneNameTaken(floorZones, `${zone.name} (بخش ${splitNameIndex})`, floorEntityId(zone), normalizeZone)) splitNameIndex += 1;
    const splitName = `${zone.name} (بخش ${splitNameIndex})`;
    if (zone.w >= zone.h) {
      const halfW = Math.round((zone.w / 2) * 10) / 10;
      const newZone = { ...zone, id: `zone-${Date.now()}`, name: splitName, x: zone.x + halfW, w: halfW, color: 'amber', icon: '🏷️' };
      zone.w = halfW;
      floorZones.push(newZone);
    } else {
      const halfH = Math.round((zone.h / 2) * 10) / 10;
      const newZone = { ...zone, id: `zone-${Date.now()}`, name: splitName, y: zone.y + halfH, h: halfH, color: 'amber', icon: '🏷️' };
      zone.h = halfH;
      floorZones.push(newZone);
    }
    debouncedSaveFloor(); render();
    showToast(`بخش «${zone.name}» به دو قسمت تقسیم شد.`, 'success');
  };

  const promptRenameZone = (zone) => {
    showFloorModal({
      title: `✏️ تغییر نام بخش «${esc(zone.name)}»`,
      confirmText: 'ذخیره نام',
      confirmClass: 'btn-primary',
      bodyHtml: `<div class="floor-studio-modal__field"><label for="fm-zone-rename">نام جدید بخش:</label><input id="fm-zone-rename" type="text" value="${esc(zone.name)}" required /></div>`,
      onConfirm: (form) => {
        const newName = form.querySelector('#fm-zone-rename')?.value?.trim();
        if (!newName) return false;
        const oldName = zone.name;
        if (newName === oldName) return true;
        if (isFloorZoneNameTaken(floorZones, newName, floorEntityId(zone), normalizeZone, zone.id)) {
          showToast('در همین طبقه بخشی با این نام وجود دارد.', 'warning');
          return false;
        }
        pushHistory();
        renameZoneAndTablesOnFloor(floorZones, tables, zone.id, newName, normalizeZone);
        if (normalizeZone(activeZone) === normalizeZone(oldName)) activeZone = newName;
        debouncedSaveFloor(); render();
        showToast(`نام بخش به «${newName}» تغییر یافت.`, 'success');
        return true;
      }
    });
  };

  const promptZoneDimensions = (zone) => {
    showFloorModal({
      title: `📏 متراژ ثبت‌شدهٔ بخش «${esc(zone.name)}»`,
      confirmText: 'ذخیره ابعاد',
      confirmClass: 'btn-primary',
      bodyHtml: `
        <p class="floor-zone-metrics-note">این اعداد متراژ واقعیِ ثبت‌شده‌اند. برای کوچک و بزرگ کردن محدودهٔ ترسیمی روی نقشه، لبه‌های نقطه‌چین را در حالت ویرایش بکشید.</p>
        <div class="floor-studio-modal__dim-row">
          <div class="floor-studio-modal__field">
            <label for="fm-zdim-len">طول بخش (متر):</label>
            <input id="fm-zdim-len" type="number" min="1" max="200" step="0.5" value="${zone.lengthM || 10}" required />
          </div>
          <div class="floor-studio-modal__field">
            <label for="fm-zdim-wid">عرض بخش (متر):</label>
            <input id="fm-zdim-wid" type="number" min="1" max="200" step="0.5" value="${zone.widthM || 3}" required />
          </div>
        </div>
        <div class="floor-studio-modal__area-badge" id="fm-zdim-area-badge">
          <span>📐 مساحت محاسبه‌شده:</span>
          <strong id="fm-zdim-area-val">${fmtNum(Math.round((zone.lengthM || 10) * (zone.widthM || 3) * 10) / 10)} متر مربع</strong>
        </div>`,
      onConfirm: (form) => {
        const lengthM = parseFloat(form.querySelector('#fm-zdim-len')?.value) || 10;
        const widthM = parseFloat(form.querySelector('#fm-zdim-wid')?.value) || 3;
        if (Number(zone.lengthM) === lengthM && Number(zone.widthM) === widthM) return true;
        pushHistory();
        zone.lengthM = lengthM;
        zone.widthM = widthM;
        zone.areaSqM = Math.round(lengthM * widthM * 10) / 10;
        debouncedSaveFloor(); render();
        showToast(`ابعاد بخش «${zone.name}» به ${fmtNum(lengthM)}×${fmtNum(widthM)} متر (${fmtNum(zone.areaSqM)}م²) تنظیم شد.`, 'success');
        return true;
      }
    });

    setTimeout(() => {
      const lInput = document.getElementById('fm-zdim-len');
      const wInput = document.getElementById('fm-zdim-wid');
      const areaVal = document.getElementById('fm-zdim-area-val');
      const updateArea = () => {
        const l = parseFloat(lInput?.value) || 0;
        const w = parseFloat(wInput?.value) || 0;
        if (areaVal) areaVal.textContent = `${fmtNum(Math.round(l * w * 10) / 10)} متر مربع`;
      };
      lInput?.addEventListener('input', updateArea);
      wInput?.addEventListener('input', updateArea);
    }, 50);
  };

  const promptCreateZone = (x, y, w, h) => {
    if (!requireConfiguredFloor('ترسیم بخش')) return;
    showFloorModal({
      title: '🌿 نام‌گذاری بخش جدید ترسیم‌شده',
      confirmText: 'ثبت بخش جدید',
      confirmClass: 'btn-primary',
      bodyHtml: `
        <p style="font-size:13px;color:#94a3b8;margin:0 0 10px">بخشی به ابعاد ${Math.round(w)}% × ${Math.round(h)}% در موقعیت (${Math.round(x)}%, ${Math.round(y)}%) ترسیم شد.</p>
        <div class="floor-studio-modal__field">
          <label for="fm-newzone-name">نام این بخش:</label>
          <input id="fm-newzone-name" type="text" value="بخش جدید" required autofocus />
        </div>
        <div class="floor-studio-modal__field" style="margin-top:8px">
          <label>رنگ بخش:</label>
          <div class="floor-studio-modal__shape-grid" id="fm-newzone-colors">
            <button type="button" class="floor-studio-modal__shape-btn is-active" data-color="blue"><span style="color:#38bdf8">🟦</span><span>آبی</span></button>
            <button type="button" class="floor-studio-modal__shape-btn" data-color="emerald"><span style="color:#4ade80">🟩</span><span>سبز</span></button>
            <button type="button" class="floor-studio-modal__shape-btn" data-color="purple"><span style="color:#c084fc">🟪</span><span>بنفش</span></button>
            <button type="button" class="floor-studio-modal__shape-btn" data-color="amber"><span style="color:#fbbf24">🟧</span><span>کهربایی</span></button>
            <button type="button" class="floor-studio-modal__shape-btn" data-color="rose"><span style="color:#fb7185">🟥</span><span>قرمز</span></button>
          </div>
        </div>`,
      onConfirm: (form) => {
        const name = form.querySelector('#fm-newzone-name')?.value?.trim();
        if (!name) return false;
        if (isFloorZoneNameTaken(floorZones, name, activeFloorId, normalizeZone)) {
          showToast('در همین طبقه بخشی با این نام وجود دارد.', 'warning');
          return false;
        }
        const color = form.querySelector('#fm-newzone-colors .is-active')?.dataset.color || 'blue';
        const newZone = { id: `zone-${Date.now()}`, name, x, y, w, h, color, icon: '🏷️', shape: 'rectangle', floorId: activeFloorId };
        pushHistory();
        floorZones.push(newZone);
        debouncedSaveFloor(); render();
        showToast(`بخش «${name}» ایجاد شد.`, 'success');
        return true;
      }
    });
    setTimeout(() => {
      const grid = document.getElementById('fm-newzone-colors');
      grid?.querySelectorAll('.floor-studio-modal__shape-btn').forEach((b) => {
        b.addEventListener('click', () => { grid.querySelectorAll('.floor-studio-modal__shape-btn').forEach((x) => x.classList.remove('is-active')); b.classList.add('is-active'); });
      });
    }, 50);
  };

  // promptAddZone, promptAddFloor, promptEditFloor, deleteFloor, promptMoveTableFloor,
  // promptAddFixture, promptFloorSettings, promptTableFurnitureModal,
  // exportLayoutJson, importLayoutJson
  // — همه از admin.js موجود استفاده می‌شوند از طریق opts.legacyActions
  const {
    promptAddZone, promptAddFloor, promptEditFloor, deleteFloor, promptMoveTableFloor,
    promptAddFixture, promptFloorSettings, promptTableFurnitureModal,
    exportLayoutJson, importLayoutJson, showTemplateModal,
  } = buildLegacyActions();

  const requireConfiguredFloor = (actionLabel) => {
    if (floorExists(floorLevels, activeFloorId)) return true;
    showToast(`برای ${actionLabel} ابتدا یک طبقهٔ واقعی بسازید یا یکی را انتخاب کنید.`, 'warning');
    return false;
  };

  function buildLegacyActions() {
    // این توابع کد یکسان با admin.js قبل را دارند
    // برای اختصار در اینجا به opts.legacyActions ارجاع می‌دهیم
    // در صورت عدم وجود، نسخه ساده ارائه می‌شود
    const la = opts.legacyActions || {};
    const ctx = {
      showFloorModal, floorZones, tables, floorLevels, floorFixtures, floorSettings,
      activeFloorId: () => activeFloorId,
      getActiveFloorId: () => activeFloorId,
      setActiveFloorId: (id) => { activeFloorId = id; },
      normalizeZone, esc, fmtNum, pushHistory, debouncedSaveFloor, saveFloorLayout,
      render, showToast, activeZone: () => activeZone,
      setActiveZone: (z) => { activeZone = z; },
      getFloorZones: () => floorZones,
      setFloorZones: (z) => { floorZones = z; },
      getFloorFixtures: () => floorFixtures,
      setFloorFixtures: (f) => { floorFixtures = f; },
      getFloorLevels: () => floorLevels,
      setFloorLevels: (l) => { floorLevels = l; },
      getFloorSettings: () => floorSettings,
      setFloorSettings: (s) => { floorSettings = s; },
      getTables: () => tables,
      setTables: (t) => { tables = t; },
      ensureTableGeometry,
    };

    // PromptAddZone
    const promptAddZone = la.promptAddZone
      ? () => { if (requireConfiguredFloor('افزودن بخش')) return la.promptAddZone(ctx); }
      : () => {
          if (!requireConfiguredFloor('افزودن بخش')) return;
          showFloorModal({
            title: '🌿 تعریف بخش جدید در سالن و تعیین متراژ',
            confirmText: 'ایجاد و چیدمان بخش',
            confirmClass: 'btn-primary',
            bodyHtml: `
              <div class="floor-studio-modal__field">
                <label for="fm-zone-name">نام بخش جدید سالن:</label>
                <input id="fm-zone-name" type="text" placeholder="نام بخش" required autofocus />
              </div>

              <div class="floor-studio-modal__dim-row">
                <div class="floor-studio-modal__field">
                  <label for="fm-zone-len">طول بخش (متر):</label>
                  <input id="fm-zone-len" type="number" min="1" max="200" step="0.5" required />
                </div>
                <div class="floor-studio-modal__field">
                  <label for="fm-zone-wid">عرض بخش (متر):</label>
                  <input id="fm-zone-wid" type="number" min="1" max="200" step="0.5" required />
                </div>
              </div>

              <div class="floor-studio-modal__area-badge" id="fm-zone-area-badge">
                <span>📐 مساحت محاسبه‌شده فضا:</span>
                <strong id="fm-zone-area-val">۰ متر مربع</strong>
              </div>

              <div class="floor-studio-modal__field" style="margin-top:12px">
                <label>فرم هندسی و نوع معماری بخش:</label>
                <div class="floor-studio-modal__shape-grid" id="fm-zone-shapes">
                  <button type="button" class="floor-studio-modal__shape-btn" data-shape="open-terrace">
                    <span style="font-size:18px">🌿</span><span>تراس و فضای باز</span>
                  </button>
                  <button type="button" class="floor-studio-modal__shape-btn is-active" data-shape="rectangle">
                    <span style="font-size:18px">⬛</span><span>مستطیل استاندارد</span>
                  </button>
                  <button type="button" class="floor-studio-modal__shape-btn" data-shape="l-shape">
                    <span style="font-size:18px">◱</span><span>ال‌شکل (L-Shape)</span>
                  </button>
                  <button type="button" class="floor-studio-modal__shape-btn" data-shape="corridor">
                    <span style="font-size:18px">▭</span><span>طولی و راهرویی</span>
                  </button>
                </div>
              </div>

              <div class="floor-studio-modal__field" style="margin-top:12px">
                <label>پوسته رنگی بخش:</label>
                <div class="floor-studio-modal__shape-grid" id="fm-zone-colors">
                  <button type="button" class="floor-studio-modal__shape-btn is-active" data-color="blue"><span style="color:#38bdf8">🟦</span><span>آبی دریا</span></button>
                  <button type="button" class="floor-studio-modal__shape-btn" data-color="emerald"><span style="color:#4ade80">🟩</span><span>سبز زمردی</span></button>
                  <button type="button" class="floor-studio-modal__shape-btn" data-color="purple"><span style="color:#c084fc">🟪</span><span>بنفش سلطنتی</span></button>
                  <button type="button" class="floor-studio-modal__shape-btn" data-color="amber"><span style="color:#fbbf24">🟧</span><span>کهربایی گرم</span></button>
                  <button type="button" class="floor-studio-modal__shape-btn" data-color="rose"><span style="color:#fb7185">🟥</span><span>سرخ رز</span></button>
                  <button type="button" class="floor-studio-modal__shape-btn" data-color="cyan"><span style="color:#22d3ee">🩵</span><span>فیروزه‌ای</span></button>
                </div>
              </div>`,
            onConfirm: (form) => {
              const name = form.querySelector('#fm-zone-name')?.value?.trim();
              if (!name) return false;
              if (isFloorZoneNameTaken(floorZones, name, activeFloorId, normalizeZone)) {
                showToast('در همین طبقه بخشی با این نام وجود دارد.', 'warning');
                return false;
              }
              const lengthM = parseFloat(form.querySelector('#fm-zone-len')?.value);
              const widthM  = parseFloat(form.querySelector('#fm-zone-wid')?.value);
              if (!Number.isFinite(lengthM) || lengthM < 1 || !Number.isFinite(widthM) || widthM < 1) {
                showToast('طول و عرض بخش را وارد کنید.', 'warning');
                return false;
              }
              const areaSqM = Math.round(lengthM * widthM * 10) / 10;
              const shape = form.querySelector('#fm-zone-shapes .is-active')?.dataset.shape || 'rectangle';
              const color = form.querySelector('#fm-zone-colors .is-active')?.dataset.color || 'blue';
              const icon  = shape === 'open-terrace' ? '🌿' : shape === 'corridor' ? '▭' : name.includes('ویژه') ? '👑' : '🏷️';

              // بخش جدید نباید بی‌اجازه روی بخش موجود بیفتد یا اندازهٔ آن را عوض کند.
              const calcW = Math.max(14, Math.min(85, Math.round((lengthM / 20) * 80)));
              const calcH = Math.max(10, Math.min(85, Math.round((widthM / 15) * 60)));
              const currentFloorZones = entitiesForFloor(floorZones, activeFloorId);
              const freeSlot = findFloorZonePlacement(currentFloorZones, calcW, calcH);
              if (!freeSlot) {
                showToast('برای این ابعاد فضای خالی کافی نیست؛ ابعاد را کم کنید یا ابتدا بخش‌ها را جابه‌جا کنید.', 'warning');
                return false;
              }
              pushHistory();
              const newZone = {
                id: `zone-${Date.now()}`, name,
                x: freeSlot.x, y: freeSlot.y, w: freeSlot.w, h: freeSlot.h,
                color, icon, lengthM, widthM, areaSqM, shape, floorId: activeFloorId,
              };
              floorZones.push(newZone);
              activeZone = name;
              debouncedSaveFloor();
              render();
              showToast(`بخش «${name}» با ابعاد ${fmtNum(lengthM)}×${fmtNum(widthM)} متر (${fmtNum(areaSqM)}م²) ایجاد شد.`, 'success');
              return true;
            },
          });

          setTimeout(() => {
            const lInput  = document.getElementById('fm-zone-len');
            const wInput  = document.getElementById('fm-zone-wid');
            const areaVal = document.getElementById('fm-zone-area-val');
            const updateArea = () => {
              const l = parseFloat(lInput?.value) || 0;
              const w = parseFloat(wInput?.value) || 0;
              if (areaVal) areaVal.textContent = `${fmtNum(Math.round(l * w * 10) / 10)} متر مربع`;
            };
            lInput?.addEventListener('input', updateArea);
            wInput?.addEventListener('input', updateArea);

            // radio selection grids
            ['fm-zone-shapes', 'fm-zone-colors'].forEach((gridId) => {
              const grid = document.getElementById(gridId);
              grid?.querySelectorAll('.floor-studio-modal__shape-btn').forEach((b) => {
                b.addEventListener('click', () => {
                  grid.querySelectorAll('.floor-studio-modal__shape-btn').forEach((x) => x.classList.remove('is-active'));
                  b.classList.add('is-active');
                });
              });
            });
          }, 50);
        };

    const promptAddFloor = la.promptAddFloor
      ? () => la.promptAddFloor(ctx)
      : () => {
          const nextLevel = floorLevels.length;
          showFloorModal({
            title: '🏢 تعریف طبقه یا فضای جدید رستوران',
            confirmText: 'ایجاد طبقه',
            confirmClass: 'btn-primary',
            bodyHtml: `
              <div class="floor-studio-modal__field">
                <label for="fm-floor-name">نام طبقه یا فضا:</label>
                <input id="fm-floor-name" type="text" placeholder="مثال: طبقه اول، روف‌گاردن، حیاط اختصاصی" required autofocus />
              </div>
              <div class="floor-studio-modal__dim-row">
                <div class="floor-studio-modal__field">
                  <label for="fm-floor-level">شماره تراز / طبقه:</label>
                  <input id="fm-floor-level" type="number" min="-2" max="20" value="${nextLevel}" required />
                </div>
                <div class="floor-studio-modal__field">
                  <label for="fm-floor-icon">آیکون فضا:</label>
                  <select id="fm-floor-icon">
                    <option value="🏛️">🏛️ سالن و عمارت</option>
                    <option value="☀️">☀️ روف‌گاردن و بام</option>
                    <option value="🌿">🌿 فضای باز و باغ</option>
                    <option value="👑">👑 سالن VIP</option>
                    <option value="☕">☕ کافه تریا</option>
                    <option value="🪜">🪜 نیم‌طبقه و بالکن</option>
                  </select>
                </div>
              </div>`,
            onConfirm: async (form) => {
              const name = form.querySelector('#fm-floor-name')?.value?.trim();
              if (!name) return false;
              const level = parseFloorLevel(form.querySelector('#fm-floor-level')?.value, nextLevel);
              const icon = form.querySelector('#fm-floor-icon')?.value || '🏛️';
              const id = `floor-${Date.now()}`;
              pushHistory();
              floorLevels.push({ id, name, level, icon, isDefault: floorLevels.length === 0 });
              activeFloorId = id;
              const saved = await saveFloorLayout(true);
              render();
              if (saved) showToast(`طبقه «${name}» ایجاد و نقشه آن فعال شد.`, 'success');
              else showLayoutSaveFailure();
              return true;
            }
          });
        };

    const promptEditFloor = la.promptEditFloor
      ? (floor) => la.promptEditFloor(floor, ctx)
      : (floor) => {
          showFloorModal({
            title: `⚙️ ویرایش مشخصات طبقه «${esc(floor.name)}»`,
            confirmText: 'ذخیره مشخصات',
            confirmClass: 'btn-primary',
            bodyHtml: `
              <div class="floor-studio-modal__field">
                <label for="fm-floor-edit-name">نام طبقه:</label>
                <input id="fm-floor-edit-name" type="text" value="${esc(floor.name)}" required />
              </div>
              <div class="floor-studio-modal__dim-row">
                <div class="floor-studio-modal__field">
                  <label for="fm-floor-edit-level">شماره تراز / طبقه:</label>
                  <input id="fm-floor-edit-level" type="number" min="-2" max="20" value="${floor.level || 0}" required />
                </div>
                <div class="floor-studio-modal__field">
                  <label for="fm-floor-edit-icon">آیکون فضا:</label>
                  <input id="fm-floor-edit-icon" type="text" value="${esc(floor.icon || '🏛️')}" />
                </div>
              </div>
              ${floorLevels.length > 1 ? `<div style="margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.1);display:flex;justify-content:flex-end"><button type="button" class="btn btn-sm btn-danger" id="fm-floor-delete-btn">🗑️ حذف کامل این طبقه</button></div>` : ''}`,
            onConfirm: async (form) => {
              const name = form.querySelector('#fm-floor-edit-name')?.value?.trim();
              if (!name) return false;
              const nextFloor = {
                ...floor,
                name,
                level: parseFloorLevel(form.querySelector('#fm-floor-edit-level')?.value, Number(floor.level) || 0),
                icon: form.querySelector('#fm-floor-edit-icon')?.value?.trim() || '🏛️',
              };
              if (nextFloor.name === floor.name && nextFloor.level === floor.level && nextFloor.icon === floor.icon) return true;
              pushHistory();
              Object.assign(floor, nextFloor);
              const saved = await saveFloorLayout(true);
              render();
              if (saved) showToast('مشخصات طبقه ذخیره گردید.', 'success');
              else showLayoutSaveFailure();
              return true;
            }
          });
          setTimeout(() => {
            document.getElementById('fm-floor-delete-btn')?.addEventListener('click', () => { deleteFloor(floor.id); });
          }, 60);
        };

    const deleteFloor = la.deleteFloor
      ? (floorId) => la.deleteFloor(floorId, ctx)
      : (floorId) => {
          if (floorLevels.length <= 1) { showToast('حداقل یک طبقه باید در رستوران فعال باشد.', 'warning'); return; }
          const floor = floorLevels.find((fl) => fl.id === floorId);
          if (!floor) return;
          showFloorModal({
            title: `🗑️ حذف طبقه «${esc(floor.name)}»`,
            confirmText: 'بله، حذف شود',
            confirmClass: 'btn-danger',
            bodyHtml: `<p style="font-size:14px;color:#f8fafc;margin:0 0 8px">آیا از حذف این طبقه اطمینان دارید؟</p><p style="font-size:12px;color:#94a3b8;margin:0">میزها و سازه‌های متعلق به این طبقه به اولین طبقهٔ باقی‌مانده منتقل خواهند شد.</p>`,
            onConfirm: async () => {
              pushHistory();
              const fallbackFloorId = floorLevels.find((fl) => fl.id !== floorId)?.id || UNASSIGNED_FLOOR_ID;
              tables.forEach((t) => { if (floorEntityId(t) === floorId) t.floorId = fallbackFloorId; });
              floorFixtures.forEach((f) => { if (floorEntityId(f) === floorId) f.floorId = fallbackFloorId; });
              floorZones.forEach((z) => { if (floorEntityId(z) === floorId) z.floorId = fallbackFloorId; });
              floorLevels = floorLevels.filter((fl) => fl.id !== floorId);
              if (activeFloorId === floorId) activeFloorId = fallbackFloorId;
              const saved = await saveFloorLayout(true);
              render();
              if (saved) showToast(`طبقه «${floor.name}» حذف گردید.`, 'success');
              else showLayoutSaveFailure();
              return true;
            }
          });
        };

    const promptMoveTableFloor = la.promptMoveTableFloor
      ? (table) => la.promptMoveTableFloor(table, ctx)
      : (table) => {
          const initialFloorId = floorEntityId(table);
          const initialZones = floorZoneOptionsForMove(floorZones, tables, initialFloorId, normalizeZone);
          const initialZone = preferredFloorZone(initialZones, table.zone, normalizeZone);
          showFloorModal({
            title: `🏢 انتقال ${tableTitle(table)} به طبقه دیگر`,
            confirmText: 'انتقال میز',
            confirmClass: 'btn-primary',
            bodyHtml: `
              <div class="floor-studio-modal__field">
                <label for="fm-target-floor">طبقه مقصد:</label>
                <select id="fm-target-floor">${floorLevels.map((fl) => `<option value="${esc(fl.id)}" ${initialFloorId === fl.id ? 'selected' : ''}>${esc(fl.icon || '🏛️')} ${esc(fl.name)}</option>`).join('')}</select>
              </div>
              <div class="floor-studio-modal__field">
                <label for="fm-target-zone">بخش در طبقه مقصد:</label>
                <select id="fm-target-zone">${initialZones.map((zone) => `<option value="${esc(zone)}" ${zone === initialZone ? 'selected' : ''}>${esc(zone)}</option>`).join('')}</select>
                <small>اگر بخش هم‌نام در مقصد نباشد، میز به «بدون بخش» منتقل می‌شود.</small>
              </div>
              <p role="note">میزِ در سرویس، رزروشده یا دارای فراخوان را پس از پایان عملیات جابه‌جا کنید.</p>`,
            onConfirm: async (form) => {
              const targetFloorId = form.querySelector('#fm-target-floor')?.value;
              const targetZone = form.querySelector('#fm-target-zone')?.value || 'بدون بخش';
              if (!targetFloorId) return false;
              if (['busy', 'reserved', 'attention'].includes(String(table.state || '')) || table.waiterCallId) {
                showToast('این میز در سرویس، رزرو یا فراخوان فعال است؛ پس از پایان عملیات آن را جابه‌جا کنید.', 'warning');
                return false;
              }
              if (targetFloorId === floorEntityId(table)
                  && normalizeZone(targetZone) === normalizeZone(normalizeTableZoneValue(table.zone, normalizeZone))) return true;
              pushHistory();
              table.floorId = targetFloorId;
              markTableZoneAssigned(table, targetZone, normalizeZone);
              activeFloorId = targetFloorId;
              const saved = await saveFloorLayout(true); render();
              if (saved) showToast(`${tableTitle(table)} به طبقه انتخابی منتقل شد.`, 'success');
              else showLayoutSaveFailure();
              return true;
            }
          });
          setTimeout(() => {
            const floorSelect = document.getElementById('fm-target-floor');
            const zoneSelect = document.getElementById('fm-target-zone');
            const refreshZones = () => {
              if (!floorSelect || !zoneSelect) return;
              const choices = floorZoneOptionsForMove(floorZones, tables, floorSelect.value, normalizeZone);
              const preferred = floorSelect.value === initialFloorId ? table.zone : '';
              const selected = preferredFloorZone(choices, preferred, normalizeZone);
              zoneSelect.innerHTML = choices.map((zone) => `<option value="${esc(zone)}" ${zone === selected ? 'selected' : ''}>${esc(zone)}</option>`).join('');
            };
            floorSelect?.addEventListener('change', refreshZones);
            refreshZones();
          }, 50);
        };

    const promptAddFixture = la.promptAddFixture
      ? () => { if (requireConfiguredFloor('افزودن المان')) return la.promptAddFixture(ctx); }
      : () => {
          if (!requireConfiguredFloor('افزودن المان')) return;
          const fixturePresets = [
            { type: 'entrance',  name: 'ورودی اصلی',               icon: '🚪', color: 'emerald', w: 7,  h: 10 },
            { type: 'exit',      name: 'درب خروج اضطراری',          icon: '🚪', color: 'rose',    w: 6,  h: 8  },
            { type: 'bar',       name: 'کافه بار و پیشخوان',        icon: '☕', color: 'amber',   w: 18, h: 8  },
            { type: 'kitchen',   name: 'تحویل غذا و مطبخ',          icon: '🍳', color: 'rose',    w: 16, h: 8  },
            { type: 'cashier',   name: 'صندوق و حسابداری',          icon: '💳', color: 'cyan',    w: 12, h: 8  },
            { type: 'restroom',  name: 'سرویس بهداشتی',             icon: '🚻', color: 'purple',  w: 10, h: 10 },
            { type: 'wall',      name: 'دیوار جداکننده',            icon: '🧱', color: 'slate',   w: 20, h: 3  },
            { type: 'door',      name: 'درب تردد داخلی',            icon: '🚪', color: 'slate',   w: 6,  h: 4  },
            { type: 'stairs',    name: 'راه‌پله طبقات',             icon: '🪜', color: 'slate',   w: 12, h: 10 },
            { type: 'elevator',  name: 'آسانسور سالن',              icon: '🛗', color: 'blue',    w: 8,  h: 8  },
            { type: 'pillar',    name: 'ستون معماری',               icon: '🏛️', color: 'slate',   w: 5,  h: 5  },
            { type: 'stage',     name: 'استیج موسیقی و سن',         icon: '🎭', color: 'purple',  w: 24, h: 12 },
            { type: 'plant',     name: 'گلدان و فضای سبز',          icon: '🪴', color: 'emerald', w: 6,  h: 6  },
            { type: 'buffet',    name: 'بوفه سلف سرویس',            icon: '🥗', color: 'amber',   w: 22, h: 8  },
          ];

          showFloorModal({
            title: '🏛️ افزودن سازه یا المان معماری به نقشه سالن',
            confirmText: 'افزودن سازه',
            confirmClass: 'btn-primary',
            modalClass: 'floor-studio-modal--wide',
            bodyHtml: `
              <div class="floor-studio-modal__field">
                <label>نوع سازه و المان معماری را انتخاب کنید:</label>
                <div class="floor-studio-modal__shape-grid" id="fm-fixture-types"
                  style="grid-template-columns:repeat(auto-fill,minmax(110px,1fr));max-height:220px;overflow-y:auto">
                  ${fixturePresets.map((p, idx) => `
                    <button type="button" class="floor-studio-modal__shape-btn ${idx === 0 ? 'is-active' : ''}"
                      data-type="${esc(p.type)}" data-name="${esc(p.name)}"
                      data-icon="${p.icon}" data-color="${esc(p.color)}"
                      data-w="${p.w}" data-h="${p.h}">
                      <span style="font-size:20px">${p.icon}</span>
                      <span style="font-size:11px">${esc(p.name)}</span>
                    </button>
                  `).join('')}
                </div>
              </div>
              <div class="floor-studio-modal__field" style="margin-top:10px">
                <label for="fm-fixture-name">عنوان روی نقشه:</label>
                <input id="fm-fixture-name" type="text" value="${esc(fixturePresets[0].name)}" required />
              </div>
              <div class="floor-studio-modal__dim-row">
                <div class="floor-studio-modal__field">
                  <label for="fm-fixture-w">عرض تقریبی (درصد پلان):</label>
                  <input id="fm-fixture-w" type="number" min="2" max="80" value="${fixturePresets[0].w}" required />
                </div>
                <div class="floor-studio-modal__field">
                  <label for="fm-fixture-h">ارتفاع تقریبی (درصد پلان):</label>
                  <input id="fm-fixture-h" type="number" min="2" max="80" value="${fixturePresets[0].h}" required />
                </div>
              </div>`,
            onConfirm: async (form) => {
              const activeBtn = form.querySelector('#fm-fixture-types .is-active');
              const type  = activeBtn?.dataset?.type  || 'wall';
              const icon  = activeBtn?.dataset?.icon  || '🏛️';
              const color = activeBtn?.dataset?.color || 'slate';
              const name  = form.querySelector('#fm-fixture-name')?.value?.trim() || 'سازه';
              const w = Math.max(3, Math.min(80, parseFloat(form.querySelector('#fm-fixture-w')?.value) || 10));
              const h = Math.max(3, Math.min(80, parseFloat(form.querySelector('#fm-fixture-h')?.value) || 10));

              pushHistory();
              const newFixture = {
                id: `fix-${Date.now()}`,
                type, name, icon, color, w, h,
                x: 45, y: 45, rotation: 0,
                floorId: activeFloorId,
              };
              floorFixtures.push(newFixture);
              selectedFixtureId = newFixture.id;
              const saved = await saveFloorLayout(true);
              render();
              if (saved) showToast(`سازه «${name}» به نقشه افزوده شد.`, 'success');
              else showLayoutSaveFailure();
              return true;
            },
          });

          setTimeout(() => {
            const grid = document.getElementById('fm-fixture-types');
            grid?.querySelectorAll('.floor-studio-modal__shape-btn').forEach((btn) => {
              btn.addEventListener('click', () => {
                grid.querySelectorAll('.floor-studio-modal__shape-btn').forEach((b) => b.classList.remove('is-active'));
                btn.classList.add('is-active');
                const nameInput = document.getElementById('fm-fixture-name');
                const wInput    = document.getElementById('fm-fixture-w');
                const hInput    = document.getElementById('fm-fixture-h');
                if (nameInput && btn.dataset.name) nameInput.value = btn.dataset.name;
                if (wInput && btn.dataset.w) wInput.value = btn.dataset.w;
                if (hInput && btn.dataset.h) hInput.value = btn.dataset.h;
              });
            });
          }, 60);
        };

    const promptFloorSettings = la.promptFloorSettings
      ? () => { if (requireConfiguredFloor('تنظیمات پلان')) return la.promptFloorSettings(ctx); }
      : () => {
          if (!requireConfiguredFloor('تنظیمات پلان')) return;
          showFloorModal({
            title: '⚙️ تنظیمات معماری و مقیاس نقشه سالن',
            confirmText: 'ذخیره تنظیمات',
            confirmClass: 'btn-primary',
            bodyHtml: `
              <div class="floor-studio-modal__dim-row">
                <div class="floor-studio-modal__field"><label for="fm-sett-len">طول کلی سالن (متر):</label><input id="fm-sett-len" type="number" min="5" max="200" step="0.5" value="${floorSettings.lengthM || 20}" required /></div>
                <div class="floor-studio-modal__field"><label for="fm-sett-wid">عرض کلی سالن (متر):</label><input id="fm-sett-wid" type="number" min="5" max="200" step="0.5" value="${floorSettings.widthM || 15}" required /></div>
              </div>
              <div class="floor-studio-modal__field" style="margin-top:10px">
                <label for="fm-sett-theme">تم گرافیکی و رنگ پس‌زمینه نقشه:</label>
                <select id="fm-sett-theme">
                  <option value="slate-blueprint" ${floorSettings.bgTheme === 'slate-blueprint' ? 'selected' : ''}>نقشه مهندسی تیره (Blueprint Dark)</option>
                  <option value="midnight-dark" ${floorSettings.bgTheme === 'midnight-dark' ? 'selected' : ''}>مشکی شبانه لوکس (Midnight Black)</option>
                  <option value="warm-luxury" ${floorSettings.bgTheme === 'warm-luxury' ? 'selected' : ''}>چوب گرم و کلاسیک (Warm Luxury)</option>
                  <option value="paper-white" ${floorSettings.bgTheme === 'paper-white' ? 'selected' : ''}>کاغذ سفید CAD (Clean White)</option>
                </select>
              </div>
              <div class="floor-studio-modal__field" style="margin-top:12px">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                  <input type="checkbox" id="fm-sett-rulers" ${floorSettings.showRulers !== false ? 'checked' : ''} />
                  <span>نمایش خط‌کش متراژ مهندسی (CAD Rulers) دور نقشه</span>
                </label>
              </div>
              <div class="floor-studio-modal__field" style="margin-top:6px">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                  <input type="checkbox" id="fm-sett-grid" ${floorSettings.showGrid !== false ? 'checked' : ''} />
                  <span>نمایش خطوط شطرنجی و شبکه هدایتگر (Grid Lines)</span>
                </label>
              </div>`,
            onConfirm: async (form) => {
              const nextSettings = {
                ...floorSettings,
                lengthM: parseFloat(form.querySelector('#fm-sett-len')?.value) || 20,
                widthM: parseFloat(form.querySelector('#fm-sett-wid')?.value) || 15,
                bgTheme: form.querySelector('#fm-sett-theme')?.value || 'slate-blueprint',
                showRulers: form.querySelector('#fm-sett-rulers')?.checked,
                showGrid: form.querySelector('#fm-sett-grid')?.checked,
              };
              if (JSON.stringify(nextSettings) === JSON.stringify(floorSettings)) return true;
              pushHistory();
              floorSettings = nextSettings;
              const saved = await saveFloorLayout(true); render();
              if (saved) showToast('تنظیمات مقیاس و ظاهر نقشه سالن به‌روز شد.', 'success');
              else showLayoutSaveFailure();
              return true;
            }
          });
        };

    const promptTableFurnitureModal = la.promptTableFurnitureModal
      ? (table) => la.promptTableFurnitureModal(table, ctx)
      : (table) => {
          // ── استودیوی کامل مبلمان (بدون نیاز به admin.js) ──────────────
          let curShape = table.shape || 'rectangle';
          let curChair = table.chairModel || (
            curShape === 'bar_stool' || curShape === 'wall_counter' ? 'bar_stool'
              : curShape === 'lounge_takht' ? 'bolster'
                : 'standard'
          );
          let curSeats = normalizeSeatCapacity(table.seats);

          const shapesDef = [
            { id: 'rectangle',    name: 'مستطیل استاندارد',         icon: '⬛', desc: 'کلاسیک رستورانی، ۲ تا ۱۲ نفر' },
            { id: 'conference',   name: 'میز کنفرانس و تشریفات',   icon: '🏛️', desc: 'یک‌تکه بزرگ، ۶ تا ۲۴ نفر با صندلی صدر' },
            { id: 'semi_circle',  name: 'نیم‌دایره و هلال',         icon: '🌙', desc: 'مبل هلالی با نشیمن شعاعی دورچین' },
            { id: 'wall_counter', name: 'کانتر کنار دیواری',        icon: '🪟', desc: 'میز یک‌طرفه متصل به دیوار یا پنجره' },
            { id: 'round_booth',  name: 'مبل گرد نعل‌اسبی',         icon: '🛋️', desc: 'نیمکت منحنی سرتاسری با میز گرد' },
            { id: 'circle',       name: 'میز گرد',                  icon: '⭕', desc: 'صمیمی و ارگونومیک، ۲ تا ۱۰ نفر' },
            { id: 'square',       name: 'میز مربع',                  icon: '⏹️', desc: 'کافه و دونفره، ۲ تا ۸ نفر' },
            { id: 'booth',        name: 'نیمکت و مبل VIP',           icon: '🛋️', desc: 'پشتی لمسه‌کوبی روبه‌روی هم' },
            { id: 'bar_stool',    name: 'صندلی بار و کانتر',        icon: '🍸', desc: 'پایه بلند و کم‌جا' },
            { id: 'oval',         name: 'بیضی تشریفاتی',            icon: '🥚', desc: 'مهمانی و سالن اصلی' },
            { id: 'lounge_takht', name: 'تخت سنتی ایرانی',          icon: '🛏️', desc: 'تخت چوبی با فرش و پشتی' },
          ];

          const chairsDef = [
            { id: 'standard',    name: 'صندلی استاندارد رستورانی',        icon: '🪑' },
            { id: 'armchair',    name: 'مبل تک‌نفره دسته‌دار لوکس',       icon: '🛋️' },
            { id: 'bar_stool',   name: 'صندلی پایه بلند بار و کانتر',    icon: '🍸' },
            { id: 'booth_bench', name: 'نیمکت چرمی پیوسته',               icon: '🧽' },
            { id: 'bolster',     name: 'پشتی و متکای سنتی',               icon: '🪡' },
          ];

          const bodyHtml = `
            <div class="furniture-grid-group">
              <span class="furniture-grid-group__title">📐 انتخاب فرم هندسی میز:</span>
              <div class="furniture-shapes-grid" id="fm-shapes-grid">
                ${shapesDef.map((s) => `
                  <button type="button" class="furniture-shape-card ${curShape === s.id ? 'is-active' : ''}" data-shape-choice="${esc(s.id)}" aria-pressed="${curShape === s.id}">
                    <span class="furniture-shape-card__icon">${s.icon}</span>
                    <span class="furniture-shape-card__name">${esc(s.name)}</span>
                    <span class="furniture-shape-card__desc">${esc(s.desc)}</span>
                  </button>
                `).join('')}
              </div>
            </div>

            <div class="furniture-grid-group">
              <span class="furniture-grid-group__title">🪑 مدل و استایل صندلی‌ها:</span>
              <div class="furniture-chairs-row" id="fm-chairs-row">
                ${chairsDef.map((c) => `
                  <button type="button" class="furniture-chair-pill ${curChair === c.id ? 'is-active' : ''}" data-chair-choice="${esc(c.id)}" aria-pressed="${curChair === c.id}">
                    <span>${c.icon}</span>
                    <span>${esc(c.name)}</span>
                  </button>
                `).join('')}
              </div>
            </div>

            <div class="furniture-grid-group">
              <span class="furniture-grid-group__title">👥 ظرفیت صندلی‌ها:</span>
              <div class="furniture-seats-stepper">
                <button type="button" class="palette-mini-btn" id="fm-seat-dec">−</button>
                <input type="number" id="fm-seats-input" min="1" max="24" value="${curSeats}" aria-label="ظرفیت صندلی میز"
                  style="width:55px;text-align:center;background:#1e293b;border:1px solid rgba(255,255,255,0.2);color:#fff;border-radius:6px;font-weight:900">
                <button type="button" class="palette-mini-btn" id="fm-seat-inc">＋</button>
                <span style="font-size:11px;color:#94a3b8">نفر</span>
              </div>
              <div class="furniture-seats-presets">
                ${[1, 2, 4, 6, 8, 10, 12, 16, 20, 24].map((cnt) => `
                  <button type="button" class="furniture-seat-preset ${curSeats === cnt ? 'is-active' : ''}" data-seat-preset="${cnt}" aria-pressed="${curSeats === cnt}">
                    ${fmtNum(cnt)} نفره
                  </button>
                `).join('')}
              </div>
            </div>`;

          showFloorModal({
            title: `🛋️ استودیوی چیدمان مبلمان و صندلی (${esc(tableTitle(table))})`,
            confirmText: 'اعمال روی میز و ذخیره',
            confirmClass: 'btn-primary',
            modalClass: 'floor-studio-modal--wide',
            bodyHtml,
            onConfirm: () => {
              pushHistory();
              table.shape = curShape;
              table.chairModel = curChair;
              table.seats = curSeats;
              debouncedSaveFloor();
              render();
              showToast(`فرم «${shapeTitle(curShape)}» با ${fmtNum(curSeats)} صندلی اعمال شد.`, 'success');
              return true;
            },
          });

          // ── Interactive bindings داخل modal ──
          setTimeout(() => {
            const modalEl = document.getElementById('floor-modal-backdrop');
            if (!modalEl) return;

            // انتخاب فرم هندسی
            modalEl.querySelectorAll('[data-shape-choice]').forEach((card) => {
              card.addEventListener('click', () => {
                curShape = card.dataset.shapeChoice;
                modalEl.querySelectorAll('[data-shape-choice]').forEach((c) => {
                  const selected = c === card;
                  c.classList.toggle('is-active', selected);
                  c.setAttribute('aria-pressed', String(selected));
                });
                // auto-select مناسب‌ترین مدل صندلی
                if (curShape === 'bar_stool' || curShape === 'wall_counter') curChair = 'bar_stool';
                else if (curShape === 'lounge_takht') curChair = 'bolster';
                modalEl.querySelectorAll('[data-chair-choice]').forEach((c) => {
                  const selected = c.dataset.chairChoice === curChair;
                  c.classList.toggle('is-active', selected);
                  c.setAttribute('aria-pressed', String(selected));
                });
              });
            });

            // انتخاب مدل صندلی
            modalEl.querySelectorAll('[data-chair-choice]').forEach((pill) => {
              pill.addEventListener('click', () => {
                curChair = pill.dataset.chairChoice;
                modalEl.querySelectorAll('[data-chair-choice]').forEach((p) => {
                  const selected = p === pill;
                  p.classList.toggle('is-active', selected);
                  p.setAttribute('aria-pressed', String(selected));
                });
              });
            });

            // stepper تعداد نفر
            const seatInp = modalEl.querySelector('#fm-seats-input');
            const syncSeats = (val) => {
              curSeats = normalizeSeatCapacity(val, 1);
              if (seatInp) seatInp.value = curSeats;
              modalEl.querySelectorAll('[data-seat-preset]').forEach((b) => {
                const selected = Number(b.dataset.seatPreset) === curSeats;
                b.classList.toggle('is-active', selected);
                b.setAttribute('aria-pressed', String(selected));
              });
            };

            modalEl.querySelector('#fm-seat-dec')?.addEventListener('click', () => syncSeats(curSeats - 1));
            modalEl.querySelector('#fm-seat-inc')?.addEventListener('click', () => syncSeats(curSeats + 1));
            seatInp?.addEventListener('input', () => syncSeats(Number(seatInp.value)));

            // preset buttons
            modalEl.querySelectorAll('[data-seat-preset]').forEach((btn) => {
              btn.addEventListener('click', () => syncSeats(Number(btn.dataset.seatPreset)));
            });
          }, 30);
        };

    const exportLayoutJson = la.exportLayoutJson
      ? () => la.exportLayoutJson(ctx)
      : () => {
          const data = { version: '1.3.0', exportTimestamp: new Date().toISOString(), branchId: currentBranchId(), settings: floorSettings, floors: floorLevels, zones: floorZones, fixtures: floorFixtures, tables: tables.map((t) => ({ id: t.id, label: t.label, seats: t.seats, ...tableZoneForSave(t, normalizeZone), ...floorIdForPersistence(t), shape: t.shape || 'rectangle', chairModel: t.chairModel || null, chairScale: t.chairScale || 1, tableScale: t.scale || t.tableScale || 1, tableScaleX: t.scaleX ?? t.tableScaleX ?? t.scale ?? t.tableScale ?? 1, tableScaleY: t.scaleY ?? t.tableScaleY ?? t.scale ?? t.tableScale ?? 1, ...tableCoordinatesForSave(t), rotation: t.rotation || 0, active: t.active !== false, mergedWith: t.mergedWith || null, mergedInto: t.mergedInto || null, tags: t.tags || [] })) };
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = `westo-floor-plan-branch-${currentBranchId() || 'default'}-${new Date().toISOString().slice(0, 10)}.json`;
          document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
          showToast('فایل پشتیبان چیدمان سالن با موفقیت دانلود شد.', 'success');
        };

    const importLayoutJson = la.importLayoutJson
      ? () => la.importLayoutJson(ctx)
      : () => {
          showFloorModal({
            title: '📂 بازیابی و درون‌ریزی فایل چیدمان سالن',
            confirmText: 'اعمال فایل چیدمان',
            confirmClass: 'btn-primary',
            bodyHtml: `
              <p style="font-size:13px;color:#94a3b8;margin:0 0 12px">فایل JSON خروجی گرفته‌شده از استودیو را انتخاب کنید یا محتوای آن را وارد نمایید:</p>
              <div class="floor-studio-modal__field">
                <label for="fm-import-file">انتخاب فایل چیدمان (.json):</label>
                <input id="fm-import-file" type="file" accept=".json,application/json" style="padding:6px;background:rgba(255,255,255,0.05);border-radius:6px" />
              </div>
              <div class="floor-studio-modal__field" style="margin-top:10px">
                <label for="fm-import-text">یا متن JSON را مستقیماً جای‌گذاری کنید:</label>
                <textarea id="fm-import-text" rows="5" placeholder="کدهای JSON را اینجا الصاق کنید..." style="font-family:monospace;font-size:11px"></textarea>
              </div>
            `,
            onConfirm: async (form) => {
              const fileInput = form.querySelector('#fm-import-file');
              const textInput = form.querySelector('#fm-import-text');
              let content = textInput?.value?.trim();

              if (!content && fileInput?.files?.[0]) {
                content = await fileInput.files[0].text();
              }

              if (!content) {
                showToast('لطفاً یک فایل یا متن معتبر وارد کنید.', 'warning');
                return false;
              }

              try {
                const parsed = JSON.parse(content);
                if (!parsed || (!Array.isArray(parsed.tables) && !Array.isArray(parsed.zones))) {
                  throw new Error('فرمت فایل پشتیبان معتبر نیست.');
                }
                if (!isLayoutImportBranchCompatible(parsed.branchId, currentBranchId())) {
                  throw new Error('این فایل پشتیبان برای شعبهٔ دیگری است؛ برای جلوگیری از جایگزینی چیدمان، بازیابی متوقف شد.');
                }

                const isRecord = (row) => Boolean(row && typeof row === 'object' && !Array.isArray(row));
                for (const key of ['tables', 'zones', 'fixtures', 'floors']) {
                  if (Array.isArray(parsed[key]) && !parsed[key].every(isRecord)) {
                    throw new Error(`ساختار بخش «${key}» در فایل پشتیبان معتبر نیست.`);
                  }
                }
                if (parsed.settings != null && (!isRecord(parsed.settings))) {
                  throw new Error('ساختار تنظیمات در فایل پشتیبان معتبر نیست.');
                }

                const importedFloors = Array.isArray(parsed.floors) ? parsed.floors.map((floor) => ({ ...floor })) : null;
                const importedZones = Array.isArray(parsed.zones) ? parsed.zones.map((zone) => ({ ...zone })) : null;
                const importedFixtures = Array.isArray(parsed.fixtures) ? parsed.fixtures.map((fixture) => ({ ...fixture })) : null;
                const importedTables = Array.isArray(parsed.tables) ? parsed.tables.map((table, index) => {
                  const copy = { ...table };
                  ensureTableGeometry(copy, index);
                  return copy;
                }) : null;

                pushHistory();
                if (importedFloors && importedFloors.length > 0) {
                  floorLevels = importedFloors;
                  activeFloorId = floorLevels[0].id;
                }
                if (importedZones) {
                  floorZones = importedZones;
                }
                if (importedFixtures) {
                  floorFixtures = importedFixtures;
                }
                if (parsed.settings && typeof parsed.settings === 'object') {
                  floorSettings = { ...floorSettings, ...parsed.settings };
                }
                if (importedTables) {
                  tables = importedTables;
                }
                const saved = await saveFloorLayout(true);
                if (!saved) return false;
                render();
                showToast('چیدمان نقشه با موفقیت از فایل بازیابی شد.', 'success');
                return true;
              } catch (err) {
                showToast(err.message || 'خطا در پردازش فایل JSON', 'error');
                return false;
              }
            }
          });

          setTimeout(() => {
            const fileEl = document.getElementById('fm-import-file');
            const textEl = document.getElementById('fm-import-text');
            fileEl?.addEventListener('change', async () => {
              if (fileEl.files?.[0]) {
                try {
                  const t = await fileEl.files[0].text();
                  if (textEl) textEl.value = t;
                } catch (_) {}
              }
            });
          }, 50);
        };

    const showTemplateModal = () => {
          if (!floorExists(floorLevels, activeFloorId)
              || !isFloorLayoutEmpty({
                tables: entitiesForFloor(tables, activeFloorId),
                zones: entitiesForFloor(floorZones, activeFloorId),
                fixtures: entitiesForFloor(floorFixtures, activeFloorId),
              })) {
            showToast('الگوی شروع فقط برای یک طبقهٔ خالی در دسترس است؛ داده‌های فعلی دست‌نخورده می‌مانند.', 'warning');
            return;
          }
          const templates = FLOOR_LAYOUT_TEMPLATES;
          /* الگوهای قدیمیِ نمونه از رابط کاربری حذف شده‌اند و استفاده نمی‌شوند.
          const legacyTemplates = [
            {
              id: 'modern-cafe',
              title: 'کافه تریا و بار مدرن',
              icon: '☕',
              desc: 'مناسب کافه‌ها و قهوه‌فروشی‌ها با پیشخوان بار مرکزی، صندلی‌های گرد و مربع، تراس پیاده‌رو و ورودی شیک.',
              zones: [
                { id: 'z-cafe-main', name: 'سالن کافه', x: 2, y: 2, w: 60, h: 96, color: 'amber', icon: '☕', shape: 'rectangle', lengthM: 12, widthM: 8 },
                { id: 'z-cafe-terrace', name: 'تراس پیاده‌رو', x: 64, y: 2, w: 34, h: 96, color: 'emerald', icon: '🌿', shape: 'open-terrace', lengthM: 8, widthM: 4 },
              ],
              fixtures: [
                { id: 'f-bar', type: 'bar', name: 'کافه بار تخصصی', x: 10, y: 6, w: 25, h: 10, rotation: 0, color: 'amber', icon: '☕', floorId: 'floor-ground' },
                { id: 'f-cash', type: 'cashier', name: 'صندوق سفارش', x: 38, y: 6, w: 12, h: 10, rotation: 0, color: 'cyan', icon: '💳', floorId: 'floor-ground' },
                { id: 'f-wc', type: 'restroom', name: 'سرویس', x: 5, y: 84, w: 10, h: 12, rotation: 0, color: 'purple', icon: '🚻', floorId: 'floor-ground' },
                { id: 'f-ent', type: 'entrance', name: 'ورودی اصلی', x: 60, y: 50, w: 4, h: 12, rotation: 90, color: 'emerald', icon: '🚪', floorId: 'floor-ground' },
                { id: 'f-plant', type: 'plant', name: 'فضای سبز', x: 92, y: 6, w: 6, h: 6, rotation: 0, color: 'emerald', icon: '🪴', floorId: 'floor-ground' },
              ],
              tables: [
                { label: 'میز ۱', seats: 2, shape: 'circle', zone: 'سالن کافه', x: 12, y: 28 },
                { label: 'میز ۲', seats: 2, shape: 'circle', zone: 'سالن کافه', x: 26, y: 28 },
                { label: 'میز ۳', seats: 4, shape: 'square', zone: 'سالن کافه', x: 40, y: 28 },
                { label: 'میز ۴', seats: 4, shape: 'square', zone: 'سالن کافه', x: 12, y: 48 },
                { label: 'میز ۵', seats: 4, shape: 'square', zone: 'سالن کافه', x: 26, y: 48 },
                { label: 'میز ۶', seats: 6, shape: 'rectangle', zone: 'سالن کافه', x: 42, y: 52 },
                { label: 'میز بار ۱', seats: 1, shape: 'bar_stool', zone: 'سالن کافه', x: 14, y: 18 },
                { label: 'میز بار ۲', seats: 1, shape: 'bar_stool', zone: 'سالن کافه', x: 22, y: 18 },
                { label: 'میز بار ۳', seats: 1, shape: 'bar_stool', zone: 'سالن کافه', x: 30, y: 18 },
                { label: 'تراس ۱', seats: 2, shape: 'circle', zone: 'تراس پیاده‌رو', x: 74, y: 22 },
                { label: 'تراس ۲', seats: 2, shape: 'circle', zone: 'تراس پیاده‌رو', x: 86, y: 22 },
                { label: 'تراس ۳', seats: 4, shape: 'rectangle', zone: 'تراس پیاده‌رو', x: 74, y: 48 },
                { label: 'تراس ۴', seats: 4, shape: 'rectangle', zone: 'تراس پیاده‌رو', x: 86, y: 48 },
                { label: 'تراس ۵', seats: 4, shape: 'rectangle', zone: 'تراس پیاده‌رو', x: 80, y: 75 },
              ]
            },
            {
              id: 'traditional-persian',
              title: 'رستوران سنتی و سفره‌خانه با تخت‌های شاه‌نشین',
              icon: '🛏️',
              desc: 'طراحی اصیل ایرانی شامل تخت‌های سنتی با قالیچه و پشتی، فضای حوض‌خانه، شاه‌نشین و میزهای خانوادگی.',
              zones: [
                { id: 'z-trad-main', name: 'سالن شاه‌نشین', x: 2, y: 2, w: 68, h: 96, color: 'purple', icon: '👑', shape: 'rectangle', lengthM: 16, widthM: 10 },
                { id: 'z-trad-garden', name: 'باغچه و حیاط سنتی', x: 72, y: 2, w: 26, h: 96, color: 'emerald', icon: '🌿', shape: 'open-terrace', lengthM: 10, widthM: 5 },
              ],
              fixtures: [
                { id: 'f-buffet', type: 'buffet', name: 'بوفه سالاد و دسر سنتی', x: 10, y: 6, w: 22, h: 8, rotation: 0, color: 'amber', icon: '🥗', floorId: 'floor-ground' },
                { id: 'f-cash', type: 'cashier', name: 'صندوق خاتم‌کاری', x: 42, y: 6, w: 12, h: 8, rotation: 0, color: 'cyan', icon: '💳', floorId: 'floor-ground' },
                { id: 'f-stage', type: 'stage', name: 'جایگاه اجرای موسیقی زنده سنتی', x: 8, y: 84, w: 26, h: 12, rotation: 0, color: 'purple', icon: '🎭', floorId: 'floor-ground' },
                { id: 'f-wc', type: 'restroom', name: 'سرویس بهداشتی', x: 58, y: 86, w: 10, h: 10, rotation: 0, color: 'purple', icon: '🚻', floorId: 'floor-ground' },
                { id: 'f-ent', type: 'entrance', name: 'ورودی طاق‌دار سنتی', x: 68, y: 50, w: 4, h: 12, rotation: 90, color: 'emerald', icon: '🚪', floorId: 'floor-ground' },
              ],
              tables: [
                { label: 'تخت ۱ شاه‌نشین', seats: 8, shape: 'lounge_takht', zone: 'سالن شاه‌نشین', x: 14, y: 26 },
                { label: 'تخت ۲ شاه‌نشین', seats: 8, shape: 'lounge_takht', zone: 'سالن شاه‌نشین', x: 34, y: 26 },
                { label: 'تخت ۳ شاه‌نشین', seats: 8, shape: 'lounge_takht', zone: 'سالن شاه‌نشین', x: 54, y: 26 },
                { label: 'تخت ۴ حوض‌خانه', seats: 8, shape: 'lounge_takht', zone: 'سالن شاه‌نشین', x: 14, y: 54 },
                { label: 'تخت ۵ حوض‌خانه', seats: 8, shape: 'lounge_takht', zone: 'سالن شاه‌نشین', x: 34, y: 54 },
                { label: 'تخت ۶ حوض‌خانه', seats: 8, shape: 'lounge_takht', zone: 'سالن شاه‌نشین', x: 54, y: 54 },
                { label: 'میز خانوادگی ۱', seats: 6, shape: 'rectangle', zone: 'سالن شاه‌نشین', x: 42, y: 78 },
                { label: 'آلاچیق ۱', seats: 6, shape: 'lounge_takht', zone: 'باغچه و حیاط سنتی', x: 84, y: 22 },
                { label: 'آلاچیق ۲', seats: 6, shape: 'lounge_takht', zone: 'باغچه و حیاط سنتی', x: 84, y: 50 },
                { label: 'آلاچیق ۳', seats: 6, shape: 'lounge_takht', zone: 'باغچه و حیاط سنتی', x: 84, y: 78 },
              ]
            },
            {
              id: 'fast-casual',
              title: 'فست‌فود و برگر زنجیره‌ای',
              icon: '🍔',
              desc: 'گردش سریع مشتری با نیمکت‌های باجه‌ای، پیشخوان تحویل سریع، دو باجه صندوق و میزهای استاندارد.',
              zones: [
                { id: 'z-ff-dining', name: 'سالن نشیمن باجه‌ای', x: 2, y: 2, w: 66, h: 96, color: 'rose', icon: '🛋️', shape: 'rectangle', lengthM: 14, widthM: 9 },
                { id: 'z-ff-order', name: 'محوطه سفارش و تحویل', x: 70, y: 2, w: 28, h: 96, color: 'cyan', icon: '⚡', shape: 'corridor', lengthM: 14, widthM: 4 },
              ],
              fixtures: [
                { id: 'f-kitchen', type: 'kitchen', name: 'تحویل سفارش و آشپزخانه', x: 74, y: 10, w: 20, h: 14, rotation: 0, color: 'rose', icon: '🍳', floorId: 'floor-ground' },
                { id: 'f-cash1', type: 'cashier', name: 'صندوق ۱ (سفارش حضوری)', x: 74, y: 32, w: 20, h: 8, rotation: 0, color: 'cyan', icon: '💳', floorId: 'floor-ground' },
                { id: 'f-cash2', type: 'cashier', name: 'صندوق ۲ (پیک و اسنپ)', x: 74, y: 46, w: 20, h: 8, rotation: 0, color: 'cyan', icon: '💳', floorId: 'floor-ground' },
                { id: 'f-wc', type: 'restroom', name: 'سرویس بهداشتی', x: 74, y: 82, w: 18, h: 12, rotation: 0, color: 'purple', icon: '🚻', floorId: 'floor-ground' },
                { id: 'f-ent', type: 'entrance', name: 'درب ورودی و خروج', x: 67, y: 68, w: 4, h: 12, rotation: 90, color: 'emerald', icon: '🚪', floorId: 'floor-ground' },
              ],
              tables: [
                { label: 'باکس ۱', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 12, y: 16 },
                { label: 'باکس ۲', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 30, y: 16 },
                { label: 'باکس ۳', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 48, y: 16 },
                { label: 'باکس ۴', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 12, y: 40 },
                { label: 'باکس ۵', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 30, y: 40 },
                { label: 'باکس ۶', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 48, y: 40 },
                { label: 'باکس ۷', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 12, y: 66 },
                { label: 'باکس ۸', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 30, y: 66 },
                { label: 'باکس ۹', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 48, y: 66 },
                { label: 'میز طولی ۱۰', seats: 6, shape: 'rectangle', zone: 'سالن نشیمن باجه‌ای', x: 24, y: 86 },
                { label: 'میز طولی ۱۱', seats: 6, shape: 'rectangle', zone: 'سالن نشیمن باجه‌ای', x: 48, y: 86 },
              ]
            },
            {
              id: 'fine-dining',
              title: 'فاین داینینگ و استیک‌هاوس مجلل',
              icon: '🍷',
              desc: 'محیط لوکس با میزهای بیضی و گرد بزرگ، اتاق خصوصی VIP، ستون‌های مرمری و بار نوشیدنی مجلل.',
              zones: [
                { id: 'z-fd-main', name: 'سالن اصلی مجلل', x: 2, y: 2, w: 68, h: 96, color: 'blue', icon: '🍷', shape: 'rectangle', lengthM: 18, widthM: 12 },
                { id: 'z-fd-vip', name: 'سالن اختصاصی VIP', x: 72, y: 2, w: 26, h: 96, color: 'purple', icon: '👑', shape: 'rectangle', lengthM: 10, widthM: 6 },
              ],
              fixtures: [
                { id: 'f-bar', type: 'bar', name: 'بار مجلل نوشیدنی و پیانو', x: 8, y: 8, w: 24, h: 10, rotation: 0, color: 'amber', icon: '🍷', floorId: 'floor-ground' },
                { id: 'f-pillar1', type: 'pillar', name: 'ستون مرمر', x: 32, y: 35, w: 4, h: 4, rotation: 0, color: 'slate', icon: '🏛️', floorId: 'floor-ground' },
                { id: 'f-pillar2', type: 'pillar', name: 'ستون مرمر', x: 32, y: 65, w: 4, h: 4, rotation: 0, color: 'slate', icon: '🏛️', floorId: 'floor-ground' },
                { id: 'f-cash', type: 'cashier', name: 'پذیرش و مهمانداری', x: 40, y: 8, w: 16, h: 8, rotation: 0, color: 'cyan', icon: '💳', floorId: 'floor-ground' },
                { id: 'f-ent', type: 'entrance', name: 'ورودی اصلی تشریفات', x: 69, y: 50, w: 4, h: 14, rotation: 90, color: 'emerald', icon: '🚪', floorId: 'floor-ground' },
              ],
              tables: [
                { label: 'میز گرد ۱', seats: 4, shape: 'circle', zone: 'سالن اصلی مجلل', x: 14, y: 32 },
                { label: 'میز گرد ۲', seats: 4, shape: 'circle', zone: 'سالن اصلی مجلل', x: 14, y: 56 },
                { label: 'میز گرد ۳', seats: 4, shape: 'circle', zone: 'سالن اصلی مجلل', x: 14, y: 80 },
                { label: 'میز سلطنتی ۴', seats: 8, shape: 'oval', zone: 'سالن اصلی مجلل', x: 50, y: 32 },
                { label: 'میز سلطنتی ۵', seats: 8, shape: 'oval', zone: 'سالن اصلی مجلل', x: 50, y: 65 },
                { label: 'شاه‌نشین VIP ۱', seats: 10, shape: 'oval', zone: 'سالن اختصاصی VIP', x: 85, y: 30 },
                { label: 'شاه‌نشین VIP ۲', seats: 8, shape: 'circle', zone: 'سالن اختصاصی VIP', x: 85, y: 68 },
              ]
            },
            {
              id: 'rooftop-lounge',
              title: 'روف‌گاردن و لانژ مرتفع',
              icon: '☀️',
              desc: 'فضای روباز طبقه بالا، چشم‌انداز شهری، مبلمان لانژ و تخت‌های آفتابگیر، بار روباز و گیاهان سرسبز.',
              zones: [
                { id: 'z-roof-deck', name: 'تراس مرتفع و لانژ', x: 2, y: 2, w: 96, h: 96, color: 'cyan', icon: '☀️', shape: 'open-terrace', lengthM: 20, widthM: 14 },
              ],
              fixtures: [
                { id: 'f-roof-bar', type: 'bar', name: 'بار روباز روف‌گاردن', x: 38, y: 6, w: 26, h: 10, rotation: 0, color: 'cyan', icon: '🍹', floorId: 'floor-ground' },
                { id: 'f-elev', type: 'elevator', name: 'ورودی آسانسور اختصاصی بام', x: 6, y: 6, w: 12, h: 12, rotation: 0, color: 'blue', icon: '🛗', floorId: 'floor-ground' },
                { id: 'f-plant1', type: 'plant', name: 'باغچه عمودی و گیاهان', x: 6, y: 84, w: 16, h: 8, rotation: 0, color: 'emerald', icon: '🪴', floorId: 'floor-ground' },
                { id: 'f-plant2', type: 'plant', name: 'باغچه عمودی و گیاهان', x: 78, y: 84, w: 16, h: 8, rotation: 0, color: 'emerald', icon: '🪴', floorId: 'floor-ground' },
              ],
              tables: [
                { label: 'لانژ آفتاب ۱', seats: 6, shape: 'lounge_takht', zone: 'تراس مرتفع و لانژ', x: 16, y: 32 },
                { label: 'لانژ آفتاب ۲', seats: 6, shape: 'lounge_takht', zone: 'تراس مرتفع و لانژ', x: 16, y: 60 },
                { label: 'میز ویو ۳', seats: 4, shape: 'circle', zone: 'تراس مرتفع و لانژ', x: 42, y: 32 },
                { label: 'میز ویو ۴', seats: 4, shape: 'circle', zone: 'تراس مرتفع و لانژ', x: 58, y: 32 },
                { label: 'میز ویو ۵', seats: 4, shape: 'circle', zone: 'تراس مرتفع و لانژ', x: 42, y: 60 },
                { label: 'میز ویو ۶', seats: 4, shape: 'circle', zone: 'تراس مرتفع و لانژ', x: 58, y: 60 },
                { label: 'لانژ افق ۷', seats: 6, shape: 'lounge_takht', zone: 'تراس مرتفع و لانژ', x: 84, y: 32 },
                { label: 'لانژ افق ۸', seats: 6, shape: 'lounge_takht', zone: 'تراس مرتفع و لانژ', x: 84, y: 60 },
              ]
            },
            {
              id: 'banquet-hall',
              title: 'تالار پذیرایی و همایش‌های تشریفاتی',
              icon: '🏛️',
              desc: 'میزهای گرد ضیافتی بزرگ (۸ و ۱۰ نفره)، استیج و سن اجرا، خطوط بوفه پذیرایی و ظرفیت بالا.',
              zones: [
                { id: 'z-bq-hall', name: 'تالار اصلی ضیافت', x: 2, y: 2, w: 96, h: 96, color: 'purple', icon: '🏛️', shape: 'rectangle', lengthM: 25, widthM: 18 },
              ],
              fixtures: [
                { id: 'f-stage', type: 'stage', name: 'سن و جایگاه ویژه مراسم', x: 30, y: 5, w: 40, h: 14, rotation: 0, color: 'purple', icon: '🎭', floorId: 'floor-ground' },
                { id: 'f-buff1', type: 'buffet', name: 'لاین بوفه شام ۱', x: 5, y: 25, w: 8, h: 48, rotation: 0, color: 'amber', icon: '🥗', floorId: 'floor-ground' },
                { id: 'f-buff2', type: 'buffet', name: 'لاین بوفه شام ۲', x: 87, y: 25, w: 8, h: 48, rotation: 0, color: 'amber', icon: '🥗', floorId: 'floor-ground' },
                { id: 'f-ent', type: 'entrance', name: 'درب‌های دوتایی ورودی تشریفات', x: 42, y: 92, w: 16, h: 6, rotation: 0, color: 'emerald', icon: '🚪', floorId: 'floor-ground' },
              ],
              tables: [
                { label: 'میز ۱۰۱', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 25, y: 30 },
                { label: 'میز ۱۰۲', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 45, y: 30 },
                { label: 'میز ۱۰۳', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 65, y: 30 },
                { label: 'میز ۱۰۴', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 25, y: 50 },
                { label: 'میز ۱۰۵', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 45, y: 50 },
                { label: 'میز ۱۰۶', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 65, y: 50 },
                { label: 'میز ۱۰۷', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 25, y: 70 },
                { label: 'میز ۱۰۸', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 45, y: 70 },
                { label: 'میز ۱۰۹', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 65, y: 70 },
              ]
            }
          ]; */

          showFloorModal({
            title: 'انتخاب الگوی شروع',
            confirmText: 'استفاده از این الگو',
            confirmClass: 'btn-primary',
            modalClass: 'floor-studio-modal--wide',
            bodyHtml: `
              <p style="font-size:14px;color:#94a3b8;margin:0 0 12px">الگو فقط بخش‌ها و المان‌های قابل ویرایش را می‌سازد؛ میز یا رزرو نمونه ایجاد نمی‌شود.</p>
              <div class="floor-template-grid" id="fm-templates-grid" role="radiogroup" aria-label="الگوی شروع چیدمان">
                ${templates.map((tpl) => `
                  <label class="floor-template-card" data-tpl-id="${tpl.id}">
                    <input type="radio" name="floor-layout-template" value="${tpl.id}" required />
                    <div class="floor-template-card__head">
                      <span style="font-size:24px" aria-hidden="true">${tpl.icon}</span>
                      <strong style="font-size:15px;color:#f8fafc">${esc(tpl.title)}</strong>
                    </div>
                    <p style="font-size:13px;color:#94a3b8;margin:6px 0 10px;line-height:1.6">${esc(tpl.desc)}</p>
                    <div style="font-size:12px;color:#38bdf8;font-weight:700">
                      <span>📐 ${fmtNum(tpl.zones.length)} بخش · ${fmtNum(tpl.fixtures.length)} المان</span>
                    </div>
                  </label>
                `).join('')}
              </div>
              <p style="font-size:13px;color:#94a3b8;margin:12px 0 0">این انتخاب فقط روی طبقهٔ خالی جاری اعمال می‌شود؛ میزهای واقعی، رزروها و سایر طبقات تغییر نمی‌کنند.</p>
            `,
            onConfirm: async (form) => {
              const tplId = form.querySelector('input[name="floor-layout-template"]:checked')?.value;
              const tpl = templates.find((t) => t.id === tplId);
              if (!tpl) {
                showToast('برای ادامه یک الگوی شروع را انتخاب کنید.', 'warning');
                return false;
              }
              const targetFloorId = activeFloorId;
              if (!floorExists(floorLevels, targetFloorId)
                  || !isFloorLayoutEmpty({
                    tables: entitiesForFloor(tables, targetFloorId),
                    zones: entitiesForFloor(floorZones, targetFloorId),
                    fixtures: entitiesForFloor(floorFixtures, targetFloorId),
                  })) {
                showToast('این طبقه دیگر خالی نیست؛ هیچ داده‌ای جایگزین نشد.', 'warning');
                return false;
              }
              const materialized = materializeFloorTemplate(tpl, targetFloorId, `starter-${Date.now()}`);
              if (!materialized) return false;

              pushHistory();
              floorZones.push(...materialized.zones);
              floorFixtures.push(...materialized.fixtures);

              activeZone = 'all';
              const saved = await saveFloorLayout(true);
              render();
              if (saved) showToast(`الگوی «${tpl.title}» روی طبقهٔ خالی اعمال شد.`, 'success');
              else showLayoutSaveFailure();
              return true;
            }
          });

          setTimeout(() => {
            const grid = document.getElementById('fm-templates-grid');
            grid?.querySelectorAll('.floor-template-card input').forEach((input) => {
              input.addEventListener('change', () => {
                grid.querySelectorAll('.floor-template-card').forEach((card) => card.classList.toggle(
                  'is-selected', Boolean(card.querySelector('input')?.checked),
                ));
              });
            });
          }, 50);
        };

    return { promptAddZone, promptAddFloor, promptEditFloor, deleteFloor, promptMoveTableFloor, promptAddFixture, promptFloorSettings, promptTableFurnitureModal, exportLayoutJson, importLayoutJson, showTemplateModal };
  }

  // ─── mount — entry point ──────────────────────────────────────────────
  const mount = async () => {
    isMounted = true;
    document.body.classList.add('admin-floor-active');

    // بارگذاری داده‌ها
    let [d, freshFloorData] = await Promise.all([
      api(`/api/admin/tables${branchQuery()}`),
      api(`/api/admin/v2/floor${branchQuery()}`),
    ]);

    if (!isCurrentStudio()) return;

    floorData = freshFloorData;

    // تنظیم floorLevels
    floorLevels = floorCollection(floorData, 'floors')
      .filter((fl) => String(fl?.id || '').trim())
      .map((fl) => ({ id: String(fl.id), name: String(fl.name || 'طبقه بدون نام'), level: Number(fl.level) || 0, icon: fl.icon || '🏛️', isDefault: Boolean(fl.isDefault) }));

    const defaultFloorId = floorLevels[0]?.id;
    activeFloorId = defaultFloorId || UNASSIGNED_FLOOR_ID;

    // تنظیم floorFixtures
    floorFixtures = floorCollection(floorData, 'fixtures').map((f, i) => ({
      id: String(f.id || `fix-${i}`),
      type: String(f.type || 'fixture'),
      name: String(f.name || 'المان'),
      x: Number(f.x) || 0,
      y: Number(f.y) || 0,
      w: Number(f.w) || 2,
      h: Number(f.h) || 2,
      rotation: Number(f.rotation) || 0,
      color: f.color || 'slate',
      icon: f.icon || '🏷️',
      floorId: f.floorId ? String(f.floorId) : defaultFloorId || null,
    }));

    // تنظیم floorSettings
    floorSettings = floorData?.settings || { widthM: 20, lengthM: 25, gridStep: 0.5, bgTheme: 'blueprint', wallThickness: 0.4, showRulers: true, showGrid: true };

    // تنظیم floorZones
    floorZones = sanitizeNonOverlappingZones(dedupeFloorZones(
      floorCollection(floorData, 'zones').map((z) => ({
        id: String(z.id || `zone-${Math.random().toString(36).slice(2, 7)}`),
        name: normalizeZone(z.name),
        x: Number(z.x) || 0,
        y: Number(z.y) || 0,
        w: Number(z.w) || 30,
        h: Number(z.h) || 30,
        color: z.color || 'blue',
        icon: z.icon || '🏷️',
        lengthM: Number(z.lengthM) || undefined,
        widthM: Number(z.widthM) || undefined,
        areaSqM: Number(z.areaSqM) || undefined,
        shape: z.shape || 'rectangle',
        floorId: z.floorId ? String(z.floorId) : defaultFloorId || null,
      }))
    ));

    // تنظیم QR prefs
    try { qrPrefs = { ...defaultQrPrefs, ...JSON.parse(localStorage.getItem(QR_PREFS_KEY) || '{}') }; }
    catch { qrPrefs = { ...defaultQrPrefs }; }
    normalizeQrPrefs();

    // بارگذاری tables
    tables = Array.isArray(d.tables) ? d.tables : [];
    tables.forEach((t) => {
      t.zone = normalizeTableZoneValue(t.zone, normalizeZone);
      if (!t.floorId && defaultFloorId) t.floorId = defaultFloorId;
    });

    // Apply floorData to tables
    const floorTableMap = new Map((floorData?.tables || []).map((t) => [Number(t.id), t]));
    tables.forEach((table, index) => {
      const f = floorTableMap.get(Number(table.id));
      if (f) {
        if (typeof f.x === 'number') table.x = f.x;
        if (typeof f.y === 'number') table.y = f.y;
        if (f.shape) table.shape = f.shape;
        if (typeof f.rotation === 'number') table.rotation = f.rotation;
        if (f.zone) table.zone = normalizeTableZoneValue(f.zone, normalizeZone);
        if (typeof f.x === 'number' && typeof f.y === 'number') markTablePositioned(table);
        if (f.floorId) table.floorId = f.floorId;
        else if (!table.floorId && defaultFloorId) table.floorId = defaultFloorId;
        table.state = f.state || table.state;
        table.stateLabel = f.stateLabel || table.stateLabel;
        table.serviceEndsAt = f.serviceEndsAt || null;
        table.autoReleased = Boolean(f.autoReleased);
        table.waiterCallId = f.waiterCallId || null;
      }
      ensureTableGeometry(table, index);
    });

    if (hasUnassignedFloorEntities(tables, floorZones, floorFixtures)) {
      activeFloorId = UNASSIGNED_FLOOR_ID;
    } else {
      activeFloorId = defaultFloorId || UNASSIGNED_FLOOR_ID;
    }

    activeZone = 'all';

    // اولین render
    render();
  };

  return { mount, unmount };
}

// Export برای استفاده در admin.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createFloorStudio, __test: {
    createLayoutHistory, createHistoryCheckpoint, createLayoutRevision, createSerializedSaveRunner,
    resolveFloorViewMode,
    isActiveFloorPointerEvent, isCancelledFloorPointerEvent,
    createFloorBranchContext,
    isLayoutImportBranchCompatible, calculateZoneDragPosition, normalizeSeatCapacity,
    calculateMobileTableAdjustment, normalizeFloorRotation, suggestedTablePosition, tableCoordinatesForSave,
    mergeFloorOperationalState, findFloorZonePlacement, findFloorZoneAtPosition,
    planFloorZoneMembershipSync, applyFloorZoneMembershipSync,
    markTablePositioned, normalizeTableZoneValue, tableZoneForSave, markTableZoneAssigned,
    isTableInsideZone, calculateZoneFocusPan,
    UNASSIGNED_FLOOR_ID, floorCollection, floorEntityId, entitiesForFloor, zonesShareLayoutSpace, floorExists, parseFloorLevel,
    hasUnassignedFloorEntities, floorIdForPersistence, isFloorLayoutEmpty, FLOOR_LAYOUT_TEMPLATES,
    materializeFloorTemplate, validateFloorTableDeleteResponse, planTableMerge,
    applyTableMergePlan, groupTablesByZoneForFloor, isFloorZoneNameTaken,
    renameZoneAndTablesOnFloor, removeZoneAndReassignTablesOnFloor, floorZoneOptionsForMove, preferredFloorZone,
    isFloorLayoutRevisionConflict, isUsableFloorDataSnapshot, isCompleteFloorLayoutSnapshot, floorRefreshNotice,
    normalizeFloorTableReference, isWaiterCallForTable,
  } };
} else if (typeof window !== 'undefined') {
  window.createFloorStudio = createFloorStudio;
}
