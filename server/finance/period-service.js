'use strict';
/**
 * WESTO Finance — Period Service (ported from NEEM)
 * Fiscal period management: create, open, soft-close, close, reopen.
 * Period-lock validation on all postings.
 */

function ensurePeriods(acc) {
  if (!Array.isArray(acc.fiscalPeriods)) acc.fiscalPeriods = [];
  return acc.fiscalPeriods;
}

function findPeriodForDate(acc, dateStr) {
  const d = new Date(dateStr);
  return (acc.fiscalPeriods || []).find(p => {
    return new Date(p.startDate) <= d && new Date(p.endDate) >= d;
  });
}

function assertPostingAllowed(acc, dateStr) {
  const period = findPeriodForDate(acc, dateStr);
  if (!period) return {
    allowed: false,
    reason: 'برای تاریخ سند دورهٔ مالی تعریف نشده است؛ ثبت قطعی تا ایجاد دورهٔ معتبر مجاز نیست.',
    code: 'fiscal_period_missing',
  };
  if (period.status === 'closed') {
    return {
      allowed: false,
      reason: `دوره «${period.name}» بسته شده است. برای ثبت، ابتدا دوره باید بازگشایی شود.`,
      periodName: period.name, periodStatus: period.status,
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

function lockPeriod(acc, periodId, userId, reason) {
  const period = (acc.fiscalPeriods || []).find(p => p.id === periodId);
  if (!period) return { ok: false, message: 'دوره یافت نشد.' };
  if (period.status === 'closed') return { ok: false, message: 'دوره قبلاً بسته شده است.' };
  period.status = 'closed';
  period.lockedAt = new Date().toISOString();
  period.lockedByUserId = userId;
  period.closeProgress = 100;
  if (!Array.isArray(acc.periodAudit)) acc.periodAudit = [];
  acc.periodAudit.push({ periodId, action: 'lock', reason: reason || 'Period closed', userId, at: new Date().toISOString() });
  return { ok: true, message: `دوره «${period.name}» بسته شد.`, period };
}

function reopenPeriod(acc, periodId, userId, reason) {
  const period = (acc.fiscalPeriods || []).find(p => p.id === periodId);
  if (!period) return { ok: false, message: 'دوره یافت نشد.' };
  if (period.status !== 'closed') return { ok: false, message: 'فقط دوره‌های بسته قابل بازگشایی هستند.' };
  period.status = 'reopened';
  period.reopenedAt = new Date().toISOString();
  period.reopenedByUserId = userId;
  if (!Array.isArray(acc.periodAudit)) acc.periodAudit = [];
  acc.periodAudit.push({ periodId, action: 'reopen', reason: reason || 'Period reopened', userId, at: new Date().toISOString() });
  return { ok: true, message: `دوره «${period.name}» بازگشایی شد.`, period };
}

function softClosePeriod(acc, periodId, userId) {
  const period = (acc.fiscalPeriods || []).find(p => p.id === periodId);
  if (!period) return { ok: false, message: 'دوره یافت نشد.' };
  if (period.status === 'closed') return { ok: false, message: 'دوره بسته است.' };
  period.status = 'soft_closed';
  period.softClosedAt = new Date().toISOString();
  return { ok: true, period };
}

function createPeriod(acc, data) {
  const id = `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const period = {
    id,
    name: data.name || `دوره مالی`,
    startDate: data.startDate,
    endDate: data.endDate,
    status: 'open',
    createdAt: new Date().toISOString(),
    closeProgress: 0,
  };
  if (!Array.isArray(acc.fiscalPeriods)) acc.fiscalPeriods = [];
  acc.fiscalPeriods.push(period);
  return period;
}

function listPeriods(acc) {
  return (acc.fiscalPeriods || []).sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
}

module.exports = {
  ensurePeriods, findPeriodForDate, assertPostingAllowed,
  lockPeriod, reopenPeriod, softClosePeriod, createPeriod, listPeriods,
};
