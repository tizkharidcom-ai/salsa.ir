'use strict';

/**
 * Walk-in reception rules.  Walk-ins live beside timed reservations so the
 * existing reservation history stays intact, but they never participate in
 * reservation slot capacity until they are actually seated.
 */

const WAITLIST_SOURCE = 'walk_in';
const ACTIVE_WAITLIST_STATUSES = new Set(['waiting', 'called', 'seated']);
const TERMINAL_WAITLIST_STATUSES = new Set(['left', 'cancelled']);
const WAITLIST_STATUSES = new Set([...ACTIVE_WAITLIST_STATUSES, ...TERMINAL_WAITLIST_STATUSES]);
const MAX_IDEMPOTENCY_KEY_LENGTH = 160;

function inputError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  return error;
}

function normalizeBranchId(value) {
  const raw = typeof value === 'number' ? value : String(value ?? '').trim();
  if (typeof raw === 'string' && !/^\d+$/u.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeText(value, maxLength, field) {
  if (value == null) return '';
  if (typeof value !== 'string') {
    throw inputError('waitlist_input_invalid', `فیلد ${field} باید متن باشد.`);
  }
  return [...value.trim()].slice(0, maxLength).join('');
}

function normalizeIdempotencyKey(value) {
  if (value == null) return '';
  if (typeof value !== 'string') {
    throw inputError('waitlist_idempotency_key_invalid', 'کلید ثبت باید متن باشد.');
  }
  const key = value.trim();
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH || /[\u0000-\u001f\u007f]/u.test(key)) {
    throw inputError('waitlist_idempotency_key_invalid', 'کلید ثبت نامعتبر یا بیش از حد طولانی است.');
  }
  return key;
}

function isWaitlist(entry) {
  return entry?.source === WAITLIST_SOURCE;
}

function isActive(entry) {
  return isWaitlist(entry) && ACTIVE_WAITLIST_STATUSES.has(String(entry.status || ''));
}

function sortWaitlist(a, b) {
  const activeA = ACTIVE_WAITLIST_STATUSES.has(String(a.status || ''));
  const activeB = ACTIVE_WAITLIST_STATUSES.has(String(b.status || ''));
  if (activeA !== activeB) return activeA ? -1 : 1;
  if (activeA && a.status !== b.status) {
    const order = { waiting: 0, called: 1, seated: 2 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
  }
  const createdAtA = Date.parse(a.createdAt || '');
  const createdAtB = Date.parse(b.createdAt || '');
  return (Number.isFinite(createdAtA) ? createdAtA : 0)
    - (Number.isFinite(createdAtB) ? createdAtB : 0);
}

function listWaitlist(records, branchId, { includeTerminal = true, limit = 100 } = {}) {
  const normalizedBranchId = normalizeBranchId(branchId);
  if (normalizedBranchId == null) return [];
  return (Array.isArray(records) ? records : [])
    .filter((entry) => isWaitlist(entry)
      && normalizeBranchId(entry.branchId) === normalizedBranchId
      && (includeTerminal ? WAITLIST_STATUSES.has(String(entry.status || '')) : isActive(entry)))
    .sort(sortWaitlist)
    .slice(0, Math.max(1, Number(limit) || 100));
}

function normalizePartySize(value, maxParty = 40) {
  if (value == null || String(value).trim() === '') return null;
  const raw = typeof value === 'number' ? value : String(value).trim()
    .replace(/[۰-۹]/gu, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/gu, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  if (typeof raw === 'string' && !/^\d+$/u.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;

  const maxRaw = typeof maxParty === 'number' ? maxParty : Number(String(maxParty ?? '').trim());
  const max = Number.isSafeInteger(maxRaw) && maxRaw > 0 ? maxRaw : 40;
  return Math.min(max, parsed);
}

function normalizeTableId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw inputError('waitlist_table_invalid', 'شناسهٔ میز معتبر نیست.');
  }
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw inputError('waitlist_table_invalid', 'شناسهٔ میز معتبر نیست.');
  }
  const id = String(value).trim()
    .replace(/[۰-۹]/gu, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/gu, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/^میز\s*/u, '')
    .replace(/\s+/gu, '');
  if (!id || id.length > 40 || /[\u0000-\u001f\u007f]/u.test(id)) {
    throw inputError('waitlist_table_invalid', 'شناسهٔ میز معتبر نیست.');
  }
  return id;
}

function tableIdsOverlap(left, right) {
  let a;
  let b;
  try {
    a = normalizeTableId(left);
    b = normalizeTableId(right);
  } catch (_) {
    return false;
  }
  return a === b || a.startsWith(`${b}-`) || b.startsWith(`${a}-`);
}

function localDateTime(dateValue, timeValue) {
  const date = String(dateValue || '');
  const time = String(timeValue || '');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !/^\d{2}:\d{2}$/u.test(time)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day || parsed.getHours() !== hour || parsed.getMinutes() !== minute) return null;
  return parsed;
}

