'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { autoMatchBankFeed, importBankFeed } = require('../server/finance/reconciliation-engine');

function bankTxn(id, branchId) {
  return {
    id, branchId, status: 'unmatched', date: '2026-09-20T10:00:00.000Z',
    debit: 25_000, credit: 0, bankAccountId: '1210',
  };
}

function journal(id, branchId, lineBranchId = branchId) {
  return {
    id, number: id, branchId, status: 'posted', date: '2026-09-20T10:00:00.000Z',
    lines: [{ accountCode: '1210', debit: 25_000, credit: 0, branchId: lineBranchId }],
  };
}

test('global bank auto-match never crosses branch even when amount and date are identical', () => {
  const acc = {
    bankTransactions: [bankTxn('bank-branch-1', 1), bankTxn('bank-branch-2', 2)],
    journalEntries: [journal('journal-branch-2', 2), journal('journal-branch-1', 1)],
  };

  const result = autoMatchBankFeed(acc);

  assert.equal(result.matchedCount, 2);
  assert.equal(acc.bankTransactions[0].matchedJournalId, 'journal-branch-1');
  assert.equal(acc.bankTransactions[1].matchedJournalId, 'journal-branch-2');
});

test('scoped auto-match leaves other branches untouched and reports only the scoped unmatched count', () => {
  const acc = {
    bankTransactions: [bankTxn('bank-branch-1', 1), bankTxn('bank-branch-2', 2)],
    journalEntries: [journal('journal-branch-1', 1)],
  };

  const result = autoMatchBankFeed(acc, 1);

  assert.equal(result.matchedCount, 1);
  assert.equal(result.remainingUnmatched, 0);
  assert.equal(acc.bankTransactions[0].matchedJournalId, 'journal-branch-1');
  assert.equal(acc.bankTransactions[1].status, 'unmatched');
});

test('auto-match rejects ambiguous journal branch evidence instead of guessing', () => {
  const acc = {
    bankTransactions: [bankTxn('bank-branch-1', 1)],
    journalEntries: [{
      ...journal('journal-mixed', 1),
      lines: [
        { accountCode: '1210', debit: 25_000, credit: 0, branchId: 1 },
        { accountCode: '1320', debit: 0, credit: 25_000, branchId: 2 },
      ],
    }],
  };

  const result = autoMatchBankFeed(acc);

  assert.equal(result.matchedCount, 0);
  assert.equal(result.remainingUnmatched, 1);
  assert.equal(acc.bankTransactions[0].status, 'unmatched');
});

test('auto-match leaves branchless evidence and non-unique candidates for human review', () => {
  const acc = {
    bankTransactions: [
      bankTxn('branchless-bank', null),
      bankTxn('ambiguous-bank', 1),
      { ...bankTxn('invalid-bank', 1), debit: 25_000, credit: 1 },
    ],
    journalEntries: [
      journal('branchless-journal', null, null),
      journal('ambiguous-journal-1', 1),
      journal('ambiguous-journal-2', 1),
      journal('invalid-bank-candidate', 1),
    ],
  };

  const result = autoMatchBankFeed(acc);

  assert.equal(result.matchedCount, 0);
  assert.equal(result.remainingUnmatched, 3);
  assert.ok(acc.bankTransactions.every((row) => row.status === 'unmatched'));
});

test('bank-feed replay deduplication is scoped to branch and bank account', () => {
  const acc = { bankTransactions: [] };
  const result = importBankFeed(acc, [
    { id: 'feed-1', reference: 'shared-ref', branchId: 1, bankAccountId: '1210', debit: 10_000 },
    { id: 'feed-2', reference: 'shared-ref', branchId: 2, bankAccountId: '1210', debit: 10_000 },
    { id: 'feed-3', reference: 'shared-ref', branchId: 1, bankAccountId: '1220', debit: 10_000 },
    { id: 'feed-4', reference: 'shared-ref', branchId: 1, bankAccountId: '1210', debit: 10_000 },
  ]);

  assert.equal(result.importedCount, 3);
  assert.deepEqual(acc.bankTransactions.map((row) => [row.branchId, row.bankAccountId]), [
    [1, '1210'],
    [2, '1210'],
    [1, '1220'],
  ]);
});
