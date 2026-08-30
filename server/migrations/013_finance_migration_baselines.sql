BEGIN;

CREATE TABLE IF NOT EXISTS finance_migration_baselines (
  id UUID PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('active','superseded')),
  source_count INTEGER NOT NULL CHECK (source_count >= 0),
  source_keys JSONB NOT NULL CHECK (jsonb_typeof(source_keys) = 'array'),
  source_fingerprints JSONB NOT NULL CHECK (jsonb_typeof(source_fingerprints) = 'object'),
  source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  trust_summary JSONB NOT NULL CHECK (jsonb_typeof(trust_summary) = 'object'),
  scanned_by TEXT NOT NULL,
  scanned_at TIMESTAMPTZ NOT NULL,
  superseded_at TIMESTAMPTZ,
  CHECK (source_count = jsonb_array_length(source_keys)),
  CHECK (
    (status = 'active' AND superseded_at IS NULL)
    OR (status = 'superseded' AND superseded_at IS NOT NULL AND superseded_at >= scanned_at)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_migration_baseline_one_active
  ON finance_migration_baselines(branch_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS finance_migration_baseline_history_idx
  ON finance_migration_baselines(branch_id, scanned_at DESC);

CREATE OR REPLACE FUNCTION finance_migration_baseline_immutable_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'finance_migration_baseline_history_is_immutable';
  END IF;
  IF OLD.status = 'superseded' THEN
    RAISE EXCEPTION 'finance_migration_baseline_history_is_immutable';
  END IF;
  IF NEW.status NOT IN ('active','superseded') THEN
    RAISE EXCEPTION 'invalid_finance_migration_baseline_transition';
  END IF;
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id
    OR NEW.source_count IS DISTINCT FROM OLD.source_count
    OR NEW.source_keys IS DISTINCT FROM OLD.source_keys
    OR NEW.source_fingerprints IS DISTINCT FROM OLD.source_fingerprints
    OR NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256
    OR NEW.trust_summary IS DISTINCT FROM OLD.trust_summary
    OR NEW.scanned_by IS DISTINCT FROM OLD.scanned_by
    OR NEW.scanned_at IS DISTINCT FROM OLD.scanned_at THEN
    RAISE EXCEPTION 'finance_migration_baseline_history_is_immutable';
  END IF;
  IF OLD.status = 'active' AND NEW.status = 'superseded' AND NEW.superseded_at IS NULL THEN
    RAISE EXCEPTION 'finance_migration_baseline_superseded_at_required';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_migration_baseline_immutable_trigger ON finance_migration_baselines;
CREATE TRIGGER finance_migration_baseline_immutable_trigger
  BEFORE UPDATE OR DELETE ON finance_migration_baselines
  FOR EACH ROW EXECUTE FUNCTION finance_migration_baseline_immutable_guard();

COMMIT;
