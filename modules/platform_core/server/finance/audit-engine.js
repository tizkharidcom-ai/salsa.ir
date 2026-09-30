'use strict';

/**
 * WESTO Finance — Cryptographic Audit, RBAC, Official Exports & 10-Year Retention Engine
 *
 * The audit boundary is intentionally fail-closed. New ledger entries and
 * audit events are hash chained, exports validate their date inputs, and an
 * unknown role/action never inherits administrator permissions.
 */

const crypto = require('crypto');
const { toFaDigits, formatMoney } = require('./money.js');

const LEDGER_GENESIS = 'GENESIS-00000000000000000000000000000000';
const AUDIT_GENESIS = 'AUDIT-GENESIS-000000000000000000000000000000';

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function canonical(value) {
  return JSON.stringify(value, (_key, item) => item === undefined ? null : item);
}

function branchKey(value) {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return /^-?\d+$/.test(raw) ? String(Number(raw)) : raw;
}

function validCalendarDay(day) {
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

function validDateValue(value) {
  const raw = String(value ?? '').trim();
  const dayPrefix = raw.match(/^(\d{4}-\d{2}-\d{2})(?=$|T|\s)/);
  if (dayPrefix && !validCalendarDay(dayPrefix[1])) return false;
  return Boolean(raw) && Number.isFinite(new Date(value).getTime());
}

function legacyJournalHash(entry, previousHash = LEDGER_GENESIS) {
  const payload = [
    entry.id || '',
    entry.number || '',
    entry.date || '',
    entry.totalAmount || 0,
    previousHash,
    (entry.lines || []).map((l) => `${l.accountCode}:${l.debit}:${l.credit}`).join(','),
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function journalHashPayload(entry, previousHash) {
  return {
    version: 2,
    id: String(entry.id || ''),
    number: String(entry.number || ''),
    date: String(entry.date || ''),
    description: String(entry.description || ''),
    totalAmount: Number(entry.totalAmount || 0),
    source: String(entry.source || ''),
    sourceId: entry.sourceId ?? null,
    branchId: entry.branchId ?? null,
    periodId: entry.periodId ?? null,
    createdById: entry.createdById ?? null,
    createdAt: entry.createdAt ?? null,
    previousHash,
    lines: (entry.lines || []).map((line) => ({
      accountCode: String(line.accountCode || ''),
      debit: Number(line.debit || 0),
      credit: Number(line.credit || 0),
      memo: line.memo ?? null,
      branchId: line.branchId ?? null,
    })),
  };
}

function computeJournalHash(entry, previousHash = LEDGER_GENESIS) {
  return crypto.createHash('sha256').update(canonical(journalHashPayload(entry, previousHash))).digest('hex');
}

function validHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function validateJournalEntry(entry, accounts = null) {
  const errors = [];
  if (!entry || typeof entry !== 'object') return { valid: false, errors: ['journal_entry_invalid'] };
  if (!String(entry.id || '').trim()) errors.push('journal_id_missing');
  if (!['draft', 'posted', 'reversed'].includes(entry.status)) errors.push('journal_status_invalid');
  if (!validDateValue(entry.date)) errors.push('journal_date_invalid');
  if (!Number.isSafeInteger(entry.totalAmount) || entry.totalAmount < 0) errors.push('journal_total_unsafe');
  if (!Array.isArray(entry.lines) || entry.lines.length < 2) errors.push('journal_lines_incomplete');

  const accountMap = Array.isArray(accounts) && accounts.length > 0
    ? new Map(accounts.map((account) => [String(account.code), account])) : null;
  let debitTotal = 0n;
  let creditTotal = 0n;
  for (const [index, line] of (Array.isArray(entry.lines) ? entry.lines : []).entries()) {
    const lineNo = index + 1;
    if (!line || typeof line !== 'object') {
      errors.push(`journal_line_${lineNo}_invalid`);
      continue;
    }
    const account = accountMap?.get(String(line.accountCode || ''));
    if (accountMap && !account) errors.push(`journal_line_${lineNo}_account_unknown`);
    if (account?.isPostingAccount === false) errors.push(`journal_line_${lineNo}_account_non_posting`);
    if (!Number.isSafeInteger(line.debit) || !Number.isSafeInteger(line.credit)) {
      errors.push(`journal_line_${lineNo}_amount_unsafe`);
      continue;
    }
    if (line.debit < 0) errors.push(`journal_line_${lineNo}_debit_negative`);
    if (line.credit < 0) errors.push(`journal_line_${lineNo}_credit_negative`);
    if (line.debit === 0 && line.credit === 0) errors.push(`journal_line_${lineNo}_zero_amount`);
    if (line.debit > 0 && line.credit > 0) errors.push(`journal_line_${lineNo}_both_sides`);
    debitTotal += BigInt(line.debit);
    creditTotal += BigInt(line.credit);
  }
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (debitTotal > max || creditTotal > max) errors.push('journal_total_overflow');
  const debit = debitTotal <= max ? Number(debitTotal) : null;
  const credit = creditTotal <= max ? Number(creditTotal) : null;
  if (debit !== credit) errors.push('journal_unbalanced');
  if (Number.isSafeInteger(entry.totalAmount) && debit !== entry.totalAmount) errors.push('journal_total_mismatch');
  return { valid: errors.length === 0, errors, debitTotal: debit, creditTotal: credit };
}

function verifyLedgerChain(acc) {
  const entries = Array.isArray(acc?.journalEntries) ? acc.journalEntries : [];
  let previousHash = LEDGER_GENESIS;
  let isTampered = false;
  let hasLegacyOrMissingHash = false;
  const seenIds = new Set();
  const chainAudit = [];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i] || {};
    const expectedHash = computeJournalHash(entry, previousHash);
    const legacyHash = legacyJournalHash(entry, previousHash);
    const storedHash = entry.hash || '';
    const missingHash = !storedHash;
    const legacy = Boolean(storedHash && storedHash === legacyHash && storedHash !== expectedHash);
    // Missing hashes are legacy/unsealed evidence rather than proof of
    // tampering. They remain visible through isTamperEvident=false, while a
    // malformed or mismatched hash is still an integrity failure.
    const hashValid = missingHash || storedHash === expectedHash || legacy;
    const structural = validateJournalEntry(entry, acc?.accounts);
    const previousHashProvided = entry.previousHash !== undefined
      && entry.previousHash !== null && entry.previousHash !== '';
    // A legacy unsealed entry may not have a predecessor pointer at all. If a
    // pointer is present, however, it must still match the chain anchor.
    const previousHashValid = missingHash && !previousHashProvided
      ? true : entry.previousHash === previousHash;
    const duplicateId = entry.id ? seenIds.has(String(entry.id)) : true;
    if (entry.id) seenIds.add(String(entry.id));
    if (missingHash || legacy) hasLegacyOrMissingHash = true;
    if (!hashValid || !previousHashValid || duplicateId || !structural.valid) isTampered = true;

    chainAudit.push({
      index: i + 1,
      entryId: entry.id,
      number: entry.number,
      date: entry.date,
      storedHash: storedHash || '(unhashed)',
      calculatedHash: expectedHash,
      legacyCalculatedHash: legacyHash,
      hashPresent: !missingHash,
      hashFormat: missingHash ? 'unsealed' : legacy ? 'legacy' : 'v2',
      previousHashValid,
      structuralValid: structural.valid,
      errors: [
        ...structural.errors,
        ...(previousHashValid ? [] : ['journal_previous_hash_mismatch']),
        ...(missingHash ? ['journal_hash_missing'] : []),
        ...(hashValid && !missingHash && !legacy && storedHash !== expectedHash ? ['journal_hash_mismatch'] : []),
        ...(duplicateId ? ['journal_id_duplicate_or_missing'] : []),
      ],
      valid: hashValid && previousHashValid && !duplicateId && structural.valid,
    });

    // A missing hash is a legacy/unsealed record and is reported as such, but
    // it must not poison the chain for the following record. A malformed or
    // tampered record advances with the calculated value, never attacker data.
    previousHash = hashValid && !missingHash ? storedHash : expectedHash;
  }

  return {
    chainLength: entries.length,
    isIntegrityValid: !isTampered,
    isTamperEvident: !isTampered && !hasLegacyOrMissingHash,
    integrityLevel: isTampered ? 'compromised' : hasLegacyOrMissingHash ? 'legacy_or_unsealed' : 'v2_tamper_evident',
    unhashedCount: chainAudit.filter((row) => !row.hashPresent).length,
    legacyHashCount: chainAudit.filter((row) => row.hashFormat === 'legacy').length,
    lastBlockHash: previousHash,
    chainAudit,
    verifiedAt: new Date().toISOString(),
  };
}

function auditHashPayload(log, previousHash) {
  return {
    version: 1,
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    userId: log.userId,
    branchId: log.branchId ?? null,
    message: log.message,
    metadata: log.metadata,
    idempotencyKey: log.idempotencyKey ?? null,
    fingerprint: log.fingerprint ?? null,
    retentionPolicy: log.retentionPolicy ?? null,
    timestamp: log.timestamp,
    previousHash,
  };
}

function auditFingerprint(input) {
  return canonical({
    action: input.action,
    entityType: input.entityType,
    entityId: String(input.entityId || ''),
    userId: input.userId || 'admin',
    branchId: input.branchId ?? null,
    message: String(input.message || '').slice(0, 300),
    metadata: input.metadata ?? null,
  });
}

function recordAuditLog(acc, input = {}) {
  if (!acc || typeof acc !== 'object') throw new TypeError('حسابداری معتبر نیست.');
  const action = String(input.action || '').trim();
  const entityType = String(input.entityType || '').trim();
  if (!action || !entityType) {
    throw Object.assign(new Error('عملیات و نوع موجودیت برای ثبت ممیزی الزامی است.'), { code: 'audit_event_invalid' });
  }
  const entityId = String(input.entityId ?? '').trim();
  if (!entityId) {
    throw Object.assign(new Error('شناسهٔ موجودیت برای ثبت ممیزی الزامی است.'), { code: 'audit_entity_required' });
  }
  const userId = String(input.userId ?? '').trim();
  if (!userId) {
    throw Object.assign(new Error('شناسهٔ کاربر برای ثبت ممیزی الزامی است.'), { code: 'audit_actor_required' });
  }
  if (!Array.isArray(acc.auditLogs)) acc.auditLogs = [];
  const idempotencyKey = String(input.idempotencyKey || '').trim() || null;
  const base = {
    action, entityType, entityId, userId,
    branchId: input.branchId ?? null, message: String(input.message || '').slice(0, 300),
    metadata: clone(input.metadata ?? null),
  };
  const fingerprint = auditFingerprint(base);
  if (idempotencyKey) {
    const existing = acc.auditLogs.find((log) => log.idempotencyKey === idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw Object.assign(new Error('کلید idempotency قبلاً برای رویداد ممیزی دیگری استفاده شده است.'), { code: 'audit_idempotency_conflict' });
      }
      return { ...clone(existing), idempotentReplay: true };
    }
  }
  const previousHash = acc.auditLogs.at(-1)?.hash || AUDIT_GENESIS;
  const timestamp = new Date().toISOString();
  const log = {
    id: `aud-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    ...base,
    idempotencyKey,
    fingerprint,
    retentionPolicy: {
      requiredRetentionYears: 10,
      legalBasis: 'ماده ۹۵ قانون مالیات‌های مستقیم و ماده ۱۴ قانون تجارت',
      expiresAt: new Date(Date.now() + 10 * 365 * 86400000).toISOString().slice(0, 10),
      isLegalHold: true,
    },
    timestamp,
    previousHash,
  };
  log.hash = crypto.createHash('sha256').update(canonical(auditHashPayload(log, previousHash))).digest('hex');
  acc.auditLogs.push(log);
  // Do not truncate audit history. A hard cap contradicted the declared
  // 10-year retention policy and silently destroyed evidence.
  return clone(log);
}

function verifyAuditLogChain(acc) {
  const logs = Array.isArray(acc?.auditLogs) ? acc.auditLogs : [];
  let previousHash = AUDIT_GENESIS;
  let valid = true;
  let hasLegacyOrMissingHash = false;
  const events = logs.map((log, index) => {
    if (!validHash(log.hash)) {
      // Historical logs were written before audit hashing existed. They are
      // unsealed evidence, not proof of tampering; keep the chain anchor at
      // genesis so a subsequently hashed log can start a new sealed segment.
      hasLegacyOrMissingHash = true;
      previousHash = AUDIT_GENESIS;
      return { index: index + 1, eventId: log.id, valid: true, hashPresent: false, expectedHash: null, storedHash: '(unsealed)' };
    }
    const expectedHash = crypto.createHash('sha256').update(canonical(auditHashPayload(log, previousHash))).digest('hex');
    const rowValid = log.hash === expectedHash && log.previousHash === previousHash;
    if (!rowValid) valid = false;
    previousHash = rowValid ? log.hash : expectedHash;
    return { index: index + 1, eventId: log.id, valid: rowValid, hashPresent: true, expectedHash, storedHash: log.hash };
  });
  return {
    valid, isIntegrityValid: valid, isTamperEvident: valid && !hasLegacyOrMissingHash,
    integrityLevel: !valid ? 'compromised' : hasLegacyOrMissingHash ? 'legacy_or_unsealed' : 'v1_tamper_evident',
    legacyOrMissingCount: events.filter((event) => !event.hashPresent).length,
    length: logs.length, lastHash: previousHash, events,
  };
}

/**
 * Validates Segregation of Duties (SoD) permissions for financial actions.
 */
function validateRBACPermission(userRole, action, context = {}) {
  const requestContext = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
  const role = String(userRole || '').trim().toLowerCase();
  const normalizedAction = String(action || '').trim().toUpperCase();
  const permissions = {
    auditor: ['VIEW_GL', 'VIEW_TRIAL_BALANCE', 'VIEW_EINVOICES', 'VIEW_AUDIT_LOGS', 'EXPORT_STATEMENTS'],
    cashier: ['OPERATE_POS', 'DRAWER_CLOSE', 'VIEW_DAILY_SALES'],
    store_manager: ['OPERATE_POS', 'CREATE_PO', 'APPROVE_PO', 'RECEIVE_GRN', 'COUNT_STOCK', 'VIEW_BRANCH_REPORTS'],
    accountant: ['VIEW_GL', 'POST_JOURNAL', 'REVERSE_JOURNAL', 'CREATE_BILL', 'PAY_BILL', 'RUN_PAYROLL', 'RUN_DEPRECIATION', 'EXPORT_STATEMENTS'],
    cfo: ['*'],
    admin: ['*'],
  };
  const knownActions = new Set(Object.values(permissions).flat().filter((value) => value !== '*'));
  if (!role || !permissions[role]) {
    return { allowed: false, code: 'rbac_role_unknown', error: `نقش «${role || 'نامشخص'}» معتبر نیست.` };
  }
  if (!normalizedAction || !knownActions.has(normalizedAction)) {
    return { allowed: false, code: 'rbac_action_unknown', error: `عملیات «${normalizedAction || 'نامشخص'}» معتبر نیست.` };
  }
  const userPerms = permissions[role];
  if (!(userPerms.includes('*') || userPerms.includes(normalizedAction))) {
    return {
      allowed: false,
      code: 'rbac_permission_denied',
      error: `دسترسی غیرمجاز: نقش «${role}» اجازه انجام عملیات «${normalizedAction}» را ندارد (اصل تفکیک وظایف مالی).`,
    };
  }
  if (requestContext.allowedBranchIds !== undefined && !Array.isArray(requestContext.allowedBranchIds)) {
    return { allowed: false, code: 'branch_scope_invalid', error: 'محدودهٔ شعبهٔ درخواست معتبر نیست.' };
  }
  const actorId = String(requestContext.actorId ?? requestContext.userId ?? '').trim().toLowerCase();
  const creatorId = String(requestContext.createdById ?? requestContext.submittedBy ?? '').trim().toLowerCase();
  const independentRequired = normalizedAction.startsWith('APPROVE_') || requestContext.requireIndependent === true;
  const identityContextProvided = ['actorId', 'userId', 'createdById', 'submittedBy'].some((key) => requestContext[key] !== undefined);
  if (independentRequired && requestContext.requireIndependent === true && (!actorId || !creatorId)) {
    return { allowed: false, code: 'segregation_identity_required', error: 'برای عملیات مستقل، شناسهٔ ایجادکننده و تأییدکننده الزامی است.' };
  }
  if (independentRequired && identityContextProvided && actorId && creatorId && actorId === creatorId) {
    return { allowed: false, code: 'segregation_of_duties', error: 'ایجادکننده نمی‌تواند همان عملیات را تأیید کند.' };
  }
  const actorBranch = branchKey(requestContext.branchId);
  const entityBranch = branchKey(requestContext.entityBranchId);
  const allowedBranches = Array.isArray(requestContext.allowedBranchIds)
    ? requestContext.allowedBranchIds.map(branchKey).filter(Boolean) : null;
  if (entityBranch !== null && actorBranch === null && !allowedBranches && requestContext.globalAccess !== true) {
    return { allowed: false, code: 'branch_scope_required', error: 'محدودهٔ شعبهٔ عملیات مشخص نشده است.' };
  }
  if (allowedBranches && entityBranch !== null && !allowedBranches.includes(entityBranch)) {
    return { allowed: false, code: 'branch_access_denied', error: 'دسترسی نقش به این شعبه مجاز نیست.' };
  }
  if (allowedBranches && actorBranch !== null && !allowedBranches.includes(actorBranch)) {
    return { allowed: false, code: 'branch_access_denied', error: 'دسترسی نقش به این شعبه مجاز نیست.' };
  }
  if (entityBranch !== null && actorBranch !== null && entityBranch !== actorBranch) {
    return { allowed: false, code: 'branch_access_denied', error: 'محدودهٔ شعبهٔ درخواست با شعبهٔ کاربر یکسان نیست.' };
  }
  return { allowed: true };
}

function parseReportDate(value, boundary = 'instant') {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  const dayPrefix = raw.match(/^(\d{4}-\d{2}-\d{2})(?=$|T|\s)/);
  if (dayPrefix && !validCalendarDay(dayPrefix[1])) {
    throw Object.assign(new Error('تاریخ گزارش معتبر نیست.'), { code: 'audit_date_invalid' });
  }
  const dayMatch = raw.match(/^\d{4}-\d{2}-\d{2}$/);
  let date;
  if (dayMatch) {
    date = new Date(`${raw}T${boundary === 'end' ? '23:59:59.999' : '00:00:00.000'}Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
      throw Object.assign(new Error('تاریخ گزارش معتبر نیست.'), { code: 'audit_date_invalid' });
    }
  } else {
    date = new Date(raw);
    if (!Number.isFinite(date.getTime())) throw Object.assign(new Error('تاریخ گزارش معتبر نیست.'), { code: 'audit_date_invalid' });
  }
  return date;
}

