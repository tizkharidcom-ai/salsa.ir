-- server/salsa/control-plane/migrations/006_automation_and_scheduler.sql
-- Migration 006: NEEM Automation Rules, Scheduled Outbox Worker & Cell Sync Tracking

CREATE TABLE IF NOT EXISTS neem_automation_rules (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    trigger_kind VARCHAR(64) NOT NULL CHECK (trigger_kind IN ('trial_expiry', 'subscription_renewal', 'payment_overdue', 'schedule_window', 'custom_policy')),
    conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
    action_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    priority INT NOT NULL DEFAULT 10,
    is_paused BOOLEAN NOT NULL DEFAULT false,
    version VARCHAR(32) NOT NULL DEFAULT 'v1',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS neem_automation_outbox (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES neem_tenants(tenant_id),
    target_cell VARCHAR(64) NOT NULL,
    event_name VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'delivered', 'acknowledged', 'failed', 'dead_letter')),
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    locked_until TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_neem_auto_outbox_queue ON neem_automation_outbox(status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_neem_auto_outbox_tenant ON neem_automation_outbox(tenant_id);

CREATE TABLE IF NOT EXISTS neem_automation_cell_states (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES neem_tenants(tenant_id),
    cell_id VARCHAR(64) NOT NULL,
    desired_version VARCHAR(64) NOT NULL,
    applied_version VARCHAR(64),
    ack_version VARCHAR(64),
    ack_hash VARCHAR(64),
    last_synced_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_neem_tenant_cell UNIQUE (tenant_id, cell_id)
);
