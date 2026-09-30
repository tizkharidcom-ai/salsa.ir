-- server/salsa/control-plane/migrations/007_support_and_pii_security.sql
-- Migration 007: Support Tickets, Time-Limited Impersonation Sessions & PII Key Encryption

CREATE TABLE IF NOT EXISTS neem_support_tickets (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES neem_tenants(tenant_id),
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_tenant', 'resolved', 'closed')),
    severity VARCHAR(32) NOT NULL DEFAULT 'normal' CHECK (severity IN ('low', 'normal', 'high', 'urgent')),
    creator_email VARCHAR(255) NOT NULL,
    assigned_principal_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_neem_tickets_tenant ON neem_support_tickets(tenant_id);

CREATE TABLE IF NOT EXISTS neem_support_sessions (
    id VARCHAR(64) PRIMARY KEY,
    ticket_id VARCHAR(64) REFERENCES neem_support_tickets(id),
    tenant_id VARCHAR(64) NOT NULL REFERENCES neem_tenants(tenant_id),
    support_principal_id VARCHAR(64) NOT NULL REFERENCES neem_platform_principals(id),
    view_as_user_id VARCHAR(64),
    session_scope VARCHAR(32) NOT NULL DEFAULT 'read_only' CHECK (session_scope IN ('read_only', 'diagnostics', 'emergency_fix')),
    reason TEXT NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 001 already creates a minimal support-session table. Reconcile that
-- baseline before creating the canonical indexes below; CREATE TABLE IF NOT
-- EXISTS alone does not upgrade an existing table.
ALTER TABLE neem_support_sessions
  ALTER COLUMN id TYPE VARCHAR(64) USING id::text,
  ALTER COLUMN actor_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS ticket_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS support_principal_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS view_as_user_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS session_scope VARCHAR(32) NOT NULL DEFAULT 'read_only',
  ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS is_write_allowed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS write_justification TEXT,
  ADD COLUMN IF NOT EXISTS scoped_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS audit_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_neem_supp_sess_token ON neem_support_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_neem_supp_sess_tenant ON neem_support_sessions(tenant_id);

CREATE TABLE IF NOT EXISTS neem_pii_encryption_keys (
    key_version VARCHAR(32) PRIMARY KEY,
    algorithm VARCHAR(32) NOT NULL DEFAULT 'aes-256-gcm',
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated', 'revoked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    rotated_at TIMESTAMPTZ
);
