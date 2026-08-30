'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const approvalEngine = require('../server/finance/approval-engine');
const periodService = require('../server/finance/period-service');
const auditEngine = require('../server/finance/audit-engine');

function approvalState() {
  return {
    approvalSettings: {
      autoApproveThreshold: 500000,
      levels: [
        { level: 1, role: 'accountant' },
        { level: 2, role: 'manager' },
        { level: 3, role: 'owner' },
      ],
    },
    approvalQueue: [],
  };
}

function periodState() {
  return { fiscalPeriods: [], periodAudit: [] };
}

function journalEntry(input, previousHash) {
  const entry = {
    id: input.id,
    number: input.number,
    date: input.date,
    description: input.description || 'سند تست',
    source: input.source || 'test',
    sourceId: input.sourceId || null,
    branchId: input.branchId,
    status: 'posted',
    totalAmount: input.totalAmount,
    createdById: input.createdById || 'tester',
    createdAt: input.createdAt || '2026-08-01T00:00:00.000Z',
    previousHash,
    lines: input.lines || [
      { accountCode: '1110', debit: input.totalAmount, credit: 0, branchId: input.branchId },
      { accountCode: '4110', debit: 0, credit: input.totalAmount, branchId: input.branchId },
    ],
  };
  entry.hash = auditEngine.computeJournalHash(entry, previousHash);
  return entry;
}

test('approval controls enforce level role, independent approvers, branch scope and replay safety', () => {
  const acc = approvalState();
  const first = approvalEngine.submitForApproval(acc, {
    type: 'purchase_order', entityId: 'po-1', description: 'خرید تست', amount: 600000,
    submittedBy: 'accountant-1', branchId: 1, idempotencyKey: 'submit-po-1',
  });
  assert.equal(first.status, 'pending');
  assert.equal(acc.approvalQueue.length, 1);
  assert.equal(approvalEngine.submitForApproval(acc, {
    type: 'purchase_order', entityId: 'po-1', amount: 600000, submittedBy: 'accountant-1', branchId: 1,
    idempotencyKey: 'submit-po-1',
  }).idempotentReplay, true);
  assert.equal(acc.approvalQueue.length, 1);
  assert.equal(approvalEngine.submitForApproval(acc, {
    type: 'purchase_order', entityId: 'po-1', amount: 700000, submittedBy: 'accountant-1', branchId: 1,
    idempotencyKey: 'submit-po-1',
  }).code, 'approval_idempotency_conflict');

  assert.equal(approvalEngine.approveItem(acc, first.approvalId, {
    userId: 'manager-1', role: 'manager', branchId: 1,
  }).code, 'approval_role_mismatch');
  assert.equal(approvalEngine.approveItem(acc, first.approvalId, {
    userId: 'accountant-1', role: 'accountant', branchId: 1,
  }).code, 'approval_segregation_of_duties');
  assert.equal(approvalEngine.approveItem(acc, first.approvalId, {
    userId: 'accountant-2', role: 'accountant', branchId: 2,
  }).code, 'approval_branch_access_denied');
  assert.equal(approvalEngine.approveItem(acc, first.approvalId, {
    userId: 'accountant-2', role: 'accountant',
  }).code, 'approval_branch_scope_required');

  const levelOne = approvalEngine.approveItem(acc, first.approvalId, {
    userId: 'accountant-2', role: 'accountant', branchId: 1, idempotencyKey: 'approve-po-1-l1',
  });
  assert.equal(levelOne.status, 'pending');
  assert.equal(levelOne.item.currentLevel, 2);
  const levelOneReplay = approvalEngine.approveItem(acc, first.approvalId, {
    userId: 'accountant-2', role: 'accountant', branchId: 1, idempotencyKey: 'approve-po-1-l1',
  });
  assert.equal(levelOneReplay.idempotentReplay, true);
  assert.equal(acc.approvalQueue[0].approvals.length, 1);

  assert.equal(approvalEngine.approveItem(acc, first.approvalId, {
    userId: 'accountant-2', role: 'accountant', branchId: 1,
  }).code, 'approval_role_mismatch');
  assert.equal(approvalEngine.approveItem(acc, first.approvalId, {
    userId: 'manager-1', role: 'manager', branchId: 1,
  }).status, 'pending');
  assert.equal(approvalEngine.approveItem(acc, first.approvalId, {
    userId: 'owner-1', role: 'owner', branchId: 1,
  }).status, 'approved');
  assert.equal(approvalEngine.approveItem(acc, first.approvalId, {
    userId: 'owner-2', role: 'owner', branchId: 1,
  }).code, 'approval_already_decided');

  const second = approvalEngine.submitForApproval(acc, {
    type: 'purchase_order', entityId: 'po-2', amount: 600000, submittedBy: 'accountant-1', branchId: 1,
  });
  assert.equal(approvalEngine.approveItem(acc, second.approvalId, {
    userId: 'accountant-3', role: 'accountant', branchId: 1, idempotencyKey: 'approve-po-1-l1',
  }).code, 'approval_idempotency_conflict');

  const exposed = approvalEngine.listPending(acc, { role: 'owner', branchId: 1 });
  assert.equal(exposed.length, 0);
  if (levelOne.item) levelOne.item.status = 'tampered';
  assert.equal(acc.approvalQueue[0].status, 'approved');
});

