-- server/neem/control-plane/migrations/017_support_tickets_sessions_keyring_and_pii_audit.sql
-- Migration 017: Canonical Ticketing, Support Sessions (View-As-User), Multi-Version Keyring, and PII Audit Trail

-- 1. Enhance neem_support_tickets with SLA, Priority, and Assignee fields
ALTER TABLE neem_support_tickets
ADD COLUMN IF NOT EXISTS subject VARCHAR(255),
ADD COLUMN IF NOT EXISTS priority VARCHAR(32) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(64),
ADD COLUMN IF NOT EXISTS requester_id VARCHAR(64);

-- 2. Ticket Conversation Thread (Messages and Internal Notes)
CREATE TABLE IF NOT EXISTS neem_support_ticket_messages (
    id VARCHAR(64) PRIMARY KEY,
    ticket_id VARCHAR(64) NOT NULL REFERENCES neem_support_tickets(id) ON DELETE CASCADE,
    sender_id VARCHAR(64) NOT NULL,
    sender_type VARCHAR(32) NOT NULL CHECK (sender_type IN ('tenant_user', 'platform_support', 'system')),
    is_internal BOOLEAN NOT NULL DEFAULT false,
    message_body TEXT NOT NULL,
    attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_neem_ticket_msgs_ticket ON neem_support_ticket_messages(ticket_id, created_at ASC);

-- 3. Enhance neem_support_sessions with Scoped Write, Justification, and Dual Audit linkage
ALTER TABLE neem_support_sessions
ADD COLUMN IF NOT EXISTS is_write_allowed BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS write_justification TEXT,
ADD COLUMN IF NOT EXISTS actor_id VARCHAR(64),
ADD COLUMN IF NOT EXISTS scoped_actions JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS audit_id VARCHAR(64);

-- 4. Isolated Tenant Customers Table with Encrypted PII (GM-17)
CREATE TABLE IF NOT EXISTS neem_tenant_customers (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES neem_tenants(tenant_id),
    full_name VARCHAR(128) NOT NULL,
    phone_encrypted TEXT NOT NULL,
    phone_hash VARCHAR(64) NOT NULL,
    phone_last4 VARCHAR(4) NOT NULL,
    national_id_encrypted TEXT,
    loyalty_tier VARCHAR(32) DEFAULT 'standard',
    orders_count INT NOT NULL DEFAULT 0,
    total_spend BIGINT NOT NULL DEFAULT 0,
    last_interaction_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_neem_cust_tenant ON neem_tenant_customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_neem_cust_hash ON neem_tenant_customers(tenant_id, phone_hash);
CREATE INDEX IF NOT EXISTS idx_neem_cust_last4 ON neem_tenant_customers(tenant_id, phone_last4);

-- 5. Dedicated PII Access and Controlled Reveal Audit (GM-26)
CREATE TABLE IF NOT EXISTS neem_pii_access_audit (
    id VARCHAR(64) PRIMARY KEY,
    actor_id VARCHAR(64) NOT NULL,
    support_actor_id VARCHAR(64),
    tenant_id VARCHAR(64) NOT NULL,
    session_id VARCHAR(64),
    target_resource VARCHAR(128) NOT NULL,
    action VARCHAR(64) NOT NULL CHECK (action IN ('REVEAL', 'EXPORT', 'SEARCH', 'ROTATE', 'REENCRYPT')),
    reason TEXT NOT NULL,
    masked_before TEXT,
    masked_after TEXT,
    watermark_id VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_neem_pii_audit_tenant ON neem_pii_access_audit(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_neem_pii_audit_actor ON neem_pii_access_audit(actor_id, created_at DESC);

-- 6. Keyring Rotation & Batch Re-encryption Progress Jobs
CREATE TABLE IF NOT EXISTS neem_keyring_reencrypt_jobs (
    id VARCHAR(64) PRIMARY KEY,
    current_key_version VARCHAR(32) NOT NULL,
    target_key_version VARCHAR(32) NOT NULL,
    total_records INT NOT NULL DEFAULT 0,
    reencrypted_records INT NOT NULL DEFAULT 0,
    failed_records INT NOT NULL DEFAULT 0,
    cursor_id VARCHAR(128),
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'paused')),
    error_summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_neem_reencrypt_status ON neem_keyring_reencrypt_jobs(status, created_at DESC);
