-- server/salsa/control-plane/migrations/010_backups_and_disaster_recovery.sql
-- Migration 010: Comprehensive Encrypted Backup Manifests, Retention, Isolated Restore & Epoch Reconciliation

CREATE TABLE IF NOT EXISTS neem_backup_manifests (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    scope VARCHAR(32) NOT NULL DEFAULT 'tenant' CHECK (scope IN ('tenant', 'control_plane')),
    epoch INT NOT NULL DEFAULT 1,
    db_dump_ref VARCHAR(256) NOT NULL,
    db_checksum_sha256 VARCHAR(64) NOT NULL,
    files_ref VARCHAR(256) NOT NULL,
    files_checksum_sha256 VARCHAR(64) NOT NULL,
    config_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    encryption_key_id VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'corrupt', 'expired')),
    retention_tier VARCHAR(32) NOT NULL DEFAULT 'daily' CHECK (retention_tier IN ('daily', 'weekly', 'monthly', 'permanent')),
    size_bytes BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_neem_backup_tenant ON neem_backup_manifests(tenant_id);

CREATE TABLE IF NOT EXISTS neem_restore_drills (
    id VARCHAR(64) PRIMARY KEY,
    manifest_id VARCHAR(64) NOT NULL REFERENCES neem_backup_manifests(id),
    target_tenant_id VARCHAR(64) NOT NULL,
    target_isolation_db VARCHAR(128) NOT NULL,
    pre_restore_epoch INT NOT NULL,
    post_restore_epoch INT NOT NULL,
    reconciliation_status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (reconciliation_status IN ('pending', 'verified_isolated', 'failed')),
    diff_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    rto_seconds INT NOT NULL DEFAULT 0,
    rpo_minutes INT NOT NULL DEFAULT 0,
    executed_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS neem_backup_policies (
    tenant_id VARCHAR(64) PRIMARY KEY,
    schedule_cron VARCHAR(64) NOT NULL DEFAULT '0 3 * * *',
    retention_days INT NOT NULL DEFAULT 30,
    is_encrypted BOOLEAN NOT NULL DEFAULT true,
    destination_provider VARCHAR(64) NOT NULL DEFAULT 'arvan_object_storage',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
