'use strict';

/**
 * WESTO Finance — Period Service (ported from NEEM)
 * Fiscal period management: create, open, soft-close, close, reopen.
 * Period-lock validation on all postings.
 *
 * Period boundaries are canonical calendar days. Mutations are audited and
 * replay-safe; callers receive copies so a response object cannot mutate the
 * accounting state behind the control boundary.
 */
const crypto = require('crypto');

const PERIOD_AUDIT_GENESIS = 'PERIOD-GENESIS-00000000000000000000000000000000';

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function asBranchId(value) {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return /^-?\d+$/.test(raw) ? Number(raw) : raw;
}

function branchKey(value) {
  const branchId = asBranchId(value);
  return branchId === null ? null : String(branchId);
}

function identity(value) {
  const result = String(value ?? '').trim();
  return result || null;
}

function now() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function invalidResult(message, code) {
  return { ok: false, message, code };
}

function parseCalendarDay(value) {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const day = match[0];
  const date = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return null;
  if (raw.length > 10) {
    const instant = new Date(raw);
    if (!Number.isFinite(instant.getTime())) return null;
  }
  return day;
}

function dayNumber(day) {
  return Date.parse(`${day}T00:00:00.000Z`);
}

function ensurePeriods(acc) {
  if (!acc || typeof acc !== 'object') throw new TypeError('حسابداری معتبر نیست.');
  if (!Array.isArray(acc.fiscalPeriods)) acc.fiscalPeriods = [];
  if (!Array.isArray(acc.periodAudit)) acc.periodAudit = [];
  return acc.fiscalPeriods;
}

function periodBranchMatches(period, requestedBranch) {
  const requested = branchKey(requestedBranch);
  const periodBranch = branchKey(period.branchId);
  if (requested === null) return periodBranch === null;
  return periodBranch === null || periodBranch === requested;
}

function findPeriodForDate(acc, dateStr, branchId) {
  ensurePeriods(acc);
  const day = parseCalendarDay(dateStr);
  if (!day) return undefined;
  const target = dayNumber(day);
  const candidates = acc.fiscalPeriods.filter((period) => {
    const start = parseCalendarDay(period.startDate);
    const end = parseCalendarDay(period.endDate);
    return start && end && dayNumber(start) <= target && dayNumber(end) >= target
      && periodBranchMatches(period, branchId);
  });
  // A branch-specific period takes precedence over a global fallback. If two
  // periods of the same specificity match, fail closed instead of guessing.
  const requestedBranch = branchKey(branchId);
  const specific = requestedBranch === null
    ? candidates
    : candidates.filter((period) => branchKey(period.branchId) === requestedBranch);
  const selected = specific.length ? specific : candidates.filter((period) => branchKey(period.branchId) === null);
  return selected.length === 1 ? clone(selected[0]) : undefined;
}

function branchAccessError(period, options = {}) {
  const periodBranch = branchKey(period.branchId);
  const requestedBranch = branchKey(options.branchId);
  if (options.allowedBranchIds !== undefined && !Array.isArray(options.allowedBranchIds)) {
    return invalidResult('محدودهٔ شعبهٔ دوره معتبر نیست.', 'period_branch_scope_invalid');
  }
  const allowedBranches = Array.isArray(options.allowedBranchIds)
    ? options.allowedBranchIds.map(branchKey).filter(Boolean) : null;
  if (periodBranch !== null && requestedBranch === null && !allowedBranches) {
    return invalidResult('برای این دوره، محدودهٔ شعبه مشخص نشده است.', 'period_branch_scope_required');
  }
  if (requestedBranch !== null && periodBranch !== null && requestedBranch !== periodBranch) {
    return invalidResult('دسترسی به دورهٔ مالی این شعبه مجاز نیست.', 'period_branch_access_denied');
  }
  if (allowedBranches && periodBranch !== null && !allowedBranches.includes(periodBranch)) {
    return invalidResult('دسترسی به دورهٔ مالی این شعبه مجاز نیست.', 'period_branch_access_denied');
  }
  if (allowedBranches && requestedBranch !== null && !allowedBranches.includes(requestedBranch)) {
    return invalidResult('دسترسی به این شعبه مجاز نیست.', 'period_branch_access_denied');
  }
  return null;
}

function operationOptions(options) {
  return options && typeof options === 'object' ? options : {};
}

