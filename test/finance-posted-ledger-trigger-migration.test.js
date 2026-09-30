'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(__dirname, '..', 'server', 'migrations', '023_posted_ledger_full_immutability.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');

test('posted journal headers allow only an exact replay or safe draft finalization', () => {
  assert.match(migration, /^\s*BEGIN\s*;/i);
  assert.match(migration, /COMMIT\s*;\s*$/i);
  assert.match(migration, /CREATE OR REPLACE FUNCTION finance_guard_posted_immutable\(\)/);
  assert.match(migration, /OLD IS NOT DISTINCT FROM NEW/);
  assert.match(migration, /OLD\.status IN \('posted','reversed'\)[\s\S]*?posted_journal_is_immutable_use_reversal/);
  assert.match(migration, /OLD\.status NOT IN \('draft','pending_approval'\)/);

  for (const field of [
    'id', 'number', 'finance_event_id', 'source', 'source_id', 'entry_at',
    'description', 'debit_irr', 'credit_irr', 'branch_id', 'reversal_of_id',
    'created_by', 'created_at',
  ]) {
    assert.match(migration, new RegExp(`OLD\\.${field}`), `header finalization pins ${field}`);
    assert.match(migration, new RegExp(`NEW\\.${field}`), `header finalization pins ${field}`);
  }
});

test('posted journal lines reject insert/update/delete and cannot move between parents', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION finance_guard_posted_lines_immutable\(\)/);
  assert.match(migration, /OLD\.journal_entry_id IS DISTINCT FROM NEW\.journal_entry_id/);
  assert.match(migration, /journal_line_parent_is_immutable/);
  assert.match(migration, /existing_line BOOLEAN := FALSE/);
  assert.match(migration, /IF TG_OP = 'INSERT' AND existing_line AND same_line THEN\s+RETURN NEW/s,
    'only a byte-for-byte equivalent persisted line may replay into a posted journal');
  assert.match(migration, /WHERE id = target_id\s+FOR UPDATE/);
  assert.match(migration, /target_status IN \('posted','reversed'\)[\s\S]*?posted_journal_lines_are_immutable_use_reversal/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE ON journal_lines_v2/);
  for (const field of [
    'line_no', 'account_code', 'debit_irr', 'credit_irr', 'branch_id', 'cost_center',
    'counterparty_id', 'payment_method', 'item_id', 'recipe_version_id', 'memo',
  ]) {
    assert.match(migration, new RegExp(`${field}[\\s\\S]*?NEW\\.${field}`), `line replay compares ${field}`);
  }
});
