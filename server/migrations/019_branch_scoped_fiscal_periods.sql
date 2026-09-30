BEGIN;

-- Fiscal periods were initially global.  Keep that representation valid by
-- making branch_id nullable: NULL is the explicit global fallback used by the
-- application and existing rows do not need an unsafe guessed branch.
ALTER TABLE fiscal_periods_v2
  ADD COLUMN IF NOT EXISTS branch_id BIGINT REFERENCES unified_branches(id) ON DELETE RESTRICT;

ALTER TABLE fiscal_periods_v2
  DROP CONSTRAINT IF EXISTS fiscal_periods_v2_branch_positive;
ALTER TABLE fiscal_periods_v2
  ADD CONSTRAINT fiscal_periods_v2_branch_positive
  CHECK (branch_id IS NULL OR branch_id > 0);

-- A global period is a wildcard for every branch.  A plain EXCLUDE on
-- branch_id would let global and branch-specific periods overlap, while a
-- plain date EXCLUDE would incorrectly reject the same period in two
-- independent branches.  The generated integer range models the wildcard:
-- NULL -> [0, infinity), branch N -> [N, N+1).
ALTER TABLE fiscal_periods_v2
  ADD COLUMN IF NOT EXISTS branch_scope int8range
  GENERATED ALWAYS AS (
    CASE
      WHEN branch_id IS NULL THEN int8range(0, NULL, '[)')
      ELSE int8range(branch_id, branch_id + 1, '[)')
    END
  ) STORED;

ALTER TABLE fiscal_periods_v2
  DROP CONSTRAINT IF EXISTS fiscal_periods_v2_daterange_excl;
ALTER TABLE fiscal_periods_v2
  DROP CONSTRAINT IF EXISTS fiscal_periods_v2_branch_scope_daterange_excl;
ALTER TABLE fiscal_periods_v2
  ADD CONSTRAINT fiscal_periods_v2_branch_scope_daterange_excl
  EXCLUDE USING gist (
    branch_scope WITH &&,
    daterange(starts_on, ends_on, '[]') WITH &&
  );

-- Continuity is checked per effective scope.  A global period participates in
-- every branch's continuity chain; two branch-specific chains must not affect
-- each other.
CREATE OR REPLACE FUNCTION finance_validate_period_continuity() RETURNS trigger AS $$
DECLARE previous_end DATE; next_start DATE;
BEGIN
  SELECT MAX(ends_on) INTO previous_end
    FROM fiscal_periods_v2
   WHERE id <> NEW.id
     AND ends_on < NEW.starts_on
     AND (branch_id IS NULL OR NEW.branch_id IS NULL OR branch_id = NEW.branch_id);
  SELECT MIN(starts_on) INTO next_start
    FROM fiscal_periods_v2
   WHERE id <> NEW.id
     AND starts_on > NEW.ends_on
     AND (branch_id IS NULL OR NEW.branch_id IS NULL OR branch_id = NEW.branch_id);
  IF previous_end IS NOT NULL AND previous_end + 1 <> NEW.starts_on THEN
    RAISE EXCEPTION 'fiscal_period_gap_before';
  END IF;
  IF next_start IS NOT NULL AND NEW.ends_on + 1 <> next_start THEN
    RAISE EXCEPTION 'fiscal_period_gap_after';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP INDEX IF EXISTS fiscal_periods_v2_branch_idx;
CREATE INDEX IF NOT EXISTS fiscal_periods_v2_branch_idx
  ON fiscal_periods_v2(branch_id, starts_on, ends_on);

COMMIT;
