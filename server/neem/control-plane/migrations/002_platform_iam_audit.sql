-- server/neem/control-plane/migrations/002_platform_iam_audit.sql
-- Migration 002: Platform IAM, MFA Factors, Recovery Codes, Sessions, and Immutable Audit

BEGIN;

-- Migration version tracking
CREATE TABLE IF NOT EXISTS neem_control_migrations (
  version TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Platform Principals (strictly decoupled from restaurant users)
CREATE TABLE IF NOT EXISTS neem_platform_principals (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'platform_owner',
    'platform_operations',
    'platform_support',
    'platform_finance',
    'platform_readonly'
  )),
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending_mfa')),
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS neem_platform_principals_email_idx ON neem_platform_principals(email);

-- MFA Factors (RFC 6238 TOTP and backup factors)
CREATE TABLE IF NOT EXISTS neem_platform_mfa_factors (
  id UUID PRIMARY KEY,
  principal_id UUID NOT NULL REFERENCES neem_platform_principals(id) ON DELETE CASCADE,
  factor_kind TEXT NOT NULL CHECK (factor_kind IN ('totp', 'hardware_key')),
  secret_ciphertext TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_verification' CHECK (status IN ('pending_verification', 'active', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS neem_platform_mfa_principal_idx ON neem_platform_mfa_factors(principal_id);

-- Single-use Hashed Recovery Codes
CREATE TABLE IF NOT EXISTS neem_platform_recovery_codes (
  id UUID PRIMARY KEY,
  principal_id UUID NOT NULL REFERENCES neem_platform_principals(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  is_used BOOLEAN NOT NULL DEFAULT false,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS neem_platform_rec_codes_principal_idx ON neem_platform_recovery_codes(principal_id);

-- Platform Sessions with Token Hashes
CREATE TABLE IF NOT EXISTS neem_platform_sessions (
  id UUID PRIMARY KEY,
  principal_id UUID NOT NULL REFERENCES neem_platform_principals(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  client_ip TEXT,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS neem_platform_sessions_token_hash_idx ON neem_platform_sessions(token_hash);
CREATE INDEX IF NOT EXISTS neem_platform_sessions_principal_idx ON neem_platform_sessions(principal_id);

-- Enhance Audit Events with Cryptographic Hash Chain & Trigger Immutability
ALTER TABLE neem_control_audit_events 
  ADD COLUMN IF NOT EXISTS actor_role TEXT,
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS client_ip TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS prev_hash TEXT,
  ADD COLUMN IF NOT EXISTS event_hash TEXT;

-- Immutability trigger: Strictly forbid UPDATE or DELETE on audit records
CREATE OR REPLACE FUNCTION neem_prevent_audit_tampering()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are strictly append-only: UPDATE or DELETE is prohibited.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_neem_audit_no_tamper ON neem_control_audit_events;
CREATE TRIGGER trg_neem_audit_no_tamper
BEFORE UPDATE OR DELETE ON neem_control_audit_events
FOR EACH ROW EXECUTE FUNCTION neem_prevent_audit_tampering();

COMMIT;
