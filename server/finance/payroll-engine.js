'use strict';

/**
 * WESTO Finance — Iranian Payroll, Social Security & Progressive Tax Engine
 * Compliant with Iranian Labor Law, Social Security Act (Article 28), and Direct Taxes Law (Articles 84/92).
 * Implements:
 * 1. Progressive payroll tax brackets (effective-dated)
 * 2. Social Security 30% split (7% employee, 20% employer, 3% unemployment)
 * 3. Payroll run batch processing with balanced Double-Entry GL posting
 * 4. Net salary disbursement workflow from operating bank account
 */

const { toIRR, formatNumber } = require('./money');
const auditEngine = require('./audit-engine');

const ACTIVE_PAYROLL_RUN_STATUSES = new Set(['pending_approval', 'posted', 'partially_disbursed', 'disbursed']);

function disbursementFingerprint(input = {}) {
  return JSON.stringify({
    amount: input.amount == null || input.amount === '' ? null : toIRR(input.amount),
    date: input.date || null,
    bankAccountCode: input.bankAccountCode || '1210',
  });
}

function payrollError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  return error;
}

function parseDate(value, code, message) {
  const raw = String(value || '').trim();
  const date = new Date(raw);
  if (!raw || !Number.isFinite(date.getTime())) throw payrollError(code, message);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && date.toISOString().slice(0, 10) !== raw) throw payrollError(code, message);
  return date;
}