function reservationBlocksTable(reservation, now = new Date(), slotMinutes = 30) {
  if (!reservation || !['pending', 'confirmed', 'seated'].includes(String(reservation.status || ''))) return false;
  if (String(reservation.status) === 'seated') return true;
  const currentTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(currentTime)) return true;
  const duration = Math.max(15, Math.min(120, Number(slotMinutes) || 30));
  const start = localDateTime(reservation.date, reservation.time);
  if (!start) return true;
  let end = reservation.endTime
    ? localDateTime(reservation.date, reservation.endTime)
    : new Date(start.getTime() + duration * 60_000);
  if (!end) return true;
  if (end.getTime() <= start.getTime()) end = new Date(end.getTime() + 24 * 60 * 60_000);
  return start.getTime() <= currentTime + duration * 60_000
    && end.getTime() > currentTime;
}

function conflictError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 409;
  return error;
}

// Validate an entire waitlist transition before returning a replacement
// record. Callers can persist it and only then expose the change to clients.
function prepareWaitlistUpdate({
  entry,
  records = [],
  tables = [],
  body = {},
  maxParty = 40,
  now = new Date().toISOString(),
  isTableBusy = () => false,
}) {
  if (!isWaitlist(entry)) throw conflictError('waitlist_not_found', 'مهمان موردنظر در صف پیدا نشد.');
  const nextStatus = typeof body.status === 'string' ? body.status.trim() : '';
  if (!WAITLIST_STATUSES.has(nextStatus) || !canTransition(entry.status, nextStatus)) {
    throw conflictError('waitlist_transition_invalid', 'این تغییر وضعیت برای مهمان ممکن نیست.');
  }

  const hasField = (field) => Object.prototype.hasOwnProperty.call(body, field);
  const name = hasField('name') ? normalizeText(body.name, 80, 'نام مهمان') : (entry.name || '');
  const note = hasField('note') ? normalizeText(body.note, 200, 'یادداشت') : (entry.note || '');
  const hasPartySize = hasField('partySize') && body.partySize != null && String(body.partySize).trim() !== '';
  const partySize = hasPartySize
    ? normalizePartySize(body.partySize, maxParty)
    : (entry.partySize == null ? null : entry.partySize);
  if (hasPartySize && partySize == null) {
    throw inputError('waitlist_party_invalid', 'تعداد مهمان باید حداقل یک نفر باشد.');
  }

  let tableNo = entry.tableNo || null;
  let table = null;
  if (nextStatus === 'seated') {
    tableNo = normalizeTableId(body.tableNo);
    const branchId = normalizeBranchId(entry.branchId);
    table = (Array.isArray(tables) ? tables : []).find((item) => {
      if (normalizeBranchId(item?.branchId) !== branchId || item?.active === false) return false;
      try { return normalizeTableId(item.id) === tableNo; } catch (_) { return false; }
    }) || null;
    if (!table) throw conflictError('waitlist_table_invalid', 'میز انتخاب‌شده در این شعبه فعال نیست.');

    const seats = Number(table.seats);
    if (partySize && Number.isFinite(seats) && seats > 0 && partySize > seats) {
      throw conflictError('waitlist_table_capacity', 'ظرفیت این میز برای تعداد مهمان کافی نیست.');
    }
    const sameSeatedTable = entry.status === 'seated'
      && (() => {
        try { return normalizeTableId(entry.tableNo) === tableNo; } catch (_) { return false; }
      })();
    if (entry.status === 'seated' && !sameSeatedTable) {
      throw conflictError('waitlist_table_move_requires_leave', 'برای تغییر میز، ابتدا وضعیت مهمان را از مسیر جابه‌جایی میز تغییر دهید.');
    }
    if (!sameSeatedTable && isTableBusy(tableNo, table, entry)) {
      throw conflictError('waitlist_table_busy', 'این میز همین حالا در اختیار مهمان یا سفارش دیگری است.');
    }
    tableNo = normalizeTableId(table.id);
  } else if (nextStatus === 'waiting' || nextStatus === 'called') {
    tableNo = null;
  }

  const statusChanged = nextStatus !== entry.status;
  const updated = {
    ...entry,
    name,
    note,
    partySize,
    tableNo,
    status: nextStatus,
    statusAt: statusChanged ? now : entry.statusAt,
  };
  if (nextStatus === 'seated' && statusChanged) updated.seatedAt = now;
  if (nextStatus === 'left' && statusChanged) updated.leftAt = now;

  const idempotent = name === (entry.name || '')
    && note === (entry.note || '')
    && partySize === (entry.partySize == null ? null : entry.partySize)
    && nextStatus === entry.status
    && tableNo === (entry.tableNo || null);
  return { entry: updated, table, idempotent };
}

