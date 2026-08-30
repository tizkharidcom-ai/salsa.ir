'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const accrual = require('../server/finance/accrual-engine');
const assets = require('../server/finance/asset-engine');
const payroll = require('../server/finance/payroll-engine');

function periods() {
  return [
    { id: 'period-aug', name: 'مرداد ۱۴۰۵', startDate: '2026-08-01T00:00:00.000Z', endDate: '2026-08-31T23:59:59.999Z', status: 'open' },
    { id: 'period-sep', name: 'شهریور ۱۴۰۵', startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-30T23:59:59.999Z', status: 'open' },
  ];
}

function journalRecorder() {
  const entries = [];
  const post = (...args) => {
    const input = args.length > 1 ? args[1] : args[0];
    const debit = (input.lines || []).reduce((sum, line) => sum + Number(line.debit || line.debitIrr || 0), 0);
    const credit = (input.lines || []).reduce((sum, line) => sum + Number(line.credit || line.creditIrr || 0), 0);
    assert.equal(debit, credit, `نامترازی سند ${input.source || ''}`);
    const entry = { ...input, id: `je-${entries.length + 1}`, number: `JE-${entries.length + 1}` };
    entries.push(entry);
    return entry;
  };
  return { entries, post };
}

function accrualFixture() {
  return {
    branches: [{ id: 1, active: true }, { id: 2, active: true }],
    fiscalPeriods: periods(),
    accruals: [],
    prepaids: [],
    accrualPayments: [],
  };
}

function assetFixture() {
  return {
    branches: [{ id: 1, active: true }, { id: 2, active: true }],
    fiscalPeriods: periods(),
    fixedAssets: [],
    assetDisposals: [],
    assetTransfers: [],
    depreciationRuns: [],
  };
}

function payrollFixture() {
  return {
    branches: [{ id: 1, active: true }, { id: 2, active: true }],
    fiscalPeriods: periods(),
    employees: [
      { id: 'emp-1', name: 'کارمند سالن', branchId: '1', department: 'service', baseSalary: 1000000, active: true },
      { id: 'emp-2', name: 'کارمند شعبه دوم', branchId: 2, department: 'kitchen', baseSalary: 1000000, active: true },
    ],
    payrollRuns: [],
  };
}

test('accruals enforce monthly uniqueness, period/date controls, idempotency and controlled reversal', () => {
  const db = accrualFixture();
  const input = {
    type: 'expense', description: 'اجاره مرداد', amount: 1000000, periodName: 'مرداد ۱۴۰۵',
    startDate: '2026-08-01', endDate: '2026-08-31', branchId: 1, serviceMonth: '2026-08',
    recurringKey: 'rent:branch-1', idempotencyKey: 'accrual-request-1', createdById: 'accountant-1',
  };
  const first = accrual.createAccrual(db, input);
  const replay = accrual.createAccrual(db, { ...input });
  assert.equal(first.idempotentReplay, undefined);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.accrual.id, first.accrual.id);
  assert.equal(db.accruals.length, 1);
  assert.equal(first.accrual.fiscalPeriodId, 'period-aug');
  assert.throws(() => accrual.createAccrual(db, { ...input, idempotencyKey: 'accrual-request-2' }), (error) => error.code === 'accrual_period_duplicate');
  assert.throws(() => accrual.createAccrual(db, { ...input, amount: 2000000 }), (error) => error.code === 'accrual_idempotency_conflict');
  assert.throws(() => accrual.createAccrual(db, { ...input, idempotencyKey: 'bad-date', startDate: '2026-08-32' }), (error) => error.code === 'accrual_start_date_invalid');
  assert.throws(() => accrual.createAccrual(db, { ...input, idempotencyKey: 'closed-period', startDate: '2026-10-01', endDate: '2026-10-31', serviceMonth: '2026-10' }), (error) => error.code === 'accrual_period_missing');
  const reversed = accrual.reverseAccrual(db, first.accrual.id, 'owner-1', { date: '2026-08-31', reason: 'اصلاح ثبت' });
  assert.equal(reversed.ok, true);
  assert.equal(first.accrual.status, 'reversed');
  assert.equal(accrual.reverseAccrual(db, first.accrual.id, 'owner-1').ok, false);
});

