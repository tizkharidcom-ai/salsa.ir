BEGIN;

-- Migration 021 protects vendor payments through the invoice branch, but an
-- invoice itself still has two independent journal FKs.  Add branch-aware
-- constraints for both the posting and reversal journal without introducing
-- a duplicated branch column on the invoice or rewriting historical data.
-- The preflight is deliberately fail-closed: any existing mismatch aborts the
-- whole migration and must be repaired through an auditable data procedure.

DO $$
DECLARE violation_count BIGINT;
BEGIN
  SELECT count(*) INTO violation_count
    FROM finance_vendor_invoices invoice
    JOIN journal_entries_v2 journal ON journal.id = invoice.journal_entry_id
   WHERE invoice.branch_id IS DISTINCT FROM journal.branch_id;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'finance_branch_scope_violation:vendor_invoice_journal:%', violation_count
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO violation_count
    FROM finance_vendor_invoices invoice
    JOIN journal_entries_v2 journal ON journal.id = invoice.reversal_journal_entry_id
   WHERE invoice.branch_id IS DISTINCT FROM journal.branch_id;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'finance_branch_scope_violation:vendor_invoice_reversal:%', violation_count
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- Migration 020 creates this target index.  IF NOT EXISTS keeps the migration
-- safe when a compatible index was created by an operator during preflight.
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_v2_id_branch_unique
  ON journal_entries_v2 (id, branch_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'finance_vendor_invoice_journal_branch_fkey') THEN
    ALTER TABLE finance_vendor_invoices
      ADD CONSTRAINT finance_vendor_invoice_journal_branch_fkey
      FOREIGN KEY (journal_entry_id, branch_id)
      REFERENCES journal_entries_v2 (id, branch_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'finance_vendor_invoice_reversal_journal_branch_fkey') THEN
    ALTER TABLE finance_vendor_invoices
      ADD CONSTRAINT finance_vendor_invoice_reversal_journal_branch_fkey
      FOREIGN KEY (reversal_journal_entry_id, branch_id)
      REFERENCES journal_entries_v2 (id, branch_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END;
$$;

-- Keep the relationship fail-closed at statement time as well.  The trigger
-- gives an actionable domain error before a deferred FK is checked, while the
-- composite FKs remain the durable database invariant at transaction commit.
CREATE OR REPLACE FUNCTION finance_guard_vendor_invoice_journal_branch()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE journal_branch BIGINT;
BEGIN
  IF NEW.journal_entry_id IS NOT NULL THEN
    SELECT branch_id INTO journal_branch
      FROM journal_entries_v2 WHERE id = NEW.journal_entry_id;
    IF FOUND THEN
      PERFORM finance_assert_branch_relation(NEW.branch_id, journal_branch, 'vendor_invoice_journal');
    END IF;
  END IF;
  IF NEW.reversal_journal_entry_id IS NOT NULL THEN
    SELECT branch_id INTO journal_branch
      FROM journal_entries_v2 WHERE id = NEW.reversal_journal_entry_id;
    IF FOUND THEN
      PERFORM finance_assert_branch_relation(NEW.branch_id, journal_branch, 'vendor_invoice_reversal');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_vendor_invoice_journal_branch_guard ON finance_vendor_invoices;
CREATE TRIGGER finance_vendor_invoice_journal_branch_guard
  BEFORE INSERT OR UPDATE OF branch_id, journal_entry_id, reversal_journal_entry_id
  ON finance_vendor_invoices
  FOR EACH ROW EXECUTE FUNCTION finance_guard_vendor_invoice_journal_branch();

-- A journal cannot be retagged after it is referenced by an invoice.  Keep
-- this explicit in 022 so the invariant remains present even if a future
-- migration replaces the broader 021 retag function.
CREATE OR REPLACE FUNCTION finance_guard_journal_branch_retag() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id AND (
    EXISTS (SELECT 1 FROM journal_lines_v2 WHERE journal_entry_id = OLD.id)
    OR EXISTS (SELECT 1 FROM finance_vendor_invoices
               WHERE journal_entry_id = OLD.id OR reversal_journal_entry_id = OLD.id)
    OR EXISTS (SELECT 1 FROM finance_vendor_payments
               WHERE journal_entry_id = OLD.id OR reversal_journal_entry_id = OLD.id)
    OR EXISTS (SELECT 1 FROM finance_cost_accruals WHERE journal_entry_id = OLD.id)
    OR EXISTS (SELECT 1 FROM finance_cost_payments
               WHERE journal_entry_id = OLD.id OR reversal_journal_entry_id = OLD.id)
    OR EXISTS (SELECT 1 FROM finance_payroll_runs
               WHERE journal_entry_id = OLD.id OR reversal_journal_entry_id = OLD.id)
    OR EXISTS (SELECT 1 FROM finance_payroll_payments
               WHERE journal_entry_id = OLD.id OR reversal_journal_entry_id = OLD.id)
    OR EXISTS (SELECT 1 FROM finance_opening_balance_batches
               WHERE journal_entry_id = OLD.id OR reversal_journal_entry_id = OLD.id)
    OR EXISTS (SELECT 1 FROM finance_fixed_assets
               WHERE acquisition_journal_entry_id = OLD.id OR reversal_journal_entry_id = OLD.id)
    OR EXISTS (SELECT 1 FROM reconciliation_items WHERE journal_entry_id = OLD.id)
  ) THEN
    RAISE EXCEPTION 'finance_journal_entry_branch_immutable_when_referenced'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_journal_branch_retag_guard ON journal_entries_v2;
CREATE TRIGGER finance_journal_branch_retag_guard
  BEFORE UPDATE OF branch_id ON journal_entries_v2
  FOR EACH ROW EXECUTE FUNCTION finance_guard_journal_branch_retag();

COMMIT;
