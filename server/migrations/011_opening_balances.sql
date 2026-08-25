BEGIN;

CREATE OR REPLACE FUNCTION finance_opening_balance_lines_valid(
  payload JSONB,
  expected_debit BIGINT,
  expected_credit BIGINT,
  expected_branch BIGINT
) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  line JSONB;
  debit_value BIGINT;
  credit_value BIGINT;
  debit_total BIGINT := 0;
  credit_total BIGINT := 0;
  seen_codes TEXT[] := ARRAY[]::TEXT[];
  code_value TEXT;
BEGIN
  IF jsonb_typeof(payload) <> 'array' OR jsonb_array_length(payload) NOT BETWEEN 2 AND 1000 THEN
    RETURN FALSE;
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(payload)
  LOOP
    IF jsonb_typeof(line) <> 'object' THEN RETURN FALSE; END IF;
    code_value := trim(COALESCE(line->>'accountCode', ''));
    IF code_value !~ '^[123][0-9]{3,9}$' OR code_value = '3900' OR code_value = ANY(seen_codes) THEN RETURN FALSE; END IF;
    seen_codes := array_append(seen_codes, code_value);
    debit_value := (line->>'debitIrr')::BIGINT;
    credit_value := (line->>'creditIrr')::BIGINT;
    IF debit_value < 0 OR credit_value < 0 OR ((debit_value > 0) = (credit_value > 0)) THEN RETURN FALSE; END IF;
    IF (line->>'branchId')::BIGINT <> expected_branch OR line->>'costCenter' <> 'branch:' || expected_branch::TEXT THEN RETURN FALSE; END IF;
    debit_total := debit_total + debit_value;
    credit_total := credit_total + credit_value;
  END LOOP;
  RETURN debit_total = expected_debit
    AND credit_total = expected_credit
    AND debit_total = credit_total
    AND debit_total > 0;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$;

CREATE TABLE IF NOT EXISTS finance_opening_balance_batches (
  id UUID PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  as_of_date DATE NOT NULL,
  fiscal_period_id UUID NOT NULL REFERENCES fiscal_periods_v2(id) ON DELETE RESTRICT,
  source_reference TEXT NOT NULL CHECK (length(trim(source_reference)) BETWEEN 3 AND 160),
  debit_irr BIGINT NOT NULL CHECK (debit_irr > 0),
  credit_irr BIGINT NOT NULL CHECK (credit_irr > 0),
  lines JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_approval','posted','rejected','reversed')),
  journal_entry_id UUID NOT NULL UNIQUE REFERENCES journal_entries_v2(id) ON DELETE RESTRICT,
  approval_id UUID NOT NULL UNIQUE REFERENCES finance_approvals(id) ON DELETE RESTRICT,
  reversal_journal_entry_id UUID UNIQUE REFERENCES journal_entries_v2(id) ON DELETE RESTRICT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  posted_by TEXT,
  posted_at TIMESTAMPTZ,
  reversed_by TEXT,
  reversed_at TIMESTAMPTZ,
  CHECK (debit_irr = credit_irr),
  CHECK (finance_opening_balance_lines_valid(lines, debit_irr, credit_irr, branch_id)),
  CHECK (decided_by IS NULL OR decided_by <> created_by),
  CHECK (
    (status = 'pending_approval' AND decided_by IS NULL AND decided_at IS NULL AND posted_by IS NULL AND posted_at IS NULL AND reversal_journal_entry_id IS NULL)
    OR (status = 'rejected' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND posted_by IS NULL AND posted_at IS NULL AND reversal_journal_entry_id IS NULL)
    OR (status = 'posted' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND posted_by IS NOT NULL AND posted_at IS NOT NULL AND reversal_journal_entry_id IS NULL)
    OR (status = 'reversed' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND posted_by IS NOT NULL AND posted_at IS NOT NULL AND reversal_journal_entry_id IS NOT NULL AND reversed_by IS NOT NULL AND reversed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_opening_balance_one_active_branch
  ON finance_opening_balance_batches(branch_id)
  WHERE status IN ('pending_approval','posted');

CREATE INDEX IF NOT EXISTS finance_opening_balance_branch_date_idx
  ON finance_opening_balance_batches(branch_id, as_of_date DESC, created_at DESC);

CREATE OR REPLACE FUNCTION finance_opening_balance_immutable_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('posted','reversed') THEN
    RAISE EXCEPTION 'opening_balance_batches_are_immutable_use_reversal';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'pending_approval' AND NEW.status NOT IN ('pending_approval','posted','rejected') THEN
      RAISE EXCEPTION 'invalid_opening_balance_status_transition';
    ELSIF OLD.status = 'posted' AND NEW.status NOT IN ('posted','reversed') THEN
      RAISE EXCEPTION 'posted_opening_balance_requires_reversal';
    ELSIF OLD.status IN ('rejected','reversed') AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'final_opening_balance_status_is_immutable';
    END IF;
    IF OLD.status IN ('posted','reversed') AND (
      NEW.branch_id IS DISTINCT FROM OLD.branch_id
      OR NEW.as_of_date IS DISTINCT FROM OLD.as_of_date
      OR NEW.fiscal_period_id IS DISTINCT FROM OLD.fiscal_period_id
      OR NEW.source_reference IS DISTINCT FROM OLD.source_reference
      OR NEW.debit_irr IS DISTINCT FROM OLD.debit_irr
      OR NEW.credit_irr IS DISTINCT FROM OLD.credit_irr
      OR NEW.lines IS DISTINCT FROM OLD.lines
      OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id
      OR NEW.approval_id IS DISTINCT FROM OLD.approval_id
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    ) THEN
      RAISE EXCEPTION 'opening_balance_batches_are_immutable_use_reversal';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS finance_opening_balance_immutable_trigger ON finance_opening_balance_batches;
CREATE TRIGGER finance_opening_balance_immutable_trigger
  BEFORE UPDATE OR DELETE ON finance_opening_balance_batches
  FOR EACH ROW EXECUTE FUNCTION finance_opening_balance_immutable_guard();

COMMIT;