function validatePhone(phone, phoneRe) {
  if (typeof phone !== 'string' || !(phoneRe instanceof RegExp)) {
    throw inputError('waitlist_phone_invalid', 'شماره موبایل معتبر نیست.');
  }
  const normalized = phone.trim()
    .replace(/[۰-۹]/gu, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/gu, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  phoneRe.lastIndex = 0;
  const isValid = phoneRe.test(normalized);
  phoneRe.lastIndex = 0;
  if (!isValid) throw inputError('waitlist_phone_invalid', 'شماره موبایل معتبر نیست.');
  return normalized;
}

function createWaitlistEntry({
  records,
  branchId,
  phone,
  name = '',
  partySize = null,
  note = '',
  idempotencyKey = '',
  phoneRe,
  nextId,
  now = new Date().toISOString(),
  maxParty = 40,
}) {
  const list = Array.isArray(records) ? records : [];
  const normalizedBranchId = normalizeBranchId(branchId);
  if (normalizedBranchId == null) throw inputError('waitlist_branch_invalid', 'شعبهٔ صف انتظار معتبر نیست.');
  const normalizedPhone = validatePhone(phone, phoneRe);
  const normalizedName = normalizeText(name, 80, 'نام مهمان');
  const normalizedNote = normalizeText(note, 200, 'یادداشت');
  const normalizedPartySize = normalizePartySize(partySize, maxParty);
  const key = normalizeIdempotencyKey(idempotencyKey);
  if (key) {
    const replay = list.find((entry) => isWaitlist(entry) && entry.idempotencyKey === key);
    if (replay) {
      const samePayload = normalizeBranchId(replay.branchId) === normalizedBranchId
        && replay.phone === normalizedPhone
        && (replay.partySize == null ? null : replay.partySize) === normalizedPartySize
        && (typeof replay.name === 'string' ? [...replay.name.trim()].slice(0, 80).join('') : '') === normalizedName
        && (typeof replay.note === 'string' ? [...replay.note.trim()].slice(0, 200).join('') : '') === normalizedNote;
      if (!samePayload) {
        const error = new Error('این کلید ثبت قبلاً با اطلاعات دیگری استفاده شده است.');
        error.code = 'waitlist_idempotency_conflict';
        error.status = 409;
        throw error;
      }
      return { entry: replay, idempotentReplay: true };
    }
  }

  const duplicate = list.find((entry) => isActive(entry)
    && normalizeBranchId(entry.branchId) === normalizedBranchId
    && entry.phone === normalizedPhone);
  if (duplicate) {
    const error = new Error('این شماره هم‌اکنون در صف انتظار است.');
    error.code = 'waitlist_duplicate_phone';
    error.status = 409;
    error.entry = duplicate;
    throw error;
  }

  const entry = {
    id: nextId(list),
    source: WAITLIST_SOURCE,
    branchId: normalizedBranchId,
    name: normalizedName,
    phone: normalizedPhone,
    partySize: normalizedPartySize,
    note: normalizedNote,
    tableNo: null,
    date: null,
    time: null,
    endTime: null,
    status: 'waiting',
    createdAt: now,
    statusAt: now,
    idempotencyKey: key || null,
  };
  list.unshift(entry);
  return { entry, idempotentReplay: false };
}

function canTransition(from, to) {
  const transitions = {
    waiting: new Set(['waiting', 'called', 'seated', 'cancelled']),
    called: new Set(['called', 'waiting', 'seated', 'cancelled']),
    seated: new Set(['seated', 'left']),
    left: new Set(['left']),
    cancelled: new Set(['cancelled']),
  };
  return Boolean(transitions[String(from || '')]?.has(String(to || '')));
}

module.exports = {
  WAITLIST_SOURCE,
  ACTIVE_WAITLIST_STATUSES,
  TERMINAL_WAITLIST_STATUSES,
  WAITLIST_STATUSES,
  isWaitlist,
  isActive,
  listWaitlist,
  normalizePartySize,
  normalizeTableId,
  tableIdsOverlap,
  reservationBlocksTable,
  validatePhone,
  createWaitlistEntry,
  canTransition,
  prepareWaitlistUpdate,
};
