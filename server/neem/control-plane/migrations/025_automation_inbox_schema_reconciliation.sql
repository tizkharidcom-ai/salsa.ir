-- Migration 025: Reconcile PostgreSQL inbox schema with the durable ACK contract

-- Migration 018 introduced the first inbox table, while the production worker
-- contract later grew to include an in-progress lease, payload binding and a
-- response receipt. Keep the legacy event_name column for old readers, but
-- make task_type the canonical field used by the current worker.
ALTER TABLE neem_cell_inbox
    ALTER COLUMN event_name TYPE VARCHAR(128),
    ALTER COLUMN event_name DROP NOT NULL,
    ALTER COLUMN ack_token TYPE TEXT,
    ALTER COLUMN ack_token DROP NOT NULL,
    ALTER COLUMN processed_at DROP NOT NULL,
    ALTER COLUMN processed_at DROP DEFAULT,
    ADD COLUMN IF NOT EXISTS source_outbox_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS task_type VARCHAR(128),
    ADD COLUMN IF NOT EXISTS payload_digest VARCHAR(64),
    ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS response_payload JSONB;

UPDATE neem_cell_inbox
SET task_type = COALESCE(task_type, event_name, 'unknown'),
    source_outbox_id = COALESCE(source_outbox_id, 'legacy'),
    attempts = COALESCE(attempts, 1)
WHERE task_type IS NULL OR source_outbox_id IS NULL OR attempts IS NULL;

ALTER TABLE neem_cell_inbox
    ALTER COLUMN task_type SET NOT NULL;

-- The current worker writes task_type and leaves event_name to this compatibility
-- trigger. Existing integrations that still write event_name remain supported.
CREATE OR REPLACE FUNCTION neem_sync_cell_inbox_event_names()
RETURNS TRIGGER AS $$
BEGIN
    NEW.task_type := COALESCE(NEW.task_type, NEW.event_name, 'unknown');
    NEW.event_name := COALESCE(NEW.event_name, NEW.task_type);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_neem_sync_cell_inbox_event_names ON neem_cell_inbox;
CREATE TRIGGER trg_neem_sync_cell_inbox_event_names
BEFORE INSERT OR UPDATE OF event_name, task_type ON neem_cell_inbox
FOR EACH ROW EXECUTE FUNCTION neem_sync_cell_inbox_event_names();

CREATE INDEX IF NOT EXISTS idx_neem_cell_inbox_lease
    ON neem_cell_inbox(status, locked_until);
CREATE INDEX IF NOT EXISTS idx_neem_cell_inbox_source_outbox
    ON neem_cell_inbox(source_outbox_id);
