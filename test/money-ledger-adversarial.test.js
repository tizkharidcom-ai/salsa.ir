'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const money = require('../server/finance/money');
const accounting = require('../server/accounting-engine');
const audit = require('../server/finance/audit-engine');

function fixture() {
  return {
    accounting: {
      fiscalPeriods: [{
        id: 'period-adversarial',
        name: 'دوره تست خصمانه',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        status: 'open',
      }],
      journalEntries: [],
    },
  };
}

function balancedInput(overrides = {}) {
  return {
    id: 'adversarial-journal-1',
    number: 'ADV-001',
    source: 'adversarial-test',
    sourceId: 'adv-source-1',
    date: '2026-08-24T10:00:00.000Z',
    description: 'سند خصمانه',
    lines: [
      { accountCode: '1110', debit: 1000, credit: 0, memo: 'دریافت' },
      { accountCode: '4110', debit: 0, credit: 1000, memo: 'فروش' },
    ],
    ...overrides,
  };
}

test('money rejects non-finite, unsafe and resource-exhausting numeric inputs', () => {
  for (const invalid of [NaN, Infinity, -Infinity, 'NaN', 'Infinity', 'not-a-number']) {
    assert.throws(() => money.toIRR(invalid), /معتبر|متناهی/);
    assert.throws(() => money.mulMoney(10, invalid), /معتبر|متناهی/);
  }

  assert.equal(money.toIRR('۲٫۵'), 2);
  assert.equal(money.toIRR('-۲٫۵'), -2);
  assert.throws(() => money.toIntegerIRR('۲٫۵'), /صحیح IRR/);
  assert.throws(() => money.toIRR('9007199254740992'), /محدوده امن/);
  assert.throws(() => money.addMoney(Number.MAX_SAFE_INTEGER, 1), /محدوده امن/);
  assert.throws(() => money.mulMoney(Number.MAX_SAFE_INTEGER, 2), /محدوده امن/);
  assert.throws(() => money.toIRR(`0.${'0'.repeat(4096)}`), /طول مجاز/);
  assert.throws(() => money.divideMoney(1, Number.MAX_SAFE_INTEGER), /سهم‌ها/);
  assert.equal(money.formatPercent(Infinity), '—');
  assert.equal(money.formatNumber(Infinity), '—');
});

test('COA validation rejects duplicate, unknown-type, broken-parent and cyclic definitions', () => {
  const valid = [
    { code: '1000', type: 'asset', isPostingAccount: false },
    { code: '1110', type: 'asset', isPostingAccount: true, parentCode: '1000' },
  ];
  assert.equal(accounting.validateChartOfAccounts(valid), true);
  assert.throws(() => accounting.validateChartOfAccounts([
    ...valid,
    { code: '1110', type: 'asset', isPostingAccount: true },
  ]), /تکراری/);
  assert.throws(() => accounting.validateChartOfAccounts([
    { code: '1000', type: 'unknown', isPostingAccount: false },
  ]), /نوع حساب/);
  assert.throws(() => accounting.validateChartOfAccounts([
    { code: '1000', type: 'asset', isPostingAccount: false },
    { code: '1110', type: 'asset', isPostingAccount: true, parentCode: '9999' },
  ]), /والد/);
  assert.throws(() => accounting.validateChartOfAccounts([
    { code: '1000', type: 'asset', isPostingAccount: false, parentCode: '1001' },
    { code: '1001', type: 'asset', isPostingAccount: false, parentCode: '1000' },
  ]), /چرخه/);
});

test('ledger rejects adversarial amounts and unbalanced entries without journal mutation', () => {
  for (const badAmount of [NaN, Infinity, -Infinity, 100.5, Number.MAX_SAFE_INTEGER + 1]) {
    const db = fixture();
    accounting.ensureAccountingData(db);
    const before = structuredClone(db.accounting.journalEntries);
    assert.throws(() => accounting.postJournalEntry(db, balancedInput({
      id: `bad-${String(badAmount)}`,
      sourceId: `bad-${String(badAmount)}`,
      lines: [
        { accountCode: '1110', debit: badAmount, credit: 0 },
        { accountCode: '4110', debit: 0, credit: 1000 },
      ],
    })), /معتبر|متناهی|صحیح|محدوده|منفی/);
    assert.deepEqual(db.accounting.journalEntries, before);
  }

  const db = fixture();
  accounting.ensureAccountingData(db);
  const before = structuredClone(db.accounting.journalEntries);
  assert.throws(() => accounting.postJournalEntry(db, balancedInput({
    id: 'unbalanced',
    sourceId: 'unbalanced',
    lines: [
      { accountCode: '1110', debit: 1001, credit: 0 },
      { accountCode: '4110', debit: 0, credit: 1000 },
    ],
  })), /تراز/);
  assert.deepEqual(db.accounting.journalEntries, before);
  assert.throws(() => accounting.postJournalEntry(db, balancedInput({
    id: 'unknown-account',
    sourceId: 'unknown-account',
    lines: [
      { accountCode: '9999', debit: 1000, credit: 0 },
      { accountCode: '4110', debit: 0, credit: 1000 },
    ],
  })), /COA/);
  assert.throws(() => accounting.postJournalEntry(db, balancedInput({
    id: 'parent-account',
    sourceId: 'parent-account',
    lines: [
      { accountCode: '1100', debit: 1000, credit: 0 },
      { accountCode: '4110', debit: 0, credit: 1000 },
    ],
  })), /والد|قابل ثبت مستقیم/);
});

