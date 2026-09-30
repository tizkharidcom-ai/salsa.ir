-- server/salsa/control-plane/migrations/019_tenant_and_billing_concurrency_versioning.sql
-- Migration 019: Concurrency Versioning & Locking for Tenants, Subscriptions, and Grants (P0 Hardening)

ALTER TABLE neem_tenants ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE neem_billing_subscriptions ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE neem_billing_invoices ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE neem_commercial_grants ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
