'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const money = require('../server/finance/money');
const audit = require('../server/finance/audit-engine');
const accounting = require('../server/accounting-engine');

function fixture() {
  return {
    accounting: {
      fiscalPeriods: [{
        id: 'period-1', name: 'دوره آزمون', startDate: '2026-08-01', endDate: '2026-08-31', status: 'open',
      }],
      journalEntries: [],
    },
  };
}

function balancedInput(overrides = {}) {
  return {
    id: 'journal-1',
    number: 'TEST-001',
    source: 'test',
    sourceId: 'source-1',
    date: '2026-08-24T10:00:00.000Z',
    description: 'سند آزمون',
    lines: [
      { accountCode: '1110', debit: 1000, credit: 0, memo: 'دریافت' },
      { accountCode: '4110', debit: 0, credit: 1000, memo: 'فروش' },
    ],
    ...overrides,
  };
}

test('money contract is exact, finite, safe and uses symmetric half-even rounding', () => {
  assert.equal(money.toIRR('۱۲۳٬۴۵۶'), 123456);
  assert.equal(money.toIRR(1.5), 2);
  assert.equal(money.toIRR(2.5), 2);
  assert.equal(money.toIRR(-1.5), -2);
  assert.equal(money.toIRR(-2.5), -2);
  assert.equal(money.toIRR(123, 'toman'), 1230);
  assert.equal(money.tomanToIRR('۱۲۳'), 1230);
  assert.throws(() => money.toIntegerIRR(1.5), /صحیح IRR/);
  assert.equal(money.toIntegerIRR('۱۰۰٫۰'), 100);
  assert.equal(money.irrToToman(25), 2);
  assert.equal(money.addMoney(4, '۵'), 9);
  assert.equal(money.subMoney(4, 9), -5);
  assert.equal(money.mulMoneyRatio(25, 0.1), 2);
  assert.deepEqual(money.divideMoney(-5, 2), [-2, -3]);

  for (const invalid of [NaN, Infinity, -Infinity, 'NaN', 'not-a-money']) {
    assert.throws(() => money.toIRR(invalid), /معتبر|متناهی/);
  }
  assert.throws(() => money.toIRR(Number.MAX_SAFE_INTEGER + 1), /محدوده امن/);
  assert.throws(() => money.addMoney(Number.MAX_SAFE_INTEGER, 1), /محدوده امن/);
  assert.throws(() => money.mulMoney(Number.MAX_SAFE_INTEGER, 2), /محدوده امن/);
  assert.throws(() => money.divideMoney(100, 0), /صحیح مثبت/);
  assert.throws(() => money.toIRR(1, 'bitcoin'), /واحد مبلغ نامعتبر/);
});

test('ledger posting validates integer amounts, balance, posting accounts and immutable replay', () => {
  const db = fixture();
  accounting.ensureAccountingData(db);
  const request = balancedInput();
  const requestLines = JSON.parse(JSON.stringify(request.lines));
  const posted = accounting.postJournalEntry(db, request);

  request.lines[0].debit = 999999;
  posted.lines[0].debit = 888888;
  assert.equal(db.accounting.journalEntries[0].lines[0].debit, 1000);
  assert.equal(db.accounting.journalEntries.length, 1);

  const replay = accounting.postJournalEntry(db, { ...request, lines: requestLines });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(db.accounting.journalEntries.length, 1);

  assert.throws(() => accounting.postJournalEntry(db, {
    ...balancedInput({ description: 'تغییر غیرمجاز' }), lines: [
      { accountCode: '1110', debit: 2000, credit: 0 },
      { accountCode: '4110', debit: 0, credit: 2000 },
    ],
  }), /قطعی|POSTED/);
  assert.throws(() => accounting.postJournalEntry(db, {
    ...balancedInput({ allowForceUpdate: true }), lines: [
      { accountCode: '1110', debit: 2000, credit: 0 },
      { accountCode: '4110', debit: 0, credit: 2000 },
    ],
  }), /قطعی|POSTED/);
  assert.throws(() => accounting.postJournalEntry(db, {
    ...balancedInput({ status: 'unknown' }),
  }), /draft یا posted/);
  assert.throws(() => accounting.postJournalEntry(db, balancedInput({
    id: 'fractional', sourceId: 'fractional', lines: [
      { accountCode: '1110', debit: 100.5, credit: 0 },
      { accountCode: '4110', debit: 0, credit: 100.5 },
    ],
  })), /صحیح IRR/);
  assert.throws(() => accounting.postJournalEntry(db, {
    ...balancedInput({ lines: [
      { accountCode: '1100', debit: 1000, credit: 0 },
      { accountCode: '4110', debit: 0, credit: 1000 },
    ] }),
  }), /والد|قابل ثبت مستقیم/);
});