function matchesBranch(row, branchId) {
  if (branchId === undefined || branchId === null || branchId === '') return true;
  const requested = branchKey(branchId);
  const rowBranch = branchKey(row.branchId);
  if (rowBranch !== null) {
    if (rowBranch !== requested) return false;
    return !Array.isArray(row.lines) || row.lines.every((line) => {
      const lineBranch = branchKey(line?.branchId);
      return lineBranch === null || lineBranch === rowBranch;
    });
  }
  // An explicitly branch-scoped report must not silently absorb an unscoped
  // entry. Line-level branch data is accepted only when every line is scoped
  // to the requested branch.
  return Array.isArray(row.lines) && row.lines.length > 0
    && row.lines.every((line) => branchKey(line?.branchId) === requested);
}

function numericAmount(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) throw Object.assign(new Error('مبلغ سند برای گزارش ممیزی معتبر نیست.'), { code: 'audit_amount_invalid' });
  return amount;
}

/** Generates Official Persian RTL General Journal (دفتر روزنامه رسمی). */
function generateOfficialGeneralJournal(acc, filter = {}) {
  const query = filter && typeof filter === 'object' ? filter : {};
  const from = parseReportDate(query.from, 'start');
  const to = parseReportDate(query.to, 'end');
  if (from && to && from > to) throw Object.assign(new Error('بازهٔ تاریخ گزارش معتبر نیست.'), { code: 'audit_date_range_invalid' });
  const chain = verifyLedgerChain(acc);
  if (!chain.isIntegrityValid) throw new Error('زنجیره دفترکل معتبر نیست؛ خروجی رسمی متوقف شد.');
  const entries = (acc.journalEntries || []).filter((entry) => {
    if (entry.status !== 'posted' || !matchesBranch(entry, query.branchId)) return false;
    const date = parseReportDate(entry.date);
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  });
  let rowCounter = 1;
  const officialRows = [];
  entries.forEach((entry) => {
    (entry.lines || []).forEach((line) => {
      const accDef = (acc.accounts || []).find((a) => a.code === line.accountCode);
      officialRows.push({
        rowNumber: rowCounter++, journalNumber: entry.number, date: entry.date ? entry.date.slice(0, 10) : '',
        accountCode: line.accountCode, accountName: accDef ? (accDef.nameFa || accDef.name) : line.accountName || line.accountCode,
        description: line.memo || entry.description, debit: numericAmount(line.debit), credit: numericAmount(line.credit),
        hashSignature: validHash(entry.hash) ? `${entry.hash.slice(0, 16)}...` : 'unsealed...', branchId: entry.branchId ?? null,
      });
    });
  });
  const totalDebit = officialRows.reduce((sum, row) => sum + row.debit, 0);
  const totalCredit = officialRows.reduce((sum, row) => sum + row.credit, 0);
  return {
    title: 'دفتر روزنامه رسمی (انطباق با ماده ۹۵ قانون مالیات‌های مستقیم)', generatedAt: new Date().toISOString(),
    totalRows: officialRows.length, totalDebit, totalCredit, isBalanced: totalDebit === totalCredit, rows: officialRows,
  };
}

