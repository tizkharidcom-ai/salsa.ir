BEGIN;

-- Migration 020 protects the highest-volume order and inventory links.  The
-- remaining financial documents also carry a branch dimension, but their
-- child rows were only protected by independent single-column FKs.  A valid
-- invoice/journal (or accrual/payment) in two different branches is still a
-- cross-branch posting, so reject that state at the database boundary.

DO $$
DECLARE violations BIGINT;
BEGIN
  SELECT count(*) INTO violations
    FROM finance_vendor_payments payment
    JOIN finance_vendor_invoices invoice ON invoice.id = payment.invoice_id
    JOIN journal_entries_v2 journal ON journal.id = payment.journal_entry_id
   WHERE invoice.branch_id IS DISTINCT FROM journal.branch_id;
  IF violations > 0 THEN RAISE EXCEPTION 'finance_branch_scope_violation:vendor_payment_journal:%', violations USING ERRCODE = '23514'; END IF;

  SELECT count(*) INTO violations
    FROM finance_vendor_payments payment
    JOIN finance_vendor_invoices invoice ON invoice.id = payment.invoice_id
    JOIN journal_entries_v2 journal ON journal.id = payment.reversal_journal_entry_id
   WHERE invoice.branch_id IS DISTINCT FROM journal.branch_id;
  IF violations > 0 THEN RAISE EXCEPTION 'finance_branch_scope_violation:vendor_payment_reversal:%', violations USING ERRCODE = '23514'; END IF;

  SELECT count(*) INTO violations
    FROM finance_cost_accruals accrual
    JOIN finance_cost_commitments commitment ON commitment.id = accrual.cost_commitment_id
   WHERE accrual.branch_id IS DISTINCT FROM commitment.branch_id;
  IF violations > 0 THEN RAISE EXCEPTION 'finance_branch_scope_violation:cost_accrual_commitment:%', violations USING ERRCODE = '23514'; END IF;

  SELECT count(*) INTO violations
    FROM finance_cost_accruals accrual
    JOIN fiscal_periods_v2 period ON period.id = accrual.fiscal_period_id
   WHERE period.branch_id IS NOT NULL AND accrual.branch_id IS DISTINCT FROM period.branch_id;
  IF violations > 0 THEN RAISE EXCEPTION 'finance_branch_scope_violation:cost_accrual_period:%', violations USING ERRCODE = '23514'; END IF;

  SELECT count(*) INTO violations
    FROM finance_cost_accruals accrual
    JOIN journal_entries_v2 journal ON journal.id = accrual.journal_entry_id
   WHERE accrual.branch_id IS DISTINCT FROM journal.branch_id;
  IF violations > 0 THEN RAISE EXCEPTION 'finance_branch_scope_violation:cost_accrual_journal:%', violations USING ERRCODE = '23514'; END IF;

  SELECT count(*) INTO violations
    FROM finance_cost_payments payment
    JOIN finance_cost_accruals accrual ON accrual.id = payment.cost_accrual_id
   WHERE payment.branch_id IS DISTINCT FROM accrual.branch_id;
  IF violations > 0 THEN RAISE EXCEPTION 'finance_branch_scope_violation:cost_payment_accrual:%', violations USING ERRCODE = '23514'; END IF;

  SELECT count(*) INTO violations
    FROM finance_cost_payments payment
    JOIN journal_entries_v2 journal ON journal.id = payment.journal_entry_id
   WHERE payment.branch_id IS DISTINCT FROM journal.branch_id;
  IF violations > 0 THEN RAISE EXCEPTION 'finance_branch_scope_violation:cost_payment_journal:%', violations USING ERRCODE = '23514'; END IF;

  SELECT count(*) INTO violations
    FROM finance_cost_payments payment
    JOIN journal_entries_v2 journal ON journal.id = payment.reversal_journal_entry_id
   WHERE payment.branch_id IS DISTINCT FROM journal.branch_id;
  IF violations > 0 THEN RAISE EXCEPTION 'finance_branch_scope_violation:cost_payment_reversal:%', violations USING ERRCODE = '23514'; END IF;

  SELECT count(*) INTO violations
    FROM finance_payroll_payments payment
    JOIN finance_payroll_runs run ON run.id = payment.payroll_run_id
   WHERE payment.branch_id IS DISTINCT FROM run.branch_id;
  IF violations > 0 THEN RAISE EXCEPTION 'finance_branch_scope_violation:payroll_payment_run:%', violations USING ERRCODE = '23514'; END IF;

  SELECT count(*) INTO violations
    FROM reconciliation_items item
    JOIN unified_orders order_row ON order_row.id = item.order_id
   WHERE item.branch_id IS DISTINCT FROM order_row.branch_id;
  IF violations > 0 THEN RAISE EXCEPTION 'finance_branch_scope_violation:reconciliation_order:%', violations USING ERRCODE = '23514'; END IF;

  SELECT count(*) INTO violations
    FROM reconciliation_items item
    JOIN finance_payments payment ON payment.id::text = item.payment_id
   WHERE item.branch_id IS DISTINCT FROM payment.branch_id;
  IF violations > 0 THEN RAISE EXCEPTION 'finance_branch_scope_violation:reconciliation_payment:%', violations USING ERRCODE = '23514'; END IF;

  SELECT count(*) INTO violations
    FROM reconciliation_items item
    JOIN finance_cash_sessions session ON session.id::text = item.cash_session_id
   WHERE item.branch_id IS DISTINCT FROM session.branch_id;
  IF violations > 0 THEN RAISE EXCEPTION 'finance_branch_scope_violation:reconciliation_cash_session:%', violations USING ERRCODE = '23514'; END IF;

  SELECT count(*) INTO violations
    FROM reconciliation_items item
    JOIN journal_entries_v2 journal ON journal.id = item.journal_entry_id
   WHERE item.branch_id IS DISTINCT FROM journal.branch_id;
  IF violations > 0 THEN RAISE EXCEPTION 'finance_branch_scope_violation:reconciliation_journal:%', violations USING ERRCODE = '23514'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION finance_assert_branch_relation(expected_branch BIGINT, actual_branch BIGINT, relation_code TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF expected_branch IS NOT NULL AND actual_branch IS NOT NULL
     AND expected_branch IS DISTINCT FROM actual_branch THEN
    RAISE EXCEPTION 'finance_branch_scope_violation:%', relation_code USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION finance_guard_vendor_payment_branch() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE invoice_branch BIGINT; journal_branch BIGINT;
BEGIN
  SELECT branch_id INTO invoice_branch FROM finance_vendor_invoices WHERE id = NEW.invoice_id;
  IF FOUND THEN
    IF NEW.journal_entry_id IS NOT NULL THEN
      SELECT branch_id INTO journal_branch FROM journal_entries_v2 WHERE id = NEW.journal_entry_id;
      IF FOUND THEN PERFORM finance_assert_branch_relation(invoice_branch, journal_branch, 'vendor_payment_journal'); END IF;
    END IF;
    IF NEW.reversal_journal_entry_id IS NOT NULL THEN
      SELECT branch_id INTO journal_branch FROM journal_entries_v2 WHERE id = NEW.reversal_journal_entry_id;
      IF FOUND THEN PERFORM finance_assert_branch_relation(invoice_branch, journal_branch, 'vendor_payment_reversal'); END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS finance_vendor_payment_branch_guard ON finance_vendor_payments;
CREATE TRIGGER finance_vendor_payment_branch_guard
  BEFORE INSERT OR UPDATE OF invoice_id, journal_entry_id, reversal_journal_entry_id
  ON finance_vendor_payments FOR EACH ROW EXECUTE FUNCTION finance_guard_vendor_payment_branch();

CREATE OR REPLACE FUNCTION finance_guard_cost_accrual_branch() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE related_branch BIGINT;
BEGIN
  SELECT branch_id INTO related_branch FROM finance_cost_commitments WHERE id = NEW.cost_commitment_id;
  IF FOUND THEN PERFORM finance_assert_branch_relation(NEW.branch_id, related_branch, 'cost_accrual_commitment'); END IF;
  SELECT branch_id INTO related_branch FROM fiscal_periods_v2 WHERE id = NEW.fiscal_period_id;
  IF FOUND AND related_branch IS NOT NULL THEN PERFORM finance_assert_branch_relation(NEW.branch_id, related_branch, 'cost_accrual_period'); END IF;
  SELECT branch_id INTO related_branch FROM journal_entries_v2 WHERE id = NEW.journal_entry_id;
  IF FOUND THEN PERFORM finance_assert_branch_relation(NEW.branch_id, related_branch, 'cost_accrual_journal'); END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS finance_cost_accrual_branch_guard ON finance_cost_accruals;
CREATE TRIGGER finance_cost_accrual_branch_guard
  BEFORE INSERT OR UPDATE OF cost_commitment_id, branch_id, fiscal_period_id, journal_entry_id
  ON finance_cost_accruals FOR EACH ROW EXECUTE FUNCTION finance_guard_cost_accrual_branch();

CREATE OR REPLACE FUNCTION finance_guard_cost_payment_branch() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE related_branch BIGINT;
BEGIN
  SELECT branch_id INTO related_branch FROM finance_cost_accruals WHERE id = NEW.cost_accrual_id;
  IF FOUND THEN PERFORM finance_assert_branch_relation(NEW.branch_id, related_branch, 'cost_payment_accrual'); END IF;
  IF NEW.journal_entry_id IS NOT NULL THEN
    SELECT branch_id INTO related_branch FROM journal_entries_v2 WHERE id = NEW.journal_entry_id;
    IF FOUND THEN PERFORM finance_assert_branch_relation(NEW.branch_id, related_branch, 'cost_payment_journal'); END IF;
  END IF;
  IF NEW.reversal_journal_entry_id IS NOT NULL THEN
    SELECT branch_id INTO related_branch FROM journal_entries_v2 WHERE id = NEW.reversal_journal_entry_id;
    IF FOUND THEN PERFORM finance_assert_branch_relation(NEW.branch_id, related_branch, 'cost_payment_reversal'); END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS finance_cost_payment_branch_guard ON finance_cost_payments;
CREATE TRIGGER finance_cost_payment_branch_guard
  BEFORE INSERT OR UPDATE OF cost_accrual_id, branch_id, journal_entry_id, reversal_journal_entry_id
  ON finance_cost_payments FOR EACH ROW EXECUTE FUNCTION finance_guard_cost_payment_branch();

CREATE OR REPLACE FUNCTION finance_guard_payroll_payment_branch() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE related_branch BIGINT;
BEGIN
  SELECT branch_id INTO related_branch FROM finance_payroll_runs WHERE id = NEW.payroll_run_id;
  IF FOUND THEN PERFORM finance_assert_branch_relation(NEW.branch_id, related_branch, 'payroll_payment_run'); END IF;
  IF NEW.journal_entry_id IS NOT NULL THEN
    SELECT branch_id INTO related_branch FROM journal_entries_v2 WHERE id = NEW.journal_entry_id;
    IF FOUND THEN PERFORM finance_assert_branch_relation(NEW.branch_id, related_branch, 'payroll_payment_journal'); END IF;
  END IF;
  IF NEW.reversal_journal_entry_id IS NOT NULL THEN
    SELECT branch_id INTO related_branch FROM journal_entries_v2 WHERE id = NEW.reversal_journal_entry_id;
    IF FOUND THEN PERFORM finance_assert_branch_relation(NEW.branch_id, related_branch, 'payroll_payment_reversal'); END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS finance_payroll_payment_branch_guard ON finance_payroll_payments;
CREATE TRIGGER finance_payroll_payment_branch_guard
  BEFORE INSERT OR UPDATE OF payroll_run_id, branch_id, journal_entry_id, reversal_journal_entry_id
  ON finance_payroll_payments FOR EACH ROW EXECUTE FUNCTION finance_guard_payroll_payment_branch();

CREATE OR REPLACE FUNCTION finance_guard_reconciliation_branch() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE related_branch BIGINT;
BEGIN
  IF NEW.order_id IS NOT NULL THEN
    SELECT branch_id INTO related_branch FROM unified_orders WHERE id = NEW.order_id;
    IF FOUND THEN PERFORM finance_assert_branch_relation(NEW.branch_id, related_branch, 'reconciliation_order'); END IF;
  END IF;
  IF NEW.payment_id IS NOT NULL THEN
    SELECT branch_id INTO related_branch FROM finance_payments WHERE id::text = NEW.payment_id;
    IF FOUND THEN PERFORM finance_assert_branch_relation(NEW.branch_id, related_branch, 'reconciliation_payment'); END IF;
  END IF;
  IF NEW.cash_session_id IS NOT NULL THEN
    SELECT branch_id INTO related_branch FROM finance_cash_sessions WHERE id::text = NEW.cash_session_id;
    IF FOUND THEN PERFORM finance_assert_branch_relation(NEW.branch_id, related_branch, 'reconciliation_cash_session'); END IF;
  END IF;
  IF NEW.journal_entry_id IS NOT NULL THEN
    SELECT branch_id INTO related_branch FROM journal_entries_v2 WHERE id = NEW.journal_entry_id;
    IF FOUND THEN PERFORM finance_assert_branch_relation(NEW.branch_id, related_branch, 'reconciliation_journal'); END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS finance_reconciliation_branch_guard ON reconciliation_items;
CREATE TRIGGER finance_reconciliation_branch_guard
  BEFORE INSERT OR UPDATE OF branch_id, order_id, payment_id, cash_session_id, journal_entry_id
  ON reconciliation_items FOR EACH ROW EXECUTE FUNCTION finance_guard_reconciliation_branch();

-- Parent retagging must be blocked too; otherwise a previously valid child can
-- become cross-branch after its parent is edited.
CREATE OR REPLACE FUNCTION finance_guard_journal_branch_retag() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id AND (
    EXISTS (SELECT 1 FROM journal_lines_v2 WHERE journal_entry_id = OLD.id)
    OR EXISTS (SELECT 1 FROM finance_vendor_invoices WHERE journal_entry_id = OLD.id OR reversal_journal_entry_id = OLD.id)
    OR EXISTS (SELECT 1 FROM finance_vendor_payments WHERE journal_entry_id = OLD.id OR reversal_journal_entry_id = OLD.id)
    OR EXISTS (SELECT 1 FROM finance_cost_accruals WHERE journal_entry_id = OLD.id)
    OR EXISTS (SELECT 1 FROM finance_cost_payments WHERE journal_entry_id = OLD.id OR reversal_journal_entry_id = OLD.id)
    OR EXISTS (SELECT 1 FROM finance_payroll_runs WHERE journal_entry_id = OLD.id OR reversal_journal_entry_id = OLD.id)
    OR EXISTS (SELECT 1 FROM finance_payroll_payments WHERE journal_entry_id = OLD.id OR reversal_journal_entry_id = OLD.id)
    OR EXISTS (SELECT 1 FROM finance_opening_balance_batches WHERE journal_entry_id = OLD.id OR reversal_journal_entry_id = OLD.id)
    OR EXISTS (SELECT 1 FROM finance_fixed_assets WHERE acquisition_journal_entry_id = OLD.id OR reversal_journal_entry_id = OLD.id)
    OR EXISTS (SELECT 1 FROM reconciliation_items WHERE journal_entry_id = OLD.id)
  ) THEN
    RAISE EXCEPTION 'finance_journal_entry_branch_immutable_when_referenced' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS finance_journal_branch_retag_guard ON journal_entries_v2;
CREATE TRIGGER finance_journal_branch_retag_guard
  BEFORE UPDATE OF branch_id ON journal_entries_v2 FOR EACH ROW EXECUTE FUNCTION finance_guard_journal_branch_retag();

COMMIT;