test('ledger rejects NaN, infinity, negative and overflowing amounts without partial mutation', () => {
  for (const badAmount of [NaN, Infinity, -Infinity, -1]) {
    const db = fixture();
    accounting.ensureAccountingData(db);
    const before = JSON.stringify(db.accounting.journalEntries);
    assert.throws(() => accounting.postJournalEntry(db, balancedInput({
      id: `bad-${String(badAmount)}`,
      sourceId: `bad-${String(badAmount)}`,
      lines: [
        { accountCode: '1110', debit: badAmount, credit: 0 },
        { accountCode: '4110', debit: 0, credit: 1000 },
      ],
    })), /متناهی|منفی/);
    assert.equal(JSON.stringify(db.accounting.journalEntries), before);
  }

  const db = fixture();
  accounting.ensureAccountingData(db);
  const before = JSON.stringify(db.accounting.journalEntries);
  assert.throws(() => accounting.postJournalEntry(db, balancedInput({
    id: 'overflow', sourceId: 'overflow', lines: [
      { accountCode: '1110', debit: Number.MAX_SAFE_INTEGER, credit: 0 },
      { accountCode: '1120', debit: Number.MAX_SAFE_INTEGER, credit: 0 },
      { accountCode: '4110', debit: 0, credit: Number.MAX_SAFE_INTEGER },
      { accountCode: '4120', debit: 0, credit: Number.MAX_SAFE_INTEGER },
    ],
  })), /محدوده امن/);
  assert.equal(JSON.stringify(db.accounting.journalEntries), before);
});

test('draft promotion is explicit and non-tail drafts cannot rewrite the hash chain', () => {
  const db = fixture();
  accounting.ensureAccountingData(db);
  const draft = accounting.postJournalEntry(db, balancedInput({
    id: 'draft-1', number: 'DRAFT-001', sourceId: 'draft-source', status: 'draft',
  }));
  assert.equal(draft.status, 'draft');
  const promoted = accounting.postJournalEntry(db, balancedInput({
    id: 'draft-1', number: 'DRAFT-001', sourceId: 'draft-source', status: 'posted',
  }));
  assert.equal(promoted.status, 'posted');
  assert.equal(db.accounting.journalEntries.length, 1);

  const nonTailDraft = accounting.postJournalEntry(db, balancedInput({
    id: 'draft-2', number: 'DRAFT-002', sourceId: 'draft-source-2', status: 'draft',
  }));
  accounting.postJournalEntry(db, balancedInput({
    id: 'posted-2', number: 'POSTED-002', sourceId: 'posted-source-2',
  }));
  assert.equal(nonTailDraft.status, 'draft');
  assert.throws(() => accounting.postJournalEntry(db, balancedInput({
    id: 'draft-2', number: 'DRAFT-002', sourceId: 'draft-source-2', status: 'posted',
  })), /غیرانتهایی/);
  assert.equal(db.accounting.journalEntries[1].status, 'draft');
  assert.equal(audit.verifyLedgerChain(db.accounting).isIntegrityValid, true);
});

test('reversal is balanced, immutable, idempotent and limited to posted originals', () => {
  const db = fixture();
  accounting.ensureAccountingData(db);
  const original = accounting.postJournalEntry(db, balancedInput());
  const reversed = accounting.reverseJournalEntry(db, original.id, { userId: 'owner-1', reason: 'اصلاح آزمون' });
  assert.equal(reversed.idempotentReplay, false);
  assert.equal(reversed.originalEntry.status, 'reversed');
  assert.deepEqual(reversed.reversalEntry.lines.map((line) => [line.debit, line.credit]), [[0, 1000], [1000, 0]]);
  assert.equal(db.accounting.journalEntries.length, 2);

  const replay = accounting.reverseJournalEntry(db, original.id, { userId: 'owner-1', reason: 'تلاش تکراری' });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(db.accounting.journalEntries.length, 2);
  assert.equal(audit.verifyLedgerChain(db.accounting).isIntegrityValid, true);
  assert.throws(() => accounting.reverseJournalEntry(db, reversed.reversalEntry.id), /معکوس‌سازی مجدد/);

  const draftDb = fixture();
  accounting.ensureAccountingData(draftDb);
  const draft = accounting.postJournalEntry(draftDb, balancedInput({ id: 'draft', sourceId: 'draft', status: 'draft' }));
  assert.throws(() => accounting.reverseJournalEntry(draftDb, draft.id), /فقط سند posted/);
});

