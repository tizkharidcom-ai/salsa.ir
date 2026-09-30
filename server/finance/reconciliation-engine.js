'use strict';

/**
 * WESTO Finance — Treasury, Expenses, Petty Cash, Settlements & Bank Reconciliation Engine
 * Compliant with Iranian Direct Taxes Act (Article 147) and Shaparak/POS clearing standards.
 * Implements:
 * 1. Operational Expense Tracking with Tax Deductibility tagging & Attachments
 * 2. Petty Cash (تنخواه گردان) replenishment & voucher accounting
 * 3. Cash Drawer Shifts with automated Discrepancy (کسر/مازاد) GL postings
 * 4. POS Terminal & Online Gateway Settlement Clearing (1320 -> 1210 + fee 6500)
 * 5. Bank Feed Import & Heuristic Multi-Criteria Auto-Matching
 * 6. GL Control Totals Verification
 */

const { toIRR, formatNumber } = require('./money');
const auditEngine = require('./audit-engine');

function ensureReconciliation(acc) {
  if (!Array.isArray(acc.bankTransactions)) acc.bankTransactions = [];
  if (!Array.isArray(acc.settlements)) acc.settlements = [];
  if (!Array.isArray(acc.expenses)) acc.expenses = [];
  if (!Array.isArray(acc.pettyCash)) acc.pettyCash = [];
  if (!Array.isArray(acc.cashDrawers)) acc.cashDrawers = [];
  if (!Array.isArray(acc.reconciliationRules)) {
    acc.reconciliationRules = [
      { id: 'rr-1', name: 'تطبیق خودکار درگاه پرداخت آنلاین', field: 'reference', pattern: 'TXN-', targetAccount: '1310' },
      { id: 'rr-2', name: 'تسویه کارتخوان شاپرک', field: 'description', pattern: 'شاپرک', targetAccount: '1320' },
    ];
  }
  return acc;
}

/**
 * Creates an Operational Expense with Tax Deductibility status (Article 147) and GL posting.
 */
