-- server/salsa/control-plane/migrations/001_baseline_schema.sql
-- Migration 001: Baseline Control Plane Schema

BEGIN;

CREATE TABLE IF NOT EXISTS neem_tenants (
  tenant_id TEXT PRIMARY KEY CHECK (tenant_id ~ '^[a-z][a-z0-9-]{1,62}$'),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('provisioning','active','suspended','archived')),
  plan_code TEXT NOT NULL DEFAULT 'pilot',
  cell_id TEXT NOT NULL,
  database_name TEXT NOT NULL,
  database_provider TEXT NOT NULL,
  canonical_domain TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS neem_domains (
  domain TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES neem_tenants(tenant_id) ON DELETE RESTRICT,
  domain_kind TEXT NOT NULL CHECK (domain_kind IN ('neem_subdomain','custom')),
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','rejected')),
  tls_mode TEXT NOT NULL DEFAULT 'managed' CHECK (tls_mode IN ('managed','customer_certificate','internal')),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS neem_domains_tenant_idx ON neem_domains(tenant_id);

CREATE TABLE IF NOT EXISTS neem_tenant_features (
  tenant_id TEXT NOT NULL REFERENCES neem_tenants(tenant_id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'off' CHECK (state IN ('off','pilot','on','blocked')),
  rollout_percent INTEGER NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, feature_key)
);

CREATE TABLE IF NOT EXISTS neem_releases (
  release_version TEXT PRIMARY KEY,
  artifact_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','canary','released','rolled_back')),
  changelog JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS neem_tenant_releases (
  tenant_id TEXT PRIMARY KEY REFERENCES neem_tenants(tenant_id) ON DELETE CASCADE,
  release_version TEXT NOT NULL REFERENCES neem_releases(release_version) ON DELETE RESTRICT,
  rollout_stage TEXT NOT NULL DEFAULT 'pending' CHECK (rollout_stage IN ('pending','canary','rolling','active','blocked')),
  health JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS neem_customer_directory (
  tenant_id TEXT NOT NULL REFERENCES neem_tenants(tenant_id) ON DELETE CASCADE,
  phone_hash TEXT NOT NULL,
  phone_ciphertext TEXT NOT NULL,
  display_name TEXT,
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  source_cursor BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, phone_hash)
);
CREATE INDEX IF NOT EXISTS neem_customer_directory_last_seen_idx ON neem_customer_directory(tenant_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS neem_sync_events (
  tenant_id TEXT NOT NULL REFERENCES neem_tenants(tenant_id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  event_id TEXT NOT NULL,
  sequence BIGINT,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','applied','failed','quarantined')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  error_code TEXT,
  PRIMARY KEY (tenant_id, source, event_id)
);
CREATE INDEX IF NOT EXISTS neem_sync_events_sequence_idx ON neem_sync_events(tenant_id, source, sequence);

CREATE TABLE IF NOT EXISTS neem_sync_cursors (
  tenant_id TEXT NOT NULL REFERENCES neem_tenants(tenant_id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  last_sequence BIGINT NOT NULL DEFAULT 0,
  last_event_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, source)
);

CREATE TABLE IF NOT EXISTS neem_backup_verifications (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES neem_tenants(tenant_id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  storage_ref TEXT NOT NULL,
  backup_kind TEXT NOT NULL CHECK (backup_kind IN ('full','incremental','wal','snapshot')),
  verified_restore BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ,
  checksum_sha256 TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS neem_backup_verifications_tenant_idx ON neem_backup_verifications(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS neem_support_sessions (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES neem_tenants(tenant_id) ON DELETE RESTRICT,
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','expired'))
);

CREATE TABLE IF NOT EXISTS neem_control_audit_events (
  id UUID PRIMARY KEY,
  tenant_id TEXT REFERENCES neem_tenants(tenant_id) ON DELETE SET NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS neem_control_audit_events_tenant_idx ON neem_control_audit_events(tenant_id, occurred_at DESC);

COMMIT;
