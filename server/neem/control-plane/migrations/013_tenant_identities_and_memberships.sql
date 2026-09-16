-- server/neem/control-plane/migrations/013_tenant_identities_and_memberships.sql
-- Migration 013: Tenant Identities, Users, Memberships & Scoped RBAC (GM-13)
-- Idempotent, Expand-Contract & Rollback-Ready

CREATE TABLE IF NOT EXISTS neem_tenant_identities (
    id VARCHAR(64) PRIMARY KEY,
    display_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(32),
    identity_type VARCHAR(32) NOT NULL DEFAULT 'restaurant_staff' CHECK (identity_type IN ('platform_operator', 'restaurant_staff', 'guest')),
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
    mfa_enabled BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_neem_identities_email ON neem_tenant_identities(email);
CREATE INDEX IF NOT EXISTS idx_neem_identities_status ON neem_tenant_identities(status);

CREATE TABLE IF NOT EXISTS neem_tenant_memberships (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES neem_tenants(tenant_id) ON DELETE CASCADE,
    identity_id VARCHAR(64) NOT NULL REFERENCES neem_tenant_identities(id) ON DELETE CASCADE,
    role VARCHAR(64) NOT NULL DEFAULT 'cashier' CHECK (role IN ('owner', 'manager', 'accountant', 'cashier', 'kitchen', 'waiter', 'support')),
    branch_scope VARCHAR(64) NOT NULL DEFAULT '*',
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
    active_sessions INTEGER NOT NULL DEFAULT 1,
    invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    invited_by VARCHAR(64) NOT NULL DEFAULT 'system',
    revoked_by VARCHAR(64),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_identity UNIQUE (tenant_id, identity_id)
);

CREATE INDEX IF NOT EXISTS idx_neem_memberships_tenant ON neem_tenant_memberships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_neem_memberships_identity ON neem_tenant_memberships(identity_id);
CREATE INDEX IF NOT EXISTS idx_neem_memberships_status ON neem_tenant_memberships(status);
CREATE INDEX IF NOT EXISTS idx_neem_memberships_role ON neem_tenant_memberships(role);

-- DOWN / ROLLBACK SPECIFICATION:
-- DROP TABLE IF EXISTS neem_tenant_memberships;
-- DROP TABLE IF EXISTS neem_tenant_identities;
