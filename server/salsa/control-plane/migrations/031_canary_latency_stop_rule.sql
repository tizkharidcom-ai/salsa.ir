BEGIN;

ALTER TABLE neem_rollout_waves
  ADD COLUMN IF NOT EXISTS latency_p95_threshold_ms NUMERIC(12,2) NOT NULL DEFAULT 750
  CHECK (latency_p95_threshold_ms > 0);

COMMIT;
