'use strict';
/**
 * WESTO Finance — Accrual & Prepaid Engine (ported from NEEM)
 * Handles expense/revenue recognition in proper periods and prepaid amortization schedules.
 */
const { toInt, toIntegerIRR } = require('./money');

const ACTIVE_ACCRUAL_STATUSES = new Set(['posted', 'partially_paid', 'paid']);
const DUPLICATE_ACCRUAL_STATUSES = new Set([...ACTIVE_ACCRUAL_STATUSES, 'pending_approval']);
const ACTIVE_PAYMENT_STATUSES = new Set(['posted', 'paid', 'pending_approval']);

function financeError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  return error;
}

function normalizeDate(value, code, message, { dateOnly = false } = {}) {
  const raw = String(value || '').trim();
  const date = new Date(raw);
  if (!raw || !Number.isFinite(date.getTime())) throw financeError(code, message);
  if (dateOnly && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw financeError(code, message);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && date.toISOString().slice(0, 10) !== raw) throw financeError(code, message);
  return date;
}

function monthOf(date) {
  return date.toISOString().slice(0, 7);
}

function safeAmount(value, code, message, { allowZero = false } = {}) {
  let amount;
  try {
    amount = toIntegerIRR(value);
  } catch (error) {
    throw financeError(code, message);
  }
  if (!Number.isSafeInteger(amount) || (allowZero ? amount < 0 : amount <= 0)) {
    throw financeError(code, message);
  }
  return amount;
}

function stableInput(input) {
  return JSON.stringify({
    type: input.type || 'expense',
    description: String(input.description || 'ثبت هزینه تعهدی').slice(0, 200),
    amount: toInt(input.amount),
    periodName: String(input.periodName || '').slice(0, 50),
    startDate: input.startDate || null,
    endDate: input.endDate || null,
    reversalDate: input.reversalDate || null,
    expenseAccountCode: input.expenseAccountCode || '6990',
    payableAccountCode: input.payableAccountCode || '2700',
    recurringKey: input.recurringKey || null,
    branchId: input.branchId == null ? null : Number(input.branchId),
    serviceMonth: input.serviceMonth || null,
    totalPeriods: input.totalPeriods == null ? 12 : Number(input.totalPeriods),
    assetAccountCode: input.assetAccountCode || '1700',
  });
}

