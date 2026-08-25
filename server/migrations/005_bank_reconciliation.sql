BEGIN;

-- A bank statement line is external evidence, not a journal. It can only be
-- matched once to the exact bank-account movement of a posted journal entry.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_bank_statement_line_shape_check') THEN
    ALTER TABLE reconciliation_items
      ADD CONSTRAINT finance_bank_statement_line_shape_check
      CHECK (
        kind <> 'bank_statement_line'
        OR (
          bank_reference IS NOT NULL
          AND length(trim(bank_reference)) > 0
          AND amount_irr > 0
          AND details->>'direction' IN ('inflow', 'outflow')
          AND details->>'bankAccountCode' ~ '^12[0-9]{2}$'
          AND length(trim(COALESCE(details->>'occurredAt', ''))) > 0
        )
      );
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS finance_bank_statement_reference_unique
  ON reconciliation_items (branch_id, lower(bank_reference))
  WHERE kind = 'bank_statement_line';

-- A transfer between two bank accounts legitimately creates two statement
-- lines for one journal, so uniqueness is journal + bank account, not journal.
CREATE UNIQUE INDEX IF NOT EXISTS finance_bank_statement_journal_account_unique
  ON reconciliation_items (journal_entry_id, (details->>'bankAccountCode'))
  WHERE kind = 'bank_statement_line' AND status = 'matched';

COMMIT;
