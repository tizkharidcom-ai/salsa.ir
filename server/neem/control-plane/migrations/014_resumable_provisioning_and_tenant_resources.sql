-- server/neem/control-plane/migrations/014_resumable_provisioning_and_tenant_resources.sql
-- Migration 014: Resumable Provisioning Pipeline, Tenant Resource Handles & Idempotency Keys (Phase 4 / GM-05, GM-06, GM-07)
-- Compliant with GODMODE.MD Section 6, Section 28, AC-01, AC-02, AC-03, AC-06

-- 1. Extend neem_provisioning_jobs with Idempotency Key, Resource Handle and Step Checksums
ALTER TABLE neem_provisioning_jobs ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);
ALTER TABLE neem_provisioning_jobs ADD COLUMN IF NOT EXISTS last_successful_step VARCHAR(64);
ALTER TABLE neem_provisioning_jobs ADD COLUMN IF NOT EXISTS step_checksums JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE neem_provisioning_jobs ADD COLUMN IF NOT EXISTS resource_handle JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_neem_prov_jobs_idempotency'
    ) THEN
        ALTER TABLE neem_provisioning_jobs ADD CONSTRAINT uq_neem_prov_jobs_idempotency UNIQUE (idempotency_key);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_neem_prov_jobs_idempotency ON neem_provisioning_jobs(idempotency_key);

-- 2. Tenant Resources Table (tracking allocated isolated DB, storage, cache and routing handles)
CREATE TABLE IF NOT EXISTS neem_tenant_resources (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES neem_tenants(tenant_id),
    resource_type VARCHAR(32) NOT NULL CHECK (resource_type IN ('database', 'storage', 'cache', 'domain', 'routing')),
    resource_handle VARCHAR(255) NOT NULL,
    cell_id VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'allocating' CHECK (status IN ('allocating', 'ready', 'quarantined', 'deprovisioned')),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_neem_tenant_res_tenant ON neem_tenant_resources(tenant_id);
CREATE INDEX IF NOT EXISTS idx_neem_tenant_res_type ON neem_tenant_resources(resource_type);
CREATE INDEX IF NOT EXISTS idx_neem_tenant_res_status ON neem_tenant_resources(status);

-- Down Migration / Rollback Specification:
-- DROP TABLE IF EXISTS neem_tenant_resources;
-- ALTER TABLE neem_provisioning_jobs DROP CONSTRAINT IF EXISTS uq_neem_prov_jobs_idempotency;
-- ALTER TABLE neem_provisioning_jobs DROP COLUMN IF EXISTS idempotency_key;
-- ALTER TABLE neem_provisioning_jobs DROP COLUMN IF EXISTS last_successful_step;
-- ALTER TABLE neem_provisioning_jobs DROP COLUMN IF EXISTS step_checksums;
-- ALTER TABLE neem_provisioning_jobs DROP COLUMN IF EXISTS resource_handle;