/** Generates Official 4-Column and 6-Column Persian RTL Trial Balance. */
function generateOfficialTrialBalance(acc, asOfDate = new Date().toISOString(), options = {}) {
  let asOfInput = asOfDate;
  let query = options && typeof options === 'object' ? options : {};
  if (asOfDate && typeof asOfDate === 'object') {
    query = asOfDate;
    asOfInput = asOfDate.asOf;
  }
  const asOf = parseReportDate(asOfInput || new Date().toISOString(), 'end');
  const chain = verifyLedgerChain(acc);
  if (!chain.isIntegrityValid) throw new Error('زنجیره دفترکل معتبر نیست؛ خروجی رسمی متوقف شد.');
  const accounts = acc.accounts || [];
  const entries = (acc.journalEntries || []).filter((entry) => {
    if (entry.status !== 'posted' || !matchesBranch(entry, query.branchId)) return false;
    return parseReportDate(entry.date) <= asOf;
  });
  const turnover = {};
  accounts.forEach((account) => {
    turnover[account.code] = { code: account.code, nameFa: account.nameFa || account.name, type: account.type, debitTurnover: 0, creditTurnover: 0 };
  });
  entries.forEach((entry) => (entry.lines || []).forEach((line) => {
    if (turnover[line.accountCode]) {
      turnover[line.accountCode].debitTurnover += numericAmount(line.debit);
      turnover[line.accountCode].creditTurnover += numericAmount(line.credit);
    }
  }));
  let totalDebitTurnover = 0;
  let totalCreditTurnover = 0;
  let totalClosingDebit = 0;
  let totalClosingCredit = 0;
  const rows = [];
  Object.values(turnover).forEach((turnoverRow) => {
    if (turnoverRow.debitTurnover === 0 && turnoverRow.creditTurnover === 0) return;
    totalDebitTurnover += turnoverRow.debitTurnover;
    totalCreditTurnover += turnoverRow.creditTurnover;
    const net = turnoverRow.debitTurnover - turnoverRow.creditTurnover;
    const closingDebit = net > 0 ? net : 0;
    const closingCredit = net < 0 ? Math.abs(net) : 0;
    totalClosingDebit += closingDebit;
    totalClosingCredit += closingCredit;
    rows.push({ ...turnoverRow, closingDebit, closingCredit });
  });
  return {
    title: 'تراز آزمایشی ۴ ستونی و ۶ ستونی رسمی', asOf: asOfInput, totalDebitTurnover, totalCreditTurnover,
    totalClosingDebit, totalClosingCredit, isTurnoverBalanced: totalDebitTurnover === totalCreditTurnover,
    isClosingBalanced: totalClosingDebit === totalClosingCredit, rows: rows.sort((a, b) => a.code.localeCompare(b.code)),
  };
}