function periodBoundary(value, isEnd = false) {
  const raw = String(value || '').trim();
  if (isEnd && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T23:59:59.999Z`);
  return new Date(raw);
}

function parseServiceMonth(value, fallbackDate) {
  const serviceMonth = String(value || fallbackDate.toISOString().slice(0, 7)).trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(serviceMonth)) throw payrollError('payroll_service_month_invalid', 'ماه خدمت حقوق معتبر نیست.');
  return serviceMonth;
}

function safePayrollAmount(value, code = 'payroll_amount_invalid', { allowZero = true } = {}) {
  if (typeof value === 'number' && !Number.isFinite(value)) throw payrollError(code, 'مبلغ حقوق باید عدد معتبر باشد.');
  if (value !== null && value !== undefined && value !== '' && typeof value === 'string') {
    const normalized = value.replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/,/g, '').trim();
    if (!normalized || !Number.isFinite(Number(normalized)) || !Number.isInteger(Number(normalized))) throw payrollError(code, 'مبلغ حقوق باید عدد صحیح معتبر باشد.');
  }
  if (typeof value === 'number' && !Number.isInteger(value)) throw payrollError(code, 'مبلغ حقوق باید عدد صحیح باشد.');
  const amount = toIRR(value);
  if (!Number.isSafeInteger(amount) || (allowZero ? amount < 0 : amount <= 0)) throw payrollError(code, 'مبلغ حقوق باید عدد صحیح نامنفی و در محدوده امن باشد.');
  return amount;
}

function branchIdOf(value, code = 'payroll_branch_invalid') {
  const branchId = Number(value);
  if (!Number.isSafeInteger(branchId) || branchId <= 0) throw payrollError(code, 'شعبه حقوق معتبر نیست.');
  return branchId;
}

function assertBranchExists(acc, branchId) {
  if (Array.isArray(acc.branches) && acc.branches.length && !acc.branches.some((branch) => Number(branch.id) === branchId && branch.active !== false)) {
    throw payrollError('payroll_branch_not_found', 'شعبه حقوق یافت نشد یا غیرفعال است.');
  }
}

function assertOpenPeriod(acc, date) {
  if (!Array.isArray(acc.fiscalPeriods) || acc.fiscalPeriods.length === 0) return null;
  const period = acc.fiscalPeriods.find((candidate) => {
    const start = periodBoundary(candidate.startDate);
    const end = periodBoundary(candidate.endDate, true);
    return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && start <= date && end >= date;
  });
  if (!period) throw payrollError('payroll_period_missing', 'برای تاریخ حقوق دوره مالی معتبر یافت نشد.');
  if (period.status === 'closed') throw payrollError('payroll_period_closed', `دوره «${period.name || ''}» بسته شده است.`);
  return period;
}

function runServiceMonth(run) {
  if (run.serviceMonth) return String(run.serviceMonth);
  const candidate = run.date || run.postingDate || run.createdAt;
  if (!candidate) return null;
  const date = new Date(candidate);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 7) : null;
}

// Iranian Statutory Tax Brackets (Monthly IRR) for 1404-1405
const PAYROLL_TAX_BRACKETS = [
  { upTo: 144000000, rate: 0.00 },   // Up to 14.4M Tomans: Exempt
  { upTo: 198000000, rate: 0.10 },   // 14.4M to 19.8M: 10%
  { upTo: 324000000, rate: 0.15 },   // 19.8M to 32.4M: 15%
  { upTo: 480000000, rate: 0.20 },   // 32.4M to 48.0M: 20%
  { upTo: Infinity, rate: 0.30 },    // Above 48M: 30%
];

function ensurePayroll(acc) {
  if (!Array.isArray(acc.employees)) acc.employees = [];
  if (process.env.WESTO_ACCOUNTING_DEMO_SEED === 'true' && acc.employees.length === 0) {
    acc.employees = [
      { id: 'emp-1', nationalId: '0012345678', name: 'علیرضا حسینی', role: 'سرآشپز اجرایی', department: 'kitchen', baseSalary: 280000000, housingAllowance: 9000000, foodAllowance: 19000000, childAllowance: 0, branchId: 1, active: true },
      { id: 'emp-2', nationalId: '0023456789', name: 'مریم کمالی', role: 'مدیر سالن و صندوق', department: 'service', baseSalary: 210000000, housingAllowance: 9000000, foodAllowance: 19000000, childAllowance: 7166184, branchId: 1, active: true },
      { id: 'emp-3', nationalId: '0034567890', name: 'رضا میرزایی', role: 'باریستا و بارتندر', department: 'kitchen', baseSalary: 160000000, housingAllowance: 9000000, foodAllowance: 19000000, childAllowance: 0, branchId: 1, active: true },
    ];
  }
  if (!Array.isArray(acc.payrollRuns)) acc.payrollRuns = [];
  return acc;
}

/**
 * Calculates progressive payroll income tax based on Iranian tax brackets.
 */
function calculateProgressiveTax(taxableMonthlyIrr) {
  const taxable = safePayrollAmount(taxableMonthlyIrr, 'payroll_taxable_amount_invalid');
  if (taxable <= 0) return 0;
  let remaining = taxable;
  let totalTax = 0;
  let prevThreshold = 0;

  for (const bracket of PAYROLL_TAX_BRACKETS) {
    const bracketSize = bracket.upTo - prevThreshold;
    const taxableInBracket = Math.min(remaining, bracketSize);
    if (taxableInBracket > 0) {
      totalTax += Math.round(taxableInBracket * bracket.rate);
      remaining -= taxableInBracket;
    }
    prevThreshold = bracket.upTo;
    if (remaining <= 0) break;
  }

  return totalTax;
}

/**
 * Calculates single employee payroll slips.
 */
function calculateEmployeePayslip(emp, overrides = {}) {
  if (!emp || typeof emp !== 'object') throw payrollError('payroll_employee_invalid', 'اطلاعات کارمند معتبر نیست.');
  const baseSalary = safePayrollAmount(overrides.baseSalary !== undefined ? overrides.baseSalary : emp.baseSalary ?? 0, 'payroll_base_salary_invalid');
  const overtimePay = safePayrollAmount(overrides.overtimePay ?? 0, 'payroll_overtime_invalid');
  const bonuses = safePayrollAmount(overrides.bonuses ?? 0, 'payroll_bonus_invalid');
  const housingAllowance = safePayrollAmount(overrides.housingAllowance !== undefined ? overrides.housingAllowance : emp.housingAllowance ?? 0, 'payroll_housing_invalid');
  const foodAllowance = safePayrollAmount(overrides.foodAllowance !== undefined ? overrides.foodAllowance : emp.foodAllowance ?? 0, 'payroll_food_invalid');
  const childAllowance = safePayrollAmount(overrides.childAllowance !== undefined ? overrides.childAllowance : emp.childAllowance ?? 0, 'payroll_child_allowance_invalid');
  const deductions = safePayrollAmount(overrides.deductions ?? 0, 'payroll_deductions_invalid');

  const grossEarnings = baseSalary + overtimePay + bonuses + housingAllowance + foodAllowance + childAllowance;
  if (!Number.isSafeInteger(grossEarnings)) throw payrollError('payroll_gross_invalid', 'جمع دریافتی حقوق در محدوده امن نیست.');
  const STATUTORY_INSURANCE_CEILING_IRR = 1200000000; // 120M Tomans (7x base statutory minimum)
  const insurableEarnings = Math.min(grossEarnings, overrides.insuranceCeiling ?? STATUTORY_INSURANCE_CEILING_IRR);

  // Social Security Split (30% total):
  const employeeInsurance = Math.round(insurableEarnings * 0.07); // 7%
  const employerInsurance = Math.round(insurableEarnings * 0.23); // 20% employer + 3% unemployment

  // Taxable Earnings (Child allowance is legally tax exempt):
  const taxableEarnings = Math.max(0, grossEarnings - childAllowance);
  const payrollTax = calculateProgressiveTax(taxableEarnings);

  const netPay = grossEarnings - employeeInsurance - payrollTax - deductions;
  if (netPay <= 0) throw payrollError('payroll_net_pay_invalid', 'خالص حقوق باید بزرگ‌تر از صفر باشد.');

  return {
    employeeId: emp.id,
    employeeName: emp.name,
    nationalId: emp.nationalId,
    role: emp.role,
    department: emp.department || 'kitchen',
    branchId: emp.branchId == null || emp.branchId === '' ? 1 : branchIdOf(emp.branchId),
    baseSalary,
    overtimePay,
    bonuses,
    housingAllowance,
    foodAllowance,
    childAllowance,
    grossEarnings,
    insurableEarnings,
    employeeInsurance,
    employerInsurance,
    totalInsurance: employeeInsurance + employerInsurance,
    taxableEarnings,
    payrollTax,
    deductions,
    netPay,
  };
}

/**
 * Creates and processes a monthly Payroll Run with Balanced Double-Entry GL posting.
 */
function createPayrollRun(acc, runInput, opts = {}) {
  ensurePayroll(acc);
  const { postJournalFn } = opts;
  runInput = runInput || {};

  const periodName = runInput.periodName || `حقوق و دستمزد ماه جاری`;
  const branchId = runInput.branchId == null || runInput.branchId === '' ? 1 : branchIdOf(runInput.branchId);
  assertBranchExists(acc, branchId);
  const postingDate = parseDate(runInput.date || new Date().toISOString(), 'payroll_date_invalid', 'تاریخ ثبت حقوق معتبر نیست.');
  const serviceMonth = parseServiceMonth(runInput.serviceMonth, postingDate);
  if (serviceMonth !== postingDate.toISOString().slice(0, 7)) throw payrollError('payroll_service_month_mismatch', 'ماه خدمت حقوق با ماه تاریخ ثبت یکسان نیست.');
  const requestKey = runInput.idempotencyKey == null ? null : String(runInput.idempotencyKey).trim();
  const requestFingerprint = JSON.stringify({ branchId, serviceMonth, periodName, date: postingDate.toISOString().slice(0, 10), employees: runInput.employees || null });
  if (requestKey) {
    const existingByKey = acc.payrollRuns.find((run) => run.idempotencyKey === requestKey);
    if (existingByKey) {
      if (existingByKey.requestFingerprint !== requestFingerprint) throw payrollError('payroll_idempotency_conflict', 'کلید idempotency قبلاً با بدنه متفاوت استفاده شده است.');
      return { ok: true, payrollRun: existingByKey, journalEntry: null, idempotentReplay: true };
    }
  }
  const period = assertOpenPeriod(acc, postingDate);
  const existingRun = acc.payrollRuns.find((run) => Number(run.branchId) === branchId && runServiceMonth(run) === serviceMonth
    && ACTIVE_PAYROLL_RUN_STATUSES.has(run.status));
  if (existingRun) throw payrollError('payroll_branch_period_duplicate', 'برای این شعبه و ماه، لیست حقوق فعال قبلاً ثبت شده است.');
  const employeesList = (runInput.employees && runInput.employees.length > 0)
    ? runInput.employees
    : acc.employees.filter((e) => e.active !== false && Number(e.branchId) === branchId);

  if (employeesList.length === 0) throw new Error('هیچ پرسنل فعالی برای محاسبه حقوق یافت نشد.');
  const employeeIds = employeesList.map((employee) => employee.id || employee.employeeId || null);
  if (employeeIds.some((employeeId) => !employeeId) || new Set(employeeIds).size !== employeeIds.length) throw payrollError('payroll_employee_duplicate', 'کارمند خالی یا تکراری در لیست حقوق وجود دارد.');

  const slips = employeesList.map((emp) => {
    const fullEmp = acc.employees.find((e) => e.id === emp.id || e.id === emp.employeeId);
    if (!fullEmp || !fullEmp.id) throw payrollError('payroll_employee_not_found', 'کارمند انتخاب‌شده در فهرست پرسنل یافت نشد.');
    if (fullEmp.active === false || (fullEmp.branchId == null || Number(fullEmp.branchId) !== branchId)) throw payrollError('payroll_employee_branch_mismatch', 'کارمند انتخاب‌شده متعلق به شعبه لیست حقوق نیست.');
    return calculateEmployeePayslip(fullEmp, emp);
  });

  let totalKitchenGross = 0;
  let totalServiceGross = 0;
  let totalEmployerInsurance = 0;
  let totalEmployeeInsurance = 0;
  let totalPayrollTax = 0;
  let totalNetPay = 0;
  let totalDeductions = 0;

  slips.forEach((s) => {
    if (s.department === 'service') totalServiceGross += s.grossEarnings;
    else totalKitchenGross += s.grossEarnings;

    totalEmployerInsurance += s.employerInsurance;
    totalEmployeeInsurance += s.employeeInsurance;
    totalPayrollTax += s.payrollTax;
    totalNetPay += s.netPay;
    totalDeductions += s.deductions;
  });

  const totalGross = totalKitchenGross + totalServiceGross;
  const totalSocialSecurity = totalEmployeeInsurance + totalEmployerInsurance;

  const runId = `payrun-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const runNumber = `PAY-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;

  // Balanced Double Entry for Monthly Payroll Run:
  // DR 6110 (Kitchen Staff Wages) -> totalKitchenGross
  // DR 6120 (Service Staff Wages) -> totalServiceGross
  // DR 6140 (Social Security Employer Expense) -> totalEmployerInsurance
  // CR 2220 (Payroll Tax Withholding Payable) -> totalPayrollTax
  // CR 2230 (Social Security Insurance Payable - 30%) -> totalSocialSecurity
  // CR 2600 (Payroll & Salaries Payable) -> totalNetPay
  const journalLines = [
    ...(totalKitchenGross > 0 ? [{
      accountCode: '6110', // Kitchen Staff Wages
      debit: totalKitchenGross,
      credit: 0,
      memo: `هزینه حقوق و دستمزد پرسنل آشپزخانه و بار (${periodName})`,
      branchId,
    }] : []),
    ...(totalServiceGross > 0 ? [{
      accountCode: '6120', // Service Staff Wages
      debit: totalServiceGross,
      credit: 0,
      memo: `هزینه حقوق و دستمزد پرسنل سالن و صندوق (${periodName})`,
      branchId,
    }] : []),
    ...(totalEmployerInsurance > 0 ? [{
      accountCode: '6140', // Social Security & Insurance (Employer 23%)
      debit: totalEmployerInsurance,
      credit: 0,
      memo: `هزینه بیمه تأمین اجتماعی سهم کارفرما (۲۳٪)`,
      branchId,
    }] : []),
    ...(totalPayrollTax > 0 ? [{
      accountCode: '2220', // Payroll Tax Payable
      debit: 0,
      credit: totalPayrollTax,
      memo: `مالیات تکلیفی حقوق کسرشده از پرسنل`,
      branchId,
    }] : []),
    {
      accountCode: '2230', // Social Security Payable (30%)
      debit: 0,
      credit: totalSocialSecurity,
      memo: `حق بیمه تأمین اجتماعی پرداختنی (۷٪ سهم کارمند + ۲۳٪ سهم کارفرما)`,
      branchId,
    },
    {
      accountCode: '2600', // Payroll & Salaries Payable
      debit: 0,
      credit: totalNetPay,
      memo: `خالص حقوق پرداختنی پرسنل (${periodName})`,
      branchId,
    },
    ...(totalDeductions > 0 ? [{
      accountCode: '2700',
      debit: 0,
      credit: totalDeductions,
      memo: `سایر کسورات پرداختنی حقوق (${periodName})`,
      branchId,
    }] : []),
  ];

  const totalDebit = journalLines.reduce((sum, line) => sum + toIRR(line.debit), 0);
  const totalCredit = journalLines.reduce((sum, line) => sum + toIRR(line.credit), 0);
  if (totalDebit !== totalCredit) throw payrollError('payroll_journal_unbalanced', 'سند حقوق با معادله حسابداری تراز نیست.');

  let journalEntry = null;
  if (postJournalFn) {
    journalEntry = postJournalFn({
      source: 'payroll_run',
      sourceId: runId,
      date: postingDate.toISOString(),
      description: `ثبت لیست حقوق و دستمزد: ${periodName} (${slips.length} نفر)`,
      lines: journalLines,
      createdById: runInput.createdById || 'admin',
    });
  }

  const runRecord = {
    id: runId,
    number: runNumber,
    periodName,
    branchId,
    totalGross,
    totalEmployerInsurance,
    totalEmployeeInsurance,
    totalSocialSecurity,
    totalPayrollTax,
    totalDeductions,
    totalNetPay,
    paidAmount: 0,
    status: 'posted', // posted | disbursed
    slips,
    journalEntryId: journalEntry ? journalEntry.id : null,
    journalNumber: journalEntry ? journalEntry.number : null,
    createdAt: new Date().toISOString(),
    date: postingDate.toISOString(),
    serviceMonth,
    fiscalPeriodId: period?.id || null,
    idempotencyKey: requestKey,
    requestFingerprint: requestKey ? requestFingerprint : null,
    disbursements: [],
  };

  acc.payrollRuns.unshift(runRecord);

  auditEngine.recordAuditLog(acc, {
    action: 'CREATE_PAYROLL_RUN',
    entityType: 'PayrollRun',
    entityId: runRecord.id,
    userId: runInput.createdById || 'admin',
    message: `لیست حقوق و دستمزد «${periodName}» برای ${slips.length} نفر ثبت شد. خالص حقوق: ${formatNumber(totalNetPay)} ریال`,
  });

  return { ok: true, payrollRun: runRecord, journalEntry, idempotentReplay: false };
}

/**
 * Disburses net payroll from Operating Bank Account.
 */
function disbursePayroll(acc, runId, disburseInput, opts = {}) {
  ensurePayroll(acc);
  const { postJournalFn } = opts;
  disburseInput = disburseInput || {};

  const run = acc.payrollRuns.find((r) => r.id === runId);
  if (!run) throw new Error('لیست حقوق یافت نشد.');
  const requestKey = disburseInput.idempotencyKey == null ? null : String(disburseInput.idempotencyKey).trim();
  if (requestKey) {
    const existing = (run.disbursements || []).find((item) => item.idempotencyKey === requestKey);
    if (existing) {
      const fingerprint = disbursementFingerprint(disburseInput);
      if (existing.requestFingerprint !== fingerprint) throw payrollError('payroll_disbursement_idempotency_conflict', 'کلید idempotency پرداخت حقوق قبلاً با بدنه متفاوت استفاده شده است.');
      return { ok: true, payrollRun: run, journalEntry: null, disbursement: existing, idempotentReplay: true };
    }
  }
  if (!['posted', 'partially_disbursed'].includes(run.status)) throw payrollError('payroll_not_payable', 'این لیست حقوق در وضعیت قابل پرداخت نیست.');

  const previousPaid = safePayrollAmount(run.paidAmount || 0, 'payroll_paid_amount_invalid');
  const remaining = safePayrollAmount(run.totalNetPay, 'payroll_net_pay_invalid') - previousPaid;
  if (remaining < 0) throw payrollError('payroll_paid_amount_invalid', 'مبلغ پرداخت‌شده از خالص حقوق بیشتر است.');
  const requestFingerprint = disbursementFingerprint(disburseInput);
  const amountToDisburse = safePayrollAmount(disburseInput.amount == null || disburseInput.amount === '' ? remaining : disburseInput.amount, 'payroll_disbursement_amount_invalid', { allowZero: false });
  if (amountToDisburse > remaining) throw payrollError('payroll_disbursement_exceeds_remaining', 'مبلغ پرداخت از مانده خالص حقوق بیشتر است.');
  const bankAccountCode = disburseInput.bankAccountCode || '1210';
  if (!/^\d{3,10}$/.test(String(bankAccountCode))) throw payrollError('payroll_bank_account_invalid', 'حساب پرداخت حقوق معتبر نیست.');
  const payDate = parseDate(disburseInput.date || new Date().toISOString(), 'payroll_disbursement_date_invalid', 'تاریخ پرداخت حقوق معتبر نیست.');
  if (run.date && payDate < parseDate(run.date, 'payroll_date_invalid', 'تاریخ ثبت حقوق معتبر نیست.')) throw payrollError('payroll_disbursement_before_run', 'تاریخ پرداخت نمی‌تواند قبل از تاریخ ثبت حقوق باشد.');
  const period = assertOpenPeriod(acc, payDate);
  if (remaining <= 0) throw payrollError('payroll_already_disbursed', 'این لیست حقوق قبلاً کامل پرداخت شده است.');
  const disbursementId = `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Balanced Double Entry for Salary Disbursement:
  // DR 2600 (Payroll & Salaries Payable)
  // CR 1210 (Operating Bank Account)
  const journalLines = [
    {
      accountCode: '2600', // Payroll Payable
      debit: amountToDisburse,
      credit: 0,
      memo: `واریز و تسویه خالص حقوق پرسنل (${run.periodName})`,
      branchId: run.branchId || 1,
    },
    {
      accountCode: bankAccountCode, // Bank Account
      debit: 0,
      credit: amountToDisburse,
      memo: `خروج وجه از حساب بانکی بابت پرداخت حقوق پرسنل`,
      branchId: run.branchId || 1,
    },
  ];

  let journalEntry = null;
  if (postJournalFn) {
    journalEntry = postJournalFn({
      source: 'payroll_disbursement',
      sourceId: disbursementId,
      date: payDate.toISOString(),
      description: `پرداخت حقوق پرسنل از بانک (${run.periodName})`,
      lines: journalLines,
      createdById: disburseInput.createdById || 'admin',
    });
  }

  run.paidAmount = previousPaid + amountToDisburse;
  run.status = run.paidAmount >= toIRR(run.totalNetPay) ? 'disbursed' : 'partially_disbursed';
  run.disbursedAt = payDate.toISOString();
  run.disbursementJournalId = journalEntry ? journalEntry.id : null;
  run.disbursementJournalNumber = journalEntry ? journalEntry.number : null;
  const disbursement = {
    id: disbursementId, amount: amountToDisburse, date: payDate.toISOString(), status: 'posted',
    journalEntryId: journalEntry?.id || null, journalNumber: journalEntry?.number || null,
    idempotencyKey: requestKey, createdById: disburseInput.createdById || 'admin', periodId: period?.id || null,
    requestFingerprint: requestKey ? requestFingerprint : null,
  };
  run.disbursements = Array.isArray(run.disbursements) ? run.disbursements : [];
  run.disbursements.push(disbursement);

  auditEngine.recordAuditLog(acc, {
    action: 'DISBURSE_PAYROLL',
    entityType: 'PayrollRun',
    entityId: run.id,
    userId: disburseInput.createdById || 'admin',
    message: `پرداخت خالص حقوق «${run.periodName}» به مبلغ ${formatNumber(amountToDisburse)} ریال از بانک ثبت شد.`,
  });

  return { ok: true, payrollRun: run, journalEntry, disbursement, idempotentReplay: false };
}

function reversePayrollDisbursement(acc, runId, disbursementId, options = {}) {
  ensurePayroll(acc);
  const run = acc.payrollRuns.find((item) => item.id === runId);
  if (!run) return { ok: false, error: 'لیست حقوق یافت نشد.' };
  const disbursement = (run.disbursements || []).find((item) => item.id === disbursementId);
  if (!disbursement) return { ok: false, error: 'پرداخت حقوق یافت نشد.' };
  if (!['posted', 'partially_disbursed', 'disbursed'].includes(run.status)) return { ok: false, error: 'لیست حقوق در وضعیت قابل معکوس‌سازی نیست.' };
  if (disbursement.status === 'reversed') return { ok: false, error: 'این پرداخت حقوق قبلاً معکوس شده است.' };
  if (disbursement.status !== 'posted') return { ok: false, error: 'فقط پرداخت ثبت‌شده قابل معکوس‌سازی است.' };
  const disbursementAmount = safePayrollAmount(disbursement.amount, 'payroll_disbursement_amount_invalid', { allowZero: false });
  if (toIRR(run.paidAmount) < disbursementAmount) return { ok: false, error: 'مبلغ پرداخت برای معکوس‌سازی در مانده حقوق ثبت نشده است.' };
  const reversalDate = parseDate(options.date || new Date().toISOString(), 'payroll_reversal_date_invalid', 'تاریخ معکوس‌سازی پرداخت حقوق معتبر نیست.');
  assertOpenPeriod(acc, reversalDate);
  if (disbursement.date && reversalDate < parseDate(disbursement.date, 'payroll_disbursement_date_invalid', 'تاریخ پرداخت حقوق معتبر نیست.')) return { ok: false, error: 'تاریخ معکوس‌سازی نمی‌تواند قبل از پرداخت باشد.' };
  const bankAccountCode = options.bankAccountCode || '1210';
  if (!/^\d{3,10}$/.test(String(bankAccountCode))) return { ok: false, error: 'حساب پرداخت حقوق معتبر نیست.' };
  let reversalJournal = null;
  if (options.postJournalFn) {
    reversalJournal = options.postJournalFn({
      source: 'payroll_disbursement_reversal', sourceId: disbursement.id,
      date: reversalDate.toISOString(), description: `معکوس پرداخت حقوق ${run.serviceMonth || run.periodName}`,
      lines: [
        { accountCode: '2600', debit: 0, credit: disbursementAmount, branchId: run.branchId },
        { accountCode: bankAccountCode, debit: disbursementAmount, credit: 0, branchId: run.branchId },
      ],
    });
  }
  disbursement.status = 'reversed'; disbursement.reversedAt = reversalDate.toISOString();
  disbursement.reversedBy = options.userId || 'admin'; disbursement.reversalJournalEntryId = reversalJournal?.id || null;
  run.paidAmount = Math.max(0, safePayrollAmount(run.paidAmount || 0) - disbursementAmount);
  run.status = run.paidAmount ? 'partially_disbursed' : 'posted';
  return { ok: true, payrollRun: run, disbursement, reversalJournal };
}

module.exports = {
  ensurePayroll,
  calculateProgressiveTax,
  calculateEmployeePayslip,
  createPayrollRun,
  disbursePayroll,
  reversePayrollDisbursement,
};
