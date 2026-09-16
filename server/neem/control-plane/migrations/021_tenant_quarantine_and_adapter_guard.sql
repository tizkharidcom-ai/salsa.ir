-- server/neem/control-plane/migrations/021_tenant_quarantine_and_adapter_guard.sql
-- Migration 021: Permit explicit tenant quarantine state used by provisioning/automation.

ALTER TABLE neem_tenants DROP CONSTRAINT IF EXISTS neem_tenants_status_check;
ALTER TABLE neem_tenants
    ADD CONSTRAINT neem_tenants_status_check
    CHECK (status IN ('provisioning', 'active', 'suspended', 'quarantined', 'archived'));