function createExpenseEntry(acc, expenseInput, opts = {}) {
  ensureReconciliation(acc);
  const { postJournalFn } = opts;

  const title = String(expenseInput.title || expenseInput.description || 'هزینه عمومی').trim();
  const category = expenseInput.category || 'هزینه‌های عمومی و اداری';
  const amount = toIRR(expenseInput.amount || 0);
  if (amount <= 0) throw new Error('مبلغ هزینه باید بزرگتر از صفر باشد.');

  const date = expenseInput.date || new Date().toISOString().slice(0, 10);
  const branchId = expenseInput.branchId ? Number(expenseInput.branchId) : 1;
  const payMethod = String(expenseInput.paymentMethod || 'bank').toLowerCase();
  const taxDeductibility = expenseInput.taxDeductibilityStatus || 'REVIEW_REQUIRED'; // CONFIRMED, REVIEW_REQUIRED, NON_DEDUCTIBLE

  // Resolve Debit Account (Expense Category)
  let debitAccount = expenseInput.accountCode || '6990'; // Miscellaneous / Other Operating Expenses
  if (category.includes('اجاره')) debitAccount = '6200';
  else if (category.includes('آب') || category.includes('برق') || category.includes('گاز') || category.includes('قبوض')) debitAccount = '6300';
  else if (category.includes('تعمیر') || category.includes('نگهداری')) debitAccount = '6500';
  else if (category.includes('نظافت') || category.includes('بهداشت')) debitAccount = '6600';
  else if (category.includes('تبلیغات') || category.includes('مارکتینگ')) debitAccount = '6400';
  else if (category.includes('اداری') || category.includes('ملزومات')) debitAccount = '6700';

  // Resolve Credit Account (Payment Source)
  let creditAccount = '1210'; // Bank
  if (payMethod === 'cash') creditAccount = '1110';
  else if (payMethod === 'petty_cash' || payMethod === 'تنخواه') creditAccount = '1130';

  const expenseId = `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Balanced Double Entry: DR Expense Category (6xxx), CR Cash/Bank/PettyCash (1xxx)
  const journalLines = [
    {
      accountCode: debitAccount,
      debit: amount,
      credit: 0,
      memo: `ثبت هزینه: ${title} (${category})`,
      branchId,
    },
    {
      accountCode: creditAccount,
      debit: 0,
      credit: amount,
      memo: `پرداخت هزینه از طریق ${payMethod === 'petty_cash' ? 'تنخواه گردان' : payMethod === 'cash' ? 'صندوق نقدی' : 'بانک'}`,
      branchId,
    },
  ];

  let journalEntry = null;
  if (postJournalFn) {
    journalEntry = postJournalFn({
      source: 'expense',
      sourceId: expenseId,
      date,
      description: `ثبت هزینه: ${title} (${category})`,
      lines: journalLines,
      createdById: expenseInput.createdById || 'admin',
    });
  }

  const record = {
    id: expenseId,
    title,
    category,
    amount,
    paymentMethod: payMethod,
    taxDeductibilityStatus: taxDeductibility,
    attachments: Array.isArray(expenseInput.attachments) ? expenseInput.attachments : [],
    date,
    branchId,
    note: String(expenseInput.note || '').slice(0, 300),
    journalEntryId: journalEntry ? journalEntry.id : null,
    journalNumber: journalEntry ? journalEntry.number : null,
    createdAt: new Date().toISOString(),
  };

  acc.expenses.unshift(record);

  auditEngine.recordAuditLog(acc, {
    action: 'CREATE_EXPENSE',
    entityType: 'Expense',
    entityId: record.id,
    userId: expenseInput.createdById || 'admin',
    message: `هزینه «${title}» به مبلغ ${formatNumber(amount)} ریال ثبت شد. وضعیت مالیاتی: ${taxDeductibility}`,
  });

  return { ok: true, expense: record, journalEntry };
}

/**
 * Replenishes Petty Cash Fund (شارژ تنخواه گردان) from Bank.
 */
function replenishPettyCash(acc, replenishInput, opts = {}) {
  ensureReconciliation(acc);
  const { postJournalFn } = opts;

  const amount = toIRR(replenishInput.amount || 0);
  if (amount <= 0) throw new Error('مبلغ شارژ تنخواه نامعتبر است.');

  const custodian = String(replenishInput.custodian || 'مسئول تنخواه').trim();
  const date = replenishInput.date || new Date().toISOString();
  const branchId = replenishInput.branchId ? Number(replenishInput.branchId) : 1;

  const id = `pc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Balanced Double Entry: DR Petty Cash (1130), CR Bank Account (1210)
  const journalLines = [
    {
      accountCode: '1130', // Petty Cash Fund
      debit: amount,
      credit: 0,
      memo: `شارژ صندوق تنخواه گردان (${custodian})`,
      branchId,
    },
    {
      accountCode: '1210', // Bank Operating Account
      debit: 0,
      credit: amount,
      memo: `انتقال وجه به تنخواه گردان (${custodian})`,
      branchId,
    },
  ];

  let journalEntry = null;
  if (postJournalFn) {
    journalEntry = postJournalFn({
      source: 'petty_cash_replenish',
      sourceId: id,
      date,
      description: `شارژ صندوق تنخواه گردان (${custodian})`,
      lines: journalLines,
      createdById: replenishInput.createdById || 'admin',
    });
  }

  const record = {
    id,
    custodian,
    amount,
    date,
    branchId,
    journalEntryId: journalEntry ? journalEntry.id : null,
    journalNumber: journalEntry ? journalEntry.number : null,
    createdAt: new Date().toISOString(),
  };

  acc.pettyCash.unshift(record);

  auditEngine.recordAuditLog(acc, {
    action: 'REPLENISH_PETTY_CASH',
    entityType: 'PettyCash',
    entityId: record.id,
    userId: replenishInput.createdById || 'admin',
    message: `شارژ تنخواه گردان به مبلغ ${formatNumber(amount)} ریال ثبت گردید.`,
  });

  return { ok: true, pettyCash: record, journalEntry };
}

/**
 * Records a POS / Gateway Settlement (تسویه شاپرک) with bank fee expense recognition.
 */
