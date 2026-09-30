-- server/salsa/control-plane/migrations/015_billing_plans_invoicing_and_quota_meters.sql
-- Migration 015: Commercial Plans Catalog Versioning, Invoice Snapshots & Quota Usage Meters (GM-10 / GM-11 / GM-12)

-- 1. Extend Plans Catalog with Versioning and Draft Capabilities (GM-10)
ALTER TABLE neem_billing_plans ADD COLUMN IF NOT EXISTS version VARCHAR(16) NOT NULL DEFAULT '1.0.0';
ALTER TABLE neem_billing_plans ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE neem_billing_plans ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE neem_billing_plans ADD COLUMN IF NOT EXISTS custom_tenant_id VARCHAR(64);
ALTER TABLE neem_billing_plans ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE neem_billing_plans ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE neem_billing_plans ADD COLUMN IF NOT EXISTS description_fa TEXT;
ALTER TABLE neem_billing_plans ADD COLUMN IF NOT EXISTS included_users INT NOT NULL DEFAULT 5;
ALTER TABLE neem_billing_plans ADD COLUMN IF NOT EXISTS quotas JSONB NOT NULL DEFAULT '{"maxBranches": 1, "maxDevices": 2, "maxUsers": 5, "maxOrders": -1, "maxStorageMb": 5000, "maxSms": 1000}'::jsonb;

-- 2. Extend Invoices with Numbering, Snapshots, and Entitlement Activation Tracking (GM-11)
ALTER TABLE neem_billing_invoices ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(64);
ALTER TABLE neem_billing_invoices ADD COLUMN IF NOT EXISTS settlement_reference VARCHAR(128);
ALTER TABLE neem_billing_invoices ADD COLUMN IF NOT EXISTS entitlement_status VARCHAR(32) NOT NULL DEFAULT 'pending';
ALTER TABLE neem_billing_invoices ADD COLUMN IF NOT EXISTS currency VARCHAR(8) NOT NULL DEFAULT 'IRR';
ALTER TABLE neem_billing_invoices ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(16) NOT NULL DEFAULT 'monthly';
ALTER TABLE neem_billing_invoices ADD COLUMN IF NOT EXISTS customer_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_neem_invoice_number ON neem_billing_invoices(invoice_number);

-- 3. Extend Transactions with Activation Tracking and Refund Audit (GM-11)
ALTER TABLE neem_billing_transactions ADD COLUMN IF NOT EXISTS entitlement_activated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE neem_billing_transactions ADD COLUMN IF NOT EXISTS entitlement_activated_at TIMESTAMPTZ;
ALTER TABLE neem_billing_transactions ADD COLUMN IF NOT EXISTS activation_error TEXT;
ALTER TABLE neem_billing_transactions ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;

-- 4. Extend Quotas with Resource Usage Meters (GM-12)
ALTER TABLE neem_billing_quotas ADD COLUMN IF NOT EXISTS max_orders_monthly INT NOT NULL DEFAULT -1; -- -1 means unlimited
ALTER TABLE neem_billing_quotas ADD COLUMN IF NOT EXISTS current_orders_monthly INT NOT NULL DEFAULT 0;
ALTER TABLE neem_billing_quotas ADD COLUMN IF NOT EXISTS max_storage_mb INT NOT NULL DEFAULT 5000;
ALTER TABLE neem_billing_quotas ADD COLUMN IF NOT EXISTS current_storage_mb INT NOT NULL DEFAULT 150;
ALTER TABLE neem_billing_quotas ADD COLUMN IF NOT EXISTS max_sms_monthly INT NOT NULL DEFAULT 1000;
ALTER TABLE neem_billing_quotas ADD COLUMN IF NOT EXISTS current_sms_monthly INT NOT NULL DEFAULT 65;
ALTER TABLE neem_billing_quotas ADD COLUMN IF NOT EXISTS last_measured_at TIMESTAMPTZ NOT NULL DEFAULT now();