function periodAuditPayload(event) {
  return JSON.stringify({
    version: 1,
    id: event.id,
    periodId: event.periodId,
    action: event.action,
    userId: event.userId,
    branchId: event.branchId ?? null,
    beforeStatus: event.beforeStatus ?? null,
    afterStatus: event.afterStatus ?? null,
    reason: event.reason ?? null,
    idempotencyKey: event.idempotencyKey ?? null,
    requestFingerprint: event.requestFingerprint ?? null,
    previousHash: event.previousHash ?? null,
    at: event.at,
  });
}

function appendPeriodAudit(acc, event) {
  ensurePeriods(acc);
  const previous = acc.periodAudit.at(-1);
  const audit = {
    id: makeId('paud'),
    ...event,
    at: event.at || now(),
    previousHash: previous?.hash || PERIOD_AUDIT_GENESIS,
  };
  audit.hash = crypto.createHash('sha256').update(periodAuditPayload(audit)).digest('hex');
  acc.periodAudit.push(audit);
  return audit;
}

function requestFingerprint(action, periodId, userId, reason, branchId) {
  return JSON.stringify({ action, periodId: String(periodId), userId: String(userId), reason: String(reason || ''), branchId: branchKey(branchId) });
}

function checkReplay(acc, periodId, action, options, reason) {
  const key = identity(options.idempotencyKey);
  if (!key) return null;
  const existing = acc.periodAudit.find((event) => event.idempotencyKey === key);
  if (!existing) return null;
  const expected = requestFingerprint(action, periodId, options.userId, reason, options.branchId);
  if (existing.action !== action || existing.requestFingerprint !== expected) {
    return invalidResult('کلید idempotency قبلاً برای عملیات دیگری استفاده شده است.', 'period_idempotency_conflict');
  }
  const period = acc.fiscalPeriods.find((item) => String(item.id) === String(periodId));
  return { ok: true, idempotentReplay: true, period: clone(period), audit: clone(existing) };
}

function requireActor(userId) {
  return identity(userId) ? null : invalidResult('شناسهٔ کاربر برای تغییر وضعیت دوره الزامی است.', 'period_actor_required');
}

function validateExistingPeriod(period) {
  const start = parseCalendarDay(period.startDate);
  const end = parseCalendarDay(period.endDate);
  if (!start || !end || dayNumber(start) > dayNumber(end)) return null;
  return { start, end };
}

function assertPostingAllowed(acc, dateStr, branchIdOrOptions, maybeOptions = {}) {
  const options = branchIdOrOptions && typeof branchIdOrOptions === 'object'
    ? branchIdOrOptions : { ...maybeOptions, branchId: branchIdOrOptions };
  const day = parseCalendarDay(dateStr);
  if (!day) return {
    allowed: false,
    reason: 'تاریخ سند معتبر نیست.',
    code: 'fiscal_date_invalid',
  };
  if (options.allowedBranchIds !== undefined && !Array.isArray(options.allowedBranchIds)) {
    return { allowed: false, reason: 'محدودهٔ شعبهٔ دوره معتبر نیست.', code: 'period_branch_scope_invalid' };
  }
  if (Array.isArray(options.allowedBranchIds) && options.branchId !== undefined
    && !options.allowedBranchIds.map(branchKey).includes(branchKey(options.branchId))) {
    return { allowed: false, reason: 'دسترسی به این شعبه مجاز نیست.', code: 'period_branch_access_denied' };
  }
  const period = findPeriodForDate(acc, day, options.branchId);
  if (!period) return {
    allowed: false,
    reason: 'برای تاریخ سند دورهٔ مالی تعریف نشده است؛ ثبت قطعی تا ایجاد دورهٔ معتبر مجاز نیست.',
    code: 'fiscal_period_missing',
  };
  if (!['open', 'reopened', 'soft_closed', 'closed'].includes(period.status)) return {
    allowed: false,
    reason: `وضعیت دوره «${period.name}» معتبر نیست.`,
    periodName: period.name, periodStatus: period.status, code: 'fiscal_period_status_invalid',
  };
  if (period.status === 'closed') {
    return {
      allowed: false,
      reason: `دوره «${period.name}» بسته شده است. برای ثبت، ابتدا دوره باید بازگشایی شود.`,
      periodName: period.name, periodStatus: period.status, code: 'fiscal_period_closed',
    };
  }
  if (period.status === 'soft_closed') {
    return {
      allowed: true,
      reason: `دوره «${period.name}» در حالت نیمه‌بسته است. ثبت مجاز اما توصیه نمی‌شود.`,
      periodName: period.name, periodStatus: period.status,
    };
  }
  return { allowed: true, periodName: period.name, periodStatus: period.status };
}