function recordSettlement(acc, settlementInput, opts = {}) {
  ensureReconciliation(acc);
  const { postJournalFn } = opts;

  const grossAmount = toIRR(settlementInput.grossAmount || settlementInput.gross || 0);
  const feeAmount = toIRR(settlementInput.feeAmount || settlementInput.fee || 0);
  const netAmount = grossAmount - feeAmount;

  if (grossAmount <= 0) throw new Error('مبلغ ناخالص تسویه نامعتبر است.');
  if (feeAmount < 0 || feeAmount > grossAmount) throw new Error('کارمزد تسویه باید بین صفر و مبلغ ناخالص باشد.');

  const provider = settlementInput.provider || 'کارتخوان شاپرک (POS)';
  const batchNumber = settlementInput.batchNumber || `BATCH-${Date.now().toString().slice(-6)}`;
  const date = settlementInput.date || new Date().toISOString();
  const branchId = settlementInput.branchId ? Number(settlementInput.branchId) : 1;

  const id = `stl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Balanced Double Entry for Settlement:
  // DR 1210 (Bank Account) -> Net Amount
  // DR 6500 (Bank & PSP Fees) -> Fee Amount (if > 0)
  // CR 1320 (POS Terminal Receivable / وجوه در راه کارتخوان) -> Gross Amount
  const journalLines = [
    {
      accountCode: '1210', // Operating Bank Account
      debit: netAmount,
      credit: 0,
      memo: `واریز تسویه حساب ${provider} (دسته ${batchNumber})`,
      branchId,
    },
    ...(feeAmount > 0 ? [{
      accountCode: '6710', // Bank & PSP Commission Fees
      debit: feeAmount,
      credit: 0,
      memo: `کارمزد بانکی تسویه ${provider} (دسته ${batchNumber})`,
      branchId,
    }] : []),
    {
      accountCode: '1320', // POS Terminal Receivable
      debit: 0,
      credit: grossAmount,
      memo: `بستن حساب واسط کارتخوان - تسویه ${provider}`,
      branchId,
    },
  ];

  let journalEntry = null;
  if (postJournalFn) {
    journalEntry = postJournalFn({
      source: 'settlement',
      sourceId: id,
      date,
      description: `تسویه حساب ${provider} (دسته شماره ${batchNumber})`,
      lines: journalLines,
      createdById: settlementInput.createdById || 'admin',
    });
  }

  const record = {
    id,
    provider,
    batchNumber,
    grossAmount,
    feeAmount,
    netAmount,
    date,
    branchId,
    journalEntryId: journalEntry ? journalEntry.id : null,
    journalNumber: journalEntry ? journalEntry.number : null,
    createdAt: new Date().toISOString(),
  };

  acc.settlements.unshift(record);

  auditEngine.recordAuditLog(acc, {
    action: 'RECORD_SETTLEMENT',
    entityType: 'Settlement',
    entityId: record.id,
    userId: settlementInput.createdById || 'admin',
    message: `تسویه ${provider} به مبلغ ناخالص ${formatNumber(grossAmount)} ریال ثبت شد.`,
  });

  return { ok: true, settlement: record, journalEntry };
}

/**
 * Closes a Cash Drawer Session and posts Discrepancy (کسر/مازاد صندوق) GL entries if any.
 */
function closeCashDrawer(acc, sessionId, closeInput, opts = {}) {
  ensureReconciliation(acc);
  const { postJournalFn } = opts;

  const session = acc.cashDrawers.find((s) => s.id === sessionId);
  if (!session) throw new Error('جلسه صندوق یافت نشد.');
  if (session.status === 'closed') throw new Error('این شیفت صندوق قبلاً بسته شده است.');

  const closingCash = toIRR(closeInput.closingCash || 0);
  const openingFloat = toIRR(session.openingFloat || 0);
  const cashSales = toIRR(session.cashSales || 0);
  const cashRefunds = toIRR(session.cashRefunds || 0);
  const expectedCash = openingFloat + cashSales - cashRefunds;
  const discrepancy = closingCash - expectedCash; // < 0: Shortage (کسری), > 0: Overage (مازاد)

  session.closingCash = closingCash;
  session.expectedCash = expectedCash;
  session.discrepancy = discrepancy;
  session.status = 'closed';
  session.closedAt = new Date().toISOString();
  session.closedBy = closeInput.closedBy || 'admin';

  let discrepancyJournal = null;

  if (discrepancy !== 0 && postJournalFn) {
    const isShortage = discrepancy < 0;
    const diffAbs = Math.abs(discrepancy);

    const journalLines = isShortage
      ? [
          {
            accountCode: '5500', // Cash Shortage Expense (کسری صندوق)
            debit: diffAbs,
            credit: 0,
            memo: `ثبت کسری صندوق شیفت ${session.drawerName} (${session.cashierName})`,
            branchId: session.branchId || 1,
          },
          {
            accountCode: '1110', // Cash on Hand
            debit: 0,
            credit: diffAbs,
            memo: `تعدیل کسری موجودی صندوق ${session.drawerName}`,
            branchId: session.branchId || 1,
          },
        ]
      : [
          {
            accountCode: '1110', // Cash on Hand
            debit: diffAbs,
            credit: 0,
            memo: `تعدیل مازاد موجودی صندوق ${session.drawerName}`,
            branchId: session.branchId || 1,
          },
          {
            accountCode: '4500', // Other Operating Income (مازاد صندوق)
            debit: 0,
            credit: diffAbs,
            memo: `ثبت مازاد صندوق شیفت ${session.drawerName} (${session.cashierName})`,
            branchId: session.branchId || 1,
          },
        ];

    discrepancyJournal = postJournalFn({
      source: 'cash_discrepancy',
      sourceId: session.id,
      date: new Date().toISOString(),
      description: `ثبت ${isShortage ? 'کسری' : 'مازاد'} صندوق شیفت ${session.drawerName}`,
      lines: journalLines,
      createdById: closeInput.closedBy || 'admin',
    });

    session.discrepancyJournalId = discrepancyJournal.id;
    session.discrepancyJournalNumber = discrepancyJournal.number;
  }

  auditEngine.recordAuditLog(acc, {
    action: 'CLOSE_CASH_DRAWER',
    entityType: 'CashDrawer',
    entityId: session.id,
    userId: closeInput.closedBy || 'admin',
    message: `شیفت صندوق «${session.drawerName}» بسته شد. موجودی شمارش‌شده: ${formatNumber(closingCash)} ریال (اختلاف: ${formatNumber(discrepancy)} ریال)`,
  });

  return { ok: true, session, discrepancyJournal };
}

/**
 * Imports raw bank statement feed transactions.
 */
function importBankFeed(acc, transactions = [], options = {}) {
  ensureReconciliation(acc);
  const scopedBranchId = options?.branchId == null || options.branchId === '' ? null : Number(options.branchId);
  let importedCount = 0;
  for (const t of transactions) {
    const txnId = t.id || `btx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const bankAccountId = t.bankAccountId || '1210';
    const reference = String(t.reference || '').slice(0, 100);
    const branchId = scopedBranchId ?? (t.branchId == null || t.branchId === '' ? null : Number(t.branchId));
    const duplicate = acc.bankTransactions.some((ex) => {
      if (ex.id === txnId) return true;
      if (!reference || String(ex.reference || '') !== reference) return false;
      const existingBranchId = ex.branchId == null || ex.branchId === '' ? null : Number(ex.branchId);
      return existingBranchId === branchId
        && String(ex.bankAccountId || '1210') === String(bankAccountId);
    });
    if (duplicate) continue;

    acc.bankTransactions.push({
      id: txnId,
      date: t.date || new Date().toISOString(),
      description: String(t.description || 'تراکنش بانکی').slice(0, 200),
      debit: toIRR(t.debit || 0), // deposit into bank
      credit: toIRR(t.credit || 0), // withdrawal from bank
      balance: toIRR(t.balance || 0),
      reference,
      status: 'unmatched', // unmatched | matched | reconciled
      matchedJournalId: null,
      bankAccountId,
      branchId,
      createdAt: new Date().toISOString(),
    });
    importedCount++;
  }
  return { ok: true, importedCount, totalTransactions: acc.bankTransactions.length };
}

