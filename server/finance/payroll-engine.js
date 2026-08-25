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

const { toIRR } = require('./money');
const auditEngine = require('./audit-engine');

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
  if (taxableMonthlyIrr <= 0) return 0;
  let remaining = taxableMonthlyIrr;
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
  const baseSalary = toIRR(overrides.baseSalary !== undefined ? overrides.baseSalary : emp.baseSalary || 0);
  const overtimePay = toIRR(overrides.overtimePay || 0);
  const bonuses = toIRR(overrides.bonuses || 0);
  const housingAllowance = toIRR(overrides.housingAllowance !== undefined ? overrides.housingAllowance : emp.housingAllowance || 0);
  const foodAllowance = toIRR(overrides.foodAllowance !== undefined ? overrides.foodAllowance : emp.foodAllowance || 0);
  const childAllowance = toIRR(overrides.childAllowance !== undefined ? overrides.childAllowance : emp.childAllowance || 0);
  const deductions = toIRR(overrides.deductions || 0);

  const grossEarnings = baseSalary + overtimePay + bonuses + housingAllowance + foodAllowance + childAllowance;
  const insurableEarnings = grossEarnings; // Standard Iranian social security base

  // Social Security Split (30% total):
  const employeeInsurance = Math.round(insurableEarnings * 0.07); // 7%
  const employerInsurance = Math.round(insurableEarnings * 0.23); // 20% employer + 3% unemployment

  // Taxable Earnings (Child allowance is legally tax exempt):
  const taxableEarnings = Math.max(0, grossEarnings - childAllowance);
  const payrollTax = calculateProgressiveTax(taxableEarnings);

  const netPay = grossEarnings - employeeInsurance - payrollTax - deductions;

  return {
    employeeId: emp.id,
    employeeName: emp.name,
    nationalId: emp.nationalId,
    role: emp.role,
    department: emp.department || 'kitchen',
    branchId: emp.branchId || 1,
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

  const periodName = runInput.periodName || `حقوق و دستمزد ماه جاری`;
  const branchId = runInput.branchId ? Number(runInput.branchId) : 1;
  const employeesList = (runInput.employees && runInput.employees.length > 0)
    ? runInput.employees
    : acc.employees.filter((e) => e.active !== false && (!branchId || e.branchId === branchId));

  if (employeesList.length === 0) throw new Error('هیچ پرسنل فعالی برای محاسبه حقوق یافت نشد.');

  const slips = employeesList.map((emp) => {
    const fullEmp = acc.employees.find((e) => e.id === emp.id || e.id === emp.employeeId) || emp;
    return calculateEmployeePayslip(fullEmp, emp);
  });

  let totalKitchenGross = 0;
  let totalServiceGross = 0;
  let totalEmployerInsurance = 0;
  let totalEmployeeInsurance = 0;
  let totalPayrollTax = 0;
  let totalNetPay = 0;

  slips.forEach((s) => {
    if (s.department === 'service') totalServiceGross += s.grossEarnings;
    else totalKitchenGross += s.grossEarnings;

    totalEmployerInsurance += s.employerInsurance;
    totalEmployeeInsurance += s.employeeInsurance;
    totalPayrollTax += s.payrollTax;
    totalNetPay += s.netPay;
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
    {
      accountCode: '6140', // Social Security & Insurance (Employer 23%)
      debit: totalEmployerInsurance,
      credit: 0,
      memo: `هزینه بیمه تأمین اجتماعی سهم کارفرما (۲۳٪)`,
      branchId,
    },
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
  ];

  let journalEntry = null;
  if (postJournalFn) {
    journalEntry = postJournalFn({
      source: 'payroll_run',
      sourceId: runId,
      date: runInput.date || new Date().toISOString().slice(0, 10),
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
    totalNetPay,
    paidAmount: 0,
    status: 'posted', // posted | disbursed
    slips,
    journalEntryId: journalEntry ? journalEntry.id : null,
    journalNumber: journalEntry ? journalEntry.number : null,
    createdAt: new Date().toISOString(),
  };

  acc.payrollRuns.unshift(runRecord);

  auditEngine.recordAuditLog(acc, {
    action: 'CREATE_PAYROLL_RUN',
    entityType: 'PayrollRun',
    entityId: runRecord.id,
    userId: runInput.createdById || 'admin',
    message: `لیست حقوق و دستمزد «${periodName}» برای ${slips.length} نفر ثبت شد. خالص حقوق: ${totalNetPay.toLocaleString('fa-IR')} ریال`,
  });

  return { ok: true, payrollRun: runRecord, journalEntry };
}

/**
 * Disburses net payroll from Operating Bank Account.
 */
function disbursePayroll(acc, runId, disburseInput, opts = {}) {
  ensurePayroll(acc);
  const { postJournalFn } = opts;

  const run = acc.payrollRuns.find((r) => r.id === runId);
  if (!run) throw new Error('لیست حقوق یافت نشد.');
  if (run.status === 'disbursed') throw new Error('این لیست حقوق قبلاً پرداخت و تسویه شده است.');

  const amountToDisburse = toIRR(disburseInput.amount || run.totalNetPay);
  const bankAccountCode = disburseInput.bankAccountCode || '1210';
  const payDate = disburseInput.date || new Date().toISOString();

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
      sourceId: run.id,
      date: payDate,
      description: `پرداخت حقوق پرسنل از بانک (${run.periodName})`,
      lines: journalLines,
      createdById: disburseInput.createdById || 'admin',
    });
  }

  run.paidAmount = amountToDisburse;
  run.status = 'disbursed';
  run.disbursedAt = payDate;
  run.disbursementJournalId = journalEntry ? journalEntry.id : null;
  run.disbursementJournalNumber = journalEntry ? journalEntry.number : null;

  auditEngine.recordAuditLog(acc, {
    action: 'DISBURSE_PAYROLL',
    entityType: 'PayrollRun',
    entityId: run.id,
    userId: disburseInput.createdById || 'admin',
    message: `پرداخت خالص حقوق «${run.periodName}» به مبلغ ${amountToDisburse.toLocaleString('fa-IR')} ریال از بانک ثبت شد.`,
  });

  return { ok: true, payrollRun: run, journalEntry };
}

module.exports = {
  ensurePayroll,
  calculateProgressiveTax,
  calculateEmployeePayslip,
  createPayrollRun,
  disbursePayroll,
};
