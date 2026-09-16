-- server/neem/control-plane/migrations/003_versioned_policy_engine.sql
-- Migration 003: Versioned Feature Catalog, Commercial Grants, 3-State Overrides, Policy Snapshots, and Outbox

BEGIN;

-- 1. Versioned Catalog Snapshots
CREATE TABLE IF NOT EXISTS neem_policy_catalogs (
  version TEXT PRIMARY KEY,
  features JSONB NOT NULL,
  total_features INTEGER NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Commercial Grants
CREATE TABLE IF NOT EXISTS neem_commercial_grants (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES neem_tenants(tenant_id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  grant_kind TEXT NOT NULL CHECK (grant_kind IN ('plan', 'addon', 'trial', 'custom')),
  expires_at TIMESTAMPTZ,
  granted_by TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, feature_key)
);
CREATE INDEX IF NOT EXISTS neem_commercial_grants_tenant_idx ON neem_commercial_grants(tenant_id);

-- 3. Personal Access Overrides (inherit / allow / deny)
CREATE TABLE IF NOT EXISTS neem_personal_overrides (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES neem_tenants(tenant_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('inherit', 'allow', 'deny')),
  decision_reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, user_id, permission_key)
);
CREATE INDEX IF NOT EXISTS neem_personal_overrides_lookup_idx ON neem_personal_overrides(tenant_id, user_id);

-- 4. Published Policy Snapshots
CREATE TABLE IF NOT EXISTS neem_published_policies (
  version TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES neem_tenants(tenant_id) ON DELETE CASCADE,
  policy_payload JSONB NOT NULL,
  policy_hash TEXT NOT NULL,
  published_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Outbox Distribution Queue & ACK Tracking
CREATE TABLE IF NOT EXISTS neem_policy_outbox (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES neem_tenants(tenant_id) ON DELETE CASCADE,
  policy_version TEXT NOT NULL REFERENCES neem_published_policies(version) ON DELETE RESTRICT,
  target_cell TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivering', 'acknowledged', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  acked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS neem_policy_outbox_status_idx ON neem_policy_outbox(status);

COMMIT;
