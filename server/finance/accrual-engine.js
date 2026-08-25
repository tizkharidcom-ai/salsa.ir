'use strict';
/**
 * WESTO Finance — Accrual & Prepaid Engine (ported from NEEM)
 * Handles expense/revenue recognition in proper periods and prepaid amortization schedules.
 */
const { toInt } = require('./money');

function ensureAccruals(acc) {
  if (!Array.isArray(acc.accruals)) acc.accruals = [];
  if (!Array.isArray(acc.prepaids)) acc.prepaids = [];
  return acc;
}

function createAccrual(acc, { type = 'expense', description, amount, periodName, startDate, endDate, reversalDate, expenseAccountCode = '6990', payableAccountCode = '2700', recurringKey, createdById }) {
  ensureAccruals(acc);
  const id = `accr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const number = `ACCR-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;
  const item = {
    id,
    number,
    type,
    description: String(description || 'ثبت هزینه تعهدی').slice(0, 200),
    amount: toInt(amount),
    periodName: String(periodName || '').slice(0, 50),
    startDate: startDate || new Date().toISOString(),
    endDate: endDate || new Date().toISOString(),
    reversalDate: reversalDate || null,
    status: 'posted',
    expenseAccountCode,
    payableAccountCode,
    recurringKey: recurringKey || null,
    createdAt: new Date().toISOString(),
    createdById: createdById || 'admin',
  };
  acc.accruals.push(item);
  return { ok: true, accrual: item };
}

function reverseAccrual(acc, accrualId, userId) {
  ensureAccruals(acc);
  const accrual = acc.accruals.find(a => a.id === accrualId);
  if (!accrual) return { ok: false, error: 'تعهدیابی یافت نشد.' };
  if (accrual.status === 'reversed') return { ok: false, error: 'این تعهد قبلاً معکوس شده است.' };
  accrual.status = 'reversed';
  accrual.reversedAt = new Date().toISOString();
  accrual.reversedBy = userId || 'admin';
  return { ok: true, accrual };
}

function createPrepaidExpense(acc, { description, amount, startDate, endDate, assetAccountCode = '1700', expenseAccountCode = '6200', totalPeriods = 12, createdById }) {
  ensureAccruals(acc);
  const id = `prep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const number = `PREP-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;
  const totalAmt = toInt(amount);
  const periods = Math.max(1, Number(totalPeriods) || 12);
  const monthlyAmt = Math.round(totalAmt / periods);
  
  // Build amortization schedule
  const schedule = [];
  const start = new Date(startDate || Date.now());
  for (let i = 0; i < periods; i++) {
    const periodDate = new Date(start);
    periodDate.setMonth(periodDate.getMonth() + i);
    const amt = (i === periods - 1) ? (totalAmt - monthlyAmt * (periods - 1)) : monthlyAmt;
    schedule.push({
      periodIndex: i + 1,
      targetDate: periodDate.toISOString().slice(0, 10),
      amount: amt,
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
    startDate: startDate || new Date().toISOString(),
    endDate: endDate || new Date().toISOString(),
    assetAccountCode,
    expenseAccountCode,
    totalPeriods: periods,
    schedule,
    status: 'active',
    createdAt: new Date().toISOString(),
    createdById: createdById || 'admin',
  };
  acc.prepaids.push(prepaid);
  return { ok: true, prepaid };
}

function amortizePrepaidPeriod(acc, prepaidId, periodIndex) {
  ensureAccruals(acc);
  const prepaid = acc.prepaids.find(p => p.id === prepaidId);
  if (!prepaid) return { ok: false, error: 'پیش‌پرداخت یافت نشد.' };
  const item = prepaid.schedule.find(s => s.periodIndex === Number(periodIndex));
  if (!item) return { ok: false, error: 'دوره استهلاک در جدول یافت نشد.' };
  if (item.status === 'amortized') return { ok: false, error: 'این قسط قبلاً مستهلک شده است.' };

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
      { accountCode: prepaid.expenseAccountCode, debit: item.amount, credit: 0, memo: `استهلاک دوره ${item.periodIndex} ${prepaid.description}` },
      { accountCode: prepaid.assetAccountCode, debit: 0, credit: item.amount, memo: `کاهش حساب پیش‌پرداخت ${prepaid.number}` },
    ],
  };
}

module.exports = {
  ensureAccruals,
  createAccrual,
  reverseAccrual,
  createPrepaidExpense,
  amortizePrepaidPeriod,
};