test('approval rejection requires the current role, a reason, an independent actor and is idempotent', () => {
  const acc = approvalState();
  const submitted = approvalEngine.submitForApproval(acc, {
    type: 'expense', entityId: 'exp-1', amount: 900000, submittedBy: 'maker-1', branchId: 1,
  });
  assert.equal(approvalEngine.rejectItem(acc, submitted.approvalId, {
    userId: 'accountant-2', role: 'accountant', branchId: 1,
  }).code, 'approval_rejection_reason_required');
  assert.equal(approvalEngine.rejectItem(acc, submitted.approvalId, {
    userId: 'manager-1', role: 'manager', branchId: 1, comment: 'نیاز به مدرک دارد',
  }).code, 'approval_role_mismatch');
  const rejected = approvalEngine.rejectItem(acc, submitted.approvalId, {
    userId: 'accountant-2', role: 'accountant', branchId: 1, comment: 'نیاز به مدرک دارد', idempotencyKey: 'reject-exp-1',
  });
  assert.equal(rejected.status, 'rejected');
  assert.equal(acc.approvalQueue[0].history.at(-1).comment, 'نیاز به مدرک دارد');
  assert.equal(approvalEngine.rejectItem(acc, submitted.approvalId, {
    userId: 'accountant-2', role: 'accountant', branchId: 1, comment: 'نیاز به مدرک دارد', idempotencyKey: 'reject-exp-1',
  }).idempotentReplay, true);
  assert.equal(approvalEngine.approveItem(acc, submitted.approvalId, {
    userId: 'owner-1', role: 'owner', branchId: 1,
  }).code, 'approval_already_decided');
});