test('prepaid schedules are calendar-safe, sum exactly and cannot amortize twice', () => {
  const db = { fiscalPeriods: [{ id: 'period-q1', name: 'سه‌ماهه اول', startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-04-30T23:59:59.999Z', status: 'open' }], accruals: [], prepaids: [], accrualPayments: [] };
  const result = accrual.createPrepaidExpense(db, {
    description: 'بیمه سالانه', amount: 100, startDate: '2026-01-31', endDate: '2026-04-30',
    totalPeriods: 3, branchId: 1, idempotencyKey: 'prepaid-1',
  });
  assert.deepEqual(result.prepaid.schedule.map((item) => item.targetDate), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.equal(result.prepaid.schedule.reduce((sum, item) => sum + item.amount, 0), 100);
  assert.deepEqual(result.prepaid.schedule.map((item) => item.amount), [34, 33, 33]);
  assert.equal(accrual.createPrepaidExpense(db, {
    description: 'بیمه سالانه', amount: 100, startDate: '2026-01-31', endDate: '2026-04-30', totalPeriods: 3, branchId: 1, idempotencyKey: 'prepaid-1',
  }).idempotentReplay, true);
  assert.throws(() => accrual.createPrepaidExpense(db, { amount: 10, startDate: '2026-01-01', endDate: '2026-02-01', totalPeriods: 1.5 }), (error) => error.code === 'prepaid_periods_invalid');
  const first = accrual.amortizePrepaidPeriod(db, result.prepaid.id, 1);
  assert.equal(first.ok, true);
  assert.equal(accrual.amortizePrepaidPeriod(db, result.prepaid.id, 1).ok, false);
  accrual.amortizePrepaidPeriod(db, result.prepaid.id, 2);
  const last = accrual.amortizePrepaidPeriod(db, result.prepaid.id, 3);
  assert.equal(last.prepaid.status, 'fully_amortized');
  assert.equal(last.prepaid.remainingAmount, 0);
  assert.equal(first.journalLines[0].debit, 34);
});

test('accrual payment and reversal preserve liability balance and idempotency', () => {
  const db = accrualFixture();
  const created = accrual.createAccrual(db, {
    description: 'قبض آب', amount: 1000, startDate: '2026-08-01', endDate: '2026-08-31',
    branchId: 1, recurringKey: 'water:1', serviceMonth: '2026-08', idempotencyKey: 'water-accrual',
  });
  const recorder = journalRecorder();
  const payment = accrual.recordAccrualPayment(db, created.accrual.id, {
    amount: 400, paymentMethod: 'bank', date: '2026-08-20', idempotencyKey: 'water-payment', createdById: 'accountant-1',
  }, { postJournalFn: recorder.post });
  assert.equal(payment.accrual.status, 'partially_paid');
  assert.equal(payment.accrual.paidAmount, 400);
  assert.equal(accrual.recordAccrualPayment(db, created.accrual.id, {
    amount: 400, paymentMethod: 'bank', date: '2026-08-20', idempotencyKey: 'water-payment', createdById: 'accountant-1',
  }, { postJournalFn: recorder.post }).idempotentReplay, true);
  assert.equal(recorder.entries.length, 1);
  assert.equal(accrual.reverseAccrual(db, created.accrual.id, 'owner-1', { date: '2026-08-21' }).ok, false);
  const reversed = accrual.reverseAccrualPayment(db, payment.payment.id, { date: '2026-08-21', userId: 'owner-1', postJournalFn: recorder.post });
  assert.equal(reversed.ok, true);
  assert.equal(reversed.accrual.paidAmount, 0);
  assert.equal(reversed.accrual.status, 'posted');
  assert.equal(accrual.reverseAccrualPayment(db, payment.payment.id).ok, false);
  assert.equal(recorder.entries.length, 2);
});

test('fixed assets validate branch/cost/date identity and keep disposal/transfer controls', () => {
  const db = assetFixture();
  const asset = assets.createAsset(db, {
    id: 'asset-1', assetCode: 'ast-001', name: 'اسپرسوساز', branchId: 1,
    purchaseDate: '2026-08-01', inServiceDate: '2026-08-01', purchaseCost: 1200, salvageValue: 100, usefulLifeMonths: 12, accountCode: '1820', idempotencyKey: 'asset-create-1',
  });
  assert.equal(asset.assetCode, 'AST-001');
  assert.equal(assets.createAsset(db, {
    id: 'asset-1', assetCode: 'ast-001', name: 'اسپرسوساز', branchId: 1,
    purchaseDate: '2026-08-01', inServiceDate: '2026-08-01', purchaseCost: 1200, salvageValue: 100, usefulLifeMonths: 12, accountCode: '1820', idempotencyKey: 'asset-create-1',
  }).id, asset.id);
  assert.throws(() => assets.createAsset(db, { assetCode: 'AST-001', name: 'دستگاه دوم', branchId: 1, purchaseDate: '2026-08-02', purchaseCost: 1000, usefulLifeMonths: 12 }), (error) => error.code === 'asset_code_duplicate');
  const otherBranch = assets.createAsset(db, { assetCode: 'AST-001', name: 'دستگاه دوم', branchId: 2, purchaseDate: '2026-08-02', purchaseCost: 1000, usefulLifeMonths: 12 });
  assert.equal(otherBranch.branchId, 2);
  assert.throws(() => assets.createAsset(db, { name: 'دارایی بد', branchId: 1, purchaseDate: '2026-08-02', purchaseCost: -1, usefulLifeMonths: 12 }), (error) => error.code === 'asset_cost_invalid');
  assert.throws(() => assets.createAsset(db, { name: 'دارایی بد', branchId: 9, purchaseDate: '2026-08-02', purchaseCost: 1000, usefulLifeMonths: 12 }), (error) => error.code === 'asset_branch_not_found');
  assert.deepEqual(assets.getAssetRegister(db, '1').map((item) => item.id), ['asset-1']);
  assert.equal(assets.getAssetRegister(db, 1)[0].bookValue, 1200);
  const disposal = assets.disposeAsset(db, asset.id, { salePrice: 0, date: '2026-08-25', reason: 'اسقاط' });
  assert.equal(disposal.ok, true);
  assert.equal(disposal.journalLines.find((line) => line.credit === 1200).accountCode, '1820');
  assert.equal(disposal.journalLines.reduce((sum, line) => sum + line.debit, 0), disposal.journalLines.reduce((sum, line) => sum + line.credit, 0));
  assert.equal(assets.disposeAsset(db, asset.id, { salePrice: 0, date: '2026-08-26' }).ok, false);
  assert.equal(assets.transferAsset(db, otherBranch.id, { toBranchId: 2, date: '2026-08-25' }).ok, false);
  assert.equal(assets.transferAsset(db, otherBranch.id, { toBranchId: 1, date: '2026-08-25' }).ok, true);
  assert.equal(otherBranch.branchId, 1);
});

test('depreciation is unique per asset/month, branch/date scoped and atomic on journal failure', () => {
  const db = assetFixture();
  const firstAsset = assets.createAsset(db, { id: 'asset-1', assetCode: 'AST-001', name: 'اسپرسوساز', branchId: 1, purchaseDate: '2026-08-01', purchaseCost: 1200, usefulLifeMonths: 12 });
  const futureAsset = assets.createAsset(db, { id: 'asset-2', assetCode: 'AST-002', name: 'فر پخت', branchId: 2, purchaseDate: '2026-09-01', inServiceDate: '2026-09-01', purchaseCost: 2400, usefulLifeMonths: 12 });
  const recorder = journalRecorder();
  const first = assets.runDepreciation(db, recorder.post, {}, { postingDate: '2026-08-31', branchId: 1, idempotencyKey: 'depr-aug-1' });
  assert.equal(first.totalDepreciation, 100);
  assert.deepEqual(first.processedAssets.map((item) => item.id), ['asset-1']);
  assert.equal(firstAsset.accumulatedDepreciation, 100);
  const replay = assets.runDepreciation(db, recorder.post, {}, { postingDate: '2026-08-31', branchId: 1, idempotencyKey: 'depr-aug-1' });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.run.id, first.run.id);
  assert.equal(assets.runDepreciation(db, recorder.post, {}, { postingDate: '2026-08-31' }).processedAssets.length, 0);
  const september = assets.runDepreciation(db, recorder.post, {}, { postingDate: '2026-09-30', branchId: 2 });
  assert.equal(september.processedAssets[0].id, futureAsset.id);
  assert.equal(september.totalDepreciation, 200);
  const septemberBranchOne = assets.runDepreciation(db, recorder.post, {}, { postingDate: '2026-09-30', branchId: 1 });
  assert.equal(septemberBranchOne.processedAssets[0].id, firstAsset.id);
  assert.equal(septemberBranchOne.run.lines[0].branchId, 1);
  assert.equal(assets.reverseDepreciationRun(db, first.run.id, { date: '2026-09-30' }).ok, false);
  assert.equal(recorder.entries.every((entry) => entry.lines.reduce((sum, line) => sum + line.debit, 0) === entry.lines.reduce((sum, line) => sum + line.credit, 0)), true);
  const septemberReversal = assets.reverseDepreciationRun(db, septemberBranchOne.run.id, { date: '2026-09-30', userId: 'owner-1', postJournalFn: recorder.post });
  assert.equal(septemberReversal.ok, true);
  assert.equal(septemberReversal.reversalJournal.lines.every((line) => line.branchId === 1), true);
  const reversed = assets.reverseDepreciationRun(db, first.run.id, { date: '2026-09-30', userId: 'owner-1', postJournalFn: recorder.post });
  assert.equal(reversed.ok, true);
  assert.equal(firstAsset.accumulatedDepreciation, 0);
  const rerun = assets.runDepreciation(db, recorder.post, {}, { postingDate: '2026-08-31', branchId: 1 });
  assert.equal(rerun.processedAssets.length, 1);

  const atomic = assetFixture();
  const atomicAsset = assets.createAsset(atomic, { id: 'atomic-asset', assetCode: 'AST-003', name: 'یخچال', branchId: 1, purchaseDate: '2026-08-01', purchaseCost: 1200, usefulLifeMonths: 12 });
  assert.throws(() => assets.runDepreciation(atomic, () => { throw new Error('journal unavailable'); }, {}, { postingDate: '2026-08-31', branchId: 1 }), /journal unavailable/);
  assert.equal(atomicAsset.accumulatedDepreciation, 0);
  assert.equal(atomic.depreciationRuns.length, 0);
});

test('payroll enforces accounting equation, branch/month uniqueness, periods and idempotent partial disbursement', () => {
  const db = payrollFixture();
  const recorder = journalRecorder();
  const input = {
    branchId: '1', periodName: 'مرداد ۱۴۰۵', serviceMonth: '2026-08', date: '2026-08-31',
    employees: [{ id: 'emp-1', deductions: 100000 }], idempotencyKey: 'payroll-aug-1', createdById: 'accountant-1',
  };
  const created = payroll.createPayrollRun(db, input, { postJournalFn: recorder.post });
  const run = created.payrollRun;
  assert.equal(run.totalDeductions, 100000);
  assert.equal(created.journalEntry.lines.find((line) => line.accountCode === '2700').credit, 100000);
  assert.equal(created.journalEntry.lines.reduce((sum, line) => sum + line.debit, 0), created.journalEntry.lines.reduce((sum, line) => sum + line.credit, 0));
  assert.equal(payroll.createPayrollRun(db, { ...input }, { postJournalFn: recorder.post }).idempotentReplay, true);
  assert.throws(() => payroll.createPayrollRun(db, { ...input, idempotencyKey: 'payroll-aug-2' }, { postJournalFn: recorder.post }), (error) => error.code === 'payroll_branch_period_duplicate');
  assert.throws(() => payroll.createPayrollRun(db, { ...input, idempotencyKey: 'payroll-bad-month', serviceMonth: '2026-09' }, { postJournalFn: recorder.post }), (error) => error.code === 'payroll_service_month_mismatch');
  const branchMismatchDb = payrollFixture();
  assert.throws(() => payroll.createPayrollRun(branchMismatchDb, { ...input, idempotencyKey: 'payroll-other-branch', employees: [{ id: 'emp-2' }] }, { postJournalFn: recorder.post }), (error) => error.code === 'payroll_employee_branch_mismatch');
  assert.throws(() => payroll.calculateEmployeePayslip(db.employees[0], { deductions: -1 }), (error) => error.code === 'payroll_deductions_invalid');

  const half = Math.floor(run.totalNetPay / 2);
  const firstPayment = payroll.disbursePayroll(db, run.id, { amount: half, date: '2026-08-31', idempotencyKey: 'salary-payment-1', createdById: 'cashier-1' }, { postJournalFn: recorder.post });
  assert.equal(firstPayment.payrollRun.status, 'partially_disbursed');
  assert.equal(firstPayment.payrollRun.paidAmount, half);
  assert.equal(payroll.disbursePayroll(db, run.id, { amount: half, date: '2026-08-31', idempotencyKey: 'salary-payment-1', createdById: 'cashier-1' }, { postJournalFn: recorder.post }).idempotentReplay, true);
  assert.throws(() => payroll.disbursePayroll(db, run.id, { amount: run.totalNetPay - half + 1, date: '2026-08-31' }, { postJournalFn: recorder.post }), (error) => error.code === 'payroll_disbursement_exceeds_remaining');
  const finalPayment = payroll.disbursePayroll(db, run.id, { amount: run.totalNetPay - half, date: '2026-08-31', idempotencyKey: 'salary-payment-2', createdById: 'owner-1' }, { postJournalFn: recorder.post });
  assert.equal(finalPayment.payrollRun.status, 'disbursed');
  assert.equal(finalPayment.payrollRun.paidAmount, run.totalNetPay);
  const reversed = payroll.reversePayrollDisbursement(db, run.id, firstPayment.disbursement.id, { date: '2026-09-01', userId: 'owner-1', postJournalFn: recorder.post });
  assert.equal(reversed.ok, true);
  assert.equal(reversed.payrollRun.paidAmount, run.totalNetPay - half);
  assert.equal(reversed.payrollRun.status, 'partially_disbursed');
  assert.equal(payroll.reversePayrollDisbursement(db, run.id, firstPayment.disbursement.id).ok, false);

  const fullPaymentDb = payrollFixture();
  const fullRun = payroll.createPayrollRun(fullPaymentDb, { branchId: 1, date: '2026-08-31', employees: [{ id: 'emp-1' }] }).payrollRun;
  const fullPayment = payroll.disbursePayroll(fullPaymentDb, fullRun.id, { date: '2026-08-31', idempotencyKey: 'salary-payment-full' });
  const fullReplay = payroll.disbursePayroll(fullPaymentDb, fullRun.id, { date: '2026-08-31', idempotencyKey: 'salary-payment-full' });
  assert.equal(fullPayment.payrollRun.status, 'disbursed');
  assert.equal(fullReplay.idempotentReplay, true);
  assert.equal(fullPaymentDb.payrollRuns[0].disbursements.length, 1);
});

test('payroll refuses closed fiscal periods and invalid high-level amounts', () => {
  const db = payrollFixture();
  db.fiscalPeriods[0].status = 'closed';
  assert.throws(() => payroll.createPayrollRun(db, {
    branchId: 1, periodName: 'مرداد', date: '2026-08-20', employees: [{ id: 'emp-1' }],
  }), (error) => error.code === 'payroll_period_closed');
  assert.throws(() => payroll.calculateEmployeePayslip(db.employees[0], { baseSalary: -1 }), (error) => error.code === 'payroll_base_salary_invalid');
  assert.equal(payroll.calculateProgressiveTax(0), 0);
  assert.ok(payroll.calculateProgressiveTax(198000000) > payroll.calculateProgressiveTax(144000000));
});

test('direct engines treat date-only period ends as full calendar days and reject invalid temporal order', () => {
  const dateOnlyPeriods = [{ id: 'period-date-only', name: 'مرداد', startDate: '2026-08-01', endDate: '2026-08-31', status: 'open' }];
  const accrualDb = { branches: [{ id: 1, active: true }], fiscalPeriods: dateOnlyPeriods, accruals: [], prepaids: [], accrualPayments: [] };
  const createdAccrual = accrual.createAccrual(accrualDb, {
    amount: 1000, startDate: '2026-08-31T12:00:00.000Z', endDate: '2026-08-31T12:00:00.000Z', branchId: 1,
  });
  assert.equal(createdAccrual.accrual.fiscalPeriodId, 'period-date-only');
  assert.throws(() => accrual.reverseAccrual(accrualDb, createdAccrual.accrual.id, 'owner-1', { date: '2026-08-30' }), (error) => error.code === 'accrual_reversal_date_invalid');

  const assetDb = { branches: [{ id: 1, active: true }, { id: 2, active: true }], fiscalPeriods: dateOnlyPeriods, fixedAssets: [], assetDisposals: [], assetTransfers: [], depreciationRuns: [] };
  const asset = assets.createAsset(assetDb, { name: 'دستگاه تست', branchId: 1, purchaseDate: '2026-08-31T12:00:00.000Z', purchaseCost: 1200 });
  assert.equal(asset.status, 'active');
  assert.throws(() => assets.disposeAsset(assetDb, asset.id, { salePrice: 0, date: '2026-08-30' }), (error) => error.code === 'asset_disposal_date_invalid');
  assert.throws(() => assets.transferAsset(assetDb, asset.id, { toBranchId: 2, date: '2026-08-30' }), (error) => error.code === 'asset_transfer_date_invalid');

  const payrollDb = { branches: [{ id: 1, active: true }], fiscalPeriods: dateOnlyPeriods, employees: [{ id: 'emp-1', branchId: 1, baseSalary: 1000000, active: true }], payrollRuns: [] };
  const run = payroll.createPayrollRun(payrollDb, { branchId: 1, date: '2026-08-31T12:00:00.000Z', employees: [{ id: 'emp-1' }] }).payrollRun;
  assert.equal(run.fiscalPeriodId, 'period-date-only');
  assert.throws(() => payroll.createPayrollRun({ ...payrollDb, payrollRuns: [] }, { branchId: 1, date: '2026-08-20', employees: [{ id: 'unregistered', branchId: 1, baseSalary: 1000000 }] }), (error) => error.code === 'payroll_employee_not_found');
  assert.throws(() => payroll.calculateProgressiveTax('not-a-number'), (error) => error.code === 'payroll_taxable_amount_invalid');
});

test('direct approval states are fail-closed and journal failures leave accrual/payroll state unchanged', () => {
  const pendingAccrualDb = accrualFixture();
  pendingAccrualDb.accruals.push({ id: 'pending-accrual', recurringKey: 'rent:1', branchId: 1, serviceMonth: '2026-08', status: 'pending_approval', amount: 1000, startDate: '2026-08-01T00:00:00.000Z' });
  assert.throws(() => accrual.createAccrual(pendingAccrualDb, { amount: 1000, startDate: '2026-08-01', endDate: '2026-08-31', branchId: 1, recurringKey: 'rent:1' }), (error) => error.code === 'accrual_period_duplicate');
  assert.equal(accrual.recordAccrualPayment(pendingAccrualDb, 'pending-accrual', { amount: 100 }).ok, false);
  assert.equal(accrual.reverseAccrual(pendingAccrualDb, 'pending-accrual', 'owner-1').ok, false);

  const accrualDb = accrualFixture();
  const createdAccrual = accrual.createAccrual(accrualDb, { amount: 1000, startDate: '2026-08-20', endDate: '2026-08-20', branchId: 1 });
  assert.throws(() => accrual.recordAccrualPayment(accrualDb, createdAccrual.accrual.id, { amount: 100, date: '2026-08-21' }, { postJournalFn: () => { throw new Error('journal unavailable'); } }), /journal unavailable/);
  assert.equal(accrualDb.accrualPayments.length, 0);
  assert.equal(createdAccrual.accrual.paidAmount, undefined);
  const payment = accrual.recordAccrualPayment(accrualDb, createdAccrual.accrual.id, { amount: 100, date: '2026-08-21' });
  assert.throws(() => accrual.reverseAccrualPayment(accrualDb, payment.payment.id, { date: '2026-08-22', postJournalFn: () => { throw new Error('journal unavailable'); } }), /journal unavailable/);
  assert.equal(payment.payment.status, 'posted');
  assert.equal(createdAccrual.accrual.paidAmount, 100);

  const pendingPayrollDb = payrollFixture();
  pendingPayrollDb.payrollRuns.push({ id: 'pending-payroll', branchId: 1, serviceMonth: '2026-08', status: 'pending_approval', totalNetPay: 1000, paidAmount: 0, disbursements: [] });
  assert.throws(() => payroll.createPayrollRun(pendingPayrollDb, { branchId: 1, date: '2026-08-20', employees: [{ id: 'emp-1' }] }), (error) => error.code === 'payroll_branch_period_duplicate');
  assert.throws(() => payroll.disbursePayroll(pendingPayrollDb, 'pending-payroll', { amount: 100, date: '2026-08-20' }), (error) => error.code === 'payroll_not_payable');

  const pendingAssetDb = assetFixture();
  const pendingAsset = assets.createAsset(pendingAssetDb, { name: 'دارایی در انتظار تأیید', branchId: 1, purchaseDate: '2026-08-01', purchaseCost: 1200 });
  pendingAsset.status = 'pending_approval';
  assert.equal(assets.disposeAsset(pendingAssetDb, pendingAsset.id, { salePrice: 0, date: '2026-08-20' }).ok, false);
  assert.equal(assets.transferAsset(pendingAssetDb, pendingAsset.id, { toBranchId: 2, date: '2026-08-20' }).ok, false);
  const pendingPrepaidDb = { fiscalPeriods: periods(), prepaids: [], accruals: [], accrualPayments: [] };
  const pendingPrepaid = accrual.createPrepaidExpense(pendingPrepaidDb, { amount: 100, startDate: '2026-08-01', endDate: '2026-08-31', totalPeriods: 1 }).prepaid;
  pendingPrepaid.status = 'pending_approval';
  assert.equal(accrual.amortizePrepaidPeriod(pendingPrepaidDb, pendingPrepaid.id, 1).ok, false);

  const payrollDb = payrollFixture();
  assert.throws(() => payroll.createPayrollRun(payrollDb, { branchId: 1, date: '2026-08-20', employees: [{ id: 'emp-1' }] }, { postJournalFn: () => { throw new Error('journal unavailable'); } }), /journal unavailable/);
  assert.equal(payrollDb.payrollRuns.length, 0);
  const payableRun = payroll.createPayrollRun(payrollDb, { branchId: 1, date: '2026-08-20', employees: [{ id: 'emp-1' }] }).payrollRun;
  assert.throws(() => payroll.disbursePayroll(payrollDb, payableRun.id, { amount: 100, date: '2026-08-21' }, { postJournalFn: () => { throw new Error('journal unavailable'); } }), /journal unavailable/);
  assert.equal(payableRun.paidAmount, 0);
  const disbursement = payroll.disbursePayroll(payrollDb, payableRun.id, { amount: 100, date: '2026-08-21' }).disbursement;
  assert.throws(() => payroll.reversePayrollDisbursement(payrollDb, payableRun.id, disbursement.id, { date: '2026-08-22', postJournalFn: () => { throw new Error('journal unavailable'); } }), /journal unavailable/);
  assert.equal(disbursement.status, 'posted');
  assert.equal(payableRun.paidAmount, 100);
});