function periodBoundary(value, isEnd = false) {
  const raw = String(value || '').trim();
  if (isEnd && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T23:59:59.999Z`);
  return new Date(raw);
}

function assertOpenPeriod(acc, date, codePrefix) {
  if (!Array.isArray(acc.fiscalPeriods) || acc.fiscalPeriods.length === 0) return null;
  const period = acc.fiscalPeriods.find((candidate) => {
    const start = periodBoundary(candidate.startDate);
    const end = periodBoundary(candidate.endDate, true);
    return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && start <= date && end >= date;
  });
  if (!period) throw financeError(`${codePrefix}_period_missing`, 'برای تاریخ ثبت، دوره مالی معتبر یافت نشد.');
  if (period.status === 'closed') throw financeError(`${codePrefix}_period_closed`, `دوره «${period.name || ''}» بسته شده است.`);
  return period;
}

function assertBranchExists(acc, branchId, codePrefix) {
  if (branchId == null || !Array.isArray(acc.branches) || acc.branches.length === 0) return;
  if (!acc.branches.some((branch) => Number(branch.id) === branchId && branch.active !== false)) {
    throw financeError(`${codePrefix}_branch_not_found`, 'شعبه ثبت مالی یافت نشد یا غیرفعال است.');
  }
}

function resolveActor(input, fallback = 'admin') {
  return String(input || fallback).trim() || fallback;
}

function ensureAccruals(acc) {
  if (!Array.isArray(acc.accruals)) acc.accruals = [];
  if (!Array.isArray(acc.prepaids)) acc.prepaids = [];
  if (!Array.isArray(acc.accrualPayments)) acc.accrualPayments = [];
  return acc;
}

function createAccrual(acc, input = {}) {
  ensureAccruals(acc);
  const {
    type = 'expense', description, amount, periodName, startDate, endDate, reversalDate,
    expenseAccountCode = '6990', payableAccountCode = '2700', recurringKey, createdById,
    branchId, serviceMonth, idempotencyKey,
  } = input;
  const amountIrr = safeAmount(amount, 'accrual_amount_invalid', 'مبلغ تعهد باید عدد صحیح مثبت باشد.');
  const start = normalizeDate(startDate || new Date().toISOString(), 'accrual_start_date_invalid', 'تاریخ شروع تعهد معتبر نیست.');
  const end = normalizeDate(endDate || start.toISOString(), 'accrual_end_date_invalid', 'تاریخ پایان تعهد معتبر نیست.');
  if (end < start) throw financeError('accrual_date_range_invalid', 'تاریخ پایان تعهد نمی‌تواند قبل از تاریخ شروع باشد.');
  const reversal = reversalDate == null || reversalDate === ''
    ? null
    : normalizeDate(reversalDate, 'accrual_reversal_date_invalid', 'تاریخ معکوس‌سازی تعهد معتبر نیست.');
  if (reversal && reversal < start) throw financeError('accrual_reversal_date_invalid', 'تاریخ معکوس‌سازی تعهد نمی‌تواند قبل از شروع تعهد باشد.');
  const numericBranchId = branchId == null || branchId === '' ? null : Number(branchId);
  if (numericBranchId != null && (!Number.isSafeInteger(numericBranchId) || numericBranchId <= 0)) {
    throw financeError('accrual_branch_invalid', 'شعبه تعهد معتبر نیست.');
  }
  const normalizedMonth = serviceMonth == null || serviceMonth === '' ? monthOf(start) : String(serviceMonth).trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(normalizedMonth)) throw financeError('accrual_service_month_invalid', 'ماه تعهد باید با قالب YYYY-MM باشد.');
  if (normalizedMonth !== monthOf(start)) throw financeError('accrual_service_month_mismatch', 'ماه تعهد با تاریخ شروع یکسان نیست.');
  assertBranchExists(acc, numericBranchId, 'accrual');
  const requestKey = idempotencyKey == null ? null : String(idempotencyKey).trim();
  if (requestKey) {
    const existingByKey = acc.accruals.find((item) => item.idempotencyKey === requestKey);
    if (existingByKey) {
      if (existingByKey.requestFingerprint !== stableInput(input)) {
        throw financeError('accrual_idempotency_conflict', 'کلید idempotency قبلاً با بدنه متفاوت استفاده شده است.');
      }
      return { ok: true, accrual: existingByKey, idempotentReplay: true };
    }
  }
  const period = assertOpenPeriod(acc, start, 'accrual');
  if (recurringKey) {
    const duplicate = acc.accruals.find((item) => item.recurringKey === String(recurringKey) && Number(item.branchId || 0) === Number(numericBranchId || 0)
      && item.serviceMonth === normalizedMonth && DUPLICATE_ACCRUAL_STATUSES.has(item.status));
    if (duplicate) throw financeError('accrual_period_duplicate', 'این تعهد دوره‌ای برای این شعبه و ماه قبلاً ثبت شده است.');
  }
  const id = `accr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const number = `ACCR-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;
  const item = {
    id,
    number,
    type,
    description: String(description || 'ثبت هزینه تعهدی').slice(0, 200),
    amount: amountIrr,
    periodName: String(periodName || '').slice(0, 50),
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    reversalDate: reversal ? reversal.toISOString() : null,
    serviceMonth: normalizedMonth,
    branchId: numericBranchId,
    fiscalPeriodId: period ? period.id : null,
    status: 'posted',
    expenseAccountCode,
    payableAccountCode,
    recurringKey: recurringKey || null,
    createdAt: new Date().toISOString(),
    createdById: resolveActor(createdById),
    idempotencyKey: requestKey,
    requestFingerprint: requestKey ? stableInput(input) : null,
  };
  acc.accruals.push(item);
  return { ok: true, accrual: item };
}

function reverseAccrual(acc, accrualId, userId, options = {}) {
  ensureAccruals(acc);
  const accrual = acc.accruals.find(a => a.id === accrualId);
  if (!accrual) return { ok: false, error: 'تعهدیابی یافت نشد.' };
  if (accrual.status === 'reversed') return { ok: false, error: 'این تعهد قبلاً معکوس شده است.' };
  if (!ACTIVE_ACCRUAL_STATUSES.has(accrual.status)) return { ok: false, error: 'فقط تعهد ثبت‌شده قابل معکوس‌سازی است.' };
  if (['partially_paid', 'paid'].includes(accrual.status) || toInt(accrual.paidAmount) > 0
    || acc.accrualPayments.some((payment) => payment.accrualId === accrual.id && ACTIVE_PAYMENT_STATUSES.has(payment.status))) {
    return { ok: false, error: 'تعهدی که پرداخت دارد مستقیماً قابل معکوس‌سازی نیست.' };
  }
  const reverseDate = options.date || new Date().toISOString();
  const date = normalizeDate(reverseDate, 'accrual_reversal_date_invalid', 'تاریخ معکوس‌سازی تعهد معتبر نیست.');
  const accrualStart = normalizeDate(accrual.startDate, 'accrual_start_date_invalid', 'تاریخ شروع تعهد معتبر نیست.');
  if (date < accrualStart) throw financeError('accrual_reversal_date_invalid', 'تاریخ معکوس‌سازی تعهد نمی‌تواند قبل از تاریخ شروع تعهد باشد.');
  assertOpenPeriod(acc, date, 'accrual_reversal');
  accrual.status = 'reversed';
  accrual.reversedAt = date.toISOString();
  accrual.reversedBy = resolveActor(typeof userId === 'object' ? userId.userId : userId);
  accrual.reversalReason = String(options.reason || '').trim().slice(0, 300) || null;
  return { ok: true, accrual };
}

function createPrepaidExpense(acc, input = {}) {
  ensureAccruals(acc);
  const { description, amount, startDate, endDate, assetAccountCode = '1700', expenseAccountCode = '6200', totalPeriods = 12, createdById, branchId, idempotencyKey } = input;
  const totalAmt = safeAmount(amount, 'prepaid_amount_invalid', 'مبلغ پیش‌پرداخت باید عدد صحیح مثبت باشد.');
  const start = normalizeDate(startDate || new Date().toISOString(), 'prepaid_start_date_invalid', 'تاریخ شروع پیش‌پرداخت معتبر نیست.');
  const periods = Number(totalPeriods);
  if (!Number.isInteger(periods) || periods < 1 || periods > 600) throw financeError('prepaid_periods_invalid', 'تعداد دوره‌های پیش‌پرداخت باید بین ۱ تا ۶۰۰ باشد.');
  const end = normalizeDate(endDate || addMonthsClamped(start, periods - 1).toISOString(), 'prepaid_end_date_invalid', 'تاریخ پایان پیش‌پرداخت معتبر نیست.');
  if (end < start || addMonthsClamped(start, periods - 1) > end) throw financeError('prepaid_date_range_invalid', 'بازه پیش‌پرداخت با تعداد دوره‌های انتخاب‌شده سازگار نیست.');
  const numericBranchId = branchId == null || branchId === '' ? null : Number(branchId);
  if (numericBranchId != null && (!Number.isSafeInteger(numericBranchId) || numericBranchId <= 0)) throw financeError('prepaid_branch_invalid', 'شعبه پیش‌پرداخت معتبر نیست.');
  assertBranchExists(acc, numericBranchId, 'prepaid');
  const requestKey = idempotencyKey == null ? null : String(idempotencyKey).trim();
  if (requestKey) {
    const existing = acc.prepaids.find((item) => item.idempotencyKey === requestKey);
    if (existing) {
      if (existing.requestFingerprint !== stableInput(input)) throw financeError('prepaid_idempotency_conflict', 'کلید idempotency قبلاً با بدنه متفاوت استفاده شده است.');
      return { ok: true, prepaid: existing, idempotentReplay: true };
    }
  }
  // Creating the schedule is not itself a ledger posting. The open-period
  // control belongs to each amortization journal, so a prepaid starting in a
  // historical/future month can be recorded before its first recognition.
  const period = Array.isArray(acc.fiscalPeriods)
    ? acc.fiscalPeriods.find((candidate) => {
      const candidateStart = new Date(candidate.startDate);
      const candidateEnd = periodBoundary(candidate.endDate, true);
      return Number.isFinite(candidateStart.getTime()) && Number.isFinite(candidateEnd.getTime())
        && candidateStart <= start && candidateEnd >= start && candidate.status !== 'closed';
    }) || null
    : null;
  const id = `prep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const number = `PREP-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;
  const allocations = Array.from({ length: periods }, (_, index) => Math.floor(totalAmt / periods) + (index < totalAmt % periods ? 1 : 0));
  
  // Build amortization schedule
  const schedule = [];
  for (let i = 0; i < periods; i++) {
    const periodDate = addMonthsClamped(start, i);
    schedule.push({
      periodIndex: i + 1,
      targetDate: periodDate.toISOString().slice(0, 10),
      amount: allocations[i],
      status: 'pending',
      amortizedAt: null,
    });
  }

  const prepaid = {
    id,
    number,
    description: String(description || 'پیش‌پرداخت هزینه').slice(0, 200),
    amount: totalAmt,
    amortizedAmount: 0,
    remainingAmount: totalAmt,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    branchId: numericBranchId,
    fiscalPeriodId: period ? period.id : null,
    assetAccountCode,
    expenseAccountCode,
    totalPeriods: periods,
    schedule,
    status: 'active',
    createdAt: new Date().toISOString(),
    createdById: resolveActor(createdById),
    idempotencyKey: requestKey,
    requestFingerprint: requestKey ? stableInput(input) : null,
  };
  acc.prepaids.push(prepaid);
  return { ok: true, prepaid };
}

function amortizePrepaidPeriod(acc, prepaidId, periodIndex) {
  ensureAccruals(acc);
  const prepaid = acc.prepaids.find(p => p.id === prepaidId);
  if (!prepaid) return { ok: false, error: 'پیش‌پرداخت یافت نشد.' };
  if (prepaid.status !== 'active') return { ok: false, error: 'فقط پیش‌پرداخت فعال قابل استهلاک است.' };
  if (prepaid.status === 'reversed') return { ok: false, error: 'پیش‌پرداخت معکوس شده است.' };
  const item = prepaid.schedule.find(s => s.periodIndex === Number(periodIndex));
  if (!item) return { ok: false, error: 'دوره استهلاک در جدول یافت نشد.' };
  if (item.status === 'amortized') return { ok: false, error: 'این قسط قبلاً مستهلک شده است.' };
  assertOpenPeriod(acc, normalizeDate(item.targetDate, 'prepaid_amortization_date_invalid', 'تاریخ دوره استهلاک معتبر نیست.'), 'prepaid_amortization');

  item.status = 'amortized';
  item.amortizedAt = new Date().toISOString();
  prepaid.amortizedAmount = toInt(prepaid.amortizedAmount) + toInt(item.amount);
  prepaid.remainingAmount = Math.max(0, toInt(prepaid.amount) - prepaid.amortizedAmount);
  if (prepaid.remainingAmount === 0) prepaid.status = 'fully_amortized';

  return {
    ok: true,
    item,
    prepaid,
    journalLines: [
      { accountCode: prepaid.expenseAccountCode, debit: item.amount, credit: 0, memo: `استهلاک دوره ${item.periodIndex} ${prepaid.description}`, branchId: prepaid.branchId || undefined },
      { accountCode: prepaid.assetAccountCode, debit: 0, credit: item.amount, memo: `کاهش حساب پیش‌پرداخت ${prepaid.number}`, branchId: prepaid.branchId || undefined },
    ],
  };
}

function addMonthsClamped(date, offset) {
  const source = new Date(date);
  const day = source.getUTCDate();
  const target = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + offset, 1, 12, 0, 0, 0));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12, 0, 0, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

function recordAccrualPayment(acc, accrualId, input = {}, opts = {}) {
  ensureAccruals(acc);
  input = input || {};
  const accrual = acc.accruals.find((item) => item.id === accrualId);
  if (!accrual) return { ok: false, error: 'تعهد یافت نشد.' };
  const key = input.idempotencyKey == null ? null : String(input.idempotencyKey).trim();
  if (key) {
    const existing = acc.accrualPayments.find((item) => item.idempotencyKey === key);
    if (existing) {
      if (existing.requestFingerprint !== JSON.stringify({ accrualId, amount: toInt(input.amount), paymentMethod: String(input.paymentMethod || 'bank').trim().toLowerCase(), date: input.date || null })) {
        return { ok: false, error: 'کلید idempotency پرداخت تعهد با بدنه متفاوت استفاده شده است.' };
      }
      return { ok: true, payment: existing, accrual, idempotentReplay: true };
    }
  }
  if (!ACTIVE_ACCRUAL_STATUSES.has(accrual.status)) return { ok: false, error: 'تعهد در وضعیت قابل پرداخت نیست.' };
  const amount = safeAmount(input.amount, 'accrual_payment_amount_invalid', 'مبلغ پرداخت تعهد معتبر نیست.');
  const pending = acc.accrualPayments.filter((item) => item.accrualId === accrual.id && item.status === 'pending_approval').reduce((sum, item) => sum + toInt(item.amount), 0);
  const paid = toInt(accrual.paidAmount);
  if (amount > toInt(accrual.amount) - paid - pending) return { ok: false, error: 'مبلغ پرداخت از مانده تعهد بیشتر است.' };
  const paymentDate = normalizeDate(input.date || new Date().toISOString(), 'accrual_payment_date_invalid', 'تاریخ پرداخت تعهد معتبر نیست.');
  const accrualStart = normalizeDate(accrual.startDate, 'accrual_start_date_invalid', 'تاریخ شروع تعهد معتبر نیست.');
  if (paymentDate < accrualStart) throw financeError('accrual_payment_date_invalid', 'تاریخ پرداخت تعهد نمی‌تواند قبل از تاریخ شروع تعهد باشد.');
  assertOpenPeriod(acc, paymentDate, 'accrual_payment');
  const method = String(input.paymentMethod || 'bank').trim().toLowerCase();
  if (!['bank', 'cash', 'petty_cash'].includes(method)) return { ok: false, error: 'روش پرداخت تعهد معتبر نیست.' };
  const requestFingerprint = JSON.stringify({ accrualId, amount: toInt(input.amount), paymentMethod: method, date: input.date || null });
  const payment = {
    id: `accr-pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    accrualId: accrual.id, branchId: accrual.branchId || null, amount, paymentMethod: method,
    date: paymentDate.toISOString(), status: 'posted',
    createdById: resolveActor(input.createdById), idempotencyKey: key, requestFingerprint, journalEntryId: null,
  };
  if (opts.postJournalFn && payment.status === 'posted') {
    const journalEntry = opts.postJournalFn({
      source: 'accrual_payment', sourceId: payment.id, date: payment.date,
      description: `پرداخت تعهد ${accrual.number || accrual.id}`,
      lines: [
        { accountCode: accrual.payableAccountCode || '2700', debit: amount, credit: 0, branchId: accrual.branchId || undefined },
        { accountCode: opts.bankAccountCode || (method === 'cash' ? '1110' : method === 'petty_cash' ? '1130' : '1210'), debit: 0, credit: amount, branchId: accrual.branchId || undefined },
      ],
    });
    payment.journalEntryId = journalEntry?.id || null;
  }
  acc.accrualPayments.push(payment);
  if (payment.status === 'posted') {
    accrual.paidAmount = paid + amount;
    accrual.status = accrual.paidAmount >= toInt(accrual.amount) ? 'paid' : 'partially_paid';
  }
  return { ok: true, payment, accrual, idempotentReplay: false };
}

