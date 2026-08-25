-- Westo command-center production foundation.
-- The JSONB state table keeps the existing application fully compatible during
-- rollout; the typed tables provide an indexed operational/audit surface for
-- the next repository extraction.

CREATE TABLE IF NOT EXISTS westo_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  data JSONB NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS westo_audit_events (
  id UUID PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL,
  actor JSONB,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  branch_id BIGINT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS westo_audit_events_at_idx ON westo_audit_events (at DESC);
CREATE INDEX IF NOT EXISTS westo_audit_events_branch_idx ON westo_audit_events (branch_id, at DESC);

CREATE TABLE IF NOT EXISTS westo_payment_attempts (
  id UUID PRIMARY KEY,
  order_id BIGINT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  amount BIGINT NOT NULL,
  idempotency_key TEXT UNIQUE,
  provider_ref TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS westo_payment_attempts_order_idx ON westo_payment_attempts (order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS westo_delivery_zones (
  id BIGINT PRIMARY KEY,
  branch_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  fee BIGINT NOT NULL DEFAULT 0,
  min_order BIGINT NOT NULL DEFAULT 0,
  eta_minutes INTEGER NOT NULL DEFAULT 30,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS westo_delivery_zones_branch_idx ON westo_delivery_zones (branch_id, active, sort_order);