function lockPeriod(acc, periodId, userId, reason, options = {}) {
  ensurePeriods(acc);
  const actorError = requireActor(userId);
  if (actorError) return actorError;
  const period = acc.fiscalPeriods.find((item) => String(item.id) === String(periodId));
  if (!period) return invalidResult('دوره یافت نشد.', 'fiscal_period_not_found');
  const context = { ...operationOptions(options), userId: identity(userId) };
  const scopeError = branchAccessError(period, context);
  if (scopeError) return scopeError;
  if (identity(period.createdByUserId)?.toLowerCase() === identity(userId).toLowerCase()) {
    return invalidResult('ایجادکنندهٔ دوره نمی‌تواند همان دوره را ببندد.', 'period_segregation_of_duties');
  }
  const replay = checkReplay(acc, periodId, 'lock', context, reason || 'Period closed');
  if (replay) return replay;
  if (period.status === 'closed') return invalidResult('دوره قبلاً بسته شده است.', 'fiscal_period_already_closed');
  if (!['open', 'soft_closed', 'reopened'].includes(period.status)) return invalidResult('وضعیت دوره برای بستن معتبر نیست.', 'fiscal_period_status_invalid');
  const beforeStatus = period.status;
  const at = now();
  period.status = 'closed';
  period.lockedAt = at;
  period.lockedByUserId = identity(userId);
  period.closeProgress = 100;
  const audit = appendPeriodAudit(acc, {
    periodId: period.id, action: 'lock', reason: String(reason || 'Period closed').slice(0, 300), userId: identity(userId),
    branchId: period.branchId ?? null, beforeStatus, afterStatus: period.status,
    idempotencyKey: identity(context.idempotencyKey),
    requestFingerprint: requestFingerprint('lock', period.id, userId, reason || 'Period closed', context.branchId), at,
  });
  return { ok: true, message: `دوره «${period.name}» بسته شد.`, period: clone(period), audit: clone(audit), idempotentReplay: false };
}

function reopenPeriod(acc, periodId, userId, reason, options = {}) {
  ensurePeriods(acc);
  const actorError = requireActor(userId);
  if (actorError) return actorError;
  const period = acc.fiscalPeriods.find((item) => String(item.id) === String(periodId));
  if (!period) return invalidResult('دوره یافت نشد.', 'fiscal_period_not_found');
  const context = { ...operationOptions(options), userId: identity(userId) };
  const scopeError = branchAccessError(period, context);
  if (scopeError) return scopeError;
  const normalizedReason = String(reason || '').trim();
  const replay = checkReplay(acc, periodId, 'reopen', context, normalizedReason);
  if (replay) return replay;
  if (!normalizedReason) return invalidResult('علت بازگشایی دوره الزامی است.', 'period_reopen_reason_required');
  if (period.status !== 'closed') return invalidResult('فقط دوره‌های بسته قابل بازگشایی هستند.', 'fiscal_period_not_closed');
  if (String(period.lockedByUserId || '').trim().toLowerCase() === identity(userId).toLowerCase()) {
    return invalidResult('بستن‌کنندهٔ دوره نمی‌تواند همان دوره را بازگشایی کند.', 'period_segregation_of_duties');
  }
  if (String(period.createdByUserId || '').trim().toLowerCase() === identity(userId).toLowerCase()) {
    return invalidResult('ایجادکنندهٔ دوره نمی‌تواند همان دوره را بازگشایی کند.', 'period_segregation_of_duties');
  }
  const beforeStatus = period.status;
  const at = now();
  period.status = 'reopened';
  period.reopenedAt = at;
  period.reopenedByUserId = identity(userId);
  const audit = appendPeriodAudit(acc, {
    periodId: period.id, action: 'reopen', reason: normalizedReason.slice(0, 300), userId: identity(userId),
    branchId: period.branchId ?? null, beforeStatus, afterStatus: period.status,
    idempotencyKey: identity(context.idempotencyKey),
    requestFingerprint: requestFingerprint('reopen', period.id, userId, normalizedReason, context.branchId), at,
  });
  return { ok: true, message: `دوره «${period.name}» بازگشایی شد.`, period: clone(period), audit: clone(audit), idempotentReplay: false };
}

