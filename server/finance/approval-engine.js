'use strict';
/**
 * WESTO Finance — Approval Engine (ported from NEEM)
 * Multi-level approval workflows, threshold-based auto-approval.
 *
 * This module is deliberately fail-closed. An approval is a control
 * boundary, not just a UI state: the configured level, an independent actor,
 * and the branch scope must all match before the item can move forward.
 */
const crypto = require('crypto');
const { toEnDigits } = require('./money');

const DEFAULT_SETTINGS = {
  autoApproveThreshold: 500000,
  levels: [
    { level: 1, role: 'accountant', label: 'حسابدار' },
    { level: 2, role: 'manager', label: 'مدیر' },
    { level: 3, role: 'owner', label: 'مالک' },
  ],
};

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function error(message, code) {
  return { error: message, code };
}

function asIdentity(value) {
  const identity = String(value ?? '').trim();
  return identity || null;
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

function parseSafeInteger(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value === 'bigint') {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
  }
  const raw = toEnDigits(String(value ?? '')).replace(/,/g, '').trim();
  if (!/^-?\d+$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function normaliseSettings(settings) {
  const source = settings || DEFAULT_SETTINGS;
  const threshold = parseSafeInteger(source.autoApproveThreshold);
  if (threshold === null || threshold < 0) {
    throw Object.assign(new Error('تنظیمات تأیید خودکار معتبر نیست.'), { code: 'approval_settings_invalid' });
  }
  if (!Array.isArray(source.levels) || source.levels.length === 0) {
    throw Object.assign(new Error('حداقل یک سطح تأیید الزامی است.'), { code: 'approval_settings_invalid' });
  }
  const levels = source.levels.map((level) => {
    const number = parseSafeInteger(level?.level);
    const role = asIdentity(level?.role)?.toLowerCase();
    if (!number || number < 1 || !role) {
      throw Object.assign(new Error('سطوح تأیید معتبر نیستند.'), { code: 'approval_settings_invalid' });
    }
    return { level: number, role, label: String(level.label || '').trim() || role };
  }).sort((a, b) => a.level - b.level);
  const levelNumbers = levels.map((level) => level.level);
  const contiguous = levelNumbers.every((level, index) => level === index + 1);
  if (!contiguous || new Set(levelNumbers).size !== levelNumbers.length) {
    throw Object.assign(new Error('شماره سطوح تأیید باید یکتا و پیوسته باشد.'), { code: 'approval_settings_invalid' });
  }
  return { autoApproveThreshold: threshold, levels };
}

function ensureApprovals(acc) {
  if (!acc || typeof acc !== 'object') throw new TypeError('حسابداری معتبر نیست.');
  if (!Array.isArray(acc.approvalQueue)) acc.approvalQueue = [];
  if (!acc.approvalSettings) acc.approvalSettings = clone(DEFAULT_SETTINGS);
  acc.approvalSettings = normaliseSettings(acc.approvalSettings);
  return acc;
}

function ensureHistory(item) {
  if (!Array.isArray(item.history)) item.history = [];
  if (!Array.isArray(item.approvals)) item.approvals = [];
}

function now() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function scopeError(item, options = {}) {
  const itemBranch = branchKey(item.branchId);
  if (options.allowedBranchIds !== undefined && !Array.isArray(options.allowedBranchIds)) {
    return error('محدودهٔ شعبهٔ درخواست معتبر نیست.', 'approval_branch_scope_invalid');
  }
  if (itemBranch === null) return null;
  const requestedBranch = branchKey(options.branchId);
  const allowedBranches = Array.isArray(options.allowedBranchIds)
    ? options.allowedBranchIds.map(branchKey).filter(Boolean)
    : null;
  if (requestedBranch === null && !allowedBranches) {
    return error('برای این درخواست، محدودهٔ شعبه مشخص نشده است.', 'approval_branch_scope_required');
  }
  if (requestedBranch !== null && requestedBranch !== itemBranch) {
    return error('دسترسی به درخواست تأیید این شعبه مجاز نیست.', 'approval_branch_access_denied');
  }
  if (allowedBranches && !allowedBranches.includes(itemBranch)) {
    return error('دسترسی به درخواست تأیید این شعبه مجاز نیست.', 'approval_branch_access_denied');
  }
  return null;
}

function decisionContext(options) {
  return options && typeof options === 'object' ? options : {};
}

function normaliseComment(value) {
  return String(value || '').slice(0, 300);
}

function decisionFingerprint(item, action, context, level) {
  return JSON.stringify({
    action,
    approvalId: String(item.id),
    level,
    userId: asIdentity(context.userId),
    role: asIdentity(context.role)?.toLowerCase() || null,
    branchId: branchKey(context.branchId),
    comment: normaliseComment(context.comment || context.reason),
  });
}

function findReplay(item, action, idempotencyKey) {
  const key = asIdentity(idempotencyKey);
  if (!key) return null;
  ensureHistory(item);
  return item.history.find((event) => event.idempotencyKey === key && event.action === action) || null;
}

function findDecisionKeyConflict(acc, item, action, idempotencyKey) {
  const key = asIdentity(idempotencyKey);
  if (!key) return null;
  for (const candidate of acc.approvalQueue) {
    ensureHistory(candidate);
    const event = candidate.history.find((entry) => entry.idempotencyKey === key);
    if (!event) continue;
    if (candidate.id !== item.id || event.action !== action) {
      return error('کلید idempotency قبلاً برای تصمیم دیگری استفاده شده است.', 'approval_idempotency_conflict');
    }
    return event;
  }
  return null;
}

function replayResult(item, event) {
  return {
    ok: true,
    status: item.status,
    approvalId: item.id,
    item: clone(item),
    idempotentReplay: true,
    replayedAction: event.action,
  };
}

function validateReplayActor(item, event, context) {
  const scope = scopeError(item, context);
  if (scope) return scope;
  const userId = asIdentity(context.userId);
  const role = asIdentity(context.role)?.toLowerCase();
  if (!userId || !role) return error('شناسهٔ کاربر و نقش approver الزامی است.', 'approval_actor_required');
  if (userId.toLowerCase() !== String(event.by || '').trim().toLowerCase()
    || role !== String(event.role || '').trim().toLowerCase()) {
    return error('بازپخش تصمیم فقط برای همان approver و نقش ثبت‌کننده مجاز است.', 'approval_replay_actor_mismatch');
  }
  if (event.requestFingerprint && event.requestFingerprint !== decisionFingerprint(item, event.action, context, event.level)) {
    return error('کلید idempotency برای بدنهٔ متفاوتی ارسال شده است.', 'approval_idempotency_conflict');
  }
  return null;
}

function appendHistory(item, event) {
  ensureHistory(item);
  item.history.push({
    id: makeId('apvh'),
    at: now(),
    ...event,
  });
}

function submitForApproval(acc, input = {}) {
  ensureApprovals(acc);
  const type = asIdentity(input.type);
  const entityId = asIdentity(input.entityId);
  const submittedBy = asIdentity(input.submittedBy);
  if (!type || !entityId || !submittedBy) {
    return error('نوع، شناسهٔ موجودیت و ایجادکنندهٔ درخواست الزامی است.', 'approval_request_invalid');
  }
  const amount = parseSafeInteger(input.amount);
  if (amount === null || amount < 0) {
    return error('مبلغ درخواست تأیید باید عدد صحیح امن و غیرمنفی باشد.', 'approval_amount_invalid');
  }
  const branchId = asBranchId(input.branchId);
  const idempotencyKey = asIdentity(input.idempotencyKey);
  if (input.allowedBranchIds !== undefined && !Array.isArray(input.allowedBranchIds)) {
    return error('محدودهٔ شعبهٔ درخواست معتبر نیست.', 'approval_branch_scope_invalid');
  }
  const allowedBranches = Array.isArray(input.allowedBranchIds)
    ? input.allowedBranchIds.map(branchKey).filter(Boolean) : null;
  if (allowedBranches && branchId === null) {
    return error('ثبت درخواست بدون محدودهٔ شعبه برای کاربر شعبه‌ای مجاز نیست.', 'approval_branch_scope_required');
  }
  if (allowedBranches && branchId !== null && !allowedBranches.includes(branchKey(branchId))) {
    return error('ثبت درخواست برای این شعبه مجاز نیست.', 'approval_branch_access_denied');
  }
  if (idempotencyKey) {
    const replay = acc.approvalQueue.find((item) => item.idempotencyKey === idempotencyKey);
    if (replay) {
      const suppliedDescription = input.description == null
        ? null
        : String(input.description || '').trim().slice(0, 300);
      const samePayload = replay.type === type && String(replay.entityId) === entityId
        && replay.amount === amount && branchKey(replay.branchId) === branchKey(branchId)
        && replay.submittedBy === submittedBy
        && (suppliedDescription === null || replay.description === suppliedDescription);
      if (!samePayload) return error('کلید idempotency قبلاً برای بدنهٔ دیگری استفاده شده است.', 'approval_idempotency_conflict');
      return { status: replay.status, approvalId: replay.id, item: clone(replay), idempotentReplay: true };
    }
  }

  const pending = acc.approvalQueue.find((item) => item.status === 'pending'
    && item.type === type && String(item.entityId) === entityId
    && branchKey(item.branchId) === branchKey(branchId));
  if (pending) {
    const suppliedDescription = input.description == null
      ? null
      : String(input.description || '').trim().slice(0, 300);
    const samePayload = pending.amount === amount && pending.submittedBy === submittedBy
      && (suppliedDescription === null || pending.description === suppliedDescription);
    if (!samePayload) return error('برای این موجودیت یک درخواست معلق با بدنهٔ متفاوت وجود دارد.', 'approval_duplicate_conflict');
    return { status: pending.status, approvalId: pending.id, item: clone(pending), idempotentReplay: true };
  }

  const settings = normaliseSettings(acc.approvalSettings);
  const id = makeId('apv');
  const item = {
    id, type, entityId, description: String(input.description || '').trim().slice(0, 300), amount,
    branchId, submittedBy, submittedAt: now(), status: amount <= settings.autoApproveThreshold ? 'auto_approved' : 'pending',
    currentLevel: 1, approvals: [], history: [], idempotencyKey,
  };
  appendHistory(item, {
    action: 'submitted', by: submittedBy, branchId, idempotencyKey, status: item.status,
  });
  // Retaining an auto-approved request only when a caller supplied a key makes
  // retry semantics durable without changing the old queue shape for ordinary
  // threshold-approved operations.
  if (item.status === 'pending' || idempotencyKey) acc.approvalQueue.push(item);
  return {
    status: item.status,
    approvalId: item.status === 'pending' || idempotencyKey ? id : undefined,
    item: clone(item),
    idempotentReplay: false,
  };
}

function validateActor(item, levelDef, context) {
  const userId = asIdentity(context.userId);
  const role = asIdentity(context.role)?.toLowerCase();
  if (!userId || !role) return error('شناسهٔ کاربر و نقش approver الزامی است.', 'approval_actor_required');
  if (!levelDef || role !== levelDef.role) {
    return error(`این عملیات در سطح فعلی فقط برای نقش «${levelDef?.role || 'نامشخص'}» مجاز است.`, 'approval_role_mismatch');
  }
  if (userId.toLowerCase() === String(item.submittedBy || '').trim().toLowerCase()) {
    return error('ایجادکننده نمی‌تواند درخواست خودش را تأیید یا رد کند.', 'approval_segregation_of_duties');
  }
  if (item.approvals.some((approval) => String(approval.userId).toLowerCase() === userId.toLowerCase())) {
    return error('هر درخواست باید توسط approverهای مستقل تصمیم‌گیری شود.', 'approval_approver_reuse');
  }
  return scopeError(item, context) || null;
}

function approveItem(acc, approvalId, options = {}) {
  ensureApprovals(acc);
  const item = acc.approvalQueue.find((approval) => String(approval.id) === String(approvalId));
  if (!item) return error('مورد تأیید یافت نشد.', 'approval_not_found');
  const context = decisionContext(options);
  const keyCheck = findDecisionKeyConflict(acc, item, 'approved', context.idempotencyKey);
  if (keyCheck && keyCheck.error) return keyCheck;
  const replay = findReplay(item, 'approved', context.idempotencyKey);
  if (replay) {
    const replayError = validateReplayActor(item, replay, context);
    if (replayError) return replayError;
    return replayResult(item, replay);
  }
  if (item.status !== 'pending') return error('این مورد قبلاً پردازش شده است.', 'approval_already_decided');
  ensureHistory(item);
  const levelDef = acc.approvalSettings.levels.find((level) => level.level === item.currentLevel);
  const actorError = validateActor(item, levelDef, context);
  if (actorError) return actorError;
  const at = now();
  item.approvals.push({
    userId: asIdentity(context.userId), role: asIdentity(context.role).toLowerCase(), level: item.currentLevel,
    action: 'approved', comment: String(context.comment || '').slice(0, 300), at,
  });
  appendHistory(item, {
    action: 'approved', by: asIdentity(context.userId), role: asIdentity(context.role).toLowerCase(),
    level: item.currentLevel, branchId: item.branchId, comment: normaliseComment(context.comment),
    idempotencyKey: asIdentity(context.idempotencyKey),
    requestFingerprint: decisionFingerprint(item, 'approved', context, item.currentLevel),
  });
  if (item.currentLevel >= acc.approvalSettings.levels.length) {
    item.status = 'approved';
    item.approvedAt = at;
  } else {
    item.currentLevel += 1;
  }
  return { ok: true, status: item.status, item: clone(item), idempotentReplay: false };
}

function rejectItem(acc, approvalId, options = {}) {
  ensureApprovals(acc);
  const item = acc.approvalQueue.find((approval) => String(approval.id) === String(approvalId));
  if (!item) return error('مورد تأیید یافت نشد.', 'approval_not_found');
  const context = decisionContext(options);
  const keyCheck = findDecisionKeyConflict(acc, item, 'rejected', context.idempotencyKey);
  if (keyCheck && keyCheck.error) return keyCheck;
  const replay = findReplay(item, 'rejected', context.idempotencyKey);
  if (replay) {
    const replayError = validateReplayActor(item, replay, context);
    if (replayError) return replayError;
    return replayResult(item, replay);
  }
  if (item.status !== 'pending') return error('این مورد قبلاً پردازش شده است.', 'approval_already_decided');
  const reason = String(context.comment || context.reason || '').trim();
  if (!reason) return error('علت رد درخواست الزامی است.', 'approval_rejection_reason_required');
  ensureHistory(item);
  const levelDef = acc.approvalSettings.levels.find((level) => level.level === item.currentLevel);
  const actorError = validateActor(item, levelDef, context);
  if (actorError) return actorError;
  const at = now();
  item.status = 'rejected';
  item.rejectedAt = at;
  item.approvals.push({
    userId: asIdentity(context.userId), role: asIdentity(context.role).toLowerCase(), level: item.currentLevel,
    action: 'rejected', comment: reason.slice(0, 300), at,
  });
  appendHistory(item, {
    action: 'rejected', by: asIdentity(context.userId), role: asIdentity(context.role).toLowerCase(),
    level: item.currentLevel, branchId: item.branchId, comment: reason.slice(0, 300), idempotencyKey: asIdentity(context.idempotencyKey),
    requestFingerprint: decisionFingerprint(item, 'rejected', context, item.currentLevel),
  });
  return { ok: true, status: item.status, item: clone(item), idempotentReplay: false };
}

function listPending(acc, roleOrOptions, maybeOptions = {}) {
  ensureApprovals(acc);
  const options = typeof roleOrOptions === 'object' && roleOrOptions !== null
    ? { ...roleOrOptions } : { ...maybeOptions, role: roleOrOptions };
  const role = asIdentity(options.role)?.toLowerCase();
  if (options.allowedBranchIds !== undefined && !Array.isArray(options.allowedBranchIds)) return [];
  const allowedBranches = Array.isArray(options.allowedBranchIds)
    ? options.allowedBranchIds.map(branchKey).filter(Boolean) : null;
  return acc.approvalQueue.filter((item) => {
    if (item.status !== 'pending') return false;
    const levelDef = acc.approvalSettings.levels.find((level) => level.level === item.currentLevel);
    if (role && (!levelDef || levelDef.role !== role)) return false;
    const itemBranch = branchKey(item.branchId);
    if (options.branchId !== undefined && options.branchId !== null && options.branchId !== '') {
      if (itemBranch !== branchKey(options.branchId)) return false;
    }
    if (itemBranch !== null && options.branchId === undefined && !allowedBranches) return false;
    if (allowedBranches && (itemBranch === null || !allowedBranches.includes(itemBranch))) return false;
    return true;
  }).map(clone);
}

module.exports = { ensureApprovals, submitForApproval, approveItem, rejectItem, listPending };
