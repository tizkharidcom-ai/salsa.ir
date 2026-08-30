'use strict';

const crypto = require('node:crypto');
const { Pool } = require('pg');
const { createPostgresStateStore } = require('../server/postgres-state');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  process.stderr.write('DATABASE_URL is required. Concurrency verification was not attempted.\n');
  process.exitCode = 2;
} else if (process.env.FINANCE_CONCURRENCY_DISPOSABLE !== 'true') {
  process.stderr.write('FINANCE_CONCURRENCY_DISPOSABLE=true is required because this verifier performs concurrent writes. Use only a disposable PostgreSQL database.\n');
  process.exitCode = 2;
} else {
  const pool = new Pool({ connectionString, ssl: process.env.DATABASE_SSL === 'false' ? false : undefined, max: 12 });
  const tag = `f2c-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const attempts = 8;
  const created = { eventSources: [], settlementPsp: `verify-${tag}`, periodName: `VERIFY ${tag}`, archivePrefix: `VERIFY-${tag}` };
  let originalStateRow = null;
  let stateTablePresent = false;
  let stateTableTouched = false;

  async function cleanup() {
    await pool.query('DELETE FROM finance_legacy_archive WHERE source_id LIKE $1', [`${created.archivePrefix}%`]);
    await pool.query('DELETE FROM finance_approvals WHERE id = $1', [created.backfillApprovalId]);
    await pool.query('DELETE FROM journal_entries_v2 WHERE id = $1', [created.backfillJournalId]);
    await pool.query('DELETE FROM reconciliation_items WHERE psp = $1', [created.settlementPsp]);
    await pool.query('DELETE FROM finance_events WHERE source = ANY($1::text[])', [created.eventSources]);
    await pool.query('DELETE FROM fiscal_periods_v2 WHERE name LIKE $1', [`${created.periodName}%`]);
    if (stateTablePresent && originalStateRow) {
      await pool.query(`UPDATE westo_state SET data=$1::jsonb, summary=$2::jsonb, version=$3, updated_at=$4 WHERE id=1`, [
        originalStateRow.data, originalStateRow.summary, originalStateRow.version, originalStateRow.updated_at,
      ]);
    } else if (stateTableTouched) {
      await pool.query('DELETE FROM westo_state WHERE id = 1');
    }
  }

  async function race(label, query, acceptedConflictCodes) {
    const results = await Promise.all(Array.from({ length: attempts }, async (_, index) => {
      try {
        await query(index);
        return { ok: true };
      } catch (error) {
        if (acceptedConflictCodes.includes(error.code)) return { ok: false, conflict: error.code };
        throw error;
      }
    }));
    const success = results.filter((row) => row.ok).length;
    const conflicts = results.filter((row) => !row.ok).length;
    if (success !== 1 || conflicts !== attempts - 1) {
      const error = new Error(`${label} expected one success and ${attempts - 1} conflicts; got ${success}/${conflicts}`);
      error.code = 'finance_concurrency_verification_failed';
      throw error;
    }
    return { success, conflicts, conflictCodes: [...new Set(results.filter((row) => row.conflict).map((row) => row.conflict))] };
  }

  (async () => {
    const stateRelation = await pool.query("SELECT to_regclass('public.westo_state') AS westo_state");
    stateTablePresent = Boolean(stateRelation.rows?.[0]?.westo_state);
    if (stateTablePresent) {
      const originalState = await pool.query('SELECT data,summary,version,updated_at FROM westo_state WHERE id=1');
      originalStateRow = originalState.rows[0] || null;
    }
    const branch = await pool.query('SELECT id FROM unified_branches WHERE id = 1');
    if (!branch.rowCount) throw Object.assign(new Error('Disposable database must contain unified_branches.id=1.'), { code: 'verification_branch_missing' });

    const idempotencySource = `verify.idempotency.${tag}`;
    created.eventSources.push(idempotencySource);
    const idempotency = await race('finance event idempotency key', (index) => pool.query(
      `INSERT INTO finance_events(id,source,source_id,source_version,idempotency_key,branch_id,occurred_at,amount_irr,payload,status)
       VALUES($1,$2,$3,1,$4,1,now(),100,'{}'::jsonb,'pending')`,
      [crypto.randomUUID(), idempotencySource, `source-${index}`, `idem-${tag}`],
    ), ['23505']);

    const sourceVersionSource = `verify.source-version.${tag}`;
    created.eventSources.push(sourceVersionSource);
    const sourceVersion = await race('finance event source/version', (index) => pool.query(
      `INSERT INTO finance_events(id,source,source_id,source_version,idempotency_key,branch_id,occurred_at,amount_irr,payload,status)
       VALUES($1,$2,$3,1,$4,1,now(),100,'{}'::jsonb,'pending')`,
      [crypto.randomUUID(), sourceVersionSource, `same-${tag}`, `source-version-${tag}-${index}`],
    ), ['23505']);

    const settlementBatch = await race('settlement PSP/terminal/batch', () => pool.query(
      `INSERT INTO reconciliation_items(id,kind,branch_id,amount_irr,status,psp,terminal_id,batch_no,details)
       VALUES($1,'settlement',1,100,'unmatched',$2,'TERM-1','BATCH-1','{}'::jsonb)`,
      [crypto.randomUUID(), created.settlementPsp],
    ), ['23505']);

    const periodStart = '2199-01-01';
    const periodEnd = '2199-01-31';
    const fiscalOverlap = await race('fiscal period overlap', (index) => pool.query(
      `INSERT INTO fiscal_periods_v2(id,name,starts_on,ends_on,status)
       VALUES($1,$2,$3,$4,'open')`,
      [crypto.randomUUID(), `${created.periodName} ${index}`, periodStart, periodEnd],
    ), ['23P01']);

    const backfillJournalId = crypto.randomUUID();
    const backfillApprovalId = crypto.randomUUID();
    created.backfillJournalId = backfillJournalId;
    created.backfillApprovalId = backfillApprovalId;
    await pool.query(
      `INSERT INTO journal_entries_v2(id,number,source,source_id,entry_at,description,status,debit_irr,credit_irr,branch_id,created_by)
       VALUES($1,$2,'legacy_backfill.order_paid',$3,now(),'Concurrency verification','pending_approval',100,100,1,'accountant-verification')`,
      [backfillJournalId, `VERIFY-${tag}`, tag],
    );
    await pool.query(
      `INSERT INTO finance_approvals(id,operation,entity_type,entity_id,amount_irr,status,created_by)
       VALUES($1,'post_legacy_order_backfill','journal_entry',$2,100,'pending','accountant-verification')`,
      [backfillApprovalId, backfillJournalId],
    );
    const legacyBackfillRequest = await race('legacy backfill journal link', (index) => pool.query(
      `INSERT INTO finance_legacy_archive(
        id,source_table,source_id,trust_status,reason,source_payload,branch_id,amount_irr,decision,
        decision_notes,evidence_reference,decision_history,reviewed_tenders,backfill_status,
        backfill_journal_entry_id,backfill_approval_id,backfill_requested_by,backfill_requested_at,archived_by)
       VALUES($1,'orders',$2,'verified','verified_tender','{}'::jsonb,1,100,'approved_for_backfill',
        'verified','VERIFY-EVIDENCE','[]'::jsonb,'[]'::jsonb,'pending_approval',$3,$4,'accountant-verification',now(),'accountant-verification')`,
      [crypto.randomUUID(), `${created.archivePrefix}-${index}`, backfillJournalId, backfillApprovalId],
    ), ['23505']);

    const stateLogger = { info() {}, warn() {} };
    const firstStateStore = createPostgresStateStore({ connectionString, required: true, logger: stateLogger });
    const secondStateStore = createPostgresStateStore({ connectionString, required: true, logger: stateLogger });
    const baseState = { menuItems: [], orders: [], reservations: [], users: [], financeV2: {} };
    await firstStateStore.hydrate(baseState);
    stateTableTouched = true;
    await secondStateStore.hydrate(baseState);
    await firstStateStore.write({ ...baseState, orders: [{ id: 1, orderNo: `VERIFY-${tag}` }] });
    let stateConflict = null;
    try {
      await secondStateStore.write({ ...baseState, orders: [{ id: 2, orderNo: `STALE-${tag}` }] });
    } catch (error) {
      stateConflict = error.code;
    }
    if (stateConflict !== 'postgres_state_write_conflict') {
      throw Object.assign(new Error(`Expected postgres_state_write_conflict, received ${stateConflict || 'success'}.`), { code: 'state_cas_verification_failed' });
    }
    const persistedState = await pool.query('SELECT data, version FROM westo_state WHERE id = 1');
    const stateCompareAndSwap = {
      winnerOrderId: persistedState.rows[0]?.data?.orders?.[0]?.id || null,
      version: Number(persistedState.rows[0]?.version),
      staleWriter: stateConflict,
    };
    await firstStateStore.close();
    await secondStateStore.close();

    process.stdout.write(`${JSON.stringify({ ok: true, tag, attempts, idempotency, sourceVersion, settlementBatch, fiscalOverlap, legacyBackfillRequest, stateCompareAndSwap }, null, 2)}\n`);

  })().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }).finally(async () => {
    try {
      await cleanup();
    } catch (error) {
      process.stderr.write(`Cleanup failed: ${error.stack || error.message}\n`);
      process.exitCode = 1;
    }
    await pool.end();
  });
}