function softClosePeriod(acc, periodId, userId, options = {}) {
  ensurePeriods(acc);
  const actorError = requireActor(userId);
  if (actorError) return actorError;
  const period = acc.fiscalPeriods.find((item) => String(item.id) === String(periodId));
  if (!period) return invalidResult('دوره یافت نشد.', 'fiscal_period_not_found');
  const context = { ...operationOptions(options), userId: identity(userId) };
  const scopeError = branchAccessError(period, context);
  if (scopeError) return scopeError;
  if (identity(period.createdByUserId)?.toLowerCase() === identity(userId).toLowerCase()) {
    return invalidResult('ایجادکنندهٔ دوره نمی‌تواند همان دوره را نیمه‌بسته کند.', 'period_segregation_of_duties');
  }
  const reason = String(context.reason || 'Period soft-closed').trim();
  const replay = checkReplay(acc, periodId, 'soft_close', context, reason);
  if (replay) return replay;
  if (period.status === 'soft_closed') return invalidResult('دوره قبلاً نیمه‌بسته شده است.', 'fiscal_period_already_soft_closed');
  if (period.status === 'closed') return invalidResult('دوره بسته است.', 'fiscal_period_already_closed');
  if (!['open', 'reopened'].includes(period.status)) return invalidResult('وضعیت دوره برای نیمه‌بستن معتبر نیست.', 'fiscal_period_status_invalid');
  const beforeStatus = period.status;
  const at = now();
  period.status = 'soft_closed';
  period.softClosedAt = at;
  period.softClosedByUserId = identity(userId);
  const audit = appendPeriodAudit(acc, {
    periodId: period.id, action: 'soft_close', reason: reason.slice(0, 300), userId: identity(userId),
    branchId: period.branchId ?? null, beforeStatus, afterStatus: period.status,
    idempotencyKey: identity(context.idempotencyKey),
    requestFingerprint: requestFingerprint('soft_close', period.id, userId, reason, context.branchId), at,
  });
  return { ok: true, period: clone(period), audit: clone(audit), idempotentReplay: false };
}

function createPeriod(acc, data = {}, options = {}) {
  ensurePeriods(acc);
  const input = data && typeof data === 'object' ? data : {};
  const context = { ...input, ...operationOptions(options) };
  const startDate = parseCalendarDay(input.startDate);
  const endDate = parseCalendarDay(input.endDate);
  if (!startDate || !endDate || dayNumber(startDate) > dayNumber(endDate)) {
    return invalidResult('محدودهٔ دوره معتبر نیست.', 'fiscal_period_range_invalid');
  }
  const branchId = asBranchId(input.branchId);
  if (context.allowedBranchIds !== undefined && !Array.isArray(context.allowedBranchIds)) {
    return invalidResult('محدودهٔ شعبهٔ دوره معتبر نیست.', 'period_branch_scope_invalid');
  }
  const allowedBranches = Array.isArray(context.allowedBranchIds) ? context.allowedBranchIds.map(branchKey) : null;
  if (allowedBranches && branchId !== null && !allowedBranches.includes(branchKey(branchId))) {
    return invalidResult('ایجاد دوره برای این شعبه مجاز نیست.', 'period_branch_access_denied');
  }
  const idempotencyKey = identity(input.idempotencyKey || context.idempotencyKey);
  if (idempotencyKey) {
    const existing = acc.fiscalPeriods.find((period) => period.idempotencyKey === idempotencyKey);
    if (existing) {
      const samePayload = existing.startDate === startDate && existing.endDate === endDate
        && branchKey(existing.branchId) === branchKey(branchId)
        && existing.name === String(input.name || 'دوره مالی').trim().slice(0, 120)
        && existing.createdByUserId === identity(input.createdByUserId || input.createdBy || input.userId);
      if (!samePayload) return invalidResult('کلید idempotency قبلاً برای دورهٔ دیگری استفاده شده است.', 'period_idempotency_conflict');
      return { ok: true, ...clone(existing), period: clone(existing), idempotentReplay: true };
    }
  }
  for (const existing of acc.fiscalPeriods) {
    const range = validateExistingPeriod(existing);
    if (!range) return invalidResult('یک دورهٔ موجود محدودهٔ نامعتبر دارد.', 'fiscal_period_existing_invalid');
    const overlaps = dayNumber(startDate) <= dayNumber(range.end) && dayNumber(range.start) <= dayNumber(endDate);
    const sameScope = branchKey(existing.branchId) === null || branchKey(branchId) === null
      || branchKey(existing.branchId) === branchKey(branchId);
    if (overlaps && sameScope) return invalidResult(`دوره با «${existing.name || existing.id}» هم‌پوشانی دارد.`, 'fiscal_period_overlap');
  }
  const createdByUserId = identity(input.createdByUserId || input.createdBy || input.userId);
  const period = {
    id: makeId('p'), name: String(input.name || 'دوره مالی').trim().slice(0, 120),
    startDate, endDate, branchId, status: 'open', createdAt: now(), createdByUserId,
    closeProgress: 0, idempotencyKey,
  };
  acc.fiscalPeriods.push(period);
  const audit = appendPeriodAudit(acc, {
    periodId: period.id, action: 'create', reason: 'Period created', userId: createdByUserId || 'system',
    branchId: period.branchId ?? null, beforeStatus: null, afterStatus: period.status,
    idempotencyKey, requestFingerprint: requestFingerprint('create', period.id, createdByUserId || 'system', 'Period created', branchId),
  });
  // Keep the historical return contract: callers receive the period itself.
  // Control metadata is included on the copy, never on the stored object.
  return {
    ok: true,
    ...clone(period),
    period: clone(period),
    audit: clone(audit),
    idempotentReplay: false,
  };
}

