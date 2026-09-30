-- Migration 032: Durable platform kill switches and distribution status

BEGIN;

CREATE TABLE IF NOT EXISTS neem_platform_kill_switches (
  id TEXT PRIMARY KEY,
  requested_key TEXT NOT NULL UNIQUE,
  feature_key TEXT,
  module_key TEXT,
  feature_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  scope TEXT NOT NULL DEFAULT 'global',
  reason TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'high', 'critical')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  affected_tenant_count INTEGER NOT NULL DEFAULT 1 CHECK (affected_tenant_count >= 0),
  approval_state TEXT NOT NULL,
  distribution_status TEXT NOT NULL DEFAULT 'pending' CHECK (distribution_status IN ('pending', 'synced', 'failed')),
  distribution_error JSONB,
  distributed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT neem_platform_kill_switch_feature_keys_array_ck
    CHECK (jsonb_typeof(feature_keys) = 'array')
);

CREATE INDEX IF NOT EXISTS neem_platform_kill_switches_active_created_idx
  ON neem_platform_kill_switches (created_at DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS neem_platform_kill_switches_feature_keys_gin_idx
  ON neem_platform_kill_switches USING GIN (feature_keys);

COMMIT;
