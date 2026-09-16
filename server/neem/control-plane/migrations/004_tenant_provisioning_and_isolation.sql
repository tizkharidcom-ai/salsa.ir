-- server/neem/control-plane/migrations/004_tenant_provisioning_and_isolation.sql
-- Migration 004: Tenant Provisioning Pipeline, Scoped Isolation & Invitations

CREATE TABLE IF NOT EXISTS neem_provisioning_jobs (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES neem_tenants(tenant_id),
    cell_id VARCHAR(64) NOT NULL,
    current_step VARCHAR(64) NOT NULL,
    step_index INTEGER NOT NULL DEFAULT 0,
    total_steps INTEGER NOT NULL DEFAULT 7,
    status VARCHAR(32) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'quarantined')),
    error_message TEXT,
    step_logs JSONB NOT NULL DEFAULT '[]'::jsonb,
    rollback_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_neem_prov_jobs_tenant ON neem_provisioning_jobs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_neem_prov_jobs_status ON neem_provisioning_jobs(status);

CREATE TABLE IF NOT EXISTS neem_tenant_invitations (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES neem_tenants(tenant_id),
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(32),
    role VARCHAR(64) NOT NULL DEFAULT 'owner',
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_neem_invites_tenant ON neem_tenant_invitations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_neem_invites_token ON neem_tenant_invitations(token_hash);

CREATE TABLE IF NOT EXISTS neem_tenant_backups (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES neem_tenants(tenant_id),
    backup_kind VARCHAR(32) NOT NULL DEFAULT 'snapshot' CHECK (backup_kind IN ('snapshot', 'pre_migration', 'daily', 'restore_test')),
    storage_uri VARCHAR(512) NOT NULL,
    checksum_sha256 VARCHAR(64) NOT NULL,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'verified' CHECK (status IN ('pending', 'verified', 'corrupt', 'restored')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_neem_backups_tenant ON neem_tenant_backups(tenant_id);
