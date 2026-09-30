BEGIN;

CREATE TABLE IF NOT EXISTS neem_platform_mfa_challenges (
  id UUID PRIMARY KEY,
  principal_id UUID NOT NULL REFERENCES neem_platform_principals(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  is_used BOOLEAN NOT NULL DEFAULT false,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE neem_platform_mfa_challenges
  ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS neem_platform_mfa_challenges_token_unused_idx
  ON neem_platform_mfa_challenges(token_hash)
  WHERE is_used = false;

CREATE INDEX IF NOT EXISTS neem_platform_mfa_challenges_principal_idx
  ON neem_platform_mfa_challenges(principal_id, created_at DESC);

COMMIT;