/**
 * Performs heuristic multi-criteria auto-matching on bank feed transactions.
 */
function autoMatchBankFeed(acc, branchId = null) {
  ensureReconciliation(acc);
  const scopedBranchId = branchId == null || branchId === '' ? null : Number(branchId);
  const branchOf = (row) => {
    const headerBranch = row?.branchId == null || row.branchId === '' ? null : Number(row.branchId);
    if (headerBranch != null && (!Number.isSafeInteger(headerBranch) || headerBranch <= 0)) return undefined;
    const lineBranches = [...new Set((Array.isArray(row?.lines) ? row.lines : [])
      .map((line) => line?.branchId == null || line.branchId === '' ? null : Number(line.branchId)))];
    if (lineBranches.some((id) => id != null && (!Number.isSafeInteger(id) || id <= 0))) return undefined;
    const assignedLineBranches = lineBranches.filter((id) => id != null);
    if (assignedLineBranches.length > 1) return undefined;
    const lineBranch = assignedLineBranches[0] ?? null;
    if (headerBranch != null && lineBranch != null && headerBranch !== lineBranch) return undefined;
    return headerBranch ?? lineBranch;
  };
  const inScope = (row) => {
    const rowBranch = branchOf(row);
    return rowBranch !== undefined && (scopedBranchId == null || rowBranch === scopedBranchId);
  };
  const unmatchedTxns = acc.bankTransactions.filter((t) => t.status === 'unmatched' && inScope(t));
  const journalEntries = (acc.journalEntries || []).filter((j) => j.status === 'posted' && inScope(j));
  const matchedJournalIds = new Set(
    acc.bankTransactions
      .filter((t) => (t.status === 'matched' || t.status === 'reconciled') && t.matchedJournalId)
      .map((t) => t.matchedJournalId)
  );
  let matchedCount = 0;

  for (const txn of unmatchedTxns) {
    const txnDebit = Number(txn.debit);
    const txnCredit = Number(txn.credit);
    if (!Number.isSafeInteger(txnDebit) || !Number.isSafeInteger(txnCredit)
      || txnDebit < 0 || txnCredit < 0 || (txnDebit > 0) === (txnCredit > 0)) continue;
    const txnBranch = branchOf(txn);
    // Unattributed records cannot be safely auto-matched in a multi-branch
    // ledger; leave them for an operator to resolve explicitly.
    if (txnBranch == null || txnBranch === undefined) continue;
    const netBank = txnDebit - txnCredit;

    // Matching criteria: close date (+/- 3 days), matching net flow on bank/clearing account, and not previously matched
    const txDate = new Date(txn.date).getTime();
    if (!Number.isFinite(txDate)) continue;
    const candidates = journalEntries.filter((j) => {
      if (matchedJournalIds.has(j.id)) return false;
      // Amount/date heuristics are not enough for multi-branch books. A match
      // must stay inside one known branch, including when this is a global run.
      if (txnBranch !== branchOf(j)) return false;
      const jDate = new Date(j.date).getTime();
      if (!Number.isFinite(jDate) || Math.abs(txDate - jDate) > 3 * 24 * 3600 * 1000) return false;

      return (j.lines || []).some((l) => {
        if (l.accountCode === txn.bankAccountId || l.accountCode === '1210' || l.accountCode === '1310' || l.accountCode === '1320') {
          const debit = Number(l.debit);
          const credit = Number(l.credit);
          if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit)
            || debit < 0 || credit < 0 || (debit > 0 && credit > 0) || (debit === 0 && credit === 0)) return false;
          return debit - credit === netBank;
        }
        return false;
      });
    });

    // A heuristic match is safe only when exactly one available posted
    // journal satisfies all evidence. Do not choose by array order.
    if (candidates.length !== 1) continue;
    const candidate = candidates[0];
    if (candidate) {
      txn.status = 'matched';
      txn.matchedJournalId = candidate.id;
      txn.matchedJournalNumber = candidate.number;
      matchedJournalIds.add(candidate.id);
      matchedCount++;
    }
  }

  return {
    ok: true,
    matchedCount,
    remainingUnmatched: acc.bankTransactions.filter((t) => t.status === 'unmatched'
      && (scopedBranchId == null || inScope(t))).length,
  };
}