function validatePeriods(acc) {
  ensurePeriods(acc);
  const issues = [];
  acc.fiscalPeriods.forEach((period) => {
    const range = validateExistingPeriod(period);
    if (!range) issues.push({ code: 'fiscal_period_range_invalid', periodId: period.id });
  });
  for (let i = 0; i < acc.fiscalPeriods.length; i += 1) {
    const left = validateExistingPeriod(acc.fiscalPeriods[i]);
    if (!left) continue;
    for (let j = i + 1; j < acc.fiscalPeriods.length; j += 1) {
      const right = validateExistingPeriod(acc.fiscalPeriods[j]);
      if (!right) continue;
      const overlaps = dayNumber(left.start) <= dayNumber(right.end) && dayNumber(right.start) <= dayNumber(left.end);
      const sameScope = branchKey(acc.fiscalPeriods[i].branchId) === null || branchKey(acc.fiscalPeriods[j].branchId) === null
        || branchKey(acc.fiscalPeriods[i].branchId) === branchKey(acc.fiscalPeriods[j].branchId);
      if (overlaps && sameScope) issues.push({ code: 'fiscal_period_overlap', periodIds: [acc.fiscalPeriods[i].id, acc.fiscalPeriods[j].id] });
    }
  }
  return { valid: issues.length === 0, issues };
}

function verifyPeriodAuditChain(acc) {
  ensurePeriods(acc);
  let previousHash = PERIOD_AUDIT_GENESIS;
  let valid = true;
  let hasUnsealed = false;
  const events = acc.periodAudit.map((event, index) => {
    if (!event || !/^[a-f0-9]{64}$/i.test(String(event.hash || ''))) {
      hasUnsealed = true;
      previousHash = PERIOD_AUDIT_GENESIS;
      return { index: index + 1, eventId: event?.id, valid: true, hashPresent: false, storedHash: '(unsealed)' };
    }
    const expectedHash = crypto.createHash('sha256').update(periodAuditPayload({ ...event, previousHash })).digest('hex');
    const rowValid = event.previousHash === previousHash && event.hash === expectedHash;
    if (!rowValid) valid = false;
    previousHash = rowValid ? event.hash : expectedHash;
    return { index: index + 1, eventId: event.id, valid: rowValid, hashPresent: true, storedHash: event.hash, expectedHash };
  });
  return {
    valid, isIntegrityValid: valid, isTamperEvident: valid && !hasUnsealed,
    integrityLevel: !valid ? 'compromised' : hasUnsealed ? 'legacy_or_unsealed' : 'v1_tamper_evident',
    lastHash: previousHash, events,
  };
}

function listPeriods(acc) {
  ensurePeriods(acc);
  return acc.fiscalPeriods.slice().sort((a, b) => {
    const left = parseCalendarDay(a.startDate);
    const right = parseCalendarDay(b.startDate);
    return (right ? dayNumber(right) : -Infinity) - (left ? dayNumber(left) : -Infinity);
  }).map(clone);
}

module.exports = {
  ensurePeriods, findPeriodForDate, assertPostingAllowed,
  lockPeriod, reopenPeriod, softClosePeriod, createPeriod, listPeriods, validatePeriods, verifyPeriodAuditChain,
};
