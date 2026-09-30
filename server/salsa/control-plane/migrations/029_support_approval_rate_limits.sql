-- Migration 029: shared approval abuse limiter for persistent Control Plane instances

BEGIN;

CREATE TABLE IF NOT EXISTS neem_support_approval_rate_limits (
  scope VARCHAR(16) NOT NULL CHECK (scope IN ('ip', 'token')),
  key_hash VARCHAR(64) NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key_hash, window_started_at)
);

CREATE INDEX IF NOT EXISTS neem_support_approval_rate_limits_window_idx
  ON neem_support_approval_rate_limits(window_started_at);

COMMIT;