function reconcileTransaction(acc, txnId, journalId) {
  ensureReconciliation(acc);
  const txn = acc.bankTransactions.find((t) => t.id === txnId);
  if (!txn) return { ok: false, error: 'تراکنش بانکی یافت نشد.' };
  txn.status = 'reconciled';
  txn.matchedJournalId = journalId || txn.matchedJournalId;
  txn.reconciledAt = new Date().toISOString();
  return { ok: true, txn };
}

function calculateControlTotals(acc, branchId = null) {
  const accounts = acc.accounts || [];
  const entries = (acc.journalEntries || []).filter((e) => e.status === 'posted');

  let totalDebits = 0;
  let totalCredits = 0;
  const balances = {};

  accounts.forEach((a) => { balances[a.code] = { code: a.code, name: a.nameFa || a.name, type: a.type, debit: 0, credit: 0 }; });

  entries.forEach((e) => {
    (e.lines || []).forEach((l) => {
      const lineBranchId = l.branchId ?? e.branchId ?? null;
      if (branchId != null && Number(lineBranchId) !== Number(branchId)) return;
      totalDebits += l.debit;
      totalCredits += l.credit;
      if (balances[l.accountCode]) {
        balances[l.accountCode].debit += l.debit;
        balances[l.accountCode].credit += l.credit;
      }
    });
  });

  const isBalanced = totalDebits === totalCredits;

  return {
    totalDebits,
    totalCredits,
    difference: Math.abs(totalDebits - totalCredits),
    isBalanced,
    accountCount: accounts.length,
    postedEntriesCount: entries.length,
    balances: Object.values(balances).filter((b) => b.debit > 0 || b.credit > 0),
    asOf: new Date().toISOString(),
  };
}

module.exports = {
  ensureReconciliation,
  createExpenseEntry,
  replenishPettyCash,
  recordSettlement,
  closeCashDrawer,
  importBankFeed,
  autoMatchBankFeed,
  reconcileTransaction,
  calculateControlTotals,
};
