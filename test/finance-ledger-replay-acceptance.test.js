'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const financeV2 = require('../server/finance-v2');
const { syncFinanceState } = require('../server/finance-postgres-repository');

function fixture() {
  return {
    financeV2: {
      fiscalPeriods: [{
        id: 'open-branch-4', branchId: 4,
        startDate: '2026-01-01', endDate: '2026-12-31', status: 'open',
      }],
      journalEntries: [],
    },
  };
}

function eventFixture() {
  return {
    id: 'event-acceptance-1', source: 'test.posting', sourceId: 'fixture-1',
    branchId: 4, occurredAt: '2026-09-20T10:00:00.000Z',
    status: 'pending', journalEntryId: null,
  };
}

function postingLines(secondBranchId = 4) {
  return [
    { accountCode: '1110', debitIrr: 100, creditIrr: 0, branchId: 4, costCenter: 'branch:4' },
    { accountCode: '4110', debitIrr: 0, creditIrr: 100, branchId: secondBranchId, costCenter: `branch:${secondBranchId}` },
  ];
}

test('a balanced posting cannot assign a journal line to a branch other than its event', () => {
  const db = fixture();
  const event = eventFixture();

  assert.throws(() => financeV2.__test.postEventJournal(
    db, event, postingLines(5), 'acceptance posting', 'finance-test',
  ), { code: 'journal_line_branch_mismatch', status: 409 });

  assert.equal(db.financeV2.journalEntries.length, 0);
  assert.equal(event.status, 'pending');
  assert.equal(event.journalEntryId, null);
});

test('a valid balanced posting replays the same journal without creating another entry', () => {
  const db = fixture();
  const event = eventFixture();
  const lines = postingLines();

  const first = financeV2.__test.postEventJournal(db, event, lines, 'acceptance posting', 'finance-test');
  const replay = financeV2.__test.postEventJournal(db, event, lines, 'acceptance posting', 'finance-test');

  assert.equal(first.status, 'posted');
  assert.equal(first.branchId, 4);
  assert.deepEqual(first.lines.map((line) => line.branchId), [4, 4]);
  assert.equal(replay.id, first.id);
  assert.equal(db.financeV2.journalEntries.length, 1);
  assert.throws(() => financeV2.__test.postEventJournal(
    db, event, postingLines(5), 'acceptance posting', 'finance-test',
  ), { code: 'journal_line_branch_mismatch', status: 409 });
  assert.equal(db.financeV2.journalEntries.length, 1);
});

function approvalFixture(overrides = {}) {
  return {
    id: 'refund-approval-1', operation: 'approve_customer_refund',
    entityType: 'finance_refund', entityId: 'refund-1', amountIrr: 2500,
    status: 'approved', createdBy: 'cashier-1', createdAt: '2026-09-20T10:00:00.000Z',
    decidedBy: 'manager-1', decidedAt: '2026-09-20T10:05:00.000Z',
    history: [
      { action: 'submitted', by: 'cashier-1', at: '2026-09-20T10:00:00.000Z' },
      { action: 'approved', by: 'manager-1', at: '2026-09-20T10:05:00.000Z' },
    ],
    ...overrides,
  };
}

async function captureApprovalSync(result) {
  const statements = [];
  const client = {
    async query(sql, values) {
      statements.push({ sql, values });
      if (sql.includes('information_schema.columns')) return { rows: [{ count: 0 }], rowCount: 1 };
      if (sql.includes('INSERT INTO finance_approvals')) return result;
      return { rows: [], rowCount: 1 };
    },
  };
  await syncFinanceState(client, { approvals: [approvalFixture()] }, { checkSchema: false });
  return statements.find((statement) => statement.sql.includes('INSERT INTO finance_approvals'));
}

test('PostgreSQL approval replay binds immutable refund identity and only allows pending-to-final transitions', async () => {
  const statement = await captureApprovalSync({ rows: [{ id: 'refund-approval-1' }], rowCount: 1 });
  assert.ok(statement, 'approval upsert should be issued');
  for (const field of ['operation', 'entity_type', 'entity_id', 'amount_irr', 'created_by', 'created_at']) {
    assert.match(statement.sql, new RegExp(`finance_approvals\\.${field} IS NOT DISTINCT FROM EXCLUDED\\.${field}`));
  }
  assert.match(statement.sql, /finance_approvals\.status\s*=\s*'pending'/);
  assert.match(statement.sql, /EXCLUDED\.status IN \('approved','rejected','cancelled'\)/);
  assert.match(statement.sql, /finance_approvals\.history IS NOT DISTINCT FROM EXCLUDED\.history/);
  assert.match(statement.sql, /RETURNING id/);
});

test('PostgreSQL approval replay fails closed when an existing approval identity conflicts', async () => {
  const statements = [];
  const client = {
    async query(sql, values) {
      statements.push({ sql, values });
      if (sql.includes('information_schema.columns')) return { rows: [{ count: 0 }], rowCount: 1 };
      if (sql.includes('INSERT INTO finance_approvals')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    },
  };

  await assert.rejects(
    syncFinanceState(client, { approvals: [approvalFixture()] }, { checkSchema: false }),
    { code: 'postgres_finance_immutable_conflict', entity: 'approval', sourceId: 'refund-approval-1' },
  );
  assert.equal(statements.filter((statement) => statement.sql.includes('INSERT INTO finance_approvals')).length, 1);
});