/** Returns 10-Year Retention & Compliance Status Report. */
function get10YearComplianceReport(acc) {
  const chainAudit = verifyLedgerChain(acc);
  const auditLogAudit = verifyAuditLogChain(acc);
  const auditLogsCount = (acc.auditLogs || []).length;
  const journalEntriesCount = (acc.journalEntries || []).length;
  const eInvoicesCount = (acc.eInvoices || []).length;
  return {
    complianceStandard: 'ماده ۹۵ ق.م.م، ماده ۱۴ قانون تجارت و آیین‌نامه پایانه‌های فروشگاهی', retentionPolicyYears: 10,
    digitalLedgerIntegrity: !chainAudit.isIntegrityValid ? 'COMPROMISED' : chainAudit.isTamperEvident ? 'VERIFIED_TAMPER_PROOF' : 'LEGACY_OR_UNSEALED',
    auditLogIntegrity: !auditLogAudit.valid ? 'COMPROMISED' : auditLogAudit.isTamperEvident ? 'VERIFIED_TAMPER_EVIDENT' : 'LEGACY_OR_UNSEALED', chainLength: chainAudit.chainLength,
    lastBlockHash: chainAudit.lastBlockHash, auditTrailEventsCount: auditLogsCount, archivedJournalCount: journalEntriesCount,
    taxpayerEInvoicesCount: eInvoicesCount, legalHoldActive: true, certificateIssuedAt: new Date().toISOString(),
  };
}

module.exports = {
  GENESIS_HASH: LEDGER_GENESIS,
  computeJournalHash, validateJournalEntry, verifyLedgerChain, recordAuditLog, verifyAuditLogChain,
  validateRBACPermission, generateOfficialGeneralJournal, generateOfficialTrialBalance, get10YearComplianceReport,
};
