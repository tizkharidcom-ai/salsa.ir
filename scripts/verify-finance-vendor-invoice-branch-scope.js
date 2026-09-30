#!/usr/bin/env node
'use strict';

/*
 * Transaction-only verifier for migration 022.  It creates no durable
 * fixtures: the complete transaction, including two temporary branches, is
 * rolled back before the connection is released.  This verifies both invoice
 * journal references and the parent-journal retag guard on PostgreSQL itself.
 *
 * Run only against an isolated/disposable target:
 * FINANCE_VENDOR_INVOICE_SCOPE_DISPOSABLE=true node --env-file=.env.local \
 *   scripts/verify-finance-vendor-invoice-branch-scope.js
 */
const crypto = require('node:crypto');
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  process.stderr.write('DATABASE_URL is required. Vendor-invoice verification was not attempted.\n');
  process.exitCode = 2;
} else if (process.env.FINANCE_VENDOR_INVOICE_SCOPE_DISPOSABLE !== 'true') {
  process.stderr.write('FINANCE_VENDOR_INVOICE_SCOPE_DISPOSABLE=true is required because this verifier uses transaction fixtures.\n');
  process.exitCode = 2;
} else {
  const pool = new Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'false' ? false : undefined,
    max: 2,
  });
  const id = crypto.randomUUID();
  const ids = {
    journalA: crypto.randomUUID(),
    journalAReversal: crypto.randomUUID(),
    journalB: crypto.randomUUID(),
    journalBReversal: crypto.randomUUID(),
    invoiceJournal: crypto.randomUUID(),
    invoiceReversal: crypto.randomUUID(),
    invoiceValid: crypto.randomUUID(),
  };

  async function expectReject(client, label, query, values) {
    const savepoint = `vendor_invoice_scope_${label}`;
    await client.query(`SAVEPOINT ${savepoint}`);
    try {
      await client.query(query, values);
      throw new Error(`${label} unexpectedly succeeded`);
    } catch (error) {
      if (error.message === `${label} unexpectedly succeeded`) throw error;
      if (!['23514', '23503'].includes(error.code)) {
        throw new Error(`${label} returned ${error.code || 'unknown'}: ${error.message}`);
      }
    } finally {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    }
  }

  (async () => {
    const client = await pool.connect();
    let branchA;
    let branchB;
    try {
      const constraints = await client.query(`SELECT conname FROM pg_constraint
        WHERE conname = ANY($1::text[])`, [[
        'finance_vendor_invoice_journal_branch_fkey',
        'finance_vendor_invoice_reversal_journal_branch_fkey',
      ]]);
      if (constraints.rowCount !== 2) {
        throw Object.assign(new Error(`Migration 022 composite invoice constraints missing (${constraints.rowCount}/2).`), { code: 'vendor_invoice_scope_constraints_missing' });
      }
      const trigger = await client.query(`SELECT count(*)::int AS count FROM pg_trigger
        WHERE NOT tgisinternal AND tgname = ANY($1::text[])`, [[
        'finance_vendor_invoice_journal_branch_guard',
        'finance_journal_branch_retag_guard',
      ]]);
      if (Number(trigger.rows[0]?.count || 0) !== 2) {
        throw Object.assign(new Error(`Migration 022 invoice/retag triggers missing (${trigger.rows[0]?.count || 0}/2).`), { code: 'vendor_invoice_scope_triggers_missing' });
      }

      await client.query('BEGIN');
      const branchRow = await client.query('SELECT COALESCE(MAX(id), 0) + 2000000 AS id FROM unified_branches');
      branchA = Number(branchRow.rows[0].id);
      branchB = branchA + 1;
      await client.query(
        `INSERT INTO unified_branches(id,slug,name,active,data)
         VALUES($1,$2,$3,true,'{}'::jsonb),($4,$5,$6,true,'{}'::jsonb)`,
        [branchA, `verify-invoice-${id}-a`, 'Invoice Scope A', branchB, `verify-invoice-${id}-b`, 'Invoice Scope B'],
      );

      const journalRows = [
        [ids.journalA, `VERIFY-VI-JA-${id}`, branchA],
        [ids.journalAReversal, `VERIFY-VI-JAR-${id}`, branchA],
        [ids.journalB, `VERIFY-VI-JB-${id}`, branchB],
        [ids.journalBReversal, `VERIFY-VI-JBR-${id}`, branchB],
      ];
      for (const [journalId, number, branch] of journalRows) {
        await client.query(
          `INSERT INTO journal_entries_v2
             (id,number,source,source_id,entry_at,description,status,debit_irr,credit_irr,branch_id,created_by)
           VALUES($1,$2,'verify-vendor-invoice',$3,now(),'Vendor invoice branch verifier',
             'pending_approval',100,100,$4,'verifier')`,
          [journalId, number, id, branch],
        );
      }

      await expectReject(client, 'invoice_journal',
        `INSERT INTO finance_vendor_invoices
          (id,number,vendor_id,branch_id,total_irr,status,invoice_date,journal_entry_id)
         VALUES($1,$2,$3,$4,100,'received',current_date,$5)`,
        [ids.invoiceJournal, `VERIFY-VI-1-${id}`, `verify-vendor-${id}`, branchA, ids.journalB]);

      await expectReject(client, 'invoice_reversal',
        `INSERT INTO finance_vendor_invoices
          (id,number,vendor_id,branch_id,total_irr,status,invoice_date,reversal_journal_entry_id)
         VALUES($1,$2,$3,$4,100,'received',current_date,$5)`,
        [ids.invoiceReversal, `VERIFY-VI-2-${id}`, `verify-vendor-${id}`, branchA, ids.journalBReversal]);

      await client.query(
        `INSERT INTO finance_vendor_invoices
          (id,number,vendor_id,branch_id,total_irr,status,invoice_date,journal_entry_id,reversal_journal_entry_id)
         VALUES($1,$2,$3,$4,100,'received',current_date,$5,$6)`,
        [ids.invoiceValid, `VERIFY-VI-3-${id}`, `verify-vendor-${id}`, branchA, ids.journalA, ids.journalAReversal],
      );

      await expectReject(client, 'journal_parent_retag',
        `UPDATE journal_entries_v2 SET branch_id = $1 WHERE id = $2`,
        [branchB, ids.journalA]);

      // The reversal reference has the same parent-retag invariant as the
      // posting reference; exercise it independently so a future edit cannot
      // accidentally protect only the first invoice journal.
      await expectReject(client, 'journal_parent_retag_reversal',
        `UPDATE journal_entries_v2 SET branch_id = $1 WHERE id = $2`,
        [branchB, ids.journalAReversal]);

      await client.query('ROLLBACK');
      const residue = await pool.query(
        'SELECT count(*)::int AS count FROM unified_branches WHERE id = ANY($1::bigint[])',
        [[branchA, branchB]],
      );
      if (Number(residue.rows[0]?.count || 0) !== 0) {
        throw new Error('Vendor-invoice branch verifier left fixture rows behind.');
      }
      process.stdout.write(JSON.stringify({ ok: true, migration: '022', rollback: true, cases: 5 }, null, 2) + '\n');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
      await pool.end();
    }
  })().catch((error) => {
    process.stderr.write(JSON.stringify({ ok: false, code: error.code || 'vendor_invoice_scope_verification_failed', error: error.message }, null, 2) + '\n');
    process.exitCode = 1;
  });
}
