-- server/salsa/control-plane/migrations/005_neem_billing_and_subscriptions.sql
-- Migration 005: NEEM Commercial Subscriptions, Billing Ledger, Iranian Gateway & Quotas

CREATE TABLE IF NOT EXISTS neem_billing_plans (
    plan_code VARCHAR(32) PRIMARY KEY,
    name_fa VARCHAR(128) NOT NULL,
    base_price_monthly_rials BIGINT NOT NULL DEFAULT 0,
    included_branches INT NOT NULL DEFAULT 1,
    included_devices INT NOT NULL DEFAULT 2,
    features JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS neem_billing_subscriptions (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES neem_tenants(tenant_id),
    plan_code VARCHAR(32) NOT NULL REFERENCES neem_billing_plans(plan_code),
    status VARCHAR(32) NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'past_due', 'canceled', 'grace_period')),
    billing_cycle VARCHAR(16) NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'quarterly', 'annual')),
    current_period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    current_period_end TIMESTAMPTZ NOT NULL,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
    trial_ends_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_neem_subs_tenant ON neem_billing_subscriptions(tenant_id);

CREATE TABLE IF NOT EXISTS neem_billing_invoices (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES neem_tenants(tenant_id),
    subscription_id VARCHAR(64) REFERENCES neem_billing_subscriptions(id),
    amount_subtotal_rials BIGINT NOT NULL,
    vat_amount_rials BIGINT NOT NULL DEFAULT 0,
    discount_amount_rials BIGINT NOT NULL DEFAULT 0,
    amount_total_rials BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'unpaid' CHECK (status IN ('draft', 'unpaid', 'paid', 'refunded', 'canceled')),
    due_date TIMESTAMPTZ NOT NULL,
    paid_at TIMESTAMPTZ,
    line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_neem_invoices_tenant ON neem_billing_invoices(tenant_id);

CREATE TABLE IF NOT EXISTS neem_billing_transactions (
    id VARCHAR(64) PRIMARY KEY,
    invoice_id VARCHAR(64) NOT NULL REFERENCES neem_billing_invoices(id),
    tenant_id VARCHAR(64) NOT NULL REFERENCES neem_tenants(tenant_id),
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    gateway_provider VARCHAR(32) NOT NULL DEFAULT 'mock_saman',
    gateway_authority VARCHAR(128),
    trace_number VARCHAR(128),
    amount_rials BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'successful', 'failed', 'refunded')),
    refund_reason TEXT,
    refunded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    settled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_neem_tx_idempotency ON neem_billing_transactions(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_neem_tx_invoice ON neem_billing_transactions(invoice_id);

CREATE TABLE IF NOT EXISTS neem_billing_quotas (
    tenant_id VARCHAR(64) PRIMARY KEY REFERENCES neem_tenants(tenant_id),
    max_branches INT NOT NULL DEFAULT 1,
    max_devices INT NOT NULL DEFAULT 2,
    max_users INT NOT NULL DEFAULT 5,
    current_branches INT NOT NULL DEFAULT 1,
    current_devices INT NOT NULL DEFAULT 1,
    current_users INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
