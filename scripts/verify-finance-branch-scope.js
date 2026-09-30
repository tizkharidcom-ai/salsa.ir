#!/usr/bin/env node
'use strict';

/*
 * Disposable, transaction-only verifier for migration 021.  It deliberately
 * never commits: every fixture (including the temporary second branch) is
 * rolled back after the cross-branch write attempts.  Run against a database
 * that has been migrated with:
 *   FINANCE_BRANCH_SCOPE_DISPOSABLE=true node --env-file=.env.local scripts/verify-finance-branch-scope.js
 */
const crypto = require('node:crypto');
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  process.stderr.write('DATABASE_URL is required. Branch-scope verification was not attempted.\n');
  process.exitCode = 2;
} else if (process.env.FINANCE_BRANCH_SCOPE_DISPOSABLE !== 'true') {
  process.stderr.write('FINANCE_BRANCH_SCOPE_DISPOSABLE=true is required because this verifier uses transaction fixtures.\n');
  process.exitCode = 2;
} else {
  const pool = new Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'false' ? false : undefined,
    max: 4,
  });
  const id = crypto.randomUUID();
  const ids = {
    order: Number(`${Date.now()}${Math.floor(Math.random() * 1000)}`),
    orderOther: Number(`${Date.now()}${Math.floor(Math.random() * 1000) + 1001}`),
    payment: crypto.randomUUID(),
    journal: crypto.randomUUID(),
    journalLine: crypto.randomUUID(),
    period: crypto.randomUUID(),
    snapshot: crypto.randomUUID(),
    itemA: `verify-a-${id}`,
    itemB: `verify-b-${id}`,
    po: crypto.randomUUID(),
    poLine: crypto.randomUUID(),
    receipt: crypto.randomUUID(),
    recipe: crypto.randomUUID(),
    ingredient: crypto.randomUUID(),
    vendorInvoice: crypto.randomUUID(),
    vendorPayment: crypto.randomUUID(),
    vendorJournalA: crypto.randomUUID(),
    vendorJournalB: crypto.randomUUID(),
  };

  async function expectReject(client, label, query, values, code = '23514') {
    const savepoint = `branch_scope_${label.replace(/[^a-z0-9_]/gi, '_')}`;
    await client.query(`SAVEPOINT ${savepoint}`);
    try {
      await client.query(query, values);
      throw new Error(`${label} unexpectedly succeeded`);
    } catch (error) {
      if (error.message === `${label} unexpectedly succeeded`) throw error;
      if (error.code !== code && error.code !== '23503') {
        throw new Error(`${label} returned ${error.code || 'unknown'}: ${error.message}`);
      }
    } finally {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    }
  }

  (async () => {
    const client = await pool.connect();
    try {
      const relation = await client.query(`SELECT
        to_regclass('public.finance_payments') AS finance_payments,
        to_regclass('public.journal_entries_v2') AS journal_entries,
        to_regclass('public.journal_lines_v2') AS journal_lines,
        to_regclass('public.finance_order_item_cost_snapshots') AS cost_snapshots,
        to_regclass('public.finance_purchase_orders') AS purchase_orders,
        to_regclass('public.finance_vendor_invoices') AS vendor_invoices,
        to_regclass('public.finance_vendor_payments') AS vendor_payments`);
      if (Object.values(relation.rows[0] || {}).some((value) => !value)) {
        throw Object.assign(new Error('Migration 020/021 relations are not available.'), { code: 'branch_scope_migration_missing' });
      }
      const constraints = await client.query(`SELECT conname FROM pg_constraint
        WHERE conname = ANY($1::text[])`, [[
        'finance_payments_order_branch_fkey',
        'journal_lines_entry_branch_fkey',
        'finance_cost_snapshot_order_branch_fkey',
        'finance_goods_receipt_purchase_order_branch_fkey',
        'finance_vendor_invoice_purchase_order_branch_fkey',
      ]]);
      if (constraints.rowCount !== 5) {
        throw Object.assign(new Error(`Migration 020 composite constraints missing (${constraints.rowCount}/5).`), { code: 'branch_scope_constraints_missing' });
      }
      const relatedTriggers = await client.query(`SELECT count(*)::int AS count FROM pg_trigger
        WHERE NOT tgisinternal AND tgname = ANY($1::text[])`, [[
        'finance_vendor_payment_branch_guard',
        'finance_cost_accrual_branch_guard',
        'finance_cost_payment_branch_guard',
        'finance_payroll_payment_branch_guard',
        'finance_reconciliation_branch_guard',
        'finance_journal_branch_retag_guard',
      ]]);
      if (Number(relatedTriggers.rows[0]?.count || 0) !== 6) {
        throw Object.assign(new Error(`Migration 021 related branch triggers missing (${relatedTriggers.rows[0]?.count || 0}/6).`), { code: 'related_branch_scope_triggers_missing' });
      }

      await client.query('BEGIN');
      const branchRow = await client.query('SELECT COALESCE(MAX(id), 0) + 1000000 AS id FROM unified_branches');
      const branchA = Number(branchRow.rows[0].id);
      const branchB = branchA + 1;
      await client.query(
        `INSERT INTO unified_branches(id,slug,name,active,data) VALUES($1,$2,$3,true,'{}'::jsonb),($4,$5,$6,true,'{}'::jsonb)`,
        [branchA, `verify-${id}-a`, 'Branch Scope A', branchB, `verify-${id}-b`, 'Branch Scope B'],
      );
      await client.query(
        `INSERT INTO unified_orders(id,order_no,branch_id,status,total,created_at,data)
         VALUES($1,$2,$3,'paid',100,now(),'{}'::jsonb),($4,$5,$6,'paid',100,now(),'{}'::jsonb)`,
        [ids.order, `VERIFY-${id}-A`, branchA, ids.orderOther, `VERIFY-${id}-B`, branchB],
      );

      await client.query('SET CONSTRAINTS finance_payments_order_branch_fkey IMMEDIATE');
      await expectReject(client, 'payment_order',
        `INSERT INTO finance_payments(id,order_id,branch_id,tender,amount_irr,status,idempotency_key)
         VALUES($1,$2,$3,'cash',100,'succeeded',$4)`,
        [ids.payment, ids.order, branchB, `verify-payment-${id}`], '23503');

      // The disposable database currently has one global wildcard period.
      // Temporarily remove that row inside this transaction so a
      // branch-specific period can be exercised; the final ROLLBACK restores
      // it byte-for-byte.
      const globalPeriods = await client.query("SELECT id FROM fiscal_periods_v2 WHERE branch_id IS NULL");
      if (globalPeriods.rowCount) {
        await client.query('DELETE FROM fiscal_periods_v2 WHERE id = ANY($1::uuid[])', [globalPeriods.rows.map((row) => row.id)]);
      }
      await client.query(
        `INSERT INTO fiscal_periods_v2(id,name,starts_on,ends_on,status,branch_id)
         VALUES($1,$2,'2026-09-30','2026-10-30','open',$3)`, [ids.period, `VERIFY ${id}`, branchA],
      );
      await expectReject(client, 'journal_period',
        `INSERT INTO journal_entries_v2(id,number,period_id,source,source_id,entry_at,description,status,debit_irr,credit_irr,branch_id,created_by)
         VALUES($1,$2,$3,'verify',$4,now(),'Branch scope verifier','pending_approval',100,100,$5,'verifier')`,
        [ids.journal, `VERIFY-J-${id}`, ids.period, id, branchB]);
      await client.query(
        `INSERT INTO journal_entries_v2(id,number,source,source_id,entry_at,description,status,debit_irr,credit_irr,branch_id,created_by)
         VALUES($1,$2,'verify',$3,now(),'Branch scope verifier','pending_approval',100,100,$4,'verifier')`,
        [ids.journal, `VERIFY-J-${id}`, id, branchA],
      );
      await client.query('SET CONSTRAINTS journal_lines_entry_branch_fkey IMMEDIATE');
      await expectReject(client, 'journal_line_entry',
        `INSERT INTO journal_lines_v2(id,journal_entry_id,line_no,account_code,debit_irr,credit_irr,branch_id,cost_center)
         VALUES($1,$2,1,'1100',100,0,$3,'verify')`, [ids.journalLine, ids.journal, branchB], '23503');

      await client.query('SET CONSTRAINTS finance_cost_snapshot_order_branch_fkey IMMEDIATE');
      await expectReject(client, 'cost_snapshot_order',
        `INSERT INTO finance_order_item_cost_snapshots(id,order_id,order_line_key,branch_id,quantity,net_sales_irr,captured_at)
         VALUES($1,$2,'line-1',$3,1,100,now())`, [ids.snapshot, ids.order, branchB], '23503');

      await client.query(
        `INSERT INTO finance_inventory_items_v2(id,branch_id,sku,name,base_unit_code)
         VALUES($1,$2,$3,'Item A','count'),($4,$5,$6,'Item B','count')`,
        [ids.itemA, branchA, `SKU-A-${id}`, ids.itemB, branchB, `SKU-B-${id}`],
      );
      await client.query(
        `INSERT INTO finance_purchase_orders(id,number,branch_id,vendor_id,status,total_irr,lines,created_by)
         VALUES($1,$2,$3,'verify-vendor','draft',100,'[]'::jsonb,'verifier')`,
        [ids.po, `VERIFY-PO-${id}`, branchA],
      );
      await expectReject(client, 'purchase_line_item',
        `INSERT INTO finance_purchase_order_lines(id,purchase_order_id,line_no,item_id,ordered_quantity,unit_code,unit_price_irr,line_total_irr)
         VALUES($1,$2,1,$3,1,'count',100,100)`, [ids.poLine, ids.po, ids.itemB]);
      await client.query('SET CONSTRAINTS finance_goods_receipt_purchase_order_branch_fkey IMMEDIATE');
      await expectReject(client, 'goods_receipt_order',
        `INSERT INTO finance_goods_receipts(id,number,purchase_order_id,branch_id,received_at,lines,received_by,idempotency_key)
         VALUES($1,$2,$3,$4,now(),'[]'::jsonb,'verifier',$5)`,
        [ids.receipt, `VERIFY-GR-${id}`, ids.po, branchB, `verify-gr-${id}`], '23503');

      await client.query(
        `INSERT INTO finance_recipe_versions(id,recipe_id,menu_item_id,version,branch_id,yield_quantity,effective_from,ingredients,created_by,status)
         VALUES($1,$2,'verify-menu',1,$3,1,now(),'[]'::jsonb,'verifier','draft')`,
        [ids.recipe, `verify-recipe-${id}`, branchA],
      );
      await expectReject(client, 'recipe_ingredient_item',
        `INSERT INTO finance_recipe_ingredients(id,recipe_version_id,line_no,item_id,quantity,unit_code)
         VALUES($1,$2,1,$3,1,'count')`, [ids.ingredient, ids.recipe, ids.itemB]);

      // A vendor payment has no duplicated branch_id column; its invoice is
      // the branch authority.  The database trigger must reject a payment
      // whose journal belongs to another branch, while accepting the same
      // invoice with a journal from its own branch.
      await client.query(
        `INSERT INTO journal_entries_v2(id,number,source,source_id,entry_at,description,status,debit_irr,credit_irr,branch_id,created_by)
         VALUES($1,$2,'verify-vendor',$3,now(),'Vendor branch verifier','pending_approval',100,100,$4,'verifier'),
               ($5,$6,'verify-vendor',$3,now(),'Vendor branch verifier','pending_approval',100,100,$7,'verifier')`,
        [ids.vendorJournalA, `VERIFY-VJ-A-${id}`, id, branchA, ids.vendorJournalB, `VERIFY-VJ-B-${id}`, branchB],
      );
      await client.query(
        `INSERT INTO finance_vendor_invoices(id,number,vendor_id,branch_id,total_irr,status,invoice_date)
         VALUES($1,$2,$3,$4,100,'received',current_date)`,
        [ids.vendorInvoice, `VERIFY-VI-${id}`, `verify-vendor-${id}`, branchA],
      );
      await expectReject(client, 'vendor_payment_journal',
        `INSERT INTO finance_vendor_payments(id,invoice_id,amount_irr,status,idempotency_key,created_by,journal_entry_id)
         VALUES($1,$2,100,'pending_approval',$3,'verifier',$4)`,
        [ids.vendorPayment, ids.vendorInvoice, `verify-vp-${id}`, ids.vendorJournalB]);
      await client.query(
        `INSERT INTO finance_vendor_payments(id,invoice_id,amount_irr,status,idempotency_key,created_by,journal_entry_id)
         VALUES($1,$2,100,'pending_approval',$3,'verifier',$4)`,
        [ids.vendorPayment, ids.vendorInvoice, `verify-vp-good-${id}`, ids.vendorJournalA],
      );

      await client.query('ROLLBACK');
      const residue = await pool.query('SELECT count(*)::int AS count FROM unified_branches WHERE id = ANY($1::bigint[])', [[branchA, branchB]]);
      if (Number(residue.rows[0].count) !== 0) throw new Error('Branch-scope verifier left fixture rows behind.');
      process.stdout.write(JSON.stringify({ ok: true, migration: '021', rollback: true, cases: 8 }, null, 2) + '\n');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
      await pool.end();
    }
  })().catch((error) => {
    process.stderr.write(JSON.stringify({ ok: false, code: error.code || 'branch_scope_verification_failed', error: error.message }, null, 2) + '\n');
    process.exitCode = 1;
  });
}
