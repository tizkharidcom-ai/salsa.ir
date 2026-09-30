-- server/salsa/control-plane/migrations/016_automation_scheduler_executions_and_durable_outbox.sql
-- Migration 016: Automation Scheduler, Versioned Rule Snapshots, Execution History & Durable Outbox Deduplication

-- 1. Extend neem_automation_rules with scheduling and metrics
ALTER TABLE neem_automation_rules
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS schedule_window JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS schedule_cron VARCHAR(64),
ADD COLUMN IF NOT EXISTS last_executed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS execution_count INT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS failure_count INT NOT NULL DEFAULT 0;

-- 2. Version history for automation rules (GM-16 Audit & Traceability)
CREATE TABLE IF NOT EXISTS neem_automation_rule_versions (
    id VARCHAR(64) PRIMARY KEY,
    rule_id VARCHAR(64) NOT NULL REFERENCES neem_automation_rules(id) ON DELETE CASCADE,
    version VARCHAR(32) NOT NULL,
    snapshot JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by VARCHAR(64) NOT NULL DEFAULT 'platform_system',
    CONSTRAINT uq_neem_rule_version UNIQUE (rule_id, version)
);

CREATE INDEX IF NOT EXISTS idx_neem_rule_versions_rule ON neem_automation_rule_versions(rule_id);

-- 3. Execution log & timeline (GM-16 Execution Details & Explainability)
CREATE TABLE IF NOT EXISTS neem_automation_executions (
    id VARCHAR(64) PRIMARY KEY,
    rule_id VARCHAR(64) NOT NULL REFERENCES neem_automation_rules(id),
    rule_version VARCHAR(32) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL REFERENCES neem_tenants(tenant_id),
    trigger_kind VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped', 'conflict_prevented')),
    conditions_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    action_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    action_result JSONB DEFAULT '{}'::jsonb,
    conflict_resolution TEXT,
    error_message TEXT,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    idempotency_key VARCHAR(128) UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_neem_auto_exec_tenant ON neem_automation_executions(tenant_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_neem_auto_exec_rule ON neem_automation_executions(rule_id, executed_at DESC);

-- 4. Extend neem_automation_outbox with worker_id
ALTER TABLE neem_automation_outbox
ADD COLUMN IF NOT EXISTS worker_id VARCHAR(64);

-- 5. Durable Deduplication Store across Worker Restarts
CREATE TABLE IF NOT EXISTS neem_automation_processed_keys (
    idempotency_key VARCHAR(128) PRIMARY KEY,
    task_id VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_neem_auto_dedup_tenant ON neem_automation_processed_keys(tenant_id);
