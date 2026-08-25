BEGIN;

ALTER TABLE finance_legacy_archive
  ADD COLUMN IF NOT EXISTS branch_id BIGINT,
  ADD COLUMN IF NOT EXISTS amount_irr BIGINT,
  ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS classification_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS decision TEXT,
  ADD COLUMN IF NOT EXISTS decision_notes TEXT,
  ADD COLUMN IF NOT EXISTS evidence_reference TEXT,
  ADD COLUMN IF NOT EXISTS decision_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS archived_by TEXT;

UPDATE finance_legacy_archive
SET decision = CASE WHEN trust_status = 'quarantined' THEN 'keep_quarantined' ELSE 'pending' END
WHERE decision IS NULL;

ALTER TABLE finance_legacy_archive
  ALTER COLUMN decision SET DEFAULT 'pending',
  ALTER COLUMN decision SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_legacy_archive_decision_check') THEN
    ALTER TABLE finance_legacy_archive ADD CONSTRAINT finance_legacy_archive_decision_check
      CHECK (decision IN ('pending','approved_for_backfill','keep_quarantined','not_financial'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_legacy_archive_amount_check') THEN
    ALTER TABLE finance_legacy_archive ADD CONSTRAINT finance_legacy_archive_amount_check
      CHECK (amount_irr IS NULL OR amount_irr >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_legacy_archive_quarantine_check') THEN
    ALTER TABLE finance_legacy_archive ADD CONSTRAINT finance_legacy_archive_quarantine_check
      CHECK (NOT (trust_status = 'quarantined' AND decision = 'approved_for_backfill'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS finance_legacy_archive_decision_idx
  ON finance_legacy_archive(decision, trust_status, branch_id, archived_at DESC);

COMMIT;