test('period creation rejects invalid dates and ambiguous scopes, preserves list immutability and handles day edges', () => {
  const acc = periodState();
  assert.equal(periodService.createPeriod(acc, { name: 'وارونه', startDate: '2026-09-30', endDate: '2026-09-01' }).code, 'fiscal_period_range_invalid');
  assert.equal(periodService.createPeriod(acc, { name: 'نامعتبر', startDate: '2026-02-30', endDate: '2026-03-01' }).code, 'fiscal_period_range_invalid');
  const first = periodService.createPeriod(acc, {
    name: 'شعبه یک', startDate: '2026-08-01', endDate: '2026-08-31', branchId: 1,
    createdByUserId: 'creator-1', idempotencyKey: 'period-1',
  });
  assert.equal(first.status, 'open');
  const replay = periodService.createPeriod(acc, {
    name: 'شعبه یک', startDate: '2026-08-01', endDate: '2026-08-31', branchId: 1,
    createdByUserId: 'creator-1', idempotencyKey: 'period-1',
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(periodService.createPeriod(acc, {
    name: 'تغییر بدنه', startDate: '2026-08-02', endDate: '2026-08-31', branchId: 1, idempotencyKey: 'period-1',
  }).code, 'period_idempotency_conflict');
  assert.equal(periodService.createPeriod(acc, {
    name: 'هم‌پوشان', startDate: '2026-08-15', endDate: '2026-09-01', branchId: 1,
  }).code, 'fiscal_period_overlap');
  const second = periodService.createPeriod(acc, {
    name: 'شعبه دو', startDate: '2026-08-01', endDate: '2026-08-31', branchId: 2,
  });
  assert.equal(second.status, 'open');
  assert.equal(periodService.createPeriod(acc, {
    name: 'سراسری', startDate: '2026-08-01', endDate: '2026-08-31',
  }).code, 'fiscal_period_overlap');

  const beforeIds = acc.fiscalPeriods.map((period) => period.id);
  const listed = periodService.listPeriods(acc);
  listed[0].status = 'mutated-response';
  assert.deepEqual(acc.fiscalPeriods.map((period) => period.id), beforeIds);
  assert.notEqual(acc.fiscalPeriods[0].status, 'mutated-response');
  assert.equal(periodService.findPeriodForDate(acc, '2026-08-31T23:59:59.999Z', 1).id, first.id);
  assert.equal(periodService.assertPostingAllowed(acc, '2026-08-31T23:59:59.999Z', 1).allowed, true);
  assert.equal(periodService.assertPostingAllowed(acc, '2026-02-30', 1).code, 'fiscal_date_invalid');
  assert.equal(periodService.assertPostingAllowed(acc, '2026-08-31', 3).code, 'fiscal_period_missing');
  assert.equal(periodService.validatePeriods(acc).valid, true);
});

test('period close/reopen enforces branch scope, separation of duties, reason, history and replay', () => {
  const acc = periodState();
  const created = periodService.createPeriod(acc, {
    name: 'دوره کنترل', startDate: '2026-10-01', endDate: '2026-10-31', branchId: 1, createdByUserId: 'creator-1',
  });
  assert.equal(periodService.lockPeriod(acc, created.id, 'closer-1', 'بستن ماه', { branchId: 2 }).code, 'period_branch_access_denied');
  const closed = periodService.lockPeriod(acc, created.id, 'closer-1', 'بستن ماه', { branchId: 1, idempotencyKey: 'close-1' });
  assert.equal(closed.period.status, 'closed');
  assert.equal(acc.periodAudit.at(-1).action, 'lock');
  assert.equal(periodService.lockPeriod(acc, created.id, 'closer-1', 'بستن ماه', { branchId: 1, idempotencyKey: 'close-1' }).idempotentReplay, true);
  assert.equal(periodService.reopenPeriod(acc, created.id, 'closer-1', 'اصلاح سند', { branchId: 1 }).code, 'period_segregation_of_duties');
  assert.equal(periodService.reopenPeriod(acc, created.id, 'reviewer-1', '', { branchId: 1 }).code, 'period_reopen_reason_required');
  assert.equal(periodService.reopenPeriod(acc, created.id, 'reviewer-1', 'اصلاح سند جاافتاده', { branchId: 2 }).code, 'period_branch_access_denied');
  const reopened = periodService.reopenPeriod(acc, created.id, 'reviewer-1', 'اصلاح سند جاافتاده', { branchId: 1, idempotencyKey: 'reopen-1' });
  assert.equal(reopened.period.status, 'reopened');
  assert.equal(reopened.audit.beforeStatus, 'closed');
  assert.equal(periodService.reopenPeriod(acc, created.id, 'reviewer-1', 'اصلاح سند جاافتاده', { branchId: 1, idempotencyKey: 'reopen-1' }).idempotentReplay, true);
  assert.equal(periodService.softClosePeriod(acc, created.id, 'reviewer-1', { branchId: 1, reason: 'بازبینی اولیه', idempotencyKey: 'soft-1' }).period.status, 'soft_closed');
  assert.deepEqual(acc.periodAudit.filter((event) => event.periodId === created.id).map((event) => event.action), ['create', 'lock', 'reopen', 'soft_close']);
  assert.equal(acc.periodAudit.every((event) => /^[a-f0-9]{64}$/i.test(event.hash)), true);
  assert.equal(periodService.verifyPeriodAuditChain(acc).isTamperEvident, true);
  acc.periodAudit[2].reason = 'تغییر غیرمجاز';
  assert.equal(periodService.verifyPeriodAuditChain(acc).isIntegrityValid, false);
  acc.periodAudit[2].reason = 'اصلاح سند جاافتاده';
  assert.equal(periodService.verifyPeriodAuditChain(acc).isIntegrityValid, true);
});

test('ledger and audit chains detect material tampering while legacy unsealed rows are reported honestly', () => {
  const genesis = 'GENESIS-00000000000000000000000000000000';
  const first = journalEntry({ id: 'je-1', number: 'JE-1', date: '2026-08-31T18:30:00.000Z', branchId: 1, totalAmount: 1000 }, genesis);
  const second = journalEntry({ id: 'je-2', number: 'JE-2', date: '2026-09-01T10:00:00.000Z', branchId: 2, totalAmount: 500 }, first.hash);
  const acc = {
    accounts: [{ code: '1110', name: 'Cash' }, { code: '4110', name: 'Sales' }],
    journalEntries: [first, second], auditLogs: [],
  };
  let chain = auditEngine.verifyLedgerChain(acc);
  assert.equal(chain.isIntegrityValid, true);
  assert.equal(chain.isTamperEvident, true);
  assert.equal(chain.chainAudit.length, 2);
  first.description = 'تغییر غیرمجاز';
  chain = auditEngine.verifyLedgerChain(acc);
  assert.equal(chain.isIntegrityValid, false);
  first.description = 'سند تست';
  first.hash = auditEngine.computeJournalHash(first, genesis);
  assert.equal(auditEngine.verifyLedgerChain(acc).isIntegrityValid, true);
  const missing = { ...first, id: 'je-unsealed', hash: undefined, previousHash: genesis };
  const legacyReport = auditEngine.verifyLedgerChain({ journalEntries: [missing] });
  assert.equal(legacyReport.isIntegrityValid, true);
  assert.equal(legacyReport.isTamperEvident, false);
  assert.equal(legacyReport.unhashedCount, 1);
  const wrongPrevious = { ...first, id: 'je-wrong-prev', previousHash: 'bad', hash: auditEngine.computeJournalHash({ ...first, id: 'je-wrong-prev', previousHash: 'bad' }, genesis) };
  assert.equal(auditEngine.verifyLedgerChain({ journalEntries: [wrongPrevious] }).isIntegrityValid, false);
});

test('RBAC, official exports and audit log retention reject boundary mistakes and preserve evidence', () => {
  assert.equal(auditEngine.validateRBACPermission(undefined, 'POST_JOURNAL').allowed, false);
  assert.equal(auditEngine.validateRBACPermission('made-up-role', 'POST_JOURNAL').allowed, false);
  assert.equal(auditEngine.validateRBACPermission('admin', 'NOT_A_REAL_ACTION').allowed, false);
  assert.equal(auditEngine.validateRBACPermission('accountant', 'POST_JOURNAL').allowed, true);
  assert.equal(auditEngine.validateRBACPermission('admin', 'APPROVE_PO', { actorId: 'maker', createdById: 'maker' }).code, 'segregation_of_duties');
  assert.equal(auditEngine.validateRBACPermission('admin', 'POST_JOURNAL', { entityBranchId: 2, branchId: 1 }).code, 'branch_access_denied');

  const genesis = 'GENESIS-00000000000000000000000000000000';
  const entry = journalEntry({ id: 'je-boundary', number: 'JE-BOUNDARY', date: '2026-08-31T18:30:00.000Z', branchId: 1, totalAmount: 1000 }, genesis);
  const acc = {
    accounts: [{ code: '1110', name: 'Cash' }, { code: '4110', name: 'Sales' }], journalEntries: [entry], auditLogs: [],
  };
  assert.equal(auditEngine.generateOfficialGeneralJournal(acc, { to: '2026-08-31', branchId: 1 }).totalRows, 2);
  assert.equal(auditEngine.generateOfficialTrialBalance(acc, '2026-08-31', { branchId: 1 }).totalDebitTurnover, 1000);
  assert.throws(() => auditEngine.generateOfficialGeneralJournal(acc, { from: '2026-02-30' }), (error) => error.code === 'audit_date_invalid');
  assert.throws(() => auditEngine.generateOfficialGeneralJournal(acc, { from: '2026-09-01', to: '2026-08-01' }), (error) => error.code === 'audit_date_range_invalid');

  const auditAcc = { auditLogs: [] };
  const metadata = { reference: 'R-1', nested: { value: 1 } };
  const logged = auditEngine.recordAuditLog(auditAcc, {
    action: 'TEST', entityType: 'Control', entityId: '1', userId: 'auditor-1', branchId: 1,
    message: 'ثبت تست', metadata, idempotencyKey: 'audit-1',
  });
  assert.equal(auditEngine.verifyAuditLogChain(auditAcc).isTamperEvident, true);
  metadata.nested.value = 99;
  assert.equal(logged.metadata.nested.value, 1);
  assert.equal(auditAcc.auditLogs[0].metadata.nested.value, 1);
  assert.equal(auditEngine.recordAuditLog(auditAcc, {
    action: 'TEST', entityType: 'Control', entityId: '1', userId: 'auditor-1', branchId: 1,
    message: 'ثبت تست', metadata: { reference: 'R-1', nested: { value: 1 } }, idempotencyKey: 'audit-1',
  }).idempotentReplay, true);
  assert.throws(() => auditEngine.recordAuditLog(auditAcc, {
    action: 'TEST', entityType: 'Control', entityId: '2', userId: 'auditor-1', idempotencyKey: 'audit-1',
  }), (error) => error.code === 'audit_idempotency_conflict');
  for (let i = 0; i < 5001; i += 1) auditAcc.auditLogs.push({ id: `legacy-${i}` });
  auditEngine.recordAuditLog(auditAcc, { action: 'AFTER_CAP', entityType: 'Control', entityId: '2', userId: 'auditor-1' });
  assert.equal(auditAcc.auditLogs.length, 5003);
  const legacyAudit = auditEngine.verifyAuditLogChain({ auditLogs: [{ id: 'old-unsealed' }] });
  assert.equal(legacyAudit.valid, true);
  assert.equal(legacyAudit.isTamperEvident, false);
  assert.equal(auditEngine.get10YearComplianceReport(acc).digitalLedgerIntegrity, 'VERIFIED_TAMPER_PROOF');
});

test('approval replay re-authenticates the original actor, role, branch and payload', () => {
  const acc = approvalState();
  const submitted = approvalEngine.submitForApproval(acc, {
    type: 'expense', entityId: 'exp-replay', amount: 900000, submittedBy: 'maker', branchId: 1,
  });
  const approved = approvalEngine.approveItem(acc, submitted.approvalId, {
    userId: 'approver-a', role: 'accountant', branchId: 1, comment: 'تأیید', idempotencyKey: 'decision-replay-1',
  });
  assert.equal(approved.status, 'pending');
  assert.equal(approvalEngine.approveItem(acc, submitted.approvalId, {
    userId: 'attacker', role: 'accountant', branchId: 1, comment: 'تأیید', idempotencyKey: 'decision-replay-1',
  }).code, 'approval_replay_actor_mismatch');
  assert.equal(approvalEngine.approveItem(acc, submitted.approvalId, {
    userId: 'approver-a', role: 'accountant', branchId: 2, comment: 'تأیید', idempotencyKey: 'decision-replay-1',
  }).code, 'approval_branch_access_denied');
  assert.equal(approvalEngine.approveItem(acc, submitted.approvalId, {
    userId: 'approver-a', role: 'accountant', branchId: 1, comment: 'تغییر متن', idempotencyKey: 'decision-replay-1',
  }).code, 'approval_idempotency_conflict');
  assert.equal(approvalEngine.approveItem(acc, submitted.approvalId, {
    userId: 'approver-a', role: 'accountant', branchId: 1, comment: 'تأیید', idempotencyKey: 'decision-replay-1',
  }).idempotentReplay, true);
  assert.equal(approvalEngine.listPending(acc, { role: 'manager' }).length, 0);
  assert.equal(approvalEngine.submitForApproval(acc, {
    type: 'expense', entityId: 'unscoped', amount: 900000, submittedBy: 'maker', allowedBranchIds: [1],
  }).code, 'approval_branch_scope_required');
  assert.equal(approvalEngine.listPending(acc, { role: 'manager', allowedBranchIds: '1' }).length, 0);
});

test('period mutations enforce creator separation and reject malformed branch scopes', () => {
  const acc = periodState();
  const created = periodService.createPeriod(acc, {
    name: 'دوره SoD', startDate: '2026-11-01', endDate: '2026-11-30', branchId: 1, createdByUserId: 'creator',
  });
  assert.equal(periodService.lockPeriod(acc, created.id, 'creator', 'بستن', { branchId: 1 }).code, 'period_segregation_of_duties');
  assert.equal(periodService.softClosePeriod(acc, created.id, 'creator', { branchId: 1 }).code, 'period_segregation_of_duties');
  assert.equal(periodService.lockPeriod(acc, created.id, 'closer', 'بستن', { branchId: 1, allowedBranchIds: '1' }).code, 'period_branch_scope_invalid');
  assert.equal(periodService.assertPostingAllowed(acc, '2026-11-15', { branchId: 1, allowedBranchIds: '1' }).code, 'period_branch_scope_invalid');
  assert.equal(periodService.lockPeriod(acc, created.id, 'closer', 'بستن', { branchId: 1 }).period.status, 'closed');
});

test('audit boundary treats valid unsealed legacy rows honestly and keeps branch reports fail-closed', () => {
  const legacy = journalEntry({ id: 'legacy-no-hash', number: 'LEGACY-001', date: '2026-08-31T10:00:00.000Z', branchId: 1, totalAmount: 100 });
  legacy.hash = undefined;
  legacy.previousHash = undefined;
  const legacyResult = auditEngine.verifyLedgerChain({ journalEntries: [legacy] });
  assert.equal(legacyResult.isIntegrityValid, true);
  assert.equal(legacyResult.isTamperEvident, false);
  const badPointer = { ...legacy, previousHash: 'not-the-anchor' };
  assert.equal(auditEngine.verifyLedgerChain({ journalEntries: [badPointer] }).isIntegrityValid, false);

  const first = journalEntry({ id: 'branch-1', number: 'BR-001', date: '2026-08-24T10:00:00.000Z', branchId: 1, totalAmount: 1000 }, auditEngine.GENESIS_HASH);
  const second = journalEntry({ id: 'branch-2', number: 'BR-002', date: '2026-08-25T10:00:00.000Z', branchId: 2, totalAmount: 2000 }, first.hash);
  const lineScoped = journalEntry({
    id: 'line-branch-1', number: 'BR-003', date: '2026-08-26T10:00:00.000Z', totalAmount: 3000,
    lines: [
      { accountCode: '1110', debit: 3000, credit: 0, branchId: 1 },
      { accountCode: '4110', debit: 0, credit: 3000, branchId: 1 },
    ],
  }, second.hash);
  const unscoped = journalEntry({ id: 'unscoped', number: 'BR-004', date: '2026-08-27T10:00:00.000Z', totalAmount: 4000 }, lineScoped.hash);
  const reportAcc = {
    accounts: [{ code: '1110', name: 'Cash' }, { code: '4110', name: 'Sales' }],
    journalEntries: [first, second, lineScoped, unscoped],
  };
  const report = auditEngine.generateOfficialGeneralJournal(reportAcc, { branchId: 1 });
  assert.equal(report.totalRows, 4);
  assert.equal(report.totalDebit, 4000);
  assert.deepEqual([...new Set(report.rows.map((row) => row.journalNumber))], ['BR-001', 'BR-003']);
});

test('audit actor, malformed date and RBAC scope inputs fail closed without partial state', () => {
  const empty = {};
  assert.throws(() => auditEngine.recordAuditLog(empty, {
    action: 'TEST', entityType: 'Control', entityId: '1', message: 'بدون کاربر',
  }), (error) => error.code === 'audit_actor_required');
  assert.equal(empty.auditLogs, undefined);
  assert.equal(auditEngine.validateRBACPermission('accountant', 'POST_JOURNAL', { entityBranchId: 2 }).code, 'branch_scope_required');
  assert.equal(auditEngine.validateRBACPermission('accountant', 'POST_JOURNAL', { entityBranchId: 2, branchId: 2, allowedBranchIds: '2' }).code, 'branch_scope_invalid');
  assert.equal(auditEngine.validateRBACPermission('admin', 'APPROVE_PO', { requireIndependent: true }).code, 'segregation_identity_required');
  const invalidDate = journalEntry({ id: 'bad-date', number: 'BAD-DATE', branchId: 1, totalAmount: 100, date: '2026-02-30T10:00:00.000Z' });
  assert.ok(auditEngine.validateJournalEntry(invalidDate).errors.includes('journal_date_invalid'));
});