test('ledger idempotency rejects every material retry change and returns defensive clones', () => {
  const db = fixture();
  accounting.ensureAccountingData(db);
  const request = balancedInput();
  const first = accounting.postJournalEntry(db, request);
  first.lines[0].debit = 999999;
  assert.equal(db.accounting.journalEntries[0].lines[0].debit, 1000);

  const replay = accounting.postJournalEntry(db, request);
  assert.equal(replay.idempotentReplay, true);
  for (const change of [
    { description: 'شرح دستکاری‌شده' },
    { number: 'ADV-999' },
    { status: 'draft' },
    { lines: [
      { accountCode: '1110', debit: 1000, credit: 0, memo: 'شرح جدید' },
      { accountCode: '4110', debit: 0, credit: 1000, memo: 'فروش' },
    ] },
  ]) {
    assert.throws(() => accounting.postJournalEntry(db, { ...request, ...change }), /قطعی|POSTED|غیرقابل/);
  }
  assert.equal(db.accounting.journalEntries.length, 1);
  assert.equal(audit.verifyLedgerChain(db.accounting).isIntegrityValid, true);
});

test('hash tampering blocks new posts, reports and reversal replays', () => {
  const db = fixture();
  accounting.ensureAccountingData(db);
  const original = accounting.postJournalEntry(db, balancedInput());
  assert.equal(audit.verifyLedgerChain(db.accounting).isIntegrityValid, true);

  db.accounting.journalEntries[0].lines[0].debit = 1001;
  assert.equal(audit.verifyLedgerChain(db.accounting).isIntegrityValid, false);
  assert.throws(() => accounting.postJournalEntry(db, balancedInput({ id: 'blocked-after-tamper', sourceId: 'blocked-after-tamper' })), /زنجیره دفترکل/);
  assert.throws(() => accounting.getBalanceSheet(db), /گزارش تراز/);

  const reversalDb = fixture();
  accounting.ensureAccountingData(reversalDb);
  const posted = accounting.postJournalEntry(reversalDb, balancedInput());
  const reversed = accounting.reverseJournalEntry(reversalDb, posted.id, { userId: 'owner-1', reason: 'تست' });
  reversalDb.accounting.journalEntries.find((entry) => entry.id === reversed.reversalEntry.id).lines[0].debit = 777;
  assert.throws(() => accounting.reverseJournalEntry(reversalDb, posted.id), /زنجیره دفترکل معتبر نیست/);
});

test('a malformed ledger cannot be reported as balanced, while a valid ledger is exactly balanced', () => {
  const validDb = fixture();
  accounting.ensureAccountingData(validDb);
  accounting.postJournalEntry(validDb, balancedInput());
  assert.equal(accounting.getBalanceSheet(validDb).isBalanced, true);

  const malformedDb = fixture();
  accounting.ensureAccountingData(malformedDb);
  const entry = {
    id: 'malformed-report',
    number: 'ADV-REPORT',
    date: '2026-08-24T10:00:00.000Z',
    description: 'تراز ناسازگار',
    source: 'adversarial-test',
    sourceId: 'malformed-report',
    status: 'posted',
    totalAmount: 1000,
    previousHash: audit.GENESIS_HASH,
    lines: [
      { accountCode: '1110', debit: 1000, credit: 0 },
      { accountCode: '4110', debit: 0, credit: 901 },
    ],
  };
  entry.hash = audit.computeJournalHash(entry, audit.GENESIS_HASH);
  malformedDb.accounting.journalEntries.push(entry);
  assert.throws(() => accounting.getBalanceSheet(malformedDb), /گزارش تراز/);
});
