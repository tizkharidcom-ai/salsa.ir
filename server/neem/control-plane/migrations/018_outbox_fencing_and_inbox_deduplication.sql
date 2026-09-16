-- server/neem/control-plane/migrations/018_outbox_fencing_and_inbox_deduplication.sql
-- Migration 018: Outbox Lease Fencing Tokens & Recipient Cell Inbox Deduplication

-- 1. Extend neem_automation_outbox with lease_token and fencing_token
ALTER TABLE neem_automation_outbox
ADD COLUMN IF NOT EXISTS lease_token VARCHAR(64),
ADD COLUMN IF NOT EXISTS fencing_token BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_neem_outbox_fencing ON neem_automation_outbox(id, worker_id, fencing_token);

-- 2. Recipient Cell Inbox for External Destination Deduplication (At-Least-Once Delivery with Idempotent Receiver)
CREATE TABLE IF NOT EXISTS neem_cell_inbox (
    id VARCHAR(64) PRIMARY KEY,
    idempotency_key VARCHAR(128) UNIQUE NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,
    cell_id VARCHAR(64) NOT NULL,
    event_name VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'processed',
    ack_token VARCHAR(64) NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_neem_cell_inbox_tenant ON neem_cell_inbox(tenant_id);
CREATE INDEX IF NOT EXISTS idx_neem_cell_inbox_key ON neem_cell_inbox(idempotency_key);