test('audit chain rejects missing or broken links and malformed journal amounts', () => {
  const entry = {
    id: 'audit-1', number: 'AUD-001', date: '2026-08-24T10:00:00.000Z', status: 'posted', totalAmount: 100,
    previousHash: audit.GENESIS_HASH,
    lines: [
      { accountCode: '1110', debit: 100, credit: 0 },
      { accountCode: '4110', debit: 0, credit: 100 },
    ],
  };
  entry.hash = audit.computeJournalHash(entry, audit.GENESIS_HASH);
  const valid = audit.verifyLedgerChain({
    accounts: [{ code: '1110' }, { code: '4110' }], journalEntries: [entry],
  });
  assert.equal(valid.isIntegrityValid, true);
  assert.deepEqual(valid.chainAudit[0].errors, []);

  const missingHash = audit.verifyLedgerChain({
    accounts: [{ code: '1110' }, { code: '4110' }], journalEntries: [{ ...entry, hash: undefined }],
  });
  assert.equal(missingHash.isIntegrityValid, true);
  assert.equal(missingHash.isTamperEvident, false);
  assert.ok(missingHash.chainAudit[0].errors.includes('journal_hash_missing'));

  const brokenLink = audit.verifyLedgerChain({
    accounts: [{ code: '1110' }, { code: '4110' }], journalEntries: [{ ...entry, previousHash: 'tampered' }],
  });
  assert.equal(brokenLink.isIntegrityValid, false);
  assert.ok(brokenLink.chainAudit[0].errors.includes('journal_previous_hash_mismatch'));

  const malformed = audit.validateJournalEntry({
    ...entry,
    totalAmount: NaN,
    lines: [
      { accountCode: '1110', debit: NaN, credit: 0 },
      { accountCode: '4110', debit: 0, credit: -100 },
    ],
  }, [{ code: '1110' }, { code: '4110' }]);
  assert.equal(malformed.valid, false);
  assert.ok(malformed.errors.includes('journal_total_unsafe'));
  assert.ok(malformed.errors.includes('journal_line_1_amount_unsafe'));
  assert.ok(malformed.errors.includes('journal_line_2_credit_negative'));
});

test('posting after a legacy or unsealed tail continues from its calculated predecessor hash', () => {
  const db = fixture();
  accounting.ensureAccountingData(db);
  const first = accounting.postJournalEntry(db, balancedInput({ id: 'legacy-tail-1', number: 'LEGACY-001', sourceId: 'legacy-tail-1' }));
  db.accounting.journalEntries[0].hash = undefined;
  const before = audit.verifyLedgerChain(db.accounting);
  assert.equal(before.isIntegrityValid, true);
  assert.equal(before.isTamperEvident, false);

  const second = accounting.postJournalEntry(db, balancedInput({ id: 'legacy-tail-2', number: 'LEGACY-002', sourceId: 'legacy-tail-2' }));
  assert.equal(second.previousHash, before.chainAudit[0].calculatedHash);
  const after = audit.verifyLedgerChain(db.accounting);
  assert.equal(after.isIntegrityValid, true);
  assert.equal(after.chainAudit[1].previousHashValid, true);
  assert.equal(db.accounting.journalEntries[0].hash, undefined);
});

test('official reports refuse a structurally or cryptographically untrusted ledger', () => {
  const entry = {
    id: 'report-1', number: 'REP-001', date: '2026-08-24T10:00:00.000Z', status: 'posted', totalAmount: 100,
    previousHash: audit.GENESIS_HASH,
    lines: [
      { accountCode: '1110', debit: 100, credit: 0 },
      { accountCode: '4110', debit: 0, credit: 100 },
    ],
  };
  entry.hash = audit.computeJournalHash(entry, audit.GENESIS_HASH);
  const acc = { accounts: [{ code: '1110' }, { code: '4110' }], journalEntries: [entry] };
  assert.equal(audit.generateOfficialGeneralJournal(acc).isBalanced, true);
  acc.journalEntries[0].lines[0].debit = 101;
  assert.throws(() => audit.generateOfficialGeneralJournal(acc), /زنجیره دفترکل معتبر نیست/);
});