function reverseAccrualPayment(acc, paymentId, opts = {}) {
  ensureAccruals(acc);
  const payment = acc.accrualPayments.find((item) => item.id === paymentId);
  if (!payment) return { ok: false, error: 'پرداخت تعهد یافت نشد.' };
  if (payment.status === 'reversed') return { ok: false, error: 'این پرداخت قبلاً معکوس شده است.' };
  if (payment.status !== 'posted') return { ok: false, error: 'فقط پرداخت ثبت‌شده قابل معکوس‌سازی است.' };
  const accrual = acc.accruals.find((item) => item.id === payment.accrualId);
  if (!accrual) return { ok: false, error: 'تعهد مرتبط با پرداخت یافت نشد.' };
  const paymentAmount = safeAmount(payment.amount, 'accrual_payment_amount_invalid', 'مبلغ پرداخت تعهد معتبر نیست.');
  if (toInt(accrual.paidAmount) < paymentAmount) return { ok: false, error: 'مبلغ پرداخت برای معکوس‌سازی در مانده تعهد ثبت نشده است.' };
  const date = normalizeDate(opts.date || new Date().toISOString(), 'accrual_payment_reversal_date_invalid', 'تاریخ معکوس‌سازی پرداخت معتبر نیست.');
  const paymentDate = normalizeDate(payment.date, 'accrual_payment_date_invalid', 'تاریخ پرداخت تعهد معتبر نیست.');
  if (date < paymentDate) throw financeError('accrual_payment_reversal_date_invalid', 'تاریخ معکوس‌سازی پرداخت نمی‌تواند قبل از تاریخ پرداخت باشد.');
  assertOpenPeriod(acc, date, 'accrual_payment_reversal');
  if (opts.postJournalFn) {
    const journalEntry = opts.postJournalFn({
      source: 'accrual_payment_reversal', sourceId: payment.id, date: date.toISOString(),
      description: `معکوس پرداخت تعهد ${accrual.number || accrual.id}`,
      lines: [
        { accountCode: accrual.payableAccountCode || '2700', debit: 0, credit: paymentAmount, branchId: accrual.branchId || undefined },
        { accountCode: opts.bankAccountCode || (payment.paymentMethod === 'cash' ? '1110' : payment.paymentMethod === 'petty_cash' ? '1130' : '1210'), debit: paymentAmount, credit: 0, branchId: accrual.branchId || undefined },
      ],
    });
    payment.reversalJournalEntryId = journalEntry?.id || null;
  }
  payment.status = 'reversed'; payment.reversedAt = date.toISOString(); payment.reversedBy = resolveActor(opts.userId);
  accrual.paidAmount = Math.max(0, toInt(accrual.paidAmount) - paymentAmount);
  accrual.status = accrual.paidAmount ? 'partially_paid' : 'posted';
  return { ok: true, payment, accrual };
}

module.exports = {
  ensureAccruals,
  createAccrual,
  reverseAccrual,
  createPrepaidExpense,
  amortizePrepaidPeriod,
  recordAccrualPayment,
  reverseAccrualPayment,
};
