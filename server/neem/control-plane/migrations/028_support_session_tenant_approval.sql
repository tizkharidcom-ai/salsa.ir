-- server/neem/control-plane/migrations/028_support_session_tenant_approval.sql
-- Migration 028: Tenant-owner approval before a platform support session becomes usable

BEGIN;

ALTER TABLE neem_support_sessions
  ADD COLUMN IF NOT EXISTS approval_required BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tenant_approval_id VARCHAR(64);

ALTER TABLE neem_support_sessions
  DROP CONSTRAINT IF EXISTS neem_support_sessions_approval_status_check;

ALTER TABLE neem_support_sessions
  ADD CONSTRAINT neem_support_sessions_approval_status_check
  CHECK (approval_status IN ('pending', 'approved', 'rejected', 'expired'));

CREATE TABLE IF NOT EXISTS neem_support_session_approvals (
  id VARCHAR(64) PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL REFERENCES neem_support_sessions(id) ON DELETE CASCADE,
  tenant_id VARCHAR(64) NOT NULL REFERENCES neem_tenants(tenant_id) ON DELETE RESTRICT,
  ticket_id VARCHAR(64) REFERENCES neem_support_tickets(id) ON DELETE RESTRICT,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  status VARCHAR(32) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  approver_identity_id VARCHAR(64),
  approver_email VARCHAR(255),
  response_reason TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS neem_support_session_approval_session_uidx
  ON neem_support_session_approvals(session_id);
CREATE INDEX IF NOT EXISTS neem_support_session_approval_tenant_idx
  ON neem_support_session_approvals(tenant_id, status, expires_at);

COMMIT;
