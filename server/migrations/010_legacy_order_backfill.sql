BEGIN;

ALTER TABLE finance_legacy_archive
  ADD COLUMN IF NOT EXISTS reviewed_tenders JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS backfill_status TEXT NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS backfill_journal_entry_id UUID REFERENCES journal_entries_v2(id),
  ADD COLUMN IF NOT EXISTS backfill_approval_id UUID REFERENCES finance_approvals(id),
  ADD COLUMN IF NOT EXISTS backfill_event_id UUID REFERENCES finance_events(id),
  ADD COLUMN IF NOT EXISTS backfill_requested_by TEXT,
  ADD COLUMN IF NOT EXISTS backfill_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS backfilled_by TEXT,
  ADD COLUMN IF NOT EXISTS backfilled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS backfill_reversal_journal_entry_id UUID REFERENCES journal_entries_v2(id),
  ADD COLUMN IF NOT EXISTS backfill_reversed_by TEXT,
  ADD COLUMN IF NOT EXISTS backfill_reversed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_legacy_archive_reviewed_tenders_shape_check') THEN
    ALTER TABLE finance_legacy_archive ADD CONSTRAINT finance_legacy_archive_reviewed_tenders_shape_check
      CHECK (jsonb_typeof(reviewed_tenders) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_legacy_archive_backfill_status_check') THEN
    ALTER TABLE finance_legacy_archive ADD CONSTRAINT finance_legacy_archive_backfill_status_check
      CHECK (backfill_status IN ('not_requested','pending_approval','rejected','posted','reversed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_legacy_archive_backfill_chain_check') THEN
    ALTER TABLE finance_legacy_archive ADD CONSTRAINT finance_legacy_archive_backfill_chain_check CHECK (
      (backfill_status <> 'pending_approval' OR (backfill_journal_entry_id IS NOT NULL AND backfill_approval_id IS NOT NULL AND backfill_requested_by IS NOT NULL AND backfill_requested_at IS NOT NULL))
      AND
      (backfill_status NOT IN ('posted','reversed') OR (backfill_journal_entry_id IS NOT NULL AND backfill_approval_id IS NOT NULL AND backfill_event_id IS NOT NULL AND backfilled_by IS NOT NULL AND backfilled_at IS NOT NULL))
      AND
      (backfill_status <> 'reversed' OR (backfill_reversal_journal_entry_id IS NOT NULL AND backfill_reversed_by IS NOT NULL AND backfill_reversed_at IS NOT NULL))
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS finance_legacy_archive_backfill_journal_unique
  ON finance_legacy_archive(backfill_journal_entry_id)
  WHERE backfill_journal_entry_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS finance_legacy_archive_backfill_event_unique
  ON finance_legacy_archive(backfill_event_id)
  WHERE backfill_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS finance_legacy_archive_backfill_reversal_unique
  ON finance_legacy_archive(backfill_reversal_journal_entry_id)
  WHERE backfill_reversal_journal_entry_id IS NOT NULL;

COMMIT;
