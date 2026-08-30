BEGIN;

-- A PSP batch identity is unique within a branch.  The original index omitted
-- branch_id, which made two legitimate branches with the same terminal/batch
-- look like a duplicate at the database layer.
DROP INDEX IF EXISTS finance_settlement_batch_unique;
CREATE UNIQUE INDEX finance_settlement_batch_unique
  ON reconciliation_items (branch_id, psp, terminal_id, batch_no)
  WHERE kind = 'settlement' AND status <> 'exception';

COMMIT;
